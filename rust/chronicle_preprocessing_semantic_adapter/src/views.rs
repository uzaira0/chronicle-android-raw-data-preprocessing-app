use crate::materialize::Materialization;
use crate::model::{
    ArtifactRef, MaterializationState, NodeExecution, OpenObligation, RoleAssignment, StateReason,
};
pub use semprof_materialize::ViewEnvelope;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageNodeState {
    pub node_id: String,
    pub materialization_state: MaterializationState,
    pub execution_status: Option<crate::model::ExecutionStatus>,
    pub reason_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StagePayload {
    pub stage: Option<String>,
    pub node_states: Vec<StageNodeState>,
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
}

pub fn stage_view(
    materialization: &Materialization,
    executions: &[NodeExecution],
    stage: Option<&str>,
    revision: u64,
    root_digest: &str,
) -> ViewEnvelope<StagePayload> {
    let node_states = materialization
        .node_states
        .iter()
        .map(|(node_id, state)| StageNodeState {
            node_id: node_id.clone(),
            materialization_state: *state,
            execution_status: executions
                .iter()
                .find(|execution| execution.node_id == *node_id)
                .map(|execution| execution.status),
            reason_ids: materialization
                .reasons
                .iter()
                .filter(|reason| reason.subject_id == *node_id)
                .map(|reason| reason.reason_id.clone())
                .collect(),
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
        let materialization = Materialization {
            role_states: BTreeMap::new(),
            node_states: BTreeMap::from([("parse_events".into(), MaterializationState::Ready)]),
            obligations: vec![],
            reasons: vec![],
        };
        let value = encode_view(&stage_view(
            &materialization,
            &[],
            Some("preprocess"),
            1,
            &format!("sha256:{:0>64}", 1),
        ));
        let payload = &value["payload"];
        assert!(payload.get("node_states").is_some());
        assert!(payload.get("items").is_none());
        assert!(payload.get("links").is_none());
    }
}
