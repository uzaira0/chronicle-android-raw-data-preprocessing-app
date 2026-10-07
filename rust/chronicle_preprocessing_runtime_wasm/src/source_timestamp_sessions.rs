//! Three source-bound calculations on caller-qualified timestamp records.
//!
//! Coordinates are exact i64 nanoseconds in a caller-declared common clock.
//! Each participant must name one device/source stream and the stage's event
//! population. This is caller attestation, never evidence of completeness.
//! Positive precision is retained metadata, not a quantization or rounding rule.
//! Input order is retained (including ties); no sorting, timezone inference,
//! raw-event linkage, missing-capture repair, or credential timing is inferred.
//! Source clauses: Fridman rank12.txt:221-244; ScreenLife rank08.txt:397-429;
//! Harbach USENIX proceedings printed p218, section 4.1.1/Figure 1.

use std::collections::{BTreeMap, BTreeSet};

pub const IDLE_CAP_NS: i128 = 300_000_000_000;
pub const CAPTURE_SPLIT_GAP_NS: i128 = 7_000_000_000;
pub const FRIDMAN_STREAM_ROLE: &str = "fridman_joint_analyzed_events";
pub const SCREENLIFE_STREAM_ROLE: &str = "screenlife_recorded_captures";
pub const HARDLOCK_STREAM_ROLE: &str = "hardlock_resolved_state_pairs";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimestampObservation {
    pub participant_id: String,
    pub source_row_id: String,
    pub source_device_id: String,
    pub source_stream_id: String,
    pub source_stream_role: String,
    pub clock_id: String,
    pub timestamp_precision_ns: i64,
    pub timestamp_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressedTimestamp {
    pub origin_timestamp_ns: i64,
    pub active_interaction_elapsed_ns: i128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureMembership {
    pub session_ordinal: u64,
    pub first_source_row_id: String,
    pub first_timestamp_ns: i64,
    pub preceding_gap_ns: Option<i128>,
}

fn nonempty(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{name} must be nonempty"))
    } else {
        Ok(())
    }
}

/// Validate, but never reorder or deduplicate, each participant's sequence.
/// Device/stream identity cannot change within a participant's supplied rows.
fn preceding_gaps(
    rows: &[TimestampObservation],
    expected_role: &str,
) -> Result<Vec<Option<i128>>, String> {
    let mut previous = BTreeMap::<&str, (&str, &str, &str, i64)>::new();
    let mut identities = BTreeSet::new();
    rows.iter()
        .map(|row| {
            nonempty(&row.participant_id, "participant_id")?;
            nonempty(&row.source_row_id, "source_row_id")?;
            nonempty(&row.source_device_id, "source_device_id")?;
            nonempty(&row.source_stream_id, "source_stream_id")?;
            nonempty(&row.clock_id, "clock_id")?;
            if row.source_stream_role != expected_role {
                return Err(format!("source_stream_role must be {expected_role}; event population is caller-qualified, not inferred"));
            }
            if row.timestamp_precision_ns <= 0 {
                return Err("timestamp_precision_ns must be positive declared metadata".into());
            }
            if !identities.insert((&row.participant_id, &row.source_row_id)) {
                return Err("duplicate participant/source_row_id".into());
            }
            let gap = match previous.get(row.participant_id.as_str()) {
                Some((device, stream, clock, timestamp)) => {
                    if *device != row.source_device_id || *stream != row.source_stream_id {
                        return Err("participant input must contain one explicitly declared device/source stream".into());
                    }
                    if *clock != row.clock_id {
                        return Err(
                            "participant timestamps require one declared common clock_id".into(),
                        );
                    }
                    let gap = i128::from(row.timestamp_ns) - i128::from(*timestamp);
                    if gap < 0 {
                        return Err(
                            "participant timestamps must be nondecreasing in caller input order"
                                .into(),
                        );
                    }
                    Some(gap)
                }
                None => None,
            };
            previous.insert(&row.participant_id, (&row.source_device_id, &row.source_stream_id, &row.clock_id, row.timestamp_ns));
            Ok(gap)
        })
        .collect()
}

/// Fridman's active-interaction clock, relative to each supplied first event.
/// Adjacency is in the caller-qualified joint analyzed-event population, not
/// an arbitrary per-modality projection; timestamps cannot prove that scope.
/// The source does not pin the training clock's absolute origin; output states
/// its first-event origin explicitly and leaves original timestamps unchanged.
pub fn compress_idle_gaps(
    rows: &[TimestampObservation],
) -> Result<Vec<CompressedTimestamp>, String> {
    let gaps = preceding_gaps(rows, FRIDMAN_STREAM_ROLE)?;
    let mut clocks = BTreeMap::<&str, CompressedTimestamp>::new();
    rows.iter()
        .zip(gaps)
        .map(|(row, gap)| {
            let clock = clocks
                .entry(&row.participant_id)
                .or_insert(CompressedTimestamp {
                    origin_timestamp_ns: row.timestamp_ns,
                    active_interaction_elapsed_ns: 0,
                });
            if let Some(gap) = gap {
                clock.active_interaction_elapsed_ns = clock
                    .active_interaction_elapsed_ns
                    .checked_add(gap.min(IDLE_CAP_NS))
                    .ok_or("compressed elapsed nanoseconds overflow")?;
            }
            Ok(clock.clone())
        })
        .collect()
}

/// ScreenLife analysis membership: split strictly above seven seconds.
/// This partitions recorded captures, not app usage or proximity events. It
/// emits no inferred screen duration or human-coded media thread.
pub fn partition_captures(rows: &[TimestampObservation]) -> Result<Vec<CaptureMembership>, String> {
    let gaps = preceding_gaps(rows, SCREENLIFE_STREAM_ROLE)?;
    let mut sessions = BTreeMap::<&str, CaptureMembership>::new();
    rows.iter()
        .zip(gaps)
        .map(|(row, gap)| {
            let session = sessions
                .entry(&row.participant_id)
                .or_insert(CaptureMembership {
                    session_ordinal: 1,
                    first_source_row_id: row.source_row_id.clone(),
                    first_timestamp_ns: row.timestamp_ns,
                    preceding_gap_ns: None,
                });
            if gap.is_some_and(|value| value > CAPTURE_SPLIT_GAP_NS) {
                session.session_ordinal = session
                    .session_ordinal
                    .checked_add(1)
                    .ok_or("capture session ordinal overflow")?;
                session.first_source_row_id = row.source_row_id.clone();
                session.first_timestamp_ns = row.timestamp_ns;
            }
            session.preceding_gap_ns = gap;
            Ok(session.clone())
        })
        .collect()
}

/// Harbach's worst-case unlocking cost on an already resolved ON_LOCKED to
/// ON_UNLOCKED pair. It includes possible lock-screen viewing, not just input.
/// Widen before subtraction so the full i64 coordinate domain remains exact.
pub fn unlock_cost_upper_bound_ns(start_ns: i64, end_ns: i64) -> Result<i128, String> {
    let elapsed = i128::from(end_ns) - i128::from(start_ns);
    if elapsed < 0 {
        Err("resolved unlock endpoint precedes ON_LOCKED endpoint".into())
    } else {
        Ok(elapsed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimestampStage {
    IdleCompressedClock,
    CaptureGapPartition,
    ResolvedUnlockUpperBound,
}

impl TimestampStage {
    pub fn adapter_id(self) -> &'static str {
        match self {
            Self::IdleCompressedClock => "chronicle.idle-compressed-clock",
            Self::CaptureGapPartition => "chronicle.screenlife-capture-gap-partition",
            Self::ResolvedUnlockUpperBound => "chronicle.resolved-unlock-upper-bound",
        }
    }
    pub fn derived_result_kind(self) -> &'static str {
        match self {
            Self::IdleCompressedClock => "literature-idle-compressed-clock-csv",
            Self::CaptureGapPartition => "literature-screenlife-capture-gap-partition-csv",
            Self::ResolvedUnlockUpperBound => "literature-resolved-unlock-upper-bound-csv",
        }
    }
    fn computed_fields(self) -> &'static [&'static str] {
        match self {
            Self::IdleCompressedClock => &[
                "active_interaction_origin_timestamp_ns",
                "active_interaction_elapsed_ns",
            ],
            Self::CaptureGapPartition => &[
                "capture_session_ordinal",
                "capture_session_first_source_row_id",
                "capture_session_first_timestamp_ns",
                "preceding_capture_gap_ns",
            ],
            Self::ResolvedUnlockUpperBound => &["unlock_cost_upper_bound_ns"],
        }
    }
}

pub struct PreparedTimestampStage {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

/// CSV is a transport for already qualified coordinates. All supplied columns,
/// lexical source values, source IDs and rows survive in original order.
pub fn execute_timestamp_stage_csv(
    raw_csv: &[u8],
    stage: TimestampStage,
) -> Result<PreparedTimestampStage, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw_csv);
    let headers = reader.headers().map_err(|error| error.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("duplicate CSV column names".into());
    }
    for field in stage.computed_fields() {
        if headers.iter().any(|header| header == *field) {
            return Err(format!("refuses supplied computed column {field}"));
        }
    }
    let column = |name: &str| {
        headers
            .iter()
            .position(|header| header == name)
            .ok_or_else(|| format!("{} requires raw column {name}", stage.adapter_id()))
    };
    let participant = column("participant_id")?;
    let source_row = column("source_row_id")?;
    let clock = column("clock_id")?;
    let device = column("source_device_id")?;
    let stream = column("source_stream_id")?;
    let stream_role = column("source_stream_role")?;
    let precision = column("timestamp_precision_ns")?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut extra = Vec::<Vec<String>>::with_capacity(records.len());
    let integer = |record: &csv::StringRecord, index: usize, field: &str| {
        record[index]
            .parse::<i64>()
            .map_err(|_| format!("{field} requires exact i64 integer nanoseconds"))
    };
    if stage == TimestampStage::ResolvedUnlockUpperBound {
        let start_id = column("start_source_row_id")?;
        let end_id = column("end_source_row_id")?;
        let start_state = column("start_state")?;
        let end_state = column("end_state")?;
        let start = column("start_timestamp_ns")?;
        let end = column("end_timestamp_ns")?;
        let mut identities = BTreeSet::new();
        let mut qualifications = BTreeMap::new();
        for record in &records {
            for (index, field) in [
                (participant, "participant_id"),
                (source_row, "source_row_id"),
                (clock, "clock_id"),
                (device, "source_device_id"),
                (stream, "source_stream_id"),
                (start_id, "start_source_row_id"),
                (end_id, "end_source_row_id"),
            ] {
                nonempty(&record[index], field)?;
            }
            if &record[stream_role] != HARDLOCK_STREAM_ROLE {
                return Err("source_stream_role must be hardlock_resolved_state_pairs".into());
            }
            let precision_ns = integer(record, precision, "timestamp_precision_ns")?;
            if precision_ns <= 0 {
                return Err("timestamp_precision_ns must be positive".into());
            }
            let qualification = (
                record[device].to_owned(),
                record[stream].to_owned(),
                record[clock].to_owned(),
            );
            if qualifications
                .insert(record[participant].to_owned(), qualification.clone())
                .is_some_and(|previous| previous != qualification)
            {
                return Err(
                    "participant pairs require one declared device/source stream and clock".into(),
                );
            }
            if !identities.insert((
                record[participant].to_owned(),
                record[source_row].to_owned(),
            )) {
                return Err("duplicate participant/source_row_id".into());
            }
            if record[start_state] != *"ON_LOCKED" || record[end_state] != *"ON_UNLOCKED" {
                return Err(
                    "resolved pair requires ON_LOCKED to ON_UNLOCKED, not another state transition"
                        .into(),
                );
            }
            if record[start_id] == record[end_id] {
                return Err("resolved pair requires distinct endpoint source-row IDs".into());
            }
            let elapsed = unlock_cost_upper_bound_ns(
                integer(record, start, "start_timestamp_ns")?,
                integer(record, end, "end_timestamp_ns")?,
            )?;
            extra.push(vec![elapsed.to_string()]);
        }
    } else {
        let timestamp = column("timestamp_ns")?;
        let rows = records
            .iter()
            .map(|record| {
                Ok(TimestampObservation {
                    participant_id: record[participant].to_owned(),
                    source_row_id: record[source_row].to_owned(),
                    source_device_id: record[device].to_owned(),
                    source_stream_id: record[stream].to_owned(),
                    source_stream_role: record[stream_role].to_owned(),
                    clock_id: record[clock].to_owned(),
                    timestamp_precision_ns: integer(record, precision, "timestamp_precision_ns")?,
                    timestamp_ns: integer(record, timestamp, "timestamp_ns")?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        match stage {
            TimestampStage::IdleCompressedClock => {
                extra.extend(compress_idle_gaps(&rows)?.into_iter().map(|value| {
                    vec![
                        value.origin_timestamp_ns.to_string(),
                        value.active_interaction_elapsed_ns.to_string(),
                    ]
                }));
            }
            TimestampStage::CaptureGapPartition => {
                extra.extend(partition_captures(&rows)?.into_iter().map(|value| {
                    vec![
                        value.session_ordinal.to_string(),
                        value.first_source_row_id,
                        value.first_timestamp_ns.to_string(),
                        value
                            .preceding_gap_ns
                            .map(|gap| gap.to_string())
                            .unwrap_or_default(),
                    ]
                }));
            }
            TimestampStage::ResolvedUnlockUpperBound => unreachable!("handled separately"),
        }
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    let mut output_header = headers.clone();
    for field in stage.computed_fields() {
        output_header.push_field(field);
    }
    writer
        .write_record(&output_header)
        .map_err(|error| error.to_string())?;
    for (record, values) in records.iter().zip(extra) {
        let mut output = record.clone();
        for value in values {
            output.push_field(&value);
        }
        writer
            .write_record(&output)
            .map_err(|error| error.to_string())?;
    }
    let csv_bytes = writer.into_inner().map_err(|error| error.to_string())?;
    Ok(PreparedTimestampStage {
        csv_bytes,
        row_count: records.len(),
    })
}
