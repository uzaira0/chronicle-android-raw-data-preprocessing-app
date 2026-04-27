//! Batched timestamp-format kernel.
//!
//! Two implementations exposed for benchmarking:
//! * `format_timestamps_polars` — uses Polars' Datetime + strftime path.
//! * `format_timestamps_lean`   — uses chrono-tz directly, no DataFrame.
//!
//! Both produce the same output shape:
//! - `event_timestamp_string`: e.g. "2026-04-24 12:34:56-05:00"
//! - `date`: "YYYY-MM-DD"
//! - `hour`: u8
//! - `day`: u8 (1=Sun..7=Sat to match the TS pipeline)
//! - `quarter`: u8 (1..4)
//!
//! The TS pipeline computes these via per-row Intl.DateTimeFormat. The whole
//! point of the benchmark is to find out whether crossing the WASM boundary
//! once with a column of timestamps + a tz string is faster than ~5 Intl
//! calls per row.

use chrono::{DateTime, Datelike, TimeZone, Timelike};
use chrono_tz::Tz;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct FormattedColumns {
    pub event_timestamp_strings: Vec<String>,
    pub dates: Vec<String>,
    pub hours: Vec<u8>,
    pub days: Vec<u8>,
    pub quarters: Vec<u8>,
}

fn weekday_ts_to_chronicle(weekday: chrono::Weekday) -> u8 {
    // Match the TS pipeline: 1=Sun, 2=Mon, ..., 7=Sat
    match weekday {
        chrono::Weekday::Sun => 1,
        chrono::Weekday::Mon => 2,
        chrono::Weekday::Tue => 3,
        chrono::Weekday::Wed => 4,
        chrono::Weekday::Thu => 5,
        chrono::Weekday::Fri => 6,
        chrono::Weekday::Sat => 7,
    }
}

fn format_offset(dt: &DateTime<Tz>) -> String {
    // chrono's "%:z" produces "+05:00" / "-05:00". Match TS which produces
    // "+00:00" for UTC (not "Z").
    dt.format("%:z").to_string()
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
        format_offset(&local),
    );
    let date = format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day());
    let hour = local.hour() as u8;
    let day = weekday_ts_to_chronicle(local.weekday());
    let quarter = (((local.month() as u8) - 1) / 3) + 1;
    (event_string, date, hour, day, quarter)
}

fn run_lean(ts_ns: &[i64], tz_name: &str) -> Result<FormattedColumns, String> {
    let tz: Tz = tz_name
        .parse()
        .map_err(|err| format!("invalid timezone {tz_name:?}: {err}"))?;

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

    Ok(FormattedColumns {
        event_timestamp_strings,
        dates,
        hours,
        days,
        quarters,
    })
}

fn run_polars(ts_ns: &[i64], tz_name: &str) -> Result<FormattedColumns, String> {
    use polars::prelude::*;

    let n = ts_ns.len();
    let utc_series = Series::new("ts".into(), ts_ns)
        .cast(&DataType::Datetime(TimeUnit::Nanoseconds, Some(PlSmallStr::from_static("UTC"))))
        .map_err(|e| format!("cast utc: {e}"))?;
    let mut df = DataFrame::new(vec![utc_series.into()])
        .map_err(|e| format!("frame: {e}"))?;

    let tz_static: PlSmallStr = tz_name.to_string().into();
    df = df
        .lazy()
        .with_columns([col("ts")
            .dt()
            .convert_time_zone(tz_static.clone())
            .alias("local")])
        .with_columns([
            col("local").dt().strftime("%Y-%m-%d %H:%M:%S%:z").alias("event_str"),
            col("local").dt().strftime("%Y-%m-%d").alias("date_str"),
            col("local").dt().hour().alias("hour"),
            col("local").dt().weekday().alias("weekday_polars"),
            col("local").dt().month().alias("month"),
        ])
        .collect()
        .map_err(|e| format!("collect: {e}"))?;

    let event_strings: Vec<String> = df
        .column("event_str").map_err(|e| format!("col: {e}"))?
        .str().map_err(|e| format!("str: {e}"))?
        .into_iter()
        .map(|opt| opt.unwrap_or("").to_string())
        .collect();
    let dates: Vec<String> = df
        .column("date_str").map_err(|e| format!("col: {e}"))?
        .str().map_err(|e| format!("str: {e}"))?
        .into_iter()
        .map(|opt| opt.unwrap_or("").to_string())
        .collect();
    let hours: Vec<u8> = df
        .column("hour").map_err(|e| format!("col: {e}"))?
        .i8().map_err(|e| format!("i8: {e}"))?
        .into_iter()
        .map(|opt| opt.unwrap_or(0) as u8)
        .collect();
    // Polars weekday: 1=Mon..7=Sun. Chronicle wants: 1=Sun..7=Sat.
    let days: Vec<u8> = df
        .column("weekday_polars").map_err(|e| format!("col: {e}"))?
        .i8().map_err(|e| format!("i8: {e}"))?
        .into_iter()
        .map(|opt| {
            let polars_wd = opt.unwrap_or(1);
            // 1(Mon)→2, 2(Tue)→3, ..., 6(Sat)→7, 7(Sun)→1
            if polars_wd == 7 { 1 } else { (polars_wd as u8) + 1 }
        })
        .collect();
    let quarters: Vec<u8> = df
        .column("month").map_err(|e| format!("col: {e}"))?
        .i8().map_err(|e| format!("i8: {e}"))?
        .into_iter()
        .map(|opt| (((opt.unwrap_or(1) - 1) / 3) + 1) as u8)
        .collect();

    let _ = n;
    Ok(FormattedColumns {
        event_timestamp_strings: event_strings,
        dates,
        hours,
        days,
        quarters,
    })
}

#[wasm_bindgen]
pub fn format_timestamps_lean(ts_ns: &[i64], tz_name: &str) -> Result<JsValue, JsValue> {
    let cols = run_lean(ts_ns, tz_name).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&cols).map_err(|e| JsValue::from_str(&format!("serialize: {e}")))
}

#[wasm_bindgen]
pub fn format_timestamps_polars(ts_ns: &[i64], tz_name: &str) -> Result<JsValue, JsValue> {
    let cols = run_polars(ts_ns, tz_name).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&cols).map_err(|e| JsValue::from_str(&format!("serialize: {e}")))
}
