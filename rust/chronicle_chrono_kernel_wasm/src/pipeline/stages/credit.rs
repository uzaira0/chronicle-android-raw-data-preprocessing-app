use crate::pipeline_v2::{
    AHashSet, APP_USAGE, Arc, BTreeMap, BTreeSet, CheckpointHasher, CreditDecision, CreditEmission,
    CreditEmissionCounts, CreditInterval, CreditPartition, CreditReportOwned, CreditResult,
    DayApps, LineageSearchEvidence, LocalDateMemo, Row, RowCheckpointParts, ScreenChangePoint,
    SCREEN_START_EVENTS, SCREEN_STOP_EVENTS, ScreenCreditState, ScreenCreditSubstrate,
    ScreenGatingRule, SourceDataRows, Tz,
    checkpoint_digest_field, empty_lineage_search_suffix_digest, lineage_search_range_digest,
    populate_time_columns, row_parts_sequence_digest, row_reference_sequence_digest,
    shared_lineage_text,
};

pub(crate) fn screen_witness_state(interaction_type: &str) -> Result<Option<ScreenCreditState>, String> {
    let interaction_type = if interaction_type == "Screen Non-interactive" {
        "Screen Non-Interactive"
    } else {
        interaction_type
    };
    if interaction_type.starts_with("Unknown importance:")
        || interaction_type
            .strip_prefix("n: ")
            .and_then(|rest| rest.as_bytes().first())
            .is_some_and(u8::is_ascii_digit)
    {
        // PHI safety: raw cell values must never enter error strings surfaced
        // to the UI/console — the caller appends the data-row position.
        return Err(
            "Screen-gated credit: unmapped interaction type in the raw stream — extend the interaction-type mapping before crediting."
                .to_string(),
        );
    }
    let state = match interaction_type {
        "Screen Interactive"
        | "Screen Interactive/Keyguard Shown"
        | "User Interaction"
        | "Shortcut Invocation"
        | "Keyguard Hidden"
        | "User Unlocked"
        | "Chooser Action" => Some(ScreenCreditState::On),
        // Every member of `SCREEN_STOP_EVENTS` is an OFF witness: the fused
        // type-16 label and `Device Screen Off` close a screen session in the
        // screen channel, so credit must stop at them as well.
        "Screen Non-Interactive"
        | "Screen Non-Interactive/Keyguard Hidden"
        | "Screen Non-Interactive/Manual Hardware Button"
        | "Screen Non-Interactive/Aborted Unlock"
        | "Screen Non-Interactive/Idle Timeout"
        | "Device Screen Off"
        | "Device Shutdown" => Some(ScreenCreditState::Off),
        _ => None,
    };
    Ok(state)
}

pub(crate) fn screen_source_event_suffix_digest(
    timestamp_ns: i64,
    source_data_rows: &SourceDataRows,
    event_index: usize,
    next_digest: &str,
) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-screen-credit-source-chain/v1");
    hasher.update(&(event_index as u64).to_le_bytes());
    hasher.update(&timestamp_ns.to_le_bytes());
    hasher.update(&(source_data_rows.ranges().len() as u64).to_le_bytes());
    for source_range in source_data_rows.ranges() {
        hasher.update(&source_range.first.to_le_bytes());
        hasher.update(&source_range.last.to_le_bytes());
    }
    checkpoint_digest_field(&mut hasher, next_digest.as_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

/// The substrate's key for a participant: a blank ID is indexed as "unknown",
/// so every lookup from a session row must go through this too.
fn witness_key(participant_id: &str) -> &str {
    if participant_id.is_empty() {
        "unknown"
    } else {
        participant_id
    }
}

pub(crate) fn build_screen_credit_substrate(raw_events: &[Row]) -> Result<ScreenCreditSubstrate, String> {
    let mut by_participant: BTreeMap<String, Vec<(i64, String, SourceDataRows)>> = BTreeMap::new();
    for row in raw_events {
        by_participant
            .entry(witness_key(&row.participant_id).to_owned())
            .or_default()
            .push((
                row.event_timestamp_ns,
                row.interaction_type.to_string(),
                row.source_data_rows.clone(),
            ));
    }
    let mut substrate = ScreenCreditSubstrate::default();
    for (participant_id, mut events) in by_participant {
        events.sort_by_key(|event| event.0);
        let mut points = Vec::new();
        let mut last = None;
        for (timestamp_ns, interaction_type, source_data_rows) in &events {
            let state = screen_witness_state(interaction_type).map_err(|error| {
                match source_data_rows.iter().next() {
                    Some(data_row) => format!("{error} (data row {data_row})"),
                    None => error,
                }
            })?;
            if let Some(state) = state {
                if Some(state) != last {
                    points.push(ScreenChangePoint {
                        timestamp_ns: *timestamp_ns,
                        state,
                        source_data_rows: source_data_rows.clone(),
                    });
                    last = Some(state);
                }
            }
        }
        // Capable = the device reports the screen turning on and off, in any
        // of the labels `screen_witness_state` reads as a screen transition
        // (fused keyguard labels and `Device Screen Off` included).
        if events
            .iter()
            .any(|(_, kind, _)| SCREEN_START_EVENTS.contains(&kind.as_str()))
            && events
                .iter()
                .any(|(_, kind, _)| SCREEN_STOP_EVENTS.contains(&kind.as_str()))
        {
            substrate.capable.insert(participant_id.clone());
        }
        substrate.boots.insert(
            participant_id.clone(),
            events
                .iter()
                .filter(|(_, kind, _)| kind == "Device Startup")
                .map(|event| event.0)
                .collect(),
        );
        substrate.all_timestamps.insert(
            participant_id.clone(),
            events.iter().map(|event| event.0).collect(),
        );
        let source_events = events
            .iter()
            .map(|event| (event.0, event.2.clone()))
            .collect::<Vec<_>>();
        let mut source_event_suffix_digests = vec![String::new(); source_events.len() + 1];
        source_event_suffix_digests[source_events.len()] =
            empty_lineage_search_suffix_digest(source_events.len() as u32);
        for index in (0..source_events.len()).rev() {
            source_event_suffix_digests[index] = screen_source_event_suffix_digest(
                source_events[index].0,
                &source_events[index].1,
                index,
                &source_event_suffix_digests[index + 1],
            );
        }
        substrate
            .source_events
            .insert(participant_id.clone(), source_events);
        substrate
            .source_event_suffix_digests
            .insert(participant_id.clone(), source_event_suffix_digests);
        substrate.points.insert(participant_id, points);
    }
    Ok(substrate)
}

pub(crate) fn credit_lineage_contributors(
    substrate: &ScreenCreditSubstrate,
    participant_id: &str,
    start: i64,
    end: i64,
    tolerance_ns: i64,
) -> (SourceDataRows, Option<LineageSearchEvidence>) {
    let mut contributors = SourceDataRows::default();
    let search = if let (Some(events), Some(suffix_digests)) = (
        substrate.source_events.get(participant_id),
        substrate.source_event_suffix_digests.get(participant_id),
    ) {
        let lower_bound = start.saturating_sub(tolerance_ns);
        let upper_bound = end.saturating_add(tolerance_ns);
        let lower = events.partition_point(|event| event.0 < lower_bound);
        let upper = events.partition_point(|event| event.0 <= upper_bound);
        Some(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("screen-credit-liveness-window"),
            index_space: shared_lineage_text("participant-source-event-order"),
            start_participant_id: Arc::new(participant_id.to_owned()),
            start_event_index: lower as u32,
            end_event_index_exclusive: upper as u32,
            candidate_event_count: (upper - lower) as u32,
            candidate_chain_digest: lineage_search_range_digest(
                suffix_digests,
                lower as u32,
                upper as u32,
            ),
        })
    } else {
        None
    };
    if let Some(points) = substrate.points.get(participant_id) {
        let first_after_start = points.partition_point(|point| point.timestamp_ns <= start);
        if let Some(point) = first_after_start
            .checked_sub(1)
            .and_then(|index| points.get(index))
        {
            contributors.merge(&point.source_data_rows);
        }
        let first_after_end = points.partition_point(|point| point.timestamp_ns <= end);
        for point in &points[first_after_start..first_after_end] {
            contributors.merge(&point.source_data_rows);
        }
    }
    (contributors, search)
}

#[cfg(test)]
pub(crate) fn bisect_left(values: &[i64], target: i64) -> usize {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let middle = (low + high) / 2;
        if values[middle] < target {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

pub(crate) fn bisect_right(values: &[i64], target: i64) -> usize {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let middle = (low + high) / 2;
        if values[middle] <= target {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

pub(crate) fn build_alive_spans(timestamps: &[i64], tolerance_ns: i64, boots: &[i64]) -> Vec<CreditInterval> {
    if timestamps.is_empty() {
        return Vec::new();
    }
    let booted = |left: i64, right: i64| {
        let index = bisect_right(boots, left);
        index < boots.len() && boots[index] <= right.saturating_add(10_000_000_000)
    };
    let mut spans = Vec::new();
    let mut span_start = timestamps[0];
    let mut last = timestamps[0];
    for timestamp in &timestamps[1..] {
        if timestamp.saturating_sub(last) <= tolerance_ns && !booted(last, *timestamp) {
            last = *timestamp;
        } else {
            spans.push((span_start, last));
            span_start = *timestamp;
            last = *timestamp;
        }
    }
    spans.push((span_start, last));
    spans
}

pub(crate) fn clip_alive_spans(spans: &[CreditInterval], start: i64, end: i64) -> Vec<CreditInterval> {
    let first = spans.partition_point(|span| span.1 <= start);
    spans[first..]
        .iter()
        .take_while(|span| span.0 < end)
        .filter_map(|(left, right)| {
            let left = (*left).max(start);
            let right = (*right).min(end);
            (right > left).then_some((left, right))
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn reference_alive_intervals(
    timestamps: &[i64],
    start: i64,
    end: i64,
    tolerance_ns: i64,
    boots: &[i64],
) -> Vec<CreditInterval> {
    let lower = bisect_left(timestamps, start.saturating_sub(tolerance_ns));
    let upper = bisect_right(timestamps, end.saturating_add(tolerance_ns));
    let window = &timestamps[lower..upper];
    if window.is_empty() {
        return Vec::new();
    }
    let booted = |left: i64, right: i64| {
        let index = bisect_right(boots, left);
        index < boots.len() && boots[index] <= right.saturating_add(10_000_000_000)
    };
    let mut spans = Vec::new();
    let mut span_start = window[0];
    let mut last = window[0];
    for timestamp in &window[1..] {
        if timestamp.saturating_sub(last) <= tolerance_ns && !booted(last, *timestamp) {
            last = *timestamp;
        } else {
            spans.push((span_start, last));
            span_start = *timestamp;
            last = *timestamp;
        }
    }
    spans.push((span_start, last));
    spans
        .into_iter()
        .filter_map(|(left, right)| {
            let left = left.max(start);
            let right = right.min(end);
            (right > left).then_some((left, right))
        })
        .collect()
}

pub(crate) fn screen_state_at(points: &[ScreenChangePoint], timestamp: i64) -> Option<ScreenCreditState> {
    points
        .partition_point(|point| point.timestamp_ns <= timestamp)
        .checked_sub(1)
        .map(|index| points[index].state)
}

pub(crate) fn creditable_intervals(
    points: &[ScreenChangePoint],
    start: i64,
    end: i64,
    auto_lock_ns: i64,
) -> Vec<CreditInterval> {
    let first_point_after_start = points.partition_point(|point| point.timestamp_ns <= start);
    let mut state = first_point_after_start
        .checked_sub(1)
        .map(|index| points[index].state);
    let mut point_index = first_point_after_start;
    let mut cursor = start;
    let mut current: Option<CreditInterval> = None;
    let mut output = Vec::new();
    while cursor < end {
        let segment_end = points
            .get(point_index)
            .map(|point| point.timestamp_ns.min(end))
            .unwrap_or(end);
        if segment_end > cursor {
            match state {
                Some(ScreenCreditState::On) => {
                    current = Some(match current {
                        Some((left, _)) => (left, segment_end),
                        None => (cursor, segment_end),
                    });
                }
                // The blip is measured to the screen's actual return, not to
                // the session end that clips it: an OFF that outlasts the
                // session, or never ends, is a real lock and is not bridged.
                Some(ScreenCreditState::Off)
                    if current.is_some()
                        && points
                            .get(point_index)
                            .is_some_and(|next| next.timestamp_ns - cursor < auto_lock_ns) =>
                {
                    current = current.map(|(left, _)| (left, segment_end));
                }
                _ => {
                    if let Some(interval) = current.take() {
                        output.push(interval);
                    }
                }
            }
        }
        cursor = segment_end;
        if let Some(point) = points.get(point_index) {
            state = Some(point.state);
            point_index += 1;
        } else {
            break;
        }
    }
    if let Some(interval) = current {
        output.push(interval);
    }
    output
}

pub(crate) fn intersect_intervals(left: &[CreditInterval], right: &[CreditInterval]) -> Vec<CreditInterval> {
    let mut output = Vec::new();
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        let lower = left[left_index].0.max(right[right_index].0);
        let upper = left[left_index].1.min(right[right_index].1);
        if upper > lower {
            output.push((lower, upper));
        }
        if left[left_index].1 < right[right_index].1 {
            left_index += 1;
        } else {
            right_index += 1;
        }
    }
    output
}

pub(crate) fn is_credit_session(row: &Row) -> bool {
    row.interaction_type == APP_USAGE
        && row.minimum_duration_aggregate_eligible
        && row.duration_minutes.is_some_and(|duration| duration > 0.0)
}

pub(crate) fn identify_credit_eligible_sessions(
    app_rows: &[Row],
    input_row_parts: Option<&[RowCheckpointParts]>,
) -> Result<CreditPartition, String> {
    let session_count = app_rows.iter().filter(|row| is_credit_session(row)).count();
    let rest_count = app_rows.len() - session_count;
    let (session_rows_digest, rest_rows_digest) = if let Some(parts) = input_row_parts {
        if parts.len() != app_rows.len() {
            return Err(format!(
                "screen-credit checkpoint row-part count drift: {} parts for {} rows",
                parts.len(),
                app_rows.len(),
            ));
        }
        (
            row_parts_sequence_digest(
                session_count,
                app_rows
                    .iter()
                    .zip(parts)
                    .filter_map(|(row, parts)| is_credit_session(row).then_some(parts)),
            ),
            row_parts_sequence_digest(
                rest_count,
                app_rows
                    .iter()
                    .zip(parts)
                    .filter_map(|(row, parts)| (!is_credit_session(row)).then_some(parts)),
            ),
        )
    } else {
        let sessions = app_rows
            .iter()
            .filter(|row| is_credit_session(row))
            .collect::<Vec<_>>();
        let rest = app_rows
            .iter()
            .filter(|row| !is_credit_session(row))
            .collect::<Vec<_>>();
        (
            row_reference_sequence_digest(&sessions),
            row_reference_sequence_digest(&rest),
        )
    };
    Ok(CreditPartition {
        sessions: app_rows
            .iter()
            .filter(|row| is_credit_session(row))
            .cloned()
            .collect(),
        rest: app_rows
            .iter()
            .filter(|row| !is_credit_session(row))
            .cloned()
            .collect(),
        session_rows_digest,
        rest_rows_digest,
    })
}

pub(crate) fn build_activity_witness_indexes(
    raw_events: &[Row],
) -> Result<ScreenCreditSubstrate, String> {
    build_screen_credit_substrate(raw_events)
}

pub(crate) fn screen_incapable_participants(
    partition: &CreditPartition,
    substrate: &ScreenCreditSubstrate,
) -> Vec<String> {
    let mut screen_incapable = Vec::new();
    let mut seen = AHashSet::new();
    for row in &partition.sessions {
        let key = witness_key(&row.participant_id);
        let incapable = substrate.points.get(key).is_none_or(Vec::is_empty)
            || !substrate.capable.contains(key);
        if incapable && seen.insert(row.participant_id.to_string()) {
            screen_incapable.push(row.participant_id.to_string());
        }
    }
    screen_incapable
}

pub(crate) fn summarize_daily_apps(partition: &CreditPartition) -> DayApps {
    let mut day_apps = DayApps::new();
    for row in &partition.sessions {
        day_apps
            .entry((row.participant_id.to_string(), row.date.to_string()))
            .or_default()
            .insert(row.app_package_name.to_string());
    }
    day_apps
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn derive_credited_intervals(
    partition: &CreditPartition,
    substrate: &ScreenCreditSubstrate,
    day_apps: &DayApps,
    credited_session_cap_minutes: f64,
    device_liveness_gap_tolerance_minutes: f64,
    auto_lock_bridge_seconds: f64,
    no_witness_min_day_apps: u32,
    screen_gating_rule: ScreenGatingRule,
) -> Vec<CreditDecision> {
    let tolerance_ns =
        (device_liveness_gap_tolerance_minutes * 60.0).round() as i64 * 1_000_000_000;
    let cap_ns = (credited_session_cap_minutes * 60.0).round() as i64 * 1_000_000_000;
    let auto_lock_ns = auto_lock_bridge_seconds.round() as i64 * 1_000_000_000;
    let alive_spans = substrate
        .all_timestamps
        .iter()
        .map(|(participant_id, timestamps)| {
            let boots = substrate
                .boots
                .get(participant_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            (
                participant_id.as_str(),
                build_alive_spans(timestamps, tolerance_ns, boots),
            )
        })
        .collect::<BTreeMap<_, _>>();
    partition
        .sessions
        .iter()
        .map(|row| {
            let (Some(start), Some(raw_end)) = (row.start_timestamp_ns, row.stop_timestamp_ns)
            else {
                return CreditDecision::Passthrough;
            };
            if raw_end <= start {
                return CreditDecision::Passthrough;
            }
            let end = raw_end.min(start.saturating_add(cap_ns));
            let key = witness_key(&row.participant_id);
            let points = substrate
                .points
                .get(key)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let alive = || {
                let participant_alive_spans = alive_spans
                    .get(key)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                clip_alive_spans(participant_alive_spans, start, end)
            };
            // A rule that never reads screen events has no "no screen witness"
            // case to fall back from: its credit is the alive spans either way,
            // whether or not this participant's device reports the screen.
            let (intervals, no_witness_fallback) = if !screen_gating_rule.consults_screen_witness() {
                (alive(), false)
            } else if points.is_empty()
                || !substrate.capable.contains(key)
            {
                if screen_gating_rule.requires_screen_witness() {
                    (Vec::new(), false)
                } else {
                    (vec![(start, end)], false)
                }
            } else {
                let alive = alive();
                let first_in_window = points.partition_point(|point| point.timestamp_ns < start);
                let has_point = points
                    .get(first_in_window)
                    .is_some_and(|point| point.timestamp_ns <= end);
                if screen_state_at(points, start).is_none() && !has_point {
                    if screen_gating_rule.requires_screen_witness() {
                        (Vec::new(), false)
                    } else {
                        let app_count = day_apps
                            .get(&(row.participant_id.to_string(), row.date.to_string()))
                            .map(BTreeSet::len)
                            .unwrap_or_default();
                        if app_count >= no_witness_min_day_apps as usize {
                            (alive, true)
                        } else {
                            (Vec::new(), false)
                        }
                    }
                } else {
                    let screen = creditable_intervals(points, start, end, auto_lock_ns);
                    // The shipped rule is the intersection of the two
                    // observations; the other two values keep one conjunct.
                    let credited = match screen_gating_rule {
                        ScreenGatingRule::ScreenAndLivenessV1 => {
                            intersect_intervals(&screen, &alive)
                        }
                        ScreenGatingRule::ScreenWitnessOnly
                        | ScreenGatingRule::StrictVisualOnly => screen,
                        ScreenGatingRule::DeviceLivenessOnly => alive,
                    };
                    (credited, false)
                }
            };
            CreditDecision::Intervals {
                intervals,
                session_capped: end < raw_end,
                no_witness_fallback,
            }
        })
        .collect()
}

pub(crate) fn materialize_credited_rows(
    partition: &CreditPartition,
    decisions: &[CreditDecision],
    substrate: &ScreenCreditSubstrate,
    device_liveness_gap_tolerance_minutes: f64,
) -> CreditEmission {
    let tolerance_ns =
        (device_liveness_gap_tolerance_minutes * 60.0).round() as i64 * 1_000_000_000;
    let mut credited = Vec::new();
    let mut counts = CreditEmissionCounts {
        truncated_sessions: 0,
        no_witness_fallbacks: 0,
        fully_dead_sessions: 0,
    };
    for (row, decision) in partition.sessions.iter().zip(decisions) {
        let intervals = match decision {
            CreditDecision::Passthrough => {
                credited.push(row.clone());
                continue;
            }
            CreditDecision::Intervals {
                intervals,
                session_capped,
                no_witness_fallback,
            } => {
                if *session_capped {
                    counts.truncated_sessions += 1;
                }
                if *no_witness_fallback {
                    counts.no_witness_fallbacks += 1;
                }
                intervals
            }
        };
        let before = credited.len();
        let mut original_row = Some(row.clone());
        for (interval_index, (interval_start, interval_end)) in intervals.iter().enumerate() {
            if interval_end <= interval_start {
                continue;
            }
            let mut credited_row = if interval_index + 1 == intervals.len() {
                original_row.take().expect("credit source row is available")
            } else {
                original_row
                    .as_ref()
                    .expect("credit source row is available")
                    .clone()
            };
            let (contributors, search) = credit_lineage_contributors(
                substrate,
                witness_key(&credited_row.participant_id),
                *interval_start,
                *interval_end,
                tolerance_ns,
            );
            credited_row.source_data_rows.merge(&contributors);
            if let Some(search) = search {
                Arc::make_mut(&mut credited_row.lineage_searches).push(search);
            }
            let duration_seconds = (*interval_end - *interval_start) as f64 / 1_000_000_000.0;
            credited_row.start_timestamp_ns = Some(*interval_start);
            credited_row.stop_timestamp_ns = Some(*interval_end);
            credited_row.event_timestamp_ns = *interval_start;
            credited_row.duration_seconds = Some(duration_seconds);
            credited_row.duration_minutes = Some(duration_seconds * (1.0 / 60.0));
            let timezone: Tz = credited_row.timezone.parse().unwrap_or(chrono_tz::UTC);
            populate_time_columns(&mut credited_row, timezone, &mut LocalDateMemo::default());
            credited.push(credited_row);
        }
        if credited.len() == before {
            counts.fully_dead_sessions += 1;
        }
    }
    let references = credited.iter().collect::<Vec<_>>();
    CreditEmission {
        credited_rows_digest: row_reference_sequence_digest(&references),
        credited,
        counts,
    }
}

pub(crate) fn assemble_credit_outputs(
    partition: &CreditPartition,
    screen_incapable: &[String],
    emission: &CreditEmission,
) -> CreditResult {
    let mut rows = emission.credited.clone();
    rows.extend(partition.rest.iter().cloned());
    CreditResult {
        rows,
        credited_rows_digest: emission.credited_rows_digest.clone(),
        rest_rows_digest: partition.rest_rows_digest.clone(),
        report: CreditReportOwned {
            sessions: partition.sessions.len(),
            credited_rows: emission.credited.len(),
            credited_minutes: emission
                .credited
                .iter()
                .map(|row| row.duration_minutes.unwrap_or(0.0))
                .sum(),
            raw_session_minutes: partition
                .sessions
                .iter()
                .map(|row| row.duration_minutes.unwrap_or(0.0))
                .sum(),
            truncated_sessions: emission.counts.truncated_sessions,
            fully_dead_sessions: emission.counts.fully_dead_sessions,
            no_witness_fallbacks: emission.counts.no_witness_fallbacks,
            screen_incapable_participants: screen_incapable.to_vec(),
        },
    }
}
