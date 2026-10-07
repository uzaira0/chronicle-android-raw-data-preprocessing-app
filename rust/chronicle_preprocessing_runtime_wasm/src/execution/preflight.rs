use super::execution_state::{ExecutionServices, IncrementalRuntimeStateCache, store_failures_at_request_entry, reset_incremental_state_after_store_failure};
use crate::{
    B05SchoedelPreflightResult,
    DependencyCacheMode,
    ExecutionEngine,
    EyesInputPartitionPreflightResult,
    IncrementalPipelineV2Engine,
    PendingScientificPreflightCommit,
    PipelineV2Options,
    PipelineV2SupportFiles,
    RawCsvBytes,
    RuntimeScientificPreflightKey,
    RuntimeScientificPreflightReceipt,
    RuntimeSupportFiles,
    RuntimeRequest,
    EnvelopeTimer,
    VerifiedRawInput,
    ScientificPreflightDisposition,
    align_incremental_state_workspace,
    build_scientific_preflight_receipt,
    prepared_cache_decision,
    scientific_preflight_is_executable,
    scientific_preflight_key,
    validate_scientific_preflight_receipt_integrity,
};

pub(crate) struct ScientificPreflightEvaluation {
    pub(crate) public_receipt: RuntimeScientificPreflightReceipt,
    pub(crate) exact_b05_schoedel: B05SchoedelPreflightResult,
    /// Product queries this preflight physically executed. The preflight forces
    /// `construct_screen_intervals` on the engine `execute` will reuse, so this
    /// is real work done inside the caller's request but outside
    /// `IncrementalPipelineV2Execution::executed_queries`. It is deliberately
    /// NOT part of `public_receipt` or `exact_b05_schoedel`, both of which are
    /// compared for equality between the prepared and the repeated preflight —
    /// the repeat legitimately executes nothing.
    pub(crate) executed_queries: Vec<String>,
}

pub(crate) fn preflight_on_incremental_engine(
    engine: &mut IncrementalPipelineV2Engine,
    raw_csv: RawCsvBytes<'_>,
    key: RuntimeScientificPreflightKey,
    options: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<ScientificPreflightEvaluation, String> {
    let expected_kernel_options_digest = support
        .verified_request_options_digest
        .ok_or("preflight support files must carry the computation options digest")?
        .to_owned();
    // `preflight_b05_schoedel` appends to the engine's preflight execution
    // buffer as a side effect, and only `take_preflight_executed_queries`
    // clears it. Returning early between the two — which the EYES partition
    // preflight below can do — left this request's physical executions in the
    // engine, where the NEXT request's drain picked them up and its manifest
    // reported them as work that request did. Drain unconditionally, so a
    // failed preflight's executions die with the failed request.
    let evaluated = (|| {
        let b05_schoedel = engine.preflight_b05_schoedel_raw(raw_csv, options, support)?;
        let eyes_input_partition = engine.preflight_eyes_complement_input_partition(
            raw_csv.as_slice(),
            options,
            support,
        )?;
        Ok::<_, String>((b05_schoedel, eyes_input_partition))
    })();
    let executed_queries = engine.take_preflight_executed_queries();
    let (b05_schoedel, eyes_input_partition) = evaluated?;
    let public_receipt = build_scientific_preflight_receipt(
        key,
        &expected_kernel_options_digest,
        &b05_schoedel,
        eyes_input_partition,
    )?;
    Ok(ScientificPreflightEvaluation {
        public_receipt,
        exact_b05_schoedel: b05_schoedel,
        executed_queries,
    })
}

/// `preflight_on_incremental_engine` for a sequential request: the same
/// receipt, bound by the kernel's sequential preflight over the raw bytes. No
/// tracked engine is touched, so nothing is memoized and no physical query
/// execution is reported here; the sequential pass reports every query.
pub(crate) fn preflight_on_sequential_engine(
    raw_csv: &VerifiedRawInput<'_>,
    key: RuntimeScientificPreflightKey,
    options: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<ScientificPreflightEvaluation, String> {
    let expected_kernel_options_digest = support
        .verified_request_options_digest
        .ok_or("preflight support files must carry the computation options digest")?
        .to_owned();
    let (b05_schoedel, eyes_input_partition) =
        chronicle_chrono_kernel_wasm::pipeline_v2::sequential_scientific_preflight_with_verified_input_and_stages(
            &chronicle_chrono_kernel_wasm::pipeline_v2::StageFunctions::production(),
            raw_csv, options, support,
        )?;
    let public_receipt = build_scientific_preflight_receipt(
        key,
        &expected_kernel_options_digest,
        &b05_schoedel,
        eyes_input_partition,
    )?;
    Ok(ScientificPreflightEvaluation {
        public_receipt,
        exact_b05_schoedel: b05_schoedel,
        executed_queries: Vec::new(),
    })
}

pub(crate) fn validate_repeated_scientific_preflight(
    expected: &PendingScientificPreflightCommit,
    repeated: &ScientificPreflightEvaluation,
) -> Result<(), String> {
    validate_scientific_preflight_receipt_integrity(&repeated.public_receipt)?;
    if repeated.public_receipt != expected.receipt
        || repeated.exact_b05_schoedel != expected.exact_b05_schoedel
    {
        return Err("scientific preflight changed before execution".into());
    }
    Ok(())
}

pub(crate) fn validate_b05_schoedel_finalization(
    prepared: &B05SchoedelPreflightResult,
    finalized: &B05SchoedelPreflightResult,
) -> Result<(), String> {
    if prepared != finalized {
        return Err("finalized B05/Schoedel receipt disagrees with scientific preflight".into());
    }
    Ok(())
}

pub(crate) fn validate_eyes_input_partition_finalization(
    prepared: &EyesInputPartitionPreflightResult,
    finalized: Option<&EyesInputPartitionPreflightResult>,
) -> Result<(), String> {
    match (prepared.disposition, finalized) {
        (ScientificPreflightDisposition::NotApplicable, None) => Ok(()),
        (ScientificPreflightDisposition::Executable, Some(finalized)) if prepared == finalized => {
            Ok(())
        }
        _ => {
            Err("finalized EYES input-partition receipt disagrees with scientific preflight".into())
        }
    }
}

pub(crate) fn scientific_preflight_native_raw(
    states: &mut IncrementalRuntimeStateCache,
    services: &ExecutionServices,
    request_json: &str,
    raw_csv: RawCsvBytes<'_>,
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    let csv_bytes = raw_csv.as_slice();
    let request: RuntimeRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("invalid request: {error}"))?;
    let timer = EnvelopeTimer::start("prepare_input_digest_verify");
    request.validate_fields()?;
    let verified_raw = VerifiedRawInput::verify_borrowed(csv_bytes, &request.input_sha256)?;
    timer.finish();
    let prepared = crate::prepare_runtime_workspace_verified(
        request,
        verified_raw.digest().to_owned(),
        csv_bytes,
        csv_bytes.len() as u64,
        support_files,
    )?;
    scientific_preflight_prepared(states, services, prepared, raw_csv)
}

pub(crate) fn scientific_preflight_prepared(
    states: &mut IncrementalRuntimeStateCache,
    services: &ExecutionServices,
    prepared: crate::PreparedRuntimeWorkspace,
    raw_csv: RawCsvBytes<'_>,
) -> Result<String, String> {
    let key = scientific_preflight_key(&prepared)?;
    let kernel_adapted = prepared.literature_input.as_ref()
        .filter(|a| crate::receipt_is_kernel_input_eligible(&a.receipt));
    let effective_raw_csv = kernel_adapted
        .map(|a| RawCsvBytes::Borrowed(a.csv_bytes.as_slice()))
        .unwrap_or(raw_csv);
    let effective_verified = VerifiedRawInput::verify_borrowed(
        effective_raw_csv.as_slice(), &key.input_digest,
    )?;
    let cache_decision = prepared_cache_decision(&prepared)?;
    let store_failures_before = store_failures_at_request_entry(&services.store);
    let receipt = (|| {
        let state = states.state_for(&prepared.request.workspace_id, services);
        align_incremental_state_workspace(services, state, prepared.request.workspace_root_digest.as_deref());
        if cache_decision.mode == DependencyCacheMode::ConservativeFull {
            state.incremental_engine = services.new_engine();
            state.previous_query_observations.clear();
            state.previous_stage_inputs.clear();
            state.previous_stage_outputs.clear();
            state.stable_artifact_bundle = None;
            state.pending_scientific_preflight = None;
        }
        let support = prepared.resolved_support.pipeline_files(
            &prepared.computation_options_digest,
            &prepared.ingress.assignments,
            &prepared.fragmented_participant_ids,
        );
        let evaluation = if prepared.request.execution_engine == ExecutionEngine::Sequential {
            // Nothing of a sequential request runs on the tracked engine.
            preflight_on_sequential_engine(
                &effective_verified,
                key,
                &prepared.pipeline_options,
                support,
            )?
        } else {
            preflight_on_incremental_engine(
                &mut state.incremental_engine,
                effective_raw_csv,
                key,
                &prepared.pipeline_options,
                support,
            )?
        };
        state.pending_scientific_preflight = scientific_preflight_is_executable(
            &prepared.pipeline_options,
            &evaluation.public_receipt,
        )
        .then(|| PendingScientificPreflightCommit {
            receipt: evaluation.public_receipt.clone(),
            exact_b05_schoedel: evaluation.exact_b05_schoedel.clone(),
            participant_partition_batch_id: prepared.request.participant_partition_batch_id.clone(),
            fragmented_participant_tokens: prepared.request.fragmented_participant_tokens.clone(),
            fragmented_participant_ids: prepared.fragmented_participant_ids.clone(),
            executed_queries: evaluation.executed_queries.clone(),
        });
        Ok::<_, String>(evaluation.public_receipt)
    })();
    if receipt.is_err() {
        reset_incremental_state_after_store_failure(states, services,
            &prepared.request.workspace_id,
            store_failures_before,
        );
    }
    let receipt = receipt?;
    serde_jcs::to_string(&receipt)
        .map_err(|error| format!("canonicalize scientific preflight receipt: {error}"))
}
