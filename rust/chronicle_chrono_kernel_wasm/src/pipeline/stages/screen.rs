use crate::pipeline_v2::{LockedScreenAudioDisposition, ScreenSessionClassificationPolicy, ScreenSessionMaximumDurationDisposition};
use crate::pipeline_v2::{
    AHashMap, AHashSet, B05ComputationPhase, B05SchoedelPreflightResult, BTreeMap, BTreeSet,
    FOREGROUND_EVENTS, HashMap, LOCK_SCREEN_EVENTS, LocalDateMemo, MEANINGFUL_ACTIVITY_EVENTS,
    PipelineV2Options, QueryCheckpointRecorder, RawRow, Row, SCREEN_START_EVENTS,
    SCREEN_STOP_EVENTS, SCREEN_USAGE, SharedString, SourceDataRows, Tz, UNLOCK_EVENTS, b05,
    normalize_interaction_type_local, populate_time_columns, screen, source,
};

/// True when a canonical interaction type opens a screen session. Upload
/// inspection uses it to tell a file with no screen state apart from a
/// screen-usage run that found nothing; the constant stays private so the
/// kernel remains the only owner of the screen-state vocabulary.
pub fn is_screen_session_start(canonical_interaction_type: &str) -> bool {
    SCREEN_START_EVENTS.contains(&canonical_interaction_type)
}

// ---- screen state machine ----------------------------------------------

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct ScreenState {
    pub(super) start_index: usize,
    pub(super) start_timestamp_ns: i64,
    pub(super) start_timezone: SharedString,
    pub(super) start_source_data_rows: SourceDataRows,
    pub(super) lock_screen_seen: bool,
    pub(super) unlocked_seen: bool,
    pub(super) foreground_pkg: Option<SharedString>,
    #[serde(default)]
    pub(super) app_observed: Option<bool>,
    pub(super) last_meaningful_ts_ns: Option<i64>,
    pub(super) last_meaningful_pkg: Option<SharedString>,
    pub(super) source_data_rows: SourceDataRows,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ScreenSessionClose {
    pub(super) state: ScreenState,
    pub(super) stop_timestamp_ns: Option<i64>,
    pub(super) stop_event_type: Option<SharedString>,
    pub(super) stop_index: Option<usize>,
    pub(super) stop_source_data_rows: SourceDataRows,
}

pub(crate) fn derive_screen_usage_sessions_full(
    stages: &crate::pipeline_v2::StageFunctions,
    rows: &[Row],
    opts: &PipelineV2Options,
    apps_forcing: &HashMap<String, String>,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<(Vec<Row>, Vec<ScreenSessionClose>), String> {
    let keyguard_timestamps = screen::index_keyguard_events(rows);
    query_checkpoints.value("index_keyguard_events", &keyguard_timestamps)?;
    let closes = screen::infer_screen_session_skeletons(rows);
    query_checkpoints.value("infer_screen_session_skeletons", &closes)?;
    let sessions = (stages.classify_screen_sessions)(
        rows,
        &closes,
        &keyguard_timestamps,
        apps_forcing,
        screen::ScreenClassificationSettings {
            auto_lock_timeout_seconds: opts.screen_auto_lock_timeout_seconds,
            auto_lock_tolerance_seconds: opts.screen_auto_lock_tolerance_seconds,
            manual_lock_max_tail_seconds: opts.screen_manual_lock_max_tail_seconds,
            keyguard_near_stop_seconds: opts.screen_keyguard_near_stop_seconds,
            locked_screen_audio_disposition: opts.locked_screen_audio_disposition,
        },
    );
    let sessions = apply_screen_session_policies(
        sessions, opts.screen_session_classification_policy,
        opts.screen_session_maximum_duration_minutes,
        opts.screen_session_maximum_duration_disposition,
        opts.locked_screen_audio_disposition,
    );
    Ok((sessions, closes))
}

pub(crate) fn chronicle_interval_inputs(
    rows: &[Row],
    closes: &[ScreenSessionClose],
) -> Vec<b05::ChronicleScreenIntervalInput> {
    closes
        .iter()
        .map(|close| {
            let start_row = &rows[close.state.start_index];
            let close_reason = match close.stop_event_type.as_deref() {
                None => b05::ScreenIntervalCloseReason::RightCensoredObservationWindow,
                Some("Device Screen Off") => b05::ScreenIntervalCloseReason::DeviceScreenOff,
                Some("Device Shutdown") => b05::ScreenIntervalCloseReason::DeviceShutdown,
                Some(_) => b05::ScreenIntervalCloseReason::ScreenNonInteractive,
            };
            b05::ChronicleScreenIntervalInput {
                participant_id: start_row.participant_id.to_string(),
                start_ns: close.state.start_timestamp_ns,
                stop_ns: close.stop_timestamp_ns,
                start_boundary_source_row: close
                    .state
                    .start_source_data_rows
                    .iter()
                    .next()
                    .expect("a canonical screen start has source lineage"),
                stop_boundary_source_row: close.stop_source_data_rows.iter().next(),
                start_source_rows: close.state.start_source_data_rows.iter().collect(),
                stop_source_rows: close.stop_source_data_rows.iter().collect(),
                close_reason,
            }
        })
        .collect()
}

pub(crate) fn chronicle_orphan_stop_issues(rows: &[Row]) -> Vec<b05::ScreenConstructionIssue> {
    let mut open = BTreeSet::<SharedString>::new();
    let mut issues = Vec::new();
    for row in rows {
        if SCREEN_START_EVENTS.contains(&row.interaction_type.as_str()) {
            open.insert(row.participant_id.clone());
        } else if SCREEN_STOP_EVENTS.contains(&row.interaction_type.as_str())
            && !open.remove(&row.participant_id)
        {
            if let Some(source_data_row) = row.source_data_rows.iter().next() {
                issues.push(b05::ScreenConstructionIssue {
                    participant_id: row.participant_id.to_string(),
                    source_data_row,
                    code: b05::ScreenConstructionIssueCode::ChronicleOrphanStop,
                });
            }
        }
    }
    issues
}

pub(crate) fn finalize_chronicle_b05_screen(
    preflight: &mut B05SchoedelPreflightResult,
    raw_input_sha256: &str,
    raw_events: &[b05::RawB05Event],
    canonical_rows: &[Row],
    closes: &[ScreenSessionClose],
    opts: &PipelineV2Options,
    fragmented_participants: &BTreeSet<String>,
) -> Result<(), String> {
    let screen_construction = b05::adapt_chronicle_screen_intervals_with_issues(
        b05::B05ApplicabilityInput {
            raw_input_sha256,
            raw_events,
            evidence: None,
            evidence_assignment_digest: None,
            options_digest: &preflight.options_digest,
            selection_was_explicit: opts.screen_session_construction_strategy_explicit,
            fragmented_participants,
        },
        &chronicle_interval_inputs(canonical_rows, closes),
        &chronicle_orphan_stop_issues(canonical_rows),
    )
    .map_err(|error| error.to_string())?;
    preflight.screen_construction = Some(screen_construction);
    preflight.screen_construction_phase = B05ComputationPhase::Finalized;
    Ok(())
}

pub(crate) fn materialize_b05_screen_rows(
    stages: &crate::pipeline_v2::StageFunctions,
    screen: &b05::ScreenConstructionOutput,
    raw_rows: &[RawRow],
    timezone_name: &str,
) -> Result<Vec<Row>, String> {
    let raw_by_source_row = raw_rows
        .iter()
        .map(|row| (row.source_data_row, row))
        .collect::<BTreeMap<_, _>>();
    let selected_starts = screen
        .intervals
        .iter()
        .map(|interval| {
            raw_by_source_row
                .get(&interval.start_boundary_source_row)
                .copied()
                .cloned()
                .ok_or_else(|| {
                    "b05_materialization_error:start_boundary_source_row_missing".to_string()
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let device_model = source::attach_device_models(raw_rows);
    let mut rows = (stages.canonicalize_source_rows)(
        &selected_starts,
        timezone_name,
        &BTreeMap::new(),
        &device_model,
    )?;
    for (ordinal, (row, interval)) in rows.iter_mut().zip(&screen.intervals).enumerate() {
        let mut lineage = SourceDataRows::default();
        for source_row in interval
            .start_source_rows
            .iter()
            .chain(&interval.stop_source_rows)
        {
            lineage.merge(&SourceDataRows::single(*source_row));
        }
        let stop_event_type = interval
            .stop_boundary_source_row
            .and_then(|source_row| raw_by_source_row.get(&source_row))
            .map(|raw| normalize_interaction_type_local(&raw.interaction_type).into());
        let duration_seconds = interval
            .stop_ns
            .map(|stop| stop.saturating_sub(interval.start_ns) as f64 / 1_000_000_000.0);
        let data = row.edit_all();
        data.source_data_rows = lineage;
        data.application_label = SharedString::default();
        data.interaction_type = SCREEN_USAGE.into();
        data.app_package_name = SharedString::default();
        data.timezone = timezone_name.into();
        data.event_timestamp_ns = interval.start_ns;
        data.start_timestamp_ns = Some(interval.start_ns);
        data.stop_timestamp_ns = interval.stop_ns;
        data.duration_seconds = duration_seconds;
        data.duration_minutes = duration_seconds.map(|seconds| seconds / 60.0);
        data.screen_usage_end_reason = Some(interval.close_reason.canonical_id().into());
        data.screen_usage_end_reason_confidence = Some(1.0);
        data.screen_usage_stop_event_type = stop_event_type;
        data.screen_usage_last_activity_timestamp_ns = None;
        data.screen_usage_tail_gap_seconds = None;
        data.screen_usage_foreground_app_package = None;
        data.screen_usage_app_observed = None;
        data.screen_usage_session_classification = None;
        data.screen_usage_apps_forcing_screen_open_label = None;
        data.screen_usage_lock_screen_only =
            Some(u8::from(interval.kind == b05::ScreenIntervalKind::Glance));
        data.screen_interval_id = Some(interval.screen_interval_id.as_str().into());
        data.data_time_gap_hours = 0.0;
        data.index = 1_000_000usize.saturating_add(ordinal);
        let timezone: Tz = data.timezone.parse().unwrap_or(Tz::UTC);
        populate_time_columns(row, timezone, &mut LocalDateMemo::default());
    }
    Ok(rows)
}

pub(crate) fn index_keyguard_events(rows: &[Row]) -> BTreeMap<String, Vec<i64>> {
    let lock_events = LOCK_SCREEN_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let mut timestamps = BTreeMap::<String, Vec<i64>>::new();
    for row in rows
        .iter()
        .filter(|row| lock_events.contains(row.interaction_type.as_str()))
    {
        timestamps
            .entry(row.participant_id.to_string())
            .or_default()
            .push(row.event_timestamp_ns);
    }
    for participant_timestamps in timestamps.values_mut() {
        participant_timestamps.sort_unstable();
    }
    timestamps
}

pub(crate) fn infer_screen_session_skeletons(rows: &[Row]) -> Vec<ScreenSessionClose> {
    let start_events = SCREEN_START_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let stop_events = SCREEN_STOP_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let lock_events = LOCK_SCREEN_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let unlock_events = UNLOCK_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let foreground_events = FOREGROUND_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let meaningful_events = MEANINGFUL_ACTIVITY_EVENTS
        .iter()
        .copied()
        .collect::<AHashSet<_>>();
    let mut closes = Vec::new();
    // Screen state is device/participant state. Keeping one global slot lets
    // an interleaved participant close another participant's interval.
    let mut states = AHashMap::<SharedString, ScreenState>::new();
    for (index, row) in rows.iter().enumerate() {
        let interaction = row.interaction_type.as_str();
        let package = (!row.app_package_name.is_empty()).then(|| row.app_package_name.clone());
        let participant_id = row.participant_id.clone();
        if start_events.contains(interaction) {
            if let Some(current) = states.get_mut(&participant_id) {
                current.source_data_rows.merge(&row.source_data_rows);
                current.start_source_data_rows.merge(&row.source_data_rows);
            } else {
                states.insert(
                    participant_id,
                    ScreenState {
                        start_index: index,
                        start_timestamp_ns: row.event_timestamp_ns,
                        start_timezone: row.timezone.clone(),
                        start_source_data_rows: row.source_data_rows.clone(),
                        lock_screen_seen: lock_events.contains(interaction),
                        unlocked_seen: false,
                        foreground_pkg: None,
                        app_observed: Some(false),
                        last_meaningful_ts_ns: None,
                        last_meaningful_pkg: None,
                        source_data_rows: row.source_data_rows.clone(),
                    },
                );
            }
            continue;
        }
        let Some(current) = states.get_mut(&participant_id) else {
            continue;
        };
        current.source_data_rows.merge(&row.source_data_rows);
        if lock_events.contains(interaction) {
            current.lock_screen_seen = true;
        }
        if unlock_events.contains(interaction) {
            current.unlocked_seen = true;
        }
        if foreground_events.contains(interaction) {
            current.foreground_pkg = package.clone();
            // Evidence for the entire bout is not the latest foreground identity.
            // A blank resume cannot erase an earlier observed app or prove no app.
            if package.is_some() {
                current.app_observed = Some(true);
            } else if current.app_observed != Some(true) {
                current.app_observed = None;
            }
        }
        if meaningful_events.contains(interaction) {
            current.last_meaningful_ts_ns = Some(row.event_timestamp_ns);
            current.last_meaningful_pkg = package.or_else(|| current.foreground_pkg.clone());
        }
        if stop_events.contains(interaction) {
            let current = states
                .remove(&participant_id)
                .expect("participant screen state is open");
            closes.push(ScreenSessionClose {
                state: current,
                stop_timestamp_ns: Some(row.event_timestamp_ns),
                stop_event_type: Some(interaction.into()),
                stop_index: Some(index),
                stop_source_data_rows: row.source_data_rows.clone(),
            });
        }
    }
    for state in states.into_values() {
        closes.push(ScreenSessionClose {
            state,
            stop_timestamp_ns: None,
            stop_event_type: None,
            stop_index: None,
            stop_source_data_rows: SourceDataRows::default(),
        });
    }
    closes.sort_by(|left, right| {
        let left_row = &rows[left.state.start_index];
        let right_row = &rows[right.state.start_index];
        (
            left_row.participant_id.as_str(),
            left.state.start_timestamp_ns,
            left.state.start_index,
        )
            .cmp(&(
                right_row.participant_id.as_str(),
                right.state.start_timestamp_ns,
                right.state.start_index,
            ))
    });
    closes
}

#[derive(Clone, Copy)]
pub struct ScreenClassificationSettings {
    pub auto_lock_timeout_seconds: f64,
    pub auto_lock_tolerance_seconds: f64,
    pub manual_lock_max_tail_seconds: f64,
    pub keyguard_near_stop_seconds: f64,
    pub locked_screen_audio_disposition: LockedScreenAudioDisposition,
}

pub(crate) fn classify_screen_sessions(
    rows: &[Row],
    closes: &[ScreenSessionClose],
    keyguard_timestamps: &BTreeMap<String, Vec<i64>>,
    apps_forcing: &HashMap<String, String>,
    settings: ScreenClassificationSettings,
) -> Vec<Row> {
    let mut sessions = Vec::with_capacity(closes.len());
    for close in closes {
        let state = &close.state;
        if settings.locked_screen_audio_disposition
            == LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
            && state.lock_screen_seen
            && !state.unlocked_seen
        {
            continue;
        }
        let start_row = &rows[state.start_index];
        let participant_keyguard_timestamps = keyguard_timestamps
            .get(start_row.participant_id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        let mut session = start_row.clone();
        session.source_data_rows = state.source_data_rows.clone();
        session.interaction_type = SCREEN_USAGE.into();
        session.start_timestamp_ns = Some(state.start_timestamp_ns);
        session.stop_timestamp_ns = close.stop_timestamp_ns;
        session.duration_seconds = close
            .stop_timestamp_ns
            .map(|stop| (stop - state.start_timestamp_ns) as f64 / 1e9);
        session.duration_minutes = session.duration_seconds.map(|seconds| seconds / 60.0);
        session.application_label = SharedString::default();
        session.app_package_name = state.foreground_pkg.clone().unwrap_or_default();
        session.screen_usage_foreground_app_package = state.foreground_pkg.clone();
        session.screen_usage_app_observed = state.app_observed;
        session.screen_usage_session_classification = None;
        session.screen_usage_end_reason = None;
        session.screen_usage_end_reason_confidence = None;
        session.screen_usage_stop_event_type = close.stop_event_type.clone();
        session.screen_usage_last_activity_timestamp_ns = state.last_meaningful_ts_ns;
        session.screen_usage_tail_gap_seconds = None;
        session.screen_usage_apps_forcing_screen_open_label = None;
        session.screen_usage_lock_screen_only = Some(0);
        session.data_time_gap_hours = 0.0;
        session.event_timestamp_ns = state.start_timestamp_ns;
        session.timezone.clone_from(&state.start_timezone);
        session.index = start_row.index + 1_000_000;
        if let Ok(timezone) = session.timezone.parse::<Tz>() {
            populate_time_columns(&mut session, timezone, &mut LocalDateMemo::default());
        }

        let Some(stop_timestamp_ns) = close.stop_timestamp_ns else {
            session.screen_usage_end_reason = Some("missing_stop".into());
            session.screen_usage_end_reason_confidence = Some(1.0);
            sessions.push(session);
            continue;
        };
        let last_package = state
            .last_meaningful_pkg
            .clone()
            .or_else(|| state.foreground_pkg.clone())
            .unwrap_or_default();
        let forcing_label = apps_forcing
            .get(last_package.as_str())
            .cloned()
            .unwrap_or_default();
        let tail_gap = state
            .last_meaningful_ts_ns
            .map(|timestamp| (stop_timestamp_ns - timestamp) as f64 / 1e9);
        session.screen_usage_tail_gap_seconds = tail_gap;
        session.screen_usage_apps_forcing_screen_open_label =
            (!forcing_label.is_empty()).then(|| forcing_label.clone().into());

        if close.stop_event_type.as_deref() == Some("Screen Non-Interactive/Manual Hardware Button")
        {
            session.screen_usage_end_reason = Some("manual_hardware_button".into());
            session.screen_usage_end_reason_confidence = Some(1.0);
        } else if close.stop_event_type.as_deref() == Some("Screen Non-Interactive/Aborted Unlock")
        {
            session.screen_usage_end_reason = Some("aborted_unlock".into());
            session.screen_usage_end_reason_confidence = Some(1.0);
        } else if close.stop_event_type.as_deref() == Some("Screen Non-Interactive/Idle Timeout") {
            session.screen_usage_end_reason = Some("idle_timeout".into());
            session.screen_usage_end_reason_confidence = Some(1.0);
        } else if state.lock_screen_seen && !state.unlocked_seen && state.app_observed == Some(false) {
            session.screen_usage_end_reason = Some("lock_screen_only".into());
            session.screen_usage_end_reason_confidence = Some(0.95);
            session.screen_usage_lock_screen_only = Some(1);
        } else if tail_gap.is_some_and(|gap| {
            !forcing_label.is_empty() && gap > settings.auto_lock_timeout_seconds
        }) {
            session.screen_usage_end_reason = Some("app_kept_awake_or_extended".into());
            session.screen_usage_end_reason_confidence = Some(0.9);
        } else if tail_gap.is_some_and(|gap| gap <= settings.manual_lock_max_tail_seconds) {
            session.screen_usage_end_reason = Some("probable_manual_lock".into());
            session.screen_usage_end_reason_confidence = Some(0.85);
        } else if tail_gap.is_some_and(|gap| {
            (gap - settings.auto_lock_timeout_seconds).abs() <= settings.auto_lock_tolerance_seconds
        }) {
            session.screen_usage_end_reason = Some("probable_auto_lock".into());
            session.screen_usage_end_reason_confidence = Some(0.9);
        } else if state.lock_screen_seen
            && participant_keyguard_timestamps[participant_keyguard_timestamps.partition_point(
                |timestamp| {
                    *timestamp
                        < stop_timestamp_ns.saturating_sub(
                            (settings.keyguard_near_stop_seconds * 1_000_000_000.0).ceil() as i64,
                        )
                },
            )
                ..participant_keyguard_timestamps.partition_point(|timestamp| {
                    *timestamp
                        <= stop_timestamp_ns.saturating_add(
                            (settings.keyguard_near_stop_seconds * 1_000_000_000.0).ceil() as i64,
                        )
                })]
                .iter()
                .any(|timestamp| {
                    ((stop_timestamp_ns - *timestamp) as f64 / 1e9).abs()
                        <= settings.keyguard_near_stop_seconds
                })
        {
            session.screen_usage_end_reason = Some("probable_manual_lock".into());
            session.screen_usage_end_reason_confidence = Some(0.7);
        } else if tail_gap.is_some() {
            session.screen_usage_end_reason = Some("extended_idle_or_unknown".into());
            session.screen_usage_end_reason_confidence = Some(0.5);
        } else {
            session.screen_usage_end_reason = Some("unknown".into());
            session.screen_usage_end_reason_confidence = Some(0.25);
        }
        sessions.push(session);
    }
    sessions
}

pub(crate) fn apply_screen_session_policies(
    mut sessions: Vec<Row>,
    classification_policy: ScreenSessionClassificationPolicy,
    maximum_duration_minutes: f64,
    maximum_duration_disposition: ScreenSessionMaximumDurationDisposition,
    locked_screen_audio_disposition: LockedScreenAudioDisposition,
) -> Vec<Row> {
    if locked_screen_audio_disposition
        == LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
    {
        sessions.retain(|row| row.screen_usage_lock_screen_only != Some(1));
    }

    let cap_ns = (maximum_duration_minutes * 60_000_000_000.0).round() as i64;
    if maximum_duration_disposition == ScreenSessionMaximumDurationDisposition::ExcludeParticipant {
        let excluded = sessions
            .iter()
            .filter_map(|row| {
                let (Some(start), Some(stop)) = (row.start_timestamp_ns, row.stop_timestamp_ns)
                else {
                    return None;
                };
                (stop.saturating_sub(start) > cap_ns).then(|| row.participant_id.to_string())
            })
            .collect::<BTreeSet<_>>();
        sessions.retain(|row| !excluded.contains(row.participant_id.as_str()));
    }
    for session in &mut sessions {
        if maximum_duration_disposition == ScreenSessionMaximumDurationDisposition::Truncate {
            if let (Some(start), Some(stop)) =
                (session.start_timestamp_ns, session.stop_timestamp_ns)
            {
                if stop.saturating_sub(start) > cap_ns {
                    let stop = start.saturating_add(cap_ns);
                    let temporal = session.edit_temporal();
                    *temporal.stop_timestamp_ns = Some(stop);
                    *temporal.duration_seconds = Some(maximum_duration_minutes * 60.0);
                    *temporal.duration_minutes = Some(maximum_duration_minutes);
                    *temporal.screen_usage_last_activity_timestamp_ns = temporal
                        .screen_usage_last_activity_timestamp_ns
                        .map(|timestamp| timestamp.min(stop));
                    *temporal.screen_usage_tail_gap_seconds = None;
                    let classification = session.edit_classification();
                    // Whole-bout evidence is not evidence for a shortened interval.
                    *classification.screen_usage_app_observed = None;
                    *classification.screen_usage_end_reason = Some("duration_cap".into());
                    *classification.screen_usage_end_reason_confidence = Some(1.0);
                    *classification.screen_usage_stop_event_type = None;
                }
            }
        }

        let label = match classification_policy {
            ScreenSessionClassificationPolicy::None => None,
            ScreenSessionClassificationPolicy::PhoneCheckInclusive15s => session
                .duration_seconds
                .is_some_and(|seconds| seconds <= 15.0)
                .then_some("phone_check"),
            ScreenSessionClassificationPolicy::NullNoAppStrictGt15sVsApp => {
                if session.screen_usage_app_observed == Some(true) {
                    Some("app")
                } else if session.screen_usage_app_observed == Some(false) && session
                    .duration_seconds
                    .is_some_and(|seconds| seconds > 15.0)
                {
                    Some("null")
                } else {
                    None
                }
            }
        };
        *session
            .edit_classification()
            .screen_usage_session_classification = label.map(Into::into);
    }
    sessions
}

pub(crate) fn bound_app_rows_to_interactive_screen(
    mut rows: Vec<Row>,
    screen_rows: &[Row],
) -> Vec<Row> {
    let mut intervals = BTreeMap::<SharedString, Vec<(i64, Option<i64>)>>::new();
    for screen in screen_rows {
        if let Some(start) = screen.start_timestamp_ns {
            intervals
                .entry(screen.participant_id.clone())
                .or_default()
                .push((start, screen.stop_timestamp_ns));
        }
    }
    for participant_intervals in intervals.values_mut() {
        participant_intervals.sort_unstable_by_key(|interval| interval.0);
    }
    rows.retain_mut(|row| {
        let Some(start) = row.start_timestamp_ns else {
            return false;
        };
        let Some(participant_intervals) = intervals.get(&row.participant_id) else {
            return false;
        };
        let candidate_count = participant_intervals.partition_point(|interval| interval.0 <= start);
        let Some((_, screen_stop)) = participant_intervals[..candidate_count]
            .iter()
            .rev()
            .find(|(_, stop)| stop.is_none_or(|stop| start < stop))
        else {
            return false;
        };
        if screen_stop.is_some_and(|screen_stop| {
            row.stop_timestamp_ns
                .is_none_or(|stop| stop > screen_stop)
        }) {
            let screen_stop = screen_stop.expect("checked as present");
            let temporal = row.edit_temporal();
            *temporal.stop_timestamp_ns = Some(screen_stop);
            let duration_seconds = screen_stop.saturating_sub(start) as f64 / 1e9;
            *temporal.duration_seconds = Some(duration_seconds);
            *temporal.duration_minutes = Some(duration_seconds / 60.0);
        }
        row.stop_timestamp_ns.is_none_or(|stop| stop > start)
    });
    rows
}

pub(crate) fn screen_duration_excluded_participants(
    construction: &b05::ScreenConstructionOutput,
    disposition: ScreenSessionMaximumDurationDisposition,
    maximum_duration_minutes: f64,
) -> BTreeSet<String> {
    if disposition != ScreenSessionMaximumDurationDisposition::ExcludeParticipant {
        return BTreeSet::new();
    }
    let cap_ns = (maximum_duration_minutes * 60_000_000_000.0).round() as i64;
    construction
        .intervals
        .iter()
        .filter(|interval| {
            interval
                .stop_ns
                .is_some_and(|stop| stop.saturating_sub(interval.start_ns) > cap_ns)
        })
        .map(|interval| interval.participant_id.clone())
        .collect()
}

pub(crate) fn remove_participants(mut rows: Vec<Row>, excluded: &BTreeSet<String>) -> Vec<Row> {
    if !excluded.is_empty() {
        rows.retain(|row| !excluded.contains(row.participant_id.as_str()));
    }
    rows
}
