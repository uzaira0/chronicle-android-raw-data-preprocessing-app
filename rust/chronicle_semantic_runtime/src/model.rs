use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChroniclePlan {
    pub protocol_version: String,
    pub plan_id: String,
    pub revision: String,
    pub family: String,
    pub root_roles: Vec<RootRole>,
    pub nodes: Vec<PlanNode>,
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cardinality {
    pub minimum: usize,
    pub maximum: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RootRole {
    pub role_id: String,
    pub cardinality: Cardinality,
    pub media_types: Vec<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub required_when: Option<Condition>,
    #[serde(default)]
    pub qualification: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Condition {
    Always,
    OptionTrue { option_key: String },
    ArrayNonempty { option_key: String },
    All { terms: Vec<Condition> },
    Any { terms: Vec<Condition> },
    Not { term: Box<Condition> },
}

impl Condition {
    pub fn evaluate(&self, options: &Value) -> bool {
        match self {
            Self::Always => true,
            Self::OptionTrue { option_key } => options
                .get(option_key)
                .and_then(Value::as_bool)
                .unwrap_or(false),
            Self::ArrayNonempty { option_key } => options
                .get(option_key)
                .and_then(Value::as_array)
                .is_some_and(|values| !values.is_empty()),
            Self::All { terms } => terms.iter().all(|term| term.evaluate(options)),
            Self::Any { terms } => terms.iter().any(|term| term.evaluate(options)),
            Self::Not { term } => !term.evaluate(options),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnobBinding {
    pub option_key: String,
    pub edge: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanNode {
    pub node_id: String,
    pub label: String,
    pub section: String,
    pub capability_id: String,
    pub input_nodes: Vec<String>,
    pub output_role: String,
    pub knobs: Vec<KnobBinding>,
    pub support_roles: Vec<String>,
    pub applicability: Condition,
    pub can_bypass: bool,
    pub early_cutoff: bool,
    pub determinism: String,
    pub migration_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStep {
    pub step_id: String,
    pub unit_id: String,
    pub capability_id: String,
    pub input_steps: Vec<String>,
    pub target_registry: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub artifact_id: String,
    pub digest: String,
    pub media_type: String,
    pub size: u64,
    #[serde(default)]
    pub derived_from: Vec<String>,
    #[serde(default)]
    pub qualifiers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoleAssignment {
    pub assignment_id: String,
    pub role_id: String,
    pub artifact: ArtifactRef,
    #[serde(default)]
    pub qualifiers: BTreeMap<String, String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterializationState {
    Open,
    Ready,
    Satisfied,
    Blocked,
    Invalid,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Cached,
    Recomputed,
    Error,
    Skipped,
    Bypassed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenObligation {
    pub obligation_id: String,
    pub role_id: String,
    pub node_id: Option<String>,
    pub state: MaterializationState,
    pub reason_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateReason {
    pub reason_id: String,
    pub subject_id: String,
    pub state: MaterializationState,
    pub source_id: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeCacheEntry {
    pub input_key: String,
    pub output: ArtifactRef,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeExecution {
    pub node_id: String,
    pub capability_id: String,
    pub status: ExecutionStatus,
    pub input_key: String,
    pub output: Option<ArtifactRef>,
    pub reason_id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("unknown role: {0}")]
    UnknownRole(String),
    #[error("role {role} does not accept media type {media_type}")]
    InvalidMediaType { role: String, media_type: String },
    #[error("role {0} exceeds its maximum cardinality")]
    Cardinality(String),
    #[error("missing required role: {0}")]
    MissingRole(String),
    #[error("unknown node capability: {0}")]
    UnknownCapability(String),
    #[error("capability {capability} failed: {message}")]
    Capability { capability: String, message: String },
    #[error("artifact store error: {0}")]
    Storage(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}
