use super::{
    AHashMap, AHashSet, Arc, BTreeMap, CODEBOOK_RENAME_PAIRS, LineageSearchDigest,
    LineageSearchEvidence, OnceLock, PipelineRowLineage, RefCell, Row, RowData, RowInner,
    ScreenIntervalLineage, SharedString, SmallVec, SourceDataRowRange, SourceDataRows,
};

#[derive(serde::Serialize)]
pub(super) struct PersistedStringRef<'a> {
    pub(super) id: u32,
    pub(super) value: Option<&'a str>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct PersistedString {
    pub(super) id: u32,
    pub(super) value: Option<String>,
}

pub(super) struct PersistedStringEncoder(pub(super) AHashMap<SharedString, u32>);

impl Default for PersistedStringEncoder {
    fn default() -> Self {
        Self(AHashMap::new())
    }
}

#[derive(Default)]
pub(super) struct PersistedStringDecoder(pub(super) Vec<Arc<String>>);

type RowCandidateKey = (usize, i64, Option<i64>, Option<i64>);
type RowInnerPool = AHashMap<RowCandidateKey, Vec<std::sync::Weak<RowInner>>>;

thread_local! {
    static PERSISTED_STRING_ENCODER: RefCell<Option<PersistedStringEncoder>> = const {
        RefCell::new(None)
    };
    static PERSISTED_STRING_DECODER: RefCell<Option<PersistedStringDecoder>> = const {
        RefCell::new(None)
    };
}

pub(super) struct PersistedStringEncoderGuard;

impl Drop for PersistedStringEncoderGuard {
    fn drop(&mut self) {
        PERSISTED_STRING_ENCODER.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

pub(super) struct PersistedStringDecoderGuard;

impl Drop for PersistedStringDecoderGuard {
    fn drop(&mut self) {
        PERSISTED_STRING_DECODER.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

pub(crate) fn with_serialized_row_string_table<T>(encode: impl FnOnce() -> T) -> T {
    PERSISTED_STRING_ENCODER.with(|slot| {
        let previous = slot.borrow_mut().replace(PersistedStringEncoder::default());
        assert!(previous.is_none(), "row string serialization table nested");
    });
    let _guard = PersistedStringEncoderGuard;
    encode()
}

pub(super) fn serialize_persisted_string<S>(value: &SharedString, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let (id, first) = PERSISTED_STRING_ENCODER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let table = slot.as_mut().ok_or_else(|| {
            <S::Error as serde::ser::Error>::custom(
                "binary Chronicle row serialization requires a string table",
            )
        })?;
        if let Some(id) = table.0.get(value).copied() {
            Ok((id, false))
        } else {
            let id = u32::try_from(table.0.len()).map_err(|_| {
                <S::Error as serde::ser::Error>::custom("Chronicle row string table exceeds u32")
            })?;
            table.0.insert(value.clone(), id);
            Ok((id, true))
        }
    })?;
    serde::Serialize::serialize(
        &PersistedStringRef {
            id,
            value: first.then(|| value.as_str()),
        },
        serializer,
    )
}

pub(super) fn deserialize_persisted_string<'de, D>(deserializer: D) -> Result<SharedString, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let persisted = <PersistedString as serde::Deserialize>::deserialize(deserializer)?;
    PERSISTED_STRING_DECODER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let table = slot.as_mut().ok_or_else(|| {
            <D::Error as serde::de::Error>::custom(
                "binary Chronicle row deserialization requires a string table",
            )
        })?;
        let value = if let Some(value) = persisted.value {
            if persisted.id as usize != table.0.len() {
                return Err(<D::Error as serde::de::Error>::custom(
                    "Chronicle row string definition is out of order",
                ));
            }
            let shared = static_lineage_text(&value).unwrap_or_else(|| Arc::new(value));
            table.0.push(Arc::clone(&shared));
            shared
        } else {
            table.0.get(persisted.id as usize).cloned().ok_or_else(|| {
                <D::Error as serde::de::Error>::custom(
                    "Chronicle row string reference is undefined",
                )
            })?
        };
        Ok(SharedString(value))
    })
}

/// Temporary value interner used while a row table is constructed. It shares
/// repeated strings within that table without retaining raw-data values after
/// the table is dropped or introducing global mutable state.
pub(super) struct SharedStringPool(pub(super) AHashSet<SharedString>);

impl Default for SharedStringPool {
    fn default() -> Self {
        Self(AHashSet::new())
    }
}

impl SharedStringPool {
    pub(super) fn intern_owned(&mut self, value: String) -> SharedString {
        if let Some(existing) = self.0.get(value.as_str()) {
            return existing.clone();
        }
        let shared = SharedString::from(value);
        self.0.insert(shared.clone());
        shared
    }

    pub(super) fn intern(&mut self, value: &str) -> SharedString {
        if let Some(existing) = self.0.get(value) {
            return existing.clone();
        }
        let shared = SharedString::from(value);
        self.0.insert(shared.clone());
        shared
    }
}

thread_local! {
    static DESERIALIZED_ROW_STRING_POOL: RefCell<Option<SharedStringPool>> = const {
        RefCell::new(None)
    };
}

// Allocation sharing is restored within each decoded population without
// changing the persisted wire representation or retaining decoded values.
pub(super) struct RowArcPool<T>(AHashMap<u64, Vec<std::sync::Weak<T>>>);

impl<T> Default for RowArcPool<T> {
    fn default() -> Self { Self(AHashMap::new()) }
}

impl<T: std::hash::Hash + Eq> RowArcPool<T> {
    pub(super) fn intern(&mut self, value: Arc<T>) -> Arc<T> {
        use std::hash::{Hash, Hasher};
        if !DESERIALIZED_ROW_STRING_POOL.with(|slot| slot.borrow().is_some()) {
            return value;
        }
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        value.hash(&mut hasher);
        let bucket = self.0.entry(hasher.finish()).or_default();
        bucket.retain(|entry| entry.strong_count() != 0);
        for entry in bucket.iter().filter_map(std::sync::Weak::upgrade) {
            if entry == value {
                return entry;
            }
        }
        bucket.push(Arc::downgrade(&value));
        value
    }

    pub(super) fn prune(&mut self) {
        self.0.retain(|_, bucket| {
            bucket.retain(|entry| entry.strong_count() != 0);
            !bucket.is_empty()
        });
    }
}

thread_local! {
    static ROW_LINEAGE_POOL: RefCell<RowArcPool<SmallVec<[LineageSearchEvidence; 1]>>> = RefCell::default();
    static ROW_SOURCE_POOL: RefCell<RowArcPool<SmallVec<[SourceDataRowRange; 2]>>> = RefCell::default();
    static ROW_CODEBOOK_POOL: RefCell<RowArcPool<Vec<Option<String>>>> = RefCell::default();
    static ROW_INNER_POOL: RefCell<RowInnerPool> = RefCell::new(AHashMap::new());
}

pub(super) struct DeserializedRowStringPoolGuard;

impl Drop for DeserializedRowStringPoolGuard {
    fn drop(&mut self) {
        DESERIALIZED_ROW_STRING_POOL.with(|slot| {
            slot.borrow_mut().take();
        });
        ROW_LINEAGE_POOL.with(|pool| *pool.borrow_mut() = RowArcPool::default());
        ROW_SOURCE_POOL.with(|pool| *pool.borrow_mut() = RowArcPool::default());
        ROW_CODEBOOK_POOL.with(|pool| *pool.borrow_mut() = RowArcPool::default());
        ROW_INNER_POOL.with(|pool| *pool.borrow_mut() = AHashMap::new());
    }
}

pub(crate) fn compact_deserialized_row_payload<T: 'static>(value: &mut T) {
    if let Some(rows) = (value as &mut dyn std::any::Any).downcast_mut::<Vec<Row>>() {
        rows.shrink_to_fit();
    }
}

pub(crate) fn with_deserialized_row_string_pool<T>(decode: impl FnOnce() -> T) -> T {
    ROW_LINEAGE_POOL.with(|pool| pool.borrow_mut().prune());
    ROW_SOURCE_POOL.with(|pool| pool.borrow_mut().prune());
    ROW_CODEBOOK_POOL.with(|pool| pool.borrow_mut().prune());
    DESERIALIZED_ROW_STRING_POOL.with(|slot| {
        let previous = slot.borrow_mut().replace(SharedStringPool::default());
        assert!(previous.is_none(), "row string deserialization pool nested");
    });
    PERSISTED_STRING_DECODER.with(|slot| {
        let previous = slot.borrow_mut().replace(PersistedStringDecoder::default());
        assert!(
            previous.is_none(),
            "row string deserialization table nested"
        );
    });
    let _pool_guard = DeserializedRowStringPoolGuard;
    let _table_guard = PersistedStringDecoderGuard;
    decode()
}

pub(super) fn intern_deserialized_string(value: String) -> SharedString {
    DESERIALIZED_ROW_STRING_POOL.with(|slot| {
        let mut slot = slot.borrow_mut();
        match slot.as_mut() {
            Some(pool) => pool.intern_owned(value),
            None => SharedString::from(value),
        }
    })
}

pub(super) fn intern_deserialized_str(value: &str) -> SharedString {
    DESERIALIZED_ROW_STRING_POOL.with(|slot| {
        let mut slot = slot.borrow_mut();
        match slot.as_mut() {
            Some(pool) => pool.intern(value),
            None => SharedString::from(value),
        }
    })
}

impl serde::Serialize for SharedString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        if serializer.is_human_readable() {
            serializer.serialize_str(self.as_str())
        } else {
            serialize_persisted_string(self, serializer)
        }
    }
}

impl<'de> serde::Deserialize<'de> for SharedString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        if !deserializer.is_human_readable() {
            return deserialize_persisted_string(deserializer);
        }

        struct SharedStringVisitor;

        impl serde::de::Visitor<'_> for SharedStringVisitor {
            type Value = SharedString;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a UTF-8 string")
            }

            fn visit_borrowed_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(intern_deserialized_str(value))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(intern_deserialized_str(value))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(intern_deserialized_string(value))
            }
        }

        deserializer.deserialize_string(SharedStringVisitor)
    }
}

#[derive(serde::Serialize)]
pub(super) struct PersistedRowRef<'a> {
    pub(super) data: &'a RowData,
    pub(super) identity: Option<[u8; 16]>,
    pub(super) temporal: Option<[u8; 16]>,
    pub(super) classification: Option<[u8; 16]>,
}

#[derive(serde::Deserialize)]
pub(super) struct PersistedRow {
    pub(super) data: RowData,
    // Wire positions only: the decoder never trusts a persisted part.
    #[allow(dead_code)]
    pub(super) identity: Option<[u8; 16]>,
    #[allow(dead_code)]
    pub(super) temporal: Option<[u8; 16]>,
    #[allow(dead_code)]
    pub(super) classification: Option<[u8; 16]>,
}

pub(super) fn serialize_lineage_searches<S>(
    value: &Arc<SmallVec<[LineageSearchEvidence; 1]>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serde::Serialize::serialize(value.as_slice(), serializer)
}

pub(super) fn deserialize_lineage_searches<'de, D>(
    deserializer: D,
) -> Result<Arc<SmallVec<[LineageSearchEvidence; 1]>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct LineageSearchesVisitor;

    impl<'de> serde::de::Visitor<'de> for LineageSearchesVisitor {
        type Value = Arc<SmallVec<[LineageSearchEvidence; 1]>>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a sequence of lineage-search records")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut searches = SmallVec::new();
            while let Some(search) = sequence.next_element()? {
                searches.push(search);
            }
            searches.shrink_to_fit();
            if searches.is_empty() {
                Ok(empty_lineage_searches())
            } else {
                Ok(ROW_LINEAGE_POOL.with(|pool| pool.borrow_mut().intern(Arc::new(searches))))
            }
        }
    }

    deserializer.deserialize_seq(LineageSearchesVisitor)
}

pub(super) fn serialize_codebook_fields<S>(
    value: &Arc<Vec<Option<String>>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serde::Serialize::serialize(value, serializer)
}

pub(super) fn deserialize_codebook_fields<'de, D>(
    deserializer: D,
) -> Result<Arc<Vec<Option<String>>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct CodebookFieldsVisitor;

    impl<'de> serde::de::Visitor<'de> for CodebookFieldsVisitor {
        type Value = Arc<Vec<Option<String>>>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("the fixed Chronicle codebook field sequence")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut fields = SmallVec::<[Option<String>; 32]>::new();
            while let Some(field) = sequence.next_element()? {
                fields.push(field);
            }
            if fields.len() == CODEBOOK_RENAME_PAIRS.len() && fields.iter().all(Option::is_none) {
                Ok(empty_codebook_fields())
            } else {
                let mut fields = fields.into_vec();
                fields.shrink_to_fit();
                Ok(ROW_CODEBOOK_POOL.with(|pool| pool.borrow_mut().intern(Arc::new(fields))))
            }
        }
    }

    deserializer.deserialize_seq(CodebookFieldsVisitor)
}

impl serde::Serialize for Row {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        if serializer.is_human_readable() {
            self.0.data.serialize(serializer)
        } else {
            // Checkpoint caches are fill-state, not row state: which of them a
            // consumer happened to populate depends on residency (a spilled and
            // reloaded row copy is filled independently of the copy another
            // stage shares), so persisting them made base bytes depend on the
            // payload budget. They are cheap to recompute and are always None.
            PersistedRowRef {
                data: &self.0.data,
                identity: None,
                temporal: None,
                classification: None,
            }
            .serialize(serializer)
        }
    }
}

impl<'de> serde::Deserialize<'de> for Row {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let row = if deserializer.is_human_readable() {
            RowData::deserialize(deserializer).map(|data| Self(Arc::new(RowInner::new(data))))
        } else {
            // `Serialize` always writes the three checkpoint parts as None. A
            // part found here is therefore foreign, and restoring it would let
            // a resume base dictate a row's digests independently of its data:
            // the parts are recomputed from the data on first use instead.
            PersistedRow::deserialize(deserializer)
                .map(|persisted| Self(Arc::new(RowInner::new(persisted.data))))
        };
        row.map(intern_deserialized_row)
    }
}

pub(super) fn intern_deserialized_row(row: Row) -> Row {
    if !DESERIALIZED_ROW_STRING_POOL.with(|pool| pool.borrow().is_some()) {
        return row;
    }
    // This tuple only selects candidates. It never establishes equality:
    // every candidate is compared across all row fields below, including
    // float bit patterns. Avoid fingerprinting every unique decoded row.
    let data = &row.0.data;
    let key = (
        data.index,
        data.event_timestamp_ns,
        data.start_timestamp_ns,
        data.stop_timestamp_ns,
    );
    ROW_INNER_POOL.with(|pool| {
        let mut pool = pool.borrow_mut();
        let bucket = pool.entry(key).or_default();
        bucket.retain(|candidate| candidate.strong_count() != 0);
        for existing in bucket.iter().filter_map(std::sync::Weak::upgrade) {
            if exact_row_data_equal(&existing.data, &row.0.data) {
                return Row(existing);
            }
        }
        bucket.push(Arc::downgrade(&row.0));
        row
    })
}

pub(super) fn exact_row_data_equal(left: &RowData, right: &RowData) -> bool {
    let floats = |row: &RowData| [
        Some(row.data_time_gap_hours.to_bits()),
        row.duration_seconds.map(f64::to_bits),
        row.duration_minutes.map(f64::to_bits),
        row.screen_usage_end_reason_confidence.map(f64::to_bits),
        row.screen_usage_tail_gap_seconds.map(f64::to_bits),
        Some(row.valid_app_usage_time_gap_hours.to_bits()),
        Some(row.any_app_usage_time_gap_hours.to_bits()),
    ];
    if floats(left) != floats(right) {
        return false;
    }
    if left == right {
        return true;
    }
    // PartialEq rejects NaNs. Compare all other fields with the already
    // bitwise-checked floating fields masked, preserving NaN payloads and -0.
    let mask = |row: &RowData| {
        let mut row = row.clone();
        row.data_time_gap_hours = 0.0;
        row.duration_seconds = None;
        row.duration_minutes = None;
        row.screen_usage_end_reason_confidence = None;
        row.screen_usage_tail_gap_seconds = None;
        row.valid_app_usage_time_gap_hours = 0.0;
        row.any_app_usage_time_gap_hours = 0.0;
        row
    };
    mask(left) == mask(right)
}

pub(super) fn serialize_shared_arc_string<S>(value: &Arc<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if serializer.is_human_readable() {
        serializer.serialize_str(value)
    } else {
        serialize_persisted_string(&SharedString(Arc::clone(value)), serializer)
    }
}

pub(super) fn deserialize_shared_arc_string<'de, D>(deserializer: D) -> Result<Arc<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    if !deserializer.is_human_readable() {
        return deserialize_persisted_string(deserializer).map(SharedString::into_shared);
    }
    struct SharedArcStringVisitor;

    impl serde::de::Visitor<'_> for SharedArcStringVisitor {
        type Value = Arc<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a UTF-8 string")
        }

        fn visit_borrowed_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(intern_deserialized_arc_str(value))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(intern_deserialized_arc_str(value))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(intern_deserialized_arc_string(value))
        }
    }

    deserializer.deserialize_string(SharedArcStringVisitor)
}

pub(super) fn static_lineage_text(value: &str) -> Option<Arc<String>> {
    match value {
        "chronicle-lineage-search/v1" => Some(shared_lineage_text("chronicle-lineage-search/v1")),
        "selected-qualifying-stop" => Some(shared_lineage_text("selected-qualifying-stop")),
        "no-qualifying-stop" => Some(shared_lineage_text("no-qualifying-stop")),
        "device-state-split-fragment" => Some(shared_lineage_text("device-state-split-fragment")),
        "screen-credit-liveness-window" => {
            Some(shared_lineage_text("screen-credit-liveness-window"))
        }
        "pipeline-event-order" => Some(shared_lineage_text("pipeline-event-order")),
        "participant-source-event-order" => {
            Some(shared_lineage_text("participant-source-event-order"))
        }
        _ => None,
    }
}

pub(super) fn intern_deserialized_arc_str(value: &str) -> Arc<String> {
    static_lineage_text(value).unwrap_or_else(|| intern_deserialized_str(value).into_shared())
}

pub(super) fn intern_deserialized_arc_string(value: String) -> Arc<String> {
    static_lineage_text(&value).unwrap_or_else(|| intern_deserialized_string(value).into_shared())
}

impl serde::Serialize for LineageSearchDigest {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let encoded = self.encoded();
        serializer.serialize_str(std::str::from_utf8(&encoded).expect("BLAKE3 digest is ASCII"))
    }
}

impl<'de> serde::Deserialize<'de> for LineageSearchDigest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = <&str>::deserialize(deserializer)?;
        Self::parse(value).map_err(serde::de::Error::custom)
    }
}

pub(super) fn shared_lineage_text(value: &'static str) -> Arc<String> {
    static VALUES: OnceLock<BTreeMap<&'static str, Arc<String>>> = OnceLock::new();
    Arc::clone(
        VALUES
            .get_or_init(|| {
                [
                    "chronicle-lineage-search/v1",
                    "selected-qualifying-stop",
                    "no-qualifying-stop",
                    // One credited interval of an episode that a rule cut
                    // against the device-state timeline; see
                    // `materialize_candidate_episodes_in_place`.
                    "device-state-split-fragment",
                    "screen-credit-liveness-window",
                    "pipeline-event-order",
                    "participant-source-event-order",
                ]
                .into_iter()
                .map(|text| (text, Arc::new(text.to_owned())))
                .collect()
            })
            .get(value)
            .expect("lineage text must be registered"),
    )
}

impl serde::Serialize for SourceDataRows {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde::Serialize::serialize(self.0.as_slice(), serializer)
    }
}

impl<'de> serde::Deserialize<'de> for SourceDataRows {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct SourceDataRowsVisitor;

        impl<'de> serde::de::Visitor<'de> for SourceDataRowsVisitor {
            type Value = SourceDataRows;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a sequence of source-data row ranges")
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut ranges = SmallVec::new();
                while let Some(range) = sequence.next_element()? {
                    ranges.push(range);
                }
                ranges.shrink_to_fit();
                Ok(SourceDataRows(ROW_SOURCE_POOL.with(|pool| pool.borrow_mut().intern(Arc::new(ranges)))))
            }
        }

        deserializer.deserialize_seq(SourceDataRowsVisitor)
    }
}

pub(super) fn empty_codebook_fields_ref() -> &'static Arc<Vec<Option<String>>> {
    static EMPTY: OnceLock<Arc<Vec<Option<String>>>> = OnceLock::new();
    EMPTY.get_or_init(|| Arc::new(vec![None; CODEBOOK_RENAME_PAIRS.len()]))
}

pub(super) fn empty_codebook_fields() -> Arc<Vec<Option<String>>> {
    Arc::clone(empty_codebook_fields_ref())
}

pub(super) fn empty_lineage_searches() -> Arc<SmallVec<[LineageSearchEvidence; 1]>> {
    static EMPTY: OnceLock<Arc<SmallVec<[LineageSearchEvidence; 1]>>> = OnceLock::new();
    Arc::clone(EMPTY.get_or_init(|| Arc::new(SmallVec::new())))
}

/// A flattened `Option` deserializes as `Some` whenever its members are all
/// absent (serde's untagged-option rule); the lineage's box exists only for
/// rows that carry a member.
pub(super) fn deserialize_screen_lineage<'de, D>(
    deserializer: D,
) -> Result<Option<Box<ScreenIntervalLineage>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    <ScreenIntervalLineage as serde::Deserialize>::deserialize(deserializer)
        .map(ScreenIntervalLineage::boxed)
}

/// Serialized by hand as the thirteen-member struct the derive produced
/// before the seven optional members moved into the box: the checkpoint
/// fingerprint hashes the struct form (a derived `flatten` would serialize a
/// map instead), so the pinned query digests and the JSON wire are unchanged.
impl serde::Serialize for PipelineRowLineage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        struct SharedArc<'a>(&'a Arc<String>);
        impl serde::Serialize for SharedArc<'_> {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serialize_shared_arc_string(self.0, serializer)
            }
        }

        let none = ScreenIntervalLineage::default();
        let screen = self.screen.as_deref().unwrap_or(&none);
        let len = 6
            + usize::from(screen.screen_interval_id.is_some())
            + usize::from(screen.screen_construction_strategy_id.is_some())
            + usize::from(screen.screen_interval_kind.is_some())
            + usize::from(screen.screen_interval_close_reason.is_some())
            + usize::from(screen.screen_interval_left_censored.is_some())
            + usize::from(screen.screen_interval_right_censored.is_some())
            + usize::from(screen.schoedel_completion.is_some());
        let mut state = serializer.serialize_struct("PipelineRowLineage", len)?;
        state.serialize_field("outputKind", &SharedArc(&self.output_kind))?;
        state.serialize_field("outputRowIndex", &self.output_row_index)?;
        state.serialize_field("sourceDataRowRanges", &self.source_data_row_ranges)?;
        state.serialize_field("sourceDataRowCount", &self.source_data_row_count)?;
        state.serialize_field("searches", &self.searches)?;
        state.serialize_field("terminalQueryGroup", &SharedArc(&self.terminal_query_group))?;
        macro_rules! optional {
            ($name:literal, $field:ident) => {
                if screen.$field.is_some() {
                    state.serialize_field($name, &screen.$field)?;
                } else {
                    state.skip_field($name)?;
                }
            };
        }
        optional!("screenIntervalId", screen_interval_id);
        optional!("screenConstructionStrategyId", screen_construction_strategy_id);
        optional!("screenIntervalKind", screen_interval_kind);
        optional!("screenIntervalCloseReason", screen_interval_close_reason);
        optional!("screenIntervalLeftCensored", screen_interval_left_censored);
        optional!("screenIntervalRightCensored", screen_interval_right_censored);
        optional!("schoedelCompletion", schoedel_completion);
        state.end()
    }
}

/// Payload-store mirror of [`PipelineRowLineage`]. The lineage's optional
/// fields are `skip_serializing_if` on the JSON wire, which a
/// non-self-describing format cannot decode, so the store encodes every field
/// through this mirror with postcard and the shared row string table. The
/// JSON shape of `PipelineRowLineage` itself is unchanged.
#[derive(serde::Serialize)]
pub(super) struct StoredRowLineageRef<'a> {
    #[serde(serialize_with = "serialize_shared_arc_string_ref")]
    pub(super) output_kind: &'a Arc<String>,
    pub(super) output_row_index: u32,
    pub(super) source_data_row_ranges: &'a [SourceDataRowRange],
    pub(super) source_data_row_count: u32,
    pub(super) searches: &'a [LineageSearchEvidence],
    #[serde(serialize_with = "serialize_shared_arc_string_ref")]
    pub(super) terminal_query_group: &'a Arc<String>,
    pub(super) screen_interval_id: Option<&'a str>,
    pub(super) screen_construction_strategy_id: Option<&'a str>,
    pub(super) screen_interval_kind: Option<&'a str>,
    pub(super) screen_interval_close_reason: Option<&'a str>,
    pub(super) screen_interval_left_censored: Option<bool>,
    pub(super) screen_interval_right_censored: Option<bool>,
    pub(super) schoedel_completion: Option<&'a str>,
}

impl<'a> From<&'a PipelineRowLineage> for StoredRowLineageRef<'a> {
    fn from(row: &'a PipelineRowLineage) -> Self {
        Self {
            output_kind: &row.output_kind,
            output_row_index: row.output_row_index,
            source_data_row_ranges: &row.source_data_row_ranges,
            source_data_row_count: row.source_data_row_count,
            searches: &row.searches,
            terminal_query_group: &row.terminal_query_group,
            screen_interval_id: row.screen_interval_id(),
            screen_construction_strategy_id: row.screen_construction_strategy_id(),
            screen_interval_kind: row.screen_interval_kind(),
            screen_interval_close_reason: row.screen_interval_close_reason(),
            screen_interval_left_censored: row.screen_interval_left_censored(),
            screen_interval_right_censored: row.screen_interval_right_censored(),
            schoedel_completion: row.schoedel_completion(),
        }
    }
}

#[derive(serde::Deserialize)]
pub(super) struct StoredRowLineage {
    #[serde(deserialize_with = "deserialize_shared_arc_string")]
    pub(super) output_kind: Arc<String>,
    pub(super) output_row_index: u32,
    pub(super) source_data_row_ranges: Vec<SourceDataRowRange>,
    pub(super) source_data_row_count: u32,
    pub(super) searches: Vec<LineageSearchEvidence>,
    #[serde(deserialize_with = "deserialize_shared_arc_string")]
    pub(super) terminal_query_group: Arc<String>,
    pub(super) screen_interval_id: Option<String>,
    pub(super) screen_construction_strategy_id: Option<String>,
    pub(super) screen_interval_kind: Option<String>,
    pub(super) screen_interval_close_reason: Option<String>,
    pub(super) screen_interval_left_censored: Option<bool>,
    pub(super) screen_interval_right_censored: Option<bool>,
    pub(super) schoedel_completion: Option<String>,
}

impl From<StoredRowLineage> for PipelineRowLineage {
    fn from(row: StoredRowLineage) -> Self {
        Self {
            output_kind: row.output_kind,
            output_row_index: row.output_row_index,
            source_data_row_ranges: row.source_data_row_ranges,
            source_data_row_count: row.source_data_row_count,
            searches: row.searches,
            terminal_query_group: row.terminal_query_group,
            screen: ScreenIntervalLineage {
                screen_interval_id: row.screen_interval_id,
                screen_construction_strategy_id: row.screen_construction_strategy_id,
                screen_interval_kind: row.screen_interval_kind,
                screen_interval_close_reason: row.screen_interval_close_reason,
                screen_interval_left_censored: row.screen_interval_left_censored,
                screen_interval_right_censored: row.screen_interval_right_censored,
                schoedel_completion: row.schoedel_completion,
            }
            .boxed(),
        }
    }
}

pub(super) fn serialize_shared_arc_string_ref<S>(value: &&Arc<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serialize_shared_arc_string(value, serializer)
}

/// Encodes a lineage table for the payload store without copying its rows.
/// Requires an active row string table (`with_serialized_row_string_table`).
pub(crate) fn encode_row_lineage_payload(lineage: &[PipelineRowLineage]) -> Result<Vec<u8>, String> {
    struct Table<'a>(&'a [PipelineRowLineage]);

    impl serde::Serialize for Table<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            serializer.collect_seq(self.0.iter().map(StoredRowLineageRef::from))
        }
    }

    postcard::to_allocvec(&Table(lineage)).map_err(|error| error.to_string())
}

/// Decodes a lineage table straight into its final rows, exactly sized from
/// the encoded length, so no mirror table is ever held beside the result.
/// Requires an active row string pool (`with_deserialized_row_string_pool`).
pub(crate) fn decode_row_lineage_payload(bytes: &[u8]) -> Result<Vec<PipelineRowLineage>, String> {
    struct Table(Vec<PipelineRowLineage>);

    impl<'de> serde::Deserialize<'de> for Table {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            struct TableVisitor;

            impl<'de> serde::de::Visitor<'de> for TableVisitor {
                type Value = Table;

                fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    formatter.write_str("a row lineage table")
                }

                fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
                where
                    A: serde::de::SeqAccess<'de>,
                {
                    let mut rows = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                    while let Some(row) = seq.next_element::<StoredRowLineage>()? {
                        rows.push(PipelineRowLineage::from(row));
                    }
                    Ok(Table(rows))
                }
            }

            deserializer.deserialize_seq(TableVisitor)
        }
    }

    postcard::from_bytes::<Table>(bytes)
        .map(|table| table.0)
        .map_err(|error| error.to_string())
}
