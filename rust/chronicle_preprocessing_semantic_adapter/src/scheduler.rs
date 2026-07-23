use crate::capabilities::{node_binding, PhysicalStage};
use crate::materialize::evaluate_materialization;
use crate::model::{
    ArtifactRef, ChroniclePlan, DependencyCacheDecision, DependencyCacheMode,
    DependencyCertificate, ExecutionStatus, MaterializationState, NodeCacheEntry, NodeExecution,
    RoleAssignment, RuntimeError,
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
    pub implementation_digest: &'a str,
    pub contract_digest: &'a str,
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
    /// Exact executable implementation identity. It is part of every node
    /// input key so no cached result can survive a code/toolchain change.
    pub implementation_digest: String,
    /// Exact product plan/runtime-authority identity. It is separate from the
    /// executable identity so invalidation evidence can distinguish semantic
    /// contract drift from code/toolchain drift.
    pub contract_digest: String,
    pub cache: BTreeMap<String, NodeCacheEntry>,
    pub store: S,
}

impl<S: Default> Default for Workspace<S> {
    fn default() -> Self {
        Self {
            revision: 0,
            assignments: BTreeMap::new(),
            options: Value::Object(Default::default()),
            implementation_digest: String::new(),
            contract_digest: String::new(),
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
    certificate: Option<DependencyCertificate>,
    certificate_digest: Option<String>,
    expected_plan_digest: Option<String>,
    empirical_evidence_current: bool,
}

impl Scheduler {
    pub fn new(plan: ChroniclePlan) -> Self {
        Self::build(plan, None, None, None, false)
    }

    pub fn new_certified(
        plan: ChroniclePlan,
        certificate: DependencyCertificate,
        certificate_digest: impl Into<String>,
        expected_plan_digest: impl Into<String>,
        empirical_evidence_current: bool,
    ) -> Self {
        Self::build(
            plan,
            Some(certificate),
            Some(certificate_digest.into()),
            Some(expected_plan_digest.into()),
            empirical_evidence_current,
        )
    }

    fn build(
        plan: ChroniclePlan,
        certificate: Option<DependencyCertificate>,
        certificate_digest: Option<String>,
        expected_plan_digest: Option<String>,
        empirical_evidence_current: bool,
    ) -> Self {
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
        Self {
            plan,
            order,
            certificate,
            certificate_digest,
            expected_plan_digest,
            empirical_evidence_current,
        }
    }

    pub fn run<S: ArtifactStore, E: CapabilityExecutor>(
        &self,
        workspace: &mut Workspace<S>,
        executor: &mut E,
    ) -> Result<Vec<NodeExecution>, RuntimeError> {
        self.run_with_decision(workspace, executor)
            .map(|(executions, _)| executions)
    }

    pub fn run_with_decision<S: ArtifactStore, E: CapabilityExecutor>(
        &self,
        workspace: &mut Workspace<S>,
        executor: &mut E,
    ) -> Result<(Vec<NodeExecution>, DependencyCacheDecision), RuntimeError> {
        let cache_decision = self.dependency_cache_decision(workspace)?;
        let conservative_context = (cache_decision.mode == DependencyCacheMode::ConservativeFull)
            .then(|| full_context_digest(workspace))
            .transpose()?;
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
            let input_key = input_key(
                node,
                &inputs,
                &cache_decision,
                conservative_context.as_deref(),
            )?;
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
        Ok((executions, cache_decision))
    }

    pub fn dependency_cache_decision<S>(
        &self,
        workspace: &Workspace<S>,
    ) -> Result<DependencyCacheDecision, RuntimeError> {
        let mut reasons = Vec::new();
        let Some(certificate) = &self.certificate else {
            return Ok(DependencyCacheDecision {
                mode: DependencyCacheMode::ConservativeFull,
                certificate_digest: None,
                binding_surface_digest: None,
                empirical_evidence_current: false,
                reasons: vec!["dependency_certificate_missing".into()],
            });
        };
        if certificate.protocol_version != "chronicle-dependency-certificate/v1" {
            reasons.push("dependency_certificate_protocol_mismatch".into());
        }
        if self.certificate_digest.is_none() {
            reasons.push("dependency_certificate_digest_missing".into());
        }
        if self.expected_plan_digest.as_deref()
            != Some(certificate.structural_contract.plan_digest.as_str())
        {
            reasons.push("dependency_certificate_plan_mismatch".into());
        }
        let actual_surface_digest = dependency_binding_surface_digest(&self.plan)?;
        if actual_surface_digest != certificate.structural_contract.binding_surface_digest {
            reasons.push("dependency_binding_surface_mismatch".into());
        }
        let plan_options = self
            .plan
            .nodes
            .iter()
            .flat_map(|node| node.knobs.iter().map(|knob| knob.option_key.as_str()))
            .collect::<BTreeSet<_>>();
        let certified_options = certificate
            .structural_contract
            .cache_relevant_option_keys
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if plan_options != certified_options {
            reasons.push("dependency_option_binding_universe_mismatch".into());
        }
        let runtime_options = workspace
            .options
            .as_object()
            .ok_or_else(|| {
                RuntimeError::Serialization("workspace options must be an object".into())
            })?
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if runtime_options != certified_options {
            if !runtime_options.is_superset(&certified_options) {
                reasons.push("dependency_option_missing".into());
            }
            if !runtime_options.is_subset(&certified_options) {
                reasons.push("dependency_option_unknown".into());
            }
        }
        let plan_roles = self
            .plan
            .root_roles
            .iter()
            .map(|role| role.role_id.as_str())
            .collect::<BTreeSet<_>>();
        let certified_roles = certificate
            .structural_contract
            .role_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if plan_roles != certified_roles {
            reasons.push("dependency_role_binding_universe_mismatch".into());
        }
        if workspace
            .assignments
            .keys()
            .any(|role| !certified_roles.contains(role.as_str()))
        {
            reasons.push("dependency_role_unknown".into());
        }
        if !certificate
            .structural_contract
            .unclassified_option_keys
            .is_empty()
        {
            reasons.push("dependency_option_unclassified".into());
        }
        if !certificate.structural_contract.unbound_role_ids.is_empty() {
            reasons.push("dependency_role_unbound".into());
        }
        if !self.empirical_evidence_current {
            reasons.push("empirical_dependency_evidence_stale_release_blocking".into());
        }
        let structural_failure = reasons
            .iter()
            .any(|reason| reason != "empirical_dependency_evidence_stale_release_blocking");
        if !structural_failure {
            reasons.insert(0, "dependency_surface_structurally_certified".into());
        }
        Ok(DependencyCacheDecision {
            mode: if structural_failure || !self.empirical_evidence_current {
                DependencyCacheMode::ConservativeFull
            } else {
                DependencyCacheMode::CertifiedNarrow
            },
            certificate_digest: self.certificate_digest.clone(),
            binding_surface_digest: Some(actual_surface_digest),
            empirical_evidence_current: self.empirical_evidence_current,
            reasons,
        })
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
        let support: BTreeMap<&str, &ArtifactRef> = node
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
            implementation_digest: &workspace.implementation_digest,
            contract_digest: &workspace.contract_digest,
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
    implementation: &'a str,
    contract: &'a str,
    dependency_certificate: Option<&'a str>,
    cache_mode: DependencyCacheMode,
    conservative_context: Option<&'a str>,
    upstream: BTreeMap<&'a str, &'a str>,
    options: BTreeMap<&'a str, &'a Value>,
    support: BTreeMap<&'a str, &'a str>,
    raw: Option<&'a str>,
}

fn input_key(
    node: &crate::model::PlanNode,
    inputs: &ExecutionInputs<'_>,
    cache_decision: &DependencyCacheDecision,
    conservative_context: Option<&str>,
) -> Result<String, RuntimeError> {
    let material = KeyMaterial {
        implementation: inputs.implementation_digest,
        contract: inputs.contract_digest,
        dependency_certificate: cache_decision.certificate_digest.as_deref(),
        cache_mode: cache_decision.mode,
        conservative_context,
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

#[derive(Serialize)]
struct FullContextArtifact<'a> {
    digest: &'a str,
    media_type: &'a str,
    assignment_qualifiers: &'a BTreeMap<String, String>,
    artifact_qualifiers: &'a BTreeMap<String, String>,
}

#[derive(Serialize)]
struct FullContext<'a> {
    options: &'a Value,
    assignments: BTreeMap<&'a str, FullContextArtifact<'a>>,
}

fn full_context_digest<S>(workspace: &Workspace<S>) -> Result<String, RuntimeError> {
    let context = FullContext {
        options: &workspace.options,
        assignments: workspace
            .assignments
            .iter()
            .map(|(role, assignment)| {
                (
                    role.as_str(),
                    FullContextArtifact {
                        digest: &assignment.artifact.digest,
                        media_type: &assignment.artifact.media_type,
                        assignment_qualifiers: &assignment.qualifiers,
                        artifact_qualifiers: &assignment.artifact.qualifiers,
                    },
                )
            })
            .collect(),
    };
    let bytes = serde_jcs::to_vec(&context)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn dependency_binding_surface_digest(plan: &ChroniclePlan) -> Result<String, RuntimeError> {
    let mut option_bindings: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    let mut role_bindings: BTreeMap<&str, Vec<Value>> = BTreeMap::from([
        (
            "processing_options",
            vec![serde_json::json!({"kind": "configuration-source", "node_id": "*"})],
        ),
        (
            "raw_chronicle_csv",
            vec![serde_json::json!({"kind": "raw-input", "node_id": "parse_events"})],
        ),
    ]);
    for node in &plan.nodes {
        for knob in &node.knobs {
            option_bindings
                .entry(&knob.option_key)
                .or_default()
                .push(serde_json::json!({
                    "edge": knob.edge,
                    "node_id": node.node_id,
                }));
        }
        for role in &node.support_roles {
            role_bindings
                .entry(role)
                .or_default()
                .push(serde_json::json!({
                    "kind": "support-input",
                    "node_id": node.node_id,
                }));
        }
    }
    for bindings in option_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                binding["node_id"].as_str().unwrap_or_default().to_string(),
                binding["edge"].as_str().unwrap_or_default().to_string(),
            )
        });
    }
    for bindings in role_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                binding["node_id"].as_str().unwrap_or_default().to_string(),
                binding["kind"].as_str().unwrap_or_default().to_string(),
            )
        });
    }
    let surface = serde_json::json!({
        "option_bindings": option_bindings,
        "role_bindings": role_bindings,
    });
    let bytes = serde_jcs::to_vec(&surface)
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
    use crate::{
        embedded_dependency_certificate, embedded_plan, ArtifactStore, MemoryCas,
        EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256,
    };

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

    fn complete_options(plan: &ChroniclePlan, overrides: Value) -> Value {
        let mut options = plan
            .nodes
            .iter()
            .flat_map(|node| node.knobs.iter().map(|knob| knob.option_key.clone()))
            .map(|key| (key, Value::Null))
            .collect::<serde_json::Map<_, _>>();
        for (key, value) in overrides
            .as_object()
            .expect("test option overrides are an object")
        {
            options.insert(key.clone(), value.clone());
        }
        Value::Object(options)
    }

    fn certified_scheduler(plan: ChroniclePlan) -> Scheduler {
        Scheduler::new_certified(
            plan,
            embedded_dependency_certificate(),
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
            EMBEDDED_PLAN_SHA256,
            true,
        )
    }

    #[test]
    fn assignments_and_materialized_outputs_advance_monotonic_revisions() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: serde_json::json!({
                "process_app_usage": true,
                "process_screen_usage": true,
                "use_filter_file": false,
                "use_app_codebook": false
            }),
            ..Default::default()
        };

        assign_required(&mut workspace, &plan);
        assert_eq!(workspace.revision, 2);
        assert_eq!(workspace.assignments["raw_chronicle_csv"].revision, 1);
        assert_eq!(workspace.assignments["processing_options"].revision, 2);

        let revision_before_run = workspace.revision;
        let runs = scheduler
            .run(&mut workspace, &mut EchoExecutor::default())
            .unwrap();
        let produced_count = runs.iter().filter(|run| run.output.is_some()).count() as u64;
        assert_eq!(produced_count, plan.nodes.len() as u64);
        assert_eq!(workspace.revision, revision_before_run + produced_count);
        assert_eq!(
            workspace.cache.values().map(|entry| entry.revision).max(),
            Some(workspace.revision)
        );
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
    fn unknown_option_forces_conservative_full_recomputation() {
        let plan = embedded_plan();
        let scheduler = certified_scheduler(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: complete_options(
                &plan,
                serde_json::json!({
                    "process_app_usage": false,
                    "process_screen_usage": false
                }),
            ),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let mut executor = EchoExecutor::default();
        scheduler.run(&mut workspace, &mut executor).unwrap();
        executor.calls.clear();
        workspace.options["enable_plotting"] = Value::Bool(true);
        let (runs, decision) = scheduler
            .run_with_decision(&mut workspace, &mut executor)
            .unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::ConservativeFull);
        assert!(decision
            .reasons
            .contains(&"dependency_option_unknown".into()));
        assert!(runs
            .iter()
            .all(|execution| execution.status != ExecutionStatus::Cached));
        assert_eq!(executor.calls.len(), plan.nodes.len());
    }

    #[test]
    fn implementation_change_invalidates_every_logical_node() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            implementation_digest: format!("sha256:{}", "a".repeat(64)),
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
        assert!(scheduler
            .run(&mut workspace, &mut executor)
            .unwrap()
            .iter()
            .all(|execution| matches!(
                execution.status,
                ExecutionStatus::Cached | ExecutionStatus::Bypassed
            )));

        executor.calls.clear();
        workspace.implementation_digest = format!("sha256:{}", "b".repeat(64));
        let changed = scheduler.run(&mut workspace, &mut executor).unwrap();
        assert!(changed
            .iter()
            .all(|execution| execution.status != ExecutionStatus::Cached));
        assert_eq!(executor.calls.len(), plan.nodes.len());
    }

    #[test]
    fn contract_change_invalidates_every_logical_node() {
        let plan = embedded_plan();
        let scheduler = Scheduler::new(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            implementation_digest: format!("sha256:{}", "a".repeat(64)),
            contract_digest: format!("sha256:{}", "c".repeat(64)),
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

        workspace.contract_digest = format!("sha256:{}", "d".repeat(64));
        let changed = scheduler.run(&mut workspace, &mut executor).unwrap();
        assert!(changed
            .iter()
            .all(|execution| execution.status != ExecutionStatus::Cached));
        assert_eq!(executor.calls.len(), plan.nodes.len());
    }

    #[test]
    fn support_change_recomputes_its_owner_but_unchanged_output_cuts_off_descendants() {
        let plan = embedded_plan();
        let scheduler = certified_scheduler(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: complete_options(
                &plan,
                serde_json::json!({
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
            ),
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
    fn missing_option_and_stale_certificate_each_disable_narrowing() {
        let plan = embedded_plan();
        let mut workspace = Workspace::<MemoryCas> {
            options: complete_options(&plan, serde_json::json!({})),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);

        workspace
            .options
            .as_object_mut()
            .unwrap()
            .remove("timezone_handling");
        let missing = certified_scheduler(plan.clone())
            .dependency_cache_decision(&workspace)
            .unwrap();
        assert_eq!(missing.mode, DependencyCacheMode::ConservativeFull);
        assert!(missing
            .reasons
            .contains(&"dependency_option_missing".into()));

        workspace.options = complete_options(&plan, serde_json::json!({}));
        let mut certificate = embedded_dependency_certificate();
        certificate.structural_contract.plan_digest = format!("sha256:{}", "0".repeat(64));
        let stale = Scheduler::new_certified(
            plan,
            certificate,
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
            EMBEDDED_PLAN_SHA256,
            true,
        )
        .dependency_cache_decision(&workspace)
        .unwrap();
        assert_eq!(stale.mode, DependencyCacheMode::ConservativeFull);
        assert!(stale
            .reasons
            .contains(&"dependency_certificate_plan_mismatch".into()));
    }

    #[test]
    fn structurally_certified_but_stale_empirical_evidence_forces_full_context() {
        let plan = embedded_plan();
        let mut workspace = Workspace::<MemoryCas> {
            options: complete_options(&plan, serde_json::json!({})),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);
        let decision = Scheduler::new_certified(
            plan,
            embedded_dependency_certificate(),
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
            EMBEDDED_PLAN_SHA256,
            false,
        )
        .dependency_cache_decision(&workspace)
        .unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::ConservativeFull);
        assert!(!decision.empirical_evidence_current);
        assert!(decision
            .reasons
            .contains(&"empirical_dependency_evidence_stale_release_blocking".into()));
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

    #[test]
    fn certified_reason_raw_boundary_and_context_identity_are_exact() {
        let plan = embedded_plan();
        let scheduler = certified_scheduler(plan.clone());
        let mut workspace = Workspace::<MemoryCas> {
            options: complete_options(&plan, serde_json::json!({})),
            ..Default::default()
        };
        assign_required(&mut workspace, &plan);

        let decision = scheduler.dependency_cache_decision(&workspace).unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::CertifiedNarrow);
        assert_eq!(
            decision.reasons.first().map(String::as_str),
            Some("dependency_surface_structurally_certified")
        );

        let parse = plan
            .nodes
            .iter()
            .find(|node| node.node_id == "parse_events")
            .expect("parse node");
        let downstream = plan
            .nodes
            .iter()
            .find(|node| node.node_id != "parse_events")
            .expect("downstream node");
        assert!(scheduler.execution_inputs(&workspace, parse).raw.is_some());
        assert!(scheduler
            .execution_inputs(&workspace, downstream)
            .raw
            .is_none());

        let before = full_context_digest(&workspace).unwrap();
        workspace.options["timezone_handling"] = Value::String("utc".into());
        let after = full_context_digest(&workspace).unwrap();
        assert_ne!(before, after);
        assert!(before.starts_with("sha256:"));
        assert_eq!(before.len(), 71);

        assert_eq!(stable_id(&["a", "b"]), stable_id(&["a", "b"]));
        assert_ne!(stable_id(&["a", "b"]), stable_id(&["ab"]));
    }
}
