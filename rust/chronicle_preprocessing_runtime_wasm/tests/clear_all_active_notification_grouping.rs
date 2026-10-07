use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use serde_json::{json, Value};
use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{execute_literature_component_native, RuntimeRequest, RuntimeSupportFiles, RuntimeArtifactMetadata, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION};
use sha2::{Digest, Sha256};

const COMPONENT: &str = "chronicle.clear-all-active-notification-grouping/v1";

fn transport(active: &Value) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "Active", "opaque"]).unwrap();
    writer
        .write_record(["snapshot", &active.to_string(), "unchanged"])
        .unwrap();
    writer.into_inner().unwrap()
}

fn adapt(raw: &[u8]) -> Result<Vec<u8>, String> {
    let (_, bindings) = literature_component_execution_unit(COMPONENT)?;
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    Ok(adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?
        .ok_or("missing component adaptation")?
        .derived_result_bytes
        .ok_or("missing derived output")?)
}

#[test]
fn clear_all_preserves_literal_concat_collisions_summaries_duplicates_and_order() {
    // Released shared.py:11-38, SHA256 ad1057116365d0aac16cc585d567c8a70814916035b3f4d9038841df0d346a16.
    // The collision ab+c == a+bc is intentional; a tuple key would be wrong.
    let active = json!([
        {"id":"child", "packageName":"ab", "groupKeyCompat":"c", "isGroupSummaryCompat":false},
        {"id":"summary", "packageName":"a", "groupKeyCompat":"bc", "isGroupSummaryCompat":true, "opaque":{"v":1}},
        {"id":"summary", "packageName":"a", "groupKeyCompat":"bc", "isGroupSummaryCompat":true, "opaque":{"v":1}},
        {"id":"single", "packageName":"solo", "isGroupSummaryCompat":false},
        {"id":"plain-1", "packageName":"plain", "groupKeyCompat":"", "isGroupSummaryCompat":false},
        {"id":"plain-2", "packageName":"plain", "isGroupSummaryCompat":null}
    ]);
    let bytes = adapt(&transport(&active)).expect("registered ClearAll executor");
    let mut reader = csv::Reader::from_reader(bytes.as_slice());
    assert_eq!(reader.headers().unwrap().iter().collect::<Vec<_>>(), vec!["source_row_id", "Active", "opaque", "raw_notification_count", "grouped_notification_count"]);
    let row = reader.records().next().unwrap().unwrap();
    let output: Value = serde_json::from_str(&row[1]).unwrap();
    assert_eq!(output, Value::Array(active.as_array().unwrap()[1..].to_vec()));
    assert_eq!(&row[2], "unchanged");
    assert_eq!((&row[3], &row[4]), ("6", "5"));
}

#[test]
fn clear_all_preserves_python_json_truthiness_and_empty_snapshots() {
    for truthy in [json!(true), json!(1), json!(-2), json!("false"), json!([0]), json!({"x":null})] {
        let active = json!([
            {"id":"child", "packageName":"p", "isGroupSummaryCompat":false},
            {"id":"summary", "packageName":"p", "isGroupSummaryCompat":truthy}
        ]);
        let bytes = adapt(&transport(&active)).unwrap();
        let row = csv::Reader::from_reader(bytes.as_slice()).records().next().unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Value>(&row[1]).unwrap(), json!([active[1]]));
    }
    for falsey in [json!(false), json!(0), json!(0.0), json!(null), json!(""), json!([]), json!({})] {
        let active = json!([
            {"packageName":"p", "isGroupSummaryCompat":falsey},
            {"packageName":"p", "isGroupSummaryCompat":false}
        ]);
        let bytes = adapt(&transport(&active)).unwrap();
        let row = csv::Reader::from_reader(bytes.as_slice()).records().next().unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Value>(&row[1]).unwrap(), active);
    }
    let bytes = adapt(&transport(&json!([]))).unwrap();
    let row = csv::Reader::from_reader(bytes.as_slice()).records().next().unwrap().unwrap();
    assert_eq!((&row[1], &row[3], &row[4]), ("[]", "0", "0"));
}

#[test]
fn clear_all_refuses_invalid_source_fields_instead_of_treating_null_as_absence() {
    for active in [
        json!([{ "packageName":"p", "groupKeyCompat":null, "isGroupSummaryCompat":false }]),
        json!([{ "packageName":null, "isGroupSummaryCompat":false }]),
        json!([{ "packageName":"p" }]),
        json!([42]),
        json!({}),
    ] {
        assert!(adapt(&transport(&active)).is_err());
    }
    assert!(adapt(b"source_row_id,Active,Active\ns,[],[]\n").is_err());
    assert!(adapt(b"source_row_id,Active\ns,not-json\n").is_err());
    assert!(adapt(b"source_row_id,Active\n,[]\n").is_err());
}

#[test]
fn clear_all_groups_only_inside_each_supplied_snapshot() {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "Active"]).unwrap();
    for (id, summary) in [("one", false), ("two", true)] {
        writer.write_record([id, &json!([{"packageName":"same", "isGroupSummaryCompat":summary}]).to_string()]).unwrap();
    }
    let bytes = adapt(&writer.into_inner().unwrap()).unwrap();
    let rows = csv::Reader::from_reader(bytes.as_slice()).records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!((&rows[0][0], &rows[0][3], &rows[1][0], &rows[1][3]), ("one", "1", "two", "1"));
}

#[test]
fn clear_all_executes_in_the_public_component_runner_with_bound_artifacts() {
    let raw = transport(&json!([{ "packageName":"p", "isGroupSummaryCompat":false }]));
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&raw)));
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name":"ClearAll grouping", "timezone":"UTC", "usage_session_mode":"app_usage",
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
    let request = serde_json::to_string(&RuntimeRequest {
        protocol_version:RUNTIME_PROTOCOL_VERSION.into(), request_id:"clear-all".into(),
        command:EXECUTE_WORKSPACE_COMMAND.into(), workspace_root_digest:None,
        workspace_id:digest.clone(), input_file_name:"snapshots.csv".into(), input_sha256:digest,
        known_review_summary_digests:None, participant_partition_batch_id:None,
        fragmented_participant_tokens:Vec::new(), method_profile_receipt:None, method_profile_receipts:Vec::new(), options,
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
    }).unwrap();
    let mut handle = execute_literature_component_native(COMPONENT, &request, &raw, &RuntimeSupportFiles::default()).unwrap();
    let manifest: Value = serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest["sourceRowCount"], 1);
    assert_eq!(manifest["derivedResultRowCount"], 1);
    let mut found = false;
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, format!("sha256:{}", hex::encode(Sha256::digest(&bytes))));
        if metadata.kind == "literature-clear-all-active-notification-grouping-csv" {
            assert_eq!(bytes, adapt(&raw).unwrap());
            found = true;
        }
    }
    assert!(found);
}
