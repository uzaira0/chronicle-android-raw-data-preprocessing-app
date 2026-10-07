use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.questionnaire-screen-session-summary/v1";
const FIXTURE: &str = include_str!("fixtures/schoedel_questionnaire_screen_session_component.json");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Questionnaire screen-session summary component",
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
        request_id: "questionnaire-screen-session-summary-component".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"questionnaire-screen-session-summary-workspace"),
        input_file_name: "labeled_questionnaire_window_screen_state.csv".into(),
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

#[test]
fn public_component_executes_all_fifteen_exact_settings_with_receipt_visible_boundaries() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("source fixture JSON");
    let raw = fixture["rawCsv"].as_str().expect("raw CSV").as_bytes();
    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.source_row_count, 9);
    assert_eq!(manifest.derived_result_row_count, 1);

    let mut payloads = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact payload");
        assert_eq!(metadata.digest, sha256(&bytes));
        payloads.insert(metadata.kind, bytes);
    }
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    let expected_setting_ids = fixture["exactCanonicalSettingIds"]
        .as_array()
        .expect("exact setting IDs")
        .iter()
        .map(|value| value.as_str().expect("setting ID").to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        method.setting_ids.iter().cloned().collect::<BTreeSet<_>>(),
        expected_setting_ids
    );
    assert_eq!(method.setting_ids.len(), 15);
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(method.limitations, execution.limitations);
    assert_eq!(method.limitations.len(), 3);
    assert!(method.limitations.iter().any(|limitation| {
        limitation.contains("caller-supplied questionnaire membership")
            && limitation.contains("usage/nonusage IDs")
    }));
    assert!(method
        .limitations
        .iter()
        .any(|limitation| limitation.contains("broken-screen-logging exclusion")));

    let derived =
        std::str::from_utf8(&payloads["literature-questionnaire-screen-session-summary-csv"])
            .expect("derived UTF-8");
    assert_eq!(
        derived,
        fixture["expectedDerivedCsv"]
            .as_str()
            .expect("expected derived CSV")
    );
    let adaptation: Value =
        serde_json::from_slice(&payloads["literature-input-adaptation-receipt-json"])
            .expect("adaptation receipt");
    assert_eq!(adaptation["materializedIntervalCount"], 6);
    assert_eq!(adaptation["sourceRowCount"], 9);
    assert_eq!(adaptation["emittedRowCount"], 1);

    let fifteen_minute = std::str::from_utf8(raw)
        .expect("fixture UTF-8")
        .replace("33600000000000", "30900000000000")
        .into_bytes();
    let error = execute_literature_component_native(
        COMPONENT_ID,
        &request(&fifteen_minute),
        &fifteen_minute,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("the out-of-contract sensitivity window must fail closed");
    assert!(error.contains("unexpected duration"));
}
