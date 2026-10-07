use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENTS: [&str; 6] = [
    "chronicle.reachable-prepared-pre-mean/v1",
    "chronicle.reachable-prepared-between-mean/v1",
    "chronicle.moodable-prepared-slots/v1",
    "chronicle.silencer-prepared-calibration/v1",
    "chronicle.alertness-prepared-inventory/v1",
    "chronicle.screen-prepared-density/v1",
];
fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}
fn cases(component: &str) -> Vec<Value> {
    let fixture: Value = serde_json::from_str(include_str!(
        "fixtures/literature_input_adapter_conformance.json"
    ))
    .unwrap();
    fixture["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["adapterId"] == component)
        .unwrap()["cases"]
        .as_array()
        .unwrap()
        .clone()
}
fn raw(case: &Value) -> Vec<u8> {
    (case["rawCsvLines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n")
        .into_bytes()
}
fn request(component: &str, raw: &[u8]) -> String {
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name":"Prepared finite source fixtures", "timezone":"Pacific/Kiritimati",
        "usage_session_mode":"app_usage", "include_app_output":true, "include_screen_output":false,
        "use_filter_file":false, "use_apps_forcing_screen_open":false, "use_app_codebook":false,
        "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
        "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
        "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
        "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
        "same_app_stop_types":["Activity Paused","Activity Resumed"],
        "other_stop_types":["Activity Resumed","Device Shutdown"], "interaction_types_to_remove":[],
        "screen_auto_lock_timeout_seconds":120.0, "screen_auto_lock_tolerance_seconds":30.0,
        "screen_manual_lock_max_tail_seconds":30.0, "screen_keyguard_near_stop_seconds":2.0,
        "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
    }))
    .unwrap();
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(component.as_bytes()),
        input_file_name: "prepared.csv".into(),
        input_sha256: digest(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options,
    })
    .unwrap()
}
fn public_receipt(component: &str) {
    let (registration, bindings) = literature_component_execution_unit(component).unwrap();
    let fixture = cases(component);
    let raw = raw(&fixture[0]);
    let mut handle = execute_literature_component_native(
        component,
        &request(component, &raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    assert_eq!(
        manifest.source_row_count,
        fixture[0]["expected"]["sourceRowCount"].as_u64().unwrap() as u32
    );
    let derived = artifacts.get(&registration.derived_result_kind).unwrap();
    let output = std::str::from_utf8(derived).unwrap();
    for case in &fixture {
        for expected in case["expected"]["derivedOutputContains"]
            .as_array()
            .unwrap()
        {
            assert!(output.contains(expected.as_str().unwrap()), "{output}");
        }
    }
    let receipt_bytes = artifacts
        .get("literature-component-execution-receipt-json")
        .unwrap();
    assert_eq!(
        manifest.component_execution_receipt_digest,
        digest(receipt_bytes)
    );
    let receipt: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(receipt_bytes).unwrap();
    assert_eq!(receipt.component_id, registration.component_id);
    assert_eq!(receipt.source_work_id, registration.source_work_id);
    assert_eq!(receipt.component_execution_status, "executed");
    assert_eq!(receipt.full_profile_execution_status, "blocked");
    assert!(!receipt.kernel_input_eligible);
    assert!(receipt.canonical_kernel_input_digest.is_none());
    assert_eq!(receipt.derived_result_digest, digest(derived));
    assert_eq!(
        receipt.setting_ids.iter().collect::<BTreeSet<_>>(),
        bindings
            .iter()
            .map(|b| &b.setting_id)
            .collect::<BTreeSet<_>>()
    );
    assert_eq!(
        manifest.derived_result_row_count as usize,
        csv::Reader::from_reader(derived.as_slice())
            .records()
            .count()
    );
}
macro_rules! public_test {
    ($name:ident, $index:expr) => {
        #[test]
        fn $name() {
            public_receipt(COMPONENTS[$index]);
        }
    };
}
public_test!(registered_reachable_pre_mean_receipt_export, 0);
public_test!(registered_reachable_between_mean_receipt_export, 1);
public_test!(registered_moodable_full_slot_matrix_receipt_export, 2);
public_test!(registered_silencer_prepared_calibration_receipt_export, 3);
public_test!(registered_alertness_prepared_inventory_receipt_export, 4);
public_test!(registered_screen_occurrence_density_receipt_export, 5);

fn check_registered_reachable_use_state_consistency(index: usize) {
    let component = COMPONENTS[index];
    let (_, bindings) = literature_component_execution_unit(component).unwrap();
    let header = "participant_id,interruption_id,use_state,stage,outcome,feature_stream,sample_id,sample_order,value,input_unit,inventory_complete\n";
    let (first_stage, first_outcome, second_stage, second_outcome) = if index == 1 {
        ("I-D1", "Rc", "I-D3", "Rv")
    } else {
        ("pre_interruption", "none", "pre_interruption", "none")
    };
    let first = format!("P,I,not_in_use,{first_stage},{first_outcome},f,a,0,2,u,true\n");
    let second = format!("P,I,in_use,{second_stage},{second_outcome},f,b,1,4,u,true\n");
    let contradictory = format!("{header}{first}{second}");
    let error = adapt_literature_inputs(
        contradictory.as_bytes(), &digest(contradictory.as_bytes()), &bindings, |_| &[],
    ).err().expect("registered CSV must refuse contradictory use states for one interruption");
    assert!(error.contains("one use_state per lexical participant/interruption"), "{error}");
    for distinct_second in [
        second.replacen("P,I,", "P,J,", 1),
        second.replacen("P,I,", "P, I ,", 1),
        second.replacen("P,I,", " P ,I,", 1),
    ] {
        let valid = format!("{header}{first}{distinct_second}");
        let result = adapt_literature_inputs(
            valid.as_bytes(), &digest(valid.as_bytes()), &bindings, |_| &[],
        ).unwrap().unwrap();
        let bytes = result.derived_result_bytes.as_ref().unwrap();
        assert_eq!(result.receipt.source_row_count, 2);
        assert_eq!(result.receipt.derived_result.as_ref().unwrap().row_count, 2);
        assert_eq!(result.receipt.derived_result.as_ref().unwrap().digest, digest(bytes));
        let output = std::str::from_utf8(bytes).unwrap();
        let identity = distinct_second.split(',').take(2).collect::<Vec<_>>().join(",");
        assert!(output.contains(&format!("P,I,not_in_use,{first_stage},{first_outcome},f,u,1,arithmetic_mean,2.0,computed,,input_unit")));
        assert!(output.contains(&format!("{identity},in_use,{second_stage},{second_outcome},f,u,1,arithmetic_mean,4.0,computed,,input_unit")));
    }
}

#[test]
fn registered_reachable_pre_use_state_consistency_and_lexical_identity() {
    check_registered_reachable_use_state_consistency(0);
}

#[test]
fn registered_reachable_between_use_state_consistency_and_lexical_identity() {
    check_registered_reachable_use_state_consistency(1);
}

#[test]
fn reserved_native_bindings_execute_every_exact_finite_feature_csv_fixture() {
    let mut identities = BTreeSet::new();
    for component in COMPONENTS {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        let fixture = cases(component);
        assert_eq!(bindings.len(), fixture.len());
        for binding in bindings {
            let case = fixture
                .iter()
                .find(|x| x["methodSettingId"] == binding.setting_id)
                .unwrap();
            assert_eq!(case["sourceValue"], binding.source_value);
            assert!(identities.insert(binding.setting_id.clone()));
            let raw = raw(case);
            let result = adapt_literature_inputs(&raw, &digest(&raw), std::slice::from_ref(&binding), |_| &[])
                .unwrap()
                .unwrap();
            let bytes = result.derived_result_bytes.as_ref().unwrap();
            assert_eq!(
                result.receipt.source_row_count,
                case["expected"]["sourceRowCount"].as_u64().unwrap() as u32
            );
            assert_eq!(
                result.receipt.derived_result.as_ref().unwrap().row_count,
                case["expected"]["emittedRowCount"].as_u64().unwrap() as u32
            );
            assert_eq!(
                result.receipt.derived_result.as_ref().unwrap().digest,
                digest(bytes)
            );
            for expected in case["expected"]["derivedOutputContains"]
                .as_array()
                .unwrap()
            {
                assert!(std::str::from_utf8(bytes)
                    .unwrap()
                    .contains(expected.as_str().unwrap()));
            }
            eprintln!(
                "{}",
                json!({"methodSettingId":binding.setting_id,"sourceWorkId":registration.source_work_id,
                "sourceMethodVariantId":registration.source_method_variant_id,"methodProfileVersion":registration.method_profile_version,
                "fixtureId":binding.conformance_fixture_id,"executedResultDigest":binding.conformance_result_digest})
            );
        }
    }
    assert_eq!(
        identities.len(),
        COMPONENTS
            .into_iter()
            .map(|x| cases(x).len())
            .sum::<usize>()
    );
}

#[test]
fn registered_finite_csv_rejects_forgery_missing_and_unqualified_membership() {
    for component in COMPONENTS {
        let raw = raw(&cases(component)[0]);
        let (_, mut bindings) = literature_component_execution_unit(component).unwrap();
        bindings[0].source_value = json!({"forged":true});
        assert!(adapt_literature_inputs(&raw, &digest(&raw), &bindings, |_| &[]).is_err());
        let (_, bindings) = literature_component_execution_unit(component).unwrap();
        for modified in [
            String::from_utf8(raw.clone())
                .unwrap()
                .replacen(",true", ",false", 1),
            String::from_utf8(raw.clone())
                .unwrap()
                .replacen(" P ", " ", 1),
        ] {
            assert!(
                adapt_literature_inputs(
                    modified.as_bytes(),
                    &digest(modified.as_bytes()),
                    &bindings,
                    |_| &[]
                )
                .is_err(),
                "{component}"
            );
        }
    }
}

#[test]
fn registered_arithmetic_statuses_preserve_other_reductions_slots_and_lexical_groups() {
    for (index, fragment) in [
        (0, ",arithmetic_mean,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"),
        (2, ",arithmetic_unavailable,floating_point_mean_underflow,input_unit"),
        (3, ",calibration_threshold,,,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"),
        (4, ",session_duration_mean,,arithmetic_unavailable,nonfinite_arithmetic,seconds_per_session"),
    ] {
        let component = COMPONENTS[index];
        let raw = raw(&cases(component)[0]);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let header = reader.headers().unwrap().clone();
        let field = |name| header.iter().position(|x| x == name).unwrap();
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(&header).unwrap();
        for record in reader.records() {
            let mut record = record.unwrap().iter().map(str::to_owned).collect::<Vec<_>>();
            match index {
                0 if record[field("participant_id")] == " P " => record[field("value")] = f64::MAX.to_string(),
                2 if record[field("metric")] == "incoming_text_sentiment" => record[field("value")] =
                    if record[field("lag_index")] == "1" { f64::from_bits(1) } else { 0.0 }.to_string(),
                3 if record[field("stage")] == "calibration" => record[field("value")] = f64::MAX.to_string(),
                4 if record[field("record_kind")] == "session" => record[field("duration_seconds")] = f64::MAX.to_string(),
                _ => {},
            }
            writer.write_record(record).unwrap();
        }
        let raw = writer.into_inner().unwrap();
        let (_, bindings) = literature_component_execution_unit(component).unwrap();
        let result = adapt_literature_inputs(&raw, &digest(&raw), &bindings, |_| &[]).unwrap().unwrap();
        let output = String::from_utf8(result.derived_result_bytes.unwrap()).unwrap();
        assert!(output.contains(fragment), "{output}");
        match index {
            0 => assert!(output.contains("P,I,not_in_use,pre_interruption,none, acceleration , unit ,1,arithmetic_mean,0.0,computed,,input_unit")),
            2 => {
                assert_eq!(output.matches(fragment).count(), 14);
                assert_eq!(output.matches(",computed,,input_unit").count(), 28);
            },
            3 => {
                assert!(output.contains(",calibration_maximum,,,"));
                assert_eq!(output.matches("calibration_threshold_unavailable,boolean").count(), 3);
            },
            4 => {
                assert!(output.contains(",distinct_app_diversity,2,computed,,distinct_apps"));
                assert!(output.contains(",switch_occurrence_count,2,computed,,switch_occurrences"));
            },
            _ => unreachable!(),
        }
    }
}
