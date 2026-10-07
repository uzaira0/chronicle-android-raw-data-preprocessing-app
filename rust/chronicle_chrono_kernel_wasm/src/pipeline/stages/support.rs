use crate::pipeline_v2::FilterMatchField;
use crate::pipeline_v2::{
    AHashSet, Arc, BTreeMap, BTreeSet, CODEBOOK_RENAME_PAIRS, CodebookEntry, CsvReader, HashMap,
    NaiveDate, PackageExclusionPreset, ReadFieldResult, SharingEntry, SharingStatus, StudyWindow, StudyWindowExclusion,
    parse_chronicle_timestamp_ns,
};

// ---- support file loaders ----------------------------------------------

/// Validate explicitly supplied communication relationships in the exact input
/// artifact. The canonical decoder supplies physical 1-based data-row identities,
/// including empty records. No clock, chronology, latency, last-message selection,
/// conversation grouping, or response-window rule is executed here.
pub fn validate_supplied_communication_relationships(csv_bytes: &[u8]) -> Result<(), String> {
    // A byte-level negative check avoids another full CSV materialization for
    // ordinary files. It never establishes presence: only decoded named fields do.
    if ![
        b"sms_response_to_source_row".as_slice(),
        b"communication_conversation_id".as_slice(),
    ]
    .iter()
    .any(|column| {
        csv_bytes
            .windows(column.len())
            .any(|window| window == *column)
    }) {
        return Ok(());
    }
    let records = parse_csv_to_records_with_physical_rows(csv_bytes);
    let rows: BTreeMap<u32, &HashMap<String, String>> = records
        .iter()
        .map(|(ordinal, row)| (*ordinal, row))
        .collect();
    let cell = |row: &HashMap<String, String>, key: &str| {
        row.get(key)
            .map(|value| value.trim().to_owned())
            .unwrap_or_default()
    };
    let mut conversation_peers: BTreeMap<(String, String), String> = BTreeMap::new();
    for (ordinal, row) in &records {
        let reference = cell(row, "sms_response_to_source_row");
        let conversation = cell(row, "communication_conversation_id");
        if reference.is_empty() && conversation.is_empty() {
            continue;
        }
        let participant = cell(row, "participant_id");
        if participant.is_empty()
            || cell(row, "communication_modality") != "sms"
            || !matches!(
                cell(row, "communication_direction").as_str(),
                "sent" | "received"
            )
        {
            return Err(format!("supplied SMS relationship at source row {ordinal} requires SMS, a participant and sent/received direction"));
        }
        let peer = cell(row, "communication_peer_id");
        if !reference.is_empty() {
            let target_ordinal = reference.parse::<u32>()
                .ok().filter(|value| *value > 0 && *value != *ordinal)
                .ok_or_else(|| format!("supplied SMS source-row reference at row {ordinal} must be a distinct positive physical data-row identity"))?;
            let target = rows.get(&target_ordinal)
                .ok_or_else(|| format!("supplied SMS source-row reference at row {ordinal} has no referenced row in this input artifact"))?;
            if cell(row, "communication_direction") != "sent"
                || cell(target, "communication_modality") != "sms"
                || cell(target, "communication_direction") != "received"
                || cell(target, "participant_id") != participant
                || (!peer.is_empty()
                    && !cell(target, "communication_peer_id").is_empty()
                    && peer != cell(target, "communication_peer_id"))
            {
                return Err(format!("supplied SMS source-row reference at row {ordinal} contradicts direction, participant or known peer"));
            }
            let target_conversation = cell(target, "communication_conversation_id");
            if !conversation.is_empty()
                && !target_conversation.is_empty()
                && conversation != target_conversation
            {
                return Err(format!("supplied SMS source-row reference at row {ordinal} contradicts known conversation membership"));
            }
        }
        if !conversation.is_empty() && !peer.is_empty() {
            let key = (participant, conversation);
            if let Some(prior) = conversation_peers.get(&key) {
                if prior != &peer {
                    return Err(format!(
                        "supplied SMS conversation at row {ordinal} mixes known peers"
                    ));
                }
            } else {
                conversation_peers.insert(key, peer);
            }
        }
    }
    Ok(())
}

fn validate_call_sms_eligibility_csv(bytes: &[u8]) -> Result<(), String> {
    let role = "call_sms_eligibility_file";
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("{role}: unreadable CSV header: {error}"))?
        .clone();
    let column_index = |name: &str| {
        headers
            .iter()
            .position(|header| header.trim().trim_start_matches('\u{feff}') == name)
            .ok_or_else(|| format!("{role}: missing required column(s) {name}"))
    };
    let participant_index = column_index("participant_id")?;
    let modality_index = column_index("modality_scope")?;
    let availability_index = column_index("availability_state")?;
    let numerator_index = column_index("year_equivalent_exposure_numerator")?;
    let denominator_index = column_index("year_equivalent_exposure_denominator")?;
    let mut identities = BTreeSet::new();
    let mut row_count = 0usize;

    for record in reader.records() {
        let record = record.map_err(|error| format!("{role}: malformed CSV record: {error}"))?;
        if record.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        row_count += 1;
        let participant = record.get(participant_index).unwrap_or_default().trim();
        let modality = record.get(modality_index).unwrap_or_default().trim();
        let availability = record.get(availability_index).unwrap_or_default().trim();
        let numerator = record.get(numerator_index).unwrap_or_default().trim();
        let denominator = record.get(denominator_index).unwrap_or_default().trim();

        if participant.is_empty() {
            return Err(format!("{role}: participant_id must be non-empty"));
        }
        if !matches!(modality, "call" | "call_text_combined") {
            return Err(format!(
                "{role}: modality_scope must be call or call_text_combined"
            ));
        }
        if !matches!(availability, "available" | "unavailable") {
            return Err(format!(
                "{role}: availability_state must be available or unavailable"
            ));
        }
        if !identities.insert((participant.to_owned(), modality.to_owned())) {
            return Err(format!(
                "{role}: duplicate participant_id and modality_scope"
            ));
        }

        if modality == "call_text_combined" {
            if availability != "available" {
                return Err(format!(
                    "{role}: call_text_combined rows require availability_state available"
                ));
            }
            let is_positive_integer =
                |value: &str| value.parse::<u128>().is_ok_and(|parsed| parsed > 0);
            if !is_positive_integer(numerator) || !is_positive_integer(denominator) {
                return Err(format!(
                    "{role}: call_text_combined rows require positive integer year-equivalent exposure numerator and denominator"
                ));
            }
        } else if !numerator.is_empty() || !denominator.is_empty() {
            return Err(format!(
                "{role}: call availability rows require blank year-equivalent exposure numerator and denominator"
            ));
        }
    }

    if row_count == 0 {
        Err(format!("{role}: no eligibility rows found"))
    } else {
        Ok(())
    }
}

/// Validate a support file against the exact schema used by the Rust
/// pipeline before it can satisfy a role. This closes the former gap where a
/// correctly named CSV with unrelated columns qualified and then behaved like
/// an empty lookup.
pub fn validate_support_csv(role: &str, bytes: &[u8]) -> Result<(), String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("{role}: unreadable CSV header: {error}"))?
        .iter()
        .map(|header| header.trim().trim_start_matches('\u{feff}').to_string())
        .collect::<BTreeSet<_>>();
    let row_count = reader.records().try_fold(0usize, |count, record| {
        record
            .map(|record| count + usize::from(record.iter().any(|cell| !cell.trim().is_empty())))
            .map_err(|error| format!("{role}: malformed CSV record: {error}"))
    })?;
    let require = |names: &[&str]| -> Result<(), String> {
        let missing = names
            .iter()
            .filter(|name| !headers.contains(**name))
            .copied()
            .collect::<Vec<_>>();
        if missing.is_empty() {
            Ok(())
        } else {
            // PHI safety: never echo the found headers — a headerless upload
            // would leak its first data row here.
            Err(format!(
                "{role}: missing required column(s) {}",
                missing.join(", ")
            ))
        }
    };
    let require_one = |names: &[&str]| -> Result<(), String> {
        if names.iter().any(|name| headers.contains(*name)) {
            Ok(())
        } else {
            Err(format!(
                "{role}: requires one of columns {}",
                names.join(", ")
            ))
        }
    };
    match role {
        "filter_file" => require_one(&["app_package_name", "package_name", "application_label"]),
        "apps_forcing_screen_open_file" | "background_apps_file" => {
            require_one(&["package_name", "app_package_name"])
        }
        "app_codebook_file" => require(&["app_package_name"]),
        "study_dates_file" => {
            require(&["participant_id", "start_date", "end_date"])?;
            let windows = parse_study_windows(bytes)?;
            if row_count == 0 || windows.is_empty() {
                Err("study_dates_file: no participant study windows found".into())
            } else {
                Ok(())
            }
        }
        "device_sharing_file" => {
            require(&["participant_id", "sharing_status"])?;
            parse_device_sharing(bytes).map(|_| ())
        }
        "survey_attribution_file" => {
            require(&["participant_id", "event_timestamp", "users"])?;
            parse_survey_lookup(bytes).map(|_| ())
        }
        "enrolled_devices_file" => {
            require(&["participant_id", "device_count"])?;
            parse_enrolled_devices(bytes).map(|_| ())
        }
        "analysis_feature_matrix_file" => {
            require(&[
                "participant_id",
                "feature_id",
                "value",
                "missing_state",
                "feature_set_id",
            ])?;
            if row_count == 0 {
                Err("analysis_feature_matrix_file: no feature cells found".into())
            } else {
                Ok(())
            }
        }
        "call_sms_eligibility_file" => {
            require(&[
                "participant_id",
                "modality_scope",
                "availability_state",
                "year_equivalent_exposure_numerator",
                "year_equivalent_exposure_denominator",
            ])?;
            validate_call_sms_eligibility_csv(bytes)
        }
        "phonestudy_ps_communication_file" => {
            require(&["id"])?;
            if row_count == 0 {
                Err("phonestudy_ps_communication_file: no communication rows found".into())
            } else {
                Ok(())
            }
        }
        "phonestudy_es_file" => {
            require(&["user_id", "es_questionnaire_id"])?;
            if row_count == 0 {
                Err("phonestudy_es_file: no ES questionnaire rows found".into())
            } else {
                Ok(())
            }
        }
        "anchor_events_file" => {
            require(&["participant_id", "anchor_timestamp"])?;
            if row_count == 0 {
                Err("anchor_events_file: no anchor event rows found".into())
            } else {
                Ok(())
            }
        }
        _ => Err(format!("unsupported support role: {role}")),
    }
}

/// Build (filter_set, filter_label_map) from raw filter-CSV bytes.
/// Mirrors `buildFilterMap` semantics — packageName -> Set<labels>.
/// If labels set is non-empty, only rows with matching application_label match.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct AppFilterRules {
    pub(crate) packages: HashMap<String, AHashSet<String>>,
    pub(crate) application_labels: AHashSet<String>,
}

impl Default for AppFilterRules {
    fn default() -> Self {
        Self {
            packages: HashMap::new(),
            application_labels: AHashSet::new(),
        }
    }
}

pub(crate) fn parse_filter_csv(
    bytes: &[u8],
    preset: PackageExclusionPreset,
    match_field: FilterMatchField,
) -> AppFilterRules {
    let mut rules = AppFilterRules::default();
    let rows = parse_csv_to_records(bytes);
    for row in &rows {
        if match_field == FilterMatchField::ApplicationLabel {
            let label = trim_owned(row.get("application_label"));
            if !label.is_empty() {
                rules.application_labels.insert(label);
            }
            continue;
        }
        let pkg = trim_owned(
            row.get("app_package_name")
                .or_else(|| row.get("package_name")),
        );
        if pkg.is_empty() {
            continue;
        }
        // The B10 package-exclusion preset decides membership here, at the one
        // place the excluded set is built, so every downstream step -- relabel,
        // opener pairing, Culverhouse bad-apps cap, receipts -- sees one
        // consistent set. Under the default the two extra columns are not read
        // at all, which is what keeps the shipped configuration byte-identical
        // and keeps those columns observationally unread.
        if preset.reads_row_scope_columns() {
            let category = trim_owned(row.get("app_filter_category"));
            let flag = trim_owned(row.get("filter_bool"));
            if !preset.row_excludes(&category, &flag) {
                continue;
            }
        }
        let labels = trim_owned(
            row.get("known_application_labels")
                .or_else(|| row.get("application_label"))
                .or_else(|| row.get("label_or_note")),
        );
        let entry = rules.packages.entry(pkg).or_insert_with(AHashSet::new);
        if !labels.is_empty() {
            for lab in labels.split(',') {
                let trimmed = lab.trim();
                if !trimmed.is_empty() {
                    entry.insert(trimmed.to_string());
                }
            }
        }
    }
    rules
}

/// `system_scope_only` keeps a row only when its `app_filter_category` says
/// system; a filter file without that column therefore excluded nothing, with
/// no word to the researcher who asked for an exclusion. `honor_filter_flag`
/// needs no such guard: an absent flag still excludes.
pub fn validate_filter_file_for_preset(
    bytes: &[u8],
    preset: PackageExclusionPreset,
) -> Result<(), String> {
    let lacks_category = parse_csv_to_records(bytes)
        .first()
        .is_some_and(|row| !row.contains_key("app_filter_category"));
    if preset == PackageExclusionPreset::SystemScopeOnly && lacks_category {
        return Err(
            "filter_file: package_exclusion_preset system_scope_only requires an app_filter_category column"
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn parse_apps_forcing_csv(bytes: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let rows = parse_csv_to_records(bytes);
    for row in &rows {
        let pkg = trim_owned(
            row.get("package_name")
                .or_else(|| row.get("app_package_name")),
        );
        let label = trim_owned(
            row.get("label_or_note")
                .or_else(|| row.get("application_label")),
        );
        if pkg.is_empty() || pkg.starts_with('#') {
            continue;
        }
        map.insert(pkg, label);
    }
    map
}

pub(crate) fn parse_background_apps_csv(bytes: &[u8]) -> AHashSet<String> {
    parse_csv_to_records(bytes)
        .into_iter()
        .filter_map(|row| {
            let package = trim_owned(
                row.get("package_name")
                    .or_else(|| row.get("app_package_name")),
            );
            if package.is_empty() || package.starts_with('#') {
                None
            } else {
                Some(package)
            }
        })
        .collect()
}

pub(crate) fn parse_codebook_csv(bytes: &[u8]) -> HashMap<String, CodebookEntry> {
    let mut map: HashMap<String, CodebookEntry> = HashMap::new();
    let rows = parse_csv_to_records(bytes);
    let n_cols = CODEBOOK_RENAME_PAIRS.len();
    for row in &rows {
        let pkg = trim_owned(row.get("app_package_name"));
        if pkg.is_empty() || map.contains_key(&pkg) {
            continue;
        }
        let mut fields = vec![None; n_cols];
        for (i, (src, _dst)) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
            let v = trim_owned(row.get(*src));
            fields[i] = if v.is_empty() { None } else { Some(v) };
        }
        map.insert(
            pkg,
            CodebookEntry {
                fields: Arc::new(fields),
            },
        );
    }
    map
}

pub(crate) fn trim_owned(v: Option<&String>) -> String {
    v.map(|s| s.trim().to_string()).unwrap_or_default()
}

pub(crate) fn parse_csv_to_records(bytes: &[u8]) -> Vec<HashMap<String, String>> {
    parse_csv_to_records_with_physical_rows(bytes)
        .into_iter()
        .map(|(_physical_data_row, record)| record)
        .collect()
}

/// Like `parse_csv_to_records`, but each surviving record carries its physical
/// 1-based data-row number — counting EVERY data record in the file, including
/// the all-empty records this parser skips — so error messages name the same
/// row the incremental executor's `decode_source_records` reports via
/// `RawRow::source_data_row`.
pub(crate) fn parse_csv_to_records_with_physical_rows(bytes: &[u8]) -> Vec<(u32, HashMap<String, String>)> {
    // csv-core's empty-input flush path differs under the optimized browser
    // WASM target for a final unterminated field: the row can be emitted while
    // its last cell is empty. Normalize only the missing record terminator so
    // native and WASM parse identical bytes without changing CSV contents.
    let mut terminated = Vec::new();
    let bytes = if bytes.ends_with(b"\n") {
        bytes
    } else {
        terminated.reserve(bytes.len() + 1);
        terminated.extend_from_slice(bytes);
        terminated.push(b'\n');
        &terminated
    };
    let mut rdr = CsvReader::new();
    let mut field_buf = vec![0u8; 1024];
    let mut input = bytes;
    // csv-core consumes the input it wrote before reporting OutputFull, so the
    // bytes already in `field_buf` are the only copy of the front of a long
    // cell. Carry them here across the resize; dropping them silently
    // truncated every support-file value longer than the buffer to its tail.
    let mut carried: Vec<u8> = Vec::new();
    let take_field = |carried: &mut Vec<u8>, field_buf: &[u8]| -> String {
        if carried.is_empty() {
            return String::from_utf8_lossy(field_buf).into_owned();
        }
        carried.extend_from_slice(field_buf);
        let value = String::from_utf8_lossy(carried).into_owned();
        carried.clear();
        value
    };

    let mut headers: Vec<String> = Vec::new();
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                // Keep feeding the exhausted reader an empty slice until End
                // so csv-core emits the final unterminated record.
                continue;
            }
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..n_out]);
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                // `validate_support_csv` strips a UTF-8 byte-order mark from
                // the first header; so must the parser the lookups are built
                // from, or a validated file behaves like an empty one.
                let s = take_field(&mut carried, &field_buf[..n_out])
                    .trim()
                    .trim_start_matches('\u{feff}')
                    .trim()
                    .to_string();
                headers.push(s);
                if record_end {
                    break;
                }
            }
            ReadFieldResult::End => break,
        }
    }

    let mut records = Vec::new();
    let mut row_vals: Vec<String> = vec![String::new(); headers.len()];
    let mut col_idx = 0;
    let mut any_nonempty = false;
    // Physical 1-based data-row counter, incremented for every record —
    // including all-empty records that are skipped from the output — to match
    // `decode_source_records`'s `data_row_number` in pipeline_v2_incremental.rs.
    let mut physical_data_row = 0_u32;
    loop {
        let (result, n_in, n_out) = rdr.read_field(input, &mut field_buf);
        input = &input[n_in..];
        match result {
            ReadFieldResult::InputEmpty => {
                continue;
            }
            ReadFieldResult::OutputFull => {
                carried.extend_from_slice(&field_buf[..n_out]);
                field_buf.resize(field_buf.len() * 2, 0);
                continue;
            }
            ReadFieldResult::Field { record_end } => {
                let s = take_field(&mut carried, &field_buf[..n_out]);
                if col_idx < row_vals.len() {
                    row_vals[col_idx].clear();
                    row_vals[col_idx].push_str(&s);
                    if !s.is_empty() {
                        any_nonempty = true;
                    }
                }
                col_idx += 1;
                if record_end {
                    physical_data_row += 1;
                    if any_nonempty {
                        let mut rec = HashMap::with_capacity(headers.len());
                        for (i, h) in headers.iter().enumerate() {
                            rec.insert(h.clone(), row_vals[i].clone());
                        }
                        records.push((physical_data_row, rec));
                    }
                    for s in row_vals.iter_mut() {
                        s.clear();
                    }
                    col_idx = 0;
                    any_nonempty = false;
                }
            }
            ReadFieldResult::End => break,
        }
    }
    records
}

pub(crate) fn normalize_support_date(value: &str) -> Result<String, String> {
    // PHI safety: never echo the raw cell — callers annotate the column and
    // participant instead.
    let unparseable = || "unparseable date value".to_string();
    // A window is compared to row dates as a string, so a date that is not a
    // four-digit year with a real month and day would silently drop every row
    // of its participant ("1/5/26" used to become year 0026).
    let checked = |year: &str, month: &str, day: &str| -> Result<String, String> {
        let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
        if year.len() != 4 || !digits(year) || !digits(month) || !digits(day) {
            return Err(unparseable());
        }
        let year = year.parse::<u16>().map_err(|_| unparseable())?;
        let month = month.parse::<u8>().map_err(|_| unparseable())?;
        let day = day.parse::<u8>().map_err(|_| unparseable())?;
        if year < 1000 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return Err(unparseable());
        }
        NaiveDate::from_ymd_opt(i32::from(year), u32::from(month), u32::from(day))
            .ok_or_else(unparseable)?;
        Ok(format!("{year:04}-{month:02}-{day:02}"))
    };
    let value = value.trim();
    // `get`, not a byte slice: byte 10 of a non-ASCII cell can sit inside a
    // character, and slicing there panics the worker.
    if let Some(prefix) = value.get(..10) {
        let bytes = prefix.as_bytes();
        if bytes[4] == b'-' && bytes[7] == b'-' {
            return checked(&prefix[..4], &prefix[5..7], &prefix[8..10]);
        }
    }
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() == 3 {
        return checked(parts[2], parts[0], parts[1]);
    }
    Err(unparseable())
}

pub(crate) fn parse_study_windows(bytes: &[u8]) -> Result<Vec<StudyWindow>, String> {
    let rows = parse_csv_to_records(bytes);
    let mut windows: Vec<StudyWindow> = Vec::new();
    for row in rows {
        let participant_id = trim_owned(row.get("participant_id"));
        if participant_id.is_empty() {
            continue;
        }
        let start_date = normalize_support_date(
            row.get("start_date")
                .ok_or("Study dates file: missing required column start_date")?,
        )
        .map_err(|_| format!("Study dates file: unparseable start_date for {participant_id}"))?;
        let end_date = normalize_support_date(
            row.get("end_date")
                .ok_or("Study dates file: missing required column end_date")?,
        )
        .map_err(|_| format!("Study dates file: unparseable end_date for {participant_id}"))?;
        if end_date < start_date {
            return Err(format!(
                "Study dates file: window for {participant_id} ends before it starts"
            ));
        }

        let exclusion_start = trim_owned(row.get("exclusion_start_date"));
        let exclusion_end = trim_owned(row.get("exclusion_end_date"));
        let exclusion_label = trim_owned(row.get("exclusion_label"));
        let exclusion = match (
            exclusion_start.is_empty(),
            exclusion_end.is_empty(),
            exclusion_label.is_empty(),
        ) {
            (true, true, true) => None,
            (false, false, false) => {
                let exclusion_start = normalize_support_date(&exclusion_start).map_err(|_| {
                    format!(
                        "Study dates file: unparseable exclusion_start_date for {participant_id}"
                    )
                })?;
                let exclusion_end = normalize_support_date(&exclusion_end).map_err(|_| {
                    format!("Study dates file: unparseable exclusion_end_date for {participant_id}")
                })?;
                if exclusion_end < exclusion_start {
                    return Err(format!(
                        "Study dates file: exclusion for {participant_id} ends before it starts"
                    ));
                }
                if exclusion_start < start_date || exclusion_end > end_date {
                    return Err(format!(
                        "Study dates file: exclusion for {participant_id} falls outside its study window"
                    ));
                }
                Some(StudyWindowExclusion {
                    start_date: exclusion_start,
                    end_date: exclusion_end,
                    label: exclusion_label,
                })
            }
            (true, true, false) => {
                return Err(format!(
                    "Study dates file: exclusion_label for {participant_id} requires exclusion_start_date and exclusion_end_date"
                ));
            }
            (false, false, true) => {
                return Err(format!(
                    "Study dates file: exclusion interval for {participant_id} requires exclusion_label"
                ));
            }
            _ => {
                return Err(format!(
                    "Study dates file: exclusion for {participant_id} requires exclusion_start_date, exclusion_end_date, and exclusion_label"
                ));
            }
        };

        if windows.iter().any(|window| {
            window.participant_id == participant_id
                && (window.start_date != start_date || window.end_date != end_date)
        }) {
            return Err(format!(
                "Study dates file: conflicting study windows for {participant_id}"
            ));
        }
        if let Some(window) = windows.iter_mut().find(|window| {
            window.participant_id == participant_id
                && window.start_date == start_date
                && window.end_date == end_date
        }) {
            if let Some(exclusion) = exclusion {
                window.exclusions.push(exclusion);
            }
        } else {
            windows.push(StudyWindow {
                participant_id,
                start_date,
                end_date,
                exclusions: exclusion.into_iter().collect(),
            });
        }
    }
    for window in &mut windows {
        window.exclusions.sort();
        window.exclusions.dedup();
    }
    Ok(windows)
}

pub(crate) fn support_value<'a>(row: &'a HashMap<String, String>, wanted: &str) -> Option<&'a str> {
    row.iter()
        .find(|(header, _)| header.trim().eq_ignore_ascii_case(wanted))
        .map(|(_, value)| value.as_str())
}

pub(crate) fn require_support_columns(
    file_label: &str,
    rows: &[HashMap<String, String>],
    required: &[&str],
) -> Result<(), String> {
    let Some(first) = rows.first() else {
        return Err(format!(
            "{file_label}: missing required columns or data rows"
        ));
    };
    let missing: Vec<_> = required
        .iter()
        .filter(|column| support_value(first, column).is_none())
        .copied()
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        // PHI safety: never echo the found headers — a headerless upload
        // would leak its first data row here.
        Err(format!(
            "{file_label}: missing required column(s) {}",
            missing.join(", ")
        ))
    }
}

pub(crate) fn parse_device_sharing(bytes: &[u8]) -> Result<Vec<SharingEntry>, String> {
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Device sharing file",
        &rows,
        &["participant_id", "sharing_status"],
    )?;
    rows.into_iter()
        .filter_map(|row| {
            let participant_id = support_value(&row, "participant_id")?.trim().to_string();
            (!participant_id.is_empty()).then_some((row, participant_id))
        })
        .map(|(row, participant_id)| {
            let raw = support_value(&row, "sharing_status")
                .unwrap_or_default()
                .trim();
            let status = if raw.eq_ignore_ascii_case("shared") {
                SharingStatus::Shared
            } else if raw.eq_ignore_ascii_case("non-shared")
                || raw.eq_ignore_ascii_case("nonshared")
                || raw.eq_ignore_ascii_case("not shared")
            {
                SharingStatus::NonShared
            } else {
                return Err(format!(
                    "Device sharing file: unknown sharing_status for {participant_id} (expected \"Shared\" or \"Non-Shared\")"
                ));
            };
            Ok(SharingEntry {
                participant_id,
                status,
            })
        })
        .collect()
}

pub(crate) fn parse_survey_timestamp_ns(value: &str) -> Result<i64, String> {
    // PHI safety: never echo the raw cell — the caller annotates the
    // participant instead.
    let text = value.trim();
    if text.len() >= 10 && text.bytes().all(|byte| byte.is_ascii_digit()) {
        let parsed = text.parse::<i64>().map_err(|_| {
            "Survey attribution file: unparseable event_timestamp value".to_string()
        })?;
        return if text.len() >= 19 {
            Ok(parsed)
        } else if text.len() >= 13 {
            parsed
                .checked_mul(1_000_000)
                .ok_or_else(|| "Survey attribution file: event_timestamp overflow".to_string())
        } else {
            parsed
                .checked_mul(1_000_000_000)
                .ok_or_else(|| "Survey attribution file: event_timestamp overflow".to_string())
        };
    }
    parse_chronicle_timestamp_ns(text)
        .ok_or_else(|| "Survey attribution file: unparseable event_timestamp value".to_string())
}

pub(crate) fn parse_survey_lookup(bytes: &[u8]) -> Result<BTreeMap<(String, i64), String>, String> {
    if bytes.is_empty() {
        return Ok(BTreeMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Survey attribution file",
        &rows,
        &["participant_id", "event_timestamp", "users"],
    )?;
    let mut lookup = BTreeMap::new();
    for row in rows {
        let participant_id = support_value(&row, "participant_id")
            .unwrap_or_default()
            .trim();
        let timestamp = support_value(&row, "event_timestamp")
            .unwrap_or_default()
            .trim();
        let user = support_value(&row, "users")
            .unwrap_or_default()
            .trim()
            .trim_matches(|character| matches!(character, '{' | '}' | '"'));
        if participant_id.is_empty() || timestamp.is_empty() || user.is_empty() {
            continue;
        }
        lookup.insert(
            (
                participant_id.to_string(),
                parse_survey_timestamp_ns(timestamp)
                    .map_err(|error| format!("{error} (participant {participant_id})"))?,
            ),
            user.to_string(),
        );
    }
    Ok(lookup)
}

pub(crate) fn parse_enrolled_devices(bytes: &[u8]) -> Result<BTreeMap<String, u32>, String> {
    if bytes.is_empty() {
        return Ok(BTreeMap::new());
    }
    let rows = parse_csv_to_records(bytes);
    require_support_columns(
        "Enrolled devices file",
        &rows,
        &["participant_id", "device_count"],
    )?;
    let mut devices = BTreeMap::new();
    for row in rows {
        let participant_id = support_value(&row, "participant_id")
            .unwrap_or_default()
            .trim();
        if participant_id.is_empty() {
            continue;
        }
        let raw = support_value(&row, "device_count")
            .unwrap_or_default()
            .trim();
        let count = if raw.is_empty() {
            0
        } else {
            raw.parse::<u32>().map_err(|_| {
                format!("Enrolled devices file: invalid device_count for {participant_id}")
            })?
        };
        devices.insert(participant_id.to_string(), count);
    }
    Ok(devices)
}
