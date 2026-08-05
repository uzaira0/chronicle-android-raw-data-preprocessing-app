//! The product-owned, count-neutral preprocessing workflow contract.
//!
//! Chronicle has several legitimate views of the same work: semantic
//! operations, typed artifacts, physical Salsa queries, presentation phases,
//! checkpoint policy, and run evidence.  This module keeps those layers
//! explicit so none of them has to masquerade as a numbered "step" list.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const WORKFLOW_MODEL_VERSION: &str = "workflow-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationRole {
    IngestValidate,
    StandardizeRepair,
    ReconstructInfer,
    EnrichAnnotate,
    ApplyMeasurementPolicy,
    AnalyzeAssess,
    PublishEncode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EpistemicRole {
    Observed,
    Derived,
    Inferred,
    PolicyApplied,
    Synthetic,
    Encoded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DataEffect {
    Preserves,
    DropsRows,
    RewritesValues,
    SplitsRows,
    SynthesizesRows,
    Classifies,
    Aggregates,
    Encodes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Source,
    Configuration,
    Records,
    Index,
    Intervals,
    Table,
    Metric,
    Manifest,
    Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryClassification {
    OperationBacked,
    Internal,
    Provenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewBehavior {
    Execute,
    Passthrough,
    Omit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub display_order: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationConfigDependency {
    pub field: String,
    pub effect: &'static str,
    pub identity_mode: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub phase_id: &'static str,
    pub role: OperationRole,
    pub epistemic_role: EpistemicRole,
    pub input_artifacts: Vec<String>,
    pub output_artifacts: Vec<String>,
    pub query_ids: Vec<&'static str>,
    pub config_dependencies: Vec<OperationConfigDependency>,
    pub data_effects: &'static [DataEffect],
    pub audience_tags: Vec<&'static str>,
    pub applicability: ApplicabilityExpression,
    pub definition_digest: String,
    pub closure_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDefinition {
    pub id: String,
    pub label: String,
    pub kind: ArtifactKind,
    pub schema_id: String,
    pub producer_operation_id: Option<&'static str>,
    pub consumer_operation_ids: Vec<&'static str>,
    pub epistemic_role: EpistemicRole,
    pub materialization: &'static str,
    pub equality: &'static str,
    pub audience_tags: Vec<&'static str>,
    pub definition_digest: String,
    pub closure_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSemanticContract {
    pub root_roles: Vec<WorkflowRootRoleDefinition>,
    pub operations: Vec<OperationDefinition>,
    pub artifacts: Vec<ArtifactDefinition>,
    pub output_cell_bindings: Vec<PipelineOutputCellBinding>,
    pub exact_cell_contributions: Vec<PipelineExactCellContribution>,
    pub row_set_fields: &'static [&'static str],
    pub row_addressed_output_kinds: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPresentationContract {
    pub phases: &'static [PhaseDefinition],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExecutionContract {
    pub query_groups: Vec<QueryGroupContractEntry>,
    pub queries: Vec<WorkflowQueryContractEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCheckpointContract {
    pub identity_scope: &'static str,
    pub review_event_base: &'static str,
    pub reconstructed_episode_base: &'static str,
    pub durable_promotion_policy: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEvidenceContract {
    pub operation_application_states: &'static [&'static str],
    pub artifact_states: &'static [&'static str],
    pub query_execution_states: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContractDigests {
    pub semantic: String,
    pub presentation: String,
    pub execution: String,
    pub checkpoint_policy: String,
    pub evidence: String,
    pub workspace_compatibility: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryGroupDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub section: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDependencyDefinition {
    pub option_key: &'static str,
    pub edge: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ApplicabilityExpression {
    Always,
    OptionTrue {
        option_key: &'static str,
    },
    OptionBooleanEquals {
        option_key: &'static str,
        value: bool,
    },
    OptionStringEquals {
        option_key: &'static str,
        value: &'static str,
    },
    ArrayNonempty {
        option_key: &'static str,
    },
    StringNonempty {
        option_key: &'static str,
    },
    SupportPresent {
        role_id: &'static str,
    },
    All {
        terms: Vec<ApplicabilityExpression>,
    },
    Any {
        terms: Vec<ApplicabilityExpression>,
    },
    Not {
        term: Box<ApplicabilityExpression>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryGroupContractEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub section: &'static str,
    pub knobs: &'static [ConfigDependencyDefinition],
    pub support_roles: &'static [&'static str],
    pub applicability: ApplicabilityExpression,
    pub can_bypass: bool,
    pub early_cutoff: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRootRoleDefinition {
    pub role_id: &'static str,
    pub minimum: usize,
    pub maximum: usize,
    pub media_types: &'static [&'static str],
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_when: Option<ApplicabilityExpression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualification: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowQueryDefinition {
    pub id: &'static str,
    pub group: &'static str,
    pub inputs: &'static [&'static str],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContract {
    pub protocol_version: &'static str,
    pub workflow_model_version: &'static str,
    pub preprocessor_version: &'static str,
    pub canonical_interaction_types: &'static [&'static str],
    pub unbound_option_keys: &'static [&'static str],
    pub semantic: WorkflowSemanticContract,
    pub presentation: WorkflowPresentationContract,
    pub execution: WorkflowExecutionContract,
    pub checkpoint_policy: WorkflowCheckpointContract,
    pub evidence: WorkflowEvidenceContract,
    pub digests: WorkflowContractDigests,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowQueryContractEntry {
    pub id: &'static str,
    pub group: &'static str,
    pub inputs: &'static [&'static str],
    pub operation_ids: Vec<&'static str>,
    pub classification: QueryClassification,
    pub review_behavior: ReviewBehavior,
    pub output_ports: Vec<String>,
    pub request_fields: &'static [&'static str],
    pub source_roles: &'static [&'static str],
    pub source_role_bindings: Vec<QuerySourceRoleBinding>,
    pub field_reads: &'static [&'static str],
    pub field_writes: &'static [&'static str],
    pub field_edges: Vec<WorkflowFieldEdge>,
    pub applicability: ApplicabilityExpression,
    pub can_bypass: bool,
    pub definition_digest: String,
    pub closure_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySourceRoleBinding {
    pub role: &'static str,
    pub when_all: &'static [QuerySourceRolePredicate],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "operator", rename_all = "snake_case")]
pub enum QuerySourceRolePredicate {
    BooleanEquals {
        request_field: &'static str,
        value: bool,
    },
    StringOneOf {
        request_field: &'static str,
        values: &'static [&'static str],
    },
}

/// Physical query-group membership is derived from the query DAG. This
/// function supplies presentation metadata only; it is deliberately not a
/// second topology registry or a fixed group count.
fn query_group_definition(id: &'static str) -> QueryGroupDefinition {
    let (label, section) = match id {
        "parse_events" => ("Event parsing", "preprocess"),
        "normalize_timezones" => ("Timezone normalization", "preprocess"),
        "dedup_and_order" => ("Event deduplication and ordering", "preprocess"),
        "app_policy" => ("App inclusion policy", "clean"),
        "device_state_timeline" => ("Screen-session reconstruction", "preprocess"),
        "reconstruct_episodes" => ("Usage-episode reconstruction", "preprocess"),
        "categorize_apps" => ("App categorization", "preprocess"),
        "episode_annotations" => ("Episode annotation", "preprocess"),
        "interval_cleaning" => ("Interval cleaning", "clean"),
        "effective_usage" => ("Screen-gated usage credit", "clean"),
        "observation_window" => ("Observation-window assessment", "analyze"),
        "attribute_person" => ("Person attribution", "analyze"),
        "day_coverage" => ("Day coverage", "analyze"),
        "score_compliance" => ("Compliance assessment", "analyze"),
        "outputs" => ("Deliverables", "output"),
        _ => (id, "internal"),
    };
    QueryGroupDefinition { id, label, section }
}

pub fn workflow_query_group_ids() -> Vec<&'static str> {
    let mut seen = BTreeSet::new();
    WORKFLOW_QUERIES
        .iter()
        .filter_map(|query| seen.insert(query.group).then_some(query.group))
        .collect()
}

pub const WORKFLOW_PHASES: &[PhaseDefinition] = &[
    PhaseDefinition {
        id: "import_verify",
        label: "Import and verify data",
        description: "Read source files, validate required values, and record source evidence.",
        display_order: 10,
    },
    PhaseDefinition {
        id: "standardize_timeline",
        label: "Standardize the event timeline",
        description: "Normalize clocks, ordering, duplicate events, and timeline gaps.",
        display_order: 20,
    },
    PhaseDefinition {
        id: "reconstruct_activity",
        label: "Reconstruct activity",
        description: "Infer screen sessions and app-usage episodes from event evidence.",
        display_order: 30,
    },
    PhaseDefinition {
        id: "apply_measurement_rules",
        label: "Apply measurement rules",
        description: "Apply declared inclusion, duration, concurrency, and crediting policies.",
        display_order: 40,
    },
    PhaseDefinition {
        id: "add_context",
        label: "Add app and person context",
        description: "Join codebooks and attribute activity to people and categories.",
        display_order: 50,
    },
    PhaseDefinition {
        id: "assess_coverage",
        label: "Assess study coverage",
        description:
            "Build participant-day evidence, completeness measures, and compliance decisions.",
        display_order: 60,
    },
    PhaseDefinition {
        id: "create_deliverables",
        label: "Create deliverables",
        description: "Project scientific tables, encodings, review data, lineage, and provenance.",
        display_order: 70,
    },
];

#[derive(Debug, Clone, Copy)]
struct OperationSpec {
    query_id: &'static str,
    id: &'static str,
    label: &'static str,
    description: &'static str,
    phase_id: &'static str,
    role: OperationRole,
    epistemic_role: EpistemicRole,
    effects: &'static [DataEffect],
    /// Operations implemented by one fused query normally form a semantic
    /// chain.  Parallel output projections instead read the query's upstream
    /// artifacts directly.
    follows_previous: bool,
}

macro_rules! operation {
    ($query:literal, $id:literal, $label:literal, $description:literal, $phase:literal,
     $role:ident, $epistemic:ident, [$($effect:ident),+], $follows:literal) => {
        OperationSpec {
            query_id: $query,
            id: $id,
            label: $label,
            description: $description,
            phase_id: $phase,
            role: OperationRole::$role,
            epistemic_role: EpistemicRole::$epistemic,
            effects: &[$(DataEffect::$effect),+],
            follows_previous: $follows,
        }
    };
}

const OPERATION_SPECS: &[OperationSpec] = &[
    operation!(
        "validate_remap_rules",
        "source.validate_remap_rules",
        "Validate remapping rules",
        "Validate the configured interaction-name remapping before it is used.",
        "import_verify",
        IngestValidate,
        Observed,
        [Preserves],
        true
    ),
    operation!(
        "decode_source_records",
        "source.decode_records",
        "Decode source records",
        "Decode Chronicle CSV rows without applying measurement policy.",
        "import_verify",
        IngestValidate,
        Observed,
        [Preserves],
        true
    ),
    operation!(
        "remove_missing_timestamps",
        "quality.remove_missing_timestamps",
        "Remove records without timestamps",
        "Remove source records that cannot be placed on a timeline.",
        "import_verify",
        StandardizeRepair,
        Derived,
        [DropsRows],
        true
    ),
    operation!(
        "attach_device_models",
        "evidence.summarize_device_models",
        "Summarize device models",
        "Derive device-model evidence from the retained source records.",
        "import_verify",
        IngestValidate,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "attach_device_models",
        "source.attach_device_models",
        "Attach device models",
        "Attach the resolved device model to each record.",
        "import_verify",
        StandardizeRepair,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "source.decode_record_fields",
        "Decode record fields",
        "Convert source values into the typed internal row representation.",
        "import_verify",
        IngestValidate,
        Derived,
        [Preserves],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "time.apply_missing_timezone_rule",
        "Resolve missing timezone values",
        "Apply the versioned missing-timezone rule.",
        "standardize_timeline",
        StandardizeRepair,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "identity.normalize_usernames",
        "Normalize participant usernames",
        "Apply the canonical username casing rule.",
        "standardize_timeline",
        StandardizeRepair,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "source.initialize_lineage",
        "Initialize source lineage",
        "Bind internal rows to their source coordinates.",
        "import_verify",
        IngestValidate,
        Observed,
        [Preserves],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "interaction.normalize_names",
        "Normalize interaction names",
        "Apply configured interaction-name remapping.",
        "standardize_timeline",
        StandardizeRepair,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "canonicalize_source_rows",
        "time.derive_target_calendar",
        "Derive calendar fields",
        "Derive date, weekday, hour, and quarter values from the standardized clock.",
        "standardize_timeline",
        StandardizeRepair,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "order_source_records",
        "time.order_source_records",
        "Order source records",
        "Establish the deterministic event order required downstream.",
        "standardize_timeline",
        StandardizeRepair,
        Derived,
        [Preserves],
        true
    ),
    operation!(
        "collect_timezone_observations",
        "evidence.collect_timezone_observations",
        "Collect timezone observations",
        "Collect timezone evidence without selecting a policy.",
        "standardize_timeline",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "estimate_dominant_timezone",
        "evidence.estimate_dominant_timezone",
        "Estimate the dominant timezone",
        "Estimate the dominant timezone from observed values.",
        "standardize_timeline",
        AnalyzeAssess,
        Inferred,
        [Aggregates],
        true
    ),
    operation!(
        "resolve_timezone_strategy",
        "policy.resolve_timezone_strategy",
        "Resolve timezone policy",
        "Resolve the configured timezone handling policy.",
        "standardize_timeline",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "resolve_timezone_strategy",
        "quality.select_timezone_eligible_records",
        "Select timezone-eligible records",
        "Retain the records permitted by the selected timezone policy.",
        "standardize_timeline",
        StandardizeRepair,
        PolicyApplied,
        [DropsRows],
        true
    ),
    operation!(
        "standardize_event_clock",
        "time.standardize_event_clock",
        "Standardize event clocks",
        "Restamp event times using the resolved timezone policy.",
        "standardize_timeline",
        StandardizeRepair,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "summarize_row_selection",
        "evidence.summarize_row_selection",
        "Summarize row selection",
        "Report record counts before and after timezone selection.",
        "standardize_timeline",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "coalesce_duplicate_event_keys",
        "quality.coalesce_duplicate_event_keys",
        "Coalesce duplicate event keys",
        "Retain the first matching event-key row and merge its lineage.",
        "standardize_timeline",
        StandardizeRepair,
        Derived,
        [DropsRows, RewritesValues],
        true
    ),
    operation!(
        "summarize_duplicate_groups",
        "evidence.summarize_duplicate_groups",
        "Summarize duplicate groups",
        "Report groups that shared the deduplication key.",
        "standardize_timeline",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "disambiguate_duplicate_timestamps",
        "quality.disambiguate_duplicate_timestamps",
        "Disambiguate duplicate timestamps",
        "Apply versioned event precedence when timestamps collide.",
        "standardize_timeline",
        StandardizeRepair,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "derive_time_gap_evidence",
        "evidence.derive_time_gaps",
        "Derive timeline gaps",
        "Measure gaps between ordered events for later rules.",
        "standardize_timeline",
        AnalyzeAssess,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "mark_app_policy_matches",
        "policy.match_app_exclusion_rows",
        "Match app-exclusion rows",
        "Identify source rows matching the configured app exclusion evidence.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "index_keyguard_events",
        "evidence.index_keyguard_events",
        "Index keyguard events",
        "Build reusable keyguard evidence for screen reconstruction.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "infer_screen_session_skeletons",
        "reconstruct.infer_screen_session_skeletons",
        "Infer screen-session skeletons",
        "Reconstruct policy-neutral screen-session candidates.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "classify_screen_sessions",
        "evidence.derive_screen_session_features",
        "Derive screen-session evidence",
        "Derive reusable evidence features for candidate screen sessions.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "classify_screen_sessions",
        "policy.classify_screen_end_reasons",
        "Classify screen-session endings",
        "Apply forcing and threshold rules to screen-session evidence.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "classify_screen_sessions",
        "reconstruct.materialize_screen_sessions",
        "Materialize screen sessions",
        "Materialize the classified screen-session table.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [RewritesValues],
        true
    ),
    operation!(
        "resolve_excluded_packages",
        "policy.resolve_effective_app_exclusions",
        "Resolve excluded app packages",
        "Convert matching source rows into the effective package exclusion set.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Aggregates],
        true
    ),
    operation!(
        "mask_excluded_app_events",
        "policy.mask_excluded_app_events",
        "Mask excluded app events",
        "Preserve current matching behavior while policy-neutral reconstruction is introduced.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "build_app_event_index",
        "policy.resolve_matcher_masks",
        "Resolve matcher masks",
        "Apply configured stop and background-event rules to matcher inputs.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        false
    ),
    operation!(
        "build_app_event_index",
        "reconstruct.index_app_events",
        "Index app events",
        "Build the reusable event factorization used by episode matching.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "match_app_episodes",
        "reconstruct.match_app_episodes",
        "Match app episodes",
        "Infer candidate usage episodes from indexed events.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "materialize_candidate_episodes",
        "reconstruct.materialize_candidate_episodes",
        "Materialize candidate episodes",
        "Materialize matcher results and missing-end evidence.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [RewritesValues],
        true
    ),
    operation!(
        "classify_episode_durations",
        "reconstruct.discard_structural_events",
        "Discard structural event rows",
        "Remove event-only rows after their structural information has been consumed.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [DropsRows],
        true
    ),
    operation!(
        "classify_episode_durations",
        "reconstruct.classify_app_episodes",
        "Classify reconstructed episodes",
        "Finalize the reconstructed episode representation.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "classify_episode_durations",
        "policy.suppress_short_durations",
        "Suppress short durations",
        "Blank durations below the configured minimum without deleting episodes.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "apply_app_inclusion_policy",
        "policy.apply_app_inclusion",
        "Apply app inclusion policy",
        "Apply the effective package set to reconstructed episodes.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "order_app_episodes",
        "reconstruct.order_app_episodes",
        "Order app episodes",
        "Establish deterministic episode order for downstream interval logic.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Preserves],
        true
    ),
    operation!(
        "segment_concurrent_usage",
        "reconstruct.segment_concurrent_usage",
        "Segment concurrent usage",
        "Split overlapping usage into concurrent segments.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [SplitsRows],
        true
    ),
    operation!(
        "segment_concurrent_usage",
        "policy.apply_concurrent_segment_floor",
        "Apply the concurrent-segment floor",
        "Apply the optional minimum-duration policy to generated segments.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "join_app_codebook",
        "context.join_app_codebook",
        "Join the app codebook",
        "Attach supplied app metadata to reconstructed episodes.",
        "add_context",
        EnrichAnnotate,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "derive_broad_category",
        "context.derive_broad_category",
        "Derive broad app categories",
        "Derive the broad analysis category from app metadata.",
        "add_context",
        EnrichAnnotate,
        Derived,
        [Classifies],
        true
    ),
    operation!(
        "collapse_app_genre",
        "context.collapse_app_genre",
        "Collapse app genres",
        "Collapse detailed genres into the configured reporting vocabulary.",
        "add_context",
        EnrichAnnotate,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "derive_engagement_basis",
        "reconstruct.derive_engagement_basis",
        "Derive engagement evidence",
        "Build threshold-independent engagement transitions and gaps.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "derive_engagement_basis",
        "policy.classify_engagement",
        "Classify engagement",
        "Apply engagement-duration policy to the reusable evidence.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "apply_episode_flags",
        "policy.flag_long_usage",
        "Flag long usage",
        "Apply long-usage thresholds.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        false
    ),
    operation!(
        "apply_episode_flags",
        "policy.flag_long_gaps",
        "Flag long data gaps",
        "Apply long-gap thresholds.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        false
    ),
    operation!(
        "suppress_excluded_timing",
        "policy.suppress_excluded_timing",
        "Suppress excluded timing",
        "Blank timing values excluded from measurement.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "remove_selected_interaction_types",
        "policy.remove_selected_interaction_types",
        "Remove selected interaction types",
        "Remove rows selected by interaction-type policy while preserving gap exceptions.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [DropsRows],
        true
    ),
    operation!(
        "remove_zero_duration_rows",
        "quality.remove_zero_duration_rows",
        "Remove zero-duration rows",
        "Remove rows with a zero measured duration when enabled.",
        "apply_measurement_rules",
        StandardizeRepair,
        PolicyApplied,
        [DropsRows],
        true
    ),
    operation!(
        "identify_credit_eligible_sessions",
        "credit.identify_eligible_sessions",
        "Identify credit-eligible sessions",
        "Partition reconstructed sessions by credit eligibility.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "build_activity_witness_indexes",
        "evidence.index_device_activity",
        "Index device activity",
        "Build device-activity witness intervals.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Aggregates],
        false
    ),
    operation!(
        "build_activity_witness_indexes",
        "evidence.index_reboots",
        "Index device reboots",
        "Build reboot evidence used by liveness rules.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Aggregates],
        false
    ),
    operation!(
        "build_activity_witness_indexes",
        "evidence.index_screen_witnesses",
        "Index screen witnesses",
        "Build screen evidence used by credit rules.",
        "reconstruct_activity",
        ReconstructInfer,
        Derived,
        [Aggregates],
        false
    ),
    operation!(
        "assess_screen_evidence_capability",
        "assessment.report_screen_evidence_capability",
        "Assess screen evidence capability",
        "Report participants for whom screen evidence can support crediting.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Classifies],
        true
    ),
    operation!(
        "summarize_daily_apps",
        "evidence.summarize_daily_apps",
        "Summarize daily apps",
        "Report daily app evidence consumed by credit policy.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "derive_credited_intervals",
        "credit.cap_candidate_intervals",
        "Cap candidate intervals",
        "Apply session caps before evidence intersection.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "derive_credited_intervals",
        "credit.derive_device_live_spans",
        "Derive device-live spans",
        "Derive intervals supported by activity and reboot evidence.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "derive_credited_intervals",
        "credit.derive_screen_creditable_spans",
        "Derive screen-creditable spans",
        "Derive intervals supported by screen evidence.",
        "reconstruct_activity",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "derive_credited_intervals",
        "credit.intersect_evidence",
        "Intersect credit evidence",
        "Intersect candidate intervals with available witness evidence.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [SplitsRows],
        true
    ),
    operation!(
        "derive_credited_intervals",
        "credit.apply_no_witness_fallback",
        "Apply no-witness fallback",
        "Apply the declared fallback for missing or incapable screen evidence.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "materialize_credited_rows",
        "credit.materialize_credited_rows",
        "Materialize credited rows",
        "Emit scientific credited intervals separately from lineage-search evidence.",
        "apply_measurement_rules",
        ReconstructInfer,
        Derived,
        [RewritesValues],
        true
    ),
    operation!(
        "assemble_credit_outputs",
        "credit.publish_credit_result",
        "Assemble credit outputs",
        "Expose credited rows, metrics, and capability evidence through typed ports.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        true
    ),
    operation!(
        "resolve_participant_windows",
        "study.resolve_participant_windows",
        "Resolve participant windows",
        "Resolve participant-specific observation windows.",
        "add_context",
        EnrichAnnotate,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "apply_participant_windows",
        "study.apply_participant_windows",
        "Apply participant windows",
        "Retain rows inside each participant observation window.",
        "apply_measurement_rules",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [DropsRows],
        true
    ),
    operation!(
        "resolve_sharing_status",
        "study.resolve_sharing_status",
        "Resolve device sharing",
        "Resolve device-sharing evidence for person attribution.",
        "add_context",
        EnrichAnnotate,
        Derived,
        [Classifies],
        true
    ),
    operation!(
        "index_survey_responses",
        "study.index_survey_responses",
        "Index survey responses",
        "Build optional survey evidence for person attribution.",
        "add_context",
        EnrichAnnotate,
        Observed,
        [Aggregates],
        true
    ),
    operation!(
        "classify_person_attribution",
        "context.infer_default_person",
        "Infer the default person",
        "Apply the built-in default and kids-shell attribution rules.",
        "add_context",
        ReconstructInfer,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "classify_person_attribution",
        "context.apply_survey_person_override",
        "Apply survey attribution",
        "Override default attribution where survey evidence applies.",
        "add_context",
        EnrichAnnotate,
        PolicyApplied,
        [RewritesValues],
        true
    ),
    operation!(
        "classify_person_attribution",
        "context.classify_person_attribution",
        "Classify person attribution",
        "Classify activity as target, non-target, or unresolved.",
        "add_context",
        EnrichAnnotate,
        Inferred,
        [Classifies],
        true
    ),
    operation!(
        "synthesize_placeholder_rows",
        "assessment.synthesize_placeholder_rows",
        "Add missing-day placeholders",
        "Create explicitly synthetic rows for missing participant days.",
        "assess_coverage",
        AnalyzeAssess,
        Synthetic,
        [SynthesizesRows],
        true
    ),
    operation!(
        "index_raw_dates",
        "evidence.index_raw_dates",
        "Index observed dates",
        "Index pre-window source dates used by coverage and placeholders.",
        "assess_coverage",
        AnalyzeAssess,
        Observed,
        [Aggregates],
        true
    ),
    operation!(
        "build_participant_day_coverage",
        "assessment.build_participant_day_spine",
        "Build the participant-day spine",
        "Create the participant-day domain used for coverage.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [SynthesizesRows],
        true
    ),
    operation!(
        "build_participant_day_coverage",
        "assessment.classify_days",
        "Classify participant days",
        "Classify observed, missing, and placeholder days.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Classifies],
        true
    ),
    operation!(
        "build_participant_day_coverage",
        "assessment.summarize_coverage",
        "Summarize study coverage",
        "Produce the coverage table and its encoding inputs.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "aggregate_attribution_minutes",
        "assessment.aggregate_attribution_minutes",
        "Aggregate attributed minutes",
        "Build threshold-independent participant-day attribution totals.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "compute_attribution_completeness",
        "assessment.compute_completeness",
        "Compute completeness",
        "Compute threshold-independent completeness percentages and zero-use evidence.",
        "assess_coverage",
        AnalyzeAssess,
        Derived,
        [Aggregates],
        true
    ),
    operation!(
        "classify_compliance_days",
        "policy.apply_compliance_threshold",
        "Apply the compliance threshold",
        "Classify participant days using the configured threshold.",
        "assess_coverage",
        ApplyMeasurementPolicy,
        PolicyApplied,
        [Classifies],
        true
    ),
    operation!(
        "assemble_result_manifest",
        "publish.project_app_table",
        "Build the app table",
        "Project the scientific app-usage table.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.project_screen_table",
        "Build the screen table",
        "Project the scientific screen-session table.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.project_credited_table",
        "Build the credited table",
        "Project the scientific credited-usage table.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.build_aggregate_tables",
        "Build aggregate tables",
        "Build daily, weekly, category, top-app, and co-usage aggregates.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Aggregates, Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.encode_selected_formats",
        "Encode selected formats",
        "Encode only the requested CSV, Parquet, and SPSS deliverables.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.build_review_data",
        "Build review data",
        "Build the participant and session review projection.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.build_visualization_data",
        "Build visualization data",
        "Build timeline, plot, and heatmap data without owning scientific semantics.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.emit_lineage",
        "Emit result lineage",
        "Emit row, source-coordinate, and result-cell correspondence evidence.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.emit_provenance",
        "Emit workflow provenance",
        "Emit configuration, influence, contract, and execution evidence.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        false
    ),
    operation!(
        "assemble_result_manifest",
        "publish.commit_workspace_bundle",
        "Commit the workspace bundle",
        "Commit the typed result manifest and all selected deliverables.",
        "create_deliverables",
        PublishEncode,
        Encoded,
        [Encodes],
        true
    ),
];

pub fn query_group_config_dependencies(group_id: &str) -> &'static [ConfigDependencyDefinition] {
    match group_id {
        "parse_events" => &[
            ConfigDependencyDefinition {
                option_key: "interaction_type_remap",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "selected_timezone",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "datetime_of_preprocessing",
                edge: "tunes",
            },
        ],
        "normalize_timezones" => &[
            ConfigDependencyDefinition {
                option_key: "selected_timezone",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "timezone_handling",
                edge: "tunes",
            },
        ],
        "dedup_and_order" => &[
            ConfigDependencyDefinition {
                option_key: "deduplicate_exact_rows",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "correct_duplicate_event_timestamps",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "same_app_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "other_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
        ],
        "app_policy" => &[ConfigDependencyDefinition {
            option_key: "use_filter_file",
            edge: "gates",
        }],
        "device_state_timeline" => &[
            ConfigDependencyDefinition {
                option_key: "process_screen_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "use_apps_forcing_screen_open_file",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "screen_usage_auto_lock_timeout_seconds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "screen_usage_auto_lock_tolerance_seconds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "screen_usage_manual_lock_max_tail_gap_seconds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "screen_usage_keyguard_near_stop_seconds",
                edge: "tunes",
            },
        ],
        "reconstruct_episodes" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "use_background_apps_file",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "allow_stop_event_reuse",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "use_activity_stopped_as_fallback",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "apply_threshold_to_fallback",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "long_duration_threshold_hours",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "minimum_usage_duration",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "proximity_interval_seconds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "model_concurrent_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "apply_minimum_usage_duration_to_concurrent_subintervals",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "same_app_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "other_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
        ],
        "categorize_apps" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "use_app_codebook",
                edge: "gates",
            },
        ],
        "episode_annotations" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "long_usage_duration_thresholds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "long_data_time_gap_thresholds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "custom_app_engagement_duration",
                edge: "tunes",
            },
        ],
        "interval_cleaning" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "use_filter_file",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "interaction_types_to_remove",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "long_data_time_gap_thresholds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "filter_zero_duration_sessions",
                edge: "gates",
            },
        ],
        "effective_usage" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_screen_gated_crediting",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "credited_session_cap_minutes",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "device_liveness_gap_tolerance_minutes",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "auto_lock_bridge_seconds",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "no_witness_min_day_apps",
                edge: "tunes",
            },
        ],
        "observation_window" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_study_window_filter",
                edge: "gates",
            },
        ],
        "attribute_person" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_person_attribution",
                edge: "gates",
            },
        ],
        "day_coverage" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "add_no_activity_placeholder_days",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_day_coverage",
                edge: "gates",
            },
        ],
        "score_compliance" => &[
            ConfigDependencyDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_compliance_scoring",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "compliance_threshold_percent",
                edge: "tunes",
            },
        ],
        "outputs" => &[
            ConfigDependencyDefinition {
                option_key: "study_name",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "enable_aggregates",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "aggregate_shape",
                edge: "tunes",
            },
            ConfigDependencyDefinition {
                option_key: "include_category_column",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_parquet_export",
                edge: "gates",
            },
            ConfigDependencyDefinition {
                option_key: "enable_spss_export",
                edge: "gates",
            },
        ],
        _ => &[],
    }
}

pub fn query_group_support_roles(group_id: &str) -> &'static [&'static str] {
    match group_id {
        "app_policy" => &["filter_file"],
        "device_state_timeline" => &["apps_forcing_screen_open_file"],
        "reconstruct_episodes" => &["background_apps_file"],
        "categorize_apps" => &["app_codebook_file"],
        "observation_window" | "day_coverage" => &["study_dates_file"],
        "attribute_person" => &["device_sharing_file", "survey_attribution_file"],
        "score_compliance" => &["device_sharing_file", "enrolled_devices_file"],
        _ => &[],
    }
}

fn option_true(option_key: &'static str) -> ApplicabilityExpression {
    ApplicabilityExpression::OptionTrue { option_key }
}

fn all(terms: Vec<ApplicabilityExpression>) -> ApplicabilityExpression {
    ApplicabilityExpression::All { terms }
}

fn any(terms: Vec<ApplicabilityExpression>) -> ApplicabilityExpression {
    ApplicabilityExpression::Any { terms }
}

pub fn query_group_applicability(group_id: &str) -> ApplicabilityExpression {
    match group_id {
        "app_policy" => option_true("use_filter_file"),
        "device_state_timeline" => option_true("process_screen_usage"),
        "reconstruct_episodes" | "episode_annotations" => option_true("process_app_usage"),
        "categorize_apps" => all(vec![
            option_true("process_app_usage"),
            option_true("use_app_codebook"),
        ]),
        "interval_cleaning" => all(vec![
            option_true("process_app_usage"),
            any(vec![
                option_true("use_filter_file"),
                ApplicabilityExpression::ArrayNonempty {
                    option_key: "interaction_types_to_remove",
                },
                option_true("filter_zero_duration_sessions"),
            ]),
        ]),
        "effective_usage" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_screen_gated_crediting"),
        ]),
        "observation_window" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_study_window_filter"),
        ]),
        "attribute_person" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_person_attribution"),
        ]),
        "day_coverage" => all(vec![
            option_true("process_app_usage"),
            any(vec![
                option_true("add_no_activity_placeholder_days"),
                option_true("enable_day_coverage"),
            ]),
        ]),
        "score_compliance" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_compliance_scoring"),
        ]),
        _ => ApplicabilityExpression::Always,
    }
}

pub fn query_applicability(query_id: &str) -> ApplicabilityExpression {
    match query_id {
        "index_keyguard_events" | "infer_screen_session_skeletons" | "classify_screen_sessions" => {
            option_true("process_screen_usage")
        }
        "resolve_excluded_packages"
        | "mask_excluded_app_events"
        | "build_app_event_index"
        | "match_app_episodes"
        | "materialize_candidate_episodes"
        | "classify_episode_durations"
        | "apply_app_inclusion_policy"
        | "order_app_episodes"
        | "segment_concurrent_usage"
        | "join_app_codebook"
        | "derive_broad_category"
        | "collapse_app_genre"
        | "derive_engagement_basis"
        | "apply_episode_flags"
        | "suppress_excluded_timing"
        | "remove_selected_interaction_types"
        | "remove_zero_duration_rows"
        | "resolve_participant_windows"
        | "apply_participant_windows"
        | "resolve_sharing_status"
        | "index_survey_responses"
        | "classify_person_attribution"
        | "synthesize_placeholder_rows"
        | "index_raw_dates" => option_true("process_app_usage"),
        "identify_credit_eligible_sessions"
        | "build_activity_witness_indexes"
        | "assess_screen_evidence_capability"
        | "summarize_daily_apps"
        | "derive_credited_intervals"
        | "materialize_credited_rows"
        | "assemble_credit_outputs" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_screen_gated_crediting"),
        ]),
        "build_participant_day_coverage" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_day_coverage"),
        ]),
        "aggregate_attribution_minutes"
        | "compute_attribution_completeness"
        | "classify_compliance_days" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_compliance_scoring"),
        ]),
        _ => ApplicabilityExpression::Always,
    }
}

pub fn root_role_contract() -> Vec<WorkflowRootRoleDefinition> {
    let support_media = &[
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    vec![
        WorkflowRootRoleDefinition {
            role_id: "raw_chronicle_csv",
            minimum: 1,
            maximum: 1,
            media_types: &["text/csv"],
            required: true,
            required_when: None,
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "processing_options",
            minimum: 1,
            maximum: 1,
            media_types: &["application/json"],
            required: true,
            required_when: None,
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "filter_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_filter_file")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "apps_forcing_screen_open_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_apps_forcing_screen_open_file")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "background_apps_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_background_apps_file")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "app_codebook_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_app_codebook")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "study_dates_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("enable_study_window_filter")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "device_sharing_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("enable_person_attribution")),
            qualification: None,
        },
        WorkflowRootRoleDefinition {
            role_id: "survey_attribution_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: None,
            qualification: Some("optional-evidence"),
        },
        WorkflowRootRoleDefinition {
            role_id: "enrolled_devices_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: None,
            qualification: Some("reserved-support"),
        },
    ]
}

pub const WORKFLOW_QUERIES: &[WorkflowQueryDefinition] = &[
    WorkflowQueryDefinition {
        id: "validate_remap_rules",
        group: "parse_events",
        inputs: &[],
    },
    WorkflowQueryDefinition {
        id: "decode_source_records",
        group: "parse_events",
        inputs: &[],
    },
    WorkflowQueryDefinition {
        id: "remove_missing_timestamps",
        group: "parse_events",
        inputs: &["decode_source_records"],
    },
    WorkflowQueryDefinition {
        id: "attach_device_models",
        group: "parse_events",
        inputs: &["remove_missing_timestamps"],
    },
    WorkflowQueryDefinition {
        id: "bind_processing_timestamp",
        group: "parse_events",
        inputs: &[],
    },
    WorkflowQueryDefinition {
        id: "canonicalize_source_rows",
        group: "parse_events",
        inputs: &[
            "remove_missing_timestamps",
            "attach_device_models",
            "validate_remap_rules",
        ],
    },
    WorkflowQueryDefinition {
        id: "order_source_records",
        group: "parse_events",
        inputs: &["canonicalize_source_rows"],
    },
    WorkflowQueryDefinition {
        id: "collect_timezone_observations",
        group: "parse_events",
        inputs: &["order_source_records"],
    },
    WorkflowQueryDefinition {
        id: "estimate_dominant_timezone",
        group: "normalize_timezones",
        inputs: &["order_source_records"],
    },
    WorkflowQueryDefinition {
        id: "resolve_timezone_strategy",
        group: "normalize_timezones",
        inputs: &["order_source_records", "estimate_dominant_timezone"],
    },
    WorkflowQueryDefinition {
        id: "standardize_event_clock",
        group: "normalize_timezones",
        inputs: &["resolve_timezone_strategy"],
    },
    WorkflowQueryDefinition {
        id: "summarize_row_selection",
        group: "normalize_timezones",
        inputs: &["order_source_records", "resolve_timezone_strategy"],
    },
    WorkflowQueryDefinition {
        id: "coalesce_duplicate_event_keys",
        group: "dedup_and_order",
        inputs: &["standardize_event_clock"],
    },
    WorkflowQueryDefinition {
        id: "summarize_duplicate_groups",
        group: "dedup_and_order",
        inputs: &["coalesce_duplicate_event_keys"],
    },
    WorkflowQueryDefinition {
        id: "disambiguate_duplicate_timestamps",
        group: "dedup_and_order",
        inputs: &["coalesce_duplicate_event_keys"],
    },
    WorkflowQueryDefinition {
        id: "derive_time_gap_evidence",
        group: "dedup_and_order",
        inputs: &["disambiguate_duplicate_timestamps"],
    },
    WorkflowQueryDefinition {
        id: "mark_app_policy_matches",
        group: "app_policy",
        inputs: &["derive_time_gap_evidence"],
    },
    WorkflowQueryDefinition {
        id: "index_keyguard_events",
        group: "device_state_timeline",
        inputs: &["derive_time_gap_evidence"],
    },
    WorkflowQueryDefinition {
        id: "infer_screen_session_skeletons",
        group: "device_state_timeline",
        inputs: &["derive_time_gap_evidence"],
    },
    WorkflowQueryDefinition {
        id: "classify_screen_sessions",
        group: "device_state_timeline",
        inputs: &[
            "derive_time_gap_evidence",
            "infer_screen_session_skeletons",
            "index_keyguard_events",
        ],
    },
    WorkflowQueryDefinition {
        id: "resolve_excluded_packages",
        group: "reconstruct_episodes",
        inputs: &["mark_app_policy_matches"],
    },
    WorkflowQueryDefinition {
        id: "mask_excluded_app_events",
        group: "reconstruct_episodes",
        inputs: &["derive_time_gap_evidence"],
    },
    WorkflowQueryDefinition {
        id: "build_app_event_index",
        group: "reconstruct_episodes",
        inputs: &["mask_excluded_app_events"],
    },
    WorkflowQueryDefinition {
        id: "match_app_episodes",
        group: "reconstruct_episodes",
        inputs: &["build_app_event_index"],
    },
    WorkflowQueryDefinition {
        id: "materialize_candidate_episodes",
        group: "reconstruct_episodes",
        inputs: &[
            "mask_excluded_app_events",
            "match_app_episodes",
            "resolve_excluded_packages",
        ],
    },
    WorkflowQueryDefinition {
        id: "classify_episode_durations",
        group: "reconstruct_episodes",
        inputs: &[
            "materialize_candidate_episodes",
            "resolve_excluded_packages",
        ],
    },
    WorkflowQueryDefinition {
        id: "apply_app_inclusion_policy",
        group: "reconstruct_episodes",
        inputs: &["classify_episode_durations", "resolve_excluded_packages"],
    },
    WorkflowQueryDefinition {
        id: "order_app_episodes",
        group: "reconstruct_episodes",
        inputs: &["apply_app_inclusion_policy"],
    },
    WorkflowQueryDefinition {
        id: "segment_concurrent_usage",
        group: "reconstruct_episodes",
        inputs: &["order_app_episodes", "resolve_excluded_packages"],
    },
    WorkflowQueryDefinition {
        id: "join_app_codebook",
        group: "categorize_apps",
        inputs: &["segment_concurrent_usage"],
    },
    WorkflowQueryDefinition {
        id: "derive_broad_category",
        group: "categorize_apps",
        inputs: &["join_app_codebook"],
    },
    WorkflowQueryDefinition {
        id: "collapse_app_genre",
        group: "categorize_apps",
        inputs: &["derive_broad_category"],
    },
    WorkflowQueryDefinition {
        id: "derive_engagement_basis",
        group: "episode_annotations",
        inputs: &["collapse_app_genre"],
    },
    WorkflowQueryDefinition {
        id: "apply_episode_flags",
        group: "episode_annotations",
        inputs: &["derive_engagement_basis"],
    },
    WorkflowQueryDefinition {
        id: "suppress_excluded_timing",
        group: "interval_cleaning",
        inputs: &["apply_episode_flags", "resolve_excluded_packages"],
    },
    WorkflowQueryDefinition {
        id: "remove_selected_interaction_types",
        group: "interval_cleaning",
        inputs: &["suppress_excluded_timing"],
    },
    WorkflowQueryDefinition {
        id: "remove_zero_duration_rows",
        group: "interval_cleaning",
        inputs: &["remove_selected_interaction_types"],
    },
    WorkflowQueryDefinition {
        id: "identify_credit_eligible_sessions",
        group: "effective_usage",
        inputs: &["remove_zero_duration_rows"],
    },
    WorkflowQueryDefinition {
        id: "build_activity_witness_indexes",
        group: "effective_usage",
        inputs: &["mark_app_policy_matches"],
    },
    WorkflowQueryDefinition {
        id: "assess_screen_evidence_capability",
        group: "effective_usage",
        inputs: &[
            "identify_credit_eligible_sessions",
            "build_activity_witness_indexes",
        ],
    },
    WorkflowQueryDefinition {
        id: "summarize_daily_apps",
        group: "effective_usage",
        inputs: &["identify_credit_eligible_sessions"],
    },
    WorkflowQueryDefinition {
        id: "derive_credited_intervals",
        group: "effective_usage",
        inputs: &[
            "identify_credit_eligible_sessions",
            "build_activity_witness_indexes",
            "summarize_daily_apps",
        ],
    },
    WorkflowQueryDefinition {
        id: "materialize_credited_rows",
        group: "effective_usage",
        inputs: &[
            "identify_credit_eligible_sessions",
            "build_activity_witness_indexes",
            "derive_credited_intervals",
        ],
    },
    WorkflowQueryDefinition {
        id: "assemble_credit_outputs",
        group: "effective_usage",
        inputs: &[
            "identify_credit_eligible_sessions",
            "assess_screen_evidence_capability",
            "materialize_credited_rows",
        ],
    },
    WorkflowQueryDefinition {
        id: "resolve_participant_windows",
        group: "observation_window",
        inputs: &["remove_zero_duration_rows"],
    },
    WorkflowQueryDefinition {
        id: "apply_participant_windows",
        group: "observation_window",
        inputs: &["remove_zero_duration_rows", "resolve_participant_windows"],
    },
    WorkflowQueryDefinition {
        id: "resolve_sharing_status",
        group: "attribute_person",
        inputs: &["apply_participant_windows"],
    },
    WorkflowQueryDefinition {
        id: "index_survey_responses",
        group: "attribute_person",
        inputs: &[],
    },
    WorkflowQueryDefinition {
        id: "classify_person_attribution",
        group: "attribute_person",
        inputs: &[
            "apply_participant_windows",
            "resolve_sharing_status",
            "index_survey_responses",
        ],
    },
    WorkflowQueryDefinition {
        id: "synthesize_placeholder_rows",
        group: "day_coverage",
        inputs: &["classify_person_attribution", "mark_app_policy_matches"],
    },
    WorkflowQueryDefinition {
        id: "index_raw_dates",
        group: "day_coverage",
        inputs: &["mark_app_policy_matches"],
    },
    WorkflowQueryDefinition {
        id: "build_participant_day_coverage",
        group: "day_coverage",
        inputs: &["synthesize_placeholder_rows", "index_raw_dates"],
    },
    WorkflowQueryDefinition {
        id: "aggregate_attribution_minutes",
        group: "score_compliance",
        inputs: &["synthesize_placeholder_rows"],
    },
    WorkflowQueryDefinition {
        id: "compute_attribution_completeness",
        group: "score_compliance",
        inputs: &[
            "aggregate_attribution_minutes",
            "classify_person_attribution",
        ],
    },
    WorkflowQueryDefinition {
        id: "classify_compliance_days",
        group: "score_compliance",
        inputs: &["compute_attribution_completeness"],
    },
    WorkflowQueryDefinition {
        id: "assemble_result_manifest",
        group: "outputs",
        inputs: &[
            "validate_remap_rules",
            "decode_source_records",
            "remove_missing_timestamps",
            "attach_device_models",
            "bind_processing_timestamp",
            "canonicalize_source_rows",
            "order_source_records",
            "collect_timezone_observations",
            "estimate_dominant_timezone",
            "resolve_timezone_strategy",
            "standardize_event_clock",
            "summarize_row_selection",
            "coalesce_duplicate_event_keys",
            "summarize_duplicate_groups",
            "disambiguate_duplicate_timestamps",
            "derive_time_gap_evidence",
            "mark_app_policy_matches",
            "index_keyguard_events",
            "infer_screen_session_skeletons",
            "classify_screen_sessions",
            "resolve_excluded_packages",
            "mask_excluded_app_events",
            "build_app_event_index",
            "match_app_episodes",
            "materialize_candidate_episodes",
            "classify_episode_durations",
            "apply_app_inclusion_policy",
            "order_app_episodes",
            "segment_concurrent_usage",
            "join_app_codebook",
            "derive_broad_category",
            "collapse_app_genre",
            "derive_engagement_basis",
            "apply_episode_flags",
            "suppress_excluded_timing",
            "remove_selected_interaction_types",
            "remove_zero_duration_rows",
            "identify_credit_eligible_sessions",
            "build_activity_witness_indexes",
            "assess_screen_evidence_capability",
            "summarize_daily_apps",
            "derive_credited_intervals",
            "materialize_credited_rows",
            "assemble_credit_outputs",
            "resolve_participant_windows",
            "apply_participant_windows",
            "resolve_sharing_status",
            "index_survey_responses",
            "classify_person_attribution",
            "synthesize_placeholder_rows",
            "index_raw_dates",
            "build_participant_day_coverage",
            "aggregate_attribution_minutes",
            "compute_attribution_completeness",
            "classify_compliance_days",
        ],
    },
];

/// Exact serialized `PipelineV2OptionsJson` fields read by each Rust step.
/// These are cache/provenance bindings, not UI labels or semantic aliases.
pub fn query_request_fields(query_id: &str) -> &'static [&'static str] {
    match query_id {
        "validate_remap_rules" => &["interaction_type_remap"],
        "bind_processing_timestamp" => &["datetime_of_preprocessing"],
        "canonicalize_source_rows" => &["timezone"],
        "resolve_timezone_strategy" => &["timezone", "timezone_handling"],
        "coalesce_duplicate_event_keys" => &["deduplicate_exact_rows"],
        "disambiguate_duplicate_timestamps" => &[
            "correct_duplicate_event_timestamps",
            "same_app_stop_types",
            "other_stop_types",
        ],
        "mark_app_policy_matches" => &["use_filter_file"],
        "classify_screen_sessions" => &[
            "use_apps_forcing_screen_open",
            "screen_auto_lock_timeout_seconds",
            "screen_auto_lock_tolerance_seconds",
            "screen_manual_lock_max_tail_seconds",
            "screen_keyguard_near_stop_seconds",
        ],
        "build_app_event_index" => &[
            "same_app_stop_types",
            "other_stop_types",
            "model_concurrent_usage",
            "use_background_apps_file",
        ],
        "match_app_episodes" => &[
            "allow_stop_event_reuse",
            "use_activity_stopped_as_fallback",
            "apply_threshold_to_fallback",
            "long_duration_threshold_ns",
            "proximity_interval_ns",
        ],
        "classify_episode_durations" => &["minimum_usage_duration"],
        "apply_app_inclusion_policy" => &["use_background_apps_file"],
        "segment_concurrent_usage" => &[
            "model_concurrent_usage",
            "minimum_usage_duration",
            "apply_minimum_usage_duration_to_concurrent_subintervals",
            "use_background_apps_file",
        ],
        "join_app_codebook" | "derive_broad_category" | "collapse_app_genre" => {
            &["use_app_codebook"]
        }
        "derive_engagement_basis" => &["custom_app_engagement_duration"],
        "apply_episode_flags" => &[
            "long_data_time_gap_thresholds",
            "long_usage_duration_thresholds",
        ],
        "remove_selected_interaction_types" => &[
            "interaction_types_to_remove",
            "long_data_time_gap_thresholds",
        ],
        "remove_zero_duration_rows" => &["filter_zero_duration_sessions"],
        "derive_credited_intervals" => &[
            "credited_session_cap_minutes",
            "device_liveness_gap_tolerance_minutes",
            "auto_lock_bridge_seconds",
            "no_witness_min_day_apps",
        ],
        "apply_participant_windows" => &["enable_study_window_filter"],
        "resolve_sharing_status" | "index_survey_responses" | "classify_person_attribution" => {
            &["enable_person_attribution"]
        }
        "synthesize_placeholder_rows" => &["add_no_activity_placeholder_days"],
        "classify_compliance_days" => &["compliance_threshold_percent"],
        "assemble_result_manifest" => &[
            "study_name",
            "timezone",
            "timezone_handling",
            "usage_session_mode",
            "include_app_output",
            "include_screen_output",
            "use_background_apps_file",
            "use_app_codebook",
            "include_category_column",
            "deduplicate_exact_rows",
            "correct_duplicate_event_timestamps",
            "datetime_of_preprocessing",
            "custom_app_engagement_duration",
            "model_concurrent_usage",
            "enable_screen_gated_crediting",
            "enable_day_coverage",
            "enable_compliance_scoring",
            "enable_aggregates",
            "aggregate_shape",
            "materialize_visualization_data",
        ],
        _ => &[],
    }
}

/// Request fields consumed only while materializing derived browser/export
/// artifacts. They do not invalidate the upstream preprocessing queries.
pub const RUNTIME_ARTIFACT_REQUEST_FIELDS: &[&str] = &[
    "enable_parquet_export",
    "enable_spss_export",
    "enable_plotting",
    "enable_interactive_timeline",
    "enable_activity_heatmap",
    "export_plots_as_svg",
    "include_filtered_app_usage_in_plots",
];

const APP_USAGE_MODES: &[&str] = &["app_usage", "app_and_screen_usage"];
const USE_FILTER_FILE: &[QuerySourceRolePredicate] = &[QuerySourceRolePredicate::BooleanEquals {
    request_field: "use_filter_file",
    value: true,
}];
const USE_APPS_FORCING_SCREEN_OPEN: &[QuerySourceRolePredicate] =
    &[QuerySourceRolePredicate::BooleanEquals {
        request_field: "use_apps_forcing_screen_open",
        value: true,
    }];
const USE_BACKGROUND_APPS_FILE: &[QuerySourceRolePredicate] =
    &[QuerySourceRolePredicate::BooleanEquals {
        request_field: "use_background_apps_file",
        value: true,
    }];
const USE_APP_CODEBOOK: &[QuerySourceRolePredicate] = &[QuerySourceRolePredicate::BooleanEquals {
    request_field: "use_app_codebook",
    value: true,
}];
const ENABLE_STUDY_WINDOW_FILTER: &[QuerySourceRolePredicate] =
    &[QuerySourceRolePredicate::BooleanEquals {
        request_field: "enable_study_window_filter",
        value: true,
    }];
const ENABLE_PERSON_ATTRIBUTION: &[QuerySourceRolePredicate] =
    &[QuerySourceRolePredicate::BooleanEquals {
        request_field: "enable_person_attribution",
        value: true,
    }];
const APP_MODE_WITH_COMPLIANCE: &[QuerySourceRolePredicate] = &[
    QuerySourceRolePredicate::StringOneOf {
        request_field: "usage_session_mode",
        values: APP_USAGE_MODES,
    },
    QuerySourceRolePredicate::BooleanEquals {
        request_field: "enable_compliance_scoring",
        value: true,
    },
];

/// Exact root artifacts read directly by a step in addition to upstream step
/// outputs. A support file that has already been compiled into an upstream
/// result is not repeated here.
pub fn query_source_roles(query_id: &str) -> &'static [&'static str] {
    match query_id {
        "decode_source_records" => &["raw_chronicle_csv"],
        "mark_app_policy_matches" => &["filter_file"],
        "classify_screen_sessions" => &["apps_forcing_screen_open_file"],
        "build_app_event_index" | "apply_app_inclusion_policy" | "segment_concurrent_usage" => {
            &["background_apps_file"]
        }
        "join_app_codebook" => &["app_codebook_file"],
        "resolve_participant_windows"
        | "apply_participant_windows"
        | "build_participant_day_coverage" => &["study_dates_file"],
        "resolve_sharing_status" => &["device_sharing_file"],
        "index_survey_responses" => &["survey_attribution_file"],
        "assemble_result_manifest" => &["enrolled_devices_file"],
        _ => &[],
    }
}

/// Exact direct support-file reads for a query, including configuration gates.
/// Upstream query outputs remain represented by `WorkflowQueryDefinition::inputs`.
pub fn query_source_role_bindings(query_id: &str) -> Vec<QuerySourceRoleBinding> {
    let binding = |role, when_all| QuerySourceRoleBinding { role, when_all };
    match query_id {
        "decode_source_records" => vec![binding("raw_chronicle_csv", &[])],
        "mark_app_policy_matches" => vec![binding("filter_file", USE_FILTER_FILE)],
        "classify_screen_sessions" => vec![binding(
            "apps_forcing_screen_open_file",
            USE_APPS_FORCING_SCREEN_OPEN,
        )],
        "build_app_event_index" | "apply_app_inclusion_policy" | "segment_concurrent_usage" => {
            vec![binding("background_apps_file", USE_BACKGROUND_APPS_FILE)]
        }
        "join_app_codebook" => vec![binding("app_codebook_file", USE_APP_CODEBOOK)],
        "resolve_participant_windows" | "build_participant_day_coverage" => {
            vec![binding("study_dates_file", &[])]
        }
        "apply_participant_windows" => {
            vec![binding("study_dates_file", ENABLE_STUDY_WINDOW_FILTER)]
        }
        "resolve_sharing_status" => vec![binding("device_sharing_file", ENABLE_PERSON_ATTRIBUTION)],
        "index_survey_responses" => vec![binding(
            "survey_attribution_file",
            ENABLE_PERSON_ATTRIBUTION,
        )],
        "assemble_result_manifest" => {
            vec![binding("enrolled_devices_file", APP_MODE_WITH_COMPLIANCE)]
        }
        _ => Vec::new(),
    }
}

// ---- field-level read/write declarations --------------------------------
//
// `query_request_fields` and `query_source_roles` bind each step to whole
// configuration leaves and whole source artifacts. The declarations below go
// one level finer and name the exact *data fields* each step consumes and
// produces, so a supplied raw/support column can be traced to the canonical
// output cells it can reach.
//
// Identifier namespaces:
//   `<role>.<column>`  a column of a supplied source artifact
//                      (`raw_chronicle_csv.event_timestamp`, `filter_file.…`)
//   `<bare_name>`      a data field of the canonical row carrier `RowData`
//                      or of the parsed `RawRow`; the two share names where
//                      the same datum flows through
//   `row.membership`   which rows exist, and
//   `row.order`        their sequence — a canonical cell is addressed by
//                      (row index, column), so both determine every
//                      row-addressed output cell
//   `source.…`         a structural property of a supplied artifact that is
//                      not one of its columns (raw row set and row order)
//   `derived.…`        a product value a step computes and hands to later
//                      steps without storing it on a row
//
// `declared_field_edges_equal_scanned_field_use` proves the non-pseudo part of
// these lists equals what the tracked queries and their reachable Rust
// implementations actually touch, exactly as
// `declared_query_edges_equal_direct_salsa_query_calls` does for option leaves
// and source roles.

/// One declared field-level dependency: the exact inputs that determine one
/// produced field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFieldEdge {
    pub to: &'static str,
    pub from: &'static [&'static str],
}

/// Row-set pseudo-fields. Every row-addressed output cell depends on both.
pub const ROW_SET_FIELDS: &[&str] = &["row.membership", "row.order"];

/// Whether an identifier names a modelled pseudo-field rather than a supplied
/// source column or a carrier data field.
pub fn is_pseudo_field(field: &str) -> bool {
    matches!(
        field.split_once('.'),
        Some(("row" | "derived" | "source", _))
    )
}

/// Exact data fields and supplied source columns each step consumes.
pub fn query_field_reads(query_id: &str) -> &'static [&'static str] {
    match query_id {
        "decode_source_records" => &[
            "source.raw_row_set",
            "source.raw_row_order",
            "raw_chronicle_csv.study_id",
            "raw_chronicle_csv.participant_id",
            "raw_chronicle_csv.username",
            "raw_chronicle_csv.application_label",
            "raw_chronicle_csv.interaction_type",
            "raw_chronicle_csv.app_package_name",
            "raw_chronicle_csv.event_timestamp",
            "raw_chronicle_csv.timezone",
        ],
        "remove_missing_timestamps" => &["event_timestamp"],
        "attach_device_models" => &["app_package_name"],
        "canonicalize_source_rows" => &[
            "study_id",
            "participant_id",
            "username",
            "application_label",
            "interaction_type",
            "app_package_name",
            "event_timestamp",
            "event_timestamp_ns",
            "timezone",
            "date",
            "derived.possible_device_model",
        ],
        "order_source_records" => &["event_timestamp_ns"],
        "collect_timezone_observations" => &["timezone"],
        "estimate_dominant_timezone" => &["timezone"],
        "resolve_timezone_strategy" => &["timezone", "derived.dominant_timezone"],
        "standardize_event_clock" => &[
            "event_timestamp_ns",
            "timezone",
            "date",
            "derived.selected_timezone",
        ],
        "coalesce_duplicate_event_keys" => &[
            "participant_id",
            "event_timestamp_ns",
            "interaction_type",
            "app_package_name",
        ],
        "summarize_duplicate_groups" => &["event_timestamp_ns"],
        "disambiguate_duplicate_timestamps" => &["event_timestamp_ns", "interaction_type"],
        "derive_time_gap_evidence" => &["event_timestamp_ns", "data_time_gap_hours"],
        "mark_app_policy_matches" => &[
            "app_package_name",
            "application_label",
            "interaction_type",
            "filter_file.app_package_name",
            "filter_file.package_name",
            "filter_file.application_label",
            "filter_file.known_application_labels",
            "filter_file.label_or_note",
        ],
        "index_keyguard_events" => &["event_timestamp_ns", "interaction_type"],
        "infer_screen_session_skeletons" => &[
            "event_timestamp_ns",
            "interaction_type",
            "app_package_name",
            "timezone",
        ],
        "classify_screen_sessions" => &[
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "timezone",
            "apps_forcing_screen_open_file.package_name",
            "apps_forcing_screen_open_file.app_package_name",
            "apps_forcing_screen_open_file.label_or_note",
            "apps_forcing_screen_open_file.application_label",
            "derived.screen_state_timeline",
            "derived.keyguard_timestamps",
        ],
        "resolve_excluded_packages" => &["app_package_name"],
        "mask_excluded_app_events" => &["interaction_type"],
        "build_app_event_index" => &[
            "app_package_name",
            "interaction_type",
            "event_timestamp_ns",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "match_app_episodes" => &["derived.matcher_input"],
        "materialize_candidate_episodes" => &[
            "app_package_name",
            "participant_id",
            "interaction_type",
            "event_timestamp_ns",
            "derived.matcher_output",
            "derived.filtered_packages",
        ],
        "classify_episode_durations" => &[
            "app_package_name",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.junk_packages",
        ],
        "apply_app_inclusion_policy" => &[
            "app_package_name",
            "interaction_type",
            "derived.junk_packages",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "order_app_episodes" => &["event_timestamp_ns"],
        "segment_concurrent_usage" => &[
            "app_package_name",
            "interaction_type",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.junk_packages",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "join_app_codebook" => CODEBOOK_JOIN_FIELD_READS,
        "derive_broad_category" => &["codebook_fields", "broad_app_category"],
        "collapse_app_genre" => &[
            "codebook_fields",
            "codebook_genre_fields_cleared",
            "genre_id_scraped",
        ],
        "derive_engagement_basis" => &[
            "app_package_name",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "valid_app_new_engage_30s",
            "valid_app_new_engage_custom",
            "valid_app_switched_app",
            "valid_app_usage_time_gap_hours",
            "any_app_new_engage_30s",
            "any_app_new_engage_custom",
            "any_app_switched_app",
            "any_app_usage_time_gap_hours",
        ],
        "apply_episode_flags" => &[
            "any_app_usage_flags",
            "data_time_gap_hours",
            "duration_minutes",
        ],
        "suppress_excluded_timing" => &[
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "derived.junk_packages",
        ],
        "remove_selected_interaction_types" => &["interaction_type", "data_time_gap_hours"],
        "remove_zero_duration_rows" => &["interaction_type", "duration_seconds"],
        "identify_credit_eligible_sessions" => &["interaction_type", "duration_minutes"],
        "build_activity_witness_indexes" => {
            &["participant_id", "interaction_type", "event_timestamp_ns"]
        }
        "assess_screen_evidence_capability" => &[
            "participant_id",
            "derived.credit_partition",
            "derived.liveness_substrate",
        ],
        "summarize_daily_apps" => &[
            "participant_id",
            "date",
            "app_package_name",
            "derived.credit_partition",
        ],
        "derive_credited_intervals" => &[
            "participant_id",
            "date",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.credit_partition",
            "derived.liveness_substrate",
            "derived.day_app_counts",
        ],
        "materialize_credited_rows" => &[
            "participant_id",
            "event_timestamp_ns",
            "timezone",
            "derived.credit_partition",
            "derived.liveness_substrate",
            "derived.credit_decisions",
        ],
        "assemble_credit_outputs" => &[
            "duration_minutes",
            "derived.credit_partition",
            "derived.screen_incapable_participants",
        ],
        "resolve_participant_windows" => &[
            "participant_id",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "apply_participant_windows" => &[
            "participant_id",
            "date",
            "derived.participant_windows",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "resolve_sharing_status" => &[
            "participant_id",
            "device_sharing_file.participant_id",
            "device_sharing_file.sharing_status",
        ],
        "index_survey_responses" => &[
            "survey_attribution_file.participant_id",
            "survey_attribution_file.event_timestamp",
            "survey_attribution_file.users",
        ],
        "classify_person_attribution" => &[
            "participant_id",
            "username",
            "interaction_type",
            "app_package_name",
            "event_timestamp_ns",
            "derived.sharing_status",
            "derived.survey_lookup",
        ],
        "synthesize_placeholder_rows" => &[
            "participant_id",
            "date",
            "interaction_type",
            "event_timestamp_ns",
            "timezone",
        ],
        "index_raw_dates" => &["participant_id", "date"],
        "build_participant_day_coverage" => &[
            "participant_id",
            "date",
            "interaction_type",
            "duration_minutes",
            "derived.raw_date_index",
            "derived.participant_windows",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "aggregate_attribution_minutes" => &[
            "participant_id",
            "username",
            "date",
            "interaction_type",
            "duration_minutes",
        ],
        "compute_attribution_completeness" => {
            &["derived.attribution_minutes", "derived.sharing_status"]
        }
        "classify_compliance_days" => {
            &["participant_id", "date", "derived.attribution_completeness"]
        }
        "assemble_result_manifest" => ASSEMBLE_RESULT_FIELD_READS,
        // `validate_remap_rules`, `bind_processing_timestamp` and
        // `summarize_row_selection` consume configuration leaves or row counts only;
        // their option bindings already carry their whole dependency.
        _ => &[],
    }
}

/// Exact data fields, row-set properties, and derived product values each step
/// produces.
pub fn query_field_writes(query_id: &str) -> &'static [&'static str] {
    match query_id {
        "decode_source_records" => &[
            "row.membership",
            "row.order",
            "study_id",
            "participant_id",
            "username",
            "application_label",
            "interaction_type",
            "app_package_name",
            "event_timestamp",
            "timezone",
        ],
        "remove_missing_timestamps" => &["row.membership"],
        "attach_device_models" => &["derived.possible_device_model"],
        "canonicalize_source_rows" => CANONICAL_ROW_FIELDS,
        "order_source_records" => &["row.order"],
        "collect_timezone_observations" => &["derived.timezone_set"],
        "estimate_dominant_timezone" => &["derived.dominant_timezone"],
        "resolve_timezone_strategy" => &["derived.selected_timezone"],
        "standardize_event_clock" => &[
            "row.membership",
            "timezone",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "summarize_row_selection" => &["derived.summarize_row_selection"],
        "coalesce_duplicate_event_keys" => &["row.membership"],
        "summarize_duplicate_groups" => &["derived.duplicate_group_count"],
        "disambiguate_duplicate_timestamps" => &["row.order", "event_timestamp_ns"],
        "derive_time_gap_evidence" => &["data_time_gap_hours"],
        "mark_app_policy_matches" => &["interaction_type", "derived.filtered_packages"],
        "index_keyguard_events" => &["derived.keyguard_timestamps"],
        "infer_screen_session_skeletons" => &["derived.screen_state_timeline"],
        "classify_screen_sessions" => &[
            "row.membership",
            "row.order",
            "app_package_name",
            "application_label",
            "interaction_type",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "data_time_gap_hours",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
            "screen_usage_end_reason",
            "screen_usage_end_reason_confidence",
            "screen_usage_stop_event_type",
            "screen_usage_last_activity_timestamp_ns",
            "screen_usage_tail_gap_seconds",
            "screen_usage_foreground_app_package",
            "screen_usage_apps_forcing_screen_open_label",
            "screen_usage_lock_screen_only",
        ],
        "resolve_excluded_packages" => &["derived.junk_packages"],
        "mask_excluded_app_events" => &["interaction_type"],
        "build_app_event_index" => &["derived.matcher_input"],
        "match_app_episodes" => &["derived.matcher_output"],
        "materialize_candidate_episodes"
        | "classify_episode_durations"
        | "apply_app_inclusion_policy" => &[
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
        ],
        "order_app_episodes" => &["row.order"],
        "segment_concurrent_usage" => &[
            "row.membership",
            "row.order",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "usage_layer",
        ],
        "join_app_codebook" => &["codebook_fields"],
        "derive_broad_category" => &["broad_app_category"],
        "collapse_app_genre" => &["genre_id_scraped", "codebook_genre_fields_cleared"],
        "derive_engagement_basis" => &[
            "valid_app_new_engage_30s",
            "valid_app_new_engage_custom",
            "valid_app_switched_app",
            "valid_app_usage_time_gap_hours",
            "any_app_new_engage_30s",
            "any_app_new_engage_custom",
            "any_app_switched_app",
            "any_app_usage_time_gap_hours",
        ],
        "apply_episode_flags" => &["any_app_usage_flags"],
        "suppress_excluded_timing" => &[
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
        ],
        "remove_selected_interaction_types"
        | "remove_zero_duration_rows"
        | "apply_participant_windows" => &["row.membership"],
        "identify_credit_eligible_sessions" => &["derived.credit_partition"],
        "build_activity_witness_indexes" => &["derived.liveness_substrate"],
        "assess_screen_evidence_capability" => &["derived.screen_incapable_participants"],
        "summarize_daily_apps" => &["derived.day_app_counts"],
        "derive_credited_intervals" => &["derived.credit_decisions"],
        "materialize_credited_rows" => &[
            "row.membership",
            "row.order",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "assemble_credit_outputs" => &["derived.credit_result"],
        "resolve_participant_windows" => &["derived.participant_windows"],
        "resolve_sharing_status" => &["derived.sharing_status"],
        "index_survey_responses" => &["derived.survey_lookup"],
        "classify_person_attribution" => &["username", "interaction_type"],
        "synthesize_placeholder_rows" => &[
            "row.membership",
            "row.order",
            "app_package_name",
            "application_label",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "data_time_gap_hours",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "index_raw_dates" => &["derived.raw_date_index"],
        "build_participant_day_coverage" => &["derived.coverage_table"],
        "aggregate_attribution_minutes" => &["derived.attribution_minutes"],
        "compute_attribution_completeness" => &["derived.attribution_completeness"],
        "classify_compliance_days" => &["derived.compliance_scores"],
        // `assemble_result_manifest` renders rather than transforms: what it produces is
        // declared cell by cell in `PIPELINE_OUTPUT_CELL_BINDINGS`.
        _ => &[],
    }
}

/// Every data field of the canonical row carrier, in `RowData` order.
const CANONICAL_ROW_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp_ns",
    "timezone",
    "data_time_gap_hours",
    "date",
    "day",
    "weekday_mf",
    "weekday_mth",
    "weekday_su_th",
    "hour",
    "quarter",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason",
    "screen_usage_end_reason_confidence",
    "screen_usage_stop_event_type",
    "screen_usage_last_activity_timestamp_ns",
    "screen_usage_tail_gap_seconds",
    "screen_usage_foreground_app_package",
    "screen_usage_apps_forcing_screen_open_label",
    "screen_usage_lock_screen_only",
    "any_app_usage_flags",
    "valid_app_new_engage_30s",
    "valid_app_new_engage_custom",
    "valid_app_switched_app",
    "valid_app_usage_time_gap_hours",
    "any_app_new_engage_30s",
    "any_app_new_engage_custom",
    "any_app_switched_app",
    "any_app_usage_time_gap_hours",
    "genre_id_scraped",
    "broad_app_category",
    "codebook_fields",
    "codebook_genre_fields_cleared",
    "usage_layer",
];

const CODEBOOK_JOIN_FIELD_READS: &[&str] = &[
    "app_package_name",
    "codebook_fields",
    "app_codebook_file.app_package_name",
    "app_codebook_file.application_label",
    "app_codebook_file.bcm_play_store_genreId",
    "app_codebook_file.bcm_play_store_genre",
    "app_codebook_file.bcm_play_store_broad_app_category",
    "app_codebook_file.bcm_play_store_developer",
    "app_codebook_file.bcm_play_store_free",
    "app_codebook_file.bcm_play_store_rating",
    "app_codebook_file.bcm_play_store_downloads",
    "app_codebook_file.usc_broad_app_category",
    "app_codebook_file.usc_genreId",
    "app_codebook_file.umich_child_app_category_code",
    "app_codebook_file.umich_child_app_category",
    "app_codebook_file.umich_adult_app_category_code",
    "app_codebook_file.umich_adult_app_category",
    "app_codebook_file.umich_free",
    "app_codebook_file.umich_gambling_app",
    "app_codebook_file.umich_inappropriate_app",
    "app_codebook_file.babyemu_genreId_scraped",
    "app_codebook_file.babyemu_genreId_manual",
    "app_codebook_file.babyemu_broad_app_category",
    "app_codebook_file.babyemu_medium_app_category",
    "app_codebook_file.babyemu_fine_app_category",
    "app_codebook_file.babyemu_alternate_fine_app_category",
    "app_codebook_file.babyemu_kids",
    "app_codebook_file.bcm_cnrc_heuristic_category",
    "app_codebook_file.bcm_cnrc_categorization_source",
    "app_codebook_file.dataset",
];

/// `assemble_result_manifest` reads every rendered row field plus the enrolled-device
/// counts that scale the compliance denominators.
const ASSEMBLE_RESULT_FIELD_READS: &[&str] = &[
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp_ns",
    "timezone",
    "data_time_gap_hours",
    "date",
    "day",
    "weekday_mf",
    "weekday_mth",
    "weekday_su_th",
    "hour",
    "quarter",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason",
    "screen_usage_end_reason_confidence",
    "screen_usage_stop_event_type",
    "screen_usage_last_activity_timestamp_ns",
    "screen_usage_tail_gap_seconds",
    "screen_usage_foreground_app_package",
    "screen_usage_apps_forcing_screen_open_label",
    "screen_usage_lock_screen_only",
    "any_app_usage_flags",
    "valid_app_new_engage_30s",
    "valid_app_new_engage_custom",
    "valid_app_switched_app",
    "valid_app_usage_time_gap_hours",
    "any_app_new_engage_30s",
    "any_app_new_engage_custom",
    "any_app_switched_app",
    "any_app_usage_time_gap_hours",
    "genre_id_scraped",
    "broad_app_category",
    "codebook_fields",
    "codebook_genre_fields_cleared",
    "usage_layer",
    "derived.summarize_row_selection",
    "derived.duplicate_group_count",
    "derived.timezone_set",
    "derived.selected_timezone",
    "derived.coverage_table",
    "derived.compliance_scores",
    "derived.credit_result",
    "derived.sharing_status",
    "enrolled_devices_file.participant_id",
    "enrolled_devices_file.device_count",
];

/// Steps whose produced fields are *not* each determined by every declared
/// read. A constructor-like step initializes most fields from constants, so a
/// full cross product there would make the field graph vacuous.
fn query_field_edge_overrides(
    query_id: &str,
) -> &'static [(&'static str, &'static [&'static str])] {
    match query_id {
        "decode_source_records" => &[
            ("row.membership", &["source.raw_row_set"]),
            ("row.order", &["source.raw_row_order"]),
            ("study_id", &["raw_chronicle_csv.study_id"]),
            ("participant_id", &["raw_chronicle_csv.participant_id"]),
            ("username", &["raw_chronicle_csv.username"]),
            (
                "application_label",
                &["raw_chronicle_csv.application_label"],
            ),
            ("interaction_type", &["raw_chronicle_csv.interaction_type"]),
            ("app_package_name", &["raw_chronicle_csv.app_package_name"]),
            ("event_timestamp", &["raw_chronicle_csv.event_timestamp"]),
            ("timezone", &["raw_chronicle_csv.timezone"]),
        ],
        // `canonicalize_source_rows` constructs the carrier: most fields are
        // initialized from constants and gain content only downstream. The
        // `&[]` entries are those constants — `RowData { .., duration_seconds:
        // None, .. }` in `pipeline_v2_incremental::canonicalize_source_rows`. They
        // must be listed: a produced field missing from this table would
        // silently fall back to "every read determines it", which makes every
        // raw column reach every downstream field.
        "canonicalize_source_rows" => &[
            ("study_id", &["study_id"]),
            ("participant_id", &["participant_id"]),
            ("possible_device_model", &["derived.possible_device_model"]),
            ("username", &["username"]),
            ("application_label", &["application_label"]),
            ("interaction_type", &["interaction_type"]),
            ("app_package_name", &["app_package_name"]),
            ("event_timestamp_ns", &["event_timestamp"]),
            ("timezone", &["timezone"]),
            ("date", &["event_timestamp_ns", "timezone", "date"]),
            ("day", &["event_timestamp_ns", "timezone"]),
            ("weekday_mf", &["event_timestamp_ns", "timezone"]),
            ("weekday_mth", &["event_timestamp_ns", "timezone"]),
            ("weekday_su_th", &["event_timestamp_ns", "timezone"]),
            ("hour", &["event_timestamp_ns", "timezone"]),
            ("quarter", &["event_timestamp_ns", "timezone"]),
            ("data_time_gap_hours", &[]),
            ("start_timestamp_ns", &[]),
            ("stop_timestamp_ns", &[]),
            ("duration_seconds", &[]),
            ("duration_minutes", &[]),
            ("screen_usage_end_reason", &[]),
            ("screen_usage_end_reason_confidence", &[]),
            ("screen_usage_stop_event_type", &[]),
            ("screen_usage_last_activity_timestamp_ns", &[]),
            ("screen_usage_tail_gap_seconds", &[]),
            ("screen_usage_foreground_app_package", &[]),
            ("screen_usage_apps_forcing_screen_open_label", &[]),
            ("screen_usage_lock_screen_only", &[]),
            ("any_app_usage_flags", &[]),
            ("valid_app_new_engage_30s", &[]),
            ("valid_app_new_engage_custom", &[]),
            ("valid_app_switched_app", &[]),
            ("valid_app_usage_time_gap_hours", &[]),
            ("any_app_new_engage_30s", &[]),
            ("any_app_new_engage_custom", &[]),
            ("any_app_switched_app", &[]),
            ("any_app_usage_time_gap_hours", &[]),
            ("genre_id_scraped", &[]),
            ("broad_app_category", &[]),
            ("codebook_fields", &[]),
            ("codebook_genre_fields_cleared", &[]),
            ("usage_layer", &[]),
        ],
        // The engagement walk keeps the `valid_*` and `any_*` families apart:
        // each family is carried forward from its own previous value.
        "derive_engagement_basis" => &[
            (
                "valid_app_new_engage_30s",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_new_engage_30s",
                ],
            ),
            (
                "valid_app_new_engage_custom",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_new_engage_custom",
                ],
            ),
            (
                "valid_app_switched_app",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_switched_app",
                ],
            ),
            (
                "valid_app_usage_time_gap_hours",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_usage_time_gap_hours",
                ],
            ),
            (
                "any_app_new_engage_30s",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_new_engage_30s",
                ],
            ),
            (
                "any_app_new_engage_custom",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_new_engage_custom",
                ],
            ),
            (
                "any_app_switched_app",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_switched_app",
                ],
            ),
            (
                "any_app_usage_time_gap_hours",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_usage_time_gap_hours",
                ],
            ),
        ],
        _ => &[],
    }
}

/// The declared field-level dependency edges of one product step. A step
/// absent from `query_field_edge_overrides` is an atomic transformation: every
/// field it produces is determined by every field it reads. A step present
/// there must name every field it produces — `override_tables_cover_every_
/// produced_field` fails otherwise, because a missing entry would silently
/// restore the atomic cross for that one field.
pub fn query_field_edges(query_id: &str) -> Vec<WorkflowFieldEdge> {
    let overrides = query_field_edge_overrides(query_id);
    let reads = query_field_reads(query_id);
    query_field_writes(query_id)
        .iter()
        .map(|to| WorkflowFieldEdge {
            to,
            from: overrides
                .iter()
                .find(|(field, _)| field == to)
                .map(|(_, from)| *from)
                .unwrap_or(reads),
        })
        .collect()
}

// ---- output cell bindings ------------------------------------------------

/// One canonical output cell family and the data fields that render it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOutputCellBinding {
    /// Canonical output artifact, as addressed by the changed-cell evidence.
    pub output_kind: &'static str,
    /// CSV column name, or a JSON pointer whose `*` segments match any index
    /// or key.
    pub column: &'static str,
    /// The step that renders it.
    pub emitting_query: &'static str,
    /// Data fields that determine the cell value. Row-addressed cells
    /// additionally depend on `ROW_SET_FIELDS`; see `output_cell_dependencies`.
    pub from: &'static [&'static str],
}

const APP_ROW_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", &["study_id"]),
    ("study_name", &[]),
    ("participant_id", &["participant_id"]),
    ("possible_device_model", &["possible_device_model"]),
    ("username", &["username"]),
    ("event_timestamp", &["event_timestamp_ns", "timezone"]),
    ("date", &["date"]),
    ("timezone", &["timezone"]),
    ("app_package_name", &["app_package_name"]),
    ("application_label", &["application_label"]),
    ("genreId_scraped", &["genre_id_scraped"]),
    ("broad_app_category", &["broad_app_category"]),
    ("interaction_type", &["interaction_type"]),
    ("start_timestamp", &["start_timestamp_ns", "timezone"]),
    ("stop_timestamp", &["stop_timestamp_ns", "timezone"]),
    ("duration_seconds", &["duration_seconds"]),
    ("duration_minutes", &["duration_minutes"]),
    ("any_app_usage_flags", &["any_app_usage_flags"]),
    ("data_time_gap_hours", &["data_time_gap_hours"]),
    ("day", &["day"]),
    ("weekdayMF", &["weekday_mf"]),
    ("weekdayMTh", &["weekday_mth"]),
    ("weekdaySuTh", &["weekday_su_th"]),
    ("hour", &["hour"]),
    ("quarter", &["quarter"]),
    ("valid_app_new_engage_30s", &["valid_app_new_engage_30s"]),
    (
        "valid_app_new_engage_custom_*s",
        &["valid_app_new_engage_custom"],
    ),
    ("valid_app_switched_app", &["valid_app_switched_app"]),
    (
        "valid_app_usage_time_gap_hours",
        &["valid_app_usage_time_gap_hours"],
    ),
    ("any_app_new_engage_30s", &["any_app_new_engage_30s"]),
    (
        "any_app_new_engage_custom_*s",
        &["any_app_new_engage_custom"],
    ),
    ("any_app_switched_app", &["any_app_switched_app"]),
    (
        "any_app_usage_time_gap_hours",
        &["any_app_usage_time_gap_hours"],
    ),
    ("preprocessor_version", &[]),
    ("datetime_of_preprocessing", &[]),
    ("usage_layer", &["usage_layer"]),
    ("shape/rows", &[]),
];

const SCREEN_ROW_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", &["study_id"]),
    ("study_name", &[]),
    ("participant_id", &["participant_id"]),
    ("possible_device_model", &["possible_device_model"]),
    ("username", &["username"]),
    ("event_timestamp", &["event_timestamp_ns", "timezone"]),
    ("date", &["date"]),
    ("timezone", &["timezone"]),
    ("app_package_name", &["app_package_name"]),
    ("application_label", &["application_label"]),
    ("interaction_type", &["interaction_type"]),
    ("start_timestamp", &["start_timestamp_ns", "timezone"]),
    ("stop_timestamp", &["stop_timestamp_ns", "timezone"]),
    ("duration_seconds", &["duration_seconds"]),
    ("duration_minutes", &["duration_minutes"]),
    ("screen_usage_end_reason", &["screen_usage_end_reason"]),
    (
        "screen_usage_end_reason_confidence",
        &["screen_usage_end_reason_confidence"],
    ),
    (
        "screen_usage_stop_event_type",
        &["screen_usage_stop_event_type"],
    ),
    (
        "screen_usage_last_activity_timestamp",
        &["screen_usage_last_activity_timestamp_ns", "timezone"],
    ),
    (
        "screen_usage_tail_gap_seconds",
        &["screen_usage_tail_gap_seconds"],
    ),
    (
        "screen_usage_foreground_app_package",
        &["screen_usage_foreground_app_package"],
    ),
    (
        "screen_usage_apps_forcing_screen_open_label",
        &["screen_usage_apps_forcing_screen_open_label"],
    ),
    (
        "screen_usage_lock_screen_only",
        &["screen_usage_lock_screen_only"],
    ),
    ("data_time_gap_hours", &["data_time_gap_hours"]),
    ("day", &["day"]),
    ("weekdayMF", &["weekday_mf"]),
    ("weekdayMTh", &["weekday_mth"]),
    ("weekdaySuTh", &["weekday_su_th"]),
    ("hour", &["hour"]),
    ("quarter", &["quarter"]),
    ("preprocessor_version", &[]),
    ("datetime_of_preprocessing", &[]),
    ("shape/rows", &[]),
];

/// Every day a review-summary metric is accumulated from a complete session.
/// The review summary keys its `participants` array by study and participant,
/// so every `/participants/*/…` address depends on both, even where the value
/// it carries is a copy of only one of them.
const REVIEW_PARTICIPANT_KEY_FIELDS: &[&str] = &["study_id", "participant_id"];

const REVIEW_SESSION_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_minutes",
    "usage_layer",
];

const NON_ROW_CELL_BINDINGS: &[PipelineOutputCellBinding] = &[
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "participant_id",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "date",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "known_minutes",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "unknown_minutes",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "compliance_percent",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "zero_real_usage",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "sharing_status",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores", "derived.sharing_status"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "expected_device_count",
        emitting_query: "assemble_result_manifest",
        from: &[
            "derived.compliance_scores",
            "enrolled_devices_file.participant_id",
            "enrolled_devices_file.device_count",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "is_valid",
        emitting_query: "assemble_result_manifest",
        from: &[
            "derived.compliance_scores",
            "derived.sharing_status",
            "enrolled_devices_file.participant_id",
            "enrolled_devices_file.device_count",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "shape/rows",
        emitting_query: "assemble_result_manifest",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "participant_id",
        emitting_query: "build_participant_day_coverage",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "date",
        emitting_query: "build_participant_day_coverage",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "status",
        emitting_query: "build_participant_day_coverage",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "shape/rows",
        emitting_query: "build_participant_day_coverage",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/studyId",
        emitting_query: "assemble_result_manifest",
        from: REVIEW_PARTICIPANT_KEY_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/participantId",
        emitting_query: "assemble_result_manifest",
        from: REVIEW_PARTICIPANT_KEY_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/perDay/*/*",
        emitting_query: "assemble_result_manifest",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/perDay/*/flags/*",
        emitting_query: "assemble_result_manifest",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/totals/*",
        emitting_query: "assemble_result_manifest",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate",
        emitting_query: "assemble_result_manifest",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/appPackageName",
        emitting_query: "assemble_result_manifest",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/applicationLabel",
        emitting_query: "assemble_result_manifest",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
            "application_label",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/category",
        emitting_query: "assemble_result_manifest",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
            "broad_app_category",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/minutes",
        emitting_query: "assemble_result_manifest",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/appRows/*/*",
        emitting_query: "assemble_result_manifest",
        from: VISUALIZATION_ROW_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/screenRows/*/*",
        emitting_query: "assemble_result_manifest",
        from: VISUALIZATION_ROW_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/eventTimestampsByParticipant/*/*",
        emitting_query: "assemble_result_manifest",
        from: &["participant_id", "event_timestamp_ns"],
    },
];

/// A row reaches a period/day/participant aggregate group through exactly this
/// grouping key and `pipeline_v2_aggregates::complete`, which requires the
/// kind's interaction type and both session bounds. `usage_layer` splits the
/// foreground group from the background group.
const AGGREGATE_GROUPING_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
];

/// Every accumulated aggregate metric additionally reads the session length and
/// the package identity that `summarize` counts switches on.
const AGGREGATE_METRIC_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
    "duration_minutes",
    "app_package_name",
];

/// `summary_csv` wide/long period columns shared by the daily and weekly
/// aggregates. The period column itself differs and is bound per kind.
const AGGREGATE_SUMMARY_SHARED_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_GROUPING_FIELDS),
    // The value is the `study_name` option, but an aggregate row exists only
    // for a group, so which addresses carry it depends on the grouping fields.
    // `ROW_SET_FIELDS` alone does not cover this: adding a distinct `study_id`
    // to one existing raw row creates a whole aggregate row without changing
    // the raw row set.
    ("study_name", AGGREGATE_GROUPING_FIELDS),
    ("participant_id", AGGREGATE_GROUPING_FIELDS),
    (
        "timezone",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "timezone",
        ],
    ),
    ("total_app_usage_minutes", AGGREGATE_METRIC_FIELDS),
    (
        "total_background_app_usage_minutes",
        AGGREGATE_METRIC_FIELDS,
    ),
    ("total_screen_usage_minutes", AGGREGATE_METRIC_FIELDS),
    ("app_session_count", AGGREGATE_METRIC_FIELDS),
    ("screen_session_count", AGGREGATE_METRIC_FIELDS),
    ("app_switches", AGGREGATE_METRIC_FIELDS),
    ("pickups", AGGREGATE_METRIC_FIELDS),
    ("mean_app_session_minutes", AGGREGATE_METRIC_FIELDS),
    ("longest_app_session_minutes", AGGREGATE_METRIC_FIELDS),
    ("active_window_minutes", AGGREGATE_METRIC_FIELDS),
    (
        "first_use",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "timezone",
        ],
    ),
    (
        "last_use",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "timezone",
        ],
    ),
    // `aggregate_shape = "long"` replaces the metric columns with a
    // metric-name/value pair over the same accumulated fields.
    ("metric", AGGREGATE_GROUPING_FIELDS),
    ("value", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_GROUPING_FIELDS),
];

/// Columns only the daily summary carries: the calendar date it is keyed by and
/// the weekday projections `summarize` samples from the group's first row.
const AGGREGATE_DAILY_ONLY_COLUMNS: &[(&str, &[&str])] = &[
    ("date", AGGREGATE_GROUPING_FIELDS),
    (
        "day",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "day",
        ],
    ),
    (
        "weekdayMF",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "weekday_mf",
        ],
    ),
    (
        "weekdayMTh",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "weekday_mth",
        ],
    ),
    (
        "weekdaySuTh",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "weekday_su_th",
        ],
    ),
];

/// Columns only the weekly summary carries. `iso_period` folds the row date
/// into an ISO year-week, and `week_start_date` is derived back from it.
const AGGREGATE_WEEKLY_ONLY_COLUMNS: &[(&str, &[&str])] = &[
    ("iso_year_week", AGGREGATE_GROUPING_FIELDS),
    ("week_start_date", AGGREGATE_GROUPING_FIELDS),
];

const AGGREGATE_TOP_APPS_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_METRIC_FIELDS),
    ("study_name", AGGREGATE_METRIC_FIELDS),
    ("participant_id", AGGREGATE_METRIC_FIELDS),
    ("date", AGGREGATE_METRIC_FIELDS),
    ("rank", AGGREGATE_METRIC_FIELDS),
    ("app_package_name", AGGREGATE_METRIC_FIELDS),
    (
        "application_label",
        &[
            "study_id",
            "participant_id",
            "date",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "duration_minutes",
            "app_package_name",
            "application_label",
        ],
    ),
    ("foreground_minutes", AGGREGATE_METRIC_FIELDS),
    ("background_minutes", AGGREGATE_METRIC_FIELDS),
    ("total_minutes", AGGREGATE_METRIC_FIELDS),
    ("session_count", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_METRIC_FIELDS),
];

const AGGREGATE_CATEGORY_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_CATEGORY_FIELDS),
    ("study_name", AGGREGATE_CATEGORY_FIELDS),
    ("participant_id", AGGREGATE_CATEGORY_FIELDS),
    ("date", AGGREGATE_CATEGORY_FIELDS),
    ("broad_app_category", AGGREGATE_CATEGORY_FIELDS),
    ("foreground_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("background_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("total_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("session_count", AGGREGATE_CATEGORY_FIELDS),
    ("shape/rows", AGGREGATE_CATEGORY_FIELDS),
];

/// `category_csv` groups on the derived category instead of the package.
const AGGREGATE_CATEGORY_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
    "duration_minutes",
    "broad_app_category",
];

const AGGREGATE_CO_USAGE_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_METRIC_FIELDS),
    ("study_name", AGGREGATE_METRIC_FIELDS),
    ("participant_id", AGGREGATE_METRIC_FIELDS),
    ("app_a", AGGREGATE_METRIC_FIELDS),
    ("app_b", AGGREGATE_METRIC_FIELDS),
    ("co_usage_count", AGGREGATE_METRIC_FIELDS),
    ("total_overlap_minutes", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_METRIC_FIELDS),
];

/// `visualization_row` projects exactly these fields into every plotted row.
const VISUALIZATION_ROW_FIELDS: &[&str] = &[
    "participant_id",
    "date",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "event_timestamp_ns",
    "interaction_type",
    "broad_app_category",
    "app_package_name",
    "application_label",
    "username",
    "screen_usage_end_reason",
];

/// Output kinds whose cells are addressed by (row index, column) and therefore
/// also depend on the row-set pseudo-fields.
pub const ROW_ADDRESSED_OUTPUT_KINDS: &[&str] = &[
    "app-csv",
    "credited-app-csv",
    "screen-csv",
    "compliance-csv",
    "day-coverage-csv",
    "review-summary-json",
    "visualization-data-json",
    "aggregate-daily-summary-csv",
    "aggregate-weekly-summary-csv",
    "aggregate-top-apps-csv",
    "aggregate-category-time-budget-csv",
    "aggregate-app-co-usage-csv",
];

/// Every declared canonical output cell family and the data fields that render
/// it. `app-csv` and `credited-app-csv` share one writer; `credited-app-csv`
/// rows are emitted by the screen-gated crediting layer.
pub fn output_cell_bindings() -> Vec<PipelineOutputCellBinding> {
    let mut bindings = Vec::new();
    for (output_kind, emitting_query) in [
        ("app-csv", "assemble_result_manifest"),
        ("credited-app-csv", "assemble_credit_outputs"),
    ] {
        for (column, from) in APP_ROW_COLUMNS {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_query,
                from,
            });
        }
        for (source, output) in crate::pipeline_v2::codebook_column_renames() {
            let _ = source;
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column: output,
                emitting_query,
                from: &["codebook_fields"],
            });
        }
    }
    for (column, from) in SCREEN_ROW_COLUMNS {
        bindings.push(PipelineOutputCellBinding {
            output_kind: "screen-csv",
            column,
            emitting_query: "assemble_result_manifest",
            from,
        });
    }
    bindings.extend_from_slice(NON_ROW_CELL_BINDINGS);
    // `build_aggregate_outputs` renders every aggregate CSV inside
    // `assemble_primary_outputs`, whose product step is `assemble_result_manifest`. The
    // daily and weekly summaries share `summary_csv`, so they share its column
    // table and differ only in the period column and its derivation.
    for (output_kind, only_columns) in [
        ("aggregate-daily-summary-csv", AGGREGATE_DAILY_ONLY_COLUMNS),
        (
            "aggregate-weekly-summary-csv",
            AGGREGATE_WEEKLY_ONLY_COLUMNS,
        ),
    ] {
        for (column, from) in AGGREGATE_SUMMARY_SHARED_COLUMNS
            .iter()
            .chain(only_columns.iter())
        {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_query: "assemble_result_manifest",
                from,
            });
        }
    }
    for (output_kind, columns) in [
        ("aggregate-top-apps-csv", AGGREGATE_TOP_APPS_COLUMNS),
        (
            "aggregate-category-time-budget-csv",
            AGGREGATE_CATEGORY_COLUMNS,
        ),
        ("aggregate-app-co-usage-csv", AGGREGATE_CO_USAGE_COLUMNS),
    ] {
        for (column, from) in columns {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_query: "assemble_result_manifest",
                from,
            });
        }
    }
    bindings
}

/// Whether an identifier names a column of a supplied source artifact rather
/// than a carrier data field or a modelled pseudo-field.
pub fn is_supplied_source_column(field: &str) -> bool {
    field.contains('.') && !is_pseudo_field(field)
}

/// Every supplied source column any step declares that it reads.
pub fn declared_source_columns() -> Vec<&'static str> {
    let mut columns = WORKFLOW_QUERIES
        .iter()
        .flat_map(|step| query_field_reads(step.id).iter().copied())
        .filter(|field| is_supplied_source_column(field))
        .collect::<BTreeSet<_>>();
    // A rendered cell may name a supplied column directly without any step
    // carrying it onto a row.
    columns.extend(
        output_cell_bindings()
            .into_iter()
            .flat_map(|binding| binding.from.iter().copied())
            .filter(|field| is_supplied_source_column(field)),
    );
    columns.into_iter().collect()
}

fn field_writers() -> BTreeMap<&'static str, Vec<&'static [&'static str]>> {
    let mut writers: BTreeMap<&'static str, Vec<&'static [&'static str]>> = BTreeMap::new();
    for step in WORKFLOW_QUERIES {
        for edge in query_field_edges(step.id) {
            writers.entry(edge.to).or_default().push(edge.from);
        }
    }
    writers
}

/// The single supplied source column a field is a verbatim copy of, or `None`.
/// A field qualifies only when every declared write of it takes exactly one
/// contributor and every one of those chains ends at the same supplied column.
/// A write of a field from itself is the identity carry from the parsed row to
/// the canonical row and introduces no new contributor.
fn pure_copy_source(
    field: &'static str,
    writers: &BTreeMap<&'static str, Vec<&'static [&'static str]>>,
    resolved: &mut BTreeMap<&'static str, Option<&'static str>>,
    stack: &mut Vec<&'static str>,
) -> Option<&'static str> {
    if is_supplied_source_column(field) {
        return Some(field);
    }
    if is_pseudo_field(field) {
        return None;
    }
    if let Some(cached) = resolved.get(field) {
        return *cached;
    }
    if stack.contains(&field) {
        return None;
    }
    stack.push(field);
    let mut found = BTreeSet::new();
    let mut pure = true;
    match writers.get(field) {
        None => pure = false,
        Some(edges) => {
            for from in edges {
                let contributors = from
                    .iter()
                    .copied()
                    .filter(|other| *other != field)
                    .collect::<Vec<_>>();
                match contributors.as_slice() {
                    [] => continue,
                    [only] => match pure_copy_source(only, writers, resolved, stack) {
                        Some(source) => {
                            found.insert(source);
                        }
                        None => {
                            pure = false;
                            break;
                        }
                    },
                    _ => {
                        pure = false;
                        break;
                    }
                }
            }
        }
    }
    stack.pop();
    let answer = if pure && found.len() == 1 {
        found.into_iter().next()
    } else {
        None
    };
    resolved.insert(field, answer);
    answer
}

/// One output cell family whose value is a verbatim copy of exactly one
/// supplied source column. Nothing else in the pipeline can change that value,
/// so when row lineage names exactly one contributing raw record the exact
/// source cell that produced the result cell is pinned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineExactCellContribution {
    pub output_kind: &'static str,
    pub column: &'static str,
    pub source_field: &'static str,
}

/// Derived from the declared field edges, never hand-listed: widening any
/// step's declared reads immediately removes the affected column here.
pub fn exact_cell_contributions() -> Vec<PipelineExactCellContribution> {
    let writers = field_writers();
    let mut resolved = BTreeMap::new();
    output_cell_bindings()
        .into_iter()
        .filter_map(|binding| {
            let [field] = binding.from else { return None };
            let source = pure_copy_source(field, &writers, &mut resolved, &mut Vec::new())?;
            Some(PipelineExactCellContribution {
                output_kind: binding.output_kind,
                column: binding.column,
                source_field: source,
            })
        })
        .collect()
}

/// Forward closure of the declared field edges from one field.
fn reachable_fields(seed: &'static str) -> BTreeSet<&'static str> {
    let edges = WORKFLOW_QUERIES
        .iter()
        .flat_map(|step| query_field_edges(step.id))
        .collect::<Vec<_>>();
    let mut reached = BTreeSet::from([seed]);
    let mut grew = true;
    while grew {
        grew = false;
        for edge in &edges {
            if reached.contains(edge.to) {
                continue;
            }
            if edge.from.iter().any(|field| reached.contains(field)) {
                reached.insert(edge.to);
                grew = true;
            }
        }
    }
    reached
}

/// Every canonical output cell family one supplied source column can reach.
pub struct PipelineSourceColumnReach {
    pub source_field: &'static str,
    pub cells: Vec<PipelineOutputCellBinding>,
}

/// The declared column-granular reach of every supplied source column. Output
/// families that carry no row lineage are witnessed at this granularity
/// instead of being reported as one unresolved whole-artifact gap.
pub fn source_column_output_reach() -> Vec<PipelineSourceColumnReach> {
    let bindings = output_cell_bindings();
    declared_source_columns()
        .into_iter()
        .map(|source_field| {
            let reached = reachable_fields(source_field);
            PipelineSourceColumnReach {
                source_field,
                cells: bindings
                    .iter()
                    .filter(|binding| {
                        output_cell_dependencies(binding)
                            .iter()
                            .any(|field| reached.contains(field))
                    })
                    .copied()
                    .collect(),
            }
        })
        .collect()
}

/// Complete dependency set of one output cell family: its rendered fields plus
/// the row-set pseudo-fields.
///
/// The tail is unconditional. Declaring a cell family *is* what makes an output
/// row-addressed — an output without row addressing (a byte-identical derived
/// artifact such as parquet or SPSS) declares no cell families at all, so every
/// one of the 263 bindings is row-addressed. This used to test
/// `ROW_ADDRESSED_OUTPUT_KINDS` here, which read as a live distinction but was a
/// branch no binding could take: its false arm was never executed by any test or
/// caller, so a mutant flipping it survived. The invariant is now asserted in
/// `output_cell_dependencies_are_the_rendered_fields_plus_the_row_set` instead
/// of implied by an unexercised conditional.
pub fn output_cell_dependencies(binding: &PipelineOutputCellBinding) -> Vec<&'static str> {
    let mut fields = binding.from.to_vec();
    fields.extend_from_slice(ROW_SET_FIELDS);
    fields
}

fn canonical_digest<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).expect("workflow contract value is serializable");
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn operation_artifact_id(operation_id: &str) -> String {
    format!("artifact.{operation_id}")
}

fn source_artifact_id(role_id: &str) -> String {
    if role_id == "processing_options" {
        "config.processing_options".to_string()
    } else {
        format!("source.{role_id}")
    }
}

fn operation_specs(query_id: &str) -> Vec<&'static OperationSpec> {
    OPERATION_SPECS
        .iter()
        .filter(|operation| operation.query_id == query_id)
        .collect()
}

fn query_output_ports(query_id: &str) -> Vec<String> {
    let ports = operation_specs(query_id)
        .into_iter()
        .map(|operation| operation_artifact_id(operation.id))
        .collect::<Vec<_>>();
    if ports.is_empty() && query_id == "bind_processing_timestamp" {
        vec!["provenance.processing_timestamp".to_string()]
    } else {
        ports
    }
}

fn query_review_behavior(query_id: &str) -> ReviewBehavior {
    if matches!(
        query_id,
        "identify_credit_eligible_sessions"
            | "build_activity_witness_indexes"
            | "assess_screen_evidence_capability"
            | "summarize_daily_apps"
            | "derive_credited_intervals"
            | "materialize_credited_rows"
            | "assemble_credit_outputs"
            | "index_raw_dates"
            | "build_participant_day_coverage"
            | "aggregate_attribution_minutes"
            | "compute_attribution_completeness"
            | "classify_compliance_days"
    ) {
        ReviewBehavior::Omit
    } else if query_id == "assemble_result_manifest"
        || matches!(
            query_id,
            "materialize_candidate_episodes"
                | "classify_episode_durations"
                | "apply_app_inclusion_policy"
                | "order_app_episodes"
                | "join_app_codebook"
                | "derive_broad_category"
                | "collapse_app_genre"
                | "derive_engagement_basis"
                | "apply_episode_flags"
                | "suppress_excluded_timing"
                | "remove_selected_interaction_types"
                | "remove_zero_duration_rows"
                | "apply_participant_windows"
                | "classify_person_attribution"
                | "synthesize_placeholder_rows"
        )
    {
        ReviewBehavior::Passthrough
    } else {
        ReviewBehavior::Execute
    }
}

fn artifact_kind(operation: &OperationSpec) -> ArtifactKind {
    // Artifact types are semantic declarations, not naming heuristics. Keep
    // this match explicit so a new operation must make an intentional choice
    // instead of being typed by a substring in its identifier.
    match operation.id {
        "evidence.index_keyguard_events"
        | "reconstruct.index_app_events"
        | "policy.resolve_matcher_masks"
        | "evidence.index_device_activity"
        | "evidence.index_reboots"
        | "evidence.index_screen_witnesses"
        | "study.index_survey_responses"
        | "evidence.index_raw_dates" => ArtifactKind::Index,
        "reconstruct.infer_screen_session_skeletons"
        | "evidence.derive_screen_session_features"
        | "policy.classify_screen_end_reasons"
        | "reconstruct.materialize_screen_sessions"
        | "reconstruct.match_app_episodes"
        | "reconstruct.materialize_candidate_episodes"
        | "reconstruct.classify_app_episodes"
        | "reconstruct.segment_concurrent_usage"
        | "credit.identify_eligible_sessions"
        | "credit.cap_candidate_intervals"
        | "credit.derive_device_live_spans"
        | "credit.derive_screen_creditable_spans"
        | "credit.intersect_evidence"
        | "credit.apply_no_witness_fallback"
        | "credit.materialize_credited_rows" => ArtifactKind::Intervals,
        "evidence.summarize_device_models"
        | "evidence.collect_timezone_observations"
        | "evidence.estimate_dominant_timezone"
        | "evidence.summarize_row_selection"
        | "evidence.summarize_duplicate_groups"
        | "evidence.derive_time_gaps"
        | "assessment.report_screen_evidence_capability"
        | "evidence.summarize_daily_apps"
        | "assessment.aggregate_attribution_minutes"
        | "assessment.compute_completeness" => ArtifactKind::Evidence,
        "policy.resolve_timezone_strategy"
        | "policy.resolve_effective_app_exclusions"
        | "study.resolve_participant_windows"
        | "study.resolve_sharing_status" => ArtifactKind::Metric,
        "assessment.build_participant_day_spine"
        | "assessment.classify_days"
        | "assessment.summarize_coverage"
        | "policy.apply_compliance_threshold"
        | "credit.publish_credit_result"
        | "publish.project_app_table"
        | "publish.project_screen_table"
        | "publish.project_credited_table"
        | "publish.build_aggregate_tables"
        | "publish.build_review_data"
        | "publish.build_visualization_data" => ArtifactKind::Table,
        "publish.encode_selected_formats" => ArtifactKind::Manifest,
        "publish.emit_lineage" | "publish.emit_provenance" => ArtifactKind::Evidence,
        "publish.commit_workspace_bundle" => ArtifactKind::Manifest,
        _ => ArtifactKind::Records,
    }
}

fn operation_direct_request_fields(operation: &OperationSpec) -> &'static [&'static str] {
    match operation.id {
        "time.apply_missing_timezone_rule" => &["timezone"],
        "policy.resolve_timezone_strategy" => &["timezone", "timezone_handling"],
        "policy.resolve_matcher_masks" => &[
            "same_app_stop_types",
            "other_stop_types",
            "model_concurrent_usage",
            "use_background_apps_file",
        ],
        "policy.classify_screen_end_reasons" => &[
            "use_apps_forcing_screen_open",
            "screen_auto_lock_timeout_seconds",
            "screen_auto_lock_tolerance_seconds",
            "screen_manual_lock_max_tail_seconds",
            "screen_keyguard_near_stop_seconds",
        ],
        "policy.suppress_short_durations" => &["minimum_usage_duration"],
        "reconstruct.segment_concurrent_usage" => {
            &["model_concurrent_usage", "use_background_apps_file"]
        }
        "policy.apply_concurrent_segment_floor" => &[
            "minimum_usage_duration",
            "apply_minimum_usage_duration_to_concurrent_subintervals",
        ],
        "policy.classify_engagement" => &["custom_app_engagement_duration"],
        "policy.flag_long_usage" => &["long_usage_duration_thresholds"],
        "policy.flag_long_gaps" => &["long_data_time_gap_thresholds"],
        "credit.cap_candidate_intervals" => &["credited_session_cap_minutes"],
        "credit.derive_device_live_spans" => &["device_liveness_gap_tolerance_minutes"],
        "credit.derive_screen_creditable_spans" => &["auto_lock_bridge_seconds"],
        "credit.apply_no_witness_fallback" => &["no_witness_min_day_apps"],
        "publish.project_app_table" => &[
            "usage_session_mode",
            "include_app_output",
            "include_category_column",
            "study_name",
            "timezone",
            "datetime_of_preprocessing",
            "use_app_codebook",
            "model_concurrent_usage",
            "use_background_apps_file",
        ],
        "publish.project_screen_table" => &[
            "usage_session_mode",
            "include_screen_output",
            "study_name",
            "timezone",
            "datetime_of_preprocessing",
        ],
        "publish.project_credited_table" => &[
            "usage_session_mode",
            "enable_screen_gated_crediting",
            "include_category_column",
            "study_name",
            "timezone",
            "datetime_of_preprocessing",
            "use_app_codebook",
            "model_concurrent_usage",
            "use_background_apps_file",
        ],
        "publish.build_aggregate_tables" => &[
            "enable_aggregates",
            "aggregate_shape",
            "study_name",
            "use_app_codebook",
            "model_concurrent_usage",
            "use_background_apps_file",
        ],
        "publish.encode_selected_formats" => &["enable_parquet_export", "enable_spss_export"],
        "publish.build_visualization_data" => &["materialize_visualization_data"],
        "publish.commit_workspace_bundle" => &[],
        _ if operation_specs(operation.query_id).len() == 1 => {
            query_request_fields(operation.query_id)
        }
        _ => &[],
    }
}

fn operation_direct_source_roles(operation: &OperationSpec) -> &'static [&'static str] {
    match operation.id {
        "policy.classify_screen_end_reasons" => &["apps_forcing_screen_open_file"],
        "policy.resolve_matcher_masks" => &["background_apps_file"],
        "reconstruct.segment_concurrent_usage" => &["background_apps_file"],
        "publish.encode_selected_formats" => &["enrolled_devices_file"],
        "assessment.build_participant_day_spine" => &["study_dates_file"],
        _ if operation_specs(operation.query_id).len() == 1 => {
            query_source_roles(operation.query_id)
        }
        _ => &[],
    }
}

fn operation_input_override(operation_id: &str) -> Option<&'static [&'static str]> {
    match operation_id {
        "publish.project_app_table" => Some(&["artifact.assessment.synthesize_placeholder_rows"]),
        "publish.project_screen_table" => {
            Some(&["artifact.reconstruct.materialize_screen_sessions"])
        }
        "publish.project_credited_table" => Some(&["artifact.credit.publish_credit_result"]),
        "publish.build_aggregate_tables" => Some(&[
            "artifact.publish.project_app_table",
            "artifact.publish.project_screen_table",
        ]),
        "publish.encode_selected_formats" => Some(&[
            "artifact.publish.project_app_table",
            "artifact.publish.project_screen_table",
            "artifact.publish.project_credited_table",
            "artifact.publish.build_aggregate_tables",
            "artifact.assessment.summarize_coverage",
            "artifact.policy.apply_compliance_threshold",
        ]),
        "publish.build_review_data" | "publish.build_visualization_data" => Some(&[
            "artifact.publish.project_app_table",
            "artifact.publish.project_screen_table",
        ]),
        "publish.emit_lineage" => Some(&[
            "artifact.publish.project_app_table",
            "artifact.publish.project_screen_table",
            "artifact.publish.project_credited_table",
        ]),
        "publish.emit_provenance" => Some(&[
            "config.processing_options",
            "provenance.processing_timestamp",
        ]),
        "publish.commit_workspace_bundle" => Some(&[
            "artifact.publish.project_app_table",
            "artifact.publish.project_screen_table",
            "artifact.publish.project_credited_table",
            "artifact.publish.build_aggregate_tables",
            "artifact.publish.encode_selected_formats",
            "artifact.publish.build_review_data",
            "artifact.publish.build_visualization_data",
            "artifact.publish.emit_lineage",
            "artifact.publish.emit_provenance",
        ]),
        _ => None,
    }
}

fn operation_applicability(operation: &OperationSpec) -> ApplicabilityExpression {
    let app_mode = || {
        any(vec![
            ApplicabilityExpression::OptionStringEquals {
                option_key: "usage_session_mode",
                value: "app_usage",
            },
            ApplicabilityExpression::OptionStringEquals {
                option_key: "usage_session_mode",
                value: "app_and_screen_usage",
            },
        ])
    };
    let screen_mode = || {
        any(vec![
            ApplicabilityExpression::OptionStringEquals {
                option_key: "usage_session_mode",
                value: "screen_usage",
            },
            ApplicabilityExpression::OptionStringEquals {
                option_key: "usage_session_mode",
                value: "app_and_screen_usage",
            },
        ])
    };
    match operation.id {
        "publish.project_app_table" => all(vec![app_mode(), option_true("include_app_output")]),
        "publish.project_screen_table" => {
            all(vec![screen_mode(), option_true("include_screen_output")])
        }
        "publish.project_credited_table" => all(vec![
            app_mode(),
            option_true("enable_screen_gated_crediting"),
        ]),
        "publish.build_aggregate_tables" => option_true("enable_aggregates"),
        "publish.build_visualization_data" => option_true("materialize_visualization_data"),
        _ => query_applicability(operation.query_id),
    }
}

fn applicability_inputs(
    expression: &ApplicabilityExpression,
    option_keys: &mut BTreeSet<&'static str>,
    support_roles: &mut BTreeSet<&'static str>,
) {
    match expression {
        ApplicabilityExpression::Always => {}
        ApplicabilityExpression::OptionTrue { option_key }
        | ApplicabilityExpression::OptionBooleanEquals { option_key, .. }
        | ApplicabilityExpression::OptionStringEquals { option_key, .. }
        | ApplicabilityExpression::ArrayNonempty { option_key }
        | ApplicabilityExpression::StringNonempty { option_key } => {
            option_keys.insert(option_key);
        }
        ApplicabilityExpression::SupportPresent { role_id } => {
            support_roles.insert(role_id);
        }
        ApplicabilityExpression::All { terms } | ApplicabilityExpression::Any { terms } => {
            for term in terms {
                applicability_inputs(term, option_keys, support_roles);
            }
        }
        ApplicabilityExpression::Not { term } => {
            applicability_inputs(term, option_keys, support_roles);
        }
    }
}

fn build_semantic_registry(
    root_roles: &[WorkflowRootRoleDefinition],
) -> (Vec<OperationDefinition>, Vec<ArtifactDefinition>) {
    let query_by_id = WORKFLOW_QUERIES
        .iter()
        .map(|query| (query.id, query))
        .collect::<BTreeMap<_, _>>();
    let mut artifacts = BTreeMap::<String, ArtifactDefinition>::new();
    let mut artifact_closures = BTreeMap::<String, String>::new();

    for role in root_roles {
        let id = source_artifact_id(role.role_id);
        let kind = if role.role_id == "processing_options" {
            ArtifactKind::Configuration
        } else {
            ArtifactKind::Source
        };
        let definition_digest = canonical_digest(&serde_json::json!({
            "id": id,
            "kind": kind,
            "role": role,
        }));
        let closure_digest = canonical_digest(&serde_json::json!({
            "definition": definition_digest,
            "inputs": [],
        }));
        artifact_closures.insert(id.clone(), closure_digest.clone());
        artifacts.insert(
            id.clone(),
            ArtifactDefinition {
                id,
                label: role.role_id.replace('_', " "),
                kind,
                schema_id: format!("urn:chronicle:artifact-schema:{}", role.role_id),
                producer_operation_id: None,
                consumer_operation_ids: Vec::new(),
                epistemic_role: EpistemicRole::Observed,
                materialization: "source",
                equality: "content_digest",
                audience_tags: vec!["decisions", "lineage", "audit"],
                definition_digest,
                closure_digest,
            },
        );
    }

    let provenance_id = "provenance.processing_timestamp".to_string();
    let provenance_definition = canonical_digest(&serde_json::json!({
        "id": provenance_id,
        "kind": "provenance",
    }));
    let provenance_closure = canonical_digest(&serde_json::json!({
        "definition": provenance_definition,
        "inputs": ["config.processing_options"],
    }));
    artifact_closures.insert(provenance_id.clone(), provenance_closure.clone());
    artifacts.insert(
        provenance_id.clone(),
        ArtifactDefinition {
            id: provenance_id,
            label: "processing timestamp provenance".to_string(),
            kind: ArtifactKind::Evidence,
            schema_id: "urn:chronicle:artifact-schema:processing-timestamp-provenance".to_string(),
            producer_operation_id: None,
            consumer_operation_ids: Vec::new(),
            epistemic_role: EpistemicRole::Observed,
            materialization: "run_provenance",
            equality: "value",
            audience_tags: vec!["audit"],
            definition_digest: provenance_definition,
            closure_digest: provenance_closure,
        },
    );

    let mut operations = Vec::new();
    for query in WORKFLOW_QUERIES {
        let specs = operation_specs(query.id);
        let mut predecessor_inputs = query
            .inputs
            .iter()
            .flat_map(|input| query_output_ports(input))
            .collect::<Vec<_>>();
        predecessor_inputs.sort();
        predecessor_inputs.dedup();

        let mut previous_output: Option<String> = None;
        for spec in specs {
            let applicability = operation_applicability(spec);
            let mut applicability_options = BTreeSet::new();
            let mut applicability_supports = BTreeSet::new();
            applicability_inputs(
                &applicability,
                &mut applicability_options,
                &mut applicability_supports,
            );
            let config_fields = operation_direct_request_fields(spec)
                .iter()
                .copied()
                .chain(applicability_options)
                .collect::<BTreeSet<_>>();
            let source_roles = operation_direct_source_roles(spec)
                .iter()
                .copied()
                .chain(applicability_supports)
                .collect::<BTreeSet<_>>();
            let mut input_artifacts = if let Some(inputs) = operation_input_override(spec.id) {
                inputs.iter().map(|input| (*input).to_string()).collect()
            } else if let (true, Some(previous_output)) =
                (spec.follows_previous, previous_output.as_ref())
            {
                vec![previous_output.clone()]
            } else {
                predecessor_inputs.clone()
            };
            input_artifacts.extend(source_roles.iter().map(|role| source_artifact_id(role)));
            if !config_fields.is_empty() {
                input_artifacts.push("config.processing_options".to_string());
            }
            input_artifacts.sort();
            input_artifacts.dedup();

            let output_id = operation_artifact_id(spec.id);
            let config_dependencies = config_fields
                .iter()
                .map(|field| OperationConfigDependency {
                    field: (*field).to_string(),
                    effect: "semantic_reconsideration",
                    identity_mode: "value",
                })
                .collect::<Vec<_>>();
            let definition_digest = canonical_digest(&serde_json::json!({
                "id": spec.id,
                "role": spec.role,
                "epistemicRole": spec.epistemic_role,
                "inputs": input_artifacts,
                "outputs": [output_id.clone()],
                "query": query.id,
                "configDependencies": config_dependencies,
                "dataEffects": spec.effects,
                "applicability": applicability,
            }));
            let upstream_closures = input_artifacts
                .iter()
                .map(|input| {
                    artifact_closures
                        .get(input)
                        .cloned()
                        .unwrap_or_else(|| canonical_digest(input))
                })
                .collect::<Vec<_>>();
            let closure_digest = canonical_digest(&serde_json::json!({
                "definition": definition_digest,
                "upstream": upstream_closures,
            }));
            let audience_tags = if spec.role == OperationRole::ApplyMeasurementPolicy {
                vec!["decisions", "lineage", "audit"]
            } else {
                vec!["lineage", "audit"]
            };
            operations.push(OperationDefinition {
                id: spec.id,
                label: spec.label,
                description: spec.description,
                phase_id: spec.phase_id,
                role: spec.role,
                epistemic_role: spec.epistemic_role,
                input_artifacts: input_artifacts.clone(),
                output_artifacts: vec![output_id.clone()],
                query_ids: vec![query.id],
                config_dependencies,
                data_effects: spec.effects,
                audience_tags: audience_tags.clone(),
                applicability,
                definition_digest: definition_digest.clone(),
                closure_digest: closure_digest.clone(),
            });
            artifact_closures.insert(output_id.clone(), closure_digest.clone());
            artifacts.insert(
                output_id.clone(),
                ArtifactDefinition {
                    id: output_id.clone(),
                    label: format!("{} output", spec.label),
                    kind: artifact_kind(spec),
                    schema_id: format!("urn:chronicle:artifact-schema:{}", spec.id),
                    producer_operation_id: Some(spec.id),
                    consumer_operation_ids: Vec::new(),
                    epistemic_role: spec.epistemic_role,
                    materialization: if matches!(
                        spec.id,
                        "reconstruct.materialize_candidate_episodes"
                            | "credit.materialize_credited_rows"
                    ) {
                        "checkpoint_candidate"
                    } else {
                        "in_memory"
                    },
                    equality: "typed_value",
                    audience_tags,
                    definition_digest,
                    closure_digest,
                },
            );
            previous_output = Some(output_id);
        }
    }

    for operation in &operations {
        for input in &operation.input_artifacts {
            if let Some(artifact) = artifacts.get_mut(input) {
                artifact.consumer_operation_ids.push(operation.id);
            }
        }
    }
    for artifact in artifacts.values_mut() {
        artifact.consumer_operation_ids.sort_unstable();
        artifact.consumer_operation_ids.dedup();
    }

    debug_assert!(WORKFLOW_QUERIES
        .iter()
        .all(|query| query_by_id.contains_key(query.id)));
    (operations, artifacts.into_values().collect())
}

fn build_execution_contract() -> WorkflowExecutionContract {
    let query_groups = workflow_query_group_ids()
        .into_iter()
        .map(query_group_definition)
        .map(|group| {
            let applicability = query_group_applicability(group.id);
            QueryGroupContractEntry {
                id: group.id,
                label: group.label,
                section: group.section,
                knobs: query_group_config_dependencies(group.id),
                support_roles: query_group_support_roles(group.id),
                can_bypass: applicability != ApplicabilityExpression::Always,
                applicability,
                early_cutoff: matches!(
                    group.id,
                    "parse_events" | "normalize_timezones" | "dedup_and_order" | "app_policy"
                ),
            }
        })
        .collect();
    let mut closure_by_query = BTreeMap::<&str, String>::new();
    let mut queries = Vec::new();
    for query in WORKFLOW_QUERIES {
        let applicability = query_applicability(query.id);
        let operation_ids = operation_specs(query.id)
            .into_iter()
            .map(|operation| operation.id)
            .collect::<Vec<_>>();
        let classification = if operation_ids.is_empty() {
            if query.id == "bind_processing_timestamp" {
                QueryClassification::Provenance
            } else {
                QueryClassification::Internal
            }
        } else {
            QueryClassification::OperationBacked
        };
        let review_behavior = query_review_behavior(query.id);
        let output_ports = query_output_ports(query.id);
        let definition_digest = canonical_digest(&serde_json::json!({
            "id": query.id,
            "group": query.group,
            "inputs": query.inputs,
            "operations": operation_ids,
            "classification": classification,
            "reviewBehavior": review_behavior,
            "outputPorts": output_ports,
            "requestFields": query_request_fields(query.id),
            "sourceRoles": query_source_roles(query.id),
            "sourceRoleBindings": query_source_role_bindings(query.id),
            "fieldReads": query_field_reads(query.id),
            "fieldWrites": query_field_writes(query.id),
            "fieldEdges": query_field_edges(query.id),
            "applicability": applicability,
        }));
        let upstream = query
            .inputs
            .iter()
            .filter_map(|input| closure_by_query.get(input))
            .cloned()
            .collect::<Vec<_>>();
        let closure_digest = canonical_digest(&serde_json::json!({
            "definition": definition_digest,
            "upstream": upstream,
        }));
        closure_by_query.insert(query.id, closure_digest.clone());
        queries.push(WorkflowQueryContractEntry {
            id: query.id,
            group: query.group,
            inputs: query.inputs,
            operation_ids,
            classification,
            review_behavior,
            output_ports,
            request_fields: query_request_fields(query.id),
            source_roles: query_source_roles(query.id),
            source_role_bindings: query_source_role_bindings(query.id),
            field_reads: query_field_reads(query.id),
            field_writes: query_field_writes(query.id),
            field_edges: query_field_edges(query.id),
            can_bypass: applicability != ApplicabilityExpression::Always,
            applicability,
            definition_digest,
            closure_digest,
        });
    }
    WorkflowExecutionContract {
        query_groups,
        queries,
    }
}

fn semantic_identity_value(semantic: &WorkflowSemanticContract) -> serde_json::Value {
    serde_json::json!({
        "rootRoles": &semantic.root_roles,
        "operations": semantic.operations.iter().map(|operation| serde_json::json!({
            "id": operation.id,
            "role": operation.role,
            "epistemicRole": operation.epistemic_role,
            "inputArtifacts": &operation.input_artifacts,
            "outputArtifacts": &operation.output_artifacts,
            "queryIds": &operation.query_ids,
            "configDependencies": &operation.config_dependencies,
            "dataEffects": operation.data_effects,
            "applicability": &operation.applicability,
            "definitionDigest": &operation.definition_digest,
            "closureDigest": &operation.closure_digest,
        })).collect::<Vec<_>>(),
        "artifacts": semantic.artifacts.iter().map(|artifact| serde_json::json!({
            "id": &artifact.id,
            "kind": artifact.kind,
            "schemaId": &artifact.schema_id,
            "producerOperationId": artifact.producer_operation_id,
            "consumerOperationIds": &artifact.consumer_operation_ids,
            "epistemicRole": artifact.epistemic_role,
            "materialization": artifact.materialization,
            "equality": artifact.equality,
            "definitionDigest": &artifact.definition_digest,
            "closureDigest": &artifact.closure_digest,
        })).collect::<Vec<_>>(),
        "outputCellBindings": &semantic.output_cell_bindings,
        "exactCellContributions": &semantic.exact_cell_contributions,
        "rowSetFields": semantic.row_set_fields,
        "rowAddressedOutputKinds": semantic.row_addressed_output_kinds,
    })
}

fn presentation_identity_value(
    semantic: &WorkflowSemanticContract,
    presentation: &WorkflowPresentationContract,
    execution: &WorkflowExecutionContract,
) -> serde_json::Value {
    serde_json::json!({
        "phases": presentation.phases,
        "operations": semantic.operations.iter().map(|operation| serde_json::json!({
            "id": operation.id,
            "label": operation.label,
            "description": operation.description,
            "phaseId": operation.phase_id,
            "audienceTags": &operation.audience_tags,
        })).collect::<Vec<_>>(),
        "artifacts": semantic.artifacts.iter().map(|artifact| serde_json::json!({
            "id": &artifact.id,
            "label": &artifact.label,
            "audienceTags": &artifact.audience_tags,
        })).collect::<Vec<_>>(),
        "queryGroups": execution.query_groups.iter().map(|group| serde_json::json!({
            "id": group.id,
            "label": group.label,
            "section": group.section,
        })).collect::<Vec<_>>(),
    })
}

fn execution_identity_value(execution: &WorkflowExecutionContract) -> serde_json::Value {
    serde_json::json!({
        "queryGroups": execution.query_groups.iter().map(|group| serde_json::json!({
            "id": group.id,
            "knobs": group.knobs,
            "supportRoles": group.support_roles,
            "applicability": &group.applicability,
            "canBypass": group.can_bypass,
            "earlyCutoff": group.early_cutoff,
        })).collect::<Vec<_>>(),
        "queries": &execution.queries,
    })
}

pub fn workflow_contract() -> WorkflowContract {
    let root_roles = root_role_contract();
    let (operations, artifacts) = build_semantic_registry(&root_roles);
    let semantic = WorkflowSemanticContract {
        root_roles,
        operations,
        artifacts,
        output_cell_bindings: output_cell_bindings(),
        exact_cell_contributions: exact_cell_contributions(),
        row_set_fields: ROW_SET_FIELDS,
        row_addressed_output_kinds: ROW_ADDRESSED_OUTPUT_KINDS,
    };
    let presentation = WorkflowPresentationContract {
        phases: WORKFLOW_PHASES,
    };
    let execution = build_execution_contract();
    let checkpoint_policy = WorkflowCheckpointContract {
        identity_scope: "local-query-and-output-port-closure",
        review_event_base: "review_event_base",
        reconstructed_episode_base: "reconstructed_episode_base",
        durable_promotion_policy:
            "median-and-p95-gain-exceed-max-five-percent-baseline-or-two-pooled-mad",
    };
    let evidence = WorkflowEvidenceContract {
        operation_application_states: &[
            "applied",
            "bypassed",
            "not_applicable",
            "error",
            "not_observed",
        ],
        artifact_states: &[
            "materialized",
            "reused",
            "absent",
            "changed",
            "unchanged",
            "error",
            "not_observed",
        ],
        query_execution_states: &[
            "executed",
            "memoized",
            "restored",
            "omitted",
            "error",
            "not_observed",
        ],
    };
    // Identity is projected by layer. Human-facing wording and grouping may
    // evolve without invalidating scientific caches; semantic or physical
    // dependency changes still move their own digests and workspace identity.
    let semantic_identity = semantic_identity_value(&semantic);
    let presentation_identity = presentation_identity_value(&semantic, &presentation, &execution);
    let execution_identity = execution_identity_value(&execution);
    let semantic_digest = canonical_digest(&semantic_identity);
    let presentation_digest = canonical_digest(&presentation_identity);
    let execution_digest = canonical_digest(&execution_identity);
    let checkpoint_policy_digest = canonical_digest(&checkpoint_policy);
    let evidence_digest = canonical_digest(&evidence);
    let workspace_compatibility = canonical_digest(&serde_json::json!({
        "semantic": semantic_digest,
        "execution": execution_digest,
        "checkpointPolicy": checkpoint_policy_digest,
        "evidence": evidence_digest,
    }));
    WorkflowContract {
        protocol_version: "chronicle-workflow-contract/v1",
        workflow_model_version: WORKFLOW_MODEL_VERSION,
        preprocessor_version: crate::pipeline_v2::PREPROCESSOR_VERSION,
        canonical_interaction_types: crate::CANONICAL_INTERACTION_TYPES,
        unbound_option_keys: &[
            "enable_plotting",
            "include_filtered_app_usage_in_plots",
            "enable_activity_heatmap",
            "export_plots_as_svg",
            "enable_interactive_timeline",
            "parallel_processing",
            "parallel_max_workers",
        ],
        semantic,
        presentation,
        execution,
        checkpoint_policy,
        evidence,
        digests: WorkflowContractDigests {
            semantic: semantic_digest,
            presentation: presentation_digest,
            execution: execution_digest,
            checkpoint_policy: checkpoint_policy_digest,
            evidence: evidence_digest,
            workspace_compatibility,
        },
    }
}

#[cfg(all(test, feature = "incremental-v2"))]
mod field_use_scan;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline_v2::PipelineV2OptionsJson;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn contract_registry_is_unique_resolved_and_topologically_ordered() {
        let derived_group_ids = workflow_query_group_ids();
        let group_ids = derived_group_ids.iter().copied().collect::<BTreeSet<_>>();
        assert_eq!(group_ids.len(), derived_group_ids.len());

        let mut query_ids = BTreeSet::new();
        for query in WORKFLOW_QUERIES {
            assert!(
                group_ids.contains(query.group),
                "unknown group for {}",
                query.id
            );
            assert!(query_ids.insert(query.id), "duplicate query {}", query.id);
            for input in query.inputs {
                assert!(
                    query_ids.contains(input),
                    "{} depends on unknown or later query {}",
                    query.id,
                    input
                );
            }
        }

        let contract = workflow_contract();
        assert!(!contract.presentation.phases.is_empty());
        assert!(!contract.semantic.operations.is_empty());
        assert!(!contract.semantic.artifacts.is_empty());
        assert_eq!(contract.execution.queries.len(), WORKFLOW_QUERIES.len());
    }

    #[test]
    fn presentation_copy_does_not_contaminate_semantic_or_execution_identity() {
        let contract = workflow_contract();
        let mut semantic = contract.semantic.clone();
        let operation = semantic.operations.first_mut().expect("workflow operation");
        operation.label = "Changed display label";
        operation.description = "Changed display description.";
        operation.phase_id = "changed_display_phase";
        operation.audience_tags = vec!["changed-display-audience"];
        let artifact = semantic.artifacts.first_mut().expect("workflow artifact");
        artifact.label = "Changed artifact label".into();
        artifact.audience_tags = vec!["changed-display-audience"];
        assert_eq!(
            canonical_digest(&semantic_identity_value(&semantic)),
            contract.digests.semantic
        );

        let mut execution = contract.execution.clone();
        let group = execution.query_groups.first_mut().expect("query group");
        group.label = "Changed query-group label";
        group.section = "changed-display-section";
        assert_eq!(
            canonical_digest(&execution_identity_value(&execution)),
            contract.digests.execution
        );
        assert_ne!(
            canonical_digest(&presentation_identity_value(
                &semantic,
                &contract.presentation,
                &execution,
            )),
            contract.digests.presentation
        );
    }

    #[cfg(feature = "incremental-v2")]
    #[test]
    fn declared_query_edges_equal_direct_salsa_query_calls() {
        use syn::visit::{self, Visit};

        struct Collector<'a> {
            query_ids: &'a BTreeSet<&'a str>,
            current: Option<String>,
            calls: BTreeMap<String, BTreeSet<String>>,
            method_reads: BTreeMap<String, BTreeSet<String>>,
            local_calls: BTreeMap<String, BTreeSet<String>>,
            internal_queries: BTreeSet<String>,
        }

        impl<'ast> Visit<'ast> for Collector<'_> {
            fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
                if module.ident == "tests" {
                    return;
                }
                visit::visit_item_mod(self, module);
            }

            fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
                let previous = self.current.replace(function.sig.ident.to_string());
                visit::visit_block(self, &function.block);
                self.current = previous;
            }

            fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
                if let (Some(current), syn::Expr::Path(path)) = (&self.current, &*call.func) {
                    if path.qself.is_none() && path.path.segments.len() == 1 {
                        let called = path.path.segments[0].ident.to_string();
                        self.local_calls
                            .entry(current.clone())
                            .or_default()
                            .insert(called.clone());
                        if self.query_ids.contains(called.as_str()) && called != *current {
                            self.calls
                                .entry(current.clone())
                                .or_default()
                                .insert(called);
                        }
                    }
                }
                visit::visit_expr_call(self, call);
            }

            fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
                if let Some(current) = &self.current {
                    if call.method == "record_internal_query_body" {
                        self.internal_queries.insert(current.clone());
                    }
                    self.method_reads
                        .entry(current.clone())
                        .or_default()
                        .insert(call.method.to_string());
                }
                visit::visit_expr_method_call(self, call);
            }
        }

        let query_ids = WORKFLOW_QUERIES
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let syntax = syn::parse_file(include_str!("pipeline_v2_incremental.rs"))
            .expect("tracked Rust source must parse");
        let mut collector = Collector {
            query_ids: &query_ids,
            current: None,
            calls: BTreeMap::new(),
            method_reads: BTreeMap::new(),
            local_calls: BTreeMap::new(),
            internal_queries: BTreeSet::new(),
        };
        let tracked_module = syntax
            .items
            .iter()
            .find_map(|item| match item {
                syn::Item::Mod(module) if module.ident == "tracked" => Some(module),
                _ => None,
            })
            .expect("tracked query module");
        collector.visit_item_mod(tracked_module);

        fn collect_step_calls(
            function: &str,
            calls: &BTreeMap<String, BTreeSet<String>>,
            local_calls: &BTreeMap<String, BTreeSet<String>>,
            transparent_edge_aggregates: &BTreeSet<&str>,
            visited: &mut BTreeSet<String>,
        ) -> BTreeSet<String> {
            if !visited.insert(function.to_string()) {
                return BTreeSet::new();
            }
            let mut result = calls.get(function).cloned().unwrap_or_default();
            for called in local_calls.get(function).into_iter().flatten() {
                if transparent_edge_aggregates.contains(called.as_str()) {
                    result.extend(collect_step_calls(
                        called,
                        calls,
                        local_calls,
                        transparent_edge_aggregates,
                        visited,
                    ));
                }
            }
            result
        }

        let transparent_edge_aggregates = BTreeSet::from(["collect_early_assembly"]);
        let mut mismatches = Vec::new();
        for step in WORKFLOW_QUERIES {
            let declared = step.inputs.iter().copied().collect::<BTreeSet<_>>();
            let observed_owned = collect_step_calls(
                step.id,
                &collector.calls,
                &collector.local_calls,
                &transparent_edge_aggregates,
                &mut BTreeSet::new(),
            );
            let observed = observed_owned.iter().map(String::as_str).collect();
            if declared != observed {
                mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            mismatches.is_empty(),
            "declared inputs differ from direct Salsa query calls:\n{}",
            mismatches.join("\n")
        );

        fn collect_option_reads(
            function: &str,
            query_boundaries: &BTreeSet<&str>,
            field_universe: &BTreeSet<&str>,
            method_reads: &BTreeMap<String, BTreeSet<String>>,
            local_calls: &BTreeMap<String, BTreeSet<String>>,
            visited: &mut BTreeSet<String>,
        ) -> BTreeSet<String> {
            if !visited.insert(function.to_string()) {
                return BTreeSet::new();
            }
            let mut fields = method_reads
                .get(function)
                .into_iter()
                .flat_map(|methods| methods.iter())
                .filter(|method| field_universe.contains(method.as_str()))
                .cloned()
                .collect::<BTreeSet<_>>();
            for called in local_calls.get(function).into_iter().flatten() {
                if query_boundaries.contains(called.as_str()) {
                    continue;
                }
                fields.extend(collect_option_reads(
                    called,
                    query_boundaries,
                    field_universe,
                    method_reads,
                    local_calls,
                    visited,
                ));
            }
            fields
        }

        let field_universe = WORKFLOW_QUERIES
            .iter()
            .flat_map(|step| query_request_fields(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        // These internal Salsa queries memoize parsed support values but do
        // not hide their reads from the workflow contract. Follow through
        // them when deriving each step's actual configuration/source inputs.
        let transparent_support_queries = [
            "background_apps",
            "parsed_filter_rules",
            "parsed_apps_forcing_screen_open",
            "parsed_codebook",
            "parsed_study_windows",
            "parsed_device_sharing",
            "parsed_survey_attribution",
            "parsed_enrolled_devices",
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();
        let query_boundaries = query_ids
            .iter()
            .copied()
            .chain(
                collector
                    .internal_queries
                    .iter()
                    .map(String::as_str)
                    .filter(|query| !transparent_support_queries.contains(query)),
            )
            .collect::<BTreeSet<_>>();
        let mut field_mismatches = Vec::new();
        for step in WORKFLOW_QUERIES {
            let declared = query_request_fields(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let observed = collect_option_reads(
                step.id,
                &query_boundaries,
                &field_universe,
                &collector.method_reads,
                &collector.local_calls,
                &mut BTreeSet::new(),
            );
            let observed = observed.iter().map(String::as_str).collect::<BTreeSet<_>>();
            if declared != observed {
                field_mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            field_mismatches.is_empty(),
            "declared request fields differ from direct/helper Salsa reads:\n{}",
            field_mismatches.join("\n")
        );

        // Root artifacts are tracked separately from options. Keep this map
        // deliberately small and mechanical: each entry is the generated
        // Salsa accessor for one product role. A query that starts or stops
        // reading one of these byte inputs must change the exported contract.
        let source_accessor_roles = BTreeMap::from([
            ("bytes", "raw_chronicle_csv"),
            ("filter_csv", "filter_file"),
            ("apps_forcing_csv", "apps_forcing_screen_open_file"),
            ("background_apps_csv", "background_apps_file"),
            ("codebook_csv", "app_codebook_file"),
            ("study_dates_csv", "study_dates_file"),
            ("device_sharing_csv", "device_sharing_file"),
            ("survey_attribution_csv", "survey_attribution_file"),
            ("enrolled_devices_csv", "enrolled_devices_file"),
        ]);
        let source_accessor_universe = source_accessor_roles
            .keys()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut source_mismatches = Vec::new();
        for step in WORKFLOW_QUERIES {
            let declared = query_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let observed_accessors = collect_option_reads(
                step.id,
                &query_boundaries,
                &source_accessor_universe,
                &collector.method_reads,
                &collector.local_calls,
                &mut BTreeSet::new(),
            );
            let observed = observed_accessors
                .iter()
                .map(|accessor| source_accessor_roles[accessor.as_str()])
                .collect::<BTreeSet<_>>();
            if declared != observed {
                source_mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            source_mismatches.is_empty(),
            "declared source roles differ from direct/helper Salsa reads:\n{}",
            source_mismatches.join("\n")
        );
    }

    #[cfg(feature = "incremental-v2")]
    #[test]
    #[ignore = "development aid: prints the scanned field usage per step"]
    fn dump_scanned_field_use() {
        let query_ids = WORKFLOW_QUERIES
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let scan = super::field_use_scan::scan(&query_ids);
        println!(
            "UNIVERSE {:?}",
            super::field_use_scan::data_field_universe()
        );
        for step in WORKFLOW_QUERIES {
            let use_set = &scan[step.id];
            println!(
                "STEP {}\n  reads   {:?}\n  writes  {:?}\n  columns {:?}",
                step.id, use_set.reads, use_set.writes, use_set.source_columns
            );
        }
    }

    /// Field-level sibling of `declared_query_edges_equal_direct_salsa_query_calls`.
    /// The non-pseudo half of every step's declared field reads and writes must
    /// equal the data fields and supplied source columns its tracked query and
    /// reachable Rust implementation actually touch.
    #[cfg(feature = "incremental-v2")]
    #[test]
    fn declared_field_edges_equal_scanned_field_use() {
        let query_ids = WORKFLOW_QUERIES
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let scan = super::field_use_scan::scan(&query_ids);
        let universe = super::field_use_scan::data_field_universe();

        let mut mismatches = Vec::new();
        for step in WORKFLOW_QUERIES {
            let observed = &scan[step.id];
            let mut expected_reads = observed.reads.clone();
            expected_reads.extend(observed.source_columns.iter().cloned());
            let declared_reads = query_field_reads(step.id)
                .iter()
                .copied()
                .filter(|field| !is_pseudo_field(field))
                .map(str::to_string)
                .collect::<BTreeSet<_>>();
            if declared_reads != expected_reads {
                mismatches.push(format!(
                    "{} reads: declared={declared_reads:?} observed={expected_reads:?}",
                    step.id
                ));
            }
            let declared_writes = query_field_writes(step.id)
                .iter()
                .copied()
                .filter(|field| !is_pseudo_field(field))
                .map(str::to_string)
                .collect::<BTreeSet<_>>();
            if declared_writes != observed.writes {
                mismatches.push(format!(
                    "{} writes: declared={declared_writes:?} observed={:?}",
                    step.id, observed.writes
                ));
            }
        }
        assert!(
            mismatches.is_empty(),
            "declared field edges differ from scanned field use:\n{}",
            mismatches.join("\n")
        );

        // No duplicate or unknown identifiers, and every declared edge points at
        // a field the step actually declares as produced.
        for step in WORKFLOW_QUERIES {
            for list in [query_field_reads(step.id), query_field_writes(step.id)] {
                let unique = list.iter().copied().collect::<BTreeSet<_>>();
                assert_eq!(
                    unique.len(),
                    list.len(),
                    "duplicate field identifier on {}",
                    step.id
                );
                for field in list {
                    assert!(
                        is_pseudo_field(field) || universe.contains(*field) || field.contains('.'),
                        "{}: unknown field identifier {field}",
                        step.id
                    );
                }
            }
            let writes = query_field_writes(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let reads = query_field_reads(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            for edge in query_field_edges(step.id) {
                assert!(
                    writes.contains(edge.to),
                    "{}: edge targets undeclared field {}",
                    step.id,
                    edge.to
                );
                for field in edge.from {
                    assert!(
                        reads.contains(field),
                        "{}: edge into {} reads undeclared field {field}",
                        step.id,
                        edge.to
                    );
                }
            }
        }

        // A partial override table is the dangerous shape: the fields it does
        // list get their real contributors, and the fields it forgets silently
        // fall back to "every read determines it". That fallback is what made
        // `raw_chronicle_csv.username` reach `duration_seconds` through
        // `canonicalize_source_rows`, so a step that overrides at all must name
        // every field it produces, using `&[]` for a constant initializer.
        for step in WORKFLOW_QUERIES {
            let overrides = query_field_edge_overrides(step.id);
            if overrides.is_empty() {
                continue;
            }
            let named = overrides
                .iter()
                .map(|(field, _)| *field)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                named.len(),
                overrides.len(),
                "{}: duplicate field in the edge override table",
                step.id
            );
            let produced = query_field_writes(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            assert_eq!(
                named, produced,
                "{}: the edge override table must name exactly the fields the \
                 step produces; a missing entry silently restores the atomic \
                 every-read-determines-every-write cross for that field",
                step.id
            );
        }

        // Every supplied source column named by a step must belong to a role the
        // step already declares, so the two granularities cannot disagree.
        for step in WORKFLOW_QUERIES {
            let roles = query_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            for field in query_field_reads(step.id) {
                if is_pseudo_field(field) {
                    continue;
                }
                if let Some((role, _column)) = field.split_once('.') {
                    assert!(
                        roles.contains(role),
                        "{} reads {field} but does not declare source role {role}",
                        step.id
                    );
                }
            }
        }
    }

    /// Every declared output cell family must render from fields some step
    /// declares as produced, and must cover the canonical output columns the
    /// writers emit.
    #[test]
    fn output_cell_bindings_cover_the_declared_output_columns() {
        let mut known = WORKFLOW_QUERIES
            .iter()
            .flat_map(|step| query_field_writes(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        // Supplied source columns are read, never produced; a rendered cell may
        // still depend on one directly.
        known.extend(
            WORKFLOW_QUERIES
                .iter()
                .flat_map(|step| query_field_reads(step.id).iter().copied())
                .filter(|field| !is_pseudo_field(field) && field.contains('.')),
        );
        let bindings = output_cell_bindings();
        for binding in &bindings {
            for field in binding.from {
                assert!(
                    known.contains(field),
                    "{}/{} renders from {field}, which no step declares",
                    binding.output_kind,
                    binding.column
                );
            }
            assert!(
                WORKFLOW_QUERIES
                    .iter()
                    .any(|step| step.id == binding.emitting_query),
                "{}/{} names unknown emitting step {}",
                binding.output_kind,
                binding.column,
                binding.emitting_query
            );
        }

        let declared_app = crate::pipeline_v2::declared_app_output_columns(true, true, true, 300.0);
        let declared_screen = crate::pipeline_v2::declared_screen_output_columns();
        for (kind, columns) in [
            ("app-csv", &declared_app),
            ("credited-app-csv", &declared_app),
            ("screen-csv", &declared_screen),
        ] {
            for column in columns {
                assert!(
                    bindings.iter().any(|binding| {
                        binding.output_kind == kind && output_column_matches(binding.column, column)
                    }),
                    "{kind} column {column} has no declared output cell binding"
                );
            }
        }

        // Both `aggregate_shape` values change which columns `summary_csv`
        // writes, so both must be covered.
        for kind in ROW_ADDRESSED_OUTPUT_KINDS
            .iter()
            .filter(|kind| kind.starts_with("aggregate-"))
        {
            for shape in ["wide", "long"] {
                let columns =
                    crate::pipeline_v2::aggregates::declared_aggregate_output_columns(kind, shape);
                assert!(
                    !columns.is_empty(),
                    "{kind} declares no emitted columns for aggregate_shape={shape}"
                );
                for column in columns {
                    assert!(
                        bindings.iter().any(|binding| {
                            binding.output_kind == *kind
                                && output_column_matches(binding.column, column)
                        }),
                        "{kind} column {column} (aggregate_shape={shape}) has no declared \
                         output cell binding"
                    );
                }
            }
        }
    }

    /// A binding column matches an observed column when it is equal, or when
    /// its `*` segments stand in for the numeric/dynamic parts of the name.
    fn output_column_matches(pattern: &str, observed: &str) -> bool {
        let mut parts = pattern.split('*');
        let first = parts.next().unwrap_or_default();
        if !observed.starts_with(first) {
            return false;
        }
        let mut rest = &observed[first.len()..];
        let mut parts = parts.peekable();
        // A pattern with no `*` is an exact column name, not a prefix.
        if parts.peek().is_none() {
            return rest.is_empty();
        }
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                return rest.len() >= part.len() && rest.ends_with(part);
            }
            match rest.find(part) {
                Some(index) => rest = &rest[index + part.len()..],
                None => return false,
            }
        }
        true
    }

    /// The supplied source column a field is a verbatim copy of, re-derived
    /// here straight from the declared field edges. `pure_copy_source` is the
    /// predicate that decides the published membership, so the negative
    /// control below must not call it - re-calling it could only agree with
    /// itself. Every hop of the transitive write chain has to take exactly one
    /// contributor once the field's identity carry onto itself is dropped, no
    /// hop may land on a pseudo-field or on a field nothing declares a write
    /// of, no hop may close a cycle - the declared edges do carry them, for
    /// example `app_package_name` -> `duration_seconds` -> `app_package_name`
    /// through the atomic steps that read and write both - and every branch
    /// has to bottom out at the same supplied column.
    fn write_chain_source(
        field: &'static str,
        writers: &BTreeMap<&'static str, Vec<&'static [&'static str]>>,
        ancestors: &mut Vec<&'static str>,
    ) -> Option<&'static str> {
        if is_supplied_source_column(field) {
            return Some(field);
        }
        if is_pseudo_field(field) || ancestors.contains(&field) {
            return None;
        }
        let edges = writers.get(field)?;
        ancestors.push(field);
        let mut sources = BTreeSet::new();
        let mut every_hop_single = true;
        for from in edges {
            let contributors = from
                .iter()
                .copied()
                .filter(|other| *other != field)
                .collect::<Vec<_>>();
            match contributors.as_slice() {
                [] => {}
                [only] => match write_chain_source(only, writers, ancestors) {
                    Some(source) => {
                        sources.insert(source);
                    }
                    None => {
                        every_hop_single = false;
                        break;
                    }
                },
                _ => {
                    every_hop_single = false;
                    break;
                }
            }
        }
        ancestors.pop();
        let mut sources = sources.into_iter();
        match (every_hop_single, sources.next(), sources.next()) {
            (true, Some(only), None) => Some(only),
            _ => None,
        }
    }

    /// The exact-field class is the only claim in the witness that names a
    /// single source cell. Its membership is pinned here, and the rule behind
    /// it is re-derived from the declared field edges rather than from
    /// `pure_copy_source`, which is the predicate that produced the set:
    /// backwards over `field_writers()` every hop of a claimed cell's write
    /// chain has to take exactly one contributor, and forwards over
    /// `reachable_fields()` the claimed column has to be the only declared
    /// source column that reaches the field.
    #[test]
    fn exact_cell_contributions_are_verbatim_single_source_copies() {
        let contributions = exact_cell_contributions();
        let named = contributions
            .iter()
            .map(|entry| (entry.output_kind, entry.column, entry.source_field))
            .collect::<Vec<_>>();
        assert_eq!(
            named,
            vec![
                ("app-csv", "study_id", "raw_chronicle_csv.study_id"),
                (
                    "app-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                ("credited-app-csv", "study_id", "raw_chronicle_csv.study_id"),
                (
                    "credited-app-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                ("screen-csv", "study_id", "raw_chronicle_csv.study_id"),
                (
                    "screen-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                // `review-summary-json#/participants/*/studyId` and
                // `.../participantId` were here until the review summary's
                // participant addressing was declared. Their *values* are still
                // verbatim copies, but the address they occupy is keyed by both
                // study and participant, so neither is a single-source cell and
                // neither ever produced an exact witness row: exact-field rows
                // are only emitted where kernel row lineage resolves to one
                // output row, which the JSON summary does not have.
            ],
            "the exact-field membership changed; re-derive it from the field \
             edges and explain every added or removed column"
        );

        // Negative side. `pure_copy_source` is the predicate that decided the
        // membership above, so re-calling it here could only agree with
        // itself. Re-derive the rule from the declared edges instead, and do
        // it in both directions: backwards over `field_writers()`, where every
        // hop of the transitive write chain has to take exactly one
        // contributor and every chain has to bottom out at the same supplied
        // column, and forwards over `reachable_fields()`, where that column
        // has to be the only declared source column that reaches the field.
        let writers = field_writers();

        let exact = contributions
            .iter()
            .map(|entry| ((entry.output_kind, entry.column), entry.source_field))
            .collect::<BTreeMap<_, _>>();
        let source_reach = declared_source_columns()
            .into_iter()
            .map(|column| (column, reachable_fields(column)))
            .collect::<Vec<_>>();
        for binding in output_cell_bindings() {
            // A cell rendered from more than one field already carries more
            // than one contributor.
            let single_field = match binding.from {
                [field] => Some(*field),
                _ => None,
            };
            let verbatim =
                single_field.and_then(|field| write_chain_source(field, &writers, &mut Vec::new()));
            assert_eq!(
                exact.get(&(binding.output_kind, binding.column)).copied(),
                verbatim,
                "{}/{} does not agree with the write chain the declared field edges spell out",
                binding.output_kind,
                binding.column
            );
            // Forward direction: the claimed column has to reach the field,
            // and it has to be the only declared source column that does.
            if let (Some(source_field), Some(field)) = (verbatim, single_field) {
                let reaching = source_reach
                    .iter()
                    .filter(|(_, reached)| reached.contains(field))
                    .map(|(column, _)| *column)
                    .collect::<Vec<_>>();
                assert_eq!(
                    reaching,
                    vec![source_field],
                    "{}/{} claims {source_field}, which is not the only declared source column \
                     whose forward closure reaches {field}",
                    binding.output_kind,
                    binding.column
                );
            }
        }
        // `username` is the sharpest negative: it is written verbatim from
        // `raw_chronicle_csv.username` at parse time and then rewritten by
        // `classify_person_attribution` from the survey and sharing supports, so a hop on
        // its chain takes more than one contributor.
        assert_eq!(
            write_chain_source("username", &writers, &mut Vec::new()),
            None,
            "a field a later step rewrites from other inputs is not a verbatim copy"
        );
        // Every exact contribution's source column must be one the contract
        // already declares as read.
        let declared = declared_source_columns()
            .into_iter()
            .collect::<BTreeSet<_>>();
        for entry in &contributions {
            assert!(
                declared.contains(entry.source_field),
                "{}/{} claims {} which no step declares as read",
                entry.output_kind,
                entry.column,
                entry.source_field
            );
        }
    }

    /// The column-granular reach must agree with the whole-artifact reach the
    /// runtime plan already computes: a source column can never reach an output
    /// column outside its own role's declared cells.
    #[test]
    fn source_column_reach_covers_every_declared_source_column() {
        let reach = source_column_output_reach();
        assert_eq!(
            reach
                .iter()
                .map(|entry| entry.source_field)
                .collect::<Vec<_>>(),
            declared_source_columns(),
        );
        let bindings = output_cell_bindings();
        for entry in &reach {
            for cell in &entry.cells {
                assert!(
                    bindings.contains(cell),
                    "{} reaches a cell outside the declared bindings",
                    entry.source_field
                );
            }
        }
        // The three raw columns the parser never reads must stay outside every
        // reach set, which is the field-level non-influence result.
        for column in [
            "raw_chronicle_csv.possible_device_model",
            "raw_chronicle_csv.start_timestamp",
            "raw_chronicle_csv.stop_timestamp",
        ] {
            assert!(
                !reach.iter().any(|entry| entry.source_field == column),
                "{column} is not read by any step and must not have a declared reach"
            );
        }
    }

    /// Every assertion above holds vacuously when the reach sets are empty, and
    /// `output_cell_dependencies` is a filter predicate inside
    /// `source_column_output_reach`, so returning nothing empties every set
    /// rather than failing anything. Three mutants proved it: replacing the
    /// body with `vec![]`, `vec![""]` or `vec!["xyzzy"]` survived the whole
    /// suite. Both directions are pinned here -- the dependency set itself, and
    /// one reach that must not be empty.
    #[test]
    fn output_cell_dependencies_are_the_rendered_fields_plus_the_row_set() {
        let bindings = output_cell_bindings();
        let mut checked_with_fields = 0;
        for binding in &bindings {
            let dependencies = output_cell_dependencies(binding);
            assert_eq!(
                &dependencies[..binding.from.len()],
                binding.from,
                "{}/{} dropped or reordered its rendered fields",
                binding.output_kind,
                binding.column
            );
            // The tail is unconditional in `output_cell_dependencies`, which is
            // only sound while every cell binding is row-addressed. Assert that
            // rather than reproduce the old conditional, whose false arm no
            // binding ever took.
            assert!(
                ROW_ADDRESSED_OUTPUT_KINDS.contains(&binding.output_kind),
                "{}/{} declares a cell family on an output kind that is not \
                 row-addressed, but the row-set tail is appended unconditionally",
                binding.output_kind,
                binding.column
            );
            assert_eq!(
                &dependencies[binding.from.len()..],
                ROW_SET_FIELDS,
                "{}/{} carries the wrong row-set dependency",
                binding.output_kind,
                binding.column
            );
            if !binding.from.is_empty() {
                checked_with_fields += 1;
            }
        }
        assert!(
            checked_with_fields > 0,
            "no binding renders a field, so the prefix assertion proved nothing"
        );

        // The positive direction the reach test never stated: a supplied column
        // the parser does read must reach the output cell it renders.
        let reach = source_column_output_reach();
        let participant = reach
            .iter()
            .find(|entry| entry.source_field == "raw_chronicle_csv.participant_id")
            .expect("participant_id is read and must have a declared reach");
        assert!(
            participant
                .cells
                .iter()
                .any(|cell| { cell.output_kind == "app-csv" && cell.column == "participant_id" }),
            "participant_id must reach the app-csv column it renders"
        );
    }

    /// The exported contract is a product artifact, not internal metadata:
    /// `src/bin/export_workflow_contract.rs` prints exactly these bytes and
    /// `web/scripts/generate_pipeline_graph_artifacts.mts` and
    /// `web/scripts/check_contract_compat.mts` consume them to build the
    /// browser's option panel, group sections, support-file requirements, and
    /// bypass indicators. Nothing in Rust reads `query_group_config_dependencies`,
    /// `query_group_support_roles`, `query_group_applicability`, or `query_applicability`, so
    /// this is the only place a dropped table entry can be observed on this
    /// side of the boundary — and a dropped entry silently removes a control,
    /// a support-file requirement, or a bypass condition from the app.
    #[test]
    fn exported_workflow_contract_is_byte_exact() {
        let mut serialized =
            serde_json::to_vec_pretty(&workflow_contract()).expect("serialize contract");
        serialized.push(b'\n');
        crate::golden::assert_matches("workflow_contract.json", &serialized);
    }

    #[test]
    fn serialized_contract_is_deterministic() {
        let first = serde_json::to_vec(&workflow_contract()).expect("serialize contract");
        let second = serde_json::to_vec(&workflow_contract()).expect("serialize contract");
        assert_eq!(first, second);
    }

    #[test]
    fn every_exact_request_field_is_bound_to_a_query_or_runtime_artifact_target() {
        let options: PipelineV2OptionsJson = serde_json::from_value(serde_json::json!({
            "study_name": "binding-test",
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
            "long_duration_threshold_ns": 1,
            "custom_app_engagement_duration": 1.0,
            "long_data_time_gap_thresholds": [],
            "long_usage_duration_thresholds": [],
            "same_app_stop_types": [],
            "other_stop_types": [],
            "interaction_types_to_remove": [],
            "screen_auto_lock_timeout_seconds": 1.0,
            "screen_auto_lock_tolerance_seconds": 1.0,
            "screen_manual_lock_max_tail_seconds": 1.0,
            "screen_keyguard_near_stop_seconds": 1.0,
            "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC"
        }))
        .unwrap();
        let serialized = serde_json::to_value(options).unwrap();
        let exact_fields = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let mut bound_fields = WORKFLOW_QUERIES
            .iter()
            .flat_map(|step| query_request_fields(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        bound_fields.extend(RUNTIME_ARTIFACT_REQUEST_FIELDS.iter().copied());
        assert_eq!(bound_fields, exact_fields);

        for step in WORKFLOW_QUERIES {
            let fields = query_request_fields(step.id);
            assert_eq!(
                fields.iter().copied().collect::<BTreeSet<_>>().len(),
                fields.len(),
                "duplicate request field binding on {}",
                step.id
            );
            let declared_roles = query_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let conditional_bindings = query_source_role_bindings(step.id);
            let bound_roles = conditional_bindings
                .iter()
                .map(|binding| binding.role)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                bound_roles, declared_roles,
                "source-role bindings drifted for {}",
                step.id
            );
            let request_field_set = fields.iter().copied().collect::<BTreeSet<_>>();
            for predicate in conditional_bindings
                .iter()
                .flat_map(|binding| binding.when_all)
            {
                let request_field = match predicate {
                    QuerySourceRolePredicate::BooleanEquals { request_field, .. }
                    | QuerySourceRolePredicate::StringOneOf { request_field, .. } => *request_field,
                };
                assert!(
                    request_field_set.contains(request_field),
                    "{} source-role condition reads undeclared request field {}",
                    step.id,
                    request_field
                );
            }
        }

        let source_roles = WORKFLOW_QUERIES
            .iter()
            .flat_map(|step| query_source_roles(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            source_roles,
            BTreeSet::from([
                "raw_chronicle_csv",
                "filter_file",
                "apps_forcing_screen_open_file",
                "background_apps_file",
                "app_codebook_file",
                "study_dates_file",
                "device_sharing_file",
                "survey_attribution_file",
                "enrolled_devices_file",
            ])
        );
    }
}
