use crate::capabilities::{node_binding, PhysicalStage};
use crate::materialize::evaluate_materialization;
use crate::model::{
    ArtifactRef, ChroniclePlan, ExecutionStatus, MaterializationState, NodeCacheEntry,
    NodeExecution, RoleAssignment, RuntimeError,
};
use crate::storage::ArtifactStore;
use petgraph::algo::toposort;
use petgraph::graphmap::DiGraphMap;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct ProducedArtifact {
    pub media_type: String,
    pub bytes: Vec<u8>,
}

pub struct ExecutionInputs<'a> {
    pub node_id: &'a str,
    pub upstream: BTreeMap<&'a str, &'a ArtifactRef>,
    pub support: BTreeMap<&'a str, &'a ArtifactRef>,
    pub raw: Option<&'a ArtifactRef>,
    pub options: &'a Value,
}

pub trait CapabilityExecutor {
    fn execute(
        &mut self,
        stage: PhysicalStage,
        inputs: &ExecutionInputs<'_>,
    ) -> Result<ProducedArtifact, String>;
}

#[derive(Debug, Clone)]
pub struct Workspace<S> {
    pub revision: u64,
    pub assignments: BTreeMap<String, RoleAssignment>,
    pub options: Value,
    pub cache: BTreeMap<String, NodeCacheEntry>,
    pub store: S,
}

impl<S: Default> Default for Workspace<S> {
    fn default() -> Self {
        Self {
            revision: 0,
            assignments: BTreeMap::new(),
            options: Value::Object(Default::default()),
            cache: BTreeMap::new(),
            store: S::default(),
        }
    }
}

impl<S: ArtifactStore> Workspace<S> {
    pub fn assign(
        &mut self,
        plan: &ChroniclePlan,
        role_id: &str,
        artifact: ArtifactRef,
    ) -> Result<(), RuntimeError> {
        let role = plan
            .root_roles
            .iter()
            .find(|role| role.role_id == role_id)
            .ok_or_else(|| RuntimeError::UnknownRole(role_id.to_string()))?;
        if !role
            .media_types
            .iter()
            .any(|media| media == &artifact.media_type)
        {
            return Err(RuntimeError::InvalidMediaType {
                role: role_id.to_string(),
                media_type: artifact.media_type,
            });
        }
        if role.cardinality.maximum == 0 {
            return Err(RuntimeError::Cardinality(role_id.to_string()));
        }
        self.revision += 1;
        self.assignments.insert(
            role_id.to_string(),
            RoleAssignment {
                assignment_id: stable_id(&["assignment", role_id, &artifact.digest]),
                role_id: role_id.to_string(),
                artifact,
                qualifiers: BTreeMap::new(),
                revision: self.revision,
            },
        );
        Ok(())
    }
}

pub struct Scheduler {
    plan: ChroniclePlan,
    order: Vec<String>,
}

impl Scheduler {
    pub fn new(plan: ChroniclePlan) -> Self {
        let mut graph = DiGraphMap::<&str, ()>::new();
        for node in &plan.nodes {
            graph.add_node(&node.node_id);
            for input in &node.input_nodes {
                graph.add_edge(input, &node.node_id, ());
            }
        }
        let order = toposort(&graph, None)
            .expect("build.rs rejected plan cycles")
            .into_iter()
            .map(str::to_string)
            .collect();
        Self { plan, order }
    }

    pub fn run<S: ArtifactStore, E: CapabilityExecutor>(
        &self,
        workspace: &mut Workspace<S>,
        executor: &mut E,
    ) -> Result<Vec<NodeExecution>, RuntimeError> {
        let initial_satisfied: BTreeSet<_> = workspace.cache.keys().cloned().collect();
        let requirements = evaluate_materialization(
            &self.plan,
            &workspace.assignments,
            &workspace.options,
            &initial_satisfied,
            &BTreeSet::new(),
        );
        let by_id: BTreeMap<_, _> = self
            .plan
            .nodes
            .iter()
            .map(|node| (node.node_id.as_str(), node))
            .collect();
        let mut failed = BTreeSet::new();
        let mut executions = Vec::new();

        for node_id in &self.order {
            let node = by_id[node_id.as_str()];
            let blocked = node.input_nodes.iter().any(|input| failed.contains(input));
            let requirement_state = requirements.node_states[&node.node_id];
            if blocked || requirement_state == MaterializationState::Open {
                failed.insert(node.node_id.clone());
                workspace.cache.remove(&node.node_id);
                executions.push(NodeExecution {
                    node_id: node.node_id.clone(),
                    capability_id: node.capability_id.clone(),
                    status: ExecutionStatus::Skipped,
                    input_key: String::new(),
                    output: None,
                    reason_id: stable_id(&["skipped", &node.node_id, "blocked-or-open"]),
                });
                continue;
            }

            let binding = node_binding(&node.capability_id)
                .ok_or_else(|| RuntimeError::UnknownCapability(node.capability_id.clone()))?;
            let inputs = self.execution_inputs(workspace, node);
            let input_key = input_key(node, &inputs)?;
            let bypassed = !node.applicability.evaluate(&workspace.options) && node.can_bypass;
            if let Some(cached) = workspace.cache.get(&node.node_id) {
                if cached.input_key == input_key {
                    executions.push(NodeExecution {
                        node_id: node.node_id.clone(),
                        capability_id: node.capability_id.clone(),
                        status: if bypassed {
                            ExecutionStatus::Bypassed
                        } else {
                            ExecutionStatus::Cached
                        },
                        input_key,
                        output: Some(cached.output.clone()),
                        reason_id: stable_id(&["cache-hit", &node.node_id, &cached.output.digest]),
                    });
                    continue;
                }
            }

            match executor.execute(binding.stage, &inputs) {
                Ok(produced) => {
                    let derived_from = inputs
                        .upstream
                        .values()
                        .chain(inputs.support.values())
                        .map(|artifact| artifact.digest.clone())
                        .chain(inputs.raw.map(|artifact| artifact.digest.clone()))
                        .collect();
                    let output =
                        workspace
                            .store
                            .put(&produced.media_type, produced.bytes, derived_from)?;
                    workspace.revision += 1;
                    workspace.cache.insert(
                        node.node_id.clone(),
                        NodeCacheEntry {
                            input_key: input_key.clone(),
                            output: output.clone(),
                            revision: workspace.revision,
                        },
                    );
                    executions.push(NodeExecution {
                        node_id: node.node_id.clone(),
                        capability_id: node.capability_id.clone(),
                        status: if bypassed {
                            ExecutionStatus::Bypassed
                        } else {
                            ExecutionStatus::Recomputed
                        },
                        input_key,
                        output: Some(output.clone()),
                        reason_id: stable_id(&["executed", &node.node_id, &output.digest]),
                    });
                }
                Err(message) => {
                    failed.insert(node.node_id.clone());
                    workspace.cache.remove(&node.node_id);
                    executions.push(NodeExecution {
                        node_id: node.node_id.clone(),
                        capability_id: node.capability_id.clone(),
                        status: ExecutionStatus::Error,
                        input_key,
                        output: None,
                        reason_id: stable_id(&["error", &node.node_id, &message]),
                    });
                }
            }
        }
        Ok(executions)
    }

    fn execution_inputs<'a, S>(
        &self,
        workspace: &'a Workspace<S>,
        node: &'a crate::model::PlanNode,
    ) -> ExecutionInputs<'a> {
        let upstream = node
            .input_nodes
            .iter()
            .filter_map(|input| {
                workspace
                    .cache
                    .get(input)
                    .map(|entry| (input.as_str(), &entry.output))
            })
            .collect();
        let support = node
            .support_roles
            .iter()
            .filter_map(|role| {
                workspace
                    .assignments
                    .get(role)
                    .map(|assignment| (role.as_str(), &assignment.artifact))
            })
            .collect();
        ExecutionInputs {
            node_id: &node.node_id,
            upstream,
            support,
            raw: (node.node_id == "parse_events")
                .then(|| {
                    workspace
                        .assignments
                        .get("raw_chronicle_csv")
                        .map(|assignment| &assignment.artifact)
                })
                .flatten(),
            options: &workspace.options,
        }
    }
}

#[derive(Serialize)]
struct KeyMaterial<'a> {
    upstream: BTreeMap<&'a str, &'a str>,
    options: BTreeMap<&'a str, &'a Value>,
    support: BTreeMap<&'a str, &'a str>,
    raw: Option<&'a str>,
}

fn input_key(
    node: &crate::model::PlanNode,
    inputs: &ExecutionInputs<'_>,
) -> Result<String, RuntimeError> {
    let material = KeyMaterial {
        upstream: inputs
            .upstream
            .iter()
            .map(|(id, artifact)| (*id, artifact.digest.as_str()))
            .collect(),
        options: node
            .knobs
            .iter()
            .filter_map(|knob| {
                inputs
                    .options
                    .get(&knob.option_key)
                    .map(|value| (knob.option_key.as_str(), value))
            })
            .collect(),
        support: inputs
            .support
            .iter()
            .map(|(role, artifact)| (*role, artifact.digest.as_str()))
            .collect(),
        raw: inputs.raw.map(|artifact| artifact.digest.as_str()),
    };
    let bytes = serde_jcs::to_vec(&material)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn stable_id(parts: &[&str]) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(parts.join("\u{1f}").as_bytes()))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{embedded_plan, ArtifactStore, MemoryCas};

    #[derive(Default)]
    struct EchoExecutor {
        calls: Vec<PhysicalStage>,
    }

    impl CapabilityExecutor for EchoExecutor {
        fn execute(
            &mut self,
            stage: PhysicalStage,
            inputs: &ExecutionInputs<'_>,
        ) -> Result<ProducedArtifact, String> {
            self.calls.push(stage);
            let body = serde_json::to_vec(&serde_json::json!({
                "node": inputs.node_id,
                "upstream": inputs.upstream.values().map(|value| &value.digest).collect::<Vec<_>>(),
                "raw": inputs.raw.map(|value| &value.digest)
            }))
            .unwrap();
            Ok(ProducedArtifact {
                media_type: "application/json".into(),
                bytes: body,
            })
        }
    }

    fn assign_required(workspace: &mut Workspace<MemoryCas>, plan: &ChroniclePlan) {
        for (role, media, bytes) in [
            ("raw_chronicle_csv", "text/csv", b"raw".as_slice()),
            ("processing_options", "application/json", b"{}".as_slice()),
        ] {
            let artifact = workspace.store.put(media, bytes.to_vec(), vec![]).unwrap();
            workspace.assign(plan, role, artifact).unwrap();
        }
    }

    #[test]
    fn warm_run_is_cached_and_raw_change_recomputes_the_reachable_graph() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: serde_json::json!({
                "process_app_usage": true,
                "process_screen_usage": true,
                "use_filter_file": false,
                "use_app_codebook": false,
                "enable_screen_gated_crediting": false,
                "enable_study_window_filter": false,
                "enable_person_attribution": false,
                "add_no_activity_placeholder_days": false,
                "enable_day_coverage": false,
                "enable_compliance_scoring": false,
                "interaction_types_to_remove": [],
                "filter_zero_duration_sessions": false
            }),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let mut executor = EchoExecutor::default();
        let cold = scheduler.run(&mut workspace, &mut executor).unwrap();
        assert!(cold
            .iter()
            .any(|run| run.status == ExecutionStatus::Recomputed));

        executor.calls.clear();
        let warm = scheduler.run(&mut workspace, &mut executor).unwrap();
        assert!(warm.iter().all(|run| matches!(
            run.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed
        )));
        assert!(executor.calls.is_empty());

        let raw = workspace
            .store
            .put("text/csv", b"changed".to_vec(), vec![])
            .unwrap();
        workspace.assign(&plan, "raw_chronicle_csv", raw).unwrap();
        let changed = scheduler.run(&mut workspace, &mut executor).unwrap();
        assert_eq!(changed[0].node_id, "parse_events");
        assert_eq!(changed[0].status, ExecutionStatus::Recomputed);
        assert!(!executor.calls.is_empty());
    }

    #[test]
    fn irrelevant_option_does_not_invalidate_computational_nodes() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: serde_json::json!({
                "process_app_usage": false,
                "process_screen_usage": false
            }),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let mut executor = EchoExecutor::default();
        scheduler.run(&mut workspace, &mut executor).unwrap();
        executor.calls.clear();
        workspace.options["enable_plotting"] = Value::Bool(true);
        scheduler.run(&mut workspace, &mut executor).unwrap();
        assert!(executor.calls.is_empty());
    }

    #[test]
    fn support_change_recomputes_its_owner_but_unchanged_output_cuts_off_descendants() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: serde_json::json!({
                "process_app_usage": true,
                "process_screen_usage": true,
                "use_filter_file": true,
                "use_app_codebook": false,
                "enable_screen_gated_crediting": false,
                "enable_study_window_filter": false,
                "enable_person_attribution": false,
                "add_no_activity_placeholder_days": false,
                "enable_day_coverage": false,
                "enable_compliance_scoring": false,
                "interaction_types_to_remove": [],
                "filter_zero_duration_sessions": false
            }),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let filter = workspace
            .store
            .put("text/csv", b"first".to_vec(), vec![])
            .unwrap();
        workspace.assign(&plan, "filter_file", filter).unwrap();
        let mut executor = EchoExecutor::default();
        scheduler.run(&mut workspace, &mut executor).unwrap();

        let filter = workspace
            .store
            .put("text/csv", b"second".to_vec(), vec![])
            .unwrap();
        workspace.assign(&plan, "filter_file", filter).unwrap();
        executor.calls.clear();
        let changed = scheduler.run(&mut workspace, &mut executor).unwrap();

        assert_eq!(
            changed
                .iter()
                .find(|run| run.node_id == "app_policy")
                .unwrap()
                .status,
            ExecutionStatus::Recomputed
        );
        assert_eq!(
            changed
                .iter()
                .find(|run| run.node_id == "reconstruct_episodes")
                .unwrap()
                .status,
            ExecutionStatus::Cached
        );
        assert_eq!(executor.calls, vec![PhysicalStage::AppPolicy]);
    }

    #[test]
    fn failed_node_skips_only_dependent_cones() {
        struct FailingExecutor;
        impl CapabilityExecutor for FailingExecutor {
            fn execute(
                &mut self,
                stage: PhysicalStage,
                _inputs: &ExecutionInputs<'_>,
            ) -> Result<ProducedArtifact, String> {
                if stage == PhysicalStage::ReconstructEpisodes {
                    return Err("injected matcher failure".into());
                }
                Ok(ProducedArtifact {
                    media_type: "application/json".into(),
                    bytes: format!("{stage:?}").into_bytes(),
                })
            }
        }

        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: serde_json::json!({
                "process_app_usage": true,
                "process_screen_usage": true,
                "use_filter_file": false,
                "use_app_codebook": false,
                "enable_screen_gated_crediting": false,
                "enable_study_window_filter": false,
                "enable_person_attribution": false,
                "add_no_activity_placeholder_days": false,
                "enable_day_coverage": false,
                "enable_compliance_scoring": false,
                "interaction_types_to_remove": [],
                "filter_zero_duration_sessions": false
            }),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let runs = scheduler.run(&mut workspace, &mut FailingExecutor).unwrap();
        assert_eq!(
            runs.iter()
                .find(|run| run.node_id == "reconstruct_episodes")
                .unwrap()
                .status,
            ExecutionStatus::Error
        );
        assert_eq!(
            runs.iter()
                .find(|run| run.node_id == "categorize_apps")
                .unwrap()
                .status,
            ExecutionStatus::Skipped
        );
        assert_eq!(
            runs.iter()
                .find(|run| run.node_id == "device_state_timeline")
                .unwrap()
                .status,
            ExecutionStatus::Recomputed
        );
    }
}
