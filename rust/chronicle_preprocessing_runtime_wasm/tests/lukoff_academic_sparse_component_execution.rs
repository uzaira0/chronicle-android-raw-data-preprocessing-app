use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const ESM_COMPONENT: &str = "chronicle.esm-app-sampling-gate/v1";
const ACADEMIC_COMPONENT: &str = "chronicle.screen-academic-row-derivation/v1";
const SPARSE_COMPONENT: &str = "chronicle.iterative-sparse-group-filter/v1";

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
        request_id: format!("source-bound-{}", component_id.replace(['.', '/'], "-")),
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

fn public_artifacts(
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
    .expect("canonical parent accepts exact registered settings");
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

fn esm_raw(configuration_id: &str) -> Vec<u8> {
    format!(
        "# chronicle-literature-component-configuration/v1:{configuration_id}\nsource_row_id,package_id,during_delay_draw_index,contiguous_use_duration_ms,recent_successful_package_ids,elapsed_since_last_prompt_ms\nequality,app.d,44,15000,app.a|app.b|app.c,1800000\n"
    )
    .into_bytes()
}

#[test]
fn lukoff_selects_one_cooldown_configuration_per_invocation_and_receipts_it() {
    let (registration, bindings) =
        literature_component_execution_unit(ESM_COMPONENT).expect("ESM component registration");
    assert!(registration
        .limitations
        .iter()
        .any(|limitation| limitation.contains("cannot mix")));

    let mut equality_outcomes = BTreeMap::new();
    let mut configuration_digests = BTreeSet::new();
    for (configuration_id, expected_equality) in [
        ("paper_at_least_30_minutes", ",true\n"),
        ("released_code_strictly_after_30_minutes", ",false\n"),
    ] {
        let raw = esm_raw(configuration_id);
        let adapted = adapt_literature_inputs(&raw, &sha256(&raw), &bindings, |_| &[])
            .expect("source-bounded adapter")
            .expect("ESM adaptation");
        let selection = adapted
            .receipt
            .component_configuration
            .expect("invocation-level configuration receipt");
        assert_eq!(selection.configuration_id, configuration_id);
        configuration_digests.insert(selection.configuration_sha256);
        equality_outcomes.insert(
            configuration_id,
            String::from_utf8(adapted.derived_result_bytes.expect("derived output"))
                .expect("output UTF-8"),
        );
        assert!(equality_outcomes[configuration_id].ends_with(expected_equality));
    }
    assert_eq!(configuration_digests.len(), 2);
    assert_ne!(
        equality_outcomes["paper_at_least_30_minutes"],
        equality_outcomes["released_code_strictly_after_30_minutes"]
    );

    let no_directive = b"source_row_id,package_id,during_delay_draw_index,contiguous_use_duration_ms,recent_successful_package_ids,elapsed_since_last_prompt_ms\nequality,app.d,44,15000,app.a|app.b|app.c,1800000\n";
    let error =
        match adapt_literature_inputs(no_directive, &sha256(no_directive), &bindings, |_| &[]) {
            Err(error) => error,
            Ok(_) => panic!("a run cannot silently omit configuration selection"),
        };
    assert!(error.contains("invocation-level configuration directive"));

    let raw = esm_raw("paper_at_least_30_minutes");
    let error = execute_literature_component_native(
        ESM_COMPONENT,
        &request(ESM_COMPONENT, &raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("canonical parent cannot yet project both source variants");
    assert!(
        error.contains("exact blocked zero-completed canonical profile"),
        "{error}"
    );
}

#[test]
fn academic_derivation_executes_its_exact_seven_settings_through_the_public_runner() {
    let raw = b"source_row_id,integer_grade,screen_time,attendance_percent,parent_income_mean,smoke_frequency,course_semester_id,high_school_gpa,parent_education_max\nkept,50,1,100,50000,4,COURSE-A_2020_fall,3.5,16\ndropped,70,2,87.5,0,3,NOSUFFIX,NA,14\n";
    let (manifest, payloads) = public_artifacts(ACADEMIC_COMPONENT, raw);
    assert_eq!(manifest.source_row_count, 2);
    assert_eq!(manifest.derived_result_row_count, 1);
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    assert_eq!(method.setting_ids.len(), 7);
    assert_eq!(method.setting_ids.iter().collect::<BTreeSet<_>>().len(), 7);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    let output = std::str::from_utf8(&payloads["literature-screen-academic-row-derivation-csv"])
        .expect("academic output UTF-8");
    assert!(output.contains("kept,0,5,"));
    assert!(!output.contains("dropped"));
}

#[test]
fn sparse_filter_reuses_the_existing_fixed_point_operator_through_the_public_runner() {
    let raw = b"source_row_id,user_idx,course_num_sem,payload\n1,U1,C1,stable-1\n2,U1,C2,stable-2\n3,U2,C1,stable-3\n4,U2,C2,stable-4\n5,U3,C3,peel-1\n6,U3,C4,peel-2\n7,U4,C4,peel-3\n8,U5,C3,peel-4\n";
    let (manifest, payloads) = public_artifacts(SPARSE_COMPONENT, raw);
    assert_eq!(manifest.source_row_count, 8);
    assert_eq!(manifest.derived_result_row_count, 4);
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    assert_eq!(
        method.setting_ids,
        ["method-setting-d6ec2c28ae4396099857ded7"]
    );
    let output = std::str::from_utf8(&payloads["literature-iterative-sparse-group-filter-csv"])
        .expect("sparse output UTF-8");
    assert!(output.contains("1,U1,C1,stable-1"));
    assert!(output.contains("4,U2,C2,stable-4"));
    assert!(!output.contains("peel-1"));
    assert!(!output.contains("peel-4"));
}
