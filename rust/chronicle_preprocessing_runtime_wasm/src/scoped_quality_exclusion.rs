//! Small, scope-preserving quality-control predicates over already-derived
//! evidence.
//!
//! These functions deliberately do not infer participant-day boundaries,
//! reconstruct screen intervals, or guess absent count denominators. Their
//! inputs are the explicit outputs of those upstream stages.

use crate::screen_bout_daily_summary::{ObservedScreenDay, ScreenBoutDailyDuration};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipantDayDurationDecision {
    pub participant_id: String,
    pub source_day_id: String,
    pub total_duration_ns: u64,
    pub exclude_day: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParticipantDayDurationExclusionError {
    ZeroThreshold,
    MissingObservedDayDenominator,
    MissingDailyDurations,
    EmptyParticipantId,
    EmptySourceDayId,
    DuplicateParticipantDay {
        participant_id: String,
        source_day_id: String,
    },
    MissingDailyDuration {
        participant_id: String,
        source_day_id: String,
    },
    DurationWithoutObservedDay {
        participant_id: String,
        source_day_id: String,
    },
}

impl fmt::Display for ParticipantDayDurationExclusionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroThreshold => {
                formatter.write_str("participant-day duration threshold is zero")
            }
            Self::MissingObservedDayDenominator => {
                formatter.write_str("participant-day observed-day denominator is missing")
            }
            Self::MissingDailyDurations => {
                formatter.write_str("participant-day duration input is missing")
            }
            Self::EmptyParticipantId => {
                formatter.write_str("participant-day participant ID is empty")
            }
            Self::EmptySourceDayId => formatter.write_str("participant-day source day ID is empty"),
            Self::DuplicateParticipantDay {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "duplicate participant-day duration for {participant_id}/{source_day_id}"
            ),
            Self::MissingDailyDuration {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "observed participant-day {participant_id}/{source_day_id} has no duration total"
            ),
            Self::DurationWithoutObservedDay {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "participant-day duration {participant_id}/{source_day_id} is absent from the observed-day denominator"
            ),
        }
    }
}

impl std::error::Error for ParticipantDayDurationExclusionError {}

/// Classify complete, pre-aggregated participant-day phone-use totals.
///
/// The configured threshold is inclusive: equality is retained and only a
/// strict `>` result excludes the identified participant-day.
pub fn exclude_participant_days_over_duration(
    observed_days: &[ObservedScreenDay],
    daily_durations: &[ScreenBoutDailyDuration],
    maximum_inclusive_duration_ns: u64,
) -> Result<Vec<ParticipantDayDurationDecision>, ParticipantDayDurationExclusionError> {
    if maximum_inclusive_duration_ns == 0 {
        return Err(ParticipantDayDurationExclusionError::ZeroThreshold);
    }
    if observed_days.is_empty() {
        return Err(ParticipantDayDurationExclusionError::MissingObservedDayDenominator);
    }
    if daily_durations.is_empty() {
        return Err(ParticipantDayDurationExclusionError::MissingDailyDurations);
    }

    let mut denominator = BTreeSet::new();
    for day in observed_days {
        if day.participant_id.trim().is_empty() {
            return Err(ParticipantDayDurationExclusionError::EmptyParticipantId);
        }
        if day.source_day_id.trim().is_empty() {
            return Err(ParticipantDayDurationExclusionError::EmptySourceDayId);
        }
        let identity = (day.participant_id.clone(), day.source_day_id.clone());
        if !denominator.insert(identity.clone()) {
            return Err(
                ParticipantDayDurationExclusionError::DuplicateParticipantDay {
                    participant_id: identity.0,
                    source_day_id: identity.1,
                },
            );
        }
    }

    let mut seen = BTreeSet::new();
    let mut decisions = Vec::with_capacity(daily_durations.len());
    for day in daily_durations {
        if day.participant_id.trim().is_empty() {
            return Err(ParticipantDayDurationExclusionError::EmptyParticipantId);
        }
        if day.source_day_id.trim().is_empty() {
            return Err(ParticipantDayDurationExclusionError::EmptySourceDayId);
        }
        let identity = (day.participant_id.clone(), day.source_day_id.clone());
        if !denominator.contains(&identity) {
            return Err(
                ParticipantDayDurationExclusionError::DurationWithoutObservedDay {
                    participant_id: identity.0,
                    source_day_id: identity.1,
                },
            );
        }
        if !seen.insert(identity.clone()) {
            return Err(
                ParticipantDayDurationExclusionError::DuplicateParticipantDay {
                    participant_id: identity.0,
                    source_day_id: identity.1,
                },
            );
        }
        decisions.push(ParticipantDayDurationDecision {
            participant_id: day.participant_id.clone(),
            source_day_id: day.source_day_id.clone(),
            total_duration_ns: day.duration_ns,
            exclude_day: day.duration_ns > maximum_inclusive_duration_ns,
        });
    }
    if let Some((participant_id, source_day_id)) = denominator.difference(&seen).next() {
        return Err(ParticipantDayDurationExclusionError::MissingDailyDuration {
            participant_id: participant_id.clone(),
            source_day_id: source_day_id.clone(),
        });
    }
    Ok(decisions)
}

/// Per-date counts at the deposited left-join boundary: every row represents
/// a date with at least one primary event, while the secondary count can be
/// absent if that join found no matching date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyPairedEventCounts {
    pub date: String,
    pub primary_count: u64,
    pub secondary_count: Option<u64>,
}

/// Explicit date-to-EMA/session scope mapping. The source excludes derived
/// usage and nonusage rows by their start date, so every matching scope on a
/// broken date is excluded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateEmaScope {
    pub date: String,
    pub ema_scope_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DailyCountEvidence {
    pub date: String,
    pub primary_count: u64,
    pub secondary_count: Option<u64>,
    pub primary_below_cutoff: bool,
    pub secondary_above_mean: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExcludedDateEmaScope {
    pub date: String,
    pub ema_scope_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DateCountConjunctionEvaluation {
    pub primary_mean: Option<f64>,
    pub primary_sample_sd: Option<f64>,
    pub primary_cutoff: Option<f64>,
    pub secondary_mean: Option<f64>,
    pub daily_evidence: Vec<DailyCountEvidence>,
    pub excluded_scopes: Vec<ExcludedDateEmaScope>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DateCountConjunctionError {
    EmptyDate,
    EmptyEmaScopeId,
    ZeroPrimaryCount(String),
    DuplicateCountDate(String),
    DuplicateEmaScopeId(String),
}

impl fmt::Display for DateCountConjunctionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyDate => formatter.write_str("date event-count input has an empty date"),
            Self::EmptyEmaScopeId => formatter.write_str("date/EMA input has an empty scope ID"),
            Self::ZeroPrimaryCount(date) => {
                write!(
                    formatter,
                    "primary-observed date {date} has a zero primary count"
                )
            }
            Self::DuplicateCountDate(date) => {
                write!(formatter, "date event-count input repeats {date}")
            }
            Self::DuplicateEmaScopeId(scope_id) => {
                write!(formatter, "date/EMA input repeats scope ID {scope_id}")
            }
        }
    }
}

impl std::error::Error for DateCountConjunctionError {}

/// Evaluate the deposited date-level conjunction over complete paired counts.
///
/// `primary_count < mean(primary)-sample_sd(primary)` and
/// `secondary_count > mean(secondary)` are both strict. Statistics use every
/// supplied primary-observed date. The source's observed `NA` behavior is
/// reproduced: fewer than two primary dates makes sample SD/cutoff missing,
/// and any missing secondary count makes the secondary mean missing. R's
/// comparisons then yield `NA`, which `which(...)` does not select.
pub fn evaluate_date_scoped_count_conjunction(
    daily_counts: &[DailyPairedEventCounts],
    date_ema_scopes: &[DateEmaScope],
) -> Result<DateCountConjunctionEvaluation, DateCountConjunctionError> {
    let mut by_date = BTreeMap::new();
    for row in daily_counts {
        if row.date.trim().is_empty() {
            return Err(DateCountConjunctionError::EmptyDate);
        }
        if row.primary_count == 0 {
            return Err(DateCountConjunctionError::ZeroPrimaryCount(
                row.date.clone(),
            ));
        }
        if by_date
            .insert(row.date.clone(), (row.primary_count, row.secondary_count))
            .is_some()
        {
            return Err(DateCountConjunctionError::DuplicateCountDate(
                row.date.clone(),
            ));
        }
    }

    let count = by_date.len() as f64;
    let primary_mean = (!by_date.is_empty()).then(|| {
        by_date
            .values()
            .fold(0.0, |sum, (primary, _)| sum + *primary as f64)
            / count
    });
    let primary_sample_sd = (by_date.len() >= 2).then(|| {
        let mean = primary_mean.expect("nonempty primary dates have a mean");
        (by_date.values().fold(0.0, |sum, (primary, _)| {
            let deviation = *primary as f64 - mean;
            sum + deviation * deviation
        }) / (count - 1.0))
            .sqrt()
    });
    let primary_cutoff = primary_mean
        .zip(primary_sample_sd)
        .map(|(mean, sample_sd)| mean - sample_sd);
    let secondary_mean = (!by_date.is_empty()
        && by_date.values().all(|(_, secondary)| secondary.is_some()))
    .then(|| {
        by_date.values().fold(0.0, |sum, (_, secondary)| {
            sum + secondary.expect("all secondary counts are present") as f64
        }) / count
    });

    let daily_evidence = by_date
        .iter()
        .map(
            |(date, (primary_count, secondary_count))| DailyCountEvidence {
                date: date.clone(),
                primary_count: *primary_count,
                secondary_count: *secondary_count,
                primary_below_cutoff: primary_cutoff
                    .is_some_and(|cutoff| (*primary_count as f64) < cutoff),
                secondary_above_mean: secondary_count
                    .zip(secondary_mean)
                    .is_some_and(|(secondary, mean)| secondary as f64 > mean),
            },
        )
        .collect::<Vec<_>>();
    let broken_dates = daily_evidence
        .iter()
        .filter(|row| row.primary_below_cutoff && row.secondary_above_mean)
        .map(|row| row.date.as_str())
        .collect::<BTreeSet<_>>();

    let mut scope_ids = BTreeSet::new();
    let mut excluded_scopes = Vec::new();
    for scope in date_ema_scopes {
        if scope.date.trim().is_empty() {
            return Err(DateCountConjunctionError::EmptyDate);
        }
        if scope.ema_scope_id.trim().is_empty() {
            return Err(DateCountConjunctionError::EmptyEmaScopeId);
        }
        if !scope_ids.insert(scope.ema_scope_id.clone()) {
            return Err(DateCountConjunctionError::DuplicateEmaScopeId(
                scope.ema_scope_id.clone(),
            ));
        }
        if broken_dates.contains(scope.date.as_str()) {
            excluded_scopes.push(ExcludedDateEmaScope {
                date: scope.date.clone(),
                ema_scope_id: scope.ema_scope_id.clone(),
            });
        }
    }

    Ok(DateCountConjunctionEvaluation {
        primary_mean,
        primary_sample_sd,
        primary_cutoff,
        secondary_mean,
        daily_evidence,
        excluded_scopes,
    })
}
