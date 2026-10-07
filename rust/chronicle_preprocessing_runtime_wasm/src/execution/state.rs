use chronicle_chrono_kernel_wasm::payload_store::PayloadStore;
use chronicle_chrono_kernel_wasm::pipeline_v2::StageFunctions;
use crate::{
    ArtifactRef,
    B05SchoedelPreflightResult,
    BTreeMap,
    BUILD_ENVIRONMENT_DIGEST,
    DependencyCacheMode,
    IMPLEMENTATION_BUILD_DIGEST,
    IncrementalPipelineV2Engine,
    PipelineResultDigests,
    PipelineV2Result,
    RoleAssignment,
    RuntimeArtifact,
    RuntimeScientificPreflightReceipt,
    Serialize,
    Sha256Digest,
    VecDeque,
    sha256,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingScientificPreflightCommit {
    pub(crate) receipt: RuntimeScientificPreflightReceipt,
    pub(crate) exact_b05_schoedel: B05SchoedelPreflightResult,
    pub(crate) participant_partition_batch_id: Option<Sha256Digest>,
    pub(crate) fragmented_participant_tokens: Vec<Sha256Digest>,
    pub(crate) fragmented_participant_ids: Vec<String>,
    /// Product queries the preparing preflight physically executed. Carried
    /// forward so `execute_workspace` can publish request-scoped physical
    /// status; never compared by `validate_repeated_scientific_preflight`.
    pub(crate) executed_queries: Vec<String>,
}

#[derive(Default)]
pub(crate) struct IncrementalRuntimeState {
    pub(crate) incremental_engine: IncrementalPipelineV2Engine,
    pub(crate) pending_scientific_preflight: Option<PendingScientificPreflightCommit>,
    pub(crate) previous_query_observations: BTreeMap<String, PreviousQueryObservation>,
    pub(crate) previous_stage_inputs: BTreeMap<String, String>,
    pub(crate) previous_stage_outputs: BTreeMap<String, ArtifactRef>,
    pub(crate) stable_artifact_bundle: Option<StableArtifactBundle>,
    pub(crate) last_workspace_root: Option<String>,
}

#[derive(Clone)]
pub(crate) struct StableArtifactBundle {
    pub(crate) key: String,
    pub(crate) result_digests: PipelineResultDigests,
    pub(crate) binary_artifacts: Vec<RuntimeArtifact>,
    pub(crate) source_coordinate_artifacts: Vec<RuntimeArtifact>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreviousQueryObservation {
    pub(crate) input_key: String,
    pub(crate) output_digest: String,
    pub(crate) applicable: bool,
}

// Default Salsa engine retention: one workspace at a time. When the caller
// enables comparison pre-caching, this is raised so each worker retains
// engines for many files simultaneously — warm review (1.9 ms) instead of
// cold (61 ms) on the first comparison.
pub(crate) const DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES: usize = 1;

pub(crate) const MAX_STABLE_ARTIFACT_CACHE_BYTES: u64 = 32 * 1024 * 1024;

pub(crate) struct IncrementalRuntimeStateCache {
    pub(crate) states: BTreeMap<String, IncrementalRuntimeState>,
    pub(crate) lru: VecDeque<String>,
    pub(crate) max_states: usize,
}

impl Default for IncrementalRuntimeStateCache {
    fn default() -> Self {
        Self {
            states: BTreeMap::new(),
            lru: VecDeque::new(),
            max_states: DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES,
        }
    }
}

impl IncrementalRuntimeStateCache {
    pub(crate) fn state_for(&mut self, workspace_id: &str, services: &ExecutionServices) -> &mut IncrementalRuntimeState {
        self.lru.retain(|candidate| candidate != workspace_id);
        if !self.states.contains_key(workspace_id) && self.states.len() >= self.max_states {
            if let Some(evicted) = self.lru.pop_front() {
                self.states.remove(&evicted);
            }
        }
        self.lru.push_back(workspace_id.to_string());
        // A cached engine keeps the store it was built with; after a store
        // replacement its memos cannot be mixed with this request's store.
        if self
            .states
            .get(workspace_id)
            .is_some_and(|state| !state.incremental_engine.uses_store(&services.store))
        {
            self.states.remove(workspace_id);
        }
        self.states.entry(workspace_id.to_string()).or_insert_with(|| IncrementalRuntimeState::with_services(services))
    }

    pub(crate) fn get_mut(&mut self, workspace_id: &str) -> Option<&mut IncrementalRuntimeState> {
        self.states.get_mut(workspace_id)
    }

    pub(crate) fn has_warm_review_input(
        &self,
        workspace_id: &str,
        workspace_root_digest: Option<&str>,
        input_digest: &str,
    ) -> bool {
        self.states.get(workspace_id).is_some_and(|state| {
            state.last_workspace_root.as_deref() == workspace_root_digest
                && state.incremental_engine.has_verified_input(input_digest)
        })
    }

    pub(crate) fn set_capacity(&mut self, capacity: usize) {
        self.max_states = capacity.max(1);
        while self.states.len() > self.max_states {
            if let Some(evicted) = self.lru.pop_front() {
                self.states.remove(&evicted);
            } else {
                break;
            }
        }
    }

    pub(crate) fn compact_all(&mut self, store: &PayloadStore) {
        for state in self.states.values_mut() {
            state.stable_artifact_bundle = None;
            state.previous_stage_outputs.clear();
            state.pending_scientific_preflight = None;
        }
        // Failed spills retain the resident value and are counted; the error is
        // parked until the next request drains it at entry, so it cannot reach
        // a lease inside that request without moving the count.
        let _ = store.evict_unpinned();
    }

    pub(crate) fn retained_count(&self) -> usize {
        self.states.len()
    }
}

pub(crate) fn store_failure_count(store: &PayloadStore) -> u64 {
    store
        .stats()
        .failure_count
}

/// Snapshot the failure count for a request that starts from a clean store.
///
/// A failure counted BEFORE the request — `compact_all` between requests, say —
/// parks its error in the store, and `PayloadHandle::lease` *takes* that parked
/// error without touching `failure_count`. Delivered that way to a tracked body
/// inside the bracket, the error is memoized as that query's result while the
/// delta below stays at zero, so the poisoned engine is kept and every retry
/// replays it after storage recovers. `enforce_budget` is the only consumer of
/// the latch, and the entry that failed kept its resident value, so draining it
/// here loses nothing and makes the delta a sufficient signal.
pub(crate) fn store_failures_at_request_entry(store: &PayloadStore) -> u64 {
    let _ = store.enforce_budget();
    store_failure_count(store)
}

/// Drop the workspace's incremental state when a failed request ran while the
/// payload store reported a failure.
///
/// A tracked query that failed on a spill or reload has memoized that error; a
/// retry on this engine would reuse it after storage recovers. The failure is
/// not confined to `execute`: the base export and the scientific preflight run
/// tracked bodies of their own on the same engine, so the check brackets the
/// whole request rather than one window of it.
pub(crate) fn reset_incremental_state_after_store_failure(states: &mut IncrementalRuntimeStateCache, services: &ExecutionServices, workspace_id: &str, store_failures_before: u64) {
    if store_failure_count(&services.store) <= store_failures_before {
        return;
    }
    {
        if let Some(state) = states.get_mut(workspace_id) {
            state.incremental_engine = services.new_engine();
            state.previous_query_observations.clear();
            state.previous_stage_inputs.clear();
            state.previous_stage_outputs.clear();
            state.stable_artifact_bundle = None;
            state.pending_scientific_preflight = None;
        }
    }
}

pub(crate) fn align_incremental_state_workspace(
    services: &ExecutionServices,
    state: &mut IncrementalRuntimeState,
    workspace_root_digest: Option<&str>,
) {
    if workspace_root_digest != state.last_workspace_root.as_deref() {
        *state = IncrementalRuntimeState::with_services(services);
        // A fresh worker has no opaque Salsa snapshot, but the caller may
        // still be continuing from a verified OPFS root. Adopt that root only
        // after every workspace-scoped receipt and cache has been cleared.
        state.last_workspace_root = workspace_root_digest.map(str::to_owned);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StableArtifactKey<'a> {
    pub(crate) implementation_digest: &'static str,
    pub(crate) build_environment_digest: &'static str,
    pub(crate) workspace_id: &'a str,
    pub(crate) input_digest: &'a str,
    pub(crate) options_digest: &'a str,
    pub(crate) assignment_digests: BTreeMap<&'a str, &'a str>,
    pub(crate) assemble_result_manifest_digest: &'a str,
    pub(crate) dependency_cache_mode: DependencyCacheMode,
    pub(crate) provenance_evidence: bool,
}

pub(crate) fn stable_artifact_key(
    workspace_id: &str,
    input_digest: &str,
    options_digest: &str,
    assignments: &BTreeMap<String, RoleAssignment>,
    result: &PipelineV2Result,
    dependency_cache_mode: DependencyCacheMode,
    provenance_evidence: bool,
) -> Result<String, String> {
    let assemble_result_manifest_digest = result
        .workflow_query_digests
        .get("assemble_result_manifest")
        .ok_or_else(|| "tracked result omitted assemble_result_manifest checkpoint".to_string())?;
    Ok(sha256(
        &serde_jcs::to_vec(&StableArtifactKey {
            implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
            build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
            workspace_id,
            input_digest,
            options_digest,
            assignment_digests: assignments
                .iter()
                .map(|(role, assignment)| (role.as_str(), assignment.artifact.digest.as_str()))
                .collect(),
            assemble_result_manifest_digest,
            dependency_cache_mode,
            provenance_evidence,
        })
        .map_err(|error| format!("canonicalize stable artifact key: {error}"))?,
    ))
}

pub(crate) fn cached_stable_artifact_bundle(states: &mut IncrementalRuntimeStateCache, workspace_id: &str, key: &str) -> Option<StableArtifactBundle> {
        states
            .get_mut(workspace_id)
            .and_then(|state| state.stable_artifact_bundle.as_ref())
            .filter(|bundle| bundle.key == key)
            .cloned()
}

pub(crate) fn store_stable_artifact_bundle(states: &mut IncrementalRuntimeStateCache, workspace_id: &str, bundle: StableArtifactBundle) {
    {
        if let Some(state) = states.get_mut(workspace_id) {
            state.stable_artifact_bundle = Some(bundle);
        }
    }
}

pub(crate) fn stable_artifacts_fit_cache(
    binary_artifacts: &[RuntimeArtifact],
    source_coordinate_artifacts: &[RuntimeArtifact],
) -> bool {
    binary_artifacts
        .iter()
        .chain(source_coordinate_artifacts)
        .try_fold(0_u64, |total, artifact| {
            total
                .checked_add(artifact.metadata.size)
                .filter(|next| *next <= MAX_STABLE_ARTIFACT_CACHE_BYTES)
        })
        .is_some()
}



pub(crate) fn record_incremental_workspace_root(states: &mut IncrementalRuntimeStateCache, workspace_id: &str, workspace_root_digest: &str) {
    {
        if let Some(state) = states.get_mut(workspace_id) {
            state.last_workspace_root = Some(workspace_root_digest.to_string());
        }
    }
}

/// Request services are captured at the boundary and shared by both schedulers.
pub(crate) struct ExecutionServices {
    pub(crate) store: PayloadStore,
}

impl ExecutionServices {
    pub(crate) fn new_engine(&self) -> IncrementalPipelineV2Engine {
        IncrementalPipelineV2Engine::with_dependencies(StageFunctions::production(), self.store.clone())
    }
}

impl IncrementalRuntimeState {
    fn with_services(services: &ExecutionServices) -> Self {
        Self {
            incremental_engine: services.new_engine(), pending_scientific_preflight: None,
            previous_query_observations: BTreeMap::new(), previous_stage_inputs: BTreeMap::new(),
            previous_stage_outputs: BTreeMap::new(), stable_artifact_bundle: None, last_workspace_root: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chronicle_chrono_kernel_wasm::payload_store::MemorySpillBackend;
    use std::sync::Arc;

    #[test]
    fn a_replaced_payload_store_rebuilds_the_cached_workspace_engine() {
        let services = || ExecutionServices {
            store: PayloadStore::new(0, Arc::new(MemorySpillBackend::default())),
        };
        let (a, b) = (services(), services());
        let mut cache = IncrementalRuntimeStateCache::default();
        cache.state_for("w", &a).last_workspace_root = Some("root-a".into());
        assert_eq!(cache.state_for("w", &a).last_workspace_root.as_deref(), Some("root-a"));
        let state = cache.state_for("w", &b);
        assert!(state.incremental_engine.uses_store(&b.store));
        assert!(!state.incremental_engine.uses_store(&a.store));
        assert_eq!(state.last_workspace_root, None);
    }
}
