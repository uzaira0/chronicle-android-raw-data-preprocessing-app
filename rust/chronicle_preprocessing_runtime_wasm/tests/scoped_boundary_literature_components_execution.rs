use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Scoped bounded literature components",
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
        request_id: format!("scoped-boundary-{}", component_id.replace(['.', '/'], "-")),
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

struct ExecutedComponent {
    manifest: LiteratureComponentRuntimeManifest,
    method: LiteratureComponentMethodReceipt,
    execution: LiteratureComponentExecutionReceipt,
    payloads: BTreeMap<String, Vec<u8>>,
}

fn execute(component_id: &str, raw: &[u8]) -> ExecutedComponent {
    let mut handle = execute_literature_component_native(
        component_id,
        &request(component_id, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap_or_else(|error| panic!("{component_id}: {error}"));
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
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
    let method = serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
        .expect("method receipt");
    let execution =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    ExecutedComponent {
        manifest,
        method,
        execution,
        payloads,
    }
}

fn assert_identity(
    component: &ExecutedComponent,
    component_id: &str,
    expected_settings: BTreeSet<&str>,
) {
    assert_eq!(component.manifest.component_id, component_id);
    assert_eq!(component.method.component_id, component_id);
    assert_eq!(component.execution.component_id, component_id);
    assert_eq!(component.method.parent_profile_execution_status, "blocked");
    assert_eq!(component.execution.full_profile_execution_status, "blocked");
    assert!(!component.execution.kernel_input_eligible);
    assert_eq!(component.execution.canonical_kernel_input_digest, None);
    assert_eq!(
        component
            .method
            .setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        expected_settings
    );
}

fn derived_csv<'a>(component: &'a ExecutedComponent, kind: &str) -> &'a str {
    std::str::from_utf8(&component.payloads[kind]).expect("derived CSV UTF-8")
}

#[test]
fn four_scoped_boundary_components_execute_exact_registered_settings() {
    let day_duration_id = "chronicle.participant-day-duration-exclusion/v1";
    let day_duration = execute(
        day_duration_id,
        b"participant_id,source_day_id,total_duration_ns\nP1,equal,36000000000000\nP1,over,36000000000001\n",
    );
    assert_identity(
        &day_duration,
        day_duration_id,
        BTreeSet::from(["method-setting-dd064a91f6fa5b9b002f5984"]),
    );
    assert_eq!(day_duration.manifest.source_row_count, 2);
    assert_eq!(day_duration.manifest.derived_result_row_count, 2);
    let output = derived_csv(
        &day_duration,
        "literature-participant-day-duration-exclusion-csv",
    );
    assert!(output.contains("P1,equal,36000000000000,false"));
    assert!(output.contains("P1,over,36000000000001,true"));

    let conjunction_id = "chronicle.date-count-conjunction-exclusion/v1";
    let conjunction = execute(
        conjunction_id,
        b"record_type,date,primary_count,secondary_count,ema_scope_id\ndaily_count,2020-01-01,7,12,\ndaily_count,2020-01-02,9,10,\ndaily_count,2020-01-03,10,8,\nema_scope,2020-01-01,,,ema-1\nema_scope,2020-01-02,,,ema-2\n",
    );
    assert_identity(
        &conjunction,
        conjunction_id,
        BTreeSet::from(["method-setting-9c709fc6db3b34ad6ee17557"]),
    );
    let output = derived_csv(
        &conjunction,
        "literature-date-count-conjunction-exclusion-csv",
    );
    assert!(output.contains("daily_count,2020-01-01,,7,12,true,true"));
    assert!(output.contains("ema_scope,2020-01-01,ema-1,,,,,true"));

    let missing_secondary = execute(
        conjunction_id,
        b"record_type,date,primary_count,secondary_count,ema_scope_id\ndaily_count,2020-01-01,7,,\ndaily_count,2020-01-02,9,10,\ndaily_count,2020-01-03,10,8,\nema_scope,2020-01-01,,,ema-na\n",
    );
    let missing_secondary = derived_csv(
        &missing_secondary,
        "literature-date-count-conjunction-exclusion-csv",
    );
    assert!(missing_secondary.contains("ema_scope,2020-01-01,ema-na,,,,,false"));

    let warmup_id = "chronicle.participation-day-warmup/v1";
    let warmup = execute(
        warmup_id,
        b"record_type,participant_id,source_day_id,timestamp_ns,payload\nboundary,P1,day-a,10000000000000,\nevent,P1,day-a,10000000000000,at-start\nevent,P1,day-a,13599999999999,just-before\nevent,P1,day-a,13600000000000,exact\nevent,P1,day-a,13600000000001,after\nevent,P1,day-a,13600000000001,after\n",
    );
    assert_identity(
        &warmup,
        warmup_id,
        BTreeSet::from(["method-setting-50d746b62ee05404bbbfaac8"]),
    );
    assert_eq!(warmup.manifest.source_row_count, 6);
    assert_eq!(warmup.manifest.derived_result_row_count, 3);
    let output = derived_csv(&warmup, "literature-participation-day-warmup-csv");
    assert!(!output.contains("at-start"));
    assert!(!output.contains("just-before"));
    assert!(output.contains("13600000000000,exact"));
    assert_eq!(output.matches("13600000000001,after").count(), 2);

    let cap_id = "chronicle.fixed-weekly-self-report-cap/v1";
    let cap = execute(
        cap_id,
        b"participant_id,measure_id,weekly_hours\nP1,total,83.999\nP1,total,84\nP1,total,100.5\nP1,total,100.5\n",
    );
    assert_identity(
        &cap,
        cap_id,
        BTreeSet::from([
            "method-setting-71f115f4d10a7a596fcaa44c",
            "method-setting-8635523f80433dc441372044",
        ]),
    );
    assert_eq!(cap.manifest.source_row_count, 4);
    assert_eq!(cap.manifest.derived_result_row_count, 4);
    let output = derived_csv(&cap, "literature-fixed-weekly-self-report-cap-csv");
    assert!(output.contains("1,P1,total,83.999,83.999,false"));
    assert!(output.contains("2,P1,total,84.0,84.0,true"));
    assert_eq!(output.matches("P1,total,100.5,84.0,true").count(), 2);
}
