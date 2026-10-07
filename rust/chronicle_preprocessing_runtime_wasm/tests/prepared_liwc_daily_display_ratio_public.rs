//! Prepared LIWC ratio normal public artifact proof; canonical source admission is required.
//! Kept as ordinary tests, not ignored or replaced with a successful refusal.
use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn digest(raw: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(raw)))
}

fn run(component: &str) -> BTreeMap<String, String> {
    let registration = literature_component_execution_unit(component).unwrap().0;
    let fixture: Value = serde_json::from_str(include_str!(
        "fixtures/literature_input_adapter_conformance.json"
    ))
    .unwrap();
    let case = &fixture["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["adapterId"] == component)
        .unwrap()["cases"][0];
    let raw = case["rawCsvLines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let options: PipelineV2OptionsJson=serde_json::from_value(json!({
        "study_name":"Supplied Android usage statistics", "timezone":"UTC", "usage_session_mode":"app_usage",
        "include_app_output":true, "include_screen_output":false, "use_filter_file":false,
        "use_apps_forcing_screen_open":false, "use_app_codebook":false,
        "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
        "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
        "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
        "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
        "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
        "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
        "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
        "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
    })).unwrap();
    let request = serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(raw.as_bytes()),
        input_file_name: "supplied-inventory.csv".into(),
        input_sha256: digest(raw.as_bytes()),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options,
    })
    .unwrap();
    let mut handle=execute_literature_component_native(component,&request,raw.as_bytes(),&RuntimeSupportFiles::default())
        .expect("canonical writer must normally admit the exact new source tuples before public component proof");
    let manifest: Value = serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest["sourceRowCount"], 1);
    assert_eq!(manifest["derivedResultRowCount"], 1);
    let mut result = None;
    for index in 0..handle.artifact_count() {
        let meta: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(meta.digest, digest(&bytes));
        if meta.kind == registration.derived_result_kind {
            let mut csv = csv::Reader::from_reader(bytes.as_slice());
            let headers = csv.headers().unwrap().clone();
            let rows = csv.records().collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(rows.len(), 1);
            result = Some(
                headers
                    .iter()
                    .zip(rows[0].iter())
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect(),
            );
        }
    }
    result.expect("public component must publish its real derived CSV")
}

#[test]
fn prepared_liwc_public_export_requires_normal_source_admission_and_real_fraction() {
    let row = run("chronicle.prepared-liwc-daily-display-ratio/v1");
    let result: Value = serde_json::from_str(&row["daily_display_ratios_json"]).unwrap();
    assert_eq!(row["component_study_total"], "8");
    assert_eq!(result[0]["value"], json!(0.25));
    assert_eq!(result[1]["value"], json!(0.75));
    assert_eq!(row["output_unit_relation"], "dimensionless_fraction");
}
