//! SleepMiner retained rank274:183–227: supplied directed person-day edges.
//! Numeric e1/e2, raw direction/day construction and the full G^t are unclaimed.
use super::required_header;
use crate::grouped_distinct_count::distinct_members_by_group;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const ADAPTER: &str = "chronicle.sleepminer-directed-edge-memberships";
pub(super) const KIND: &str = "literature-sleepminer-directed-edge-memberships-csv";
pub(super) const FIELDS: [&str; 11] = [
    "source_row_id", "source_device_id", "source_stream_id",
    "source_owner_subject_id", "source_platform", "input_stage",
    "graph_scope_id", "source_day_id", "from_subject_id",
    "to_subject_id", "communication_dimension",
];
pub(super) const RECORD_ID: &str = "source_record_id";
const STAGE: &str = "caller-qualified-directed-connected-subject-communication";
type Edge = (String, String, String, String);

fn known(
    facts: &mut BTreeMap<Vec<String>, Vec<String>>,
    key: Vec<String>,
    value: Vec<String>,
) -> Result<(), String> {
    if let Some(previous) = facts.get(&key) {
        if previous != &value {
            return Err(format!("{ADAPTER} refuses contradictory supplied identity facts"));
        }
    } else {
        facts.insert(key, value);
    }
    Ok(())
}

/// Group observed rows, not prebuilt edges. Every original row remains a member:
/// identical repeated records are retained, not silently deduplicated or counted
/// as a source numerical feature. Structural tuple keys cannot collide on '/'.
pub(super) fn csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{ADAPTER} header: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{ADAPTER} refuses duplicate CSV column identities"));
    }
    let names = FIELDS.into_iter().chain([RECORD_ID]).collect::<Vec<_>>();
    let fields = names.iter().map(|name|
        required_header(&headers, name, ADAPTER).map(|index| (*name, index))
    ).collect::<Result<BTreeMap<_, _>, _>>()?;
    let rows = reader.records().enumerate().map(|(index, row)|
        row.map_err(|e| format!("{ADAPTER} row {}: {e}", index + 1))
    ).collect::<Result<Vec<_>, _>>()?;
    let mut facts = BTreeMap::new();
    let mut observed = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let value = |name: &str| row.get(fields[name]).unwrap_or("");
        for name in &names {
            if value(name).trim().is_empty() {
                return Err(format!("{ADAPTER} requires nonblank supplied {name}"));
            }
        }
        if value("source_platform") != "Android" || value("input_stage") != STAGE {
            return Err(format!("{ADAPTER} requires Android and exact caller qualification"));
        }
        if !matches!(value("communication_dimension"), "calling" | "messaging") {
            return Err(format!("{ADAPTER} requires supplied calling or messaging dimension"));
        }
        // Source ownership is separate from directed endpoints: an incoming
        // communication's logger need not be the caller-qualified from-subject.
        let scope = value("graph_scope_id");
        let device = value("source_device_id");
        let stream = value("source_stream_id");
        known(&mut facts,
            vec!["stream".into(), scope.into(), device.into(), stream.into()],
            vec![value("source_owner_subject_id").into()])?;
        let record_facts = [
            "source_owner_subject_id", "source_day_id", "from_subject_id",
            "to_subject_id", "communication_dimension",
        ].iter().map(|name| value(name).to_owned()).collect::<Vec<_>>();
        known(&mut facts,
            vec!["record".into(), scope.into(), device.into(), stream.into(), value(RECORD_ID).into()],
            record_facts.clone())?;
        let row_facts = row.iter().map(str::to_owned).collect::<Vec<_>>();
        known(&mut facts,
            vec!["row".into(), scope.into(), device.into(), stream.into(), value("source_row_id").into()],
            row_facts)?;
        let edge: Edge = (
            scope.into(), value("source_day_id").into(),
            value("from_subject_id").into(), value("to_subject_id").into(),
        );
        observed.push((edge, index));
    }
    // Reuse the current existing set accumulation; members are unique ORIGINAL
    // row indices, so it does not drop duplicate source IDs/records. Ordering by
    // first original index is transport order, not a chronology/calendar policy.
    let mut edges = distinct_members_by_group(observed);
    edges.sort_by_key(|(_, members)| *members.iter().next().expect("observed edge"));
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record([
        "graph_scope_id", "source_day_id", "from_subject_id", "to_subject_id",
        "calling_record_memberships_json", "messaging_record_memberships_json",
        "source_row_indices_json", "edge_construction_status",
    ]).map_err(|e| format!("{ADAPTER} output header: {e}"))?;
    for ((scope, day, from, to), members) in &edges {
        let mut calling = Vec::new();
        let mut messaging = Vec::new();
        for index in members {
            let row = &rows[*index];
            let value = |name: &str| row.get(fields[name]).unwrap_or("");
            let original_fields = headers.iter().zip(row.iter())
                .map(|(key, value)| (key.to_owned(), Value::String(value.to_owned())))
                .collect::<serde_json::Map<_, _>>();
            let member = json!({
                "source_record_index": index + 1,
                "source_row_id": value("source_row_id"),
                "source_record_id": value(RECORD_ID),
                "source_device_id": value("source_device_id"),
                "source_stream_id": value("source_stream_id"),
                "source_owner_subject_id": value("source_owner_subject_id"),
                "original_header": headers.iter().collect::<Vec<_>>(),
                "original_cells": row.iter().collect::<Vec<_>>(),
                "original_fields": original_fields,
            });
            if value("communication_dimension") == "calling" {
                calling.push(member);
            } else {
                messaging.push(member);
            }
        }
        // No observation of a channel is NOT a disclosed zero e_k. Null is
        // explicitly "no supplied record membership", not a numerical value.
        let channel = |records: Vec<Value>| if records.is_empty() {
            "null".to_owned()
        } else {
            serde_json::to_string(&records).expect("string records serialize")
        };
        writer.write_record([
            scope.clone(), day.clone(), from.clone(), to.clone(),
            channel(calling), channel(messaging),
            serde_json::to_string(&members.iter().map(|i| i + 1).collect::<Vec<_>>())
                .expect("row indices serialize"),
            "constructed_observed_directed_edge_memberships_only".into(),
        ]).map_err(|e| format!("{ADAPTER} output row: {e}"))?;
    }
    let bytes = writer.into_inner().map_err(|e| format!("{ADAPTER} output: {e}"))?;
    Ok((bytes, rows.len(), edges.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/sleepminer_directed_edges_hand_oracle.json")).unwrap()
    }
    fn input(case: &Value) -> Vec<u8> {
        (case["raw_csv_lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap())
            .collect::<Vec<_>>().join("\n") + "\n").into_bytes()
    }
    fn projection(bytes: &[u8]) -> Vec<Value> {
        let mut reader = csv::Reader::from_reader(bytes);
        reader.records().map(|r| {
            let row = r.unwrap();
            let ids = |index: usize| {
                let members: Value = serde_json::from_str(&row[index]).unwrap();
                if members.is_null() { Value::Null } else {
                    json!(members.as_array().unwrap().iter().map(|m|
                        m["source_record_id"].as_str().unwrap()).collect::<Vec<_>>())
                }
            };
            json!({"scope":row[0], "day":row[1], "from":row[2], "to":row[3],
                "calling":ids(4), "messaging":ids(5),
                "rows":serde_json::from_str::<Value>(&row[6]).unwrap()})
        }).collect()
    }
    #[test]
    fn sleepminer_hand_edges_and_no_source_inference() {
        for case in fixture()["cases"].as_array().unwrap() {
            let result = csv(&input(case));
            if case["refuse"] == true {
                assert!(result.is_err(), "{}: accepted", case["name"]);
            } else {
                let (bytes, source, edges) = result.unwrap();
                assert_eq!(source, case["source_rows"].as_u64().unwrap() as usize);
                assert_eq!(edges, case["expected"].as_array().unwrap().len());
                assert_eq!(json!(projection(&bytes)), case["expected"], "{}", case["name"]);
            }
        }
    }
    #[test]
    fn sleepminer_normal_registered_csv_matches_independent_hand_table() {
        use super::super::{adapt_literature_inputs_registered, conformance_case_binding,
            contract_by_setting, execute_conformance_case, sha256, ConformanceManifest};
        let manifest: ConformanceManifest = serde_json::from_str(
            crate::packed_json::ADAPTER_CONFORMANCE.text().unwrap()).unwrap();
        let group = manifest.groups.iter().find(|g| g.adapter_id == format!("{ADAPTER}/v1")).unwrap();
        let case = &group.cases[0];
        let contract = contract_by_setting().unwrap();
        let registered = contract.get(&case.method_setting_id).unwrap();
        execute_conformance_case(group, case, registered,
            &manifest.source_method_variants[&case.method_setting_id]).unwrap();
        let binding = conformance_case_binding(case, registered);
        for hand in fixture()["cases"].as_array().unwrap() {
            let raw = input(hand);
            let result = adapt_literature_inputs_registered(&raw, &sha256(&raw),
                std::slice::from_ref(&binding), &|_| &[]);
            if hand["refuse"] == true {
                assert!(result.is_err(), "{}: accepted", hand["name"]);
            } else {
                let adapted = result.unwrap().unwrap();
                assert_eq!(json!(projection(&adapted.csv_bytes)), hand["expected"], "{}", hand["name"]);
                assert_eq!(adapted.receipt.source_row_count,
                    hand["source_rows"].as_u64().unwrap() as u32);
                assert_eq!(adapted.receipt.duplicate_source_ids_removed, 0);
                assert_eq!(adapted.receipt.materialized_interval_count, 0);
            }
        }
    }
    #[test]
    fn sleepminer_members_preserve_every_lexical_source_cell() {
        let f = fixture();
        let raw = input(&f["cases"][0]);
        let mut original = csv::Reader::from_reader(raw.as_slice());
        let headers = original.headers().unwrap().clone();
        let rows = original.records().map(Result::unwrap).collect::<Vec<_>>();
        let (output, _, _) = csv(&raw).unwrap();
        let mut reader = csv::Reader::from_reader(output.as_slice());
        let mut seen = BTreeSet::new();
        for row in reader.records() {
            let row = row.unwrap();
            for column in [4, 5] {
                let memberships: Value = serde_json::from_str(&row[column]).unwrap();
                if let Some(members) = memberships.as_array() {
                    for member in members {
                        let index = member["source_record_index"].as_u64().unwrap() as usize - 1;
                        assert!(seen.insert(index));
                        assert_eq!(member["original_header"], json!(headers.iter().collect::<Vec<_>>()));
                        assert_eq!(member["original_cells"], json!(rows[index].iter().collect::<Vec<_>>()));
                        for (key, value) in headers.iter().zip(rows[index].iter()) {
                            assert_eq!(member["original_fields"][key], value);
                        }
                    }
                }
            }
        }
        assert_eq!(seen.len(), rows.len());
    }
}
