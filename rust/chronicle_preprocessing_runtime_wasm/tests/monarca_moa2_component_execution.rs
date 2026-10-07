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

const MONARCA: &str = "chronicle.monarca-prepared-rms/v1";
const MOA2: &str = "chronicle.moa2-prepared-calendar/v1";
const RMS_RAW: &[u8] = b"participant_id,day_id,stream_id,window_id,window_order,sample_id,sample_order,value,input_unit,window_duration_seconds\nP,D,S,w2,2,c,3,-4,caller scalar,10\nP,D,S,w1,1,b,2,3,caller scalar,10\nP,D,S,w2,2,a,1,-4,caller scalar,10\nP,D,S,w1,1,a,1,-3,caller scalar,10\nP,D,S,w2,2,b,2,4,caller scalar,10\n";
const DATE_RAW: &[u8] = b"participant_id,source_row_id,source_local_date\nP,a,2026-09-25\nP,b,2026-09-26\nP,c,2026-09-27\nP,d,2026-09-28\nP,e,1600-02-29\n";

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

#[test]
fn registered_prepared_formulas_export_values_and_source_bounded_execution_receipts() {
    for (component, raw, work, kind, rows, settings) in [
        (
            MONARCA,
            RMS_RAW,
            "doi:10.1109/mprv.2015.54",
            "literature-monarca-prepared-rms-csv",
            3,
            2,
        ),
        (
            MOA2,
            DATE_RAW,
            "doi:10.1145/2968219.2968302",
            "literature-moa2-prepared-calendar-csv",
            5,
            1,
        ),
    ] {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        assert_eq!(bindings.len(), settings);
        let (manifest, artifacts) = public_execution(component, raw);
        assert_eq!(manifest.derived_result_row_count, rows);
        assert_eq!(manifest.source_row_count, 5);
        let output = std::str::from_utf8(artifacts.get(kind).unwrap()).unwrap();
        let receipt_bytes = artifacts
            .get("literature-component-execution-receipt-json")
            .unwrap();
        assert_eq!(
            manifest.component_execution_receipt_digest,
            sha256(receipt_bytes)
        );
        let receipt: LiteratureComponentExecutionReceipt =
            serde_json::from_slice(receipt_bytes).unwrap();
        assert_eq!(receipt.component_execution_status, "executed");
        assert_eq!(receipt.full_profile_execution_status, "blocked");
        assert_eq!(receipt.source_work_id, work);
        assert_eq!(receipt.component_id, registration.component_id);
        assert_eq!(
            receipt.setting_ids.iter().collect::<BTreeSet<_>>(),
            bindings
                .iter()
                .map(|x| &x.setting_id)
                .collect::<BTreeSet<_>>()
        );
        assert!(!receipt.kernel_input_eligible);
        assert!(receipt.canonical_kernel_input_digest.is_none());
        assert_eq!(
            receipt.derived_result_digest,
            sha256(artifacts.get(kind).unwrap())
        );
        if component == MONARCA {
            for row in [
                "w1,1,10,2,2,root_mean_square,3.0,computed,,input_unit",
                "w2,2,10,3,2,root_mean_square,4.0,computed,,input_unit",
                "P,D,S,caller scalar,,,,5,2,daily_mean_root_mean_square,3.5,computed,,input_unit",
            ] {
                assert!(output.contains(row), "{output}");
            }
        } else {
            for row in [
                "P,a,2026-09-25,weekday,computed",
                "P,b,2026-09-26,weekend,computed",
                "P,c,2026-09-27,weekend,computed",
                "P,d,2026-09-28,weekday,computed",
                "P,e,1600-02-29,weekday,computed",
            ] {
                assert!(output.contains(row), "{output}");
            }
        }
    }
}

#[test]
fn individual_monarca_bindings_emit_only_their_exact_statistic() {
    let (_, bindings) = literature_component_execution_unit(MONARCA).unwrap();
    for binding in bindings {
        let statistic = binding.source_value["definition"]["statistic"]
            .as_str()
            .unwrap()
            .to_owned();
        let adapted = adapt_literature_inputs(RMS_RAW, &sha256(RMS_RAW), &[binding], |_| &[])
            .unwrap()
            .unwrap();
        let text = String::from_utf8(adapted.derived_result_bytes.unwrap()).unwrap();
        let mut reader = csv::Reader::from_reader(text.as_bytes());
        let column = reader
            .headers()
            .unwrap()
            .iter()
            .position(|x| x == "statistic")
            .unwrap();
        let rows = reader.records().map(Result::unwrap).collect::<Vec<_>>();
        assert_eq!(
            rows.len(),
            if statistic == "root_mean_square" {
                2
            } else {
                1
            }
        );
        assert!(rows.iter().all(|r| r[column] == statistic));
    }
}

#[test]
fn registrations_reject_forged_formulas_and_malformed_prepared_inputs() {
    for (component, raw) in [(MONARCA, RMS_RAW), (MOA2, DATE_RAW)] {
        let (_, mut bindings) = literature_component_execution_unit(component).unwrap();
        bindings[0].source_value["definition"]["formula"] = json!("forged formula");
        assert!(adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[]).is_err());
    }
    for (component, raw) in [
        (
            MONARCA,
            String::from_utf8(RMS_RAW.to_vec())
                .unwrap()
                .replace(",10\n", ",5\n"),
        ),
        (
            MOA2,
            String::from_utf8(DATE_RAW.to_vec())
                .unwrap()
                .replace("2026-09-25", "1900-02-29"),
        ),
    ] {
        let (_, bindings) = literature_component_execution_unit(component).unwrap();
        let error =
            adapt_literature_inputs(raw.as_bytes(), &sha256(raw.as_bytes()), &bindings, |_| &[])
                .err()
                .expect("malformed prepared input must fail at its actual adapter");
        assert!(
            error.contains(if component == MONARCA {
                "ten-second"
            } else {
                "valid supplied"
            }),
            "{error}"
        );
    }
}

#[test]
fn reserved_native_bindings_execute_actual_csv_conformance_without_claiming_canonical_admission() {
    for (component, raw, expected_count) in [(MONARCA, RMS_RAW, 3), (MOA2, DATE_RAW, 5)] {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        let adapted = adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[])
            .unwrap()
            .unwrap();
        let bytes = adapted.derived_result_bytes.as_ref().unwrap();
        let derived = adapted.receipt.derived_result.as_ref().unwrap();
        assert_eq!(derived.row_count, expected_count);
        assert_eq!(derived.digest, sha256(bytes));
        assert_eq!(adapted.receipt.source_row_count, 5);
        let output = std::str::from_utf8(bytes).unwrap();
        assert!(output.contains(if component == MONARCA {
            "daily_mean_root_mean_square,3.5,computed"
        } else {
            "1600-02-29,weekday,computed"
        }));
        for binding in bindings {
            eprintln!(
                "{}",
                json!({"methodSettingId": binding.setting_id,
                "sourceWorkId": registration.source_work_id,
                "sourceMethodVariantId": registration.source_method_variant_id,
                "methodProfileVersion": registration.method_profile_version,
                "fixtureId": binding.conformance_fixture_id,
                "executedResultDigest": binding.conformance_result_digest})
            );
        }
    }
}

#[test]
fn registered_rms_export_retains_numerically_unavailable_windows_and_independent_days() {
    let raw = b"participant_id,day_id,stream_id,window_id,window_order,sample_id,sample_order,value,input_unit,window_duration_seconds\nP,D,S,tiny,0,a,0,0,u,10\nP,D,S,tiny,0,b,1,0,u,10\nP,D,S,tiny,0,c,2,0,u,10\nP,D,S,tiny,0,d,3,3e-162,u,10\nP,D,S,valid,1,a,0,3,u,10\nQ,D,S,valid,0,a,0,4,u,10\n";
    let (manifest, artifacts) = public_execution(MONARCA, raw);
    assert_eq!(manifest.source_row_count, 6);
    assert_eq!(manifest.derived_result_row_count, 5);
    let text = std::str::from_utf8(
        artifacts
            .get("literature-monarca-prepared-rms-csv")
            .unwrap(),
    )
    .unwrap();
    assert!(text.contains(
        "root_mean_square,,arithmetic_unavailable,floating_point_energy_underflow,input_unit"
    ));
    assert!(text.contains("P,D,S,u,,,,5,2,daily_mean_root_mean_square,,arithmetic_unavailable,window_rms_unavailable,input_unit"));
    assert!(text.contains("Q,D,S,u,,,,1,1,daily_mean_root_mean_square,4.0,computed,,input_unit"));
}
