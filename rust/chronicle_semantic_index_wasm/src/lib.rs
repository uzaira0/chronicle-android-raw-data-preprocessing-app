//! Derived RDF/SPARQL index for the Chronicle raw-data preprocessing app.
//!
//! The OPFS content-addressed artifact closure and evidence journal remain the
//! authority. This crate deterministically projects a bounded semantic source
//! into N-Quads and evaluates only product-registered SPARQL queries.

#[path = "../../chronicle_preprocessing_runtime_wasm/src/bundled_gzip.rs"]
mod bundled_gzip;

use chronicle_chrono_kernel_wasm::b06_maximum_duration::{self as b06, MaximumDurationEvidence};
use chronicle_chrono_kernel_wasm::b05_foundational_semantics::{
    capability_evidence_assignment_digest, B05RefusalReason, SchoedelReconstructionOutput,
    SchoedelReconstructionReceiptV1, SchoedelRefusalReason, ScientificRelation,
    ScreenConstructionOutput, ScreenConstructionReceiptV1, ScreenSessionConstructionStrategyId,
};
use chronicle_chrono_kernel_wasm::eyes_complement::{
    eyes_tagged_fau_artifact_jcs_bytes, EyesParticipantTaggedFauEvidence,
};
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    minimum_duration_excluded_lineage_bytes, validate_b05_schoedel_validation_receipt_integrity,
    validate_eyes_tagged_fau_validation_receipt_integrity,
    validate_foundational_semantics_evidence_for_options, validate_workflow_checkpoint_for_subject,
    zero_duration_removed_lineage_bytes, B05ComputationPhase, B05OptionsDigestOrigin,
    B05SchoedelPreflightResult, B05SchoedelValidationReceipt, B05SchoedelValidationStatus,
    ConcurrentSubintervalFloorReceipt, EyesInputPartitionOptionsDigestOrigin,
    EyesInputPartitionPreflightResult, EyesTaggedFauValidationReceipt,
    FoundationalSemanticsEvidence, MicroUseReceipt, MinimumDurationComparator,
    MinimumDurationDisposition, PipelineV2OptionsJson, ScientificPreflightDisposition,
    WorkflowCheckpoint,
};
use chronicle_chrono_kernel_wasm::workflow_contract::{
    query_applicability, query_source_role_bindings, ApplicabilityExpression,
    QuerySourceRolePredicate, RUNTIME_ARTIFACT_REQUEST_FIELDS, WORKFLOW_QUERIES,
};
use oxigraph::model::NamedNode;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use oxttl::NQuadsParser;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::*;

const ASSIGNMENTS_GRAPH: &str = "urn:chronicle:derived:assignments";
const QUALIFICATION_GRAPH: &str = "urn:chronicle:derived:qualification";
const OBLIGATIONS_GRAPH: &str = "urn:chronicle:derived:obligations";
const EXECUTION_GRAPH: &str = "urn:chronicle:derived:actual-execution";
const REASONS_GRAPH: &str = "urn:chronicle:derived:reasons";
const EYES_GRAPH: &str = "urn:chronicle:derived:eyes-partial-replay";
const FOUNDATIONAL_GRAPH: &str = "urn:chronicle:derived:foundational-semantics";
const B05_SCREEN_GRAPH: &str = "urn:chronicle:derived:b05-screen-construction";
const SCHOEDEL_GRAPH: &str = "urn:chronicle:derived:schoedel-reconstruction";
const SCIENTIFIC_ATTESTATION_GRAPH: &str = "urn:chronicle:derived:scientific-attestation";
const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PROV_ACTIVITY: &str = "http://www.w3.org/ns/prov#Activity";
const PROV_ENTITY: &str = "http://www.w3.org/ns/prov#Entity";
const PROV_WAS_DERIVED_FROM: &str = "http://www.w3.org/ns/prov#wasDerivedFrom";
const PROV_STARTED: &str = "http://www.w3.org/ns/prov#startedAtTime";
const PROV_ENDED: &str = "http://www.w3.org/ns/prov#endedAtTime";
const PPLAN_CORRESPONDS_TO_STEP: &str = "http://purl.org/net/p-plan#correspondsToStep";
const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";
const XSD_DATE_TIME: &str = "http://www.w3.org/2001/XMLSchema#dateTime";
const XSD_UNSIGNED_LONG: &str = "http://www.w3.org/2001/XMLSchema#unsignedLong";
// Consumed only by the exact-term index assertions in the test module; the
// production identity lives in the kernel's eyes_complement receipts.
#[cfg(test)]
const EYES_REFERENCE_VERSION: &str = "0.1.0";
#[cfg(test)]
const EYES_REFERENCE_COMMIT: &str = "89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108";
#[cfg(test)]
const EYES_REFERENCE_LICENSE: &str = "unresolved";
#[cfg(test)]
const EYES_REFERENCE_DEFECT_REPAIR_IDS: [&str; 3] = [
    "stale_predecessor_after_forward_reboot_gap",
    "non_monotonic_gap_emission",
    "nested_block_cursor_reset",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexSource {
    protocol_version: String,
    input_digest: String,
    execution_timestamp: String,
    exact_options: PipelineV2OptionsJson,
    exact_options_digest: String,
    role_assignments: Vec<RoleAssignment>,
    qualification_traces: Vec<QualificationTrace>,
    requirement_traces: Vec<RoleRequirementTrace>,
    open_obligations: Vec<OpenObligation>,
    state_reasons: Vec<StateReason>,
    query_executions: Vec<QueryExecution>,
    workflow_query_digests: BTreeMap<String, String>,
    workflow_query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    opener_set_receipt: OpenerSetReceipt,
    opener_set_receipt_digest: String,
    /// B06 receipt and its artifact digest; both present for an explicit
    /// selection, both absent for the omitted shape.
    #[serde(default)]
    maximum_duration_receipt: Option<MaximumDurationEvidence>,
    #[serde(default)]
    maximum_duration_receipt_digest: Option<String>,
    eyes_evidence: EyesEvidenceSource,
    scientific_evidence: ScientificEvidenceSummary,
    scientific_evidence_artifacts: Vec<ScientificArtifactMetadata>,
    scientific_validation_substrate_kinds: Vec<String>,
    #[serde(default)]
    dependency_cache_decision: Option<DependencyCacheDecision>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScientificArtifactMetadata {
    artifact_id: String,
    kind: String,
    media_type: String,
    digest: String,
    size: u64,
    derived_from: Vec<String>,
    #[serde(default)]
    scientific_source_bindings: Vec<ScientificSourceBinding>,
    #[serde(default)]
    row_count: Option<u32>,
    #[serde(default)]
    preview_rows: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScientificSourceBinding {
    role_id: String,
    artifact_digest: String,
    assignment_id: String,
}

const MAX_SCIENTIFIC_ARTIFACT_COUNT: usize = 16;
/// One transient validation substrate is capped below the practical 32-bit
/// WASM heap ceiling so source metadata cannot trigger an unbounded browser
/// allocation before evidence validation.
const MAX_SCIENTIFIC_ARTIFACT_BUNDLE_BYTES: usize = 128 * 1024 * 1024;

struct ParsedScientificEvidence {
    foundational_semantics_evidence: FoundationalSemanticsEvidence,
    finalized_b05_schoedel_preflight: B05SchoedelPreflightResult,
    b05_schoedel_validation_receipt: B05SchoedelValidationReceipt,
    eyes_tagged_fau_evidence: Vec<EyesParticipantTaggedFauEvidence>,
    eyes_tagged_fau_validation_receipt: Option<EyesTaggedFauValidationReceipt>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EyesTaggedFauArtifact {
    protocol_version: String,
    status: EyesEvidenceStatus,
    episode_reconstruction_strategy: String,
    participants: Vec<EyesParticipantTaggedFauEvidence>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScientificEvidenceSummary {
    protocol_version: String,
    foundational_semantics_artifact_digest: String,
    micro_use_receipt: MicroUseReceipt,
    minimum_duration_receipt: CompactMinimumDurationReceipt,
    concurrent_subinterval_floor_receipt: ConcurrentSubintervalFloorReceipt,
    zero_duration_cleanup_receipt: CompactZeroDurationCleanupReceipt,
    minimum_duration_excluded_lineage_artifact_digest: Option<String>,
    zero_duration_cleanup_evidence_artifact_digest: Option<String>,
    zero_duration_removed_lineage_artifact_digest: Option<String>,
    finalized_b05_schoedel: CompactB05SchoedelReceipt,
    b05_screen_construction_receipt: Option<CompactScreenConstructionReceipt>,
    b05_screen_construction_artifact_digest: Option<String>,
    schoedel_reconstruction_receipt: Option<CompactSchoedelReconstructionReceipt>,
    schoedel_reconstruction_artifact_digest: Option<String>,
    eyes_input_partition: Option<EyesInputPartitionPreflightResult>,
    eyes_tagged_fau_validation_receipt: Option<EyesTaggedFauValidationReceipt>,
    eyes_tagged_fau_validation_receipt_artifact_digest: Option<String>,
    b05_schoedel_validation_receipt: CompactB05SchoedelValidationReceipt,
    b05_schoedel_validation_receipt_artifact_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactMinimumDurationReceipt {
    protocol_version: String,
    relation: String,
    requested_comparator: MinimumDurationComparator,
    effective_comparator: MinimumDurationComparator,
    threshold_ns: i64,
    requested_disposition: MinimumDurationDisposition,
    effective_disposition: MinimumDurationDisposition,
    checkpoint: String,
    bounded_episode_count: u32,
    unbounded_episode_count: u32,
    qualifying_count: u32,
    retained_credited_count: u32,
    retained_excluded_count: u32,
    dropped_count: u32,
}

fn compact_minimum_duration_receipt(
    receipt: &chronicle_chrono_kernel_wasm::pipeline_v2::MinimumDurationReceipt,
) -> CompactMinimumDurationReceipt {
    CompactMinimumDurationReceipt {
        protocol_version: receipt.protocol_version.clone(),
        relation: receipt.relation.clone(),
        requested_comparator: receipt.requested_comparator,
        effective_comparator: receipt.effective_comparator,
        threshold_ns: receipt.threshold_ns,
        requested_disposition: receipt.requested_disposition,
        effective_disposition: receipt.effective_disposition,
        checkpoint: receipt.checkpoint.clone(),
        bounded_episode_count: receipt.bounded_episode_count,
        unbounded_episode_count: receipt.unbounded_episode_count,
        qualifying_count: receipt.qualifying_count,
        retained_credited_count: receipt.retained_credited_count,
        retained_excluded_count: receipt.retained_excluded_count,
        dropped_count: receipt.dropped_count,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactZeroDurationCleanupReceipt {
    protocol_version: String,
    requested_applied: bool,
    effective_applied: bool,
    checkpoint: String,
    zero_episode_candidate_count: u32,
    removed_row_count: u32,
}

fn compact_zero_duration_cleanup_receipt(
    receipt: &chronicle_chrono_kernel_wasm::pipeline_v2::ZeroDurationCleanupReceipt,
) -> CompactZeroDurationCleanupReceipt {
    CompactZeroDurationCleanupReceipt {
        protocol_version: receipt.protocol_version.clone(),
        requested_applied: receipt.requested_applied,
        effective_applied: receipt.effective_applied,
        checkpoint: receipt.checkpoint.clone(),
        zero_episode_candidate_count: receipt.zero_episode_candidate_count,
        removed_row_count: receipt.removed_row_count,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactScreenConstructionReceipt {
    protocol_version: String,
    strategy_id: ScreenSessionConstructionStrategyId,
    relation: ScientificRelation,
    source_identity: String,
    source_artifact_sha256: Option<String>,
    source_license_status: String,
    input_row_count: u64,
    participant_count: u64,
    interval_count: u64,
    session_count: u64,
    glance_count: u64,
    right_censored_count: u64,
    issue_counts: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactSchoedelReconstructionReceipt {
    protocol_version: String,
    strategy_id: String,
    relation: ScientificRelation,
    source_identity: String,
    source_version: String,
    source_license_status: String,
    source_scope_id: String,
    adapter_id: String,
    completion_rule_ids: Vec<String>,
    input_screen_interval_count: u64,
    input_event_count: u64,
    episode_count: u64,
    bounded_episode_count: u64,
    singleton_zero_length_count: u64,
    right_censored_evidence_count: u64,
    issue_counts: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactB05SchoedelValidationReceipt {
    protocol_version: String,
    status: B05SchoedelValidationStatus,
    decoded_input_row_count: u64,
    foundational_episode_count: u32,
    foundational_bounded_episode_count: u32,
    foundational_unbounded_episode_count: u32,
    minimum_duration_excluded_episode_count: u32,
    concurrent_generated_subinterval_count: u32,
    zero_duration_removed_row_count: u32,
    selected_b05_strategy_id: ScreenSessionConstructionStrategyId,
    trusted_schoedel_retained_event_count: Option<u64>,
    schoedel_decisive_participant_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactB05SchoedelReceipt {
    protocol_version: String,
    disposition: ScientificPreflightDisposition,
    options_digest: String,
    component_options_digest: String,
    screen_component_options_digest: String,
    schoedel_component_options_digest: String,
    options_digest_origin: B05OptionsDigestOrigin,
    requested_screen_strategy_id: ScreenSessionConstructionStrategyId,
    effective_screen_strategy_id: ScreenSessionConstructionStrategyId,
    requested_episode_strategy_id: String,
    effective_episode_strategy_id: Option<String>,
    screen_construction_phase: B05ComputationPhase,
    schoedel_reconstruction_phase: B05ComputationPhase,
    screen_applicability: Option<CompactB05Applicability>,
    schoedel_applicability: Option<CompactSchoedelApplicability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactB05Applicability {
    protocol_version: String,
    relation: ScientificRelation,
    executable: bool,
    refusal_reason: Option<B05RefusalReason>,
    refusal_detail: Option<CompactB05RefusalDetail>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompactSchoedelApplicability {
    protocol_version: String,
    relation: ScientificRelation,
    executable: bool,
    refusal_reason: Option<SchoedelRefusalReason>,
    refusal_detail: Option<CompactSchoedelRefusalDetail>,
}

fn is_scientific_artifact_kind(kind: &str) -> bool {
    matches!(
        kind,
        "b05-schoedel-validation-receipt-json"
            | "b05-screen-construction-evidence-json"
            | "eyes-tagged-fau-evidence-json"
            | "eyes-tagged-fau-validation-receipt-json"
            | "foundational-semantics-receipt-json"
            | "minimum-duration-excluded-lineage-json"
            | "schoedel-reconstruction-evidence-json"
            | "zero-duration-cleanup-evidence-json"
            | "zero-duration-removed-lineage-json"
    )
}

fn parse_scientific_artifact<T: for<'de> Deserialize<'de>>(
    artifacts: &BTreeMap<&str, &[u8]>,
    kind: &'static str,
) -> Result<T, String> {
    serde_json::from_slice(
        artifacts
            .get(kind)
            .ok_or_else(|| format!("semantic scientific artifact missing: {kind}"))?,
    )
    .map_err(|_| format!("semantic scientific artifact payload invalid: {kind}"))
}

fn parse_optional_scientific_artifact<T: for<'de> Deserialize<'de>>(
    artifacts: &BTreeMap<&str, &[u8]>,
    kind: &'static str,
) -> Result<Option<T>, String> {
    artifacts
        .get(kind)
        .map(|bytes| {
            serde_json::from_slice(bytes)
                .map_err(|_| format!("semantic scientific artifact payload invalid: {kind}"))
        })
        .transpose()
}

fn expand_b05_schoedel_preflight(
    compact: &CompactB05SchoedelReceipt,
    screen_construction: Option<ScreenConstructionOutput>,
    schoedel_reconstruction: Option<SchoedelReconstructionOutput>,
) -> B05SchoedelPreflightResult {
    B05SchoedelPreflightResult {
        protocol_version: compact.protocol_version.clone(),
        disposition: compact.disposition,
        options_digest: compact.options_digest.clone(),
        component_options_digest: compact.component_options_digest.clone(),
        screen_component_options_digest: compact.screen_component_options_digest.clone(),
        schoedel_component_options_digest: compact.schoedel_component_options_digest.clone(),
        options_digest_origin: compact.options_digest_origin,
        requested_screen_strategy_id: compact.requested_screen_strategy_id,
        effective_screen_strategy_id: compact.effective_screen_strategy_id,
        requested_episode_strategy_id: compact.requested_episode_strategy_id.clone(),
        effective_episode_strategy_id: compact.effective_episode_strategy_id.clone(),
        screen_construction_phase: compact.screen_construction_phase,
        schoedel_reconstruction_phase: compact.schoedel_reconstruction_phase,
        screen_construction,
        schoedel_reconstruction,
    }
}

fn parse_scientific_artifact_bundle(
    source: &IndexSource,
    bundle: &[u8],
) -> Result<ParsedScientificEvidence, String> {
    let metadata = &source.scientific_evidence_artifacts;
    if metadata.is_empty() || metadata.len() > MAX_SCIENTIFIC_ARTIFACT_COUNT {
        return Err("semantic scientific artifact bundle count invalid".into());
    }
    let mut metadata_by_kind = BTreeMap::new();
    let mut previous_kind: Option<&str> = None;
    for artifact in metadata {
        if !is_scientific_artifact_kind(&artifact.kind)
            || previous_kind.is_some_and(|previous| previous >= artifact.kind.as_str())
            || metadata_by_kind
                .insert(artifact.kind.as_str(), artifact)
                .is_some()
        {
            return Err("semantic scientific artifact metadata order invalid".into());
        }
        previous_kind = Some(&artifact.kind);
    }
    let mut expected_substrate_kinds = vec![
        "b05-schoedel-validation-receipt-json".to_string(),
        "foundational-semantics-receipt-json".to_string(),
    ];
    if source
        .scientific_evidence
        .b05_screen_construction_artifact_digest
        .is_some()
    {
        expected_substrate_kinds.push("b05-screen-construction-evidence-json".into());
    }
    if source
        .scientific_evidence
        .schoedel_reconstruction_artifact_digest
        .is_some()
    {
        expected_substrate_kinds.push("schoedel-reconstruction-evidence-json".into());
    }
    if source.eyes_evidence.tagged_fau_artifact_digest.is_some() {
        expected_substrate_kinds.push("eyes-tagged-fau-evidence-json".into());
    }
    expected_substrate_kinds.sort();
    if source.scientific_validation_substrate_kinds != expected_substrate_kinds
        || source
            .scientific_validation_substrate_kinds
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
    {
        return Err("semantic scientific validation substrate set invalid".into());
    }

    let mut offset = 0_usize;
    let mut artifacts = BTreeMap::new();
    for kind in &source.scientific_validation_substrate_kinds {
        let artifact = metadata_by_kind
            .get(kind.as_str())
            .ok_or_else(|| format!("semantic scientific artifact missing: {kind}"))?;
        if artifact.media_type != "application/json" {
            return Err(format!(
                "semantic scientific artifact media invalid: {kind}"
            ));
        }
        let size = usize::try_from(artifact.size).map_err(|_| {
            format!(
                "semantic scientific artifact size invalid: {}",
                artifact.kind
            )
        })?;
        let end = offset
            .checked_add(size)
            .filter(|end| *end <= MAX_SCIENTIFIC_ARTIFACT_BUNDLE_BYTES)
            .ok_or_else(|| "semantic scientific artifact bundle size invalid".to_string())?;
        let bytes = bundle
            .get(offset..end)
            .ok_or_else(|| format!("semantic scientific artifact truncated: {}", artifact.kind))?;
        if sha256_bytes(bytes) != artifact.digest {
            return Err(format!(
                "semantic scientific artifact content mismatch: {}",
                artifact.kind
            ));
        }
        if artifacts.insert(artifact.kind.as_str(), bytes).is_some() {
            return Err("semantic scientific artifact kind duplicated".into());
        }
        offset = end;
    }
    if offset != bundle.len() {
        return Err("semantic scientific artifact bundle trailing bytes".into());
    }

    let foundational_semantics_evidence =
        parse_scientific_artifact(&artifacts, "foundational-semantics-receipt-json")?;
    let screen_construction =
        parse_optional_scientific_artifact(&artifacts, "b05-screen-construction-evidence-json")?;
    let schoedel_reconstruction =
        parse_optional_scientific_artifact(&artifacts, "schoedel-reconstruction-evidence-json")?;
    let finalized_b05_schoedel_preflight = expand_b05_schoedel_preflight(
        &source.scientific_evidence.finalized_b05_schoedel,
        screen_construction,
        schoedel_reconstruction,
    );
    let b05_schoedel_validation_receipt =
        parse_scientific_artifact(&artifacts, "b05-schoedel-validation-receipt-json")?;
    let eyes_artifact: Option<EyesTaggedFauArtifact> =
        parse_optional_scientific_artifact(&artifacts, "eyes-tagged-fau-evidence-json")?;
    let eyes_tagged_fau_evidence = match eyes_artifact {
        Some(artifact)
            if artifact.protocol_version == "chronicle-eyes-tagged-fau-artifact/v1"
                && artifact.status == EyesEvidenceStatus::PartialReplay
                && artifact.episode_reconstruction_strategy == "eyes_complement" =>
        {
            artifact.participants
        }
        Some(_) => {
            return Err(
                "semantic scientific artifact payload invalid: eyes-tagged-fau-evidence-json"
                    .into(),
            )
        }
        None => Vec::new(),
    };
    let eyes_tagged_fau_validation_receipt = source
        .scientific_evidence
        .eyes_tagged_fau_validation_receipt
        .clone();
    Ok(ParsedScientificEvidence {
        foundational_semantics_evidence,
        finalized_b05_schoedel_preflight,
        b05_schoedel_validation_receipt,
        eyes_tagged_fau_evidence,
        eyes_tagged_fau_validation_receipt,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum CompactB05RefusalDetail {
    CapabilityEvidenceAbsent,
    CapabilityEvidenceNotBoundToInput,
    ParticipantScopeUndetermined,
    MultipleDeviceStreamsAliased,
    DeviceStreamScopeUnknown,
    CombinedEventRepresentation,
    SourceStreamIncomplete,
    SourceStreamCompletenessUnknown,
    SourceOrderNotPreserved,
    SourceOrderUnknown,
    ParticipantStreamFragmented,
    InputChunkStatusUnknown,
    MissingRequiredSignal,
    RequiredSignalCapabilityUnknown,
    UnorderableFullStreamRow,
    NonMonotonicSourceTimestamps,
    AmbiguousEqualTimestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum CompactSchoedelRefusalDetail {
    AmbiguousEqualTimestamp,
    UnorderableFullStreamRow,
    InvalidScreenIntervalDependency,
    FullOsfPrerequisitesUnavailable,
    CapabilityEvidenceNotBoundToInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum EyesEvidenceStatus {
    PartialReplay,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EyesEvidenceSource {
    protocol_version: String,
    status: EyesEvidenceStatus,
    episode_reconstruction_strategy: String,
    tagged_fau_artifact_digest: Option<String>,
    validation_receipt: Option<EyesTaggedFauValidationReceipt>,
    validation_receipt_artifact_digest: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenerSetReceipt {
    applicability: OpenerSetApplicability,
    suppressed_device_opener_count: u64,
    selected_opener_type_counts: BTreeMap<String, u64>,
    materialized_opener_type_counts: BTreeMap<String, u64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenerSetApplicability {
    requested: String,
    effective: Option<String>,
    relation: String,
    refusal_reason: Option<String>,
}

fn opener_set_receipt_digest(receipt: &OpenerSetReceipt) -> Result<String, String> {
    let canonical = serde_jcs::to_vec(receipt)
        .map_err(|error| format!("canonicalize opener-set receipt: {error}"))?;
    Ok(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(&canonical))
    ))
}

fn validate_eyes_evidence(source: &EyesEvidenceSource) -> Result<(), String> {
    if source.protocol_version != "chronicle-eyes-runtime-summary/v2"
        || source.episode_reconstruction_strategy.trim().is_empty()
    {
        return Err("semantic index EYES evidence summary is invalid".into());
    }
    match source.status {
        EyesEvidenceStatus::NotApplicable => {
            if source.episode_reconstruction_strategy == "eyes_complement"
                || source.tagged_fau_artifact_digest.is_some()
                || source.validation_receipt.is_some()
                || source.validation_receipt_artifact_digest.is_some()
            {
                return Err("semantic index non-EYES evidence is invalid".into());
            }
        }
        EyesEvidenceStatus::PartialReplay => {
            if source.episode_reconstruction_strategy != "eyes_complement"
                || !source
                    .tagged_fau_artifact_digest
                    .as_deref()
                    .is_some_and(is_sha256)
                || source.validation_receipt.is_none()
                || !source
                    .validation_receipt_artifact_digest
                    .as_deref()
                    .is_some_and(is_sha256)
            {
                return Err("semantic index EYES replay strategy is invalid".into());
            }
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DependencyCacheDecision {
    mode: String,
    certificate_digest: Option<String>,
    binding_surface_digest: Option<String>,
    empirical_evidence_current: bool,
    reasons: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RoleAssignment {
    assignment_id: String,
    role_id: String,
    artifact: Artifact,
}

#[derive(Debug, Deserialize)]
struct Artifact {
    artifact_id: String,
    digest: String,
}

#[derive(Debug, Deserialize)]
struct QualificationTrace {
    trace_id: String,
    candidate_id: String,
    candidate_revision: u64,
    artifact_digest: String,
    qualifiers_digest: String,
    asserted_role_ids: Vec<String>,
    selected_role_id: Option<String>,
    decision: String,
    rule_evaluations: Vec<QualificationRuleEvaluation>,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
struct QualificationRuleEvaluation {
    rule_id: String,
    passed: bool,
    expected: String,
    observed: String,
}

#[derive(Debug, Deserialize)]
struct RoleRequirementTrace {
    trace_id: String,
    role_id: String,
    required: bool,
    unconditional: bool,
    condition_id: Option<String>,
    condition_result: Option<bool>,
    candidate_trace_ids: Vec<String>,
    accepted_assignment_ids: Vec<String>,
    state: String,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
struct OpenObligation {
    obligation_id: String,
    role_id: String,
    query_group_id: Option<String>,
    state: String,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
struct StateReason {
    reason_id: String,
    subject_id: String,
    state: String,
    source_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct QueryExecution {
    query_id: String,
    query_group_id: String,
    status: String,
    input_key: String,
    output_digest: String,
    reason_id: String,
}

fn iri(value: &str) -> String {
    format!("<{value}>")
}

fn literal(value: &str) -> String {
    serde_json::to_string(value).expect("JSON strings are N-Triples literals")
}

fn enum_name(value: impl Serialize) -> String {
    serde_json::to_value(value)
        .expect("typed semantic-index enum is serializable")
        .as_str()
        .expect("typed semantic-index enum serializes as a string")
        .to_owned()
}

fn date_time_literal(value: &str) -> String {
    let normalized = value
        .strip_suffix(" UTC")
        .map(|without_zone| format!("{}Z", without_zone.replacen(' ', "T", 1)))
        .unwrap_or_else(|| value.to_string());
    format!("{}^^<{}>", literal(&normalized), XSD_DATE_TIME)
}

fn boolean_literal(value: bool) -> String {
    format!("\"{value}\"^^<{}>", XSD_BOOLEAN)
}

fn unsigned_long_literal(value: u64) -> String {
    format!("\"{value}\"^^<{}>", XSD_UNSIGNED_LONG)
}

fn quad(subject: &str, predicate: &str, object: &str, graph: &str) -> String {
    format!("{subject} {predicate} {object} <{graph}> .")
}

fn predicate(name: &str) -> String {
    iri(&format!("urn:chronicle:predicate:{name}"))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn urn(kind: &str, value: &str) -> String {
    iri(&format!(
        "urn:chronicle:{kind}:{}",
        value.replace(['<', '>', ' ', '\"'], "_")
    ))
}

fn resource_iri(kind: &str, value: &str) -> String {
    if NamedNode::new(value.to_owned()).is_ok() {
        iri(value)
    } else {
        urn(kind, value)
    }
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn sha256_jcs(value: &impl Serialize, label: &str) -> Result<(String, u64), String> {
    let bytes =
        serde_jcs::to_vec(value).map_err(|error| format!("canonicalize {label}: {error}"))?;
    Ok((sha256_bytes(&bytes), bytes.len() as u64))
}

fn compact_b05_schoedel(
    preflight: &B05SchoedelPreflightResult,
) -> Result<CompactB05SchoedelReceipt, String> {
    let screen_applicability = preflight.screen_construction.as_ref().map(|output| {
        let applicability = &output.applicability;
        CompactB05Applicability {
            protocol_version: applicability.protocol_version.clone(),
            relation: applicability.relation,
            executable: applicability.executable,
            refusal_reason: applicability.refusal_reason,
            refusal_detail: applicability.refusal_detail.as_ref().and_then(|_| {
                applicability.refusal_reason.map(|reason| match reason {
                    B05RefusalReason::InputCapabilityEvidenceAbsent => {
                        CompactB05RefusalDetail::CapabilityEvidenceAbsent
                    }
                    B05RefusalReason::CapabilityEvidenceNotBoundToInput => {
                        CompactB05RefusalDetail::CapabilityEvidenceNotBoundToInput
                    }
                    B05RefusalReason::ParticipantScopeUndetermined => {
                        CompactB05RefusalDetail::ParticipantScopeUndetermined
                    }
                    B05RefusalReason::MultipleDeviceStreamsAliased => {
                        CompactB05RefusalDetail::MultipleDeviceStreamsAliased
                    }
                    B05RefusalReason::DeviceStreamScopeUnknown => {
                        CompactB05RefusalDetail::DeviceStreamScopeUnknown
                    }
                    B05RefusalReason::CombinedEventRepresentation => {
                        CompactB05RefusalDetail::CombinedEventRepresentation
                    }
                    B05RefusalReason::SourceStreamIncomplete => {
                        CompactB05RefusalDetail::SourceStreamIncomplete
                    }
                    B05RefusalReason::SourceStreamCompletenessUnknown => {
                        CompactB05RefusalDetail::SourceStreamCompletenessUnknown
                    }
                    B05RefusalReason::SourceOrderNotPreserved => {
                        CompactB05RefusalDetail::SourceOrderNotPreserved
                    }
                    B05RefusalReason::SourceOrderUnknown => {
                        CompactB05RefusalDetail::SourceOrderUnknown
                    }
                    B05RefusalReason::UnsupportedInputChunk => {
                        CompactB05RefusalDetail::ParticipantStreamFragmented
                    }
                    B05RefusalReason::InputChunkStatusUnknown => {
                        CompactB05RefusalDetail::InputChunkStatusUnknown
                    }
                    B05RefusalReason::MissingRequiredSignal => {
                        CompactB05RefusalDetail::MissingRequiredSignal
                    }
                    B05RefusalReason::RequiredSignalCapabilityUnknown => {
                        CompactB05RefusalDetail::RequiredSignalCapabilityUnknown
                    }
                    B05RefusalReason::UnorderableFullStreamRow => {
                        CompactB05RefusalDetail::UnorderableFullStreamRow
                    }
                    B05RefusalReason::NonMonotonicSourceTimestamps => {
                        CompactB05RefusalDetail::NonMonotonicSourceTimestamps
                    }
                    B05RefusalReason::AmbiguousEqualTimestamp => {
                        CompactB05RefusalDetail::AmbiguousEqualTimestamp
                    }
                })
            }),
        }
    });
    let schoedel_applicability = preflight.schoedel_reconstruction.as_ref().map(|output| {
        let applicability = &output.applicability;
        CompactSchoedelApplicability {
            protocol_version: applicability.protocol_version.clone(),
            relation: applicability.relation,
            executable: applicability.executable,
            refusal_reason: applicability.refusal_reason,
            refusal_detail: applicability.refusal_detail.as_ref().and_then(|_| {
                applicability.refusal_reason.map(|reason| match reason {
                    SchoedelRefusalReason::AmbiguousEqualTimestamp => {
                        CompactSchoedelRefusalDetail::AmbiguousEqualTimestamp
                    }
                    SchoedelRefusalReason::UnorderableAppRow => {
                        CompactSchoedelRefusalDetail::UnorderableFullStreamRow
                    }
                    SchoedelRefusalReason::InvalidScreenIntervalDependency => {
                        CompactSchoedelRefusalDetail::InvalidScreenIntervalDependency
                    }
                    SchoedelRefusalReason::SchoedelFullOsfMissingPrerequisites => {
                        CompactSchoedelRefusalDetail::FullOsfPrerequisitesUnavailable
                    }
                    SchoedelRefusalReason::CapabilityEvidenceNotBoundToInput => {
                        CompactSchoedelRefusalDetail::CapabilityEvidenceNotBoundToInput
                    }
                })
            }),
        }
    });
    Ok(CompactB05SchoedelReceipt {
        protocol_version: preflight.protocol_version.clone(),
        disposition: preflight.disposition,
        options_digest: preflight.options_digest.clone(),
        component_options_digest: preflight.component_options_digest.clone(),
        screen_component_options_digest: preflight.screen_component_options_digest.clone(),
        schoedel_component_options_digest: preflight.schoedel_component_options_digest.clone(),
        options_digest_origin: preflight.options_digest_origin,
        requested_screen_strategy_id: preflight.requested_screen_strategy_id,
        effective_screen_strategy_id: preflight.effective_screen_strategy_id,
        requested_episode_strategy_id: preflight.requested_episode_strategy_id.clone(),
        effective_episode_strategy_id: preflight.effective_episode_strategy_id.clone(),
        screen_construction_phase: preflight.screen_construction_phase,
        schoedel_reconstruction_phase: preflight.schoedel_reconstruction_phase,
        screen_applicability,
        schoedel_applicability,
    })
}

fn compact_screen_receipt(
    receipt: &ScreenConstructionReceiptV1,
) -> CompactScreenConstructionReceipt {
    CompactScreenConstructionReceipt {
        protocol_version: receipt.protocol_version.clone(),
        strategy_id: receipt.strategy_id,
        relation: receipt.relation,
        source_identity: receipt.source_identity.clone(),
        source_artifact_sha256: receipt.source_artifact_sha256.clone(),
        source_license_status: receipt.source_license_status.clone(),
        input_row_count: receipt.input_row_count,
        participant_count: receipt.participant_count,
        interval_count: receipt.interval_count,
        session_count: receipt.session_count,
        glance_count: receipt.glance_count,
        right_censored_count: receipt.right_censored_count,
        issue_counts: receipt.issue_counts.clone(),
    }
}

fn compact_schoedel_receipt(
    receipt: &SchoedelReconstructionReceiptV1,
) -> CompactSchoedelReconstructionReceipt {
    CompactSchoedelReconstructionReceipt {
        protocol_version: receipt.protocol_version.clone(),
        strategy_id: receipt.strategy_id.clone(),
        relation: receipt.relation,
        source_identity: receipt.source_identity.clone(),
        source_version: receipt.source_version.clone(),
        source_license_status: receipt.source_license_status.clone(),
        source_scope_id: receipt.source_scope_id.clone(),
        adapter_id: receipt.adapter_id.clone(),
        completion_rule_ids: receipt.completion_rule_ids.clone(),
        input_screen_interval_count: receipt.input_screen_interval_count,
        input_event_count: receipt.input_event_count,
        episode_count: receipt.episode_count,
        bounded_episode_count: receipt.bounded_episode_count,
        singleton_zero_length_count: receipt.singleton_zero_length_count,
        right_censored_evidence_count: receipt.right_censored_evidence_count,
        issue_counts: receipt.issue_counts.clone(),
    }
}

fn compact_b05_validation_receipt(
    receipt: &B05SchoedelValidationReceipt,
) -> CompactB05SchoedelValidationReceipt {
    CompactB05SchoedelValidationReceipt {
        protocol_version: receipt.protocol_version.clone(),
        status: receipt.status,
        decoded_input_row_count: receipt.decoded_input_row_count,
        foundational_episode_count: receipt.foundational_episode_count,
        foundational_bounded_episode_count: receipt.foundational_bounded_episode_count,
        foundational_unbounded_episode_count: receipt.foundational_unbounded_episode_count,
        minimum_duration_excluded_episode_count: receipt.minimum_duration_excluded_episode_count,
        concurrent_generated_subinterval_count: receipt.concurrent_generated_subinterval_count,
        zero_duration_removed_row_count: receipt.zero_duration_removed_row_count,
        selected_b05_strategy_id: receipt.selected_b05_strategy_id,
        trusted_schoedel_retained_event_count: receipt.trusted_schoedel_retained_event_count,
        schoedel_decisive_participant_count: receipt.schoedel_decisive_participant_count,
    }
}

const FOUNDATIONAL_SCIENTIFIC_QUERY_ROOTS: &[&str] = &[
    "classify_episode_durations",
    "segment_concurrent_usage",
    "remove_selected_interaction_types",
];
const B05_SCREEN_SCIENTIFIC_QUERY_ROOTS: &[&str] = &["construct_screen_intervals"];
const SCHOEDEL_SCIENTIFIC_QUERY_ROOTS: &[&str] = &["match_app_episodes"];

fn stable_id(parts: &[&str]) -> String {
    sha256_bytes(parts.join("\u{1f}").as_bytes())
}

fn scientific_query_cone(query_roots: &[&str]) -> BTreeSet<&'static str> {
    let definitions = WORKFLOW_QUERIES
        .iter()
        .map(|definition| (definition.id, definition))
        .collect::<BTreeMap<_, _>>();
    let mut pending = query_roots.to_vec();
    let mut cone = BTreeSet::new();
    while let Some(query_id) = pending.pop() {
        let Some(definition) = definitions.get(query_id) else {
            continue;
        };
        if cone.insert(definition.id) {
            pending.extend(definition.inputs.iter().copied());
        }
    }
    cone
}

fn source_role_predicate_matches(
    predicate: &QuerySourceRolePredicate,
    exact_options: &serde_json::Map<String, Value>,
) -> bool {
    match predicate {
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
    }
}

fn evaluate_query_applicability(
    expression: &ApplicabilityExpression,
    options: &serde_json::Map<String, Value>,
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
            .all(|term| evaluate_query_applicability(term, options, support_roles)),
        ApplicabilityExpression::Any { terms } => terms
            .iter()
            .any(|term| evaluate_query_applicability(term, options, support_roles)),
        ApplicabilityExpression::Not { term } => {
            !evaluate_query_applicability(term, options, support_roles)
        }
    }
}

fn validate_query_execution_applicability(
    executions: &[QueryExecution],
    exact_options: &serde_json::Map<String, Value>,
    assignments: &BTreeMap<&str, &RoleAssignment>,
) -> Result<(), String> {
    let mut applicability_options = exact_options.clone();
    let usage_mode = exact_options
        .get("usage_session_mode")
        .and_then(Value::as_str)
        .unwrap_or("app_usage");
    applicability_options.insert(
        "process_app_usage".into(),
        Value::Bool(matches!(usage_mode, "app_usage" | "app_and_screen_usage")),
    );
    applicability_options.insert(
        "process_screen_usage".into(),
        Value::Bool(matches!(
            usage_mode,
            "screen_usage" | "app_and_screen_usage"
        )),
    );
    let support_roles = assignments.keys().copied().collect::<BTreeSet<_>>();
    for execution in executions {
        let applicable = evaluate_query_applicability(
            &query_applicability(&execution.query_id),
            &applicability_options,
            &support_roles,
        );
        if execution.status == "error" || (execution.status == "bypassed") == applicable {
            return Err(format!(
                "semantic query applicability/status mismatch: {}",
                execution.query_id
            ));
        }
    }
    Ok(())
}

fn validated_role_assignments(
    source: &IndexSource,
) -> Result<BTreeMap<&str, &RoleAssignment>, String> {
    let mut assignments = BTreeMap::new();
    for assignment in &source.role_assignments {
        if assignment.role_id.trim().is_empty()
            || !is_sha256(&assignment.artifact.digest)
            || assignment.artifact.artifact_id
                != format!(
                    "urn:chronicle:artifact:{}:{}",
                    assignment.role_id,
                    &assignment.artifact.digest[7..]
                )
            || assignment.assignment_id
                != stable_id(&[
                    "assignment",
                    &assignment.role_id,
                    &assignment.artifact.digest,
                ])
            || assignments
                .insert(assignment.role_id.as_str(), assignment)
                .is_some()
        {
            return Err("semantic role assignment identity invalid".into());
        }
    }
    Ok(assignments)
}

fn scientific_branch_roles(
    _source: &IndexSource,
    assignments: &BTreeMap<&str, &RoleAssignment>,
    exact_options: &serde_json::Map<String, Value>,
    query_roots: &[&str],
) -> BTreeSet<&'static str> {
    let mut roles = BTreeSet::from(["raw_chronicle_csv", "processing_options"]);
    for query_id in scientific_query_cone(query_roots) {
        for binding in query_source_role_bindings(query_id) {
            if binding
                .when_all
                .iter()
                .all(|predicate| source_role_predicate_matches(predicate, exact_options))
                && assignments.contains_key(binding.role)
            {
                roles.insert(binding.role);
            }
        }
    }
    roles
}

fn scientific_branch_dependencies(
    source: &IndexSource,
    assignments: &BTreeMap<&str, &RoleAssignment>,
    exact_options: &serde_json::Map<String, Value>,
    query_roots: &[&str],
) -> Vec<String> {
    let mut dependencies = scientific_branch_roles(source, assignments, exact_options, query_roots)
        .into_iter()
        .filter_map(|role| assignments.get(role))
        .map(|assignment| assignment.artifact.digest.clone())
        .chain(std::iter::once(source.exact_options_digest.clone()))
        .collect::<Vec<_>>();
    dependencies.sort();
    dependencies.dedup();
    dependencies
}

fn exact_dependencies(
    artifact: &ScientificArtifactMetadata,
    expected: impl IntoIterator<Item = String>,
) -> Result<(), String> {
    let mut expected = expected.into_iter().collect::<Vec<_>>();
    expected.sort();
    expected.dedup();
    if artifact.derived_from != expected {
        return Err(format!(
            "semantic scientific artifact dependency mismatch: {}",
            artifact.kind
        ));
    }
    Ok(())
}

fn exact_source_bindings(
    artifact: &ScientificArtifactMetadata,
    assignments: &BTreeMap<&str, &RoleAssignment>,
    expected_roles: &BTreeSet<&str>,
) -> Result<(), String> {
    if artifact
        .scientific_source_bindings
        .windows(2)
        .any(|pair| pair[0].role_id >= pair[1].role_id)
    {
        return Err("semantic scientific source bindings are not canonical".into());
    }
    let expected = assignments
        .iter()
        .filter(|(role, _)| expected_roles.contains(**role))
        .map(|(_, assignment)| ScientificSourceBinding {
            role_id: assignment.role_id.clone(),
            artifact_digest: assignment.artifact.digest.clone(),
            assignment_id: assignment.assignment_id.clone(),
        })
        .collect::<Vec<_>>();
    if artifact.scientific_source_bindings != expected {
        return Err(format!(
            "semantic scientific source binding mismatch: {}",
            artifact.kind
        ));
    }
    Ok(())
}

fn scientific_artifact_graph(kind: &str) -> &'static str {
    match kind {
        "b05-screen-construction-evidence-json" => B05_SCREEN_GRAPH,
        "schoedel-reconstruction-evidence-json" => SCHOEDEL_GRAPH,
        "b05-schoedel-validation-receipt-json" => SCIENTIFIC_ATTESTATION_GRAPH,
        "eyes-tagged-fau-evidence-json" | "eyes-tagged-fau-validation-receipt-json" => EYES_GRAPH,
        _ => FOUNDATIONAL_GRAPH,
    }
}

fn validate_capability_assignment_pair(
    assignments: &BTreeMap<&str, &RoleAssignment>,
    artifact_digest: Option<&str>,
    assignment_digest: Option<&str>,
) -> Result<(), String> {
    match (artifact_digest, assignment_digest) {
        (Some(artifact_digest), Some(assignment_digest)) => {
            let assignment = assignments
                .get("input_capability_evidence_file")
                .ok_or_else(|| "semantic capability assignment missing".to_string())?;
            if assignment.artifact.digest != artifact_digest
                || assignment.assignment_id != assignment_digest
                || assignment_digest != capability_evidence_assignment_digest(artifact_digest)
            {
                return Err("semantic capability assignment binding mismatch".into());
            }
            Ok(())
        }
        (None, None) => Ok(()),
        _ => Err("semantic capability assignment pair incomplete".into()),
    }
}

fn validate_scientific_evidence(
    source: &IndexSource,
    contents: &ParsedScientificEvidence,
) -> Result<(), String> {
    if source.scientific_evidence.protocol_version
        != "chronicle-runtime-scientific-evidence-summary/v2"
    {
        return Err("semantic scientific evidence summary protocol mismatch".into());
    }
    let exact_options_bytes = serde_jcs::to_vec(&source.exact_options)
        .map_err(|error| format!("canonicalize exact semantic options: {error}"))?;
    let exact_options_value = serde_json::to_value(&source.exact_options)
        .map_err(|error| format!("project exact semantic options: {error}"))?;
    let exact_options = exact_options_value
        .as_object()
        .ok_or_else(|| "exact semantic options must be an object".to_string())?;
    let role_assignments = validated_role_assignments(source)?;
    validate_query_execution_applicability(
        &source.query_executions,
        exact_options,
        &role_assignments,
    )?;
    if role_assignments
        .get("raw_chronicle_csv")
        .map(|assignment| assignment.artifact.digest.as_str())
        != Some(source.input_digest.as_str())
        || role_assignments
            .get("processing_options")
            .map(|assignment| assignment.artifact.digest.as_str())
            != Some(source.exact_options_digest.as_str())
    {
        return Err("semantic scientific root assignment mismatch".into());
    }
    if sha256_bytes(&exact_options_bytes) != source.exact_options_digest
        || contents
            .b05_schoedel_validation_receipt
            .verified_raw_input_digest
            != source.input_digest
    {
        return Err("semantic scientific request identity mismatch".into());
    }
    let options = source.exact_options.clone().into_pipeline_options();
    validate_foundational_semantics_evidence_for_options(
        &contents.foundational_semantics_evidence,
        &options,
    )
    .map_err(|_| "semantic foundational evidence validation failed".to_string())?;
    validate_b05_schoedel_validation_receipt_integrity(
        &contents.b05_schoedel_validation_receipt,
        &contents.finalized_b05_schoedel_preflight,
        &contents.foundational_semantics_evidence,
        &options,
    )
    .map_err(|_| "semantic scientific attestation validation failed".to_string())?;
    // The kernel binds the computation projection — the exact options minus
    // the contract-declared artifact-only fields — into scientific receipts.
    // Recompute that projection from the same contract constant instead of
    // comparing against the full request digest.
    let mut computation_object = exact_options.clone();
    for field in RUNTIME_ARTIFACT_REQUEST_FIELDS {
        computation_object.remove(*field);
    }
    let computation_options_digest = sha256_bytes(
        &serde_jcs::to_vec(&serde_json::Value::Object(computation_object)).map_err(|error| {
            format!("canonicalize computation semantic options: {error}")
        })?,
    );
    if contents
        .b05_schoedel_validation_receipt
        .request_options_digest
        != computation_options_digest
        || contents
            .b05_schoedel_validation_receipt
            .options_digest_origin
            != B05OptionsDigestOrigin::VerifiedRequestJcs
        || source.scientific_evidence.b05_schoedel_validation_receipt
            != compact_b05_validation_receipt(&contents.b05_schoedel_validation_receipt)
        || source.scientific_evidence.finalized_b05_schoedel
            != compact_b05_schoedel(&contents.finalized_b05_schoedel_preflight)?
        || source.scientific_evidence.micro_use_receipt
            != contents.foundational_semantics_evidence.micro_use
        || source.scientific_evidence.minimum_duration_receipt
            != compact_minimum_duration_receipt(
                &contents.foundational_semantics_evidence.minimum_duration,
            )
        || source
            .scientific_evidence
            .concurrent_subinterval_floor_receipt
            != contents
                .foundational_semantics_evidence
                .concurrent_subinterval_floor
        || source.scientific_evidence.zero_duration_cleanup_receipt
            != compact_zero_duration_cleanup_receipt(
                &contents
                    .foundational_semantics_evidence
                    .zero_duration_cleanup
                    .receipt,
            )
    {
        return Err("semantic scientific summary projection mismatch".into());
    }

    let mut artifacts = BTreeMap::new();
    for artifact in &source.scientific_evidence_artifacts {
        if !matches!(
            artifact.kind.as_str(),
            "foundational-semantics-receipt-json"
                | "minimum-duration-excluded-lineage-json"
                | "zero-duration-cleanup-evidence-json"
                | "zero-duration-removed-lineage-json"
                | "b05-screen-construction-evidence-json"
                | "schoedel-reconstruction-evidence-json"
                | "b05-schoedel-validation-receipt-json"
                | "eyes-tagged-fau-evidence-json"
                | "eyes-tagged-fau-validation-receipt-json"
        ) || artifact.media_type != "application/json"
            || !is_sha256(&artifact.digest)
            || artifact.artifact_id
                != format!(
                    "urn:chronicle:artifact:{}:{}",
                    artifact.kind,
                    &artifact.digest[7..]
                )
            || artifact.row_count.is_some()
            || artifact.preview_rows.is_some()
            || artifact
                .derived_from
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
            || artifacts.insert(artifact.kind.as_str(), artifact).is_some()
        {
            return Err("semantic scientific artifact metadata invalid".into());
        }
    }
    let assignment_roots = role_assignments
        .values()
        .map(|assignment| assignment.artifact.digest.as_str())
        .chain(std::iter::once(source.exact_options_digest.as_str()))
        .collect::<std::collections::BTreeSet<_>>();
    let artifact_digests = artifacts
        .values()
        .map(|artifact| artifact.digest.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if artifacts.values().any(|artifact| {
        artifact.derived_from.iter().any(|digest| {
            !assignment_roots.contains(digest.as_str())
                && !artifact_digests.contains(digest.as_str())
        })
    }) {
        return Err("semantic scientific artifact dependency closure invalid".into());
    }
    let foundational_dependencies = scientific_branch_dependencies(
        source,
        &role_assignments,
        exact_options,
        FOUNDATIONAL_SCIENTIFIC_QUERY_ROOTS,
    );
    let foundational_roles = scientific_branch_roles(
        source,
        &role_assignments,
        exact_options,
        FOUNDATIONAL_SCIENTIFIC_QUERY_ROOTS,
    );
    let mut screen_dependencies = scientific_branch_dependencies(
        source,
        &role_assignments,
        exact_options,
        B05_SCREEN_SCIENTIFIC_QUERY_ROOTS,
    );
    let mut screen_roles = scientific_branch_roles(
        source,
        &role_assignments,
        exact_options,
        B05_SCREEN_SCIENTIFIC_QUERY_ROOTS,
    );
    let mut schoedel_dependencies = scientific_branch_dependencies(
        source,
        &role_assignments,
        exact_options,
        SCHOEDEL_SCIENTIFIC_QUERY_ROOTS,
    );
    let mut schoedel_roles = scientific_branch_roles(
        source,
        &role_assignments,
        exact_options,
        SCHOEDEL_SCIENTIFIC_QUERY_ROOTS,
    );
    let screen_requires_capability = contents
        .finalized_b05_schoedel_preflight
        .screen_construction
        .as_ref()
        .and_then(|screen| screen.applicability.evidence_artifact_digest.as_ref())
        .is_some();
    let schoedel_requires_capability = contents
        .finalized_b05_schoedel_preflight
        .schoedel_reconstruction
        .as_ref()
        .and_then(|schoedel| schoedel.applicability.source_order_resolution.as_ref())
        .and_then(|resolution| resolution.evidence_artifact_digest.as_ref())
        .is_some();
    let capability_assignment = role_assignments.get("input_capability_evidence_file");
    if screen_requires_capability {
        screen_roles.insert("input_capability_evidence_file");
        screen_dependencies.push(
            capability_assignment
                .ok_or_else(|| "semantic capability assignment missing".to_string())?
                .artifact
                .digest
                .clone(),
        );
    }
    if schoedel_requires_capability {
        schoedel_roles.insert("input_capability_evidence_file");
        schoedel_dependencies.push(
            capability_assignment
                .ok_or_else(|| "semantic capability assignment missing".to_string())?
                .artifact
                .digest
                .clone(),
        );
    }
    screen_dependencies.sort();
    screen_dependencies.dedup();
    schoedel_dependencies.sort();
    schoedel_dependencies.dedup();
    let active_roles = foundational_roles
        .iter()
        .chain(&screen_roles)
        .chain(&schoedel_roles)
        .copied()
        .collect::<BTreeSet<_>>();
    let mut active_dependencies = foundational_dependencies
        .iter()
        .chain(&screen_dependencies)
        .chain(&schoedel_dependencies)
        .cloned()
        .collect::<Vec<_>>();
    active_dependencies.sort();
    active_dependencies.dedup();

    let expected_artifact = |kind: &str, digest: String, size: u64| -> Result<(), String> {
        let artifact = artifacts
            .get(kind)
            .ok_or_else(|| format!("semantic scientific artifact missing: {kind}"))?;
        if artifact.digest != digest || artifact.size != size {
            return Err(format!(
                "semantic scientific artifact digest mismatch: {kind}"
            ));
        }
        Ok(())
    };
    let (foundational_digest, foundational_size) = sha256_jcs(
        &contents.foundational_semantics_evidence,
        "foundational semantics evidence",
    )?;
    expected_artifact(
        "foundational-semantics-receipt-json",
        foundational_digest.clone(),
        foundational_size,
    )?;
    exact_dependencies(
        artifacts["foundational-semantics-receipt-json"],
        foundational_dependencies.clone(),
    )?;
    exact_source_bindings(
        artifacts["foundational-semantics-receipt-json"],
        &role_assignments,
        &foundational_roles,
    )?;
    if source
        .scientific_evidence
        .foundational_semantics_artifact_digest
        != foundational_digest
    {
        return Err("semantic foundational summary digest mismatch".into());
    }

    let excluded_bytes =
        minimum_duration_excluded_lineage_bytes(&contents.foundational_semantics_evidence)?;
    let excluded_digest = sha256_bytes(&excluded_bytes);
    if contents
        .foundational_semantics_evidence
        .minimum_duration_excluded_episodes
        .is_empty()
    {
        if artifacts.contains_key("minimum-duration-excluded-lineage-json")
            || source
                .scientific_evidence
                .minimum_duration_excluded_lineage_artifact_digest
                .is_some()
        {
            return Err("semantic empty B04 lineage was materialized".into());
        }
    } else {
        expected_artifact(
            "minimum-duration-excluded-lineage-json",
            excluded_digest.clone(),
            excluded_bytes.len() as u64,
        )?;
        exact_dependencies(
            artifacts["minimum-duration-excluded-lineage-json"],
            [foundational_digest.clone()],
        )?;
        exact_source_bindings(
            artifacts["minimum-duration-excluded-lineage-json"],
            &role_assignments,
            &BTreeSet::new(),
        )?;
        if source
            .scientific_evidence
            .minimum_duration_excluded_lineage_artifact_digest
            .as_deref()
            != Some(excluded_digest.as_str())
        {
            return Err("semantic B04 summary digest mismatch".into());
        }
    }

    let app_stage = matches!(
        source.exact_options.usage_session_mode.as_str(),
        "app_usage" | "app_and_screen_usage"
    );
    let zero_cleanup = &contents
        .foundational_semantics_evidence
        .zero_duration_cleanup;
    if app_stage {
        let (digest, size) = sha256_jcs(zero_cleanup, "zero-duration cleanup evidence")?;
        expected_artifact("zero-duration-cleanup-evidence-json", digest.clone(), size)?;
        exact_dependencies(
            artifacts["zero-duration-cleanup-evidence-json"],
            [foundational_digest.clone()],
        )?;
        exact_source_bindings(
            artifacts["zero-duration-cleanup-evidence-json"],
            &role_assignments,
            &BTreeSet::new(),
        )?;
        if source
            .scientific_evidence
            .zero_duration_cleanup_evidence_artifact_digest
            .as_deref()
            != Some(digest.as_str())
        {
            return Err("semantic zero-cleanup summary digest mismatch".into());
        }
    } else if artifacts.contains_key("zero-duration-cleanup-evidence-json")
        || source
            .scientific_evidence
            .zero_duration_cleanup_evidence_artifact_digest
            .is_some()
    {
        return Err("semantic inactive zero-cleanup evidence was materialized".into());
    }
    let zero_lineage_bytes =
        zero_duration_removed_lineage_bytes(&contents.foundational_semantics_evidence)?;
    let zero_lineage_digest = sha256_bytes(&zero_lineage_bytes);
    if zero_cleanup.removed_rows.is_empty() {
        if artifacts.contains_key("zero-duration-removed-lineage-json")
            || source
                .scientific_evidence
                .zero_duration_removed_lineage_artifact_digest
                .is_some()
        {
            return Err("semantic empty zero lineage was materialized".into());
        }
    } else {
        expected_artifact(
            "zero-duration-removed-lineage-json",
            zero_lineage_digest.clone(),
            zero_lineage_bytes.len() as u64,
        )?;
        exact_dependencies(
            artifacts["zero-duration-removed-lineage-json"],
            [foundational_digest.clone()],
        )?;
        exact_source_bindings(
            artifacts["zero-duration-removed-lineage-json"],
            &role_assignments,
            &BTreeSet::new(),
        )?;
        if source
            .scientific_evidence
            .zero_duration_removed_lineage_artifact_digest
            .as_deref()
            != Some(zero_lineage_digest.as_str())
        {
            return Err("semantic zero-lineage summary digest mismatch".into());
        }
    }

    match contents
        .finalized_b05_schoedel_preflight
        .screen_construction
        .as_ref()
    {
        Some(screen) => {
            let (digest, size) = sha256_jcs(screen, "B05 screen evidence")?;
            expected_artifact(
                "b05-screen-construction-evidence-json",
                digest.clone(),
                size,
            )?;
            validate_capability_assignment_pair(
                &role_assignments,
                screen.applicability.evidence_artifact_digest.as_deref(),
                screen.applicability.evidence_assignment_digest.as_deref(),
            )?;
            exact_dependencies(
                artifacts["b05-screen-construction-evidence-json"],
                screen_dependencies.iter().cloned().chain(
                    screen
                        .applicability
                        .evidence_artifact_digest
                        .iter()
                        .cloned(),
                ),
            )?;
            exact_source_bindings(
                artifacts["b05-screen-construction-evidence-json"],
                &role_assignments,
                &screen_roles,
            )?;
            if source
                .scientific_evidence
                .b05_screen_construction_artifact_digest
                .as_deref()
                != Some(digest.as_str())
                || source.scientific_evidence.b05_screen_construction_receipt
                    != screen
                        .construction_receipt
                        .as_ref()
                        .map(compact_screen_receipt)
            {
                return Err("semantic B05 screen summary mismatch".into());
            }
        }
        None => {
            if artifacts.contains_key("b05-screen-construction-evidence-json")
                || source
                    .scientific_evidence
                    .b05_screen_construction_artifact_digest
                    .is_some()
                || source
                    .scientific_evidence
                    .b05_screen_construction_receipt
                    .is_some()
            {
                return Err("semantic inactive B05 screen graph materialized".into());
            }
        }
    }
    match contents
        .finalized_b05_schoedel_preflight
        .schoedel_reconstruction
        .as_ref()
    {
        Some(schoedel) => {
            let (digest, size) = sha256_jcs(schoedel, "Schoedel evidence")?;
            expected_artifact(
                "schoedel-reconstruction-evidence-json",
                digest.clone(),
                size,
            )?;
            let source_order_resolution = schoedel.applicability.source_order_resolution.as_ref();
            validate_capability_assignment_pair(
                &role_assignments,
                source_order_resolution
                    .and_then(|resolution| resolution.evidence_artifact_digest.as_deref()),
                source_order_resolution
                    .and_then(|resolution| resolution.evidence_assignment_digest.as_deref()),
            )?;
            exact_dependencies(
                artifacts["schoedel-reconstruction-evidence-json"],
                schoedel_dependencies
                    .iter()
                    .cloned()
                    .chain(
                        source
                            .scientific_evidence
                            .b05_screen_construction_artifact_digest
                            .iter()
                            .cloned(),
                    )
                    .chain(source_order_resolution.into_iter().flat_map(|resolution| {
                        resolution.evidence_artifact_digest.iter().cloned()
                    })),
            )?;
            exact_source_bindings(
                artifacts["schoedel-reconstruction-evidence-json"],
                &role_assignments,
                &schoedel_roles,
            )?;
            if source
                .scientific_evidence
                .schoedel_reconstruction_artifact_digest
                .as_deref()
                != Some(digest.as_str())
                || source.scientific_evidence.schoedel_reconstruction_receipt
                    != schoedel
                        .reconstruction_receipt
                        .as_ref()
                        .map(compact_schoedel_receipt)
            {
                return Err("semantic Schoedel summary mismatch".into());
            }
        }
        None => {
            if artifacts.contains_key("schoedel-reconstruction-evidence-json")
                || source
                    .scientific_evidence
                    .schoedel_reconstruction_artifact_digest
                    .is_some()
                || source
                    .scientific_evidence
                    .schoedel_reconstruction_receipt
                    .is_some()
            {
                return Err("semantic inactive Schoedel graph materialized".into());
            }
        }
    }
    if contents
        .finalized_b05_schoedel_preflight
        .screen_construction
        .is_none()
        && contents
            .finalized_b05_schoedel_preflight
            .schoedel_reconstruction
            .is_none()
        && role_assignments.contains_key("input_capability_evidence_file")
    {
        return Err("semantic inactive capability assignment was retained".into());
    }
    let (validation_digest, validation_size) = sha256_jcs(
        &contents.b05_schoedel_validation_receipt,
        "B05/Schoedel validation receipt",
    )?;
    expected_artifact(
        "b05-schoedel-validation-receipt-json",
        validation_digest.clone(),
        validation_size,
    )?;
    exact_dependencies(
        artifacts["b05-schoedel-validation-receipt-json"],
        active_dependencies
            .iter()
            .cloned()
            .chain(std::iter::once(foundational_digest.clone()))
            .chain(
                source
                    .scientific_evidence
                    .minimum_duration_excluded_lineage_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                source
                    .scientific_evidence
                    .zero_duration_cleanup_evidence_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                source
                    .scientific_evidence
                    .zero_duration_removed_lineage_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                source
                    .scientific_evidence
                    .b05_screen_construction_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                source
                    .scientific_evidence
                    .schoedel_reconstruction_artifact_digest
                    .iter()
                    .cloned(),
            ),
    )?;
    exact_source_bindings(
        artifacts["b05-schoedel-validation-receipt-json"],
        &role_assignments,
        &active_roles,
    )?;
    if source
        .scientific_evidence
        .b05_schoedel_validation_receipt_artifact_digest
        != validation_digest
    {
        return Err("semantic validation artifact summary mismatch".into());
    }

    match source.eyes_evidence.tagged_fau_artifact_digest.as_ref() {
        Some(expected_digest) => {
            let eyes_partition = source
                .scientific_evidence
                .eyes_input_partition
                .as_ref()
                .ok_or_else(|| "semantic EYES partition receipt missing".to_string())?;
            let mut resolution_material = eyes_partition.clone();
            resolution_material.resolution_digest.clear();
            let expected_resolution_digest = sha256_bytes(
                &serde_json::to_vec(&resolution_material)
                    .map_err(|error| format!("serialize EYES partition receipt: {error}"))?,
            );
            if eyes_partition.protocol_version != "chronicle-eyes-input-partition-preflight/v2"
                || eyes_partition.disposition != ScientificPreflightDisposition::Executable
                || eyes_partition.input_digest != source.input_digest
                || eyes_partition.options_digest != computation_options_digest
                || eyes_partition.options_digest_origin
                    != EyesInputPartitionOptionsDigestOrigin::VerifiedRequestJcs
                || eyes_partition.requested_episode_strategy_id != "eyes_complement"
                || eyes_partition.effective_episode_strategy_id.as_deref()
                    != Some("eyes_complement")
                || eyes_partition.relation != Some(ScientificRelation::PartialReplay)
                || eyes_partition.refusal_reason.is_some()
                || eyes_partition.refusal_detail.is_some()
                || eyes_partition.fragmented_participant_count != 0
                || eyes_partition.resolution_digest != expected_resolution_digest
            {
                return Err("semantic EYES partition receipt invalid".into());
            }
            let receipt = contents
                .eyes_tagged_fau_validation_receipt
                .as_ref()
                .ok_or_else(|| "semantic EYES validation receipt missing".to_string())?;
            if source.eyes_evidence.validation_receipt.as_ref() != Some(receipt)
                || source
                    .scientific_evidence
                    .eyes_tagged_fau_validation_receipt
                    .as_ref()
                    != Some(receipt)
                || source.eyes_evidence.validation_receipt_artifact_digest
                    != source
                        .scientific_evidence
                        .eyes_tagged_fau_validation_receipt_artifact_digest
            {
                return Err("semantic EYES validation summary mismatch".into());
            }
            validate_eyes_tagged_fau_validation_receipt_integrity(
                receipt,
                &contents.eyes_tagged_fau_evidence,
                eyes_partition,
                &options,
                &source.input_digest,
                &computation_options_digest,
                EyesInputPartitionOptionsDigestOrigin::VerifiedRequestJcs,
            )
            .map_err(|_| "semantic EYES validation receipt invalid".to_string())?;
            let eyes_bytes =
                eyes_tagged_fau_artifact_jcs_bytes(&contents.eyes_tagged_fau_evidence)?;
            let digest = sha256_bytes(&eyes_bytes);
            expected_artifact(
                "eyes-tagged-fau-evidence-json",
                digest.clone(),
                eyes_bytes.len() as u64,
            )?;
            exact_dependencies(
                artifacts["eyes-tagged-fau-evidence-json"],
                [
                    source.input_digest.clone(),
                    source.exact_options_digest.clone(),
                ],
            )?;
            exact_source_bindings(
                artifacts["eyes-tagged-fau-evidence-json"],
                &role_assignments,
                &BTreeSet::from(["raw_chronicle_csv", "processing_options"]),
            )?;
            if &digest != expected_digest {
                return Err("semantic EYES artifact summary mismatch".into());
            }
            let (receipt_digest, receipt_size) =
                sha256_jcs(receipt, "EYES tagged-FAU validation receipt")?;
            expected_artifact(
                "eyes-tagged-fau-validation-receipt-json",
                receipt_digest.clone(),
                receipt_size,
            )?;
            exact_dependencies(
                artifacts["eyes-tagged-fau-validation-receipt-json"],
                [
                    source.input_digest.clone(),
                    source.exact_options_digest.clone(),
                    digest,
                ],
            )?;
            exact_source_bindings(
                artifacts["eyes-tagged-fau-validation-receipt-json"],
                &role_assignments,
                &BTreeSet::from(["raw_chronicle_csv", "processing_options"]),
            )?;
            if source
                .eyes_evidence
                .validation_receipt_artifact_digest
                .as_deref()
                != Some(receipt_digest.as_str())
            {
                return Err("semantic EYES validation artifact summary mismatch".into());
            }
        }
        None => {
            if !contents.eyes_tagged_fau_evidence.is_empty()
                || contents.eyes_tagged_fau_validation_receipt.is_some()
                || artifacts.contains_key("eyes-tagged-fau-evidence-json")
                || artifacts.contains_key("eyes-tagged-fau-validation-receipt-json")
                || source.scientific_evidence.eyes_input_partition.is_some()
                || source
                    .scientific_evidence
                    .eyes_tagged_fau_validation_receipt
                    .is_some()
                || source
                    .scientific_evidence
                    .eyes_tagged_fau_validation_receipt_artifact_digest
                    .is_some()
            {
                return Err("semantic inactive EYES evidence materialized".into());
            }
        }
    }
    Ok(())
}

fn build_index(source: &IndexSource) -> Vec<u8> {
    let mut quads = Vec::new();
    for assignment in &source.role_assignments {
        let assignment_iri = resource_iri("assignment", &assignment.assignment_id);
        let artifact_iri = resource_iri("artifact", &assignment.artifact.artifact_id);
        quads.push(quad(
            &artifact_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ENTITY),
            ASSIGNMENTS_GRAPH,
        ));
        quads.push(quad(
            &assignment_iri,
            &predicate("role"),
            &resource_iri("role", &assignment.role_id),
            ASSIGNMENTS_GRAPH,
        ));
        quads.push(quad(
            &assignment_iri,
            &predicate("artifact"),
            &artifact_iri,
            ASSIGNMENTS_GRAPH,
        ));
        quads.push(quad(
            &artifact_iri,
            &predicate("digest"),
            &literal(&assignment.artifact.digest),
            ASSIGNMENTS_GRAPH,
        ));
    }
    for trace in &source.qualification_traces {
        let trace_iri = resource_iri("qualification-trace", &trace.trace_id);
        quads.push(quad(
            &trace_iri,
            &predicate("candidate"),
            &resource_iri("candidate", &trace.candidate_id),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("candidateRevision"),
            &unsigned_long_literal(trace.candidate_revision),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("artifactDigest"),
            &literal(&trace.artifact_digest),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("qualifiersDigest"),
            &literal(&trace.qualifiers_digest),
            QUALIFICATION_GRAPH,
        ));
        for role_id in &trace.asserted_role_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("assertedRole"),
                &resource_iri("role", role_id),
                QUALIFICATION_GRAPH,
            ));
        }
        if let Some(role_id) = &trace.selected_role_id {
            quads.push(quad(
                &trace_iri,
                &predicate("selectedRole"),
                &resource_iri("role", role_id),
                QUALIFICATION_GRAPH,
            ));
        }
        quads.push(quad(
            &trace_iri,
            &predicate("decision"),
            &urn("qualification-decision", &trace.decision),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("reason"),
            &resource_iri("reason", &trace.reason_id),
            QUALIFICATION_GRAPH,
        ));
        for (index, rule) in trace.rule_evaluations.iter().enumerate() {
            let evaluation_iri = urn(
                "qualification-evaluation",
                &format!("{}:{index}:{}", trace.trace_id, rule.rule_id),
            );
            quads.push(quad(
                &trace_iri,
                &predicate("ruleEvaluation"),
                &evaluation_iri,
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("rule"),
                &resource_iri("qualification-rule", &rule.rule_id),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("passed"),
                &boolean_literal(rule.passed),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("expected"),
                &literal(&rule.expected),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("observed"),
                &literal(&rule.observed),
                QUALIFICATION_GRAPH,
            ));
        }
    }
    for trace in &source.requirement_traces {
        let trace_iri = resource_iri("requirement-trace", &trace.trace_id);
        quads.push(quad(
            &trace_iri,
            &predicate("role"),
            &resource_iri("role", &trace.role_id),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("required"),
            &boolean_literal(trace.required),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("unconditional"),
            &boolean_literal(trace.unconditional),
            QUALIFICATION_GRAPH,
        ));
        if let Some(condition_id) = &trace.condition_id {
            quads.push(quad(
                &trace_iri,
                &predicate("condition"),
                &resource_iri("condition", condition_id),
                QUALIFICATION_GRAPH,
            ));
        }
        if let Some(condition_result) = trace.condition_result {
            quads.push(quad(
                &trace_iri,
                &predicate("conditionResult"),
                &boolean_literal(condition_result),
                QUALIFICATION_GRAPH,
            ));
        }
        for candidate_trace_id in &trace.candidate_trace_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("candidateTrace"),
                &resource_iri("qualification-trace", candidate_trace_id),
                QUALIFICATION_GRAPH,
            ));
        }
        for assignment_id in &trace.accepted_assignment_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("acceptedAssignment"),
                &resource_iri("assignment", assignment_id),
                QUALIFICATION_GRAPH,
            ));
        }
        quads.push(quad(
            &trace_iri,
            &predicate("state"),
            &urn("state", &trace.state),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("reason"),
            &resource_iri("reason", &trace.reason_id),
            QUALIFICATION_GRAPH,
        ));
    }
    for obligation in &source.open_obligations {
        let obligation_iri = resource_iri("obligation", &obligation.obligation_id);
        quads.push(quad(
            &obligation_iri,
            &predicate("role"),
            &resource_iri("role", &obligation.role_id),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("queryGroup"),
            &urn(
                "query-group",
                obligation.query_group_id.as_deref().unwrap_or("root"),
            ),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("state"),
            &urn("state", &obligation.state),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("reason"),
            &resource_iri("reason", &obligation.reason_id),
            OBLIGATIONS_GRAPH,
        ));
    }
    if let Some(decision) = &source.dependency_cache_decision {
        let decision_iri = urn("dependency-cache-decision", &source.input_digest);
        quads.push(quad(
            &decision_iri,
            &predicate("cacheMode"),
            &urn("dependency-cache-mode", &decision.mode),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &decision_iri,
            &predicate("empiricalEvidenceCurrent"),
            &boolean_literal(decision.empirical_evidence_current),
            EXECUTION_GRAPH,
        ));
        if let Some(digest) = &decision.certificate_digest {
            quads.push(quad(
                &decision_iri,
                &predicate("dependencyCertificate"),
                &resource_iri("dependency-certificate", digest),
                EXECUTION_GRAPH,
            ));
        }
        if let Some(digest) = &decision.binding_surface_digest {
            quads.push(quad(
                &decision_iri,
                &predicate("bindingSurfaceDigest"),
                &literal(digest),
                EXECUTION_GRAPH,
            ));
        }
        for reason in &decision.reasons {
            quads.push(quad(
                &decision_iri,
                &predicate("reason"),
                &urn("dependency-cache-reason", reason),
                EXECUTION_GRAPH,
            ));
        }
    }
    let opener_receipt_iri = urn("opener-set-receipt", &source.opener_set_receipt_digest);
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("receiptDigest"),
        &literal(&source.opener_set_receipt_digest),
        EXECUTION_GRAPH,
    ));
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("requestedOpenerSet"),
        &urn(
            "opener-set",
            &source.opener_set_receipt.applicability.requested,
        ),
        EXECUTION_GRAPH,
    ));
    if let Some(effective) = &source.opener_set_receipt.applicability.effective {
        quads.push(quad(
            &opener_receipt_iri,
            &predicate("effectiveOpenerSet"),
            &urn("opener-set", effective),
            EXECUTION_GRAPH,
        ));
    }
    // Validated (present-together, structurally sound) at parse time in
    // `rebuild_semantic_index_native`; here the receipt is projected.
    if let (Some(evidence), Some(digest)) = (
        &source.maximum_duration_receipt,
        &source.maximum_duration_receipt_digest,
    ) {
        {
            let receipt_iri = urn("maximum-duration-receipt", digest);
            let receipt = &evidence.receipt;
            quads.push(quad(
                &receipt_iri,
                &predicate("receiptDigest"),
                &literal(digest),
                EXECUTION_GRAPH,
            ));
            quads.push(quad(
                &receipt_iri,
                &predicate("maximumDurationShape"),
                &literal(receipt.applicability.shape.canonical_id()),
                EXECUTION_GRAPH,
            ));
            quads.push(quad(
                &receipt_iri,
                &predicate("requestedMaximumDurationPolicy"),
                &urn(
                    "maximum-duration-policy",
                    receipt.applicability.requested_policy.canonical_id(),
                ),
                EXECUTION_GRAPH,
            ));
            if let Some(effective) = receipt.applicability.effective_policy {
                quads.push(quad(
                    &receipt_iri,
                    &predicate("effectiveMaximumDurationPolicy"),
                    &urn("maximum-duration-policy", effective.canonical_id()),
                    EXECUTION_GRAPH,
                ));
            }
            quads.push(quad(
                &receipt_iri,
                &predicate("maximumDurationDisposition"),
                &literal(receipt.applicability.disposition.canonical_id()),
                EXECUTION_GRAPH,
            ));
            quads.push(quad(
                &receipt_iri,
                &predicate("maximumDurationThresholdSource"),
                &literal(receipt.applicability.threshold_source.canonical_id()),
                EXECUTION_GRAPH,
            ));
            if let Some(threshold_ns) = receipt.applicability.threshold_ns.as_deref() {
                quads.push(quad(
                    &receipt_iri,
                    &predicate("maximumDurationThresholdNs"),
                    &literal(threshold_ns),
                    EXECUTION_GRAPH,
                ));
            }
            quads.push(quad(
                &receipt_iri,
                &predicate("relation"),
                &literal(receipt.applicability.relation.canonical_id()),
                EXECUTION_GRAPH,
            ));
            for (name, value) in [
                ("boundedEpisodeCount", receipt.bounded_episode_count.to_string()),
                ("unboundedEpisodeCount", receipt.unbounded_episode_count.to_string()),
                ("qualifyingCount", receipt.qualifying_count.to_string()),
                ("rawDurationTotalNs", receipt.raw_duration_total_ns.clone()),
                ("effectiveDurationTotalNs", receipt.effective_duration_total_ns.clone()),
                ("trimmedTotalNs", receipt.trimmed_total_ns.clone()),
                ("droppedRawTotalNs", receipt.dropped_raw_total_ns.clone()),
                ("headlineCreditedTotalNs", receipt.headline_credited_total_ns.clone()),
                ("excludedLineageDigest", receipt.excluded_lineage_digest.clone()),
            ] {
                quads.push(quad(
                    &receipt_iri,
                    &predicate(name),
                    &literal(&value),
                    EXECUTION_GRAPH,
                ));
            }
            for (outcome, count) in &receipt.outcome_counts {
                quads.push(quad(
                    &receipt_iri,
                    &predicate(&format!("outcomeCount_{outcome}")),
                    &literal(&count.to_string()),
                    EXECUTION_GRAPH,
                ));
            }
        }
    }
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("openerSetRelation"),
        &urn(
            "opener-set-relation",
            &source.opener_set_receipt.applicability.relation,
        ),
        EXECUTION_GRAPH,
    ));
    if let Some(reason) = &source.opener_set_receipt.applicability.refusal_reason {
        quads.push(quad(
            &opener_receipt_iri,
            &predicate("openerSetRefusalReason"),
            &urn("opener-set-refusal-reason", reason),
            EXECUTION_GRAPH,
        ));
    }
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("suppressedDeviceOpenerCount"),
        &unsigned_long_literal(source.opener_set_receipt.suppressed_device_opener_count),
        EXECUTION_GRAPH,
    ));
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("selectedOpenerTypeCounts"),
        &literal(
            &serde_json::to_string(&source.opener_set_receipt.selected_opener_type_counts)
                .expect("opener counts are serializable"),
        ),
        EXECUTION_GRAPH,
    ));
    quads.push(quad(
        &opener_receipt_iri,
        &predicate("materializedOpenerTypeCounts"),
        &literal(
            &serde_json::to_string(&source.opener_set_receipt.materialized_opener_type_counts)
                .expect("opener counts are serializable"),
        ),
        EXECUTION_GRAPH,
    ));

    let scientific_artifact_iris = source
        .scientific_evidence_artifacts
        .iter()
        .map(|artifact| {
            (
                artifact.digest.as_str(),
                resource_iri("artifact", &artifact.artifact_id),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for artifact in &source.scientific_evidence_artifacts {
        let graph = scientific_artifact_graph(&artifact.kind);
        let artifact_iri = resource_iri("artifact", &artifact.artifact_id);
        quads.push(quad(
            &artifact_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ENTITY),
            graph,
        ));
        for (name, value) in [
            ("artifactKind", artifact.kind.clone()),
            ("artifactDigest", artifact.digest.clone()),
            ("artifactSize", artifact.size.to_string()),
        ] {
            quads.push(quad(
                &artifact_iri,
                &predicate(name),
                &literal(&value),
                graph,
            ));
        }
        for dependency in &artifact.derived_from {
            let Some(dependency_iri) = scientific_artifact_iris.get(dependency.as_str()) else {
                continue;
            };
            quads.push(quad(
                &artifact_iri,
                &iri(PROV_WAS_DERIVED_FROM),
                dependency_iri,
                graph,
            ));
        }
        for binding in &artifact.scientific_source_bindings {
            let assignment_iri = resource_iri("assignment", &binding.assignment_id);
            quads.push(quad(
                &artifact_iri,
                &predicate("scientificSourceAssignment"),
                &assignment_iri,
                graph,
            ));
            quads.push(quad(
                &artifact_iri,
                &iri(PROV_WAS_DERIVED_FROM),
                &assignment_iri,
                graph,
            ));
        }
    }

    let scientific = &source.scientific_evidence;
    let foundational_iri = urn(
        "foundational-semantics-evidence",
        &scientific.foundational_semantics_artifact_digest,
    );
    quads.push(quad(
        &foundational_iri,
        &iri(RDF_TYPE),
        &iri(PROV_ENTITY),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &foundational_iri,
        &predicate("artifactDigest"),
        &literal(&scientific.foundational_semantics_artifact_digest),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &foundational_iri,
        &predicate("evidenceArtifact"),
        scientific_artifact_iris
            .get(scientific.foundational_semantics_artifact_digest.as_str())
            .expect("validated foundational artifact is indexed"),
        FOUNDATIONAL_GRAPH,
    ));
    let micro_iri = urn(
        "b03-micro-use-receipt",
        &scientific.foundational_semantics_artifact_digest,
    );
    quads.push(quad(
        &micro_iri,
        &iri(RDF_TYPE),
        &urn("class", "b03-micro-use-receipt"),
        FOUNDATIONAL_GRAPH,
    ));
    for (name, value) in [
        (
            "requestedPolicy",
            enum_name(scientific.micro_use_receipt.requested_policy),
        ),
        (
            "effectivePolicy",
            enum_name(scientific.micro_use_receipt.effective_policy),
        ),
        ("relation", scientific.micro_use_receipt.relation.clone()),
        (
            "checkpoint",
            scientific.micro_use_receipt.checkpoint.clone(),
        ),
    ] {
        quads.push(quad(
            &micro_iri,
            &predicate(name),
            &literal(&value),
            FOUNDATIONAL_GRAPH,
        ));
    }
    quads.push(quad(
        &foundational_iri,
        &predicate("microUseReceipt"),
        &micro_iri,
        FOUNDATIONAL_GRAPH,
    ));
    if let Some(source_id) = &scientific.micro_use_receipt.source_id {
        quads.push(quad(
            &micro_iri,
            &predicate("sourceId"),
            &literal(source_id),
            FOUNDATIONAL_GRAPH,
        ));
    }
    if let Some(comparator) = &scientific.micro_use_receipt.comparator {
        quads.push(quad(
            &micro_iri,
            &predicate("comparator"),
            &literal(comparator),
            FOUNDATIONAL_GRAPH,
        ));
    }
    if let Some(threshold_ns) = scientific.micro_use_receipt.threshold_ns {
        quads.push(quad(
            &micro_iri,
            &predicate("thresholdNs"),
            &literal(&threshold_ns.to_string()),
            FOUNDATIONAL_GRAPH,
        ));
    }
    quads.push(quad(
        &micro_iri,
        &predicate("classCounts"),
        &literal(
            &serde_json::to_string(&scientific.micro_use_receipt.class_counts)
                .expect("validated B03 class counts are serializable"),
        ),
        FOUNDATIONAL_GRAPH,
    ));

    let minimum_iri = urn(
        "b04-minimum-duration-receipt",
        &scientific.foundational_semantics_artifact_digest,
    );
    quads.push(quad(
        &minimum_iri,
        &iri(RDF_TYPE),
        &urn("class", "b04-minimum-duration-receipt"),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &foundational_iri,
        &predicate("minimumDurationReceipt"),
        &minimum_iri,
        FOUNDATIONAL_GRAPH,
    ));
    for (name, value) in [
        (
            "relation",
            scientific.minimum_duration_receipt.relation.clone(),
        ),
        (
            "requestedComparator",
            enum_name(scientific.minimum_duration_receipt.requested_comparator),
        ),
        (
            "effectiveComparator",
            enum_name(scientific.minimum_duration_receipt.effective_comparator),
        ),
        (
            "requestedDisposition",
            enum_name(scientific.minimum_duration_receipt.requested_disposition),
        ),
        (
            "effectiveDisposition",
            enum_name(scientific.minimum_duration_receipt.effective_disposition),
        ),
        (
            "checkpoint",
            scientific.minimum_duration_receipt.checkpoint.clone(),
        ),
    ] {
        quads.push(quad(
            &minimum_iri,
            &predicate(name),
            &literal(&value),
            FOUNDATIONAL_GRAPH,
        ));
    }
    quads.push(quad(
        &minimum_iri,
        &predicate("thresholdNs"),
        &literal(&scientific.minimum_duration_receipt.threshold_ns.to_string()),
        FOUNDATIONAL_GRAPH,
    ));
    for (name, value) in [
        (
            "boundedEpisodeCount",
            scientific.minimum_duration_receipt.bounded_episode_count,
        ),
        (
            "unboundedEpisodeCount",
            scientific.minimum_duration_receipt.unbounded_episode_count,
        ),
        (
            "qualifyingCount",
            scientific.minimum_duration_receipt.qualifying_count,
        ),
        (
            "retainedCreditedCount",
            scientific.minimum_duration_receipt.retained_credited_count,
        ),
        (
            "retainedExcludedCount",
            scientific.minimum_duration_receipt.retained_excluded_count,
        ),
        (
            "droppedCount",
            scientific.minimum_duration_receipt.dropped_count,
        ),
    ] {
        quads.push(quad(
            &minimum_iri,
            &predicate(name),
            &unsigned_long_literal(u64::from(value)),
            FOUNDATIONAL_GRAPH,
        ));
    }
    if let Some(lineage_digest) = scientific
        .minimum_duration_excluded_lineage_artifact_digest
        .as_ref()
    {
        let lineage_iri = scientific_artifact_iris
            .get(lineage_digest.as_str())
            .expect("validated B04 lineage artifact is indexed");
        quads.push(quad(
            &minimum_iri,
            &predicate("excludedLineageArtifact"),
            lineage_iri,
            FOUNDATIONAL_GRAPH,
        ));
    }
    let concurrency_iri = urn(
        "concurrency-subinterval-floor-receipt",
        &scientific.foundational_semantics_artifact_digest,
    );
    quads.push(quad(
        &concurrency_iri,
        &iri(RDF_TYPE),
        &urn("class", "concurrency-subinterval-floor-receipt"),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &foundational_iri,
        &predicate("concurrencySubintervalFloorReceipt"),
        &concurrency_iri,
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &concurrency_iri,
        &predicate("effectiveApplied"),
        &boolean_literal(
            scientific
                .concurrent_subinterval_floor_receipt
                .effective_applied,
        ),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &concurrency_iri,
        &predicate("requestedApplied"),
        &boolean_literal(
            scientific
                .concurrent_subinterval_floor_receipt
                .requested_applied,
        ),
        FOUNDATIONAL_GRAPH,
    ));
    for (name, value) in [
        (
            "comparator",
            scientific
                .concurrent_subinterval_floor_receipt
                .comparator
                .clone(),
        ),
        (
            "thresholdNs",
            scientific
                .concurrent_subinterval_floor_receipt
                .threshold_ns
                .to_string(),
        ),
        (
            "checkpoint",
            scientific
                .concurrent_subinterval_floor_receipt
                .checkpoint
                .clone(),
        ),
        (
            "generatedSubintervalCount",
            scientific
                .concurrent_subinterval_floor_receipt
                .generated_subinterval_count
                .to_string(),
        ),
        (
            "blankedSubintervalCount",
            scientific
                .concurrent_subinterval_floor_receipt
                .blanked_subinterval_count
                .to_string(),
        ),
    ] {
        quads.push(quad(
            &concurrency_iri,
            &predicate(name),
            &literal(&value),
            FOUNDATIONAL_GRAPH,
        ));
    }
    let zero_iri = urn(
        "zero-duration-cleanup-receipt",
        &scientific.foundational_semantics_artifact_digest,
    );
    quads.push(quad(
        &zero_iri,
        &iri(RDF_TYPE),
        &urn("class", "zero-duration-cleanup-receipt"),
        FOUNDATIONAL_GRAPH,
    ));
    quads.push(quad(
        &foundational_iri,
        &predicate("zeroDurationCleanupReceipt"),
        &zero_iri,
        FOUNDATIONAL_GRAPH,
    ));
    if let Some(evidence_digest) = scientific
        .zero_duration_cleanup_evidence_artifact_digest
        .as_ref()
    {
        quads.push(quad(
            &zero_iri,
            &predicate("cleanupEvidenceArtifact"),
            scientific_artifact_iris
                .get(evidence_digest.as_str())
                .expect("validated zero-cleanup evidence artifact is indexed"),
            FOUNDATIONAL_GRAPH,
        ));
    }
    quads.push(quad(
        &zero_iri,
        &predicate("removedRowCount"),
        &unsigned_long_literal(u64::from(
            scientific.zero_duration_cleanup_receipt.removed_row_count,
        )),
        FOUNDATIONAL_GRAPH,
    ));
    for (name, value) in [
        (
            "requestedApplied",
            scientific.zero_duration_cleanup_receipt.requested_applied,
        ),
        (
            "effectiveApplied",
            scientific.zero_duration_cleanup_receipt.effective_applied,
        ),
    ] {
        quads.push(quad(
            &zero_iri,
            &predicate(name),
            &boolean_literal(value),
            FOUNDATIONAL_GRAPH,
        ));
    }
    for (name, value) in [
        (
            "checkpoint",
            scientific.zero_duration_cleanup_receipt.checkpoint.clone(),
        ),
        (
            "zeroEpisodeCandidateCount",
            scientific
                .zero_duration_cleanup_receipt
                .zero_episode_candidate_count
                .to_string(),
        ),
    ] {
        quads.push(quad(
            &zero_iri,
            &predicate(name),
            &literal(&value),
            FOUNDATIONAL_GRAPH,
        ));
    }
    if let Some(lineage_digest) = scientific
        .zero_duration_removed_lineage_artifact_digest
        .as_ref()
    {
        let lineage_iri = scientific_artifact_iris
            .get(lineage_digest.as_str())
            .expect("validated zero-duration lineage artifact is indexed");
        quads.push(quad(
            &zero_iri,
            &predicate("removedLineageArtifact"),
            lineage_iri,
            FOUNDATIONAL_GRAPH,
        ));
    }

    if let (Some(receipt), Some(artifact_digest)) = (
        scientific.b05_screen_construction_receipt.as_ref(),
        scientific.b05_screen_construction_artifact_digest.as_ref(),
    ) {
        let screen_iri = urn("b05-screen-construction-evidence", artifact_digest);
        quads.push(quad(
            &screen_iri,
            &iri(RDF_TYPE),
            &urn("class", "b05-screen-construction-evidence"),
            B05_SCREEN_GRAPH,
        ));
        quads.push(quad(
            &screen_iri,
            &predicate("artifactDigest"),
            &literal(artifact_digest),
            B05_SCREEN_GRAPH,
        ));
        quads.push(quad(
            &screen_iri,
            &predicate("strategy"),
            &urn("b05-screen-strategy", receipt.strategy_id.canonical_id()),
            B05_SCREEN_GRAPH,
        ));
        quads.push(quad(
            &screen_iri,
            &predicate("scientificRelation"),
            &urn("scientific-relation", receipt.relation.canonical_id()),
            B05_SCREEN_GRAPH,
        ));
        quads.push(quad(
            &screen_iri,
            &predicate("evidenceArtifact"),
            scientific_artifact_iris
                .get(artifact_digest.as_str())
                .expect("validated B05 artifact is indexed"),
            B05_SCREEN_GRAPH,
        ));
        if let Some(applicability) = scientific
            .finalized_b05_schoedel
            .screen_applicability
            .as_ref()
        {
            quads.push(quad(
                &screen_iri,
                &predicate("executable"),
                &boolean_literal(applicability.executable),
                B05_SCREEN_GRAPH,
            ));
        }
    }

    if let (Some(receipt), Some(artifact_digest)) = (
        scientific.schoedel_reconstruction_receipt.as_ref(),
        scientific.schoedel_reconstruction_artifact_digest.as_ref(),
    ) {
        let schoedel_iri = urn("schoedel-reconstruction-evidence", artifact_digest);
        quads.push(quad(
            &schoedel_iri,
            &iri(RDF_TYPE),
            &urn("class", "schoedel-reconstruction-evidence"),
            SCHOEDEL_GRAPH,
        ));
        quads.push(quad(
            &schoedel_iri,
            &predicate("artifactDigest"),
            &literal(artifact_digest),
            SCHOEDEL_GRAPH,
        ));
        quads.push(quad(
            &schoedel_iri,
            &predicate("strategy"),
            &urn("episode-reconstruction-strategy", &receipt.strategy_id),
            SCHOEDEL_GRAPH,
        ));
        quads.push(quad(
            &schoedel_iri,
            &predicate("scientificRelation"),
            &urn("scientific-relation", receipt.relation.canonical_id()),
            SCHOEDEL_GRAPH,
        ));
        quads.push(quad(
            &schoedel_iri,
            &predicate("evidenceArtifact"),
            scientific_artifact_iris
                .get(artifact_digest.as_str())
                .expect("validated Schoedel artifact is indexed"),
            SCHOEDEL_GRAPH,
        ));
        if let Some(applicability) = scientific
            .finalized_b05_schoedel
            .schoedel_applicability
            .as_ref()
        {
            quads.push(quad(
                &schoedel_iri,
                &predicate("executable"),
                &boolean_literal(applicability.executable),
                SCHOEDEL_GRAPH,
            ));
        }
    }

    let attestation_iri = urn(
        "b05-schoedel-validation-receipt",
        &scientific.b05_schoedel_validation_receipt_artifact_digest,
    );
    quads.push(quad(
        &attestation_iri,
        &predicate("artifactDigest"),
        &literal(&scientific.b05_schoedel_validation_receipt_artifact_digest),
        SCIENTIFIC_ATTESTATION_GRAPH,
    ));
    quads.push(quad(
        &attestation_iri,
        &iri(RDF_TYPE),
        &urn("class", "b05-schoedel-validation-receipt"),
        SCIENTIFIC_ATTESTATION_GRAPH,
    ));
    quads.push(quad(
        &attestation_iri,
        &predicate("validationStatus"),
        &urn(
            "validation-status",
            &enum_name(scientific.b05_schoedel_validation_receipt.status),
        ),
        SCIENTIFIC_ATTESTATION_GRAPH,
    ));
    quads.push(quad(
        &attestation_iri,
        &predicate("receiptArtifact"),
        scientific_artifact_iris
            .get(
                scientific
                    .b05_schoedel_validation_receipt_artifact_digest
                    .as_str(),
            )
            .expect("validated attestation artifact is indexed"),
        SCIENTIFIC_ATTESTATION_GRAPH,
    ));

    if let Some(artifact_digest) = &source.eyes_evidence.tagged_fau_artifact_digest {
        let eyes_disposition_iri = urn("eyes-evidence-disposition", &source.input_digest);
        let eyes_artifact_iri = scientific_artifact_iris
            .get(artifact_digest.as_str())
            .expect("validated EYES artifact is indexed");
        quads.push(quad(
            &eyes_disposition_iri,
            &predicate("replayStatus"),
            &urn(
                "eyes-replay-status",
                &enum_name(source.eyes_evidence.status),
            ),
            EYES_GRAPH,
        ));
        quads.push(quad(
            &eyes_disposition_iri,
            &predicate("episodeReconstructionStrategy"),
            &urn(
                "episode-reconstruction-strategy",
                &source.eyes_evidence.episode_reconstruction_strategy,
            ),
            EYES_GRAPH,
        ));
        quads.push(quad(
            eyes_artifact_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ENTITY),
            EYES_GRAPH,
        ));
        quads.push(quad(
            eyes_artifact_iri,
            &predicate("artifactDigest"),
            &literal(artifact_digest),
            EYES_GRAPH,
        ));
        quads.push(quad(
            &eyes_disposition_iri,
            &predicate("taggedFauEvidenceArtifact"),
            eyes_artifact_iri,
            EYES_GRAPH,
        ));
        if let (Some(receipt), Some(receipt_artifact_digest)) = (
            source.eyes_evidence.validation_receipt.as_ref(),
            source
                .eyes_evidence
                .validation_receipt_artifact_digest
                .as_ref(),
        ) {
            let receipt_iri = urn(
                "eyes-tagged-fau-validation-receipt",
                receipt_artifact_digest,
            );
            quads.push(quad(
                &eyes_disposition_iri,
                &predicate("validationReceipt"),
                &receipt_iri,
                EYES_GRAPH,
            ));
            quads.push(quad(
                &receipt_iri,
                &iri(RDF_TYPE),
                &iri(PROV_ENTITY),
                EYES_GRAPH,
            ));
            for (name, value) in [
                ("validationDigest", receipt.validation_digest.as_str()),
                ("sourceVersion", receipt.source_version.as_str()),
                ("sourceCommit", receipt.source_commit.as_str()),
                (
                    "sourceLicenseStatus",
                    receipt.source_license_status.as_str(),
                ),
            ] {
                quads.push(quad(
                    &receipt_iri,
                    &predicate(name),
                    &literal(value),
                    EYES_GRAPH,
                ));
            }
            quads.push(quad(
                &receipt_iri,
                &predicate("validationStatus"),
                &urn("eyes-validation-status", &enum_name(receipt.status)),
                EYES_GRAPH,
            ));
            quads.push(quad(
                &receipt_iri,
                &predicate("headlineProjection"),
                &urn(
                    "eyes-headline-projection",
                    &enum_name(receipt.headline_projection),
                ),
                EYES_GRAPH,
            ));
            let effective_options = serde_jcs::to_string(&receipt.effective_options)
                .expect("validated EYES effective options are canonicalizable");
            quads.push(quad(
                &receipt_iri,
                &predicate("effectiveOptionsJcs"),
                &literal(&effective_options),
                EYES_GRAPH,
            ));
            for repair_id in &receipt.reference_defect_repair_ids {
                quads.push(quad(
                    &receipt_iri,
                    &predicate("referenceDefectRepair"),
                    &urn("eyes-reference-defect-repair", repair_id),
                    EYES_GRAPH,
                ));
            }
            for limitation in &receipt.limitations {
                quads.push(quad(
                    &receipt_iri,
                    &predicate("limitation"),
                    &urn("eyes-partial-replay-limitation", &enum_name(*limitation)),
                    EYES_GRAPH,
                ));
            }
            for (name, value) in [
                (
                    "referencePrimarySecondaryConcurrencyPorted",
                    receipt.reference_primary_secondary_concurrency_ported,
                ),
                ("pickupExportExposed", receipt.pickup_export_exposed),
            ] {
                quads.push(quad(
                    &receipt_iri,
                    &predicate(name),
                    &boolean_literal(value),
                    EYES_GRAPH,
                ));
            }
            quads.push(quad(
                &receipt_iri,
                &predicate("pickupExportRowCount"),
                &unsigned_long_literal(receipt.pickup_export_row_count),
                EYES_GRAPH,
            ));
            for (name, value) in [
                ("participantCount", u64::from(receipt.participant_count)),
                ("deviceStateBlockCount", receipt.device_state_block_count),
                ("episodeCount", receipt.episode_count),
                ("appUsageChunkCount", receipt.app_usage_chunk_count),
                ("fragmentCount", receipt.fragment_count),
                ("creditedFragmentCount", receipt.credited_fragment_count),
                ("chunkEndpointCount", receipt.chunk_endpoint_count),
            ] {
                quads.push(quad(
                    &receipt_iri,
                    &predicate(name),
                    &unsigned_long_literal(value),
                    EYES_GRAPH,
                ));
            }
            if let Some(receipt_artifact_iri) =
                scientific_artifact_iris.get(receipt_artifact_digest.as_str())
            {
                quads.push(quad(
                    &receipt_iri,
                    &predicate("receiptArtifact"),
                    receipt_artifact_iri,
                    EYES_GRAPH,
                ));
            }
        }
    }
    for execution in &source.query_executions {
        let execution_iri = urn(
            "step-execution",
            &format!("{}:{}", source.input_digest, execution.query_id),
        );
        quads.push(quad(
            &execution_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ACTIVITY),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PPLAN_CORRESPONDS_TO_STEP),
            &urn("step", &execution.query_id),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("queryGroup"),
            &urn("query-group", &execution.query_group_id),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("status"),
            &urn("execution-status", public_query_execution_status(execution)),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("outputDigest"),
            &literal(&execution.output_digest),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_STARTED),
            &date_time_literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_ENDED),
            &date_time_literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
    }
    for reason in &source.state_reasons {
        let transition = urn("transition", &reason.reason_id);
        quads.push(quad(
            &transition,
            &predicate("subject"),
            &urn("subject", &reason.subject_id),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("toState"),
            &urn("state", &reason.state),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("reason"),
            &resource_iri("reason", &reason.reason_id),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("source"),
            &resource_iri("source", &reason.source_id),
            REASONS_GRAPH,
        ));
    }
    quads.sort();
    quads.dedup();
    let mut bytes = quads.join("\n").into_bytes();
    if !bytes.is_empty() {
        bytes.push(b'\n');
    }
    bytes
}

include!(concat!(env!("OUT_DIR"), "/registered_queries.rs"));

fn store_from_nquads(index: &[u8]) -> Result<Store, String> {
    let store = Store::new().map_err(|error| error.to_string())?;
    let quads = NQuadsParser::new()
        .for_slice(index)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("parse derived N-Quads: {error}"))?;
    store
        .extend(quads)
        .map_err(|error| format!("index derived N-Quads: {error}"))?;
    Ok(store)
}

// Production callers always carry a view context; only the test module
// queries without one.
#[cfg(test)]
fn query(index: &[u8], query_id: &str) -> Result<Value, String> {
    query_with_view_context(index, query_id, None)
}

fn query_with_view_context(
    index: &[u8],
    query_id: &str,
    view_context: Option<(&str, u64)>,
) -> Result<Value, String> {
    // Rejecting an unregistered query id before touching the index keeps the
    // original error precedence: an unregistered id never reports an N-Quads
    // parse failure instead.
    let descriptor = registered_query_descriptor(query_id)
        .ok_or_else(|| format!("unregistered production query: {query_id}"))?;
    let store = store_from_nquads(index)?;
    let raw = query_on_store(&store, query_id)?;
    adapt_registered_query_result(query_id, descriptor.view_id, raw, view_context)
}

/// Evaluate one registered query against an already-built store. Split out of
/// `query` only so the two halves of a query — reconstructing the store and
/// answering from it — can be timed separately; `query` is still the single
/// caller in the product.
fn query_on_store(store: &Store, query_id: &str) -> Result<Value, String> {
    let query = registered_query(query_id)
        .ok_or_else(|| format!("unregistered production query: {query_id}"))?;
    let results = SparqlEvaluator::new()
        .parse_query(query)
        .map_err(|error| format!("parse registered query: {error}"))?
        .on_store(store)
        .execute()
        .map_err(|error| format!("execute registered query: {error}"))?;
    match results {
        QueryResults::Solutions(mut solutions) => {
            let result_variables = solutions.variables().to_vec();
            let variables = result_variables
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            for solution in &mut solutions {
                let solution = solution.map_err(|error| error.to_string())?;
                let mut row = BTreeMap::new();
                for variable in &result_variables {
                    if let Some(term) = solution.get(variable) {
                        row.insert(variable.to_string(), term.to_string());
                    }
                }
                rows.push(row);
            }
            Ok(json!({ "queryId": query_id, "variables": variables, "rows": rows }))
        }
        QueryResults::Boolean(value) => Ok(json!({ "queryId": query_id, "boolean": value })),
        QueryResults::Graph(_) => Err("registered query unexpectedly returned a graph".into()),
    }
}

fn row_term<'a>(row: &'a serde_json::Map<String, Value>, variable: &str) -> Option<&'a str> {
    row.get(&format!("?{variable}"))
        .or_else(|| row.get(variable))
        .and_then(Value::as_str)
}

/// Oxigraph's display form is intentionally preserved for the legacy raw
/// registered-query boundary. Typed views instead expose the RDF term's
/// lexical value so callers do not need to parse `<iri>` or quoted literals.
fn sparql_term_lexical(term: &str) -> Result<String, String> {
    if let Some(iri) = term
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
    {
        return Ok(iri.to_string());
    }
    if term.starts_with('"') {
        let mut escaped = false;
        for (index, character) in term.char_indices().skip(1) {
            if escaped {
                escaped = false;
                continue;
            }
            match character {
                '\\' => escaped = true,
                '"' => {
                    let encoded = &term[..=index];
                    return serde_json::from_str(encoded)
                        .map_err(|_| "registered query returned an invalid literal".to_string());
                }
                _ => {}
            }
        }
        return Err("registered query returned an unterminated literal".into());
    }
    Ok(term.to_string())
}

fn typed_status(term: Option<&str>) -> Result<Value, String> {
    let Some(term) = term else {
        return Ok(Value::Null);
    };
    let lexical = sparql_term_lexical(term)?;
    match lexical.as_str() {
        "true" => Ok(Value::Bool(true)),
        "false" => Ok(Value::Bool(false)),
        _ => Ok(Value::String(lexical)),
    }
}

fn required_typed_term(
    row: &serde_json::Map<String, Value>,
    variable: &str,
) -> Result<String, String> {
    row_term(row, variable)
        .ok_or_else(|| format!("typed registered query omitted {variable}"))
        .and_then(sparql_term_lexical)
}

fn optional_typed_term(
    row: &serde_json::Map<String, Value>,
    variable: &str,
) -> Result<Value, String> {
    row_term(row, variable)
        .map(sparql_term_lexical)
        .transpose()
        .map(|value| value.map_or(Value::Null, Value::String))
}

fn raw_solution_rows(raw: &Value) -> Result<&Vec<Value>, String> {
    raw.get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| "typed registered query did not return solution rows".to_string())
}

fn adapt_registered_query_result(
    query_id: &str,
    view_id: &str,
    raw: Value,
    view_context: Option<(&str, u64)>,
) -> Result<Value, String> {
    match query_id {
        "scientific-evidence" => {
            if view_id != "chronicle.scientific-evidence.v1" {
                return Err("scientific evidence query view contract mismatch".into());
            }
            let (root_digest, revision) = view_context
                .filter(|(root, _)| is_sha256(root))
                .ok_or_else(|| {
                    "scientific evidence query requires a verified view context".to_string()
                })?;
            let mut bindings = Vec::new();
            for value in raw_solution_rows(&raw)? {
                let row = value
                    .as_object()
                    .ok_or_else(|| "typed registered query row is invalid".to_string())?;
                let axis = required_typed_term(row, "axis")?;
                if !matches!(
                    axis.as_str(),
                    "b03_micro_use"
                        | "b04_minimum_duration"
                        | "concurrency_floor"
                        | "zero_duration_cleanup"
                        | "b05_screen_construction"
                        | "schoedel_reconstruction"
                        | "scientific_attestation"
                        | "eyes_tagged_fau"
                ) {
                    return Err("scientific evidence query returned an unknown axis".into());
                }
                bindings.push(json!({
                    "axis": axis,
                    "receipt_id": required_typed_term(row, "receipt")?,
                    "status": typed_status(row_term(row, "status"))?,
                    "artifact_id": required_typed_term(row, "artifact")?,
                    "lineage_artifact_id": optional_typed_term(row, "lineage")?,
                    "dependency_id": optional_typed_term(row, "dependency")?,
                    "lineage_dependency_id": optional_typed_term(row, "lineageDependency")?,
                }));
            }
            Ok(json!({
                "protocol_version": "0.1",
                "view_id": view_id,
                "family": "incremental-dataflow",
                "schema_id": "urn:chronicle:view:scientific-evidence:v1",
                "revision": revision,
                "root_digest": root_digest,
                "payload": { "evidence_bindings": bindings },
            }))
        }
        "scientific-source-bindings" => {
            if view_id != "chronicle.scientific-source-bindings.v1" {
                return Err("scientific source-binding query view contract mismatch".into());
            }
            let (root_digest, revision) = view_context
                .filter(|(root, _)| is_sha256(root))
                .ok_or_else(|| {
                    "scientific source-binding query requires a verified view context".to_string()
                })?;
            let mut bindings = Vec::new();
            for value in raw_solution_rows(&raw)? {
                let row = value
                    .as_object()
                    .ok_or_else(|| "typed registered query row is invalid".to_string())?;
                bindings.push(json!({
                    "graph_id": required_typed_term(row, "graph")?,
                    "artifact_id": required_typed_term(row, "artifact")?,
                    "artifact_kind": required_typed_term(row, "kind")?,
                    "assignment_id": required_typed_term(row, "assignment")?,
                    "role_id": required_typed_term(row, "role")?,
                }));
            }
            Ok(json!({
                "protocol_version": "0.1",
                "view_id": view_id,
                "family": "incremental-dataflow",
                "schema_id": "urn:chronicle:view:scientific-source-bindings:v1",
                "revision": revision,
                "root_digest": root_digest,
                "payload": { "source_bindings": bindings },
            }))
        }
        _ => Ok(raw),
    }
}

fn validate_compiled_workflow_domain(
    executions: &[QueryExecution],
    digest_ids: &BTreeSet<&str>,
    checkpoint_ids: &BTreeSet<&str>,
) -> Result<(), String> {
    let expected_queries = WORKFLOW_QUERIES
        .iter()
        .map(|definition| (definition.id, definition.group))
        .collect::<BTreeMap<_, _>>();
    let mut actual_queries = BTreeMap::new();
    for execution in executions {
        if actual_queries
            .insert(
                execution.query_id.as_str(),
                execution.query_group_id.as_str(),
            )
            .is_some()
        {
            return Err("semantic index query execution domain is incomplete".into());
        }
    }
    if actual_queries != expected_queries
        || digest_ids != &expected_queries.keys().copied().collect()
        || checkpoint_ids != &expected_queries.keys().copied().collect()
    {
        return Err("semantic index query execution domain is incomplete".into());
    }
    Ok(())
}

fn expected_query_reason_id(execution: &QueryExecution) -> String {
    sha256_bytes(
        format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}",
            execution.query_id, execution.input_key, execution.output_digest, execution.status,
        )
        .as_bytes(),
    )
}

fn validate_query_execution_identity(
    execution: &QueryExecution,
    expected_group: Option<&str>,
    expected_output_digest: Option<&str>,
) -> Result<(), String> {
    if !matches!(
        execution.status.as_str(),
        "cached" | "recomputed" | "bypassed"
    ) || expected_group != Some(execution.query_group_id.as_str())
        || !is_sha256(&execution.input_key)
        || !is_sha256(&execution.output_digest)
        || !is_sha256(&execution.reason_id)
        || execution.reason_id != expected_query_reason_id(execution)
        || expected_output_digest != Some(execution.output_digest.as_str())
    {
        return Err("semantic index query execution is invalid".into());
    }
    Ok(())
}

fn validate_query_checkpoint_identity(
    query_id: &str,
    checkpoint: &WorkflowCheckpoint,
    expected_output_digest: Option<&str>,
) -> Result<(), String> {
    let terminal = validate_workflow_checkpoint_for_subject(checkpoint, query_id)
        .map_err(|_| format!("semantic index query checkpoint is invalid for {query_id}"))?;
    if expected_output_digest != Some(terminal.as_str()) {
        return Err(format!(
            "semantic index query checkpoint is invalid for {query_id}"
        ));
    }
    Ok(())
}

/// Public semantic status deliberately avoids claiming the source's physical
/// cached-vs-recomputed distinction: Salsa's executed-member/deactivation
/// witness is runtime-private and is not present in semantic-source/v7.
/// Applicability, query identity, and output checkpoints are independently
/// validated here, so this projection can truthfully distinguish a completed
/// applicable query from a compiled query that was not applicable.
fn public_query_execution_status(execution: &QueryExecution) -> &'static str {
    if execution.status == "bypassed" {
        "not-applicable"
    } else {
        "completed"
    }
}

#[wasm_bindgen]
pub fn decompress_bundled_gzip(packed: &[u8], expected_bytes: u32) -> Result<Vec<u8>, JsValue> {
    bundled_gzip::decode_gzip_bytes(packed, expected_bytes as usize)
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn rebuild_semantic_index(
    source_json: &[u8],
    mut scientific_artifact_bundle: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    console_error_panic_hook::set_once();
    rebuild_semantic_index_native_zeroing(source_json, &mut scientific_artifact_bundle)
        .map_err(|error| JsValue::from_str(&error))
}

/// Validate a transient raw-equivalent scientific substrate and erase the
/// caller-owned Rust boundary buffer on both success and ordinary-error paths.
/// Deserialization necessarily creates additional nested allocations; the web
/// boundary therefore invokes this only inside a disposable worker and destroys
/// that entire WASM realm after receiving the PHI-safe index. Wiping this Vec is
/// defense in depth for the contiguous ingress copy, not a claim that it erases
/// every deserialization allocation in a reusable WASM instance.
pub fn rebuild_semantic_index_native_zeroing(
    source_json: &[u8],
    scientific_artifact_bundle: &mut [u8],
) -> Result<Vec<u8>, String> {
    let result = rebuild_semantic_index_native(source_json, scientific_artifact_bundle);
    scientific_artifact_bundle.fill(0);
    result
}

pub fn rebuild_semantic_index_native(
    source_json: &[u8],
    scientific_artifact_bundle: &[u8],
) -> Result<Vec<u8>, String> {
    let source: IndexSource = serde_json::from_slice(source_json)
        .map_err(|error| format!("invalid semantic index source: {error}"))?;
    if source.protocol_version != "chronicle-semantic-index-source/v7" {
        return Err("unsupported semantic index source".into());
    }
    match (
        &source.maximum_duration_receipt,
        &source.maximum_duration_receipt_digest,
    ) {
        (Some(evidence), Some(digest)) => {
            b06::validate_evidence(evidence)
                .map_err(|error| format!("maximum-duration receipt invalid: {error}"))?;
            // The digest becomes the receipt's subject IRI, so it is re-derived
            // like every other content address in this index.
            let canonical = serde_jcs::to_vec(evidence)
                .map_err(|error| format!("canonicalize maximum-duration receipt: {error}"))?;
            if !is_sha256(digest) || sha256_bytes(&canonical) != *digest {
                return Err("maximum-duration receipt digest does not address the receipt".into());
            }
            // Each outcome key is spliced into a predicate IRI.
            if evidence.receipt.outcome_counts.keys().any(|key| {
                key.is_empty() || !key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            }) {
                return Err("maximum-duration receipt outcome key is not a canonical id".into());
            }
        }
        (None, None) => {}
        _ => {
            return Err(
                "maximum-duration receipt and its digest must be published together".into(),
            );
        }
    }
    if source.query_executions.is_empty()
        || source.workflow_query_digests.is_empty()
        || source.workflow_query_checkpoints.is_empty()
    {
        return Err("semantic index source must contain non-empty query registries".into());
    }
    let digest_ids = source
        .workflow_query_digests
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let checkpoint_ids = source
        .workflow_query_checkpoints
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    validate_compiled_workflow_domain(&source.query_executions, &digest_ids, &checkpoint_ids)?;
    let query_definitions = WORKFLOW_QUERIES
        .iter()
        .map(|definition| (definition.id, definition))
        .collect::<BTreeMap<_, _>>();
    let mut execution_ids = std::collections::BTreeSet::new();
    for execution in &source.query_executions {
        if !execution_ids.insert(execution.query_id.as_str()) {
            return Err("semantic index query execution is invalid".into());
        }
        validate_query_execution_identity(
            execution,
            query_definitions
                .get(execution.query_id.as_str())
                .map(|definition| definition.group),
            source
                .workflow_query_digests
                .get(&execution.query_id)
                .map(String::as_str),
        )?;
    }
    for (query_id, checkpoint) in &source.workflow_query_checkpoints {
        if validate_query_checkpoint_identity(
            query_id,
            checkpoint,
            source
                .workflow_query_digests
                .get(query_id)
                .map(String::as_str),
        )
        .is_err()
        {
            return Err(format!(
                "semantic index query checkpoint is invalid for {query_id}: protocol={} identity={} terminal={} expected={:?}",
                checkpoint.protocol_version,
                checkpoint.subject_id,
                checkpoint.terminal_digest,
                source.workflow_query_digests.get(query_id),
            ));
        }
    }
    let opener = &source.opener_set_receipt.applicability;
    let valid_opener = matches!(
        opener.requested.as_str(),
        "strategy_defined" | "activity_resumed_only" | "gesis_app_scoped_starts"
    );
    let valid_relation = matches!(
        opener.relation.as_str(),
        "baseline_native"
            | "baseline_equivalent"
            | "source_equivalent"
            | "source_aligned_adapter"
            | "controlled_derivative"
            | "refused"
    );
    let valid_disposition = if opener.relation == "refused" {
        opener.effective.is_none()
            && opener.refusal_reason.as_deref() == Some("eyes_requires_lifecycle_triplets")
    } else {
        opener.effective.as_deref() == Some(opener.requested.as_str())
            && opener.refusal_reason.is_none()
    };
    let valid_count_keys = source
        .opener_set_receipt
        .selected_opener_type_counts
        .keys()
        .chain(
            source
                .opener_set_receipt
                .materialized_opener_type_counts
                .keys(),
        )
        .all(|kind| !kind.trim().is_empty());
    let valid_receipt_digest = is_sha256(&source.opener_set_receipt_digest)
        && opener_set_receipt_digest(&source.opener_set_receipt)
            .is_ok_and(|digest| digest == source.opener_set_receipt_digest);
    if !valid_opener
        || !valid_relation
        || !valid_disposition
        || !valid_count_keys
        || !valid_receipt_digest
    {
        return Err("semantic index opener-set receipt is invalid".into());
    }
    if let Some(decision) = &source.dependency_cache_decision {
        if !matches!(
            decision.mode.as_str(),
            "certified_narrow" | "conservative_full"
        ) || (decision.mode == "certified_narrow"
            && (decision.certificate_digest.is_none() || decision.binding_surface_digest.is_none()))
        {
            return Err("semantic index dependency cache decision is invalid".into());
        }
    }
    validate_eyes_evidence(&source.eyes_evidence)?;
    let scientific_evidence =
        parse_scientific_artifact_bundle(&source, scientific_artifact_bundle)?;
    validate_scientific_evidence(&source, &scientific_evidence)?;
    let index = build_index(&source);
    store_from_nquads(&index)?;
    Ok(index)
}

#[wasm_bindgen]
pub fn query_registered(index: &[u8], query_id: &str) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    query_registered_native(index, query_id, None, None).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn query_registered_view(
    index: &[u8],
    query_id: &str,
    workspace_root_digest: &str,
    revision: u64,
) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    query_registered_native(index, query_id, Some(workspace_root_digest), Some(revision))
        .map_err(|error| JsValue::from_str(&error))
}

pub fn query_registered_native(
    index: &[u8],
    query_id: &str,
    workspace_root_digest: Option<&str>,
    revision: Option<u64>,
) -> Result<String, String> {
    let view_context = match (workspace_root_digest, revision) {
        (Some(root), Some(revision)) => Some((root, revision)),
        (None, None) => None,
        _ => return Err("registered query view context is incomplete".into()),
    };
    query_with_view_context(index, query_id, view_context)
        .and_then(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
}

/// `#[ignore]`d measurement harness for the recorded per-query reconstruction
/// debt. It lives in-crate so it can time the private `store_from_nquads`
/// against the whole `query` path without widening their visibility.
#[cfg(test)]
mod perf_measurement;

/// Protocol tests for `chronicle-semantic-index-source/v7`.
///
/// These thirteen tests were switched off behind `#[cfg(all(test, any()))]` as
/// `legacy_tests_v5` when `rebuild_semantic_index` grew its scientific
/// substrate parameter. `any()` with no arguments is unconditionally false, so
/// the module never entered the compile graph and `Makefile:100` reported
/// success over it for the whole life of protocol v6 and v7.
///
/// The hand-written v5 fixture they carried is not revivable: v7 requires the
/// execution/digest/checkpoint maps to cover the entire `WORKFLOW_QUERIES`
/// domain (`validate_compiled_workflow_domain`), derives `reason_id` from the
/// execution itself (`expected_query_reason_id`), and re-validates a scientific
/// substrate whose receipts only the kernel can produce
/// (`validate_scientific_evidence`). So the fixture is generated here by
/// running the real product runtime; it cannot go stale without the generating
/// call failing loudly.
#[cfg(test)]
mod source_protocol_tests {
    use super::*;
    use chronicle_preprocessing_runtime_wasm::{
        execute_workspace_native, scientific_preflight_native, RuntimeSupportFiles,
        EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
    };
    use std::sync::OnceLock;

    /// The opener-set receipt is kept literal rather than taken from the run so
    /// that the two content-address goldens in
    /// `opener_set_receipt_digest_content_addresses_a_and_b` stay meaningful
    /// goldens instead of being re-recorded from whatever the runtime last
    /// emitted. `OpenerSetReceipt` (lib.rs:578-585) is unchanged in shape since
    /// those digests were recorded, and nothing outside
    /// `opener_set_receipt_digest` binds this receipt to the rest of the source.
    fn literal_opener_set_receipt() -> Value {
        json!({
            "applicability": {
                "requested": "strategy_defined",
                "effective": "strategy_defined",
                "relation": "baseline_native",
                "refusalReason": null
            },
            "suppressedDeviceOpenerCount": 0,
            "selectedOpenerTypeCounts": {"Activity Resumed": 1},
            "materializedOpenerTypeCounts": {"Activity Resumed": 1}
        })
    }

    /// Also kept literal: the live decision depends on whether the embedded
    /// dependency certificate happens to be current for this build, which would
    /// otherwise silently decide whether the `certified_narrow` projection is
    /// exercised at all. `DependencyCacheDecision` (lib.rs:641-649) is validated
    /// in isolation (lib.rs:3571-3580) and bound to nothing else in the source.
    fn literal_dependency_cache_decision() -> Value {
        json!({
            "mode": "certified_narrow",
            "certificate_digest": "sha256:cccc",
            "binding_surface_digest": "sha256:dddd",
            "empirical_evidence_current": true,
            "reasons": ["dependency_surface_structurally_certified"]
        })
    }

    fn bind_opener_set_receipt_digest(source: &mut Value) -> String {
        let receipt: OpenerSetReceipt =
            serde_json::from_value(source["openerSetReceipt"].clone()).unwrap();
        let digest = opener_set_receipt_digest(&receipt).unwrap();
        source["openerSetReceiptDigest"] = Value::String(digest.clone());
        digest
    }

    fn app_usage_csv() -> &'static [u8] {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago"
        )
        .as_bytes()
    }

    fn eyes_csv() -> &'static [u8] {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Stopped,com.example.chat,2026-03-07 10:01:01,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Resumed,com.example.other,2026-03-07 10:02:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Paused,com.example.other,2026-03-07 10:03:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Stopped,com.example.other,2026-03-07 10:03:01,America/Chicago"
        )
        .as_bytes()
    }

    /// Same shape as `eyes_csv`, one extra bounded episode. Distinct raw bytes
    /// give a distinct tagged-FAU artifact and therefore a distinct
    /// content-addressed RDF subject.
    fn eyes_variant_csv() -> &'static [u8] {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Stopped,com.example.chat,2026-03-07 10:01:01,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Resumed,com.example.other,2026-03-07 10:02:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Paused,com.example.other,2026-03-07 10:03:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Stopped,com.example.other,2026-03-07 10:03:01,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:05:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:06:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Stopped,com.example.chat,2026-03-07 10:06:01,America/Chicago"
        )
        .as_bytes()
    }

    /// Mirrors the runtime's own canonical request fixture
    /// (`chronicle_preprocessing_runtime_wasm` `request()`), including all four
    /// bound minimum-duration fields — the query input key omits an option that
    /// is not sent, and the runtime fails closed on that rather than compute a
    /// key that cannot invalidate.
    fn runtime_request(csv: &[u8], workspace_marker: char, eyes: bool) -> String {
        let mut request = json!({
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "requestId": "req-semantic-index",
            "command": EXECUTE_WORKSPACE_COMMAND,
            "executionEngine": "incremental",
            "workspaceRootDigest": null,
            "workspaceId": format!("sha256:{}", workspace_marker.to_string().repeat(64)),
            "inputFileName": "Raw P01.csv",
            "inputSha256": sha256_bytes(csv),
            "options": {
                "study_name": "Semantic Index Proof",
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
                "long_duration_threshold_ns": 43_200_000_000_000_i64,
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
                "micro_use_classification_policy": "none",
                "minimum_duration_comparator": "strict_lt",
                "minimum_duration_disposition": "chronicle_blank_keep_row",
                "apply_minimum_usage_duration_to_concurrent_subintervals": false
            }
        });
        if eyes {
            request["options"]["episode_reconstruction_strategy"] =
                Value::String("eyes_complement".into());
            request["options"]["proximity_interval_ns"] = json!(2_000_000_000_i64);
            request["options"]["minimum_usage_duration"] = json!(0.0);
            request["options"]["enable_aggregates"] = Value::Bool(true);
        }
        request.to_string()
    }

    /// A semantic-index source together with the scientific substrate that
    /// validates it, both produced by one real runtime execution.
    struct RuntimeFixture {
        source: Value,
        /// `(kind, bytes)` in `scientificValidationSubstrateKinds` order — the
        /// exact concatenation order the bundle contract requires
        /// (lib.rs:445-482).
        substrate: Vec<(String, Vec<u8>)>,
    }

    impl RuntimeFixture {
        fn bundle(&self) -> Vec<u8> {
            self.substrate
                .iter()
                .flat_map(|(_, bytes)| bytes.iter().copied())
                .collect()
        }

        /// The substrate re-concatenated with one kind's bytes replaced. The
        /// caller owns keeping (or deliberately breaking) the metadata that
        /// describes it.
        fn bundle_with(&self, kind: &str, replacement: &[u8]) -> Vec<u8> {
            let mut bundle = Vec::new();
            for (artifact_kind, bytes) in &self.substrate {
                if artifact_kind == kind {
                    bundle.extend_from_slice(replacement);
                } else {
                    bundle.extend_from_slice(bytes);
                }
            }
            bundle
        }

        fn substrate_bytes(&self, kind: &str) -> &[u8] {
            self.substrate
                .iter()
                .find(|(artifact_kind, _)| artifact_kind == kind)
                .map(|(_, bytes)| bytes.as_slice())
                .unwrap_or_else(|| panic!("substrate kind {kind} is absent from the fixture"))
        }
    }

    fn generate_fixture(csv: &[u8], workspace_marker: char, eyes: bool) -> RuntimeFixture {
        let request = runtime_request(csv, workspace_marker, eyes);
        if eyes {
            scientific_preflight_native(&request, csv, &RuntimeSupportFiles::default())
                .expect("EYES scientific preflight");
        }
        let mut handle = execute_workspace_native(&request, csv, &RuntimeSupportFiles::default())
            .expect("runtime execution for the semantic-index fixture");
        let manifest: Value = serde_json::from_str(&handle.manifest_json()).unwrap();
        let artifacts = manifest["artifacts"].as_array().unwrap().clone();
        let index_of = |kind: &str| {
            artifacts
                .iter()
                .position(|artifact| artifact["kind"] == kind)
                .unwrap_or_else(|| panic!("runtime produced no {kind} artifact"))
        };
        let source_bytes = handle
            .take_artifact_bytes(index_of("semantic-index-source-json") as u32)
            .unwrap();
        let source: Value = serde_json::from_slice(&source_bytes).unwrap();
        let substrate = source["scientificValidationSubstrateKinds"]
            .as_array()
            .expect("v7 source declares its validation substrate")
            .iter()
            .map(|kind| {
                let kind = kind.as_str().unwrap().to_string();
                let bytes = handle.take_artifact_bytes(index_of(&kind) as u32).unwrap();
                (kind, bytes)
            })
            .collect();
        // The fixture must not be able to degenerate into something weaker than
        // what the product emits. The v5 fixture supplied 3 of the domain's
        // queries against a gate that now requires all of `WORKFLOW_QUERIES`;
        // if that ever silently happened again these tests would pass while
        // asserting almost nothing.
        assert_eq!(
            source["protocolVersion"], "chronicle-semantic-index-source/v7",
            "the runtime must emit the protocol version this module tests"
        );
        assert_eq!(
            source["queryExecutions"].as_array().unwrap().len(),
            WORKFLOW_QUERIES.len(),
            "the fixture must cover the whole compiled workflow domain"
        );
        assert_eq!(
            source["workflowQueryCheckpoints"]
                .as_object()
                .unwrap()
                .len(),
            WORKFLOW_QUERIES.len(),
        );
        RuntimeFixture { source, substrate }
    }

    fn app_fixture() -> &'static RuntimeFixture {
        static FIXTURE: OnceLock<RuntimeFixture> = OnceLock::new();
        FIXTURE.get_or_init(|| generate_fixture(app_usage_csv(), 'a', false))
    }

    fn eyes_fixture() -> &'static RuntimeFixture {
        static FIXTURE: OnceLock<RuntimeFixture> = OnceLock::new();
        FIXTURE.get_or_init(|| generate_fixture(eyes_csv(), 'b', true))
    }

    fn eyes_variant_fixture() -> &'static RuntimeFixture {
        static FIXTURE: OnceLock<RuntimeFixture> = OnceLock::new();
        FIXTURE.get_or_init(|| generate_fixture(eyes_variant_csv(), 'c', true))
    }

    /// The app-usage source with the two isolated-validation fields pinned to
    /// literals (see `literal_opener_set_receipt` /
    /// `literal_dependency_cache_decision`). Everything else is exactly what
    /// the runtime emitted.
    fn complete_source() -> Value {
        let mut source = app_fixture().source.clone();
        source["openerSetReceipt"] = literal_opener_set_receipt();
        source["dependencyCacheDecision"] = literal_dependency_cache_decision();
        bind_opener_set_receipt_digest(&mut source);
        source
    }

    fn complete_bundle() -> Vec<u8> {
        app_fixture().bundle()
    }

    fn rebuild(source: &Value) -> Result<Vec<u8>, String> {
        rebuild_semantic_index_native(&serde_json::to_vec(source).unwrap(), &complete_bundle())
    }

    fn rebuild_with(source: &Value, bundle: &[u8]) -> Result<Vec<u8>, String> {
        rebuild_semantic_index_native(&serde_json::to_vec(source).unwrap(), bundle)
    }

    /// An EYES source with the same two literal pins as `complete_source`.
    fn eyes_source(fixture: &RuntimeFixture) -> Value {
        let mut source = fixture.source.clone();
        source["openerSetReceipt"] = literal_opener_set_receipt();
        source["dependencyCacheDecision"] = literal_dependency_cache_decision();
        bind_opener_set_receipt_digest(&mut source);
        source
    }

    /// A well-formed request satisfies every role requirement, so the runtime
    /// emits no open obligations and no state reasons for it — `openObligations`
    /// and `stateReasons` come back empty. Their projections are still product
    /// surface: `open-obligations`, `has-open-obligations`, and `reason-trace`
    /// are registered queries. Nothing in `rebuild_semantic_index_native`
    /// validates either collection (only `roleAssignments` is validated, by
    /// `validated_role_assignments`), so they are pure projection input and can
    /// be supplied here. The two obligation shapes are the ones the projection
    /// has to distinguish: a query-group-scoped obligation and a root
    /// obligation with a null `query_group_id`.
    fn source_with_projected_obligations() -> Value {
        let mut source = complete_source();
        let obligations = source["openObligations"].as_array_mut().unwrap();
        obligations.push(json!({
            "obligation_id": "urn:obligation:1",
            "role_id": "urn:role:filter",
            "query_group_id": "app_policy",
            "state": "open",
            "reason_id": "urn:reason:missing-filter"
        }));
        obligations.push(json!({
            "obligation_id": "root obligation",
            "role_id": "root role",
            "query_group_id": null,
            "state": "open",
            "reason_id": "root reason"
        }));
        source["stateReasons"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "reason_id": "reason with spaces",
                "subject_id": "app policy",
                "state": "open",
                "source_id": "product contract"
            }));
        source
    }

    fn scientific_artifact_index(source: &Value, kind: &str) -> usize {
        source["scientificEvidenceArtifacts"]
            .as_array()
            .unwrap()
            .iter()
            .position(|artifact| artifact["kind"] == kind)
            .unwrap_or_else(|| panic!("source declares no {kind} artifact"))
    }

    /// Re-point one artifact's metadata at replacement bytes, so a payload
    /// tamper is not masked by the content-address check that runs first
    /// (lib.rs:469-474).
    fn rebind_scientific_artifact(source: &mut Value, kind: &str, bytes: &[u8]) {
        let position = scientific_artifact_index(source, kind);
        let digest = sha256_bytes(bytes);
        let artifact = &mut source["scientificEvidenceArtifacts"][position];
        artifact["artifactId"] = Value::String(format!(
            "urn:chronicle:artifact:{}:{}",
            kind,
            &digest[7..]
        ));
        artifact["digest"] = Value::String(digest);
        artifact["size"] = json!(bytes.len() as u64);
    }

    #[test]
    fn index_rebuild_is_deterministic_and_registered_queries_are_bounded() {
        let registry: Value = serde_json::from_str(REGISTERED_QUERY_RESOURCE_JSON).unwrap();
        for declared in registry["queries"].as_array().unwrap() {
            assert_eq!(
                registered_query(declared["query_id"].as_str().unwrap()),
                declared["sparql"].as_str(),
            );
        }
        let source = source_with_projected_obligations();
        let parsed: IndexSource = serde_json::from_value(source.clone()).unwrap();
        let first = build_index(&parsed);
        assert_eq!(first, build_index(&parsed));

        // The projection is total and injective over each source collection:
        // every row reaches the index exactly once. Deriving the expectation
        // from the source rather than pinning a literal keeps this honest when
        // the fixture's own size changes.
        for (query_id, source_key) in [
            ("role-assignments", "roleAssignments"),
            ("qualification-traces", "qualificationTraces"),
            ("requirement-traces", "requirementTraces"),
            ("open-obligations", "openObligations"),
            ("actual-executions", "queryExecutions"),
            ("reason-trace", "stateReasons"),
        ] {
            let expected = source[source_key].as_array().unwrap().len();
            assert!(expected > 0, "{source_key} must be non-empty in the fixture");
            let result = query(&first, query_id).unwrap();
            assert_eq!(
                result["rows"].as_array().unwrap().len(),
                expected,
                "{query_id} must project every {source_key} row exactly once",
            );
        }
        assert_eq!(
            query(&first, "has-open-obligations").unwrap()["boolean"],
            true
        );

        // IRI escaping of an identifier containing a space. `build_index` does
        // not validate, so this exercises the escape path directly on an
        // otherwise real source rather than requiring the runtime to emit an
        // identifier it never emits.
        let mut spaced = source.clone();
        spaced["roleAssignments"][0]["assignment_id"] = Value::String("assignment with spaces".into());
        let spaced_index = build_index(&serde_json::from_value(spaced).unwrap());
        assert!(String::from_utf8(spaced_index)
            .unwrap()
            .contains("assignment_with_spaces"));

        let nquads = String::from_utf8(first.clone()).unwrap();
        assert!(nquads.contains("http://purl.org/net/p-plan#correspondsToStep"));
        assert!(nquads.contains("http://www.w3.org/2001/XMLSchema#dateTime"));
        assert!(nquads.contains("2026-07-21T12:00:00Z"));
        assert!(nquads.contains("chronicle.binding.media-type.v1"));
        assert!(nquads.contains("qualifiersDigest"));
        assert!(nquads.contains("certified_narrow"));
        assert!(nquads.contains("empiricalEvidenceCurrent"));
        assert!(query(&first, "DROP ALL")
            .unwrap_err()
            .contains("unregistered"));
        assert!(query(b"not n-quads", "role-assignments")
            .unwrap_err()
            .contains("parse derived N-Quads"));
    }

    #[test]
    fn native_and_wasm_facades_validate_sources_and_return_registered_results() {
        let bytes = serde_json::to_vec(&complete_source()).unwrap();
        let bundle = complete_bundle();
        // `rebuild_semantic_index` takes the bundle by value and zeroes it, so
        // the native call must run first and the facade needs its own copy.
        let native = rebuild_semantic_index_native(&bytes, &bundle).unwrap();
        assert_eq!(native, rebuild_semantic_index(&bytes, bundle.clone()).unwrap());
        let native_query = query_registered_native(&native, "open-obligations", None, None).unwrap();
        let wasm_query = query_registered(&native, "open-obligations").unwrap();
        assert_eq!(native_query, wasm_query);

        assert!(rebuild_semantic_index_native(b"{", &bundle)
            .unwrap_err()
            .contains("invalid semantic index source"));
        let mut unsupported = complete_source();
        unsupported["protocolVersion"] = Value::String("future".into());
        assert_eq!(
            rebuild(&unsupported).unwrap_err(),
            "unsupported semantic index source"
        );
        // The v5 fixture also asserted an `executionLedger = null` rejection.
        // `executionLedger` is not a field of `IndexSource` (lib.rs:73-95), the
        // error string it expected exists nowhere in the crate, and the runtime
        // asserts the key is never emitted
        // (chronicle_preprocessing_runtime_wasm lib.rs:9503-9504). There is no
        // subject left to assert against.
        let mut invalid_cache = complete_source();
        invalid_cache["dependencyCacheDecision"]["mode"] = Value::String("unsafe".into());
        assert_eq!(
            rebuild(&invalid_cache).unwrap_err(),
            "semantic index dependency cache decision is invalid"
        );
        let mut already_normalized_time = complete_source();
        already_normalized_time["executionTimestamp"] =
            Value::String("2026-07-21T12:00:00Z".into());
        let normalized_index = rebuild(&already_normalized_time).unwrap();
        assert!(String::from_utf8(normalized_index)
            .unwrap()
            .contains("2026-07-21T12:00:00Z"));
        assert!(query_registered_native(&native, "arbitrary-query", None, None).is_err());
    }

    #[test]
    fn missing_query_execution_surface_fails_closed() {
        // `queryGroupExecutions` was the fourth field here; v7 removed it from
        // `IndexSource` (lib.rs:73-95) and `deny_unknown_fields` (lib.rs:72)
        // now rejects it outright.
        for field in [
            "queryExecutions",
            "workflowQueryDigests",
            "workflowQueryCheckpoints",
        ] {
            let mut incomplete = complete_source();
            incomplete[field] = if field.ends_with("Executions") {
                json!([])
            } else {
                json!({})
            };
            assert_eq!(
                rebuild(&incomplete).unwrap_err(),
                "semantic index source must contain non-empty query registries",
                "missing {field} must fail independently",
            );
        }
    }

    #[test]
    fn digest_and_nquads_boundaries_are_exact() {
        let sha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        assert!(is_sha256(sha));
        assert!(!is_sha256(&sha[1..]));
        assert!(!is_sha256(&format!("xxh3:{}", "a".repeat(32))));
        assert!(!is_sha256(&format!("sha256:{}g", "a".repeat(63))));

        // `is_checkpoint_component_digest` was removed with protocol v5 and its
        // kernel replacement (`valid_workflow_checkpoint_component_digest`,
        // chronicle_chrono_kernel_wasm pipeline_v2.rs:4832) is private, so the
        // component-digest boundary is asserted through the public boundary the
        // semantic index actually calls.
        let source = complete_source();
        let checkpoint = source["workflowQueryCheckpoints"]["decode_source_records"].clone();
        let typed: WorkflowCheckpoint = serde_json::from_value(checkpoint.clone()).unwrap();
        assert!(validate_workflow_checkpoint_for_subject(&typed, "decode_source_records").is_ok());
        for (field, value) in [
            ("rowMembershipDigest", "xxh3:short".to_string()),
            ("rowOrderDigest", format!("sha256:{}", "b".repeat(64))),
            ("payloadDigest", format!("xxh3:{}g", "b".repeat(31))),
            // Truncated prefix: `xh3:bbbb…`, the same off-by-one the removed
            // `is_checkpoint_component_digest(&xxh3[1..])` case covered.
            (
                "schemaDigest",
                "xxh3:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"[1..].to_string(),
            ),
        ] {
            let mut malformed = checkpoint.clone();
            malformed[field] = Value::String(value);
            let typed: WorkflowCheckpoint = serde_json::from_value(malformed).unwrap();
            assert_eq!(
                validate_workflow_checkpoint_for_subject(&typed, "decode_source_records")
                    .unwrap_err(),
                "workflow_checkpoint_validation_error:component_digest",
                "a malformed {field} must be rejected as a component digest",
            );
        }

        let parsed: IndexSource = serde_json::from_value(source).unwrap();
        let index = build_index(&parsed);
        assert!(!index.is_empty());
        assert_eq!(index.last(), Some(&b'\n'));
    }

    #[test]
    fn opener_set_receipt_is_required_validated_and_indexed() {
        let source = complete_source();
        let receipt_digest = source["openerSetReceiptDigest"].as_str().unwrap().to_owned();
        let index = rebuild(&source).unwrap();
        let text = String::from_utf8(index).unwrap();
        assert!(text.contains("requestedOpenerSet"));
        assert!(text.contains("strategy_defined"));
        assert!(text.contains("selectedOpenerTypeCounts"));
        assert!(text.contains(&format!(
            "urn:chronicle:opener-set-receipt:{receipt_digest}"
        )));

        let mut missing = complete_source();
        missing.as_object_mut().unwrap().remove("openerSetReceipt");
        assert!(rebuild(&missing).unwrap_err().contains("missing field"));

        let mut invalid = complete_source();
        invalid["openerSetReceipt"]["applicability"]["relation"] = Value::String("refused".into());
        bind_opener_set_receipt_digest(&mut invalid);
        assert_eq!(
            rebuild(&invalid).unwrap_err(),
            "semantic index opener-set receipt is invalid",
        );

        let mut invalid_digest = complete_source();
        invalid_digest["openerSetReceiptDigest"] = Value::String("sha256:short".into());
        assert_eq!(
            rebuild(&invalid_digest).unwrap_err(),
            "semantic index opener-set receipt is invalid",
        );
    }

    #[test]
    fn opener_set_receipt_digest_content_addresses_a_and_b() {
        let a = complete_source();
        let a_digest = a["openerSetReceiptDigest"].as_str().unwrap().to_string();
        let mut b = a.clone();
        b["openerSetReceipt"]["applicability"]["requested"] =
            Value::String("activity_resumed_only".into());
        b["openerSetReceipt"]["applicability"]["effective"] =
            Value::String("activity_resumed_only".into());
        b["openerSetReceipt"]["applicability"]["relation"] =
            Value::String("source_equivalent".into());
        let b_digest = bind_opener_set_receipt_digest(&mut b);

        assert_eq!(
            a_digest,
            "sha256:98df642e624c534468053e0647d0ecc1aba9a4240e27cc0feed72ace2960d741"
        );
        assert_eq!(
            b_digest,
            "sha256:245353adba989c8fbdd904bc06f17a2233411f5356de476fd156f4222f76db41"
        );
        assert_ne!(a_digest, b_digest);
        for (source, digest) in [(&a, &a_digest), (&b, &b_digest)] {
            let index = rebuild(source).unwrap();
            assert!(String::from_utf8(index)
                .unwrap()
                .contains(&format!("urn:chronicle:opener-set-receipt:{digest}")));
        }
    }

    #[test]
    fn opener_set_receipt_digest_rejects_content_and_digest_tampering() {
        let source = complete_source();
        let mut content_tamper = source.clone();
        content_tamper["openerSetReceipt"]["suppressedDeviceOpenerCount"] = json!(1);
        let mut digest_tamper = source;
        digest_tamper["openerSetReceiptDigest"] =
            Value::String(format!("sha256:{}", "f".repeat(64)));

        for tampered in [content_tamper, digest_tamper] {
            assert!(is_sha256(
                tampered["openerSetReceiptDigest"].as_str().unwrap()
            ));
            assert_eq!(
                rebuild(&tampered).unwrap_err(),
                "semantic index opener-set receipt is invalid",
            );
        }
    }

    #[test]
    fn eyes_evidence_is_typed_content_addressed_and_exactly_indexed() {
        let fixture = eyes_fixture();
        let source = eyes_source(fixture);
        let artifact_digest = source["eyesEvidence"]["taggedFauArtifactDigest"]
            .as_str()
            .expect("EYES run declares a tagged-FAU artifact")
            .to_owned();
        let receipt_artifact_digest = source["eyesEvidence"]["validationReceiptArtifactDigest"]
            .as_str()
            .expect("EYES run declares a validation-receipt artifact")
            .to_owned();

        let index = rebuild_with(&source, &fixture.bundle()).unwrap();
        let text = String::from_utf8(index).unwrap();
        for exact in [
            "partial_replay",
            EYES_REFERENCE_VERSION,
            EYES_REFERENCE_COMMIT,
            EYES_REFERENCE_LICENSE,
            "active_only",
            "referencePrimarySecondaryConcurrencyPorted",
            "pickupExportExposed",
            "effectiveOptionsJcs",
            "triplet_structured",
        ] {
            assert!(text.contains(exact), "missing exact EYES term {exact}");
        }
        for repair in EYES_REFERENCE_DEFECT_REPAIR_IDS {
            assert!(text.contains(repair), "missing EYES repair {repair}");
        }
        assert!(text.contains(EYES_GRAPH));
        assert!(text.contains(&format!(
            "urn:chronicle:eyes-evidence-disposition:{}",
            source["inputDigest"].as_str().unwrap()
        )));
        assert!(text.contains(&format!(
            "urn:chronicle:artifact:eyes-tagged-fau-evidence-json:{}",
            &artifact_digest[7..]
        )));
        assert!(text.contains(&format!(
            "urn:chronicle:eyes-tagged-fau-validation-receipt:{receipt_artifact_digest}"
        )));
    }

    #[test]
    fn eyes_evidence_content_and_exact_claims_fail_closed() {
        let fixture = eyes_fixture();
        let source = eyes_source(fixture);
        let evidence = fixture.substrate_bytes("eyes-tagged-fau-evidence-json");

        // Content tamper inside the transient substrate, metadata untouched.
        let mut content_tamper = evidence.to_vec();
        let last = content_tamper.len() - 2;
        content_tamper[last] = if content_tamper[last] == b'0' { b'1' } else { b'0' };
        assert_eq!(
            rebuild_with(
                &source,
                &fixture.bundle_with("eyes-tagged-fau-evidence-json", &content_tamper)
            )
            .unwrap_err(),
            "semantic scientific artifact content mismatch: eyes-tagged-fau-evidence-json"
        );

        // Payload tampers, with the metadata re-pointed at the tampered bytes so
        // the content-address check cannot mask them.
        for (field, value) in [
            ("protocolVersion", Value::String("chronicle-eyes-tagged-fau-artifact/v2".into())),
            ("status", Value::String("not_applicable".into())),
            (
                "episodeReconstructionStrategy",
                Value::String("fused_matcher".into()),
            ),
        ] {
            let mut payload: Value = serde_json::from_slice(evidence).unwrap();
            payload[field] = value;
            let bytes = serde_jcs::to_vec(&payload).unwrap();
            let mut tampered = source.clone();
            rebind_scientific_artifact(&mut tampered, "eyes-tagged-fau-evidence-json", &bytes);
            assert_eq!(
                rebuild_with(
                    &tampered,
                    &fixture.bundle_with("eyes-tagged-fau-evidence-json", &bytes)
                )
                .unwrap_err(),
                "semantic scientific artifact payload invalid: eyes-tagged-fau-evidence-json",
                "a tampered {field} must fail closed",
            );
        }

        // The summary's own content address must agree with the substrate.
        let mut digest_tamper = source.clone();
        digest_tamper["eyesEvidence"]["taggedFauArtifactDigest"] =
            Value::String(format!("sha256:{}", "a".repeat(64)));
        assert!(rebuild_with(&digest_tamper, &fixture.bundle()).is_err());

        // A `partial_replay` summary that drops any required EYES field is a
        // strategy violation (lib.rs:621-634).
        for field in [
            "taggedFauArtifactDigest",
            "validationReceipt",
            "validationReceiptArtifactDigest",
        ] {
            let mut incomplete = source.clone();
            incomplete["eyesEvidence"][field] = Value::Null;
            assert_eq!(
                rebuild_with(&incomplete, &fixture.bundle()).unwrap_err(),
                "semantic index EYES replay strategy is invalid",
                "a missing {field} must fail independently",
            );
        }
    }

    #[test]
    fn non_eyes_evidence_is_explicit_without_fabricated_receipt_subjects() {
        let source = complete_source();
        let index = rebuild(&source).unwrap();
        let text = String::from_utf8(index).unwrap();
        assert!(!text.contains(EYES_GRAPH));
        assert!(!text.contains("urn:chronicle:eyes-evidence-disposition:"));
        assert!(!text.contains("urn:chronicle:artifact:eyes-tagged-fau-evidence-json:"));
        assert!(!text.contains("urn:chronicle:eyes-tagged-fau-validation-receipt:"));
        assert_eq!(source["eyesEvidence"]["status"], "not_applicable");

        // `chronicle-eyes-partial-replay-receipt/v1` and its participant
        // receipts were deleted from the product, so the fabrication case is
        // asserted against the fields `EyesEvidenceSource` still has
        // (lib.rs:567-576) and the cross-rule at lib.rs:612-619.
        for (field, value) in [
            (
                "taggedFauArtifactDigest",
                Value::String(format!("sha256:{}", "f".repeat(64))),
            ),
            (
                "validationReceiptArtifactDigest",
                Value::String(format!("sha256:{}", "e".repeat(64))),
            ),
            (
                "validationReceipt",
                eyes_fixture().source["eyesEvidence"]["validationReceipt"].clone(),
            ),
        ] {
            let mut fabricated = complete_source();
            fabricated["eyesEvidence"][field] = value;
            assert_eq!(
                rebuild(&fabricated).unwrap_err(),
                "semantic index non-EYES evidence is invalid",
                "a fabricated {field} must fail independently",
            );
        }
        let mut fabricated_strategy = complete_source();
        fabricated_strategy["eyesEvidence"]["episodeReconstructionStrategy"] =
            Value::String("eyes_complement".into());
        assert_eq!(
            rebuild(&fabricated_strategy).unwrap_err(),
            "semantic index non-EYES evidence is invalid"
        );
    }

    #[test]
    fn distinct_eyes_evidence_selects_distinct_rdf_subjects() {
        let a = eyes_fixture();
        let b = eyes_variant_fixture();
        let a_source = eyes_source(a);
        let b_source = eyes_source(b);
        let a_digest = a_source["eyesEvidence"]["taggedFauArtifactDigest"]
            .as_str()
            .unwrap()
            .to_owned();
        let b_digest = b_source["eyesEvidence"]["taggedFauArtifactDigest"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(a_digest, b_digest);

        for (source, fixture, digest) in [(&a_source, a, &a_digest), (&b_source, b, &b_digest)] {
            let index = rebuild_with(source, &fixture.bundle()).unwrap();
            let text = String::from_utf8(index).unwrap();
            let subject = format!(
                "urn:chronicle:artifact:eyes-tagged-fau-evidence-json:{}",
                &digest[7..]
            );
            assert!(text.contains(&subject), "missing content-addressed {subject}");
            let other = if digest == &a_digest {
                &b_digest
            } else {
                &a_digest
            };
            assert!(!text.contains(&format!(
                "urn:chronicle:artifact:eyes-tagged-fau-evidence-json:{}",
                &other[7..]
            )));
        }
    }

    #[test]
    fn each_query_execution_constraint_fails_independently() {
        let expected = "semantic index query execution is invalid";
        let cases = [
            ("status", "unknown"),
            ("input_key", "sha256:short"),
            (
                "output_digest",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            ("reason_id", "sha256:short"),
        ];
        for (field, value) in cases {
            let mut source = complete_source();
            source["queryExecutions"][0][field] = Value::String(value.into());
            assert_eq!(
                rebuild(&source).unwrap_err(),
                expected,
                "invalid {field} must fail independently",
            );
        }

        // A duplicated `query_id` is detected by `validate_compiled_workflow_domain`
        // (lib.rs:3358-3366), which runs at lib.rs:3487 — before the
        // per-execution loop at lib.rs:3493. The v5 fixture supplied 3 of the
        // domain's queries so the domain check could not fire; v7 requires all
        // of `WORKFLOW_QUERIES`, so the duplicate now removes a query from the
        // domain and is reported as an incomplete domain. The duplicate guard
        // at lib.rs:3494-3496 is therefore unreachable defense in depth.
        let first_query_id = complete_source()["queryExecutions"][0]["query_id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut duplicate = complete_source();
        duplicate["queryExecutions"][1]["query_id"] = Value::String(first_query_id);
        assert_eq!(
            rebuild(&duplicate).unwrap_err(),
            "semantic index query execution domain is incomplete",
        );
    }

    #[test]
    fn each_query_checkpoint_and_cache_constraint_fails_independently() {
        let checkpoint_error =
            "semantic index query checkpoint is invalid for decode_source_records";
        for (field, value) in [
            ("protocolVersion", "future"),
            ("subjectId", "other-step"),
            (
                "terminalDigest",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            ("rowMembershipDigest", "xxh3:short"),
        ] {
            let mut source = complete_source();
            source["workflowQueryCheckpoints"]["decode_source_records"][field] =
                Value::String(value.into());
            assert!(
                rebuild(&source)
                    .unwrap_err()
                    .starts_with(checkpoint_error),
                "invalid {field} must fail independently",
            );
        }

        let mut conservative = complete_source();
        conservative["dependencyCacheDecision"] = json!({
            "mode": "conservative_full",
            "certificate_digest": null,
            "binding_surface_digest": null,
            "empirical_evidence_current": false,
            "reasons": ["certificate_mismatch"]
        });
        assert!(rebuild(&conservative).is_ok());

        for missing in ["certificate_digest", "binding_surface_digest"] {
            let mut invalid = complete_source();
            invalid["dependencyCacheDecision"][missing] = Value::Null;
            assert_eq!(
                rebuild(&invalid).unwrap_err(),
                "semantic index dependency cache decision is invalid",
                "certified narrowing requires {missing}",
            );
        }
    }
}

#[cfg(test)]
mod typed_view_tests {
    use super::*;

    const ROOT: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn raw_rows(rows: Vec<Value>) -> Value {
        json!({
            "queryId": "test",
            "variables": [],
            "rows": rows,
        })
    }

    #[test]
    fn registry_retains_exact_scientific_view_descriptors() {
        let evidence = registered_query_descriptor("scientific-evidence").unwrap();
        let bindings = registered_query_descriptor("scientific-source-bindings").unwrap();
        assert_eq!(evidence.view_id, "chronicle.scientific-evidence.v1");
        assert_eq!(bindings.view_id, "chronicle.scientific-source-bindings.v1");
        assert!(evidence.sparql.contains("?lineageDependency"));
        assert!(bindings.sparql.contains("?assignment"));
    }

    #[test]
    fn scientific_evidence_rows_map_to_the_exact_typed_envelope() {
        let raw = raw_rows(vec![json!({
            "?axis": "\"zero_duration_cleanup\"",
            "?receipt": "<urn:receipt:zero>",
            "?status": "\"true\"^^<http://www.w3.org/2001/XMLSchema#boolean>",
            "?artifact": "<urn:artifact:cleanup>",
            "?lineage": "<urn:artifact:lineage>",
            "?dependency": "<urn:artifact:foundation>",
            "?lineageDependency": "<urn:artifact:foundation>"
        })]);
        let view = adapt_registered_query_result(
            "scientific-evidence",
            "chronicle.scientific-evidence.v1",
            raw,
            Some((ROOT, 7)),
        )
        .unwrap();
        assert_eq!(view["protocol_version"], "0.1");
        assert_eq!(view["view_id"], "chronicle.scientific-evidence.v1");
        assert_eq!(view["family"], "incremental-dataflow");
        assert_eq!(
            view["schema_id"],
            "urn:chronicle:view:scientific-evidence:v1"
        );
        assert_eq!(view["revision"], 7);
        assert_eq!(view["root_digest"], ROOT);
        assert_eq!(
            view["payload"]["evidence_bindings"],
            json!([{
                "axis": "zero_duration_cleanup",
                "receipt_id": "urn:receipt:zero",
                "status": true,
                "artifact_id": "urn:artifact:cleanup",
                "lineage_artifact_id": "urn:artifact:lineage",
                "dependency_id": "urn:artifact:foundation",
                "lineage_dependency_id": "urn:artifact:foundation"
            }])
        );
        assert_eq!(view.as_object().unwrap().len(), 7);
        let fixture: Value = serde_json::from_str(include_str!(
            "../fixtures/scientific-evidence-view-instance.json"
        ))
        .unwrap();
        assert_eq!(view, fixture);
    }

    #[test]
    fn scientific_source_rows_have_a_distinct_exact_view_shape() {
        let raw = raw_rows(vec![json!({
            "?graph": "<urn:chronicle:derived:eyes-partial-replay>",
            "?artifact": "<urn:artifact:eyes>",
            "?kind": "\"eyes-tagged-fau-evidence-json\"",
            "?assignment": "<urn:assignment:raw>",
            "?role": "\"raw_chronicle_csv\""
        })]);
        let view = adapt_registered_query_result(
            "scientific-source-bindings",
            "chronicle.scientific-source-bindings.v1",
            raw,
            Some((ROOT, 11)),
        )
        .unwrap();
        assert_eq!(view["protocol_version"], "0.1");
        assert_eq!(
            view["payload"]["source_bindings"],
            json!([{
                "graph_id": "urn:chronicle:derived:eyes-partial-replay",
                "artifact_id": "urn:artifact:eyes",
                "artifact_kind": "eyes-tagged-fau-evidence-json",
                "assignment_id": "urn:assignment:raw",
                "role_id": "raw_chronicle_csv"
            }])
        );
        assert_eq!(view.as_object().unwrap().len(), 7);
        let fixture: Value = serde_json::from_str(include_str!(
            "../fixtures/scientific-source-bindings-view-instance.json"
        ))
        .unwrap();
        assert_eq!(view, fixture);
    }

    #[test]
    fn typed_scientific_views_require_an_exact_verified_context() {
        for context in [None, Some(("sha256:short", 1))] {
            assert!(adapt_registered_query_result(
                "scientific-evidence",
                "chronicle.scientific-evidence.v1",
                raw_rows(Vec::new()),
                context,
            )
            .unwrap_err()
            .contains("verified view context"));
        }
        assert!(adapt_registered_query_result(
            "scientific-evidence",
            "chronicle.scientific-evidence.v1",
            raw_rows(vec![json!({
                "?axis": "\"forged_axis\"",
                "?receipt": "<urn:receipt:forged>",
                "?artifact": "<urn:artifact:forged>"
            })]),
            Some((ROOT, 1)),
        )
        .unwrap_err()
        .contains("unknown axis"));
    }

    #[test]
    fn transient_bundle_is_zeroed_on_success_or_error_return() {
        let mut invalid = b"participant=P01;package=super.secret.package".to_vec();
        assert!(rebuild_semantic_index_native_zeroing(b"{", &mut invalid).is_err());
        assert!(invalid.iter().all(|byte| *byte == 0));

        // The empty-bundle path still exercises a fully parsed source before
        // rejecting its mandatory v7 substrate, and must erase the buffer.
        let mut empty = Vec::new();
        assert!(rebuild_semantic_index_native_zeroing(b"{}", &mut empty).is_err());
        assert!(empty.is_empty());
    }

    #[test]
    fn source_status_cannot_hide_an_applicable_scientific_query() {
        let digest = ROOT.to_string();
        let execution = |status: &str| QueryExecution {
            query_id: "construct_screen_intervals".into(),
            query_group_id: "device_state_timeline".into(),
            status: status.into(),
            input_key: digest.clone(),
            output_digest: digest.clone(),
            reason_id: digest.clone(),
        };
        let assignments = BTreeMap::new();
        let active = serde_json::Map::from_iter([
            (
                "usage_session_mode".into(),
                Value::String("screen_usage".into()),
            ),
            (
                "episode_reconstruction_strategy".into(),
                Value::String("fused_matcher".into()),
            ),
        ]);
        assert!(validate_query_execution_applicability(
            &[execution("recomputed")],
            &active,
            &assignments,
        )
        .is_ok());
        assert!(validate_query_execution_applicability(
            &[execution("bypassed")],
            &active,
            &assignments,
        )
        .unwrap_err()
        .contains("construct_screen_intervals"));

        let inactive = serde_json::Map::from_iter([
            (
                "usage_session_mode".into(),
                Value::String("no_usage".into()),
            ),
            (
                "episode_reconstruction_strategy".into(),
                Value::String("fused_matcher".into()),
            ),
        ]);
        assert!(validate_query_execution_applicability(
            &[execution("bypassed")],
            &inactive,
            &assignments,
        )
        .is_ok());
        assert!(validate_query_execution_applicability(
            &[execution("cached")],
            &inactive,
            &assignments,
        )
        .is_err());
    }

    #[test]
    fn compiled_workflow_domain_rejects_coherent_query_deletion_or_relabeling() {
        let executions = WORKFLOW_QUERIES
            .iter()
            .map(|definition| QueryExecution {
                query_id: definition.id.into(),
                query_group_id: definition.group.into(),
                status: "cached".into(),
                input_key: ROOT.into(),
                output_digest: ROOT.into(),
                reason_id: ROOT.into(),
            })
            .collect::<Vec<_>>();
        let ids = WORKFLOW_QUERIES
            .iter()
            .map(|definition| definition.id)
            .collect::<BTreeSet<_>>();
        assert!(validate_compiled_workflow_domain(&executions, &ids, &ids,).is_ok());

        let deleted_executions = executions
            .iter()
            .filter(|execution| execution.query_id != "construct_screen_intervals")
            .cloned()
            .collect::<Vec<_>>();
        let deleted_ids = ids
            .iter()
            .copied()
            .filter(|query_id| *query_id != "construct_screen_intervals")
            .collect::<BTreeSet<_>>();
        assert!(
            validate_compiled_workflow_domain(&deleted_executions, &deleted_ids, &deleted_ids,)
                .is_err()
        );

        let mut relabeled = executions;
        relabeled
            .iter_mut()
            .find(|execution| execution.query_id == "construct_screen_intervals")
            .unwrap()
            .query_group_id = "outputs".into();
        assert!(validate_compiled_workflow_domain(&relabeled, &ids, &ids,).is_err());
    }

    #[test]
    fn public_query_projection_does_not_claim_unauthenticated_salsa_state() {
        let execution = |status: &str| {
            let mut execution = QueryExecution {
                query_id: "decode_source_records".into(),
                query_group_id: "parse_events".into(),
                status: status.into(),
                input_key: ROOT.into(),
                output_digest: ROOT.into(),
                reason_id: String::new(),
            };
            execution.reason_id = expected_query_reason_id(&execution);
            execution
        };
        let cached = execution("cached");
        let recomputed = execution("recomputed");
        assert!(
            validate_query_execution_identity(&cached, Some("parse_events"), Some(ROOT),).is_ok()
        );
        assert!(
            validate_query_execution_identity(&recomputed, Some("parse_events"), Some(ROOT),)
                .is_ok()
        );
        assert_eq!(public_query_execution_status(&cached), "completed");
        assert_eq!(public_query_execution_status(&recomputed), "completed");
        assert_eq!(
            public_query_execution_status(&execution("bypassed")),
            "not-applicable"
        );

        let mut status_tamper = cached;
        status_tamper.status = "recomputed".into();
        assert!(validate_query_execution_identity(
            &status_tamper,
            Some("parse_events"),
            Some(ROOT),
        )
        .is_err());
        status_tamper.reason_id = expected_query_reason_id(&status_tamper);
        assert!(validate_query_execution_identity(
            &status_tamper,
            Some("parse_events"),
            Some(ROOT),
        )
        .is_ok());
        assert_eq!(public_query_execution_status(&status_tamper), "completed");
    }

    /// The accepted-status vocabulary is a live fail-closed guard, not an
    /// oversight, and it must not be widened to admit `"skipped"`.
    ///
    /// A `"skipped"` execution row is produced only by a run with
    /// `materialize_full_outputs == false`
    /// (`chronicle_preprocessing_runtime_wasm/src/lib.rs:3843`). Three facts make
    /// refusing it correct rather than incidental:
    ///
    /// 1. `chronicle_preprocessing_runtime_wasm/src/lib.rs:4336` sets
    ///    `materialize_full_outputs: request.command != QUERY_REVIEW_COMMAND`, and
    ///    `lib.rs:119-120` define the only two commands (any other is rejected at
    ///    `lib.rs:1893`). The execute path therefore always materializes, so
    ///    `"skipped"` is unreachable from a correct runtime.
    /// 2. The `QueryReview` branch of `execute_prepared_workspace` builds its own
    ///    artifact vector and returns at `runtime lib.rs:5399`, 275 lines before
    ///    the sole producer of `semantic-index-source-json` at
    ///    `runtime lib.rs:5674` in the same function body. A review run mints no
    ///    workspace root and emits no index source at all — the web half of that
    ///    invariant is pinned in `web/src/lib/semanticIndex.test.ts`.
    /// 3. When those queries are not materialized the kernel still writes
    ///    well-formed *placeholder* checkpoints:
    ///    `chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs:15373`
    ///    inserts `workflow_state_checkpoint("index_raw_dates", "not_requested")`,
    ///    and `pipeline_v2.rs:5827` builds those with a correct protocol, subject,
    ///    component digests and terminal rehash, so
    ///    `validate_workflow_checkpoint_for_subject` (`pipeline_v2.rs:4846`)
    ///    accepts them and `validate_compiled_workflow_domain` sees a complete
    ///    domain. The published `output_digest` of such a row is a real sha256 of
    ///    a placeholder, not of a product.
    ///
    /// In `chronicle-semantic-index-source/v7` the status string is consequently
    /// the only validated field separating a placeholder from a product claim.
    /// `validate_query_execution_applicability` does not catch it — a `"skipped"`
    /// row is applicable, so its `(status == "bypassed") != !applicable` test is
    /// `false != false` — and `public_query_execution_status` special-cases only
    /// `"bypassed"`, so a `"skipped"` row would publish as `"completed"`. Widening
    /// this whitelist would mask that defect class, not close it. Admitting a
    /// review-sourced index is a deliberate `/v7` -> `/v8` protocol bump plus
    /// typed-view registration, never a vocabulary relaxation.
    #[test]
    fn unmaterialized_and_failed_execution_statuses_are_refused_by_the_source_gate() {
        // `index_raw_dates` is one of the twelve `ReviewBehavior::Omit` queries
        // (`workflow_contract.rs:4904-4919`); its group is `day_coverage`
        // (`workflow_contract.rs:2350-2352`).
        let execution = |status: &str| {
            let mut execution = QueryExecution {
                query_id: "index_raw_dates".into(),
                query_group_id: "day_coverage".into(),
                status: status.into(),
                input_key: ROOT.into(),
                output_digest: ROOT.into(),
                reason_id: String::new(),
            };
            // Self-consistent by construction, so the rejection below is about the
            // status vocabulary alone and not about a stale reason digest.
            execution.reason_id = expected_query_reason_id(&execution);
            execution
        };

        for refused in ["skipped", "error", "not_requested", "not-applicable"] {
            let candidate = execution(refused);
            assert_eq!(
                candidate.reason_id,
                expected_query_reason_id(&candidate),
                "{refused} fixture must be self-consistent",
            );
            assert_eq!(
                validate_query_execution_identity(
                    &candidate,
                    Some("day_coverage"),
                    Some(ROOT),
                )
                .unwrap_err(),
                "semantic index query execution is invalid",
                "{refused} must not be accepted as a compiled product execution",
            );
        }

        // Positive controls, so this test cannot rot into a tautology that would
        // still pass if the whitelist were emptied.
        for accepted in ["cached", "recomputed", "bypassed"] {
            assert!(
                validate_query_execution_identity(
                    &execution(accepted),
                    Some("day_coverage"),
                    Some(ROOT),
                )
                .is_ok(),
                "{accepted} is a materialized product status and must be accepted",
            );
        }
    }

    #[test]
    fn coherent_query_output_and_terminal_rehash_cannot_forge_a_checkpoint() {
        const VALID_TERMINAL: &str =
            "sha256:b034b7936393bee0ee7baed2a5ee082fc41f67c2a17d6e360b49cfdb8ff55a89";
        let mut checkpoint = WorkflowCheckpoint {
            protocol_version: "chronicle-workflow-checkpoint/v1".into(),
            subject_id: "decode_source_records".into(),
            row_membership_digest: "xxh3:00000000000000000000000000000001".into(),
            row_order_digest: "xxh3:00000000000000000000000000000002".into(),
            temporal_state_digest: "xxh3:00000000000000000000000000000003".into(),
            classification_digest: "xxh3:00000000000000000000000000000004".into(),
            payload_digest: "xxh3:00000000000000000000000000000005".into(),
            schema_digest: "xxh3:00000000000000000000000000000006".into(),
            terminal_digest: VALID_TERMINAL.into(),
        };
        let mut execution = QueryExecution {
            query_id: "decode_source_records".into(),
            query_group_id: "parse_events".into(),
            status: "recomputed".into(),
            input_key: ROOT.into(),
            output_digest: VALID_TERMINAL.into(),
            reason_id: String::new(),
        };
        execution.reason_id = expected_query_reason_id(&execution);
        assert!(validate_query_execution_identity(
            &execution,
            Some("parse_events"),
            Some(VALID_TERMINAL),
        )
        .is_ok());
        assert!(validate_query_checkpoint_identity(
            "decode_source_records",
            &checkpoint,
            Some(VALID_TERMINAL),
        )
        .is_ok());

        // Coherently change the execution output, digest-map value, checkpoint
        // terminal, and reason. Their cross-equality still holds, but the
        // kernel-owned terminal formula must reject the forged closure.
        checkpoint.terminal_digest = ROOT.into();
        execution.output_digest = ROOT.into();
        execution.reason_id = expected_query_reason_id(&execution);
        assert!(
            validate_query_execution_identity(&execution, Some("parse_events"), Some(ROOT),)
                .is_ok()
        );
        assert!(validate_query_checkpoint_identity(
            "decode_source_records",
            &checkpoint,
            Some(ROOT),
        )
        .is_err());
    }
}
