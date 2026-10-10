use super::StageFunctions;
use crate::payload_store::{PayloadStore, current_store};
use super::{scientific, output, checkpoint};
use super::checkpoint::{PreviousRowState, reusable_row_components_from_parts, workflow_checkpoint_with_group_parts};
use crate::pipeline_v2::{
    AHashSet, Arc, B05ComputationPhase, B05PreparedExecutionError, B05SchoedelPreflightResult,
    B05SchoedelPreparedInput, B05_RETAINED_RAW_INPUT_REQUIRED_ERROR,
    BTreeMap, BTreeSet, BoundSchoedelReconstruction, CodebookEntry, CountingSink,
    Digest, EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR,
    EyesInputPartitionPreflightResult, EyesTaggedFauValidationContext,
    FoundationalSemanticsEvidence, HashMap, MicroUseClassificationPolicy,
    NotificationContactOutput, OpenerSetEvidence, PayloadBytes, PipelineV2Options,
    CleaningCounts, PipelineV2Result, PipelineV2SupportFiles, PolledEmulationOutput, PreflightRows, RawRow, Row,
    RowCheckpointParts, SchoedelValidationWitness, ScientificPreflightDisposition,
    ScreenCreditOutput, ScreenSessionConstructionStrategyId, Sha256,
    UsageSessionMode, WorkflowCheckpoint, add_app_usage_detail_columns,
    add_no_activity_placeholder_rows, aggregates, annotations, attribution, apply_event_retention,
    apply_study_window, assign_usage_session_ids, attach_concurrent_subinterval_floor_evidence,
    attach_zero_duration_cleanup_evidence, attribute_person, b05, b05_identity_from_support,
    b05_schoedel_is_active, b05_schoedel_refusal_error, b06,
    bind_finalized_b05_preflight, bound_schoedel_reconstruction,
    build_compliance_csv, build_day_coverage_csv,
    build_review_summary, build_row_lineage,
    build_row_lineage_from_iter, build_screen_row_lineage, build_visualization_data,
    checkpoint_for_exact_row_state, checkpoint_for_exact_state, chronicle_interval_inputs,
    chronicle_orphan_stop_issues, collapse_app_genre, count_duplicate_groups, credit,
    derive_broad_category, derive_screen_usage_sessions_full, eyes_complement_is_active,
    eyes_input_partition_identity_from_support, eyes_input_partition_refusal_error,
    finalize_chronicle_b05_screen, foundational_output_projection, foundational_semantics_evidence,
    headline_eligible_app_rows, inactive_b05_preflight, index_raw_dates, join_codebook,
    label_filtered_apps, mark_app_usage_flags, materialize_b05_screen_rows,
    materialize_schoedel_candidate_rows, maximum_duration_evidence_for_rows,
    maximum_duration_row_stage, neutral_b05_screen_construction_checkpoint, notification,
    parse_apps_forcing_csv, parse_background_apps_csv, parse_codebook_csv, parse_device_sharing,
    parse_enrolled_devices, parse_filter_csv, parse_schoedel_capability_evidence,
    parse_study_windows, parse_survey_lookup, participant_event_timestamps,
    participant_input_boundary_from_support, polled,
    preflight_eyes_input_partition_with_raw_digest,
    raw_b05_events, reconstruction, record_workflow_checkpoint, resolve_participant_windows,
    row_checkpoint_parts_for_rows, schoedel_is_active, schoedel_opener_evidence, screen,
    seconds_to_ns_floor, session_grouping_checkpoint_payload, sha256_wire,
    source, split_sessions_at_local_midnight,
    timezone_retained_source_rows_digest, timezone_stage_digest,
    validate_foundational_semantics_evidence_for_options, validate_pipeline_v2_options,
    validate_prepared_b05_schoedel_with_raw_digest, validate_verified_request_options_digest,
    value_fingerprint, workflow_checkpoint, workflow_checkpoint_with_parts,
    workflow_rows_checkpoint,
    workflow_rows_checkpoint_reusing_last, workflow_state_checkpoint, write_app_csv,
    write_app_csv_from_iter, write_selected_screen_csv,
};

pub(crate) struct QueryCheckpointRecorder<'a> {
    pub(crate) digests: &'a mut BTreeMap<String, String>,
    pub(crate) checkpoints: &'a mut BTreeMap<String, WorkflowCheckpoint>,
    pub(crate) remaining_queries: std::slice::Iter<'static, crate::workflow_contract::WorkflowQueryDefinition>,
    pub(crate) error: Option<String>,
    pub(crate) last_row_parts: Option<Vec<RowCheckpointParts>>,
    pub(crate) last_row_checkpoint: Option<WorkflowCheckpoint>,
    pub(crate) last_canonical_order: Option<Vec<usize>>,
}

impl QueryCheckpointRecorder<'_> {
    fn row_checkpoint(&mut self, query_id: &str, rows: &[Row], payloads: &[(&str, &[u8])]) -> WorkflowCheckpoint {
        let parts = row_checkpoint_parts_for_rows(rows);
        let previous = if let (Some(previous_parts), Some(previous_checkpoint)) = (
            self.last_row_parts.as_deref(),
            self.last_row_checkpoint.as_ref(),
        ) {
            Some(PreviousRowState {
                checkpoint: previous_checkpoint,
                reusable_components: reusable_row_components_from_parts(&parts, previous_parts),
            })
        } else {
            None
        };
        let same_identity = previous.is_some_and(|state| state.reusable_components.0);
        let canonical_order = if same_identity {
            self.last_canonical_order.take().unwrap_or_else(|| canonical_row_order(rows))
        } else {
            canonical_row_order(rows)
        };
        let group_parts = [parts.as_slice()];
        let checkpoint = workflow_checkpoint_with_group_parts(
            query_id, &[("rows", rows)], payloads, Some(&group_parts), previous,
            Some(&canonical_order),
        );
        self.last_row_parts = Some(parts);
        self.last_row_checkpoint = Some(checkpoint.clone());
        self.last_canonical_order = Some(canonical_order);
        checkpoint
    }

    pub(crate) fn rows(&mut self, query_id: &str, rows: &[Row]) {
        let checkpoint = self.row_checkpoint(query_id, rows, &[]);
        self.record(checkpoint);
    }

    pub(crate) fn state(&mut self, query_id: &str, state: &str) {
        self.record(workflow_state_checkpoint(query_id, state));
    }

    pub(crate) fn value<T: serde::Serialize>(&mut self, query_id: &str, value: &T) -> Result<(), String> {
        let fingerprint = value_fingerprint(value)
            .map_err(|error| format!("serialize {query_id} checkpoint: {error}"))?;
        self.record(workflow_checkpoint(
            query_id,
            &[],
            &[("value", &fingerprint)],
        ));
        Ok(())
    }

    pub(crate) fn rows_and_value<T: serde::Serialize>(
        &mut self,
        query_id: &str,
        rows: &[Row],
        value: &T,
    ) -> Result<(), String> {
        let fingerprint = value_fingerprint(value)
            .map_err(|error| format!("serialize {query_id} checkpoint: {error}"))?;
        let payloads = [("value", fingerprint.as_slice())];
        let checkpoint = self.row_checkpoint(query_id, rows, &payloads);
        self.record(checkpoint);
        Ok(())
    }

    pub(crate) fn last_row_parts(&self) -> Option<&[RowCheckpointParts]> {
        self.last_row_parts.as_deref()
    }

    pub(crate) fn take_last_row_parts(&mut self) -> Option<Vec<RowCheckpointParts>> {
        self.last_row_checkpoint = None;
        self.last_canonical_order = None;
        self.last_row_parts.take()
    }

    pub(crate) fn reusable_row_components(
        &self,
        rows: &[Row],
    ) -> Option<(&[RowCheckpointParts], &WorkflowCheckpoint)> {
        let parts = self.last_row_parts.as_deref()?;
        if parts.len() != rows.len() {
            return None;
        }
        #[cfg(debug_assertions)]
        assert_eq!(
            parts,
            row_checkpoint_parts_for_rows(rows),
            "attempted to reuse stale row checkpoint components"
        );
        Some((parts, self.last_row_checkpoint.as_ref()?))
    }

    pub(crate) fn record(&mut self, checkpoint: WorkflowCheckpoint) {
        checkpoint::record_completed_checkpoint(self, checkpoint);
    }

    pub(crate) fn finish(mut self) -> Result<(), String> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if let Some(next) = self.remaining_queries.next() {
            return Err(format!(
                "workflow query checkpoint sequence stopped before {:?}",
                next.id,
            ));
        }
        Ok(())
    }
}

fn canonical_row_order(rows: &[Row]) -> Vec<usize> {
    let mut order = (0..rows.len()).collect::<Vec<_>>();
    let compare = |left: usize, right: usize| {
        rows[left]
            .source_data_rows
            .cmp_expanded(&rows[right].source_data_rows)
            .then(rows[left].index.cmp(&rows[right].index))
            .then(left.cmp(&right))
    };
    if order.windows(2).any(|pair| compare(pair[0], pair[1]).is_gt()) {
        order.sort_unstable_by(|left, right| compare(*left, *right));
    }
    order
}

impl checkpoint::CheckpointRecorder for QueryCheckpointRecorder<'_> {
    fn record_checkpoint(&mut self, checkpoint: WorkflowCheckpoint) {
        if self.error.is_some() {
            return;
        }
        let Some(expected) = self.remaining_queries.next() else {
            self.error = Some(format!(
                "unexpected extra workflow query checkpoint {:?}",
                checkpoint.subject_id
            ));
            return;
        };
        if checkpoint.subject_id != expected.id {
            self.error = Some(format!(
                "workflow query checkpoint order mismatch: expected {:?}, recorded {:?}",
                expected.id, checkpoint.subject_id
            ));
            return;
        }
        if self.checkpoints.contains_key(&checkpoint.subject_id) {
            self.error = Some(format!(
                "duplicate workflow query checkpoint {:?}",
                checkpoint.subject_id
            ));
            return;
        }
        record_workflow_checkpoint(self.digests, self.checkpoints, checkpoint);
    }
}

pub(crate) fn parse_raw_rows(
    stages: &StageFunctions,
    raw_rows: Vec<RawRow>,
    opts: &PipelineV2Options,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<(Vec<Row>, String, u32), String> {
    let interaction_remap = source::validate_remap_rules(&opts.interaction_type_remap);
    query_checkpoints.value("validate_remap_rules", &interaction_remap)?;
    query_checkpoints.value("decode_source_records", &raw_rows)?;

    let raw_rows = source::remove_missing_timestamps(raw_rows);
    query_checkpoints.value("remove_missing_timestamps", &raw_rows)?;

    let possible_device_model = source::attach_device_models(&raw_rows);
    query_checkpoints.value("attach_device_models", &possible_device_model)?;
    let rows = (stages.canonicalize_source_rows)(
        &raw_rows,
        &opts.timezone,
        &interaction_remap,
        &possible_device_model,
    )?;
    query_checkpoints.rows("canonicalize_source_rows", &rows);

    let rows_before_ordering = rows.len();
    let rows = source::order_source_records_with_policy(rows, opts.drop_out_of_source_order_events);
    let out_of_order_events_dropped = rows_before_ordering.saturating_sub(rows.len()) as u32;
    query_checkpoints.rows("order_source_records", &rows);
    let available_timezones = source::collect_timezone_observations(&rows);
    query_checkpoints.value("collect_timezone_observations", &available_timezones)?;

    Ok((rows, opts.timezone.clone(), out_of_order_events_dropped))
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(crate) fn process_usage_rows(
    stages: &StageFunctions,
    rows: Vec<Row>,
    background_apps: &AHashSet<String>,
    filtered_packages: &BTreeSet<String>,
    filtered_application_labels: &AHashSet<String>,
    interactive_screen_rows: &[Row],
    screen_duration_excluded_participants: &BTreeSet<String>,
    opts: &PipelineV2Options,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<
    (
        Vec<Row>,
        OpenerSetEvidence,
        FoundationalSemanticsEvidence,
        Option<b06::MaximumDurationEvidence>,
        Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
        BTreeSet<String>,
    ),
    String,
> {
    let matcher_input = reconstruction::build_app_event_index(
        &rows,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
        background_apps,
        opts.model_concurrent_usage,
    )?;
    query_checkpoints.value("build_app_event_index", &matcher_input)?;
    let result = (stages.match_app_episodes_with_strategy)(
        &matcher_input,
        &rows,
        opts.episode_reconstruction_strategy,
        opts.opener_set,
        opts.allow_stop_event_reuse,
        opts.use_activity_stopped_as_fallback,
        opts.apply_threshold_to_fallback,
        opts.long_duration_threshold_ns,
        opts.proximity_interval_ns,
    )?;
    query_checkpoints.value("match_app_episodes", &result)?;

    let next = reconstruction::materialize_candidate_episodes(rows, &result, filtered_packages);
    query_checkpoints.rows("materialize_candidate_episodes", &next);

    let out = (stages.classify_episode_durations)(
        next,
        &reconstruction::timing_blanked_packages(filtered_packages, background_apps),
        opts.micro_use_classification_policy,
        opts.minimum_usage_duration,
        opts.minimum_duration_comparator,
        opts.minimum_duration_disposition,
        &result.selected_nonresume_closed_indices,
        &maximum_duration_row_stage(opts),
    )?;
    query_checkpoints.rows("classify_episode_durations", &out);
    let mut foundational_evidence = foundational_semantics_evidence(&out, opts);
    let maximum_duration_evidence = maximum_duration_evidence_for_rows(&out, opts)?;

    let out = reconstruction::apply_app_inclusion_policy(out, filtered_packages, filtered_application_labels, background_apps);
    let out = if opts.locked_screen_audio_disposition
        == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
    {
        screen::bound_app_rows_to_interactive_screen(out, interactive_screen_rows)
    } else {
        out
    };
    let out = screen::remove_participants(out, screen_duration_excluded_participants);
    query_checkpoints.rows("apply_app_inclusion_policy", &out);

    let out = reconstruction::order_app_episodes(out);
    query_checkpoints.rows("order_app_episodes", &out);

    let out = reconstruction::segment_concurrent_usage(
        out,
        filtered_packages,
        background_apps,
        opts.model_concurrent_usage,
        opts.minimum_usage_duration,
        opts.apply_minimum_usage_duration_to_concurrent_subintervals,
    )?;
    query_checkpoints.rows("segment_concurrent_usage", &out);
    attach_concurrent_subinterval_floor_evidence(
        &mut foundational_evidence,
        &out,
        opts.minimum_usage_duration,
        opts.apply_minimum_usage_duration_to_concurrent_subintervals,
        true,
    );
    Ok((
        out,
        result.opener_set_evidence,
        foundational_evidence,
        maximum_duration_evidence,
        result.eyes_tagged_fau_evidence,
        result.eyes_validation_expected_participant_ids,
    ))
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(crate) fn run_schoedel_app_usage_algorithm(
    stages: &StageFunctions,
    mut rows: Vec<Row>,
    opts: &PipelineV2Options,
    background_apps: &AHashSet<String>,
    filtered_application_labels: &AHashSet<String>,
    interactive_screen_rows: &[Row],
    screen_duration_excluded_participants: &BTreeSet<String>,
    original_raw_events: &[b05::RawB05Event],
    raw_input_sha256: &str,
    parsed_capability_evidence: Option<&b05::ParsedCapabilityEvidence>,
    preflight: &mut B05SchoedelPreflightResult,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<
    (
        (
            Vec<Row>,
            OpenerSetEvidence,
            FoundationalSemanticsEvidence,
            Option<b06::MaximumDurationEvidence>,
            Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
        ),
        SchoedelValidationWitness,
    ),
    String,
> {
    let filtered_packages = reconstruction::resolve_excluded_packages(&rows);
    query_checkpoints.value("resolve_excluded_packages", &filtered_packages)?;
    rows = apply_event_retention(
        reconstruction::mask_excluded_app_events(rows),
        opts.event_retention_set,
    );
    query_checkpoints.rows("mask_excluded_app_events", &rows);

    // Preserve the workflow meaning of `build_app_event_index`: it is the
    // canonical post-B01 matcher index even though the Schoedel arm consumes
    // the richer retained raw-key stream below. The tracked path materializes
    // the same index checkpoint before its dedicated Schoedel preflight.
    let matcher_input = reconstruction::build_app_event_index(
        &rows,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
        background_apps,
        opts.model_concurrent_usage,
    )?;
    query_checkpoints.value("build_app_event_index", &matcher_input)?;
    let screen = preflight
        .screen_construction
        .as_ref()
        .ok_or_else(|| "schoedel_execution_error:b05_screen_construction_absent".to_string())?;
    let BoundSchoedelReconstruction {
        reconstruction,
        retained_events,
        participant_ids,
    } = bound_schoedel_reconstruction(
        &rows,
        opts,
        original_raw_events,
        raw_input_sha256,
        parsed_capability_evidence,
        screen,
    )?;
    query_checkpoints.value("match_app_episodes", &reconstruction)?;
    preflight.schoedel_reconstruction = Some(reconstruction.clone());
    preflight.schoedel_reconstruction_phase = B05ComputationPhase::Finalized;
    if !reconstruction.applicability.executable {
        preflight.disposition = ScientificPreflightDisposition::Refused;
        return Err(b05_schoedel_refusal_error(preflight));
    }

    let (materialized_checkpoint_rows, selected_nonresume_closed_indices) =
        materialize_schoedel_candidate_rows(&rows, &reconstruction)?;
    query_checkpoints.rows(
        "materialize_candidate_episodes",
        &materialized_checkpoint_rows,
    );

    let classified = (stages.classify_episode_durations)(
        materialized_checkpoint_rows,
        &reconstruction::timing_blanked_packages(&filtered_packages, background_apps),
        opts.micro_use_classification_policy,
        opts.minimum_usage_duration,
        opts.minimum_duration_comparator,
        opts.minimum_duration_disposition,
        &selected_nonresume_closed_indices,
        &maximum_duration_row_stage(opts),
    )?;
    query_checkpoints.rows("classify_episode_durations", &classified);
    let mut foundational_evidence = foundational_semantics_evidence(&classified, opts);
    let maximum_duration_evidence = maximum_duration_evidence_for_rows(&classified, opts)?;
    let included = reconstruction::apply_app_inclusion_policy(classified, &filtered_packages, filtered_application_labels, background_apps);
    let included = if opts.locked_screen_audio_disposition
        == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
    {
        screen::bound_app_rows_to_interactive_screen(included, interactive_screen_rows)
    } else {
        included
    };
    let included = screen::remove_participants(included, screen_duration_excluded_participants);
    query_checkpoints.rows("apply_app_inclusion_policy", &included);
    let ordered = reconstruction::order_app_episodes(included);
    query_checkpoints.rows("order_app_episodes", &ordered);
    let segmented = reconstruction::segment_concurrent_usage(
        ordered,
        &filtered_packages,
        background_apps,
        opts.model_concurrent_usage,
        opts.minimum_usage_duration,
        opts.apply_minimum_usage_duration_to_concurrent_subintervals,
    )?;
    query_checkpoints.rows("segment_concurrent_usage", &segmented);
    attach_concurrent_subinterval_floor_evidence(
        &mut foundational_evidence,
        &segmented,
        opts.minimum_usage_duration,
        opts.apply_minimum_usage_duration_to_concurrent_subintervals,
        true,
    );
    Ok((
        (
            segmented,
            schoedel_opener_evidence(&rows, &reconstruction.episodes, opts.opener_set),
            foundational_evidence,
            maximum_duration_evidence,
            Vec::new(),
        ),
        SchoedelValidationWitness {
            trusted_retained_event_count: retained_events.len() as u64,
            decisive_participant_ids: participant_ids,
        },
    ))
}

pub(crate) fn apply_screen_gated_credit_incremental(
    app_rows: &[Row],
    raw_events: &[Row],
    opts: &PipelineV2Options,
    include_aliases: bool,
    input_row_parts: Option<&[RowCheckpointParts]>,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<ScreenCreditOutput, String> {
    let partition = credit::identify_credit_eligible_sessions(app_rows, input_row_parts)?;
    query_checkpoints.value(
        "identify_credit_eligible_sessions",
        &partition.checkpoint_payload(),
    )?;

    let substrate = credit::build_activity_witness_indexes(raw_events)?;
    query_checkpoints.value("build_activity_witness_indexes", &substrate)?;
    let screen_incapable = credit::screen_incapable_participants(&partition, &substrate);
    query_checkpoints.value("assess_screen_evidence_capability", &screen_incapable)?;

    let day_apps = credit::summarize_daily_apps(&partition);
    let day_app_checkpoint = checkpoint::daily_apps_checkpoint_payload(&day_apps);
    query_checkpoints.value("summarize_daily_apps", &day_app_checkpoint)?;

    let decisions = credit::derive_credited_intervals(
        &partition,
        &substrate,
        &day_apps,
        opts.credited_session_cap_minutes,
        opts.device_liveness_gap_tolerance_minutes,
        opts.auto_lock_bridge_seconds,
        opts.bridge_screen_off_to_session_end,
        opts.no_witness_min_day_apps,
        opts.screen_gating_rule,
    );
    query_checkpoints.value(
        "derive_credited_intervals",
        &checkpoint::credit_decisions_checkpoint_payload(
            &decisions, opts.device_liveness_gap_tolerance_minutes,
        ),
    )?;

    let emission = credit::materialize_credited_rows(
        &partition,
        &decisions,
        &substrate,
        opts.device_liveness_gap_tolerance_minutes,
    );
    query_checkpoints.value(
        "materialize_credited_rows",
        &emission.checkpoint_payload(),
    )?;
    let result = credit::assemble_credit_outputs(&partition, &screen_incapable, &emission);
    query_checkpoints.value(
        "assemble_credit_outputs",
        &result.checkpoint_payload(),
    )?;
    let assemble_terminal_digest = query_checkpoints
        .checkpoints
        .get("assemble_credit_outputs")
        .expect("assemble credit checkpoint was just recorded")
        .terminal_digest
        .clone();
    let effective_usage_checkpoint = workflow_checkpoint(
        "effective_usage",
        &[],
        &[(
            "assemble_credit_outputs",
            assemble_terminal_digest.as_bytes(),
        )],
    );
    let row_count = u32::try_from(result.rows.len())
        .map_err(|_| "credited app row count exceeds u32".to_string())?;
    let csv_bytes = write_app_csv_from_iter(result.rows.iter(), opts, include_aliases);
    let row_lineage =
        build_row_lineage_from_iter("credited-app-csv", "effective_usage", result.rows.iter());
    Ok(ScreenCreditOutput {
        csv_bytes,
        row_count,
        row_lineage,
        effective_usage_checkpoint,
    })
}

/// B08. Emit each admitted notification row as a proxy contact event.
///
/// The emitted row is the RAW row itself, not a fabrication: its
/// `event_timestamp` is the notification instant, its `interaction_type` is
/// the canonical source type, and its start/stop/duration are already absent
/// because a notification is an instant and this channel refuses to invent an
/// interval for it. What the pipeline adds is the codebook join every app row
/// receives and two flags recording the rule and the observed-usage join.
///
/// The four steps below are the same functions the tracked queries call, so
/// this sequential path stays a real independent oracle rather than a second
/// implementation that could drift.
pub(crate) fn derive_notification_contacts_incremental(
    app_rows: &[Row],
    policy_rows: &[Row],
    opts: &PipelineV2Options,
    codebook_map: &HashMap<String, CodebookEntry>,
    include_aliases: bool,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<NotificationContactOutput, String> {
    let rule = opts.notification_proxy_rule;
    let mut contacts = notification::select_notification_events(policy_rows, rule);
    query_checkpoints.rows_and_value(
        "select_notification_events",
        &contacts,
        &notification::notification_selection_checkpoint(&contacts, rule),
    )?;

    let spans = notification::index_observed_usage_spans(app_rows);
    query_checkpoints.value("index_observed_usage_spans", &spans)?;

    let counts = notification::classify_notification_contacts(&mut contacts, &spans, rule);
    query_checkpoints.rows_and_value("classify_notification_contacts", &contacts, &counts)?;

    // The same enrichment every app row receives, from the same owner. A proxy
    // channel with blank category columns would be a second, poorer join.
    annotations::enrich_codebook_rows(&mut contacts, opts.use_app_codebook, codebook_map);
    query_checkpoints.rows_and_value(
        "assemble_notification_contact_outputs",
        &contacts,
        &annotations::codebook_checkpoint_payload(codebook_map.is_empty()),
    )?;

    let assemble_terminal_digest = query_checkpoints
        .checkpoints
        .get("assemble_notification_contact_outputs")
        .expect("notification contact checkpoint was just recorded")
        .terminal_digest
        .clone();
    let checkpoint = workflow_checkpoint(
        "notification_proxy",
        &[],
        &[(
            "assemble_notification_contact_outputs",
            assemble_terminal_digest.as_bytes(),
        )],
    );
    let row_count = u32::try_from(contacts.len())
        .map_err(|_| "notification contact row count exceeds u32".to_string())?;
    let csv_bytes = write_app_csv_from_iter(contacts.iter(), opts, include_aliases);
    let row_lineage = build_row_lineage_from_iter(
        "notification-contact-csv",
        "notification_proxy",
        contacts.iter(),
    );
    Ok(NotificationContactOutput {
        csv_bytes,
        row_count,
        row_lineage,
        checkpoint,
    })
}

/// B09. Sequential oracle for the polled-emulation channel, calling the same
/// `incremental::` helpers the tracked queries call so this path stays a real
/// independent oracle rather than a second implementation that could drift.
///
/// It reads the reconstructed episode rows, not the raw rows: a polled
/// collector records what is FOREGROUND at an instant, and only an episode
/// says that. Package exclusion is whatever the run's filter file and
/// `package_exclusion_preset` already decided upstream -- Ross's launcher and
/// System UI list is not re-litigated here, because this repository already
/// owns that decision and a second list would be a second authority.
#[allow(clippy::too_many_arguments)]
pub(crate) fn derive_polled_emulation_incremental(
    app_rows: &[Row],
    opts: &PipelineV2Options,
    codebook_map: &HashMap<String, CodebookEntry>,
    include_aliases: bool,
    query_checkpoints: &mut QueryCheckpointRecorder<'_>,
) -> Result<PolledEmulationOutput, String> {
    let method = opts.polled_emulation_method;
    let interval_ns = seconds_to_ns_floor(opts.polled_emulation_interval_seconds);
    let gap_ns = seconds_to_ns_floor(opts.polled_emulation_gap_seconds);

    let samples = polled::sample_polled_timeline(app_rows, interval_ns);
    query_checkpoints.value(
        "sample_polled_timeline",
        &polled::polled_sample_checkpoint(interval_ns, samples.len()),
    )?;

    let runs = polled::group_polled_runs(app_rows, &samples, method, interval_ns, gap_ns);
    let counts = polled::polled_counts(method, interval_ns, gap_ns, samples.len(), &runs);
    query_checkpoints.value("group_polled_runs", &counts)?;

    let mut emulated =
        polled::materialize_polled_rows(app_rows, &runs, method, interval_ns);
    query_checkpoints.rows_and_value("materialize_polled_rows", &emulated, &counts)?;

    // The same enrichment every app row receives, from the same owner.
    annotations::enrich_codebook_rows(&mut emulated, opts.use_app_codebook, codebook_map);
    query_checkpoints.rows_and_value(
        "assemble_polled_emulation_outputs",
        &emulated,
        &annotations::codebook_checkpoint_payload(codebook_map.is_empty()),
    )?;

    let assemble_terminal_digest = query_checkpoints
        .checkpoints
        .get("assemble_polled_emulation_outputs")
        .expect("polled emulation checkpoint was just recorded")
        .terminal_digest
        .clone();
    let checkpoint = workflow_checkpoint(
        "polled_emulation",
        &[],
        &[(
            "assemble_polled_emulation_outputs",
            assemble_terminal_digest.as_bytes(),
        )],
    );
    let row_count = u32::try_from(emulated.len())
        .map_err(|_| "polled emulation row count exceeds u32".to_string())?;
    let csv_bytes = write_app_csv_from_iter(emulated.iter(), opts, include_aliases);
    let row_lineage = build_row_lineage_from_iter(
        "polled-emulation-csv",
        "polled_emulation",
        emulated.iter(),
    );
    Ok(PolledEmulationOutput {
        csv_bytes,
        row_count,
        row_lineage,
        checkpoint,
    })
}

// ---- main runner --------------------------------------------------------

pub fn run_pipeline_v2(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    filter_csv: &[u8],
    apps_forcing_csv: &[u8],
    codebook_csv: &[u8],
) -> Result<PipelineV2Result, String> {
    run_pipeline_v2_with_supports(
        csv_bytes,
        opts,
        PipelineV2SupportFiles {
            filter_csv,
            apps_forcing_csv,
            codebook_csv,
            ..PipelineV2SupportFiles::default()
        },
    )
}

pub fn run_pipeline_v2_with_background(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    filter_csv: &[u8],
    apps_forcing_csv: &[u8],
    background_apps_csv: &[u8],
    codebook_csv: &[u8],
) -> Result<PipelineV2Result, String> {
    run_pipeline_v2_with_supports(
        csv_bytes,
        opts,
        PipelineV2SupportFiles {
            filter_csv,
            apps_forcing_csv,
            background_apps_csv,
            codebook_csv,
            ..PipelineV2SupportFiles::default()
        },
    )
}

pub fn run_pipeline_v2_with_supports(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PipelineV2Result, String> {
    run_pipeline_v2_with_supports_and_dependencies(StageFunctions::production(), current_store(), csv_bytes, opts, support)
}

pub fn run_pipeline_v2_with_supports_and_dependencies(
    stages: StageFunctions,
    store: PayloadStore,
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PipelineV2Result, String> {
    let run = prepare_sequential_run_with_dependencies(stages, store, csv_bytes, opts, support)?;
    run_prepared_sequential(run, opts, support)
}

/// Everything the sequential scheduler takes from the raw bytes: the decoded
/// rows with their B05 substrate, and the EYES input-partition receipt. Once
/// it exists the pass reads no byte of the file, so a caller may release its
/// copy before `run_prepared_sequential`.
pub struct PreparedSequentialRun {
    stages: StageFunctions,
    store: PayloadStore,
    pub(crate) prepared: B05SchoedelPreparedInput,
    pub(crate) eyes_input_partition_preflight: Option<EyesInputPartitionPreflightResult>,
}

/// A digest bound to the immutable bytes that were hashed. Callers cannot
/// supply a digest separately from the bytes consumed by the sequential
/// scheduler. The owned form lets the runtime hand its existing `Arc` through
/// validation without copying or hashing it again.
pub struct VerifiedRawInput<'a> {
    bytes: VerifiedRawBytes<'a>,
    digest: String,
}

enum VerifiedRawBytes<'a> {
    Borrowed(&'a [u8]),
    Owned(Arc<Vec<u8>>),
}

impl<'a> VerifiedRawInput<'a> {
    pub fn verify_borrowed(bytes: &'a [u8], declared_digest: &str) -> Result<Self, String> {
        let digest = sha256_wire(bytes);
        if digest != declared_digest {
            return Err(format!("input digest mismatch: declared={declared_digest} actual={digest}"));
        }
        Ok(Self { bytes: VerifiedRawBytes::Borrowed(bytes), digest })
    }

    pub fn digest(&self) -> &str {
        &self.digest
    }

    pub fn bytes(&self) -> &[u8] {
        match &self.bytes {
            VerifiedRawBytes::Borrowed(bytes) => bytes,
            VerifiedRawBytes::Owned(bytes) => bytes,
        }
    }
}

impl VerifiedRawInput<'static> {
    pub fn verify_owned(bytes: Arc<Vec<u8>>, declared_digest: &str) -> Result<Self, String> {
        let digest = sha256_wire(&bytes);
        if digest != declared_digest {
            return Err(format!("input digest mismatch: declared={declared_digest} actual={digest}"));
        }
        Ok(Self { bytes: VerifiedRawBytes::Owned(bytes), digest })
    }

    pub fn shared_bytes(&self) -> Arc<Vec<u8>> {
        match &self.bytes {
            VerifiedRawBytes::Owned(bytes) => Arc::clone(bytes),
            VerifiedRawBytes::Borrowed(_) => unreachable!("owned verified input"),
        }
    }

    pub fn into_shared_bytes(self) -> Arc<Vec<u8>> {
        match self.bytes {
            VerifiedRawBytes::Owned(bytes) => bytes,
            VerifiedRawBytes::Borrowed(_) => unreachable!("owned verified input"),
        }
    }
}

/// The raw-byte stage of `run_pipeline_v2_with_supports`.
pub fn prepare_sequential_run(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PreparedSequentialRun, String> {
    prepare_sequential_run_with_dependencies(StageFunctions::production(), current_store(), csv_bytes, opts, support)
}

pub fn prepare_sequential_run_with_dependencies(
    stages: StageFunctions,
    store: PayloadStore,
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PreparedSequentialRun, String> {
    let raw_input_sha256 = sha256_wire(csv_bytes);
    prepare_sequential_run_with_verified_digest_and_dependencies(
        stages, store, csv_bytes, raw_input_sha256, opts, support,
    )
}

/// Use the raw digest already verified by the caller against these exact bytes.
/// The runtime verifies the request bytes before calling this entry point.
pub(crate) fn prepare_sequential_run_with_verified_digest_and_dependencies(
    stages: StageFunctions,
    store: PayloadStore,
    csv_bytes: &[u8],
    raw_input_sha256: String,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PreparedSequentialRun, String> {
    validate_pipeline_v2_options(opts).map_err(|error| error.to_string())?;
    let prepared = scientific::prepare_b05_schoedel_with_raw_digest_with_stages(
        &stages,
        csv_bytes,
        raw_input_sha256.clone(),
        opts,
        support.input_capability_evidence_csv,
        b05_identity_from_support(support),
        participant_input_boundary_from_support(support),
    )
    .map_err(|error| error.to_string())?;
    prepare_sequential_run_with_prepared_b05_and_dependencies(
        stages, store,
        csv_bytes,
        opts,
        support,
        prepared,
        Some(raw_input_sha256),
    )
}

pub fn prepare_sequential_run_with_verified_input_and_dependencies(
    stages: StageFunctions,
    store: PayloadStore,
    verified: &VerifiedRawInput<'_>,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PreparedSequentialRun, String> {
    prepare_sequential_run_with_verified_digest_and_dependencies(
        stages, store, verified.bytes(), verified.digest().to_owned(), opts, support,
    )
}

/// The scientific preflight of the sequential scheduler. It binds the receipt
/// `IncrementalPipelineV2Engine::preflight_b05_schoedel` binds -- the same
/// screen construction and Schoedel reconstruction, computed with the
/// sequential helpers over the raw bytes and memoizing nothing -- together
/// with the EYES input-partition receipt. `execute` finalizes the sequential
/// run against it exactly as it does against the tracked receipt.
pub fn sequential_scientific_preflight(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<(B05SchoedelPreflightResult, EyesInputPartitionPreflightResult), String> {
    sequential_scientific_preflight_with_stages(&StageFunctions::production(), csv_bytes, opts, support)
}

pub fn sequential_scientific_preflight_with_stages(
    stages: &StageFunctions,
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<(B05SchoedelPreflightResult, EyesInputPartitionPreflightResult), String> {
    let raw_input_sha256 = sha256_wire(csv_bytes);
    sequential_scientific_preflight_with_verified_digest_and_stages(
        stages, csv_bytes, raw_input_sha256, opts, support,
    )
}

/// Use the raw digest already verified by the caller against these exact bytes.
pub(crate) fn sequential_scientific_preflight_with_verified_digest_and_stages(
    stages: &StageFunctions,
    csv_bytes: &[u8],
    raw_input_sha256: String,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<(B05SchoedelPreflightResult, EyesInputPartitionPreflightResult), String> {
    validate_pipeline_v2_options(opts).map_err(|error| error.to_string())?;
    validate_verified_request_options_digest(support.verified_request_options_digest)?;
    let b05_schoedel =
        sequential_b05_schoedel_preflight(stages, csv_bytes, &raw_input_sha256, opts, support)?;
    let eyes_input_partition = preflight_eyes_input_partition_with_raw_digest(
        raw_input_sha256,
        opts,
        eyes_input_partition_identity_from_support(support),
        participant_input_boundary_from_support(support),
    )
    .map_err(|error| error.to_string())?;
    Ok((b05_schoedel, eyes_input_partition))
}

pub fn sequential_scientific_preflight_with_verified_input_and_stages(
    stages: &StageFunctions,
    verified: &VerifiedRawInput<'_>,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<(B05SchoedelPreflightResult, EyesInputPartitionPreflightResult), String> {
    sequential_scientific_preflight_with_verified_digest_and_stages(
        stages, verified.bytes(), verified.digest().to_owned(), opts, support,
    )
}

pub(crate) fn sequential_b05_schoedel_preflight(
    stages: &StageFunctions,
    csv_bytes: &[u8],
    raw_input_sha256: &str,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<B05SchoedelPreflightResult, String> {
    let verified_request_options_digest = support.verified_request_options_digest;
    if !b05_schoedel_is_active(opts) {
        return Ok(inactive_b05_preflight(opts, verified_request_options_digest));
    }
    if csv_bytes.is_empty() {
        return Err(B05_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
    }
    let B05SchoedelPreparedInput {
        raw_input_sha256,
        fragmented_participants,
        raw_rows,
        parsed_capability_evidence,
        source_screen_construction,
        ..
    } = scientific::prepare_b05_schoedel_with_raw_digest_with_stages(stages,
        csv_bytes,
        raw_input_sha256.to_owned(),
        opts,
        support.input_capability_evidence_csv,
        b05_identity_from_support(support),
        participant_input_boundary_from_support(support),
    )
    .map_err(|error| error.to_string())?;
    let explicit_strategy =
        opts.screen_session_construction_strategy != ScreenSessionConstructionStrategyId::default();
    let raw_events = raw_b05_events(&raw_rows);
    let mut rows = PreflightRows {
        raw_rows: Some(raw_rows),
        canonical: None,
    };
    // `construct_screen_intervals`.
    let screen = if explicit_strategy {
        source_screen_construction
            .ok_or_else(|| "source B05 substrate has no construction output".to_string())?
    } else if !fragmented_participants.is_empty() {
        scientific::neutral_chronicle_screen_construction(
            &raw_input_sha256, &raw_events, &fragmented_participants, &[], &[],
        )?
    } else {
        let canonical = rows.canonical(stages, opts)?;
        let closes = screen::infer_screen_session_skeletons(canonical);
        scientific::neutral_chronicle_screen_construction(
            &raw_input_sha256, &raw_events, &fragmented_participants,
            &chronicle_interval_inputs(canonical, &closes),
            &chronicle_orphan_stop_issues(canonical),
        )?
    };
    // `reconstruct_schoedel_preflight`.
    let schoedel_reconstruction = if !schoedel_is_active(opts) {
        None
    } else if !screen.executable() {
        Some(b05::schoedel_b05_dependency_refusal(&screen.applicability))
    } else {
        let parsed_capability_evidence = if explicit_strategy {
            parsed_capability_evidence
        } else {
            parse_schoedel_capability_evidence(support)?
        };
        // `mask_excluded_app_events`: the retention set over the
        // policy-neutral canonical rows.
        let retained = apply_event_retention(rows.canonical(stages, opts)?.to_vec(), opts.event_retention_set);
        Some(
            bound_schoedel_reconstruction(
                &retained,
                opts,
                &raw_events,
                &raw_input_sha256,
                parsed_capability_evidence.as_deref(),
                &screen,
            )?
            .reconstruction,
        )
    };
    Ok(bind_finalized_b05_preflight(
        opts,
        verified_request_options_digest,
        &screen,
        schoedel_reconstruction,
    ))
}

/// Execute with the exact kernel-owned preflight object previously inspected
/// by runtime. No B05 sidecar parse, raw decode, or state-machine replay occurs
/// a second time.
pub fn run_pipeline_v2_with_prepared_b05(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
    prepared: B05SchoedelPreparedInput,
) -> Result<PipelineV2Result, String> {
    let run = prepare_sequential_run_with_prepared_b05(csv_bytes, opts, support, prepared, None)?;
    run_prepared_sequential(run, opts, support)
}

pub(crate) fn prepare_sequential_run_with_prepared_b05(
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
    prepared: B05SchoedelPreparedInput,
    // `sha256_wire(csv_bytes)` computed by this crate in the same call chain;
    // `None` (a prepared object from elsewhere) hashes the bytes here.
    computed_raw_input_sha256: Option<String>,
) -> Result<PreparedSequentialRun, String> {
    prepare_sequential_run_with_prepared_b05_and_dependencies(StageFunctions::production(), current_store(), csv_bytes, opts, support, prepared, computed_raw_input_sha256)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_sequential_run_with_prepared_b05_and_dependencies(
    stages: StageFunctions,
    store: PayloadStore,
    csv_bytes: &[u8],
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
    prepared: B05SchoedelPreparedInput,
    // `sha256_wire(csv_bytes)` computed by this crate in the same call chain;
    // `None` (a prepared object from elsewhere) hashes the bytes here.
    computed_raw_input_sha256: Option<String>,
) -> Result<PreparedSequentialRun, String> {
    validate_pipeline_v2_options(opts).map_err(|error| error.to_string())?;
    if eyes_complement_is_active(opts) && csv_bytes.is_empty() {
        return Err(EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
    }
    let raw_input_sha256 = computed_raw_input_sha256.unwrap_or_else(|| sha256_wire(csv_bytes));
    let eyes_partition_preflight = preflight_eyes_input_partition_with_raw_digest(
        raw_input_sha256.clone(),
        opts,
        eyes_input_partition_identity_from_support(support),
        participant_input_boundary_from_support(support),
    )
    .map_err(|error| error.to_string())?;
    if eyes_partition_preflight.disposition == ScientificPreflightDisposition::Refused {
        return Err(eyes_input_partition_refusal_error(
            &eyes_partition_preflight,
        ));
    }
    let eyes_input_partition_preflight = (eyes_partition_preflight.disposition
        == ScientificPreflightDisposition::Executable)
        .then_some(eyes_partition_preflight);
    if let Err(error) = validate_prepared_b05_schoedel_with_raw_digest(
        &raw_input_sha256,
        opts,
        support.input_capability_evidence_csv,
        b05_identity_from_support(support),
        participant_input_boundary_from_support(support),
        &prepared,
    ) {
        if error == B05PreparedExecutionError::ScientificPreflightRefused {
            return Err(b05_schoedel_refusal_error(prepared.evidence()));
        }
        return Err(error.to_string());
    }
    Ok(PreparedSequentialRun {
        stages, store,
        prepared,
        eyes_input_partition_preflight,
    })
}

/// The sequential pass over a prepared run. It reads nothing from the raw
/// bytes: every raw-derived value arrived in `PreparedSequentialRun`.
pub fn run_prepared_sequential(
    run: PreparedSequentialRun,
    opts: &PipelineV2Options,
    support: PipelineV2SupportFiles<'_>,
) -> Result<PipelineV2Result, String> {
    let PreparedSequentialRun {
        stages, store,
        prepared,
        eyes_input_partition_preflight,
    } = run;
    let stages = &stages;
    let B05SchoedelPreparedInput {
        raw_input_sha256,
        fragmented_participants,
        raw_rows,
        parsed_capability_evidence,
        evidence: mut b05_schoedel_preflight,
        ..
    } = prepared;
    let raw_events_for_b05 = raw_b05_events(&raw_rows);
    let raw_row_count = raw_rows.len() as u64;
    let mut schoedel_validation_witness = None;
    let mut workflow_query_group_digests = BTreeMap::new();
    let mut workflow_query_group_checkpoints = BTreeMap::new();
    let mut workflow_query_digests = BTreeMap::new();
    let mut workflow_query_checkpoints = BTreeMap::new();
    let mut query_checkpoints = QueryCheckpointRecorder {
        digests: &mut workflow_query_digests,
        checkpoints: &mut workflow_query_checkpoints,
        remaining_queries: crate::workflow_contract::WORKFLOW_QUERIES.iter(),
        error: None,
        last_row_parts: None,
        last_row_checkpoint: None,
        last_canonical_order: None,
    };
    // 1. parse + sort + canonicalize
    let (mut rows, _tz, out_of_order_events_dropped) =
        parse_raw_rows(stages, (*raw_rows).clone(), opts, &mut query_checkpoints)?;
    let mut cleaning_counts = CleaningCounts {
        out_of_order_events_dropped,
        ..CleaningCounts::default()
    };
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        workflow_rows_checkpoint_reusing_last("parse_events", &rows, &query_checkpoints),
    );
    let original_count = rows.len() as u32;
    let available_timezones: Vec<String> = source::collect_timezone_observations(&rows)
        .into_iter()
        .filter_map(|timezone| {
            let timezone = timezone.trim();
            (!timezone.is_empty()).then_some(timezone.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let rows_before_timezone_handling = rows.len() as u32;

    // 2. Resolve the product's four timezone policies in Rust. The primary
    // timezone is the most frequent non-empty input value; a tie keeps the
    // first timezone encountered, matching JavaScript Map insertion order.
    let primary_timezone = source::estimate_dominant_timezone(&rows);
    query_checkpoints.value("estimate_dominant_timezone", &primary_timezone)?;
    let selection = source::resolve_timezone_strategy(
        Arc::new(rows),
        &opts.timezone,
        &opts.timezone_handling,
        &primary_timezone,
    )?;
    rows = Arc::try_unwrap(selection.rows).unwrap_or_else(|rows| (*rows).clone());
    let target_timezone = selection.target_timezone;
    let timezone_action = selection.action;
    query_checkpoints.rows_and_value(
        "resolve_timezone_strategy",
        &rows,
        &source::timezone_metadata(&target_timezone, timezone_action).checkpoint_payload(),
    )?;
    let rows_after_timezone_handling = rows.len() as u32;
    let summarize_row_selection = source::summarize_row_selection(
        rows_before_timezone_handling,
        rows_after_timezone_handling,
    );
    let rows_removed_by_timezone = summarize_row_selection.removed;
    let timezone_retained_source_rows_digest = timezone_retained_source_rows_digest(&rows);
    let mut effective_opts = opts.clone();
    effective_opts.timezone = target_timezone;
    let opts = &effective_opts;
    rows = source::standardize_event_clock(rows, &opts.timezone)?;
    query_checkpoints.rows("standardize_event_clock", &rows);
    let timezone_stage_digest = timezone_stage_digest(&rows);
    query_checkpoints.value("summarize_row_selection", &summarize_row_selection)?;
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        workflow_rows_checkpoint_reusing_last("normalize_timezones", &rows, &query_checkpoints),
    );

    // 3. dedupe + (optional) unalign duplicate timestamps + mark gaps
    let rows_before_deduplication = rows.len();
    let deduped = source::coalesce_duplicate_event_keys(rows, opts.deduplicate_exact_rows);
    query_checkpoints.rows("coalesce_duplicate_event_keys", &deduped);
    let exact_duplicate_rows_removed =
        rows_before_deduplication.saturating_sub(deduped.len()) as u32;
    let dupes_before = count_duplicate_groups(&deduped);
    query_checkpoints.value("summarize_duplicate_groups", &dupes_before)?;
    let dupe_corrected = source::disambiguate_duplicate_timestamps(
        deduped,
        opts.correct_duplicate_event_timestamps,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
    )?;
    query_checkpoints.rows("disambiguate_duplicate_timestamps", &dupe_corrected);
    let dupes_corrected = if opts.correct_duplicate_event_timestamps {
        dupes_before
    } else {
        0
    };
    let mut rows = source::mark_gaps(dupe_corrected);
    query_checkpoints.rows("derive_time_gap_evidence", &rows);
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        workflow_rows_checkpoint_reusing_last("dedup_and_order", &rows, &query_checkpoints),
    );

    // 4. filter labeling
    // Parsing an empty filter file already yields an empty map, so the file's
    // emptiness is not a second condition.
    let mut filter_map = if opts.use_filter_file {
        parse_filter_csv(support.filter_csv, opts.package_exclusion_preset, opts.filter_match_field)
    } else {
        super::AppFilterRules::default()
    };
    filter_map.application_labels.extend(opts.application_label_exclusions.iter().filter(|label| !label.is_empty()).cloned());
    if !filter_map.packages.is_empty() {
        rows = label_filtered_apps(rows, &filter_map);
    }
    query_checkpoints.rows("mark_app_policy_matches", &rows);
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        workflow_rows_checkpoint_reusing_last("app_policy", &rows, &query_checkpoints),
    );
    let apps_forcing_map =
        if opts.use_apps_forcing_screen_open && !support.apps_forcing_csv.is_empty() {
            parse_apps_forcing_csv(support.apps_forcing_csv)
        } else {
            HashMap::new()
        };
    let background_apps =
        if opts.use_background_apps_file && !support.background_apps_csv.is_empty() {
            parse_background_apps_csv(support.background_apps_csv)
        } else {
            AHashSet::new()
        };

    // 5. screen-usage derivation (if requested)
    let screen_product_active = matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    );
    let screen_timeline_active = screen_product_active
        || schoedel_is_active(opts)
        || opts.locked_screen_audio_disposition
            == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
        || opts.screen_session_maximum_duration_disposition
            == super::ScreenSessionMaximumDurationDisposition::ExcludeParticipant;
    let mut scientific_screen_rows: Vec<Row> = Vec::new();
    if screen_timeline_active {
        if opts.screen_session_construction_strategy
            == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
        {
            let (derived, closes) = if screen_product_active
                || opts.locked_screen_audio_disposition
                    == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
            {
                derive_screen_usage_sessions_full(
                    stages,
                    &rows,
                    opts,
                    &apps_forcing_map,
                    &mut query_checkpoints,
                )?
            } else {
                query_checkpoints.state("index_keyguard_events", "not_applicable");
                let closes = screen::infer_screen_session_skeletons(&rows);
                query_checkpoints.value("infer_screen_session_skeletons", &closes)?;
                (Vec::new(), closes)
            };
            finalize_chronicle_b05_screen(
                &mut b05_schoedel_preflight,
                &raw_input_sha256,
                &raw_events_for_b05,
                &rows,
                &closes,
                opts,
                &fragmented_participants,
            )?;
            scientific_screen_rows = derived;
        } else {
            query_checkpoints.state("index_keyguard_events", "not_applicable_selected_b05");
            query_checkpoints.state(
                "infer_screen_session_skeletons",
                "not_applicable_selected_b05",
            );
            let construction = b05_schoedel_preflight
                .screen_construction
                .as_ref()
                .ok_or_else(|| {
                    "b05_execution_error:prepared_screen_construction_absent".to_string()
                })?;
            scientific_screen_rows = screen::apply_screen_session_policies(
                materialize_b05_screen_rows(stages, construction, &raw_rows, &opts.timezone)?,
                opts.screen_session_classification_policy,
                opts.screen_session_maximum_duration_minutes,
                opts.screen_session_maximum_duration_disposition,
                opts.locked_screen_audio_disposition,
            );
            b05_schoedel_preflight.screen_construction_phase = B05ComputationPhase::Finalized;
        }
    } else {
        query_checkpoints.state("index_keyguard_events", "not_applicable");
        query_checkpoints.state("infer_screen_session_skeletons", "not_applicable");
    }
    if screen_timeline_active {
        let construction = b05_schoedel_preflight
            .screen_construction
            .as_ref()
            .ok_or_else(|| "active B05 construction evidence is missing".to_string())?;
        let neutral_construction = neutral_b05_screen_construction_checkpoint(construction, opts);
        query_checkpoints.value("construct_screen_intervals", &neutral_construction)?;
        if opts.screen_session_construction_strategy
            == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
            && (screen_product_active
                || opts.locked_screen_audio_disposition
                    == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions)
        {
            query_checkpoints.rows("classify_screen_sessions", &scientific_screen_rows);
        } else {
            query_checkpoints.state(
                "classify_screen_sessions",
                if screen_product_active {
                    "not_applicable_selected_b05"
                } else {
                    "not_applicable"
                },
            );
        }
    } else {
        query_checkpoints.state("construct_screen_intervals", "not_applicable");
        query_checkpoints.state("classify_screen_sessions", "not_applicable");
    }
    let screen_duration_excluded_participants = b05_schoedel_preflight
        .screen_construction
        .as_ref()
        .map(|construction| {
            screen::screen_duration_excluded_participants(
                construction,
                opts.screen_session_maximum_duration_disposition,
                opts.screen_session_maximum_duration_minutes,
            )
        })
        .unwrap_or_default();
    let study_windows = if support.study_dates_csv.is_empty()
        || !matches!(
            opts.usage_session_mode,
            UsageSessionMode::AppUsage
                | UsageSessionMode::ScreenUsage
                | UsageSessionMode::AppAndScreenUsage
        ) {
        Vec::new()
    } else {
        parse_study_windows(support.study_dates_csv)?
    };
    let mut screen_rows = if screen_product_active {
        scientific_screen_rows.clone()
    } else {
        Vec::new()
    };
    let device_state_checkpoint = if !screen_product_active
        && (schoedel_is_active(opts)
            || opts.screen_session_maximum_duration_disposition
                == super::ScreenSessionMaximumDurationDisposition::ExcludeParticipant)
    {
        let construction = b05_schoedel_preflight
            .screen_construction
            .as_ref()
            .ok_or_else(|| "active B05 construction evidence is missing".to_string())?;
        let neutral_construction = neutral_b05_screen_construction_checkpoint(construction, opts);
        checkpoint::hidden_screen_dependency_checkpoint(&neutral_construction)?
    } else {
        workflow_rows_checkpoint("device_state_timeline", &scientific_screen_rows)
    };
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        device_state_checkpoint,
    );

    // Product contract: processedRowCount is the canonical policy-row count
    // before session reconstruction, not the number of emitted app sessions.
    // The old fused path overwrote it with app_row_count in app modes even
    // when the emitted CSV bytes were otherwise identical to TypeScript.
    // The raw decode has served the parse and the B05 screen construction;
    // nothing downstream reads it again.
    drop(raw_rows);
    let policy_rows = screen::remove_participants(rows.clone(), &screen_duration_excluded_participants);
    let processed_count = policy_rows.len() as u32;
    let participant_event_timestamps = participant_event_timestamps(&policy_rows);
    let mut aggregate_raw_date_index = None;
    let app_csv_bytes;
    let screen_csv_bytes;
    let day_coverage_csv_bytes;
    let compliance_csv_bytes;
    let credited_app_csv_bytes;
    let notification_contact_csv_bytes;
    let polled_emulation_csv_bytes;
    let interval_expansion_csv_bytes;
    let day_coverage_row_count;
    let compliance_row_count;
    let credited_app_row_count;
    let mut credited_app_row_lineage = Vec::new();
    let notification_contact_row_count;
    let mut notification_contact_row_lineage = Vec::new();
    let polled_emulation_row_count;
    let mut polled_emulation_row_lineage = Vec::new();
    let interval_expansion_row_count;
    let mut interval_expansion_row_lineage = Vec::new();
    let app_rows_for_review;
    let app_row_count;
    let mut opener_set_evidence =
        OpenerSetEvidence::empty(opts.opener_set, opts.episode_reconstruction_strategy);
    let mut foundational_semantics_evidence = foundational_semantics_evidence(&[], opts);
    // No app stage → no bounded episodes; an explicit selection still gets
    // its (empty) receipt so presence keeps its own identity.
    let mut maximum_duration_evidence = maximum_duration_evidence_for_rows(&[], opts)?;
    let mut eyes_tagged_fau_evidence = Vec::new();
    let mut eyes_validation_expected_participant_ids = BTreeSet::new();
    let screen_only_observation = if opts.usage_session_mode == UsageSessionMode::ScreenUsage {
        let resolved_participant_windows =
            resolve_participant_windows(&screen_rows, &study_windows);
        let payload = if opts.enable_study_window_filter {
            if support.study_dates_csv.is_empty() {
                return Err(
                    "Study dates file is required when study-window filtering is enabled".into(),
                );
            }
            let (filtered, dropped_rows, participants_without_window) =
                apply_study_window(screen_rows, &resolved_participant_windows);
            screen_rows = filtered;
            serde_json::json!({
                "applied": true,
                "droppedRows": dropped_rows,
                "participantsWithoutWindow": participants_without_window,
            })
        } else {
            let mut participants_without_window = resolved_participant_windows
                .iter()
                .filter_map(|entry| {
                    entry
                        .window
                        .is_none()
                        .then_some(entry.participant_id.clone())
                })
                .collect::<Vec<_>>();
            participants_without_window.sort();
            serde_json::json!({
                "applied": false,
                "droppedRows": 0,
                "participantsWithoutWindow": participants_without_window,
            })
        };
        Some((resolved_participant_windows, payload))
    } else {
        if opts.usage_session_mode == UsageSessionMode::AppAndScreenUsage
            && opts.enable_study_window_filter
        {
            let resolved = resolve_participant_windows(&screen_rows, &study_windows);
            (screen_rows, _, _) = apply_study_window(screen_rows, &resolved);
        }
        None
    };
    let screen_row_count = screen_rows.len() as u32;
    cleaning_counts.screen_sessions_capped = screen::capped_screen_session_count(&screen_rows);
    cleaning_counts.screen_duration_excluded_participants =
        screen_duration_excluded_participants.len() as u32;

    if matches!(
        opts.usage_session_mode,
        UsageSessionMode::NoUsage | UsageSessionMode::ScreenUsage
    ) {
        attach_concurrent_subinterval_floor_evidence(
            &mut foundational_semantics_evidence,
            &[],
            opts.minimum_usage_duration,
            opts.apply_minimum_usage_duration_to_concurrent_subintervals,
            false,
        );
        attach_zero_duration_cleanup_evidence(
            &mut foundational_semantics_evidence,
            &[],
            opts.filter_zero_duration_sessions,
            false,
        );
        for query_id in [
            "resolve_excluded_packages",
            "mask_excluded_app_events",
            "build_app_event_index",
            "match_app_episodes",
            "materialize_candidate_episodes",
            "classify_episode_durations",
            "apply_app_inclusion_policy",
            "order_app_episodes",
            "segment_concurrent_usage",
            "join_app_codebook",
            "derive_broad_category",
            "collapse_app_genre",
            "derive_engagement_basis",
            "apply_episode_flags",
            "suppress_excluded_timing",
            "remove_selected_interaction_types",
            "remove_zero_duration_rows",
            "assign_usage_session_ids",
            "identify_credit_eligible_sessions",
            "build_activity_witness_indexes",
            "assess_screen_evidence_capability",
            "summarize_daily_apps",
            "derive_credited_intervals",
            "materialize_credited_rows",
            "assemble_credit_outputs",
            "select_notification_events",
            "index_observed_usage_spans",
            "classify_notification_contacts",
            "assemble_notification_contact_outputs",
            "sample_polled_timeline",
            "group_polled_runs",
            "materialize_polled_rows",
            "assemble_polled_emulation_outputs",
            "resolve_participant_windows",
            "apply_participant_windows",
            "resolve_sharing_status",
            "index_survey_responses",
            "classify_person_attribution",
            "divide_sessions_at_day_boundary",
            "synthesize_placeholder_rows",
            "index_raw_dates",
            "build_participant_day_coverage",
            "aggregate_attribution_minutes",
            "compute_attribution_completeness",
            "classify_compliance_days",
        ] {
            if let Some((resolved, payload)) = screen_only_observation.as_ref() {
                match query_id {
                    "resolve_participant_windows" => {
                        query_checkpoints.value(query_id, resolved)?;
                        continue;
                    }
                    "apply_participant_windows" => {
                        query_checkpoints.rows_and_value(query_id, &screen_rows, payload)?;
                        continue;
                    }
                    _ => {}
                }
            }
            query_checkpoints.state(query_id, "not_applicable");
        }
        if screen_only_observation.is_some() {
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                workflow_rows_checkpoint_reusing_last("observation_window", &screen_rows, &query_checkpoints),
            );
        }
        for node_id in [
            "reconstruct_episodes",
            "categorize_apps",
            "episode_annotations",
            "interval_cleaning",
            "effective_usage",
            "notification_proxy",
            "polled_emulation",
            "observation_window",
            "attribute_person",
            "day_coverage",
            "score_compliance",
        ] {
            if screen_only_observation.is_some() && node_id == "observation_window" {
                continue;
            }
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                workflow_state_checkpoint(node_id, "not_applicable"),
            );
        }
        app_row_count = 0;
        app_csv_bytes = Vec::new();
        day_coverage_csv_bytes = Vec::new();
        compliance_csv_bytes = Vec::new();
        credited_app_csv_bytes = Vec::new();
        notification_contact_csv_bytes = Vec::new();
        polled_emulation_csv_bytes = Vec::new();
        interval_expansion_csv_bytes = Vec::new();
        day_coverage_row_count = 0;
        compliance_row_count = 0;
        credited_app_row_count = 0;
        notification_contact_row_count = 0;
        polled_emulation_row_count = 0;
        interval_expansion_row_count = 0;
        app_rows_for_review = Vec::new();
        screen_csv_bytes = if opts.include_screen_output {
            write_selected_screen_csv(&screen_rows, opts, &b05_schoedel_preflight)?
        } else {
            Vec::new()
        };
    } else {
        let mut shared_participants = BTreeSet::new();
        // 6. matcher (app usage)
        if schoedel_is_active(opts) {
            let (algorithm_output, validation_witness) = run_schoedel_app_usage_algorithm(stages,
                rows,
                opts,
                &background_apps,
                &filter_map.application_labels,
                &scientific_screen_rows,
                &screen_duration_excluded_participants,
                &raw_events_for_b05,
                &raw_input_sha256,
                parsed_capability_evidence.as_deref(),
                &mut b05_schoedel_preflight,
                &mut query_checkpoints,
            )?;
            (
                rows,
                opener_set_evidence,
                foundational_semantics_evidence,
                maximum_duration_evidence,
                eyes_tagged_fau_evidence,
            ) = algorithm_output;
            schoedel_validation_witness = Some(validation_witness);
        } else {
            let filtered_packages = reconstruction::resolve_excluded_packages(&rows);
            query_checkpoints.value("resolve_excluded_packages", &filtered_packages)?;
            rows = apply_event_retention(
                reconstruction::mask_excluded_app_events(rows),
                opts.event_retention_set,
            );
            query_checkpoints.rows("mask_excluded_app_events", &rows);
            (
                rows,
                opener_set_evidence,
                foundational_semantics_evidence,
                maximum_duration_evidence,
                eyes_tagged_fau_evidence,
                eyes_validation_expected_participant_ids,
            ) = process_usage_rows(
                stages, rows, &background_apps, &filtered_packages,
                &filter_map.application_labels, &scientific_screen_rows,
                &screen_duration_excluded_participants, opts, &mut query_checkpoints,
            )?;
        }
        drop(raw_events_for_b05);
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_rows_checkpoint_reusing_last(
                "reconstruct_episodes",
                &rows,
                &query_checkpoints,
            ),
        );

        // 7. codebook
        let codebook_map = if opts.use_app_codebook && !support.codebook_csv.is_empty() {
            parse_codebook_csv(support.codebook_csv)
        } else {
            HashMap::new()
        };
        let include_aliases =
            annotations::include_codebook_aliases(opts.use_app_codebook, codebook_map.is_empty(), opts.include_category_column);

        // 8. enrich
        join_codebook(&mut rows, opts.use_app_codebook, &codebook_map);
        query_checkpoints.rows_and_value(
            "join_app_codebook",
            &rows,
            &annotations::codebook_checkpoint_payload(codebook_map.is_empty()),
        )?;
        derive_broad_category(&mut rows, opts.use_app_codebook);
        query_checkpoints.rows("derive_broad_category", &rows);
        collapse_app_genre(&mut rows, opts.use_app_codebook);
        query_checkpoints.rows("collapse_app_genre", &rows);
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_rows_checkpoint_reusing_last("categorize_apps", &rows, &query_checkpoints),
        );
        add_app_usage_detail_columns(&mut rows, opts.custom_app_engagement_duration);
        query_checkpoints.rows("derive_engagement_basis", &rows);
        mark_app_usage_flags(
            &mut rows,
            &opts.long_data_time_gap_thresholds,
            &opts.long_usage_duration_thresholds,
        );
        query_checkpoints.rows("apply_episode_flags", &rows);
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_rows_checkpoint_reusing_last("episode_annotations", &rows, &query_checkpoints),
        );
        rows = annotations::interval_quality_step(rows, opts.interval_quality_policy);
        query_checkpoints.rows("suppress_excluded_timing", &rows);
        rows = annotations::remove_selected_interaction_types(
            rows,
            &opts.interaction_types_to_remove,
            &opts.long_data_time_gap_thresholds,
            opts.interaction_type_removal_mode,
        );
        query_checkpoints.rows("remove_selected_interaction_types", &rows);
        attach_zero_duration_cleanup_evidence(
            &mut foundational_semantics_evidence,
            &rows,
            opts.filter_zero_duration_sessions,
            true,
        );
        rows = annotations::remove_zero_duration_rows(rows, opts.filter_zero_duration_sessions);
        query_checkpoints.rows_and_value(
            "remove_zero_duration_rows",
            &rows,
            &foundational_semantics_evidence.zero_duration_cleanup,
        )?;
        // Session numbering reads a row's NEIGHBOURS, so it runs on the whole
        // slice once the annotation phase has finished removing rows. Under
        // the default policy nothing is written and no column is emitted.
        assign_usage_session_ids(&mut rows, opts.session_grouping_rules());
        query_checkpoints.rows_and_value(
            "assign_usage_session_ids",
            &rows,
            &session_grouping_checkpoint_payload(opts.session_grouping_rules()),
        )?;
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_rows_checkpoint_reusing_last("interval_cleaning", &rows, &query_checkpoints),
        );
        let (credited_bytes, credited_count) = if opts.enable_screen_gated_crediting {
            let credit_input_parts = query_checkpoints.take_last_row_parts();
            let credited = apply_screen_gated_credit_incremental(
                &rows,
                &policy_rows,
                opts,
                include_aliases,
                credit_input_parts.as_deref(),
                &mut query_checkpoints,
            )?;
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                credited.effective_usage_checkpoint,
            );
            credited_app_row_lineage = credited.row_lineage;
            (credited.csv_bytes, credited.row_count)
        } else {
            for query_id in [
                "identify_credit_eligible_sessions",
                "build_activity_witness_indexes",
                "assess_screen_evidence_capability",
                "summarize_daily_apps",
                "derive_credited_intervals",
                "materialize_credited_rows",
                "assemble_credit_outputs",
            ] {
                query_checkpoints.state(query_id, "not_applicable");
            }
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                workflow_state_checkpoint("effective_usage", "not_applicable"),
            );
            (Vec::new(), 0)
        };
        credited_app_csv_bytes = credited_bytes;
        credited_app_row_count = credited_count;

        // B08. Derived after reconstruction and after the credit channel, from
        // `policy_rows` rather than the episode rows: a notification never
        // becomes an episode, so the raw row is the only place it exists.
        // `policy_rows` is taken before the event-retention set is applied and
        // no retention set keeps a notification type, so the contact channel
        // is outside the retention axis: it reports every notification row.
        let (contact_bytes, contact_count) = if opts.notification_proxy_rule.emits_contacts() {
            let contacts = derive_notification_contacts_incremental(
                &rows,
                &policy_rows,
                opts,
                &codebook_map,
                include_aliases,
                &mut query_checkpoints,
            )?;
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                contacts.checkpoint,
            );
            notification_contact_row_lineage = contacts.row_lineage;
            (contacts.csv_bytes, contacts.row_count)
        } else {
            for query_id in [
                "select_notification_events",
                "index_observed_usage_spans",
                "classify_notification_contacts",
                "assemble_notification_contact_outputs",
            ] {
                query_checkpoints.state(query_id, "not_applicable");
            }
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                workflow_state_checkpoint("notification_proxy", "not_applicable"),
            );
            (Vec::new(), 0)
        };
        notification_contact_csv_bytes = contact_bytes;
        notification_contact_row_count = contact_count;

        // B09. Reads the reconstructed episode rows, because only an episode
        // says which package was FOREGROUND at an instant -- which is the one
        // thing a polled collector records. Placed after cleaning and session
        // numbering so the timeline being resampled is the same timeline the
        // headline output reports, not an earlier draft of it.
        let (emulation_bytes, emulation_count) = if opts.polled_emulation_method.emits_emulation() {
            let emulated = derive_polled_emulation_incremental(
                &rows,
                opts,
                &codebook_map,
                include_aliases,
                &mut query_checkpoints,
            )?;
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                emulated.checkpoint,
            );
            polled_emulation_row_lineage = emulated.row_lineage;
            (emulated.csv_bytes, emulated.row_count)
        } else {
            for query_id in [
                "sample_polled_timeline",
                "group_polled_runs",
                "materialize_polled_rows",
                "assemble_polled_emulation_outputs",
            ] {
                query_checkpoints.state(query_id, "not_applicable");
            }
            record_workflow_checkpoint(
                &mut workflow_query_group_digests,
                &mut workflow_query_group_checkpoints,
                workflow_state_checkpoint("polled_emulation", "not_applicable"),
            );
            (Vec::new(), 0)
        };
        polled_emulation_csv_bytes = emulation_bytes;
        polled_emulation_row_count = emulation_count;
        if opts.interval_expansion_method.emits_expansion() {
            let expanded = polled::materialize_behapp_half_open_seconds(&rows)?;
            interval_expansion_row_count = u32::try_from(expanded.len())
                .map_err(|_| "interval expansion row count exceeds u32".to_string())?;
            interval_expansion_csv_bytes = write_app_csv_from_iter(expanded.iter(), opts, include_aliases);
            interval_expansion_row_lineage = build_row_lineage_from_iter("interval-expansion-csv", "outputs", expanded.iter());
        } else {
            interval_expansion_csv_bytes = Vec::new();
            interval_expansion_row_count = 0;
        }
        let mut resolved_participant_windows = resolve_participant_windows(&rows, &study_windows);
        if opts.usage_session_mode == UsageSessionMode::AppAndScreenUsage {
            for entry in resolve_participant_windows(&scientific_screen_rows, &study_windows) {
                if !resolved_participant_windows.iter().any(|known| known.participant_id == entry.participant_id) {
                    resolved_participant_windows.push(entry);
                }
            }
        }
        query_checkpoints.value("resolve_participant_windows", &resolved_participant_windows)?;
        if opts.enable_study_window_filter {
            if support.study_dates_csv.is_empty() {
                return Err(
                    "Study dates file is required when study-window filtering is enabled".into(),
                );
            }
            let (filtered, dropped_rows, participants_without_window) =
                apply_study_window(rows, &resolved_participant_windows);
            rows = filtered;
            query_checkpoints.rows_and_value(
                "apply_participant_windows",
                &rows,
                &attribution::window_metadata(true, dropped_rows, &participants_without_window),
            )?;
        } else {
            let participants_without_window = attribution::disabled_window_participants(&resolved_participant_windows);
            query_checkpoints.rows_and_value(
                "apply_participant_windows",
                &rows,
                &attribution::window_metadata(false, 0, &participants_without_window),
            )?;
        }
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            if opts.usage_session_mode == UsageSessionMode::AppAndScreenUsage && opts.enable_study_window_filter {
                workflow_checkpoint("observation_window", &[("app_rows", &rows), ("screen_rows", &screen_rows)], &[])
            } else {
                workflow_rows_checkpoint_reusing_last("observation_window", &rows, &query_checkpoints)
            },
        );
        if opts.enable_person_attribution {
            if support.device_sharing_csv.is_empty() {
                return Err(
                    "Device sharing file is required when person attribution is enabled".into(),
                );
            }
            let sharing = parse_device_sharing(support.device_sharing_csv)?;
            let survey = parse_survey_lookup(support.survey_attribution_csv)?;
            let resolution = attribution::sharing_partition(&rows, &sharing)?;
            shared_participants.extend(resolution.shared_participants.iter().cloned());
            query_checkpoints.value("resolve_sharing_status", &resolution)?;
            let survey_checkpoint = attribution::survey_checkpoint_payload(&survey);
            query_checkpoints.value("index_survey_responses", &survey_checkpoint)?;
            let (attributed_rows, attribution_report) =
                attribute_person(rows, &resolution, &survey)?;
            rows = attributed_rows;
            query_checkpoints.rows_and_value(
                "classify_person_attribution",
                &rows,
                &attribution::attribution_checkpoint_payload(Some(&attribution_report)),
            )?;
        } else {
            query_checkpoints.value(
                "resolve_sharing_status",
                &serde_json::json!({"enabled": false}),
            )?;
            query_checkpoints.value(
                "index_survey_responses",
                &serde_json::json!({"enabled": false}),
            )?;
            query_checkpoints.rows_and_value(
                "classify_person_attribution",
                &rows,
                &attribution::attribution_checkpoint_payload(None),
            )?;
        }
        let shared_participants_checkpoint = value_fingerprint(&shared_participants)
            .map_err(|error| format!("serialize shared-participant checkpoint: {error}"))?;
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_checkpoint_with_parts(
                "attribute_person",
                &[("rows", &rows)],
                &[("shared_participants", &shared_participants_checkpoint)],
                query_checkpoints.last_row_parts(),
            ),
        );
        let divides_sessions = opts.day_boundary_attribution.divides_sessions();
        if divides_sessions {
            rows = split_sessions_at_local_midnight(rows, opts.day_boundary_attribution);
        }
        query_checkpoints.rows_and_value(
            "divide_sessions_at_day_boundary",
            &rows,
            &serde_json::json!({"applied": divides_sessions}),
        )?;
        if opts.add_no_activity_placeholder_days {
            rows = add_no_activity_placeholder_rows(
                rows,
                &policy_rows,
                opts.enable_study_window_filter
                    .then_some(resolved_participant_windows.as_slice()),
            );
        }
        query_checkpoints.rows_and_value(
            "synthesize_placeholder_rows",
            &rows,
            &serde_json::json!({"applied": opts.add_no_activity_placeholder_days}),
        )?;
        let raw_date_index = aggregate_raw_date_index.insert(index_raw_dates(&policy_rows));
        query_checkpoints.value("index_raw_dates", &*raw_date_index)?;
        // Every consumer of the source-row table has run; the edited session
        // rows are the only row table from here on.
        drop(policy_rows);

        let (coverage_bytes, coverage_count) = if opts.enable_day_coverage {
            build_day_coverage_csv(
                &rows,
                &*raw_date_index,
                &study_windows,
                &mut query_checkpoints,
            )?
        } else {
            query_checkpoints.state("build_participant_day_coverage", "not_applicable");
            (Vec::new(), 0)
        };
        day_coverage_csv_bytes = coverage_bytes;
        day_coverage_row_count = coverage_count;
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_checkpoint_with_parts(
                "day_coverage",
                &[("rows", &rows)],
                &[("day_coverage_csv", &day_coverage_csv_bytes)],
                query_checkpoints.last_row_parts(),
            ),
        );
        let (compliance_bytes, compliance_count) = if opts.enable_compliance_scoring {
            let enrolled_devices = parse_enrolled_devices(support.enrolled_devices_csv)?;
            build_compliance_csv(
                &rows,
                &shared_participants,
                opts.compliance_threshold_percent,
                &enrolled_devices,
                &mut query_checkpoints,
            )?
        } else {
            query_checkpoints.state("aggregate_attribution_minutes", "not_applicable");
            query_checkpoints.state("compute_attribution_completeness", "not_applicable");
            query_checkpoints.state("classify_compliance_days", "not_applicable");
            (Vec::new(), 0)
        };
        compliance_csv_bytes = compliance_bytes;
        compliance_row_count = compliance_count;
        record_workflow_checkpoint(
            &mut workflow_query_group_digests,
            &mut workflow_query_group_checkpoints,
            workflow_checkpoint(
                "score_compliance",
                &[],
                &[("compliance_csv", &compliance_csv_bytes)],
            ),
        );

        app_row_count = rows.len() as u32;
        annotations::record_app_output_cleaning_counts(&rows, &mut cleaning_counts);
        app_rows_for_review = rows.clone();
        app_csv_bytes = if opts.include_app_output {
            write_app_csv(&rows, opts, include_aliases)
        } else {
            Vec::new()
        };
        screen_csv_bytes = if matches!(opts.usage_session_mode, UsageSessionMode::AppAndScreenUsage)
            && opts.include_screen_output
        {
            write_selected_screen_csv(&screen_rows, opts, &b05_schoedel_preflight)?
        } else {
            Vec::new()
        };
    }

    if b05_schoedel_is_active(opts)
        && (b05_schoedel_preflight.screen_construction_phase != B05ComputationPhase::Finalized
            || b05_schoedel_preflight.screen_construction.is_none())
    {
        return Err("b05_execution_error:screen_construction_not_finalized".into());
    }
    if schoedel_is_active(opts)
        && (b05_schoedel_preflight.schoedel_reconstruction_phase != B05ComputationPhase::Finalized
            || b05_schoedel_preflight.schoedel_reconstruction.is_none())
    {
        return Err("schoedel_execution_error:reconstruction_not_finalized".into());
    }
    validate_foundational_semantics_evidence_for_options(&foundational_semantics_evidence, opts)?;
    let b05_schoedel_validation_context = scientific::build_b05_schoedel_validation_context(
        &b05_schoedel_preflight, &foundational_semantics_evidence, opts,
        &raw_input_sha256, raw_row_count, original_count, schoedel_validation_witness.as_ref(),
    )?;
    let eyes_tagged_fau_validation_context = if eyes_complement_is_active(opts) {
        let final_partition = eyes_input_partition_preflight
            .as_ref()
            .ok_or_else(|| "eyes_tagged_fau_validation_error:partition_missing".to_string())?;
        scientific::build_eyes_tagged_fau_validation_context(
            &eyes_tagged_fau_evidence, eyes_validation_expected_participant_ids,
            final_partition, opts, &raw_input_sha256, raw_row_count,
        )?
    } else {
        EyesTaggedFauValidationContext::default()
    };

    let foundational_provenance = foundational_output_projection(opts, &b05_schoedel_preflight);
    let mut review_summary = build_review_summary(&app_rows_for_review, &screen_rows);
    review_summary.micro_use_receipt = (opts.micro_use_classification_policy
        != MicroUseClassificationPolicy::None)
        .then(|| foundational_semantics_evidence.micro_use.clone());
    review_summary.foundational_provenance = foundational_provenance.clone();
    let review_summary_json_bytes = serde_json::to_vec(&review_summary)
        .map_err(|error| format!("serialize review summary: {error}"))?;
    let visualization_data_json_bytes = if opts.materialize_visualization_data {
        let data = build_visualization_data(
            &app_rows_for_review,
            &screen_rows,
            participant_event_timestamps,
            foundational_provenance,
            opts.micro_use_classification_policy != MicroUseClassificationPolicy::None,
        );
        // Serialized twice, the first time into a counter, so the buffer is
        // its content's size and never a doubling copy beside it.
        let mut count = CountingSink(0);
        serde_json::to_writer(&mut count, &data)
            .map_err(|error| format!("serialize visualization data: {error}"))?;
        let mut bytes = Vec::with_capacity(count.0);
        serde_json::to_writer(&mut bytes, &data)
            .map_err(|error| format!("serialize visualization data: {error}"))?;
        bytes
    } else {
        Vec::new()
    };
    let aggregate_app_rows = headline_eligible_app_rows(&app_rows_for_review);
    let mut aggregate_csv_outputs =
        aggregates::build_aggregate_outputs(&aggregate_app_rows, &screen_rows, opts);
    // The same raw-date statistic recorded as the `index_raw_dates` query
    // checkpoint above, bound only by the app-mode block. The tracked engine
    // reads the tracked query itself.
    if let Some(raw_date_index) = aggregate_raw_date_index.as_ref() {
        if let Some(summary) = aggregates::participant_amount_summary_output(
            &aggregate_app_rows,
            raw_date_index,
            opts,
        ) {
            aggregate_csv_outputs.push(summary);
        }
    }
    // Every published CSV is final here. Each query group's checkpoint above
    // was taken over the un-neutralized bytes, exactly as the tracked engine
    // takes them; only the assembled manifest below sees the neutralized ones.
    let neutralize = |csv: Vec<u8>| {
        if opts.neutralize_spreadsheet_formulas {
            output::neutralize_spreadsheet_formulas(&csv)
        } else {
            csv
        }
    };
    let app_csv_bytes = neutralize(app_csv_bytes);
    let screen_csv_bytes = neutralize(screen_csv_bytes);
    let day_coverage_csv_bytes = neutralize(day_coverage_csv_bytes);
    let compliance_csv_bytes = neutralize(compliance_csv_bytes);
    let credited_app_csv_bytes = neutralize(credited_app_csv_bytes);
    let notification_contact_csv_bytes = neutralize(notification_contact_csv_bytes);
    let polled_emulation_csv_bytes = neutralize(polled_emulation_csv_bytes);
    let interval_expansion_csv_bytes = neutralize(interval_expansion_csv_bytes);
    for aggregate in &mut aggregate_csv_outputs {
        aggregate.bytes = neutralize(std::mem::take(&mut aggregate.bytes));
    }
    let mut row_lineage = if app_csv_bytes.is_empty() {
        Vec::new()
    } else {
        build_row_lineage("app-csv", "outputs", &app_rows_for_review)
    };
    let screen_row_lineage = if screen_csv_bytes.is_empty() {
        Vec::new()
    } else {
        build_screen_row_lineage(&screen_rows, opts, &b05_schoedel_preflight)
    };
    if credited_app_csv_bytes.is_empty() {
        credited_app_row_lineage = Vec::new();
    }
    if notification_contact_csv_bytes.is_empty() {
        notification_contact_row_lineage = Vec::new();
    }
    if polled_emulation_csv_bytes.is_empty() {
        polled_emulation_row_lineage = Vec::new();
    }
    if interval_expansion_csv_bytes.is_empty() {
        interval_expansion_row_lineage = Vec::new();
    }
    // One exact-size growth: amortized doubling would leave a half-empty
    // buffer the size of the whole lineage live at the run's peak.
    row_lineage.reserve_exact(
        screen_row_lineage.len()
            + credited_app_row_lineage.len()
            + notification_contact_row_lineage.len()
            + polled_emulation_row_lineage.len()
            + interval_expansion_row_lineage.len(),
    );
    row_lineage.extend(screen_row_lineage);
    row_lineage.extend(credited_app_row_lineage);
    row_lineage.extend(notification_contact_row_lineage);
    row_lineage.extend(polled_emulation_row_lineage);
    row_lineage.extend(interval_expansion_row_lineage);

    let row_lineage_fingerprint = output::row_lineage_checkpoint_fingerprint(&row_lineage)?;
    let aggregate_checkpoint_bytes = output::aggregate_checkpoint_bytes(
        aggregate_csv_outputs.iter().map(|aggregate| Ok((
            aggregate.kind.as_str(), aggregate.row_count,
            format!("sha256:{}", hex::encode(Sha256::digest(&aggregate.bytes))),
        ))),
    )?;
    let preprocessing_datetime =
        source::bind_processing_timestamp(&opts.datetime_of_preprocessing);
    query_checkpoints.value("bind_processing_timestamp", &preprocessing_datetime)?;
    let assembled_outputs_checkpoint = workflow_checkpoint(
        "assemble_result_manifest",
        &[],
        &[
            ("app_csv", &app_csv_bytes),
            ("screen_csv", &screen_csv_bytes),
            ("day_coverage_csv", &day_coverage_csv_bytes),
            ("compliance_csv", &compliance_csv_bytes),
            ("credited_app_csv", &credited_app_csv_bytes),
            ("notification_contact_csv", &notification_contact_csv_bytes),
            ("polled_emulation_csv", &polled_emulation_csv_bytes),
            ("interval_expansion_csv", &interval_expansion_csv_bytes),
            ("review_summary_json", &review_summary_json_bytes),
            ("visualization_data_json", &visualization_data_json_bytes),
            ("aggregates", &aggregate_checkpoint_bytes),
            ("row_lineage", &row_lineage_fingerprint),
        ],
    );
    let opener_set_evidence_fingerprint = value_fingerprint(&opener_set_evidence)
        .map_err(|error| format!("serialize opener-set evidence checkpoint: {error}"))?;
    let foundational_semantics_fingerprint = value_fingerprint(&foundational_semantics_evidence)
        .map_err(|error| format!("serialize foundational-semantics checkpoint: {error}"))?;
    let eyes_tagged_fau_fingerprint = value_fingerprint(&eyes_tagged_fau_evidence)
        .map_err(|error| format!("serialize EYES tagged-FAU checkpoint: {error}"))?;
    let eyes_input_partition_fingerprint = eyes_input_partition_preflight
        .as_ref()
        .map(value_fingerprint)
        .transpose()
        .map_err(|error| format!("serialize EYES partition checkpoint: {error}"))?;
    let b05_schoedel_fingerprint = value_fingerprint(&b05_schoedel_preflight)
        .map_err(|error| format!("serialize B05/Schoedel checkpoint: {error}"))?;
    // Same rule as the tracked path: only an explicit B06 selection
    // contributes, so the omitted manifest digest is the pre-B06 digest.
    let maximum_duration_fingerprint = maximum_duration_evidence
        .as_ref()
        .map(value_fingerprint)
        .transpose()
        .map_err(|error| format!("serialize maximum-duration checkpoint: {error}"))?;
    let scientific_validation_fingerprint =
        value_fingerprint(&b05_schoedel_validation_context.receipt)
            .map_err(|error| format!("serialize scientific validation receipt: {error}"))?;
    let eyes_validation_fingerprint = eyes_complement_is_active(opts)
        .then(|| value_fingerprint(&eyes_tagged_fau_validation_context.receipt))
        .transpose()
        .map_err(|error| format!("serialize EYES validation receipt: {error}"))?;
    let assembled_terminal_digest = assembled_outputs_checkpoint.terminal_digest.clone();
    let manifest_evidence = output::manifest_evidence_payloads(
        assembled_terminal_digest.as_bytes(), &opener_set_evidence_fingerprint,
        &foundational_semantics_fingerprint, &eyes_tagged_fau_fingerprint,
        &b05_schoedel_fingerprint, &scientific_validation_fingerprint,
        maximum_duration_fingerprint.as_ref(), eyes_input_partition_fingerprint.as_ref(),
        eyes_validation_fingerprint.as_ref(),
    );
    let manifest_checkpoint = checkpoint_for_exact_row_state(
        "assemble_result_manifest",
        &assembled_outputs_checkpoint,
        &manifest_evidence,
    );
    query_checkpoints.record(manifest_checkpoint.clone());
    record_workflow_checkpoint(
        &mut workflow_query_group_digests,
        &mut workflow_query_group_checkpoints,
        checkpoint_for_exact_state("outputs", &manifest_checkpoint),
    );

    query_checkpoints.finish()?;

    let expected_query_ids = crate::workflow_contract::WORKFLOW_QUERIES
        .iter()
        .map(|query| query.id)
        .collect::<BTreeSet<_>>();
    let actual_query_ids = workflow_query_checkpoints
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if expected_query_ids != actual_query_ids {
        let missing = expected_query_ids
            .difference(&actual_query_ids)
            .copied()
            .collect::<Vec<_>>();
        let unexpected = actual_query_ids
            .difference(&expected_query_ids)
            .copied()
            .collect::<Vec<_>>();
        return Err(format!(
            "workflow query checkpoint coverage mismatch: missing={missing:?}, unexpected={unexpected:?}"
        ));
    }

    debug_assert_eq!(
        workflow_query_group_digests.len(),
        crate::workflow_contract::workflow_query_group_ids().len()
    );
    debug_assert_eq!(
        workflow_query_group_checkpoints.len(),
        crate::workflow_contract::workflow_query_group_ids().len()
    );
    debug_assert_eq!(
        workflow_query_digests.len(),
        crate::workflow_contract::WORKFLOW_QUERIES.len()
    );
    debug_assert_eq!(
        workflow_query_checkpoints.len(),
        crate::workflow_contract::WORKFLOW_QUERIES.len()
    );

    Ok(PipelineV2Result {
        app_csv_bytes: PayloadBytes::from_vec_with_store(app_csv_bytes, &store),
        screen_csv_bytes: PayloadBytes::from_vec_with_store(screen_csv_bytes, &store),
        day_coverage_csv_bytes: PayloadBytes::from_vec_with_store(day_coverage_csv_bytes, &store),
        compliance_csv_bytes: PayloadBytes::from_vec_with_store(compliance_csv_bytes, &store),
        credited_app_csv_bytes: PayloadBytes::from_vec_with_store(credited_app_csv_bytes, &store),
        notification_contact_csv_bytes: PayloadBytes::from_vec_with_store(notification_contact_csv_bytes, &store),
        polled_emulation_csv_bytes: PayloadBytes::from_vec_with_store(polled_emulation_csv_bytes, &store),
        interval_expansion_csv_bytes: PayloadBytes::from_vec_with_store(interval_expansion_csv_bytes, &store),
        review_summary_json_bytes: PayloadBytes::from_vec_with_store(review_summary_json_bytes, &store),
        visualization_data_json_bytes: PayloadBytes::from_vec_with_store(visualization_data_json_bytes, &store),
        aggregate_csv_outputs: Arc::new(
            aggregate_csv_outputs
                .into_iter()
                .map(|output| aggregates::AggregateCsvOutput {
                    kind: output.kind,
                    bytes: PayloadBytes::from_vec_with_store(output.bytes, &store),
                    row_count: output.row_count,
                })
                .collect(),
        ),
        row_lineage: Arc::new(row_lineage),
        opener_set_evidence,
        foundational_semantics_evidence,
        maximum_duration_evidence,
        eyes_tagged_fau_evidence,
        eyes_input_partition_preflight,
        b05_schoedel_preflight,
        b05_schoedel_validation_context,
        eyes_tagged_fau_validation_context,
        original_row_count: original_count,
        processed_row_count: processed_count,
        app_row_count,
        screen_row_count,
        day_coverage_row_count,
        compliance_row_count,
        credited_app_row_count,
        notification_contact_row_count,
        polled_emulation_row_count,
        interval_expansion_row_count,
        duplicate_timestamps_corrected: dupes_corrected,
        exact_duplicate_rows_removed,
        cleaning_counts,
        available_timezones,
        timezone: opts.timezone.clone(),
        timezone_action: timezone_action.into(),
        rows_before_timezone_handling,
        rows_after_timezone_handling,
        rows_removed_by_timezone,
        timezone_retained_source_rows_digest,
        timezone_stage_digest,
        workflow_query_group_digests,
        workflow_query_group_checkpoints,
        workflow_query_digests,
        workflow_query_checkpoints,
    })
}

#[cfg(test)]
mod verified_raw_input_tests {
    use super::*;

    #[test]
    fn a_verified_digest_cannot_be_rebound_to_other_raw_bytes() {
        let digest = sha256_wire(b"CSV A");
        assert!(VerifiedRawInput::verify_borrowed(b"CSV B", &digest).is_err());
        assert!(VerifiedRawInput::verify_owned(Arc::new(b"CSV B".to_vec()), &digest).is_err());

        let borrowed = VerifiedRawInput::verify_borrowed(b"CSV A", &digest).unwrap();
        assert_eq!(borrowed.bytes(), b"CSV A");
        assert_eq!(borrowed.digest(), digest);
    }
}
