//! CSV boundary that composes questionnaire-window session materialization
//! with per-questionnaire usage/nonusage summaries.
//!
//! Input rows must already carry questionnaire membership and mutually
//! exclusive usage/nonusage IDs. This module deliberately does not infer
//! those upstream labels from timestamps or raw screen events.

use crate::ema_screen_session_materialization::{
    materialize_ema_screen_sessions, EmaScreenSessionConfiguration, EmaScreenSessionKind,
    LabeledScreenStateRow, QuestionnaireWindow,
};
use crate::questionnaire_screen_session_summary::{
    summarize_questionnaire_screen_sessions, MaterializedQuestionnaireScreenSession,
    QuestionnaireScreenSessionSummary, RCompatibleNumber, ScreenSessionDurationBins,
    ScreenSessionState, ScreenSessionStateSummary,
};
use csv::{ReaderBuilder, StringRecord, WriterBuilder};
use serde::Deserialize;
use std::collections::BTreeMap;

pub const QUESTIONNAIRE_SCREEN_SESSION_INPUT_STAGE: &str =
    "post_daytime_filter_post_questionnaire_membership_post_usage_nonusage_ids";

const INPUT_HEADER: [&str; 8] = [
    "window_questionnaire_id",
    "window_start_timestamp_ns",
    "window_end_timestamp_ns",
    "source_row_id",
    "event_timestamp_ns",
    "row_questionnaire_id",
    "usage_id",
    "nonusage_id",
];

const OUTPUT_HEADER: [&str; 23] = [
    "questionnaire_id",
    "usage_session_count",
    "usage_sum_duration_seconds",
    "usage_mean_duration_seconds",
    "usage_sample_sd_duration_seconds",
    "usage_median_duration_seconds",
    "usage_short_duration_count",
    "usage_medium_duration_count",
    "usage_long_duration_count",
    "usage_quadratic_concentration",
    "usage_sum_squared_duration_seconds2",
    "usage_squared_sum_duration_seconds2",
    "nonusage_session_count",
    "nonusage_sum_duration_seconds",
    "nonusage_mean_duration_seconds",
    "nonusage_sample_sd_duration_seconds",
    "nonusage_median_duration_seconds",
    "nonusage_short_duration_count",
    "nonusage_medium_duration_count",
    "nonusage_long_duration_count",
    "nonusage_quadratic_concentration",
    "nonusage_sum_squared_duration_seconds2",
    "nonusage_squared_sum_duration_seconds2",
];

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireScreenSessionComponentConfiguration {
    pub input_stage: String,
    pub expected_window_duration_ns: i64,
    pub ghost_offset_ns: i64,
    pub ghost_nonusage_id_offset: i64,
    pub minimum_inclusive_mixed_usage_row_count: usize,
    pub short_max_seconds_inclusive: f64,
    pub medium_max_seconds_inclusive: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionnaireScreenSessionComponentOutput {
    pub derived_csv: Vec<u8>,
    pub input_row_count: usize,
    pub materialized_row_count: usize,
    pub materialized_session_count: usize,
    pub output_row_count: usize,
}

#[derive(Debug)]
struct ScopedQuestionnaireRows {
    window: QuestionnaireWindow,
    rows: Vec<LabeledScreenStateRow>,
}

fn required(record: &StringRecord, index: usize, row_number: usize) -> Result<&str, String> {
    let value = record
        .get(index)
        .expect("records have the validated fixed-width header")
        .trim();
    if value.is_empty() {
        return Err(format!(
            "questionnaire screen-session input row {row_number} field {} is empty",
            INPUT_HEADER[index]
        ));
    }
    Ok(value)
}

fn required_i64(record: &StringRecord, index: usize, row_number: usize) -> Result<i64, String> {
    let value = required(record, index, row_number)?;
    value.parse::<i64>().map_err(|_| {
        format!(
            "questionnaire screen-session input row {row_number} field {} is not an i64",
            INPUT_HEADER[index]
        )
    })
}

fn optional_i64(
    record: &StringRecord,
    index: usize,
    row_number: usize,
) -> Result<Option<i64>, String> {
    let value = record
        .get(index)
        .expect("records have the validated fixed-width header")
        .trim();
    if value.is_empty() {
        return Ok(None);
    }
    value.parse::<i64>().map(Some).map_err(|_| {
        format!(
            "questionnaire screen-session input row {row_number} field {} is not an i64",
            INPUT_HEADER[index]
        )
    })
}

fn source_number(value: RCompatibleNumber) -> String {
    match value {
        RCompatibleNumber::Finite(value) => value.to_string(),
        RCompatibleNumber::Missing => "NA".to_owned(),
        RCompatibleNumber::NotANumber => "NaN".to_owned(),
        RCompatibleNumber::PositiveInfinity => "+Inf".to_owned(),
        RCompatibleNumber::NegativeInfinity => "-Inf".to_owned(),
    }
}

fn append_state(record: &mut Vec<String>, summary: &ScreenSessionStateSummary) {
    record.extend([
        summary.session_count.to_string(),
        source_number(summary.sum_duration_seconds),
        source_number(summary.mean_duration_seconds),
        source_number(summary.sample_sd_duration_seconds),
        source_number(summary.median_duration_seconds),
        summary.short_duration_count.to_string(),
        summary.medium_duration_count.to_string(),
        summary.long_duration_count.to_string(),
        source_number(summary.quadratic_concentration),
        source_number(summary.sum_squared_duration_seconds2),
        source_number(summary.squared_sum_duration_seconds2),
    ]);
}

fn write_summaries(summaries: &[QuestionnaireScreenSessionSummary]) -> Result<Vec<u8>, String> {
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(OUTPUT_HEADER)
        .map_err(|error| format!("questionnaire screen-session output header: {error}"))?;
    for summary in summaries {
        let mut record = Vec::with_capacity(OUTPUT_HEADER.len());
        record.push(summary.questionnaire_id.clone());
        append_state(&mut record, &summary.usage);
        append_state(&mut record, &summary.nonusage);
        writer
            .write_record(record)
            .map_err(|error| format!("questionnaire screen-session output row: {error}"))?;
    }
    writer
        .into_inner()
        .map_err(|error| format!("questionnaire screen-session output flush: {error}"))
}

/// Execute the bounded session-materialization and summary stages from a
/// closed, explicit CSV schema.
pub fn execute_questionnaire_screen_session_component_csv(
    raw_csv: &[u8],
    configuration: &QuestionnaireScreenSessionComponentConfiguration,
) -> Result<QuestionnaireScreenSessionComponentOutput, String> {
    if configuration.input_stage != QUESTIONNAIRE_SCREEN_SESSION_INPUT_STAGE {
        return Err(format!(
            "questionnaire screen-session component requires input stage {QUESTIONNAIRE_SCREEN_SESSION_INPUT_STAGE}"
        ));
    }

    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("questionnaire screen-session input header: {error}"))?;
    if headers.iter().collect::<Vec<_>>() != INPUT_HEADER {
        return Err(format!(
            "questionnaire screen-session input header must be exactly {}",
            INPUT_HEADER.join(",")
        ));
    }

    let mut groups = BTreeMap::<String, ScopedQuestionnaireRows>::new();
    let mut input_row_count = 0_usize;
    for (index, record) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = record.map_err(|error| {
            format!("questionnaire screen-session input row {row_number}: {error}")
        })?;
        let questionnaire_id = required(&record, 0, row_number)?.to_owned();
        let window = QuestionnaireWindow {
            questionnaire_id: questionnaire_id.clone(),
            start_timestamp_ns: required_i64(&record, 1, row_number)?,
            end_timestamp_ns: required_i64(&record, 2, row_number)?,
        };
        let row_questionnaire_id = record
            .get(5)
            .expect("records have the validated fixed-width header")
            .trim();
        let row = LabeledScreenStateRow {
            source_row_id: required(&record, 3, row_number)?.to_owned(),
            timestamp_ns: required_i64(&record, 4, row_number)?,
            questionnaire_id: (!row_questionnaire_id.is_empty())
                .then(|| row_questionnaire_id.to_owned()),
            usage_id: optional_i64(&record, 6, row_number)?,
            nonusage_id: optional_i64(&record, 7, row_number)?,
        };

        let group = groups
            .entry(questionnaire_id)
            .or_insert_with(|| ScopedQuestionnaireRows {
                window: window.clone(),
                rows: Vec::new(),
            });
        if group.window != window {
            return Err(format!(
                "questionnaire screen-session input row {row_number} changes the explicit window for {}",
                group.window.questionnaire_id
            ));
        }
        group.rows.push(row);
        input_row_count += 1;
    }
    if groups.is_empty() {
        return Err("questionnaire screen-session input has no data rows".to_owned());
    }

    let materialization_configuration = EmaScreenSessionConfiguration {
        expected_window_duration_ns: configuration.expected_window_duration_ns,
        ghost_offset_ns: configuration.ghost_offset_ns,
        ghost_nonusage_id_offset: configuration.ghost_nonusage_id_offset,
        minimum_inclusive_mixed_usage_row_count: configuration
            .minimum_inclusive_mixed_usage_row_count,
    };
    let bins = ScreenSessionDurationBins {
        short_max_seconds_inclusive: configuration.short_max_seconds_inclusive,
        medium_max_seconds_inclusive: configuration.medium_max_seconds_inclusive,
    };

    let mut materialized_row_count = 0_usize;
    let mut sessions = Vec::new();
    for group in groups.into_values() {
        let materialization = materialize_ema_screen_sessions(
            &group.rows,
            &group.window,
            materialization_configuration,
        )
        .map_err(|error| {
            format!(
                "questionnaire {} session materialization failed: {error}",
                group.window.questionnaire_id
            )
        })?;
        materialized_row_count += materialization.rows.len();
        sessions.extend(materialization.sessions.into_iter().map(|session| {
            MaterializedQuestionnaireScreenSession {
                questionnaire_id: group.window.questionnaire_id.clone(),
                state: match session.kind {
                    EmaScreenSessionKind::Usage => ScreenSessionState::Usage,
                    EmaScreenSessionKind::Nonusage => ScreenSessionState::Nonusage,
                },
                start_timestamp_ns: Some(session.start_timestamp_ns),
                end_timestamp_ns: Some(session.end_timestamp_ns),
            }
        }));
    }
    let materialized_session_count = sessions.len();
    let summaries = summarize_questionnaire_screen_sessions(&sessions, bins)
        .map_err(|error| format!("questionnaire screen-session summary failed: {error}"))?;
    let derived_csv = write_summaries(&summaries)?;

    Ok(QuestionnaireScreenSessionComponentOutput {
        derived_csv,
        input_row_count,
        materialized_row_count,
        materialized_session_count,
        output_row_count: summaries.len(),
    })
}
