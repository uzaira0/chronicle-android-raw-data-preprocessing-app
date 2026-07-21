//! Full pipeline v2 — port of `processRawCsvContent` (browserPipeline.ts).
//!
//! Goal: byte-identical output to `buildAppOutputBundle` /
//! `buildScreenOutputBundle` for the supported option matrix, in a single
//! WASM boundary call.

use ahash::AHashSet;
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use wasm_bindgen::prelude::*;

use crate::{parse_chronicle_timestamp_ns, weekday_chronicle, write_csv_field};

use _rust_app_usage_matcher::{split_overlapping_sessions, UsageLayer};

#[path = "pipeline_v2_aggregates.rs"]
mod aggregates;

const PREPROCESSOR_VERSION: &str = "1.0.0";

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
    pub fields: Vec<Option<String>>,
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
        let mut entry = CodebookEntry {
            fields: vec![None; n_cols],
        };
        for (i, (src, _dst)) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
            let v = trim_owned(row.get(*src));
            entry.fields[i] = if v.is_empty() { None } else { Some(v) };
        }
        map.insert(pkg, entry);
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
    source_data_rows: Vec<u32>,
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
    codebook_fields: Vec<Option<String>>,
    index: usize,
    /// Present only when `model_concurrent_usage` is true. Value is "primary"
    /// or "secondary". None when the flag is off (column absent from output).
    usage_layer: Option<String>,
}

fn merge_source_data_rows(target: &mut Vec<u32>, additional: impl IntoIterator<Item = u32>) {
    target.extend(additional);
    target.sort_unstable();
    target.dedup();
}

fn empty_codebook_fields() -> Vec<Option<String>> {
    vec![None; CODEBOOK_RENAME_PAIRS.len()]
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
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRowLineage {
    pub output_kind: &'static str,
    pub output_row_index: u32,
    pub source_data_rows: Vec<u32>,
    pub terminal_logical_node: &'static str,
}

fn build_row_lineage(
    output_kind: &'static str,
    terminal_logical_node: &'static str,
    rows: &[Row],
) -> Vec<PipelineRowLineage> {
    rows.iter()
        .enumerate()
        .map(|(index, row)| PipelineRowLineage {
            output_kind,
            output_row_index: index as u32,
            source_data_rows: row.source_data_rows.clone(),
            terminal_logical_node,
        })
        .collect()
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
            .ok_or_else(|| format!("invalid event_timestamp: {timestamp}"))?;
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
) -> Result<(Vec<Row>, String), String> {
    let tz: Tz = opts
        .timezone
        .parse()
        .map_err(|e| format!("tz {}: {e}", opts.timezone))?;
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
                    let event_ts_raw = get(h_event).trim();
                    if !event_ts_raw.is_empty() {
                        raw_rows.push(RawRow {
                            source_data_row: data_row_number,
                            event_timestamp: event_ts_raw.to_string(),
                            timezone: get(h_tz).trim().to_string(),
                            app_package_name: get(h_pkg).trim().to_string(),
                            interaction_type: get(h_int).trim().to_string(),
                            application_label: get(h_label).trim().to_string(),
                            study_id: get(h_study).trim().to_string(),
                            participant_id: get(h_pid).trim().to_string(),
                            username: get(h_user).trim().to_string(),
                        });
                    }
                    for s in row_vals.iter_mut() {
                        s.clear();
                    }
                    col_idx = 0;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let possible_device_model = if raw_rows
        .iter()
        .any(|r| AMAZON_APPS.iter().any(|p| r.app_package_name.contains(*p)))
    {
        "Amazon Fire".to_string()
    } else {
        "Android".to_string()
    };

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
        .collect::<HashMap<_, _>>();

    let mut rows: Vec<Row> = Vec::with_capacity(raw_rows.len());
    for (idx, raw) in raw_rows.into_iter().enumerate() {
        let event_ns = parse_chronicle_timestamp_ns(&raw.event_timestamp)
            .ok_or_else(|| format!("invalid event_timestamp: {}", raw.event_timestamp))?;
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
            source_data_rows: vec![raw.source_data_row],
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
            index: idx,
            usage_layer: None,
        };
        let row_tz: Tz = row.timezone.parse().unwrap_or(tz);
        populate_time_columns(&mut row, row_tz);
        rows.push(row);
    }

    rows.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });

    Ok((rows, opts.timezone.clone()))
}

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
            merge_source_data_rows(
                &mut out[index].source_data_rows,
                row.source_data_rows.into_iter(),
            );
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

    let mut next = rows;
    for &si in &result.start_indices {
        next[si].start_timestamp_ns = Some(next[si].event_timestamp_ns);
    }
    for (k, &si) in result.stop_start_indices.iter().enumerate() {
        let stop_idx = result.stop_event_indices[k];
        let lower = si.min(stop_idx);
        let upper = si.max(stop_idx);
        let contributors = next[lower..=upper]
            .iter()
            .flat_map(|row| row.source_data_rows.iter().copied())
            .collect::<Vec<_>>();
        merge_source_data_rows(&mut next[si].source_data_rows, contributors);
        next[si].stop_timestamp_ns = Some(next[stop_idx].event_timestamp_ns);
    }
    for &mi in &result.missing_indices {
        let participant = next[mi].participant_id.clone();
        let contributors = next[mi..]
            .iter()
            .filter(|row| row.participant_id == participant)
            .flat_map(|row| row.source_data_rows.iter().copied())
            .collect::<Vec<_>>();
        merge_source_data_rows(&mut next[mi].source_data_rows, contributors);
        next[mi].interaction_type = END_OF_USAGE_MISSING.to_string();
        next[mi].stop_timestamp_ns = None;
        next[mi].duration_seconds = None;
        next[mi].duration_minutes = None;
        if filtered_packages.contains(&next[mi].app_package_name) {
            next[mi].start_timestamp_ns = None;
        }
    }

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
    Ok(out)
}

fn run_app_usage_algorithm(
    mut rows: Vec<Row>,
    opts: &PipelineV2Options,
    background_apps: &AHashSet<String>,
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
    if !rows
        .iter()
        .any(|r| r.interaction_type == ACTIVITY_RESUMED || r.interaction_type == ACTIVITY_PAUSED)
    {
        return Err("No valid app usage data during the study period".to_string());
    }
    let same_stop: AHashSet<String> = opts.same_app_stop_types.iter().cloned().collect();
    let other_stop: AHashSet<String> = opts.other_stop_types.iter().cloned().collect();
    let mut next = process_usage_rows(
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
    )?;
    if !filtered_packages.is_empty() {
        for row in &mut next {
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
    Ok(next)
}

fn enrich_codebook(
    rows: &mut [Row],
    opts: &PipelineV2Options,
    codebook_map: &HashMap<String, CodebookEntry>,
) {
    if !opts.use_app_codebook {
        return;
    }
    if codebook_map.is_empty() {
        for row in rows.iter_mut() {
            row.genre_id_scraped = Some("Unknown".to_string());
            row.broad_app_category = Some("Unknown".to_string());
            row.codebook_fields = empty_codebook_fields();
        }
        return;
    }
    let bcm_play_store_broad_idx = codebook_col_index("bcm_play_store_broad_app_category").unwrap();
    let usc_broad_idx = codebook_col_index("usc_broad_app_category").unwrap();
    let babyemu_broad_idx = codebook_col_index("babyemu_broad_app_category").unwrap();
    let bcm_broad_idx = codebook_col_index("bcm_cnrc_heuristic_category").unwrap();

    let babyemu_scraped_idx = codebook_col_index("babyemu_genreId_scraped").unwrap();
    let babyemu_manual_idx = codebook_col_index("babyemu_genreId_manual").unwrap();
    let bcm_play_store_genre_idx = codebook_col_index("bcm_play_store_genreId").unwrap();
    let usc_genre_idx = codebook_col_index("usc_genreId").unwrap();

    for row in rows.iter_mut() {
        let entry = codebook_map.get(&row.app_package_name);
        // Reset codebook fields.
        row.codebook_fields = empty_codebook_fields();
        match entry {
            None => {
                row.genre_id_scraped = Some("Unknown".to_string());
                row.broad_app_category = Some("Unknown".to_string());
            }
            Some(e) => {
                row.codebook_fields = e.fields.clone();

                // broad_app_category fallback chain
                let candidates = [
                    row.codebook_fields[bcm_play_store_broad_idx].as_deref(),
                    row.codebook_fields[usc_broad_idx].as_deref(),
                    row.codebook_fields[babyemu_broad_idx].as_deref(),
                    row.codebook_fields[bcm_broad_idx].as_deref(),
                    row.broad_app_category.as_deref(),
                ];
                let chosen = candidates
                    .iter()
                    .find_map(|c| c.filter(|s| !s.trim().is_empty()).map(String::from));
                row.broad_app_category = Some(chosen.unwrap_or_else(|| "Unknown".to_string()));

                // genreId_scraped from collapsed set.
                let mut genre_values: Vec<String> = Vec::new();
                for idx in [
                    babyemu_scraped_idx,
                    babyemu_manual_idx,
                    bcm_play_store_genre_idx,
                    usc_genre_idx,
                ] {
                    if let Some(v) = &row.codebook_fields[idx] {
                        if !v.trim().is_empty() {
                            genre_values.push(v.clone());
                        }
                    }
                }
                if genre_values.is_empty() {
                    row.genre_id_scraped = Some("Unknown".to_string());
                } else {
                    let unique: AHashSet<&str> = genre_values.iter().map(|s| s.as_str()).collect();
                    if unique.len() == 1 {
                        row.genre_id_scraped = Some(genre_values[0].clone());
                        row.codebook_fields[bcm_play_store_genre_idx] = None;
                        row.codebook_fields[usc_genre_idx] = None;
                        row.codebook_fields[babyemu_scraped_idx] = None;
                        row.codebook_fields[babyemu_manual_idx] = None;
                    } else {
                        row.genre_id_scraped = None;
                    }
                }
            }
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

#[derive(Debug, Clone)]
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

fn apply_study_window(rows: Vec<Row>, windows: &[StudyWindow]) -> Vec<Row> {
    rows.into_iter()
        .filter(|row| {
            let exact = windows
                .iter()
                .find(|window| window.participant_id == row.participant_id);
            let window = exact.or_else(|| {
                let id = numerical_id(&row.participant_id)?;
                windows
                    .iter()
                    .find(|window| numerical_id(&window.participant_id) == Some(id))
            });
            window.is_none_or(|window| row.date >= window.start_date && row.date <= window.end_date)
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SharingStatus {
    Shared,
    NonShared,
}

#[derive(Debug, Clone)]
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

fn parse_survey_lookup(bytes: &[u8]) -> Result<HashMap<(String, i64), String>, String> {
    if bytes.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Survey attribution file",
        &rows,
        &["participant_id", "event_timestamp", "users"],
    )?;
    let mut lookup = HashMap::new();
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

fn attribute_person(
    mut rows: Vec<Row>,
    sharing: &[SharingEntry],
    survey: &HashMap<(String, i64), String>,
) -> Result<Vec<Row>, String> {
    let mut statuses = HashMap::new();
    for row in &rows {
        if !statuses.contains_key(&row.participant_id) {
            statuses.insert(
                row.participant_id.clone(),
                sharing_status_for(&row.participant_id, sharing)?,
            );
        }
    }
    for row in &mut rows {
        let status = statuses[&row.participant_id];
        match status {
            SharingStatus::NonShared => {
                if is_null_username(&row.username) {
                    row.username = "Target Child".into();
                }
            }
            SharingStatus::Shared => {
                if is_null_username(&row.username) {
                    row.username = if KIDS_SHELL_PACKAGES.contains(&row.app_package_name.as_str()) {
                        "Target Child".into()
                    } else {
                        "None".into()
                    };
                }
                if let Some(user) =
                    survey.get(&(row.participant_id.clone(), row.event_timestamp_ns))
                {
                    row.username = format!("{user} (From Survey)");
                }
                if row.interaction_type == APP_USAGE && !is_target_child(&row.username) {
                    row.interaction_type = NON_TARGET_CHILD_APP_USAGE.into();
                }
            }
        }
    }
    Ok(rows)
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

fn build_day_coverage_csv(
    usage_rows: &[Row],
    raw_rows: &[Row],
    windows: &[StudyWindow],
) -> Result<Vec<u8>, String> {
    let mut raw_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut usage_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
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
    Ok(lines.join("\n").into_bytes())
}

fn js_rounded_number(value: f64) -> String {
    let mut text = normalize_float_string(value);
    if let Some(integer) = text.strip_suffix(".0") {
        text = integer.to_string();
    }
    text
}

fn parse_enrolled_devices(bytes: &[u8]) -> Result<HashMap<String, u32>, String> {
    if bytes.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Enrolled devices file",
        &rows,
        &["participant_id", "device_count"],
    )?;
    let mut devices = HashMap::new();
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

fn build_compliance_csv(
    rows: &[Row],
    shared_participants: &BTreeSet<String>,
    threshold_percent: f64,
    enrolled_devices: &HashMap<String, u32>,
) -> Vec<u8> {
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
    let mut lines = vec![
        "participant_id,date,sharing_status,known_minutes,unknown_minutes,compliance_percent,zero_real_usage,is_valid,expected_device_count".to_string(),
    ];
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
            let expected = enrolled_devices
                .get(&participant_id)
                .map(u32::to_string)
                .unwrap_or_default();
            lines.push(format!(
                "{},{date},{},{},{},{},{},{},{}",
                csv_escape_value(&participant_id),
                if shared { "Shared" } else { "Non-Shared" },
                js_rounded_number(known),
                js_rounded_number(unknown),
                js_rounded_number(compliance),
                u8::from(total <= 0.0),
                u8::from(compliance >= threshold_percent),
                expected,
            ));
        }
    }
    lines.join("\n").into_bytes()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScreenCreditState {
    On,
    Off,
}

#[derive(Debug, Clone, Copy)]
struct ScreenChangePoint {
    timestamp_ns: i64,
    state: ScreenCreditState,
}

#[derive(Default)]
struct ScreenCreditSubstrate {
    points: HashMap<String, Vec<ScreenChangePoint>>,
    boots: HashMap<String, Vec<i64>>,
    all_timestamps: HashMap<String, Vec<i64>>,
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

fn build_screen_credit_substrate(raw_events: &[Row]) -> Result<ScreenCreditSubstrate, String> {
    let mut by_participant: HashMap<String, Vec<(i64, String)>> = HashMap::new();
    for row in raw_events {
        by_participant
            .entry(if row.participant_id.is_empty() {
                "unknown".into()
            } else {
                row.participant_id.clone()
            })
            .or_default()
            .push((row.event_timestamp_ns, row.interaction_type.clone()));
    }
    let mut substrate = ScreenCreditSubstrate::default();
    for (participant_id, mut events) in by_participant {
        events.sort_by_key(|event| event.0);
        let mut points = Vec::new();
        let mut last = None;
        for (timestamp_ns, interaction_type) in &events {
            let state = screen_witness_state(interaction_type)?;
            if let Some(state) = state {
                if Some(state) != last {
                    points.push(ScreenChangePoint {
                        timestamp_ns: *timestamp_ns,
                        state,
                    });
                    last = Some(state);
                }
            }
        }
        if events.iter().any(|(_, kind)| kind == "Screen Interactive")
            && events
                .iter()
                .any(|(_, kind)| kind == "Screen Non-Interactive")
        {
            substrate.capable.insert(participant_id.clone());
        }
        substrate.boots.insert(
            participant_id.clone(),
            events
                .iter()
                .filter(|(_, kind)| kind == "Device Startup")
                .map(|event| event.0)
                .collect(),
        );
        substrate.all_timestamps.insert(
            participant_id.clone(),
            events.iter().map(|event| event.0).collect(),
        );
        substrate.points.insert(participant_id, points);
    }
    Ok(substrate)
}

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

fn alive_intervals(
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
    let timestamps: Vec<_> = points.iter().map(|point| point.timestamp_ns).collect();
    bisect_right(&timestamps, timestamp)
        .checked_sub(1)
        .map(|index| points[index].state)
}

fn creditable_intervals(
    points: &[ScreenChangePoint],
    start: i64,
    end: i64,
    auto_lock_ns: i64,
) -> Vec<CreditInterval> {
    let timestamps: Vec<_> = points.iter().map(|point| point.timestamp_ns).collect();
    let mut state = bisect_right(&timestamps, start)
        .checked_sub(1)
        .map(|index| points[index].state);
    let mut point_index = bisect_right(&timestamps, start);
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

fn apply_screen_gated_credit(
    app_rows: &[Row],
    raw_events: &[Row],
    opts: &PipelineV2Options,
) -> Result<Vec<Row>, String> {
    let substrate = build_screen_credit_substrate(raw_events)?;
    let sessions: Vec<_> = app_rows
        .iter()
        .filter(|row| {
            row.interaction_type == APP_USAGE
                && row.duration_minutes.is_some_and(|duration| duration > 0.0)
        })
        .cloned()
        .collect();
    let rest: Vec<_> = app_rows
        .iter()
        .filter(|row| {
            row.interaction_type != APP_USAGE
                || row.duration_minutes.is_none_or(|duration| duration <= 0.0)
        })
        .cloned()
        .collect();
    let mut day_apps: HashMap<(String, String), BTreeSet<String>> = HashMap::new();
    for row in &sessions {
        day_apps
            .entry((row.participant_id.clone(), row.date.clone()))
            .or_default()
            .insert(row.app_package_name.clone());
    }
    let tolerance_ns =
        (opts.device_liveness_gap_tolerance_minutes * 60.0).round() as i64 * 1_000_000_000;
    let cap_ns = (opts.credited_session_cap_minutes * 60.0).round() as i64 * 1_000_000_000;
    let auto_lock_ns = opts.auto_lock_bridge_seconds.round() as i64 * 1_000_000_000;
    let mut credited = Vec::new();
    for row in sessions {
        let (Some(start), Some(raw_end)) = (row.start_timestamp_ns, row.stop_timestamp_ns) else {
            credited.push(row);
            continue;
        };
        if raw_end <= start {
            credited.push(row);
            continue;
        }
        let end = raw_end.min(start.saturating_add(cap_ns));
        let points = substrate
            .points
            .get(&row.participant_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let intervals = if points.is_empty() || !substrate.capable.contains(&row.participant_id) {
            vec![(start, end)]
        } else {
            let timestamps = substrate
                .all_timestamps
                .get(&row.participant_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let boots = substrate
                .boots
                .get(&row.participant_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let alive = alive_intervals(timestamps, start, end, tolerance_ns, boots);
            let has_point = points
                .iter()
                .any(|point| point.timestamp_ns >= start && point.timestamp_ns <= end);
            if screen_state_at(points, start).is_none() && !has_point {
                let app_count = day_apps
                    .get(&(row.participant_id.clone(), row.date.clone()))
                    .map(BTreeSet::len)
                    .unwrap_or_default();
                if app_count >= opts.no_witness_min_day_apps as usize {
                    alive
                } else {
                    Vec::new()
                }
            } else {
                let screen = creditable_intervals(points, start, end, auto_lock_ns);
                intersect_intervals(&screen, &alive)
            }
        };
        for (interval_start, interval_end) in intervals {
            if interval_end <= interval_start {
                continue;
            }
            let mut credited_row = row.clone();
            let contributors = raw_events
                .iter()
                .filter(|event| {
                    event.participant_id == row.participant_id
                        && event.event_timestamp_ns <= interval_end
                })
                .flat_map(|event| event.source_data_rows.iter().copied())
                .collect::<Vec<_>>();
            merge_source_data_rows(&mut credited_row.source_data_rows, contributors);
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
    }
    credited.extend(rest);
    Ok(credited)
}

// ---- screen state machine ----------------------------------------------

#[derive(Clone)]
struct ScreenState {
    start_index: usize,
    start_timestamp_ns: i64,
    start_timezone: String,
    lock_screen_seen: bool,
    unlocked_seen: bool,
    foreground_pkg: Option<String>,
    last_meaningful_ts_ns: Option<i64>,
    last_meaningful_pkg: Option<String>,
    source_data_rows: Vec<u32>,
}

fn derive_screen_usage_sessions_full(
    rows: &[Row],
    opts: &PipelineV2Options,
    apps_forcing: &HashMap<String, String>,
) -> Vec<Row> {
    let start_set: AHashSet<&str> = SCREEN_START_EVENTS.iter().copied().collect();
    let stop_set: AHashSet<&str> = SCREEN_STOP_EVENTS.iter().copied().collect();
    let lock_set: AHashSet<&str> = LOCK_SCREEN_EVENTS.iter().copied().collect();
    let unlock_set: AHashSet<&str> = UNLOCK_EVENTS.iter().copied().collect();
    let fg_set: AHashSet<&str> = FOREGROUND_EVENTS.iter().copied().collect();
    let meaningful_set: AHashSet<&str> = MEANINGFUL_ACTIVITY_EVENTS.iter().copied().collect();

    if !rows
        .iter()
        .any(|r| start_set.contains(r.interaction_type.as_str()))
    {
        return Vec::new();
    }
    let mut keyguard_ts: Vec<i64> = rows
        .iter()
        .filter(|r| lock_set.contains(r.interaction_type.as_str()))
        .map(|r| r.event_timestamp_ns)
        .collect();
    keyguard_ts.sort_unstable();

    let mut sessions: Vec<Row> = Vec::new();
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
            let near = keyguard_ts.iter().any(|&kg| {
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
                merge_source_data_rows(
                    &mut current.source_data_rows,
                    row.source_data_rows.iter().copied(),
                );
            }
            continue;
        }
        let Some(s) = state.as_mut() else { continue };
        merge_source_data_rows(
            &mut s.source_data_rows,
            row.source_data_rows.iter().copied(),
        );
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
            let stop_event = it.to_string();
            let s_clone = s.clone();
            build(
                &s_clone,
                Some(row.event_timestamp_ns),
                Some(&stop_event),
                &mut sessions,
            );
            state = None;
        }
    }
    if let Some(s) = state.take() {
        build(&s, None, None, &mut sessions);
    }
    sessions
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
    let cols = build_app_columns(opts, include_aliases);
    let mut out: Vec<u8> = Vec::with_capacity(rows.len() * 256);
    // header
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
                let val = row
                    .codebook_fields
                    .get(i)
                    .and_then(|v| v.as_deref())
                    .unwrap_or("");
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
    // 1. parse + sort + canonicalize
    let (mut rows, _tz) = parse_raw_rows(csv_bytes, opts)?;
    let original_count = rows.len() as u32;
    let available_timezones: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let timezone = row.timezone.trim();
            (!timezone.is_empty()).then(|| timezone.to_string())
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
    let (target_timezone, timezone_action) = match opts.timezone_handling.as_str() {
        "selected-filter" => {
            if opts.timezone.trim().is_empty() {
                return Err("selected timezone is required for selected-filter".into());
            }
            rows.retain(|row| row.timezone == opts.timezone);
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
    let rows_after_timezone_handling = rows.len() as u32;
    let rows_removed_by_timezone =
        rows_before_timezone_handling.saturating_sub(rows_after_timezone_handling);
    let mut effective_opts = opts.clone();
    effective_opts.timezone = target_timezone;
    let opts = &effective_opts;
    let tz: Tz = opts.timezone.parse().map_err(|e| format!("tz: {e}"))?;
    for row in rows.iter_mut() {
        row.timezone = opts.timezone.clone();
        populate_time_columns(row, tz);
    }

    // 3. dedupe + (optional) unalign duplicate timestamps + mark gaps
    let rows_before_deduplication = rows.len();
    let deduped = if opts.deduplicate_exact_rows {
        dedupe_exact_rows(rows)
    } else {
        rows
    };
    let exact_duplicate_rows_removed =
        rows_before_deduplication.saturating_sub(deduped.len()) as u32;
    let dupes_before = count_duplicate_groups(&deduped);
    let dupe_corrected = if opts.correct_duplicate_event_timestamps {
        unalign_duplicate_timestamps(deduped, opts)
    } else {
        deduped
    };
    let dupes_corrected = if opts.correct_duplicate_event_timestamps {
        dupes_before
    } else {
        0
    };
    let mut rows = mark_data_time_gaps(dupe_corrected);

    // 4. filter labeling
    let filter_map = if opts.use_filter_file && !support.filter_csv.is_empty() {
        parse_filter_csv(support.filter_csv)
    } else {
        HashMap::new()
    };
    if opts.use_filter_file {
        rows = label_filtered_apps(rows, &filter_map);
    }
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
        screen_rows = derive_screen_usage_sessions_full(&rows, opts, &apps_forcing_map);
    }

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
    let mut credited_app_rows_for_lineage = Vec::new();
    let app_rows_for_review;
    let app_row_count;
    let screen_row_count = screen_rows.len() as u32;

    if matches!(opts.usage_session_mode, UsageSessionMode::ScreenUsage) {
        app_row_count = 0;
        app_csv_bytes = Vec::new();
        day_coverage_csv_bytes = Vec::new();
        compliance_csv_bytes = Vec::new();
        credited_app_csv_bytes = Vec::new();
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
        rows = run_app_usage_algorithm(rows, opts, &background_apps)?;

        // 7. codebook
        let codebook_map = if opts.use_app_codebook && !support.codebook_csv.is_empty() {
            parse_codebook_csv(support.codebook_csv)
        } else {
            HashMap::new()
        };
        let include_aliases =
            !opts.use_app_codebook || codebook_map.is_empty() || opts.include_category_column;

        // 8. enrich
        enrich_codebook(&mut rows, opts, &codebook_map);
        add_app_usage_detail_columns(&mut rows, opts);
        mark_app_usage_flags(&mut rows, opts);
        clear_filtered_usage_timing(&mut rows);
        rows = remove_selected_interaction_types(rows, opts);
        if opts.filter_zero_duration_sessions {
            rows.retain(|row| {
                row.interaction_type != "App Usage"
                    || row.duration_seconds.is_none_or(|duration| duration > 0.0)
            });
        }
        credited_app_csv_bytes = if opts.enable_screen_gated_crediting {
            let credited = apply_screen_gated_credit(&rows, &policy_rows, opts)?;
            let bytes = write_app_csv(&credited, opts, include_aliases);
            credited_app_rows_for_lineage = credited;
            bytes
        } else {
            Vec::new()
        };
        if opts.enable_study_window_filter {
            if support.study_dates_csv.is_empty() {
                return Err(
                    "Study dates file is required when study-window filtering is enabled".into(),
                );
            }
            rows = apply_study_window(rows, &study_windows);
        }
        if opts.enable_person_attribution {
            if support.device_sharing_csv.is_empty() {
                return Err(
                    "Device sharing file is required when person attribution is enabled".into(),
                );
            }
            let sharing = parse_device_sharing(support.device_sharing_csv)?;
            let survey = parse_survey_lookup(support.survey_attribution_csv)?;
            for participant_id in rows.iter().map(|row| &row.participant_id) {
                if sharing_status_for(participant_id, &sharing)? == SharingStatus::Shared {
                    shared_participants.insert(participant_id.clone());
                }
            }
            rows = attribute_person(rows, &sharing, &survey)?;
        }
        if opts.add_no_activity_placeholder_days {
            rows = add_no_activity_placeholder_rows(rows, &policy_rows);
        }

        day_coverage_csv_bytes = if opts.enable_day_coverage {
            build_day_coverage_csv(&rows, &policy_rows, &study_windows)?
        } else {
            Vec::new()
        };
        compliance_csv_bytes = if opts.enable_compliance_scoring {
            let enrolled_devices = parse_enrolled_devices(support.enrolled_devices_csv)?;
            build_compliance_csv(
                &rows,
                &shared_participants,
                opts.compliance_threshold_percent,
                &enrolled_devices,
            )
        } else {
            Vec::new()
        };

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
        row_lineage.extend(build_row_lineage(
            "credited-app-csv",
            "effective_usage",
            &credited_app_rows_for_lineage,
        ));
    }

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
        duplicate_timestamps_corrected: dupes_corrected,
        exact_duplicate_rows_removed,
        available_timezones,
        timezone: opts.timezone.clone(),
        timezone_action: timezone_action.into(),
        rows_before_timezone_handling,
        rows_after_timezone_handling,
        rows_removed_by_timezone,
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
        assert_eq!(without_newline.row_lineage[0].source_data_rows, vec![1, 2]);
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
}
