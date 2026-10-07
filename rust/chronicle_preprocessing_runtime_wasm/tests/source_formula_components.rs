//! Independent hand-calculated typed fixtures, not author code or participant data.
//! BatteryLogger primary physical pp6-7, Eq4/6/10; SHA256
//! 98ce983b218b401d2538af7f9ee0d7926192e89dfa723562f069cb219e2c3fe1.
//! V is TOTAL capacity (primary text lines451-455), not voltage or remaining charge.
//! Attelia II primary physical p6, Table2/Physical Activity-based Breakpoint Detection;
//! SHA256 580808e476420a02e49291cfb3b3c2d1a168000842c663e11daf49bb71406c58.
//! Back to the App primary physical p2, Measuring Interruptions/Fig2, Table3 seconds;
//! SHA256 1e6266084397d91b9401781431b279d6ae969012d858a90f3c84a6d1ba737c01.

use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};

const BATTERY: &str = "chronicle.batterylogger-weighted-estimate/v1";
const ATTELIA: &str = "chronicle.attelia-activity-transition-lookup/v1";
const BACKAPP: &str = "chronicle.backapp-runtime-arithmetic/v1";

fn csv(headers: &[&str], records: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(headers).unwrap();
    for record in records {
        writer.write_record(record).unwrap();
    }
    writer.into_inner().unwrap()
}

fn adapt(component: &str, raw: &[u8]) -> Result<Vec<u8>, String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(bindings.len(), if component == ATTELIA { 1 } else { 2 });
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let adapted =
        adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?.ok_or("missing adaptation")?;
    assert_eq!(adapted.receipt.original_input_digest, digest);
    assert_eq!(adapted.receipt.duplicate_source_ids_removed, 0);
    assert_eq!(adapted.receipt.materialized_interval_count, 0);
    let bytes = adapted
        .derived_result_bytes
        .ok_or("missing derived output")?;
    assert_eq!(
        adapted.receipt.adapted_input_digest,
        format!("sha256:{}", hex::encode(Sha256::digest(&bytes)))
    );
    Ok(bytes)
}

fn records(bytes: &[u8]) -> Vec<csv::StringRecord> {
    csv::Reader::from_reader(bytes)
        .records()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

fn battery(
    p: &str,
    b: &str,
    v: &str,
    role: &str,
    capacity_unit: &str,
    rate_unit: &str,
    time_unit: &str,
) -> Vec<u8> {
    csv(
        &[
            "source_row_id",
            "p",
            "B",
            "V",
            "capacity_role",
            "capacity_unit",
            "rate_capacity_unit",
            "time_unit",
        ],
        &[vec![
            "estimate".into(),
            p.into(),
            b.into(),
            v.into(),
            role.into(),
            capacity_unit.into(),
            rate_unit.into(),
            time_unit.into(),
        ]],
    )
}

#[test]
fn batterylogger_five_state_hand_oracle_keeps_units_and_total_capacity_meaning() {
    // Supplied coherent mAh/hour rates and total capacity: products=[1,1,1,1,2],
    // U=6mAh/hour, total V=1200mAh => T=200hours. No paper unit is inferred.
    let raw = battery(
        "[0.5,0.25,0.125,0.0625,0.0625]",
        "[2,4,8,16,32]",
        "1200",
        "total-battery-capacity",
        "mAh",
        "mAh",
        "hour",
    );
    let output = records(&adapt(BATTERY, &raw).unwrap());
    assert_eq!(&output[0][8], "[1.0,1.0,1.0,1.0,2.0]");
    assert_eq!(
        (&output[0][3], &output[0][4], &output[0][5], &output[0][7]),
        ("1200", "total-battery-capacity", "mAh", "hour")
    );
    assert_eq!(
        (
            &output[0][9],
            &output[0][10],
            &output[0][11],
            &output[0][12]
        ),
        (
            "6",
            "200",
            "defined",
            "source-formula-estimate-not-observation"
        )
    );
}

#[test]
fn batterylogger_zero_weights_zero_rate_and_binary_arithmetic_boundary() {
    let raw = battery(
        "[1,0,0,0,0]",
        "[2,100,100,100,100]",
        "10",
        "total-battery-capacity",
        "unit",
        "unit",
        "second",
    );
    let output = records(&adapt(BATTERY, &raw).unwrap());
    assert_eq!((&output[0][9], &output[0][10]), ("2", "5"));
    let zero = battery(
        "[1,0,0,0,0]",
        "[0,0,0,0,0]",
        "10",
        "total-battery-capacity",
        "unit",
        "unit",
        "second",
    );
    let output = records(&adapt(BATTERY, &zero).unwrap());
    assert_eq!(
        (&output[0][9], &output[0][10], &output[0][11]),
        ("0", "", "undefined-zero-rate")
    );
    // This mathematically unit-sum row can round just below one in binary64.
    assert!(adapt(
        BATTERY,
        &battery(
            "[0.7,0.1,0.1,0.1,0]",
            "[1,1,1,1,1]",
            "1",
            "total-battery-capacity",
            "unit",
            "unit",
            "second"
        )
    )
    .is_ok());
}

#[test]
fn batterylogger_refuses_invalid_probability_capacity_unit_and_nonfinite_operands() {
    for (p, b, v) in [
        ("[1,0,0,0]", "[1,1,1,1,1]", "1"),
        ("[1,1,0,0,0]", "[1,1,1,1,1]", "1"),
        ("[-1,1,1,0,0]", "[1,1,1,1,1]", "1"),
        ("[1,0,0,0,0]", "[1,-1,1,1,1]", "1"),
        ("[1,0,0,0,0]", "[null,1,1,1,1]", "1"),
        ("[1,0,0,0,0]", "[1,1,1,1,1]", "NaN"),
        ("[1,0,0,0,0]", "[1,1,1,1,1]", "-1"),
        // Printed User12 fractions sum1.00001: do not invent normalization.
        (
            "[0.94504,0.00527,0.01345,0.01622,0.02003]",
            "[0.048,0.252,0.300,0.132,0.271]",
            "100",
        ),
    ] {
        assert!(adapt(
            BATTERY,
            &battery(p, b, v, "total-battery-capacity", "unit", "unit", "second")
        )
        .is_err());
    }
    for (role, capacity_unit, rate_unit, time_unit) in [
        ("remaining-charge", "unit", "unit", "second"),
        ("voltage", "unit", "unit", "second"),
        ("total-battery-capacity", "mAh", "percent", "second"),
        ("total-battery-capacity", "unit", "unit", ""),
    ] {
        assert!(adapt(
            BATTERY,
            &battery(
                "[1,0,0,0,0]",
                "[1,1,1,1,1]",
                "1",
                role,
                capacity_unit,
                rate_unit,
                time_unit
            )
        )
        .is_err());
    }
    assert!(adapt(
        BATTERY,
        &battery(
            "[1e-300,1,0,0,0]",
            "[1e-300,0,0,0,0]",
            "1",
            "total-battery-capacity",
            "unit",
            "unit",
            "second"
        )
    )
    .unwrap_err()
    .contains("underflows"));
}

#[test]
fn attelia_source_direction_strict_five_and_blank_diagonal_are_distinct() {
    let raw = b"source_row_id,from_activity,to_activity\nequality,walking,running\nreverse,running,walking\nknown,still,running\nblank,walking,walking\n";
    let output = records(&adapt(ATTELIA, raw).unwrap());
    assert_eq!(
        (&output[0][3], &output[0][4], &output[0][5]),
        ("5", "2.9", "false")
    );
    assert_eq!(
        (&output[1][3], &output[1][4], &output[1][5]),
        ("8.2", "1.4", "true")
    );
    assert_eq!((&output[2][3], &output[2][5]), ("5.1", "true"));
    assert_eq!(
        (&output[3][3], &output[3][4], &output[3][5], &output[3][6]),
        ("", "", "", "unreported-diagonal")
    );
}

#[test]
fn attelia_complete_table_matches_independent_transcription_without_label_translation() {
    let axis = ["onbike", "running", "walking", "working", "still"];
    // Hand-transcribed Table2 cells, with source threshold decisions written explicitly.
    let table = [
        [
            None,
            Some((4.7, 3.1, false)),
            Some((6.8, 2.5, true)),
            Some((4.9, 3.4, false)),
            Some((6.4, 3.0, true)),
        ],
        [
            Some((4.7, 3.0, false)),
            None,
            Some((8.2, 1.4, true)),
            Some((4.5, 3.3, false)),
            Some((7.0, 2.6, true)),
        ],
        [
            Some((4.3, 3.0, false)),
            Some((5.0, 2.9, false)),
            None,
            Some((5.3, 3.3, true)),
            Some((7.4, 2.3, true)),
        ],
        [
            Some((4.8, 3.5, false)),
            Some((5.4, 3.1, true)),
            Some((6.9, 2.6, true)),
            None,
            Some((5.8, 3.6, true)),
        ],
        [
            Some((4.7, 3.3, false)),
            Some((5.1, 3.1, true)),
            Some((7.3, 2.3, true)),
            Some((3.8, 2.9, false)),
            None,
        ],
    ];
    for (from, source_row) in table.iter().enumerate() {
        for (to, expected) in source_row.iter().enumerate() {
            let input = format!(
                "source_row_id,from_activity,to_activity\ns,{},{}\n",
                axis[from], axis[to]
            );
            let output = records(&adapt(ATTELIA, input.as_bytes()).unwrap());
            if let Some((mean, sd, qualifies)) = expected {
                assert_eq!(output[0][3].parse::<f64>().unwrap(), *mean);
                assert_eq!(output[0][4].parse::<f64>().unwrap(), *sd);
                assert_eq!(&output[0][5], qualifies.to_string());
            } else {
                assert_eq!(&output[0][6], "unreported-diagonal");
            }
        }
    }
    for label in [
        "ON BICYCLE",
        "bike-ride",
        "working at a desk",
        "STILL",
        "unknown",
    ] {
        let raw = format!("source_row_id,from_activity,to_activity\ns,{label},walking\n");
        assert!(adapt(ATTELIA, raw.as_bytes()).is_err());
    }
}

#[test]
fn backapp_signed_hand_oracle_zero_positive_and_separate_interruption_duration() {
    // Tr =2+3=5, To=5-9=-4; Ti=77 is separate and remains unchanged.
    let raw = b"source_row_id,participant_id,app_id,baseline_participant_id,baseline_app_id,baseline_reference_id,T_b_seconds,T_a_seconds,T_n_seconds,T_i_seconds\nnegative,P,app,P,app,b1,2,3,9,77\nzero,P,app,P,app,b2,2.5,3.5,6,88\npositive,P,app,P,app,b3,0,4,1,99\n";
    let output = records(&adapt(BACKAPP, raw).unwrap());
    assert_eq!(
        (&output[0][9], &output[0][10], &output[0][11]),
        ("77", "5", "-4")
    );
    assert_eq!((&output[1][10], &output[1][11]), ("6", "0"));
    assert_eq!((&output[2][10], &output[2][11]), ("4", "3"));
}

#[test]
fn backapp_rejects_known_baseline_mismatch_nonfinite_and_negative_operands() {
    let headers="source_row_id,participant_id,app_id,baseline_participant_id,baseline_app_id,baseline_reference_id,T_b_seconds,T_a_seconds,T_n_seconds\n";
    for row in [
        "s,P,app,Q,app,b,1,2,3",
        "s,P,app,P,other,b,1,2,3",
        "s,P,app,P,app,,1,2,3",
        "s,P,app,P,app,b,-1,2,3",
        "s,P,app,P,app,b,1,NaN,3",
        "s,P,app,P,app,b,1,2,-3",
        "s,P,app,P,app,b,1e308,1e308,1",
    ] {
        assert!(adapt(BACKAPP, format!("{headers}{row}\n").as_bytes()).is_err());
    }
    assert!(adapt(BACKAPP, b"source_row_id,T_r_seconds,T_n_seconds\ns,5,9\n").is_err());
    let invalid_ti = format!(
        "{},T_i_seconds\ns,P,app,P,app,b,1,2,3,-1\n",
        headers.trim_end_matches('\n')
    );
    assert!(adapt(BACKAPP, invalid_ti.as_bytes()).is_err());
}

#[test]
fn source_formula_adapters_refuse_duplicate_headers_and_imported_derived_values() {
    assert!(adapt(
        ATTELIA,
        b"source_row_id,from_activity,to_activity,to_activity\ns,still,walking,walking\n"
    )
    .is_err());
    assert!(adapt(
        ATTELIA,
        b"source_row_id,from_activity,to_activity,breakpoint\ns,still,walking,true\n"
    )
    .is_err());
    let raw = battery(
        "[1,0,0,0,0]",
        "[1,1,1,1,1]",
        "1",
        "total-battery-capacity",
        "unit",
        "unit",
        "second",
    );
    assert!(String::from_utf8(adapt(BATTERY, &raw).unwrap())
        .unwrap()
        .contains("source-formula-estimate-not-observation"));
    let text = String::from_utf8(raw).unwrap();
    let (headers, record) = text.split_once('\n').unwrap();
    let imported = format!("{headers},U\n{},999\n", record.trim_end_matches('\n'));
    assert!(adapt(BATTERY, imported.as_bytes())
        .unwrap_err()
        .contains("derived output"));
    assert!(
        adapt(BACKAPP, b"source_row_id,T_r_seconds,T_n_seconds\ns,5,9\n")
            .unwrap_err()
            .contains("derived output")
    );
}

#[test]
fn source_formula_public_runner_emits_bound_source_exact_result_artifacts() {
    let battery_raw = battery(
        "[0.5,0.25,0.125,0.0625,0.0625]",
        "[2,4,8,16,32]",
        "1200",
        "total-battery-capacity",
        "mAh",
        "mAh",
        "hour",
    );
    let attelia_raw = b"source_row_id,from_activity,to_activity\ns,walking,running\n";
    let backapp_raw = b"source_row_id,participant_id,app_id,baseline_participant_id,baseline_app_id,baseline_reference_id,T_b_seconds,T_a_seconds,T_n_seconds\ns,P,app,P,app,b,2,3,9\n";
    let options: PipelineV2OptionsJson = serde_json::from_value(serde_json::json!({
        "study_name":"Source formulas", "timezone":"UTC", "usage_session_mode":"app_usage",
        "include_app_output":true, "include_screen_output":false, "use_filter_file":false,
        "use_apps_forcing_screen_open":false, "use_app_codebook":false,
        "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
        "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
        "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
        "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
        "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
        "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
        "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
        "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
    })).unwrap();
    for (component, raw) in [
        (BATTERY, battery_raw.as_slice()),
        (ATTELIA, attelia_raw.as_slice()),
        (BACKAPP, backapp_raw.as_slice()),
    ] {
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
        let request = serde_json::to_string(&RuntimeRequest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            request_id: component.into(),
            command: EXECUTE_WORKSPACE_COMMAND.into(),
            workspace_root_digest: None,
            workspace_id: digest.clone(),
            input_file_name: "source-formula-input.csv".into(),
            input_sha256: digest,
            known_review_summary_digests: None,
            participant_partition_batch_id: None,
            fragmented_participant_tokens: Vec::new(),
            method_profile_receipt: None,
            method_profile_receipts: Vec::new(),
            execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
            provenance_evidence: false,
            options: options.clone(),
        })
        .unwrap();
        let (registration, _) = literature_component_execution_unit(component).unwrap();
        let expected = adapt(component, raw).unwrap();
        let mut handle = execute_literature_component_native(component, &request, raw, &RuntimeSupportFiles::default())
            .expect("normal canonical component projection must be regenerated before public-runner integration");
        let manifest: serde_json::Value = serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(manifest["sourceRowCount"], 1);
        assert_eq!(manifest["derivedResultRowCount"], 1);
        let mut found = false;
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(
                metadata.digest,
                format!("sha256:{}", hex::encode(Sha256::digest(&bytes)))
            );
            if metadata.kind == registration.derived_result_kind {
                assert_eq!(bytes, expected);
                found = true;
            }
        }
        assert!(found);
    }
}
