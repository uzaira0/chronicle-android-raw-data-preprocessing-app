use super::execution_state::{ExecutionServices, IncrementalRuntimeStateCache, store_failures_at_request_entry, reset_incremental_state_after_store_failure};
#[cfg(test)]
use crate::TRACKED_PHYSICAL_EXECUTION_COUNT;
use crate::{
    Arc,
    ArtifactRef,
    BTreeMap,
    BTreeSet,
    BUILD_ENVIRONMENT_DIGEST,
    DependencyCacheDecision,
    DependencyCacheMode,
    EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
    EMBEDDED_PLAN_SHA256,
    EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EnvelopeTimer,
    ExecutionEngine,
    ExecutionStatus,
    ExportedBases,
    IMPLEMENTATION_BUILD_DIGEST,
    IncrementalPipelineV2Execution,
    MAX_REVIEW_BASE_ENCODED_BYTES,
    PayloadBytes,
    PayloadHandle,
    PersistedScientificPreflight,
    PipelineV2Options,
    PipelineV2Result,
    PreviousQueryObservation,
    QUERY_REVIEW_COMMAND,
    QueryGroupExecution,
    RECONSTRUCTION_BASE_RUNTIME_MAGIC,
    REVIEW_BASE_RUNTIME_MAGIC,
    RawCsvBytes,
    ResolvedSupportFiles,
    ReviewBehavior,
    RoleAssignment,
    RuntimeArtifact,
    RuntimeQueryExecution,
    RuntimeQueryKeyMaterial,
    RuntimeRequest,
    RuntimeScientificPreflightKey,
    SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR,
    SEQUENTIAL_ENGINE_RAW_REQUIRED_ERROR,
    Serialize,
    Value,
    VerifiedRawInput,
    WORKFLOW_QUERIES,
    active_source_roles,
    adopt_persisted_scientific_preflight,
    align_incremental_state_workspace,
    attach_persisted_preflight,
    dependency_evidence_current,
    embedded_dependency_certificate,
    embedded_plan,
    evaluate_dependency_cache_decision,
    persistable_bases,
    reconstruction_base_is_reusable,
    preflight_on_incremental_engine,
    query_output_mode,
    query_request_fields,
    requires_live_scientific_preflight,
    runtime_artifact,
    scientific_preflight_is_executable,
    sha256,
    split_persisted_preflight,
    stable_id,
    validate_b05_schoedel_finalization,
    validate_eyes_input_partition_finalization,
    validate_pending_scientific_preflight,
    validate_persisted_base_encoded_lengths,
    validate_repeated_scientific_preflight,
    verified_persisted_base_payload,
    wrap_persisted_base,
};

/// The raw bytes an execution hands back for the source-coordinate index:
/// the request's `Arc` (shared with the tracked input on the incremental
/// engine), or the copy the sequential pass parked in the payload store,
/// which stays spilled until the index leases it.
pub(crate) enum ExecutionRawCsv {
    Shared(Arc<Vec<u8>>),
    Parked(PayloadBytes),
}

impl ExecutionRawCsv {
    pub(crate) fn materialize(&self) -> Result<Arc<Vec<u8>>, String> {
        match self {
            Self::Shared(bytes) => Ok(Arc::clone(bytes)),
            Self::Parked(bytes) => bytes.materialize(),
        }
    }
}

pub(crate) struct IncrementalPipelineExecution {
    pub(crate) result: Arc<PipelineV2Result>,
    /// The raw bytes the execution ran over: the tracked input's own
    /// allocation once it adopted or matched the request bytes, or the
    /// sequential pass's parked copy.
    pub(crate) raw_csv: ExecutionRawCsv,
    pub(crate) output_payloads: BTreeMap<String, PayloadBytes>,
    pub(crate) lineage_payload: PayloadHandle<Vec<chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage>>,
    pub(crate) review_base: Option<Vec<u8>>,
    pub(crate) reconstruction_base: Option<Vec<u8>>,
    pub(crate) query_group_executions: Vec<QueryGroupExecution>,
    pub(crate) query_executions: Vec<RuntimeQueryExecution>,
    pub(crate) cache_sources: Vec<String>,
    pub(crate) cache_decision: DependencyCacheDecision,
    pub(crate) node_artifacts: Vec<RuntimeArtifact>,
}

pub(crate) fn validate_verified_review_inputs(
    verified_persisted_input: bool,
    has_owned_csv: bool,
    review_base_is_empty: bool,
) -> Result<(), String> {
    if verified_persisted_input && (has_owned_csv || review_base_is_empty) {
        return Err("verified persisted review requires a selected review base".into());
    }
    Ok(())
}

pub(crate) fn should_report_salsa_memory(
    cache_sources_empty: bool,
    had_previous_query_observations: bool,
    query_executions: &[RuntimeQueryExecution],
) -> bool {
    cache_sources_empty
        && had_previous_query_observations
        && query_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Cached)
}

pub(crate) struct PersistedReviewBases<'a> {
    pub(crate) review: &'a [u8],
    pub(crate) reconstruction: &'a [u8],
    pub(crate) warm_verified_input: bool,
}

pub(crate) struct RuntimeQueryExecutionState<'a> {
    pub(crate) executed_queries: &'a [String],
    pub(crate) materialize_full_outputs: bool,
    pub(crate) previous_observations: &'a mut BTreeMap<String, PreviousQueryObservation>,
}

pub(crate) fn build_runtime_query_executions(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    exact_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
    result: &PipelineV2Result,
    state: &mut RuntimeQueryExecutionState<'_>,
) -> Result<Vec<RuntimeQueryExecution>, String> {
    let plan_queries = plan
        .queries
        .iter()
        .map(|step| (step.query_id.as_str(), step))
        .collect::<BTreeMap<_, _>>();
    let workflow_contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let query_contracts = workflow_contract
        .execution
        .queries
        .iter()
        .map(|query| (query.id, query))
        .collect::<BTreeMap<_, _>>();
    let contract_ids = WORKFLOW_QUERIES
        .iter()
        .map(|step| step.id)
        .collect::<BTreeSet<_>>();
    let plan_ids = plan_queries.keys().copied().collect::<BTreeSet<_>>();
    if contract_ids != plan_ids {
        return Err(format!(
            "Rust workflow query contract and embedded product plan disagree: rust_only={:?}, plan_only={:?}",
            contract_ids.difference(&plan_ids).collect::<Vec<_>>(),
            plan_ids.difference(&contract_ids).collect::<Vec<_>>(),
        ));
    }

    let exact_object = exact_options
        .as_object()
        .ok_or_else(|| "exact Rust options must serialize as an object".to_string())?;
    let executed_queries = state
        .executed_queries
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let unknown_executions = executed_queries
        .difference(&contract_ids)
        .copied()
        .collect::<Vec<_>>();
    if !unknown_executions.is_empty() {
        return Err(format!(
            "incremental engine reported unknown executed queries: {unknown_executions:?}"
        ));
    }
    let mut executions = Vec::with_capacity(WORKFLOW_QUERIES.len());
    let mut binding_gaps = Vec::new();
    let mut next_observations = BTreeMap::new();
    for definition in WORKFLOW_QUERIES {
        let plan_query = plan_queries[definition.id];
        let query_contract = query_contracts[definition.id];
        let output_digest = result
            .workflow_query_digests
            .get(definition.id)
            .ok_or_else(|| format!("missing Rust checkpoint digest for {}", definition.id))?
            .clone();
        let applicable = plan_query.applicability.evaluate(semantic_options);
        let previous = state.previous_observations.get(definition.id);
        // The key is defined below as a function of *this* run's inputs, so it
        // is always built from them. A previous run's key was reused here when
        // Salsa reported the query had not executed, on the reasoning that a
        // query which did not run cannot have changed its inputs. That does
        // not hold: the key binds the step's *declared* request fields, and a
        // step can legitimately skip execution while one of them changes —
        // `segment_concurrent_usage` binds `minimum_usage_duration` but only reads it
        // when `apply_minimum_usage_duration_to_concurrent_subintervals` is
        // on, so editing the floor with that switch off left a warm review
        // reporting the previous run's key for it while a cold review of the
        // same options reported a different one. A key that depends on how the
        // run got here is not an identity, and comparing keys across runs is
        // exactly what they are published for.
        let upstream = definition
            .inputs
            .iter()
            .map(|input| {
                result
                    .workflow_query_digests
                    .get(*input)
                    .cloned()
                    .map(|digest| ((*input).to_string(), digest))
                    .ok_or_else(|| format!("{} has no checkpoint for input {input}", definition.id))
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let request_fields = query_request_fields(definition.id)
            .iter()
            .map(|field| {
                exact_object
                    .get(*field)
                    .cloned()
                    .or_else(|| {
                        // An optional wire field (the B06 vector) is absent
                        // when omitted; the key binds that absence as `null`,
                        // distinct from every present value.
                        chronicle_chrono_kernel_wasm::workflow_contract::OPTIONAL_REQUEST_FIELDS
                            .contains(field)
                            .then_some(Value::Null)
                    })
                    .map(|value| ((*field).to_string(), value))
                    .ok_or_else(|| {
                        format!(
                            "{} binds unknown exact request field {field}",
                            definition.id
                        )
                    })
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let source_roles = active_source_roles(definition.id, exact_object, assignments);
        let input_key = sha256(
            &serde_jcs::to_vec(&RuntimeQueryKeyMaterial {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
                query_closure_digest: &query_contract.closure_digest,
                applicable,
                upstream,
                request_fields,
                source_roles,
                output_mode: query_output_mode(
                    query_contract.review_behavior,
                    state.materialize_full_outputs,
                ),
            })
            .map_err(|error| format!("canonicalize {} input key: {error}", definition.id))?,
        );
        if previous.is_some_and(|entry| {
            entry.input_key == input_key && entry.output_digest != output_digest
        }) {
            binding_gaps.push(definition.id.to_string());
        }
        let status = if !applicable && plan_query.can_bypass {
            ExecutionStatus::Bypassed
        } else if !state.materialize_full_outputs
            && query_contract.review_behavior == ReviewBehavior::Omit
        {
            ExecutionStatus::Skipped
        } else if executed_queries.contains(definition.id) {
            ExecutionStatus::Recomputed
        } else {
            ExecutionStatus::Cached
        };
        let reason_id = sha256(
            format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                definition.id,
                input_key,
                output_digest,
                match status {
                    ExecutionStatus::Cached => "cached",
                    ExecutionStatus::Recomputed => "recomputed",
                    ExecutionStatus::Bypassed => "bypassed",
                    ExecutionStatus::Error => "error",
                    ExecutionStatus::Skipped => "skipped",
                }
            )
            .as_bytes(),
        );
        executions.push(RuntimeQueryExecution {
            query_id: definition.id.to_string(),
            query_group_id: definition.group.to_string(),
            status,
            input_key: input_key.clone(),
            output_digest: output_digest.clone(),
            reason_id,
        });
        next_observations.insert(
            definition.id.to_string(),
            PreviousQueryObservation {
                input_key,
                output_digest,
                applicable,
            },
        );
    }

    if !binding_gaps.is_empty() {
        return Err(format!(
            "tracked query output changed without a changed bound input: {}",
            binding_gaps.join(",")
        ));
    }
    *state.previous_observations = next_observations;
    Ok(executions)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryGroupInputKey<'a> {
    pub(crate) implementation_digest: &'static str,
    pub(crate) contract_digest: &'static str,
    pub(crate) query_group_id: &'a str,
    pub(crate) semantic_output_digest: &'a str,
    pub(crate) query_inputs: BTreeMap<&'a str, (&'a str, &'a str)>,
}

/// `Recomputed` is a claim about physical execution *anywhere in this request*,
/// so it is reachable only from a member query that actually ran
/// (`has_executed_member`, read straight off the Salsa execution events, both
/// the `execute` window and the scientific-preflight window that precedes it)
/// or from a group the run deactivated.
///
/// The stage's published `input_key` deliberately does *not* feed this. That
/// key binds every member step's own key, and a query's key can legitimately
/// move while the step does not execute — a support artifact rewritten with
/// CRLF line endings changes `active_source_roles`' raw digest but parses to
/// the same rows, so Salsa recomputes nothing. Folding that into the status
/// badged eight support-file byte rewrites per corpus as "recomputed" inside a
/// manifest whose own `queryExecutions` reported that no query was recomputed.
/// Callers that need "the projection key moved" read `input_key`, which is
/// published on every `QueryGroupExecution`.
///
/// `has_executed_member` is the Salsa event set and not "some member is badged
/// `Recomputed`", because the member ladder in `build_runtime_query_executions`
/// resolves `Bypassed` and `Skipped` ahead of `Recomputed`. A query that is not
/// applicable but whose query still ran is therefore badged `Bypassed`, and
/// reading the badges back would lose the execution — leaving this function
/// free to answer `Cached`, whose published reason is
/// `all-active-queries-reused`, for a stage in which a query ran.
pub(crate) fn query_group_status(
    has_error: bool,
    bypassed: bool,
    has_skipped_query: bool,
    group_deactivated: bool,
    has_executed_member: bool,
) -> ExecutionStatus {
    if has_error {
        ExecutionStatus::Error
    } else if bypassed {
        ExecutionStatus::Bypassed
    } else if has_skipped_query {
        ExecutionStatus::Skipped
    } else if group_deactivated || has_executed_member {
        ExecutionStatus::Recomputed
    } else {
        ExecutionStatus::Cached
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn project_query_groups(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    semantic_options: &Value,
    result: &PipelineV2Result,
    query_executions: &[RuntimeQueryExecution],
    executed_queries: &BTreeSet<&str>,
    deactivated_groups: &BTreeSet<&str>,
    previous_stage_inputs: &mut BTreeMap<String, String>,
    previous_stage_outputs: &mut BTreeMap<String, ArtifactRef>,
    materialize_artifacts: bool,
) -> Result<(Vec<QueryGroupExecution>, Vec<RuntimeArtifact>), String> {
    let mut executions = Vec::with_capacity(plan.query_groups.len());
    let mut artifacts = Vec::with_capacity(plan.query_groups.len());
    for node in &plan.query_groups {
        let members = query_executions
            .iter()
            .filter(|execution| execution.query_group_id == node.query_group_id)
            .collect::<Vec<_>>();
        if members.is_empty() {
            return Err(format!(
                "query group {} contains no tracked Rust queries",
                node.query_group_id
            ));
        }
        let checkpoint = result
            .workflow_query_group_checkpoints
            .get(&node.query_group_id)
            .ok_or_else(|| {
                format!(
                    "tracked pipeline omitted typed query-group checkpoint {}",
                    node.query_group_id
                )
            })?;
        let semantic_output_digest = if node.query_group_id == "outputs" {
            sha256(
                &serde_jcs::to_vec(&serde_json::json!({
                    "checkpoint": result.workflow_query_group_digests.get(&node.query_group_id),
                    "enableParquetExport": semantic_options["enable_parquet_export"],
                    "enableSpssExport": semantic_options["enable_spss_export"],
                }))
                .map_err(|error| format!("canonicalize output-stage extensions: {error}"))?,
            )
        } else {
            result
                .workflow_query_group_digests
                .get(&node.query_group_id)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "tracked pipeline omitted query-group digest {}",
                        node.query_group_id
                    )
                })?
        };
        let input_key = sha256(
            &serde_jcs::to_vec(&QueryGroupInputKey {
                implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
                contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                query_group_id: &node.query_group_id,
                semantic_output_digest: &semantic_output_digest,
                query_inputs: members
                    .iter()
                    .map(|execution| {
                        (
                            execution.query_id.as_str(),
                            (
                                execution.input_key.as_str(),
                                execution.output_digest.as_str(),
                            ),
                        )
                    })
                    .collect(),
            })
            .map_err(|error| {
                format!(
                    "canonicalize {} query-group key: {error}",
                    node.query_group_id
                )
            })?,
        );
        let projection_changed = previous_stage_inputs
            .get(&node.query_group_id)
            .is_none_or(|previous| previous != &input_key);
        let cached_output = (!materialize_artifacts && !projection_changed)
            .then(|| previous_stage_outputs.get(&node.query_group_id).cloned())
            .flatten();
        let output = if let Some(output) = cached_output {
            output
        } else {
            let bytes = serde_jcs::to_vec(&serde_json::json!({
                "checkpointProtocol": "chronicle-workflow-checkpoint/v1",
                "physicalExecution": "salsa-tracked-rust-pipeline-v2",
                "projection": "query-group-from-actual-query-events",
                "workflowQueryGroupId": node.query_group_id,
                "semanticOutputDigest": semantic_output_digest,
                "typedCheckpoint": checkpoint,
            }))
            .map_err(|error| {
                format!(
                    "canonicalize {} query-group projection: {error}",
                    node.query_group_id
                )
            })?;
            let derived_from = members
                .iter()
                .map(|execution| execution.output_digest.clone())
                .collect::<Vec<_>>();
            let artifact = runtime_artifact(store,
                &format!("node-output:{}", node.query_group_id),
                "application/vnd.chronicle.node-fingerprint+json",
                bytes,
                derived_from,
            );
            let output = ArtifactRef {
                artifact_id: artifact.metadata.artifact_id.clone(),
                digest: artifact.metadata.digest.clone(),
                media_type: artifact.metadata.media_type.clone(),
                size: artifact.metadata.size,
                derived_from: artifact.metadata.derived_from.clone(),
                qualifiers: BTreeMap::new(),
            };
            if materialize_artifacts {
                artifacts.push(artifact);
            }
            output
        };
        let status = query_group_status(
            members
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Error),
            !node.applicability.evaluate(semantic_options) && node.can_bypass,
            members
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Skipped),
            deactivated_groups.contains(node.query_group_id.as_str()),
            members
                .iter()
                .any(|execution| executed_queries.contains(execution.query_id.as_str())),
        );
        let reason = match status {
            ExecutionStatus::Cached => "all-active-queries-reused",
            ExecutionStatus::Recomputed => "query-group-projection-changed",
            ExecutionStatus::Bypassed => "query-group-not-applicable",
            ExecutionStatus::Skipped => "query-skipped",
            ExecutionStatus::Error => "query-error",
        };
        let output_digest = output.digest.clone();
        executions.push(QueryGroupExecution {
            query_group_id: node.query_group_id.clone(),
            capability_id: node.capability_id.clone(),
            status,
            input_key: input_key.clone(),
            output: Some(output.clone()),
            reason_id: stable_id(&[reason, &node.query_group_id, &output_digest]),
        });
        previous_stage_inputs.insert(node.query_group_id.clone(), input_key);
        previous_stage_outputs.insert(node.query_group_id.clone(), output);
    }
    Ok((executions, artifacts))
}

// This is the single handoff from validated runtime state to the Rust query
// engine. Keeping every identity, byte source, option, and support input
// explicit is safer here than hiding them in a second request abstraction.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_incremental_pipeline(
    states: &mut IncrementalRuntimeStateCache,
    services: &ExecutionServices,
    request: &RuntimeRequest,
    ingress_assignments: &BTreeMap<String, RoleAssignment>,
    computation_options_digest: &str,
    scientific_preflight_key: &RuntimeScientificPreflightKey,
    fragmented_participant_ids: &[String],
    csv_bytes: Arc<Vec<u8>>,
    verified_raw: Option<VerifiedRawInput<'static>>,
    mut owned_review_csv: Option<Vec<u8>>,
    verified_persisted_input: bool,
    persisted_bases: PersistedReviewBases<'_>,
    options_value: &Value,
    exact_options_value: &Value,
    options: &PipelineV2Options,
    support: &ResolvedSupportFiles,
) -> Result<IncrementalPipelineExecution, String> {
    let plan = embedded_plan();
    let mut csv_bytes = csv_bytes;
    let mut verified_raw = verified_raw;
    let mut parked_raw_csv: Option<PayloadBytes> = None;
    let store_failures_before = store_failures_at_request_entry(&services.store);
    let outcome = (|| {
        let state = states.state_for(&request.workspace_id, services);
        align_incremental_state_workspace(services, state, request.workspace_root_digest.as_deref());
        // A live scientific preflight is a one-shot authorization. Consume it
        // before any cache/materialization decision that can fail so every
        // execution attempt—successful, refused, or errored—requires a fresh
        // preflight and cannot retain batch-scoped participant state.
        // The workspace id is the input's alone, so a commit parked by a
        // preflight whose execute never arrived (a JS-side failure, a cancel)
        // meets the next request for the same file under other options. When
        // that request needs no live preflight no commit can be its own (a
        // preflight parks one only when it is executable, which such options
        // never are), so the leftover is stale worker state and is dropped; a
        // request that needs one still fails below on a commit not its own.
        let consumed_scientific_preflight = state
            .pending_scientific_preflight
            .take()
            .filter(|_| requires_live_scientific_preflight(options));
        let timer = EnvelopeTimer::start("cache_decision_evaluate");
        let certificate = embedded_dependency_certificate();
        let empirical_evidence_current = dependency_evidence_current(certificate);
        let cache_decision = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            empirical_evidence_current,
            options_value,
            ingress_assignments,
        )
        .map_err(|error| error.to_string())?;
        if let Some(pending) = consumed_scientific_preflight.as_ref() {
            validate_pending_scientific_preflight(
                pending,
                scientific_preflight_key,
                request,
                fragmented_participant_ids,
            )?;
        }
        if cache_decision.mode == DependencyCacheMode::ConservativeFull
            && consumed_scientific_preflight.is_none()
        {
            state.incremental_engine = services.new_engine();
            state.previous_query_observations.clear();
            state.previous_stage_inputs.clear();
            state.previous_stage_outputs.clear();
            state.stable_artifact_bundle = None;
        }
        let had_previous_query_observations = !state.previous_query_observations.is_empty();
        timer.finish();

        let timer = EnvelopeTimer::start("persisted_base_verify");
        validate_persisted_base_encoded_lengths(
            persisted_bases.review.len(),
            persisted_bases.reconstruction.len(),
            cache_decision.mode,
        )?;

        let (verified_review_base, review_base_preflight) =
            split_persisted_preflight(
                verified_persisted_base_payload(
                    persisted_bases.review,
                    REVIEW_BASE_RUNTIME_MAGIC,
                    "review base",
                    cache_decision.mode,
                )?,
                "review base",
            )?;
        let (verified_reconstruction_base, reconstruction_base_preflight) =
            split_persisted_preflight(
                verified_persisted_base_payload(
                    persisted_bases.reconstruction,
                    RECONSTRUCTION_BASE_RUNTIME_MAGIC,
                    "reconstruction base",
                    cache_decision.mode,
                )?,
                "reconstruction base",
            )?;
        // Either base can carry the commitment. The reconstruction base is
        // preferred only because a resume that reads it reuses more work; both
        // were written by a run whose measurement identity is checked below.
        let persisted_scientific_preflight =
            reconstruction_base_preflight.or(review_base_preflight);

        let support_files = support.pipeline_files(
            computation_options_digest,
            ingress_assignments,
            fragmented_participant_ids,
        );
        // A raw-less review resume has no bytes to preflight from, so the only
        // scientific commitment available is the one the run that WROTE the
        // base it is resuming from attached to it. Adopt it only when it
        // describes the same measurement on the same input. Anything else,
        // including a base with no commitment at all, still demands raw bytes.
        let adopted_scientific_preflight = if requires_live_scientific_preflight(options)
            && consumed_scientific_preflight.is_none()
        {
            let Some(persisted) = persisted_scientific_preflight.as_ref() else {
                return Err(SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR.into());
            };
            adopt_persisted_scientific_preflight(
                persisted,
                scientific_preflight_key,
                computation_options_digest,
                request,
                fragmented_participant_ids,
                options,
            )?
        } else {
            None
        };
        // Physical execution the scientific preflight already performed inside
        // this request, before `execute` opens its own measurement window.
        let mut preflight_executed_queries = BTreeSet::new();
        if let Some(pending) = consumed_scientific_preflight.as_ref() {
            validate_pending_scientific_preflight(
                pending,
                scientific_preflight_key,
                request,
                fragmented_participant_ids,
            )?;
            preflight_executed_queries.extend(pending.executed_queries.iter().cloned());
            let repeat_csv = match owned_review_csv.as_deref().filter(|bytes| !bytes.is_empty()) {
                Some(bytes) => Some(RawCsvBytes::Borrowed(bytes)),
                None => (!csv_bytes.is_empty()).then_some(RawCsvBytes::Shared(&csv_bytes)),
            };
            if request.execution_engine == ExecutionEngine::Sequential {
                // The sequential pass recomputes the whole preflight cone
                // from the bytes it is handed, and the finalization below
                // compares the run's receipt with this commit: a drift
                // between preparation and execution fails there, without a
                // second preflight pass.
            } else if let Some(raw_csv) = repeat_csv {
                let repeated = preflight_on_incremental_engine(
                    &mut state.incremental_engine,
                    raw_csv,
                    scientific_preflight_key.clone(),
                    options,
                    support_files,
                )?;
                validate_repeated_scientific_preflight(pending, &repeated)?;
                preflight_executed_queries.extend(repeated.executed_queries.iter().cloned());
            } else if requires_live_scientific_preflight(options)
                && !state
                    .incremental_engine
                    .has_verified_input(&scientific_preflight_key.input_digest)
            {
                return Err(SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR.into());
            }
            if !scientific_preflight_is_executable(options, &pending.receipt) {
                return Err("scientific preflight commit is not executable".into());
            }
        }
        // Merge only after the raw-repeat block above: an adopted commit has no
        // raw bytes to repeat against, and must not be handed to a check that
        // exists to catch a live preflight drifting between preparation and
        // execution. From here on the two are the same authorization, and the
        // finalization comparison below treats them identically.
        let consumed_scientific_preflight =
            consumed_scientific_preflight.or(adopted_scientific_preflight);
        timer.finish();
        let timer = EnvelopeTimer::start("engine_execute");
        let tracked_execution = (|| {
        if request.execution_engine == ExecutionEngine::Sequential {
            // The sequential scheduler runs the whole registry from the raw
            // bytes: no memo, no verified-input reuse, no persisted base. A
            // review request without bytes has nothing to run from; the
            // caller falls back to the raw file exactly as for a base miss.
            let review_raw = owned_review_csv.take().filter(|bytes| !bytes.is_empty());
            if review_raw.is_none() && csv_bytes.is_empty() {
                return Err(SEQUENTIAL_ENGINE_RAW_REQUIRED_ERROR.into());
            }
            // Nothing of this request ran on the tracked engine; a memo an
            // earlier incremental request left in this workspace serves
            // nothing here either.
            state.incremental_engine = services.new_engine();
            let verified_review = if verified_raw.is_none() {
                review_raw
                    .as_deref()
                    .map(|bytes| VerifiedRawInput::verify_borrowed(bytes, &scientific_preflight_key.input_digest))
                    .transpose()?
            } else {
                None
            };
            let verified = verified_raw.as_ref().or(verified_review.as_ref())
                .ok_or(SEQUENTIAL_ENGINE_RAW_REQUIRED_ERROR)?;
            let run = chronicle_chrono_kernel_wasm::pipeline_v2::prepare_sequential_run_with_verified_input_and_dependencies(
                chronicle_chrono_kernel_wasm::pipeline_v2::StageFunctions::production(), services.store.clone(),
                verified,
                options,
                support_files,
            )?;
            drop(verified_review);
            // The pass reads no byte of the file. The request's copy is parked
            // in the payload store: spilled, it is off the heap through the
            // pass, the result digests, and the binary exports, and the
            // source-coordinate index leases it back. A copy someone else
            // still holds (a native caller's `Arc`) cannot be parked and
            // stays where it is.
            let parked_request_bytes = review_raw.is_none();
            let parked = match review_raw {
                Some(bytes) => Some(PayloadBytes::from_vec_with_store(bytes, &services.store)),
                None => {
                    // Release the working clone before consuming the proof's
                    // owned allocation. The browser then parks its sole raw
                    // copy just as it did before this typed boundary.
                    csv_bytes = Arc::default();
                    let raw = verified_raw.take().ok_or(SEQUENTIAL_ENGINE_RAW_REQUIRED_ERROR)?
                        .into_shared_bytes();
                    match Arc::try_unwrap(raw) {
                    Ok(bytes) => Some(PayloadBytes::from_vec_with_store(bytes, &services.store)),
                    Err(shared) => {
                        csv_bytes = shared;
                        None
                    }
                    }
                }
            };
            if parked.is_some() {
                services.store.evict_unpinned()?;
            }
            let result = chronicle_chrono_kernel_wasm::pipeline_v2::run_prepared_sequential(
                run,
                options,
                support_files,
            )?;
            parked_raw_csv = parked.filter(|_| parked_request_bytes);
            return Ok(IncrementalPipelineV2Execution::from_sequential(&services.store, result));
        }
        Ok::<_, String>(if request.command == QUERY_REVIEW_COMMAND {
            if persisted_bases.warm_verified_input {
                if !verified_persisted_input
                    || owned_review_csv.is_some()
                    || !verified_review_base.is_empty()
                    || !verified_reconstruction_base.is_empty()
                {
                    return Err("warm review requires only the live verified input".into());
                }
                state
                    .incremental_engine
                    .execute_review_with_warm_verified_input(
                        scientific_preflight_key.input_digest.clone(),
                        options,
                        support_files,
                    )?
            } else if verified_persisted_input {
                validate_verified_review_inputs(
                    true,
                    owned_review_csv.is_some(),
                    verified_review_base.is_empty(),
                )?;
                state
                    .incremental_engine
                    .execute_review_with_verified_input(
                        scientific_preflight_key.input_digest.clone(),
                        verified_review_base,
                        verified_reconstruction_base,
                        options,
                        support_files,
                    )?
            } else if let Some(csv_bytes) = owned_review_csv {
                state.incremental_engine.execute_review_with_owned_csv(
                    csv_bytes,
                    verified_review_base,
                    verified_reconstruction_base,
                    options,
                    support_files,
                )?
            } else {
                state.incremental_engine.execute_review_with_bases(
                    &csv_bytes,
                    verified_review_base,
                    verified_reconstruction_base,
                    options,
                    support_files,
                )?
            }
        } else {
            let execution = state.incremental_engine.execute_raw(
                RawCsvBytes::Shared(&csv_bytes),
                options,
                support_files,
            )?;
            // The tracked input now holds bytes equal to the request's:
            // adopt its allocation and let the request's own copy go, so one
            // copy of the raw file is live for the rest of the request.
            if let Some(live_raw) = state.incremental_engine.live_raw_bytes() {
                csv_bytes = live_raw;
            }
            execution
        })
        })();
        let tracked_execution = tracked_execution?;
        timer.finish();
        let timer = EnvelopeTimer::start("base_export");
        // The base export re-leases the largest row tables of the run. Release
        // the result's lineage lease for that window so the payload store can
        // spill the lineage instead of pinning it under those leases; the
        // lineage is leased back before anything downstream reads it.
        let mut tracked_execution = tracked_execution;
        let lineage_payload = tracked_execution.lineage_payload.clone();
        Arc::make_mut(&mut tracked_execution.result).row_lineage = Arc::default();
        // Carry this run's scientific commitment with the bases it produced, so
        // a later review that holds only a base can resume from it instead of
        // demanding the raw file back.
        let persisted_preflight =
            consumed_scientific_preflight
                .as_ref()
                .map(|pending| PersistedScientificPreflight {
                    receipt: pending.receipt.clone(),
                    exact_b05_schoedel: pending.exact_b05_schoedel.clone(),
                });
        // Both exports below can fail AFTER the first one already pushed
        // product bodies into the engine's base-export window (the review
        // export succeeds, then attaching the preflight or the reconstruction
        // export fails). The window is drained unconditionally before the `?`
        // fires, otherwise a failed request strands its executions on the
        // engine and the NEXT request in the same workspace publishes them as
        // its own -- the unjustified-execution class the tomography campaigns
        // assert to the empty set. Same shape as the scientific-preflight
        // drain in `preflight_on_incremental_engine`.
        //
        // A base the kernel refuses for size (`Ok(None)`), or whose wrapped
        // envelope exceeds the encoded ceilings this runtime enforces on the
        // way back in (`validate_persisted_base_encoded_lengths`), is dropped
        // here rather than failing the request: the resume cache is an
        // optimization, the product run that produced it is already complete.
        // Writing only what the reader accepts keeps the read-side ceiling a
        // pure tamper check. A reconstruction base is never persisted without
        // its review base (`select_persisted_base_kind` starts from the review
        // base), so a refused review base skips the reconstruction export.
        let exported_bases = (|| -> Result<ExportedBases, String> {
            let review_base = if request.command == QUERY_REVIEW_COMMAND
                || request.execution_engine == ExecutionEngine::Sequential
            {
                None
            } else {
                match state.incremental_engine.export_review_base()? {
                    Some(payload) => Some(wrap_persisted_base(
                        attach_persisted_preflight(payload, persisted_preflight.as_ref())?,
                        REVIEW_BASE_RUNTIME_MAGIC,
                    )),
                    None => None,
                }
            }
            .filter(|encoded| encoded.len() <= MAX_REVIEW_BASE_ENCODED_BYTES);
            let reconstruction_base = if review_base.is_some()
                && matches!(
                    options.usage_session_mode,
                    chronicle_chrono_kernel_wasm::pipeline_v2::UsageSessionMode::AppUsage
                        | chronicle_chrono_kernel_wasm::pipeline_v2::UsageSessionMode::AppAndScreenUsage
                )
                && reconstruction_base_is_reusable(options)
            {
                match state.incremental_engine.export_reconstruction_base()? {
                    Some(payload) => Some(wrap_persisted_base(
                        attach_persisted_preflight(payload, persisted_preflight.as_ref())?,
                        RECONSTRUCTION_BASE_RUNTIME_MAGIC,
                    )),
                    None => None,
                }
            } else {
                None
            };
            Ok(persistable_bases(review_base, reconstruction_base))
        })();
        let base_export_executed_queries = state
            .incremental_engine
            .take_base_export_executed_queries();
        let (review_base, reconstruction_base) = exported_bases?;
        Arc::make_mut(&mut tracked_execution.result).row_lineage =
            lineage_payload.lease()?.shared();
        let restored_review_base = tracked_execution
            .internal_executed_queries
            .iter()
            .any(|query| query == "restore_review_base" || query == "restore_review_screen");
        let restored_reconstruction_base =
            tracked_execution
                .internal_executed_queries
                .iter()
                .any(|query| {
                    query == "restore_reconstruction_base"
                        || query == "restore_reconstruction_screen"
                });
        let mut executed_queries = tracked_execution.executed_queries;
        #[cfg(test)]
        if !executed_queries.is_empty() {
            TRACKED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(count.get() + 1));
        }
        // The base exporters above run the same DAG after `finish_execution`
        // drained its window. The kernel reports only product query BODIES
        // from that window (checkpoint re-derivations inside the internal
        // review aggregates are not product executions -- promoting their
        // fused step names badged cut-off queries as executed, which the
        // configuration-interventions drift gate refused). A product body
        // that does first-run while serializing a base joins the request's
        // physical log here so it is never badged `cached` -- the same defect
        // the preflight union below closes for its window. (Drained above,
        // unconditionally, before the export `?` could strand it on the
        // engine for the NEXT request's manifest.)
        preflight_executed_queries.extend(base_export_executed_queries);
        // Publish request-scoped physical execution. `execute` deliberately
        // measures only its own window (`finish_execution` clears the Salsa
        // body log before `assemble_result_manifest`), but the scientific
        // preflight ran part of the same DAG a few statements earlier on the
        // same database. Without the union, every query in the
        // `construct_screen_intervals` ancestor closure is badged `cached`
        // while the manifest publishes a changed `output_digest` for it — a
        // Salsa body only produces a new value by running.
        if !preflight_executed_queries.is_empty() {
            let already_executed = executed_queries.iter().cloned().collect::<BTreeSet<_>>();
            executed_queries.extend(
                preflight_executed_queries
                    .into_iter()
                    .filter(|query| !already_executed.contains(query)),
            );
            executed_queries.sort_by_key(|step| {
                WORKFLOW_QUERIES
                    .iter()
                    .position(|definition| definition.id == step)
                    .unwrap_or(usize::MAX)
            });
        }
        timer.finish();
        let timer = EnvelopeTimer::start("query_executions_build");
        let previous_query_observations = state.previous_query_observations.clone();
        let query_executions = build_runtime_query_executions(
            plan,
            options_value,
            exact_options_value,
            ingress_assignments,
            &tracked_execution.result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &executed_queries,
                materialize_full_outputs: request.command != QUERY_REVIEW_COMMAND,
                previous_observations: &mut state.previous_query_observations,
            },
        )?;
        let mut cache_sources = Vec::new();
        if restored_review_base {
            cache_sources.push("verified-review-base".to_string());
        }
        if restored_reconstruction_base {
            cache_sources.push("verified-reconstruction-base".to_string());
        }
        if should_report_salsa_memory(
            cache_sources.is_empty(),
            had_previous_query_observations,
            &query_executions,
        ) {
            cache_sources.push("salsa-memory".to_string());
        }
        let deactivated_groups = query_executions
            .iter()
            .filter(|execution| {
                execution.status == ExecutionStatus::Bypassed
                    && previous_query_observations
                        .get(&execution.query_id)
                        .is_some_and(|entry| entry.applicable)
            })
            .map(|execution| execution.query_group_id.as_str())
            .collect::<BTreeSet<_>>();
        timer.finish();
        let timer = EnvelopeTimer::start("project_query_groups");
        let result = tracked_execution.result;
        if let Some(consumed) = consumed_scientific_preflight {
            validate_b05_schoedel_finalization(
                &consumed.exact_b05_schoedel,
                &result.b05_schoedel_preflight,
            )?;
            validate_eyes_input_partition_finalization(
                &consumed.receipt.eyes_input_partition,
                result.eyes_input_partition_preflight.as_ref(),
            )?;
        }
        let (executions, node_artifacts) = project_query_groups(&services.store,
            plan,
            options_value,
            &result,
            &query_executions,
            &executed_queries.iter().map(String::as_str).collect(),
            &deactivated_groups,
            &mut state.previous_stage_inputs,
            &mut state.previous_stage_outputs,
            request.command != QUERY_REVIEW_COMMAND,
        )?;
        // Scientific preflight is a one-shot execution authorization. It was
        // taken before tracked work and must remain consumed after success or
        // failure; retaining the batch/token/literal-ID witness would leak
        // private partition state and could poison a later inactive request.
        state.pending_scientific_preflight = None;
        timer.finish();
        Ok(IncrementalPipelineExecution {
            result,
            raw_csv: match parked_raw_csv {
                Some(parked) => ExecutionRawCsv::Parked(parked),
                None => ExecutionRawCsv::Shared(csv_bytes),
            },
            output_payloads: tracked_execution.output_payloads,
            lineage_payload: tracked_execution.lineage_payload,
            review_base,
            reconstruction_base,
            query_group_executions: executions,
            query_executions,
            cache_sources,
            cache_decision,
            node_artifacts,
        })
    })();
    if outcome.is_err() {
        reset_incremental_state_after_store_failure(states, services, &request.workspace_id, store_failures_before);
    }
    outcome
}
