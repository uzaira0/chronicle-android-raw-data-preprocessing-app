//! Product runtime boundary for the Chronicle raw-data preprocessing app.
//!
//! This crate composes the existing Rust preprocessing kernel with the
//! product-owned semantic adapter. It is deliberately not a reusable graph
//! engine: the reusable surface is the versioned request/result envelope,
//! content-addressed artifacts, role assignments, obligations, and evidence.

mod binary_exports;
pub mod workflow_provenance;

use calamine::{Reader, Xlsx};
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    discover_timezones_v2_native, reconstruction_base_header_bytes, review_base_header_bytes,
    select_persisted_review_base, IncrementalPipelineV2Engine, PersistedReviewBaseSelection,
    PipelineV2Options, PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles,
    WorkflowCheckpoint,
};
#[cfg(test)]
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, TIMEZONE_HANDLING_MODES,
};
use chronicle_chrono_kernel_wasm::workflow_contract::{
    query_request_fields, query_source_role_bindings, ApplicabilityExpression,
    QuerySourceRolePredicate, ReviewBehavior, WorkflowContractDigests, WORKFLOW_QUERIES,
};
use chronicle_chrono_kernel_wasm::{
    is_recognized_interaction_type, is_valid_chronicle_timezone, parse_chronicle_timestamp_ns,
};
use chronicle_preprocessing_semantic_adapter::{
    embedded_dependency_certificate, embedded_dependency_certificate_bytes, embedded_plan,
    embedded_plan_bytes, embedded_profile_bytes, embedded_profile_lock_bytes,
    embedded_runtime_authority_bytes, evaluate_dependency_cache_decision, evaluate_materialization,
    journal::{EvidenceJournal, Transition},
    views::{artifact_view, encode_view, explanation_view, obligation_view},
    ArtifactRef, DependencyCacheDecision, DependencyCacheMode, ExecutionStatus,
    MaterializationState, QueryGroupExecution, RoleAssignment, Sha256Digest, CERTIFIED_OPTION_KEYS,
    EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256, EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256, EMBEDDED_RUNTIME_AUTHORITY_SHA256,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{Cursor, Write};
use std::sync::{Arc, OnceLock};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

pub const RUNTIME_PROTOCOL_VERSION: &str = "chronicle-preprocessing-runtime/v1";

/// Native-only per-segment attribution for the runtime envelope around the
/// tracked kernel, mirroring the kernel's `QueryTimer`. WASM builds never
/// enable `query-timing` (no monotonic clock there).
#[cfg(feature = "query-timing")]
struct EnvelopeTimer {
    label: &'static str,
    started: std::time::Instant,
}

#[cfg(feature = "query-timing")]
impl EnvelopeTimer {
    fn start(label: &'static str) -> Self {
        Self {
            label,
            started: std::time::Instant::now(),
        }
    }

    fn finish(self) {
        drop(self);
    }
}

#[cfg(feature = "query-timing")]
impl Drop for EnvelopeTimer {
    fn drop(&mut self) {
        eprintln!(
            "runtime_segment label={} elapsed_ms={:.3}",
            self.label,
            self.started.elapsed().as_secs_f64() * 1_000.0,
        );
    }
}

#[cfg(not(feature = "query-timing"))]
struct EnvelopeTimer;

#[cfg(not(feature = "query-timing"))]
impl EnvelopeTimer {
    #[inline(always)]
    fn start(_label: &'static str) -> Self {
        Self
    }

    #[inline(always)]
    fn finish(self) {}
}
pub const EXECUTE_WORKSPACE_COMMAND: &str = "ExecuteWorkspace";
pub const QUERY_REVIEW_COMMAND: &str = "QueryReview";
pub const IMPLEMENTATION_BUILD_DIGEST: &str = env!("CHRONICLE_IMPLEMENTATION_BUILD_DIGEST");
pub const BUILD_ENVIRONMENT_DIGEST: &str = env!("CHRONICLE_BUILD_ENVIRONMENT_DIGEST");
const REVIEW_BASE_RUNTIME_MAGIC: &[u8; 8] = b"CHRRVR01";
const RECONSTRUCTION_BASE_RUNTIME_MAGIC: &[u8; 8] = b"CHRRXR01";
const PERSISTED_BASE_RUNTIME_HEADER_BYTES: usize = 8 + 32;
const MAX_REVIEW_BASE_ENCODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_RECONSTRUCTION_BASE_ENCODED_BYTES: usize = 96 * 1024 * 1024;
const MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES: usize = 128 * 1024 * 1024;
const REQUIRED_VIEWS: [(&str, &str, &str); 4] = [
    (
        "workflow-explorer-view-json",
        "chronicle-workflow-explorer/v1",
        "urn:chronicle:view:workflow-explorer:v1",
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

fn persisted_base_runtime_identity() -> [u8; 32] {
    static IDENTITY: OnceLock<[u8; 32]> = OnceLock::new();
    *IDENTITY.get_or_init(|| {
        let mut digest = Sha256::new();
        for value in [
            IMPLEMENTATION_BUILD_DIGEST,
            BUILD_ENVIRONMENT_DIGEST,
            EMBEDDED_PRODUCT_CONTRACT_SHA256,
            EMBEDDED_RUNTIME_AUTHORITY_SHA256,
            EMBEDDED_PLAN_SHA256,
            EMBEDDED_PROFILE_LOCK_SHA256,
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        ] {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
        digest.finalize().into()
    })
}

fn wrap_persisted_base(payload: Vec<u8>, magic: &[u8; 8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(PERSISTED_BASE_RUNTIME_HEADER_BYTES + payload.len());
    encoded.extend_from_slice(magic);
    encoded.extend_from_slice(&persisted_base_runtime_identity());
    encoded.extend_from_slice(&payload);
    encoded
}

fn validate_persisted_base_encoded_lengths(
    review_bytes: usize,
    reconstruction_bytes: usize,
    cache_mode: DependencyCacheMode,
) -> Result<(), String> {
    if cache_mode != DependencyCacheMode::CertifiedNarrow {
        return Ok(());
    }
    if review_bytes > MAX_REVIEW_BASE_ENCODED_BYTES {
        return Err(format!(
            "review base is too large: {review_bytes} bytes exceeds {MAX_REVIEW_BASE_ENCODED_BYTES}"
        ));
    }
    if reconstruction_bytes > MAX_RECONSTRUCTION_BASE_ENCODED_BYTES {
        return Err(format!(
            "reconstruction base is too large: {reconstruction_bytes} bytes exceeds {MAX_RECONSTRUCTION_BASE_ENCODED_BYTES}"
        ));
    }
    let combined = review_bytes
        .checked_add(reconstruction_bytes)
        .ok_or_else(|| "combined persisted-base size overflow".to_string())?;
    if combined > MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES {
        return Err(format!(
            "combined persisted bases are too large: {combined} bytes exceeds {MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES}"
        ));
    }
    Ok(())
}

fn verified_persisted_base_payload<'a>(
    encoded: &'a [u8],
    magic: &[u8; 8],
    label: &str,
    cache_mode: DependencyCacheMode,
) -> Result<&'a [u8], String> {
    if cache_mode != DependencyCacheMode::CertifiedNarrow || encoded.is_empty() {
        return Ok(&[]);
    }
    if encoded.len() < PERSISTED_BASE_RUNTIME_HEADER_BYTES {
        return Err(format!("{label} runtime envelope is truncated"));
    }
    if &encoded[..magic.len()] != magic {
        return Err(format!("{label} runtime envelope has the wrong format"));
    }
    if encoded[magic.len()..PERSISTED_BASE_RUNTIME_HEADER_BYTES]
        != persisted_base_runtime_identity()
    {
        // A cache written by different code or contracts is simply stale. It
        // must not become input to the current Rust kernel.
        return Ok(&[]);
    }
    Ok(&encoded[PERSISTED_BASE_RUNTIME_HEADER_BYTES..])
}

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

// timezone is deliberately absent: a missing timezone column (or blank/"None"
// cells) is documented input and rows fall back to UTC.
const ADVISORY_RAW_COLUMNS: [&str; 6] = [
    "study_id",
    "participant_id",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp",
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
        if timezone.is_empty() || timezone == "None" {
            // Blank and literal "None" cells are real Chronicle export values;
            // preprocessing falls back to UTC for them, so the inspection
            // reports UTC as the effective timezone and keeps only the count.
            missing_timezone_count += 1;
            timezones.insert("UTC".to_string());
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
    if !invalid_timezones.is_empty() {
        // PHI safety: report only the count — raw cell values must never
        // enter warning strings surfaced to the UI.
        warnings.push(format!(
            "Invalid timezone values: {} distinct value(s) in the timezone column.",
            invalid_timezones.len()
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

/// Small, control-plane identity DTO exposed as a typed JS object. Bulk runtime
/// requests, manifests, and artifacts deliberately stay on the existing
/// string/byte boundary so they do not pay per-field JS allocation costs.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct RuntimeIdentity {
    pub protocol_version: String,
    pub implementation_digest: String,
    pub build_environment_digest: String,
    pub product_contract_digest: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub runtime_authority_digest: String,
    pub dependency_certificate_digest: String,
}

fn current_runtime_identity() -> RuntimeIdentity {
    RuntimeIdentity {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
        plan_digest: EMBEDDED_PLAN_SHA256.into(),
        profile_digest: EMBEDDED_PROFILE_SHA256.into(),
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256.into(),
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
    }
}

#[wasm_bindgen]
pub fn runtime_identity() -> RuntimeIdentity {
    current_runtime_identity()
}

#[wasm_bindgen]
pub fn runtime_identity_json() -> String {
    serde_jcs::to_string(&current_runtime_identity()).expect("runtime identity is serializable")
}

#[wasm_bindgen]
pub fn workflow_contract_json() -> String {
    serde_json::to_string(&chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract())
        .expect("Rust workflow contract is serializable")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowExplorerSupportRole {
    pub role_id: String,
    pub present: bool,
    #[serde(default)]
    pub digest: Option<Sha256Digest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowExplorerRequest {
    pub options: Value,
    #[serde(default)]
    pub support_roles: Vec<WorkflowExplorerSupportRole>,
    #[serde(default)]
    pub selected_run_root: Option<Sha256Digest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerPhaseState {
    pub phase_id: String,
    pub label: String,
    pub description: String,
    pub display_order: u16,
    pub input_phase_ids: Vec<String>,
    pub applicable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerOperationState {
    pub operation_id: String,
    pub label: String,
    pub description: String,
    pub phase_id: String,
    pub role: String,
    pub epistemic_role: String,
    pub input_artifact_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub data_effects: Vec<String>,
    pub applicable: bool,
    pub run_state: String,
    pub off_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerArtifactState {
    pub artifact_id: String,
    pub label: String,
    pub kind: String,
    pub producer_operation_id: Option<String>,
    pub consumer_operation_ids: Vec<String>,
    pub run_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerQueryState {
    pub query_id: String,
    pub query_group_id: String,
    pub input_query_ids: Vec<String>,
    pub operation_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub applicability: String,
    pub physical_state: String,
    pub reuse_reason: Option<String>,
    pub checkpoint_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerDecisionImpact {
    pub input_id: String,
    pub input_kind: String,
    pub direct_query_ids: Vec<String>,
    pub affected_operation_ids: Vec<String>,
    pub affected_artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerView {
    pub protocol_version: String,
    pub view_id: String,
    pub schema_id: String,
    pub revision: u64,
    pub root_digest: Sha256Digest,
    pub selected_run_root: Option<Sha256Digest>,
    pub contract_digests: WorkflowContractDigests,
    pub phases: Vec<WorkflowExplorerPhaseState>,
    pub operations: Vec<WorkflowExplorerOperationState>,
    pub artifacts: Vec<WorkflowExplorerArtifactState>,
    pub queries: Vec<WorkflowExplorerQueryState>,
    pub decisions: Vec<WorkflowExplorerDecisionImpact>,
}

fn serialized_enum<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .expect("workflow enum is serializable")
        .as_str()
        .expect("workflow enum serializes as a string")
        .to_string()
}

fn evaluate_workflow_applicability(
    expression: &ApplicabilityExpression,
    options: &Value,
    support_roles: &BTreeSet<&str>,
) -> bool {
    match expression {
        ApplicabilityExpression::Always => true,
        ApplicabilityExpression::OptionTrue { option_key } => options
            .get(*option_key)
            .and_then(Value::as_bool)
            .unwrap_or(false),
        ApplicabilityExpression::OptionBooleanEquals { option_key, value } => options
            .get(*option_key)
            .and_then(Value::as_bool)
            .is_some_and(|actual| actual == *value),
        ApplicabilityExpression::OptionStringEquals { option_key, value } => options
            .get(*option_key)
            .and_then(Value::as_str)
            .is_some_and(|actual| actual == *value),
        ApplicabilityExpression::ArrayNonempty { option_key } => options
            .get(*option_key)
            .and_then(Value::as_array)
            .is_some_and(|value| !value.is_empty()),
        ApplicabilityExpression::StringNonempty { option_key } => options
            .get(*option_key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty()),
        ApplicabilityExpression::SupportPresent { role_id } => support_roles.contains(role_id),
        ApplicabilityExpression::All { terms } => terms
            .iter()
            .all(|term| evaluate_workflow_applicability(term, options, support_roles)),
        ApplicabilityExpression::Any { terms } => terms
            .iter()
            .any(|term| evaluate_workflow_applicability(term, options, support_roles)),
        ApplicabilityExpression::Not { term } => {
            !evaluate_workflow_applicability(term, options, support_roles)
        }
    }
}

fn workflow_phase_applicable<'a, I>(
    phase_id: &str,
    operations: I,
    options: &Value,
    support_roles: &BTreeSet<&str>,
) -> bool
where
    I: IntoIterator<Item = (&'a str, &'a ApplicabilityExpression)>,
{
    operations
        .into_iter()
        .any(|(operation_phase_id, applicability)| {
            operation_phase_id == phase_id
                && evaluate_workflow_applicability(applicability, options, support_roles)
        })
}

fn explorer_query_state(
    execution: Option<&RuntimeQueryExecution>,
) -> (&'static str, Option<String>) {
    match execution.map(|execution| execution.status) {
        Some(ExecutionStatus::Recomputed) => ("executed", None),
        Some(ExecutionStatus::Cached) => ("memoized", Some("same_effective_inputs".into())),
        Some(ExecutionStatus::Skipped) => ("omitted", Some("review_not_requested".into())),
        Some(ExecutionStatus::Bypassed) => ("omitted", Some("not_applicable".into())),
        Some(ExecutionStatus::Error) => ("error", None),
        None => ("not_observed", None),
    }
}

fn is_workflow_support_role(role_id: &str) -> bool {
    role_id != "processing_options"
}

fn build_workflow_explorer_view(
    request: &WorkflowExplorerRequest,
    query_executions: &[RuntimeQueryExecution],
    revision: u64,
    run_root: Option<&str>,
) -> Result<WorkflowExplorerView, String> {
    let exact_options: PipelineV2OptionsJson = serde_json::from_value(request.options.clone())
        .map_err(|error| format!("invalid workflow-explorer options: {error}"))?;
    let semantic_options = semantic_options_value(&exact_options)?;
    let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let known_roles = contract
        .semantic
        .root_roles
        .iter()
        .map(|role| role.role_id)
        .collect::<BTreeSet<_>>();
    let unknown_roles = request
        .support_roles
        .iter()
        .map(|role| role.role_id.as_str())
        .filter(|role| !known_roles.contains(role))
        .collect::<Vec<_>>();
    if !unknown_roles.is_empty() {
        return Err(format!("unknown workflow support roles: {unknown_roles:?}"));
    }
    let present_roles = request
        .support_roles
        .iter()
        .filter(|role| role.present)
        .map(|role| role.role_id.as_str())
        .collect::<BTreeSet<_>>();
    let execution_by_query = query_executions
        .iter()
        .map(|execution| (execution.query_id.as_str(), execution))
        .collect::<BTreeMap<_, _>>();
    let mut operation_run_states = BTreeMap::<&str, String>::new();
    let operations = contract
        .semantic
        .operations
        .iter()
        .map(|operation| {
            let applicable = evaluate_workflow_applicability(
                &operation.applicability,
                &semantic_options,
                &present_roles,
            );
            let executions = operation
                .query_ids
                .iter()
                .filter_map(|query_id| execution_by_query.get(query_id).copied())
                .collect::<Vec<_>>();
            let run_state = if !applicable {
                "not_applicable"
            } else if executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Error)
            {
                "error"
            } else {
                // Query execution is physical evidence only. A fused query can
                // realize several operations with different applicability and
                // no-op paths, so it cannot truthfully prove that any one
                // semantic operation was applied. Operation-specific evidence
                // may promote this state in a later protocol; until then the
                // honest state is not observed.
                "not_observed"
            };
            operation_run_states.insert(operation.id, run_state.to_string());
            WorkflowExplorerOperationState {
                operation_id: operation.id.to_string(),
                label: operation.label.to_string(),
                description: operation.description.to_string(),
                phase_id: operation.phase_id.to_string(),
                role: serialized_enum(operation.role),
                epistemic_role: serialized_enum(operation.epistemic_role),
                input_artifact_ids: operation.input_artifacts.clone(),
                output_artifact_ids: operation.output_artifacts.clone(),
                data_effects: operation
                    .data_effects
                    .iter()
                    .map(|effect| serialized_enum(*effect))
                    .collect(),
                applicable,
                run_state: run_state.to_string(),
                off_reason: (!applicable)
                    .then(|| "off because its applicability rule is false".into()),
            }
        })
        .collect::<Vec<_>>();

    let operation_by_id = contract
        .semantic
        .operations
        .iter()
        .map(|operation| (operation.id, operation))
        .collect::<BTreeMap<_, _>>();
    let mut phase_inputs = BTreeMap::<&str, BTreeSet<&str>>::new();
    for operation in &contract.semantic.operations {
        for input in &operation.input_artifacts {
            let Some(artifact) = contract
                .semantic
                .artifacts
                .iter()
                .find(|artifact| artifact.id == *input)
            else {
                continue;
            };
            let Some(producer) = artifact
                .producer_operation_id
                .and_then(|producer| operation_by_id.get(producer))
            else {
                continue;
            };
            if producer.phase_id != operation.phase_id {
                phase_inputs
                    .entry(operation.phase_id)
                    .or_default()
                    .insert(producer.phase_id);
            }
        }
    }
    let phases = contract
        .presentation
        .phases
        .iter()
        .map(|phase| WorkflowExplorerPhaseState {
            phase_id: phase.id.to_string(),
            label: phase.label.to_string(),
            description: phase.description.to_string(),
            display_order: phase.display_order,
            input_phase_ids: phase_inputs
                .get(phase.id)
                .into_iter()
                .flat_map(|inputs| inputs.iter())
                .map(|input| (*input).to_string())
                .collect(),
            applicable: workflow_phase_applicable(
                phase.id,
                contract
                    .semantic
                    .operations
                    .iter()
                    .map(|operation| (operation.phase_id, &operation.applicability)),
                &semantic_options,
                &present_roles,
            ),
        })
        .collect::<Vec<_>>();

    let artifacts = contract
        .semantic
        .artifacts
        .iter()
        .map(|artifact| {
            let run_state = artifact
                .producer_operation_id
                .and_then(|producer| operation_run_states.get(producer))
                .map(|state| match state.as_str() {
                    "not_applicable" => "absent",
                    "error" => "error",
                    _ => "not_observed",
                })
                .unwrap_or("not_observed");
            WorkflowExplorerArtifactState {
                artifact_id: artifact.id.clone(),
                label: artifact.label.clone(),
                kind: serialized_enum(artifact.kind),
                producer_operation_id: artifact.producer_operation_id.map(str::to_string),
                consumer_operation_ids: artifact
                    .consumer_operation_ids
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                run_state: run_state.to_string(),
            }
        })
        .collect::<Vec<_>>();

    let queries = contract
        .execution
        .queries
        .iter()
        .map(|query| {
            let applicable = evaluate_workflow_applicability(
                &query.applicability,
                &semantic_options,
                &present_roles,
            );
            let execution = execution_by_query.get(query.id).copied();
            let (physical_state, reuse_reason) = explorer_query_state(execution);
            WorkflowExplorerQueryState {
                query_id: query.id.to_string(),
                query_group_id: query.group.to_string(),
                input_query_ids: query.inputs.iter().map(|id| (*id).to_string()).collect(),
                operation_ids: query
                    .operation_ids
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                output_artifact_ids: query.output_ports.clone(),
                applicability: if applicable {
                    "applicable"
                } else {
                    "not_applicable"
                }
                .into(),
                physical_state: physical_state.into(),
                reuse_reason,
                checkpoint_source: execution
                    .filter(|execution| execution.status == ExecutionStatus::Cached)
                    .map(|_| "memory_or_persisted_base".into()),
            }
        })
        .collect::<Vec<_>>();

    let mut impacts = BTreeMap::<(String, String), WorkflowExplorerDecisionImpact>::new();
    for query in &contract.execution.queries {
        for field in query.request_fields {
            let impact = impacts
                .entry(("option".into(), (*field).to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: (*field).to_string(),
                    input_kind: "option".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
            impact.direct_query_ids.push(query.id.to_string());
        }
        for role in query.source_roles {
            let impact = impacts
                .entry(("support".into(), (*role).to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: (*role).to_string(),
                    input_kind: "support".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
            impact.direct_query_ids.push(query.id.to_string());
        }
    }
    // Some output encoders live in the runtime rather than a kernel query.
    // Their settings/supports still belong in Decisions even though they have
    // no direct physical query to report.
    for operation in &contract.semantic.operations {
        for dependency in &operation.config_dependencies {
            impacts
                .entry(("option".into(), dependency.field.clone()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: dependency.field.clone(),
                    input_kind: "option".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
        }
        for artifact_id in &operation.input_artifacts {
            let Some(role_id) = artifact_id.strip_prefix("source.") else {
                continue;
            };
            impacts
                .entry(("support".into(), role_id.to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: role_id.to_string(),
                    input_kind: "support".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
        }
    }
    let mut decisions = impacts.into_values().collect::<Vec<_>>();
    for impact in &mut decisions {
        impact.direct_query_ids.sort();
        impact.direct_query_ids.dedup();
        // Query reachability explains physical cache reconsideration, but it
        // is not the semantic operation graph. Start semantic impact at the
        // operation's own declared option/support dependency, then follow
        // typed artifact consumers. This keeps fused physical queries from
        // falsely making every co-located operation a direct dependency.
        let source_artifact =
            (impact.input_kind == "support").then(|| format!("source.{}", impact.input_id));
        let mut affected_operations = contract
            .semantic
            .operations
            .iter()
            .filter(|operation| {
                if impact.input_kind == "option" {
                    operation
                        .config_dependencies
                        .iter()
                        .any(|dependency| dependency.field == impact.input_id)
                } else {
                    source_artifact
                        .as_ref()
                        .is_some_and(|source| operation.input_artifacts.contains(source))
                }
            })
            .map(|operation| operation.id)
            .collect::<BTreeSet<_>>();
        // Contract operations are topologically ordered, so one forward pass
        // computes the complete downstream closure. Repeating to a fixed point
        // adds no reachability and obscures that ordering guarantee.
        for operation in &contract.semantic.operations {
            if operation
                .input_artifacts
                .iter()
                .filter_map(|input| {
                    contract
                        .semantic
                        .artifacts
                        .iter()
                        .find(|artifact| artifact.id == *input)
                })
                .filter_map(|artifact| artifact.producer_operation_id)
                .any(|producer| affected_operations.contains(producer))
            {
                affected_operations.insert(operation.id);
            }
        }
        for operation_id in affected_operations {
            let operation = operation_by_id[operation_id];
            impact.affected_operation_ids.push(operation_id.to_string());
            impact
                .affected_artifact_ids
                .extend(operation.output_artifacts.clone());
        }
        impact.affected_operation_ids.sort();
        impact.affected_operation_ids.dedup();
        impact.affected_artifact_ids.sort();
        impact.affected_artifact_ids.dedup();
    }
    let selected_run_root = run_root
        .map(str::to_string)
        .or_else(|| request.selected_run_root.clone());
    let planned_root_digest = sha256(
        &serde_jcs::to_vec(&serde_json::json!({
            "protocol": "chronicle-workflow-explorer/v1",
            "workspaceCompatibility": contract.digests.workspace_compatibility,
            "options": request.options,
            "supports": request.support_roles,
            "selectedRunRoot": selected_run_root,
        }))
        .map_err(|error| format!("canonicalize workflow explorer root: {error}"))?,
    );
    let root_digest = run_root.map(str::to_string).unwrap_or(planned_root_digest);
    Ok(WorkflowExplorerView {
        protocol_version: "chronicle-workflow-explorer/v1".into(),
        view_id: "chronicle-workflow-explorer/v1".into(),
        schema_id: "urn:chronicle:view:workflow-explorer:v1".into(),
        revision,
        root_digest,
        selected_run_root,
        contract_digests: contract.digests,
        phases,
        operations,
        artifacts,
        queries,
        decisions,
    })
}

#[wasm_bindgen]
pub fn plan_workflow_explorer_view_json(request_json: &str) -> Result<String, JsValue> {
    plan_workflow_explorer_view_native(request_json).map_err(|error| JsValue::from_str(&error))
}

pub fn plan_workflow_explorer_view_native(request_json: &str) -> Result<String, String> {
    let request: WorkflowExplorerRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("invalid workflow-explorer request: {error}"))?;
    serde_json::to_string(&build_workflow_explorer_view(&request, &[], 0, None)?)
        .map_err(|error| format!("serialize workflow explorer view: {error}"))
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
    /// Review-summary digests the caller already holds (ETag semantics).
    /// When a review request recomputes a summary whose digest is in this
    /// list, the runtime returns the manifest with `review_summary_reused:
    /// true` and no artifact bytes, so the caller keeps its cached copy
    /// instead of re-receiving 2+ MB. A list (not a single digest) because
    /// the interactive comparison loop toggles A -> B -> A: the caller holds
    /// a small LRU of recent summaries, and any of them can match.
    #[serde(default)]
    pub known_review_summary_digests: Option<Vec<String>>,
    pub options: PipelineV2OptionsJson,
}

impl RuntimeRequest {
    fn validate_fields(&self) -> Result<(), String> {
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
        let effective_visualization_target =
            self.options.enable_plotting || self.options.enable_interactive_timeline;
        if self
            .options
            .materialize_visualization_data
            .is_some_and(|declared| declared != effective_visualization_target)
        {
            return Err(
                "materializeVisualizationData must equal enablePlotting OR enableInteractiveTimeline"
                    .into(),
            );
        }
        validate_digest(&self.input_sha256).map_err(|message| format!("inputSha256 {message}"))?;
        if let Some(root) = &self.workspace_root_digest {
            validate_digest(root).map_err(|message| format!("workspaceRootDigest {message}"))?;
        }
        validate_digest(&self.workspace_id).map_err(|message| format!("workspaceId {message}"))?;
        Ok(())
    }

    fn validate(&self, csv_bytes: &[u8]) -> Result<String, String> {
        self.validate_fields()?;
        let actual = sha256(csv_bytes);
        if self.input_sha256 != actual {
            return Err(format!(
                "input digest mismatch: declared={} actual={actual}",
                self.input_sha256
            ));
        }
        Ok(actual)
    }

    fn validate_persisted_input(&self) -> Result<String, String> {
        self.validate_fields()?;
        Ok(self.input_sha256.clone())
    }
}

/// A single rendered preview cell. Unlike every other boundary string this one
/// is legitimately empty when the source column is empty, so the generated
/// browser validator only requires a string here.
pub type PreviewCell = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactMetadata {
    pub artifact_id: String,
    pub kind: String,
    pub media_type: String,
    pub digest: Sha256Digest,
    pub size: u64,
    pub derived_from: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_rows: Option<Vec<Vec<PreviewCell>>>,
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
pub struct RuntimeQueryExecution {
    pub query_id: String,
    pub query_group_id: String,
    pub status: ExecutionStatus,
    pub input_key: Sha256Digest,
    pub output_digest: Sha256Digest,
    pub reason_id: Sha256Digest,
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
    pub timezone_retained_source_rows_digest: Sha256Digest,
    pub timezone_stage_digest: Sha256Digest,
    pub workflow_query_group_digests: BTreeMap<String, Sha256Digest>,
    pub workflow_query_group_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    pub workflow_query_digests: BTreeMap<String, Sha256Digest>,
    pub workflow_query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    pub published_outputs_digest: Sha256Digest,
    pub provenance_digest: Sha256Digest,
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
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub scope: String,
    pub plan_digest: Sha256Digest,
    pub profile_digest: Sha256Digest,
    pub profile_lock_digest: Sha256Digest,
    pub runtime_authority_digest: Sha256Digest,
    pub product_contract_digest: Sha256Digest,
    pub dependency_certificate_digest: Sha256Digest,
    pub dependency_cache_decision: DependencyCacheDecision,
    pub previous_workspace_root_digest: Option<Sha256Digest>,
    pub workspace_id: Sha256Digest,
    pub workspace_root_digest: Sha256Digest,
    pub input: ArtifactRef,
    pub role_assignments: Vec<RoleAssignment>,
    pub qualification_traces: Vec<chronicle_preprocessing_semantic_adapter::QualificationTrace>,
    pub requirement_traces: Vec<chronicle_preprocessing_semantic_adapter::RoleRequirementTrace>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
    pub query_group_executions: Vec<QueryGroupExecution>,
    pub query_executions: Vec<RuntimeQueryExecution>,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
    pub counts: RuntimeCounts,
    pub processing_summary: RuntimeProcessingSummary,
    pub journal_digest: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRuntimeManifest {
    pub protocol_version: String,
    pub preprocessor_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_id: Sha256Digest,
    pub previous_workspace_root_digest: Option<Sha256Digest>,
    pub input_digest: Sha256Digest,
    pub options_digest: Sha256Digest,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub plan_digest: Sha256Digest,
    pub profile_digest: Sha256Digest,
    pub profile_lock_digest: Sha256Digest,
    pub product_contract_digest: Sha256Digest,
    pub dependency_certificate_digest: Sha256Digest,
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
    pub query_group_executions: Vec<QueryGroupExecution>,
    pub query_executions: Vec<RuntimeQueryExecution>,
    pub cache_sources: Vec<String>,
    pub review_summary_digest: Sha256Digest,
    pub comparison_digest: Sha256Digest,
    /// True when the request's `knownReviewSummaryDigests` list matched the
    /// recomputed summary, so no artifact bytes accompany this manifest and
    /// the caller keeps its cached copy.
    #[serde(default)]
    pub review_summary_reused: bool,
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
    pub query_group_states: BTreeMap<String, MaterializationState>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootCommit<'a> {
    protocol_version: &'a str,
    workflow_model_version: &'static str,
    workflow_compatibility_digest: &'a str,
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
    influence_witness_artifact_kind: &'static str,
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
    reconstruction_base: Option<Vec<u8>>,
    query_group_executions: Vec<QueryGroupExecution>,
    query_executions: Vec<RuntimeQueryExecution>,
    cache_sources: Vec<String>,
    cache_decision: DependencyCacheDecision,
    node_artifacts: Vec<RuntimeArtifact>,
}

fn validate_verified_review_inputs(
    verified_persisted_input: bool,
    has_owned_csv: bool,
    review_base_is_empty: bool,
) -> Result<(), String> {
    if verified_persisted_input && (has_owned_csv || review_base_is_empty) {
        return Err("verified persisted review requires a selected review base".into());
    }
    Ok(())
}

fn should_report_salsa_memory(
    cache_sources_empty: bool,
    had_previous_query_observations: bool,
    query_executions: &[RuntimeQueryExecution],
) -> bool {
    cache_sources_empty
        && had_previous_query_observations
        && query_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Cached)
}

struct PersistedReviewBases<'a> {
    review: &'a [u8],
    reconstruction: &'a [u8],
    warm_verified_input: bool,
}

struct CorrespondenceIndexInputs<'a> {
    plan: &'a chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    assignments: &'a BTreeMap<String, RoleAssignment>,
    materialization: &'a chronicle_preprocessing_semantic_adapter::Materialization,
    query_group_executions: &'a [QueryGroupExecution],
    options: &'a Value,
    artifacts: &'a [RuntimeArtifact],
    checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
    query_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
}

struct IngressMaterialization {
    input: ArtifactRef,
    assignments: BTreeMap<String, RoleAssignment>,
    materialization: chronicle_preprocessing_semantic_adapter::Materialization,
    journal: EvidenceJournal,
}

struct PreparedRuntimeWorkspace {
    request: RuntimeRequest,
    options_value: Value,
    exact_options_value: Value,
    options_bytes: Vec<u8>,
    options_digest: String,
    resolved_support: Arc<ResolvedSupportFiles>,
    pipeline_options: PipelineV2Options,
    ingress: IngressMaterialization,
}

#[wasm_bindgen]
pub struct PreparedReviewWorkspace {
    prepared: Option<PreparedRuntimeWorkspace>,
    csv_bytes: Option<Vec<u8>>,
    review_probe: Vec<u8>,
    reconstruction_probe: Vec<u8>,
    selection: PersistedReviewBaseSelection,
    warm_verified_input: bool,
}

#[wasm_bindgen]
pub struct RuntimeHandle {
    manifest_json: String,
    artifacts: Vec<RuntimeArtifact>,
}

#[derive(Default)]
struct IncrementalRuntimeState {
    incremental_engine: IncrementalPipelineV2Engine,
    previous_query_observations: BTreeMap<String, PreviousQueryObservation>,
    previous_stage_inputs: BTreeMap<String, String>,
    previous_stage_outputs: BTreeMap<String, ArtifactRef>,
    stable_artifact_bundle: Option<StableArtifactBundle>,
    last_workspace_root: Option<String>,
}

#[derive(Clone)]
struct StableArtifactBundle {
    key: String,
    result_digests: PipelineResultDigests,
    binary_artifacts: Vec<RuntimeArtifact>,
    source_coordinate_artifacts: Vec<RuntimeArtifact>,
}

#[derive(Debug, Clone)]
struct PreviousQueryObservation {
    input_key: String,
    output_digest: String,
    applicable: bool,
}

// Default Salsa engine retention: one workspace at a time. When the caller
// enables comparison pre-caching, this is raised so each worker retains
// engines for many files simultaneously — warm review (1.9 ms) instead of
// cold (61 ms) on the first comparison.
const DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES: usize = 1;
const MAX_STABLE_ARTIFACT_CACHE_BYTES: u64 = 32 * 1024 * 1024;

struct IncrementalRuntimeStateCache {
    states: BTreeMap<String, IncrementalRuntimeState>,
    lru: VecDeque<String>,
    max_states: usize,
}

impl Default for IncrementalRuntimeStateCache {
    fn default() -> Self {
        Self {
            states: BTreeMap::new(),
            lru: VecDeque::new(),
            max_states: DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES,
        }
    }
}

impl IncrementalRuntimeStateCache {
    fn state_for(&mut self, workspace_id: &str) -> &mut IncrementalRuntimeState {
        self.lru.retain(|candidate| candidate != workspace_id);
        if !self.states.contains_key(workspace_id) && self.states.len() >= self.max_states {
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

    fn has_warm_review_input(
        &self,
        workspace_id: &str,
        workspace_root_digest: Option<&str>,
        input_digest: &str,
    ) -> bool {
        self.states.get(workspace_id).is_some_and(|state| {
            state.last_workspace_root.as_deref() == workspace_root_digest
                && state.incremental_engine.has_verified_input(input_digest)
        })
    }

    fn set_capacity(&mut self, capacity: usize) {
        self.max_states = capacity.max(1);
        while self.states.len() > self.max_states {
            if let Some(evicted) = self.lru.pop_front() {
                self.states.remove(&evicted);
            } else {
                break;
            }
        }
    }

    fn compact_all(&mut self) {
        for state in self.states.values_mut() {
            state.stable_artifact_bundle = None;
            state.previous_stage_outputs.clear();
        }
    }

    fn retained_count(&self) -> usize {
        self.states.len()
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
    assemble_result_manifest_digest: &'a str,
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
    let assemble_result_manifest_digest = result
        .workflow_query_digests
        .get("assemble_result_manifest")
        .ok_or_else(|| "tracked result omitted assemble_result_manifest checkpoint".to_string())?;
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
            assemble_result_manifest_digest,
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

fn stable_artifacts_fit_cache(
    binary_artifacts: &[RuntimeArtifact],
    source_coordinate_artifacts: &[RuntimeArtifact],
) -> bool {
    binary_artifacts
        .iter()
        .chain(source_coordinate_artifacts)
        .try_fold(0_u64, |total, artifact| {
            total
                .checked_add(artifact.metadata.size)
                .filter(|next| *next <= MAX_STABLE_ARTIFACT_CACHE_BYTES)
        })
        .is_some()
}

thread_local! {
    static INCREMENTAL_RUNTIME_STATES: RefCell<IncrementalRuntimeStateCache> =
        RefCell::new(IncrementalRuntimeStateCache::default());
}

#[wasm_bindgen]
pub fn set_comparison_cache_capacity(capacity: usize) {
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        let mut cache = states.borrow_mut();
        cache.set_capacity(capacity);
        cache.compact_all();
    });
}

#[wasm_bindgen]
pub fn get_comparison_cache_retained() -> usize {
    INCREMENTAL_RUNTIME_STATES.with(|states| states.borrow().retained_count())
}

#[cfg(test)]
thread_local! {
    static TRACKED_PHYSICAL_EXECUTION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static STABLE_ARTIFACT_GENERATION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PipelineResultProvenance<'a> {
    original: u32,
    processed: u32,
    app: u32,
    screen: u32,
    duplicate_timestamps_corrected: u32,
    exact_duplicate_rows_removed: u32,
    available_timezones: &'a [String],
    timezone: &'a str,
    timezone_action: &'a str,
    rows_before_timezone_handling: u32,
    rows_after_timezone_handling: u32,
    rows_removed_by_timezone: u32,
    timezone_retained_source_rows_digest: &'a str,
    timezone_stage_digest: &'a str,
    row_lineage: &'a [chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage],
    workflow_query_group_digests: &'a BTreeMap<String, String>,
    workflow_query_group_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
    workflow_query_digests: &'a BTreeMap<String, String>,
    workflow_query_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
}

struct Sha256Writer<'a>(&'a mut Sha256);

impl Write for Sha256Writer<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
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
    serde_jcs::to_writer(
        Sha256Writer(&mut digest),
        &PipelineResultProvenance {
            original: result.original_row_count,
            processed: result.processed_row_count,
            app: result.app_row_count,
            screen: result.screen_row_count,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
            available_timezones: &result.available_timezones,
            timezone: &result.timezone,
            timezone_action: &result.timezone_action,
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            timezone_retained_source_rows_digest: &result.timezone_retained_source_rows_digest,
            timezone_stage_digest: &result.timezone_stage_digest,
            row_lineage: &result.row_lineage,
            workflow_query_group_digests: &result.workflow_query_group_digests,
            workflow_query_group_checkpoints: &result.workflow_query_group_checkpoints,
            workflow_query_digests: &result.workflow_query_digests,
            workflow_query_checkpoints: &result.workflow_query_checkpoints,
        },
    )
    .expect("pipeline result digest metadata is serializable");
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

/// Exact-serialization option keys that [`semantic_options_value`] renames or
/// derives before the certified-key filter. Every exact key absent from this
/// table projects to itself. The influence witness resolves option scopes
/// (exact top-level keys of the `processing_options` document) against plan
/// knobs (certified keys) through this same table, so the two spaces cannot
/// drift apart silently.
pub(crate) const EXACT_TO_CERTIFIED_OPTION_KEYS: &[(&str, &[&str])] = &[
    (
        "usage_session_mode",
        &["process_app_usage", "process_screen_usage"],
    ),
    ("timezone", &["selected_timezone"]),
    (
        "use_apps_forcing_screen_open",
        &["use_apps_forcing_screen_open_file"],
    ),
    (
        "long_duration_threshold_ns",
        &["long_duration_threshold_hours"],
    ),
    ("proximity_interval_ns", &["proximity_interval_seconds"]),
    (
        "same_app_stop_types",
        &["same_app_interaction_types_to_stop_usage_at"],
    ),
    (
        "other_stop_types",
        &["other_interaction_types_to_stop_usage_at"],
    ),
    (
        "screen_auto_lock_timeout_seconds",
        &["screen_usage_auto_lock_timeout_seconds"],
    ),
    (
        "screen_auto_lock_tolerance_seconds",
        &["screen_usage_auto_lock_tolerance_seconds"],
    ),
    (
        "screen_manual_lock_max_tail_seconds",
        &["screen_usage_manual_lock_max_tail_gap_seconds"],
    ),
    (
        "screen_keyguard_near_stop_seconds",
        &["screen_usage_keyguard_near_stop_seconds"],
    ),
];

/// Whether influence through the exact-serialization option key reaches the
/// given certified option key after the [`semantic_options_value`] projection.
pub(crate) fn exact_option_key_reaches_certified(exact_key: &str, certified_key: &str) -> bool {
    match EXACT_TO_CERTIFIED_OPTION_KEYS
        .iter()
        .find(|(exact, _)| *exact == exact_key)
    {
        Some((_, certified)) => certified.contains(&certified_key),
        None => exact_key == certified_key,
    }
}

/// Product support artifacts injected by registered semantic role. Adding a
/// role does not change the execution ABI or reorder existing inputs.
#[wasm_bindgen]
#[derive(Default)]
pub struct RuntimeSupportFiles {
    files: BTreeMap<String, RuntimeSupportFile>,
    resolved: OnceLock<Result<Arc<ResolvedSupportFiles>, String>>,
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
        let _ = self.resolved.take();
        self.files.insert(
            role.into(),
            RuntimeSupportFile {
                name: name.into(),
                bytes: bytes.to_vec(),
            },
        );
        Ok(())
    }

    fn resolve(&self) -> Result<Arc<ResolvedSupportFiles>, String> {
        self.resolved
            .get_or_init(|| {
                let mut resolved = ResolvedSupportFiles::default();
                for (role, file) in &self.files {
                    let lower = file.name.to_ascii_lowercase();
                    let (media_type, pipeline_csv, normalized_from_xlsx) =
                        if lower.ends_with(".csv") {
                            ("text/csv", file.bytes.clone(), false)
                        } else if lower.ends_with(".xlsx") {
                            (
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                xlsx_to_csv(&file.bytes).map_err(|error| {
                                    format!("{role} ({name}): {error}", name = file.name)
                                })?,
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
                Ok(Arc::new(resolved))
            })
            .clone()
    }
}

impl ResolvedSupportFiles {
    fn get(&self, role: &str) -> &[u8] {
        self.files
            .get(role)
            .map(|file| file.pipeline_csv.as_slice())
            .unwrap_or_default()
    }

    fn pipeline_files(&self) -> PipelineV2SupportFiles<'_> {
        PipelineV2SupportFiles {
            filter_csv: self.get("filter_file"),
            apps_forcing_csv: self.get("apps_forcing_screen_open_file"),
            background_apps_csv: self.get("background_apps_file"),
            codebook_csv: self.get("app_codebook_file"),
            study_dates_csv: self.get("study_dates_file"),
            device_sharing_csv: self.get("device_sharing_file"),
            survey_attribution_csv: self.get("survey_attribution_file"),
            enrolled_devices_csv: self.get("enrolled_devices_file"),
        }
    }
}

#[derive(Serialize)]
struct RuntimeQueryKeyMaterial<'a> {
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    query_closure_digest: &'a str,
    applicable: bool,
    upstream: BTreeMap<String, String>,
    request_fields: BTreeMap<String, Value>,
    source_roles: BTreeMap<String, Option<String>>,
    output_mode: Option<&'static str>,
}

fn query_output_mode(
    review_behavior: ReviewBehavior,
    materialize_full_outputs: bool,
) -> Option<&'static str> {
    (review_behavior != ReviewBehavior::Execute).then_some(if materialize_full_outputs {
        "full"
    } else {
        "review"
    })
}

fn active_source_roles(
    query_id: &str,
    exact_options: &serde_json::Map<String, Value>,
    assignments: &BTreeMap<String, RoleAssignment>,
) -> BTreeMap<String, Option<String>> {
    query_source_role_bindings(query_id)
        .into_iter()
        .filter_map(|binding| {
            let active = binding.when_all.iter().all(|predicate| match predicate {
                QuerySourceRolePredicate::BooleanEquals {
                    request_field,
                    value,
                } => exact_options
                    .get(*request_field)
                    .and_then(Value::as_bool)
                    .is_some_and(|actual| actual == *value),
                QuerySourceRolePredicate::StringOneOf {
                    request_field,
                    values,
                } => exact_options
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
        .collect()
}

struct RuntimeQueryExecutionState<'a> {
    executed_queries: &'a [String],
    materialize_full_outputs: bool,
    previous_observations: &'a mut BTreeMap<String, PreviousQueryObservation>,
}

fn build_runtime_query_executions(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    exact_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
    result: &PipelineV2Result,
    state: &mut RuntimeQueryExecutionState<'_>,
) -> Result<Vec<RuntimeQueryExecution>, String> {
    let plan_queries = plan
        .queries
        .iter()
        .map(|step| (step.query_id.as_str(), step))
        .collect::<BTreeMap<_, _>>();
    let workflow_contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let query_contracts = workflow_contract
        .execution
        .queries
        .iter()
        .map(|query| (query.id, query))
        .collect::<BTreeMap<_, _>>();
    let contract_ids = WORKFLOW_QUERIES
        .iter()
        .map(|step| step.id)
        .collect::<BTreeSet<_>>();
    let plan_ids = plan_queries.keys().copied().collect::<BTreeSet<_>>();
    if contract_ids != plan_ids {
        return Err(format!(
            "Rust workflow query contract and embedded product plan disagree: rust_only={:?}, plan_only={:?}",
            contract_ids.difference(&plan_ids).collect::<Vec<_>>(),
            plan_ids.difference(&contract_ids).collect::<Vec<_>>(),
        ));
    }

    let exact_object = exact_options
        .as_object()
        .ok_or_else(|| "exact Rust options must serialize as an object".to_string())?;
    let executed_queries = state
        .executed_queries
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let unknown_executions = executed_queries
        .difference(&contract_ids)
        .copied()
        .collect::<Vec<_>>();
    if !unknown_executions.is_empty() {
        return Err(format!(
            "incremental engine reported unknown executed queries: {unknown_executions:?}"
        ));
    }
    let mut executions = Vec::with_capacity(WORKFLOW_QUERIES.len());
    let mut binding_gaps = Vec::new();
    let mut next_observations = BTreeMap::new();
    for definition in WORKFLOW_QUERIES {
        let plan_query = plan_queries[definition.id];
        let query_contract = query_contracts[definition.id];
        let output_digest = result
            .workflow_query_digests
            .get(definition.id)
            .ok_or_else(|| format!("missing Rust checkpoint digest for {}", definition.id))?
            .clone();
        let applicable = plan_query.applicability.evaluate(semantic_options);
        let previous = state.previous_observations.get(definition.id);
        // The key is defined below as a function of *this* run's inputs, so it
        // is always built from them. A previous run's key was reused here when
        // Salsa reported the query had not executed, on the reasoning that a
        // query which did not run cannot have changed its inputs. That does
        // not hold: the key binds the step's *declared* request fields, and a
        // step can legitimately skip execution while one of them changes —
        // `segment_concurrent_usage` binds `minimum_usage_duration` but only reads it
        // when `apply_minimum_usage_duration_to_concurrent_subintervals` is
        // on, so editing the floor with that switch off left a warm review
        // reporting the previous run's key for it while a cold review of the
        // same options reported a different one. A key that depends on how the
        // run got here is not an identity, and comparing keys across runs is
        // exactly what they are published for.
        let upstream = definition
            .inputs
            .iter()
            .map(|input| {
                result
                    .workflow_query_digests
                    .get(*input)
                    .cloned()
                    .map(|digest| ((*input).to_string(), digest))
                    .ok_or_else(|| format!("{} has no checkpoint for input {input}", definition.id))
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let request_fields = query_request_fields(definition.id)
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
        let source_roles = active_source_roles(definition.id, exact_object, assignments);
        let input_key = sha256(
            &serde_jcs::to_vec(&RuntimeQueryKeyMaterial {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
                query_closure_digest: &query_contract.closure_digest,
                applicable,
                upstream,
                request_fields,
                source_roles,
                output_mode: query_output_mode(
                    query_contract.review_behavior,
                    state.materialize_full_outputs,
                ),
            })
            .map_err(|error| format!("canonicalize {} input key: {error}", definition.id))?,
        );
        if previous.is_some_and(|entry| {
            entry.input_key == input_key && entry.output_digest != output_digest
        }) {
            binding_gaps.push(definition.id.to_string());
        }
        let status = if !applicable && plan_query.can_bypass {
            ExecutionStatus::Bypassed
        } else if !state.materialize_full_outputs
            && query_contract.review_behavior == ReviewBehavior::Omit
        {
            ExecutionStatus::Skipped
        } else if executed_queries.contains(definition.id) {
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
        executions.push(RuntimeQueryExecution {
            query_id: definition.id.to_string(),
            query_group_id: definition.group.to_string(),
            status,
            input_key: input_key.clone(),
            output_digest: output_digest.clone(),
            reason_id,
        });
        next_observations.insert(
            definition.id.to_string(),
            PreviousQueryObservation {
                input_key,
                output_digest,
                applicable,
            },
        );
    }

    if !binding_gaps.is_empty() {
        return Err(format!(
            "tracked query output changed without a changed bound input: {}",
            binding_gaps.join(",")
        ));
    }
    *state.previous_observations = next_observations;
    Ok(executions)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryGroupInputKey<'a> {
    implementation_digest: &'static str,
    contract_digest: &'static str,
    query_group_id: &'a str,
    semantic_output_digest: &'a str,
    query_inputs: BTreeMap<&'a str, (&'a str, &'a str)>,
}

/// `Recomputed` is a claim about physical execution, so it is reachable only
/// from a member query that actually ran (`has_executed_member`, read straight
/// off the Salsa execution events) or from a group the run deactivated.
///
/// The stage's published `input_key` deliberately does *not* feed this. That
/// key binds every member step's own key, and a query's key can legitimately
/// move while the step does not execute — a support artifact rewritten with
/// CRLF line endings changes `active_source_roles`' raw digest but parses to
/// the same rows, so Salsa recomputes nothing. Folding that into the status
/// badged eight support-file byte rewrites per corpus as "recomputed" inside a
/// manifest whose own `queryExecutions` reported that no query was recomputed.
/// Callers that need "the projection key moved" read `input_key`, which is
/// published on every `QueryGroupExecution`.
///
/// `has_executed_member` is the Salsa event set and not "some member is badged
/// `Recomputed`", because the member ladder in `build_runtime_query_executions`
/// resolves `Bypassed` and `Skipped` ahead of `Recomputed`. A query that is not
/// applicable but whose query still ran is therefore badged `Bypassed`, and
/// reading the badges back would lose the execution — leaving this function
/// free to answer `Cached`, whose published reason is
/// `all-active-queries-reused`, for a stage in which a query ran.
fn query_group_status(
    has_error: bool,
    bypassed: bool,
    has_skipped_query: bool,
    group_deactivated: bool,
    has_executed_member: bool,
) -> ExecutionStatus {
    if has_error {
        ExecutionStatus::Error
    } else if bypassed {
        ExecutionStatus::Bypassed
    } else if has_skipped_query {
        ExecutionStatus::Skipped
    } else if group_deactivated || has_executed_member {
        ExecutionStatus::Recomputed
    } else {
        ExecutionStatus::Cached
    }
}

#[allow(clippy::too_many_arguments)]
fn project_query_groups(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    result: &PipelineV2Result,
    query_executions: &[RuntimeQueryExecution],
    executed_queries: &BTreeSet<&str>,
    deactivated_groups: &BTreeSet<&str>,
    previous_stage_inputs: &mut BTreeMap<String, String>,
    previous_stage_outputs: &mut BTreeMap<String, ArtifactRef>,
    materialize_artifacts: bool,
) -> Result<(Vec<QueryGroupExecution>, Vec<RuntimeArtifact>), String> {
    let mut executions = Vec::with_capacity(plan.query_groups.len());
    let mut artifacts = Vec::with_capacity(plan.query_groups.len());
    for node in &plan.query_groups {
        let members = query_executions
            .iter()
            .filter(|execution| execution.query_group_id == node.query_group_id)
            .collect::<Vec<_>>();
        if members.is_empty() {
            return Err(format!(
                "query group {} contains no tracked Rust queries",
                node.query_group_id
            ));
        }
        let checkpoint = result
            .workflow_query_group_checkpoints
            .get(&node.query_group_id)
            .ok_or_else(|| {
                format!(
                    "tracked pipeline omitted typed query-group checkpoint {}",
                    node.query_group_id
                )
            })?;
        let semantic_output_digest = if node.query_group_id == "outputs" {
            sha256(
                &serde_jcs::to_vec(&serde_json::json!({
                    "checkpoint": result.workflow_query_group_digests.get(&node.query_group_id),
                    "enableParquetExport": semantic_options["enable_parquet_export"],
                    "enableSpssExport": semantic_options["enable_spss_export"],
                }))
                .map_err(|error| format!("canonicalize output-stage extensions: {error}"))?,
            )
        } else {
            result
                .workflow_query_group_digests
                .get(&node.query_group_id)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "tracked pipeline omitted query-group digest {}",
                        node.query_group_id
                    )
                })?
        };
        let input_key = sha256(
            &serde_jcs::to_vec(&QueryGroupInputKey {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                query_group_id: &node.query_group_id,
                semantic_output_digest: &semantic_output_digest,
                query_inputs: members
                    .iter()
                    .map(|execution| {
                        (
                            execution.query_id.as_str(),
                            (
                                execution.input_key.as_str(),
                                execution.output_digest.as_str(),
                            ),
                        )
                    })
                    .collect(),
            })
            .map_err(|error| {
                format!(
                    "canonicalize {} query-group key: {error}",
                    node.query_group_id
                )
            })?,
        );
        let projection_changed = previous_stage_inputs
            .get(&node.query_group_id)
            .is_none_or(|previous| previous != &input_key);
        let cached_output = (!materialize_artifacts && !projection_changed)
            .then(|| previous_stage_outputs.get(&node.query_group_id).cloned())
            .flatten();
        let output = if let Some(output) = cached_output {
            output
        } else {
            let bytes = serde_jcs::to_vec(&serde_json::json!({
                "checkpointProtocol": "chronicle-workflow-checkpoint/v1",
                "physicalExecution": "salsa-tracked-rust-pipeline-v2",
                "projection": "query-group-from-actual-query-events",
                "workflowQueryGroupId": node.query_group_id,
                "semanticOutputDigest": semantic_output_digest,
                "typedCheckpoint": checkpoint,
            }))
            .map_err(|error| {
                format!(
                    "canonicalize {} query-group projection: {error}",
                    node.query_group_id
                )
            })?;
            let derived_from = members
                .iter()
                .map(|execution| execution.output_digest.clone())
                .collect::<Vec<_>>();
            let artifact = runtime_artifact(
                &format!("node-output:{}", node.query_group_id),
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
            if materialize_artifacts {
                artifacts.push(artifact);
            }
            output
        };
        let status = query_group_status(
            members
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Error),
            !node.applicability.evaluate(semantic_options) && node.can_bypass,
            members
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Skipped),
            deactivated_groups.contains(node.query_group_id.as_str()),
            members
                .iter()
                .any(|execution| executed_queries.contains(execution.query_id.as_str())),
        );
        let reason = match status {
            ExecutionStatus::Cached => "all-active-queries-reused",
            ExecutionStatus::Recomputed => "query-group-projection-changed",
            ExecutionStatus::Bypassed => "query-group-not-applicable",
            ExecutionStatus::Skipped => "query-skipped",
            ExecutionStatus::Error => "query-error",
        };
        let output_digest = output.digest.clone();
        executions.push(QueryGroupExecution {
            query_group_id: node.query_group_id.clone(),
            capability_id: node.capability_id.clone(),
            status,
            input_key: input_key.clone(),
            output: Some(output.clone()),
            reason_id: stable_id(&[reason, &node.query_group_id, &output_digest]),
        });
        previous_stage_inputs.insert(node.query_group_id.clone(), input_key);
        previous_stage_outputs.insert(node.query_group_id.clone(), output);
    }
    Ok((executions, artifacts))
}

// This is the single handoff from validated runtime state to the Rust query
// engine. Keeping every identity, byte source, option, and support input
// explicit is safer here than hiding them in a second request abstraction.
#[allow(clippy::too_many_arguments)]
fn execute_incremental_pipeline(
    request: &RuntimeRequest,
    ingress_assignments: &BTreeMap<String, RoleAssignment>,
    csv_bytes: &[u8],
    owned_review_csv: Option<Vec<u8>>,
    verified_persisted_input: bool,
    persisted_bases: PersistedReviewBases<'_>,
    options_value: &Value,
    exact_options_value: &Value,
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
        let timer = EnvelopeTimer::start("cache_decision_evaluate");
        let certificate = embedded_dependency_certificate();
        let empirical_evidence_current = dependency_evidence_current(certificate);
        let cache_decision = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            empirical_evidence_current,
            options_value,
            ingress_assignments,
        )
        .map_err(|error| error.to_string())?;
        if cache_decision.mode == DependencyCacheMode::ConservativeFull {
            state.incremental_engine = IncrementalPipelineV2Engine::default();
            state.previous_query_observations.clear();
            state.previous_stage_inputs.clear();
            state.previous_stage_outputs.clear();
            state.stable_artifact_bundle = None;
        }
        let had_previous_query_observations = !state.previous_query_observations.is_empty();
        timer.finish();

        let timer = EnvelopeTimer::start("persisted_base_verify");
        validate_persisted_base_encoded_lengths(
            persisted_bases.review.len(),
            persisted_bases.reconstruction.len(),
            cache_decision.mode,
        )?;

        let verified_review_base = verified_persisted_base_payload(
            persisted_bases.review,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            cache_decision.mode,
        )?;
        let verified_reconstruction_base = verified_persisted_base_payload(
            persisted_bases.reconstruction,
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            "reconstruction base",
            cache_decision.mode,
        )?;

        let support_files = support.pipeline_files();
        timer.finish();
        let timer = EnvelopeTimer::start("engine_execute");
        let tracked_execution = if request.command == QUERY_REVIEW_COMMAND {
            if persisted_bases.warm_verified_input {
                if !verified_persisted_input
                    || owned_review_csv.is_some()
                    || !verified_review_base.is_empty()
                    || !verified_reconstruction_base.is_empty()
                {
                    return Err("warm review requires only the live verified input".into());
                }
                state
                    .incremental_engine
                    .execute_review_with_warm_verified_input(
                        request.input_sha256.clone(),
                        options,
                        support_files,
                    )?
            } else if verified_persisted_input {
                validate_verified_review_inputs(
                    true,
                    owned_review_csv.is_some(),
                    verified_review_base.is_empty(),
                )?;
                state
                    .incremental_engine
                    .execute_review_with_verified_input(
                        request.input_sha256.clone(),
                        verified_review_base,
                        verified_reconstruction_base,
                        options,
                        support_files,
                    )?
            } else if let Some(csv_bytes) = owned_review_csv {
                state.incremental_engine.execute_review_with_owned_csv(
                    csv_bytes,
                    verified_review_base,
                    verified_reconstruction_base,
                    options,
                    support_files,
                )?
            } else {
                state.incremental_engine.execute_review_with_bases(
                    csv_bytes,
                    verified_review_base,
                    verified_reconstruction_base,
                    options,
                    support_files,
                )?
            }
        } else {
            state
                .incremental_engine
                .execute(csv_bytes, options, support_files)?
        };
        timer.finish();
        let timer = EnvelopeTimer::start("base_export");
        let review_base = if request.command == QUERY_REVIEW_COMMAND {
            None
        } else {
            Some(wrap_persisted_base(
                state.incremental_engine.export_review_base()?,
                REVIEW_BASE_RUNTIME_MAGIC,
            ))
        };
        let reconstruction_base = if request.command != QUERY_REVIEW_COMMAND
            && matches!(
                options.usage_session_mode,
                chronicle_chrono_kernel_wasm::pipeline_v2::UsageSessionMode::AppUsage
                    | chronicle_chrono_kernel_wasm::pipeline_v2::UsageSessionMode::AppAndScreenUsage
            ) {
            Some(wrap_persisted_base(
                state.incremental_engine.export_reconstruction_base()?,
                RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            ))
        } else {
            None
        };
        let restored_review_base = tracked_execution
            .internal_executed_queries
            .iter()
            .any(|query| query == "restore_review_base" || query == "restore_review_screen");
        let restored_reconstruction_base =
            tracked_execution
                .internal_executed_queries
                .iter()
                .any(|query| {
                    query == "restore_reconstruction_base"
                        || query == "restore_reconstruction_screen"
                });
        let executed_queries = tracked_execution.executed_queries;
        #[cfg(test)]
        if !executed_queries.is_empty() {
            TRACKED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(count.get() + 1));
        }
        timer.finish();
        let timer = EnvelopeTimer::start("query_executions_build");
        let previous_query_observations = state.previous_query_observations.clone();
        let query_executions = build_runtime_query_executions(
            plan,
            options_value,
            exact_options_value,
            ingress_assignments,
            &tracked_execution.result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &executed_queries,
                materialize_full_outputs: request.command != QUERY_REVIEW_COMMAND,
                previous_observations: &mut state.previous_query_observations,
            },
        )?;
        let mut cache_sources = Vec::new();
        if restored_review_base {
            cache_sources.push("verified-review-base".to_string());
        }
        if restored_reconstruction_base {
            cache_sources.push("verified-reconstruction-base".to_string());
        }
        if should_report_salsa_memory(
            cache_sources.is_empty(),
            had_previous_query_observations,
            &query_executions,
        ) {
            cache_sources.push("salsa-memory".to_string());
        }
        let deactivated_groups = query_executions
            .iter()
            .filter(|execution| {
                execution.status == ExecutionStatus::Bypassed
                    && previous_query_observations
                        .get(&execution.query_id)
                        .is_some_and(|entry| entry.applicable)
            })
            .map(|execution| execution.query_group_id.as_str())
            .collect::<BTreeSet<_>>();
        timer.finish();
        let timer = EnvelopeTimer::start("project_query_groups");
        let result = tracked_execution.result;
        let (executions, node_artifacts) = project_query_groups(
            plan,
            options_value,
            &result,
            &query_executions,
            &executed_queries.iter().map(String::as_str).collect(),
            &deactivated_groups,
            &mut state.previous_stage_inputs,
            &mut state.previous_stage_outputs,
            request.command != QUERY_REVIEW_COMMAND,
        )?;
        timer.finish();
        Ok(IncrementalPipelineExecution {
            result,
            review_base,
            reconstruction_base,
            query_group_executions: executions,
            query_executions,
            cache_sources,
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
pub fn review_base_probe_spec_json() -> String {
    serde_json::json!({
        "reviewBaseBytes": PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes(),
        "reconstructionBaseBytes": PERSISTED_BASE_RUNTIME_HEADER_BYTES
            + reconstruction_base_header_bytes(),
    })
    .to_string()
}

#[wasm_bindgen]
pub fn prepare_workspace_review(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, JsValue> {
    prepare_workspace_review_native(
        request_json,
        csv_bytes,
        review_probe,
        reconstruction_probe,
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Prepare a review from an already verified OPFS workspace. Only the small
/// persisted-base headers cross the boundary until Rust selects the exact
/// compatible base; the unchanged raw file stays in its content-addressed
/// object. A cache miss is reported as `none` and the browser must call the
/// ordinary raw-input API.
#[wasm_bindgen]
pub fn prepare_persisted_workspace_review(
    request_json: &str,
    input_size_bytes: u32,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, JsValue> {
    let prepared = prepare_runtime_workspace_from_persisted_input(
        request_json,
        u64::from(input_size_bytes),
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))?;
    prepare_review_from_prepared(prepared, None, review_probe, reconstruction_probe)
        .map_err(|error| JsValue::from_str(&error))
}

fn prepare_workspace_review_native(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, String> {
    let prepared = prepare_runtime_workspace(request_json, &csv_bytes, support_files)?;
    prepare_review_from_prepared(
        prepared,
        Some(csv_bytes),
        review_probe,
        reconstruction_probe,
    )
}

fn validate_optional_probe_length(
    probe: &[u8],
    expected_bytes: usize,
    label: &str,
) -> Result<(), String> {
    if probe.is_empty() || probe.len() == expected_bytes {
        Ok(())
    } else {
        Err(format!(
            "{label} probe must contain exactly {expected_bytes} bytes"
        ))
    }
}

fn selected_base_matches_probe(probe: &[u8], selected_base: &[u8]) -> bool {
    !probe.is_empty() && selected_base.starts_with(probe)
}

fn prepare_review_from_prepared(
    prepared: PreparedRuntimeWorkspace,
    csv_bytes: Option<Vec<u8>>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
) -> Result<PreparedReviewWorkspace, String> {
    let expected_review_probe_bytes =
        PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
    let expected_reconstruction_probe_bytes =
        PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();
    validate_optional_probe_length(review_probe, expected_review_probe_bytes, "review-base")?;
    validate_optional_probe_length(
        reconstruction_probe,
        expected_reconstruction_probe_bytes,
        "reconstruction-base",
    )?;
    if prepared.request.command != QUERY_REVIEW_COMMAND {
        return Err("prepared review workspace requires QueryReview".into());
    }
    let cache_decision = prepared_cache_decision(&prepared)?;
    let warm_verified_input = cache_decision.mode == DependencyCacheMode::CertifiedNarrow
        && INCREMENTAL_RUNTIME_STATES.with(|states| {
            states.borrow().has_warm_review_input(
                &prepared.request.workspace_id,
                prepared.request.workspace_root_digest.as_deref(),
                &prepared.request.input_sha256,
            )
        });
    let selection = if warm_verified_input {
        PersistedReviewBaseSelection::None
    } else if cache_decision.mode == DependencyCacheMode::CertifiedNarrow {
        let review_header = verified_persisted_base_payload(
            review_probe,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base probe",
            cache_decision.mode,
        )?;
        let reconstruction_header = verified_persisted_base_payload(
            reconstruction_probe,
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            "reconstruction base probe",
            cache_decision.mode,
        )?;
        select_persisted_review_base(
            &prepared.request.input_sha256,
            review_header,
            reconstruction_header,
            &prepared.pipeline_options,
            prepared.resolved_support.pipeline_files(),
        )?
    } else {
        PersistedReviewBaseSelection::None
    };
    Ok(PreparedReviewWorkspace {
        prepared: Some(prepared),
        csv_bytes,
        review_probe: review_probe.to_vec(),
        reconstruction_probe: reconstruction_probe.to_vec(),
        selection,
        warm_verified_input,
    })
}

#[wasm_bindgen]
impl PreparedReviewWorkspace {
    pub fn required_base_kind(&self) -> String {
        if self.warm_verified_input {
            return "salsa-memory".into();
        }
        match self.selection {
            PersistedReviewBaseSelection::None => "none",
            PersistedReviewBaseSelection::Review => "review-base",
            PersistedReviewBaseSelection::Reconstruction => "reconstruction-base",
        }
        .into()
    }

    pub fn execute_selected_base(
        &mut self,
        selected_base: Vec<u8>,
    ) -> Result<RuntimeHandle, JsValue> {
        self.execute_selected_base_native(selected_base)
            .map_err(|error| JsValue::from_str(&error))
    }
}

impl PreparedReviewWorkspace {
    fn execute_selected_base_native(
        &mut self,
        selected_base: Vec<u8>,
    ) -> Result<RuntimeHandle, String> {
        if self.prepared.is_none() {
            return Err("prepared review workspace has already executed".into());
        }
        if self.warm_verified_input && !selected_base.is_empty() {
            return Err("warm review must not receive a persisted base".into());
        }
        let (review_base, reconstruction_base) = match self.selection {
            PersistedReviewBaseSelection::None => {
                if !selected_base.is_empty() {
                    return Err("prepared review workspace selected no persisted base".into());
                }
                (Vec::new(), Vec::new())
            }
            PersistedReviewBaseSelection::Review => {
                if !selected_base_matches_probe(&self.review_probe, &selected_base) {
                    return Err("selected review base does not match its verified probe".into());
                }
                (selected_base, Vec::new())
            }
            PersistedReviewBaseSelection::Reconstruction => {
                if !selected_base_matches_probe(&self.reconstruction_probe, &selected_base) {
                    return Err(
                        "selected reconstruction base does not match its verified probe".into(),
                    );
                }
                (self.review_probe.clone(), selected_base)
            }
        };
        let prepared = self
            .prepared
            .take()
            .ok_or_else(|| "prepared review workspace has already executed".to_string())?;
        let raw_fallback =
            if self.selection == PersistedReviewBaseSelection::None && !self.warm_verified_input {
                Some(self.csv_bytes.take().ok_or_else(|| {
                    "persisted review base did not match; retry with raw input".to_string()
                })?)
            } else {
                self.csv_bytes.take();
                None
            };
        let verified_persisted_input = raw_fallback.is_none();
        execute_prepared_workspace(
            prepared,
            &[],
            raw_fallback,
            verified_persisted_input,
            self.warm_verified_input,
            &review_base,
            &reconstruction_base,
        )
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
    execute_workspace_native_with_review_bases(
        request_json,
        csv_bytes,
        review_base_bytes,
        &[],
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Execute an interactive review with independently verified post-review and
/// post-reconstruction checkpoints. The reconstruction header is rejected before payload
/// decompression when any semantic input to reconstruction changed.
#[wasm_bindgen]
pub fn execute_workspace_with_review_bases(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native_with_review_bases(
        request_json,
        csv_bytes,
        review_base_bytes,
        reconstruction_base_bytes,
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
        csv_bytes.len() as u64,
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
        query_group_states: ingress.materialization.query_group_states,
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

fn prepare_runtime_workspace(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let timer = EnvelopeTimer::start("prepare_input_digest_verify");
    let verified_input_digest = request.validate(csv_bytes)?;
    timer.finish();
    prepare_runtime_workspace_verified(
        request,
        verified_input_digest,
        csv_bytes,
        csv_bytes.len() as u64,
        support_files,
    )
}

fn prepare_runtime_workspace_from_persisted_input(
    request_json: &str,
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let verified_input_digest = request.validate_persisted_input()?;
    prepare_runtime_workspace_verified(
        request,
        verified_input_digest,
        &[],
        input_size_bytes,
        support_files,
    )
}

fn prepare_runtime_workspace_verified(
    request: RuntimeRequest,
    verified_input_digest: String,
    csv_bytes: &[u8],
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let timer = EnvelopeTimer::start("prepare_options_canonicalize");
    let options_value = semantic_options_value(&request.options)?;
    let exact_options_value = serde_json::to_value(&request.options)
        .map_err(|error| format!("serialize exact Rust options: {error}"))?;
    let options_bytes = serde_jcs::to_vec(&exact_options_value)
        .map_err(|error| format!("canonicalize exact Rust options: {error}"))?;
    let options_digest = sha256(&options_bytes);
    timer.finish();
    let timer = EnvelopeTimer::start("prepare_support_resolve");
    let resolved_support = support_files.resolve()?;
    let pipeline_options = request.options.clone().into_pipeline_options();
    timer.finish();
    let timer = EnvelopeTimer::start("prepare_materialize_ingress");
    let ingress = materialize_ingress(
        csv_bytes,
        input_size_bytes,
        &verified_input_digest,
        &options_bytes,
        &options_value,
        &resolved_support,
    )?;
    reject_open_binding_holes(&ingress.materialization)?;
    timer.finish();
    Ok(PreparedRuntimeWorkspace {
        request,
        options_value,
        exact_options_value,
        options_bytes,
        options_digest,
        resolved_support,
        pipeline_options,
        ingress,
    })
}

fn prepared_cache_decision(
    prepared: &PreparedRuntimeWorkspace,
) -> Result<DependencyCacheDecision, String> {
    let certificate = embedded_dependency_certificate();
    evaluate_dependency_cache_decision(
        embedded_plan(),
        Some(certificate),
        Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
        Some(EMBEDDED_PLAN_SHA256),
        dependency_evidence_current(certificate),
        &prepared.options_value,
        &prepared.ingress.assignments,
    )
    .map_err(|error| error.to_string())
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
    execute_workspace_native_with_review_bases(request_json, csv_bytes, &[], &[], support_files)
}

pub fn execute_workspace_native_with_review_base(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native_with_review_bases(
        request_json,
        csv_bytes,
        review_base_bytes,
        &[],
        support_files,
    )
}

pub fn execute_workspace_native_with_review_bases(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let prepared = prepare_runtime_workspace(request_json, csv_bytes, support_files)?;
    execute_prepared_workspace(
        prepared,
        csv_bytes,
        None,
        false,
        false,
        review_base_bytes,
        reconstruction_base_bytes,
    )
}

/// Skip the SHA-256 re-hash of the raw CSV when the caller knows the engine
/// already has verified input for this workspace (warm review iteration).
/// Falls back to the full-verify path if the engine state doesn't confirm.
pub fn execute_workspace_native_warm_review(
    request_json: &str,
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let prepared = prepare_runtime_workspace_from_persisted_input(
        request_json,
        input_size_bytes,
        support_files,
    )?;
    execute_prepared_workspace(prepared, &[], None, true, true, &[], &[])
}

fn required_view_contract_matches(
    kind: &str,
    view: &Value,
    expected_kind: &str,
    expected_view_id: &str,
    expected_schema_id: &str,
    expected_root_digest: &str,
) -> bool {
    let (view_id_key, schema_id_key, root_digest_key) =
        if expected_kind == "workflow-explorer-view-json" {
            ("viewId", "schemaId", "rootDigest")
        } else {
            ("view_id", "schema_id", "root_digest")
        };
    kind == expected_kind
        && view.get(view_id_key).and_then(Value::as_str) == Some(expected_view_id)
        && view.get(schema_id_key).and_then(Value::as_str) == Some(expected_schema_id)
        && view.get(root_digest_key).and_then(Value::as_str) == Some(expected_root_digest)
}

fn execute_prepared_workspace(
    prepared: PreparedRuntimeWorkspace,
    csv_bytes: &[u8],
    owned_review_csv: Option<Vec<u8>>,
    verified_persisted_input: bool,
    warm_verified_input: bool,
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
) -> Result<RuntimeHandle, String> {
    let PreparedRuntimeWorkspace {
        request,
        options_value,
        exact_options_value,
        options_bytes,
        options_digest,
        resolved_support,
        pipeline_options,
        mut ingress,
    } = prepared;
    let IncrementalPipelineExecution {
        result,
        review_base,
        reconstruction_base,
        query_group_executions,
        query_executions,
        cache_sources,
        cache_decision: dependency_cache_decision,
        node_artifacts,
    } = execute_incremental_pipeline(
        &request,
        &ingress.assignments,
        csv_bytes,
        owned_review_csv,
        verified_persisted_input,
        PersistedReviewBases {
            review: review_base_bytes,
            reconstruction: reconstruction_base_bytes,
            warm_verified_input,
        },
        &options_value,
        &exact_options_value,
        &pipeline_options,
        &resolved_support,
    )?;
    let assignment_digests = ingress
        .assignments
        .values()
        .map(|assignment| assignment.artifact.digest.clone())
        .collect::<Vec<_>>();
    if request.command == QUERY_REVIEW_COMMAND {
        let timer = EnvelopeTimer::start("review_manifest_build");
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
        let review_summary_reused =
            request
                .known_review_summary_digests
                .as_ref()
                .is_some_and(|digests| {
                    digests
                        .iter()
                        .any(|digest| digest == &review_summary_digest)
                });
        let artifacts = if review_summary_reused {
            Vec::new()
        } else {
            vec![shared_pipeline_artifact(
                Arc::clone(&result),
                "review-summary-json",
                "application/json",
                assignment_digests,
                review_summary_digest.clone(),
            )]
        };
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
            query_group_executions,
            query_executions,
            cache_sources,
            review_summary_digest,
            comparison_digest,
            review_summary_reused,
        };
        let manifest_json = serde_json::to_string(&manifest)
            .map_err(|error| format!("serialize review runtime manifest: {error}"))?;
        timer.finish();
        return Ok(RuntimeHandle {
            manifest_json,
            artifacts,
        });
    }
    let plan = embedded_plan();
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
    let (result_digests, mut binary_artifacts, source_coordinate_artifacts) =
        if let Some(bundle) = cached_bundle {
            for artifact in bundle
                .binary_artifacts
                .iter()
                .chain(bundle.source_coordinate_artifacts.iter())
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
                bundle.source_coordinate_artifacts,
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
                &result,
                &binary_artifacts,
                csv_bytes,
                &options_bytes,
                &ingress.assignments,
                &resolved_support,
                plan,
            )?;
            if source_coordinate_artifacts.len() != 2 {
                return Err("source-coordinate generator emitted an invalid artifact count".into());
            }
            let cache_stable_artifacts = dependency_cache_decision.mode
                == DependencyCacheMode::CertifiedNarrow
                && stable_artifacts_fit_cache(&binary_artifacts, &source_coordinate_artifacts);
            if cache_stable_artifacts {
                share_owned_artifacts(&mut binary_artifacts);
                share_owned_artifacts(&mut source_coordinate_artifacts);
                store_stable_artifact_bundle(
                    &request.workspace_id,
                    StableArtifactBundle {
                        key: stable_key,
                        result_digests: result_digests.clone(),
                        binary_artifacts: binary_artifacts.clone(),
                        source_coordinate_artifacts: source_coordinate_artifacts.clone(),
                    },
                );
            }
            (
                result_digests,
                binary_artifacts,
                source_coordinate_artifacts,
            )
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
    if let Some(reconstruction_base) = reconstruction_base {
        artifacts.push(runtime_artifact(
            "reconstruction-base",
            "application/vnd.chronicle.reconstruction-base+postcard+lz4",
            reconstruction_base,
            assignment_digests
                .iter()
                .cloned()
                .chain(std::iter::once(options_digest.clone()))
                .collect(),
        ));
    }
    artifacts.extend(source_coordinate_artifacts);
    let satisfied_query_groups: BTreeSet<_> = query_group_executions
        .iter()
        .filter(|execution| {
            !matches!(
                execution.status,
                ExecutionStatus::Error | ExecutionStatus::Skipped
            )
        })
        .map(|execution| execution.query_group_id.clone())
        .collect();
    let materialization = evaluate_materialization(
        plan,
        &ingress.assignments,
        &options_value,
        &satisfied_query_groups,
        &BTreeSet::new(),
    );
    let execution_ledger_bytes = build_execution_ledger(
        plan,
        &query_group_executions,
        &query_executions,
        &options_value,
        &request.options.datetime_of_preprocessing,
    )?;
    let execution_ledger_value: Value = serde_json::from_slice(&execution_ledger_bytes)
        .map_err(|error| format!("parse generated execution ledger: {error}"))?;
    let execution_ledger_artifact = runtime_artifact(
        "execution-ledger-json",
        "application/json",
        execution_ledger_bytes,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    );
    let execution_ledger_digest = execution_ledger_artifact.metadata.digest.clone();
    artifacts.push(execution_ledger_artifact);
    artifacts.push(runtime_artifact(
        "workflow-provenance-jsonld",
        "application/ld+json",
        workflow_provenance::build_workflow_provenance_jsonld(
            // request_id is transport-only and must not perturb the semantic
            // workspace root. The workspace/input/parameter tuple below is
            // the stable scope for this content-addressed run projection.
            &request.workspace_id,
            &ingress.input.digest,
            &options_digest,
            &exact_options_value,
            &request.options.datetime_of_preprocessing,
            &query_executions,
        )?,
        vec![
            ingress.input.digest.clone(),
            options_digest.clone(),
            execution_ledger_digest,
        ],
    ));
    let semantic_index_source = serde_jcs::to_vec(&serde_json::json!({
        "protocolVersion": "chronicle-semantic-index-source/v3",
        "inputDigest": ingress.input.digest,
        "executionTimestamp": request.options.datetime_of_preprocessing,
        "roleAssignments": ingress.assignments.values().collect::<Vec<_>>(),
        "qualificationTraces": materialization.qualification_traces,
        "requirementTraces": materialization.requirement_traces,
        "openObligations": materialization.obligations,
        "stateReasons": materialization.reasons,
        "queryGroupExecutions": query_group_executions,
        "queryExecutions": query_executions,
        "workflowQueryDigests": result.workflow_query_digests,
        "workflowQueryCheckpoints": result.workflow_query_checkpoints,
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
        plan,
        assignments: &ingress.assignments,
        materialization: &materialization,
        query_group_executions: &query_group_executions,
        options: &options_value,
        artifacts: &artifacts,
        checkpoints: &result.workflow_query_group_checkpoints,
        query_checkpoints: &result.workflow_query_checkpoints,
    })?;
    let correspondence_dependencies = artifacts
        .iter()
        .filter(|artifact| {
            artifact.metadata.kind.starts_with("node-output:")
                || is_researcher_output_kind(&artifact.metadata.kind)
                || matches!(
                    artifact.metadata.kind.as_str(),
                    "source-coordinate-index-arrow"
                        | "result-cell-correspondence-arrow"
                        | "source-result-influence-arrow"
                )
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
    for (index, execution) in query_group_executions.iter().enumerate() {
        let from_state = ingress
            .materialization
            .query_group_states
            .get(&execution.query_group_id)
            .copied();
        let to_state = materialization.query_group_states[&execution.query_group_id];
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
                subject_id: &execution.query_group_id,
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
        + query_group_executions.len() as u64
        + query_executions.len() as u64;
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
    let explorer_request = WorkflowExplorerRequest {
        options: exact_options_value.clone(),
        support_roles: ingress
            .assignments
            .iter()
            .filter(|(role_id, _)| is_workflow_support_role(role_id))
            .map(|(role_id, assignment)| WorkflowExplorerSupportRole {
                role_id: role_id.clone(),
                present: true,
                digest: Some(assignment.artifact.digest.clone()),
            })
            .collect(),
        selected_run_root: Some(execution_state_digest.clone()),
    };
    let views = [
        (
            "workflow-explorer-view-json",
            serde_json::to_value(build_workflow_explorer_view(
                &explorer_request,
                &query_executions,
                revision,
                Some(&execution_state_digest),
            )?)
            .map_err(|error| format!("serialize workflow explorer view: {error}"))?,
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
        if !required_view_contract_matches(
            kind,
            &view,
            expected_kind,
            expected_view_id,
            expected_schema_id,
            &execution_state_digest,
        ) {
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
    let workflow_contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let root_commit = RootCommit {
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        workflow_model_version:
            chronicle_chrono_kernel_wasm::workflow_contract::WORKFLOW_MODEL_VERSION,
        workflow_compatibility_digest: &workflow_contract.digests.workspace_compatibility,
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
        query_group_executions,
        query_executions,
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
            workflow_query_group_digests: result.workflow_query_group_digests.clone(),
            workflow_query_group_checkpoints: result.workflow_query_group_checkpoints.clone(),
            workflow_query_digests: result.workflow_query_digests.clone(),
            workflow_query_checkpoints: result.workflow_query_checkpoints.clone(),
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
    executions: &[QueryGroupExecution],
    query_executions: &[RuntimeQueryExecution],
    options: &Value,
    timestamp: &str,
) -> Result<Vec<u8>, String> {
    let status_by_query_group: BTreeMap<_, _> = executions
        .iter()
        .map(|execution| (execution.query_group_id.as_str(), execution.status))
        .collect();
    let execution_by_query = query_executions
        .iter()
        .map(|execution| (execution.query_id.as_str(), execution))
        .collect::<BTreeMap<_, _>>();
    let ledger = plan
        .query_groups
        .iter()
        .map(|node| {
            let status = status_by_query_group
                .get(node.query_group_id.as_str())
                .copied()
                .unwrap_or(ExecutionStatus::Error);
            let queries = plan
                .queries
                .iter()
                .filter(|query| query.query_group_id == node.query_group_id)
                .map(|query| {
                    let execution = execution_by_query.get(query.query_id.as_str()).copied();
                    serde_json::json!({
                        "queryId": query.query_id,
                        "queryGroupId": query.query_group_id,
                        "status": execution.map(|execution| execution.status).unwrap_or(ExecutionStatus::Error),
                        "inputKey": execution.map(|execution| execution.input_key.as_str()),
                        "outputDigest": execution.map(|execution| execution.output_digest.as_str()),
                        "reasonId": execution.map(|execution| execution.reason_id.as_str()),
                        "applicable": query.applicability.evaluate(options),
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
                "queryGroupId": node.query_group_id,
                "status": status,
                "rowsIn": Value::Null,
                "rowsOut": Value::Null,
                "expectations": [],
                "queries": queries,
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
    input_size_bytes: u64,
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
        Some(input_size_bytes),
        BTreeMap::new(),
    )?;
    assign(
        &mut assignments,
        "processing_options",
        "application/json",
        options_bytes,
        None,
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
            None,
            qualifiers,
        )?;
    }
    let materialization = evaluate_materialization(
        plan,
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
        "app-csv" | "screen-csv" | "day-coverage-csv" | "compliance-csv" | "credited-app-csv"
    ) || kind.starts_with("aggregate-")
}

fn build_correspondence_index(inputs: CorrespondenceIndexInputs<'_>) -> Result<Vec<u8>, String> {
    let CorrespondenceIndexInputs {
        plan,
        assignments,
        materialization,
        query_group_executions,
        options,
        artifacts,
        checkpoints,
        query_checkpoints,
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
                "workflow-query-group",
                "parse_events",
                "declared",
            )
            .with_evidence(vec![raw.assignment_id.clone()]),
        );
    }

    let processing_assignment = assignments.get("processing_options");
    let option_keys = plan
        .query_groups
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
        for node in &plan.query_groups {
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
                        "workflow-query-group",
                        node.query_group_id.clone(),
                        "declared",
                    )
                    .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
                );
            }
        }
    }

    for node in &plan.query_groups {
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
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "declared",
                )
                .with_evidence(evidence),
            );
        }
        for input_node in &node.input_query_groups {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-group",
                    input_node.clone(),
                    "feeds",
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = checkpoints.get(&node.query_group_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for step in &plan.queries {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "workflow-query",
                step.query_id.clone(),
                "belongs-to",
                "workflow-query-group",
                step.query_group_id.clone(),
                "declared",
            )
            .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
        );
        for input_step in &step.input_queries {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query",
                    input_step.clone(),
                    "feeds",
                    "workflow-query",
                    step.query_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = query_checkpoints.get(&step.query_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "workflow-query",
                    step.query_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for execution in query_group_executions {
        if let Some(output) = &execution.output {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-group",
                    execution.query_group_id.clone(),
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
                "workflow-query-group",
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

    if let Some(influence) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "source-result-influence-arrow")
    {
        for (source_kind, relation, precision) in [
            (
                "source-coordinate-index-arrow",
                "supplies-source-coordinates-to",
                "exact",
            ),
            (
                "result-cell-correspondence-arrow",
                "supplies-result-coordinates-to",
                "exact",
            ),
            (
                "row-lineage-arrow",
                "supplies-conservative-row-witnesses-to",
                "conservative",
            ),
        ] {
            if let Some(source) = artifacts
                .iter()
                .find(|artifact| artifact.metadata.kind == source_kind)
            {
                append_correspondence_edge(
                    &mut edges,
                    correspondence_edge(
                        "artifact",
                        source.metadata.digest.clone(),
                        relation,
                        "artifact",
                        influence.metadata.digest.clone(),
                        precision,
                    )
                    .with_evidence(vec![EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into()]),
                );
            }
        }
    }

    edges.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
    let index = CorrespondenceIndex {
        protocol_version: "chronicle-correspondence-index/v4",
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        claim_boundary: "Bidirectional graph traversal over exact source/result coordinate identities, qualification, checkpoint, execution, publication, and cell-to-row joins plus declared plan/role/knob dependencies. The influence witness makes declared checkpoint reachability, conservative raw-row candidate cells, and unresolved result scopes explicit. Exact raw-field/support-record contribution is not claimed, and absence of a cell edge is never a non-influence claim.",
        source_coordinate_artifact_kind: "source-coordinate-index-arrow",
        row_correspondence_artifact_kind: "row-lineage-arrow",
        cell_correspondence_artifact_kind: "result-cell-correspondence-arrow",
        influence_witness_artifact_kind: "source-result-influence-arrow",
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
    verified_size: Option<u64>,
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
        size: verified_size.unwrap_or(bytes.len() as u64),
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
    let mut artifact =
        shared_pipeline_artifact(result, kind, "text/csv", dependencies.to_vec(), digest);
    artifact.metadata.row_count = Some(row_count);
    artifact
}

fn canonical_cell_outputs(result: &PipelineV2Result) -> Vec<binary_exports::CanonicalOutput<'_>> {
    // Index the researcher-facing tabular values once. Review and visualization
    // JSON are deterministic views of these outputs and retain artifact-level
    // content hashes; indexing every copied JSON leaf duplicated the same data.
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
    ];
    for (kind, media_type, bytes, terminal_query_group) in candidates {
        if !bytes.is_empty() {
            outputs.push(binary_exports::CanonicalOutput {
                kind,
                media_type,
                bytes,
                terminal_query_group,
            });
        }
    }
    outputs.extend(result.aggregate_csv_outputs.iter().map(|aggregate| {
        binary_exports::CanonicalOutput {
            kind: aggregate.kind.as_str(),
            media_type: "text/csv",
            bytes: &aggregate.bytes,
            terminal_query_group: "outputs",
        }
    }));
    outputs
}

/// The enabled binary encodings of one canonical CSV family: the Parquet bytes
/// and the SPSS bytes, each present only when that export option is on.
type EncodedExportFamily = (Option<Vec<u8>>, Option<Vec<u8>>);

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
        // Parquet and SPSS are two encodings of the same canonical CSV, so the
        // reparse is shared: with both enabled, the 40k-row app CSV used to be
        // parsed twice (measured 48.1 ms and 44.3 MB of `CsvTable` strings per
        // parse; see `binary_exports::perf_measurement`). `encode_export_family`
        // parses one CSV family once, writes every enabled encoding of it, and
        // drops the table before the next family is parsed, so peak memory
        // still holds at most one `CsvTable`. The writers only read the table,
        // so both encodings are byte-identical to an independent reparse —
        // `binary_exports::tests::shared_export_table_is_byte_identical_to_independent_reparse`
        // pins that.
        let encode_export_family = |csv_bytes: &[u8],
                                    include: bool,
                                    screen: bool|
         -> Result<EncodedExportFamily, String> {
            if !include || !(options.enable_parquet_export || options.enable_spss_export) {
                return Ok((None, None));
            }
            let table = binary_exports::parse_csv(csv_bytes)?;
            let parquet = options
                .enable_parquet_export
                .then(|| binary_exports::parquet_from_table(&table, screen))
                .transpose()?;
            let spss = options
                .enable_spss_export
                .then(|| binary_exports::sav_from_table(&table, screen))
                .transpose()?;
            Ok((parquet, spss))
        };
        let (app_parquet, app_spss) =
            encode_export_family(&result.app_csv_bytes, options.include_app_output, false)?;
        let (screen_parquet, screen_spss) = encode_export_family(
            &result.screen_csv_bytes,
            options.include_screen_output,
            true,
        )?;
        // Unchanged artifact order: app-parquet, screen-parquet, app-spss, screen-spss.
        if let Some(bytes) = app_parquet {
            append(
                "app-parquet",
                "application/vnd.apache.parquet",
                bytes,
                result.app_row_count,
            );
        }
        if let Some(bytes) = screen_parquet {
            append(
                "screen-parquet",
                "application/vnd.apache.parquet",
                bytes,
                result.screen_row_count,
            );
        }
        if let Some(bytes) = app_spss {
            append(
                "app-spss",
                "application/x-spss-sav",
                bytes,
                result.app_row_count,
            );
        }
        if let Some(bytes) = screen_spss {
            append(
                "screen-spss",
                "application/x-spss-sav",
                bytes,
                result.screen_row_count,
            );
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

#[allow(clippy::too_many_arguments)]
fn append_source_coordinate_index(
    artifacts: &mut Vec<RuntimeArtifact>,
    result: &PipelineV2Result,
    binary_artifacts: &[RuntimeArtifact],
    raw_csv: &[u8],
    options_json: &[u8],
    assignments: &BTreeMap<String, RoleAssignment>,
    support_files: &ResolvedSupportFiles,
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
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
    let source_coordinate_digest = artifact.metadata.digest.clone();
    artifacts.push(artifact);

    let canonical_outputs = canonical_cell_outputs(result);
    let context = binary_exports::InfluenceContext {
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
    };
    let (bytes, row_count) = binary_exports::source_result_influence_witness_arrow(
        &sources,
        &canonical_outputs,
        &result.row_lineage,
        plan,
        &result.workflow_query_group_checkpoints,
        &context,
    )?;
    let mut dependencies = vec![
        source_coordinate_digest,
        EMBEDDED_PLAN_SHA256.into(),
        EMBEDDED_PROFILE_LOCK_SHA256.into(),
        EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
    ];
    dependencies.extend(
        binary_artifacts
            .iter()
            .filter(|artifact| {
                matches!(
                    artifact.metadata.kind.as_str(),
                    "result-cell-correspondence-arrow" | "row-lineage-arrow"
                )
            })
            .map(|artifact| artifact.metadata.digest.clone()),
    );
    dependencies.sort();
    dependencies.dedup();
    let mut artifact = runtime_artifact(
        "source-result-influence-arrow",
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
    fn persisted_bases_are_bound_to_runtime_identity_and_certified_cache_mode() {
        assert_eq!(MAX_REVIEW_BASE_ENCODED_BYTES, 67_108_864);
        assert_eq!(MAX_RECONSTRUCTION_BASE_ENCODED_BYTES, 100_663_296);
        assert_eq!(MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES, 134_217_728);
        let runtime_identity = persisted_base_runtime_identity();
        assert_ne!(runtime_identity, [0; 32]);
        assert_ne!(runtime_identity, [1; 32]);

        let payload = b"typed-kernel-cache".to_vec();
        let encoded = wrap_persisted_base(payload.clone(), REVIEW_BASE_RUNTIME_MAGIC);
        assert_eq!(
            verified_persisted_base_payload(
                &encoded,
                REVIEW_BASE_RUNTIME_MAGIC,
                "review base",
                DependencyCacheMode::CertifiedNarrow,
            )
            .unwrap(),
            payload
        );
        let empty_payload = wrap_persisted_base(Vec::new(), REVIEW_BASE_RUNTIME_MAGIC);
        assert_eq!(empty_payload.len(), PERSISTED_BASE_RUNTIME_HEADER_BYTES);
        assert!(verified_persisted_base_payload(
            &empty_payload,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .unwrap()
        .is_empty());
        for truncated_len in [1, PERSISTED_BASE_RUNTIME_HEADER_BYTES - 1] {
            assert!(verified_persisted_base_payload(
                &empty_payload[..truncated_len],
                REVIEW_BASE_RUNTIME_MAGIC,
                "review base",
                DependencyCacheMode::CertifiedNarrow,
            )
            .unwrap_err()
            .contains("truncated"));
        }

        let mut stale_identity = encoded.clone();
        stale_identity[REVIEW_BASE_RUNTIME_MAGIC.len()] ^= 0xff;
        assert!(verified_persisted_base_payload(
            &stale_identity,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .unwrap()
        .is_empty());

        assert!(verified_persisted_base_payload(
            &encoded,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::ConservativeFull,
        )
        .unwrap()
        .is_empty());
        assert!(verified_persisted_base_payload(
            b"malformed-but-ignored",
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::ConservativeFull,
        )
        .unwrap()
        .is_empty());
        assert!(verified_persisted_base_payload(
            &encoded,
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            "reconstruction base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());

        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES + 1,
            0,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            0,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            0,
            MAX_RECONSTRUCTION_BASE_ENCODED_BYTES + 1,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            0,
            MAX_RECONSTRUCTION_BASE_ENCODED_BYTES,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES - MAX_REVIEW_BASE_ENCODED_BYTES,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES - MAX_REVIEW_BASE_ENCODED_BYTES + 1,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            usize::MAX,
            usize::MAX,
            DependencyCacheMode::ConservativeFull,
        )
        .is_ok());
    }

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
        // PHI safety: the invalid-timezone warning reports only a count —
        // the raw cell value must never appear in UI-surfaced text.
        assert!(warnings.iter().any(|warning| warning
            == "Invalid timezone values: 1 distinct value(s) in the timezone column."));
        assert!(!warnings
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
S,P2,Chat,Activity Resumed,pkg,2026-03-07 11:00:00,None\r\n\
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
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing timezone"))));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows have invalid event_timestamp values."));
        assert!(!warnings
            .iter()
            .any(|warning| warning == "No timezone values found."));
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.starts_with("Invalid timezone values:"))));
    }

    /// The invalid-timezone advisory is the only signal a researcher gets that
    /// a device wrote a timezone preprocessing cannot resolve, so it has to
    /// fire on exactly those values and stay silent on the ones it can. It
    /// reports a distinct count and never the cell text: timezone values are
    /// participant data and warnings are surfaced in the UI.
    #[test]
    fn the_invalid_timezone_advisory_names_only_timezones_chronicle_cannot_resolve() {
        let header = "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";

        let resolvable = format!(
            "{header}\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:01:00,UTC\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:02:00,Australia/Eucla"
        );
        let resolvable: Value = serde_json::from_str(&inspect_raw_file_v1(
            resolvable.as_bytes(),
            "resolvable.csv",
            resolvable.len() as f64,
        ))
        .unwrap();
        assert_eq!(
            resolvable["timezones"],
            serde_json::json!(["America/Chicago", "Australia/Eucla", "UTC"])
        );
        assert!(
            !resolvable["warnings"]
                .as_array()
                .expect("inspection warnings")
                .iter()
                .any(|warning| warning
                    .as_str()
                    .is_some_and(|text| text.starts_with("Invalid timezone values:"))),
            "a file whose every timezone parses was still advised about invalid timezones"
        );

        let unresolvable = format!(
            "{header}\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:01:00,Middle_Earth/Shire\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:02:00,GMT+25\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:03:00,Middle_Earth/Shire"
        );
        let unresolvable: Value = serde_json::from_str(&inspect_raw_file_v1(
            unresolvable.as_bytes(),
            "unresolvable.csv",
            unresolvable.len() as f64,
        ))
        .unwrap();
        let warnings = unresolvable["warnings"]
            .as_array()
            .expect("inspection warnings");
        assert!(
            warnings.iter().any(|warning| warning
                == "Invalid timezone values: 2 distinct value(s) in the timezone column."),
            "two distinct unresolvable timezones were not advised exactly once each: {warnings:?}"
        );
        for warning in warnings {
            let text = warning.as_str().expect("warning text");
            assert!(
                !text.contains("Middle_Earth") && !text.contains("GMT+25"),
                "a raw timezone cell leaked into a warning: {text}"
            );
        }
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
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("timezone"))));
        assert_eq!(present["missingTimezoneCount"], 1);
        assert_eq!(present["timezones"], serde_json::json!(["UTC"]));
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
    fn exported_build_and_workflow_contract_identities_are_not_placeholders() {
        assert_eq!(build_environment_digest(), BUILD_ENVIRONMENT_DIGEST);
        assert!(build_environment_digest().starts_with("sha256:"));
        assert_eq!(build_environment_digest().len(), 71);
        let identity: Value = serde_json::from_str(&runtime_identity_json()).unwrap();
        assert_eq!(identity["protocolVersion"], RUNTIME_PROTOCOL_VERSION);
        assert_eq!(
            identity["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert_eq!(identity["buildEnvironmentDigest"], BUILD_ENVIRONMENT_DIGEST);
        assert_eq!(
            identity["productContractDigest"],
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(identity["planDigest"], EMBEDDED_PLAN_SHA256);
        assert_eq!(identity["profileDigest"], EMBEDDED_PROFILE_SHA256);
        assert_eq!(identity["profileLockDigest"], EMBEDDED_PROFILE_LOCK_SHA256);
        assert_eq!(
            identity["runtimeAuthorityDigest"],
            EMBEDDED_RUNTIME_AUTHORITY_SHA256
        );
        assert_eq!(
            identity["dependencyCertificateDigest"],
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256
        );
        let contract: Value = serde_json::from_str(&workflow_contract_json()).unwrap();
        assert_eq!(
            contract["protocolVersion"],
            "chronicle-workflow-contract/v1"
        );
        assert_eq!(
            contract["execution"]["queries"].as_array().unwrap().len(),
            WORKFLOW_QUERIES.len()
        );
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
        let published_digest = pipeline_result_digests(&result).published_outputs_digest;
        let result_digest = compute_pipeline_result_digest(&result, &published_digest);
        assert!(result_digest.starts_with("sha256:"));
        assert_eq!(result_digest.len(), 71);
        let mut direct_digest = Sha256::new();
        let written = Sha256Writer(&mut direct_digest).write(b"abc").unwrap();
        assert_eq!(written, 3);
        assert_eq!(hex::encode(direct_digest.finalize()), sha256(b"abc")[7..]);

        let plan = embedded_plan();
        let mut cache = BTreeMap::new();
        let cold = build_runtime_query_executions(
            plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &WORKFLOW_QUERIES
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
            .query_id
            .clone();
        cache.get_mut(&applicable).unwrap().output_digest = format!("sha256:{}", "f".repeat(64));
        let error = build_runtime_query_executions(
            plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &WORKFLOW_QUERIES
                    .iter()
                    .map(|step| step.id.to_string())
                    .collect::<Vec<_>>(),
                materialize_full_outputs: true,
                previous_observations: &mut cache,
            },
        )
        .unwrap_err();
        assert!(error.contains("tracked query output changed without a changed bound input"));
        assert!(error.contains(&applicable));
    }

    #[test]
    fn dependency_evidence_requires_every_receipt_identity_field() {
        let mut certificate = embedded_dependency_certificate().clone();
        let receipt = &mut certificate.evidence.implementation_receipt;
        receipt.implementation = "chronicle_preprocessing_runtime_wasm/0.1.0".into();
        receipt.implementation_digest = IMPLEMENTATION_BUILD_DIGEST.into();
        receipt.plan_digest = EMBEDDED_PLAN_SHA256.into();
        receipt.profile_digest = EMBEDDED_PROFILE_SHA256.into();
        receipt.profile_lock_digest = EMBEDDED_PROFILE_LOCK_SHA256.into();
        receipt.runtime_authority_digest = EMBEDDED_RUNTIME_AUTHORITY_SHA256.into();
        receipt.product_contract_digest = EMBEDDED_PRODUCT_CONTRACT_SHA256.into();
        assert!(dependency_evidence_current(&certificate));

        let replacements = [
            "implementation",
            "implementation_digest",
            "plan_digest",
            "profile_digest",
            "profile_lock_digest",
            "runtime_authority_digest",
            "product_contract_digest",
        ];
        for field in replacements {
            let mut stale = certificate.clone();
            let receipt = &mut stale.evidence.implementation_receipt;
            match field {
                "implementation" => receipt.implementation.push_str("-stale"),
                "implementation_digest" => receipt.implementation_digest.push_str("-stale"),
                "plan_digest" => receipt.plan_digest.push_str("-stale"),
                "profile_digest" => receipt.profile_digest.push_str("-stale"),
                "profile_lock_digest" => receipt.profile_lock_digest.push_str("-stale"),
                "runtime_authority_digest" => receipt.runtime_authority_digest.push_str("-stale"),
                "product_contract_digest" => receipt.product_contract_digest.push_str("-stale"),
                _ => unreachable!(),
            }
            assert!(
                !dependency_evidence_current(&stale),
                "a stale {field} must disable certified narrow reuse"
            );
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

    #[test]
    fn stable_artifact_cache_is_bounded_before_bytes_are_shared() {
        assert_eq!(MAX_STABLE_ARTIFACT_CACHE_BYTES, 33_554_432);
        let small = runtime_artifact("small", "application/octet-stream", vec![1, 2, 3], vec![]);
        assert!(stable_artifacts_fit_cache(
            std::slice::from_ref(&small),
            &[]
        ));
        let mut oversized = small;
        oversized.metadata.size = MAX_STABLE_ARTIFACT_CACHE_BYTES + 1;
        assert!(!stable_artifacts_fit_cache(&[oversized], &[]));
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
        assert_eq!(
            review_manifest.query_executions.len(),
            WORKFLOW_QUERIES.len()
        );
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

    /// A review never materializes artifacts, so it is the only command whose
    /// query-group projection is served from the previous run's cache when a
    /// stage's inputs did not change. That cache is only sound if the stage
    /// view it serves is the one a cold review of the same options reports —
    /// the workflow explorer view is the evidence a researcher reads to see which part of
    /// the pipeline an option touched, and a stale entry there is a false
    /// claim about the run. Status and reason differ by construction (a warm
    /// run reports what it reused); identity, key and output must not.
    #[test]
    fn a_warm_review_after_an_option_edit_projects_the_stages_a_cold_review_reports() {
        reset_tracked_execution_count();
        // The plain `csv()` fixture carries only unrecognized interaction
        // types, so it produces no sessions and no duration option can move
        // its output. This fixture has two 60 s Resumed/Paused pairs.
        let csv = mixed_timezone_csv();
        let support = RuntimeSupportFiles::default();

        let mut first_request = request_for_workspace(&csv, '3');
        first_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let first = execute_workspace_native(&first_request.to_string(), &csv, &support).unwrap();
        let first: ReviewRuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();

        // 90 s raises the floor above both 60 s sessions in the fixture, so the
        // edit moves the summary as well as the keys. An edit that only moved
        // keys would leave a stale cached stage output indistinguishable from a
        // fresh one.
        let mut edited_request = first_request.clone();
        edited_request["requestId"] = Value::String("warm-review-after-edit".into());
        edited_request["options"]["minimum_usage_duration"] = serde_json::json!(90.0);
        let warm = execute_workspace_native(&edited_request.to_string(), &csv, &support).unwrap();
        let warm: ReviewRuntimeManifest = serde_json::from_str(&warm.manifest_json).unwrap();

        let mut cold_request = request_for_workspace(&csv, '4');
        cold_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        cold_request["requestId"] = Value::String("cold-review-oracle".into());
        cold_request["options"]["minimum_usage_duration"] = serde_json::json!(90.0);
        let cold = execute_workspace_native(&cold_request.to_string(), &csv, &support).unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();

        assert!(
            warm.query_group_executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Cached),
            "the warm review recomputed every stage, so it never exercised the projection cache"
        );
        assert_ne!(
            warm.review_summary_digest, first.review_summary_digest,
            "the option edit left the review summary unchanged, so a stale stage output would be invisible"
        );
        assert_eq!(warm.review_summary_digest, cold.review_summary_digest);

        // Steps first: a query's bound-input key is the primitive fact, and a
        // stage key is built from its members', so a query disagreement is the
        // smaller and more exact report.
        fn query_identity(executions: &[RuntimeQueryExecution]) -> Vec<(&str, &str, &str, &str)> {
            executions
                .iter()
                .map(|execution| {
                    (
                        execution.query_id.as_str(),
                        execution.query_group_id.as_str(),
                        execution.input_key.as_str(),
                        execution.output_digest.as_str(),
                    )
                })
                .collect::<Vec<_>>()
        }
        let warm_queries = query_identity(&warm.query_executions);
        let cold_queries = query_identity(&cold.query_executions);
        let disagreeing_queries = warm_queries
            .iter()
            .zip(cold_queries.iter())
            .filter(|(warm_step, cold_step)| warm_step != cold_step)
            .collect::<Vec<_>>();
        assert_eq!(
            warm_queries.len(),
            cold_queries.len(),
            "a warm review reported a different number of queries than a cold review"
        );
        assert!(
            disagreeing_queries.is_empty(),
            "a warm review reported query bindings a cold review of the same options does not: {disagreeing_queries:#?}"
        );

        type StageIdentity<'a> = (&'a str, &'a str, &'a str, Option<(&'a str, &'a str, u64)>);
        fn stage_identity(executions: &[QueryGroupExecution]) -> Vec<StageIdentity<'_>> {
            executions
                .iter()
                .map(|execution| {
                    (
                        execution.query_group_id.as_str(),
                        execution.capability_id.as_str(),
                        execution.input_key.as_str(),
                        execution.output.as_ref().map(|output| {
                            (
                                output.artifact_id.as_str(),
                                output.digest.as_str(),
                                output.size,
                            )
                        }),
                    )
                })
                .collect::<Vec<_>>()
        }
        let warm_stages = stage_identity(&warm.query_group_executions);
        let cold_stages = stage_identity(&cold.query_group_executions);
        let disagreeing_stages = warm_stages
            .iter()
            .zip(cold_stages.iter())
            .filter(|(warm_stage, cold_stage)| warm_stage != cold_stage)
            .collect::<Vec<_>>();
        assert_eq!(
            warm_stages.len(),
            cold_stages.len(),
            "a warm review reported a different number of query groups than a cold review"
        );
        assert!(
            disagreeing_stages.is_empty(),
            "a warm review projected query groups a cold review of the same options does not: {disagreeing_stages:#?}"
        );
    }

    #[test]
    fn review_reuses_client_summary_when_known_digest_matches() {
        let csv = csv();
        let mut review_request = request_for_workspace(&csv, 'e');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let mut first = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&first.manifest_json).unwrap();
        assert!(!first_manifest.review_summary_reused);
        assert_eq!(first.artifact_count(), 1);
        let first_bytes = first.take_artifact_bytes(0).unwrap();
        assert_eq!(sha256(&first_bytes), first_manifest.review_summary_digest);

        // Same options + the digest the client already holds: manifest only.
        let mut repeat = review_request.clone();
        repeat["knownReviewSummaryDigests"] = serde_json::json!([
            format!("sha256:{}", "1".repeat(64)),
            first_manifest.review_summary_digest.clone(),
        ]);
        let reused =
            execute_workspace_native(&repeat.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let reused_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&reused.manifest_json).unwrap();
        assert!(reused_manifest.review_summary_reused);
        assert_eq!(reused.artifact_count(), 0);
        assert_eq!(
            reused_manifest.review_summary_digest,
            first_manifest.review_summary_digest
        );

        // A stale digest must still receive the real bytes.
        let mut stale = review_request.clone();
        stale["knownReviewSummaryDigests"] =
            serde_json::json!([format!("sha256:{}", "0".repeat(64))]);
        let mut fresh =
            execute_workspace_native(&stale.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let fresh_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&fresh.manifest_json).unwrap();
        assert!(!fresh_manifest.review_summary_reused);
        assert_eq!(fresh.artifact_count(), 1);
        assert_eq!(fresh.take_artifact_bytes(0).unwrap(), first_bytes);
    }

    /// Warm interactive-loop attribution through the FULL runtime envelope
    /// (request parse -> ingress -> cache decision -> engine -> manifest) on a
    /// real raw export, mirroring the view tab's repeated settings edits:
    ///   CHRONICLE_ATTR_CSV=/path/to/raw.csv \
    ///   cargo test --release --features query-timing \
    ///     warm_review_repeat_attribution_from_csv -- --ignored --nocapture
    #[test]
    #[ignore]
    fn warm_review_repeat_attribution_from_csv() {
        let path = std::env::var("CHRONICLE_ATTR_CSV")
            .expect("set CHRONICLE_ATTR_CSV to a raw Chronicle export");
        let csv = std::fs::read(&path).expect("read CHRONICLE_ATTR_CSV");
        let mut review_request = request_for_workspace(&csv, 'c');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        review_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        review_request["options"]["minimum_usage_duration"] = serde_json::json!(60.0);
        eprintln!(
            "attribution_phase=warm_build file={path} bytes={}",
            csv.len()
        );
        let started = std::time::Instant::now();
        let mut first = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: Value = serde_json::from_str(&first.manifest_json).unwrap();
        eprintln!(
            "attribution_total warm_build_ms={:.1} review_summary_bytes={} cache_decision={} cache_sources={}",
            started.elapsed().as_secs_f64() * 1000.0,
            first.take_artifact_bytes(0).unwrap().len(),
            manifest["dependency_cache_decision"]["mode"],
            manifest["cache_sources"],
        );
        for (case, key, values) in [
            (
                "narrow_minimum_usage_duration",
                "minimum_usage_duration",
                vec![
                    serde_json::json!(2.0),
                    serde_json::json!(3.0),
                    serde_json::json!(4.0),
                ],
            ),
            (
                "heavy_concurrent_usage_toggle",
                "model_concurrent_usage",
                vec![Value::Bool(false), Value::Bool(true), Value::Bool(false)],
            ),
        ] {
            for (step, value) in values.into_iter().enumerate() {
                let mut repeat = review_request.clone();
                repeat["options"][key] = value;
                eprintln!("attribution_phase=warm_repeat case={case} step={step}");
                let started = std::time::Instant::now();
                execute_workspace_native(
                    &repeat.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                eprintln!(
                    "attribution_total case={case} warm_repeat_step={step} total_ms={:.1}",
                    started.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
    }

    #[test]
    fn correspondence_predicates_keep_outputs_and_traces_exact() {
        assert!(is_researcher_output_kind("app-csv"));
        assert!(is_researcher_output_kind("aggregate-daily-csv"));
        assert!(!is_researcher_output_kind("workflow-explorer-view-json"));

        let plan = embedded_plan();
        let assignment = RoleAssignment {
            assignment_id: "assignment-raw".into(),
            role_id: "raw_chronicle_csv".into(),
            artifact: chronicle_preprocessing_semantic_adapter::ArtifactRef {
                artifact_id: "artifact-raw".into(),
                digest: format!("sha256:{}", "a".repeat(64)),
                media_type: "text/csv".into(),
                size: 1,
                derived_from: Vec::new(),
                qualifiers: BTreeMap::new(),
            },
            qualifiers: BTreeMap::new(),
            revision: 1,
        };
        let assignments = BTreeMap::from([(assignment.role_id.clone(), assignment.clone())]);
        let mut materialization =
            chronicle_preprocessing_semantic_adapter::evaluate_materialization(
                plan,
                &assignments,
                &serde_json::json!({}),
                &BTreeSet::new(),
                &BTreeSet::new(),
            );
        let mut mismatched = materialization
            .qualification_traces
            .first()
            .expect("raw qualification trace")
            .clone();
        mismatched.selected_role_id = Some("processing_options".into());
        materialization.qualification_traces = vec![mismatched];

        let index: Value = serde_json::from_slice(
            &build_correspondence_index(CorrespondenceIndexInputs {
                plan,
                assignments: &assignments,
                materialization: &materialization,
                query_group_executions: &[],
                options: &serde_json::json!({}),
                artifacts: &[],
                checkpoints: &BTreeMap::new(),
                query_checkpoints: &BTreeMap::new(),
            })
            .unwrap(),
        )
        .unwrap();
        let qualified = index["edges"]
            .as_array()
            .unwrap()
            .iter()
            .find(|edge| edge["relation"] == "qualified-as")
            .expect("qualified-as edge");
        assert!(
            qualified["evidenceIds"].as_array().unwrap().is_empty(),
            "a trace matching only the candidate, not the selected role, is not evidence"
        );
    }

    #[test]
    fn pre_run_workflow_explorer_view_is_rust_owned_complete_and_has_no_fake_execution() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let explorer_request = serde_json::json!({
            "options": request_value["options"],
            "supportRoles": [],
        });
        let view: Value = serde_json::from_str(
            &plan_workflow_explorer_view_native(&explorer_request.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(view["viewId"], "chronicle-workflow-explorer/v1");
        assert_eq!(view["revision"], 0);
        assert!(!view["phases"].as_array().unwrap().is_empty());
        assert!(!view["operations"].as_array().unwrap().is_empty());
        assert!(!view["artifacts"].as_array().unwrap().is_empty());
        assert!(!view["queries"].as_array().unwrap().is_empty());
        assert!(view["queries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|query| query["physicalState"] == "not_observed"));
        assert!(view["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation["runState"] == "not_applicable"));
        assert!(view["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation["runState"] == "not_observed"));
        let filter_impact = view["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|impact| impact["inputId"] == "use_filter_file")
            .expect("filter decision impact");
        assert_eq!(
            filter_impact["directQueryIds"],
            serde_json::json!(["mark_app_policy_matches"])
        );
        let affected = filter_impact["affectedOperationIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>();
        assert!(affected.contains("policy.match_app_exclusion_rows"));
        assert!(!affected.contains("reconstruct.infer_screen_session_skeletons"));
        assert!(!affected.contains("reconstruct.index_app_events"));
        assert!(!affected.contains("reconstruct.match_app_episodes"));

        let parquet_impact = view["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|impact| impact["inputId"] == "enable_parquet_export")
            .expect("runtime encoder decision impact");
        assert!(parquet_impact["directQueryIds"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(parquet_impact["affectedOperationIds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation == "publish.encode_selected_formats"));
    }

    #[test]
    fn workflow_applicability_and_explorer_projection_are_exact() {
        let options = serde_json::json!({
            "enabled": true,
            "disabled": false,
            "mode": "app",
            "items": [1],
            "emptyItems": [],
            "text": "value",
            "blank": "",
        });
        let supports = BTreeSet::from(["filter_file"]);
        let cases = [
            (ApplicabilityExpression::Always, true),
            (
                ApplicabilityExpression::OptionTrue {
                    option_key: "enabled",
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionTrue {
                    option_key: "disabled",
                },
                false,
            ),
            (
                ApplicabilityExpression::OptionBooleanEquals {
                    option_key: "disabled",
                    value: false,
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionBooleanEquals {
                    option_key: "enabled",
                    value: false,
                },
                false,
            ),
            (
                ApplicabilityExpression::OptionStringEquals {
                    option_key: "mode",
                    value: "app",
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionStringEquals {
                    option_key: "mode",
                    value: "screen",
                },
                false,
            ),
            (
                ApplicabilityExpression::ArrayNonempty {
                    option_key: "items",
                },
                true,
            ),
            (
                ApplicabilityExpression::ArrayNonempty {
                    option_key: "emptyItems",
                },
                false,
            ),
            (
                ApplicabilityExpression::StringNonempty { option_key: "text" },
                true,
            ),
            (
                ApplicabilityExpression::StringNonempty {
                    option_key: "blank",
                },
                false,
            ),
            (
                ApplicabilityExpression::SupportPresent {
                    role_id: "filter_file",
                },
                true,
            ),
            (
                ApplicabilityExpression::SupportPresent {
                    role_id: "study_dates_file",
                },
                false,
            ),
            (
                ApplicabilityExpression::All {
                    terms: vec![
                        ApplicabilityExpression::Always,
                        ApplicabilityExpression::OptionTrue {
                            option_key: "enabled",
                        },
                    ],
                },
                true,
            ),
            (
                ApplicabilityExpression::Any {
                    terms: vec![
                        ApplicabilityExpression::OptionTrue {
                            option_key: "disabled",
                        },
                        ApplicabilityExpression::SupportPresent {
                            role_id: "filter_file",
                        },
                    ],
                },
                true,
            ),
            (
                ApplicabilityExpression::Not {
                    term: Box::new(ApplicabilityExpression::OptionTrue {
                        option_key: "disabled",
                    }),
                },
                true,
            ),
        ];
        for (expression, expected) in cases {
            assert_eq!(
                evaluate_workflow_applicability(&expression, &options, &supports),
                expected,
                "{expression:?}",
            );
        }
        let always = ApplicabilityExpression::Always;
        let disabled = ApplicabilityExpression::OptionTrue {
            option_key: "disabled",
        };
        let phase_operations = [("other", &always), ("target", &disabled)];
        assert!(!workflow_phase_applicable(
            "target",
            phase_operations,
            &options,
            &supports,
        ));
        let enabled = ApplicabilityExpression::OptionTrue {
            option_key: "enabled",
        };
        assert!(workflow_phase_applicable(
            "target",
            [("target", &enabled)],
            &options,
            &supports,
        ));
        assert!(is_workflow_support_role("raw_chronicle_csv"));
        assert!(!is_workflow_support_role("processing_options"));

        let csv = csv();
        let request_value = request_for_workspace(&csv, '1');
        let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
        let statuses = [
            ExecutionStatus::Recomputed,
            ExecutionStatus::Cached,
            ExecutionStatus::Skipped,
            ExecutionStatus::Bypassed,
            ExecutionStatus::Error,
        ];
        let executions = contract
            .execution
            .queries
            .iter()
            .enumerate()
            .map(|(index, query)| RuntimeQueryExecution {
                query_id: query.id.into(),
                query_group_id: query.group.into(),
                status: statuses[index % statuses.len()],
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        let view = build_workflow_explorer_view(
            &WorkflowExplorerRequest {
                options: request_value["options"].clone(),
                support_roles: vec![WorkflowExplorerSupportRole {
                    role_id: "filter_file".into(),
                    present: true,
                    digest: Some(format!("sha256:{}", "4".repeat(64))),
                }],
                selected_run_root: None,
            },
            &executions,
            99,
            Some(&format!("sha256:{}", "a".repeat(64))),
        )
        .unwrap();
        let bytes = serde_jcs::to_vec(&view).unwrap();
        assert_eq!(
            sha256(&bytes),
            "sha256:89d68bb7258fb94b7b92383a2b6b5c6f2351ac7ef18ab01ee45483f458883467"
        );
    }

    fn assert_sha256_identity(value: &str) {
        let hexadecimal = value.strip_prefix("sha256:").expect("sha256 prefix");
        assert_eq!(hexadecimal.len(), 64);
        assert!(hexadecimal.bytes().all(|byte| byte.is_ascii_hexdigit()));
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
        let source_index = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-coordinate-index-arrow")
            .unwrap();
        let influence = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-result-influence-arrow")
            .unwrap();
        let canonical_bytes = manifest
            .artifacts
            .iter()
            .filter(|artifact| is_canonical_cell_output_kind(&artifact.kind))
            .map(|artifact| artifact.size)
            .sum::<u64>();
        assert!(cell_index.row_count.unwrap() > manifest.counts.app);
        assert!(influence.row_count.unwrap() > manifest.counts.original);
        assert!(
            cell_index.size <= canonical_bytes.saturating_mul(3) + 65_536,
            "cell index {} bytes exceeded bounded ratio for {} canonical bytes",
            cell_index.size,
            canonical_bytes,
        );
        assert!(
            influence.size <= canonical_bytes + 65_536,
            "normalized influence witness {} bytes exceeded bounded ratio for {} canonical bytes",
            influence.size,
            canonical_bytes,
        );
        eprintln!(
            "representative-result-cell-index input_rows={} app_rows={} source_rows={} cell_rows={} witness_rows={} canonical_bytes={} source_index_bytes={} cell_index_bytes={} witness_bytes={} cell_ratio={:.3} witness_to_index_ratio={:.3}",
            manifest.counts.original,
            manifest.counts.app,
            source_index.row_count.unwrap(),
            cell_index.row_count.unwrap(),
            influence.row_count.unwrap(),
            canonical_bytes,
            source_index.size,
            cell_index.size,
            influence.size,
            cell_index.size as f64 / canonical_bytes as f64,
            influence.size as f64 / (source_index.size + cell_index.size) as f64,
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
            if dependency_evidence_current(embedded_dependency_certificate()) {
                chronicle_preprocessing_semantic_adapter::DependencyCacheMode::CertifiedNarrow
            } else {
                chronicle_preprocessing_semantic_adapter::DependencyCacheMode::ConservativeFull
            }
        );
        if dependency_evidence_current(embedded_dependency_certificate()) {
            assert!(manifest
                .dependency_cache_decision
                .reasons
                .contains(&"dependency_surface_structurally_certified".into()));
        } else {
            assert!(manifest
                .dependency_cache_decision
                .reasons
                .contains(&"empirical_dependency_evidence_stale_release_blocking".into()));
        }
        assert_eq!(
            manifest.product_contract_digest,
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(manifest.build_environment_digest, BUILD_ENVIRONMENT_DIGEST);
        assert_eq!(manifest.query_executions.len(), WORKFLOW_QUERIES.len());
        assert_eq!(
            manifest
                .query_executions
                .iter()
                .map(|execution| execution.query_id.as_str())
                .collect::<BTreeSet<_>>(),
            WORKFLOW_QUERIES
                .iter()
                .map(|step| step.id)
                .collect::<BTreeSet<_>>()
        );
        assert!(manifest.query_executions.iter().all(|execution| {
            manifest
                .processing_summary
                .workflow_query_digests
                .get(&execution.query_id)
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
        for assignment in &manifest.role_assignments {
            assert_sha256_identity(&assignment.assignment_id);
        }
        assert_eq!(
            manifest.query_group_executions.len(),
            embedded_plan().query_groups.len()
        );
        for execution in &manifest.query_group_executions {
            assert_sha256_identity(&execution.reason_id);
        }
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
        let dependency_kinds = manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                correspondence_artifact
                    .derived_from
                    .contains(&artifact.digest)
            })
            .map(|artifact| artifact.kind.as_str())
            .collect::<BTreeSet<_>>();
        assert!(dependency_kinds.contains("node-output:outputs"));
        assert!(dependency_kinds.contains("app-csv"));
        assert!(dependency_kinds.contains("source-coordinate-index-arrow"));
        assert!(dependency_kinds.contains("result-cell-correspondence-arrow"));
        assert!(dependency_kinds.contains("source-result-influence-arrow"));
        assert!(!dependency_kinds.contains("workflow-explorer-view-json"));
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
        let mut workflow_explorer_value = None;
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
            } else if metadata.kind == "workflow-explorer-view-json" {
                workflow_explorer_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
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
        assert_eq!(
            ledger.as_array().unwrap().len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            ledger
                .as_array()
                .unwrap()
                .iter()
                .map(|unit| unit["queries"].as_array().unwrap().len())
                .sum::<usize>(),
            WORKFLOW_QUERIES.len()
        );
        assert!(kinds.contains("workflow-explorer-view-json"));
        assert!(kinds.contains("artifact-view-json"));
        assert!(kinds.contains("obligation-view-json"));
        assert!(kinds.contains("explanation-view-json"));
        assert!(kinds.contains("workspace-root-json"));
        assert!(kinds.contains("semantic-profile-lock-json"));
        assert!(kinds.contains("semantic-index-source-json"));
        assert!(kinds.contains("workflow-provenance-jsonld"));
        assert!(kinds.contains("correspondence-index-json"));
        assert!(kinds.contains("artifact-closure-json"));
        assert!(kinds.contains("row-lineage-arrow"));
        assert!(kinds.contains("result-cell-correspondence-arrow"));
        assert!(kinds.contains("source-coordinate-index-arrow"));
        assert!(kinds.contains("source-result-influence-arrow"));
        assert!(!kinds.iter().any(|kind| kind.starts_with("ingress:")));
        assert_eq!(
            kinds
                .iter()
                .filter(|kind| kind.starts_with("node-output:"))
                .count(),
            embedded_plan().query_groups.len()
        );
        let workflow_explorer_value = workflow_explorer_value.unwrap();
        assert_eq!(
            workflow_explorer_value["revision"],
            (manifest.role_assignments.len()
                + manifest.query_group_executions.len()
                + manifest.query_executions.len()) as u64
        );
        assert!(
            workflow_explorer_value["phases"]
                .as_array()
                .unwrap()
                .iter()
                .any(|phase| phase["phaseId"] == "create_deliverables"),
            "{}",
            workflow_explorer_value
        );
        assert!(workflow_explorer_value["queries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|query| query["physicalState"] == "executed"));
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
            "chronicle-correspondence-index/v4"
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
            correspondence_value["influenceWitnessArtifactKind"],
            "source-result-influence-arrow"
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
                edge["sourceKind"] == "configuration-value"
                    && edge["targetKind"] == "workflow-query-group"
            })
            .collect::<Vec<_>>();
        let declared_knob_count = embedded_plan()
            .query_groups
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
            let query_group_id = edge["targetId"].as_str().unwrap();
            let relation = edge["relation"].as_str().unwrap();
            assert!(embedded_plan().query_groups.iter().any(|node| {
                node.query_group_id == query_group_id
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
        let influence_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-result-influence-arrow")
            .unwrap()
            .digest;
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "workflow-query-group"
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
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *source_index_digest
                && edge["relation"] == "supplies-source-coordinates-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "supplies-result-coordinates-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *row_index_digest
                && edge["relation"] == "supplies-conservative-row-witnesses-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "conservative"
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
                .query_group_executions
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
        assert!(first.query_group_executions.iter().all(|execution| {
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
        assert!(warm.query_group_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Cached | ExecutionStatus::Bypassed
                )
        }));
        assert_eq!(warm.query_executions.len(), WORKFLOW_QUERIES.len());
        assert!(warm.query_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed
        )));
        // Reusing a cached stage projection is a reporting shortcut, never a
        // licence to publish less. Evidence artifacts (the ledger, journal,
        // workflow explorer view, workspace root) legitimately differ between the two
        // runs because they describe the run itself; every query-group
        // output must be republished byte for byte, or the second run of the
        // same request hands the user a shorter download list than the first.
        fn stage_outputs(manifest: &RuntimeManifest) -> BTreeSet<(&str, &str, u64)> {
            manifest
                .artifacts
                .iter()
                .filter(|artifact| artifact.kind.starts_with("node-output:"))
                .map(|artifact| {
                    (
                        artifact.kind.as_str(),
                        artifact.digest.as_str(),
                        artifact.size,
                    )
                })
                .collect::<BTreeSet<_>>()
        }
        assert_eq!(
            stage_outputs(&first).len(),
            first.query_group_executions.len(),
            "the cold run did not publish one output artifact per query group"
        );
        assert_eq!(
            stage_outputs(&warm),
            stage_outputs(&first),
            "a warm repeat of the same request stopped publishing query-group outputs"
        );
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
        let warm_ledger_queries = warm_ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["queries"].as_array().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(warm_ledger_queries.len(), WORKFLOW_QUERIES.len());
        assert!(warm_ledger_queries.iter().all(|query| {
            matches!(query["status"].as_str(), Some("cached" | "bypassed"))
                && query["inputKey"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && query["outputDigest"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && query["reasonId"]
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
            warm.query_group_executions
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
                .query_group_executions
                .iter()
                .map(|execution| (
                    &execution.query_group_id,
                    execution.status,
                    &execution.input_key
                ))
                .collect::<Vec<_>>()
        );
        assert_eq!(stable_artifact_generation_count(), 2);
        let recomputed: BTreeSet<_> = changed
            .query_group_executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect();
        let evidence_current = dependency_evidence_current(embedded_dependency_certificate());
        if evidence_current {
            assert_eq!(recomputed, BTreeSet::from(["day_coverage", "outputs"]));
        } else {
            assert!(recomputed.contains("day_coverage"));
            assert!(recomputed.contains("outputs"));
            assert!(recomputed.contains("parse_events"));
        }
        assert_eq!(
            changed
                .query_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Recomputed)
                .map(|execution| execution.query_id.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["build_participant_day_coverage", "assemble_result_manifest"])
        );
        assert_eq!(
            changed
                .query_group_executions
                .iter()
                .find(|execution| execution.query_group_id == "parse_events")
                .unwrap()
                .status,
            if evidence_current {
                ExecutionStatus::Cached
            } else {
                ExecutionStatus::Recomputed
            }
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
            .query_executions
            .iter()
            .map(|execution| (execution.query_id.as_str(), execution))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            by_id["match_app_episodes"].status,
            ExecutionStatus::Recomputed
        );
        assert_eq!(
            by_id["decode_source_records"].status,
            ExecutionStatus::Cached
        );
        assert_ne!(
            by_id["match_app_episodes"].input_key,
            initial
                .query_executions
                .iter()
                .find(|execution| execution.query_id == "match_app_episodes")
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
            changed.processing_summary.workflow_query_digests,
            cold.processing_summary.workflow_query_digests
        );
        assert_eq!(
            changed.processing_summary.workflow_query_checkpoints,
            cold.processing_summary.workflow_query_checkpoints
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
            .query_executions
            .iter()
            .map(|execution| (execution.query_id.as_str(), execution.status))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            by_id["bind_processing_timestamp"],
            ExecutionStatus::Recomputed
        );
        assert_eq!(by_id["validate_remap_rules"], ExecutionStatus::Cached);
        assert_eq!(by_id["decode_source_records"], ExecutionStatus::Cached);
        assert_eq!(
            by_id["assemble_result_manifest"],
            ExecutionStatus::Recomputed
        );
    }

    #[test]
    fn query_group_output_artifacts_publish_their_exact_checkpoint() {
        reset_tracked_execution_count();
        let csv = csv();
        let request = request_for_workspace(&csv, 'a');
        let mut handle =
            execute_workspace_native(&request.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(
            manifest
                .processing_summary
                .workflow_query_group_digests
                .len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            manifest
                .processing_summary
                .workflow_query_group_checkpoints
                .len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            manifest.processing_summary.workflow_query_digests.len(),
            WORKFLOW_QUERIES.len()
        );
        assert_eq!(
            manifest.processing_summary.workflow_query_checkpoints.len(),
            WORKFLOW_QUERIES.len()
        );
        for (query_id, checkpoint) in &manifest.processing_summary.workflow_query_checkpoints {
            assert_eq!(&checkpoint.subject_id, query_id);
            assert_eq!(
                manifest
                    .processing_summary
                    .workflow_query_digests
                    .get(query_id),
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
                "chronicle-workflow-checkpoint/v1"
            );
            assert_eq!(
                fingerprint["typedCheckpoint"]["subjectId"],
                fingerprint["workflowQueryGroupId"]
            );
            assert_eq!(
                fingerprint["physicalExecution"],
                "salsa-tracked-rust-pipeline-v2"
            );
            published.insert(
                fingerprint["workflowQueryGroupId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                fingerprint["semanticOutputDigest"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        assert_eq!(published.len(), embedded_plan().query_groups.len());
        for (node, digest) in &manifest.processing_summary.workflow_query_group_digests {
            if node != "outputs" {
                assert_eq!(published.get(node), Some(digest), "checkpoint for {node}");
            }
        }
        assert_eq!(
            published.values().collect::<BTreeSet<_>>().len(),
            embedded_plan().query_groups.len(),
            "node identity must keep converged/empty stage values distinct"
        );
    }

    #[test]
    fn incremental_workspace_cache_is_bounded() {
        reset_tracked_execution_count();
        let csv = csv();
        for index in 0..(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES + 3) {
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
            assert_eq!(
                states.borrow().states.len(),
                DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES
            );
        });
        assert_eq!(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES, 1);
    }

    #[test]
    fn set_capacity_raises_and_compacts_state_cache() {
        reset_tracked_execution_count();
        let csv = csv();
        set_comparison_cache_capacity(4);
        for index in 0..4 {
            let marker = char::from_digit(index as u32, 10).unwrap();
            let request_value = request_for_workspace(&csv, marker);
            execute_workspace_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
        }
        assert_eq!(get_comparison_cache_retained(), 4);
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            states.borrow_mut().compact_all();
            let cache = states.borrow();
            assert_eq!(cache.retained_count(), 4);
            for state in cache.states.values() {
                assert!(state.stable_artifact_bundle.is_none());
                assert!(state.previous_stage_outputs.is_empty());
            }
        });
        set_comparison_cache_capacity(2);
        assert_eq!(get_comparison_cache_retained(), 2);
        set_comparison_cache_capacity(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES);
        assert_eq!(get_comparison_cache_retained(), 1);
    }

    /// A warm review resumes from Salsa state already in this worker instead
    /// of reparsing the input. Both halves of that claim have to hold: the
    /// workspace must be at the root the request expects, and the engine must
    /// already have verified *this* input. Accepting either one alone would
    /// resume a review against a digest the engine never parsed.
    #[test]
    fn a_warm_review_needs_the_workspace_root_and_the_verified_input_together() {
        let mut cache = IncrementalRuntimeStateCache::default();
        let workspace = "warm-review-workspace";
        let root = format!("sha256:{}", "a".repeat(64));
        let input = format!("sha256:{}", "b".repeat(64));
        cache.state_for(workspace).last_workspace_root = Some(root.clone());

        assert!(
            !cache.has_warm_review_input(workspace, Some(root.as_str()), &input),
            "a matching workspace root alone claimed a warm review input the engine never verified"
        );
        assert!(
            !cache.has_warm_review_input(workspace, Some("sha256:other"), &input),
            "a workspace at a different root claimed a warm review input"
        );
        assert!(
            !cache.has_warm_review_input(workspace, None, &input),
            "a request carrying no workspace root claimed a warm review input"
        );
        assert!(
            !cache.has_warm_review_input("unknown-workspace", Some(root.as_str()), &input),
            "a workspace with no state at all claimed a warm review input"
        );
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
            .query_group_executions
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
            .query_executions
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
        assert!(second.query_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed | ExecutionStatus::Skipped
        )));
    }

    #[test]
    fn persisted_review_base_reenters_a_fresh_runtime_without_result_drift() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut full_request = request_for_workspace(&csv, '9');
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
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
        let reconstruction_base_index = (0..full.artifact_count())
            .find(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(*index).unwrap()).unwrap();
                metadata.kind == "reconstruction-base"
                    && metadata.media_type
                        == "application/vnd.chronicle.reconstruction-base+postcard+lz4"
            })
            .expect("full execution reconstruction base");
        let reconstruction_base = full.take_artifact_bytes(reconstruction_base_index).unwrap();
        assert!(!reconstruction_base.is_empty());

        let mut review_request = full_request;
        review_request["requestId"] = Value::String("cached-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(full_manifest.workspace_root_digest.clone());
        review_request["options"]["minimum_usage_duration"] = Value::from(120.0);

        reset_tracked_execution_count();
        let cached = execute_workspace_native_with_review_bases(
            &review_request.to_string(),
            &csv,
            &review_base,
            &reconstruction_base,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cached: ReviewRuntimeManifest = serde_json::from_str(&cached.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert_eq!(cached.cache_sources, ["verified-reconstruction-base"]);
        assert_eq!(
            cached
                .query_executions
                .iter()
                .find(|execution| execution.query_id == "decode_source_records")
                .unwrap()
                .status,
            ExecutionStatus::Cached
        );
        for query_id in [
            "match_app_episodes",
            "materialize_candidate_episodes",
            "segment_concurrent_usage",
        ] {
            assert_eq!(
                cached
                    .query_executions
                    .iter()
                    .find(|execution| execution.query_id == query_id)
                    .unwrap()
                    .status,
                ExecutionStatus::Cached,
                "persisted reconstruction did not reuse {query_id}"
            );
        }

        reset_tracked_execution_count();
        review_request["requestId"] = Value::String("cold-review".into());
        let cold = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert!(cold.cache_sources.is_empty());
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
    fn prepared_review_transfers_only_the_rust_selected_full_base() {
        let csv = csv();
        let mut full_request = request_for_workspace(&csv, '2');
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut review_base = None;
        let mut reconstruction_base = None;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            match metadata.kind.as_str() {
                "review-base" => review_base = Some(full.take_artifact_bytes(index).unwrap()),
                "reconstruction-base" => {
                    reconstruction_base = Some(full.take_artifact_bytes(index).unwrap())
                }
                _ => {}
            }
        }
        let review_base = review_base.unwrap();
        let reconstruction_base = reconstruction_base.unwrap();
        let review_probe_bytes = PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
        let reconstruction_probe_bytes =
            PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();
        assert_eq!(
            serde_json::from_str::<Value>(&review_base_probe_spec_json()).unwrap(),
            serde_json::json!({
                "reviewBaseBytes": review_probe_bytes,
                "reconstructionBaseBytes": reconstruction_probe_bytes,
            })
        );

        let mut review_request = full_request.clone();
        review_request["requestId"] = Value::String("prepared-reconstruction-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] = Value::Null;
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "3".repeat(64)));
        review_request["options"]["minimum_usage_duration"] = Value::from(120.0);
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        let persisted_prepared = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut prepared = prepare_review_from_prepared(
            persisted_prepared,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(prepared.required_base_kind(), "reconstruction-base");
        assert!(prepared
            .execute_selected_base_native(review_base.clone())
            .err()
            .unwrap()
            .contains("selected reconstruction base"));
        let cached = prepared
            .execute_selected_base_native(reconstruction_base.clone())
            .unwrap();
        let cached: ReviewRuntimeManifest = serde_json::from_str(&cached.manifest_json).unwrap();
        assert_eq!(cached.cache_sources, ["verified-reconstruction-base"]);
        assert_eq!(cached.query_executions.len(), WORKFLOW_QUERIES.len());
        assert!(prepared
            .execute_selected_base_native(reconstruction_base.clone())
            .err()
            .unwrap()
            .contains("already executed"));

        review_request["requestId"] = Value::String("prepared-warm-review".into());
        review_request["options"]["minimum_usage_duration"] = Value::from(121.0);
        let warm_prepared = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut warm = prepare_review_from_prepared(
            warm_prepared,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(warm.required_base_kind(), "salsa-memory");
        assert!(warm
            .execute_selected_base_native(review_base.clone())
            .err()
            .unwrap()
            .contains("must not receive"));
        let warm_result = warm.execute_selected_base_native(Vec::new()).unwrap();
        let warm_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&warm_result.manifest_json).unwrap();
        assert_eq!(warm_manifest.cache_sources, ["salsa-memory"]);
        assert_eq!(warm_manifest.query_executions.len(), WORKFLOW_QUERIES.len());

        review_request["requestId"] = Value::String("prepared-review-only".into());
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "4".repeat(64)));
        review_request["options"]["model_concurrent_usage"] = Value::Bool(false);
        let persisted_review_only = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut review_only = prepare_review_from_prepared(
            persisted_review_only,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(review_only.required_base_kind(), "review-base");
        let review_only_result = review_only
            .execute_selected_base_native(review_base.clone())
            .unwrap();
        let review_only_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review_only_result.manifest_json).unwrap();
        assert_eq!(review_only_manifest.cache_sources, ["verified-review-base"]);

        review_request["requestId"] = Value::String("prepared-cold".into());
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "5".repeat(64)));
        review_request["options"]["timezone_handling"] = Value::String("primary-convert".into());
        let mut cold = prepare_workspace_review_native(
            &review_request.to_string(),
            csv.clone(),
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        assert_eq!(cold.required_base_kind(), "none");
        assert!(cold
            .execute_selected_base_native(review_base.clone())
            .err()
            .unwrap()
            .contains("selected no persisted base"));
        let cold_result = cold.execute_selected_base_native(Vec::new()).unwrap();
        let cold_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&cold_result.manifest_json).unwrap();
        assert!(cold_manifest.cache_sources.is_empty());
        assert_eq!(cold_manifest.query_executions.len(), WORKFLOW_QUERIES.len());

        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        let persisted_miss = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut persisted_miss = prepare_review_from_prepared(
            persisted_miss,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(persisted_miss.required_base_kind(), "none");
        assert!(persisted_miss
            .execute_selected_base_native(Vec::new())
            .err()
            .unwrap()
            .contains("retry with raw input"));

        assert!(prepare_workspace_review_native(
            &review_request.to_string(),
            csv,
            &review_base[..review_probe_bytes - 1],
            &reconstruction_base[..reconstruction_probe_bytes],
            &RuntimeSupportFiles::default(),
        )
        .err()
        .unwrap()
        .contains("exactly"));
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
        let coalesce_duplicate_event_keys = ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["queries"].as_array().unwrap())
            .find(|query| query["queryId"] == "coalesce_duplicate_event_keys")
            .unwrap();
        assert_eq!(coalesce_duplicate_event_keys["status"], "recomputed");
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
            .query_groups
            .iter()
            .map(|node| node.query_group_id.clone())
            .filter(|query_group_id| query_group_id != "parse_events")
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
                    .query_group_executions
                    .iter()
                    .filter(|execution| {
                        matches!(
                            execution.status,
                            ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                        )
                    })
                    .map(|execution| execution.query_group_id.clone())
                    .collect::<BTreeSet<_>>();
                let evidence_current =
                    dependency_evidence_current(embedded_dependency_certificate());
                if evidence_current {
                    assert!(
                        touched == expected_touched,
                        "{from} -> {to}: exact changed-node set differs: missing={:?} extra={:?}",
                        expected_touched.difference(&touched).collect::<Vec<_>>(),
                        touched.difference(&expected_touched).collect::<Vec<_>>()
                    );
                } else {
                    assert!(
                        expected_touched.is_subset(&touched),
                        "{from} -> {to}: under-invalidated nodes: {:?}",
                        expected_touched.difference(&touched).collect::<Vec<_>>()
                    );
                }
                assert_eq!(
                    manifest
                        .query_group_executions
                        .iter()
                        .find(|execution| execution.query_group_id == "parse_events")
                        .unwrap()
                        .status,
                    if evidence_current {
                        ExecutionStatus::Cached
                    } else {
                        ExecutionStatus::Recomputed
                    },
                    "{from} -> {to}: parse status must reflect certified versus conservative execution"
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
    fn immutable_support_resolution_is_reused_and_invalidated_on_insert() {
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "filter.csv", b"package_name\ncom.example")
            .unwrap();
        let first = support.resolve().unwrap();
        let second = support.resolve().unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        support
            .put_native(
                "background_apps_file",
                "background.csv",
                b"package_name\ncom.background",
            )
            .unwrap();
        let updated = support.resolve().unwrap();
        assert!(!Arc::ptr_eq(&first, &updated));
        assert_eq!(updated.files.len(), 2);
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
        assert_eq!(report["queryGroupStates"]["app_policy"], "open");

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
        assert_eq!(invalid["queryGroupStates"]["app_policy"], "invalid");
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
        assert!(plan_workflow_explorer_view_native("{")
            .unwrap_err()
            .contains("invalid workflow-explorer request"));
        let csv = csv();
        let base: RuntimeRequest = serde_json::from_str(&request(&csv)).unwrap();
        let mut review = base.clone();
        review.command = QUERY_REVIEW_COMMAND.into();
        assert!(review.validate_fields().is_ok());

        for (plotting, timeline, declared) in [
            (false, false, false),
            (true, false, true),
            (false, true, true),
            (true, true, true),
        ] {
            let mut value = base.clone();
            value.options.enable_plotting = plotting;
            value.options.enable_interactive_timeline = timeline;
            value.options.materialize_visualization_data = Some(declared);
            assert!(value.validate_fields().is_ok());
            value.options.materialize_visualization_data = Some(!declared);
            assert!(value
                .validate_fields()
                .unwrap_err()
                .contains("materializeVisualizationData"));
        }
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
        let pipeline_files = resolved.pipeline_files();
        assert_eq!(pipeline_files.filter_csv, b"normalized");
        assert!(pipeline_files.apps_forcing_csv.is_empty());
        assert!(pipeline_files.background_apps_csv.is_empty());
        assert!(pipeline_files.codebook_csv.is_empty());
        assert!(pipeline_files.study_dates_csv.is_empty());
        assert!(pipeline_files.device_sharing_csv.is_empty());
        assert!(pipeline_files.survey_attribution_csv.is_empty());
        assert!(pipeline_files.enrolled_devices_csv.is_empty());

        let mut cell = Vec::new();
        write_csv_cell(&mut cell, "a,\"b\"\n");
        assert_eq!(String::from_utf8(cell).unwrap(), "\"a,\"\"b\"\"\n\"");
    }

    #[test]
    fn review_behavior_is_contract_owned_and_timezone_discovery_is_exact() {
        let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
        assert_eq!(contract.execution.queries.len(), WORKFLOW_QUERIES.len());
        assert!(contract
            .execution
            .queries
            .iter()
            .any(|query| { query.review_behavior == ReviewBehavior::Omit }));
        assert!(contract.execution.queries.iter().all(|query| {
            let expected_mode = query.review_behavior != ReviewBehavior::Execute;
            query_output_mode(query.review_behavior, false).is_some() == expected_mode
                && query_output_mode(query.review_behavior, true).is_some() == expected_mode
        }));
        assert_eq!(
            discover_timezones_v2(&mixed_timezone_csv()).unwrap(),
            ["America/Chicago", "America/New_York"]
        );
    }

    #[test]
    fn direct_invalidation_predicates_cover_each_independent_condition() {
        assert!(validate_verified_review_inputs(false, true, true).is_ok());
        assert!(validate_verified_review_inputs(true, false, false).is_ok());
        assert!(validate_verified_review_inputs(true, true, false).is_err());
        assert!(validate_verified_review_inputs(true, false, true).is_err());

        for label in ["review-base", "reconstruction-base"] {
            assert!(validate_optional_probe_length(&[], 4, label).is_ok());
            assert!(validate_optional_probe_length(&[0; 4], 4, label).is_ok());
            assert!(validate_optional_probe_length(&[0; 3], 4, label)
                .unwrap_err()
                .contains(label));
        }
        assert!(!selected_base_matches_probe(&[], b"prefix-payload"));
        assert!(!selected_base_matches_probe(b"prefix", b"wrong-payload"));
        assert!(selected_base_matches_probe(b"prefix", b"prefix-payload"));

        let cached = RuntimeQueryExecution {
            query_id: "step".into(),
            query_group_id: "unit".into(),
            status: ExecutionStatus::Cached,
            input_key: "input".into(),
            output_digest: "output".into(),
            reason_id: "reason".into(),
        };
        let mut recomputed = cached.clone();
        recomputed.status = ExecutionStatus::Recomputed;
        assert!(should_report_salsa_memory(true, true, &[cached]));
        assert!(!should_report_salsa_memory(false, true, &[]));
        assert!(!should_report_salsa_memory(true, false, &[]));
        assert!(!should_report_salsa_memory(true, true, &[recomputed]));

        assert_eq!(
            query_group_status(true, false, false, false, false),
            ExecutionStatus::Error
        );
        assert_eq!(
            query_group_status(false, true, false, false, false),
            ExecutionStatus::Bypassed
        );
        assert_eq!(
            query_group_status(false, false, true, false, false),
            ExecutionStatus::Skipped
        );
        for changed in [(true, false), (false, true)] {
            assert_eq!(
                query_group_status(false, false, false, changed.0, changed.1),
                ExecutionStatus::Recomputed
            );
        }
        assert_eq!(
            query_group_status(false, false, false, false, false),
            ExecutionStatus::Cached
        );
    }

    /// A query group may report `recomputed` only when a member query
    /// actually executed or the run deactivated the group. Nothing else — no
    /// projection key move, no artifact rebuild — may reach that status, so a
    /// stage badge can never contradict the manifest's own `queryExecutions`.
    #[test]
    fn no_query_group_reports_recomputed_without_an_executed_member() {
        for bits in 0..(1_u8 << 5) {
            let has_error = bits & 1 != 0;
            let bypassed = bits & 2 != 0;
            let has_skipped_query = bits & 4 != 0;
            let group_deactivated = bits & 8 != 0;
            let has_executed_member = bits & 16 != 0;
            let status = query_group_status(
                has_error,
                bypassed,
                has_skipped_query,
                group_deactivated,
                has_executed_member,
            );
            if status == ExecutionStatus::Recomputed {
                assert!(
                    group_deactivated || has_executed_member,
                    "recomputed without an executed member or a deactivated group: {bits:05b}"
                );
            }
            // The converse, which the original assertion left open: `cached`
            // publishes the reason `all-active-queries-reused`, so it may not
            // be reachable from an input set in which a member query ran. Only
            // `error`, `bypassed` and `skipped` -- each of which withdraws the
            // reuse claim rather than making one -- outrank an execution.
            if status == ExecutionStatus::Cached {
                assert!(
                    !has_executed_member,
                    "cached claims every active query was reused, but a member \
                     query executed: {bits:05b}"
                );
            }
        }
    }

    /// The end-to-end pin for the same invariant: drive the real projection
    /// with a previous run whose stage keys all differ, every member query
    /// reported cached by Salsa, and no deactivated group. Every stage must
    /// come back `cached`, because a moved projection key is not an execution
    /// event. A support artifact rewritten with CRLF line endings is exactly
    /// this shape — the raw digest inside `active_source_roles` moves, the
    /// parsed rows do not, and Salsa runs nothing.
    #[test]
    fn a_moved_projection_key_alone_never_badges_a_stage_recomputed() {
        let csv = csv();
        let (_request, result, semantic_options, _exact_options) =
            direct_pipeline_result(&csv, false);
        let plan = embedded_plan();
        // Salsa reported every member query cached: nothing physically ran.
        let query_executions = WORKFLOW_QUERIES
            .iter()
            .map(|definition| RuntimeQueryExecution {
                query_id: definition.id.to_string(),
                query_group_id: definition.group.to_string(),
                status: ExecutionStatus::Cached,
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        // Every stage's remembered key differs from the one this run builds,
        // so `projection_changed` is true for all of them.
        let mut previous_stage_inputs = plan
            .query_groups
            .iter()
            .map(|node| {
                (
                    node.query_group_id.clone(),
                    format!("sha256:{}", "9".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            plan,
            &semantic_options,
            &result,
            &query_executions,
            &BTreeSet::new(),
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection over cached members");
        assert_eq!(executions.len(), plan.query_groups.len());
        let recomputed = executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            recomputed,
            Vec::<&str>::new(),
            "a moved projection key alone reported physical recomputation"
        );
        // The projection still rebuilt the stage artifacts, and the moved key
        // is still published — only the execution claim is withheld.
        assert!(executions
            .iter()
            .all(|execution| execution.output.is_some()));
        assert!(plan.query_groups.iter().all(|node| previous_stage_inputs
            .get(&node.query_group_id)
            .is_some_and(|key| key != &format!("sha256:{}", "9".repeat(64)))));

        // One member query that actually executed is what makes its stage
        // recomputed, and only that stage.
        let executed = WORKFLOW_QUERIES.first().expect("workflow query registry");
        let mut with_execution = query_executions.clone();
        with_execution[0].status = ExecutionStatus::Recomputed;
        let executed_queries = BTreeSet::from([executed.id]);
        let mut previous_stage_inputs = plan
            .query_groups
            .iter()
            .map(|node| {
                (
                    node.query_group_id.clone(),
                    format!("sha256:{}", "9".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            plan,
            &semantic_options,
            &result,
            &with_execution,
            &executed_queries,
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection with one executed member");
        let recomputed = executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(recomputed, vec![executed.group]);
    }

    /// The step ladder in `build_runtime_query_executions` resolves `Bypassed`
    /// ahead of `Recomputed`, so a query that is not applicable is badged
    /// `Bypassed` even when Salsa ran its query. Deriving the stage badge from
    /// the member badges therefore loses that execution, and the stage answers
    /// `Cached` -- published as `all-active-queries-reused` -- for a run in
    /// which a query ran.
    ///
    /// `day_coverage` is where the two applicability conditions genuinely
    /// differ (`workflow_contract.rs`): the group is applicable when
    /// `add_no_activity_placeholder_days` alone is on, while its member
    /// `build_participant_day_coverage` additionally requires `enable_day_coverage`. So
    /// the stage is not bypassed, no member is badged `Recomputed`, and the
    /// contradiction is reachable rather than theoretical.
    #[test]
    fn a_bypassed_member_whose_query_ran_still_recomputes_its_stage() {
        let csv = csv();
        let (_request, result, mut semantic_options, _exact_options) =
            direct_pipeline_result(&csv, false);
        semantic_options["process_app_usage"] = Value::Bool(true);
        semantic_options["add_no_activity_placeholder_days"] = Value::Bool(true);
        semantic_options["enable_day_coverage"] = Value::Bool(false);
        let plan = embedded_plan();
        let node = plan
            .query_groups
            .iter()
            .find(|node| node.query_group_id == "day_coverage")
            .expect("day_coverage stage");
        assert!(
            node.applicability.evaluate(&semantic_options),
            "the stage must stay applicable, or `bypassed` would outrank the \
             execution for an unrelated reason"
        );

        // Salsa ran exactly one query in this stage, and it is the member the
        // options make inapplicable.
        let executed_id = "build_participant_day_coverage";
        let query_executions = WORKFLOW_QUERIES
            .iter()
            .map(|definition| RuntimeQueryExecution {
                query_id: definition.id.to_string(),
                query_group_id: definition.group.to_string(),
                status: if definition.id == executed_id {
                    ExecutionStatus::Bypassed
                } else {
                    ExecutionStatus::Cached
                },
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        assert!(
            !query_executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Recomputed),
            "no member is badged recomputed, which is exactly why reading the \
             badges back reported this stage cached"
        );

        let mut previous_stage_inputs = BTreeMap::new();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            plan,
            &semantic_options,
            &result,
            &query_executions,
            &BTreeSet::from([executed_id]),
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection with one executed but inapplicable member");
        let status = executions
            .iter()
            .find(|execution| execution.query_group_id == "day_coverage")
            .map(|execution| execution.status)
            .expect("day_coverage stage execution");
        assert_eq!(
            status,
            ExecutionStatus::Recomputed,
            "a stage whose member query ran may not claim every active query \
             was reused"
        );
    }

    #[test]
    fn source_role_gates_and_required_view_fields_are_independent() {
        let csv = csv();
        let request: RuntimeRequest = serde_json::from_str(&request(&csv)).unwrap();
        let mut exact = serde_json::to_value(&request.options)
            .unwrap()
            .as_object()
            .unwrap()
            .clone();
        let assignments = BTreeMap::new();
        assert_eq!(
            active_source_roles("decode_source_records", &exact, &assignments),
            BTreeMap::from([("raw_chronicle_csv".to_string(), None)])
        );
        assert!(active_source_roles("mark_app_policy_matches", &exact, &assignments).is_empty());
        exact.insert("use_filter_file".into(), Value::Bool(true));
        assert_eq!(
            active_source_roles("mark_app_policy_matches", &exact, &assignments),
            BTreeMap::from([("filter_file".to_string(), None)])
        );
        assert!(active_source_roles("assemble_result_manifest", &exact, &assignments).is_empty());
        exact.insert("enable_compliance_scoring".into(), Value::Bool(true));
        assert_eq!(
            active_source_roles("assemble_result_manifest", &exact, &assignments),
            BTreeMap::from([("enrolled_devices_file".to_string(), None)])
        );
        exact.insert(
            "usage_session_mode".into(),
            Value::String("screen_usage".into()),
        );
        assert!(active_source_roles("assemble_result_manifest", &exact, &assignments).is_empty());

        let expected_root = format!("sha256:{}", "a".repeat(64));
        let valid = serde_json::json!({
            "viewId": "chronicle-workflow-explorer/v1",
            "schemaId": "urn:chronicle:view:workflow-explorer:v1",
            "rootDigest": expected_root,
        });
        assert!(required_view_contract_matches(
            "workflow-explorer-view-json",
            &valid,
            "workflow-explorer-view-json",
            "chronicle-workflow-explorer/v1",
            "urn:chronicle:view:workflow-explorer:v1",
            expected_root.as_str(),
        ));
        for (kind, view) in [
            ("wrong-kind", valid.clone()),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"wrong", "schemaId":"urn:chronicle:view:workflow-explorer:v1", "rootDigest":expected_root}),
            ),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"chronicle-workflow-explorer/v1", "schemaId":"wrong", "rootDigest":expected_root}),
            ),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"chronicle-workflow-explorer/v1", "schemaId":"urn:chronicle:view:workflow-explorer:v1", "rootDigest":"sha256:wrong"}),
            ),
        ] {
            assert!(!required_view_contract_matches(
                kind,
                &view,
                "workflow-explorer-view-json",
                "chronicle-workflow-explorer/v1",
                "urn:chronicle:view:workflow-explorer:v1",
                expected_root.as_str(),
            ));
        }
    }

    #[test]
    fn raw_artifact_is_exposed_only_to_the_parse_node() {
        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let assignments = BTreeMap::from([(
            "raw_chronicle_csv".to_string(),
            RoleAssignment {
                assignment_id: stable_id(&["assignment", "raw_chronicle_csv", &raw_digest]),
                role_id: "raw_chronicle_csv".into(),
                artifact: ArtifactRef {
                    artifact_id: "artifact:raw_chronicle_csv".into(),
                    digest: raw_digest.clone(),
                    media_type: "text/csv".into(),
                    size: 1,
                    derived_from: Vec::new(),
                    qualifiers: BTreeMap::new(),
                },
                qualifiers: BTreeMap::new(),
                revision: 1,
            },
        )]);
        let exact = serde_json::Map::new();
        for definition in WORKFLOW_QUERIES {
            let sources = active_source_roles(definition.id, &exact, &assignments);
            if definition.id == "decode_source_records" {
                assert_eq!(definition.group, "parse_events");
                assert_eq!(
                    sources.get("raw_chronicle_csv"),
                    Some(&Some(raw_digest.clone()))
                );
            } else {
                assert!(
                    !sources.contains_key("raw_chronicle_csv"),
                    "{} must not read the raw artifact",
                    definition.id
                );
            }
        }
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
        let mut correspondence_value = None;
        let kinds = (0..handle.artifact_count())
            .map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                let bytes = handle.take_artifact_bytes(index).unwrap();
                assert!(!bytes.is_empty());
                if metadata.kind == "correspondence-index-json" {
                    correspondence_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
                }
                if metadata.media_type == "text/csv" {
                    assert!(metadata.row_count.is_some(), "{} row count", metadata.kind);
                    assert!(
                        metadata.preview_rows.is_none(),
                        "{} should not retain unused CSV preview rows",
                        metadata.kind
                    );
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

        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let credited_app_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "credited-app-csv")
            .unwrap()
            .digest;
        let correspondence_value = correspondence_value.unwrap();
        let correspondence_edges = correspondence_value["edges"].as_array().unwrap();
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "workflow-query-group"
                && edge["sourceId"] == "effective_usage"
                && edge["relation"] == "publishes"
                && edge["targetId"] == *credited_app_digest
        }));
    }

    /// `encode_export_family`'s guard, `!include || !(parquet || spss)`, decides
    /// two independent things: whether this CSV family is published at all, and
    /// whether any binary encoding of it was asked for. A run with both families
    /// included and both formats on separates neither — it enters the body
    /// however the operators are read, which is why
    /// `every_optional_output_family_is_emitted_by_the_rust_authority` above
    /// leaves both operators free. Sweep the cases that do separate them.
    #[test]
    fn export_encoding_is_gated_on_the_family_and_on_at_least_one_format() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Screen,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Screen,Screen Non-interactive,android,2026-03-07 10:02:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec();
        let export_kinds =
            |marker: char, include_app: bool, include_screen: bool, parquet: bool, spss: bool| {
                let mut request_value = request_for_workspace(&csv, marker);
                request_value["options"]["usage_session_mode"] =
                    Value::String("app_and_screen_usage".into());
                request_value["options"]["include_app_output"] = Value::Bool(include_app);
                request_value["options"]["include_screen_output"] = Value::Bool(include_screen);
                request_value["options"]["enable_parquet_export"] = Value::Bool(parquet);
                request_value["options"]["enable_spss_export"] = Value::Bool(spss);
                let handle = execute_workspace_native(
                    &request_value.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                (0..handle.artifact_count())
                    .map(|index| {
                        let metadata: RuntimeArtifactMetadata =
                            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap())
                                .unwrap();
                        metadata.kind
                    })
                    .filter(|kind| kind.ends_with("-parquet") || kind.ends_with("-spss"))
                    .collect::<BTreeSet<_>>()
            };

        // One format on is enough to enter the body. Reading the inner `||` as
        // `&&` makes `!(true && false)` true and skips every export.
        assert_eq!(
            export_kinds('0', true, true, true, false),
            BTreeSet::from(["app-parquet".to_string(), "screen-parquet".to_string()]),
            "parquet alone must still be encoded"
        );
        assert_eq!(
            export_kinds('1', true, true, false, true),
            BTreeSet::from(["app-spss".to_string(), "screen-spss".to_string()]),
            "spss alone must still be encoded"
        );

        // An excluded family is never encoded, whatever the formats say.
        // Reading the outer `||` as `&&` makes the guard false for the excluded
        // family, which then gets parsed and published anyway.
        assert_eq!(
            export_kinds('5', false, true, true, true),
            BTreeSet::from(["screen-parquet".to_string(), "screen-spss".to_string()]),
            "an excluded app family must not be encoded"
        );
        assert_eq!(
            export_kinds('6', true, false, true, true),
            BTreeSet::from(["app-parquet".to_string(), "app-spss".to_string()]),
            "an excluded screen family must not be encoded"
        );

        // Neither format on: nothing is encoded and no CSV is reparsed.
        assert_eq!(
            export_kinds('8', true, true, false, false),
            BTreeSet::new(),
            "no export format means no binary export"
        );
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
            &build_execution_ledger(plan, &[], &[], &serde_json::json!({}), "now").unwrap(),
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
        let explorer_request = serde_json::json!({
            "options": request_value["options"],
            "supportRoles": [],
        });
        let view: Value = serde_json::from_str(
            &plan_workflow_explorer_view_json(&explorer_request.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(view["viewId"], "chronicle-workflow-explorer/v1");

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
        let projected_keys = projected
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let certified_keys = CERTIFIED_OPTION_KEYS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(projected_keys, certified_keys);
        for excluded in [
            "enable_plotting",
            "enable_activity_heatmap",
            "parallel_processing",
            "parallel_max_workers",
        ] {
            assert!(projected.get(excluded).is_none());
        }
    }

    #[test]
    fn exact_to_certified_option_key_table_matches_the_projection() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        let exact_value = serde_json::to_value(&options).unwrap();
        let exact_keys = exact_value
            .as_object()
            .unwrap()
            .keys()
            .map(String::clone)
            .collect::<BTreeSet<_>>();

        for (exact_key, certified_keys) in EXACT_TO_CERTIFIED_OPTION_KEYS {
            assert!(
                exact_keys.contains(*exact_key),
                "table exact key {exact_key} is not a serialized option field"
            );
            assert!(
                !CERTIFIED_OPTION_KEYS.contains(exact_key),
                "table exact key {exact_key} is itself certified; identity would be ambiguous"
            );
            for certified_key in *certified_keys {
                assert!(
                    CERTIFIED_OPTION_KEYS.contains(certified_key),
                    "table target {certified_key} is not a certified option key"
                );
            }
        }

        let reachable = exact_keys
            .iter()
            .flat_map(|exact_key| {
                CERTIFIED_OPTION_KEYS
                    .iter()
                    .filter(|certified_key| {
                        exact_option_key_reaches_certified(exact_key, certified_key)
                    })
                    .copied()
            })
            .collect::<BTreeSet<_>>();
        let certified = CERTIFIED_OPTION_KEYS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            reachable, certified,
            "every certified knob key must be reachable from exactly the exact-serialization keys"
        );
    }
}
