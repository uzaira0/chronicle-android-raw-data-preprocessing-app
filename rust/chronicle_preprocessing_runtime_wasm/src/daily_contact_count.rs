//! Daily counts for already-selected contact rows on an explicit participant-day spine.
//!
//! This bounded operator does not select, classify, or clean raw events, and it
//! does not infer which days belong in the spine.

use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ParticipantDay {
    pub participant_id: String,
    /// Opaque caller-owned calendar-day identity.
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatedContact {
    pub participant_id: String,
    pub date: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbsentDailyCountPolicy {
    /// Count rows after a left outer join. An unmatched spine day still has
    /// one placeholder row and therefore receives a count of one.
    CountJoinedRows,
    /// Count matched contact rows and explicitly emit numeric zero when no
    /// contact matched a spine day.
    CountMatchesAndZeroFill,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyContactCount {
    pub participant_id: String,
    pub date: String,
    pub contact_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DailyContactCountError {
    EmptySpine,
    EmptyParticipantId,
    EmptyDate,
    DuplicateSpineDay {
        participant_id: String,
        date: String,
    },
    CountOverflow,
}

impl fmt::Display for DailyContactCountError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptySpine => formatter.write_str("daily contact count requires a day spine"),
            Self::EmptyParticipantId => {
                formatter.write_str("daily contact count participant ID is empty")
            }
            Self::EmptyDate => formatter.write_str("daily contact count date is empty"),
            Self::DuplicateSpineDay {
                participant_id,
                date,
            } => write!(
                formatter,
                "duplicate day spine row for participant {participant_id} on {date}"
            ),
            Self::CountOverflow => formatter.write_str("daily contact count overflow"),
        }
    }
}

impl std::error::Error for DailyContactCountError {}

/// Left-join already-selected contact rows to an explicit participant-day spine.
///
/// Output is sorted by participant and date. Contact rows outside the supplied
/// spine are discarded, matching a left join whose spine is the left input.
/// Duplicate spine keys are refused because they would multiply joined rows.
pub fn count_contacts_on_day_spine(
    spine: &[ParticipantDay],
    contacts: &[DatedContact],
    absent_policy: AbsentDailyCountPolicy,
) -> Result<Vec<DailyContactCount>, DailyContactCountError> {
    if spine.is_empty() {
        return Err(DailyContactCountError::EmptySpine);
    }

    let mut counts = BTreeMap::<(String, String), u64>::new();
    for day in spine {
        validate_key(&day.participant_id, &day.date)?;
        let key = (day.participant_id.clone(), day.date.clone());
        if counts.insert(key, 0).is_some() {
            return Err(DailyContactCountError::DuplicateSpineDay {
                participant_id: day.participant_id.clone(),
                date: day.date.clone(),
            });
        }
    }

    for contact in contacts {
        validate_key(&contact.participant_id, &contact.date)?;
        if let Some(count) = counts.get_mut(&(contact.participant_id.clone(), contact.date.clone()))
        {
            *count = count
                .checked_add(1)
                .ok_or(DailyContactCountError::CountOverflow)?;
        }
    }

    Ok(counts
        .into_iter()
        .map(
            |((participant_id, date), matched_count)| DailyContactCount {
                participant_id,
                date,
                contact_count: match absent_policy {
                    AbsentDailyCountPolicy::CountJoinedRows => matched_count.max(1),
                    AbsentDailyCountPolicy::CountMatchesAndZeroFill => matched_count,
                },
            },
        )
        .collect())
}

fn validate_key(participant_id: &str, date: &str) -> Result<(), DailyContactCountError> {
    if participant_id.trim().is_empty() {
        return Err(DailyContactCountError::EmptyParticipantId);
    }
    if date.trim().is_empty() {
        return Err(DailyContactCountError::EmptyDate);
    }
    Ok(())
}
