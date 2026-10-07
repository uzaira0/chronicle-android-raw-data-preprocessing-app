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
        "study_name": "Sixteen setting literature components",
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
        request_id: format!("sixteen-setting-{}", component_id.replace(['.', '/'], "-")),
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
fn sixteen_source_bounded_components_execute_through_the_public_runner() {
    let cases: [(&str, &[u8], u32, &str, &str); 16] = [
        ("chronicle.app-space-membership-count-gate/v1", b"source_row_id,use_count,window_weeks\nbelow,1,20\nequal,2,20\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,2.0,inside_app_space"),
        ("chronicle.global-prompt-gap-gate/v1", b"source_row_id,global_prompt_gap_minutes\nbelow,14.999\nequal,15\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,15.0,permit_candidate"),
        ("chronicle.micro-session-duration-gate/v1", b"source_row_id,session_duration_seconds\nequal,15\nabove,16\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,15.0,micro"),
        ("chronicle.study-area-dwell-gate/v1", b"source_row_id,study_area_dwell_minutes\nbelow,19.999\nequal,20\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,20.0,study_period"),
        ("chronicle.questionnaire-completion-duration-gate/v1", b"source_row_id,completion_duration_minutes\nequal,15\nabove,15.001\n", 2, "literature-source-bound-scalar-predicate-csv", "above,15.001,exclude"),
        ("chronicle.engage-session-duration-gate/v1", b"source_row_id,session_duration_seconds\nequal,60\nabove,61\n", 2, "literature-source-bound-scalar-predicate-csv", "above,61.0,engage"),
        ("chronicle.party-location-dwell-gate/v1", b"source_row_id,party_location_dwell_minutes\nbelow,29.999\nequal,30\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,30.0,retained_dwell"),
        ("chronicle.answer-gap-gate/v1", b"source_row_id,answer_gap_minutes\nbelow,29.999\nequal,30\n", 2, "literature-source-bound-scalar-predicate-csv", "below,29.999,remove"),
        ("chronicle.answer-character-count-gate/v1", b"source_row_id,answer_character_count\nbelow,249\nequal,250\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,250.0,meets_requirement"),
        ("chronicle.building-circle-membership-gate/v1", b"source_row_id,center_distance,circle_radius\ninside,99.999,100\nboundary,100,100\n", 2, "literature-source-bound-scalar-predicate-csv", "boundary,100.0,not_inside"),
        ("chronicle.attendance-evidence-availability-gate/v1", b"source_row_id,wifi_permits_attendance_check,gps_permits_attendance_check\nneither,false,false\ngps,false,true\n", 2, "literature-source-bound-conjunctive-threshold-gate-csv", "gps,0,1,retain_for_attendance_check"),
        ("chronicle.daily-stress-label-gate/v1", b"source_row_id,daily_stress_score\nequal,4\nabove,5\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,4.0,0_not_stressed"),
        ("chronicle.esm-lag-gap-gate/v1", b"source_row_id,precomputed_lag_gap_minutes\nbelow,59.999\nequal,60\n", 2, "literature-source-bound-scalar-predicate-csv", "below,59.999,exclude_later_row"),
        ("chronicle.active-minute-cadence-gate/v1", b"source_row_id,cadence_steps_per_minute\nbelow,99.999\nequal,100\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,100.0,mvpa"),
        ("chronicle.app-participant-support-gate/v1", b"source_row_id,participant_support_count,participant_count\nbelow,16,84\nequal,17,84\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,17.0,retained_candidate"),
        ("chronicle.wifi-signal-quality-gate/v1", b"source_row_id,wifi_rssi_dbm\nequal,-80\nabove,-79.9\n", 2, "literature-source-bound-scalar-predicate-csv", "equal,-80.0,poor"),
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
fn generic_extensions_fail_closed_at_each_new_input_boundary() {
    assert!(adapter_error(
        "chronicle.app-space-membership-count-gate/v1",
        b"source_row_id,use_count,window_weeks\nrow,2,19\n",
    )
    .contains("must equal configured source context"));
    assert!(adapter_error(
        "chronicle.app-participant-support-gate/v1",
        b"source_row_id,participant_support_count,participant_count\nrow,85,84\n",
    )
    .contains("violates inclusive source domain"));
    assert!(adapter_error(
        "chronicle.building-circle-membership-gate/v1",
        b"source_row_id,center_distance,circle_radius\nrow,50,NaN\n",
    )
    .contains("violates input domain finite"));
    assert!(adapter_error(
        "chronicle.attendance-evidence-availability-gate/v1",
        b"source_row_id,wifi_permits_attendance_check,gps_permits_attendance_check\nrow,1,false\n",
    )
    .contains("violates input domain boolean"));
    assert!(adapter_error(
        "chronicle.daily-stress-label-gate/v1",
        b"source_row_id,daily_stress_score\nrow,7.1\n",
    )
    .contains("violates inclusive source domain"));
}
