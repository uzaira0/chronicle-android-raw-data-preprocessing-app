//! Daily screen-session features followed by participant-level medians.
//!
//! The input boundary is deliberately post-reconstruction: rows already carry
//! participant, corrected timestamp, calendar date, awake-day label, and
//! usage/nonusage identifiers. A separate participant-scoped questionnaire
//! table supplies sleep boundaries and daily total wake time. This module does
//! not infer any of those upstream fields.

use chronicle_chrono_kernel_wasm::{format_chronicle_timestamp_ns, parse_chronicle_timestamp_ns};
use csv::{ReaderBuilder, StringRecord, WriterBuilder};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

pub const DAILY_SCREEN_SESSION_SUMMARY_INPUT_STAGE: &str =
    "post_screen_preprocessing_with_awake_day_labels";

const OUTPUT_HEADER: [&str; 21] = [
    "TST",
    "Usage_quadratic",
    "Usage_num_int_all",
    "Usage_mean_duration",
    "Usage_sd_duration",
    "Usage_median_duration",
    "Usage_num_int_5",
    "Usage_num_int_530",
    "Usage_num_int_30",
    "TWT",
    "TNST",
    "Nonusage_quadratic",
    "Nonusage_num_int_all",
    "Nonusage_mean_duration",
    "Nonusage_sd_duration",
    "Nonusage_median_duration",
    "Nonusage_num_int_5",
    "Nonusage_num_int_530",
    "Nonusage_num_int_30",
    "Num_ema_days",
    "user_id",
];

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyScreenSessionParticipantSummaryConfiguration {
    pub input_stage: String,
    pub screen_activity_value: String,
    pub application_activity_value: String,
    pub short_max_seconds_inclusive: f64,
    pub medium_max_seconds_inclusive: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyScreenSessionParticipantSummaryOutput {
    pub derived_csv: Vec<u8>,
    pub sensing_row_count: usize,
    pub questionnaire_row_count: usize,
    pub usage_session_count: usize,
    pub nonusage_session_count: usize,
    pub excluded_day_count: usize,
    pub output_row_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct Timestamp {
    nanoseconds: i64,
}

impl Timestamp {
    fn date(self) -> Result<String, String> {
        let formatted = format_chronicle_timestamp_ns(self.nanoseconds)
            .ok_or_else(|| "timestamp is outside the supported range".to_owned())?;
        formatted
            .get(0..10)
            .map(str::to_owned)
            .ok_or_else(|| "timestamp has no calendar date".to_owned())
    }
}

#[derive(Debug, Clone)]
struct SensingRow {
    user_id: String,
    activity_name: String,
    source_date: String,
    daytime_label: Option<i64>,
    usage_id: Option<u64>,
    timestamp: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum RNumber {
    Finite(f64),
    Missing,
    NotANumber,
    PositiveInfinity,
    NegativeInfinity,
}

impl RNumber {
    fn from_f64(value: f64) -> Self {
        if value.is_nan() {
            Self::NotANumber
        } else if value == f64::INFINITY {
            Self::PositiveInfinity
        } else if value == f64::NEG_INFINITY {
            Self::NegativeInfinity
        } else {
            Self::Finite(value)
        }
    }

    fn value(self) -> Option<f64> {
        match self {
            Self::Finite(value) => Some(value),
            Self::PositiveInfinity => Some(f64::INFINITY),
            Self::NegativeInfinity => Some(f64::NEG_INFINITY),
            Self::Missing | Self::NotANumber => None,
        }
    }

    fn source_text(self) -> String {
        match self {
            Self::Finite(0.0) => "0".to_owned(),
            Self::Finite(value) => value.to_string(),
            Self::Missing => "NA".to_owned(),
            Self::NotANumber => "NaN".to_owned(),
            Self::PositiveInfinity => "+Inf".to_owned(),
            Self::NegativeInfinity => "-Inf".to_owned(),
        }
    }
}

#[derive(Debug, Clone)]
struct QuestionRow {
    user_id: String,
    source_date: String,
    sleep_onset: Option<Timestamp>,
    sleep_offset: Option<Timestamp>,
    daily_total_wake_time: RNumber,
}

#[derive(Debug, Clone)]
struct JoinedQuestionRow {
    row: QuestionRow,
    daytime_label: Option<i64>,
}

#[derive(Debug, Clone, Copy)]
struct Session {
    daytime_label: i64,
    start: Option<Timestamp>,
    end: Option<Timestamp>,
}

impl Session {
    fn duration_seconds(self) -> Option<f64> {
        let start = self.start?;
        let end = self.end?;
        Some((i128::from(end.nanoseconds) - i128::from(start.nanoseconds)) as f64 / 1_000_000_000.0)
    }
}

#[derive(Debug, Clone, Copy)]
struct DailyFeatures {
    daytime_label: i64,
    number_intervals: RNumber,
    median_duration: RNumber,
    mean_duration: RNumber,
    sample_sd_duration: RNumber,
    sum_duration: RNumber,
    quadratic: RNumber,
    short_count: RNumber,
    medium_count: RNumber,
    long_count: RNumber,
}

fn required_header(headers: &StringRecord, field: &str, input_name: &str) -> Result<usize, String> {
    headers
        .iter()
        .position(|candidate| candidate == field)
        .ok_or_else(|| format!("{input_name} requires column {field}"))
}

fn required_text<'a>(
    record: &'a StringRecord,
    index: usize,
    row_number: usize,
    field: &str,
    input_name: &str,
) -> Result<&'a str, String> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() || value == "NA" {
        return Err(format!(
            "{input_name} row {row_number} requires non-missing {field}"
        ));
    }
    Ok(value)
}

fn optional_integer<T: std::str::FromStr>(
    record: &StringRecord,
    index: usize,
    row_number: usize,
    field: &str,
    input_name: &str,
) -> Result<Option<T>, String> {
    let value = record.get(index).unwrap_or_default().trim();
    if value.is_empty() || value == "NA" {
        return Ok(None);
    }
    value
        .parse::<T>()
        .map(Some)
        .map_err(|_| format!("{input_name} row {row_number} requires integer-or-NA {field}"))
}

fn parse_timestamp(
    text: &str,
    row_number: usize,
    field: &str,
    input_name: &str,
) -> Result<Timestamp, String> {
    parse_chronicle_timestamp_ns(text)
        .map(|nanoseconds| Timestamp { nanoseconds })
        .ok_or_else(|| format!("{input_name} row {row_number} has invalid {field}"))
}

fn optional_timestamp(
    record: &StringRecord,
    index: usize,
    row_number: usize,
    field: &str,
    input_name: &str,
) -> Result<Option<Timestamp>, String> {
    let value = record.get(index).unwrap_or_default().trim();
    if value.is_empty() || value == "NA" {
        return Ok(None);
    }
    parse_timestamp(value, row_number, field, input_name).map(Some)
}

fn parse_r_number(
    record: &StringRecord,
    index: usize,
    row_number: usize,
    field: &str,
    input_name: &str,
) -> Result<RNumber, String> {
    let value = record.get(index).unwrap_or_default().trim();
    match value {
        "" | "NA" => Ok(RNumber::Missing),
        "NaN" => Ok(RNumber::NotANumber),
        "Inf" | "+Inf" => Ok(RNumber::PositiveInfinity),
        "-Inf" => Ok(RNumber::NegativeInfinity),
        _ => value
            .parse::<f64>()
            .map(RNumber::from_f64)
            .map_err(|_| format!("{input_name} row {row_number} has invalid {field}")),
    }
}

fn checked_headers(
    reader: &mut csv::Reader<&[u8]>,
    input_name: &str,
) -> Result<StringRecord, String> {
    let headers = reader
        .headers()
        .map_err(|error| format!("{input_name} header: {error}"))?
        .clone();
    if headers.is_empty() || headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!(
            "{input_name} requires a nonempty header without duplicate columns"
        ));
    }
    Ok(headers)
}

fn parse_sensing_rows(raw_csv: &[u8]) -> Result<Vec<SensingRow>, String> {
    const INPUT: &str = "daily screen-session sensing input";
    let mut reader = ReaderBuilder::new().flexible(false).from_reader(raw_csv);
    let headers = checked_headers(&mut reader, INPUT)?;
    let user = required_header(&headers, "user_id", INPUT)?;
    let activity = required_header(&headers, "activityName", INPUT)?;
    let date = required_header(&headers, "date", INPUT)?;
    let daytime = required_header(&headers, "daytime_label", INPUT)?;
    let usage = required_header(&headers, "usage", INPUT)?;
    let nonusage = required_header(&headers, "nonusage", INPUT)?;
    let timestamp = required_header(&headers, "timestamp.corrected", INPUT)?;

    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = record.map_err(|error| format!("{INPUT} row {row_number}: {error}"))?;
        // `nonusage` is part of the upstream screen-preprocessing contract even
        // though the released between-person function reconstructs its own
        // sleep-bounded nonusage intervals from the usage sessions.
        let _ = optional_integer::<u64>(&record, nonusage, row_number, "nonusage", INPUT)?;
        rows.push(SensingRow {
            user_id: required_text(&record, user, row_number, "user_id", INPUT)?.to_owned(),
            activity_name: required_text(&record, activity, row_number, "activityName", INPUT)?
                .to_owned(),
            source_date: required_text(&record, date, row_number, "date", INPUT)?.to_owned(),
            daytime_label: optional_integer(&record, daytime, row_number, "daytime_label", INPUT)?,
            usage_id: optional_integer(&record, usage, row_number, "usage", INPUT)?,
            timestamp: parse_timestamp(
                required_text(&record, timestamp, row_number, "timestamp.corrected", INPUT)?,
                row_number,
                "timestamp.corrected",
                INPUT,
            )?,
        });
    }
    if rows.is_empty() {
        return Err(format!("{INPUT} has no data rows"));
    }
    Ok(rows)
}

fn parse_question_rows(raw_csv: &[u8]) -> Result<Vec<QuestionRow>, String> {
    const INPUT: &str = "daily screen-session questionnaire input";
    let mut reader = ReaderBuilder::new().flexible(false).from_reader(raw_csv);
    let headers = checked_headers(&mut reader, INPUT)?;
    let user = required_header(&headers, "user_id", INPUT)?;
    let date = required_header(&headers, "date", INPUT)?;
    let onset = required_header(&headers, "Sleep_onset.timestamp", INPUT)?;
    let offset = required_header(&headers, "Sleep_offset.timestamp", INPUT)?;
    let total_wake_time = required_header(&headers, "DailyTWT", INPUT)?;

    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let row_number = index + 2;
        let record = record.map_err(|error| format!("{INPUT} row {row_number}: {error}"))?;
        rows.push(QuestionRow {
            user_id: required_text(&record, user, row_number, "user_id", INPUT)?.to_owned(),
            source_date: required_text(&record, date, row_number, "date", INPUT)?.to_owned(),
            sleep_onset: optional_timestamp(
                &record,
                onset,
                row_number,
                "Sleep_onset.timestamp",
                INPUT,
            )?,
            sleep_offset: optional_timestamp(
                &record,
                offset,
                row_number,
                "Sleep_offset.timestamp",
                INPUT,
            )?,
            daily_total_wake_time: parse_r_number(
                &record,
                total_wake_time,
                row_number,
                "DailyTWT",
                INPUT,
            )?,
        });
    }
    if rows.is_empty() {
        return Err(format!("{INPUT} has no data rows"));
    }
    Ok(rows)
}

fn sum_in_order(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |sum, value| sum + value)
}

fn observed(values: &[RNumber]) -> Vec<f64> {
    values.iter().filter_map(|value| value.value()).collect()
}

fn r_sum_na_rm(values: &[RNumber]) -> RNumber {
    RNumber::from_f64(sum_in_order(&observed(values)))
}

fn r_mean_na_rm(values: &[RNumber]) -> RNumber {
    let values = observed(values);
    if values.is_empty() {
        RNumber::NotANumber
    } else {
        RNumber::from_f64(sum_in_order(&values) / values.len() as f64)
    }
}

fn r_sample_sd_na_rm(values: &[RNumber]) -> RNumber {
    let values = observed(values);
    if values.len() < 2 {
        return RNumber::Missing;
    }
    let mean = sum_in_order(&values) / values.len() as f64;
    let squared = values
        .iter()
        .map(|value| {
            let difference = value - mean;
            difference * difference
        })
        .collect::<Vec<_>>();
    RNumber::from_f64((sum_in_order(&squared) / (values.len() - 1) as f64).sqrt())
}

fn r_median_na_rm(values: &[RNumber]) -> RNumber {
    let mut values = observed(values);
    if values.is_empty() {
        return RNumber::Missing;
    }
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    let value = if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    };
    RNumber::from_f64(value)
}

fn quadratic_measure(values: &[RNumber]) -> RNumber {
    let values = observed(values);
    let Some(first) = values.first() else {
        return RNumber::Missing;
    };
    // The released helper uses a scalar outer `ifelse` around a vectorized
    // inner `ifelse`; consequently only the first non-missing zero determines
    // the special value one.
    if *first == 0.0 {
        return RNumber::Finite(1.0);
    }
    let numerator = sum_in_order(&values.iter().map(|value| value * value).collect::<Vec<_>>());
    let sum = sum_in_order(&values);
    RNumber::from_f64(numerator / (sum * sum))
}

fn summarize_days(
    sessions: &[Session],
    short_max_seconds_inclusive: f64,
    medium_max_seconds_inclusive: f64,
) -> Vec<DailyFeatures> {
    let mut by_day = BTreeMap::<i64, Vec<RNumber>>::new();
    for session in sessions {
        by_day.entry(session.daytime_label).or_default().push(
            session
                .duration_seconds()
                .map(RNumber::Finite)
                .unwrap_or(RNumber::Missing),
        );
    }
    by_day
        .into_iter()
        .map(|(daytime_label, durations)| {
            let finite_for_bins = observed(&durations);
            DailyFeatures {
                daytime_label,
                number_intervals: RNumber::Finite(durations.len() as f64),
                median_duration: r_median_na_rm(&durations),
                mean_duration: r_mean_na_rm(&durations),
                sample_sd_duration: r_sample_sd_na_rm(&durations),
                sum_duration: r_sum_na_rm(&durations),
                quadratic: quadratic_measure(&durations),
                short_count: RNumber::Finite(
                    finite_for_bins
                        .iter()
                        .filter(|value| **value <= short_max_seconds_inclusive)
                        .count() as f64,
                ),
                medium_count: RNumber::Finite(
                    finite_for_bins
                        .iter()
                        .filter(|value| {
                            **value > short_max_seconds_inclusive
                                && **value <= medium_max_seconds_inclusive
                        })
                        .count() as f64,
                ),
                long_count: RNumber::Finite(
                    finite_for_bins
                        .iter()
                        .filter(|value| **value > medium_max_seconds_inclusive)
                        .count() as f64,
                ),
            }
        })
        .collect()
}

fn usage_sessions(rows: &[SensingRow]) -> Vec<Session> {
    let mut groups = BTreeMap::<(i64, u64), (Timestamp, Timestamp)>::new();
    for row in rows {
        let (Some(daytime_label), Some(usage_id)) = (row.daytime_label, row.usage_id) else {
            continue;
        };
        groups
            .entry((daytime_label, usage_id))
            .and_modify(|entry| entry.1 = row.timestamp)
            .or_insert((row.timestamp, row.timestamp));
    }
    groups
        .into_iter()
        .map(|((daytime_label, _), (start, end))| Session {
            daytime_label,
            start: Some(start),
            end: Some(end),
        })
        .collect()
}

fn sample_mean(values: &[u64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<u64>() as f64 / values.len() as f64)
}

fn sample_sd(values: &[u64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let mean = sample_mean(values)?;
    Some(
        (values
            .iter()
            .map(|value| (*value as f64 - mean).powi(2))
            .sum::<f64>()
            / (values.len() - 1) as f64)
            .sqrt(),
    )
}

fn broken_logging_dates(
    rows: &[SensingRow],
    screen_activity_value: &str,
    application_activity_value: &str,
) -> BTreeSet<String> {
    let mut screen_counts = BTreeMap::<String, u64>::new();
    let mut app_counts = BTreeMap::<String, u64>::new();
    for row in rows {
        if row.activity_name == screen_activity_value {
            *screen_counts.entry(row.source_date.clone()).or_default() += 1;
        }
        if row.activity_name == application_activity_value {
            *app_counts.entry(row.source_date.clone()).or_default() += 1;
        }
    }
    let primary = screen_counts.values().copied().collect::<Vec<_>>();
    let Some(primary_mean) = sample_mean(&primary) else {
        return BTreeSet::new();
    };
    let Some(primary_sd) = sample_sd(&primary) else {
        return BTreeSet::new();
    };
    // The released left join followed by mean(..., na.rm = FALSE) makes one
    // absent application count turn the secondary mean into NA; R `which`
    // then selects no dates.
    if screen_counts
        .keys()
        .any(|date| !app_counts.contains_key(date))
    {
        return BTreeSet::new();
    }
    let joined_secondary = screen_counts
        .keys()
        .map(|date| app_counts[date])
        .collect::<Vec<_>>();
    let Some(secondary_mean) = sample_mean(&joined_secondary) else {
        return BTreeSet::new();
    };
    let cutoff = primary_mean - primary_sd;
    screen_counts
        .into_iter()
        .filter_map(|(date, primary_count)| {
            let secondary_count = app_counts[&date];
            ((primary_count as f64) < cutoff && (secondary_count as f64) > secondary_mean)
                .then_some(date)
        })
        .collect()
}

fn distinct_question_rows(rows: Vec<QuestionRow>) -> Vec<QuestionRow> {
    let mut dates = BTreeSet::new();
    rows.into_iter()
        .filter(|row| dates.insert(row.source_date.clone()))
        .collect()
}

fn join_question_day_labels(
    sensing: &[SensingRow],
    questions: Vec<QuestionRow>,
) -> Vec<JoinedQuestionRow> {
    // Reproduce distinct(daytime_label, .keep_all = TRUE), including one
    // first-occurrence NA label, before the date join.
    let mut seen_labels = BTreeSet::<Option<i64>>::new();
    let distinct_labels = sensing
        .iter()
        .filter(|row| seen_labels.insert(row.daytime_label))
        .map(|row| (row.source_date.clone(), row.daytime_label))
        .collect::<Vec<_>>();
    let mut joined = Vec::new();
    for question in questions {
        let labels = distinct_labels
            .iter()
            .filter(|(date, _)| date == &question.source_date)
            .map(|(_, label)| *label)
            .collect::<Vec<_>>();
        if labels.is_empty() {
            joined.push(JoinedQuestionRow {
                row: question,
                daytime_label: None,
            });
        } else {
            joined.extend(labels.into_iter().map(|daytime_label| JoinedQuestionRow {
                row: question.clone(),
                daytime_label,
            }));
        }
    }
    joined
}

fn unique_nonmissing_timestamp(
    rows: &[JoinedQuestionRow],
    label: i64,
    select: impl Fn(&QuestionRow) -> Option<Timestamp>,
    field: &str,
) -> Result<Option<Timestamp>, String> {
    let values = rows
        .iter()
        .filter(|row| row.daytime_label == Some(label))
        .filter_map(|row| select(&row.row))
        .collect::<Vec<_>>();
    if values.len() > 1 {
        return Err(format!(
            "daily screen-session questionnaire input has multiple non-missing {field} values for daytime_label {label}"
        ));
    }
    Ok(values.first().copied())
}

fn nonusage_sessions(
    usage_sessions: &[Session],
    joined_questions: &[JoinedQuestionRow],
) -> Result<Vec<Session>, String> {
    let mut label_order = Vec::new();
    for question in joined_questions {
        if let Some(label) = question.daytime_label {
            if !label_order.contains(&label) {
                label_order.push(label);
            }
        }
    }
    let mut result = Vec::new();
    for label in label_order {
        let mut current = usage_sessions
            .iter()
            .filter(|session| session.daytime_label == label)
            .copied()
            .collect::<Vec<_>>();
        current.sort_by_key(|session| session.start.map(|value| value.nanoseconds));
        if current.is_empty() {
            continue;
        }
        let start_day = unique_nonmissing_timestamp(
            joined_questions,
            label,
            |row| row.sleep_offset,
            "Sleep_offset.timestamp",
        )?
        .ok_or_else(|| {
            format!(
                "daily screen-session questionnaire input requires Sleep_offset.timestamp for daytime_label {label}"
            )
        })?;
        let end_day = unique_nonmissing_timestamp(
            joined_questions,
            label.checked_add(1).ok_or_else(|| {
                "daily screen-session daytime label overflows while locating next-day onset"
                    .to_owned()
            })?,
            |row| row.sleep_onset,
            "Sleep_onset.timestamp",
        )?;
        result.push(Session {
            daytime_label: label,
            start: Some(start_day),
            end: current[0].start,
        });
        for (index, usage) in current.iter().enumerate() {
            result.push(Session {
                daytime_label: label,
                start: usage.end,
                end: current.get(index + 1).and_then(|next| next.start).or(
                    if index + 1 == current.len() {
                        end_day
                    } else {
                        None
                    },
                ),
            });
        }
    }
    Ok(result)
}

fn participant_median(
    days: &[DailyFeatures],
    select: impl Fn(&DailyFeatures) -> RNumber,
) -> RNumber {
    r_median_na_rm(&days.iter().map(select).collect::<Vec<_>>())
}

fn daily_twt_by_label(
    joined_questions: &[JoinedQuestionRow],
    daily_nonusage: &[DailyFeatures],
) -> Result<Vec<RNumber>, String> {
    let mut twt = daily_nonusage
        .iter()
        .map(|day| (day.daytime_label, RNumber::Missing))
        .collect::<BTreeMap<_, _>>();
    for question in joined_questions {
        let Some(label) = question.daytime_label else {
            continue;
        };
        let Some(value) = question.row.daily_total_wake_time.value() else {
            continue;
        };
        let entry = twt.get_mut(&label);
        if let Some(entry) = entry {
            if entry.value().is_some() {
                return Err(format!(
                    "daily screen-session questionnaire input has multiple non-missing DailyTWT values for daytime_label {label}"
                ));
            }
            *entry = RNumber::from_f64(value);
        }
    }
    Ok(daily_nonusage
        .iter()
        .map(|day| twt[&day.daytime_label])
        .collect())
}

fn unique_participant(sensing: &[SensingRow], questions: &[QuestionRow]) -> Result<String, String> {
    let participants = sensing
        .iter()
        .map(|row| row.user_id.as_str())
        .chain(questions.iter().map(|row| row.user_id.as_str()))
        .collect::<BTreeSet<_>>();
    if participants.len() != 1 {
        return Err(
            "daily screen-session inputs must contain exactly one matching participant".to_owned(),
        );
    }
    Ok((*participants
        .first()
        .expect("nonempty inputs contribute one participant"))
    .to_owned())
}

/// Compute per-day usage/nonusage features and then the participant-level
/// medians from an already reconstructed screen table and questionnaire-day
/// support table.
pub fn execute_daily_screen_session_participant_summary_csv(
    sensing_csv: &[u8],
    questionnaire_csv: &[u8],
    configuration: &DailyScreenSessionParticipantSummaryConfiguration,
) -> Result<DailyScreenSessionParticipantSummaryOutput, String> {
    if configuration.input_stage != DAILY_SCREEN_SESSION_SUMMARY_INPUT_STAGE {
        return Err(format!(
            "daily screen-session participant summary requires input stage {DAILY_SCREEN_SESSION_SUMMARY_INPUT_STAGE}"
        ));
    }
    if configuration.screen_activity_value.is_empty()
        || configuration.application_activity_value.is_empty()
        || configuration.screen_activity_value == configuration.application_activity_value
        || !configuration.short_max_seconds_inclusive.is_finite()
        || !configuration.medium_max_seconds_inclusive.is_finite()
        || configuration.short_max_seconds_inclusive < 0.0
        || configuration.medium_max_seconds_inclusive <= configuration.short_max_seconds_inclusive
    {
        return Err(
            "daily screen-session participant summary has invalid activity labels or duration bins"
                .to_owned(),
        );
    }

    let sensing = parse_sensing_rows(sensing_csv)?;
    let questions = parse_question_rows(questionnaire_csv)?;
    let user_id = unique_participant(&sensing, &questions)?;
    let questions = distinct_question_rows(questions);
    let joined_questions = join_question_day_labels(&sensing, questions.clone());

    let all_usage_sessions = usage_sessions(&sensing);
    let excluded_dates = broken_logging_dates(
        &sensing,
        &configuration.screen_activity_value,
        &configuration.application_activity_value,
    );
    let retained_usage_sessions = all_usage_sessions
        .iter()
        .filter(|session| {
            session
                .start
                .and_then(|timestamp| timestamp.date().ok())
                .is_some_and(|date| !excluded_dates.contains(&date))
        })
        .copied()
        .collect::<Vec<_>>();
    let all_nonusage_sessions = nonusage_sessions(&all_usage_sessions, &joined_questions)?;
    let retained_nonusage_sessions = all_nonusage_sessions
        .iter()
        .filter(|session| {
            session
                .start
                .and_then(|timestamp| timestamp.date().ok())
                .is_some_and(|date| !excluded_dates.contains(&date))
        })
        .copied()
        .collect::<Vec<_>>();

    let daily_usage = summarize_days(
        &retained_usage_sessions,
        configuration.short_max_seconds_inclusive,
        configuration.medium_max_seconds_inclusive,
    );
    let daily_nonusage = summarize_days(
        &retained_nonusage_sessions,
        configuration.short_max_seconds_inclusive,
        configuration.medium_max_seconds_inclusive,
    );
    let daily_twt = daily_twt_by_label(&joined_questions, &daily_nonusage)?;

    let mut record = vec![
        participant_median(&daily_usage, |day| day.sum_duration).source_text(),
        participant_median(&daily_usage, |day| day.quadratic).source_text(),
        participant_median(&daily_usage, |day| day.number_intervals).source_text(),
        participant_median(&daily_usage, |day| day.mean_duration).source_text(),
        participant_median(&daily_usage, |day| day.sample_sd_duration).source_text(),
        participant_median(&daily_usage, |day| day.median_duration).source_text(),
        participant_median(&daily_usage, |day| day.short_count).source_text(),
        participant_median(&daily_usage, |day| day.medium_count).source_text(),
        participant_median(&daily_usage, |day| day.long_count).source_text(),
        r_median_na_rm(&daily_twt).source_text(),
        participant_median(&daily_nonusage, |day| day.sum_duration).source_text(),
        participant_median(&daily_nonusage, |day| day.quadratic).source_text(),
        participant_median(&daily_nonusage, |day| day.number_intervals).source_text(),
        participant_median(&daily_nonusage, |day| day.mean_duration).source_text(),
        participant_median(&daily_nonusage, |day| day.sample_sd_duration).source_text(),
        participant_median(&daily_nonusage, |day| day.median_duration).source_text(),
        participant_median(&daily_nonusage, |day| day.short_count).source_text(),
        participant_median(&daily_nonusage, |day| day.medium_count).source_text(),
        participant_median(&daily_nonusage, |day| day.long_count).source_text(),
    ];
    let num_ema_days = joined_questions
        .iter()
        .map(|row| row.daytime_label)
        .collect::<BTreeSet<_>>()
        .len();
    record.push(num_ema_days.to_string());
    record.push(user_id);

    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(OUTPUT_HEADER)
        .map_err(|error| format!("daily screen-session summary output header: {error}"))?;
    writer
        .write_record(&record)
        .map_err(|error| format!("daily screen-session summary output row: {error}"))?;
    let derived_csv = writer
        .into_inner()
        .map_err(|error| format!("daily screen-session summary output flush: {error}"))?;

    Ok(DailyScreenSessionParticipantSummaryOutput {
        derived_csv,
        sensing_row_count: sensing.len(),
        questionnaire_row_count: questions.len(),
        usage_session_count: retained_usage_sessions.len(),
        nonusage_session_count: retained_nonusage_sessions.len(),
        excluded_day_count: excluded_dates.len(),
        output_row_count: 1,
    })
}
