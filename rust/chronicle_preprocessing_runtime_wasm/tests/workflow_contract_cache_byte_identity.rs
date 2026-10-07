//! `workflow_contract()` and `source_column_output_reach()` are built once per
//! process (one WASM instance in the browser) and shared by every later
//! request. This file pins that sharing changes no output byte: the same
//! `ExecuteWorkspace` requests produce the same manifest and the same bytes
//! for every artifact:
//!
//! - when the tables are built during the request (first use in this process),
//! - when they are already built (the same requests again),
//! - and in a separate process whose first requests were a *different* request
//!   shape (app-only, no screen output, no aggregates, concurrent usage on):
//!   if either table had captured anything from the request that built it,
//!   the reference requests that follow there would differ from the ones here.
//!
//! The file deliberately holds a single test function, so nothing else in
//! this test binary touches the tables before the first run below. Each run
//! executes on its own thread: the runtime's workspace state cache
//! (`INCREMENTAL_RUNTIME_STATES`) and payload store are thread-local, so a
//! later run does not reuse the earlier run's workspace state. Other
//! process-wide state (payload-id counters, the embedded plan and certificate)
//! carries over between threads as it does between requests in one worker.
#![recursion_limit = "256"]

use chronicle_preprocessing_runtime_wasm::{
    execute_workspace_native, scientific_preflight_native, RuntimeArtifactMetadata,
    RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::Command;

const CHILD_OUTPUT_ENV: &str = "CHRONICLE_CONTRACT_CACHE_CHILD_OUTPUT";
const TEST_NAME: &str = "cold_warm_and_fresh_process_runs_emit_identical_bytes";

/// Artifact kinds whose bytes are built from the workflow contract on every
/// run; the comparison must actually cover them.
const CONTRACT_CONSUMING_KINDS: [&str; 4] = [
    "workflow-provenance-jsonld",
    "workflow-explorer-view-json",
    "workspace-root-json",
    "execution-ledger-json",
];

/// Artifacts built from `source_column_output_reach()` and the contract's
/// exact-cell table; only the provenance-evidence request emits them.
const REACH_CONSUMING_KINDS: [&str; 2] = [
    "source-coordinate-index-arrow",
    "source-result-influence-arrow",
];

#[derive(Clone, Copy)]
enum Shape {
    /// The request every comparison is about.
    Reference,
    /// A different option set, run first in the child process so the shared
    /// tables are built under it.
    Other,
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

/// Two participants, three days: app sessions bracketed by screen on/off
/// events, so app, screen, explorer, provenance and root outputs are all
/// non-trivial.
fn raw_csv() -> Vec<u8> {
    let mut csv = String::from(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
    );
    let apps = [
        ("Chat", "com.example.chat"),
        ("Video", "com.example.video"),
        ("Maps", "com.example.maps"),
    ];
    for participant in ["P001", "P002"] {
        for day in 5..=7 {
            for session in 0..6_usize {
                let hour = 8 + session * 2;
                let (label, package) = apps[session % apps.len()];
                let mut row = |minute: usize,
                               second: usize,
                               label: &str,
                               interaction: &str,
                               package: &str| {
                    csv.push_str(&format!(
                        "Synthetic Study,{participant},Synthetic User,{label},{interaction},{package},2026-01-{day:02} {hour:02}:{minute:02}:{second:02},America/Chicago\n"
                    ));
                };
                row(0, 0, "Android System", "Screen Interactive", "android");
                row(0, 5, label, "Activity Resumed", package);
                row(3 + session, 10, label, "Activity Paused", package);
                row(3 + session, 11, label, "Activity Stopped", package);
                row(
                    4 + session,
                    0,
                    "Android System",
                    "Screen Non-interactive",
                    "android",
                );
            }
        }
    }
    csv.into_bytes()
}

fn request_json(csv: &[u8], shape: Shape, provenance_evidence: bool) -> String {
    let reference = matches!(shape, Shape::Reference);
    serde_json::json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "requestId": "contract-cache-byte-identity",
        "command": EXECUTE_WORKSPACE_COMMAND,
        "workspaceRootDigest": null,
        "workspaceId": format!("sha256:{}", if reference { "c" } else { "d" }.repeat(64)),
        "inputFileName": "synthetic.csv",
        "inputSha256": digest(csv),
        "executionEngine": "sequential",
        "provenanceEvidence": provenance_evidence,
        "options": {
            "study_name": "Synthetic Study",
            "timezone": "America/Chicago",
            "usage_session_mode": if reference { "app_and_screen_usage" } else { "app_usage" },
            "include_app_output": true,
            "include_screen_output": reference,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
            "long_duration_threshold_ns": 43_200_000_000_000_i64,
            "proximity_interval_ns": 2_000_000_000_i64,
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
            "datetime_of_preprocessing": "2026-08-06 12:00:00 UTC",
            "model_concurrent_usage": !reference,
            "micro_use_classification_policy": "none",
            "minimum_usage_duration": 60.0,
            "minimum_duration_comparator": "strict_lt",
            "minimum_duration_disposition": "chronicle_blank_keep_row",
            "apply_minimum_usage_duration_to_concurrent_subintervals": false,
            "enable_aggregates": reference,
            "enable_plotting": false
        }
    })
    .to_string()
}

/// Every byte one request returns: the manifest, then each artifact's
/// metadata and bytes in emission order.
fn execute_once(shape: Shape, provenance_evidence: bool) -> Vec<(String, Vec<u8>)> {
    let csv = raw_csv();
    let request = request_json(&csv, shape, provenance_evidence);
    let support = RuntimeSupportFiles::default();
    scientific_preflight_native(&request, &csv, &support).expect("scientific preflight");
    let mut handle = execute_workspace_native(&request, &csv, &support).expect("execute workspace");
    let mut outputs = vec![("manifest".to_string(), handle.manifest_json().into_bytes())];
    for index in 0..handle.artifact_count() {
        let metadata_json = handle
            .artifact_metadata_json(index)
            .unwrap_or_else(|_| panic!("artifact {index} metadata"));
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&metadata_json).expect("parse artifact metadata");
        let bytes = handle
            .take_artifact_bytes(index)
            .unwrap_or_else(|_| panic!("artifact {} bytes", metadata.kind));
        outputs.push((
            format!("{index}:{}:metadata", metadata.kind),
            metadata_json.into_bytes(),
        ));
        outputs.push((format!("{index}:{}", metadata.kind), bytes));
    }
    outputs
}

/// The default request and its provenance-evidence variant, on a fresh thread
/// (fresh thread-local runtime state).
fn run_on_fresh_thread(shape: Shape) -> Vec<(String, Vec<u8>)> {
    std::thread::spawn(move || {
        let mut outputs = execute_once(shape, false);
        outputs.extend(
            execute_once(shape, true)
                .into_iter()
                .map(|(label, bytes)| (format!("provenance-evidence/{label}"), bytes)),
        );
        outputs
    })
    .join()
    .expect("runtime thread")
}

fn encode(outputs: &[(String, Vec<u8>)]) -> Vec<u8> {
    serde_json::to_vec(
        &outputs
            .iter()
            .map(|(label, bytes)| (label.as_str(), hex::encode(bytes)))
            .collect::<Vec<_>>(),
    )
    .expect("encode outputs")
}

fn decode(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    serde_json::from_slice::<Vec<(String, String)>>(bytes)
        .expect("decode child outputs")
        .into_iter()
        .map(|(label, hex_bytes)| (label, hex::decode(hex_bytes).expect("child hex")))
        .collect()
}

/// The bytes of artifact `kind` from the request without provenance evidence.
fn artifact_bytes<'a>(outputs: &'a [(String, Vec<u8>)], kind: &str) -> &'a [u8] {
    outputs
        .iter()
        .find(|(label, _)| {
            !label.starts_with("provenance-evidence/") && label.ends_with(&format!(":{kind}"))
        })
        .map(|(_, bytes)| bytes.as_slice())
        .unwrap_or_else(|| panic!("{kind} missing"))
}

/// Whether the outputs under `prefix` ("" = the request without provenance
/// evidence) hold a non-empty artifact `kind`.
fn has_artifact(outputs: &[(String, Vec<u8>)], prefix: &str, kind: &str) -> bool {
    outputs.iter().any(|(label, bytes)| {
        let in_scope = if prefix.is_empty() {
            !label.starts_with("provenance-evidence/")
        } else {
            label.starts_with(prefix)
        };
        in_scope && label.ends_with(&format!(":{kind}")) && !bytes.is_empty()
    })
}

fn assert_identical(expected: &[(String, Vec<u8>)], actual: &[(String, Vec<u8>)], what: &str) {
    let labels = |outputs: &[(String, Vec<u8>)]| {
        outputs
            .iter()
            .map(|(label, _)| label.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        labels(expected),
        labels(actual),
        "{what}: artifact list differs"
    );
    for ((label, left), (_, right)) in expected.iter().zip(actual) {
        assert!(
            left == right,
            "{what}: {label} differs ({} vs {})",
            digest(left),
            digest(right)
        );
    }
}

#[test]
fn cold_warm_and_fresh_process_runs_emit_identical_bytes() {
    if let Some(path) = std::env::var_os(CHILD_OUTPUT_ENV) {
        // Fresh process: build the shared tables under the other request
        // shape first, then run the reference requests.
        let other = run_on_fresh_thread(Shape::Other);
        // The tables really were built under the other request: its
        // provenance-evidence run reached the reach-consuming artifacts.
        for kind in REACH_CONSUMING_KINDS {
            assert!(
                has_artifact(&other, "provenance-evidence/", kind),
                "other shape: provenance-evidence/{kind} missing"
            );
        }
        let reference = run_on_fresh_thread(Shape::Reference);
        // And it really is a different request, not just another workspace
        // id: app-only mode emits no screen output, and its app rows differ
        // (concurrent-usage modelling on).
        assert!(!has_artifact(&other, "", "screen-csv"));
        assert!(has_artifact(&reference, "", "screen-csv"));
        assert_ne!(
            artifact_bytes(&other, "app-csv"),
            artifact_bytes(&reference, "app-csv"),
            "the other request shape must produce different app rows"
        );
        std::fs::write(path, encode(&reference)).expect("write child outputs");
        return;
    }
    let cold = run_on_fresh_thread(Shape::Reference);
    let warm = run_on_fresh_thread(Shape::Reference);

    for kind in CONTRACT_CONSUMING_KINDS {
        for prefix in ["", "provenance-evidence/"] {
            assert!(
                has_artifact(&cold, prefix, kind),
                "{prefix}{kind} missing from the compared outputs"
            );
        }
    }
    for kind in REACH_CONSUMING_KINDS {
        assert!(
            has_artifact(&cold, "provenance-evidence/", kind),
            "provenance-evidence/{kind} missing from the compared outputs"
        );
    }

    assert_identical(&cold, &warm, "warm tables vs cold tables");

    let child_output =
        PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("workflow-contract-cache-child.json");
    let _ = std::fs::remove_file(&child_output);
    // The child's own assertions (other shape reached the reach-consuming
    // artifacts and differs scientifically) fail it, and so this status.
    let status = Command::new(std::env::current_exe().expect("test executable"))
        .args([TEST_NAME, "--exact", "--test-threads=1", "--nocapture"])
        .env(CHILD_OUTPUT_ENV, &child_output)
        .status()
        .expect("spawn fresh test process");
    assert!(status.success(), "fresh-process run failed: {status}");
    let fresh = decode(&std::fs::read(&child_output).expect("read child outputs"));
    assert_identical(
        &cold,
        &fresh,
        "fresh process (tables built under another request) vs this process",
    );
}
