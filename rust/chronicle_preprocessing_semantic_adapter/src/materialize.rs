use crate::model::{
    ChroniclePlan, MaterializationState, OpenObligation, RoleAssignment, StateReason,
};
use petgraph::algo::toposort;
use petgraph::graphmap::DiGraphMap;
use semprof_materialize::{
    materialize_roles, Cardinality as SharedCardinality, FulfillmentState, Requirement,
    RoleAssignment as SharedAssignment, RoleSpec,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Materialization {
    pub role_states: BTreeMap<String, MaterializationState>,
    pub node_states: BTreeMap<String, MaterializationState>,
    pub obligations: Vec<OpenObligation>,
    pub reasons: Vec<StateReason>,
}

fn identifier(parts: &[&str]) -> String {
    let joined = parts.join("\u{1f}");
    format!("sha256:{}", hex::encode(Sha256::digest(joined.as_bytes())))
}

pub fn evaluate_materialization(
    plan: &ChroniclePlan,
    assignments: &BTreeMap<String, RoleAssignment>,
    options: &Value,
    satisfied_nodes: &BTreeSet<String>,
    invalid_nodes: &BTreeSet<String>,
) -> Materialization {
    let mut role_states = BTreeMap::new();
    let mut obligations = Vec::new();
    let mut reasons = Vec::new();

    let shared_specs: Vec<_> = plan
        .root_roles
        .iter()
        .map(|role| {
            let required = role.required
                || role
                    .required_when
                    .as_ref()
                    .is_some_and(|condition| condition.evaluate(options));
            RoleSpec {
                role_id: role.role_id.clone(),
                cardinality: SharedCardinality {
                    minimum: if required {
                        role.cardinality.minimum.max(1)
                    } else {
                        role.cardinality.minimum
                    },
                    maximum: role.cardinality.maximum,
                },
                accepted_media_types: role.media_types.clone(),
            }
        })
        .collect();
    let shared_assignments: Vec<_> = assignments
        .values()
        .map(|assignment| SharedAssignment {
            assignment_id: assignment.assignment_id.clone(),
            role_id: assignment.role_id.clone(),
            artifact: semprof_core::ArtifactRef {
                artifact_id: assignment.artifact.artifact_id.clone(),
                digest: assignment.artifact.digest.clone(),
                media_type: assignment.artifact.media_type.clone(),
                size: assignment.artifact.size,
                derived_from: assignment.artifact.derived_from.clone(),
            },
            qualifiers: assignment.qualifiers.clone(),
            revision: assignment.revision,
        })
        .collect();
    let shared_report = materialize_roles(&shared_specs, &shared_assignments, |role_id| {
        let role = plan
            .root_roles
            .iter()
            .find(|role| role.role_id == role_id)
            .expect("shared specs originate from the product plan");
        if role.required
            || role
                .required_when
                .as_ref()
                .is_some_and(|condition| condition.evaluate(options))
        {
            Requirement::Required
        } else {
            Requirement::Optional
        }
    })
    .expect("product plan and assignment identities were validated before evaluation");

    for shared in shared_report.role_states {
        let state = match shared.state {
            FulfillmentState::Open => MaterializationState::Open,
            FulfillmentState::Satisfied => MaterializationState::Satisfied,
            FulfillmentState::Invalid => MaterializationState::Invalid,
            FulfillmentState::NotApplicable => MaterializationState::NotApplicable,
        };
        role_states.insert(shared.role_id.clone(), state);
        if matches!(
            state,
            MaterializationState::Open | MaterializationState::Invalid
        ) {
            let reason_id = identifier(&["role-state", &shared.role_id, &format!("{state:?}")]);
            obligations.push(OpenObligation {
                obligation_id: identifier(&["obligation", &shared.role_id]),
                role_id: shared.role_id.clone(),
                node_id: None,
                state,
                reason_id: reason_id.clone(),
            });
            reasons.push(StateReason {
                reason_id,
                subject_id: shared.role_id.clone(),
                state,
                source_id: plan.plan_id.clone(),
                message: format!(
                    "role {} is not fulfilled by a valid assignment",
                    shared.role_id
                ),
            });
        }
    }

    let mut graph = DiGraphMap::<&str, ()>::new();
    for node in &plan.nodes {
        graph.add_node(&node.node_id);
        for input in &node.input_nodes {
            graph.add_edge(input, &node.node_id, ());
        }
    }
    let order = toposort(&graph, None).expect("build.rs rejected plan cycles");
    let by_id: BTreeMap<_, _> = plan
        .nodes
        .iter()
        .map(|node| (node.node_id.as_str(), node))
        .collect();
    let mut node_states = BTreeMap::new();
    for node_id in order {
        let node = by_id[node_id];
        let applicable = node.applicability.evaluate(options);
        let missing_support: Vec<_> = node
            .support_roles
            .iter()
            .filter(|role| role_states.get(*role) == Some(&MaterializationState::Open))
            .cloned()
            .collect();
        let missing_root = node_id == "parse_events"
            && ["raw_chronicle_csv", "processing_options"]
                .iter()
                .any(|role| role_states.get(*role) == Some(&MaterializationState::Open));
        let upstream_invalid = node.input_nodes.iter().any(|input| {
            matches!(
                node_states.get(input),
                Some(MaterializationState::Invalid | MaterializationState::Blocked)
            )
        });
        let upstream_pending = node.input_nodes.iter().any(|input| {
            !matches!(
                node_states.get(input),
                Some(MaterializationState::Satisfied | MaterializationState::NotApplicable)
            )
        });
        let state = if invalid_nodes.contains(node_id) {
            MaterializationState::Invalid
        } else if !applicable && node.can_bypass {
            MaterializationState::NotApplicable
        } else if !missing_support.is_empty() || missing_root {
            MaterializationState::Open
        } else if upstream_invalid || upstream_pending {
            MaterializationState::Blocked
        } else if satisfied_nodes.contains(node_id) {
            MaterializationState::Satisfied
        } else {
            MaterializationState::Ready
        };
        node_states.insert(node_id.to_string(), state);
        let reason_id = identifier(&["node-state", node_id, &format!("{state:?}")]);
        reasons.push(StateReason {
            reason_id: reason_id.clone(),
            subject_id: node_id.to_string(),
            state,
            source_id: node.capability_id.clone(),
            message: match state {
                MaterializationState::Open => format!(
                    "node {node_id} is missing roles: {}",
                    missing_support.join(",")
                ),
                MaterializationState::Blocked => {
                    format!("node {node_id} is waiting on an upstream node")
                }
                MaterializationState::Ready => format!("node {node_id} is ready to execute"),
                MaterializationState::Satisfied => {
                    format!("node {node_id} has a materialized output")
                }
                MaterializationState::Invalid => format!("node {node_id} is invalid"),
                MaterializationState::NotApplicable => {
                    format!("node {node_id} is bypassed by current options")
                }
            },
        });
        for role_id in missing_support {
            obligations.push(OpenObligation {
                obligation_id: identifier(&["node-obligation", node_id, &role_id]),
                role_id,
                node_id: Some(node_id.to_string()),
                state: MaterializationState::Open,
                reason_id: reason_id.clone(),
            });
        }
    }

    Materialization {
        role_states,
        node_states,
        obligations,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{embedded_plan, ArtifactRef, RoleAssignment};

    fn assignment(role: &str) -> RoleAssignment {
        RoleAssignment {
            assignment_id: format!("assignment:{role}"),
            role_id: role.to_string(),
            artifact: ArtifactRef {
                artifact_id: format!("artifact:{role}"),
                digest: format!("sha256:{:0>64}", role.len()),
                media_type: if role == "processing_options" {
                    "application/json"
                } else {
                    "text/csv"
                }
                .to_string(),
                size: 1,
                derived_from: vec![],
                qualifiers: BTreeMap::new(),
            },
            qualifiers: BTreeMap::new(),
            revision: 1,
        }
    }

    #[test]
    fn missing_conditionally_required_support_file_is_an_explicit_hole() {
        let plan = embedded_plan();
        let assignments = BTreeMap::from([
            ("raw_chronicle_csv".into(), assignment("raw_chronicle_csv")),
            (
                "processing_options".into(),
                assignment("processing_options"),
            ),
        ]);
        let options = serde_json::json!({
            "process_app_usage": true,
            "process_screen_usage": false,
            "use_filter_file": true
        });
        let result = evaluate_materialization(
            &plan,
            &assignments,
            &options,
            &BTreeSet::new(),
            &BTreeSet::new(),
        );
        assert_eq!(
            result.role_states["filter_file"],
            MaterializationState::Open
        );
        assert!(result
            .obligations
            .iter()
            .any(|obligation| obligation.role_id == "filter_file"));
        assert_eq!(result.node_states["app_policy"], MaterializationState::Open);
    }

    #[test]
    fn disabled_family_branch_is_not_applicable_instead_of_missing() {
        let result = evaluate_materialization(
            &embedded_plan(),
            &BTreeMap::new(),
            &serde_json::json!({"process_screen_usage": false}),
            &BTreeSet::new(),
            &BTreeSet::new(),
        );
        assert_eq!(
            result.node_states["device_state_timeline"],
            MaterializationState::NotApplicable
        );
    }
}
