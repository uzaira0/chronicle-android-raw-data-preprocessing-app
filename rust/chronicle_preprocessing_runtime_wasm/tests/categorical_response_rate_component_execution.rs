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

const COMPONENT_ID: &str = "chronicle.categorical-response-rate/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Categorical response rate",
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
        request_id: "categorical-response-rate".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"categorical-response-rate-workspace"),
        input_file_name: "selected-response-labels.csv".into(),
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
fn one_component_executes_three_distinct_selected_label_outputs() {
    let raw = concat!(
        "source_row_id,label,response_to_user_label,response_of_user_label\n",
        "1,responded,responded,responded\n",
        "2,no-response,other,no-response\n",
        "3,responded,NA,other\n",
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
    assert_eq!(manifest["sourceRowCount"], 3);
    assert_eq!(manifest["derivedResultRowCount"], 1);

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
        if metadata.kind == "literature-categorical-response-rate-csv" {
            output = Some(String::from_utf8(bytes).expect("UTF-8 output"));
        }
    }
    assert_eq!(
        output.expect("derived output"),
        concat!(
            "response_rate,Stachl_responserate_calls_others,",
            "Stachl_responserate_calls_user\n",
            "0.6666666666666666,1,0.5\n",
        )
    );
}

#[test]
fn configured_call_direction_columns_are_not_pooled_or_substituted() {
    let raw = b"source_row_id,response_of_user_label\n1,responded\n";
    let (_, bindings) = literature_component_execution_unit(COMPONENT_ID).expect("registration");
    let calls_others = bindings
        .into_iter()
        .filter(|binding| binding.setting_id == "method-setting-5facd691213333bd0e7a5c8d")
        .collect::<Vec<_>>();
    let error = match adapt_literature_inputs(raw, &sha256(raw), &calls_others, |_| &[]) {
        Err(error) => error,
        Ok(_) => panic!("the calls-others feature must not consume the calls-user label column"),
    };
    assert!(error.contains("missing the label column response_to_user_label"));
}
