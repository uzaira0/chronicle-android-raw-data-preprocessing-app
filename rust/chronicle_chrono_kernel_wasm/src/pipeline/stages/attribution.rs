use crate::pipeline_v2::{
    AHashSet, APP_USAGE, Arc, AttributionCompleteness, AttributionCompletenessDay,
    AttributionMinutes, AttributionReport, BTreeMap, BTreeSet, ComplianceDayCheckpoint,
    ComplianceResultCheckpoint, CoverageDayCheckpoint, CoverageOutput, DayCoverageCheckpoint,
    Duration, HashMap, KIDS_SHELL_PACKAGES, LocalDateMemo, NON_TARGET_CHILD_APP_USAGE, NaiveDate,
    NO_ACTIVITY_PLACEHOLDER_PACKAGE,
    QueryCheckpointRecorder, ResolvedParticipantWindow, Row, SharedString, SharingEntry,
    SharingResolution, SharingResolutionValue, SharingStatus, StudyWindow, SurveyLookup, Tz,
    attribution, csv_escape_value, output, populate_time_columns,
};

/// `windows` is `Some` when the study-window filter is on: a raw day the
/// filter removed must not come back as a placeholder.
pub(crate) fn add_no_activity_placeholder_rows(
    mut app_rows: Vec<Row>,
    raw_rows: &[Row],
    windows: Option<&[ResolvedParticipantWindow]>,
) -> Vec<Row> {
    let windows = windows.map(|resolved| {
        resolved
            .iter()
            .map(|entry| (entry.participant_id.as_str(), entry.window.as_ref()))
            .collect::<BTreeMap<_, _>>()
    });
    let mut usage_days: AHashSet<(SharedString, SharedString)> = AHashSet::new();
    for row in &app_rows {
        // Observation presence and headline eligibility are distinct. A
        // retained diagnostic episode still proves that app activity was
        // observed on this day; only a destructive DropRow can remove that
        // witness before placeholder synthesis.
        if row.interaction_type == APP_USAGE {
            usage_days.insert((row.participant_id.clone(), row.date.clone()));
        }
    }

    // Preserve JavaScript Map insertion order: raw rows are event-sorted, so
    // samples are emitted in first-observed participant/day order.
    let mut sample_index: HashMap<(SharedString, SharedString), usize> = HashMap::new();
    let mut samples: Vec<Row> = Vec::new();
    for row in raw_rows {
        let key = (row.participant_id.clone(), row.date.clone());
        if let Some(index) = sample_index.get(&key).copied() {
            if row.event_timestamp_ns < samples[index].event_timestamp_ns {
                samples[index] = row.clone();
            }
        } else {
            sample_index.insert(key, samples.len());
            samples.push(row.clone());
        }
    }

    let mut date_memo = LocalDateMemo::default();
    for mut sample in samples {
        let key = (sample.participant_id.clone(), sample.date.clone());
        if usage_days.contains(&key) {
            continue;
        }
        if windows
            .as_ref()
            .is_some_and(|resolved| !window_keeps_day(resolved, &sample.participant_id, &sample.date))
        {
            continue;
        }
        sample.interaction_type = APP_USAGE.into();
        sample.app_package_name = NO_ACTIVITY_PLACEHOLDER_PACKAGE.into();
        sample.application_label = "No Activity".into();
        sample.start_timestamp_ns = Some(sample.event_timestamp_ns);
        sample.stop_timestamp_ns = Some(sample.event_timestamp_ns);
        sample.duration_seconds = Some(0.0);
        sample.duration_minutes = Some(0.0);
        sample.data_time_gap_hours = 0.0;
        sample.index += 2_000_000;
        let timezone: Tz = sample.timezone.parse().unwrap_or(chrono_tz::UTC);
        populate_time_columns(&mut sample, timezone, &mut date_memo);
        app_rows.push(sample);
    }
    app_rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    app_rows
}

fn study_window_excludes_date(window: &StudyWindow, date: &str) -> bool {
    window.exclusions.iter().any(|exclusion| {
        date >= exclusion.start_date.as_str() && date <= exclusion.end_date.as_str()
    })
}

pub(crate) fn numerical_id(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    let mut start = None;
    for (index, byte) in bytes.iter().enumerate() {
        if byte.is_ascii_digit() {
            start.get_or_insert(index);
        } else if let Some(begin) = start.take() {
            if index - begin >= 3 {
                return Some(&value[begin..index]);
            }
        }
    }
    start.and_then(|begin| (bytes.len() - begin >= 3).then_some(&value[begin..]))
}

/// Match the exact source identifier first, then the established numerical
/// identifier fallback, using the same owner at preflight and execution.
pub fn matching_study_participant_id<'a, I>(
    participant_id: &str,
    mut candidate_ids: I,
) -> Option<&'a str>
where
    I: Iterator<Item = &'a str> + Clone,
{
    candidate_ids
        .clone()
        .find(|candidate| *candidate == participant_id)
        .or_else(|| {
            let id = numerical_id(participant_id)?;
            candidate_ids.find(|candidate| numerical_id(candidate) == Some(id))
        })
}

pub(crate) fn resolve_participant_windows(
    rows: &[Row],
    windows: &[StudyWindow],
) -> Vec<ResolvedParticipantWindow> {
    let mut seen = AHashSet::new();
    let mut resolved = Vec::new();
    for row in rows {
        if !seen.insert(row.participant_id.clone()) {
            continue;
        }
        let matched_id = matching_study_participant_id(
            &row.participant_id,
            windows.iter().map(|window| window.participant_id.as_str()),
        );
        let window = matched_id.and_then(|id| {
            windows.iter().find(|window| window.participant_id == id)
        });
        resolved.push(ResolvedParticipantWindow {
            participant_id: row.participant_id.to_string(),
            window: window.cloned(),
        });
    }
    resolved
}

/// Whether a participant's local day survives the study-window filter: a
/// participant with no resolved window keeps every day.
pub(crate) fn window_keeps_day(
    resolved: &BTreeMap<&str, Option<&StudyWindow>>,
    participant_id: &str,
    date: &str,
) -> bool {
    resolved
        .get(participant_id)
        .copied()
        .flatten()
        .is_none_or(|window| {
            date >= window.start_date.as_str()
                && date <= window.end_date.as_str()
                && !study_window_excludes_date(window, date)
        })
}

pub(crate) fn apply_study_window(
    rows: Vec<Row>,
    resolved: &[ResolvedParticipantWindow],
) -> (Vec<Row>, usize, Vec<String>) {
    let resolved = resolved
        .iter()
        .map(|entry| (entry.participant_id.as_str(), entry.window.as_ref()))
        .collect::<BTreeMap<_, _>>();
    let participants_without_window = resolved
        .iter()
        .filter_map(|(participant_id, window)| {
            window.is_none().then_some((*participant_id).to_string())
        })
        .collect::<Vec<_>>();
    let before = rows.len();
    let rows = rows
        .into_iter()
        .filter(|row| window_keeps_day(&resolved, &row.participant_id, &row.date))
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(rows.len());
    (rows, dropped, participants_without_window)
}

pub(crate) fn device_number(participant_id: &str) -> u32 {
    participant_id
        .find("-D")
        .and_then(|index| {
            let digits: String = participant_id[index + 2..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            (!digits.is_empty()).then_some(digits)
        })
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(1)
}

pub(crate) fn sharing_status_for(
    participant_id: &str,
    sharing: &[SharingEntry],
) -> Result<SharingStatus, String> {
    if let Some(entry) = sharing
        .iter()
        .find(|entry| entry.participant_id == participant_id)
    {
        return Ok(entry.status);
    }
    let numerical = numerical_id(participant_id);
    if let Some(wanted_id) = numerical {
        let wanted_device = device_number(participant_id);
        if let Some(entry) = sharing.iter().find(|entry| {
            numerical_id(&entry.participant_id) == Some(wanted_id)
                && device_number(&entry.participant_id) == wanted_device
        }) {
            return Ok(entry.status);
        }
    }
    Err(format!(
        "Person attribution: no device-sharing status for {participant_id:?} (numerical={}). The sharing table must cover every device when it is configured.",
        numerical.unwrap_or("none")
    ))
}

pub(crate) fn is_null_username(username: &str) -> bool {
    username.is_empty() || username == "nan"
}

pub(crate) fn is_target_child(username: &str) -> bool {
    username.to_ascii_lowercase().contains("target child")
}

pub(crate) fn attribute_person(
    mut rows: Vec<Row>,
    resolution: &SharingResolution,
    survey: &BTreeMap<(String, i64), String>,
) -> Result<(Vec<Row>, AttributionReport), String> {
    let mut report = AttributionReport {
        shared_participants: resolution.shared_participants.clone(),
        non_shared_participants: resolution.non_shared_participants.clone(),
        survey_relabels: 0,
        non_target_rows: 0,
        kids_shell_attributions: 0,
        null_usernames_filled: 0,
    };
    for row in &mut rows {
        let status = *resolution
            .status_by_participant
            .get(row.participant_id.as_str())
            .ok_or_else(|| {
                format!(
                    "Person attribution: unresolved sharing status for {:?}",
                    row.participant_id
                )
            })?;
        match status {
            SharingStatus::NonShared => {
                if is_null_username(&row.username) {
                    row.username = "Target Child".into();
                    report.null_usernames_filled += 1;
                }
            }
            SharingStatus::Shared => {
                if is_null_username(&row.username) {
                    row.username = if KIDS_SHELL_PACKAGES.contains(&row.app_package_name.as_str()) {
                        report.kids_shell_attributions += 1;
                        "Target Child".into()
                    } else {
                        "None".into()
                    };
                    report.null_usernames_filled += 1;
                }
                if let Some(user) =
                    survey.get(&(row.participant_id.to_string(), row.event_timestamp_ns))
                {
                    row.username = format!("{user} (From Survey)").into();
                    report.survey_relabels += 1;
                }
                if row.interaction_type == APP_USAGE && !is_target_child(&row.username) {
                    row.interaction_type = NON_TARGET_CHILD_APP_USAGE.into();
                    report.non_target_rows += 1;
                }
            }
        }
    }
    Ok((rows, report))
}

pub(crate) fn window_for<'a>(participant_id: &str, windows: &'a [StudyWindow]) -> Option<&'a StudyWindow> {
    windows
        .iter()
        .find(|window| window.participant_id == participant_id)
        .or_else(|| {
            let id = numerical_id(participant_id)?;
            windows
                .iter()
                .find(|window| numerical_id(&window.participant_id) == Some(id))
        })
}

pub(crate) fn inclusive_dates(start: &str, end: &str) -> Result<Vec<String>, String> {
    let mut current = NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|error| format!("invalid coverage start date: {error}"))?;
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .map_err(|error| format!("invalid coverage end date: {error}"))?;
    let mut dates = Vec::new();
    while current <= end {
        dates.push(current.format("%Y-%m-%d").to_string());
        current = current
            .checked_add_signed(Duration::days(1))
            .ok_or("coverage date range overflow")?;
    }
    Ok(dates)
}

pub(crate) fn index_raw_dates(raw_rows: &[Row]) -> BTreeMap<String, BTreeSet<String>> {
    let mut raw_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in raw_rows {
        raw_dates
            .entry(if row.participant_id.is_empty() {
                "unknown".into()
            } else {
                row.participant_id.to_string()
            })
            .or_default()
            .insert(row.date.to_string());
    }
    raw_dates
}

pub(crate) fn build_day_coverage_csv(
    usage_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    windows: &[StudyWindow],
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let output = attribution::build_coverage(usage_rows, raw_dates, windows)?;
    query_checkpoints.value("build_participant_day_coverage", &output.report)?;
    Ok((output.csv_bytes, output.report.coverage.len() as u32))
}

pub(crate) fn build_compliance_csv(
    rows: &[Row],
    shared_participants: &BTreeSet<String>,
    threshold_percent: f64,
    enrolled_devices: &BTreeMap<String, u32>,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let attribution = attribution::accumulate_minutes(rows);
    query_checkpoints.value("aggregate_attribution_minutes", &attribution.checkpoint_payload())?;
    let completeness =
        attribution::compute_attribution_completeness(&attribution, shared_participants);
    query_checkpoints.value("compute_attribution_completeness", &completeness)?;
    let result = attribution::apply_compliance_threshold(&completeness, threshold_percent);
    query_checkpoints.value("classify_compliance_days", &result)?;
    let bytes = output::compliance_csv(&result, enrolled_devices);
    let row_count = result.days.len() as u32;
    Ok((bytes, row_count))
}

pub(crate) fn resolve_windows(
    rows: &[Row],
    windows: &[StudyWindow],
) -> Vec<ResolvedParticipantWindow> {
    resolve_participant_windows(rows, windows)
}



pub(crate) fn resolve_sharing(
    rows: &[Row],
    enabled: bool,
    sharing: &[SharingEntry],
) -> Result<SharingResolutionValue, String> {
    if !enabled {
        return Ok(SharingResolutionValue::Disabled);
    }
    if sharing.is_empty() {
        return Err("Device sharing file is required when person attribution is enabled".into());
    }
    Ok(SharingResolutionValue::Enabled(sharing_partition(rows, sharing)?))
}



pub(crate) fn synthesize_placeholder_rows(
    rows: Arc<Vec<Row>>,
    raw_rows: &[Row],
    enabled: bool,
    windows: Option<&[ResolvedParticipantWindow]>,
) -> Arc<Vec<Row>> {
    if enabled {
        Arc::new(add_no_activity_placeholder_rows((*rows).clone(), raw_rows, windows))
    } else {
        rows
    }
}

pub(crate) fn build_coverage(
    usage_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    windows: &[StudyWindow],
) -> Result<CoverageOutput, String> {
    let mut usage_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in usage_rows {
        if row.interaction_type == APP_USAGE
            && row.minimum_duration_aggregate_eligible
            && row.duration_minutes.is_some_and(|value| value > 0.0)
        {
            usage_dates
                .entry(row.participant_id.to_string())
                .or_default()
                .insert(row.date.to_string());
        }
    }
    let participants = raw_dates
        .keys()
        .chain(usage_dates.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut lines = vec!["participant_id,date,status".to_string()];
    let mut coverage = Vec::new();
    for participant_id in participants {
        let raw = raw_dates.get(&participant_id).cloned().unwrap_or_default();
        let used = usage_dates
            .get(&participant_id)
            .cloned()
            .unwrap_or_default();
        let all_dates = raw.union(&used).cloned().collect::<BTreeSet<_>>();
        let window = if windows.is_empty() {
            None
        } else {
            window_for(&participant_id, windows)
        };
        let spine = if let Some(window) = window {
            inclusive_dates(&window.start_date, &window.end_date)?
                .into_iter()
                .filter(|date| !study_window_excludes_date(window, date))
                .collect()
        } else if let (Some(start), Some(end)) = (all_dates.first(), all_dates.last()) {
            inclusive_dates(start, end)?
        } else {
            Vec::new()
        };
        for date in &spine {
            let status = if used.contains(date) {
                "usage"
            } else if raw.contains(date) {
                "no_activity"
            } else {
                "no_data"
            };
            lines.push(format!(
                "{},{date},{status}",
                csv_escape_value(&participant_id)
            ));
            coverage.push(CoverageDayCheckpoint {
                participant_id: participant_id.clone(),
                date: date.clone(),
                status: status.to_string(),
            });
        }
        for date in all_dates {
            if window.is_some_and(|window| {
                date < window.start_date
                    || date > window.end_date
                    || study_window_excludes_date(window, &date)
            }) {
                continue;
            }
            if !spine.contains(&date) {
                return Err(format!(
                    "Day coverage: {participant_id} has data on {date} but the day spine does not cover it."
                ));
            }
        }
    }
    let report = DayCoverageCheckpoint {
        usage_days: coverage.iter().filter(|day| day.status == "usage").count(),
        no_activity_days: coverage
            .iter()
            .filter(|day| day.status == "no_activity")
            .count(),
        no_data_days: coverage
            .iter()
            .filter(|day| day.status == "no_data")
            .count(),
        coverage,
    };
    Ok(CoverageOutput {
        csv_bytes: lines.join("\n").into_bytes(),
        report,
    })
}

pub(crate) fn accumulate_minutes(rows: &[Row]) -> AttributionMinutes {
    let mut participants_seen = BTreeMap::<String, BTreeSet<String>>::new();
    let mut buckets = BTreeMap::<(String, String), (f64, f64)>::new();
    for row in rows {
        participants_seen
            .entry(row.participant_id.to_string())
            .or_default()
            .insert(row.date.to_string());
        if row.interaction_type != APP_USAGE && row.interaction_type != NON_TARGET_CHILD_APP_USAGE {
            continue;
        }
        if !row.minimum_duration_aggregate_eligible {
            continue;
        }
        let minutes = row.duration_minutes.unwrap_or(0.0);
        let bucket = buckets
            .entry((row.participant_id.to_string(), row.date.to_string()))
            .or_default();
        if is_null_username(&row.username) || row.username == "None" {
            bucket.1 += minutes;
        } else {
            bucket.0 += minutes;
        }
    }
    AttributionMinutes {
        participants_seen,
        buckets,
    }
}

pub(crate) fn compute_attribution_completeness(
    attribution: &AttributionMinutes,
    shared_participants: &BTreeSet<String>,
) -> AttributionCompleteness {
    let mut days = Vec::new();
    for (participant_id, dates) in &attribution.participants_seen {
        let shared = shared_participants.contains(participant_id);
        for date in dates {
            let (known, unknown) = attribution
                .buckets
                .get(&(participant_id.clone(), date.clone()))
                .copied()
                .unwrap_or_default();
            let total = known + unknown;
            let compliance = if !shared || total <= 0.0 {
                100.0
            } else {
                ((known / total) * 10_000.0).round() / 100.0
            };
            days.push(AttributionCompletenessDay {
                participant_id: participant_id.clone(),
                date: date.clone(),
                sharing_status: if shared { "Shared" } else { "Non-Shared" }.to_string(),
                known_minutes: (known * 100.0).round() / 100.0,
                unknown_minutes: (unknown * 100.0).round() / 100.0,
                compliance_percent: compliance,
                zero_real_usage: total <= 0.0,
            });
        }
    }
    AttributionCompleteness {
        zero_usage_days: days.iter().filter(|day| day.zero_real_usage).count(),
        days,
    }
}

pub(crate) fn apply_compliance_threshold(
    completeness: &AttributionCompleteness,
    threshold_percent: f64,
) -> ComplianceResultCheckpoint {
    let days = completeness
        .days
        .iter()
        .map(|day| ComplianceDayCheckpoint {
            participant_id: day.participant_id.clone(),
            date: day.date.clone(),
            sharing_status: day.sharing_status.clone(),
            known_minutes: day.known_minutes,
            unknown_minutes: day.unknown_minutes,
            compliance_percent: day.compliance_percent,
            zero_real_usage: day.zero_real_usage,
            is_valid: day.compliance_percent >= threshold_percent,
        })
        .collect::<Vec<_>>();
    ComplianceResultCheckpoint {
        valid_days: days.iter().filter(|day| day.is_valid).count(),
        invalid_days: days.iter().filter(|day| !day.is_valid).count(),
        zero_usage_days: completeness.zero_usage_days,
        days,
    }
}

pub(crate) fn disabled_window_participants(resolved: &[ResolvedParticipantWindow]) -> Vec<String> {
    let mut participants = resolved
        .iter()
        .filter_map(|entry| entry.window.is_none().then_some(entry.participant_id.clone()))
        .collect::<Vec<_>>();
    participants.sort();
    participants
}

pub(crate) fn window_metadata(
    applied: bool,
    dropped_rows: usize,
    participants: &[String],
) -> serde_json::Value {
    serde_json::json!({
        "applied": applied,
        "droppedRows": dropped_rows,
        "participantsWithoutWindow": participants,
    })
}

pub(crate) fn survey_checkpoint_payload(survey: &SurveyLookup) -> Vec<serde_json::Value> {
    survey.iter().map(|((participant_id, event_timestamp_ns), user)| {
        serde_json::json!({
            "participantId": participant_id,
            "eventTimestampNs": event_timestamp_ns,
            "user": user,
        })
    }).collect()
}

pub(crate) fn attribution_checkpoint_payload(
    report: Option<&AttributionReport>,
) -> serde_json::Value {
    match report {
        Some(report) => serde_json::json!({"applied": true, "report": report}),
        None => serde_json::json!({"applied": false}),
    }
}

impl AttributionMinutes {
    pub(crate) fn checkpoint_payload(&self) -> serde_json::Value {
        let buckets = self.buckets.iter().map(
            |((participant_id, date), (known_minutes, unknown_minutes))| {
                serde_json::json!({
                    "participantId": participant_id,
                    "date": date,
                    "knownMinutes": known_minutes,
                    "unknownMinutes": unknown_minutes,
                })
            },
        ).collect::<Vec<_>>();
        serde_json::json!({"participantsSeen": &self.participants_seen, "buckets": buckets})
    }
}

pub(crate) fn sharing_partition(
    rows: &[Row],
    sharing: &[SharingEntry],
) -> Result<SharingResolution, String> {
    let mut statuses = BTreeMap::new();
    for participant_id in rows.iter().map(|row| &row.participant_id) {
        if statuses.contains_key(participant_id.as_str()) {
            continue;
        }
        statuses.insert(
            participant_id.to_string(),
            sharing_status_for(participant_id.as_str(), sharing)?,
        );
    }
    Ok(SharingResolution {
        shared_participants: statuses
            .iter()
            .filter_map(|(participant_id, status)| {
                (*status == SharingStatus::Shared).then_some(participant_id.clone())
            })
            .collect(),
        non_shared_participants: statuses
            .iter()
            .filter_map(|(participant_id, status)| {
                (*status == SharingStatus::NonShared).then_some(participant_id.clone())
            })
            .collect(),
        status_by_participant: statuses,
    })
}
