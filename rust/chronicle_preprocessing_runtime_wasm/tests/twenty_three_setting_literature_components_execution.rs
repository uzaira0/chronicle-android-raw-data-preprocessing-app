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
        "study_name": "Twenty-three setting literature components",
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
        request_id: format!(
            "twenty-three-setting-{}",
            component_id.replace(['.', '/'], "-")
        ),
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
fn six_components_execute_all_twenty_three_settings_through_the_public_runner() {
    type ComponentCase = (
        &'static str,
        &'static [u8],
        usize,
        u32,
        u32,
        &'static str,
        &'static str,
    );
    let cases: [ComponentCase; 6] = [
        (
            "chronicle.call-state-summary/v1",
            b"source_row_id,state\n1,incoming\n2,outgoing\n3,missed\n4,other\n5,\n6,incoming\n",
            5,
            6,
            1,
            "literature-call-state-summary-csv",
            "2,1,6,1,0.6666666666666666",
        ),
        (
            "chronicle.call-duration-summary/v1",
            b"source_row_id,state,overlap\n1,incoming,3600000\n2,outgoing,7200000\n3,other,60000\n4,,60000\n",
            3,
            4,
            1,
            "literature-call-duration-summary-csv",
            "60,182,120",
        ),
        (
            "chronicle.grouped-category-count/v1",
            b"source_row_id,stream_id,participant_id,source_day_id,category\n1,screen,P01,D1,screen_on\n2,screen,P01,D1,screen_on\n3,screen,P01,D1,screen_off\n4,internet,P01,D1,connected\n5,internet,P01,D1,disconnected\n6,foreground_app_use,P01,D1,foreground_app_use\n",
            5,
            6,
            5,
            "literature-grouped-category-count-csv",
            "screen,P01,D1,screen_on,2",
        ),
        (
            "chronicle.grouped-scalar-extrema/v1",
            b"source_row_id,participant_id,source_day_id,minutes_from_hour_zero\n1,P01,D1,0\n2,P01,D1,1439\n3,P02,D2,600\n",
            3,
            3,
            2,
            "literature-grouped-scalar-extrema-csv",
            "P01,D1,0,1439",
        ),
        (
            "chronicle.scan-signal-proximity-summary/v1",
            b"scan_id,signal\ns1,-69\ns1,-70\ns1,-90\ns1,-91\ns1,NaN\ns1,inf\ns1,-inf\ns2,\n",
            4,
            8,
            1,
            "literature-scan-signal-proximity-summary-csv",
            "3.5,1,1,2",
        ),
        (
            "chronicle.finite-scalar-pivot-classifier/v1",
            b"source_row_id,score\nbelow,3.999999999999\nequal,4\nabove,4.000000000001\n",
            3,
            3,
            3,
            "literature-finite-scalar-pivot-classifier-csv",
            "equal,4.0,0",
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
fn adapters_fail_closed_at_disclosed_input_boundaries() {
    let minute_error = adapter_error(
        "chronicle.grouped-scalar-extrema/v1",
        b"source_row_id,participant_id,source_day_id,minutes_from_hour_zero\n1,P,D,12.5\n",
    );
    assert!(minute_error.contains("integer minute in [0,1440)"));

    let mixed_scan_error = adapter_error(
        "chronicle.scan-signal-proximity-summary/v1",
        b"scan_id,signal\ns1,\ns1,-70\n",
    );
    assert!(mixed_scan_error.contains("mixes signals with the empty-scan sentinel"));

    let pivot_error = adapter_error(
        "chronicle.finite-scalar-pivot-classifier/v1",
        b"source_row_id,score\n1,NaN\n",
    );
    assert!(pivot_error.contains("observation must be finite"));
}
