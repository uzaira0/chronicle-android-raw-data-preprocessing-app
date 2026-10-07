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
        "study_name": "Eleven setting literature components",
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
        request_id: format!("eleven-setting-{}", component_id.replace(['.', '/'], "-")),
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
fn nine_components_execute_all_eleven_settings_through_the_public_runner() {
    type ComponentCase = (
        &'static str,
        &'static [u8],
        usize,
        u32,
        &'static str,
        &'static str,
    );
    let cases: [ComponentCase; 9] = [
        (
            "chronicle.phq9-depression-classifier/v1",
            b"source_row_id,phq9_score\nbelow,9.9\nequal,10\nmaximum,27\n",
            2,
            3,
            "literature-source-bound-scalar-predicate-csv",
            "equal,10.0,depressed",
        ),
        (
            "chronicle.initial-es-observation-count-gate/v1",
            b"source_row_id,initial_sensing_row_count\nbelow,13\nequal,14\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,14.0,retain",
        ),
        (
            "chronicle.default-battery-stop-gate/v1",
            b"source_row_id,battery_percentage_points\nbelow,19.9\nequal,20\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "below,19.9,suspend_scripting_engine_and_stop_all_running_experiments",
        ),
        (
            "chronicle.answered-prompt-count-gate/v1",
            b"source_row_id,answered_prompt_count\nbelow,7\nequal,8\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,8.0,retain",
        ),
        (
            "chronicle.consecutive-data-weeks-gate/v1",
            b"source_row_id,consecutive_data_weeks\nbelow,1\nequal,2\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,2.0,retain",
        ),
        (
            "chronicle.authentication-training-vector-count-gate/v1",
            b"source_row_id,training_vector_count\nbelow,79\nequal,80\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "below,79.0,discard_from_authentication",
        ),
        (
            "chronicle.class-attendance-dwell-gate/v1",
            b"source_row_id,location_dwell_percent\nbelow,89.999\nequal,90\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "equal,90.0,attended",
        ),
        (
            "chronicle.joint-study-weeks-emotion-label-gate/v1",
            b"source_row_id,source_defined_collection_weeks,emotion_label_count_during_six_weeks\nduration_below,5,50\nlabels_below,6,49\nequal_both,6,50\n",
            2,
            3,
            "literature-source-bound-conjunctive-threshold-gate-csv",
            "equal_both,6,50,retain_participant",
        ),
        (
            "chronicle.gps-hour-coverage-gate/v1",
            b"source_row_id,gps_hours_available_percent\nbelow,79.999\nequal,80\n",
            1,
            2,
            "literature-source-bound-scalar-predicate-csv",
            "below,79.999,filter_user",
        ),
    ];

    for (component_id, raw, setting_count, row_count, result_kind, expected) in cases {
        let (registration, bindings) =
            literature_component_execution_unit(component_id).expect("component registration");
        assert_eq!(bindings.len(), setting_count, "{component_id}");
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
fn new_components_fail_closed_at_source_specific_input_boundaries() {
    let below_phq9_range = adapter_error(
        "chronicle.phq9-depression-classifier/v1",
        b"source_row_id,phq9_score\nrow,-0.1\n",
    );
    assert!(below_phq9_range.contains("violates inclusive source domain"));

    let above_phq9_range = adapter_error(
        "chronicle.phq9-depression-classifier/v1",
        b"source_row_id,phq9_score\nrow,27.1\n",
    );
    assert!(above_phq9_range.contains("violates inclusive source domain"));

    let fractional_count = adapter_error(
        "chronicle.initial-es-observation-count-gate/v1",
        b"source_row_id,initial_sensing_row_count\nrow,14.5\n",
    );
    assert!(fractional_count.contains("violates input domain unsigned_integer"));

    let missing_joint_input = adapter_error(
        "chronicle.joint-study-weeks-emotion-label-gate/v1",
        b"source_row_id,source_defined_collection_weeks,emotion_label_count_during_six_weeks\nrow,6,\n",
    );
    assert!(missing_joint_input.contains("violates input domain unsigned_integer"));

    let nonfinite_duration = adapter_error(
        "chronicle.joint-study-weeks-emotion-label-gate/v1",
        b"source_row_id,source_defined_collection_weeks,emotion_label_count_during_six_weeks\nrow,NaN,50\n",
    );
    assert!(nonfinite_duration.contains("violates input domain finite"));
}

#[test]
fn final_prepared_five_components_execute_exact_hand_outputs_and_preserve_original_inputs() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/final_prepared_source_calculations.json"
    ))
    .unwrap();
    let mut visited = std::collections::BTreeSet::new();
    for case in fixture["cases"].as_array().unwrap() {
        let component_id = case["componentId"].as_str().unwrap();
        if !visited.insert(component_id) {
            continue;
        }
        let lines = case["rawCsvLines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>();
        let raw = format!("{}\n", lines.join("\n"));
        let (registration, bindings) = literature_component_execution_unit(component_id).unwrap();
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert!(!registration.limitations.is_empty());
        assert_eq!(
            bindings.len(),
            if component_id == "chronicle.lin-supplied-daily-epoch-features/v1" {
                3
            } else {
                1
            }
        );
        let (manifest, payloads) = public_execution(component_id, raw.as_bytes());
        assert_eq!(manifest.source_row_count as usize, lines.len() - 1);
        let expected_rows = case["expectedRows"].as_array().unwrap();
        assert_eq!(
            manifest.derived_result_row_count as usize,
            expected_rows.len()
        );
        assert_eq!(manifest.input_digest, sha256(raw.as_bytes()));
        let bytes = &payloads[&registration.derived_result_kind];
        let actual = csv::Reader::from_reader(bytes.as_slice())
            .records()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        assert_eq!(actual.len(), expected_rows.len());
        for (actual, expected) in actual.iter().zip(expected_rows) {
            let prefix = expected
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                actual.iter().take(prefix.len()).collect::<Vec<_>>(),
                prefix,
                "{component_id}"
            );
        }
        let receipt: serde_json::Value =
            serde_json::from_slice(&payloads["literature-input-adaptation-receipt-json"]).unwrap();
        assert_eq!(receipt["originalInputDigest"], sha256(raw.as_bytes()));
        assert!(payloads.contains_key("literature-component-execution-receipt-json"));
    }
    assert_eq!(visited.len(), 5);
}

#[test]
fn rapids_screen_component_executes_all_source_hand_cases_through_the_public_runner() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/rapids_released_screen_episodes_hand.json"
    ))
    .unwrap();
    let component_id = "chronicle.rapids-released-screen-episodes/v1";
    let (registration, bindings) = literature_component_execution_unit(component_id).unwrap();
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert!(!registration.limitations.is_empty());
    assert_eq!(bindings.len(), 1);
    assert_eq!(
        bindings[0].setting_id,
        "method-setting-c24027f66c4d4d9c8bc0e66b"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 17);
    for case in cases {
        let lines = case["rawCsvLines"].as_array().unwrap();
        let raw = format!(
            "{}\n",
            lines
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>()
                .join("\n")
        );
        let (manifest, payloads) = public_execution(component_id, raw.as_bytes());
        assert_eq!(manifest.source_row_count as usize, lines.len() - 1);
        assert_eq!(manifest.input_digest, sha256(raw.as_bytes()));
        let expected_rows = case["expectedRows"].as_array().unwrap();
        assert_eq!(
            manifest.derived_result_row_count as usize,
            expected_rows.len()
        );
        let actual =
            csv::Reader::from_reader(payloads[&registration.derived_result_kind].as_slice())
                .records()
                .map(Result::unwrap)
                .collect::<Vec<_>>();
        assert_eq!(actual.len(), expected_rows.len(), "{}", case["caseId"]);
        for (actual, expected) in actual.iter().zip(expected_rows) {
            assert_eq!(
                actual.iter().collect::<Vec<_>>(),
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>(),
                "{}",
                case["caseId"]
            );
        }
        let receipt: serde_json::Value =
            serde_json::from_slice(&payloads["literature-input-adaptation-receipt-json"]).unwrap();
        assert_eq!(receipt["originalInputDigest"], sha256(raw.as_bytes()));
        assert!(payloads.contains_key("literature-component-execution-receipt-json"));
    }
}
