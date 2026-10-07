use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/supplied_android_followon_hand_oracle.json"
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
        workspace_id: digest(b"supplied-android-followon-hand-workspace"),
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

fn hand_equal(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!((a - b).abs() <= 1e-13 * b.abs().max(1.0), "{a} != {b}");
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                hand_equal(a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
            for (k, b) in b {
                hand_equal(&a[k], b);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}
type ComponentOutput = (Value, Vec<Value>, BTreeMap<String, Vec<u8>>);

fn output(
    component: &str,
    raw: &[u8],
) -> Result<ComponentOutput, String> {
    let (manifest, artifacts) = run(component, raw)?;
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
    let rows = reader
        .records()
        .map(|r| serde_json::from_str::<Value>(&r.unwrap()[c]).unwrap())
        .collect();
    Ok((manifest, rows, artifacts))
}
fn assert_followon_hand_receipts(added_at_final_admission: bool) {
    let f = fixture();
    let mut owners = 0;
    for (i, case) in f["cases"].as_array().unwrap().iter().enumerate() {
        let component = case["component"].as_str().unwrap();
        if admitted_later(component) != added_at_final_admission {
            continue;
        }
        let raw = input(i);
        let (manifest, rows, artifacts) = output(component, raw.as_bytes()).unwrap();
        assert_eq!(rows.len(), 1);
        hand_equal(&rows[0], &case["expected_result_json"]);
        assert_eq!(manifest["sourceRowCount"], 1);
        assert_eq!(manifest["derivedResultRowCount"], 1);
        let method: Value =
            serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
        let execution: Value =
            serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"])
                .unwrap();
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
        owners += expected.len();
        assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
        assert_eq!(execution["kernelInputEligible"], false);
        let kind = format!(
            "literature-{}-csv",
            component
                .strip_prefix("chronicle.")
                .unwrap()
                .strip_suffix("/v1")
                .unwrap()
        );
        assert_eq!(execution["derivedResultDigest"], digest(&artifacts[&kind]));
        assert_eq!(
            execution["oracleId"],
            format!(
                "supplied-android-followon-hand-oracle-v1/{}",
                digest(include_bytes!(
                    "fixtures/supplied_android_followon_hand_oracle.json"
                ))
            )
        );
        assert!(method["limitations"].as_array().unwrap().len() >= 2);
    }
    assert_eq!(owners, if added_at_final_admission { 5 } else { 10 });
}
#[test]
fn ordinary_followon_existing_ten_owners_and_hand_receipts() {
    assert_followon_hand_receipts(false);
}
#[test]
fn ordinary_followon_source_boundary_table() {
    let table: Value = serde_json::from_str(include_str!(
        "fixtures/supplied_android_followon_boundary_cases.json"
    ))
    .unwrap();
    let mut unexpected_refusals = Vec::new();
    for case in table["cases"].as_array().unwrap() {
        let raw = csv(&case["raw_csv_lines"]);
        let component = case["component"].as_str().unwrap();
        let result = output(component, raw.as_bytes());
        let name = case["name"].as_str().unwrap();
        if case["expected_refusal"] == true {
            assert!(result.is_err(), "{name}: accepted");
            continue;
        }
        let (_, rows, _) = match result {
            Ok(out) => out,
            Err(e) => {
                unexpected_refusals.push(format!("{name}: {e}"));
                continue;
            }
        };
        for expected in case["expected_values"].as_array().unwrap() {
            hand_equal(
                rows[expected["row"].as_u64().unwrap() as usize]
                    .pointer(expected["pointer"].as_str().unwrap())
                    .unwrap(),
                &expected["value"],
            );
        }
    }
    assert!(
        unexpected_refusals.is_empty(),
        "{}",
        unexpected_refusals.join("\n")
    );
}

fn admitted_later(component: &str) -> bool {
    [
        "chronicle.sarsen-supplied-hour-launch-count/v1",
        "chronicle.sarsen-supplied-hour-duration-total/v1",
        "chronicle.finesse-supplied-session-feature-fraction/v1",
        "chronicle.hush-supplied-beta-sensitivity/v1",
        "chronicle.hush-supplied-alpha-sensitivity/v1",
    ]
    .contains(&component)
}
#[test]
fn ordinary_followon_five_admitted_owners_and_hand_receipts() {
    assert_followon_hand_receipts(true);
}
