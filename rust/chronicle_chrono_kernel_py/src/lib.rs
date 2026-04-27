//! PyO3-bound Rust kernels for the Chronicle Python pipeline.
//!
//! Mirrors the WASM kernels in `rust/chronicle_chrono_kernel_wasm` so we can
//! benchmark "would the same Rust kernels that beat Intl in WASM also beat
//! Polars-py on the Python side?". The kernel logic is intentionally kept in
//! lockstep with the WASM crate.

use std::collections::HashMap;
use std::fmt::Write as _;

use ahash::AHashSet;
use chrono::{DateTime, Datelike, NaiveDateTime, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyList, PyModule};

// ----- shared scalar helpers --------------------------------------------

fn weekday_chronicle(w: chrono::Weekday) -> u8 {
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

fn parse_chronicle_timestamp_ns(text: &str) -> Option<i64> {
    if text.is_empty() {
        return None;
    }
    // Forms accepted (mirrors the TS / WASM pipeline):
    //   YYYY-MM-DD HH:MM:SS[.fff]
    //   YYYY-MM-DDTHH:MM:SS[.fff]
    //   ...Z   -> +00:00
    //   ...+HH:MM / -HH:MM offset
    let mut text = text.replace('T', " ");
    if let Some(stripped) = text.strip_suffix('Z') {
        text = format!("{stripped}+00:00");
    }
    let has_offset = text
        .rfind(|c: char| c == '+' || c == '-')
        .filter(|&i| i >= 19)
        .is_some();
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

#[derive(Default)]
struct ParsedColumns {
    event_timestamp_ns: Vec<i64>,
    timezone: Vec<String>,
    app_package_name: Vec<String>,
    interaction_type: Vec<String>,
    application_label: Vec<String>,
    study_id: Vec<String>,
    participant_id: Vec<String>,
    username: Vec<String>,
    dropped_empty: u32,
    dropped_invalid: u32,
}

const REQUIRED_COLUMNS: &[&str] = &[
    "event_timestamp",
    "timezone",
    "app_package_name",
    "interaction_type",
    "application_label",
    "study_id",
    "participant_id",
    "username",
];

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
                                cols.interaction_type.push(get(3).to_string());
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

fn needs_quoting(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|&b| b == b',' || b == b'"' || b == b'\n' || b == b'\r')
}

fn write_csv_field(out: &mut Vec<u8>, field: &[u8]) {
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

fn write_u8(out: &mut Vec<u8>, mut value: u8) {
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

// ----- format_timestamps -------------------------------------------------

/// Batched timestamp formatter.
///
/// Inputs:
///   * `ts_ns` — list[int] of UTC nanosecond timestamps.
///   * `tz_name` — IANA tz name, e.g. "America/Chicago".
///
/// Returns a dict with columns:
///   event_timestamp_strings: list[str]  — "%Y-%m-%d %H:%M:%S±HH:MM"
///   dates:                  list[str]  — "%Y-%m-%d"
///   hours:                  list[int]
///   days:                   list[int]  — Chronicle 1=Sun..7=Sat
///   quarters:               list[int]  — 1..4
#[pyfunction]
fn format_timestamps<'py>(
    py: Python<'py>,
    ts_ns: Vec<i64>,
    tz_name: &str,
) -> PyResult<Bound<'py, PyDict>> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|e: chrono_tz::ParseError| {
            PyValueError::new_err(format!("invalid timezone {tz_name:?}: {e}"))
        })?;

    let n = ts_ns.len();
    let mut event_strings: Vec<String> = Vec::with_capacity(n);
    let mut dates: Vec<String> = Vec::with_capacity(n);
    let mut hours: Vec<u8> = Vec::with_capacity(n);
    let mut days: Vec<u8> = Vec::with_capacity(n);
    let mut quarters: Vec<u8> = Vec::with_capacity(n);

    for ns in ts_ns {
        let secs = ns.div_euclid(1_000_000_000);
        let nanos = ns.rem_euclid(1_000_000_000) as u32;
        let utc = chrono::Utc
            .timestamp_opt(secs, nanos)
            .single()
            .ok_or_else(|| PyValueError::new_err("invalid timestamp"))?;
        let local: DateTime<Tz> = utc.with_timezone(&tz);
        event_strings.push(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
            local.year(),
            local.month(),
            local.day(),
            local.hour(),
            local.minute(),
            local.second(),
            local.format("%:z"),
        ));
        dates.push(format!(
            "{:04}-{:02}-{:02}",
            local.year(),
            local.month(),
            local.day()
        ));
        hours.push(local.hour() as u8);
        days.push(weekday_chronicle(local.weekday()));
        quarters.push(((local.month() as u8 - 1) / 3) + 1);
    }

    let dict = PyDict::new(py);
    dict.set_item("event_timestamp_strings", event_strings)?;
    dict.set_item("dates", dates)?;
    dict.set_item("hours", hours)?;
    dict.set_item("days", days)?;
    dict.set_item("quarters", quarters)?;
    Ok(dict)
}

// ----- sort_by_timestamp_stable -----------------------------------------

/// Stable sort of a timestamp column. Returns a permutation list of u32 row
/// indices such that ts_ns[result[i]] is non-decreasing, with original
/// position breaking ties.
#[pyfunction]
fn sort_by_timestamp_stable(ts_ns: Vec<i64>) -> Vec<u32> {
    let n = ts_ns.len();
    let mut indices: Vec<u32> = (0..n as u32).collect();
    indices.sort_by_key(|&i| ts_ns[i as usize]);
    indices
}

// ----- process_pipeline_e2e ---------------------------------------------

/// End-to-end pipeline: raw CSV bytes IN -> processed CSV bytes OUT.
/// Does parse + sort + dedup + format + write entirely in Rust.
///
/// Output columns (matches the WASM e2e output):
///   event_timestamp, app_package_name, interaction_type, date, hour, day
#[pyfunction]
fn process_pipeline_e2e<'py>(
    py: Python<'py>,
    csv_bytes: &[u8],
    tz_name: &str,
) -> PyResult<Bound<'py, PyBytes>> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|e: chrono_tz::ParseError| {
            PyValueError::new_err(format!("invalid timezone {tz_name:?}: {e}"))
        })?;

    let cols = parse_internal(csv_bytes)
        .map_err(|e| PyValueError::new_err(format!("parse: {e}")))?;
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
    out.extend_from_slice(
        b"event_timestamp,app_package_name,interaction_type,date,hour,day\n",
    );

    let mut scratch = String::with_capacity(64);
    for &i in &kept {
        let i_us = i as usize;
        let ns = cols.event_timestamp_ns[i_us];
        let secs = ns.div_euclid(1_000_000_000);
        let nanos = ns.rem_euclid(1_000_000_000) as u32;
        let utc = chrono::Utc
            .timestamp_opt(secs, nanos)
            .single()
            .ok_or_else(|| PyValueError::new_err("invalid ts"))?;
        let local: DateTime<Tz> = utc.with_timezone(&tz);

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
        write_csv_field(&mut out, cols.app_package_name[i_us].as_bytes());
        out.push(b',');
        write_csv_field(&mut out, cols.interaction_type[i_us].as_bytes());
        out.push(b',');
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

    Ok(PyBytes::new(py, &out))
}

// ----- parse_raw_csv (helper for parity / convenience) ------------------

/// Parse raw Chronicle CSV bytes into a dict of typed columns. Used by the
/// bench to build a Polars DataFrame deterministically without round-tripping
/// through the Polars CSV reader (we want to compare formatting, not parsing).
#[pyfunction]
fn parse_raw_csv<'py>(
    py: Python<'py>,
    csv_bytes: &[u8],
) -> PyResult<Bound<'py, PyDict>> {
    let cols = parse_internal(csv_bytes)
        .map_err(|e| PyValueError::new_err(format!("parse: {e}")))?;
    let dict = PyDict::new(py);
    dict.set_item("event_timestamp_ns", cols.event_timestamp_ns)?;
    dict.set_item("timezone", PyList::new(py, cols.timezone)?)?;
    dict.set_item("app_package_name", PyList::new(py, cols.app_package_name)?)?;
    dict.set_item("interaction_type", PyList::new(py, cols.interaction_type)?)?;
    dict.set_item("application_label", PyList::new(py, cols.application_label)?)?;
    dict.set_item("study_id", PyList::new(py, cols.study_id)?)?;
    dict.set_item("participant_id", PyList::new(py, cols.participant_id)?)?;
    dict.set_item("username", PyList::new(py, cols.username)?)?;
    dict.set_item("dropped_empty", cols.dropped_empty)?;
    dict.set_item("dropped_invalid", cols.dropped_invalid)?;
    Ok(dict)
}

#[pymodule]
fn _rust_chrono_kernel(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(format_timestamps, m)?)?;
    m.add_function(wrap_pyfunction!(sort_by_timestamp_stable, m)?)?;
    m.add_function(wrap_pyfunction!(process_pipeline_e2e, m)?)?;
    m.add_function(wrap_pyfunction!(parse_raw_csv, m)?)?;
    Ok(())
}
