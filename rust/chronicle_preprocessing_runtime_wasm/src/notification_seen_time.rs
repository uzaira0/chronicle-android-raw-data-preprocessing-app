//! Notification arrival-to-attention linkage over an ordered phone-state stream.
//!
//! The caller supplies participant-isolated notification-arrival and phone
//! lock/unlock events in source order. Equal timestamps retain that order; this
//! operator does not invent a secondary tie-breaking policy.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationPhoneEventKind {
    NotificationArrival { notification_id: String },
    PhoneLocked,
    PhoneUnlocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderedNotificationPhoneEvent {
    pub participant_id: String,
    pub timestamp_ns: i64,
    pub kind: NotificationPhoneEventKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotificationSeenTimeConfiguration {
    pub maximum_seen_time_ns: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationSeenResolution {
    AlreadyUnlocked,
    NextUnlock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationSeenExclusionReason {
    UnknownPhoneStateAtArrival,
    NoFollowingUnlock,
    ExceededMaximumSeenTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationSeenTimeDisposition {
    Retained {
        seen_timestamp_ns: i64,
        seen_time_ns: i64,
        resolution: NotificationSeenResolution,
    },
    Excluded {
        reason: NotificationSeenExclusionReason,
        candidate_seen_timestamp_ns: Option<i64>,
        candidate_seen_time_ns: Option<i64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationSeenTimeOutcome {
    pub participant_id: String,
    pub notification_id: String,
    pub arrival_timestamp_ns: i64,
    pub disposition: NotificationSeenTimeDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationSeenTimeError {
    InvalidConfiguration,
    EmptyParticipantId,
    EmptyNotificationId,
    DuplicateNotificationId {
        participant_id: String,
        notification_id: String,
    },
    ParticipantEventsOutOfOrder {
        participant_id: String,
        previous_timestamp_ns: i64,
        timestamp_ns: i64,
    },
    SeenTimeOverflow {
        participant_id: String,
        arrival_timestamp_ns: i64,
        unlock_timestamp_ns: i64,
    },
}

impl fmt::Display for NotificationSeenTimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration => {
                formatter.write_str("maximum notification seen time must be positive")
            }
            Self::EmptyParticipantId => formatter.write_str("participant ID is empty"),
            Self::EmptyNotificationId => formatter.write_str("notification ID is empty"),
            Self::DuplicateNotificationId {
                participant_id,
                notification_id,
            } => write!(
                formatter,
                "duplicate notification ID {notification_id} for participant {participant_id}"
            ),
            Self::ParticipantEventsOutOfOrder {
                participant_id,
                previous_timestamp_ns,
                timestamp_ns,
            } => write!(
                formatter,
                "participant {participant_id} event timestamp {timestamp_ns} precedes {previous_timestamp_ns}"
            ),
            Self::SeenTimeOverflow {
                participant_id,
                arrival_timestamp_ns,
                unlock_timestamp_ns,
            } => write!(
                formatter,
                "participant {participant_id} notification span from {arrival_timestamp_ns} to {unlock_timestamp_ns} overflows nanoseconds"
            ),
        }
    }
}

impl std::error::Error for NotificationSeenTimeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PhoneState {
    Unknown,
    Locked,
    Unlocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingNotification {
    output_index: usize,
    arrival_timestamp_ns: i64,
}

#[derive(Debug, Default)]
struct ParticipantState {
    latest_timestamp_ns: Option<i64>,
    phone_state: Option<PhoneState>,
    pending: Vec<PendingNotification>,
    notification_ids: BTreeSet<String>,
}

/// Compute one disposition for every notification arrival.
///
/// Notifications arriving in the explicitly observed unlocked state are
/// retained with zero seen time. Notifications arriving while locked are
/// linked to the next unlock for that participant. Candidate elapsed times
/// strictly greater than the configured maximum are excluded; equality is
/// retained. Unknown initial state and a missing following unlock are explicit
/// fail-closed exclusions rather than guessed linkages.
pub fn derive_notification_seen_times(
    events: &[OrderedNotificationPhoneEvent],
    configuration: NotificationSeenTimeConfiguration,
) -> Result<Vec<NotificationSeenTimeOutcome>, NotificationSeenTimeError> {
    if configuration.maximum_seen_time_ns <= 0 {
        return Err(NotificationSeenTimeError::InvalidConfiguration);
    }

    let mut participant_states = BTreeMap::<String, ParticipantState>::new();
    let mut outcomes = Vec::<NotificationSeenTimeOutcome>::new();

    for event in events {
        if event.participant_id.trim().is_empty() {
            return Err(NotificationSeenTimeError::EmptyParticipantId);
        }
        let state = participant_states
            .entry(event.participant_id.clone())
            .or_default();
        if let Some(previous) = state.latest_timestamp_ns {
            if event.timestamp_ns < previous {
                return Err(NotificationSeenTimeError::ParticipantEventsOutOfOrder {
                    participant_id: event.participant_id.clone(),
                    previous_timestamp_ns: previous,
                    timestamp_ns: event.timestamp_ns,
                });
            }
        }
        state.latest_timestamp_ns = Some(event.timestamp_ns);

        match &event.kind {
            NotificationPhoneEventKind::PhoneLocked => {
                state.phone_state = Some(PhoneState::Locked);
            }
            NotificationPhoneEventKind::PhoneUnlocked => {
                state.phone_state = Some(PhoneState::Unlocked);
                for pending in state.pending.drain(..) {
                    let elapsed_ns = event
                        .timestamp_ns
                        .checked_sub(pending.arrival_timestamp_ns)
                        .ok_or_else(|| NotificationSeenTimeError::SeenTimeOverflow {
                            participant_id: event.participant_id.clone(),
                            arrival_timestamp_ns: pending.arrival_timestamp_ns,
                            unlock_timestamp_ns: event.timestamp_ns,
                        })?;
                    outcomes[pending.output_index].disposition =
                        if elapsed_ns > configuration.maximum_seen_time_ns {
                            NotificationSeenTimeDisposition::Excluded {
                                reason: NotificationSeenExclusionReason::ExceededMaximumSeenTime,
                                candidate_seen_timestamp_ns: Some(event.timestamp_ns),
                                candidate_seen_time_ns: Some(elapsed_ns),
                            }
                        } else {
                            NotificationSeenTimeDisposition::Retained {
                                seen_timestamp_ns: event.timestamp_ns,
                                seen_time_ns: elapsed_ns,
                                resolution: NotificationSeenResolution::NextUnlock,
                            }
                        };
                }
            }
            NotificationPhoneEventKind::NotificationArrival { notification_id } => {
                if notification_id.trim().is_empty() {
                    return Err(NotificationSeenTimeError::EmptyNotificationId);
                }
                if !state.notification_ids.insert(notification_id.clone()) {
                    return Err(NotificationSeenTimeError::DuplicateNotificationId {
                        participant_id: event.participant_id.clone(),
                        notification_id: notification_id.clone(),
                    });
                }
                let output_index = outcomes.len();
                let disposition = match state.phone_state.unwrap_or(PhoneState::Unknown) {
                    PhoneState::Unlocked => NotificationSeenTimeDisposition::Retained {
                        seen_timestamp_ns: event.timestamp_ns,
                        seen_time_ns: 0,
                        resolution: NotificationSeenResolution::AlreadyUnlocked,
                    },
                    PhoneState::Locked => {
                        state.pending.push(PendingNotification {
                            output_index,
                            arrival_timestamp_ns: event.timestamp_ns,
                        });
                        NotificationSeenTimeDisposition::Excluded {
                            reason: NotificationSeenExclusionReason::NoFollowingUnlock,
                            candidate_seen_timestamp_ns: None,
                            candidate_seen_time_ns: None,
                        }
                    }
                    PhoneState::Unknown => NotificationSeenTimeDisposition::Excluded {
                        reason: NotificationSeenExclusionReason::UnknownPhoneStateAtArrival,
                        candidate_seen_timestamp_ns: None,
                        candidate_seen_time_ns: None,
                    },
                };
                outcomes.push(NotificationSeenTimeOutcome {
                    participant_id: event.participant_id.clone(),
                    notification_id: notification_id.clone(),
                    arrival_timestamp_ns: event.timestamp_ns,
                    disposition,
                });
            }
        }
    }

    Ok(outcomes)
}
