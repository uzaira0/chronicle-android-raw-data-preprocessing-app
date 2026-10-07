use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/supplied_learning_session_net_duration_hand_oracle.json"
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
        workspace_id: digest(b"supplied-learning-session-net-duration-hand-workspace"),
        input_file_name: "qualified-learning-session-duration-rows.csv".into(),
        input_sha256: digest(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"Source learning-session net duration", "timezone":"UTC",
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

fn verify(index: usize, kind: &str) {
    let f = fixture();
    let component = f["cases"][index]["component"].as_str().unwrap();
    let (manifest, artifacts) = run(component, input(index).as_bytes()).unwrap();
    let expected = csv(&f["cases"][index]["expected_csv_lines"]);
    assert_eq!(artifacts[kind], expected.as_bytes());
    assert_eq!(
        manifest["sourceRowCount"],
        f["cases"][index]["raw_csv_lines"].as_array().unwrap().len() - 1
    );
    assert_eq!(
        manifest["derivedResultRowCount"],
        f["cases"][index]["expected_csv_lines"]
            .as_array()
            .unwrap()
            .len()
            - 1
    );
    let method: Value =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: Value =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    assert_eq!(method["settingIds"], json!([f["cases"][index]["setting"]]));
    assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
    assert_eq!(execution["kernelInputEligible"], false);
    assert_eq!(
        execution["derivedResultDigest"],
        digest(expected.as_bytes())
    );
    assert_eq!(
        execution["oracleId"],
        format!(
            "supplied-learning-session-net-duration-hand-oracle-v1/{}",
            digest(include_bytes!(
                "fixtures/supplied_learning_session_net_duration_hand_oracle.json"
            ))
        )
    );
    assert!(method["limitations"].as_array().unwrap().len() >= 3);
}
#[test]
fn registered_learning_net_duration_matches_independent_hand_oracle_and_receipts() {
    verify(0, "literature-supplied-learning-session-net-duration-csv");
}

fn qualified_declarations(rows: &[(&str, &str, &str)]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "source_row_id",
            "participant_id",
            "source_device_id",
            "source_stream_id",
            "source_platform",
            "learning_session_id",
            "learning_app_id",
            "gross_duration_seconds",
            "duration_unit",
            "input_stage",
            "interruption_inventory_stage",
            "suspending_interruptions_json",
        ])
        .unwrap();
    for (id, gross, inventory) in rows {
        writer
            .write_record([
                *id,
                "A",
                "dA",
                "streamA",
                "Android",
                "s",
                "app",
                *gross,
                "s",
                "caller-qualified-complete-gross-learning-session",
                "caller-qualified-complete-disjoint-suspending-durations",
                *inventory,
            ])
            .unwrap();
    }
    writer.into_inner().unwrap()
}
#[test]
fn registered_known_cross_declaration_excess_is_refused_without_imputation() {
    let first = r#"[{"interruption_id":"i1","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":8},{"interruption_id":"i2","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":null}]"#;
    let second = r#"[{"interruption_id":"i1","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":null},{"interruption_id":"i2","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":8}]"#;
    let twenty = r#"[{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20}]"#;
    for rows in [
        vec![("r1", "10", first), ("r2", "10", second)],
        vec![("r2", "10", second), ("r1", "10", first)],
        vec![("r1", "10", ""), ("r2", "", twenty)],
        vec![("r2", "", twenty), ("r1", "10", "")],
    ] {
        assert!(run(
            "chronicle.supplied-learning-session-net-duration/v1",
            &qualified_declarations(&rows)
        )
        .is_err());
    }
    let (_, artifacts) = run(
        "chronicle.supplied-learning-session-net-duration/v1",
        &qualified_declarations(&[("r1", "20", first), ("r2", "20", second)]),
    )
    .unwrap();
    let output = &artifacts["literature-supplied-learning-session-net-duration-csv"];
    let mut reader = csv::Reader::from_reader(output.as_slice());
    let headers = reader.headers().unwrap().clone();
    let net = headers
        .iter()
        .position(|h| h == "net_duration_seconds")
        .unwrap();
    let status = headers
        .iter()
        .position(|h| h == "net_duration_status")
        .unwrap();
    for record in reader.records() {
        let record = record.unwrap();
        assert_eq!(&record[net], "");
        assert_eq!(&record[status], "unavailable:missing_interruption_duration");
    }
}
#[test]
fn registered_duplicate_critical_keys_are_refused() {
    for entry in [
        r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20,"duration_seconds":0}"#,
        r#"{"interruption_id":"i","learning_session_id":"foreign","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0}"#,
        r#"{"interruption_id":"i","learning_session_id":"s","kind":"terminating","kind":"admitted_suspending","duration_seconds":0}"#,
        r#"{"interruption_id":"foreign","interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0}"#,
        r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":0,"duration_seconds":0}"#,
        r#"{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":20,"duration_\u0073econds":0}"#,
    ] {
        assert!(run(
            "chronicle.supplied-learning-session-net-duration/v1",
            &qualified_declarations(&[("r", "10", &format!("[{entry}]"))])
        )
        .is_err());
    }
}
#[test]
fn registered_negative_nonzero_underflow_is_refused_and_genuine_zero_survives() {
    for scalar in ["-1e-400", "-0.0001E-999", "-1e-9999"] {
        assert!(run(
            "chronicle.supplied-learning-session-net-duration/v1",
            &qualified_declarations(&[("r", scalar, "[]")])
        )
        .is_err());
        for encoded in [scalar.to_owned(), serde_json::to_string(scalar).unwrap()] {
            let inventory = format!(
                r#"[{{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":{encoded}}}]"#
            );
            assert!(run(
                "chronicle.supplied-learning-session-net-duration/v1",
                &qualified_declarations(&[("r", "10", &inventory)])
            )
            .is_err());
        }
    }
    for scalar in ["-0", "-0.000e-400", "0", "0.000e-400"] {
        assert!(run(
            "chronicle.supplied-learning-session-net-duration/v1",
            &qualified_declarations(&[("r", scalar, "[]")])
        )
        .is_ok());
        for encoded in [scalar.to_owned(), serde_json::to_string(scalar).unwrap()] {
            let inventory = format!(
                r#"[{{"interruption_id":"i","learning_session_id":"s","kind":"admitted_suspending","duration_seconds":{encoded}}}]"#
            );
            let (_, artifacts) = run(
                "chronicle.supplied-learning-session-net-duration/v1",
                &qualified_declarations(&[("r", "10", &inventory)]),
            )
            .unwrap();
            let output = &artifacts["literature-supplied-learning-session-net-duration-csv"];
            let mut reader = csv::Reader::from_reader(output.as_slice());
            let headers = reader.headers().unwrap().clone();
            let column = headers
                .iter()
                .position(|h| h == "net_duration_seconds")
                .unwrap();
            assert_eq!(&reader.records().next().unwrap().unwrap()[column], "10");
        }
    }
}
