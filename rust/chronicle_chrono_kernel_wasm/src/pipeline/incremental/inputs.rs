use crate::pipeline_v2::{FilterMatchField, IntervalExpansionMethod, InteractionTypeRemovalMode, LockedScreenAudioDisposition, ScreenSessionClassificationPolicy, ScreenSessionMaximumDurationDisposition};
use salsa::Setter;
use super::{
    Arc,
    BTreeSet,
    DayBoundaryAttribution,
    EarlyDatabase,
    EpisodeReconstructionStrategy,
    EventRetentionSet,
    IntervalQualityPolicy,
    MicroUseClassificationPolicy,
    MinimumDurationComparator,
    MinimumDurationDisposition,
    NotificationProxyRule,
    OpenerSet,
    PackageExclusionPreset,
    PipelineV2Options,
    PipelineV2SupportFiles,
    PolledEmulationMethod,
    ScreenGatingRule,
    ScreenSessionConstructionStrategyId,
    SessionBoundaryScope,
    SessionGapBasis,
    SessionGroupingPolicy,
    UsageSessionMode,
};

    #[salsa::input(singleton)]
    pub(crate) struct EarlyRawInput {
        #[returns(clone)]
        pub(crate) bytes: Arc<Vec<u8>>,
        /// SHA-256 verified by the runtime at ingestion. Persisted review
        /// bases bind this identity so later A/B reviews do not need to copy
        /// and hash the unchanged raw object again.
        #[returns(clone)]
        pub(crate) input_sha256: String,
        /// Optional product-owned checkpoint produced by a previous full run.
        /// Empty means the existing raw-input path is authoritative.
        #[returns(clone)]
        pub(crate) review_base_bytes: Arc<Vec<u8>>,
        /// Optional post-reconstruction checkpoint stored separately so a cache miss does
        /// not make the smaller post-review review base more expensive to decode.
        #[returns(clone)]
        pub(crate) reconstruction_base_bytes: Arc<Vec<u8>>,
    }

    #[salsa::input(singleton)]
    pub(crate) struct EarlyConfigInput {
        #[returns(clone)]
        pub(crate) interaction_type_remap: Arc<Vec<String>>,
        #[returns(clone)]
        pub(crate) timezone: String,
        #[returns(clone)]
        pub(crate) timezone_handling: String,
        #[returns(clone)]
        pub(crate) datetime_of_preprocessing: String,
        #[returns(copy)]
        pub(crate) deduplicate_exact_rows: bool,
        #[returns(copy)]
        pub(crate) drop_out_of_source_order_events: bool,
        #[returns(copy)]
        pub(crate) correct_duplicate_event_timestamps: bool,
        #[returns(clone)]
        pub(crate) same_app_stop_types: Arc<Vec<String>>,
        #[returns(clone)]
        pub(crate) other_stop_types: Arc<Vec<String>>,
    }

    #[salsa::input(singleton)]
    pub(crate) struct UsageConfigInput {
        #[returns(copy)]
        pub(crate) usage_session_mode: UsageSessionMode,
        #[returns(copy)]
        pub(crate) screen_session_construction_strategy: ScreenSessionConstructionStrategyId,
        #[returns(copy)]
        pub(crate) screen_session_construction_strategy_explicit: bool,
        #[returns(copy)]
        pub(crate) screen_session_classification_policy: ScreenSessionClassificationPolicy,
        #[returns(copy)]
        pub(crate) screen_session_maximum_duration_minutes: f64,
        #[returns(copy)]
        pub(crate) screen_session_maximum_duration_disposition: ScreenSessionMaximumDurationDisposition,
        #[returns(copy)]
        pub(crate) locked_screen_audio_disposition: LockedScreenAudioDisposition,
        #[returns(copy)]
        pub(crate) model_concurrent_usage: bool,
        #[returns(copy)]
        pub(crate) episode_reconstruction_strategy: EpisodeReconstructionStrategy,
        #[returns(copy)]
        pub(crate) opener_set: OpenerSet,
        #[returns(copy)]
        pub(crate) session_grouping_policy: SessionGroupingPolicy,
        #[returns(copy)]
        pub(crate) session_gap_basis: SessionGapBasis,
        #[returns(copy)]
        pub(crate) session_boundary_scope: SessionBoundaryScope,
        #[returns(copy)]
        pub(crate) emit_session_break_lineage: bool,
        #[returns(copy)]
        pub(crate) event_retention_set: EventRetentionSet,
        #[returns(copy)]
        pub(crate) allow_stop_event_reuse: bool,
        #[returns(copy)]
        pub(crate) use_activity_stopped_as_fallback: bool,
        #[returns(copy)]
        pub(crate) apply_threshold_to_fallback: bool,
        #[returns(copy)]
        pub(crate) long_duration_threshold_ns: i64,
        #[returns(copy)]
        pub(crate) proximity_interval_ns: i64,
        #[returns(copy)]
        pub(crate) micro_use_classification_policy: MicroUseClassificationPolicy,
        #[returns(copy)]
        pub(crate) micro_use_classification_policy_explicit: bool,
        #[returns(copy)]
        pub(crate) minimum_usage_duration: f64,
        #[returns(copy)]
        pub(crate) minimum_usage_duration_explicit: bool,
        #[returns(copy)]
        pub(crate) minimum_duration_comparator: MinimumDurationComparator,
        #[returns(copy)]
        pub(crate) minimum_duration_comparator_explicit: bool,
        #[returns(copy)]
        pub(crate) minimum_duration_disposition: MinimumDurationDisposition,
        #[returns(copy)]
        pub(crate) minimum_duration_disposition_explicit: bool,
        #[returns(copy)]
        pub(crate) apply_minimum_usage_duration_to_concurrent_subintervals: bool,
        // B06 wire keys, one Salsa fact per key, named exactly as they arrive
        // so the field-graph scan binds each request key to its reads.
        #[returns(clone)]
        pub(crate) maximum_duration_policy: Option<String>,
        #[returns(clone)]
        pub(crate) maximum_duration_disposition: Option<String>,
        #[returns(clone)]
        pub(crate) maximum_duration_threshold_source: Option<String>,
        #[returns(clone)]
        pub(crate) maximum_duration_threshold_ns: Option<String>,
        #[returns(copy)]
        pub(crate) long_duration_threshold_explicit: bool,
        #[returns(clone)]
        pub(crate) b06_legacy_threshold_hours_canonical: Option<String>,
        #[returns(clone)]
        pub(crate) b06_legacy_threshold_ns_canonical: Option<String>,
        #[returns(copy)]
        pub(crate) custom_app_engagement_duration: f64,
        #[returns(clone)]
        pub(crate) long_data_time_gap_thresholds: Arc<Vec<f64>>,
        #[returns(clone)]
        pub(crate) long_usage_duration_thresholds: Arc<Vec<f64>>,
        #[returns(clone)]
        pub(crate) interaction_types_to_remove: Arc<Vec<String>>,
        #[returns(copy)]
        pub(crate) interaction_type_removal_mode: InteractionTypeRemovalMode,
        #[returns(copy)]
        pub(crate) filter_zero_duration_sessions: bool,
        #[returns(copy)]
        pub(crate) interval_quality_policy: IntervalQualityPolicy,
        /// Internal target selector. It enables cheaper, content-committing
        /// checkpoints for transformations proven to be no-ops in review mode.
        #[returns(copy)]
        pub(crate) review_only: bool,
    }

    #[salsa::input(singleton)]
    pub(crate) struct UsageSupportInput {
        #[returns(copy)]
        pub(crate) use_filter_file: bool,
        #[returns(copy)]
        pub(crate) filter_match_field: FilterMatchField,
        #[returns(clone)]
        pub(crate) application_label_exclusions: Arc<Vec<String>>,
        #[returns(copy)]
        pub(crate) package_exclusion_preset: PackageExclusionPreset,
        #[returns(copy)]
        pub(crate) use_background_apps_file: bool,
        #[returns(copy)]
        pub(crate) use_app_codebook: bool,
        #[returns(copy)]
        pub(crate) use_apps_forcing_screen_open: bool,
        #[returns(copy)]
        pub(crate) screen_auto_lock_timeout_seconds: f64,
        #[returns(copy)]
        pub(crate) screen_auto_lock_tolerance_seconds: f64,
        #[returns(copy)]
        pub(crate) screen_manual_lock_max_tail_seconds: f64,
        #[returns(copy)]
        pub(crate) screen_keyguard_near_stop_seconds: f64,
        #[returns(clone)]
        pub(crate) filter_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) background_apps_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) codebook_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) apps_forcing_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) input_capability_evidence_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) verified_request_options_digest: Option<String>,
        #[returns(clone)]
        pub(crate) verified_evidence_artifact_digest: Option<String>,
        #[returns(clone)]
        pub(crate) verified_evidence_assignment_digest: Option<String>,
        #[returns(clone)]
        pub(crate) fragmented_participant_ids: Arc<Vec<String>>,
    }

    #[salsa::input(singleton)]
    pub(crate) struct LateConfigInput {
        #[returns(copy)]
        pub(crate) enable_screen_gated_crediting: bool,
        #[returns(copy)]
        pub(crate) credited_session_cap_minutes: f64,
        #[returns(copy)]
        pub(crate) device_liveness_gap_tolerance_minutes: f64,
        #[returns(copy)]
        pub(crate) auto_lock_bridge_seconds: f64,
        #[returns(copy)]
        pub(crate) no_witness_min_day_apps: u32,
        #[returns(copy)]
        pub(crate) screen_gating_rule: ScreenGatingRule,
        // B08. The proxy channel is derived after reconstruction, so the rule
        // belongs with the other late options: changing it can never invalidate
        // an app episode, only the side-by-side contact output.
        #[returns(copy)]
        pub(crate) notification_proxy_rule: NotificationProxyRule,
        // B09. Same reasoning: emulation resamples the reconstructed timeline,
        // so none of these three can invalidate an app episode.
        #[returns(copy)]
        pub(crate) polled_emulation_method: PolledEmulationMethod,
        #[returns(copy)]
        pub(crate) polled_emulation_interval_seconds: f64,
        #[returns(copy)]
        pub(crate) polled_emulation_gap_seconds: f64,
        #[returns(copy)]
        pub(crate) interval_expansion_method: IntervalExpansionMethod,
        #[returns(copy)]
        pub(crate) enable_study_window_filter: bool,
        #[returns(copy)]
        pub(crate) enable_person_attribution: bool,
        #[returns(copy)]
        pub(crate) day_boundary_attribution: DayBoundaryAttribution,
        #[returns(copy)]
        pub(crate) add_no_activity_placeholder_days: bool,
        #[returns(copy)]
        pub(crate) enable_day_coverage: bool,
        #[returns(copy)]
        pub(crate) enable_compliance_scoring: bool,
        #[returns(copy)]
        pub(crate) compliance_threshold_percent: f64,
    }

    #[salsa::input(singleton)]
    pub(crate) struct LateSupportInput {
        #[returns(clone)]
        pub(crate) study_dates_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) device_sharing_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) survey_attribution_csv: Arc<Vec<u8>>,
        #[returns(clone)]
        pub(crate) enrolled_devices_csv: Arc<Vec<u8>>,
    }

    #[salsa::input(singleton)]
    pub(crate) struct OutputConfigInput {
        #[returns(clone)]
        pub(crate) study_name: String,
        #[returns(copy)]
        pub(crate) include_app_output: bool,
        #[returns(copy)]
        pub(crate) include_screen_output: bool,
        #[returns(copy)]
        pub(crate) include_category_column: bool,
        #[returns(copy)]
        pub(crate) include_app_usage_end_reason: bool,
        /// Read only by `assemble_result_manifest`, after every CSV is final.
        #[returns(copy)]
        pub(crate) neutralize_spreadsheet_formulas: bool,
        #[returns(copy)]
        pub(crate) enable_aggregates: bool,
        #[returns(clone)]
        pub(crate) aggregate_shape: String,
        #[returns(copy)]
        pub(crate) aggregate_top_apps_limit: u32,
        #[returns(copy)]
        pub(crate) enable_participant_amount_summary: bool,
        /// View materialization stays isolated to the output query.
        #[returns(copy)]
        pub(crate) materialize_visualization_data: bool,
        /// Execution concern, not a researcher option. Review queries use the
        /// same registered product computations but defer large serialized outputs.
        #[returns(copy)]
        pub(crate) materialize_full_outputs: bool,
    }

    #[derive(Clone, Copy)]
    pub(crate) struct TrackedInputs {
        pub(crate) raw: EarlyRawInput,
        pub(crate) early: EarlyConfigInput,
        pub(crate) usage: UsageConfigInput,
        pub(crate) usage_support: UsageSupportInput,
        pub(crate) late: LateConfigInput,
        pub(crate) late_support: LateSupportInput,
        pub(crate) output: OutputConfigInput,
    }

    impl TrackedInputs {
        // These arguments are the concrete Rust execution boundary. Wrapping
        // them in a one-use parameter object would only hide required inputs.
        #[allow(clippy::too_many_arguments)]
        pub(crate) fn new(
            db: &EarlyDatabase,
            csv_bytes: super::super::RawCsvBytes<'_>,
            input_sha256: String,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Self {
            Self::new_owned(
                db,
                csv_bytes.to_shared(),
                input_sha256,
                Arc::new(review_base_bytes.to_vec()),
                Arc::new(reconstruction_base_bytes.to_vec()),
                options,
                support,
                materialize_full_outputs,
            )
        }

        #[allow(clippy::too_many_arguments)]
        pub(crate) fn new_owned(
            db: &EarlyDatabase,
            csv_bytes: Arc<Vec<u8>>,
            input_sha256: String,
            review_base_bytes: Arc<Vec<u8>>,
            reconstruction_base_bytes: Arc<Vec<u8>>,
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
        ) -> Self {
            Self {
                raw: EarlyRawInput::new(
                    db,
                    csv_bytes,
                    input_sha256,
                    review_base_bytes,
                    reconstruction_base_bytes,
                ),
                early: EarlyConfigInput::new(
                    db,
                    Arc::new(options.interaction_type_remap.clone()),
                    options.timezone.clone(),
                    options.timezone_handling.clone(),
                    options.datetime_of_preprocessing.clone(),
                    options.deduplicate_exact_rows,
                    options.drop_out_of_source_order_events,
                    options.correct_duplicate_event_timestamps,
                    Arc::new(options.same_app_stop_types.clone()),
                    Arc::new(options.other_stop_types.clone()),
                ),
                usage: UsageConfigInput::new(
                    db,
                    options.usage_session_mode,
                    options.screen_session_construction_strategy,
                    options.screen_session_construction_strategy_explicit,
                    options.screen_session_classification_policy,
                    options.screen_session_maximum_duration_minutes,
                    options.screen_session_maximum_duration_disposition,
                    options.locked_screen_audio_disposition,
                    options.model_concurrent_usage,
                    options.episode_reconstruction_strategy,
                    options.opener_set,
                    options.session_grouping_policy,
                    options.session_gap_basis,
                    options.session_boundary_scope,
                    options.emit_session_break_lineage,
                    options.event_retention_set,
                    options.allow_stop_event_reuse,
                    options.use_activity_stopped_as_fallback,
                    options.apply_threshold_to_fallback,
                    options.long_duration_threshold_ns,
                    options.proximity_interval_ns,
                    options.micro_use_classification_policy,
                    options.micro_use_classification_policy_explicit,
                    options.minimum_usage_duration,
                    options.minimum_usage_duration_explicit,
                    options.minimum_duration_comparator,
                    options.minimum_duration_comparator_explicit,
                    options.minimum_duration_disposition,
                    options.minimum_duration_disposition_explicit,
                    options.apply_minimum_usage_duration_to_concurrent_subintervals,
                    options.maximum_duration.policy.clone(),
                    options.maximum_duration.disposition.clone(),
                    options.maximum_duration.threshold_source.clone(),
                    options.maximum_duration.threshold_ns.clone(),
                    options.maximum_duration.long_duration_threshold_explicit,
                    options
                        .maximum_duration
                        .legacy_threshold_hours_canonical
                        .clone(),
                    options
                        .maximum_duration
                        .legacy_threshold_ns_canonical
                        .clone(),
                    options.custom_app_engagement_duration,
                    Arc::new(options.long_data_time_gap_thresholds.clone()),
                    Arc::new(options.long_usage_duration_thresholds.clone()),
                    Arc::new(options.interaction_types_to_remove.clone()),
                    options.interaction_type_removal_mode,
                    options.filter_zero_duration_sessions,
                    options.interval_quality_policy,
                    !materialize_full_outputs,
                ),
                usage_support: UsageSupportInput::new(
                    db,
                    options.use_filter_file,
                    options.filter_match_field,
                    Arc::new(options.application_label_exclusions.clone()),
                    options.package_exclusion_preset,
                    options.use_background_apps_file,
                    options.use_app_codebook,
                    options.use_apps_forcing_screen_open,
                    options.screen_auto_lock_timeout_seconds,
                    options.screen_auto_lock_tolerance_seconds,
                    options.screen_manual_lock_max_tail_seconds,
                    options.screen_keyguard_near_stop_seconds,
                    Arc::new(support.filter_csv.to_vec()),
                    Arc::new(support.background_apps_csv.to_vec()),
                    Arc::new(support.codebook_csv.to_vec()),
                    Arc::new(support.apps_forcing_csv.to_vec()),
                    Arc::new(support.input_capability_evidence_csv.to_vec()),
                    support.verified_request_options_digest.map(str::to_owned),
                    support
                        .verified_input_capability_evidence_artifact_digest
                        .map(str::to_owned),
                    support
                        .verified_input_capability_evidence_assignment_digest
                        .map(str::to_owned),
                    Arc::new(
                        support
                            .fragmented_participant_ids
                            .iter()
                            .cloned()
                            .collect::<BTreeSet<_>>()
                            .into_iter()
                            .collect(),
                    ),
                ),
                late: LateConfigInput::new(
                    db,
                    options.enable_screen_gated_crediting,
                    options.credited_session_cap_minutes,
                    options.device_liveness_gap_tolerance_minutes,
                    options.auto_lock_bridge_seconds,
                    options.no_witness_min_day_apps,
                    options.screen_gating_rule,
                    options.notification_proxy_rule,
                    options.polled_emulation_method,
                    options.polled_emulation_interval_seconds,
                    options.polled_emulation_gap_seconds,
                    options.interval_expansion_method,
                    options.enable_study_window_filter,
                    options.enable_person_attribution,
                    options.day_boundary_attribution,
                    options.add_no_activity_placeholder_days,
                    options.enable_day_coverage,
                    options.enable_compliance_scoring,
                    options.compliance_threshold_percent,
                ),
                late_support: LateSupportInput::new(
                    db,
                    Arc::new(support.study_dates_csv.to_vec()),
                    Arc::new(support.device_sharing_csv.to_vec()),
                    Arc::new(support.survey_attribution_csv.to_vec()),
                    Arc::new(support.enrolled_devices_csv.to_vec()),
                ),
                output: OutputConfigInput::new(
                    db,
                    options.study_name.clone(),
                    options.include_app_output,
                    options.include_screen_output,
                    options.include_category_column,
                    options.include_app_usage_end_reason,
                    options.neutralize_spreadsheet_formulas,
                    options.enable_aggregates,
                    options.aggregate_shape.clone(),
                    options.aggregate_top_apps_limit,
                    options.enable_participant_amount_summary,
                    options.materialize_visualization_data,
                    materialize_full_outputs,
                ),
            }
        }

        #[allow(clippy::too_many_arguments)]
        pub(crate) fn update(
            self,
            db: &mut EarlyDatabase,
            csv_bytes: super::super::RawCsvBytes<'_>,
            input_sha256: &str,
            review_base_bytes: &[u8],
            reconstruction_base_bytes: &[u8],
            options: &PipelineV2Options,
            support: PipelineV2SupportFiles<'_>,
            materialize_full_outputs: bool,
            preserve_verified_input: bool,
        ) {
            macro_rules! set_if_changed {
                ($input:expr, $getter:ident, $setter:ident, $value:expr) => {{
                    let value = $value;
                    if $input.$getter(db) != value {
                        $input.$setter(db).to(value);
                    }
                }};
            }
            macro_rules! set_arc_vec_if_changed {
                ($input:expr, $getter:ident, $setter:ident, $slice:expr, $owned:expr) => {{
                    let current = $input.$getter(db);
                    if current.as_slice() != $slice {
                        $input.$setter(db).to(Arc::new($owned));
                    }
                }};
            }
            if !preserve_verified_input {
                if self.raw.bytes(db).as_slice() != csv_bytes.as_slice() {
                    self.raw.set_bytes(db).to(csv_bytes.to_shared());
                }
                set_if_changed!(
                    self.raw,
                    input_sha256,
                    set_input_sha256,
                    input_sha256.to_string()
                );
                set_arc_vec_if_changed!(
                    self.raw,
                    review_base_bytes,
                    set_review_base_bytes,
                    review_base_bytes,
                    review_base_bytes.to_vec()
                );
                set_arc_vec_if_changed!(
                    self.raw,
                    reconstruction_base_bytes,
                    set_reconstruction_base_bytes,
                    reconstruction_base_bytes,
                    reconstruction_base_bytes.to_vec()
                );
            }
            set_arc_vec_if_changed!(
                self.early,
                interaction_type_remap,
                set_interaction_type_remap,
                options.interaction_type_remap.as_slice(),
                options.interaction_type_remap.clone()
            );
            set_if_changed!(self.early, timezone, set_timezone, options.timezone.clone());
            set_if_changed!(
                self.early,
                timezone_handling,
                set_timezone_handling,
                options.timezone_handling.clone()
            );
            set_if_changed!(
                self.early,
                datetime_of_preprocessing,
                set_datetime_of_preprocessing,
                options.datetime_of_preprocessing.clone()
            );
            set_if_changed!(
                self.early,
                deduplicate_exact_rows,
                set_deduplicate_exact_rows,
                options.deduplicate_exact_rows
            );
            set_if_changed!(
                self.early,
                drop_out_of_source_order_events,
                set_drop_out_of_source_order_events,
                options.drop_out_of_source_order_events
            );
            set_if_changed!(
                self.early,
                correct_duplicate_event_timestamps,
                set_correct_duplicate_event_timestamps,
                options.correct_duplicate_event_timestamps
            );
            set_arc_vec_if_changed!(
                self.early,
                same_app_stop_types,
                set_same_app_stop_types,
                options.same_app_stop_types.as_slice(),
                options.same_app_stop_types.clone()
            );
            set_arc_vec_if_changed!(
                self.early,
                other_stop_types,
                set_other_stop_types,
                options.other_stop_types.as_slice(),
                options.other_stop_types.clone()
            );

            set_if_changed!(
                self.usage,
                usage_session_mode,
                set_usage_session_mode,
                options.usage_session_mode
            );
            set_if_changed!(
                self.usage,
                screen_session_construction_strategy,
                set_screen_session_construction_strategy,
                options.screen_session_construction_strategy
            );
            set_if_changed!(
                self.usage,
                screen_session_construction_strategy_explicit,
                set_screen_session_construction_strategy_explicit,
                options.screen_session_construction_strategy_explicit
            );
            set_if_changed!(
                self.usage,
                screen_session_classification_policy,
                set_screen_session_classification_policy,
                options.screen_session_classification_policy
            );
            set_if_changed!(
                self.usage,
                screen_session_maximum_duration_minutes,
                set_screen_session_maximum_duration_minutes,
                options.screen_session_maximum_duration_minutes
            );
            set_if_changed!(
                self.usage,
                screen_session_maximum_duration_disposition,
                set_screen_session_maximum_duration_disposition,
                options.screen_session_maximum_duration_disposition
            );
            set_if_changed!(
                self.usage,
                locked_screen_audio_disposition,
                set_locked_screen_audio_disposition,
                options.locked_screen_audio_disposition
            );
            set_if_changed!(
                self.usage_support,
                use_filter_file,
                set_use_filter_file,
                options.use_filter_file
            );
            set_if_changed!(
                self.usage_support,
                filter_match_field,
                set_filter_match_field,
                options.filter_match_field
            );
            set_if_changed!(
                self.usage_support,
                application_label_exclusions,
                set_application_label_exclusions,
                Arc::new(options.application_label_exclusions.clone())
            );
            set_if_changed!(
                self.usage_support,
                package_exclusion_preset,
                set_package_exclusion_preset,
                options.package_exclusion_preset
            );
            set_if_changed!(
                self.usage_support,
                use_background_apps_file,
                set_use_background_apps_file,
                options.use_background_apps_file
            );
            set_if_changed!(
                self.usage,
                model_concurrent_usage,
                set_model_concurrent_usage,
                options.model_concurrent_usage
            );
            set_if_changed!(
                self.usage,
                episode_reconstruction_strategy,
                set_episode_reconstruction_strategy,
                options.episode_reconstruction_strategy
            );
            set_if_changed!(self.usage, opener_set, set_opener_set, options.opener_set);
            set_if_changed!(
                self.usage,
                session_grouping_policy,
                set_session_grouping_policy,
                options.session_grouping_policy
            );
            set_if_changed!(
                self.usage,
                session_gap_basis,
                set_session_gap_basis,
                options.session_gap_basis
            );
            set_if_changed!(
                self.usage,
                session_boundary_scope,
                set_session_boundary_scope,
                options.session_boundary_scope
            );
            set_if_changed!(
                self.usage,
                emit_session_break_lineage,
                set_emit_session_break_lineage,
                options.emit_session_break_lineage
            );
            set_if_changed!(
                self.usage,
                event_retention_set,
                set_event_retention_set,
                options.event_retention_set
            );
            set_if_changed!(
                self.usage,
                allow_stop_event_reuse,
                set_allow_stop_event_reuse,
                options.allow_stop_event_reuse
            );
            set_if_changed!(
                self.usage,
                use_activity_stopped_as_fallback,
                set_use_activity_stopped_as_fallback,
                options.use_activity_stopped_as_fallback
            );
            set_if_changed!(
                self.usage,
                apply_threshold_to_fallback,
                set_apply_threshold_to_fallback,
                options.apply_threshold_to_fallback
            );
            set_if_changed!(
                self.usage,
                long_duration_threshold_ns,
                set_long_duration_threshold_ns,
                options.long_duration_threshold_ns
            );
            set_if_changed!(
                self.usage,
                proximity_interval_ns,
                set_proximity_interval_ns,
                options.proximity_interval_ns
            );
            set_if_changed!(
                self.usage,
                micro_use_classification_policy,
                set_micro_use_classification_policy,
                options.micro_use_classification_policy
            );
            set_if_changed!(
                self.usage,
                micro_use_classification_policy_explicit,
                set_micro_use_classification_policy_explicit,
                options.micro_use_classification_policy_explicit
            );
            set_if_changed!(
                self.usage,
                minimum_usage_duration,
                set_minimum_usage_duration,
                options.minimum_usage_duration
            );
            set_if_changed!(
                self.usage,
                minimum_usage_duration_explicit,
                set_minimum_usage_duration_explicit,
                options.minimum_usage_duration_explicit
            );
            set_if_changed!(
                self.usage,
                minimum_duration_comparator,
                set_minimum_duration_comparator,
                options.minimum_duration_comparator
            );
            set_if_changed!(
                self.usage,
                minimum_duration_comparator_explicit,
                set_minimum_duration_comparator_explicit,
                options.minimum_duration_comparator_explicit
            );
            set_if_changed!(
                self.usage,
                minimum_duration_disposition,
                set_minimum_duration_disposition,
                options.minimum_duration_disposition
            );
            set_if_changed!(
                self.usage,
                minimum_duration_disposition_explicit,
                set_minimum_duration_disposition_explicit,
                options.minimum_duration_disposition_explicit
            );
            set_if_changed!(
                self.usage,
                apply_minimum_usage_duration_to_concurrent_subintervals,
                set_apply_minimum_usage_duration_to_concurrent_subintervals,
                options.apply_minimum_usage_duration_to_concurrent_subintervals
            );
            set_if_changed!(
                self.usage,
                maximum_duration_policy,
                set_maximum_duration_policy,
                options.maximum_duration.policy.clone()
            );
            set_if_changed!(
                self.usage,
                maximum_duration_disposition,
                set_maximum_duration_disposition,
                options.maximum_duration.disposition.clone()
            );
            set_if_changed!(
                self.usage,
                maximum_duration_threshold_source,
                set_maximum_duration_threshold_source,
                options.maximum_duration.threshold_source.clone()
            );
            set_if_changed!(
                self.usage,
                maximum_duration_threshold_ns,
                set_maximum_duration_threshold_ns,
                options.maximum_duration.threshold_ns.clone()
            );
            set_if_changed!(
                self.usage,
                long_duration_threshold_explicit,
                set_long_duration_threshold_explicit,
                options.maximum_duration.long_duration_threshold_explicit
            );
            set_if_changed!(
                self.usage,
                b06_legacy_threshold_hours_canonical,
                set_b06_legacy_threshold_hours_canonical,
                options
                    .maximum_duration
                    .legacy_threshold_hours_canonical
                    .clone()
            );
            set_if_changed!(
                self.usage,
                b06_legacy_threshold_ns_canonical,
                set_b06_legacy_threshold_ns_canonical,
                options
                    .maximum_duration
                    .legacy_threshold_ns_canonical
                    .clone()
            );
            set_if_changed!(
                self.usage_support,
                use_app_codebook,
                set_use_app_codebook,
                options.use_app_codebook
            );
            set_if_changed!(
                self.usage,
                custom_app_engagement_duration,
                set_custom_app_engagement_duration,
                options.custom_app_engagement_duration
            );
            set_arc_vec_if_changed!(
                self.usage,
                long_data_time_gap_thresholds,
                set_long_data_time_gap_thresholds,
                options.long_data_time_gap_thresholds.as_slice(),
                options.long_data_time_gap_thresholds.clone()
            );
            set_arc_vec_if_changed!(
                self.usage,
                long_usage_duration_thresholds,
                set_long_usage_duration_thresholds,
                options.long_usage_duration_thresholds.as_slice(),
                options.long_usage_duration_thresholds.clone()
            );
            set_if_changed!(
                self.usage_support,
                use_apps_forcing_screen_open,
                set_use_apps_forcing_screen_open,
                options.use_apps_forcing_screen_open
            );
            set_if_changed!(
                self.usage_support,
                screen_auto_lock_timeout_seconds,
                set_screen_auto_lock_timeout_seconds,
                options.screen_auto_lock_timeout_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_auto_lock_tolerance_seconds,
                set_screen_auto_lock_tolerance_seconds,
                options.screen_auto_lock_tolerance_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_manual_lock_max_tail_seconds,
                set_screen_manual_lock_max_tail_seconds,
                options.screen_manual_lock_max_tail_seconds
            );
            set_if_changed!(
                self.usage_support,
                screen_keyguard_near_stop_seconds,
                set_screen_keyguard_near_stop_seconds,
                options.screen_keyguard_near_stop_seconds
            );
            set_arc_vec_if_changed!(
                self.usage,
                interaction_types_to_remove,
                set_interaction_types_to_remove,
                options.interaction_types_to_remove.as_slice(),
                options.interaction_types_to_remove.clone()
            );
            set_if_changed!(
                self.usage,
                interaction_type_removal_mode,
                set_interaction_type_removal_mode,
                options.interaction_type_removal_mode
            );
            set_if_changed!(
                self.usage,
                filter_zero_duration_sessions,
                set_filter_zero_duration_sessions,
                options.filter_zero_duration_sessions
            );
            // Without this a warm option edit keeps running the previous
            // policy: the Salsa input never changes, so nothing downstream is
            // invalidated and the selected policy is silently ignored. The
            // reconstruction seam shipped exactly that defect once.
            set_if_changed!(
                self.usage,
                interval_quality_policy,
                set_interval_quality_policy,
                options.interval_quality_policy
            );
            set_if_changed!(
                self.usage,
                review_only,
                set_review_only,
                !materialize_full_outputs
            );

            set_arc_vec_if_changed!(
                self.usage_support,
                filter_csv,
                set_filter_csv,
                support.filter_csv,
                support.filter_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                background_apps_csv,
                set_background_apps_csv,
                support.background_apps_csv,
                support.background_apps_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                codebook_csv,
                set_codebook_csv,
                support.codebook_csv,
                support.codebook_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                apps_forcing_csv,
                set_apps_forcing_csv,
                support.apps_forcing_csv,
                support.apps_forcing_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.usage_support,
                input_capability_evidence_csv,
                set_input_capability_evidence_csv,
                support.input_capability_evidence_csv,
                support.input_capability_evidence_csv.to_vec()
            );
            set_if_changed!(
                self.usage_support,
                verified_request_options_digest,
                set_verified_request_options_digest,
                support.verified_request_options_digest.map(str::to_owned)
            );
            set_if_changed!(
                self.usage_support,
                verified_evidence_artifact_digest,
                set_verified_evidence_artifact_digest,
                support
                    .verified_input_capability_evidence_artifact_digest
                    .map(str::to_owned)
            );
            set_if_changed!(
                self.usage_support,
                verified_evidence_assignment_digest,
                set_verified_evidence_assignment_digest,
                support
                    .verified_input_capability_evidence_assignment_digest
                    .map(str::to_owned)
            );
            let fragmented_participant_ids = support
                .fragmented_participant_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            set_arc_vec_if_changed!(
                self.usage_support,
                fragmented_participant_ids,
                set_fragmented_participant_ids,
                fragmented_participant_ids.as_slice(),
                fragmented_participant_ids
            );

            set_if_changed!(
                self.late,
                enable_screen_gated_crediting,
                set_enable_screen_gated_crediting,
                options.enable_screen_gated_crediting
            );
            set_if_changed!(
                self.late,
                credited_session_cap_minutes,
                set_credited_session_cap_minutes,
                options.credited_session_cap_minutes
            );
            set_if_changed!(
                self.late,
                device_liveness_gap_tolerance_minutes,
                set_device_liveness_gap_tolerance_minutes,
                options.device_liveness_gap_tolerance_minutes
            );
            set_if_changed!(
                self.late,
                auto_lock_bridge_seconds,
                set_auto_lock_bridge_seconds,
                options.auto_lock_bridge_seconds
            );
            set_if_changed!(
                self.late,
                no_witness_min_day_apps,
                set_no_witness_min_day_apps,
                options.no_witness_min_day_apps
            );
            set_if_changed!(
                self.late,
                screen_gating_rule,
                set_screen_gating_rule,
                options.screen_gating_rule
            );
            set_if_changed!(
                self.late,
                notification_proxy_rule,
                set_notification_proxy_rule,
                options.notification_proxy_rule
            );
            set_if_changed!(
                self.late,
                polled_emulation_method,
                set_polled_emulation_method,
                options.polled_emulation_method
            );
            set_if_changed!(
                self.late,
                polled_emulation_interval_seconds,
                set_polled_emulation_interval_seconds,
                options.polled_emulation_interval_seconds
            );
            set_if_changed!(
                self.late,
                polled_emulation_gap_seconds,
                set_polled_emulation_gap_seconds,
                options.polled_emulation_gap_seconds
            );
            set_if_changed!(
                self.late,
                interval_expansion_method,
                set_interval_expansion_method,
                options.interval_expansion_method
            );
            set_if_changed!(
                self.late,
                enable_study_window_filter,
                set_enable_study_window_filter,
                options.enable_study_window_filter
            );
            set_if_changed!(
                self.late,
                enable_person_attribution,
                set_enable_person_attribution,
                options.enable_person_attribution
            );
            set_if_changed!(
                self.late,
                day_boundary_attribution,
                set_day_boundary_attribution,
                options.day_boundary_attribution
            );
            set_if_changed!(
                self.late,
                add_no_activity_placeholder_days,
                set_add_no_activity_placeholder_days,
                options.add_no_activity_placeholder_days
            );
            set_if_changed!(
                self.late,
                enable_day_coverage,
                set_enable_day_coverage,
                options.enable_day_coverage
            );
            set_if_changed!(
                self.late,
                enable_compliance_scoring,
                set_enable_compliance_scoring,
                options.enable_compliance_scoring
            );
            set_if_changed!(
                self.late,
                compliance_threshold_percent,
                set_compliance_threshold_percent,
                options.compliance_threshold_percent
            );
            set_arc_vec_if_changed!(
                self.late_support,
                study_dates_csv,
                set_study_dates_csv,
                support.study_dates_csv,
                support.study_dates_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                device_sharing_csv,
                set_device_sharing_csv,
                support.device_sharing_csv,
                support.device_sharing_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                survey_attribution_csv,
                set_survey_attribution_csv,
                support.survey_attribution_csv,
                support.survey_attribution_csv.to_vec()
            );
            set_arc_vec_if_changed!(
                self.late_support,
                enrolled_devices_csv,
                set_enrolled_devices_csv,
                support.enrolled_devices_csv,
                support.enrolled_devices_csv.to_vec()
            );

            set_if_changed!(
                self.output,
                study_name,
                set_study_name,
                options.study_name.clone()
            );
            set_if_changed!(
                self.output,
                include_app_output,
                set_include_app_output,
                options.include_app_output
            );
            set_if_changed!(
                self.output,
                include_screen_output,
                set_include_screen_output,
                options.include_screen_output
            );
            set_if_changed!(
                self.output,
                include_category_column,
                set_include_category_column,
                options.include_category_column
            );
            set_if_changed!(
                self.output,
                include_app_usage_end_reason,
                set_include_app_usage_end_reason,
                options.include_app_usage_end_reason
            );
            set_if_changed!(
                self.output,
                neutralize_spreadsheet_formulas,
                set_neutralize_spreadsheet_formulas,
                options.neutralize_spreadsheet_formulas
            );
            set_if_changed!(
                self.output,
                enable_aggregates,
                set_enable_aggregates,
                options.enable_aggregates
            );
            set_if_changed!(
                self.output,
                enable_participant_amount_summary,
                set_enable_participant_amount_summary,
                options.enable_participant_amount_summary
            );
            set_if_changed!(
                self.output,
                aggregate_shape,
                set_aggregate_shape,
                options.aggregate_shape.clone()
            );
            set_if_changed!(
                self.output,
                aggregate_top_apps_limit,
                set_aggregate_top_apps_limit,
                options.aggregate_top_apps_limit
            );
            set_if_changed!(
                self.output,
                materialize_visualization_data,
                set_materialize_visualization_data,
                options.materialize_visualization_data
            );
            set_if_changed!(
                self.output,
                materialize_full_outputs,
                set_materialize_full_outputs,
                materialize_full_outputs
            );
        }
    }
