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

const DUPLICATE_COMPONENT: &str = "chronicle.adjacent-record-duplicate/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Bounded literature component",
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
        request_id: format!("thirteen-setting-{}", component_id.replace(['.', '/'], "-")),
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
    .expect("canonical blocked parent accepts the exact source component");
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
fn recovered_adjacent_duplicate_executes_but_does_not_promote_the_deployed_study() {
    let raw = b"source_row_id,timestamp_seconds,battery_level,battery_state,time_zone,battery_capacity,battery_technology,battery_charger,battery_health,process_importances\nfirst,1000,0.5,Discharging,America/Chicago,3000,Li-ion,unplugged,Good,\nduplicate,1299,0.5,Discharging,America/Chicago,3000,Li-ion,unplugged,Good,\nafter-duplicate,1598,0.5,Discharging,America/Chicago,3000,Li-ion,unplugged,Good,\n";
    let (registration, bindings) =
        literature_component_execution_unit(DUPLICATE_COMPONENT).expect("duplicate registration");
    assert!(registration
        .method_profile_version
        .ends_with("+recovered-carat-f4242acf-v1"));
    assert!(registration
        .limitations
        .iter()
        .any(|limitation| limitation.contains("deployed")));
    let adapted = adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[])
        .expect("recovered source adapter")
        .expect("adapted output");
    assert_eq!(adapted.receipt.source_row_count, 3);
    assert_eq!(adapted.receipt.emitted_row_count, 1);
    assert_eq!(adapted.receipt.duplicate_source_ids_removed, 2);
    let output = String::from_utf8(adapted.derived_result_bytes.expect("derived output"))
        .expect("output UTF-8");
    assert!(output.contains("first"));
    assert!(!output.contains("duplicate"));

    let error = execute_literature_component_native(
        DUPLICATE_COMPONENT,
        &request(DUPLICATE_COMPONENT, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("unresolved deployed revision must block public parent execution");
    assert!(
        error.contains("exact blocked zero-completed canonical profile"),
        "{error}"
    );
}

#[test]
fn seven_source_components_execute_through_the_existing_public_runner() {
    type ComponentCase = (
        &'static str,
        &'static [u8],
        u32,
        u32,
        &'static str,
        &'static str,
    );
    let cases: [ComponentCase; 7] = [
        (
            "chronicle.integer-daypart-bucketizer/v1",
            b"source_row_id,hour_of_day\nh5,5\nh6,6\nh12,12\nh18,18\n",
            4,
            4,
            "literature-integer-daypart-bucketizer-csv",
            "h18,18,evening",
        ),
        (
            "chronicle.hourly-distinct-member-count/v1",
            b"source_row_id,participant_id,source_day_id,hour_of_day,member_identity\n1,P1,D1,9,A\n2,P1,D1,9,A\n3,P1,D1,9,B\n",
            3,
            1,
            "literature-hourly-distinct-member-count-csv",
            "P1,D1,9,2",
        ),
        (
            "chronicle.daily-distinct-member-count/v1",
            b"source_row_id,participant_id,source_day_id,member_identity\n1,P1,D1,A\n2,P1,D1,A\n3,P1,D1,B\n",
            3,
            1,
            "literature-daily-distinct-member-count-csv",
            "P1,D1,2",
        ),
        (
            "chronicle.hourly-categorical-mode/v1",
            b"source_row_id,stream_id,participant_id,source_day_id,hour_of_day,category\n1,hourly_screen_state,P1,D1,9,on\n2,hourly_screen_state,P1,D1,9,on\n3,hourly_screen_state,P1,D1,9,off\n",
            3,
            1,
            "literature-hourly-categorical-mode-csv",
            "hourly_screen_state,P1,D1,9,on,2",
        ),
        (
            "chronicle.categorical-response-rate/v1",
            b"source_row_id,label,response_to_user_label,response_of_user_label\n1,responded,responded,responded\n2,no-response,no-response,no-response\n3,responded,responded,responded\n4,other,other,other\n",
            4,
            1,
            "literature-categorical-response-rate-csv",
            "0.6666666666666666",
        ),
        (
            "chronicle.duration-span-window-projection/v1",
            b"source_row_id,start,duration,window_start,window_end\nleft,500,750,1000,2000\nnan,1500,NaN,1000,2000\noutside,2001,100,1000,2000\n",
            3,
            2,
            "literature-duration-span-window-projection-csv",
            "nan,1500,NaN,500",
        ),
        (
            "chronicle.grouped-column-summary/v1",
            b"source_row_id,group,a,b\n1,B,1,NA\n2,A,2,4\n3,B,3,7\n",
            3,
            2,
            "literature-grouped-column-summary-csv",
            "B,2,1.4142135623730951,7,NA",
        ),
    ];
    for (component_id, raw, source_rows, result_rows, result_kind, expected) in cases {
        let (manifest, payloads) = public_execution(component_id, raw);
        assert_eq!(manifest.component_id, component_id);
        assert_eq!(manifest.source_row_count, source_rows);
        assert_eq!(manifest.derived_result_row_count, result_rows);
        let output = std::str::from_utf8(&payloads[result_kind]).expect("derived output UTF-8");
        assert!(output.contains(expected), "{component_id}: {output}");
    }
}

#[test]
fn undisclosed_ties_and_response_column_ambiguity_fail_closed() {
    let tied = b"source_row_id,stream_id,participant_id,source_day_id,hour_of_day,category\n1,hourly_screen_state,P1,D1,9,on\n2,hourly_screen_state,P1,D1,9,off\n";
    let error = adapter_error("chronicle.hourly-categorical-mode/v1", tied);
    assert!(error.contains("tied maximum"), "{error}");

    let nonempty_missing_column = b"source_row_id\n1\n";
    let error = adapter_error(
        "chronicle.categorical-response-rate/v1",
        nonempty_missing_column,
    );
    assert!(error.contains("nonempty input is missing the label column"));

    let empty_missing_column = b"source_row_id\n";
    let (_, bindings) =
        literature_component_execution_unit("chronicle.categorical-response-rate/v1")
            .expect("response-rate registration");
    let adapted = adapt_literature_inputs(
        empty_missing_column,
        &sha256(empty_missing_column),
        &bindings,
        |_| &[],
    )
    .expect("empty-table behavior")
    .expect("response-rate output");
    let output = String::from_utf8(adapted.derived_result_bytes.expect("derived output"))
        .expect("output UTF-8");
    assert!(output.contains("NaN"));
}
