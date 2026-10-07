use chrono::Timelike;
use crate::pipeline_v2::{
    ACTIVITY_PAUSED, ACTIVITY_RESUMED, AHashMap, AHashSet, AMAZON_APPS, Arc, BTreeMap, BTreeSet,
    CsvReader, Datelike, HashMap, LocalDateMemo, RawRow, ReadFieldResult, Row, RowCountReport,
    RowData, SharedString, SharedStringPool, SourceDataRows, TimezoneSelection, Tz, b06,
    ecma_round_fixed_f64, empty_codebook_fields, empty_lineage_searches,
    parse_chronicle_timestamp_ns, parse_csv_to_records_with_physical_rows, source, ts_to_local,
    weekday_chronicle,
};

/// Return the nonblank `(study_id, participant_id)` identities produced by the
/// exact raw CSV decoder used by execution. A person is a participant within a
/// study: two studies may both enroll a "P01". In a file with at most one
/// nonblank study, blank study cells belong to that study, so such a file keys
/// exactly as many participants as it holds. This deliberately stays a
/// Rust-only helper: the runtime uses it to mint batch-scoped opaque inspection
/// tokens, while literal identifiers never cross the WASM/browser boundary.
pub fn canonical_raw_participant_keys(csv_bytes: &[u8]) -> BTreeSet<(String, String)> {
    let rows = source::decode_source_records(csv_bytes);
    let studies = rows
        .iter()
        .filter(|row| !row.study_id.is_empty())
        .map(|row| row.study_id.as_str())
        .collect::<BTreeSet<_>>();
    let only_study = match studies.len() {
        1 => studies.first().map(|study| study.to_string()),
        _ => None,
    };
    rows.iter()
        .filter(|row| !row.participant_id.is_empty())
        .map(|row| {
            let study = match &only_study {
                Some(study) if row.study_id.is_empty() => study.clone(),
                _ => row.study_id.clone(),
            };
            (study, row.participant_id.clone())
        })
        .collect()
}

/// Return the nonblank participant identities from the execution decoder.
/// Source-qualified adapters keep their existing participant-only boundary.
pub fn canonical_raw_participant_ids(csv_bytes: &[u8]) -> BTreeSet<String> {
    source::decode_source_records(csv_bytes)
        .into_iter()
        .filter_map(|row| (!row.participant_id.is_empty()).then_some(row.participant_id))
        .collect()
}

/// Walk a raw export's records with the study each one belongs to, exactly as
/// the execution decoder reads `study_id`: headers are trimmed and lose a
/// byte-order mark, the last duplicate header wins (the decoder maps names
/// through a HashMap), a short record has none, and the
/// value is trimmed. The header record comes first, untouched, with no study.
pub(crate) fn for_each_record_study(
    csv_bytes: &[u8],
    mut on_record: impl FnMut(Option<&str>, &csv::ByteRecord) -> Result<(), String>,
) -> Result<(), String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_bytes);
    let mut records = reader.byte_records();
    let Some(header) = records.next().transpose().map_err(|error| error.to_string())? else {
        return Ok(());
    };
    let column = header
        .iter()
        .rposition(|name| String::from_utf8_lossy(name).trim().trim_start_matches('\u{feff}') == "study_id");
    on_record(None, &header)?;
    for record in records {
        let record = record.map_err(|error| error.to_string())?;
        let study = column
            .and_then(|index| record.get(index))
            .map(String::from_utf8_lossy)
            .unwrap_or_default();
        on_record(Some(study.trim()), &record)?;
    }
    Ok(())
}

/// The studies a mixed raw export is split into before processing, sorted.
/// Empty unless there are at least two distinct nonblank study IDs, so a
/// single-study file (blank cells included) is never split. Each part is then
/// processed as its own file, which keys every grouping in the pipeline by
/// study and participant without a second code path.
pub(crate) fn raw_study_ids_to_split(csv_bytes: &[u8]) -> Vec<String> {
    let mut studies = BTreeSet::new();
    // A malformed file is left whole; inspection reports what is wrong with it.
    let scanned = for_each_record_study(csv_bytes, |study, _| {
        if let Some(study) = study.filter(|study| !studies.contains(*study)) {
            studies.insert(study.to_string());
        }
        Ok(())
    });
    let blank = studies.remove("");
    if scanned.is_err() || studies.len() < 2 {
        return Vec::new();
    }
    // ponytail: blank-study rows in a mixed file become their own part; there
    // is no study to attach them to. Attribute them if exports ever carry them.
    if blank {
        studies.insert(String::new());
    }
    studies.into_iter().collect()
}

/// Split a raw export that mixes studies into one part per study: the header
/// plus that study's records, all columns and source order kept. Empty for a
/// single-study file, and for a file the CSV reader cannot walk (inspection
/// then reports it whole). One scan decides; one more pass writes every part.
pub fn split_raw_by_study(csv_bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut writers = raw_study_ids_to_split(csv_bytes)
        .into_iter()
        .map(|study| {
            let writer = csv::WriterBuilder::new()
                .flexible(true)
                .from_writer(Vec::new());
            (study, writer)
        })
        .collect::<BTreeMap<_, _>>();
    if writers.is_empty() {
        return Vec::new();
    }
    let written = for_each_record_study(csv_bytes, |study, record| {
        let targets: Vec<&mut csv::Writer<Vec<u8>>> = match study {
            None => writers.values_mut().collect(),
            Some(study) => writers.get_mut(study).into_iter().collect(),
        };
        for writer in targets {
            writer
                .write_byte_record(record)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    });
    if written.is_err() {
        return Vec::new();
    }
    writers
        .into_iter()
        .map(|(study, writer)| writer.into_inner().ok().map(|bytes| (study, bytes)))
        .collect::<Option<_>>()
        .unwrap_or_default()
}

pub(crate) fn populate_time_columns(row: &mut Row, tz: Tz, date_memo: &mut LocalDateMemo) {
    let local = ts_to_local(row.event_timestamp_ns, tz);
    let data = row.edit_temporal();
    *data.date = date_memo.date_string(local.year(), local.month(), local.day());
    let day = weekday_chronicle(local.weekday());
    *data.day = day;
    *data.weekday_mf = if (2..=6).contains(&day) { 1 } else { 0 };
    *data.weekday_mth = if (2..=5).contains(&day) { 1 } else { 0 };
    *data.weekday_su_th = if day == 1 || (2..=5).contains(&day) {
        1
    } else {
        0
    };
    *data.hour = local.hour() as u8;
    *data.quarter = ((local.month() as u8 - 1) / 3) + 1;
}

/// Discover normalized IANA timezones through the Rust ingest boundary. Empty
/// timezone cells use the product's UTC default; rows without an event
/// timestamp are ignored exactly as they are by preprocessing.
pub fn discover_timezones_v2_native(csv_bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut timezones = BTreeSet::new();
    // PHI safety: raw cell values must never enter error strings surfaced to
    // the UI/console — report the 1-based data-row position instead. The
    // physical data-row number counts every data record in the file (including
    // all-empty skipped records) so it matches the row the incremental
    // executor reports for the same cell.
    for (data_row, record) in parse_csv_to_records_with_physical_rows(csv_bytes) {
        let timestamp = record
            .get("event_timestamp")
            .map(|value| value.trim())
            .unwrap_or_default();
        if timestamp.is_empty() {
            continue;
        }
        parse_chronicle_timestamp_ns(timestamp)
            .ok_or_else(|| format!("Invalid event_timestamp at data row {data_row}"))?;
        let timezone = record
            .get("timezone")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty() && *value != "None")
            .unwrap_or("UTC");
        timezone
            .parse::<Tz>()
            .map_err(|_| format!("invalid timezone value at data row {data_row}"))?;
        timezones.insert(timezone.to_string());
    }
    Ok(timezones.into_iter().collect())
}

pub(crate) fn normalize_interaction_type_local(s: &str) -> &str {
    crate::normalize_interaction_type(s)
}

pub(crate) fn dedupe_exact_rows(rows: Vec<Row>) -> Vec<Row> {
    let mut seen =
        AHashMap::<(SharedString, i64, SharedString, SharedString), usize>::with_capacity(
            rows.len(),
        );
    let mut out: Vec<Row> = Vec::with_capacity(rows.len());
    for row in rows {
        let key = (
            row.participant_id.clone(),
            row.event_timestamp_ns,
            row.interaction_type.clone(),
            row.app_package_name.clone(),
        );
        if let Some(index) = seen.get(&key).copied() {
            out[index].source_data_rows.merge(&row.source_data_rows);
        } else {
            seen.insert(key, out.len());
            out.push(row);
        }
    }
    out
}

pub(crate) fn count_duplicate_groups(rows: &[Row]) -> u32 {
    let mut counts = BTreeMap::<(&str, i64), u32>::new();
    for row in rows {
        *counts
            .entry((row.participant_id.as_str(), row.event_timestamp_ns))
            .or_default() += 1;
    }
    counts.values().map(|count| count.saturating_sub(1)).sum()
}

pub(crate) fn duplicate_priority(it: &str, stop_types: &AHashSet<&str>) -> u8 {
    let normalized = if it == "Screen Non-interactive" {
        "Screen Non-Interactive"
    } else {
        it
    };
    if normalized == "Activity Resumed" {
        return 0;
    }
    if stop_types.contains(normalized) {
        return 2;
    }
    1
}

/// Nudge equal-timestamp events apart by 1 µs steps. The subtraction is
/// checked unconditionally: an event within a few microseconds of `i64::MIN`
/// refuses with the typed B06 token instead of wrapping (release) or
/// panicking (debug). No B06 option is read here — the arithmetic class is
/// the same whether or not a maximum-duration policy was selected.
pub(crate) fn unalign_duplicate_timestamps(
    mut rows: Vec<Row>,
    same_app_stop_types: &[String],
    other_stop_types: &[String],
) -> Result<Vec<Row>, String> {
    if rows.len() <= 1 {
        return Ok(rows);
    }
    let mut stop_types: AHashSet<&str> = AHashSet::new();
    for v in same_app_stop_types {
        stop_types.insert(v.as_str());
    }
    for v in other_stop_types {
        stop_types.insert(v.as_str());
    }
    let mut groups = BTreeMap::<(SharedString, i64), Vec<usize>>::new();
    for (index, row) in rows.iter().enumerate() {
        groups
            .entry((row.participant_id.clone(), row.event_timestamp_ns))
            .or_default()
            .push(index);
    }
    if groups.values().all(|indices| indices.len() == 1) {
        return Ok(rows);
    }
    for indices in groups.into_values() {
        let count = indices.len();
        if count > 1 {
            let mut order: Vec<(u8, usize)> = indices
                .iter()
                .copied()
                .enumerate()
                .map(|(local, index)| {
                    (
                        duplicate_priority(&rows[index].interaction_type, &stop_types),
                        local,
                    )
                })
                .collect();
            order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
            let block: Vec<Row> = indices.iter().map(|index| rows[*index].clone()).collect();
            for (ordered_index, (_, local)) in order.iter().enumerate() {
                let mut updated = block[*local].clone();
                let offset = (count - ordered_index) as i64 * 1_000;
                let adjusted = updated
                    .event_timestamp_ns
                    .checked_sub(offset)
                    .ok_or_else(|| {
                        b06::MaximumDurationRefusalReason::DuplicateTimestampAdjustmentUnrepresentable
                            .execution_error()
                    })?;
                *updated.edit_temporal().event_timestamp_ns = adjusted;
                rows[indices[ordered_index]] = updated;
            }
        }
    }
    rows.sort_by(|a, b| {
        a.event_timestamp_ns
            .cmp(&b.event_timestamp_ns)
            .then(a.index.cmp(&b.index))
    });
    Ok(rows)
}

pub(crate) fn derive_time_gap_evidence(mut rows: Vec<Row>) -> Vec<Row> {
    let mut previous_by_participant = AHashMap::<SharedString, i64>::new();
    for row in &mut rows {
        let participant_id = row.participant_id.clone();
        let event_timestamp_ns = row.event_timestamp_ns;
        let final_v = if let Some(previous_timestamp_ns) =
            previous_by_participant.insert(participant_id, event_timestamp_ns)
        {
            // i128: 1700 to 2026 is past i64 nanoseconds, and a wrapped delta
            // wrote a negative gap and suppressed the long-gap flag.
            let delta_ns = i128::from(event_timestamp_ns) - i128::from(previous_timestamp_ns);
            // (Number(delta_ns) / 3.6e12).toFixed(2) -> parse back to f64
            let raw = (delta_ns as f64) / 3_600_000_000_000.0;
            let rounded = ecma_round_fixed_f64(raw, 2);
            // JS `(x || 0)` -> 0 if NaN or 0; otherwise rounded.
            if rounded == 0.0 || rounded.is_nan() {
                0.0
            } else {
                rounded
            }
        } else {
            0.0
        };
        // Most gaps round to the 0.0 the row already holds; writing that
        // back would deep-clone the shared row and invalidate its temporal
        // checkpoint part for an identical value.
        if row.data_time_gap_hours != final_v {
            *row.edit_temporal().data_time_gap_hours = final_v;
        }
    }
    rows
}

pub(crate) fn validate_remap_rules(entries: &[String]) -> BTreeMap<String, String> {
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

pub(crate) fn decode_source_records(csv_bytes: &[u8]) -> Vec<RawRow> {
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

    // Same header normalization as raw inspection: a file inspection accepts
    // must not lose a column here (a byte-order mark from an Excel re-save
    // otherwise hides the first header, `study_id` in Chronicle exports).
    let column_indices = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (header.trim().trim_start_matches('\u{feff}'), index))
        .collect::<HashMap<_, _>>();
    let event = column_indices.get("event_timestamp").copied();
    let timezone = column_indices.get("timezone").copied();
    let package = column_indices.get("app_package_name").copied();
    let interaction = column_indices.get("interaction_type").copied();
    let label = column_indices.get("application_label").copied();
    let study = column_indices.get("study_id").copied();
    let participant = column_indices.get("participant_id").copied();
    let username = column_indices.get("username").copied();
    // Registered input adapters preserve original one-based source-row lineage
    // when a source interval expands into multiple canonical events.
    let literature_source_row = column_indices.get("literature_source_data_row").copied();

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
                    let source_data_row = get(literature_source_row)
                        .trim()
                        .parse::<u32>()
                        .ok()
                        .filter(|row| *row > 0)
                        .unwrap_or(data_row_number);
                    raw_rows.push(RawRow {
                        source_data_row,
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

pub(crate) fn remove_missing_timestamps(raw_rows: Vec<RawRow>) -> Vec<RawRow> {
    raw_rows
        .into_iter()
        .filter(|row| !row.event_timestamp.is_empty())
        .collect()
}

pub(crate) fn attach_device_models(raw_rows: &[RawRow]) -> BTreeMap<String, String> {
    let mut models = BTreeMap::new();
    for row in raw_rows {
        let model = models
            .entry(row.participant_id.clone())
            .or_insert_with(|| "Android".to_owned());
        if model != "Amazon Fire"
            && AMAZON_APPS
                .iter()
                .any(|package| row.app_package_name.contains(package))
        {
            *model = "Amazon Fire".to_owned();
        }
    }
    models
}

pub(crate) fn bind_processing_timestamp(value: &str) -> String {
    value.to_string()
}

pub(crate) fn canonicalize_source_rows(
    raw_rows: &[RawRow],
    fallback_timezone: &str,
    interaction_remap: &BTreeMap<String, String>,
    possible_device_models: &BTreeMap<String, String>,
) -> Result<Vec<Row>, String> {
    let fallback: Tz = fallback_timezone
        .parse()
        .map_err(|error| format!("tz {fallback_timezone}: {error}"))?;
    let mut strings = SharedStringPool::default();
    let empty_usage_flags = strings.intern("[]");
    let mut date_memo = LocalDateMemo::default();
    raw_rows
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            let possible_device_model = strings.intern(
                possible_device_models
                    .get(&raw.participant_id)
                    .map(String::as_str)
                    .unwrap_or("Android"),
            );
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
                raw_episode_start_timestamp_ns: None,
                raw_episode_stop_timestamp_ns: None,
                raw_episode_duration_ns: None,
                micro_use_classification: None,
                minimum_duration_qualified: None,
                minimum_duration_aggregate_eligible: true,
                minimum_duration_blank_applied: false,
                concurrent_subinterval_floor_blank_applied: false,
                minimum_duration_drop_pending: false,
                maximum_duration_qualified: None,
                maximum_duration_aggregate_eligible: true,
                maximum_duration_drop_pending: false,
                maximum_duration_trimmed_ns: None,
                effective_endpoint_reason: None,
                screen_usage_end_reason: None,
                app_usage_end_reason: None,
                screen_interval_id: None,
                schoedel_completion: None,
                usage_session_id: None,
                screen_usage_end_reason_confidence: None,
                screen_usage_stop_event_type: None,
                screen_usage_last_activity_timestamp_ns: None,
                screen_usage_tail_gap_seconds: None,
                screen_usage_foreground_app_package: None,
                screen_usage_app_observed: None,
                screen_usage_session_classification: None,
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

/// Where a row sorts among rows sharing its instant. A handover — one app
/// pausing as the next resumes — is stamped at a single instant often enough
/// that the upstream processor rounds to 10 ms to MAKE the tie, then sorts
/// foreground before background so the arriving app is always seen first
/// (`preprocessing.py:28`/`:53` and `utils.get_action` in
/// methodic-labs/chronicle-processing). Without that, the order two rows
/// happen to occupy in the export decides how the episode reads.
pub(crate) fn handover_rank(row: &Row) -> u8 {
    match row.interaction_type.as_str() {
        ACTIVITY_RESUMED => 0,
        ACTIVITY_PAUSED => 1,
        // The upstream's `get_action` returns no rank for every other type, and
        // pandas sorts those last.
        _ => 2,
    }
}

pub(crate) fn order_source_records(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(handover_rank(left).cmp(&handover_rank(right)))
            .then(left.index.cmp(&right.index))
    });
    rows
}

/// Drop backward source timestamps within each participant before the normal sort.
pub(crate) fn order_source_records_with_policy(
    rows: Vec<Row>,
    drop_out_of_source_order_events: bool,
) -> Vec<Row> {
    if !drop_out_of_source_order_events {
        return order_source_records(rows);
    }
    let mut latest_by_participant = AHashMap::<SharedString, i64>::new();
    order_source_records(
        rows.into_iter()
            .filter(
                |row| match latest_by_participant.get_mut(&row.participant_id) {
                    Some(latest) if row.event_timestamp_ns < *latest => false,
                    Some(latest) => {
                        *latest = row.event_timestamp_ns;
                        true
                    }
                    None => {
                        latest_by_participant
                            .insert(row.participant_id.clone(), row.event_timestamp_ns);
                        true
                    }
                },
            )
            .collect(),
    )
}

pub(crate) fn rows_are_event_ordered(rows: &[Row]) -> bool {
    rows.windows(2).all(|pair| {
        pair[0]
            .event_timestamp_ns
            .cmp(&pair[1].event_timestamp_ns)
            .then(pair[0].index.cmp(&pair[1].index))
            .is_le()
    })
}

pub(crate) fn rows_have_strictly_increasing_timestamps(rows: &[Row]) -> bool {
    rows.windows(2)
        .all(|pair| pair[0].event_timestamp_ns < pair[1].event_timestamp_ns)
}

pub(crate) fn collect_timezone_observations(rows: &[Row]) -> BTreeSet<String> {
    // Row timezones repeat heavily; dedupe on the shared &str before
    // allocating one String per unique zone.
    let mut unique = AHashSet::<&str>::new();
    rows.iter()
        .filter(|row| unique.insert(row.timezone.as_str()))
        .map(|row| row.timezone.to_string())
        .collect()
}

pub(crate) fn estimate_dominant_timezone(rows: &[Row]) -> String {
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

pub(crate) fn resolve_timezone_strategy(
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

pub(crate) fn standardize_event_clock(
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
        *row.edit_temporal().timezone = target_timezone.clone();
        populate_time_columns(row, timezone, &mut date_memo);
        let date = strings.intern(row.date.as_str());
        *row.edit_temporal().date = date;
    }
    Ok(rows)
}

pub(crate) fn summarize_row_selection(before: u32, after: u32) -> RowCountReport {
    RowCountReport {
        before,
        after,
        removed: before.saturating_sub(after),
    }
}

pub(crate) fn coalesce_duplicate_event_keys(rows: Vec<Row>, enabled: bool) -> Vec<Row> {
    if enabled {
        dedupe_exact_rows(rows)
    } else {
        rows
    }
}

pub(crate) fn disambiguate_duplicate_timestamps(
    rows: Vec<Row>,
    enabled: bool,
    same_app_stop_types: &[String],
    other_stop_types: &[String],
) -> Result<Vec<Row>, String> {
    if !enabled {
        return Ok(rows);
    }
    unalign_duplicate_timestamps(rows, same_app_stop_types, other_stop_types)
}

pub(crate) fn mark_gaps(rows: Vec<Row>) -> Vec<Row> {
    derive_time_gap_evidence(rows)
}

pub(crate) struct TimezoneMetadata<'a> {
    pub(crate) action: &'a str,
    pub(crate) target_timezone: &'a str,
}

pub(crate) fn timezone_metadata<'a>(
    target_timezone: &'a str,
    action: &'a str,
) -> TimezoneMetadata<'a> {
    TimezoneMetadata {
        action,
        target_timezone,
    }
}

impl TimezoneMetadata<'_> {
    pub(crate) fn checkpoint_payload(&self) -> serde_json::Value {
        // Fingerprints distinguish maps from structs, even with identical JSON.
        serde_json::json!({"targetTimezone": self.target_timezone, "action": self.action})
    }
}
