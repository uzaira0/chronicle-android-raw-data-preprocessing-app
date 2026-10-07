//! Fixed high-side cap for already-computed weekly self-report measures.
//!
//! This is not percentile winsorization: the cited source marks every weekly
//! value at or above 84 hours as an outlier, retains the row, and replaces the
//! analysis value with 84 hours.

use std::fmt;

pub const SOURCE_WEEKLY_CAP_HOURS: f64 = 84.0;

#[derive(Debug, Clone, PartialEq)]
pub struct WeeklySelfReportRecord<T> {
    pub participant_id: String,
    /// Caller-selected self-report measure (for example, total or one domain).
    pub measure_id: String,
    pub weekly_hours: f64,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CappedWeeklySelfReport<T> {
    pub participant_id: String,
    pub measure_id: String,
    pub original_weekly_hours: f64,
    pub analysis_weekly_hours: f64,
    pub source_outlier: bool,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FixedWeeklyCapError {
    EmptyParticipantId {
        source_record_index: usize,
    },
    EmptyMeasureId {
        source_record_index: usize,
    },
    InvalidWeeklyHours {
        source_record_index: usize,
        value: f64,
    },
}

impl fmt::Display for FixedWeeklyCapError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyParticipantId {
                source_record_index,
            } => write!(
                formatter,
                "weekly self-report record {source_record_index} has an empty participant ID"
            ),
            Self::EmptyMeasureId {
                source_record_index,
            } => write!(
                formatter,
                "weekly self-report record {source_record_index} has an empty measure ID"
            ),
            Self::InvalidWeeklyHours {
                source_record_index,
                value,
            } => write!(
                formatter,
                "weekly self-report record {source_record_index} has invalid hours {value}"
            ),
        }
    }
}

impl std::error::Error for FixedWeeklyCapError {}

/// Apply the source's inclusive `>= 84 h/week` predicate and fixed replacement.
///
/// Input order, duplicates, participant identity, measure identity, the
/// original value, and the opaque payload are preserved.
pub fn cap_weekly_self_reports_at_84_hours<T>(
    records: Vec<WeeklySelfReportRecord<T>>,
) -> Result<Vec<CappedWeeklySelfReport<T>>, FixedWeeklyCapError> {
    records
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            let source_record_index = index + 1;
            if record.participant_id.is_empty() {
                return Err(FixedWeeklyCapError::EmptyParticipantId {
                    source_record_index,
                });
            }
            if record.measure_id.is_empty() {
                return Err(FixedWeeklyCapError::EmptyMeasureId {
                    source_record_index,
                });
            }
            if !record.weekly_hours.is_finite() || record.weekly_hours < 0.0 {
                return Err(FixedWeeklyCapError::InvalidWeeklyHours {
                    source_record_index,
                    value: record.weekly_hours,
                });
            }
            let source_outlier = record.weekly_hours >= SOURCE_WEEKLY_CAP_HOURS;
            Ok(CappedWeeklySelfReport {
                participant_id: record.participant_id,
                measure_id: record.measure_id,
                original_weekly_hours: record.weekly_hours,
                analysis_weekly_hours: if source_outlier {
                    SOURCE_WEEKLY_CAP_HOURS
                } else {
                    record.weekly_hours
                },
                source_outlier,
                payload: record.payload,
            })
        })
        .collect()
}
