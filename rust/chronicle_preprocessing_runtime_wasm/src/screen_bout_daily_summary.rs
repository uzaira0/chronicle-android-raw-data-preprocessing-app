//! Participant-level quality control and daily summaries for already-paired
//! screen bouts with an explicit observed-day inventory.
//!
//! This post-reconstruction operator does not pair raw events or infer calendar
//! days. Callers must supply each screen-on/screen-off pair and every day that
//! belongs in the participant denominator.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenBoutDailySummaryConfiguration {
    /// A bout at this duration is retained; a longer bout excludes its entire
    /// participant.
    pub maximum_inclusive_bout_duration_ns: u64,
    /// A participant with exactly this many supplied observed days is retained;
    /// one with fewer days is excluded.
    pub minimum_inclusive_observed_day_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedScreenDay {
    pub participant_id: String,
    /// Opaque caller-owned day identity. No timezone or midnight boundary is
    /// inferred by this operator.
    pub source_day_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairedScreenBout {
    pub bout_id: String,
    pub participant_id: String,
    pub source_day_id: String,
    pub screen_on_timestamp_ns: i64,
    pub screen_off_timestamp_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum ScreenBoutParticipantExclusionReason {
    BoutExceedsMaximum,
    FewerThanMinimumObservedDays,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExcludedScreenBoutParticipant {
    pub participant_id: String,
    pub observed_day_count: usize,
    pub maximum_bout_duration_ns: Option<u64>,
    pub reasons: Vec<ScreenBoutParticipantExclusionReason>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenBoutDailyDuration {
    pub participant_id: String,
    pub source_day_id: String,
    pub duration_ns: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenBoutParticipantMean {
    pub participant_id: String,
    pub observed_day_count: usize,
    pub total_duration_ns: u64,
    /// The exact mean is `total_duration_ns / observed_day_count`; both terms
    /// are retained alongside this convenient numeric projection.
    pub mean_daily_duration_ns: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenBoutDailySummary {
    pub retained_daily_durations: Vec<ScreenBoutDailyDuration>,
    pub retained_participant_means: Vec<ScreenBoutParticipantMean>,
    pub excluded_participants: Vec<ExcludedScreenBoutParticipant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScreenBoutDailySummaryError {
    ZeroMaximumBoutDuration,
    ZeroMinimumObservedDays,
    EmptyParticipantId,
    EmptySourceDayId,
    EmptyBoutId,
    DuplicateObservedDay {
        participant_id: String,
        source_day_id: String,
    },
    DuplicateBoutId(String),
    BoutWithoutObservedDay {
        bout_id: String,
        participant_id: String,
        source_day_id: String,
    },
    NonPositiveBoutDuration(String),
    DurationOverflow,
}

impl fmt::Display for ScreenBoutDailySummaryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroMaximumBoutDuration => {
                formatter.write_str("screen-bout maximum duration must be positive")
            }
            Self::ZeroMinimumObservedDays => {
                formatter.write_str("screen-bout minimum observed-day count must be positive")
            }
            Self::EmptyParticipantId => formatter.write_str("screen-bout participant ID is empty"),
            Self::EmptySourceDayId => formatter.write_str("screen-bout source day ID is empty"),
            Self::EmptyBoutId => formatter.write_str("screen-bout ID is empty"),
            Self::DuplicateObservedDay {
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "duplicate observed day {source_day_id} for participant {participant_id}"
            ),
            Self::DuplicateBoutId(bout_id) => write!(formatter, "duplicate screen-bout ID {bout_id}"),
            Self::BoutWithoutObservedDay {
                bout_id,
                participant_id,
                source_day_id,
            } => write!(
                formatter,
                "screen bout {bout_id} references unregistered day {source_day_id} for participant {participant_id}"
            ),
            Self::NonPositiveBoutDuration(bout_id) => write!(
                formatter,
                "screen bout {bout_id} does not end after its screen-on timestamp"
            ),
            Self::DurationOverflow => formatter.write_str("screen-bout duration accumulation overflow"),
        }
    }
}

impl std::error::Error for ScreenBoutDailySummaryError {}

/// Summarize already-paired screen-on through screen-off bouts.
///
/// The two configured boundaries are exact: participant exclusion uses
/// `bout_duration > maximum`, and insufficient-day exclusion uses
/// `observed_day_count < minimum`. Daily sums and participant means use the
/// caller-provided observed-day inventory, including an explicit zero-bout day
/// if the caller supplies one.
pub fn summarize_screen_bouts_by_explicit_day(
    observed_days: &[ObservedScreenDay],
    bouts: &[PairedScreenBout],
    configuration: ScreenBoutDailySummaryConfiguration,
) -> Result<ScreenBoutDailySummary, ScreenBoutDailySummaryError> {
    if configuration.maximum_inclusive_bout_duration_ns == 0 {
        return Err(ScreenBoutDailySummaryError::ZeroMaximumBoutDuration);
    }
    if configuration.minimum_inclusive_observed_day_count == 0 {
        return Err(ScreenBoutDailySummaryError::ZeroMinimumObservedDays);
    }

    let mut days_by_participant: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut daily_duration: BTreeMap<(String, String), u64> = BTreeMap::new();
    for day in observed_days {
        if day.participant_id.trim().is_empty() {
            return Err(ScreenBoutDailySummaryError::EmptyParticipantId);
        }
        if day.source_day_id.trim().is_empty() {
            return Err(ScreenBoutDailySummaryError::EmptySourceDayId);
        }
        let days = days_by_participant
            .entry(day.participant_id.clone())
            .or_default();
        if !days.insert(day.source_day_id.clone()) {
            return Err(ScreenBoutDailySummaryError::DuplicateObservedDay {
                participant_id: day.participant_id.clone(),
                source_day_id: day.source_day_id.clone(),
            });
        }
        daily_duration.insert((day.participant_id.clone(), day.source_day_id.clone()), 0);
    }

    let mut bout_ids = BTreeSet::new();
    let mut maximum_bout_by_participant: BTreeMap<String, u64> = BTreeMap::new();
    let mut exceeds_maximum = BTreeSet::new();
    for bout in bouts {
        if bout.participant_id.trim().is_empty() {
            return Err(ScreenBoutDailySummaryError::EmptyParticipantId);
        }
        if bout.source_day_id.trim().is_empty() {
            return Err(ScreenBoutDailySummaryError::EmptySourceDayId);
        }
        if bout.bout_id.trim().is_empty() {
            return Err(ScreenBoutDailySummaryError::EmptyBoutId);
        }
        if !bout_ids.insert(bout.bout_id.clone()) {
            return Err(ScreenBoutDailySummaryError::DuplicateBoutId(
                bout.bout_id.clone(),
            ));
        }
        let duration = bout
            .screen_off_timestamp_ns
            .checked_sub(bout.screen_on_timestamp_ns)
            .filter(|duration| *duration > 0)
            .ok_or_else(|| {
                ScreenBoutDailySummaryError::NonPositiveBoutDuration(bout.bout_id.clone())
            })?;
        let duration =
            u64::try_from(duration).map_err(|_| ScreenBoutDailySummaryError::DurationOverflow)?;
        let day_key = (bout.participant_id.clone(), bout.source_day_id.clone());
        let day_duration = daily_duration.get_mut(&day_key).ok_or_else(|| {
            ScreenBoutDailySummaryError::BoutWithoutObservedDay {
                bout_id: bout.bout_id.clone(),
                participant_id: bout.participant_id.clone(),
                source_day_id: bout.source_day_id.clone(),
            }
        })?;
        *day_duration = day_duration
            .checked_add(duration)
            .ok_or(ScreenBoutDailySummaryError::DurationOverflow)?;
        maximum_bout_by_participant
            .entry(bout.participant_id.clone())
            .and_modify(|maximum| *maximum = (*maximum).max(duration))
            .or_insert(duration);
        if duration > configuration.maximum_inclusive_bout_duration_ns {
            exceeds_maximum.insert(bout.participant_id.clone());
        }
    }

    let mut excluded_participants = Vec::new();
    let mut retained_participants = BTreeSet::new();
    for (participant_id, days) in &days_by_participant {
        let mut reasons = Vec::new();
        if exceeds_maximum.contains(participant_id) {
            reasons.push(ScreenBoutParticipantExclusionReason::BoutExceedsMaximum);
        }
        if days.len() < configuration.minimum_inclusive_observed_day_count {
            reasons.push(ScreenBoutParticipantExclusionReason::FewerThanMinimumObservedDays);
        }
        if reasons.is_empty() {
            retained_participants.insert(participant_id.clone());
        } else {
            excluded_participants.push(ExcludedScreenBoutParticipant {
                participant_id: participant_id.clone(),
                observed_day_count: days.len(),
                maximum_bout_duration_ns: maximum_bout_by_participant.get(participant_id).copied(),
                reasons,
            });
        }
    }

    let retained_daily_durations = daily_duration
        .iter()
        .filter(|((participant_id, _), _)| retained_participants.contains(participant_id))
        .map(
            |((participant_id, source_day_id), duration_ns)| ScreenBoutDailyDuration {
                participant_id: participant_id.clone(),
                source_day_id: source_day_id.clone(),
                duration_ns: *duration_ns,
            },
        )
        .collect::<Vec<_>>();
    let mut retained_participant_means = Vec::with_capacity(retained_participants.len());
    for participant_id in retained_participants {
        let observed_day_count = days_by_participant[&participant_id].len();
        let total_duration_ns = retained_daily_durations
            .iter()
            .filter(|day| day.participant_id == participant_id)
            .try_fold(0u64, |total, day| total.checked_add(day.duration_ns))
            .ok_or(ScreenBoutDailySummaryError::DurationOverflow)?;
        retained_participant_means.push(ScreenBoutParticipantMean {
            participant_id,
            observed_day_count,
            total_duration_ns,
            mean_daily_duration_ns: total_duration_ns as f64 / observed_day_count as f64,
        });
    }

    Ok(ScreenBoutDailySummary {
        retained_daily_durations,
        retained_participant_means,
        excluded_participants,
    })
}
