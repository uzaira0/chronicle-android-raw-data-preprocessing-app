//! Chronicle preprocessing computations shared by the production 55-step
//! Salsa engine and an independent cold-run test oracle.

use ahash::{AHashMap, AHashSet};
use blake3::Hasher as CheckpointHasher;
use xxhash_rust::xxh3::{xxh3_128, Xxh3};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use sha2::{Digest, Sha256};
use smallvec::SmallVec;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Write as _;
use std::sync::{Arc, OnceLock};

use crate::{parse_chronicle_timestamp_ns, weekday_chronicle, write_csv_field};

use _rust_app_usage_matcher::{split_overlapping_sessions, UsageLayer};

#[path = "pipeline_v2_aggregates.rs"]
mod aggregates;
#[path = "pipeline_v2_incremental.rs"]
mod incremental;
#[cfg(feature = "incremental-v2")]
pub use incremental::{
    reconstruction_base_header_bytes, review_base_header_bytes, select_persisted_review_base,
    IncrementalPipelineV2Engine, IncrementalPipelineV2Execution, PersistedReviewBaseSelection,
};

pub const PREPROCESSOR_VERSION: &str = "1.0.0";

/// Closed product contract for timezone handling. Tests enumerate every
/// ordered transition so a fifth policy cannot be added without explicit
/// invalidation and output checks.
pub const TIMEZONE_HANDLING_MODES: [&str; 4] = [
    "selected-filter",
    "selected-convert",
    "primary-filter",
    "primary-convert",
];

// ---- canonical interaction-type constants -------------------------------

const ACTIVITY_RESUMED: &str = "Activity Resumed";
const ACTIVITY_PAUSED: &str = "Activity Paused";
const ACTIVITY_STOPPED: &str = "Activity Stopped";
const FILTERED_RESUMED: &str = "Filtered App Resumed";
const FILTERED_PAUSED: &str = "Filtered App Paused";
const FILTERED_STOPPED: &str = "Filtered App Stopped";
const APP_USAGE: &str = "App Usage";
const FILTERED_APP_USAGE: &str = "Filtered App Usage";
const FILTERED_APP_BACKGROUND_USAGE: &str = "Filtered App Background Usage";
const NON_TARGET_CHILD_APP_USAGE: &str = "Non-Target Child App Usage";
const END_OF_USAGE_MISSING: &str = "End of Usage Missing";
const SCREEN_USAGE: &str = "Screen Usage";

const KIDS_SHELL_PACKAGES: &[&str] = &[
    "com.amazon.tahoe",
    "com.sencatech.iwawa.iwawahome",
    "com.google.android.apps.kids.home",
    "com.kiddoware.kidsplace",
    "com.tcl.kidsmode",
];

// ---- screen-state constants ---------------------------------------------

const SCREEN_START_EVENTS: &[&str] = &["Screen Interactive", "Screen Interactive/Keyguard Shown"];
const SCREEN_STOP_EVENTS: &[&str] = &[
    "Screen Non-Interactive",
    "Device Screen Off",
    "Screen Non-Interactive/Keyguard Hidden",
];
const LOCK_SCREEN_EVENTS: &[&str] = &["Keyguard Shown", "Screen Interactive/Keyguard Shown"];
const UNLOCK_EVENTS: &[&str] = &[
    "Keyguard Hidden",
    "User Unlocked",
    "Screen Non-Interactive/Keyguard Hidden",
];
const FOREGROUND_EVENTS: &[&str] = &["Activity Resumed", "Filtered App Resumed"];
const MEANINGFUL_ACTIVITY_EVENTS: &[&str] = &[
    "Activity Resumed",
    "Filtered App Resumed",
    "User Interaction",
    "Shortcut Invocation",
    "Chooser Action",
    "App Component Used",
    "User Unlocked",
    "Keyguard Hidden",
];

const AMAZON_APPS: &[&str] = &[
    "com.amazon.redstone",
    "com.amazon.firelauncher",
    "com.amazon.imp",
    "com.amazon.alta.h2clientservice",
    "com.amazon.media.session.monitor",
];

// Codebook column rename map. Matches CODEBOOK_COLUMN_RENAME_MAP in TS.
// Order MUST match TS Object.values order — JS preserves insertion order.
const CODEBOOK_RENAME_PAIRS: &[(&str, &str)] = &[
    ("application_label", "codebook_application_label"),
    ("bcm_play_store_genreId", "bcm_play_store_genreId"),
    ("bcm_play_store_genre", "bcm_play_store_genre"),
    (
        "bcm_play_store_broad_app_category",
        "bcm_play_store_broad_app_category",
    ),
    ("bcm_play_store_developer", "bcm_play_store_developer"),
    ("bcm_play_store_free", "bcm_play_store_free"),
    ("bcm_play_store_rating", "bcm_play_store_rating"),
    ("bcm_play_store_downloads", "bcm_play_store_downloads"),
    ("usc_broad_app_category", "usc_broad_app_category"),
    ("usc_genreId", "usc_genreId"),
    (
        "umich_child_app_category_code",
        "umich_child_app_category_code",
    ),
    ("umich_child_app_category", "umich_child_app_category"),
    (
        "umich_adult_app_category_code",
        "umich_adult_app_category_code",
    ),
    ("umich_adult_app_category", "umich_adult_app_category"),
    ("umich_free", "umich_free"),
    ("umich_gambling_app", "umich_gambling_app"),
    ("umich_inappropriate_app", "umich_inappropriate_app"),
    ("babyemu_genreId_scraped", "babyemu_genreId_scraped"),
    ("babyemu_genreId_manual", "babyemu_genreId_manual"),
    ("babyemu_broad_app_category", "babyemu_broad_app_category"),
    ("babyemu_medium_app_category", "babyemu_medium_app_category"),
    ("babyemu_fine_app_category", "babyemu_fine_app_category"),
    (
        "babyemu_alternate_fine_app_category",
        "babyemu_alternate_fine_app_category",
    ),
    ("babyemu_kids", "babyemu_kids"),
    ("bcm_cnrc_heuristic_category", "bcm_cnrc_heuristic_category"),
    (
        "bcm_cnrc_categorization_source",
        "bcm_cnrc_categorization_source",
    ),
    ("dataset", "codebook_dataset"),
];

const COLLAPSED_GENRE_FIELD_INDICES: [usize; 4] = [1, 9, 17, 18];

fn codebook_output_columns() -> Vec<&'static str> {
    CODEBOOK_RENAME_PAIRS.iter().map(|(_, v)| *v).collect()
}

// Stable column index lookup for codebook fields, matching the order above.
fn codebook_col_index(name: &str) -> Option<usize> {
    CODEBOOK_RENAME_PAIRS.iter().position(|(_, v)| *v == name)
}

// ---- options ------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PipelineV2Options {
    pub study_name: String,
    pub timezone: String,
    pub timezone_handling: String,
    pub usage_session_mode: UsageSessionMode,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    pub use_background_apps_file: bool,
    pub use_app_codebook: bool,
    pub include_category_column: bool,
    pub deduplicate_exact_rows: bool,
    pub interaction_type_remap: Vec<String>,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
    pub proximity_interval_ns: i64,
    pub custom_app_engagement_duration: f64,
    pub long_data_time_gap_thresholds: Vec<f64>,
    pub long_usage_duration_thresholds: Vec<f64>,
    pub same_app_stop_types: Vec<String>,
    pub other_stop_types: Vec<String>,
    pub interaction_types_to_remove: Vec<String>,
    pub screen_auto_lock_timeout_seconds: f64,
    pub screen_auto_lock_tolerance_seconds: f64,
    pub screen_manual_lock_max_tail_seconds: f64,
    pub screen_keyguard_near_stop_seconds: f64,
    pub datetime_of_preprocessing: String,
    pub model_concurrent_usage: bool,
    pub minimum_usage_duration: f64,
    pub apply_minimum_usage_duration_to_concurrent_subintervals: bool,
    pub filter_zero_duration_sessions: bool,
    pub add_no_activity_placeholder_days: bool,
    pub enable_study_window_filter: bool,
    pub enable_person_attribution: bool,
    pub enable_day_coverage: bool,
    pub enable_compliance_scoring: bool,
    pub compliance_threshold_percent: f64,
    pub enable_screen_gated_crediting: bool,
    pub enable_aggregates: bool,
    pub aggregate_shape: String,
    /// Effective browser view target for the final output query only. The raw
    /// UI flags remain in the receipt; their OR is the only value that can
    /// affect Rust output materialization.
    pub materialize_visualization_data: bool,
    pub credited_session_cap_minutes: f64,
    pub device_liveness_gap_tolerance_minutes: f64,
    pub auto_lock_bridge_seconds: f64,
    pub no_witness_min_day_apps: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UsageSessionMode {
    NoUsage,
    AppUsage,
    ScreenUsage,
    AppAndScreenUsage,
}

// ---- support file loaders ----------------------------------------------

/// Validate a support file against the exact schema used by the Rust
/// pipeline before it can satisfy a role. This closes the former gap where a
/// correctly named CSV with unrelated columns qualified and then behaved like
/// an empty lookup.
pub fn validate_support_csv(role: &str, bytes: &[u8]) -> Result<(), String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("{role}: unreadable CSV header: {error}"))?
        .iter()
        .map(|header| header.trim().trim_start_matches('\u{feff}').to_string())
        .collect::<BTreeSet<_>>();
    let row_count = reader.records().try_fold(0usize, |count, record| {
        record
            .map(|record| count + usize::from(record.iter().any(|cell| !cell.trim().is_empty())))
            .map_err(|error| format!("{role}: malformed CSV record: {error}"))
    })?;
    let require = |names: &[&str]| -> Result<(), String> {
        let missing = names
            .iter()
            .filter(|name| !headers.contains(**name))
            .copied()
            .collect::<Vec<_>>();
        if missing.is_empty() {
            Ok(())
        } else {
            // PHI safety: never echo the found headers — a headerless upload
            // would leak its first data row here.
            Err(format!(
                "{role}: missing required column(s) {}",
                missing.join(", ")
            ))
        }
    };
    let require_one = |names: &[&str]| -> Result<(), String> {
        if names.iter().any(|name| headers.contains(*name)) {
            Ok(())
        } else {
            Err(format!(
                "{role}: requires one of columns {}",
                names.join(", ")
            ))
        }
    };
    match role {
        "filter_file" => require_one(&["app_package_name", "package_name"]),
        "apps_forcing_screen_open_file" | "background_apps_file" => {
            require_one(&["package_name", "app_package_name"])
        }
        "app_codebook_file" => require(&["app_package_name"]),
        "study_dates_file" => {
            require(&["participant_id", "start_date", "end_date"])?;
            let windows = parse_study_windows(bytes)?;
            if row_count == 0 || windows.is_empty() {
                Err("study_dates_file: no participant study windows found".into())
            } else {
                Ok(())
            }
        }
        "device_sharing_file" => {
            require(&["participant_id", "sharing_status"])?;
            parse_device_sharing(bytes).map(|_| ())
        }
        "survey_attribution_file" => {
            require(&["participant_id", "event_timestamp", "users"])?;
            parse_survey_lookup(bytes).map(|_| ())
        }
        "enrolled_devices_file" => {
            require(&["participant_id", "device_count"])?;
            parse_enrolled_devices(bytes).map(|_| ())
        }
        _ => Err(format!("unsupported support role: {role}")),
    }
}

/// Build (filter_set, filter_label_map) from raw filter-CSV bytes.
/// Mirrors `buildFilterMap` semantics — packageName -> Set<labels>.
/// If labels set is non-empty, only rows with matching application_label match.
fn parse_filter_csv(bytes: &[u8]) -> HashMap<String, AHashSet<String>> {
    let mut map: HashMap<String, AHashSet<String>> = HashMap::new();
    let rows = parse_csv_to_records(bytes);
    for row in &rows {
        let pkg = trim_owned(
            row.get("app_package_name")
                .or_else(|| row.get("package_name")),
        );
        if pkg.is_empty() {
            continue;
        }
        let labels = trim_owned(
            row.get("known_application_labels")
                .or_else(|| row.get("application_label"))
                .or_else(|| row.get("label_or_note")),
        );
        let entry = map.entry(pkg).or_insert_with(AHashSet::new);
        if !labels.is_empty() {
            for lab in labels.split(',') {
                let trimmed = lab.trim();
                if !trimmed.is_empty() {
                    entry.insert(trimmed.to_string());
                }
            }
        }
    }
    map
}

fn parse_apps_forcing_csv(bytes: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let rows = parse_csv_to_records(bytes);
    for row in &rows {
        let pkg = trim_owned(
            row.get("package_name")
                .or_else(|| row.get("app_package_name")),
        );
        let label = trim_owned(
            row.get("label_or_note")
                .or_else(|| row.get("application_label")),
        );
        if pkg.is_empty() || pkg.starts_with('#') {
            continue;
        }
        map.insert(pkg, label);
    }
    map
}

fn parse_background_apps_csv(bytes: &[u8]) -> AHashSet<String> {
    parse_csv_to_records(bytes)
        .into_iter()
        .filter_map(|row| {
            let package = trim_owned(
                row.get("package_name")
                    .or_else(|| row.get("app_package_name")),
            );
            if package.is_empty() || package.starts_with('#') {
                None
            } else {
                Some(package)
            }
        })
        .collect()
}

#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct CodebookEntry {
    /// Indexed by codebook_col_index() output name (e.g. "codebook_application_label", "bcm_play_store_genreId"…)
    pub fields: Arc<Vec<Option<String>>>,
}

fn parse_codebook_csv(bytes: &[u8]) -> HashMap<String, CodebookEntry> {
    let mut map: HashMap<String, CodebookEntry> = HashMap::new();
    let rows = parse_csv_to_records(bytes);
    let n_cols = CODEBOOK_RENAME_PAIRS.len();
    for row in &rows {
        let pkg = trim_owned(row.get("app_package_name"));
        if pkg.is_empty() || map.contains_key(&pkg) {
            continue;
        }
        let mut fields = vec![None; n_cols];
        for (i, (src, _dst)) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
            let v = trim_owned(row.get(*src));
            fields[i] = if v.is_empty() { None } else { Some(v) };
        }
        map.insert(
            pkg,
            CodebookEntry {
                fields: Arc::new(fields),
            },
        );
    }
    map
}

fn trim_owned(v: Option<&String>) -> String {
    v.map(|s| s.trim().to_string()).unwrap_or_default()
}

fn parse_csv_to_records(bytes: &[u8]) -> Vec<HashMap<String, String>> {
    parse_csv_to_records_with_physical_rows(bytes)
        .into_iter()
        .map(|(_physical_data_row, record)| record)
        .collect()
}

/// Like `parse_csv_to_records`, but each surviving record carries its physical
/// 1-based data-row number — counting EVERY data record in the file, including
/// the all-empty records this parser skips — so error messages name the same
/// row the incremental executor's `csv_parse` reports via
/// `RawRow::source_data_row`.
fn parse_csv_to_records_with_physical_rows(bytes: &[u8]) -> Vec<(u32, HashMap<String, String>)> {
    // csv-core's empty-input flush path differs under the optimized browser
    // WASM target for a final unterminated field: the row can be emitted while
    // its last cell is empty. Normalize only the missing record terminator so
    // native and WASM parse identical bytes without changing CSV contents.
    let mut terminated = Vec::new();
    let bytes = if bytes.ends_with(b"\n") {
        bytes
    } else {
        terminated.reserve(bytes.len() + 1);
        terminated.extend_from_slice(bytes);
        terminated.push(b'\n');
        &terminated
    };
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = bytes;
    // csv-core consumes the input it wrote before reporting OutputFull, so the
    // bytes already in `field_buf` are the only copy of the front of a long
    // cell. Carry them here across the resize; dropping them silently
    // truncated every support-file value longer than the buffer to its tail.
    let mut carried: Vec<u8> = Vec::new();
    let take_field = |carried: &mut Vec<u8>, field_buf: &[u8]| -> String {
        if carried.is_empty() {
            return String::from_utf8_lossy(field_buf).into_owned();
        }
        carried.extend_from_slice(field_buf);
        let value = String::from_utf8_lossy(carried).into_owned();
        carried.clear();
        value
    };

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                // Keep feeding the exhausted reader an empty slice until End
                // so csv-core emits the final unterminated record.
                continue;
            }
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..n_out]);
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = take_field(&mut carried, &field_buf[..n_out])
                    .trim()
                    .to_string();
                headers.push(s);
                if record_end {
                    break;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let mut records = Vec::new();
    let mut row_vals: Vec<String> = vec![String::new(); headers.len()];
    let mut col_idx = 0;
    let mut any_nonempty = false;
    // Physical 1-based data-row counter, incremented for every record —
    // including all-empty records that are skipped from the output — to match
    // `csv_parse`'s `data_row_number` in pipeline_v2_incremental.rs.
    let mut physical_data_row = 0_u32;
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                continue;
            }
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..n_out]);
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = take_field(&mut carried, &field_buf[..n_out]);
                if col_idx < row_vals.len() {
                    row_vals[col_idx].clear();
                    row_vals[col_idx].push_str(&s);
                    if !s.is_empty() {
                        any_nonempty = true;
                    }
                }
                col_idx += 1;
                if record_end {
                    physical_data_row += 1;
                    if any_nonempty {
                        let mut rec = HashMap::with_capacity(headers.len());
                        for (i, h) in headers.iter().enumerate() {
                            rec.insert(h.clone(), row_vals[i].clone());
                        }
                        records.push((physical_data_row, rec));
                    }
                    for s in row_vals.iter_mut() {
                        s.clear();
                    }
                    col_idx = 0;
                    any_nonempty = false;
                }
            }
            ReadFieldResult::End => break,
        }
    }
    records
}

// ---- canonical row ------------------------------------------------------

/// Cheaply cloned immutable text used inside row-bearing incremental query
/// results. A `Row` is copied at several real transformation boundaries; the
/// text itself normally does not change at those boundaries, so sharing it
/// avoids allocating another copy for every cached query result.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
struct SharedString(Arc<String>);

impl Default for SharedString {
    fn default() -> Self {
        static EMPTY: OnceLock<Arc<String>> = OnceLock::new();
        Self(Arc::clone(EMPTY.get_or_init(|| Arc::new(String::new()))))
    }
}

impl SharedString {
    fn as_str(&self) -> &str {
        self.0.as_str()
    }

    fn shared(&self) -> Arc<String> {
        Arc::clone(&self.0)
    }

    fn into_shared(self) -> Arc<String> {
        self.0
    }
}

impl std::ops::Deref for SharedString {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl std::fmt::Display for SharedString {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl AsRef<str> for SharedString {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl std::borrow::Borrow<str> for SharedString {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl From<String> for SharedString {
    fn from(value: String) -> Self {
        Self(Arc::new(value))
    }
}

impl From<&str> for SharedString {
    fn from(value: &str) -> Self {
        Self(Arc::new(value.to_owned()))
    }
}

impl PartialEq<str> for SharedString {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == other
    }
}

impl PartialEq<&str> for SharedString {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(serde::Serialize)]
struct PersistedStringRef<'a> {
    id: u32,
    value: Option<&'a str>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedString {
    id: u32,
    value: Option<String>,
}

struct PersistedStringEncoder(AHashMap<SharedString, u32>);

impl Default for PersistedStringEncoder {
    fn default() -> Self {
        Self(AHashMap::new())
    }
}

#[derive(Default)]
struct PersistedStringDecoder(Vec<Arc<String>>);

thread_local! {
    static PERSISTED_STRING_ENCODER: RefCell<Option<PersistedStringEncoder>> = const {
        RefCell::new(None)
    };
    static PERSISTED_STRING_DECODER: RefCell<Option<PersistedStringDecoder>> = const {
        RefCell::new(None)
    };
}

struct PersistedStringEncoderGuard;

impl Drop for PersistedStringEncoderGuard {
    fn drop(&mut self) {
        PERSISTED_STRING_ENCODER.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

struct PersistedStringDecoderGuard;

impl Drop for PersistedStringDecoderGuard {
    fn drop(&mut self) {
        PERSISTED_STRING_DECODER.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

fn with_serialized_row_string_table<T>(encode: impl FnOnce() -> T) -> T {
    PERSISTED_STRING_ENCODER.with(|slot| {
        let previous = slot.borrow_mut().replace(PersistedStringEncoder::default());
        assert!(previous.is_none(), "row string serialization table nested");
    });
    let _guard = PersistedStringEncoderGuard;
    encode()
}

fn serialize_persisted_string<S>(value: &SharedString, serializer: S) -> Result<S::Ok, S::Error>
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

fn deserialize_persisted_string<'de, D>(deserializer: D) -> Result<SharedString, D::Error>
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
struct SharedStringPool(AHashSet<SharedString>);

impl Default for SharedStringPool {
    fn default() -> Self {
        Self(AHashSet::new())
    }
}

impl SharedStringPool {
    fn intern_owned(&mut self, value: String) -> SharedString {
        if let Some(existing) = self.0.get(value.as_str()) {
            return existing.clone();
        }
        let shared = SharedString::from(value);
        self.0.insert(shared.clone());
        shared
    }

    fn intern(&mut self, value: &str) -> SharedString {
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

struct DeserializedRowStringPoolGuard;

impl Drop for DeserializedRowStringPoolGuard {
    fn drop(&mut self) {
        DESERIALIZED_ROW_STRING_POOL.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

fn with_deserialized_row_string_pool<T>(decode: impl FnOnce() -> T) -> T {
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

fn intern_deserialized_string(value: String) -> SharedString {
    DESERIALIZED_ROW_STRING_POOL.with(|slot| {
        let mut slot = slot.borrow_mut();
        match slot.as_mut() {
            Some(pool) => pool.intern_owned(value),
            None => SharedString::from(value),
        }
    })
}

fn intern_deserialized_str(value: &str) -> SharedString {
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

#[derive(Clone)]
struct Row(Arc<RowInner>);

/// The derived checkpoint parts travel with the immutable row value. Each
/// semantic component is cached separately so a classification-only edit does
/// not force the identity and temporal bytes through the hash function again.
struct RowInner {
    data: RowData,
    checkpoint_parts: RowCheckpointCache,
}

#[derive(Default)]
struct RowCheckpointCache {
    identity: OnceLock<[u8; 16]>,
    temporal: OnceLock<[u8; 16]>,
    classification: OnceLock<[u8; 16]>,
}

#[derive(serde::Serialize)]
struct PersistedRowRef<'a> {
    data: &'a RowData,
    identity: Option<[u8; 16]>,
    temporal: Option<[u8; 16]>,
    classification: Option<[u8; 16]>,
}

#[derive(serde::Deserialize)]
struct PersistedRow {
    data: RowData,
    identity: Option<[u8; 16]>,
    temporal: Option<[u8; 16]>,
    classification: Option<[u8; 16]>,
}

impl Clone for RowCheckpointCache {
    fn clone(&self) -> Self {
        fn copy_lock(source: &OnceLock<[u8; 16]>) -> OnceLock<[u8; 16]> {
            let copy = OnceLock::new();
            if let Some(value) = source.get() {
                copy.set(*value).expect("fresh checkpoint lock");
            }
            copy
        }

        Self {
            identity: copy_lock(&self.identity),
            temporal: copy_lock(&self.temporal),
            classification: copy_lock(&self.classification),
        }
    }
}

impl RowInner {
    fn new(data: RowData) -> Self {
        Self {
            data,
            checkpoint_parts: RowCheckpointCache::default(),
        }
    }
}

impl Clone for RowInner {
    fn clone(&self) -> Self {
        Self {
            data: self.data.clone(),
            checkpoint_parts: self.checkpoint_parts.clone(),
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RowData {
    /// One-based raw CSV data-row numbers (the header is not counted) that
    /// may contribute to this row. Matching/state-machine outputs retain a
    /// conservative dependency set rather than claiming false exactness.
    source_data_rows: SourceDataRows,
    /// Exact descriptions of candidate regions searched to establish that a
    /// required matching event was absent. These remain separate from rows
    /// that directly supplied output values.
    #[serde(
        serialize_with = "serialize_lineage_searches",
        deserialize_with = "deserialize_lineage_searches"
    )]
    lineage_searches: Arc<SmallVec<[LineageSearchEvidence; 1]>>,
    study_id: SharedString,
    participant_id: SharedString,
    possible_device_model: SharedString,
    username: SharedString,
    application_label: SharedString,
    interaction_type: SharedString,
    app_package_name: SharedString,
    event_timestamp_ns: i64,
    timezone: SharedString,
    data_time_gap_hours: f64,
    date: SharedString,
    day: u8,
    weekday_mf: u8,
    weekday_mth: u8,
    weekday_su_th: u8,
    hour: u8,
    quarter: u8,
    start_timestamp_ns: Option<i64>,
    stop_timestamp_ns: Option<i64>,
    duration_seconds: Option<f64>,
    duration_minutes: Option<f64>,
    screen_usage_end_reason: Option<SharedString>,
    screen_usage_end_reason_confidence: Option<f64>,
    screen_usage_stop_event_type: Option<SharedString>,
    screen_usage_last_activity_timestamp_ns: Option<i64>,
    screen_usage_tail_gap_seconds: Option<f64>,
    screen_usage_foreground_app_package: Option<SharedString>,
    screen_usage_apps_forcing_screen_open_label: Option<SharedString>,
    screen_usage_lock_screen_only: Option<u8>,
    any_app_usage_flags: SharedString,
    valid_app_new_engage_30s: i32,
    valid_app_new_engage_custom: i32,
    valid_app_switched_app: i32,
    valid_app_usage_time_gap_hours: f64,
    any_app_new_engage_30s: i32,
    any_app_new_engage_custom: i32,
    any_app_switched_app: i32,
    any_app_usage_time_gap_hours: f64,
    genre_id_scraped: Option<SharedString>,
    broad_app_category: Option<SharedString>,
    /// Per-codebook column values (Option<String>) parallel to CODEBOOK_RENAME_PAIRS.
    #[serde(
        serialize_with = "serialize_codebook_fields",
        deserialize_with = "deserialize_codebook_fields"
    )]
    codebook_fields: Arc<Vec<Option<String>>>,
    codebook_genre_fields_cleared: bool,
    index: usize,
    /// Present only when `model_concurrent_usage` is true. Value is "primary"
    /// or "secondary". None when the flag is off (column absent from output).
    usage_layer: Option<SharedString>,
}

fn serialize_lineage_searches<S>(
    value: &Arc<SmallVec<[LineageSearchEvidence; 1]>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serde::Serialize::serialize(value.as_slice(), serializer)
}

fn deserialize_lineage_searches<'de, D>(
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
            if searches.is_empty() {
                Ok(empty_lineage_searches())
            } else {
                Ok(Arc::new(searches))
            }
        }
    }

    deserializer.deserialize_seq(LineageSearchesVisitor)
}

fn serialize_codebook_fields<S>(
    value: &Arc<Vec<Option<String>>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serde::Serialize::serialize(value, serializer)
}

fn deserialize_codebook_fields<'de, D>(
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
                Ok(Arc::new(fields.into_vec()))
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
            PersistedRowRef {
                data: &self.0.data,
                identity: self.0.checkpoint_parts.identity.get().copied(),
                temporal: self.0.checkpoint_parts.temporal.get().copied(),
                classification: self.0.checkpoint_parts.classification.get().copied(),
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
        if deserializer.is_human_readable() {
            RowData::deserialize(deserializer).map(|data| Self(Arc::new(RowInner::new(data))))
        } else {
            PersistedRow::deserialize(deserializer).map(|persisted| {
                fn restored(value: Option<[u8; 16]>) -> OnceLock<[u8; 16]> {
                    let lock = OnceLock::new();
                    if let Some(value) = value {
                        lock.set(value).expect("fresh checkpoint lock");
                    }
                    lock
                }

                Self(Arc::new(RowInner {
                    data: persisted.data,
                    checkpoint_parts: RowCheckpointCache {
                        identity: restored(persisted.identity),
                        temporal: restored(persisted.temporal),
                        classification: restored(persisted.classification),
                    },
                }))
            })
        }
    }
}

impl Row {
    fn new(data: RowData) -> Self {
        Self(Arc::new(RowInner::new(data)))
    }

    fn edit_components(
        &mut self,
        identity: bool,
        temporal: bool,
        classification: bool,
    ) -> &mut RowData {
        let inner = Arc::make_mut(&mut self.0);
        if identity {
            inner.checkpoint_parts.identity = OnceLock::new();
        }
        if temporal {
            inner.checkpoint_parts.temporal = OnceLock::new();
        }
        if classification {
            inner.checkpoint_parts.classification = OnceLock::new();
        }
        &mut inner.data
    }

    fn edit_identity(&mut self) -> &mut RowData {
        self.edit_components(true, false, false)
    }

    fn edit_temporal(&mut self) -> &mut RowData {
        self.edit_components(false, true, false)
    }

    fn edit_classification(&mut self) -> &mut RowData {
        self.edit_components(false, false, true)
    }

    fn edit_all(&mut self) -> &mut RowData {
        self.edit_components(true, true, true)
    }
}

impl std::ops::Deref for Row {
    type Target = RowData;

    fn deref(&self) -> &Self::Target {
        &self.0.data
    }
}

impl std::ops::DerefMut for Row {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.edit_all()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDataRowRange {
    pub first: u32,
    pub last: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageSearchEvidence {
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub protocol_version: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub reason: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub index_space: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub start_participant_id: Arc<String>,
    pub start_event_index: u32,
    pub end_event_index_exclusive: u32,
    pub candidate_event_count: u32,
    pub candidate_chain_digest: LineageSearchDigest,
}

fn serialize_shared_arc_string<S>(value: &Arc<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if serializer.is_human_readable() {
        serializer.serialize_str(value)
    } else {
        serialize_persisted_string(&SharedString(Arc::clone(value)), serializer)
    }
}

fn deserialize_shared_arc_string<'de, D>(deserializer: D) -> Result<Arc<String>, D::Error>
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

fn static_lineage_text(value: &str) -> Option<Arc<String>> {
    match value {
        "chronicle-lineage-search/v1" => Some(shared_lineage_text("chronicle-lineage-search/v1")),
        "selected-qualifying-stop" => Some(shared_lineage_text("selected-qualifying-stop")),
        "no-qualifying-stop" => Some(shared_lineage_text("no-qualifying-stop")),
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

fn intern_deserialized_arc_str(value: &str) -> Arc<String> {
    static_lineage_text(value).unwrap_or_else(|| intern_deserialized_str(value).into_shared())
}

fn intern_deserialized_arc_string(value: String) -> Arc<String> {
    static_lineage_text(&value).unwrap_or_else(|| intern_deserialized_string(value).into_shared())
}

/// Raw BLAKE3 output that retains the public `blake3:<hex>` wire format
/// without allocating a unique 71-byte string for every searched event range.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LineageSearchDigest([u8; 32]);

impl LineageSearchDigest {
    fn from_hasher(hasher: CheckpointHasher) -> Self {
        Self(*hasher.finalize().as_bytes())
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        let hex = value
            .strip_prefix("blake3:")
            .ok_or_else(|| "lineage search digest does not use blake3".to_string())?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(hex, &mut digest)
            .map_err(|error| format!("decode lineage search digest: {error}"))?;
        Ok(Self(digest))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    fn encoded(self) -> [u8; 71] {
        encode_blake3_digest(self.0)
    }
}

impl std::fmt::Display for LineageSearchDigest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let encoded = self.encoded();
        formatter.write_str(std::str::from_utf8(&encoded).expect("BLAKE3 digest is ASCII"))
    }
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

fn shared_lineage_text(value: &'static str) -> Arc<String> {
    static VALUES: OnceLock<BTreeMap<&'static str, Arc<String>>> = OnceLock::new();
    Arc::clone(
        VALUES
            .get_or_init(|| {
                [
                    "chronicle-lineage-search/v1",
                    "selected-qualifying-stop",
                    "no-qualifying-stop",
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

#[derive(Clone, Debug, PartialEq, Eq)]
struct SourceDataRows(SmallVec<[SourceDataRowRange; 2]>);

impl Default for SourceDataRows {
    fn default() -> Self {
        Self(SmallVec::new())
    }
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
                Ok(SourceDataRows(ranges))
            }
        }

        deserializer.deserialize_seq(SourceDataRowsVisitor)
    }
}

impl SourceDataRows {
    fn single(row: u32) -> Self {
        let mut rows = SmallVec::new();
        rows.push(SourceDataRowRange {
            first: row,
            last: row,
        });
        Self(rows)
    }

    fn len(&self) -> usize {
        self.0
            .iter()
            .map(|range| (range.last - range.first) as usize + 1)
            .sum()
    }

    fn iter(&self) -> impl Iterator<Item = u32> + '_ {
        self.0.iter().flat_map(|range| range.first..=range.last)
    }

    #[cfg(test)]
    fn contains(&self, row: u32) -> bool {
        self.0
            .binary_search_by(|range| {
                if row < range.first {
                    std::cmp::Ordering::Greater
                } else if row > range.last {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .is_ok()
    }

    fn ranges(&self) -> &[SourceDataRowRange] {
        &self.0
    }

    fn merge(&mut self, additional: &Self) {
        if additional.0.is_empty() {
            return;
        }
        if self.0.is_empty() {
            self.0.clone_from(&additional.0);
            return;
        }

        let mut merged =
            SmallVec::<[SourceDataRowRange; 2]>::with_capacity(self.0.len() + additional.0.len());
        let mut left = 0;
        let mut right = 0;
        while left < self.0.len() || right < additional.0.len() {
            let next = if right == additional.0.len()
                || (left < self.0.len() && self.0[left].first <= additional.0[right].first)
            {
                let range = self.0[left];
                left += 1;
                range
            } else {
                let range = additional.0[right];
                right += 1;
                range
            };
            if let Some(current) = merged.last_mut() {
                if next.first <= current.last.saturating_add(1) {
                    current.last = current.last.max(next.last);
                    continue;
                }
            }
            merged.push(next);
        }
        self.0 = merged;
    }

    fn cmp_expanded(&self, other: &Self) -> std::cmp::Ordering {
        self.iter().cmp(other.iter())
    }

    #[cfg(test)]
    fn to_vec(&self) -> Vec<u32> {
        self.iter().collect()
    }
}

fn empty_codebook_fields_ref() -> &'static Arc<Vec<Option<String>>> {
    static EMPTY: OnceLock<Arc<Vec<Option<String>>>> = OnceLock::new();
    EMPTY.get_or_init(|| Arc::new(vec![None; CODEBOOK_RENAME_PAIRS.len()]))
}

fn empty_codebook_fields() -> Arc<Vec<Option<String>>> {
    Arc::clone(empty_codebook_fields_ref())
}

fn empty_lineage_searches() -> Arc<SmallVec<[LineageSearchEvidence; 1]>> {
    static EMPTY: OnceLock<Arc<SmallVec<[LineageSearchEvidence; 1]>>> = OnceLock::new();
    Arc::clone(EMPTY.get_or_init(|| Arc::new(SmallVec::new())))
}

// ---- tz formatters ------------------------------------------------------

fn ts_to_local(ts_ns: i64, tz: Tz) -> DateTime<Tz> {
    let secs = ts_ns.div_euclid(1_000_000_000);
    let nanos = ts_ns.rem_euclid(1_000_000_000) as u32;
    chrono::Utc
        .timestamp_opt(secs, nanos)
        .single()
        .expect("valid ts")
        .with_timezone(&tz)
}

/// Write event_timestamp matching the established CSV contract without
/// allocating an intermediate String for every output row.
fn emit_event_timestamp(out: &mut Vec<u8>, ts_ns: i64, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let local = ts_to_local(ts_ns, tz);
    write!(
        out,
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

fn emit_session_timestamp(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    write!(
        out,
        "{:02}-{:02}-{:04} {:02}:{:02}:{:02}",
        local.month(),
        local.day(),
        local.year(),
        local.hour(),
        local.minute(),
        local.second(),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

// Aggregate writers build a small row of owned fields before serializing it.
// Keep their existing helper while the high-volume row writers emit directly.
fn fmt_session_timestamp(ts_ns: Option<i64>, tz: Tz) -> String {
    ts_ns
        .map(|ns| ts_to_local(ns, tz).format("%m-%d-%Y %H:%M:%S").to_string())
        .unwrap_or_default()
}

fn emit_screen_timestamp(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    write!(
        out,
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.000000{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

fn emit_screen_last_activity(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    write!(
        out,
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000000{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

/// Consecutive rows overwhelmingly share a local calendar date, so callers
/// that populate time columns in a loop pass one memo to avoid re-formatting
/// the same `YYYY-MM-DD` string per row.
#[derive(Default)]
struct LocalDateMemo(Option<(i32, u32, u32, SharedString)>);

impl LocalDateMemo {
    fn date_string(&mut self, year: i32, month: u32, day: u32) -> SharedString {
        match &self.0 {
            Some((y, m, d, date)) if *y == year && *m == month && *d == day => date.clone(),
            _ => {
                let date = SharedString::from(format!("{year:04}-{month:02}-{day:02}"));
                self.0 = Some((year, month, day, date.clone()));
                date
            }
        }
    }
}

fn populate_time_columns(row: &mut Row, tz: Tz, date_memo: &mut LocalDateMemo) {
    let local = ts_to_local(row.event_timestamp_ns, tz);
    let data = row.edit_temporal();
    data.date = date_memo.date_string(local.year(), local.month(), local.day());
    let day = weekday_chronicle(local.weekday());
    data.day = day;
    data.weekday_mf = if (2..=6).contains(&day) { 1 } else { 0 };
    data.weekday_mth = if (2..=5).contains(&day) { 1 } else { 0 };
    data.weekday_su_th = if day == 1 || (2..=5).contains(&day) {
        1
    } else {
        0
    };
    data.hour = local.hour() as u8;
    data.quarter = ((local.month() as u8 - 1) / 3) + 1;
}

// ---- float formatting (Python-like repr) -------------------------------

/// Mirrors `normalizeFloatString` in browserPipeline.ts.
/// JS `Number.toString()` algorithm = ECMAScript shortest-round-trip format.
/// Rust f64 default Display matches IEEE 754 round-trip, but format differs
/// for some edge cases. Use ryu_js for ECMAScript-conformant output.
pub fn normalize_float_string(value: f64) -> String {
    if !value.is_finite() {
        // JS String(value) -> "NaN" | "Infinity" | "-Infinity"
        if value.is_nan() {
            return "NaN".to_string();
        }
        return if value.is_sign_positive() {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    let abs_value = value.abs();
    if abs_value != 0.0 && abs_value < 1e-4 {
        // toPrecision(15) -> parseFloat -> toExponential, then strip trailing
        // zeros in mantissa and exponent leading zeros.
        let p = round_to_precision(value, 15);
        let exp_str = to_exponential(p);
        // Replace /\.0+e/ -> "e"
        let exp_str = collapse_zero_mantissa(&exp_str);
        // Replace /e([+-])0+/ -> "e$1"
        return strip_exp_leading_zeros(&exp_str);
    }
    // toPrecision(17) -> parseFloat -> toString(); add ".0" if no decimal/E
    let p = round_to_precision(value, 17);
    let normalized = js_number_to_string(p);
    if normalized.contains('.') || normalized.contains('e') || normalized.contains('E') {
        normalized
    } else {
        format!("{normalized}.0")
    }
}

/// Render a float using `ryu_js` (the ECMAScript-conformant ryū variant).
fn js_number_to_string(value: f64) -> String {
    let mut buf = ryu_js::Buffer::new();
    let s = buf.format(value);
    // ryu_js produces JS-spec output already. But ryu_js may emit "5e0"-style
    // for small ints — JS would emit "5". The `format` function on the
    // Buffer is documented to match ECMAScript ToString. So we trust it.
    s.to_string()
}

/// Round `value` to `precision` significant digits the same way JS
/// `parseFloat(value.toPrecision(precision))` would. Implementation:
/// render with N sig digits using ECMA spec, then parse back to f64.
fn round_to_precision(value: f64, precision: u32) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    let s = ecma_to_precision(value, precision);
    s.parse::<f64>().unwrap_or(value)
}

/// ECMAScript Number.prototype.toPrecision(precision) — string form.
/// Spec: pick integer n with `precision` digits such that
/// n × 10^(e-precision+1) is closest to x, ties rounded up (away from 0).
fn ecma_to_precision(value: f64, precision: u32) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if value == 0.0 {
        return if precision == 0 || precision == 1 {
            "0".to_string()
        } else {
            format!("0.{}", "0".repeat(precision as usize - 1))
        };
    }
    let neg = value < 0.0;
    let abs_v = value.abs();
    // Render with high precision to inspect.
    let high = format!("{:.30e}", abs_v);
    // high looks like "5.000000000000000444089209850063e-8"
    let (mant_part, exp_part) = match high.find('e') {
        Some(i) => (&high[..i], &high[i + 1..]),
        None => (high.as_str(), "0"),
    };
    let exp: i32 = exp_part.parse().unwrap_or(0);
    // mant_part: "5.000000000000000444089209850063"
    // We want `precision` significant digits from the mantissa, then the
    // exponent stays. But we need to round at the precision-th digit.
    // First strip the decimal point to get a digit string.
    let mut digits = String::new();
    for c in mant_part.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        }
    }
    // Round digits to `precision` digits, half-away-from-zero.
    let p = precision as usize;
    if p >= digits.len() {
        // Pad with zeros, no rounding needed.
        let pad = "0".repeat(p - digits.len());
        let rounded = format!("{digits}{pad}");
        return precision_format_output(neg, &rounded, exp, p);
    }
    let kept = &digits[..p];
    let next_digit = digits.as_bytes()[p];
    let round_up = next_digit >= b'5';
    let (final_digits, exp_adjust) = if !round_up {
        (kept.to_string(), 0i32)
    } else {
        let bumped = increment_decimal_string(kept);
        if bumped.len() > kept.len() {
            // Carry propagated to a new digit; drop trailing.
            let trimmed = &bumped[..p];
            (trimmed.to_string(), 1i32)
        } else {
            (bumped, 0i32)
        }
    };
    precision_format_output(neg, &final_digits, exp + exp_adjust, p)
}

/// Format the precision-rounded digit string as an ES-spec toPrecision output.
fn precision_format_output(neg: bool, digits: &str, exp: i32, precision: usize) -> String {
    // ES spec: if exp < -6 or exp >= precision, use exponential notation.
    let sign = if neg { "-" } else { "" };
    let p = precision;
    if exp < -6 || (exp as i64) >= p as i64 {
        // d.dddd...e±N
        let head = &digits[..1];
        let tail = if digits.len() > 1 { &digits[1..] } else { "" };
        // Strip trailing zeros from tail to match parseFloat-back behavior?
        // No — toPrecision keeps trailing zeros. parseFloat then strips them.
        // Since we always go through parseFloat, we can keep them; parseFloat
        // returns same f64 either way.
        let mantissa = if tail.is_empty() {
            head.to_string()
        } else {
            format!("{head}.{tail}")
        };
        let exp_sign = if exp >= 0 { "+" } else { "-" };
        format!("{sign}{mantissa}e{exp_sign}{}", exp.abs())
    } else if exp >= 0 {
        // Integer or fixed-point with exp+1 digits before decimal.
        let head_len = (exp as usize) + 1;
        if head_len >= digits.len() {
            // All digits before decimal; pad with zeros.
            let pad = "0".repeat(head_len - digits.len());
            format!("{sign}{digits}{pad}")
        } else {
            let head = &digits[..head_len];
            let tail = &digits[head_len..];
            format!("{sign}{head}.{tail}")
        }
    } else {
        // 0.000ddd format. exp=-1 -> 0.d... ; exp=-2 -> 0.0d... etc.
        let leading_zeros = (-exp - 1) as usize;
        let zeros = "0".repeat(leading_zeros);
        format!("{sign}0.{zeros}{digits}")
    }
}

fn to_exponential(value: f64) -> String {
    // JS Number.toExponential() with no arg: shortest round-trip in
    // exponential form. ryu_js's Buffer::format uses scientific form when
    // appropriate; force scientific by using format with explicit %e.
    if value == 0.0 {
        return "0e+0".to_string();
    }
    // Fall back to manual: get JS-style normalized then convert.
    // Use ryu_js's scientific output if it picked it, else build one.
    let mut buf = ryu_js::Buffer::new();
    let s = buf.format(value).to_string();
    if s.contains('e') {
        return s;
    }
    // Convert plain decimal form to scientific.
    decimal_to_exponential(&s)
}

fn decimal_to_exponential(s: &str) -> String {
    // Parse sign
    let (sign, rest) = if let Some(stripped) = s.strip_prefix('-') {
        ("-", stripped)
    } else {
        ("", s)
    };
    // Split int and frac
    let (int_part, frac_part) = if let Some((i, f)) = rest.split_once('.') {
        (i.to_string(), f.to_string())
    } else {
        (rest.to_string(), String::new())
    };
    // Find the first non-zero digit position
    let combined: String = format!("{int_part}{frac_part}");
    let int_len = int_part.len();
    let mut first_nonzero = None;
    for (i, c) in combined.chars().enumerate() {
        if c != '0' {
            first_nonzero = Some(i);
            break;
        }
    }
    let Some(first_nonzero) = first_nonzero else {
        return format!("{sign}0e+0");
    };
    // Exponent = (int_len - 1) - first_nonzero  if first_nonzero < int_len
    //          = -(first_nonzero - int_len + 1) otherwise
    let exp: i32 = if first_nonzero < int_len {
        (int_len as i32 - 1) - first_nonzero as i32
    } else {
        -((first_nonzero as i32 - int_len as i32) + 1)
    };
    // Mantissa: digit at first_nonzero, then optional ".rest"
    let mantissa_digits: String = combined.chars().skip(first_nonzero).collect();
    let trimmed = mantissa_digits.trim_end_matches('0');
    let head = trimmed.chars().next().unwrap_or('0');
    let rest_m: String = trimmed.chars().skip(1).collect();
    let mantissa = if rest_m.is_empty() {
        head.to_string()
    } else {
        format!("{head}.{rest_m}")
    };
    let exp_sign = if exp >= 0 { "+" } else { "-" };
    format!("{sign}{mantissa}e{exp_sign}{}", exp.abs())
}

fn collapse_zero_mantissa(s: &str) -> String {
    // /\.0+e/  ->  "e"
    if let Some(idx) = s.find(".0") {
        // Verify everything between idx+1 and the 'e' is zeros.
        let after_dot = &s[idx + 1..];
        if let Some(e_idx) = after_dot.find('e') {
            let zeros = &after_dot[..e_idx];
            if zeros.chars().all(|c| c == '0') {
                let mut out = String::with_capacity(s.len());
                out.push_str(&s[..idx]);
                out.push('e');
                out.push_str(&after_dot[e_idx + 1..]);
                return out;
            }
        }
    }
    s.to_string()
}

fn strip_exp_leading_zeros(s: &str) -> String {
    // /e([+-])0+/ -> "e$1"
    if let Some(e_idx) = s.find('e') {
        let after_e = &s[e_idx + 1..];
        let mut chars = after_e.chars();
        let first = chars.next();
        if let Some(sign) = first {
            if sign == '+' || sign == '-' {
                let rest: String = chars.collect();
                let stripped = rest.trim_start_matches('0');
                let final_rest = if stripped.is_empty() { "0" } else { stripped };
                let mut out = String::with_capacity(s.len());
                out.push_str(&s[..e_idx]);
                out.push('e');
                out.push(sign);
                out.push_str(final_rest);
                return out;
            }
        }
    }
    s.to_string()
}

// ---- main entry ---------------------------------------------------------

/// Internal Rust-side result; not directly returned across the boundary.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineV2Result {
    pub app_csv_bytes: Arc<Vec<u8>>,
    pub screen_csv_bytes: Arc<Vec<u8>>,
    pub day_coverage_csv_bytes: Arc<Vec<u8>>,
    pub compliance_csv_bytes: Arc<Vec<u8>>,
    pub credited_app_csv_bytes: Arc<Vec<u8>>,
    pub review_summary_json_bytes: Arc<Vec<u8>>,
    pub visualization_data_json_bytes: Arc<Vec<u8>>,
    pub aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput>>,
    pub row_lineage: Arc<Vec<PipelineRowLineage>>,
    pub original_row_count: u32,
    pub processed_row_count: u32,
    pub app_row_count: u32,
    pub screen_row_count: u32,
    pub day_coverage_row_count: u32,
    pub compliance_row_count: u32,
    pub credited_app_row_count: u32,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    /// Exact retained raw-row membership after timezone filtering and before
    /// any conversion or downstream transformation.
    pub timezone_retained_source_rows_digest: String,
    /// Exact normalized-event state after the timezone policy has resolved its
    /// target and populated local calendar fields, before dedupe/order.
    pub timezone_stage_digest: String,
    /// Product-local semantic checkpoints at the fifteen logical DAG joints.
    /// These are complete hashes of the state emitted by that specific stage,
    /// not a copy of the final fused-pipeline digest. They let the incremental
    /// scheduler stop a configuration perturbation as soon as the actual stage
    /// value converges while retaining the fused Rust implementation.
    pub logical_stage_digests: BTreeMap<String, String>,
    /// Typed decomposition of every logical checkpoint. The terminal digest
    /// above commits to these exact component digests.
    pub logical_stage_checkpoints: BTreeMap<String, LogicalStageCheckpoint>,
    /// Exact results at the 55 real preprocessing steps. The fifteen logical
    /// stage maps above are retained temporarily for compatibility and will be
    /// derived from these step results.
    pub pipeline_step_digests: BTreeMap<String, String>,
    pub pipeline_step_checkpoints: BTreeMap<String, LogicalStageCheckpoint>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalStageCheckpoint {
    pub protocol_version: String,
    pub node_id: String,
    pub row_membership_digest: String,
    pub row_order_digest: String,
    pub temporal_state_digest: String,
    pub classification_digest: String,
    pub payload_digest: String,
    pub schema_digest: String,
    pub terminal_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRowLineage {
    pub output_kind: Arc<String>,
    pub output_row_index: u32,
    pub source_data_row_ranges: Vec<SourceDataRowRange>,
    pub source_data_row_count: u32,
    pub searches: Vec<LineageSearchEvidence>,
    pub terminal_logical_node: Arc<String>,
}

fn build_row_lineage(
    output_kind: &'static str,
    terminal_logical_node: &'static str,
    rows: &[Row],
) -> Vec<PipelineRowLineage> {
    build_row_lineage_from_iter(output_kind, terminal_logical_node, rows.iter())
}

fn build_row_lineage_from_iter<'a>(
    output_kind: &'static str,
    terminal_logical_node: &'static str,
    rows: impl Iterator<Item = &'a Row>,
) -> Vec<PipelineRowLineage> {
    let output_kind = Arc::new(output_kind.to_owned());
    let terminal_logical_node = Arc::new(terminal_logical_node.to_owned());
    rows.enumerate()
        .map(|(index, row)| PipelineRowLineage {
            output_kind: Arc::clone(&output_kind),
            output_row_index: index as u32,
            source_data_row_ranges: row.source_data_rows.ranges().to_vec(),
            source_data_row_count: row.source_data_rows.len() as u32,
            searches: row.lineage_searches.iter().cloned().collect(),
            terminal_logical_node: Arc::clone(&terminal_logical_node),
        })
        .collect()
}

trait CheckpointSink {
    fn checkpoint_update(&mut self, bytes: &[u8]);
}

// Batch the many small row encodings into larger updates before they reach
// the fingerprint hasher, so per-call overhead cannot dominate (measured at
// +420 ms per WASM cold execute when 24-48 byte writes hit the hasher raw at
// the runtime crate's opt-level 2). This is not a second hash or a cache
// shortcut: the exact same protocol bytes reach the hasher.
const CHECKPOINT_HASH_BUFFER_BYTES: usize = 16 * 1024;

struct BufferedCheckpointHasher {
    hasher: Xxh3,
    pending: Vec<u8>,
}

impl BufferedCheckpointHasher {
    fn new() -> Self {
        Self {
            hasher: Xxh3::new(),
            pending: Vec::with_capacity(CHECKPOINT_HASH_BUFFER_BYTES),
        }
    }

    #[inline]
    fn update(&mut self, bytes: &[u8]) {
        self.checkpoint_update(bytes);
    }

    #[inline]
    fn flush(&mut self) {
        if !self.pending.is_empty() {
            self.hasher.update(&self.pending);
            self.pending.clear();
        }
    }

    fn finalize128(mut self) -> u128 {
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
struct FingerprintSink {
    hasher: Xxh3,
    buffer: [u8; 4096],
    len: usize,
}

impl FingerprintSink {
    fn new() -> Self {
        Self {
            hasher: Xxh3::new(),
            buffer: [0_u8; 4096],
            len: 0,
        }
    }

    fn write(&mut self, data: &[u8]) {
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

    fn tag(&mut self, tag: u8) {
        if self.len == self.buffer.len() {
            self.flush();
        }
        self.buffer[self.len] = tag;
        self.len += 1;
    }

    fn frame(&mut self, tag: u8, data: &[u8]) {
        self.tag(tag);
        self.write(&(data.len() as u64).to_le_bytes());
        self.write(data);
    }

    fn flush(&mut self) {
        if self.len > 0 {
            self.hasher.update(&self.buffer[..self.len]);
            self.len = 0;
        }
    }

    fn finish(mut self) -> u128 {
        self.flush();
        self.hasher.digest128()
    }
}

#[derive(Debug)]
struct FingerprintError(String);

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

struct FingerprintSerializer<'a> {
    sink: &'a mut FingerprintSink,
}

impl FingerprintSerializer<'_> {
    fn scalar(self, tag: u8, bytes: &[u8]) -> Result<(), FingerprintError> {
        self.sink.tag(tag);
        self.sink.write(bytes);
        Ok(())
    }
}

/// Compound serializer used for every seq/tuple/map/struct shape. Each
/// element is preceded by a 1 marker and the compound ends with a 0 marker,
/// so unknown-length sequences hash injectively without a length prefix.
struct FingerprintCompound<'a> {
    sink: &'a mut FingerprintSink,
}

impl FingerprintCompound<'_> {
    fn element<T: serde::Serialize + ?Sized>(&mut self, value: &T) -> Result<(), FingerprintError> {
        self.sink.tag(1);
        value.serialize(FingerprintSerializer { sink: self.sink })
    }

    fn finish(self) -> Result<(), FingerprintError> {
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

    fn serialize_seq(self, _len: Option<usize>) -> Result<FingerprintCompound<'a>, FingerprintError> {
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

    fn serialize_map(self, _len: Option<usize>) -> Result<FingerprintCompound<'a>, FingerprintError> {
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
                    self.buffer[self.len..self.len + text.len()]
                        .copy_from_slice(text.as_bytes());
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

struct DiscardCheckpointSink;

impl CheckpointSink for DiscardCheckpointSink {
    #[inline(always)]
    fn checkpoint_update(&mut self, _bytes: &[u8]) {}
}

fn checkpoint_update(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(bytes);
}

fn checkpoint_digest_field(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(&(bytes.len() as u64).to_le_bytes());
    sink.checkpoint_update(bytes);
}

fn checkpoint_digest_fixed16(hasher: &mut impl CheckpointSink, value: &[u8; 16]) {
    let mut encoded = [0_u8; 24];
    encoded[..8].copy_from_slice(&16_u64.to_le_bytes());
    encoded[8..].copy_from_slice(value);
    hasher.checkpoint_update(&encoded);
}

fn checkpoint_digest_positioned_fixed16(
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

fn checkpoint_digest_positioned_fixed16_triple(
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

fn checkpoint_digest_optional_string(sink: &mut impl CheckpointSink, value: Option<&str>) {
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

fn checkpoint_digest_optional_i64(sink: &mut impl CheckpointSink, value: Option<i64>) {
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

fn checkpoint_digest_optional_f64(sink: &mut impl CheckpointSink, value: Option<f64>) {
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

const LOGICAL_STAGE_CHECKPOINT_PROTOCOL: &str = "chronicle-logical-stage-checkpoint/v7";
const LOGICAL_STAGE_ROW_SCHEMA: &str = concat!(
    "association:source_data_rows,index;",
    "membership:source_data_rows;",
    "order:index,position;",
    "temporal:event_timestamp_ns,timezone,data_time_gap_hours,date,day,weekday_mf,",
    "weekday_mth,weekday_su_th,hour,quarter,start_timestamp_ns,stop_timestamp_ns,",
    "duration_seconds,duration_minutes,screen_usage_last_activity_timestamp_ns,",
    "screen_usage_tail_gap_seconds,valid_app_usage_time_gap_hours,",
    "any_app_usage_time_gap_hours;",
    "classification:study_id,participant_id,possible_device_model,username,",
    "application_label,interaction_type,app_package_name,screen_usage_end_reason,",
    "screen_usage_end_reason_confidence,screen_usage_stop_event_type,",
    "screen_usage_foreground_app_package,screen_usage_apps_forcing_screen_open_label,",
    "screen_usage_lock_screen_only,any_app_usage_flags,valid_app_new_engage_30s,",
    "valid_app_new_engage_custom,valid_app_switched_app,any_app_new_engage_30s,",
    "any_app_new_engage_custom,any_app_switched_app,genre_id_scraped,",
    "broad_app_category,codebook_fields,usage_layer"
);

fn checkpoint_hasher(component: &str) -> BufferedCheckpointHasher {
    let mut hasher = BufferedCheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, LOGICAL_STAGE_CHECKPOINT_PROTOCOL.as_bytes());
    checkpoint_digest_field(&mut hasher, component.as_bytes());
    hasher
}

fn finish_checkpoint_digest(hasher: BufferedCheckpointHasher) -> String {
    format!("xxh3:{:032x}", hasher.finalize128())
}

fn terminal_checkpoint_digest(node_id: &str, component_digests: [&str; 6]) -> String {
    let mut terminal = Sha256::new();
    sha256_digest_field(&mut terminal, LOGICAL_STAGE_CHECKPOINT_PROTOCOL.as_bytes());
    sha256_digest_field(&mut terminal, node_id.as_bytes());
    sha256_digest_field(&mut terminal, b"terminal");
    for digest in component_digests {
        sha256_digest_field(&mut terminal, digest.as_bytes());
    }
    format!("sha256:{}", hex::encode(terminal.finalize()))
}

fn sha256_digest_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RowCheckpointParts {
    identity: [u8; 16],
    temporal: [u8; 16],
    classification: [u8; 16],
}

struct RowCheckpointScratch {
    identity: Vec<u8>,
    temporal: Vec<u8>,
    classification: Vec<u8>,
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
fn encode_row_checkpoint_parts<I: CheckpointSink, T: CheckpointSink, C: CheckpointSink>(
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
        screen_usage_end_reason,
        screen_usage_end_reason_confidence,
        screen_usage_stop_event_type,
        screen_usage_last_activity_timestamp_ns,
        screen_usage_tail_gap_seconds,
        screen_usage_foreground_app_package,
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

    checkpoint_digest_field(temporal, b"chronicle-row-temporal/v2");
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

    checkpoint_digest_field(classification, b"chronicle-row-classification/v2");
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
        // absent field. Append it as one block instead of 28 tiny writes.
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
}

impl RowCheckpointScratch {
    fn compute_parts(&mut self, row: &Row) -> RowCheckpointParts {
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

fn row_checkpoint_parts(row: &Row, scratch: &mut RowCheckpointScratch) -> RowCheckpointParts {
    scratch.compute_parts(row)
}

fn row_checkpoint_parts_for_rows(rows: &[Row]) -> Vec<RowCheckpointParts> {
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

fn row_parts_sequence_digest<'a>(
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

fn row_reference_sequence_digest(rows: &[&Row]) -> String {
    let mut scratch = RowCheckpointScratch::default();
    let parts = rows
        .iter()
        .map(|row| row_checkpoint_parts(row, &mut scratch))
        .collect::<Vec<_>>();
    row_parts_sequence_digest(parts.len(), parts.iter())
}

fn logical_stage_checkpoint(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
) -> LogicalStageCheckpoint {
    logical_stage_checkpoint_with_parts(node_id, row_groups, payloads, None)
}

fn logical_stage_checkpoint_with_parts(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
    single_group_parts: Option<&[RowCheckpointParts]>,
) -> LogicalStageCheckpoint {
    if let Some(parts) = single_group_parts {
        let group_parts = [parts];
        logical_stage_checkpoint_with_group_parts(
            node_id,
            row_groups,
            payloads,
            Some(&group_parts),
            None,
            None,
        )
    } else {
        logical_stage_checkpoint_with_group_parts(node_id, row_groups, payloads, None, None, None)
    }
}

fn logical_stage_rows_checkpoint_with_parts_and_canonical_order(
    node_id: &str,
    rows: &[Row],
    parts: &[RowCheckpointParts],
    canonical_order: &[usize],
) -> LogicalStageCheckpoint {
    let group_parts = [parts];
    logical_stage_checkpoint_with_group_parts(
        node_id,
        &[("rows", rows)],
        &[],
        Some(&group_parts),
        None,
        Some(canonical_order),
    )
}

fn logical_stage_checkpoint_with_reusable_parts(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    parts: &[RowCheckpointParts],
    previous_parts: &[RowCheckpointParts],
    previous_checkpoint: &LogicalStageCheckpoint,
) -> LogicalStageCheckpoint {
    let group_parts = [parts];
    logical_stage_checkpoint_with_group_parts(
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

fn logical_stage_checkpoint_with_reusable_rows(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    parts: &[RowCheckpointParts],
    previous_rows: &[Row],
    previous_checkpoint: &LogicalStageCheckpoint,
) -> LogicalStageCheckpoint {
    let group_parts = [parts];
    logical_stage_checkpoint_with_group_parts(
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

fn logical_stage_checkpoint_with_known_membership_and_order(
    node_id: &str,
    rows: &[Row],
    payloads: &[(&str, &[u8])],
    previous_rows: &[Row],
    previous_checkpoint: &LogicalStageCheckpoint,
) -> LogicalStageCheckpoint {
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
    logical_stage_checkpoint_with_group_parts(
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
struct PreviousRowState<'a> {
    checkpoint: &'a LogicalStageCheckpoint,
    reusable_components: (bool, bool, bool, bool),
}

fn reusable_row_components_from_parts(
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

fn reusable_row_components_from_rows(
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

fn logical_stage_checkpoint_with_group_parts(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
    group_parts: Option<&[&[RowCheckpointParts]]>,
    previous_row_state: Option<PreviousRowState<'_>>,
    single_group_canonical_order: Option<&[usize]>,
) -> LogicalStageCheckpoint {
    debug_assert!(
        single_group_canonical_order.is_none() || row_groups.len() == 1,
        "a supplied canonical order is valid only for one row group"
    );
    let (reuse_membership, reuse_order, reuse_temporal, reuse_classification) =
        match previous_row_state {
            Some(previous) => {
                debug_assert_eq!(
                    previous.checkpoint.protocol_version,
                    LOGICAL_STAGE_CHECKPOINT_PROTOCOL
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
    checkpoint_digest_field(&mut schema, LOGICAL_STAGE_ROW_SCHEMA.as_bytes());
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
                    identity_order.sort_by(|left, right| {
                        rows[*left]
                            .source_data_rows
                            .cmp_expanded(&rows[*right].source_data_rows)
                            .then(rows[*left].index.cmp(&rows[*right].index))
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
                identity_order.sort_by(|left, right| {
                    rows[*left]
                        .source_data_rows
                        .cmp_expanded(&rows[*right].source_data_rows)
                        .then(rows[*left].index.cmp(&rows[*right].index))
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
    LogicalStageCheckpoint {
        protocol_version: LOGICAL_STAGE_CHECKPOINT_PROTOCOL.into(),
        node_id: node_id.into(),
        row_membership_digest,
        row_order_digest,
        temporal_state_digest,
        classification_digest,
        payload_digest,
        schema_digest,
        terminal_digest,
    }
}

fn checkpoint_for_exact_row_state(
    node_id: &str,
    previous: &LogicalStageCheckpoint,
    payloads: &[(&str, &[u8])],
) -> LogicalStageCheckpoint {
    debug_assert_eq!(previous.protocol_version, LOGICAL_STAGE_CHECKPOINT_PROTOCOL);
    let mut payload = checkpoint_hasher("payload");
    let mut schema = checkpoint_hasher("schema");
    checkpoint_digest_field(&mut schema, LOGICAL_STAGE_ROW_SCHEMA.as_bytes());
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
    LogicalStageCheckpoint {
        protocol_version: LOGICAL_STAGE_CHECKPOINT_PROTOCOL.into(),
        node_id: node_id.into(),
        row_membership_digest,
        row_order_digest,
        temporal_state_digest,
        classification_digest,
        payload_digest,
        schema_digest,
        terminal_digest,
    }
}

fn checkpoint_for_exact_state(
    node_id: &str,
    previous: &LogicalStageCheckpoint,
) -> LogicalStageCheckpoint {
    debug_assert_eq!(previous.protocol_version, LOGICAL_STAGE_CHECKPOINT_PROTOCOL);
    let mut checkpoint = previous.clone();
    checkpoint.node_id = node_id.into();
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

fn checkpoint_for_reordered_exact_rows(
    node_id: &str,
    rows: &[Row],
    previous: &LogicalStageCheckpoint,
) -> LogicalStageCheckpoint {
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

fn logical_stage_rows_checkpoint(node_id: &str, rows: &[Row]) -> LogicalStageCheckpoint {
    logical_stage_checkpoint(node_id, &[("rows", rows)], &[])
}

fn logical_stage_rows_checkpoint_reusing_last(
    node_id: &str,
    rows: &[Row],
    recorder: &StepCheckpointRecorder<'_>,
) -> LogicalStageCheckpoint {
    match recorder.reusable_row_components(rows) {
        Some((parts, checkpoint)) => logical_stage_checkpoint_with_reusable_parts(
            node_id,
            rows,
            &[],
            parts,
            parts,
            checkpoint,
        ),
        None => logical_stage_rows_checkpoint(node_id, rows),
    }
}

fn logical_stage_state_checkpoint(node_id: &str, state: &str) -> LogicalStageCheckpoint {
    logical_stage_checkpoint(node_id, &[], &[("state", state.as_bytes())])
}

fn record_logical_stage_checkpoint(
    digests: &mut BTreeMap<String, String>,
    checkpoints: &mut BTreeMap<String, LogicalStageCheckpoint>,
    checkpoint: LogicalStageCheckpoint,
) {
    digests.insert(
        checkpoint.node_id.clone(),
        checkpoint.terminal_digest.clone(),
    );
    checkpoints.insert(checkpoint.node_id.clone(), checkpoint);
}

struct StepCheckpointRecorder<'a> {
    digests: &'a mut BTreeMap<String, String>,
    checkpoints: &'a mut BTreeMap<String, LogicalStageCheckpoint>,
    next_step_index: usize,
    error: Option<String>,
    last_row_parts: Option<Vec<RowCheckpointParts>>,
    last_row_checkpoint: Option<LogicalStageCheckpoint>,
}

impl StepCheckpointRecorder<'_> {
    fn rows(&mut self, step_id: &str, rows: &[Row]) {
        let parts = row_checkpoint_parts_for_rows(rows);
        let checkpoint = if let (Some(previous_parts), Some(previous_checkpoint)) = (
            self.last_row_parts.as_deref(),
            self.last_row_checkpoint.as_ref(),
        ) {
            logical_stage_checkpoint_with_reusable_parts(
                step_id,
                rows,
                &[],
                &parts,
                previous_parts,
                previous_checkpoint,
            )
        } else {
            logical_stage_checkpoint_with_parts(step_id, &[("rows", rows)], &[], Some(&parts))
        };
        self.last_row_parts = Some(parts);
        self.last_row_checkpoint = Some(checkpoint.clone());
        self.record(checkpoint);
    }

    fn state(&mut self, step_id: &str, state: &str) {
        self.record(logical_stage_state_checkpoint(step_id, state));
    }

    fn value<T: serde::Serialize>(&mut self, step_id: &str, value: &T) -> Result<(), String> {
        let fingerprint = value_fingerprint(value)
            .map_err(|error| format!("serialize {step_id} checkpoint: {error}"))?;
        self.record(logical_stage_checkpoint(step_id, &[], &[("value", &fingerprint)]));
        Ok(())
    }

    fn rows_and_value<T: serde::Serialize>(
        &mut self,
        step_id: &str,
        rows: &[Row],
        value: &T,
    ) -> Result<(), String> {
        let fingerprint = value_fingerprint(value)
            .map_err(|error| format!("serialize {step_id} checkpoint: {error}"))?;
        let parts = row_checkpoint_parts_for_rows(rows);
        let payloads = [("value", fingerprint.as_slice())];
        let checkpoint = if let (Some(previous_parts), Some(previous_checkpoint)) = (
            self.last_row_parts.as_deref(),
            self.last_row_checkpoint.as_ref(),
        ) {
            logical_stage_checkpoint_with_reusable_parts(
                step_id,
                rows,
                &payloads,
                &parts,
                previous_parts,
                previous_checkpoint,
            )
        } else {
            logical_stage_checkpoint_with_parts(step_id, &[("rows", rows)], &payloads, Some(&parts))
        };
        self.last_row_parts = Some(parts);
        self.last_row_checkpoint = Some(checkpoint.clone());
        self.record(checkpoint);
        Ok(())
    }

    fn last_row_parts(&self) -> Option<&[RowCheckpointParts]> {
        self.last_row_parts.as_deref()
    }

    fn take_last_row_parts(&mut self) -> Option<Vec<RowCheckpointParts>> {
        self.last_row_checkpoint = None;
        self.last_row_parts.take()
    }

    fn reusable_row_components(
        &self,
        rows: &[Row],
    ) -> Option<(&[RowCheckpointParts], &LogicalStageCheckpoint)> {
        let parts = self.last_row_parts.as_deref()?;
        if parts.len() != rows.len() {
            return None;
        }
        #[cfg(debug_assertions)]
        assert_eq!(
            parts,
            row_checkpoint_parts_for_rows(rows),
            "attempted to reuse stale row checkpoint components"
        );
        Some((parts, self.last_row_checkpoint.as_ref()?))
    }

    fn record(&mut self, checkpoint: LogicalStageCheckpoint) {
        if self.error.is_some() {
            return;
        }
        let Some(expected) = crate::step_contract::PIPELINE_STEPS.get(self.next_step_index) else {
            self.error = Some(format!(
                "unexpected extra pipeline step checkpoint {:?}",
                checkpoint.node_id
            ));
            return;
        };
        if checkpoint.node_id != expected.id {
            self.error = Some(format!(
                "pipeline step checkpoint order mismatch at {}: expected {:?}, recorded {:?}",
                self.next_step_index, expected.id, checkpoint.node_id
            ));
            return;
        }
        if self.checkpoints.contains_key(&checkpoint.node_id) {
            self.error = Some(format!(
                "duplicate pipeline step checkpoint {:?}",
                checkpoint.node_id
            ));
            return;
        }
        record_logical_stage_checkpoint(self.digests, self.checkpoints, checkpoint);
        self.next_step_index += 1;
    }

    fn finish(self) -> Result<(), String> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if self.next_step_index != crate::step_contract::PIPELINE_STEPS.len() {
            return Err(format!(
                "pipeline step checkpoint sequence stopped at {} of {} steps",
                self.next_step_index,
                crate::step_contract::PIPELINE_STEPS.len()
            ));
        }
        Ok(())
    }
}

fn timezone_retained_source_rows_digest(rows: &[Row]) -> String {
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
fn timezone_stage_digest(rows: &[Row]) -> String {
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewSummary {
    participants: Vec<ReviewParticipantSummary>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewParticipantSummary {
    participant_id: SharedString,
    study_id: SharedString,
    totals: ReviewParticipantTotals,
    per_day: Vec<ReviewDayMetrics>,
    top_apps_by_date: BTreeMap<SharedString, Vec<ReviewTopApp>>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewParticipantTotals {
    app_usage_minutes: f64,
    background_app_usage_minutes: f64,
    screen_usage_minutes: f64,
    app_session_count: usize,
    screen_session_count: usize,
    days_with_usage: usize,
    total_days: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDayMetrics {
    date: SharedString,
    app_usage_minutes: f64,
    background_app_usage_minutes: f64,
    screen_usage_minutes: f64,
    app_session_count: usize,
    screen_session_count: usize,
    flags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewTopApp {
    app_package_name: SharedString,
    application_label: SharedString,
    category: Option<SharedString>,
    minutes: f64,
}

#[derive(Default)]
struct ReviewDayAccumulator {
    app_ns: i128,
    background_ns: i128,
    screen_ns: i128,
    app_session_count: usize,
    screen_session_count: usize,
}

struct ReviewTopAppAccumulator {
    application_label: SharedString,
    category: Option<SharedString>,
    minutes: f64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VisualizationData<'a> {
    protocol_version: &'static str,
    columns: &'static [&'static str],
    app_rows: Vec<VisualizationRow<'a>>,
    screen_rows: Vec<VisualizationRow<'a>>,
    event_timestamps_by_participant: BTreeMap<&'a str, Vec<JsonI64>>,
}

#[derive(Debug, Clone, Copy)]
struct JsonI64(i64);

impl serde::Serialize for JsonI64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(&self.0)
    }
}

const VISUALIZATION_DATA_PROTOCOL: &str = "chronicle-visualization-data/v2";
const VISUALIZATION_DATA_COLUMNS: &[&str] = &[
    "participantId",
    "date",
    "startTimestampNs",
    "stopTimestampNs",
    "eventTimestampNs",
    "interactionType",
    "broadAppCategory",
    "appPackageName",
    "applicationLabel",
    "username",
    "screenUsageEndReason",
];

#[derive(Debug, serde::Serialize)]
struct VisualizationRow<'a>(
    &'a str,
    &'a str,
    Option<JsonI64>,
    Option<JsonI64>,
    JsonI64,
    &'a str,
    Option<&'a str>,
    &'a str,
    &'a str,
    &'a str,
    Option<&'a str>,
);

fn visualization_row(row: &Row) -> VisualizationRow<'_> {
    VisualizationRow(
        row.participant_id.as_str(),
        row.date.as_str(),
        row.start_timestamp_ns.map(JsonI64),
        row.stop_timestamp_ns.map(JsonI64),
        JsonI64(row.event_timestamp_ns),
        row.interaction_type.as_str(),
        row.broad_app_category.as_ref().map(SharedString::as_str),
        row.app_package_name.as_str(),
        row.application_label.as_str(),
        row.username.as_str(),
        row.screen_usage_end_reason
            .as_ref()
            .map(SharedString::as_str),
    )
}

fn build_visualization_data<'a>(
    app_rows: &'a [Row],
    screen_rows: &'a [Row],
    policy_rows: &'a [Row],
) -> VisualizationData<'a> {
    let mut event_timestamps_by_participant = BTreeMap::<&str, Vec<JsonI64>>::new();
    for row in policy_rows {
        event_timestamps_by_participant
            .entry(if row.participant_id.is_empty() {
                "unknown"
            } else {
                row.participant_id.as_str()
            })
            .or_default()
            .push(JsonI64(row.event_timestamp_ns));
    }
    VisualizationData {
        protocol_version: VISUALIZATION_DATA_PROTOCOL,
        columns: VISUALIZATION_DATA_COLUMNS,
        app_rows: app_rows.iter().map(visualization_row).collect(),
        screen_rows: screen_rows.iter().map(visualization_row).collect(),
        event_timestamps_by_participant,
    }
}

fn review_round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn complete_session(row: &Row, interaction_type: &str) -> bool {
    row.interaction_type == interaction_type
        && row.start_timestamp_ns.is_some()
        && row.stop_timestamp_ns.is_some()
}

fn review_duration_ns(row: &Row) -> i128 {
    if row.duration_minutes.is_none() {
        return 0;
    }
    i128::from(row.stop_timestamp_ns.unwrap_or_default())
        - i128::from(row.start_timestamp_ns.unwrap_or_default())
}

fn review_minutes(ns: i128) -> f64 {
    review_round4(ns as f64 / 60_000_000_000.0)
}

fn build_review_summary(app_rows: &[Row], screen_rows: &[Row]) -> ReviewSummary {
    type ParticipantKey = (SharedString, SharedString);
    type DayKey = (SharedString, SharedString, SharedString);
    // Accumulation order is irrelevant: the emitted participant/day maps are
    // sorted below, and each top-app list has an explicit deterministic sort.
    // Hash maps avoid doing tree comparisons for every one of the tens of
    // thousands of review rows while preserving byte-identical JSON.
    let mut days = AHashMap::<DayKey, ReviewDayAccumulator>::new();
    let mut apps_by_participant = AHashMap::<
        ParticipantKey,
        AHashMap<SharedString, AHashMap<SharedString, ReviewTopAppAccumulator>>,
    >::new();

    for row in app_rows {
        let key = (
            row.study_id.clone(),
            row.participant_id.clone(),
            row.date.clone(),
        );
        // The review day-detail intentionally includes any emitted app row
        // with a measured duration (including explicitly labeled filtered or
        // non-target rows), even though headline usage totals remain limited
        // to App Usage sessions.
        if let Some(minutes) = row.duration_minutes {
            let entry = apps_by_participant
                .entry((key.0.clone(), key.1.clone()))
                .or_insert_with(AHashMap::new)
                .entry(key.2.clone())
                .or_insert_with(AHashMap::new)
                .entry(row.app_package_name.clone())
                .or_insert_with(|| ReviewTopAppAccumulator {
                    application_label: row.application_label.clone(),
                    category: row.broad_app_category.clone(),
                    minutes: 0.0,
                });
            entry.minutes += minutes;
        }
        if !complete_session(row, APP_USAGE) {
            continue;
        }
        let day = days.entry(key).or_default();
        if row.usage_layer.as_deref() == Some("secondary") {
            day.background_ns += review_duration_ns(row);
        } else {
            day.app_ns += review_duration_ns(row);
            day.app_session_count += 1;
        }
    }
    for row in screen_rows {
        if !complete_session(row, SCREEN_USAGE) {
            continue;
        }
        let key = (
            row.study_id.clone(),
            row.participant_id.clone(),
            row.date.clone(),
        );
        let day = days.entry(key).or_default();
        day.screen_ns += review_duration_ns(row);
        day.screen_session_count += 1;
    }

    let mut observed = BTreeMap::<ParticipantKey, BTreeMap<SharedString, ReviewDayMetrics>>::new();
    for ((study_id, participant_id, date), day) in days {
        observed
            .entry((study_id, participant_id))
            .or_default()
            .insert(
                date.clone(),
                ReviewDayMetrics {
                    date,
                    app_usage_minutes: review_minutes(day.app_ns),
                    background_app_usage_minutes: review_minutes(day.background_ns),
                    screen_usage_minutes: review_minutes(day.screen_ns),
                    app_session_count: day.app_session_count,
                    screen_session_count: day.screen_session_count,
                    flags: Vec::new(),
                },
            );
    }

    let mut participants = Vec::new();
    for ((study_id, participant_id), observed_days) in observed {
        let first = observed_days
            .keys()
            .next()
            .map(SharedString::as_str)
            .unwrap_or_default();
        let last = observed_days
            .keys()
            .next_back()
            .map(SharedString::as_str)
            .unwrap_or_default();
        let mut per_day = Vec::new();
        if let (Ok(mut cursor), Ok(end)) = (
            NaiveDate::parse_from_str(first, "%Y-%m-%d"),
            NaiveDate::parse_from_str(last, "%Y-%m-%d"),
        ) {
            while cursor <= end {
                let date = cursor.format("%Y-%m-%d").to_string();
                per_day.push(observed_days.get(date.as_str()).cloned().unwrap_or(
                    ReviewDayMetrics {
                        date: SharedString::from(date),
                        app_usage_minutes: 0.0,
                        background_app_usage_minutes: 0.0,
                        screen_usage_minutes: 0.0,
                        app_session_count: 0,
                        screen_session_count: 0,
                        flags: vec!["no_usage_day".into()],
                    },
                ));
                cursor += Duration::days(1);
            }
        }

        let mut totals = ReviewParticipantTotals {
            app_usage_minutes: 0.0,
            background_app_usage_minutes: 0.0,
            screen_usage_minutes: 0.0,
            app_session_count: 0,
            screen_session_count: 0,
            days_with_usage: 0,
            total_days: per_day.len(),
        };
        for day in &per_day {
            totals.app_usage_minutes += day.app_usage_minutes;
            totals.background_app_usage_minutes += day.background_app_usage_minutes;
            totals.screen_usage_minutes += day.screen_usage_minutes;
            totals.app_session_count += day.app_session_count;
            totals.screen_session_count += day.screen_session_count;
            if day.app_session_count + day.screen_session_count > 0
                || day.background_app_usage_minutes > 0.0
            {
                totals.days_with_usage += 1;
            }
        }
        totals.app_usage_minutes = review_round4(totals.app_usage_minutes);
        totals.background_app_usage_minutes = review_round4(totals.background_app_usage_minutes);
        totals.screen_usage_minutes = review_round4(totals.screen_usage_minutes);

        let mut top_apps_by_date = BTreeMap::new();
        for date in observed_days.keys() {
            let Some(by_package) = apps_by_participant
                .get(&(study_id.clone(), participant_id.clone()))
                .and_then(|days| days.get(date))
            else {
                continue;
            };
            let mut top_apps: Vec<_> = by_package
                .iter()
                .map(|(app_package_name, accumulated)| ReviewTopApp {
                    app_package_name: app_package_name.clone(),
                    application_label: accumulated.application_label.clone(),
                    category: accumulated.category.clone(),
                    minutes: review_round4(accumulated.minutes),
                })
                .collect();
            top_apps.sort_by(|left, right| {
                right
                    .minutes
                    .total_cmp(&left.minutes)
                    .then_with(|| left.app_package_name.cmp(&right.app_package_name))
            });
            top_apps.truncate(12);
            if !top_apps.is_empty() {
                top_apps_by_date.insert(date.clone(), top_apps);
            }
        }

        participants.push(ReviewParticipantSummary {
            participant_id,
            study_id,
            totals,
            per_day,
            top_apps_by_date,
        });
    }
    participants.sort_by(|left, right| left.participant_id.cmp(&right.participant_id));
    ReviewSummary { participants }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PipelineV2SupportFiles<'a> {
    pub filter_csv: &'a [u8],
    pub apps_forcing_csv: &'a [u8],
    pub background_apps_csv: &'a [u8],
    pub codebook_csv: &'a [u8],
    pub study_dates_csv: &'a [u8],
    pub device_sharing_csv: &'a [u8],
    pub survey_attribution_csv: &'a [u8],
    pub enrolled_devices_csv: &'a [u8],
}

/// Discover normalized IANA timezones through the Rust ingest boundary. Empty
/// timezone cells use the product's UTC default; rows without an event
/// timestamp are ignored exactly as they are by preprocessing.
pub fn discover_timezones_v2_native(csv_bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut timezones = BTreeSet::new();
    // PHI safety: raw cell values must never enter error strings surfaced to
    // the UI/console — report the 1-based data-row position instead. The
    // physical data-row number counts every data record in the file (including
    // all-empty skipped records) so it matches the row the incremental
    // executor reports for the same cell.
    for (data_row, record) in parse_csv_to_records_with_physical_rows(csv_bytes) {
        let timestamp = record
            .get("event_timestamp")
            .map(|value| value.trim())
            .unwrap_or_default();
        if timestamp.is_empty() {
            continue;
        }
        parse_chronicle_timestamp_ns(timestamp)
            .ok_or_else(|| format!("Invalid event_timestamp at data row {data_row}"))?;
        let timezone = record
            .get("timezone")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty() && *value != "None")
            .unwrap_or("UTC");
        timezone
            .parse::<Tz>()
            .map_err(|_| format!("invalid timezone value at data row {data_row}"))?;
        timezones.insert(timezone.to_string());
    }
    Ok(timezones.into_iter().collect())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineV2OptionsJson {
    pub study_name: String,
    pub timezone: String,
    #[serde(default = "default_timezone_handling")]
    pub timezone_handling: String,
    pub usage_session_mode: String,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    #[serde(default)]
    pub use_background_apps_file: bool,
    pub use_app_codebook: bool,
    #[serde(default)]
    pub include_category_column: bool,
    #[serde(default = "default_true")]
    pub deduplicate_exact_rows: bool,
    #[serde(default)]
    pub interaction_type_remap: Vec<String>,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
    #[serde(default)]
    pub proximity_interval_ns: i64,
    pub custom_app_engagement_duration: f64,
    pub long_data_time_gap_thresholds: Vec<f64>,
    pub long_usage_duration_thresholds: Vec<f64>,
    pub same_app_stop_types: Vec<String>,
    pub other_stop_types: Vec<String>,
    pub interaction_types_to_remove: Vec<String>,
    pub screen_auto_lock_timeout_seconds: f64,
    pub screen_auto_lock_tolerance_seconds: f64,
    pub screen_manual_lock_max_tail_seconds: f64,
    pub screen_keyguard_near_stop_seconds: f64,
    pub datetime_of_preprocessing: String,
    #[serde(default)]
    pub model_concurrent_usage: bool,
    #[serde(default)]
    pub minimum_usage_duration: f64,
    #[serde(default)]
    pub apply_minimum_usage_duration_to_concurrent_subintervals: bool,
    #[serde(default)]
    pub filter_zero_duration_sessions: bool,
    #[serde(default)]
    pub add_no_activity_placeholder_days: bool,
    #[serde(default)]
    pub enable_study_window_filter: bool,
    #[serde(default)]
    pub enable_person_attribution: bool,
    #[serde(default)]
    pub enable_day_coverage: bool,
    #[serde(default)]
    pub enable_compliance_scoring: bool,
    #[serde(default = "default_compliance_threshold_percent")]
    pub compliance_threshold_percent: f64,
    #[serde(default)]
    pub enable_screen_gated_crediting: bool,
    #[serde(default)]
    pub enable_parquet_export: bool,
    #[serde(default)]
    pub enable_spss_export: bool,
    #[serde(default)]
    pub enable_aggregates: bool,
    #[serde(default = "default_aggregate_shape")]
    pub aggregate_shape: String,
    // Exact browser view settings are carried in the Rust receipt even though
    // the dependency certificate correctly excludes them from preprocessing.
    #[serde(default = "default_true")]
    pub enable_plotting: bool,
    #[serde(default)]
    pub enable_activity_heatmap: bool,
    #[serde(default)]
    pub export_plots_as_svg: bool,
    #[serde(default)]
    pub enable_interactive_timeline: bool,
    #[serde(default)]
    pub include_filtered_app_usage_in_plots: bool,
    #[serde(default)]
    pub materialize_visualization_data: Option<bool>,
    #[serde(default = "default_credited_session_cap_minutes")]
    pub credited_session_cap_minutes: f64,
    #[serde(default = "default_device_liveness_gap_tolerance_minutes")]
    pub device_liveness_gap_tolerance_minutes: f64,
    #[serde(default = "default_auto_lock_bridge_seconds")]
    pub auto_lock_bridge_seconds: f64,
    #[serde(default = "default_no_witness_min_day_apps")]
    pub no_witness_min_day_apps: u32,
}

const fn default_true() -> bool {
    true
}

fn default_timezone_handling() -> String {
    "selected-convert".into()
}

fn default_aggregate_shape() -> String {
    "wide".into()
}

const fn default_compliance_threshold_percent() -> f64 {
    70.0
}

const fn default_credited_session_cap_minutes() -> f64 {
    360.0
}

const fn default_device_liveness_gap_tolerance_minutes() -> f64 {
    120.0
}

const fn default_auto_lock_bridge_seconds() -> f64 {
    120.0
}

const fn default_no_witness_min_day_apps() -> u32 {
    2
}

impl PipelineV2OptionsJson {
    pub fn into_pipeline_options(self) -> PipelineV2Options {
        let materialize_visualization_data = self
            .materialize_visualization_data
            .unwrap_or(self.enable_plotting || self.enable_interactive_timeline);
        let mode = match self.usage_session_mode.as_str() {
            "no_usage" => UsageSessionMode::NoUsage,
            "screen_usage" => UsageSessionMode::ScreenUsage,
            "app_and_screen_usage" => UsageSessionMode::AppAndScreenUsage,
            _ => UsageSessionMode::AppUsage,
        };
        PipelineV2Options {
            study_name: self.study_name,
            timezone: self.timezone,
            timezone_handling: self.timezone_handling,
            usage_session_mode: mode,
            include_app_output: self.include_app_output,
            include_screen_output: self.include_screen_output,
            use_filter_file: self.use_filter_file,
            use_apps_forcing_screen_open: self.use_apps_forcing_screen_open,
            use_background_apps_file: self.use_background_apps_file,
            use_app_codebook: self.use_app_codebook,
            include_category_column: self.include_category_column,
            deduplicate_exact_rows: self.deduplicate_exact_rows,
            interaction_type_remap: self.interaction_type_remap,
            correct_duplicate_event_timestamps: self.correct_duplicate_event_timestamps,
            allow_stop_event_reuse: self.allow_stop_event_reuse,
            use_activity_stopped_as_fallback: self.use_activity_stopped_as_fallback,
            apply_threshold_to_fallback: self.apply_threshold_to_fallback,
            long_duration_threshold_ns: self.long_duration_threshold_ns,
            proximity_interval_ns: self.proximity_interval_ns,
            custom_app_engagement_duration: self.custom_app_engagement_duration,
            long_data_time_gap_thresholds: self.long_data_time_gap_thresholds,
            long_usage_duration_thresholds: self.long_usage_duration_thresholds,
            same_app_stop_types: self.same_app_stop_types,
            other_stop_types: self.other_stop_types,
            interaction_types_to_remove: self.interaction_types_to_remove,
            screen_auto_lock_timeout_seconds: self.screen_auto_lock_timeout_seconds,
            screen_auto_lock_tolerance_seconds: self.screen_auto_lock_tolerance_seconds,
            screen_manual_lock_max_tail_seconds: self.screen_manual_lock_max_tail_seconds,
            screen_keyguard_near_stop_seconds: self.screen_keyguard_near_stop_seconds,
            datetime_of_preprocessing: self.datetime_of_preprocessing,
            model_concurrent_usage: self.model_concurrent_usage,
            minimum_usage_duration: self.minimum_usage_duration,
            apply_minimum_usage_duration_to_concurrent_subintervals: self
                .apply_minimum_usage_duration_to_concurrent_subintervals,
            filter_zero_duration_sessions: self.filter_zero_duration_sessions,
            add_no_activity_placeholder_days: self.add_no_activity_placeholder_days,
            enable_study_window_filter: self.enable_study_window_filter,
            enable_person_attribution: self.enable_person_attribution,
            enable_day_coverage: self.enable_day_coverage,
            enable_compliance_scoring: self.enable_compliance_scoring,
            compliance_threshold_percent: self.compliance_threshold_percent,
            enable_screen_gated_crediting: self.enable_screen_gated_crediting,
            enable_aggregates: self.enable_aggregates,
            aggregate_shape: self.aggregate_shape,
            materialize_visualization_data,
            credited_session_cap_minutes: self.credited_session_cap_minutes,
            device_liveness_gap_tolerance_minutes: self.device_liveness_gap_tolerance_minutes,
            auto_lock_bridge_seconds: self.auto_lock_bridge_seconds,
            no_witness_min_day_apps: self.no_witness_min_day_apps,
        }
    }
}

fn normalize_interaction_type_local(s: &str) -> &str {
    crate::normalize_interaction_type(s)
}

fn parse_raw_rows(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<(Vec<Row>, String), String> {
    let interaction_remap = incremental::parse_remap_config(&opts.interaction_type_remap);
    step_checkpoints.value("parse_remap_config", &interaction_remap)?;
    let raw_rows = incremental::csv_parse(csv_bytes);
    step_checkpoints.value("csv_parse", &raw_rows)?;

    let raw_rows = incremental::drop_empty_timestamp(raw_rows);
    step_checkpoints.value("drop_empty_timestamp", &raw_rows)?;

    let possible_device_model = incremental::detect_device_model(&raw_rows);
    step_checkpoints.value("detect_device_model", &possible_device_model)?;
    let preprocessing_datetime =
        incremental::resolve_preproc_datetime(&opts.datetime_of_preprocessing);
    step_checkpoints.value("resolve_preproc_datetime", &preprocessing_datetime)?;

    let rows = incremental::build_canonical_rows(
        &raw_rows,
        &opts.timezone,
        &interaction_remap,
        &possible_device_model,
    )?;
    step_checkpoints.rows("build_canonical_rows", &rows);

    let rows = incremental::stable_sort(rows);
    step_checkpoints.rows("stable_sort", &rows);
    let available_timezones = incremental::collect_timezones(&rows);
    step_checkpoints.value("collect_timezones", &available_timezones)?;

    Ok((rows, opts.timezone.clone()))
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RawRow {
    source_data_row: u32,
    event_timestamp: String,
    timezone: String,
    app_package_name: String,
    interaction_type: String,
    application_label: String,
    study_id: String,
    participant_id: String,
    username: String,
}

fn dedupe_exact_rows(rows: Vec<Row>) -> Vec<Row> {
    let mut seen = AHashMap::<(SharedString, i64, SharedString, SharedString), usize>::with_capacity(
        rows.len(),
    );
    let mut out: Vec<Row> = Vec::with_capacity(rows.len());
    for row in rows {
        let key = (
            row.participant_id.clone(),
            row.event_timestamp_ns,
            row.interaction_type.clone(),
            row.app_package_name.clone(),
        );
        if let Some(index) = seen.get(&key).copied() {
            out[index].source_data_rows.merge(&row.source_data_rows);
        } else {
            seen.insert(key, out.len());
            out.push(row);
        }
    }
    out
}

fn count_duplicate_groups(rows: &[Row]) -> u32 {
    if rows.len() <= 1 {
        return 0;
    }
    let mut duplicates = 0u32;
    let mut run_start = 0;
    for i in 1..rows.len() {
        if rows[i].event_timestamp_ns != rows[run_start].event_timestamp_ns {
            let len = i - run_start;
            if len > 1 {
                duplicates += (len - 1) as u32;
            }
            run_start = i;
        }
    }
    let len = rows.len() - run_start;
    if len > 1 {
        duplicates += (len - 1) as u32;
    }
    duplicates
}

fn duplicate_priority(it: &str, stop_types: &AHashSet<&str>) -> u8 {
    let normalized = if it == "Screen Non-interactive" {
        "Screen Non-Interactive"
    } else {
        it
    };
    if normalized == "Activity Resumed" {
        return 0;
    }
    if stop_types.contains(normalized) {
        return 2;
    }
    1
}

fn unalign_duplicate_timestamps(
    mut rows: Vec<Row>,
    same_app_stop_types: &[String],
    other_stop_types: &[String],
) -> Vec<Row> {
    if rows.len() <= 1 {
        return rows;
    }
    let mut stop_types: AHashSet<&str> = AHashSet::new();
    for v in same_app_stop_types {
        stop_types.insert(v.as_str());
    }
    for v in other_stop_types {
        stop_types.insert(v.as_str());
    }
    let has_dupes =
        (1..rows.len()).any(|i| rows[i].event_timestamp_ns <= rows[i - 1].event_timestamp_ns);
    if !has_dupes {
        return rows;
    }
    let mut start = 0;
    while start < rows.len() {
        let mut end = start + 1;
        while end < rows.len() && rows[end].event_timestamp_ns == rows[start].event_timestamp_ns {
            end += 1;
        }
        let count = end - start;
        if count > 1 {
            // sort indices [start..end) by (priority, local_index)
            let mut order: Vec<(u8, usize)> = (start..end)
                .enumerate()
                .map(|(local, abs)| {
                    (
                        duplicate_priority(&rows[abs].interaction_type, &stop_types),
                        local,
                    )
                })
                .collect();
            order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
            // Apply offset based on ordered position. Match TS:
            //   entry.row.event_timestamp_ns -= BigInt(count - orderedIndex) * 1000n
            // We need to first take ownership then re-place. Use index swap.
            // Build new ordered slice and write back.
            let block: Vec<Row> = (start..end).map(|i| rows[i].clone()).collect();
            for (ordered_index, (_, local)) in order.iter().enumerate() {
                let mut updated = block[*local].clone();
                let offset = (count - ordered_index) as i64 * 1_000;
                updated.edit_temporal().event_timestamp_ns -= offset;
                rows[start + ordered_index] = updated;
            }
        }
        start = end;
    }
    rows.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });
    rows
}

fn mark_data_time_gaps(mut rows: Vec<Row>) -> Vec<Row> {
    for i in 0..rows.len() {
        let final_v = if i == 0 {
            0.0
        } else {
            let delta_ns = rows[i].event_timestamp_ns - rows[i - 1].event_timestamp_ns;
            // (Number(delta_ns) / 3.6e12).toFixed(2) -> parse back to f64
            let raw = (delta_ns as f64) / 3_600_000_000_000.0;
            let rounded = ecma_round_fixed_f64(raw, 2);
            // JS `(x || 0)` -> 0 if NaN or 0; otherwise rounded.
            if rounded == 0.0 || rounded.is_nan() {
                0.0
            } else {
                rounded
            }
        };
        // Most gaps round to the 0.0 the row already holds; writing that
        // back would deep-clone the shared row and invalidate its temporal
        // checkpoint part for an identical value.
        if rows[i].data_time_gap_hours != final_v {
            rows[i].edit_temporal().data_time_gap_hours = final_v;
        }
    }
    rows
}

/// Numeric result of ECMAScript `Number.prototype.toFixed`, without building
/// the intermediate decimal string. The binary f64 is decomposed into its
/// exact integer mantissa and power-of-two denominator, then rounded to the
/// requested decimal scale with the specification's larger-integer tie rule.
fn ecma_round_fixed_f64(value: f64, frac_digits: u32) -> f64 {
    if !value.is_finite() || value == 0.0 || value.abs() >= 1e21 {
        return value;
    }
    let negative = value.is_sign_negative();
    let bits = value.abs().to_bits();
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    let (mantissa, exponent) = if exponent_bits == 0 {
        (fraction, 1 - 1023 - 52)
    } else {
        ((1_u64 << 52) | fraction, exponent_bits - 1023 - 52)
    };
    let scale = 10_u128.pow(frac_digits);
    let scaled_mantissa = (mantissa as u128) * scale;
    let rounded_integer = if exponent >= 0 {
        scaled_mantissa
            .checked_shl(exponent as u32)
            .unwrap_or(u128::MAX)
    } else {
        let shift = (-exponent) as u32;
        if shift >= 128 {
            0
        } else {
            let denominator = 1_u128 << shift;
            let quotient = scaled_mantissa / denominator;
            let remainder = scaled_mantissa % denominator;
            quotient + u128::from(remainder >= denominator / 2)
        }
    };
    let rounded = rounded_integer as f64 / scale as f64;
    if negative {
        -rounded
    } else {
        rounded
    }
}

/// ECMAScript Number.prototype.toFixed(fractionDigits) — string form.
/// Spec: pick integer n such that |n/10^f - x| is minimised; on ties pick
/// the larger n. (Round-half-away-from-zero on the exact IEEE 754 value.)
#[cfg(test)]
fn ecma_to_fixed(value: f64, frac_digits: u32) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if value >= 1e21 || value <= -1e21 {
        return js_number_to_string(value);
    }
    let neg = value < 0.0;
    let abs_v = value.abs();
    // Use Rust's round-half-to-even result as a starting point, then bump to
    // round-half-away-from-zero where the original value is exactly halfway.
    // Easier: render with one extra digit, then post-process.
    let extra = format!("{:.*}", (frac_digits + 1) as usize, abs_v);
    // extra looks like "21.625" for frac_digits=2.
    // Truncate the last digit and round if it's >=5; tie at 5 with no further
    // digits is rounded up. But we actually need to check whether the
    // *unrounded* value is exactly the boundary. f64 can't represent 21.625
    // exactly; printing it with f+1 digits in Rust gives the round-half-even
    // result of that. To match JS, render with much higher precision.
    // Simpler approach: render with 17 significant digits, scan + round.
    let high = format!("{:.20}", abs_v);
    let rounded = round_half_away_from_zero_decimal(&high, frac_digits as usize);
    let _ = extra;
    if neg && rounded != "0" && !is_all_zeros(&rounded) {
        format!("-{rounded}")
    } else {
        rounded
    }
}

#[cfg(test)]
fn is_all_zeros(s: &str) -> bool {
    s.chars().all(|c| c == '0' || c == '.')
}

/// Round a positive decimal string ("21.62500000000000124...") to `frac_digits`
/// fractional digits, using round-half-away-from-zero on the *exact* string
/// value. The string is expected to have plenty of trailing digits.
#[cfg(test)]
fn round_half_away_from_zero_decimal(s: &str, frac_digits: usize) -> String {
    let dot = match s.find('.') {
        Some(i) => i,
        None => {
            // Integer; pad with zeros if frac_digits>0.
            if frac_digits == 0 {
                return s.to_string();
            }
            return format!("{s}.{}", "0".repeat(frac_digits));
        }
    };
    let int_part = &s[..dot];
    let frac_part = &s[dot + 1..];
    if frac_part.len() <= frac_digits {
        // Pad with zeros.
        let pad = "0".repeat(frac_digits - frac_part.len());
        if frac_digits == 0 {
            return int_part.to_string();
        }
        return format!("{int_part}.{frac_part}{pad}");
    }
    // Truncate and inspect.
    let kept = &frac_part[..frac_digits];
    let tail = &frac_part[frac_digits..];
    let first_drop = tail.chars().next().unwrap();
    let round_up = if first_drop > '5' {
        true
    } else if first_drop < '5' {
        false
    } else {
        // first_drop == '5': round-half-away-from-zero always rounds up,
        // whether the remaining digits are zero or non-zero.
        true
    };
    if !round_up {
        if frac_digits == 0 {
            return int_part.to_string();
        }
        return format!("{int_part}.{kept}");
    }
    // Add 1 to the truncated number.
    let combined = if frac_digits == 0 {
        int_part.to_string()
    } else {
        format!("{int_part}{kept}")
    };
    let bumped = increment_decimal_string(&combined);
    if frac_digits == 0 {
        return bumped;
    }
    let split = bumped.len() - frac_digits;
    format!("{}.{}", &bumped[..split], &bumped[split..])
}

fn increment_decimal_string(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = bytes.to_vec();
    let mut carry = 1u8;
    for i in (0..out.len()).rev() {
        if !out[i].is_ascii_digit() {
            continue;
        }
        let d = out[i] - b'0' + carry;
        if d >= 10 {
            out[i] = b'0';
            carry = 1;
        } else {
            out[i] = b'0' + d;
            carry = 0;
            break;
        }
    }
    let mut result = String::from_utf8(out).unwrap();
    if carry == 1 {
        result.insert(0, '1');
    }
    result
}

fn label_filtered_apps(
    mut rows: Vec<Row>,
    filter_map: &HashMap<String, AHashSet<String>>,
) -> Vec<Row> {
    if filter_map.is_empty() {
        return rows;
    }
    for row in rows.iter_mut() {
        let labels = match filter_map.get(row.app_package_name.as_str()) {
            Some(s) => s,
            None => continue,
        };
        if !labels.is_empty() && !labels.contains(row.application_label.as_str()) {
            continue;
        }
        let replacement = match row.interaction_type.as_str() {
            ACTIVITY_RESUMED => Some(FILTERED_RESUMED),
            ACTIVITY_PAUSED => Some(FILTERED_PAUSED),
            ACTIVITY_STOPPED => Some(FILTERED_STOPPED),
            "Activity Destroyed" => Some("Filtered App Destroyed"),
            _ => None,
        };
        if let Some(replacement) = replacement {
            row.edit_classification().interaction_type = replacement.into();
        }
    }
    rows
}

/// Raw BLAKE3 output for a lineage suffix. Persisting 32-byte hashes avoids
/// storing the 71-byte ASCII form for every event; the protocol spelling is
/// reconstructed on the stack only when another hash consumes it.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct InlineLineageDigest([u8; 32]);

impl InlineLineageDigest {
    fn from_hasher(hasher: CheckpointHasher) -> Self {
        Self(*hasher.finalize().as_bytes())
    }

    fn encoded(self) -> [u8; 71] {
        encode_blake3_digest(self.0)
    }
}

fn encode_blake3_digest(digest: [u8; 32]) -> [u8; 71] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = [0_u8; 71];
    encoded[..7].copy_from_slice(b"blake3:");
    for (index, byte) in digest.iter().copied().enumerate() {
        encoded[7 + index * 2] = HEX[(byte >> 4) as usize];
        encoded[8 + index * 2] = HEX[(byte & 0x0f) as usize];
    }
    encoded
}

fn inline_lineage_search_suffix_digest(
    row: &Row,
    event_index: usize,
    next_digest: Option<&InlineLineageDigest>,
) -> InlineLineageDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&(event_index as u64).to_le_bytes());
    checkpoint_digest_field(&mut hasher, row.participant_id.as_bytes());
    hasher.update(&row.event_timestamp_ns.to_le_bytes());
    checkpoint_digest_field(&mut hasher, row.interaction_type.as_bytes());
    checkpoint_digest_field(&mut hasher, row.app_package_name.as_bytes());
    hasher.update(&(row.source_data_rows.ranges().len() as u64).to_le_bytes());
    for source_range in row.source_data_rows.ranges() {
        hasher.update(&source_range.first.to_le_bytes());
        hasher.update(&source_range.last.to_le_bytes());
    }
    match next_digest {
        Some(digest) => {
            hasher.update(&[1]);
            checkpoint_digest_field(&mut hasher, &digest.encoded());
        }
        None => {
            hasher.update(&[0]);
        }
    }
    InlineLineageDigest::from_hasher(hasher)
}

fn empty_lineage_search_suffix_digest(event_index: u32) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&event_index.to_le_bytes());
    hasher.update(&0_u32.to_le_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn empty_inline_lineage_search_suffix_digest(event_index: u32) -> InlineLineageDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&event_index.to_le_bytes());
    hasher.update(&0_u32.to_le_bytes());
    InlineLineageDigest::from_hasher(hasher)
}

fn inline_lineage_search_suffix_digests(rows: &[Row]) -> Vec<InlineLineageDigest> {
    let empty_suffix = empty_inline_lineage_search_suffix_digest(rows.len() as u32);
    let mut suffix_digests = vec![empty_suffix; rows.len() + 1];
    for index in (0..rows.len()).rev() {
        suffix_digests[index] = inline_lineage_search_suffix_digest(
            &rows[index],
            index,
            Some(&suffix_digests[index + 1]),
        );
    }
    suffix_digests
}

fn lineage_search_range_digest(
    suffix_digests: &[String],
    start_event_index: u32,
    end_event_index_exclusive: u32,
) -> LineageSearchDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-range/v1");
    hasher.update(&start_event_index.to_le_bytes());
    hasher.update(&end_event_index_exclusive.to_le_bytes());
    checkpoint_digest_field(
        &mut hasher,
        suffix_digests[start_event_index as usize].as_bytes(),
    );
    checkpoint_digest_field(
        &mut hasher,
        suffix_digests[end_event_index_exclusive as usize].as_bytes(),
    );
    LineageSearchDigest::from_hasher(hasher)
}

fn inline_lineage_search_range_digest(
    suffix_digests: &[InlineLineageDigest],
    start_event_index: u32,
    end_event_index_exclusive: u32,
) -> LineageSearchDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-range/v1");
    hasher.update(&start_event_index.to_le_bytes());
    hasher.update(&end_event_index_exclusive.to_le_bytes());
    checkpoint_digest_field(
        &mut hasher,
        &suffix_digests[start_event_index as usize].encoded(),
    );
    checkpoint_digest_field(
        &mut hasher,
        &suffix_digests[end_event_index_exclusive as usize].encoded(),
    );
    LineageSearchDigest::from_hasher(hasher)
}

#[allow(clippy::too_many_arguments)]
fn process_usage_rows(
    rows: Vec<Row>,
    background_apps: &AHashSet<String>,
    filtered_packages: &BTreeSet<String>,
    opts: &PipelineV2Options,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let matcher_input = incremental::build_matcher_input(
        &rows,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
        background_apps,
        opts.model_concurrent_usage,
    )?;
    step_checkpoints.value("build_matcher_input", &matcher_input)?;
    let result = incremental::run_matcher(
        &matcher_input,
        opts.allow_stop_event_reuse,
        opts.use_activity_stopped_as_fallback,
        opts.apply_threshold_to_fallback,
        opts.long_duration_threshold_ns,
        opts.proximity_interval_ns,
    )?;
    step_checkpoints.value("run_matcher", &result)?;

    let next = incremental::apply_matcher_output(rows, &result, filtered_packages);
    step_checkpoints.rows("apply_matcher_output", &next);

    let out =
        incremental::relabel_usage_with_floor(next, filtered_packages, opts.minimum_usage_duration);
    step_checkpoints.rows("relabel_usage_with_floor", &out);

    let out = incremental::junk_downstream_mark(out, filtered_packages, background_apps);
    step_checkpoints.rows("junk_downstream_mark", &out);

    let out = incremental::sort_episodes(out);
    step_checkpoints.rows("sort_episodes", &out);

    let out = incremental::split_concurrent(
        out,
        filtered_packages,
        background_apps,
        opts.model_concurrent_usage,
        opts.minimum_usage_duration,
        opts.apply_minimum_usage_duration_to_concurrent_subintervals,
    )?;
    step_checkpoints.rows("split_concurrent", &out);
    Ok(out)
}

fn run_app_usage_algorithm(
    mut rows: Vec<Row>,
    opts: &PipelineV2Options,
    background_apps: &AHashSet<String>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let filtered_packages = incremental::compute_junk_packages(&rows);
    step_checkpoints.value("compute_junk_packages", &filtered_packages)?;
    rows = incremental::junk_blind_fold(rows);
    step_checkpoints.rows("junk_blind_fold", &rows);
    let next = process_usage_rows(
        rows,
        background_apps,
        &filtered_packages,
        opts,
        step_checkpoints,
    )?;
    Ok(next)
}

fn join_codebook(rows: &mut [Row], enabled: bool, codebook_map: &HashMap<String, CodebookEntry>) {
    if !enabled {
        return;
    }
    for row in rows.iter_mut() {
        join_codebook_row(row, codebook_map);
    }
}

fn join_codebook_row(row: &mut Row, codebook_map: &HashMap<String, CodebookEntry>) {
    let fields = codebook_map
        .get(row.app_package_name.as_str())
        .map(|entry| entry.fields.clone())
        .unwrap_or_else(empty_codebook_fields);
    if row.codebook_fields != fields {
        row.edit_classification().codebook_fields = fields;
    }
}

fn derive_broad_category(rows: &mut [Row], enabled: bool) {
    if !enabled {
        return;
    }
    let bcm_play_store_broad_idx = codebook_col_index("bcm_play_store_broad_app_category").unwrap();
    let usc_broad_idx = codebook_col_index("usc_broad_app_category").unwrap();
    let babyemu_broad_idx = codebook_col_index("babyemu_broad_app_category").unwrap();
    let bcm_broad_idx = codebook_col_index("bcm_cnrc_heuristic_category").unwrap();

    let indices = [
        bcm_play_store_broad_idx,
        usc_broad_idx,
        babyemu_broad_idx,
        bcm_broad_idx,
    ];
    for row in rows.iter_mut() {
        derive_broad_category_row(row, indices);
    }
}

fn derive_broad_category_row(row: &mut Row, indices: [usize; 4]) {
    let candidates = [
        row.codebook_fields[indices[0]].as_deref(),
        row.codebook_fields[indices[1]].as_deref(),
        row.codebook_fields[indices[2]].as_deref(),
        row.codebook_fields[indices[3]].as_deref(),
        row.broad_app_category.as_deref(),
    ];
    let chosen = candidates
        .iter()
        .find_map(|candidate| candidate.filter(|value| !value.trim().is_empty()))
        .map(String::from);
    let category = Some(chosen.unwrap_or_else(|| "Unknown".to_string()).into());
    if row.broad_app_category != category {
        row.edit_classification().broad_app_category = category;
    }
}

fn collapse_genre(rows: &mut [Row], enabled: bool) {
    if !enabled {
        return;
    }
    let babyemu_scraped_idx = codebook_col_index("babyemu_genreId_scraped").unwrap();
    let babyemu_manual_idx = codebook_col_index("babyemu_genreId_manual").unwrap();
    let bcm_play_store_genre_idx = codebook_col_index("bcm_play_store_genreId").unwrap();
    let usc_genre_idx = codebook_col_index("usc_genreId").unwrap();

    let indices = [
        babyemu_scraped_idx,
        babyemu_manual_idx,
        bcm_play_store_genre_idx,
        usc_genre_idx,
    ];
    for row in rows.iter_mut() {
        collapse_genre_row(row, indices);
    }
}

fn collapse_genre_row(row: &mut Row, indices: [usize; 4]) {
    let genre_values = indices
        .into_iter()
        .filter_map(|index| row.codebook_fields[index].as_ref())
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if genre_values.is_empty() {
        if row.genre_id_scraped.as_deref() != Some("Unknown") {
            row.edit_classification().genre_id_scraped = Some("Unknown".into());
        }
        return;
    }
    let unique = genre_values
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    if unique.len() == 1 {
        let genre = SharedString::from(genre_values[0].as_str());
        if row.genre_id_scraped.as_ref() != Some(&genre) || !row.codebook_genre_fields_cleared {
            let data = row.edit_classification();
            data.genre_id_scraped = Some(genre);
            data.codebook_genre_fields_cleared = true;
        }
    } else if row.genre_id_scraped.is_some() || row.codebook_genre_fields_cleared {
        let data = row.edit_classification();
        data.genre_id_scraped = None;
        data.codebook_genre_fields_cleared = false;
    }
}

fn apply_codebook_annotations(
    rows: &mut [Row],
    enabled: bool,
    codebook_map: &HashMap<String, CodebookEntry>,
) {
    if !enabled {
        return;
    }
    let broad_indices = [
        codebook_col_index("bcm_play_store_broad_app_category").unwrap(),
        codebook_col_index("usc_broad_app_category").unwrap(),
        codebook_col_index("babyemu_broad_app_category").unwrap(),
        codebook_col_index("bcm_cnrc_heuristic_category").unwrap(),
    ];
    let genre_indices = [
        codebook_col_index("babyemu_genreId_scraped").unwrap(),
        codebook_col_index("babyemu_genreId_manual").unwrap(),
        codebook_col_index("bcm_play_store_genreId").unwrap(),
        codebook_col_index("usc_genreId").unwrap(),
    ];
    for row in rows {
        join_codebook_row(row, codebook_map);
        derive_broad_category_row(row, broad_indices);
        collapse_genre_row(row, genre_indices);
    }
}

fn walk_app_usage_detail_columns(
    rows: &mut [Row],
    custom_app_engagement_duration: f64,
    mut after_row: impl FnMut(&mut Row),
) {
    fn metrics(
        previous: Option<(i64, &SharedString)>,
        start: i64,
        package: &SharedString,
        custom_duration: f64,
    ) -> (i32, i32, i32, f64) {
        let Some((previous_stop, previous_package)) = previous else {
            return (1, 1, 0, 0.0);
        };
        // Match JS BigInt.asIntN(64, ...) with explicit wrapping subtraction.
        let gap_seconds = start.wrapping_sub(previous_stop) as f64 / 1_000_000_000.0;
        (
            i32::from(gap_seconds > 30.0),
            i32::from(gap_seconds > custom_duration),
            i32::from(package != previous_package),
            gap_seconds / 3600.0,
        )
    }

    let mut previous_any: Option<(i64, SharedString)> = None;
    let mut previous_valid: Option<(i64, SharedString)> = None;
    for row in rows {
        let is_primary = row.usage_layer.as_deref() != Some("secondary");
        let is_valid = is_primary && row.interaction_type == APP_USAGE;
        let is_any = is_valid || (is_primary && row.interaction_type == FILTERED_APP_USAGE);
        if !is_any {
            after_row(row);
            continue;
        }
        let start = row.start_timestamp_ns.unwrap_or(i64::MIN);
        let stop = row.stop_timestamp_ns.unwrap_or(i64::MIN);
        let package = row.app_package_name.clone();
        let (engage_30, engage_custom, switched, gap_hours) = metrics(
            previous_any
                .as_ref()
                .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
            start,
            &package,
            custom_app_engagement_duration,
        );
        let valid_metrics = is_valid.then(|| {
            metrics(
                previous_valid
                    .as_ref()
                    .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
                start,
                &package,
                custom_app_engagement_duration,
            )
        });
        let any_classification_changed = row.any_app_new_engage_30s != engage_30
            || row.any_app_new_engage_custom != engage_custom
            || row.any_app_switched_app != switched;
        let any_temporal_changed =
            row.any_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits();
        let valid_classification_changed =
            valid_metrics.is_some_and(|(engage_30, engage_custom, switched, _)| {
                row.valid_app_new_engage_30s != engage_30
                    || row.valid_app_new_engage_custom != engage_custom
                    || row.valid_app_switched_app != switched
            });
        let valid_temporal_changed = valid_metrics.is_some_and(|(_, _, _, gap_hours)| {
            row.valid_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits()
        });
        if any_classification_changed
            || any_temporal_changed
            || valid_classification_changed
            || valid_temporal_changed
        {
            let data = row.edit_components(
                false,
                any_temporal_changed || valid_temporal_changed,
                any_classification_changed || valid_classification_changed,
            );
            data.any_app_new_engage_30s = engage_30;
            data.any_app_new_engage_custom = engage_custom;
            data.any_app_switched_app = switched;
            data.any_app_usage_time_gap_hours = gap_hours;
            if let Some((engage_30, engage_custom, switched, gap_hours)) = valid_metrics {
                data.valid_app_new_engage_30s = engage_30;
                data.valid_app_new_engage_custom = engage_custom;
                data.valid_app_switched_app = switched;
                data.valid_app_usage_time_gap_hours = gap_hours;
            }
        }
        previous_any = Some((stop, package.clone()));
        if is_valid {
            previous_valid = Some((stop, package));
        }
        after_row(row);
    }
}

fn add_app_usage_detail_columns(rows: &mut [Row], custom_app_engagement_duration: f64) {
    walk_app_usage_detail_columns(rows, custom_app_engagement_duration, |_| {});
}

struct PreparedUsageFlags {
    gap: Vec<(f64, String)>,
    duration: Vec<(f64, String)>,
}

fn prepare_usage_flags(
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) -> PreparedUsageFlags {
    let mut gap_thresholds = long_data_time_gap_thresholds.to_vec();
    gap_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let mut dur_thresholds = long_usage_duration_thresholds.to_vec();
    dur_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let gap_thresholds = gap_thresholds
        .into_iter()
        .map(|threshold| {
            (
                threshold,
                format!(">{}-HR TIME GAP", format_threshold(threshold)),
            )
        })
        .collect::<Vec<_>>();
    let dur_thresholds = dur_thresholds
        .into_iter()
        .map(|threshold| {
            (
                threshold,
                format!(">{}-HR APP USAGE", format_threshold(threshold)),
            )
        })
        .collect::<Vec<_>>();
    PreparedUsageFlags {
        gap: gap_thresholds,
        duration: dur_thresholds,
    }
}

fn mark_app_usage_flags_row(row: &mut Row, thresholds: &PreparedUsageFlags) {
    let gap_flag = thresholds
        .gap
        .iter()
        .find(|(threshold, _)| row.data_time_gap_hours >= *threshold)
        .map(|(_, label)| label.as_str());
    let dur_hours = row.duration_minutes.map(|m| m / 60.0).unwrap_or(0.0);
    let duration_flag = thresholds
        .duration
        .iter()
        .find(|(threshold, _)| dur_hours >= *threshold)
        .map(|(_, label)| label.as_str());
    if gap_flag.is_none() && duration_flag.is_none() {
        if row.any_app_usage_flags != "[]" {
            row.edit_classification().any_app_usage_flags = "[]".into();
        }
    } else {
        let value = match (gap_flag, duration_flag) {
            (Some(gap), Some(duration)) => format!("['{gap}', '{duration}']"),
            (Some(gap), None) => format!("['{gap}']"),
            (None, Some(duration)) => format!("['{duration}']"),
            (None, None) => unreachable!("handled empty flags above"),
        };
        if row.any_app_usage_flags.as_str() != value {
            row.edit_classification().any_app_usage_flags = value.into();
        }
    }
}

fn mark_app_usage_flags(
    rows: &mut [Row],
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) {
    let thresholds = prepare_usage_flags(
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    for row in rows {
        mark_app_usage_flags_row(row, &thresholds);
    }
}

/// JS Number(threshold).toString() — integers print without decimals.
fn format_threshold(t: f64) -> String {
    js_number_to_string(t)
}

fn clear_filtered_usage_timing_row(row: &mut Row) {
    if row.interaction_type == FILTERED_APP_USAGE
        && (row.start_timestamp_ns.is_some()
            || row.stop_timestamp_ns.is_some()
            || row.duration_seconds.is_some()
            || row.duration_minutes.is_some())
    {
        let data = row.edit_temporal();
        data.start_timestamp_ns = None;
        data.stop_timestamp_ns = None;
        data.duration_seconds = None;
        data.duration_minutes = None;
    }
}

fn clear_filtered_usage_timing(rows: &mut [Row]) {
    for row in rows {
        clear_filtered_usage_timing_row(row);
    }
}

fn apply_review_annotations_one_pass(
    rows: &mut [Row],
    custom_app_engagement_duration: f64,
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) {
    let thresholds = prepare_usage_flags(
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    walk_app_usage_detail_columns(rows, custom_app_engagement_duration, |row| {
        mark_app_usage_flags_row(row, &thresholds);
        clear_filtered_usage_timing_row(row);
    });
}

fn add_no_activity_placeholder_rows(mut app_rows: Vec<Row>, raw_rows: &[Row]) -> Vec<Row> {
    let mut usage_days: AHashSet<(SharedString, SharedString)> = AHashSet::new();
    for row in &app_rows {
        if row.interaction_type == APP_USAGE {
            usage_days.insert((row.participant_id.clone(), row.date.clone()));
        }
    }

    // Preserve JavaScript Map insertion order: raw rows are event-sorted, so
    // samples are emitted in first-observed participant/day order.
    let mut sample_index: HashMap<(SharedString, SharedString), usize> = HashMap::new();
    let mut samples: Vec<Row> = Vec::new();
    for row in raw_rows {
        let key = (row.participant_id.clone(), row.date.clone());
        if let Some(index) = sample_index.get(&key).copied() {
            if row.event_timestamp_ns < samples[index].event_timestamp_ns {
                samples[index] = row.clone();
            }
        } else {
            sample_index.insert(key, samples.len());
            samples.push(row.clone());
        }
    }

    let mut date_memo = LocalDateMemo::default();
    for mut sample in samples {
        let key = (sample.participant_id.clone(), sample.date.clone());
        if usage_days.contains(&key) {
            continue;
        }
        sample.interaction_type = APP_USAGE.into();
        sample.app_package_name = "com.placeholder.noactivity".into();
        sample.application_label = "No Activity".into();
        sample.start_timestamp_ns = Some(sample.event_timestamp_ns);
        sample.stop_timestamp_ns = Some(sample.event_timestamp_ns);
        sample.duration_seconds = Some(0.0);
        sample.duration_minutes = Some(0.0);
        sample.data_time_gap_hours = 0.0;
        sample.index += 2_000_000;
        let timezone: Tz = sample.timezone.parse().unwrap_or(chrono_tz::UTC);
        populate_time_columns(&mut sample, timezone, &mut date_memo);
        app_rows.push(sample);
    }
    app_rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    app_rows
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct StudyWindow {
    participant_id: String,
    start_date: String,
    end_date: String,
}

fn normalize_support_date(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() >= 10 {
        let prefix = &value[..10];
        if prefix.as_bytes().get(4) == Some(&b'-') && prefix.as_bytes().get(7) == Some(&b'-') {
            return Ok(prefix.to_string());
        }
    }
    // PHI safety: never echo the raw cell — callers annotate the column and
    // participant instead.
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() == 3 {
        let month = parts[0]
            .parse::<u8>()
            .map_err(|_| "unparseable date value".to_string())?;
        let day = parts[1]
            .parse::<u8>()
            .map_err(|_| "unparseable date value".to_string())?;
        let year = parts[2]
            .parse::<u16>()
            .map_err(|_| "unparseable date value".to_string())?;
        return Ok(format!("{year:04}-{month:02}-{day:02}"));
    }
    Err("unparseable date value".to_string())
}

fn parse_study_windows(bytes: &[u8]) -> Result<Vec<StudyWindow>, String> {
    let rows = parse_csv_to_records(bytes);
    let mut windows = Vec::new();
    for row in rows {
        let participant_id = trim_owned(row.get("participant_id"));
        if participant_id.is_empty() {
            continue;
        }
        let start_date = normalize_support_date(
            row.get("start_date")
                .ok_or("Study dates file: missing required column start_date")?,
        )
        .map_err(|_| format!("Study dates file: unparseable start_date for {participant_id}"))?;
        let end_date = normalize_support_date(
            row.get("end_date")
                .ok_or("Study dates file: missing required column end_date")?,
        )
        .map_err(|_| format!("Study dates file: unparseable end_date for {participant_id}"))?;
        if end_date < start_date {
            return Err(format!(
                "Study dates file: window for {participant_id} ends before it starts"
            ));
        }
        windows.push(StudyWindow {
            participant_id,
            start_date,
            end_date,
        });
    }
    Ok(windows)
}

fn numerical_id(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    let mut start = None;
    for (index, byte) in bytes.iter().enumerate() {
        if byte.is_ascii_digit() {
            start.get_or_insert(index);
        } else if let Some(begin) = start.take() {
            if index - begin >= 3 {
                return Some(&value[begin..index]);
            }
        }
    }
    start.and_then(|begin| (bytes.len() - begin >= 3).then_some(&value[begin..]))
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct ResolvedParticipantWindow {
    participant_id: String,
    window: Option<StudyWindow>,
}

fn resolve_participant_windows(
    rows: &[Row],
    windows: &[StudyWindow],
) -> Vec<ResolvedParticipantWindow> {
    let mut seen = AHashSet::new();
    let mut resolved = Vec::new();
    for row in rows {
        if !seen.insert(row.participant_id.clone()) {
            continue;
        }
        let exact = windows
            .iter()
            .find(|window| window.participant_id == row.participant_id.as_str());
        let window = exact.or_else(|| {
            let id = numerical_id(&row.participant_id)?;
            windows
                .iter()
                .find(|window| numerical_id(&window.participant_id) == Some(id))
        });
        resolved.push(ResolvedParticipantWindow {
            participant_id: row.participant_id.to_string(),
            window: window.cloned(),
        });
    }
    resolved
}

fn apply_study_window(
    rows: Vec<Row>,
    resolved: &[ResolvedParticipantWindow],
) -> (Vec<Row>, usize, Vec<String>) {
    let resolved = resolved
        .iter()
        .map(|entry| (entry.participant_id.as_str(), entry.window.as_ref()))
        .collect::<BTreeMap<_, _>>();
    let participants_without_window = resolved
        .iter()
        .filter_map(|(participant_id, window)| {
            window.is_none().then_some((*participant_id).to_string())
        })
        .collect::<Vec<_>>();
    let before = rows.len();
    let rows = rows
        .into_iter()
        .filter(|row| {
            resolved
                .get(row.participant_id.as_str())
                .copied()
                .flatten()
                .is_none_or(|window| {
                    row.date.as_str() >= window.start_date.as_str()
                        && row.date.as_str() <= window.end_date.as_str()
                })
        })
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(rows.len());
    (rows, dropped, participants_without_window)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum SharingStatus {
    Shared,
    NonShared,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct SharingEntry {
    participant_id: String,
    status: SharingStatus,
}

fn support_value<'a>(row: &'a HashMap<String, String>, wanted: &str) -> Option<&'a str> {
    row.iter()
        .find(|(header, _)| header.trim().eq_ignore_ascii_case(wanted))
        .map(|(_, value)| value.as_str())
}

fn require_support_columns(
    file_label: &str,
    rows: &[HashMap<String, String>],
    required: &[&str],
) -> Result<(), String> {
    let Some(first) = rows.first() else {
        return Err(format!(
            "{file_label}: missing required columns or data rows"
        ));
    };
    let missing: Vec<_> = required
        .iter()
        .filter(|column| support_value(first, column).is_none())
        .copied()
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        // PHI safety: never echo the found headers — a headerless upload
        // would leak its first data row here.
        Err(format!(
            "{file_label}: missing required column(s) {}",
            missing.join(", ")
        ))
    }
}

fn parse_device_sharing(bytes: &[u8]) -> Result<Vec<SharingEntry>, String> {
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Device sharing file",
        &rows,
        &["participant_id", "sharing_status"],
    )?;
    rows.into_iter()
        .filter_map(|row| {
            let participant_id = support_value(&row, "participant_id")?.trim().to_string();
            (!participant_id.is_empty()).then_some((row, participant_id))
        })
        .map(|(row, participant_id)| {
            let raw = support_value(&row, "sharing_status")
                .unwrap_or_default()
                .trim();
            let status = if raw.eq_ignore_ascii_case("shared") {
                SharingStatus::Shared
            } else if raw.eq_ignore_ascii_case("non-shared")
                || raw.eq_ignore_ascii_case("nonshared")
                || raw.eq_ignore_ascii_case("not shared")
            {
                SharingStatus::NonShared
            } else {
                return Err(format!(
                    "Device sharing file: unknown sharing_status for {participant_id} (expected \"Shared\" or \"Non-Shared\")"
                ));
            };
            Ok(SharingEntry {
                participant_id,
                status,
            })
        })
        .collect()
}

fn device_number(participant_id: &str) -> u32 {
    participant_id
        .find("-D")
        .and_then(|index| {
            let digits: String = participant_id[index + 2..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            (!digits.is_empty()).then_some(digits)
        })
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(1)
}

fn sharing_status_for(
    participant_id: &str,
    sharing: &[SharingEntry],
) -> Result<SharingStatus, String> {
    if let Some(entry) = sharing
        .iter()
        .find(|entry| entry.participant_id == participant_id)
    {
        return Ok(entry.status);
    }
    let numerical = numerical_id(participant_id);
    if let Some(wanted_id) = numerical {
        let wanted_device = device_number(participant_id);
        if let Some(entry) = sharing.iter().find(|entry| {
            numerical_id(&entry.participant_id) == Some(wanted_id)
                && device_number(&entry.participant_id) == wanted_device
        }) {
            return Ok(entry.status);
        }
    }
    Err(format!(
        "Person attribution: no device-sharing status for {participant_id:?} (numerical={}). The sharing table must cover every device when it is configured.",
        numerical.unwrap_or("none")
    ))
}

fn parse_survey_timestamp_ns(value: &str) -> Result<i64, String> {
    // PHI safety: never echo the raw cell — the caller annotates the
    // participant instead.
    let text = value.trim();
    if text.len() >= 10 && text.bytes().all(|byte| byte.is_ascii_digit()) {
        let parsed = text
            .parse::<i64>()
            .map_err(|_| "Survey attribution file: unparseable event_timestamp value".to_string())?;
        return if text.len() >= 19 {
            Ok(parsed)
        } else if text.len() >= 13 {
            parsed
                .checked_mul(1_000_000)
                .ok_or_else(|| "Survey attribution file: event_timestamp overflow".to_string())
        } else {
            parsed
                .checked_mul(1_000_000_000)
                .ok_or_else(|| "Survey attribution file: event_timestamp overflow".to_string())
        };
    }
    parse_chronicle_timestamp_ns(text)
        .ok_or_else(|| "Survey attribution file: unparseable event_timestamp value".to_string())
}

fn parse_survey_lookup(bytes: &[u8]) -> Result<BTreeMap<(String, i64), String>, String> {
    if bytes.is_empty() {
        return Ok(BTreeMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Survey attribution file",
        &rows,
        &["participant_id", "event_timestamp", "users"],
    )?;
    let mut lookup = BTreeMap::new();
    for row in rows {
        let participant_id = support_value(&row, "participant_id")
            .unwrap_or_default()
            .trim();
        let timestamp = support_value(&row, "event_timestamp")
            .unwrap_or_default()
            .trim();
        let user = support_value(&row, "users")
            .unwrap_or_default()
            .trim()
            .trim_matches(|character| matches!(character, '{' | '}' | '"'));
        if participant_id.is_empty() || timestamp.is_empty() || user.is_empty() {
            continue;
        }
        lookup.insert(
            (
                participant_id.to_string(),
                parse_survey_timestamp_ns(timestamp)
                    .map_err(|error| format!("{error} (participant {participant_id})"))?,
            ),
            user.to_string(),
        );
    }
    Ok(lookup)
}

fn is_null_username(username: &str) -> bool {
    username.is_empty() || username == "nan"
}

fn is_target_child(username: &str) -> bool {
    username.to_ascii_lowercase().contains("target child")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharingResolution {
    status_by_participant: BTreeMap<String, SharingStatus>,
    shared_participants: Vec<String>,
    non_shared_participants: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttributionReport {
    shared_participants: Vec<String>,
    non_shared_participants: Vec<String>,
    survey_relabels: usize,
    non_target_rows: usize,
    kids_shell_attributions: usize,
    null_usernames_filled: usize,
}

fn attribute_person(
    mut rows: Vec<Row>,
    resolution: &SharingResolution,
    survey: &BTreeMap<(String, i64), String>,
) -> Result<(Vec<Row>, AttributionReport), String> {
    let mut report = AttributionReport {
        shared_participants: resolution.shared_participants.clone(),
        non_shared_participants: resolution.non_shared_participants.clone(),
        survey_relabels: 0,
        non_target_rows: 0,
        kids_shell_attributions: 0,
        null_usernames_filled: 0,
    };
    for row in &mut rows {
        let status = *resolution
            .status_by_participant
            .get(row.participant_id.as_str())
            .ok_or_else(|| {
                format!(
                    "Person attribution: unresolved sharing status for {:?}",
                    row.participant_id
                )
            })?;
        match status {
            SharingStatus::NonShared => {
                if is_null_username(&row.username) {
                    row.username = "Target Child".into();
                    report.null_usernames_filled += 1;
                }
            }
            SharingStatus::Shared => {
                if is_null_username(&row.username) {
                    row.username = if KIDS_SHELL_PACKAGES.contains(&row.app_package_name.as_str()) {
                        report.kids_shell_attributions += 1;
                        "Target Child".into()
                    } else {
                        "None".into()
                    };
                    report.null_usernames_filled += 1;
                }
                if let Some(user) =
                    survey.get(&(row.participant_id.to_string(), row.event_timestamp_ns))
                {
                    row.username = format!("{user} (From Survey)").into();
                    report.survey_relabels += 1;
                }
                if row.interaction_type == APP_USAGE && !is_target_child(&row.username) {
                    row.interaction_type = NON_TARGET_CHILD_APP_USAGE.into();
                    report.non_target_rows += 1;
                }
            }
        }
    }
    Ok((rows, report))
}

fn window_for<'a>(participant_id: &str, windows: &'a [StudyWindow]) -> Option<&'a StudyWindow> {
    windows
        .iter()
        .find(|window| window.participant_id == participant_id)
        .or_else(|| {
            let id = numerical_id(participant_id)?;
            windows
                .iter()
                .find(|window| numerical_id(&window.participant_id) == Some(id))
        })
}

fn inclusive_dates(start: &str, end: &str) -> Result<Vec<String>, String> {
    let mut current = NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|error| format!("invalid coverage start date: {error}"))?;
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .map_err(|error| format!("invalid coverage end date: {error}"))?;
    let mut dates = Vec::new();
    while current <= end {
        dates.push(current.format("%Y-%m-%d").to_string());
        current = current
            .checked_add_signed(Duration::days(1))
            .ok_or("coverage date range overflow")?;
    }
    Ok(dates)
}

fn csv_escape_value(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverageDayCheckpoint {
    participant_id: String,
    date: String,
    status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DayCoverageCheckpoint {
    coverage: Vec<CoverageDayCheckpoint>,
    usage_days: usize,
    no_activity_days: usize,
    no_data_days: usize,
}

fn build_raw_date_index(raw_rows: &[Row]) -> BTreeMap<String, BTreeSet<String>> {
    let mut raw_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in raw_rows {
        raw_dates
            .entry(if row.participant_id.is_empty() {
                "unknown".into()
            } else {
                row.participant_id.to_string()
            })
            .or_default()
            .insert(row.date.to_string());
    }
    raw_dates
}

fn build_day_coverage_csv(
    usage_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    windows: &[StudyWindow],
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let output = incremental::build_coverage(usage_rows, raw_dates, windows)?;
    step_checkpoints.value("build_coverage_table", &output.report)?;
    Ok((output.csv_bytes, output.report.coverage.len() as u32))
}

fn js_rounded_number(value: f64) -> String {
    let mut text = normalize_float_string(value);
    if let Some(integer) = text.strip_suffix(".0") {
        text = integer.to_string();
    }
    text
}

fn parse_enrolled_devices(bytes: &[u8]) -> Result<BTreeMap<String, u32>, String> {
    if bytes.is_empty() {
        return Ok(BTreeMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Enrolled devices file",
        &rows,
        &["participant_id", "device_count"],
    )?;
    let mut devices = BTreeMap::new();
    for row in rows {
        let participant_id = support_value(&row, "participant_id")
            .unwrap_or_default()
            .trim();
        if participant_id.is_empty() {
            continue;
        }
        let raw = support_value(&row, "device_count")
            .unwrap_or_default()
            .trim();
        let count = if raw.is_empty() {
            0
        } else {
            raw.parse::<u32>().map_err(|_| {
                format!("Enrolled devices file: invalid device_count for {participant_id}")
            })?
        };
        devices.insert(participant_id.to_string(), count);
    }
    Ok(devices)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceDayCheckpoint {
    participant_id: String,
    date: String,
    sharing_status: String,
    known_minutes: f64,
    unknown_minutes: f64,
    compliance_percent: f64,
    zero_real_usage: bool,
    is_valid: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceResultCheckpoint {
    days: Vec<ComplianceDayCheckpoint>,
    valid_days: usize,
    invalid_days: usize,
    zero_usage_days: usize,
}

fn build_compliance_csv(
    rows: &[Row],
    shared_participants: &BTreeSet<String>,
    threshold_percent: f64,
    enrolled_devices: &BTreeMap<String, u32>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let attribution = incremental::accumulate_minutes(rows);
    let bucket_checkpoint = attribution
        .buckets
        .iter()
        .map(
            |((participant_id, date), (known_minutes, unknown_minutes))| {
                serde_json::json!({
                    "participantId": participant_id,
                    "date": date,
                    "knownMinutes": known_minutes,
                    "unknownMinutes": unknown_minutes,
                })
            },
        )
        .collect::<Vec<_>>();
    step_checkpoints.value(
        "accumulate_attribution_minutes",
        &serde_json::json!({
            "participantsSeen": &attribution.participants_seen,
            "buckets": bucket_checkpoint,
        }),
    )?;
    let result =
        incremental::score_attribution_days(&attribution, shared_participants, threshold_percent);
    step_checkpoints.value("score_days", &result)?;
    let bytes = incremental::compliance_csv(&result, enrolled_devices);
    let row_count = result.days.len() as u32;
    Ok((bytes, row_count))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
enum ScreenCreditState {
    On,
    Off,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ScreenChangePoint {
    timestamp_ns: i64,
    state: ScreenCreditState,
    source_data_rows: SourceDataRows,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct ScreenCreditSubstrate {
    points: BTreeMap<String, Vec<ScreenChangePoint>>,
    boots: BTreeMap<String, Vec<i64>>,
    all_timestamps: BTreeMap<String, Vec<i64>>,
    source_events: BTreeMap<String, Vec<(i64, SourceDataRows)>>,
    source_event_suffix_digests: BTreeMap<String, Vec<String>>,
    capable: BTreeSet<String>,
}

type CreditInterval = (i64, i64);

fn screen_witness_state(interaction_type: &str) -> Result<Option<ScreenCreditState>, String> {
    let interaction_type = if interaction_type == "Screen Non-interactive" {
        "Screen Non-Interactive"
    } else {
        interaction_type
    };
    if interaction_type.starts_with("Unknown importance:")
        || interaction_type
            .strip_prefix("n: ")
            .and_then(|rest| rest.as_bytes().first())
            .is_some_and(u8::is_ascii_digit)
    {
        // PHI safety: raw cell values must never enter error strings surfaced
        // to the UI/console — the caller appends the data-row position.
        return Err(
            "Screen-gated credit: unmapped interaction type in the raw stream — extend the interaction-type mapping before crediting."
                .to_string(),
        );
    }
    let state = match interaction_type {
        "Screen Interactive"
        | "User Interaction"
        | "Shortcut Invocation"
        | "Keyguard Hidden"
        | "User Unlocked"
        | "Chooser Action" => Some(ScreenCreditState::On),
        "Screen Non-Interactive" | "Device Shutdown" => Some(ScreenCreditState::Off),
        _ => None,
    };
    Ok(state)
}

fn screen_source_event_suffix_digest(
    timestamp_ns: i64,
    source_data_rows: &SourceDataRows,
    event_index: usize,
    next_digest: &str,
) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-screen-credit-source-chain/v1");
    hasher.update(&(event_index as u64).to_le_bytes());
    hasher.update(&timestamp_ns.to_le_bytes());
    hasher.update(&(source_data_rows.ranges().len() as u64).to_le_bytes());
    for source_range in source_data_rows.ranges() {
        hasher.update(&source_range.first.to_le_bytes());
        hasher.update(&source_range.last.to_le_bytes());
    }
    checkpoint_digest_field(&mut hasher, next_digest.as_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn build_screen_credit_substrate(raw_events: &[Row]) -> Result<ScreenCreditSubstrate, String> {
    let mut by_participant: BTreeMap<String, Vec<(i64, String, SourceDataRows)>> = BTreeMap::new();
    for row in raw_events {
        by_participant
            .entry(if row.participant_id.is_empty() {
                "unknown".into()
            } else {
                row.participant_id.to_string()
            })
            .or_default()
            .push((
                row.event_timestamp_ns,
                row.interaction_type.to_string(),
                row.source_data_rows.clone(),
            ));
    }
    let mut substrate = ScreenCreditSubstrate::default();
    for (participant_id, mut events) in by_participant {
        events.sort_by_key(|event| event.0);
        let mut points = Vec::new();
        let mut last = None;
        for (timestamp_ns, interaction_type, source_data_rows) in &events {
            let state = screen_witness_state(interaction_type).map_err(|error| {
                match source_data_rows.iter().next() {
                    Some(data_row) => format!("{error} (data row {data_row})"),
                    None => error,
                }
            })?;
            if let Some(state) = state {
                if Some(state) != last {
                    points.push(ScreenChangePoint {
                        timestamp_ns: *timestamp_ns,
                        state,
                        source_data_rows: source_data_rows.clone(),
                    });
                    last = Some(state);
                }
            }
        }
        if events
            .iter()
            .any(|(_, kind, _)| kind == "Screen Interactive")
            && events
                .iter()
                .any(|(_, kind, _)| kind == "Screen Non-Interactive")
        {
            substrate.capable.insert(participant_id.clone());
        }
        substrate.boots.insert(
            participant_id.clone(),
            events
                .iter()
                .filter(|(_, kind, _)| kind == "Device Startup")
                .map(|event| event.0)
                .collect(),
        );
        substrate.all_timestamps.insert(
            participant_id.clone(),
            events.iter().map(|event| event.0).collect(),
        );
        let source_events = events
            .iter()
            .map(|event| (event.0, event.2.clone()))
            .collect::<Vec<_>>();
        let mut source_event_suffix_digests = vec![String::new(); source_events.len() + 1];
        source_event_suffix_digests[source_events.len()] =
            empty_lineage_search_suffix_digest(source_events.len() as u32);
        for index in (0..source_events.len()).rev() {
            source_event_suffix_digests[index] = screen_source_event_suffix_digest(
                source_events[index].0,
                &source_events[index].1,
                index,
                &source_event_suffix_digests[index + 1],
            );
        }
        substrate
            .source_events
            .insert(participant_id.clone(), source_events);
        substrate
            .source_event_suffix_digests
            .insert(participant_id.clone(), source_event_suffix_digests);
        substrate.points.insert(participant_id, points);
    }
    Ok(substrate)
}

fn credit_lineage_contributors(
    substrate: &ScreenCreditSubstrate,
    participant_id: &str,
    start: i64,
    end: i64,
    tolerance_ns: i64,
) -> (SourceDataRows, Option<LineageSearchEvidence>) {
    let mut contributors = SourceDataRows::default();
    let search = if let (Some(events), Some(suffix_digests)) = (
        substrate.source_events.get(participant_id),
        substrate.source_event_suffix_digests.get(participant_id),
    ) {
        let lower_bound = start.saturating_sub(tolerance_ns);
        let upper_bound = end.saturating_add(tolerance_ns);
        let lower = events.partition_point(|event| event.0 < lower_bound);
        let upper = events.partition_point(|event| event.0 <= upper_bound);
        Some(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("screen-credit-liveness-window"),
            index_space: shared_lineage_text("participant-source-event-order"),
            start_participant_id: Arc::new(participant_id.to_owned()),
            start_event_index: lower as u32,
            end_event_index_exclusive: upper as u32,
            candidate_event_count: (upper - lower) as u32,
            candidate_chain_digest: lineage_search_range_digest(
                suffix_digests,
                lower as u32,
                upper as u32,
            ),
        })
    } else {
        None
    };
    if let Some(points) = substrate.points.get(participant_id) {
        let first_after_start = points.partition_point(|point| point.timestamp_ns <= start);
        if let Some(point) = first_after_start
            .checked_sub(1)
            .and_then(|index| points.get(index))
        {
            contributors.merge(&point.source_data_rows);
        }
        let first_after_end = points.partition_point(|point| point.timestamp_ns <= end);
        for point in &points[first_after_start..first_after_end] {
            contributors.merge(&point.source_data_rows);
        }
    }
    (contributors, search)
}

#[cfg(test)]
fn bisect_left(values: &[i64], target: i64) -> usize {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let middle = (low + high) / 2;
        if values[middle] < target {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

fn bisect_right(values: &[i64], target: i64) -> usize {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let middle = (low + high) / 2;
        if values[middle] <= target {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

fn build_alive_spans(timestamps: &[i64], tolerance_ns: i64, boots: &[i64]) -> Vec<CreditInterval> {
    if timestamps.is_empty() {
        return Vec::new();
    }
    let booted = |left: i64, right: i64| {
        let index = bisect_right(boots, left);
        index < boots.len() && boots[index] <= right.saturating_add(10_000_000_000)
    };
    let mut spans = Vec::new();
    let mut span_start = timestamps[0];
    let mut last = timestamps[0];
    for timestamp in &timestamps[1..] {
        if timestamp.saturating_sub(last) <= tolerance_ns && !booted(last, *timestamp) {
            last = *timestamp;
        } else {
            spans.push((span_start, last));
            span_start = *timestamp;
            last = *timestamp;
        }
    }
    spans.push((span_start, last));
    spans
}

fn clip_alive_spans(spans: &[CreditInterval], start: i64, end: i64) -> Vec<CreditInterval> {
    let first = spans.partition_point(|span| span.1 <= start);
    spans[first..]
        .iter()
        .take_while(|span| span.0 < end)
        .filter_map(|(left, right)| {
            let left = (*left).max(start);
            let right = (*right).min(end);
            (right > left).then_some((left, right))
        })
        .collect()
}

#[cfg(test)]
fn reference_alive_intervals(
    timestamps: &[i64],
    start: i64,
    end: i64,
    tolerance_ns: i64,
    boots: &[i64],
) -> Vec<CreditInterval> {
    let lower = bisect_left(timestamps, start.saturating_sub(tolerance_ns));
    let upper = bisect_right(timestamps, end.saturating_add(tolerance_ns));
    let window = &timestamps[lower..upper];
    if window.is_empty() {
        return Vec::new();
    }
    let booted = |left: i64, right: i64| {
        let index = bisect_right(boots, left);
        index < boots.len() && boots[index] <= right.saturating_add(10_000_000_000)
    };
    let mut spans = Vec::new();
    let mut span_start = window[0];
    let mut last = window[0];
    for timestamp in &window[1..] {
        if timestamp.saturating_sub(last) <= tolerance_ns && !booted(last, *timestamp) {
            last = *timestamp;
        } else {
            spans.push((span_start, last));
            span_start = *timestamp;
            last = *timestamp;
        }
    }
    spans.push((span_start, last));
    spans
        .into_iter()
        .filter_map(|(left, right)| {
            let left = left.max(start);
            let right = right.min(end);
            (right > left).then_some((left, right))
        })
        .collect()
}

fn screen_state_at(points: &[ScreenChangePoint], timestamp: i64) -> Option<ScreenCreditState> {
    points
        .partition_point(|point| point.timestamp_ns <= timestamp)
        .checked_sub(1)
        .map(|index| points[index].state)
}

fn creditable_intervals(
    points: &[ScreenChangePoint],
    start: i64,
    end: i64,
    auto_lock_ns: i64,
) -> Vec<CreditInterval> {
    let first_point_after_start = points.partition_point(|point| point.timestamp_ns <= start);
    let mut state = first_point_after_start
        .checked_sub(1)
        .map(|index| points[index].state);
    let mut point_index = first_point_after_start;
    let mut cursor = start;
    let mut current: Option<CreditInterval> = None;
    let mut output = Vec::new();
    while cursor < end {
        let segment_end = points
            .get(point_index)
            .map(|point| point.timestamp_ns.min(end))
            .unwrap_or(end);
        if segment_end > cursor {
            match state {
                Some(ScreenCreditState::On) => {
                    current = Some(match current {
                        Some((left, _)) => (left, segment_end),
                        None => (cursor, segment_end),
                    });
                }
                Some(ScreenCreditState::Off)
                    if current.is_some() && segment_end - cursor < auto_lock_ns =>
                {
                    current = current.map(|(left, _)| (left, segment_end));
                }
                _ => {
                    if let Some(interval) = current.take() {
                        output.push(interval);
                    }
                }
            }
        }
        cursor = segment_end;
        if let Some(point) = points.get(point_index) {
            state = Some(point.state);
            point_index += 1;
        } else {
            break;
        }
    }
    if let Some(interval) = current {
        output.push(interval);
    }
    output
}

fn intersect_intervals(left: &[CreditInterval], right: &[CreditInterval]) -> Vec<CreditInterval> {
    let mut output = Vec::new();
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        let lower = left[left_index].0.max(right[right_index].0);
        let upper = left[left_index].1.min(right[right_index].1);
        if upper > lower {
            output.push((lower, upper));
        }
        if left[left_index].1 < right[right_index].1 {
            left_index += 1;
        } else {
            right_index += 1;
        }
    }
    output
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CreditDecision {
    Passthrough,
    Intervals {
        intervals: Vec<CreditInterval>,
        session_capped: bool,
        no_witness_fallback: bool,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreditEmissionCounts {
    truncated_sessions: usize,
    no_witness_fallbacks: usize,
    fully_dead_sessions: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditPartitionCheckpoint<'a> {
    session_count: usize,
    rest_count: usize,
    session_rows_digest: &'a str,
    rest_rows_digest: &'a str,
}

struct ScreenCreditOutput {
    csv_bytes: Vec<u8>,
    row_count: u32,
    row_lineage: Vec<PipelineRowLineage>,
    effective_usage_checkpoint: LogicalStageCheckpoint,
}

fn is_credit_session(row: &Row) -> bool {
    row.interaction_type == APP_USAGE && row.duration_minutes.is_some_and(|duration| duration > 0.0)
}

fn apply_screen_gated_credit_incremental(
    app_rows: &[Row],
    raw_events: &[Row],
    opts: &PipelineV2Options,
    include_aliases: bool,
    input_row_parts: Option<&[RowCheckpointParts]>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<ScreenCreditOutput, String> {
    let partition = incremental::partition_credit_sessions(app_rows, input_row_parts)?;
    step_checkpoints.value(
        "partition_credit_sessions",
        &CreditPartitionCheckpoint {
            session_count: partition.sessions.len(),
            rest_count: partition.rest.len(),
            session_rows_digest: &partition.session_rows_digest,
            rest_rows_digest: &partition.rest_rows_digest,
        },
    )?;

    let substrate = incremental::build_liveness_substrate(raw_events)?;
    step_checkpoints.value("build_liveness_substrate", &substrate)?;
    let screen_incapable = incremental::screen_incapable_participants(&partition, &substrate);
    step_checkpoints.value("report_screen_incapable", &screen_incapable)?;

    let day_apps = incremental::count_day_apps(&partition);
    let day_app_checkpoint = day_apps
        .iter()
        .map(|((participant_id, date), packages)| {
            serde_json::json!({
                "participantId": participant_id,
                "date": date,
                "packages": packages,
            })
        })
        .collect::<Vec<_>>();
    step_checkpoints.value("count_day_apps", &day_app_checkpoint)?;

    let decisions = incremental::credit_sessions(
        &partition,
        &substrate,
        &day_apps,
        opts.credited_session_cap_minutes,
        opts.device_liveness_gap_tolerance_minutes,
        opts.auto_lock_bridge_seconds,
        opts.no_witness_min_day_apps,
    );
    step_checkpoints.value(
        "credit_sessions",
        &serde_json::json!({
            "decisions": decisions,
            "toleranceMinutes": opts.device_liveness_gap_tolerance_minutes,
        }),
    )?;

    let emission = incremental::emit_credited_rows(
        &partition,
        &decisions,
        &substrate,
        opts.device_liveness_gap_tolerance_minutes,
    );
    step_checkpoints.value(
        "emit_credited_rows",
        &serde_json::json!({
            "creditedRowsDigest": emission.credited_rows_digest,
            "emissionCounts": emission.counts,
        }),
    )?;
    let result = incremental::assemble_credit_result(&partition, &screen_incapable, &emission);
    step_checkpoints.value(
        "assemble_credit_result",
        &serde_json::json!({
            "creditedRowsDigest": result.credited_rows_digest,
            "restRowsDigest": result.rest_rows_digest,
            "report": result.report,
        }),
    )?;
    let assemble_terminal_digest = step_checkpoints
        .checkpoints
        .get("assemble_credit_result")
        .expect("assemble credit checkpoint was just recorded")
        .terminal_digest
        .clone();
    let effective_usage_checkpoint = logical_stage_checkpoint(
        "effective_usage",
        &[],
        &[(
            "assemble_credit_result",
            assemble_terminal_digest.as_bytes(),
        )],
    );
    let row_count = u32::try_from(result.rows.len())
        .map_err(|_| "credited app row count exceeds u32".to_string())?;
    let csv_bytes =
        write_app_csv_from_iter(result.rows.iter(), result.rows.len(), opts, include_aliases);
    let row_lineage =
        build_row_lineage_from_iter("credited-app-csv", "effective_usage", result.rows.iter());
    Ok(ScreenCreditOutput {
        csv_bytes,
        row_count,
        row_lineage,
        effective_usage_checkpoint,
    })
}

// ---- screen state machine ----------------------------------------------

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ScreenState {
    start_index: usize,
    start_timestamp_ns: i64,
    start_timezone: SharedString,
    lock_screen_seen: bool,
    unlocked_seen: bool,
    foreground_pkg: Option<SharedString>,
    last_meaningful_ts_ns: Option<i64>,
    last_meaningful_pkg: Option<SharedString>,
    source_data_rows: SourceDataRows,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ScreenSessionClose {
    state: ScreenState,
    stop_timestamp_ns: Option<i64>,
    stop_event_type: Option<SharedString>,
}

fn derive_screen_usage_sessions_full(
    rows: &[Row],
    opts: &PipelineV2Options,
    apps_forcing: &HashMap<String, String>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let keyguard_timestamps = incremental::collect_keyguard_timestamps(rows);
    step_checkpoints.value("collect_keyguard_timestamps", &keyguard_timestamps)?;
    let closes = incremental::walk_screen_state_machine(rows);
    step_checkpoints.value("walk_screen_state_machine", &closes)?;
    let sessions = incremental::build_classified_sessions(
        rows,
        &closes,
        &keyguard_timestamps,
        apps_forcing,
        incremental::ScreenClassificationSettings {
            auto_lock_timeout_seconds: opts.screen_auto_lock_timeout_seconds,
            auto_lock_tolerance_seconds: opts.screen_auto_lock_tolerance_seconds,
            manual_lock_max_tail_seconds: opts.screen_manual_lock_max_tail_seconds,
            keyguard_near_stop_seconds: opts.screen_keyguard_near_stop_seconds,
        },
    );
    step_checkpoints.rows("build_classified_sessions", &sessions);
    Ok(sessions)
}

// ---- output writer ------------------------------------------------------

pub fn declared_app_output_columns(
    include_codebook: bool,
    include_codebook_aliases: bool,
    usage_layer_active: bool,
    custom_app_engagement_duration: f64,
) -> Vec<String> {
    let mut cols: Vec<String> = Vec::with_capacity(64);
    cols.push("study_id".into());
    cols.push("study_name".into());
    cols.push("participant_id".into());
    cols.push("possible_device_model".into());
    cols.push("username".into());
    cols.push("event_timestamp".into());
    cols.push("date".into());
    cols.push("timezone".into());
    cols.push("app_package_name".into());
    cols.push("application_label".into());
    if include_codebook {
        cols.push("genreId_scraped".into());
    }
    if include_codebook && include_codebook_aliases {
        cols.push("broad_app_category".into());
    }
    if include_codebook {
        for c in codebook_output_columns() {
            cols.push(c.to_string());
        }
    }
    cols.push("interaction_type".into());
    cols.push("start_timestamp".into());
    cols.push("stop_timestamp".into());
    cols.push("duration_seconds".into());
    cols.push("duration_minutes".into());
    cols.push("any_app_usage_flags".into());
    cols.push("data_time_gap_hours".into());
    cols.push("day".into());
    cols.push("weekdayMF".into());
    cols.push("weekdayMTh".into());
    cols.push("weekdaySuTh".into());
    cols.push("hour".into());
    cols.push("quarter".into());
    cols.push("valid_app_new_engage_30s".into());
    cols.push(format!(
        "valid_app_new_engage_custom_{}s",
        format_custom_dur(custom_app_engagement_duration)
    ));
    cols.push("valid_app_switched_app".into());
    cols.push("valid_app_usage_time_gap_hours".into());
    cols.push("any_app_new_engage_30s".into());
    cols.push(format!(
        "any_app_new_engage_custom_{}s",
        format_custom_dur(custom_app_engagement_duration)
    ));
    cols.push("any_app_switched_app".into());
    cols.push("any_app_usage_time_gap_hours".into());
    cols.push("preprocessor_version".into());
    cols.push("datetime_of_preprocessing".into());
    if usage_layer_active {
        cols.push("usage_layer".into());
    }
    cols
}

fn build_app_columns(opts: &PipelineV2Options, include_codebook_aliases: bool) -> Vec<String> {
    declared_app_output_columns(
        opts.use_app_codebook,
        include_codebook_aliases,
        opts.model_concurrent_usage || opts.use_background_apps_file,
        opts.custom_app_engagement_duration,
    )
}

fn format_custom_dur(d: f64) -> String {
    js_number_to_string(d)
}

pub fn declared_screen_output_columns() -> Vec<String> {
    vec![
        "study_id",
        "study_name",
        "participant_id",
        "possible_device_model",
        "username",
        "event_timestamp",
        "date",
        "timezone",
        "app_package_name",
        "application_label",
        "interaction_type",
        "start_timestamp",
        "stop_timestamp",
        "duration_seconds",
        "duration_minutes",
        "screen_usage_end_reason",
        "screen_usage_end_reason_confidence",
        "screen_usage_stop_event_type",
        "screen_usage_last_activity_timestamp",
        "screen_usage_tail_gap_seconds",
        "screen_usage_foreground_app_package",
        "screen_usage_apps_forcing_screen_open_label",
        "screen_usage_lock_screen_only",
        "data_time_gap_hours",
        "day",
        "weekdayMF",
        "weekdayMTh",
        "weekdaySuTh",
        "hour",
        "quarter",
        "preprocessor_version",
        "datetime_of_preprocessing",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn build_screen_columns() -> Vec<String> {
    declared_screen_output_columns()
}

fn append_csv_field(out: &mut Vec<u8>, value: &str) {
    write_csv_field(out, value.as_bytes());
}

const SMALL_U8_DECIMALS: [&str; 24] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
    "17", "18", "19", "20", "21", "22", "23",
];

fn begin_csv_field(out: &mut Vec<u8>, first: &mut bool) {
    if !*first {
        out.push(b',');
    }
    *first = false;
}

fn emit_csv_u8(out: &mut Vec<u8>, value: u8, first: &mut bool) {
    begin_csv_field(out, first);
    if let Some(value) = SMALL_U8_DECIMALS.get(value as usize) {
        out.extend_from_slice(value.as_bytes());
    } else {
        append_csv_field(out, &value.to_string());
    }
}

fn emit_csv_i32(out: &mut Vec<u8>, value: i32, first: &mut bool) {
    begin_csv_field(out, first);
    match value {
        0 => out.push(b'0'),
        1 => out.push(b'1'),
        _ => append_csv_field(out, &value.to_string()),
    }
}

fn emit_csv_optional_float(out: &mut Vec<u8>, value: Option<f64>, first: &mut bool) {
    begin_csv_field(out, first);
    match value {
        None => {}
        Some(0.0) => out.extend_from_slice(b"0.0"),
        Some(value) => append_csv_field(out, &normalize_float_string(value)),
    }
}

fn emit_csv_float(out: &mut Vec<u8>, value: f64, first: &mut bool) {
    begin_csv_field(out, first);
    if value == 0.0 {
        out.extend_from_slice(b"0.0");
    } else {
        append_csv_field(out, &normalize_float_string(value));
    }
}

fn write_app_csv(rows: &[Row], opts: &PipelineV2Options, include_aliases: bool) -> Vec<u8> {
    write_app_csv_from_iter(rows.iter(), rows.len(), opts, include_aliases)
}

fn write_app_csv_from_iter<'a>(
    rows: impl Iterator<Item = &'a Row>,
    row_count: usize,
    opts: &PipelineV2Options,
    include_aliases: bool,
) -> Vec<u8> {
    let cols = build_app_columns(opts, include_aliases);
    let estimated_row_bytes = if opts.use_app_codebook { 512 } else { 384 };
    let mut out: Vec<u8> = Vec::with_capacity(row_count.saturating_mul(estimated_row_bytes));
    // header
    for (i, c) in cols.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        append_csv_field(&mut out, c);
    }
    out.push(b'\n');
    let tz: Tz = opts.timezone.parse().unwrap_or(Tz::UTC);
    let pp_version = PREPROCESSOR_VERSION;
    let dop = &opts.datetime_of_preprocessing;
    for row in rows {
        let row_tz = if row.timezone.as_str() == opts.timezone {
            tz
        } else {
            row.timezone.parse().unwrap_or(tz)
        };
        let mut first = true;
        let emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
            if !*first {
                out.push(b',');
            }
            *first = false;
            append_csv_field(out, s);
        };
        emit(&mut out, &row.study_id, &mut first);
        emit(&mut out, &opts.study_name, &mut first);
        emit(&mut out, &row.participant_id, &mut first);
        emit(&mut out, &row.possible_device_model, &mut first);
        emit(&mut out, &row.username, &mut first);
        emit_event_timestamp(&mut out, row.event_timestamp_ns, row_tz, &mut first);
        emit(&mut out, &row.date, &mut first);
        emit(&mut out, &row.timezone, &mut first);
        emit(&mut out, &row.app_package_name, &mut first);
        emit(&mut out, &row.application_label, &mut first);
        if opts.use_app_codebook {
            emit(
                &mut out,
                row.genre_id_scraped.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        if opts.use_app_codebook && include_aliases {
            emit(
                &mut out,
                row.broad_app_category.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        if opts.use_app_codebook {
            for (i, _) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
                let val = if row.codebook_genre_fields_cleared
                    && COLLAPSED_GENRE_FIELD_INDICES.contains(&i)
                {
                    ""
                } else {
                    row.codebook_fields
                        .get(i)
                        .and_then(|v| v.as_deref())
                        .unwrap_or("")
                };
                let normalized = if val == "True" {
                    "true"
                } else if val == "False" {
                    "false"
                } else {
                    val
                };
                emit(&mut out, normalized, &mut first);
            }
        }
        emit(&mut out, &row.interaction_type, &mut first);
        emit_session_timestamp(&mut out, row.start_timestamp_ns, row_tz, &mut first);
        emit_session_timestamp(&mut out, row.stop_timestamp_ns, row_tz, &mut first);
        emit_csv_optional_float(&mut out, row.duration_seconds, &mut first);
        emit_csv_optional_float(&mut out, row.duration_minutes, &mut first);
        emit(&mut out, &row.any_app_usage_flags, &mut first);
        emit_csv_float(&mut out, row.data_time_gap_hours, &mut first);
        emit_csv_u8(&mut out, row.day, &mut first);
        emit_csv_u8(&mut out, row.weekday_mf, &mut first);
        emit_csv_u8(&mut out, row.weekday_mth, &mut first);
        emit_csv_u8(&mut out, row.weekday_su_th, &mut first);
        emit_csv_u8(&mut out, row.hour, &mut first);
        emit_csv_u8(&mut out, row.quarter, &mut first);
        emit_csv_i32(&mut out, row.valid_app_new_engage_30s, &mut first);
        emit_csv_i32(&mut out, row.valid_app_new_engage_custom, &mut first);
        emit_csv_i32(&mut out, row.valid_app_switched_app, &mut first);
        emit_csv_float(&mut out, row.valid_app_usage_time_gap_hours, &mut first);
        emit_csv_i32(&mut out, row.any_app_new_engage_30s, &mut first);
        emit_csv_i32(&mut out, row.any_app_new_engage_custom, &mut first);
        emit_csv_i32(&mut out, row.any_app_switched_app, &mut first);
        emit_csv_float(&mut out, row.any_app_usage_time_gap_hours, &mut first);
        emit(&mut out, pp_version, &mut first);
        emit(&mut out, dop, &mut first);
        if opts.model_concurrent_usage || opts.use_background_apps_file {
            emit(
                &mut out,
                row.usage_layer.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        out.push(b'\n');
    }
    out
}

fn write_screen_csv(rows: &[Row], opts: &PipelineV2Options) -> Vec<u8> {
    let cols = build_screen_columns();
    let mut out: Vec<u8> = Vec::with_capacity(rows.len().saturating_mul(384));
    for (i, c) in cols.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        append_csv_field(&mut out, c);
    }
    out.push(b'\n');
    if rows.is_empty() {
        return out;
    }
    let tz: Tz = opts.timezone.parse().unwrap_or(Tz::UTC);
    let pp_version = PREPROCESSOR_VERSION;
    let dop = &opts.datetime_of_preprocessing;
    for row in rows {
        let row_tz = if row.timezone.as_str() == opts.timezone {
            tz
        } else {
            row.timezone.parse().unwrap_or(tz)
        };
        let mut first = true;
        let emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
            if !*first {
                out.push(b',');
            }
            *first = false;
            append_csv_field(out, s);
        };
        emit(&mut out, &row.study_id, &mut first);
        emit(&mut out, &opts.study_name, &mut first);
        emit(&mut out, &row.participant_id, &mut first);
        emit(&mut out, &row.possible_device_model, &mut first);
        emit(&mut out, &row.username, &mut first);
        emit_event_timestamp(&mut out, row.event_timestamp_ns, row_tz, &mut first);
        emit(&mut out, &row.date, &mut first);
        emit(&mut out, &row.timezone, &mut first);
        emit(&mut out, &row.app_package_name, &mut first);
        emit(&mut out, "", &mut first); // application_label always empty
        emit(&mut out, &row.interaction_type, &mut first);
        emit_screen_timestamp(&mut out, row.start_timestamp_ns, row_tz, &mut first);
        emit_screen_timestamp(&mut out, row.stop_timestamp_ns, row_tz, &mut first);
        emit_csv_optional_float(&mut out, row.duration_seconds, &mut first);
        emit_csv_optional_float(&mut out, row.duration_minutes, &mut first);
        emit(
            &mut out,
            row.screen_usage_end_reason.as_deref().unwrap_or(""),
            &mut first,
        );
        emit_csv_optional_float(&mut out, row.screen_usage_end_reason_confidence, &mut first);
        emit(
            &mut out,
            row.screen_usage_stop_event_type.as_deref().unwrap_or(""),
            &mut first,
        );
        emit_screen_last_activity(
            &mut out,
            row.screen_usage_last_activity_timestamp_ns,
            row_tz,
            &mut first,
        );
        emit_csv_optional_float(&mut out, row.screen_usage_tail_gap_seconds, &mut first);
        emit(
            &mut out,
            row.screen_usage_foreground_app_package
                .as_deref()
                .unwrap_or(""),
            &mut first,
        );
        emit(
            &mut out,
            row.screen_usage_apps_forcing_screen_open_label
                .as_deref()
                .unwrap_or(""),
            &mut first,
        );
        let lso = match row.screen_usage_lock_screen_only {
            None => "",
            Some(0) => "false",
            Some(_) => "true",
        };
        emit(&mut out, lso, &mut first);
        emit(&mut out, "", &mut first); // data_time_gap_hours always blank in screen
        emit_csv_u8(&mut out, row.day, &mut first);
        emit_csv_u8(&mut out, row.weekday_mf, &mut first);
        emit_csv_u8(&mut out, row.weekday_mth, &mut first);
        emit_csv_u8(&mut out, row.weekday_su_th, &mut first);
        emit_csv_u8(&mut out, row.hour, &mut first);
        emit_csv_u8(&mut out, row.quarter, &mut first);
        emit(&mut out, pp_version, &mut first);
        emit(&mut out, dop, &mut first);
        out.push(b'\n');
    }
    out
}

// ---- main runner --------------------------------------------------------

pub fn run_pipeline_v2(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    filter_csv: &[u8],
    apps_forcing_csv: &[u8],
    codebook_csv: &[u8],
) -> Result<PipelineV2Result, String> {
    run_pipeline_v2_with_supports(
        csv_bytes,
        opts,
        PipelineV2SupportFiles {
            filter_csv,
            apps_forcing_csv,
            codebook_csv,
            ..PipelineV2SupportFiles::default()
        },
    )
}

pub fn run_pipeline_v2_with_background(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    filter_csv: &[u8],
    apps_forcing_csv: &[u8],
    background_apps_csv: &[u8],
    codebook_csv: &[u8],
) -> Result<PipelineV2Result, String> {
    run_pipeline_v2_with_supports(
        csv_bytes,
        opts,
        PipelineV2SupportFiles {
            filter_csv,
            apps_forcing_csv,
            background_apps_csv,
            codebook_csv,
            ..PipelineV2SupportFiles::default()
        },
    )
}

pub fn run_pipeline_v2_with_supports(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PipelineV2Result, String> {
    let mut logical_stage_digests = BTreeMap::new();
    let mut logical_stage_checkpoints = BTreeMap::new();
    let mut pipeline_step_digests = BTreeMap::new();
    let mut pipeline_step_checkpoints = BTreeMap::new();
    let mut step_checkpoints = StepCheckpointRecorder {
        digests: &mut pipeline_step_digests,
        checkpoints: &mut pipeline_step_checkpoints,
        next_step_index: 0,
        error: None,
        last_row_parts: None,
        last_row_checkpoint: None,
    };
    // 1. parse + sort + canonicalize
    let (mut rows, _tz) = parse_raw_rows(csv_bytes, opts, &mut step_checkpoints)?;
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint_reusing_last("parse_events", &rows, &step_checkpoints),
    );
    let original_count = rows.len() as u32;
    let available_timezones: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let timezone = row.timezone.trim();
            (!timezone.is_empty()).then_some(timezone.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let rows_before_timezone_handling = rows.len() as u32;

    // 2. Resolve the product's four timezone policies in Rust. The primary
    // timezone is the most frequent non-empty input value; a tie keeps the
    // first timezone encountered, matching JavaScript Map insertion order.
    let primary_timezone = incremental::compute_dominant_timezone(&rows);
    step_checkpoints.value("compute_dominant_timezone", &primary_timezone)?;
    let selection = incremental::select_timezone_strategy(
        Arc::new(rows),
        &opts.timezone,
        &opts.timezone_handling,
        &primary_timezone,
    )?;
    rows = Arc::try_unwrap(selection.rows).unwrap_or_else(|rows| (*rows).clone());
    let target_timezone = selection.target_timezone;
    let timezone_action = selection.action;
    step_checkpoints.rows_and_value(
        "select_timezone_strategy",
        &rows,
        &serde_json::json!({
            "targetTimezone": &target_timezone,
            "action": timezone_action,
        }),
    )?;
    let rows_after_timezone_handling = rows.len() as u32;
    let row_count_report =
        incremental::row_count_report(rows_before_timezone_handling, rows_after_timezone_handling);
    let rows_removed_by_timezone = row_count_report.removed;
    let timezone_retained_source_rows_digest = timezone_retained_source_rows_digest(&rows);
    let mut effective_opts = opts.clone();
    effective_opts.timezone = target_timezone;
    let opts = &effective_opts;
    rows = incremental::restamp_rows(rows, &opts.timezone)?;
    step_checkpoints.rows("restamp_rows", &rows);
    let timezone_stage_digest = timezone_stage_digest(&rows);
    step_checkpoints.value("row_count_report", &row_count_report)?;
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint_reusing_last("normalize_timezones", &rows, &step_checkpoints),
    );

    // 3. dedupe + (optional) unalign duplicate timestamps + mark gaps
    let rows_before_deduplication = rows.len();
    let deduped = incremental::exact_dedupe(rows, opts.deduplicate_exact_rows);
    step_checkpoints.rows("exact_dedupe", &deduped);
    let exact_duplicate_rows_removed =
        rows_before_deduplication.saturating_sub(deduped.len()) as u32;
    let dupes_before = count_duplicate_groups(&deduped);
    step_checkpoints.value("count_dup_groups", &dupes_before)?;
    let dupe_corrected = incremental::nudge_duplicate_timestamps(
        deduped,
        opts.correct_duplicate_event_timestamps,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
    );
    step_checkpoints.rows("nudge_duplicate_timestamps", &dupe_corrected);
    let dupes_corrected = if opts.correct_duplicate_event_timestamps {
        dupes_before
    } else {
        0
    };
    let mut rows = incremental::mark_gaps(dupe_corrected);
    step_checkpoints.rows("mark_data_time_gaps", &rows);
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint_reusing_last("dedup_and_order", &rows, &step_checkpoints),
    );

    // 4. filter labeling
    let filter_map = if opts.use_filter_file && !support.filter_csv.is_empty() {
        parse_filter_csv(support.filter_csv)
    } else {
        HashMap::new()
    };
    if opts.use_filter_file {
        rows = label_filtered_apps(rows, &filter_map);
    }
    step_checkpoints.rows("tag_filtered_packages", &rows);
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint_reusing_last("app_policy", &rows, &step_checkpoints),
    );
    let apps_forcing_map =
        if opts.use_apps_forcing_screen_open && !support.apps_forcing_csv.is_empty() {
            parse_apps_forcing_csv(support.apps_forcing_csv)
        } else {
            HashMap::new()
        };
    let background_apps =
        if opts.use_background_apps_file && !support.background_apps_csv.is_empty() {
            parse_background_apps_csv(support.background_apps_csv)
        } else {
            AHashSet::new()
        };

    // 5. screen-usage derivation (if requested)
    let mut screen_rows: Vec<Row> = Vec::new();
    if matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    ) {
        screen_rows = derive_screen_usage_sessions_full(
            &rows,
            opts,
            &apps_forcing_map,
            &mut step_checkpoints,
        )?;
    } else {
        step_checkpoints.state("collect_keyguard_timestamps", "not_applicable");
        step_checkpoints.state("walk_screen_state_machine", "not_applicable");
        step_checkpoints.state("build_classified_sessions", "not_applicable");
    }
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint("device_state_timeline", &screen_rows),
    );

    // Product contract: processedRowCount is the canonical policy-row count
    // before session reconstruction, not the number of emitted app sessions.
    // The old fused path overwrote it with app_row_count in app modes even
    // when the emitted CSV bytes were otherwise identical to TypeScript.
    let processed_count = rows.len() as u32;
    let policy_rows = rows.clone();
    let app_csv_bytes;
    let screen_csv_bytes;
    let day_coverage_csv_bytes;
    let compliance_csv_bytes;
    let credited_app_csv_bytes;
    let day_coverage_row_count;
    let compliance_row_count;
    let credited_app_row_count;
    let mut credited_app_row_lineage = Vec::new();
    let app_rows_for_review;
    let app_row_count;
    let screen_row_count = screen_rows.len() as u32;

    if matches!(
        opts.usage_session_mode,
        UsageSessionMode::NoUsage | UsageSessionMode::ScreenUsage
    ) {
        for step_id in [
            "compute_junk_packages",
            "junk_blind_fold",
            "build_matcher_input",
            "run_matcher",
            "apply_matcher_output",
            "relabel_usage_with_floor",
            "junk_downstream_mark",
            "sort_episodes",
            "split_concurrent",
            "codebook_join",
            "derive_broad_category",
            "collapse_genre",
            "engagement_walk",
            "flag_and_retain",
            "blank_junk_timing",
            "drop_selected_types",
            "drop_zero_duration",
            "partition_credit_sessions",
            "build_liveness_substrate",
            "report_screen_incapable",
            "count_day_apps",
            "credit_sessions",
            "emit_credited_rows",
            "assemble_credit_result",
            "resolve_participant_windows",
            "filter_rows_to_window",
            "resolve_sharing_status",
            "build_survey_lookup",
            "attribute_rows",
            "inject_placeholders",
            "build_raw_date_index",
            "build_coverage_table",
            "accumulate_attribution_minutes",
            "score_days",
        ] {
            step_checkpoints.state(step_id, "not_applicable");
        }
        for node_id in [
            "reconstruct_episodes",
            "categorize_apps",
            "episode_annotations",
            "interval_cleaning",
            "effective_usage",
            "observation_window",
            "attribute_person",
            "day_coverage",
            "score_compliance",
        ] {
            record_logical_stage_checkpoint(
                &mut logical_stage_digests,
                &mut logical_stage_checkpoints,
                logical_stage_state_checkpoint(node_id, "not_applicable"),
            );
        }
        app_row_count = 0;
        app_csv_bytes = Vec::new();
        day_coverage_csv_bytes = Vec::new();
        compliance_csv_bytes = Vec::new();
        credited_app_csv_bytes = Vec::new();
        day_coverage_row_count = 0;
        compliance_row_count = 0;
        credited_app_row_count = 0;
        app_rows_for_review = Vec::new();
        screen_csv_bytes = if opts.include_screen_output {
            write_screen_csv(&screen_rows, opts)
        } else {
            Vec::new()
        };
    } else {
        let study_windows = if support.study_dates_csv.is_empty() {
            Vec::new()
        } else {
            parse_study_windows(support.study_dates_csv)?
        };
        let mut shared_participants = BTreeSet::new();
        // 6. matcher (app usage)
        rows = run_app_usage_algorithm(rows, opts, &background_apps, &mut step_checkpoints)?;
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last(
                "reconstruct_episodes",
                &rows,
                &step_checkpoints,
            ),
        );

        // 7. codebook
        let codebook_map = if opts.use_app_codebook && !support.codebook_csv.is_empty() {
            parse_codebook_csv(support.codebook_csv)
        } else {
            HashMap::new()
        };
        let include_aliases =
            !opts.use_app_codebook || codebook_map.is_empty() || opts.include_category_column;

        // 8. enrich
        join_codebook(&mut rows, opts.use_app_codebook, &codebook_map);
        step_checkpoints.rows_and_value(
            "codebook_join",
            &rows,
            &serde_json::json!({"codebookIsEmpty": codebook_map.is_empty()}),
        )?;
        derive_broad_category(&mut rows, opts.use_app_codebook);
        step_checkpoints.rows("derive_broad_category", &rows);
        collapse_genre(&mut rows, opts.use_app_codebook);
        step_checkpoints.rows("collapse_genre", &rows);
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last("categorize_apps", &rows, &step_checkpoints),
        );
        add_app_usage_detail_columns(&mut rows, opts.custom_app_engagement_duration);
        step_checkpoints.rows("engagement_walk", &rows);
        mark_app_usage_flags(
            &mut rows,
            &opts.long_data_time_gap_thresholds,
            &opts.long_usage_duration_thresholds,
        );
        step_checkpoints.rows("flag_and_retain", &rows);
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last(
                "episode_annotations",
                &rows,
                &step_checkpoints,
            ),
        );
        clear_filtered_usage_timing(&mut rows);
        step_checkpoints.rows("blank_junk_timing", &rows);
        rows = incremental::drop_selected_types(
            rows,
            &opts.interaction_types_to_remove,
            &opts.long_data_time_gap_thresholds,
        );
        step_checkpoints.rows("drop_selected_types", &rows);
        rows = incremental::drop_zero_duration(rows, opts.filter_zero_duration_sessions);
        step_checkpoints.rows("drop_zero_duration", &rows);
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last(
                "interval_cleaning",
                &rows,
                &step_checkpoints,
            ),
        );
        let (credited_bytes, credited_count) = if opts.enable_screen_gated_crediting {
            let credit_input_parts = step_checkpoints.take_last_row_parts();
            let credited = apply_screen_gated_credit_incremental(
                &rows,
                &policy_rows,
                opts,
                include_aliases,
                credit_input_parts.as_deref(),
                &mut step_checkpoints,
            )?;
            record_logical_stage_checkpoint(
                &mut logical_stage_digests,
                &mut logical_stage_checkpoints,
                credited.effective_usage_checkpoint,
            );
            credited_app_row_lineage = credited.row_lineage;
            (credited.csv_bytes, credited.row_count)
        } else {
            for step_id in [
                "partition_credit_sessions",
                "build_liveness_substrate",
                "report_screen_incapable",
                "count_day_apps",
                "credit_sessions",
                "emit_credited_rows",
                "assemble_credit_result",
            ] {
                step_checkpoints.state(step_id, "not_applicable");
            }
            record_logical_stage_checkpoint(
                &mut logical_stage_digests,
                &mut logical_stage_checkpoints,
                logical_stage_state_checkpoint("effective_usage", "not_applicable"),
            );
            (Vec::new(), 0)
        };
        credited_app_csv_bytes = credited_bytes;
        credited_app_row_count = credited_count;
        let resolved_participant_windows = resolve_participant_windows(&rows, &study_windows);
        step_checkpoints.value("resolve_participant_windows", &resolved_participant_windows)?;
        if opts.enable_study_window_filter {
            if support.study_dates_csv.is_empty() {
                return Err(
                    "Study dates file is required when study-window filtering is enabled".into(),
                );
            }
            let (filtered, dropped_rows, participants_without_window) =
                apply_study_window(rows, &resolved_participant_windows);
            rows = filtered;
            step_checkpoints.rows_and_value(
                "filter_rows_to_window",
                &rows,
                &serde_json::json!({
                    "applied": true,
                    "droppedRows": dropped_rows,
                    "participantsWithoutWindow": participants_without_window,
                }),
            )?;
        } else {
            let mut participants_without_window = resolved_participant_windows
                .iter()
                .filter_map(|entry| {
                    entry
                        .window
                        .is_none()
                        .then_some(entry.participant_id.clone())
                })
                .collect::<Vec<_>>();
            participants_without_window.sort();
            step_checkpoints.rows_and_value(
                "filter_rows_to_window",
                &rows,
                &serde_json::json!({
                    "applied": false,
                    "droppedRows": 0,
                    "participantsWithoutWindow": participants_without_window,
                }),
            )?;
        }
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last(
                "observation_window",
                &rows,
                &step_checkpoints,
            ),
        );
        if opts.enable_person_attribution {
            if support.device_sharing_csv.is_empty() {
                return Err(
                    "Device sharing file is required when person attribution is enabled".into(),
                );
            }
            let sharing = parse_device_sharing(support.device_sharing_csv)?;
            let survey = parse_survey_lookup(support.survey_attribution_csv)?;
            let mut statuses = BTreeMap::new();
            for participant_id in rows.iter().map(|row| &row.participant_id) {
                if statuses.contains_key(participant_id.as_str()) {
                    continue;
                }
                let status = sharing_status_for(participant_id.as_str(), &sharing)?;
                if status == SharingStatus::Shared {
                    shared_participants.insert(participant_id.to_string());
                }
                statuses.insert(participant_id.to_string(), status);
            }
            let resolution = SharingResolution {
                shared_participants: statuses
                    .iter()
                    .filter_map(|(participant_id, status)| {
                        (*status == SharingStatus::Shared).then_some(participant_id.clone())
                    })
                    .collect(),
                non_shared_participants: statuses
                    .iter()
                    .filter_map(|(participant_id, status)| {
                        (*status == SharingStatus::NonShared).then_some(participant_id.clone())
                    })
                    .collect(),
                status_by_participant: statuses,
            };
            step_checkpoints.value("resolve_sharing_status", &resolution)?;
            let survey_checkpoint = survey
                .iter()
                .map(|((participant_id, event_timestamp_ns), user)| {
                    serde_json::json!({
                        "participantId": participant_id,
                        "eventTimestampNs": event_timestamp_ns,
                        "user": user,
                    })
                })
                .collect::<Vec<_>>();
            step_checkpoints.value("build_survey_lookup", &survey_checkpoint)?;
            let (attributed_rows, attribution_report) =
                attribute_person(rows, &resolution, &survey)?;
            rows = attributed_rows;
            step_checkpoints.rows_and_value(
                "attribute_rows",
                &rows,
                &serde_json::json!({
                    "applied": true,
                    "report": attribution_report,
                }),
            )?;
        } else {
            step_checkpoints.value(
                "resolve_sharing_status",
                &serde_json::json!({"enabled": false}),
            )?;
            step_checkpoints.value(
                "build_survey_lookup",
                &serde_json::json!({"enabled": false}),
            )?;
            step_checkpoints.rows_and_value(
                "attribute_rows",
                &rows,
                &serde_json::json!({"applied": false}),
            )?;
        }
        let shared_participants_checkpoint = value_fingerprint(&shared_participants)
            .map_err(|error| format!("serialize shared-participant checkpoint: {error}"))?;
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_checkpoint_with_parts(
                "attribute_person",
                &[("rows", &rows)],
                &[("shared_participants", &shared_participants_checkpoint)],
                step_checkpoints.last_row_parts(),
            ),
        );
        if opts.add_no_activity_placeholder_days {
            rows = add_no_activity_placeholder_rows(rows, &policy_rows);
        }
        step_checkpoints.rows_and_value(
            "inject_placeholders",
            &rows,
            &serde_json::json!({"applied": opts.add_no_activity_placeholder_days}),
        )?;
        let raw_date_index = build_raw_date_index(&policy_rows);
        step_checkpoints.value("build_raw_date_index", &raw_date_index)?;

        let (coverage_bytes, coverage_count) = if opts.enable_day_coverage {
            build_day_coverage_csv(
                &rows,
                &raw_date_index,
                &study_windows,
                &mut step_checkpoints,
            )?
        } else {
            step_checkpoints.state("build_coverage_table", "not_applicable");
            (Vec::new(), 0)
        };
        day_coverage_csv_bytes = coverage_bytes;
        day_coverage_row_count = coverage_count;
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_checkpoint_with_parts(
                "day_coverage",
                &[("rows", &rows)],
                &[("day_coverage_csv", &day_coverage_csv_bytes)],
                step_checkpoints.last_row_parts(),
            ),
        );
        let (compliance_bytes, compliance_count) = if opts.enable_compliance_scoring {
            let enrolled_devices = parse_enrolled_devices(support.enrolled_devices_csv)?;
            build_compliance_csv(
                &rows,
                &shared_participants,
                opts.compliance_threshold_percent,
                &enrolled_devices,
                &mut step_checkpoints,
            )?
        } else {
            step_checkpoints.state("accumulate_attribution_minutes", "not_applicable");
            step_checkpoints.state("score_days", "not_applicable");
            (Vec::new(), 0)
        };
        compliance_csv_bytes = compliance_bytes;
        compliance_row_count = compliance_count;
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_checkpoint(
                "score_compliance",
                &[],
                &[("compliance_csv", &compliance_csv_bytes)],
            ),
        );

        app_row_count = rows.len() as u32;
        app_rows_for_review = rows.clone();
        app_csv_bytes = if opts.include_app_output {
            write_app_csv(&rows, opts, include_aliases)
        } else {
            Vec::new()
        };
        screen_csv_bytes = if matches!(opts.usage_session_mode, UsageSessionMode::AppAndScreenUsage)
            && opts.include_screen_output
        {
            write_screen_csv(&screen_rows, opts)
        } else {
            Vec::new()
        };
    }

    let review_summary_json_bytes =
        serde_json::to_vec(&build_review_summary(&app_rows_for_review, &screen_rows))
            .map_err(|error| format!("serialize review summary: {error}"))?;
    let visualization_data_json_bytes = if opts.materialize_visualization_data {
        serde_json::to_vec(&build_visualization_data(
            &app_rows_for_review,
            &screen_rows,
            &policy_rows,
        ))
        .map_err(|error| format!("serialize visualization data: {error}"))?
    } else {
        Vec::new()
    };
    let aggregate_csv_outputs =
        aggregates::build_aggregate_outputs(&app_rows_for_review, &screen_rows, opts);
    let mut row_lineage = Vec::new();
    if !app_csv_bytes.is_empty() {
        row_lineage.extend(build_row_lineage(
            "app-csv",
            "outputs",
            &app_rows_for_review,
        ));
    }
    if !screen_csv_bytes.is_empty() {
        row_lineage.extend(build_row_lineage("screen-csv", "outputs", &screen_rows));
    }
    if !credited_app_csv_bytes.is_empty() {
        row_lineage.append(&mut credited_app_row_lineage);
    }

    let row_lineage_fingerprint = value_fingerprint(&row_lineage)
        .map_err(|error| format!("serialize row lineage checkpoint: {error}"))?;
    let aggregate_checkpoint_bytes = serde_json::to_vec(
        &aggregate_csv_outputs
            .iter()
            .map(|aggregate| {
                serde_json::json!({
                    "kind": aggregate.kind,
                    "rowCount": aggregate.row_count,
                    "digest": format!(
                        "sha256:{}",
                        hex::encode(Sha256::digest(&aggregate.bytes))
                    ),
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|error| format!("serialize aggregate checkpoint: {error}"))?;
    step_checkpoints.record(logical_stage_checkpoint(
        "assemble_result",
        &[],
        &[
            ("app_csv", &app_csv_bytes),
            ("screen_csv", &screen_csv_bytes),
            ("day_coverage_csv", &day_coverage_csv_bytes),
            ("compliance_csv", &compliance_csv_bytes),
            ("credited_app_csv", &credited_app_csv_bytes),
            ("review_summary_json", &review_summary_json_bytes),
            ("visualization_data_json", &visualization_data_json_bytes),
            ("aggregates", &aggregate_checkpoint_bytes),
            ("row_lineage", &row_lineage_fingerprint),
        ],
    ));
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_checkpoint(
            "outputs",
            &[],
            &[
                ("app_csv", &app_csv_bytes),
                ("screen_csv", &screen_csv_bytes),
                ("day_coverage_csv", &day_coverage_csv_bytes),
                ("compliance_csv", &compliance_csv_bytes),
                ("credited_app_csv", &credited_app_csv_bytes),
                ("review_summary_json", &review_summary_json_bytes),
                ("visualization_data_json", &visualization_data_json_bytes),
                ("aggregates", &aggregate_checkpoint_bytes),
                ("row_lineage", &row_lineage_fingerprint),
            ],
        ),
    );

    step_checkpoints.finish()?;

    let expected_step_ids = crate::step_contract::PIPELINE_STEPS
        .iter()
        .map(|step| step.id)
        .collect::<BTreeSet<_>>();
    let actual_step_ids = pipeline_step_checkpoints
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if expected_step_ids != actual_step_ids {
        let missing = expected_step_ids
            .difference(&actual_step_ids)
            .copied()
            .collect::<Vec<_>>();
        let unexpected = actual_step_ids
            .difference(&expected_step_ids)
            .copied()
            .collect::<Vec<_>>();
        return Err(format!(
            "pipeline step checkpoint coverage mismatch: missing={missing:?}, unexpected={unexpected:?}"
        ));
    }

    debug_assert_eq!(logical_stage_digests.len(), 15);
    debug_assert_eq!(logical_stage_checkpoints.len(), 15);
    debug_assert_eq!(pipeline_step_digests.len(), 55);
    debug_assert_eq!(pipeline_step_checkpoints.len(), 55);

    Ok(PipelineV2Result {
        app_csv_bytes: Arc::new(app_csv_bytes),
        screen_csv_bytes: Arc::new(screen_csv_bytes),
        day_coverage_csv_bytes: Arc::new(day_coverage_csv_bytes),
        compliance_csv_bytes: Arc::new(compliance_csv_bytes),
        credited_app_csv_bytes: Arc::new(credited_app_csv_bytes),
        review_summary_json_bytes: Arc::new(review_summary_json_bytes),
        visualization_data_json_bytes: Arc::new(visualization_data_json_bytes),
        aggregate_csv_outputs: Arc::new(aggregate_csv_outputs),
        row_lineage: Arc::new(row_lineage),
        original_row_count: original_count,
        processed_row_count: processed_count,
        app_row_count,
        screen_row_count,
        day_coverage_row_count,
        compliance_row_count,
        credited_app_row_count,
        duplicate_timestamps_corrected: dupes_corrected,
        exact_duplicate_rows_removed,
        available_timezones,
        timezone: opts.timezone.clone(),
        timezone_action: timezone_action.into(),
        rows_before_timezone_handling,
        rows_after_timezone_handling,
        rows_removed_by_timezone,
        timezone_retained_source_rows_digest,
        timezone_stage_digest,
        logical_stage_digests,
        logical_stage_checkpoints,
        pipeline_step_digests,
        pipeline_step_checkpoints,
    })
}

// ---- unit tests ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_role_validation_uses_real_headers_and_value_parsers() {
        assert!(validate_support_csv(
            "filter_file",
            b"app_package_name,known_application_labels\ncom.example,Example\n",
        )
        .is_ok());
        assert!(
            validate_support_csv("filter_file", b"unrelated,value\ncom.example,Example\n",)
                .unwrap_err()
                .contains("requires one of columns")
        );
        assert!(validate_support_csv(
            "filter_file",
            b"App_Package_Name,known_application_labels\ncom.example,Example\n",
        )
        .unwrap_err()
        .contains("requires one of columns"));
        assert!(validate_support_csv(
            "filter_file",
            b"app_package_name,known_application_labels\ncom.example,\xff\n",
        )
        .unwrap_err()
        .contains("malformed CSV record"));
        assert!(validate_support_csv(
            "device_sharing_file",
            b"participant_id,sharing_status\nP01,Maybe\n",
        )
        .unwrap_err()
        .contains("unknown sharing_status"));
        assert!(validate_support_csv(
            "study_dates_file",
            b"participant_id,start_date,end_date\nP01,2026-03-08,2026-03-07\n",
        )
        .unwrap_err()
        .contains("before it starts"));
    }

    #[test]
    fn every_support_role_enforces_its_own_required_columns() {
        // One accepted and one rejected file per role, so no role's schema
        // check can be dropped without failing here. A correctly named CSV
        // with unrelated columns used to qualify and then behave like an empty
        // lookup, which is the defect this validation exists to stop.
        let cases: &[(&str, &[u8], &[u8], &str)] = &[
            (
                "filter_file",
                b"app_package_name\ncom.example.chat\n",
                b"unrelated\ncom.example.chat\n",
                "requires one of columns",
            ),
            (
                "apps_forcing_screen_open_file",
                b"package_name\ncom.example.video\n",
                b"unrelated\ncom.example.video\n",
                "requires one of columns",
            ),
            (
                "background_apps_file",
                b"app_package_name\ncom.example.sync\n",
                b"unrelated\ncom.example.sync\n",
                "requires one of columns",
            ),
            (
                "app_codebook_file",
                b"app_package_name,bcm_play_store_broad_app_category\ncom.example.chat,Social\n",
                b"package_name,bcm_play_store_broad_app_category\ncom.example.chat,Social\n",
                "missing required column(s) app_package_name",
            ),
            (
                "study_dates_file",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-08\n",
                b"participant_id,start_date\nP01,2026-03-07\n",
                "missing required column(s) end_date",
            ),
            (
                "device_sharing_file",
                b"participant_id,sharing_status\nP01,Non-Shared\n",
                b"participant_id\nP01\n",
                "missing required column(s) sharing_status",
            ),
            (
                "survey_attribution_file",
                b"participant_id,event_timestamp,users\nP01,2026-03-07 10:00:00,Target Child\n",
                b"participant_id,event_timestamp\nP01,2026-03-07 10:00:00\n",
                "missing required column(s) users",
            ),
            (
                "enrolled_devices_file",
                b"participant_id,device_count\nP01,1\n",
                b"participant_id\nP01\n",
                "missing required column(s) device_count",
            ),
        ];
        for (role, accepted, rejected, expected_error) in cases {
            validate_support_csv(role, accepted)
                .unwrap_or_else(|error| panic!("{role} must accept its own schema: {error}"));
            let error = validate_support_csv(role, rejected)
                .expect_err("a file that cannot satisfy the role must be rejected");
            assert!(
                error.starts_with(&format!("{role}: ")) && error.contains(expected_error),
                "{role} produced the wrong rejection: {error}",
            );
        }
        assert!(validate_support_csv("not_a_role", b"anything\n")
            .unwrap_err()
            .contains("unsupported support role"));
    }

    #[test]
    fn study_dates_validation_requires_at_least_one_usable_participant_window() {
        // The row counter and the parsed-window check are separate gates: an
        // all-blank data row counts as no rows, and a header-only file has no
        // windows. Either one alone must reject the file.
        assert_eq!(
            validate_support_csv(
                "study_dates_file",
                b"participant_id,start_date,end_date\n,,\n",
            )
            .unwrap_err(),
            "study_dates_file: no participant study windows found",
        );
        assert_eq!(
            validate_support_csv("study_dates_file", b"participant_id,start_date,end_date\n")
                .unwrap_err(),
            "study_dates_file: no participant study windows found",
        );
        validate_support_csv(
            "study_dates_file",
            b"participant_id,start_date,end_date\n,,\nP01,2026-03-07,2026-03-08\n",
        )
        .expect("one usable window is enough");
    }

    #[test]
    fn filter_file_parsing_scopes_relabeling_to_the_listed_labels() {
        let parsed = parse_filter_csv(
            concat!(
                "app_package_name,known_application_labels\n",
                "com.example.chat,\" Chat , Chat Beta ,\"\n",
                "com.example.any,\n",
                ",Orphan\n",
            )
            .as_bytes(),
        );
        assert_eq!(parsed.len(), 2, "a blank package must not create an entry");
        assert_eq!(
            parsed["com.example.chat"]
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["Chat".to_string(), "Chat Beta".to_string()]),
            "each listed label is trimmed and kept; empty segments are dropped",
        );
        assert!(
            parsed["com.example.any"].is_empty(),
            "an empty label list means the package matches every label",
        );
    }

    #[test]
    fn filter_relabeling_respects_the_label_scope_and_the_stop_event_vocabulary() {
        // Same package, two labels: only the listed one may be relabeled, and
        // only the four session-bearing interaction types are rewritten.
        let filter_map = parse_filter_csv(
            b"app_package_name,known_application_labels\ncom.example.chat,Chat\n",
        );
        let rows = |interaction: &str, label: &str| {
            let csv = format!(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,{},{},com.example.chat,2026-03-07 10:00:00,UTC\n",
                ),
                label, interaction,
            );
            let raw = incremental::csv_parse(csv.as_bytes());
            let model = incremental::detect_device_model(&raw);
            let rows = incremental::build_canonical_rows(&raw, "UTC", &BTreeMap::new(), &model)
                .expect("canonical rows");
            label_filtered_apps(rows, &filter_map)
        };

        for (interaction, relabeled) in [
            ("Activity Resumed", FILTERED_RESUMED),
            ("Activity Paused", FILTERED_PAUSED),
            ("Activity Stopped", FILTERED_STOPPED),
            ("Activity Destroyed", "Filtered App Destroyed"),
        ] {
            assert_eq!(
                rows(interaction, "Chat")[0].interaction_type.as_str(),
                relabeled,
                "{interaction} for a listed label must be relabeled",
            );
            assert_eq!(
                rows(interaction, "Other")[0].interaction_type.as_str(),
                interaction,
                "{interaction} for an unlisted label must be left alone",
            );
        }
        assert_eq!(
            rows("User Interaction", "Chat")[0].interaction_type.as_str(),
            "User Interaction",
            "a non-session interaction type is never relabeled",
        );
    }

    #[test]
    fn apps_forcing_and_background_files_accept_both_column_spellings_and_skip_comments() {
        let forcing = parse_apps_forcing_csv(
            concat!(
                "package_name,label_or_note\n",
                "com.example.video, Video \n",
                "#com.example.commented,Ignored\n",
                ",Orphan\n",
            )
            .as_bytes(),
        );
        assert_eq!(
            forcing,
            HashMap::from([("com.example.video".to_string(), "Video".to_string())]),
        );
        // The alternate spelling of both columns is accepted.
        assert_eq!(
            parse_apps_forcing_csv(
                b"app_package_name,application_label\ncom.example.video,Video\n"
            ),
            forcing,
        );

        let background = parse_background_apps_csv(
            concat!(
                "app_package_name\n",
                " com.example.sync \n",
                "#com.example.commented\n",
                "\n",
            )
            .as_bytes(),
        );
        assert_eq!(
            background,
            AHashSet::from_iter(["com.example.sync".to_string()]),
        );
        assert_eq!(
            parse_background_apps_csv(b"package_name\ncom.example.sync\n"),
            background,
        );
    }

    #[test]
    fn codebook_parsing_keeps_the_first_row_per_package_and_drops_blank_cells() {
        let parsed = parse_codebook_csv(
            concat!(
                "app_package_name,bcm_play_store_broad_app_category\n",
                "com.example.chat,Social\n",
                "com.example.chat,Games\n",
                ",Orphan\n",
                "com.example.blank, \n",
            )
            .as_bytes(),
        );
        assert_eq!(parsed.len(), 2, "blank packages never become codebook keys");
        let category = CODEBOOK_RENAME_PAIRS
            .iter()
            .position(|(source, _)| *source == "bcm_play_store_broad_app_category")
            .expect("the broad category column is a declared codebook field");
        assert_eq!(
            parsed["com.example.chat"].fields[category].as_deref(),
            Some("Social"),
            "the first codebook row for a package wins",
        );
        assert_eq!(
            parsed["com.example.blank"].fields[category], None,
            "a whitespace-only cell is absent, not an empty string",
        );
    }

    #[test]
    fn support_record_parsing_survives_long_cells_and_ragged_rows() {
        // A support cell longer than the reader's initial 1 KiB field buffer
        // must round trip: the reader grows the buffer instead of truncating a
        // researcher's label.
        let long_label = "L".repeat(5_000);
        let csv =
            format!("app_package_name,known_application_labels\ncom.example.chat,{long_label}\n");
        let parsed = parse_filter_csv(csv.as_bytes());
        assert_eq!(
            parsed["com.example.chat"]
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            vec![long_label],
        );

        // Real exports contain records with more cells than the header
        // declares. The extra cells are dropped and the declared columns still
        // parse; indexing past the header would panic instead.
        let ragged = parse_csv_to_records_with_physical_rows(
            b"app_package_name,known_application_labels\ncom.example.chat,Chat,extra,cells\n",
        );
        assert_eq!(ragged.len(), 1);
        assert_eq!(ragged[0].0, 1);
        assert_eq!(ragged[0].1["app_package_name"], "com.example.chat");
        assert_eq!(ragged[0].1["known_application_labels"], "Chat");

        // Physical data-row numbers count every record, including the all-empty
        // ones this parser drops, so support-file errors name the row a
        // researcher sees in their spreadsheet. A bare blank line carries no
        // field and is not a record; a record whose cells are all empty is.
        let numbered = parse_csv_to_records_with_physical_rows(
            b"app_package_name,label\ncom.example.first,First\n,\ncom.example.third,Third\n",
        );
        assert_eq!(
            numbered
                .iter()
                .map(|(row, record)| (*row, record["app_package_name"].clone()))
                .collect::<Vec<_>>(),
            vec![
                (1, "com.example.first".to_string()),
                (3, "com.example.third".to_string()),
            ],
        );
    }

    #[test]
    fn discovery_and_incremental_report_the_same_physical_data_row() {
        // Header + valid data row 1 + an all-empty filler record (physical
        // data row 2 — skipped by parse_csv_to_records_with_physical_rows'
        // any_nonempty guard and dropped by drop_empty_timestamp) + an invalid
        // event_timestamp at physical data row 3. Both reporting paths must
        // name physical data row 3; the old discovery numbering (enumerate()
        // over the skipping parser) said data row 2.
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            ",,,,,,,\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,not-a-timestamp,UTC\n",
        );

        let discovery_error = discover_timezones_v2_native(csv.as_bytes())
            .expect_err("invalid event_timestamp must fail discovery");
        assert_eq!(discovery_error, "Invalid event_timestamp at data row 3");

        let raw = incremental::csv_parse(csv.as_bytes());
        let raw = incremental::drop_empty_timestamp(raw);
        let model = incremental::detect_device_model(&raw);
        let processing_error =
            incremental::build_canonical_rows(&raw, "UTC", &BTreeMap::new(), &model)
                .err()
                .expect("invalid event_timestamp must fail processing");
        assert_eq!(processing_error, discovery_error);

        // PHI safety: the raw cell value must not appear in either error.
        assert!(!discovery_error.contains("not-a-timestamp"));
        assert!(!processing_error.contains("not-a-timestamp"));
    }

    #[test]
    fn screen_witness_state_error_omits_raw_interaction_type() {
        let error = screen_witness_state("Unknown importance: com.example.secret")
            .expect_err("unmapped interaction type must fail");
        assert!(
            !error.contains("com.example.secret"),
            "raw cell value leaked into the error: {error}"
        );
        assert!(error.contains("unmapped interaction type"), "{error}");
    }

    #[test]
    fn cached_row_layout_is_bounded() {
        let bytes = std::mem::size_of::<Row>();
        assert!(bytes <= 16, "cached Row layout regressed to {bytes} bytes");
    }

    #[test]
    fn persisted_string_dictionary_round_trips_and_rejects_bad_references() {
        let values = vec![
            SharedString::from("participant-01"),
            SharedString::from("Activity Resumed"),
            SharedString::from("participant-01"),
        ];
        let encoded = with_serialized_row_string_table(|| postcard::to_allocvec(&values))
            .expect("encode dictionary strings");
        let decoded: Vec<SharedString> = with_deserialized_row_string_pool(|| {
            postcard::from_bytes(&encoded).expect("decode dictionary strings")
        });
        assert_eq!(decoded, values);
        assert!(Arc::ptr_eq(&decoded[0].0, &decoded[2].0));

        for invalid in [
            PersistedString { id: 0, value: None },
            PersistedString {
                id: 1,
                value: Some("out-of-order".into()),
            },
        ] {
            let encoded = postcard::to_allocvec(&invalid).expect("encode invalid token");
            assert!(with_deserialized_row_string_pool(|| {
                postcard::from_bytes::<SharedString>(&encoded)
            })
            .is_err());
        }

        assert!(postcard::to_allocvec(&SharedString::from("unscoped")).is_err());
    }

    #[test]
    fn cached_row_checkpoint_invalidates_only_the_edited_component() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
        );
        let raw = incremental::csv_parse(csv.as_bytes());
        let model = incremental::detect_device_model(&raw);
        let mut row =
            incremental::build_canonical_rows(&raw, "America/Chicago", &BTreeMap::new(), &model)
                .expect("canonical row")
                .remove(0);
        let mut scratch = RowCheckpointScratch::default();
        let baseline = row_checkpoint_parts(&row, &mut scratch);
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_some());
        assert!(row.0.checkpoint_parts.classification.get().is_some());

        let hour = row.hour.saturating_add(1);
        row.edit_temporal().hour = hour;
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_none());
        assert!(row.0.checkpoint_parts.classification.get().is_some());
        let changed = row_checkpoint_parts(&row, &mut scratch);
        assert_eq!(baseline.identity, changed.identity);
        assert_ne!(baseline.temporal, changed.temporal);
        assert_eq!(baseline.classification, changed.classification);

        let fresh = Row::new(row.0.data.clone());
        let fresh_parts = row_checkpoint_parts(&fresh, &mut scratch);
        assert_eq!(
            changed, fresh_parts,
            "component cache must match a cold hash"
        );

        row.edit_classification().application_label = "Changed".into();
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_some());
        assert!(row.0.checkpoint_parts.classification.get().is_none());
        let changed_again = row_checkpoint_parts(&row, &mut scratch);
        assert_eq!(changed.identity, changed_again.identity);
        assert_eq!(changed.temporal, changed_again.temporal);
        assert_ne!(changed.classification, changed_again.classification);

        row.index += 1;
        assert!(row.0.checkpoint_parts.identity.get().is_none());
        assert!(row.0.checkpoint_parts.temporal.get().is_none());
        assert!(row.0.checkpoint_parts.classification.get().is_none());
    }

    #[test]
    fn canonical_checkpoint_fast_path_matches_unsorted_fallback() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,A,Activity Resumed,a,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,B,Activity Resumed,b,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,C,Activity Resumed,c,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Child,D,Activity Resumed,d,2026-03-07 10:03:00,UTC\n",
        );
        let raw = incremental::csv_parse(csv.as_bytes());
        let model = incremental::detect_device_model(&raw);
        let rows = incremental::build_canonical_rows(&raw, "UTC", &BTreeMap::new(), &model)
            .expect("canonical rows");

        let source = logical_stage_checkpoint("source-step", &[("rows", &rows)], &[]);
        let parts = row_checkpoint_parts_for_rows(&rows);
        let payload = br#"{"enabled":true}"#;
        let reused = logical_stage_checkpoint_with_reusable_parts(
            "target-step",
            &rows,
            &[("value", payload.as_slice())],
            &parts,
            &parts,
            &source,
        );
        let recomputed = logical_stage_checkpoint(
            "target-step",
            &[("rows", &rows)],
            &[("value", payload.as_slice())],
        );
        assert_eq!(reused, recomputed);

        let compare_order_independent_components = |left: &[Row], right: &[Row]| {
            let left = logical_stage_checkpoint("fast-path-proof", &[("rows", left)], &[]);
            let right = logical_stage_checkpoint("fast-path-proof", &[("rows", right)], &[]);
            assert_eq!(left.row_membership_digest, right.row_membership_digest);
            assert_eq!(left.temporal_state_digest, right.temporal_state_digest);
            assert_eq!(left.classification_digest, right.classification_digest);
            assert_eq!(left.payload_digest, right.payload_digest);
            assert_eq!(left.schema_digest, right.schema_digest);
        };

        compare_order_independent_components(&[], &[]);
        compare_order_independent_components(&rows[..1], &rows[..1]);

        let mut reversed = rows.clone();
        reversed.reverse();
        compare_order_independent_components(&rows, &reversed);

        let mut duplicate_identity = vec![rows[0].clone(), rows[0].clone()];
        duplicate_identity[0].index = 11;
        duplicate_identity[1].index = 12;
        let mut duplicate_reversed = duplicate_identity.clone();
        duplicate_reversed.reverse();
        compare_order_independent_components(&duplicate_identity, &duplicate_reversed);

        let mut state = 0x4d59_5df4_d0f3_3173_u64;
        for _ in 0..64 {
            let mut shuffled = rows.clone();
            for index in (1..shuffled.len()).rev() {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                shuffled.swap(index, (state as usize) % (index + 1));
            }
            compare_order_independent_components(&rows, &shuffled);
        }
    }

    #[test]
    fn known_membership_and_order_checkpoint_and_filter_fallback_match_full_reference() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,A,Activity Resumed,a,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,B,Activity Resumed,b,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,C,Activity Resumed,c,2026-03-07 10:02:00,UTC\n",
        );
        let raw = incremental::csv_parse(csv.as_bytes());
        let model = incremental::detect_device_model(&raw);
        let previous_rows = incremental::build_canonical_rows(&raw, "UTC", &BTreeMap::new(), &model)
            .expect("canonical rows");
        let previous_checkpoint =
            logical_stage_checkpoint("source-step", &[("rows", &previous_rows)], &[]);

        let mut rows = previous_rows.clone();
        rows[0].edit_temporal().duration_seconds = Some(60.0);
        rows[1].edit_classification().application_label = "Changed".into();
        let payload = br#"{"enabled":false,"upstreamDigest":"fixed"}"#;
        let optimized = logical_stage_checkpoint_with_known_membership_and_order(
            "drop_zero_duration",
            &rows,
            &[("value", payload.as_slice())],
            &previous_rows,
            &previous_checkpoint,
        );
        let reference = logical_stage_checkpoint(
            "drop_zero_duration",
            &[("rows", &rows)],
            &[("value", payload.as_slice())],
        );

        assert_eq!(optimized, reference);
        assert_eq!(
            optimized.row_membership_digest,
            previous_checkpoint.row_membership_digest
        );
        assert_eq!(
            optimized.row_order_digest,
            previous_checkpoint.row_order_digest
        );
        assert_ne!(
            optimized.temporal_state_digest,
            previous_checkpoint.temporal_state_digest
        );
        assert_ne!(
            optimized.classification_digest,
            previous_checkpoint.classification_digest
        );

        let filtered_rows = rows[1..].to_vec();
        let filtered_parts = row_checkpoint_parts_for_rows(&filtered_rows);
        let fallback = logical_stage_checkpoint_with_reusable_rows(
            "drop_zero_duration",
            &filtered_rows,
            &[("value", payload.as_slice())],
            &filtered_parts,
            &previous_rows,
            &previous_checkpoint,
        );
        let filtered_reference = logical_stage_checkpoint(
            "drop_zero_duration",
            &[("rows", &filtered_rows)],
            &[("value", payload.as_slice())],
        );
        assert_eq!(fallback, filtered_reference);
        assert_ne!(
            fallback.row_membership_digest,
            previous_checkpoint.row_membership_digest
        );
        assert_ne!(
            fallback.row_order_digest,
            previous_checkpoint.row_order_digest
        );
    }

    fn test_options() -> PipelineV2Options {
        PipelineV2Options {
            study_name: "Shadow Study".into(),
            timezone: "America/Chicago".into(),
            timezone_handling: "selected-convert".into(),
            usage_session_mode: UsageSessionMode::AppUsage,
            include_app_output: true,
            include_screen_output: false,
            use_filter_file: false,
            use_apps_forcing_screen_open: false,
            use_background_apps_file: false,
            use_app_codebook: false,
            include_category_column: false,
            deduplicate_exact_rows: true,
            interaction_type_remap: Vec::new(),
            correct_duplicate_event_timestamps: true,
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 43_200_000_000_000,
            proximity_interval_ns: 0,
            custom_app_engagement_duration: 300.0,
            long_data_time_gap_thresholds: (1..=12).map(f64::from).collect(),
            long_usage_duration_thresholds: (1..=12).map(f64::from).collect(),
            same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
            other_stop_types: vec!["Activity Resumed".into(), "Device Shutdown".into()],
            interaction_types_to_remove: Vec::new(),
            screen_auto_lock_timeout_seconds: 120.0,
            screen_auto_lock_tolerance_seconds: 30.0,
            screen_manual_lock_max_tail_seconds: 30.0,
            screen_keyguard_near_stop_seconds: 2.0,
            datetime_of_preprocessing: "2026-07-21 12:00:00 UTC".into(),
            model_concurrent_usage: false,
            minimum_usage_duration: 60.0,
            apply_minimum_usage_duration_to_concurrent_subintervals: false,
            filter_zero_duration_sessions: false,
            add_no_activity_placeholder_days: false,
            enable_study_window_filter: false,
            enable_person_attribution: false,
            enable_day_coverage: false,
            enable_compliance_scoring: false,
            compliance_threshold_percent: 70.0,
            enable_screen_gated_crediting: false,
            enable_aggregates: false,
            aggregate_shape: "wide".into(),
            materialize_visualization_data: true,
            credited_session_cap_minutes: 360.0,
            device_liveness_gap_tolerance_minutes: 120.0,
            auto_lock_bridge_seconds: 120.0,
            no_witness_min_day_apps: 2,
        }
    }

    #[test]
    fn source_row_ranges_are_a_canonical_lossless_set_encoding() {
        let mut state = 0x8f3c_6a2d_1b79_e405_u64;
        let mut observed = BTreeSet::new();
        let mut encoded = SourceDataRows::default();
        for _ in 0..10_000 {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let row = ((state >> 32) % 2_000 + 1) as u32;
            observed.insert(row);
            encoded.merge(&SourceDataRows::single(row));
        }

        assert_eq!(
            encoded.to_vec(),
            observed.iter().copied().collect::<Vec<_>>()
        );
        assert_eq!(encoded.len(), observed.len());
        for range in encoded.ranges() {
            assert!(range.first <= range.last);
        }
        for adjacent in encoded.ranges().windows(2) {
            assert!(adjacent[0].last.saturating_add(1) < adjacent[1].first);
        }
    }

    #[test]
    fn cached_liveness_spans_match_per_session_reference() {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            state >> 32
        };

        for _ in 0..2_000 {
            let event_count = (next() % 48) as usize;
            let mut timestamps = Vec::with_capacity(event_count);
            let mut timestamp = (next() % 20) as i64 - 10;
            for _ in 0..event_count {
                timestamp += (next() % 8) as i64;
                timestamps.push(timestamp);
            }
            let mut boots = timestamps
                .iter()
                .copied()
                .filter(|_| next() % 11 == 0)
                .collect::<Vec<_>>();
            boots.sort_unstable();
            let tolerance = (next() % 12) as i64;
            let spans = build_alive_spans(&timestamps, tolerance, &boots);

            for _ in 0..12 {
                let left = (next() % 180) as i64 - 40;
                let right = left + (next() % 80) as i64;
                assert_eq!(
                    clip_alive_spans(&spans, left, right),
                    reference_alive_intervals(&timestamps, left, right, tolerance, &boots),
                    "cached liveness mismatch timestamps={timestamps:?} boots={boots:?} tolerance={tolerance} query=({left},{right})",
                );
            }
        }
    }

    #[test]
    fn timezone_discovery_is_sorted_defaults_blank_and_rejects_invalid_values() {
        let csv = concat!(
            "event_timestamp,timezone\n",
            "2026-03-07 10:00:00,America/New_York\n",
            "2026-03-07 11:00:00,\n",
            "2026-03-07 12:00:00,America/Chicago\n"
        );
        assert_eq!(
            discover_timezones_v2_native(csv.as_bytes()).unwrap(),
            vec!["America/Chicago", "America/New_York", "UTC"]
        );
        let invalid = "event_timestamp,timezone\n2026-03-07 10:00:00,Not/AZone\n";
        assert!(discover_timezones_v2_native(invalid.as_bytes())
            .unwrap_err()
            .contains("invalid timezone"));
    }

    #[test]
    fn final_unterminated_csv_record_is_processed_and_count_semantics_match_contract() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago"
        );
        let without_newline = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("unterminated final record must parse");
        let with_newline = run_pipeline_v2(
            format!("{csv}\n").as_bytes(),
            &test_options(),
            &[],
            &[],
            &[],
        )
        .expect("newline-terminated record must parse");

        assert_eq!(without_newline.original_row_count, 2);
        assert_eq!(without_newline.processed_row_count, 2);
        assert_eq!(without_newline.app_row_count, 1);
        assert_eq!(without_newline.app_csv_bytes, with_newline.app_csv_bytes);
        assert_eq!(without_newline.row_lineage.len(), 1);
        assert_eq!(
            without_newline.row_lineage[0].source_data_row_ranges,
            vec![SourceDataRowRange { first: 1, last: 2 }]
        );
        assert_eq!(without_newline.row_lineage[0].source_data_row_count, 2);
    }

    #[test]
    fn aggregate_exports_cover_wide_long_category_and_overlapping_apps() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Game,Activity Resumed,com.example.game,2026-03-07 10:00:30,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Target Child,Game,Activity Paused,com.example.game,2026-03-07 10:03:00,UTC\n",
        );
        let codebook = concat!(
            "app_package_name,bcm_play_store_broad_app_category\n",
            "com.example.chat,Social\n",
            "com.example.game,Games\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.minimum_usage_duration = 0.0;
        options.model_concurrent_usage = true;
        options.use_app_codebook = true;
        options.enable_aggregates = true;

        let wide = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], codebook.as_bytes())
            .expect("wide aggregate fixture");
        let wide_by_kind = wide
            .aggregate_csv_outputs
            .iter()
            .map(|output| (output.kind.as_str(), output))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(wide_by_kind.len(), 5);
        assert_eq!(wide_by_kind["aggregate-daily-summary-csv"].row_count, 1);
        assert_eq!(wide_by_kind["aggregate-weekly-summary-csv"].row_count, 1);
        assert_eq!(wide_by_kind["aggregate-top-apps-csv"].row_count, 2);
        assert_eq!(
            wide_by_kind["aggregate-category-time-budget-csv"].row_count,
            2
        );
        assert_eq!(wide_by_kind["aggregate-app-co-usage-csv"].row_count, 1);
        let daily = String::from_utf8(wide_by_kind["aggregate-daily-summary-csv"].bytes.clone())
            .expect("daily aggregate is UTF-8 CSV");
        assert!(daily.contains("total_app_usage_minutes"));
        assert!(daily.contains("2026-03-07"));
        let categories = String::from_utf8(
            wide_by_kind["aggregate-category-time-budget-csv"]
                .bytes
                .clone(),
        )
        .expect("category aggregate is UTF-8 CSV");
        assert!(categories.contains("Social"));
        assert!(categories.contains("Games"));
        let co_usage = String::from_utf8(wide_by_kind["aggregate-app-co-usage-csv"].bytes.clone())
            .expect("co-usage aggregate is UTF-8 CSV");
        assert!(co_usage.contains("com.example.chat,com.example.game,1,1.5"));

        options.aggregate_shape = "long".into();
        let long = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], codebook.as_bytes())
            .expect("long aggregate fixture");
        let long_daily = long
            .aggregate_csv_outputs
            .iter()
            .find(|output| output.kind == "aggregate-daily-summary-csv")
            .expect("long daily aggregate");
        assert_eq!(long_daily.row_count, 10);
        let long_daily_csv =
            String::from_utf8(long_daily.bytes.clone()).expect("long aggregate is UTF-8 CSV");
        assert!(long_daily_csv
            .starts_with("study_id,study_name,participant_id,date,timezone,metric,value\n"));
        assert!(long_daily_csv.contains("active_window_minutes,3"));
    }

    #[test]
    fn duplicate_timestamp_nudging_reads_both_stop_type_lists() {
        let run = |middle_interaction: &str, options: &PipelineV2Options| {
            let csv = format!(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,{},com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,User Interaction,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
                ),
                middle_interaction
            );
            run_pipeline_v2(csv.as_bytes(), options, &[], &[], &[])
                .expect("duplicate-timestamp dependency fixture")
                .pipeline_step_digests["nudge_duplicate_timestamps"]
                .clone()
        };

        let with_same_stop = test_options();
        let mut without_same_stop = with_same_stop.clone();
        without_same_stop.same_app_stop_types.clear();
        assert_ne!(
            run("Activity Paused", &with_same_stop),
            run("Activity Paused", &without_same_stop),
            "same_app_stop_types changes the early duplicate-timestamp order"
        );

        let with_other_stop = test_options();
        let mut without_other_stop = with_other_stop.clone();
        without_other_stop.other_stop_types.clear();
        assert_ne!(
            run("Device Shutdown", &with_other_stop),
            run("Device Shutdown", &without_other_stop),
            "other_stop_types changes the early duplicate-timestamp order"
        );
    }

    #[test]
    fn missing_stop_lineage_stays_linear_and_separates_search_from_direct_sources() {
        const EVENT_COUNT: usize = 256;
        let mut csv = String::from(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        );
        for index in 0..EVENT_COUNT {
            csv.push_str(&format!(
                "Study,P01,Target Child,App {index},Activity Resumed,com.example.app{index},2026-03-07 10:00:00,America/Chicago\n"
            ));
        }
        let mut options = test_options();
        options.same_app_stop_types = vec!["Activity Paused".into()];
        options.other_stop_types.clear();
        options.use_activity_stopped_as_fallback = false;

        let first = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[])
            .expect("missing-stop stress fixture must run");
        let second = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[])
            .expect("missing-stop stress fixture must replay");
        let app_lineage = first
            .row_lineage
            .iter()
            .filter(|lineage| lineage.output_kind.as_str() == "app-csv")
            .collect::<Vec<_>>();

        assert_eq!(app_lineage.len(), EVENT_COUNT);
        assert_eq!(first.row_lineage, second.row_lineage);
        assert_eq!(
            app_lineage
                .iter()
                .map(|lineage| lineage.source_data_row_count as usize)
                .sum::<usize>(),
            EVENT_COUNT * 2 - 1,
            "searched candidates must not be misreported as direct value sources"
        );
        assert!(app_lineage
            .iter()
            .all(|lineage| lineage.source_data_row_ranges.len() <= 2));
        assert!(app_lineage
            .iter()
            .all(|lineage| lineage.searches.len() == 1));
        for (index, lineage) in app_lineage.iter().enumerate() {
            let search = &lineage.searches[0];
            assert_eq!(search.start_event_index, (index + 1) as u32);
            assert_eq!(search.end_event_index_exclusive, EVENT_COUNT as u32);
            assert_eq!(
                search.candidate_event_count,
                (EVENT_COUNT - index - 1) as u32
            );
            assert!(search
                .candidate_chain_digest
                .to_string()
                .starts_with("blake3:"));
        }
    }

    #[test]
    fn logical_stage_checkpoints_cover_the_contract_and_are_deterministic() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let first = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("first checkpoint run");
        let second = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("second checkpoint run");
        let expected = BTreeSet::from([
            "app_policy",
            "attribute_person",
            "categorize_apps",
            "day_coverage",
            "dedup_and_order",
            "device_state_timeline",
            "effective_usage",
            "episode_annotations",
            "interval_cleaning",
            "normalize_timezones",
            "observation_window",
            "outputs",
            "parse_events",
            "reconstruct_episodes",
            "score_compliance",
        ]);
        assert_eq!(
            first
                .logical_stage_digests
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected
        );
        assert_eq!(first.logical_stage_digests, second.logical_stage_digests);
        assert_eq!(
            first.logical_stage_checkpoints,
            second.logical_stage_checkpoints
        );
        let expected_steps = crate::step_contract::PIPELINE_STEPS
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(first.pipeline_step_digests.len(), 55);
        assert_eq!(first.pipeline_step_checkpoints.len(), 55);
        assert_eq!(first.pipeline_step_digests, second.pipeline_step_digests);
        assert_eq!(
            first.pipeline_step_checkpoints,
            second.pipeline_step_checkpoints
        );
        assert_eq!(
            first
                .pipeline_step_checkpoints
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected_steps
        );
        for (step_id, checkpoint) in &first.pipeline_step_checkpoints {
            assert_eq!(&checkpoint.node_id, step_id);
            assert_eq!(
                first.pipeline_step_digests.get(step_id),
                Some(&checkpoint.terminal_digest)
            );
        }
        assert_eq!(
            first
                .logical_stage_checkpoints
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected
        );
        for (node_id, checkpoint) in &first.logical_stage_checkpoints {
            assert_eq!(
                checkpoint.protocol_version,
                "chronicle-logical-stage-checkpoint/v7"
            );
            assert_eq!(&checkpoint.node_id, node_id);
            assert_eq!(
                first.logical_stage_digests.get(node_id),
                Some(&checkpoint.terminal_digest)
            );
            for digest in [
                &checkpoint.row_membership_digest,
                &checkpoint.row_order_digest,
                &checkpoint.temporal_state_digest,
                &checkpoint.classification_digest,
                &checkpoint.payload_digest,
                &checkpoint.schema_digest,
            ] {
                assert!(
                    digest.len() == 37
                        && digest.starts_with("xxh3:")
                        && digest[5..].bytes().all(|byte| byte.is_ascii_hexdigit())
                );
            }
            assert!(
                checkpoint.terminal_digest.len() == 71
                    && checkpoint.terminal_digest.starts_with("sha256:")
                    && checkpoint.terminal_digest[7..]
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit())
            );
        }
        assert!(first.logical_stage_digests.values().all(|digest| {
            digest.len() == 71
                && digest.starts_with("sha256:")
                && digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        }));
    }

    #[test]
    fn terminal_checkpoint_commitment_is_sensitive_to_every_typed_component() {
        let base = [
            "membership",
            "order",
            "temporal",
            "classification",
            "payload",
            "schema",
        ];
        let baseline = terminal_checkpoint_digest("node", base);
        for index in 0..base.len() {
            let mut changed = base;
            changed[index] = "mutated";
            assert_ne!(
                baseline,
                terminal_checkpoint_digest("node", changed),
                "component {index} was omitted from the terminal commitment"
            );
        }
    }

    #[test]
    fn batched_fixed_checkpoint_encodings_match_the_streaming_reference() {
        let first = [0x11_u8; 16];
        let second = [0x22_u8; 16];
        let third = [0x33_u8; 16];

        let mut reference = Xxh3::new();
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = Xxh3::new();
        checkpoint_digest_fixed16(&mut batched, &first);
        assert_eq!(reference.digest128(), batched.digest128());

        let mut reference = Xxh3::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = Xxh3::new();
        checkpoint_digest_positioned_fixed16(&mut batched, 7, &first);
        assert_eq!(reference.digest128(), batched.digest128());

        let mut reference = Xxh3::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        checkpoint_digest_field(&mut reference, &second);
        checkpoint_digest_field(&mut reference, &third);
        let mut batched = Xxh3::new();
        checkpoint_digest_positioned_fixed16_triple(&mut batched, 7, &first, &second, &third);
        assert_eq!(reference.digest128(), batched.digest128());
    }

    #[test]
    fn buffered_checkpoint_hasher_matches_streaming_across_flush_boundaries() {
        let mut reference = Xxh3::new();
        let mut buffered = BufferedCheckpointHasher::new();
        for index in 0..1_000_usize {
            let first = xxh3_128(&(index as u64).to_le_bytes()).to_le_bytes();
            let second = xxh3_128(&((index as u64) + 1).to_le_bytes()).to_le_bytes();
            checkpoint_digest_fixed16(&mut reference, &first);
            checkpoint_digest_fixed16(&mut reference, &second);
            checkpoint_digest_fixed16(&mut buffered, &first);
            checkpoint_digest_fixed16(&mut buffered, &second);
        }
        assert_eq!(reference.digest128(), buffered.finalize128());
    }

    #[test]
    fn output_only_configuration_stops_at_the_output_checkpoint() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let baseline = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline checkpoint run");
        let mut changed_options = test_options();
        changed_options.study_name = "Different Study Label".into();
        let changed = run_pipeline_v2(csv.as_bytes(), &changed_options, &[], &[], &[])
            .expect("changed checkpoint run");
        let changed_stages = baseline
            .logical_stage_digests
            .iter()
            .filter_map(|(node, digest)| {
                (changed.logical_stage_digests.get(node) != Some(digest)).then_some(node.as_str())
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(changed_stages, BTreeSet::from(["outputs"]));
        let baseline_output = &baseline.logical_stage_checkpoints["outputs"];
        let changed_output = &changed.logical_stage_checkpoints["outputs"];
        assert_eq!(
            baseline_output.row_membership_digest,
            changed_output.row_membership_digest
        );
        assert_eq!(
            baseline_output.row_order_digest,
            changed_output.row_order_digest
        );
        assert_eq!(
            baseline_output.temporal_state_digest,
            changed_output.temporal_state_digest
        );
        assert_eq!(
            baseline_output.classification_digest,
            changed_output.classification_digest
        );
        assert_eq!(baseline_output.schema_digest, changed_output.schema_digest);
        assert_ne!(
            baseline_output.payload_digest,
            changed_output.payload_digest
        );
    }

    #[test]
    fn disabled_browser_views_do_not_materialize_visualization_data() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let enabled = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("visualization-enabled run");
        assert!(!enabled.visualization_data_json_bytes.is_empty());
        let visualization: serde_json::Value =
            serde_json::from_slice(&enabled.visualization_data_json_bytes)
                .expect("visualization row-array JSON");
        assert_eq!(
            visualization["protocolVersion"],
            VISUALIZATION_DATA_PROTOCOL
        );
        assert_eq!(
            visualization["columns"],
            serde_json::json!(VISUALIZATION_DATA_COLUMNS)
        );
        for family in ["appRows", "screenRows"] {
            assert!(visualization[family]
                .as_array()
                .expect("visualization row family")
                .iter()
                .all(|row| row.as_array().is_some_and(|cells| cells.len() == 11)));
        }

        let mut disabled_options = test_options();
        disabled_options.materialize_visualization_data = false;
        let disabled = run_pipeline_v2(csv.as_bytes(), &disabled_options, &[], &[], &[])
            .expect("visualization-disabled run");
        assert!(disabled.visualization_data_json_bytes.is_empty());
        assert_eq!(enabled.app_csv_bytes, disabled.app_csv_bytes);
        assert_eq!(enabled.screen_csv_bytes, disabled.screen_csv_bytes);
        assert_eq!(
            enabled.review_summary_json_bytes,
            disabled.review_summary_json_bytes
        );
        assert_eq!(enabled.row_lineage, disabled.row_lineage);

        let changed_steps = enabled
            .pipeline_step_digests
            .iter()
            .filter_map(|(step, digest)| {
                (disabled.pipeline_step_digests.get(step) != Some(digest)).then_some(step.as_str())
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(changed_steps, BTreeSet::from(["assemble_result"]));
    }

    #[test]
    fn timestamp_intervention_changes_temporal_shape_without_false_membership_or_classification() {
        let baseline_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let changed_csv = baseline_csv.replacen("10:00:00", "10:00:01", 1);
        let baseline = run_pipeline_v2(baseline_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline typed checkpoint");
        let changed = run_pipeline_v2(changed_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("changed typed checkpoint");
        let baseline_parse = &baseline.logical_stage_checkpoints["parse_events"];
        let changed_parse = &changed.logical_stage_checkpoints["parse_events"];
        assert_eq!(
            baseline_parse.row_membership_digest,
            changed_parse.row_membership_digest
        );
        assert_eq!(
            baseline_parse.row_order_digest,
            changed_parse.row_order_digest
        );
        assert_eq!(
            baseline_parse.classification_digest,
            changed_parse.classification_digest
        );
        assert_eq!(baseline_parse.payload_digest, changed_parse.payload_digest);
        assert_eq!(baseline_parse.schema_digest, changed_parse.schema_digest);
        assert_ne!(
            baseline_parse.temporal_state_digest,
            changed_parse.temporal_state_digest
        );
        assert_ne!(
            baseline_parse.terminal_digest,
            changed_parse.terminal_digest
        );
    }

    #[test]
    fn timestamp_reordering_is_separated_from_membership_and_classification() {
        let baseline_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Mail,Activity Resumed,com.example.mail,2026-03-07 10:01:00,America/Chicago\n"
        );
        let changed_csv = baseline_csv.replacen("10:00:00", "10:02:00", 1);
        let baseline = run_pipeline_v2(baseline_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline ordered checkpoint");
        let changed = run_pipeline_v2(changed_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("reordered checkpoint");
        let baseline_parse = &baseline.logical_stage_checkpoints["parse_events"];
        let changed_parse = &changed.logical_stage_checkpoints["parse_events"];
        assert_eq!(
            baseline_parse.row_membership_digest,
            changed_parse.row_membership_digest
        );
        assert_eq!(
            baseline_parse.classification_digest,
            changed_parse.classification_digest
        );
        assert_eq!(baseline_parse.payload_digest, changed_parse.payload_digest);
        assert_eq!(baseline_parse.schema_digest, changed_parse.schema_digest);
        assert_ne!(
            baseline_parse.row_order_digest,
            changed_parse.row_order_digest
        );
        assert_ne!(
            baseline_parse.temporal_state_digest,
            changed_parse.temporal_state_digest
        );
        assert_ne!(
            baseline_parse.terminal_digest,
            changed_parse.terminal_digest
        );
    }

    #[test]
    fn exact_dedupe_is_participant_scoped_and_can_be_disabled() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
        );
        let deduped = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("deduplicated run");
        assert_eq!(deduped.processed_row_count, 2);

        let mut options = test_options();
        options.deduplicate_exact_rows = false;
        let retained =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("non-deduplicated run");
        assert_eq!(retained.processed_row_count, 3);
    }

    #[test]
    fn custom_interaction_remap_precedes_builtin_mapping() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.interaction_type_remap = vec!["Unknown importance: 1 => Vendor Resume".into()];
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("remapped run");
        let output = String::from_utf8(result.app_csv_bytes.as_ref().clone()).expect("UTF-8 CSV");
        assert!(output.contains("Vendor Resume"));
        assert!(!output.contains("App Usage"));
    }

    #[test]
    fn selected_timezone_filter_keeps_every_matching_row() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.timezone_handling = "selected-filter".into();
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("selected-filter run");
        assert_eq!(result.original_row_count, 4);
        assert_eq!(result.processed_row_count, 2);
        assert_eq!(result.app_row_count, 1);
    }

    #[test]
    fn literal_none_timezone_rows_fall_back_to_utc_through_the_full_pipeline() {
        // "None" is a real observed export value for a missing timezone, not a
        // hypothetical. It must behave exactly like a blank cell all the way
        // through row construction — not just in the advisory inspectors —
        // otherwise selected-filter silently drops rows the inspection screen
        // promised to keep as UTC.
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,None\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,\n"
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.timezone_handling = "selected-filter".into();
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("UTC-fallback run");
        assert_eq!(result.original_row_count, 2);
        assert_eq!(result.processed_row_count, 2);
        assert_eq!(result.app_row_count, 1);
        let output = String::from_utf8(result.app_csv_bytes.as_ref().clone()).expect("UTF-8 CSV");
        assert!(!output.contains("None"));
    }

    #[test]
    fn selected_timezone_filter_rejects_an_absent_qualification_before_output_gates() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.timezone = "America/New_York".into();
        options.timezone_handling = "selected-filter".into();
        options.include_app_output = false;
        options.include_screen_output = false;
        let error = match run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]) {
            Ok(_) => panic!("absent selected timezone must fail before output gates"),
            Err(error) => error,
        };
        assert!(error.contains("America/New_York"));
        assert!(error.contains("remove all rows"));
    }

    #[test]
    fn person_attribution_matches_exact_then_numerical_device_and_fails_on_gaps() {
        let sharing = parse_device_sharing(
            b"Participant_ID,Sharing_Status\nP100,Shared\ncohort-200-D2,Non-Shared\n",
        )
        .expect("case-insensitive support headers");
        assert_eq!(
            sharing_status_for("P100", &sharing).unwrap(),
            SharingStatus::Shared
        );
        assert_eq!(
            sharing_status_for("other-200-D2", &sharing).unwrap(),
            SharingStatus::NonShared
        );
        let error = sharing_status_for("other-200-D1", &sharing).unwrap_err();
        assert!(error.contains("sharing table must cover every device"));
    }

    #[test]
    fn person_attribution_applies_survey_override_and_kids_shell_default() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P100,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P100,,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P100,,Kids Home,Activity Resumed,com.amazon.tahoe,2026-03-07 10:02:00,America/Chicago\n",
            "Study,P100,,Kids Home,Activity Paused,com.amazon.tahoe,2026-03-07 10:03:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.enable_person_attribution = true;
        options.minimum_usage_duration = 0.0;
        let result = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles {
                device_sharing_csv: b"participant_id,sharing_status\nP100,Shared\n",
                survey_attribution_csv:
                    b"participant_id,event_timestamp,users\nP100,2026-03-07 10:00:00,Other\n",
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("attribution run");
        let output = String::from_utf8(result.app_csv_bytes.as_ref().clone()).unwrap();
        assert!(output.contains("Other (From Survey)"));
        assert!(output.contains(NON_TARGET_CHILD_APP_USAGE));
        assert!(output.contains("Target Child"));
    }

    #[test]
    fn enabled_person_attribution_requires_device_sharing_support() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P100,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P100,,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.enable_person_attribution = true;
        let error = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .err()
        .expect("missing device-sharing file must fail");
        assert!(error.contains("Device sharing file is required"));
    }

    #[test]
    fn float_int_round_trip() {
        assert_eq!(normalize_float_string(1.0), "1.0");
        assert_eq!(normalize_float_string(0.0), "0.0");
        assert_eq!(normalize_float_string(-0.0), "0.0"); // JS String(-0) is "0"
        assert_eq!(normalize_float_string(60.0), "60.0");
        assert_eq!(normalize_float_string(-7.5), "-7.5");
    }

    #[test]
    fn float_decimal() {
        assert_eq!(normalize_float_string(0.5), "0.5");
        assert_eq!(normalize_float_string(1.5), "1.5");
        assert_eq!(normalize_float_string(0.1), "0.1");
        assert_eq!(normalize_float_string(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn float_small_uses_exponential() {
        // 1e-5 < 1e-4 -> exponential form
        assert_eq!(normalize_float_string(1e-5), "1e-5");
        assert_eq!(normalize_float_string(1.5e-5), "1.5e-5");
    }

    #[test]
    fn float_large() {
        assert_eq!(normalize_float_string(1e20), "100000000000000000000.0");
        assert_eq!(normalize_float_string(1e21), "1e+21");
    }

    #[test]
    fn normalize_threshold_int_repr() {
        assert_eq!(format_threshold(1.0), "1");
        assert_eq!(format_threshold(12.0), "12");
    }

    #[test]
    fn small_number_collapses_to_round() {
        // 5.0000000000000004e-8 toPrecision(15) -> 5.00000000000000e-8
        // -> parseFloat -> 5e-8 -> toExponential -> "5e-8"
        let v: f64 = 3e-6 / 60.0;
        assert_eq!(normalize_float_string(v), "5e-8");
    }

    #[test]
    fn ecma_to_fixed_half_away() {
        assert_eq!(ecma_to_fixed(0.045, 2), "0.04"); // V8 prints 0.04 because 0.045 is actually 0.0449999...
        assert_eq!(ecma_to_fixed(0.05, 2), "0.05");
        assert_eq!(ecma_to_fixed(21.625, 2), "21.63"); // exact tie -> round up
        assert_eq!(ecma_to_fixed(0.025, 2), "0.03"); // exact tie -> round up
        assert_eq!(ecma_to_fixed(0.0833333, 2), "0.08");
    }

    #[test]
    fn allocation_free_fixed_rounding_matches_the_decimal_reference() {
        let reference = |value: f64| ecma_to_fixed(value, 2).parse::<f64>().unwrap();
        for value in [
            -21.625, -0.045, -0.025, 0.0, 0.025, 0.045, 0.05, 0.0833333, 2.675, 21.625,
        ] {
            assert_eq!(ecma_round_fixed_f64(value, 2), reference(value));
        }

        // Exercise the exact nanosecond values immediately around every
        // half-centihour boundary in a two-day range.
        for centihour in -4_800_i64..=4_800 {
            let boundary_ns = centihour * 36_000_000_000 + 18_000_000_000;
            for offset in -8_i64..=8 {
                let value = (boundary_ns + offset) as f64 / 3_600_000_000_000.0;
                assert_eq!(
                    ecma_round_fixed_f64(value, 2),
                    reference(value),
                    "boundary mismatch at {boundary_ns} + {offset} ns"
                );
            }
        }

        let mut state = 0x4d59_5df4_d0f3_3173_u64;
        for _ in 0..100_000 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let delta_ns = (state % 1_209_600_000_000_000) as i64 - 604_800_000_000_000;
            let value = delta_ns as f64 / 3_600_000_000_000.0;
            assert_eq!(ecma_round_fixed_f64(value, 2), reference(value));
        }
    }

    #[test]
    fn precision_15_round_trip() {
        let v: f64 = 5.0000000000000004e-8;
        let p = round_to_precision(v, 15);
        assert_eq!(p, 5e-8);
    }

    #[test]
    fn screen_credit_lineage_separates_direct_state_from_liveness_search() {
        let mut substrate = ScreenCreditSubstrate::default();
        substrate.source_events.insert(
            "P01".into(),
            vec![
                (0, SourceDataRows::single(1)),
                (100, SourceDataRows::single(2)),
                (140, SourceDataRows::single(5)),
                (155, SourceDataRows::single(3)),
                (500, SourceDataRows::single(4)),
            ],
        );
        substrate.points.insert(
            "P01".into(),
            vec![ScreenChangePoint {
                timestamp_ns: 100,
                state: ScreenCreditState::On,
                source_data_rows: SourceDataRows::single(2),
            }],
        );
        let events = substrate.source_events.get("P01").unwrap();
        let mut suffix_digests = vec![String::new(); events.len() + 1];
        suffix_digests[events.len()] = empty_lineage_search_suffix_digest(events.len() as u32);
        for index in (0..events.len()).rev() {
            suffix_digests[index] = screen_source_event_suffix_digest(
                events[index].0,
                &events[index].1,
                index,
                &suffix_digests[index + 1],
            );
        }
        substrate
            .source_event_suffix_digests
            .insert("P01".into(), suffix_digests);

        let (contributors, search) = credit_lineage_contributors(&substrate, "P01", 150, 160, 10);
        assert_eq!(contributors.to_vec(), vec![2]);
        let search = search.expect("liveness window must be recorded");
        assert_eq!(
            search.index_space.as_str(),
            "participant-source-event-order"
        );
        assert_eq!(
            (search.start_event_index, search.end_event_index_exclusive),
            (2, 4)
        );
        assert_eq!(search.candidate_event_count, 2);
        assert!(
            !contributors.contains(1),
            "unrelated historical prefixes must not expand"
        );
        assert!(
            !contributors.contains(4),
            "future events must not be attributed"
        );
    }

    #[test]
    fn inline_lineage_digests_are_byte_exact_with_the_v1_string_protocol() {
        let inline = [
            empty_inline_lineage_search_suffix_digest(0),
            empty_inline_lineage_search_suffix_digest(1),
        ];
        let strings = [
            empty_lineage_search_suffix_digest(0),
            empty_lineage_search_suffix_digest(1),
        ];
        for (compact, string) in inline.iter().zip(&strings) {
            assert_eq!(&compact.encoded(), string.as_bytes());
        }
        assert_eq!(
            inline_lineage_search_range_digest(&inline, 0, 1),
            lineage_search_range_digest(&strings, 0, 1),
        );
    }
}

/// Exact product-output contract for the fused cold-oracle pipeline.
///
/// The browser runtime hands these bytes to researchers unchanged, and the
/// step digests are the evidence a step may be reported as cached from, so
/// both are pinned byte-for-byte against checked-in expected files for one
/// fixture that reaches every option-gated stage.
///
/// Re-record deliberately, never to turn a red run green:
/// ```text
/// UPDATE_GOLDEN=1 cargo test --features incremental-v2 \
///   --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
///   output_contract
/// ```
#[cfg(test)]
mod output_contract {
    use super::*;

    // Every row reaches a specific option-gated stage:
    //   09:59 Screen Interactive / 10:10 Screen Non-Interactive -> screen session
    //   10:00-10:02 chat Resumed/Paused                         -> app session
    //   10:02 third event on a duplicate timestamp              -> nudge stage
    //   10:01-10:09:30 music, overlapping chat and video        -> concurrent split
    //   10:03-10:05 chat again (same package)                   -> switched_app 0
    //   10:06-10:09 video (different package)                   -> switched_app 1
    //   10:20 Screen Interactive + Keyguard Shown               -> screen classify
    //   11:30 Device Shutdown / 11:31 Device Startup            -> liveness break
    //   12:00-12:01 com.example.secret                          -> filter relabel
    //   13:00 video Resumed (closes the background span above)  -> background model
    //   14:00 news Resumed, 14:10 news Activity Stopped         -> stop fallback
    //   next day 09:00-09:30 chat                               -> two-day coverage
    // The chat label carries a comma and an embedded double quote, so the
    // emitted CSV must quote the field and double the inner quote.
    const FIXTURE_CSV: &str = concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Interactive,,2026-03-07 09:59:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",User Interaction,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
        "Study,P01,Target Child,Music,Activity Resumed,com.example.music,2026-03-07 10:01:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-07 10:03:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 10:06:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 10:09:00,America/Chicago\n",
        "Study,P01,Target Child,Music,Activity Paused,com.example.music,2026-03-07 10:09:30,America/Chicago\n",
        "Study,P01,Target Child,,Screen Non-Interactive,,2026-03-07 10:10:00,America/Chicago\n",
        "Study,P01,Target Child,,Screen Interactive,,2026-03-07 10:20:00,America/Chicago\n",
        "Study,P01,Target Child,,Keyguard Shown,,2026-03-07 10:20:30,America/Chicago\n",
        "Study,P01,Target Child,,Screen Non-Interactive,,2026-03-07 10:21:00,America/Chicago\n",
        "Study,P01,Target Child,,Device Shutdown,,2026-03-07 11:30:00,America/Chicago\n",
        "Study,P01,Target Child,,Device Startup,,2026-03-07 11:31:00,America/Chicago\n",
        "Study,P01,Target Child,Secret,Activity Resumed,com.example.secret,2026-03-07 12:00:00,America/Chicago\n",
        "Study,P01,Target Child,Secret,Activity Paused,com.example.secret,2026-03-07 12:01:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 13:00:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Stopped,com.example.video,2026-03-07 13:05:00,America/Chicago\n",
        "Study,P01,Target Child,News,Activity Resumed,com.example.news,2026-03-07 14:00:00,America/Chicago\n",
        "Study,P01,Target Child,News,Activity Stopped,com.example.news,2026-03-07 14:10:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-08 09:00:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-08 09:30:00,America/Chicago\n",
    );

    const FILTER_CSV: &[u8] =
        b"app_package_name,known_application_labels\ncom.example.secret,Secret\n";
    const APPS_FORCING_CSV: &[u8] = b"package_name,label_or_note\ncom.example.video,Video\n";
    const BACKGROUND_APPS_CSV: &[u8] = b"app_package_name\ncom.example.video\n";
    const CODEBOOK_CSV: &[u8] = concat!(
        "app_package_name,bcm_play_store_broad_app_category,genreId\n",
        "com.example.chat,Social,SOCIAL\n",
        "com.example.video,Entertainment,ENTERTAINMENT\n",
    )
    .as_bytes();
    const STUDY_DATES_CSV: &[u8] =
        b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-08\n";
    const DEVICE_SHARING_CSV: &[u8] = b"participant_id,sharing_status\nP01,Shared\n";
    const SURVEY_ATTRIBUTION_CSV: &[u8] = concat!(
        "participant_id,event_timestamp,users\n",
        "P01,2026-03-07 10:00:00,Target Child\n",
    )
    .as_bytes();
    const ENROLLED_DEVICES_CSV: &[u8] = b"participant_id,device_count\nP01,1\n";

    use crate::golden::assert_matches as assert_golden;

    fn contract_options() -> PipelineV2Options {
        PipelineV2Options {
            study_name: "Kernel Output Contract".into(),
            timezone: "America/Chicago".into(),
            timezone_handling: "selected-convert".into(),
            usage_session_mode: UsageSessionMode::AppAndScreenUsage,
            include_app_output: true,
            include_screen_output: true,
            use_filter_file: true,
            use_apps_forcing_screen_open: true,
            use_background_apps_file: true,
            use_app_codebook: true,
            include_category_column: true,
            deduplicate_exact_rows: true,
            interaction_type_remap: Vec::new(),
            correct_duplicate_event_timestamps: true,
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 21_600_000_000_000,
            proximity_interval_ns: 2_000_000_000,
            custom_app_engagement_duration: 300.0,
            long_data_time_gap_thresholds: vec![1.0, 6.0, 12.0],
            long_usage_duration_thresholds: vec![1.0, 6.0, 12.0],
            same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
            other_stop_types: vec!["Activity Resumed".into(), "Device Shutdown".into()],
            interaction_types_to_remove: Vec::new(),
            screen_auto_lock_timeout_seconds: 120.0,
            screen_auto_lock_tolerance_seconds: 30.0,
            screen_manual_lock_max_tail_seconds: 30.0,
            screen_keyguard_near_stop_seconds: 2.0,
            datetime_of_preprocessing: "2026-07-21 12:00:00 UTC".into(),
            model_concurrent_usage: true,
            minimum_usage_duration: 60.0,
            apply_minimum_usage_duration_to_concurrent_subintervals: true,
            filter_zero_duration_sessions: true,
            add_no_activity_placeholder_days: true,
            enable_study_window_filter: true,
            enable_person_attribution: true,
            enable_day_coverage: true,
            enable_compliance_scoring: true,
            compliance_threshold_percent: 70.0,
            enable_screen_gated_crediting: true,
            enable_aggregates: true,
            aggregate_shape: "wide".into(),
            materialize_visualization_data: true,
            credited_session_cap_minutes: 360.0,
            device_liveness_gap_tolerance_minutes: 120.0,
            auto_lock_bridge_seconds: 120.0,
            no_witness_min_day_apps: 2,
        }
    }

    fn support_files() -> PipelineV2SupportFiles<'static> {
        PipelineV2SupportFiles {
            filter_csv: FILTER_CSV,
            apps_forcing_csv: APPS_FORCING_CSV,
            background_apps_csv: BACKGROUND_APPS_CSV,
            codebook_csv: CODEBOOK_CSV,
            study_dates_csv: STUDY_DATES_CSV,
            device_sharing_csv: DEVICE_SHARING_CSV,
            survey_attribution_csv: SURVEY_ATTRIBUTION_CSV,
            enrolled_devices_csv: ENROLLED_DEVICES_CSV,
        }
    }

    fn run_contract_fixture() -> PipelineV2Result {
        run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &contract_options(), support_files())
            .expect("the contract fixture must preprocess cleanly")
    }

    /// The support files, session-mode flags, and threshold knobs above are
    /// not decoration: flipping any one of them must move the emitted product
    /// bytes. Without this, a golden could stay green while an option stopped
    /// reaching the pipeline at all.
    #[test]
    fn every_contract_option_and_support_file_changes_the_emitted_output() {
        let baseline = run_contract_fixture();
        let baseline_bytes = |result: &PipelineV2Result| {
            (
                result.app_csv_bytes.to_vec(),
                result.screen_csv_bytes.to_vec(),
                result.credited_app_csv_bytes.to_vec(),
                result.day_coverage_csv_bytes.to_vec(),
                result.compliance_csv_bytes.to_vec(),
            )
        };
        let baseline_output = baseline_bytes(&baseline);

        let perturbations: Vec<(&str, Box<dyn Fn(&mut PipelineV2Options)>)> = vec![
            (
                "use_filter_file",
                Box::new(|options: &mut PipelineV2Options| options.use_filter_file = false),
            ),
            (
                "use_apps_forcing_screen_open",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_apps_forcing_screen_open = false
                }),
            ),
            (
                "use_background_apps_file",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_background_apps_file = false
                }),
            ),
            (
                "use_app_codebook",
                Box::new(|options: &mut PipelineV2Options| options.use_app_codebook = false),
            ),
            (
                "include_category_column",
                Box::new(|options: &mut PipelineV2Options| {
                    options.include_category_column = false
                }),
            ),
            (
                "enable_person_attribution",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_person_attribution = false
                }),
            ),
            (
                "enable_day_coverage",
                Box::new(|options: &mut PipelineV2Options| options.enable_day_coverage = false),
            ),
            (
                "enable_compliance_scoring",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_compliance_scoring = false
                }),
            ),
            (
                "enable_screen_gated_crediting",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_screen_gated_crediting = false
                }),
            ),
            (
                "correct_duplicate_event_timestamps",
                Box::new(|options: &mut PipelineV2Options| {
                    options.correct_duplicate_event_timestamps = false
                }),
            ),
            (
                "use_activity_stopped_as_fallback",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_activity_stopped_as_fallback = false
                }),
            ),
            (
                "model_concurrent_usage",
                Box::new(|options: &mut PipelineV2Options| {
                    options.model_concurrent_usage = false
                }),
            ),
            (
                "minimum_usage_duration",
                Box::new(|options: &mut PipelineV2Options| {
                    options.minimum_usage_duration = 240.0
                }),
            ),
            (
                "long_data_time_gap_thresholds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.long_data_time_gap_thresholds = vec![48.0]
                }),
            ),
            (
                "long_usage_duration_thresholds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.long_usage_duration_thresholds = vec![48.0]
                }),
            ),
            (
                "custom_app_engagement_duration",
                Box::new(|options: &mut PipelineV2Options| {
                    options.custom_app_engagement_duration = 45.0
                }),
            ),
            (
                "screen_auto_lock_timeout_seconds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.screen_auto_lock_timeout_seconds = 3_600.0
                }),
            ),
            (
                "study_name",
                Box::new(|options: &mut PipelineV2Options| {
                    options.study_name = "Other Study".into()
                }),
            ),
        ];
        for (name, perturb) in perturbations {
            let mut options = contract_options();
            perturb(&mut options);
            let perturbed =
                run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &options, support_files())
                    .unwrap_or_else(|error| panic!("{name} perturbation must still run: {error}"));
            assert_ne!(
                baseline_output,
                baseline_bytes(&perturbed),
                "changing {name} left every product output identical",
            );
        }

        // Each support file must reach the pipeline through the support struct.
        let support_roles: [(&str, fn(&mut PipelineV2SupportFiles<'static>)); 4] = [
            ("filter_csv", |support| support.filter_csv = b""),
            ("apps_forcing_csv", |support| support.apps_forcing_csv = b""),
            ("background_apps_csv", |support| {
                support.background_apps_csv = b""
            }),
            ("codebook_csv", |support| support.codebook_csv = b""),
        ];
        for (name, clear) in support_roles {
            let mut support = support_files();
            clear(&mut support);
            let perturbed =
                run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &contract_options(), support)
                    .unwrap_or_else(|error| panic!("{name} removal must still run: {error}"));
            assert_ne!(
                baseline_output,
                baseline_bytes(&perturbed),
                "removing {name} left every product output identical",
            );
        }
    }

    #[test]
    fn product_csv_and_json_outputs_are_exact() {
        let result = run_contract_fixture();
        assert_golden("app.csv", &result.app_csv_bytes);
        assert_golden("screen.csv", &result.screen_csv_bytes);
        assert_golden("credited_app.csv", &result.credited_app_csv_bytes);
        assert_golden("day_coverage.csv", &result.day_coverage_csv_bytes);
        assert_golden("compliance.csv", &result.compliance_csv_bytes);
        assert_golden("review_summary.json", &result.review_summary_json_bytes);
        assert_golden(
            "visualization_data.json",
            &result.visualization_data_json_bytes,
        );
        let kinds = result
            .aggregate_csv_outputs
            .iter()
            .map(|output| output.kind.clone())
            .collect::<Vec<_>>();
        assert_golden("aggregate_kinds.json", format!("{kinds:?}").as_bytes());
        for output in result.aggregate_csv_outputs.iter() {
            assert_golden(&format!("{}.csv", output.kind), &output.bytes);
        }
    }

    #[test]
    fn step_digests_and_row_lineage_are_exact() {
        let result = run_contract_fixture();
        assert_golden(
            "pipeline_step_digests.json",
            serde_json::to_string_pretty(&result.pipeline_step_digests)
                .expect("step digests serialize")
                .as_bytes(),
        );
        assert_golden(
            "pipeline_step_checkpoints.json",
            serde_json::to_string_pretty(&result.pipeline_step_checkpoints)
                .expect("step checkpoints serialize")
                .as_bytes(),
        );
        assert_golden(
            "logical_stage_checkpoints.json",
            serde_json::to_string_pretty(&result.logical_stage_checkpoints)
                .expect("logical stage checkpoints serialize")
                .as_bytes(),
        );
        assert_golden(
            "row_lineage.json",
            serde_json::to_string_pretty(&result.row_lineage)
                .expect("row lineage serializes")
                .as_bytes(),
        );
    }

    #[test]
    fn reported_counts_and_timezone_resolution_are_exact() {
        let result = run_contract_fixture();
        assert_golden(
            "counts.json",
            serde_json::to_string_pretty(&serde_json::json!({
                "originalRowCount": result.original_row_count,
                "processedRowCount": result.processed_row_count,
                "appRowCount": result.app_row_count,
                "screenRowCount": result.screen_row_count,
                "dayCoverageRowCount": result.day_coverage_row_count,
                "complianceRowCount": result.compliance_row_count,
                "creditedAppRowCount": result.credited_app_row_count,
                "duplicateTimestampsCorrected": result.duplicate_timestamps_corrected,
                "exactDuplicateRowsRemoved": result.exact_duplicate_rows_removed,
                "availableTimezones": result.available_timezones,
                "timezone": result.timezone,
                "timezoneAction": result.timezone_action,
                "rowsBeforeTimezoneHandling": result.rows_before_timezone_handling,
                "rowsAfterTimezoneHandling": result.rows_after_timezone_handling,
                "rowsRemovedByTimezone": result.rows_removed_by_timezone,
                "timezoneRetainedSourceRowsDigest": result.timezone_retained_source_rows_digest,
                "timezoneStageDigest": result.timezone_stage_digest,
                "logicalStageDigests": result.logical_stage_digests,
            }))
            .expect("counts serialize")
            .as_bytes(),
        );
    }
}
