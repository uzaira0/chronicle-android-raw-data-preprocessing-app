use crate::pipeline_v2::InteractionTypeRemovalMode;
use chrono::Offset;
use crate::pipeline_v2::{
    ACTIVITY_STOPPED, AHashMap, AHashSet, APP_USAGE, BTreeSet, CleaningCounts, CULVERHOUSE_BAD_APP_CAP_FLAG,
    CULVERHOUSE_BAD_APP_CAP_NS, CULVERHOUSE_COLLAPSED_FLAG, CULVERHOUSE_DST_DAY_FLAG,
    CULVERHOUSE_LONG_3H_FLAG, CULVERHOUSE_LONG_3H_NS, CULVERHOUSE_LONG_6H_FLAG,
    CULVERHOUSE_LONG_6H_NS, CULVERHOUSE_PARTIAL_DAY_FLAG, CULVERHOUSE_PARTIAL_DAY_GAP_HOURS,
    CULVERHOUSE_SAME_APP_COLLAPSE_NS, CodebookEntry, DayBoundaryAttribution, FILTERED_APP_USAGE,
    FILTERED_STOPPED, HashMap, IntervalQualityPolicy, LocalDateMemo, NaiveDate, Row,
    SessionBoundaryScope, SessionGapBasis, SessionGapThreshold, SessionGroupingRules, SharedString,
    TimeZone, Tz, BROAD_CATEGORY_COLUMNS, GENRE_ID_COLUMNS, codebook_col_indices, empty_codebook_fields, format_threshold, js_number_to_string,
    populate_time_columns, ts_to_local,
};

// ---- main entry ---------------------------------------------------------

pub(crate) fn is_zero_duration_cleanup_candidate(row: &Row) -> bool {
    row.raw_episode_duration_ns == Some(0)
        || (row.raw_episode_duration_ns.is_none()
            && row.interaction_type == APP_USAGE
            && row.duration_seconds == Some(0.0))
}

const CULVERHOUSE_TRUNCATED_FLAG_PREFIX: &str = "CULVERHOUSE TRUNCATED ";

/// The cleaning effects visible in the final App Usage rows, so both
/// schedulers count exactly what the export carries: rows the filter file or
/// label exclusions marked, Culverhouse-truncated rows, and the
/// participant-days Culverhouse flagged.
pub(crate) fn record_app_output_cleaning_counts(rows: &[Row], counts: &mut CleaningCounts) {
    counts.filter_relabeled_rows = rows
        .iter()
        .filter(|row| {
            row.interaction_type == FILTERED_APP_USAGE || row.interaction_type == FILTERED_STOPPED
        })
        .count() as u32;
    counts.culverhouse_bounded_intervals = rows
        .iter()
        .filter(|row| row.any_app_usage_flags.contains(CULVERHOUSE_TRUNCATED_FLAG_PREFIX))
        .count() as u32;
    counts.culverhouse_flagged_days = rows
        .iter()
        .filter(|row| {
            row.any_app_usage_flags.contains(CULVERHOUSE_PARTIAL_DAY_FLAG)
                || row.any_app_usage_flags.contains(CULVERHOUSE_DST_DAY_FLAG)
        })
        .map(|row| (row.participant_id.clone(), row.date.clone()))
        .collect::<BTreeSet<_>>()
        .len() as u32;
}

pub(crate) fn join_codebook(rows: &mut [Row], enabled: bool, codebook_map: &HashMap<String, CodebookEntry>) {
    if !enabled {
        return;
    }
    for row in rows.iter_mut() {
        join_codebook_row(row, codebook_map);
    }
}

pub(crate) fn join_codebook_row(row: &mut Row, codebook_map: &HashMap<String, CodebookEntry>) {
    let fields = codebook_map
        .get(row.app_package_name.as_str())
        .map(|entry| entry.fields.clone())
        .unwrap_or_else(empty_codebook_fields);
    if row.codebook_fields != fields {
        *row.edit_classification().codebook_fields = fields;
    }
}

pub(crate) fn derive_broad_category(rows: &mut [Row], enabled: bool) {
    if !enabled {
        return;
    }
    let indices = codebook_col_indices(BROAD_CATEGORY_COLUMNS);
    for row in rows.iter_mut() {
        derive_broad_category_row(row, indices);
    }
}

pub(crate) fn derive_broad_category_row(
    row: &mut Row,
    indices: [usize; BROAD_CATEGORY_COLUMNS.len()],
) {
    let chosen = indices
        .iter()
        .map(|&index| row.codebook_fields[index].as_deref())
        .chain(std::iter::once(row.broad_app_category.as_deref()))
        .find_map(|candidate| candidate.filter(|value| !value.trim().is_empty()))
        .map(String::from);
    let category = Some(chosen.unwrap_or_else(|| "Unknown".to_string()).into());
    if row.broad_app_category != category {
        *row.edit_classification().broad_app_category = category;
    }
}

pub(crate) fn collapse_app_genre(rows: &mut [Row], enabled: bool) {
    if !enabled {
        return;
    }
    let indices = codebook_col_indices(GENRE_ID_COLUMNS);
    for row in rows.iter_mut() {
        collapse_app_genre_row(row, indices);
    }
}

pub(crate) fn collapse_app_genre_row(row: &mut Row, indices: [usize; GENRE_ID_COLUMNS.len()]) {
    let genre_values = indices
        .into_iter()
        .filter_map(|index| row.codebook_fields[index].as_ref())
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if genre_values.is_empty() {
        if row.genre_id_scraped.as_deref() != Some("Unknown") {
            *row.edit_classification().genre_id_scraped = Some("Unknown".into());
        }
        return;
    }
    let unique = genre_values
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    if unique.len() == 1 {
        let genre = SharedString::from(genre_values[0].as_str());
        if row.genre_id_scraped.as_ref() != Some(&genre) || !row.codebook_genre_fields_cleared {
            let data = row.edit_classification();
            *data.genre_id_scraped = Some(genre);
            *data.codebook_genre_fields_cleared = true;
        }
    } else if row.genre_id_scraped.is_some() || row.codebook_genre_fields_cleared {
        let data = row.edit_classification();
        *data.genre_id_scraped = None;
        *data.codebook_genre_fields_cleared = false;
    }
}

pub(crate) fn apply_codebook_annotations(
    rows: &mut [Row],
    enabled: bool,
    codebook_map: &HashMap<String, CodebookEntry>,
) {
    if !enabled {
        return;
    }
    let broad_indices = codebook_col_indices(BROAD_CATEGORY_COLUMNS);
    let genre_indices = codebook_col_indices(GENRE_ID_COLUMNS);
    for row in rows {
        join_codebook_row(row, codebook_map);
        derive_broad_category_row(row, broad_indices);
        collapse_app_genre_row(row, genre_indices);
    }
}

pub(crate) fn walk_app_usage_detail_columns_with_pre(
    rows: &mut [Row],
    custom_app_engagement_duration: f64,
    mut before_row: impl FnMut(&mut Row),
    mut after_row: impl FnMut(&mut Row),
) {
    fn metrics(
        previous: Option<(i64, &SharedString)>,
        start: Option<i64>,
        package: &SharedString,
        custom_duration: f64,
    ) -> (i32, i32, i32, f64) {
        let Some((previous_stop, previous_package)) = previous else {
            return (1, 1, 0, 0.0);
        };
        let switched = i32::from(package != previous_package);
        // No interval to measure. A row the caller admits normally has one --
        // either its display interval or the raw-episode evidence the caller
        // falls back to -- so this is a backstop rather than a live branch. It
        // is here because the alternative does not fail loudly: this used to
        // substitute an `i64::MIN` sentinel and subtract anyway, and the
        // wrapping subtraction turned a blanked interval into a gap of roughly
        // 2.07 million hours. That read as a new engagement on the row itself,
        // and the sentinel then became the next row's `previous_stop` and
        // produced the negation of it there, clearing that row's engagement
        // flags in turn. Both junk values were baked into
        // `tests/golden/app.csv`. The package identity is still known, so the
        // switch stays measured; the gap does not.
        let Some(start) = start else {
            return (0, 0, switched, 0.0);
        };
        // Match JS BigInt.asIntN(64, ...) with explicit wrapping subtraction.
        let gap_seconds = start.wrapping_sub(previous_stop) as f64 / 1_000_000_000.0;
        (
            i32::from(gap_seconds > 30.0),
            i32::from(gap_seconds > custom_duration),
            switched,
            gap_seconds / 3600.0,
        )
    }

    let mut previous_any = AHashMap::<SharedString, (i64, SharedString)>::new();
    let mut previous_valid = AHashMap::<SharedString, (i64, SharedString)>::new();
    for row in rows {
        before_row(row);
        let participant_id = row.participant_id.clone();
        let is_primary = row.usage_layer.as_deref() != Some("secondary");
        let is_valid = is_primary && row.interaction_type == APP_USAGE;
        let is_any = is_valid || (is_primary && row.interaction_type == FILTERED_APP_USAGE);
        if !is_any {
            after_row(row);
            continue;
        }
        // A `Filtered App Usage` row has had its DISPLAY interval blanked back
        // in `classify_episode_durations`, but the episode it came from is
        // preserved as raw-episode evidence on the same row. The `any_app_*`
        // family exists precisely to INCLUDE excluded packages, so it measures
        // from that real interval; only the emitted CSV omits it.
        //
        // The fallback fires on filtered rows and nothing else: every other row
        // admitted by `is_any` carries a display interval, and `End of Usage
        // Missing` never passes `is_any` at all. Rows whose display interval was
        // deliberately narrowed -- day-boundary division, participant windows --
        // keep `start_timestamp_ns`, so `or` leaves them untouched.
        let start = row
            .start_timestamp_ns
            .or(row.raw_episode_start_timestamp_ns);
        let stop = row.stop_timestamp_ns.or(row.raw_episode_stop_timestamp_ns);
        let package = row.app_package_name.clone();
        let (engage_30, engage_custom, switched, gap_hours) = metrics(
            previous_any
                .get(&participant_id)
                .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
            start,
            &package,
            custom_app_engagement_duration,
        );
        let valid_metrics = is_valid.then(|| {
            metrics(
                previous_valid
                    .get(&participant_id)
                    .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
                start,
                &package,
                custom_app_engagement_duration,
            )
        });
        let any_classification_changed = row.any_app_new_engage_30s != engage_30
            || row.any_app_new_engage_custom != engage_custom
            || row.any_app_switched_app != switched;
        let any_temporal_changed =
            row.any_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits();
        let valid_classification_changed =
            valid_metrics.is_some_and(|(engage_30, engage_custom, switched, _)| {
                row.valid_app_new_engage_30s != engage_30
                    || row.valid_app_new_engage_custom != engage_custom
                    || row.valid_app_switched_app != switched
            });
        let valid_temporal_changed = valid_metrics.is_some_and(|(_, _, _, gap_hours)| {
            row.valid_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits()
        });
        if any_classification_changed
            || any_temporal_changed
            || valid_classification_changed
            || valid_temporal_changed
        {
            let data = row.edit_components(
                false,
                any_temporal_changed || valid_temporal_changed,
                any_classification_changed || valid_classification_changed,
            );
            data.any_app_new_engage_30s = engage_30;
            data.any_app_new_engage_custom = engage_custom;
            data.any_app_switched_app = switched;
            data.any_app_usage_time_gap_hours = gap_hours;
            if let Some((engage_30, engage_custom, switched, gap_hours)) = valid_metrics {
                data.valid_app_new_engage_30s = engage_30;
                data.valid_app_new_engage_custom = engage_custom;
                data.valid_app_switched_app = switched;
                data.valid_app_usage_time_gap_hours = gap_hours;
            }
        }
        // Same backstop on the way out: a row with no stop at all cannot anchor
        // the next row's gap, so carry the last row that had one rather than
        // seeding the chain with a sentinel.
        if let Some(stop) = stop {
            previous_any.insert(participant_id.clone(), (stop, package.clone()));
            if is_valid {
                previous_valid.insert(participant_id, (stop, package));
            }
        }
        after_row(row);
    }
}

pub(crate) fn walk_app_usage_detail_columns(
    rows: &mut [Row],
    custom_app_engagement_duration: f64,
    mut after_row: impl FnMut(&mut Row),
) {
    fn metrics(
        previous: Option<(i64, &SharedString)>,
        start: Option<i64>,
        package: &SharedString,
        custom_duration: f64,
    ) -> (i32, i32, i32, f64) {
        let Some((previous_stop, previous_package)) = previous else {
            return (1, 1, 0, 0.0);
        };
        let switched = i32::from(package != previous_package);
        // No interval to measure. A row the caller admits normally has one --
        // either its display interval or the raw-episode evidence the caller
        // falls back to -- so this is a backstop rather than a live branch. It
        // is here because the alternative does not fail loudly: this used to
        // substitute an `i64::MIN` sentinel and subtract anyway, and the
        // wrapping subtraction turned a blanked interval into a gap of roughly
        // 2.07 million hours. That read as a new engagement on the row itself,
        // and the sentinel then became the next row's `previous_stop` and
        // produced the negation of it there, clearing that row's engagement
        // flags in turn. Both junk values were baked into
        // `tests/golden/app.csv`. The package identity is still known, so the
        // switch stays measured; the gap does not.
        let Some(start) = start else {
            return (0, 0, switched, 0.0);
        };
        // Match JS BigInt.asIntN(64, ...) with explicit wrapping subtraction.
        let gap_seconds = start.wrapping_sub(previous_stop) as f64 / 1_000_000_000.0;
        (
            i32::from(gap_seconds > 30.0),
            i32::from(gap_seconds > custom_duration),
            switched,
            gap_seconds / 3600.0,
        )
    }

    let mut previous_any = AHashMap::<SharedString, (i64, SharedString)>::new();
    let mut previous_valid = AHashMap::<SharedString, (i64, SharedString)>::new();
    for row in rows {
        let participant_id = row.participant_id.clone();
        let is_primary = row.usage_layer.as_deref() != Some("secondary");
        let is_valid = is_primary && row.interaction_type == APP_USAGE;
        let is_any = is_valid || (is_primary && row.interaction_type == FILTERED_APP_USAGE);
        if !is_any {
            after_row(row);
            continue;
        }
        // A `Filtered App Usage` row has had its DISPLAY interval blanked back
        // in `classify_episode_durations`, but the episode it came from is
        // preserved as raw-episode evidence on the same row. The `any_app_*`
        // family exists precisely to INCLUDE excluded packages, so it measures
        // from that real interval; only the emitted CSV omits it.
        //
        // The fallback fires on filtered rows and nothing else: every other row
        // admitted by `is_any` carries a display interval, and `End of Usage
        // Missing` never passes `is_any` at all. Rows whose display interval was
        // deliberately narrowed -- day-boundary division, participant windows --
        // keep `start_timestamp_ns`, so `or` leaves them untouched.
        let start = row
            .start_timestamp_ns
            .or(row.raw_episode_start_timestamp_ns);
        let stop = row.stop_timestamp_ns.or(row.raw_episode_stop_timestamp_ns);
        let package = row.app_package_name.clone();
        let (engage_30, engage_custom, switched, gap_hours) = metrics(
            previous_any
                .get(&participant_id)
                .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
            start,
            &package,
            custom_app_engagement_duration,
        );
        let valid_metrics = is_valid.then(|| {
            metrics(
                previous_valid
                    .get(&participant_id)
                    .map(|(previous_stop, previous_package)| (*previous_stop, previous_package)),
                start,
                &package,
                custom_app_engagement_duration,
            )
        });
        let any_classification_changed = row.any_app_new_engage_30s != engage_30
            || row.any_app_new_engage_custom != engage_custom
            || row.any_app_switched_app != switched;
        let any_temporal_changed =
            row.any_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits();
        let valid_classification_changed =
            valid_metrics.is_some_and(|(engage_30, engage_custom, switched, _)| {
                row.valid_app_new_engage_30s != engage_30
                    || row.valid_app_new_engage_custom != engage_custom
                    || row.valid_app_switched_app != switched
            });
        let valid_temporal_changed = valid_metrics.is_some_and(|(_, _, _, gap_hours)| {
            row.valid_app_usage_time_gap_hours.to_bits() != gap_hours.to_bits()
        });
        if any_classification_changed
            || any_temporal_changed
            || valid_classification_changed
            || valid_temporal_changed
        {
            let data = row.edit_components(
                false,
                any_temporal_changed || valid_temporal_changed,
                any_classification_changed || valid_classification_changed,
            );
            data.any_app_new_engage_30s = engage_30;
            data.any_app_new_engage_custom = engage_custom;
            data.any_app_switched_app = switched;
            data.any_app_usage_time_gap_hours = gap_hours;
            if let Some((engage_30, engage_custom, switched, gap_hours)) = valid_metrics {
                data.valid_app_new_engage_30s = engage_30;
                data.valid_app_new_engage_custom = engage_custom;
                data.valid_app_switched_app = switched;
                data.valid_app_usage_time_gap_hours = gap_hours;
            }
        }
        // Same backstop on the way out: a row with no stop at all cannot anchor
        // the next row's gap, so carry the last row that had one rather than
        // seeding the chain with a sentinel.
        if let Some(stop) = stop {
            previous_any.insert(participant_id.clone(), (stop, package.clone()));
            if is_valid {
                previous_valid.insert(participant_id, (stop, package));
            }
        }
        after_row(row);
    }
}

pub(crate) fn add_app_usage_detail_columns(rows: &mut [Row], custom_app_engagement_duration: f64) {
    walk_app_usage_detail_columns(rows, custom_app_engagement_duration, |_| {});
}

pub(crate) struct PreparedUsageFlags {
    pub(crate) gap: Vec<(f64, String)>,
    pub(crate) duration: Vec<(f64, String)>,
}

pub(crate) fn prepare_usage_flags(
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) -> PreparedUsageFlags {
    let mut gap_thresholds = long_data_time_gap_thresholds.to_vec();
    gap_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let mut dur_thresholds = long_usage_duration_thresholds.to_vec();
    dur_thresholds.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let gap_thresholds = gap_thresholds
        .into_iter()
        .map(|threshold| {
            (
                threshold,
                format!(">{}-HR TIME GAP", format_threshold(threshold)),
            )
        })
        .collect::<Vec<_>>();
    let dur_thresholds = dur_thresholds
        .into_iter()
        .map(|threshold| {
            (
                threshold,
                format!(">{}-HR APP USAGE", format_threshold(threshold)),
            )
        })
        .collect::<Vec<_>>();
    PreparedUsageFlags {
        gap: gap_thresholds,
        duration: dur_thresholds,
    }
}

pub(crate) fn mark_app_usage_flags_row(row: &mut Row, thresholds: &PreparedUsageFlags) {
    let gap_flag = thresholds
        .gap
        .iter()
        .find(|(threshold, _)| row.data_time_gap_hours >= *threshold)
        .map(|(_, label)| label.as_str());
    let dur_hours = row.duration_minutes.map(|m| m / 60.0).unwrap_or(0.0);
    let duration_flag = thresholds
        .duration
        .iter()
        .find(|(threshold, _)| dur_hours >= *threshold)
        .map(|(_, label)| label.as_str());
    if gap_flag.is_none() && duration_flag.is_none() {
        if row.any_app_usage_flags != "[]" {
            *row.edit_classification().any_app_usage_flags = "[]".into();
        }
    } else {
        let value = match (gap_flag, duration_flag) {
            (Some(gap), Some(duration)) => format!("['{gap}', '{duration}']"),
            (Some(gap), None) => format!("['{gap}']"),
            (None, Some(duration)) => format!("['{duration}']"),
            (None, None) => unreachable!("handled empty flags above"),
        };
        if row.any_app_usage_flags.as_str() != value {
            *row.edit_classification().any_app_usage_flags = value.into();
        }
    }
}

pub(crate) fn mark_app_usage_flags(
    rows: &mut [Row],
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
) {
    let thresholds = prepare_usage_flags(
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    for row in rows {
        mark_app_usage_flags_row(row, &thresholds);
    }
}

pub(crate) fn clear_filtered_usage_timing_row(row: &mut Row) {
    if row.interaction_type == FILTERED_APP_USAGE
        && (row.start_timestamp_ns.is_some()
            || row.stop_timestamp_ns.is_some()
            || row.duration_seconds.is_some()
            || row.duration_minutes.is_some())
    {
        let data = row.edit_temporal();
        *data.start_timestamp_ns = None;
        *data.stop_timestamp_ns = None;
        *data.duration_seconds = None;
        *data.duration_minutes = None;
    }
}

pub(crate) fn clear_filtered_usage_timing(rows: &mut [Row]) {
    for row in rows {
        clear_filtered_usage_timing_row(row);
    }
}

/// Append one flag to the existing in-row flag list.
///
/// `any_app_usage_flags` already carries this pipeline's long-usage and
/// long-gap flags in `['A', 'B']` form, so Culverhouse's `event_flags` reuse
/// that column rather than adding a parallel one. Flags are only ever added,
/// never replaced, which is what makes them additive evidence of every
/// mutation applied to the row.
pub(crate) fn push_row_flag(row: &mut Row, flag: &str) {
    let current = row.any_app_usage_flags.as_str();
    let value = match current.strip_suffix(']') {
        Some(body) if body != "[" => format!("{body}, '{flag}']"),
        _ => format!("['{flag}']"),
    };
    *row.edit_classification().any_app_usage_flags = value.into();
}

/// `truncated_secs`, stamped in-row. The amount is part of the flag rather
/// than a new column so a run under this policy stays schema-compatible with
/// one that has it off.
pub(crate) fn push_truncation_flag(row: &mut Row, truncated_ns: i64) {
    let seconds = truncated_ns as f64 / 1_000_000_000.0;
    push_row_flag(
        row,
        &format!("{CULVERHOUSE_TRUNCATED_FLAG_PREFIX}{} S", js_number_to_string(seconds)),
    );
}

/// A row that carries a real interval this policy can act on.
pub(crate) fn culverhouse_span_ns(row: &Row) -> Option<(i64, i64)> {
    match (row.start_timestamp_ns, row.stop_timestamp_ns) {
        (Some(start), Some(stop)) if stop >= start => Some((start, stop)),
        _ => None,
    }
}

/// Rewrite a row's stop to `start + span_ns` and recompute both duration
/// columns from it. Durations are only rewritten when the row already had
/// them: a row whose duration was nulled by the minimum-usage floor keeps its
/// null, because truncation is not a reason to invent a duration.
///
/// Truncation and collapse are both downstream cleaning operations: neither
/// may reopen the already-settled B04 decision. A row the foundational floor
/// refused to credit therefore stays refused through either operation.
pub(crate) fn culverhouse_truncate_row(row: &mut Row, start: i64, span_ns: i64) {
    let seconds = span_ns as f64 / 1_000_000_000.0;
    let had_duration = row.duration_seconds.is_some() || row.duration_minutes.is_some();
    let data = row.edit_temporal();
    *data.stop_timestamp_ns = Some(start + span_ns);
    if had_duration {
        *data.duration_seconds = Some(seconds);
        *data.duration_minutes = Some(seconds / 60.0);
    }
}

/// Rewrite the collapse survivor to span `start .. start + span_ns` without
/// asking B04 a second time. Cleaning may change this method's presented span,
/// but the one pre-concurrency qualification/disposition remains authoritative.
/// A row already blanked by B04 (or by the separate post-split floor) stays
/// blank; an eligible row receives the merged duration.
pub(crate) fn culverhouse_merge_row(row: &mut Row, start: i64, span_ns: i64) {
    let seconds = span_ns as f64 / 1_000_000_000.0;
    let had_duration = row.duration_seconds.is_some() || row.duration_minutes.is_some();
    let data = row.edit_temporal();
    *data.stop_timestamp_ns = Some(start + span_ns);
    if had_duration {
        *data.duration_seconds = Some(seconds);
        *data.duration_minutes = Some(seconds / 60.0);
    }
}

/// The partition key a scope groups by. Widening the scope only ever appends,
/// so a wider scope can split a sequence but can never merge two.
pub(crate) type SessionPartitionKey = (
    Option<SharedString>,
    SharedString,
    Option<SharedString>,
);

pub(crate) fn session_partition_key(row: &Row, scope: SessionBoundaryScope) -> SessionPartitionKey {
    (
        scope.reads_study().then(|| row.study_id.clone()),
        row.participant_id.clone(),
        scope.reads_person().then(|| row.username.clone()),
    )
}

/// Number each app episode's usage session under the selected policy.
///
/// Four properties are easy to get wrong from a paper's prose, so they are
/// stated here and pinned by tests:
///
/// 1. The gap is the NEXT episode's start minus the measuring point's stop —
///    under the published basis the previous episode's stop — never
///    start-to-start and never end-to-end.
/// 2. The id increments on the episode AFTER a breaking gap, which is the
///    episode that begins the new session.
/// 3. Ids start at 0 within each partition.
/// 4. Apps are not distinguished — two different packages 1 s apart are one
///    session. Only Ross adds a package clause, and only because a polled
///    stream gives no other switch signal.
///
/// Episodes are visited in start order within each partition, but ids are
/// written back in place so the output's own row order is untouched.
pub(crate) fn assign_usage_session_ids(rows: &mut [Row], rules: SessionGroupingRules) {
    let Some(threshold) = rules.policy.gap_threshold() else {
        return;
    };
    let boundary_breaks = rules.policy.boundary_gap_starts_new_session();
    let package_breaks = rules.policy.package_change_ends_session();

    let mut by_partition: AHashMap<SessionPartitionKey, Vec<usize>> = AHashMap::new();
    for (index, row) in rows.iter().enumerate() {
        // An episode with no interval cannot be placed relative to its
        // neighbours, so it is left unnumbered rather than guessed into a
        // session. End-of-Usage-Missing rows are exactly this case.
        if is_culverhouse_usage_row(row)
            && row.start_timestamp_ns.is_some()
            && row.stop_timestamp_ns.is_some()
        {
            by_partition
                .entry(session_partition_key(row, rules.scope))
                .or_default()
                .push(index);
        }
    }

    for (_, mut order) in by_partition {
        order.sort_by_key(|&index| {
            (
                rows[index].start_timestamp_ns.unwrap_or(i64::MIN),
                // A tie on start is broken by the row's own position so the
                // numbering is a function of the data and not of hash order.
                index,
            )
        });
        // Comparisons happen in DOUBLED nanoseconds: an even interval count
        // makes Peng & Zhu's median the mean of the two middle gaps, which can
        // end in half a nanosecond, and doubling defers that halving so every
        // comparison stays integer-exact. For the fixed arms `2*gap > 2*t` is
        // exactly `gap > t`, so their output cannot move. i128 because a
        // doubled i64 difference does not fit i64 at the extremes.
        let doubled_threshold: Option<i128> = match threshold {
            SessionGapThreshold::FixedNs(ns) => Some(2 * i128::from(ns)),
            SessionGapThreshold::PartitionMedian => doubled_median_gap_ns(rows, &order),
        };
        let interval_count = order.len().saturating_sub(1);
        let mut session = 0_i64;
        let mut previous: Option<usize> = None;
        // The furthest stop placed in the CURRENT session. Only read under
        // `SessionRunningMaximumStop`; maintained unconditionally so the two
        // bases differ in one comparison rather than in two code paths.
        let mut session_max_stop = i64::MIN;
        for &index in &order {
            let this_start = rows[index].start_timestamp_ns.unwrap_or(i64::MIN);
            let this_stop = rows[index].stop_timestamp_ns.unwrap_or(i64::MIN);
            let mut lineage: Option<String> = None;
            if let Some(previous_index) = previous {
                let measured_from = match rules.gap_basis {
                    SessionGapBasis::PreviousEpisodeStop => {
                        rows[previous_index].stop_timestamp_ns.unwrap_or(i64::MIN)
                    }
                    SessionGapBasis::SessionRunningMaximumStop => session_max_stop,
                };
                let gap = this_start - measured_from;
                let doubled_gap = 2 * i128::from(gap);
                // A second episode in the partition implies at least one
                // interval, so the median exists whenever it is compared.
                let doubled_threshold =
                    doubled_threshold.expect("a compared partition has an interval");
                let gap_breaks = if boundary_breaks {
                    doubled_gap >= doubled_threshold
                } else {
                    doubled_gap > doubled_threshold
                };
                // Ross's second clause reads the immediately preceding
                // record's package, and is unaffected by which endpoint the
                // GAP is measured from.
                let switched = package_breaks
                    && rows[previous_index].app_package_name != rows[index].app_package_name;
                if gap_breaks || switched {
                    session += 1;
                    session_max_stop = i64::MIN;
                }
                if rules.emit_lineage {
                    let verdict = if gap_breaks || switched {
                        "BREAK"
                    } else {
                        "JOIN"
                    };
                    let seconds = gap as f64 / 1_000_000_000.0;
                    let app_change = if switched { " APP CHANGE" } else { "" };
                    lineage = Some(format!(
                        "SESSION {session} {verdict} GAP {} S{app_change}",
                        js_number_to_string(seconds)
                    ));
                }
            } else if rules.emit_lineage {
                let mut open = format!("SESSION {session} OPEN");
                // Under the individualized arm the derived threshold is not in
                // the options, so the export itself must carry it: the OPEN
                // flag names the partition's median and how many intervals it
                // was computed over. A one-episode partition has no intervals
                // and no median to name.
                if threshold == SessionGapThreshold::PartitionMedian {
                    if let Some(doubled) = doubled_threshold {
                        let seconds = doubled as f64 / 2e9;
                        open.push_str(&format!(
                            " MEDIAN {} S N {interval_count}",
                            js_number_to_string(seconds)
                        ));
                    }
                }
                lineage = Some(open);
            }
            session_max_stop = session_max_stop.max(this_stop);
            *rows[index].edit_classification().usage_session_id = Some(session);
            if let Some(flag) = lineage {
                push_row_flag(&mut rows[index], &flag);
            }
            previous = Some(index);
        }
    }
}

/// The doubled median of a partition's previous-stop → next-start intervals.
///
/// Peng & Zhu's own statistic — the elapsed time between two consecutive app
/// uses — measured over the sorted order the walk itself visits. It is ALWAYS
/// measured from the immediately preceding episode's stop, never from the
/// running-maximum basis: under that basis a gap depends on which episodes the
/// walk has already placed in the session, so a threshold derived from it
/// would be circular. Selecting `session_gap_basis` stays an orthogonal,
/// documented departure that changes only the comparison, not the statistic.
///
/// Returns the DOUBLED median: an even count's median is the mean of the two
/// middle values, so its double is exactly their sum and no precision is ever
/// dropped. Overlapping episodes yield negative intervals and enter the median
/// as measured — the statistic is the same quantity the walk compares.
///
/// `None` iff the partition has fewer than two episodes, in which case the
/// walk never reaches a comparison.
pub(crate) fn doubled_median_gap_ns(rows: &[Row], order: &[usize]) -> Option<i128> {
    let mut gaps: Vec<i128> = order
        .windows(2)
        .map(|pair| {
            let previous_stop = rows[pair[0]].stop_timestamp_ns.unwrap_or(i64::MIN);
            let next_start = rows[pair[1]].start_timestamp_ns.unwrap_or(i64::MIN);
            i128::from(next_start) - i128::from(previous_stop)
        })
        .collect();
    if gaps.is_empty() {
        return None;
    }
    gaps.sort_unstable();
    let middle = gaps.len() / 2;
    Some(if gaps.len() % 2 == 1 {
        2 * gaps[middle]
    } else {
        gaps[middle - 1] + gaps[middle]
    })
}

/// Is this a reconstructed usage interval, as opposed to a raw event row that
/// happens to be travelling in the same table?
pub(crate) fn is_culverhouse_usage_row(row: &Row) -> bool {
    row.interaction_type == APP_USAGE || row.interaction_type == FILTERED_APP_USAGE
}

/// Culverhouse "block": adjacent same-app rows with gap <= 1 s are one usage.
///
/// Adjacency is measured inside each app's OWN sequence, not the shared
/// stream: the tool sorts by `(participant_id, interaction_type,
/// app_package_name, start_posix)` and takes `lag(stop_for_logic)` within that
/// group (`clean_preprocessed.R:313-318`). So another package's row landing
/// between two rows of the same app is not a separator — flicking to a second
/// app for a moment and coming straight back is exactly the "multiple app
/// instances reflect one usage" case the block folds. Raw event rows carrying
/// no interval are likewise stepped over; they are not app instances.
///
/// The merged row keeps the earlier start and the later stop. It does NOT
/// absorb the other row's `source_data_rows` — see the comment on the merge
/// itself: identity is fixed downstream of `reconstruct_episodes`, so a
/// collapse is a drop of the absorbed row plus a temporal extension of the
/// survivor. This is the one operation in the policy that changes row count.
///
/// An overlap is a negative gap, which is inside the threshold, so two
/// same-app rows that overlap are one usage as well; the merged span is
/// `max(stop) - earliest start`, so overlapping time is counted once.
///
/// `usage_layer` is part of the identity test. Under
/// `model_concurrent_usage`, `segment_concurrent_usage` splits one session into
/// layered sub-intervals that tile it with gap exactly 0 — inside this
/// threshold. Without the layer test the collapse would re-fuse every split
/// session back into one row carrying only the first piece's layer, silently
/// reverting the concurrency model while stamping the result as a same-app
/// deduplication. Worse, the other app's overlapping primary row is untouched,
/// so `build_review_summary` would count the overlap window as foreground time
/// twice instead of reclassifying it.
pub(crate) fn culverhouse_collapse_same_app(rows: Vec<Row>) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::with_capacity(rows.len());
    // Index into `out` of the last usage row of each app sequence — the tool's
    // grouping key, plus the usage layer, which splits a row this pipeline
    // layered over another and the tool has no notion of — with that row's
    // duration-rule state. A row merges only into the immediately preceding
    // row of its sequence and only when their states agree: keying the map on
    // the state instead would let a row reach back across an intervening row
    // of another state and bridge (and credit) its time.
    type SequenceKey = (SharedString, SharedString, SharedString, Option<SharedString>);
    type RuleState = (
        Option<bool>,
        bool,
        bool,
        bool,
        Option<SharedString>,
        bool,
        bool,
    );
    let mut last_usage: AHashMap<SequenceKey, (usize, RuleState)> = AHashMap::new();
    for row in rows {
        if !is_culverhouse_usage_row(&row) {
            out.push(row);
            continue;
        }
        let key: SequenceKey = (
            row.participant_id.clone(),
            row.interaction_type.clone(),
            row.app_package_name.clone(),
            row.usage_layer.clone(),
        );
        let state: RuleState = (
            row.minimum_duration_qualified,
            row.minimum_duration_aggregate_eligible,
            row.minimum_duration_blank_applied,
            row.concurrent_subinterval_floor_blank_applied,
            row.micro_use_classification
                .map(|classification| classification.canonical_id().into()),
            row.raw_episode_duration_ns == Some(0),
            // A maximum-duration `retain_but_exclude` row must not be absorbed
            // into an eligible neighbour: the merged survivor would credit it.
            row.maximum_duration_aggregate_eligible,
        );
        let previous = last_usage
            .get(&key)
            .filter(|(_, previous_state)| *previous_state == state)
            .map(|(previous, _)| *previous);
        let merged = match (previous, culverhouse_span_ns(&row)) {
            (Some(previous), Some((start, stop))) => {
                let previous_row = &out[previous];
                match culverhouse_span_ns(previous_row) {
                    Some((previous_start, previous_stop))
                        if start - previous_stop <= CULVERHOUSE_SAME_APP_COLLAPSE_NS =>
                    {
                        let target = &mut out[previous];
                        let span = stop.max(previous_stop) - previous_start;
                        culverhouse_merge_row(target, previous_start, span);
                        // The absorbed row's `source_data_rows` are deliberately
                        // NOT merged into the survivor. `source_data_rows` is
                        // part of the row identity checkpoint, and everything
                        // downstream of `reconstruct_episodes` — including the
                        // persisted reconstruction base, whose row dispositions
                        // are reuse / replacement / drop — requires the
                        // annotation rows to stay an identity-preserving
                        // subsequence of the reconstruction rows. Collapsing is
                        // therefore a drop of the absorbed row plus a temporal
                        // extension of the survivor, exactly like the other
                        // row-removing steps in this cone; the survivor keeps
                        // its own lineage and carries the collapse flag.
                        push_row_flag(target, CULVERHOUSE_COLLAPSED_FLAG);
                        true
                    }
                    _ => false,
                }
            }
            _ => false,
        };
        if !merged {
            // A usage row with no usable interval (an end-of-usage-missing row,
            // or one whose stop precedes its start) is not an app instance
            // either, so it is stepped over rather than made the new merge
            // target. Otherwise it would silently separate two rows that are
            // one usage.
            if culverhouse_span_ns(&row).is_some() {
                last_usage.insert(key, (out.len(), state));
            }
            out.push(row);
        }
    }
    out
}

/// The bad-apps per-package cap and the `long_3h` / `long_6h` bands, decided
/// together from each row's reconstructed length.
///
/// Both rules read the SAME span and both actions truncate to the SAME
/// 10-minute bound, so they are evaluated in one pass rather than chained. Run
/// as two passes, whichever ran first would hide the other: capping first
/// bounds every excluded-package row to 10 minutes and makes the whole
/// `Filtered App Usage` class structurally unable to earn a band, and banding
/// first consumes the truncation the cap would otherwise report.
///
/// The bad-apps class is this pipeline's own excluded-package set, which
/// `apply_app_inclusion_policy` has already relabelled to
/// `Filtered App Usage` and stripped of its duration columns;
/// `clear_filtered_usage_timing_row` then blanks the interval as well. Between
/// them the default path keeps no time at all for a bad app, which throws away
/// the brief legitimate use Culverhouse explicitly keeps. This is the
/// substantive difference the policy makes: cap and credit, instead of blank.
/// The duration columns are therefore recomputed for every bad-app row with an
/// interval, capped or not — that credited-but-bounded time is what the cap
/// exists to produce.
///
/// The two bands are mutually exclusive by construction: a row takes the
/// `long_6h` arm or the `long_3h` arm, never both. The `long_6h` action
/// truncates to the 10-minute bad-app cap, not to 6 h — the 6 h boundary
/// decides *whether* the row is implausible, not what a plausible length would
/// have been. Band scope is every row that carries an interval, not only
/// `App Usage`; the cap's scope is the excluded-package rows only.
pub(crate) fn culverhouse_bound_implausible_intervals(rows: &mut [Row]) {
    for row in rows.iter_mut() {
        let Some((start, stop)) = culverhouse_span_ns(row) else {
            continue;
        };
        let span = stop - start;
        let is_bad_app = row.interaction_type == FILTERED_APP_USAGE;
        // A bad-app row keeps its measured time up to the cap; the 6 h band
        // truncates to the same bound. Anything else keeps its full span.
        let mut bound = span;
        if is_bad_app
            && !row.minimum_duration_blank_applied
            && !row.concurrent_subinterval_floor_blank_applied
        {
            bound = bound.min(CULVERHOUSE_BAD_APP_CAP_NS);
        }
        if span >= CULVERHOUSE_LONG_6H_NS {
            push_row_flag(row, CULVERHOUSE_LONG_6H_FLAG);
            // Reporting the band and acting on it are two different
            // comparisons in the reference, and the difference is not a slip:
            // the flag is `duration_secs >= long_6h_secs`
            // (`clean_preprocessed.R:367`) while the truncation requires
            // `duration_for_action_input > config$long_6h_secs` (:444). A row
            // sitting exactly on six hours is reported as long and kept whole.
            if span > CULVERHOUSE_LONG_6H_NS {
                bound = bound.min(CULVERHOUSE_BAD_APP_CAP_NS);
            }
        } else if span >= CULVERHOUSE_LONG_3H_NS {
            push_row_flag(row, CULVERHOUSE_LONG_3H_FLAG);
        }
        if is_bad_app && span > CULVERHOUSE_BAD_APP_CAP_NS {
            push_row_flag(row, CULVERHOUSE_BAD_APP_CAP_FLAG);
        }
        if bound < span {
            culverhouse_truncate_row(row, start, bound);
            push_truncation_flag(row, span - bound);
        }
        if is_bad_app
            && !row.minimum_duration_blank_applied
            && !row.concurrent_subinterval_floor_blank_applied
        {
            // Credit the bounded time even when nothing was removed: the
            // upstream package policy nulled these duration columns. A B04 or
            // post-split-floor blank is a settled scientific disposition and
            // must not be reopened by downstream cleaning.
            let seconds = bound as f64 / 1_000_000_000.0;
            let data = row.edit_temporal();
            *data.duration_seconds = Some(seconds);
            *data.duration_minutes = Some(seconds / 60.0);
        }
    }
}

/// The instant local calendar day `date` begins in `tz`.
///
/// Midnight is not guaranteed to exist. A spring-forward scheduled at 00:00 —
/// Chile, Cuba, Lebanon and others do this — deletes the whole 00:00 hour, so
/// `from_local_datetime` answers `None` and the day actually opens at 01:00.
/// A fall-back that doubles midnight answers `Ambiguous`, and the day opens at
/// the earlier of the two. Adding 86_400 seconds to the previous midnight
/// would be wrong in both directions.
pub(crate) fn local_day_start_ns(date: NaiveDate, tz: Tz) -> Option<i64> {
    for minute in 0..(3 * 60) {
        let Some(local) = date.and_hms_opt(minute / 60, minute % 60, 0) else {
            continue;
        };
        let resolved = match tz.from_local_datetime(&local) {
            chrono::LocalResult::Single(instant) => instant,
            chrono::LocalResult::Ambiguous(earlier, _) => earlier,
            chrono::LocalResult::None => continue,
        };
        return resolved.timestamp_nanos_opt();
    }
    None
}

/// Every local midnight strictly inside `(start_ns, stop_ns)` in `tz`.
///
/// Walking calendar dates rather than fixed 24-hour steps is what makes a
/// daylight-saving day 23 or 25 hours long instead of an assumed 24.
pub(crate) fn local_midnights_within(start_ns: i64, stop_ns: i64, tz: Tz) -> Vec<i64> {
    let mut boundaries = Vec::new();
    if stop_ns <= start_ns {
        return boundaries;
    }
    let mut date = ts_to_local(start_ns, tz).date_naive();
    while let Some(next) = date.succ_opt() {
        date = next;
        let Some(instant) = local_day_start_ns(date, tz) else {
            continue;
        };
        if instant >= stop_ns {
            break;
        }
        if instant > start_ns {
            boundaries.push(instant);
        }
    }
    boundaries
}

/// B14: divide every session that runs past local midnight into one row per
/// calendar day it touches.
///
/// Each part carries the same raw source evidence as the whole, because each
/// part IS the same observation — the division is an attribution decision, not
/// a claim that more was observed. Duration columns are recomputed per part,
/// except where an upstream policy deliberately blanked them: a B04 blank or a
/// concurrent-subinterval floor is a settled scientific disposition about the
/// session, and every part inherits it rather than reopening it with a fresh
/// number.
pub(crate) fn split_sessions_at_local_midnight(rows: Vec<Row>, rule: DayBoundaryAttribution) -> Vec<Row> {
    if !rule.divides_sessions() {
        return rows;
    }
    let mut out: Vec<Row> = Vec::with_capacity(rows.len());
    let mut date_memo = LocalDateMemo::default();
    for row in rows {
        let (Some(start), Some(stop)) = (row.start_timestamp_ns, row.stop_timestamp_ns) else {
            out.push(row);
            continue;
        };
        let Ok(tz) = row.timezone.parse::<Tz>() else {
            out.push(row);
            continue;
        };
        let boundaries = local_midnights_within(start, stop, tz);
        if boundaries.is_empty() {
            out.push(row);
            continue;
        }
        let blanked = row.duration_seconds.is_none();
        let mut edges = Vec::with_capacity(boundaries.len() + 2);
        edges.push(start);
        edges.extend(boundaries);
        edges.push(stop);
        for (part, window) in edges.windows(2).enumerate() {
            let (left, right) = (window[0], window[1]);
            let mut piece = row.clone();
            piece.event_timestamp_ns = left;
            let data = piece.edit_temporal();
            *data.start_timestamp_ns = Some(left);
            *data.stop_timestamp_ns = Some(right);
            if blanked {
                *data.duration_seconds = None;
                *data.duration_minutes = None;
            } else {
                let seconds = (right - left) as f64 / 1_000_000_000.0;
                *data.duration_seconds = Some(seconds);
                *data.duration_minutes = Some(seconds / 60.0);
            }
            // The first part keeps the session's own index. Later parts move
            // into a disjoint band so no two rows share an index, mirroring
            // the offset `add_no_activity_placeholder_rows` uses. Emission
            // order is unaffected: every consumer sorts on
            // `event_timestamp_ns` first, and each part carries its own start.
            //
            // `index` is an IDENTITY field, so it is written through the
            // identity view. It used to be written through `edit_temporal()`
            // above, which clears only the temporal memo; the identity memo
            // survived that write and was saved from publishing a stale digest
            // only by the `piece.event_timestamp_ns` assignment two statements
            // earlier going through `DerefMut`, which clears all three. The
            // views make that accident a type error.
            *piece.edit_identity().index = row.index.saturating_add(part * 4_000_000);
            populate_time_columns(&mut piece, tz, &mut date_memo);
            out.push(piece);
        }
    }
    out
}

/// Does the local calendar day `date` contain a UTC-offset change in `tz`?
///
/// A spring-forward gap makes some local wall time non-existent and a
/// fall-back makes one ambiguous; both are answered directly by
/// `from_local_datetime`, so the check covers midnight transitions as well as
/// the usual 2 a.m. ones.
pub(crate) fn culverhouse_is_dst_day(date: NaiveDate, tz: Tz) -> bool {
    let mut offset: Option<i32> = None;
    for hour in [0_u32, 12, 23] {
        let Some(local) = date.and_hms_opt(hour, 0, 0) else {
            continue;
        };
        match tz.from_local_datetime(&local) {
            chrono::LocalResult::Single(resolved) => {
                let seconds = resolved.offset().fix().local_minus_utc();
                match offset {
                    Some(previous) if previous != seconds => return true,
                    Some(_) => {}
                    None => offset = Some(seconds),
                }
            }
            // Non-existent or doubled wall time: the day carries a transition.
            _ => return true,
        }
    }
    false
}

/// `partial_day` and `DST_day` — flag and retain, never drop.
///
/// `partial_day` covers each participant's first and last observed day plus
/// the days on either side of a data gap of at least 12 h. Culverhouse
/// restricts the gap rule to PARENT devices; this contract carries no
/// device-class column, so the rule is applied to every participant here. That
/// difference is recorded rather than silently absorbed.
pub(crate) fn culverhouse_flag_days(rows: &mut [Row]) {
    if rows.is_empty() {
        return;
    }
    let mut first_last: AHashMap<SharedString, (SharedString, SharedString)> = AHashMap::new();
    let mut partial: AHashSet<(SharedString, SharedString)> = AHashSet::new();
    let mut previous_by_participant = AHashMap::<SharedString, (SharedString, SharedString)>::new();
    for row in rows.iter() {
        if row.date.as_str().is_empty() {
            continue;
        }
        let key = (row.participant_id.clone(), row.date.clone());
        first_last
            .entry(row.participant_id.clone())
            .and_modify(|(first, last)| {
                if row.date.as_str() < first.as_str() {
                    *first = row.date.clone();
                }
                if row.date.as_str() > last.as_str() {
                    *last = row.date.clone();
                }
            })
            .or_insert_with(|| (row.date.clone(), row.date.clone()));
        // `clean_preprocessed.R:590` filters `gap_hours > config$long_gap_hours`:
        // the boundary days are the ones on either side of a gap that exceeds
        // twelve hours, not one that reaches it.
        if row.data_time_gap_hours > CULVERHOUSE_PARTIAL_DAY_GAP_HOURS {
            partial.insert(key.clone());
            if let Some(before) = previous_by_participant.get(&row.participant_id) {
                partial.insert(before.clone());
            }
        }
        previous_by_participant.insert(row.participant_id.clone(), key);
    }
    for (participant, (first, last)) in first_last {
        partial.insert((participant.clone(), first));
        partial.insert((participant, last));
    }

    let mut dst_cache: AHashMap<(SharedString, SharedString), bool> = AHashMap::new();
    for row in rows.iter_mut() {
        if row.date.as_str().is_empty() {
            continue;
        }
        if partial.contains(&(row.participant_id.clone(), row.date.clone())) {
            push_row_flag(row, CULVERHOUSE_PARTIAL_DAY_FLAG);
        }
        let dst_key = (row.date.clone(), row.timezone.clone());
        let is_dst = *dst_cache.entry(dst_key).or_insert_with(|| {
            let Ok(date) = NaiveDate::parse_from_str(row.date.as_str(), "%Y-%m-%d") else {
                return false;
            };
            let tz: Tz = row.timezone.parse().unwrap_or(Tz::UTC);
            culverhouse_is_dst_day(date, tz)
        });
        if is_dst {
            push_row_flag(row, CULVERHOUSE_DST_DAY_FLAG);
        }
    }
}

/// The whole Culverhouse program: collapse same-app rows, bound the
/// implausible intervals (bad-app cap and the long bands together), then flag
/// the days.
///
/// Collapse runs first because merging two rows changes the length the next
/// step judges. The cap and the bands are one step, not two, because both read
/// the same span and both truncate to the same bound — see
/// `culverhouse_bound_implausible_intervals`.
#[allow(private_interfaces)]
pub(crate) fn culverhouse_trim_and_log(mut rows: Vec<Row>) -> Vec<Row> {
    // Reconstruction blanks a filtered row's interval for the default policy,
    // which left the bad-app cap nothing to cap. Its raw episode is kept, so
    // the interval Culverhouse credits comes back from there, less any tail a
    // maximum-duration truncation already trimmed from it.
    for row in rows.iter_mut().filter(|row| {
        row.interaction_type == FILTERED_APP_USAGE
            && row.start_timestamp_ns.is_none()
            && row.stop_timestamp_ns.is_none()
    }) {
        if let (Some(start), Some(stop)) = (
            row.raw_episode_start_timestamp_ns,
            row.raw_episode_stop_timestamp_ns,
        ) {
            let data = row.edit_temporal();
            *data.start_timestamp_ns = Some(start);
            *data.stop_timestamp_ns = Some(stop - data.maximum_duration_trimmed_ns.unwrap_or(0));
        }
    }
    let mut rows = culverhouse_collapse_same_app(rows);
    culverhouse_bound_implausible_intervals(&mut rows);
    culverhouse_flag_days(&mut rows);
    rows
}

pub(crate) fn apply_review_annotations_one_pass(
    rows: &mut [Row],
    custom_app_engagement_duration: f64,
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
    interval_quality_policy: IntervalQualityPolicy,
) {
    let thresholds = prepare_usage_flags(
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    // The fused walk inlines `suppress_excluded_timing` for speed. Under a
    // policy that does not blank, the caller runs the whole step through
    // `interval_quality_step` instead, so the inline copy must stand down.
    let blank = interval_quality_policy.blanks_filtered_timing();
    walk_app_usage_detail_columns(rows, custom_app_engagement_duration, |row| {
        mark_app_usage_flags_row(row, &thresholds);
        if blank {
            clear_filtered_usage_timing_row(row);
        }
    });
}

#[allow(private_interfaces)]
// Seven inputs because the fused walk deliberately reads every annotation input
// in one pass; grouping them into a struct would only move the same list.
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_static_review_annotations_fused(
    rows: &mut [Row],
    filtered_packages: &BTreeSet<String>,
    codebook_enabled: bool,
    codebook_map: &HashMap<String, CodebookEntry>,
    custom_app_engagement_duration: f64,
    long_data_time_gap_thresholds: &[f64],
    long_usage_duration_thresholds: &[f64],
    interval_quality_policy: IntervalQualityPolicy,
) {
    // Single fused pass: junk relabel + codebook are applied per-row BEFORE
    // the engagement walk reads interaction_type (which apply_app_inclusion_policy
    // changes from APP_USAGE to FILTERED_APP_USAGE). The engagement walk
    // carries sequential state (previous_any/previous_valid) across rows.
    // After each row's engagement columns are computed, flags + clear run.
    let has_junk = !filtered_packages.is_empty();
    let broad_indices = codebook_enabled.then(|| codebook_col_indices(BROAD_CATEGORY_COLUMNS));
    let genre_indices = codebook_enabled.then(|| codebook_col_indices(GENRE_ID_COLUMNS));
    let thresholds = prepare_usage_flags(
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
    );
    // See `apply_review_annotations_one_pass`: the inline blanking is an
    // optimization of `suppress_excluded_timing`, and a policy that caps
    // instead of blanking owns that step itself.
    let blank = interval_quality_policy.blanks_filtered_timing();
    walk_app_usage_detail_columns_with_pre(
        rows,
        custom_app_engagement_duration,
        |row| {
            if has_junk && filtered_packages.contains(row.app_package_name.as_str()) {
                if row.interaction_type == APP_USAGE {
                    *row.edit_classification().interaction_type = FILTERED_APP_USAGE.into();
                    let temporal = row.edit_temporal();
                    *temporal.duration_seconds = None;
                    *temporal.duration_minutes = None;
                } else if row.interaction_type == ACTIVITY_STOPPED {
                    *row.edit_classification().interaction_type = FILTERED_STOPPED.into();
                    let temporal = row.edit_temporal();
                    *temporal.start_timestamp_ns = None;
                    *temporal.stop_timestamp_ns = None;
                    *temporal.duration_seconds = None;
                    *temporal.duration_minutes = None;
                } else {
                    let temporal = row.edit_temporal();
                    *temporal.start_timestamp_ns = None;
                    *temporal.stop_timestamp_ns = None;
                    *temporal.duration_seconds = None;
                    *temporal.duration_minutes = None;
                }
            }
            if let (Some(broad), Some(genre)) = (broad_indices, genre_indices) {
                join_codebook_row(row, codebook_map);
                derive_broad_category_row(row, broad);
                collapse_app_genre_row(row, genre);
            }
        },
        |row| {
            mark_app_usage_flags_row(row, &thresholds);
            if blank {
                clear_filtered_usage_timing_row(row);
            }
        },
    );
}

pub(crate) fn derive_broad_category_step(mut rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    derive_broad_category(&mut rows, enabled);
    rows
}

pub(crate) fn collapse_app_genre_step(mut rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    collapse_app_genre(&mut rows, enabled);
    rows
}

pub(crate) fn derive_engagement_basis(
    mut rows: Vec<Row>,
    custom_app_engagement_duration: f64,
) -> Vec<Row> {
    add_app_usage_detail_columns(&mut rows, custom_app_engagement_duration);
    rows
}

pub(crate) fn apply_episode_flags(
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

pub(crate) fn suppress_excluded_timing(mut rows: Vec<Row>) -> Vec<Row> {
    clear_filtered_usage_timing(&mut rows);
    rows
}

/// Dispatch the declared interval-quality policy.
///
/// This is the single seam where an `IntervalQualityPolicyId` becomes a
/// runtime choice, and it is a *different* axis from the reconstruction seam
/// in `match_app_episodes_with_strategy`. Reconstruction decides where an
/// episode begins and ends. This decides what to do about an already
/// reconstructed interval that is implausible. Culverhouse never redefines
/// episodes, so it is not a reconstruction rule and is not selectable as one.
///
/// Every arm consumes and produces the same row table, so everything
/// downstream — cleaning, crediting, attribution, output — is unchanged by the
/// choice apart from the row values themselves.
///
/// `None` is the production path and reproduces the previous behaviour
/// exactly; the other arms are opt-in.
pub(crate) fn interval_quality_step(rows: Vec<Row>, policy: IntervalQualityPolicy) -> Vec<Row> {
    match policy {
        IntervalQualityPolicy::None => suppress_excluded_timing(rows),
        // Culverhouse subsumes this step rather than running after it: it caps
        // bad-app rows instead of blanking them, so the blanking must not have
        // happened first.
        IntervalQualityPolicy::CulverhouseTrimAndLog => culverhouse_trim_and_log(rows),
    }
}

pub(crate) fn remove_selected_interaction_types(
    rows: Vec<Row>,
    interaction_types_to_remove: &[String],
    long_data_time_gap_thresholds: &[f64],
    mode: InteractionTypeRemovalMode,
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
                || (mode == InteractionTypeRemovalMode::GapPreserving
                    && row.data_time_gap_hours >= threshold)
        })
        .collect()
}

pub(crate) fn remove_zero_duration_rows(rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    if !enabled {
        return rows;
    }
    rows.into_iter()
        // Immutable raw evidence identifies every reconstructed app episode,
        // including one later relabeled Filtered App Usage or blanked by B04.
        // The historical public-duration fallback remains inside the shared
        // predicate for non-episode APP_USAGE rows that predate raw evidence.
        .filter(|row| !is_zero_duration_cleanup_candidate(row))
        .collect()
}

pub(crate) fn enrich_codebook_rows(
    rows: &mut [Row],
    enabled: bool,
    codebook: &HashMap<String, CodebookEntry>,
) {
    join_codebook(rows, enabled, codebook);
    derive_broad_category(rows, enabled);
    collapse_app_genre(rows, enabled);
}

pub(crate) fn codebook_checkpoint_payload(codebook_is_empty: bool) -> serde_json::Value {
    serde_json::json!({"codebookIsEmpty": codebook_is_empty})
}

pub(crate) fn include_codebook_aliases(
    enabled: bool,
    codebook_is_empty: bool,
    include_category_column: bool,
) -> bool {
    !enabled || codebook_is_empty || include_category_column
}
