#[cfg(test)]
use super::{ALTERNATION_SLOT_HIT_COUNT, UNNAMED_EXECUTION_EVENTS};
use super::preflight_eyes_complement_input_partition;
use super::{
    Arc,
    B05SchoedelPreflightResult,
    B05_RETAINED_RAW_INPUT_REQUIRED_ERROR,
    BTreeMap,
    EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR,
    EarlyConfigInput,
    EarlyRawInput,
    EpisodeReconstructionStrategy,
    EyesInputPartitionPreflightResult,
    LateConfigInput,
    LateSupportInput,
    MatcherInput,
    MatcherOutput,
    Mutex,
    OutputConfigInput,
    PayloadBytes,
    PayloadHandle,
    PersistedReviewBaseSelection,
    PipelineRowLineage,
    PipelineV2Options,
    PipelineV2Result,
    PipelineV2SupportFiles,
    PrimaryOutputs,
    QueryValue,
    REVIEW_BASE_HEADER_BYTES,
    ResolvedParticipantWindow,
    ReviewAnnotations,
    ReviewReconstructedRows,
    ReviewStaticAnnotations,
    ReviewUsageRowsBeforeFloor,
    ScientificPreflightDisposition,
    ScreenSessionConstructionStrategyId,
    TrackedInputs,
    UsageConfigInput,
    UsageSessionMode,
    UsageSupportInput,
    aggregate_attribution_minutes,
    apply_app_inclusion_policy,
    apply_episode_flags,
    apply_participant_windows,
    assemble_credit_outputs,
    assemble_notification_contact_outputs,
    assemble_polled_emulation_outputs,
    assemble_primary_outputs,
    assemble_result_manifest,
    assess_screen_evidence_capability,
    assign_usage_session_ids,
    attach_device_models,
    b05_schoedel_is_active,
    background_apps,
    bind_processing_timestamp,
    bind_tracked_finalized_preflight,
    blind_lineage_suffix_digests,
    build_activity_witness_indexes,
    build_app_event_index,
    build_participant_day_coverage,
    build_reconstruction_base,
    build_review_base,
    canonicalize_source_rows,
    classify_compliance_days,
    classify_episode_durations,
    classify_notification_contacts,
    classify_person_attribution,
    classify_screen_sessions,
    coalesce_duplicate_event_keys,
    codebook_is_empty,
    collapse_app_genre,
    collect_early_assembly,
    collect_timezone_observations,
    compute_attribution_completeness,
    construct_screen_intervals,
    decode_source_records,
    decoded_reconstruction_base,
    decoded_review_base,
    derive_broad_category,
    derive_credited_intervals,
    derive_engagement_basis,
    derive_time_gap_evidence,
    disambiguate_duplicate_timestamps,
    divide_sessions_at_day_boundary,
    encoded_reconstruction_base,
    encoded_review_base,
    estimate_dominant_timezone,
    eyes_complement_is_active,
    eyes_input_partition_identity_from_support,
    eyes_input_partition_refusal_error,
    group_polled_runs,
    identify_credit_eligible_sessions,
    index_keyguard_events,
    index_observed_usage_spans,
    index_raw_dates,
    index_survey_responses,
    infer_screen_session_skeletons,
    join_app_codebook,
    mark_app_policy_matches,
    mask_excluded_app_events,
    match_app_episodes,
    matching_reconstruction_base,
    matching_review_base,
    materialize_candidate_episodes,
    materialize_credited_rows,
    materialize_polled_rows,
    order_app_episodes,
    order_source_records,
    parse_schoedel_capability_evidence_query,
    parse_sha256_digest,
    parsed_apps_forcing_screen_open,
    parsed_codebook,
    parsed_device_sharing,
    parsed_enrolled_devices,
    parsed_filter_rules,
    parsed_study_windows,
    parsed_survey_attribution,
    participant_input_boundary_from_support,
    prepare_b05_screen_substrate_query,
    query_payload,
    reconstruct_schoedel_preflight,
    remove_missing_timestamps,
    remove_selected_interaction_types,
    remove_zero_duration_rows,
    resolve_excluded_packages,
    resolve_participant_windows,
    resolve_sharing_status,
    resolve_timezone_strategy,
    review_annotations_fused,
    review_applied_rows,
    review_reconstructed_rows,
    review_reconstruction_fused,
    review_reconstruction_output,
    review_static_annotations,
    review_usage_rows_before_floor,
    sample_polled_timeline,
    schoedel_is_active,
    screen_base_input_key,
    segment_concurrent_usage,
    select_notification_events,
    select_persisted_base_kind,
    select_persisted_bases,
    sha256_bytes,
    standardize_event_clock,
    summarize_daily_apps,
    summarize_duplicate_groups,
    summarize_row_selection,
    suppress_excluded_timing,
    synthesize_placeholder_rows,
    tracked_inactive_b05_preflight,
    validate_pipeline_v2_options,
    validate_remap_rules,
    validate_verified_persisted_base_pair,
    validate_verified_request_options_digest,
};

    /// Two-slot cache for review row tables that alternate between two config
    /// states in an interactive A/B loop (e.g. toggling model_concurrent_usage
    /// on a warm engine). Salsa keeps exactly one memo per query, so A/B/A
    /// alternation always misses even though both states were already
    /// computed. Keys are the content-committing checkpoint digests of every
    /// input that shapes the value, so a hit is a proof of identical content,
    /// not a heuristic. Capacity is fixed at two states.
    ///
    /// These slots are owned by the Salsa database (see `AlternationCaches`
    /// and `EarlyStepDb::alternation_caches`), never by a thread-local. They
    /// used to be eight `thread_local!` statics, which made every engine on a
    /// worker thread share them: a freshly constructed `TrackedEngine` could
    /// answer from a *previous* engine's slots, so the "cold" arm of the
    /// warm-vs-cold tests was not cold and an incomplete slot key could never
    /// be caught by comparing the two. Owning them per database restores the
    /// property that a new engine starts with empty slots while keeping the
    /// exact same reuse within one engine.
    pub(crate) struct AlternationSlots<T> {
        pub(crate) slots: Vec<(String, PayloadHandle<T>)>,
        /// Test-only per-cache hit tally: the global
        /// `ALTERNATION_SLOT_HIT_COUNT` counts hits in ANY of the eight
        /// caches, so a non-vacuity guard on it can be satisfied by a
        /// different cache than the one a test protects.
        #[cfg(test)]
        pub(crate) hits: std::cell::Cell<usize>,
    }

    impl<T: Clone + Send + Sync + 'static> AlternationSlots<T> {
        pub(crate) const CAPACITY: usize = 2;

        pub(crate) fn lookup(&mut self, key: &str) -> Result<Option<T>, String> {
            let Some(index) = self.slots.iter().position(|(slot_key, _)| slot_key == key) else {
                return Ok(None);
            };
            #[cfg(test)]
            {
                self.hits.set(self.hits.get() + 1);
                ALTERNATION_SLOT_HIT_COUNT.with(|count| count.set(count.get() + 1));
            }
            let entry = self.slots.remove(index);
            let value = (*entry.1.lease()?).clone();
            self.slots.insert(0, entry);
            Ok(Some(value))
        }

        pub(crate) fn store(&mut self, store: &crate::payload_store::PayloadStore, key: String, value: T) {
            self.slots.retain(|(slot_key, _)| slot_key != &key);
            self.slots.insert(0, (key, query_payload(store, Arc::new(value))));
            self.slots.truncate(Self::CAPACITY);
        }
    }

    impl<T> Default for AlternationSlots<T> {
        fn default() -> Self {
            Self {
                slots: Vec::new(),
                #[cfg(test)]
                hits: std::cell::Cell::new(0),
            }
        }
    }


    /// The eight alternation slot sets, owned by one Salsa database and
    /// therefore by one `TrackedEngine`. `EarlyDatabase::default()` builds an
    /// empty set, so `TrackedEngine::default()` is genuinely cold in this
    /// dimension as well as in Salsa's.
    #[derive(Default)]
    pub(crate) struct AlternationCaches {
        pub(super) before_floor: AlternationSlots<ReviewUsageRowsBeforeFloor>,
        pub(super) static_annotations: AlternationSlots<ReviewStaticAnnotations>,
        pub(super) reconstructed_rows: AlternationSlots<ReviewReconstructedRows>,
        pub(super) annotations_fused: AlternationSlots<ReviewAnnotations>,
        pub(crate) matcher_input: AlternationSlots<QueryValue<MatcherInput>>,
        pub(crate) matcher_output: AlternationSlots<QueryValue<MatcherOutput>>,
        pub(crate) primary_outputs: AlternationSlots<QueryValue<PrimaryOutputs>>,
        pub(crate) participant_windows: AlternationSlots<QueryValue<Vec<ResolvedParticipantWindow>>>,
    }

    #[cfg(test)]
    impl AlternationCaches {
        /// Occupied slot count per cache, in declaration order. Every field is
        /// bound so adding a cache without reporting it fails to compile.
        #[deny(unused_variables)]
        pub(crate) fn slot_counts(&self) -> [usize; 8] {
            let Self {
                before_floor,
                static_annotations,
                reconstructed_rows,
                annotations_fused,
                matcher_input,
                matcher_output,
                primary_outputs,
                participant_windows,
            } = self;
            [
                before_floor.slots.len(),
                static_annotations.slots.len(),
                reconstructed_rows.slots.len(),
                annotations_fused.slots.len(),
                matcher_input.slots.len(),
                matcher_output.slots.len(),
                primary_outputs.slots.len(),
                participant_windows.slots.len(),
            ]
        }

        /// Cumulative HIT count per cache, in declaration order, so a
        /// non-vacuity guard can name the exact cache it protects instead of
        /// accepting a hit anywhere among the eight.
        #[deny(unused_variables)]
        pub(crate) fn slot_hits(&self) -> [usize; 8] {
            let Self {
                before_floor,
                static_annotations,
                reconstructed_rows,
                annotations_fused,
                matcher_input,
                matcher_output,
                primary_outputs,
                participant_windows,
            } = self;
            [
                before_floor.hits.get(),
                static_annotations.hits.get(),
                reconstructed_rows.hits.get(),
                annotations_fused.hits.get(),
                matcher_input.hits.get(),
                matcher_output.hits.get(),
                primary_outputs.hits.get(),
                participant_windows.hits.get(),
            ]
        }
    }

    #[salsa::db]
    pub(crate) trait EarlyStepDb: salsa::Database {
        fn stage_functions(&self) -> &crate::pipeline_v2::StageFunctions;
        fn payload_store(&self) -> &crate::payload_store::PayloadStore;
        fn record_query_body(&self, step: &'static str);
        fn record_internal_query_body(&self, query: &'static str);
        fn record_fused_product_step(&self, step: &'static str);
        /// The A/B alternation slots this database owns. Engine-scoped on
        /// purpose: a second engine on the same worker thread must not be
        /// able to answer from this one's slots, or a fresh engine is not
        /// cold and a cold-vs-warm comparison proves nothing.
        ///
        /// Never hold this lock across a nested query call. Every call site
        /// binds the looked-up value first (Rust 2021 keeps `if let`
        /// scrutinee temporaries alive for the whole block). The discipline
        /// is ENFORCED, not just documented: every site takes the lock with
        /// `try_lock()` -- the engine is single-threaded (one per worker, one
        /// per test), so contention can only mean re-entry, and a guard that
        /// escaped across a nested query panics with a named message instead
        /// of deadlocking silently in the browser.
        fn alternation_caches(&self) -> &Mutex<AlternationCaches>;
    }

    pub(crate) struct TrackedExecution {
        pub result: Arc<PipelineV2Result>,
        pub output_payloads: BTreeMap<String, PayloadBytes>,
        pub lineage_payload: PayloadHandle<Vec<PipelineRowLineage>>,
        pub executed_queries: Vec<String>,
        pub internal_executed_queries: Vec<String>,
    }

    #[derive(Default)]
    pub(crate) struct TrackedEngine {
        pub(crate) db: EarlyDatabase,
        pub(crate) inputs: Option<TrackedInputs>,
        /// Product query bodies physically executed inside
        /// `preflight_b05_schoedel`, which runs *before* `finish_execution`
        /// opens its own measurement window. The preflight forces
        /// `construct_screen_intervals` on the same tracked substrate
        /// `execute` consumes, so those bodies really run in the caller's
        /// request; without this log `finish_execution`'s opening drain
        /// destroys the evidence and the manifest reports them reused.
        /// Drained by `take_preflight_executed_queries`; the caller owns
        /// request scoping.
        pub(crate) preflight_executed_queries: Vec<&'static str>,
        /// Product query bodies physically executed inside
        /// `export_review_base` / `export_reconstruction_base`, which run
        /// *after* `finish_execution` drained its window. Building a base can
        /// first-demand queries the manifest did not force (the review
        /// annotation subtree on a full request), so those bodies really run
        /// in the caller's request; discarding their events badged them
        /// `cached`. Drained by `take_base_export_executed_queries`.
        pub(crate) base_export_executed_queries: Vec<&'static str>,
    }

    /// Order a physical execution log by registry position, deduplicating by
    /// identity first. `Vec::dedup` alone removes only *consecutive*
    /// duplicates, and any step absent from `WORKFLOW_QUERIES` sorts to
    /// `usize::MAX`, so distinct absent ids interleave under the stable sort
    /// and survive a trailing `dedup`.
    ///
    /// The single ordering point for both physical windows: `finish_execution`
    /// and `take_preflight_executed_queries`. They must agree, because the
    /// manifest concatenates them.
    pub(crate) fn order_by_workflow_query_position(
        steps: impl IntoIterator<Item = &'static str>,
    ) -> Vec<String> {
        let mut seen = std::collections::BTreeSet::new();
        let mut ordered = steps
            .into_iter()
            .filter(|step| seen.insert(*step))
            .map(str::to_string)
            .collect::<Vec<_>>();
        ordered.sort_by_key(|step| {
            crate::workflow_contract::WORKFLOW_QUERIES
                .iter()
                .position(|definition| definition.id == step)
                .unwrap_or(usize::MAX)
        });
        ordered
    }


    /// Names a query body records instead of its own registry name, mapped to
    /// the Salsa ingredient whose body records it. Each alias is one arm of
    /// exactly one tracked function, so the mapping is total and unambiguous;
    /// `reconcile_execution_events` normalizes through it before comparing
    /// recorded names against Salsa's own execution events.
    pub(crate) const RECORDED_BODY_ALIASES: &[(&str, &str)] = &[
        ("restore_review_base", "mark_app_policy_matches"),
        ("restore_reconstruction_screen", "classify_screen_sessions"),
        ("restore_review_screen", "classify_screen_sessions"),
        ("restore_reconstruction_base", "review_reconstructed_rows"),
        (
            "remove_zero_duration_rows_review_output",
            "remove_zero_duration_rows",
        ),
    ];

    /// The ingredient name inside one rendered `salsa::EventKind::WillExecute`
    /// database key. Salsa renders `DatabaseKeyIndex` as `query_name(Id(4c0))`
    /// while a database is attached, and falls back to
    /// `DatabaseKeyIndex(IngredientIndex(..), Id(..))` when it is not. The
    /// fallback carries no name, so it is reported as `None` and the caller
    /// degrades to the cardinality check rather than inventing a comparison.
    pub(crate) fn salsa_execution_event_name(event: &str) -> Option<&str> {
        let name = event.split('(').next()?;
        (!name.is_empty() && name != "DatabaseKeyIndex").then_some(name)
    }

    /// Reconcile one physical measurement window: the bodies that recorded a
    /// name against the bodies Salsa says it executed.
    ///
    /// Cardinality alone is not enough. One recorded body that did not execute
    /// plus one executed body that recorded nothing cancel exactly, and that
    /// pair is the failure the 2026-08 postmortem names: the count stays
    /// right while the published physical status is wrong for two queries.
    /// Comparing the ordered name multisets catches the pair, and names both
    /// sides of it in the error.
    pub(crate) fn reconcile_execution_events(
        label: &str,
        query_bodies: &[&'static str],
        internal_query_bodies: &[&'static str],
        will_execute: &[String],
    ) -> Result<(), String> {
        if query_bodies.len() + internal_query_bodies.len() != will_execute.len() {
            return Err(format!(
                "Salsa {label}execution-event mismatch: {} product query bodies plus {} internal derived query bodies but {} WillExecute events: product={query_bodies:?} internal={internal_query_bodies:?} events={will_execute:?}",
                query_bodies.len(),
                internal_query_bodies.len(),
                will_execute.len(),
            ));
        }
        let mut observed = Vec::with_capacity(will_execute.len());
        for event in will_execute {
            match salsa_execution_event_name(event) {
                Some(name) => observed.push(name),
                // No database was attached when this event was rendered, so
                // no name exists to compare. The cardinality check above still
                // stands; do not fabricate a set comparison from indices.
                None => {
                    #[cfg(test)]
                    UNNAMED_EXECUTION_EVENTS.with(|count| count.set(count.get() + 1));
                    return Ok(());
                }
            }
        }
        let mut recorded = query_bodies
            .iter()
            .chain(internal_query_bodies)
            .map(|step| {
                RECORDED_BODY_ALIASES
                    .iter()
                    .find_map(|(alias, owner)| (alias == step).then_some(*owner))
                    .unwrap_or(*step)
            })
            .collect::<Vec<_>>();
        recorded.sort_unstable();
        observed.sort_unstable();
        if recorded == observed {
            return Ok(());
        }
        let recorded_only = difference_multiset(&recorded, &observed);
        let executed_only = difference_multiset(&observed, &recorded);
        Err(format!(
            "Salsa {label}execution-event name mismatch: recorded without executing={recorded_only:?} executed without recording={executed_only:?} recorded={recorded:?} events={will_execute:?}",
        ))
    }

    /// Multiset difference of two SORTED name slices: every occurrence in
    /// `left` that `right` does not also carry.
    pub(crate) fn difference_multiset<'a>(left: &[&'a str], right: &[&'a str]) -> Vec<&'a str> {
        let mut remaining = right.to_vec();
        let mut extra = Vec::new();
        for name in left {
            match remaining.iter().position(|other| other == name) {
                Some(index) => {
                    remaining.remove(index);
                }
                None => extra.push(*name),
            }
        }
        extra
    }

    pub(crate) fn executable_eyes_partition_preflight(
        csv_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<Option<EyesInputPartitionPreflightResult>, String> {
        if !eyes_complement_is_active(options) {
            return Ok(None);
        }
        if csv_bytes.is_empty() {
            return Err(EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
        }
        let receipt = preflight_eyes_complement_input_partition(
            csv_bytes,
            options,
            eyes_input_partition_identity_from_support(support),
            participant_input_boundary_from_support(support),
        )
        .map_err(|error| error.to_string())?;
        if receipt.disposition == ScientificPreflightDisposition::Refused {
            return Err(eyes_input_partition_refusal_error(&receipt));
        }
        if receipt.disposition != ScientificPreflightDisposition::Executable {
            return Err("active EYES input-partition preflight was not executable".into());
        }
        Ok(Some(receipt))
    }

    impl TrackedEngine {
        pub(crate) fn with_dependencies(stages: crate::pipeline_v2::StageFunctions, store: crate::payload_store::PayloadStore) -> Self {
            Self { db: EarlyDatabase::with_dependencies(stages, store), inputs: None, preflight_executed_queries: Vec::new(), base_export_executed_queries: Vec::new() }
        }

        pub fn preflight_eyes_complement_input_partition(
            &self,
            csv_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
        ) -> Result<EyesInputPartitionPreflightResult, String> {
            preflight_eyes_complement_input_partition(
                csv_bytes,
                options,
                eyes_input_partition_identity_from_support(support),
                participant_input_boundary_from_support(support),
            )
            .map_err(|error| error.to_string())
        }

        pub fn preflight_b05_schoedel(
            &mut self,
            csv_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
        ) -> Result<B05SchoedelPreflightResult, String> {
            self.preflight_b05_schoedel_raw(super::super::RawCsvBytes::Borrowed(csv_bytes), options, support)
        }

        pub fn preflight_b05_schoedel_raw(
            &mut self,
            raw_csv: super::super::RawCsvBytes<'_>,
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
        ) -> Result<B05SchoedelPreflightResult, String> {
            let csv_bytes = raw_csv.as_slice();
            validate_pipeline_v2_options(options).map_err(|error| error.to_string())?;
            validate_verified_request_options_digest(support.verified_request_options_digest)?;
            let source_screen_active = matches!(
                options.usage_session_mode,
                UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
            ) && options.screen_session_construction_strategy
                != ScreenSessionConstructionStrategyId::default();
            if csv_bytes.is_empty() && (source_screen_active || schoedel_is_active(options)) {
                return Err(B05_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
            }
            let input_sha256 = match self.inputs {
                Some(inputs) if inputs.raw.bytes(&self.db).as_slice() == csv_bytes => {
                    inputs.raw.input_sha256(&self.db)
                }
                _ => sha256_bytes(csv_bytes),
            };
            let inputs = match self.inputs {
                Some(inputs) => {
                    // Carry the live output mode forward instead of forcing
                    // review mode. `update` derives
                    // `UsageConfigInput::review_only` from this flag, and the
                    // preflight neither reads nor influences it: the cone it
                    // evaluates is `construct_screen_intervals` and
                    // `reconstruct_schoedel_preflight`, which
                    // `preflight_reports_the_screen_interval_cone_it_warms_and_nothing_downstream`
                    // shows stay cached when `execute` flips the mode back.
                    // Forcing `false` here and letting `execute` restore `true`
                    // bumped the Salsa revision of `review_only` twice per
                    // request, so `segment_concurrent_usage`,
                    // `remove_zero_duration_rows`, `apply_participant_windows`,
                    // `classify_person_attribution`,
                    // `synthesize_placeholder_rows`, and
                    // `assemble_result_manifest` -- the six queries that read
                    // it -- recomputed on every preflight-bearing request even
                    // when the raw bytes, the options, and the workspace root
                    // were byte-identical.
                    let live_materialize_full_outputs =
                        inputs.output.materialize_full_outputs(&self.db);
                    // Carry the live persisted-base bytes forward for the same
                    // reason: the preflight neither reads nor influences them
                    // outside the Schoedel substrate, and zeroing them here
                    // flipped `review_base_bytes` / `reconstruction_base_bytes`
                    // real -> [] -> real per request (invalidating the decode,
                    // matching, and restore cones on every preflight-bearing
                    // warm request), while the warm-verified path -- which
                    // preserves inputs -- kept the emptied state and silently
                    // dropped the persisted-base substrate.
                    let live_review_base = inputs.raw.review_base_bytes(&self.db);
                    let live_reconstruction_base =
                        inputs.raw.reconstruction_base_bytes(&self.db);
                    inputs.update(
                        &mut self.db,
                        raw_csv,
                        &input_sha256,
                        live_review_base.as_slice(),
                        live_reconstruction_base.as_slice(),
                        options,
                        support,
                        live_materialize_full_outputs,
                        false,
                    );
                    inputs
                }
                None => {
                    let inputs = TrackedInputs::new(
                        &self.db,
                        raw_csv,
                        input_sha256,
                        &[],
                        &[],
                        options,
                        support,
                        false,
                    );
                    self.inputs = Some(inputs);
                    inputs
                }
            };
            if !b05_schoedel_is_active(options) {
                return Ok(tracked_inactive_b05_preflight(
                    options,
                    support.verified_request_options_digest,
                ));
            }
            // Open a measurement window around the two tracked evaluations
            // below, mirroring `finish_execution`. Everything the preflight
            // forces is real physical execution in this request; discarding it
            // is what made the manifest badge those bodies `cached` while
            // publishing a changed `output_digest` for them.
            self.db.take_query_bodies();
            self.db.take_internal_query_bodies();
            self.db.take_fused_product_steps();
            self.db.take_will_execute();
            let screen = construct_screen_intervals(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
            )?;
            let screen_payload = screen.value.lease()?;
            let schoedel = if schoedel_is_active(options) {
                Some(if !screen_payload.executable() {
                    crate::b05_foundational_semantics::schoedel_b05_dependency_refusal(
                        &screen_payload.applicability,
                    )
                } else {
                    reconstruct_schoedel_preflight(
                        &self.db,
                        inputs.raw,
                        inputs.early,
                        inputs.usage,
                        inputs.usage_support,
                    )?
                    .output
                    .clone()
                })
            } else {
                None
            };
            let preflight_query_bodies = self.db.take_query_bodies();
            let preflight_internal_query_bodies = self.db.take_internal_query_bodies();
            let preflight_fused_product_steps = self.db.take_fused_product_steps();
            let preflight_will_execute = self.db.take_will_execute();
            reconcile_execution_events(
                "preflight ",
                &preflight_query_bodies,
                &preflight_internal_query_bodies,
                &preflight_will_execute,
            )?;
            self.preflight_executed_queries
                .extend(preflight_query_bodies);
            self.preflight_executed_queries
                .extend(preflight_fused_product_steps);
            Ok(bind_tracked_finalized_preflight(
                options,
                support.verified_request_options_digest,
                &screen_payload,
                schoedel,
            ))
        }

        /// Drain the product query bodies executed by every
        /// `preflight_b05_schoedel` call since the last drain, ordered by
        /// `WORKFLOW_QUERIES` position exactly as `finish_execution` orders
        /// its own window. Returned out of band rather than on
        /// `B05SchoedelPreflightResult`, because that value is compared for
        /// equality between the prepared and the repeated preflight and a log
        /// that is non-empty cold and empty warm would fail that comparison.
        pub fn take_preflight_executed_queries(&mut self) -> Vec<String> {
            order_by_workflow_query_position(std::mem::take(&mut self.preflight_executed_queries))
        }

        /// Drain the product query bodies executed by every base export since
        /// the last drain, ordered exactly as the other physical windows.
        pub fn take_base_export_executed_queries(&mut self) -> Vec<String> {
            order_by_workflow_query_position(std::mem::take(
                &mut self.base_export_executed_queries,
            ))
        }

        pub fn execute(
            &mut self,
            csv_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            self.execute_with_review_bases(
                csv_bytes,
                &[],
                &[],
                options,
                support,
                materialize_full_outputs,
            )
        }

        #[cfg(test)]
        pub fn execute_with_review_base(
            &mut self,
            csv_bytes: &[u8],
            review_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            self.execute_with_review_bases(
                csv_bytes,
                review_base_bytes,
                &[],
                options,
                support,
                materialize_full_outputs,
            )
        }

        pub fn execute_with_review_bases(
            &mut self,
            csv_bytes: &[u8],
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            self.execute_with_review_bases_raw(
                super::super::RawCsvBytes::Borrowed(csv_bytes),
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
                materialize_full_outputs,
            )
        }

        pub fn execute_with_review_bases_raw(
            &mut self,
            raw_csv: super::super::RawCsvBytes<'_>,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            let csv_bytes = raw_csv.as_slice();
            validate_pipeline_v2_options(options).map_err(|error| error.to_string())?;
            validate_verified_request_options_digest(support.verified_request_options_digest)?;
            let eyes_partition_preflight =
                executable_eyes_partition_preflight(csv_bytes, options, support)?;
            // The live database already binds a verified digest to its raw
            // bytes; a byte compare is an order of magnitude cheaper than
            // re-hashing the full raw input on every warm review.
            let input_sha256 = match self.inputs {
                Some(inputs) if inputs.raw.bytes(&self.db).as_slice() == csv_bytes => {
                    inputs.raw.input_sha256(&self.db)
                }
                _ => sha256_bytes(csv_bytes),
            };
            let (review_base_bytes, reconstruction_base_bytes) = select_persisted_bases(
                &input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
            )?;
            let inputs = match self.inputs {
                Some(inputs) => {
                    inputs.update(
                        &mut self.db,
                        raw_csv,
                        &input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                        false,
                    );
                    inputs
                }
                None => {
                    let inputs = TrackedInputs::new(
                        &self.db,
                        raw_csv,
                        input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                    );
                    self.inputs = Some(inputs);
                    inputs
                }
            };
            self.finish_execution(inputs, eyes_partition_preflight)
        }

        pub fn execute_with_owned_csv_review_bases(
            &mut self,
            csv_bytes: Vec<u8>,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            let input_sha256 = sha256_bytes(&csv_bytes);
            self.execute_with_verified_csv_review_bases(
                csv_bytes,
                input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
                materialize_full_outputs,
            )
        }

        // The verified digest is deliberately adjacent to the bytes and both
        // cache candidates so callers cannot accidentally take an unverified
        // persisted-input path.
        #[allow(clippy::too_many_arguments)]
        pub fn execute_with_verified_csv_review_bases(
            &mut self,
            csv_bytes: Vec<u8>,
            input_sha256: String,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            validate_pipeline_v2_options(options).map_err(|error| error.to_string())?;
            validate_verified_request_options_digest(support.verified_request_options_digest)?;
            parse_sha256_digest(&input_sha256, "verified raw input digest")?;
            let eyes_partition_preflight =
                executable_eyes_partition_preflight(&csv_bytes, options, support)?;
            let selected_base_kind = select_persisted_base_kind(
                &input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
            )?;
            if csv_bytes.is_empty()
                && !reconstruction_base_bytes.is_empty()
                && !b05_schoedel_is_active(options)
                && (selected_base_kind != PersistedReviewBaseSelection::Reconstruction
                    || review_base_bytes.len() == REVIEW_BASE_HEADER_BYTES)
            {
                return Err("verified_persisted_base_pair_mismatch".into());
            }
            if csv_bytes.is_empty()
                && selected_base_kind == PersistedReviewBaseSelection::Reconstruction
            {
                validate_verified_persisted_base_pair(
                    self.db.payload_store(),
                    &input_sha256,
                    review_base_bytes,
                    reconstruction_base_bytes,
                    options,
                    support,
                )?;
            }
            let (review_base_bytes, reconstruction_base_bytes) = select_persisted_bases(
                &input_sha256,
                review_base_bytes,
                reconstruction_base_bytes,
                options,
                support,
            )?;
            let inputs = match self.inputs {
                Some(inputs) => {
                    // The live Salsa database already owns the current byte
                    // inputs. Compare borrowed request bytes first so an
                    // identical review does not allocate and scan another
                    // complete 14--16 MiB persisted base before discovering
                    // that the tracked input is unchanged.
                    inputs.update(
                        &mut self.db,
                        super::super::RawCsvBytes::Borrowed(&csv_bytes),
                        &input_sha256,
                        review_base_bytes,
                        reconstruction_base_bytes,
                        options,
                        support,
                        materialize_full_outputs,
                        false,
                    );
                    inputs
                }
                None => {
                    let inputs = TrackedInputs::new_owned(
                        &self.db,
                        Arc::new(csv_bytes),
                        input_sha256,
                        Arc::new(review_base_bytes.to_vec()),
                        Arc::new(reconstruction_base_bytes.to_vec()),
                        options,
                        support,
                        materialize_full_outputs,
                    );
                    self.inputs = Some(inputs);
                    inputs
                }
            };
            self.finish_execution(inputs, eyes_partition_preflight)
        }

        /// The raw bytes the live tracked input holds, if any.
        pub fn live_raw_bytes(&self) -> Option<Arc<Vec<u8>>> {
            self.inputs.map(|inputs| inputs.raw.bytes(&self.db))
        }

        pub(crate) fn uses_store(&self, store: &crate::payload_store::PayloadStore) -> bool {
            self.db.payload_store().same_store(store)
        }

        pub fn has_verified_input(&self, input_sha256: &str) -> bool {
            self.inputs
                .is_some_and(|inputs| inputs.raw.input_sha256(&self.db) == input_sha256)
        }

        #[allow(clippy::too_many_arguments)]
        pub fn execute_with_warm_verified_input(
            &mut self,
            input_sha256: String,
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Result<TrackedExecution, String> {
            validate_pipeline_v2_options(options).map_err(|error| error.to_string())?;
            validate_verified_request_options_digest(support.verified_request_options_digest)?;
            parse_sha256_digest(&input_sha256, "verified raw input digest")?;
            let inputs = self
                .inputs
                .ok_or_else(|| "warm review requires live tracked inputs".to_string())?;
            if inputs.raw.input_sha256(&self.db) != input_sha256 {
                return Err("warm review input identity mismatch".into());
            }
            let retained_raw = inputs.raw.bytes(&self.db);
            let eyes_partition_preflight =
                executable_eyes_partition_preflight(&retained_raw, options, support)?;
            inputs.update(
                &mut self.db,
                super::super::RawCsvBytes::Borrowed(&[]),
                &input_sha256,
                &[],
                &[],
                options,
                support,
                materialize_full_outputs,
                true,
            );
            self.finish_execution(inputs, eyes_partition_preflight)
        }

        pub(crate) fn finish_execution(
            &mut self,
            inputs: TrackedInputs,
            eyes_partition_preflight: Option<EyesInputPartitionPreflightResult>,
        ) -> Result<TrackedExecution, String> {
            let usage_mode = inputs.usage.usage_session_mode(&self.db);
            let source_screen_active =
                matches!(
                    usage_mode,
                    UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
                ) && inputs.usage.screen_session_construction_strategy(&self.db)
                    != ScreenSessionConstructionStrategyId::default();
            let schoedel_active = matches!(
                usage_mode,
                UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
            ) && inputs.usage.episode_reconstruction_strategy(&self.db)
                == EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1;
            let eyes_active = inputs.usage.episode_reconstruction_strategy(&self.db)
                == EpisodeReconstructionStrategy::EyesComplement
                && matches!(
                    usage_mode,
                    UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
                );
            if inputs.raw.bytes(&self.db).is_empty()
                && (source_screen_active || schoedel_active || eyes_active)
            {
                if eyes_active {
                    return Err(EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
                }
                return Err(B05_RETAINED_RAW_INPUT_REQUIRED_ERROR.into());
            }
            self.db.take_query_bodies();
            self.db.take_internal_query_bodies();
            self.db.take_fused_product_steps();
            self.db.take_will_execute();
            let stored_result = assemble_result_manifest(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
                inputs.late,
                inputs.late_support,
                inputs.output,
            )?
            .value
            .lease()?;
            let result = stored_result.materialize()?;
            if result.eyes_input_partition_preflight != eyes_partition_preflight {
                return Err(
                    "tracked EYES input-partition receipt disagrees with execution gate".into(),
                );
            }
            let query_bodies = self.db.take_query_bodies();
            let internal_query_bodies = self.db.take_internal_query_bodies();
            let fused_product_steps = self.db.take_fused_product_steps();
            let will_execute = self.db.take_will_execute();
            reconcile_execution_events(
                "",
                &query_bodies,
                &internal_query_bodies,
                &will_execute,
            )?;
            let executed_queries = order_by_workflow_query_position(
                query_bodies.into_iter().chain(fused_product_steps),
            );
            let internal_executed_queries = internal_query_bodies
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>();
            let output_payloads = result.output_payloads();
            Ok(TrackedExecution {
                result,
                output_payloads,
                lineage_payload: stored_result.outputs.row_lineage.clone(),
                executed_queries,
                internal_executed_queries,
            })
        }

        /// `Ok(None)` when the base exceeds its uncompressed ceiling: the run
        /// stands, no review-event resume is persisted for this input.
        pub fn export_review_base(&mut self) -> Result<Option<Vec<u8>>, String> {
            let inputs = self
                .inputs
                .ok_or_else(|| "review base requires a completed pipeline execution".to_string())?;
            let cached = encoded_review_base(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
            )
            .and_then(|payload| {
                payload.map(|payload| {
                    let bytes = payload.lease().map(|bytes| (*bytes).clone());
                    payload.mark_cold();
                    bytes
                }).transpose()
            });
            // A failed spill or reload is transient: rebuild once uncached
            // rather than fail on the memoized error.
            let bytes = match cached {
                Ok(bytes) => bytes,
                Err(_) => build_review_base(
                    &self.db,
                    inputs.raw,
                    inputs.early,
                    inputs.usage,
                    inputs.usage_support,
                )?,
            };
            self.record_base_export_window("review base export")?;
            Ok(bytes)
        }

        /// `Ok(None)` when the base exceeds its uncompressed ceiling, as for
        /// `export_review_base`.
        pub fn export_reconstruction_base(&mut self) -> Result<Option<Vec<u8>>, String> {
            let inputs = self.inputs.ok_or_else(|| {
                "reconstruction base requires a completed pipeline execution".to_string()
            })?;
            let cached = encoded_reconstruction_base(
                &self.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
            )
            .and_then(|payload| {
                payload.map(|payload| {
                    let bytes = payload.lease().map(|bytes| (*bytes).clone());
                    payload.mark_cold();
                    bytes
                }).transpose()
            });
            // A failed spill or reload is transient: rebuild once uncached
            // rather than fail on the memoized error.
            let bytes = match cached {
                Ok(bytes) => bytes,
                Err(_) => build_reconstruction_base(
                    &self.db,
                    inputs.raw,
                    inputs.early,
                    inputs.usage,
                    inputs.usage_support,
                )?,
            };
            self.record_base_export_window("reconstruction base export")?;
            Ok(bytes)
        }

        /// Apply the same execution-event accounting to a base-export window
        /// that `finish_execution` and the preflight apply to theirs: every
        /// Salsa body that ran must have recorded exactly one name, and the
        /// product bodies join the request's physical log instead of being
        /// discarded.
        ///
        /// Fused product steps are deliberately NOT promoted here, unlike in
        /// the request windows. In a request window a fused body IS the
        /// review-mode execution of its product steps; in the export window
        /// the same records come from internal aggregates
        /// (`review_reconstruction_fused`, `review_annotations_fused`)
        /// re-deriving persisted CHECKPOINTS, while the product bodies those
        /// names belong to were memoized or cut off. Promoting them badged
        /// `apply_app_inclusion_policy`/`order_app_episodes` as executed on a
        /// B06-axis transition whose row output never changed -- a false
        /// execution claim the configuration-interventions drift gate
        /// correctly rejected (measured, depev 2026-08-25). A product body
        /// that ever does run in this window still lands in the log below.
        pub(crate) fn record_base_export_window(&mut self, label: &str) -> Result<(), String> {
            let export_query_bodies = self.db.take_query_bodies();
            let export_internal_query_bodies = self.db.take_internal_query_bodies();
            let export_fused_product_steps = self.db.take_fused_product_steps();
            let export_will_execute = self.db.take_will_execute();
            reconcile_execution_events(
                &format!("{label} "),
                &export_query_bodies,
                &export_internal_query_bodies,
                &export_will_execute,
            )?;
            let _ = export_fused_product_steps;
            self.base_export_executed_queries.extend(export_query_bodies);
            Ok(())
        }
    }

    #[salsa::db]
    #[derive(Clone)]
    pub(crate) struct EarlyDatabase {
        stages: crate::pipeline_v2::StageFunctions,
        store: crate::payload_store::PayloadStore,
        pub(crate) storage: salsa::Storage<Self>,
        pub(crate) query_bodies: Arc<Mutex<Vec<&'static str>>>,
        pub(crate) internal_query_bodies: Arc<Mutex<Vec<&'static str>>>,
        pub(crate) fused_product_steps: Arc<Mutex<Vec<&'static str>>>,
        pub(crate) will_execute: Arc<Mutex<Vec<String>>>,
        pub(crate) alternation_caches: Arc<Mutex<AlternationCaches>>,
    }

    impl Default for EarlyDatabase {
        fn default() -> Self {
            Self::with_dependencies(crate::pipeline_v2::StageFunctions::production(), crate::payload_store::current_store())
        }
    }

    impl EarlyDatabase {
        pub(crate) fn with_dependencies(stages: crate::pipeline_v2::StageFunctions, store: crate::payload_store::PayloadStore) -> Self {
            let will_execute = Arc::<Mutex<Vec<String>>>::default();
            Self {
                stages, store,
                storage: salsa::Storage::builder()
                    .event_callback(Box::new({
                        let will_execute = Arc::clone(&will_execute);
                        move |event| {
                            if let salsa::EventKind::WillExecute { database_key } = event.kind {
                                will_execute
                                    .lock()
                                    .expect("Salsa execution event log")
                                    .push(format!("{database_key:?}"));
                            }
                        }
                    }))
                    .ingredient::<EarlyRawInput>()
                    .ingredient::<EarlyConfigInput>()
                    .ingredient::<UsageConfigInput>()
                    .ingredient::<UsageSupportInput>()
                    .ingredient::<LateConfigInput>()
                    .ingredient::<LateSupportInput>()
                    .ingredient::<OutputConfigInput>()
                    .ingredient::<decoded_review_base>()
                    .ingredient::<decoded_reconstruction_base>()
                    .ingredient::<matching_review_base>()
                    .ingredient::<matching_reconstruction_base>()
                    .ingredient::<encoded_review_base>()
                    .ingredient::<encoded_reconstruction_base>()
                    .ingredient::<screen_base_input_key>()
                    .ingredient::<validate_remap_rules>()
                    .ingredient::<decode_source_records>()
                    .ingredient::<remove_missing_timestamps>()
                    .ingredient::<attach_device_models>()
                    .ingredient::<bind_processing_timestamp>()
                    .ingredient::<canonicalize_source_rows>()
                    .ingredient::<order_source_records>()
                    .ingredient::<collect_timezone_observations>()
                    .ingredient::<estimate_dominant_timezone>()
                    .ingredient::<resolve_timezone_strategy>()
                    .ingredient::<standardize_event_clock>()
                    .ingredient::<summarize_row_selection>()
                    .ingredient::<coalesce_duplicate_event_keys>()
                    .ingredient::<summarize_duplicate_groups>()
                    .ingredient::<disambiguate_duplicate_timestamps>()
                    .ingredient::<derive_time_gap_evidence>()
                    .ingredient::<background_apps>()
                    .ingredient::<parsed_filter_rules>()
                    .ingredient::<parsed_apps_forcing_screen_open>()
                    .ingredient::<parsed_codebook>()
                    .ingredient::<parsed_study_windows>()
                    .ingredient::<parsed_device_sharing>()
                    .ingredient::<parsed_survey_attribution>()
                    .ingredient::<parsed_enrolled_devices>()
                    .ingredient::<mark_app_policy_matches>()
                    .ingredient::<index_keyguard_events>()
                    .ingredient::<infer_screen_session_skeletons>()
                    .ingredient::<classify_screen_sessions>()
                    .ingredient::<resolve_excluded_packages>()
                    .ingredient::<mask_excluded_app_events>()
                    .ingredient::<blind_lineage_suffix_digests>()
                    .ingredient::<build_app_event_index>()
                    .ingredient::<match_app_episodes>()
                    .ingredient::<review_applied_rows>()
                    .ingredient::<review_usage_rows_before_floor>()
                    .ingredient::<review_static_annotations>()
                    .ingredient::<review_reconstructed_rows>()
                    .ingredient::<review_reconstruction_fused>()
                    .ingredient::<review_reconstruction_output>()
                    .ingredient::<materialize_candidate_episodes>()
                    .ingredient::<classify_episode_durations>()
                    .ingredient::<apply_app_inclusion_policy>()
                    .ingredient::<order_app_episodes>()
                    .ingredient::<segment_concurrent_usage>()
                    .ingredient::<join_app_codebook>()
                    .ingredient::<derive_broad_category>()
                    .ingredient::<collapse_app_genre>()
                    .ingredient::<review_annotations_fused>()
                    .ingredient::<assign_usage_session_ids>()
                    .ingredient::<derive_engagement_basis>()
                    .ingredient::<apply_episode_flags>()
                    .ingredient::<suppress_excluded_timing>()
                    .ingredient::<remove_selected_interaction_types>()
                    .ingredient::<remove_zero_duration_rows>()
                    .ingredient::<identify_credit_eligible_sessions>()
                    .ingredient::<build_activity_witness_indexes>()
                    .ingredient::<assess_screen_evidence_capability>()
                    .ingredient::<summarize_daily_apps>()
                    .ingredient::<derive_credited_intervals>()
                    .ingredient::<materialize_credited_rows>()
                    .ingredient::<assemble_credit_outputs>()
                    .ingredient::<select_notification_events>()
                    .ingredient::<index_observed_usage_spans>()
                    .ingredient::<classify_notification_contacts>()
                    .ingredient::<assemble_notification_contact_outputs>()
                    .ingredient::<sample_polled_timeline>()
                    .ingredient::<group_polled_runs>()
                    .ingredient::<materialize_polled_rows>()
                    .ingredient::<assemble_polled_emulation_outputs>()
                    .ingredient::<resolve_participant_windows>()
                    .ingredient::<apply_participant_windows>()
                    .ingredient::<resolve_sharing_status>()
                    .ingredient::<index_survey_responses>()
                    .ingredient::<classify_person_attribution>()
                    .ingredient::<divide_sessions_at_day_boundary>()
                    .ingredient::<synthesize_placeholder_rows>()
                    .ingredient::<index_raw_dates>()
                    .ingredient::<build_participant_day_coverage>()
                    .ingredient::<aggregate_attribution_minutes>()
                    .ingredient::<compute_attribution_completeness>()
                    .ingredient::<classify_compliance_days>()
                    .ingredient::<codebook_is_empty>()
                    .ingredient::<assemble_primary_outputs>()
                    .ingredient::<collect_early_assembly>()
                    .ingredient::<prepare_b05_screen_substrate_query>()
                    .ingredient::<parse_schoedel_capability_evidence_query>()
                    .ingredient::<construct_screen_intervals>()
                    .ingredient::<reconstruct_schoedel_preflight>()
                    .ingredient::<assemble_result_manifest>()
                    .build(),
                query_bodies: Arc::default(),
                internal_query_bodies: Arc::default(),
                fused_product_steps: Arc::default(),
                will_execute,
                alternation_caches: Arc::default(),
            }
        }
    }

    #[salsa::db]
    impl salsa::Database for EarlyDatabase {}

    #[salsa::db]
    impl EarlyStepDb for EarlyDatabase {
        fn stage_functions(&self) -> &crate::pipeline_v2::StageFunctions { &self.stages }
        fn payload_store(&self) -> &crate::payload_store::PayloadStore { &self.store }
        fn record_query_body(&self, step: &'static str) {
            self.query_bodies.lock().expect("query body log").push(step);
        }

        fn record_internal_query_body(&self, query: &'static str) {
            self.internal_query_bodies
                .lock()
                .expect("internal query body log")
                .push(query);
        }

        fn record_fused_product_step(&self, step: &'static str) {
            self.fused_product_steps
                .lock()
                .expect("fused product step log")
                .push(step);
        }

        fn alternation_caches(&self) -> &Mutex<AlternationCaches> {
            &self.alternation_caches
        }
    }

    impl EarlyDatabase {
        pub(crate) fn take_query_bodies(&self) -> Vec<&'static str> {
            std::mem::take(&mut *self.query_bodies.lock().expect("query body log"))
        }

        pub(crate) fn take_internal_query_bodies(&self) -> Vec<&'static str> {
            std::mem::take(
                &mut *self
                    .internal_query_bodies
                    .lock()
                    .expect("internal query body log"),
            )
        }

        pub(crate) fn take_fused_product_steps(&self) -> Vec<&'static str> {
            std::mem::take(
                &mut *self
                    .fused_product_steps
                    .lock()
                    .expect("fused product step log"),
            )
        }

        pub(crate) fn take_will_execute(&self) -> Vec<String> {
            std::mem::take(&mut *self.will_execute.lock().expect("Salsa execution event log"))
        }
    }
