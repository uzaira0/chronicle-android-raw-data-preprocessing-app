use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/supplied_network_interaction_rates_hand_oracle.json"
    ))
    .unwrap()
}
fn csv(lines: &Value) -> String {
    lines
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}
fn input(index: usize) -> String {
    csv(&fixture()["cases"][index]["raw_csv_lines"])
}
fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn run(component: &str, raw: &[u8]) -> (Value, BTreeMap<String, Vec<u8>>) {
    let request = RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(b"supplied-network-interaction-rates-hand-workspace"),
        input_file_name: "qualified-network-interaction-rows.csv".into(),
        input_sha256: digest(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"Source network/interaction hand calculations", "timezone":"UTC",
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
        }))
        .unwrap(),
    };
    let mut handle = execute_literature_component_native(
        component,
        &serde_json::to_string(&request).unwrap(),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let manifest = serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    (manifest, artifacts)
}

fn verify(index: usize, kind: &str) {
    let f = fixture();
    let component = f["cases"][index]["component"].as_str().unwrap();
    let (manifest, artifacts) = run(component, input(index).as_bytes());
    let expected = csv(&f["cases"][index]["expected_csv_lines"]);
    assert_eq!(artifacts[kind], expected.as_bytes());
    assert_eq!(
        manifest["sourceRowCount"],
        f["cases"][index]["raw_csv_lines"].as_array().unwrap().len() - 1
    );
    assert_eq!(
        manifest["derivedResultRowCount"],
        f["cases"][index]["expected_csv_lines"]
            .as_array()
            .unwrap()
            .len()
            - 1
    );
    let method: Value =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: Value =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    assert_eq!(method["settingIds"], json!([f["cases"][index]["setting"]]));
    assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
    assert_eq!(execution["kernelInputEligible"], false);
    assert_eq!(
        execution["derivedResultDigest"],
        digest(expected.as_bytes())
    );
    assert_eq!(
        execution["oracleId"],
        format!(
            "supplied-network-interaction-rates-hand-oracle-v1/{}",
            digest(include_bytes!(
                "fixtures/supplied_network_interaction_rates_hand_oracle.json"
            ))
        )
    );
    assert!(method["limitations"].as_array().unwrap().len() >= 3);
}
#[test]
fn registered_rtt_matches_independent_hand_oracle_and_receipts() {
    verify(0, "literature-supplied-last-syn-rtt-csv");
}
#[test]
fn registered_tap_rate_matches_independent_hand_oracle_and_receipts() {
    verify(1, "literature-supplied-app-session-tap-rate-csv");
}
