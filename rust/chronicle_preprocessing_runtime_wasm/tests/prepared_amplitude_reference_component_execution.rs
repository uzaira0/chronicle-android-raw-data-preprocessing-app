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

const COMPONENTS: [&str; 7] = [
    "chronicle.ruegger-prepared-amplitude/v1",
    "chronicle.ruegger-released-prefix/v1",
    "chronicle.pastime-prepared-clipping/v1",
    "chronicle.pastime-prepared-within/v1",
    "chronicle.pastime-prepared-between/v1",
    "chronicle.fukazawa-prepared-zscore/v1",
    "chronicle.fukazawa-prepared-conjunction/v1",
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
        "study_name":"Prepared amplitude/reference source fixtures", "timezone":"Pacific/Kiritimati",
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
public_test!(registered_ruegger_base_receipt_export, 0);
public_test!(registered_ruegger_released_prefix_receipt_export, 1);
public_test!(registered_pastime_usage_clipping_receipt_export, 2);
public_test!(registered_pastime_within_receipt_export, 3);
public_test!(registered_pastime_between_receipt_export, 4);
public_test!(registered_fukazawa_zscore_receipt_export, 5);
public_test!(registered_fukazawa_pointwise_receipt_export, 6);

#[test]
fn all_exact_registered_adapters_preserve_source_tuples_and_emit_actual_csv() {
    for component in COMPONENTS {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        let fixture = cases(component);
        let raw = raw(&fixture[0]);
        let adapted = adapt_literature_inputs(&raw, &digest(&raw), &bindings, |_| &[])
            .unwrap()
            .unwrap();
        assert_eq!(
            adapted.receipt.source_row_count,
            fixture[0]["expected"]["sourceRowCount"].as_u64().unwrap() as u32
        );
        let derived = adapted.derived_result_bytes.unwrap();
        let text = std::str::from_utf8(&derived).unwrap();
        for case in &fixture {
            for expected in case["expected"]["derivedOutputContains"]
                .as_array()
                .unwrap()
            {
                assert!(
                    text.contains(expected.as_str().unwrap()),
                    "{component}: {text}"
                );
            }
        }
        assert_eq!(
            adapted.receipt.derived_result.as_ref().unwrap().kind,
            registration.derived_result_kind
        );
        assert_eq!(
            adapted.receipt.derived_result.as_ref().unwrap().digest,
            digest(&derived)
        );
        assert!(!chronicle_preprocessing_runtime_wasm::literature_input_adapters::receipt_is_kernel_input_eligible(&adapted.receipt));
        assert_eq!(registration.full_profile_execution_status, "blocked");
    }
}

#[test]
fn registered_refusals_keep_missing_members_refs_lexical_units_and_source_tuple_guard() {
    for component in COMPONENTS {
        let (_, bindings) = literature_component_execution_unit(component).unwrap();
        let fixture = cases(component);
        let bytes = raw(&fixture[0]);
        let text = std::str::from_utf8(&bytes).unwrap();
        let unqualified = text.replace("android,true", "android,false");
        assert!(adapt_literature_inputs(
            unqualified.as_bytes(),
            &digest(unqualified.as_bytes()),
            &bindings,
            |_| &[]
        )
        .is_err());
        let nonandroid = text.replace("android", "ios");
        assert!(adapt_literature_inputs(
            nonandroid.as_bytes(),
            &digest(nonandroid.as_bytes()),
            &bindings,
            |_| &[]
        )
        .is_err());
        let mut forged = bindings.clone();
        forged[0].source_value = json!("forged");
        assert!(
            adapt_literature_inputs(&bytes, &digest(&bytes), &forged, |_| &[])
                .err()
                .unwrap()
                .contains("registered conformance tuple")
        );
        let mut forged = bindings.clone();
        forged[0].conformance_result_digest = format!("sha256:{}", "f".repeat(64));
        assert!(adapt_literature_inputs(&bytes, &digest(&bytes), &forged, |_| &[]).is_err());
    }
    let (_, bindings) = literature_component_execution_unit(COMPONENTS[2]).unwrap();
    let bytes = raw(&cases(COMPONENTS[2])[0]);
    let conflicting = std::str::from_utf8(&bytes).unwrap().replace(
        "b,1,4,seconds,android,true,R,S,10,2",
        "b,1,4,minutes,android,true,R,S,10,2",
    );
    assert!(adapt_literature_inputs(
        conflicting.as_bytes(),
        &digest(conflicting.as_bytes()),
        &bindings,
        |_| &[]
    )
    .is_err());
    let (_, prefix) = literature_component_execution_unit(COMPONENTS[1]).unwrap();
    let bytes = raw(&cases(COMPONENTS[1])[0]);
    let missing = std::str::from_utf8(&bytes)
        .unwrap()
        .replace("source_NaN", "");
    assert!(adapt_literature_inputs(
        missing.as_bytes(),
        &digest(missing.as_bytes()),
        &prefix,
        |_| &[]
    )
    .is_err());
    let (_, conjunction) = literature_component_execution_unit(COMPONENTS[6]).unwrap();
    let bytes = raw(&cases(COMPONENTS[6])[0]);
    let mismatch = std::str::from_utf8(&bytes)
        .unwrap()
        .replace("true,true,true", "true,false,true");
    assert!(adapt_literature_inputs(
        mismatch.as_bytes(),
        &digest(mismatch.as_bytes()),
        &conjunction,
        |_| &[]
    )
    .is_err());
}
