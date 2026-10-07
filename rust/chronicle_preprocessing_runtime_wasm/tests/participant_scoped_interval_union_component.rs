use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const COMPONENT_ID: &str = "chronicle.participant-scoped-interval-union/v1";
const ORACLE_ID: &str = "participant-scoped-interval-union-valr-0.8.1/sha256:e59bbcd26204b8712eb1fd56086ba7250532fb130399cf235ad6613381fd6194";
const SOURCE: &[u8] = include_bytes!("fixtures/participant_scoped_interval_union_source.csv");
const EXPECTED: &[u8] = include_bytes!("fixtures/participant_scoped_interval_union_expected.csv");
const SOURCE_FIDELITY: &[u8] =
    include_bytes!("fixtures/participant_scoped_interval_union_source_fidelity.csv");
const SOURCE_FIDELITY_EXPECTED: &[u8] =
    include_bytes!("fixtures/participant_scoped_interval_union_source_fidelity_expected.csv");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Participant-scoped interval union component",
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
        request_id: "participant-scoped-interval-union-component".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"participant-scoped-interval-union-workspace"),
        input_file_name: "participant_scoped_intervals.csv".into(),
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

fn execute(
    raw: &[u8],
) -> (
    LiteratureComponentRuntimeManifest,
    LiteratureComponentMethodReceipt,
    LiteratureComponentExecutionReceipt,
    Vec<u8>,
) {
    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("component execution");
    let manifest = serde_json::from_str(&handle.manifest_json()).expect("component manifest");
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
    let method = serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
        .expect("method receipt");
    let receipt = serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
        .expect("execution receipt");
    let derived = payloads
        .remove("literature-participant-scoped-interval-union-csv")
        .expect("derived result");
    (manifest, method, receipt, derived)
}

#[test]
fn registered_component_matches_source_boundaries_and_fidelity_probes() {
    let (manifest, method, receipt, derived) = execute(SOURCE);
    assert_eq!(derived, EXPECTED);
    assert_eq!(manifest.source_row_count, 14);
    assert_eq!(manifest.derived_result_row_count, 12);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.setting_ids.len(), 5);
    assert_eq!(receipt.oracle_id, ORACLE_ID);
    assert_eq!(receipt.derived_result_digest, sha256(EXPECTED));
    assert!(!receipt.kernel_input_eligible);
    assert_eq!(receipt.canonical_kernel_input_digest, None);

    let (fidelity_manifest, _, fidelity_receipt, fidelity_derived) = execute(SOURCE_FIDELITY);
    assert_eq!(fidelity_derived, SOURCE_FIDELITY_EXPECTED);
    assert_eq!(fidelity_manifest.source_row_count, 7);
    assert_eq!(fidelity_manifest.derived_result_row_count, 9);
    assert_eq!(
        fidelity_receipt.derived_result_digest,
        sha256(SOURCE_FIDELITY_EXPECTED)
    );

    let invalid = b"participant_id,application_name,application_category,start_unix_seconds,end_unix_seconds,derived_duration_seconds\nP1,Other,Tools,1,2,0\n";
    let error = execute_literature_component_native(
        COMPONENT_ID,
        &request(invalid),
        invalid,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("non-positive derived duration must fail closed");
    assert!(error.contains("non-positive or missing derived duration"));
}
