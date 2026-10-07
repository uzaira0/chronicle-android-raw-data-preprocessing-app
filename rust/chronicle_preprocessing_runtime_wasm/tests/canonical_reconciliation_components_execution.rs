use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentRuntimeManifest, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Canonical source component reconciliation",
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

fn request(component_id: &str, raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component_id.replace(['.', '/'], "-"),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(format!("{component_id}-workspace").as_bytes()),
        input_file_name: "source-boundary.csv".into(),
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
fn grouped_sum_and_positive_missingness_execute_through_public_authority() {
    let grouped_component = "chronicle.grouped-scalar-sum-projection/v1";
    let grouped_raw = concat!(
        "source_row_id,ID,raw_time,projected_date,sample,app_seconds\n",
        "1,P1,t1,2026-01-01,lab,30\n",
        "2,P1,t1,2026-01-01,lab,30\n",
    )
    .as_bytes();
    let grouped_handle = execute_literature_component_native(
        grouped_component,
        &request(grouped_component, grouped_raw),
        grouped_raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("grouped sum component execution");
    let grouped_manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&grouped_handle.manifest_json()).expect("grouped manifest");
    assert_eq!(grouped_manifest.source_row_count, 2);
    assert_eq!(grouped_manifest.derived_result_row_count, 1);

    let positive_component = "chronicle.analysis-positive-feature-missingness/v1";
    let raw = b"participant_id,event_timestamp,interaction_type\nP1,2026-01-01 00:00:00,Activity Resumed\n";
    let matrix = concat!(
        "participant_id,feature_id,value,missing_state,feature_set_id\n",
        "P1,phone_usage::week_01,,missing,setA\n",
        "P1,g1,1,observed,setA\n",
        "P1,g2,2,observed,setA\n",
        "P1,g3,3,observed,setA\n",
        "P1,g4,4,observed,setA\n",
        "P1,g5,5,observed,setA\n",
    )
    .as_bytes();
    let mut support = RuntimeSupportFiles::default();
    support
        .put_with_name("analysis_feature_matrix_file", "feature_matrix.csv", matrix)
        .expect("feature matrix support");
    let positive_handle = execute_literature_component_native(
        positive_component,
        &request(positive_component, raw),
        raw,
        &support,
    )
    .expect("positive missingness component execution");
    let positive_manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&positive_handle.manifest_json()).expect("positive manifest");
    assert_eq!(positive_manifest.source_row_count, 1);
    assert_eq!(positive_manifest.derived_result_row_count, 6);
}
