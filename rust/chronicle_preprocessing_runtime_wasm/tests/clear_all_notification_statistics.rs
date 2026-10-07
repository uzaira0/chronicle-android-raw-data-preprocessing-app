//! Hand-calculated release-function fixtures, not original participant data.
//! Clear All commit 30c40282f57c3c57b5d906997426b23147b87277:
//! 03_notification_counts.ipynb cell19, SHA256 c1e2fc446db7c746c68ec2bb30ef8b6a227686ba0b59bfd5e4f1ed08731ee813;
//! 11_notification_age.ipynb cells5/17/19/23, SHA256 e3b7907b2ccf2ae61399b369dc71a49a9cfe975cd0804c720a8b2a0d4a878bcf.

use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const UNIQUE: &str = "chronicle.clear-all-unique-notification-items/v1";
const AGE: &str = "chronicle.clear-all-notification-appearance-age/v1";
const EMPTY: &str = "chronicle.clear-all-empty-snapshot-fractions/v1";

fn transport(rows: &[(&str, &str, i64, Value)], mapping: &Value) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "source_row_id",
            "UUID",
            "Time",
            "Active",
            "active_stage",
            "package_category_mapping",
        ])
        .unwrap();
    for (id, uuid, time, active) in rows {
        writer
            .write_record([
                id.to_string(),
                uuid.to_string(),
                time.to_string(),
                active.to_string(),
                "raw-active".to_owned(),
                mapping.to_string(),
            ])
            .unwrap();
    }
    writer.into_inner().unwrap()
}

fn adapt(component: &str, raw: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(
        bindings.len(),
        1,
        "must not claim broader category/display settings"
    );
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let adapted = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?
        .ok_or("missing component adaptation")?;
    assert_eq!(adapted.receipt.original_input_digest, digest);
    assert_eq!(adapted.receipt.duplicate_source_ids_removed, 0);
    Ok((
        adapted
            .derived_result_bytes
            .ok_or("missing derived output")?,
        adapted.receipt.source_row_count,
        adapted.receipt.emitted_row_count,
    ))
}

fn rows(bytes: &[u8]) -> Vec<csv::StringRecord> {
    csv::Reader::from_reader(bytes)
        .records()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn clear_all_unique_identity_repeats_new_post_time_devices_and_observed_empty() {
    let raw = transport(
        &[
            (
                "s1",
                "A",
                0,
                json!([{"key":"k", "postTime":100}, {"key":"k", "postTime":100}, {"key":"k", "postTime":101}]),
            ),
            ("s2", "A", 0, json!([{"key":"k", "postTime":100}])),
            ("s3", "B", 0, json!([{"key":"k", "postTime":100}])),
            ("s4", "C", 0, json!([])),
        ],
        &json!({}),
    );
    // A has {k@100,k@101}; B has its own {k@100}; C's observed empty set is 0.
    let (output, source_count, emitted_count) = adapt(UNIQUE, &raw).unwrap();
    assert_eq!((source_count, emitted_count), (4, 3));
    assert_eq!(
        String::from_utf8(output).unwrap(),
        "UUID,unique_notification_count\nA,2\nB,1\nC,0\n"
    );
}

#[test]
fn clear_all_age_floor_cap_duplicates_unknown_mapping_and_weighted_medians() {
    let raw = transport(
        &[
            (
                "s1",
                "A",
                2000,
                json!([
                    {"key":"k", "postTime":0, "packageName":"p"},
                    {"key":"k", "postTime":0, "packageName":"p"},
                    {"key":"future", "postTime":3000, "packageName":"not-in-map"}
                ]),
            ),
            (
                "s2",
                "A",
                2_678_400_000,
                json!([
                    {"key":"k", "postTime":0, "packageName":"p"},
                    {"key":"cap", "postTime":-1, "packageName":"p"}
                ]),
            ),
            (
                "s3",
                "B",
                1000,
                json!([{"key":"k", "postTime":0, "packageName":"p"}]),
            ),
            ("s4", "C", 1000, json!([])),
        ],
        &json!({"p":"SOCIAL"}),
    );
    let (output, source_count, emitted_count) = adapt(AGE, &raw).unwrap();
    assert_eq!((source_count, emitted_count), (4, 9));
    let output = rows(&output);
    assert_eq!(
        output.iter().filter(|row| &row[0] == "appearance").count(),
        6
    );
    assert_eq!(
        (&output[0][8], &output[0][9], &output[1][8], &output[1][9]),
        ("2000", "2", "2000", "2")
    );
    assert_eq!(
        (&output[2][8], &output[2][9], &output[2][10]),
        ("0", "0", "UNKNOWN")
    );
    assert_eq!((&output[3][8], &output[4][8]), ("2678400000", "2678400000"));
    // A/SOCIAL has [2,2,2678400,2678400]: median=(2+2678400)/2.
    assert_eq!(
        (
            &output[6][2],
            &output[6][10],
            &output[6][11],
            &output[6][12],
            &output[6][13]
        ),
        ("A", "SOCIAL", "1339201", "372.0002777777778", "4")
    );
    assert_eq!(
        (&output[7][10], &output[7][11], &output[7][13]),
        ("UNKNOWN", "0", "1")
    );
    assert_eq!(
        (&output[8][2], &output[8][11], &output[8][13]),
        ("B", "1", "1")
    );
    assert!(output.iter().all(|row| &row[2] != "C"));
}

#[test]
fn clear_all_age_retains_fractional_seconds_and_duplicate_weight() {
    let raw = transport(
        &[(
            "s",
            "A",
            3001,
            json!([
                {"key":"a", "postTime":3000, "packageName":"p"},
                {"key":"a", "postTime":3000, "packageName":"p"},
                {"key":"b", "postTime":1, "packageName":"p"}
            ]),
        )],
        &json!({}),
    );
    let output = rows(&adapt(AGE, &raw).unwrap().0);
    assert_eq!((&output[0][8], &output[0][9]), ("1", "0.001"));
    // Retaining both identical appearances makes median 0.001, not 1.5005.
    assert_eq!(
        (&output[3][10], &output[3][11], &output[3][13]),
        ("UNKNOWN", "0.001", "3")
    );
}

#[test]
fn clear_all_age_clamp_does_not_overflow_signed_millisecond_domain() {
    for (time, post, expected) in [
        (i64::MAX, i64::MIN, "2678400000"),
        (i64::MIN, i64::MAX, "0"),
    ] {
        let raw = transport(
            &[(
                "s",
                "A",
                time,
                json!([{"key":"k", "postTime":post, "packageName":"p"}]),
            )],
            &json!({}),
        );
        let output = rows(&adapt(AGE, &raw).unwrap().0);
        assert_eq!(&output[0][8], expected);
    }
}

#[test]
fn clear_all_refuses_invented_identity_stringification_or_grouped_active() {
    for post in [
        json!(null),
        json!(1.0),
        json!(true),
        json!("1"),
        json!(u64::MAX),
    ] {
        let raw = transport(
            &[(
                "s",
                "A",
                0,
                json!([{"key":"k", "postTime":post, "packageName":"p"}]),
            )],
            &json!({}),
        );
        for component in [UNIQUE, AGE] {
            assert!(adapt(component, &raw).is_err());
        }
    }
    for member in [json!({"key":null,"postTime":0}), json!(42)] {
        assert!(adapt(
            UNIQUE,
            &transport(&[("s", "A", 0, json!([member]))], &json!({}))
        )
        .is_err());
    }
    let grouped = b"source_row_id,UUID,Active,active_stage,raw_notification_count,grouped_notification_count\ns,A,[],raw-active,0,0\n";
    assert!(adapt(UNIQUE, grouped)
        .unwrap_err()
        .contains("original raw Active"));
    assert!(adapt(
        UNIQUE,
        b"source_row_id,UUID,Active,active_stage\ns,A,[],grouped-active\n"
    )
    .is_err());
    assert!(adapt(
        UNIQUE,
        b"source_row_id,UUID,Active,active_stage,Active\ns,A,[],raw-active,[]\n"
    )
    .is_err());
}

#[test]
fn clear_all_requires_one_supplied_string_category_map_and_integer_snapshot_time() {
    for mapping in [json!(null), json!([]), json!({"p":null}), json!({"p":1})] {
        assert!(adapt(AGE, &transport(&[("s", "A", 0, json!([]))], &mapping)).is_err());
    }
    let raw = transport(
        &[("s", "A", 0, json!([])), ("t", "A", 0, json!([]))],
        &json!({"p":"SOCIAL"}),
    );
    let different_mapping = String::from_utf8(raw)
        .unwrap()
        .replacen("SOCIAL", "NEWS", 1);
    assert!(adapt(AGE, different_mapping.as_bytes())
        .unwrap_err()
        .contains("consistent supplied"));
    let float_clock = b"source_row_id,UUID,Active,active_stage,Time,package_category_mapping\ns,A,[],raw-active,1.0,{}\n";
    assert!(adapt(AGE, float_clock).is_err());
    let (bytes, count, emitted) =
        adapt(AGE, &transport(&[("s", "A", 0, json!([]))], &json!({}))).unwrap();
    assert_eq!((count, emitted), (1, 0));
    assert!(rows(&bytes).is_empty());
}

#[test]
fn clear_all_empty_fractions_distinguish_pooled_and_equal_device_weighting() {
    // Supplied Zeros is independent of Active. A: 2/3 empty; B: 0/1 empty.
    // Pooled = 2/4 = 1/2; equal-device = ((2/3)+0)/2 = 1/3.
    let raw = b"source_row_id,UUID,Zeros,inventory_stage\ni1,A,\"[0,2,0]\",supplied-valid-zeros\ni2,B,[1],supplied-valid-zeros\n";
    let (bytes, count, emitted) = adapt(EMPTY, raw).unwrap();
    assert_eq!((count, emitted), (2, 3));
    let output = rows(&bytes);
    assert_eq!(
        (&output[0][3], &output[0][4], &output[0][5]),
        ("3", "2", "0.6666666666666666")
    );
    assert_eq!(
        (&output[1][3], &output[1][4], &output[1][5]),
        ("1", "0", "0")
    );
    assert_eq!(
        (&output[2][3], &output[2][4], &output[2][7], &output[2][9]),
        ("4", "2", "0.5", "0.3333333333333333")
    );
}

#[test]
fn clear_all_empty_inventory_refuses_missing_denominators_and_invented_availability() {
    for zeros in ["[]", "null", "[1.0]", "[-1]", "[false]", "[null]"] {
        let raw =
            format!("source_row_id,UUID,Zeros,inventory_stage\ni,A,{zeros},supplied-valid-zeros\n");
        assert!(adapt(EMPTY, raw.as_bytes()).is_err());
    }
    assert!(adapt(EMPTY, b"source_row_id,UUID,Zeros,inventory_stage\n").is_err());
    assert!(adapt(
        EMPTY,
        b"source_row_id,UUID,Zeros,inventory_stage\ni,A,[0],derived-from-active\n"
    )
    .is_err());
    assert!(adapt(EMPTY, b"source_row_id,UUID,Zeros,inventory_stage\ni,A,[0],supplied-valid-zeros\nj,A,[1],supplied-valid-zeros\n").is_err());
    let active =
        b"source_row_id,UUID,Zeros,inventory_stage,Active\ni,A,[0],supplied-valid-zeros,[]\n";
    assert!(adapt(EMPTY, active)
        .unwrap_err()
        .contains("independent supplied valid.Zeros"));
    assert!(adapt(
        EMPTY,
        b"source_row_id,UUID,Zeros,inventory_stage\ni,,[0],supplied-valid-zeros\n"
    )
    .is_err());
}

#[test]
fn clear_all_statistics_public_runner_emits_the_adapter_result_with_bound_artifacts() {
    let snapshots = transport(
        &[(
            "s",
            "A",
            1000,
            json!([{"key":"k", "postTime":0, "packageName":"p"}]),
        )],
        &json!({}),
    );
    let inventory = b"source_row_id,UUID,Zeros,inventory_stage\ni,A,[0],supplied-valid-zeros\n";
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name":"ClearAll statistics", "timezone":"UTC", "usage_session_mode":"app_usage",
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
        (UNIQUE, snapshots.as_slice()),
        (AGE, snapshots.as_slice()),
        (EMPTY, inventory.as_slice()),
    ] {
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
        let request = serde_json::to_string(&RuntimeRequest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            request_id: component.into(),
            command: EXECUTE_WORKSPACE_COMMAND.into(),
            workspace_root_digest: None,
            workspace_id: digest.clone(),
            input_file_name: "clear-all-input.csv".into(),
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
            .expect("canonical component projection must be regenerated before the public-runner integration check");
        let manifest: Value = serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(manifest["sourceRowCount"], expected.1);
        assert_eq!(manifest["derivedResultRowCount"], expected.2);
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
                assert_eq!(bytes, expected.0);
                found = true;
            }
        }
        assert!(
            found,
            "standalone derived result is a bound runtime artifact"
        );
    }
}
