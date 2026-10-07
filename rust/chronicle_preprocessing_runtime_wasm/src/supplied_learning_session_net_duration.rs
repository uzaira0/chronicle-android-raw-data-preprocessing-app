//! Why Did You Stop, doi:10.1145/3473856.3473881, retained primary p8 §4.4.4.
//! Supplied complete gross-session seconds minus disjoint suspending durations.
//! No raw LAIRA reconstruction, endpoint choice, overlap union or model execution.
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use serde::Deserialize;
use serde_json::value::RawValue;
#[cfg(test)]
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const ADAPTER: &str = "chronicle.supplied-learning-session-net-duration";
pub(super) const KIND: &str = "literature-supplied-learning-session-net-duration-csv";
pub(super) const FIELDS: &[&str] = &[
    "source_row_id",
    "participant_id",
    "source_device_id",
    "source_stream_id",
    "source_platform",
    "learning_session_id",
    "learning_app_id",
    "gross_duration_seconds",
    "duration_unit",
    "input_stage",
    "interruption_inventory_stage",
    "suspending_interruptions_json",
];
const OUTPUTS: &[&str] = &[
    "total_suspending_duration_seconds",
    "net_duration_seconds",
    "net_duration_status",
];

// Serde's ordinary struct visitor refuses duplicate recognized fields before
// collapse. Extra entry fields remain uninterpreted in the retained raw cell.
#[derive(Deserialize)]
struct InterruptionEntry {
    interruption_id: String,
    learning_session_id: String,
    kind: String,
    duration_seconds: Box<RawValue>,
}

pub(super) fn duration(raw: &str) -> Result<Option<f64>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    let value = raw
        .parse::<f64>()
        .map_err(|_| "duration requires a numeric seconds scalar")?;
    // Check the supplied decimal significand before projection can underflow
    // a negative nonzero quantity to -0. Genuine lexical zero remains valid.
    let negative_nonzero = raw.strip_prefix('-').is_some_and(|unsigned| {
        unsigned
            .split(['e', 'E'])
            .next()
            .unwrap()
            .bytes()
            .any(|digit| matches!(digit, b'1'..=b'9'))
    });
    if !value.is_finite() || value < 0.0 || negative_nonzero {
        return Err("duration requires finite nonnegative seconds".into());
    }
    Ok(Some(value))
}

fn json_duration(raw: &RawValue) -> Result<Option<f64>, String> {
    match raw.get() {
        "null" => Ok(None),
        text if text.starts_with('"') => {
            duration(&serde_json::from_str::<String>(text).map_err(|e| e.to_string())?)
        }
        text if text.starts_with('-') || text.starts_with(|c: char| c.is_ascii_digit()) => {
            duration(text)
        }
        _ => {
            Err("duration_seconds must be an explicit numeric scalar, numeric text or null".into())
        }
    }
}

/// Reuse the existing ordered sum at identity projection/scaling. Missing terms
/// mean an unavailable total here, not a claim about the study's R/NA policy.
fn total(terms: &[Option<f64>]) -> Result<Option<f64>, String> {
    if terms.is_empty() {
        return Ok(Some(0.0));
    } // Explicit complete empty inventory.
    let rows = terms
        .iter()
        .map(|value| GroupedScalarInput {
            entity: (),
            raw_partition: (),
            passthrough: (),
            value: value.map_or(RCompatibleScalar::Missing, RCompatibleScalar::Finite),
        })
        .collect::<Vec<_>>();
    let summed = grouped_scalar_sum_then_project_unique(
        &rows,
        SequentialDivisionConfiguration {
            first_divisor: 1.0,
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|error| error.to_string())?;
    match summed[0].sum {
        RCompatibleScalar::Missing => Ok(None),
        RCompatibleScalar::Finite(value) if value.is_finite() && value >= 0.0 => Ok(Some(value)),
        _ => Err("interruption duration total exceeds the finite nonnegative domain".into()),
    }
}

pub(super) fn csv(raw: &[u8]) -> Result<(Vec<u8>, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
        || headers.iter().any(|name| OUTPUTS.contains(&name))
    {
        return Err("requires unique raw columns without supplied computed outputs".into());
    }
    let columns = FIELDS
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .map(|column| (*name, column))
                .ok_or_else(|| format!("{ADAPTER} requires {name}"))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut output_headers = headers.clone();
    output_headers.extend(OUTPUTS.iter().copied());
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    let mut row_facts = BTreeMap::new();
    // Local consistency of supplied facts, not a session/interruption detector.
    type SessionFacts = (String, String, String, Option<f64>, Option<BTreeSet<String>>);
    let mut sessions: BTreeMap<_, SessionFacts> = BTreeMap::new();
    let mut interruptions: BTreeMap<_, (String, String, String, Option<f64>)> = BTreeMap::new();
    let mut declared_inventories = Vec::new();
    for record in &records {
        let value = |name: &str| &record[columns[name]];
        for name in [
            "source_row_id",
            "participant_id",
            "source_device_id",
            "source_stream_id",
            "learning_session_id",
            "learning_app_id",
        ] {
            if value(name).trim().is_empty() {
                return Err(format!("{name} must be supplied"));
            }
        }
        if value("source_platform") != "Android"
            || value("duration_unit") != "s"
            || value("input_stage") != "caller-qualified-complete-gross-learning-session"
            || value("interruption_inventory_stage")
                != "caller-qualified-complete-disjoint-suspending-durations"
        {
            return Err("requires explicitly Android complete gross-session seconds and a caller-qualified complete disjoint suspending-duration inventory".into());
        }
        let participant = value("participant_id").to_owned();
        let device = value("source_device_id").to_owned();
        let stream = value("source_stream_id").to_owned();
        let session = value("learning_session_id").to_owned();
        let row_key = (
            device.clone(),
            stream.clone(),
            value("source_row_id").to_owned(),
        );
        if row_facts.get(&row_key).is_some_and(|prior| prior != record) {
            return Err("source row identity has conflicting lexical input".into());
        }
        row_facts.insert(row_key, record.clone());
        let gross = duration(value("gross_duration_seconds"))?;
        let mut terms = Vec::new();
        let mut members = BTreeSet::new();
        let mut member_order = Vec::new();
        let supplied_inventory = if value("suspending_interruptions_json").is_empty() {
            false
        } else {
            let entries: Vec<InterruptionEntry> =
                serde_json::from_str(value("suspending_interruptions_json"))
                    .map_err(|e| format!("invalid supplied interruption inventory: {e}"))?;
            for entry in entries {
                let id = entry.interruption_id.as_str();
                if id.trim().is_empty() {
                    return Err("interruption_id must be supplied".into());
                }
                if entry.learning_session_id != session || entry.kind != "admitted_suspending" {
                    return Err(
                        "interruption requires matching session and admitted_suspending role"
                            .into(),
                    );
                }
                if !members.insert(id.to_owned()) {
                    return Err("qualified disjoint inventory requires distinct interruption identities; no deduplication is inferred".into());
                }
                member_order.push(id.to_owned());
                let seconds = json_duration(&entry.duration_seconds)?;
                let key = (device.clone(), id.to_owned());
                let mut facts = (
                    participant.clone(),
                    stream.clone(),
                    session.clone(),
                    seconds,
                );
                if let Some(prior) = interruptions.get(&key) {
                    if prior.0 != facts.0
                        || prior.1 != facts.1
                        || prior.2 != facts.2
                        || matches!((prior.3, facts.3), (Some(a), Some(b)) if a != b)
                    {
                        return Err("interruption identity has contradictory known owner/session/duration facts".into());
                    }
                    facts.3 = facts.3.or(prior.3); // Consistency only, never fill this row's terms.
                }
                interruptions.insert(key, facts);
                terms.push(seconds);
            }
            true
        };
        let key = (device, session);
        if supplied_inventory {
            declared_inventories.push((key.clone(), member_order));
        }
        let mut facts = (
            participant,
            stream,
            value("learning_app_id").to_owned(),
            gross,
            supplied_inventory.then_some(members),
        );
        if let Some(prior) = sessions.get(&key) {
            if prior.0 != facts.0
                || prior.1 != facts.1
                || prior.2 != facts.2
                || matches!((prior.3, facts.3), (Some(a), Some(b)) if a != b)
                || matches!((&prior.4, &facts.4), (Some(a), Some(b)) if a != b)
            {
                return Err("learning-session identity has contradictory known owner/app/gross/inventory facts".into());
            }
            facts.3 = facts.3.or(prior.3);
            facts.4 = facts.4.or_else(|| prior.4.clone());
        }
        sessions.insert(key, facts);
        let interruption_total = if supplied_inventory {
            total(&terms)?
        } else {
            None
        };
        if supplied_inventory && terms.iter().any(Option::is_none) {
            // Unknown terms remain unknown, but known nonnegative contributions
            // already exceeding gross cannot be contained by this session.
            let known = terms
                .iter()
                .flatten()
                .copied()
                .map(Some)
                .collect::<Vec<_>>();
            let known_total = total(&known)?.expect("only known finite terms supplied");
            if gross.is_some_and(|gross| known_total > gross) {
                return Err(
                    "known admitted interruption subtotal exceeds supplied gross-session duration"
                        .into(),
                );
            }
        }
        let result = if !supplied_inventory {
            Err("missing_interruption_inventory")
        } else {
            match (gross, interruption_total) {
                (None, _) => Err("missing_gross_duration"),
                (_, None) => Err("missing_interruption_duration"),
                (Some(gross), Some(interrupted)) => {
                    if interrupted > gross {
                        return Err(
                            "admitted interruption total exceeds supplied gross-session duration".into(),
                        );
                    }
                    Ok(gross - interrupted)
                }
            }
        };
        let mut output = record.clone();
        output.push_field(
            &interruption_total
                .map(|value| value.to_string())
                .unwrap_or_default(),
        );
        match result {
            Ok(value) => {
                output.push_field(&value.to_string());
                output.push_field("computed_binary64_gross_minus_disjoint_interruptions");
            }
            Err(reason) => {
                output.push_field("");
                output.push_field(&format!("unavailable:{reason}"));
            }
        }
        writer.write_record(&output).map_err(|e| e.to_string())?;
    }
    // Reconcile only known supplied facts after every declaration has been
    // checked. Each retained inventory's own list order feeds the same sum.
    // This validation never changes a row's original inputs or missing output.
    for (key, members) in declared_inventories {
        if let Some(gross) = sessions[&key].3 {
            let known = members
                .iter()
                .filter_map(|id| interruptions[&(key.0.clone(), id.clone())].3)
                .map(Some)
                .collect::<Vec<_>>();
            if total(&known)?.expect("only known finite terms supplied") > gross {
                return Err("known admitted interruption subtotal exceeds supplied gross-session duration across declarations".into());
            }
        }
    }
    Ok((
        writer.into_inner().map_err(|e| e.to_string())?,
        records.len(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_learning_session_net_duration_hand_oracle.json"
        ))
        .unwrap()
    }
    fn lines(key: &str) -> Vec<u8> {
        let f = fixture();
        (f["cases"][0][key]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n")
            .into_bytes()
    }
    fn edited(row: usize, field: &str, replacement: &str) -> Vec<u8> {
        let raw = lines("raw_csv_lines");
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let headers = reader.headers().unwrap().clone();
        let column = headers.iter().position(|h| h == field).unwrap();
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(&headers).unwrap();
        for (index, record) in reader.records().enumerate() {
            let record = record.unwrap();
            writer
                .write_record(record.iter().enumerate().map(|(i, value)| {
                    if index == row && i == column {
                        replacement
                    } else {
                        value
                    }
                }))
                .unwrap();
        }
        writer.into_inner().unwrap()
    }

    fn declarations(rows: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(FIELDS).unwrap();
        for (id, gross, inventory) in rows {
            writer
                .write_record([
                    *id,
                    "A",
                    "dA",
                    "streamA",
                    "Android",
                    "s",
                    "app",
                    *gross,
                    "s",
                    "caller-qualified-complete-gross-learning-session",
                    "caller-qualified-complete-disjoint-suspending-durations",
                    *inventory,
                ])
                .unwrap();
        }
        writer.into_inner().unwrap()
    }
    #[test]
    fn retained_known_contributions_refuse_excess_without_imputing_row_outputs() {
        let first = r#"[{"interruption_id":"i1","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":8},{"interruption_id":"i2","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":null}]"#;
        let second = r#"[{"interruption_id":"i1","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":null},{"interruption_id":"i2","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":8}]"#;
        for rows in [
            vec![("r1", "10", first), ("r2", "10", second)],
            vec![("r2", "10", second), ("r1", "10", first)],
        ] {
            assert!(csv(&declarations(&rows)).is_err(), "retained 8+8 exceeds10");
        }
        let twenty = r#"[{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20}]"#;
        for rows in [
            vec![("r1", "10", ""), ("r2", "", twenty)],
            vec![("r2", "", twenty), ("r1", "10", "")],
        ] {
            assert!(
                csv(&declarations(&rows)).is_err(),
                "known20 exceeds known10"
            );
        }
        // Compatible facts qualify consistency, not either row's calculation.
        let (bytes, _) = csv(&declarations(&[("r1", "20", first), ("r2", "20", second)])).unwrap();
        let mut reader = csv::Reader::from_reader(bytes.as_slice());
        let headers = reader.headers().unwrap().clone();
        let net = headers
            .iter()
            .position(|h| h == "net_duration_seconds")
            .unwrap();
        let status = headers
            .iter()
            .position(|h| h == "net_duration_status")
            .unwrap();
        for record in reader.records() {
            let record = record.unwrap();
            assert_eq!(&record[net], "");
            assert_eq!(&record[status], "unavailable:missing_interruption_duration");
        }
    }
    #[test]
    fn duplicate_critical_entry_keys_are_refused_before_any_last_value_choice() {
        for entry in [
            r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20,"duration_seconds":0}"#,
            r#"{"interruption_id":"i","learning_session_id":"foreign","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0}"#,
            r#"{"interruption_id":"i","learning_session_id":"s","kind":"terminating","kind":"admitted_suspending","duration_seconds":0}"#,
            r#"{"interruption_id":"foreign","interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0}"#,
            r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0,"duration_seconds":0}"#,
            r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20,"duration_\u0073econds":0}"#,
        ] {
            assert!(
                csv(&declarations(&[("r", "10", &format!("[{entry}]"))])).is_err(),
                "{entry}"
            );
        }
    }
    #[test]
    fn lexical_negative_nonzero_underflow_is_refused_but_genuine_zero_survives() {
        for scalar in ["-1e-400", "-0.0001E-999", "-1e-9999"] {
            assert!(duration(scalar).is_err(), "gross/text {scalar}");
            assert!(csv(&declarations(&[("r", scalar, "[]")])).is_err());
            for encoded in [scalar.to_owned(), serde_json::to_string(scalar).unwrap()] {
                let inventory = format!(
                    r#"[{{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":{encoded}}}]"#
                );
                assert!(
                    csv(&declarations(&[("r", "10", &inventory)])).is_err(),
                    "{encoded}"
                );
            }
        }
        for scalar in ["-0", "-0.000e-400", "0", "0.000e-400"] {
            assert_eq!(duration(scalar).unwrap(), Some(0.0));
            assert!(csv(&declarations(&[("r", scalar, "[]")])).is_ok());
            for encoded in [scalar.to_owned(), serde_json::to_string(scalar).unwrap()] {
                let inventory = format!(
                    r#"[{{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":{encoded}}}]"#
                );
                assert!(
                    csv(&declarations(&[("r", "10", &inventory)])).is_ok(),
                    "{encoded}"
                );
            }
        }
    }

    #[test]
    fn hand_oracle_reuses_sum_and_preserves_lexical_rows() {
        let (bytes, count) = csv(&lines("raw_csv_lines")).unwrap();
        assert_eq!(bytes, lines("expected_csv_lines"));
        assert_eq!(count, 9);
        assert_eq!(total(&[Some(10.0), Some(15.5)]).unwrap(), Some(25.5));
        assert_eq!(total(&[]).unwrap(), Some(0.0));
        assert_eq!(total(&[Some(10.0), None]).unwrap(), None);
        assert!(total(&[Some(f64::MAX), Some(f64::MAX)]).is_err());
    }
    #[test]
    fn one_exact_existing_source_setting_owns_the_normal_contract_and_case() {
        let id = "method-setting-8212b7717f3d8401939701eb";
        let contract: Value = serde_json::from_str(include_str!(
            "../../../web/schema/literature-input-adapter-contract.json"
        ))
        .unwrap();
        let owners = contract["groups"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|g| {
                g["methodSettingIds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|s| s == id)
            })
            .collect::<Vec<_>>();
        assert_eq!(owners.len(), 1);
        let group = owners[0];
        assert_eq!(group["adapterId"], ADAPTER);
        assert_eq!(group["requiredFields"], serde_json::json!(FIELDS));
        assert_eq!(
            group["componentExecution"]["componentId"],
            "chronicle.supplied-learning-session-net-duration/v1"
        );
        assert_eq!(
            group["componentExecution"]["sourceWorkId"],
            "doi:10.1145/3473856.3473881"
        );
        assert_eq!(
            group["componentExecution"]["parentMethodProfileId"],
            "method-profile:doi:10.1145/3473856.3473881"
        );
        assert_eq!(
            group["componentExecution"]["sourceMethodVariantId"],
            "source-audit-configuration-space-818234e736d3d3b1f16ec3fa"
        );
        assert_eq!(
            group["componentExecution"]["methodProfileVersion"],
            "literature-sublation-v3-atomic+source-complete-v1"
        );
        assert_eq!(
            group["componentExecution"]["fullProfileExecutionStatus"],
            "blocked"
        );
        let conformance: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/literature_input_adapter_conformance.json"
        ))
        .unwrap();
        assert_eq!(
            conformance["sourceMethodVariants"][id],
            group["componentExecution"]["sourceMethodVariantId"]
        );
        let cases = conformance["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["cases"].as_array().unwrap())
            .filter(|c| c["methodSettingId"] == id)
            .collect::<Vec<_>>();
        assert_eq!(cases.len(), 1);
        assert_eq!(
            cases[0]["rawCsvLines"],
            fixture()["cases"][0]["raw_csv_lines"]
        );
        assert_eq!(
            cases[0]["expected"]["derivedOutputContains"],
            fixture()["cases"][0]["expected_csv_lines"]
        );
        assert_eq!(
            cases[0]["sourceValue"],
            serde_json::json!({
                "definition":{"learning_session_net_length":"session duration excluding suspending interruption time","exact_overlap_or_multiple_interruption_union_rule":null},
                "source_facing_role":"feature_engineering","source_facing_target":"derived_feature",
                "source_evidence_status":"explicit_measure_unknown_overlap_arithmetic"
            })
        );
    }
    #[test]
    fn source_units_roles_and_distinct_complete_inventory_are_explicit() {
        for (field, replacement) in [
            ("duration_unit", "ms"),
            ("source_platform", "iOS"),
            ("input_stage", "raw-LAIRA-events"),
            ("interruption_inventory_stage", "automatic-overlap-union"),
            ("source_device_id", ""),
            ("learning_session_id", ""),
        ] {
            assert!(csv(&edited(0, field, replacement)).is_err(), "{field}");
        }
        for replacement in [
            r#"[{"interruption_id":"i1","learning_session_id":"foreign","kind":"admitted_suspending","duration_seconds":10}]"#,
            r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"terminating","duration_seconds":10}]"#,
            r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":10},{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":10}]"#,
            "null",
            "{}",
            "[{}]",
        ] {
            assert!(csv(&edited(0, "suspending_interruptions_json", replacement)).is_err());
        }
    }
    #[test]
    fn interruption_and_session_entities_are_scoped_to_the_declared_device() {
        // Identical lexical session/occurrence IDs on another device are distinct.
        let inventory = r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":5}]"#;
        let (bytes, _) = csv(&edited(1, "suspending_interruptions_json", inventory)).unwrap();
        assert!(String::from_utf8(bytes)
            .unwrap()
            .lines()
            .nth(2)
            .unwrap()
            .ends_with(",5,55,computed_binary64_gross_minus_disjoint_interruptions"));
        // A known occurrence cannot move to a different session on the same device.
        let foreign = r#"[{"interruption_id":"i1","learning_session_id":"s3","kind":"admitted_suspending","duration_seconds":1}]"#;
        assert!(csv(&edited(3, "suspending_interruptions_json", foreign))
            .unwrap_err()
            .contains("interruption identity"));
    }
    #[test]
    fn negative_excess_nonfinite_and_contradictory_known_facts_are_refused() {
        for gross in ["-1", "NaN", "Inf", "10"] {
            assert!(csv(&edited(0, "gross_duration_seconds", gross)).is_err());
        }
        for value in ["-1", "NaN", "1e309"] {
            let inventory = format!(
                r#"[{{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":"{value}"}}]"#
            );
            assert!(csv(&edited(0, "suspending_interruptions_json", &inventory)).is_err());
        }
        let partial_excess = r#"[{"interruption_id":"i6","learning_session_id":"s5","kind":"admitted_suspending","duration_seconds":40},{"interruption_id":"i7","learning_session_id":"s5","kind":"admitted_suspending","duration_seconds":null}]"#;
        assert!(
            csv(&edited(5, "suspending_interruptions_json", partial_excess))
                .unwrap_err()
                .contains("subtotal exceeds")
        );
        for field in [
            "gross_duration_seconds",
            "learning_app_id",
            "source_stream_id",
            "participant_id",
        ] {
            assert!(csv(&edited(
                8,
                field,
                if field == "gross_duration_seconds" {
                    "101"
                } else {
                    "foreign"
                }
            ))
            .is_err());
        }
        let inventory = r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":11},{"interruption_id":"i2","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":15.5}]"#;
        assert!(csv(&edited(8, "suspending_interruptions_json", inventory)).is_err());
        let inventory = r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":10}]"#;
        assert!(csv(&edited(8, "suspending_interruptions_json", inventory)).is_err());
    }
    #[test]
    fn missingness_is_not_zero_or_filled_from_other_declarations() {
        for (row, field, replacement, reason) in [
            (8, "gross_duration_seconds", "", "missing_gross_duration"),
            (
                8,
                "suspending_interruptions_json",
                "",
                "missing_interruption_inventory",
            ),
            (
                8,
                "suspending_interruptions_json",
                r#"[{"interruption_id":"i1","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":null},{"interruption_id":"i2","learning_session_id":"s1","kind":"admitted_suspending","duration_seconds":15.5}]"#,
                "missing_interruption_duration",
            ),
        ] {
            let (bytes, _) = csv(&edited(row, field, replacement)).unwrap();
            assert!(String::from_utf8(bytes)
                .unwrap()
                .lines()
                .last()
                .unwrap()
                .ends_with(&format!(",unavailable:{reason}")));
        }
        // Unknown first facts do not impute later or earlier calculation input.
        let (bytes, _) = csv(&edited(0, "gross_duration_seconds", "")).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("unavailable:missing_gross_duration"));
        assert!(text
            .lines()
            .last()
            .unwrap()
            .ends_with(",74.5,computed_binary64_gross_minus_disjoint_interruptions"));
    }
    #[test]
    fn headers_computed_input_and_conflicting_source_rows_fail_closed() {
        let raw = String::from_utf8(lines("raw_csv_lines")).unwrap();
        assert!(csv(raw
            .replacen("participant_id", "source_row_id", 1)
            .as_bytes())
        .is_err());
        assert!(csv(raw.replacen("duration_unit", "omitted_unit", 1).as_bytes()).is_err());
        assert!(csv(raw.replacen(",note", ",net_duration_seconds", 1).as_bytes()).is_err());
        assert!(csv(&edited(8, "source_row_id", "r1")).is_err());
        let mut duplicate = lines("raw_csv_lines");
        duplicate.extend_from_slice(
            (fixture()["cases"][0]["raw_csv_lines"][1]
                .as_str()
                .unwrap()
                .to_owned()
                + "\n")
                .as_bytes(),
        );
        assert_eq!(csv(&duplicate).unwrap().1, 10);
    }
}
