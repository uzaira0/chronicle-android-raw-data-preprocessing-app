use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentRuntimeManifest,
    RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND,
    RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Ten setting literature components",
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
        request_id: format!("ten-setting-{}", component_id.replace(['.', '/'], "-")),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(format!("{component_id}-workspace").as_bytes()),
        input_file_name: format!("{}.csv", component_id.replace(['.', '/'], "-")),
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

fn public_execution(
    component_id: &str,
    raw: &[u8],
) -> (
    LiteratureComponentRuntimeManifest,
    BTreeMap<String, Vec<u8>>,
) {
    let mut handle = execute_literature_component_native(
        component_id,
        &request(component_id, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap_or_else(|error| panic!("{component_id}: {error}"));
    let manifest = serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    let mut payloads = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        assert_eq!(metadata.digest, sha256(&bytes));
        payloads.insert(metadata.kind, bytes);
    }
    (manifest, payloads)
}

fn adapter_error(component_id: &str, raw: &[u8]) -> String {
    let (_, bindings) = literature_component_execution_unit(component_id).expect("registration");
    match adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[]) {
        Err(error) => error,
        Ok(_) => panic!("expected fail-closed adapter error"),
    }
}

#[test]
fn ten_source_bounded_components_execute_through_the_public_runner() {
    let cases: [(&str, &[u8], u32, &str, &str); 10] = [
        ("chronicle.password-sample-completion-gate/v1", b"source_row_id,whole_password_typed_before_send\nincomplete,false\ncomplete,true\n", 2, "literature-source-bound-scalar-predicate-csv", "complete,1.0,retain_complete"),
        ("chronicle.activity-duration-gate/v1", b"source_row_id,duration_minutes\nequal,3\nabove,3.001\n", 2, "literature-source-bound-scalar-predicate-csv", "above,3.001,retained"),
        ("chronicle.music-duration-gate/v1", b"source_row_id,listened_duration_seconds\nequal,30\nabove,30.001\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,30.0,excluded"),
        ("chronicle.communication-similarity-gate/v1", b"source_row_id,similarity_percent\nequal,85\nabove,85.001\n", 2, "literature-source-bound-scalar-predicate-csv", "above,85.001,correct"),
        ("chronicle.location-stationary-speed-gate/v1", b"source_row_id,speed_kmh\nbelow,4.999\nequal,5\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,5.0,exclude_moving"),
        ("chronicle.excessive-daily-epoch-frequency-gate/v1", b"source_row_id,epochs_per_day\nequal,68.4\nabove,68.401\n", 2, "literature-source-bound-scalar-predicate-csv", "above,68.401,excessive"),
        ("chronicle.tolerance-m-trend-gate/v1", b"source_row_id,m_trend\nequal,0\nabove,0.001\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,0.0,not_tolerance"),
        ("chronicle.app-usage-participant-conjunction-gate/v1", b"source_row_id,app_use_count,distinct_participant_count\nuses_boundary,50,3\nboth_minimum,51,3\n", 2, "literature-source-bound-conjunctive-threshold-gate-csv", "both_minimum,51,3,retain_app"),
        ("chronicle.affect-followup-draw-gate/v1", b"source_row_id,draw_outcome\nselected,0\nmaximum,9\n", 2, "literature-source-bound-scalar-predicate-csv", "selected,0.0,show_free_text_followup"),
        ("chronicle.meaningfulness-followup-draw-gate/v1", b"source_row_id,draw_outcome\nequal,35\nabove,36\n", 2, "literature-source-bound-scalar-predicate-csv", "above,36.0,skip_free_text_followup"),
    ];

    for (component_id, raw, row_count, result_kind, expected) in cases {
        let (registration, bindings) =
            literature_component_execution_unit(component_id).expect("component registration");
        assert_eq!(bindings.len(), 1, "{component_id}");
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert!(!registration.limitations.is_empty());

        let (manifest, payloads) = public_execution(component_id, raw);
        assert_eq!(manifest.component_id, component_id);
        assert_eq!(manifest.source_row_count, row_count);
        assert_eq!(manifest.derived_result_row_count, row_count);
        let output = std::str::from_utf8(&payloads[result_kind]).expect("derived output UTF-8");
        assert!(output.contains(expected), "{component_id}: {output}");
    }
}

#[test]
fn new_source_boundaries_fail_closed_without_cross_component_inference() {
    assert!(adapter_error(
        "chronicle.password-sample-completion-gate/v1",
        b"source_row_id,whole_password_typed_before_send\nrow,1\n",
    )
    .contains("violates input domain boolean"));
    assert!(adapter_error(
        "chronicle.activity-duration-gate/v1",
        b"source_row_id,duration_minutes\nrow,-0.1\n",
    )
    .contains("violates input domain finite_nonnegative"));
    assert!(adapter_error(
        "chronicle.communication-similarity-gate/v1",
        b"source_row_id,similarity_percent\nrow,100.1\n",
    )
    .contains("violates inclusive source domain"));
    assert!(adapter_error(
        "chronicle.app-usage-participant-conjunction-gate/v1",
        b"source_row_id,app_use_count,distinct_participant_count\nrow,51.5,3\n",
    )
    .contains("violates input domain unsigned_integer"));
    assert!(adapter_error(
        "chronicle.affect-followup-draw-gate/v1",
        b"source_row_id,draw_outcome\nrow,10\n",
    )
    .contains("violates inclusive source domain"));
    assert!(adapter_error(
        "chronicle.meaningfulness-followup-draw-gate/v1",
        b"source_row_id,draw_outcome\nrow,100\n",
    )
    .contains("violates inclusive source domain"));
}
