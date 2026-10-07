use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};

const COMPONENT_ID: &str = "chronicle.app-relationship-matrices/v1";
const SETTING_IDS: [&str; 4] = [
    "method-setting-d3bd32f112391895ef6bdd9c",
    "method-setting-dabbaa005b4daa28761c6157",
    "method-setting-fafabfbec817bb6c43686677",
    "method-setting-dccbc00c3974d0fa0816f5cf",
];

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "App relationship matrices",
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
    .unwrap()
}

fn raw(policy: &str) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "source_row_id",
            "entity_id",
            "app_id",
            "hour_scope_id",
            "day_scope_id",
            "matrix_policy_json",
        ])
        .unwrap();
    for row in [
        ["1", "device-1", "A", "d1h1", "d1"],
        ["2", "device-1", "B", "d1h1", "d1"],
        ["3", "device-1", "A", "d1h2", "d1"],
        ["4", "device-1", "C", "d1h2", "d1"],
        ["5", "device-1", "B", "d2h1", "d2"],
    ] {
        writer
            .write_record([row[0], row[1], row[2], row[3], row[4], policy])
            .unwrap();
    }
    writer.into_inner().unwrap()
}

fn request(raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "app-relationship-matrices".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"app-relationship-matrices-workspace"),
        input_file_name: "ordered-app-launches.csv".into(),
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
    .unwrap()
}

#[test]
fn app_relationship_matrices_execute_and_keep_undisclosed_policies_blocked() {
    let valid_policy = serde_json::to_string(&json!({
        "transitionDiagonalPolicy": "exclude",
        "transitionProbabilityNormalization": "row_total",
        "sameHour": {
            "pairOrientation": "symmetric",
            "multiplicity": "distinct_apps_per_scope",
            "diagonalPolicy": "exclude",
            "probabilityNormalization": "row_total"
        },
        "sameDay": {
            "pairOrientation": "source_ordered",
            "multiplicity": "all_launch_pairs",
            "diagonalPolicy": "include",
            "probabilityNormalization": "all_occurrences"
        }
    }))
    .unwrap();
    let raw_bytes = raw(&valid_policy);
    let (registration, bindings) = literature_component_execution_unit(COMPONENT_ID).unwrap();
    assert_eq!(
        bindings
            .iter()
            .map(|binding| binding.setting_id.as_str())
            .collect::<Vec<_>>(),
        SETTING_IDS
    );
    assert_eq!(registration.full_profile_execution_status, "blocked");

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(&raw_bytes),
        &raw_bytes,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let mut output = String::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        if metadata.kind == "literature-app-relationship-matrices-csv" {
            output = String::from_utf8(bytes).unwrap();
        }
    }
    assert!(output.contains("matrix_cell,device-1,consecutive_transition,A,B,1,0.5"));
    assert!(output.contains("matrix_cell,device-1,same_hour,B,A,1,1"));
    assert!(output.contains("matrix_cell,device-1,same_day,A,A,1,0.16666666666666666"));
    assert!(output.contains("maximum_transition,device-1,consecutive_transition,A,,,0.5"));

    let undisclosed = valid_policy.replace("\"symmetric\"", "\"undisclosed\"");
    let blocked = raw(&undisclosed);
    let error = match execute_literature_component_native(
        COMPONENT_ID,
        &request(&blocked),
        &blocked,
        &RuntimeSupportFiles::default(),
    ) {
        Err(error) => error,
        Ok(_) => panic!("undisclosed matrix policy must fail closed"),
    };
    assert!(error.contains("undisclosed"));
}
