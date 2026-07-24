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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DependencyCertificate {
    pub protocol_version: String,
    pub certificate_id: String,
    pub structural_contract: DependencyStructuralContract,
    pub evidence: DependencyEvidence,
    pub narrowing_policy: BTreeMap<String, String>,
    pub claim_boundary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DependencyStructuralContract {
    pub plan_digest: String,
    pub configuration_axes: BTreeMap<String, Vec<String>>,
    pub cache_relevant_option_keys: Vec<String>,
    pub excluded_option_keys: Vec<String>,
    pub role_ids: Vec<String>,
    pub binding_surface: Value,
    pub binding_surface_digest: String,
    pub unclassified_option_keys: Vec<String>,
    pub unbound_role_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DependencyEvidence {
    pub implementation_receipt: DependencyImplementationReceipt,
    pub proof_ledgers: Vec<DependencyProofLedger>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyImplementationReceipt {
    pub implementation: String,
    pub implementation_digest: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub runtime_authority_digest: String,
    pub product_contract_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependencyProofLedger {
    pub path: String,
    pub digest: String,
    pub protocol_version: String,
    pub claim_boundary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyCacheMode {
    CertifiedNarrow,
    ConservativeFull,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependencyCacheDecision {
    pub mode: DependencyCacheMode,
    pub certificate_digest: Option<String>,
    pub binding_surface_digest: Option<String>,
    pub empirical_evidence_current: bool,
    pub reasons: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conditions_cover_boolean_array_composition_and_negation() {
        let options = serde_json::json!({"on": true, "off": false, "values": [1]});
        let on = Condition::OptionTrue {
            option_key: "on".into(),
        };
        let missing = Condition::OptionTrue {
            option_key: "missing".into(),
        };
        let values = Condition::ArrayNonempty {
            option_key: "values".into(),
        };
        assert!(Condition::Always.evaluate(&options));
        assert!(on.evaluate(&options));
        assert!(!missing.evaluate(&options));
        assert!(values.evaluate(&options));
        assert!(Condition::All {
            terms: vec![on.clone(), values.clone()]
        }
        .evaluate(&options));
        assert!(Condition::Any {
            terms: vec![missing.clone(), values]
        }
        .evaluate(&options));
        assert!(Condition::Not {
            term: Box::new(missing)
        }
        .evaluate(&options));
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
    pub implementation_status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanStep {
    pub step_id: String,
    pub unit_id: String,
    pub label: String,
    pub description: String,
    pub capability_id: String,
    pub input_steps: Vec<String>,
    #[serde(default)]
    pub request_fields: Vec<String>,
    #[serde(default)]
    pub source_role_bindings: Vec<PlanStepSourceRoleBinding>,
    pub applicability: Condition,
    pub can_bypass: bool,
    pub binding_set_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanStepSourceRoleBinding {
    pub role: String,
    pub when_all: Vec<PlanStepSourceRolePredicate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "operator", rename_all = "snake_case")]
pub enum PlanStepSourceRolePredicate {
    BooleanEquals {
        request_field: String,
        value: bool,
    },
    StringOneOf {
        request_field: String,
        values: Vec<String>,
    },
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
    #[error("artifact store error: {0}")]
    Storage(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}
