use crate::model::{ArtifactRef, OpenObligation, RoleAssignment, StateReason};
use crate::qualify::{QualificationTrace, RoleRequirementTrace};
pub use semprof_materialize::ViewEnvelope;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArtifactPayload {
    pub artifacts: Vec<ArtifactRef>,
    pub assignments: Vec<RoleAssignment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObligationPayload {
    pub obligations: Vec<OpenObligation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplanationPayload {
    pub transitions: Vec<StateReason>,
    pub qualification_traces: Vec<QualificationTrace>,
    pub requirement_traces: Vec<RoleRequirementTrace>,
}

pub fn artifact_view(
    artifacts: Vec<ArtifactRef>,
    assignments: Vec<RoleAssignment>,
    revision: u64,
    root_digest: &str,
) -> ViewEnvelope<ArtifactPayload> {
    ViewEnvelope {
        protocol_version: "0.1".into(),
        view_id: "chronicle.artifact.v1".into(),
        family: "incremental-dataflow".into(),
        schema_id: "urn:chronicle:view:artifact:v1".into(),
        revision,
        root_digest: root_digest.into(),
        payload: ArtifactPayload {
            artifacts,
            assignments,
        },
    }
}

pub fn obligation_view(
    obligations: Vec<OpenObligation>,
    revision: u64,
    root_digest: &str,
) -> ViewEnvelope<ObligationPayload> {
    ViewEnvelope {
        protocol_version: "0.1".into(),
        view_id: "chronicle.obligation.v1".into(),
        family: "incremental-dataflow".into(),
        schema_id: "urn:chronicle:view:obligation:v1".into(),
        revision,
        root_digest: root_digest.into(),
        payload: ObligationPayload { obligations },
    }
}

pub fn explanation_view(
    transitions: Vec<StateReason>,
    qualification_traces: Vec<QualificationTrace>,
    requirement_traces: Vec<RoleRequirementTrace>,
    revision: u64,
    root_digest: &str,
) -> ViewEnvelope<ExplanationPayload> {
    ViewEnvelope {
        protocol_version: "0.1".into(),
        view_id: "chronicle.explanation.v1".into(),
        family: "incremental-dataflow".into(),
        schema_id: "urn:chronicle:view:explanation:v1".into(),
        revision,
        root_digest: root_digest.into(),
        payload: ExplanationPayload {
            transitions,
            qualification_traces,
            requirement_traces,
        },
    }
}

pub fn encode_view<T: Serialize>(view: &ViewEnvelope<T>) -> Value {
    serde_json::to_value(view).expect("typed view is serializable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MaterializationState;
    use std::collections::BTreeMap;

    #[test]
    fn artifact_obligation_and_explanation_views_keep_family_specific_payloads() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let artifact = ArtifactRef {
            artifact_id: "urn:artifact:1".into(),
            digest: digest.clone(),
            media_type: "text/csv".into(),
            size: 3,
            derived_from: vec![],
            qualifiers: BTreeMap::new(),
        };
        let assignment = RoleAssignment {
            assignment_id: "assignment:1".into(),
            role_id: "raw_chronicle_csv".into(),
            artifact: artifact.clone(),
            qualifiers: BTreeMap::new(),
            revision: 1,
        };
        let obligation = OpenObligation {
            obligation_id: "obligation:1".into(),
            role_id: "filter_file".into(),
            query_group_id: Some("app_policy".into()),
            state: MaterializationState::Open,
            reason_id: "reason:1".into(),
        };
        let reason = StateReason {
            reason_id: "reason:1".into(),
            subject_id: "app_policy".into(),
            state: MaterializationState::Open,
            source_id: "plan:1".into(),
            message: "filter file missing".into(),
        };
        let artifact_value =
            encode_view(&artifact_view(vec![artifact], vec![assignment], 2, &digest));
        assert_eq!(artifact_value["view_id"], "chronicle.artifact.v1");
        assert_eq!(
            artifact_value["payload"]["artifacts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let obligation_value = encode_view(&obligation_view(vec![obligation], 3, &digest));
        assert_eq!(obligation_value["view_id"], "chronicle.obligation.v1");
        let explanation_value =
            encode_view(&explanation_view(vec![reason], vec![], vec![], 4, &digest));
        assert_eq!(explanation_value["view_id"], "chronicle.explanation.v1");
        assert_eq!(
            explanation_value["payload"]["transitions"][0]["message"],
            "filter file missing"
        );
    }
}
