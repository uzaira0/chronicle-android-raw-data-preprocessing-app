use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/supplied_android_behavior_metrics_hand_oracle.json"
    ))
    .unwrap()
}
fn csv(lines: &Value) -> String {
    lines
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}
fn input(index: usize) -> String {
    csv(&fixture()["cases"][index]["raw_csv_lines"])
}
fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn run(component: &str, raw: &[u8]) -> Result<(Value, BTreeMap<String, Vec<u8>>), String> {
    let request = RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(b"supplied-android-behavior-metrics-hand-workspace"),
        input_file_name: "qualified-android-behavior-manifests.csv".into(),
        input_sha256: digest(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"Source Android behavior metrics", "timezone":"UTC",
            "usage_session_mode":"app_usage", "include_app_output":true,
            "include_screen_output":false, "use_filter_file":false,
            "use_apps_forcing_screen_open":false, "use_app_codebook":false,
            "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
            "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
            "long_duration_threshold_ns":43_200_000_000_000_i64,
            "custom_app_engagement_duration":300.0,
            "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
            "same_app_stop_types":["Activity Paused","Activity Resumed"],
            "other_stop_types":["Activity Resumed","Device Shutdown"],
            "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
            "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
            "screen_keyguard_near_stop_seconds":2.0,
            "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
        }))
        .unwrap(),
    };
    let mut handle = execute_literature_component_native(
        component,
        &serde_json::to_string(&request).unwrap(),
        raw,
        &RuntimeSupportFiles::default(),
    )?;
    let manifest = serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    Ok((manifest, artifacts))
}

fn verify(index: usize) {
    let f = fixture();
    let case = &f["cases"][index];
    let component = case["component"].as_str().unwrap();
    let (manifest, artifacts) = run(component, input(index).as_bytes()).unwrap();
    let kind = format!(
        "literature-{}-csv",
        component
            .strip_prefix("chronicle.")
            .unwrap()
            .strip_suffix("/v1")
            .unwrap()
    );
    let out = &artifacts[&kind];
    let mut reader = csv::Reader::from_reader(out.as_slice());
    let h = reader.headers().unwrap().clone();
    let c = h
        .iter()
        .position(|h| h == "supplied_calculation_json")
        .unwrap();
    let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        serde_json::from_str::<Value>(&rows[0][c]).unwrap(),
        case["expected_result_json"]
    );
    assert_eq!(manifest["sourceRowCount"], 1);
    assert_eq!(manifest["derivedResultRowCount"], 1);
    let method: Value =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: Value =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    let mut actual = method["settingIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect::<Vec<_>>();
    let mut expected = case["method_setting_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect::<Vec<_>>();
    actual.sort();
    expected.sort();
    assert_eq!(actual, expected);
    assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
    assert_eq!(execution["kernelInputEligible"], false);
    assert_eq!(execution["derivedResultDigest"], digest(out));
    assert_eq!(
        execution["oracleId"],
        format!(
            "supplied-android-behavior-hand-oracle-v1/{}",
            digest(include_bytes!(
                "fixtures/supplied_android_behavior_metrics_hand_oracle.json"
            ))
        )
    );
    assert!(method["limitations"].as_array().unwrap().len() >= 2);
}
#[test]
fn ordinary_hush_bfc_hand_oracle_and_receipts() {
    verify(0);
}
#[test]
fn ordinary_hush_minimum_mean_hand_oracle_and_receipts() {
    verify(1);
}
#[test]
fn ordinary_jones_backtracking_hand_oracle_and_receipts() {
    verify(2);
}
#[test]
fn ordinary_jones_same_app_return_hand_oracle_and_receipts() {
    verify(3);
}
#[test]
fn ordinary_cognitive_phone_hour_hand_oracle_and_receipts() {
    verify(4);
}
#[test]
fn ordinary_rodrigues_named_typing_means_hand_oracle_and_receipts() {
    verify(5);
}

#[test]
fn reviewed_boundary_table_ordinary_public_route() {
    let table: Value = serde_json::from_str(include_str!(
        "fixtures/supplied_android_behavior_boundary_cases.json"
    ))
    .unwrap();
    let f = fixture();
    let mut failures = Vec::new();
    for case in table["cases"].as_array().unwrap() {
        let index = case["stage_index"].as_u64().unwrap() as usize;
        let component = f["cases"][index]["component"].as_str().unwrap();
        let raw = csv(&case["raw_csv_lines"]);
        let calculated = run(component, raw.as_bytes());
        let name = case["name"].as_str().unwrap();
        if case["expected_refusal"] == true {
            if calculated.is_ok() {
                failures.push(format!("{name}: contradictory input accepted"));
            }
            continue;
        }
        let (manifest, artifacts) = match calculated {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("{name}: valid input refused: {error}"));
                continue;
            }
        };
        let kind = format!(
            "literature-{}-csv",
            component
                .strip_prefix("chronicle.")
                .unwrap()
                .strip_suffix("/v1")
                .unwrap()
        );
        let out = &artifacts[&kind];
        let mut original = csv::Reader::from_reader(raw.as_bytes());
        let original_rows = original.records().collect::<Result<Vec<_>, _>>().unwrap();
        let mut reader = csv::Reader::from_reader(out.as_slice());
        let h = reader.headers().unwrap().clone();
        let col = h
            .iter()
            .position(|h| h == "supplied_calculation_json")
            .unwrap();
        let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(rows.len(), original_rows.len(), "{name}: row count");
        assert_eq!(manifest["sourceRowCount"], rows.len());
        assert_eq!(manifest["derivedResultRowCount"], rows.len());
        let execution: Value =
            serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"])
                .unwrap();
        assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
        assert_eq!(execution["kernelInputEligible"], false);
        assert_eq!(execution["derivedResultDigest"], digest(out));
        for (i, row) in rows.iter().enumerate() {
            assert_eq!(
                row.iter().take(original_rows[i].len()).collect::<Vec<_>>(),
                original_rows[i].iter().collect::<Vec<_>>(),
                "{name}: literal input preservation"
            );
            let result: Value = serde_json::from_str(&row[col]).unwrap();
            for (field, expected) in case["expected_fields_per_row"][i].as_object().unwrap() {
                let actual = &result[field];
                let same = if actual.is_number() && expected.is_number() {
                    actual.as_f64() == expected.as_f64()
                } else {
                    actual == expected
                };
                if !same {
                    failures.push(format!(
                        "{name}: row{i} {field} expected{expected} actual{actual}"
                    ));
                }
            }
        }
    }
    assert_eq!(failures, Vec::<String>::new());
}
