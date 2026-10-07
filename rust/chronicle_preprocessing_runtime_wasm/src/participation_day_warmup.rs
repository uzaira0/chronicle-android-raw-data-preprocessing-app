//! Exclude the first hour relative to an explicitly supplied participation-day boundary.
//!
//! The cited source does not equate a participation day with a calendar day:
//! participants could adjust the collection window. Consequently this operator
//! never derives a boundary from wall-clock time or from the first observed row.

use std::collections::BTreeMap;
use std::fmt;

pub const SOURCE_WARMUP_DURATION_NS: i64 = 3_600_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipationDayBoundary {
    pub participant_id: String,
    pub source_day_id: String,
    pub start_timestamp_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipationDayRecord<T> {
    pub participant_id: String,
    pub source_day_id: String,
    pub event_timestamp_ns: i64,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParticipationDayWarmupError {
    EmptyParticipantId,
    EmptySourceDayId,
    DuplicateBoundary {
        participant_id: String,
        source_day_id: String,
    },
    MissingBoundary {
        participant_id: String,
        source_day_id: String,
    },
    EventBeforeBoundary {
        participant_id: String,
        source_day_id: String,
        event_timestamp_ns: i64,
        start_timestamp_ns: i64,
    },
    BoundaryOverflow {
        participant_id: String,
        source_day_id: String,
    },
}

impl fmt::Display for ParticipationDayWarmupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyParticipantId => formatter.write_str("participant ID is empty"),
            Self::EmptySourceDayId => formatter.write_str("source participation-day ID is empty"),
            Self::DuplicateBoundary {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "duplicate participation-day boundary for {participant_id}/{source_day_id}"
            ),
            Self::MissingBoundary {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "missing participation-day boundary for {participant_id}/{source_day_id}"
            ),
            Self::EventBeforeBoundary {
                participant_id,
                source_day_id,
                event_timestamp_ns,
                start_timestamp_ns,
            } => write!(
                formatter,
                "event {event_timestamp_ns} precedes participation-day boundary {start_timestamp_ns} for {participant_id}/{source_day_id}"
            ),
            Self::BoundaryOverflow {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "participation-day warmup boundary overflows for {participant_id}/{source_day_id}"
            ),
        }
    }
}

impl std::error::Error for ParticipationDayWarmupError {}

fn validate_key(
    participant_id: &str,
    source_day_id: &str,
) -> Result<(), ParticipationDayWarmupError> {
    if participant_id.is_empty() {
        return Err(ParticipationDayWarmupError::EmptyParticipantId);
    }
    if source_day_id.is_empty() {
        return Err(ParticipationDayWarmupError::EmptySourceDayId);
    }
    Ok(())
}

/// Retain records at or after one elapsed hour from their supplied day boundary.
///
/// Input order, duplicate records, and payloads are preserved. Missing day
/// boundaries fail closed; this function does not infer one from midnight, a
/// timezone, the collection-window default, or the first observed record.
pub fn exclude_first_participation_day_hour<T>(
    records: Vec<ParticipationDayRecord<T>>,
    boundaries: Vec<ParticipationDayBoundary>,
) -> Result<Vec<ParticipationDayRecord<T>>, ParticipationDayWarmupError> {
    let mut starts = BTreeMap::new();
    for boundary in boundaries {
        validate_key(&boundary.participant_id, &boundary.source_day_id)?;
        let key = (boundary.participant_id, boundary.source_day_id);
        if starts
            .insert(key.clone(), boundary.start_timestamp_ns)
            .is_some()
        {
            return Err(ParticipationDayWarmupError::DuplicateBoundary {
                participant_id: key.0,
                source_day_id: key.1,
            });
        }
    }

    let mut retained = Vec::with_capacity(records.len());
    for record in records {
        validate_key(&record.participant_id, &record.source_day_id)?;
        let key = (record.participant_id.clone(), record.source_day_id.clone());
        let start_timestamp_ns =
            *starts
                .get(&key)
                .ok_or_else(|| ParticipationDayWarmupError::MissingBoundary {
                    participant_id: key.0.clone(),
                    source_day_id: key.1.clone(),
                })?;
        if record.event_timestamp_ns < start_timestamp_ns {
            return Err(ParticipationDayWarmupError::EventBeforeBoundary {
                participant_id: key.0,
                source_day_id: key.1,
                event_timestamp_ns: record.event_timestamp_ns,
                start_timestamp_ns,
            });
        }
        let cutoff = start_timestamp_ns
            .checked_add(SOURCE_WARMUP_DURATION_NS)
            .ok_or(ParticipationDayWarmupError::BoundaryOverflow {
                participant_id: key.0,
                source_day_id: key.1,
            })?;
        if record.event_timestamp_ns >= cutoff {
            retained.push(record);
        }
    }
    Ok(retained)
}
