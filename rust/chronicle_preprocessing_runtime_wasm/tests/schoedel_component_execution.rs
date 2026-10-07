use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, BUILD_ENVIRONMENT_DIGEST, EXECUTE_WORKSPACE_COMMAND,
    IMPLEMENTATION_BUILD_DIGEST, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.schoedel-screen-preprocessing/v1";
const RAW: &[u8] = include_bytes!("fixtures/schoedel_component_patterns_raw.csv");
const COMMUNICATION: &[u8] =
    include_bytes!("fixtures/schoedel_component_patterns_communication.csv");
const EXPECTED: &[u8] = include_bytes!("fixtures/schoedel_component_patterns_expected.csv");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Schoedel component integration",
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
        "datetime_of_preprocessing": "2026-09-02 00:00:00 UTC",
        "minimum_usage_duration": 0.0
    }))
    .expect("valid component options")
}

fn request_for(raw: &[u8], method_profile_receipt: Option<Value>) -> String {
    let mut value = serde_json::to_value(RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "schoedel-component-integration".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: Some(sha256(b"previous-schoedel-component-root")),
        workspace_id: sha256(b"schoedel-component-integration-workspace"),
        input_file_name: "schoedel_component_patterns_raw.csv".into(),
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
    .expect("serialize request");
    if let Some(receipt) = method_profile_receipt {
        value["methodProfileReceipt"] = receipt;
    }
    serde_json::to_string(&value).expect("request JSON")
}

fn request(method_profile_receipt: Option<Value>) -> String {
    request_for(RAW, method_profile_receipt)
}

fn support(name: &str) -> RuntimeSupportFiles {
    let mut files = RuntimeSupportFiles::default();
    files
        .put_with_name("phonestudy_ps_communication_file", name, COMMUNICATION)
        .map_err(|_| "support insertion failed")
        .expect("source support CSV");
    files
}

#[test]
fn public_component_boundary_executes_source_shaped_fixture_and_binds_receipts() {
    let (registration, _) = literature_component_execution_unit(COMPONENT_ID)
        .expect("registered component execution unit");
    assert_eq!(
        registration.required_support_roles,
        ["phonestudy_ps_communication_file"]
    );
    let mut handle = execute_literature_component_native(
        COMPONENT_ID,
        &request(None),
        RAW,
        &support("ps_communication.csv"),
    )
    .expect("component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(
        manifest.protocol_version,
        "chronicle-literature-component-runtime/v1"
    );
    assert_eq!(manifest.command, "ExecuteLiteratureComponent");
    assert_eq!(manifest.component_id, COMPONENT_ID);
    assert_eq!(manifest.input_digest, sha256(RAW));
    assert_eq!(
        manifest.previous_workspace_root_digest,
        Some(sha256(b"previous-schoedel-component-root"))
    );
    assert_eq!(manifest.source_row_count, 15);
    assert_eq!(manifest.derived_result_row_count, 14);
    assert_eq!(manifest.implementation_digest, IMPLEMENTATION_BUILD_DIGEST);
    assert_eq!(manifest.build_environment_digest, BUILD_ENVIRONMENT_DIGEST);
    assert!(manifest
        .input_adapter_contract_digest
        .starts_with("sha256:"));
    assert!(manifest
        .input_adapter_conformance_digest
        .starts_with("sha256:"));
    assert!(manifest
        .android_method_profile_registry_content_digest
        .starts_with("sha256:"));

    let expected_kinds = BTreeSet::from([
        "literature-component-method-receipt-json",
        "literature-input-adaptation-receipt-json",
        "literature-schoedel-screen-preprocessing-csv",
        "literature-component-execution-receipt-json",
        "artifact-closure-json",
        "workspace-root-json",
    ]);
    let mut payloads = BTreeMap::new();
    let mut metadata_by_kind = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .map_err(|_| "metadata access failed")
                .expect("artifact metadata"),
        )
        .expect("metadata JSON");
        let bytes = handle
            .take_artifact_bytes(index)
            .map_err(|_| "payload access failed")
            .expect("artifact bytes");
        assert_eq!(metadata.digest, sha256(&bytes));
        metadata_by_kind.insert(metadata.kind.clone(), metadata.clone());
        payloads.insert(metadata.kind, bytes);
    }
    assert_eq!(
        payloads.keys().map(String::as_str).collect::<BTreeSet<_>>(),
        expected_kinds
    );
    assert!(!payloads.contains_key("literature-input-adapted-csv"));
    assert_eq!(
        payloads["literature-schoedel-screen-preprocessing-csv"],
        EXPECTED
    );

    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("component method receipt");
    assert_eq!(method.component_id, COMPONENT_ID);
    assert_eq!(
        method.parent_method_profile_id,
        "method-profile:doi:10.1016/j.chb.2023.107977"
    );
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.setting_ids.len(), 16);
    assert_eq!(method.setting_ids.iter().collect::<BTreeSet<_>>().len(), 16);
    assert_eq!(method.input_bindings.len(), 16);
    assert_eq!(method.implementation_digest, manifest.implementation_digest);
    assert_eq!(
        method.build_environment_digest,
        manifest.build_environment_digest
    );
    assert_eq!(
        method.input_adapter_contract_digest,
        manifest.input_adapter_contract_digest
    );
    assert_eq!(
        method.input_adapter_conformance_digest,
        manifest.input_adapter_conformance_digest
    );
    assert_eq!(
        method.android_method_profile_registry_content_digest,
        manifest.android_method_profile_registry_content_digest
    );

    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("component execution receipt");
    assert_eq!(execution.component_execution_status, "executed");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.canonical_kernel_input_digest, None);
    assert_eq!(execution.original_input_digest, sha256(RAW));
    assert_eq!(
        execution.support_artifact_digests["phonestudy_ps_communication_file"],
        sha256(COMMUNICATION)
    );
    assert_eq!(
        execution.support_adapter_input_digests["phonestudy_ps_communication_file"],
        sha256(COMMUNICATION)
    );
    assert_eq!(execution.derived_result_digest, sha256(EXPECTED));
    assert_eq!(execution.derived_result_row_count, 14);
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(
        execution.implementation_digest,
        manifest.implementation_digest
    );
    assert_eq!(
        execution.build_environment_digest,
        manifest.build_environment_digest
    );
    assert_eq!(
        execution.input_adapter_contract_digest,
        manifest.input_adapter_contract_digest
    );
    assert_eq!(
        execution.input_adapter_conformance_digest,
        manifest.input_adapter_conformance_digest
    );
    assert_eq!(
        execution.android_method_profile_registry_content_digest,
        manifest.android_method_profile_registry_content_digest
    );

    let root_bytes = &payloads["workspace-root-json"];
    let root: Value = serde_json::from_slice(root_bytes).expect("component root JSON");
    assert_eq!(sha256(root_bytes), manifest.workspace_root_digest);
    assert_eq!(
        metadata_by_kind["workspace-root-json"].digest,
        manifest.workspace_root_digest
    );
    assert_eq!(
        root["protocolVersion"],
        "chronicle-literature-component-root/v1"
    );
    assert_eq!(root["workspaceId"], manifest.workspace_id);
    assert_eq!(
        root["previousWorkspaceRootDigest"],
        sha256(b"previous-schoedel-component-root")
    );
    assert_eq!(root["inputDigest"], sha256(RAW));
    assert_eq!(root["componentId"], COMPONENT_ID);
    assert_eq!(
        root["parentMethodProfileId"],
        method.parent_method_profile_id
    );
    assert_eq!(root["sourceWorkId"], method.source_work_id);
    assert_eq!(
        root["sourceMethodVariantId"],
        method.source_method_variant_id
    );
    assert_eq!(root["methodProfileVersion"], method.method_profile_version);
    assert_eq!(root["settingIds"], json!(method.setting_ids));
    assert_eq!(root["fullProfileExecutionStatus"], "blocked");
    assert_eq!(root["oracleId"], execution.oracle_id);
    assert_eq!(root["implementationDigest"], IMPLEMENTATION_BUILD_DIGEST);
    assert_eq!(root["buildEnvironmentDigest"], BUILD_ENVIRONMENT_DIGEST);
    assert_eq!(
        root["androidMethodProfileRegistryContentDigest"],
        manifest.android_method_profile_registry_content_digest
    );
    assert_eq!(root["assignmentDigests"]["raw_chronicle_csv"], sha256(RAW));
    assert_eq!(
        root["assignmentDigests"]["phonestudy_ps_communication_file"],
        sha256(COMMUNICATION)
    );
    assert_eq!(
        root["supportArtifactDigests"]["phonestudy_ps_communication_file"],
        sha256(COMMUNICATION)
    );
    assert_eq!(
        root["supportAdapterInputDigests"]["phonestudy_ps_communication_file"],
        sha256(COMMUNICATION)
    );

    let closure_bytes = &payloads["artifact-closure-json"];
    let closure: Value = serde_json::from_slice(closure_bytes).expect("component closure JSON");
    assert_eq!(sha256(closure_bytes), manifest.artifact_closure_digest);
    assert_eq!(
        root["artifactClosureDigest"],
        manifest.artifact_closure_digest
    );
    assert_eq!(
        metadata_by_kind["workspace-root-json"].derived_from,
        vec![manifest.artifact_closure_digest.clone()]
    );
    assert_eq!(
        closure["protocolVersion"],
        "chronicle-literature-component-artifact-closure/v1"
    );
    for field in [
        "workspaceId",
        "previousWorkspaceRootDigest",
        "inputDigest",
        "assignmentDigests",
        "supportArtifactDigests",
        "supportAdapterInputDigests",
        "componentId",
        "parentMethodProfileId",
        "fullProfileExecutionStatus",
        "sourceWorkId",
        "sourceMethodVariantId",
        "methodProfileVersion",
        "settingIds",
        "componentExecutionReceiptDigest",
        "oracleId",
        "implementationDigest",
        "buildEnvironmentDigest",
        "inputAdapterContractDigest",
        "inputAdapterConformanceDigest",
        "androidMethodProfileRegistryContentDigest",
    ] {
        assert_eq!(closure[field], root[field], "root/closure drift: {field}");
    }
    let closure_artifacts: Vec<RuntimeArtifactMetadata> =
        serde_json::from_value(closure["artifacts"].clone()).expect("closure metadata");
    let component_kinds = expected_kinds
        .iter()
        .copied()
        .filter(|kind| !matches!(*kind, "artifact-closure-json" | "workspace-root-json"))
        .collect::<BTreeSet<_>>();
    assert_eq!(closure_artifacts.len(), 4);
    assert_eq!(
        closure_artifacts
            .iter()
            .map(|artifact| artifact.kind.as_str())
            .collect::<BTreeSet<_>>(),
        component_kinds
    );
    for metadata in &closure_artifacts {
        assert_eq!(metadata.digest, sha256(&payloads[&metadata.kind]));
        assert_eq!(metadata.size, payloads[&metadata.kind].len() as u64);
        assert_eq!(
            metadata.artifact_id,
            metadata_by_kind[&metadata.kind].artifact_id
        );
    }
    let closure_digests = closure_artifacts
        .iter()
        .map(|artifact| artifact.digest.as_str())
        .collect::<BTreeSet<_>>();
    let root_digests = root["artifactDigests"]
        .as_array()
        .expect("root artifact digests")
        .iter()
        .map(|digest| digest.as_str().expect("digest string"))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        root_digests,
        closure_digests
            .into_iter()
            .chain(std::iter::once(manifest.artifact_closure_digest.as_str()))
            .collect()
    );

    let mut tampered_closure = closure_bytes.clone();
    tampered_closure[0] ^= 1;
    assert_ne!(sha256(&tampered_closure), manifest.artifact_closure_digest);
    let mut tampered_root = root.clone();
    tampered_root["inputDigest"] = Value::String(sha256(b"tampered input"));
    assert_ne!(
        sha256(&serde_jcs::to_vec(&tampered_root).expect("tampered root JCS")),
        manifest.workspace_root_digest
    );
}

#[test]
fn component_boundary_refuses_non_csv_support_and_injected_profile_authority() {
    let xlsx_error = execute_literature_component_native(
        COMPONENT_ID,
        &request(None),
        RAW,
        &support("ps_communication.xlsx"),
    )
    .err()
    .expect("XLSX refusal");
    assert!(xlsx_error.contains("source-faithful CSV format"));

    let injected_error = execute_literature_component_native(
        COMPONENT_ID,
        &request(Some(json!({}))),
        RAW,
        &support("ps_communication.csv"),
    )
    .err()
    .expect("injected receipt refusal");
    assert!(
        injected_error.contains("invalid request")
            || injected_error.contains("constructs its receipt")
    );

    let mut bad_digest_request: Value =
        serde_json::from_str(&request(None)).expect("component request JSON");
    bad_digest_request["inputSha256"] = Value::String(sha256(b"wrong raw bytes"));
    let digest_error = execute_literature_component_native(
        COMPONENT_ID,
        &serde_json::to_string(&bad_digest_request).expect("bad request JSON"),
        RAW,
        &support("ps_communication.csv"),
    )
    .err()
    .expect("raw digest refusal");
    assert!(digest_error.contains("input digest mismatch"));
}

#[test]
fn component_boundary_refuses_cross_participant_communication_identity() {
    let raw =
        b"row_id,user_id,activityName,event,client_db_id,communication_id,timestamp.corrected\n\
u1_call,U1,PHONE,OUTGOING,u1_call,shared,2020-09-21 10:00:00.000\n\
u2_call,U2,PHONE,OUTGOING,u2_call,shared,2020-09-21 10:01:00.000\n";
    let error = execute_literature_component_native(
        COMPONENT_ID,
        &request_for(raw, None),
        raw,
        &support("ps_communication.csv"),
    )
    .err()
    .expect("cross-participant communication-ID refusal");
    assert!(error.contains("communication_id to belong to exactly one participant"));
}
