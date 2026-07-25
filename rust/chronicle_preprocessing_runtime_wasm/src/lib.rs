//! Product runtime boundary for the Chronicle raw-data preprocessing app.
//!
//! This crate composes the existing Rust preprocessing kernel with the
//! product-owned semantic adapter. It is deliberately not a reusable graph
//! engine: the reusable surface is the versioned request/result envelope,
//! content-addressed artifacts, role assignments, obligations, and evidence.

mod binary_exports;

use calamine::{Reader, Xlsx};
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    discover_timezones_v2_native, IncrementalPipelineV2Engine, LogicalStageCheckpoint,
    PipelineV2Options, PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles,
};
#[cfg(test)]
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, TIMEZONE_HANDLING_MODES,
};
use chronicle_chrono_kernel_wasm::step_contract::{
    step_request_fields, step_source_role_bindings, PipelineSourceRolePredicate, PIPELINE_STEPS,
};
use chronicle_chrono_kernel_wasm::{
    is_recognized_interaction_type, is_valid_chronicle_timezone, parse_chronicle_timestamp_ns,
};
use chronicle_preprocessing_semantic_adapter::{
    embedded_dependency_certificate, embedded_dependency_certificate_bytes, embedded_plan,
    embedded_plan_bytes, embedded_profile_bytes, embedded_profile_lock_bytes,
    embedded_runtime_authority_bytes, evaluate_dependency_cache_decision, evaluate_materialization,
    journal::{EvidenceJournal, Transition},
    views::{artifact_view, encode_view, explanation_view, obligation_view, stage_view},
    ArtifactRef, DependencyCacheDecision, DependencyCacheMode, ExecutionStatus,
    MaterializationState, NodeExecution, RoleAssignment, CERTIFIED_OPTION_KEYS,
    EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256, EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256, EMBEDDED_RUNTIME_AUTHORITY_SHA256,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::Cursor;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

pub const RUNTIME_PROTOCOL_VERSION: &str = "chronicle-preprocessing-runtime/v1";
pub const EXECUTE_WORKSPACE_COMMAND: &str = "ExecuteWorkspace";
pub const QUERY_REVIEW_COMMAND: &str = "QueryReview";
pub const IMPLEMENTATION_BUILD_DIGEST: &str = env!("CHRONICLE_IMPLEMENTATION_BUILD_DIGEST");
pub const BUILD_ENVIRONMENT_DIGEST: &str = env!("CHRONICLE_BUILD_ENVIRONMENT_DIGEST");
const REQUIRED_VIEWS: [(&str, &str, &str); 4] = [
    (
        "stage-view-json",
        "chronicle.stage.v1",
        "urn:chronicle:view:stage:v1",
    ),
    (
        "artifact-view-json",
        "chronicle.artifact.v1",
        "urn:chronicle:view:artifact:v1",
    ),
    (
        "obligation-view-json",
        "chronicle.obligation.v1",
        "urn:chronicle:view:obligation:v1",
    ),
    (
        "explanation-view-json",
        "chronicle.explanation.v1",
        "urn:chronicle:view:explanation:v1",
    ),
];
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

#[wasm_bindgen]
pub fn implementation_build_digest() -> String {
    IMPLEMENTATION_BUILD_DIGEST.into()
}

/// Discover normalized IANA timezones through the same Rust boundary used by
/// production preprocessing.
#[wasm_bindgen]
pub fn discover_timezones_v2(csv_bytes: &[u8]) -> Result<Vec<String>, JsValue> {
    discover_timezones_v2_native(csv_bytes).map_err(|error| JsValue::from_str(&error))
}

const ADVISORY_RAW_COLUMNS: [&str; 7] = [
    "study_id",
    "participant_id",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp",
    "timezone",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawFileInspection {
    file_name: String,
    size_bytes: u64,
    row_count: usize,
    participant_count: usize,
    columns: Vec<String>,
    timezones: Vec<String>,
    has_required_columns: bool,
    invalid_timestamp_count: usize,
    missing_timestamp_count: usize,
    missing_timezone_count: usize,
    duplicate_timestamp_count: usize,
    out_of_order_timestamp_count: usize,
    first_out_of_order_row: Option<usize>,
    unrecognized_interaction_types: Vec<String>,
    warnings: Vec<String>,
}

fn physical_data_row_count(bytes: &[u8]) -> usize {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let bytes = trimmed.as_bytes();
    let mut separators = 0usize;
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                separators += 1;
                index += usize::from(bytes.get(index + 1) == Some(&b'\n'));
            }
            b'\n' => separators += 1,
            _ => {}
        }
        index += 1;
    }
    separators
}

fn duplicate_safe_headers(raw_headers: &csv::StringRecord) -> (Vec<String>, bool) {
    let mut used = BTreeSet::new();
    let mut columns = Vec::with_capacity(raw_headers.len());
    let mut duplicate = false;
    for (index, raw) in raw_headers.iter().enumerate() {
        let mut base = raw.trim().trim_start_matches('\u{feff}').to_string();
        if index > 0 {
            base = raw.trim().to_string();
        }
        let mut column = base.clone();
        let mut suffix = 1usize;
        while used.contains(&column) {
            duplicate = true;
            column = format!("{base}_{suffix}");
            suffix += 1;
        }
        used.insert(column.clone());
        columns.push(column);
    }
    (columns, duplicate)
}

fn raw_cell<'a>(
    record: &'a csv::StringRecord,
    header_indexes: &BTreeMap<String, usize>,
    name: &str,
) -> &'a str {
    header_indexes
        .get(name)
        .and_then(|index| record.get(*index))
        .unwrap_or_default()
        .trim()
}

/// Tolerant upload inspection owned by the same Rust runtime as execution.
/// Malformed CSV is reported through warnings instead of escaping as an error,
/// because upload inspection is advisory and must never crash the file picker.
#[wasm_bindgen]
pub fn inspect_raw_file_v1(csv_bytes: &[u8], file_name: &str, size_bytes: f64) -> String {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_bytes);
    let (raw_headers, mut parse_warning) = match reader.headers() {
        Ok(headers) => (headers.clone(), None),
        Err(error) => (csv::StringRecord::new(), Some(error.to_string())),
    };
    let (columns, duplicate_headers) = duplicate_safe_headers(&raw_headers);
    let header_indexes = raw_headers
        .iter()
        .enumerate()
        .map(|(index, value)| {
            (
                value.trim().trim_start_matches('\u{feff}').to_string(),
                index,
            )
        })
        .fold(BTreeMap::new(), |mut indexes, (name, index)| {
            indexes.entry(name).or_insert(index);
            indexes
        });
    let missing = ADVISORY_RAW_COLUMNS
        .iter()
        .filter(|column| !header_indexes.contains_key(**column))
        .copied()
        .collect::<Vec<_>>();

    let mut rows = Vec::new();
    for result in reader.records() {
        match result {
            Ok(record) if record.iter().any(|cell| !cell.trim().is_empty()) => rows.push(record),
            Ok(_) => {}
            Err(error) => {
                parse_warning.get_or_insert_with(|| error.to_string());
            }
        }
    }

    let mut participants = BTreeSet::new();
    let mut timezones = BTreeSet::new();
    let mut invalid_timezones = BTreeSet::new();
    let mut timestamp_counts = BTreeMap::<String, usize>::new();
    let mut max_timestamp_by_participant = BTreeMap::<String, i64>::new();
    let mut unrecognized_interaction_types = BTreeSet::new();
    let mut invalid_timestamp_count = 0usize;
    let mut missing_timestamp_count = 0usize;
    let mut missing_timezone_count = 0usize;
    let mut out_of_order_timestamp_count = 0usize;
    let mut first_out_of_order_row = None;

    for (index, row) in rows.iter().enumerate() {
        let participant = raw_cell(row, &header_indexes, "participant_id");
        if !participant.is_empty() {
            participants.insert(participant.to_string());
        }
        let timezone = raw_cell(row, &header_indexes, "timezone");
        if timezone.is_empty() {
            missing_timezone_count += 1;
        } else {
            timezones.insert(timezone.to_string());
            if !is_valid_chronicle_timezone(timezone) {
                invalid_timezones.insert(timezone.to_string());
            }
        }
        let interaction_type = raw_cell(row, &header_indexes, "interaction_type");
        if !interaction_type.is_empty() && !is_recognized_interaction_type(interaction_type) {
            unrecognized_interaction_types.insert(interaction_type.to_string());
        }

        let timestamp = raw_cell(row, &header_indexes, "event_timestamp");
        if timestamp.is_empty() {
            missing_timestamp_count += 1;
            continue;
        }
        *timestamp_counts.entry(timestamp.to_string()).or_default() += 1;
        let Some(timestamp_ns) = parse_chronicle_timestamp_ns(timestamp) else {
            invalid_timestamp_count += 1;
            continue;
        };
        // Preserve the old informational metric: offset-bearing timestamps are
        // valid input but were skipped by the browser's UTC wall-clock scan.
        let has_explicit_zone = timestamp.ends_with('Z')
            || timestamp
                .char_indices()
                .rev()
                .find(|(_, character)| matches!(character, '+' | '-'))
                .is_some_and(|(offset, _)| offset >= 19);
        if has_explicit_zone {
            continue;
        }
        let previous = max_timestamp_by_participant
            .get(participant)
            .copied()
            .unwrap_or(i64::MIN);
        if timestamp_ns < previous {
            out_of_order_timestamp_count += 1;
            first_out_of_order_row.get_or_insert(index + 1);
        } else {
            max_timestamp_by_participant.insert(participant.to_string(), timestamp_ns);
        }
    }

    let duplicate_timestamp_count = timestamp_counts
        .values()
        .filter(|count| **count > 1)
        .count();
    let mut warnings = Vec::new();
    if !file_name.to_lowercase().ends_with(".csv") {
        warnings.push("File extension is not .csv.".to_string());
    }
    if participants.len() > 1 {
        warnings.push(format!(
            "This file contains {} participants. The preprocessor treats each file as a single participant and does not group app-usage session matching by participant_id, so a multi-participant file can mis-match or mis-label sessions (especially with concurrent-usage or background-apps modeling). Split the export into one file per participant.",
            participants.len()
        ));
    }
    if size_bytes == 0.0 || csv_bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        warnings.push("File is empty.".to_string());
    }
    if !missing.is_empty() {
        warnings.push(format!("Missing required columns: {}", missing.join(", ")));
    }
    if duplicate_headers {
        warnings.push("Duplicate column headers found.".to_string());
    }
    if timezones.is_empty() && !missing.contains(&"timezone") {
        warnings.push("No timezone values found.".to_string());
    }
    if missing_timezone_count > 0 && !missing.contains(&"timezone") {
        warnings.push(format!(
            "{missing_timezone_count} rows are missing timezone values."
        ));
    }
    if !invalid_timezones.is_empty() {
        warnings.push(format!(
            "Invalid timezone values: {}",
            invalid_timezones
                .into_iter()
                .take(5)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if missing_timestamp_count > 0 && !missing.contains(&"event_timestamp") {
        warnings.push(format!(
            "{missing_timestamp_count} rows are missing event_timestamp values."
        ));
    }
    if invalid_timestamp_count > 0 {
        warnings.push(format!(
            "{invalid_timestamp_count} rows have invalid event_timestamp values."
        ));
    }
    if let Some(warning) = parse_warning {
        warnings.push(warning);
    }

    serde_json::to_string(&RawFileInspection {
        file_name: file_name.to_string(),
        size_bytes: size_bytes.max(0.0) as u64,
        row_count: physical_data_row_count(csv_bytes),
        participant_count: participants.len(),
        columns,
        timezones: timezones.into_iter().collect(),
        has_required_columns: missing.is_empty(),
        invalid_timestamp_count,
        missing_timestamp_count,
        missing_timezone_count,
        duplicate_timestamp_count,
        out_of_order_timestamp_count,
        first_out_of_order_row,
        unrecognized_interaction_types: unrecognized_interaction_types.into_iter().collect(),
        warnings,
    })
    .expect("RawFileInspection serialization cannot fail")
}

#[wasm_bindgen]
pub fn build_environment_digest() -> String {
    BUILD_ENVIRONMENT_DIGEST.into()
}

#[wasm_bindgen]
pub fn runtime_identity_json() -> String {
    serde_jcs::to_string(&serde_json::json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "implementationDigest": IMPLEMENTATION_BUILD_DIGEST,
        "buildEnvironmentDigest": BUILD_ENVIRONMENT_DIGEST,
        "productContractDigest": EMBEDDED_PRODUCT_CONTRACT_SHA256,
        "planDigest": EMBEDDED_PLAN_SHA256,
        "profileDigest": EMBEDDED_PROFILE_SHA256,
        "profileLockDigest": EMBEDDED_PROFILE_LOCK_SHA256,
        "runtimeAuthorityDigest": EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        "dependencyCertificateDigest": EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
    }))
    .expect("runtime identity is serializable")
}

#[wasm_bindgen]
pub fn pipeline_step_contract_json() -> String {
    serde_json::to_string(&chronicle_chrono_kernel_wasm::step_contract::pipeline_step_contract())
        .expect("Rust pipeline step contract is serializable")
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
        chronicle_preprocessing_semantic_adapter::views::StageViewInput {
            plan: &plan,
            materialization: &materialization,
            executions: &[],
            step_statuses: &BTreeMap::new(),
            options: &semantic_options,
            stage: None,
            revision: 0,
            root_digest: &projection_root,
        },
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
    fn validate(&self, csv_bytes: &[u8]) -> Result<String, String> {
        if self.protocol_version != RUNTIME_PROTOCOL_VERSION {
            return Err(format!(
                "unsupported protocol version: {}",
                self.protocol_version
            ));
        }
        if self.command != EXECUTE_WORKSPACE_COMMAND && self.command != QUERY_REVIEW_COMMAND {
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
        Ok(actual)
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_rows: Option<Vec<Vec<String>>>,
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
pub struct RuntimeStepExecution {
    pub step_id: String,
    pub unit_id: String,
    pub status: ExecutionStatus,
    pub input_key: String,
    pub output_digest: String,
    pub reason_id: String,
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
    pub timezone_retained_source_rows_digest: String,
    pub timezone_stage_digest: String,
    pub logical_stage_digests: BTreeMap<String, String>,
    pub logical_stage_checkpoints: BTreeMap<String, LogicalStageCheckpoint>,
    pub pipeline_step_digests: BTreeMap<String, String>,
    pub pipeline_step_checkpoints: BTreeMap<String, LogicalStageCheckpoint>,
    pub published_outputs_digest: String,
    pub provenance_digest: String,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub protocol_version: String,
    pub preprocessor_version: String,
    pub request_id: String,
    pub command: String,
    pub implementation: String,
    pub implementation_digest: String,
    pub build_environment_digest: String,
    pub scope: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub runtime_authority_digest: String,
    pub product_contract_digest: String,
    pub dependency_certificate_digest: String,
    pub dependency_cache_decision: DependencyCacheDecision,
    pub previous_workspace_root_digest: Option<String>,
    pub workspace_id: String,
    pub workspace_root_digest: String,
    pub input: ArtifactRef,
    pub role_assignments: Vec<RoleAssignment>,
    pub qualification_traces: Vec<chronicle_preprocessing_semantic_adapter::QualificationTrace>,
    pub requirement_traces: Vec<chronicle_preprocessing_semantic_adapter::RoleRequirementTrace>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
    pub node_executions: Vec<NodeExecution>,
    pub step_executions: Vec<RuntimeStepExecution>,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
    pub counts: RuntimeCounts,
    pub processing_summary: RuntimeProcessingSummary,
    pub journal_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRuntimeManifest {
    pub protocol_version: String,
    pub preprocessor_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_id: String,
    pub previous_workspace_root_digest: Option<String>,
    pub input_digest: String,
    pub options_digest: String,
    pub implementation_digest: String,
    pub build_environment_digest: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub product_contract_digest: String,
    pub dependency_certificate_digest: String,
    pub dependency_cache_decision: DependencyCacheDecision,
    pub counts: RuntimeCounts,
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub node_executions: Vec<NodeExecution>,
    pub step_executions: Vec<RuntimeStepExecution>,
    pub review_summary_digest: String,
    pub comparison_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementsReport {
    pub protocol_version: &'static str,
    pub ready: bool,
    pub role_assignments: Vec<RoleAssignment>,
    pub qualification_traces: Vec<chronicle_preprocessing_semantic_adapter::QualificationTrace>,
    pub requirement_traces: Vec<chronicle_preprocessing_semantic_adapter::RoleRequirementTrace>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub role_states: BTreeMap<String, MaterializationState>,
    pub node_states: BTreeMap<String, MaterializationState>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootCommit<'a> {
    protocol_version: &'a str,
    command: &'a str,
    implementation_digest: &'a str,
    build_environment_digest: &'a str,
    product_contract_digest: &'a str,
    plan_digest: &'a str,
    profile_digest: &'a str,
    profile_lock_digest: &'a str,
    runtime_authority_digest: &'a str,
    dependency_certificate_digest: &'a str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<String>,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    artifact_digests: Vec<&'a str>,
    execution_state_digest: &'a str,
    required_views: &'a [RequiredViewBinding],
    journal_digest: &'a str,
    artifact_closure_digest: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequiredViewBinding {
    artifact_kind: &'static str,
    view_id: &'static str,
    schema_id: &'static str,
    artifact_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionStateCommit<'a> {
    protocol_version: &'static str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    product_contract_digest: &'static str,
    plan_digest: &'static str,
    profile_digest: &'static str,
    profile_lock_digest: &'static str,
    runtime_authority_digest: &'static str,
    dependency_certificate_digest: &'static str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<String>,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    computational_artifact_digests: Vec<&'a str>,
    journal_digest: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactClosure<'a> {
    protocol_version: &'static str,
    workspace_id: &'a str,
    input_digest: &'a str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    plan_digest: &'static str,
    profile_digest: &'static str,
    profile_lock_digest: &'static str,
    runtime_authority_digest: &'static str,
    product_contract_digest: &'static str,
    dependency_certificate_digest: &'static str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    previous_workspace_root_digest: &'a Option<String>,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    execution_state_digest: &'a str,
    journal_digest: &'a str,
    artifacts: Vec<&'a RuntimeArtifactMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CorrespondenceEdge {
    edge_id: String,
    source_kind: &'static str,
    source_id: String,
    relation: String,
    target_kind: &'static str,
    target_id: String,
    precision: &'static str,
    evidence_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CorrespondenceIndex {
    protocol_version: &'static str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    plan_digest: &'static str,
    profile_lock_digest: &'static str,
    product_contract_digest: &'static str,
    claim_boundary: &'static str,
    source_coordinate_artifact_kind: &'static str,
    row_correspondence_artifact_kind: &'static str,
    cell_correspondence_artifact_kind: &'static str,
    edges: Vec<CorrespondenceEdge>,
}

#[derive(Clone)]
struct RuntimeArtifact {
    metadata: RuntimeArtifactMetadata,
    bytes: RuntimeArtifactBytes,
}

#[derive(Clone)]
enum RuntimeArtifactBytes {
    Owned(Vec<u8>),
    Shared(Arc<[u8]>),
    PipelineOutput {
        result: Arc<PipelineV2Result>,
        kind: String,
    },
}

struct IncrementalPipelineExecution {
    result: Arc<PipelineV2Result>,
    review_base: Option<Vec<u8>>,
    node_executions: Vec<NodeExecution>,
    step_executions: Vec<RuntimeStepExecution>,
    cache_decision: DependencyCacheDecision,
    node_artifacts: Vec<RuntimeArtifact>,
}

struct CorrespondenceIndexInputs<'a> {
    plan: &'a chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    assignments: &'a BTreeMap<String, RoleAssignment>,
    materialization: &'a chronicle_preprocessing_semantic_adapter::Materialization,
    node_executions: &'a [NodeExecution],
    options: &'a Value,
    artifacts: &'a [RuntimeArtifact],
    checkpoints: &'a BTreeMap<String, LogicalStageCheckpoint>,
    step_checkpoints: &'a BTreeMap<String, LogicalStageCheckpoint>,
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
    incremental_engine: IncrementalPipelineV2Engine,
    previous_step_observations: BTreeMap<String, PreviousStepObservation>,
    previous_stage_inputs: BTreeMap<String, String>,
    stable_artifact_bundle: Option<StableArtifactBundle>,
    last_workspace_root: Option<String>,
}

#[derive(Clone)]
struct StableArtifactBundle {
    key: String,
    result_digests: PipelineResultDigests,
    binary_artifacts: Vec<RuntimeArtifact>,
    source_coordinate_artifact: RuntimeArtifact,
}

#[derive(Debug, Clone)]
struct PreviousStepObservation {
    input_key: String,
    output_digest: String,
    applicable: bool,
}

// A WASM worker processes one workspace at a time. Retaining eight complete
// pipeline results kept hundreds of megabytes (or more) alive when a batch
// worker moved between files. Preserve warm incremental reuse for the current
// workspace and evict the previous workspace before accepting another.
const MAX_INCREMENTAL_RUNTIME_STATES: usize = 1;

#[derive(Default)]
struct IncrementalRuntimeStateCache {
    states: BTreeMap<String, IncrementalRuntimeState>,
    lru: VecDeque<String>,
}

impl IncrementalRuntimeStateCache {
    fn state_for(&mut self, workspace_id: &str) -> &mut IncrementalRuntimeState {
        self.lru.retain(|candidate| candidate != workspace_id);
        if !self.states.contains_key(workspace_id)
            && self.states.len() >= MAX_INCREMENTAL_RUNTIME_STATES
        {
            if let Some(evicted) = self.lru.pop_front() {
                self.states.remove(&evicted);
            }
        }
        self.lru.push_back(workspace_id.to_string());
        self.states.entry(workspace_id.to_string()).or_default()
    }

    fn get_mut(&mut self, workspace_id: &str) -> Option<&mut IncrementalRuntimeState> {
        self.states.get_mut(workspace_id)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StableArtifactKey<'a> {
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    workspace_id: &'a str,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    assemble_result_digest: &'a str,
    dependency_cache_mode: DependencyCacheMode,
}

fn stable_artifact_key(
    workspace_id: &str,
    input_digest: &str,
    options_digest: &str,
    assignments: &BTreeMap<String, RoleAssignment>,
    result: &PipelineV2Result,
    dependency_cache_mode: DependencyCacheMode,
) -> Result<String, String> {
    let assemble_result_digest = result
        .pipeline_step_digests
        .get("assemble_result")
        .ok_or_else(|| "tracked result omitted assemble_result checkpoint".to_string())?;
    Ok(sha256(
        &serde_jcs::to_vec(&StableArtifactKey {
            implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
            build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
            workspace_id,
            input_digest,
            options_digest,
            assignment_digests: assignments
                .iter()
                .map(|(role, assignment)| (role.as_str(), assignment.artifact.digest.as_str()))
                .collect(),
            assemble_result_digest,
            dependency_cache_mode,
        })
        .map_err(|error| format!("canonicalize stable artifact key: {error}"))?,
    ))
}

fn cached_stable_artifact_bundle(workspace_id: &str, key: &str) -> Option<StableArtifactBundle> {
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        states
            .borrow_mut()
            .get_mut(workspace_id)
            .and_then(|state| state.stable_artifact_bundle.as_ref())
            .filter(|bundle| bundle.key == key)
            .cloned()
    })
}

fn store_stable_artifact_bundle(workspace_id: &str, bundle: StableArtifactBundle) {
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        if let Some(state) = states.borrow_mut().get_mut(workspace_id) {
            state.stable_artifact_bundle = Some(bundle);
        }
    });
}

thread_local! {
    static INCREMENTAL_RUNTIME_STATES: RefCell<IncrementalRuntimeStateCache> =
        RefCell::new(IncrementalRuntimeStateCache::default());
}

#[cfg(test)]
thread_local! {
    static TRACKED_PHYSICAL_EXECUTION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static STABLE_ARTIFACT_GENERATION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn compute_pipeline_result_digest(
    result: &PipelineV2Result,
    published_outputs_digest: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update((IMPLEMENTATION_BUILD_DIGEST.len() as u64).to_le_bytes());
    digest.update(IMPLEMENTATION_BUILD_DIGEST.as_bytes());
    digest.update((BUILD_ENVIRONMENT_DIGEST.len() as u64).to_le_bytes());
    digest.update(BUILD_ENVIRONMENT_DIGEST.as_bytes());
    // The published-output commitment already binds every output kind, byte
    // length, row count, and SHA-256. Re-hashing the full CSV/JSON payloads here
    // made provenance construction traverse the largest outputs a second time.
    digest.update((published_outputs_digest.len() as u64).to_le_bytes());
    digest.update(published_outputs_digest.as_bytes());
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
            "timezoneRetainedSourceRowsDigest": result.timezone_retained_source_rows_digest,
            "timezoneStageDigest": result.timezone_stage_digest,
            "rowLineage": result.row_lineage,
            "logicalStageDigests": result.logical_stage_digests,
            "logicalStageCheckpoints": result.logical_stage_checkpoints,
            "pipelineStepDigests": result.pipeline_step_digests,
            "pipelineStepCheckpoints": result.pipeline_step_checkpoints,
        }))
        .expect("pipeline result digest metadata is serializable"),
    );
    format!("sha256:{}", hex::encode(digest.finalize()))
}

/// Digest only researcher-visible computational outputs. Configuration choice
/// and lineage remain separately observable in `compute_pipeline_result_digest`, so
/// equal bytes can collapse without erasing how those bytes were obtained.
#[derive(Clone)]
struct PipelineResultDigests {
    published_outputs_digest: String,
    provenance_digest: String,
    output_digests: BTreeMap<String, String>,
}

fn pipeline_result_digests(result: &PipelineV2Result) -> PipelineResultDigests {
    let mut output_digests = BTreeMap::new();
    let mut published = Sha256::new();
    let fixed_outputs = [
        (
            "app-csv",
            result.app_csv_bytes.as_slice(),
            result.app_row_count,
        ),
        (
            "screen-csv",
            result.screen_csv_bytes.as_slice(),
            result.screen_row_count,
        ),
        (
            "day-coverage-csv",
            result.day_coverage_csv_bytes.as_slice(),
            result.day_coverage_row_count,
        ),
        (
            "compliance-csv",
            result.compliance_csv_bytes.as_slice(),
            result.compliance_row_count,
        ),
        (
            "credited-app-csv",
            result.credited_app_csv_bytes.as_slice(),
            result.credited_app_row_count,
        ),
        (
            "review-summary-json",
            result.review_summary_json_bytes.as_slice(),
            0,
        ),
        (
            "visualization-data-json",
            result.visualization_data_json_bytes.as_slice(),
            0,
        ),
    ];
    let output_count = fixed_outputs.len() + result.aggregate_csv_outputs.len();
    published.update(b"chronicle-published-outputs-digest/v2");
    published.update((output_count as u64).to_le_bytes());
    for (kind, bytes, row_count) in
        fixed_outputs
            .into_iter()
            .chain(result.aggregate_csv_outputs.iter().map(|aggregate| {
                (
                    aggregate.kind.as_str(),
                    aggregate.bytes.as_slice(),
                    aggregate.row_count,
                )
            }))
    {
        let digest = sha256(bytes);
        for field in [kind.as_bytes(), digest.as_bytes()] {
            published.update((field.len() as u64).to_le_bytes());
            published.update(field);
        }
        published.update((bytes.len() as u64).to_le_bytes());
        published.update(row_count.to_le_bytes());
        output_digests.insert(kind.to_string(), digest);
    }
    let published_outputs_digest = format!("sha256:{}", hex::encode(published.finalize()));
    let provenance_digest =
        compute_pipeline_result_digest(result, published_outputs_digest.as_str());
    PipelineResultDigests {
        published_outputs_digest,
        provenance_digest,
        output_digests,
    }
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
        (
            "process_app_usage",
            Value::Bool(matches!(
                options.usage_session_mode.as_str(),
                "app_usage" | "app_and_screen_usage"
            )),
        ),
        (
            "process_screen_usage",
            Value::Bool(matches!(
                options.usage_session_mode.as_str(),
                "screen_usage" | "app_and_screen_usage"
            )),
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
    object.retain(|key, _| CERTIFIED_OPTION_KEYS.contains(&key.as_str()));
    let actual_keys = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected_keys = CERTIFIED_OPTION_KEYS
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if actual_keys != expected_keys {
        return Err(format!(
            "semantic option projection does not match the dependency certificate: missing={:?} unexpected={:?}",
            expected_keys.difference(&actual_keys).collect::<Vec<_>>(),
            actual_keys.difference(&expected_keys).collect::<Vec<_>>(),
        ));
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
    content_validation_error: Option<String>,
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
            let content_validation_error =
                chronicle_chrono_kernel_wasm::pipeline_v2::validate_support_csv(
                    role,
                    &pipeline_csv,
                )
                .err();
            resolved.files.insert(
                role.clone(),
                ResolvedSupportFile {
                    media_type,
                    original_bytes: file.bytes.clone(),
                    pipeline_csv,
                    normalized_from_xlsx,
                    content_validation_error,
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

#[derive(Serialize)]
struct RuntimeStepKeyMaterial {
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    contract_digest: &'static str,
    applicable: bool,
    upstream: BTreeMap<String, String>,
    request_fields: BTreeMap<String, Value>,
    source_roles: BTreeMap<String, Option<String>>,
    output_mode: Option<&'static str>,
}

fn review_excludes_step(step_id: &str) -> bool {
    matches!(
        step_id,
        "partition_credit_sessions"
            | "build_liveness_substrate"
            | "report_screen_incapable"
            | "count_day_apps"
            | "credit_sessions"
            | "emit_credited_rows"
            | "assemble_credit_result"
            | "build_raw_date_index"
            | "build_coverage_table"
            | "accumulate_attribution_minutes"
            | "score_days"
    )
}

fn review_uses_passthrough_checkpoint(step_id: &str) -> bool {
    matches!(
        step_id,
        "apply_matcher_output"
            | "relabel_usage_with_floor"
            | "junk_downstream_mark"
            | "sort_episodes"
            | "codebook_join"
            | "derive_broad_category"
            | "collapse_genre"
            | "engagement_walk"
            | "flag_and_retain"
            | "blank_junk_timing"
            | "drop_selected_types"
            | "drop_zero_duration"
            | "filter_rows_to_window"
            | "attribute_rows"
            | "inject_placeholders"
    )
}

struct RuntimeStepExecutionState<'a> {
    executed_steps: &'a [String],
    materialize_full_outputs: bool,
    previous_observations: &'a mut BTreeMap<String, PreviousStepObservation>,
}

fn build_runtime_step_executions(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    exact_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
    result: &PipelineV2Result,
    state: &mut RuntimeStepExecutionState<'_>,
) -> Result<Vec<RuntimeStepExecution>, String> {
    let plan_steps = plan
        .steps
        .iter()
        .map(|step| (step.step_id.as_str(), step))
        .collect::<BTreeMap<_, _>>();
    let contract_ids = PIPELINE_STEPS
        .iter()
        .map(|step| step.id)
        .collect::<BTreeSet<_>>();
    let plan_ids = plan_steps.keys().copied().collect::<BTreeSet<_>>();
    if contract_ids != plan_ids {
        return Err(format!(
            "Rust step contract and embedded product plan disagree: rust_only={:?}, plan_only={:?}",
            contract_ids.difference(&plan_ids).collect::<Vec<_>>(),
            plan_ids.difference(&contract_ids).collect::<Vec<_>>(),
        ));
    }

    let exact_object = exact_options
        .as_object()
        .ok_or_else(|| "exact Rust options must serialize as an object".to_string())?;
    let executed_steps = state
        .executed_steps
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let unknown_executions = executed_steps
        .difference(&contract_ids)
        .copied()
        .collect::<Vec<_>>();
    if !unknown_executions.is_empty() {
        return Err(format!(
            "incremental engine reported unknown executed steps: {unknown_executions:?}"
        ));
    }
    let mut executions = Vec::with_capacity(PIPELINE_STEPS.len());
    let mut binding_gaps = Vec::new();
    let mut next_observations = BTreeMap::new();
    for definition in PIPELINE_STEPS {
        let plan_step = plan_steps[definition.id];
        let output_digest = result
            .pipeline_step_digests
            .get(definition.id)
            .ok_or_else(|| format!("missing Rust checkpoint digest for {}", definition.id))?
            .clone();
        let upstream = definition
            .inputs
            .iter()
            .map(|input| {
                result
                    .pipeline_step_digests
                    .get(*input)
                    .cloned()
                    .map(|digest| ((*input).to_string(), digest))
                    .ok_or_else(|| format!("{} has no checkpoint for input {input}", definition.id))
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let request_fields = step_request_fields(definition.id)
            .iter()
            .map(|field| {
                exact_object
                    .get(*field)
                    .cloned()
                    .map(|value| ((*field).to_string(), value))
                    .ok_or_else(|| {
                        format!(
                            "{} binds unknown exact request field {field}",
                            definition.id
                        )
                    })
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let source_roles = step_source_role_bindings(definition.id)
            .into_iter()
            .filter_map(|binding| {
                let active = binding.when_all.iter().all(|predicate| match predicate {
                    PipelineSourceRolePredicate::BooleanEquals {
                        request_field,
                        value,
                    } => exact_object
                        .get(*request_field)
                        .and_then(Value::as_bool)
                        .is_some_and(|actual| actual == *value),
                    PipelineSourceRolePredicate::StringOneOf {
                        request_field,
                        values,
                    } => exact_object
                        .get(*request_field)
                        .and_then(Value::as_str)
                        .is_some_and(|actual| values.contains(&actual)),
                });
                active.then(|| {
                    let role = binding.role;
                    (
                        role.to_string(),
                        assignments
                            .get(role)
                            .map(|assignment| assignment.artifact.digest.clone()),
                    )
                })
            })
            .collect();
        let applicable = plan_step.applicability.evaluate(semantic_options);
        let input_key = sha256(
            &serde_jcs::to_vec(&RuntimeStepKeyMaterial {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
                contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                applicable,
                upstream,
                request_fields,
                source_roles,
                output_mode: (definition.id == "assemble_result"
                    || review_excludes_step(definition.id)
                    || review_uses_passthrough_checkpoint(definition.id))
                .then_some(if state.materialize_full_outputs {
                    "full"
                } else {
                    "review"
                }),
            })
            .map_err(|error| format!("canonicalize {} input key: {error}", definition.id))?,
        );
        let previous = state.previous_observations.get(definition.id);
        if previous.is_some_and(|entry| {
            entry.input_key == input_key && entry.output_digest != output_digest
        }) {
            binding_gaps.push(definition.id.to_string());
        }
        let status = if !applicable && plan_step.can_bypass {
            ExecutionStatus::Bypassed
        } else if !state.materialize_full_outputs && review_excludes_step(definition.id) {
            ExecutionStatus::Skipped
        } else if executed_steps.contains(definition.id) {
            ExecutionStatus::Recomputed
        } else {
            ExecutionStatus::Cached
        };
        let reason_id = sha256(
            format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                definition.id,
                input_key,
                output_digest,
                match status {
                    ExecutionStatus::Cached => "cached",
                    ExecutionStatus::Recomputed => "recomputed",
                    ExecutionStatus::Bypassed => "bypassed",
                    ExecutionStatus::Error => "error",
                    ExecutionStatus::Skipped => "skipped",
                }
            )
            .as_bytes(),
        );
        executions.push(RuntimeStepExecution {
            step_id: definition.id.to_string(),
            unit_id: definition.group.to_string(),
            status,
            input_key: input_key.clone(),
            output_digest: output_digest.clone(),
            reason_id,
        });
        next_observations.insert(
            definition.id.to_string(),
            PreviousStepObservation {
                input_key,
                output_digest,
                applicable,
            },
        );
    }

    if !binding_gaps.is_empty() {
        return Err(format!(
            "tracked step output changed without a changed bound input: {}",
            binding_gaps.join(",")
        ));
    }
    *state.previous_observations = next_observations;
    Ok(executions)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductStageInputKey<'a> {
    implementation_digest: &'static str,
    contract_digest: &'static str,
    node_id: &'a str,
    semantic_output_digest: &'a str,
    step_inputs: BTreeMap<&'a str, (&'a str, &'a str)>,
}

fn project_product_stages(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    result: &PipelineV2Result,
    step_executions: &[RuntimeStepExecution],
    deactivated_groups: &BTreeSet<&str>,
    previous_stage_inputs: &mut BTreeMap<String, String>,
) -> Result<(Vec<NodeExecution>, Vec<RuntimeArtifact>), String> {
    let mut executions = Vec::with_capacity(plan.nodes.len());
    let mut artifacts = Vec::with_capacity(plan.nodes.len());
    for node in &plan.nodes {
        let members = step_executions
            .iter()
            .filter(|execution| execution.unit_id == node.node_id)
            .collect::<Vec<_>>();
        if members.is_empty() {
            return Err(format!(
                "product stage {} contains no tracked Rust queries",
                node.node_id
            ));
        }
        let checkpoint = result
            .logical_stage_checkpoints
            .get(&node.node_id)
            .ok_or_else(|| {
                format!(
                    "tracked pipeline omitted typed product-stage checkpoint {}",
                    node.node_id
                )
            })?;
        let semantic_output_digest = if node.node_id == "outputs" {
            sha256(
                &serde_jcs::to_vec(&serde_json::json!({
                    "checkpoint": result.logical_stage_digests.get(&node.node_id),
                    "enableParquetExport": semantic_options["enable_parquet_export"],
                    "enableSpssExport": semantic_options["enable_spss_export"],
                }))
                .map_err(|error| format!("canonicalize output-stage extensions: {error}"))?,
            )
        } else {
            result
                .logical_stage_digests
                .get(&node.node_id)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "tracked pipeline omitted product-stage digest {}",
                        node.node_id
                    )
                })?
        };
        let bytes = serde_jcs::to_vec(&serde_json::json!({
            "checkpointProtocol": "chronicle-logical-stage-checkpoint/v3",
            "physicalExecution": "salsa-tracked-rust-pipeline-v2",
            "projection": "product-stage-from-actual-step-events",
            "logicalNode": node.node_id,
            "semanticOutputDigest": semantic_output_digest,
            "typedCheckpoint": checkpoint,
        }))
        .map_err(|error| {
            format!(
                "canonicalize {} product-stage projection: {error}",
                node.node_id
            )
        })?;
        let derived_from = members
            .iter()
            .map(|execution| execution.output_digest.clone())
            .collect::<Vec<_>>();
        let artifact = runtime_artifact(
            &format!("node-output:{}", node.node_id),
            "application/vnd.chronicle.node-fingerprint+json",
            bytes,
            derived_from,
        );
        let output = ArtifactRef {
            artifact_id: artifact.metadata.artifact_id.clone(),
            digest: artifact.metadata.digest.clone(),
            media_type: artifact.metadata.media_type.clone(),
            size: artifact.metadata.size,
            derived_from: artifact.metadata.derived_from.clone(),
            qualifiers: BTreeMap::new(),
        };
        let input_key = sha256(
            &serde_jcs::to_vec(&ProductStageInputKey {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                node_id: &node.node_id,
                semantic_output_digest: &semantic_output_digest,
                step_inputs: members
                    .iter()
                    .map(|execution| {
                        (
                            execution.step_id.as_str(),
                            (
                                execution.input_key.as_str(),
                                execution.output_digest.as_str(),
                            ),
                        )
                    })
                    .collect(),
            })
            .map_err(|error| format!("canonicalize {} product-stage key: {error}", node.node_id))?,
        );
        let projection_changed = previous_stage_inputs
            .get(&node.node_id)
            .is_none_or(|previous| previous != &input_key);
        let status = if members
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Error)
        {
            ExecutionStatus::Error
        } else if !node.applicability.evaluate(semantic_options) && node.can_bypass {
            ExecutionStatus::Bypassed
        } else if members
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Skipped)
        {
            ExecutionStatus::Skipped
        } else if projection_changed
            || deactivated_groups.contains(node.node_id.as_str())
            || members
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Recomputed)
        {
            ExecutionStatus::Recomputed
        } else {
            ExecutionStatus::Cached
        };
        let reason = match status {
            ExecutionStatus::Cached => "all-active-queries-reused",
            ExecutionStatus::Recomputed => "product-stage-projection-changed",
            ExecutionStatus::Bypassed => "product-stage-not-applicable",
            ExecutionStatus::Skipped => "query-skipped",
            ExecutionStatus::Error => "query-error",
        };
        executions.push(NodeExecution {
            node_id: node.node_id.clone(),
            capability_id: node.capability_id.clone(),
            status,
            input_key: input_key.clone(),
            output: Some(output),
            reason_id: stable_id(&[reason, &node.node_id, &artifact.metadata.digest]),
        });
        previous_stage_inputs.insert(node.node_id.clone(), input_key);
        artifacts.push(artifact);
    }
    Ok((executions, artifacts))
}

fn execute_incremental_pipeline(
    request: &RuntimeRequest,
    ingress_assignments: &BTreeMap<String, RoleAssignment>,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    options_value: &Value,
    options: &PipelineV2Options,
    support: &ResolvedSupportFiles,
) -> Result<IncrementalPipelineExecution, String> {
    let plan = embedded_plan();
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.state_for(&request.workspace_id);
        if request.workspace_root_digest != state.last_workspace_root {
            *state = IncrementalRuntimeState::default();
            // A fresh worker has no opaque Salsa snapshot, but the caller may
            // still be continuing from a verified OPFS root. Adopt that root
            // as the base for this disposable in-memory engine after the
            // required cold rebuild. Review requests do not create a new root,
            // so without this assignment the next review reset again.
            state.last_workspace_root = request.workspace_root_digest.clone();
        }
        let certificate = embedded_dependency_certificate();
        let empirical_evidence_current = dependency_evidence_current(&certificate);
        let cache_decision = evaluate_dependency_cache_decision(
            &plan,
            Some(&certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            empirical_evidence_current,
            options_value,
            ingress_assignments,
        )
        .map_err(|error| error.to_string())?;
        if cache_decision.mode == DependencyCacheMode::ConservativeFull {
            state.incremental_engine = IncrementalPipelineV2Engine::default();
            state.previous_step_observations.clear();
            state.previous_stage_inputs.clear();
            state.stable_artifact_bundle = None;
        }

        let support_files = PipelineV2SupportFiles {
            filter_csv: support.get("filter_file"),
            apps_forcing_csv: support.get("apps_forcing_screen_open_file"),
            background_apps_csv: support.get("background_apps_file"),
            codebook_csv: support.get("app_codebook_file"),
            study_dates_csv: support.get("study_dates_file"),
            device_sharing_csv: support.get("device_sharing_file"),
            survey_attribution_csv: support.get("survey_attribution_file"),
            enrolled_devices_csv: support.get("enrolled_devices_file"),
        };
        let tracked_execution = if request.command == QUERY_REVIEW_COMMAND {
            state.incremental_engine.execute_review_with_base(
                csv_bytes,
                review_base_bytes,
                options,
                support_files,
            )?
        } else {
            state
                .incremental_engine
                .execute(csv_bytes, options, support_files)?
        };
        let review_base = if request.command == QUERY_REVIEW_COMMAND {
            None
        } else {
            Some(state.incremental_engine.export_review_base()?)
        };
        let executed_steps = tracked_execution.executed_steps;
        #[cfg(test)]
        if !executed_steps.is_empty() {
            TRACKED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(count.get() + 1));
        }
        let previous_step_observations = state.previous_step_observations.clone();
        let exact_options = serde_json::to_value(&request.options)
            .map_err(|error| format!("serialize exact Rust options for step scheduler: {error}"))?;
        let step_executions = build_runtime_step_executions(
            &plan,
            options_value,
            &exact_options,
            ingress_assignments,
            &tracked_execution.result,
            &mut RuntimeStepExecutionState {
                executed_steps: &executed_steps,
                materialize_full_outputs: request.command != QUERY_REVIEW_COMMAND,
                previous_observations: &mut state.previous_step_observations,
            },
        )?;
        let deactivated_groups = step_executions
            .iter()
            .filter(|execution| {
                execution.status == ExecutionStatus::Bypassed
                    && previous_step_observations
                        .get(&execution.step_id)
                        .is_some_and(|entry| entry.applicable)
            })
            .map(|execution| execution.unit_id.as_str())
            .collect::<BTreeSet<_>>();
        let result = tracked_execution.result;
        let (executions, node_artifacts) = project_product_stages(
            &plan,
            options_value,
            &result,
            &step_executions,
            &deactivated_groups,
            &mut state.previous_stage_inputs,
        )?;
        Ok(IncrementalPipelineExecution {
            result,
            review_base,
            node_executions: executions,
            step_executions,
            cache_decision,
            node_artifacts,
        })
    })
}

fn dependency_evidence_current(
    certificate: &chronicle_preprocessing_semantic_adapter::DependencyCertificate,
) -> bool {
    #[cfg(feature = "dependency-campaign-bootstrap")]
    {
        // This build exists only so a changed implementation can regenerate
        // the evidence that production requires. Its package is temporary and
        // its distinct build-environment digest makes the mode observable.
        let _ = certificate;
        return true;
    }

    #[cfg(not(feature = "dependency-campaign-bootstrap"))]
    {
        let receipt = &certificate.evidence.implementation_receipt;
        receipt.implementation == "chronicle_preprocessing_runtime_wasm/0.1.0"
            && receipt.implementation_digest == IMPLEMENTATION_BUILD_DIGEST
            && receipt.plan_digest == EMBEDDED_PLAN_SHA256
            && receipt.profile_digest == EMBEDDED_PROFILE_SHA256
            && receipt.profile_lock_digest == EMBEDDED_PROFILE_LOCK_SHA256
            && receipt.runtime_authority_digest == EMBEDDED_RUNTIME_AUTHORITY_SHA256
            && receipt.product_contract_digest == EMBEDDED_PRODUCT_CONTRACT_SHA256
    }
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
        let payload =
            std::mem::replace(&mut artifact.bytes, RuntimeArtifactBytes::Owned(Vec::new()));
        match payload {
            RuntimeArtifactBytes::Owned(bytes) => Ok(bytes),
            RuntimeArtifactBytes::Shared(bytes) => Ok(bytes.as_ref().to_vec()),
            RuntimeArtifactBytes::PipelineOutput { result, kind } => {
                pipeline_output_bytes(&result, &kind)
                    .map(<[u8]>::to_vec)
                    .ok_or_else(|| JsValue::from_str("cached pipeline output kind is missing"))
            }
        }
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

/// Execute an interactive review with an optional verified early-row cache.
/// The Rust kernel rechecks the cache key against the raw input and all
/// options/support files that can affect those rows; a mismatch is a normal
/// cache miss and runs the raw path.
#[wasm_bindgen]
pub fn execute_workspace_with_review_base(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native_with_review_base(
        request_json,
        csv_bytes,
        review_base_bytes,
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Resolve product-owned role requirements without executing computation.
/// The browser can render binding holes from this report; ExecuteWorkspace
/// independently enforces the same report and fails closed when it is not
/// ready, so UI validation can never become the only safety boundary.
#[wasm_bindgen]
pub fn evaluate_workspace_requirements(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, JsValue> {
    evaluate_workspace_requirements_native(request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

pub fn evaluate_workspace_requirements_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let verified_input_digest = request.validate(csv_bytes)?;
    let options_value = semantic_options_value(&request.options)?;
    // Cache and provenance identity use the exact Rust request, not the reduced
    // semantic/UI projection. The latter is only for applicability and human
    // explanations. This prevents an accepted Rust field from changing the
    // computation while disappearing from the cache key.
    let exact_options_value = serde_json::to_value(&request.options)
        .map_err(|error| format!("serialize exact Rust options: {error}"))?;
    let options_bytes = serde_jcs::to_vec(&exact_options_value)
        .map_err(|error| format!("canonicalize exact Rust options: {error}"))?;
    let resolved_support = support_files.resolve()?;
    let ingress = materialize_ingress(
        csv_bytes,
        &verified_input_digest,
        &options_bytes,
        &options_value,
        &resolved_support,
    )?;
    let report = RuntimeRequirementsReport {
        protocol_version: "chronicle-requirements-report/v1",
        ready: ingress.materialization.obligations.is_empty(),
        role_assignments: ingress.assignments.values().cloned().collect(),
        qualification_traces: ingress.materialization.qualification_traces,
        requirement_traces: ingress.materialization.requirement_traces,
        open_obligations: ingress.materialization.obligations,
        role_states: ingress.materialization.role_states,
        node_states: ingress.materialization.node_states,
        state_reasons: ingress.materialization.reasons,
    };
    let bytes = serde_jcs::to_vec(&report)
        .map_err(|error| format!("canonicalize requirements report: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("requirements report was not UTF-8: {error}"))
}

fn reject_open_binding_holes(
    materialization: &chronicle_preprocessing_semantic_adapter::Materialization,
) -> Result<(), String> {
    let roles = materialization
        .obligations
        .iter()
        .map(|obligation| obligation.role_id.as_str())
        .collect::<BTreeSet<_>>();
    if roles.is_empty() {
        return Ok(());
    }
    Err(format!(
        "unresolved binding holes for required roles: {}; evaluate requirements before execution",
        roles.into_iter().collect::<Vec<_>>().join(", ")
    ))
}

#[wasm_bindgen]
pub fn verify_evidence_journal_cbor(bytes: &[u8]) -> Result<u32, JsValue> {
    EvidenceJournal::from_cbor(bytes)
        .map(|journal| journal.events().len() as u32)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

pub fn execute_workspace_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native_with_review_base(request_json, csv_bytes, &[], support_files)
}

pub fn execute_workspace_native_with_review_base(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let verified_input_digest = request.validate(csv_bytes)?;
    let options_value = semantic_options_value(&request.options)?;
    let exact_options_value = serde_json::to_value(&request.options)
        .map_err(|error| format!("serialize exact Rust options: {error}"))?;
    let options_bytes = serde_jcs::to_vec(&exact_options_value)
        .map_err(|error| format!("canonicalize exact Rust options: {error}"))?;
    let options_digest = sha256(&options_bytes);
    let resolved_support = support_files.resolve()?;
    let pipeline_options = request.options.clone().into_pipeline_options();
    let mut ingress = materialize_ingress(
        csv_bytes,
        &verified_input_digest,
        &options_bytes,
        &options_value,
        &resolved_support,
    )?;
    reject_open_binding_holes(&ingress.materialization)?;
    let IncrementalPipelineExecution {
        result,
        review_base,
        node_executions,
        step_executions,
        cache_decision: dependency_cache_decision,
        node_artifacts,
    } = execute_incremental_pipeline(
        &request,
        &ingress.assignments,
        csv_bytes,
        review_base_bytes,
        &options_value,
        &pipeline_options,
        &resolved_support,
    )?;
    let assignment_digests = ingress
        .assignments
        .values()
        .map(|assignment| assignment.artifact.digest.clone())
        .collect::<Vec<_>>();
    if request.command == QUERY_REVIEW_COMMAND {
        let review_summary_digest = sha256(&result.review_summary_json_bytes);
        let comparison_digest = sha256(
            &serde_jcs::to_vec(&serde_json::json!({
                "protocolVersion": RUNTIME_PROTOCOL_VERSION,
                "command": QUERY_REVIEW_COMMAND,
                "workspaceId": request.workspace_id,
                "inputDigest": ingress.input.digest,
                "optionsDigest": options_digest,
                "assignmentDigests": assignment_digests,
                "implementationDigest": IMPLEMENTATION_BUILD_DIGEST,
                "planDigest": EMBEDDED_PLAN_SHA256,
                "reviewSummaryDigest": review_summary_digest,
            }))
            .map_err(|error| format!("canonicalize review comparison digest: {error}"))?,
        );
        let review_artifact = shared_pipeline_artifact(
            Arc::clone(&result),
            "review-summary-json",
            "application/json",
            assignment_digests,
            review_summary_digest.clone(),
        );
        let manifest = ReviewRuntimeManifest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            preprocessor_version: chronicle_chrono_kernel_wasm::pipeline_v2::PREPROCESSOR_VERSION
                .into(),
            request_id: request.request_id,
            command: QUERY_REVIEW_COMMAND.into(),
            workspace_id: request.workspace_id,
            previous_workspace_root_digest: request.workspace_root_digest,
            input_digest: ingress.input.digest,
            options_digest,
            implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
            build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
            plan_digest: EMBEDDED_PLAN_SHA256.into(),
            profile_digest: EMBEDDED_PROFILE_SHA256.into(),
            profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
            product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
            dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
            dependency_cache_decision,
            counts: RuntimeCounts {
                original: result.original_row_count,
                processed: result.processed_row_count,
                app: result.app_row_count,
                screen: result.screen_row_count,
            },
            available_timezones: result.available_timezones.clone(),
            timezone: result.timezone.clone(),
            timezone_action: result.timezone_action.clone(),
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
            node_executions,
            step_executions,
            review_summary_digest,
            comparison_digest,
        };
        return Ok(RuntimeHandle {
            manifest_json: serde_json::to_string(&manifest)
                .map_err(|error| format!("serialize review runtime manifest: {error}"))?,
            artifacts: vec![review_artifact],
        });
    }
    let stable_key = stable_artifact_key(
        &request.workspace_id,
        &ingress.input.digest,
        &options_digest,
        &ingress.assignments,
        &result,
        dependency_cache_decision.mode,
    )?;
    let cached_bundle = (dependency_cache_decision.mode == DependencyCacheMode::CertifiedNarrow)
        .then(|| cached_stable_artifact_bundle(&request.workspace_id, &stable_key))
        .flatten();
    let (result_digests, mut binary_artifacts, source_coordinate_artifact) =
        if let Some(bundle) = cached_bundle {
            for artifact in bundle
                .binary_artifacts
                .iter()
                .chain(std::iter::once(&bundle.source_coordinate_artifact))
            {
                let RuntimeArtifactBytes::Shared(bytes) = &artifact.bytes else {
                    return Err("stable artifact cache contained mutable bytes".into());
                };
                if artifact.metadata.size != bytes.len() as u64 {
                    return Err("stable artifact cache metadata drift".into());
                }
            }
            (
                bundle.result_digests,
                bundle.binary_artifacts,
                bundle.source_coordinate_artifact,
            )
        } else {
            #[cfg(test)]
            STABLE_ARTIFACT_GENERATION_COUNT.with(|count| count.set(count.get() + 1));
            let result_digests = pipeline_result_digests(&result);
            let mut binary_artifacts = Vec::new();
            append_binary_exports(
                &mut binary_artifacts,
                &result,
                &request.options,
                &assignment_digests,
                &ingress.input.digest,
                &result_digests.output_digests,
            )?;
            let mut source_coordinate_artifacts = Vec::new();
            append_source_coordinate_index(
                &mut source_coordinate_artifacts,
                csv_bytes,
                &options_bytes,
                &ingress.assignments,
                &resolved_support,
            )?;
            if source_coordinate_artifacts.len() != 1 {
                return Err("source-coordinate generator emitted an invalid artifact count".into());
            }
            share_owned_artifacts(&mut binary_artifacts);
            share_owned_artifacts(&mut source_coordinate_artifacts);
            let source_coordinate_artifact = source_coordinate_artifacts
                .pop()
                .expect("source-coordinate artifact count checked");
            if dependency_cache_decision.mode == DependencyCacheMode::CertifiedNarrow {
                store_stable_artifact_bundle(
                    &request.workspace_id,
                    StableArtifactBundle {
                        key: stable_key,
                        result_digests: result_digests.clone(),
                        binary_artifacts: binary_artifacts.clone(),
                        source_coordinate_artifact: source_coordinate_artifact.clone(),
                    },
                );
            }
            (result_digests, binary_artifacts, source_coordinate_artifact)
        };
    // Binary indexes borrow the canonical output bytes above. Once they are
    // complete, transfer those Vec allocations into the runtime artifacts
    // instead of cloning every large CSV/JSON output.
    let mut artifacts = output_artifacts(
        Arc::clone(&result),
        &assignment_digests,
        &result_digests.output_digests,
    );
    artifacts.append(&mut binary_artifacts);
    artifacts.extend(node_artifacts);
    append_semantic_bundle_artifacts(&mut artifacts);
    append_normalized_support_artifacts(&mut artifacts, &ingress.assignments, &resolved_support)?;
    artifacts.push(runtime_artifact(
        "processing-options-json",
        "application/json",
        options_bytes.clone(),
        Vec::new(),
    ));
    let mut review_base_dependencies = assignment_digests.clone();
    review_base_dependencies.push(options_digest.clone());
    artifacts.push(runtime_artifact(
        "review-base",
        "application/vnd.chronicle.review-base+postcard+lz4",
        review_base.ok_or_else(|| "full execution omitted its review base".to_string())?,
        review_base_dependencies,
    ));
    artifacts.push(source_coordinate_artifact);
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
        &step_executions,
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
        "protocolVersion": "chronicle-semantic-index-source/v2",
        "inputDigest": ingress.input.digest,
        "executionTimestamp": request.options.datetime_of_preprocessing,
        "roleAssignments": ingress.assignments.values().collect::<Vec<_>>(),
        "qualificationTraces": materialization.qualification_traces,
        "requirementTraces": materialization.requirement_traces,
        "openObligations": materialization.obligations,
        "stateReasons": materialization.reasons,
        "nodeExecutions": node_executions,
        "stepExecutions": step_executions,
        "pipelineStepDigests": result.pipeline_step_digests,
        "pipelineStepCheckpoints": result.pipeline_step_checkpoints,
        "dependencyCacheDecision": dependency_cache_decision,
        "executionLedger": execution_ledger_value
    }))
    .map_err(|error| format!("canonicalize semantic index source: {error}"))?;
    artifacts.push(runtime_artifact(
        "semantic-index-source-json",
        "application/json",
        semantic_index_source,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    ));
    let correspondence_bytes = build_correspondence_index(CorrespondenceIndexInputs {
        plan: &plan,
        assignments: &ingress.assignments,
        materialization: &materialization,
        node_executions: &node_executions,
        options: &options_value,
        artifacts: &artifacts,
        checkpoints: &result.logical_stage_checkpoints,
        step_checkpoints: &result.pipeline_step_checkpoints,
    })?;
    let correspondence_dependencies = artifacts
        .iter()
        .filter(|artifact| {
            artifact.metadata.kind.starts_with("node-output:")
                || is_researcher_output_kind(&artifact.metadata.kind)
        })
        .map(|artifact| artifact.metadata.digest.clone())
        .chain(
            ingress
                .assignments
                .values()
                .map(|assignment| assignment.artifact.digest.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    artifacts.push(runtime_artifact(
        "correspondence-index-json",
        "application/json",
        correspondence_bytes,
        correspondence_dependencies,
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
                event_kind: match execution.status {
                    ExecutionStatus::Cached => "node-cached",
                    ExecutionStatus::Recomputed => "node-recomputed",
                    ExecutionStatus::Error => "node-error",
                    ExecutionStatus::Skipped => "node-skipped",
                    ExecutionStatus::Bypassed => "node-bypassed",
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
    let assignment_digests = ingress
        .assignments
        .iter()
        .map(|(role, assignment)| (role.as_str(), assignment.artifact.digest.as_str()))
        .collect::<BTreeMap<_, _>>();
    let computational_artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let execution_state_bytes = serde_jcs::to_vec(&ExecutionStateCommit {
        protocol_version: "chronicle-execution-state/v1",
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &ingress.input.digest,
        options_digest: &options_digest,
        assignment_digests: assignment_digests.clone(),
        computational_artifact_digests,
        journal_digest: &journal_digest,
    })
    .map_err(|error| format!("canonicalize execution state: {error}"))?;
    let execution_state_artifact = runtime_artifact(
        "execution-state-json",
        "application/json",
        execution_state_bytes,
        vec![
            ingress.input.digest.clone(),
            options_digest.clone(),
            journal_digest.clone(),
        ],
    );
    let execution_state_digest = execution_state_artifact.metadata.digest.clone();
    artifacts.push(execution_state_artifact);

    let revision = ingress.assignments.len() as u64
        + node_executions.len() as u64
        + step_executions.len() as u64;
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
    let step_statuses = step_executions
        .iter()
        .map(|execution| (execution.step_id.clone(), execution.status))
        .collect::<BTreeMap<_, _>>();
    let views = [
        (
            "stage-view-json",
            encode_view(&stage_view(
                chronicle_preprocessing_semantic_adapter::views::StageViewInput {
                    plan: &plan,
                    materialization: &materialization,
                    executions: &node_executions,
                    step_statuses: &step_statuses,
                    options: &options_value,
                    stage: None,
                    revision,
                    root_digest: &execution_state_digest,
                },
            )),
        ),
        (
            "artifact-view-json",
            encode_view(&artifact_view(
                artifact_refs,
                assignments.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
        (
            "obligation-view-json",
            encode_view(&obligation_view(
                materialization.obligations.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
        (
            "explanation-view-json",
            encode_view(&explanation_view(
                materialization.reasons.clone(),
                materialization.qualification_traces.clone(),
                materialization.requirement_traces.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
    ];
    let mut required_views = Vec::with_capacity(REQUIRED_VIEWS.len());
    for ((expected_kind, expected_view_id, expected_schema_id), (kind, view)) in
        REQUIRED_VIEWS.into_iter().zip(views)
    {
        if kind != expected_kind
            || view.get("view_id").and_then(Value::as_str) != Some(expected_view_id)
            || view.get("schema_id").and_then(Value::as_str) != Some(expected_schema_id)
            || view.get("root_digest").and_then(Value::as_str)
                != Some(execution_state_digest.as_str())
        {
            return Err(format!("typed view contract drift: {kind}"));
        }
        let bytes = serde_jcs::to_vec(&view)
            .map_err(|error| format!("canonicalize typed view {kind}: {error}"))?;
        let artifact = runtime_artifact(
            kind,
            "application/json",
            bytes,
            vec![execution_state_digest.clone()],
        );
        required_views.push(RequiredViewBinding {
            artifact_kind: expected_kind,
            view_id: expected_view_id,
            schema_id: expected_schema_id,
            artifact_digest: artifact.metadata.digest.clone(),
        });
        artifacts.push(artifact);
    }

    let closure_bytes = serde_jcs::to_vec(&ArtifactClosure {
        protocol_version: "chronicle-artifact-closure/v1",
        workspace_id: &request.workspace_id,
        input_digest: &ingress.input.digest,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        previous_workspace_root_digest: &request.workspace_root_digest,
        options_digest: &options_digest,
        assignment_digests: assignment_digests.clone(),
        execution_state_digest: &execution_state_digest,
        journal_digest: &journal_digest,
        artifacts: artifacts
            .iter()
            .map(|artifact| &artifact.metadata)
            .collect(),
    })
    .map_err(|error| format!("canonicalize artifact closure: {error}"))?;
    let closure_artifact = runtime_artifact(
        "artifact-closure-json",
        "application/json",
        closure_bytes,
        vec![execution_state_digest.clone(), journal_digest.clone()],
    );
    let artifact_closure_digest = closure_artifact.metadata.digest.clone();
    artifacts.push(closure_artifact);

    let artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let root_commit = RootCommit {
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        command: EXECUTE_WORKSPACE_COMMAND,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &ingress.input.digest,
        options_digest: &options_digest,
        assignment_digests,
        artifact_digests,
        execution_state_digest: &execution_state_digest,
        required_views: &required_views,
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
        vec![artifact_closure_digest.clone()],
    ));
    let result_published_outputs_digest = result_digests.published_outputs_digest;
    let result_provenance_digest = result_digests.provenance_digest;
    let manifest = RuntimeManifest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        preprocessor_version: chronicle_chrono_kernel_wasm::pipeline_v2::PREPROCESSOR_VERSION
            .into(),
        request_id: request.request_id,
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        implementation: "chronicle_preprocessing_runtime_wasm/0.1.0".into(),
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        scope: "selected-runtime-csv-artifacts".into(),
        plan_digest: EMBEDDED_PLAN_SHA256.into(),
        profile_digest: EMBEDDED_PROFILE_SHA256.into(),
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256.into(),
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
        dependency_cache_decision,
        previous_workspace_root_digest: request.workspace_root_digest,
        workspace_id: request.workspace_id,
        workspace_root_digest,
        input: ingress.input,
        role_assignments: assignments,
        qualification_traces: materialization.qualification_traces,
        requirement_traces: materialization.requirement_traces,
        open_obligations: materialization.obligations,
        state_reasons: materialization.reasons,
        node_executions,
        step_executions,
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
            available_timezones: result.available_timezones.clone(),
            timezone: result.timezone.clone(),
            timezone_action: result.timezone_action.clone(),
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            timezone_retained_source_rows_digest: result
                .timezone_retained_source_rows_digest
                .clone(),
            timezone_stage_digest: result.timezone_stage_digest.clone(),
            logical_stage_digests: result.logical_stage_digests.clone(),
            logical_stage_checkpoints: result.logical_stage_checkpoints.clone(),
            pipeline_step_digests: result.pipeline_step_digests.clone(),
            pipeline_step_checkpoints: result.pipeline_step_checkpoints.clone(),
            published_outputs_digest: result_published_outputs_digest,
            provenance_digest: result_provenance_digest,
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
    step_executions: &[RuntimeStepExecution],
    options: &Value,
    timestamp: &str,
) -> Result<Vec<u8>, String> {
    let status_by_node: BTreeMap<_, _> = executions
        .iter()
        .map(|execution| (execution.node_id.as_str(), execution.status))
        .collect();
    let execution_by_step = step_executions
        .iter()
        .map(|execution| (execution.step_id.as_str(), execution))
        .collect::<BTreeMap<_, _>>();
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
                    let execution = execution_by_step.get(step.step_id.as_str()).copied();
                    serde_json::json!({
                        "stepId": step.step_id,
                        "unit": step.unit_id,
                        "status": execution.map(|execution| execution.status).unwrap_or(ExecutionStatus::Error),
                        "inputKey": execution.map(|execution| execution.input_key.as_str()),
                        "outputDigest": execution.map(|execution| execution.output_digest.as_str()),
                        "reasonId": execution.map(|execution| execution.reason_id.as_str()),
                        "applicable": step.applicability.evaluate(options),
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
    verified_input_digest: &str,
    options_bytes: &[u8],
    options: &Value,
    support_files: &ResolvedSupportFiles,
) -> Result<IngressMaterialization, String> {
    let plan = embedded_plan();
    let mut assignments = BTreeMap::new();
    let input = assign(
        &mut assignments,
        "raw_chronicle_csv",
        "text/csv",
        csv_bytes,
        Some(verified_input_digest),
        BTreeMap::new(),
    )?;
    assign(
        &mut assignments,
        "processing_options",
        "application/json",
        options_bytes,
        None,
        BTreeMap::new(),
    )?;
    for (role, file) in &support_files.files {
        let mut qualifiers = BTreeMap::from([(
            "content_validation".into(),
            if file.content_validation_error.is_none() {
                "passed".into()
            } else {
                "failed".into()
            },
        )]);
        qualifiers.insert(
            "content_validation_rule".into(),
            format!("chronicle.support-schema.{role}.v1"),
        );
        if let Some(error) = &file.content_validation_error {
            qualifiers.insert("content_validation_error".into(), error.clone());
        }
        assign(
            &mut assignments,
            role,
            file.media_type,
            &file.original_bytes,
            None,
            qualifiers,
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

struct CorrespondenceEdgeSpec {
    source_kind: &'static str,
    source_id: String,
    relation: String,
    target_kind: &'static str,
    target_id: String,
    precision: &'static str,
    evidence_ids: Vec<String>,
}

fn correspondence_edge(
    source_kind: &'static str,
    source_id: impl Into<String>,
    relation: impl Into<String>,
    target_kind: &'static str,
    target_id: impl Into<String>,
    precision: &'static str,
) -> CorrespondenceEdgeSpec {
    CorrespondenceEdgeSpec {
        source_kind,
        source_id: source_id.into(),
        relation: relation.into(),
        target_kind,
        target_id: target_id.into(),
        precision,
        evidence_ids: Vec::new(),
    }
}

impl CorrespondenceEdgeSpec {
    fn with_evidence(mut self, evidence_ids: Vec<String>) -> Self {
        self.evidence_ids = evidence_ids;
        self
    }
}

fn append_correspondence_edge(edges: &mut Vec<CorrespondenceEdge>, spec: CorrespondenceEdgeSpec) {
    let mut evidence_ids = spec.evidence_ids;
    evidence_ids.sort();
    evidence_ids.dedup();
    let edge_id = stable_id(&[
        "correspondence-edge",
        spec.source_kind,
        &spec.source_id,
        &spec.relation,
        spec.target_kind,
        &spec.target_id,
        spec.precision,
        &evidence_ids.join(","),
    ]);
    edges.push(CorrespondenceEdge {
        edge_id,
        source_kind: spec.source_kind,
        source_id: spec.source_id,
        relation: spec.relation,
        target_kind: spec.target_kind,
        target_id: spec.target_id,
        precision: spec.precision,
        evidence_ids,
    });
}

fn is_researcher_output_kind(kind: &str) -> bool {
    matches!(
        kind,
        "app-csv"
            | "screen-csv"
            | "day-coverage-csv"
            | "compliance-csv"
            | "credited-app-csv"
            | "review-summary-json"
            | "visualization-data-json"
            | "app-parquet"
            | "screen-parquet"
            | "app-spss"
            | "screen-spss"
            | "row-lineage-arrow"
    ) || kind.starts_with("aggregate-")
}

fn is_canonical_cell_output_kind(kind: &str) -> bool {
    matches!(
        kind,
        "app-csv"
            | "screen-csv"
            | "day-coverage-csv"
            | "compliance-csv"
            | "credited-app-csv"
            | "review-summary-json"
            | "visualization-data-json"
    ) || kind.starts_with("aggregate-")
}

fn build_correspondence_index(inputs: CorrespondenceIndexInputs<'_>) -> Result<Vec<u8>, String> {
    let CorrespondenceIndexInputs {
        plan,
        assignments,
        materialization,
        node_executions,
        options,
        artifacts,
        checkpoints,
        step_checkpoints,
    } = inputs;
    let mut edges = Vec::new();

    for assignment in assignments.values() {
        let trace = materialization.qualification_traces.iter().find(|trace| {
            trace.candidate_id == assignment.assignment_id
                && trace.selected_role_id.as_deref() == Some(assignment.role_id.as_str())
        });
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "artifact",
                assignment.artifact.digest.clone(),
                "qualified-as",
                "role",
                assignment.role_id.clone(),
                "exact",
            )
            .with_evidence(
                trace
                    .map(|trace| vec![trace.trace_id.clone()])
                    .unwrap_or_default(),
            ),
        );
        if let Some(trace) = trace {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "qualification-trace",
                    trace.trace_id.clone(),
                    "selects-assignment",
                    "assignment",
                    assignment.assignment_id.clone(),
                    "exact",
                )
                .with_evidence(vec![trace.reason_id.clone()]),
            );
        }
    }

    if let Some(raw) = assignments.get("raw_chronicle_csv") {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "role",
                raw.role_id.clone(),
                "binds-input",
                "logical-node",
                "parse_events",
                "declared",
            )
            .with_evidence(vec![raw.assignment_id.clone()]),
        );
    }

    let processing_assignment = assignments.get("processing_options");
    let option_keys = plan
        .nodes
        .iter()
        .flat_map(|node| node.knobs.iter().map(|knob| knob.option_key.as_str()))
        .collect::<BTreeSet<_>>();
    for option_key in option_keys {
        let value = options.get(option_key).unwrap_or(&Value::Null);
        let value_digest = sha256(&serde_jcs::to_vec(value).map_err(|error| {
            format!("canonicalize correspondence option {option_key}: {error}")
        })?);
        let option_id = format!("option:{option_key}:{value_digest}");
        if let Some(assignment) = processing_assignment {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    assignment.artifact.digest.clone(),
                    "contains-resolved-option",
                    "configuration-value",
                    option_id.clone(),
                    "exact",
                )
                .with_evidence(vec![assignment.assignment_id.clone()]),
            );
        }
        for node in &plan.nodes {
            for knob in node
                .knobs
                .iter()
                .filter(|knob| knob.option_key == option_key)
            {
                append_correspondence_edge(
                    &mut edges,
                    correspondence_edge(
                        "configuration-value",
                        option_id.clone(),
                        format!("{}-node", knob.edge),
                        "logical-node",
                        node.node_id.clone(),
                        "declared",
                    )
                    .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
                );
            }
        }
    }

    for node in &plan.nodes {
        for role_id in &node.support_roles {
            let evidence = assignments
                .get(role_id)
                .map(|assignment| vec![assignment.assignment_id.clone()])
                .unwrap_or_default();
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "role",
                    role_id.clone(),
                    "binds-support",
                    "logical-node",
                    node.node_id.clone(),
                    "declared",
                )
                .with_evidence(evidence),
            );
        }
        for input_node in &node.input_nodes {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "logical-node",
                    input_node.clone(),
                    "feeds",
                    "logical-node",
                    node.node_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = checkpoints.get(&node.node_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "logical-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "logical-node",
                    node.node_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for step in &plan.steps {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "pipeline-step",
                step.step_id.clone(),
                "belongs-to",
                "logical-node",
                step.unit_id.clone(),
                "declared",
            )
            .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
        );
        for input_step in &step.input_steps {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "pipeline-step",
                    input_step.clone(),
                    "feeds",
                    "pipeline-step",
                    step.step_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = step_checkpoints.get(&step.step_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "pipeline-step-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "pipeline-step",
                    step.step_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for execution in node_executions {
        if let Some(output) = &execution.output {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "logical-node",
                    execution.node_id.clone(),
                    "materializes",
                    "artifact",
                    output.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![
                    execution.reason_id.clone(),
                    execution.input_key.clone(),
                ]),
            );
        }
    }
    for artifact in artifacts
        .iter()
        .filter(|artifact| is_researcher_output_kind(&artifact.metadata.kind))
    {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "logical-node",
                if artifact.metadata.kind == "credited-app-csv" {
                    "effective_usage"
                } else {
                    "outputs"
                },
                "publishes",
                "artifact",
                artifact.metadata.digest.clone(),
                "exact",
            )
            .with_evidence(artifact.metadata.derived_from.clone()),
        );
    }

    if let Some(cell_index) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "result-cell-correspondence-arrow")
    {
        for output in artifacts
            .iter()
            .filter(|artifact| is_canonical_cell_output_kind(&artifact.metadata.kind))
        {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    cell_index.metadata.digest.clone(),
                    "indexes-cells-of",
                    "artifact",
                    output.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![cell_index.metadata.digest.clone()]),
            );
        }
        if let Some(row_index) = artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == "row-lineage-arrow")
        {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    cell_index.metadata.digest.clone(),
                    "joins-row-correspondence",
                    "artifact",
                    row_index.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![cell_index.metadata.digest.clone()]),
            );
        }
    }

    if let Some(source_index) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "source-coordinate-index-arrow")
    {
        for assignment in assignments.values() {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    assignment.artifact.digest.clone(),
                    "has-source-coordinates-in",
                    "artifact",
                    source_index.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![assignment.assignment_id.clone()]),
            );
        }
    }

    edges.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
    let index = CorrespondenceIndex {
        protocol_version: "chronicle-correspondence-index/v3",
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        claim_boundary: "Bidirectional graph traversal over exact source-coordinate indexing, qualification, checkpoint, execution, publication, canonical result-cell identity, and cell-to-row join edges plus declared plan/role/knob dependencies. Source coordinate identity is exact but does not imply output contribution; raw-row contributors remain conservatively labeled, semantic cell dependencies are declared-transitive, and exact raw-field/support-record-to-output correspondence is not yet claimed.",
        source_coordinate_artifact_kind: "source-coordinate-index-arrow",
        row_correspondence_artifact_kind: "row-lineage-arrow",
        cell_correspondence_artifact_kind: "result-cell-correspondence-arrow",
        edges,
    };
    serde_jcs::to_vec(&index).map_err(|error| format!("canonicalize correspondence index: {error}"))
}

fn assign(
    assignments: &mut BTreeMap<String, RoleAssignment>,
    role_id: &str,
    media_type: &str,
    bytes: &[u8],
    verified_digest: Option<&str>,
    qualifiers: BTreeMap<String, String>,
) -> Result<ArtifactRef, String> {
    let digest = verified_digest
        .map(str::to_owned)
        .unwrap_or_else(|| sha256(bytes));
    validate_digest(&digest)
        .map_err(|message| format!("artifact digest for role {role_id} {message}"))?;
    let artifact = ArtifactRef {
        artifact_id: semantic_artifact_id(role_id, &digest),
        digest,
        media_type: media_type.to_string(),
        size: bytes.len() as u64,
        derived_from: Vec::new(),
        qualifiers: qualifiers.clone(),
    };
    let revision = assignments.len() as u64 + 1;
    assignments.insert(
        role_id.into(),
        RoleAssignment {
            assignment_id: stable_id(&["assignment", role_id, &artifact.digest]),
            role_id: role_id.into(),
            artifact: artifact.clone(),
            qualifiers,
            revision,
        },
    );
    Ok(artifact)
}

fn output_artifacts(
    result: Arc<PipelineV2Result>,
    dependencies: &[String],
    output_digests: &BTreeMap<String, String>,
) -> Vec<RuntimeArtifact> {
    let digest_for = |kind: &str| {
        output_digests
            .get(kind)
            .unwrap_or_else(|| panic!("missing precomputed output digest for {kind}"))
            .clone()
    };
    let mut artifacts = Vec::new();
    if !result.app_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            "app-csv",
            result.app_row_count,
            dependencies,
            digest_for("app-csv"),
        ));
    }
    if !result.screen_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            "screen-csv",
            result.screen_row_count,
            dependencies,
            digest_for("screen-csv"),
        ));
    }
    if !result.day_coverage_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            "day-coverage-csv",
            result.day_coverage_row_count,
            dependencies,
            digest_for("day-coverage-csv"),
        ));
    }
    if !result.compliance_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            "compliance-csv",
            result.compliance_row_count,
            dependencies,
            digest_for("compliance-csv"),
        ));
    }
    if !result.credited_app_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            "credited-app-csv",
            result.credited_app_row_count,
            dependencies,
            digest_for("credited-app-csv"),
        ));
    }
    for aggregate in result.aggregate_csv_outputs.iter() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            Arc::clone(&result),
            &aggregate.kind,
            aggregate.row_count,
            dependencies,
            digest_for(&aggregate.kind),
        ));
    }
    artifacts.push(shared_pipeline_artifact(
        Arc::clone(&result),
        "review-summary-json",
        "application/json",
        dependencies.to_vec(),
        digest_for("review-summary-json"),
    ));
    artifacts.push(shared_pipeline_artifact(
        result,
        "visualization-data-json",
        "application/json",
        dependencies.to_vec(),
        digest_for("visualization-data-json"),
    ));
    artifacts
}

fn pipeline_output_bytes<'a>(result: &'a PipelineV2Result, kind: &str) -> Option<&'a [u8]> {
    match kind {
        "app-csv" => Some(&result.app_csv_bytes),
        "screen-csv" => Some(&result.screen_csv_bytes),
        "day-coverage-csv" => Some(&result.day_coverage_csv_bytes),
        "compliance-csv" => Some(&result.compliance_csv_bytes),
        "credited-app-csv" => Some(&result.credited_app_csv_bytes),
        "review-summary-json" => Some(&result.review_summary_json_bytes),
        "visualization-data-json" => Some(&result.visualization_data_json_bytes),
        other => result
            .aggregate_csv_outputs
            .iter()
            .find(|aggregate| aggregate.kind == other)
            .map(|aggregate| aggregate.bytes.as_slice()),
    }
}

fn shared_pipeline_artifact(
    result: Arc<PipelineV2Result>,
    kind: &str,
    media_type: &str,
    derived_from: Vec<String>,
    digest: String,
) -> RuntimeArtifact {
    let bytes = pipeline_output_bytes(&result, kind)
        .unwrap_or_else(|| panic!("missing shared pipeline output for {kind}"));
    debug_assert_eq!(digest, sha256(bytes), "precomputed output digest drift");
    let size = bytes.len() as u64;
    RuntimeArtifact {
        metadata: RuntimeArtifactMetadata {
            artifact_id: semantic_artifact_id(kind, &digest),
            kind: kind.into(),
            media_type: media_type.into(),
            digest,
            size,
            derived_from,
            row_count: None,
            preview_rows: None,
        },
        bytes: RuntimeArtifactBytes::PipelineOutput {
            result,
            kind: kind.to_string(),
        },
    }
}

fn shared_pipeline_aggregate_artifact(
    result: Arc<PipelineV2Result>,
    kind: &str,
    row_count: u32,
    dependencies: &[String],
    digest: String,
) -> RuntimeArtifact {
    let preview_rows = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(
            pipeline_output_bytes(&result, kind)
                .unwrap_or_else(|| panic!("missing shared aggregate output for {kind}")),
        )
        .records()
        .take(51)
        .map(|record| record.map(|record| record.iter().map(str::to_string).collect::<Vec<_>>()))
        .collect::<Result<Vec<_>, _>>()
        .expect("Rust-generated CSV artifacts must parse for preview");
    let mut artifact =
        shared_pipeline_artifact(result, kind, "text/csv", dependencies.to_vec(), digest);
    artifact.metadata.row_count = Some(row_count);
    artifact.metadata.preview_rows = Some(preview_rows);
    artifact
}

fn canonical_cell_outputs(result: &PipelineV2Result) -> Vec<binary_exports::CanonicalOutput<'_>> {
    let mut outputs = Vec::new();
    let candidates = [
        (
            "app-csv",
            "text/csv",
            result.app_csv_bytes.as_slice(),
            "outputs",
        ),
        (
            "screen-csv",
            "text/csv",
            result.screen_csv_bytes.as_slice(),
            "outputs",
        ),
        (
            "day-coverage-csv",
            "text/csv",
            result.day_coverage_csv_bytes.as_slice(),
            "day_coverage",
        ),
        (
            "compliance-csv",
            "text/csv",
            result.compliance_csv_bytes.as_slice(),
            "score_compliance",
        ),
        (
            "credited-app-csv",
            "text/csv",
            result.credited_app_csv_bytes.as_slice(),
            "effective_usage",
        ),
        (
            "review-summary-json",
            "application/json",
            result.review_summary_json_bytes.as_slice(),
            "outputs",
        ),
        (
            "visualization-data-json",
            "application/json",
            result.visualization_data_json_bytes.as_slice(),
            "outputs",
        ),
    ];
    for (kind, media_type, bytes, terminal_logical_node) in candidates {
        if !bytes.is_empty() {
            outputs.push(binary_exports::CanonicalOutput {
                kind,
                media_type,
                bytes,
                terminal_logical_node,
            });
        }
    }
    outputs.extend(result.aggregate_csv_outputs.iter().map(|aggregate| {
        binary_exports::CanonicalOutput {
            kind: aggregate.kind.as_str(),
            media_type: "text/csv",
            bytes: &aggregate.bytes,
            terminal_logical_node: "outputs",
        }
    }));
    outputs
}

fn append_binary_exports(
    artifacts: &mut Vec<RuntimeArtifact>,
    result: &PipelineV2Result,
    options: &PipelineV2OptionsJson,
    dependencies: &[String],
    input_digest: &str,
    output_digests: &BTreeMap<String, String>,
) -> Result<(), String> {
    {
        let mut append = |kind: &str, media_type: &str, bytes: Vec<u8>, row_count: u32| {
            let mut artifact = runtime_artifact(kind, media_type, bytes, dependencies.to_vec());
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
        let lineage_record_count = result
            .row_lineage
            .iter()
            .try_fold(0_u32, |count, lineage| {
                count
                    .checked_add(lineage.source_data_row_ranges.len() as u32)?
                    .checked_add(lineage.searches.len() as u32)
            })
            .ok_or_else(|| "row-lineage record count exceeds u32 metadata capacity".to_string())?;
        append(
            "row-lineage-arrow",
            "application/vnd.apache.arrow.file",
            binary_exports::row_lineage_arrow(&result.row_lineage, input_digest)?,
            lineage_record_count,
        );
    }

    let canonical_outputs = canonical_cell_outputs(result);
    let canonical_kinds = canonical_outputs
        .iter()
        .map(|output| output.kind)
        .collect::<BTreeSet<_>>();
    let cell_dependencies = canonical_kinds
        .iter()
        .map(|kind| {
            output_digests
                .get(*kind)
                .cloned()
                .ok_or_else(|| format!("missing canonical output digest for {kind}"))
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .chain(
            artifacts
                .iter()
                .filter(|artifact| artifact.metadata.kind == "row-lineage-arrow")
                .map(|artifact| artifact.metadata.digest.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let (cell_bytes, cell_count) =
        binary_exports::result_cell_correspondence_arrow(&canonical_outputs, &result.row_lineage)?;
    let mut cell_artifact = runtime_artifact(
        "result-cell-correspondence-arrow",
        "application/vnd.apache.arrow.file",
        cell_bytes,
        cell_dependencies,
    );
    cell_artifact.metadata.row_count = Some(cell_count);
    artifacts.push(cell_artifact);
    Ok(())
}

fn append_source_coordinate_index(
    artifacts: &mut Vec<RuntimeArtifact>,
    raw_csv: &[u8],
    options_json: &[u8],
    assignments: &BTreeMap<String, RoleAssignment>,
    support_files: &ResolvedSupportFiles,
) -> Result<(), String> {
    let assignment = |role: &str| {
        assignments
            .get(role)
            .ok_or_else(|| format!("missing source-coordinate assignment for role {role}"))
    };
    let raw_assignment = assignment("raw_chronicle_csv")?;
    let options_assignment = assignment("processing_options")?;
    let mut sources = vec![
        binary_exports::CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest: &raw_assignment.artifact.digest,
            source_media_type: &raw_assignment.artifact.media_type,
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: raw_csv,
        },
        binary_exports::CanonicalSource {
            role_id: "processing_options",
            source_artifact_digest: &options_assignment.artifact.digest,
            source_media_type: &options_assignment.artifact.media_type,
            coordinate_media_type: "application/json",
            normalization: "canonical-json",
            bytes: options_json,
        },
    ];
    for (role, file) in &support_files.files {
        let source_assignment = assignment(role)?;
        sources.push(binary_exports::CanonicalSource {
            role_id: role,
            source_artifact_digest: &source_assignment.artifact.digest,
            source_media_type: &source_assignment.artifact.media_type,
            coordinate_media_type: "text/csv",
            normalization: if file.normalized_from_xlsx {
                "xlsx-first-sheet-to-csv"
            } else {
                "identity-csv"
            },
            bytes: &file.pipeline_csv,
        });
    }
    let (bytes, row_count) = binary_exports::source_coordinate_index_arrow(&sources)?;
    let dependencies = assignments
        .values()
        .map(|assignment| assignment.artifact.digest.clone())
        .collect();
    let mut artifact = runtime_artifact(
        "source-coordinate-index-arrow",
        "application/vnd.apache.arrow.file",
        bytes,
        dependencies,
    );
    artifact.metadata.row_count = Some(row_count);
    artifacts.push(artifact);
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
        (
            "dependency-certificate-json",
            embedded_dependency_certificate_bytes(),
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        ),
    ] {
        let artifact = runtime_artifact(kind, "application/json", bytes.to_vec(), Vec::new());
        assert_eq!(artifact.metadata.digest, expected_digest);
        artifacts.push(artifact);
    }
}

fn runtime_artifact(
    kind: &str,
    media_type: &str,
    bytes: Vec<u8>,
    derived_from: Vec<String>,
) -> RuntimeArtifact {
    let digest = sha256(&bytes);
    runtime_artifact_with_digest(kind, media_type, bytes, derived_from, digest)
}

fn runtime_artifact_with_digest(
    kind: &str,
    media_type: &str,
    bytes: Vec<u8>,
    derived_from: Vec<String>,
    digest: String,
) -> RuntimeArtifact {
    debug_assert_eq!(digest, sha256(&bytes), "precomputed artifact digest drift");
    RuntimeArtifact {
        metadata: RuntimeArtifactMetadata {
            artifact_id: semantic_artifact_id(kind, &digest),
            kind: kind.into(),
            media_type: media_type.into(),
            digest,
            size: bytes.len() as u64,
            derived_from,
            row_count: None,
            preview_rows: None,
        },
        bytes: RuntimeArtifactBytes::Owned(bytes),
    }
}

fn semantic_artifact_id(kind_or_role: &str, digest: &str) -> String {
    format!("urn:chronicle:artifact:{kind_or_role}:{}", &digest[7..])
}

fn share_owned_artifacts(artifacts: &mut [RuntimeArtifact]) {
    for artifact in artifacts {
        let payload =
            std::mem::replace(&mut artifact.bytes, RuntimeArtifactBytes::Owned(Vec::new()));
        artifact.bytes = match payload {
            RuntimeArtifactBytes::Owned(bytes) => RuntimeArtifactBytes::Shared(Arc::from(bytes)),
            other => other,
        };
    }
}

#[cfg(test)]
fn runtime_aggregate_artifact(
    kind: &str,
    bytes: Vec<u8>,
    row_count: u32,
    dependencies: &[String],
) -> RuntimeArtifact {
    let digest = sha256(&bytes);
    runtime_aggregate_artifact_with_digest(kind, bytes, row_count, dependencies, digest)
}

#[cfg(test)]
fn runtime_aggregate_artifact_with_digest(
    kind: &str,
    bytes: Vec<u8>,
    row_count: u32,
    dependencies: &[String],
    digest: String,
) -> RuntimeArtifact {
    let mut artifact =
        runtime_artifact_with_digest(kind, "text/csv", bytes, dependencies.to_vec(), digest);
    artifact.metadata.row_count = Some(row_count);
    artifact.metadata.preview_rows = Some(
        csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(match &artifact.bytes {
                RuntimeArtifactBytes::Owned(bytes) => bytes.as_slice(),
                RuntimeArtifactBytes::Shared(bytes) => bytes.as_ref(),
                RuntimeArtifactBytes::PipelineOutput { .. } => {
                    unreachable!("owned aggregate constructor produced shared bytes")
                }
            })
            .records()
            .take(51)
            .map(|record| {
                record.map(|record| record.iter().map(str::to_string).collect::<Vec<_>>())
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("Rust-generated CSV artifacts must parse for preview"),
    );
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

    #[test]
    fn raw_file_inspection_uses_runtime_semantics_without_throwing() {
        let csv = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone,timezone\n\
Study,P01,Chat,Unknown importance: 1,com.example,2026-03-07 12:00:00,America/Chicago,America/Chicago\n\
Study,P01,Chat,Vendor Event,com.example,2026-03-07 09:00:00,Not/AZone,Not/AZone\n\
Study,P02,Chat,Activity Paused,com.example,,America/Chicago,America/Chicago\n";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "raw.txt", csv.len() as f64)).unwrap();
        assert_eq!(inspection["rowCount"], 3);
        assert_eq!(inspection["participantCount"], 2);
        assert_eq!(inspection["outOfOrderTimestampCount"], 1);
        assert_eq!(inspection["firstOutOfOrderRow"], 2);
        assert_eq!(inspection["missingTimestampCount"], 1);
        assert_eq!(inspection["invalidTimestampCount"], 0);
        assert_eq!(
            inspection["unrecognizedInteractionTypes"][0],
            "Vendor Event"
        );
        assert_eq!(inspection["columns"][7], "timezone_1");
        let warnings = inspection["warnings"].as_array().unwrap();
        assert!(warnings
            .iter()
            .any(|warning| warning == "File extension is not .csv."));
        assert!(warnings
            .iter()
            .any(|warning| warning == "Duplicate column headers found."));
        assert!(warnings
            .iter()
            .any(|warning| warning.as_str().unwrap().contains("Not/AZone")));
    }

    #[test]
    fn raw_file_inspection_handles_empty_and_malformed_bytes() {
        let empty: Value =
            serde_json::from_str(&inspect_raw_file_v1(b"", "empty.csv", 0.0)).unwrap();
        assert_eq!(empty["rowCount"], 0);
        assert_eq!(empty["hasRequiredColumns"], false);
        assert!(empty["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));

        let malformed = inspect_raw_file_v1(b"event_timestamp,timezone\n\xff,UTC", "bad.csv", 31.0);
        assert!(serde_json::from_str::<Value>(&malformed).is_ok());
    }

    #[test]
    fn physical_rows_and_duplicate_headers_cover_every_separator_and_suffix_boundary() {
        assert_eq!(physical_data_row_count(b""), 0);
        assert_eq!(physical_data_row_count(b"header\nrow-1\nrow-2\n"), 2);
        assert_eq!(physical_data_row_count(b"header\rrow-1\rrow-2\r"), 2);
        assert_eq!(physical_data_row_count(b"header\r\nrow-1\r\nrow-2\r\n"), 2);

        let headers = csv::StringRecord::from(vec![
            "\u{feff}name",
            "name",
            "name",
            "\u{feff}kept-on-nonfirst",
        ]);
        let (columns, duplicate) = duplicate_safe_headers(&headers);
        assert!(duplicate);
        assert_eq!(
            columns,
            ["name", "name_1", "name_2", "\u{feff}kept-on-nonfirst"]
        );
        let (unique_columns, unique_duplicate) =
            duplicate_safe_headers(&csv::StringRecord::from(vec!["a", "b"]));
        assert_eq!(unique_columns, ["a", "b"]);
        assert!(!unique_duplicate);
    }

    #[test]
    fn raw_inspection_counts_each_advisory_condition_exactly() {
        let csv = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\r\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\r\n\
,,,,,,\r\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:00:00,America/Chicago\r\n\
S,P2,Chat,Unknown Event,pkg,not-a-time,\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07 11:00:00,\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07T10:00:00Z,UTC\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07T09:00:00+00:00,UTC\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07 10:00:00,UTC";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "exact.csv", csv.len() as f64)).unwrap();
        assert_eq!(inspection["rowCount"], 8);
        assert_eq!(inspection["participantCount"], 2);
        assert_eq!(inspection["missingTimezoneCount"], 2);
        assert_eq!(inspection["missingTimestampCount"], 0);
        assert_eq!(inspection["invalidTimestampCount"], 1);
        assert_eq!(inspection["duplicateTimestampCount"], 1);
        assert_eq!(inspection["outOfOrderTimestampCount"], 1);
        assert_eq!(inspection["firstOutOfOrderRow"], 7);
        assert_eq!(
            inspection["timezones"],
            serde_json::json!(["America/Chicago", "UTC"])
        );
        assert_eq!(
            inspection["unrecognizedInteractionTypes"],
            serde_json::json!(["Unknown Event"])
        );
        let warnings = inspection["warnings"]
            .as_array()
            .expect("inspection warnings");
        assert!(warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.starts_with("This file contains 2 participants."))));
        assert!(warnings
            .iter()
            .any(|warning| warning == "2 rows are missing timezone values."));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows have invalid event_timestamp values."));
        assert!(!warnings
            .iter()
            .any(|warning| warning == "No timezone values found."));
    }

    #[test]
    fn empty_missing_and_present_columns_produce_distinct_warnings() {
        let zero_size: Value =
            serde_json::from_str(&inspect_raw_file_v1(b"foo\nvalue", "x.csv", 0.0)).unwrap();
        assert!(zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));
        assert!(zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning
                .as_str()
                .is_some_and(|text| text.starts_with("Missing required columns:"))));
        assert!(!zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "No timezone values found."));

        let whitespace: Value =
            serde_json::from_str(&inspect_raw_file_v1(b" \n ", "x.csv", 3.0)).unwrap();
        assert!(whitespace["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));

        let present_but_empty = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,P1,App,Activity Resumed,pkg,,";
        let present: Value = serde_json::from_str(&inspect_raw_file_v1(
            present_but_empty,
            "x.csv",
            present_but_empty.len() as f64,
        ))
        .unwrap();
        let warnings = present["warnings"].as_array().unwrap();
        assert!(warnings
            .iter()
            .any(|warning| warning == "No timezone values found."));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows are missing timezone values."));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows are missing event_timestamp values."));
        assert!(present["hasRequiredColumns"].as_bool().unwrap());

        let clean = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,P1,App,Activity Resumed,pkg,2026-03-07 12:00:00,UTC";
        let clean: Value =
            serde_json::from_str(&inspect_raw_file_v1(clean, "clean.csv", clean.len() as f64))
                .unwrap();
        assert_eq!(clean["participantCount"], 1);
        assert_eq!(clean["missingTimezoneCount"], 0);
        assert_eq!(clean["missingTimestampCount"], 0);
        assert_eq!(clean["invalidTimestampCount"], 0);
        let clean_warnings = clean["warnings"].as_array().unwrap();
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("participants"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing timezone"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing event_timestamp"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("invalid event_timestamp"))));
    }

    #[test]
    fn exported_build_and_step_contract_identities_are_not_placeholders() {
        assert_eq!(build_environment_digest(), BUILD_ENVIRONMENT_DIGEST);
        assert!(build_environment_digest().starts_with("sha256:"));
        assert_eq!(build_environment_digest().len(), 71);
        let contract: Value = serde_json::from_str(&pipeline_step_contract_json()).unwrap();
        assert_eq!(
            contract["protocolVersion"],
            "chronicle-preprocessing-step-contract/v3"
        );
        assert_eq!(contract["steps"].as_array().unwrap().len(), 55);
    }

    fn direct_pipeline_result(
        csv: &[u8],
        enable_aggregates: bool,
    ) -> (RuntimeRequest, PipelineV2Result, Value, Value) {
        let mut request_value: Value = serde_json::from_str(&request(csv)).unwrap();
        request_value["options"]["enable_aggregates"] = Value::Bool(enable_aggregates);
        let request: RuntimeRequest = serde_json::from_value(request_value).unwrap();
        let semantic_options = semantic_options_value(&request.options).unwrap();
        let exact_options = serde_json::to_value(&request.options).unwrap();
        let options = request.options.clone().into_pipeline_options();
        let result = run_pipeline_v2_with_supports(
            csv,
            &options,
            PipelineV2SupportFiles {
                filter_csv: &[],
                apps_forcing_csv: &[],
                background_apps_csv: &[],
                codebook_csv: &[],
                study_dates_csv: &[],
                device_sharing_csv: &[],
                survey_attribution_csv: &[],
                enrolled_devices_csv: &[],
            },
        )
        .unwrap();
        (request, result, semantic_options, exact_options)
    }

    #[test]
    fn published_output_count_is_exact_and_binding_gaps_fail_closed() {
        let csv = csv();
        let (_request, result, semantic_options, exact_options) =
            direct_pipeline_result(&csv, true);
        assert!(!result.aggregate_csv_outputs.is_empty());

        let mut expected = Sha256::new();
        let fixed_outputs = [
            (
                "app-csv",
                result.app_csv_bytes.as_slice(),
                result.app_row_count,
            ),
            (
                "screen-csv",
                result.screen_csv_bytes.as_slice(),
                result.screen_row_count,
            ),
            (
                "day-coverage-csv",
                result.day_coverage_csv_bytes.as_slice(),
                result.day_coverage_row_count,
            ),
            (
                "compliance-csv",
                result.compliance_csv_bytes.as_slice(),
                result.compliance_row_count,
            ),
            (
                "credited-app-csv",
                result.credited_app_csv_bytes.as_slice(),
                result.credited_app_row_count,
            ),
            (
                "review-summary-json",
                result.review_summary_json_bytes.as_slice(),
                0,
            ),
            (
                "visualization-data-json",
                result.visualization_data_json_bytes.as_slice(),
                0,
            ),
        ];
        expected.update(b"chronicle-published-outputs-digest/v2");
        expected.update(
            ((fixed_outputs.len() + result.aggregate_csv_outputs.len()) as u64).to_le_bytes(),
        );
        for (kind, bytes, row_count) in
            fixed_outputs
                .into_iter()
                .chain(result.aggregate_csv_outputs.iter().map(|output| {
                    (
                        output.kind.as_str(),
                        output.bytes.as_slice(),
                        output.row_count,
                    )
                }))
        {
            let digest = sha256(bytes);
            for field in [kind.as_bytes(), digest.as_bytes()] {
                expected.update((field.len() as u64).to_le_bytes());
                expected.update(field);
            }
            expected.update((bytes.len() as u64).to_le_bytes());
            expected.update(row_count.to_le_bytes());
        }
        assert_eq!(
            pipeline_result_digests(&result).published_outputs_digest,
            format!("sha256:{}", hex::encode(expected.finalize()))
        );

        let plan = embedded_plan();
        let mut cache = BTreeMap::new();
        let cold = build_runtime_step_executions(
            &plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeStepExecutionState {
                executed_steps: &PIPELINE_STEPS
                    .iter()
                    .map(|step| step.id.to_string())
                    .collect::<Vec<_>>(),
                materialize_full_outputs: true,
                previous_observations: &mut cache,
            },
        )
        .unwrap();
        assert!(cold
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Bypassed));
        let applicable = cold
            .iter()
            .find(|execution| execution.status != ExecutionStatus::Bypassed)
            .unwrap()
            .step_id
            .clone();
        cache.get_mut(&applicable).unwrap().output_digest = format!("sha256:{}", "f".repeat(64));
        let error = build_runtime_step_executions(
            &plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeStepExecutionState {
                executed_steps: &PIPELINE_STEPS
                    .iter()
                    .map(|step| step.id.to_string())
                    .collect::<Vec<_>>(),
                materialize_full_outputs: true,
                previous_observations: &mut cache,
            },
        )
        .unwrap_err();
        assert!(error.contains("tracked step output changed without a changed bound input"));
        assert!(error.contains(&applicable));
    }

    #[test]
    fn every_dependency_receipt_field_is_required_for_narrow_reuse() {
        let certificate = embedded_dependency_certificate();
        assert!(dependency_evidence_current(&certificate));
        let replacements: [fn(&mut chronicle_preprocessing_semantic_adapter::DependencyCertificate);
            7] = [
            |certificate| {
                certificate.evidence.implementation_receipt.implementation = "wrong".into()
            },
            |certificate| {
                certificate
                    .evidence
                    .implementation_receipt
                    .implementation_digest = "wrong".into()
            },
            |certificate| certificate.evidence.implementation_receipt.plan_digest = "wrong".into(),
            |certificate| {
                certificate.evidence.implementation_receipt.profile_digest = "wrong".into()
            },
            |certificate| {
                certificate
                    .evidence
                    .implementation_receipt
                    .profile_lock_digest = "wrong".into()
            },
            |certificate| {
                certificate
                    .evidence
                    .implementation_receipt
                    .runtime_authority_digest = "wrong".into()
            },
            |certificate| {
                certificate
                    .evidence
                    .implementation_receipt
                    .product_contract_digest = "wrong".into()
            },
        ];
        for replace in replacements {
            let mut changed = certificate.clone();
            replace(&mut changed);
            assert!(!dependency_evidence_current(&changed));
        }
    }

    fn reset_tracked_execution_count() {
        TRACKED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(0));
        STABLE_ARTIFACT_GENERATION_COUNT.with(|count| count.set(0));
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
    }

    fn tracked_execution_count() -> usize {
        TRACKED_PHYSICAL_EXECUTION_COUNT.with(std::cell::Cell::get)
    }

    fn stable_artifact_generation_count() -> usize {
        STABLE_ARTIFACT_GENERATION_COUNT.with(std::cell::Cell::get)
    }

    fn request(csv: &[u8]) -> String {
        serde_json::json!({
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "requestId": "req-1",
            "command": EXECUTE_WORKSPACE_COMMAND,
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
    fn review_query_returns_only_review_bytes_and_matches_full_execution() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut review_request = request_for_workspace(&csv, 'b');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let mut review = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let review_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review.manifest_json).unwrap();
        assert_eq!(review_manifest.command, QUERY_REVIEW_COMMAND);
        assert_eq!(review_manifest.step_executions.len(), 55);
        assert_eq!(review.artifact_count(), 1);
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&review.artifact_metadata_json(0).unwrap()).unwrap();
        assert_eq!(metadata.kind, "review-summary-json");
        let review_bytes = review.take_artifact_bytes(0).unwrap();
        assert_eq!(sha256(&review_bytes), review_manifest.review_summary_digest);
        assert_eq!(stable_artifact_generation_count(), 0);

        let full_request = request_for_workspace(&csv, 'f');
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let full_review_bytes = (0..full.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "review-summary-json")
                    .then(|| full.take_artifact_bytes(index).unwrap())
            })
            .expect("full execution review summary");
        assert_eq!(review_bytes, full_review_bytes);
        assert_eq!(stable_artifact_generation_count(), 1);
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

    /// Existing mixed-timezone synthetic fixture shared by the runtime's
    /// transition and selected-filter tests so they cannot drift apart.
    fn mixed_timezone_csv() -> Vec<u8> {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec()
    }

    fn representative_600_event_csv() -> Vec<u8> {
        let mut csv = String::from(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        );
        for index in 0..600 {
            let hour = index / 60;
            let minute = index % 60;
            let interaction = if index % 2 == 0 {
                "Activity Resumed"
            } else {
                "Activity Paused"
            };
            csv.push_str(&format!(
                "Study,P01,Target Child,Chat,{interaction},com.example.chat,2026-03-07 {hour:02}:{minute:02}:00,America/Chicago\n"
            ));
        }
        csv.into_bytes()
    }

    #[test]
    fn representative_result_cell_index_has_a_bounded_storage_ratio() {
        let csv = representative_600_event_csv();
        let handle =
            execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let cell_index = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap();
        let canonical_bytes = manifest
            .artifacts
            .iter()
            .filter(|artifact| is_canonical_cell_output_kind(&artifact.kind))
            .map(|artifact| artifact.size)
            .sum::<u64>();
        assert!(cell_index.row_count.unwrap() > manifest.counts.app);
        assert!(
            cell_index.size <= canonical_bytes.saturating_mul(3) + 65_536,
            "cell index {} bytes exceeded bounded ratio for {} canonical bytes",
            cell_index.size,
            canonical_bytes,
        );
        eprintln!(
            "representative-result-cell-index input_rows={} app_rows={} cell_rows={} canonical_bytes={} index_bytes={} ratio={:.3}",
            manifest.counts.original,
            manifest.counts.app,
            cell_index.row_count.unwrap(),
            canonical_bytes,
            cell_index.size,
            cell_index.size as f64 / canonical_bytes as f64,
        );
    }

    #[test]
    fn one_call_runtime_returns_verified_artifacts_materialization_and_root() {
        let csv = csv();
        let mut handle =
            execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.request_id, "req-1");
        assert_eq!(manifest.implementation_digest, IMPLEMENTATION_BUILD_DIGEST);
        assert_eq!(implementation_build_digest(), IMPLEMENTATION_BUILD_DIGEST);
        assert!(IMPLEMENTATION_BUILD_DIGEST.starts_with("sha256:"));
        assert_eq!(IMPLEMENTATION_BUILD_DIGEST.len(), 71);
        assert_eq!(manifest.plan_digest, EMBEDDED_PLAN_SHA256);
        assert_eq!(
            manifest.dependency_certificate_digest,
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256
        );
        assert_eq!(
            manifest.dependency_cache_decision.mode,
            chronicle_preprocessing_semantic_adapter::DependencyCacheMode::CertifiedNarrow
        );
        assert!(manifest
            .dependency_cache_decision
            .reasons
            .contains(&"dependency_surface_structurally_certified".into()));
        assert_eq!(
            manifest.product_contract_digest,
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(manifest.build_environment_digest, BUILD_ENVIRONMENT_DIGEST);
        assert_eq!(manifest.step_executions.len(), 55);
        assert_eq!(
            manifest
                .step_executions
                .iter()
                .map(|execution| execution.step_id.as_str())
                .collect::<BTreeSet<_>>(),
            PIPELINE_STEPS
                .iter()
                .map(|step| step.id)
                .collect::<BTreeSet<_>>()
        );
        assert!(manifest.step_executions.iter().all(|execution| {
            manifest
                .processing_summary
                .pipeline_step_digests
                .get(&execution.step_id)
                == Some(&execution.output_digest)
        }));
        assert_eq!(manifest.counts.original, 2);
        assert_eq!(manifest.counts.processed, 2);
        assert_eq!(manifest.counts.app, 1);
        assert!(manifest.workspace_root_digest.starts_with("sha256:"));
        assert_eq!(manifest.role_assignments.len(), 2);
        assert_eq!(manifest.qualification_traces.len(), 2);
        assert!(manifest
            .qualification_traces
            .iter()
            .all(|trace| trace.decision
                == chronicle_preprocessing_semantic_adapter::QualificationDecision::Accepted));
        assert_eq!(
            manifest.requirement_traces.len(),
            embedded_plan().root_roles.len()
        );
        assert_eq!(
            manifest
                .role_assignments
                .iter()
                .map(|assignment| assignment.revision)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(manifest.node_executions.len(), 15);
        assert!(manifest
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "dependency-certificate-json"
                && artifact.digest == EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256));
        assert!(is_researcher_output_kind("app-csv"));
        assert!(is_researcher_output_kind("aggregate-daily-summary-csv"));
        assert!(!is_researcher_output_kind("workspace-root-json"));
        let correspondence_artifact = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "correspondence-index-json")
            .unwrap();
        assert!(manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                artifact.kind.starts_with("node-output:")
                    || is_researcher_output_kind(&artifact.kind)
            })
            .all(|artifact| correspondence_artifact
                .derived_from
                .contains(&artifact.digest)));
        assert!(manifest.open_obligations.is_empty());
        assert!(manifest.state_reasons.iter().any(|reason| {
            reason.subject_id == "outputs" && reason.state == MaterializationState::Satisfied
        }));
        let assignment_digests = manifest
            .role_assignments
            .iter()
            .map(|assignment| assignment.artifact.digest.as_str())
            .collect::<BTreeSet<_>>();
        for artifact in manifest.artifacts.iter().filter(|artifact| {
            matches!(
                artifact.kind.as_str(),
                "app-csv" | "review-summary-json" | "visualization-data-json"
            )
        }) {
            assert_eq!(
                artifact
                    .derived_from
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>(),
                assignment_digests,
                "{} must bind every active input/support/config assignment",
                artifact.kind,
            );
        }
        assert_eq!(
            handle.artifact_count() as usize,
            manifest.artifacts.len(),
            "the transport handle and manifest must expose the same complete closure",
        );
        let mut kinds = BTreeSet::new();
        let mut ledger = None;
        let mut stage_view_value = None;
        let mut explanation_view_value = None;
        let mut closure_value = None;
        let mut correspondence_value = None;
        let mut workspace_root_value = None;
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
            } else if metadata.kind == "explanation-view-json" {
                explanation_view_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "artifact-closure-json" {
                closure_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "correspondence-index-json" {
                correspondence_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "workspace-root-json" {
                workspace_root_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
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
        assert!(kinds.contains("correspondence-index-json"));
        assert!(kinds.contains("artifact-closure-json"));
        assert!(kinds.contains("row-lineage-arrow"));
        assert!(kinds.contains("result-cell-correspondence-arrow"));
        assert!(kinds.contains("source-coordinate-index-arrow"));
        assert!(!kinds.iter().any(|kind| kind.starts_with("ingress:")));
        assert_eq!(
            kinds
                .iter()
                .filter(|kind| kind.starts_with("node-output:"))
                .count(),
            15
        );
        let stage_view_value = stage_view_value.unwrap();
        assert_eq!(stage_view_value["revision"], 72);
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
        let explanation_view_value = explanation_view_value.unwrap();
        assert_eq!(
            explanation_view_value["payload"]["qualification_traces"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            explanation_view_value["payload"]["requirement_traces"]
                .as_array()
                .unwrap()
                .len(),
            embedded_plan().root_roles.len()
        );
        let closure_value = closure_value.unwrap();
        assert_eq!(
            closure_value["protocolVersion"],
            "chronicle-artifact-closure/v1"
        );
        assert_eq!(closure_value["workspaceId"], manifest.workspace_id);
        assert_eq!(
            closure_value["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert!(closure_value["artifacts"].as_array().unwrap().len() >= 10);
        let correspondence_value = correspondence_value.unwrap();
        assert_eq!(
            correspondence_value["protocolVersion"],
            "chronicle-correspondence-index/v3"
        );
        assert_eq!(
            correspondence_value["sourceCoordinateArtifactKind"],
            "source-coordinate-index-arrow"
        );
        assert_eq!(
            correspondence_value["rowCorrespondenceArtifactKind"],
            "row-lineage-arrow"
        );
        assert_eq!(
            correspondence_value["cellCorrespondenceArtifactKind"],
            "result-cell-correspondence-arrow"
        );
        assert_eq!(
            correspondence_value["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert_eq!(
            workspace_root_value.unwrap()["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        let correspondence_edges = correspondence_value["edges"].as_array().unwrap();
        let option_edges = correspondence_edges
            .iter()
            .filter(|edge| {
                edge["sourceKind"] == "configuration-value" && edge["targetKind"] == "logical-node"
            })
            .collect::<Vec<_>>();
        let declared_knob_count = embedded_plan()
            .nodes
            .iter()
            .map(|node| node.knobs.len())
            .sum::<usize>();
        assert_eq!(option_edges.len(), declared_knob_count);
        for edge in option_edges {
            let source_id = edge["sourceId"].as_str().unwrap();
            let option_key = source_id
                .strip_prefix("option:")
                .and_then(|suffix| suffix.split_once(':'))
                .map(|(key, _)| key)
                .unwrap();
            let node_id = edge["targetId"].as_str().unwrap();
            let relation = edge["relation"].as_str().unwrap();
            assert!(embedded_plan().nodes.iter().any(|node| {
                node.node_id == node_id
                    && node.knobs.iter().any(|knob| {
                        knob.option_key == option_key && relation == format!("{}-node", knob.edge)
                    })
            }));
        }
        assert!(manifest.qualification_traces.iter().all(|trace| {
            correspondence_edges.iter().any(|edge| {
                edge["sourceKind"] == "qualification-trace"
                    && edge["sourceId"] == trace.trace_id
                    && edge["relation"] == "selects-assignment"
            })
        }));
        let raw_digest = &manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "raw_chronicle_csv")
            .unwrap()
            .artifact
            .digest;
        let app_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "app-csv")
            .unwrap()
            .digest;
        let cell_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap()
            .digest;
        let source_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-coordinate-index-arrow")
            .unwrap()
            .digest;
        let row_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "row-lineage-arrow")
            .unwrap()
            .digest;
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "logical-node"
                && edge["sourceId"] == "outputs"
                && edge["relation"] == "publishes"
                && edge["targetId"] == *app_digest
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "artifact"
                && edge["sourceId"] == *raw_digest
                && edge["relation"] == "has-source-coordinates-in"
                && edge["targetId"] == *source_index_digest
                && edge["precision"] == "exact"
        }));
        let cell_index_metadata = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap();
        let expected_cell_dependencies = manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                is_canonical_cell_output_kind(&artifact.kind)
                    || artifact.kind == "row-lineage-arrow"
            })
            .map(|artifact| artifact.digest.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            cell_index_metadata
                .derived_from
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected_cell_dependencies,
        );
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "indexes-cells-of"
                && edge["targetId"] == *app_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "joins-row-correspondence"
                && edge["targetId"] == *row_index_digest
                && edge["precision"] == "exact"
        }));
        let adjacency = correspondence_edges.iter().fold(
            BTreeMap::<String, BTreeSet<String>>::new(),
            |mut adjacency, edge| {
                adjacency
                    .entry(edge["sourceId"].as_str().unwrap().into())
                    .or_default()
                    .insert(edge["targetId"].as_str().unwrap().into());
                adjacency
            },
        );
        let mut reached = BTreeSet::from([raw_digest.clone()]);
        let mut frontier = vec![raw_digest.clone()];
        while let Some(source) = frontier.pop() {
            for target in adjacency.get(&source).into_iter().flatten() {
                if reached.insert(target.clone()) {
                    frontier.push(target.clone());
                }
            }
        }
        assert!(
            reached.contains(app_digest),
            "raw artifact must have a forward correspondence path to the app output"
        );
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
    fn warm_workspace_reuses_tracked_results_and_option_change_recomputes_exact_cone() {
        reset_tracked_execution_count();
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
        assert_eq!(tracked_execution_count(), 1);
        assert_eq!(stable_artifact_generation_count(), 1);
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
        let mut warm_handle =
            execute_workspace_native(&warm_request.to_string(), &csv, &support).unwrap();
        let warm: RuntimeManifest = serde_json::from_str(&warm_handle.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            1,
            "warm run must not call the kernel"
        );
        assert_eq!(
            stable_artifact_generation_count(),
            1,
            "warm run must reuse immutable terminal artifacts"
        );
        assert!(warm.node_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Cached | ExecutionStatus::Bypassed
                )
        }));
        assert_eq!(warm.step_executions.len(), 55);
        assert!(warm.step_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed
        )));
        let mut warm_ledger = None;
        let mut warm_journal = None;
        for index in 0..warm_handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&warm_handle.artifact_metadata_json(index).unwrap()).unwrap();
            if metadata.kind == "execution-ledger-json" {
                warm_ledger = Some(
                    serde_json::from_slice::<Value>(
                        &warm_handle.take_artifact_bytes(index).unwrap(),
                    )
                    .unwrap(),
                );
            } else if metadata.kind == "evidence-journal" {
                warm_journal = Some(
                    EvidenceJournal::from_cbor(&warm_handle.take_artifact_bytes(index).unwrap())
                        .unwrap(),
                );
            }
        }
        let warm_ledger = warm_ledger.unwrap();
        let warm_ledger_steps = warm_ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["steps"].as_array().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(warm_ledger_steps.len(), 55);
        assert!(warm_ledger_steps.iter().all(|step| {
            matches!(step["status"].as_str(), Some("cached" | "bypassed"))
                && step["inputKey"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && step["outputDigest"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && step["reasonId"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
        }));
        let warm_journal = warm_journal.unwrap();
        assert_eq!(
            warm_journal
                .events()
                .iter()
                .filter(|event| event.event_kind == "node-cached")
                .count(),
            warm.node_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Cached)
                .count()
        );

        let mut changed_request = warm_request;
        changed_request["requestId"] = Value::String("day-coverage-change".into());
        changed_request["workspaceRootDigest"] = Value::String(warm.workspace_root_digest.clone());
        changed_request["options"]["enable_day_coverage"] = Value::Bool(true);
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &support).unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            2,
            "changed executions: {:?}",
            changed
                .node_executions
                .iter()
                .map(|execution| (&execution.node_id, execution.status, &execution.input_key))
                .collect::<Vec<_>>()
        );
        assert_eq!(stable_artifact_generation_count(), 2);
        let recomputed: BTreeSet<_> = changed
            .node_executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.node_id.as_str())
            .collect();
        assert_eq!(recomputed, BTreeSet::from(["day_coverage", "outputs"]));
        assert_eq!(
            changed
                .step_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Recomputed)
                .map(|execution| execution.step_id.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["build_coverage_table", "assemble_result"])
        );
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
    fn exact_option_bindings_drive_step_invalidation_and_match_a_cold_rust_run() {
        reset_tracked_execution_count();
        let csv = csv();
        let initial_request = request_for_workspace(&csv, 'e');
        let initial =
            execute_workspace_native(&initial_request.to_string(), &csv, &Default::default())
                .unwrap();
        let initial: RuntimeManifest = serde_json::from_str(&initial.manifest_json).unwrap();

        let mut changed_request = initial_request;
        changed_request["requestId"] = Value::String("one-nanosecond-proximity-change".into());
        changed_request["workspaceRootDigest"] =
            Value::String(initial.workspace_root_digest.clone());
        changed_request["options"]["proximity_interval_ns"] = Value::from(1_i64);
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &Default::default())
                .unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        let by_id = changed
            .step_executions
            .iter()
            .map(|execution| (execution.step_id.as_str(), execution))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(by_id["run_matcher"].status, ExecutionStatus::Recomputed);
        assert_eq!(by_id["csv_parse"].status, ExecutionStatus::Cached);
        assert_ne!(
            by_id["run_matcher"].input_key,
            initial
                .step_executions
                .iter()
                .find(|execution| execution.step_id == "run_matcher")
                .unwrap()
                .input_key
        );

        let mut cold_request = request_for_workspace(&csv, 'f');
        cold_request["requestId"] = Value::String("cold-one-nanosecond-oracle".into());
        cold_request["options"]["proximity_interval_ns"] = Value::from(1_i64);
        let cold = execute_workspace_native(
            &cold_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cold: RuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(
            changed.processing_summary.pipeline_step_digests,
            cold.processing_summary.pipeline_step_digests
        );
        assert_eq!(
            changed.processing_summary.pipeline_step_checkpoints,
            cold.processing_summary.pipeline_step_checkpoints
        );
        assert_eq!(
            changed.processing_summary.published_outputs_digest,
            cold.processing_summary.published_outputs_digest
        );
    }

    #[test]
    fn preprocessing_timestamp_is_an_exact_bound_input_not_an_untracked_label() {
        reset_tracked_execution_count();
        let csv = csv();
        let initial_request = request_for_workspace(&csv, '7');
        let initial =
            execute_workspace_native(&initial_request.to_string(), &csv, &Default::default())
                .unwrap();
        let initial: RuntimeManifest = serde_json::from_str(&initial.manifest_json).unwrap();

        let mut changed_request = initial_request;
        changed_request["requestId"] = Value::String("timestamp-change".into());
        changed_request["workspaceRootDigest"] = Value::String(initial.workspace_root_digest);
        changed_request["options"]["datetime_of_preprocessing"] =
            Value::String("2026-07-21 12:00:01 UTC".into());
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &Default::default())
                .unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        let by_id = changed
            .step_executions
            .iter()
            .map(|execution| (execution.step_id.as_str(), execution.status))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            by_id["resolve_preproc_datetime"],
            ExecutionStatus::Recomputed
        );
        assert_eq!(by_id["parse_remap_config"], ExecutionStatus::Cached);
        assert_eq!(by_id["csv_parse"], ExecutionStatus::Cached);
        assert_eq!(by_id["assemble_result"], ExecutionStatus::Recomputed);
    }

    #[test]
    fn node_output_artifacts_publish_their_exact_logical_stage_checkpoint() {
        reset_tracked_execution_count();
        let csv = csv();
        let request = request_for_workspace(&csv, 'a');
        let mut handle =
            execute_workspace_native(&request.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.processing_summary.logical_stage_digests.len(), 15);
        assert_eq!(
            manifest.processing_summary.logical_stage_checkpoints.len(),
            15
        );
        assert_eq!(manifest.processing_summary.pipeline_step_digests.len(), 55);
        assert_eq!(
            manifest.processing_summary.pipeline_step_checkpoints.len(),
            55
        );
        for (step_id, checkpoint) in &manifest.processing_summary.pipeline_step_checkpoints {
            assert_eq!(&checkpoint.node_id, step_id);
            assert_eq!(
                manifest
                    .processing_summary
                    .pipeline_step_digests
                    .get(step_id),
                Some(&checkpoint.terminal_digest)
            );
        }

        let mut published = BTreeMap::new();
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            if !metadata.kind.starts_with("node-output:") {
                continue;
            }
            let fingerprint: Value =
                serde_json::from_slice(&handle.take_artifact_bytes(index).unwrap()).unwrap();
            assert_eq!(
                fingerprint["checkpointProtocol"],
                "chronicle-logical-stage-checkpoint/v3"
            );
            assert_eq!(
                fingerprint["typedCheckpoint"]["nodeId"],
                fingerprint["logicalNode"]
            );
            assert_eq!(
                fingerprint["physicalExecution"],
                "salsa-tracked-rust-pipeline-v2"
            );
            published.insert(
                fingerprint["logicalNode"].as_str().unwrap().to_string(),
                fingerprint["semanticOutputDigest"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        assert_eq!(published.len(), 15);
        for (node, digest) in &manifest.processing_summary.logical_stage_digests {
            if node != "outputs" {
                assert_eq!(published.get(node), Some(digest), "checkpoint for {node}");
            }
        }
        assert_eq!(
            published.values().collect::<BTreeSet<_>>().len(),
            15,
            "node identity must keep converged/empty stage values distinct"
        );
    }

    #[test]
    fn incremental_workspace_cache_is_bounded() {
        reset_tracked_execution_count();
        let csv = csv();
        for index in 0..(MAX_INCREMENTAL_RUNTIME_STATES + 3) {
            let marker = char::from_digit((index % 10) as u32, 10).unwrap();
            let request_value = request_for_workspace(&csv, marker);
            execute_workspace_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
        }
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            assert_eq!(states.borrow().states.len(), MAX_INCREMENTAL_RUNTIME_STATES);
        });
    }

    #[test]
    fn mismatched_previous_root_resets_incremental_state() {
        reset_tracked_execution_count();
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
        assert_eq!(tracked_execution_count(), 2);
        assert!(manifest
            .node_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Recomputed));
    }

    #[test]
    fn repeated_review_reuses_cold_rebuild_based_on_a_verified_existing_root() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut request_value = request_for_workspace(&csv, 'b');
        request_value["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        request_value["workspaceRootDigest"] = Value::String(format!("sha256:{}", "a".repeat(64)));

        let first = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first: ReviewRuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert!(first
            .step_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Recomputed));

        request_value["requestId"] = Value::String("same-root-review-b".into());
        let second = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let second: ReviewRuntimeManifest = serde_json::from_str(&second.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            1,
            "the second review arm must reuse the first arm's cold rebuild"
        );
        assert!(second.step_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed | ExecutionStatus::Skipped
        )));
    }

    #[test]
    fn persisted_review_base_reenters_a_fresh_runtime_without_result_drift() {
        reset_tracked_execution_count();
        let csv = csv();
        let full_request = request_for_workspace(&csv, '9');
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let full_manifest: RuntimeManifest = serde_json::from_str(&full.manifest_json).unwrap();
        let review_base_index = (0..full.artifact_count())
            .find(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(*index).unwrap()).unwrap();
                metadata.kind == "review-base"
                    && metadata.media_type == "application/vnd.chronicle.review-base+postcard+lz4"
            })
            .expect("full execution review base");
        let review_base = full.take_artifact_bytes(review_base_index).unwrap();
        assert!(!review_base.is_empty());

        let mut review_request = full_request;
        review_request["requestId"] = Value::String("cached-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(full_manifest.workspace_root_digest.clone());
        review_request["options"]["model_concurrent_usage"] = Value::Bool(false);

        reset_tracked_execution_count();
        let cached = execute_workspace_native_with_review_base(
            &review_request.to_string(),
            &csv,
            &review_base,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cached: ReviewRuntimeManifest = serde_json::from_str(&cached.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert_eq!(
            cached
                .step_executions
                .iter()
                .find(|execution| execution.step_id == "csv_parse")
                .unwrap()
                .status,
            ExecutionStatus::Cached
        );

        reset_tracked_execution_count();
        review_request["requestId"] = Value::String("cold-review".into());
        let cold = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(cached.review_summary_digest, cold.review_summary_digest);
        assert_eq!(cached.comparison_digest, cold.comparison_digest);
        assert_eq!(
            (
                cached.counts.original,
                cached.counts.processed,
                cached.counts.app,
                cached.counts.screen,
            ),
            (
                cold.counts.original,
                cold.counts.processed,
                cold.counts.app,
                cold.counts.screen,
            )
        );
        assert_eq!(cached.timezone, cold.timezone);
        assert_eq!(cached.timezone_action, cold.timezone_action);

        let mut corrupt = review_base;
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0xff;
        reset_tracked_execution_count();
        let error = match execute_workspace_native_with_review_base(
            &review_request.to_string(),
            &csv,
            &corrupt,
            &RuntimeSupportFiles::default(),
        ) {
            Ok(_) => panic!("corrupt review base was accepted"),
            Err(error) => error,
        };
        assert!(
            error.contains("review base") || error.contains("decompress"),
            "unexpected corrupt review-base error: {error}"
        );
    }

    #[test]
    fn execution_ledger_records_an_enabled_or_no_op_query_as_executed() {
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
        assert_eq!(exact_dedupe["status"], "recomputed");
    }

    #[test]
    fn runtime_preserves_selected_filter_counts_from_nested_options() {
        let csv = mixed_timezone_csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["timezone_handling"] = Value::String("selected-filter".into());
        let handle = execute_workspace_native(
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
    fn every_ordered_timezone_transition_matches_a_cold_full_rust_oracle() {
        let csv = mixed_timezone_csv();
        let expected_touched = embedded_plan()
            .nodes
            .into_iter()
            .map(|node| node.node_id)
            .filter(|node_id| node_id != "parse_events")
            .collect::<BTreeSet<_>>();

        for (from_index, from) in TIMEZONE_HANDLING_MODES.iter().enumerate() {
            for (to_index, to) in TIMEZONE_HANDLING_MODES.iter().enumerate() {
                if from == to {
                    continue;
                }
                reset_tracked_execution_count();
                let marker = char::from_digit(((from_index * 4 + to_index) % 10) as u32, 10)
                    .expect("decimal marker");
                let mut initial = request_for_workspace(&csv, marker);
                initial["options"]["timezone_handling"] = Value::String((*from).into());
                let initial_handle = execute_workspace_native(
                    &initial.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                let initial_manifest: RuntimeManifest =
                    serde_json::from_str(&initial_handle.manifest_json).unwrap();

                let mut changed = initial;
                changed["requestId"] = Value::String(format!("transition-{from}-to-{to}"));
                changed["workspaceRootDigest"] =
                    Value::String(initial_manifest.workspace_root_digest);
                changed["options"]["timezone_handling"] = Value::String((*to).into());
                let changed_handle = execute_workspace_native(
                    &changed.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                let manifest: RuntimeManifest =
                    serde_json::from_str(&changed_handle.manifest_json).unwrap();
                let mut oracle_request: RuntimeRequest =
                    serde_json::from_str(&request(&csv)).unwrap();
                oracle_request.options.timezone_handling = (*to).into();
                let oracle_result = run_pipeline_v2_with_supports(
                    &csv,
                    &oracle_request.options.into_pipeline_options(),
                    PipelineV2SupportFiles::default(),
                )
                .unwrap();
                let oracle = pipeline_result_digests(&oracle_result);
                assert_eq!(
                    manifest.processing_summary.timezone_stage_digest,
                    oracle_result.timezone_stage_digest,
                    "{from} -> {to}: normalized state diverged from cold oracle"
                );
                assert_eq!(
                    manifest.processing_summary.published_outputs_digest,
                    oracle.published_outputs_digest,
                    "{from} -> {to}: published output diverged from cold oracle"
                );
                assert_eq!(
                    manifest.processing_summary.provenance_digest, oracle.provenance_digest,
                    "{from} -> {to}: provenance diverged from cold oracle"
                );

                let touched = manifest
                    .node_executions
                    .iter()
                    .filter(|execution| {
                        matches!(
                            execution.status,
                            ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                        )
                    })
                    .map(|execution| execution.node_id.clone())
                    .collect::<BTreeSet<_>>();
                assert!(
                    touched == expected_touched,
                    "{from} -> {to}: exact changed-node set differs: missing={:?} extra={:?}",
                    expected_touched.difference(&touched).collect::<Vec<_>>(),
                    touched.difference(&expected_touched).collect::<Vec<_>>()
                );
                assert_eq!(
                    manifest
                        .node_executions
                        .iter()
                        .find(|execution| execution.node_id == "parse_events")
                        .unwrap()
                        .status,
                    ExecutionStatus::Cached,
                    "{from} -> {to}: upstream parse must remain cached"
                );
            }
        }
    }

    #[test]
    fn transport_request_identity_does_not_change_semantic_workspace_root() {
        let csv = csv();
        let first = execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
            .unwrap();
        let mut second_request: Value = serde_json::from_str(&request(&csv)).unwrap();
        second_request["requestId"] = Value::String("req-2".into());
        let second = execute_workspace_native(
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
        let error =
            execute_workspace_native(&value.to_string(), &csv, &RuntimeSupportFiles::default())
                .err()
                .expect("tampered digest must fail");
        assert!(error.contains("input digest mismatch"));

        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["surprise"] = Value::Bool(true);
        let error =
            execute_workspace_native(&value.to_string(), &csv, &RuntimeSupportFiles::default())
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
    fn requirements_report_exposes_binding_holes_and_execution_fails_closed() {
        let csv = csv();
        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["options"]["use_filter_file"] = Value::Bool(true);
        let request = value.to_string();
        let report =
            evaluate_workspace_requirements_native(&request, &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let report: Value = serde_json::from_str(&report).unwrap();
        assert_eq!(
            report["protocolVersion"],
            "chronicle-requirements-report/v1"
        );
        assert_eq!(report["ready"], false);
        assert_eq!(report["qualificationTraces"].as_array().unwrap().len(), 2);
        let filter_requirement = report["requirementTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["role_id"] == "filter_file")
            .expect("filter requirement trace");
        assert_eq!(filter_requirement["condition_result"], true);
        assert_eq!(filter_requirement["state"], "open");
        assert!(report["openObligations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|obligation| obligation["role_id"] == "filter_file"));
        assert_eq!(report["nodeStates"]["app_policy"], "open");

        let error = execute_workspace_native(&request, &csv, &RuntimeSupportFiles::default())
            .err()
            .expect("missing required role must block execution");
        assert!(error.contains("unresolved binding holes"));
        assert!(error.contains("filter_file"));

        let mut wrong_schema = RuntimeSupportFiles::default();
        wrong_schema
            .put_native(
                "filter_file",
                "filter.csv",
                b"participant_id,value\nP01,unrelated\n",
            )
            .unwrap();
        let invalid =
            evaluate_workspace_requirements_native(&request, &csv, &wrong_schema).unwrap();
        let invalid: Value = serde_json::from_str(&invalid).unwrap();
        assert_eq!(invalid["ready"], false);
        assert_eq!(invalid["roleStates"]["filter_file"], "invalid");
        assert_eq!(invalid["nodeStates"]["app_policy"], "invalid");
        let rejected = invalid["qualificationTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["asserted_role_ids"][0] == "filter_file")
            .unwrap();
        assert_eq!(rejected["decision"], "rejected");
        assert!(rejected["rule_evaluations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|rule| {
                rule["rule_id"] == "chronicle.binding.content-validation.v1"
                    && rule["passed"] == false
            }));

        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "filter_file",
                "filter.csv",
                b"app_package_name,known_application_labels\ncom.invalid,System\n",
            )
            .unwrap();
        let ready = evaluate_workspace_requirements_native(&request, &csv, &support).unwrap();
        let ready: Value = serde_json::from_str(&ready).unwrap();
        assert_eq!(ready["ready"], true);
        assert!(ready["openObligations"].as_array().unwrap().is_empty());
        let filter_qualification = ready["qualificationTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["selected_role_id"] == "filter_file")
            .expect("accepted filter qualification trace");
        assert_eq!(filter_qualification["decision"], "accepted");
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
    fn identical_support_bytes_keep_distinct_role_identity_and_shared_content_identity() {
        let workbook = include_bytes!(concat!(
            env!("CHRONICLE_REPOSITORY_ROOT"),
            "/apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
        ));
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "filter.xlsx", workbook)
            .unwrap();
        support
            .put_native("background_apps_file", "background.xlsx", workbook)
            .unwrap();
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["use_filter_file"] = Value::Bool(true);
        request_value["options"]["use_background_apps_file"] = Value::Bool(true);
        let handle = execute_workspace_native(&request_value.to_string(), &csv, &support).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let filter = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "filter_file")
            .unwrap();
        let background = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "background_apps_file")
            .unwrap();
        assert_eq!(filter.artifact.digest, background.artifact.digest);
        assert_ne!(filter.artifact.artifact_id, background.artifact.artifact_id);

        let normalized = manifest
            .artifacts
            .iter()
            .filter(|artifact| artifact.kind.starts_with("normalized-support:"))
            .collect::<Vec<_>>();
        let normalized_filter = normalized
            .iter()
            .find(|artifact| artifact.kind == "normalized-support:filter_file")
            .unwrap();
        let normalized_background = normalized
            .iter()
            .find(|artifact| artifact.kind == "normalized-support:background_apps_file")
            .unwrap();
        assert_eq!(normalized_filter.digest, normalized_background.digest);
        assert_ne!(
            normalized_filter.artifact_id,
            normalized_background.artifact_id
        );
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
                content_validation_error: None,
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
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "study_dates_file",
                "study-dates.csv",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n",
            )
            .unwrap();
        support
            .put_native(
                "device_sharing_file",
                "device-sharing.csv",
                b"participant_id,sharing_status\nP01,Non-Shared\n",
            )
            .unwrap();
        let mut handle =
            execute_workspace_native(&request_value.to_string(), &csv, &support).unwrap();
        assert_eq!(handle.manifest_json(), handle.manifest_json);
        let kinds = (0..handle.artifact_count())
            .map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                assert!(!handle.take_artifact_bytes(index).unwrap().is_empty());
                if metadata.media_type == "text/csv" {
                    assert!(metadata.row_count.is_some(), "{} row count", metadata.kind);
                    let preview = metadata
                        .preview_rows
                        .as_ref()
                        .unwrap_or_else(|| panic!("{} preview", metadata.kind));
                    assert!(!preview.is_empty());
                    assert!(preview.len() <= 51);
                }
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
            "result-cell-correspondence-arrow",
        ] {
            assert!(kinds.contains(expected), "missing {expected}: {kinds:?}");
        }
        assert!(kinds.iter().any(|kind| kind.starts_with("aggregate-")));
    }

    #[test]
    fn internal_error_and_recovery_helpers_are_observable() {
        let mut artifacts = Vec::new();
        let files = ResolvedSupportFiles {
            files: BTreeMap::from([(
                "filter_file".into(),
                ResolvedSupportFile {
                    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    original_bytes: vec![1],
                    pipeline_csv: b"header\n".to_vec(),
                    normalized_from_xlsx: true,
                    content_validation_error: None,
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
            &build_execution_ledger(&plan, &[], &[], &serde_json::json!({}), "now").unwrap(),
        )
        .unwrap();
        assert!(ledger
            .as_array()
            .unwrap()
            .iter()
            .all(|unit| unit["status"] == "error"));

        let aggregate =
            runtime_aggregate_artifact("aggregate-test", b"x\n".to_vec(), 1, &["input".into()]);
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
        let requirements: Value = serde_json::from_str(
            &evaluate_workspace_requirements(&request_value.to_string(), &csv, &support).unwrap(),
        )
        .unwrap();
        assert_eq!(
            requirements["protocolVersion"],
            "chronicle-requirements-report/v1"
        );
        assert_eq!(requirements["ready"], true);
        let primary = execute_workspace(&request_value.to_string(), &csv, &support).unwrap();
        assert!(primary.manifest_json().contains(EXECUTE_WORKSPACE_COMMAND));
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
        assert_eq!(
            projected.as_object().unwrap().len(),
            CERTIFIED_OPTION_KEYS.len()
        );
        assert_eq!(CERTIFIED_OPTION_KEYS.len(), 48);
        assert!(CERTIFIED_OPTION_KEYS
            .iter()
            .all(|key| projected.get(*key).is_some()));
        for excluded in [
            "enable_plotting",
            "enable_activity_heatmap",
            "parallel_processing",
            "parallel_max_workers",
        ] {
            assert!(projected.get(excluded).is_none());
        }
    }
}
