use chronicle_preprocessing_runtime_wasm::affectpro_touch_features::{
    execute_affectpro_touch_csv, OUTPUT_FIELDS, STREAM_ROLE,
};
use serde_json::{json, Value};

const HEADER: &str = "participant_id,device_id,application_id,task_id,session_id,source_sequence_id,source_stream_role,source_row_id,clock_id,time_unit,time_precision,touch_timestamp";

fn raw(rows: &[String]) -> String {
    format!("{HEADER}\n{}\n", rows.join("\n"))
}

fn row(id: &str, clock: &str, unit: &str, precision: &str, time: &str) -> String {
    format!("A,d,app,natural,s,q,{STREAM_ROLE},{id},{clock},{unit},{precision},{time}")
}

fn output(input: &str) -> Vec<csv::StringRecord> {
    let prepared = execute_affectpro_touch_csv(input.as_bytes()).unwrap();
    let mut reader = csv::Reader::from_reader(prepared.csv_bytes.as_slice());
    assert_eq!(
        reader
            .headers()
            .unwrap()
            .iter()
            .skip(12)
            .collect::<Vec<_>>(),
        OUTPUT_FIELDS
    );
    reader.records().collect::<Result<Vec<_>, _>>().unwrap()
}

#[test]
fn independent_source_formula_fixture_keeps_lexical_scopes_order_and_duplicate_occurrences() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/affectpro_touch_hand_oracle.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input = case["rawCsv"].as_str().unwrap().as_bytes();
        let prepared = execute_affectpro_touch_csv(input).unwrap();
        let mut before = csv::Reader::from_reader(input);
        let original_headers = before.headers().unwrap().clone();
        let original = before.records().collect::<Result<Vec<_>, _>>().unwrap();
        let mut after = csv::Reader::from_reader(prepared.csv_bytes.as_slice());
        let mut expected_headers = original_headers.clone();
        expected_headers.extend(OUTPUT_FIELDS);
        assert_eq!(after.headers().unwrap(), &expected_headers);
        let actual = after.records().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(prepared.row_count, original.len());
        assert_eq!(actual.len(), original.len());
        for ((before, after), expected) in original
            .iter()
            .zip(&actual)
            .zip(case["expectedAppendedRows"].as_array().unwrap())
        {
            assert_eq!(
                after
                    .iter()
                    .take(original_headers.len())
                    .collect::<Vec<_>>(),
                before.iter().collect::<Vec<_>>()
            );
            assert_eq!(
                after
                    .iter()
                    .skip(original_headers.len())
                    .collect::<Vec<_>>(),
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s.as_str().unwrap())
                    .collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn declared_units_precision_and_signed_order_are_not_clock_repair_or_idle_session_rules() {
    for unit in ["ns", "us", "ms", "s"] {
        let values = output(&raw(&[
            row("a", "clock", unit, "7", "-101"),
            row("b", "clock", unit, "11", "-101"),
            row("c", "clock", unit, "13", "6200"),
            row("d", "clock", unit, "17", "6000"),
        ]));
        assert_eq!(&values[0][13], "4");
        assert_eq!(&values[0][14], "6101");
        assert_eq!(&values[0][16], unit);
        assert_eq!(&values[0][19], "0");
        assert_eq!(&values[1][19], "6301");
        assert_eq!(&values[2][19], "-200");
        assert_eq!(&values[3][20], "not_applicable:sequence_end");
    }
}

#[test]
fn independent_counts_survive_unavailable_timing_and_missing_middle_touch() {
    for (clock, unit, precision, timestamp, reason) in [
        ("", "ms", "1", "2", "missing_clock_id"),
        ("different", "ms", "1", "2", "incompatible_clock_ids"),
        ("c", "ticks", "1", "2", "missing_or_unsupported_time_unit"),
        ("c", "s", "1", "2", "incompatible_time_units"),
        ("c", "ms", "", "2", "missing_or_invalid_precision_metadata"),
        ("c", "ms", "0", "2", "missing_or_invalid_precision_metadata"),
        ("c", "ms", "1", "", "missing_or_noninteger_touch_timestamp"),
        (
            "c",
            "ms",
            "1",
            "oops",
            "missing_or_noninteger_touch_timestamp",
        ),
        (
            "c",
            "ms",
            "1",
            "9223372036854775808",
            "missing_or_noninteger_touch_timestamp",
        ),
    ] {
        let values = output(&raw(&[
            row("a", "c", "ms", "1", "0"),
            row("b", clock, unit, precision, timestamp),
        ]));
        assert_eq!(&values[0][13], "2");
        assert_eq!(&values[0][14], "");
        assert_eq!(&values[0][15], format!("unavailable:{reason}"));
        assert_eq!(&values[0][19], "");
        assert_eq!(&values[0][20], format!("unavailable:{reason}"));
    }
    let values = output(&raw(&[
        row("a", "c", "s", "1", "0"),
        row("b", "c", "s", "1", ""),
        row("c", "c", "s", "1", "20"),
    ]));
    assert_eq!(&values[0][13], "3");
    assert_eq!(&values[0][14], "20");
    assert_eq!(&values[0][19], "");
    assert_eq!(&values[1][19], "");
}

#[test]
fn every_lexical_owner_is_preserved_not_trimmed_or_merged() {
    let first = row("a", "c", "ms", "1", "0");
    for owner in 0..6 {
        let mut second = row("b", "c", "ms", "1", "1")
            .split(',')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        second[owner].push(' ');
        let values = output(&raw(&[first.clone(), second.join(",")]));
        assert_eq!(&values[0][13], "1");
        assert_eq!(&values[1][13], "1");
        assert_eq!(&values[1][owner], second[owner]);
        assert_eq!(
            &values[0][15],
            "unavailable:single_touch_source_behavior_undisclosed"
        );
    }
    let wrong = first.replace(STREAM_ROLE, "ordinary_usage_events");
    assert!(execute_affectpro_touch_csv(raw(&[wrong]).as_bytes()).is_err());
    let missing = HEADER.replace(",source_sequence_id", "");
    assert!(execute_affectpro_touch_csv(format!("{missing}\n").as_bytes()).is_err());
}

#[test]
fn full_signed_domain_duplicates_and_empty_transport_do_not_invent_source_policies() {
    let values = output(&raw(&[
        row("a", "c", "ns", "3", "9223372036854775807"),
        row("b", "c", "ns", "7", "-9223372036854775808"),
    ]));
    assert_eq!(&values[0][14], "-18446744073709551615");
    assert_eq!(&values[0][19], "-18446744073709551615");
    let repeated = row("a", "c", "ms", "3", "1");
    let values = output(&raw(&[repeated.clone(), repeated]));
    assert_eq!(&values[0][13], "2");
    assert_eq!(&values[0][14], "0");
    assert_eq!(&values[0][17], "a");
    assert_eq!(&values[0][18], "2");
    let prepared = execute_affectpro_touch_csv(format!("{HEADER}\n").as_bytes()).unwrap();
    assert_eq!(prepared.row_count, 0);
    assert!(
        execute_affectpro_touch_csv(format!("{HEADER},session_touch_count\n").as_bytes()).is_err()
    );
    assert!(execute_affectpro_touch_csv(format!("{HEADER},participant_id\n").as_bytes()).is_err());
}

#[test]
fn ordinary_public_component_computes_three_source_atoms_and_bound_artifacts() {
    use chronicle_preprocessing_runtime_wasm::{
        execute_literature_component_native, LiteratureComponentExecutionReceipt,
        LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest,
        RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND,
        RUNTIME_PROTOCOL_VERSION,
    };
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    let digest = |bytes: &[u8]| format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/affectpro_touch_hand_oracle.json")).unwrap();
    let raw = fixture["cases"][0]["rawCsv"].as_str().unwrap().as_bytes();
    let component = "chronicle.affectpro-ordered-touch-features/v1";
    let request = RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(), request_id: "affectpro-hand-case".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(), workspace_root_digest: None,
        workspace_id: digest(b"affectpro-hand-workspace"), input_file_name: "supplied-touches.csv".into(),
        input_sha256: digest(raw), known_review_summary_digests: None, participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(), method_profile_receipt: None, method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"AffectPro supplied arithmetic", "timezone":"UTC", "usage_session_mode":"app_usage",
            "include_app_output":true, "include_screen_output":false, "use_filter_file":false,
            "use_apps_forcing_screen_open":false, "use_app_codebook":false,
            "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
            "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
            "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
            "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
            "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
            "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
            "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
            "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC",
            "minimum_usage_duration":0.0
        })).unwrap(),
    };
    let mut handle = execute_literature_component_native(
        component,
        &serde_json::to_string(&request).unwrap(),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest.input_digest, digest(raw));
    assert_eq!(
        (manifest.source_row_count, manifest.derived_result_row_count),
        (6, 6)
    );
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    let adaptation: Value =
        serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
    assert_eq!(method.source_work_id, "doi:10.1145/3536221.3556603");
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.setting_ids.len(), 3);
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.original_input_digest, digest(raw));
    let bytes = &artifacts["literature-affectpro-ordered-touch-features-csv"];
    assert_eq!(bytes, &execute_affectpro_touch_csv(raw).unwrap().csv_bytes);
    assert_eq!(execution.derived_result_digest, digest(bytes));
    assert_eq!(adaptation["originalInputDigest"], digest(raw));
    assert_eq!(adaptation["derivedResult"]["digest"], digest(bytes));
    assert_eq!(adaptation["sourceRowCount"], 6);
    assert_eq!(adaptation["emittedRowCount"], 6);
}
