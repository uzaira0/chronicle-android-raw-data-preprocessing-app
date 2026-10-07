use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.keyguard-transition-fsm/v1";
const SOURCE_WORK_ID: &str = "doi:10.1145/2858036.2858267";
const SOURCE_VARIANT_ID: &str = "source-audit-configuration-space-cf29f24c1bfd65e2d30d98c3";
const ORACLE_ID: &str = "keyguard-transition-fsm-bounded-source-fixture-v1/sha256:f706cf1f4f017bc382b4553ae6ce0c4ba26f6196ec7a599540f7fb04b25bca6f";
const SOURCE: &[u8] =
    include_bytes!("fixtures/doi-10.1145-2858036.2858267-keyguard-sessions.csv.fixture");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Bounded keyguard transition FSM component",
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

fn request() -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "keyguard-fsm-component".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"keyguard-fsm-component-workspace"),
        input_file_name: "doi-10.1145-2858036.2858267-keyguard-sessions.csv".into(),
        input_sha256: sha256(SOURCE),
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

#[test]
fn component_executes_exact_registered_keyguard_settings_and_emits_session_evidence() {
    let (registration, _) = literature_component_execution_unit(COMPONENT_ID)
        .expect("registered keyguard FSM component");
    let expected_setting_ids = BTreeSet::from([
        "method-setting-66971636f462691bcec72f17",
        "method-setting-7df08c437f42cf92805cf08c",
        "method-setting-872019c5a07ff24211a80743",
        "method-setting-a207e31f1db538ca4b187427",
        "method-setting-b51c74551bfca293e7c68dd8",
        "method-setting-b8dd81dff532b32fde952719",
        "method-setting-cf59646b80aa0a2d39990b7f",
        "method-setting-atomic-4bb220b247403a97d9e9",
        "method-setting-atomic-a8f51d42ed35d404917d",
    ]);
    assert_eq!(registration.source_work_id, SOURCE_WORK_ID);
    assert_eq!(registration.source_method_variant_id, SOURCE_VARIANT_ID);
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(registration.required_support_roles, Vec::<String>::new());
    assert_eq!(
        registration.method_profile_version,
        "literature-sublation-v3-atomic+source-complete-v1"
    );
    assert!(!registration.limitations.is_empty());

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(),
        SOURCE,
        &RuntimeSupportFiles::default(),
    )
    .expect("bounded keyguard FSM component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.component_id, COMPONENT_ID);
    assert_eq!(manifest.source_row_count, 19);
    assert_eq!(manifest.derived_result_row_count, 5);

    let mut payloads = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact payload");
        assert_eq!(metadata.digest, sha256(&bytes));
        payloads.insert(metadata.kind, bytes);
    }

    let mut reader =
        csv::Reader::from_reader(payloads["literature-keyguard-session-evidence-csv"].as_slice());
    assert_eq!(
        reader.headers().expect("session evidence header"),
        &csv::StringRecord::from(vec![
            "participant_id",
            "pickup_id",
            "source_data_rows",
            "keyguard_state_paths",
            "dismissal_outcome",
            "session_outcome_class",
            "retry_count",
            "lock_types",
            "code_lengths",
            "pattern_stealth_modes",
            "screen_off_reasons",
            "prior_attempt_counts",
            "lock_screen_interaction_observed",
            "session_duration_ns",
            "preparation_duration_ns",
            "attempts",
            "code_attempt_sequence",
        ])
    );
    let evidence = reader
        .records()
        .map(|record| {
            let record = record.expect("session evidence row");
            (record[0].to_owned(), record)
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(evidence.len(), 5);
    let paths = |participant: &str| {
        serde_json::from_str::<Vec<String>>(&evidence[participant][3]).expect("JSON keyguard paths")
    };
    assert_eq!(
        paths("P1"),
        ["lock_screen_interaction", "retry", "unlocked_use"]
    );
    assert_eq!(evidence["P1"].get(4), Some("successful_unlock"));
    assert_eq!(evidence["P1"].get(5), Some("success_after_error"));
    assert_eq!(evidence["P1"].get(6), Some("1"));
    assert_eq!(evidence["P1"].get(13), Some("20000000000"));
    assert_eq!(evidence["P1"].get(14), Some("1000000000"));
    assert_eq!(evidence["P1"].get(16), Some("fs"));
    let attempts = serde_json::from_str::<serde_json::Value>(&evidence["P1"][15])
        .expect("ordered attempt evidence");
    assert_eq!(attempts[0]["outcome"], "incorrect");
    assert_eq!(attempts[0]["durationNs"], 1_000_000_000_i64);
    assert_eq!(attempts[0]["startSourceRow"], 2);
    assert_eq!(attempts[0]["outcomeSourceRow"], 3);
    assert_eq!(attempts[1]["outcome"], "correct");
    assert_eq!(attempts[1]["durationNs"], 1_000_000_000_i64);
    assert_eq!(paths("P2"), ["lock_screen_interaction", "abort"]);
    assert_eq!(evidence["P2"].get(4), Some(""));
    assert_eq!(evidence["P2"].get(5), Some("aborted_after_error"));
    assert_eq!(evidence["P2"].get(16), Some("t"));
    assert_eq!(evidence["P3"].get(4), Some("slide_to_unlock"));
    assert_eq!(evidence["P3"].get(5), Some("slide_to_unlock"));
    assert_eq!(evidence["P3"].get(16), Some(""));
    let slide_attempts = serde_json::from_str::<serde_json::Value>(&evidence["P3"][15])
        .expect("slide attempt evidence");
    assert_eq!(slide_attempts[0]["outcome"], "slide");
    assert_eq!(slide_attempts[0]["durationNs"], 1_000_000_000_i64);
    assert_eq!(paths("P4"), ["no_unlock"]);
    assert_eq!(paths("P5"), ["no_unlock"]);
    assert_eq!(evidence["P4"].get(5), Some("no_unlock"));
    assert_eq!(evidence["P4"].get(13), Some("30000000000"));
    assert_eq!(evidence["P4"].get(14), Some(""));

    let adaptation: serde_json::Value = serde_json::from_slice(
        &payloads["literature-input-adaptation-receipt-json"],
    )
    .expect("keyguard adaptation receipt");
    let fsm = &adaptation["keyguardFsm"];
    assert_eq!(fsm["errorSequenceCountsByLockType"]["pin"]["fs"], 1);
    assert_eq!(fsm["errorSequenceCountsByLockType"]["pattern"]["t"], 1);
    assert_eq!(fsm["criticalErrorCountsByLockType"].as_object().unwrap().len(), 0);

    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    assert_eq!(
        method
            .setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        expected_setting_ids
    );
    assert_eq!(method.limitations, registration.limitations);
    assert_eq!(execution.limitations, method.limitations);
    assert_eq!(execution.oracle_id, ORACLE_ID);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.canonical_kernel_input_digest, None);
}
