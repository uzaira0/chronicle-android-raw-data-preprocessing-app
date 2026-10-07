//! Counts and a response ratio over an already-selected call-state slice.
//!
//! State matching is exact and case-sensitive. Every supplied row contributes
//! to the total, while missing or unrecognized states contribute to none of the
//! named-state counts. A zero response denominator produces NaN. Duration
//! summaries consume already-projected overlap values in row order and leave
//! the caller responsible for specifying the coordinate units per minute.

const INCOMING: &str = "incoming";
const OUTGOING: &str = "outgoing";
const MISSED: &str = "missed";

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CallStateSummary {
    pub(crate) incoming_count: usize,
    pub(crate) outgoing_count: usize,
    pub(crate) total_count: usize,
    pub(crate) missed_count: usize,
    pub(crate) incoming_response_rate: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CallOverlap<'a> {
    pub(crate) state: Option<&'a str>,
    pub(crate) overlap: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CallDurationSummary {
    pub(crate) incoming_minutes: f64,
    pub(crate) total_minutes: f64,
    pub(crate) outgoing_minutes: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallDurationSummaryError {
    InvalidUnitsPerMinute,
}

pub(crate) fn summarize_call_states(states: &[Option<&str>]) -> CallStateSummary {
    let incoming_count = states
        .iter()
        .filter(|state| **state == Some(INCOMING))
        .count();
    let outgoing_count = states
        .iter()
        .filter(|state| **state == Some(OUTGOING))
        .count();
    let missed_count = states
        .iter()
        .filter(|state| **state == Some(MISSED))
        .count();
    let response_denominator = incoming_count + missed_count;
    let incoming_response_rate = if response_denominator == 0 {
        f64::NAN
    } else {
        incoming_count as f64 / response_denominator as f64
    };

    CallStateSummary {
        incoming_count,
        outgoing_count,
        total_count: states.len(),
        missed_count,
        incoming_response_rate,
    }
}

pub(crate) fn summarize_call_overlap_durations(
    rows: &[CallOverlap<'_>],
    units_per_minute: f64,
) -> Result<CallDurationSummary, CallDurationSummaryError> {
    if !units_per_minute.is_finite() || units_per_minute <= 0.0 {
        return Err(CallDurationSummaryError::InvalidUnitsPerMinute);
    }

    let incoming_minutes = python_builtin_sum(
        rows.iter()
            .filter(|row| row.state == Some(INCOMING))
            .map(|row| row.overlap),
    ) / units_per_minute;
    let total_minutes = python_builtin_sum(rows.iter().map(|row| row.overlap)) / units_per_minute;
    let outgoing_minutes = python_builtin_sum(
        rows.iter()
            .filter(|row| row.state == Some(OUTGOING))
            .map(|row| row.overlap),
    ) / units_per_minute;

    Ok(CallDurationSummary {
        incoming_minutes,
        total_minutes,
        outgoing_minutes,
    })
}

fn python_builtin_sum(values: impl Iterator<Item = f64>) -> f64 {
    values.fold(0.0, |total, value| total + value)
}
