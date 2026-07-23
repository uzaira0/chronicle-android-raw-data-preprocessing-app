//! Full pipeline v2 — port of `processRawCsvContent` (browserPipeline.ts).
//!
//! Goal: byte-identical output to `buildAppOutputBundle` /
//! `buildScreenOutputBundle` for the supported option matrix, in a single
//! WASM boundary call.

use ahash::AHashSet;
use blake3::Hasher as CheckpointHasher;
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

use crate::{parse_chronicle_timestamp_ns, weekday_chronicle, write_csv_field};

use _rust_app_usage_matcher::{split_overlapping_sessions, UsageLayer};

#[path = "pipeline_v2_aggregates.rs"]
mod aggregates;

const PREPROCESSOR_VERSION: &str = "1.0.0";

/// Closed product contract for timezone handling. Keeping the exhaustive set
/// beside the Rust implementation lets the configuration-family proof fail if
/// a fifth policy is added without being observed, rather than silently
/// treating an incomplete test matrix as exhaustive.
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
    pub credited_session_cap_minutes: f64,
    pub device_liveness_gap_tolerance_minutes: f64,
    pub auto_lock_bridge_seconds: f64,
    pub no_witness_min_day_apps: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageSessionMode {
    NoUsage,
    AppUsage,
    ScreenUsage,
    AppAndScreenUsage,
}

// ---- support file loaders ----------------------------------------------

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

#[derive(Default, Debug, Clone)]
pub struct CodebookEntry {
    /// Indexed by codebook_col_index() output name (e.g. "codebook_application_label", "bcm_play_store_genreId"…)
    pub fields: Rc<Vec<Option<String>>>,
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
                fields: Rc::new(fields),
            },
        );
    }
    map
}

fn trim_owned(v: Option<&String>) -> String {
    v.map(|s| s.trim().to_string()).unwrap_or_default()
}

fn parse_csv_to_records(bytes: &[u8]) -> Vec<HashMap<String, String>> {
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
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = std::str::from_utf8(&field_buf[..n_out])
                    .unwrap_or("")
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
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                continue;
            }
            ReadFieldResult::OutputFull => {
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                if col_idx < row_vals.len() {
                    let s = std::str::from_utf8(&field_buf[..n_out]).unwrap_or("");
                    row_vals[col_idx].clear();
                    row_vals[col_idx].push_str(s);
                    if !s.is_empty() {
                        any_nonempty = true;
                    }
                }
                col_idx += 1;
                if record_end {
                    if any_nonempty {
                        let mut rec = HashMap::with_capacity(headers.len());
                        for (i, h) in headers.iter().enumerate() {
                            rec.insert(h.clone(), row_vals[i].clone());
                        }
                        records.push(rec);
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

#[derive(Clone)]
struct Row {
    /// One-based raw CSV data-row numbers (the header is not counted) that
    /// may contribute to this row. Matching/state-machine outputs retain a
    /// conservative dependency set rather than claiming false exactness.
    source_data_rows: SourceDataRows,
    /// Exact descriptions of candidate regions searched to establish that a
    /// required matching event was absent. These remain separate from rows
    /// that directly supplied output values.
    lineage_searches: Vec<LineageSearchEvidence>,
    study_id: String,
    participant_id: String,
    possible_device_model: String,
    username: String,
    application_label: String,
    interaction_type: String,
    app_package_name: String,
    event_timestamp_ns: i64,
    timezone: String,
    data_time_gap_hours: f64,
    date: String,
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
    screen_usage_end_reason: Option<String>,
    screen_usage_end_reason_confidence: Option<f64>,
    screen_usage_stop_event_type: Option<String>,
    screen_usage_last_activity_timestamp_ns: Option<i64>,
    screen_usage_tail_gap_seconds: Option<f64>,
    screen_usage_foreground_app_package: Option<String>,
    screen_usage_apps_forcing_screen_open_label: Option<String>,
    screen_usage_lock_screen_only: Option<u8>,
    any_app_usage_flags: String,
    valid_app_new_engage_30s: i32,
    valid_app_new_engage_custom: i32,
    valid_app_switched_app: i32,
    valid_app_usage_time_gap_hours: f64,
    any_app_new_engage_30s: i32,
    any_app_new_engage_custom: i32,
    any_app_switched_app: i32,
    any_app_usage_time_gap_hours: f64,
    genre_id_scraped: Option<String>,
    broad_app_category: Option<String>,
    /// Per-codebook column values (Option<String>) parallel to CODEBOOK_RENAME_PAIRS.
    codebook_fields: Rc<Vec<Option<String>>>,
    codebook_genre_fields_cleared: bool,
    index: usize,
    /// Present only when `model_concurrent_usage` is true. Value is "primary"
    /// or "secondary". None when the flag is off (column absent from output).
    usage_layer: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDataRowRange {
    pub first: u32,
    pub last: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageSearchEvidence {
    pub protocol_version: &'static str,
    pub reason: &'static str,
    pub index_space: &'static str,
    pub start_participant_id: String,
    pub start_event_index: u32,
    pub end_event_index_exclusive: u32,
    pub candidate_event_count: u32,
    pub candidate_chain_digest: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(transparent)]
struct SourceDataRows(Vec<SourceDataRowRange>);

impl SourceDataRows {
    fn single(row: u32) -> Self {
        Self(vec![SourceDataRowRange {
            first: row,
            last: row,
        }])
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

        let mut merged: Vec<SourceDataRowRange> =
            Vec::with_capacity(self.0.len() + additional.0.len());
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

fn empty_codebook_fields() -> Rc<Vec<Option<String>>> {
    Rc::new(vec![None; CODEBOOK_RENAME_PAIRS.len()])
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

/// Format event_timestamp matching `formatEventTimestamp` (TS).
/// "YYYY-MM-DD HH:MM:SS+HH:MM"
fn fmt_event_timestamp(ts_ns: i64, tz: Tz) -> String {
    let local = ts_to_local(ts_ns, tz);
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    )
}

/// Session timestamp: M-D-Y H:M:S (no offset). Empty if None.
fn fmt_session_timestamp(ts_ns: Option<i64>, tz: Tz) -> String {
    let Some(ns) = ts_ns else {
        return String::new();
    };
    let local = ts_to_local(ns, tz);
    format!(
        "{:02}-{:02}-{:04} {:02}:{:02}:{:02}",
        local.month(),
        local.day(),
        local.year(),
        local.hour(),
        local.minute(),
        local.second(),
    )
}

/// Screen timestamp: YYYY-MM-DD HH:MM:SS.000000+HH:MM (with .000000 micro filler)
fn fmt_screen_timestamp(ts_ns: Option<i64>, tz: Tz) -> String {
    let Some(ns) = ts_ns else {
        return String::new();
    };
    let base = fmt_event_timestamp(ns, tz);
    // Insert ".000000" before the offset suffix.
    // Find last + or - that is the offset (>=19 chars in).
    if let Some(idx) = find_offset_start(&base) {
        let mut out = String::with_capacity(base.len() + 7);
        out.push_str(&base[..idx]);
        out.push_str(".000000");
        out.push_str(&base[idx..]);
        out
    } else {
        base
    }
}

/// Last activity timestamp: YYYY-MM-DDTHH:MM:SS.000000+HHMM (T separator + no colon in offset)
fn fmt_screen_last_activity(ts_ns: Option<i64>, tz: Tz) -> String {
    let Some(ns) = ts_ns else {
        return String::new();
    };
    let base = fmt_event_timestamp(ns, tz);
    let with_t = base.replacen(' ', "T", 1);
    if let Some(idx) = find_offset_start(&with_t) {
        // Strip the colon from the offset.
        let prefix = &with_t[..idx];
        let offset = &with_t[idx..];
        let mut sanitized_offset = String::with_capacity(offset.len());
        for ch in offset.chars() {
            if ch != ':' {
                sanitized_offset.push(ch);
            }
        }
        let mut out = String::with_capacity(prefix.len() + 7 + sanitized_offset.len());
        out.push_str(prefix);
        out.push_str(".000000");
        out.push_str(&sanitized_offset);
        out
    } else {
        with_t
    }
}

fn find_offset_start(s: &str) -> Option<usize> {
    s.rfind(['+', '-']).filter(|&i| i >= 19)
}

fn populate_time_columns(row: &mut Row, tz: Tz) {
    let local = ts_to_local(row.event_timestamp_ns, tz);
    row.date = format!(
        "{:04}-{:02}-{:02}",
        local.year(),
        local.month(),
        local.day()
    );
    let day = weekday_chronicle(local.weekday());
    row.day = day;
    row.weekday_mf = if (2..=6).contains(&day) { 1 } else { 0 };
    row.weekday_mth = if (2..=5).contains(&day) { 1 } else { 0 };
    row.weekday_su_th = if day == 1 || (2..=5).contains(&day) {
        1
    } else {
        0
    };
    row.hour = local.hour() as u8;
    row.quarter = ((local.month() as u8 - 1) / 3) + 1;
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

fn format_csv_number_float(v: Option<f64>) -> String {
    match v {
        None => String::new(),
        Some(x) => normalize_float_string(x),
    }
}

fn format_csv_int(v: i32) -> String {
    v.to_string()
}

// ---- main entry ---------------------------------------------------------

/// Internal Rust-side result; not directly returned across the boundary.
#[derive(Clone)]
pub struct PipelineV2Result {
    pub app_csv_bytes: Vec<u8>,
    pub screen_csv_bytes: Vec<u8>,
    pub day_coverage_csv_bytes: Vec<u8>,
    pub compliance_csv_bytes: Vec<u8>,
    pub credited_app_csv_bytes: Vec<u8>,
    pub review_summary_json_bytes: Vec<u8>,
    pub visualization_data_json_bytes: Vec<u8>,
    pub aggregate_csv_outputs: Vec<aggregates::AggregateCsvOutput>,
    pub row_lineage: Vec<PipelineRowLineage>,
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

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRowLineage {
    pub output_kind: &'static str,
    pub output_row_index: u32,
    pub source_data_row_ranges: Vec<SourceDataRowRange>,
    pub source_data_row_count: u32,
    pub searches: Vec<LineageSearchEvidence>,
    pub terminal_logical_node: &'static str,
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
    rows.enumerate()
        .map(|(index, row)| PipelineRowLineage {
            output_kind,
            output_row_index: index as u32,
            source_data_row_ranges: row.source_data_rows.ranges().to_vec(),
            source_data_row_count: row.source_data_rows.len() as u32,
            searches: row.lineage_searches.clone(),
            terminal_logical_node,
        })
        .collect()
}

trait CheckpointSink {
    fn checkpoint_update(&mut self, bytes: &[u8]);
}

impl CheckpointSink for CheckpointHasher {
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        self.update(bytes);
    }
}

impl CheckpointSink for Vec<u8> {
    fn checkpoint_update(&mut self, bytes: &[u8]) {
        self.extend_from_slice(bytes);
    }
}

fn checkpoint_update(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(bytes);
}

fn checkpoint_digest_field(sink: &mut impl CheckpointSink, bytes: &[u8]) {
    sink.checkpoint_update(&(bytes.len() as u64).to_le_bytes());
    sink.checkpoint_update(bytes);
}

fn checkpoint_digest_fixed32(hasher: &mut CheckpointHasher, value: &[u8; 32]) {
    let mut encoded = [0_u8; 40];
    encoded[..8].copy_from_slice(&32_u64.to_le_bytes());
    encoded[8..].copy_from_slice(value);
    hasher.update(&encoded);
}

fn checkpoint_digest_fixed32_pair(
    hasher: &mut CheckpointHasher,
    first: &[u8; 32],
    second: &[u8; 32],
) {
    let mut encoded = [0_u8; 80];
    encoded[..8].copy_from_slice(&32_u64.to_le_bytes());
    encoded[8..40].copy_from_slice(first);
    encoded[40..48].copy_from_slice(&32_u64.to_le_bytes());
    encoded[48..].copy_from_slice(second);
    hasher.update(&encoded);
}

fn checkpoint_digest_positioned_fixed32(
    hasher: &mut CheckpointHasher,
    position: usize,
    value: &[u8; 32],
) {
    let mut encoded = [0_u8; 48];
    encoded[..8].copy_from_slice(&(position as u64).to_le_bytes());
    encoded[8..16].copy_from_slice(&32_u64.to_le_bytes());
    encoded[16..].copy_from_slice(value);
    hasher.update(&encoded);
}

fn checkpoint_digest_positioned_fixed32_triple(
    hasher: &mut CheckpointHasher,
    position: usize,
    first: &[u8; 32],
    second: &[u8; 32],
    third: &[u8; 32],
) {
    let mut encoded = [0_u8; 128];
    encoded[..8].copy_from_slice(&(position as u64).to_le_bytes());
    encoded[8..16].copy_from_slice(&32_u64.to_le_bytes());
    encoded[16..48].copy_from_slice(first);
    encoded[48..56].copy_from_slice(&32_u64.to_le_bytes());
    encoded[56..88].copy_from_slice(second);
    encoded[88..96].copy_from_slice(&32_u64.to_le_bytes());
    encoded[96..].copy_from_slice(third);
    hasher.update(&encoded);
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

const LOGICAL_STAGE_CHECKPOINT_PROTOCOL: &str = "chronicle-logical-stage-checkpoint/v3";
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

fn checkpoint_hasher(node_id: &str, component: &str) -> CheckpointHasher {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, LOGICAL_STAGE_CHECKPOINT_PROTOCOL.as_bytes());
    checkpoint_digest_field(&mut hasher, node_id.as_bytes());
    checkpoint_digest_field(&mut hasher, component.as_bytes());
    hasher
}

fn finish_checkpoint_digest(hasher: CheckpointHasher) -> String {
    format!("blake3:{}", hasher.finalize().to_hex())
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RowCheckpointParts {
    identity: [u8; 32],
    temporal: [u8; 32],
    classification: [u8; 32],
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
fn encode_row_checkpoint_parts<S: CheckpointSink>(
    row: &Row,
    identity: &mut S,
    temporal: &mut S,
    classification: &mut S,
) {
    // Every field is deliberately bound and hashed. Adding a Row field makes
    // this exhaustive pattern fail; binding one without hashing it makes the
    // deny(unused_variables) lint fail.
    let Row {
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
    } = row;

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
    for search in lineage_searches {
        checkpoint_digest_field(identity, search.protocol_version.as_bytes());
        checkpoint_digest_field(identity, search.reason.as_bytes());
        checkpoint_digest_field(identity, search.index_space.as_bytes());
        checkpoint_digest_field(identity, search.start_participant_id.as_bytes());
        checkpoint_update(identity, &search.start_event_index.to_le_bytes());
        checkpoint_update(identity, &search.end_event_index_exclusive.to_le_bytes());
        checkpoint_update(identity, &search.candidate_event_count.to_le_bytes());
        checkpoint_digest_field(identity, search.candidate_chain_digest.as_bytes());
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
    checkpoint_digest_optional_string(classification, usage_layer.as_deref());
}

impl RowCheckpointScratch {
    fn parts(&mut self, row: &Row) -> RowCheckpointParts {
        self.identity.clear();
        self.temporal.clear();
        self.classification.clear();
        encode_row_checkpoint_parts(
            row,
            &mut self.identity,
            &mut self.temporal,
            &mut self.classification,
        );
        let parts = RowCheckpointParts {
            identity: *blake3::hash(&self.identity).as_bytes(),
            temporal: *blake3::hash(&self.temporal).as_bytes(),
            classification: *blake3::hash(&self.classification).as_bytes(),
        };

        #[cfg(debug_assertions)]
        {
            let mut identity = CheckpointHasher::new();
            let mut temporal = CheckpointHasher::new();
            let mut classification = CheckpointHasher::new();
            encode_row_checkpoint_parts(row, &mut identity, &mut temporal, &mut classification);
            assert_eq!(parts.identity, *identity.finalize().as_bytes());
            assert_eq!(parts.temporal, *temporal.finalize().as_bytes());
            assert_eq!(parts.classification, *classification.finalize().as_bytes());
        }

        parts
    }
}

fn row_checkpoint_parts_for_rows(rows: &[Row]) -> Vec<RowCheckpointParts> {
    let mut scratch = RowCheckpointScratch::default();
    rows.iter().map(|row| scratch.parts(row)).collect()
}

fn row_parts_sequence_digest<'a>(
    part_count: usize,
    parts: impl Iterator<Item = &'a RowCheckpointParts>,
) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-row-reference-sequence/v1");
    hasher.update(&(part_count as u64).to_le_bytes());
    let mut observed = 0_usize;
    for (position, parts) in parts.enumerate() {
        checkpoint_digest_positioned_fixed32_triple(
            &mut hasher,
            position,
            &parts.identity,
            &parts.temporal,
            &parts.classification,
        );
        observed += 1;
    }
    assert_eq!(observed, part_count, "row-part sequence count drift");
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn row_reference_sequence_digest(rows: &[&Row]) -> String {
    let mut scratch = RowCheckpointScratch::default();
    let parts = rows
        .iter()
        .map(|row| scratch.parts(row))
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
        logical_stage_checkpoint_with_group_parts(node_id, row_groups, payloads, Some(&group_parts))
    } else {
        logical_stage_checkpoint_with_group_parts(node_id, row_groups, payloads, None)
    }
}

fn logical_stage_checkpoint_with_group_parts(
    node_id: &str,
    row_groups: &[(&str, &[Row])],
    payloads: &[(&str, &[u8])],
    group_parts: Option<&[&[RowCheckpointParts]]>,
) -> LogicalStageCheckpoint {
    let mut membership = checkpoint_hasher(node_id, "row-membership");
    let mut order = checkpoint_hasher(node_id, "row-order");
    let mut temporal = checkpoint_hasher(node_id, "temporal-state");
    let mut classification = checkpoint_hasher(node_id, "classification");
    let mut payload = checkpoint_hasher(node_id, "payload");
    let mut schema = checkpoint_hasher(node_id, "schema");
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
        // Calculate the three row commitments once. The order commitment uses
        // the same identity bytes below; recomputing `row_checkpoint_parts`
        // there doubled all row hashing at every one of the 55 checkpoints.
        let computed_parts;
        let row_parts = if let Some(parts) = group_parts.and_then(|parts| parts.get(group_index)) {
            assert_eq!(parts.len(), rows.len(), "checkpoint row-part count drift");
            #[cfg(debug_assertions)]
            {
                let fresh = row_checkpoint_parts_for_rows(rows);
                assert_eq!(
                    *parts, fresh,
                    "attempted to reuse stale row checkpoint parts for {node_id}"
                );
            }
            *parts
        } else {
            computed_parts = row_checkpoint_parts_for_rows(rows);
            &computed_parts
        };
        let mut identity_order: Vec<usize> = (0..rows.len()).collect();
        identity_order.sort_by(|left, right| {
            rows[*left]
                .source_data_rows
                .cmp_expanded(&rows[*right].source_data_rows)
                .then(rows[*left].index.cmp(&rows[*right].index))
        });
        for row_index in identity_order {
            let parts = &row_parts[row_index];
            checkpoint_digest_fixed32(&mut membership, &parts.identity);
            checkpoint_digest_fixed32_pair(&mut temporal, &parts.identity, &parts.temporal);
            checkpoint_digest_fixed32_pair(
                &mut classification,
                &parts.identity,
                &parts.classification,
            );
        }
        // Order remains deliberately sequence-sensitive and associates every
        // position with the same stable row identity used above.
        for (position, parts) in row_parts.iter().enumerate() {
            checkpoint_digest_positioned_fixed32(&mut order, position, &parts.identity);
        }
    }
    payload.update(&(payloads.len() as u64).to_le_bytes());
    schema.update(&(payloads.len() as u64).to_le_bytes());
    for (label, bytes) in payloads {
        checkpoint_digest_field(&mut payload, label.as_bytes());
        checkpoint_digest_field(&mut payload, bytes);
        checkpoint_digest_field(&mut schema, label.as_bytes());
    }
    let row_membership_digest = finish_checkpoint_digest(membership);
    let row_order_digest = finish_checkpoint_digest(order);
    let temporal_state_digest = finish_checkpoint_digest(temporal);
    let classification_digest = finish_checkpoint_digest(classification);
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

fn logical_stage_rows_checkpoint(node_id: &str, rows: &[Row]) -> LogicalStageCheckpoint {
    logical_stage_checkpoint(node_id, &[("rows", rows)], &[])
}

fn logical_stage_rows_checkpoint_with_parts(
    node_id: &str,
    rows: &[Row],
    parts: &[RowCheckpointParts],
) -> LogicalStageCheckpoint {
    assert_eq!(parts.len(), rows.len(), "checkpoint row-part count drift");
    logical_stage_checkpoint_with_parts(node_id, &[("rows", rows)], &[], Some(parts))
}

fn logical_stage_rows_checkpoint_reusing_last(
    node_id: &str,
    rows: &[Row],
    recorder: &StepCheckpointRecorder<'_>,
) -> LogicalStageCheckpoint {
    match recorder.last_row_parts() {
        Some(parts) => logical_stage_rows_checkpoint_with_parts(node_id, rows, parts),
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
}

impl StepCheckpointRecorder<'_> {
    fn rows(&mut self, step_id: &str, rows: &[Row]) {
        let parts = row_checkpoint_parts_for_rows(rows);
        self.record(logical_stage_checkpoint_with_parts(
            step_id,
            &[("rows", rows)],
            &[],
            Some(&parts),
        ));
        self.last_row_parts = Some(parts);
    }

    fn state(&mut self, step_id: &str, state: &str) {
        self.record(logical_stage_state_checkpoint(step_id, state));
    }

    fn value<T: serde::Serialize>(&mut self, step_id: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec(value)
            .map_err(|error| format!("serialize {step_id} checkpoint: {error}"))?;
        self.record(logical_stage_checkpoint(step_id, &[], &[("value", &bytes)]));
        Ok(())
    }

    fn rows_and_value<T: serde::Serialize>(
        &mut self,
        step_id: &str,
        rows: &[Row],
        value: &T,
    ) -> Result<(), String> {
        let bytes = serde_json::to_vec(value)
            .map_err(|error| format!("serialize {step_id} checkpoint: {error}"))?;
        let parts = row_checkpoint_parts_for_rows(rows);
        self.record(logical_stage_checkpoint_with_parts(
            step_id,
            &[("rows", rows)],
            &[("value", &bytes)],
            Some(&parts),
        ));
        self.last_row_parts = Some(parts);
        Ok(())
    }

    fn last_row_parts(&self) -> Option<&[RowCheckpointParts]> {
        self.last_row_parts.as_deref()
    }

    fn take_last_row_parts(&mut self) -> Option<Vec<RowCheckpointParts>> {
        self.last_row_parts.take()
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
    participant_id: String,
    study_id: String,
    totals: ReviewParticipantTotals,
    per_day: Vec<ReviewDayMetrics>,
    top_apps_by_date: BTreeMap<String, Vec<ReviewTopApp>>,
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
    date: String,
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
    app_package_name: String,
    application_label: String,
    category: Option<String>,
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VisualizationData {
    app_rows: Vec<VisualizationRow>,
    screen_rows: Vec<VisualizationRow>,
    event_timestamps_by_participant: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VisualizationRow {
    participant_id: String,
    date: String,
    start_timestamp_ns: Option<String>,
    stop_timestamp_ns: Option<String>,
    event_timestamp_ns: String,
    interaction_type: String,
    broad_app_category: Option<String>,
    app_package_name: String,
    application_label: String,
    username: String,
    screen_usage_end_reason: Option<String>,
}

fn visualization_row(row: &Row) -> VisualizationRow {
    VisualizationRow {
        participant_id: row.participant_id.clone(),
        date: row.date.clone(),
        start_timestamp_ns: row.start_timestamp_ns.map(|value| value.to_string()),
        stop_timestamp_ns: row.stop_timestamp_ns.map(|value| value.to_string()),
        event_timestamp_ns: row.event_timestamp_ns.to_string(),
        interaction_type: row.interaction_type.clone(),
        broad_app_category: row.broad_app_category.clone(),
        app_package_name: row.app_package_name.clone(),
        application_label: row.application_label.clone(),
        username: row.username.clone(),
        screen_usage_end_reason: row.screen_usage_end_reason.clone(),
    }
}

fn build_visualization_data(
    app_rows: &[Row],
    screen_rows: &[Row],
    policy_rows: &[Row],
) -> VisualizationData {
    let mut event_timestamps_by_participant = BTreeMap::<String, Vec<String>>::new();
    for row in policy_rows {
        event_timestamps_by_participant
            .entry(if row.participant_id.is_empty() {
                "unknown".into()
            } else {
                row.participant_id.clone()
            })
            .or_default()
            .push(row.event_timestamp_ns.to_string());
    }
    VisualizationData {
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
    type ParticipantKey = (String, String);
    type DayKey = (String, String, String);
    let mut days = BTreeMap::<DayKey, ReviewDayAccumulator>::new();
    let mut apps_by_day = BTreeMap::<DayKey, Vec<&Row>>::new();

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
        apps_by_day.entry(key.clone()).or_default().push(row);
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

    let mut observed = BTreeMap::<ParticipantKey, BTreeMap<String, ReviewDayMetrics>>::new();
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
        let first = observed_days.keys().next().cloned().unwrap_or_default();
        let last = observed_days
            .keys()
            .next_back()
            .cloned()
            .unwrap_or_default();
        let mut per_day = Vec::new();
        if let (Ok(mut cursor), Ok(end)) = (
            NaiveDate::parse_from_str(&first, "%Y-%m-%d"),
            NaiveDate::parse_from_str(&last, "%Y-%m-%d"),
        ) {
            while cursor <= end {
                let date = cursor.format("%Y-%m-%d").to_string();
                per_day.push(
                    observed_days
                        .get(&date)
                        .cloned()
                        .unwrap_or(ReviewDayMetrics {
                            date,
                            app_usage_minutes: 0.0,
                            background_app_usage_minutes: 0.0,
                            screen_usage_minutes: 0.0,
                            app_session_count: 0,
                            screen_session_count: 0,
                            flags: vec!["no_usage_day".into()],
                        }),
                );
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
            let key = (study_id.clone(), participant_id.clone(), date.clone());
            let Some(rows) = apps_by_day.get(&key) else {
                continue;
            };
            let mut by_package = BTreeMap::<String, Vec<&Row>>::new();
            for row in rows {
                if row.duration_minutes.is_none() {
                    continue;
                }
                by_package
                    .entry(row.app_package_name.clone())
                    .or_default()
                    .push(*row);
            }
            let mut top_apps: Vec<_> = by_package
                .into_iter()
                .map(|(app_package_name, rows)| {
                    let sample = rows[0];
                    let minutes = rows
                        .iter()
                        .filter_map(|row| row.duration_minutes)
                        .sum::<f64>();
                    ReviewTopApp {
                        app_package_name,
                        application_label: sample.application_label.clone(),
                        category: sample.broad_app_category.clone(),
                        minutes: review_round4(minutes),
                    }
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

/// Boundary-friendly handle to a completed pipeline run. Holds the produced
/// CSV bytes inside Rust linear memory; JS pulls them out via `app_bytes` /
/// `screen_bytes`, each of which is a single `Uint8Array` copy at the
/// boundary. This avoids the JS-Array-length cap that `serde-wasm-bindgen`
/// hits when round-tripping >100 MB Vec<u8> as a regular array.
#[wasm_bindgen]
pub struct PipelineV2Handle {
    app_csv: Vec<u8>,
    screen_csv: Vec<u8>,
    original_row_count: u32,
    processed_row_count: u32,
    app_row_count: u32,
    screen_row_count: u32,
    duplicate_timestamps_corrected: u32,
}

#[wasm_bindgen]
impl PipelineV2Handle {
    /// Returns a copy of the app CSV bytes as a Uint8Array. The internal
    /// buffer is *not* released; call `take_app_bytes` if you want move
    /// semantics (frees Rust memory).
    pub fn app_bytes(&self) -> Vec<u8> {
        self.app_csv.clone()
    }
    pub fn screen_bytes(&self) -> Vec<u8> {
        self.screen_csv.clone()
    }
    pub fn take_app_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.app_csv)
    }
    pub fn take_screen_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.screen_csv)
    }
    #[wasm_bindgen(getter)]
    pub fn original_row_count(&self) -> u32 {
        self.original_row_count
    }
    #[wasm_bindgen(getter)]
    pub fn processed_row_count(&self) -> u32 {
        self.processed_row_count
    }
    #[wasm_bindgen(getter)]
    pub fn app_row_count(&self) -> u32 {
        self.app_row_count
    }
    #[wasm_bindgen(getter)]
    pub fn screen_row_count(&self) -> u32 {
        self.screen_row_count
    }
    #[wasm_bindgen(getter)]
    pub fn duplicate_timestamps_corrected(&self) -> u32 {
        self.duplicate_timestamps_corrected
    }
}

/// Discover normalized IANA timezones through the Rust ingest boundary. Empty
/// timezone cells use the product's UTC default; rows without an event
/// timestamp are ignored exactly as they are by preprocessing.
#[wasm_bindgen]
pub fn discover_timezones_v2(csv_bytes: &[u8]) -> Result<Vec<String>, JsValue> {
    discover_timezones_v2_native(csv_bytes).map_err(|error| JsValue::from_str(&error))
}

pub fn discover_timezones_v2_native(csv_bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut timezones = BTreeSet::new();
    for record in parse_csv_to_records(csv_bytes) {
        let timestamp = record
            .get("event_timestamp")
            .map(|value| value.trim())
            .unwrap_or_default();
        if timestamp.is_empty() {
            continue;
        }
        parse_chronicle_timestamp_ns(timestamp)
            .ok_or_else(|| format!("Invalid event_timestamp: {timestamp}"))?;
        let timezone = record
            .get("timezone")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("UTC");
        timezone
            .parse::<Tz>()
            .map_err(|error| format!("invalid timezone {timezone}: {error}"))?;
        timezones.insert(timezone.to_string());
    }
    Ok(timezones.into_iter().collect())
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn process_full_pipeline_v2(
    csv_bytes: &[u8],
    options_json: &str,
    filter_csv_bytes: &[u8],
    apps_forcing_csv_bytes: &[u8],
    codebook_csv_bytes: &[u8],
) -> Result<PipelineV2Handle, JsValue> {
    let options: PipelineV2OptionsJson = serde_json::from_str(options_json)
        .map_err(|e| JsValue::from_str(&format!("invalid options json: {e}")))?;
    let options = options.into_pipeline_options();
    let result = run_pipeline_v2(
        csv_bytes,
        &options,
        filter_csv_bytes,
        apps_forcing_csv_bytes,
        codebook_csv_bytes,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(PipelineV2Handle {
        app_csv: result.app_csv_bytes,
        screen_csv: result.screen_csv_bytes,
        original_row_count: result.original_row_count,
        processed_row_count: result.processed_row_count,
        app_row_count: result.app_row_count,
        screen_row_count: result.screen_row_count,
        duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
    })
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
    let tz: Tz = opts
        .timezone
        .parse()
        .map_err(|e| format!("tz {}: {e}", opts.timezone))?;
    let interaction_remap = opts
        .interaction_type_remap
        .iter()
        .filter_map(|entry| {
            let (from, to) = entry.split_once("=>")?;
            let from = from.trim();
            let to = to.trim();
            if from.is_empty() || to.is_empty() {
                None
            } else {
                Some((from.to_string(), to.to_string()))
            }
        })
        .collect::<BTreeMap<_, _>>();
    step_checkpoints.value("parse_remap_config", &interaction_remap)?;

    let mut terminated = Vec::new();
    let csv_bytes = if csv_bytes.ends_with(b"\n") {
        csv_bytes
    } else {
        terminated.reserve(csv_bytes.len() + 1);
        terminated.extend_from_slice(csv_bytes);
        terminated.push(b'\n');
        &terminated
    };
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = csv_bytes;

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                continue;
            }
            ReadFieldResult::OutputFull => {
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = std::str::from_utf8(&field_buf[..n_out])
                    .unwrap_or("")
                    .to_string();
                headers.push(s);
                if record_end {
                    break;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let mut col_idx_of: HashMap<&str, usize> = HashMap::new();
    for (i, h) in headers.iter().enumerate() {
        col_idx_of.insert(h.as_str(), i);
    }
    let h_event = col_idx_of.get("event_timestamp").copied();
    let h_tz = col_idx_of.get("timezone").copied();
    let h_pkg = col_idx_of.get("app_package_name").copied();
    let h_int = col_idx_of.get("interaction_type").copied();
    let h_label = col_idx_of.get("application_label").copied();
    let h_study = col_idx_of.get("study_id").copied();
    let h_pid = col_idx_of.get("participant_id").copied();
    let h_user = col_idx_of.get("username").copied();

    let mut row_vals: Vec<String> = vec![String::new(); headers.len()];
    let mut col_idx = 0;
    let mut data_row_number = 0_u32;
    let mut raw_rows: Vec<RawRow> = Vec::with_capacity(1024);
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                continue;
            }
            ReadFieldResult::OutputFull => {
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                if col_idx < row_vals.len() {
                    let s = std::str::from_utf8(&field_buf[..n_out]).unwrap_or("");
                    row_vals[col_idx].clear();
                    row_vals[col_idx].push_str(s);
                }
                col_idx += 1;
                if record_end {
                    data_row_number += 1;
                    let get = |slot: Option<usize>| -> &str {
                        slot.and_then(|i| row_vals.get(i))
                            .map(String::as_str)
                            .unwrap_or("")
                    };
                    raw_rows.push(RawRow {
                        source_data_row: data_row_number,
                        event_timestamp: get(h_event).trim().to_string(),
                        timezone: get(h_tz).trim().to_string(),
                        app_package_name: get(h_pkg).trim().to_string(),
                        interaction_type: get(h_int).trim().to_string(),
                        application_label: get(h_label).trim().to_string(),
                        study_id: get(h_study).trim().to_string(),
                        participant_id: get(h_pid).trim().to_string(),
                        username: get(h_user).trim().to_string(),
                    });
                    for s in row_vals.iter_mut() {
                        s.clear();
                    }
                    col_idx = 0;
                }
            }
            ReadFieldResult::End => break,
        }
    }
    step_checkpoints.value("csv_parse", &raw_rows)?;

    let raw_rows = raw_rows
        .into_iter()
        .filter(|row| !row.event_timestamp.is_empty())
        .collect::<Vec<_>>();
    step_checkpoints.value("drop_empty_timestamp", &raw_rows)?;

    let possible_device_model = if raw_rows
        .iter()
        .any(|r| AMAZON_APPS.iter().any(|p| r.app_package_name.contains(*p)))
    {
        "Amazon Fire".to_string()
    } else {
        "Android".to_string()
    };
    step_checkpoints.value("detect_device_model", &possible_device_model)?;
    step_checkpoints.value("resolve_preproc_datetime", &opts.datetime_of_preprocessing)?;

    let mut rows: Vec<Row> = Vec::with_capacity(raw_rows.len());
    for (idx, raw) in raw_rows.into_iter().enumerate() {
        let event_ns = parse_chronicle_timestamp_ns(&raw.event_timestamp)
            .ok_or_else(|| format!("Invalid event_timestamp: {}", raw.event_timestamp))?;
        let tz_str = if raw.timezone.is_empty() {
            "UTC".to_string()
        } else {
            raw.timezone
        };
        let username = raw.username.replace("Target child", "Target Child");
        // Product semantics: a custom exact remap has precedence over the
        // built-in Android interaction-type map, and later duplicate entries
        // win when the option list is collected above.
        let interaction = interaction_remap
            .get(&raw.interaction_type)
            .cloned()
            .unwrap_or_else(|| normalize_interaction_type_local(&raw.interaction_type).to_string());
        let mut row = Row {
            source_data_rows: SourceDataRows::single(raw.source_data_row),
            lineage_searches: Vec::new(),
            study_id: raw.study_id,
            participant_id: raw.participant_id,
            possible_device_model: possible_device_model.clone(),
            username,
            application_label: raw.application_label,
            interaction_type: interaction,
            app_package_name: raw.app_package_name,
            event_timestamp_ns: event_ns,
            timezone: tz_str.clone(),
            data_time_gap_hours: 0.0,
            date: String::new(),
            day: 0,
            weekday_mf: 0,
            weekday_mth: 0,
            weekday_su_th: 0,
            hour: 0,
            quarter: 0,
            start_timestamp_ns: None,
            stop_timestamp_ns: None,
            duration_seconds: None,
            duration_minutes: None,
            screen_usage_end_reason: None,
            screen_usage_end_reason_confidence: None,
            screen_usage_stop_event_type: None,
            screen_usage_last_activity_timestamp_ns: None,
            screen_usage_tail_gap_seconds: None,
            screen_usage_foreground_app_package: None,
            screen_usage_apps_forcing_screen_open_label: None,
            screen_usage_lock_screen_only: None,
            any_app_usage_flags: "[]".to_string(),
            valid_app_new_engage_30s: 0,
            valid_app_new_engage_custom: 0,
            valid_app_switched_app: 0,
            valid_app_usage_time_gap_hours: 0.0,
            any_app_new_engage_30s: 0,
            any_app_new_engage_custom: 0,
            any_app_switched_app: 0,
            any_app_usage_time_gap_hours: 0.0,
            genre_id_scraped: None,
            broad_app_category: None,
            codebook_fields: empty_codebook_fields(),
            codebook_genre_fields_cleared: false,
            index: idx,
            usage_layer: None,
        };
        let row_tz: Tz = row.timezone.parse().unwrap_or(tz);
        populate_time_columns(&mut row, row_tz);
        rows.push(row);
    }
    step_checkpoints.rows("build_canonical_rows", &rows);

    rows.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });
    step_checkpoints.rows("stable_sort", &rows);
    let available_timezones = rows
        .iter()
        .map(|row| row.timezone.as_str())
        .collect::<BTreeSet<_>>();
    step_checkpoints.value("collect_timezones", &available_timezones)?;

    Ok((rows, opts.timezone.clone()))
}

#[derive(serde::Serialize)]
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
    let mut seen = HashMap::<(String, i64, String, String), usize>::with_capacity(rows.len());
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

fn unalign_duplicate_timestamps(mut rows: Vec<Row>, opts: &PipelineV2Options) -> Vec<Row> {
    if rows.len() <= 1 {
        return rows;
    }
    let mut stop_types: AHashSet<&str> = AHashSet::new();
    for v in &opts.same_app_stop_types {
        stop_types.insert(v.as_str());
    }
    for v in &opts.other_stop_types {
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
                updated.event_timestamp_ns -= offset;
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
        if i == 0 {
            rows[i].data_time_gap_hours = 0.0;
        } else {
            let delta_ns = rows[i].event_timestamp_ns - rows[i - 1].event_timestamp_ns;
            // (Number(delta_ns) / 3.6e12).toFixed(2) -> parse back to f64
            let raw = (delta_ns as f64) / 3_600_000_000_000.0;
            // ECMAScript ToFixed(2) — must match V8 byte-for-byte.
            let fixed_str = ecma_to_fixed(raw, 2);
            let rounded: f64 = fixed_str.parse().unwrap_or(0.0);
            // JS `(x || 0)` -> 0 if NaN or 0; otherwise rounded.
            let final_v = if rounded == 0.0 || rounded.is_nan() {
                0.0
            } else {
                rounded
            };
            rows[i].data_time_gap_hours = final_v;
        }
    }
    rows
}

/// ECMAScript Number.prototype.toFixed(fractionDigits) — string form.
/// Spec: pick integer n such that |n/10^f - x| is minimised; on ties pick
/// the larger n. (Round-half-away-from-zero on the exact IEEE 754 value.)
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

fn is_all_zeros(s: &str) -> bool {
    s.chars().all(|c| c == '0' || c == '.')
}

/// Round a positive decimal string ("21.62500000000000124...") to `frac_digits`
/// fractional digits, using round-half-away-from-zero on the *exact* string
/// value. The string is expected to have plenty of trailing digits.
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
        let labels = match filter_map.get(&row.app_package_name) {
            Some(s) => s,
            None => continue,
        };
        if !labels.is_empty() && !labels.contains(&row.application_label) {
            continue;
        }
        row.interaction_type = match row.interaction_type.as_str() {
            ACTIVITY_RESUMED => FILTERED_RESUMED.to_string(),
            ACTIVITY_PAUSED => FILTERED_PAUSED.to_string(),
            ACTIVITY_STOPPED => FILTERED_STOPPED.to_string(),
            "Activity Destroyed" => "Filtered App Destroyed".to_string(),
            _ => row.interaction_type.clone(),
        };
    }
    rows
}

fn factorize(values: &[String]) -> Vec<i32> {
    let mut lookup: HashMap<&str, i32> = HashMap::new();
    let mut codes = Vec::with_capacity(values.len());
    for v in values {
        let next = lookup.len() as i32;
        let code = *lookup.entry(v.as_str()).or_insert(next);
        codes.push(code);
    }
    codes
}

fn lineage_search_suffix_digest(
    row: &Row,
    event_index: usize,
    next_digest: Option<&str>,
) -> String {
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
            checkpoint_digest_field(&mut hasher, digest.as_bytes());
        }
        None => {
            hasher.update(&[0]);
        }
    }
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn empty_lineage_search_suffix_digest(event_index: u32) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&event_index.to_le_bytes());
    hasher.update(&0_u32.to_le_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn lineage_search_range_digest(
    suffix_digests: &[String],
    start_event_index: u32,
    end_event_index_exclusive: u32,
) -> String {
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
    format!("blake3:{}", hasher.finalize().to_hex())
}

#[allow(clippy::too_many_arguments)]
fn process_usage_rows(
    rows: Vec<Row>,
    resumed_type: &str,
    paused_type: &str,
    usage_type: &str,
    stopped_type: &str,
    same_stop_types: &AHashSet<String>,
    other_stop_types: &AHashSet<String>,
    background_apps: &AHashSet<String>,
    filtered_packages: &AHashSet<String>,
    opts: &PipelineV2Options,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let n = rows.len();
    let pkgs: Vec<String> = rows.iter().map(|r| r.app_package_name.clone()).collect();
    let app_codes = factorize(&pkgs);
    let timestamps: Vec<i64> = rows.iter().map(|r| r.event_timestamp_ns).collect();
    let mut resumed = vec![false; n];
    let mut same_stop = vec![false; n];
    let mut other_stop = vec![false; n];
    let mut stopped = vec![false; n];
    for i in 0..n {
        let it = rows[i].interaction_type.as_str();
        let is_background = background_apps.contains(&rows[i].app_package_name);
        if it == resumed_type {
            resumed[i] = true;
        }
        if if is_background {
            it == resumed_type || it == stopped_type
        } else {
            same_stop_types.contains(it)
        } {
            same_stop[i] = true;
        }
        // Phase 1: when model_concurrent_usage is on, every app session runs to
        // its own stop event, so other-app resumes are not treated as stops.
        if !opts.model_concurrent_usage && other_stop_types.contains(it) {
            other_stop[i] = true;
        }
        if !is_background && it == stopped_type {
            stopped[i] = true;
        }
    }
    let match_options = _rust_app_usage_matcher::MatchOptions {
        allow_stop_event_reuse: opts.allow_stop_event_reuse,
        use_activity_stopped_as_fallback: opts.use_activity_stopped_as_fallback,
        apply_threshold_to_fallback: opts.apply_threshold_to_fallback,
        long_duration_threshold_ns: opts.long_duration_threshold_ns,
    };
    let background: Vec<bool> = rows
        .iter()
        .map(|row| background_apps.contains(&row.app_package_name))
        .collect();
    step_checkpoints.value(
        "build_matcher_input",
        &serde_json::json!({
            "appCodes": &app_codes,
            "timestamps": &timestamps,
            "resumed": &resumed,
            "sameStop": &same_stop,
            "otherStop": &other_stop,
            "stopped": &stopped,
            "background": &background,
        }),
    )?;
    let result = _rust_app_usage_matcher::match_app_usage_update_indices_with_proximity_core(
        &app_codes,
        &timestamps,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        &background,
        match_options,
        opts.proximity_interval_ns,
    )
    .map_err(|e| format!("matcher: {e}"))?;
    step_checkpoints.value(
        "run_matcher",
        &serde_json::json!({
            "startIndices": &result.start_indices,
            "stopStartIndices": &result.stop_start_indices,
            "stopEventIndices": &result.stop_event_indices,
            "missingIndices": &result.missing_indices,
        }),
    )?;

    let mut next = rows;
    let mut search_suffix_digests = vec![String::new(); next.len() + 1];
    search_suffix_digests[next.len()] = empty_lineage_search_suffix_digest(next.len() as u32);
    for index in (0..next.len()).rev() {
        search_suffix_digests[index] = lineage_search_suffix_digest(
            &next[index],
            index,
            Some(&search_suffix_digests[index + 1]),
        );
    }
    for &si in &result.start_indices {
        next[si].start_timestamp_ns = Some(next[si].event_timestamp_ns);
    }
    for (k, &si) in result.stop_start_indices.iter().enumerate() {
        let stop_idx = result.stop_event_indices[k];
        let lower = si.min(stop_idx);
        let upper = si.max(stop_idx);
        let stop_source_rows = next[stop_idx].source_data_rows.clone();
        next[si].source_data_rows.merge(&stop_source_rows);
        let search_start_event_index = (lower + 1) as u32;
        let search_end_event_index_exclusive = (upper + 1) as u32;
        let start_participant_id = next[si].participant_id.clone();
        next[si].lineage_searches.push(LineageSearchEvidence {
            protocol_version: "chronicle-lineage-search/v1",
            reason: "selected-qualifying-stop",
            index_space: "pipeline-event-order",
            start_participant_id,
            start_event_index: search_start_event_index,
            end_event_index_exclusive: search_end_event_index_exclusive,
            candidate_event_count: search_end_event_index_exclusive
                .saturating_sub(search_start_event_index),
            candidate_chain_digest: lineage_search_range_digest(
                &search_suffix_digests,
                search_start_event_index,
                search_end_event_index_exclusive,
            ),
        });
        next[si].stop_timestamp_ns = Some(next[stop_idx].event_timestamp_ns);
    }
    let missing_indices = result
        .missing_indices
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let search_end_event_index_exclusive = next.len() as u32;
    for (index, row) in next.iter_mut().enumerate() {
        if missing_indices.contains(&index) {
            let search_start_event_index = (index + 1) as u32;
            let start_participant_id = row.participant_id.clone();
            row.lineage_searches.push(LineageSearchEvidence {
                protocol_version: "chronicle-lineage-search/v1",
                reason: "no-qualifying-stop",
                index_space: "pipeline-event-order",
                start_participant_id,
                start_event_index: search_start_event_index,
                end_event_index_exclusive: search_end_event_index_exclusive,
                candidate_event_count: search_end_event_index_exclusive
                    .saturating_sub(search_start_event_index),
                candidate_chain_digest: lineage_search_range_digest(
                    &search_suffix_digests,
                    search_start_event_index,
                    search_end_event_index_exclusive,
                ),
            });
            row.interaction_type = END_OF_USAGE_MISSING.to_string();
            row.stop_timestamp_ns = None;
            row.duration_seconds = None;
            row.duration_minutes = None;
            if filtered_packages.contains(&row.app_package_name) {
                row.start_timestamp_ns = None;
            }
        }
    }
    step_checkpoints.rows("apply_matcher_output", &next);

    let mut out: Vec<Row> = next
        .into_iter()
        .filter(|r| r.interaction_type != paused_type)
        .filter(|r| {
            r.interaction_type != resumed_type
                || (r.start_timestamp_ns.is_some() && r.stop_timestamp_ns.is_some())
        })
        .map(|mut r| {
            if r.interaction_type == resumed_type {
                r.interaction_type = usage_type.to_string();
                if usage_type == FILTERED_APP_USAGE {
                    r.start_timestamp_ns = None;
                    r.stop_timestamp_ns = None;
                    r.duration_seconds = None;
                    r.duration_minutes = None;
                } else {
                    let start = r.start_timestamp_ns.unwrap();
                    let stop = r.stop_timestamp_ns.unwrap();
                    let dur_s = (stop - start) as f64 / 1_000_000_000.0;
                    // Null (but keep) sessions shorter than minimum_usage_duration,
                    // matching browserPipeline.ts processUsageRows and the SSOT
                    // contract. When concurrent usage is on these durations are
                    // recomputed per sub-interval in Phase 2 below.
                    if opts.minimum_usage_duration > 0.0 && dur_s < opts.minimum_usage_duration {
                        r.duration_seconds = None;
                        r.duration_minutes = None;
                    } else {
                        r.duration_seconds = Some(dur_s);
                        r.duration_minutes = Some(dur_s / 60.0);
                    }
                }
            }
            r
        })
        .collect();
    step_checkpoints.rows("relabel_usage_with_floor", &out);

    if !filtered_packages.is_empty() {
        for row in &mut out {
            if !filtered_packages.contains(&row.app_package_name) {
                continue;
            }
            if row.interaction_type == APP_USAGE && background_apps.contains(&row.app_package_name)
            {
                row.interaction_type = FILTERED_APP_BACKGROUND_USAGE.into();
                continue;
            }
            if row.interaction_type == APP_USAGE {
                row.interaction_type = FILTERED_APP_USAGE.into();
                row.duration_seconds = None;
                row.duration_minutes = None;
                continue;
            }
            if row.interaction_type == ACTIVITY_STOPPED {
                row.interaction_type = FILTERED_STOPPED.into();
            }
            row.start_timestamp_ns = None;
            row.stop_timestamp_ns = None;
            row.duration_seconds = None;
            row.duration_minutes = None;
        }
    }
    step_checkpoints.rows("junk_downstream_mark", &out);

    out.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });
    step_checkpoints.rows("sort_episodes", &out);

    // Phase 2: split overlapping sessions and expand each into primary/secondary
    // sub-interval rows. Only applied when model_concurrent_usage is on and
    // this is the App Usage path (not Filtered App Usage — that path has no
    // timing to split because timing is cleared above).
    if (opts.model_concurrent_usage || !background_apps.is_empty())
        && usage_type != FILTERED_APP_USAGE
    {
        let app_usage_indices: Vec<usize> = out
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                r.interaction_type == usage_type && !filtered_packages.contains(&r.app_package_name)
            })
            .map(|(i, _)| i)
            .collect();

        let starts: Vec<i64> = app_usage_indices
            .iter()
            .map(|&i| out[i].start_timestamp_ns.unwrap_or(0))
            .collect();
        let stops: Vec<i64> = app_usage_indices
            .iter()
            .map(|&i| out[i].stop_timestamp_ns.unwrap_or(0))
            .collect();

        let layered = split_overlapping_sessions(&starts, &stops)
            .map_err(|e| format!("split_overlapping_sessions: {e}"))?;

        // Build expanded rows from the layered output, replacing the original
        // app-usage rows. Non-app-usage rows are passed through unchanged.
        let mut expanded: Vec<Row> = out
            .iter()
            .filter(|r| {
                r.interaction_type != usage_type || filtered_packages.contains(&r.app_package_name)
            })
            .cloned()
            .collect();

        for ls in &layered {
            let source_idx = app_usage_indices[ls.session_index];
            let mut row = out[source_idx].clone();
            let start = ls.start_ns;
            let stop = ls.stop_ns;
            let dur_s = (stop - start) as f64 / 1_000_000_000.0;
            row.start_timestamp_ns = Some(start);
            row.stop_timestamp_ns = Some(stop);
            // Concurrent-usage option (default off): null — but keep — split
            // sub-intervals shorter than minimum_usage_duration.
            let below_threshold = opts.apply_minimum_usage_duration_to_concurrent_subintervals
                && opts.minimum_usage_duration > 0.0
                && dur_s < opts.minimum_usage_duration;
            if below_threshold {
                row.duration_seconds = None;
                row.duration_minutes = None;
            } else {
                row.duration_seconds = Some(dur_s);
                row.duration_minutes = Some(dur_s / 60.0);
            }
            row.usage_layer = Some(match ls.layer {
                UsageLayer::Primary => "primary".to_string(),
                UsageLayer::Secondary => "secondary".to_string(),
            });
            expanded.push(row);
        }
        out = expanded;
    }

    out.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });
    step_checkpoints.rows("split_concurrent", &out);
    Ok(out)
}

fn run_app_usage_algorithm(
    mut rows: Vec<Row>,
    opts: &PipelineV2Options,
    background_apps: &AHashSet<String>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let filtered_packages: AHashSet<String> = rows
        .iter()
        .filter(|row| {
            matches!(
                row.interaction_type.as_str(),
                FILTERED_RESUMED
                    | FILTERED_PAUSED
                    | FILTERED_STOPPED
                    | "Filtered App Destroyed"
                    | FILTERED_APP_USAGE
                    | FILTERED_APP_BACKGROUND_USAGE
            )
        })
        .map(|row| row.app_package_name.clone())
        .collect();
    let filtered_package_names = filtered_packages.iter().cloned().collect::<BTreeSet<_>>();
    step_checkpoints.value("compute_junk_packages", &filtered_package_names)?;
    for row in &mut rows {
        row.interaction_type = match row.interaction_type.as_str() {
            FILTERED_RESUMED => ACTIVITY_RESUMED,
            FILTERED_PAUSED => ACTIVITY_PAUSED,
            FILTERED_STOPPED => ACTIVITY_STOPPED,
            "Filtered App Destroyed" => "Activity Destroyed",
            other => other,
        }
        .to_string();
    }
    step_checkpoints.rows("junk_blind_fold", &rows);
    if !rows
        .iter()
        .any(|r| r.interaction_type == ACTIVITY_RESUMED || r.interaction_type == ACTIVITY_PAUSED)
    {
        return Err("No valid app usage data during the study period".to_string());
    }
    let same_stop: AHashSet<String> = opts.same_app_stop_types.iter().cloned().collect();
    let other_stop: AHashSet<String> = opts.other_stop_types.iter().cloned().collect();
    let next = process_usage_rows(
        rows,
        ACTIVITY_RESUMED,
        ACTIVITY_PAUSED,
        APP_USAGE,
        ACTIVITY_STOPPED,
        &same_stop,
        &other_stop,
        background_apps,
        &filtered_packages,
        opts,
        step_checkpoints,
    )?;
    Ok(next)
}

fn join_codebook(
    rows: &mut [Row],
    opts: &PipelineV2Options,
    codebook_map: &HashMap<String, CodebookEntry>,
) {
    if !opts.use_app_codebook {
        return;
    }
    for row in rows.iter_mut() {
        row.codebook_fields = codebook_map
            .get(&row.app_package_name)
            .map(|entry| entry.fields.clone())
            .unwrap_or_else(empty_codebook_fields);
    }
}

fn derive_broad_category(rows: &mut [Row], opts: &PipelineV2Options) {
    if !opts.use_app_codebook {
        return;
    }
    let bcm_play_store_broad_idx = codebook_col_index("bcm_play_store_broad_app_category").unwrap();
    let usc_broad_idx = codebook_col_index("usc_broad_app_category").unwrap();
    let babyemu_broad_idx = codebook_col_index("babyemu_broad_app_category").unwrap();
    let bcm_broad_idx = codebook_col_index("bcm_cnrc_heuristic_category").unwrap();

    for row in rows.iter_mut() {
        let candidates = [
            row.codebook_fields[bcm_play_store_broad_idx].as_deref(),
            row.codebook_fields[usc_broad_idx].as_deref(),
            row.codebook_fields[babyemu_broad_idx].as_deref(),
            row.codebook_fields[bcm_broad_idx].as_deref(),
            row.broad_app_category.as_deref(),
        ];
        let chosen = candidates
            .iter()
            .find_map(|candidate| candidate.filter(|value| !value.trim().is_empty()))
            .map(String::from);
        row.broad_app_category = Some(chosen.unwrap_or_else(|| "Unknown".to_string()));
    }
}

fn collapse_genre(rows: &mut [Row], opts: &PipelineV2Options) {
    if !opts.use_app_codebook {
        return;
    }
    let babyemu_scraped_idx = codebook_col_index("babyemu_genreId_scraped").unwrap();
    let babyemu_manual_idx = codebook_col_index("babyemu_genreId_manual").unwrap();
    let bcm_play_store_genre_idx = codebook_col_index("bcm_play_store_genreId").unwrap();
    let usc_genre_idx = codebook_col_index("usc_genreId").unwrap();

    for row in rows.iter_mut() {
        let genre_values = [
            babyemu_scraped_idx,
            babyemu_manual_idx,
            bcm_play_store_genre_idx,
            usc_genre_idx,
        ]
        .into_iter()
        .filter_map(|index| row.codebook_fields[index].as_ref())
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
        if genre_values.is_empty() {
            row.genre_id_scraped = Some("Unknown".to_string());
            continue;
        }
        let unique = genre_values
            .iter()
            .map(String::as_str)
            .collect::<AHashSet<_>>();
        if unique.len() == 1 {
            row.genre_id_scraped = Some(genre_values[0].clone());
            row.codebook_genre_fields_cleared = true;
        } else {
            row.genre_id_scraped = None;
            row.codebook_genre_fields_cleared = false;
        }
    }
}

fn add_app_usage_detail_columns(rows: &mut [Row], opts: &PipelineV2Options) {
    let any_indices: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            if (r.interaction_type == APP_USAGE || r.interaction_type == FILTERED_APP_USAGE)
                && r.usage_layer.as_deref() != Some("secondary")
            {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    let valid_indices: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            if r.interaction_type == APP_USAGE && r.usage_layer.as_deref() != Some("secondary") {
                Some(i)
            } else {
                None
            }
        })
        .collect();

    fn apply_metrics(
        rows: &mut [Row],
        indices: &[usize],
        custom_dur: f64,
        update: fn(&mut Row, i32, i32, i32, f64),
    ) {
        if indices.is_empty() {
            return;
        }
        update(&mut rows[indices[0]], 1, 1, 0, 0.0);
        for k in 1..indices.len() {
            let cur_idx = indices[k];
            let prev_idx = indices[k - 1];
            let cur_start = rows[cur_idx].start_timestamp_ns.unwrap_or(i64::MIN);
            let prev_stop = rows[prev_idx].stop_timestamp_ns.unwrap_or(i64::MIN);
            // Match JS BigInt.asIntN(64, ...) — this is just i64 wrapping, no special handling needed
            // since we already operate in i64; subtraction wraps modulo 2^64 in i64 arithmetic via wrapping_sub.
            let gap_delta_ns = cur_start.wrapping_sub(prev_stop);
            let gap_secs = gap_delta_ns as f64 / 1_000_000_000.0;
            let cur_pkg = rows[cur_idx].app_package_name.clone();
            let prev_pkg = rows[prev_idx].app_package_name.clone();
            let switched = if cur_pkg != prev_pkg { 1 } else { 0 };
            let engage30 = if gap_secs > 30.0 { 1 } else { 0 };
            let engage_custom = if gap_secs > custom_dur { 1 } else { 0 };
            let gap_hours = gap_secs / 3600.0;
            update(
                &mut rows[cur_idx],
                engage30,
                engage_custom,
                switched,
                gap_hours,
            );
        }
    }

    apply_metrics(
        rows,
        &any_indices,
        opts.custom_app_engagement_duration,
        |row, e30, ec, sw, gh| {
            row.any_app_new_engage_30s = e30;
            row.any_app_new_engage_custom = ec;
            row.any_app_switched_app = sw;
            row.any_app_usage_time_gap_hours = gh;
        },
    );
    apply_metrics(
        rows,
        &valid_indices,
        opts.custom_app_engagement_duration,
        |row, e30, ec, sw, gh| {
            row.valid_app_new_engage_30s = e30;
            row.valid_app_new_engage_custom = ec;
            row.valid_app_switched_app = sw;
            row.valid_app_usage_time_gap_hours = gh;
        },
    );
}

fn mark_app_usage_flags(rows: &mut [Row], opts: &PipelineV2Options) {
    let mut gap_thresholds = opts.long_data_time_gap_thresholds.clone();
    gap_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let mut dur_thresholds = opts.long_usage_duration_thresholds.clone();
    dur_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    for row in rows.iter_mut() {
        let mut flags: Vec<String> = Vec::new();
        if let Some(&t) = gap_thresholds
            .iter()
            .find(|&&t| row.data_time_gap_hours >= t)
        {
            flags.push(format!(">{}-HR TIME GAP", format_threshold(t)));
        }
        let dur_hours = row.duration_minutes.map(|m| m / 60.0).unwrap_or(0.0);
        if let Some(&t) = dur_thresholds.iter().find(|&&t| dur_hours >= t) {
            flags.push(format!(">{}-HR APP USAGE", format_threshold(t)));
        }
        row.any_app_usage_flags = if flags.is_empty() {
            "[]".to_string()
        } else {
            format!("['{}']", flags.join("', '"))
        };
    }
}

/// JS Number(threshold).toString() — integers print without decimals.
fn format_threshold(t: f64) -> String {
    js_number_to_string(t)
}

fn clear_filtered_usage_timing(rows: &mut [Row]) {
    for row in rows.iter_mut() {
        if row.interaction_type == FILTERED_APP_USAGE {
            row.start_timestamp_ns = None;
            row.stop_timestamp_ns = None;
            row.duration_seconds = None;
            row.duration_minutes = None;
        }
    }
}

fn remove_selected_interaction_types(rows: Vec<Row>, opts: &PipelineV2Options) -> Vec<Row> {
    if opts.interaction_types_to_remove.is_empty() {
        return rows;
    }
    let threshold = opts
        .long_data_time_gap_thresholds
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let remove_set: AHashSet<&str> = opts
        .interaction_types_to_remove
        .iter()
        .map(|s| s.as_str())
        .collect();
    rows.into_iter()
        .filter(|r| {
            !remove_set.contains(r.interaction_type.as_str()) || r.data_time_gap_hours >= threshold
        })
        .collect()
}

fn add_no_activity_placeholder_rows(mut app_rows: Vec<Row>, raw_rows: &[Row]) -> Vec<Row> {
    let mut usage_days: AHashSet<(String, String)> = AHashSet::new();
    for row in &app_rows {
        if row.interaction_type == APP_USAGE {
            usage_days.insert((row.participant_id.clone(), row.date.clone()));
        }
    }

    // Preserve JavaScript Map insertion order: raw rows are event-sorted, so
    // samples are emitted in first-observed participant/day order.
    let mut sample_index: HashMap<(String, String), usize> = HashMap::new();
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
        populate_time_columns(&mut sample, timezone);
        app_rows.push(sample);
    }
    app_rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    app_rows
}

#[derive(Debug, Clone, serde::Serialize)]
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
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() == 3 {
        let month = parts[0]
            .parse::<u8>()
            .map_err(|_| format!("unparseable date: {value}"))?;
        let day = parts[1]
            .parse::<u8>()
            .map_err(|_| format!("unparseable date: {value}"))?;
        let year = parts[2]
            .parse::<u16>()
            .map_err(|_| format!("unparseable date: {value}"))?;
        return Ok(format!("{year:04}-{month:02}-{day:02}"));
    }
    Err(format!("unparseable date: {value}"))
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
        )?;
        let end_date = normalize_support_date(
            row.get("end_date")
                .ok_or("Study dates file: missing required column end_date")?,
        )?;
        if end_date < start_date {
            return Err(format!(
                "Study dates file: window for {participant_id} ends ({end_date}) before it starts ({start_date})"
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

#[derive(Debug, Clone, serde::Serialize)]
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
            .find(|window| window.participant_id == row.participant_id);
        let window = exact.or_else(|| {
            let id = numerical_id(&row.participant_id)?;
            windows
                .iter()
                .find(|window| numerical_id(&window.participant_id) == Some(id))
        });
        resolved.push(ResolvedParticipantWindow {
            participant_id: row.participant_id.clone(),
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
                .is_none_or(|window| row.date >= window.start_date && row.date <= window.end_date)
        })
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(rows.len());
    (rows, dropped, participants_without_window)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum SharingStatus {
    Shared,
    NonShared,
}

#[derive(Debug, Clone, serde::Serialize)]
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
        let mut available: Vec<_> = first.keys().cloned().collect();
        available.sort();
        Err(format!(
            "{file_label}: missing required column(s) {}. Found: {}",
            missing.join(", "),
            available.join(", ")
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
                    "Device sharing file: unknown sharing_status {raw:?} for {participant_id} (expected \"Shared\" or \"Non-Shared\")"
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
    let text = value.trim();
    if text.len() >= 10 && text.bytes().all(|byte| byte.is_ascii_digit()) {
        let parsed = text.parse::<i64>().map_err(|_| {
            format!("Survey attribution file: unparseable event_timestamp {value:?}")
        })?;
        return if text.len() >= 19 {
            Ok(parsed)
        } else if text.len() >= 13 {
            parsed.checked_mul(1_000_000).ok_or_else(|| {
                format!("Survey attribution file: event_timestamp overflow {value:?}")
            })
        } else {
            parsed.checked_mul(1_000_000_000).ok_or_else(|| {
                format!("Survey attribution file: event_timestamp overflow {value:?}")
            })
        };
    }
    parse_chronicle_timestamp_ns(text)
        .ok_or_else(|| format!("Survey attribution file: unparseable event_timestamp {value:?}"))
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
                parse_survey_timestamp_ns(timestamp)?,
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SharingResolution {
    status_by_participant: BTreeMap<String, SharingStatus>,
    shared_participants: Vec<String>,
    non_shared_participants: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
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
            .get(&row.participant_id)
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
                    survey.get(&(row.participant_id.clone(), row.event_timestamp_ns))
                {
                    row.username = format!("{user} (From Survey)");
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
        .map_err(|error| format!("invalid coverage start date {start:?}: {error}"))?;
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .map_err(|error| format!("invalid coverage end date {end:?}: {error}"))?;
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverageDayCheckpoint {
    participant_id: String,
    date: String,
    status: &'static str,
}

#[derive(Debug, serde::Serialize)]
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
                row.participant_id.clone()
            })
            .or_default()
            .insert(row.date.clone());
    }
    raw_dates
}

fn build_day_coverage_csv(
    usage_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    windows: &[StudyWindow],
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let mut usage_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in usage_rows {
        if row.interaction_type == APP_USAGE
            && row.duration_minutes.is_some_and(|value| value > 0.0)
        {
            usage_dates
                .entry(row.participant_id.clone())
                .or_default()
                .insert(row.date.clone());
        }
    }
    let participants: BTreeSet<_> = raw_dates
        .keys()
        .chain(usage_dates.keys())
        .cloned()
        .collect();
    let mut lines = vec!["participant_id,date,status".to_string()];
    let mut coverage = Vec::new();
    for participant_id in participants {
        let raw = raw_dates.get(&participant_id).cloned().unwrap_or_default();
        let used = usage_dates
            .get(&participant_id)
            .cloned()
            .unwrap_or_default();
        let all_dates: BTreeSet<_> = raw.union(&used).cloned().collect();
        let window = if windows.is_empty() {
            None
        } else {
            window_for(&participant_id, windows)
        };
        let spine = if let Some(window) = window {
            inclusive_dates(&window.start_date, &window.end_date)?
        } else if let (Some(start), Some(end)) = (all_dates.first(), all_dates.last()) {
            inclusive_dates(start, end)?
        } else {
            Vec::new()
        };
        for date in &spine {
            let status = if used.contains(date) {
                "usage"
            } else if raw.contains(date) {
                "no_activity"
            } else {
                "no_data"
            };
            lines.push(format!(
                "{},{date},{status}",
                csv_escape_value(&participant_id)
            ));
            coverage.push(CoverageDayCheckpoint {
                participant_id: participant_id.clone(),
                date: date.clone(),
                status,
            });
        }
        for date in all_dates {
            if window.is_some_and(|window| date < window.start_date || date > window.end_date) {
                continue;
            }
            if !spine.contains(&date) {
                return Err(format!(
                    "Day coverage: {participant_id} has data on {date} but the day spine does not cover it."
                ));
            }
        }
    }
    let bytes = lines.join("\n").into_bytes();
    let report = DayCoverageCheckpoint {
        usage_days: coverage.iter().filter(|day| day.status == "usage").count(),
        no_activity_days: coverage
            .iter()
            .filter(|day| day.status == "no_activity")
            .count(),
        no_data_days: coverage
            .iter()
            .filter(|day| day.status == "no_data")
            .count(),
        coverage,
    };
    step_checkpoints.value("build_coverage_table", &report)?;
    Ok((bytes, report.coverage.len() as u32))
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
                format!("Enrolled devices file: invalid device_count {raw:?} for {participant_id}")
            })?
        };
        devices.insert(participant_id.to_string(), count);
    }
    Ok(devices)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceDayCheckpoint {
    participant_id: String,
    date: String,
    sharing_status: &'static str,
    known_minutes: f64,
    unknown_minutes: f64,
    compliance_percent: f64,
    zero_real_usage: bool,
    is_valid: bool,
}

#[derive(Debug, serde::Serialize)]
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
    let mut participants_seen: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut buckets: BTreeMap<(String, String), (f64, f64)> = BTreeMap::new();
    for row in rows {
        participants_seen
            .entry(row.participant_id.clone())
            .or_default()
            .insert(row.date.clone());
        if row.interaction_type != APP_USAGE && row.interaction_type != NON_TARGET_CHILD_APP_USAGE {
            continue;
        }
        let minutes = row.duration_minutes.unwrap_or(0.0);
        let bucket = buckets
            .entry((row.participant_id.clone(), row.date.clone()))
            .or_default();
        if is_null_username(&row.username) || row.username == "None" {
            bucket.1 += minutes;
        } else {
            bucket.0 += minutes;
        }
    }
    let bucket_checkpoint = buckets
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
            "participantsSeen": &participants_seen,
            "buckets": bucket_checkpoint,
        }),
    )?;
    let mut days = Vec::new();
    for (participant_id, dates) in participants_seen {
        let shared = shared_participants.contains(&participant_id);
        for date in dates {
            let (known, unknown) = buckets
                .get(&(participant_id.clone(), date.clone()))
                .copied()
                .unwrap_or_default();
            let total = known + unknown;
            let compliance = if !shared || total <= 0.0 {
                100.0
            } else {
                ((known / total) * 10_000.0).round() / 100.0
            };
            let known = (known * 100.0).round() / 100.0;
            let unknown = (unknown * 100.0).round() / 100.0;
            days.push(ComplianceDayCheckpoint {
                participant_id: participant_id.clone(),
                date,
                sharing_status: if shared { "Shared" } else { "Non-Shared" },
                known_minutes: known,
                unknown_minutes: unknown,
                compliance_percent: compliance,
                zero_real_usage: total <= 0.0,
                is_valid: compliance >= threshold_percent,
            });
        }
    }
    let result = ComplianceResultCheckpoint {
        valid_days: days.iter().filter(|day| day.is_valid).count(),
        invalid_days: days.iter().filter(|day| !day.is_valid).count(),
        zero_usage_days: days.iter().filter(|day| day.zero_real_usage).count(),
        days,
    };
    step_checkpoints.value("score_days", &result)?;

    let mut lines = vec![
        "participant_id,date,sharing_status,known_minutes,unknown_minutes,compliance_percent,zero_real_usage,is_valid,expected_device_count".to_string(),
    ];
    for day in &result.days {
        let expected = enrolled_devices
            .get(&day.participant_id)
            .map(u32::to_string)
            .unwrap_or_default();
        lines.push(format!(
            "{},{date},{},{},{},{},{},{},{}",
            csv_escape_value(&day.participant_id),
            day.sharing_status,
            js_rounded_number(day.known_minutes),
            js_rounded_number(day.unknown_minutes),
            js_rounded_number(day.compliance_percent),
            u8::from(day.zero_real_usage),
            u8::from(day.is_valid),
            expected,
            date = day.date,
        ));
    }
    let row_count = result.days.len() as u32;
    let bytes = lines.join("\n").into_bytes();
    Ok((bytes, row_count))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
enum ScreenCreditState {
    On,
    Off,
}

#[derive(Debug, Clone, serde::Serialize)]
struct ScreenChangePoint {
    timestamp_ns: i64,
    state: ScreenCreditState,
    source_data_rows: SourceDataRows,
}

#[derive(Default, serde::Serialize)]
struct ScreenCreditSubstrate {
    points: BTreeMap<String, Vec<ScreenChangePoint>>,
    boots: BTreeMap<String, Vec<i64>>,
    all_timestamps: BTreeMap<String, Vec<i64>>,
    source_events: BTreeMap<String, Vec<(i64, SourceDataRows)>>,
    #[serde(skip)]
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
        return Err(format!(
            "Screen-gated credit: unmapped interaction type {interaction_type:?} in the raw stream — extend the interaction-type mapping before crediting."
        ));
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
                row.participant_id.clone()
            })
            .or_default()
            .push((
                row.event_timestamp_ns,
                row.interaction_type.clone(),
                row.source_data_rows.clone(),
            ));
    }
    let mut substrate = ScreenCreditSubstrate::default();
    for (participant_id, mut events) in by_participant {
        events.sort_by_key(|event| event.0);
        let mut points = Vec::new();
        let mut last = None;
        for (timestamp_ns, interaction_type, source_data_rows) in &events {
            let state = screen_witness_state(interaction_type)?;
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
            protocol_version: "chronicle-lineage-search/v1",
            reason: "screen-credit-liveness-window",
            index_space: "participant-source-event-order",
            start_participant_id: participant_id.to_string(),
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

#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CreditDecision {
    Passthrough,
    Intervals {
        intervals: Vec<CreditInterval>,
        session_capped: bool,
        no_witness_fallback: bool,
    },
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditEmissionCounts {
    truncated_sessions: usize,
    no_witness_fallbacks: usize,
    fully_dead_sessions: usize,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditReportCheckpoint<'a> {
    sessions: usize,
    credited_rows: usize,
    credited_minutes: f64,
    raw_session_minutes: f64,
    truncated_sessions: usize,
    fully_dead_sessions: usize,
    no_witness_fallbacks: usize,
    screen_incapable_participants: &'a [String],
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

fn apply_screen_gated_credit(
    app_rows: &[Row],
    raw_events: &[Row],
    opts: &PipelineV2Options,
    include_aliases: bool,
    input_row_parts: Option<&[RowCheckpointParts]>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<ScreenCreditOutput, String> {
    let session_count = app_rows.iter().filter(|row| is_credit_session(row)).count();
    let rest_count = app_rows.len() - session_count;
    let (session_rows_digest, rest_rows_digest) = if let Some(parts) = input_row_parts {
        if parts.len() != app_rows.len() {
            return Err(format!(
                "screen-credit checkpoint row-part count drift: {} parts for {} rows",
                parts.len(),
                app_rows.len(),
            ));
        }
        let session_digest = row_parts_sequence_digest(
            session_count,
            app_rows
                .iter()
                .zip(parts)
                .filter_map(|(row, parts)| is_credit_session(row).then_some(parts)),
        );
        let rest_digest = row_parts_sequence_digest(
            rest_count,
            app_rows
                .iter()
                .zip(parts)
                .filter_map(|(row, parts)| (!is_credit_session(row)).then_some(parts)),
        );
        #[cfg(debug_assertions)]
        {
            let sessions = app_rows
                .iter()
                .filter(|row| is_credit_session(row))
                .collect::<Vec<_>>();
            let rest = app_rows
                .iter()
                .filter(|row| !is_credit_session(row))
                .collect::<Vec<_>>();
            assert_eq!(session_digest, row_reference_sequence_digest(&sessions));
            assert_eq!(rest_digest, row_reference_sequence_digest(&rest));
        }
        (session_digest, rest_digest)
    } else {
        let sessions = app_rows
            .iter()
            .filter(|row| is_credit_session(row))
            .collect::<Vec<_>>();
        let rest = app_rows
            .iter()
            .filter(|row| !is_credit_session(row))
            .collect::<Vec<_>>();
        let session_digest = row_reference_sequence_digest(&sessions);
        let rest_digest = row_reference_sequence_digest(&rest);
        (session_digest, rest_digest)
    };
    step_checkpoints.value(
        "partition_credit_sessions",
        &CreditPartitionCheckpoint {
            session_count,
            rest_count,
            session_rows_digest: &session_rows_digest,
            rest_rows_digest: &rest_rows_digest,
        },
    )?;

    let substrate = build_screen_credit_substrate(raw_events)?;
    step_checkpoints.value("build_liveness_substrate", &substrate)?;
    let mut screen_incapable = Vec::new();
    let mut seen_screen_incapable = AHashSet::new();
    for row in app_rows.iter().filter(|row| is_credit_session(row)) {
        let incapable = substrate
            .points
            .get(&row.participant_id)
            .is_none_or(Vec::is_empty)
            || !substrate.capable.contains(&row.participant_id);
        if incapable && seen_screen_incapable.insert(row.participant_id.clone()) {
            screen_incapable.push(row.participant_id.clone());
        }
    }
    step_checkpoints.value("report_screen_incapable", &screen_incapable)?;

    let mut day_apps: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    for row in app_rows.iter().filter(|row| is_credit_session(row)) {
        day_apps
            .entry((row.participant_id.clone(), row.date.clone()))
            .or_default()
            .insert(row.app_package_name.clone());
    }
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
    let tolerance_ns =
        (opts.device_liveness_gap_tolerance_minutes * 60.0).round() as i64 * 1_000_000_000;
    let cap_ns = (opts.credited_session_cap_minutes * 60.0).round() as i64 * 1_000_000_000;
    let auto_lock_ns = opts.auto_lock_bridge_seconds.round() as i64 * 1_000_000_000;
    let alive_spans = substrate
        .all_timestamps
        .iter()
        .map(|(participant_id, timestamps)| {
            let boots = substrate
                .boots
                .get(participant_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            (
                participant_id.as_str(),
                build_alive_spans(timestamps, tolerance_ns, boots),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut decisions = Vec::with_capacity(session_count);
    for row in app_rows.iter().filter(|row| is_credit_session(row)) {
        let (Some(start), Some(raw_end)) = (row.start_timestamp_ns, row.stop_timestamp_ns) else {
            decisions.push(CreditDecision::Passthrough);
            continue;
        };
        if raw_end <= start {
            decisions.push(CreditDecision::Passthrough);
            continue;
        }
        let end = raw_end.min(start.saturating_add(cap_ns));
        let points = substrate
            .points
            .get(&row.participant_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (intervals, no_witness_fallback) =
            if points.is_empty() || !substrate.capable.contains(&row.participant_id) {
                (vec![(start, end)], false)
            } else {
                let participant_alive_spans = alive_spans
                    .get(row.participant_id.as_str())
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let alive = clip_alive_spans(participant_alive_spans, start, end);
                let first_in_window = points.partition_point(|point| point.timestamp_ns < start);
                let has_point = points
                    .get(first_in_window)
                    .is_some_and(|point| point.timestamp_ns <= end);
                if screen_state_at(points, start).is_none() && !has_point {
                    let app_count = day_apps
                        .get(&(row.participant_id.clone(), row.date.clone()))
                        .map(BTreeSet::len)
                        .unwrap_or_default();
                    if app_count >= opts.no_witness_min_day_apps as usize {
                        (alive, true)
                    } else {
                        (Vec::new(), false)
                    }
                } else {
                    let screen = creditable_intervals(points, start, end, auto_lock_ns);
                    (intersect_intervals(&screen, &alive), false)
                }
            };
        decisions.push(CreditDecision::Intervals {
            intervals,
            session_capped: end < raw_end,
            no_witness_fallback,
        });
    }
    step_checkpoints.value(
        "credit_sessions",
        &serde_json::json!({
            "sessionRowsDigest": session_rows_digest,
            "decisions": decisions,
        }),
    )?;
    let raw_session_minutes = app_rows
        .iter()
        .filter(|row| is_credit_session(row))
        .map(|row| row.duration_minutes.unwrap_or(0.0))
        .sum();

    let mut credited = Vec::new();
    let mut emission_counts = CreditEmissionCounts {
        truncated_sessions: 0,
        no_witness_fallbacks: 0,
        fully_dead_sessions: 0,
    };
    for (row, decision) in app_rows
        .iter()
        .filter(|row| is_credit_session(row))
        .zip(decisions)
    {
        let intervals = match decision {
            CreditDecision::Passthrough => {
                credited.push(row.clone());
                continue;
            }
            CreditDecision::Intervals {
                intervals,
                session_capped,
                no_witness_fallback,
            } => {
                if session_capped {
                    emission_counts.truncated_sessions += 1;
                }
                if no_witness_fallback {
                    emission_counts.no_witness_fallbacks += 1;
                }
                intervals
            }
        };
        let before = credited.len();
        let interval_count = intervals.len();
        let mut original_row = Some(row.clone());
        for (interval_index, (interval_start, interval_end)) in intervals.into_iter().enumerate() {
            if interval_end <= interval_start {
                continue;
            }
            let mut credited_row = if interval_index + 1 == interval_count {
                original_row.take().expect("credit source row is available")
            } else {
                original_row
                    .as_ref()
                    .expect("credit source row is available")
                    .clone()
            };
            let (contributors, search) = credit_lineage_contributors(
                &substrate,
                &credited_row.participant_id,
                interval_start,
                interval_end,
                tolerance_ns,
            );
            credited_row.source_data_rows.merge(&contributors);
            if let Some(search) = search {
                credited_row.lineage_searches.push(search);
            }
            let duration_seconds = (interval_end - interval_start) as f64 / 1_000_000_000.0;
            credited_row.start_timestamp_ns = Some(interval_start);
            credited_row.stop_timestamp_ns = Some(interval_end);
            credited_row.event_timestamp_ns = interval_start;
            credited_row.duration_seconds = Some(duration_seconds);
            credited_row.duration_minutes = Some(duration_seconds * (1.0 / 60.0));
            let timezone: Tz = credited_row.timezone.parse().unwrap_or(chrono_tz::UTC);
            populate_time_columns(&mut credited_row, timezone);
            credited.push(credited_row);
        }
        if credited.len() == before {
            emission_counts.fully_dead_sessions += 1;
        }
    }
    let credited_references = credited.iter().collect::<Vec<_>>();
    let credited_rows_digest = row_reference_sequence_digest(&credited_references);
    step_checkpoints.value(
        "emit_credited_rows",
        &serde_json::json!({
            "creditedRowsDigest": credited_rows_digest,
            "emissionCounts": emission_counts,
        }),
    )?;
    let report = CreditReportCheckpoint {
        sessions: session_count,
        credited_rows: credited.len(),
        credited_minutes: credited
            .iter()
            .map(|row| row.duration_minutes.unwrap_or(0.0))
            .sum(),
        raw_session_minutes,
        truncated_sessions: emission_counts.truncated_sessions,
        fully_dead_sessions: emission_counts.fully_dead_sessions,
        no_witness_fallbacks: emission_counts.no_witness_fallbacks,
        screen_incapable_participants: &screen_incapable,
    };
    step_checkpoints.value(
        "assemble_credit_result",
        &serde_json::json!({
            "creditedRowsDigest": credited_rows_digest,
            "restRowsDigest": rest_rows_digest,
            "report": report,
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
    let row_count = u32::try_from(credited.len() + rest_count)
        .map_err(|_| "credited app row count exceeds u32".to_string())?;
    let csv_bytes = write_app_csv_from_iter(
        credited
            .iter()
            .chain(app_rows.iter().filter(|row| !is_credit_session(row))),
        row_count as usize,
        opts,
        include_aliases,
    );
    let row_lineage = build_row_lineage_from_iter(
        "credited-app-csv",
        "effective_usage",
        credited
            .iter()
            .chain(app_rows.iter().filter(|row| !is_credit_session(row))),
    );
    Ok(ScreenCreditOutput {
        csv_bytes,
        row_count,
        row_lineage,
        effective_usage_checkpoint,
    })
}

// ---- screen state machine ----------------------------------------------

#[derive(Clone, serde::Serialize)]
struct ScreenState {
    start_index: usize,
    start_timestamp_ns: i64,
    start_timezone: String,
    lock_screen_seen: bool,
    unlocked_seen: bool,
    foreground_pkg: Option<String>,
    last_meaningful_ts_ns: Option<i64>,
    last_meaningful_pkg: Option<String>,
    source_data_rows: SourceDataRows,
}

#[derive(serde::Serialize)]
struct ScreenSessionClose {
    state: ScreenState,
    stop_timestamp_ns: Option<i64>,
    stop_event_type: Option<String>,
}

fn derive_screen_usage_sessions_full(
    rows: &[Row],
    opts: &PipelineV2Options,
    apps_forcing: &HashMap<String, String>,
    step_checkpoints: &mut StepCheckpointRecorder<'_>,
) -> Result<Vec<Row>, String> {
    let start_set: AHashSet<&str> = SCREEN_START_EVENTS.iter().copied().collect();
    let stop_set: AHashSet<&str> = SCREEN_STOP_EVENTS.iter().copied().collect();
    let lock_set: AHashSet<&str> = LOCK_SCREEN_EVENTS.iter().copied().collect();
    let unlock_set: AHashSet<&str> = UNLOCK_EVENTS.iter().copied().collect();
    let fg_set: AHashSet<&str> = FOREGROUND_EVENTS.iter().copied().collect();
    let meaningful_set: AHashSet<&str> = MEANINGFUL_ACTIVITY_EVENTS.iter().copied().collect();

    let mut keyguard_ts: Vec<i64> = rows
        .iter()
        .filter(|r| lock_set.contains(r.interaction_type.as_str()))
        .map(|r| r.event_timestamp_ns)
        .collect();
    keyguard_ts.sort_unstable();
    step_checkpoints.value("collect_keyguard_timestamps", &keyguard_ts)?;

    if !rows
        .iter()
        .any(|r| start_set.contains(r.interaction_type.as_str()))
    {
        let closes: Vec<ScreenSessionClose> = Vec::new();
        step_checkpoints.value("walk_screen_state_machine", &closes)?;
        step_checkpoints.rows("build_classified_sessions", &[]);
        return Ok(Vec::new());
    }

    let mut sessions: Vec<Row> = Vec::new();
    let mut closes: Vec<ScreenSessionClose> = Vec::new();
    let mut state: Option<ScreenState> = None;

    let build = |st: &ScreenState,
                 stop_ts: Option<i64>,
                 stop_event: Option<&str>,
                 sessions: &mut Vec<Row>| {
        let start_row = &rows[st.start_index];
        let mut sr = start_row.clone();
        sr.source_data_rows = st.source_data_rows.clone();
        sr.interaction_type = SCREEN_USAGE.to_string();
        sr.start_timestamp_ns = Some(st.start_timestamp_ns);
        sr.stop_timestamp_ns = stop_ts;
        sr.duration_seconds = stop_ts.map(|s| (s - st.start_timestamp_ns) as f64 / 1e9);
        sr.duration_minutes = sr.duration_seconds.map(|x| x / 60.0);
        sr.application_label = String::new();
        sr.app_package_name = st.foreground_pkg.clone().unwrap_or_default();
        sr.screen_usage_foreground_app_package = st.foreground_pkg.clone();
        sr.screen_usage_end_reason = None;
        sr.screen_usage_end_reason_confidence = None;
        sr.screen_usage_stop_event_type = stop_event.map(|s| s.to_string());
        sr.screen_usage_last_activity_timestamp_ns = st.last_meaningful_ts_ns;
        sr.screen_usage_tail_gap_seconds = None;
        sr.screen_usage_apps_forcing_screen_open_label = None;
        sr.screen_usage_lock_screen_only = Some(0);
        sr.data_time_gap_hours = 0.0;
        sr.event_timestamp_ns = st.start_timestamp_ns;
        sr.timezone = st.start_timezone.clone();
        sr.index = start_row.index + 1_000_000;
        if let Ok(tz) = sr.timezone.parse::<Tz>() {
            populate_time_columns(&mut sr, tz);
        }

        if stop_ts.is_none() {
            sr.screen_usage_end_reason = Some("missing_stop".to_string());
            sr.screen_usage_end_reason_confidence = Some(1.0);
            sessions.push(sr);
            return;
        }
        let stop_ns = stop_ts.unwrap();
        let last_pkg = st
            .last_meaningful_pkg
            .clone()
            .or_else(|| st.foreground_pkg.clone())
            .unwrap_or_default();
        let label = apps_forcing.get(&last_pkg).cloned().unwrap_or_default();
        let tail_gap = st.last_meaningful_ts_ns.map(|t| (stop_ns - t) as f64 / 1e9);
        sr.screen_usage_tail_gap_seconds = tail_gap;
        sr.screen_usage_apps_forcing_screen_open_label = if label.is_empty() {
            None
        } else {
            Some(label.clone())
        };

        if st.lock_screen_seen && !st.unlocked_seen && st.foreground_pkg.is_none() {
            sr.screen_usage_end_reason = Some("lock_screen_only".to_string());
            sr.screen_usage_end_reason_confidence = Some(0.95);
            sr.screen_usage_lock_screen_only = Some(1);
            sessions.push(sr);
            return;
        }
        if let Some(tg) = tail_gap {
            if !label.is_empty() && tg > opts.screen_auto_lock_timeout_seconds {
                sr.screen_usage_end_reason = Some("app_kept_awake_or_extended".to_string());
                sr.screen_usage_end_reason_confidence = Some(0.9);
                sessions.push(sr);
                return;
            }
            if tg <= opts.screen_manual_lock_max_tail_seconds {
                sr.screen_usage_end_reason = Some("probable_manual_lock".to_string());
                sr.screen_usage_end_reason_confidence = Some(0.85);
                sessions.push(sr);
                return;
            }
            if (tg - opts.screen_auto_lock_timeout_seconds).abs()
                <= opts.screen_auto_lock_tolerance_seconds
            {
                sr.screen_usage_end_reason = Some("probable_auto_lock".to_string());
                sr.screen_usage_end_reason_confidence = Some(0.9);
                sessions.push(sr);
                return;
            }
        }
        if st.lock_screen_seen {
            let search_radius_ns =
                (opts.screen_keyguard_near_stop_seconds * 1_000_000_000.0).ceil() as i64;
            let lower = keyguard_ts
                .partition_point(|timestamp| *timestamp < stop_ns.saturating_sub(search_radius_ns));
            let upper = keyguard_ts.partition_point(|timestamp| {
                *timestamp <= stop_ns.saturating_add(search_radius_ns)
            });
            let near = keyguard_ts[lower..upper].iter().any(|&kg| {
                ((stop_ns - kg) as f64 / 1e9).abs() <= opts.screen_keyguard_near_stop_seconds
            });
            if near {
                sr.screen_usage_end_reason = Some("probable_manual_lock".to_string());
                sr.screen_usage_end_reason_confidence = Some(0.7);
                sessions.push(sr);
                return;
            }
        }
        if tail_gap.is_some() {
            sr.screen_usage_end_reason = Some("extended_idle_or_unknown".to_string());
            sr.screen_usage_end_reason_confidence = Some(0.5);
            sessions.push(sr);
            return;
        }
        sr.screen_usage_end_reason = Some("unknown".to_string());
        sr.screen_usage_end_reason_confidence = Some(0.25);
        sessions.push(sr);
    };

    for (i, row) in rows.iter().enumerate() {
        let it = row.interaction_type.as_str();
        let pkg = if row.app_package_name.is_empty() {
            None
        } else {
            Some(row.app_package_name.clone())
        };
        if start_set.contains(it) {
            if state.is_none() {
                state = Some(ScreenState {
                    start_index: i,
                    start_timestamp_ns: row.event_timestamp_ns,
                    start_timezone: row.timezone.clone(),
                    lock_screen_seen: lock_set.contains(it),
                    unlocked_seen: false,
                    foreground_pkg: None,
                    last_meaningful_ts_ns: None,
                    last_meaningful_pkg: None,
                    source_data_rows: row.source_data_rows.clone(),
                });
            } else if let Some(current) = state.as_mut() {
                current.source_data_rows.merge(&row.source_data_rows);
            }
            continue;
        }
        let Some(s) = state.as_mut() else { continue };
        s.source_data_rows.merge(&row.source_data_rows);
        if lock_set.contains(it) {
            s.lock_screen_seen = true;
        }
        if unlock_set.contains(it) {
            s.unlocked_seen = true;
        }
        if fg_set.contains(it) {
            s.foreground_pkg = pkg.clone();
        }
        if meaningful_set.contains(it) {
            s.last_meaningful_ts_ns = Some(row.event_timestamp_ns);
            s.last_meaningful_pkg = pkg.clone().or_else(|| s.foreground_pkg.clone());
        }
        if stop_set.contains(it) {
            closes.push(ScreenSessionClose {
                state: s.clone(),
                stop_timestamp_ns: Some(row.event_timestamp_ns),
                stop_event_type: Some(it.to_string()),
            });
            state = None;
        }
    }
    if let Some(s) = state.take() {
        closes.push(ScreenSessionClose {
            state: s,
            stop_timestamp_ns: None,
            stop_event_type: None,
        });
    }
    step_checkpoints.value("walk_screen_state_machine", &closes)?;
    for close in &closes {
        build(
            &close.state,
            close.stop_timestamp_ns,
            close.stop_event_type.as_deref(),
            &mut sessions,
        );
    }
    step_checkpoints.rows("build_classified_sessions", &sessions);
    Ok(sessions)
}

// ---- output writer ------------------------------------------------------

fn build_app_columns(opts: &PipelineV2Options, include_codebook_aliases: bool) -> Vec<String> {
    let include_codebook = opts.use_app_codebook;
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
        format_custom_dur(opts.custom_app_engagement_duration)
    ));
    cols.push("valid_app_switched_app".into());
    cols.push("valid_app_usage_time_gap_hours".into());
    cols.push("any_app_new_engage_30s".into());
    cols.push(format!(
        "any_app_new_engage_custom_{}s",
        format_custom_dur(opts.custom_app_engagement_duration)
    ));
    cols.push("any_app_switched_app".into());
    cols.push("any_app_usage_time_gap_hours".into());
    cols.push("preprocessor_version".into());
    cols.push("datetime_of_preprocessing".into());
    if opts.model_concurrent_usage || opts.use_background_apps_file {
        cols.push("usage_layer".into());
    }
    cols
}

fn format_custom_dur(d: f64) -> String {
    js_number_to_string(d)
}

fn build_screen_columns() -> Vec<String> {
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

fn append_csv_field(out: &mut Vec<u8>, value: &str) {
    write_csv_field(out, value.as_bytes());
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
    let mut out: Vec<u8> = Vec::with_capacity(row_count * 256);
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
        let row_tz: Tz = row.timezone.parse().unwrap_or(tz);
        let event = fmt_event_timestamp(row.event_timestamp_ns, row_tz);
        let start_ts = fmt_session_timestamp(row.start_timestamp_ns, row_tz);
        let stop_ts = fmt_session_timestamp(row.stop_timestamp_ns, row_tz);
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
        emit(&mut out, &event, &mut first);
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
        emit(&mut out, &start_ts, &mut first);
        emit(&mut out, &stop_ts, &mut first);
        emit(
            &mut out,
            &format_csv_number_float(row.duration_seconds),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_number_float(row.duration_minutes),
            &mut first,
        );
        emit(&mut out, &row.any_app_usage_flags, &mut first);
        emit(
            &mut out,
            &normalize_float_string(row.data_time_gap_hours),
            &mut first,
        );
        emit(&mut out, &row.day.to_string(), &mut first);
        emit(&mut out, &row.weekday_mf.to_string(), &mut first);
        emit(&mut out, &row.weekday_mth.to_string(), &mut first);
        emit(&mut out, &row.weekday_su_th.to_string(), &mut first);
        emit(&mut out, &row.hour.to_string(), &mut first);
        emit(&mut out, &row.quarter.to_string(), &mut first);
        emit(
            &mut out,
            &format_csv_int(row.valid_app_new_engage_30s),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_int(row.valid_app_new_engage_custom),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_int(row.valid_app_switched_app),
            &mut first,
        );
        emit(
            &mut out,
            &normalize_float_string(row.valid_app_usage_time_gap_hours),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_int(row.any_app_new_engage_30s),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_int(row.any_app_new_engage_custom),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_int(row.any_app_switched_app),
            &mut first,
        );
        emit(
            &mut out,
            &normalize_float_string(row.any_app_usage_time_gap_hours),
            &mut first,
        );
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
    let mut out: Vec<u8> = Vec::with_capacity(rows.len() * 256);
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
        let row_tz: Tz = row.timezone.parse().unwrap_or(tz);
        let event = fmt_event_timestamp(row.event_timestamp_ns, row_tz);
        let start_ts = fmt_screen_timestamp(row.start_timestamp_ns, row_tz);
        let stop_ts = fmt_screen_timestamp(row.stop_timestamp_ns, row_tz);
        let last_act =
            fmt_screen_last_activity(row.screen_usage_last_activity_timestamp_ns, row_tz);
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
        emit(&mut out, &event, &mut first);
        emit(&mut out, &row.date, &mut first);
        emit(&mut out, &row.timezone, &mut first);
        emit(&mut out, &row.app_package_name, &mut first);
        emit(&mut out, "", &mut first); // application_label always empty
        emit(&mut out, &row.interaction_type, &mut first);
        emit(&mut out, &start_ts, &mut first);
        emit(&mut out, &stop_ts, &mut first);
        emit(
            &mut out,
            &format_csv_number_float(row.duration_seconds),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_number_float(row.duration_minutes),
            &mut first,
        );
        emit(
            &mut out,
            row.screen_usage_end_reason.as_deref().unwrap_or(""),
            &mut first,
        );
        emit(
            &mut out,
            &format_csv_number_float(row.screen_usage_end_reason_confidence),
            &mut first,
        );
        emit(
            &mut out,
            row.screen_usage_stop_event_type.as_deref().unwrap_or(""),
            &mut first,
        );
        emit(&mut out, &last_act, &mut first);
        emit(
            &mut out,
            &format_csv_number_float(row.screen_usage_tail_gap_seconds),
            &mut first,
        );
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
            None => "".to_string(),
            Some(0) => "false".to_string(),
            Some(_) => "true".to_string(),
        };
        emit(&mut out, &lso, &mut first);
        emit(&mut out, "", &mut first); // data_time_gap_hours always blank in screen
        emit(&mut out, &row.day.to_string(), &mut first);
        emit(&mut out, &row.weekday_mf.to_string(), &mut first);
        emit(&mut out, &row.weekday_mth.to_string(), &mut first);
        emit(&mut out, &row.weekday_su_th.to_string(), &mut first);
        emit(&mut out, &row.hour.to_string(), &mut first);
        emit(&mut out, &row.quarter.to_string(), &mut first);
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
    let mut timezone_counts: HashMap<String, usize> = HashMap::new();
    let mut primary_timezone = "UTC".to_string();
    let mut primary_count = 0usize;
    for row in &rows {
        if row.timezone.is_empty() {
            continue;
        }
        let count = timezone_counts.entry(row.timezone.clone()).or_default();
        *count += 1;
        if *count > primary_count {
            primary_timezone = row.timezone.clone();
            primary_count = *count;
        }
    }
    step_checkpoints.value("compute_dominant_timezone", &primary_timezone)?;
    let (target_timezone, timezone_action) = match opts.timezone_handling.as_str() {
        "selected-filter" => {
            if opts.timezone.trim().is_empty() {
                return Err("selected timezone is required for selected-filter".into());
            }
            rows.retain(|row| row.timezone == opts.timezone);
            if rows.is_empty() {
                return Err(format!(
                    "selected timezone {} is not present in the input; filtering would remove all rows",
                    opts.timezone
                ));
            }
            (opts.timezone.clone(), "filtered_to_selected")
        }
        "selected-convert" => {
            if opts.timezone.trim().is_empty() {
                return Err("selected timezone is required for selected-convert".into());
            }
            (opts.timezone.clone(), "converted_to_selected")
        }
        "primary-filter" => {
            rows.retain(|row| row.timezone == primary_timezone);
            (primary_timezone, "filtered_to_primary")
        }
        "primary-convert" => (primary_timezone, "converted_to_primary"),
        other => return Err(format!("unsupported timezone handling: {other}")),
    };
    step_checkpoints.rows_and_value(
        "select_timezone_strategy",
        &rows,
        &serde_json::json!({
            "targetTimezone": &target_timezone,
            "action": timezone_action,
        }),
    )?;
    let rows_after_timezone_handling = rows.len() as u32;
    let rows_removed_by_timezone =
        rows_before_timezone_handling.saturating_sub(rows_after_timezone_handling);
    let timezone_retained_source_rows_digest = timezone_retained_source_rows_digest(&rows);
    let mut effective_opts = opts.clone();
    effective_opts.timezone = target_timezone;
    let opts = &effective_opts;
    let tz: Tz = opts.timezone.parse().map_err(|e| format!("tz: {e}"))?;
    for row in rows.iter_mut() {
        row.timezone = opts.timezone.clone();
        populate_time_columns(row, tz);
    }
    step_checkpoints.rows("restamp_rows", &rows);
    let timezone_stage_digest = timezone_stage_digest(&rows);
    step_checkpoints.value(
        "row_count_report",
        &serde_json::json!({
            "before": rows_before_timezone_handling,
            "after": rows_after_timezone_handling,
            "removed": rows_removed_by_timezone,
        }),
    )?;
    record_logical_stage_checkpoint(
        &mut logical_stage_digests,
        &mut logical_stage_checkpoints,
        logical_stage_rows_checkpoint_reusing_last("normalize_timezones", &rows, &step_checkpoints),
    );

    // 3. dedupe + (optional) unalign duplicate timestamps + mark gaps
    let rows_before_deduplication = rows.len();
    let deduped = if opts.deduplicate_exact_rows {
        dedupe_exact_rows(rows)
    } else {
        rows
    };
    step_checkpoints.rows("exact_dedupe", &deduped);
    let exact_duplicate_rows_removed =
        rows_before_deduplication.saturating_sub(deduped.len()) as u32;
    let dupes_before = count_duplicate_groups(&deduped);
    step_checkpoints.value("count_dup_groups", &dupes_before)?;
    let dupe_corrected = if opts.correct_duplicate_event_timestamps {
        unalign_duplicate_timestamps(deduped, opts)
    } else {
        deduped
    };
    step_checkpoints.rows("nudge_duplicate_timestamps", &dupe_corrected);
    let dupes_corrected = if opts.correct_duplicate_event_timestamps {
        dupes_before
    } else {
        0
    };
    let mut rows = mark_data_time_gaps(dupe_corrected);
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
        join_codebook(&mut rows, opts, &codebook_map);
        step_checkpoints.rows("codebook_join", &rows);
        derive_broad_category(&mut rows, opts);
        step_checkpoints.rows("derive_broad_category", &rows);
        collapse_genre(&mut rows, opts);
        step_checkpoints.rows("collapse_genre", &rows);
        record_logical_stage_checkpoint(
            &mut logical_stage_digests,
            &mut logical_stage_checkpoints,
            logical_stage_rows_checkpoint_reusing_last("categorize_apps", &rows, &step_checkpoints),
        );
        add_app_usage_detail_columns(&mut rows, opts);
        step_checkpoints.rows("engagement_walk", &rows);
        mark_app_usage_flags(&mut rows, opts);
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
        rows = remove_selected_interaction_types(rows, opts);
        step_checkpoints.rows("drop_selected_types", &rows);
        if opts.filter_zero_duration_sessions {
            rows.retain(|row| {
                row.interaction_type != "App Usage"
                    || row.duration_seconds.is_none_or(|duration| duration > 0.0)
            });
        }
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
            let credited = apply_screen_gated_credit(
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
                if statuses.contains_key(participant_id) {
                    continue;
                }
                let status = sharing_status_for(participant_id, &sharing)?;
                if status == SharingStatus::Shared {
                    shared_participants.insert(participant_id.clone());
                }
                statuses.insert(participant_id.clone(), status);
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
        let shared_participants_checkpoint = serde_json::to_vec(&shared_participants)
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
    let visualization_data_json_bytes = serde_json::to_vec(&build_visualization_data(
        &app_rows_for_review,
        &screen_rows,
        &policy_rows,
    ))
    .map_err(|error| format!("serialize visualization data: {error}"))?;
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

    let row_lineage_bytes = serde_json::to_vec(&row_lineage)
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
            ("row_lineage", &row_lineage_bytes),
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
                ("row_lineage", &row_lineage_bytes),
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
        app_csv_bytes,
        screen_csv_bytes,
        day_coverage_csv_bytes,
        compliance_csv_bytes,
        credited_app_csv_bytes,
        review_summary_json_bytes,
        visualization_data_json_bytes,
        aggregate_csv_outputs,
        row_lineage,
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
            .filter(|lineage| lineage.output_kind == "app-csv")
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
            assert!(search.candidate_chain_digest.starts_with("blake3:"));
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
                "chronicle-logical-stage-checkpoint/v3"
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
                    digest.len() == 71
                        && digest.starts_with("blake3:")
                        && digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
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
        let first = [0x11_u8; 32];
        let second = [0x22_u8; 32];
        let third = [0x33_u8; 32];

        let mut reference = CheckpointHasher::new();
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = CheckpointHasher::new();
        checkpoint_digest_fixed32(&mut batched, &first);
        assert_eq!(reference.finalize(), batched.finalize());

        let mut reference = CheckpointHasher::new();
        checkpoint_digest_field(&mut reference, &first);
        checkpoint_digest_field(&mut reference, &second);
        let mut batched = CheckpointHasher::new();
        checkpoint_digest_fixed32_pair(&mut batched, &first, &second);
        assert_eq!(reference.finalize(), batched.finalize());

        let mut reference = CheckpointHasher::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = CheckpointHasher::new();
        checkpoint_digest_positioned_fixed32(&mut batched, 7, &first);
        assert_eq!(reference.finalize(), batched.finalize());

        let mut reference = CheckpointHasher::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        checkpoint_digest_field(&mut reference, &second);
        checkpoint_digest_field(&mut reference, &third);
        let mut batched = CheckpointHasher::new();
        checkpoint_digest_positioned_fixed32_triple(&mut batched, 7, &first, &second, &third);
        assert_eq!(reference.finalize(), batched.finalize());
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
        let output = String::from_utf8(result.app_csv_bytes).expect("UTF-8 CSV");
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
        let output = String::from_utf8(result.app_csv_bytes).unwrap();
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
        assert_eq!(search.index_space, "participant-source-event-order");
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
}
