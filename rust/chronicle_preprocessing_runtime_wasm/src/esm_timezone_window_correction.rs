//! Generic strict-window mode selection and timestamp correction for an ESM
//! table paired with a timestamped offset stream.
//!
//! The caller supplies the two already-associated, single-participant tables.
//! This boundary deliberately does not perform participant joins, sequential
//! k-nearest-neighbour imputation, or timezone-name inference.

use chronicle_chrono_kernel_wasm::{format_chronicle_timestamp_ns, parse_chronicle_timestamp_ns};
use csv::{ReaderBuilder, StringRecord, WriterBuilder};
use serde::Deserialize;

pub const ESM_TIMEZONE_INPUT_STAGE: &str = "one_participant_ema_with_corresponding_sensing_offsets";
pub const STRICT_OPEN_BOUNDARY: &str = "strict_open";
pub const FIRST_SEEN_NONMISSING_MODE: &str = "first_seen_nonmissing_mode";
pub const OFFSET_UNIT_MILLISECONDS: &str = "milliseconds";

const SENSING_HEADER: [&str; 5] = [
    "participant_id",
    "source_row_id",
    "client_db_id",
    "timestamp",
    "timezoneOffset",
];
const ESM_HEADER: [&str; 5] = [
    "participant_id",
    "source_row_id",
    "notificationTimestamp",
    "questionnaireStartedTimestamp",
    "questionnaireEndedTimestamp",
];
const OUTPUT_HEADER: [&str; 11] = [
    "participant_id",
    "source_row_id",
    "notificationTimestamp",
    "questionnaireStartedTimestamp",
    "questionnaireEndedTimestamp",
    "timezoneOffset.mode",
    "notificationTimestamp.corrected",
    "questionnaireStartedTimestamp.corrected",
    "questionnaireEndedTimestamp.corrected",
    "weekday",
    "nr",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EsmTimezoneWindowCorrectionConfiguration {
    pub input_stage: String,
    pub window_radius_minutes: u32,
    pub boundary: String,
    pub mode_policy: String,
    pub offset_unit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EsmTimezoneWindowCorrectionOutput {
    pub derived_csv: Vec<u8>,
    pub sensing_input_row_count: usize,
    pub esm_input_row_count: usize,
    pub corrected_esm_row_count: usize,
    pub missing_mode_row_count: usize,
}

#[derive(Debug)]
struct SensingOffsetRow {
    participant_id: String,
    timestamp_ns: i64,
    timezone_offset_ms: Option<f64>,
}

#[derive(Debug)]
struct EsmRow {
    participant_id: String,
    source_row_id: String,
    notification_timestamp: String,
    notification_timestamp_ns: i64,
    questionnaire_started_timestamp: String,
    questionnaire_started_timestamp_ns: i64,
    questionnaire_ended_timestamp: String,
    questionnaire_ended_timestamp_ns: i64,
    source_index: usize,
}

fn exact_header(headers: &StringRecord, expected: &[&str], label: &str) -> Result<(), String> {
    if headers.iter().collect::<Vec<_>>() != expected {
        return Err(format!(
            "{label} header must be exactly {}",
            expected.join(",")
        ));
    }
    Ok(())
}

fn required<'a>(
    record: &'a StringRecord,
    index: usize,
    row_number: usize,
    table: &str,
    header: &[&str],
) -> Result<&'a str, String> {
    let value = record
        .get(index)
        .expect("records have the validated fixed-width header")
        .trim();
    if value.is_empty() {
        return Err(format!(
            "{table} row {row_number} field {} is empty",
            header[index]
        ));
    }
    Ok(value)
}

fn parse_timestamp(
    record: &StringRecord,
    index: usize,
    row_number: usize,
    table: &str,
    header: &[&str],
) -> Result<(String, i64), String> {
    let text = required(record, index, row_number, table, header)?.to_owned();
    let timestamp_ns = parse_chronicle_timestamp_ns(&text).ok_or_else(|| {
        format!(
            "{table} row {row_number} field {} is not a supported timestamp",
            header[index]
        )
    })?;
    Ok((text, timestamp_ns))
}

fn parse_offset_ms(record: &StringRecord, row_number: usize) -> Result<Option<f64>, String> {
    let text = record
        .get(4)
        .expect("records have the validated fixed-width header")
        .trim();
    if text.is_empty() || text == "NA" || text == "NaN" {
        return Ok(None);
    }
    let value = text.parse::<f64>().map_err(|_| {
        format!("sensing row {row_number} field timezoneOffset is not numeric or NA")
    })?;
    if !value.is_finite() {
        return Err(format!(
            "sensing row {row_number} field timezoneOffset is not finite"
        ));
    }
    Ok(Some(value))
}

fn offset_ms_to_ns(value: f64) -> Result<i64, String> {
    let nanoseconds = value * 1_000_000.0;
    if !nanoseconds.is_finite()
        || nanoseconds < i64::MIN as f64
        || nanoseconds > i64::MAX as f64
        || nanoseconds.fract() != 0.0
    {
        return Err("timezone offset is not exactly representable in nanoseconds".to_owned());
    }
    Ok(nanoseconds as i64)
}

fn first_seen_nonmissing_mode(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut counts = Vec::<(f64, usize)>::new();
    for value in values.flatten() {
        if let Some((_, count)) = counts.iter_mut().find(|(seen, _)| *seen == value) {
            *count += 1;
        } else {
            counts.push((value, 1));
        }
    }
    let mut best = None::<(f64, usize)>;
    for (value, count) in counts {
        if best.is_none_or(|(_, best_count)| count > best_count) {
            best = Some((value, count));
        }
    }
    best.map(|(value, _)| value)
}

fn corrected_timestamp(timestamp_ns: i64, offset_ns: i64) -> Result<String, String> {
    let corrected_ns = timestamp_ns
        .checked_add(offset_ns)
        .ok_or_else(|| "timestamp overflows after applying timezone offset".to_owned())?;
    format_chronicle_timestamp_ns(corrected_ns)
        .ok_or_else(|| "corrected timestamp is outside the supported timestamp range".to_owned())
}

fn weekday_from_corrected_timestamp(
    timestamp_ns: i64,
    offset_ns: i64,
) -> Result<&'static str, String> {
    let corrected_ns = timestamp_ns
        .checked_add(offset_ns)
        .ok_or_else(|| "timestamp overflows after applying timezone offset".to_owned())?;
    let day_index = corrected_ns
        .div_euclid(86_400_000_000_000)
        .saturating_add(3)
        .rem_euclid(7) as usize;
    Ok(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day_index])
}

/// Apply an offset mode selected from sensing rows strictly inside a symmetric
/// window around each ESM notification timestamp.
pub fn execute_esm_timezone_window_correction_csv(
    sensing_csv: &[u8],
    esm_csv: &[u8],
    configuration: &EsmTimezoneWindowCorrectionConfiguration,
) -> Result<EsmTimezoneWindowCorrectionOutput, String> {
    if configuration.input_stage != ESM_TIMEZONE_INPUT_STAGE
        || configuration.window_radius_minutes != 30
        || configuration.boundary != STRICT_OPEN_BOUNDARY
        || configuration.mode_policy != FIRST_SEEN_NONMISSING_MODE
        || configuration.offset_unit != OFFSET_UNIT_MILLISECONDS
    {
        return Err(
            "ESM timezone-window configuration drifts from the registered source boundary"
                .to_owned(),
        );
    }
    if sensing_csv.is_empty() || esm_csv.is_empty() {
        return Err("ESM timezone-window correction requires both sensing and ESM CSVs".to_owned());
    }

    let mut sensing_reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(sensing_csv);
    exact_header(
        sensing_reader
            .headers()
            .map_err(|error| format!("sensing header: {error}"))?,
        &SENSING_HEADER,
        "sensing",
    )?;
    let mut sensing_rows = Vec::new();
    let mut participant_id = None::<String>;
    for (index, record) in sensing_reader.records().enumerate() {
        let row_number = index + 2;
        let record = record.map_err(|error| format!("sensing row {row_number}: {error}"))?;
        let current_participant =
            required(&record, 0, row_number, "sensing", &SENSING_HEADER)?.to_owned();
        if participant_id
            .as_ref()
            .is_some_and(|expected| expected != &current_participant)
        {
            return Err("sensing input must contain exactly one participant".to_owned());
        }
        participant_id.get_or_insert_with(|| current_participant.clone());
        required(&record, 1, row_number, "sensing", &SENSING_HEADER)?;
        required(&record, 2, row_number, "sensing", &SENSING_HEADER)?;
        let (_, timestamp_ns) =
            parse_timestamp(&record, 3, row_number, "sensing", &SENSING_HEADER)?;
        sensing_rows.push(SensingOffsetRow {
            participant_id: current_participant,
            timestamp_ns,
            timezone_offset_ms: parse_offset_ms(&record, row_number)?,
        });
    }
    let expected_participant = participant_id
        .as_deref()
        .ok_or_else(|| "ESM timezone-window correction requires sensing rows".to_owned())?;

    let mut esm_reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(esm_csv);
    exact_header(
        esm_reader
            .headers()
            .map_err(|error| format!("ESM header: {error}"))?,
        &ESM_HEADER,
        "ESM",
    )?;
    let mut esm_rows = Vec::new();
    for (index, record) in esm_reader.records().enumerate() {
        let row_number = index + 2;
        let record = record.map_err(|error| format!("ESM row {row_number}: {error}"))?;
        let participant = required(&record, 0, row_number, "ESM", &ESM_HEADER)?.to_owned();
        if participant != expected_participant {
            return Err("ESM and sensing inputs must name the same single participant".to_owned());
        }
        let (notification_timestamp, notification_timestamp_ns) =
            parse_timestamp(&record, 2, row_number, "ESM", &ESM_HEADER)?;
        let (questionnaire_started_timestamp, questionnaire_started_timestamp_ns) =
            parse_timestamp(&record, 3, row_number, "ESM", &ESM_HEADER)?;
        let (questionnaire_ended_timestamp, questionnaire_ended_timestamp_ns) =
            parse_timestamp(&record, 4, row_number, "ESM", &ESM_HEADER)?;
        esm_rows.push(EsmRow {
            participant_id: participant,
            source_row_id: required(&record, 1, row_number, "ESM", &ESM_HEADER)?.to_owned(),
            notification_timestamp,
            notification_timestamp_ns,
            questionnaire_started_timestamp,
            questionnaire_started_timestamp_ns,
            questionnaire_ended_timestamp,
            questionnaire_ended_timestamp_ns,
            source_index: index,
        });
    }
    if esm_rows.is_empty() {
        return Err("ESM timezone-window correction requires ESM rows".to_owned());
    }
    esm_rows.sort_by(|left, right| {
        left.notification_timestamp_ns
            .cmp(&right.notification_timestamp_ns)
            .then(left.source_index.cmp(&right.source_index))
    });

    let radius_ns = i64::from(configuration.window_radius_minutes)
        .checked_mul(60_000_000_000)
        .ok_or_else(|| "ESM timezone window radius overflows".to_owned())?;
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(OUTPUT_HEADER)
        .map_err(|error| format!("ESM timezone output header: {error}"))?;
    let mut corrected_esm_row_count = 0usize;
    let mut missing_mode_row_count = 0usize;
    for (index, esm) in esm_rows.iter().enumerate() {
        let lower = esm
            .notification_timestamp_ns
            .checked_sub(radius_ns)
            .ok_or_else(|| "ESM timezone lower window boundary overflows".to_owned())?;
        let upper = esm
            .notification_timestamp_ns
            .checked_add(radius_ns)
            .ok_or_else(|| "ESM timezone upper window boundary overflows".to_owned())?;
        let mode_ms = first_seen_nonmissing_mode(
            sensing_rows
                .iter()
                .filter(|row| {
                    row.participant_id == esm.participant_id
                        && row.timestamp_ns > lower
                        && row.timestamp_ns < upper
                })
                .map(|row| row.timezone_offset_ms),
        );
        let (mode, notification, started, ended, weekday) = if let Some(mode_ms) = mode_ms {
            let offset_ns = offset_ms_to_ns(mode_ms)?;
            corrected_esm_row_count += 1;
            (
                mode_ms.to_string(),
                corrected_timestamp(esm.notification_timestamp_ns, offset_ns)?,
                corrected_timestamp(esm.questionnaire_started_timestamp_ns, offset_ns)?,
                corrected_timestamp(esm.questionnaire_ended_timestamp_ns, offset_ns)?,
                weekday_from_corrected_timestamp(
                    esm.questionnaire_started_timestamp_ns,
                    offset_ns,
                )?
                .to_owned(),
            )
        } else {
            missing_mode_row_count += 1;
            (
                "NA".to_owned(),
                "NA".to_owned(),
                "NA".to_owned(),
                "NA".to_owned(),
                "NA".to_owned(),
            )
        };
        writer
            .write_record([
                esm.participant_id.as_str(),
                esm.source_row_id.as_str(),
                esm.notification_timestamp.as_str(),
                esm.questionnaire_started_timestamp.as_str(),
                esm.questionnaire_ended_timestamp.as_str(),
                mode.as_str(),
                notification.as_str(),
                started.as_str(),
                ended.as_str(),
                weekday.as_str(),
                &(index + 1).to_string(),
            ])
            .map_err(|error| format!("ESM timezone output row: {error}"))?;
    }

    let derived_csv = writer
        .into_inner()
        .map_err(|error| format!("ESM timezone output flush: {error}"))?;
    Ok(EsmTimezoneWindowCorrectionOutput {
        derived_csv,
        sensing_input_row_count: sensing_rows.len(),
        esm_input_row_count: esm_rows.len(),
        corrected_esm_row_count,
        missing_mode_row_count,
    })
}
