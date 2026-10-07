use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.fixed-minute-packet-aggregation/v1";
const SOURCE_WORK_ID: &str = "doi:10.1016/j.smhl.2020.100137";
const ORACLE_ID: &str = "fixed-minute-packet-aggregation-bounded-source-fixture-v1/sha256:7a13765f55bd8e4c9f659fdb9938e57285f0bd572972ee9a5126549210b15eaf";
const SOURCE: &[u8] = include_bytes!("fixtures/doi-10.1016-j.smhl.2020.100137-packets.csv.fixture");
const EXPECTED: &[u8] =
    include_bytes!("fixtures/doi-10.1016-j.smhl.2020.100137-minute-aggregates.csv.fixture");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Bounded fixed-minute packet aggregation component",
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

fn request() -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "fixed-minute-packet-component".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"fixed-minute-packet-component-workspace"),
        input_file_name: "doi-10.1016-j.smhl.2020.100137-packets.csv".into(),
        input_sha256: sha256(SOURCE),
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
fn component_executes_only_four_registered_settings_with_fixture_anchor_limitation() {
    let (registration, _) = literature_component_execution_unit(COMPONENT_ID)
        .expect("registered packet aggregation component");
    let expected_setting_ids = BTreeSet::from([
        "method-setting-849657e506f990a559cfcb19",
        "method-setting-1217e00122d8bcc5eeb19363",
        "method-setting-f1d211a95b06d1e27ad2b262",
        "method-setting-3513fbb713d41b14c017dc68",
    ]);
    assert_eq!(
        registration
            .required_support_roles
            .iter()
            .collect::<BTreeSet<_>>(),
        BTreeSet::new()
    );
    assert_eq!(registration.source_work_id, SOURCE_WORK_ID);
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(registration.limitations.len(), 1);
    assert!(registration.limitations[0].contains("fixture timestamp-ns anchor 0"));

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(),
        SOURCE,
        &RuntimeSupportFiles::default(),
    )
    .expect("bounded packet component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.component_id, COMPONENT_ID);
    assert_eq!(manifest.source_row_count, 4);
    assert_eq!(manifest.derived_result_row_count, 3);

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
    assert_eq!(
        payloads["literature-fixed-minute-packet-aggregation-csv"],
        EXPECTED
    );

    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    assert_eq!(
        method
            .setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        expected_setting_ids
    );
    assert_eq!(method.limitations, registration.limitations);
    assert_eq!(execution.limitations, method.limitations);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(execution.oracle_id, ORACLE_ID);
    assert_eq!(execution.derived_result_digest, sha256(EXPECTED));
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.canonical_kernel_input_digest, None);
}
