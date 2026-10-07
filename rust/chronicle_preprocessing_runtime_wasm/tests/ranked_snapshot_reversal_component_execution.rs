use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};

const COMPONENT_ID: &str = "chronicle.ranked-snapshot-reversal/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Ranked snapshot reversal",
        "timezone": "UTC",
        "usage_session_mode": "app_usage",
        "include_app_output": true,
        "include_screen_output": false,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_app_codebook": false,
        "correct_duplicate_event_timestamps": false,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0, 2.0],
        "long_usage_duration_thresholds": [1.0, 2.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-09-03 00:00:00 UTC",
        "minimum_usage_duration": 0.0
    }))
    .expect("valid component options")
}

fn request(raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "ranked-snapshot-reversal".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"ranked-snapshot-reversal-workspace"),
        input_file_name: "ranked-snapshots.csv".into(),
        input_sha256: sha256(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: options(),
    })
    .expect("request JSON")
}

fn adapter_error(raw: &[u8]) -> String {
    let (_, bindings) = literature_component_execution_unit(COMPONENT_ID).expect("registration");
    match adapt_literature_inputs(raw, &sha256(raw), &bindings, |_| &[]) {
        Err(error) => error,
        Ok(_) => panic!("expected fail-closed adapter error"),
    }
}

#[test]
fn ranked_snapshots_execute_through_the_public_runner_in_oldest_first_order() {
    let raw = concat!(
        "source_row_id,entity_id,snapshot_id,raw_key,component_value\n",
        "s1-newest,device-1,snapshot-1,app|recent|0,app.new/.Newest\n",
        "s1-oldest,device-1,snapshot-1,app|recent|2,app.old/.Oldest\n",
        "s1-middle,device-1,snapshot-1,app|recent|1,app.middle/.Middle\n",
        "s2-only,device-1,snapshot-2,app|recent|0,app.only/.Only\n",
    )
    .as_bytes();
    let (registration, bindings) =
        literature_component_execution_unit(COMPONENT_ID).expect("component registration");
    assert_eq!(bindings.len(), 5);
    assert!(!bindings.iter().any(|binding| binding.setting_id == "method-setting-693f8bca517644fd9e7395da"));
    assert_eq!(registration.full_profile_execution_status, "blocked");

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("public component execution");
    let manifest: serde_json::Value =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest["sourceRowCount"], 4);
    assert_eq!(manifest["derivedResultRowCount"], 4);

    let mut output = None;
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        assert_eq!(metadata.digest, sha256(&bytes));
        if metadata.kind == "literature-ranked-snapshot-reversal-csv" {
            output = Some(String::from_utf8(bytes).expect("UTF-8 output"));
        }
    }
    assert_eq!(
        output.expect("derived output"),
        concat!(
            "source_row_id,entity_id,snapshot_id,raw_key,component_value\n",
            "s1-oldest,device-1,snapshot-1,app|recent|2,app.old/.Oldest\n",
            "s1-middle,device-1,snapshot-1,app|recent|1,app.middle/.Middle\n",
            "s1-newest,device-1,snapshot-1,app|recent|0,app.new/.Newest\n",
            "s2-only,device-1,snapshot-2,app|recent|0,app.only/.Only\n",
        )
    );
}

#[test]
fn consecutive_unchanged_snapshots_are_removed_without_inventing_launches() {
    let raw = concat!(
        "source_row_id,entity_id,snapshot_id,raw_key,component_value\n",
        "first-new,device-1,s1,app|recent|0,A\n",
        "first-old,device-1,s1,app|recent|1,B\n",
        "repeat-old,device-1,s2,app|recent|1,B\n",
        "repeat-new,device-1,s2,app|recent|0,A\n",
        "changed-new,device-1,s3,app|recent|0,C\n",
        "changed-old,device-1,s3,app|recent|1,B\n",
        "return-new,device-1,s4,app|recent|0,A\n",
        "return-old,device-1,s4,app|recent|1,B\n",
    )
    .as_bytes();
    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("public component execution");
    let manifest: serde_json::Value =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest["sourceRowCount"], 8);
    assert_eq!(manifest["derivedResultRowCount"], 6);
    let output = (0..handle.artifact_count()).find_map(|index| {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle.artifact_metadata_json(index).expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        (metadata.kind == "literature-ranked-snapshot-reversal-csv")
            .then(|| String::from_utf8(bytes).expect("UTF-8 output"))
    }).expect("derived output");
    assert!(output.contains("first-old,device-1,s1,app|recent|1,B"));
    assert!(!output.contains("repeat-old"));
    assert!(!output.contains("repeat-new"));
    assert!(output.contains("changed-new,device-1,s3,app|recent|0,C"));
    assert!(output.contains("return-new,device-1,s4,app|recent|0,A"));
}

#[test]
fn identical_ranked_lists_from_different_devices_are_not_collapsed() {
    let raw = concat!(
        "source_row_id,entity_id,snapshot_id,raw_key,component_value\n",
        "a-1,device-a,poll-1,app|recent|0,A\n",
        "b-1,device-b,poll-1,app|recent|0,A\n",
        "a-2,device-a,poll-2,app|recent|0,A\n",
        "b-2,device-b,poll-2,app|recent|0,B\n",
    ).as_bytes();
    let mut handle = execute_literature_component_native(
        COMPONENT_ID, &request(raw), raw, &RuntimeSupportFiles::default(),
    ).expect("two-device component execution");
    let manifest: serde_json::Value =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest["sourceRowCount"], 4);
    assert_eq!(manifest["derivedResultRowCount"], 3);
    let output = (0..handle.artifact_count()).find_map(|index| {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle.artifact_metadata_json(index).expect("artifact metadata"),
        ).expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        (metadata.kind == "literature-ranked-snapshot-reversal-csv")
            .then(|| String::from_utf8(bytes).expect("UTF-8 output"))
    }).expect("derived output");
    assert!(output.contains("a-1,device-a,poll-1,app|recent|0,A"));
    assert!(output.contains("b-1,device-b,poll-1,app|recent|0,A"));
    assert!(!output.contains("a-2,device-a,poll-2"));
    assert!(output.contains("b-2,device-b,poll-2,app|recent|0,B"));
}

#[test]
fn malformed_capacity_and_duplicate_rank_inputs_fail_closed() {
    for (raw_key, expected) in [
        ("app|running|0", "requires rank-key prefix"),
        ("app|recent|01", "canonical zero-based decimal rank"),
        ("app|recent|10", "rank exceeds snapshot capacity"),
    ] {
        let raw = format!(
            "source_row_id,entity_id,snapshot_id,raw_key,component_value\nrow,device-1,snapshot,{raw_key},opaque\n"
        );
        assert!(adapter_error(raw.as_bytes()).contains(expected));
    }
    let duplicate = concat!(
        "source_row_id,entity_id,snapshot_id,raw_key,component_value\n",
        "row-1,device-1,snapshot,app|recent|0,one\n",
        "row-2,device-1,snapshot,app|recent|0,two\n",
    );
    assert!(adapter_error(duplicate.as_bytes()).contains("duplicates a rank"));
    assert!(adapter_error(b"source_row_id,snapshot_id,raw_key,component_value\nrow,snapshot,app|recent|0,one\n").contains("entity_id"));
    assert!(adapter_error(b"source_row_id,entity_id,snapshot_id,raw_key,component_value\nrow,,snapshot,app|recent|0,one\n").contains("missing a required ranked-snapshot field"));
}
