//! Product runtime boundary for the Chronicle raw-data preprocessing app.
//!
//! This crate composes the existing Rust preprocessing kernel with the
//! product-owned semantic adapter. It is deliberately not a reusable graph
//! engine: the reusable surface is the versioned request/result envelope,
//! content-addressed artifacts, role assignments, obligations, and evidence.

mod binary_exports;

use calamine::{Reader, Xlsx};
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, PipelineV2Options, PipelineV2OptionsJson, PipelineV2Result,
    PipelineV2SupportFiles,
};
use chronicle_preprocessing_semantic_adapter::{
    embedded_plan, embedded_plan_bytes, embedded_profile_bytes, embedded_profile_lock_bytes,
    embedded_runtime_authority_bytes, evaluate_materialization,
    journal::{EvidenceJournal, Transition},
    views::{artifact_view, encode_view, explanation_view, obligation_view, stage_view},
    ArtifactRef, ArtifactStore, CapabilityExecutor, ExecutionInputs, ExecutionStatus,
    MaterializationState, MemoryCas, NodeExecution, PhysicalStage, ProducedArtifact,
    RoleAssignment, Scheduler, Workspace, EMBEDDED_PLAN_SHA256, EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256, EMBEDDED_RUNTIME_AUTHORITY_SHA256,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

pub const RUNTIME_PROTOCOL_VERSION: &str = "chronicle-preprocessing-runtime/v1";
pub const EXECUTE_WORKSPACE_COMMAND: &str = "ExecuteWorkspace";
/// Compatibility alias retained while stored clients migrate to the authority
/// command. Runtime manifests always report `ExecuteWorkspace`.
pub const BOUNDED_COMMAND: &str = EXECUTE_WORKSPACE_COMMAND;
const LEGACY_BOUNDED_COMMAND: &str = "ExecuteBoundedV2Shadow";
const SUPPORT_ROLES: &[&str] = &[
    "filter_file",
    "apps_forcing_screen_open_file",
    "background_apps_file",
    "app_codebook_file",
    "study_dates_file",
    "device_sharing_file",
    "survey_attribution_file",
    "enrolled_devices_file",
];

#[wasm_bindgen]
pub fn runtime_version() -> String {
    format!(
        "chronicle-preprocessing-runtime/{}",
        env!("CARGO_PKG_VERSION")
    )
}

/// Project the embedded product plan for interaction before any raw artifact
/// has been ingested. The projection is produced by the same Rust adapter and
/// option vocabulary used during execution, so the browser never needs a
/// second TypeScript topology or applicability implementation.
#[wasm_bindgen]
pub fn plan_stage_view_json(options_json: &str) -> Result<String, JsValue> {
    plan_stage_view_native(options_json).map_err(|error| JsValue::from_str(&error))
}

pub fn plan_stage_view_native(options_json: &str) -> Result<String, String> {
    let options: PipelineV2OptionsJson = serde_json::from_str(options_json)
        .map_err(|error| format!("invalid plan-view options: {error}"))?;
    let semantic_options = semantic_options_value(&options)?;
    let plan = embedded_plan();
    let materialization = evaluate_materialization(
        &plan,
        &BTreeMap::new(),
        &semantic_options,
        &BTreeSet::new(),
        &BTreeSet::new(),
    );
    let projection_root = sha256(
        &serde_jcs::to_vec(&serde_json::json!({
            "command": "GetPlanView",
            "planDigest": EMBEDDED_PLAN_SHA256,
            "profileLockDigest": EMBEDDED_PROFILE_LOCK_SHA256,
            "options": semantic_options,
        }))
        .map_err(|error| format!("canonicalize plan view root: {error}"))?,
    );
    serde_json::to_string(&stage_view(
        &plan,
        &materialization,
        &[],
        &semantic_options,
        None,
        0,
        &projection_root,
    ))
    .map_err(|error| format!("serialize plan stage view: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRequest {
    pub protocol_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_root_digest: Option<String>,
    pub workspace_id: String,
    pub input_file_name: String,
    pub input_sha256: String,
    pub options: PipelineV2OptionsJson,
}

impl RuntimeRequest {
    fn validate(&self, csv_bytes: &[u8]) -> Result<(), String> {
        if self.protocol_version != RUNTIME_PROTOCOL_VERSION {
            return Err(format!(
                "unsupported protocol version: {}",
                self.protocol_version
            ));
        }
        if self.command != EXECUTE_WORKSPACE_COMMAND && self.command != LEGACY_BOUNDED_COMMAND {
            return Err(format!("unsupported command: {}", self.command));
        }
        if self.request_id.trim().is_empty() {
            return Err("requestId is required".into());
        }
        if self.input_file_name.trim().is_empty() {
            return Err("inputFileName is required".into());
        }
        let actual = sha256(csv_bytes);
        if self.input_sha256 != actual {
            return Err(format!(
                "input digest mismatch: declared={} actual={actual}",
                self.input_sha256
            ));
        }
        if let Some(root) = &self.workspace_root_digest {
            validate_digest(root).map_err(|message| format!("workspaceRootDigest {message}"))?;
        }
        validate_digest(&self.workspace_id).map_err(|message| format!("workspaceId {message}"))?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactMetadata {
    pub artifact_id: String,
    pub kind: String,
    pub media_type: String,
    pub digest: String,
    pub size: u64,
    pub derived_from: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCounts {
    pub original: u32,
    pub processed: u32,
    pub app: u32,
    pub screen: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessingSummary {
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub protocol_version: String,
    pub request_id: String,
    pub command: String,
    pub implementation: String,
    pub scope: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub runtime_authority_digest: String,
    pub product_contract_digest: String,
    pub previous_workspace_root_digest: Option<String>,
    pub workspace_id: String,
    pub workspace_root_digest: String,
    pub input: ArtifactRef,
    pub role_assignments: Vec<RoleAssignment>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
    pub node_executions: Vec<NodeExecution>,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
    pub counts: RuntimeCounts,
    pub processing_summary: RuntimeProcessingSummary,
    pub journal_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootCommit<'a> {
    protocol_version: &'a str,
    command: &'a str,
    product_contract_digest: &'a str,
    plan_digest: &'a str,
    profile_digest: &'a str,
    profile_lock_digest: &'a str,
    runtime_authority_digest: &'a str,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<String>,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    artifact_digests: Vec<&'a str>,
    journal_digest: &'a str,
    artifact_closure_digest: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactClosure<'a> {
    protocol_version: &'static str,
    workspace_id: &'a str,
    input_digest: &'a str,
    plan_digest: &'static str,
    profile_digest: &'static str,
    profile_lock_digest: &'static str,
    runtime_authority_digest: &'static str,
    product_contract_digest: &'static str,
    journal_digest: &'a str,
    artifacts: Vec<&'a RuntimeArtifactMetadata>,
}

struct RuntimeArtifact {
    metadata: RuntimeArtifactMetadata,
    bytes: Vec<u8>,
}

struct IngressMaterialization {
    input: ArtifactRef,
    assignments: BTreeMap<String, RoleAssignment>,
    materialization: chronicle_preprocessing_semantic_adapter::Materialization,
    journal: EvidenceJournal,
}

#[wasm_bindgen]
pub struct RuntimeHandle {
    manifest_json: String,
    artifacts: Vec<RuntimeArtifact>,
}

#[derive(Default)]
struct IncrementalRuntimeState {
    workspace: Workspace<MemoryCas>,
    last_result: Option<PipelineV2Result>,
    last_workspace_root: Option<String>,
}

thread_local! {
    static INCREMENTAL_RUNTIME_STATES: RefCell<BTreeMap<String, IncrementalRuntimeState>> =
        const { RefCell::new(BTreeMap::new()) };
}

#[cfg(test)]
thread_local! {
    static FUSED_PHYSICAL_EXECUTION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

struct FusedPhysicalExecutor<'a> {
    csv_bytes: &'a [u8],
    options: &'a PipelineV2Options,
    support: &'a ResolvedSupportFiles,
    result: Option<PipelineV2Result>,
    error: Option<String>,
}

impl FusedPhysicalExecutor<'_> {
    fn ensure_result(&mut self) -> Result<&PipelineV2Result, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        if self.result.is_none() {
            #[cfg(test)]
            FUSED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(count.get() + 1));
            match run_pipeline_v2_with_supports(
                self.csv_bytes,
                self.options,
                PipelineV2SupportFiles {
                    filter_csv: self.support.get("filter_file"),
                    apps_forcing_csv: self.support.get("apps_forcing_screen_open_file"),
                    background_apps_csv: self.support.get("background_apps_file"),
                    codebook_csv: self.support.get("app_codebook_file"),
                    study_dates_csv: self.support.get("study_dates_file"),
                    device_sharing_csv: self.support.get("device_sharing_file"),
                    survey_attribution_csv: self.support.get("survey_attribution_file"),
                    enrolled_devices_csv: self.support.get("enrolled_devices_file"),
                },
            ) {
                Ok(result) => self.result = Some(result),
                Err(error) => {
                    self.error = Some(error.clone());
                    return Err(error);
                }
            }
        }
        Ok(self.result.as_ref().expect("result initialized"))
    }
}

impl CapabilityExecutor for FusedPhysicalExecutor<'_> {
    fn execute(
        &mut self,
        stage: PhysicalStage,
        inputs: &ExecutionInputs<'_>,
    ) -> Result<ProducedArtifact, String> {
        let digest = pipeline_result_digest(self.ensure_result()?);
        let bytes = serde_jcs::to_vec(&serde_json::json!({
            "physicalExecution": "fused-rust-pipeline-v2",
            "logicalNode": inputs.node_id,
            "physicalStage": stage,
            "observableResultDigest": digest,
        }))
        .map_err(|error| error.to_string())?;
        Ok(ProducedArtifact {
            media_type: "application/vnd.chronicle.node-fingerprint+json".into(),
            bytes,
        })
    }
}

fn pipeline_result_digest(result: &PipelineV2Result) -> String {
    let mut digest = Sha256::new();
    for bytes in [
        &result.app_csv_bytes,
        &result.screen_csv_bytes,
        &result.day_coverage_csv_bytes,
        &result.compliance_csv_bytes,
        &result.credited_app_csv_bytes,
        &result.review_summary_json_bytes,
        &result.visualization_data_json_bytes,
    ] {
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    for aggregate in &result.aggregate_csv_outputs {
        digest.update(aggregate.kind.as_bytes());
        digest.update(aggregate.row_count.to_le_bytes());
        digest.update((aggregate.bytes.len() as u64).to_le_bytes());
        digest.update(&aggregate.bytes);
    }
    digest.update(
        serde_jcs::to_vec(&serde_json::json!({
            "original": result.original_row_count,
            "processed": result.processed_row_count,
            "app": result.app_row_count,
            "screen": result.screen_row_count,
            "duplicateTimestampsCorrected": result.duplicate_timestamps_corrected,
            "exactDuplicateRowsRemoved": result.exact_duplicate_rows_removed,
            "availableTimezones": result.available_timezones,
            "timezone": result.timezone,
            "timezoneAction": result.timezone_action,
            "rowsBeforeTimezoneHandling": result.rows_before_timezone_handling,
            "rowsAfterTimezoneHandling": result.rows_after_timezone_handling,
            "rowsRemovedByTimezone": result.rows_removed_by_timezone,
            "rowLineage": result.row_lineage,
        }))
        .expect("pipeline result digest metadata is serializable"),
    );
    format!("sha256:{}", hex::encode(digest.finalize()))
}

/// Project the stable Rust ABI onto the product plan's option vocabulary.
///
/// The plan intentionally uses product-facing semantic names while the fused
/// kernel retains its established wire field names. Keeping this adapter
/// explicit prevents the reusable scheduler from learning Chronicle-specific
/// aliases and makes every applicability/invalidation input inspectable.
fn semantic_options_value(options: &PipelineV2OptionsJson) -> Result<Value, String> {
    let mut value = serde_json::to_value(options)
        .map_err(|error| format!("serialize semantic options: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "serialized semantic options must be an object".to_string())?;
    for (key, value) in [
        ("process_app_usage", Value::Bool(options.include_app_output)),
        (
            "process_screen_usage",
            Value::Bool(options.include_screen_output),
        ),
        ("selected_timezone", Value::String(options.timezone.clone())),
        (
            "use_apps_forcing_screen_open_file",
            Value::Bool(options.use_apps_forcing_screen_open),
        ),
        (
            "long_duration_threshold_hours",
            Value::from(options.long_duration_threshold_ns as f64 / 3_600_000_000_000.0),
        ),
        (
            "proximity_interval_seconds",
            Value::from(options.proximity_interval_ns as f64 / 1_000_000_000.0),
        ),
        (
            "same_app_interaction_types_to_stop_usage_at",
            Value::from(options.same_app_stop_types.clone()),
        ),
        (
            "other_interaction_types_to_stop_usage_at",
            Value::from(options.other_stop_types.clone()),
        ),
        (
            "screen_usage_auto_lock_timeout_seconds",
            Value::from(options.screen_auto_lock_timeout_seconds),
        ),
        (
            "screen_usage_auto_lock_tolerance_seconds",
            Value::from(options.screen_auto_lock_tolerance_seconds),
        ),
        (
            "screen_usage_manual_lock_max_tail_gap_seconds",
            Value::from(options.screen_manual_lock_max_tail_seconds),
        ),
        (
            "screen_usage_keyguard_near_stop_seconds",
            Value::from(options.screen_keyguard_near_stop_seconds),
        ),
    ] {
        object.insert(key.into(), value);
    }
    Ok(value)
}

/// Product support artifacts injected by registered semantic role. Adding a
/// role does not change the execution ABI or reorder existing inputs.
#[wasm_bindgen]
#[derive(Default)]
pub struct RuntimeSupportFiles {
    files: BTreeMap<String, RuntimeSupportFile>,
}

struct RuntimeSupportFile {
    name: String,
    bytes: Vec<u8>,
}

struct ResolvedSupportFile {
    media_type: &'static str,
    original_bytes: Vec<u8>,
    pipeline_csv: Vec<u8>,
    normalized_from_xlsx: bool,
}

#[derive(Default)]
struct ResolvedSupportFiles {
    files: BTreeMap<String, ResolvedSupportFile>,
}

#[wasm_bindgen]
impl RuntimeSupportFiles {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&mut self, role: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.put_native(role, &format!("{role}.csv"), bytes)
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn put_with_name(&mut self, role: &str, name: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.put_native(role, name, bytes)
            .map_err(|error| JsValue::from_str(&error))
    }
}

impl RuntimeSupportFiles {
    fn put_native(&mut self, role: &str, name: &str, bytes: &[u8]) -> Result<(), String> {
        if !SUPPORT_ROLES.contains(&role) {
            return Err(format!("unsupported support role: {role}"));
        }
        if bytes.is_empty() {
            return Err(format!(
                "support role {role} cannot contain an empty artifact"
            ));
        }
        if name.trim().is_empty() {
            return Err(format!("support role {role} requires a file name"));
        }
        if self.files.contains_key(role) {
            return Err(format!("duplicate support role: {role}"));
        }
        self.files.insert(
            role.into(),
            RuntimeSupportFile {
                name: name.into(),
                bytes: bytes.to_vec(),
            },
        );
        Ok(())
    }

    fn resolve(&self) -> Result<ResolvedSupportFiles, String> {
        let mut resolved = ResolvedSupportFiles::default();
        for (role, file) in &self.files {
            let lower = file.name.to_ascii_lowercase();
            let (media_type, pipeline_csv, normalized_from_xlsx) = if lower.ends_with(".csv") {
                ("text/csv", file.bytes.clone(), false)
            } else if lower.ends_with(".xlsx") {
                (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    xlsx_to_csv(&file.bytes)
                        .map_err(|error| format!("{role} ({name}): {error}", name = file.name))?,
                    true,
                )
            } else if lower.ends_with(".xls") {
                return Err(format!(
                    "unsupported support file format for {role}: {}. Convert legacy .xls workbooks to .xlsx or CSV",
                    file.name
                ));
            } else {
                return Err(format!(
                    "unsupported support file format for {role}: {}",
                    file.name
                ));
            };
            resolved.files.insert(
                role.clone(),
                ResolvedSupportFile {
                    media_type,
                    original_bytes: file.bytes.clone(),
                    pipeline_csv,
                    normalized_from_xlsx,
                },
            );
        }
        Ok(resolved)
    }
}

impl ResolvedSupportFiles {
    fn get(&self, role: &str) -> &[u8] {
        self.files
            .get(role)
            .map(|file| file.pipeline_csv.as_slice())
            .unwrap_or_default()
    }
}

fn assign_incremental_artifact(
    workspace: &mut Workspace<MemoryCas>,
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    role: &str,
    media_type: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let artifact = workspace
        .store
        .put(media_type, bytes.to_vec(), Vec::new())
        .map_err(|error| error.to_string())?;
    workspace
        .assign(plan, role, artifact)
        .map_err(|error| error.to_string())
}

fn execute_incremental_pipeline(
    request: &RuntimeRequest,
    csv_bytes: &[u8],
    options_bytes: &[u8],
    options_value: &Value,
    options: &PipelineV2Options,
    support: &ResolvedSupportFiles,
) -> Result<(PipelineV2Result, Vec<NodeExecution>), String> {
    let plan = embedded_plan();
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.entry(request.workspace_id.clone()).or_default();
        if request.workspace_root_digest != state.last_workspace_root {
            *state = IncrementalRuntimeState::default();
        }
        state.workspace.assignments.clear();
        state.workspace.options = options_value.clone();
        assign_incremental_artifact(
            &mut state.workspace,
            &plan,
            "raw_chronicle_csv",
            "text/csv",
            csv_bytes,
        )?;
        assign_incremental_artifact(
            &mut state.workspace,
            &plan,
            "processing_options",
            "application/json",
            options_bytes,
        )?;
        for (role, file) in &support.files {
            assign_incremental_artifact(
                &mut state.workspace,
                &plan,
                role,
                file.media_type,
                &file.original_bytes,
            )?;
        }

        let previous_result = state.last_result.clone();
        let mut executor = FusedPhysicalExecutor {
            csv_bytes,
            options,
            support,
            result: None,
            error: None,
        };
        let executions = Scheduler::new(plan)
            .run(&mut state.workspace, &mut executor)
            .map_err(|error| error.to_string())?;
        if let Some(error) = executor.error {
            return Err(error);
        }
        let result = executor
            .result
            .or(previous_result)
            .ok_or_else(|| "incremental scheduler produced no physical result".to_string())?;
        state.last_result = Some(result.clone());
        Ok((result, executions))
    })
}

fn record_incremental_workspace_root(workspace_id: &str, workspace_root_digest: &str) {
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        if let Some(state) = states.borrow_mut().get_mut(workspace_id) {
            state.last_workspace_root = Some(workspace_root_digest.to_string());
        }
    });
}

fn write_csv_cell(output: &mut Vec<u8>, value: &str) {
    if value.contains([',', '"', '\n', '\r']) {
        output.push(b'"');
        for byte in value.bytes() {
            if byte == b'"' {
                output.push(b'"');
            }
            output.push(byte);
        }
        output.push(b'"');
    } else {
        output.extend_from_slice(value.as_bytes());
    }
}

fn xlsx_to_csv(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut workbook = Xlsx::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let sheet = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "workbook contains no worksheets".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| error.to_string())?;
    let mut output = Vec::new();
    for row in range.rows() {
        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                output.push(b',');
            }
            write_csv_cell(&mut output, &cell.to_string());
        }
        output.push(b'\n');
    }
    Ok(output)
}

#[wasm_bindgen]
impl RuntimeHandle {
    pub fn manifest_json(&self) -> String {
        self.manifest_json.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn artifact_count(&self) -> u32 {
        self.artifacts.len() as u32
    }

    pub fn artifact_metadata_json(&self, index: u32) -> Result<String, JsValue> {
        let artifact = self
            .artifacts
            .get(index as usize)
            .ok_or_else(|| JsValue::from_str("artifact index out of range"))?;
        serde_json::to_string(&artifact.metadata)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn take_artifact_bytes(&mut self, index: u32) -> Result<Vec<u8>, JsValue> {
        let artifact = self
            .artifacts
            .get_mut(index as usize)
            .ok_or_else(|| JsValue::from_str("artifact index out of range"))?;
        Ok(std::mem::take(&mut artifact.bytes))
    }
}

#[wasm_bindgen]
pub fn execute_workspace(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native(request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn execute_bounded_v2_shadow(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native(request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn verify_evidence_journal_cbor(bytes: &[u8]) -> Result<u32, JsValue> {
    EvidenceJournal::from_cbor(bytes)
        .map(|journal| journal.events().len() as u32)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

pub fn execute_bounded_v2_shadow_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native(request_json, csv_bytes, support_files)
}

pub fn execute_workspace_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    request.validate(csv_bytes)?;
    let options_value = semantic_options_value(&request.options)?;
    let options_bytes = serde_jcs::to_vec(&options_value)
        .map_err(|error| format!("canonicalize options: {error}"))?;
    let options_digest = sha256(&options_bytes);
    let resolved_support = support_files.resolve()?;
    let pipeline_options = request.options.clone().into_pipeline_options();
    let mut ingress =
        materialize_ingress(csv_bytes, &options_bytes, &options_value, &resolved_support)?;
    let (result, node_executions) = execute_incremental_pipeline(
        &request,
        csv_bytes,
        &options_bytes,
        &options_value,
        &pipeline_options,
        &resolved_support,
    )?;
    let mut artifacts = output_artifacts(&result, &ingress.input.digest);
    append_binary_exports(
        &mut artifacts,
        &result,
        &request.options,
        &ingress.input.digest,
    )?;
    append_semantic_bundle_artifacts(&mut artifacts);
    append_normalized_support_artifacts(&mut artifacts, &ingress.assignments, &resolved_support)?;
    artifacts.push(runtime_artifact(
        "processing-options-json",
        "application/json",
        options_bytes.clone(),
        vec![ingress.input.digest.clone()],
    ));
    let plan = embedded_plan();
    let satisfied_nodes: BTreeSet<_> = node_executions
        .iter()
        .filter(|execution| {
            !matches!(
                execution.status,
                ExecutionStatus::Error | ExecutionStatus::Skipped
            )
        })
        .map(|execution| execution.node_id.clone())
        .collect();
    let materialization = evaluate_materialization(
        &plan,
        &ingress.assignments,
        &options_value,
        &satisfied_nodes,
        &BTreeSet::new(),
    );
    let execution_ledger_bytes = build_execution_ledger(
        &plan,
        &node_executions,
        &options_value,
        &request.options.datetime_of_preprocessing,
    )?;
    let execution_ledger_value: Value = serde_json::from_slice(&execution_ledger_bytes)
        .map_err(|error| format!("parse generated execution ledger: {error}"))?;
    artifacts.push(runtime_artifact(
        "execution-ledger-json",
        "application/json",
        execution_ledger_bytes,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    ));
    let semantic_index_source = serde_jcs::to_vec(&serde_json::json!({
        "protocolVersion": "chronicle-semantic-index-source/v1",
        "inputDigest": ingress.input.digest,
        "executionTimestamp": request.options.datetime_of_preprocessing,
        "roleAssignments": ingress.assignments.values().collect::<Vec<_>>(),
        "openObligations": materialization.obligations,
        "stateReasons": materialization.reasons,
        "nodeExecutions": node_executions,
        "executionLedger": execution_ledger_value
    }))
    .map_err(|error| format!("canonicalize semantic index source: {error}"))?;
    artifacts.push(runtime_artifact(
        "semantic-index-source-json",
        "application/json",
        semantic_index_source,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    ));
    for (index, execution) in node_executions.iter().enumerate() {
        let from_state = ingress
            .materialization
            .node_states
            .get(&execution.node_id)
            .copied();
        let to_state = materialization.node_states[&execution.node_id];
        ingress
            .journal
            .append(Transition {
                event_kind: if execution.status == ExecutionStatus::Bypassed {
                    "node-bypassed"
                } else {
                    "node-executed"
                },
                subject_id: &execution.node_id,
                from_state,
                to_state,
                reason_id: &execution.reason_id,
                source_id: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                revision: ingress.assignments.len() as u64 + index as u64 + 1,
            })
            .map_err(|error| error.to_string())?;
    }
    ingress
        .journal
        .verify()
        .map_err(|error| error.to_string())?;
    let journal_bytes = ingress
        .journal
        .to_cbor()
        .map_err(|error| error.to_string())?;
    let journal_digest = sha256(&journal_bytes);
    artifacts.push(runtime_artifact(
        "evidence-journal",
        "application/cbor",
        journal_bytes,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    ));
    let closure_bytes = build_artifact_closure(
        &artifacts,
        &request.workspace_id,
        &ingress.input.digest,
        &journal_digest,
    )?;
    let closure_artifact = runtime_artifact(
        "artifact-closure-json",
        "application/json",
        closure_bytes,
        vec![ingress.input.digest.clone(), journal_digest.clone()],
    );
    let artifact_closure_digest = closure_artifact.metadata.digest.clone();
    artifacts.push(closure_artifact);

    let artifact_digests: Vec<_> = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect();
    let root_commit = RootCommit {
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        command: EXECUTE_WORKSPACE_COMMAND,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &ingress.input.digest,
        options_digest: &options_digest,
        assignment_digests: ingress
            .assignments
            .iter()
            .map(|(role, assignment)| (role.as_str(), assignment.artifact.digest.as_str()))
            .collect(),
        artifact_digests,
        journal_digest: &journal_digest,
        artifact_closure_digest: &artifact_closure_digest,
    };
    let root_bytes = serde_jcs::to_vec(&root_commit)
        .map_err(|error| format!("canonicalize root commit: {error}"))?;
    let workspace_root_digest = sha256(&root_bytes);
    record_incremental_workspace_root(&request.workspace_id, &workspace_root_digest);
    artifacts.push(runtime_artifact(
        "workspace-root-json",
        "application/json",
        root_bytes,
        vec![ingress.input.digest.clone(), journal_digest.clone()],
    ));
    let revision = ingress.assignments.len() as u64 + node_executions.len() as u64;
    let assignments: Vec<_> = ingress.assignments.values().cloned().collect();
    let artifact_refs: Vec<_> = artifacts
        .iter()
        .map(|artifact| ArtifactRef {
            artifact_id: artifact.metadata.artifact_id.clone(),
            digest: artifact.metadata.digest.clone(),
            media_type: artifact.metadata.media_type.clone(),
            size: artifact.metadata.size,
            derived_from: artifact.metadata.derived_from.clone(),
            qualifiers: BTreeMap::new(),
        })
        .collect();
    let views = [
        (
            "stage-view-json",
            encode_view(&stage_view(
                &plan,
                &materialization,
                &node_executions,
                &options_value,
                None,
                revision,
                &workspace_root_digest,
            )),
        ),
        (
            "artifact-view-json",
            encode_view(&artifact_view(
                artifact_refs,
                assignments.clone(),
                revision,
                &workspace_root_digest,
            )),
        ),
        (
            "obligation-view-json",
            encode_view(&obligation_view(
                materialization.obligations.clone(),
                revision,
                &workspace_root_digest,
            )),
        ),
        (
            "explanation-view-json",
            encode_view(&explanation_view(
                materialization.reasons.clone(),
                revision,
                &workspace_root_digest,
            )),
        ),
    ];
    for (kind, view) in views {
        let bytes = serde_json::to_vec(&view)
            .map_err(|error| format!("serialize typed view {kind}: {error}"))?;
        artifacts.push(runtime_artifact(
            kind,
            "application/json",
            bytes,
            vec![workspace_root_digest.clone()],
        ));
    }
    let manifest = RuntimeManifest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: request.request_id,
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        implementation: "chronicle_preprocessing_runtime_wasm/0.1.0".into(),
        scope: "selected-runtime-csv-artifacts".into(),
        plan_digest: EMBEDDED_PLAN_SHA256.into(),
        profile_digest: EMBEDDED_PROFILE_SHA256.into(),
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256.into(),
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
        previous_workspace_root_digest: request.workspace_root_digest,
        workspace_id: request.workspace_id,
        workspace_root_digest,
        input: ingress.input,
        role_assignments: assignments,
        open_obligations: materialization.obligations,
        state_reasons: materialization.reasons,
        node_executions,
        artifacts: artifacts
            .iter()
            .map(|artifact| artifact.metadata.clone())
            .collect(),
        counts: RuntimeCounts {
            original: result.original_row_count,
            processed: result.processed_row_count,
            app: result.app_row_count,
            screen: result.screen_row_count,
        },
        processing_summary: RuntimeProcessingSummary {
            available_timezones: result.available_timezones,
            timezone: result.timezone,
            timezone_action: result.timezone_action,
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
        },
        journal_digest,
    };
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|error| format!("serialize runtime manifest: {error}"))?;
    Ok(RuntimeHandle {
        manifest_json,
        artifacts,
    })
}

fn build_execution_ledger(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    executions: &[NodeExecution],
    options: &Value,
    timestamp: &str,
) -> Result<Vec<u8>, String> {
    let status_by_node: BTreeMap<_, _> = executions
        .iter()
        .map(|execution| (execution.node_id.as_str(), execution.status))
        .collect();
    let ledger = plan
        .nodes
        .iter()
        .map(|node| {
            let status = status_by_node
                .get(node.node_id.as_str())
                .copied()
                .unwrap_or(ExecutionStatus::Error);
            let steps = plan
                .steps
                .iter()
                .filter(|step| step.unit_id == node.node_id)
                .map(|step| {
                    serde_json::json!({
                        "stepId": step.step_id,
                        "unit": step.unit_id,
                        "status": if status == ExecutionStatus::Bypassed || !step.applicability.evaluate(options) { "bypassed" } else { "ran" },
                        "rowsIn": Value::Null,
                        "rowsOut": Value::Null,
                        "droppedRows": Value::Null,
                        "expectations": [],
                        "timing": {
                            "startedAt": timestamp,
                            "endedAt": timestamp,
                            "durationMs": 0
                        }
                    })
                })
                .collect::<Vec<_>>();
            let status = match status {
                ExecutionStatus::Cached => "cached",
                ExecutionStatus::Recomputed => "recomputed",
                ExecutionStatus::Error => "error",
                ExecutionStatus::Skipped => "skipped",
                ExecutionStatus::Bypassed => "bypassed",
            };
            serde_json::json!({
                "unit": node.node_id,
                "status": status,
                "rowsIn": Value::Null,
                "rowsOut": Value::Null,
                "expectations": [],
                "steps": steps,
                "timing": {
                    "startedAt": timestamp,
                    "endedAt": timestamp,
                    "durationMs": 0
                }
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_vec(&ledger).map_err(|error| format!("serialize execution ledger: {error}"))
}

fn materialize_ingress(
    csv_bytes: &[u8],
    options_bytes: &[u8],
    options: &Value,
    support_files: &ResolvedSupportFiles,
) -> Result<IngressMaterialization, String> {
    let plan = embedded_plan();
    let mut store = MemoryCas::default();
    let mut assignments = BTreeMap::new();
    let input = assign(
        &mut store,
        &mut assignments,
        "raw_chronicle_csv",
        "text/csv",
        csv_bytes,
    )?;
    assign(
        &mut store,
        &mut assignments,
        "processing_options",
        "application/json",
        options_bytes,
    )?;
    for (role, file) in &support_files.files {
        assign(
            &mut store,
            &mut assignments,
            role,
            file.media_type,
            &file.original_bytes,
        )?;
    }
    let materialization = evaluate_materialization(
        &plan,
        &assignments,
        options,
        &BTreeSet::new(),
        &BTreeSet::new(),
    );
    let mut journal = EvidenceJournal::default();
    for assignment in assignments.values() {
        journal
            .append(Transition {
                event_kind: "role-assigned",
                subject_id: &assignment.role_id,
                from_state: Some(MaterializationState::Open),
                to_state: MaterializationState::Satisfied,
                reason_id: &assignment.assignment_id,
                source_id: &assignment.artifact.digest,
                revision: assignment.revision,
            })
            .map_err(|error| error.to_string())?;
    }
    journal.verify().map_err(|error| error.to_string())?;
    Ok(IngressMaterialization {
        input,
        assignments,
        materialization,
        journal,
    })
}

fn append_normalized_support_artifacts(
    artifacts: &mut Vec<RuntimeArtifact>,
    assignments: &BTreeMap<String, RoleAssignment>,
    support_files: &ResolvedSupportFiles,
) -> Result<(), String> {
    for (role, file) in &support_files.files {
        if !file.normalized_from_xlsx {
            continue;
        }
        let source = assignments.get(role).ok_or_else(|| {
            format!("missing source assignment for normalized support role {role}")
        })?;
        artifacts.push(runtime_artifact(
            &format!("normalized-support:{role}"),
            "text/csv",
            file.pipeline_csv.clone(),
            vec![source.artifact.digest.clone()],
        ));
    }
    Ok(())
}

fn assign(
    store: &mut MemoryCas,
    assignments: &mut BTreeMap<String, RoleAssignment>,
    role_id: &str,
    media_type: &str,
    bytes: &[u8],
) -> Result<ArtifactRef, String> {
    let artifact = store
        .put(media_type, bytes.to_vec(), Vec::new())
        .map_err(|error| error.to_string())?;
    let revision = assignments.len() as u64 + 1;
    assignments.insert(
        role_id.into(),
        RoleAssignment {
            assignment_id: stable_id(&["assignment", role_id, &artifact.digest]),
            role_id: role_id.into(),
            artifact: artifact.clone(),
            qualifiers: BTreeMap::new(),
            revision,
        },
    );
    Ok(artifact)
}

fn output_artifacts(result: &PipelineV2Result, input_digest: &str) -> Vec<RuntimeArtifact> {
    let mut artifacts = Vec::new();
    if !result.app_csv_bytes.is_empty() {
        artifacts.push(runtime_artifact(
            "app-csv",
            "text/csv",
            result.app_csv_bytes.clone(),
            vec![input_digest.into()],
        ));
    }
    if !result.screen_csv_bytes.is_empty() {
        artifacts.push(runtime_artifact(
            "screen-csv",
            "text/csv",
            result.screen_csv_bytes.clone(),
            vec![input_digest.into()],
        ));
    }
    if !result.day_coverage_csv_bytes.is_empty() {
        artifacts.push(runtime_artifact(
            "day-coverage-csv",
            "text/csv",
            result.day_coverage_csv_bytes.clone(),
            vec![input_digest.into()],
        ));
    }
    if !result.compliance_csv_bytes.is_empty() {
        artifacts.push(runtime_artifact(
            "compliance-csv",
            "text/csv",
            result.compliance_csv_bytes.clone(),
            vec![input_digest.into()],
        ));
    }
    if !result.credited_app_csv_bytes.is_empty() {
        artifacts.push(runtime_artifact(
            "credited-app-csv",
            "text/csv",
            result.credited_app_csv_bytes.clone(),
            vec![input_digest.into()],
        ));
    }
    for aggregate in &result.aggregate_csv_outputs {
        artifacts.push(runtime_aggregate_artifact(
            aggregate.kind,
            aggregate.bytes.clone(),
            aggregate.row_count,
            input_digest,
        ));
    }
    artifacts.push(runtime_artifact(
        "review-summary-json",
        "application/json",
        result.review_summary_json_bytes.clone(),
        vec![input_digest.into()],
    ));
    artifacts.push(runtime_artifact(
        "visualization-data-json",
        "application/json",
        result.visualization_data_json_bytes.clone(),
        vec![input_digest.into()],
    ));
    artifacts
}

fn append_binary_exports(
    artifacts: &mut Vec<RuntimeArtifact>,
    result: &PipelineV2Result,
    options: &PipelineV2OptionsJson,
    input_digest: &str,
) -> Result<(), String> {
    let mut append = |kind: &str, media_type: &str, bytes: Vec<u8>, row_count: u32| {
        let mut artifact = runtime_artifact(kind, media_type, bytes, vec![input_digest.into()]);
        artifact.metadata.row_count = Some(row_count);
        artifacts.push(artifact);
    };
    if options.enable_parquet_export {
        if options.include_app_output {
            append(
                "app-parquet",
                "application/vnd.apache.parquet",
                binary_exports::parquet_from_csv(&result.app_csv_bytes, false)?,
                result.app_row_count,
            );
        }
        if options.include_screen_output {
            append(
                "screen-parquet",
                "application/vnd.apache.parquet",
                binary_exports::parquet_from_csv(&result.screen_csv_bytes, true)?,
                result.screen_row_count,
            );
        }
    }
    if options.enable_spss_export {
        if options.include_app_output {
            append(
                "app-spss",
                "application/x-spss-sav",
                binary_exports::sav_from_csv(&result.app_csv_bytes, false)?,
                result.app_row_count,
            );
        }
        if options.include_screen_output {
            append(
                "screen-spss",
                "application/x-spss-sav",
                binary_exports::sav_from_csv(&result.screen_csv_bytes, true)?,
                result.screen_row_count,
            );
        }
    }
    let lineage_edge_count = result
        .row_lineage
        .iter()
        .map(|lineage| lineage.source_data_rows.len() as u32)
        .sum();
    append(
        "row-lineage-arrow",
        "application/vnd.apache.arrow.file",
        binary_exports::row_lineage_arrow(&result.row_lineage, input_digest)?,
        lineage_edge_count,
    );
    Ok(())
}

fn append_semantic_bundle_artifacts(artifacts: &mut Vec<RuntimeArtifact>) {
    for (kind, bytes, expected_digest) in [
        (
            "chronicle-plan-json",
            embedded_plan_bytes(),
            EMBEDDED_PLAN_SHA256,
        ),
        (
            "runtime-authority-json",
            embedded_runtime_authority_bytes(),
            EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        ),
        (
            "semantic-profile-json",
            embedded_profile_bytes(),
            EMBEDDED_PROFILE_SHA256,
        ),
        (
            "semantic-profile-lock-json",
            embedded_profile_lock_bytes(),
            EMBEDDED_PROFILE_LOCK_SHA256,
        ),
    ] {
        let artifact = runtime_artifact(kind, "application/json", bytes.to_vec(), Vec::new());
        assert_eq!(artifact.metadata.digest, expected_digest);
        artifacts.push(artifact);
    }
}

fn build_artifact_closure(
    artifacts: &[RuntimeArtifact],
    workspace_id: &str,
    input_digest: &str,
    journal_digest: &str,
) -> Result<Vec<u8>, String> {
    serde_jcs::to_vec(&ArtifactClosure {
        protocol_version: "chronicle-artifact-closure/v1",
        workspace_id,
        input_digest,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        journal_digest,
        artifacts: artifacts
            .iter()
            .map(|artifact| &artifact.metadata)
            .collect(),
    })
    .map_err(|error| format!("canonicalize artifact closure: {error}"))
}

fn runtime_artifact(
    kind: &str,
    media_type: &str,
    bytes: Vec<u8>,
    derived_from: Vec<String>,
) -> RuntimeArtifact {
    let digest = sha256(&bytes);
    RuntimeArtifact {
        metadata: RuntimeArtifactMetadata {
            artifact_id: format!("urn:chronicle:artifact:{}", &digest[7..]),
            kind: kind.into(),
            media_type: media_type.into(),
            digest,
            size: bytes.len() as u64,
            derived_from,
            row_count: None,
        },
        bytes,
    }
}

fn runtime_aggregate_artifact(
    kind: &str,
    bytes: Vec<u8>,
    row_count: u32,
    input_digest: &str,
) -> RuntimeArtifact {
    let mut artifact = runtime_artifact(kind, "text/csv", bytes, vec![input_digest.into()]);
    artifact.metadata.row_count = Some(row_count);
    artifact
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn stable_id(parts: &[&str]) -> String {
    sha256(parts.join("\u{1f}").as_bytes())
}

fn validate_digest(value: &str) -> Result<(), &'static str> {
    let Some(hex_value) = value.strip_prefix("sha256:") else {
        return Err("must start with sha256:");
    };
    if hex_value.len() != 64 || !hex_value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("must contain exactly 64 hexadecimal characters");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_fused_execution_count() {
        FUSED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(0));
    }

    fn fused_execution_count() -> usize {
        FUSED_PHYSICAL_EXECUTION_COUNT.with(std::cell::Cell::get)
    }

    fn request(csv: &[u8]) -> String {
        serde_json::json!({
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "requestId": "req-1",
            "command": BOUNDED_COMMAND,
            "workspaceRootDigest": null,
            "workspaceId": format!("sha256:{}", "a".repeat(64)),
            "inputFileName": "Raw P01.csv",
            "inputSha256": sha256(csv),
            "options": {
                "study_name": "Runtime Study",
                "timezone": "America/Chicago",
                "usage_session_mode": "app_usage",
                "include_app_output": true,
                "include_screen_output": false,
                "use_filter_file": false,
                "use_apps_forcing_screen_open": false,
                "use_app_codebook": false,
                "correct_duplicate_event_timestamps": true,
                "allow_stop_event_reuse": false,
                "use_activity_stopped_as_fallback": true,
                "apply_threshold_to_fallback": true,
                "long_duration_threshold_ns": 43200000000000_i64,
                "proximity_interval_ns": 0_i64,
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
                "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
                "model_concurrent_usage": false,
                "minimum_usage_duration": 60.0,
                "apply_minimum_usage_duration_to_concurrent_subintervals": false
            }
        })
        .to_string()
    }

    fn request_for_workspace(csv: &[u8], marker: char) -> Value {
        let mut value: Value = serde_json::from_str(&request(csv)).unwrap();
        value["workspaceId"] = Value::String(format!("sha256:{}", marker.to_string().repeat(64)));
        value
    }

    #[test]
    fn pre_run_stage_view_is_rust_owned_complete_and_has_no_fake_execution() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let view: Value = serde_json::from_str(
            &plan_stage_view_native(&request_value["options"].to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(view["view_id"], "chronicle.stage.v1");
        assert_eq!(view["revision"], 0);
        assert_eq!(view["payload"]["node_states"].as_array().unwrap().len(), 15);
        assert_eq!(view["payload"]["step_states"].as_array().unwrap().len(), 55);
        assert!(view["payload"]["node_states"]
            .as_array()
            .unwrap()
            .iter()
            .all(|node| node["execution_status"].is_null()));
        assert!(view["payload"]["step_states"]
            .as_array()
            .unwrap()
            .iter()
            .any(|step| step["execution_status"] == "bypassed"));
        assert!(view["payload"]["step_states"]
            .as_array()
            .unwrap()
            .iter()
            .any(|step| step["execution_status"].is_null()));
    }

    fn csv() -> Vec<u8> {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago"
        )
        .as_bytes()
        .to_vec()
    }

    #[test]
    fn one_call_runtime_returns_verified_artifacts_materialization_and_root() {
        let csv = csv();
        let mut handle =
            execute_bounded_v2_shadow_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.request_id, "req-1");
        assert_eq!(manifest.plan_digest, EMBEDDED_PLAN_SHA256);
        assert_eq!(
            manifest.product_contract_digest,
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(manifest.counts.original, 2);
        assert_eq!(manifest.counts.processed, 2);
        assert_eq!(manifest.counts.app, 1);
        assert!(manifest.workspace_root_digest.starts_with("sha256:"));
        assert_eq!(manifest.role_assignments.len(), 2);
        assert_eq!(
            manifest
                .role_assignments
                .iter()
                .map(|assignment| assignment.revision)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(manifest.node_executions.len(), 15);
        assert!(manifest.open_obligations.is_empty());
        assert!(manifest.state_reasons.iter().any(|reason| {
            reason.subject_id == "outputs" && reason.state == MaterializationState::Satisfied
        }));
        assert_eq!(handle.artifact_count(), 18); // outputs/evidence/Arrow lineage, four embedded semantic resources, semantic-index source, closure, root, and four views
        let mut kinds = BTreeSet::new();
        let mut ledger = None;
        let mut stage_view_value = None;
        let mut closure_value = None;
        let mut journal = None;
        for index in 0..handle.artifact_count() {
            let metadata_json = handle.artifact_metadata_json(index).unwrap();
            let metadata: RuntimeArtifactMetadata = serde_json::from_str(&metadata_json).unwrap();
            kinds.insert(metadata.kind.clone());
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, sha256(&bytes));
            if metadata.kind == "execution-ledger-json" {
                ledger = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "stage-view-json" {
                stage_view_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "artifact-closure-json" {
                closure_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "evidence-journal" {
                journal = Some(EvidenceJournal::from_cbor(&bytes).unwrap());
            }
        }
        let ledger = ledger.unwrap();
        assert_eq!(ledger.as_array().unwrap().len(), 15);
        assert_eq!(
            ledger
                .as_array()
                .unwrap()
                .iter()
                .map(|unit| unit["steps"].as_array().unwrap().len())
                .sum::<usize>(),
            55
        );
        assert!(kinds.contains("stage-view-json"));
        assert!(kinds.contains("artifact-view-json"));
        assert!(kinds.contains("obligation-view-json"));
        assert!(kinds.contains("explanation-view-json"));
        assert!(kinds.contains("workspace-root-json"));
        assert!(kinds.contains("semantic-profile-lock-json"));
        assert!(kinds.contains("semantic-index-source-json"));
        assert!(kinds.contains("artifact-closure-json"));
        assert!(kinds.contains("row-lineage-arrow"));
        let stage_view_value = stage_view_value.unwrap();
        assert_eq!(stage_view_value["revision"], 17);
        assert!(
            stage_view_value["payload"]["node_states"]
                .as_array()
                .unwrap()
                .iter()
                .any(|node| {
                    node["node_id"] == "outputs" && node["materialization_state"] == "satisfied"
                }),
            "{}",
            stage_view_value
        );
        let closure_value = closure_value.unwrap();
        assert_eq!(
            closure_value["protocolVersion"],
            "chronicle-artifact-closure/v1"
        );
        assert_eq!(closure_value["workspaceId"], manifest.workspace_id);
        assert!(closure_value["artifacts"].as_array().unwrap().len() >= 10);
        let journal = journal.unwrap();
        assert_eq!(journal.events().len(), 17);
        assert_eq!(
            journal
                .events()
                .iter()
                .map(|event| event.revision)
                .collect::<Vec<_>>(),
            std::iter::once(2)
                .chain(std::iter::once(1))
                .chain(3..=17)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            journal
                .events()
                .iter()
                .filter(|event| event.event_kind == "node-bypassed")
                .count(),
            manifest
                .node_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Bypassed)
                .count()
        );
    }

    #[test]
    fn warm_workspace_reuses_the_fused_result_and_option_change_recomputes_exact_cone() {
        reset_fused_execution_count();
        let csv = csv();
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "study_dates_file",
                "study_dates.csv",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n",
            )
            .unwrap();
        let first_request = request_for_workspace(&csv, 'c');
        let first = execute_workspace_native(&first_request.to_string(), &csv, &support).unwrap();
        let first: RuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        assert_eq!(fused_execution_count(), 1);
        assert!(first.node_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                )
        }));

        let mut warm_request = first_request.clone();
        warm_request["requestId"] = Value::String("warm-run".into());
        warm_request["workspaceRootDigest"] = Value::String(first.workspace_root_digest.clone());
        let warm = execute_workspace_native(&warm_request.to_string(), &csv, &support).unwrap();
        let warm: RuntimeManifest = serde_json::from_str(&warm.manifest_json).unwrap();
        assert_eq!(
            fused_execution_count(),
            1,
            "warm run must not call the kernel"
        );
        assert!(warm.node_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Cached | ExecutionStatus::Bypassed
                )
        }));

        let mut changed_request = warm_request;
        changed_request["requestId"] = Value::String("day-coverage-change".into());
        changed_request["workspaceRootDigest"] = Value::String(warm.workspace_root_digest.clone());
        changed_request["options"]["enable_day_coverage"] = Value::Bool(true);
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &support).unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        assert_eq!(
            fused_execution_count(),
            2,
            "changed executions: {:?}",
            changed
                .node_executions
                .iter()
                .map(|execution| (&execution.node_id, execution.status, &execution.input_key))
                .collect::<Vec<_>>()
        );
        let recomputed: BTreeSet<_> = changed
            .node_executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.node_id.as_str())
            .collect();
        assert_eq!(recomputed, BTreeSet::from(["day_coverage", "outputs"]));
        assert_eq!(
            changed
                .node_executions
                .iter()
                .find(|execution| execution.node_id == "parse_events")
                .unwrap()
                .status,
            ExecutionStatus::Cached
        );
    }

    #[test]
    fn mismatched_previous_root_resets_incremental_state() {
        reset_fused_execution_count();
        let csv = csv();
        let request_value = request_for_workspace(&csv, 'd');
        execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut mismatch = request_value;
        mismatch["workspaceRootDigest"] = Value::String(format!("sha256:{}", "e".repeat(64)));
        let result =
            execute_workspace_native(&mismatch.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&result.manifest_json).unwrap();
        assert_eq!(fused_execution_count(), 2);
        assert!(manifest
            .node_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Recomputed));
    }

    #[test]
    fn execution_ledger_applies_step_local_bypasses_in_rust() {
        let csv = csv();
        let mut request_value = request_for_workspace(&csv, 'f');
        request_value["options"]["deduplicate_exact_rows"] = Value::Bool(false);
        let mut result = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let ledger = (0..result.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&result.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "execution-ledger-json").then(|| {
                    serde_json::from_slice::<Value>(&result.take_artifact_bytes(index).unwrap())
                        .unwrap()
                })
            })
            .unwrap();
        let exact_dedupe = ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["steps"].as_array().unwrap())
            .find(|step| step["stepId"] == "exact_dedupe")
            .unwrap();
        assert_eq!(exact_dedupe["status"], "bypassed");
    }

    #[test]
    fn runtime_preserves_selected_filter_counts_from_nested_options() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["timezone_handling"] = Value::String("selected-filter".into());
        let handle = execute_bounded_v2_shadow_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.counts.original, 4);
        assert_eq!(manifest.counts.processed, 2);
        assert_eq!(manifest.counts.app, 1);
    }

    #[test]
    fn transport_request_identity_does_not_change_semantic_workspace_root() {
        let csv = csv();
        let first =
            execute_bounded_v2_shadow_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let mut second_request: Value = serde_json::from_str(&request(&csv)).unwrap();
        second_request["requestId"] = Value::String("req-2".into());
        let second = execute_bounded_v2_shadow_native(
            &second_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first: RuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        let second: RuntimeManifest = serde_json::from_str(&second.manifest_json).unwrap();
        assert_eq!(first.workspace_root_digest, second.workspace_root_digest);
    }

    #[test]
    fn tampered_input_and_unknown_fields_fail_closed() {
        let csv = csv();
        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["inputSha256"] = Value::String(format!("sha256:{:0>64}", 0));
        let error = execute_bounded_v2_shadow_native(
            &value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .err()
        .expect("tampered digest must fail");
        assert!(error.contains("input digest mismatch"));

        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["surprise"] = Value::Bool(true);
        let error = execute_bounded_v2_shadow_native(
            &value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .err()
        .expect("unknown field must fail");
        assert!(error.contains("unknown field"));
    }

    #[test]
    fn support_roles_are_registered_nonempty_and_single_assignment() {
        let mut support = RuntimeSupportFiles::default();
        assert!(support
            .put_native("unknown_role", "unknown.csv", b"value")
            .is_err());
        assert!(support
            .put_native("filter_file", "filter.csv", b"")
            .is_err());
        support
            .put_native("filter_file", "filter.csv", b"package_name\ncom.example")
            .unwrap();
        assert!(support
            .put_native("filter_file", "other.csv", b"package_name\ncom.other",)
            .is_err());
    }

    #[test]
    fn xlsx_support_is_preserved_normalized_and_materialized() {
        let workbook = include_bytes!(concat!(
            env!("CHRONICLE_REPOSITORY_ROOT"),
            "/apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
        ));
        let mut support = RuntimeSupportFiles::default();
        let expected_width = {
            let mut workbook_reader = Xlsx::new(Cursor::new(workbook.as_slice())).unwrap();
            let sheet = workbook_reader.sheet_names().first().unwrap().clone();
            workbook_reader.worksheet_range(&sheet).unwrap().width()
        };
        let normalized_csv = xlsx_to_csv(workbook).unwrap();
        let normalized_width = csv::Reader::from_reader(normalized_csv.as_slice())
            .headers()
            .unwrap()
            .len();
        assert_eq!(normalized_width, expected_width);
        support
            .put_native("filter_file", "filter.xlsx", workbook)
            .unwrap();
        let mut request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        request_value["options"]["use_filter_file"] = Value::Bool(true);
        let mut handle =
            execute_workspace_native(&request_value.to_string(), &csv(), &support).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let assignment = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "filter_file")
            .unwrap();
        assert_eq!(
            assignment.artifact.media_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert!(manifest.open_obligations.is_empty());
        let normalized = (0..handle.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "normalized-support:filter_file")
                    .then(|| handle.take_artifact_bytes(index).unwrap())
            })
            .expect("normalized support artifact");
        assert!(String::from_utf8(normalized)
            .unwrap()
            .contains("app_package_name"));
    }

    #[test]
    fn legacy_xls_support_fails_closed_with_conversion_guidance() {
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "legacy.xls", b"not-an-xls")
            .unwrap();
        let error = support.resolve().err().expect("legacy xls must fail");
        assert!(error.contains("Convert legacy .xls"));
    }

    #[test]
    fn request_support_and_digest_boundaries_fail_closed() {
        assert!(runtime_version().starts_with("chronicle-preprocessing-runtime/"));
        assert!(plan_stage_view_native("{")
            .unwrap_err()
            .contains("invalid plan-view options"));
        let csv = csv();
        let base: RuntimeRequest = serde_json::from_str(&request(&csv)).unwrap();
        let cases = [
            ("protocol", {
                let mut value = base.clone();
                value.protocol_version = "future".into();
                value
            }),
            ("command", {
                let mut value = base.clone();
                value.command = "ExecuteArbitraryCode".into();
                value
            }),
            ("request", {
                let mut value = base.clone();
                value.request_id = "  ".into();
                value
            }),
            ("inputFileName", {
                let mut value = base.clone();
                value.input_file_name = String::new();
                value
            }),
            ("workspaceId", {
                let mut value = base.clone();
                value.workspace_id = "not-a-digest".into();
                value
            }),
            ("workspaceRootDigest", {
                let mut value = base.clone();
                value.workspace_root_digest = Some("sha256:short".into());
                value
            }),
        ];
        for (expected, value) in cases {
            assert!(value.validate(&csv).unwrap_err().contains(expected));
        }
        assert_eq!(
            validate_digest("missing-prefix"),
            Err("must start with sha256:")
        );
        assert_eq!(
            validate_digest("sha256:xyz"),
            Err("must contain exactly 64 hexadecimal characters")
        );
        assert!(validate_digest(&format!("sha256:{}", "a".repeat(64))).is_ok());
        assert!(validate_digest(&format!("sha256:{}", "a".repeat(63))).is_err());
        assert!(validate_digest(&format!("sha256:{}g", "a".repeat(63))).is_err());

        let mut support = RuntimeSupportFiles::new();
        assert!(support.put_native("filter_file", " ", b"x").is_err());
        support
            .put_native("background_apps_file", "background.bin", b"x")
            .unwrap();
        assert!(support
            .resolve()
            .err()
            .expect("unsupported extension must fail")
            .contains("unsupported support file format"));
        let mut corrupt = RuntimeSupportFiles::default();
        corrupt
            .put_native("filter_file", "filter.xlsx", b"not-an-xlsx")
            .unwrap();
        assert!(corrupt.resolve().is_err());

        let mut resolved = ResolvedSupportFiles::default();
        resolved.files.insert(
            "filter_file".into(),
            ResolvedSupportFile {
                media_type: "text/csv",
                original_bytes: b"original".to_vec(),
                pipeline_csv: b"normalized".to_vec(),
                normalized_from_xlsx: false,
            },
        );
        assert_eq!(resolved.get("filter_file"), b"normalized");
        assert!(resolved.get("missing").is_empty());

        let mut cell = Vec::new();
        write_csv_cell(&mut cell, "a,\"b\"\n");
        assert_eq!(String::from_utf8(cell).unwrap(), "\"a,\"\"b\"\"\n\"");
    }

    #[test]
    fn every_optional_output_family_is_emitted_by_the_rust_authority() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Screen,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Screen,Screen Non-interactive,android,2026-03-07 10:02:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec();
        let mut request_value = request_for_workspace(&csv, '9');
        request_value["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        request_value["options"]["include_screen_output"] = Value::Bool(true);
        request_value["options"]["enable_day_coverage"] = Value::Bool(true);
        request_value["options"]["enable_compliance_scoring"] = Value::Bool(true);
        request_value["options"]["enable_screen_gated_crediting"] = Value::Bool(true);
        request_value["options"]["enable_aggregates"] = Value::Bool(true);
        request_value["options"]["enable_parquet_export"] = Value::Bool(true);
        request_value["options"]["enable_spss_export"] = Value::Bool(true);
        let mut handle = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        assert_eq!(handle.manifest_json(), handle.manifest_json);
        let kinds = (0..handle.artifact_count())
            .map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                assert!(!handle.take_artifact_bytes(index).unwrap().is_empty());
                metadata.kind
            })
            .collect::<BTreeSet<_>>();
        for expected in [
            "app-csv",
            "screen-csv",
            "day-coverage-csv",
            "compliance-csv",
            "credited-app-csv",
            "app-parquet",
            "screen-parquet",
            "app-spss",
            "screen-spss",
            "row-lineage-arrow",
        ] {
            assert!(kinds.contains(expected), "missing {expected}: {kinds:?}");
        }
        assert!(kinds.iter().any(|kind| kind.starts_with("aggregate-")));
    }

    #[test]
    fn internal_error_and_recovery_helpers_are_observable() {
        let options_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let options: PipelineV2OptionsJson =
            serde_json::from_value(options_value["options"].clone()).unwrap();
        let options = options.into_pipeline_options();
        let support = ResolvedSupportFiles::default();
        let mut executor = FusedPhysicalExecutor {
            csv_bytes: &[],
            options: &options,
            support: &support,
            result: None,
            error: Some("cached failure".into()),
        };
        assert_eq!(
            executor
                .ensure_result()
                .err()
                .expect("cached failure must be returned"),
            "cached failure"
        );

        let mut artifacts = Vec::new();
        let files = ResolvedSupportFiles {
            files: BTreeMap::from([(
                "filter_file".into(),
                ResolvedSupportFile {
                    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    original_bytes: vec![1],
                    pipeline_csv: b"header\n".to_vec(),
                    normalized_from_xlsx: true,
                },
            )]),
        };
        assert!(
            append_normalized_support_artifacts(&mut artifacts, &BTreeMap::new(), &files)
                .unwrap_err()
                .contains("missing source assignment")
        );
        record_incremental_workspace_root(
            "unknown-workspace",
            &format!("sha256:{}", "a".repeat(64)),
        );

        let plan = embedded_plan();
        let ledger: Value = serde_json::from_slice(
            &build_execution_ledger(&plan, &[], &serde_json::json!({}), "now").unwrap(),
        )
        .unwrap();
        assert!(ledger
            .as_array()
            .unwrap()
            .iter()
            .all(|unit| unit["status"] == "error"));

        let aggregate = runtime_aggregate_artifact("aggregate-test", b"x\n".to_vec(), 1, "input");
        assert_eq!(aggregate.metadata.row_count, Some(1));
    }

    #[test]
    fn wasm_exported_success_facade_delegates_to_the_native_authority() {
        let csv = csv();
        let request_value = request_for_workspace(&csv, '7');
        let options_json = request_value["options"].to_string();
        let view: Value =
            serde_json::from_str(&plan_stage_view_json(&options_json).unwrap()).unwrap();
        assert_eq!(view["view_id"], "chronicle.stage.v1");

        let mut support = RuntimeSupportFiles::new();
        support.put("filter_file", b"package_name\n").unwrap();
        support
            .put_with_name("background_apps_file", "background.csv", b"package_name\n")
            .unwrap();
        assert_eq!(support.files["filter_file"].name, "filter_file.csv");
        assert_eq!(support.files["background_apps_file"].name, "background.csv");
        let primary = execute_workspace(&request_value.to_string(), &csv, &support).unwrap();
        assert!(primary.manifest_json().contains(EXECUTE_WORKSPACE_COMMAND));

        let legacy_request = request_for_workspace(&csv, '8');
        let legacy =
            execute_bounded_v2_shadow(&legacy_request.to_string(), &csv, &support).unwrap();
        assert!(legacy.manifest_json().contains(EXECUTE_WORKSPACE_COMMAND));

        let mut journal = EvidenceJournal::default();
        journal
            .append(Transition {
                event_kind: "state",
                subject_id: "node",
                from_state: None,
                to_state: MaterializationState::Ready,
                reason_id: "reason",
                source_id: "source",
                revision: 1,
            })
            .unwrap();
        journal
            .append(Transition {
                event_kind: "state",
                subject_id: "node-2",
                from_state: Some(MaterializationState::Ready),
                to_state: MaterializationState::Satisfied,
                reason_id: "reason-2",
                source_id: "source",
                revision: 2,
            })
            .unwrap();
        assert_eq!(
            verify_evidence_journal_cbor(&journal.to_cbor().unwrap()).unwrap(),
            2
        );
    }

    #[test]
    fn semantic_option_units_are_projected_exactly() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let mut options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        options.long_duration_threshold_ns = 43_200_000_000_000;
        options.proximity_interval_ns = 2_500_000_000;
        let projected = semantic_options_value(&options).unwrap();
        assert_eq!(projected["long_duration_threshold_hours"], 12.0);
        assert_eq!(projected["proximity_interval_seconds"], 2.5);
    }
}
