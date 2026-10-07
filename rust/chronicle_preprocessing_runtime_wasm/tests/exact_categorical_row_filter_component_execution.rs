use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};

const COMPONENT_ID: &str = "chronicle.exact-categorical-row-filter/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Exact categorical row filter",
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
        request_id: "exact-categorical-row-filter".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"exact-categorical-row-filter-workspace"),
        input_file_name: "categorical-rows.csv".into(),
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

fn adapter_error(raw: &[u8]) -> String {
    let (_, bindings) = literature_component_execution_unit(COMPONENT_ID).expect("registration");
    match adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[]) {
        Err(error) => error,
        Ok(_) => panic!("expected fail-closed adapter error"),
    }
}

#[test]
fn exact_categorical_rows_execute_through_the_public_runner() {
    let raw = concat!(
        "source_row_id,aggregation_type,app_name,opaque_payload\n",
        "ordinary,APP_USAGE,Ordinary App,first\n",
        "youtube-vanced,APP_USAGE,YouTube Vanced,drop\n",
        "basic-daydreams,APP_USAGE,Basic Daydreams,drop\n",
        "other-aggregation,SCREEN_TOTAL,Ordinary App,drop\n",
        "case-variant,APP_USAGE,youtube vanced,second\n",
        "space-variant,APP_USAGE,Basic Daydreams ,third\n",
        "missing-aggregation,,Ordinary App,drop\n",
        "missing-app,APP_USAGE,,drop\n",
        "ordinary-duplicate,APP_USAGE,Ordinary App,first\n",
    )
    .as_bytes();
    let (registration, bindings) =
        literature_component_execution_unit(COMPONENT_ID).expect("component registration");
    assert_eq!(bindings.len(), 3);
    assert_eq!(registration.full_profile_execution_status, "blocked");

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("public component execution");
    let manifest: serde_json::Value =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest["sourceRowCount"], 9);
    assert_eq!(manifest["derivedResultRowCount"], 4);

    let mut output = None;
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        assert_eq!(metadata.digest, sha256(&bytes));
        if metadata.kind == "literature-exact-categorical-row-filter-csv" {
            output = Some(String::from_utf8(bytes).expect("UTF-8 output"));
        }
    }
    assert_eq!(
        output.expect("derived output"),
        concat!(
            "source_row_id,aggregation_type,app_name,opaque_payload\n",
            "ordinary,APP_USAGE,Ordinary App,first\n",
            "case-variant,APP_USAGE,youtube vanced,second\n",
            "space-variant,APP_USAGE,Basic Daydreams ,third\n",
            "ordinary-duplicate,APP_USAGE,Ordinary App,first\n",
        )
    );
}

#[test]
fn exact_categorical_row_filter_requires_unique_configured_headers() {
    let missing = b"source_row_id,aggregation_type\nrow,APP_USAGE\n";
    assert!(adapter_error(missing).contains("requires raw column app_name"));

    let duplicate = b"source_row_id,aggregation_type,app_name,app_name\nrow,APP_USAGE,one,two\n";
    assert!(adapter_error(duplicate).contains("refuses duplicate column names"));
}
