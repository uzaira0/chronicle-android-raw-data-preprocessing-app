use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.notification-study-daily/v1";
const FIXTURE: &str = include_str!("fixtures/notification_daily_zero_fill_source_variants.json");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn fixture_csv(fixture: &Value) -> Vec<u8> {
    let mut csv = fixture["rawCsvLines"]
        .as_array()
        .expect("fixture CSV lines")
        .iter()
        .map(|line| line.as_str().expect("fixture CSV line"))
        .collect::<Vec<_>>()
        .join("\n");
    csv.push('\n');
    csv.into_bytes()
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Daily contact count source variants",
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
        request_id: "daily-contact-count-source-variants".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"daily-contact-count-source-variants-workspace"),
        input_file_name: "post_selection_contacts_and_day_spine.csv".into(),
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

#[test]
fn public_component_receipts_released_code_and_stated_zero_fill_as_distinct_outputs() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("source-variant fixture JSON");
    let raw = fixture_csv(&fixture);
    let (registration, _) = literature_component_execution_unit(COMPONENT_ID)
        .expect("registered component execution unit");
    assert!(registration.required_support_roles.is_empty());

    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(&raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .expect("component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.source_row_count, 8);
    assert_eq!(manifest.derived_result_row_count, 8);

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

    let derived = &payloads["literature-notification-daily-count-source-variants-csv"];
    let mut reader = csv::ReaderBuilder::new().from_reader(derived.as_slice());
    let headers = reader.headers().expect("derived header").clone();
    let variant = headers
        .iter()
        .position(|field| field == "variant_id")
        .expect("variant column");
    let count = headers
        .iter()
        .position(|field| field == "daily_contact_count")
        .expect("daily count column");
    let mut counts = BTreeMap::<String, Vec<u64>>::new();
    for record in reader.records() {
        let record = record.expect("derived row");
        counts
            .entry(record[variant].to_owned())
            .or_default()
            .push(record[count].parse().expect("numeric daily count"));
    }
    assert_eq!(counts["released-code-joined-row-count"], [2, 1, 1, 1]);
    assert_eq!(counts["stated-intended-zero-fill"], [2, 0, 0, 1]);

    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    let expected_setting_ids = fixture["exactCanonicalSettingIds"]
        .as_array()
        .expect("exact setting IDs")
        .iter()
        .map(|value| value.as_str().expect("setting ID").to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        method.setting_ids.iter().cloned().collect::<BTreeSet<_>>(),
        expected_setting_ids
    );
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.oracle_id, fixture["sourceOracleId"]);
    assert_eq!(execution.derived_result_row_count, 8);
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(method.limitations, execution.limitations);
    for disclosed_boundary in [
        "released-code count 1",
        "distinct variants",
        "upstream notification selection",
        "pre-compliance eligible participant set",
        "later aggregation and modeling",
    ] {
        assert!(
            method
                .limitations
                .iter()
                .any(|limitation| limitation.contains(disclosed_boundary)),
            "missing receipt limitation for {disclosed_boundary}"
        );
    }
}
