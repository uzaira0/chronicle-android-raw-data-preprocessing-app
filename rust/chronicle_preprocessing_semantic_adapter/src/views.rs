use crate::materialize::Materialization;
use crate::model::{
    ArtifactRef, ChroniclePlan, MaterializationState, NodeExecution, OpenObligation,
    RoleAssignment, StateReason,
};
use crate::qualify::{QualificationTrace, RoleRequirementTrace};
pub use semprof_materialize::ViewEnvelope;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageNodeState {
    pub node_id: String,
    pub label: String,
    pub section: String,
    pub input_nodes: Vec<String>,
    pub can_bypass: bool,
    pub materialization_state: MaterializationState,
    pub execution_status: Option<crate::model::ExecutionStatus>,
    pub reason_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageStepState {
    pub step_id: String,
    pub unit_id: String,
    pub label: String,
    pub description: String,
    pub input_steps: Vec<String>,
    pub can_bypass: bool,
    pub execution_status: Option<crate::model::ExecutionStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StagePayload {
    pub stage: Option<String>,
    pub node_states: Vec<StageNodeState>,
    pub step_states: Vec<StageStepState>,
}

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

pub fn stage_view(
    plan: &ChroniclePlan,
    materialization: &Materialization,
    executions: &[NodeExecution],
    options: &Value,
    stage: Option<&str>,
    revision: u64,
    root_digest: &str,
) -> ViewEnvelope<StagePayload> {
    let node_states = plan
        .nodes
        .iter()
        .filter(|node| stage.is_none_or(|stage| node.section == stage))
        .map(|node| StageNodeState {
            node_id: node.node_id.clone(),
            label: node.label.clone(),
            section: node.section.clone(),
            input_nodes: node.input_nodes.clone(),
            can_bypass: node.can_bypass,
            materialization_state: materialization
                .node_states
                .get(&node.node_id)
                .copied()
                .unwrap_or(MaterializationState::Open),
            execution_status: executions
                .iter()
                .find(|execution| execution.node_id == node.node_id)
                .map(|execution| execution.status),
            reason_ids: materialization
                .reasons
                .iter()
                .filter(|reason| reason.subject_id == node.node_id)
                .map(|reason| reason.reason_id.clone())
                .collect(),
        })
        .collect();
    let step_states = plan
        .steps
        .iter()
        .filter(|step| {
            stage.is_none_or(|stage| {
                plan.nodes
                    .iter()
                    .find(|node| node.node_id == step.unit_id)
                    .is_some_and(|node| node.section == stage)
            })
        })
        .map(|step| {
            let unit_execution = executions
                .iter()
                .find(|execution| execution.node_id == step.unit_id);
            StageStepState {
                step_id: step.step_id.clone(),
                unit_id: step.unit_id.clone(),
                label: step.label.clone(),
                description: step.description.clone(),
                input_steps: step.input_steps.clone(),
                can_bypass: step.can_bypass,
                execution_status: if !step.applicability.evaluate(options) {
                    Some(crate::model::ExecutionStatus::Bypassed)
                } else {
                    unit_execution.map(|execution| execution.status)
                },
            }
        })
        .collect();
    ViewEnvelope {
        protocol_version: "0.1".into(),
        view_id: "chronicle.stage.v1".into(),
        family: "incremental-dataflow".into(),
        schema_id: "urn:chronicle:view:stage:v1".into(),
        revision,
        root_digest: root_digest.into(),
        payload: StagePayload {
            stage: stage.map(str::to_string),
            node_states,
            step_states,
        },
    }
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
    use std::collections::BTreeMap;

    #[test]
    fn stage_view_is_typed_and_has_no_generic_items_links_payload() {
        let mut materialization = Materialization {
            role_states: BTreeMap::new(),
            node_states: BTreeMap::from([("parse_events".into(), MaterializationState::Ready)]),
            obligations: vec![],
            reasons: vec![],
            qualification_traces: vec![],
            requirement_traces: vec![],
        };
        materialization.reasons.push(StateReason {
            reason_id: "reason:parse".into(),
            subject_id: "parse_events".into(),
            state: MaterializationState::Ready,
            source_id: "plan".into(),
            message: "ready".into(),
        });
        let plan = crate::embedded_plan();
        let executions = vec![NodeExecution {
            node_id: "parse_events".into(),
            capability_id: plan.nodes[0].capability_id.clone(),
            status: crate::model::ExecutionStatus::Recomputed,
            input_key: "input".into(),
            output: None,
            reason_id: "reason:execution".into(),
        }];
        let view = stage_view(
            &plan,
            &materialization,
            &executions,
            &serde_json::json!({}),
            Some("preprocess"),
            1,
            &format!("sha256:{:0>64}", 1),
        );
        assert!(view
            .payload
            .node_states
            .iter()
            .all(|node| node.section == "preprocess"));
        let parse = view
            .payload
            .node_states
            .iter()
            .find(|node| node.node_id == "parse_events")
            .unwrap();
        assert_eq!(
            parse.execution_status,
            Some(crate::model::ExecutionStatus::Recomputed)
        );
        assert_eq!(parse.reason_ids, ["reason:parse"]);
        let parse_steps: Vec<_> = view
            .payload
            .step_states
            .iter()
            .filter(|step| step.unit_id == "parse_events")
            .collect();
        assert!(!parse_steps.is_empty());
        assert!(parse_steps.iter().all(|step| {
            step.execution_status == Some(crate::model::ExecutionStatus::Recomputed)
        }));
        assert!(view.payload.step_states.iter().all(|step| {
            plan.nodes
                .iter()
                .find(|node| node.node_id == step.unit_id)
                .is_some_and(|node| node.section == "preprocess")
        }));
        assert!(view
            .payload
            .step_states
            .iter()
            .any(|step| step.execution_status == Some(crate::model::ExecutionStatus::Bypassed)));
        let value = encode_view(&view);
        let payload = &value["payload"];
        assert!(payload.get("node_states").is_some());
        assert!(payload.get("items").is_none());
        assert!(payload.get("links").is_none());
    }

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
            node_id: Some("app_policy".into()),
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
