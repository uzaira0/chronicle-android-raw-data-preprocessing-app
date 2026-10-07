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
        "study_name": "Nineteen setting literature components",
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
        request_id: format!("nineteen-setting-{}", component_id.replace(['.', '/'], "-")),
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
    .expect("canonical component execution");
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
fn seventeen_components_execute_all_nineteen_settings_through_the_public_runner() {
    type ComponentCase = (
        &'static str,
        &'static [u8],
        usize,
        u32,
        u32,
        &'static str,
        &'static str,
    );
    let cases: [ComponentCase; 17] = [
        (
            "chronicle.distance-matrix-medoid/v1",
            b"point_id,distance_0,distance_1,distance_2\nA,0,1,2\nB,100,0,2\nC,1,100,0\n",
            1,
            3,
            1,
            "literature-distance-matrix-medoid-csv",
            "2,C",
        ),
        (
            "chronicle.named-count-ratios/v1",
            b"source_row_id,outgoing,incoming,missed,sms_sent,sms_received\nwindow,6,3,1,4,8\n",
            1,
            1,
            3,
            "literature-named-count-ratios-csv",
            "missed_to_outgoing_plus_incoming_calls,1,9,0.1111111111111111",
        ),
        (
            "chronicle.accelerometer-magnitude-count-gate/v1",
            b"source_row_id,magnitude_count\nlow,199\nequal,200\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,200.0,included",
        ),
        (
            "chronicle.integer-rssi-zero-filter/v1",
            b"source_row_id,rssi\nlow,-1\nequal,0\nhigh,1\n",
            1,
            3,
            3,
            "literature-source-bound-scalar-predicate-csv",
            "equal,0.0,retain",
        ),
        (
            "chronicle.location-accuracy-radius-filter/v1",
            b"source_row_id,error_radius_meters\nlow,99.999\nequal,100\nhigh,100.001\n",
            1,
            3,
            3,
            "literature-source-bound-scalar-predicate-csv",
            "equal,100.0,retain",
        ),
        (
            "chronicle.place-distance-gate/v1",
            b"source_row_id,distance_meters\nlow,49.999\nequal,50\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,50.0,does_not_satisfy_place_distance_relation",
        ),
        (
            "chronicle.state-response-count-gate/v1",
            b"source_row_id,state_response_count\nlow,9\nequal,10\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,10.0,retain",
        ),
        (
            "chronicle.consecutive-dwell-gate/v1",
            b"source_row_id,consecutive_dwell_minutes\nequal,15\nhigh,15.001\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,15.0,exclude_place",
        ),
        (
            "chronicle.esm-response-count-gate/v1",
            b"source_row_id,esm_response_count\nzero,0\nequal,1\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,1.0,retain",
        ),
        (
            "chronicle.nonnegative-rssi-filter/v1",
            b"source_row_id,rssi\nlow,-0.5\nequal,0\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "low,-0.5,exclude",
        ),
        (
            "chronicle.full-day-count-gate/v1",
            b"source_row_id,full_day_count\nlow,29\nequal,30\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,30.0,retain",
        ),
        (
            "chronicle.three-g-signal-quality-gate/v1",
            b"source_row_id,rssi_dbm\nlow,-91.7001\nequal,-91.7\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,-91.7,good",
        ),
        (
            "chronicle.valid-activity-day-count-gate/v1",
            b"source_row_id,valid_activity_day_count\nlow,3\nequal,4\n",
            2,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "low,3.0,exclude_participant",
        ),
        (
            "chronicle.emotion-label-count-gate/v1",
            b"source_row_id,emotion_label_count\nlow,39\nequal,40\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,40.0,retain",
        ),
        (
            "chronicle.valid-activity-wear-hours-gate/v1",
            b"source_row_id,valid_activity_wear_hours\nlow,19.999\nequal,20\n",
            2,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "low,19.999,exclude_day",
        ),
        (
            "chronicle.session-touch-count-gate/v1",
            b"source_row_id,touch_interaction_count\nlow,79\nequal,80\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,80.0,retain",
        ),
        (
            "chronicle.country-accepted-user-count-gate/v1",
            b"source_row_id,accepted_user_count\nlow,19999\nequal,20000\n",
            1,
            2,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,20000.0,include_country",
        ),
    ];

    for (component_id, raw, setting_count, source_rows, result_rows, result_kind, expected) in cases
    {
        let (registration, bindings) =
            literature_component_execution_unit(component_id).expect("component registration");
        assert_eq!(bindings.len(), setting_count, "{component_id}");
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert!(!registration.limitations.is_empty());

        let (manifest, payloads) = public_execution(component_id, raw);
        assert_eq!(manifest.component_id, component_id);
        assert_eq!(manifest.source_row_count, source_rows);
        assert_eq!(manifest.derived_result_row_count, result_rows);
        let output = std::str::from_utf8(&payloads[result_kind]).expect("derived output UTF-8");
        assert!(output.contains(expected), "{component_id}: {output}");
    }
}

#[test]
fn new_components_fail_closed_on_unproven_or_malformed_input_boundaries() {
    let nonfinite_matrix = adapter_error(
        "chronicle.distance-matrix-medoid/v1",
        b"point_id,distance_0\nA,NaN\n",
    );
    assert!(nonfinite_matrix.contains("must be finite"));

    let zero_denominator = adapter_error(
        "chronicle.named-count-ratios/v1",
        b"source_row_id,outgoing,incoming,missed,sms_sent,sms_received\nwindow,1,0,0,1,0\n",
    );
    assert!(zero_denominator.contains("denominator is zero"));

    let fractional_integer = adapter_error(
        "chronicle.integer-rssi-zero-filter/v1",
        b"source_row_id,rssi\nrow,0.5\n",
    );
    assert!(fractional_integer.contains("violates input domain integer"));

    let negative_radius = adapter_error(
        "chronicle.location-accuracy-radius-filter/v1",
        b"source_row_id,error_radius_meters\nrow,-1\n",
    );
    assert!(negative_radius.contains("violates input domain finite_nonnegative"));

    let fractional_count = adapter_error(
        "chronicle.state-response-count-gate/v1",
        b"source_row_id,state_response_count\nrow,9.5\n",
    );
    assert!(fractional_count.contains("violates input domain unsigned_integer"));
}
