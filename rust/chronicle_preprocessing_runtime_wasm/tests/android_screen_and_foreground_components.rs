use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};


fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Released notification payload cleaning",
        "timezone": "UTC",
        "usage_session_mode": "app_usage",
        "include_app_output": true,
        "include_screen_output": false,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_app_codebook": false,
        "correct_duplicate_event_timestamps": false,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0, 2.0],
        "long_usage_duration_thresholds": [1.0, 2.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-09-03 00:00:00 UTC",
        "minimum_usage_duration": 0.0
    }))
    .expect("valid component options")
}

fn request(raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "notification-payload-cleaning".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"notification-payload-cleaning-workspace"),
        input_file_name: "notification-rows.csv".into(),
        input_sha256: sha256(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: options(),
    })
    .expect("request JSON")
}

fn run(component: &str) {
    let contract: serde_json::Value = serde_json::from_str(include_str!("../../../web/schema/literature-input-adapter-contract.json")).unwrap();
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    let group = contract["groups"].as_array().unwrap().iter().find(|g| g["componentExecution"]["componentId"] == component).unwrap();
    let case = &fixtures["groups"].as_array().unwrap().iter().find(|g| g["adapterId"] == component).unwrap()["cases"][0];
    let csv = |value: &serde_json::Value| value.as_array().unwrap().iter().map(|line| line.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
    let raw = csv(&case["rawCsvLines"]);
    let mut supports = RuntimeSupportFiles::default();
    for (role, lines) in case["supportCsvLines"].as_object().unwrap() {
        supports.put_with_name(role, "source-configuration.csv", csv(lines).as_bytes()).unwrap();
    }
    let mut handle = execute_literature_component_native(component, &request(raw.as_bytes()), raw.as_bytes(), &supports).unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest["sourceRowCount"], case["expected"]["sourceRowCount"]);
    assert_eq!(manifest["derivedResultRowCount"], case["expected"]["emittedRowCount"]);
    let kind = group["componentExecution"]["derivedResultKind"].as_str().unwrap();
    let mut output = None;
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, sha256(&bytes));
        if metadata.kind == kind { output = Some(String::from_utf8(bytes).unwrap()); }
    }
    let output = output.unwrap();
    for text in case["expected"]["outputContains"].as_array().unwrap() { assert!(output.contains(text.as_str().unwrap()), "{output}"); }
    for text in case["expected"]["outputExcludes"].as_array().unwrap() { assert!(!output.contains(text.as_str().unwrap()), "{output}"); }
}

#[test]
fn normalized_short_off_runs_in_the_public_component_runner() {
    run("chronicle.on-bounded-short-off-bridge/v1");
}

#[test]
fn released_foreground_preparation_runs_with_explicit_support_parameters() {
    run("chronicle.ethica-foreground-interval-preparation/v1");
}
