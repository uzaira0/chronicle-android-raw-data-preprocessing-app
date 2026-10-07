use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const NOTIFICATION_COMPONENT: &str = "chronicle.notification-seen-time/v1";
const TOUCH_COMPONENT: &str = "chronicle.touch-keyboard-event-vector/v1";
const MOTION_COMPONENT: &str = "chronicle.motion-sensor-vector/v1";

const TOUCH_FIXTURE: &str = include_str!("fixtures/touch_keyboard_event_vector_acii_8925518.json");
const MOTION_FIXTURE: &str = include_str!("fixtures/motion_sensor_vector_inffus_2018_09_002.json");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Bounded literature input component",
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

fn request(component_id: &str, raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: format!("held-component-{}", component_id.replace(['.', '/'], "-")),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(format!("{component_id}-workspace").as_bytes()),
        input_file_name: format!("{}.csv", component_id.replace(['.', '/'], "-")),
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

fn fixture_csv(fixture: &str) -> Vec<u8> {
    let fixture: Value = serde_json::from_str(fixture).expect("source fixture JSON");
    let mut csv = fixture["validCsvLines"]
        .as_array()
        .expect("valid CSV lines")
        .iter()
        .map(|line| line.as_str().expect("CSV line"))
        .collect::<Vec<_>>()
        .join("\n");
    csv.push('\n');
    csv.into_bytes()
}

struct ExecutedComponent {
    manifest: LiteratureComponentRuntimeManifest,
    method: LiteratureComponentMethodReceipt,
    execution: LiteratureComponentExecutionReceipt,
    payloads: BTreeMap<String, Vec<u8>>,
}

fn execute(component_id: &str, raw: &[u8]) -> ExecutedComponent {
    let mut handle = execute_literature_component_native(
        component_id,
        &request(component_id, raw),
        raw,
        &RuntimeSupportFiles::default(),
    )
    .unwrap_or_else(|error| panic!("{component_id}: {error}"));
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
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
    let method = serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
        .expect("method receipt");
    let execution =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    ExecutedComponent {
        manifest,
        method,
        execution,
        payloads,
    }
}

fn assert_component_identity(
    component: &ExecutedComponent,
    component_id: &str,
    expected_settings: BTreeSet<&str>,
) {
    assert_eq!(component.manifest.component_id, component_id);
    assert_eq!(component.method.component_id, component_id);
    assert_eq!(component.execution.component_id, component_id);
    assert_eq!(component.method.parent_profile_execution_status, "blocked");
    assert_eq!(component.execution.full_profile_execution_status, "blocked");
    assert!(!component.method.limitations.is_empty());
    assert_eq!(
        component.execution.limitations,
        component.method.limitations
    );
    assert_eq!(
        component
            .method
            .setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        expected_settings
    );
    assert!(!component.execution.kernel_input_eligible);
    assert_eq!(component.execution.canonical_kernel_input_digest, None);
}

#[test]
fn two_registered_held_components_execute_through_the_existing_runner() {
    let notification = b"participant_id,timestamp_ns,event_kind,notification_id\
\np-zero,0,phone_unlocked,\
\np-zero,1,notification_arrival,n-zero\
\np-exact,0,phone_locked,\
\np-exact,1,notification_arrival,n-exact\
\np-exact,7200000000001,phone_unlocked,\
\np-over,0,phone_locked,\
\np-over,1,notification_arrival,n-over\
\np-over,7200000000002,phone_unlocked,\
\np-none,0,phone_locked,\
\np-none,1,notification_arrival,n-none\n";
    let notification = execute(NOTIFICATION_COMPONENT, notification);
    assert_component_identity(
        &notification,
        NOTIFICATION_COMPONENT,
        BTreeSet::from([
            "method-setting-19df120d26b64e11efb807ab",
            "method-setting-74d0f04af4fa8ee64ddd9b81",
            "method-setting-f095986a1bdd7eb9f5ce9b0d",
        ]),
    );
    assert_eq!(notification.manifest.source_row_count, 10);
    assert_eq!(notification.manifest.derived_result_row_count, 4);
    let notification_csv =
        std::str::from_utf8(&notification.payloads["literature-notification-seen-time-csv"])
            .expect("notification output UTF-8");
    assert!(notification_csv.contains("p-zero,n-zero,1,retained,1,0,already_unlocked"));
    assert!(notification_csv
        .contains("p-exact,n-exact,1,retained,7200000000001,7200000000000,next_unlock"));
    assert!(notification_csv.contains(
        "p-over,n-over,1,excluded,,,,exceeded_maximum_seen_time,7200000000002,7200000000001"
    ));
    assert!(notification_csv.contains("p-none,n-none,1,excluded,,,,no_following_unlock"));

    let touch = execute(TOUCH_COMPONENT, &fixture_csv(TOUCH_FIXTURE));
    assert_component_identity(
        &touch,
        TOUCH_COMPONENT,
        BTreeSet::from([
            "method-setting-293e63181b72ee0e0b7cc5bc",
            "method-setting-54dfd51fa90147857f7f2522",
            "method-setting-7d8c397698c8e6a833b3f65f",
            "method-setting-a2b695eb8449919ee41d5b04",
            "method-setting-d46f6478867dec906dac2b80",
            "method-setting-e6ca0f6eda4ab9ca31f87d46",
            "method-setting-ea0c43ce79fd78c9089ee6a7",
        ]),
    );
    assert_eq!(touch.manifest.source_row_count, 2);
    assert_eq!(touch.manifest.derived_result_row_count, 2);
    let touch_csv =
        std::str::from_utf8(&touch.payloads["literature-touch-keyboard-event-vector-csv"])
            .expect("touch output UTF-8");
    assert!(touch_csv.contains(
        "source_record_index,participant_id,event_timestamp,source_row_id,inter_tap_duration,alphanumeric,special_character,backspace,pressure,speed,touch_time"
    ));
    assert!(touch_csv.contains(
        "1,participant-01,2019-03-04T05:06:07+05:30,row-a,0.125,true,false,false,0.42,3.5,0.08"
    ));
}

#[test]
fn nonretained_motion_parent_is_refused_by_the_registered_runner() {
    // The companion-only source remains acquisition-pending and outside the
    // frozen corpus. Standalone motion_sensor_vector tests cover its mapping;
    // that does not make the historical component's parent registered.
    let raw = fixture_csv(MOTION_FIXTURE);
    let error = execute_literature_component_native(
        MOTION_COMPONENT,
        &request(MOTION_COMPONENT, &raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("nonretained parent must not produce an execution receipt");
    assert_eq!(
        error,
        "literature component parent profile is not registered"
    );
}
