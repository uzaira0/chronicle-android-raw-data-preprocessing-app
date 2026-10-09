use super::SCREEN_USAGE;
use super::{
    Arc, BTreeMap, BTreeSet, CODEBOOK_RENAME_PAIRS, COLLAPSED_GENRE_FIELD_INDICES,
    CheckpointHasher, Digest, PipelineV2Options, QueryCheckpointRecorder, Row, RowData,
    ScreenSessionConstructionStrategyId, SessionBoundaryScope, SessionGapBasis,
    SessionGroupingPolicy, SessionGroupingRules, Sha256, WorkflowCheckpoint, Xxh3, b05,
    b05_screen_options_digest, b06, empty_codebook_fields_ref, xxh3_128,
};

pub(super) trait CheckpointSink {
    fn checkpoint_update(&mut self, bytes: &[u8]);
}

// Batch the many small row encodings into larger updates before they reach
// the fingerprint hasher, so per-call overhead cannot dominate (measured at
// +420 ms per WASM cold execute when 24-48 byte writes hit the hasher raw at
// the runtime crate's opt-level 2). This is not a second hash or a cache
// shortcut: the exact same protocol bytes reach the hasher.
pub(super) const CHECKPOINT_HASH_BUFFER_BYTES: usize = 16 * 1024;

pub(super) struct BufferedCheckpointHasher {
    pub(super) hasher: Xxh3,
    pub(super) pending: Vec<u8>,
}

impl BufferedCheckpointHasher {
    pub(super) fn new() -> Self {
        Self {
            hasher: Xxh3::new(),
            pending: Vec::with_capacity(CHECKPOINT_HASH_BUFFER_BYTES),
        }
    }

    #[inline]
    pub(super) fn update(&mut self, bytes: &[u8]) {
        self.checkpoint_update(bytes);
    }

    #[inline]
    pub(super) fn flush(&mut self) {
        if !self.pending.is_empty() {
            self.hasher.update(&self.pending);
            self.pending.clear();
        }
    }

    pub(super) fn finalize128(mut self) -> u128 {
        self.flush();
        self.hasher.digest128()
    }
}

impl CheckpointSink for BufferedCheckpointHasher {
    #[inline]
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        if bytes.len() >= CHECKPOINT_HASH_BUFFER_BYTES {
            self.flush();
            self.hasher.update(bytes);
            return;
        }
        if self.pending.len() + bytes.len() > CHECKPOINT_HASH_BUFFER_BYTES {
            self.flush();
        }
        self.pending.extend_from_slice(bytes);
    }
}

impl CheckpointSink for CheckpointHasher {
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        self.update(bytes);
    }
}

impl CheckpointSink for Xxh3 {
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        self.update(bytes);
    }
}

impl CheckpointSink for Vec<u8> {
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        self.extend_from_slice(bytes);
    }
}

/// Streaming serde→xxh3 sink for checkpoint value payloads. Every serde event
/// is framed with a tag byte (plus lengths where content follows) and fed to
/// the hasher through a small buffer, so a large step value is fingerprinted
/// without materializing an encoded copy (the serde_json path this replaced
/// inflated a 19 MB parse into 33.6 MB of text before hashing). Unlike
/// postcard, this supports `collect_str` (chrono) and unknown-length
/// sequences, and it never changes any type's persisted serialization.
pub(super) struct FingerprintSink {
    pub(super) hasher: Xxh3,
    pub(super) buffer: [u8; 4096],
    pub(super) len: usize,
}

impl FingerprintSink {
    pub(super) fn new() -> Self {
        Self {
            hasher: Xxh3::new(),
            buffer: [0_u8; 4096],
            len: 0,
        }
    }

    pub(super) fn write(&mut self, data: &[u8]) {
        if data.len() >= self.buffer.len() {
            self.flush();
            self.hasher.update(data);
        } else {
            if self.len + data.len() > self.buffer.len() {
                self.flush();
            }
            self.buffer[self.len..self.len + data.len()].copy_from_slice(data);
            self.len += data.len();
        }
    }

    pub(super) fn tag(&mut self, tag: u8) {
        if self.len == self.buffer.len() {
            self.flush();
        }
        self.buffer[self.len] = tag;
        self.len += 1;
    }

    pub(super) fn frame(&mut self, tag: u8, data: &[u8]) {
        self.tag(tag);
        self.write(&(data.len() as u64).to_le_bytes());
        self.write(data);
    }

    pub(super) fn flush(&mut self) {
        if self.len > 0 {
            self.hasher.update(&self.buffer[..self.len]);
            self.len = 0;
        }
    }

    pub(super) fn finish(mut self) -> u128 {
        self.flush();
        self.hasher.digest128()
    }
}

#[derive(Debug)]
pub(super) struct FingerprintError(pub(super) String);

impl std::fmt::Display for FingerprintError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for FingerprintError {}

impl serde::ser::Error for FingerprintError {
    fn custom<T: std::fmt::Display>(message: T) -> Self {
        Self(message.to_string())
    }
}

pub(super) struct FingerprintSerializer<'a> {
    pub(super) sink: &'a mut FingerprintSink,
}

impl FingerprintSerializer<'_> {
    pub(super) fn scalar(self, tag: u8, bytes: &[u8]) -> Result<(), FingerprintError> {
        self.sink.tag(tag);
        self.sink.write(bytes);
        Ok(())
    }
}

/// Compound serializer used for every seq/tuple/map/struct shape. Each
/// element is preceded by a 1 marker and the compound ends with a 0 marker,
/// so unknown-length sequences hash injectively without a length prefix.
pub(super) struct FingerprintCompound<'a> {
    pub(super) sink: &'a mut FingerprintSink,
}

impl FingerprintCompound<'_> {
    pub(super) fn element<T: serde::Serialize + ?Sized>(&mut self, value: &T) -> Result<(), FingerprintError> {
        self.sink.tag(1);
        value.serialize(FingerprintSerializer { sink: self.sink })
    }

    pub(super) fn finish(self) -> Result<(), FingerprintError> {
        self.sink.tag(0);
        Ok(())
    }
}

macro_rules! fingerprint_compound_impl {
    ($trait:path, $serialize:ident $(, $key:ident)?) => {
        impl $trait for FingerprintCompound<'_> {
            type Ok = ();
            type Error = FingerprintError;

            fn $serialize<T: serde::Serialize + ?Sized>(
                &mut self,
                value: &T,
            ) -> Result<(), FingerprintError> {
                self.element(value)
            }

            $(fn $key<T: serde::Serialize + ?Sized>(
                &mut self,
                key: &T,
            ) -> Result<(), FingerprintError> {
                self.element(key)
            })?

            fn end(self) -> Result<(), FingerprintError> {
                self.finish()
            }
        }
    };
}

fingerprint_compound_impl!(serde::ser::SerializeSeq, serialize_element);

fingerprint_compound_impl!(serde::ser::SerializeTuple, serialize_element);

fingerprint_compound_impl!(serde::ser::SerializeTupleStruct, serialize_field);

fingerprint_compound_impl!(serde::ser::SerializeTupleVariant, serialize_field);

fingerprint_compound_impl!(serde::ser::SerializeMap, serialize_value, serialize_key);

macro_rules! fingerprint_struct_impl {
    ($trait:path) => {
        impl $trait for FingerprintCompound<'_> {
            type Ok = ();
            type Error = FingerprintError;

            fn serialize_field<T: serde::Serialize + ?Sized>(
                &mut self,
                key: &'static str,
                value: &T,
            ) -> Result<(), FingerprintError> {
                self.sink.frame(1, key.as_bytes());
                value.serialize(FingerprintSerializer { sink: self.sink })
            }

            fn end(self) -> Result<(), FingerprintError> {
                self.finish()
            }
        }
    };
}

fingerprint_struct_impl!(serde::ser::SerializeStruct);

fingerprint_struct_impl!(serde::ser::SerializeStructVariant);

impl<'a> serde::Serializer for FingerprintSerializer<'a> {
    type Ok = ();
    type Error = FingerprintError;
    type SerializeSeq = FingerprintCompound<'a>;
    type SerializeTuple = FingerprintCompound<'a>;
    type SerializeTupleStruct = FingerprintCompound<'a>;
    type SerializeTupleVariant = FingerprintCompound<'a>;
    type SerializeMap = FingerprintCompound<'a>;
    type SerializeStruct = FingerprintCompound<'a>;
    type SerializeStructVariant = FingerprintCompound<'a>;

    fn serialize_bool(self, value: bool) -> Result<(), FingerprintError> {
        self.scalar(2, &[u8::from(value)])
    }

    fn serialize_i8(self, value: i8) -> Result<(), FingerprintError> {
        self.scalar(3, &value.to_le_bytes())
    }

    fn serialize_i16(self, value: i16) -> Result<(), FingerprintError> {
        self.scalar(4, &value.to_le_bytes())
    }

    fn serialize_i32(self, value: i32) -> Result<(), FingerprintError> {
        self.scalar(5, &value.to_le_bytes())
    }

    fn serialize_i64(self, value: i64) -> Result<(), FingerprintError> {
        self.scalar(6, &value.to_le_bytes())
    }

    fn serialize_i128(self, value: i128) -> Result<(), FingerprintError> {
        self.scalar(7, &value.to_le_bytes())
    }

    fn serialize_u8(self, value: u8) -> Result<(), FingerprintError> {
        self.scalar(8, &value.to_le_bytes())
    }

    fn serialize_u16(self, value: u16) -> Result<(), FingerprintError> {
        self.scalar(9, &value.to_le_bytes())
    }

    fn serialize_u32(self, value: u32) -> Result<(), FingerprintError> {
        self.scalar(10, &value.to_le_bytes())
    }

    fn serialize_u64(self, value: u64) -> Result<(), FingerprintError> {
        self.scalar(11, &value.to_le_bytes())
    }

    fn serialize_u128(self, value: u128) -> Result<(), FingerprintError> {
        self.scalar(12, &value.to_le_bytes())
    }

    fn serialize_f32(self, value: f32) -> Result<(), FingerprintError> {
        self.scalar(13, &value.to_bits().to_le_bytes())
    }

    fn serialize_f64(self, value: f64) -> Result<(), FingerprintError> {
        self.scalar(14, &value.to_bits().to_le_bytes())
    }

    fn serialize_char(self, value: char) -> Result<(), FingerprintError> {
        self.scalar(15, &(value as u32).to_le_bytes())
    }

    fn serialize_str(self, value: &str) -> Result<(), FingerprintError> {
        self.sink.frame(16, value.as_bytes());
        Ok(())
    }

    fn serialize_bytes(self, value: &[u8]) -> Result<(), FingerprintError> {
        self.sink.frame(17, value);
        Ok(())
    }

    fn serialize_none(self) -> Result<(), FingerprintError> {
        self.sink.tag(18);
        Ok(())
    }

    fn serialize_some<T: serde::Serialize + ?Sized>(
        self,
        value: &T,
    ) -> Result<(), FingerprintError> {
        self.sink.tag(19);
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<(), FingerprintError> {
        self.sink.tag(20);
        Ok(())
    }

    fn serialize_unit_struct(self, name: &'static str) -> Result<(), FingerprintError> {
        self.sink.frame(21, name.as_bytes());
        Ok(())
    }

    fn serialize_unit_variant(
        self,
        name: &'static str,
        variant_index: u32,
        _variant: &'static str,
    ) -> Result<(), FingerprintError> {
        self.sink.frame(22, name.as_bytes());
        self.sink.write(&variant_index.to_le_bytes());
        Ok(())
    }

    fn serialize_newtype_struct<T: serde::Serialize + ?Sized>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<(), FingerprintError> {
        self.sink.frame(23, name.as_bytes());
        value.serialize(self)
    }

    fn serialize_newtype_variant<T: serde::Serialize + ?Sized>(
        self,
        name: &'static str,
        variant_index: u32,
        _variant: &'static str,
        value: &T,
    ) -> Result<(), FingerprintError> {
        self.sink.frame(24, name.as_bytes());
        self.sink.write(&variant_index.to_le_bytes());
        value.serialize(self)
    }

    fn serialize_seq(
        self,
        _len: Option<usize>,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.tag(25);
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_tuple(self, _len: usize) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.tag(26);
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_tuple_struct(
        self,
        name: &'static str,
        _len: usize,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.frame(27, name.as_bytes());
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_tuple_variant(
        self,
        name: &'static str,
        variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.frame(28, name.as_bytes());
        self.sink.write(&variant_index.to_le_bytes());
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_map(
        self,
        _len: Option<usize>,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.tag(29);
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_struct(
        self,
        name: &'static str,
        _len: usize,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.frame(30, name.as_bytes());
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn serialize_struct_variant(
        self,
        name: &'static str,
        variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<FingerprintCompound<'a>, FingerprintError> {
        self.sink.frame(31, name.as_bytes());
        self.sink.write(&variant_index.to_le_bytes());
        Ok(FingerprintCompound { sink: self.sink })
    }

    fn collect_str<T: std::fmt::Display + ?Sized>(self, value: &T) -> Result<(), FingerprintError> {
        // chrono and friends serialize through Display. Format into a stack
        // buffer when it fits (timestamps always do), falling back to a heap
        // string only for oversized values.
        struct StackWriter {
            buffer: [u8; 64],
            len: usize,
            overflow: Option<String>,
        }
        impl std::fmt::Write for StackWriter {
            fn write_str(&mut self, text: &str) -> std::fmt::Result {
                if let Some(overflow) = &mut self.overflow {
                    overflow.push_str(text);
                } else if self.len + text.len() <= self.buffer.len() {
                    self.buffer[self.len..self.len + text.len()].copy_from_slice(text.as_bytes());
                    self.len += text.len();
                } else {
                    let mut overflow =
                        String::from(std::str::from_utf8(&self.buffer[..self.len]).unwrap());
                    overflow.push_str(text);
                    self.overflow = Some(overflow);
                }
                Ok(())
            }
        }
        let mut writer = StackWriter {
            buffer: [0_u8; 64],
            len: 0,
            overflow: None,
        };
        use std::fmt::Write as _;
        write!(writer, "{value}")
            .map_err(|error| FingerprintError(format!("collect_str fingerprint: {error}")))?;
        let bytes = writer
            .overflow
            .as_ref()
            .map_or(&writer.buffer[..writer.len], String::as_bytes);
        self.sink.frame(16, bytes);
        Ok(())
    }

    fn is_human_readable(&self) -> bool {
        // Match serde_json so types with dual representations (e.g. chrono)
        // keep hashing their human-readable form across the v6→v7 migration.
        true
    }
}

/// 128-bit fingerprint of a checkpoint value payload (serde events streamed
/// straight into xxh3-128). Used only for in-protocol component digests;
/// every durable boundary keeps its cryptographic digest.
pub(crate) fn value_fingerprint<T: serde::Serialize + ?Sized>(
    value: &T,
) -> Result<[u8; 16], String> {
    let mut sink = FingerprintSink::new();
    value
        .serialize(FingerprintSerializer { sink: &mut sink })
        .map_err(|error| format!("fingerprint checkpoint value: {error}"))?;
    Ok(sink.finish().to_le_bytes())
}

pub(super) struct DiscardCheckpointSink;

impl CheckpointSink for DiscardCheckpointSink {
    #[inline(always)]
    fn checkpoint_update(&mut self, _bytes: &[u8]) {}
}

pub(super) fn checkpoint_update(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(bytes);
}

pub(super) fn checkpoint_digest_field(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(&(bytes.len() as u64).to_le_bytes());
    sink.checkpoint_update(bytes);
}

pub(super) fn checkpoint_digest_fixed16(hasher: &mut impl CheckpointSink, value: &[u8; 16]) {
    let mut encoded = [0_u8; 24];
    encoded[..8].copy_from_slice(&16_u64.to_le_bytes());
    encoded[8..].copy_from_slice(value);
    hasher.checkpoint_update(&encoded);
}

pub(super) fn checkpoint_digest_positioned_fixed16(
    hasher: &mut impl CheckpointSink,
    position: usize,
    value: &[u8; 16],
) {
    let mut encoded = [0_u8; 32];
    encoded[..8].copy_from_slice(&(position as u64).to_le_bytes());
    encoded[8..16].copy_from_slice(&16_u64.to_le_bytes());
    encoded[16..].copy_from_slice(value);
    hasher.checkpoint_update(&encoded);
}

pub(super) fn checkpoint_digest_positioned_fixed16_triple(
    hasher: &mut impl CheckpointSink,
    position: usize,
    first: &[u8; 16],
    second: &[u8; 16],
    third: &[u8; 16],
) {
    let mut encoded = [0_u8; 80];
    encoded[..8].copy_from_slice(&(position as u64).to_le_bytes());
    encoded[8..16].copy_from_slice(&16_u64.to_le_bytes());
    encoded[16..32].copy_from_slice(first);
    encoded[32..40].copy_from_slice(&16_u64.to_le_bytes());
    encoded[40..56].copy_from_slice(second);
    encoded[56..64].copy_from_slice(&16_u64.to_le_bytes());
    encoded[64..].copy_from_slice(third);
    hasher.checkpoint_update(&encoded);
}

pub(super) fn checkpoint_digest_optional_string(sink: &mut impl CheckpointSink, value: Option<&str>) {
    match value {
        Some(value) => {
            sink.checkpoint_update(&[1]);
            checkpoint_digest_field(sink, value.as_bytes());
        }
        None => {
            sink.checkpoint_update(&[0]);
        }
    }
}

pub(super) fn checkpoint_digest_optional_i64(sink: &mut impl CheckpointSink, value: Option<i64>) {
    match value {
        Some(value) => {
            sink.checkpoint_update(&[1]);
            sink.checkpoint_update(&value.to_le_bytes());
        }
        None => {
            sink.checkpoint_update(&[0]);
        }
    }
}

pub(super) fn checkpoint_digest_optional_f64(sink: &mut impl CheckpointSink, value: Option<f64>) {
    match value {
        Some(value) => {
            sink.checkpoint_update(&[1]);
            sink.checkpoint_update(&value.to_bits().to_le_bytes());
        }
        None => {
            sink.checkpoint_update(&[0]);
        }
    }
}

pub(super) fn checkpoint_digest_optional_bool(sink: &mut impl CheckpointSink, value: Option<bool>) {
    match value {
        Some(value) => sink.checkpoint_update(&[1, u8::from(value)]),
        None => sink.checkpoint_update(&[0, 0]),
    }
}

pub(super) const WORKFLOW_CHECKPOINT_PROTOCOL: &str = "chronicle-workflow-checkpoint/v1";

pub(super) const WORKFLOW_ROW_SCHEMA: &str = concat!(
    "association:source_data_rows,index;",
    "membership:source_data_rows;",
    "order:index,position;",
    "temporal:event_timestamp_ns,timezone,data_time_gap_hours,date,day,weekday_mf,",
    "weekday_mth,weekday_su_th,hour,quarter,start_timestamp_ns,stop_timestamp_ns,",
    "duration_seconds,duration_minutes,raw_episode_start_timestamp_ns,",
    "raw_episode_stop_timestamp_ns,raw_episode_duration_ns,minimum_duration_qualified,",
    "minimum_duration_aggregate_eligible,minimum_duration_blank_applied,",
    "concurrent_subinterval_floor_blank_applied,minimum_duration_drop_pending,",
    "maximum_duration_qualified,maximum_duration_aggregate_eligible,",
    "maximum_duration_drop_pending,maximum_duration_trimmed_ns,effective_endpoint_reason,",
    "screen_usage_last_activity_timestamp_ns,",
    "screen_usage_tail_gap_seconds,valid_app_usage_time_gap_hours,",
    "any_app_usage_time_gap_hours;",
    "classification:study_id,participant_id,possible_device_model,username,",
    "application_label,interaction_type,app_package_name,screen_usage_end_reason,",
    "app_usage_end_reason,screen_interval_id,schoedel_completion,usage_session_id,",
    "screen_usage_end_reason_confidence,screen_usage_stop_event_type,",
    "screen_usage_foreground_app_package,screen_usage_app_observed,screen_usage_apps_forcing_screen_open_label,",
    "screen_usage_lock_screen_only,any_app_usage_flags,valid_app_new_engage_30s,",
    "valid_app_new_engage_custom,valid_app_switched_app,any_app_new_engage_30s,",
    "any_app_new_engage_custom,any_app_switched_app,genre_id_scraped,",
    "broad_app_category,codebook_fields,usage_layer"
);

pub(super) fn checkpoint_hasher(component: &str) -> BufferedCheckpointHasher {
    let mut hasher = BufferedCheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, WORKFLOW_CHECKPOINT_PROTOCOL.as_bytes());
    checkpoint_digest_field(&mut hasher, component.as_bytes());
    hasher
}

pub(super) fn finish_checkpoint_digest(hasher: BufferedCheckpointHasher) -> String {
    format!("xxh3:{:032x}", hasher.finalize128())
}

pub(super) fn terminal_checkpoint_digest(node_id: &str, component_digests: [&str; 6]) -> String {
    let mut terminal = Sha256::new();
    sha256_digest_field(&mut terminal, WORKFLOW_CHECKPOINT_PROTOCOL.as_bytes());
    sha256_digest_field(&mut terminal, node_id.as_bytes());
    sha256_digest_field(&mut terminal, b"terminal");
    for digest in component_digests {
        sha256_digest_field(&mut terminal, digest.as_bytes());
    }
    format!("sha256:{}", hex::encode(terminal.finalize()))
}

pub(super) fn valid_workflow_checkpoint_component_digest(value: &str) -> bool {
    value.len() == 37
        && value.starts_with("xxh3:")
        && value[5..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Validate one serialized workflow checkpoint against an independently
/// supplied compiled query identity and return its exact terminal commitment.
///
/// Consumers outside the kernel must not reproduce the terminal hash formula:
/// this function deliberately delegates to the same private implementation
/// used by checkpoint production.
pub fn validate_workflow_checkpoint_for_subject(
    checkpoint: &WorkflowCheckpoint,
    expected_subject_id: &str,
) -> Result<String, String> {
    if expected_subject_id.trim().is_empty()
        || checkpoint.protocol_version != WORKFLOW_CHECKPOINT_PROTOCOL
    {
        return Err("workflow_checkpoint_validation_error:protocol_or_subject".into());
    }
    if checkpoint.subject_id != expected_subject_id {
        return Err("workflow_checkpoint_validation_error:subject".into());
    }
    let component_digests = [
        checkpoint.row_membership_digest.as_str(),
        checkpoint.row_order_digest.as_str(),
        checkpoint.temporal_state_digest.as_str(),
        checkpoint.classification_digest.as_str(),
        checkpoint.payload_digest.as_str(),
        checkpoint.schema_digest.as_str(),
    ];
    if component_digests
        .iter()
        .any(|digest| !valid_workflow_checkpoint_component_digest(digest))
    {
        return Err("workflow_checkpoint_validation_error:component_digest".into());
    }
    let terminal = terminal_checkpoint_digest(expected_subject_id, component_digests);
    if checkpoint.terminal_digest != terminal {
        return Err("workflow_checkpoint_validation_error:terminal_digest".into());
    }
    Ok(terminal)
}

pub(super) fn sha256_digest_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct RowCheckpointParts {
    pub(super) identity: [u8; 16],
    pub(super) temporal: [u8; 16],
    pub(super) classification: [u8; 16],
}

pub(super) struct RowCheckpointScratch {
    pub(super) identity: Vec<u8>,
    pub(super) temporal: Vec<u8>,
    pub(super) classification: Vec<u8>,
}

impl Default for RowCheckpointScratch {
    fn default() -> Self {
        Self {
            identity: Vec::with_capacity(256),
            temporal: Vec::with_capacity(192),
            classification: Vec::with_capacity(512),
        }
    }
}

#[deny(unused_variables)]
pub(super) fn encode_row_checkpoint_parts<I: CheckpointSink, T: CheckpointSink, C: CheckpointSink>(
    row: &Row,
    identity: &mut I,
    temporal: &mut T,
    classification: &mut C,
) {
    // Every field is deliberately bound and hashed. Adding a Row field makes
    // this exhaustive pattern fail; binding one without hashing it makes the
    // deny(unused_variables) lint fail.
    let RowData {
        source_data_rows,
        lineage_searches,
        study_id,
        participant_id,
        possible_device_model,
        username,
        application_label,
        interaction_type,
        app_package_name,
        event_timestamp_ns,
        timezone,
        data_time_gap_hours,
        date,
        day,
        weekday_mf,
        weekday_mth,
        weekday_su_th,
        hour,
        quarter,
        start_timestamp_ns,
        stop_timestamp_ns,
        duration_seconds,
        duration_minutes,
        raw_episode_start_timestamp_ns,
        raw_episode_stop_timestamp_ns,
        raw_episode_duration_ns,
        micro_use_classification,
        minimum_duration_qualified,
        minimum_duration_aggregate_eligible,
        minimum_duration_blank_applied,
        concurrent_subinterval_floor_blank_applied,
        minimum_duration_drop_pending,
        maximum_duration_qualified,
        maximum_duration_aggregate_eligible,
        maximum_duration_drop_pending,
        maximum_duration_trimmed_ns,
        effective_endpoint_reason,
        screen_usage_end_reason,
        app_usage_end_reason,
        screen_interval_id,
        schoedel_completion,
        usage_session_id,
        screen_usage_end_reason_confidence,
        screen_usage_stop_event_type,
        screen_usage_last_activity_timestamp_ns,
        screen_usage_tail_gap_seconds,
        screen_usage_foreground_app_package,
        screen_usage_app_observed,
        screen_usage_session_classification,
        screen_usage_apps_forcing_screen_open_label,
        screen_usage_lock_screen_only,
        any_app_usage_flags,
        valid_app_new_engage_30s,
        valid_app_new_engage_custom,
        valid_app_switched_app,
        valid_app_usage_time_gap_hours,
        any_app_new_engage_30s,
        any_app_new_engage_custom,
        any_app_switched_app,
        any_app_usage_time_gap_hours,
        genre_id_scraped,
        broad_app_category,
        codebook_fields,
        codebook_genre_fields_cleared,
        index,
        usage_layer,
    } = &row.0.data;

    checkpoint_digest_field(identity, b"chronicle-row-identity/v3");
    let source_ranges = source_data_rows.ranges();
    let mut source_shape = [0_u8; 16];
    source_shape[..8].copy_from_slice(&(source_data_rows.len() as u64).to_le_bytes());
    source_shape[8..].copy_from_slice(&(source_ranges.len() as u64).to_le_bytes());
    checkpoint_update(identity, &source_shape);
    for source_range in source_ranges {
        let mut encoded_range = [0_u8; 8];
        encoded_range[..4].copy_from_slice(&source_range.first.to_le_bytes());
        encoded_range[4..].copy_from_slice(&source_range.last.to_le_bytes());
        checkpoint_update(identity, &encoded_range);
    }
    checkpoint_update(identity, &(lineage_searches.len() as u64).to_le_bytes());
    for search in lineage_searches.iter() {
        checkpoint_digest_field(identity, search.protocol_version.as_bytes());
        checkpoint_digest_field(identity, search.reason.as_bytes());
        checkpoint_digest_field(identity, search.index_space.as_bytes());
        checkpoint_digest_field(identity, search.start_participant_id.as_bytes());
        checkpoint_update(identity, &search.start_event_index.to_le_bytes());
        checkpoint_update(identity, &search.end_event_index_exclusive.to_le_bytes());
        checkpoint_update(identity, &search.candidate_event_count.to_le_bytes());
        checkpoint_digest_field(identity, &search.candidate_chain_digest.encoded());
    }
    checkpoint_update(identity, &(*index as u64).to_le_bytes());

    checkpoint_digest_field(temporal, b"chronicle-row-temporal/v3");
    checkpoint_update(temporal, &event_timestamp_ns.to_le_bytes());
    checkpoint_digest_field(temporal, timezone.as_bytes());
    checkpoint_update(temporal, &data_time_gap_hours.to_bits().to_le_bytes());
    checkpoint_digest_field(temporal, date.as_bytes());
    checkpoint_update(
        temporal,
        &[
            *day,
            *weekday_mf,
            *weekday_mth,
            *weekday_su_th,
            *hour,
            *quarter,
        ],
    );
    checkpoint_digest_optional_i64(temporal, *start_timestamp_ns);
    checkpoint_digest_optional_i64(temporal, *stop_timestamp_ns);
    checkpoint_digest_optional_f64(temporal, *duration_seconds);
    checkpoint_digest_optional_f64(temporal, *duration_minutes);
    checkpoint_digest_optional_i64(temporal, *raw_episode_start_timestamp_ns);
    checkpoint_digest_optional_i64(temporal, *raw_episode_stop_timestamp_ns);
    checkpoint_digest_optional_i64(temporal, *raw_episode_duration_ns);
    checkpoint_digest_optional_bool(temporal, *minimum_duration_qualified);
    checkpoint_update(
        temporal,
        &[
            u8::from(*minimum_duration_aggregate_eligible),
            u8::from(*minimum_duration_blank_applied),
            u8::from(*concurrent_subinterval_floor_blank_applied),
            u8::from(*minimum_duration_drop_pending),
        ],
    );
    checkpoint_digest_optional_bool(temporal, *maximum_duration_qualified);
    checkpoint_update(
        temporal,
        &[
            u8::from(*maximum_duration_aggregate_eligible),
            u8::from(*maximum_duration_drop_pending),
        ],
    );
    checkpoint_digest_optional_i64(temporal, *maximum_duration_trimmed_ns);
    checkpoint_update(
        temporal,
        &[match effective_endpoint_reason {
            None => 0,
            Some(b06::MaximumDurationEffectiveEndpointReason::MaximumDurationTruncationBoundary) => 1,
        }],
    );
    checkpoint_digest_optional_i64(temporal, *screen_usage_last_activity_timestamp_ns);
    checkpoint_digest_optional_f64(temporal, *screen_usage_tail_gap_seconds);
    checkpoint_update(
        temporal,
        &valid_app_usage_time_gap_hours.to_bits().to_le_bytes(),
    );
    checkpoint_update(
        temporal,
        &any_app_usage_time_gap_hours.to_bits().to_le_bytes(),
    );

    checkpoint_digest_field(classification, b"chronicle-row-classification/v3");
    for value in [
        study_id.as_str(),
        participant_id.as_str(),
        possible_device_model.as_str(),
        username.as_str(),
        application_label.as_str(),
        interaction_type.as_str(),
        app_package_name.as_str(),
        any_app_usage_flags.as_str(),
    ] {
        checkpoint_digest_field(classification, value.as_bytes());
    }
    checkpoint_digest_optional_string(classification, screen_usage_end_reason.as_deref());
    checkpoint_digest_optional_string(classification, app_usage_end_reason.as_deref());
    if let Some(screen_interval_id) = screen_interval_id {
        if interaction_type.as_str() == SCREEN_USAGE {
            checkpoint_digest_field(classification, b"chronicle-screen-interval-provenance/v1");
            checkpoint_digest_field(classification, screen_interval_id.as_bytes());
        } else {
            checkpoint_digest_field(classification, b"chronicle-schoedel-provenance/v1");
            checkpoint_digest_field(classification, screen_interval_id.as_bytes());
            checkpoint_digest_field(
                classification,
                schoedel_completion
                    .expect("a Schoedel interval id carries completion provenance")
                    .canonical_id()
                    .as_bytes(),
            );
        }
    }
    checkpoint_digest_optional_i64(classification, *usage_session_id);
    checkpoint_digest_optional_f64(classification, *screen_usage_end_reason_confidence);
    checkpoint_digest_optional_string(classification, screen_usage_stop_event_type.as_deref());
    checkpoint_digest_optional_string(
        classification,
        screen_usage_foreground_app_package.as_deref(),
    );
    checkpoint_digest_optional_string(
        classification,
        screen_usage_apps_forcing_screen_open_label.as_deref(),
    );
    match screen_usage_lock_screen_only {
        Some(value) => {
            checkpoint_update(classification, &[1, *value]);
        }
        None => {
            checkpoint_update(classification, &[0, 0]);
        }
    }
    for value in [
        valid_app_new_engage_30s,
        valid_app_new_engage_custom,
        valid_app_switched_app,
        any_app_new_engage_30s,
        any_app_new_engage_custom,
        any_app_switched_app,
    ] {
        checkpoint_update(classification, &value.to_le_bytes());
    }
    checkpoint_digest_optional_string(classification, genre_id_scraped.as_deref());
    checkpoint_digest_optional_string(classification, broad_app_category.as_deref());
    if Arc::ptr_eq(codebook_fields, empty_codebook_fields_ref()) {
        // The overwhelmingly common no-codebook case has a fixed exact
        // encoding: the u64 sequence length followed by one zero tag per
        // absent field. Append it as one block instead of one write per field.
        let mut encoded = [0_u8; 8 + CODEBOOK_RENAME_PAIRS.len()];
        encoded[..8].copy_from_slice(&(CODEBOOK_RENAME_PAIRS.len() as u64).to_le_bytes());
        checkpoint_update(classification, &encoded);
    } else {
        checkpoint_update(
            classification,
            &(codebook_fields.len() as u64).to_le_bytes(),
        );
        for (field_index, value) in codebook_fields.iter().enumerate() {
            let value = if *codebook_genre_fields_cleared
                && COLLAPSED_GENRE_FIELD_INDICES.contains(&field_index)
            {
                None
            } else {
                value.as_deref()
            };
            checkpoint_digest_optional_string(classification, value);
        }
    }
    checkpoint_digest_optional_string(classification, usage_layer.as_deref());
    // The optional B03 label belongs to classification. B04 evidence is
    // committed above with the temporal projection because every B04 writer
    // invalidates that checkpoint component.
    if let Some(value) = micro_use_classification {
        checkpoint_digest_field(classification, b"chronicle-b03-classification/v1");
        checkpoint_digest_field(classification, value.canonical_id().as_bytes());
    }
    if let Some(value) = screen_usage_session_classification {
        checkpoint_digest_field(
            classification,
            b"chronicle-screen-session-classification/v1",
        );
        checkpoint_digest_field(classification, value.as_bytes());
    }
    if let Some(value) = screen_usage_app_observed {
        checkpoint_digest_field(classification, b"chronicle-screen-app-observation/v1");
        checkpoint_update(classification, &[u8::from(*value)]);
    }
}

impl RowCheckpointScratch {
    pub(super) fn compute_parts(&mut self, row: &Row) -> RowCheckpointParts {
        let cache = &row.0.checkpoint_parts;
        let missing_identity = cache.identity.get().is_none();
        let missing_temporal = cache.temporal.get().is_none();
        let missing_classification = cache.classification.get().is_none();
        if !missing_identity && !missing_temporal && !missing_classification {
            return RowCheckpointParts {
                identity: *cache.identity.get().expect("checked identity checkpoint"),
                temporal: *cache.temporal.get().expect("checked temporal checkpoint"),
                classification: *cache
                    .classification
                    .get()
                    .expect("checked classification checkpoint"),
            };
        }

        self.identity.clear();
        self.temporal.clear();
        self.classification.clear();
        let mut discard_identity = DiscardCheckpointSink;
        let mut discard_temporal = DiscardCheckpointSink;
        let mut discard_classification = DiscardCheckpointSink;
        match (missing_identity, missing_temporal, missing_classification) {
            (true, true, true) => encode_row_checkpoint_parts(
                row,
                &mut self.identity,
                &mut self.temporal,
                &mut self.classification,
            ),
            (true, true, false) => encode_row_checkpoint_parts(
                row,
                &mut self.identity,
                &mut self.temporal,
                &mut discard_classification,
            ),
            (true, false, true) => encode_row_checkpoint_parts(
                row,
                &mut self.identity,
                &mut discard_temporal,
                &mut self.classification,
            ),
            (false, true, true) => encode_row_checkpoint_parts(
                row,
                &mut discard_identity,
                &mut self.temporal,
                &mut self.classification,
            ),
            (true, false, false) => encode_row_checkpoint_parts(
                row,
                &mut self.identity,
                &mut discard_temporal,
                &mut discard_classification,
            ),
            (false, true, false) => encode_row_checkpoint_parts(
                row,
                &mut discard_identity,
                &mut self.temporal,
                &mut discard_classification,
            ),
            (false, false, true) => encode_row_checkpoint_parts(
                row,
                &mut discard_identity,
                &mut discard_temporal,
                &mut self.classification,
            ),
            (false, false, false) => unreachable!("handled above"),
        }

        let identity = missing_identity.then(|| xxh3_128(&self.identity).to_le_bytes());
        let temporal = missing_temporal.then(|| xxh3_128(&self.temporal).to_le_bytes());
        let classification =
            missing_classification.then(|| xxh3_128(&self.classification).to_le_bytes());
        RowCheckpointParts {
            identity: *cache
                .identity
                .get_or_init(|| identity.expect("identity computed")),
            temporal: *cache
                .temporal
                .get_or_init(|| temporal.expect("temporal computed")),
            classification: *cache
                .classification
                .get_or_init(|| classification.expect("classification computed")),
        }
    }
}

pub(super) fn row_checkpoint_parts(row: &Row, scratch: &mut RowCheckpointScratch) -> RowCheckpointParts {
    scratch.compute_parts(row)
}

pub(super) fn row_checkpoint_parts_for_rows(rows: &[Row]) -> Vec<RowCheckpointParts> {
    #[cfg(feature = "query-timing")]
    {
        let missing_identity = rows
            .iter()
            .filter(|row| row.0.checkpoint_parts.identity.get().is_none())
            .count();
        let missing_temporal = rows
            .iter()
            .filter(|row| row.0.checkpoint_parts.temporal.get().is_none())
            .count();
        let missing_classification = rows
            .iter()
            .filter(|row| row.0.checkpoint_parts.classification.get().is_none())
            .count();
        eprintln!(
            "checkpoint_cache rows={} missing_identity={} missing_temporal={} missing_classification={}",
            rows.len(), missing_identity, missing_temporal, missing_classification
        );
    }
    let mut scratch = RowCheckpointScratch::default();
    rows.iter()
        .map(|row| row_checkpoint_parts(row, &mut scratch))
        .collect()
}

pub(super) fn row_parts_sequence_digest<'a>(
    part_count: usize,
    parts: impl Iterator<Item = &'a RowCheckpointParts>,
) -> String {
    let mut hasher = Xxh3::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-row-reference-sequence/v1");
    hasher.update(&(part_count as u64).to_le_bytes());
    let mut observed = 0_usize;
    for (position, parts) in parts.enumerate() {
        checkpoint_digest_positioned_fixed16_triple(
            &mut hasher,
            position,
            &parts.identity,
            &parts.temporal,
            &parts.classification,
        );
        observed += 1;
    }
    assert_eq!(observed, part_count, "row-part sequence count drift");
    format!("xxh3:{:032x}", hasher.digest128())
}

pub(super) fn row_reference_sequence_digest(rows: &[&Row]) -> String {
    let mut scratch = RowCheckpointScratch::default();
    let parts = rows
        .iter()
        .map(|row| row_checkpoint_parts(row, &mut scratch))
        .collect::<Vec<_>>();
    row_parts_sequence_digest(parts.len(), parts.iter())
}

pub(super) fn workflow_checkpoint(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
) -> WorkflowCheckpoint {
    workflow_checkpoint_with_parts(node_id, row_groups, payloads, None)
}

#[cfg(feature = "incremental-v2")]
pub(super) fn workflow_output_checkpoint(
    node_id: &str,
    outputs: &[(&str, &crate::payload_store::PayloadBytes)],
) -> Result<WorkflowCheckpoint, String> {
    let mut checkpoint = workflow_checkpoint(node_id, &[], &[]);
    let mut payload = checkpoint_hasher("payload");
    let mut schema = checkpoint_hasher("schema");
    checkpoint_digest_field(&mut schema, WORKFLOW_ROW_SCHEMA.as_bytes());
    schema.update(&0_u64.to_le_bytes());
    payload.update(&(outputs.len() as u64).to_le_bytes());
    schema.update(&(outputs.len() as u64).to_le_bytes());
    for (label, bytes) in outputs {
        checkpoint_digest_field(&mut payload, label.as_bytes());
        payload.update(&(bytes.len() as u64).to_le_bytes());
        bytes.for_each_chunk(|chunk| { payload.update(chunk); })?;
        checkpoint_digest_field(&mut schema, label.as_bytes());
    }
    checkpoint.payload_digest = finish_checkpoint_digest(payload);
    checkpoint.schema_digest = finish_checkpoint_digest(schema);
    checkpoint.terminal_digest = terminal_checkpoint_digest(node_id, [
        &checkpoint.row_membership_digest, &checkpoint.row_order_digest,
        &checkpoint.temporal_state_digest, &checkpoint.classification_digest,
        &checkpoint.payload_digest, &checkpoint.schema_digest,
    ]);
    Ok(checkpoint)
}

pub(super) fn workflow_checkpoint_with_parts(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
    single_group_parts: Option<&[RowCheckpointParts]>,
) -> WorkflowCheckpoint {
    if let Some(parts) = single_group_parts {
        let group_parts = [parts];
        workflow_checkpoint_with_group_parts(
            node_id,
            row_groups,
            payloads,
            Some(&group_parts),
            None,
            None,
        )
    } else {
        workflow_checkpoint_with_group_parts(node_id, row_groups, payloads, None, None, None)
    }
}

pub(super) fn workflow_rows_checkpoint_with_parts_and_canonical_order(
    node_id: &str,
    rows: &[Row],
    parts: &[RowCheckpointParts],
    canonical_order: &[usize],
) -> WorkflowCheckpoint {
    let group_parts = [parts];
    workflow_checkpoint_with_group_parts(
        node_id,
        &[("rows", rows)],
        &[],
        Some(&group_parts),
        None,
        Some(canonical_order),
    )
}

pub(super) fn workflow_checkpoint_with_reusable_parts(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    parts: &[RowCheckpointParts],
    previous_parts: &[RowCheckpointParts],
    previous_checkpoint: &WorkflowCheckpoint,
) -> WorkflowCheckpoint {
    let group_parts = [parts];
    workflow_checkpoint_with_group_parts(
        node_id,
        &[("rows", rows)],
        payloads,
        Some(&group_parts),
        Some(PreviousRowState {
            checkpoint: previous_checkpoint,
            reusable_components: reusable_row_components_from_parts(parts, previous_parts),
        }),
        None,
    )
}

pub(super) fn workflow_checkpoint_with_reusable_rows(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    parts: &[RowCheckpointParts],
    previous_rows: &[Row],
    previous_checkpoint: &WorkflowCheckpoint,
) -> WorkflowCheckpoint {
    let group_parts = [parts];
    workflow_checkpoint_with_group_parts(
        node_id,
        &[("rows", rows)],
        payloads,
        Some(&group_parts),
        Some(PreviousRowState {
            checkpoint: previous_checkpoint,
            reusable_components: reusable_row_components_from_rows(parts, previous_rows),
        }),
        None,
    )
}

pub(super) fn workflow_checkpoint_with_known_membership_and_order(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    previous_rows: &[Row],
    previous_checkpoint: &WorkflowCheckpoint,
) -> WorkflowCheckpoint {
    debug_assert_eq!(rows.len(), previous_rows.len());
    #[cfg(debug_assertions)]
    {
        let mut current_scratch = RowCheckpointScratch::default();
        let mut previous_scratch = RowCheckpointScratch::default();
        for (current, previous) in rows.iter().zip(previous_rows) {
            debug_assert_eq!(
                row_checkpoint_parts(current, &mut current_scratch).identity,
                row_checkpoint_parts(previous, &mut previous_scratch).identity,
            );
        }
    }
    workflow_checkpoint_with_group_parts(
        node_id,
        &[("rows", rows)],
        payloads,
        None,
        Some(PreviousRowState {
            checkpoint: previous_checkpoint,
            reusable_components: (true, true, false, false),
        }),
        None,
    )
}

#[derive(Clone, Copy)]
pub(super) struct PreviousRowState<'a> {
    pub(super) checkpoint: &'a WorkflowCheckpoint,
    pub(super) reusable_components: (bool, bool, bool, bool),
}

pub(super) fn reusable_row_components_from_parts(
    current: &[RowCheckpointParts],
    previous: &[RowCheckpointParts],
) -> (bool, bool, bool, bool) {
    let same_identity = current.len() == previous.len()
        && current
            .iter()
            .zip(previous)
            .all(|(left, right)| left.identity == right.identity);
    let same_temporal = same_identity
        && current
            .iter()
            .zip(previous)
            .all(|(left, right)| left.temporal == right.temporal);
    let same_classification = same_identity
        && current
            .iter()
            .zip(previous)
            .all(|(left, right)| left.classification == right.classification);
    (
        same_identity,
        same_identity,
        same_temporal,
        same_classification,
    )
}

pub(super) fn reusable_row_components_from_rows(
    current: &[RowCheckpointParts],
    previous: &[Row],
) -> (bool, bool, bool, bool) {
    if current.len() != previous.len() {
        return (false, false, false, false);
    }
    let mut previous_scratch = RowCheckpointScratch::default();
    let mut same_temporal = true;
    let mut same_classification = true;
    for (current, previous) in current.iter().zip(previous) {
        let previous = row_checkpoint_parts(previous, &mut previous_scratch);
        if current.identity != previous.identity {
            return (false, false, false, false);
        }
        same_temporal &= current.temporal == previous.temporal;
        same_classification &= current.classification == previous.classification;
    }
    (true, true, same_temporal, same_classification)
}

pub(super) fn workflow_checkpoint_with_group_parts(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
    group_parts: Option<&[&[RowCheckpointParts]]>,
    previous_row_state: Option<PreviousRowState<'_>>,
    single_group_canonical_order: Option<&[usize]>,
) -> WorkflowCheckpoint {
    debug_assert!(
        single_group_canonical_order.is_none() || row_groups.len() == 1,
        "a supplied canonical order is valid only for one row group"
    );
    let (reuse_membership, reuse_order, reuse_temporal, reuse_classification) =
        match previous_row_state {
            Some(previous) => {
                debug_assert_eq!(
                    previous.checkpoint.protocol_version,
                    WORKFLOW_CHECKPOINT_PROTOCOL
                );
                previous.reusable_components
            }
            None => (false, false, false, false),
        };
    #[cfg(feature = "query-timing")]
    let checkpoint_started = std::time::Instant::now();
    let mut membership = checkpoint_hasher("row-membership");
    let mut order = checkpoint_hasher("row-order");
    let mut temporal = checkpoint_hasher("temporal-state");
    let mut classification = checkpoint_hasher("classification");
    let mut payload = checkpoint_hasher("payload");
    let mut schema = checkpoint_hasher("schema");
    checkpoint_digest_field(&mut schema, WORKFLOW_ROW_SCHEMA.as_bytes());
    for hasher in [
        &mut membership,
        &mut order,
        &mut temporal,
        &mut classification,
    ] {
        hasher.update(&(row_groups.len() as u64).to_le_bytes());
    }
    schema.update(&(row_groups.len() as u64).to_le_bytes());
    for (group_index, (label, rows)) in row_groups.iter().enumerate() {
        for hasher in [
            &mut membership,
            &mut order,
            &mut temporal,
            &mut classification,
        ] {
            checkpoint_digest_field(hasher, label.as_bytes());
            hasher.update(&(rows.len() as u64).to_le_bytes());
        }
        checkpoint_digest_field(&mut schema, label.as_bytes());
        // Membership and row-associated semantic components are canonicalized
        // by stable source identity. A temporal edit may change sequence order,
        // but it must not falsely report a membership or classification edit.
        // Calculate the three row commitments once. When source identities
        // are already canonical, feed each row directly to every commitment
        // instead of allocating a 96-byte parts array for the whole table.
        let canonical_components_needed =
            !reuse_membership || !reuse_temporal || !reuse_classification;
        let supplied_canonical_order = (group_index == 0)
            .then_some(single_group_canonical_order)
            .flatten();
        let identity_is_already_sorted = supplied_canonical_order.is_none()
            && (!canonical_components_needed
                || rows.windows(2).all(|pair| {
                    pair[0]
                        .source_data_rows
                        .cmp_expanded(&pair[1].source_data_rows)
                        .then(pair[0].index.cmp(&pair[1].index))
                        .is_le()
                }));
        let mut record_canonical_parts = |parts: &RowCheckpointParts| {
            if !reuse_membership {
                checkpoint_digest_fixed16(&mut membership, &parts.identity);
            }
            // v5: temporal/classification commit their parts alone. The row
            // identity sequence is already committed by the membership digest
            // in the SAME canonical order, and the terminal digest binds all
            // components, so the (identity, part) association is positional —
            // repeating the 32-byte identity here only doubled hashed bytes.
            if !reuse_temporal {
                checkpoint_digest_fixed16(&mut temporal, &parts.temporal);
            }
            if !reuse_classification {
                checkpoint_digest_fixed16(&mut classification, &parts.classification);
            }
        };
        if let Some(row_parts) = group_parts.and_then(|parts| parts.get(group_index)) {
            assert_eq!(
                row_parts.len(),
                rows.len(),
                "checkpoint row-part count drift"
            );
            #[cfg(debug_assertions)]
            {
                let fresh = row_checkpoint_parts_for_rows(rows);
                assert_eq!(
                    *row_parts, fresh,
                    "attempted to reuse stale row checkpoint parts for {node_id}"
                );
            }
            if canonical_components_needed {
                if let Some(identity_order) = supplied_canonical_order {
                    debug_assert_eq!(identity_order.len(), rows.len());
                    #[cfg(debug_assertions)]
                    {
                        let mut observed = vec![false; rows.len()];
                        for (position, &row_index) in identity_order.iter().enumerate() {
                            debug_assert!(row_index < rows.len());
                            debug_assert!(!observed[row_index]);
                            observed[row_index] = true;
                            if let Some(&next_index) = identity_order.get(position + 1) {
                                debug_assert!(rows[row_index]
                                    .source_data_rows
                                    .cmp_expanded(&rows[next_index].source_data_rows)
                                    .then(rows[row_index].index.cmp(&rows[next_index].index))
                                    .is_le());
                            }
                        }
                    }
                    for &row_index in identity_order {
                        record_canonical_parts(&row_parts[row_index]);
                    }
                } else if identity_is_already_sorted {
                    for parts in *row_parts {
                        record_canonical_parts(parts);
                    }
                } else {
                    let mut identity_order: Vec<usize> = (0..rows.len()).collect();
                    identity_order.sort_unstable_by(|left, right| {
                        rows[*left]
                            .source_data_rows
                            .cmp_expanded(&rows[*right].source_data_rows)
                            .then(rows[*left].index.cmp(&rows[*right].index))
                            .then(left.cmp(right))
                    });
                    for row_index in identity_order {
                        record_canonical_parts(&row_parts[row_index]);
                    }
                }
            }
            if !reuse_order {
                for (position, parts) in row_parts.iter().enumerate() {
                    checkpoint_digest_positioned_fixed16(&mut order, position, &parts.identity);
                }
            }
        } else if identity_is_already_sorted {
            let mut scratch = RowCheckpointScratch::default();
            for (position, row) in rows.iter().enumerate() {
                let parts = row_checkpoint_parts(row, &mut scratch);
                if canonical_components_needed {
                    record_canonical_parts(&parts);
                }
                if !reuse_order {
                    checkpoint_digest_positioned_fixed16(&mut order, position, &parts.identity);
                }
            }
        } else {
            let mut scratch = RowCheckpointScratch::default();
            if canonical_components_needed {
                let mut identity_order: Vec<usize> = (0..rows.len()).collect();
                identity_order.sort_unstable_by(|left, right| {
                    rows[*left]
                        .source_data_rows
                        .cmp_expanded(&rows[*right].source_data_rows)
                        .then(rows[*left].index.cmp(&rows[*right].index))
                        .then(left.cmp(right))
                });
                for row_index in identity_order {
                    let parts = row_checkpoint_parts(&rows[row_index], &mut scratch);
                    record_canonical_parts(&parts);
                }
            }
            if !reuse_order {
                for (position, row) in rows.iter().enumerate() {
                    let parts = row_checkpoint_parts(row, &mut scratch);
                    checkpoint_digest_positioned_fixed16(&mut order, position, &parts.identity);
                }
            }
        }
    }
    payload.update(&(payloads.len() as u64).to_le_bytes());
    schema.update(&(payloads.len() as u64).to_le_bytes());
    for (label, bytes) in payloads {
        checkpoint_digest_field(&mut payload, label.as_bytes());
        checkpoint_digest_field(&mut payload, bytes);
        checkpoint_digest_field(&mut schema, label.as_bytes());
    }
    let previous_checkpoint = previous_row_state.map(|previous| previous.checkpoint);
    let row_membership_digest = if reuse_membership {
        previous_checkpoint
            .expect("reuse requires a previous checkpoint")
            .row_membership_digest
            .clone()
    } else {
        finish_checkpoint_digest(membership)
    };
    let row_order_digest = if reuse_order {
        previous_checkpoint
            .expect("reuse requires a previous checkpoint")
            .row_order_digest
            .clone()
    } else {
        finish_checkpoint_digest(order)
    };
    let temporal_state_digest = if reuse_temporal {
        previous_checkpoint
            .expect("reuse requires a previous checkpoint")
            .temporal_state_digest
            .clone()
    } else {
        finish_checkpoint_digest(temporal)
    };
    let classification_digest = if reuse_classification {
        previous_checkpoint
            .expect("reuse requires a previous checkpoint")
            .classification_digest
            .clone()
    } else {
        finish_checkpoint_digest(classification)
    };
    let payload_digest = finish_checkpoint_digest(payload);
    let schema_digest = finish_checkpoint_digest(schema);
    #[cfg(feature = "query-timing")]
    eprintln!(
        "checkpoint_reuse node={node_id} rows={} membership={reuse_membership} order={reuse_order} temporal={reuse_temporal} classification={reuse_classification} elapsed_ms={:.3}",
        row_groups.iter().map(|(_, rows)| rows.len()).sum::<usize>(),
        checkpoint_started.elapsed().as_secs_f64() * 1000.0
    );
    let terminal_digest = terminal_checkpoint_digest(
        node_id,
        [
            &row_membership_digest,
            &row_order_digest,
            &temporal_state_digest,
            &classification_digest,
            &payload_digest,
            &schema_digest,
        ],
    );
    WorkflowCheckpoint {
        protocol_version: WORKFLOW_CHECKPOINT_PROTOCOL.into(),
        subject_id: node_id.into(),
        row_membership_digest,
        row_order_digest,
        temporal_state_digest,
        classification_digest,
        payload_digest,
        schema_digest,
        terminal_digest,
    }
}

pub(super) fn checkpoint_for_exact_row_state(
    node_id: &str,
    previous: &WorkflowCheckpoint,
    payloads: &[(&str, &[u8])],
) -> WorkflowCheckpoint {
    debug_assert_eq!(previous.protocol_version, WORKFLOW_CHECKPOINT_PROTOCOL);
    let mut payload = checkpoint_hasher("payload");
    let mut schema = checkpoint_hasher("schema");
    checkpoint_digest_field(&mut schema, WORKFLOW_ROW_SCHEMA.as_bytes());
    schema.update(&1_u64.to_le_bytes());
    checkpoint_digest_field(&mut schema, b"rows");
    payload.update(&(payloads.len() as u64).to_le_bytes());
    schema.update(&(payloads.len() as u64).to_le_bytes());
    for (label, bytes) in payloads {
        checkpoint_digest_field(&mut payload, label.as_bytes());
        checkpoint_digest_field(&mut payload, bytes);
        checkpoint_digest_field(&mut schema, label.as_bytes());
    }
    let row_membership_digest = previous.row_membership_digest.clone();
    let row_order_digest = previous.row_order_digest.clone();
    let temporal_state_digest = previous.temporal_state_digest.clone();
    let classification_digest = previous.classification_digest.clone();
    let payload_digest = finish_checkpoint_digest(payload);
    let schema_digest = finish_checkpoint_digest(schema);
    let terminal_digest = terminal_checkpoint_digest(
        node_id,
        [
            &row_membership_digest,
            &row_order_digest,
            &temporal_state_digest,
            &classification_digest,
            &payload_digest,
            &schema_digest,
        ],
    );
    WorkflowCheckpoint {
        protocol_version: WORKFLOW_CHECKPOINT_PROTOCOL.into(),
        subject_id: node_id.into(),
        row_membership_digest,
        row_order_digest,
        temporal_state_digest,
        classification_digest,
        payload_digest,
        schema_digest,
        terminal_digest,
    }
}

pub(super) fn checkpoint_for_exact_state(node_id: &str, previous: &WorkflowCheckpoint) -> WorkflowCheckpoint {
    debug_assert_eq!(previous.protocol_version, WORKFLOW_CHECKPOINT_PROTOCOL);
    let mut checkpoint = previous.clone();
    checkpoint.subject_id = node_id.into();
    checkpoint.terminal_digest = terminal_checkpoint_digest(
        node_id,
        [
            &checkpoint.row_membership_digest,
            &checkpoint.row_order_digest,
            &checkpoint.temporal_state_digest,
            &checkpoint.classification_digest,
            &checkpoint.payload_digest,
            &checkpoint.schema_digest,
        ],
    );
    checkpoint
}

pub(super) fn checkpoint_for_reordered_exact_rows(
    node_id: &str,
    rows: &[Row],
    previous: &WorkflowCheckpoint,
) -> WorkflowCheckpoint {
    let mut checkpoint = checkpoint_for_exact_row_state(node_id, previous, &[]);
    let mut order = checkpoint_hasher("row-order");
    order.update(&1_u64.to_le_bytes());
    checkpoint_digest_field(&mut order, b"rows");
    order.update(&(rows.len() as u64).to_le_bytes());
    let mut scratch = RowCheckpointScratch::default();
    for (position, row) in rows.iter().enumerate() {
        let parts = row_checkpoint_parts(row, &mut scratch);
        checkpoint_digest_positioned_fixed16(&mut order, position, &parts.identity);
    }
    checkpoint.row_order_digest = finish_checkpoint_digest(order);
    checkpoint.terminal_digest = terminal_checkpoint_digest(
        node_id,
        [
            &checkpoint.row_membership_digest,
            &checkpoint.row_order_digest,
            &checkpoint.temporal_state_digest,
            &checkpoint.classification_digest,
            &checkpoint.payload_digest,
            &checkpoint.schema_digest,
        ],
    );
    checkpoint
}

pub(super) fn workflow_rows_checkpoint(node_id: &str, rows: &[Row]) -> WorkflowCheckpoint {
    workflow_checkpoint(node_id, &[("rows", rows)], &[])
}

pub(super) fn workflow_rows_checkpoint_reusing_last(
    node_id: &str,
    rows: &[Row],
    recorder: &QueryCheckpointRecorder<'_>,
) -> WorkflowCheckpoint {
    match recorder.reusable_row_components(rows) {
        Some((parts, checkpoint)) => {
            workflow_checkpoint_with_reusable_parts(node_id, rows, &[], parts, parts, checkpoint)
        }
        None => workflow_rows_checkpoint(node_id, rows),
    }
}

pub(super) fn workflow_state_checkpoint(node_id: &str, state: &str) -> WorkflowCheckpoint {
    workflow_checkpoint(node_id, &[], &[("state", state.as_bytes())])
}

pub(super) fn record_workflow_checkpoint(
    digests: &mut BTreeMap<String, String>,
    checkpoints: &mut BTreeMap<String, WorkflowCheckpoint>,
    checkpoint: WorkflowCheckpoint,
) {
    digests.insert(
        checkpoint.subject_id.clone(),
        checkpoint.terminal_digest.clone(),
    );
    checkpoints.insert(checkpoint.subject_id.clone(), checkpoint);
}

pub(super) fn timezone_retained_source_rows_digest(rows: &[Row]) -> String {
    let source_rows = rows
        .iter()
        .flat_map(|row| row.source_data_rows.iter())
        .collect::<BTreeSet<_>>();
    let mut hasher = Sha256::new();
    hasher.update((source_rows.len() as u64).to_le_bytes());
    for source_row in source_rows {
        hasher.update(source_row.to_le_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

/// Hash the product-local state at the timezone normalization joint. This is
/// intentionally not a generic graph-node serialization: it records exactly
/// the Chronicle fields whose identity is established at this stage.
pub(super) fn timezone_stage_digest(rows: &[Row]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((rows.len() as u64).to_le_bytes());
    for row in rows {
        hasher.update((row.source_data_rows.len() as u64).to_le_bytes());
        for source_row in row.source_data_rows.iter() {
            hasher.update(source_row.to_le_bytes());
        }
        for value in [
            row.study_id.as_str(),
            row.participant_id.as_str(),
            row.possible_device_model.as_str(),
            row.username.as_str(),
            row.application_label.as_str(),
            row.interaction_type.as_str(),
            row.app_package_name.as_str(),
            row.timezone.as_str(),
            row.date.as_str(),
        ] {
            sha256_digest_field(&mut hasher, value.as_bytes());
        }
        hasher.update(row.event_timestamp_ns.to_le_bytes());
        hasher.update([
            row.day,
            row.weekday_mf,
            row.weekday_mth,
            row.weekday_su_th,
            row.hour,
            row.quarter,
        ]);
        hasher.update((row.index as u64).to_le_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

/// The default policy contributes no parameter, so a step digest recorded
/// under it names nothing; a selected policy names itself, which is what makes
/// a warm A -> B flip of the grouping definition invalidate this step.
pub(super) fn session_grouping_checkpoint_payload(rules: SessionGroupingRules) -> serde_json::Value {
    if rules.policy == SessionGroupingPolicy::None {
        return serde_json::json!({});
    }
    // The three B11 keys join the payload only when they leave their published
    // defaults, so a run of a published policy checkpoints exactly the bytes it
    // checkpointed before the axis existed.
    let mut payload = serde_json::Map::new();
    payload.insert(
        "sessionGroupingPolicy".into(),
        rules.policy.canonical_id().into(),
    );
    if rules.gap_basis != SessionGapBasis::PreviousEpisodeStop {
        payload.insert("sessionGapBasis".into(), rules.gap_basis.canonical_id().into());
    }
    if rules.scope != SessionBoundaryScope::Participant {
        payload.insert(
            "sessionBoundaryScope".into(),
            rules.scope.canonical_id().into(),
        );
    }
    if rules.emit_lineage {
        payload.insert("emitSessionBreakLineage".into(), true.into());
    }
    serde_json::Value::Object(payload)
}

pub(super) fn neutral_b05_screen_construction_checkpoint(
    construction: &b05::ScreenConstructionOutput,
    opts: &PipelineV2Options,
) -> b05::ScreenConstructionOutput {
    let screen_options_digest = b05_screen_options_digest(opts);
    if opts.screen_session_construction_strategy
        == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
    {
        b05::rebind_chronicle_screen_construction_receipt(
            construction,
            &screen_options_digest,
            false,
        )
    } else {
        b05::rebind_screen_construction_options_digest(construction, &screen_options_digest)
    }
}

impl super::CreditPartition {
    pub(crate) fn checkpoint_payload(&self) -> super::CreditPartitionCheckpoint<'_> {
        super::CreditPartitionCheckpoint {
            session_count: self.sessions.len(),
            rest_count: self.rest.len(),
            session_rows_digest: &self.session_rows_digest,
            rest_rows_digest: &self.rest_rows_digest,
        }
    }
}

pub(crate) fn daily_apps_checkpoint_payload(day_apps: &super::DayApps) -> Vec<serde_json::Value> {
    day_apps.iter().map(|((participant_id, date), packages)| {
        serde_json::json!({
            "participantId": participant_id,
            "date": date,
            "packages": packages,
        })
    }).collect()
}

pub(crate) fn credit_decisions_checkpoint_payload(
    decisions: &[super::CreditDecision],
    tolerance_minutes: f64,
) -> serde_json::Value {
    serde_json::json!({
        "decisions": decisions,
        "toleranceMinutes": tolerance_minutes,
    })
}

impl super::CreditEmission {
    pub(crate) fn checkpoint_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "creditedRowsDigest": self.credited_rows_digest,
            "emissionCounts": self.counts,
        })
    }
}

impl super::CreditResult {
    pub(crate) fn checkpoint_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "creditedRowsDigest": self.credited_rows_digest,
            "restRowsDigest": self.rest_rows_digest,
            "report": self.report,
        })
    }
}

pub(crate) fn hidden_screen_dependency_checkpoint(
    construction: &b05::ScreenConstructionOutput,
) -> Result<WorkflowCheckpoint, String> {
    let construction_fingerprint = value_fingerprint(construction)
        .map_err(|error| format!("serialize B05 device-state checkpoint: {error}"))?;
    Ok(workflow_checkpoint(
        "device_state_timeline",
        &[],
        &[("construct_screen_intervals", &construction_fingerprint)],
    ))
}

/// Receives completed checkpoints; scheduling and hashing remain with callers.
pub(crate) trait CheckpointRecorder {
    fn record_checkpoint(&mut self, checkpoint: WorkflowCheckpoint);
}

pub(crate) fn record_completed_checkpoint(destination: &mut dyn CheckpointRecorder, checkpoint: WorkflowCheckpoint) {
    destination.record_checkpoint(checkpoint);
}

impl CheckpointRecorder for BTreeMap<String, WorkflowCheckpoint> {
    fn record_checkpoint(&mut self, checkpoint: WorkflowCheckpoint) {
        self.insert(checkpoint.subject_id.clone(), checkpoint);
    }
}
