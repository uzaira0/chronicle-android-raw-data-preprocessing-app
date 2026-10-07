//! Per-questionnaire summaries for already materialized screen-state sessions.
//!
//! This bounded operator does not construct sessions, assign questionnaire
//! membership, join questionnaire payloads, or apply downstream exclusions.

use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenSessionState {
    Usage,
    Nonusage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializedQuestionnaireScreenSession {
    pub questionnaire_id: String,
    pub state: ScreenSessionState,
    pub start_timestamp_ns: Option<i64>,
    pub end_timestamp_ns: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenSessionDurationBins {
    pub short_max_seconds_inclusive: f64,
    pub medium_max_seconds_inclusive: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RCompatibleNumber {
    Finite(f64),
    Missing,
    NotANumber,
    PositiveInfinity,
    NegativeInfinity,
}

impl RCompatibleNumber {
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenSessionStateSummary {
    pub session_count: usize,
    pub sum_duration_seconds: RCompatibleNumber,
    pub mean_duration_seconds: RCompatibleNumber,
    pub sample_sd_duration_seconds: RCompatibleNumber,
    pub median_duration_seconds: RCompatibleNumber,
    pub short_duration_count: usize,
    pub medium_duration_count: usize,
    pub long_duration_count: usize,
    pub quadratic_concentration: RCompatibleNumber,
    pub sum_squared_duration_seconds2: RCompatibleNumber,
    pub squared_sum_duration_seconds2: RCompatibleNumber,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuestionnaireScreenSessionSummary {
    pub questionnaire_id: String,
    pub usage: ScreenSessionStateSummary,
    pub nonusage: ScreenSessionStateSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenSessionSummaryError {
    InvalidDurationBins,
}

impl fmt::Display for ScreenSessionSummaryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDurationBins => formatter.write_str(
                "screen-session duration-bin boundaries must be finite, nonnegative, and increasing",
            ),
        }
    }
}

impl std::error::Error for ScreenSessionSummaryError {}

fn zero_filled_absent_state() -> ScreenSessionStateSummary {
    ScreenSessionStateSummary {
        session_count: 0,
        sum_duration_seconds: RCompatibleNumber::Finite(0.0),
        mean_duration_seconds: RCompatibleNumber::Finite(0.0),
        sample_sd_duration_seconds: RCompatibleNumber::Missing,
        median_duration_seconds: RCompatibleNumber::Finite(0.0),
        short_duration_count: 0,
        medium_duration_count: 0,
        long_duration_count: 0,
        quadratic_concentration: RCompatibleNumber::Finite(1.0),
        sum_squared_duration_seconds2: RCompatibleNumber::Finite(0.0),
        squared_sum_duration_seconds2: RCompatibleNumber::Finite(0.0),
    }
}

fn sum_in_source_order(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |sum, value| sum + value)
}

fn summarize_present_state(
    durations: &[Option<f64>],
    bins: ScreenSessionDurationBins,
) -> ScreenSessionStateSummary {
    let valid = durations.iter().copied().flatten().collect::<Vec<_>>();
    let sum = sum_in_source_order(&valid);
    let mean = if valid.is_empty() {
        f64::NAN
    } else {
        sum / valid.len() as f64
    };
    let sample_sd = if valid.len() < 2 {
        RCompatibleNumber::Missing
    } else {
        let squared_deviations = valid
            .iter()
            .map(|value| {
                let deviation = value - mean;
                deviation * deviation
            })
            .collect::<Vec<_>>();
        RCompatibleNumber::from_f64(
            (sum_in_source_order(&squared_deviations) / (valid.len() - 1) as f64).sqrt(),
        )
    };
    let median = if valid.is_empty() {
        RCompatibleNumber::Missing
    } else {
        let mut ordered = valid.clone();
        ordered.sort_by(|left, right| left.total_cmp(right));
        let middle = ordered.len() / 2;
        let value = if ordered.len() % 2 == 0 {
            (ordered[middle - 1] + ordered[middle]) / 2.0
        } else {
            ordered[middle]
        };
        RCompatibleNumber::from_f64(value)
    };

    let sum_squared = if valid.is_empty() {
        None
    } else {
        Some(sum_in_source_order(
            &valid.iter().map(|value| value * value).collect::<Vec<_>>(),
        ))
    };
    let squared_sum = if valid.is_empty() {
        None
    } else {
        Some(sum * sum)
    };
    // Preserve the deposited helper's nested scalar `ifelse`: after missing
    // values are removed, a zero first element returns 1; otherwise only the
    // first element of the vectorized inner result is retained.
    let quadratic = match (valid.first(), sum_squared, squared_sum) {
        (None, _, _) => RCompatibleNumber::Missing,
        (Some(first), _, _) if *first == 0.0 => RCompatibleNumber::Finite(1.0),
        (Some(_), Some(numerator), Some(denominator)) => {
            RCompatibleNumber::from_f64(numerator / denominator)
        }
        _ => unreachable!("nonempty durations have quadratic operands"),
    };

    ScreenSessionStateSummary {
        session_count: durations.len(),
        sum_duration_seconds: RCompatibleNumber::from_f64(sum),
        mean_duration_seconds: RCompatibleNumber::from_f64(mean),
        sample_sd_duration_seconds: sample_sd,
        median_duration_seconds: median,
        short_duration_count: valid
            .iter()
            .filter(|duration| **duration <= bins.short_max_seconds_inclusive)
            .count(),
        medium_duration_count: valid
            .iter()
            .filter(|duration| {
                **duration > bins.short_max_seconds_inclusive
                    && **duration <= bins.medium_max_seconds_inclusive
            })
            .count(),
        long_duration_count: valid
            .iter()
            .filter(|duration| **duration > bins.medium_max_seconds_inclusive)
            .count(),
        quadratic_concentration: quadratic,
        sum_squared_duration_seconds2: sum_squared
            .map(RCompatibleNumber::from_f64)
            .unwrap_or(RCompatibleNumber::Missing),
        squared_sum_duration_seconds2: squared_sum
            .map(RCompatibleNumber::from_f64)
            .unwrap_or(RCompatibleNumber::Missing),
    }
}

fn duration_seconds(session: &MaterializedQuestionnaireScreenSession) -> Option<f64> {
    let start = session.start_timestamp_ns?;
    let end = session.end_timestamp_ns?;
    Some((i128::from(end) - i128::from(start)) as f64 / 1_000_000_000.0)
}

/// Summarize already materialized usage/nonusage sessions by questionnaire.
///
/// Session rows remain in caller order within each questionnaire/state because
/// the source quadratic helper is observably sensitive to whether the first
/// non-missing duration is zero. Missing endpoints contribute to `n()` but are
/// removed by all duration aggregations and bins. An entirely absent state is
/// zero-filled, except for missing sample SD and a quadratic value of one.
pub fn summarize_questionnaire_screen_sessions(
    sessions: &[MaterializedQuestionnaireScreenSession],
    bins: ScreenSessionDurationBins,
) -> Result<Vec<QuestionnaireScreenSessionSummary>, ScreenSessionSummaryError> {
    if !bins.short_max_seconds_inclusive.is_finite()
        || !bins.medium_max_seconds_inclusive.is_finite()
        || bins.short_max_seconds_inclusive < 0.0
        || bins.medium_max_seconds_inclusive <= bins.short_max_seconds_inclusive
    {
        return Err(ScreenSessionSummaryError::InvalidDurationBins);
    }

    let mut grouped = BTreeMap::<String, (Vec<Option<f64>>, Vec<Option<f64>>)>::new();
    for session in sessions {
        let entry = grouped.entry(session.questionnaire_id.clone()).or_default();
        match session.state {
            ScreenSessionState::Usage => entry.0.push(duration_seconds(session)),
            ScreenSessionState::Nonusage => entry.1.push(duration_seconds(session)),
        }
    }

    Ok(grouped
        .into_iter()
        .map(
            |(questionnaire_id, (usage_durations, nonusage_durations))| {
                QuestionnaireScreenSessionSummary {
                    questionnaire_id,
                    usage: if usage_durations.is_empty() {
                        zero_filled_absent_state()
                    } else {
                        summarize_present_state(&usage_durations, bins)
                    },
                    nonusage: if nonusage_durations.is_empty() {
                        zero_filled_absent_state()
                    } else {
                        summarize_present_state(&nonusage_durations, bins)
                    },
                }
            },
        )
        .collect())
}
