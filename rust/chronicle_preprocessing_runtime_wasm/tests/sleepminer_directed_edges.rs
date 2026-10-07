// Static hand-oracle/public-route tests; not executed during dependency80102.
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}
fn raw(case: &Value) -> Vec<u8> {
    (case["raw_csv_lines"].as_array().unwrap().iter().map(|l|l.as_str().unwrap())
        .collect::<Vec<_>>().join("\n") + "\n").into_bytes()
}
fn run(bytes: &[u8]) -> Result<(Value, BTreeMap<String, Vec<u8>>), String> {
    let request = RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "sleepminer-sparse-edges".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(b"sleepminer-hand-input-only"),
        input_file_name: "qualified-directed-communication.csv".into(),
        input_sha256: digest(bytes),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"SleepMiner supplied sparse edge membership", "timezone":"UTC",
            "usage_session_mode":"app_usage", "include_app_output":true,
            "include_screen_output":false, "use_filter_file":false,
            "use_apps_forcing_screen_open":false, "use_app_codebook":false,
            "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
            "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
            "long_duration_threshold_ns":43_200_000_000_000_i64,
            "custom_app_engagement_duration":300.0,
            "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
            "same_app_stop_types":["Activity Paused","Activity Resumed"],
            "other_stop_types":["Activity Resumed","Device Shutdown"],
            "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
            "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
            "screen_keyguard_near_stop_seconds":2.0,
            "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
        })).unwrap(),
    };
    let mut handle = execute_literature_component_native(
        "chronicle.sleepminer-directed-edge-memberships/v1",
        &serde_json::to_string(&request).unwrap(), bytes, &RuntimeSupportFiles::default(),
    )?;
    let manifest = serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    Ok((manifest, artifacts))
}

#[test]
fn ordinary_sleepminer_public_memberships_match_hand_edges_after_normal_admission() {
    let hand: Value = serde_json::from_str(include_str!(
        "fixtures/sleepminer_directed_edges_hand_oracle.json")).unwrap();
    // Deliberately no compatibility/gate-error acceptance: prospective normal
    // ownership must be admitted before this unexecuted public test can pass.
    for case in hand["cases"].as_array().unwrap() {
        let result = run(&raw(case));
        if case["refuse"] == true {
            assert!(result.is_err(), "{}: accepted", case["name"]);
            continue;
        }
        let (manifest, artifacts) = result.unwrap();
        let output = &artifacts["literature-sleepminer-directed-edge-memberships-csv"];
        let mut reader = csv::Reader::from_reader(output.as_slice());
        let actual = reader.records().map(|r| {
            let r = r.unwrap();
            let channel = |index: usize| {
                let m: Value = serde_json::from_str(&r[index]).unwrap();
                if m.is_null() { Value::Null } else {
                    json!(m.as_array().unwrap().iter().map(|m|
                        m["source_record_id"].as_str().unwrap()).collect::<Vec<_>>())
                }
            };
            json!({"scope":r[0],"day":r[1],"from":r[2],"to":r[3],
                "calling":channel(4),"messaging":channel(5),
                "rows":serde_json::from_str::<Value>(&r[6]).unwrap()})
        }).collect::<Vec<_>>();
        assert_eq!(json!(actual), case["expected"], "{}", case["name"]);
        assert_eq!(manifest["sourceRowCount"], case["source_rows"]);
        assert_eq!(manifest["derivedResultRowCount"],
            case["expected"].as_array().unwrap().len());
        let method: Value = serde_json::from_slice(
            &artifacts["literature-component-method-receipt-json"]).unwrap();
        let execution: Value = serde_json::from_slice(
            &artifacts["literature-component-execution-receipt-json"]).unwrap();
        assert_eq!(method["settingIds"], json!(["method-setting-c0ea86b8bddbdc77419d499c"]));
        assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
        assert_eq!(execution["kernelInputEligible"], false);
        assert_eq!(execution["derivedResultDigest"], digest(output));
        assert_eq!(execution["oracleId"], format!(
            "sleepminer-sparse-directed-edge-hand-oracle-v1/{}",
            digest(include_bytes!("fixtures/sleepminer_directed_edges_hand_oracle.json"))));
    }
}
