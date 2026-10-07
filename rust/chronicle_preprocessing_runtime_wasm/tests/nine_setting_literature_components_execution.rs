use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const TIMESTAMP_COMPONENT: &str = "chronicle.timestamp-correction/v1";
const AGGREGATED_APP_COMPONENT: &str = "chronicle.aggregated-app-observation/v1";
const COMMUNICATION_COMPONENT: &str = "chronicle.communication-detail-record/v1";
const TIMESTAMP_FIXTURE: &str =
    include_str!("fixtures/schoedel_timestamp_correction_r_oracle.json");
const AGGREGATED_APP_FIXTURE: &[u8] =
    include_bytes!("fixtures/aggregated_app_observations_denadai2019.csv.fixture");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Bounded literature input component",
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
        request_id: format!("nine-setting-{}", component_id.replace(['.', '/'], "-")),
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

fn timestamp_csv() -> Vec<u8> {
    let fixture: Value = serde_json::from_str(TIMESTAMP_FIXTURE).expect("R-oracle fixture JSON");
    fixture["rawCsv"]
        .as_str()
        .expect("rawCsv fixture")
        .as_bytes()
        .to_vec()
}

#[test]
fn t16_executes_all_five_settings_through_the_public_component_runner() {
    let raw = timestamp_csv();
    let mut handle = execute_literature_component_native(
        TIMESTAMP_COMPONENT,
        &request(TIMESTAMP_COMPONENT, &raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("T16 canonical parent accepts its exact five settings");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.component_id, TIMESTAMP_COMPONENT);
    assert_eq!(manifest.source_row_count, 7);
    assert_eq!(manifest.derived_result_row_count, 4);

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
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(
        method
            .setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "method-setting-071995a6e078e7c57832d3a6",
            "method-setting-89f718192c3ca086dcaa99c5",
            "method-setting-8e387e15b09a02c6d5c2f942",
            "method-setting-cb3bf10d6500476969672b53",
            "method-setting-f023abce9be53100e2dd22a6",
        ])
    );
    let output = std::str::from_utf8(&payloads["literature-timestamp-correction-csv"])
        .expect("timestamp output UTF-8");
    assert!(output.contains("r-zero,zero,2020-06-15 21:15:30,3600000"));
    assert!(!output.contains("r-late,dup-a"));
}

fn execute_adapter(component_id: &str, raw: &[u8]) -> Vec<u8> {
    let (registration, bindings) =
        literature_component_execution_unit(component_id).expect("component registration");
    assert!(!registration.limitations.is_empty());
    adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[])
        .expect("source-conformant adapter execution")
        .expect("component adaptation")
        .derived_result_bytes
        .expect("derived component output")
}

#[test]
fn t12_and_t13_preserve_their_source_bounded_adapter_values() {
    let aggregated = execute_adapter(AGGREGATED_APP_COMPONENT, AGGREGATED_APP_FIXTURE);
    let aggregated = std::str::from_utf8(&aggregated).expect("aggregated-app output UTF-8");
    assert!(aggregated.contains("Communication App A,01.250,0007"));

    for (row, retained, absent) in [
        ("subscriber-a,subscriber-b,voice_call", "voice_call", ",sms"),
        ("subscriber-a,subscriber-b,sms", ",sms", "voice_call"),
    ] {
        let raw = format!(
            "endpoint_1_id,endpoint_2_id,communication_modality,opaque_carrier_column\n{row},opaque\n"
        );
        let communication = execute_adapter(COMMUNICATION_COMPONENT, raw.as_bytes());
        let communication =
            std::str::from_utf8(&communication).expect("communication output UTF-8");
        assert!(communication.contains(retained));
        assert!(!communication.contains(absent));
    }
}

#[test]
fn t12_executes_its_registered_setting_without_claiming_full_profile_execution() {
    let mut handle = execute_literature_component_native(
        AGGREGATED_APP_COMPONENT,
        &request(AGGREGATED_APP_COMPONENT, AGGREGATED_APP_FIXTURE),
        AGGREGATED_APP_FIXTURE,
        &RuntimeSupportFiles::default(),
    )
    .expect("T12 canonical parent accepts its exact setting");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.component_id, AGGREGATED_APP_COMPONENT);
    assert_eq!(manifest.source_row_count, 3);
    assert_eq!(manifest.derived_result_row_count, 3);
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
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    assert_eq!(
        method.parent_method_profile_id,
        "method-profile:doi:10.1038/s41598-019-47493-x"
    );
    assert_eq!(method.source_work_id, "doi:10.1038/s41598-019-47493-x");
    assert_eq!(
        method.source_method_variant_id,
        "source-audit-configuration-space-db88f5af3705e2e82ef1fd4d"
    );
    assert_eq!(
        method.method_profile_version,
        "literature-sublation-v3-atomic+source-complete-v1"
    );
    assert_eq!(
        method.setting_ids,
        ["method-setting-7cc86be8b942308cd15285e8"]
    );
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.canonical_kernel_input_digest, None);
    let output = std::str::from_utf8(&payloads["literature-aggregated-app-observation-csv"])
        .expect("aggregated-app output UTF-8");
    assert!(output.contains("Communication App A,01.250,0007"));
}

#[test]
fn t13_excluded_carrier_parent_is_refused_by_the_registered_runner() {
    let raw = b"endpoint_1_id,endpoint_2_id,communication_modality\na,b,sms\n";
    let error = execute_literature_component_native(
        COMMUNICATION_COMPONENT,
        &request(COMMUNICATION_COMPONENT, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("excluded carrier-CDR parent must not produce an execution receipt");
    assert_eq!(
        error,
        "literature component parent profile is not registered"
    );
}
