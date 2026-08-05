//! Pure product transformations shared by the cold sequential executor and
//! the tracked incremental executor. This module contains Chronicle logic,
//! not a generic graph abstraction.

use super::*;

pub(super) fn validate_remap_rules(entries: &[String]) -> BTreeMap<String, String> {
    entries
        .iter()
        .filter_map(|entry| {
            let (from, to) = entry.split_once("=>")?;
            let from = from.trim();
            let to = to.trim();
            if from.is_empty() || to.is_empty() {
                None
            } else {
                Some((from.to_string(), to.to_string()))
            }
        })
        .collect()
}

pub(super) fn decode_source_records(csv_bytes: &[u8]) -> Vec<RawRow> {
    let mut terminated = Vec::new();
    let csv_bytes = if csv_bytes.ends_with(b"\n") {
        csv_bytes
    } else {
        terminated.reserve(csv_bytes.len() + 1);
        terminated.extend_from_slice(csv_bytes);
        terminated.push(b'\n');
        &terminated
    };
    let mut reader = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = csv_bytes;
    // csv-core consumes the input it wrote before reporting OutputFull, so the
    // bytes already in `field_buf` are the only copy of the front of a long
    // cell. Carry them across the resize; dropping them truncated every raw
    // value longer than the buffer to its tail.
    let mut carried: Vec<u8> = Vec::new();
    fn take_field(carried: &mut Vec<u8>, field_buf: &[u8]) -> String {
        if carried.is_empty() {
            return String::from_utf8_lossy(field_buf).into_owned();
        }
        carried.extend_from_slice(field_buf);
        let value = String::from_utf8_lossy(carried).into_owned();
        carried.clear();
        value
    }

    let mut headers = Vec::new();
    loop {
        let (result, consumed, produced) = reader.read_field(input, &mut field_buf);
        input = &input[consumed..];
        match result {
            ReadFieldResult::InputEmpty => continue,
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..produced]);
                field_buf.resize(field_buf.len() * 2, 0);
            }
            ReadFieldResult::Field { record_end } => {
                headers.push(take_field(&mut carried, &field_buf[..produced]));
                if record_end {
                    break;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let column_indices = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (header.as_str(), index))
        .collect::<HashMap<_, _>>();
    let event = column_indices.get("event_timestamp").copied();
    let timezone = column_indices.get("timezone").copied();
    let package = column_indices.get("app_package_name").copied();
    let interaction = column_indices.get("interaction_type").copied();
    let label = column_indices.get("application_label").copied();
    let study = column_indices.get("study_id").copied();
    let participant = column_indices.get("participant_id").copied();
    let username = column_indices.get("username").copied();

    let mut row_values = vec![String::new(); headers.len()];
    let mut column_index = 0;
    let mut data_row_number = 0_u32;
    // One newline per record; pre-sizing avoids repeated reallocation of a
    // vector that reaches ~200 bytes per row on real exports.
    let estimated_rows = input.iter().filter(|&&byte| byte == b'\n').count();
    let mut raw_rows = Vec::with_capacity(estimated_rows.min(4_000_000));
    loop {
        let (result, consumed, produced) = reader.read_field(input, &mut field_buf);
        input = &input[consumed..];
        match result {
            ReadFieldResult::InputEmpty => continue,
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..produced]);
                field_buf.resize(field_buf.len() * 2, 0);
            }
            ReadFieldResult::Field { record_end } => {
                let value = take_field(&mut carried, &field_buf[..produced]);
                if column_index < row_values.len() {
                    row_values[column_index].clear();
                    row_values[column_index].push_str(&value);
                }
                column_index += 1;
                if record_end {
                    data_row_number += 1;
                    let get = |slot: Option<usize>| -> &str {
                        slot.and_then(|index| row_values.get(index))
                            .map(String::as_str)
                            .unwrap_or("")
                    };
                    raw_rows.push(RawRow {
                        source_data_row: data_row_number,
                        event_timestamp: get(event).trim().to_string(),
                        timezone: get(timezone).trim().to_string(),
                        app_package_name: get(package).trim().to_string(),
                        interaction_type: get(interaction).trim().to_string(),
                        application_label: get(label).trim().to_string(),
                        study_id: get(study).trim().to_string(),
                        participant_id: get(participant).trim().to_string(),
                        username: get(username).trim().to_string(),
                    });
                    for value in &mut row_values {
                        value.clear();
                    }
                    column_index = 0;
                }
            }
            ReadFieldResult::End => break,
        }
    }
    raw_rows
}

pub(super) fn remove_missing_timestamps(raw_rows: Vec<RawRow>) -> Vec<RawRow> {
    raw_rows
        .into_iter()
        .filter(|row| !row.event_timestamp.is_empty())
        .collect()
}

pub(super) fn attach_device_models(raw_rows: &[RawRow]) -> String {
    if raw_rows.iter().any(|row| {
        AMAZON_APPS
            .iter()
            .any(|package| row.app_package_name.contains(package))
    }) {
        "Amazon Fire".to_string()
    } else {
        "Android".to_string()
    }
}

pub(super) fn bind_processing_timestamp(value: &str) -> String {
    value.to_string()
}

pub(super) fn canonicalize_source_rows(
    raw_rows: &[RawRow],
    fallback_timezone: &str,
    interaction_remap: &BTreeMap<String, String>,
    possible_device_model: &str,
) -> Result<Vec<Row>, String> {
    let fallback: Tz = fallback_timezone
        .parse()
        .map_err(|error| format!("tz {fallback_timezone}: {error}"))?;
    let mut strings = SharedStringPool::default();
    let possible_device_model = strings.intern(possible_device_model);
    let empty_usage_flags = strings.intern("[]");
    let mut date_memo = LocalDateMemo::default();
    raw_rows
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            // PHI safety: raw cell values must never enter error strings
            // surfaced to the UI/console — report the row position instead.
            let event_timestamp_ns = parse_chronicle_timestamp_ns(&raw.event_timestamp)
                .ok_or_else(|| {
                    format!(
                        "Invalid event_timestamp at data row {}",
                        raw.source_data_row
                    )
                })?;
            // Blank and literal "None" timezone cells are both documented
            // missing-timezone shapes; keep this in lockstep with
            // discover_timezones_v2_native and inspect_raw_file_v1.
            let timezone = if raw.timezone.is_empty() || raw.timezone == "None" {
                "UTC"
            } else {
                raw.timezone.as_str()
            };
            let interaction_type = match interaction_remap.get(&raw.interaction_type) {
                Some(mapped) => mapped.as_str(),
                None => normalize_interaction_type_local(&raw.interaction_type),
            };
            let mut row = Row::new(RowData {
                source_data_rows: SourceDataRows::single(raw.source_data_row),
                lineage_searches: empty_lineage_searches(),
                study_id: strings.intern(&raw.study_id),
                participant_id: strings.intern(&raw.participant_id),
                possible_device_model: possible_device_model.clone(),
                username: if raw.username.contains("Target child") {
                    strings.intern_owned(raw.username.replace("Target child", "Target Child"))
                } else {
                    strings.intern(&raw.username)
                },
                application_label: strings.intern(&raw.application_label),
                interaction_type: strings.intern(interaction_type),
                app_package_name: strings.intern(&raw.app_package_name),
                event_timestamp_ns,
                timezone: strings.intern(timezone),
                data_time_gap_hours: 0.0,
                date: SharedString::default(),
                day: 0,
                weekday_mf: 0,
                weekday_mth: 0,
                weekday_su_th: 0,
                hour: 0,
                quarter: 0,
                start_timestamp_ns: None,
                stop_timestamp_ns: None,
                duration_seconds: None,
                duration_minutes: None,
                screen_usage_end_reason: None,
                screen_usage_end_reason_confidence: None,
                screen_usage_stop_event_type: None,
                screen_usage_last_activity_timestamp_ns: None,
                screen_usage_tail_gap_seconds: None,
                screen_usage_foreground_app_package: None,
                screen_usage_apps_forcing_screen_open_label: None,
                screen_usage_lock_screen_only: None,
                any_app_usage_flags: empty_usage_flags.clone(),
                valid_app_new_engage_30s: 0,
                valid_app_new_engage_custom: 0,
                valid_app_switched_app: 0,
                valid_app_usage_time_gap_hours: 0.0,
                any_app_new_engage_30s: 0,
                any_app_new_engage_custom: 0,
                any_app_switched_app: 0,
                any_app_usage_time_gap_hours: 0.0,
                genre_id_scraped: None,
                broad_app_category: None,
                codebook_fields: empty_codebook_fields(),
                codebook_genre_fields_cleared: false,
                index,
                usage_layer: None,
            });
            let row_timezone = row.timezone.parse().unwrap_or(fallback);
            populate_time_columns(&mut row, row_timezone, &mut date_memo);
            row.date = strings.intern(row.date.as_str());
            Ok(row)
        })
        .collect()
}

pub(super) fn order_source_records(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    rows
}

fn rows_are_event_ordered(rows: &[Row]) -> bool {
    rows.windows(2).all(|pair| {
        pair[0]
            .event_timestamp_ns
            .cmp(&pair[1].event_timestamp_ns)
            .then(pair[0].index.cmp(&pair[1].index))
            .is_le()
    })
}

fn rows_have_strictly_increasing_timestamps(rows: &[Row]) -> bool {
    rows.windows(2)
        .all(|pair| pair[0].event_timestamp_ns < pair[1].event_timestamp_ns)
}

pub(super) fn collect_timezone_observations(rows: &[Row]) -> BTreeSet<String> {
    // Row timezones repeat heavily; dedupe on the shared &str before
    // allocating one String per unique zone.
    let mut unique = AHashSet::<&str>::new();
    rows.iter()
        .filter(|row| unique.insert(row.timezone.as_str()))
        .map(|row| row.timezone.to_string())
        .collect()
}

pub(super) fn estimate_dominant_timezone(rows: &[Row]) -> String {
    let mut counts = AHashMap::<&str, usize>::new();
    let mut primary = "UTC";
    let mut primary_count = 0;
    for row in rows {
        if row.timezone.is_empty() {
            continue;
        }
        let count = counts.entry(row.timezone.as_str()).or_default();
        *count += 1;
        if *count > primary_count {
            primary = row.timezone.as_str();
            primary_count = *count;
        }
    }
    primary.to_string()
}

pub(super) struct TimezoneSelection {
    pub rows: Arc<Vec<Row>>,
    pub target_timezone: String,
    pub action: &'static str,
}

pub(super) fn resolve_timezone_strategy(
    mut rows: Arc<Vec<Row>>,
    selected_timezone: &str,
    handling: &str,
    primary_timezone: &str,
) -> Result<TimezoneSelection, String> {
    let (target_timezone, action) = match handling {
        "selected-filter" => {
            if selected_timezone.trim().is_empty() {
                return Err("selected timezone is required for selected-filter".into());
            }
            if rows.iter().any(|row| row.timezone != selected_timezone) {
                let mut filtered = (*rows).clone();
                filtered.retain(|row| row.timezone == selected_timezone);
                rows = Arc::new(filtered);
            }
            if rows.is_empty() {
                return Err(format!(
                    "selected timezone {selected_timezone} is not present in the input; filtering would remove all rows"
                ));
            }
            (selected_timezone.to_string(), "filtered_to_selected")
        }
        "selected-convert" => {
            if selected_timezone.trim().is_empty() {
                return Err("selected timezone is required for selected-convert".into());
            }
            (selected_timezone.to_string(), "converted_to_selected")
        }
        "primary-filter" => {
            if rows.iter().any(|row| row.timezone != primary_timezone) {
                let mut filtered = (*rows).clone();
                filtered.retain(|row| row.timezone == primary_timezone);
                rows = Arc::new(filtered);
            }
            (primary_timezone.to_string(), "filtered_to_primary")
        }
        "primary-convert" => (primary_timezone.to_string(), "converted_to_primary"),
        other => return Err(format!("unsupported timezone handling: {other}")),
    };
    Ok(TimezoneSelection {
        rows,
        target_timezone,
        action,
    })
}

pub(super) fn standardize_event_clock(
    mut rows: Vec<Row>,
    target_timezone: &str,
) -> Result<Vec<Row>, String> {
    let timezone: Tz = target_timezone
        .parse()
        .map_err(|error| format!("tz: {error}"))?;
    let mut strings = SharedStringPool::default();
    let target_timezone = strings.intern(target_timezone);
    let mut date_memo = LocalDateMemo::default();
    for row in &mut rows {
        if row.timezone == target_timezone {
            continue;
        }
        row.edit_temporal().timezone = target_timezone.clone();
        populate_time_columns(row, timezone, &mut date_memo);
        let date = strings.intern(row.date.as_str());
        row.edit_temporal().date = date;
    }
    Ok(rows)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RowCountReport {
    pub before: u32,
    pub after: u32,
    pub removed: u32,
}

pub(super) fn summarize_row_selection(before: u32, after: u32) -> RowCountReport {
    RowCountReport {
        before,
        after,
        removed: before.saturating_sub(after),
    }
}

pub(super) fn coalesce_duplicate_event_keys(rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    if enabled {
        dedupe_exact_rows(rows)
    } else {
        rows
    }
}

pub(super) fn disambiguate_duplicate_timestamps(
    rows: Vec<Row>,
    enabled: bool,
    same_app_stop_types: &[String],
    other_stop_types: &[String],
) -> Vec<Row> {
    if !enabled {
        return rows;
    }
    unalign_duplicate_timestamps(rows, same_app_stop_types, other_stop_types)
}

pub(super) fn mark_gaps(rows: Vec<Row>) -> Vec<Row> {
    derive_time_gap_evidence(rows)
}

pub(super) fn mark_app_policy_matches(
    rows: Vec<Row>,
    enabled: bool,
    filter_map: &HashMap<String, AHashSet<String>>,
) -> Vec<Row> {
    if enabled {
        label_filtered_apps(rows, filter_map)
    } else {
        rows
    }
}

pub(super) fn resolve_excluded_packages(rows: &[Row]) -> BTreeSet<String> {
    rows.iter()
        .filter(|row| {
            matches!(
                row.interaction_type.as_str(),
                FILTERED_RESUMED
                    | FILTERED_PAUSED
                    | FILTERED_STOPPED
                    | "Filtered App Destroyed"
                    | FILTERED_APP_USAGE
                    | FILTERED_APP_BACKGROUND_USAGE
            )
        })
        .map(|row| row.app_package_name.to_string())
        .collect()
}

pub(super) fn mask_excluded_app_events(mut rows: Vec<Row>) -> Vec<Row> {
    for row in &mut rows {
        let replacement = match row.interaction_type.as_str() {
            FILTERED_RESUMED => Some(ACTIVITY_RESUMED),
            FILTERED_PAUSED => Some(ACTIVITY_PAUSED),
            FILTERED_STOPPED => Some(ACTIVITY_STOPPED),
            "Filtered App Destroyed" => Some("Activity Destroyed"),
            _ => None,
        };
        if let Some(replacement) = replacement {
            row.edit_classification().interaction_type = replacement.into();
        }
    }
    rows
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MatcherInput {
    pub app_codes: Vec<i32>,
    pub timestamps: Vec<i64>,
    pub resumed: Vec<bool>,
    pub same_stop: Vec<bool>,
    pub other_stop: Vec<bool>,
    pub stopped: Vec<bool>,
    pub background: Vec<bool>,
}

pub(super) fn build_app_event_index(
    rows: &[Row],
    same_stop_types: &[String],
    other_stop_types: &[String],
    background_apps: &AHashSet<String>,
    model_concurrent_usage: bool,
) -> Result<MatcherInput, String> {
    if !rows.iter().any(|row| {
        row.interaction_type == ACTIVITY_RESUMED || row.interaction_type == ACTIVITY_PAUSED
    }) {
        return Err("No valid app usage data during the study period".to_string());
    }
    let same_stop_types = same_stop_types
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    let other_stop_types = other_stop_types
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    let mut resumed = Vec::with_capacity(rows.len());
    let mut same_stop = Vec::with_capacity(rows.len());
    let mut other_stop = Vec::with_capacity(rows.len());
    let mut stopped = Vec::with_capacity(rows.len());
    let mut background = Vec::with_capacity(rows.len());
    let mut app_codes = Vec::with_capacity(rows.len());
    let mut timestamps = Vec::with_capacity(rows.len());
    let mut app_code_lookup: AHashMap<&str, i32> = AHashMap::new();
    for row in rows {
        let interaction = row.interaction_type.as_str();
        let package = row.app_package_name.as_str();
        let next_code = app_code_lookup.len() as i32;
        app_codes.push(*app_code_lookup.entry(package).or_insert(next_code));
        timestamps.push(row.event_timestamp_ns);
        let is_background = background_apps.contains(package);
        resumed.push(interaction == ACTIVITY_RESUMED);
        same_stop.push(if is_background {
            interaction == ACTIVITY_RESUMED || interaction == ACTIVITY_STOPPED
        } else {
            same_stop_types.contains(interaction)
        });
        other_stop.push(!model_concurrent_usage && other_stop_types.contains(interaction));
        stopped.push(!is_background && interaction == ACTIVITY_STOPPED);
        background.push(is_background);
    }
    Ok(MatcherInput {
        app_codes,
        timestamps,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    })
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MatcherOutput {
    pub start_indices: Vec<usize>,
    pub stop_start_indices: Vec<usize>,
    pub stop_event_indices: Vec<usize>,
    pub missing_indices: Vec<usize>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn match_app_episodes(
    input: &MatcherInput,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
    proximity_interval_ns: i64,
) -> Result<MatcherOutput, String> {
    let result = _rust_app_usage_matcher::match_app_usage_update_indices_with_proximity_core(
        &input.app_codes,
        &input.timestamps,
        &input.resumed,
        &input.same_stop,
        &input.other_stop,
        &input.stopped,
        &input.background,
        _rust_app_usage_matcher::MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
        proximity_interval_ns,
    )
    .map_err(|error| format!("matcher: {error}"))?;
    Ok(MatcherOutput {
        start_indices: result.start_indices,
        stop_start_indices: result.stop_start_indices,
        stop_event_indices: result.stop_event_indices,
        missing_indices: result.missing_indices,
    })
}

pub(super) fn materialize_candidate_episodes(
    rows: Vec<Row>,
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
) -> Vec<Row> {
    materialize_candidate_episodes_with_suffix(rows, result, filtered_packages, None)
}

fn materialize_candidate_episodes_with_suffix(
    mut rows: Vec<Row>,
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
    persisted_suffix_digests: Option<&[InlineLineageDigest]>,
) -> Vec<Row> {
    materialize_candidate_episodes_in_place(
        &mut rows,
        result,
        filtered_packages,
        persisted_suffix_digests,
    );
    rows
}

fn materialize_candidate_episodes_in_place(
    rows: &mut [Row],
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
    persisted_suffix_digests: Option<&[InlineLineageDigest]>,
) {
    let computed_suffix_digests;
    let search_suffix_digests = if let Some(persisted) = persisted_suffix_digests {
        assert_eq!(
            persisted.len(),
            rows.len() + 1,
            "persisted lineage suffix count drift"
        );
        persisted
    } else {
        computed_suffix_digests = inline_lineage_search_suffix_digests(rows);
        &computed_suffix_digests
    };
    for &start_index in &result.start_indices {
        let event_timestamp_ns = rows[start_index].event_timestamp_ns;
        rows[start_index].edit_temporal().start_timestamp_ns = Some(event_timestamp_ns);
    }
    for (position, &start_index) in result.stop_start_indices.iter().enumerate() {
        let stop_index = result.stop_event_indices[position];
        let lower = start_index.min(stop_index);
        let upper = start_index.max(stop_index);
        let stop_source_rows = rows[stop_index].source_data_rows.clone();
        let search_start_event_index = (lower + 1) as u32;
        let search_end_event_index_exclusive = (upper + 1) as u32;
        let start_participant_id = rows[start_index].participant_id.shared();
        let identity = rows[start_index].edit_identity();
        identity.source_data_rows.merge(&stop_source_rows);
        Arc::make_mut(&mut identity.lineage_searches).push(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("selected-qualifying-stop"),
            index_space: shared_lineage_text("pipeline-event-order"),
            start_participant_id,
            start_event_index: search_start_event_index,
            end_event_index_exclusive: search_end_event_index_exclusive,
            candidate_event_count: search_end_event_index_exclusive
                .saturating_sub(search_start_event_index),
            candidate_chain_digest: inline_lineage_search_range_digest(
                search_suffix_digests,
                search_start_event_index,
                search_end_event_index_exclusive,
            ),
        });
        let stop_timestamp_ns = rows[stop_index].event_timestamp_ns;
        rows[start_index].edit_temporal().stop_timestamp_ns = Some(stop_timestamp_ns);
    }
    let search_end_event_index_exclusive = rows.len() as u32;
    for &index in &result.missing_indices {
        let row = &mut rows[index];
        let search_start_event_index = (index + 1) as u32;
        let start_participant_id = row.participant_id.shared();
        Arc::make_mut(&mut row.edit_identity().lineage_searches).push(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("no-qualifying-stop"),
            index_space: shared_lineage_text("pipeline-event-order"),
            start_participant_id,
            start_event_index: search_start_event_index,
            end_event_index_exclusive: search_end_event_index_exclusive,
            candidate_event_count: search_end_event_index_exclusive
                .saturating_sub(search_start_event_index),
            candidate_chain_digest: inline_lineage_search_range_digest(
                search_suffix_digests,
                search_start_event_index,
                search_end_event_index_exclusive,
            ),
        });
        row.edit_classification().interaction_type = END_OF_USAGE_MISSING.into();
        let temporal = row.edit_temporal();
        temporal.stop_timestamp_ns = None;
        temporal.duration_seconds = None;
        temporal.duration_minutes = None;
        if filtered_packages.contains(row.app_package_name.as_str()) {
            row.edit_temporal().start_timestamp_ns = None;
        }
    }
}

pub(super) fn classify_episode_durations(
    rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    minimum_usage_duration: f64,
) -> Vec<Row> {
    rows.into_iter()
        .filter(|row| row.interaction_type != ACTIVITY_PAUSED)
        .filter(|row| {
            row.interaction_type != ACTIVITY_RESUMED
                || (row.start_timestamp_ns.is_some() && row.stop_timestamp_ns.is_some())
        })
        .map(|mut row| {
            if row.interaction_type == ACTIVITY_RESUMED {
                let is_filtered = filtered_packages.contains(row.app_package_name.as_str());
                let interaction_type = if is_filtered {
                    FILTERED_APP_USAGE
                } else {
                    APP_USAGE
                }
                .into();
                row.edit_classification().interaction_type = interaction_type;
                if is_filtered {
                    let temporal = row.edit_temporal();
                    temporal.start_timestamp_ns = None;
                    temporal.stop_timestamp_ns = None;
                    temporal.duration_seconds = None;
                    temporal.duration_minutes = None;
                } else {
                    let start = row.start_timestamp_ns.expect("paired usage start");
                    let stop = row.stop_timestamp_ns.expect("paired usage stop");
                    let duration_seconds = (stop - start) as f64 / 1_000_000_000.0;
                    let temporal = row.edit_temporal();
                    if minimum_usage_duration > 0.0 && duration_seconds < minimum_usage_duration {
                        temporal.duration_seconds = None;
                        temporal.duration_minutes = None;
                    } else {
                        temporal.duration_seconds = Some(duration_seconds);
                        temporal.duration_minutes = Some(duration_seconds / 60.0);
                    }
                }
            }
            row
        })
        .collect()
}

pub(super) fn apply_app_inclusion_policy(
    mut rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    background_apps: &AHashSet<String>,
) -> Vec<Row> {
    for row in &mut rows {
        if !filtered_packages.contains(row.app_package_name.as_str()) {
            continue;
        }
        if row.interaction_type == APP_USAGE
            && background_apps.contains(row.app_package_name.as_str())
        {
            row.edit_classification().interaction_type = FILTERED_APP_BACKGROUND_USAGE.into();
            continue;
        }
        if row.interaction_type == APP_USAGE {
            row.edit_classification().interaction_type = FILTERED_APP_USAGE.into();
            let temporal = row.edit_temporal();
            temporal.duration_seconds = None;
            temporal.duration_minutes = None;
            continue;
        }
        if row.interaction_type == ACTIVITY_STOPPED {
            row.edit_classification().interaction_type = FILTERED_STOPPED.into();
        }
        let temporal = row.edit_temporal();
        temporal.start_timestamp_ns = None;
        temporal.stop_timestamp_ns = None;
        temporal.duration_seconds = None;
        temporal.duration_minutes = None;
    }
    rows
}

pub(super) fn order_app_episodes(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    rows
}

pub(super) fn segment_concurrent_usage(
    rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    background_apps: &AHashSet<String>,
    model_concurrent_usage: bool,
    minimum_usage_duration: f64,
    apply_minimum_to_subintervals: bool,
) -> Result<Vec<Row>, String> {
    if !model_concurrent_usage && background_apps.is_empty() {
        return Ok(order_app_episodes(rows));
    }
    let app_usage_indices = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| {
            row.interaction_type == APP_USAGE
                && !filtered_packages.contains(row.app_package_name.as_str())
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let starts = app_usage_indices
        .iter()
        .map(|&index| rows[index].start_timestamp_ns.unwrap_or(0))
        .collect::<Vec<_>>();
    let stops = app_usage_indices
        .iter()
        .map(|&index| rows[index].stop_timestamp_ns.unwrap_or(0))
        .collect::<Vec<_>>();
    let layered = split_overlapping_sessions(&starts, &stops)
        .map_err(|error| format!("split_overlapping_sessions: {error}"))?;
    let mut expanded = rows
        .iter()
        .filter(|row| {
            row.interaction_type != APP_USAGE
                || filtered_packages.contains(row.app_package_name.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    for layered_session in &layered {
        let source_index = app_usage_indices[layered_session.session_index];
        let mut row = rows[source_index].clone();
        let duration_seconds =
            (layered_session.stop_ns - layered_session.start_ns) as f64 / 1_000_000_000.0;
        let temporal = row.edit_temporal();
        temporal.start_timestamp_ns = Some(layered_session.start_ns);
        temporal.stop_timestamp_ns = Some(layered_session.stop_ns);
        if apply_minimum_to_subintervals
            && minimum_usage_duration > 0.0
            && duration_seconds < minimum_usage_duration
        {
            temporal.duration_seconds = None;
            temporal.duration_minutes = None;
        } else {
            temporal.duration_seconds = Some(duration_seconds);
            temporal.duration_minutes = Some(duration_seconds / 60.0);
        }
        row.edit_classification().usage_layer = Some(match layered_session.layer {
            UsageLayer::Primary => "primary".into(),
            UsageLayer::Secondary => "secondary".into(),
        });
        expanded.push(row);
    }
    Ok(order_app_episodes(expanded))
}

pub(super) fn derive_broad_category_step(mut rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    derive_broad_category(&mut rows, enabled);
    rows
}

pub(super) fn collapse_app_genre_step(mut rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    collapse_app_genre(&mut rows, enabled);
    rows
}

pub(super) fn derive_engagement_basis(
    mut rows: Vec<Row>,
    custom_app_engagement_duration: f64,
) -> Vec<Row> {
    add_app_usage_detail_columns(&mut rows, custom_app_engagement_duration);
    rows
}

pub(super) fn apply_episode_flags(
    mut rows: Vec<Row>,
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) -> Vec<Row> {
    mark_app_usage_flags(
        &mut rows,
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    rows
}

pub(super) fn suppress_excluded_timing(mut rows: Vec<Row>) -> Vec<Row> {
    clear_filtered_usage_timing(&mut rows);
    rows
}

pub(super) fn remove_selected_interaction_types(
    rows: Vec<Row>,
    interaction_types_to_remove: &[String],
    long_data_time_gap_thresholds: &[f64],
) -> Vec<Row> {
    if interaction_types_to_remove.is_empty() {
        return rows;
    }
    let threshold = long_data_time_gap_thresholds
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let remove_set = interaction_types_to_remove
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    rows.into_iter()
        .filter(|row| {
            !remove_set.contains(row.interaction_type.as_str())
                || row.data_time_gap_hours >= threshold
        })
        .collect()
}

pub(super) fn remove_zero_duration_rows(rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    if !enabled {
        return rows;
    }
    rows.into_iter()
        .filter(|row| {
            row.interaction_type != APP_USAGE
                || row.duration_seconds.is_none_or(|duration| duration > 0.0)
        })
        .collect()
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditPartition {
    pub sessions: Vec<Row>,
    pub rest: Vec<Row>,
    pub session_rows_digest: String,
    pub rest_rows_digest: String,
}

pub(super) fn identify_credit_eligible_sessions(
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

pub(super) fn build_activity_witness_indexes(
    raw_events: &[Row],
) -> Result<ScreenCreditSubstrate, String> {
    build_screen_credit_substrate(raw_events)
}

pub(super) fn screen_incapable_participants(
    partition: &CreditPartition,
    substrate: &ScreenCreditSubstrate,
) -> Vec<String> {
    let mut screen_incapable = Vec::new();
    let mut seen = AHashSet::new();
    for row in &partition.sessions {
        let incapable = substrate
            .points
            .get(row.participant_id.as_str())
            .is_none_or(Vec::is_empty)
            || !substrate.capable.contains(row.participant_id.as_str());
        if incapable && seen.insert(row.participant_id.to_string()) {
            screen_incapable.push(row.participant_id.to_string());
        }
    }
    screen_incapable
}

pub(super) type DayApps = BTreeMap<(String, String), BTreeSet<String>>;

pub(super) fn summarize_daily_apps(partition: &CreditPartition) -> DayApps {
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
pub(super) fn derive_credited_intervals(
    partition: &CreditPartition,
    substrate: &ScreenCreditSubstrate,
    day_apps: &DayApps,
    credited_session_cap_minutes: f64,
    device_liveness_gap_tolerance_minutes: f64,
    auto_lock_bridge_seconds: f64,
    no_witness_min_day_apps: u32,
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
            let points = substrate
                .points
                .get(row.participant_id.as_str())
                .map(Vec::as_slice)
                .unwrap_or_default();
            let (intervals, no_witness_fallback) = if points.is_empty()
                || !substrate.capable.contains(row.participant_id.as_str())
            {
                (vec![(start, end)], false)
            } else {
                let participant_alive_spans = alive_spans
                    .get(row.participant_id.as_str())
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let alive = clip_alive_spans(participant_alive_spans, start, end);
                let first_in_window = points.partition_point(|point| point.timestamp_ns < start);
                let has_point = points
                    .get(first_in_window)
                    .is_some_and(|point| point.timestamp_ns <= end);
                if screen_state_at(points, start).is_none() && !has_point {
                    let app_count = day_apps
                        .get(&(row.participant_id.to_string(), row.date.to_string()))
                        .map(BTreeSet::len)
                        .unwrap_or_default();
                    if app_count >= no_witness_min_day_apps as usize {
                        (alive, true)
                    } else {
                        (Vec::new(), false)
                    }
                } else {
                    let screen = creditable_intervals(points, start, end, auto_lock_ns);
                    (intersect_intervals(&screen, &alive), false)
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditEmission {
    pub credited: Vec<Row>,
    pub counts: CreditEmissionCounts,
    pub credited_rows_digest: String,
}

pub(super) fn materialize_credited_rows(
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
                &credited_row.participant_id,
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditResult {
    pub rows: Vec<Row>,
    pub credited_rows_digest: String,
    pub rest_rows_digest: String,
    pub report: CreditReportOwned,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreditReportOwned {
    pub sessions: usize,
    pub credited_rows: usize,
    pub credited_minutes: f64,
    pub raw_session_minutes: f64,
    pub truncated_sessions: usize,
    pub fully_dead_sessions: usize,
    pub no_witness_fallbacks: usize,
    pub screen_incapable_participants: Vec<String>,
}

pub(super) fn assemble_credit_outputs(
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

pub(super) fn resolve_windows(
    rows: &[Row],
    windows: &[StudyWindow],
) -> Vec<ResolvedParticipantWindow> {
    resolve_participant_windows(rows, windows)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct WindowedRows {
    pub rows: Arc<Vec<Row>>,
    pub dropped_rows: usize,
    pub participants_without_window: Vec<String>,
    pub applied: bool,
}

pub(super) fn filter_to_window(
    rows: Arc<Vec<Row>>,
    resolved: &[ResolvedParticipantWindow],
    enabled: bool,
    windows: &[StudyWindow],
) -> Result<WindowedRows, String> {
    if enabled {
        if windows.is_empty() {
            return Err(
                "Study dates file is required when study-window filtering is enabled".into(),
            );
        }
        let (rows, dropped_rows, participants_without_window) =
            apply_study_window((*rows).clone(), resolved);
        Ok(WindowedRows {
            rows: Arc::new(rows),
            dropped_rows,
            participants_without_window,
            applied: true,
        })
    } else {
        let mut participants_without_window = resolved
            .iter()
            .filter_map(|entry| {
                entry
                    .window
                    .is_none()
                    .then_some(entry.participant_id.clone())
            })
            .collect::<Vec<_>>();
        participants_without_window.sort();
        Ok(WindowedRows {
            rows,
            dropped_rows: 0,
            participants_without_window,
            applied: false,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) enum SharingResolutionValue {
    Disabled,
    Enabled(SharingResolution),
}

pub(super) fn resolve_sharing(
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
    Ok(SharingResolutionValue::Enabled(SharingResolution {
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
    }))
}

pub(super) type SurveyLookup = BTreeMap<(String, i64), String>;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct AttributedRows {
    pub rows: Arc<Vec<Row>>,
    pub report: Option<AttributionReport>,
    pub shared_participants: BTreeSet<String>,
}

pub(super) fn classify_person_attribution(
    rows: Arc<Vec<Row>>,
    resolution: &SharingResolutionValue,
    survey: &SurveyLookup,
) -> Result<AttributedRows, String> {
    match resolution {
        SharingResolutionValue::Disabled => Ok(AttributedRows {
            rows,
            report: None,
            shared_participants: BTreeSet::new(),
        }),
        SharingResolutionValue::Enabled(resolution) => {
            let shared_participants = resolution
                .shared_participants
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>();
            let (rows, report) = attribute_person((*rows).clone(), resolution, survey)?;
            Ok(AttributedRows {
                rows: Arc::new(rows),
                report: Some(report),
                shared_participants,
            })
        }
    }
}

pub(super) fn synthesize_placeholder_rows(
    rows: Arc<Vec<Row>>,
    raw_rows: &[Row],
    enabled: bool,
) -> Arc<Vec<Row>> {
    if enabled {
        Arc::new(add_no_activity_placeholder_rows((*rows).clone(), raw_rows))
    } else {
        rows
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CoverageOutput {
    pub csv_bytes: Vec<u8>,
    pub report: DayCoverageCheckpoint,
}

pub(super) fn build_coverage(
    usage_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    windows: &[StudyWindow],
) -> Result<CoverageOutput, String> {
    let mut usage_dates: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in usage_rows {
        if row.interaction_type == APP_USAGE
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
            if window.is_some_and(|window| date < window.start_date || date > window.end_date) {
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionMinutes {
    pub participants_seen: BTreeMap<String, BTreeSet<String>>,
    pub buckets: BTreeMap<(String, String), (f64, f64)>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionCompletenessDay {
    pub participant_id: String,
    pub date: String,
    pub sharing_status: String,
    pub known_minutes: f64,
    pub unknown_minutes: f64,
    pub compliance_percent: f64,
    pub zero_real_usage: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionCompleteness {
    pub zero_usage_days: usize,
    pub days: Vec<AttributionCompletenessDay>,
}

pub(super) fn accumulate_minutes(rows: &[Row]) -> AttributionMinutes {
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

pub(super) fn compute_attribution_completeness(
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

pub(super) fn apply_compliance_threshold(
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

pub(super) fn compliance_csv(
    result: &ComplianceResultCheckpoint,
    enrolled_devices: &BTreeMap<String, u32>,
) -> Vec<u8> {
    let mut lines = vec![
        "participant_id,date,sharing_status,known_minutes,unknown_minutes,compliance_percent,zero_real_usage,is_valid,expected_device_count".to_string(),
    ];
    for day in &result.days {
        let expected = enrolled_devices
            .get(&day.participant_id)
            .map(u32::to_string)
            .unwrap_or_default();
        lines.push(format!(
            "{},{date},{},{},{},{},{},{},{}",
            csv_escape_value(&day.participant_id),
            day.sharing_status,
            js_rounded_number(day.known_minutes),
            js_rounded_number(day.unknown_minutes),
            js_rounded_number(day.compliance_percent),
            u8::from(day.zero_real_usage),
            u8::from(day.is_valid),
            expected,
            date = day.date,
        ));
    }
    lines.join("\n").into_bytes()
}

pub(super) fn index_keyguard_events(rows: &[Row]) -> Vec<i64> {
    let lock_events = LOCK_SCREEN_EVENTS.iter().copied().collect::<AHashSet<_>>();
    let mut timestamps = rows
        .iter()
        .filter(|row| lock_events.contains(row.interaction_type.as_str()))
        .map(|row| row.event_timestamp_ns)
        .collect::<Vec<_>>();
    timestamps.sort_unstable();
    timestamps
}

pub(super) fn infer_screen_session_skeletons(rows: &[Row]) -> Vec<ScreenSessionClose> {
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
    let mut state: Option<ScreenState> = None;
    for (index, row) in rows.iter().enumerate() {
        let interaction = row.interaction_type.as_str();
        let package = (!row.app_package_name.is_empty()).then(|| row.app_package_name.clone());
        if start_events.contains(interaction) {
            if let Some(current) = state.as_mut() {
                current.source_data_rows.merge(&row.source_data_rows);
            } else {
                state = Some(ScreenState {
                    start_index: index,
                    start_timestamp_ns: row.event_timestamp_ns,
                    start_timezone: row.timezone.clone(),
                    lock_screen_seen: lock_events.contains(interaction),
                    unlocked_seen: false,
                    foreground_pkg: None,
                    last_meaningful_ts_ns: None,
                    last_meaningful_pkg: None,
                    source_data_rows: row.source_data_rows.clone(),
                });
            }
            continue;
        }
        let Some(current) = state.as_mut() else {
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
        }
        if meaningful_events.contains(interaction) {
            current.last_meaningful_ts_ns = Some(row.event_timestamp_ns);
            current.last_meaningful_pkg = package.or_else(|| current.foreground_pkg.clone());
        }
        if stop_events.contains(interaction) {
            closes.push(ScreenSessionClose {
                state: current.clone(),
                stop_timestamp_ns: Some(row.event_timestamp_ns),
                stop_event_type: Some(interaction.into()),
            });
            state = None;
        }
    }
    if let Some(state) = state {
        closes.push(ScreenSessionClose {
            state,
            stop_timestamp_ns: None,
            stop_event_type: None,
        });
    }
    closes
}

#[derive(Clone, Copy)]
pub(super) struct ScreenClassificationSettings {
    pub auto_lock_timeout_seconds: f64,
    pub auto_lock_tolerance_seconds: f64,
    pub manual_lock_max_tail_seconds: f64,
    pub keyguard_near_stop_seconds: f64,
}

pub(super) fn classify_screen_sessions(
    rows: &[Row],
    closes: &[ScreenSessionClose],
    keyguard_timestamps: &[i64],
    apps_forcing: &HashMap<String, String>,
    settings: ScreenClassificationSettings,
) -> Vec<Row> {
    let mut sessions = Vec::with_capacity(closes.len());
    for close in closes {
        let state = &close.state;
        let start_row = &rows[state.start_index];
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

        if state.lock_screen_seen && !state.unlocked_seen && state.foreground_pkg.is_none() {
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
            && keyguard_timestamps[keyguard_timestamps.partition_point(|timestamp| {
                *timestamp
                    < stop_timestamp_ns.saturating_sub(
                        (settings.keyguard_near_stop_seconds * 1_000_000_000.0).ceil() as i64,
                    )
            })
                ..keyguard_timestamps.partition_point(|timestamp| {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Canonical rows from `(interaction type, package, seconds after
    /// 2026-03-07 10:00:00 America/Chicago)` triples, in the order given.
    fn rows(events: &[(&str, &str, i64)]) -> Vec<Row> {
        let stamps = events
            .iter()
            .map(|(_, _, second)| {
                format!(
                    "2026-03-07 {:02}:{:02}:{:02}",
                    10 + second / 3_600,
                    (second / 60) % 60,
                    second % 60,
                )
            })
            .collect::<Vec<_>>();
        let built = events
            .iter()
            .zip(&stamps)
            .map(|((interaction, package, _), stamp)| (stamp.as_str(), *interaction, *package))
            .collect::<Vec<_>>();
        crate::pipeline_v2::tests::rows_from_events(&built)
    }

    fn kinds(rows: &[Row]) -> Vec<&str> {
        rows.iter()
            .map(|row| row.interaction_type.as_str())
            .collect()
    }

    /// A remap entry renames one interaction type to another, so both halves
    /// have to be present: an entry that names no source, or no replacement,
    /// installs nothing rather than a rename from or to an empty type.
    #[test]
    fn an_interaction_remap_entry_needs_a_source_and_a_replacement() {
        let entries = [
            "  Activity Resumed  =>  Custom Resumed  ".to_string(),
            "=>Custom Paused".to_string(),
            "Activity Paused=>".to_string(),
            "   =>   ".to_string(),
            "Activity Stopped".to_string(),
        ];
        assert_eq!(
            validate_remap_rules(&entries),
            BTreeMap::from([("Activity Resumed".to_string(), "Custom Resumed".to_string(),)]),
        );
    }

    /// The two order predicates decide whether a sort or a de-duplication pass
    /// can be skipped. Event order is the full sort key — timestamp, then the
    /// original row index — while the strict-increase check exists to catch the
    /// one case that key allows and a per-timestamp lookup cannot resolve: a
    /// tie.
    #[test]
    fn the_row_order_predicates_answer_for_the_whole_sort_key() {
        assert!(rows_are_event_ordered(&[]));
        assert!(rows_have_strictly_increasing_timestamps(&[]));

        let mut ascending = rows(&[
            ("Activity Resumed", "com.example.chat", 0),
            ("Activity Paused", "com.example.chat", 1),
        ]);
        assert!(rows_are_event_ordered(&ascending));
        assert!(rows_have_strictly_increasing_timestamps(&ascending));
        ascending.swap(0, 1);
        assert!(
            !rows_are_event_ordered(&ascending),
            "a later event placed first is out of order",
        );
        assert!(!rows_have_strictly_increasing_timestamps(&ascending));

        let mut tied = rows(&[
            ("Activity Resumed", "com.example.chat", 0),
            ("Activity Paused", "com.example.chat", 0),
        ]);
        assert!(
            rows_are_event_ordered(&tied),
            "a tie in ascending index order is ordered",
        );
        assert!(
            !rows_have_strictly_increasing_timestamps(&tied),
            "a tie is not a strict increase",
        );
        tied.swap(0, 1);
        assert!(
            !rows_are_event_ordered(&tied),
            "a tie in descending index order is not ordered",
        );
    }

    /// The dominant timezone is the one the most rows were recorded in. Rows
    /// with no timezone cell do not get a vote, and an exact tie keeps the zone
    /// that reached the count first rather than handing it to the later zone.
    #[test]
    fn the_dominant_timezone_is_the_most_recorded_one_and_a_tie_keeps_the_incumbent() {
        let zoned = |zones: &[&str]| {
            let mut built = rows(
                &zones
                    .iter()
                    .enumerate()
                    .map(|(index, _)| ("Activity Resumed", "com.example.chat", index as i64))
                    .collect::<Vec<_>>(),
            );
            for (row, zone) in built.iter_mut().zip(zones) {
                row.edit_temporal().timezone = (*zone).into();
            }
            estimate_dominant_timezone(&built)
        };

        assert_eq!(estimate_dominant_timezone(&[]), "UTC");
        assert_eq!(zoned(&["", ""]), "UTC", "a blank cell is not a vote");
        assert_eq!(zoned(&["", "Europe/Berlin"]), "Europe/Berlin");
        assert_eq!(
            zoned(&["America/Chicago", "Europe/Berlin"]),
            "America/Chicago",
            "one row each keeps the zone that got there first",
        );
        assert_eq!(
            zoned(&["America/Chicago", "Europe/Berlin", "Europe/Berlin"]),
            "Europe/Berlin",
        );
    }

    /// Filtering to a timezone keeps exactly the rows recorded in that zone and
    /// drops the rest — including the case where no row carries the target zone
    /// at all, which has to empty the table rather than quietly keep every row.
    #[test]
    fn timezone_filtering_keeps_only_the_rows_recorded_in_the_target_zone() {
        let mixed = || {
            let mut built = rows(&[
                ("Activity Resumed", "com.example.chat", 0),
                ("Activity Paused", "com.example.chat", 1),
                ("Activity Resumed", "com.example.chat", 2),
            ]);
            built[1].edit_temporal().timezone = "Europe/Berlin".into();
            Arc::new(built)
        };

        let primary = resolve_timezone_strategy(mixed(), "", "primary-filter", "America/Chicago")
            .expect("primary filter");
        assert_eq!(primary.target_timezone, "America/Chicago");
        assert_eq!(primary.action, "filtered_to_primary");
        assert_eq!(primary.rows.len(), 2);
        assert!(primary
            .rows
            .iter()
            .all(|row| row.timezone == "America/Chicago"));

        let absent = resolve_timezone_strategy(mixed(), "", "primary-filter", "Asia/Tokyo")
            .expect("primary filter");
        assert!(
            absent.rows.is_empty(),
            "filtering to a zone no row carries removes every row",
        );

        let selected = resolve_timezone_strategy(
            mixed(),
            "Europe/Berlin",
            "selected-filter",
            "America/Chicago",
        )
        .expect("selected filter");
        assert_eq!(selected.rows.len(), 1);
        assert_eq!(selected.rows[0].timezone, "Europe/Berlin");

        let converted =
            resolve_timezone_strategy(mixed(), "", "primary-convert", "America/Chicago")
                .expect("primary convert");
        assert_eq!(
            converted.rows.len(),
            3,
            "converting keeps every row, whatever zone it was recorded in",
        );
    }

    /// Restamping moves the whole table into one zone: a row already recorded
    /// there is left alone, and every other row takes the target zone with its
    /// local calendar columns recomputed for it.
    #[test]
    fn restamping_rewrites_every_row_that_is_not_already_in_the_target_zone() {
        let mut built = rows(&[
            ("Activity Resumed", "com.example.chat", 0),
            ("Activity Paused", "com.example.chat", 60),
        ]);
        // Same instant, mislabelled: the row claims UTC, so restamping to
        // America/Chicago has to relabel it and recompute its local hour.
        built[1].edit_temporal().timezone = "UTC".into();
        built[1].edit_temporal().hour = 16;

        let restamped = standardize_event_clock(built, "America/Chicago").expect("restamp");
        assert!(restamped
            .iter()
            .all(|row| row.timezone == "America/Chicago"));
        assert_eq!(
            (restamped[0].hour, restamped[1].hour),
            (4, 4),
            "both instants read as the 4 a.m. hour in Chicago",
        );
        assert_eq!(restamped[1].date.as_str(), "2026-03-07");
    }

    /// Blind-folding hands the matcher ordinary activity events by undoing the
    /// "Filtered" prefix the junk pass applied. Every filtered type has to map
    /// back to its unfiltered counterpart, and a type that was never filtered
    /// is left exactly as it is.
    #[test]
    fn blind_folding_restores_every_filtered_activity_type() {
        let mut built = rows(&[
            ("Activity Resumed", "com.example.chat", 0),
            ("Activity Resumed", "com.example.chat", 1),
            ("Activity Resumed", "com.example.chat", 2),
            ("Activity Resumed", "com.example.chat", 3),
            ("Activity Resumed", "com.example.chat", 4),
        ]);
        for (row, kind) in built.iter_mut().zip([
            FILTERED_RESUMED,
            FILTERED_PAUSED,
            FILTERED_STOPPED,
            "Filtered App Destroyed",
            SCREEN_USAGE,
        ]) {
            row.edit_classification().interaction_type = kind.into();
        }

        assert_eq!(
            kinds(&mask_excluded_app_events(built)),
            vec![
                ACTIVITY_RESUMED,
                ACTIVITY_PAUSED,
                ACTIVITY_STOPPED,
                "Activity Destroyed",
                SCREEN_USAGE,
            ],
        );
    }

    /// The matcher pairs resumes with pauses, so a stream carrying neither is a
    /// study period with no app usage in it and has to be reported as such
    /// instead of producing an empty match.
    #[test]
    fn the_matcher_input_refuses_a_stream_with_no_resume_and_no_pause() {
        let background = AHashSet::from(["com.example.player".to_string()]);
        let stop_types = ["Activity Stopped".to_string()];

        let error = build_app_event_index(
            &rows(&[("Activity Stopped", "com.example.chat", 0)]),
            &stop_types,
            &[],
            &AHashSet::new(),
            false,
        )
        .expect_err("a stopped-only stream has no usage");
        assert_eq!(error, "No valid app usage data during the study period");

        let paused = build_app_event_index(
            &rows(&[
                ("Activity Paused", "com.example.chat", 0),
                ("Activity Stopped", "com.example.player", 1),
            ]),
            &stop_types,
            &[],
            &background,
            false,
        )
        .expect("a pause is app usage");
        assert_eq!(paused.background, vec![false, true]);
        assert_eq!(
            paused.stopped,
            vec![false, false],
            "a background app's stop is not a foreground stop",
        );
        assert_eq!(paused.app_codes, vec![0, 1]);
    }

    /// Once a package is filtered, its usage row keeps its place in the table
    /// but stops counting: a background app's usage is marked as filtered
    /// background usage, ordinary filtered usage loses its duration, and any
    /// other event of that package is stripped of timing entirely.
    #[test]
    fn marking_filtered_packages_downgrades_each_kind_of_row_differently() {
        let filtered = BTreeSet::from([
            "com.example.player".to_string(),
            "com.example.chat".to_string(),
        ]);
        let background = AHashSet::from(["com.example.player".to_string()]);

        let mut built = rows(&[
            (APP_USAGE, "com.example.player", 0),
            (APP_USAGE, "com.example.chat", 1),
            (ACTIVITY_STOPPED, "com.example.chat", 2),
            (APP_USAGE, "com.example.kept", 3),
        ]);
        for row in built.iter_mut() {
            let temporal = row.edit_temporal();
            temporal.start_timestamp_ns = Some(0);
            temporal.stop_timestamp_ns = Some(60_000_000_000);
            temporal.duration_seconds = Some(60.0);
            temporal.duration_minutes = Some(1.0);
        }

        let marked = apply_app_inclusion_policy(built, &filtered, &background);
        assert_eq!(
            kinds(&marked),
            vec![
                FILTERED_APP_BACKGROUND_USAGE,
                FILTERED_APP_USAGE,
                FILTERED_STOPPED,
                APP_USAGE,
            ],
        );
        assert_eq!(
            marked[0].duration_minutes,
            Some(1.0),
            "filtered background usage keeps the minutes it accrued",
        );
        assert_eq!(marked[1].duration_minutes, None);
        assert_eq!(
            marked[1].start_timestamp_ns,
            Some(0),
            "filtered foreground usage keeps its interval and loses only the duration",
        );
        assert_eq!(marked[2].start_timestamp_ns, None);
        assert_eq!(marked[2].duration_minutes, None);
        assert_eq!(marked[3].duration_minutes, Some(1.0));
    }

    /// Dropping interaction types is a display choice, but the long-data-gap
    /// flag is evidence about the recording itself: a row of a dropped type
    /// still has to survive when its own gap reaches the smallest configured
    /// threshold, and a row of a kept type is never dropped for a short gap.
    #[test]
    fn dropping_interaction_types_spares_the_rows_that_carry_a_long_data_gap() {
        let build = || {
            let mut built = rows(&[
                (ACTIVITY_STOPPED, "com.example.chat", 0),
                (ACTIVITY_STOPPED, "com.example.chat", 1),
                (APP_USAGE, "com.example.chat", 2),
            ]);
            for (row, gap) in built.iter_mut().zip([0.5_f64, 9.0, 0.5]) {
                row.edit_temporal().data_time_gap_hours = gap;
            }
            built
        };

        let removed = [ACTIVITY_STOPPED.to_string()];
        let kept = remove_selected_interaction_types(build(), &removed, &[6.0, 12.0]);
        assert_eq!(
            kinds(&kept),
            vec![ACTIVITY_STOPPED, APP_USAGE],
            "the 9-hour gap row survives its type being dropped; the 0.5-hour one does not",
        );
        assert_eq!(kept[0].data_time_gap_hours, 9.0);

        assert_eq!(
            remove_selected_interaction_types(build(), &[], &[6.0]).len(),
            3,
            "no types to remove leaves the table alone",
        );
    }

    /// A zero-length app-usage session is a matcher artefact, not usage, so the
    /// opt-in drop removes it. It is scoped to app usage — a screen or activity
    /// row that happens to carry no duration is a different kind of record and
    /// stays — and with the option off nothing is removed at all.
    #[test]
    fn dropping_zero_duration_rows_touches_only_app_usage_and_only_when_enabled() {
        let build = || {
            let mut built = rows(&[
                (APP_USAGE, "com.example.chat", 0),
                (APP_USAGE, "com.example.chat", 1),
                (SCREEN_USAGE, "com.example.chat", 2),
                (APP_USAGE, "com.example.chat", 3),
            ]);
            for (row, duration) in built
                .iter_mut()
                .zip([Some(0.0), Some(60.0), Some(0.0), None])
            {
                row.edit_temporal().duration_seconds = duration;
            }
            built
        };

        let dropped = remove_zero_duration_rows(build(), true);
        assert_eq!(
            dropped
                .iter()
                .map(|row| (row.interaction_type.as_str(), row.duration_seconds))
                .collect::<Vec<_>>(),
            vec![
                (APP_USAGE, Some(60.0)),
                (SCREEN_USAGE, Some(0.0)),
                (APP_USAGE, None),
            ],
        );
        assert_eq!(
            remove_zero_duration_rows(build(), false).len(),
            4,
            "with the option off the zero-duration session stays",
        );
    }

    /// Day coverage reports one row per day of the participant's study window:
    /// a day with usage, a day the export recorded but nothing was used, and a
    /// day with no data at all. Data recorded outside the window is not part of
    /// that report and must not be treated as a day the spine failed to cover.
    #[test]
    fn day_coverage_reports_the_study_window_and_ignores_data_outside_it() {
        let mut usage = rows(&[(APP_USAGE, "com.example.chat", 0)]);
        {
            let data = usage[0].edit_all();
            data.date = "2026-03-03".into();
            data.duration_minutes = Some(5.0);
        }
        let raw_dates = BTreeMap::from([(
            "P01".to_string(),
            BTreeSet::from([
                "2026-03-01".to_string(),
                "2026-03-02".to_string(),
                "2026-03-03".to_string(),
                "2026-03-05".to_string(),
            ]),
        )]);
        let windows = [StudyWindow {
            participant_id: "P01".to_string(),
            start_date: "2026-03-02".to_string(),
            end_date: "2026-03-04".to_string(),
        }];

        let coverage = build_coverage(&usage, &raw_dates, &windows)
            .expect("data outside the window is not a coverage failure");
        assert_eq!(
            coverage
                .report
                .coverage
                .iter()
                .map(|day| (day.date.as_str(), day.status.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("2026-03-02", "no_activity"),
                ("2026-03-03", "usage"),
                ("2026-03-04", "no_data"),
            ],
        );
        assert_eq!(
            (
                coverage.report.usage_days,
                coverage.report.no_activity_days,
                coverage.report.no_data_days,
            ),
            (1, 1, 1),
        );

        let unwindowed =
            build_coverage(&usage, &raw_dates, &[]).expect("coverage without a study window");
        assert_eq!(
            unwindowed
                .report
                .coverage
                .iter()
                .map(|day| day.date.as_str())
                .collect::<Vec<_>>(),
            vec![
                "2026-03-01",
                "2026-03-02",
                "2026-03-03",
                "2026-03-04",
                "2026-03-05",
            ],
            "with no window the spine runs from the first observed day to the last",
        );
    }

    const SECOND_NS: i64 = 1_000_000_000;

    /// The event instant `second` seconds after the fixture's 10:00:00 origin.
    fn instant(second: i64) -> i64 {
        rows(&[("Activity Resumed", "com.example.chat", second)])[0].event_timestamp_ns
    }

    /// App-usage sessions from `(start second, stop second)` pairs.
    fn app_sessions(sessions: &[(i64, i64)]) -> Vec<Row> {
        let mut built = rows(
            &sessions
                .iter()
                .map(|(start, _)| (APP_USAGE, "com.example.chat", *start))
                .collect::<Vec<_>>(),
        );
        for (row, (start, stop)) in built.iter_mut().zip(sessions) {
            let temporal = row.edit_temporal();
            temporal.start_timestamp_ns = Some(instant(*start));
            temporal.stop_timestamp_ns = Some(instant(*stop));
            temporal.duration_seconds = Some((stop - start) as f64);
            temporal.duration_minutes = Some((stop - start) as f64 / 60.0);
        }
        built
    }

    struct CreditRun {
        /// Credited intervals in seconds after the fixture origin.
        intervals: Vec<(i64, i64)>,
        counts: CreditEmissionCounts,
        incapable: Vec<String>,
    }

    /// Run the whole screen-credit lane over one participant: `witnesses` are
    /// the raw events the export recorded, `sessions` the app usage to credit.
    fn run_credit(
        witnesses: &[(&str, i64)],
        sessions: &[(i64, i64)],
        cap_minutes: f64,
        tolerance_minutes: f64,
        bridge_seconds: f64,
        min_day_apps: u32,
    ) -> CreditRun {
        let raw = rows(
            &witnesses
                .iter()
                .map(|(kind, second)| (*kind, "com.example.screen", *second))
                .collect::<Vec<_>>(),
        );
        let substrate = build_activity_witness_indexes(&raw).expect("liveness substrate");
        let app = app_sessions(sessions);
        let partition = identify_credit_eligible_sessions(&app, None).expect("credit partition");
        let day_apps = summarize_daily_apps(&partition);
        let decisions = derive_credited_intervals(
            &partition,
            &substrate,
            &day_apps,
            cap_minutes,
            tolerance_minutes,
            bridge_seconds,
            min_day_apps,
        );
        let emission =
            materialize_credited_rows(&partition, &decisions, &substrate, tolerance_minutes);
        let origin = instant(0);
        CreditRun {
            intervals: emission
                .credited
                .iter()
                .map(|row| {
                    (
                        (row.start_timestamp_ns.expect("credited start") - origin) / SECOND_NS,
                        (row.stop_timestamp_ns.expect("credited stop") - origin) / SECOND_NS,
                    )
                })
                .collect(),
            counts: emission.counts,
            incapable: screen_incapable_participants(&partition, &substrate),
        }
    }

    /// Screen gating needs a screen the export actually witnessed: both an
    /// interactive and a non-interactive event have to appear, because a stream
    /// that only ever reports one of them never shows the screen changing. A
    /// participant who fails that test is reported once, however many sessions
    /// they have, and their usage is credited in full rather than gated away.
    #[test]
    fn screen_credit_reports_and_passes_through_participants_with_no_screen_witness() {
        let sessions = [(0, 60), (120, 180)];

        let witnessed = run_credit(
            &[("Screen Interactive", 0), ("Screen Non-Interactive", 300)],
            &sessions,
            360.0,
            120.0,
            120.0,
            1,
        );
        assert!(witnessed.incapable.is_empty());

        let one_sided = run_credit(
            &[("Screen Interactive", 0)],
            &sessions,
            360.0,
            120.0,
            120.0,
            1,
        );
        assert_eq!(
            one_sided.incapable,
            vec!["P01".to_string()],
            "one screen state is never a witness, and the participant is named once",
        );
        assert_eq!(
            one_sided.intervals,
            vec![(0, 60), (120, 180)],
            "usage that cannot be gated is credited exactly as recorded",
        );

        let unwitnessed = run_credit(&[], &sessions, 360.0, 120.0, 120.0, 1);
        assert_eq!(unwitnessed.incapable, vec!["P01".to_string()]);
        assert_eq!(unwitnessed.intervals, vec![(0, 60), (120, 180)]);
    }

    /// A session that starts before any screen event needs deciding twice over:
    /// if the screen is witnessed inside the session it is gated normally, and
    /// only when there is no witness anywhere in the session does the fallback
    /// credit device-alive time — and then only for a day busy enough to meet
    /// the minimum app count.
    #[test]
    fn screen_credit_separates_a_witnessed_session_from_one_with_no_witness_at_all() {
        let inside_the_session = run_credit(
            &[("Screen Interactive", 30), ("Screen Non-Interactive", 200)],
            &[(10, 70)],
            360.0,
            120.0,
            120.0,
            1,
        );
        assert_eq!(
            inside_the_session.intervals,
            vec![(30, 70)],
            "credit starts when the screen was first witnessed on",
        );
        assert_eq!(
            inside_the_session.counts.no_witness_fallbacks, 0,
            "a screen event inside the session is a witness, not a fallback",
        );

        let unwitnessed = [
            ("Activity Resumed", 20),
            ("Screen Interactive", 1000),
            ("Screen Non-Interactive", 1100),
        ];

        let no_witness = run_credit(&unwitnessed, &[(10, 70)], 360.0, 120.0, 120.0, 1);
        assert_eq!(
            no_witness.counts.no_witness_fallbacks, 1,
            "no screen event covers the session, so the fallback decides it",
        );
        assert_eq!(
            no_witness.intervals,
            vec![(20, 70)],
            "the fallback credits the part of the session the device was alive for",
        );

        let too_quiet = run_credit(&unwitnessed, &[(10, 70)], 360.0, 120.0, 120.0, 2);
        assert_eq!(
            too_quiet.counts.no_witness_fallbacks, 0,
            "one app on the day does not meet a two-app minimum",
        );
        assert!(
            too_quiet.intervals.is_empty(),
            "without the fallback an unwitnessed session earns no credit",
        );
    }

    /// Credit is truncated at the cap measured from the session start, never
    /// zeroed, and every truncated session is counted so the run can report how
    /// often it happened.
    #[test]
    fn screen_credit_truncates_a_session_at_the_cap_and_counts_it() {
        let witnesses = [
            ("Screen Interactive", 0),
            ("Activity Resumed", 300),
            ("Screen Non-Interactive", 900),
        ];

        let capped = run_credit(&witnesses, &[(0, 600)], 5.0, 120.0, 120.0, 1);
        assert_eq!(capped.intervals, vec![(0, 300)]);
        assert_eq!(capped.counts.truncated_sessions, 1);

        let uncapped = run_credit(&witnesses, &[(0, 600)], 60.0, 120.0, 120.0, 1);
        assert_eq!(uncapped.intervals, vec![(0, 600)]);
        assert_eq!(uncapped.counts.truncated_sessions, 0);
    }

    /// A screen-off blip shorter than the device's auto-lock cannot be a real
    /// lock, so credit bridges across it and the session stays one interval.
    /// A blip longer than the bridge splits the session in two.
    #[test]
    fn screen_credit_bridges_an_off_blip_shorter_than_the_auto_lock() {
        let witnesses = [
            ("Screen Interactive", 0),
            ("Screen Non-Interactive", 100),
            ("Screen Interactive", 130),
            ("Activity Resumed", 200),
        ];

        let bridged = run_credit(&witnesses, &[(0, 200)], 360.0, 120.0, 120.0, 1);
        assert_eq!(
            bridged.intervals,
            vec![(0, 200)],
            "a 30-second gap under a 120-second auto-lock is not a lock",
        );

        let split = run_credit(&witnesses, &[(0, 200)], 360.0, 120.0, 10.0, 1);
        assert_eq!(
            split.intervals,
            vec![(0, 100), (130, 200)],
            "a 30-second gap over a 10-second auto-lock is a real lock",
        );
    }

    /// Credit also requires the device to have been demonstrably alive. A
    /// silence longer than the liveness tolerance breaks the alive chain, and
    /// the part of the session inside that silence earns nothing even though
    /// the screen was last witnessed on.
    #[test]
    fn screen_credit_stops_at_a_silence_longer_than_the_liveness_tolerance() {
        let witnesses = [
            ("Screen Interactive", 0),
            ("Activity Resumed", 100),
            ("Activity Resumed", 300),
            ("Screen Non-Interactive", 400),
        ];

        let tolerant = run_credit(&witnesses, &[(0, 300)], 360.0, 5.0, 120.0, 1);
        assert_eq!(
            tolerant.intervals,
            vec![(0, 300)],
            "a 200-second silence inside a 5-minute tolerance keeps the device alive",
        );

        let broken = run_credit(&witnesses, &[(0, 300)], 360.0, 2.0, 120.0, 1);
        assert_eq!(
            broken.intervals,
            vec![(0, 100)],
            "a 200-second silence past a 2-minute tolerance ends the alive span",
        );
    }
}

#[cfg(feature = "incremental-v2")]
mod tracked {
    use super::*;

    #[cfg(feature = "query-timing")]
    struct QueryTimer {
        label: &'static str,
        started: std::time::Instant,
    }

    #[cfg(feature = "query-timing")]
    impl QueryTimer {
        fn start(label: &'static str) -> Self {
            Self {
                label,
                started: std::time::Instant::now(),
            }
        }

        fn finish(self) {
            drop(self);
        }
    }

    #[cfg(feature = "query-timing")]
    impl Drop for QueryTimer {
        fn drop(&mut self) {
            eprintln!(
                "query_timing label={} elapsed_ms={:.3}",
                self.label,
                self.started.elapsed().as_secs_f64() * 1_000.0,
            );
        }
    }

    #[cfg(not(feature = "query-timing"))]
    struct QueryTimer;

    #[cfg(not(feature = "query-timing"))]
    impl QueryTimer {
        #[inline(always)]
        fn start(_label: &'static str) -> Self {
            Self
        }

        #[inline(always)]
        fn finish(self) {}
    }
    use salsa::Setter;
    use std::cell::RefCell;
    use std::fmt;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct QueryValue<T> {
        value: Arc<T>,
        checkpoint: WorkflowCheckpoint,
        /// The product DAG checkpoint emitted at this step boundary. Keeping
        /// it with Salsa's memoized step result avoids re-hashing an unchanged
        /// row table every time only a later option changes.
        query_group_checkpoint: Option<WorkflowCheckpoint>,
    }

    impl<T> PartialEq for QueryValue<T> {
        fn eq(&self, other: &Self) -> bool {
            self.checkpoint == other.checkpoint
        }
    }

    impl<T> Eq for QueryValue<T> {}

    const REVIEW_BASE_PROTOCOL: &str = "chronicle-review-base/v9";
    const REVIEW_BASE_MAGIC: &[u8; 8] = b"CHRRB009";
    const REVIEW_BASE_HEADER_BYTES: usize = REVIEW_BASE_MAGIC.len() + 4 + 32 + 32 + 32;
    // The 100k-row production fixture currently needs about 25 MiB decoded.
    // Four-to-six times that measured size supports much larger individual
    // files without permitting two cache blobs to reserve over a GiB.
    const MAX_REVIEW_BASE_UNCOMPRESSED_BYTES: usize = 128 * 1024 * 1024;
    const MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES: usize = 192 * 1024 * 1024;
    const RECONSTRUCTION_BASE_PROTOCOL: &str = "chronicle-reconstruction-base/v8";
    const RECONSTRUCTION_BASE_MAGIC: &[u8; 8] = b"CHRRX008";
    const RECONSTRUCTION_BASE_HEADER_BYTES: usize = RECONSTRUCTION_BASE_MAGIC.len() + 4 + 32 + 32;

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewBaseMetadata {
        query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
        query_group_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
        original_row_count: u32,
        processed_row_count: u32,
        rows_before_timezone_handling: u32,
        rows_after_timezone_handling: u32,
        duplicate_timestamps_corrected: u32,
        exact_duplicate_rows_removed: u32,
        available_timezones: Vec<String>,
        timezone: String,
        timezone_action: String,
        timezone_retained_source_rows_digest: String,
        timezone_stage_digest: String,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewBase {
        protocol_version: String,
        input_key: String,
        rows: Arc<Vec<Row>>,
        /// Present only when app-usage processing was active while the base
        /// was exported. A disabled app pipeline must not speculatively run
        /// `mask_excluded_app_events` merely to prepare a cache for a possible future
        /// configuration.
        matcher_search_suffix_digests: Option<Arc<Vec<InlineLineageDigest>>>,
        metadata: ReviewBaseMetadata,
        screen: Option<ScreenBase>,
    }

    #[derive(Clone)]
    struct DecodedReviewBase {
        encoded_digest: [u8; 32],
        value: Arc<ReviewBase>,
    }

    impl PartialEq for DecodedReviewBase {
        fn eq(&self, other: &Self) -> bool {
            self.encoded_digest == other.encoded_digest
        }
    }

    impl Eq for DecodedReviewBase {}

    struct ReviewBaseHeader {
        input_key: [u8; 32],
        app_policy_checkpoint: [u8; 32],
    }

    #[derive(Debug)]
    struct VerifiedReviewBaseHeader {
        input_key: [u8; 32],
        app_policy_checkpoint: [u8; 32],
        payload_digest: [u8; 32],
        declared_bytes: usize,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReconstructionBase {
        protocol_version: String,
        input_key: String,
        rows: Arc<Vec<Row>>,
        resolve_excluded_packages: WorkflowCheckpoint,
        mask_excluded_app_events: WorkflowCheckpoint,
        build_app_event_index: WorkflowCheckpoint,
        match_app_episodes: WorkflowCheckpoint,
        materialize_candidate_episodes: WorkflowCheckpoint,
        segment_concurrent_usage: WorkflowCheckpoint,
        reconstruct_episodes: WorkflowCheckpoint,
        annotation_checkpoint: ReviewAnnotationCheckpointBase,
        early_metadata: ReviewBaseMetadata,
        screen: Option<ScreenBase>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewAnnotationCheckpointBase {
        input_key: String,
        rows: Arc<Vec<Row>>,
        join_app_codebook: WorkflowCheckpoint,
        derive_broad_category: WorkflowCheckpoint,
        collapse_app_genre: WorkflowCheckpoint,
        categorize_apps: WorkflowCheckpoint,
        derive_engagement_basis: WorkflowCheckpoint,
        apply_episode_flags: WorkflowCheckpoint,
        episode_annotations: WorkflowCheckpoint,
        suppress_excluded_timing: WorkflowCheckpoint,
        remove_selected_interaction_types: WorkflowCheckpoint,
        remove_zero_duration_rows: WorkflowCheckpoint,
        interval_cleaning: WorkflowCheckpoint,
    }

    /// Disk representation of the two closely related reconstruction row
    /// tables. Annotation never adds or reorders rows and never changes row
    /// identity; it can only retain a row unchanged, replace its non-identity
    /// fields, or remove it. Keeping the corresponding state beside the source
    /// row lets LZ4 see shared bytes inside its 64 KiB window and avoids
    /// deserializing a second Row when the exact Arc can be reused.
    #[derive(serde::Serialize, serde::Deserialize)]
    struct PersistedReconstructionRow {
        reconstruction: Row,
        annotation: PersistedAnnotationRow,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    enum PersistedAnnotationRow {
        Reuse,
        Replace(Row),
        Drop,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct PersistedReviewAnnotationCheckpointBase {
        input_key: String,
        join_app_codebook: WorkflowCheckpoint,
        derive_broad_category: WorkflowCheckpoint,
        collapse_app_genre: WorkflowCheckpoint,
        categorize_apps: WorkflowCheckpoint,
        derive_engagement_basis: WorkflowCheckpoint,
        apply_episode_flags: WorkflowCheckpoint,
        episode_annotations: WorkflowCheckpoint,
        suppress_excluded_timing: WorkflowCheckpoint,
        remove_selected_interaction_types: WorkflowCheckpoint,
        remove_zero_duration_rows: WorkflowCheckpoint,
        interval_cleaning: WorkflowCheckpoint,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct PersistedReconstructionBase {
        protocol_version: String,
        input_key: String,
        row_states: Vec<PersistedReconstructionRow>,
        resolve_excluded_packages: WorkflowCheckpoint,
        mask_excluded_app_events: WorkflowCheckpoint,
        build_app_event_index: WorkflowCheckpoint,
        match_app_episodes: WorkflowCheckpoint,
        materialize_candidate_episodes: WorkflowCheckpoint,
        segment_concurrent_usage: WorkflowCheckpoint,
        reconstruct_episodes: WorkflowCheckpoint,
        annotation_checkpoint: PersistedReviewAnnotationCheckpointBase,
        early_metadata: ReviewBaseMetadata,
        screen: Option<ScreenBase>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ScreenBase {
        input_key: String,
        rows: Arc<Vec<Row>>,
        index_keyguard_events: WorkflowCheckpoint,
        infer_screen_session_skeletons: WorkflowCheckpoint,
        classify_screen_sessions: WorkflowCheckpoint,
        device_state_timeline: WorkflowCheckpoint,
    }

    #[derive(Clone)]
    struct DecodedReconstructionBase {
        encoded_digest: [u8; 32],
        value: Arc<ReconstructionBase>,
    }

    struct CachedDecodedReconstructionBase {
        payload_digest: [u8; 32],
        /// The exact verified encoded bytes, retained so a byte-equal request
        /// can be proven identical by memcmp instead of re-hashing.
        encoded_bytes: Arc<Vec<u8>>,
        value: Arc<ReconstructionBase>,
    }

    struct CachedDecodedReviewBase {
        payload_digest: [u8; 32],
        /// The exact verified encoded bytes, retained so a byte-equal request
        /// can be proven identical by memcmp instead of re-hashing.
        encoded_bytes: Arc<Vec<u8>>,
        value: Arc<ReviewBase>,
    }

    // A worker processing renamed copies of the same source file sees the
    // same immutable review checkpoint repeatedly. Keep one decoded copy and
    // verify the compressed payload digest on every access before reusing it.
    thread_local! {
        static REVIEW_BASE_DECODE_CACHE: RefCell<Option<CachedDecodedReviewBase>> =
            const { RefCell::new(None) };
    }

    #[cfg(test)]
    thread_local! {
        static REVIEW_BASE_DECODE_COUNT: std::cell::Cell<usize> =
            const { std::cell::Cell::new(0) };
    }

    /// Two-slot cache for review row tables that alternate between two config
    /// states in an interactive A/B loop (e.g. toggling model_concurrent_usage
    /// on a warm engine). Salsa keeps exactly one memo per query, so A/B/A
    /// alternation always misses even though both states were already
    /// computed. Keys are the content-committing checkpoint digests of every
    /// input that shapes the value, so a hit is a proof of identical content,
    /// not a heuristic. Same thread-local precedent as
    /// REVIEW_BASE_DECODE_CACHE; capacity is fixed at two states.
    struct AlternationSlots<T> {
        slots: Vec<(String, T)>,
    }

    impl<T: Clone> AlternationSlots<T> {
        const CAPACITY: usize = 2;

        fn lookup(&mut self, key: &str) -> Option<T> {
            let index = self
                .slots
                .iter()
                .position(|(slot_key, _)| slot_key == key)?;
            let entry = self.slots.remove(index);
            let value = entry.1.clone();
            self.slots.insert(0, entry);
            Some(value)
        }

        fn store(&mut self, key: String, value: T) {
            self.slots.retain(|(slot_key, _)| slot_key != &key);
            self.slots.insert(0, (key, value));
            self.slots.truncate(Self::CAPACITY);
        }
    }

    impl<T> Default for AlternationSlots<T> {
        fn default() -> Self {
            Self { slots: Vec::new() }
        }
    }

    thread_local! {
        static BEFORE_FLOOR_ALTERNATION_CACHE:
            RefCell<AlternationSlots<ReviewUsageRowsBeforeFloor>> =
            RefCell::new(AlternationSlots::default());
        static STATIC_ANNOTATIONS_ALTERNATION_CACHE:
            RefCell<AlternationSlots<ReviewStaticAnnotations>> =
            RefCell::new(AlternationSlots::default());
        static RECONSTRUCTED_ROWS_ALTERNATION_CACHE:
            RefCell<AlternationSlots<ReviewReconstructedRows>> =
            RefCell::new(AlternationSlots::default());
        static ANNOTATIONS_FUSED_ALTERNATION_CACHE:
            RefCell<AlternationSlots<ReviewAnnotations>> =
            RefCell::new(AlternationSlots::default());
        static MATCHER_INPUT_ALTERNATION_CACHE:
            RefCell<AlternationSlots<QueryValue<MatcherInput>>> =
            RefCell::new(AlternationSlots::default());
        static MATCHER_OUTPUT_ALTERNATION_CACHE:
            RefCell<AlternationSlots<QueryValue<MatcherOutput>>> =
            RefCell::new(AlternationSlots::default());
        static PRIMARY_OUTPUTS_ALTERNATION_CACHE:
            RefCell<AlternationSlots<QueryValue<PrimaryOutputs>>> =
            RefCell::new(AlternationSlots::default());
        static PARTICIPANT_WINDOWS_ALTERNATION_CACHE:
            RefCell<AlternationSlots<QueryValue<Vec<ResolvedParticipantWindow>>>> =
            RefCell::new(AlternationSlots::default());
    }

    // A batch worker processes different workspaces serially and retains only
    // one Salsa engine. Duplicated content therefore used to deserialize the
    // same 28 MiB reconstruction checkpoint for every file. Retain exactly
    // one immutable decoded checkpoint per worker; every hit still hashes and
    // verifies the selected compressed payload before reuse.
    thread_local! {
        static RECONSTRUCTION_BASE_DECODE_CACHE: RefCell<Option<CachedDecodedReconstructionBase>> =
            const { RefCell::new(None) };
    }

    #[cfg(test)]
    thread_local! {
        static RECONSTRUCTION_BASE_DECODE_COUNT: std::cell::Cell<usize> =
            const { std::cell::Cell::new(0) };
    }

    impl PartialEq for DecodedReconstructionBase {
        fn eq(&self, other: &Self) -> bool {
            self.encoded_digest == other.encoded_digest
        }
    }

    impl Eq for DecodedReconstructionBase {}

    impl fmt::Debug for DecodedReconstructionBase {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("DecodedReconstructionBase")
                .field("encoded_digest", &hex::encode(self.encoded_digest))
                .field("input_key", &self.value.input_key)
                .field("rows", &self.value.rows.len())
                .finish()
        }
    }

    impl fmt::Debug for DecodedReviewBase {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("DecodedReviewBase")
                .field("encoded_digest", &hex::encode(self.encoded_digest))
                .field("input_key", &self.value.input_key)
                .field("rows", &self.value.rows.len())
                .finish()
        }
    }

    #[derive(serde::Serialize)]
    struct ReviewBaseInputKey<'a> {
        protocol_version: &'static str,
        raw_digest: String,
        interaction_type_remap: &'a [String],
        same_app_stop_types: &'a [String],
        other_stop_types: &'a [String],
        timezone: String,
        timezone_handling: String,
        datetime_of_preprocessing: String,
        deduplicate_exact_rows: bool,
        correct_duplicate_event_timestamps: bool,
        use_filter_file: bool,
        filter_digest: String,
    }

    #[derive(serde::Serialize)]
    struct ReconstructionBaseInputKey<'a> {
        protocol_version: &'static str,
        app_policy_checkpoint: &'a str,
        same_app_stop_types: &'a [String],
        other_stop_types: &'a [String],
        background_apps: BTreeSet<String>,
        model_concurrent_usage: bool,
        allow_stop_event_reuse: bool,
        use_activity_stopped_as_fallback: bool,
        apply_threshold_to_fallback: bool,
        long_duration_threshold_ns: i64,
        proximity_interval_ns: i64,
        effective_minimum_usage_duration_bits: Option<u64>,
        apply_minimum_to_concurrent_subintervals: bool,
    }

    #[derive(serde::Serialize)]
    struct ReviewAnnotationCheckpointInputKey {
        protocol_version: &'static str,
        use_app_codebook: bool,
        codebook_digest: String,
        custom_app_engagement_duration_bits: u64,
        long_data_time_gap_threshold_bits: Vec<u64>,
        long_usage_duration_threshold_bits: Vec<u64>,
        interaction_types_to_remove: Vec<String>,
        filter_zero_duration_sessions: bool,
    }

    #[derive(serde::Serialize)]
    struct ScreenBaseInputKey<'a> {
        protocol_version: &'static str,
        app_policy_checkpoint: &'a str,
        use_apps_forcing_screen_open: bool,
        apps_forcing_digest: String,
        screen_auto_lock_timeout_bits: u64,
        screen_auto_lock_tolerance_bits: u64,
        screen_manual_lock_max_tail_bits: u64,
        screen_keyguard_near_stop_bits: u64,
    }

    fn digest_bytes(bytes: &[u8]) -> String {
        format!("blake3:{}", blake3::hash(bytes).to_hex())
    }

    fn sha256_bytes(bytes: &[u8]) -> String {
        format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
    }

    fn review_base_input_key(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let filter_csv = support.filter_csv(db);
        let interaction_type_remap = early.interaction_type_remap(db);
        let same_app_stop_types = early.same_app_stop_types(db);
        let other_stop_types = early.other_stop_types(db);
        let material = ReviewBaseInputKey {
            protocol_version: REVIEW_BASE_PROTOCOL,
            raw_digest: raw.input_sha256(db),
            interaction_type_remap: interaction_type_remap.as_slice(),
            same_app_stop_types: same_app_stop_types.as_slice(),
            other_stop_types: other_stop_types.as_slice(),
            timezone: early.timezone(db),
            timezone_handling: early.timezone_handling(db),
            datetime_of_preprocessing: early.datetime_of_preprocessing(db),
            deduplicate_exact_rows: early.deduplicate_exact_rows(db),
            correct_duplicate_event_timestamps: early.correct_duplicate_event_timestamps(db),
            use_filter_file: support.use_filter_file(db),
            filter_digest: digest_bytes(&filter_csv),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn review_base_input_key_for_options(
        input_sha256: &str,
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<String, String> {
        let material = ReviewBaseInputKey {
            protocol_version: REVIEW_BASE_PROTOCOL,
            raw_digest: input_sha256.to_string(),
            interaction_type_remap: &options.interaction_type_remap,
            same_app_stop_types: &options.same_app_stop_types,
            other_stop_types: &options.other_stop_types,
            timezone: options.timezone.clone(),
            timezone_handling: options.timezone_handling.clone(),
            datetime_of_preprocessing: options.datetime_of_preprocessing.clone(),
            deduplicate_exact_rows: options.deduplicate_exact_rows,
            correct_duplicate_event_timestamps: options.correct_duplicate_event_timestamps,
            use_filter_file: options.use_filter_file,
            filter_digest: digest_bytes(support.filter_csv),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn reconstruction_base_input_key(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let app_policy_checkpoint =
            review_base_app_policy_checkpoint(db, raw, early, config, support)?;
        let background_apps = background_apps(db, config, support)
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let rebuilds_usage_intervals =
            config.model_concurrent_usage(db) || !background_apps.is_empty();
        let apply_minimum_to_subintervals =
            config.apply_minimum_usage_duration_to_concurrent_subintervals(db);
        let effective_minimum_usage_duration_bits = (!rebuilds_usage_intervals
            || apply_minimum_to_subintervals)
            .then(|| config.minimum_usage_duration(db).to_bits());
        let same_app_stop_types = early.same_app_stop_types(db);
        let other_stop_types = early.other_stop_types(db);
        let material = ReconstructionBaseInputKey {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL,
            app_policy_checkpoint: &app_policy_checkpoint,
            same_app_stop_types: same_app_stop_types.as_slice(),
            other_stop_types: other_stop_types.as_slice(),
            background_apps,
            model_concurrent_usage: config.model_concurrent_usage(db),
            allow_stop_event_reuse: config.allow_stop_event_reuse(db),
            use_activity_stopped_as_fallback: config.use_activity_stopped_as_fallback(db),
            apply_threshold_to_fallback: config.apply_threshold_to_fallback(db),
            long_duration_threshold_ns: config.long_duration_threshold_ns(db),
            proximity_interval_ns: config.proximity_interval_ns(db),
            effective_minimum_usage_duration_bits,
            apply_minimum_to_concurrent_subintervals: apply_minimum_to_subintervals,
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize reconstruction-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn reconstruction_base_input_key_for_options(
        app_policy_checkpoint: &str,
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<String, String> {
        let background_apps = if options.use_background_apps_file {
            super::parse_background_apps_csv(support.background_apps_csv)
                .into_iter()
                .collect::<BTreeSet<_>>()
        } else {
            BTreeSet::new()
        };
        let rebuilds_usage_intervals =
            options.model_concurrent_usage || !background_apps.is_empty();
        let effective_minimum_usage_duration_bits = (!rebuilds_usage_intervals
            || options.apply_minimum_usage_duration_to_concurrent_subintervals)
            .then(|| options.minimum_usage_duration.to_bits());
        let material = ReconstructionBaseInputKey {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL,
            app_policy_checkpoint,
            same_app_stop_types: &options.same_app_stop_types,
            other_stop_types: &options.other_stop_types,
            background_apps,
            model_concurrent_usage: options.model_concurrent_usage,
            allow_stop_event_reuse: options.allow_stop_event_reuse,
            use_activity_stopped_as_fallback: options.use_activity_stopped_as_fallback,
            apply_threshold_to_fallback: options.apply_threshold_to_fallback,
            long_duration_threshold_ns: options.long_duration_threshold_ns,
            proximity_interval_ns: options.proximity_interval_ns,
            effective_minimum_usage_duration_bits,
            apply_minimum_to_concurrent_subintervals: options
                .apply_minimum_usage_duration_to_concurrent_subintervals,
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize reconstruction-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn review_annotation_checkpoint_input_key(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let use_app_codebook = support.use_app_codebook(db);
        let material = ReviewAnnotationCheckpointInputKey {
            protocol_version: "chronicle-review-annotation-checkpoint/v1",
            use_app_codebook,
            codebook_digest: if use_app_codebook {
                digest_bytes(&support.codebook_csv(db))
            } else {
                digest_bytes(&[])
            },
            custom_app_engagement_duration_bits: config
                .custom_app_engagement_duration(db)
                .to_bits(),
            long_data_time_gap_threshold_bits: config
                .long_data_time_gap_thresholds(db)
                .iter()
                .map(|value| value.to_bits())
                .collect(),
            long_usage_duration_threshold_bits: config
                .long_usage_duration_thresholds(db)
                .iter()
                .map(|value| value.to_bits())
                .collect(),
            interaction_types_to_remove: config.interaction_types_to_remove(db).as_ref().clone(),
            filter_zero_duration_sessions: config.filter_zero_duration_sessions(db),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review annotation checkpoint key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    /// Pick the deepest usable checkpoint before copying inputs into Salsa.
    /// A reconstruction base subsumes the full review base, so only its small
    /// verified header is retained to prove the app-policy checkpoint.
    pub(super) fn select_persisted_base_kind(
        input_sha256: &str,
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<PersistedReviewBaseSelection, String> {
        if review_base_bytes.is_empty() {
            return Ok(PersistedReviewBaseSelection::None);
        }
        let review_header = review_base_header(review_base_bytes)?;
        let expected_review_key =
            review_base_input_key_for_options(input_sha256, options, support)?;
        if review_header.input_key
            != parse_blake3_key(&expected_review_key, "expected review-base input key")?
        {
            return Ok(PersistedReviewBaseSelection::None);
        }
        if reconstruction_base_bytes.is_empty() {
            return Ok(PersistedReviewBaseSelection::Review);
        }
        let app_policy_checkpoint = format!(
            "sha256:{}",
            hex::encode(review_header.app_policy_checkpoint)
        );
        let expected_reconstruction_key =
            reconstruction_base_input_key_for_options(&app_policy_checkpoint, options, support)?;
        if reconstruction_base_header_input_key(reconstruction_base_bytes)?
            == parse_blake3_key(
                &expected_reconstruction_key,
                "expected reconstruction-base input key",
            )?
        {
            return Ok(PersistedReviewBaseSelection::Reconstruction);
        }
        Ok(PersistedReviewBaseSelection::Review)
    }

    pub(super) const fn review_base_header_bytes() -> usize {
        REVIEW_BASE_HEADER_BYTES
    }

    pub(super) const fn reconstruction_base_header_bytes() -> usize {
        RECONSTRUCTION_BASE_HEADER_BYTES
    }

    fn select_persisted_bases<'a>(
        input_sha256: &str,
        review_base_bytes: &'a [u8],
        reconstruction_base_bytes: &'a [u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<(&'a [u8], &'a [u8]), String> {
        match select_persisted_base_kind(
            input_sha256,
            review_base_bytes,
            reconstruction_base_bytes,
            options,
            support,
        )? {
            PersistedReviewBaseSelection::None => Ok((&[], &[])),
            PersistedReviewBaseSelection::Review => Ok((review_base_bytes, &[])),
            PersistedReviewBaseSelection::Reconstruction => Ok((
                &review_base_bytes[..REVIEW_BASE_HEADER_BYTES],
                reconstruction_base_bytes,
            )),
        }
    }

    #[salsa::tracked(returns(clone))]
    fn screen_base_input_key(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        db.record_internal_query_body("screen_base_input_key");
        let app_policy_checkpoint =
            review_base_app_policy_checkpoint(db, raw, early, config, support)?;
        let use_apps_forcing_screen_open = support.use_apps_forcing_screen_open(db);
        let apps_forcing_digest = if use_apps_forcing_screen_open {
            digest_bytes(&support.apps_forcing_csv(db))
        } else {
            String::new()
        };
        let material = ScreenBaseInputKey {
            protocol_version: "chronicle-screen-base/v1",
            app_policy_checkpoint: &app_policy_checkpoint,
            use_apps_forcing_screen_open,
            apps_forcing_digest,
            screen_auto_lock_timeout_bits: support.screen_auto_lock_timeout_seconds(db).to_bits(),
            screen_auto_lock_tolerance_bits: support
                .screen_auto_lock_tolerance_seconds(db)
                .to_bits(),
            screen_manual_lock_max_tail_bits: support
                .screen_manual_lock_max_tail_seconds(db)
                .to_bits(),
            screen_keyguard_near_stop_bits: support.screen_keyguard_near_stop_seconds(db).to_bits(),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize screen-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn review_base_app_policy_checkpoint(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let review_base = raw.review_base_bytes(db);
        if !review_base.is_empty() {
            let header = review_base_header(&review_base)?;
            let expected_key = review_base_input_key(db, raw, early, support)?;
            if header.input_key
                == parse_blake3_key(&expected_key, "expected review-base input key")?
            {
                return Ok(format!(
                    "sha256:{}",
                    hex::encode(header.app_policy_checkpoint)
                ));
            }
        }
        Ok(mark_app_policy_matches(db, raw, early, config, support)?
            .checkpoint
            .terminal_digest)
    }

    fn encode_review_base(base: &ReviewBase) -> Result<Vec<u8>, String> {
        encode_review_base_within(base, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES)
    }

    /// The ceiling is a hard reject bound, not a buffer hint: past it the base
    /// is refused and the review-event typed resume stops engaging. It is taken as
    /// an argument so the exact reject boundary can be exercised without
    /// serializing a base the size of the real ceiling; the wrapper above is
    /// the only caller that chooses which ceiling applies.
    fn encode_review_base_within(
        base: &ReviewBase,
        max_uncompressed_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        let bytes = with_serialized_row_string_table(|| postcard::to_allocvec(base))
            .map_err(|error| format!("encode review base: {error}"))?;
        if bytes.len() > max_uncompressed_bytes {
            return Err(format!(
                "review base is too large: {} bytes exceeds {}",
                bytes.len(),
                max_uncompressed_bytes
            ));
        }
        let compressed = lz4_flex::block::compress(&bytes);
        let input_key_digest = parse_blake3_key(&base.input_key, "review-base input key")?;
        let app_policy_checkpoint = base
            .metadata
            .query_checkpoints
            .get("mark_app_policy_matches")
            .ok_or_else(|| "review base is missing its app-policy checkpoint".to_string())?;
        let app_policy_digest = parse_sha256_digest(
            &app_policy_checkpoint.terminal_digest,
            "review-base app-policy checkpoint",
        )?;
        let mut encoded = Vec::with_capacity(REVIEW_BASE_HEADER_BYTES + compressed.len());
        encoded.extend_from_slice(REVIEW_BASE_MAGIC);
        encoded.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        // Authenticate the stored bytes before allocating the declared
        // decompressed size. This also avoids hashing the much larger decoded
        // row table on every comparison.
        encoded.extend_from_slice(blake3::hash(&compressed).as_bytes());
        encoded.extend_from_slice(&input_key_digest);
        encoded.extend_from_slice(&app_policy_digest);
        encoded.extend_from_slice(&compressed);
        Ok(encoded)
    }

    fn review_base_header(bytes: &[u8]) -> Result<ReviewBaseHeader, String> {
        if bytes.len() < REVIEW_BASE_HEADER_BYTES {
            return Err("review base is truncated".into());
        }
        if &bytes[..REVIEW_BASE_MAGIC.len()] != REVIEW_BASE_MAGIC {
            return Err("review base has an invalid header".into());
        }
        let input_key_offset = REVIEW_BASE_MAGIC.len() + 4 + 32;
        let app_policy_offset = input_key_offset + 32;
        Ok(ReviewBaseHeader {
            input_key: bytes[input_key_offset..app_policy_offset]
                .try_into()
                .expect("32-byte review-base input key"),
            app_policy_checkpoint: bytes[app_policy_offset..app_policy_offset + 32]
                .try_into()
                .expect("32-byte review-base app-policy checkpoint"),
        })
    }

    fn verify_review_base_payload(bytes: &[u8]) -> Result<VerifiedReviewBaseHeader, String> {
        let header = review_base_header(bytes)?;
        let size_offset = REVIEW_BASE_MAGIC.len();
        let digest_offset = size_offset + 4;
        let payload_offset = REVIEW_BASE_HEADER_BYTES;
        let declared = u32::from_le_bytes(
            bytes[size_offset..digest_offset]
                .try_into()
                .expect("four-byte review-base size"),
        );
        if declared as usize > MAX_REVIEW_BASE_UNCOMPRESSED_BYTES {
            return Err(format!(
                "review base declares {} bytes, exceeding {}",
                declared, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES
            ));
        }
        let timer = QueryTimer::start("decode_review_base_verify_digest");
        let payload_digest = *blake3::hash(&bytes[payload_offset..]).as_bytes();
        if payload_digest != bytes[digest_offset..digest_offset + 32] {
            return Err("review base payload digest mismatch".into());
        }
        timer.finish();
        Ok(VerifiedReviewBaseHeader {
            input_key: header.input_key,
            app_policy_checkpoint: header.app_policy_checkpoint,
            payload_digest,
            declared_bytes: declared as usize,
        })
    }

    fn decode_verified_review_base_bytes(
        bytes: &[u8],
        header: &VerifiedReviewBaseHeader,
    ) -> Result<ReviewBase, String> {
        #[cfg(test)]
        REVIEW_BASE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
        let payload_offset = REVIEW_BASE_HEADER_BYTES;
        let timer = QueryTimer::start("decode_review_base_decompress");
        let decoded = lz4_flex::block::decompress(&bytes[payload_offset..], header.declared_bytes)
            .map_err(|error| format!("decompress review base: {error}"))?;
        timer.finish();
        let timer = QueryTimer::start("decode_review_base_payload");
        let base: ReviewBase = with_deserialized_row_string_pool(|| postcard::from_bytes(&decoded))
            .map_err(|error| format!("decode review base: {error}"))?;
        timer.finish();
        if base.protocol_version != REVIEW_BASE_PROTOCOL {
            return Err(format!(
                "unsupported review-base protocol: {}",
                base.protocol_version
            ));
        }
        if let Some(digests) = &base.matcher_search_suffix_digests {
            let expected = base.rows.len() + 1;
            if digests.len() != expected {
                return Err(format!(
                    "review base has {} matcher suffix digests; expected {expected}",
                    digests.len()
                ));
            }
        }
        if parse_blake3_key(&base.input_key, "review-base payload input key")? != header.input_key {
            return Err("review base header input key mismatch".into());
        }
        let app_policy_checkpoint = base
            .metadata
            .query_checkpoints
            .get("mark_app_policy_matches")
            .ok_or_else(|| "review base is missing its app-policy checkpoint".to_string())?;
        if parse_sha256_digest(
            &app_policy_checkpoint.terminal_digest,
            "review-base payload app-policy checkpoint",
        )? != header.app_policy_checkpoint
        {
            return Err("review base header app-policy checkpoint mismatch".into());
        }
        Ok(base)
    }

    #[cfg(test)]
    fn decode_review_base_bytes(bytes: &[u8]) -> Result<ReviewBase, String> {
        let header = verify_review_base_payload(bytes)?;
        decode_verified_review_base_bytes(bytes, &header)
    }

    fn decode_review_base_cached(bytes: &[u8]) -> Result<Arc<ReviewBase>, String> {
        // A byte-equal request is proven identical to the verified encoded
        // bytes by direct comparison, which is several times cheaper than
        // re-hashing the payload. Corrupt or merely different bytes fail the
        // comparison and take the full verify-then-decode path below, so
        // tampered bases are still rejected.
        if let Some(value) = REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.encoded_bytes.as_slice() == bytes)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }
        let header = verify_review_base_payload(bytes)?;
        if let Some(value) = REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.payload_digest == header.payload_digest)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }

        REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache.borrow_mut().take();
        });
        let value = Arc::new(decode_verified_review_base_bytes(bytes, &header)?);
        REVIEW_BASE_DECODE_CACHE.with(|cache| {
            *cache.borrow_mut() = Some(CachedDecodedReviewBase {
                payload_digest: header.payload_digest,
                encoded_bytes: Arc::new(bytes.to_vec()),
                value: Arc::clone(&value),
            });
        });
        Ok(value)
    }

    fn same_row_identity(
        left: &Row,
        right: &Row,
        left_scratch: &mut RowCheckpointScratch,
        right_scratch: &mut RowCheckpointScratch,
    ) -> bool {
        row_checkpoint_parts(left, left_scratch).identity
            == row_checkpoint_parts(right, right_scratch).identity
    }

    fn persist_reconstruction_base(
        base: &ReconstructionBase,
    ) -> Result<PersistedReconstructionBase, String> {
        let mut annotation_index = 0_usize;
        let annotation_rows = base.annotation_checkpoint.rows.as_slice();
        let mut reconstruction_scratch = RowCheckpointScratch::default();
        let mut annotation_scratch = RowCheckpointScratch::default();
        let mut reused = 0_usize;
        let mut replaced = 0_usize;
        let mut dropped = 0_usize;
        let row_states = base
            .rows
            .iter()
            .map(|reconstruction| {
                let annotation = annotation_rows.get(annotation_index);
                let disposition = match annotation {
                    Some(annotation)
                        if same_row_identity(
                            reconstruction,
                            annotation,
                            &mut reconstruction_scratch,
                            &mut annotation_scratch,
                        ) =>
                    {
                        annotation_index += 1;
                        if Arc::ptr_eq(&reconstruction.0, &annotation.0) {
                            reused += 1;
                            PersistedAnnotationRow::Reuse
                        } else {
                            replaced += 1;
                            PersistedAnnotationRow::Replace(annotation.clone())
                        }
                    }
                    _ => {
                        dropped += 1;
                        PersistedAnnotationRow::Drop
                    }
                };
                PersistedReconstructionRow {
                    reconstruction: reconstruction.clone(),
                    annotation: disposition,
                }
            })
            .collect::<Vec<_>>();
        if annotation_index != annotation_rows.len() {
            return Err(format!(
                "annotation rows are not an identity-preserving subsequence of reconstruction rows: matched {annotation_index} of {}",
                annotation_rows.len()
            ));
        }
        #[cfg(feature = "query-timing")]
        eprintln!(
            "reconstruction_base_rows total={} reused={reused} replaced={replaced} dropped={dropped}",
            row_states.len(),
        );

        let annotation = &base.annotation_checkpoint;
        Ok(PersistedReconstructionBase {
            protocol_version: base.protocol_version.clone(),
            input_key: base.input_key.clone(),
            row_states,
            resolve_excluded_packages: base.resolve_excluded_packages.clone(),
            mask_excluded_app_events: base.mask_excluded_app_events.clone(),
            build_app_event_index: base.build_app_event_index.clone(),
            match_app_episodes: base.match_app_episodes.clone(),
            materialize_candidate_episodes: base.materialize_candidate_episodes.clone(),
            segment_concurrent_usage: base.segment_concurrent_usage.clone(),
            reconstruct_episodes: base.reconstruct_episodes.clone(),
            annotation_checkpoint: PersistedReviewAnnotationCheckpointBase {
                input_key: annotation.input_key.clone(),
                join_app_codebook: annotation.join_app_codebook.clone(),
                derive_broad_category: annotation.derive_broad_category.clone(),
                collapse_app_genre: annotation.collapse_app_genre.clone(),
                categorize_apps: annotation.categorize_apps.clone(),
                derive_engagement_basis: annotation.derive_engagement_basis.clone(),
                apply_episode_flags: annotation.apply_episode_flags.clone(),
                episode_annotations: annotation.episode_annotations.clone(),
                suppress_excluded_timing: annotation.suppress_excluded_timing.clone(),
                remove_selected_interaction_types: annotation
                    .remove_selected_interaction_types
                    .clone(),
                remove_zero_duration_rows: annotation.remove_zero_duration_rows.clone(),
                interval_cleaning: annotation.interval_cleaning.clone(),
            },
            early_metadata: base.early_metadata.clone(),
            screen: base.screen.clone(),
        })
    }

    fn restore_reconstruction_base(
        persisted: PersistedReconstructionBase,
    ) -> Result<ReconstructionBase, String> {
        let mut reconstruction_rows = Vec::with_capacity(persisted.row_states.len());
        let mut annotation_rows = Vec::with_capacity(persisted.row_states.len());
        let mut reconstruction_scratch = RowCheckpointScratch::default();
        let mut annotation_scratch = RowCheckpointScratch::default();
        for state in persisted.row_states {
            let PersistedReconstructionRow {
                reconstruction,
                annotation,
            } = state;
            match annotation {
                PersistedAnnotationRow::Reuse => {
                    annotation_rows.push(reconstruction.clone());
                }
                PersistedAnnotationRow::Replace(annotation) => {
                    if !same_row_identity(
                        &reconstruction,
                        &annotation,
                        &mut reconstruction_scratch,
                        &mut annotation_scratch,
                    ) {
                        return Err("persisted annotation replacement changed row identity".into());
                    }
                    annotation_rows.push(annotation);
                }
                PersistedAnnotationRow::Drop => {}
            }
            reconstruction_rows.push(reconstruction);
        }
        let annotation = persisted.annotation_checkpoint;
        Ok(ReconstructionBase {
            protocol_version: persisted.protocol_version,
            input_key: persisted.input_key,
            rows: Arc::new(reconstruction_rows),
            resolve_excluded_packages: persisted.resolve_excluded_packages,
            mask_excluded_app_events: persisted.mask_excluded_app_events,
            build_app_event_index: persisted.build_app_event_index,
            match_app_episodes: persisted.match_app_episodes,
            materialize_candidate_episodes: persisted.materialize_candidate_episodes,
            segment_concurrent_usage: persisted.segment_concurrent_usage,
            reconstruct_episodes: persisted.reconstruct_episodes,
            annotation_checkpoint: ReviewAnnotationCheckpointBase {
                input_key: annotation.input_key,
                rows: Arc::new(annotation_rows),
                join_app_codebook: annotation.join_app_codebook,
                derive_broad_category: annotation.derive_broad_category,
                collapse_app_genre: annotation.collapse_app_genre,
                categorize_apps: annotation.categorize_apps,
                derive_engagement_basis: annotation.derive_engagement_basis,
                apply_episode_flags: annotation.apply_episode_flags,
                episode_annotations: annotation.episode_annotations,
                suppress_excluded_timing: annotation.suppress_excluded_timing,
                remove_selected_interaction_types: annotation.remove_selected_interaction_types,
                remove_zero_duration_rows: annotation.remove_zero_duration_rows,
                interval_cleaning: annotation.interval_cleaning,
            },
            early_metadata: persisted.early_metadata,
            screen: persisted.screen,
        })
    }

    fn encode_reconstruction_base(base: &ReconstructionBase) -> Result<Vec<u8>, String> {
        encode_reconstruction_base_within(base, MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES)
    }

    /// Same hard reject bound as `encode_review_base_within`, for the reconstruction
    /// resume base.
    fn encode_reconstruction_base_within(
        base: &ReconstructionBase,
        max_uncompressed_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        let persisted = persist_reconstruction_base(base)?;
        let bytes = with_serialized_row_string_table(|| postcard::to_allocvec(&persisted))
            .map_err(|error| format!("encode reconstruction base: {error}"))?;
        if bytes.len() > max_uncompressed_bytes {
            return Err(format!(
                "reconstruction base is too large: {} bytes exceeds {}",
                bytes.len(),
                max_uncompressed_bytes
            ));
        }
        let compressed = lz4_flex::block::compress(&bytes);
        let input_key_digest = parse_blake3_key(&base.input_key, "reconstruction-base input key")?;
        let mut encoded = Vec::with_capacity(RECONSTRUCTION_BASE_HEADER_BYTES + compressed.len());
        encoded.extend_from_slice(RECONSTRUCTION_BASE_MAGIC);
        encoded.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        encoded.extend_from_slice(blake3::hash(&compressed).as_bytes());
        encoded.extend_from_slice(&input_key_digest);
        encoded.extend_from_slice(&compressed);
        Ok(encoded)
    }

    fn parse_blake3_key(value: &str, label: &str) -> Result<[u8; 32], String> {
        let encoded = value
            .strip_prefix("blake3:")
            .ok_or_else(|| format!("{label} does not use blake3"))?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(encoded, &mut digest)
            .map_err(|error| format!("decode {label}: {error}"))?;
        Ok(digest)
    }

    fn parse_sha256_digest(value: &str, label: &str) -> Result<[u8; 32], String> {
        let encoded = value
            .strip_prefix("sha256:")
            .ok_or_else(|| format!("{label} does not use sha256"))?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(encoded, &mut digest)
            .map_err(|error| format!("decode {label}: {error}"))?;
        Ok(digest)
    }

    fn reconstruction_base_header_input_key(bytes: &[u8]) -> Result<[u8; 32], String> {
        if bytes.len() < RECONSTRUCTION_BASE_HEADER_BYTES {
            return Err("reconstruction base is truncated".into());
        }
        if &bytes[..RECONSTRUCTION_BASE_MAGIC.len()] != RECONSTRUCTION_BASE_MAGIC {
            return Err("reconstruction base has an invalid header".into());
        }
        let input_key_offset = RECONSTRUCTION_BASE_MAGIC.len() + 4 + 32;
        Ok(bytes[input_key_offset..input_key_offset + 32]
            .try_into()
            .expect("32-byte reconstruction-base input key"))
    }

    #[derive(Debug)]
    struct VerifiedReconstructionBaseHeader {
        input_key: [u8; 32],
        payload_digest: [u8; 32],
        declared_bytes: usize,
    }

    fn verify_reconstruction_base_payload(
        bytes: &[u8],
    ) -> Result<VerifiedReconstructionBaseHeader, String> {
        let header_input_key = reconstruction_base_header_input_key(bytes)?;
        let size_offset = RECONSTRUCTION_BASE_MAGIC.len();
        let digest_offset = size_offset + 4;
        let payload_offset = RECONSTRUCTION_BASE_HEADER_BYTES;
        let declared = u32::from_le_bytes(
            bytes[size_offset..digest_offset]
                .try_into()
                .expect("four-byte reconstruction-base size"),
        );
        if declared as usize > MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES {
            return Err(format!(
                "reconstruction base declares {} bytes, exceeding {}",
                declared, MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES
            ));
        }
        let timer = QueryTimer::start("decode_reconstruction_base_verify_digest");
        let payload_digest = *blake3::hash(&bytes[payload_offset..]).as_bytes();
        if payload_digest != bytes[digest_offset..digest_offset + 32] {
            return Err("reconstruction base payload digest mismatch".into());
        }
        timer.finish();
        Ok(VerifiedReconstructionBaseHeader {
            input_key: header_input_key,
            payload_digest,
            declared_bytes: declared as usize,
        })
    }

    fn decode_verified_reconstruction_base_bytes(
        bytes: &[u8],
        header: &VerifiedReconstructionBaseHeader,
    ) -> Result<ReconstructionBase, String> {
        #[cfg(test)]
        RECONSTRUCTION_BASE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
        let payload_offset = RECONSTRUCTION_BASE_HEADER_BYTES;
        let timer = QueryTimer::start("decode_reconstruction_base_decompress");
        let decoded = lz4_flex::block::decompress(&bytes[payload_offset..], header.declared_bytes)
            .map_err(|error| format!("decompress reconstruction base: {error}"))?;
        timer.finish();
        let timer = QueryTimer::start("decode_reconstruction_base_payload");
        let persisted: PersistedReconstructionBase =
            with_deserialized_row_string_pool(|| postcard::from_bytes(&decoded))
                .map_err(|error| format!("decode reconstruction base: {error}"))?;
        timer.finish();
        if persisted.protocol_version != RECONSTRUCTION_BASE_PROTOCOL {
            return Err(format!(
                "unsupported reconstruction-base protocol: {}",
                persisted.protocol_version
            ));
        }
        let base = restore_reconstruction_base(persisted)?;
        if parse_blake3_key(&base.input_key, "reconstruction-base payload input key")?
            != header.input_key
        {
            return Err("reconstruction base header input key mismatch".into());
        }
        Ok(base)
    }

    #[cfg(test)]
    fn decode_reconstruction_base_bytes(bytes: &[u8]) -> Result<ReconstructionBase, String> {
        let header = verify_reconstruction_base_payload(bytes)?;
        decode_verified_reconstruction_base_bytes(bytes, &header)
    }

    fn decode_reconstruction_base_cached(bytes: &[u8]) -> Result<Arc<ReconstructionBase>, String> {
        // A byte-equal request is proven identical to the verified encoded
        // bytes by direct comparison, which is several times cheaper than
        // re-hashing the payload. Corrupt or merely different bytes fail the
        // comparison and take the full verify-then-decode path below, so
        // tampered bases are still rejected.
        if let Some(value) = RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.encoded_bytes.as_slice() == bytes)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }
        let header = verify_reconstruction_base_payload(bytes)?;
        if let Some(value) = RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.payload_digest == header.payload_digest)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }

        // Drop a prior file's decoded rows before allocating the next file's
        // checkpoint so a miss does not retain two large workspaces.
        RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache.borrow_mut().take();
        });
        let value = Arc::new(decode_verified_reconstruction_base_bytes(bytes, &header)?);
        RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            *cache.borrow_mut() = Some(CachedDecodedReconstructionBase {
                payload_digest: header.payload_digest,
                encoded_bytes: Arc::new(bytes.to_vec()),
                value: Arc::clone(&value),
            });
        });
        Ok(value)
    }

    impl<T> fmt::Debug for QueryValue<T> {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("QueryValue")
                .field("step", &self.checkpoint.subject_id)
                .field("digest", &self.checkpoint.terminal_digest)
                .finish()
        }
    }

    fn value_step<T: serde::Serialize>(step: &str, value: T) -> Result<QueryValue<T>, String> {
        value_step_shared(step, Arc::new(value))
    }

    /// value_step for an already-shared value, so a step that passes its
    /// input through unchanged can reuse the upstream allocation. The
    /// checkpoint is byte-identical to value_step's.
    fn value_step_shared<T: serde::Serialize>(
        step: &str,
        value: Arc<T>,
    ) -> Result<QueryValue<T>, String> {
        let fingerprint = super::value_fingerprint(&*value)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(QueryValue {
            value,
            checkpoint: workflow_checkpoint(step, &[], &[("value", &fingerprint)]),
            query_group_checkpoint: None,
        })
    }

    fn rows_step(step: &str, rows: Vec<Row>) -> QueryValue<Vec<Row>> {
        let checkpoint = workflow_rows_checkpoint(step, &rows);
        QueryValue {
            value: Arc::new(rows),
            checkpoint,
            query_group_checkpoint: None,
        }
    }

    fn same_row_state(left: &WorkflowCheckpoint, right: &WorkflowCheckpoint) -> bool {
        left.row_membership_digest == right.row_membership_digest
            && left.row_order_digest == right.row_order_digest
            && left.temporal_state_digest == right.temporal_state_digest
            && left.classification_digest == right.classification_digest
            && left.payload_digest == right.payload_digest
            && left.schema_digest == right.schema_digest
    }

    /// Keep the upstream row allocation when a real step is observationally
    /// unchanged. The step still has its own checkpoint and execution event;
    /// only the identical immutable row table is shared between Salsa memos.
    fn rows_step_reusing(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        rows: Vec<Row>,
    ) -> QueryValue<Vec<Row>> {
        let exact_same_rows = rows.len() == upstream.value.len()
            && rows
                .iter()
                .zip(upstream.value.iter())
                .all(|(left, right)| Arc::ptr_eq(&left.0, &right.0));
        let (checkpoint, value) = if exact_same_rows {
            (
                checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[]),
                Arc::clone(&upstream.value),
            )
        } else {
            let checkpoint = if rows.len() == upstream.value.len() {
                let parts = row_checkpoint_parts_for_rows(&rows);
                workflow_checkpoint_with_reusable_rows(
                    step,
                    &rows,
                    &[],
                    &parts,
                    &upstream.value,
                    &upstream.checkpoint,
                )
            } else {
                workflow_rows_checkpoint(step, &rows)
            };
            let value = if same_row_state(&upstream.checkpoint, &checkpoint) {
                Arc::clone(&upstream.value)
            } else {
                Arc::new(rows)
            };
            (checkpoint, value)
        };
        QueryValue {
            value,
            checkpoint,
            query_group_checkpoint: None,
        }
    }

    fn unchanged_rows_step(step: &str, upstream: &QueryValue<Vec<Row>>) -> QueryValue<Vec<Row>> {
        QueryValue {
            value: Arc::clone(&upstream.value),
            checkpoint: checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[]),
            query_group_checkpoint: None,
        }
    }

    fn unchanged_rows_with_payload<P: serde::Serialize>(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        payload: &P,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(QueryValue {
            value: Arc::clone(&upstream.value),
            checkpoint: checkpoint_for_exact_row_state(
                step,
                &upstream.checkpoint,
                &[("value", &fingerprint)],
            ),
            query_group_checkpoint: None,
        })
    }

    fn value_payload_step<T, P: serde::Serialize>(
        step: &str,
        value: T,
        payload: &P,
    ) -> Result<QueryValue<T>, String> {
        let checkpoint = value_payload_checkpoint(step, payload)?;
        Ok(QueryValue {
            value: Arc::new(value),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    fn value_payload_checkpoint<P: serde::Serialize>(
        step: &str,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint(step, &[], &[("value", &fingerprint)]))
    }

    fn rows_and_value_checkpoint<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint(
            step,
            &[("rows", rows)],
            &[("value", &fingerprint)],
        ))
    }

    fn rows_and_value_checkpoint_reusing<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        previous_rows: &[Row],
        previous_checkpoint: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        let parts = row_checkpoint_parts_for_rows(rows);
        Ok(workflow_checkpoint_with_reusable_rows(
            step,
            rows,
            &[("value", &fingerprint)],
            &parts,
            previous_rows,
            previous_checkpoint,
        ))
    }

    fn rows_and_value_checkpoint_reusing_membership_and_order<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        previous_rows: &[Row],
        previous_checkpoint: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint_with_known_membership_and_order(
            step,
            rows,
            &[("value", &fingerprint)],
            previous_rows,
            previous_checkpoint,
        ))
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct CanonicalTemporalSequence {
        /// Exact bytes consumed by the v6 temporal-state checkpoint for each
        /// row, in canonical source-identity order (24 bytes per row: 8-byte
        /// length frame + the 16-byte temporal part; identity is committed by
        /// the membership digest in the same order). Keeping this private
        /// buffer lets a repeated threshold edit patch changed rows and issue
        /// one SIMD-friendly BLAKE3 update instead of rebuilding 100k small
        /// hash writes.
        encoded_rows: Arc<Vec<u8>>,
        /// Current row index -> canonical source-identity position.
        canonical_positions: Arc<Vec<u32>>,
    }

    /// v6 temporal-state stride in `CanonicalTemporalSequence::encoded_rows`.
    const TEMPORAL_SEQUENCE_STRIDE: usize = 24;
    /// Offset of the 32-byte temporal part within one stride.
    const TEMPORAL_SEQUENCE_PART_OFFSET: usize = 8;

    fn canonical_row_order(rows: &[Row]) -> Vec<usize> {
        let mut canonical_order = (0..rows.len()).collect::<Vec<_>>();
        if rows.windows(2).all(|pair| {
            pair[0]
                .source_data_rows
                .cmp_expanded(&pair[1].source_data_rows)
                .then(pair[0].index.cmp(&pair[1].index))
                .is_le()
        }) {
            return canonical_order;
        }
        canonical_order.sort_by(|left, right| {
            rows[*left]
                .source_data_rows
                .cmp_expanded(&rows[*right].source_data_rows)
                .then(rows[*left].index.cmp(&rows[*right].index))
        });
        canonical_order
    }

    fn canonical_temporal_sequence_with_order(
        rows: &[Row],
        canonical_order: &[usize],
    ) -> CanonicalTemporalSequence {
        debug_assert_eq!(canonical_order.len(), rows.len());
        let mut canonical_positions = vec![0_u32; rows.len()];
        let mut encoded_rows = Vec::with_capacity(rows.len() * TEMPORAL_SEQUENCE_STRIDE);
        let mut scratch = RowCheckpointScratch::default();
        for (position, &row_index) in canonical_order.iter().enumerate() {
            canonical_positions[row_index] = position as u32;
            let parts = row_checkpoint_parts(&rows[row_index], &mut scratch);
            checkpoint_digest_fixed16(&mut encoded_rows, &parts.temporal);
        }
        CanonicalTemporalSequence {
            encoded_rows: Arc::new(encoded_rows),
            canonical_positions: Arc::new(canonical_positions),
        }
    }

    fn temporal_digest_with_changed_rows(
        base: &CanonicalTemporalSequence,
        rows: &[Row],
        changed_row_indices: &[u32],
    ) -> String {
        debug_assert_eq!(base.canonical_positions.len(), rows.len());
        let mut encoded_rows = (*base.encoded_rows).clone();
        let mut scratch = RowCheckpointScratch::default();
        for &row_index in changed_row_indices {
            let row_index = row_index as usize;
            let canonical_position = base.canonical_positions[row_index] as usize;
            let temporal_offset =
                canonical_position * TEMPORAL_SEQUENCE_STRIDE + TEMPORAL_SEQUENCE_PART_OFFSET;
            let parts = row_checkpoint_parts(&rows[row_index], &mut scratch);
            encoded_rows[temporal_offset..temporal_offset + 16].copy_from_slice(&parts.temporal);
        }
        let mut temporal = checkpoint_hasher("temporal-state");
        temporal.update(&1_u64.to_le_bytes());
        checkpoint_digest_field(&mut temporal, b"rows");
        temporal.update(&(rows.len() as u64).to_le_bytes());
        temporal.update(&encoded_rows);
        finish_checkpoint_digest(temporal)
    }

    fn checkpoint_with_known_row_components<P: serde::Serialize>(
        step: &str,
        previous: &WorkflowCheckpoint,
        temporal_state_digest: String,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(checkpoint_with_known_row_component_payloads(
            step,
            previous,
            temporal_state_digest,
            &[("value", &fingerprint)],
        ))
    }

    fn checkpoint_with_known_row_component_payloads(
        step: &str,
        previous: &WorkflowCheckpoint,
        temporal_state_digest: String,
        payloads: &[(&str, &[u8])],
    ) -> WorkflowCheckpoint {
        let mut payload_hasher = checkpoint_hasher("payload");
        let mut schema = checkpoint_hasher("schema");
        checkpoint_digest_field(&mut schema, WORKFLOW_ROW_SCHEMA.as_bytes());
        schema.update(&1_u64.to_le_bytes());
        checkpoint_digest_field(&mut schema, b"rows");
        payload_hasher.update(&(payloads.len() as u64).to_le_bytes());
        schema.update(&(payloads.len() as u64).to_le_bytes());
        for (label, bytes) in payloads {
            checkpoint_digest_field(&mut payload_hasher, label.as_bytes());
            checkpoint_digest_field(&mut payload_hasher, bytes);
            checkpoint_digest_field(&mut schema, label.as_bytes());
        }
        let payload_digest = finish_checkpoint_digest(payload_hasher);
        let schema_digest = finish_checkpoint_digest(schema);
        let terminal_digest = terminal_checkpoint_digest(
            step,
            [
                &previous.row_membership_digest,
                &previous.row_order_digest,
                &temporal_state_digest,
                &previous.classification_digest,
                &payload_digest,
                &schema_digest,
            ],
        );
        WorkflowCheckpoint {
            protocol_version: WORKFLOW_CHECKPOINT_PROTOCOL.into(),
            subject_id: step.into(),
            row_membership_digest: previous.row_membership_digest.clone(),
            row_order_digest: previous.row_order_digest.clone(),
            temporal_state_digest,
            classification_digest: previous.classification_digest.clone(),
            payload_digest,
            schema_digest,
            terminal_digest,
        }
    }

    fn review_passthrough_checkpoint<P: serde::Serialize>(
        step: &str,
        upstream: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} review checkpoint: {error}"))?;
        Ok(workflow_checkpoint(
            step,
            &[],
            &[
                ("review_passthrough", upstream.terminal_digest.as_bytes()),
                ("value", &fingerprint),
            ],
        ))
    }

    /// A cheap Merkle-style checkpoint for an intermediate review step. Its
    /// identity is derived from exact upstream checkpoints and the step's own
    /// semantic parameters. The final row-producing boundary is still hashed
    /// from its actual rows, so review mode does not repeatedly hash the same
    /// 100k-row table at every adjacent logical boundary.
    fn review_derived_checkpoint<P: serde::Serialize>(
        step: &str,
        dependencies: &[(&str, &WorkflowCheckpoint)],
        parameters: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let dependencies = dependencies
            .iter()
            .map(|(role, checkpoint)| {
                serde_json::json!({
                    "role": role,
                    "subjectId": checkpoint.subject_id,
                    "terminalDigest": checkpoint.terminal_digest,
                })
            })
            .collect::<Vec<_>>();
        value_payload_checkpoint(
            step,
            &serde_json::json!({
                "checkpointMode": "review-derived-v1",
                "dependencies": dependencies,
                "parameters": parameters,
            }),
        )
    }

    fn review_passthrough_rows<P: serde::Serialize>(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        payload: &P,
        query_group: Option<&str>,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let checkpoint = review_passthrough_checkpoint(step, &upstream.checkpoint, payload)?;
        let query_group_checkpoint = query_group.map(|node| {
            workflow_checkpoint(
                node,
                &[],
                &[("review_passthrough", checkpoint.terminal_digest.as_bytes())],
            )
        });
        Ok(QueryValue {
            value: Arc::clone(&upstream.value),
            checkpoint,
            query_group_checkpoint,
        })
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct SelectedTimezone {
        rows: Arc<Vec<Row>>,
        target_timezone: String,
        action: String,
    }

    fn selected_timezone_step(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        selected: TimezoneSelection,
    ) -> Result<QueryValue<SelectedTimezone>, String> {
        let metadata = serde_json::json!({
            "targetTimezone": &selected.target_timezone,
            "action": selected.action,
        });
        let fingerprint = super::value_fingerprint(&metadata)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        let exact_same_rows = Arc::ptr_eq(&selected.rows, &upstream.value);
        let checkpoint = if exact_same_rows {
            checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[("value", &fingerprint)])
        } else {
            workflow_checkpoint(
                step,
                &[("rows", &selected.rows)],
                &[("value", &fingerprint)],
            )
        };
        Ok(QueryValue {
            value: Arc::new(SelectedTimezone {
                rows: selected.rows,
                target_timezone: selected.target_timezone,
                action: selected.action.to_string(),
            }),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    fn with_logical_rows(
        mut step: QueryValue<Vec<Row>>,
        query_group_id: &str,
    ) -> QueryValue<Vec<Row>> {
        step.query_group_checkpoint = Some(checkpoint_for_exact_row_state(
            query_group_id,
            &step.checkpoint,
            &[],
        ));
        step
    }

    fn required_query_group_checkpoint<T>(
        step: &QueryValue<T>,
        query_group_id: &str,
    ) -> Result<WorkflowCheckpoint, String> {
        let checkpoint = step.query_group_checkpoint.clone().ok_or_else(|| {
            format!(
                "{} did not retain the required {query_group_id} workflow checkpoint",
                step.checkpoint.subject_id
            )
        })?;
        if checkpoint.subject_id != query_group_id {
            return Err(format!(
                "{} retained workflow checkpoint {} instead of {query_group_id}",
                step.checkpoint.subject_id, checkpoint.subject_id
            ));
        }
        Ok(checkpoint)
    }

    #[salsa::db]
    trait EarlyStepDb: salsa::Database {
        fn record_query_body(&self, step: &'static str);
        fn record_internal_query_body(&self, query: &'static str);
        fn record_fused_product_step(&self, step: &'static str);
    }

    #[salsa::input(singleton)]
    struct EarlyRawInput {
        #[returns(clone)]
        bytes: Arc<Vec<u8>>,
        /// SHA-256 verified by the runtime at ingestion. Persisted review
        /// bases bind this identity so later A/B reviews do not need to copy
        /// and hash the unchanged raw object again.
        #[returns(clone)]
        input_sha256: String,
        /// Optional product-owned checkpoint produced by a previous full run.
        /// Empty means the existing raw-input path is authoritative.
        #[returns(clone)]
        review_base_bytes: Arc<Vec<u8>>,
        /// Optional post-reconstruction checkpoint stored separately so a cache miss does
        /// not make the smaller post-review review base more expensive to decode.
        #[returns(clone)]
        reconstruction_base_bytes: Arc<Vec<u8>>,
    }

    #[salsa::input(singleton)]
    struct EarlyConfigInput {
        #[returns(clone)]
        interaction_type_remap: Arc<Vec<String>>,
        #[returns(clone)]
        timezone: String,
        #[returns(clone)]
        timezone_handling: String,
        #[returns(clone)]
        datetime_of_preprocessing: String,
        #[returns(copy)]
        deduplicate_exact_rows: bool,
        #[returns(copy)]
        correct_duplicate_event_timestamps: bool,
        #[returns(clone)]
        same_app_stop_types: Arc<Vec<String>>,
        #[returns(clone)]
        other_stop_types: Arc<Vec<String>>,
    }

    #[salsa::input(singleton)]
    struct UsageConfigInput {
        #[returns(copy)]
        usage_session_mode: UsageSessionMode,
        #[returns(copy)]
        model_concurrent_usage: bool,
        #[returns(copy)]
        allow_stop_event_reuse: bool,
        #[returns(copy)]
        use_activity_stopped_as_fallback: bool,
        #[returns(copy)]
        apply_threshold_to_fallback: bool,
        #[returns(copy)]
        long_duration_threshold_ns: i64,
        #[returns(copy)]
        proximity_interval_ns: i64,
        #[returns(copy)]
        minimum_usage_duration: f64,
        #[returns(copy)]
        apply_minimum_usage_duration_to_concurrent_subintervals: bool,
        #[returns(copy)]
        custom_app_engagement_duration: f64,
        #[returns(clone)]
        long_data_time_gap_thresholds: Arc<Vec<f64>>,
        #[returns(clone)]
        long_usage_duration_thresholds: Arc<Vec<f64>>,
        #[returns(clone)]
        interaction_types_to_remove: Arc<Vec<String>>,
        #[returns(copy)]
        filter_zero_duration_sessions: bool,
        /// Internal target selector. It enables cheaper, content-committing
        /// checkpoints for transformations proven to be no-ops in review mode.
        #[returns(copy)]
        review_only: bool,
    }

    #[salsa::input(singleton)]
    struct UsageSupportInput {
        #[returns(copy)]
        use_filter_file: bool,
        #[returns(copy)]
        use_background_apps_file: bool,
        #[returns(copy)]
        use_app_codebook: bool,
        #[returns(copy)]
        use_apps_forcing_screen_open: bool,
        #[returns(copy)]
        screen_auto_lock_timeout_seconds: f64,
        #[returns(copy)]
        screen_auto_lock_tolerance_seconds: f64,
        #[returns(copy)]
        screen_manual_lock_max_tail_seconds: f64,
        #[returns(copy)]
        screen_keyguard_near_stop_seconds: f64,
        #[returns(clone)]
        filter_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        background_apps_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        codebook_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        apps_forcing_csv: Arc<Vec<u8>>,
    }

    #[salsa::input(singleton)]
    struct LateConfigInput {
        #[returns(copy)]
        enable_screen_gated_crediting: bool,
        #[returns(copy)]
        credited_session_cap_minutes: f64,
        #[returns(copy)]
        device_liveness_gap_tolerance_minutes: f64,
        #[returns(copy)]
        auto_lock_bridge_seconds: f64,
        #[returns(copy)]
        no_witness_min_day_apps: u32,
        #[returns(copy)]
        enable_study_window_filter: bool,
        #[returns(copy)]
        enable_person_attribution: bool,
        #[returns(copy)]
        add_no_activity_placeholder_days: bool,
        #[returns(copy)]
        enable_day_coverage: bool,
        #[returns(copy)]
        enable_compliance_scoring: bool,
        #[returns(copy)]
        compliance_threshold_percent: f64,
    }

    #[salsa::input(singleton)]
    struct LateSupportInput {
        #[returns(clone)]
        study_dates_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        device_sharing_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        survey_attribution_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        enrolled_devices_csv: Arc<Vec<u8>>,
    }

    #[salsa::input(singleton)]
    struct OutputConfigInput {
        #[returns(clone)]
        study_name: String,
        #[returns(copy)]
        include_app_output: bool,
        #[returns(copy)]
        include_screen_output: bool,
        #[returns(copy)]
        include_category_column: bool,
        #[returns(copy)]
        enable_aggregates: bool,
        #[returns(clone)]
        aggregate_shape: String,
        /// View materialization stays isolated to the output query.
        #[returns(copy)]
        materialize_visualization_data: bool,
        /// Execution concern, not a researcher option. Review queries use the
        /// same registered product computations but defer large serialized outputs.
        #[returns(copy)]
        materialize_full_outputs: bool,
    }

    #[salsa::tracked(returns(clone))]
    fn decoded_review_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
    ) -> Result<Option<DecodedReviewBase>, String> {
        let _timer = QueryTimer::start("decoded_review_base");
        db.record_internal_query_body("decoded_review_base");
        let bytes = raw.review_base_bytes(db);
        if bytes.is_empty() || bytes.len() == REVIEW_BASE_HEADER_BYTES {
            return Ok(None);
        }
        // The header already carries the verified digest of the canonical
        // uncompressed payload. Re-hashing the full compressed base here made
        // every review scan another ~16 MiB solely to give Salsa an equality
        // key. Equal payloads are the semantic identity even if their LZ4
        // encoding differs.
        let digest_offset = REVIEW_BASE_MAGIC.len() + 4;
        let encoded_digest = bytes[digest_offset..digest_offset + 32]
            .try_into()
            .expect("32-byte review-base payload digest");
        let value = decode_review_base_cached(&bytes)?;
        Ok(Some(DecodedReviewBase {
            encoded_digest,
            value,
        }))
    }

    #[salsa::tracked(returns(clone))]
    fn matching_review_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<DecodedReviewBase>, String> {
        db.record_internal_query_body("matching_review_base");
        let bytes = raw.review_base_bytes(db);
        if bytes.is_empty() {
            return Ok(None);
        }
        let expected_key = review_base_input_key(db, raw, early, support)?;
        if review_base_header(&bytes)?.input_key
            != parse_blake3_key(&expected_key, "expected review-base input key")?
        {
            return Ok(None);
        }
        let Some(decoded) = decoded_review_base(db, raw)? else {
            return Ok(None);
        };
        if decoded.value.input_key != expected_key {
            return Err("review base header matched but payload key differed".into());
        }
        Ok(Some(decoded))
    }

    /// Decode keyed on the raw input alone, mirroring decoded_review_base:
    /// a matcher-config edit must not invalidate the decoded (and digest-
    /// verified) payload of an unchanged persisted base.
    #[salsa::tracked(returns(clone))]
    fn decoded_reconstruction_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
    ) -> Result<Option<DecodedReconstructionBase>, String> {
        let _timer = QueryTimer::start("decoded_reconstruction_base");
        db.record_internal_query_body("decoded_reconstruction_base");
        let bytes = raw.reconstruction_base_bytes(db);
        if bytes.is_empty() {
            return Ok(None);
        }
        let value = decode_reconstruction_base_cached(&bytes)?;
        let encoded_digest = *blake3::hash(&bytes[..RECONSTRUCTION_BASE_HEADER_BYTES]).as_bytes();
        Ok(Some(DecodedReconstructionBase {
            encoded_digest,
            value,
        }))
    }

    #[salsa::tracked(returns(clone))]
    fn matching_reconstruction_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<DecodedReconstructionBase>, String> {
        let _timer = QueryTimer::start("matching_reconstruction_base");
        db.record_internal_query_body("matching_reconstruction_base");
        let bytes = raw.reconstruction_base_bytes(db);
        if bytes.is_empty() {
            return Ok(None);
        }
        let expected_key = reconstruction_base_input_key(db, raw, early, config, support)?;
        if reconstruction_base_header_input_key(&bytes)?
            != parse_blake3_key(&expected_key, "expected reconstruction-base input key")?
        {
            return Ok(None);
        }
        let Some(decoded) = decoded_reconstruction_base(db, raw)? else {
            return Ok(None);
        };
        if decoded.value.input_key != expected_key {
            return Err("reconstruction base header matched but payload key differed".into());
        }
        Ok(Some(decoded))
    }

    fn build_review_base_metadata(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewBaseMetadata, String> {
        let values = [
            validate_remap_rules(db, early)?.checkpoint,
            decode_source_records(db, raw)?.checkpoint,
            remove_missing_timestamps(db, raw)?.checkpoint,
            attach_device_models(db, raw)?.checkpoint,
            bind_processing_timestamp(db, early)?.checkpoint,
            canonicalize_source_rows(db, raw, early)?.checkpoint,
            order_source_records(db, raw, early)?.checkpoint,
            collect_timezone_observations(db, raw, early)?.checkpoint,
            estimate_dominant_timezone(db, raw, early)?.checkpoint,
            resolve_timezone_strategy(db, raw, early)?.checkpoint,
            standardize_event_clock(db, raw, early)?.checkpoint,
            summarize_row_selection(db, raw, early)?.checkpoint,
            coalesce_duplicate_event_keys(db, raw, early)?.checkpoint,
            summarize_duplicate_groups(db, raw, early)?.checkpoint,
            disambiguate_duplicate_timestamps(db, raw, early)?.checkpoint,
            derive_time_gap_evidence(db, raw, early)?.checkpoint,
            mark_app_policy_matches(db, raw, early, config, support)?.checkpoint,
        ];
        let query_checkpoints = values
            .into_iter()
            .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint))
            .collect::<BTreeMap<_, _>>();

        let sorted = order_source_records(db, raw, early)?;
        let selected = resolve_timezone_strategy(db, raw, early)?;
        let restamped = standardize_event_clock(db, raw, early)?;
        let deduped = coalesce_duplicate_event_keys(db, raw, early)?;
        let duplicate_groups = summarize_duplicate_groups(db, raw, early)?;
        let gaps = derive_time_gap_evidence(db, raw, early)?;
        let policy = mark_app_policy_matches(db, raw, early, config, support)?;
        let timezones = collect_timezone_observations(db, raw, early)?;
        let query_group_checkpoints = [
            required_query_group_checkpoint(&sorted, "parse_events")?,
            required_query_group_checkpoint(&restamped, "normalize_timezones")?,
            required_query_group_checkpoint(&gaps, "dedup_and_order")?,
            required_query_group_checkpoint(&policy, "app_policy")?,
        ]
        .into_iter()
        .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint))
        .collect();

        Ok(ReviewBaseMetadata {
            query_checkpoints,
            query_group_checkpoints,
            original_row_count: sorted.value.len() as u32,
            processed_row_count: policy.value.len() as u32,
            rows_before_timezone_handling: sorted.value.len() as u32,
            rows_after_timezone_handling: selected.value.rows.len() as u32,
            duplicate_timestamps_corrected: if early.correct_duplicate_event_timestamps(db) {
                *duplicate_groups.value
            } else {
                0
            },
            exact_duplicate_rows_removed: restamped.value.len().saturating_sub(deduped.value.len())
                as u32,
            available_timezones: timezones.value.iter().cloned().collect(),
            timezone: selected.value.target_timezone.clone(),
            timezone_action: selected.value.action.clone(),
            timezone_retained_source_rows_digest: timezone_retained_source_rows_digest(
                &selected.value.rows,
            ),
            timezone_stage_digest: timezone_stage_digest(&restamped.value),
        })
    }

    fn build_review_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Vec<u8>, String> {
        let policy = mark_app_policy_matches(db, raw, early, config, support)?;
        let app_mode = matches!(
            config.usage_session_mode(db),
            UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
        );
        let matcher_search_suffix_digests = if app_mode {
            Some(Arc::new(inline_lineage_search_suffix_digests(
                &mask_excluded_app_events(db, raw, early, config, support)?.value,
            )))
        } else {
            None
        };
        let base = ReviewBase {
            protocol_version: REVIEW_BASE_PROTOCOL.into(),
            input_key: review_base_input_key(db, raw, early, support)?,
            rows: Arc::clone(&policy.value),
            matcher_search_suffix_digests,
            metadata: build_review_base_metadata(db, raw, early, config, support)?,
            screen: build_screen_base(db, raw, early, config, support)?,
        };
        encode_review_base(&base)
    }

    fn build_screen_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<ScreenBase>, String> {
        if !matches!(
            config.usage_session_mode(db),
            UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
        ) {
            return Ok(None);
        }
        let keyguard = index_keyguard_events(db, raw, early, config, support)?;
        let walked = infer_screen_session_skeletons(db, raw, early, config, support)?;
        let built = classify_screen_sessions(db, raw, early, config, support)?;
        Ok(Some(ScreenBase {
            input_key: screen_base_input_key(db, raw, early, config, support)?,
            rows: Arc::clone(&built.value),
            index_keyguard_events: keyguard.checkpoint.clone(),
            infer_screen_session_skeletons: walked.checkpoint.clone(),
            classify_screen_sessions: built.checkpoint.clone(),
            device_state_timeline: required_query_group_checkpoint(
                &built,
                "device_state_timeline",
            )?,
        }))
    }

    fn build_reconstruction_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Vec<u8>, String> {
        let applied = materialize_candidate_episodes(db, raw, early, config, support)?;
        let split = segment_concurrent_usage(db, raw, early, config, support)?;
        let junk = resolve_excluded_packages(db, raw, early, config, support)?;
        let blind = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher_input = build_app_event_index(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let screen = build_screen_base(db, raw, early, config, support)?;
        // Persist the checkpoint produced by the compact review query itself.
        // The full-output query binds additional payload fields at a few
        // pass-through steps; borrowing that checkpoint would keep result rows
        // correct while silently changing later review provenance digests.
        let annotated = review_annotations_fused(db, raw, early, config, support)?;
        let annotation_checkpoint = ReviewAnnotationCheckpointBase {
            input_key: review_annotation_checkpoint_input_key(db, config, support)?,
            rows: Arc::clone(&annotated.rows),
            join_app_codebook: annotated.join_app_codebook.clone(),
            derive_broad_category: annotated.derive_broad_category.clone(),
            collapse_app_genre: annotated.collapse_app_genre.clone(),
            categorize_apps: annotated.categorize_apps.clone(),
            derive_engagement_basis: annotated.derive_engagement_basis.clone(),
            apply_episode_flags: annotated.apply_episode_flags.clone(),
            episode_annotations: annotated.episode_annotations.clone(),
            suppress_excluded_timing: annotated.suppress_excluded_timing.clone(),
            remove_selected_interaction_types: annotated.remove_selected_interaction_types.clone(),
            remove_zero_duration_rows: annotated.remove_zero_duration_rows.clone(),
            interval_cleaning: annotated.interval_cleaning.clone(),
        };
        let base = ReconstructionBase {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL.into(),
            input_key: reconstruction_base_input_key(db, raw, early, config, support)?,
            rows: Arc::clone(&split.value),
            resolve_excluded_packages: junk.checkpoint.clone(),
            mask_excluded_app_events: blind.checkpoint.clone(),
            build_app_event_index: matcher_input.checkpoint.clone(),
            match_app_episodes: matcher.checkpoint.clone(),
            materialize_candidate_episodes: applied.checkpoint.clone(),
            segment_concurrent_usage: split.checkpoint.clone(),
            reconstruct_episodes: required_query_group_checkpoint(&split, "reconstruct_episodes")?,
            annotation_checkpoint,
            early_metadata: build_review_base_metadata(db, raw, early, config, support)?,
            screen,
        };
        encode_reconstruction_base(&base)
    }

    #[salsa::tracked(returns(clone))]
    fn validate_remap_rules(
        db: &dyn EarlyStepDb,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<BTreeMap<String, String>>, String> {
        db.record_query_body("validate_remap_rules");
        value_step(
            "validate_remap_rules",
            super::validate_remap_rules(&config.interaction_type_remap(db)),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn decode_source_records(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
    ) -> Result<QueryValue<Vec<RawRow>>, String> {
        let _timer = QueryTimer::start("decode_source_records");
        db.record_query_body("decode_source_records");
        value_step(
            "decode_source_records",
            super::decode_source_records(&raw.bytes(db)),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn remove_missing_timestamps(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
    ) -> Result<QueryValue<Vec<RawRow>>, String> {
        let _timer = QueryTimer::start("remove_missing_timestamps");
        db.record_query_body("remove_missing_timestamps");
        let parsed = decode_source_records(db, raw)?;
        // Exports normally contain no empty-timestamp rows; share the parsed
        // vector instead of deep-cloning ~9 owned strings per row.
        let value = if parsed
            .value
            .iter()
            .any(|row| row.event_timestamp.is_empty())
        {
            Arc::new(super::remove_missing_timestamps((*parsed.value).clone()))
        } else {
            Arc::clone(&parsed.value)
        };
        value_step_shared("remove_missing_timestamps", value)
    }

    #[salsa::tracked(returns(clone))]
    fn attach_device_models(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
    ) -> Result<QueryValue<String>, String> {
        let _timer = QueryTimer::start("attach_device_models");
        db.record_query_body("attach_device_models");
        let rows = remove_missing_timestamps(db, raw)?;
        value_step(
            "attach_device_models",
            super::attach_device_models(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn bind_processing_timestamp(
        db: &dyn EarlyStepDb,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<String>, String> {
        db.record_query_body("bind_processing_timestamp");
        value_step(
            "bind_processing_timestamp",
            super::bind_processing_timestamp(&config.datetime_of_preprocessing(db)),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn canonicalize_source_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("canonicalize_source_rows");
        db.record_query_body("canonicalize_source_rows");
        let raw_rows = remove_missing_timestamps(db, raw)?;
        let remap = validate_remap_rules(db, config)?;
        let device_model = attach_device_models(db, raw)?;
        let rows = super::canonicalize_source_rows(
            &raw_rows.value,
            &config.timezone(db),
            &remap.value,
            &device_model.value,
        )?;
        Ok(rows_step("canonicalize_source_rows", rows))
    }

    #[salsa::tracked(returns(clone))]
    fn order_source_records(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("order_source_records");
        db.record_query_body("order_source_records");
        let rows = canonicalize_source_rows(db, raw, config)?;
        if super::rows_are_event_ordered(&rows.value) {
            return Ok(with_logical_rows(
                unchanged_rows_step("order_source_records", &rows),
                "parse_events",
            ));
        }
        let sorted = super::order_source_records((*rows.value).clone());
        let checkpoint =
            checkpoint_for_reordered_exact_rows("order_source_records", &sorted, &rows.checkpoint);
        let sorted = QueryValue {
            value: Arc::new(sorted),
            checkpoint,
            query_group_checkpoint: None,
        };
        Ok(with_logical_rows(sorted, "parse_events"))
    }

    #[salsa::tracked(returns(clone))]
    fn collect_timezone_observations(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<BTreeSet<String>>, String> {
        let _timer = QueryTimer::start("collect_timezone_observations");
        db.record_query_body("collect_timezone_observations");
        let rows = order_source_records(db, raw, config)?;
        value_step(
            "collect_timezone_observations",
            super::collect_timezone_observations(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn estimate_dominant_timezone(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<String>, String> {
        let _timer = QueryTimer::start("estimate_dominant_timezone");
        db.record_query_body("estimate_dominant_timezone");
        let rows = order_source_records(db, raw, config)?;
        value_step(
            "estimate_dominant_timezone",
            super::estimate_dominant_timezone(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn resolve_timezone_strategy(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<SelectedTimezone>, String> {
        let _timer = QueryTimer::start("resolve_timezone_strategy");
        db.record_query_body("resolve_timezone_strategy");
        let rows = order_source_records(db, raw, config)?;
        let primary = estimate_dominant_timezone(db, raw, config)?;
        selected_timezone_step(
            "resolve_timezone_strategy",
            &rows,
            super::resolve_timezone_strategy(
                Arc::clone(&rows.value),
                &config.timezone(db),
                &config.timezone_handling(db),
                &primary.value,
            )?,
        )
    }

    #[salsa::tracked(returns(clone))]
    fn standardize_event_clock(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("standardize_event_clock");
        db.record_query_body("standardize_event_clock");
        let selected = resolve_timezone_strategy(db, raw, config)?;
        if selected
            .value
            .rows
            .iter()
            .all(|row| row.timezone.as_str() == selected.value.target_timezone)
        {
            return Ok(with_logical_rows(
                QueryValue {
                    value: Arc::clone(&selected.value.rows),
                    checkpoint: checkpoint_for_exact_row_state(
                        "standardize_event_clock",
                        &selected.checkpoint,
                        &[],
                    ),
                    query_group_checkpoint: None,
                },
                "normalize_timezones",
            ));
        }
        let rows = super::standardize_event_clock(
            (*selected.value.rows).clone(),
            &selected.value.target_timezone,
        )?;
        let exact_same_rows = rows.len() == selected.value.rows.len()
            && rows
                .iter()
                .zip(selected.value.rows.iter())
                .all(|(left, right)| Arc::ptr_eq(&left.0, &right.0));
        let checkpoint = if exact_same_rows {
            checkpoint_for_exact_row_state("standardize_event_clock", &selected.checkpoint, &[])
        } else {
            workflow_rows_checkpoint("standardize_event_clock", &rows)
        };
        Ok(with_logical_rows(
            QueryValue {
                value: Arc::new(rows),
                checkpoint,
                query_group_checkpoint: None,
            },
            "normalize_timezones",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn summarize_row_selection(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<RowCountReport>, String> {
        db.record_query_body("summarize_row_selection");
        let before = order_source_records(db, raw, config)?.value.len() as u32;
        let selected = resolve_timezone_strategy(db, raw, config)?;
        let after = selected.value.rows.len() as u32;
        value_step(
            "summarize_row_selection",
            super::summarize_row_selection(before, after),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn coalesce_duplicate_event_keys(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("coalesce_duplicate_event_keys");
        db.record_query_body("coalesce_duplicate_event_keys");
        let rows = standardize_event_clock(db, raw, config)?;
        if !config.deduplicate_exact_rows(db) {
            return Ok(unchanged_rows_step("coalesce_duplicate_event_keys", &rows));
        }
        Ok(rows_step_reusing(
            "coalesce_duplicate_event_keys",
            &rows,
            super::coalesce_duplicate_event_keys((*rows.value).clone(), true),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn summarize_duplicate_groups(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<u32>, String> {
        let _timer = QueryTimer::start("summarize_duplicate_groups");
        db.record_query_body("summarize_duplicate_groups");
        let rows = coalesce_duplicate_event_keys(db, raw, config)?;
        value_step(
            "summarize_duplicate_groups",
            count_duplicate_groups(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn disambiguate_duplicate_timestamps(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("disambiguate_duplicate_timestamps");
        db.record_query_body("disambiguate_duplicate_timestamps");
        let rows = coalesce_duplicate_event_keys(db, raw, config)?;
        if !config.correct_duplicate_event_timestamps(db) {
            return Ok(unchanged_rows_step(
                "disambiguate_duplicate_timestamps",
                &rows,
            ));
        }
        if super::rows_have_strictly_increasing_timestamps(&rows.value) {
            return Ok(unchanged_rows_step(
                "disambiguate_duplicate_timestamps",
                &rows,
            ));
        }
        Ok(rows_step_reusing(
            "disambiguate_duplicate_timestamps",
            &rows,
            super::disambiguate_duplicate_timestamps(
                (*rows.value).clone(),
                true,
                &config.same_app_stop_types(db),
                &config.other_stop_types(db),
            ),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn derive_time_gap_evidence(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        config: EarlyConfigInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("derive_time_gap_evidence");
        db.record_query_body("derive_time_gap_evidence");
        let rows = disambiguate_duplicate_timestamps(db, raw, config)?;
        Ok(with_logical_rows(
            rows_step_reusing(
                "derive_time_gap_evidence",
                &rows,
                super::mark_gaps((*rows.value).clone()),
            ),
            "dedup_and_order",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn background_apps(
        db: &dyn EarlyStepDb,
        _config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Arc<AHashSet<String>> {
        db.record_internal_query_body("background_apps");
        Arc::new(if support.use_background_apps_file(db) {
            parse_background_apps_csv(&support.background_apps_csv(db))
        } else {
            AHashSet::new()
        })
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_filter_rules(
        db: &dyn EarlyStepDb,
        support: UsageSupportInput,
    ) -> Arc<HashMap<String, AHashSet<String>>> {
        db.record_internal_query_body("parsed_filter_rules");
        Arc::new(if support.use_filter_file(db) {
            parse_filter_csv(&support.filter_csv(db))
        } else {
            HashMap::new()
        })
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_apps_forcing_screen_open(
        db: &dyn EarlyStepDb,
        support: UsageSupportInput,
    ) -> Arc<HashMap<String, String>> {
        db.record_internal_query_body("parsed_apps_forcing_screen_open");
        Arc::new(if support.use_apps_forcing_screen_open(db) {
            parse_apps_forcing_csv(&support.apps_forcing_csv(db))
        } else {
            HashMap::new()
        })
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_codebook(
        db: &dyn EarlyStepDb,
        support: UsageSupportInput,
    ) -> Arc<HashMap<String, CodebookEntry>> {
        db.record_internal_query_body("parsed_codebook");
        Arc::new(if support.use_app_codebook(db) {
            parse_codebook_csv(&support.codebook_csv(db))
        } else {
            HashMap::new()
        })
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_study_windows(
        db: &dyn EarlyStepDb,
        support: LateSupportInput,
    ) -> Result<Arc<Vec<StudyWindow>>, String> {
        db.record_internal_query_body("parsed_study_windows");
        let bytes = support.study_dates_csv(db);
        if bytes.is_empty() {
            Ok(Arc::default())
        } else {
            Ok(Arc::new(parse_study_windows(&bytes)?))
        }
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_device_sharing(
        db: &dyn EarlyStepDb,
        support: LateSupportInput,
    ) -> Result<Arc<Vec<SharingEntry>>, String> {
        db.record_internal_query_body("parsed_device_sharing");
        let bytes = support.device_sharing_csv(db);
        if bytes.is_empty() {
            Ok(Arc::default())
        } else {
            Ok(Arc::new(parse_device_sharing(&bytes)?))
        }
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_survey_attribution(
        db: &dyn EarlyStepDb,
        support: LateSupportInput,
    ) -> Result<Arc<SurveyLookup>, String> {
        db.record_internal_query_body("parsed_survey_attribution");
        Ok(Arc::new(parse_survey_lookup(
            &support.survey_attribution_csv(db),
        )?))
    }

    #[salsa::tracked(returns(clone))]
    fn parsed_enrolled_devices(
        db: &dyn EarlyStepDb,
        support: LateSupportInput,
    ) -> Result<Arc<BTreeMap<String, u32>>, String> {
        db.record_internal_query_body("parsed_enrolled_devices");
        Ok(Arc::new(parse_enrolled_devices(
            &support.enrolled_devices_csv(db),
        )?))
    }

    #[salsa::tracked(returns(clone))]
    fn mark_app_policy_matches(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        _config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        // The presence of a verified review base already identifies the
        // review path. Avoid reading `review_only` here: doing so would make a
        // full-to-review UI transition invalidate this step even when both
        // calls stay in the same worker and no persisted base is needed.
        if !raw.review_base_bytes(db).is_empty() {
            if let Some(base) = matching_review_base(db, raw, early, support)? {
                db.record_internal_query_body("restore_review_base");
                let base = base.value;
                let checkpoint = base
                    .metadata
                    .query_checkpoints
                    .get("mark_app_policy_matches")
                    .cloned()
                    .ok_or_else(|| {
                        "review base is missing mark_app_policy_matches checkpoint".to_string()
                    })?;
                let query_group_checkpoint = base
                    .metadata
                    .query_group_checkpoints
                    .get("app_policy")
                    .cloned()
                    .ok_or_else(|| "review base is missing app_policy checkpoint".to_string())?;
                return Ok(QueryValue {
                    value: Arc::clone(&base.rows),
                    checkpoint,
                    query_group_checkpoint: Some(query_group_checkpoint),
                });
            }
        }
        let _timer = QueryTimer::start("mark_app_policy_matches");
        db.record_query_body("mark_app_policy_matches");
        let rows = derive_time_gap_evidence(db, raw, early)?;
        let enabled = support.use_filter_file(db);
        if !enabled {
            return Ok(with_logical_rows(
                unchanged_rows_step("mark_app_policy_matches", &rows),
                "app_policy",
            ));
        }
        let filter_rules = parsed_filter_rules(db, support);
        Ok(with_logical_rows(
            rows_step_reusing(
                "mark_app_policy_matches",
                &rows,
                super::mark_app_policy_matches((*rows.value).clone(), true, &filter_rules),
            ),
            "app_policy",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn index_keyguard_events(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        _config: UsageConfigInput,
        _support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<i64>>, String> {
        db.record_query_body("index_keyguard_events");
        // Screen reconstruction is policy-neutral. App filtering is a later
        // measurement decision and must not invalidate the device-state
        // timeline.
        let rows = derive_time_gap_evidence(db, raw, early)?;
        value_step(
            "index_keyguard_events",
            super::index_keyguard_events(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn infer_screen_session_skeletons(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        _config: UsageConfigInput,
        _support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<ScreenSessionClose>>, String> {
        db.record_query_body("infer_screen_session_skeletons");
        let rows = derive_time_gap_evidence(db, raw, early)?;
        value_step(
            "infer_screen_session_skeletons",
            super::infer_screen_session_skeletons(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn classify_screen_sessions(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        if !raw.reconstruction_base_bytes(db).is_empty() {
            if let Some(cached) = matching_reconstruction_base(db, raw, early, config, support)? {
                if let Some(screen) = cached.value.screen.as_ref() {
                    let expected_screen_key =
                        screen_base_input_key(db, raw, early, config, support)?;
                    if screen.input_key == expected_screen_key {
                        db.record_internal_query_body("restore_reconstruction_screen");
                        return Ok(QueryValue {
                            value: Arc::clone(&screen.rows),
                            checkpoint: screen.classify_screen_sessions.clone(),
                            query_group_checkpoint: Some(screen.device_state_timeline.clone()),
                        });
                    }
                }
            }
        }
        if !raw.review_base_bytes(db).is_empty() {
            if let Some(cached) = matching_review_base(db, raw, early, support)? {
                if let Some(screen) = cached.value.screen.as_ref() {
                    let expected_screen_key =
                        screen_base_input_key(db, raw, early, config, support)?;
                    if screen.input_key == expected_screen_key {
                        db.record_internal_query_body("restore_review_screen");
                        return Ok(QueryValue {
                            value: Arc::clone(&screen.rows),
                            checkpoint: screen.classify_screen_sessions.clone(),
                            query_group_checkpoint: Some(screen.device_state_timeline.clone()),
                        });
                    }
                }
            }
        }
        db.record_query_body("classify_screen_sessions");
        let rows = derive_time_gap_evidence(db, raw, early)?;
        let closes = infer_screen_session_skeletons(db, raw, early, config, support)?;
        if closes.value.is_empty() {
            return Ok(with_logical_rows(
                rows_step("classify_screen_sessions", Vec::new()),
                "device_state_timeline",
            ));
        }
        let keyguard = index_keyguard_events(db, raw, early, config, support)?;
        let forcing = parsed_apps_forcing_screen_open(db, support);
        Ok(with_logical_rows(
            rows_step(
                "classify_screen_sessions",
                super::classify_screen_sessions(
                    &rows.value,
                    &closes.value,
                    &keyguard.value,
                    &forcing,
                    ScreenClassificationSettings {
                        auto_lock_timeout_seconds: support.screen_auto_lock_timeout_seconds(db),
                        auto_lock_tolerance_seconds: support.screen_auto_lock_tolerance_seconds(db),
                        manual_lock_max_tail_seconds: support
                            .screen_manual_lock_max_tail_seconds(db),
                        keyguard_near_stop_seconds: support.screen_keyguard_near_stop_seconds(db),
                    },
                ),
            ),
            "device_state_timeline",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn resolve_excluded_packages(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<BTreeSet<String>>, String> {
        db.record_query_body("resolve_excluded_packages");
        let rows = mark_app_policy_matches(db, raw, early, config, support)?;
        value_step(
            "resolve_excluded_packages",
            super::resolve_excluded_packages(&rows.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn mask_excluded_app_events(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        _config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        db.record_query_body("mask_excluded_app_events");
        // The matcher consumes the standardized, policy-neutral event stream.
        // Filter matches are carried independently by
        // `resolve_excluded_packages` and applied after reconstruction. The
        // old tag-then-untag transport produced these exact rows but made a
        // filter edit invalidate screen and matcher work.
        if !raw.review_base_bytes(db).is_empty() {
            if let Some(base) = matching_review_base(db, raw, early, support)? {
                let checkpoint = base
                    .value
                    .metadata
                    .query_checkpoints
                    .get("mark_app_policy_matches")
                    .cloned()
                    .ok_or_else(|| {
                        "review base is missing mark_app_policy_matches checkpoint".to_string()
                    })?;
                let tagged = QueryValue {
                    value: Arc::clone(&base.value.rows),
                    checkpoint,
                    query_group_checkpoint: None,
                };
                let neutral = super::mask_excluded_app_events((*tagged.value).clone());
                return Ok(rows_step_reusing(
                    "mask_excluded_app_events",
                    &tagged,
                    neutral,
                ));
            }
        }
        let rows = derive_time_gap_evidence(db, raw, early)?;
        Ok(unchanged_rows_step("mask_excluded_app_events", &rows))
    }

    /// Suffix digest chain over the blind (pre-matcher) rows. Memoized
    /// separately from review_usage_rows_before_floor so a matcher-config
    /// edit (e.g. the model_concurrent_usage toggle) does not recompute the
    /// full-table digest chain: the blind rows it hashes are unchanged by
    /// matcher settings.
    #[salsa::tracked(returns(clone))]
    fn blind_lineage_suffix_digests(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Arc<Vec<super::InlineLineageDigest>>, String> {
        let _timer = QueryTimer::start("blind_lineage_suffix_digests");
        db.record_internal_query_body("blind_lineage_suffix_digests");
        let rows = mask_excluded_app_events(db, raw, early, config, support)?;
        Ok(Arc::new(super::inline_lineage_search_suffix_digests(
            &rows.value,
        )))
    }

    #[salsa::tracked(returns(clone))]
    fn build_app_event_index(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<MatcherInput>, String> {
        let _timer = QueryTimer::start("build_app_event_index");
        db.record_query_body("build_app_event_index");
        let rows = mask_excluded_app_events(db, raw, early, config, support)?;
        let same_app_stop_types = early.same_app_stop_types(db);
        let other_stop_types = early.other_stop_types(db);
        let background = background_apps(db, config, support);
        let model_concurrent_usage = config.model_concurrent_usage(db);
        // AHashSet iteration order is not deterministic; sort before keying.
        let mut background_sorted = background.iter().map(String::as_str).collect::<Vec<_>>();
        background_sorted.sort_unstable();
        let cache_key = format!(
            "{}|{:?}|{:?}|{:?}|{model_concurrent_usage}",
            rows.checkpoint.terminal_digest,
            same_app_stop_types,
            other_stop_types,
            background_sorted,
        );
        if let Some(cached) =
            MATCHER_INPUT_ALTERNATION_CACHE.with(|cache| cache.borrow_mut().lookup(&cache_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=build_app_event_index");
            return Ok(cached);
        }
        let input = super::build_app_event_index(
            &rows.value,
            &same_app_stop_types,
            &other_stop_types,
            &background,
            model_concurrent_usage,
        )?;
        let result = value_step("build_app_event_index", input)?;
        MATCHER_INPUT_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(cache_key, result.clone()));
        Ok(result)
    }

    #[salsa::tracked(returns(clone))]
    fn match_app_episodes(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<MatcherOutput>, String> {
        let _timer = QueryTimer::start("match_app_episodes");
        db.record_query_body("match_app_episodes");
        let input = build_app_event_index(db, raw, early, config, support)?;
        let allow_stop_event_reuse = config.allow_stop_event_reuse(db);
        let use_activity_stopped_as_fallback = config.use_activity_stopped_as_fallback(db);
        let apply_threshold_to_fallback = config.apply_threshold_to_fallback(db);
        let long_duration_threshold_ns = config.long_duration_threshold_ns(db);
        let proximity_interval_ns = config.proximity_interval_ns(db);
        let cache_key = format!(
            "{}|{allow_stop_event_reuse}|{use_activity_stopped_as_fallback}|\
             {apply_threshold_to_fallback}|{long_duration_threshold_ns}|{proximity_interval_ns}",
            input.checkpoint.terminal_digest,
        );
        if let Some(cached) =
            MATCHER_OUTPUT_ALTERNATION_CACHE.with(|cache| cache.borrow_mut().lookup(&cache_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=match_app_episodes");
            return Ok(cached);
        }
        let result = value_step(
            "match_app_episodes",
            super::match_app_episodes(
                &input.value,
                allow_stop_event_reuse,
                use_activity_stopped_as_fallback,
                apply_threshold_to_fallback,
                long_duration_threshold_ns,
                proximity_interval_ns,
            )?,
        )?;
        MATCHER_OUTPUT_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(cache_key, result.clone()));
        Ok(result)
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewReconstruction {
        rows: Arc<Vec<Row>>,
        resolve_excluded_packages: WorkflowCheckpoint,
        mask_excluded_app_events: WorkflowCheckpoint,
        build_app_event_index: WorkflowCheckpoint,
        match_app_episodes: WorkflowCheckpoint,
        materialize_candidate_episodes: WorkflowCheckpoint,
        classify_episode_durations: WorkflowCheckpoint,
        apply_app_inclusion_policy: WorkflowCheckpoint,
        order_app_episodes: WorkflowCheckpoint,
        segment_concurrent_usage: WorkflowCheckpoint,
        reconstruct_episodes: WorkflowCheckpoint,
        annotation_checkpoint: Option<ReviewAnnotationCheckpointBase>,
    }

    impl PartialEq for ReviewReconstruction {
        fn eq(&self, other: &Self) -> bool {
            self.resolve_excluded_packages == other.resolve_excluded_packages
                && self.mask_excluded_app_events == other.mask_excluded_app_events
                && self.build_app_event_index == other.build_app_event_index
                && self.match_app_episodes == other.match_app_episodes
                && self.materialize_candidate_episodes == other.materialize_candidate_episodes
                && self.classify_episode_durations == other.classify_episode_durations
                && self.apply_app_inclusion_policy == other.apply_app_inclusion_policy
                && self.order_app_episodes == other.order_app_episodes
                && self.segment_concurrent_usage == other.segment_concurrent_usage
                && self.reconstruct_episodes == other.reconstruct_episodes
                && self
                    .annotation_checkpoint
                    .as_ref()
                    .map(|value| &value.input_key)
                    == other
                        .annotation_checkpoint
                        .as_ref()
                        .map(|value| &value.input_key)
        }
    }

    impl Eq for ReviewReconstruction {}

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewAppliedRows {
        filtered_packages: Arc<BTreeSet<String>>,
        resolve_excluded_packages: WorkflowCheckpoint,
        mask_excluded_app_events: WorkflowCheckpoint,
        build_app_event_index: WorkflowCheckpoint,
        match_app_episodes: WorkflowCheckpoint,
        materialize_candidate_episodes: WorkflowCheckpoint,
    }

    impl PartialEq for ReviewAppliedRows {
        fn eq(&self, other: &Self) -> bool {
            self.resolve_excluded_packages == other.resolve_excluded_packages
                && self.mask_excluded_app_events == other.mask_excluded_app_events
                && self.build_app_event_index == other.build_app_event_index
                && self.match_app_episodes == other.match_app_episodes
                && self.materialize_candidate_episodes == other.materialize_candidate_episodes
        }
    }

    impl Eq for ReviewAppliedRows {}

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewUsageRowsBeforeFloor {
        rows: Arc<Vec<Row>>,
        /// Positions created from paired Activity Resumed records. Only these
        /// rows are affected by minimum_usage_duration.
        floor_candidate_indices: Arc<Vec<u32>>,
        filtered_packages: Arc<BTreeSet<String>>,
        checkpoint: WorkflowCheckpoint,
        temporal_sequence: CanonicalTemporalSequence,
    }

    impl PartialEq for ReviewUsageRowsBeforeFloor {
        // Compare by the content-committing rows checkpoint plus the two
        // derived values consumers read. The step checkpoints from matcher
        // application deliberately do NOT participate: a matcher-config edit
        // that leaves the matcher result unchanged must backdate this table.
        fn eq(&self, other: &Self) -> bool {
            self.checkpoint == other.checkpoint
                && self.floor_candidate_indices == other.floor_candidate_indices
                && self.filtered_packages == other.filtered_packages
        }
    }

    impl Eq for ReviewUsageRowsBeforeFloor {}

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewStaticAnnotations {
        rows: Arc<Vec<Row>>,
        input_key: String,
        checkpoint: WorkflowCheckpoint,
    }

    impl PartialEq for ReviewStaticAnnotations {
        fn eq(&self, other: &Self) -> bool {
            self.input_key == other.input_key
        }
    }

    impl Eq for ReviewStaticAnnotations {}

    /// Keep matcher application independent from the duration floor. A floor
    /// edit can then reuse these rows, while a matcher-affecting edit still
    /// reruns the exact work without hashing a throwaway intermediate table.
    #[salsa::tracked(returns(clone))]
    fn review_applied_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewAppliedRows, String> {
        let _timer = QueryTimer::start("review_applied_rows");
        db.record_internal_query_body("review_applied_rows");
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        let blind = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher_input = build_app_event_index(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let materialize_candidate_episodes = review_derived_checkpoint(
            "materialize_candidate_episodes",
            &[
                ("rows", &blind.checkpoint),
                ("matcher", &matcher.checkpoint),
                ("filteredPackages", &filtered.checkpoint),
            ],
            &serde_json::json!({}),
        )?;
        db.record_fused_product_step("materialize_candidate_episodes");
        Ok(ReviewAppliedRows {
            filtered_packages: Arc::clone(&filtered.value),
            resolve_excluded_packages: filtered.checkpoint.clone(),
            mask_excluded_app_events: blind.checkpoint.clone(),
            build_app_event_index: matcher_input.checkpoint.clone(),
            match_app_episodes: matcher.checkpoint.clone(),
            materialize_candidate_episodes,
        })
    }

    /// Build the threshold-independent part of classify_episode_durations once.
    /// Repeated floor edits can then copy and clear only the sessions below
    /// the new threshold instead of reclassifying every matched session.
    #[salsa::tracked(returns(clone))]
    fn review_usage_rows_before_floor(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewUsageRowsBeforeFloor, String> {
        let _timer = QueryTimer::start("review_usage_rows_before_floor");
        db.record_internal_query_body("review_usage_rows_before_floor");
        // Depend on the junk-package set and matcher OUTPUT values, not on
        // review_applied_rows: that struct compares by step checkpoints, and
        // the build_app_event_index checkpoint changes on matcher-config edits
        // (e.g. model_concurrent_usage flips the other_stop bits) even when
        // the matcher result — and therefore this row table — is unchanged.
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        let blind = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let persisted_suffix_digests = if raw.review_base_bytes(db).is_empty() {
            None
        } else {
            matching_review_base(db, raw, early, support)?.and_then(|base| {
                base.value
                    .matcher_search_suffix_digests
                    .as_ref()
                    .map(Arc::clone)
            })
        };
        let suffix_digests = match persisted_suffix_digests {
            Some(digests) => digests,
            None => blind_lineage_suffix_digests(db, raw, early, config, support)?,
        };
        // Everything below is a pure function of the blind rows, the matcher
        // result, and the junk-package set; their content-committing digests
        // are therefore a complete key for the finished table. The suffix
        // digests are themselves a pure function of the blind rows (the
        // persisted base is only a cheaper source of the same values), so
        // the digest source deliberately does not split this key.
        let alternation_key = format!(
            "{}|{}|{}",
            blind.checkpoint.terminal_digest,
            matcher.checkpoint.terminal_digest,
            filtered.checkpoint.terminal_digest,
        );
        if let Some(cached) =
            BEFORE_FLOOR_ALTERNATION_CACHE.with(|cache| cache.borrow_mut().lookup(&alternation_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=review_usage_rows_before_floor");
            return Ok(cached);
        }
        let mut rows = (*blind.value).clone();
        let apply_timer = QueryTimer::start("review_reconstruction_apply_matcher_rows");
        super::materialize_candidate_episodes_in_place(
            &mut rows,
            &matcher.value,
            &filtered.value,
            Some(suffix_digests.as_slice()),
        );
        apply_timer.finish();
        let mut floor_candidate_row_ids = AHashSet::new();
        let retain_timer = QueryTimer::start("review_before_floor_relabel_retain");
        rows.retain_mut(|row| {
            if row.interaction_type == ACTIVITY_PAUSED
                || (row.interaction_type == ACTIVITY_RESUMED
                    && (row.start_timestamp_ns.is_none() || row.stop_timestamp_ns.is_none()))
            {
                return false;
            }
            if row.interaction_type == ACTIVITY_RESUMED {
                let is_filtered = filtered.value.contains(row.app_package_name.as_str());
                row.edit_classification().interaction_type = if is_filtered {
                    FILTERED_APP_USAGE
                } else {
                    APP_USAGE
                }
                .into();
                if is_filtered {
                    let temporal = row.edit_temporal();
                    temporal.start_timestamp_ns = None;
                    temporal.stop_timestamp_ns = None;
                    temporal.duration_seconds = None;
                    temporal.duration_minutes = None;
                } else {
                    let start = row.start_timestamp_ns.expect("paired usage start");
                    let stop = row.stop_timestamp_ns.expect("paired usage stop");
                    let duration_seconds = (stop - start) as f64 / 1_000_000_000.0;
                    let temporal = row.edit_temporal();
                    temporal.duration_seconds = Some(duration_seconds);
                    temporal.duration_minutes = Some(duration_seconds / 60.0);
                    floor_candidate_row_ids.insert(row.index);
                }
            }
            true
        });
        retain_timer.finish();
        // Duration floors do not affect event order. Establish the exact sort
        // once in this threshold-independent memo, then preserve it across
        // every later A/B threshold edit.
        let sort_timer = QueryTimer::start("review_before_floor_order_app_episodes");
        rows = super::order_app_episodes(rows);
        sort_timer.finish();
        let floor_candidate_indices = rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                floor_candidate_row_ids
                    .contains(&row.index)
                    .then_some(index as u32)
            })
            .collect::<Vec<_>>();
        // Both the exact stage checkpoint and later sparse temporal updates use
        // the same canonical source-identity order. Compute the per-row parts
        // and sort once instead of walking and sorting this large table twice.
        let parts_timer = QueryTimer::start("review_before_floor_checkpoint_parts");
        let checkpoint_parts = row_checkpoint_parts_for_rows(&rows);
        parts_timer.finish();
        let order_timer = QueryTimer::start("review_before_floor_canonical_order");
        let canonical_order = canonical_row_order(&rows);
        order_timer.finish();
        let stage_timer = QueryTimer::start("review_before_floor_stage_checkpoint");
        let checkpoint = workflow_rows_checkpoint_with_parts_and_canonical_order(
            "review_usage_rows_before_floor",
            &rows,
            &checkpoint_parts,
            &canonical_order,
        );
        stage_timer.finish();
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            checkpoint,
            workflow_rows_checkpoint("review_usage_rows_before_floor", &rows),
            "precomputed canonical order changed the exact checkpoint",
        );
        let temporal_timer = QueryTimer::start("review_before_floor_temporal_sequence");
        let temporal_sequence = canonical_temporal_sequence_with_order(&rows, &canonical_order);
        temporal_timer.finish();
        let result = ReviewUsageRowsBeforeFloor {
            rows: Arc::new(rows),
            floor_candidate_indices: Arc::new(floor_candidate_indices),
            filtered_packages: Arc::clone(&filtered.value),
            checkpoint,
            temporal_sequence,
        };
        BEFORE_FLOOR_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(alternation_key, result.clone()));
        Ok(result)
    }

    /// Cache annotation columns whose values do not read the duration floor.
    /// This path is valid only when concurrent/background reconstruction does
    /// not change membership or order. The floor-specific duration and flags
    /// are overlaid later from the exact reconstructed rows.
    #[salsa::tracked(returns(clone))]
    fn review_static_annotations(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewStaticAnnotations, String> {
        let _timer = QueryTimer::start("review_static_annotations");
        db.record_internal_query_body("review_static_annotations");
        let prepared = review_usage_rows_before_floor(db, raw, early, config, support)?;
        // Membership stability (no concurrent/background reconstruction) is
        // guaranteed by the only caller, review_annotations_fused, via its
        // use_static_annotations gate. Reading model_concurrent_usage here
        // would re-execute this table on every matcher-config toggle.
        if !super::rows_are_event_ordered(&prepared.rows) {
            return Err("static review annotations require stable row order".into());
        }

        let enabled = support.use_app_codebook(db);
        let codebook_csv = if enabled {
            support.codebook_csv(db)
        } else {
            Arc::default()
        };
        let codebook = parsed_codebook(db, support);
        let long_gap_thresholds = config.long_data_time_gap_thresholds(db);
        let long_usage_thresholds = config.long_usage_duration_thresholds(db);
        let custom_engagement_duration = config.custom_app_engagement_duration(db);
        // Rebuild the materialize_candidate_episodes derived checkpoint from the three
        // stable step values (byte-identical to review_applied_rows' one)
        // instead of depending on review_applied_rows, whose value changes
        // whenever the build_app_event_index checkpoint does.
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        let blind = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let materialize_candidate_episodes = review_derived_checkpoint(
            "materialize_candidate_episodes",
            &[
                ("rows", &blind.checkpoint),
                ("matcher", &matcher.checkpoint),
                ("filteredPackages", &filtered.checkpoint),
            ],
            &serde_json::json!({}),
        )?;
        let input_key = review_derived_checkpoint(
            "review_static_annotations",
            &[("applyMatcherOutput", &materialize_candidate_episodes)],
            &serde_json::json!({
                "filteredPackages": prepared.filtered_packages,
                "useAppCodebook": enabled,
                "codebookDigest": digest_bytes(&codebook_csv),
                "customAppEngagementDuration": custom_engagement_duration,
                "longDataTimeGapThresholds": long_gap_thresholds,
                "longUsageDurationThresholds": long_usage_thresholds,
            }),
        )?
        .terminal_digest;

        // input_key commits to the matcher application and every annotation
        // setting; the prepared checkpoint commits to the row table content.
        let alternation_key = format!("{input_key}|{}", prepared.checkpoint.terminal_digest);
        if let Some(cached) = STATIC_ANNOTATIONS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().lookup(&alternation_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=review_static_annotations");
            return Ok(cached);
        }

        let clone_timer = QueryTimer::start("review_static_clone_rows");
        let mut rows = (*prepared.rows).clone();
        clone_timer.finish();
        let fused_timer = QueryTimer::start("review_static_annotations_fused");
        super::apply_static_review_annotations_fused(
            &mut rows,
            &prepared.filtered_packages,
            enabled,
            &codebook,
            custom_engagement_duration,
            &long_gap_thresholds,
            &long_usage_thresholds,
        );
        fused_timer.finish();
        for step in [
            "join_app_codebook",
            "derive_broad_category",
            "collapse_app_genre",
            "derive_engagement_basis",
            "suppress_excluded_timing",
        ] {
            db.record_fused_product_step(step);
        }
        // Annotation changes values on existing rows but cannot add, remove,
        // or reorder them. Preserve those two exact commitments from the
        // threshold-independent table and hash only the temporal and
        // classification columns that this pass can actually change.
        let checkpoint_timer = QueryTimer::start("review_static_stage_checkpoint");
        let checkpoint = workflow_checkpoint_with_known_membership_and_order(
            "review_static_annotations",
            &rows,
            &[],
            &prepared.rows,
            &prepared.checkpoint,
        );
        checkpoint_timer.finish();
        let result = ReviewStaticAnnotations {
            rows: Arc::new(rows),
            input_key,
            checkpoint,
        };
        STATIC_ANNOTATIONS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(alternation_key, result.clone()));
        Ok(result)
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewReconstructedRows {
        rows: Arc<Vec<Row>>,
        resolve_excluded_packages: WorkflowCheckpoint,
        mask_excluded_app_events: WorkflowCheckpoint,
        build_app_event_index: WorkflowCheckpoint,
        match_app_episodes: WorkflowCheckpoint,
        materialize_candidate_episodes: WorkflowCheckpoint,
        segment_concurrent_usage: WorkflowCheckpoint,
        reconstruct_episodes: WorkflowCheckpoint,
        annotation_checkpoint: Option<ReviewAnnotationCheckpointBase>,
    }

    impl PartialEq for ReviewReconstructedRows {
        fn eq(&self, other: &Self) -> bool {
            self.resolve_excluded_packages == other.resolve_excluded_packages
                && self.mask_excluded_app_events == other.mask_excluded_app_events
                && self.build_app_event_index == other.build_app_event_index
                && self.match_app_episodes == other.match_app_episodes
                && self.materialize_candidate_episodes == other.materialize_candidate_episodes
                && self.segment_concurrent_usage == other.segment_concurrent_usage
                && self.reconstruct_episodes == other.reconstruct_episodes
                && self
                    .annotation_checkpoint
                    .as_ref()
                    .map(|value| &value.input_key)
                    == other
                        .annotation_checkpoint
                        .as_ref()
                        .map(|value| &value.input_key)
        }
    }

    impl Eq for ReviewReconstructedRows {}

    /// Materialize the row table produced by the reconstruction section.
    ///
    /// When concurrent reconstruction is enabled, the pre-split duration is
    /// discarded and rebuilt from the split interval. Therefore
    /// `minimum_usage_duration` cannot affect the resulting rows unless the
    /// caller explicitly applies that minimum to concurrent sub-intervals.
    /// Keeping this as its own Salsa query lets a review-only configuration
    /// change reuse the exact same reconstructed row table instead of proving
    /// the same fact by rebuilding and hashing every split row.
    #[salsa::tracked(returns(clone))]
    fn review_reconstructed_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewReconstructedRows, String> {
        let _timer = QueryTimer::start("review_reconstructed_rows");

        if !raw.reconstruction_base_bytes(db).is_empty() {
            if let Some(cached) = matching_reconstruction_base(db, raw, early, config, support)? {
                db.record_internal_query_body("restore_reconstruction_base");
                let cached = cached.value;
                let materialize_candidate_episodes = review_derived_checkpoint(
                    "materialize_candidate_episodes",
                    &[
                        ("rows", &cached.mask_excluded_app_events),
                        ("matcher", &cached.match_app_episodes),
                        ("filteredPackages", &cached.resolve_excluded_packages),
                    ],
                    &serde_json::json!({}),
                )?;
                return Ok(ReviewReconstructedRows {
                    rows: Arc::clone(&cached.rows),
                    resolve_excluded_packages: cached.resolve_excluded_packages.clone(),
                    mask_excluded_app_events: cached.mask_excluded_app_events.clone(),
                    build_app_event_index: cached.build_app_event_index.clone(),
                    match_app_episodes: cached.match_app_episodes.clone(),
                    materialize_candidate_episodes,
                    segment_concurrent_usage: cached.segment_concurrent_usage.clone(),
                    reconstruct_episodes: cached.reconstruct_episodes.clone(),
                    annotation_checkpoint: Some(cached.annotation_checkpoint.clone()),
                });
            }
        }
        db.record_internal_query_body("review_reconstructed_rows");

        let prepared = review_usage_rows_before_floor(db, raw, early, config, support)?;
        let applied = review_applied_rows(db, raw, early, config, support)?;
        let background = background_apps(db, config, support);
        let rebuilds_usage_intervals = config.model_concurrent_usage(db) || !background.is_empty();
        let apply_minimum_to_subintervals =
            config.apply_minimum_usage_duration_to_concurrent_subintervals(db);

        // Do not read the tracked minimum in the branch where it is erased by
        // reconstruction. Salsa can then prove that changing only the minimum
        // does not invalidate this expensive row table.
        let effective_minimum = if !rebuilds_usage_intervals || apply_minimum_to_subintervals {
            config.minimum_usage_duration(db)
        } else {
            0.0
        };

        // The reconstructed table and its embedded step checkpoints are a
        // pure function of the prepared table, the matcher-application
        // checkpoints, the background set, and the floor/split settings read
        // above; commit them all so an A/B config alternation can reuse the
        // finished value.
        let alternation_key = format!(
            "{}|{}|{}|{}|{}|{}|{:?}|{}|{}|{}",
            prepared.checkpoint.terminal_digest,
            applied.resolve_excluded_packages.terminal_digest,
            applied.mask_excluded_app_events.terminal_digest,
            applied.build_app_event_index.terminal_digest,
            applied.match_app_episodes.terminal_digest,
            applied.materialize_candidate_episodes.terminal_digest,
            background.iter().collect::<BTreeSet<_>>(),
            config.model_concurrent_usage(db),
            effective_minimum.to_bits(),
            apply_minimum_to_subintervals,
        );
        if let Some(cached) = RECONSTRUCTED_ROWS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().lookup(&alternation_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=review_reconstructed_rows");
            return Ok(cached);
        }

        let mut rows = (*prepared.rows).clone();
        let mut exact_prepared_rows = true;
        let mut changed_temporal_indices = Vec::new();
        if effective_minimum > 0.0 {
            for &index in prepared.floor_candidate_indices.iter() {
                let row = &mut rows[index as usize];
                if row
                    .duration_seconds
                    .is_some_and(|duration| duration < effective_minimum)
                {
                    exact_prepared_rows = false;
                    changed_temporal_indices.push(index);
                    let temporal = row.edit_temporal();
                    temporal.duration_seconds = None;
                    temporal.duration_minutes = None;
                }
            }
        }
        if !applied.filtered_packages.is_empty() {
            exact_prepared_rows = false;
            rows = super::apply_app_inclusion_policy(rows, &applied.filtered_packages, &background);
        }
        // The matcher path normally preserves event order. Sorting an already
        // ordered 100k-row table cost several milliseconds on every A/B edit
        // without changing a byte. Keep the product step and its checkpoint,
        // but only run the physical sort when the order check proves it is
        // needed.
        if !super::rows_are_event_ordered(&rows) {
            exact_prepared_rows = false;
            rows = super::order_app_episodes(rows);
        }
        if rebuilds_usage_intervals {
            exact_prepared_rows = false;
            rows = super::segment_concurrent_usage(
                rows,
                &applied.filtered_packages,
                &background,
                config.model_concurrent_usage(db),
                effective_minimum,
                apply_minimum_to_subintervals,
            )?;
        }
        let can_reuse_static_classification = !rebuilds_usage_intervals
            && applied.filtered_packages.is_empty()
            && super::rows_are_event_ordered(&prepared.rows)
            && rows.len() == prepared.rows.len();
        let split_step = if exact_prepared_rows {
            // A changed threshold can be semantically relevant to the step
            // while leaving this particular file's rows identical. Reuse the
            // exact immutable table and its component digests; the step's own
            // threshold-bound checkpoint remains distinct upstream.
            QueryValue {
                checkpoint: checkpoint_for_exact_row_state(
                    "segment_concurrent_usage",
                    &prepared.checkpoint,
                    &[],
                ),
                value: Arc::clone(&prepared.rows),
                query_group_checkpoint: None,
            }
        } else if can_reuse_static_classification {
            let temporal_state_digest = temporal_digest_with_changed_rows(
                &prepared.temporal_sequence,
                &rows,
                &changed_temporal_indices,
            );
            QueryValue {
                checkpoint: checkpoint_with_known_row_component_payloads(
                    "segment_concurrent_usage",
                    &prepared.checkpoint,
                    temporal_state_digest,
                    &[],
                ),
                value: Arc::new(rows),
                query_group_checkpoint: None,
            }
        } else {
            rows_step("segment_concurrent_usage", rows)
        };
        let split = with_logical_rows(split_step, "reconstruct_episodes");
        let result = ReviewReconstructedRows {
            rows: Arc::clone(&split.value),
            resolve_excluded_packages: applied.resolve_excluded_packages.clone(),
            mask_excluded_app_events: applied.mask_excluded_app_events.clone(),
            build_app_event_index: applied.build_app_event_index.clone(),
            match_app_episodes: applied.match_app_episodes.clone(),
            materialize_candidate_episodes: applied.materialize_candidate_episodes.clone(),
            segment_concurrent_usage: split.checkpoint.clone(),
            reconstruct_episodes: required_query_group_checkpoint(&split, "reconstruct_episodes")?,
            annotation_checkpoint: None,
        };
        RECONSTRUCTED_ROWS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(alternation_key, result.clone()));
        Ok(result)
    }

    /// Execute adjacent row-mutating reconstruction steps on one owned buffer.
    /// The review result still retains every logical step and exact checkpoint;
    /// this only removes repeated Arc<Row> copy-on-write churn between steps.
    #[salsa::tracked(returns(clone))]
    fn review_reconstruction_fused(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewReconstruction, String> {
        let _timer = QueryTimer::start("review_reconstruction_fused");
        db.record_internal_query_body("review_reconstruction_fused");

        let background = background_apps(db, config, support);
        let background_checkpoint_value = background.iter().cloned().collect::<BTreeSet<_>>();
        let reconstructed = review_reconstructed_rows(db, raw, early, config, support)?;

        let materialize_candidate_episodes = reconstructed.materialize_candidate_episodes.clone();

        let classify_episode_durations = review_derived_checkpoint(
            "classify_episode_durations",
            &[
                ("rows", &materialize_candidate_episodes),
                ("filteredPackages", &reconstructed.resolve_excluded_packages),
            ],
            &serde_json::json!({
                "minimumUsageDuration": config.minimum_usage_duration(db),
            }),
        )?;
        db.record_fused_product_step("classify_episode_durations");

        let apply_app_inclusion_policy = review_derived_checkpoint(
            "apply_app_inclusion_policy",
            &[
                ("rows", &classify_episode_durations),
                ("filteredPackages", &reconstructed.resolve_excluded_packages),
            ],
            &serde_json::json!({
                "backgroundApps": background_checkpoint_value,
            }),
        )?;
        db.record_fused_product_step("apply_app_inclusion_policy");

        let order_app_episodes = review_derived_checkpoint(
            "order_app_episodes",
            &[("rows", &apply_app_inclusion_policy)],
            &serde_json::json!({"order": "event_timestamp_ns,index"}),
        )?;
        db.record_fused_product_step("order_app_episodes");

        let section_timer = QueryTimer::start("review_reconstruction_checkpoint");
        let segment_concurrent_usage = reconstructed.segment_concurrent_usage.clone();
        section_timer.finish();
        let reconstruct_episodes = reconstructed.reconstruct_episodes.clone();

        Ok(ReviewReconstruction {
            rows: Arc::clone(&reconstructed.rows),
            resolve_excluded_packages: reconstructed.resolve_excluded_packages.clone(),
            mask_excluded_app_events: reconstructed.mask_excluded_app_events.clone(),
            build_app_event_index: reconstructed.build_app_event_index.clone(),
            match_app_episodes: reconstructed.match_app_episodes.clone(),
            materialize_candidate_episodes,
            classify_episode_durations,
            apply_app_inclusion_policy,
            order_app_episodes,
            segment_concurrent_usage,
            reconstruct_episodes,
            annotation_checkpoint: reconstructed.annotation_checkpoint.clone(),
        })
    }

    #[derive(Clone)]
    struct ReviewReconstructionOutput {
        rows: Arc<Vec<Row>>,
        segment_concurrent_usage: WorkflowCheckpoint,
        annotation_checkpoint: Option<ReviewAnnotationCheckpointBase>,
    }

    impl PartialEq for ReviewReconstructionOutput {
        fn eq(&self, other: &Self) -> bool {
            // segment_concurrent_usage is the exact row-state boundary consumed by all
            // later app steps. Earlier checkpoint differences remain visible
            // in the query ledger but must not invalidate consumers when
            // reconstruction converges to identical rows.
            self.segment_concurrent_usage == other.segment_concurrent_usage
                && self
                    .annotation_checkpoint
                    .as_ref()
                    .map(|value| &value.input_key)
                    == other
                        .annotation_checkpoint
                        .as_ref()
                        .map(|value| &value.input_key)
        }
    }

    impl Eq for ReviewReconstructionOutput {}

    #[salsa::tracked(returns(clone))]
    fn review_reconstruction_output(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewReconstructionOutput, String> {
        db.record_internal_query_body("review_reconstruction_output");
        let reconstructed = review_reconstruction_fused(db, raw, early, config, support)?;
        Ok(ReviewReconstructionOutput {
            rows: Arc::clone(&reconstructed.rows),
            segment_concurrent_usage: reconstructed.segment_concurrent_usage.clone(),
            annotation_checkpoint: reconstructed.annotation_checkpoint.clone(),
        })
    }

    #[salsa::tracked(returns(clone))]
    fn materialize_candidate_episodes(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("materialize_candidate_episodes");
        db.record_query_body("materialize_candidate_episodes");
        let rows = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        let persisted_suffix_digests = if raw.review_base_bytes(db).is_empty() {
            None
        } else {
            matching_review_base(db, raw, early, support)?.and_then(|base| {
                base.value
                    .matcher_search_suffix_digests
                    .as_ref()
                    .map(Arc::clone)
            })
        };
        let timer = QueryTimer::start("materialize_candidate_episodes_rows");
        let next_rows = super::materialize_candidate_episodes_with_suffix(
            (*rows.value).clone(),
            &matcher.value,
            &filtered.value,
            persisted_suffix_digests.as_deref().map(Vec::as_slice),
        );
        timer.finish();
        let timer = QueryTimer::start("materialize_candidate_episodes_checkpoint");
        let result = rows_step_reusing("materialize_candidate_episodes", &rows, next_rows);
        timer.finish();
        Ok(result)
    }

    #[salsa::tracked(returns(clone))]
    fn classify_episode_durations(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("classify_episode_durations");
        db.record_query_body("classify_episode_durations");
        let rows = materialize_candidate_episodes(db, raw, early, config, support)?;
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        Ok(rows_step_reusing(
            "classify_episode_durations",
            &rows,
            super::classify_episode_durations(
                (*rows.value).clone(),
                &filtered.value,
                config.minimum_usage_duration(db),
            ),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn apply_app_inclusion_policy(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("apply_app_inclusion_policy");
        db.record_query_body("apply_app_inclusion_policy");
        let rows = classify_episode_durations(db, raw, early, config, support)?;
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        if filtered.value.is_empty() {
            return Ok(unchanged_rows_step("apply_app_inclusion_policy", &rows));
        }
        Ok(rows_step_reusing(
            "apply_app_inclusion_policy",
            &rows,
            super::apply_app_inclusion_policy(
                (*rows.value).clone(),
                &filtered.value,
                &background_apps(db, config, support),
            ),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn order_app_episodes(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("order_app_episodes");
        db.record_query_body("order_app_episodes");
        let rows = apply_app_inclusion_policy(db, raw, early, config, support)?;
        if super::rows_are_event_ordered(&rows.value) {
            return Ok(unchanged_rows_step("order_app_episodes", &rows));
        }
        Ok(rows_step_reusing(
            "order_app_episodes",
            &rows,
            super::order_app_episodes((*rows.value).clone()),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn segment_concurrent_usage(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("segment_concurrent_usage");
        db.record_query_body("segment_concurrent_usage");
        if config.review_only(db) {
            let fused = review_reconstruction_fused(db, raw, early, config, support)?;
            return Ok(QueryValue {
                value: Arc::clone(&fused.rows),
                checkpoint: fused.segment_concurrent_usage.clone(),
                query_group_checkpoint: Some(fused.reconstruct_episodes.clone()),
            });
        }
        let rows = order_app_episodes(db, raw, early, config, support)?;
        let model_concurrent_usage = config.model_concurrent_usage(db);
        let background = background_apps(db, config, support);
        if !model_concurrent_usage && background.is_empty() {
            return Ok(with_logical_rows(
                unchanged_rows_step("segment_concurrent_usage", &rows),
                "reconstruct_episodes",
            ));
        }
        let filtered = resolve_excluded_packages(db, raw, early, config, support)?;
        Ok(with_logical_rows(
            rows_step_reusing(
                "segment_concurrent_usage",
                &rows,
                super::segment_concurrent_usage(
                    (*rows.value).clone(),
                    &filtered.value,
                    &background,
                    model_concurrent_usage,
                    config.minimum_usage_duration(db),
                    config.apply_minimum_usage_duration_to_concurrent_subintervals(db),
                )?,
            ),
            "reconstruct_episodes",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn join_app_codebook(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("join_app_codebook");
        db.record_query_body("join_app_codebook");
        let rows = segment_concurrent_usage(db, raw, early, config, support)?;
        let enabled = support.use_app_codebook(db);
        if !enabled {
            if !config.review_only(db) {
                return unchanged_rows_with_payload(
                    "join_app_codebook",
                    &rows,
                    &serde_json::json!({"codebookIsEmpty": true}),
                );
            }
            return review_passthrough_rows(
                "join_app_codebook",
                &rows,
                &serde_json::json!({"codebookIsEmpty": true}),
                None,
            );
        }
        let codebook = parsed_codebook(db, support);
        let codebook_is_empty = codebook.is_empty();
        let mut next_rows = (*rows.value).clone();
        super::join_codebook(&mut next_rows, true, &codebook);
        let payload = serde_json::json!({"codebookIsEmpty": codebook_is_empty});
        let exact_same_rows = next_rows.len() == rows.value.len()
            && next_rows
                .iter()
                .zip(rows.value.iter())
                .all(|(left, right)| Arc::ptr_eq(&left.0, &right.0));
        if exact_same_rows {
            return unchanged_rows_with_payload("join_app_codebook", &rows, &payload);
        }
        let checkpoint = rows_and_value_checkpoint_reusing(
            "join_app_codebook",
            &next_rows,
            &rows.value,
            &rows.checkpoint,
            &payload,
        )?;
        Ok(QueryValue {
            value: Arc::new(next_rows),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    #[salsa::tracked(returns(clone))]
    fn derive_broad_category(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("derive_broad_category");
        db.record_query_body("derive_broad_category");
        let rows = join_app_codebook(db, raw, early, config, support)?;
        if !support.use_app_codebook(db) {
            if !config.review_only(db) {
                return Ok(unchanged_rows_step("derive_broad_category", &rows));
            }
            return review_passthrough_rows(
                "derive_broad_category",
                &rows,
                &serde_json::json!({"enabled": false}),
                None,
            );
        }
        Ok(rows_step_reusing(
            "derive_broad_category",
            &rows,
            super::derive_broad_category_step((*rows.value).clone(), support.use_app_codebook(db)),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn collapse_app_genre(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("collapse_app_genre");
        db.record_query_body("collapse_app_genre");
        let rows = derive_broad_category(db, raw, early, config, support)?;
        if !support.use_app_codebook(db) {
            if !config.review_only(db) {
                return Ok(with_logical_rows(
                    unchanged_rows_step("collapse_app_genre", &rows),
                    "categorize_apps",
                ));
            }
            return review_passthrough_rows(
                "collapse_app_genre",
                &rows,
                &serde_json::json!({"enabled": false}),
                Some("categorize_apps"),
            );
        }
        Ok(with_logical_rows(
            rows_step_reusing(
                "collapse_app_genre",
                &rows,
                super::collapse_app_genre_step((*rows.value).clone(), support.use_app_codebook(db)),
            ),
            "categorize_apps",
        ))
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct ReviewAnnotations {
        rows: Arc<Vec<Row>>,
        join_app_codebook: WorkflowCheckpoint,
        derive_broad_category: WorkflowCheckpoint,
        collapse_app_genre: WorkflowCheckpoint,
        categorize_apps: WorkflowCheckpoint,
        derive_engagement_basis: WorkflowCheckpoint,
        apply_episode_flags: WorkflowCheckpoint,
        episode_annotations: WorkflowCheckpoint,
        suppress_excluded_timing: WorkflowCheckpoint,
        remove_selected_interaction_types: WorkflowCheckpoint,
        remove_zero_duration_rows: WorkflowCheckpoint,
        interval_cleaning: WorkflowCheckpoint,
        remove_zero_duration_rows_executed: bool,
    }

    impl PartialEq for ReviewAnnotations {
        fn eq(&self, other: &Self) -> bool {
            self.join_app_codebook == other.join_app_codebook
                && self.derive_broad_category == other.derive_broad_category
                && self.collapse_app_genre == other.collapse_app_genre
                && self.categorize_apps == other.categorize_apps
                && self.remove_zero_duration_rows == other.remove_zero_duration_rows
                && self.interval_cleaning == other.interval_cleaning
        }
    }

    impl Eq for ReviewAnnotations {}

    /// Keep categorization plus annotation/cleaning on one row allocation while
    /// retaining the same per-query checkpoints exposed by the execution DAG.
    #[salsa::tracked(returns(clone))]
    fn review_annotations_fused(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewAnnotations, String> {
        let _timer = QueryTimer::start("review_annotations_fused");
        db.record_internal_query_body("review_annotations_fused");
        let upstream = review_reconstruction_output(db, raw, early, config, support)?;
        let annotation_input_key = review_annotation_checkpoint_input_key(db, config, support)?;
        if let Some(cached) = upstream
            .annotation_checkpoint
            .as_ref()
            .filter(|checkpoint| checkpoint.input_key == annotation_input_key)
        {
            return Ok(ReviewAnnotations {
                rows: Arc::clone(&cached.rows),
                join_app_codebook: cached.join_app_codebook.clone(),
                derive_broad_category: cached.derive_broad_category.clone(),
                collapse_app_genre: cached.collapse_app_genre.clone(),
                categorize_apps: cached.categorize_apps.clone(),
                derive_engagement_basis: cached.derive_engagement_basis.clone(),
                apply_episode_flags: cached.apply_episode_flags.clone(),
                episode_annotations: cached.episode_annotations.clone(),
                suppress_excluded_timing: cached.suppress_excluded_timing.clone(),
                remove_selected_interaction_types: cached.remove_selected_interaction_types.clone(),
                remove_zero_duration_rows: cached.remove_zero_duration_rows.clone(),
                interval_cleaning: cached.interval_cleaning.clone(),
                remove_zero_duration_rows_executed: false,
            });
        }
        let enabled = support.use_app_codebook(db);
        let codebook_csv = if enabled {
            support.codebook_csv(db)
        } else {
            Arc::default()
        };
        let codebook = parsed_codebook(db, support);
        let use_static_annotations =
            !config.model_concurrent_usage(db) && background_apps(db, config, support).is_empty();
        // annotation_input_key commits every annotation-affecting setting
        // (codebook, engagement, thresholds, removed types, zero-duration
        // filter); the upstream split checkpoint commits the input rows; the
        // static/prepared checkpoints commit the static-path overlay sources.
        let alternation_key = if use_static_annotations {
            let prepared = review_usage_rows_before_floor(db, raw, early, config, support)?;
            let static_annotations = review_static_annotations(db, raw, early, config, support)?;
            format!(
                "static|{annotation_input_key}|{}|{}|{}",
                upstream.segment_concurrent_usage.terminal_digest,
                static_annotations.checkpoint.terminal_digest,
                prepared.checkpoint.terminal_digest,
            )
        } else {
            format!(
                "dynamic|{annotation_input_key}|{}",
                upstream.segment_concurrent_usage.terminal_digest,
            )
        };
        if let Some(cached) = ANNOTATIONS_FUSED_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().lookup(&alternation_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=review_annotations_fused");
            return Ok(cached);
        }
        let mut static_checkpoint = None;
        let mut static_classification_unchanged = true;
        let mut static_rows_unchanged = true;
        let mut static_temporal_matches_upstream = false;
        let mut rows = if use_static_annotations {
            let prepared = review_usage_rows_before_floor(db, raw, early, config, support)?;
            static_temporal_matches_upstream = prepared.filtered_packages.is_empty();
            let static_annotations = review_static_annotations(db, raw, early, config, support)?;
            if static_annotations.rows.len() != upstream.rows.len() {
                return Err(format!(
                    "static annotation row count mismatch: {} != {}",
                    static_annotations.rows.len(),
                    upstream.rows.len(),
                ));
            }
            let mut rows = (*static_annotations.rows).clone();
            let thresholds = super::prepare_usage_flags(
                &config.long_data_time_gap_thresholds(db),
                &config.long_usage_duration_thresholds(db),
            );
            for &index in prepared.floor_candidate_indices.iter() {
                let index = index as usize;
                let source = &upstream.rows[index];
                let target = &mut rows[index];
                if target.index != source.index
                    || target.event_timestamp_ns != source.event_timestamp_ns
                    || target.participant_id != source.participant_id
                    || target.app_package_name != source.app_package_name
                {
                    return Err(format!(
                        "static annotation correspondence mismatch at row {index}"
                    ));
                }
                let same_seconds = match (target.duration_seconds, source.duration_seconds) {
                    (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
                    (None, None) => true,
                    _ => false,
                };
                let same_minutes = match (target.duration_minutes, source.duration_minutes) {
                    (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
                    (None, None) => true,
                    _ => false,
                };
                if !same_seconds || !same_minutes {
                    static_rows_unchanged = false;
                    let temporal = target.edit_temporal();
                    temporal.duration_seconds = source.duration_seconds;
                    temporal.duration_minutes = source.duration_minutes;
                    let previous_flags = target.any_app_usage_flags.clone();
                    super::mark_app_usage_flags_row(target, &thresholds);
                    static_classification_unchanged &= target.any_app_usage_flags == previous_flags;
                }
            }
            static_checkpoint = Some((
                Arc::clone(&static_annotations.rows),
                static_annotations.checkpoint.clone(),
            ));
            rows
        } else {
            let mut rows = (*upstream.rows).clone();
            let timer = QueryTimer::start("review_annotations_apply_codebook");
            super::apply_codebook_annotations(&mut rows, enabled, &codebook);
            timer.finish();
            rows
        };
        let join_app_codebook = review_derived_checkpoint(
            "join_app_codebook",
            &[("rows", &upstream.segment_concurrent_usage)],
            &serde_json::json!({
                "enabled": enabled,
                "codebookDigest": digest_bytes(&codebook_csv),
                "codebookIsEmpty": codebook.is_empty(),
            }),
        )?;
        if !use_static_annotations {
            db.record_fused_product_step("join_app_codebook");
        }

        let derive_broad_category = review_derived_checkpoint(
            "derive_broad_category",
            &[("rows", &join_app_codebook)],
            &serde_json::json!({"enabled": enabled}),
        )?;
        if !use_static_annotations {
            db.record_fused_product_step("derive_broad_category");
        }

        let collapse_app_genre = review_derived_checkpoint(
            "collapse_app_genre",
            &[("rows", &derive_broad_category)],
            &serde_json::json!({"enabled": enabled}),
        )?;
        let categorize_apps = workflow_checkpoint(
            "categorize_apps",
            &[],
            &[("rows", collapse_app_genre.terminal_digest.as_bytes())],
        );
        if !use_static_annotations {
            db.record_fused_product_step("collapse_app_genre");
        }

        let long_gap_thresholds = config.long_data_time_gap_thresholds(db);
        let long_usage_thresholds = config.long_usage_duration_thresholds(db);
        if !use_static_annotations {
            let timer = QueryTimer::start("review_annotations_row_pass");
            super::apply_review_annotations_one_pass(
                &mut rows,
                config.custom_app_engagement_duration(db),
                &long_gap_thresholds,
                &long_usage_thresholds,
            );
            timer.finish();
        }
        let derive_engagement_basis = review_derived_checkpoint(
            "derive_engagement_basis",
            &[("rows", &collapse_app_genre)],
            &serde_json::json!({
                "customAppEngagementDuration": config.custom_app_engagement_duration(db),
            }),
        )?;
        if !use_static_annotations {
            db.record_fused_product_step("derive_engagement_basis");
        }

        let apply_episode_flags = review_derived_checkpoint(
            "apply_episode_flags",
            &[("rows", &derive_engagement_basis)],
            &serde_json::json!({
                "longDataTimeGapThresholds": long_gap_thresholds,
                "longUsageDurationThresholds": long_usage_thresholds,
            }),
        );
        let apply_episode_flags = apply_episode_flags?;
        let episode_annotations = workflow_checkpoint(
            "episode_annotations",
            &[],
            &[("rows", apply_episode_flags.terminal_digest.as_bytes())],
        );
        db.record_fused_product_step("apply_episode_flags");

        let suppress_excluded_timing = review_derived_checkpoint(
            "suppress_excluded_timing",
            &[("rows", &apply_episode_flags)],
            &serde_json::json!({}),
        )?;
        if !use_static_annotations {
            db.record_fused_product_step("suppress_excluded_timing");
        }

        let removed_types = config.interaction_types_to_remove(db);
        if !removed_types.is_empty() {
            static_rows_unchanged = false;
            rows = super::remove_selected_interaction_types(
                rows,
                &removed_types,
                &long_gap_thresholds,
            );
        }
        let remove_selected_interaction_types = review_derived_checkpoint(
            "remove_selected_interaction_types",
            &[("rows", &suppress_excluded_timing)],
            &serde_json::json!({
                "removedTypes": removed_types,
                "longDataTimeGapThresholds": long_gap_thresholds,
            }),
        )?;
        db.record_fused_product_step("remove_selected_interaction_types");

        if config.filter_zero_duration_sessions(db) {
            static_rows_unchanged = false;
            rows = super::remove_zero_duration_rows(rows, true);
        }
        let timer = QueryTimer::start("review_annotations_final_checkpoint");
        let checkpoint_payload = serde_json::json!({
            "enabled": config.filter_zero_duration_sessions(db),
            "upstreamDigest": remove_selected_interaction_types.terminal_digest,
        });
        let zero_duration_filter_off = !config.filter_zero_duration_sessions(db);
        let remove_zero_duration_rows = match static_checkpoint.as_ref() {
            Some((_, static_checkpoint))
                if static_rows_unchanged
                    && removed_types.is_empty()
                    && zero_duration_filter_off =>
            {
                let fingerprint =
                    super::value_fingerprint(&checkpoint_payload).map_err(|error| {
                        format!("serialize remove_zero_duration_rows checkpoint: {error}")
                    })?;
                checkpoint_for_exact_row_state(
                    "remove_zero_duration_rows",
                    static_checkpoint,
                    &[("value", &fingerprint)],
                )
            }
            Some((_, static_checkpoint))
                if removed_types.is_empty()
                    && zero_duration_filter_off
                    && static_classification_unchanged
                    && static_temporal_matches_upstream =>
            {
                checkpoint_with_known_row_components(
                    "remove_zero_duration_rows",
                    static_checkpoint,
                    upstream
                        .segment_concurrent_usage
                        .temporal_state_digest
                        .clone(),
                    &checkpoint_payload,
                )?
            }
            _ if removed_types.is_empty() && zero_duration_filter_off => {
                rows_and_value_checkpoint_reusing_membership_and_order(
                    "remove_zero_duration_rows",
                    &rows,
                    &upstream.rows,
                    &upstream.segment_concurrent_usage,
                    &checkpoint_payload,
                )?
            }
            _ => rows_and_value_checkpoint_reusing(
                "remove_zero_duration_rows",
                &rows,
                &upstream.rows,
                &upstream.segment_concurrent_usage,
                &checkpoint_payload,
            )?,
        };
        let interval_cleaning = workflow_checkpoint(
            "interval_cleaning",
            &[],
            &[("rows", remove_zero_duration_rows.terminal_digest.as_bytes())],
        );
        timer.finish();

        let result = ReviewAnnotations {
            rows: Arc::new(rows),
            join_app_codebook,
            derive_broad_category,
            collapse_app_genre,
            categorize_apps,
            derive_engagement_basis,
            apply_episode_flags,
            episode_annotations,
            suppress_excluded_timing,
            remove_selected_interaction_types,
            remove_zero_duration_rows,
            interval_cleaning,
            remove_zero_duration_rows_executed: config.filter_zero_duration_sessions(db),
        };
        ANNOTATIONS_FUSED_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(alternation_key, result.clone()));
        Ok(result)
    }

    #[salsa::tracked(returns(clone))]
    fn derive_engagement_basis(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("derive_engagement_basis");
        db.record_query_body("derive_engagement_basis");
        let rows = collapse_app_genre(db, raw, early, config, support)?;
        Ok(rows_step_reusing(
            "derive_engagement_basis",
            &rows,
            super::derive_engagement_basis(
                (*rows.value).clone(),
                config.custom_app_engagement_duration(db),
            ),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn apply_episode_flags(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("apply_episode_flags");
        db.record_query_body("apply_episode_flags");
        let rows = derive_engagement_basis(db, raw, early, config, support)?;
        Ok(with_logical_rows(
            rows_step_reusing(
                "apply_episode_flags",
                &rows,
                super::apply_episode_flags(
                    (*rows.value).clone(),
                    &config.long_data_time_gap_thresholds(db),
                    &config.long_usage_duration_thresholds(db),
                ),
            ),
            "episode_annotations",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn suppress_excluded_timing(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("suppress_excluded_timing");
        db.record_query_body("suppress_excluded_timing");
        let rows = apply_episode_flags(db, raw, early, config, support)?;
        if resolve_excluded_packages(db, raw, early, config, support)?
            .value
            .is_empty()
        {
            return Ok(unchanged_rows_step("suppress_excluded_timing", &rows));
        }
        Ok(rows_step_reusing(
            "suppress_excluded_timing",
            &rows,
            super::suppress_excluded_timing((*rows.value).clone()),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn remove_selected_interaction_types(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("remove_selected_interaction_types");
        db.record_query_body("remove_selected_interaction_types");
        let rows = suppress_excluded_timing(db, raw, early, config, support)?;
        let removed_types = config.interaction_types_to_remove(db);
        if removed_types.is_empty() {
            if !config.review_only(db) {
                return Ok(unchanged_rows_step(
                    "remove_selected_interaction_types",
                    &rows,
                ));
            }
            return review_passthrough_rows(
                "remove_selected_interaction_types",
                &rows,
                &serde_json::json!({"removedTypes": []}),
                None,
            );
        }
        Ok(rows_step_reusing(
            "remove_selected_interaction_types",
            &rows,
            super::remove_selected_interaction_types(
                (*rows.value).clone(),
                &removed_types,
                &config.long_data_time_gap_thresholds(db),
            ),
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn remove_zero_duration_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("remove_zero_duration_rows");
        if config.review_only(db) {
            let fused = review_annotations_fused(db, raw, early, config, support)?;
            if fused.remove_zero_duration_rows_executed {
                db.record_query_body("remove_zero_duration_rows");
            } else {
                db.record_internal_query_body("remove_zero_duration_rows_review_output");
            }
            return Ok(QueryValue {
                value: Arc::clone(&fused.rows),
                checkpoint: fused.remove_zero_duration_rows.clone(),
                query_group_checkpoint: Some(fused.interval_cleaning.clone()),
            });
        }
        db.record_query_body("remove_zero_duration_rows");
        let rows = remove_selected_interaction_types(db, raw, early, config, support)?;
        if !config.filter_zero_duration_sessions(db) {
            return Ok(with_logical_rows(
                unchanged_rows_step("remove_zero_duration_rows", &rows),
                "interval_cleaning",
            ));
        }
        Ok(with_logical_rows(
            rows_step_reusing(
                "remove_zero_duration_rows",
                &rows,
                super::remove_zero_duration_rows((*rows.value).clone(), true),
            ),
            "interval_cleaning",
        ))
    }

    #[salsa::tracked(returns(clone))]
    fn identify_credit_eligible_sessions(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<CreditPartition>, String> {
        db.record_query_body("identify_credit_eligible_sessions");
        let rows = remove_zero_duration_rows(db, raw, early, config, support)?;
        let partition = super::identify_credit_eligible_sessions(&rows.value, None)?;
        let payload = CreditPartitionCheckpoint {
            session_count: partition.sessions.len(),
            rest_count: partition.rest.len(),
            session_rows_digest: &partition.session_rows_digest,
            rest_rows_digest: &partition.rest_rows_digest,
        };
        let checkpoint = value_payload_checkpoint("identify_credit_eligible_sessions", &payload)?;
        Ok(QueryValue {
            value: Arc::new(partition),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    #[salsa::tracked(returns(clone))]
    fn build_activity_witness_indexes(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<ScreenCreditSubstrate>, String> {
        db.record_query_body("build_activity_witness_indexes");
        let rows = mark_app_policy_matches(db, raw, early, config, support)?;
        value_step(
            "build_activity_witness_indexes",
            super::build_activity_witness_indexes(&rows.value)?,
        )
    }

    #[salsa::tracked(returns(clone))]
    fn assess_screen_evidence_capability(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<Vec<String>>, String> {
        db.record_query_body("assess_screen_evidence_capability");
        let partition = identify_credit_eligible_sessions(db, raw, early, config, support)?;
        let substrate = build_activity_witness_indexes(db, raw, early, config, support)?;
        value_step(
            "assess_screen_evidence_capability",
            super::screen_incapable_participants(&partition.value, &substrate.value),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn summarize_daily_apps(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<DayApps>, String> {
        db.record_query_body("summarize_daily_apps");
        let partition = identify_credit_eligible_sessions(db, raw, early, config, support)?;
        let day_apps = super::summarize_daily_apps(&partition.value);
        let payload = day_apps
            .iter()
            .map(|((participant_id, date), packages)| {
                serde_json::json!({
                    "participantId": participant_id,
                    "date": date,
                    "packages": packages,
                })
            })
            .collect::<Vec<_>>();
        value_payload_step("summarize_daily_apps", day_apps, &payload)
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct CreditSessionPlan {
        decisions: Vec<CreditDecision>,
        tolerance_minutes: f64,
    }

    #[salsa::tracked(returns(clone))]
    fn derive_credited_intervals(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
    ) -> Result<QueryValue<CreditSessionPlan>, String> {
        db.record_query_body("derive_credited_intervals");
        let partition = identify_credit_eligible_sessions(db, raw, early, config, support)?;
        let substrate = build_activity_witness_indexes(db, raw, early, config, support)?;
        let day_apps = summarize_daily_apps(db, raw, early, config, support)?;
        let tolerance_minutes = late.device_liveness_gap_tolerance_minutes(db);
        let decisions = super::derive_credited_intervals(
            &partition.value,
            &substrate.value,
            &day_apps.value,
            late.credited_session_cap_minutes(db),
            tolerance_minutes,
            late.auto_lock_bridge_seconds(db),
            late.no_witness_min_day_apps(db),
        );
        let payload = serde_json::json!({
            "decisions": decisions,
            "toleranceMinutes": tolerance_minutes,
        });
        value_payload_step(
            "derive_credited_intervals",
            CreditSessionPlan {
                decisions,
                tolerance_minutes,
            },
            &payload,
        )
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct CreditEmissionStep {
        emission: CreditEmission,
    }

    #[salsa::tracked(returns(clone))]
    fn materialize_credited_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
    ) -> Result<QueryValue<CreditEmissionStep>, String> {
        db.record_query_body("materialize_credited_rows");
        let plan = derive_credited_intervals(db, raw, early, config, support, late)?;
        let partition = identify_credit_eligible_sessions(db, raw, early, config, support)?;
        let substrate = build_activity_witness_indexes(db, raw, early, config, support)?;
        let emission = super::materialize_credited_rows(
            &partition.value,
            &plan.value.decisions,
            &substrate.value,
            plan.value.tolerance_minutes,
        );
        let payload = serde_json::json!({
            "creditedRowsDigest": emission.credited_rows_digest,
            "emissionCounts": emission.counts,
        });
        value_payload_step(
            "materialize_credited_rows",
            CreditEmissionStep { emission },
            &payload,
        )
    }

    #[salsa::tracked(returns(clone))]
    fn assemble_credit_outputs(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
    ) -> Result<QueryValue<CreditResult>, String> {
        db.record_query_body("assemble_credit_outputs");
        let partition = identify_credit_eligible_sessions(db, raw, early, config, support)?;
        let screen_incapable = assess_screen_evidence_capability(db, raw, early, config, support)?;
        let emission = materialize_credited_rows(db, raw, early, config, support, late)?;
        let result = super::assemble_credit_outputs(
            &partition.value,
            &screen_incapable.value,
            &emission.value.emission,
        );
        let payload = serde_json::json!({
            "creditedRowsDigest": result.credited_rows_digest,
            "restRowsDigest": result.rest_rows_digest,
            "report": result.report,
        });
        value_payload_step("assemble_credit_outputs", result, &payload)
    }

    #[salsa::tracked(returns(clone))]
    fn resolve_participant_windows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<Vec<ResolvedParticipantWindow>>, String> {
        let _timer = QueryTimer::start("resolve_participant_windows");
        db.record_query_body("resolve_participant_windows");
        let rows = remove_zero_duration_rows(db, raw, early, config, support)?;
        let windows = parsed_study_windows(db, late_support)?;
        let cache_key = format!("{}|{:?}", rows.checkpoint.terminal_digest, windows);
        if let Some(cached) = PARTICIPANT_WINDOWS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().lookup(&cache_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=resolve_participant_windows");
            return Ok(cached);
        }
        let result = value_step(
            "resolve_participant_windows",
            super::resolve_windows(&rows.value, &windows),
        )?;
        PARTICIPANT_WINDOWS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(cache_key, result.clone()));
        Ok(result)
    }

    #[salsa::tracked(returns(clone))]
    fn apply_participant_windows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<WindowedRows>, String> {
        let _timer = QueryTimer::start("apply_participant_windows");
        db.record_query_body("apply_participant_windows");
        let rows = remove_zero_duration_rows(db, raw, early, config, support)?;
        let resolved = resolve_participant_windows(db, raw, early, config, support, late_support)?;
        let enabled = late.enable_study_window_filter(db);
        let windows = parsed_study_windows(db, late_support)?;
        if config.review_only(db) && !enabled {
            let mut participants_without_window = resolved
                .value
                .iter()
                .filter_map(|entry| {
                    entry
                        .window
                        .is_none()
                        .then_some(entry.participant_id.clone())
                })
                .collect::<Vec<_>>();
            participants_without_window.sort();
            let payload = serde_json::json!({
                "applied": false,
                "droppedRows": 0,
                "participantsWithoutWindow": participants_without_window,
            });
            let checkpoint = review_passthrough_checkpoint(
                "apply_participant_windows",
                &rows.checkpoint,
                &payload,
            )?;
            let query_group_checkpoint = workflow_checkpoint(
                "observation_window",
                &[],
                &[("review_passthrough", checkpoint.terminal_digest.as_bytes())],
            );
            return Ok(QueryValue {
                value: Arc::new(WindowedRows {
                    rows: Arc::clone(&rows.value),
                    dropped_rows: 0,
                    participants_without_window,
                    applied: false,
                }),
                checkpoint,
                query_group_checkpoint: Some(query_group_checkpoint),
            });
        }
        let value =
            super::filter_to_window(Arc::clone(&rows.value), &resolved.value, enabled, &windows)?;
        let payload = serde_json::json!({
            "applied": value.applied,
            "droppedRows": value.dropped_rows,
            "participantsWithoutWindow": value.participants_without_window,
        });
        let checkpoint = if Arc::ptr_eq(&value.rows, &rows.value) {
            let fingerprint = super::value_fingerprint(&payload).map_err(|error| {
                format!("serialize apply_participant_windows checkpoint: {error}")
            })?;
            checkpoint_for_exact_row_state(
                "apply_participant_windows",
                &rows.checkpoint,
                &[("value", &fingerprint)],
            )
        } else {
            rows_and_value_checkpoint_reusing(
                "apply_participant_windows",
                &value.rows,
                &rows.value,
                &rows.checkpoint,
                &payload,
            )?
        };
        let query_group_checkpoint = if Arc::ptr_eq(&value.rows, &rows.value) {
            checkpoint_for_exact_row_state("observation_window", &checkpoint, &[])
        } else {
            workflow_rows_checkpoint("observation_window", &value.rows)
        };
        Ok(QueryValue {
            value: Arc::new(value),
            checkpoint,
            query_group_checkpoint: Some(query_group_checkpoint),
        })
    }

    #[salsa::tracked(returns(clone))]
    fn resolve_sharing_status(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<SharingResolutionValue>, String> {
        let _timer = QueryTimer::start("resolve_sharing_status");
        db.record_query_body("resolve_sharing_status");
        let windowed =
            apply_participant_windows(db, raw, early, config, support, late, late_support)?;
        let enabled = late.enable_person_attribution(db);
        let sharing = if enabled {
            parsed_device_sharing(db, late_support)?
        } else {
            Arc::default()
        };
        let value = super::resolve_sharing(&windowed.value.rows, enabled, &sharing)?;
        match &value {
            SharingResolutionValue::Disabled => value_payload_step(
                "resolve_sharing_status",
                value,
                &serde_json::json!({"enabled": false}),
            ),
            SharingResolutionValue::Enabled(resolution) => {
                let checkpoint = value_payload_checkpoint("resolve_sharing_status", resolution)?;
                Ok(QueryValue {
                    value: Arc::new(value),
                    checkpoint,
                    query_group_checkpoint: None,
                })
            }
        }
    }

    #[salsa::tracked(returns(clone))]
    fn index_survey_responses(
        db: &dyn EarlyStepDb,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<SurveyLookup>, String> {
        db.record_query_body("index_survey_responses");
        let enabled = late.enable_person_attribution(db);
        if !enabled {
            return value_payload_step(
                "index_survey_responses",
                BTreeMap::new(),
                &serde_json::json!({"enabled": false}),
            );
        }
        let survey = parsed_survey_attribution(db, late_support)?;
        let payload = survey
            .iter()
            .map(|((participant_id, event_timestamp_ns), user)| {
                serde_json::json!({
                    "participantId": participant_id,
                    "eventTimestampNs": event_timestamp_ns,
                    "user": user,
                })
            })
            .collect::<Vec<_>>();
        value_payload_step("index_survey_responses", (*survey).clone(), &payload)
    }

    #[salsa::tracked(returns(clone))]
    fn classify_person_attribution(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<AttributedRows>, String> {
        let _timer = QueryTimer::start("classify_person_attribution");
        db.record_query_body("classify_person_attribution");
        let windowed =
            apply_participant_windows(db, raw, early, config, support, late, late_support)?;
        if config.review_only(db) && !late.enable_person_attribution(db) {
            let payload = serde_json::json!({"applied": false});
            let checkpoint = review_passthrough_checkpoint(
                "classify_person_attribution",
                &windowed.checkpoint,
                &payload,
            )?;
            let query_group_checkpoint = workflow_checkpoint(
                "attribute_person",
                &[],
                &[("review_passthrough", checkpoint.terminal_digest.as_bytes())],
            );
            return Ok(QueryValue {
                value: Arc::new(AttributedRows {
                    rows: windowed.value.rows.clone(),
                    report: None,
                    shared_participants: BTreeSet::new(),
                }),
                checkpoint,
                query_group_checkpoint: Some(query_group_checkpoint),
            });
        }
        let sharing = resolve_sharing_status(db, raw, early, config, support, late, late_support)?;
        let survey = index_survey_responses(db, late, late_support)?;
        let value = super::classify_person_attribution(
            Arc::clone(&windowed.value.rows),
            &sharing.value,
            &survey.value,
        )?;
        let payload = match &value.report {
            Some(report) => serde_json::json!({"applied": true, "report": report}),
            None => serde_json::json!({"applied": false}),
        };
        let checkpoint = if Arc::ptr_eq(&value.rows, &windowed.value.rows) {
            let fingerprint = super::value_fingerprint(&payload).map_err(|error| {
                format!("serialize classify_person_attribution checkpoint: {error}")
            })?;
            checkpoint_for_exact_row_state(
                "classify_person_attribution",
                &windowed.checkpoint,
                &[("value", &fingerprint)],
            )
        } else {
            rows_and_value_checkpoint_reusing(
                "classify_person_attribution",
                &value.rows,
                &windowed.value.rows,
                &windowed.checkpoint,
                &payload,
            )?
        };
        let shared_fingerprint = super::value_fingerprint(&value.shared_participants)
            .map_err(|error| format!("serialize shared-participant checkpoint: {error}"))?;
        let query_group_checkpoint = if Arc::ptr_eq(&value.rows, &windowed.value.rows) {
            checkpoint_for_exact_row_state(
                "attribute_person",
                &checkpoint,
                &[("shared_participants", &shared_fingerprint)],
            )
        } else {
            workflow_checkpoint(
                "attribute_person",
                &[("rows", &value.rows)],
                &[("shared_participants", &shared_fingerprint)],
            )
        };
        Ok(QueryValue {
            value: Arc::new(value),
            checkpoint,
            query_group_checkpoint: Some(query_group_checkpoint),
        })
    }

    #[salsa::tracked(returns(clone))]
    fn synthesize_placeholder_rows(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let _timer = QueryTimer::start("synthesize_placeholder_rows");
        db.record_query_body("synthesize_placeholder_rows");
        let attributed =
            classify_person_attribution(db, raw, early, config, support, late, late_support)?;
        let applied = late.add_no_activity_placeholder_days(db);
        if config.review_only(db) && !applied {
            let checkpoint = review_passthrough_checkpoint(
                "synthesize_placeholder_rows",
                &attributed.checkpoint,
                &serde_json::json!({"applied": false}),
            )?;
            return Ok(QueryValue {
                value: Arc::clone(&attributed.value.rows),
                checkpoint,
                query_group_checkpoint: None,
            });
        }
        if !applied {
            let fingerprint = super::value_fingerprint(&serde_json::json!({"applied": false}))
                .map_err(|error| {
                    format!("serialize synthesize_placeholder_rows checkpoint: {error}")
                })?;
            return Ok(QueryValue {
                value: Arc::clone(&attributed.value.rows),
                checkpoint: checkpoint_for_exact_row_state(
                    "synthesize_placeholder_rows",
                    &attributed.checkpoint,
                    &[("value", &fingerprint)],
                ),
                query_group_checkpoint: None,
            });
        }
        let policy_rows = mark_app_policy_matches(db, raw, early, config, support)?;
        let rows = super::synthesize_placeholder_rows(
            Arc::clone(&attributed.value.rows),
            &policy_rows.value,
            applied,
        );
        let checkpoint = rows_and_value_checkpoint(
            "synthesize_placeholder_rows",
            &rows,
            &serde_json::json!({"applied": applied}),
        )?;
        Ok(QueryValue {
            value: rows,
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    #[salsa::tracked(returns(clone))]
    fn index_raw_dates(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<QueryValue<BTreeMap<String, BTreeSet<String>>>, String> {
        db.record_query_body("index_raw_dates");
        let rows = mark_app_policy_matches(db, raw, early, config, support)?;
        value_step("index_raw_dates", super::index_raw_dates(&rows.value))
    }

    #[salsa::tracked(returns(clone))]
    fn build_participant_day_coverage(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<CoverageOutput>, String> {
        db.record_query_body("build_participant_day_coverage");
        let rows =
            synthesize_placeholder_rows(db, raw, early, config, support, late, late_support)?;
        let raw_dates = index_raw_dates(db, raw, early, config, support)?;
        let windows = parsed_study_windows(db, late_support)?;
        let output = super::build_coverage(&rows.value, &raw_dates.value, &windows)?;
        let checkpoint =
            value_payload_checkpoint("build_participant_day_coverage", &output.report)?;
        let query_group_checkpoint = workflow_checkpoint(
            "day_coverage",
            &[("rows", rows.value.as_ref())],
            &[("day_coverage_csv", &output.csv_bytes)],
        );
        Ok(QueryValue {
            value: Arc::new(output),
            checkpoint,
            query_group_checkpoint: Some(query_group_checkpoint),
        })
    }

    #[salsa::tracked(returns(clone))]
    fn aggregate_attribution_minutes(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<AttributionMinutes>, String> {
        db.record_query_body("aggregate_attribution_minutes");
        let rows =
            synthesize_placeholder_rows(db, raw, early, config, support, late, late_support)?;
        let value = super::accumulate_minutes(&rows.value);
        let buckets = value
            .buckets
            .iter()
            .map(
                |((participant_id, date), (known_minutes, unknown_minutes))| {
                    serde_json::json!({
                        "participantId": participant_id,
                        "date": date,
                        "knownMinutes": known_minutes,
                        "unknownMinutes": unknown_minutes,
                    })
                },
            )
            .collect::<Vec<_>>();
        let payload = serde_json::json!({
            "participantsSeen": value.participants_seen,
            "buckets": buckets,
        });
        value_payload_step("aggregate_attribution_minutes", value, &payload)
    }

    #[salsa::tracked(returns(clone))]
    fn compute_attribution_completeness(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<AttributionCompleteness>, String> {
        db.record_query_body("compute_attribution_completeness");
        let minutes =
            aggregate_attribution_minutes(db, raw, early, config, support, late, late_support)?;
        let attributed =
            classify_person_attribution(db, raw, early, config, support, late, late_support)?;
        value_step(
            "compute_attribution_completeness",
            super::compute_attribution_completeness(
                &minutes.value,
                &attributed.value.shared_participants,
            ),
        )
    }

    #[salsa::tracked(returns(clone))]
    fn classify_compliance_days(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
    ) -> Result<QueryValue<ComplianceResultCheckpoint>, String> {
        db.record_query_body("classify_compliance_days");
        let completeness =
            compute_attribution_completeness(db, raw, early, config, support, late, late_support)?;
        value_step(
            "classify_compliance_days",
            super::apply_compliance_threshold(
                &completeness.value,
                late.compliance_threshold_percent(db),
            ),
        )
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct AssembledOutputs {
        app_csv_bytes: Arc<Vec<u8>>,
        screen_csv_bytes: Arc<Vec<u8>>,
        day_coverage_csv_bytes: Arc<Vec<u8>>,
        compliance_csv_bytes: Arc<Vec<u8>>,
        credited_app_csv_bytes: Arc<Vec<u8>>,
        review_summary_json_bytes: Arc<Vec<u8>>,
        visualization_data_json_bytes: Arc<Vec<u8>>,
        aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput>>,
        row_lineage: Arc<Vec<PipelineRowLineage>>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    struct PrimaryOutputs {
        app_csv_bytes: Arc<Vec<u8>>,
        screen_csv_bytes: Arc<Vec<u8>>,
        credited_app_csv_bytes: Arc<Vec<u8>>,
        review_summary_json_bytes: Arc<Vec<u8>>,
        visualization_data_json_bytes: Arc<Vec<u8>>,
        aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput>>,
        row_lineage: Arc<Vec<PipelineRowLineage>>,
    }

    #[salsa::tracked(returns(clone))]
    fn codebook_is_empty(
        db: &dyn EarlyStepDb,
        support: UsageSupportInput,
    ) -> Result<QueryValue<bool>, String> {
        db.record_internal_query_body("codebook_is_empty");
        value_step("codebook_is_empty", parsed_codebook(db, support).is_empty())
    }

    fn assembled_checkpoint(
        node_id: &str,
        outputs: &AssembledOutputs,
    ) -> Result<WorkflowCheckpoint, String> {
        let row_lineage_fingerprint = super::value_fingerprint(&outputs.row_lineage)
            .map_err(|error| format!("serialize row lineage checkpoint: {error}"))?;
        let aggregate_checkpoint_bytes = serde_json::to_vec(
            &outputs
                .aggregate_csv_outputs
                .iter()
                .map(|aggregate| {
                    serde_json::json!({
                        "kind": aggregate.kind,
                        "rowCount": aggregate.row_count,
                        "digest": format!(
                            "sha256:{}",
                            hex::encode(Sha256::digest(&aggregate.bytes))
                        ),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .map_err(|error| format!("serialize aggregate checkpoint: {error}"))?;
        Ok(workflow_checkpoint(
            node_id,
            &[],
            &[
                ("app_csv", &outputs.app_csv_bytes),
                ("screen_csv", &outputs.screen_csv_bytes),
                ("day_coverage_csv", &outputs.day_coverage_csv_bytes),
                ("compliance_csv", &outputs.compliance_csv_bytes),
                ("credited_app_csv", &outputs.credited_app_csv_bytes),
                ("review_summary_json", &outputs.review_summary_json_bytes),
                (
                    "visualization_data_json",
                    &outputs.visualization_data_json_bytes,
                ),
                ("aggregates", &aggregate_checkpoint_bytes),
                ("row_lineage", &row_lineage_fingerprint),
            ],
        ))
    }

    fn primary_outputs_checkpoint(outputs: &PrimaryOutputs) -> Result<WorkflowCheckpoint, String> {
        assembled_checkpoint(
            "primary_outputs",
            &AssembledOutputs {
                app_csv_bytes: Arc::clone(&outputs.app_csv_bytes),
                screen_csv_bytes: Arc::clone(&outputs.screen_csv_bytes),
                day_coverage_csv_bytes: Arc::default(),
                compliance_csv_bytes: Arc::default(),
                credited_app_csv_bytes: Arc::clone(&outputs.credited_app_csv_bytes),
                review_summary_json_bytes: Arc::clone(&outputs.review_summary_json_bytes),
                visualization_data_json_bytes: Arc::clone(&outputs.visualization_data_json_bytes),
                aggregate_csv_outputs: Arc::clone(&outputs.aggregate_csv_outputs),
                row_lineage: Arc::clone(&outputs.row_lineage),
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn output_options(
        db: &dyn EarlyStepDb,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        output: OutputConfigInput,
        include_late_outputs: bool,
    ) -> PipelineV2Options {
        PipelineV2Options {
            study_name: output.study_name(db),
            timezone: early.timezone(db),
            timezone_handling: early.timezone_handling(db),
            usage_session_mode: config.usage_session_mode(db),
            include_app_output: output.include_app_output(db),
            include_screen_output: output.include_screen_output(db),
            use_filter_file: false,
            use_apps_forcing_screen_open: false,
            use_background_apps_file: support.use_background_apps_file(db),
            use_app_codebook: support.use_app_codebook(db),
            include_category_column: output.include_category_column(db),
            deduplicate_exact_rows: early.deduplicate_exact_rows(db),
            interaction_type_remap: Vec::new(),
            correct_duplicate_event_timestamps: early.correct_duplicate_event_timestamps(db),
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: false,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: 0,
            proximity_interval_ns: 0,
            custom_app_engagement_duration: config.custom_app_engagement_duration(db),
            long_data_time_gap_thresholds: Vec::new(),
            long_usage_duration_thresholds: Vec::new(),
            same_app_stop_types: Vec::new(),
            other_stop_types: Vec::new(),
            interaction_types_to_remove: Vec::new(),
            screen_auto_lock_timeout_seconds: 0.0,
            screen_auto_lock_tolerance_seconds: 0.0,
            screen_manual_lock_max_tail_seconds: 0.0,
            screen_keyguard_near_stop_seconds: 0.0,
            datetime_of_preprocessing: early.datetime_of_preprocessing(db),
            model_concurrent_usage: config.model_concurrent_usage(db),
            minimum_usage_duration: 0.0,
            apply_minimum_usage_duration_to_concurrent_subintervals: false,
            filter_zero_duration_sessions: false,
            add_no_activity_placeholder_days: false,
            enable_study_window_filter: false,
            enable_person_attribution: false,
            enable_day_coverage: include_late_outputs && late.enable_day_coverage(db),
            enable_compliance_scoring: include_late_outputs && late.enable_compliance_scoring(db),
            compliance_threshold_percent: 0.0,
            enable_screen_gated_crediting: late.enable_screen_gated_crediting(db),
            enable_aggregates: output.enable_aggregates(db),
            aggregate_shape: output.aggregate_shape(db),
            materialize_visualization_data: output.materialize_visualization_data(db),
            credited_session_cap_minutes: 0.0,
            device_liveness_gap_tolerance_minutes: 0.0,
            auto_lock_bridge_seconds: 0.0,
            no_witness_min_day_apps: 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[salsa::tracked(returns(clone))]
    fn assemble_primary_outputs(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
        output: OutputConfigInput,
    ) -> Result<QueryValue<PrimaryOutputs>, String> {
        let _timer = QueryTimer::start("assemble_primary_outputs");
        db.record_internal_query_body("assemble_primary_outputs");
        let options = output_options(db, early, config, support, late, output, false);
        let materialize_full_outputs = output.materialize_full_outputs(db);
        // This second reference exists only for visualization geometry. The
        // app-row path resolves its own memoized policy input when needed.
        let materialize_visualization_data =
            materialize_full_outputs && options.materialize_visualization_data;
        let policy_rows = materialize_visualization_data
            .then(|| mark_app_policy_matches(db, raw, early, config, support))
            .transpose()?;
        let screen_step = if matches!(
            options.usage_session_mode,
            UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
        ) {
            Some(classify_screen_sessions(db, raw, early, config, support)?)
        } else {
            None
        };
        let screen_rows = screen_step
            .as_ref()
            .map(|step| Arc::clone(&step.value))
            .unwrap_or_default();

        let app_mode = matches!(
            options.usage_session_mode,
            UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
        );
        let app_step = {
            let _timer = QueryTimer::start("resolve_review_app_rows");
            if app_mode {
                Some(synthesize_placeholder_rows(
                    db,
                    raw,
                    early,
                    config,
                    support,
                    late,
                    late_support,
                )?)
            } else {
                None
            }
        };
        let app_rows = app_step
            .as_ref()
            .map(|step| Arc::clone(&step.value))
            .unwrap_or_default();
        let include_aliases = if !materialize_full_outputs || !app_mode || !options.use_app_codebook
        {
            true
        } else {
            *codebook_is_empty(db, support)?.value || options.include_category_column
        };
        let credited_rows =
            if materialize_full_outputs && app_mode && late.enable_screen_gated_crediting(db) {
                Some(assemble_credit_outputs(
                    db, raw, early, config, support, late,
                )?)
            } else {
                None
            };

        // Every salsa read above is also a cache-key component, so a hit and
        // a miss register the identical dependency set for this memo. The
        // remaining work below is pure serialization of those inputs.
        fn step_digest<T>(step: &Option<QueryValue<T>>) -> &str {
            step.as_ref()
                .map(|step| step.checkpoint.terminal_digest.as_str())
                .unwrap_or("none")
        }
        let cache_key = format!(
            "{options:?}|full={materialize_full_outputs}|aliases={include_aliases}|app={}|screen={}|credited={}|policy={}",
            step_digest(&app_step),
            step_digest(&screen_step),
            step_digest(&credited_rows),
            step_digest(&policy_rows),
        );
        if let Some(cached) =
            PRIMARY_OUTPUTS_ALTERNATION_CACHE.with(|cache| cache.borrow_mut().lookup(&cache_key))
        {
            #[cfg(feature = "query-timing")]
            eprintln!("alternation_cache hit=assemble_primary_outputs");
            return Ok(cached);
        }

        let app_csv_bytes = if materialize_full_outputs && app_mode && options.include_app_output {
            write_app_csv(&app_rows, &options, include_aliases)
        } else {
            Vec::new()
        };
        let screen_csv_bytes = if materialize_full_outputs
            && options.include_screen_output
            && !matches!(options.usage_session_mode, UsageSessionMode::AppUsage)
        {
            write_screen_csv(&screen_rows, &options)
        } else {
            Vec::new()
        };
        let credited_app_csv_bytes = if materialize_full_outputs {
            if let Some(credited) = &credited_rows {
                write_app_csv_from_iter(
                    credited.value.rows.iter(),
                    credited.value.rows.len(),
                    &options,
                    include_aliases,
                )
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        let review_summary_json_bytes = {
            let _timer = QueryTimer::start("build_and_serialize_review_summary");
            serde_json::to_vec(&build_review_summary(&app_rows, &screen_rows))
                .map_err(|error| format!("serialize review summary: {error}"))?
        };
        let visualization_data_json_bytes = if materialize_visualization_data {
            serde_json::to_vec(&build_visualization_data(
                &app_rows,
                &screen_rows,
                &policy_rows
                    .as_ref()
                    .expect("full materialization always resolves policy rows")
                    .value,
            ))
            .map_err(|error| format!("serialize visualization data: {error}"))?
        } else {
            Vec::new()
        };
        let aggregate_csv_outputs = if materialize_full_outputs {
            aggregates::build_aggregate_outputs(&app_rows, &screen_rows, &options)
        } else {
            Vec::new()
        };
        let mut row_lineage = Vec::new();
        if materialize_full_outputs && !app_csv_bytes.is_empty() {
            row_lineage.extend(build_row_lineage("app-csv", "outputs", &app_rows));
        }
        if materialize_full_outputs && !screen_csv_bytes.is_empty() {
            row_lineage.extend(build_row_lineage("screen-csv", "outputs", &screen_rows));
        }
        if materialize_full_outputs {
            if let Some(credited) = &credited_rows {
                row_lineage.extend(build_row_lineage_from_iter(
                    "credited-app-csv",
                    "effective_usage",
                    credited.value.rows.iter(),
                ));
            }
        }
        let outputs = PrimaryOutputs {
            app_csv_bytes: Arc::new(app_csv_bytes),
            screen_csv_bytes: Arc::new(screen_csv_bytes),
            credited_app_csv_bytes: Arc::new(credited_app_csv_bytes),
            review_summary_json_bytes: Arc::new(review_summary_json_bytes),
            visualization_data_json_bytes: Arc::new(visualization_data_json_bytes),
            aggregate_csv_outputs: Arc::new(aggregate_csv_outputs),
            row_lineage: Arc::new(row_lineage),
        };
        let checkpoint = primary_outputs_checkpoint(&outputs)?;
        let result = QueryValue {
            value: Arc::new(outputs),
            checkpoint,
            query_group_checkpoint: None,
        };
        PRIMARY_OUTPUTS_ALTERNATION_CACHE
            .with(|cache| cache.borrow_mut().store(cache_key, result.clone()));
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn assemble_outputs(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
        output: OutputConfigInput,
    ) -> Result<QueryValue<AssembledOutputs>, String> {
        let primary =
            assemble_primary_outputs(db, raw, early, config, support, late, late_support, output)?;
        let app_mode = matches!(
            config.usage_session_mode(db),
            UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
        );
        let materialize_full_outputs = output.materialize_full_outputs(db);
        let day_coverage_csv_bytes =
            if materialize_full_outputs && app_mode && late.enable_day_coverage(db) {
                Arc::new(
                    build_participant_day_coverage(
                        db,
                        raw,
                        early,
                        config,
                        support,
                        late,
                        late_support,
                    )?
                    .value
                    .csv_bytes
                    .clone(),
                )
            } else {
                Arc::default()
            };
        let compliance_csv_bytes =
            if materialize_full_outputs && app_mode && late.enable_compliance_scoring(db) {
                let scored =
                    classify_compliance_days(db, raw, early, config, support, late, late_support)?;
                let enrolled_devices = parsed_enrolled_devices(db, late_support)?;
                Arc::new(super::compliance_csv(&scored.value, &enrolled_devices))
            } else {
                Arc::default()
            };
        let outputs = AssembledOutputs {
            app_csv_bytes: Arc::clone(&primary.value.app_csv_bytes),
            screen_csv_bytes: Arc::clone(&primary.value.screen_csv_bytes),
            day_coverage_csv_bytes,
            compliance_csv_bytes,
            credited_app_csv_bytes: Arc::clone(&primary.value.credited_app_csv_bytes),
            review_summary_json_bytes: Arc::clone(&primary.value.review_summary_json_bytes),
            visualization_data_json_bytes: Arc::clone(&primary.value.visualization_data_json_bytes),
            aggregate_csv_outputs: Arc::clone(&primary.value.aggregate_csv_outputs),
            row_lineage: Arc::clone(&primary.value.row_lineage),
        };
        let checkpoint = if outputs.day_coverage_csv_bytes.is_empty()
            && outputs.compliance_csv_bytes.is_empty()
        {
            checkpoint_for_exact_state("assemble_result_manifest", &primary.checkpoint)
        } else {
            assembled_checkpoint("assemble_result_manifest", &outputs)?
        };
        let query_group_checkpoint = checkpoint_for_exact_state("outputs", &checkpoint);
        Ok(QueryValue {
            value: Arc::new(outputs),
            checkpoint,
            query_group_checkpoint: Some(query_group_checkpoint),
        })
    }

    #[derive(Clone, Copy)]
    struct TrackedInputs {
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        usage: UsageConfigInput,
        usage_support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
        output: OutputConfigInput,
    }

    impl TrackedInputs {
        // These arguments are the concrete Rust execution boundary. Wrapping
        // them in a one-use parameter object would only hide required inputs.
        #[allow(clippy::too_many_arguments)]
        fn new(
            db: &EarlyDatabase,
            csv_bytes: &[u8],
            input_sha256: String,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Self {
            Self::new_owned(
                db,
                Arc::new(csv_bytes.to_vec()),
                input_sha256,
                Arc::new(review_base_bytes.to_vec()),
                Arc::new(reconstruction_base_bytes.to_vec()),
                options,
                support,
                materialize_full_outputs,
            )
        }

        #[allow(clippy::too_many_arguments)]
        fn new_owned(
            db: &EarlyDatabase,
            csv_bytes: Arc<Vec<u8>>,
            input_sha256: String,
            review_base_bytes: Arc<Vec<u8>>,
            reconstruction_base_bytes: Arc<Vec<u8>>,
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Self {
            Self {
                raw: EarlyRawInput::new(
                    db,
                    csv_bytes,
                    input_sha256,
                    review_base_bytes,
                    reconstruction_base_bytes,
                ),
                early: EarlyConfigInput::new(
                    db,
                    Arc::new(options.interaction_type_remap.clone()),
                    options.timezone.clone(),
                    options.timezone_handling.clone(),
                    options.datetime_of_preprocessing.clone(),
                    options.deduplicate_exact_rows,
                    options.correct_duplicate_event_timestamps,
                    Arc::new(options.same_app_stop_types.clone()),
                    Arc::new(options.other_stop_types.clone()),
                ),
                usage: UsageConfigInput::new(
                    db,
                    options.usage_session_mode,
                    options.model_concurrent_usage,
                    options.allow_stop_event_reuse,
                    options.use_activity_stopped_as_fallback,
                    options.apply_threshold_to_fallback,
                    options.long_duration_threshold_ns,
                    options.proximity_interval_ns,
                    options.minimum_usage_duration,
                    options.apply_minimum_usage_duration_to_concurrent_subintervals,
                    options.custom_app_engagement_duration,
                    Arc::new(options.long_data_time_gap_thresholds.clone()),
                    Arc::new(options.long_usage_duration_thresholds.clone()),
                    Arc::new(options.interaction_types_to_remove.clone()),
                    options.filter_zero_duration_sessions,
                    !materialize_full_outputs,
                ),
                usage_support: UsageSupportInput::new(
                    db,
                    options.use_filter_file,
                    options.use_background_apps_file,
                    options.use_app_codebook,
                    options.use_apps_forcing_screen_open,
                    options.screen_auto_lock_timeout_seconds,
                    options.screen_auto_lock_tolerance_seconds,
                    options.screen_manual_lock_max_tail_seconds,
                    options.screen_keyguard_near_stop_seconds,
                    Arc::new(support.filter_csv.to_vec()),
                    Arc::new(support.background_apps_csv.to_vec()),
                    Arc::new(support.codebook_csv.to_vec()),
                    Arc::new(support.apps_forcing_csv.to_vec()),
                ),
                late: LateConfigInput::new(
                    db,
                    options.enable_screen_gated_crediting,
                    options.credited_session_cap_minutes,
                    options.device_liveness_gap_tolerance_minutes,
                    options.auto_lock_bridge_seconds,
                    options.no_witness_min_day_apps,
                    options.enable_study_window_filter,
                    options.enable_person_attribution,
                    options.add_no_activity_placeholder_days,
                    options.enable_day_coverage,
                    options.enable_compliance_scoring,
                    options.compliance_threshold_percent,
                ),
                late_support: LateSupportInput::new(
                    db,
                    Arc::new(support.study_dates_csv.to_vec()),
                    Arc::new(support.device_sharing_csv.to_vec()),
                    Arc::new(support.survey_attribution_csv.to_vec()),
                    Arc::new(support.enrolled_devices_csv.to_vec()),
                ),
                output: OutputConfigInput::new(
                    db,
                    options.study_name.clone(),
                    options.include_app_output,
                    options.include_screen_output,
                    options.include_category_column,
                    options.enable_aggregates,
                    options.aggregate_shape.clone(),
                    options.materialize_visualization_data,
                    materialize_full_outputs,
                ),
            }
        }

        #[allow(clippy::too_many_arguments)]
        fn update(
            self,
            db: &mut EarlyDatabase,
            csv_bytes: &[u8],
            input_sha256: &str,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
            preserve_verified_input: bool,
        ) {
            macro_rules! set_if_changed {
                ($input:expr, $getter:ident, $setter:ident, $value:expr) => {{
                    let value = $value;
                    if $input.$getter(db) != value {
                        $input.$setter(db).to(value);
                    }
                }};
            }
            macro_rules! set_arc_vec_if_changed {
                ($input:expr, $getter:ident, $setter:ident, $slice:expr, $owned:expr) => {{
                    let current = $input.$getter(db);
                    if current.as_slice() != $slice {
                        $input.$setter(db).to(Arc::new($owned));
                    }
                }};
            }
            if !preserve_verified_input {
                set_arc_vec_if_changed!(self.raw, bytes, set_bytes, csv_bytes, csv_bytes.to_vec());
                set_if_changed!(
                    self.raw,
                    input_sha256,
                    set_input_sha256,
                    input_sha256.to_string()
                );
                set_arc_vec_if_changed!(
                    self.raw,
                    review_base_bytes,
                    set_review_base_bytes,
                    review_base_bytes,
                    review_base_bytes.to_vec()
                );
                set_arc_vec_if_changed!(
                    self.raw,
                    reconstruction_base_bytes,
                    set_reconstruction_base_bytes,
                    reconstruction_base_bytes,
                    reconstruction_base_bytes.to_vec()
                );
            }
            set_arc_vec_if_changed!(
                self.early,
                interaction_type_remap,
                set_interaction_type_remap,
                options.interaction_type_remap.as_slice(),
                options.interaction_type_remap.clone()
            );
            set_if_changed!(self.early, timezone, set_timezone, options.timezone.clone());
            set_if_changed!(
                self.early,
                timezone_handling,
                set_timezone_handling,
                options.timezone_handling.clone()
            );
            set_if_changed!(
                self.early,
                datetime_of_preprocessing,
                set_datetime_of_preprocessing,
                options.datetime_of_preprocessing.clone()
            );
            set_if_changed!(
                self.early,
                deduplicate_exact_rows,
                set_deduplicate_exact_rows,
                options.deduplicate_exact_rows
            );
            set_if_changed!(
                self.early,
                correct_duplicate_event_timestamps,
                set_correct_duplicate_event_timestamps,
                options.correct_duplicate_event_timestamps
            );
            set_arc_vec_if_changed!(
                self.early,
                same_app_stop_types,
                set_same_app_stop_types,
                options.same_app_stop_types.as_slice(),
                options.same_app_stop_types.clone()
            );
            set_arc_vec_if_changed!(
                self.early,
                other_stop_types,
                set_other_stop_types,
                options.other_stop_types.as_slice(),
                options.other_stop_types.clone()
            );

            set_if_changed!(
                self.usage,
                usage_session_mode,
                set_usage_session_mode,
                options.usage_session_mode
            );
            set_if_changed!(
                self.usage_support,
                use_filter_file,
                set_use_filter_file,
                options.use_filter_file
            );
            set_if_changed!(
                self.usage_support,
                use_background_apps_file,
                set_use_background_apps_file,
                options.use_background_apps_file
            );
            set_if_changed!(
                self.usage,
                model_concurrent_usage,
                set_model_concurrent_usage,
                options.model_concurrent_usage
            );
            set_if_changed!(
                self.usage,
                allow_stop_event_reuse,
                set_allow_stop_event_reuse,
                options.allow_stop_event_reuse
            );
            set_if_changed!(
                self.usage,
                use_activity_stopped_as_fallback,
                set_use_activity_stopped_as_fallback,
                options.use_activity_stopped_as_fallback
            );
            set_if_changed!(
                self.usage,
                apply_threshold_to_fallback,
                set_apply_threshold_to_fallback,
                options.apply_threshold_to_fallback
            );
            set_if_changed!(
                self.usage,
                long_duration_threshold_ns,
                set_long_duration_threshold_ns,
                options.long_duration_threshold_ns
            );
            set_if_changed!(
                self.usage,
                proximity_interval_ns,
                set_proximity_interval_ns,
                options.proximity_interval_ns
            );
            set_if_changed!(
                self.usage,
                minimum_usage_duration,
                set_minimum_usage_duration,
                options.minimum_usage_duration
            );
            set_if_changed!(
                self.usage,
                apply_minimum_usage_duration_to_concurrent_subintervals,
                set_apply_minimum_usage_duration_to_concurrent_subintervals,
                options.apply_minimum_usage_duration_to_concurrent_subintervals
            );
            set_if_changed!(
                self.usage_support,
                use_app_codebook,
                set_use_app_codebook,
                options.use_app_codebook
            );
            set_if_changed!(
                self.usage,
                custom_app_engagement_duration,
                set_custom_app_engagement_duration,
                options.custom_app_engagement_duration
            );
            set_arc_vec_if_changed!(
                self.usage,
                long_data_time_gap_thresholds,
                set_long_data_time_gap_thresholds,
                options.long_data_time_gap_thresholds.as_slice(),
                options.long_data_time_gap_thresholds.clone()
            );
            set_arc_vec_if_changed!(
                self.usage,
                long_usage_duration_thresholds,
                set_long_usage_duration_thresholds,
                options.long_usage_duration_thresholds.as_slice(),
                options.long_usage_duration_thresholds.clone()
            );
            set_if_changed!(
                self.usage_support,
                use_apps_forcing_screen_open,
                set_use_apps_forcing_screen_open,
                options.use_apps_forcing_screen_open
            );
            set_if_changed!(
                self.usage_support,
                screen_auto_lock_timeout_seconds,
                set_screen_auto_lock_timeout_seconds,
                options.screen_auto_lock_timeout_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_auto_lock_tolerance_seconds,
                set_screen_auto_lock_tolerance_seconds,
                options.screen_auto_lock_tolerance_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_manual_lock_max_tail_seconds,
                set_screen_manual_lock_max_tail_seconds,
                options.screen_manual_lock_max_tail_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_keyguard_near_stop_seconds,
                set_screen_keyguard_near_stop_seconds,
                options.screen_keyguard_near_stop_seconds
            );
            set_arc_vec_if_changed!(
                self.usage,
                interaction_types_to_remove,
                set_interaction_types_to_remove,
                options.interaction_types_to_remove.as_slice(),
                options.interaction_types_to_remove.clone()
            );
            set_if_changed!(
                self.usage,
                filter_zero_duration_sessions,
                set_filter_zero_duration_sessions,
                options.filter_zero_duration_sessions
            );
            set_if_changed!(
                self.usage,
                review_only,
                set_review_only,
                !materialize_full_outputs
            );

            set_arc_vec_if_changed!(
                self.usage_support,
                filter_csv,
                set_filter_csv,
                support.filter_csv,
                support.filter_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                background_apps_csv,
                set_background_apps_csv,
                support.background_apps_csv,
                support.background_apps_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                codebook_csv,
                set_codebook_csv,
                support.codebook_csv,
                support.codebook_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                apps_forcing_csv,
                set_apps_forcing_csv,
                support.apps_forcing_csv,
                support.apps_forcing_csv.to_vec()
            );

            set_if_changed!(
                self.late,
                enable_screen_gated_crediting,
                set_enable_screen_gated_crediting,
                options.enable_screen_gated_crediting
            );
            set_if_changed!(
                self.late,
                credited_session_cap_minutes,
                set_credited_session_cap_minutes,
                options.credited_session_cap_minutes
            );
            set_if_changed!(
                self.late,
                device_liveness_gap_tolerance_minutes,
                set_device_liveness_gap_tolerance_minutes,
                options.device_liveness_gap_tolerance_minutes
            );
            set_if_changed!(
                self.late,
                auto_lock_bridge_seconds,
                set_auto_lock_bridge_seconds,
                options.auto_lock_bridge_seconds
            );
            set_if_changed!(
                self.late,
                no_witness_min_day_apps,
                set_no_witness_min_day_apps,
                options.no_witness_min_day_apps
            );
            set_if_changed!(
                self.late,
                enable_study_window_filter,
                set_enable_study_window_filter,
                options.enable_study_window_filter
            );
            set_if_changed!(
                self.late,
                enable_person_attribution,
                set_enable_person_attribution,
                options.enable_person_attribution
            );
            set_if_changed!(
                self.late,
                add_no_activity_placeholder_days,
                set_add_no_activity_placeholder_days,
                options.add_no_activity_placeholder_days
            );
            set_if_changed!(
                self.late,
                enable_day_coverage,
                set_enable_day_coverage,
                options.enable_day_coverage
            );
            set_if_changed!(
                self.late,
                enable_compliance_scoring,
                set_enable_compliance_scoring,
                options.enable_compliance_scoring
            );
            set_if_changed!(
                self.late,
                compliance_threshold_percent,
                set_compliance_threshold_percent,
                options.compliance_threshold_percent
            );
            set_arc_vec_if_changed!(
                self.late_support,
                study_dates_csv,
                set_study_dates_csv,
                support.study_dates_csv,
                support.study_dates_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                device_sharing_csv,
                set_device_sharing_csv,
                support.device_sharing_csv,
                support.device_sharing_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                survey_attribution_csv,
                set_survey_attribution_csv,
                support.survey_attribution_csv,
                support.survey_attribution_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                enrolled_devices_csv,
                set_enrolled_devices_csv,
                support.enrolled_devices_csv,
                support.enrolled_devices_csv.to_vec()
            );

            set_if_changed!(
                self.output,
                study_name,
                set_study_name,
                options.study_name.clone()
            );
            set_if_changed!(
                self.output,
                include_app_output,
                set_include_app_output,
                options.include_app_output
            );
            set_if_changed!(
                self.output,
                include_screen_output,
                set_include_screen_output,
                options.include_screen_output
            );
            set_if_changed!(
                self.output,
                include_category_column,
                set_include_category_column,
                options.include_category_column
            );
            set_if_changed!(
                self.output,
                enable_aggregates,
                set_enable_aggregates,
                options.enable_aggregates
            );
            set_if_changed!(
                self.output,
                aggregate_shape,
                set_aggregate_shape,
                options.aggregate_shape.clone()
            );
            set_if_changed!(
                self.output,
                materialize_visualization_data,
                set_materialize_visualization_data,
                options.materialize_visualization_data
            );
            set_if_changed!(
                self.output,
                materialize_full_outputs,
                set_materialize_full_outputs,
                materialize_full_outputs
            );
        }
    }

    pub(super) struct TrackedExecution {
        pub result: Arc<PipelineV2Result>,
        pub executed_queries: Vec<String>,
        pub internal_executed_queries: Vec<String>,
    }

    #[derive(Default)]
    pub(super) struct TrackedEngine {
        db: EarlyDatabase,
        inputs: Option<TrackedInputs>,
    }

    impl TrackedEngine {
        pub fn execute(
            &mut self,
            csv_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            self.execute_with_review_bases(
                csv_bytes,
                &[],
                &[],
                options,
                support,
                materialize_full_outputs,
            )
        }

        #[cfg(test)]
        pub fn execute_with_review_base(
            &mut self,
            csv_bytes: &[u8],
            review_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            self.execute_with_review_bases(
                csv_bytes,
                review_base_bytes,
                &[],
                options,
                support,
                materialize_full_outputs,
            )
        }

        pub fn execute_with_review_bases(
            &mut self,
            csv_bytes: &[u8],
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            // The live database already binds a verified digest to its raw
            // bytes; a byte compare is an order of magnitude cheaper than
            // re-hashing the full raw input on every warm review.
            let input_sha256 = match self.inputs {
                Some(inputs) if inputs.raw.bytes(&self.db).as_slice() == csv_bytes => {
                    inputs.raw.input_sha256(&self.db)
                }
                _ => sha256_bytes(csv_bytes),
            };
            let (review_base_bytes, reconstruction_base_bytes) = select_persisted_bases(
                &input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
            )?;
            let inputs = match self.inputs {
                Some(inputs) => {
                    inputs.update(
                        &mut self.db,
                        csv_bytes,
                        &input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                        false,
                    );
                    inputs
                }
                None => {
                    let inputs = TrackedInputs::new(
                        &self.db,
                        csv_bytes,
                        input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                    );
                    self.inputs = Some(inputs);
                    inputs
                }
            };
            self.finish_execution(inputs)
        }

        pub fn execute_with_owned_csv_review_bases(
            &mut self,
            csv_bytes: Vec<u8>,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            let input_sha256 = sha256_bytes(&csv_bytes);
            self.execute_with_verified_csv_review_bases(
                csv_bytes,
                input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
                materialize_full_outputs,
            )
        }

        // The verified digest is deliberately adjacent to the bytes and both
        // cache candidates so callers cannot accidentally take an unverified
        // persisted-input path.
        #[allow(clippy::too_many_arguments)]
        pub fn execute_with_verified_csv_review_bases(
            &mut self,
            csv_bytes: Vec<u8>,
            input_sha256: String,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            parse_sha256_digest(&input_sha256, "verified raw input digest")?;
            let (review_base_bytes, reconstruction_base_bytes) = select_persisted_bases(
                &input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
            )?;
            let inputs = match self.inputs {
                Some(inputs) => {
                    // The live Salsa database already owns the current byte
                    // inputs. Compare borrowed request bytes first so an
                    // identical review does not allocate and scan another
                    // complete 14--16 MiB persisted base before discovering
                    // that the tracked input is unchanged.
                    inputs.update(
                        &mut self.db,
                        &csv_bytes,
                        &input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                        false,
                    );
                    inputs
                }
                None => {
                    let inputs = TrackedInputs::new_owned(
                        &self.db,
                        Arc::new(csv_bytes),
                        input_sha256,
                        Arc::new(review_base_bytes.to_vec()),
                        Arc::new(reconstruction_base_bytes.to_vec()),
                        options,
                        support,
                        materialize_full_outputs,
                    );
                    self.inputs = Some(inputs);
                    inputs
                }
            };
            self.finish_execution(inputs)
        }

        pub fn has_verified_input(&self, input_sha256: &str) -> bool {
            self.inputs
                .is_some_and(|inputs| inputs.raw.input_sha256(&self.db) == input_sha256)
        }

        #[allow(clippy::too_many_arguments)]
        pub fn execute_with_warm_verified_input(
            &mut self,
            input_sha256: String,
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            parse_sha256_digest(&input_sha256, "verified raw input digest")?;
            let inputs = self
                .inputs
                .ok_or_else(|| "warm review requires live tracked inputs".to_string())?;
            if inputs.raw.input_sha256(&self.db) != input_sha256 {
                return Err("warm review input identity mismatch".into());
            }
            inputs.update(
                &mut self.db,
                &[],
                &input_sha256,
                &[],
                &[],
                options,
                support,
                materialize_full_outputs,
                true,
            );
            self.finish_execution(inputs)
        }

        fn finish_execution(&mut self, inputs: TrackedInputs) -> Result<TrackedExecution, String> {
            self.db.take_query_bodies();
            self.db.take_internal_query_bodies();
            self.db.take_fused_product_steps();
            self.db.take_will_execute();
            let result = assemble_result_manifest(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
                inputs.late,
                inputs.late_support,
                inputs.output,
            )?
            .value;
            let query_bodies = self.db.take_query_bodies();
            let internal_query_bodies = self.db.take_internal_query_bodies();
            let fused_product_steps = self.db.take_fused_product_steps();
            let will_execute = self.db.take_will_execute();
            if query_bodies.len() + internal_query_bodies.len() != will_execute.len() {
                return Err(format!(
                    "Salsa execution-event mismatch: {} product query bodies plus {} internal derived query bodies but {} WillExecute events: product={query_bodies:?} internal={internal_query_bodies:?} events={will_execute:?}",
                    query_bodies.len(),
                    internal_query_bodies.len(),
                    will_execute.len(),
                ));
            }
            let mut executed_queries = query_bodies
                .into_iter()
                .chain(fused_product_steps)
                .map(str::to_string)
                .collect::<Vec<_>>();
            executed_queries.sort_by_key(|step| {
                crate::workflow_contract::WORKFLOW_QUERIES
                    .iter()
                    .position(|definition| definition.id == step)
                    .unwrap_or(usize::MAX)
            });
            executed_queries.dedup();
            let internal_executed_queries = internal_query_bodies
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>();
            Ok(TrackedExecution {
                result,
                executed_queries,
                internal_executed_queries,
            })
        }

        pub fn export_review_base(&mut self) -> Result<Vec<u8>, String> {
            let inputs = self
                .inputs
                .ok_or_else(|| "review base requires a completed pipeline execution".to_string())?;
            let bytes = build_review_base(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
            )?;
            self.db.take_query_bodies();
            self.db.take_internal_query_bodies();
            self.db.take_fused_product_steps();
            self.db.take_will_execute();
            Ok(bytes)
        }

        pub fn export_reconstruction_base(&mut self) -> Result<Vec<u8>, String> {
            let inputs = self.inputs.ok_or_else(|| {
                "reconstruction base requires a completed pipeline execution".to_string()
            })?;
            let bytes = build_reconstruction_base(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
            )?;
            self.db.take_query_bodies();
            self.db.take_internal_query_bodies();
            self.db.take_fused_product_steps();
            self.db.take_will_execute();
            Ok(bytes)
        }
    }

    fn not_applicable(step: &str) -> WorkflowCheckpoint {
        workflow_state_checkpoint(step, "not_applicable")
    }

    fn insert_checkpoint(
        checkpoints: &mut BTreeMap<String, WorkflowCheckpoint>,
        checkpoint: &WorkflowCheckpoint,
    ) {
        checkpoints.insert(checkpoint.subject_id.clone(), checkpoint.clone());
    }

    #[derive(Clone, PartialEq, Eq)]
    struct EarlyAssembly {
        query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
        parse_events: WorkflowCheckpoint,
        normalize_timezones: WorkflowCheckpoint,
        dedup_and_order: WorkflowCheckpoint,
        app_policy: WorkflowCheckpoint,
        original_row_count: u32,
        processed_row_count: u32,
        rows_before_timezone_handling: u32,
        rows_after_timezone_handling: u32,
        duplicate_timestamps_corrected: u32,
        exact_duplicate_rows_removed: u32,
        available_timezones: Vec<String>,
        timezone: String,
        timezone_action: String,
        timezone_retained_source_rows_digest: String,
        timezone_stage_digest: String,
    }

    /// Collapse the unchanged ingest/timezone/policy prefix behind one Salsa
    /// query. A downstream review edit can then validate one aggregate instead
    /// of walking seventeen separately memoized steps just to collect their
    /// already-known checkpoints.
    #[salsa::tracked(returns(clone))]
    fn collect_early_assembly(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        usage: UsageConfigInput,
        usage_support: UsageSupportInput,
    ) -> Result<Arc<EarlyAssembly>, String> {
        db.record_internal_query_body("collect_early_assembly");
        let mut query_checkpoints = BTreeMap::new();
        let remap = validate_remap_rules(db, early)?;
        insert_checkpoint(&mut query_checkpoints, &remap.checkpoint);
        let parsed = decode_source_records(db, raw)?;
        insert_checkpoint(&mut query_checkpoints, &parsed.checkpoint);
        let nonempty = remove_missing_timestamps(db, raw)?;
        insert_checkpoint(&mut query_checkpoints, &nonempty.checkpoint);
        let model = attach_device_models(db, raw)?;
        insert_checkpoint(&mut query_checkpoints, &model.checkpoint);
        let preprocessing_datetime = bind_processing_timestamp(db, early)?;
        insert_checkpoint(&mut query_checkpoints, &preprocessing_datetime.checkpoint);
        let canonical = canonicalize_source_rows(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &canonical.checkpoint);
        let sorted = order_source_records(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &sorted.checkpoint);
        let timezones = collect_timezone_observations(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &timezones.checkpoint);
        let dominant = estimate_dominant_timezone(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &dominant.checkpoint);
        let selected = resolve_timezone_strategy(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &selected.checkpoint);
        let restamped = standardize_event_clock(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &restamped.checkpoint);
        let row_counts = summarize_row_selection(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &row_counts.checkpoint);
        let deduped = coalesce_duplicate_event_keys(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &deduped.checkpoint);
        let duplicate_groups = summarize_duplicate_groups(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &duplicate_groups.checkpoint);
        let nudged = disambiguate_duplicate_timestamps(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &nudged.checkpoint);
        let gaps = derive_time_gap_evidence(db, raw, early)?;
        insert_checkpoint(&mut query_checkpoints, &gaps.checkpoint);
        let policy = mark_app_policy_matches(db, raw, early, usage, usage_support)?;
        insert_checkpoint(&mut query_checkpoints, &policy.checkpoint);
        let rows_before_timezone_handling = sorted.value.len() as u32;
        let rows_after_timezone_handling = selected.value.rows.len() as u32;
        Ok(Arc::new(EarlyAssembly {
            query_checkpoints,
            parse_events: required_query_group_checkpoint(&sorted, "parse_events")?,
            normalize_timezones: required_query_group_checkpoint(
                &restamped,
                "normalize_timezones",
            )?,
            dedup_and_order: required_query_group_checkpoint(&gaps, "dedup_and_order")?,
            app_policy: required_query_group_checkpoint(&policy, "app_policy")?,
            original_row_count: rows_before_timezone_handling,
            processed_row_count: policy.value.len() as u32,
            rows_before_timezone_handling,
            rows_after_timezone_handling,
            duplicate_timestamps_corrected: if early.correct_duplicate_event_timestamps(db) {
                *duplicate_groups.value
            } else {
                0
            },
            exact_duplicate_rows_removed: restamped.value.len().saturating_sub(deduped.value.len())
                as u32,
            available_timezones: timezones.value.iter().cloned().collect(),
            timezone: selected.value.target_timezone.clone(),
            timezone_action: selected.value.action.clone(),
            timezone_retained_source_rows_digest: timezone_retained_source_rows_digest(
                &selected.value.rows,
            ),
            timezone_stage_digest: timezone_stage_digest(&restamped.value),
        }))
    }

    #[allow(clippy::too_many_arguments)]
    #[salsa::tracked(returns(clone))]
    fn assemble_result_manifest(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        usage: UsageConfigInput,
        usage_support: UsageSupportInput,
        late: LateConfigInput,
        late_support: LateSupportInput,
        output: OutputConfigInput,
    ) -> Result<QueryValue<PipelineV2Result>, String> {
        let _timer = QueryTimer::start("assemble_result_manifest");
        db.record_query_body("assemble_result_manifest");
        let options = output_options(db, early, usage, usage_support, late, output, true);
        let materialize_full_outputs = output.materialize_full_outputs(db);
        let mut query_checkpoints = BTreeMap::new();

        let (restored_reconstruction_base, restored_review_base) = {
            let _timer = QueryTimer::start("assemble_result_manifest_restore_bases");
            let restored_reconstruction_base = if usage.review_only(db) {
                matching_reconstruction_base(db, raw, early, usage, usage_support)?
            } else {
                None
            };
            let restored_review_base =
                if restored_reconstruction_base.is_none() && usage.review_only(db) {
                    matching_review_base(db, raw, early, usage_support)?
                } else {
                    None
                };
            (restored_reconstruction_base, restored_review_base)
        };
        let early_state = {
            let _timer = QueryTimer::start("assemble_result_manifest_early_state");
            let restored_metadata = restored_reconstruction_base
                .as_ref()
                .map(|base| &base.value.early_metadata)
                .or_else(|| {
                    restored_review_base
                        .as_ref()
                        .map(|base| &base.value.metadata)
                });
            if let Some(metadata) = restored_metadata {
                query_checkpoints.extend(metadata.query_checkpoints.clone());
                Arc::new(EarlyAssembly {
                    query_checkpoints: metadata.query_checkpoints.clone(),
                    parse_events: metadata
                        .query_group_checkpoints
                        .get("parse_events")
                        .cloned()
                        .ok_or_else(|| "review base is missing parse_events".to_string())?,
                    normalize_timezones: metadata
                        .query_group_checkpoints
                        .get("normalize_timezones")
                        .cloned()
                        .ok_or_else(|| "review base is missing normalize_timezones".to_string())?,
                    dedup_and_order: metadata
                        .query_group_checkpoints
                        .get("dedup_and_order")
                        .cloned()
                        .ok_or_else(|| "review base is missing dedup_and_order".to_string())?,
                    app_policy: metadata
                        .query_group_checkpoints
                        .get("app_policy")
                        .cloned()
                        .ok_or_else(|| "review base is missing app_policy".to_string())?,
                    original_row_count: metadata.original_row_count,
                    processed_row_count: metadata.processed_row_count,
                    rows_before_timezone_handling: metadata.rows_before_timezone_handling,
                    rows_after_timezone_handling: metadata.rows_after_timezone_handling,
                    duplicate_timestamps_corrected: metadata.duplicate_timestamps_corrected,
                    exact_duplicate_rows_removed: metadata.exact_duplicate_rows_removed,
                    available_timezones: metadata.available_timezones.clone(),
                    timezone: metadata.timezone.clone(),
                    timezone_action: metadata.timezone_action.clone(),
                    timezone_retained_source_rows_digest: metadata
                        .timezone_retained_source_rows_digest
                        .clone(),
                    timezone_stage_digest: metadata.timezone_stage_digest.clone(),
                })
            } else {
                let collected = collect_early_assembly(db, raw, early, usage, usage_support)?;
                query_checkpoints.extend(collected.query_checkpoints.clone());
                collected
            }
        };
        let screen_mode = matches!(
            options.usage_session_mode,
            UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
        );
        let screen_rows = {
            let _timer = QueryTimer::start("assemble_result_manifest_screen_rows");
            if screen_mode {
                let cached_screen_candidate = restored_reconstruction_base
                    .as_ref()
                    .and_then(|base| base.value.screen.as_ref())
                    .or_else(|| {
                        restored_review_base
                            .as_ref()
                            .and_then(|base| base.value.screen.as_ref())
                    });
                let cached_screen = if let Some(screen) = cached_screen_candidate {
                    let expected_screen_key =
                        screen_base_input_key(db, raw, early, usage, usage_support)?;
                    (screen.input_key == expected_screen_key).then_some(screen)
                } else {
                    None
                };
                if let Some(screen) = cached_screen {
                    insert_checkpoint(&mut query_checkpoints, &screen.index_keyguard_events);
                    insert_checkpoint(
                        &mut query_checkpoints,
                        &screen.infer_screen_session_skeletons,
                    );
                    insert_checkpoint(&mut query_checkpoints, &screen.classify_screen_sessions);
                    Arc::clone(&screen.rows)
                } else {
                    let keyguard = index_keyguard_events(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &keyguard.checkpoint);
                    let walked =
                        infer_screen_session_skeletons(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &walked.checkpoint);
                    let built = classify_screen_sessions(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &built.checkpoint);
                    Arc::clone(&built.value)
                }
            } else {
                for step in [
                    "index_keyguard_events",
                    "infer_screen_session_skeletons",
                    "classify_screen_sessions",
                ] {
                    query_checkpoints.insert(step.into(), not_applicable(step));
                }
                Arc::new(Vec::new())
            }
        };

        let app_mode = matches!(
            options.usage_session_mode,
            UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
        );
        let mut reconstruct_checkpoint =
            workflow_state_checkpoint("reconstruct_episodes", "not_applicable");
        let mut categorize_checkpoint =
            workflow_state_checkpoint("categorize_apps", "not_applicable");
        let mut annotation_checkpoint =
            workflow_state_checkpoint("episode_annotations", "not_applicable");
        let mut cleaning_checkpoint =
            workflow_state_checkpoint("interval_cleaning", "not_applicable");
        let mut app_rows = Arc::new(Vec::new());
        let mut compliance_bytes = Vec::new();
        let mut credited_count = 0;
        let mut day_coverage_count = 0;
        let mut compliance_count = 0;

        let (
            effective_checkpoint,
            observation_checkpoint,
            attribution_checkpoint,
            day_coverage_checkpoint,
            compliance_checkpoint,
        ) = {
            let _timer = QueryTimer::start("assemble_result_manifest_app_steps");
            if app_mode {
                let zero_filtered = if usage.review_only(db) {
                    let reconstruction =
                        review_reconstruction_fused(db, raw, early, usage, usage_support)?;
                    for checkpoint in [
                        &reconstruction.resolve_excluded_packages,
                        &reconstruction.mask_excluded_app_events,
                        &reconstruction.build_app_event_index,
                        &reconstruction.match_app_episodes,
                        &reconstruction.materialize_candidate_episodes,
                        &reconstruction.classify_episode_durations,
                        &reconstruction.apply_app_inclusion_policy,
                        &reconstruction.order_app_episodes,
                        &reconstruction.segment_concurrent_usage,
                    ] {
                        insert_checkpoint(&mut query_checkpoints, checkpoint);
                    }
                    reconstruct_checkpoint = reconstruction.reconstruct_episodes.clone();

                    let fused = review_annotations_fused(db, raw, early, usage, usage_support)?;
                    for checkpoint in [
                        &fused.join_app_codebook,
                        &fused.derive_broad_category,
                        &fused.collapse_app_genre,
                        &fused.derive_engagement_basis,
                        &fused.apply_episode_flags,
                        &fused.suppress_excluded_timing,
                        &fused.remove_selected_interaction_types,
                        &fused.remove_zero_duration_rows,
                    ] {
                        insert_checkpoint(&mut query_checkpoints, checkpoint);
                    }
                    categorize_checkpoint = fused.categorize_apps.clone();
                    annotation_checkpoint = fused.episode_annotations.clone();
                    QueryValue {
                        value: Arc::clone(&fused.rows),
                        checkpoint: fused.remove_zero_duration_rows.clone(),
                        query_group_checkpoint: Some(fused.interval_cleaning.clone()),
                    }
                } else {
                    let junk = resolve_excluded_packages(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &junk.checkpoint);
                    let blind = mask_excluded_app_events(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &blind.checkpoint);
                    let matcher_input =
                        build_app_event_index(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &matcher_input.checkpoint);
                    let matcher = match_app_episodes(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &matcher.checkpoint);
                    let applied =
                        materialize_candidate_episodes(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &applied.checkpoint);
                    let relabeled =
                        classify_episode_durations(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &relabeled.checkpoint);
                    let downstream =
                        apply_app_inclusion_policy(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &downstream.checkpoint);
                    let sorted_episodes = order_app_episodes(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &sorted_episodes.checkpoint);
                    let split = segment_concurrent_usage(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &split.checkpoint);
                    reconstruct_checkpoint =
                        required_query_group_checkpoint(&split, "reconstruct_episodes")?;
                    let joined = join_app_codebook(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &joined.checkpoint);
                    let broad = derive_broad_category(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &broad.checkpoint);
                    let collapsed = collapse_app_genre(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &collapsed.checkpoint);
                    categorize_checkpoint =
                        required_query_group_checkpoint(&collapsed, "categorize_apps")?;
                    let zero_filtered =
                        remove_zero_duration_rows(db, raw, early, usage, usage_support)?;
                    let engagement = derive_engagement_basis(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &engagement.checkpoint);
                    let flagged = apply_episode_flags(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &flagged.checkpoint);
                    annotation_checkpoint =
                        required_query_group_checkpoint(&flagged, "episode_annotations")?;
                    let blanked = suppress_excluded_timing(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &blanked.checkpoint);
                    let selected_types =
                        remove_selected_interaction_types(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &selected_types.checkpoint);
                    insert_checkpoint(&mut query_checkpoints, &zero_filtered.checkpoint);
                    zero_filtered
                };
                cleaning_checkpoint =
                    required_query_group_checkpoint(&zero_filtered, "interval_cleaning")?;

                let effective = if materialize_full_outputs && options.enable_screen_gated_crediting
                {
                    let partition =
                        identify_credit_eligible_sessions(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &partition.checkpoint);
                    let substrate =
                        build_activity_witness_indexes(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &substrate.checkpoint);
                    let incapable =
                        assess_screen_evidence_capability(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &incapable.checkpoint);
                    let day_apps = summarize_daily_apps(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &day_apps.checkpoint);
                    let credited =
                        derive_credited_intervals(db, raw, early, usage, usage_support, late)?;
                    insert_checkpoint(&mut query_checkpoints, &credited.checkpoint);
                    let emitted =
                        materialize_credited_rows(db, raw, early, usage, usage_support, late)?;
                    insert_checkpoint(&mut query_checkpoints, &emitted.checkpoint);
                    let assembled =
                        assemble_credit_outputs(db, raw, early, usage, usage_support, late)?;
                    insert_checkpoint(&mut query_checkpoints, &assembled.checkpoint);
                    credited_count = assembled.value.rows.len() as u32;
                    workflow_checkpoint(
                        "effective_usage",
                        &[],
                        &[(
                            "assemble_credit_outputs",
                            assembled.checkpoint.terminal_digest.as_bytes(),
                        )],
                    )
                } else {
                    for step in [
                        "identify_credit_eligible_sessions",
                        "build_activity_witness_indexes",
                        "assess_screen_evidence_capability",
                        "summarize_daily_apps",
                        "derive_credited_intervals",
                        "materialize_credited_rows",
                        "assemble_credit_outputs",
                    ] {
                        query_checkpoints.insert(
                            step.into(),
                            workflow_state_checkpoint(
                                step,
                                if materialize_full_outputs {
                                    "not_applicable"
                                } else {
                                    "not_requested"
                                },
                            ),
                        );
                    }
                    workflow_state_checkpoint(
                        "effective_usage",
                        if materialize_full_outputs {
                            "not_applicable"
                        } else {
                            "not_requested"
                        },
                    )
                };

                let windows = resolve_participant_windows(
                    db,
                    raw,
                    early,
                    usage,
                    usage_support,
                    late_support,
                )?;
                insert_checkpoint(&mut query_checkpoints, &windows.checkpoint);
                let windowed = apply_participant_windows(
                    db,
                    raw,
                    early,
                    usage,
                    usage_support,
                    late,
                    late_support,
                )?;
                insert_checkpoint(&mut query_checkpoints, &windowed.checkpoint);
                let observation = required_query_group_checkpoint(&windowed, "observation_window")?;

                let sharing = resolve_sharing_status(
                    db,
                    raw,
                    early,
                    usage,
                    usage_support,
                    late,
                    late_support,
                )?;
                insert_checkpoint(&mut query_checkpoints, &sharing.checkpoint);
                let survey = index_survey_responses(db, late, late_support)?;
                insert_checkpoint(&mut query_checkpoints, &survey.checkpoint);
                let attributed = classify_person_attribution(
                    db,
                    raw,
                    early,
                    usage,
                    usage_support,
                    late,
                    late_support,
                )?;
                insert_checkpoint(&mut query_checkpoints, &attributed.checkpoint);
                let attribution = required_query_group_checkpoint(&attributed, "attribute_person")?;

                let placeholders = synthesize_placeholder_rows(
                    db,
                    raw,
                    early,
                    usage,
                    usage_support,
                    late,
                    late_support,
                )?;
                insert_checkpoint(&mut query_checkpoints, &placeholders.checkpoint);
                app_rows = Arc::clone(&placeholders.value);
                if materialize_full_outputs {
                    let raw_dates = index_raw_dates(db, raw, early, usage, usage_support)?;
                    insert_checkpoint(&mut query_checkpoints, &raw_dates.checkpoint);
                } else {
                    query_checkpoints.insert(
                        "index_raw_dates".into(),
                        workflow_state_checkpoint("index_raw_dates", "not_requested"),
                    );
                }
                let day_coverage = if materialize_full_outputs && options.enable_day_coverage {
                    let coverage = build_participant_day_coverage(
                        db,
                        raw,
                        early,
                        usage,
                        usage_support,
                        late,
                        late_support,
                    )?;
                    insert_checkpoint(&mut query_checkpoints, &coverage.checkpoint);
                    day_coverage_count = coverage.value.report.coverage.len() as u32;
                    required_query_group_checkpoint(&coverage, "day_coverage")?
                } else {
                    query_checkpoints.insert(
                        "build_participant_day_coverage".into(),
                        workflow_state_checkpoint(
                            "build_participant_day_coverage",
                            if materialize_full_outputs {
                                "not_applicable"
                            } else {
                                "not_requested"
                            },
                        ),
                    );
                    if materialize_full_outputs {
                        workflow_checkpoint(
                            "day_coverage",
                            &[("rows", &app_rows)],
                            &[("day_coverage_csv", &[])],
                        )
                    } else {
                        workflow_state_checkpoint("day_coverage", "not_requested")
                    }
                };

                if materialize_full_outputs && options.enable_compliance_scoring {
                    let minutes = aggregate_attribution_minutes(
                        db,
                        raw,
                        early,
                        usage,
                        usage_support,
                        late,
                        late_support,
                    )?;
                    insert_checkpoint(&mut query_checkpoints, &minutes.checkpoint);
                    let completeness = compute_attribution_completeness(
                        db,
                        raw,
                        early,
                        usage,
                        usage_support,
                        late,
                        late_support,
                    )?;
                    insert_checkpoint(&mut query_checkpoints, &completeness.checkpoint);
                    let scored = classify_compliance_days(
                        db,
                        raw,
                        early,
                        usage,
                        usage_support,
                        late,
                        late_support,
                    )?;
                    insert_checkpoint(&mut query_checkpoints, &scored.checkpoint);
                    compliance_count = scored.value.days.len() as u32;
                    let enrolled_devices = parsed_enrolled_devices(db, late_support)?;
                    compliance_bytes = super::compliance_csv(&scored.value, &enrolled_devices);
                } else {
                    for step in [
                        "aggregate_attribution_minutes",
                        "compute_attribution_completeness",
                        "classify_compliance_days",
                    ] {
                        query_checkpoints.insert(
                            step.into(),
                            workflow_state_checkpoint(
                                step,
                                if materialize_full_outputs {
                                    "not_applicable"
                                } else {
                                    "not_requested"
                                },
                            ),
                        );
                    }
                }
                let compliance = if materialize_full_outputs {
                    workflow_checkpoint(
                        "score_compliance",
                        &[],
                        &[("compliance_csv", &compliance_bytes)],
                    )
                } else {
                    workflow_state_checkpoint("score_compliance", "not_requested")
                };
                (
                    effective,
                    observation,
                    attribution,
                    day_coverage,
                    compliance,
                )
            } else {
                for definition in
                    crate::workflow_contract::WORKFLOW_QUERIES
                        .iter()
                        .filter(|definition| {
                            matches!(
                                definition.group,
                                "reconstruct_episodes"
                                    | "categorize_apps"
                                    | "episode_annotations"
                                    | "interval_cleaning"
                                    | "effective_usage"
                                    | "observation_window"
                                    | "attribute_person"
                                    | "day_coverage"
                                    | "score_compliance"
                            )
                        })
                {
                    query_checkpoints.insert(definition.id.into(), not_applicable(definition.id));
                }
                (
                    workflow_state_checkpoint("effective_usage", "not_applicable"),
                    workflow_state_checkpoint("observation_window", "not_applicable"),
                    workflow_state_checkpoint("attribute_person", "not_applicable"),
                    workflow_state_checkpoint("day_coverage", "not_applicable"),
                    workflow_state_checkpoint("score_compliance", "not_applicable"),
                )
            }
        };

        let assembled = {
            let _timer = QueryTimer::start("assemble_result_manifest_outputs");
            assemble_outputs(
                db,
                raw,
                early,
                usage,
                usage_support,
                late,
                late_support,
                output,
            )?
        };
        insert_checkpoint(&mut query_checkpoints, &assembled.checkpoint);
        if query_checkpoints.len() != crate::workflow_contract::WORKFLOW_QUERIES.len() {
            return Err(format!(
                "tracked query checkpoint coverage mismatch: expected registry coverage, got {}",
                query_checkpoints.len()
            ));
        }

        let _finalize_timer = QueryTimer::start("assemble_result_manifest_finalize");
        let outputs_checkpoint = required_query_group_checkpoint(&assembled, "outputs")?;
        let query_group_checkpoints = [
            early_state.parse_events.clone(),
            early_state.normalize_timezones.clone(),
            early_state.dedup_and_order.clone(),
            early_state.app_policy.clone(),
            if screen_mode {
                let built = classify_screen_sessions(db, raw, early, usage, usage_support)?;
                required_query_group_checkpoint(&built, "device_state_timeline")?
            } else {
                workflow_rows_checkpoint("device_state_timeline", &[])
            },
            reconstruct_checkpoint,
            categorize_checkpoint,
            annotation_checkpoint,
            cleaning_checkpoint,
            effective_checkpoint,
            observation_checkpoint,
            attribution_checkpoint,
            day_coverage_checkpoint,
            compliance_checkpoint,
            outputs_checkpoint,
        ]
        .into_iter()
        .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint))
        .collect::<BTreeMap<_, _>>();
        let query_group_digests = query_group_checkpoints
            .iter()
            .map(|(node, checkpoint)| (node.clone(), checkpoint.terminal_digest.clone()))
            .collect();
        let step_digests = query_checkpoints
            .iter()
            .map(|(step, checkpoint)| (step.clone(), checkpoint.terminal_digest.clone()))
            .collect();
        let rows_before_timezone_handling = early_state.rows_before_timezone_handling;
        let rows_after_timezone_handling = early_state.rows_after_timezone_handling;
        let result = PipelineV2Result {
            app_csv_bytes: assembled.value.app_csv_bytes.clone(),
            screen_csv_bytes: assembled.value.screen_csv_bytes.clone(),
            day_coverage_csv_bytes: assembled.value.day_coverage_csv_bytes.clone(),
            compliance_csv_bytes: assembled.value.compliance_csv_bytes.clone(),
            credited_app_csv_bytes: assembled.value.credited_app_csv_bytes.clone(),
            review_summary_json_bytes: assembled.value.review_summary_json_bytes.clone(),
            visualization_data_json_bytes: assembled.value.visualization_data_json_bytes.clone(),
            aggregate_csv_outputs: assembled.value.aggregate_csv_outputs.clone(),
            row_lineage: assembled.value.row_lineage.clone(),
            original_row_count: early_state.original_row_count,
            processed_row_count: early_state.processed_row_count,
            app_row_count: app_rows.len() as u32,
            screen_row_count: screen_rows.len() as u32,
            day_coverage_row_count: day_coverage_count,
            compliance_row_count: compliance_count,
            credited_app_row_count: credited_count,
            duplicate_timestamps_corrected: early_state.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: early_state.exact_duplicate_rows_removed,
            available_timezones: early_state.available_timezones.clone(),
            timezone: early_state.timezone.clone(),
            timezone_action: early_state.timezone_action.clone(),
            rows_before_timezone_handling,
            rows_after_timezone_handling,
            rows_removed_by_timezone: rows_before_timezone_handling
                .saturating_sub(rows_after_timezone_handling),
            timezone_retained_source_rows_digest: early_state
                .timezone_retained_source_rows_digest
                .clone(),
            timezone_stage_digest: early_state.timezone_stage_digest.clone(),
            workflow_query_group_digests: query_group_digests,
            workflow_query_group_checkpoints: query_group_checkpoints,
            workflow_query_digests: step_digests,
            workflow_query_checkpoints: query_checkpoints,
        };
        Ok(QueryValue {
            value: Arc::new(result),
            checkpoint: assembled.checkpoint,
            query_group_checkpoint: None,
        })
    }

    #[salsa::db]
    #[derive(Clone)]
    struct EarlyDatabase {
        storage: salsa::Storage<Self>,
        query_bodies: Arc<Mutex<Vec<&'static str>>>,
        internal_query_bodies: Arc<Mutex<Vec<&'static str>>>,
        fused_product_steps: Arc<Mutex<Vec<&'static str>>>,
        will_execute: Arc<Mutex<Vec<String>>>,
    }

    impl Default for EarlyDatabase {
        fn default() -> Self {
            let will_execute = Arc::<Mutex<Vec<String>>>::default();
            Self {
                storage: salsa::Storage::builder()
                    .event_callback(Box::new({
                        let will_execute = Arc::clone(&will_execute);
                        move |event| {
                            if let salsa::EventKind::WillExecute { database_key } = event.kind {
                                will_execute
                                    .lock()
                                    .expect("Salsa execution event log")
                                    .push(format!("{database_key:?}"));
                            }
                        }
                    }))
                    .ingredient::<EarlyRawInput>()
                    .ingredient::<EarlyConfigInput>()
                    .ingredient::<UsageConfigInput>()
                    .ingredient::<UsageSupportInput>()
                    .ingredient::<LateConfigInput>()
                    .ingredient::<LateSupportInput>()
                    .ingredient::<OutputConfigInput>()
                    .ingredient::<decoded_review_base>()
                    .ingredient::<decoded_reconstruction_base>()
                    .ingredient::<matching_review_base>()
                    .ingredient::<matching_reconstruction_base>()
                    .ingredient::<screen_base_input_key>()
                    .ingredient::<validate_remap_rules>()
                    .ingredient::<decode_source_records>()
                    .ingredient::<remove_missing_timestamps>()
                    .ingredient::<attach_device_models>()
                    .ingredient::<bind_processing_timestamp>()
                    .ingredient::<canonicalize_source_rows>()
                    .ingredient::<order_source_records>()
                    .ingredient::<collect_timezone_observations>()
                    .ingredient::<estimate_dominant_timezone>()
                    .ingredient::<resolve_timezone_strategy>()
                    .ingredient::<standardize_event_clock>()
                    .ingredient::<summarize_row_selection>()
                    .ingredient::<coalesce_duplicate_event_keys>()
                    .ingredient::<summarize_duplicate_groups>()
                    .ingredient::<disambiguate_duplicate_timestamps>()
                    .ingredient::<derive_time_gap_evidence>()
                    .ingredient::<background_apps>()
                    .ingredient::<parsed_filter_rules>()
                    .ingredient::<parsed_apps_forcing_screen_open>()
                    .ingredient::<parsed_codebook>()
                    .ingredient::<parsed_study_windows>()
                    .ingredient::<parsed_device_sharing>()
                    .ingredient::<parsed_survey_attribution>()
                    .ingredient::<parsed_enrolled_devices>()
                    .ingredient::<mark_app_policy_matches>()
                    .ingredient::<index_keyguard_events>()
                    .ingredient::<infer_screen_session_skeletons>()
                    .ingredient::<classify_screen_sessions>()
                    .ingredient::<resolve_excluded_packages>()
                    .ingredient::<mask_excluded_app_events>()
                    .ingredient::<blind_lineage_suffix_digests>()
                    .ingredient::<build_app_event_index>()
                    .ingredient::<match_app_episodes>()
                    .ingredient::<review_applied_rows>()
                    .ingredient::<review_usage_rows_before_floor>()
                    .ingredient::<review_static_annotations>()
                    .ingredient::<review_reconstructed_rows>()
                    .ingredient::<review_reconstruction_fused>()
                    .ingredient::<review_reconstruction_output>()
                    .ingredient::<materialize_candidate_episodes>()
                    .ingredient::<classify_episode_durations>()
                    .ingredient::<apply_app_inclusion_policy>()
                    .ingredient::<order_app_episodes>()
                    .ingredient::<segment_concurrent_usage>()
                    .ingredient::<join_app_codebook>()
                    .ingredient::<derive_broad_category>()
                    .ingredient::<collapse_app_genre>()
                    .ingredient::<review_annotations_fused>()
                    .ingredient::<derive_engagement_basis>()
                    .ingredient::<apply_episode_flags>()
                    .ingredient::<suppress_excluded_timing>()
                    .ingredient::<remove_selected_interaction_types>()
                    .ingredient::<remove_zero_duration_rows>()
                    .ingredient::<identify_credit_eligible_sessions>()
                    .ingredient::<build_activity_witness_indexes>()
                    .ingredient::<assess_screen_evidence_capability>()
                    .ingredient::<summarize_daily_apps>()
                    .ingredient::<derive_credited_intervals>()
                    .ingredient::<materialize_credited_rows>()
                    .ingredient::<assemble_credit_outputs>()
                    .ingredient::<resolve_participant_windows>()
                    .ingredient::<apply_participant_windows>()
                    .ingredient::<resolve_sharing_status>()
                    .ingredient::<index_survey_responses>()
                    .ingredient::<classify_person_attribution>()
                    .ingredient::<synthesize_placeholder_rows>()
                    .ingredient::<index_raw_dates>()
                    .ingredient::<build_participant_day_coverage>()
                    .ingredient::<aggregate_attribution_minutes>()
                    .ingredient::<compute_attribution_completeness>()
                    .ingredient::<classify_compliance_days>()
                    .ingredient::<codebook_is_empty>()
                    .ingredient::<assemble_primary_outputs>()
                    .ingredient::<collect_early_assembly>()
                    .ingredient::<assemble_result_manifest>()
                    .build(),
                query_bodies: Arc::default(),
                internal_query_bodies: Arc::default(),
                fused_product_steps: Arc::default(),
                will_execute,
            }
        }
    }

    #[salsa::db]
    impl salsa::Database for EarlyDatabase {}

    #[salsa::db]
    impl EarlyStepDb for EarlyDatabase {
        fn record_query_body(&self, step: &'static str) {
            self.query_bodies.lock().expect("query body log").push(step);
        }

        fn record_internal_query_body(&self, query: &'static str) {
            self.internal_query_bodies
                .lock()
                .expect("internal query body log")
                .push(query);
        }

        fn record_fused_product_step(&self, step: &'static str) {
            self.fused_product_steps
                .lock()
                .expect("fused product step log")
                .push(step);
        }
    }

    impl EarlyDatabase {
        fn take_query_bodies(&self) -> Vec<&'static str> {
            std::mem::take(&mut *self.query_bodies.lock().expect("query body log"))
        }

        fn take_internal_query_bodies(&self) -> Vec<&'static str> {
            std::mem::take(
                &mut *self
                    .internal_query_bodies
                    .lock()
                    .expect("internal query body log"),
            )
        }

        fn take_fused_product_steps(&self) -> Vec<&'static str> {
            std::mem::take(
                &mut *self
                    .fused_product_steps
                    .lock()
                    .expect("fused product step log"),
            )
        }

        fn take_will_execute(&self) -> Vec<String> {
            std::mem::take(&mut *self.will_execute.lock().expect("Salsa execution event log"))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use salsa::Setter;

        fn csv() -> Arc<Vec<u8>> {
            Arc::new(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,,Screen Interactive,,2026-03-07 09:59:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,Device Shutdown,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,User Interaction,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,,Screen Non-Interactive,,2026-03-07 10:01:00,America/Chicago\n"
                )
                .as_bytes()
                .to_vec(),
            )
        }

        fn inputs(db: &EarlyDatabase) -> (EarlyRawInput, EarlyConfigInput) {
            let csv_bytes = csv();
            let input_sha256 = sha256_bytes(csv_bytes.as_slice());
            (
                EarlyRawInput::new(
                    db,
                    csv_bytes,
                    input_sha256,
                    Arc::new(Vec::new()),
                    Arc::new(Vec::new()),
                ),
                EarlyConfigInput::new(
                    db,
                    Arc::new(Vec::new()),
                    "America/Chicago".into(),
                    "selected-convert".into(),
                    "2026-07-23 00:00:00 UTC".into(),
                    true,
                    true,
                    Arc::new(vec!["Activity Paused".into(), "Activity Resumed".into()]),
                    Arc::new(vec!["Activity Resumed".into(), "Device Shutdown".into()]),
                ),
            )
        }

        fn usage_inputs(db: &EarlyDatabase) -> (UsageConfigInput, UsageSupportInput) {
            (
                UsageConfigInput::new(
                    db,
                    UsageSessionMode::AppAndScreenUsage,
                    false,
                    false,
                    true,
                    true,
                    43_200_000_000_000,
                    0,
                    0.0,
                    false,
                    300.0,
                    Arc::new(vec![1.0]),
                    Arc::new(vec![1.0]),
                    Arc::new(Vec::new()),
                    false,
                    false,
                ),
                UsageSupportInput::new(
                    db,
                    false,
                    false,
                    false,
                    false,
                    120.0,
                    30.0,
                    30.0,
                    2.0,
                    Arc::default(),
                    Arc::default(),
                    Arc::default(),
                    Arc::default(),
                ),
            )
        }

        fn late_inputs(db: &EarlyDatabase) -> (LateConfigInput, LateSupportInput) {
            (
                LateConfigInput::new(
                    db, true, 360.0, 120.0, 120.0, 2, true, true, true, true, true, 70.0,
                ),
                LateSupportInput::new(
                    db,
                    Arc::new(
                        b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n".to_vec(),
                    ),
                    Arc::new(b"participant_id,sharing_status\nP01,Non-Shared\n".to_vec()),
                    Arc::default(),
                    Arc::new(b"participant_id,device_count\nP01,1\n".to_vec()),
                ),
            )
        }

        fn output_input(db: &EarlyDatabase) -> OutputConfigInput {
            OutputConfigInput::new(
                db,
                "Tracked early steps".into(),
                false,
                false,
                false,
                false,
                "wide".into(),
                true,
                true,
            )
        }

        fn run_all(
            db: &EarlyDatabase,
            raw: EarlyRawInput,
            config: EarlyConfigInput,
        ) -> Result<BTreeMap<String, String>, String> {
            let values = [
                validate_remap_rules(db, config)?.checkpoint,
                decode_source_records(db, raw)?.checkpoint,
                remove_missing_timestamps(db, raw)?.checkpoint,
                attach_device_models(db, raw)?.checkpoint,
                bind_processing_timestamp(db, config)?.checkpoint,
                canonicalize_source_rows(db, raw, config)?.checkpoint,
                order_source_records(db, raw, config)?.checkpoint,
                collect_timezone_observations(db, raw, config)?.checkpoint,
                estimate_dominant_timezone(db, raw, config)?.checkpoint,
                resolve_timezone_strategy(db, raw, config)?.checkpoint,
                standardize_event_clock(db, raw, config)?.checkpoint,
                summarize_row_selection(db, raw, config)?.checkpoint,
                coalesce_duplicate_event_keys(db, raw, config)?.checkpoint,
                summarize_duplicate_groups(db, raw, config)?.checkpoint,
                disambiguate_duplicate_timestamps(db, raw, config)?.checkpoint,
                derive_time_gap_evidence(db, raw, config)?.checkpoint,
            ];
            Ok(values
                .into_iter()
                .map(|checkpoint| (checkpoint.subject_id, checkpoint.terminal_digest))
                .collect())
        }

        fn run_reconstruction(
            db: &EarlyDatabase,
            raw: EarlyRawInput,
            early: EarlyConfigInput,
            config: UsageConfigInput,
            support: UsageSupportInput,
        ) -> Result<BTreeMap<String, String>, String> {
            let values = [
                mark_app_policy_matches(db, raw, early, config, support)?.checkpoint,
                resolve_excluded_packages(db, raw, early, config, support)?.checkpoint,
                mask_excluded_app_events(db, raw, early, config, support)?.checkpoint,
                build_app_event_index(db, raw, early, config, support)?.checkpoint,
                match_app_episodes(db, raw, early, config, support)?.checkpoint,
                materialize_candidate_episodes(db, raw, early, config, support)?.checkpoint,
                classify_episode_durations(db, raw, early, config, support)?.checkpoint,
                apply_app_inclusion_policy(db, raw, early, config, support)?.checkpoint,
                order_app_episodes(db, raw, early, config, support)?.checkpoint,
                segment_concurrent_usage(db, raw, early, config, support)?.checkpoint,
                join_app_codebook(db, raw, early, config, support)?.checkpoint,
                derive_broad_category(db, raw, early, config, support)?.checkpoint,
                collapse_app_genre(db, raw, early, config, support)?.checkpoint,
                derive_engagement_basis(db, raw, early, config, support)?.checkpoint,
                apply_episode_flags(db, raw, early, config, support)?.checkpoint,
                suppress_excluded_timing(db, raw, early, config, support)?.checkpoint,
                remove_selected_interaction_types(db, raw, early, config, support)?.checkpoint,
                remove_zero_duration_rows(db, raw, early, config, support)?.checkpoint,
            ];
            Ok(values
                .into_iter()
                .map(|checkpoint| (checkpoint.subject_id, checkpoint.terminal_digest))
                .collect())
        }

        fn run_screen(
            db: &EarlyDatabase,
            raw: EarlyRawInput,
            early: EarlyConfigInput,
            config: UsageConfigInput,
            support: UsageSupportInput,
        ) -> Result<BTreeMap<String, String>, String> {
            let values = [
                index_keyguard_events(db, raw, early, config, support)?.checkpoint,
                infer_screen_session_skeletons(db, raw, early, config, support)?.checkpoint,
                classify_screen_sessions(db, raw, early, config, support)?.checkpoint,
            ];
            Ok(values
                .into_iter()
                .map(|checkpoint| (checkpoint.subject_id, checkpoint.terminal_digest))
                .collect())
        }

        fn assert_registered_query_ids<'a>(
            scope: &str,
            actual_ids: impl IntoIterator<Item = &'a String>,
            expected_ids: &[&str],
        ) {
            let actual = actual_ids.into_iter().cloned().collect::<BTreeSet<_>>();
            let expected = expected_ids
                .iter()
                .map(|query_id| (*query_id).to_string())
                .collect::<BTreeSet<_>>();
            let registered = crate::workflow_contract::WORKFLOW_QUERIES
                .iter()
                .map(|query| query.id.to_string())
                .collect::<BTreeSet<_>>();
            assert!(
                expected.is_subset(&registered),
                "{scope} expectation names unregistered queries: {:?}",
                expected.difference(&registered).collect::<Vec<_>>()
            );
            assert_eq!(actual, expected, "{scope} query set drifted");
        }

        #[allow(clippy::too_many_arguments)]
        fn run_late(
            db: &EarlyDatabase,
            raw: EarlyRawInput,
            early: EarlyConfigInput,
            config: UsageConfigInput,
            support: UsageSupportInput,
            late: LateConfigInput,
            late_support: LateSupportInput,
        ) -> Result<BTreeMap<String, String>, String> {
            let values = [
                identify_credit_eligible_sessions(db, raw, early, config, support)?.checkpoint,
                build_activity_witness_indexes(db, raw, early, config, support)?.checkpoint,
                assess_screen_evidence_capability(db, raw, early, config, support)?.checkpoint,
                summarize_daily_apps(db, raw, early, config, support)?.checkpoint,
                derive_credited_intervals(db, raw, early, config, support, late)?.checkpoint,
                materialize_credited_rows(db, raw, early, config, support, late)?.checkpoint,
                assemble_credit_outputs(db, raw, early, config, support, late)?.checkpoint,
                resolve_participant_windows(db, raw, early, config, support, late_support)?
                    .checkpoint,
                apply_participant_windows(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
                resolve_sharing_status(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
                index_survey_responses(db, late, late_support)?.checkpoint,
                classify_person_attribution(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
                synthesize_placeholder_rows(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
                index_raw_dates(db, raw, early, config, support)?.checkpoint,
                build_participant_day_coverage(
                    db,
                    raw,
                    early,
                    config,
                    support,
                    late,
                    late_support,
                )?
                .checkpoint,
                aggregate_attribution_minutes(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
                compute_attribution_completeness(
                    db,
                    raw,
                    early,
                    config,
                    support,
                    late,
                    late_support,
                )?
                .checkpoint,
                classify_compliance_days(db, raw, early, config, support, late, late_support)?
                    .checkpoint,
            ];
            Ok(values
                .into_iter()
                .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint.terminal_digest))
                .collect())
        }

        fn pipeline_options() -> PipelineV2Options {
            PipelineV2Options {
                study_name: "Tracked early steps".into(),
                timezone: "America/Chicago".into(),
                timezone_handling: "selected-convert".into(),
                usage_session_mode: UsageSessionMode::AppAndScreenUsage,
                include_app_output: false,
                include_screen_output: false,
                use_filter_file: false,
                use_apps_forcing_screen_open: false,
                use_background_apps_file: false,
                use_app_codebook: false,
                include_category_column: false,
                deduplicate_exact_rows: true,
                interaction_type_remap: Vec::new(),
                correct_duplicate_event_timestamps: true,
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 43_200_000_000_000,
                proximity_interval_ns: 0,
                custom_app_engagement_duration: 300.0,
                long_data_time_gap_thresholds: vec![1.0],
                long_usage_duration_thresholds: vec![1.0],
                same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
                other_stop_types: vec!["Activity Resumed".into(), "Device Shutdown".into()],
                interaction_types_to_remove: Vec::new(),
                screen_auto_lock_timeout_seconds: 120.0,
                screen_auto_lock_tolerance_seconds: 30.0,
                screen_manual_lock_max_tail_seconds: 30.0,
                screen_keyguard_near_stop_seconds: 2.0,
                datetime_of_preprocessing: "2026-07-23 00:00:00 UTC".into(),
                model_concurrent_usage: false,
                minimum_usage_duration: 0.0,
                apply_minimum_usage_duration_to_concurrent_subintervals: false,
                filter_zero_duration_sessions: false,
                add_no_activity_placeholder_days: false,
                enable_study_window_filter: false,
                enable_person_attribution: false,
                enable_day_coverage: false,
                enable_compliance_scoring: false,
                compliance_threshold_percent: 70.0,
                enable_screen_gated_crediting: false,
                enable_aggregates: false,
                aggregate_shape: "wide".into(),
                materialize_visualization_data: true,
                credited_session_cap_minutes: 360.0,
                device_liveness_gap_tolerance_minutes: 120.0,
                auto_lock_bridge_seconds: 120.0,
                no_witness_min_day_apps: 2,
            }
        }

        fn late_pipeline_options() -> PipelineV2Options {
            let mut options = pipeline_options();
            options.enable_screen_gated_crediting = true;
            options.enable_study_window_filter = true;
            options.enable_person_attribution = true;
            options.add_no_activity_placeholder_days = true;
            options.enable_day_coverage = true;
            options.enable_compliance_scoring = true;
            options
        }

        /// A persisted resume base is read back from browser storage, so its
        /// header is the only thing standing between a corrupt or hostile
        /// object and the decoder. The header size the runtime is told to
        /// reserve has to be the size the parser skips, the magic and the
        /// payload digest have to be checked, and the declared payload size is
        /// refused only once it is past the cap - a base declaring exactly the
        /// cap is still a base the decoder must accept.
        #[test]
        fn a_persisted_base_header_is_checked_against_its_own_declared_payload() {
            let review = {
                let mut bytes = vec![0_u8; super::super::review_base_header_bytes()];
                bytes[..REVIEW_BASE_MAGIC.len()].copy_from_slice(REVIEW_BASE_MAGIC);
                let digest = *blake3::hash(&[]).as_bytes();
                let size_offset = REVIEW_BASE_MAGIC.len();
                let digest_offset = size_offset + 4;
                bytes[digest_offset..digest_offset + 32].copy_from_slice(&digest);
                let declare = |bytes: &mut Vec<u8>, value: u32| {
                    bytes[size_offset..digest_offset].copy_from_slice(&value.to_le_bytes());
                };
                declare(&mut bytes, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES as u32);
                let header = verify_review_base_payload(&bytes)
                    .expect("a review base declaring exactly the cap");
                assert_eq!(header.declared_bytes, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES);
                assert_eq!(header.payload_digest, digest);

                declare(&mut bytes, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES as u32 + 1);
                let over =
                    verify_review_base_payload(&bytes).expect_err("a review base past the cap");
                assert!(over.contains("exceeding"), "{over}");

                declare(&mut bytes, 0);
                bytes
            };
            let truncated = verify_review_base_payload(&review[..review.len() - 1])
                .expect_err("a truncated review base");
            assert!(truncated.contains("truncated"), "{truncated}");
            let mut wrong_magic = review.clone();
            wrong_magic[0] = b'X';
            let invalid = verify_review_base_payload(&wrong_magic)
                .expect_err("a review base with foreign magic");
            assert!(invalid.contains("invalid header"), "{invalid}");
            let mut wrong_digest = review.clone();
            wrong_digest[REVIEW_BASE_MAGIC.len() + 4] ^= 0xff;
            let mismatch = verify_review_base_payload(&wrong_digest)
                .expect_err("a review base whose payload does not match its digest");
            assert!(mismatch.contains("digest mismatch"), "{mismatch}");

            let reconstruction = {
                let mut bytes = vec![0_u8; super::super::reconstruction_base_header_bytes()];
                bytes[..RECONSTRUCTION_BASE_MAGIC.len()].copy_from_slice(RECONSTRUCTION_BASE_MAGIC);
                let digest = *blake3::hash(&[]).as_bytes();
                let size_offset = RECONSTRUCTION_BASE_MAGIC.len();
                let digest_offset = size_offset + 4;
                bytes[digest_offset..digest_offset + 32].copy_from_slice(&digest);
                let declare = |bytes: &mut Vec<u8>, value: u32| {
                    bytes[size_offset..digest_offset].copy_from_slice(&value.to_le_bytes());
                };
                declare(
                    &mut bytes,
                    MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES as u32,
                );
                let header = verify_reconstruction_base_payload(&bytes)
                    .expect("a reconstruction base declaring exactly the cap");
                assert_eq!(
                    header.declared_bytes,
                    MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES
                );
                assert_eq!(header.payload_digest, digest);

                declare(
                    &mut bytes,
                    MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES as u32 + 1,
                );
                let over = verify_reconstruction_base_payload(&bytes)
                    .expect_err("a reconstruction base past the cap");
                assert!(over.contains("exceeding"), "{over}");

                declare(&mut bytes, 0);
                bytes
            };
            let truncated =
                verify_reconstruction_base_payload(&reconstruction[..reconstruction.len() - 1])
                    .expect_err("a truncated reconstruction base");
            assert!(truncated.contains("truncated"), "{truncated}");
            let mut wrong_magic = reconstruction.clone();
            wrong_magic[0] = b'X';
            let invalid = verify_reconstruction_base_payload(&wrong_magic)
                .expect_err("a reconstruction base with foreign magic");
            assert!(invalid.contains("invalid header"), "{invalid}");
            let mut wrong_digest = reconstruction.clone();
            wrong_digest[RECONSTRUCTION_BASE_MAGIC.len() + 4] ^= 0xff;
            let mismatch = verify_reconstruction_base_payload(&wrong_digest)
                .expect_err("a reconstruction base whose payload does not match its digest");
            assert!(mismatch.contains("digest mismatch"), "{mismatch}");
        }

        /// The two uncompressed ceilings are hard reject bounds, not buffer
        /// hints. `encode_review_base` and `encode_reconstruction_base` refuse
        /// a base past them, and `verify_review_base_payload` and
        /// `verify_reconstruction_base_payload` refuse to read one back, so a
        /// ceiling that fell to a few hundred kilobytes would stop the review-event
        /// and reconstruction typed resume from ever engaging on a real export. The
        /// 100k-row production fixture needs about 25 MiB decoded, while every
        /// fixture in this file is a handful of rows - so only the ceiling's
        /// own magnitude can catch that.
        #[test]
        fn the_resume_ceilings_stay_far_above_a_real_production_base() {
            let hundred_mib = 100 * 1024 * 1024;
            let review_ceiling = MAX_REVIEW_BASE_UNCOMPRESSED_BYTES;
            let reconstruction_ceiling = MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES;
            assert!(
                review_ceiling >= hundred_mib,
                "the review-base ceiling is {review_ceiling} bytes, which refuses a production \
                 review base and disables the review-event resume",
            );
            assert!(
                reconstruction_ceiling >= hundred_mib,
                "the reconstruction-base ceiling is {reconstruction_ceiling} bytes, which \
                 refuses a production reconstruction base and disables the reconstruction resume",
            );
            // Reconstruction carries the review rows plus the matcher-side
            // checkpoints, so its ceiling can never be the tighter of the two.
            assert!(
                reconstruction_ceiling >= review_ceiling,
                "the reconstruction-base ceiling dropped below the review-base ceiling",
            );
            // Both are declared in the header as a little-endian u32, so a
            // ceiling above that range could never be reached by a declared
            // size and the reject bound would be unreachable.
            assert!(review_ceiling <= u32::MAX as usize);
            assert!(reconstruction_ceiling <= u32::MAX as usize);
        }

        /// The ceiling is enforced at the exact byte: a base whose serialized
        /// payload is exactly the ceiling is still encoded unchanged, and one
        /// byte past it is refused. Serializing a base the size of the real
        /// ceiling is not practical, so the boundary is driven at the ceiling
        /// the encoder is handed - the same comparison the production entry
        /// points reach through.
        #[test]
        fn a_base_is_encoded_at_the_ceiling_and_refused_one_byte_past_it() {
            let support = PipelineV2SupportFiles::default();
            let options = pipeline_options();
            let mut engine = TrackedEngine::default();
            engine
                .execute(&csv(), &options, support, true)
                .expect("export execute");
            let review_bytes = engine.export_review_base().expect("review base");
            let reconstruction_bytes = engine
                .export_reconstruction_base()
                .expect("reconstruction base");
            let review = decode_review_base_cached(&review_bytes).expect("decode review base");
            let reconstruction = decode_reconstruction_base_cached(&reconstruction_bytes)
                .expect("decode reconstruction base");
            let declared = |encoded: &[u8], magic_bytes: usize| {
                u32::from_le_bytes(
                    encoded[magic_bytes..magic_bytes + 4]
                        .try_into()
                        .expect("four-byte declared size"),
                ) as usize
            };

            let unbounded =
                encode_review_base_within(&review, usize::MAX).expect("an unbounded review base");
            let payload_bytes = declared(&unbounded, REVIEW_BASE_MAGIC.len());
            let at_ceiling = encode_review_base_within(&review, payload_bytes)
                .expect("a review base whose payload is exactly the ceiling");
            assert_eq!(
                at_ceiling, unbounded,
                "encoding at the ceiling changed the review base",
            );
            let over = encode_review_base_within(&review, payload_bytes - 1)
                .expect_err("a review base one byte past the ceiling");
            assert!(over.contains("too large"), "{over}");

            let unbounded = encode_reconstruction_base_within(&reconstruction, usize::MAX)
                .expect("an unbounded reconstruction base");
            let payload_bytes = declared(&unbounded, RECONSTRUCTION_BASE_MAGIC.len());
            let at_ceiling = encode_reconstruction_base_within(&reconstruction, payload_bytes)
                .expect("a reconstruction base whose payload is exactly the ceiling");
            assert_eq!(
                at_ceiling, unbounded,
                "encoding at the ceiling changed the reconstruction base",
            );
            let over = encode_reconstruction_base_within(&reconstruction, payload_bytes - 1)
                .expect_err("a reconstruction base one byte past the ceiling");
            assert!(over.contains("too large"), "{over}");
        }

        #[test]
        fn early_query_cone_matches_the_sequential_oracle_and_reuses_exactly() {
            let mut db = EarlyDatabase::default();
            let (raw, config) = inputs(&db);
            let tracked = run_all(&db, raw, config).unwrap();
            let oracle = run_pipeline_v2(&csv(), &pipeline_options(), &[], &[], &[]).unwrap();
            let expected = crate::workflow_contract::WORKFLOW_QUERIES
                .iter()
                .take_while(|query| query.id != "derive_time_gap_evidence")
                .chain(
                    crate::workflow_contract::WORKFLOW_QUERIES
                        .iter()
                        .filter(|query| query.id == "derive_time_gap_evidence"),
                )
                .map(|query| query.id)
                .collect::<Vec<_>>();
            assert_eq!(tracked.len(), expected.len());
            for (step, digest) in &tracked {
                assert_eq!(
                    oracle.workflow_query_digests.get(step),
                    Some(digest),
                    "{step}"
                );
            }
            let mut bodies = db.take_query_bodies();
            bodies.sort_unstable();
            let mut expected = expected;
            expected.sort_unstable();
            assert_eq!(bodies, expected);

            assert_eq!(run_all(&db, raw, config).unwrap(), tracked);
            assert!(db.take_query_bodies().is_empty());

            config
                .set_interaction_type_remap(&mut db)
                .to(Arc::new(vec!["Never Seen=>Unused".into()]));
            run_all(&db, raw, config).unwrap();
            let mut changed = db.take_query_bodies();
            changed.sort_unstable();
            assert_eq!(
                changed,
                ["canonicalize_source_rows", "validate_remap_rules"]
            );

            config.set_deduplicate_exact_rows(&mut db).to(false);
            run_all(&db, raw, config).unwrap();
            assert_eq!(db.take_query_bodies(), ["coalesce_duplicate_event_keys"]);

            config
                .set_datetime_of_preprocessing(&mut db)
                .to("2026-07-24 00:00:00 UTC".into());
            run_all(&db, raw, config).unwrap();
            assert_eq!(db.take_query_bodies(), ["bind_processing_timestamp"]);

            config
                .set_other_stop_types(&mut db)
                .to(Arc::new(vec!["Activity Resumed".into()]));
            run_all(&db, raw, config).unwrap();
            let mut changed = db.take_query_bodies();
            changed.sort_unstable();
            assert_eq!(
                changed,
                [
                    "derive_time_gap_evidence",
                    "disambiguate_duplicate_timestamps"
                ]
            );

            config
                .set_same_app_stop_types(&mut db)
                .to(Arc::new(vec!["Activity Paused".into()]));
            run_all(&db, raw, config).unwrap();
            assert_eq!(
                db.take_query_bodies(),
                ["disambiguate_duplicate_timestamps"]
            );
        }

        #[test]
        fn reconstruction_queries_match_the_oracle_and_track_conditional_support_reads() {
            let mut db = EarlyDatabase::default();
            let (raw, early) = inputs(&db);
            let (config, support) = usage_inputs(&db);
            let tracked = run_reconstruction(&db, raw, early, config, support).unwrap();
            let oracle = run_pipeline_v2(&csv(), &pipeline_options(), &[], &[], &[]).unwrap();
            assert_registered_query_ids(
                "reconstruction",
                tracked.keys(),
                &[
                    "mark_app_policy_matches",
                    "resolve_excluded_packages",
                    "mask_excluded_app_events",
                    "build_app_event_index",
                    "match_app_episodes",
                    "materialize_candidate_episodes",
                    "classify_episode_durations",
                    "apply_app_inclusion_policy",
                    "order_app_episodes",
                    "segment_concurrent_usage",
                    "join_app_codebook",
                    "derive_broad_category",
                    "collapse_app_genre",
                    "derive_engagement_basis",
                    "apply_episode_flags",
                    "suppress_excluded_timing",
                    "remove_selected_interaction_types",
                    "remove_zero_duration_rows",
                ],
            );
            for (step, digest) in &tracked {
                assert_eq!(
                    oracle.workflow_query_digests.get(step),
                    Some(digest),
                    "{step}"
                );
            }

            db.take_query_bodies();
            assert_eq!(
                run_reconstruction(&db, raw, early, config, support).unwrap(),
                tracked
            );
            assert!(db.take_query_bodies().is_empty());

            support
                .set_filter_csv(&mut db)
                .to(Arc::new(b"app_package_name\ncom.example.chat\n".to_vec()));
            support
                .set_background_apps_csv(&mut db)
                .to(Arc::new(b"package_name\ncom.example.chat\n".to_vec()));
            run_reconstruction(&db, raw, early, config, support).unwrap();
            assert!(
                db.take_query_bodies().is_empty(),
                "disabled support files are not query dependencies"
            );

            support.set_use_filter_file(&mut db).to(true);
            run_reconstruction(&db, raw, early, config, support).unwrap();
            let policy_change = db.take_query_bodies();
            assert!(policy_change.contains(&"mark_app_policy_matches"));
            assert!(policy_change.contains(&"resolve_excluded_packages"));
            assert!(
                !policy_change.contains(&"build_app_event_index")
                    && !policy_change.contains(&"match_app_episodes"),
                "an app-exclusion policy edit must reuse the policy-neutral matcher: {policy_change:?}"
            );

            db.take_query_bodies();
            config.set_allow_stop_event_reuse(&mut db).to(true);
            run_reconstruction(&db, raw, early, config, support).unwrap();
            assert!(db.take_query_bodies().contains(&"match_app_episodes"));
        }

        #[test]
        fn screen_queries_match_the_oracle_and_ignore_disabled_support_bytes() {
            let mut db = EarlyDatabase::default();
            let (raw, early) = inputs(&db);
            let (config, support) = usage_inputs(&db);
            let tracked = run_screen(&db, raw, early, config, support).unwrap();
            let oracle = run_pipeline_v2(&csv(), &pipeline_options(), &[], &[], &[]).unwrap();
            assert_registered_query_ids(
                "screen reconstruction",
                tracked.keys(),
                &[
                    "index_keyguard_events",
                    "infer_screen_session_skeletons",
                    "classify_screen_sessions",
                ],
            );
            for (step, digest) in &tracked {
                assert_eq!(
                    oracle.workflow_query_digests.get(step),
                    Some(digest),
                    "{step}"
                );
            }

            db.take_query_bodies();
            assert_eq!(
                run_screen(&db, raw, early, config, support).unwrap(),
                tracked
            );
            assert!(db.take_query_bodies().is_empty());

            support.set_apps_forcing_csv(&mut db).to(Arc::new(
                b"package_name,label_or_note\ncom.example.chat,Video player\n".to_vec(),
            ));
            run_screen(&db, raw, early, config, support).unwrap();
            assert!(
                db.take_query_bodies().is_empty(),
                "disabled apps-forcing bytes are not a dependency"
            );

            support.set_use_apps_forcing_screen_open(&mut db).to(true);
            run_screen(&db, raw, early, config, support).unwrap();
            assert_eq!(db.take_query_bodies(), ["classify_screen_sessions"]);
        }

        #[test]
        fn late_queries_match_the_fused_oracle_and_reuse_exactly() {
            let db = EarlyDatabase::default();
            let (raw, early) = inputs(&db);
            let (config, support) = usage_inputs(&db);
            let (late, late_support) = late_inputs(&db);
            let output = output_input(&db);
            let tracked = run_late(&db, raw, early, config, support, late, late_support).unwrap();
            let options = late_pipeline_options();
            let oracle = run_pipeline_v2_with_supports(
                &csv(),
                &options,
                PipelineV2SupportFiles {
                    study_dates_csv: &late_support.study_dates_csv(&db),
                    device_sharing_csv: &late_support.device_sharing_csv(&db),
                    survey_attribution_csv: &late_support.survey_attribution_csv(&db),
                    enrolled_devices_csv: &late_support.enrolled_devices_csv(&db),
                    ..PipelineV2SupportFiles::default()
                },
            )
            .unwrap();
            assert!(!tracked.is_empty());
            for (step, digest) in &tracked {
                assert_eq!(
                    oracle.workflow_query_digests.get(step),
                    Some(digest),
                    "{step}"
                );
            }
            let assembled = assemble_result_manifest(
                &db,
                raw,
                early,
                config,
                support,
                late,
                late_support,
                output,
            )
            .unwrap();
            assert_eq!(
                oracle
                    .workflow_query_digests
                    .get("assemble_result_manifest"),
                Some(&assembled.checkpoint.terminal_digest)
            );
            assert_eq!(assembled.value.app_csv_bytes, oracle.app_csv_bytes);
            assert_eq!(assembled.value.screen_csv_bytes, oracle.screen_csv_bytes);
            assert_eq!(
                assembled.value.day_coverage_csv_bytes,
                oracle.day_coverage_csv_bytes
            );
            assert_eq!(
                assembled.value.compliance_csv_bytes,
                oracle.compliance_csv_bytes
            );
            assert_eq!(
                assembled.value.credited_app_csv_bytes,
                oracle.credited_app_csv_bytes
            );
            assert_eq!(
                assembled.value.review_summary_json_bytes,
                oracle.review_summary_json_bytes
            );
            assert_eq!(
                assembled.value.visualization_data_json_bytes,
                oracle.visualization_data_json_bytes
            );
            assert_eq!(
                assembled.value.aggregate_csv_outputs.len(),
                oracle.aggregate_csv_outputs.len()
            );
            assert_eq!(assembled.value.row_lineage, oracle.row_lineage);

            db.take_query_bodies();
            assert_eq!(
                run_late(&db, raw, early, config, support, late, late_support,).unwrap(),
                tracked
            );
            assert_eq!(
                assemble_result_manifest(
                    &db,
                    raw,
                    early,
                    config,
                    support,
                    late,
                    late_support,
                    output,
                )
                .unwrap()
                .checkpoint,
                assembled.checkpoint
            );
            assert!(db.take_query_bodies().is_empty());
        }

        #[test]
        fn compliance_threshold_reuses_threshold_independent_completeness() {
            let mut db = EarlyDatabase::default();
            let (raw, early) = inputs(&db);
            let (config, support) = usage_inputs(&db);
            let (late, late_support) = late_inputs(&db);

            classify_compliance_days(&db, raw, early, config, support, late, late_support).unwrap();
            db.take_query_bodies();

            late.set_compliance_threshold_percent(&mut db).to(20.0);
            classify_compliance_days(&db, raw, early, config, support, late, late_support).unwrap();

            assert_eq!(db.take_query_bodies(), ["classify_compliance_days"]);
        }

        #[test]
        fn stateful_engine_matches_the_complete_oracle_and_reports_real_execution() {
            let options = late_pipeline_options();
            let study_dates =
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n".to_vec();
            let device_sharing = b"participant_id,sharing_status\nP01,Non-Shared\n".to_vec();
            let enrolled_devices = b"participant_id,device_count\nP01,1\n".to_vec();
            let support = PipelineV2SupportFiles {
                study_dates_csv: &study_dates,
                device_sharing_csv: &device_sharing,
                enrolled_devices_csv: &enrolled_devices,
                ..PipelineV2SupportFiles::default()
            };
            let oracle = run_pipeline_v2_with_supports(&csv(), &options, support).unwrap();
            let mut engine = TrackedEngine::default();
            let tracked = engine.execute(&csv(), &options, support, true).unwrap();
            assert_eq!(
                tracked.executed_queries.len(),
                crate::workflow_contract::WORKFLOW_QUERIES.len()
            );
            assert_eq!(
                tracked
                    .executed_queries
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len(),
                crate::workflow_contract::WORKFLOW_QUERIES.len()
            );
            assert_eq!(
                tracked.internal_executed_queries,
                [
                    "collect_early_assembly",
                    "parsed_apps_forcing_screen_open",
                    "background_apps",
                    "parsed_study_windows",
                    "parsed_device_sharing",
                    "parsed_survey_attribution",
                    "parsed_enrolled_devices",
                    "assemble_primary_outputs",
                ]
            );
            assert_eq!(
                tracked.result.workflow_query_checkpoints,
                oracle.workflow_query_checkpoints
            );
            assert_eq!(
                tracked.result.workflow_query_group_checkpoints,
                oracle.workflow_query_group_checkpoints
            );
            assert_eq!(tracked.result.app_csv_bytes, oracle.app_csv_bytes);
            assert_eq!(tracked.result.screen_csv_bytes, oracle.screen_csv_bytes);
            assert_eq!(
                tracked.result.day_coverage_csv_bytes,
                oracle.day_coverage_csv_bytes
            );
            assert_eq!(
                tracked.result.compliance_csv_bytes,
                oracle.compliance_csv_bytes
            );
            assert_eq!(
                tracked.result.credited_app_csv_bytes,
                oracle.credited_app_csv_bytes
            );
            assert_eq!(
                tracked.result.review_summary_json_bytes,
                oracle.review_summary_json_bytes
            );
            assert_eq!(
                tracked.result.visualization_data_json_bytes,
                oracle.visualization_data_json_bytes
            );
            assert_eq!(tracked.result.row_lineage, oracle.row_lineage);
            assert_eq!(
                (
                    tracked.result.original_row_count,
                    tracked.result.processed_row_count,
                    tracked.result.app_row_count,
                    tracked.result.screen_row_count,
                    tracked.result.day_coverage_row_count,
                    tracked.result.compliance_row_count,
                    tracked.result.credited_app_row_count,
                    tracked.result.duplicate_timestamps_corrected,
                    tracked.result.exact_duplicate_rows_removed,
                    tracked.result.available_timezones.clone(),
                    tracked.result.timezone.clone(),
                    tracked.result.timezone_action.clone(),
                ),
                (
                    oracle.original_row_count,
                    oracle.processed_row_count,
                    oracle.app_row_count,
                    oracle.screen_row_count,
                    oracle.day_coverage_row_count,
                    oracle.compliance_row_count,
                    oracle.credited_app_row_count,
                    oracle.duplicate_timestamps_corrected,
                    oracle.exact_duplicate_rows_removed,
                    oracle.available_timezones,
                    oracle.timezone,
                    oracle.timezone_action,
                )
            );

            let warm = engine.execute(&csv(), &options, support, true).unwrap();
            assert!(
                warm.executed_queries.is_empty(),
                "warm execution reran {:?}",
                warm.executed_queries
            );
            assert!(warm.internal_executed_queries.is_empty());
            assert_eq!(
                warm.result.workflow_query_checkpoints,
                tracked.result.workflow_query_checkpoints
            );

            let mut output_only = options.clone();
            output_only.study_name = "Output-only change".into();
            let changed = engine.execute(&csv(), &output_only, support, true).unwrap();
            assert_eq!(changed.executed_queries, ["assemble_result_manifest"]);
            assert_eq!(
                changed.internal_executed_queries,
                ["assemble_primary_outputs"]
            );
            let output_oracle =
                run_pipeline_v2_with_supports(&csv(), &output_only, support).unwrap();
            assert_result_parity(
                &changed.result,
                &output_oracle,
                output_only.usage_session_mode,
            );

            let mut downstream_engine = TrackedEngine::default();
            downstream_engine
                .execute(&csv(), &options, support, true)
                .unwrap();
            let mut coverage_off = options.clone();
            coverage_off.enable_day_coverage = false;
            let downstream = downstream_engine
                .execute(&csv(), &coverage_off, support, true)
                .unwrap();
            assert_eq!(downstream.executed_queries, ["assemble_result_manifest"]);
            assert!(downstream.internal_executed_queries.is_empty());
            let downstream_oracle =
                run_pipeline_v2_with_supports(&csv(), &coverage_off, support).unwrap();
            assert_result_parity(
                &downstream.result,
                &downstream_oracle,
                coverage_off.usage_session_mode,
            );

            let codebook_lf = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Social,Communication,test\n".to_vec();
            let codebook_crlf = String::from_utf8(codebook_lf.clone())
                .unwrap()
                .replace('\n', "\r\n")
                .into_bytes();
            let mut codebook_options = options.clone();
            codebook_options.use_app_codebook = true;
            let codebook_support_lf = PipelineV2SupportFiles {
                codebook_csv: &codebook_lf,
                ..support
            };
            let codebook_support_crlf = PipelineV2SupportFiles {
                codebook_csv: &codebook_crlf,
                ..support
            };
            let mut codebook_engine = TrackedEngine::default();
            codebook_engine
                .execute(&csv(), &codebook_options, codebook_support_lf, true)
                .unwrap();
            let representation_only = codebook_engine
                .execute(&csv(), &codebook_options, codebook_support_crlf, true)
                .unwrap();
            // LF/CRLF is a support-file representation change only. Parsing is
            // tracked separately, so identical codebook values stop here and
            // no product step is falsely invalidated.
            assert!(representation_only.executed_queries.is_empty());
            assert_eq!(
                representation_only.internal_executed_queries,
                ["parsed_codebook"]
            );
            let representation_oracle =
                run_pipeline_v2_with_supports(&csv(), &codebook_options, codebook_support_crlf)
                    .unwrap();
            assert_result_parity(
                &representation_only.result,
                &representation_oracle,
                codebook_options.usage_session_mode,
            );
        }

        #[test]
        fn review_minimum_change_reuses_rows_when_reconstruction_erases_the_floor() {
            let mut baseline = pipeline_options();
            baseline.model_concurrent_usage = true;
            baseline.apply_minimum_usage_duration_to_concurrent_subintervals = false;
            let support = PipelineV2SupportFiles::default();

            let mut engine = TrackedEngine::default();
            engine.execute(&csv(), &baseline, support, false).unwrap();

            let mut changed = baseline.clone();
            changed.minimum_usage_duration = 60.0;
            let reused = engine.execute(&csv(), &changed, support, false).unwrap();
            assert!(
                !reused
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "review_reconstructed_rows"),
                "a conditionally irrelevant minimum rebuilt rows: {:?}",
                reused.internal_executed_queries
            );
            assert!(
                reused
                    .executed_queries
                    .iter()
                    .any(|step| step == "classify_episode_durations"),
                "the changed pre-split logical step was not recorded: {:?}",
                reused.executed_queries
            );
            for downstream in ["join_app_codebook", "remove_zero_duration_rows"] {
                assert!(
                    !reused
                        .executed_queries
                        .iter()
                        .any(|step| step == downstream),
                    "the converged split output falsely invalidated {downstream}: {:?}",
                    reused.executed_queries
                );
            }
            assert_eq!(
                reused.executed_queries,
                [
                    "classify_episode_durations",
                    "apply_app_inclusion_policy",
                    "order_app_episodes",
                    "assemble_result_manifest",
                ],
                "the minimum-only change crossed its proven convergence boundary"
            );

            let mut cold = TrackedEngine::default();
            let expected = cold.execute(&csv(), &changed, support, false).unwrap();
            assert_checkpoint_parity(
                "step",
                &reused.result.workflow_query_checkpoints,
                &expected.result.workflow_query_checkpoints,
                changed.usage_session_mode,
            );
            assert_checkpoint_parity(
                "query group",
                &reused.result.workflow_query_group_checkpoints,
                &expected.result.workflow_query_group_checkpoints,
                changed.usage_session_mode,
            );
            assert_eq!(
                reused.result.review_summary_json_bytes,
                expected.result.review_summary_json_bytes
            );
            let oracle = run_pipeline_v2_with_supports(&csv(), &changed, support)
                .expect("sequential oracle for a minimum-only change");
            assert_eq!(
                reused.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "reusing rows across a minimum-only change drifted from the sequential path",
            );

            changed.apply_minimum_usage_duration_to_concurrent_subintervals = true;
            let affected = engine.execute(&csv(), &changed, support, false).unwrap();
            assert!(
                affected
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "review_reconstructed_rows"),
                "a minimum that applies to split intervals incorrectly reused rows: {:?}",
                affected.internal_executed_queries
            );
        }

        #[test]
        fn repeated_review_floor_edits_reuse_matcher_rows_when_the_floor_matters() {
            let mut baseline = pipeline_options();
            baseline.model_concurrent_usage = false;
            baseline.minimum_usage_duration = 60.0;
            let support = PipelineV2SupportFiles::default();

            let mut producer = TrackedEngine::default();
            producer.execute(&csv(), &baseline, support, true).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let reconstruction_base = producer.export_reconstruction_base().unwrap();

            let mut engine = TrackedEngine::default();
            engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &baseline,
                    support,
                    false,
                )
                .unwrap();

            let mut first_edit = baseline.clone();
            first_edit.minimum_usage_duration = 2.0;
            let first = engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &first_edit,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                first
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "review_applied_rows"),
                "the first floor edit did not establish the matcher-row cache"
            );

            let mut second_edit = first_edit.clone();
            second_edit.minimum_usage_duration = 3.0;
            let second = engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &second_edit,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                !second
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "review_applied_rows"),
                "a repeated floor edit reran matcher application: {:?}",
                second.internal_executed_queries
            );
            assert!(
                !second
                    .executed_queries
                    .iter()
                    .any(|step| step == "materialize_candidate_episodes"),
                "a repeated floor edit falsely recomputed materialize_candidate_episodes: {:?}",
                second.executed_queries
            );
            assert!(
                second
                    .executed_queries
                    .iter()
                    .any(|step| step == "classify_episode_durations"),
                "the changed floor did not recompute classify_episode_durations"
            );

            let mut cold = TrackedEngine::default();
            let expected = cold.execute(&csv(), &second_edit, support, false).unwrap();
            assert_result_parity(
                &second.result,
                &expected.result,
                second_edit.usage_session_mode,
            );

            // Both engines above run the same query graph, so they agree even
            // when that graph reuses the wrong rows. The sequential path
            // computes the same steps through separate code and is the only
            // check here that a review shortcut dropped work it owed.
            let oracle = run_pipeline_v2_with_supports(&csv(), &second_edit, support)
                .expect("sequential oracle for a repeated floor edit");
            assert_eq!(
                second.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "repeated floor edits drifted from the sequential path",
            );
        }

        #[test]
        fn review_base_skips_early_rows_without_changing_results() {
            let baseline = pipeline_options();
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            producer.execute(&csv(), &baseline, support, true).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let decoded = decode_review_base_bytes(&review_base).unwrap();
            assert_registered_query_ids(
                "review base",
                decoded.metadata.query_checkpoints.keys(),
                &[
                    "validate_remap_rules",
                    "decode_source_records",
                    "remove_missing_timestamps",
                    "attach_device_models",
                    "bind_processing_timestamp",
                    "canonicalize_source_rows",
                    "order_source_records",
                    "collect_timezone_observations",
                    "estimate_dominant_timezone",
                    "resolve_timezone_strategy",
                    "standardize_event_clock",
                    "summarize_row_selection",
                    "coalesce_duplicate_event_keys",
                    "summarize_duplicate_groups",
                    "disambiguate_duplicate_timestamps",
                    "derive_time_gap_evidence",
                    "mark_app_policy_matches",
                ],
            );
            assert_eq!(decoded.rows.len(), 5);
            REVIEW_BASE_DECODE_CACHE.with(|cache| cache.borrow_mut().take());
            REVIEW_BASE_DECODE_COUNT.with(|count| count.set(0));
            let first_cached = decode_review_base_cached(&review_base).unwrap();
            let second_cached = decode_review_base_cached(&review_base).unwrap();
            assert!(Arc::ptr_eq(&first_cached, &second_cached));
            REVIEW_BASE_DECODE_COUNT.with(|count| assert_eq!(count.get(), 1));

            let mut changed = baseline.clone();
            changed.model_concurrent_usage = true;

            let mut cached_engine = TrackedEngine::default();
            let cached = cached_engine
                .execute_with_review_base(&csv(), &review_base, &changed, support, false)
                .unwrap();
            assert!(
                cached
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_review_base"),
                "review base was not restored: {:?}",
                cached.internal_executed_queries
            );
            for early_step in decoded.metadata.query_checkpoints.keys() {
                assert!(
                    !cached.executed_queries.contains(early_step),
                    "cached review reran early step {early_step}: {:?}",
                    cached.executed_queries
                );
            }

            let mut cold_engine = TrackedEngine::default();
            let cold = cold_engine
                .execute(&csv(), &changed, support, false)
                .unwrap();
            assert_result_parity(&cached.result, &cold.result, changed.usage_session_mode);

            let truncated = &review_base[..review_base.len() / 2];
            let mut corrupt_engine = TrackedEngine::default();
            let error = match corrupt_engine.execute_with_review_base(
                &csv(),
                truncated,
                &changed,
                support,
                false,
            ) {
                Ok(_) => panic!("truncated review base was accepted"),
                Err(error) => error,
            };
            assert!(
                error.contains("decompress review base")
                    || error.contains("decode review base")
                    || error.contains("payload digest mismatch"),
                "unexpected corrupt review-base error: {error}"
            );
            let mut oversized = review_base.clone();
            oversized[REVIEW_BASE_MAGIC.len()..REVIEW_BASE_MAGIC.len() + 4]
                .copy_from_slice(&((MAX_REVIEW_BASE_UNCOMPRESSED_BYTES + 1) as u32).to_le_bytes());
            let mut oversized_engine = TrackedEngine::default();
            let error = match oversized_engine.execute_with_review_base(
                &csv(),
                &oversized,
                &changed,
                support,
                false,
            ) {
                Ok(_) => panic!("oversized review base was accepted"),
                Err(error) => error,
            };
            assert!(error.contains("review base declares"), "{error}");

            let mut changed_upstream = changed.clone();
            changed_upstream.deduplicate_exact_rows = !baseline.deduplicate_exact_rows;
            let mut miss_engine = TrackedEngine::default();
            let miss = miss_engine
                .execute_with_review_base(&csv(), &review_base, &changed_upstream, support, false)
                .unwrap();
            assert!(
                miss.executed_queries
                    .iter()
                    .any(|step| step == "decode_source_records"),
                "upstream key change did not fall back to raw execution: {:?}",
                miss.executed_queries
            );
            assert!(
                !miss
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_review_base"),
                "mismatched review base was restored"
            );

            for (label, changed_stops) in [
                ("same-app", {
                    let mut options = baseline.clone();
                    options.same_app_stop_types.push("CUSTOM_SAME_STOP".into());
                    options
                }),
                ("other-app", {
                    let mut options = baseline.clone();
                    options.other_stop_types.push("CUSTOM_OTHER_STOP".into());
                    options
                }),
            ] {
                let mut changed_engine = TrackedEngine::default();
                let changed_result = changed_engine
                    .execute_with_review_base(&csv(), &review_base, &changed_stops, support, false)
                    .unwrap();
                assert!(
                    !changed_result
                        .internal_executed_queries
                        .iter()
                        .any(|query| query == "restore_review_base"),
                    "{label} stop-type change restored a stale review base"
                );
                assert!(
                    changed_result
                        .executed_queries
                        .iter()
                        .any(|step| step == "disambiguate_duplicate_timestamps"),
                    "{label} stop-type change did not rebuild its early dependency cone: {:?}",
                    changed_result.executed_queries
                );
                let mut cold_engine = TrackedEngine::default();
                let cold_result = cold_engine
                    .execute(&csv(), &changed_stops, support, false)
                    .unwrap();
                assert_result_parity(
                    &changed_result.result,
                    &cold_result.result,
                    changed_stops.usage_session_mode,
                );
            }
        }

        #[test]
        fn disabled_app_mode_does_not_precompute_hidden_matcher_work() {
            let mut disabled = pipeline_options();
            disabled.usage_session_mode = UsageSessionMode::NoUsage;
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            producer.execute(&csv(), &disabled, support, false).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let decoded = decode_review_base_bytes(&review_base).unwrap();
            assert!(decoded.matcher_search_suffix_digests.is_none());

            let mut enabled = disabled;
            enabled.usage_session_mode = UsageSessionMode::AppUsage;
            let mut consumer = TrackedEngine::default();
            let actual = consumer
                .execute_with_review_base(&csv(), &review_base, &enabled, support, false)
                .unwrap();
            assert!(
                actual
                    .executed_queries
                    .iter()
                    .any(|step| step == "mask_excluded_app_events"),
                "newly enabled app work was hidden behind a speculative cache: {:?}",
                actual.executed_queries
            );
            let mut cold = TrackedEngine::default();
            let expected = cold.execute(&csv(), &enabled, support, false).unwrap();
            assert_result_parity(&actual.result, &expected.result, enabled.usage_session_mode);
        }

        #[test]
        fn reconstruction_base_skips_exact_reconstruction_cone_and_rejects_wrong_keys() {
            let mut baseline = pipeline_options();
            baseline.model_concurrent_usage = true;
            baseline.apply_minimum_usage_duration_to_concurrent_subintervals = false;
            let support = PipelineV2SupportFiles::default();

            let mut producer = TrackedEngine::default();
            producer.execute(&csv(), &baseline, support, true).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let reconstruction_base = producer.export_reconstruction_base().unwrap();
            let decoded = decode_reconstruction_base_bytes(&reconstruction_base).unwrap();
            assert_eq!(decoded.rows.len(), 5);
            RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| cache.borrow_mut().take());
            RECONSTRUCTION_BASE_DECODE_COUNT.with(|count| count.set(0));
            let first_cached = decode_reconstruction_base_cached(&reconstruction_base).unwrap();
            let second_cached = decode_reconstruction_base_cached(&reconstruction_base).unwrap();
            assert!(Arc::ptr_eq(&first_cached, &second_cached));
            RECONSTRUCTION_BASE_DECODE_COUNT.with(|count| assert_eq!(count.get(), 1));

            let mut changed = baseline.clone();
            changed.minimum_usage_duration = 60.0;
            let mut cached_engine = TrackedEngine::default();
            let cached = cached_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &changed,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                cached
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "reconstruction base was not restored: {:?}",
                cached.internal_executed_queries
            );
            assert!(
                !cached
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_review_base"),
                "deep cache hit unnecessarily decoded the early row table: {:?}",
                cached.internal_executed_queries
            );
            for skipped in [
                "match_app_episodes",
                "materialize_candidate_episodes",
                "segment_concurrent_usage",
                "reconstruct_episodes",
            ] {
                assert!(
                    !cached.executed_queries.iter().any(|step| step == skipped),
                    "cached review reran {skipped}: {:?}",
                    cached.executed_queries
                );
            }

            let mut cold_engine = TrackedEngine::default();
            let cold = cold_engine
                .execute(&csv(), &changed, support, false)
                .unwrap();
            assert_result_parity(&cached.result, &cold.result, changed.usage_session_mode);

            let mut wrong_key = changed.clone();
            wrong_key.model_concurrent_usage = false;
            let mut miss_engine = TrackedEngine::default();
            let miss = miss_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &wrong_key,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                !miss
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "mismatched reconstruction base was restored"
            );
            assert!(
                miss.executed_queries
                    .iter()
                    .any(|step| step == "match_app_episodes"),
                "mismatched reconstruction base did not run its affected cone: {:?}",
                miss.executed_queries
            );

            let mut key_changes = Vec::new();
            type OptionMutation = (&'static str, fn(&mut PipelineV2Options));
            let mutations: [OptionMutation; 8] = [
                ("same stop types", |options: &mut PipelineV2Options| {
                    options.same_app_stop_types.push("CUSTOM_SAME".into())
                }),
                ("other stop types", |options: &mut PipelineV2Options| {
                    options.other_stop_types.push("CUSTOM_OTHER".into())
                }),
                ("stop reuse", |options: &mut PipelineV2Options| {
                    options.allow_stop_event_reuse = !options.allow_stop_event_reuse
                }),
                ("stopped fallback", |options: &mut PipelineV2Options| {
                    options.use_activity_stopped_as_fallback =
                        !options.use_activity_stopped_as_fallback
                }),
                ("fallback threshold", |options: &mut PipelineV2Options| {
                    options.apply_threshold_to_fallback = !options.apply_threshold_to_fallback
                }),
                ("long threshold", |options: &mut PipelineV2Options| {
                    options.long_duration_threshold_ns += 1
                }),
                ("proximity", |options: &mut PipelineV2Options| {
                    options.proximity_interval_ns += 1
                }),
                ("subinterval floor", |options: &mut PipelineV2Options| {
                    options.apply_minimum_usage_duration_to_concurrent_subintervals = true
                }),
            ];
            for (label, mutate) in mutations {
                let mut options = baseline.clone();
                mutate(&mut options);
                key_changes.push((label, options));
            }
            for (label, options) in key_changes {
                let mut changed_engine = TrackedEngine::default();
                let changed_result = changed_engine
                    .execute_with_review_bases(
                        &csv(),
                        &review_base,
                        &reconstruction_base,
                        &options,
                        support,
                        false,
                    )
                    .unwrap();
                assert!(
                    !changed_result
                        .internal_executed_queries
                        .iter()
                        .any(|query| query == "restore_reconstruction_base"),
                    "{label} change restored a stale reconstruction base"
                );
                let mut cold_engine = TrackedEngine::default();
                let cold_result = cold_engine
                    .execute(&csv(), &options, support, false)
                    .unwrap();
                assert_result_parity(
                    &changed_result.result,
                    &cold_result.result,
                    options.usage_session_mode,
                );
            }

            let screen_mutations: [OptionMutation; 4] = [
                (
                    "screen auto-lock timeout",
                    |options: &mut PipelineV2Options| {
                        options.screen_auto_lock_timeout_seconds += 1.0
                    },
                ),
                (
                    "screen auto-lock tolerance",
                    |options: &mut PipelineV2Options| {
                        options.screen_auto_lock_tolerance_seconds += 1.0
                    },
                ),
                (
                    "screen manual-lock tail",
                    |options: &mut PipelineV2Options| {
                        options.screen_manual_lock_max_tail_seconds += 1.0
                    },
                ),
                (
                    "screen keyguard proximity",
                    |options: &mut PipelineV2Options| {
                        options.screen_keyguard_near_stop_seconds += 1.0
                    },
                ),
            ];
            for (label, mutate) in screen_mutations {
                let mut options = baseline.clone();
                mutate(&mut options);
                let mut changed_engine = TrackedEngine::default();
                let changed_result = changed_engine
                    .execute_with_review_bases(
                        &csv(),
                        &review_base,
                        &reconstruction_base,
                        &options,
                        support,
                        false,
                    )
                    .unwrap();
                assert!(
                    changed_result
                        .internal_executed_queries
                        .iter()
                        .any(|query| query == "restore_reconstruction_base"),
                    "{label} change failed to reuse unrelated app reconstruction"
                );
                assert!(
                    changed_result
                        .executed_queries
                        .iter()
                        .any(|step| step == "classify_screen_sessions"),
                    "{label} change reused a stale screen result"
                );
                let mut cold_engine = TrackedEngine::default();
                let cold_result = cold_engine
                    .execute(&csv(), &options, support, false)
                    .unwrap();
                assert_result_parity(
                    &changed_result.result,
                    &cold_result.result,
                    options.usage_session_mode,
                );
            }

            let mut app_only = baseline.clone();
            app_only.usage_session_mode = UsageSessionMode::AppUsage;
            let mut app_only_engine = TrackedEngine::default();
            let app_only_result = app_only_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &app_only,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                app_only_result
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "screen applicability change failed to reuse app reconstruction"
            );
            for screen_step in [
                "index_keyguard_events",
                "infer_screen_session_skeletons",
                "classify_screen_sessions",
            ] {
                assert!(!app_only_result
                    .executed_queries
                    .iter()
                    .any(|step| step == screen_step));
            }

            let background_csv = b"app_package_name\ncom.example.chat\n";
            let background_support = PipelineV2SupportFiles {
                background_apps_csv: background_csv,
                ..support
            };
            let mut background_options = baseline.clone();
            background_options.use_background_apps_file = true;
            let mut background_engine = TrackedEngine::default();
            let background_result = background_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &background_options,
                    background_support,
                    false,
                )
                .unwrap();
            assert!(
                !background_result
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "background-app change restored a stale reconstruction base"
            );
            let mut background_cold_engine = TrackedEngine::default();
            let background_cold = background_cold_engine
                .execute(&csv(), &background_options, background_support, false)
                .unwrap();
            assert_result_parity(
                &background_result.result,
                &background_cold.result,
                background_options.usage_session_mode,
            );

            let filter_csv = b"app_package_name\ncom.example.chat\n";
            let filter_support = PipelineV2SupportFiles {
                filter_csv,
                ..support
            };
            let mut filter_options = baseline.clone();
            filter_options.use_filter_file = true;
            let mut filter_engine = TrackedEngine::default();
            let filter_result = filter_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &filter_options,
                    filter_support,
                    false,
                )
                .unwrap();
            assert!(
                !filter_result
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "filter-policy change restored a stale reconstruction base"
            );
            let mut filter_cold_engine = TrackedEngine::default();
            let filter_cold = filter_cold_engine
                .execute(&csv(), &filter_options, filter_support, false)
                .unwrap();
            assert_result_parity(
                &filter_result.result,
                &filter_cold.result,
                filter_options.usage_session_mode,
            );

            let forcing_csv = b"app_package_name,force_screen_open\ncom.example.chat,true\n";
            let forcing_support = PipelineV2SupportFiles {
                apps_forcing_csv: forcing_csv,
                ..support
            };
            let mut forcing_options = baseline.clone();
            forcing_options.use_apps_forcing_screen_open = true;
            let mut forcing_engine = TrackedEngine::default();
            let forcing_result = forcing_engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &forcing_options,
                    forcing_support,
                    false,
                )
                .unwrap();
            assert!(
                forcing_result
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "apps-forcing change failed to reuse unrelated app reconstruction"
            );
            assert!(
                forcing_result
                    .executed_queries
                    .iter()
                    .any(|step| step == "classify_screen_sessions"),
                "apps-forcing change reused a stale screen result"
            );
            let mut forcing_cold_engine = TrackedEngine::default();
            let forcing_cold = forcing_cold_engine
                .execute(&csv(), &forcing_options, forcing_support, false)
                .unwrap();
            assert_result_parity(
                &forcing_result.result,
                &forcing_cold.result,
                forcing_options.usage_session_mode,
            );

            let mut changed_csv = (*csv()).clone();
            changed_csv.extend_from_slice(
                b"Study,P02,Other,Chat,Activity Resumed,com.other,2026-03-07 11:00:00,UTC\n",
            );
            let mut raw_engine = TrackedEngine::default();
            let raw_result = raw_engine
                .execute_with_review_bases(
                    &changed_csv,
                    &review_base,
                    &reconstruction_base,
                    &baseline,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                !raw_result
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_reconstruction_base"),
                "raw policy change restored a stale reconstruction base"
            );
            let mut raw_cold_engine = TrackedEngine::default();
            let raw_cold = raw_cold_engine
                .execute(&changed_csv, &baseline, support, false)
                .unwrap();
            assert_result_parity(
                &raw_result.result,
                &raw_cold.result,
                baseline.usage_session_mode,
            );

            let mut corrupt = reconstruction_base.clone();
            let last = corrupt.len() - 1;
            corrupt[last] ^= 0xff;
            let mut corrupt_engine = TrackedEngine::default();
            let error = match corrupt_engine.execute_with_review_bases(
                &csv(),
                &review_base,
                &corrupt,
                &changed,
                support,
                false,
            ) {
                Ok(_) => panic!("corrupt reconstruction base was accepted"),
                Err(error) => error,
            };
            assert!(
                error.contains("decompress reconstruction base")
                    || error.contains("payload digest mismatch"),
                "unexpected corrupt reconstruction-base error: {error}"
            );

            let mut oversized = reconstruction_base;
            oversized[RECONSTRUCTION_BASE_MAGIC.len()..RECONSTRUCTION_BASE_MAGIC.len() + 4]
                .copy_from_slice(
                    &((MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES + 1) as u32).to_le_bytes(),
                );
            let mut oversized_engine = TrackedEngine::default();
            let error = match oversized_engine.execute_with_review_bases(
                &csv(),
                &review_base,
                &oversized,
                &changed,
                support,
                false,
            ) {
                Ok(_) => panic!("oversized reconstruction base was accepted"),
                Err(error) => error,
            };
            assert!(error.contains("reconstruction base declares"), "{error}");
        }

        #[test]
        fn reconstruction_base_v8_preserves_exact_annotation_rows_and_rejects_identity_drift() {
            let mut options = pipeline_options();
            options.model_concurrent_usage = true;
            options.apply_minimum_usage_duration_to_concurrent_subintervals = false;
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            producer.execute(&csv(), &options, support, true).unwrap();

            let encoded = producer.export_reconstruction_base().unwrap();
            let decoded = decode_reconstruction_base_bytes(&encoded).unwrap();
            assert_eq!(encoded, encode_reconstruction_base(&decoded).unwrap());
            assert_eq!(decoded.rows.len(), decoded.annotation_checkpoint.rows.len());
            assert!(decoded
                .rows
                .iter()
                .zip(decoded.annotation_checkpoint.rows.iter())
                .any(|(reconstruction, annotation)| {
                    Arc::ptr_eq(&reconstruction.0, &annotation.0)
                }));

            let mut persisted = persist_reconstruction_base(&decoded).unwrap();
            let reused = persisted
                .row_states
                .iter()
                .filter(|state| matches!(state.annotation, PersistedAnnotationRow::Reuse))
                .count();
            let replaced = persisted
                .row_states
                .iter()
                .filter(|state| matches!(state.annotation, PersistedAnnotationRow::Replace(_)))
                .count();
            assert!(reused > 0, "fixture did not exercise exact row reuse");
            assert!(
                replaced > 0,
                "fixture did not exercise exact row replacement"
            );

            let replacement = persisted
                .row_states
                .iter_mut()
                .find_map(|state| match &mut state.annotation {
                    PersistedAnnotationRow::Replace(row) => Some(row),
                    _ => None,
                })
                .expect("fixture has a replacement row");
            replacement.edit_identity().index = replacement.index.saturating_add(1);
            let error = match restore_reconstruction_base(persisted) {
                Ok(_) => panic!("identity-mutated annotation row was accepted"),
                Err(error) => error,
            };
            assert!(error.contains("changed row identity"), "{error}");

            let mut removal_options = options;
            removal_options.interaction_types_to_remove = vec!["App Usage".into()];
            let mut removal_producer = TrackedEngine::default();
            removal_producer
                .execute(&csv(), &removal_options, support, true)
                .unwrap();
            let removal_base = decode_reconstruction_base_bytes(
                &removal_producer.export_reconstruction_base().unwrap(),
            )
            .unwrap();
            let removal_persisted = persist_reconstruction_base(&removal_base).unwrap();
            assert!(removal_persisted
                .row_states
                .iter()
                .any(|state| matches!(state.annotation, PersistedAnnotationRow::Drop)));
            let restored = restore_reconstruction_base(removal_persisted).unwrap();
            assert_eq!(
                restored.annotation_checkpoint.rows.len(),
                removal_base.annotation_checkpoint.rows.len()
            );
            let mut restored_scratch = RowCheckpointScratch::default();
            let mut expected_scratch = RowCheckpointScratch::default();
            for (actual, expected) in restored
                .annotation_checkpoint
                .rows
                .iter()
                .zip(removal_base.annotation_checkpoint.rows.iter())
            {
                assert_eq!(
                    row_checkpoint_parts(actual, &mut restored_scratch),
                    row_checkpoint_parts(expected, &mut expected_scratch)
                );
            }
        }

        #[test]
        fn fused_review_categorization_and_annotations_match_full_summary() {
            let mut options = pipeline_options();
            options.use_app_codebook = true;
            let codebook = concat!(
                "app_package_name,bcm_play_store_broad_app_category,babyemu_genreId_scraped\n",
                "com.example.chat,Social,COMMUNICATION\n"
            )
            .as_bytes();
            let support = PipelineV2SupportFiles {
                codebook_csv: codebook,
                ..PipelineV2SupportFiles::default()
            };
            let mut full_engine = TrackedEngine::default();
            let full = full_engine
                .execute(&csv(), &options, support, true)
                .unwrap();
            let mut review_engine = TrackedEngine::default();
            let review = review_engine
                .execute(&csv(), &options, support, false)
                .unwrap();
            assert_eq!(
                review.result.review_summary_json_bytes,
                full.result.review_summary_json_bytes
            );
            assert_eq!(review.result.app_row_count, full.result.app_row_count);
            assert_eq!(review.result.screen_row_count, full.result.screen_row_count);
            assert!(review
                .internal_executed_queries
                .iter()
                .any(|query| query == "review_annotations_fused"));
        }

        fn assert_checkpoint_parity(
            kind: &str,
            actual: &BTreeMap<String, WorkflowCheckpoint>,
            expected: &BTreeMap<String, WorkflowCheckpoint>,
            mode: UsageSessionMode,
        ) {
            let differences = actual
                .keys()
                .chain(expected.keys())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .filter_map(|step| {
                    let actual_checkpoint = actual.get(step);
                    let expected_checkpoint = expected.get(step);
                    let actual_digest =
                        actual_checkpoint.map(|checkpoint| checkpoint.terminal_digest.as_str());
                    let expected_digest =
                        expected_checkpoint.map(|checkpoint| checkpoint.terminal_digest.as_str());
                    (actual_digest != expected_digest).then_some((
                        step.as_str(),
                        actual_checkpoint,
                        expected_checkpoint,
                    ))
                })
                .collect::<Vec<_>>();
            assert!(
                differences.is_empty(),
                "{kind} checkpoint differences for {mode:?}: {differences:#?}"
            );
        }

        fn checkpoint_rows() -> Vec<Row> {
            let raw = super::super::decode_source_records(&csv());
            let model = super::super::attach_device_models(&raw);
            super::super::canonicalize_source_rows(
                &raw,
                "America/Chicago",
                &BTreeMap::new(),
                &model,
            )
            .expect("canonical rows")
        }

        /// `same_row_state` is what lets a step hand its consumers the upstream
        /// row allocation instead of a copy. Answering yes when any one of the
        /// six checkpoint components disagrees would publish rows that do not
        /// match the checkpoint describing them, so every component has to be
        /// able to say no on its own.
        #[test]
        fn same_row_state_needs_every_checkpoint_component_to_agree() {
            let rows = checkpoint_rows();
            let checkpoint = workflow_rows_checkpoint("probe", &rows);
            assert!(
                same_row_state(&checkpoint, &checkpoint.clone()),
                "a checkpoint has to describe the same row state as itself",
            );

            #[allow(clippy::type_complexity)]
            let components: [(&str, fn(&mut WorkflowCheckpoint)); 6] = [
                ("row_membership_digest", |checkpoint| {
                    checkpoint.row_membership_digest.push('x')
                }),
                ("row_order_digest", |checkpoint| {
                    checkpoint.row_order_digest.push('x')
                }),
                ("temporal_state_digest", |checkpoint| {
                    checkpoint.temporal_state_digest.push('x')
                }),
                ("classification_digest", |checkpoint| {
                    checkpoint.classification_digest.push('x')
                }),
                ("payload_digest", |checkpoint| {
                    checkpoint.payload_digest.push('x')
                }),
                ("schema_digest", |checkpoint| {
                    checkpoint.schema_digest.push('x')
                }),
            ];
            for (component, disturb) in components {
                let mut other = checkpoint.clone();
                disturb(&mut other);
                assert!(
                    !same_row_state(&checkpoint, &other),
                    "a checkpoint differing only in {component} was called the same row state",
                );
                assert!(
                    !same_row_state(&other, &checkpoint),
                    "{component} disagreement has to be symmetric",
                );
            }
        }

        /// Persisted bases are keyed by the configuration that produced them.
        /// A review that arrives with bases exported under a different app
        /// policy has to ignore them and recompute, rather than splice their
        /// recorded checkpoints into the key it is about to use.
        #[test]
        fn bases_exported_under_a_different_app_policy_are_ignored() {
            let filter = b"app_package_name\ncom.example.chat\n".to_vec();
            let support = PipelineV2SupportFiles {
                filter_csv: &filter,
                ..PipelineV2SupportFiles::default()
            };
            let mut produced = pipeline_options();
            produced.use_filter_file = false;

            let mut producer = TrackedEngine::default();
            producer
                .execute(&csv(), &produced, support, true)
                .expect("produce bases without the filter file");
            let review_base = producer.export_review_base().expect("review base");
            let reconstruction_base = producer
                .export_reconstruction_base()
                .expect("reconstruction base");

            let mut scanned = produced.clone();
            scanned.use_filter_file = true;

            let mut engine = TrackedEngine::default();
            let resumed = engine
                .execute_with_review_bases(
                    &csv(),
                    &review_base,
                    &reconstruction_base,
                    &scanned,
                    support,
                    false,
                )
                .expect("review with foreign bases");
            assert!(
                !resumed
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_review_base"),
                "a base exported under another app policy was restored: {:?}",
                resumed.internal_executed_queries
            );

            let oracle = run_pipeline_v2_with_supports(&csv(), &scanned, support)
                .expect("sequential oracle for a foreign-base review");
            assert_eq!(
                resumed.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "a foreign base changed the answer",
            );
        }

        /// `IncrementalPipelineV2Engine` is the engine the runtime crate
        /// actually drives, and the whole persisted-resume path goes through
        /// it: it says whether the raw input it already holds matches a digest,
        /// hands out the two persisted bases, re-enters from a live input, and
        /// re-enters from the bases in a fresh engine. Drive that public
        /// surface directly, so a delegation that quietly hands back nothing —
        /// or accepts the wrong input — fails.
        #[test]
        fn the_public_engine_reports_its_verified_input_and_hands_out_usable_bases() {
            let raw = csv();
            let input_sha256 = sha256_bytes(raw.as_slice());
            let foreign_sha256 = sha256_bytes(b"not this participant's export");
            let options = pipeline_options();
            let support = PipelineV2SupportFiles::default();

            let mut engine = super::super::IncrementalPipelineV2Engine::default();
            assert!(
                !engine.has_verified_input(&input_sha256),
                "a fresh engine cannot already hold a verified input",
            );

            let cold = engine
                .execute_review(raw.as_slice(), &options, support)
                .expect("cold review through the public engine");
            assert!(
                engine.has_verified_input(&input_sha256),
                "the engine did not recognise the input it just processed",
            );
            assert!(
                !engine.has_verified_input(&foreign_sha256),
                "the engine claimed to hold an input it never saw",
            );

            let review_base = engine.export_review_base().expect("export a review base");
            let reconstruction_base = engine
                .export_reconstruction_base()
                .expect("export a reconstruction base");

            let warm = engine
                .execute_review_with_warm_verified_input(input_sha256.clone(), &options, support)
                .expect("warm review on the live input");
            assert_eq!(
                warm.result.review_summary_json_bytes, cold.result.review_summary_json_bytes,
                "the warm review answered differently from the cold one",
            );
            assert!(
                engine
                    .execute_review_with_warm_verified_input(
                        foreign_sha256.clone(),
                        &options,
                        support,
                    )
                    .is_err(),
                "a foreign digest was served from the live input",
            );

            // The later checkpoint wins when both are offered, so each base has
            // to be resumed on its own to prove it carries anything.
            for (label, bases, expected) in [
                (
                    "both bases",
                    (review_base.as_slice(), reconstruction_base.as_slice()),
                    "restore_reconstruction_base",
                ),
                (
                    "the review base alone",
                    (review_base.as_slice(), [].as_slice()),
                    "restore_review_base",
                ),
            ] {
                let mut resumed_engine = super::super::IncrementalPipelineV2Engine::default();
                let resumed = resumed_engine
                    .execute_review_with_bases(raw.as_slice(), bases.0, bases.1, &options, support)
                    .unwrap_or_else(|error| panic!("resume from {label}: {error}"));
                assert!(
                    resumed
                        .internal_executed_queries
                        .iter()
                        .any(|executed| executed == expected),
                    "{label} did not carry {expected}: {:?}",
                    resumed.internal_executed_queries,
                );
                assert_eq!(
                    resumed.result.review_summary_json_bytes, cold.result.review_summary_json_bytes,
                    "resuming from {label} changed the answer",
                );
            }
        }

        /// The review cone reaches its annotations by two different routes.
        /// With concurrent modelling off and no background apps it overlays a
        /// threshold-independent static table; otherwise it annotates the
        /// reconstructed rows inline. Either way the review performs the same
        /// annotation and cleaning steps, so both routes have to report them —
        /// a route that runs a step without reporting it makes the step's
        /// status invented rather than observed.
        #[test]
        fn a_review_reports_its_annotation_steps_on_both_annotation_paths() {
            for concurrent in [false, true] {
                let mut options = pipeline_options();
                options.model_concurrent_usage = concurrent;
                let mut engine = TrackedEngine::default();
                let review = engine
                    .execute(&csv(), &options, PipelineV2SupportFiles::default(), false)
                    .expect("cold review");
                for step in [
                    "join_app_codebook",
                    "derive_broad_category",
                    "collapse_app_genre",
                    "derive_engagement_basis",
                    "apply_episode_flags",
                    "suppress_excluded_timing",
                    "remove_selected_interaction_types",
                ] {
                    assert!(
                        review
                            .executed_queries
                            .iter()
                            .any(|reported| reported == step),
                        "review with concurrent={concurrent} never reported {step}: {:?}",
                        review.executed_queries,
                    );
                }
                assert_eq!(
                    review.executed_queries.len(),
                    review
                        .executed_queries
                        .iter()
                        .collect::<BTreeSet<_>>()
                        .len(),
                    "review with concurrent={concurrent} reported a step twice: {:?}",
                    review.executed_queries,
                );
            }
        }

        /// A session whose app is on the filter file is emitted as filtered app
        /// usage with its timing blanked, so it contributes no minutes to the
        /// review's per-app totals. The fused annotation pass that does the
        /// blanking only runs on the inline route, so check both routes against
        /// the sequential path, and prove the filter is doing something by
        /// comparing against the same review without it.
        #[test]
        fn a_review_blanks_filtered_usage_timing_on_both_annotation_paths() {
            // One filtered app and one ordinary app on the same day: the
            // ordinary session is what puts the day in the summary at all, and
            // the filtered session is the one whose minutes must not appear
            // beside it.
            let raw = concat!(
                "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago\n",
                "Study,P01,Target Child,Music,Activity Resumed,com.example.music,2026-03-07 10:10:00,America/Chicago\n",
                "Study,P01,Target Child,Music,Activity Paused,com.example.music,2026-03-07 10:20:00,America/Chicago\n",
            )
            .as_bytes();
            let filter = b"app_package_name\ncom.example.chat\n".to_vec();
            let study_dates =
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n".to_vec();
            let device_sharing = b"participant_id,sharing_status\nP01,Non-Shared\n".to_vec();
            let enrolled_devices = b"participant_id,device_count\nP01,1\n".to_vec();
            let support = PipelineV2SupportFiles {
                filter_csv: &filter,
                study_dates_csv: &study_dates,
                device_sharing_csv: &device_sharing,
                enrolled_devices_csv: &enrolled_devices,
                ..PipelineV2SupportFiles::default()
            };

            for concurrent in [false, true] {
                let mut filtered = pipeline_options();
                filtered.usage_session_mode = UsageSessionMode::AppUsage;
                filtered.model_concurrent_usage = concurrent;
                filtered.use_filter_file = true;
                let mut unfiltered = filtered.clone();
                unfiltered.use_filter_file = false;

                let mut engine = TrackedEngine::default();
                let review = engine
                    .execute(raw, &filtered, support, false)
                    .expect("review with the filter file");
                let plain = engine
                    .execute(raw, &unfiltered, support, false)
                    .expect("review without the filter file");
                assert_ne!(
                    review.result.review_summary_json_bytes, plain.result.review_summary_json_bytes,
                    "the filter file has to change the summary or this proves nothing \
                     (concurrent={concurrent})",
                );

                let summary =
                    String::from_utf8_lossy(&review.result.review_summary_json_bytes).into_owned();
                assert!(
                    summary.contains("com.example.music"),
                    "the ordinary session has to reach the summary (concurrent={concurrent}): \
                     {summary}",
                );
                assert!(
                    !summary.contains("com.example.chat"),
                    "the filtered session kept its minutes (concurrent={concurrent}): {summary}",
                );

                let oracle = run_pipeline_v2_with_supports(raw, &filtered, support)
                    .expect("sequential oracle for a filtered review");
                assert_eq!(
                    review.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                    "filtered usage timing survived into the review summary \
                     (concurrent={concurrent})",
                );
            }
        }

        /// A matcher-option edit can change the session a row belongs to. With
        /// concurrent modelling off, review annotations are carried on the
        /// pre-floor row table rather than rebuilt from reconstructed
        /// intervals, so that table has to be recognised as changed. If it is
        /// not, the annotations overlaid on the rebuilt rows are the ones the
        /// previous option produced.
        #[test]
        fn a_matcher_edit_that_changes_the_session_reaches_the_review_annotations() {
            let raw = concat!(
                "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 08:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 18:00:00,America/Chicago\n",
            )
            .as_bytes();
            let codebook = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Social,Communication,test\n".to_vec();
            let support = PipelineV2SupportFiles {
                codebook_csv: &codebook,
                ..PipelineV2SupportFiles::default()
            };

            let mut baseline = pipeline_options();
            baseline.usage_session_mode = UsageSessionMode::AppUsage;
            baseline.model_concurrent_usage = false;
            baseline.use_app_codebook = true;
            baseline.include_category_column = true;
            // Twelve hours: the ten-hour session below is a normal session.
            baseline.long_duration_threshold_ns = 43_200_000_000_000;
            let mut shortened = baseline.clone();
            // Six hours: the same session is now too long to have an observed
            // end, so the matcher reports it as end-of-usage-missing.
            shortened.long_duration_threshold_ns = 21_600_000_000_000;

            let mut engine = TrackedEngine::default();
            let long_threshold = engine
                .execute(raw, &baseline, support, false)
                .expect("review with the long threshold");
            let short_threshold = engine
                .execute(raw, &shortened, support, false)
                .expect("review with the short threshold");
            assert_ne!(
                long_threshold.result.review_summary_json_bytes,
                short_threshold.result.review_summary_json_bytes,
                "the threshold edit has to change the matcher result or it proves nothing",
            );

            let oracle = run_pipeline_v2_with_supports(raw, &shortened, support)
                .expect("sequential oracle for the shortened threshold");
            assert_eq!(
                short_threshold.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "the review cone kept annotations from the previous threshold",
            );
        }

        /// A review base exported while screen processing was on carries the
        /// classified screen sessions, so a resumed review reuses them instead
        /// of walking the screen state machine again. That reuse is only
        /// allowed while the settings that shaped those sessions are
        /// unchanged; after a screen-settings edit the sessions have to be
        /// rebuilt, and either way the answer has to match the sequential path.
        #[test]
        fn a_resumed_review_reuses_screen_sessions_only_while_their_settings_hold() {
            let support = PipelineV2SupportFiles::default();
            let mut baseline = pipeline_options();
            baseline.usage_session_mode = UsageSessionMode::AppAndScreenUsage;
            baseline.include_screen_output = true;

            let mut producer = TrackedEngine::default();
            producer
                .execute(&csv(), &baseline, support, true)
                .expect("produce a screen-bearing review base");
            let review_base = producer.export_review_base().expect("review base");

            let mut engine = TrackedEngine::default();
            let resumed = engine
                .execute_with_review_base(&csv(), &review_base, &baseline, support, false)
                .expect("resume from the review base");
            assert!(
                resumed
                    .internal_executed_queries
                    .iter()
                    .any(|query| query == "restore_review_screen"),
                "the exported base carried no reusable screen sessions: {:?}",
                resumed.internal_executed_queries
            );
            for step in [
                "classify_screen_sessions",
                "infer_screen_session_skeletons",
                "index_keyguard_events",
            ] {
                assert!(
                    !resumed
                        .executed_queries
                        .iter()
                        .any(|executed| executed == step),
                    "restored screen sessions were rebuilt anyway through {step}: {:?}",
                    resumed.executed_queries
                );
            }

            let mut edited = baseline.clone();
            edited.screen_auto_lock_timeout_seconds = 60.0;
            let rebuilt = engine
                .execute_with_review_base(&csv(), &review_base, &edited, support, false)
                .expect("resume after a screen-settings edit");
            assert!(
                rebuilt
                    .executed_queries
                    .iter()
                    .any(|step| step == "classify_screen_sessions"),
                "a screen-settings edit reused sessions built under the old settings: {:?}",
                rebuilt.executed_queries
            );

            let oracle = run_pipeline_v2_with_supports(&csv(), &edited, support)
                .expect("sequential oracle for an edited screen resume");
            assert_eq!(
                rebuilt.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "a resumed review drifted from the sequential path after a screen edit",
            );

            // Materializing the full outputs re-checks the same screen key in a
            // second place, so the saved sessions have to be accepted and
            // rejected there on exactly the same terms.
            for (label, options, expect_reuse) in [
                ("the settings that built them", &baseline, true),
                ("edited screen settings", &edited, false),
            ] {
                let mut full_engine = TrackedEngine::default();
                let full = full_engine
                    .execute_with_review_base(&csv(), &review_base, options, support, true)
                    .unwrap_or_else(|error| panic!("full run under {label}: {error}"));
                assert_eq!(
                    full.executed_queries
                        .iter()
                        .any(|step| step == "classify_screen_sessions"),
                    !expect_reuse,
                    "full run under {label} reported {:?}",
                    full.executed_queries,
                );
                let full_oracle = run_pipeline_v2_with_supports(&csv(), options, support)
                    .unwrap_or_else(|error| panic!("sequential oracle under {label}: {error}"));
                assert_eq!(
                    full.result.screen_csv_bytes, full_oracle.screen_csv_bytes,
                    "a full run under {label} drifted from the sequential screen output",
                );
            }
        }

        /// A warm engine reuses the digest it already verified for the raw
        /// bytes it holds. That shortcut is only sound while those really are
        /// the bytes in hand: reviewing a second file on the same engine has to
        /// re-identify it, or the second file is offered the first file's
        /// persisted bases and answered with the first file's rows.
        #[test]
        fn a_warm_engine_re_identifies_a_different_file_before_selecting_a_base() {
            let support = PipelineV2SupportFiles::default();
            let options = pipeline_options();
            let longer = {
                let mut bytes = csv().as_ref().clone();
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Resumed,com.example.mail,2026-03-07 10:02:00,America/Chicago\n",
                );
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Paused,com.example.mail,2026-03-07 10:03:00,America/Chicago\n",
                );
                bytes
            };

            let mut engine = TrackedEngine::default();
            engine
                .execute(&csv(), &options, support, true)
                .expect("process the first file");
            let review_base = engine.export_review_base().expect("review base");
            let reconstruction_base = engine
                .export_reconstruction_base()
                .expect("reconstruction base");

            let second = engine
                .execute_with_review_bases(
                    &longer,
                    &review_base,
                    &reconstruction_base,
                    &options,
                    support,
                    false,
                )
                .expect("review a second file on the warm engine");
            for query in ["restore_review_base", "restore_reconstruction_base"] {
                assert!(
                    !second
                        .internal_executed_queries
                        .iter()
                        .any(|executed| executed == query),
                    "a second file was served the first file's base through {query}: {:?}",
                    second.internal_executed_queries,
                );
            }
            let oracle = run_pipeline_v2_with_supports(&longer, &options, support)
                .expect("sequential oracle for the second file");
            assert_eq!(
                second.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                "the warm engine answered the second file with the first file's rows",
            );
        }

        /// The app CSV's codebook alias columns are decided by the codebook
        /// settings alone. Cover every combination that can move that decision
        /// — codebook off, codebook on with nothing in it, codebook on with a
        /// match, and the category column either way — against the sequential
        /// path, so the incremental output path cannot decide the header
        /// differently from the engine that defines it.
        #[test]
        fn a_full_run_writes_the_same_app_columns_as_the_sequential_path() {
            let header = "app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\n";
            let populated_codebook =
                format!("{header}com.example.chat,Chat,Social,Communication,test\n").into_bytes();
            let empty_codebook = header.as_bytes().to_vec();

            for use_app_codebook in [false, true] {
                for include_category_column in [false, true] {
                    for populated in [false, true] {
                        let codebook: &[u8] = if populated {
                            &populated_codebook
                        } else {
                            &empty_codebook
                        };
                        let support = PipelineV2SupportFiles {
                            codebook_csv: codebook,
                            ..PipelineV2SupportFiles::default()
                        };
                        let mut options = pipeline_options();
                        options.usage_session_mode = UsageSessionMode::AppUsage;
                        options.include_app_output = true;
                        options.use_app_codebook = use_app_codebook;
                        options.include_category_column = include_category_column;

                        let mut engine = TrackedEngine::default();
                        let tracked = engine
                            .execute(&csv(), &options, support, true)
                            .expect("full run");
                        let oracle = run_pipeline_v2_with_supports(&csv(), &options, support)
                            .expect("sequential oracle for the app output");
                        assert_eq!(
                            tracked.result.app_csv_bytes, oracle.app_csv_bytes,
                            "app output drifted with codebook={use_app_codebook} \
                             category={include_category_column} populated={populated}",
                        );
                    }
                }
            }
        }

        /// Each persisted base has a one-entry decode cache. Reviewing a
        /// second file right after a first one is the ordinary browser
        /// sequence, so a decode request for a different base has to return
        /// that base — never the rows still sitting in the cache.
        #[test]
        fn a_base_decode_never_returns_the_previous_file() {
            let support = PipelineV2SupportFiles::default();
            let options = pipeline_options();
            let longer = {
                let mut bytes = csv().as_ref().clone();
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Resumed,com.example.mail,2026-03-07 10:02:00,America/Chicago\n",
                );
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Paused,com.example.mail,2026-03-07 10:03:00,America/Chicago\n",
                );
                Arc::new(bytes)
            };

            let export = |raw: &[u8]| {
                let mut engine = TrackedEngine::default();
                engine
                    .execute(raw, &options, support, true)
                    .expect("export execute");
                (
                    engine.export_review_base().expect("review base"),
                    engine
                        .export_reconstruction_base()
                        .expect("reconstruction base"),
                )
            };
            let (short_review, short_reconstruction) = export(&csv());
            let (long_review, long_reconstruction) = export(&longer);

            REVIEW_BASE_DECODE_CACHE.with(|cache| cache.borrow_mut().take());
            let short_rows = decode_review_base_cached(&short_review).unwrap().rows.len();
            let long_rows = decode_review_base_cached(&long_review).unwrap().rows.len();
            assert!(
                long_rows > short_rows,
                "the two fixtures have to produce different review bases",
            );
            assert_eq!(
                decode_review_base_cached(&short_review).unwrap().rows.len(),
                short_rows,
                "the review-base decode came back with the other file's rows",
            );

            RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| cache.borrow_mut().take());
            let short_rows = decode_reconstruction_base_cached(&short_reconstruction)
                .unwrap()
                .rows
                .len();
            let long_rows = decode_reconstruction_base_cached(&long_reconstruction)
                .unwrap()
                .rows
                .len();
            assert!(
                long_rows > short_rows,
                "the two fixtures have to produce different reconstruction bases",
            );
            assert_eq!(
                decode_reconstruction_base_cached(&short_reconstruction)
                    .unwrap()
                    .rows
                    .len(),
                short_rows,
                "the reconstruction-base decode came back with the other file's rows",
            );
        }

        /// Salsa decides whether a recomputed value may be backdated by
        /// comparing it with the previous one, so these four hand-written
        /// `PartialEq` impls are the only thing standing between a warm review
        /// and rows built from a different persisted base or a different
        /// upstream table. `DecodedReviewBase::eq` compares nothing but
        /// `encoded_digest`: report two different bases equal and Salsa
        /// backdates `decoded_review_base` after recomputing it from other
        /// bytes, so a review resumed against workspace base B keeps the rows
        /// reconstructed from base A. Each impl therefore has to separate two
        /// values whose identity differs - varied one field at a time, since a
        /// widened `||` would let any single equal field decide the answer -
        /// and still recognise an unchanged value, which is what earns the
        /// reuse.
        #[test]
        fn the_review_cone_equalities_separate_two_different_values() {
            let support = PipelineV2SupportFiles::default();
            let options = pipeline_options();
            let longer = {
                let mut bytes = csv().as_ref().clone();
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Resumed,com.example.mail,2026-03-07 10:02:00,America/Chicago\n",
                );
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Mail,Activity Paused,com.example.mail,2026-03-07 10:03:00,America/Chicago\n",
                );
                Arc::new(bytes)
            };
            let export = |raw: &[u8]| {
                let mut engine = TrackedEngine::default();
                engine
                    .execute(raw, &options, support, true)
                    .expect("export execute");
                (
                    engine.export_review_base().expect("review base"),
                    engine
                        .export_reconstruction_base()
                        .expect("reconstruction base"),
                )
            };
            let (short_review, short_reconstruction) = export(&csv());
            let (long_review, long_reconstruction) = export(&longer);

            // Built exactly the way `decoded_review_base` and
            // `decoded_reconstruction_base` build the values Salsa compares.
            let decoded_review = |bytes: &[u8]| {
                let digest_offset = REVIEW_BASE_MAGIC.len() + 4;
                DecodedReviewBase {
                    encoded_digest: bytes[digest_offset..digest_offset + 32]
                        .try_into()
                        .expect("32-byte review-base payload digest"),
                    value: decode_review_base_cached(bytes).expect("decode review base"),
                }
            };
            let decoded_reconstruction = |bytes: &[u8]| DecodedReconstructionBase {
                encoded_digest: *blake3::hash(&bytes[..RECONSTRUCTION_BASE_HEADER_BYTES])
                    .as_bytes(),
                value: decode_reconstruction_base_cached(bytes)
                    .expect("decode reconstruction base"),
            };
            assert_ne!(
                decoded_review(&short_review),
                decoded_review(&long_review),
                "two persisted review bases with different payload digests compared equal, so a \
                 warm review would keep the rows reconstructed from the other file",
            );
            assert_eq!(
                decoded_review(&short_review),
                decoded_review(&short_review),
                "one persisted review base compared unequal to itself, which costs the reuse",
            );
            assert_ne!(
                decoded_reconstruction(&short_reconstruction),
                decoded_reconstruction(&long_reconstruction),
                "two persisted reconstruction bases with different header digests compared equal",
            );
            assert_eq!(
                decoded_reconstruction(&short_reconstruction),
                decoded_reconstruction(&short_reconstruction),
                "one persisted reconstruction base compared unequal to itself",
            );

            let checkpoint = |node: &str, terminal: &str| WorkflowCheckpoint {
                protocol_version: "chronicle-workflow-checkpoint/v6".into(),
                subject_id: node.into(),
                row_membership_digest: "sha256:membership".into(),
                row_order_digest: "sha256:order".into(),
                temporal_state_digest: "sha256:temporal".into(),
                classification_digest: "sha256:classification".into(),
                payload_digest: "sha256:payload".into(),
                schema_digest: "sha256:schema".into(),
                terminal_digest: terminal.into(),
            };
            let before_floor =
                |terminal: &str, floor: &[u32], filtered: &[&str]| ReviewUsageRowsBeforeFloor {
                    rows: Arc::new(Vec::new()),
                    floor_candidate_indices: Arc::new(floor.to_vec()),
                    filtered_packages: Arc::new(
                        filtered
                            .iter()
                            .map(|package| (*package).to_string())
                            .collect::<BTreeSet<String>>(),
                    ),
                    checkpoint: checkpoint("review_usage_rows_before_floor", terminal),
                    temporal_sequence: CanonicalTemporalSequence {
                        encoded_rows: Arc::new(Vec::new()),
                        canonical_positions: Arc::new(Vec::new()),
                    },
                };
            let baseline = before_floor("sha256:before-floor", &[0, 1], &["com.example.junk"]);
            assert!(
                baseline == before_floor("sha256:before-floor", &[0, 1], &["com.example.junk"]),
                "an unchanged before-floor table compared unequal to itself, which is the reuse \
                 a matcher-config edit that leaves the result alone is supposed to keep",
            );
            for (field, other) in [
                (
                    "its rows checkpoint",
                    before_floor("sha256:other", &[0, 1], &["com.example.junk"]),
                ),
                (
                    "its floor candidates",
                    before_floor("sha256:before-floor", &[0], &["com.example.junk"]),
                ),
                (
                    "its filtered packages",
                    before_floor("sha256:before-floor", &[0, 1], &["com.example.other"]),
                ),
            ] {
                assert!(
                    baseline != other,
                    "two before-floor tables differing in {field} compared equal, so the duration \
                     floor would be applied to the other table's rows",
                );
            }

            let static_annotations = |input_key: &str| ReviewStaticAnnotations {
                rows: Arc::new(Vec::new()),
                input_key: input_key.into(),
                checkpoint: checkpoint("review_static_annotations", "sha256:static"),
            };
            assert!(
                static_annotations("blake3:aa") == static_annotations("blake3:aa"),
                "an unchanged static-annotation table compared unequal to itself",
            );
            assert!(
                static_annotations("blake3:aa") != static_annotations("blake3:bb"),
                "two static-annotation tables built from different inputs compared equal, so the \
                 annotation columns of the other input would be overlaid onto these rows",
            );
        }

        /// Both row-removing options are reported as product counts. A raw
        /// export that carries an exact duplicate row and a session that opens
        /// and closes at the same instant has to keep or lose those rows
        /// exactly as the two options say, in either direction.
        #[test]
        fn the_row_removing_options_decide_whether_a_row_survives() {
            let raw = concat!(
                "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:04:00,America/Chicago\n",
            )
            .as_bytes();
            let support = PipelineV2SupportFiles::default();
            let mut options = pipeline_options();
            options.usage_session_mode = UsageSessionMode::AppUsage;
            options.include_app_output = true;
            // Nudging tied timestamps apart would give the paired session a
            // one-nanosecond duration, which is not a zero-duration session.
            options.correct_duplicate_event_timestamps = false;

            let run = |deduplicate: bool, drop_zero: bool| {
                let mut options = options.clone();
                options.deduplicate_exact_rows = deduplicate;
                options.filter_zero_duration_sessions = drop_zero;
                TrackedEngine::default()
                    .execute(raw, &options, support, true)
                    .expect("row-removing options execute")
                    .result
            };

            let kept = run(false, false);
            assert_eq!(
                kept.exact_duplicate_rows_removed, 0,
                "dedupe was off and still removed rows",
            );

            let deduped = run(true, false);
            assert_eq!(
                deduped.exact_duplicate_rows_removed, 1,
                "the repeated Activity Resumed row was not recognised as an exact duplicate",
            );
            assert_eq!(
                deduped.processed_row_count + 1,
                kept.processed_row_count,
                "dedupe reported a removal it did not make",
            );

            let dropped = run(true, true);
            assert_eq!(
                dropped.app_row_count + 1,
                deduped.app_row_count,
                "the session that opened and closed at one instant survived the zero-duration filter",
            );
        }

        /// `rows_step_reusing` may hand a step's consumers the upstream row
        /// allocation, but only when the step left every row alone. A step
        /// that drops rows publishes a shorter table, and handing back the
        /// upstream table would silently undo the drop while still reporting
        /// a checkpoint that claims nothing changed.
        #[test]
        fn a_step_that_drops_rows_never_publishes_the_upstream_table() {
            let rows = checkpoint_rows();
            assert!(rows.len() >= 3, "the fixture must have rows to drop");
            let upstream = QueryValue {
                value: Arc::new(rows.clone()),
                checkpoint: workflow_rows_checkpoint("upstream", &rows),
                query_group_checkpoint: None,
            };

            let unchanged = rows_step_reusing("probe", &upstream, rows.clone());
            assert!(
                Arc::ptr_eq(&unchanged.value, &upstream.value),
                "a step that changed nothing has to reuse the upstream rows",
            );

            // Drop the last row. Every surviving row is still the same `Arc`,
            // so the row count is the only thing saying the step did anything.
            let mut shorter = rows.clone();
            shorter.pop();
            let dropped = rows_step_reusing("probe", &upstream, shorter.clone());
            assert_eq!(
                dropped.value.len(),
                shorter.len(),
                "the dropped row came back in the published table",
            );
            assert_eq!(
                dropped.checkpoint,
                workflow_rows_checkpoint("probe", &shorter),
                "a shorter table has to carry the checkpoint of that table",
            );
        }

        /// A threshold edit moves the temporal columns of a handful of rows and
        /// leaves identity and classification alone, so the temporal digest is
        /// patched in place rather than rebuilt from every row. The patched
        /// value is only usable because it is the same digest an ordinary full
        /// checkpoint of those rows produces.
        #[test]
        fn patching_changed_rows_reproduces_a_full_temporal_checkpoint() {
            let mut rows = checkpoint_rows();
            assert!(rows.len() >= 4, "the fixture must have rows to patch");
            let order = canonical_row_order(&rows);
            let base = canonical_temporal_sequence_with_order(&rows, &order);
            let unpatched = temporal_digest_with_changed_rows(&base, &rows, &[]);
            assert_eq!(
                unpatched,
                workflow_rows_checkpoint("probe", &rows).temporal_state_digest,
                "patching nothing has to reproduce the digest the sequence was built from",
            );

            let changed: Vec<u32> = vec![1, 3];
            for &row_index in &changed {
                let data = rows[row_index as usize].edit_temporal();
                data.duration_seconds = Some(data.duration_seconds.unwrap_or_default() + 5.0);
                data.duration_minutes = Some(data.duration_minutes.unwrap_or_default() + 0.0834);
            }
            let patched = temporal_digest_with_changed_rows(&base, &rows, &changed);
            assert_ne!(
                patched, unpatched,
                "a temporal edit has to move the temporal digest",
            );
            assert_eq!(
                patched,
                workflow_rows_checkpoint("probe", &rows).temporal_state_digest,
                "the patched digest has to equal a full checkpoint of the same rows",
            );
        }

        fn assert_result_parity(
            actual: &PipelineV2Result,
            expected: &PipelineV2Result,
            mode: UsageSessionMode,
        ) {
            let aggregate_signature = |outputs: &[aggregates::AggregateCsvOutput]| {
                outputs
                    .iter()
                    .map(|output| {
                        (
                            output.kind.clone(),
                            output.row_count,
                            format!("sha256:{}", hex::encode(Sha256::digest(&output.bytes))),
                        )
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(
                aggregate_signature(&actual.aggregate_csv_outputs),
                aggregate_signature(&expected.aggregate_csv_outputs),
                "aggregate differences for {mode:?}"
            );
            let byte_signature =
                |bytes: &[u8]| format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
            assert_eq!(
                [
                    ("app_csv", byte_signature(&actual.app_csv_bytes)),
                    ("screen_csv", byte_signature(&actual.screen_csv_bytes)),
                    (
                        "day_coverage_csv",
                        byte_signature(&actual.day_coverage_csv_bytes),
                    ),
                    (
                        "compliance_csv",
                        byte_signature(&actual.compliance_csv_bytes),
                    ),
                    (
                        "credited_app_csv",
                        byte_signature(&actual.credited_app_csv_bytes),
                    ),
                    (
                        "review_summary_json",
                        byte_signature(&actual.review_summary_json_bytes),
                    ),
                    (
                        "visualization_data_json",
                        byte_signature(&actual.visualization_data_json_bytes),
                    ),
                    (
                        "row_lineage",
                        byte_signature(&serde_json::to_vec(&actual.row_lineage).unwrap()),
                    ),
                ],
                [
                    ("app_csv", byte_signature(&expected.app_csv_bytes)),
                    ("screen_csv", byte_signature(&expected.screen_csv_bytes)),
                    (
                        "day_coverage_csv",
                        byte_signature(&expected.day_coverage_csv_bytes),
                    ),
                    (
                        "compliance_csv",
                        byte_signature(&expected.compliance_csv_bytes),
                    ),
                    (
                        "credited_app_csv",
                        byte_signature(&expected.credited_app_csv_bytes),
                    ),
                    (
                        "review_summary_json",
                        byte_signature(&expected.review_summary_json_bytes),
                    ),
                    (
                        "visualization_data_json",
                        byte_signature(&expected.visualization_data_json_bytes),
                    ),
                    (
                        "row_lineage",
                        byte_signature(&serde_json::to_vec(&expected.row_lineage).unwrap()),
                    ),
                ],
                "terminal output differences for {mode:?}"
            );
            assert_checkpoint_parity(
                "step",
                &actual.workflow_query_checkpoints,
                &expected.workflow_query_checkpoints,
                mode,
            );
            assert_checkpoint_parity(
                "query group",
                &actual.workflow_query_group_checkpoints,
                &expected.workflow_query_group_checkpoints,
                mode,
            );
            assert_eq!(actual.app_csv_bytes, expected.app_csv_bytes);
            assert_eq!(actual.screen_csv_bytes, expected.screen_csv_bytes);
            assert_eq!(
                actual.day_coverage_csv_bytes,
                expected.day_coverage_csv_bytes
            );
            assert_eq!(actual.compliance_csv_bytes, expected.compliance_csv_bytes);
            assert_eq!(
                actual.credited_app_csv_bytes,
                expected.credited_app_csv_bytes
            );
            assert_eq!(
                actual.review_summary_json_bytes,
                expected.review_summary_json_bytes
            );
            assert_eq!(
                actual.visualization_data_json_bytes,
                expected.visualization_data_json_bytes
            );
            assert_eq!(actual.row_lineage, expected.row_lineage);
            assert_eq!(actual.original_row_count, expected.original_row_count);
            assert_eq!(actual.processed_row_count, expected.processed_row_count);
            assert_eq!(actual.app_row_count, expected.app_row_count);
            assert_eq!(actual.screen_row_count, expected.screen_row_count);
            assert_eq!(
                actual.day_coverage_row_count,
                expected.day_coverage_row_count
            );
            assert_eq!(actual.compliance_row_count, expected.compliance_row_count);
            assert_eq!(
                actual.credited_app_row_count,
                expected.credited_app_row_count
            );
            assert_eq!(
                actual.duplicate_timestamps_corrected,
                expected.duplicate_timestamps_corrected
            );
            assert_eq!(
                actual.exact_duplicate_rows_removed,
                expected.exact_duplicate_rows_removed
            );
            assert_eq!(actual.available_timezones, expected.available_timezones);
            assert_eq!(actual.timezone, expected.timezone);
            assert_eq!(actual.timezone_action, expected.timezone_action);
            assert_eq!(
                actual.timezone_retained_source_rows_digest,
                expected.timezone_retained_source_rows_digest
            );
            assert_eq!(actual.timezone_stage_digest, expected.timezone_stage_digest);
        }

        #[test]
        fn stateful_engine_matches_oracle_across_usage_applicability_modes() {
            let modes = [
                UsageSessionMode::NoUsage,
                UsageSessionMode::AppUsage,
                UsageSessionMode::ScreenUsage,
                UsageSessionMode::AppAndScreenUsage,
            ];
            for mode in modes {
                let mut options = pipeline_options();
                options.usage_session_mode = mode;
                options.include_app_output = true;
                options.include_screen_output = true;
                let support = PipelineV2SupportFiles::default();
                let expected = run_pipeline_v2_with_supports(&csv(), &options, support).unwrap();
                let mut engine = TrackedEngine::default();
                let actual = engine.execute(&csv(), &options, support, true).unwrap();
                assert_result_parity(&actual.result, &expected, mode);
            }
        }

        /// The warm engine reuses a tracked value whenever the value's own
        /// equality says nothing consumers can see has changed. Two failures
        /// hide behind that: an equality that is too permissive keeps a stale
        /// value after a real edit, and one that is too strict throws away work
        /// that was still valid. Both are invisible to a single-run test.
        ///
        /// This drives one engine through every option a researcher can move,
        /// and after each move checks the two properties that pin the equality
        /// from both sides:
        ///
        /// 1. the warm result is byte-identical to a cold engine's, so no stale
        ///    value survived the edit; and
        /// 2. repeating the same request executes nothing at all, so nothing
        ///    valid was discarded.
        ///
        /// Each edit is then reverted and checked the same way, because
        /// returning to a value the engine has already seen is exactly where a
        /// backdating decision is made.
        #[test]
        fn every_option_edit_keeps_warm_results_exact_and_repeat_requests_free() {
            let study_dates =
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n".to_vec();
            let device_sharing = b"participant_id,sharing_status\nP01,Shared\n".to_vec();
            let survey_attribution =
                b"participant_id,event_timestamp,users\nP01,2026-03-07 10:00:00,Target Child\n"
                    .to_vec();
            let enrolled_devices = b"participant_id,device_count\nP01,1\n".to_vec();
            let filter = b"app_package_name\ncom.example.chat\n".to_vec();
            let apps_forcing = b"package_name\ncom.example.chat\n".to_vec();
            let background_apps = b"app_package_name\ncom.example.chat\n".to_vec();
            let codebook = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Social,Communication,test\n".to_vec();
            let support = PipelineV2SupportFiles {
                filter_csv: &filter,
                apps_forcing_csv: &apps_forcing,
                background_apps_csv: &background_apps,
                codebook_csv: &codebook,
                study_dates_csv: &study_dates,
                device_sharing_csv: &device_sharing,
                survey_attribution_csv: &survey_attribution,
                enrolled_devices_csv: &enrolled_devices,
            };

            let mut baseline = late_pipeline_options();
            baseline.use_filter_file = true;
            baseline.use_apps_forcing_screen_open = true;
            baseline.use_background_apps_file = true;
            baseline.use_app_codebook = true;
            baseline.include_app_output = true;
            baseline.include_screen_output = true;
            baseline.include_category_column = true;
            baseline.enable_aggregates = true;
            baseline.model_concurrent_usage = true;
            baseline.minimum_usage_duration = 30.0;
            let baseline = baseline;

            type Edit = (&'static str, Box<dyn Fn(&mut PipelineV2Options)>);
            let edits: Vec<Edit> = vec![
                (
                    "study_name",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.study_name = "Edited study".into()
                    }),
                ),
                (
                    "timezone",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.timezone = "America/New_York".into()
                    }),
                ),
                (
                    "timezone_handling",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.timezone_handling = "primary-convert".into()
                    }),
                ),
                (
                    "usage_session_mode",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.usage_session_mode = UsageSessionMode::AppUsage
                    }),
                ),
                (
                    "include_screen_output",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.include_screen_output = false
                    }),
                ),
                (
                    "use_filter_file",
                    Box::new(|options: &mut PipelineV2Options| options.use_filter_file = false),
                ),
                (
                    "use_apps_forcing_screen_open",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.use_apps_forcing_screen_open = false
                    }),
                ),
                (
                    "use_background_apps_file",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.use_background_apps_file = false
                    }),
                ),
                (
                    "use_app_codebook",
                    Box::new(|options: &mut PipelineV2Options| options.use_app_codebook = false),
                ),
                (
                    "include_category_column",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.include_category_column = false
                    }),
                ),
                (
                    "deduplicate_exact_rows",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.deduplicate_exact_rows = false
                    }),
                ),
                (
                    "interaction_type_remap",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.interaction_type_remap =
                            vec!["User Interaction=Activity Resumed".into()]
                    }),
                ),
                (
                    "correct_duplicate_event_timestamps",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.correct_duplicate_event_timestamps = false
                    }),
                ),
                (
                    "allow_stop_event_reuse",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.allow_stop_event_reuse = true
                    }),
                ),
                (
                    "use_activity_stopped_as_fallback",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.use_activity_stopped_as_fallback = false
                    }),
                ),
                (
                    "apply_threshold_to_fallback",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.apply_threshold_to_fallback = false
                    }),
                ),
                (
                    "long_duration_threshold_ns",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.long_duration_threshold_ns = 21_600_000_000_000
                    }),
                ),
                (
                    "proximity_interval_ns",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.proximity_interval_ns = 2_000_000_000
                    }),
                ),
                (
                    "same_app_stop_types",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.same_app_stop_types = vec!["Activity Paused".into()]
                    }),
                ),
                (
                    "other_stop_types",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.other_stop_types = vec!["Device Shutdown".into()]
                    }),
                ),
                (
                    "interaction_types_to_remove",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.interaction_types_to_remove = vec!["User Interaction".into()]
                    }),
                ),
                (
                    "custom_app_engagement_duration",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.custom_app_engagement_duration = 45.0
                    }),
                ),
                (
                    "long_data_time_gap_thresholds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.long_data_time_gap_thresholds = vec![0.25, 2.0]
                    }),
                ),
                (
                    "long_usage_duration_thresholds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.long_usage_duration_thresholds = vec![0.5]
                    }),
                ),
                (
                    "model_concurrent_usage",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.model_concurrent_usage = false
                    }),
                ),
                (
                    "minimum_usage_duration",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.minimum_usage_duration = 90.0
                    }),
                ),
                (
                    "apply_minimum_usage_duration_to_concurrent_subintervals",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.apply_minimum_usage_duration_to_concurrent_subintervals = true
                    }),
                ),
                (
                    "filter_zero_duration_sessions",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.filter_zero_duration_sessions = true
                    }),
                ),
                (
                    "screen_auto_lock_timeout_seconds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.screen_auto_lock_timeout_seconds = 45.0
                    }),
                ),
                (
                    "screen_auto_lock_tolerance_seconds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.screen_auto_lock_tolerance_seconds = 5.0
                    }),
                ),
                (
                    "screen_manual_lock_max_tail_seconds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.screen_manual_lock_max_tail_seconds = 5.0
                    }),
                ),
                (
                    "screen_keyguard_near_stop_seconds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.screen_keyguard_near_stop_seconds = 10.0
                    }),
                ),
                (
                    "enable_screen_gated_crediting",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.enable_screen_gated_crediting = false
                    }),
                ),
                (
                    "credited_session_cap_minutes",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.credited_session_cap_minutes = 5.0
                    }),
                ),
                (
                    "device_liveness_gap_tolerance_minutes",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.device_liveness_gap_tolerance_minutes = 1.0
                    }),
                ),
                (
                    "auto_lock_bridge_seconds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.auto_lock_bridge_seconds = 5.0
                    }),
                ),
                (
                    "no_witness_min_day_apps",
                    Box::new(|options: &mut PipelineV2Options| options.no_witness_min_day_apps = 1),
                ),
                (
                    "enable_study_window_filter",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.enable_study_window_filter = false
                    }),
                ),
                (
                    "enable_person_attribution",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.enable_person_attribution = false
                    }),
                ),
                (
                    "add_no_activity_placeholder_days",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.add_no_activity_placeholder_days = false
                    }),
                ),
                (
                    "enable_day_coverage",
                    Box::new(|options: &mut PipelineV2Options| options.enable_day_coverage = false),
                ),
                (
                    "enable_compliance_scoring",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.enable_compliance_scoring = false
                    }),
                ),
                (
                    "compliance_threshold_percent",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.compliance_threshold_percent = 20.0
                    }),
                ),
                (
                    "enable_aggregates",
                    Box::new(|options: &mut PipelineV2Options| options.enable_aggregates = false),
                ),
                (
                    "aggregate_shape",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.aggregate_shape = "long".into()
                    }),
                ),
                (
                    "materialize_visualization_data",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.materialize_visualization_data = false
                    }),
                ),
                (
                    "datetime_of_preprocessing",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.datetime_of_preprocessing = "2026-07-24 00:00:00 UTC".into()
                    }),
                ),
            ];

            let check = |engine: &mut TrackedEngine,
                         options: &PipelineV2Options,
                         full: bool,
                         label: &str| {
                let warm = engine.execute(&csv(), options, support, full).unwrap();
                let mut cold = TrackedEngine::default();
                let expected = cold.execute(&csv(), options, support, full).unwrap();
                assert_result_parity(&warm.result, &expected.result, options.usage_session_mode);

                // Two engines running the same query graph agree even when the
                // graph is wrong, so the full-output result is also checked
                // against the sequential path, which computes the same registered queries
                // through separate code.
                let oracle = run_pipeline_v2_with_supports(&csv(), options, support)
                    .unwrap_or_else(|error| panic!("{label}: sequential oracle: {error}"));
                if full {
                    assert_result_parity(&warm.result, &oracle, options.usage_session_mode);
                } else {
                    // Review mode is a different cone that produces one artifact:
                    // the summary. That is what the sequential path is compared
                    // against, so a review-only value that goes stale is caught.
                    assert_eq!(
                        warm.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                        "{label}: review summary differs from the sequential path",
                    );
                }

                let repeat = engine.execute(&csv(), options, support, full).unwrap();
                assert!(
                    repeat.executed_queries.is_empty()
                        && repeat.internal_executed_queries.is_empty(),
                    "{label}: repeating an unchanged request reran {:?} / {:?}",
                    repeat.executed_queries,
                    repeat.internal_executed_queries,
                );
                assert_result_parity(&repeat.result, &expected.result, options.usage_session_mode);
            };

            // Full output and review are different physical cones: review runs
            // the fused annotation/reconstruction path and its content-committing
            // checkpoints, which the full path never touches. Concurrent
            // modelling splits the review cone again: with it off, annotation
            // columns are carried on the prepared row table instead of being
            // rebuilt from reconstructed intervals. Every combination has to
            // hold the same two properties, so the sweep runs over all four.
            for concurrent in [true, false] {
                let mut baseline = baseline.clone();
                baseline.model_concurrent_usage = concurrent;
                let baseline = baseline;
                for full in [true, false] {
                    let mut engine = TrackedEngine::default();
                    let suffix = format!("full={full} concurrent={concurrent}");
                    check(&mut engine, &baseline, full, &format!("baseline {suffix}"));
                    for (label, edit) in &edits {
                        let mut changed = baseline.clone();
                        edit(&mut changed);
                        check(&mut engine, &changed, full, &format!("{label} {suffix}"));
                        check(
                            &mut engine,
                            &baseline,
                            full,
                            &format!("{label} reverted {suffix}"),
                        );
                    }
                }
            }
        }

        /// Salsa backdates: when a re-executed query produces a value equal to
        /// the one it produced last revision, its dependents keep their cached
        /// results. That is the entire job of the review cone's `PartialEq`
        /// implementations, and an equality that reports "changed" for an equal
        /// value is invisible to any result comparison — the value it forces to
        /// be recomputed is correct. It shows up only as work the engine did
        /// not need to do.
        ///
        /// Every option moved below belongs to the full-output cone: the
        /// aggregate tables, day coverage, compliance scoring, the
        /// visualisation payload, the optional output column and the two output
        /// toggles. A review run produces one artifact, the summary, and none
        /// of them can reach it — so moving one has to leave the whole review
        /// cone cached, not merely produce the same bytes again.
        #[test]
        fn a_review_holds_its_cone_across_options_its_summary_cannot_depend_on() {
            let study_dates =
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n".to_vec();
            let device_sharing = b"participant_id,sharing_status\nP01,Shared\n".to_vec();
            let survey_attribution =
                b"participant_id,event_timestamp,users\nP01,2026-03-07 10:00:00,Target Child\n"
                    .to_vec();
            let enrolled_devices = b"participant_id,device_count\nP01,1\n".to_vec();
            let filter = b"app_package_name\ncom.example.chat\n".to_vec();
            let apps_forcing = b"package_name\ncom.example.chat\n".to_vec();
            let background_apps = b"app_package_name\ncom.example.chat\n".to_vec();
            let codebook = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Social,Communication,test\n".to_vec();
            let support = PipelineV2SupportFiles {
                filter_csv: &filter,
                apps_forcing_csv: &apps_forcing,
                background_apps_csv: &background_apps,
                codebook_csv: &codebook,
                study_dates_csv: &study_dates,
                device_sharing_csv: &device_sharing,
                survey_attribution_csv: &survey_attribution,
                enrolled_devices_csv: &enrolled_devices,
            };

            // (label, edit, the steps the edit's own query may recompute)
            type Edit = (
                &'static str,
                Box<dyn Fn(&mut PipelineV2Options)>,
                &'static [&'static str],
            );
            let edits: Vec<Edit> = vec![
                (
                    "enable_aggregates",
                    Box::new(|options: &mut PipelineV2Options| options.enable_aggregates = false),
                    &[],
                ),
                (
                    "aggregate_shape",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.aggregate_shape = "long".into()
                    }),
                    &[],
                ),
                (
                    "enable_day_coverage",
                    Box::new(|options: &mut PipelineV2Options| options.enable_day_coverage = false),
                    &[],
                ),
                (
                    "enable_compliance_scoring",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.enable_compliance_scoring = false
                    }),
                    &[],
                ),
                (
                    "compliance_threshold_percent",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.compliance_threshold_percent = 20.0
                    }),
                    &[],
                ),
                (
                    "materialize_visualization_data",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.materialize_visualization_data = false
                    }),
                    &[],
                ),
                (
                    "include_category_column",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.include_category_column = false
                    }),
                    &[],
                ),
                (
                    "include_app_output",
                    Box::new(|options: &mut PipelineV2Options| options.include_app_output = false),
                    &[],
                ),
                (
                    "include_screen_output",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.include_screen_output = false
                    }),
                    &[],
                ),
                // These four the review cone does read. This data makes every
                // move inert: no session comes near a thirty-second floor or a
                // multi-hour cap, and the engagement and threshold lists only
                // label rows the summary never reports. A cone step that
                // re-runs here produced a value equal to the one it already
                // had and failed to say so.
                (
                    "minimum_usage_duration",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.minimum_usage_duration = 31.0
                    }),
                    &[
                        "classify_episode_durations",
                        "apply_app_inclusion_policy",
                        "order_app_episodes",
                    ],
                ),
                (
                    "long_duration_threshold_ns",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.long_duration_threshold_ns = 13 * 3_600_000_000_000
                    }),
                    &["match_app_episodes"],
                ),
                (
                    "custom_app_engagement_duration",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.custom_app_engagement_duration = 900.0
                    }),
                    &[
                        "join_app_codebook",
                        "derive_broad_category",
                        "collapse_app_genre",
                        "derive_engagement_basis",
                        "apply_episode_flags",
                        "suppress_excluded_timing",
                        "remove_selected_interaction_types",
                        "resolve_participant_windows",
                        "apply_participant_windows",
                    ],
                ),
                (
                    "long_usage_duration_thresholds",
                    Box::new(|options: &mut PipelineV2Options| {
                        options.long_usage_duration_thresholds = vec![7.0, 9.0]
                    }),
                    &[
                        "join_app_codebook",
                        "derive_broad_category",
                        "collapse_app_genre",
                        "derive_engagement_basis",
                        "apply_episode_flags",
                        "suppress_excluded_timing",
                        "remove_selected_interaction_types",
                        "resolve_participant_windows",
                        "apply_participant_windows",
                    ],
                ),
            ];

            // `assemble_result_manifest` reads the option record itself to decide which
            // artifacts to hand back, so it re-runs for any option at all. It
            // is the one step that legitimately does; everything upstream of it
            // is the cone this test is about.
            fn cone_work(steps: &[String]) -> Vec<&str> {
                steps
                    .iter()
                    .map(String::as_str)
                    .filter(|step| *step != "assemble_result_manifest")
                    .collect()
            }

            for concurrent in [false, true] {
                let mut baseline = late_pipeline_options();
                baseline.use_filter_file = true;
                baseline.use_apps_forcing_screen_open = true;
                baseline.use_background_apps_file = true;
                baseline.use_app_codebook = true;
                baseline.include_app_output = true;
                baseline.include_screen_output = true;
                baseline.include_category_column = true;
                baseline.enable_aggregates = true;
                baseline.model_concurrent_usage = concurrent;
                baseline.minimum_usage_duration = 30.0;
                let baseline = baseline;

                let mut engine = TrackedEngine::default();
                let cold = engine
                    .execute(&csv(), &baseline, support, false)
                    .expect("cold review");
                let summary = cold.result.review_summary_json_bytes.clone();
                assert!(
                    !cold.executed_queries.is_empty(),
                    "concurrent={concurrent}: the cold review executed nothing"
                );

                for (label, edit, recomputes) in &edits {
                    let mut changed = baseline.clone();
                    edit(&mut changed);
                    let warm = engine
                        .execute(&csv(), &changed, support, false)
                        .expect("warm review");
                    assert_eq!(
                        warm.result.review_summary_json_bytes, summary,
                        "{label} concurrent={concurrent}: a full-output option changed the \
                         review summary, so it is not review-irrelevant after all"
                    );
                    assert_eq!(
                        cone_work(&warm.executed_queries),
                        recomputes.to_vec(),
                        "{label} concurrent={concurrent}: moving the option recomputed a \
                         different part of the review cone than the option itself reaches"
                    );

                    let reverted = engine
                        .execute(&csv(), &baseline, support, false)
                        .expect("reverted review");
                    assert_eq!(reverted.result.review_summary_json_bytes, summary);
                    // Reverting can recompute less than the edit did, because
                    // the baseline values are still cached from the revision
                    // before the edit. It must never recompute more.
                    let reverted_work = cone_work(&reverted.executed_queries);
                    assert!(
                        reverted_work.iter().all(|step| recomputes.contains(step)),
                        "{label} concurrent={concurrent}: reverting the option recomputed \
                         {reverted_work:?}. which reaches past {recomputes:?}"
                    );
                }
            }
        }

        /// The same two properties for edits to the inputs rather than the
        /// options: a changed raw export and a changed support file.
        #[test]
        fn input_edits_keep_warm_results_exact_and_repeat_requests_free() {
            let mut options = pipeline_options();
            options.include_app_output = true;
            options.include_screen_output = true;
            options.use_filter_file = true;
            options.use_app_codebook = true;
            let options = options;

            let filter = b"app_package_name\ncom.example.chat\n".to_vec();
            let other_filter = b"app_package_name\ncom.example.other\n".to_vec();
            let codebook = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Social,Communication,test\n".to_vec();
            let other_codebook = b"app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\ncom.example.chat,Chat,Games,Entertainment,test\n".to_vec();
            let base_support = PipelineV2SupportFiles {
                filter_csv: &filter,
                codebook_csv: &codebook,
                ..PipelineV2SupportFiles::default()
            };

            let extended_csv = {
                let mut bytes = csv().as_ref().clone();
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Music,Activity Resumed,com.example.music,2026-03-07 10:02:00,America/Chicago\n",
                );
                bytes.extend_from_slice(
                    b"Study,P01,Target Child,Music,Activity Paused,com.example.music,2026-03-07 10:09:00,America/Chicago\n",
                );
                Arc::new(bytes)
            };

            let cases: Vec<(&str, Arc<Vec<u8>>, PipelineV2SupportFiles<'_>)> = vec![
                ("baseline", csv(), base_support),
                ("extra raw rows", Arc::clone(&extended_csv), base_support),
                (
                    "different filter file",
                    csv(),
                    PipelineV2SupportFiles {
                        filter_csv: &other_filter,
                        ..base_support
                    },
                ),
                (
                    "different codebook",
                    csv(),
                    PipelineV2SupportFiles {
                        codebook_csv: &other_codebook,
                        ..base_support
                    },
                ),
                ("back to baseline", csv(), base_support),
                (
                    "extra raw rows again",
                    Arc::clone(&extended_csv),
                    base_support,
                ),
            ];

            // Review is the mode where the fused annotation and reconstruction
            // values live, and an input edit is the only thing that moves them,
            // so both cones see every edit.
            for full in [true, false] {
                let mut engine = TrackedEngine::default();
                for (label, bytes, support) in &cases {
                    let warm = engine.execute(bytes, &options, *support, full).unwrap();
                    let mut cold = TrackedEngine::default();
                    let expected = cold.execute(bytes, &options, *support, full).unwrap();
                    assert_result_parity(
                        &warm.result,
                        &expected.result,
                        options.usage_session_mode,
                    );

                    // Both engines run the same query graph, so they agree even
                    // when it is wrong. The sequential path computes the same registered
                    // steps through separate code and settles it.
                    let oracle = run_pipeline_v2_with_supports(bytes, &options, *support)
                        .unwrap_or_else(|error| {
                            panic!("{label} full={full}: sequential oracle: {error}")
                        });
                    if full {
                        assert_result_parity(&warm.result, &oracle, options.usage_session_mode);
                    } else {
                        assert_eq!(
                            warm.result.review_summary_json_bytes, oracle.review_summary_json_bytes,
                            "{label} full={full}: review summary differs from the sequential path",
                        );
                    }

                    let repeat = engine.execute(bytes, &options, *support, full).unwrap();
                    assert!(
                        repeat.executed_queries.is_empty()
                            && repeat.internal_executed_queries.is_empty(),
                        "{label} full={full}: repeating an unchanged request reran {:?} / {:?}",
                        repeat.executed_queries,
                        repeat.internal_executed_queries,
                    );
                    assert_result_parity(
                        &repeat.result,
                        &expected.result,
                        options.usage_session_mode,
                    );
                }
            }
        }

        /// Native attribution for the review hot path. The only runner for the
        /// query-timing sub-timers in review_usage_rows_before_floor and
        /// review_static_annotations; it never runs in normal gates. Timings
        /// print on stderr as `query_timing label=... elapsed_ms=...`. Run:
        /// cargo test --release --no-default-features \
        ///   --features "incremental-v2 query-timing" \
        ///   review_hot_path_attribution -- --ignored --nocapture
        #[cfg(feature = "query-timing")]
        #[test]
        #[ignore = "manual profiling harness for the query-timing feature"]
        fn review_hot_path_attribution() {
            fn push_row(
                raw: &mut Vec<u8>,
                second_of_day: u32,
                label: &str,
                interaction: &str,
                package: &str,
            ) {
                let (h, m, s) = (
                    second_of_day / 3600,
                    (second_of_day / 60) % 60,
                    second_of_day % 60,
                );
                raw.extend_from_slice(
                    format!(
                        "Study,P01,Target Child,{label},{interaction},{package},2026-03-07 {h:02}:{m:02}:{s:02},America/Chicago\n"
                    )
                    .as_bytes(),
                );
            }
            // 20,000 repetitions of the proven five-event pattern from csv()
            // (~100k rows) across 2026-03-07, rotating 200 packages so the
            // annotation passes see realistic string churn.
            let mut raw = Vec::with_capacity(24 * 1024 * 1024);
            raw.extend_from_slice(
                b"study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            );
            for block in 0..20_000u32 {
                let start_second = 10 + block * 4;
                let package = format!("com.example.app{:03}", block % 200);
                let label = format!("App {:03}", block % 200);
                push_row(&mut raw, start_second, "", "Screen Interactive", "");
                push_row(
                    &mut raw,
                    start_second + 1,
                    &label,
                    "Activity Resumed",
                    &package,
                );
                push_row(
                    &mut raw,
                    start_second + 2,
                    &label,
                    "Device Shutdown",
                    &package,
                );
                push_row(
                    &mut raw,
                    start_second + 2,
                    &label,
                    "User Interaction",
                    &package,
                );
                push_row(&mut raw, start_second + 3, "", "Screen Non-Interactive", "");
            }
            let baseline = pipeline_options();
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            eprintln!("attribution_phase=base_full_execute");
            producer.execute(&raw, &baseline, support, true).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let reconstruction_base = producer.export_reconstruction_base().unwrap();
            let mut changed = baseline.clone();
            changed.minimum_usage_duration = 60.0;
            let mut consumer = TrackedEngine::default();
            eprintln!("attribution_phase=changed_review_with_bases");
            let cached = consumer
                .execute_with_review_bases(
                    &raw,
                    &review_base,
                    &reconstruction_base,
                    &changed,
                    support,
                    false,
                )
                .unwrap();
            assert!(
                cached
                    .executed_queries
                    .iter()
                    .any(|step| step == "classify_episode_durations"),
                "floor edit did not exercise the incremental review path: {:?}",
                cached.executed_queries
            );
        }

        /// Changed-review attribution over a real raw export supplied via
        /// `CHRONICLE_ATTR_CSV`, mirroring the wasm benchmark's narrow
        /// (minimum_usage_duration=2) and heavy (model_concurrent_usage off)
        /// edits against the full-options baseline. Measures both the
        /// restored-persisted-base path (the A/B comparison worker) and the
        /// warm same-engine repeated-edit path (the interactive view loop):
        ///   CHRONICLE_ATTR_CSV=/path/to/raw.csv \
        ///   cargo test --release --no-default-features \
        ///     --features "incremental-v2 query-timing" \
        ///     review_attribution_from_csv -- --ignored --nocapture
        #[cfg(feature = "query-timing")]
        #[test]
        #[ignore]
        fn review_attribution_from_csv() {
            let path = std::env::var("CHRONICLE_ATTR_CSV")
                .expect("set CHRONICLE_ATTR_CSV to a raw Chronicle export");
            let raw = std::fs::read(&path).expect("read CHRONICLE_ATTR_CSV");
            let mut baseline = pipeline_options();
            baseline.model_concurrent_usage = true;
            baseline.enable_screen_gated_crediting = true;
            baseline.enable_aggregates = true;
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            eprintln!(
                "attribution_phase=base_full_execute file={path} bytes={}",
                raw.len()
            );
            producer.execute(&raw, &baseline, support, true).unwrap();
            let review_base = producer.export_review_base().unwrap();
            let reconstruction_base = producer.export_reconstruction_base().unwrap();

            for (case, edit) in [
                ("narrow_minimum_usage_duration", {
                    let mut changed = baseline.clone();
                    changed.minimum_usage_duration = 2.0;
                    changed
                }),
                ("heavy_concurrent_usage_off", {
                    let mut changed = baseline.clone();
                    changed.model_concurrent_usage = false;
                    changed
                }),
            ] {
                let mut consumer = TrackedEngine::default();
                eprintln!("attribution_phase=restored_base_changed_review case={case}");
                let started = std::time::Instant::now();
                let restored = consumer
                    .execute_with_review_bases(
                        &raw,
                        &review_base,
                        &reconstruction_base,
                        &edit,
                        support,
                        false,
                    )
                    .unwrap();
                eprintln!(
                    "attribution_total case={case} restored_review_ms={:.1} executed={:?}",
                    started.elapsed().as_secs_f64() * 1000.0,
                    restored.executed_queries
                );

                // Interactive view loop, product-shaped: the browser compare
                // flow supplies the persisted bases on every call, so the
                // base-restored early state stays valid across edits.
                for step in 0..3u32 {
                    let mut repeat = edit.clone();
                    match case {
                        "narrow_minimum_usage_duration" => {
                            repeat.minimum_usage_duration = 3.0 + f64::from(step);
                        }
                        _ => {
                            // Alternate the toggle so every iteration is a
                            // real change on the warm engine.
                            repeat.model_concurrent_usage = step % 2 == 0;
                        }
                    }
                    eprintln!(
                        "attribution_phase=warm_repeat_edit_with_bases case={case} step={step}"
                    );
                    let started = std::time::Instant::now();
                    consumer
                        .execute_with_review_bases(
                            &raw,
                            &review_base,
                            &reconstruction_base,
                            &repeat,
                            support,
                            false,
                        )
                        .unwrap();
                    eprintln!(
                        "attribution_total case={case} warm_repeat_with_bases_step={step} review_ms={:.1}",
                        started.elapsed().as_secs_f64() * 1000.0
                    );
                }

                // Interactive view loop with the bases dropped after the
                // first review: measures base-invalidation recovery too.
                for step in 0..3u32 {
                    let mut repeat = edit.clone();
                    match case {
                        "narrow_minimum_usage_duration" => {
                            repeat.minimum_usage_duration = 6.0 + f64::from(step);
                        }
                        _ => {
                            repeat.model_concurrent_usage = step % 2 == 0;
                        }
                    }
                    eprintln!("attribution_phase=warm_repeat_edit case={case} step={step}");
                    let started = std::time::Instant::now();
                    consumer
                        .execute_with_review_bases(&raw, &[], &[], &repeat, support, false)
                        .unwrap();
                    eprintln!(
                        "attribution_total case={case} warm_repeat_step={step} review_ms={:.1}",
                        started.elapsed().as_secs_f64() * 1000.0
                    );
                }
            }
        }

        /// Cold full-execute attribution over a real raw export supplied via
        /// `CHRONICLE_ATTR_CSV`, so per-step checkpoint costs are measured on
        /// production-shaped data instead of the synthetic pattern above:
        ///   CHRONICLE_ATTR_CSV=/path/to/raw.csv \
        ///   cargo test --release --no-default-features \
        ///     --features "incremental-v2 query-timing" \
        ///     cold_execute_attribution_from_csv -- --ignored --nocapture
        #[cfg(feature = "query-timing")]
        #[test]
        #[ignore]
        fn cold_execute_attribution_from_csv() {
            let path = std::env::var("CHRONICLE_ATTR_CSV")
                .expect("set CHRONICLE_ATTR_CSV to a raw Chronicle export");
            let raw = std::fs::read(&path).expect("read CHRONICLE_ATTR_CSV");
            let baseline = pipeline_options();
            let support = PipelineV2SupportFiles::default();
            let mut producer = TrackedEngine::default();
            eprintln!(
                "attribution_phase=cold_full_execute file={path} bytes={}",
                raw.len()
            );
            let started = std::time::Instant::now();
            producer.execute(&raw, &baseline, support, true).unwrap();
            eprintln!(
                "attribution_total cold_execute_ms={:.1}",
                started.elapsed().as_secs_f64() * 1000.0
            );

            // Primitive microbenchmark on the same table: separates the fixed
            // per-row hash cost (3 blake3 init/finalize per fresh row) from
            // cached-parts recombination and from raw blake3 throughput, so
            // the optimization target is the measured constant, not a guess.
            let raw_rows = super::super::decode_source_records(&raw);
            let raw_rows = super::super::remove_missing_timestamps(raw_rows);
            let bench = std::time::Instant::now();
            let payload_json = serde_json::to_vec(&raw_rows).unwrap();
            eprintln!(
                "microbench value_step_serde_json_ms={:.1} json_bytes={}",
                bench.elapsed().as_secs_f64() * 1000.0,
                payload_json.len()
            );
            drop(payload_json);
            let rows = super::super::canonicalize_source_rows(
                &raw_rows,
                "America/Chicago",
                &std::collections::BTreeMap::new(),
                "Android",
            )
            .unwrap();
            let bench = std::time::Instant::now();
            let fresh = super::super::super::workflow_rows_checkpoint("bench_fresh_parts", &rows);
            eprintln!(
                "microbench fresh_parts_and_recombine_ms={:.1} rows={}",
                bench.elapsed().as_secs_f64() * 1000.0,
                rows.len()
            );
            let bench = std::time::Instant::now();
            let cached =
                super::super::super::workflow_rows_checkpoint("bench_cached_recombine", &rows);
            eprintln!(
                "microbench cached_recombine_ms={:.1}",
                bench.elapsed().as_secs_f64() * 1000.0
            );
            assert_eq!(fresh.row_membership_digest, cached.row_membership_digest);
            let bench = std::time::Instant::now();
            let one_shot = blake3::hash(&raw);
            eprintln!(
                "microbench blake3_one_shot_ms={:.1} bytes={} digest_prefix={:02x}",
                bench.elapsed().as_secs_f64() * 1000.0,
                raw.len(),
                one_shot.as_bytes()[0]
            );
        }
    }
}

#[cfg(feature = "incremental-v2")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PersistedReviewBaseSelection {
    None,
    Review,
    Reconstruction,
}

#[cfg(feature = "incremental-v2")]
pub const fn review_base_header_bytes() -> usize {
    tracked::review_base_header_bytes()
}

#[cfg(feature = "incremental-v2")]
pub const fn reconstruction_base_header_bytes() -> usize {
    tracked::reconstruction_base_header_bytes()
}

#[cfg(feature = "incremental-v2")]
pub fn select_persisted_review_base(
    input_sha256: &str,
    review_base_header: &[u8],
    reconstruction_base_header: &[u8],
    options: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PersistedReviewBaseSelection, String> {
    tracked::select_persisted_base_kind(
        input_sha256,
        review_base_header,
        reconstruction_base_header,
        options,
        support,
    )
}

#[cfg(feature = "incremental-v2")]
#[derive(Default)]
pub struct IncrementalPipelineV2Engine {
    inner: tracked::TrackedEngine,
}

#[cfg(feature = "incremental-v2")]
pub struct IncrementalPipelineV2Execution {
    pub result: Arc<PipelineV2Result>,
    pub executed_queries: Vec<String>,
    /// Derived cache queries that are not product steps. Exposed separately so
    /// performance tests can prove expensive terminal work stayed cached
    /// without pretending physical queries are additional semantic transformations.
    pub internal_executed_queries: Vec<String>,
}

#[cfg(feature = "incremental-v2")]
impl IncrementalPipelineV2Engine {
    pub fn has_verified_input(&self, input_sha256: &str) -> bool {
        self.inner.has_verified_input(input_sha256)
    }

    pub fn execute(
        &mut self,
        csv_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        self.execute_with_materialization(csv_bytes, options, support, true)
    }

    /// Run the same tracked product DAG while returning only the compact
    /// review summary. Large CSV, visualization, aggregate, and lineage bytes
    /// remain unmaterialized until a full execution is explicitly requested.
    pub fn execute_review(
        &mut self,
        csv_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        self.execute_with_materialization(csv_bytes, options, support, false)
    }

    /// Re-enter the same tracked DAG from a verified, product-owned early-row
    /// checkpoint. A mismatched checkpoint is treated as a cache miss and the
    /// raw CSV path runs normally.
    pub fn execute_review_with_base(
        &mut self,
        csv_bytes: &[u8],
        review_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        self.execute_review_with_bases(csv_bytes, review_base_bytes, &[], options, support)
    }

    /// Re-enter from the verified post-review and post-reconstruction checkpoints. Either
    /// checkpoint may be empty; exact key mismatches are cache misses.
    pub fn execute_review_with_bases(
        &mut self,
        csv_bytes: &[u8],
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        let execution = self.inner.execute_with_review_bases(
            csv_bytes,
            review_base_bytes,
            reconstruction_base_bytes,
            options,
            support,
            false,
        )?;
        Ok(IncrementalPipelineV2Execution {
            result: execution.result,
            executed_queries: execution.executed_queries,
            internal_executed_queries: execution.internal_executed_queries,
        })
    }

    pub fn execute_review_with_owned_csv(
        &mut self,
        csv_bytes: Vec<u8>,
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        let execution = self.inner.execute_with_owned_csv_review_bases(
            csv_bytes,
            review_base_bytes,
            reconstruction_base_bytes,
            options,
            support,
            false,
        )?;
        Ok(IncrementalPipelineV2Execution {
            result: execution.result,
            executed_queries: execution.executed_queries,
            internal_executed_queries: execution.internal_executed_queries,
        })
    }

    /// Re-enter a verified persisted base without copying the unchanged raw
    /// object into WASM again. The caller must have verified `input_sha256`
    /// while opening the content-addressed workspace; the selected base is
    /// independently bound to that digest and fails closed on any mismatch.
    pub fn execute_review_with_verified_input(
        &mut self,
        input_sha256: String,
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        let execution = self.inner.execute_with_verified_csv_review_bases(
            Vec::new(),
            input_sha256,
            review_base_bytes,
            reconstruction_base_bytes,
            options,
            support,
            false,
        )?;
        Ok(IncrementalPipelineV2Execution {
            result: execution.result,
            executed_queries: execution.executed_queries,
            internal_executed_queries: execution.internal_executed_queries,
        })
    }

    /// Reuse raw bytes and persisted-base state already owned by this exact
    /// engine instance. The verified digest must match the live tracked input;
    /// otherwise the request fails instead of silently falling back.
    pub fn execute_review_with_warm_verified_input(
        &mut self,
        input_sha256: String,
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        let execution =
            self.inner
                .execute_with_warm_verified_input(input_sha256, options, support, false)?;
        Ok(IncrementalPipelineV2Execution {
            result: execution.result,
            executed_queries: execution.executed_queries,
            internal_executed_queries: execution.internal_executed_queries,
        })
    }

    /// Serialize the exact early row table and its 17 product-step
    /// checkpoints after a completed execution. The payload is private to the
    /// current Rust implementation and is always revalidated before reuse.
    pub fn export_review_base(&mut self) -> Result<Vec<u8>, String> {
        self.inner.export_review_base()
    }

    /// Serialize the exact reconstructed row table and reconstruction resume
    /// checkpoints after a completed execution. It is independently keyed and
    /// validated, so upstream changes cannot reuse stale rows.
    pub fn export_reconstruction_base(&mut self) -> Result<Vec<u8>, String> {
        self.inner.export_reconstruction_base()
    }

    fn execute_with_materialization(
        &mut self,
        csv_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
        materialize_full_outputs: bool,
    ) -> Result<IncrementalPipelineV2Execution, String> {
        let execution =
            self.inner
                .execute(csv_bytes, options, support, materialize_full_outputs)?;
        Ok(IncrementalPipelineV2Execution {
            result: execution.result,
            executed_queries: execution.executed_queries,
            internal_executed_queries: execution.internal_executed_queries,
        })
    }
}
