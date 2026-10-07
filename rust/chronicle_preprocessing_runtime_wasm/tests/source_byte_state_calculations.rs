use chronicle_preprocessing_runtime_wasm::source_byte_state_calculations::{
    capped_closed_screen_interval_end_ns, execute_source_byte_state_csv, uniform_allocated_bytes,
    ByteStateStage, FIRST_HOUR_NS, FIVE_MINUTES_NS,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/source_byte_state_hand_oracle.json")).unwrap()
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

fn run(component: &str, raw: &[u8]) -> (Value, BTreeMap<String, Vec<u8>>) {
    let request = RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest(b"source-byte-state-hand-workspace"),
        input_file_name: "qualified-byte-state-rows.csv".into(),
        input_sha256: digest(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: serde_json::from_value(json!({
            "study_name":"Source byte/state hand calculations", "timezone":"UTC",
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
    )
    .unwrap();
    let manifest = serde_json::from_str(&handle.manifest_json()).unwrap();
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    (manifest, artifacts)
}

#[test]
fn independent_csv_hand_oracle_and_existing_registered_minute_reducer_are_exact() {
    let f = fixture();
    for (index, stage) in [
        (0, ByteStateStage::UniformFiveMinuteAllocation),
        (1, ByteStateStage::CappedClosedScreenPacketGate),
    ] {
        let result = execute_source_byte_state_csv(input(index).as_bytes(), stage).unwrap();
        assert_eq!(
            result.csv_bytes,
            csv(&f["cases"][index]["expected_csv_lines"]).as_bytes()
        );
        assert_eq!(result.source_row_count, if index == 0 { 4 } else { 6 });
        assert_eq!(result.emitted_row_count, if index == 0 { 4 } else { 3 });
    }
    let gated = execute_source_byte_state_csv(
        input(1).as_bytes(),
        ByteStateStage::CappedClosedScreenPacketGate,
    )
    .unwrap();
    // This is the existing registered component, not a duplicate sum helper.
    let (_, second) = run(
        "chronicle.fixed-minute-packet-aggregation/v1",
        &gated.csv_bytes,
    );
    assert_eq!(
        second["literature-fixed-minute-packet-aggregation-csv"],
        csv(&f["cases"][1]["expected_minute_csv_lines"]).as_bytes()
    );
}

#[test]
fn independent_hand_math_runs_through_registered_adapters_and_source_receipts() {
    let f = fixture();
    for (index, stage, setting) in [
        (
            0,
            ByteStateStage::UniformFiveMinuteAllocation,
            "method-setting-9917decef70f8921d65f94e3",
        ),
        (
            1,
            ByteStateStage::CappedClosedScreenPacketGate,
            "method-setting-7427500edbceab9d67adc3c4",
        ),
    ] {
        let component = format!("{}/v1", stage.adapter_id());
        let (manifest, artifacts) = run(&component, input(index).as_bytes());
        let expected = csv(&f["cases"][index]["expected_csv_lines"]);
        assert_eq!(artifacts[stage.derived_result_kind()], expected.as_bytes());
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
            serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"])
                .unwrap();
        assert_eq!(method["settingIds"], json!([setting]));
        assert_eq!(execution["fullProfileExecutionStatus"], "blocked");
        assert_eq!(execution["kernelInputEligible"], false);
        assert_eq!(
            execution["derivedResultDigest"],
            digest(expected.as_bytes())
        );
        assert_eq!(
            execution["oracleId"],
            format!(
                "source-byte-state-hand-oracle-v1/{}",
                digest(include_bytes!(
                    "fixtures/source_byte_state_hand_oracle.json"
                ))
            )
        );
        assert!(method["limitations"].as_array().unwrap().len() >= 3);
    }
}

#[test]
fn first_hour_cap_gates_packets_before_the_existing_registered_minute_reduction() {
    let (_, first) = run(
        "chronicle.capped-closed-screen-packet-gate/v1",
        input(1).as_bytes(),
    );
    let gated = &first["literature-capped-closed-screen-gated-packets-csv"];
    let (manifest, second) = run("chronicle.fixed-minute-packet-aggregation/v1", gated);
    assert_eq!(manifest["sourceRowCount"], 3);
    assert_eq!(
        second["literature-fixed-minute-packet-aggregation-csv"],
        csv(&fixture()["cases"][1]["expected_minute_csv_lines"]).as_bytes()
    );
    let method: Value =
        serde_json::from_slice(&second["literature-component-method-receipt-json"]).unwrap();
    assert!(method["settingIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "method-setting-f1d211a95b06d1e27ad2b262"));
}

#[test]
fn full_integer_domain_fractional_bytes_and_59_60_61_minute_caps_are_exact() {
    assert_eq!(
        uniform_allocated_bytes(1, 1, FIVE_MINUTES_NS).unwrap(),
        (1, 300_000_000_000)
    );
    assert_eq!(
        uniform_allocated_bytes(u64::MAX, FIVE_MINUTES_NS, FIVE_MINUTES_NS).unwrap(),
        (u128::from(u64::MAX) * 300_000_000_000, 300_000_000_000)
    );
    assert_eq!(
        uniform_allocated_bytes(0, 0, FIVE_MINUTES_NS).unwrap(),
        (0, 300_000_000_000)
    );
    assert!(uniform_allocated_bytes(1, 1, 0).is_err());
    assert!(uniform_allocated_bytes(1, -1, FIVE_MINUTES_NS).is_err());
    for (duration, expected) in [(59, 59), (60, 60), (61, 60)] {
        assert_eq!(
            capped_closed_screen_interval_end_ns(-101, -101 + duration * 60_000_000_000).unwrap(),
            -101 + expected * 60_000_000_000
        );
    }
    assert_eq!(
        capped_closed_screen_interval_end_ns(i64::MIN, i64::MAX).unwrap(),
        i64::try_from(i128::from(i64::MIN) + FIRST_HOUR_NS).unwrap()
    );
    assert_eq!(capped_closed_screen_interval_end_ns(20, 20).unwrap(), 20);
    assert!(capped_closed_screen_interval_end_ns(21, 20).is_err());
}

fn edited(index: usize, row: usize, field: &str, value: &str) -> Vec<u8> {
    let raw = input(index);
    let mut reader = csv::Reader::from_reader(raw.as_bytes());
    let headers = reader.headers().unwrap().clone();
    let column = headers.iter().position(|h| h == field).unwrap();
    let records = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&headers).unwrap();
    for (i, r) in records.iter().enumerate() {
        writer
            .write_record(
                r.iter()
                    .enumerate()
                    .map(|(j, s)| if i == row && j == column { value } else { s }),
            )
            .unwrap();
    }
    writer.into_inner().unwrap()
}

#[test]
fn allocation_rejects_unresolved_counters_incomplete_or_changed_windows_and_bad_units() {
    for (row, field, value) in [
        (0, "counter_status", "raw_cumulative_counter"),
        (0, "poll_end_source_row_id", ""),
        (0, "poll_end_source_row_id", "pA0"),
        (0, "window_bytes", "-1"),
        (0, "window_bytes", "18446744073709551616"),
        (0, "timestamp_unit", "seconds"),
        (0, "byte_unit", "KB"),
        (0, "timestamp_precision_ns", "0"),
        (0, "network_technology", "GPRS"),
        (0, "rssi_dbm", "NaN"),
        (0, "screen_state", "unknown"),
        (0, "source_stream_role", "raw_state_callbacks"),
        (0, "state_start_timestamp_ns", "1"),
        (2, "state_start_timestamp_ns", "100000000001"),
        (2, "state_end_timestamp_ns", "299999999999"),
        (2, "window_bytes", "10"),
        (2, "clock_id", "other"),
        (2, "source_device_id", "other"),
        (2, "source_stream_id", "other"),
        (2, "source_row_id", "a1"),
        (1, "source_device_id", "dA"),
    ] {
        assert!(
            execute_source_byte_state_csv(
                &edited(0, row, field, value),
                ByteStateStage::UniformFiveMinuteAllocation
            )
            .is_err(),
            "{field}={value}"
        );
    }
}

#[test]
fn gate_rejects_missing_closed_endpoints_wrong_entities_metadata_and_packet_order() {
    for (row, field, value) in [
        (0, "screen_off_source_row_id", ""),
        (0, "screen_off_source_row_id", "onA"),
        (0, "screen_off_timestamp_ns", ""),
        (0, "screen_off_timestamp_ns", "-1"),
        (0, "packet_endpoint_policy", ""),
        (0, "phone_key", "other"),
        (0, "destination_address", "phoneA"),
        (0, "payload_bytes", "-1"),
        (0, "timestamp_unit", "milliseconds"),
        (0, "byte_unit", "KiB"),
        (0, "source_stream_role", "raw_screen_callbacks"),
        (2, "clock_id", "other"),
        (2, "source_device_id", "other"),
        (2, "source_stream_id", "other"),
        (2, "timestamp_ns", "-1"),
        (2, "screen_off_timestamp_ns", "5400000000001"),
        (2, "source_row_id", "a0"),
        (0, "timestamp_ns", "0.1"),
    ] {
        assert!(
            execute_source_byte_state_csv(
                &edited(1, row, field, value),
                ByteStateStage::CappedClosedScreenPacketGate
            )
            .is_err(),
            "{field}={value}"
        );
    }
}

#[test]
fn packet_endpoint_equality_is_an_explicit_caller_convention_not_a_source_default() {
    let closed = input(1).replace("left_closed_right_open", "left_closed_right_closed");
    let output = execute_source_byte_state_csv(
        closed.as_bytes(),
        ByteStateStage::CappedClosedScreenPacketGate,
    )
    .unwrap();
    assert_eq!(output.emitted_row_count, 5);
    assert!(String::from_utf8(output.csv_bytes)
        .unwrap()
        .contains("caller endpoint equality,3600000000000,3600000000000"));
    // Changes in declared precision do not modify exact endpoint arithmetic.
    assert!(execute_source_byte_state_csv(
        &edited(1, 2, "timestamp_precision_ns", "999"),
        ByteStateStage::CappedClosedScreenPacketGate
    )
    .is_ok());
}

#[test]
fn contract_oracle_and_two_exact_new_atom_owners_are_pinned() {
    let contract: Value = serde_json::from_str(include_str!(concat!(
        env!("CHRONICLE_REPOSITORY_ROOT"),
        "/web/schema/literature-input-adapter-contract.json"
    )))
    .unwrap();
    let oracle = format!(
        "source-byte-state-hand-oracle-v1/{}",
        digest(include_bytes!(
            "fixtures/source_byte_state_hand_oracle.json"
        ))
    );
    for (adapter, id) in [
        (
            "chronicle.uniform-five-minute-byte-allocation",
            "method-setting-9917decef70f8921d65f94e3",
        ),
        (
            "chronicle.capped-closed-screen-packet-gate",
            "method-setting-7427500edbceab9d67adc3c4",
        ),
    ] {
        let owners = contract["groups"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|g| {
                g["methodSettingIds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|s| s == id)
            })
            .collect::<Vec<_>>();
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0]["adapterId"], adapter);
        assert_eq!(owners[0]["methodSettingIds"], json!([id]));
        assert_eq!(owners[0]["componentExecution"]["sourceOracleId"], oracle);
        assert_eq!(
            owners[0]["componentExecution"]["fullProfileExecutionStatus"],
            "blocked"
        );
    }
    assert!(!contract["groups"]
        .as_array()
        .unwrap()
        .iter()
        .any(|g| g["methodSettingIds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|id| id == "method-setting-7ce61f09839d039da32ba96a")));
}
