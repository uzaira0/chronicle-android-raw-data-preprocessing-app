//! Source-qualified scalar/adjacency operations, not collectors or episode models.
//! Kim Fig14.3 (physical157/printed147): literal Java Integer.toString operands;
//! Calendar.HOUR is not HOUR_OF_DAY and AM_PM remains a separate supplied field.
//! AppSensor article.txt133–186,310–326: adjacent sampled-state comparison and
//! supplied standby >30seconds only; no endpoint/standby-omission construction.
//! Typing doi:10.1145/3577013 physical13§4.2: supplied keyboard row order only.
//! Academic text/360.txt186–201: integer-second band counts, not fractional repair.
//! Recommender retained author-rendering event-schema locator: unique latest prior
//! supplied nonGPS observations. No four-hour window or historical-code parity.
//! Beyond physical17Table3: minutes since supplied last incoming/center/screen
//! change. Borapp physical4–5Tables3–4: elapsed quantities, author units unknown.

use super::{format_python_float, required_header, supplied_anchor_elapsed_nanoseconds};
use crate::finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use crate::grouped_category_count::count_categories_by_group;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const KIM: &str = "chronicle.kim-literal-calendar-tokens";
pub(super) const TYPING: &str = "chronicle.typing-qualified-adjacent-boundaries";
pub(super) const SAMPLES: &str = "chronicle.appsensor-qualified-sample-flags";
pub(super) const STANDBY: &str = "chronicle.appsensor-supplied-standby-break";
pub(super) const BANDS: &str = "chronicle.academic-integer-session-band-counts";
pub(super) const PRIOR: &str = "chronicle.recommender-unique-latest-prior-context";
pub(super) const BEYOND: &str = "chronicle.beyond-supplied-event-recency";
pub(super) const BORAPP: &str = "chronicle.borapp-supplied-event-recency";
pub(super) const ADAPTERS: [&str; 8] =
    [KIM, TYPING, SAMPLES, STANDBY, BANDS, PRIOR, BEYOND, BORAPP];
pub(super) const CONTEXTS: [&str; 7] = [
    "last_opened_app",
    "last_audio_cable",
    "last_charge_cable",
    "last_wifi",
    "last_data",
    "last_bluetooth",
    "last_light",
];
pub(super) const BEYOND_FEATURES: [&str; 3] = [
    "Comm_PhoneCall_Incoming_MinSinceLast",
    "Usage_NotifCenter_MinSinceLast",
    "Usage_Screen_MinSinceChanged",
];
pub(super) const BORAPP_FEATURES: [&str; 8] = [
    "time_last_incoming_call",
    "time_last_notif",
    "time_last_outgoing_call",
    "time_last_SMS_read",
    "time_last_SMS_received",
    "time_last_SMS_sent",
    "time_last_notif_access",
    "time_last_unlock",
];

pub(super) fn fields(adapter: &str) -> &'static [&'static str] {
    match adapter {
        KIM => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "curYear",
            "curMonth",
            "curDay",
            "Hour",
            "Minute",
            "Sec",
            "PmAm",
            "input_stage",
        ],
        TYPING => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "sequence_id",
            "source_order",
            "input_stage",
            "package_present",
            "package_name",
            "current_text_present",
            "current_text",
            "before_text_present",
            "before_text",
        ],
        SAMPLES => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "sequence_id",
            "source_order",
            "input_stage",
            "state_kind",
            "state_text",
        ],
        STANDBY => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "standby_gap_id",
            "clock_id",
            "standby_seconds",
            "duration_unit",
            "input_stage",
        ],
        BANDS => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "scope_id",
            "record_type",
            "session_occurrence_id",
            "duration_seconds",
            "duration_unit",
            "input_stage",
        ],
        PRIOR => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "query_id",
            "context_kind",
            "record_type",
            "clock_id",
            "timestamp_ns",
            "observation_value",
            "eligible_history_domain",
            "input_stage",
        ],
        BEYOND | BORAPP => &[
            "source_row_id",
            "participant_id",
            "device_id",
            "query_id",
            "feature_key",
            "last_event_source_id",
            "last_clock_id",
            "query_clock_id",
            "last_coordinate",
            "query_coordinate",
            "coordinate_unit",
            "last_event_present",
            "eligible_history_domain",
            "last_event_role",
            "query_role",
            "input_stage",
        ],
        _ => unreachable!("closed adapter dispatch"),
    }
}

pub(super) fn output_fields(adapter: &str) -> &'static [&'static str] {
    match adapter {
        KIM => &["Date", "Time"],
        TYPING => &[
            "next_source_row_id",
            "app_switch_boundary",
            "empty_before_boundary",
            "new_trial_before_next",
            "adjacency_status",
        ],
        SAMPLES => &[
            "next_source_row_id",
            "same_state",
            "changed_state",
            "adjacency_status",
        ],
        STANDBY => &["break_chain", "standby_status"],
        BANDS => &[
            "participant_id",
            "device_id",
            "scope_id",
            "micro_count",
            "review_count",
            "engage_count",
        ],
        PRIOR => &[
            "selected_source_row_id",
            "selected_timestamp_ns",
            "selected_observation_value",
            "selected_present",
            "selection_status",
        ],
        BEYOND => &[
            "elapsed_coordinate",
            "elapsed_coordinate_unit",
            "elapsed_minutes",
            "recency_status",
        ],
        BORAPP => &[
            "elapsed_coordinate",
            "elapsed_coordinate_unit",
            "recency_status",
        ],
        _ => unreachable!(),
    }
}

struct Table {
    headers: csv::StringRecord,
    rows: Vec<csv::StringRecord>,
    columns: Vec<usize>,
}
impl Table {
    fn value<'a>(&self, row: &'a csv::StringRecord, field: usize) -> &'a str {
        row.get(self.columns[field]).unwrap_or("") // Never trim lexical data/IDs.
    }
}
fn read(raw: &[u8], adapter: &str) -> Result<Table, String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("requires unique carrier columns".into());
    }
    let derived = if adapter == BANDS {
        &output_fields(adapter)[3..]
    } else {
        output_fields(adapter)
    };
    if derived
        .iter()
        .any(|name| headers.iter().any(|h| h == *name))
    {
        return Err("refuses supplied derived-output columns".into());
    }
    let columns = fields(adapter)
        .iter()
        .map(|f| required_header(&headers, f, adapter))
        .collect::<Result<Vec<_>, _>>()?;
    let rows = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for row in &rows {
        for field in [0, 1, 2] {
            if row.get(columns[field]).unwrap_or("").trim().is_empty() {
                return Err(format!("requires {}", fields(adapter)[field]));
            }
        }
    }
    Ok(Table {
        headers,
        rows,
        columns,
    })
}
fn present(value: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err("requires explicit true/false presence".into()),
    }
}
fn require(value: &str, expected: &str) -> Result<(), String> {
    if value == expected {
        Ok(())
    } else {
        Err(format!("requires {expected}"))
    }
}
fn required_id(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err("requires nonempty ownership/domain ID".into())
    } else {
        Ok(())
    }
}
fn bool_text(value: Option<bool>) -> String {
    value.map(|b| b.to_string()).unwrap_or_default()
}
fn optional_coordinate(value: &str) -> Result<Option<i64>, String> {
    if value.is_empty() {
        Ok(None)
    } else {
        value
            .parse::<i64>()
            .map(Some)
            .map_err(|_| "requires signed64 coordinate or explicit empty unavailable".into())
    }
}

/// The fixed CSV carrier is engineering transport, not an original author CSV.
pub(super) fn execute(
    adapter: &str,
    raw: &[u8],
    allowed_features: &BTreeSet<String>,
) -> Result<(Vec<u8>, usize, usize), String> {
    let table = read(raw, adapter)?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    if adapter == BANDS {
        writer
            .write_record(output_fields(adapter))
            .map_err(|e| e.to_string())?;
        let mut scopes = BTreeSet::new();
        let mut observations = Vec::new();
        for row in &table.rows {
            let v = |i| table.value(row, i);
            required_id(v(3))?;
            require(v(7), "s")?;
            require(v(8), "caller-qualified-complete-session-domain")?;
            let scope = (v(1).to_owned(), v(2).to_owned(), v(3).to_owned());
            scopes.insert(scope.clone());
            match v(4) {
                "scope" => {
                    require(v(5), "")?;
                    require(v(6), "")?;
                }
                "session" => {
                    required_id(v(5))?;
                    let seconds = v(6).parse::<u64>().map_err(|_| {
                        "requires nonnegative integer seconds; fractional bands are unreported"
                    })?;
                    let band = if seconds <= 15 {
                        0
                    } else if seconds <= 60 {
                        1
                    } else {
                        2
                    };
                    observations.push((scope, band));
                }
                _ => return Err("requires scope/session record_type".into()),
            }
        }
        let counts = count_categories_by_group(observations);
        for scope in scopes {
            let mut bands = [0usize; 3];
            for count in &counts {
                if count.group == scope {
                    bands[count.category] = count.observation_count;
                }
            }
            writer
                .serialize((&scope.0, &scope.1, &scope.2, bands[0], bands[1], bands[2]))
                .map_err(|e| e.to_string())?;
        }
    } else {
        let mut headers = table.headers.clone();
        for field in output_fields(adapter) {
            headers.push_field(field);
        }
        writer.write_record(&headers).map_err(|e| e.to_string())?;
        let next = if matches!(adapter, TYPING | SAMPLES) {
            adjacent_indices(&table, adapter)?
        } else {
            Vec::new()
        };
        if adapter == PRIOR {
            validate_prior(&table, allowed_features)?;
        }
        for (index, row) in table.rows.iter().enumerate() {
            let v = |i| table.value(row, i);
            let extra = match adapter {
                KIM => {
                    require(v(10), "supplied-printed-int-variables")?;
                    let integers = (3..10)
                        .map(|i| {
                            v(i).parse::<i32>()
                                .map_err(|_| "requires Java signed32 Integer variable".to_owned())
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    vec![
                        format!("{}{}{}", integers[0], integers[1], integers[2]),
                        format!("{}{}{}", integers[3], integers[4], integers[5]),
                    ]
                }
                TYPING | SAMPLES => adjacency(&table, adapter, index, next[index])?,
                STANDBY => {
                    required_id(v(3))?;
                    required_id(v(4))?;
                    require(v(6), "s")?;
                    require(v(7), "caller-qualified-device-standby-duration")?;
                    if v(5).is_empty() {
                        vec![String::new(), "unavailable_supplied_duration".into()]
                    } else {
                        let seconds = v(5)
                            .parse::<f64>()
                            .map_err(|_| "requires finite nonnegative standby seconds")?;
                        if !seconds.is_finite() || seconds < 0.0 {
                            return Err("requires finite nonnegative standby seconds".into());
                        }
                        let classifier = FiniteScalarPivotClassifier::new(30.0, false, false, true)
                            .map_err(|e| e.to_string())?;
                        vec![
                            classifier
                                .category_for(seconds)
                                .map_err(|e| e.to_string())?
                                .to_string(),
                            "available_supplied_duration".into(),
                        ]
                    }
                }
                PRIOR => {
                    if v(5) != "query" {
                        continue;
                    }
                    latest_prior(&table, row, allowed_features)?
                }
                BEYOND | BORAPP => recency(&table, row, adapter, allowed_features)?,
                _ => unreachable!(),
            };
            let mut output = row.clone();
            for value in extra {
                output.push_field(&value);
            }
            writer.write_record(&output).map_err(|e| e.to_string())?;
        }
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    let emitted = csv::Reader::from_reader(bytes.as_slice()).records().count();
    Ok((bytes, table.rows.len(), emitted))
}

fn adjacent_indices(table: &Table, adapter: &str) -> Result<Vec<Option<usize>>, String> {
    let mut next = vec![None; table.rows.len()];
    let mut previous = BTreeMap::<(String, String, String), (usize, u64)>::new();
    for (i, row) in table.rows.iter().enumerate() {
        let v = |n| table.value(row, n);
        required_id(v(3))?;
        require(
            v(5),
            if adapter == TYPING {
                "caller-qualified-complete-keyboard-row-order"
            } else {
                "caller-qualified-consecutive-sample-order"
            },
        )?;
        let order = v(4)
            .parse::<u64>()
            .map_err(|_| "requires integer source_order")?;
        let key = (v(1).to_owned(), v(2).to_owned(), v(3).to_owned());
        if let Some((prev, previous_order)) = previous.insert(key, (i, order)) {
            if order <= previous_order {
                return Err("requires strictly increasing supplied source_order within sequence; ties are not repaired".into());
            }
            next[prev] = Some(i);
        }
        if adapter == TYPING {
            for (flag, text) in [(6, 7), (8, 9), (10, 11)] {
                if !present(v(flag))? && !v(text).is_empty() {
                    return Err("unavailable lexical field must be empty".into());
                }
            }
        } else {
            match v(6) {
                "app" => {}
                "epsilon" | "unavailable" => require(v(7), "")?,
                _ => return Err("requires explicit app/epsilon/unavailable state_kind".into()),
            }
        }
    }
    Ok(next)
}
fn adjacency(
    table: &Table,
    adapter: &str,
    i: usize,
    next: Option<usize>,
) -> Result<Vec<String>, String> {
    let row = &table.rows[i];
    let Some(next) = next else {
        return Ok(if adapter == TYPING {
            vec![
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "no_next_supplied_record".into(),
            ]
        } else {
            vec![
                "".into(),
                "".into(),
                "".into(),
                "no_next_supplied_record".into(),
            ]
        });
    };
    let other = &table.rows[next];
    let v = |n| table.value(row, n);
    let w = |n| table.value(other, n);
    if adapter == SAMPLES {
        let known = v(6) != "unavailable" && w(6) != "unavailable";
        let same = known.then(|| (v(6), v(7)) == (w(6), w(7)));
        Ok(vec![
            w(0).into(),
            bool_text(same),
            bool_text(same.map(|b| !b)),
            if known {
                "available_supplied_pair"
            } else {
                "unavailable_supplied_state"
            }
            .into(),
        ])
    } else {
        let app = (present(v(6))? && present(w(6))?).then(|| v(7) != w(7));
        let empty =
            (present(v(8))? && present(w(10))?).then(|| !v(9).is_empty() && w(11).is_empty());
        let either = if app == Some(true) || empty == Some(true) {
            Some(true)
        } else if app == Some(false) && empty == Some(false) {
            Some(false)
        } else {
            None
        };
        Ok(vec![
            w(0).into(),
            bool_text(app),
            bool_text(empty),
            bool_text(either),
            if app.is_some() && empty.is_some() {
                "available_supplied_pair"
            } else {
                "partial_unavailable_lexical_fields"
            }
            .into(),
        ])
    }
}

fn prior_key(table: &Table, row: &csv::StringRecord) -> (String, String, String, String) {
    (
        table.value(row, 1).into(),
        table.value(row, 2).into(),
        table.value(row, 3).into(),
        table.value(row, 4).into(),
    )
}
fn validate_prior(table: &Table, allowed: &BTreeSet<String>) -> Result<(), String> {
    let mut queries = BTreeMap::new();
    for row in &table.rows {
        let v = |i| table.value(row, i);
        for i in [3, 6, 9] {
            required_id(v(i))?;
        }
        require(v(10), "caller-qualified-complete-eligible-context-domain")?;
        if !CONTEXTS.contains(&v(4)) || !allowed.contains(v(4)) {
            return Err("context_kind not selected by exact bound owner (GPS excluded)".into());
        }
        v(7).parse::<i64>().map_err(|_| "requires comparable signed64 nanosecond timestamp; missing history key cannot imply null")?;
        match v(5) {
            "query" => {
                if queries.insert(prior_key(table, row), row).is_some() {
                    return Err("requires one query per context/domain".into());
                }
            }
            "candidate" => {}
            _ => return Err("requires query/candidate record_type".into()),
        }
    }
    for row in &table.rows {
        let query = queries
            .get(&prior_key(table, row))
            .ok_or("candidate has no supplied query")?;
        if table.value(row, 6) != table.value(query, 6)
            || table.value(row, 9) != table.value(query, 9)
        {
            return Err("requires agreeing clock and complete eligible history domain".into());
        }
    }
    Ok(())
}
fn latest_prior(
    table: &Table,
    query: &csv::StringRecord,
    allowed: &BTreeSet<String>,
) -> Result<Vec<String>, String> {
    debug_assert!(allowed.contains(table.value(query, 4)));
    let time = table.value(query, 7).parse::<i64>().unwrap();
    let mut latest = None;
    let mut tied = false;
    for row in &table.rows {
        if table.value(row, 5) != "candidate" || prior_key(table, row) != prior_key(table, query) {
            continue;
        }
        let t = table.value(row, 7).parse::<i64>().unwrap();
        if t >= time {
            continue;
        } // Strict prior; no four-hour cutoff.
        if latest.is_none_or(|(_, prev)| t > prev) {
            latest = Some((row, t));
            tied = false;
        } else if latest.is_some_and(|(_, prev)| t == prev) {
            tied = true;
        }
    }
    if tied {
        return Err("latest prior tie has undefined source order".into());
    }
    Ok(match latest {
        Some((row, t)) => vec![
            table.value(row, 0).into(),
            t.to_string(),
            table.value(row, 8).into(),
            "true".into(),
            "unique_latest_prior".into(),
        ],
        None => vec![
            "".into(),
            "".into(),
            "null".into(),
            "false".into(),
            "no_eligible_prior".into(),
        ],
    })
}

pub(super) fn last_event_role(feature: &str) -> &'static str {
    match feature {
        "Comm_PhoneCall_Incoming_MinSinceLast" | "time_last_incoming_call" => {
            "caller-selected-last-incoming-call-source-boundary"
        }
        "Usage_NotifCenter_MinSinceLast" | "time_last_notif_access" => {
            "caller-selected-last-notification-center-opening"
        }
        "Usage_Screen_MinSinceChanged" => "caller-selected-last-screen-status-change",
        "time_last_outgoing_call" => "caller-selected-last-outgoing-call-source-boundary",
        "time_last_notif" => "caller-selected-last-non-probe-eligible-notification",
        "time_last_SMS_read" => "caller-selected-last-SMS-read",
        "time_last_SMS_received" => "caller-selected-last-SMS-received",
        "time_last_SMS_sent" => "caller-selected-last-SMS-sent",
        "time_last_unlock" => "caller-selected-last-screen-unlock",
        _ => unreachable!("closed feature vocabulary"),
    }
}
fn recency(
    table: &Table,
    row: &csv::StringRecord,
    adapter: &str,
    allowed: &BTreeSet<String>,
) -> Result<Vec<String>, String> {
    let v = |i| table.value(row, i);
    for i in [3, 12] {
        required_id(v(i))?;
    }
    let features: &[&str] = if adapter == BEYOND {
        &BEYOND_FEATURES
    } else {
        &BORAPP_FEATURES
    };
    if !features.contains(&v(4)) || !allowed.contains(v(4)) {
        return Err("feature_key not selected by exact bound owner".into());
    }
    require(v(13), last_event_role(v(4)))?;
    require(v(14), "caller-resolved-source-feature-evaluation")?;
    require(v(15), "caller-qualified-unique-last-event-anchors")?;
    if !matches!(v(10), "ns" | "us" | "ms" | "s" | "min") {
        return Err("requires explicit coordinate_unit; no author-unit inference".into());
    }
    let exists = present(v(11))?;
    let last = optional_coordinate(v(8))?;
    let query = optional_coordinate(v(9))?;
    if !exists && (last.is_some() || !v(5).is_empty()) {
        return Err("absent last event must not carry an anchor/ID".into());
    }
    if exists {
        required_id(v(5))?;
    }
    let status = if !exists {
        "no_supplied_eligible_last_event"
    } else if last.is_none() || query.is_none() {
        "unavailable_supplied_coordinate"
    } else if v(6).is_empty() || v(7).is_empty() {
        "unavailable_supplied_clock"
    } else if v(6) != v(7) {
        "incomparable_supplied_clocks"
    } else {
        "available_supplied_difference"
    };
    let delta = if status == "available_supplied_difference" {
        Some(supplied_anchor_elapsed_nanoseconds(
            last.unwrap(),
            query.unwrap(),
        ))
    } else {
        None
    };
    let mut result = vec![
        delta.map(|d| d.to_string()).unwrap_or_default(),
        v(10).into(),
    ];
    if adapter == BEYOND {
        let divisor = match v(10) {
            "ns" => 60_000_000_000.0,
            "us" => 60_000_000.0,
            "ms" => 60_000.0,
            "s" => 60.0,
            "min" => 1.0,
            _ => unreachable!(),
        };
        result.push(
            delta
                .map(|d| format_python_float(d as f64 / divisor))
                .unwrap_or_default(),
        );
    }
    result.push(status.into());
    Ok(result)
}

#[cfg(test)]
pub(super) fn adapter_for_kind(kind: &str) -> &'static str {
    match kind {
        "kim" => KIM,
        "typing" => TYPING,
        "samples" => SAMPLES,
        "standby" => STANDBY,
        "bands" => BANDS,
        "prior" => PRIOR,
        "beyond" => BEYOND,
        "borapp" => BORAPP,
        _ => panic!("unknown hand fixture kind"),
    }
}
#[cfg(test)]
pub(super) fn default_feature(adapter: &str) -> &'static str {
    match adapter {
        PRIOR => CONTEXTS[0],
        BEYOND => BEYOND_FEATURES[0],
        BORAPP => BORAPP_FEATURES[0],
        _ => "",
    }
}
#[cfg(test)]
pub(super) fn fixture_csv(
    case: &serde_json::Value,
    defaults: &serde_json::Value,
    bound_feature: &str,
) -> Vec<u8> {
    let adapter = adapter_for_kind(case["kind"].as_str().unwrap());
    let extras = case["extra_headers"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(
            fields(adapter)
                .iter()
                .copied()
                .chain(extras.iter().copied()),
        )
        .unwrap();
    for (index, row) in case["rows"].as_array().unwrap().iter().enumerate() {
        writer
            .write_record(
                fields(adapter)
                    .iter()
                    .copied()
                    .chain(extras.iter().copied())
                    .map(|field| {
                        if field == "source_row_id" && row.get(field).is_none() {
                            return format!("r{}", index + 1);
                        }
                        let raw = row
                            .get(field)
                            .or_else(|| defaults[case["kind"].as_str().unwrap()].get(field))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        match raw {
                            "$boundfeature" => bound_feature.to_owned(),
                            "$lastrole" => last_event_role(bound_feature).into(),
                            _ => raw.into(),
                        }
                    }),
            )
            .unwrap();
    }
    writer.into_inner().unwrap()
}
#[cfg(test)]
pub(super) fn assert_fixture_output(case: &serde_json::Value, input: &[u8], output: &[u8]) {
    let adapter = adapter_for_kind(case["kind"].as_str().unwrap());
    let mut reader = csv::Reader::from_reader(output);
    let headers = reader.headers().unwrap().clone();
    let rows = reader.records().map(Result::unwrap).collect::<Vec<_>>();
    let expected = case["expected"].as_array().unwrap();
    assert_eq!(rows.len(), expected.len(), "{}", case["id"]);
    let mut source = csv::Reader::from_reader(input);
    let originals = source.headers().unwrap().clone();
    let source_rows = source
        .records()
        .map(Result::unwrap)
        .filter(|r| adapter != PRIOR || r.get(5) == Some("query"))
        .collect::<Vec<_>>();
    if adapter == BANDS {
        assert_eq!(headers.iter().collect::<Vec<_>>(), output_fields(adapter));
    } else {
        assert_eq!(
            headers.iter().take(originals.len()).collect::<Vec<_>>(),
            originals.iter().collect::<Vec<_>>()
        );
        assert_eq!(
            headers.iter().skip(originals.len()).collect::<Vec<_>>(),
            output_fields(adapter)
        );
    }
    for (index, (row, expected)) in rows.iter().zip(expected).enumerate() {
        let offset = if adapter == BANDS { 0 } else { originals.len() };
        if adapter != BANDS {
            assert_eq!(
                row.iter().take(offset).collect::<Vec<_>>(),
                source_rows[index].iter().collect::<Vec<_>>()
            );
        }
        assert_eq!(
            row.iter().skip(offset).collect::<Vec<_>>(),
            expected
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>(),
            "{}",
            case["id"]
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplied_context_sequence_independent_hand_cases() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_context_sequence.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let adapter = adapter_for_kind(case["kind"].as_str().unwrap());
            let feature = default_feature(adapter);
            let allowed = BTreeSet::from([feature.to_owned()]);
            let input = fixture_csv(case, &fixtures["defaults"], feature);
            let result = execute(adapter, &input, &allowed);
            if let Some(error) = case["error"].as_str() {
                assert!(result.unwrap_err().contains(error), "{}", case["id"]);
            } else {
                let (output, source, emitted) =
                    result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
                assert_eq!(source, case["rows"].as_array().unwrap().len());
                assert_eq!(emitted, case["expected"].as_array().unwrap().len());
                assert_fixture_output(case, &input, &output);
            }
        }
    }
    #[test]
    fn supplied_context_sequence_independent_integer_and_order_math() {
        // These literal u128/i128 expectations do not share the implementation.
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MIN, i64::MAX),
            18_446_744_073_709_551_615_i128
        );
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MAX, i64::MIN),
            -18_446_744_073_709_551_615_i128
        );
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(9_007_199_254_740_992, 9_007_199_254_740_993),
            1
        );
        let classifier = FiniteScalarPivotClassifier::new(30.0, false, false, true).unwrap();
        assert!(!*classifier.category_for(30.0).unwrap());
        assert!(
            *classifier
                .category_for(f64::from_bits(30.0_f64.to_bits() + 1))
                .unwrap()
        );
    }
}
