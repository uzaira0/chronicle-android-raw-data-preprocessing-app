//! Session materialization around an explicitly supplied questionnaire window.
//!
//! This operator starts after a caller has assigned questionnaire membership
//! and usage/nonusage IDs. It does not derive those IDs or infer membership
//! from timestamps.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionnaireWindow {
    pub questionnaire_id: String,
    pub start_timestamp_ns: i64,
    pub end_timestamp_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LabeledScreenStateRow {
    pub source_row_id: String,
    pub timestamp_ns: i64,
    /// Caller-supplied membership. A missing value remains outside the window
    /// even when its timestamp falls between the anchors.
    pub questionnaire_id: Option<String>,
    pub usage_id: Option<i64>,
    pub nonusage_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmaScreenSessionConfiguration {
    pub expected_window_duration_ns: i64,
    pub ghost_offset_ns: i64,
    pub ghost_nonusage_id_offset: i64,
    pub minimum_inclusive_mixed_usage_row_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmaMaterializedRowKind {
    Source,
    StartBoundary,
    EndBoundary,
    GhostNonusage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmaMaterializedRow {
    pub source_row_id: Option<String>,
    pub timestamp_ns: i64,
    pub usage_id: Option<i64>,
    pub nonusage_id: Option<i64>,
    pub kind: EmaMaterializedRowKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmaScreenSessionKind {
    Usage,
    Nonusage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmaScreenSession {
    pub kind: EmaScreenSessionKind,
    pub session_id: i64,
    pub start_timestamp_ns: i64,
    pub end_timestamp_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmaScreenSessionMaterialization {
    pub rows: Vec<EmaMaterializedRow>,
    pub sessions: Vec<EmaScreenSession>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmaScreenSessionMaterializationError {
    EmptyQuestionnaireId,
    EmptySourceRowId,
    DuplicateSourceRowId(String),
    DuplicateTimestamp(i64),
    InvalidWindow,
    UnexpectedWindowDuration,
    InvalidConfiguration,
    InvalidStateAssignment(String),
    AssignedRowOutsideOpenWindow(String),
    BoundaryTimestampCollision(i64),
    MissingRowAfterBoundary(i64),
    TimestampOverflow,
    GhostIdOverflow,
    GhostTimestampCollision(i64),
    NoAssignedRows,
    NoUsageOrNonusageState,
}

impl fmt::Display for EmaScreenSessionMaterializationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyQuestionnaireId => formatter.write_str("questionnaire ID is empty"),
            Self::EmptySourceRowId => formatter.write_str("source row ID is empty"),
            Self::DuplicateSourceRowId(row_id) => {
                write!(formatter, "duplicate source row ID {row_id}")
            }
            Self::DuplicateTimestamp(timestamp) => {
                write!(formatter, "duplicate source timestamp {timestamp}")
            }
            Self::InvalidWindow => formatter.write_str("questionnaire window is not positive"),
            Self::UnexpectedWindowDuration => {
                formatter.write_str("questionnaire window has an unexpected duration")
            }
            Self::InvalidConfiguration => {
                formatter.write_str("EMA session configuration is not positive")
            }
            Self::InvalidStateAssignment(row_id) => write!(
                formatter,
                "source row {row_id} must have exactly one usage or nonusage ID"
            ),
            Self::AssignedRowOutsideOpenWindow(row_id) => write!(
                formatter,
                "questionnaire-assigned row {row_id} is outside the open boundary interval"
            ),
            Self::BoundaryTimestampCollision(timestamp) => write!(
                formatter,
                "source row collides with inserted questionnaire boundary {timestamp}"
            ),
            Self::MissingRowAfterBoundary(timestamp) => write!(
                formatter,
                "questionnaire boundary {timestamp} has no following source row"
            ),
            Self::TimestampOverflow => formatter.write_str("EMA session timestamp overflow"),
            Self::GhostIdOverflow => formatter.write_str("ghost nonusage ID overflow"),
            Self::GhostTimestampCollision(timestamp) => {
                write!(formatter, "ghost timestamp collision at {timestamp}")
            }
            Self::NoAssignedRows => {
                formatter.write_str("questionnaire has no assigned source rows")
            }
            Self::NoUsageOrNonusageState => {
                formatter.write_str("questionnaire rows have no usage or nonusage state")
            }
        }
    }
}

impl std::error::Error for EmaScreenSessionMaterializationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkingRow {
    source_row_id: Option<String>,
    timestamp_ns: i64,
    questionnaire_id: Option<String>,
    usage_id: Option<i64>,
    nonusage_id: Option<i64>,
    kind: EmaMaterializedRowKind,
}

fn boundary_state(
    previous: Option<&WorkingRow>,
    following: &WorkingRow,
) -> (Option<i64>, Option<i64>) {
    let previous_usage = previous.and_then(|row| row.usage_id);
    let previous_nonusage = previous.and_then(|row| row.nonusage_id);
    match (previous_nonusage, following.nonusage_id) {
        (None, None) => (previous_usage.or(following.usage_id), None),
        (None, Some(nonusage_id)) => (following.usage_id, Some(nonusage_id)),
        (Some(nonusage_id), None) => (previous_usage, Some(nonusage_id)),
        (Some(previous_id), Some(following_id)) if previous_id == following_id => {
            (None, Some(previous_id))
        }
        (Some(_), Some(_)) => (None, None),
    }
}

fn insert_boundary(
    rows: &mut Vec<WorkingRow>,
    questionnaire_id: &str,
    timestamp_ns: i64,
    kind: EmaMaterializedRowKind,
) -> Result<(), EmaScreenSessionMaterializationError> {
    let index = rows.partition_point(|row| row.timestamp_ns < timestamp_ns);
    if rows
        .get(index)
        .is_some_and(|row| row.timestamp_ns == timestamp_ns)
    {
        return Err(EmaScreenSessionMaterializationError::BoundaryTimestampCollision(timestamp_ns));
    }
    let following = rows
        .get(index)
        .ok_or(EmaScreenSessionMaterializationError::MissingRowAfterBoundary(timestamp_ns))?;
    let (usage_id, nonusage_id) = boundary_state(index.checked_sub(1).map(|i| &rows[i]), following);
    rows.insert(
        index,
        WorkingRow {
            source_row_id: None,
            timestamp_ns,
            questionnaire_id: Some(questionnaire_id.to_owned()),
            usage_id,
            nonusage_id,
            kind,
        },
    );
    Ok(())
}

fn unique_ids_in_order(
    rows: &[WorkingRow],
    select: impl Fn(&WorkingRow) -> Option<i64>,
) -> Vec<i64> {
    let mut seen = BTreeSet::new();
    rows.iter()
        .filter_map(select)
        .filter(|id| seen.insert(*id))
        .collect()
}

/// Materialize usage and nonusage sessions for one explicitly labeled window.
///
/// Boundaries are inserted and filled from adjacent state rows before usage-ID
/// transitions are scanned. Only consecutive, non-missing, unequal usage IDs
/// receive a ghost nonusage row. In the mixed case, usage groups below the
/// configured row count are omitted, while nonusage starts and ends borrow the
/// immediately adjacent row timestamp.
pub fn materialize_ema_screen_sessions(
    source_rows: &[LabeledScreenStateRow],
    window: &QuestionnaireWindow,
    configuration: EmaScreenSessionConfiguration,
) -> Result<EmaScreenSessionMaterialization, EmaScreenSessionMaterializationError> {
    if window.questionnaire_id.trim().is_empty() {
        return Err(EmaScreenSessionMaterializationError::EmptyQuestionnaireId);
    }
    let window_duration = window
        .end_timestamp_ns
        .checked_sub(window.start_timestamp_ns)
        .filter(|duration| *duration > 0)
        .ok_or(EmaScreenSessionMaterializationError::InvalidWindow)?;
    if window_duration != configuration.expected_window_duration_ns {
        return Err(EmaScreenSessionMaterializationError::UnexpectedWindowDuration);
    }
    if configuration.expected_window_duration_ns <= 0
        || configuration.ghost_offset_ns <= 0
        || configuration.ghost_nonusage_id_offset <= 0
        || configuration.minimum_inclusive_mixed_usage_row_count == 0
    {
        return Err(EmaScreenSessionMaterializationError::InvalidConfiguration);
    }

    let mut source_ids = BTreeSet::new();
    let mut timestamps = BTreeSet::new();
    let mut rows = Vec::with_capacity(source_rows.len() + 2);
    for row in source_rows {
        if row.source_row_id.trim().is_empty() {
            return Err(EmaScreenSessionMaterializationError::EmptySourceRowId);
        }
        if !source_ids.insert(row.source_row_id.as_str()) {
            return Err(EmaScreenSessionMaterializationError::DuplicateSourceRowId(
                row.source_row_id.clone(),
            ));
        }
        if !timestamps.insert(row.timestamp_ns) {
            return Err(EmaScreenSessionMaterializationError::DuplicateTimestamp(
                row.timestamp_ns,
            ));
        }
        if row.usage_id.is_some() == row.nonusage_id.is_some() {
            return Err(
                EmaScreenSessionMaterializationError::InvalidStateAssignment(
                    row.source_row_id.clone(),
                ),
            );
        }
        if row.questionnaire_id.as_deref() == Some(window.questionnaire_id.as_str())
            && !(row.timestamp_ns > window.start_timestamp_ns
                && row.timestamp_ns < window.end_timestamp_ns)
        {
            return Err(
                EmaScreenSessionMaterializationError::AssignedRowOutsideOpenWindow(
                    row.source_row_id.clone(),
                ),
            );
        }
        rows.push(WorkingRow {
            source_row_id: Some(row.source_row_id.clone()),
            timestamp_ns: row.timestamp_ns,
            questionnaire_id: row.questionnaire_id.clone(),
            usage_id: row.usage_id,
            nonusage_id: row.nonusage_id,
            kind: EmaMaterializedRowKind::Source,
        });
    }
    rows.sort_by_key(|row| row.timestamp_ns);
    insert_boundary(
        &mut rows,
        &window.questionnaire_id,
        window.start_timestamp_ns,
        EmaMaterializedRowKind::StartBoundary,
    )?;
    insert_boundary(
        &mut rows,
        &window.questionnaire_id,
        window.end_timestamp_ns,
        EmaMaterializedRowKind::EndBoundary,
    )?;

    let initially_selected = rows
        .iter()
        .filter(|row| row.questionnaire_id.as_deref() == Some(window.questionnaire_id.as_str()))
        .collect::<Vec<_>>();
    if initially_selected.len() == 2 {
        return Err(EmaScreenSessionMaterializationError::NoAssignedRows);
    }
    let transition_positions = initially_selected
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| match (pair[0].usage_id, pair[1].usage_id) {
            (Some(left), Some(right)) if left != right => Some(index),
            _ => None,
        })
        .collect::<Vec<_>>();

    for (inserted_count, transition_position) in transition_positions.into_iter().enumerate() {
        let selected_indices = rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                (row.questionnaire_id.as_deref() == Some(window.questionnaire_id.as_str()))
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        let source_index = selected_indices[transition_position + inserted_count];
        let source = &rows[source_index];
        let timestamp_ns = source
            .timestamp_ns
            .checked_add(configuration.ghost_offset_ns)
            .ok_or(EmaScreenSessionMaterializationError::TimestampOverflow)?;
        if rows.iter().any(|row| row.timestamp_ns == timestamp_ns) {
            return Err(
                EmaScreenSessionMaterializationError::GhostTimestampCollision(timestamp_ns),
            );
        }
        let nonusage_id = source
            .usage_id
            .expect("transition source has a usage ID")
            .checked_add(configuration.ghost_nonusage_id_offset)
            .ok_or(EmaScreenSessionMaterializationError::GhostIdOverflow)?;
        let insertion_index = rows.partition_point(|row| row.timestamp_ns < timestamp_ns);
        rows.insert(
            insertion_index,
            WorkingRow {
                source_row_id: None,
                timestamp_ns,
                questionnaire_id: Some(window.questionnaire_id.clone()),
                usage_id: None,
                nonusage_id: Some(nonusage_id),
                kind: EmaMaterializedRowKind::GhostNonusage,
            },
        );
    }

    let selected = rows
        .into_iter()
        .filter(|row| row.questionnaire_id.as_deref() == Some(window.questionnaire_id.as_str()))
        .collect::<Vec<_>>();
    let usage_ids = unique_ids_in_order(&selected, |row| row.usage_id);
    let nonusage_ids = unique_ids_in_order(&selected, |row| row.nonusage_id);
    if usage_ids.is_empty() && nonusage_ids.is_empty() {
        return Err(EmaScreenSessionMaterializationError::NoUsageOrNonusageState);
    }

    let mut sessions = Vec::new();
    if nonusage_ids.is_empty() {
        for session_id in usage_ids {
            sessions.push(EmaScreenSession {
                kind: EmaScreenSessionKind::Usage,
                session_id,
                start_timestamp_ns: selected[0].timestamp_ns,
                end_timestamp_ns: selected[selected.len() - 1].timestamp_ns,
            });
        }
    } else if usage_ids.is_empty() {
        for session_id in nonusage_ids {
            sessions.push(EmaScreenSession {
                kind: EmaScreenSessionKind::Nonusage,
                session_id,
                start_timestamp_ns: selected[0].timestamp_ns,
                end_timestamp_ns: selected[selected.len() - 1].timestamp_ns,
            });
        }
    } else {
        let mut usage_positions = BTreeMap::<i64, Vec<usize>>::new();
        for (index, row) in selected.iter().enumerate() {
            if let Some(usage_id) = row.usage_id {
                usage_positions.entry(usage_id).or_default().push(index);
            }
        }
        for (session_id, positions) in usage_positions {
            if positions.len() >= configuration.minimum_inclusive_mixed_usage_row_count {
                sessions.push(EmaScreenSession {
                    kind: EmaScreenSessionKind::Usage,
                    session_id,
                    start_timestamp_ns: selected[positions[0]].timestamp_ns,
                    end_timestamp_ns: selected[*positions.last().expect("non-empty positions")]
                        .timestamp_ns,
                });
            }
        }
        for session_id in nonusage_ids {
            let positions = selected
                .iter()
                .enumerate()
                .filter_map(|(index, row)| (row.nonusage_id == Some(session_id)).then_some(index))
                .collect::<Vec<_>>();
            let first = positions[0];
            let last = *positions.last().expect("non-empty nonusage positions");
            sessions.push(EmaScreenSession {
                kind: EmaScreenSessionKind::Nonusage,
                session_id,
                start_timestamp_ns: selected[first.saturating_sub(1)].timestamp_ns,
                end_timestamp_ns: selected[(last + 1).min(selected.len() - 1)].timestamp_ns,
            });
        }
    }

    let rows = selected
        .into_iter()
        .map(|row| EmaMaterializedRow {
            source_row_id: row.source_row_id,
            timestamp_ns: row.timestamp_ns,
            usage_id: row.usage_id,
            nonusage_id: row.nonusage_id,
            kind: row.kind,
        })
        .collect();
    Ok(EmaScreenSessionMaterialization { rows, sessions })
}
