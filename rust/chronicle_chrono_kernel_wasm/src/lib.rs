//! Lean Rust kernels for the Chronicle browser pipeline.
//!
//! Three kernels exposed to JS via wasm-bindgen:
//! * `format_timestamps`        — chrono-tz batched timestamp formatter.
//! * `parse_raw_csv`            — batched CSV parser yielding typed columns.
//! * `dedupe_event_rows`        — exact-row dedup keyed on (ts_ns, interaction, package).
//! * `write_app_csv`            — batched CSV writer for the app-output bundle.
//!
//! Each kernel is designed for one boundary call per pipeline stage. The
//! inputs/outputs are columnar to amortize the WASM↔JS marshalling cost.

use ahash::AHashSet;
use chrono::{DateTime, Datelike, NaiveDateTime, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use serde::Serialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

pub mod pipeline_v2;
pub mod step_contract;
pub use pipeline_v2::process_full_pipeline_v2;

fn ser_with_bigint<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let serializer =
        serde_wasm_bindgen::Serializer::new().serialize_large_number_types_as_bigints(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsValue::from_str(&format!("ser: {e}")))
}

// ----- format_timestamps -------------------------------------------------

#[derive(Serialize)]
pub struct FormattedColumns {
    pub event_timestamp_strings: Vec<String>,
    pub dates: Vec<String>,
    pub hours: Vec<u8>,
    pub days: Vec<u8>,
    pub quarters: Vec<u8>,
}

pub(crate) fn weekday_chronicle(w: chrono::Weekday) -> u8 {
    match w {
        chrono::Weekday::Sun => 1,
        chrono::Weekday::Mon => 2,
        chrono::Weekday::Tue => 3,
        chrono::Weekday::Wed => 4,
        chrono::Weekday::Thu => 5,
        chrono::Weekday::Fri => 6,
        chrono::Weekday::Sat => 7,
    }
}

fn format_one(ts_ns: i64, tz: Tz) -> (String, String, u8, u8, u8) {
    let secs = ts_ns.div_euclid(1_000_000_000);
    let nanos = ts_ns.rem_euclid(1_000_000_000) as u32;
    let utc = chrono::Utc
        .timestamp_opt(secs, nanos)
        .single()
        .expect("valid timestamp");
    let local: DateTime<Tz> = utc.with_timezone(&tz);
    let event_string = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    );
    let date = format!(
        "{:04}-{:02}-{:02}",
        local.year(),
        local.month(),
        local.day()
    );
    let hour = local.hour() as u8;
    let day = weekday_chronicle(local.weekday());
    let quarter = ((local.month() as u8 - 1) / 3) + 1;
    (event_string, date, hour, day, quarter)
}

#[wasm_bindgen]
pub fn format_timestamps(ts_ns: &[i64], tz_name: &str) -> Result<JsValue, JsValue> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|e| JsValue::from_str(&format!("invalid timezone {tz_name:?}: {e}")))?;
    let mut event_timestamp_strings = Vec::with_capacity(ts_ns.len());
    let mut dates = Vec::with_capacity(ts_ns.len());
    let mut hours = Vec::with_capacity(ts_ns.len());
    let mut days = Vec::with_capacity(ts_ns.len());
    let mut quarters = Vec::with_capacity(ts_ns.len());
    for &ns in ts_ns {
        let (es, d, h, dy, q) = format_one(ns, tz);
        event_timestamp_strings.push(es);
        dates.push(d);
        hours.push(h);
        days.push(dy);
        quarters.push(q);
    }
    let cols = FormattedColumns {
        event_timestamp_strings,
        dates,
        hours,
        days,
        quarters,
    };
    ser_with_bigint(&cols)
}

// ----- parse_raw_csv -----------------------------------------------------

#[derive(Serialize, Default)]
pub struct ParsedColumns {
    pub event_timestamp_ns: Vec<i64>,
    pub timezone: Vec<String>,
    pub app_package_name: Vec<String>,
    pub interaction_type: Vec<String>,
    pub application_label: Vec<String>,
    pub study_id: Vec<String>,
    pub participant_id: Vec<String>,
    pub username: Vec<String>,
    /// Number of rows discarded for empty event_timestamp.
    pub dropped_empty: u32,
    /// Number of rows whose event_timestamp could not be parsed.
    pub dropped_invalid: u32,
}

/// Maps raw Chronicle Android interaction codes → canonical Chronicle types.
/// Mirrors `ALL_INTERACTION_TYPES_MAP` in browserPipeline.ts.
pub fn normalize_interaction_type(s: &str) -> &str {
    match s {
        "Instance of Usage for an App" => "App Usage",
        "Screen Usage" => "Screen Usage",
        "Activity Resumed for a Filtered App" => "Filtered App Resumed",
        "Activity Paused for a Filtered App" => "Filtered App Paused",
        "Instance of Usage for a Filtered App" => "Filtered App Usage",
        "Missing End of Usage after an App Starts Being Used" => "End of Usage Missing",
        "Unknown importance: 1" | "Move to Foreground" => "Activity Resumed",
        "Unknown importance: 2" | "Move to Background" => "Activity Paused",
        "Unknown importance: 3" => "End of Day",
        "Unknown importance: 4" => "Continue Previous Day",
        "Unknown importance: 5" => "Configuration Change",
        "Unknown importance: 6" => "System Interaction",
        "Unknown importance: 7" => "User Interaction",
        "Unknown importance: 8" => "Shortcut Invocation",
        "Unknown importance: 9" => "Chooser Action",
        "Unknown importance: 10" => "Notification Seen",
        "Unknown importance: 11" => "Standby Bucket Changed",
        "Unknown importance: 12" => "Notification Interruption",
        "Unknown importance: 13" => "Slice Pinned Priv",
        "Unknown importance: 14" => "Slice Pinned App",
        "Unknown importance: 15" => "Screen Interactive",
        "Unknown importance: 16" => "Screen Non-Interactive",
        "Unknown importance: 17" => "Keyguard Shown",
        "Unknown importance: 18" => "Keyguard Hidden",
        "Unknown importance: 19" => "Foreground Service Start",
        "Unknown importance: 20" => "Foreground Service Stop",
        "Unknown importance: 21" => "Continuing Foreground Service",
        "Unknown importance: 22" => "Rollover Foreground Service",
        "Unknown importance: 23" => "Activity Stopped",
        "Unknown importance: 24" => "Activity Destroyed",
        "Unknown importance: 25" => "Flush to Disk",
        "Unknown importance: 26" => "Device Shutdown",
        "Unknown importance: 27" => "Device Startup",
        "Unknown importance: 28" => "User Unlocked",
        "Unknown importance: 29" => "User Stopped",
        "Unknown importance: 30" => "Locus ID Set",
        "Unknown importance: 31" => "App Component Used",
        other => other,
    }
}

/// True when the raw value is either a supported Android event spelling or
/// one of the canonical values produced by [`normalize_interaction_type`].
/// Keeping this beside the authoritative mapping prevents browser inspection
/// from drifting from preprocessing behavior.
pub fn is_recognized_interaction_type(s: &str) -> bool {
    normalize_interaction_type(s) != s
        || matches!(
            s,
            "App Usage"
                | "Screen Usage"
                | "Filtered App Resumed"
                | "Filtered App Paused"
                | "Filtered App Usage"
                | "End of Usage Missing"
                | "Activity Resumed"
                | "Activity Paused"
                | "End of Day"
                | "Continue Previous Day"
                | "Configuration Change"
                | "System Interaction"
                | "User Interaction"
                | "Shortcut Invocation"
                | "Chooser Action"
                | "Notification Seen"
                | "Standby Bucket Changed"
                | "Notification Interruption"
                | "Slice Pinned Priv"
                | "Slice Pinned App"
                | "Screen Interactive"
                | "Screen Non-Interactive"
                | "Keyguard Shown"
                | "Keyguard Hidden"
                | "Foreground Service Start"
                | "Foreground Service Stop"
                | "Continuing Foreground Service"
                | "Rollover Foreground Service"
                | "Activity Stopped"
                | "Activity Destroyed"
                | "Flush to Disk"
                | "Device Shutdown"
                | "Device Startup"
                | "User Unlocked"
                | "User Stopped"
                | "Locus ID Set"
                | "App Component Used"
        )
}

pub fn is_valid_chronicle_timezone(s: &str) -> bool {
    s.parse::<Tz>().is_ok()
}

pub(crate) const REQUIRED_COLUMNS: &[&str] = &[
    "event_timestamp",
    "timezone",
    "app_package_name",
    "interaction_type",
    "application_label",
    "study_id",
    "participant_id",
    "username",
];

pub fn parse_chronicle_timestamp_ns(text: &str) -> Option<i64> {
    if text.is_empty() {
        return None;
    }
    // Forms accepted by the TS pipeline:
    //   YYYY-MM-DD HH:MM:SS[.fff]
    //   YYYY-MM-DDTHH:MM:SS[.fff]
    //   ...Z  -> +00:00
    //   ...+HH:MM / -HH:MM offset
    let mut text = text.replace('T', " ");
    if let Some(stripped) = text.strip_suffix('Z') {
        text = format!("{stripped}+00:00");
    }
    let has_offset = text.rfind(['+', '-']).filter(|&i| i >= 19).is_some();
    let parsed: Option<DateTime<chrono::FixedOffset>> = if has_offset {
        DateTime::parse_from_str(&text, "%Y-%m-%d %H:%M:%S%:z")
            .or_else(|_| DateTime::parse_from_str(&text, "%Y-%m-%d %H:%M:%S%.f%:z"))
            .ok()
    } else {
        let utc = chrono::FixedOffset::east_opt(0).unwrap();
        NaiveDateTime::parse_from_str(&text, "%Y-%m-%d %H:%M:%S")
            .or_else(|_| NaiveDateTime::parse_from_str(&text, "%Y-%m-%d %H:%M:%S%.f"))
            .ok()
            .and_then(|nd| utc.from_local_datetime(&nd).single())
    };
    parsed.map(|dt| dt.timestamp_nanos_opt().unwrap_or(0))
}

#[wasm_bindgen]
pub fn parse_raw_csv(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let cols = parse_internal(bytes).map_err(|e| JsValue::from_str(&e))?;
    ser_with_bigint(&cols)
}

// ----- sort_by_timestamp_stable -----------------------------------------

/// Stable sort of a timestamp column. Returns a permutation array of u32
/// row indices such that ts_ns[result[i]] is non-decreasing, with original
/// position breaking ties.
///
/// Boundary: BigInt64Array in, Uint32Array out. Cheap.
#[wasm_bindgen]
pub fn sort_by_timestamp_stable(ts_ns: &[i64]) -> Vec<u32> {
    let n = ts_ns.len();
    let mut indices: Vec<u32> = (0..n as u32).collect();
    // sort_by_key is stable.
    indices.sort_by_key(|&i| ts_ns[i as usize]);
    indices
}

// ----- process_pipeline_e2e ---------------------------------------------

/// End-to-end pipeline: raw CSV bytes IN → processed CSV bytes OUT.
/// Does parse + sort + dedup + format + write entirely in Rust. The only
/// boundary crossings are the two byte arrays.
///
/// Output columns (subset of the real pipeline, enough to be representative
/// and to compare against an equivalent TS path):
///   event_timestamp, app_package_name, interaction_type, date, hour, day
#[wasm_bindgen]
pub fn process_pipeline_e2e(csv_bytes: &[u8], tz_name: &str) -> Result<Vec<u8>, JsValue> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|e| JsValue::from_str(&format!("invalid timezone {tz_name:?}: {e}")))?;

    let cols = parse_internal(csv_bytes).map_err(|e| JsValue::from_str(&format!("parse: {e}")))?;
    let n = cols.event_timestamp_ns.len();

    // 1. Stable sort indices by timestamp_ns.
    let mut indices: Vec<u32> = (0..n as u32).collect();
    indices.sort_by_key(|&i| cols.event_timestamp_ns[i as usize]);

    // 2. Dedup in sorted order on (ts, interaction, package).
    let mut seen: AHashSet<(i64, &str, &str)> = AHashSet::with_capacity(n);
    let mut kept: Vec<u32> = Vec::with_capacity(n);
    for &i in &indices {
        let i_us = i as usize;
        let key = (
            cols.event_timestamp_ns[i_us],
            cols.interaction_type[i_us].as_str(),
            cols.app_package_name[i_us].as_str(),
        );
        if seen.insert(key) {
            kept.push(i);
        }
    }

    // 3. Format + write.
    let mut out: Vec<u8> = Vec::with_capacity(kept.len() * 96);
    out.extend_from_slice(b"event_timestamp,app_package_name,interaction_type,date,hour,day\n");

    use std::fmt::Write as _;
    let mut scratch = String::with_capacity(64);
    for &i in &kept {
        let i_us = i as usize;
        let ns = cols.event_timestamp_ns[i_us];
        let secs = ns.div_euclid(1_000_000_000);
        let nanos = ns.rem_euclid(1_000_000_000) as u32;
        let utc = chrono::Utc
            .timestamp_opt(secs, nanos)
            .single()
            .ok_or_else(|| JsValue::from_str("invalid ts"))?;
        let local: DateTime<Tz> = utc.with_timezone(&tz);

        // event_timestamp
        scratch.clear();
        let _ = write!(
            scratch,
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
            local.year(),
            local.month(),
            local.day(),
            local.hour(),
            local.minute(),
            local.second(),
            local.format("%:z"),
        );
        write_csv_field(&mut out, scratch.as_bytes());
        out.push(b',');
        // app_package_name
        write_csv_field(&mut out, cols.app_package_name[i_us].as_bytes());
        out.push(b',');
        // interaction_type
        write_csv_field(&mut out, cols.interaction_type[i_us].as_bytes());
        out.push(b',');
        // date
        scratch.clear();
        let _ = write!(
            scratch,
            "{:04}-{:02}-{:02}",
            local.year(),
            local.month(),
            local.day()
        );
        out.extend_from_slice(scratch.as_bytes());
        out.push(b',');
        // hour
        write_u8(&mut out, local.hour() as u8);
        out.push(b',');
        // day (Chronicle 1=Sun..7=Sat)
        write_u8(&mut out, weekday_chronicle(local.weekday()));
        out.push(b'\n');
    }
    Ok(out)
}

// Internal CSV-parse extracted so process_pipeline_e2e can reuse it without
// going through serde_wasm_bindgen.
fn parse_internal(bytes: &[u8]) -> Result<ParsedColumns, String> {
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = bytes;

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                // csv-core requires empty-input calls to continue until End;
                // that flushes the final record when the file has no trailing
                // newline. Breaking here silently dropped that record.
                continue;
            }
            ReadFieldResult::OutputFull => {
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = std::str::from_utf8(&field_buf[..n_out])
                    .map_err(|e| format!("header utf8: {e}"))?
                    .to_string();
                headers.push(s);
                if record_end {
                    break;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let mut col_index: HashMap<&str, usize> = HashMap::new();
    for (i, name) in headers.iter().enumerate() {
        col_index.insert(name.as_str(), i);
    }
    let required_indices: Vec<Option<usize>> = REQUIRED_COLUMNS
        .iter()
        .map(|c| col_index.get(c).copied())
        .collect();

    let mut cols = ParsedColumns::default();
    let mut row: Vec<String> = vec![String::new(); headers.len()];
    let mut col_idx = 0usize;

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
                if col_idx < row.len() {
                    let s = std::str::from_utf8(&field_buf[..n_out])
                        .map_err(|e| format!("field utf8: {e}"))?;
                    row[col_idx].clear();
                    row[col_idx].push_str(s);
                }
                col_idx += 1;
                if record_end {
                    let get = |slot: usize| -> &str {
                        required_indices[slot]
                            .and_then(|i| row.get(i))
                            .map(String::as_str)
                            .unwrap_or("")
                    };
                    let event_ts_text = get(0);
                    if event_ts_text.is_empty() {
                        cols.dropped_empty += 1;
                    } else {
                        match parse_chronicle_timestamp_ns(event_ts_text) {
                            Some(ns) => {
                                cols.event_timestamp_ns.push(ns);
                                cols.timezone.push(get(1).to_string());
                                cols.app_package_name.push(get(2).to_string());
                                cols.interaction_type
                                    .push(normalize_interaction_type(get(3)).to_string());
                                cols.application_label.push(get(4).to_string());
                                cols.study_id.push(get(5).to_string());
                                cols.participant_id.push(get(6).to_string());
                                cols.username.push(get(7).to_string());
                            }
                            None => cols.dropped_invalid += 1,
                        }
                    }
                    for slot in row.iter_mut() {
                        slot.clear();
                    }
                    col_idx = 0;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    Ok(cols)
}

// ----- derive_screen_usage_sessions -------------------------------------
//
// Port of `deriveScreenUsageSessions` from
// `web/src/lib/browserPipeline.ts:1299`. State machine over events that
// produces one row per detected screen-usage session.
//
// Output columns (mirrors the screen subset of buildScreenOutputBundle):
//   start_timestamp_ns  i64    -1 if missing
//   stop_timestamp_ns   i64    -1 if missing
//   duration_seconds    f64    NaN if missing
//   foreground_app      String
//   end_reason          String
//   end_reason_confidence f64  NaN if none
//   stop_event_type     String  "" if missing
//   last_activity_ns    i64     -1 if missing
//   tail_gap_seconds    f64     NaN if not computed
//   apps_forcing_label  String  "" if none
//   lock_screen_only    u8      0 or 1
//   timezone            String  carried from the start event

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

#[derive(Clone)]
struct ScreenSessionState {
    start_index: usize,
    start_ts_ns: i64,
    start_tz: String,
    lock_screen_seen: bool,
    unlocked_seen: bool,
    foreground_pkg: Option<String>,
    last_meaningful_ts_ns: Option<i64>,
    last_meaningful_pkg: Option<String>,
}

#[derive(Serialize)]
pub struct ScreenSessionRow {
    pub start_index: u32,
    pub start_timestamp_ns: i64,
    pub stop_timestamp_ns: i64, // -1 = missing
    pub duration_seconds: Option<f64>,
    pub foreground_app: String,
    pub end_reason: String,
    pub end_reason_confidence: f64, // 0.0 if none
    pub stop_event_type: String,
    pub last_activity_ns: i64, // -1 if none
    pub tail_gap_seconds: Option<f64>,
    pub apps_forcing_label: String,
    pub lock_screen_only: u8,
    pub timezone: String,
}

#[allow(clippy::too_many_arguments)]
fn build_screen_session(
    state: &ScreenSessionState,
    stop_ts_ns: Option<i64>,
    stop_event_type: Option<&str>,
    apps_forcing_lookup: &HashMap<String, String>,
    keyguard_shown_ts: &[i64],
    auto_lock_timeout_secs: f64,
    auto_lock_tolerance_secs: f64,
    manual_lock_max_tail_secs: f64,
    keyguard_near_stop_secs: f64,
) -> ScreenSessionRow {
    let foreground_app = state.foreground_pkg.clone().unwrap_or_default();
    let stop_ts = stop_ts_ns.unwrap_or(-1);
    let duration_seconds = stop_ts_ns.map(|stop| (stop - state.start_ts_ns) as f64 / 1e9);
    let tail_gap_seconds = stop_ts_ns.and_then(|stop| {
        state
            .last_meaningful_ts_ns
            .map(|last| (stop - last) as f64 / 1e9)
    });
    let last_pkg = state
        .last_meaningful_pkg
        .clone()
        .or_else(|| state.foreground_pkg.clone())
        .unwrap_or_default();
    let apps_forcing_label = apps_forcing_lookup
        .get(&last_pkg)
        .cloned()
        .unwrap_or_default();

    let (end_reason, confidence, lock_screen_only) = if stop_ts_ns.is_none() {
        ("missing_stop".to_string(), 1.0, 0u8)
    } else if state.lock_screen_seen && !state.unlocked_seen && state.foreground_pkg.is_none() {
        ("lock_screen_only".to_string(), 0.95, 1u8)
    } else if let Some(tail) = tail_gap_seconds {
        if !apps_forcing_label.is_empty() && tail > auto_lock_timeout_secs {
            ("app_kept_awake_or_extended".to_string(), 0.9, 0u8)
        } else if tail <= manual_lock_max_tail_secs {
            ("probable_manual_lock".to_string(), 0.85, 0u8)
        } else if (tail - auto_lock_timeout_secs).abs() <= auto_lock_tolerance_secs {
            ("probable_auto_lock".to_string(), 0.9, 0u8)
        } else if state.lock_screen_seen
            && keyguard_shown_ts
                .iter()
                .any(|&kg_ts| ((kg_ts - stop_ts) as f64 / 1e9).abs() <= keyguard_near_stop_secs)
        {
            ("probable_manual_lock".to_string(), 0.7, 0u8)
        } else {
            ("extended_idle_or_unknown".to_string(), 0.5, 0u8)
        }
    } else if state.lock_screen_seen
        && keyguard_shown_ts
            .iter()
            .any(|&kg_ts| ((kg_ts - stop_ts) as f64 / 1e9).abs() <= keyguard_near_stop_secs)
    {
        ("probable_manual_lock".to_string(), 0.7, 0u8)
    } else {
        ("unknown".to_string(), 0.25, 0u8)
    };

    ScreenSessionRow {
        start_index: state.start_index as u32,
        start_timestamp_ns: state.start_ts_ns,
        stop_timestamp_ns: stop_ts,
        duration_seconds,
        foreground_app,
        end_reason,
        end_reason_confidence: confidence,
        stop_event_type: stop_event_type.unwrap_or("").to_string(),
        last_activity_ns: state.last_meaningful_ts_ns.unwrap_or(-1),
        tail_gap_seconds,
        apps_forcing_label,
        lock_screen_only,
        timezone: state.start_tz.clone(),
    }
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn derive_screen_usage_sessions(
    event_timestamp_ns: &[i64],
    interaction_type: Vec<String>,
    app_package_name: Vec<String>,
    timezone: Vec<String>,
    apps_forcing_keys: Vec<String>,
    apps_forcing_values: Vec<String>,
    auto_lock_timeout_seconds: i32,
    auto_lock_tolerance_seconds: i32,
    manual_lock_max_tail_seconds: i32,
    keyguard_near_stop_seconds: i32,
) -> Result<JsValue, JsValue> {
    let n = event_timestamp_ns.len();
    if interaction_type.len() != n || app_package_name.len() != n || timezone.len() != n {
        return Err(JsValue::from_str(
            "derive_screen_usage_sessions: column lengths must match",
        ));
    }
    let start_set: AHashSet<&str> = SCREEN_START_EVENTS.iter().copied().collect();
    let stop_set: AHashSet<&str> = SCREEN_STOP_EVENTS.iter().copied().collect();
    let lock_set: AHashSet<&str> = LOCK_SCREEN_EVENTS.iter().copied().collect();
    let unlock_set: AHashSet<&str> = UNLOCK_EVENTS.iter().copied().collect();
    let fg_set: AHashSet<&str> = FOREGROUND_EVENTS.iter().copied().collect();
    let meaningful_set: AHashSet<&str> = MEANINGFUL_ACTIVITY_EVENTS.iter().copied().collect();

    let mut apps_forcing: HashMap<String, String> = HashMap::with_capacity(apps_forcing_keys.len());
    for (k, v) in apps_forcing_keys
        .into_iter()
        .zip(apps_forcing_values.into_iter())
    {
        apps_forcing.insert(k, v);
    }

    // Pre-collect keyguard-shown timestamps (sorted ascending).
    let mut keyguard_shown_ts: Vec<i64> = Vec::new();
    for i in 0..n {
        if lock_set.contains(interaction_type[i].as_str()) {
            keyguard_shown_ts.push(event_timestamp_ns[i]);
        }
    }
    keyguard_shown_ts.sort_unstable();

    let auto_lock_timeout_secs = auto_lock_timeout_seconds as f64;
    let auto_lock_tolerance_secs = auto_lock_tolerance_seconds as f64;
    let manual_lock_max_tail_secs = manual_lock_max_tail_seconds as f64;
    let keyguard_near_stop_secs = keyguard_near_stop_seconds as f64;

    let mut sessions: Vec<ScreenSessionRow> = Vec::new();
    let mut state: Option<ScreenSessionState> = None;

    let any_starts = interaction_type
        .iter()
        .any(|it| start_set.contains(it.as_str()));
    if !any_starts {
        return ser_with_bigint(&sessions);
    }

    for i in 0..n {
        let it = interaction_type[i].as_str();
        let pkg = if app_package_name[i].is_empty() {
            None
        } else {
            Some(app_package_name[i].clone())
        };

        if start_set.contains(it) {
            if state.is_none() {
                state = Some(ScreenSessionState {
                    start_index: i,
                    start_ts_ns: event_timestamp_ns[i],
                    start_tz: timezone[i].clone(),
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
            s.last_meaningful_ts_ns = Some(event_timestamp_ns[i]);
            s.last_meaningful_pkg = pkg.clone().or_else(|| s.foreground_pkg.clone());
        }
        if stop_set.contains(it) {
            let session = build_screen_session(
                s,
                Some(event_timestamp_ns[i]),
                Some(it),
                &apps_forcing,
                &keyguard_shown_ts,
                auto_lock_timeout_secs,
                auto_lock_tolerance_secs,
                manual_lock_max_tail_secs,
                keyguard_near_stop_secs,
            );
            sessions.push(session);
            state = None;
        }
    }
    if let Some(s) = state.take() {
        let session = build_screen_session(
            &s,
            None,
            None,
            &apps_forcing,
            &keyguard_shown_ts,
            auto_lock_timeout_secs,
            auto_lock_tolerance_secs,
            manual_lock_max_tail_secs,
            keyguard_near_stop_secs,
        );
        sessions.push(session);
    }

    ser_with_bigint(&sessions)
}

// ----- process_full_pipeline_e2e ----------------------------------------
//
// Full end-to-end pipeline including filter labeling and the matcher.
// Mirrors the app-usage path of the TS `processRawCsvContent` for a
// representative subset of columns.
//
// Stages performed:
//   1. parse CSV -> typed columns
//   2. stable sort by event_timestamp_ns
//   3. exact-row dedup on (ts, interaction, package)
//   4. app-filter labeling: rename interaction_type for filtered packages
//      ("Activity Resumed" -> "Filtered App Resumed",
//       "Activity Paused"  -> "Filtered App Paused")
//   5. matcher: pair Activity Resumed events with stop events to compute
//      session start/stop timestamps via chronicle_app_usage_matcher
//   6. enrich: derive duration_seconds, drop "Activity Paused" rows,
//      drop "Activity Resumed" rows without a closed session, rename
//      "Activity Resumed" -> "App Usage" or "Filtered App Usage"
//   7. format event_timestamp with chrono-tz
//   8. write CSV bytes (event_timestamp, app_package_name, interaction_type,
//      duration_seconds, date, hour, day)

const ACTIVITY_RESUMED: &str = "Activity Resumed";
const ACTIVITY_PAUSED: &str = "Activity Paused";
const ACTIVITY_STOPPED: &str = "Activity Stopped";
const FILTERED_RESUMED: &str = "Filtered App Resumed";
const FILTERED_PAUSED: &str = "Filtered App Paused";
const APP_USAGE: &str = "App Usage";
const FILTERED_APP_USAGE: &str = "Filtered App Usage";
const END_OF_USAGE_MISSING: &str = "End of Usage Missing";

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn process_full_pipeline_e2e(
    csv_bytes: &[u8],
    tz_name: &str,
    filtered_packages: Vec<String>,
    same_stop_types: Vec<String>,
    other_stop_types: Vec<String>,
    long_duration_threshold_ns: i64,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
) -> Result<Vec<u8>, JsValue> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|e| JsValue::from_str(&format!("invalid timezone {tz_name:?}: {e}")))?;

    // 1. parse
    let cols = parse_internal(csv_bytes).map_err(|e| JsValue::from_str(&format!("parse: {e}")))?;
    let n = cols.event_timestamp_ns.len();

    // 2. stable sort indices by ts_ns
    let mut sort_idx: Vec<u32> = (0..n as u32).collect();
    sort_idx.sort_by_key(|&i| cols.event_timestamp_ns[i as usize]);

    // 3. dedup in sorted order
    let mut seen: AHashSet<(i64, &str, &str)> = AHashSet::with_capacity(n);
    let mut kept: Vec<u32> = Vec::with_capacity(n);
    for &i in &sort_idx {
        let i_us = i as usize;
        let key = (
            cols.event_timestamp_ns[i_us],
            cols.interaction_type[i_us].as_str(),
            cols.app_package_name[i_us].as_str(),
        );
        if seen.insert(key) {
            kept.push(i);
        }
    }

    // 4. apply filter labeling to interaction_type for filtered packages
    let filter_set: AHashSet<&str> = filtered_packages.iter().map(String::as_str).collect();
    let same_stop_set: AHashSet<&str> = same_stop_types.iter().map(String::as_str).collect();
    let other_stop_set: AHashSet<&str> = other_stop_types.iter().map(String::as_str).collect();

    let kept_count = kept.len();
    let mut working_ts: Vec<i64> = Vec::with_capacity(kept_count);
    let mut working_pkg: Vec<String> = Vec::with_capacity(kept_count);
    let mut working_int: Vec<String> = Vec::with_capacity(kept_count);
    for &i in &kept {
        let i_us = i as usize;
        let pkg = &cols.app_package_name[i_us];
        let mut interaction = cols.interaction_type[i_us].clone();
        if filter_set.contains(pkg.as_str()) {
            interaction = match interaction.as_str() {
                ACTIVITY_RESUMED => FILTERED_RESUMED.to_string(),
                ACTIVITY_PAUSED => FILTERED_PAUSED.to_string(),
                _ => interaction,
            };
        }
        working_ts.push(cols.event_timestamp_ns[i_us]);
        working_pkg.push(pkg.clone());
        working_int.push(interaction);
    }

    // 5. matcher: factorize app_package_name to integer codes, build flag arrays
    let mut app_lookup: HashMap<&str, i32> = HashMap::new();
    let mut app_codes: Vec<i32> = Vec::with_capacity(kept_count);
    for pkg in &working_pkg {
        let next_code = app_lookup.len() as i32;
        let code = *app_lookup.entry(pkg.as_str()).or_insert(next_code);
        app_codes.push(code);
    }

    let mut resumed = vec![false; kept_count];
    let mut same_stop = vec![false; kept_count];
    let mut other_stop = vec![false; kept_count];
    let mut stopped = vec![false; kept_count];
    for i in 0..kept_count {
        let it = working_int[i].as_str();
        if it == ACTIVITY_RESUMED {
            resumed[i] = true;
        }
        if same_stop_set.contains(it) {
            same_stop[i] = true;
        }
        if other_stop_set.contains(it) {
            other_stop[i] = true;
        }
        if it == ACTIVITY_STOPPED {
            stopped[i] = true;
        }
    }

    let match_options = _rust_app_usage_matcher::MatchOptions {
        allow_stop_event_reuse,
        use_activity_stopped_as_fallback,
        apply_threshold_to_fallback,
        long_duration_threshold_ns,
    };
    // The kernel crate has no background-apps concept; pass an all-false slice
    // (length-matched to the inputs) so the matcher's validate_lengths passes.
    let background = vec![false; app_codes.len()];
    let match_result = _rust_app_usage_matcher::match_app_usage_update_indices_core(
        &app_codes,
        &working_ts,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        &background,
        match_options,
    )
    .map_err(|e| JsValue::from_str(&format!("matcher: {e}")))?;

    // 6. enrich: derive start_ns, stop_ns, mark missing, drop paused/non-closed
    let mut start_ns: Vec<i64> = vec![-1; kept_count];
    let mut stop_ns: Vec<i64> = vec![-1; kept_count];
    let mut is_missing = vec![false; kept_count];
    for &si in &match_result.start_indices {
        start_ns[si] = working_ts[si];
    }
    for (idx, &si) in match_result.stop_start_indices.iter().enumerate() {
        let stop_event_index = match_result.stop_event_indices[idx];
        stop_ns[si] = working_ts[stop_event_index];
    }
    for &mi in &match_result.missing_indices {
        is_missing[mi] = true;
    }

    // 7+8. format + write — drop dropped rows in this pass.
    let mut out: Vec<u8> = Vec::with_capacity(kept_count * 96);
    out.extend_from_slice(
        b"event_timestamp,app_package_name,interaction_type,duration_seconds,date,hour,day\n",
    );

    use std::fmt::Write as _;
    let mut scratch = String::with_capacity(64);
    for i in 0..kept_count {
        let interaction = working_int[i].as_str();
        // Drop pure paused rows
        if interaction == ACTIVITY_PAUSED || interaction == FILTERED_PAUSED {
            continue;
        }
        // Drop Resumed rows that didn't form a session and aren't missing
        let mut effective_interaction = interaction.to_string();
        let row_start_ns: i64 = start_ns[i];
        let row_stop_ns: i64 = stop_ns[i];
        let mut duration_seconds: Option<f64> = None;
        let pkg = working_pkg[i].as_str();
        let is_filtered_pkg = filter_set.contains(pkg);

        match interaction {
            ACTIVITY_RESUMED | FILTERED_RESUMED => {
                if is_missing[i] {
                    effective_interaction = END_OF_USAGE_MISSING.to_string();
                } else if row_start_ns >= 0 && row_stop_ns >= 0 {
                    if is_filtered_pkg {
                        effective_interaction = FILTERED_APP_USAGE.to_string();
                    } else {
                        effective_interaction = APP_USAGE.to_string();
                        let dur = (row_stop_ns - row_start_ns) as f64 / 1_000_000_000.0;
                        duration_seconds = Some(dur);
                    }
                } else {
                    // open Resumed without close — drop
                    continue;
                }
            }
            _ => {}
        }

        let ns = working_ts[i];
        let secs = ns.div_euclid(1_000_000_000);
        let nanos = ns.rem_euclid(1_000_000_000) as u32;
        let utc = chrono::Utc
            .timestamp_opt(secs, nanos)
            .single()
            .ok_or_else(|| JsValue::from_str("invalid ts"))?;
        let local: DateTime<Tz> = utc.with_timezone(&tz);

        // event_timestamp
        scratch.clear();
        let _ = write!(
            scratch,
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
            local.year(),
            local.month(),
            local.day(),
            local.hour(),
            local.minute(),
            local.second(),
            local.format("%:z"),
        );
        write_csv_field(&mut out, scratch.as_bytes());
        out.push(b',');
        // app_package_name
        write_csv_field(&mut out, pkg.as_bytes());
        out.push(b',');
        // interaction_type
        write_csv_field(&mut out, effective_interaction.as_bytes());
        out.push(b',');
        // duration_seconds
        if let Some(d) = duration_seconds {
            scratch.clear();
            let _ = write!(scratch, "{}", d);
            out.extend_from_slice(scratch.as_bytes());
        }
        out.push(b',');
        // date
        scratch.clear();
        let _ = write!(
            scratch,
            "{:04}-{:02}-{:02}",
            local.year(),
            local.month(),
            local.day()
        );
        out.extend_from_slice(scratch.as_bytes());
        out.push(b',');
        write_u8(&mut out, local.hour() as u8);
        out.push(b',');
        write_u8(&mut out, weekday_chronicle(local.weekday()));
        out.push(b'\n');
    }

    Ok(out)
}

// ----- write_simple_csv -------------------------------------------------

/// Minimal-boundary-cost CSV writer benchmark.
/// Inputs:
///   * `event_timestamps`  — pre-formatted timestamp strings (one per row).
///   * `app_packages`       — string per row.
///   * `interaction_types`  — string per row.
///   * `hours`              — u8 per row.
///   * `days`               — u8 per row.
/// Output: a single Uint8Array of CSV bytes (header + rows + LF).
///
/// This simulates the per-row CSV-escape + concat work in `buildAppCsvText`
/// for a representative subset of columns. The boundary cost on input is
/// the same string-vector marshalling that hurt the parse benchmark; on
/// output it is one ArrayBuffer transfer.
#[wasm_bindgen]
pub fn write_simple_csv(
    event_timestamps: Vec<String>,
    app_packages: Vec<String>,
    interaction_types: Vec<String>,
    hours: &[u8],
    days: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let n = event_timestamps.len();
    if app_packages.len() != n
        || interaction_types.len() != n
        || hours.len() != n
        || days.len() != n
    {
        return Err(JsValue::from_str(
            "write_simple_csv: column lengths mismatch",
        ));
    }

    let mut out = Vec::with_capacity(n * 64);
    out.extend_from_slice(b"event_timestamp,app_package_name,interaction_type,hour,day\n");

    for i in 0..n {
        write_csv_field(&mut out, event_timestamps[i].as_bytes());
        out.push(b',');
        write_csv_field(&mut out, app_packages[i].as_bytes());
        out.push(b',');
        write_csv_field(&mut out, interaction_types[i].as_bytes());
        out.push(b',');
        write_u8(&mut out, hours[i]);
        out.push(b',');
        write_u8(&mut out, days[i]);
        out.push(b'\n');
    }
    Ok(out)
}

fn needs_quoting(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|&b| b == b',' || b == b'"' || b == b'\n' || b == b'\r')
}

pub(crate) fn write_csv_field(out: &mut Vec<u8>, field: &[u8]) {
    if !needs_quoting(field) {
        out.extend_from_slice(field);
        return;
    }
    out.push(b'"');
    for &b in field {
        if b == b'"' {
            out.extend_from_slice(b"\"\"");
        } else {
            out.push(b);
        }
    }
    out.push(b'"');
}

pub(crate) fn write_u8(out: &mut Vec<u8>, mut value: u8) {
    if value >= 100 {
        out.push(b'0' + value / 100);
        value %= 100;
        out.push(b'0' + value / 10);
        value %= 10;
    } else if value >= 10 {
        out.push(b'0' + value / 10);
        value %= 10;
    }
    out.push(b'0' + value);
}

// ----- dedupe_event_rows ------------------------------------------------

#[derive(Serialize)]
pub struct DedupeResult {
    pub keep_indices: Vec<u32>,
}

#[wasm_bindgen]
pub fn dedupe_event_rows(
    ts_ns: &[i64],
    interaction_type: Vec<String>,
    app_package_name: Vec<String>,
) -> Result<JsValue, JsValue> {
    let n = ts_ns.len();
    if interaction_type.len() != n || app_package_name.len() != n {
        return Err(JsValue::from_str("dedupe: column lengths must match"));
    }
    let mut seen: AHashSet<(i64, &str, &str)> = AHashSet::with_capacity(n);
    let mut keep = Vec::with_capacity(n);
    for i in 0..n {
        let key = (
            ts_ns[i],
            interaction_type[i].as_str(),
            app_package_name[i].as_str(),
        );
        if seen.insert(key) {
            keep.push(i as u32);
        }
    }
    serde_wasm_bindgen::to_value(&DedupeResult { keep_indices: keep })
        .map_err(|e| JsValue::from_str(&format!("ser: {e}")))
}

#[cfg(test)]
mod timestamp_tests {
    use super::*;

    #[test]
    fn format_one_returns_every_exact_local_calendar_component() {
        let timestamp = chrono::Utc
            .with_ymd_and_hms(2024, 7, 4, 17, 34, 56)
            .single()
            .unwrap()
            .timestamp_nanos_opt()
            .unwrap();
        assert_eq!(
            format_one(timestamp, chrono_tz::America::Chicago),
            (
                "2024-07-04 12:34:56-05:00".into(),
                "2024-07-04".into(),
                12,
                5,
                3,
            )
        );
    }
}
