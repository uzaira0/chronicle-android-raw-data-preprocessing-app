//! Full pipeline v2 — port of `processRawCsvContent` (browserPipeline.ts).
//!
//! Goal: byte-identical output to `buildAppOutputBundle` /
//! `buildScreenOutputBundle` for the supported option matrix, in a single
//! WASM boundary call.

use ahash::AHashSet;
use chrono::{DateTime, Datelike, NaiveDateTime, TimeZone, Timelike, Weekday};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use serde::Serialize;
use std::collections::HashMap;
use std::fmt::Write as _;
use wasm_bindgen::prelude::*;

use crate::{
    parse_chronicle_timestamp_ns, weekday_chronicle, write_csv_field, write_u8,
    REQUIRED_COLUMNS,
};

use _rust_app_usage_matcher::{split_overlapping_sessions, UsageLayer};

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
const END_OF_USAGE_MISSING: &str = "End of Usage Missing";
const SCREEN_USAGE: &str = "Screen Usage";

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
    ("play_store_genreId", "play_store_genreId"),
    ("play_store_genre", "play_store_genre"),
    ("play_store_broad_app_category", "play_store_broad_app_category"),
    ("play_store_developer", "play_store_developer"),
    ("play_store_free", "play_store_free"),
    ("play_store_rating", "play_store_rating"),
    ("play_store_downloads", "play_store_downloads"),
    ("usc_broad_app_category", "usc_broad_app_category"),
    ("usc_genreId", "usc_genreId"),
    ("umich_child_app_category_code", "umich_child_app_category_code"),
    ("umich_child_app_category", "umich_child_app_category"),
    ("umich_adult_app_category_code", "umich_adult_app_category_code"),
    ("umich_adult_app_category", "umich_adult_app_category"),
    ("umich_free", "umich_free"),
    ("umich_gambling_app", "umich_gambling_app"),
    ("umich_inappropriate_app", "umich_inappropriate_app"),
    ("babyemu_genreId_scraped", "babyemu_genreId_scraped"),
    ("babyemu_genreId_manual", "babyemu_genreId_manual"),
    ("babyemu_broad_app_category", "babyemu_broad_app_category"),
    ("babyemu_medium_app_category", "babyemu_medium_app_category"),
    ("babyemu_fine_app_category", "babyemu_fine_app_category"),
    ("babyemu_alternate_fine_app_category", "babyemu_alternate_fine_app_category"),
    ("babyemu_kids", "babyemu_kids"),
    ("bcm_cnrc_heuristic_category", "bcm_cnrc_heuristic_category"),
    ("bcm_cnrc_categorization_source", "bcm_cnrc_categorization_source"),
    ("dataset", "codebook_dataset"),
];

fn codebook_output_columns() -> Vec<&'static str> {
    CODEBOOK_RENAME_PAIRS.iter().map(|(_, v)| *v).collect()
}

// Stable column index lookup for codebook fields, matching the order above.
fn codebook_col_index(name: &str) -> Option<usize> {
    CODEBOOK_RENAME_PAIRS
        .iter()
        .position(|(_, v)| *v == name)
}

// ---- options ------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PipelineV2Options {
    pub study_name: String,
    pub timezone: String, // already-resolved target timezone
    pub usage_session_mode: UsageSessionMode,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    pub use_app_codebook: bool,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
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
        let pkg = trim_owned(row.get("app_package_name").or_else(|| row.get("package_name")));
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
        let pkg = trim_owned(row.get("package_name").or_else(|| row.get("app_package_name")));
        let label = trim_owned(row.get("label_or_note").or_else(|| row.get("application_label")));
        if pkg.is_empty() || pkg.starts_with('#') {
            continue;
        }
        map.insert(pkg, label);
    }
    map
}

#[derive(Default, Debug, Clone)]
pub struct CodebookEntry {
    /// Indexed by codebook_col_index() output name (e.g. "codebook_application_label", "play_store_genreId"…)
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
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = bytes;

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                if !input.is_empty() {
                    continue;
                }
                break;
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
                if !input.is_empty() {
                    continue;
                }
                break;
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
    let Some(ns) = ts_ns else { return String::new() };
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
    let Some(ns) = ts_ns else { return String::new() };
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
    let Some(ns) = ts_ns else { return String::new() };
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
    s.rfind(|c: char| c == '+' || c == '-').filter(|&i| i >= 19)
}

fn fmt_date_yyyy_mm_dd(ts_ns: i64, tz: Tz) -> String {
    let local = ts_to_local(ts_ns, tz);
    format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day())
}

fn local_weekday(ts_ns: i64, tz: Tz) -> u8 {
    weekday_chronicle(ts_to_local(ts_ns, tz).weekday())
}

fn populate_time_columns(row: &mut Row, tz: Tz) {
    let local = ts_to_local(row.event_timestamp_ns, tz);
    row.date = format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day());
    let day = weekday_chronicle(local.weekday());
    row.day = day;
    row.weekday_mf = if day >= 2 && day <= 6 { 1 } else { 0 };
    row.weekday_mth = if day >= 2 && day <= 5 { 1 } else { 0 };
    row.weekday_su_th = if day == 1 || (day >= 2 && day <= 5) { 1 } else { 0 };
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
        return if value.is_sign_positive() { "Infinity".to_string() } else { "-Infinity".to_string() };
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
        return if value > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() };
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
    let rest_nonzero = digits[p + 1..].bytes().any(|b| b != b'0');
    let round_up = next_digit > b'5' || (next_digit == b'5' && (rest_nonzero || true));
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
pub struct PipelineV2Result {
    pub app_csv_bytes: Vec<u8>,
    pub screen_csv_bytes: Vec<u8>,
    pub original_row_count: u32,
    pub processed_row_count: u32,
    pub app_row_count: u32,
    pub screen_row_count: u32,
    pub duplicate_timestamps_corrected: u32,
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

#[derive(serde::Deserialize)]
pub struct PipelineV2OptionsJson {
    pub study_name: String,
    pub timezone: String,
    pub usage_session_mode: String,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    pub use_app_codebook: bool,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
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
}

impl PipelineV2OptionsJson {
    fn into_pipeline_options(self) -> PipelineV2Options {
        let mode = match self.usage_session_mode.as_str() {
            "screen_usage" => UsageSessionMode::ScreenUsage,
            "app_and_screen_usage" => UsageSessionMode::AppAndScreenUsage,
            _ => UsageSessionMode::AppUsage,
        };
        PipelineV2Options {
            study_name: self.study_name,
            timezone: self.timezone,
            usage_session_mode: mode,
            include_app_output: self.include_app_output,
            include_screen_output: self.include_screen_output,
            use_filter_file: self.use_filter_file,
            use_apps_forcing_screen_open: self.use_apps_forcing_screen_open,
            use_app_codebook: self.use_app_codebook,
            correct_duplicate_event_timestamps: self.correct_duplicate_event_timestamps,
            allow_stop_event_reuse: self.allow_stop_event_reuse,
            use_activity_stopped_as_fallback: self.use_activity_stopped_as_fallback,
            apply_threshold_to_fallback: self.apply_threshold_to_fallback,
            long_duration_threshold_ns: self.long_duration_threshold_ns,
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
        }
    }
}

fn normalize_interaction_type_local(s: &str) -> &str {
    crate::normalize_interaction_type(s)
}

fn parse_raw_rows(csv_bytes: &[u8], opts: &PipelineV2Options) -> Result<(Vec<Row>, String), String> {
    let tz: Tz = opts.timezone.parse().map_err(|e| format!("tz {}: {e}", opts.timezone))?;
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = csv_bytes;

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                if !input.is_empty() {
                    continue;
                }
                break;
            }
            ReadFieldResult::OutputFull => {
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = std::str::from_utf8(&field_buf[..n_out]).unwrap_or("").to_string();
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
    let mut raw_rows: Vec<RawRow> = Vec::with_capacity(1024);
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                if !input.is_empty() {
                    continue;
                }
                break;
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
                    let get = |slot: Option<usize>| -> &str {
                        slot.and_then(|i| row_vals.get(i)).map(String::as_str).unwrap_or("")
                    };
                    let event_ts_raw = get(h_event).trim();
                    if !event_ts_raw.is_empty() {
                        raw_rows.push(RawRow {
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

    let mut rows: Vec<Row> = Vec::with_capacity(raw_rows.len());
    for (idx, raw) in raw_rows.into_iter().enumerate() {
        let event_ns = parse_chronicle_timestamp_ns(&raw.event_timestamp).ok_or_else(|| {
            format!("invalid event_timestamp: {}", raw.event_timestamp)
        })?;
        let tz_str = if raw.timezone.is_empty() { "UTC".to_string() } else { raw.timezone };
        let username = raw.username.replace("Target child", "Target Child");
        let interaction = normalize_interaction_type_local(&raw.interaction_type).to_string();
        let mut row = Row {
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
    let mut seen: AHashSet<(i64, String, String)> = AHashSet::with_capacity(rows.len());
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let key = (
            row.event_timestamp_ns,
            row.interaction_type.clone(),
            row.app_package_name.clone(),
        );
        if seen.insert(key) {
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
    let normalized = if it == "Screen Non-interactive" { "Screen Non-Interactive" } else { it };
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
    let has_dupes = (1..rows.len()).any(|i| rows[i].event_timestamp_ns <= rows[i - 1].event_timestamp_ns);
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
                .map(|(local, abs)| (duplicate_priority(&rows[abs].interaction_type, &stop_types), local))
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
            let final_v = if rounded == 0.0 || rounded.is_nan() { 0.0 } else { rounded };
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
        return if value > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() };
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
    let rest_nonzero = tail.chars().skip(1).any(|c| c != '0');
    let round_up = if first_drop > '5' {
        true
    } else if first_drop < '5' {
        false
    } else {
        // first_drop == '5' — tie if rest is all zeros, else round up
        // (since exact value is > .5...).
        // Either way, round-half-away-from-zero rounds up.
        rest_nonzero || true
    };
    if !round_up {
        if frac_digits == 0 {
            return int_part.to_string();
        }
        return format!("{int_part}.{kept}");
    }
    // Add 1 to the truncated number.
    let combined = if frac_digits == 0 { int_part.to_string() } else { format!("{int_part}{kept}") };
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

fn label_filtered_apps(mut rows: Vec<Row>, filter_map: &HashMap<String, AHashSet<String>>) -> Vec<Row> {
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

fn process_usage_rows(
    rows: Vec<Row>,
    resumed_type: &str,
    paused_type: &str,
    usage_type: &str,
    stopped_type: &str,
    same_stop_types: &AHashSet<String>,
    other_stop_types: &AHashSet<String>,
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
        if it == resumed_type {
            resumed[i] = true;
        }
        if same_stop_types.contains(it) {
            same_stop[i] = true;
        }
        // Phase 1: when model_concurrent_usage is on, every app session runs to
        // its own stop event, so other-app resumes are not treated as stops.
        if !opts.model_concurrent_usage && other_stop_types.contains(it) {
            other_stop[i] = true;
        }
        if it == stopped_type {
            stopped[i] = true;
        }
    }
    let match_options = _rust_app_usage_matcher::MatchOptions {
        allow_stop_event_reuse: opts.allow_stop_event_reuse,
        use_activity_stopped_as_fallback: opts.use_activity_stopped_as_fallback,
        apply_threshold_to_fallback: opts.apply_threshold_to_fallback,
        long_duration_threshold_ns: opts.long_duration_threshold_ns,
    };
    let result = _rust_app_usage_matcher::match_app_usage_update_indices_core(
        &app_codes,
        &timestamps,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        match_options,
    )
    .map_err(|e| format!("matcher: {e}"))?;

    let mut next = rows;
    for &si in &result.start_indices {
        next[si].start_timestamp_ns = Some(next[si].event_timestamp_ns);
    }
    for (k, &si) in result.stop_start_indices.iter().enumerate() {
        let stop_idx = result.stop_event_indices[k];
        next[si].stop_timestamp_ns = Some(next[stop_idx].event_timestamp_ns);
    }
    for &mi in &result.missing_indices {
        next[mi].interaction_type = END_OF_USAGE_MISSING.to_string();
        next[mi].stop_timestamp_ns = None;
        next[mi].duration_seconds = None;
        next[mi].duration_minutes = None;
        if usage_type == FILTERED_APP_USAGE
            || (opts.use_filter_file && next[mi].app_package_name == "android")
        {
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
                    r.duration_seconds = Some(dur_s);
                    r.duration_minutes = Some(dur_s / 60.0);
                }
            }
            r
        })
        .collect();

    // Phase 2: split overlapping sessions and expand each into primary/secondary
    // sub-interval rows. Only applied when model_concurrent_usage is on and
    // this is the App Usage path (not Filtered App Usage — that path has no
    // timing to split because timing is cleared above).
    if opts.model_concurrent_usage && usage_type != FILTERED_APP_USAGE {
        let app_usage_indices: Vec<usize> = out
            .iter()
            .enumerate()
            .filter(|(_, r)| r.interaction_type == usage_type)
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
            .filter(|r| r.interaction_type != usage_type)
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
            row.duration_seconds = Some(dur_s);
            row.duration_minutes = Some(dur_s / 60.0);
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

fn run_app_usage_algorithm(rows: Vec<Row>, opts: &PipelineV2Options) -> Result<Vec<Row>, String> {
    let mut next = rows;
    if opts.use_filter_file {
        let mapping = |v: &str| -> String {
            match v {
                "Activity Paused" => FILTERED_PAUSED.to_string(),
                "Activity Resumed" => FILTERED_RESUMED.to_string(),
                "Activity Stopped" => FILTERED_STOPPED.to_string(),
                "Activity Destroyed" => "Filtered App Destroyed".to_string(),
                other => other.to_string(),
            }
        };
        let same_stop: AHashSet<String> = opts.same_app_stop_types.iter().map(|v| mapping(v)).collect();
        let other_stop: AHashSet<String> = opts.other_stop_types.iter().cloned().collect();
        next = process_usage_rows(
            next,
            FILTERED_RESUMED,
            FILTERED_PAUSED,
            FILTERED_APP_USAGE,
            FILTERED_STOPPED,
            &same_stop,
            &other_stop,
            opts,
        )?;
    }
    if !next
        .iter()
        .any(|r| r.interaction_type == ACTIVITY_RESUMED || r.interaction_type == ACTIVITY_PAUSED)
    {
        return Err("No valid app usage data during the study period".to_string());
    }
    let same_stop: AHashSet<String> = opts.same_app_stop_types.iter().cloned().collect();
    let other_stop: AHashSet<String> = opts.other_stop_types.iter().cloned().collect();
    process_usage_rows(
        next,
        ACTIVITY_RESUMED,
        ACTIVITY_PAUSED,
        APP_USAGE,
        ACTIVITY_STOPPED,
        &same_stop,
        &other_stop,
        opts,
    )
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
    let play_store_broad_idx = codebook_col_index("play_store_broad_app_category").unwrap();
    let usc_broad_idx = codebook_col_index("usc_broad_app_category").unwrap();
    let babyemu_broad_idx = codebook_col_index("babyemu_broad_app_category").unwrap();
    let bcm_broad_idx = codebook_col_index("bcm_cnrc_heuristic_category").unwrap();

    let babyemu_scraped_idx = codebook_col_index("babyemu_genreId_scraped").unwrap();
    let babyemu_manual_idx = codebook_col_index("babyemu_genreId_manual").unwrap();
    let play_store_genre_idx = codebook_col_index("play_store_genreId").unwrap();
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
                    row.codebook_fields[play_store_broad_idx].as_deref(),
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
                for idx in [babyemu_scraped_idx, babyemu_manual_idx, play_store_genre_idx, usc_genre_idx] {
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
                        row.codebook_fields[play_store_genre_idx] = None;
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
            if r.interaction_type == APP_USAGE || r.interaction_type == FILTERED_APP_USAGE {
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
            if r.interaction_type == APP_USAGE { Some(i) } else { None }
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
            update(&mut rows[cur_idx], engage30, engage_custom, switched, gap_hours);
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
        if let Some(&t) = gap_thresholds.iter().find(|&&t| row.data_time_gap_hours >= t) {
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
        .filter(|r| !remove_set.contains(r.interaction_type.as_str()) || r.data_time_gap_hours >= threshold)
        .collect()
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

    if !rows.iter().any(|r| start_set.contains(r.interaction_type.as_str())) {
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

    let mut build = |st: &ScreenState, stop_ts: Option<i64>, stop_event: Option<&str>, sessions: &mut Vec<Row>| {
        let start_row = &rows[st.start_index];
        let mut sr = start_row.clone();
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
        sr.screen_usage_apps_forcing_screen_open_label = if label.is_empty() { None } else { Some(label.clone()) };

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
            if (tg - opts.screen_auto_lock_timeout_seconds).abs() <= opts.screen_auto_lock_tolerance_seconds {
                sr.screen_usage_end_reason = Some("probable_auto_lock".to_string());
                sr.screen_usage_end_reason_confidence = Some(0.9);
                sessions.push(sr);
                return;
            }
        }
        if st.lock_screen_seen {
            let near = keyguard_ts
                .iter()
                .any(|&kg| ((stop_ns - kg) as f64 / 1e9).abs() <= opts.screen_keyguard_near_stop_seconds);
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
        let pkg = if row.app_package_name.is_empty() { None } else { Some(row.app_package_name.clone()) };
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
                });
            }
            continue;
        }
        let Some(s) = state.as_mut() else { continue };
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
            build(&s_clone, Some(row.event_timestamp_ns), Some(&stop_event), &mut sessions);
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
    cols.push(format!("valid_app_new_engage_custom_{}s", format_custom_dur(opts.custom_app_engagement_duration)));
    cols.push("valid_app_switched_app".into());
    cols.push("valid_app_usage_time_gap_hours".into());
    cols.push("any_app_new_engage_30s".into());
    cols.push(format!("any_app_new_engage_custom_{}s", format_custom_dur(opts.custom_app_engagement_duration)));
    cols.push("any_app_switched_app".into());
    cols.push("any_app_usage_time_gap_hours".into());
    cols.push("preprocessor_version".into());
    cols.push("datetime_of_preprocessing".into());
    if opts.model_concurrent_usage {
        cols.push("usage_layer".into());
    }
    cols
}

fn format_custom_dur(d: f64) -> String {
    js_number_to_string(d)
}

fn build_screen_columns() -> Vec<String> {
    vec![
        "study_id", "study_name", "participant_id", "possible_device_model", "username",
        "event_timestamp", "date", "timezone", "app_package_name", "application_label",
        "interaction_type", "start_timestamp", "stop_timestamp", "duration_seconds",
        "duration_minutes", "screen_usage_end_reason", "screen_usage_end_reason_confidence",
        "screen_usage_stop_event_type", "screen_usage_last_activity_timestamp",
        "screen_usage_tail_gap_seconds", "screen_usage_foreground_app_package",
        "screen_usage_apps_forcing_screen_open_label", "screen_usage_lock_screen_only",
        "data_time_gap_hours", "day", "weekdayMF", "weekdayMTh", "weekdaySuTh", "hour",
        "quarter", "preprocessor_version", "datetime_of_preprocessing",
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
        let mut emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
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
            emit(&mut out, row.genre_id_scraped.as_deref().unwrap_or(""), &mut first);
        }
        if opts.use_app_codebook && include_aliases {
            emit(&mut out, row.broad_app_category.as_deref().unwrap_or(""), &mut first);
        }
        if opts.use_app_codebook {
            for (i, _) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
                let val = row.codebook_fields.get(i).and_then(|v| v.as_deref()).unwrap_or("");
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
        emit(&mut out, &format_csv_number_float(row.duration_seconds), &mut first);
        emit(&mut out, &format_csv_number_float(row.duration_minutes), &mut first);
        emit(&mut out, &row.any_app_usage_flags, &mut first);
        emit(&mut out, &normalize_float_string(row.data_time_gap_hours), &mut first);
        emit(&mut out, &row.day.to_string(), &mut first);
        emit(&mut out, &row.weekday_mf.to_string(), &mut first);
        emit(&mut out, &row.weekday_mth.to_string(), &mut first);
        emit(&mut out, &row.weekday_su_th.to_string(), &mut first);
        emit(&mut out, &row.hour.to_string(), &mut first);
        emit(&mut out, &row.quarter.to_string(), &mut first);
        emit(&mut out, &format_csv_int(row.valid_app_new_engage_30s), &mut first);
        emit(&mut out, &format_csv_int(row.valid_app_new_engage_custom), &mut first);
        emit(&mut out, &format_csv_int(row.valid_app_switched_app), &mut first);
        emit(&mut out, &normalize_float_string(row.valid_app_usage_time_gap_hours), &mut first);
        emit(&mut out, &format_csv_int(row.any_app_new_engage_30s), &mut first);
        emit(&mut out, &format_csv_int(row.any_app_new_engage_custom), &mut first);
        emit(&mut out, &format_csv_int(row.any_app_switched_app), &mut first);
        emit(&mut out, &normalize_float_string(row.any_app_usage_time_gap_hours), &mut first);
        emit(&mut out, pp_version, &mut first);
        emit(&mut out, dop, &mut first);
        if opts.model_concurrent_usage {
            emit(&mut out, row.usage_layer.as_deref().unwrap_or(""), &mut first);
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
        let last_act = fmt_screen_last_activity(row.screen_usage_last_activity_timestamp_ns, row_tz);
        let mut first = true;
        let mut emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
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
        emit(&mut out, &format_csv_number_float(row.duration_seconds), &mut first);
        emit(&mut out, &format_csv_number_float(row.duration_minutes), &mut first);
        emit(&mut out, row.screen_usage_end_reason.as_deref().unwrap_or(""), &mut first);
        emit(&mut out, &format_csv_number_float(row.screen_usage_end_reason_confidence), &mut first);
        emit(&mut out, row.screen_usage_stop_event_type.as_deref().unwrap_or(""), &mut first);
        emit(&mut out, &last_act, &mut first);
        emit(&mut out, &format_csv_number_float(row.screen_usage_tail_gap_seconds), &mut first);
        emit(&mut out, row.screen_usage_foreground_app_package.as_deref().unwrap_or(""), &mut first);
        emit(&mut out, row.screen_usage_apps_forcing_screen_open_label.as_deref().unwrap_or(""), &mut first);
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
    // 1. parse + sort + canonicalize
    let (mut rows, _tz) = parse_raw_rows(csv_bytes, opts)?;
    let original_count = rows.len() as u32;

    // 2. timezone (already resolved by caller; just normalize per-row tz)
    // The caller passes opts.timezone as the *target* tz. To match TS
    // behaviour the row.timezone fields are set to the target and time-cols
    // recomputed. For "filter" modes the caller has already filtered the
    // rows by tz before passing them in.
    let tz: Tz = opts.timezone.parse().map_err(|e| format!("tz: {e}"))?;
    for row in rows.iter_mut() {
        row.timezone = opts.timezone.clone();
        populate_time_columns(row, tz);
    }

    // 3. dedupe + (optional) unalign duplicate timestamps + mark gaps
    let deduped = dedupe_exact_rows(rows);
    let dupes_before = count_duplicate_groups(&deduped);
    let dupe_corrected = if opts.correct_duplicate_event_timestamps {
        unalign_duplicate_timestamps(deduped, opts)
    } else {
        deduped
    };
    let dupes_corrected = if opts.correct_duplicate_event_timestamps { dupes_before } else { 0 };
    let mut rows = mark_data_time_gaps(dupe_corrected);

    // 4. filter labeling
    let filter_map = if opts.use_filter_file && !filter_csv.is_empty() {
        parse_filter_csv(filter_csv)
    } else {
        HashMap::new()
    };
    if opts.use_filter_file {
        rows = label_filtered_apps(rows, &filter_map);
    }
    let apps_forcing_map = if opts.use_apps_forcing_screen_open && !apps_forcing_csv.is_empty() {
        parse_apps_forcing_csv(apps_forcing_csv)
    } else {
        HashMap::new()
    };

    // 5. screen-usage derivation (if requested)
    let mut screen_rows: Vec<Row> = Vec::new();
    if matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    ) {
        screen_rows = derive_screen_usage_sessions_full(&rows, opts, &apps_forcing_map);
    }

    let processed_count;
    let app_csv_bytes;
    let screen_csv_bytes;
    let app_row_count;
    let screen_row_count = screen_rows.len() as u32;

    if matches!(opts.usage_session_mode, UsageSessionMode::ScreenUsage) {
        processed_count = rows.len() as u32;
        app_row_count = 0;
        app_csv_bytes = Vec::new();
        screen_csv_bytes = if opts.include_screen_output {
            write_screen_csv(&screen_rows, opts)
        } else {
            Vec::new()
        };
    } else {
        // 6. matcher (app usage)
        rows = run_app_usage_algorithm(rows, opts)?;

        // 7. codebook
        let codebook_map = if opts.use_app_codebook && !codebook_csv.is_empty() {
            parse_codebook_csv(codebook_csv)
        } else {
            HashMap::new()
        };

        // 8. enrich
        enrich_codebook(&mut rows, opts, &codebook_map);
        add_app_usage_detail_columns(&mut rows, opts);
        mark_app_usage_flags(&mut rows, opts);
        clear_filtered_usage_timing(&mut rows);
        rows = remove_selected_interaction_types(rows, opts);

        let include_aliases = !(opts.use_app_codebook && !codebook_map.is_empty());
        processed_count = rows.len() as u32;
        app_row_count = processed_count;
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

    Ok(PipelineV2Result {
        app_csv_bytes,
        screen_csv_bytes,
        original_row_count: original_count,
        processed_row_count: processed_count,
        app_row_count,
        screen_row_count,
        duplicate_timestamps_corrected: dupes_corrected,
    })
}

// ---- unit tests ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
