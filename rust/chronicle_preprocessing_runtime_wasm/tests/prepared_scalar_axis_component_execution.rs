use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const STDD: &str = "chronicle.stdd-prepared-axis/v1";
const TOUCH: &str = "chronicle.touchstroke-prepared-mean/v1";
fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn request(component: &str, raw: &[u8]) -> String {
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name":"Prepared source formula fixtures", "timezone":"Pacific/Kiritimati",
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
        workspace_id: sha256(component.as_bytes()),
        input_file_name: "prepared.csv".into(),
        input_sha256: sha256(raw),
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

fn public_execution(
    component: &str,
    raw: &[u8],
) -> (
    LiteratureComponentRuntimeManifest,
    BTreeMap<String, Vec<u8>>,
) {
    let mut handle = execute_literature_component_native(
        component,
        &request(component, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let manifest = serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, sha256(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    (manifest, artifacts)
}


fn cases(component: &str) -> Vec<serde_json::Value> {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    fixtures["groups"].as_array().unwrap().iter()
        .find(|g| g["adapterId"] == component)
        .unwrap()["cases"].as_array().unwrap().clone()
}
fn raw(case: &serde_json::Value) -> Vec<u8> {
    let lines = case["rawCsvLines"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect::<Vec<_>>();
    (lines.join("\n") + "\n").into_bytes()
}
fn public_receipt(component: &str, work: &str, kind: &str, expected_rows: u32, expected_settings: usize) {
    let case = cases(component)[0].clone();
    let raw = raw(&case);
    let (registration, bindings) = literature_component_execution_unit(component).unwrap();
    assert_eq!(bindings.len(), expected_settings);
    let (manifest, artifacts) = public_execution(component, &raw);
    assert_eq!(manifest.source_row_count, if component == STDD { 50 } else { 7 });
    assert_eq!(manifest.derived_result_row_count, expected_rows);
    let output = std::str::from_utf8(artifacts.get(kind).unwrap()).unwrap();
    for case in cases(component) {
        for expected in case["expected"]["derivedOutputContains"].as_array().unwrap() {
            assert!(output.contains(expected.as_str().unwrap()), "{output}");
        }
    }
    let receipt_bytes = artifacts.get("literature-component-execution-receipt-json").unwrap();
    assert_eq!(manifest.component_execution_receipt_digest, sha256(receipt_bytes));
    let receipt: LiteratureComponentExecutionReceipt = serde_json::from_slice(receipt_bytes).unwrap();
    assert_eq!(receipt.component_id, registration.component_id);
    assert_eq!(receipt.source_work_id, work);
    assert_eq!(receipt.component_execution_status, "executed");
    assert_eq!(receipt.full_profile_execution_status, "blocked");
    assert_eq!(receipt.setting_ids.iter().collect::<BTreeSet<_>>(), bindings.iter().map(|x| &x.setting_id).collect::<BTreeSet<_>>());
    assert!(!receipt.kernel_input_eligible);
    assert!(receipt.canonical_kernel_input_digest.is_none());
    assert_eq!(receipt.derived_result_digest, sha256(artifacts.get(kind).unwrap()));
}
#[test]
fn registered_stdd_export_and_execution_receipt_preserve_nine_only_source_owners() {
    public_receipt(STDD, "doi:10.3390/s20051396", "literature-stdd-prepared-axis-csv", 9, 9);
}
#[test]
fn registered_touchstroke_export_and_execution_receipt_preserve_mean_only_source_owner() {
    public_receipt(TOUCH, "doi:10.1007/978-3-319-23222-5_4", "literature-touchstroke-prepared-mean-csv", 5, 1);
}
#[test]
fn reserved_native_bindings_execute_all_ten_actual_csv_conformance_cases() {
    let mut total = 0;
    for component in [STDD, TOUCH] {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        for binding in bindings {
            let case = cases(component).into_iter().find(|x| x["methodSettingId"] == binding.setting_id).unwrap();
            assert_eq!(case["sourceValue"], binding.source_value);
            let raw = raw(&case);
            let adapted = adapt_literature_inputs(&raw, &sha256(&raw), std::slice::from_ref(&binding), |_| &[]).unwrap().unwrap();
            let bytes = adapted.derived_result_bytes.as_ref().unwrap();
            let derived = adapted.receipt.derived_result.as_ref().unwrap();
            assert_eq!(adapted.receipt.source_row_count, case["expected"]["sourceRowCount"].as_u64().unwrap() as u32);
            assert_eq!(derived.row_count, case["expected"]["emittedRowCount"].as_u64().unwrap() as u32);
            assert_eq!(derived.digest, sha256(bytes));
            for expected in case["expected"]["derivedOutputContains"].as_array().unwrap() {
                assert!(std::str::from_utf8(bytes).unwrap().contains(expected.as_str().unwrap()));
            }
            eprintln!("{}", json!({"methodSettingId":binding.setting_id,"sourceWorkId":registration.source_work_id,
                "sourceMethodVariantId":registration.source_method_variant_id,"methodProfileVersion":registration.method_profile_version,
                "fixtureId":binding.conformance_fixture_id,"executedResultDigest":binding.conformance_result_digest}));
            total += 1;
        }
    }
    assert_eq!(total, 10);
}
#[test]
fn exact_registration_rejects_forgery_partial_membership_and_missing_values() {
    for component in [STDD, TOUCH] {
        let raw = raw(&cases(component)[0]);
        let (_, mut bindings) = literature_component_execution_unit(component).unwrap();
        bindings[0].source_value["definition"]["formula"] = json!("forged");
        assert!(adapt_literature_inputs(&raw, &sha256(&raw), &bindings, |_| &[]).is_err());
        let (_, bindings) = literature_component_execution_unit(component).unwrap();
        let mut missing = csv::Reader::from_reader(raw.as_slice());
        let mut writer = csv::Writer::from_writer(Vec::new());
        let headers = missing.headers().unwrap().clone();
        let value_index = headers.iter().position(|x| x == "value").unwrap();
        writer.write_record(&headers).unwrap();
        for (index, row) in missing.records().enumerate() {
            let mut row = row.unwrap().iter().map(str::to_owned).collect::<Vec<_>>();
            if index == 0 { row[value_index].clear(); }
            writer.write_record(row).unwrap();
        }
        let raw = writer.into_inner().unwrap();
        let error = adapt_literature_inputs(&raw, &sha256(&raw), &bindings, |_| &[]).err().unwrap();
        assert!(error.contains("finite"), "{error}");
    }
    let raw = raw(&cases(STDD)[0]);
    let short = raw.split(|x| *x == b'\n').take(50).map(|x| std::str::from_utf8(x).unwrap()).collect::<Vec<_>>().join("\n") + "\n";
    let (_, bindings) = literature_component_execution_unit(STDD).unwrap();
    let error = adapt_literature_inputs(short.as_bytes(), &sha256(short.as_bytes()), &bindings, |_| &[]).err().unwrap();
    assert!(error.contains("fifty"), "{error}");
}
#[test]
fn registered_scalar_csv_statuses_preserve_other_defined_reductions_and_groups() {
    let header = "participant_id,device_type,device_id,axis,window_id,sample_id,sample_order,value,input_unit,window_duration_seconds\n";
    let mut raw = header.to_owned();
    for i in 0..50 {
        raw.push_str(&format!("P,phone,D,x,w,s{i},{i},{},u,1\n", if i == 49 { "3e-162" } else { "0" }));
        raw.push_str(&format!("Q,watch,D,z,w,s{i},{i},2,v,1\n"));
    }
    let (_, bindings) = literature_component_execution_unit(STDD).unwrap();
    let result = adapt_literature_inputs(raw.as_bytes(), &sha256(raw.as_bytes()), &bindings, |_| &[]).unwrap().unwrap();
    assert_eq!(result.receipt.source_row_count, 100);
    assert_eq!(result.receipt.derived_result.as_ref().unwrap().row_count, 18);
    let text = String::from_utf8(result.derived_result_bytes.unwrap()).unwrap();
    assert!(text.contains("root_mean_square,,arithmetic_unavailable,floating_point_energy_underflow,input_unit"));
    assert!(text.contains("root_sum_square,") && text.contains("Q,watch,D,z,w,v,1,50,arithmetic_mean,2.0,computed,,input_unit"));
    let mut parsed = csv::Reader::from_reader(text.as_bytes());
    let rss = parsed.records().map(Result::unwrap)
        .find(|row| &row[0] == "P" && &row[8] == "root_sum_square").unwrap();
    assert_eq!(&rss[10], "computed");
    let rss_value = rss[9].parse::<f64>().unwrap();
    assert!(rss_value.is_finite() && rss_value > 0.0);
    let raw = format!("participant_id,attempt_id,sensor_stream,dimension,sample_id,sample_order,value,input_unit\nP,A,gyroscope,x,a,0,{},u\nP,A,gyroscope,x,b,1,{},u\nQ,A,gyroscope,x,a,0,2,v\n", f64::MAX, f64::MAX);
    let (_, bindings) = literature_component_execution_unit(TOUCH).unwrap();
    let result = adapt_literature_inputs(raw.as_bytes(), &sha256(raw.as_bytes()), &bindings, |_| &[]).unwrap().unwrap();
    let text = String::from_utf8(result.derived_result_bytes.unwrap()).unwrap();
    assert!(text.contains("P,A,gyroscope,x,u,2,arithmetic_mean,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"));
    assert!(text.contains("Q,A,gyroscope,x,v,1,arithmetic_mean,2.0,computed,,input_unit"));
}
