//! Closed CSV boundary for the deposited per-participant sensing timestamp
//! correction procedure.
//!
//! The source caller supplies one participant's `ps_activity` rows. This
//! module keeps that boundary explicit: it orders logging timestamps, replays
//! the deposited k=10 timezone-offset imputation, applies the millisecond
//! offset, retains study-year 2020, keeps the first chronological occurrence
//! of each `client_db_id`, and derives the source time representations.

use crate::timezone_offset_knn::{impute_schoedel_timezone_offsets_ms, SCHOEDEL_TIMEZONE_K};
use chronicle_chrono_kernel_wasm::{format_chronicle_timestamp_ns, parse_chronicle_timestamp_ns};
use csv::{ReaderBuilder, StringRecord, WriterBuilder};
use serde::Deserialize;
use std::collections::HashSet;

pub const TIMESTAMP_CORRECTION_INPUT_STAGE: &str = "one_participant_ps_activity";
pub const SCHOEDEL_STUDY_YEAR: i32 = 2020;

const INPUT_HEADER: [&str; 5] = [
    "participant_id",
    "source_row_id",
    "client_db_id",
    "timestamp",
    "timezoneOffset",
];

const OUTPUT_HEADER: [&str; 12] = [
    "participant_id",
    "source_row_id",
    "client_db_id",
    "timestamp",
    "timezoneOffset",
    "timestamp.corrected",
    "weekday",
    "date",
    "time",
    "year",
    "time_to_hours",
    "time_to_sec",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimestampCorrectionConfiguration {
    pub input_stage: String,
    pub timezone_knn_k: usize,
    pub study_year: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimestampCorrectionOutput {
    pub derived_csv: Vec<u8>,
    pub input_row_count: usize,
    pub output_row_count: usize,
    pub wrong_year_or_missing_timestamp_row_count: usize,
    pub duplicate_id_row_count: usize,
}

#[derive(Debug)]
struct SourceRow {
    participant_id: String,
    source_row_id: String,
    client_db_id: String,
    timestamp: String,
    timestamp_ns: i64,
    timezone_offset_ms: Option<f64>,
    source_index: usize,
}

fn required(record: &StringRecord, index: usize, row_number: usize) -> Result<&str, String> {
    let value = record
        .get(index)
        .expect("records have the validated fixed-width header")
        .trim();
    if value.is_empty() {
        return Err(format!(
            "timestamp-correction input row {row_number} field {} is empty",
            INPUT_HEADER[index]
        ));
    }
    Ok(value)
}

fn parse_offset_ms(record: &StringRecord, row_number: usize) -> Result<Option<f64>, String> {
    let text = record
        .get(4)
        .expect("records have the validated fixed-width header")
        .trim();
    if text.is_empty() || text == "NA" {
        return Ok(None);
    }
    let value = text.parse::<f64>().map_err(|_| {
        format!("timestamp-correction input row {row_number} field timezoneOffset is not numeric")
    })?;
    if !value.is_finite() {
        return Err(format!(
            "timestamp-correction input row {row_number} field timezoneOffset is not finite"
        ));
    }
    Ok(Some(value))
}

fn offset_ms_to_ns(value: f64, source_row_id: &str) -> Result<i64, String> {
    let nanoseconds = value * 1_000_000.0;
    if !nanoseconds.is_finite()
        || nanoseconds < i64::MIN as f64
        || nanoseconds > i64::MAX as f64
        || nanoseconds.fract() != 0.0
    {
        return Err(format!(
            "timestamp-correction row {source_row_id} has an offset that is not exactly representable in nanoseconds"
        ));
    }
    Ok(nanoseconds as i64)
}

fn corrected_parts(timestamp_ns: i64) -> Result<(String, String, String, i32, f64, f64), String> {
    let corrected = format_chronicle_timestamp_ns(timestamp_ns)
        .ok_or_else(|| "corrected timestamp is outside the supported timestamp range".to_owned())?;
    let date = corrected
        .get(0..10)
        .ok_or_else(|| "corrected timestamp lacks a date".to_owned())?
        .to_owned();
    let time = corrected
        .get(11..19)
        .ok_or_else(|| "corrected timestamp lacks a whole-second time".to_owned())?
        .to_owned();
    let year = corrected
        .get(0..4)
        .and_then(|value| value.parse::<i32>().ok())
        .ok_or_else(|| "corrected timestamp lacks a four-digit year".to_owned())?;

    // Unix epoch day zero was a Thursday. The source requests English labels
    // with Monday as the first weekday.
    let day_index = timestamp_ns
        .div_euclid(86_400_000_000_000)
        .saturating_add(3)
        .rem_euclid(7) as usize;
    let weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day_index].to_owned();

    let hour = time[0..2]
        .parse::<u32>()
        .map_err(|_| "corrected timestamp hour is invalid".to_owned())?;
    let minute = time[3..5]
        .parse::<u32>()
        .map_err(|_| "corrected timestamp minute is invalid".to_owned())?;
    let second_with_fraction = timestamp_ns.rem_euclid(60_000_000_000) as f64 / 1_000_000_000.0;
    // Preserve the deposited operation order instead of simplifying directly
    // to seconds since midnight.
    let time_to_hours = hour as f64 + minute as f64 / 60.0 + second_with_fraction / 3_600.0;
    let time_to_sec = time_to_hours * 60.0 * 60.0;
    Ok((corrected, weekday, date, year, time_to_hours, time_to_sec))
}

/// Execute the deposited timestamp-correction function at its per-participant
/// `ps_activity` boundary.
pub fn execute_timestamp_correction_csv(
    raw_csv: &[u8],
    configuration: &TimestampCorrectionConfiguration,
) -> Result<TimestampCorrectionOutput, String> {
    if configuration.input_stage != TIMESTAMP_CORRECTION_INPUT_STAGE {
        return Err(format!(
            "timestamp-correction component requires input stage {TIMESTAMP_CORRECTION_INPUT_STAGE}"
        ));
    }
    if configuration.timezone_knn_k != SCHOEDEL_TIMEZONE_K {
        return Err(format!(
            "timestamp-correction component requires the deposited timezone k={SCHOEDEL_TIMEZONE_K}"
        ));
    }
    if configuration.study_year != SCHOEDEL_STUDY_YEAR {
        return Err(format!(
            "timestamp-correction component requires the deposited study year {SCHOEDEL_STUDY_YEAR}"
        ));
    }

    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("timestamp-correction input header: {error}"))?;
    if headers.iter().collect::<Vec<_>>() != INPUT_HEADER {
        return Err(format!(
            "timestamp-correction input header must be exactly {}",
            INPUT_HEADER.join(",")
        ));
    }

    let mut rows = Vec::new();
    let mut participant_id = None::<String>;
    for (source_index, record) in reader.records().enumerate() {
        let row_number = source_index + 2;
        let record = record
            .map_err(|error| format!("timestamp-correction input row {row_number}: {error}"))?;
        let current_participant_id = required(&record, 0, row_number)?.to_owned();
        if participant_id
            .as_ref()
            .is_some_and(|expected| expected != &current_participant_id)
        {
            return Err(
                "timestamp-correction input must contain exactly one participant, matching the deposited caller boundary"
                    .to_owned(),
            );
        }
        participant_id.get_or_insert_with(|| current_participant_id.clone());
        let timestamp = required(&record, 3, row_number)?.to_owned();
        let timestamp_ns = parse_chronicle_timestamp_ns(&timestamp).ok_or_else(|| {
            format!(
                "timestamp-correction input row {row_number} field timestamp is not a supported timestamp"
            )
        })?;
        rows.push(SourceRow {
            participant_id: current_participant_id,
            source_row_id: required(&record, 1, row_number)?.to_owned(),
            client_db_id: required(&record, 2, row_number)?.to_owned(),
            timestamp,
            timestamp_ns,
            timezone_offset_ms: parse_offset_ms(&record, row_number)?,
            source_index,
        });
    }

    rows.sort_by(|left, right| {
        left.timestamp_ns
            .cmp(&right.timestamp_ns)
            .then(left.source_index.cmp(&right.source_index))
    });
    let imputed_offsets = impute_schoedel_timezone_offsets_ms(
        &rows
            .iter()
            .map(|row| row.timezone_offset_ms)
            .collect::<Vec<_>>(),
    )
    .map_err(|error| format!("timestamp-correction timezone imputation: {error}"))?;

    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(OUTPUT_HEADER)
        .map_err(|error| format!("timestamp-correction output header: {error}"))?;
    let mut seen_client_ids = HashSet::new();
    let mut wrong_year_or_missing_timestamp_row_count = 0_usize;
    let mut duplicate_id_row_count = 0_usize;
    let mut output_row_count = 0_usize;

    for (row, offset_ms) in rows.iter().zip(imputed_offsets) {
        let Some(offset_ms) = offset_ms else {
            wrong_year_or_missing_timestamp_row_count += 1;
            continue;
        };
        let corrected_ns = row
            .timestamp_ns
            .checked_add(offset_ms_to_ns(offset_ms, &row.source_row_id)?)
            .ok_or_else(|| {
                format!(
                    "timestamp-correction row {} overflows after applying its offset",
                    row.source_row_id
                )
            })?;
        let (corrected, weekday, date, year, time_to_hours, time_to_sec) =
            corrected_parts(corrected_ns)?;
        if year != configuration.study_year {
            wrong_year_or_missing_timestamp_row_count += 1;
            continue;
        }
        if !seen_client_ids.insert(row.client_db_id.clone()) {
            duplicate_id_row_count += 1;
            continue;
        }
        let time = corrected[11..19].to_owned();
        writer
            .write_record([
                row.participant_id.as_str(),
                row.source_row_id.as_str(),
                row.client_db_id.as_str(),
                row.timestamp.as_str(),
                &offset_ms.to_string(),
                corrected.as_str(),
                weekday.as_str(),
                date.as_str(),
                time.as_str(),
                &year.to_string(),
                &time_to_hours.to_string(),
                &time_to_sec.to_string(),
            ])
            .map_err(|error| format!("timestamp-correction output row: {error}"))?;
        output_row_count += 1;
    }

    let derived_csv = writer
        .into_inner()
        .map_err(|error| format!("timestamp-correction output flush: {error}"))?;
    Ok(TimestampCorrectionOutput {
        derived_csv,
        input_row_count: rows.len(),
        output_row_count,
        wrong_year_or_missing_timestamp_row_count,
        duplicate_id_row_count,
    })
}
