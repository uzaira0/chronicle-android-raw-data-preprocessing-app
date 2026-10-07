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

const COMPONENT_ID: &str = "chronicle.categorized-distinct-member-counts/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Categorized distinct member counts",
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
        request_id: "categorized-distinct-member-counts".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"categorized-distinct-member-counts-workspace"),
        input_file_name: "categorized-members.csv".into(),
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

fn adapter_error(raw: &[u8]) -> String {
    let (_, bindings) = literature_component_execution_unit(COMPONENT_ID).expect("registration");
    match adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[]) {
        Err(error) => error,
        Ok(_) => panic!("expected fail-closed adapter error"),
    }
}

#[test]
fn six_distinct_count_outputs_execute_through_the_public_runner() {
    let raw = concat!(
        "source_row_id,contact_identity_json,call_type,day_class\n",
        "1,\"\"\"A\"\"\",incoming,weekday\n",
        "2,\"\"\"A\"\"\",incoming,weekday\n",
        "3,\"\"\"B\"\"\",outgoing,weekday\n",
        "4,7,outgoing,weekend\n",
        "5,\"\"\"7\"\"\",outgoing,weekend\n",
        "6,null,missed,weekend\n",
        "7,null,missed,weekend\n",
        "8,\"\"\"C\"\"\",missed,weekday\n",
        "9,\"\"\"A\"\"\",source-other,weekday\n",
    )
    .as_bytes();
    let (registration, bindings) =
        literature_component_execution_unit(COMPONENT_ID).expect("component registration");
    assert_eq!(bindings.len(), 6);
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
    assert_eq!(manifest["sourceRowCount"], 9);
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
        if metadata.kind == "literature-categorized-distinct-member-counts-csv" {
            output = Some(String::from_utf8(bytes).expect("UTF-8 output"));
        }
    }
    let output = output.expect("derived output");
    assert!(output.starts_with(concat!(
        "Stachl_number_of_call_contacts,",
        "Stachl_number_of_call_contacts_incoming,",
        "Stachl_number_of_call_contacts_outgoing,",
        "Stachl_number_of_call_contacts_missed,",
        "Stachl_number_of_call_contacts_weekday,",
        "Stachl_number_of_call_contacts_weekend\n",
    )));
    assert!(output.ends_with("6,1,3,2,3,3\n"), "{output}");
}

#[test]
fn empty_slices_zero_fill_but_unsupported_typed_inputs_fail_closed() {
    let empty = b"source_row_id,contact_identity_json,call_type,day_class\n";
    let (_, bindings) = literature_component_execution_unit(COMPONENT_ID).expect("registration");
    let adapted = adapt_literature_inputs(empty, &sha256(empty), &bindings, |_| &[])
        .expect("empty typed window")
        .expect("derived counts");
    let output = String::from_utf8(adapted.derived_result_bytes.expect("derived output"))
        .expect("UTF-8 output");
    assert!(output.ends_with("0,0,0,0,0,0\n"));

    for invalid_identity in ["true", "7.5", "[]", "{}"] {
        let raw = format!(
            "source_row_id,contact_identity_json,call_type,day_class\n1,{invalid_identity},incoming,weekday\n"
        );
        assert!(adapter_error(raw.as_bytes()).contains("unsupported contact_identity_json"));
    }
    let invalid_partition =
        b"source_row_id,contact_identity_json,call_type,day_class\n1,null,incoming,Weekday\n";
    assert!(adapter_error(invalid_partition).contains("unsupported day_class"));
}
