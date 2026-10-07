use super::{REVIEW_BASE_DECODE_CACHE, RECONSTRUCTION_BASE_DECODE_CACHE};
#[cfg(test)]
use super::{REVIEW_BASE_DECODE_COUNT, RECONSTRUCTION_BASE_DECODE_COUNT};
use sha2::Digest;
use std::fmt;
use crate::pipeline_v2::{AppFilterRules, parse_filter_csv};
use super::{
    Arc,
    BTreeMap,
    BTreeSet,
    EarlyConfigInput,
    EarlyRawInput,
    EarlyStepDb,
    EpisodeReconstructionStrategy,
    EventRetentionSet,
    FoundationalEpisodeEvidence,
    FoundationalSemanticsEvidence,
    InlineLineageDigest,
    LockedScreenAudioDisposition,
    MicroUseClassification,
    MicroUseClassificationPolicy,
    MinimumDurationComparator,
    MinimumDurationDisposition,
    OKOSHI_MICRO_USE_THRESHOLD_NS,
    OpenerSetEvidence,
    PayloadHandle,
    PersistedReviewBaseSelection,
    PipelineV2Options,
    PipelineV2SupportFiles,
    QueryTimer,
    Row,
    RowCheckpointScratch,
    ScreenSessionConstructionStrategyId,
    ScreenSessionClassificationPolicy,
    ScreenSessionMaximumDurationDisposition,
    Sha256,
    UsageConfigInput,
    UsageSessionMode,
    UsageSupportInput,
    WorkflowCheckpoint,
    ZeroDurationCleanupEvidence,
    attach_device_models,
    b05,
    b06,
    background_apps,
    build_app_event_index,
    canonicalize_source_rows,
    chronicle_interval_inputs,
    chronicle_orphan_stop_issues,
    classify_episode_durations,
    classify_screen_sessions,
    coalesce_duplicate_event_keys,
    collect_timezone_observations,
    construct_screen_intervals,
    decode_source_records,
    derive_time_gap_evidence,
    disambiguate_duplicate_timestamps,
    estimate_dominant_timezone,
    index_keyguard_events,
    infer_screen_session_skeletons,
    inline_lineage_search_suffix_digests,
    mark_app_policy_matches,
    mask_excluded_app_events,
    match_app_episodes,
    materialize_candidate_episodes,
    minimum_duration_threshold_ns,
    order_source_records,
    parsed_filter_rules,
    query_payload,
    raw_b05_events,
    remove_missing_timestamps,
    required_query_group_checkpoint,
    resolve_excluded_packages,
    resolve_timezone_strategy,
    review_annotations_fused,
    row_checkpoint_parts,
    schoedel_is_active,
    screen_base_input_key,
    segment_concurrent_usage,
    standardize_event_clock,
    summarize_duplicate_groups,
    summarize_row_selection,
    timezone_retained_source_rows_digest,
    timezone_stage_digest,
    validate_remap_rules,
    with_deserialized_row_string_pool,
    with_serialized_row_string_table,
};

    // v15 adds the row-level marker for the separate post-concurrency floor.
    // Review bases serialize Row directly, so even an always-false added field
    // is a wire-shape change and cannot reuse the v14 magic.
    // v17: B06 row fields (maximum_duration_*, effective_endpoint_reason).
    // v18 removes the output-only preprocessing timestamp checkpoint and key.
    // v19 adds interval-wide app-observation evidence to serialized RowData.
    pub(crate) const REVIEW_BASE_PROTOCOL: &str = "chronicle-review-base/v19";

    pub(crate) const REVIEW_BASE_MAGIC: &[u8; 8] = b"CHRRB019";

    pub(crate) const REVIEW_BASE_HEADER_BYTES: usize = REVIEW_BASE_MAGIC.len() + 4 + 32 + 32 + 32;

    // The 100k-row production fixture currently needs about 25 MiB decoded.
    // Four-to-six times that measured size supports much larger individual
    // files without permitting two cache blobs to reserve over a GiB.
    pub(crate) const MAX_REVIEW_BASE_UNCOMPRESSED_BYTES: usize = 128 * 1024 * 1024;

    pub(crate) const MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES: usize = 192 * 1024 * 1024;

    // v23: B06 row fields, binding request, and the optional B06 receipt.
    // v24 carries the v18 early metadata without an output timestamp.
    // v25 adds interval-wide app-observation evidence to serialized RowData.
    pub(crate) const RECONSTRUCTION_BASE_PROTOCOL: &str = "chronicle-reconstruction-base/v25";

    pub(crate) const RECONSTRUCTION_BASE_MAGIC: &[u8; 8] = b"CHRRX025";

    pub(crate) const RECONSTRUCTION_BASE_HEADER_BYTES: usize = RECONSTRUCTION_BASE_MAGIC.len() + 4 + 32 + 32;

    #[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
    pub(crate) struct ReviewBaseMetadata {
        pub(crate) query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
        pub(crate) query_group_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
        /// Exact decoded physical-row count before missing-timestamp removal.
        /// B05 consumes this seam, whereas Chronicle's legacy public
        /// `original_row_count` remains post-removal for byte compatibility.
        pub(crate) decoded_raw_row_count: u32,
        pub(crate) original_row_count: u32,
        pub(crate) processed_row_count: u32,
        pub(crate) rows_before_timezone_handling: u32,
        pub(crate) rows_after_timezone_handling: u32,
        pub(crate) duplicate_timestamps_corrected: u32,
        pub(crate) exact_duplicate_rows_removed: u32,
        pub(crate) available_timezones: Vec<String>,
        pub(crate) timezone: String,
        pub(crate) timezone_action: String,
        pub(crate) timezone_retained_source_rows_digest: String,
        pub(crate) timezone_stage_digest: String,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct ReviewBase {
        pub(crate) protocol_version: String,
        pub(crate) input_key: String,
        pub(crate) rows: Arc<Vec<Row>>,
        /// Present only when app-usage processing was active while the base
        /// was exported. A disabled app pipeline must not speculatively run
        /// `mask_excluded_app_events` merely to prepare a cache for a possible future
        /// configuration.
        pub(crate) matcher_search_suffix_digests: Option<Arc<Vec<InlineLineageDigest>>>,
        pub(crate) metadata: ReviewBaseMetadata,
        pub(crate) screen: Option<ScreenBase>,
        /// Exact post-annotation cleanup evidence from the producing review.
        /// This is independent of the reconstruction base so source-sensitive
        /// Schoedel reviews, which intentionally restore only ReviewBase, do
        /// not lose removed-row identity after the rows themselves are gone.
        #[serde(default)]
        pub(crate) zero_duration_cleanup: Option<ZeroDurationCleanupEvidence>,
        #[serde(default)]
        pub(crate) zero_duration_cleanup_input_key: Option<String>,
    }

    #[derive(Clone)]
    pub(crate) struct DecodedReviewBase {
        pub(crate) encoded_digest: [u8; 32],
        pub(crate) value: Arc<ReviewBase>,
    }

    impl PartialEq for DecodedReviewBase {
        /// `value` is deliberately excluded: it is decoded from exactly the
        /// bytes `encoded_digest` hashes, so equal digests cannot hold
        /// different values short of a digest collision. The exhaustive
        /// destructure makes a new field a compile-time decision instead of a
        /// silent exclusion (the backdating trap this idiom exists for).
        #[deny(unused_variables)]
        fn eq(&self, other: &Self) -> bool {
            let Self {
                encoded_digest,
                value: _,
            } = self;
            *encoded_digest == other.encoded_digest
        }
    }

    impl Eq for DecodedReviewBase {}

    pub(crate) struct ReviewBaseHeader {
        pub(crate) input_key: [u8; 32],
        pub(crate) app_policy_checkpoint: [u8; 32],
    }

    #[derive(Debug)]
    pub(crate) struct VerifiedReviewBaseHeader {
        pub(crate) input_key: [u8; 32],
        pub(crate) app_policy_checkpoint: [u8; 32],
        pub(crate) payload_digest: [u8; 32],
        pub(crate) declared_bytes: usize,
    }

    /// The B06 request exactly as the seven Salsa facts hold it.
    pub(crate) fn maximum_duration_request(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
    ) -> b06::MaximumDurationRequest {
        b06::MaximumDurationRequest {
            policy: config.maximum_duration_policy(db),
            disposition: config.maximum_duration_disposition(db),
            threshold_source: config.maximum_duration_threshold_source(db),
            threshold_ns: config.maximum_duration_threshold_ns(db),
            long_duration_threshold_explicit: config.long_duration_threshold_explicit(db),
            legacy_threshold_hours_canonical: config.b06_legacy_threshold_hours_canonical(db),
            legacy_threshold_ns_canonical: config.b06_legacy_threshold_ns_canonical(db),
        }
    }

    /// The row-affecting B06 stage from the four selection facts only. The
    /// presence marker and legacy companions are receipt identity and are
    /// deliberately not read by the computational queries, so an edit to them
    /// does not recompute rows. Every execution path has already run
    /// `validate_pipeline_v2_options`; a refusal here is the same typed token
    /// surfacing from a query instead of the preflight.
    pub(crate) fn maximum_duration_row_stage(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
    ) -> Result<b06::MaximumDurationRowStage, String> {
        b06::resolve_row_stage(
            config.maximum_duration_policy(db).as_deref(),
            config.maximum_duration_disposition(db).as_deref(),
            config.maximum_duration_threshold_source(db).as_deref(),
            config.maximum_duration_threshold_ns(db).as_deref(),
        )
        .map_err(|reason| format!("pipeline_options_invalid:{}", reason.error_token()))
    }

    /// True when the active B06 stage can remove rows before the annotation
    /// table (generic stage with `drop_row`), which forbids the
    /// membership-preserving static annotation overlay.
    pub(crate) fn maximum_duration_row_stage_drops_rows(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
    ) -> Result<bool, String> {
        let stage = maximum_duration_row_stage(db, config)?;
        Ok(stage.generic_stage_active()
            && stage.disposition == b06::MaximumDurationDisposition::DropRow)
    }

    #[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
    pub(crate) struct FoundationalSemanticsBinding {
        pub(crate) micro_use_classification_policy: MicroUseClassificationPolicy,
        pub(crate) micro_use_classification_policy_explicit: bool,
        pub(crate) minimum_usage_duration_bits: u64,
        pub(crate) minimum_usage_duration_explicit: bool,
        pub(crate) minimum_duration_comparator: MinimumDurationComparator,
        pub(crate) minimum_duration_comparator_explicit: bool,
        pub(crate) minimum_duration_disposition: MinimumDurationDisposition,
        pub(crate) minimum_duration_disposition_explicit: bool,
        pub(crate) episode_reconstruction_strategy: EpisodeReconstructionStrategy,
        pub(crate) apply_minimum_to_concurrent_subintervals: bool,
        /// B06 request and the legacy threshold it was resolved against.
        pub(crate) maximum_duration: b06::MaximumDurationRequest,
        pub(crate) screen_session_classification_policy: ScreenSessionClassificationPolicy,
        pub(crate) screen_session_maximum_duration_bits: u64,
        pub(crate) screen_session_maximum_duration_disposition: ScreenSessionMaximumDurationDisposition,
        pub(crate) locked_screen_audio_disposition: LockedScreenAudioDisposition,
        pub(crate) long_duration_threshold_ns: i64,
    }

    pub(crate) fn foundational_semantics_binding(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
    ) -> FoundationalSemanticsBinding {
        FoundationalSemanticsBinding {
            micro_use_classification_policy: config.micro_use_classification_policy(db),
            micro_use_classification_policy_explicit: config
                .micro_use_classification_policy_explicit(db),
            minimum_usage_duration_bits: config.minimum_usage_duration(db).to_bits(),
            minimum_usage_duration_explicit: config.minimum_usage_duration_explicit(db),
            minimum_duration_comparator: config.minimum_duration_comparator(db),
            minimum_duration_comparator_explicit: config.minimum_duration_comparator_explicit(db),
            minimum_duration_disposition: config.minimum_duration_disposition(db),
            minimum_duration_disposition_explicit: config.minimum_duration_disposition_explicit(db),
            episode_reconstruction_strategy: config.episode_reconstruction_strategy(db),
            apply_minimum_to_concurrent_subintervals: config
                .apply_minimum_usage_duration_to_concurrent_subintervals(db),
            maximum_duration: maximum_duration_request(db, config),
            screen_session_classification_policy: config.screen_session_classification_policy(db),
            screen_session_maximum_duration_bits: config
                .screen_session_maximum_duration_minutes(db)
                .to_bits(),
            screen_session_maximum_duration_disposition: config
                .screen_session_maximum_duration_disposition(db),
            locked_screen_audio_disposition: config.locked_screen_audio_disposition(db),
            long_duration_threshold_ns: config.long_duration_threshold_ns(db),
        }
    }

    pub(crate) fn foundational_semantics_binding_for_options(
        options: &PipelineV2Options,
    ) -> FoundationalSemanticsBinding {
        FoundationalSemanticsBinding {
            micro_use_classification_policy: options.micro_use_classification_policy,
            micro_use_classification_policy_explicit: options
                .micro_use_classification_policy_explicit,
            minimum_usage_duration_bits: options.minimum_usage_duration.to_bits(),
            minimum_usage_duration_explicit: options.minimum_usage_duration_explicit,
            minimum_duration_comparator: options.minimum_duration_comparator,
            minimum_duration_comparator_explicit: options.minimum_duration_comparator_explicit,
            minimum_duration_disposition: options.minimum_duration_disposition,
            minimum_duration_disposition_explicit: options.minimum_duration_disposition_explicit,
            episode_reconstruction_strategy: options.episode_reconstruction_strategy,
            apply_minimum_to_concurrent_subintervals: options
                .apply_minimum_usage_duration_to_concurrent_subintervals,
            maximum_duration: options.maximum_duration.clone(),
            screen_session_classification_policy: options.screen_session_classification_policy,
            screen_session_maximum_duration_bits: options
                .screen_session_maximum_duration_minutes
                .to_bits(),
            screen_session_maximum_duration_disposition: options
                .screen_session_maximum_duration_disposition,
            locked_screen_audio_disposition: options.locked_screen_audio_disposition,
            long_duration_threshold_ns: options.long_duration_threshold_ns,
        }
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct ReconstructionBase {
        pub(crate) protocol_version: String,
        pub(crate) input_key: String,
        pub(crate) rows: Arc<Vec<Row>>,
        /// Canonical immutable episode census at the B03/B04 decision
        /// checkpoint, before DropRow and concurrency can remove or duplicate
        /// episodes. Persisted receipt validation is derived from this table.
        pub(crate) foundational_episode_evidence: Vec<FoundationalEpisodeEvidence>,
        pub(crate) foundational_semantics_binding: FoundationalSemanticsBinding,
        pub(crate) opener_set_evidence: OpenerSetEvidence,
        pub(crate) foundational_semantics_evidence: FoundationalSemanticsEvidence,
        /// B06 receipt recorded under `foundational_semantics_binding.maximum_duration`;
        /// recomputed from the census at decode, never trusted.
        pub(crate) maximum_duration_evidence: Option<b06::MaximumDurationEvidence>,
        pub(crate) eyes_tagged_fau_evidence: Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
        pub(crate) resolve_excluded_packages: WorkflowCheckpoint,
        pub(crate) mask_excluded_app_events: WorkflowCheckpoint,
        pub(crate) build_app_event_index: WorkflowCheckpoint,
        pub(crate) match_app_episodes: WorkflowCheckpoint,
        pub(crate) materialize_candidate_episodes: WorkflowCheckpoint,
        pub(crate) segment_concurrent_usage: WorkflowCheckpoint,
        pub(crate) reconstruct_episodes: WorkflowCheckpoint,
        pub(crate) annotation_checkpoint: ReviewAnnotationCheckpointBase,
        pub(crate) early_metadata: ReviewBaseMetadata,
        pub(crate) screen: Option<ScreenBase>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct ReviewAnnotationCheckpointBase {
        pub(crate) input_key: String,
        pub(crate) rows: PayloadHandle<Vec<Row>>,
        pub(crate) zero_duration_cleanup: ZeroDurationCleanupEvidence,
        pub(crate) join_app_codebook: WorkflowCheckpoint,
        pub(crate) derive_broad_category: WorkflowCheckpoint,
        pub(crate) collapse_app_genre: WorkflowCheckpoint,
        pub(crate) categorize_apps: WorkflowCheckpoint,
        pub(crate) derive_engagement_basis: WorkflowCheckpoint,
        pub(crate) apply_episode_flags: WorkflowCheckpoint,
        pub(crate) episode_annotations: WorkflowCheckpoint,
        pub(crate) suppress_excluded_timing: WorkflowCheckpoint,
        pub(crate) remove_selected_interaction_types: WorkflowCheckpoint,
        pub(crate) remove_zero_duration_rows: WorkflowCheckpoint,
        pub(crate) interval_cleaning: WorkflowCheckpoint,
    }

    /// Disk representation of the two closely related reconstruction row
    /// tables. Annotation never adds or reorders rows and never changes row
    /// identity; it can only retain a row unchanged, replace its non-identity
    /// fields, or remove it. Keeping the corresponding state beside the source
    /// row lets LZ4 see shared bytes inside its 64 KiB window and avoids
    /// deserializing a second Row when the exact Arc can be reused.
    #[derive(serde::Serialize, serde::Deserialize)]
    pub(crate) struct PersistedReconstructionRow {
        pub(crate) reconstruction: Row,
        pub(crate) annotation: PersistedAnnotationRow,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    pub(crate) enum PersistedAnnotationRow {
        Reuse,
        Replace(Row),
        Drop,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    pub(crate) struct PersistedReviewAnnotationCheckpointBase {
        pub(crate) input_key: String,
        pub(crate) zero_duration_cleanup: ZeroDurationCleanupEvidence,
        pub(crate) join_app_codebook: WorkflowCheckpoint,
        pub(crate) derive_broad_category: WorkflowCheckpoint,
        pub(crate) collapse_app_genre: WorkflowCheckpoint,
        pub(crate) categorize_apps: WorkflowCheckpoint,
        pub(crate) derive_engagement_basis: WorkflowCheckpoint,
        pub(crate) apply_episode_flags: WorkflowCheckpoint,
        pub(crate) episode_annotations: WorkflowCheckpoint,
        pub(crate) suppress_excluded_timing: WorkflowCheckpoint,
        pub(crate) remove_selected_interaction_types: WorkflowCheckpoint,
        pub(crate) remove_zero_duration_rows: WorkflowCheckpoint,
        pub(crate) interval_cleaning: WorkflowCheckpoint,
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    pub(crate) struct PersistedReconstructionBase {
        pub(crate) protocol_version: String,
        pub(crate) input_key: String,
        pub(crate) row_states: Vec<PersistedReconstructionRow>,
        pub(crate) foundational_episode_evidence: Vec<FoundationalEpisodeEvidence>,
        pub(crate) foundational_semantics_binding: FoundationalSemanticsBinding,
        pub(crate) opener_set_evidence: OpenerSetEvidence,
        pub(crate) foundational_semantics_evidence: FoundationalSemanticsEvidence,
        /// B06 receipt recorded under `foundational_semantics_binding.maximum_duration`;
        /// recomputed from the census at decode, never trusted.
        pub(crate) maximum_duration_evidence: Option<b06::MaximumDurationEvidence>,
        pub(crate) eyes_tagged_fau_evidence: Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
        pub(crate) resolve_excluded_packages: WorkflowCheckpoint,
        pub(crate) mask_excluded_app_events: WorkflowCheckpoint,
        pub(crate) build_app_event_index: WorkflowCheckpoint,
        pub(crate) match_app_episodes: WorkflowCheckpoint,
        pub(crate) materialize_candidate_episodes: WorkflowCheckpoint,
        pub(crate) segment_concurrent_usage: WorkflowCheckpoint,
        pub(crate) reconstruct_episodes: WorkflowCheckpoint,
        pub(crate) annotation_checkpoint: PersistedReviewAnnotationCheckpointBase,
        pub(crate) early_metadata: ReviewBaseMetadata,
        pub(crate) screen: Option<ScreenBase>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct ScreenBase {
        pub(crate) input_key: String,
        pub(crate) rows: Arc<Vec<Row>>,
        /// Request-neutral canonical B05 evidence. Exact JCS provenance and
        /// omitted-vs-explicit relation are rebound when a result is assembled.
        pub(crate) screen_construction: b05::ScreenConstructionOutput,
        pub(crate) construct_screen_intervals: WorkflowCheckpoint,
        pub(crate) index_keyguard_events: WorkflowCheckpoint,
        pub(crate) infer_screen_session_skeletons: WorkflowCheckpoint,
        pub(crate) classify_screen_sessions: WorkflowCheckpoint,
        pub(crate) device_state_timeline: WorkflowCheckpoint,
    }

    pub(crate) fn validate_screen_base(
        screen: &ScreenBase,
        expected_input_digest: &str,
        expected_input_row_count: u64,
    ) -> Result<(), String> {
        b05::validate_screen_construction_output(
            &screen.screen_construction,
            expected_input_digest,
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
            expected_input_row_count,
        )
        .map_err(str::to_owned)?;
        if screen.rows.len() != screen.screen_construction.intervals.len() {
            return Err("b05_screen_validation_error:screen_row_interval_count_mismatch".into());
        }
        for (row, interval) in screen
            .rows
            .iter()
            .zip(&screen.screen_construction.intervals)
        {
            let expected_sources = interval
                .start_source_rows
                .iter()
                .chain(&interval.stop_source_rows)
                .copied()
                .collect::<BTreeSet<_>>();
            let row_sources = row.source_data_rows.iter().collect::<BTreeSet<_>>();
            if row.participant_id.as_str() != interval.participant_id
                || row.start_timestamp_ns != Some(interval.start_ns)
                || row.stop_timestamp_ns != interval.stop_ns
                || !expected_sources.is_subset(&row_sources)
            {
                return Err("b05_screen_validation_error:screen_row_boundary_mismatch".into());
            }
        }
        Ok(())
    }

    #[derive(Clone)]
    pub(crate) struct DecodedReconstructionBase {
        pub(crate) encoded_digest: [u8; 32],
        pub(crate) value: Arc<ReconstructionBase>,
    }

    pub(crate) struct CachedDecodedReconstructionBase {
        store: crate::payload_store::PayloadStore,
        pub(crate) payload_digest: [u8; 32],
        /// The exact verified encoded bytes, retained so a byte-equal request
        /// can be proven identical by memcmp instead of re-hashing.
        pub(crate) encoded_bytes: Arc<Vec<u8>>,
        pub(crate) value: Arc<ReconstructionBase>,
    }

    pub(crate) struct CachedDecodedReviewBase {
        pub(crate) payload_digest: [u8; 32],
        /// The exact verified encoded bytes, retained so a byte-equal request
        /// can be proven identical by memcmp instead of re-hashing.
        pub(crate) encoded_bytes: Arc<Vec<u8>>,
        pub(crate) value: Arc<ReviewBase>,
    }







    impl PartialEq for DecodedReconstructionBase {
        /// Same covering argument as `DecodedReviewBase`: `value` is a pure
        /// function of the bytes `encoded_digest` commits.
        #[deny(unused_variables)]
        fn eq(&self, other: &Self) -> bool {
            let Self {
                encoded_digest,
                value: _,
            } = self;
            *encoded_digest == other.encoded_digest
        }
    }

    impl Eq for DecodedReconstructionBase {}

    impl fmt::Debug for DecodedReconstructionBase {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("DecodedReconstructionBase")
                .field("encoded_digest", &hex::encode(self.encoded_digest))
                .field("input_key", &self.value.input_key)
                .field("rows", &self.value.rows.len())
                .finish()
        }
    }

    impl fmt::Debug for DecodedReviewBase {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("DecodedReviewBase")
                .field("encoded_digest", &hex::encode(self.encoded_digest))
                .field("input_key", &self.value.input_key)
                .field("rows", &self.value.rows.len())
                .finish()
        }
    }

    #[derive(serde::Serialize)]
    pub(crate) struct ReviewBaseInputKey<'a> {
        pub(crate) protocol_version: &'static str,
        pub(crate) raw_digest: String,
        pub(crate) interaction_type_remap: &'a [String],
        pub(crate) same_app_stop_types: &'a [String],
        pub(crate) other_stop_types: &'a [String],
        pub(crate) timezone: String,
        pub(crate) timezone_handling: String,
        pub(crate) deduplicate_exact_rows: bool,
        pub(crate) drop_out_of_source_order_events: bool,
        pub(crate) correct_duplicate_event_timestamps: bool,
        pub(crate) use_filter_file: bool,
        pub(crate) filter_match_field: &'static str,
        pub(crate) application_label_exclusions: BTreeSet<String>,
        /// The excluded set is built from the filter file AND this preset, so a
        /// base recorded under one preset describes a different excluded set
        /// than a run under another and must not be reused for it.
        pub(crate) package_exclusion_preset: &'static str,
        pub(crate) filter_digest: String,
    }

    #[derive(serde::Serialize)]
    pub(crate) struct ReconstructionBaseInputKey<'a> {
        pub(crate) protocol_version: &'static str,
        pub(crate) app_policy_checkpoint: &'a str,
        pub(crate) application_label_exclusions: BTreeSet<String>,
        pub(crate) same_app_stop_types: &'a [String],
        pub(crate) other_stop_types: &'a [String],
        pub(crate) background_apps: BTreeSet<String>,
        pub(crate) model_concurrent_usage: bool,
        // The restore path returns the persisted rows and the persisted
        // match_app_episodes checkpoint without ever calling the matcher, so
        // every option that selects or tunes a reconstruction rule has to be in
        // this key. Omitting the strategy served one rule's rows under another
        // rule's receipt.
        pub(crate) episode_reconstruction_strategy: &'static str,
        pub(crate) opener_set: &'static str,
        // Retention runs upstream of the matcher, so the persisted rows are
        // rows reconstructed from an already-narrowed event stream. Without
        // this field a base built under one retention set is served for a run
        // configured with another, which is the same defect the strategy field
        // above was added to fix.
        pub(crate) event_retention_set: &'static str,
        pub(crate) allow_stop_event_reuse: bool,
        pub(crate) use_activity_stopped_as_fallback: bool,
        pub(crate) apply_threshold_to_fallback: bool,
        pub(crate) long_duration_threshold_ns: i64,
        pub(crate) proximity_interval_ns: i64,
        pub(crate) micro_use_classification_policy: &'static str,
        pub(crate) micro_use_classification_policy_explicit: bool,
        // The persisted foundational-semantics receipt is threshold-specific
        // even when concurrency later rebuilds identical public rows.
        pub(crate) minimum_usage_duration_bits: u64,
        pub(crate) minimum_usage_duration_explicit: bool,
        pub(crate) minimum_duration_comparator: &'static str,
        pub(crate) minimum_duration_comparator_explicit: bool,
        pub(crate) minimum_duration_disposition: &'static str,
        pub(crate) minimum_duration_disposition_explicit: bool,
        pub(crate) apply_minimum_to_concurrent_subintervals: bool,
        // The persisted rows and receipt are B06-specific: a base recorded
        // under one maximum-duration request is never reused under another.
        pub(crate) maximum_duration: b06::MaximumDurationRequest,
        pub(crate) screen_session_classification_policy: &'static str,
        pub(crate) screen_session_maximum_duration_bits: u64,
        pub(crate) screen_session_maximum_duration_disposition: &'static str,
        pub(crate) locked_screen_audio_disposition: &'static str,
    }

    #[derive(serde::Serialize)]
    pub(crate) struct ReviewAnnotationCheckpointInputKey {
        pub(crate) protocol_version: &'static str,
        pub(crate) use_app_codebook: bool,
        pub(crate) codebook_digest: String,
        pub(crate) custom_app_engagement_duration_bits: u64,
        pub(crate) long_data_time_gap_threshold_bits: Vec<u64>,
        pub(crate) long_usage_duration_threshold_bits: Vec<u64>,
        pub(crate) interaction_types_to_remove: Vec<String>,
        pub(crate) interaction_type_removal_mode: &'static str,
        pub(crate) filter_zero_duration_sessions: bool,
        // The annotation checkpoint base persists the annotated rows and every
        // interval_cleaning checkpoint derived from them, and the restore path
        // serves them without re-running the step. A policy that rewrites those
        // rows therefore has to be in this key.
        pub(crate) interval_quality_policy: &'static str,
    }

    #[derive(serde::Serialize)]
    pub(crate) struct ScreenBaseInputKey<'a> {
        pub(crate) protocol_version: &'static str,
        pub(crate) canonical_screen_rows_checkpoint: &'a str,
        // `classify_screen_sessions` reads the timezone request field
        // directly (day-boundary math), not only through the canonical rows,
        // so the rows checkpoint alone cannot express a timezone change on a
        // degenerate file whose rows render identically in both zones.
        pub(crate) timezone: String,
        pub(crate) use_apps_forcing_screen_open: bool,
        pub(crate) apps_forcing_digest: String,
        pub(crate) screen_auto_lock_timeout_bits: u64,
        pub(crate) screen_auto_lock_tolerance_bits: u64,
        pub(crate) screen_manual_lock_max_tail_bits: u64,
        pub(crate) screen_keyguard_near_stop_bits: u64,
        pub(crate) screen_session_classification_policy: &'static str,
        pub(crate) screen_session_maximum_duration_bits: u64,
        pub(crate) screen_session_maximum_duration_disposition: &'static str,
        pub(crate) locked_screen_audio_disposition: &'static str,
    }

    pub(crate) fn digest_bytes(bytes: &[u8]) -> String {
        format!("blake3:{}", blake3::hash(bytes).to_hex())
    }

    pub(crate) fn sha256_bytes(bytes: &[u8]) -> String {
        format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
    }

    pub(crate) fn review_base_input_key(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let filter_csv = support.filter_csv(db);
        let interaction_type_remap = early.interaction_type_remap(db);
        let same_app_stop_types = early.same_app_stop_types(db);
        let other_stop_types = early.other_stop_types(db);
        let material = ReviewBaseInputKey {
            protocol_version: REVIEW_BASE_PROTOCOL,
            raw_digest: raw.input_sha256(db),
            interaction_type_remap: interaction_type_remap.as_slice(),
            same_app_stop_types: same_app_stop_types.as_slice(),
            other_stop_types: other_stop_types.as_slice(),
            timezone: early.timezone(db),
            timezone_handling: early.timezone_handling(db),
            deduplicate_exact_rows: early.deduplicate_exact_rows(db),
            drop_out_of_source_order_events: early.drop_out_of_source_order_events(db),
            correct_duplicate_event_timestamps: early.correct_duplicate_event_timestamps(db),
            use_filter_file: support.use_filter_file(db),
            filter_match_field: support.filter_match_field(db).canonical_id(),
            application_label_exclusions: parsed_filter_rules(db, support)
                .application_labels.iter().cloned().collect(),
            package_exclusion_preset: support.package_exclusion_preset(db).canonical_id(),
            filter_digest: digest_bytes(&filter_csv),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    pub(crate) fn review_base_input_key_for_options(
        input_sha256: &str,
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<String, String> {
        let material = ReviewBaseInputKey {
            protocol_version: REVIEW_BASE_PROTOCOL,
            raw_digest: input_sha256.to_string(),
            interaction_type_remap: &options.interaction_type_remap,
            same_app_stop_types: &options.same_app_stop_types,
            other_stop_types: &options.other_stop_types,
            timezone: options.timezone.clone(),
            timezone_handling: options.timezone_handling.clone(),
            deduplicate_exact_rows: options.deduplicate_exact_rows,
            drop_out_of_source_order_events: options.drop_out_of_source_order_events,
            correct_duplicate_event_timestamps: options.correct_duplicate_event_timestamps,
            use_filter_file: options.use_filter_file,
            filter_match_field: options.filter_match_field.canonical_id(),
            application_label_exclusions: effective_application_label_exclusions_for_options(options, support),
            package_exclusion_preset: options.package_exclusion_preset.canonical_id(),
            filter_digest: digest_bytes(support.filter_csv),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    pub(crate) fn reconstruction_base_input_key(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let app_policy_checkpoint =
            review_base_app_policy_checkpoint(db, raw, early, config, support)?;
        let background_apps = background_apps(db, config, support)
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let apply_minimum_to_subintervals =
            config.apply_minimum_usage_duration_to_concurrent_subintervals(db);
        let same_app_stop_types = early.same_app_stop_types(db);
        let other_stop_types = early.other_stop_types(db);
        let material = ReconstructionBaseInputKey {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL,
            app_policy_checkpoint: &app_policy_checkpoint,
            application_label_exclusions: parsed_filter_rules(db, support)
                .application_labels.iter().cloned().collect(),
            same_app_stop_types: same_app_stop_types.as_slice(),
            other_stop_types: other_stop_types.as_slice(),
            background_apps,
            model_concurrent_usage: config.model_concurrent_usage(db),
            episode_reconstruction_strategy: config
                .episode_reconstruction_strategy(db)
                .canonical_id(),
            opener_set: config.opener_set(db).canonical_id(),
            event_retention_set: config.event_retention_set(db).canonical_id(),
            allow_stop_event_reuse: config.allow_stop_event_reuse(db),
            use_activity_stopped_as_fallback: config.use_activity_stopped_as_fallback(db),
            apply_threshold_to_fallback: config.apply_threshold_to_fallback(db),
            long_duration_threshold_ns: config.long_duration_threshold_ns(db),
            proximity_interval_ns: config.proximity_interval_ns(db),
            micro_use_classification_policy: config
                .micro_use_classification_policy(db)
                .canonical_id(),
            micro_use_classification_policy_explicit: config
                .micro_use_classification_policy_explicit(db),
            minimum_usage_duration_bits: config.minimum_usage_duration(db).to_bits(),
            minimum_usage_duration_explicit: config.minimum_usage_duration_explicit(db),
            minimum_duration_comparator: config.minimum_duration_comparator(db).canonical_id(),
            minimum_duration_comparator_explicit: config.minimum_duration_comparator_explicit(db),
            minimum_duration_disposition: config.minimum_duration_disposition(db).canonical_id(),
            minimum_duration_disposition_explicit: config.minimum_duration_disposition_explicit(db),
            apply_minimum_to_concurrent_subintervals: apply_minimum_to_subintervals,
            maximum_duration: maximum_duration_request(db, config),
            screen_session_classification_policy: config.screen_session_classification_policy(db).canonical_id(),
            screen_session_maximum_duration_bits: config.screen_session_maximum_duration_minutes(db).to_bits(),
            screen_session_maximum_duration_disposition: config.screen_session_maximum_duration_disposition(db).canonical_id(),
            locked_screen_audio_disposition: config.locked_screen_audio_disposition(db).canonical_id(),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize reconstruction-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    pub(crate) fn reconstruction_base_input_key_for_options(
        app_policy_checkpoint: &str,
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<String, String> {
        let background_apps = if options.use_background_apps_file {
            super::super::parse_background_apps_csv(support.background_apps_csv)
                .into_iter()
                .collect::<BTreeSet<_>>()
        } else {
            BTreeSet::new()
        };
        let material = ReconstructionBaseInputKey {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL,
            app_policy_checkpoint,
            application_label_exclusions: effective_application_label_exclusions_for_options(options, support),
            same_app_stop_types: &options.same_app_stop_types,
            other_stop_types: &options.other_stop_types,
            background_apps,
            model_concurrent_usage: options.model_concurrent_usage,
            episode_reconstruction_strategy: options.episode_reconstruction_strategy.canonical_id(),
            opener_set: options.opener_set.canonical_id(),
            event_retention_set: options.event_retention_set.canonical_id(),
            allow_stop_event_reuse: options.allow_stop_event_reuse,
            use_activity_stopped_as_fallback: options.use_activity_stopped_as_fallback,
            apply_threshold_to_fallback: options.apply_threshold_to_fallback,
            long_duration_threshold_ns: options.long_duration_threshold_ns,
            proximity_interval_ns: options.proximity_interval_ns,
            micro_use_classification_policy: options.micro_use_classification_policy.canonical_id(),
            micro_use_classification_policy_explicit: options
                .micro_use_classification_policy_explicit,
            minimum_usage_duration_bits: options.minimum_usage_duration.to_bits(),
            minimum_usage_duration_explicit: options.minimum_usage_duration_explicit,
            minimum_duration_comparator: options.minimum_duration_comparator.canonical_id(),
            minimum_duration_comparator_explicit: options.minimum_duration_comparator_explicit,
            minimum_duration_disposition: options.minimum_duration_disposition.canonical_id(),
            minimum_duration_disposition_explicit: options.minimum_duration_disposition_explicit,
            apply_minimum_to_concurrent_subintervals: options
                .apply_minimum_usage_duration_to_concurrent_subintervals,
            maximum_duration: options.maximum_duration.clone(),
            screen_session_classification_policy: options.screen_session_classification_policy.canonical_id(),
            screen_session_maximum_duration_bits: options.screen_session_maximum_duration_minutes.to_bits(),
            screen_session_maximum_duration_disposition: options.screen_session_maximum_duration_disposition.canonical_id(),
            locked_screen_audio_disposition: options.locked_screen_audio_disposition.canonical_id(),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize reconstruction-base input key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    fn effective_application_label_exclusions_for_options(
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> BTreeSet<String> {
        let mut filter_rules = if options.use_filter_file {
            parse_filter_csv(
                support.filter_csv,
                options.package_exclusion_preset,
                options.filter_match_field,
            )
        } else {
            AppFilterRules::default()
        };
        filter_rules.application_labels.extend(
            options
                .application_label_exclusions
                .iter()
                .filter(|label| !label.is_empty())
                .cloned(),
        );
        filter_rules.application_labels.into_iter().collect()
    }

    pub(crate) fn review_annotation_checkpoint_input_key(
        db: &dyn EarlyStepDb,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let use_app_codebook = support.use_app_codebook(db);
        let interval_quality_policy = config.interval_quality_policy(db);
        let material = ReviewAnnotationCheckpointInputKey {
            // v1 -> v2 when interval_quality_policy joined the key; v2 -> v3
            // when the (now-retired) hidden Culverhouse re-floor joined; v4
            // removes that scientifically invalid dependency without allowing
            // a v3 annotation base to alias the corrected semantics.
            protocol_version: "chronicle-review-annotation-checkpoint/v4",
            use_app_codebook,
            codebook_digest: if use_app_codebook {
                digest_bytes(&support.codebook_csv(db))
            } else {
                digest_bytes(&[])
            },
            custom_app_engagement_duration_bits: config
                .custom_app_engagement_duration(db)
                .to_bits(),
            long_data_time_gap_threshold_bits: config
                .long_data_time_gap_thresholds(db)
                .iter()
                .map(|value| value.to_bits())
                .collect(),
            long_usage_duration_threshold_bits: config
                .long_usage_duration_thresholds(db)
                .iter()
                .map(|value| value.to_bits())
                .collect(),
            interaction_types_to_remove: config.interaction_types_to_remove(db).as_ref().clone(),
            interaction_type_removal_mode: config.interaction_type_removal_mode(db).canonical_id(),
            filter_zero_duration_sessions: config.filter_zero_duration_sessions(db),
            interval_quality_policy: interval_quality_policy.canonical_id(),
        };
        let bytes = serde_json::to_vec(&material)
            .map_err(|error| format!("serialize review annotation checkpoint key: {error}"))?;
        Ok(digest_bytes(&bytes))
    }

    /// Pick the deepest usable checkpoint before copying inputs into Salsa.
    /// A selected reconstruction base remains authoritative for reconstructed
    /// rows/foundational evidence, while the independently keyed ReviewBase is
    /// retained as the annotation substrate for raw-less review execution.
    pub(crate) fn select_persisted_base_kind(
        input_sha256: &str,
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<PersistedReviewBaseSelection, String> {
        if review_base_bytes.is_empty() {
            return Ok(PersistedReviewBaseSelection::None);
        }
        let review_header = review_base_header(review_base_bytes)?;
        let expected_review_key =
            review_base_input_key_for_options(input_sha256, options, support)?;
        if review_header.input_key
            != parse_blake3_key(&expected_review_key, "expected review-base input key")?
        {
            return Ok(PersistedReviewBaseSelection::None);
        }
        // ReconstructionBase predates finalized B05/Schoedel evidence and its
        // key therefore cannot distinguish a selected source strategy or a
        // capability-sidecar assignment. For an active source B05 arm or any
        // active Schoedel arm, retain only the independently keyed ReviewBase
        // and recompute the foundational cone from the caller's retained raw
        // bytes/supports. This prevents stale opener/foundational receipts from
        // being mixed with newly reconstructed Schoedel rows.
        let source_b05_active = matches!(
            options.usage_session_mode,
            UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
        ) && options.screen_session_construction_strategy
            != ScreenSessionConstructionStrategyId::default();
        if source_b05_active || schoedel_is_active(options) {
            return Ok(PersistedReviewBaseSelection::Review);
        }
        if reconstruction_base_bytes.is_empty() {
            return Ok(PersistedReviewBaseSelection::Review);
        }
        let app_policy_checkpoint = format!(
            "sha256:{}",
            hex::encode(review_header.app_policy_checkpoint)
        );
        let expected_reconstruction_key =
            reconstruction_base_input_key_for_options(&app_policy_checkpoint, options, support)?;
        if reconstruction_base_header_input_key(reconstruction_base_bytes)?
            == parse_blake3_key(
                &expected_reconstruction_key,
                "expected reconstruction-base input key",
            )?
        {
            return Ok(PersistedReviewBaseSelection::Reconstruction);
        }
        Ok(PersistedReviewBaseSelection::Review)
    }

    pub(crate) const fn review_base_header_bytes() -> usize {
        REVIEW_BASE_HEADER_BYTES
    }

    pub(crate) const fn reconstruction_base_header_bytes() -> usize {
        RECONSTRUCTION_BASE_HEADER_BYTES
    }

    pub(crate) fn select_persisted_bases<'a>(
        input_sha256: &str,
        review_base_bytes: &'a [u8],
        reconstruction_base_bytes: &'a [u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<(&'a [u8], &'a [u8]), String> {
        match select_persisted_base_kind(
            input_sha256,
            review_base_bytes,
            reconstruction_base_bytes,
            options,
            support,
        )? {
            PersistedReviewBaseSelection::None => Ok((&[], &[])),
            PersistedReviewBaseSelection::Review => Ok((review_base_bytes, &[])),
            // ReconstructionBase owns the validated reconstruction and
            // foundational receipts, while ReviewBase owns the independently
            // keyed annotation substrate. The reconstruction restore
            // deliberately does not self-certify its stored annotation rows,
            // so a raw-less review needs both complete envelopes: truncating
            // ReviewBase to its header forced an empty-raw matcher replay.
            PersistedReviewBaseSelection::Reconstruction => {
                Ok((review_base_bytes, reconstruction_base_bytes))
            }
        }
    }

    pub(crate) fn validate_verified_persisted_base_pair(
        store: &crate::payload_store::PayloadStore,
        input_sha256: &str,
        review_base_bytes: &[u8],
        reconstruction_base_bytes: &[u8],
        options: &PipelineV2Options,
        support: PipelineV2SupportFiles<'_>,
    ) -> Result<(), String> {
        let review = decode_review_base_cached(review_base_bytes)?;
        let reconstruction = decode_reconstruction_base_cached(store, reconstruction_base_bytes)?;
        let expected_review_key =
            review_base_input_key_for_options(input_sha256, options, support)?;
        let app_policy_checkpoint = review
            .metadata
            .query_checkpoints
            .get("mark_app_policy_matches")
            .ok_or_else(|| "verified_persisted_base_pair_missing_app_policy".to_string())?;
        let expected_reconstruction_key = reconstruction_base_input_key_for_options(
            &app_policy_checkpoint.terminal_digest,
            options,
            support,
        )?;
        if review.input_key != expected_review_key
            || reconstruction.input_key != expected_reconstruction_key
            || reconstruction.early_metadata != review.metadata
            || reconstruction.foundational_semantics_binding
                != foundational_semantics_binding_for_options(options)
        {
            return Err("verified_persisted_base_pair_mismatch".into());
        }
        validate_reconstruction_base_foundational_semantics(
            &reconstruction,
            Some(&foundational_semantics_binding_for_options(options)),
        )?;
        if review
            .metadata
            .decoded_raw_row_count
            .checked_sub(review.metadata.original_row_count)
            .is_none()
        {
            return Err("verified_persisted_base_pair_row_census_mismatch".into());
        }
        Ok(())
    }

    pub(crate) fn review_base_app_policy_checkpoint(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<String, String> {
        let review_base = raw.review_base_bytes(db);
        if !review_base.is_empty() {
            let header = review_base_header(&review_base)?;
            let expected_key = review_base_input_key(db, raw, early, support)?;
            if header.input_key
                == parse_blake3_key(&expected_key, "expected review-base input key")?
            {
                return Ok(format!(
                    "sha256:{}",
                    hex::encode(header.app_policy_checkpoint)
                ));
            }
        }
        Ok(mark_app_policy_matches(db, raw, early, config, support)?
            .checkpoint
            .terminal_digest)
    }

    pub(crate) fn encode_review_base(base: &ReviewBase) -> Result<Option<Vec<u8>>, String> {
        encode_review_base_within(base, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES)
    }

    /// The ceiling is a hard reject bound, not a buffer hint: past it the base
    /// is refused (`Ok(None)`) and the review-event typed resume stops engaging
    /// for that input. Refusal is a resource decision about a cache artifact,
    /// not a validation failure, so it is typed rather than raised: the product
    /// run that built the base is unaffected and simply persists no resume.
    /// `Err` is reserved for a base that is invalid. The ceiling is taken as an
    /// argument so the exact reject boundary can be exercised without
    /// serializing a base the size of the real ceiling; the wrapper above is
    /// the only caller that chooses which ceiling applies.
    pub(crate) fn encode_review_base_within(
        base: &ReviewBase,
        max_uncompressed_bytes: usize,
    ) -> Result<Option<Vec<u8>>, String> {
        if base.zero_duration_cleanup.is_some() != base.zero_duration_cleanup_input_key.is_some() {
            return Err("review_base_zero_duration_cleanup_key_mismatch".into());
        }
        if let Some(cleanup) = &base.zero_duration_cleanup {
            super::super::validate_zero_duration_cleanup_evidence(cleanup)?;
        }
        let bytes = with_serialized_row_string_table(|| postcard::to_allocvec(base))
            .map_err(|error| format!("encode review base: {error}"))?;
        let uncompressed_len = bytes.len();
        if uncompressed_len > max_uncompressed_bytes {
            return Ok(None);
        }
        let compressed = lz4_flex::block::compress(&bytes);
        drop(bytes);
        let input_key_digest = parse_blake3_key(&base.input_key, "review-base input key")?;
        let app_policy_checkpoint = base
            .metadata
            .query_checkpoints
            .get("mark_app_policy_matches")
            .ok_or_else(|| "review base is missing its app-policy checkpoint".to_string())?;
        let app_policy_digest = parse_sha256_digest(
            &app_policy_checkpoint.terminal_digest,
            "review-base app-policy checkpoint",
        )?;
        let mut encoded = Vec::with_capacity(REVIEW_BASE_HEADER_BYTES + compressed.len());
        encoded.extend_from_slice(REVIEW_BASE_MAGIC);
        encoded.extend_from_slice(&(uncompressed_len as u32).to_le_bytes());
        // Authenticate the stored bytes before allocating the declared
        // decompressed size. This also avoids hashing the much larger decoded
        // row table on every comparison.
        encoded.extend_from_slice(blake3::hash(&compressed).as_bytes());
        encoded.extend_from_slice(&input_key_digest);
        encoded.extend_from_slice(&app_policy_digest);
        encoded.extend_from_slice(&compressed);
        Ok(Some(encoded))
    }

    pub(crate) fn review_base_header(bytes: &[u8]) -> Result<ReviewBaseHeader, String> {
        if bytes.len() < REVIEW_BASE_HEADER_BYTES {
            return Err("review base is truncated".into());
        }
        if &bytes[..REVIEW_BASE_MAGIC.len()] != REVIEW_BASE_MAGIC {
            return Err("review base has an invalid header".into());
        }
        let input_key_offset = REVIEW_BASE_MAGIC.len() + 4 + 32;
        let app_policy_offset = input_key_offset + 32;
        Ok(ReviewBaseHeader {
            input_key: bytes[input_key_offset..app_policy_offset]
                .try_into()
                .expect("32-byte review-base input key"),
            app_policy_checkpoint: bytes[app_policy_offset..app_policy_offset + 32]
                .try_into()
                .expect("32-byte review-base app-policy checkpoint"),
        })
    }

    pub(crate) fn verify_review_base_payload(bytes: &[u8]) -> Result<VerifiedReviewBaseHeader, String> {
        let header = review_base_header(bytes)?;
        let size_offset = REVIEW_BASE_MAGIC.len();
        let digest_offset = size_offset + 4;
        let payload_offset = REVIEW_BASE_HEADER_BYTES;
        let declared = u32::from_le_bytes(
            bytes[size_offset..digest_offset]
                .try_into()
                .expect("four-byte review-base size"),
        );
        if declared as usize > MAX_REVIEW_BASE_UNCOMPRESSED_BYTES {
            return Err(format!(
                "review base declares {} bytes, exceeding {}",
                declared, MAX_REVIEW_BASE_UNCOMPRESSED_BYTES
            ));
        }
        let timer = QueryTimer::start("decode_review_base_verify_digest");
        let payload_digest = *blake3::hash(&bytes[payload_offset..]).as_bytes();
        if payload_digest != bytes[digest_offset..digest_offset + 32] {
            return Err("review base payload digest mismatch".into());
        }
        timer.finish();
        Ok(VerifiedReviewBaseHeader {
            input_key: header.input_key,
            app_policy_checkpoint: header.app_policy_checkpoint,
            payload_digest,
            declared_bytes: declared as usize,
        })
    }

    pub(crate) fn decode_verified_review_base_bytes(
        bytes: &[u8],
        header: &VerifiedReviewBaseHeader,
    ) -> Result<ReviewBase, String> {
        #[cfg(test)]
        REVIEW_BASE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
        let payload_offset = REVIEW_BASE_HEADER_BYTES;
        let timer = QueryTimer::start("decode_review_base_decompress");
        let decoded = lz4_flex::block::decompress(&bytes[payload_offset..], header.declared_bytes)
            .map_err(|error| format!("decompress review base: {error}"))?;
        timer.finish();
        let timer = QueryTimer::start("decode_review_base_payload");
        let base: ReviewBase = with_deserialized_row_string_pool(|| postcard::from_bytes(&decoded))
            .map_err(|error| format!("decode review base: {error}"))?;
        timer.finish();
        if base.protocol_version != REVIEW_BASE_PROTOCOL {
            return Err(format!(
                "unsupported review-base protocol: {}",
                base.protocol_version
            ));
        }
        if base.zero_duration_cleanup.is_some() != base.zero_duration_cleanup_input_key.is_some() {
            return Err("review_base_zero_duration_cleanup_key_mismatch".into());
        }
        if let Some(cleanup) = &base.zero_duration_cleanup {
            super::super::validate_zero_duration_cleanup_evidence(cleanup)?;
        }
        if let Some(digests) = &base.matcher_search_suffix_digests {
            let expected = base.rows.len() + 1;
            if digests.len() != expected {
                return Err(format!(
                    "review base has {} matcher suffix digests; expected {expected}",
                    digests.len()
                ));
            }
        }
        if parse_blake3_key(&base.input_key, "review-base payload input key")? != header.input_key {
            return Err("review base header input key mismatch".into());
        }
        let app_policy_checkpoint = base
            .metadata
            .query_checkpoints
            .get("mark_app_policy_matches")
            .ok_or_else(|| "review base is missing its app-policy checkpoint".to_string())?;
        if parse_sha256_digest(
            &app_policy_checkpoint.terminal_digest,
            "review-base payload app-policy checkpoint",
        )? != header.app_policy_checkpoint
        {
            return Err("review base header app-policy checkpoint mismatch".into());
        }
        Ok(base)
    }

    #[cfg(test)]
    pub(crate) fn decode_review_base_bytes(bytes: &[u8]) -> Result<ReviewBase, String> {
        let header = verify_review_base_payload(bytes)?;
        decode_verified_review_base_bytes(bytes, &header)
    }

    pub(crate) fn decode_review_base_cached(bytes: &[u8]) -> Result<Arc<ReviewBase>, String> {
        // A byte-equal request is proven identical to the verified encoded
        // bytes by direct comparison, which is several times cheaper than
        // re-hashing the payload. Corrupt or merely different bytes fail the
        // comparison and take the full verify-then-decode path below, so
        // tampered bases are still rejected.
        if let Some(value) = REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.encoded_bytes.as_slice() == bytes)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }
        let header = verify_review_base_payload(bytes)?;
        if let Some(value) = REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.payload_digest == header.payload_digest)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }

        REVIEW_BASE_DECODE_CACHE.with(|cache| {
            cache.borrow_mut().take();
        });
        let value = Arc::new(decode_verified_review_base_bytes(bytes, &header)?);
        REVIEW_BASE_DECODE_CACHE.with(|cache| {
            *cache.borrow_mut() = Some(CachedDecodedReviewBase {
                payload_digest: header.payload_digest,
                encoded_bytes: Arc::new(bytes.to_vec()),
                value: Arc::clone(&value),
            });
        });
        Ok(value)
    }

    pub(crate) fn same_row_identity(
        left: &Row,
        right: &Row,
        left_scratch: &mut RowCheckpointScratch,
        right_scratch: &mut RowCheckpointScratch,
    ) -> bool {
        row_checkpoint_parts(left, left_scratch).identity
            == row_checkpoint_parts(right, right_scratch).identity
    }

    /// The five foundational fields an annotation row may never change
    /// relative to the reconstruction row it annotates. Returns the names of
    /// the fields that differ (empty = the annotation preserves foundational
    /// state).
    pub(crate) fn foundational_state_differences(reconstruction: &Row, annotation: &Row) -> Vec<&'static str> {
        [
            (
                "micro_use_classification",
                annotation.micro_use_classification != reconstruction.micro_use_classification,
            ),
            (
                "minimum_duration_qualified",
                annotation.minimum_duration_qualified != reconstruction.minimum_duration_qualified,
            ),
            (
                "minimum_duration_aggregate_eligible",
                annotation.minimum_duration_aggregate_eligible
                    != reconstruction.minimum_duration_aggregate_eligible,
            ),
            (
                "minimum_duration_blank_applied",
                annotation.minimum_duration_blank_applied
                    != reconstruction.minimum_duration_blank_applied,
            ),
            (
                "concurrent_subinterval_floor_blank_applied",
                annotation.concurrent_subinterval_floor_blank_applied
                    != reconstruction.concurrent_subinterval_floor_blank_applied,
            ),
        ]
        .iter()
        .filter(|(_, mismatched)| *mismatched)
        .map(|(field, _)| *field)
        .collect()
    }

    /// Internal consistency of a single annotation row: a blank marker means
    /// the projected durations must actually be blank. Pairing-independent.
    pub(crate) fn validate_annotation_blank_duration_projection(annotation: &Row) -> Result<(), String> {
        if (annotation.minimum_duration_blank_applied
            || annotation.concurrent_subinterval_floor_blank_applied)
            && (annotation.duration_seconds.is_some() || annotation.duration_minutes.is_some())
        {
            return Err("reconstruction_base_annotation_blank_duration_projection_mismatch".into());
        }
        Ok(())
    }

    pub(crate) fn validate_annotation_foundational_projection(
        reconstruction: &Row,
        annotation: &Row,
    ) -> Result<(), String> {
        let differences = foundational_state_differences(reconstruction, annotation);
        if !differences.is_empty() {
            return Err(format!(
                "reconstruction_base_annotation_foundational_state_mismatch:{}",
                differences.join(",")
            ));
        }
        validate_annotation_blank_duration_projection(annotation)
    }

    pub(crate) fn persist_reconstruction_base(
        base: &ReconstructionBase,
    ) -> Result<PersistedReconstructionBase, String> {
        let mut annotation_index = 0_usize;
        let annotation_rows = base.annotation_checkpoint.rows.lease()?;
        let mut reconstruction_scratch = RowCheckpointScratch::default();
        let mut annotation_scratch = RowCheckpointScratch::default();
        let mut reused = 0_usize;
        let mut replaced = 0_usize;
        let mut dropped = 0_usize;
        let row_states = base
            .rows
            .iter()
            .map(|reconstruction| {
                let annotation = annotation_rows.get(annotation_index);
                // Row identity (source ranges + lineage + original index) is
                // NOT unique after segment_concurrent_usage splits one source
                // row into several subinterval rows: every subinterval keeps
                // the source row's identity. When the annotation chain drops
                // one subinterval of such a run, greedy identity-only
                // matching pairs a reconstruction subinterval with a
                // *different* subinterval's annotation, whose foundational
                // flags legitimately differ (the pict_36 covering-array
                // failure). Foundational agreement is therefore part of the
                // matching predicate: a same-identity row whose foundational
                // state differs is treated as Drop (resume recomputes it -
                // the conservative direction), and a genuinely unconsumed
                // annotation row is diagnosed precisely below.
                let disposition = match annotation {
                    Some(annotation)
                        if same_row_identity(
                            reconstruction,
                            annotation,
                            &mut reconstruction_scratch,
                            &mut annotation_scratch,
                        ) && foundational_state_differences(reconstruction, annotation)
                            .is_empty() =>
                    {
                        validate_annotation_blank_duration_projection(annotation)?;
                        annotation_index += 1;
                        // Reuse is a content claim, not a pointer one: the
                        // three checkpoint parts hash every RowData field, so
                        // equal parts mean the annotation row IS the
                        // reconstruction row. Pointer identity alone made the
                        // persisted bytes depend on payload residency (a
                        // spilled and reloaded copy is a different Arc).
                        if Arc::ptr_eq(&reconstruction.0, &annotation.0)
                            || row_checkpoint_parts(reconstruction, &mut reconstruction_scratch)
                                == row_checkpoint_parts(annotation, &mut annotation_scratch)
                        {
                            reused += 1;
                            PersistedAnnotationRow::Reuse
                        } else {
                            replaced += 1;
                            PersistedAnnotationRow::Replace(annotation.clone())
                        }
                    }
                    _ => {
                        dropped += 1;
                        PersistedAnnotationRow::Drop
                    }
                };
                Ok(PersistedReconstructionRow {
                    reconstruction: reconstruction.clone(),
                    annotation: disposition,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        if annotation_index != annotation_rows.len() {
            // An unconsumed annotation row is either tampering (its
            // foundational state was edited, so no reconstruction row accepts
            // it) or a real subsequence violation. Diagnose the tamper class
            // precisely: if a reconstruction row shares its identity, report
            // the exact foundational fields that differ.
            let unconsumed = &annotation_rows[annotation_index];
            for reconstruction in base.rows.iter() {
                if same_row_identity(
                    reconstruction,
                    unconsumed,
                    &mut reconstruction_scratch,
                    &mut annotation_scratch,
                ) {
                    validate_annotation_foundational_projection(reconstruction, unconsumed)?;
                }
            }
            return Err(format!(
                "annotation rows are not an identity-preserving subsequence of reconstruction rows: matched {annotation_index} of {}",
                annotation_rows.len()
            ));
        }
        #[cfg(feature = "query-timing")]
        eprintln!(
            "reconstruction_base_rows total={} reused={reused} replaced={replaced} dropped={dropped}",
            row_states.len(),
        );

        let annotation = &base.annotation_checkpoint;
        Ok(PersistedReconstructionBase {
            protocol_version: base.protocol_version.clone(),
            input_key: base.input_key.clone(),
            row_states,
            foundational_episode_evidence: base.foundational_episode_evidence.clone(),
            foundational_semantics_binding: base.foundational_semantics_binding.clone(),
            opener_set_evidence: base.opener_set_evidence.clone(),
            foundational_semantics_evidence: base.foundational_semantics_evidence.clone(),
            maximum_duration_evidence: base.maximum_duration_evidence.clone(),
            eyes_tagged_fau_evidence: base.eyes_tagged_fau_evidence.clone(),
            resolve_excluded_packages: base.resolve_excluded_packages.clone(),
            mask_excluded_app_events: base.mask_excluded_app_events.clone(),
            build_app_event_index: base.build_app_event_index.clone(),
            match_app_episodes: base.match_app_episodes.clone(),
            materialize_candidate_episodes: base.materialize_candidate_episodes.clone(),
            segment_concurrent_usage: base.segment_concurrent_usage.clone(),
            reconstruct_episodes: base.reconstruct_episodes.clone(),
            annotation_checkpoint: PersistedReviewAnnotationCheckpointBase {
                input_key: annotation.input_key.clone(),
                zero_duration_cleanup: annotation.zero_duration_cleanup.clone(),
                join_app_codebook: annotation.join_app_codebook.clone(),
                derive_broad_category: annotation.derive_broad_category.clone(),
                collapse_app_genre: annotation.collapse_app_genre.clone(),
                categorize_apps: annotation.categorize_apps.clone(),
                derive_engagement_basis: annotation.derive_engagement_basis.clone(),
                apply_episode_flags: annotation.apply_episode_flags.clone(),
                episode_annotations: annotation.episode_annotations.clone(),
                suppress_excluded_timing: annotation.suppress_excluded_timing.clone(),
                remove_selected_interaction_types: annotation
                    .remove_selected_interaction_types
                    .clone(),
                remove_zero_duration_rows: annotation.remove_zero_duration_rows.clone(),
                interval_cleaning: annotation.interval_cleaning.clone(),
            },
            early_metadata: base.early_metadata.clone(),
            screen: base.screen.clone(),
        })
    }

    pub(crate) fn restore_reconstruction_base(
        store: &crate::payload_store::PayloadStore,
        persisted: PersistedReconstructionBase,
    ) -> Result<ReconstructionBase, String> {
        let mut reconstruction_rows = Vec::with_capacity(persisted.row_states.len());
        let mut annotation_rows = Vec::with_capacity(persisted.row_states.len());
        let mut reconstruction_scratch = RowCheckpointScratch::default();
        let mut annotation_scratch = RowCheckpointScratch::default();
        for state in persisted.row_states {
            let PersistedReconstructionRow {
                reconstruction,
                annotation,
            } = state;
            match annotation {
                PersistedAnnotationRow::Reuse => {
                    validate_annotation_foundational_projection(&reconstruction, &reconstruction)?;
                    annotation_rows.push(reconstruction.clone());
                }
                PersistedAnnotationRow::Replace(annotation) => {
                    if !same_row_identity(
                        &reconstruction,
                        &annotation,
                        &mut reconstruction_scratch,
                        &mut annotation_scratch,
                    ) {
                        return Err("persisted annotation replacement changed row identity".into());
                    }
                    validate_annotation_foundational_projection(&reconstruction, &annotation)?;
                    annotation_rows.push(annotation);
                }
                PersistedAnnotationRow::Drop => {}
            }
            reconstruction_rows.push(reconstruction);
        }
        let annotation = persisted.annotation_checkpoint;
        Ok(ReconstructionBase {
            protocol_version: persisted.protocol_version,
            input_key: persisted.input_key,
            rows: Arc::new(reconstruction_rows),
            foundational_episode_evidence: persisted.foundational_episode_evidence,
            foundational_semantics_binding: persisted.foundational_semantics_binding,
            opener_set_evidence: persisted.opener_set_evidence,
            foundational_semantics_evidence: persisted.foundational_semantics_evidence,
            maximum_duration_evidence: persisted.maximum_duration_evidence,
            eyes_tagged_fau_evidence: persisted.eyes_tagged_fau_evidence,
            resolve_excluded_packages: persisted.resolve_excluded_packages,
            mask_excluded_app_events: persisted.mask_excluded_app_events,
            build_app_event_index: persisted.build_app_event_index,
            match_app_episodes: persisted.match_app_episodes,
            materialize_candidate_episodes: persisted.materialize_candidate_episodes,
            segment_concurrent_usage: persisted.segment_concurrent_usage,
            reconstruct_episodes: persisted.reconstruct_episodes,
            annotation_checkpoint: ReviewAnnotationCheckpointBase {
                input_key: annotation.input_key,
                rows: query_payload(store, Arc::new(annotation_rows)),
                zero_duration_cleanup: annotation.zero_duration_cleanup,
                join_app_codebook: annotation.join_app_codebook,
                derive_broad_category: annotation.derive_broad_category,
                collapse_app_genre: annotation.collapse_app_genre,
                categorize_apps: annotation.categorize_apps,
                derive_engagement_basis: annotation.derive_engagement_basis,
                apply_episode_flags: annotation.apply_episode_flags,
                episode_annotations: annotation.episode_annotations,
                suppress_excluded_timing: annotation.suppress_excluded_timing,
                remove_selected_interaction_types: annotation.remove_selected_interaction_types,
                remove_zero_duration_rows: annotation.remove_zero_duration_rows,
                interval_cleaning: annotation.interval_cleaning,
            },
            early_metadata: persisted.early_metadata,
            screen: persisted.screen,
        })
    }

    pub(crate) fn encode_reconstruction_base(base: &ReconstructionBase) -> Result<Option<Vec<u8>>, String> {
        encode_reconstruction_base_within(base, MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES)
    }

    /// Same hard reject bound as `encode_review_base_within`, for the reconstruction
    /// resume base: `Ok(None)` past the ceiling, `Err` only for an invalid base.
    pub(crate) fn encode_reconstruction_base_within(
        base: &ReconstructionBase,
        max_uncompressed_bytes: usize,
    ) -> Result<Option<Vec<u8>>, String> {
        super::super::validate_minimum_duration_excluded_lineage(&base.foundational_semantics_evidence)?;
        super::super::validate_zero_duration_cleanup_lineage(&base.foundational_semantics_evidence)?;
        validate_reconstruction_base_zero_duration_cleanup(base)?;
        validate_reconstruction_base_foundational_semantics(base, None)?;
        let persisted = persist_reconstruction_base(base)?;
        let bytes = with_serialized_row_string_table(|| postcard::to_allocvec(&persisted))
            .map_err(|error| format!("encode reconstruction base: {error}"))?;
        let uncompressed_len = bytes.len();
        if uncompressed_len > max_uncompressed_bytes {
            return Ok(None);
        }
        let compressed = lz4_flex::block::compress(&bytes);
        drop(bytes);
        drop(persisted);
        let input_key_digest = parse_blake3_key(&base.input_key, "reconstruction-base input key")?;
        let mut encoded = Vec::with_capacity(RECONSTRUCTION_BASE_HEADER_BYTES + compressed.len());
        encoded.extend_from_slice(RECONSTRUCTION_BASE_MAGIC);
        encoded.extend_from_slice(&(uncompressed_len as u32).to_le_bytes());
        encoded.extend_from_slice(blake3::hash(&compressed).as_bytes());
        encoded.extend_from_slice(&input_key_digest);
        encoded.extend_from_slice(&compressed);
        Ok(Some(encoded))
    }

    pub(crate) fn parse_blake3_key(value: &str, label: &str) -> Result<[u8; 32], String> {
        let encoded = value
            .strip_prefix("blake3:")
            .ok_or_else(|| format!("{label} does not use blake3"))?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(encoded, &mut digest)
            .map_err(|error| format!("decode {label}: {error}"))?;
        Ok(digest)
    }

    pub(crate) fn parse_sha256_digest(value: &str, label: &str) -> Result<[u8; 32], String> {
        let encoded = value
            .strip_prefix("sha256:")
            .ok_or_else(|| format!("{label} does not use sha256"))?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(encoded, &mut digest)
            .map_err(|error| format!("decode {label}: {error}"))?;
        Ok(digest)
    }

    pub(crate) fn reconstruction_base_header_input_key(bytes: &[u8]) -> Result<[u8; 32], String> {
        if bytes.len() < RECONSTRUCTION_BASE_HEADER_BYTES {
            return Err("reconstruction base is truncated".into());
        }
        if &bytes[..RECONSTRUCTION_BASE_MAGIC.len()] != RECONSTRUCTION_BASE_MAGIC {
            return Err("reconstruction base has an invalid header".into());
        }
        let input_key_offset = RECONSTRUCTION_BASE_MAGIC.len() + 4 + 32;
        Ok(bytes[input_key_offset..input_key_offset + 32]
            .try_into()
            .expect("32-byte reconstruction-base input key"))
    }

    #[derive(Debug)]
    pub(crate) struct VerifiedReconstructionBaseHeader {
        pub(crate) input_key: [u8; 32],
        pub(crate) payload_digest: [u8; 32],
        pub(crate) declared_bytes: usize,
    }

    pub(crate) fn verify_reconstruction_base_payload(
        bytes: &[u8],
    ) -> Result<VerifiedReconstructionBaseHeader, String> {
        let header_input_key = reconstruction_base_header_input_key(bytes)?;
        let size_offset = RECONSTRUCTION_BASE_MAGIC.len();
        let digest_offset = size_offset + 4;
        let payload_offset = RECONSTRUCTION_BASE_HEADER_BYTES;
        let declared = u32::from_le_bytes(
            bytes[size_offset..digest_offset]
                .try_into()
                .expect("four-byte reconstruction-base size"),
        );
        if declared as usize > MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES {
            return Err(format!(
                "reconstruction base declares {} bytes, exceeding {}",
                declared, MAX_RECONSTRUCTION_BASE_UNCOMPRESSED_BYTES
            ));
        }
        let timer = QueryTimer::start("decode_reconstruction_base_verify_digest");
        let payload_digest = *blake3::hash(&bytes[payload_offset..]).as_bytes();
        if payload_digest != bytes[digest_offset..digest_offset + 32] {
            return Err("reconstruction base payload digest mismatch".into());
        }
        timer.finish();
        Ok(VerifiedReconstructionBaseHeader {
            input_key: header_input_key,
            payload_digest,
            declared_bytes: declared as usize,
        })
    }

    pub(crate) fn decode_verified_reconstruction_base_bytes(
        store: &crate::payload_store::PayloadStore,
        bytes: &[u8],
        header: &VerifiedReconstructionBaseHeader,
    ) -> Result<ReconstructionBase, String> {
        #[cfg(test)]
        RECONSTRUCTION_BASE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
        let payload_offset = RECONSTRUCTION_BASE_HEADER_BYTES;
        let timer = QueryTimer::start("decode_reconstruction_base_decompress");
        let decoded = lz4_flex::block::decompress(&bytes[payload_offset..], header.declared_bytes)
            .map_err(|error| format!("decompress reconstruction base: {error}"))?;
        timer.finish();
        let timer = QueryTimer::start("decode_reconstruction_base_payload");
        let persisted: PersistedReconstructionBase =
            with_deserialized_row_string_pool(|| postcard::from_bytes(&decoded))
                .map_err(|error| format!("decode reconstruction base: {error}"))?;
        timer.finish();
        if persisted.protocol_version != RECONSTRUCTION_BASE_PROTOCOL {
            return Err(format!(
                "unsupported reconstruction-base protocol: {}",
                persisted.protocol_version
            ));
        }
        let base = restore_reconstruction_base(store, persisted)?;
        super::super::validate_minimum_duration_excluded_lineage(&base.foundational_semantics_evidence)?;
        super::super::validate_zero_duration_cleanup_lineage(&base.foundational_semantics_evidence)?;
        validate_reconstruction_base_zero_duration_cleanup(&base)?;
        validate_reconstruction_base_foundational_semantics(&base, None)?;
        if parse_blake3_key(&base.input_key, "reconstruction-base payload input key")?
            != header.input_key
        {
            return Err("reconstruction base header input key mismatch".into());
        }
        Ok(base)
    }

    pub(crate) fn validate_reconstruction_base_zero_duration_cleanup(
        base: &ReconstructionBase,
    ) -> Result<(), String> {
        let annotation = &base.annotation_checkpoint.zero_duration_cleanup;
        let mut annotation_envelope = base.foundational_semantics_evidence.clone();
        annotation_envelope.zero_duration_cleanup = annotation.clone();
        super::super::validate_zero_duration_cleanup_lineage(&annotation_envelope)?;
        if annotation != &base.foundational_semantics_evidence.zero_duration_cleanup {
            return Err("reconstruction_base_zero_duration_cleanup_evidence_mismatch".into());
        }
        if !annotation.receipt.effective_applied {
            let actual_candidates = base
                .annotation_checkpoint
                .rows
                .lease()?
                .iter()
                .filter(|row| super::super::is_zero_duration_cleanup_candidate(row))
                .count() as u32;
            if actual_candidates != annotation.receipt.zero_episode_candidate_count {
                return Err("reconstruction_base_zero_duration_candidate_count_mismatch".into());
            }
        }
        Ok(())
    }

    pub(crate) type FoundationalEpisodeIdentity = (
        String,
        String,
        Vec<(u32, u32)>,
        i64,
        Option<i64>,
        Option<i64>,
    );

    pub(crate) fn foundational_episode_identity(
        episode: &FoundationalEpisodeEvidence,
    ) -> FoundationalEpisodeIdentity {
        (
            episode.participant_id.clone(),
            episode.app_package_name.clone(),
            episode
                .source_data_row_ranges
                .iter()
                .map(|range| (range.first, range.last))
                .collect(),
            episode.raw_start_timestamp_ns,
            episode.raw_stop_timestamp_ns,
            episode.raw_duration_ns,
        )
    }

    pub(crate) fn foundational_row_identity(row: &Row) -> Option<FoundationalEpisodeIdentity> {
        row.raw_episode_start_timestamp_ns.map(|raw_start| {
            (
                row.participant_id.to_string(),
                row.app_package_name.to_string(),
                row.source_data_rows
                    .ranges()
                    .iter()
                    .map(|range| (range.first, range.last))
                    .collect(),
                raw_start,
                row.raw_episode_stop_timestamp_ns,
                row.raw_episode_duration_ns,
            )
        })
    }

    pub(crate) fn expected_micro_use_classification(
        policy: MicroUseClassificationPolicy,
        raw_duration_ns: Option<i64>,
    ) -> Option<MicroUseClassification> {
        match policy {
            MicroUseClassificationPolicy::None => None,
            MicroUseClassificationPolicy::OkoshiLt5s => Some(match raw_duration_ns {
                Some(duration) if duration > 0 && duration < OKOSHI_MICRO_USE_THRESHOLD_NS => {
                    MicroUseClassification::MicroUse
                }
                Some(duration) if duration > 0 => MicroUseClassification::NotMicroUse,
                _ => MicroUseClassification::NotClassifiable,
            }),
        }
    }

    pub(crate) fn validate_reconstruction_base_foundational_semantics(
        base: &ReconstructionBase,
        expected_binding: Option<&FoundationalSemanticsBinding>,
    ) -> Result<(), String> {
        super::super::validate_micro_use_receipt_shape(&base.foundational_semantics_evidence)?;
        super::super::validate_minimum_duration_receipt_shape(&base.foundational_semantics_evidence)?;
        let binding = &base.foundational_semantics_binding;
        if expected_binding.is_some_and(|expected| expected != binding) {
            return Err("reconstruction_base_foundational_binding_mismatch".into());
        }
        let minimum_usage_duration = f64::from_bits(binding.minimum_usage_duration_bits);
        super::super::checked_minimum_duration_threshold_ns(minimum_usage_duration)
            .map_err(|_| "reconstruction_base_foundational_threshold_invalid".to_string())?;

        let mut canonical = base.foundational_episode_evidence.clone();
        super::super::canonicalize_foundational_episode_evidence(&mut canonical);
        if canonical != base.foundational_episode_evidence {
            return Err("reconstruction_base_foundational_episode_census_noncanonical".into());
        }
        let mut identities = BTreeSet::new();
        let threshold_ns = minimum_duration_threshold_ns(minimum_usage_duration);
        for episode in &base.foundational_episode_evidence {
            if episode.source_data_row_ranges.is_empty()
                || episode
                    .source_data_row_ranges
                    .iter()
                    .enumerate()
                    .any(|(index, range)| {
                        range.first == 0
                            || range.first > range.last
                            || range.last > base.early_metadata.decoded_raw_row_count
                            || index > 0
                                && episode.source_data_row_ranges[index - 1]
                                    .last
                                    .saturating_add(1)
                                    >= range.first
                    })
            {
                return Err("reconstruction_base_foundational_source_ranges_noncanonical".into());
            }
            if episode.raw_stop_timestamp_ns.is_some() != episode.raw_duration_ns.is_some()
                || episode.raw_stop_timestamp_ns.is_some_and(|stop| {
                    stop.saturating_sub(episode.raw_start_timestamp_ns)
                        != episode.raw_duration_ns.unwrap_or_default()
                })
            {
                return Err("reconstruction_base_foundational_raw_duration_mismatch".into());
            }
            if !identities.insert(foundational_episode_identity(episode)) {
                return Err("reconstruction_base_foundational_episode_census_duplicate".into());
            }
            let expected_micro = expected_micro_use_classification(
                binding.micro_use_classification_policy,
                episode.raw_duration_ns,
            );
            if episode.micro_use_classification != expected_micro {
                return Err("reconstruction_base_micro_use_classification_mismatch".into());
            }
            let expected_qualified = match (episode.raw_stop_timestamp_ns, episode.raw_duration_ns)
            {
                (Some(_), Some(duration_ns)) => Some(threshold_ns.is_some_and(|threshold_ns| {
                    binding
                        .minimum_duration_comparator
                        .qualifies(duration_ns, threshold_ns)
                })),
                _ => None,
            };
            if episode.minimum_duration_qualified != expected_qualified {
                return Err("reconstruction_base_minimum_duration_qualification_mismatch".into());
            }
        }

        // Reconstruction rows are post-concurrency and may contain several
        // fragments for one episode.  Compare sets of immutable episode
        // identities, never fragment counts. B04/B06 `drop_row` and the
        // selected locked-screen policy may remove an episode before here.
        let maximum_duration_stage = b06::resolve_row_stage(
            binding.maximum_duration.policy.as_deref(),
            binding.maximum_duration.disposition.as_deref(),
            binding.maximum_duration.threshold_source.as_deref(),
            binding.maximum_duration.threshold_ns.as_deref(),
        )
        .map_err(|_| "reconstruction_base_maximum_duration_request_invalid".to_string())?;
        let maximum_duration_qualifies = |episode: &FoundationalEpisodeEvidence| -> Option<bool> {
            let threshold_ns = maximum_duration_stage.threshold_ns?;
            let duration_ns = episode.raw_duration_ns?;
            episode.raw_stop_timestamp_ns?;
            Some(b06::qualifies(duration_ns, threshold_ns))
        };
        let mut rows_by_identity = BTreeMap::<FoundationalEpisodeIdentity, Vec<&Row>>::new();
        for row in base.rows.iter() {
            let Some(identity) = foundational_row_identity(row) else {
                continue;
            };
            if !identities.contains(&identity) {
                return Err("reconstruction_base_row_missing_from_foundational_census".into());
            }
            rows_by_identity.entry(identity).or_default().push(row);
        }
        let screen_duration_excluded = base
            .screen
            .as_ref()
            .map(|screen| {
                super::super::screen_duration_excluded_participants(
                    &screen.screen_construction,
                    binding.screen_session_maximum_duration_disposition,
                    f64::from_bits(binding.screen_session_maximum_duration_bits),
                )
            })
            .unwrap_or_default();
        for episode in &base.foundational_episode_evidence {
            let identity = foundational_episode_identity(episode);
            let maximum_qualified = maximum_duration_qualifies(episode);
            let locked_screen_dropped = binding.locked_screen_audio_disposition
                == LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
                && base.screen.as_ref().is_some_and(|screen| {
                    !screen.rows.iter().any(|row| {
                        row.participant_id.as_str() == episode.participant_id
                            && row.start_timestamp_ns.is_some_and(|start| {
                                start <= episode.raw_start_timestamp_ns
                                    && row
                                        .stop_timestamp_ns
                                        .is_none_or(|stop| episode.raw_start_timestamp_ns < stop)
                            })
                    })
                });
            let was_dropped = (episode.minimum_duration_qualified == Some(true)
                && binding.minimum_duration_disposition == MinimumDurationDisposition::DropRow)
                || (maximum_qualified == Some(true)
                    && maximum_duration_stage.disposition
                        == b06::MaximumDurationDisposition::DropRow)
                || locked_screen_dropped
                || screen_duration_excluded.contains(&episode.participant_id);
            let fragments = rows_by_identity.get(&identity);
            if was_dropped {
                if fragments.is_some() {
                    return Err("reconstruction_base_drop_row_episode_survived".into());
                }
                continue;
            }
            let fragments = fragments.ok_or_else(|| {
                "reconstruction_base_foundational_episode_missing_from_rows".to_string()
            })?;
            for row in fragments {
                if row.micro_use_classification != episode.micro_use_classification
                    || row.minimum_duration_qualified != episode.minimum_duration_qualified
                    || row.minimum_duration_drop_pending
                {
                    return Err("reconstruction_base_foundational_row_state_mismatch".into());
                }
                // B06 row state follows the same census: qualification is
                // recomputed from the immutable raw duration, and the
                // aggregate-eligibility / drop marks follow the disposition.
                let expected_maximum_eligible = !(maximum_qualified == Some(true)
                    && maximum_duration_stage.disposition
                        == b06::MaximumDurationDisposition::RetainButExclude);
                if row.maximum_duration_qualified != maximum_qualified
                    || row.maximum_duration_drop_pending
                    || row.maximum_duration_aggregate_eligible != expected_maximum_eligible
                {
                    return Err("reconstruction_base_maximum_duration_row_state_mismatch".into());
                }
                let qualifies = episode.minimum_duration_qualified == Some(true);
                let expected_eligible = !(qualifies
                    && binding.minimum_duration_disposition
                        == MinimumDurationDisposition::RetainButExclude);
                let expected_blank = qualifies
                    && binding.minimum_duration_disposition
                        == MinimumDurationDisposition::ChronicleBlankKeepRow;
                if row.minimum_duration_aggregate_eligible != expected_eligible
                    || row.minimum_duration_blank_applied != expected_blank
                {
                    return Err(
                        "reconstruction_base_foundational_disposition_state_mismatch".into(),
                    );
                }
                if (expected_blank || row.concurrent_subinterval_floor_blank_applied)
                    && (row.duration_seconds.is_some() || row.duration_minutes.is_some())
                {
                    return Err("reconstruction_base_blank_duration_projection_mismatch".into());
                }
            }
        }

        let mut expected = super::super::foundational_semantics_evidence_for_episode_evidence(
            &base.foundational_episode_evidence,
            binding.micro_use_classification_policy,
            binding.micro_use_classification_policy_explicit,
            minimum_usage_duration,
            binding.minimum_usage_duration_explicit,
            binding.minimum_duration_comparator,
            binding.minimum_duration_comparator_explicit,
            binding.minimum_duration_disposition,
            binding.minimum_duration_disposition_explicit,
            binding.episode_reconstruction_strategy,
        );
        super::super::attach_concurrent_subinterval_floor_evidence(
            &mut expected,
            &base.rows,
            minimum_usage_duration,
            binding.apply_minimum_to_concurrent_subintervals,
            true,
        );
        expected.zero_duration_cleanup = base
            .foundational_semantics_evidence
            .zero_duration_cleanup
            .clone();
        if expected != base.foundational_semantics_evidence {
            return Err("reconstruction_base_foundational_semantics_evidence_mismatch".into());
        }
        let expected_maximum = super::super::maximum_duration_evidence_for_episode_evidence(
            &base.foundational_episode_evidence,
            &binding.maximum_duration,
            binding.episode_reconstruction_strategy,
            binding.long_duration_threshold_ns,
        )?;
        if expected_maximum != base.maximum_duration_evidence {
            return Err("reconstruction_base_maximum_duration_evidence_mismatch".into());
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn decode_reconstruction_base_bytes(bytes: &[u8]) -> Result<ReconstructionBase, String> {
        let header = verify_reconstruction_base_payload(bytes)?;
        decode_verified_reconstruction_base_bytes(&crate::payload_store::current_store(), bytes, &header)
    }

    pub(crate) fn decode_reconstruction_base_cached(
        store: &crate::payload_store::PayloadStore, bytes: &[u8]) -> Result<Arc<ReconstructionBase>, String> {
        // A byte-equal request is proven identical to the verified encoded
        // bytes by direct comparison, which is several times cheaper than
        // re-hashing the payload. Corrupt or merely different bytes fail the
        // comparison and take the full verify-then-decode path below, so
        // tampered bases are still rejected.
        if let Some(value) = RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.store.same_store(store) && entry.encoded_bytes.as_slice() == bytes)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }
        let header = verify_reconstruction_base_payload(bytes)?;
        if let Some(value) = RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache
                .borrow()
                .as_ref()
                .filter(|entry| entry.store.same_store(store) && entry.payload_digest == header.payload_digest)
                .map(|entry| Arc::clone(&entry.value))
        }) {
            return Ok(value);
        }

        // Drop a prior file's decoded rows before allocating the next file's
        // checkpoint so a miss does not retain two large workspaces.
        RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            cache.borrow_mut().take();
        });
        let value = Arc::new(decode_verified_reconstruction_base_bytes(store, bytes, &header)?);
        RECONSTRUCTION_BASE_DECODE_CACHE.with(|cache| {
            *cache.borrow_mut() = Some(CachedDecodedReconstructionBase {
                store: store.clone(),
                payload_digest: header.payload_digest,
                encoded_bytes: Arc::new(bytes.to_vec()),
                value: Arc::clone(&value),
            });
        });
        Ok(value)
    }

    pub(crate) fn build_review_base_metadata(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<ReviewBaseMetadata, String> {
        let values = [
            validate_remap_rules(db, early)?.checkpoint,
            decode_source_records(db, raw)?.checkpoint,
            remove_missing_timestamps(db, raw)?.checkpoint,
            attach_device_models(db, raw)?.checkpoint,
            canonicalize_source_rows(db, raw, early)?.checkpoint,
            order_source_records(db, raw, early)?.checkpoint,
            collect_timezone_observations(db, raw, early)?.checkpoint,
            estimate_dominant_timezone(db, raw, early)?.checkpoint,
            resolve_timezone_strategy(db, raw, early)?.checkpoint,
            standardize_event_clock(db, raw, early)?.checkpoint,
            summarize_row_selection(db, raw, early)?.checkpoint,
            coalesce_duplicate_event_keys(db, raw, early)?.checkpoint,
            summarize_duplicate_groups(db, raw, early)?.checkpoint,
            disambiguate_duplicate_timestamps(db, raw, early)?.checkpoint,
            derive_time_gap_evidence(db, raw, early)?.checkpoint,
            mark_app_policy_matches(db, raw, early, config, support)?.checkpoint,
        ];
        let query_checkpoints = values
            .into_iter()
            .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint))
            .collect::<BTreeMap<_, _>>();

        let sorted = order_source_records(db, raw, early)?;
        let decoded_raw_row_count = decode_source_records(db, raw)?.value.len() as u32;
        let selected = resolve_timezone_strategy(db, raw, early)?;
        let selected_payload = selected.value.lease()?;
        let restamped = standardize_event_clock(db, raw, early)?;
        let deduped = coalesce_duplicate_event_keys(db, raw, early)?;
        let duplicate_groups = summarize_duplicate_groups(db, raw, early)?;
        let duplicate_groups_payload = duplicate_groups.value.lease()?;
        let gaps = derive_time_gap_evidence(db, raw, early)?;
        let policy = mark_app_policy_matches(db, raw, early, config, support)?;
        let timezones = collect_timezone_observations(db, raw, early)?;
        let timezones_payload = timezones.value.lease()?;
        let query_group_checkpoints = [
            required_query_group_checkpoint(&sorted, "parse_events")?,
            required_query_group_checkpoint(&restamped, "normalize_timezones")?,
            required_query_group_checkpoint(&gaps, "dedup_and_order")?,
            required_query_group_checkpoint(&policy, "app_policy")?,
        ]
        .into_iter()
        .map(|checkpoint| (checkpoint.subject_id.clone(), checkpoint))
        .collect();
        // Computed here, not in the producing steps: the contract's
        // field-edge scan attributes a helper's reads to the body that
        // calls it, and these digests read every row field. One statement
        // per digest so the two row tables are never leased together.
        let timezone_retained_source_rows_digest =
            timezone_retained_source_rows_digest(&selected_payload.rows.lease()?);
        let timezone_stage_digest = timezone_stage_digest(&restamped.value.lease()?);

        Ok(ReviewBaseMetadata {
            query_checkpoints,
            query_group_checkpoints,
            decoded_raw_row_count,
            original_row_count: sorted.value.len() as u32,
            processed_row_count: policy.value.len() as u32,
            rows_before_timezone_handling: sorted.value.len() as u32,
            rows_after_timezone_handling: selected_payload.rows.len() as u32,
            duplicate_timestamps_corrected: if early.correct_duplicate_event_timestamps(db) {
                *duplicate_groups_payload
            } else {
                0
            },
            exact_duplicate_rows_removed: restamped.value.len().saturating_sub(deduped.value.len())
                as u32,
            available_timezones: timezones_payload.iter().cloned().collect(),
            timezone: selected_payload.target_timezone.clone(),
            timezone_action: selected_payload.action.clone(),
            timezone_retained_source_rows_digest,
            timezone_stage_digest,
        })
    }

    pub(crate) fn build_review_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<Vec<u8>>, String> {
        let policy = mark_app_policy_matches(db, raw, early, config, support)?;
        let policy_payload = policy.value.lease()?;
        let app_mode = matches!(
            config.usage_session_mode(db),
            UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
        );
        // The digest chain is over the RETAINED row stream, so it is only
        // meaningful to a later run using the same retention set. The review
        // base's own `rows` are the pre-retention policy table and stay
        // reusable across sets; these digests do not. Persisting them only for
        // the unretained stream keeps the base retention-independent instead of
        // making its input key carry a field the early stage cannot see.
        let matcher_search_suffix_digests =
            if app_mode && config.event_retention_set(db) == EventRetentionSet::None {
                Some(Arc::new(inline_lineage_search_suffix_digests(
                    &mask_excluded_app_events(db, raw, early, config, support)?
                        .value
                        .lease()?,
                )))
            } else {
                None
            };
        let base = ReviewBase {
            protocol_version: REVIEW_BASE_PROTOCOL.into(),
            input_key: review_base_input_key(db, raw, early, support)?,
            rows: policy_payload.shared(),
            matcher_search_suffix_digests,
            metadata: build_review_base_metadata(db, raw, early, config, support)?,
            screen: build_screen_base(db, raw, early, config, support)?,
            zero_duration_cleanup: app_mode
                .then(|| review_annotations_fused(db, raw, early, config, support))
                .transpose()?
                .map(|annotations| annotations.zero_duration_cleanup),
            zero_duration_cleanup_input_key: app_mode
                .then(|| review_annotation_checkpoint_input_key(db, config, support))
                .transpose()?,
        };
        encode_review_base(&base)
    }

    pub(crate) fn build_neutral_chronicle_screen_construction(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<b05::ScreenConstructionOutput, String> {
        let decoded = decode_source_records(db, raw)?;
        let decoded_payload = decoded.value.lease()?;
        let raw_events = raw_b05_events(&decoded_payload);
        let raw_input_sha256 = raw.input_sha256(db);
        let fragmented_participants = support
            .fragmented_participant_ids(db)
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if !fragmented_participants.is_empty() {
            return crate::pipeline_v2::scientific::neutral_chronicle_screen_construction(
                &raw_input_sha256, &raw_events, &fragmented_participants, &[], &[],
            );
        }
        let canonical = derive_time_gap_evidence(db, raw, early)?;
        let canonical_payload = canonical.value.lease()?;
        let closes = infer_screen_session_skeletons(db, raw, early, config, support)?;
        let closes_payload = closes.value.lease()?;
        crate::pipeline_v2::scientific::neutral_chronicle_screen_construction(
            &raw_input_sha256, &raw_events, &fragmented_participants,
            &chronicle_interval_inputs(&canonical_payload, &closes_payload),
            &chronicle_orphan_stop_issues(&canonical_payload),
        )
    }

    pub(crate) fn build_screen_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<ScreenBase>, String> {
        let screen_required = matches!(
            config.usage_session_mode(db),
            UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
        ) || config.locked_screen_audio_disposition(db)
            == LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
            || config.screen_session_maximum_duration_disposition(db)
                == ScreenSessionMaximumDurationDisposition::ExcludeParticipant;
        if !screen_required
            || config.screen_session_construction_strategy(db)
                != ScreenSessionConstructionStrategyId::default()
        {
            return Ok(None);
        }
        let keyguard = index_keyguard_events(db, raw, early, config, support)?;
        let walked = infer_screen_session_skeletons(db, raw, early, config, support)?;
        let built = classify_screen_sessions(db, raw, early, config, support)?;
        let built_payload = built.value.lease()?;
        let construction = construct_screen_intervals(db, raw, early, config, support)?;
        let construction_payload = construction.value.lease()?;
        Ok(Some(ScreenBase {
            input_key: screen_base_input_key(db, raw, early, config, support)?,
            rows: built_payload.shared(),
            screen_construction: (*construction_payload).clone(),
            construct_screen_intervals: construction.checkpoint.clone(),
            index_keyguard_events: keyguard.checkpoint.clone(),
            infer_screen_session_skeletons: walked.checkpoint.clone(),
            classify_screen_sessions: built.checkpoint.clone(),
            device_state_timeline: required_query_group_checkpoint(
                &built,
                "device_state_timeline",
            )?,
        }))
    }

    pub(crate) fn build_reconstruction_base(
        db: &dyn EarlyStepDb,
        raw: EarlyRawInput,
        early: EarlyConfigInput,
        config: UsageConfigInput,
        support: UsageSupportInput,
    ) -> Result<Option<Vec<u8>>, String> {
        // The export runs after the full execution, so every table below is
        // a spilled payload and the leases here are what the export pins.
        // Lease one table at a time: the early metadata and the screen base
        // first (their leases end with the call), then each episode table
        // for exactly the values the base copies out of it, and only the
        // segmented rows stay shared into the encoded base.
        let early_metadata = build_review_base_metadata(db, raw, early, config, support)?;
        let screen = build_screen_base(db, raw, early, config, support)?;
        let applied = materialize_candidate_episodes(db, raw, early, config, support)?;
        let junk = resolve_excluded_packages(db, raw, early, config, support)?;
        let blind = mask_excluded_app_events(db, raw, early, config, support)?;
        let matcher_input = build_app_event_index(db, raw, early, config, support)?;
        let matcher = match_app_episodes(db, raw, early, config, support)?;
        let (opener_set_evidence, eyes_tagged_fau_evidence) = {
            let matcher_payload = matcher.value.lease()?;
            (
                matcher_payload.opener_set_evidence.clone(),
                matcher_payload.eyes_tagged_fau_evidence.clone(),
            )
        };
        // Persist the checkpoint produced by the compact review query itself.
        // The full-output query binds additional payload fields at a few
        // pass-through steps; borrowing that checkpoint would keep result rows
        // correct while silently changing later review provenance digests.
        let annotated = review_annotations_fused(db, raw, early, config, support)?;
        let annotation_checkpoint = ReviewAnnotationCheckpointBase {
            input_key: review_annotation_checkpoint_input_key(db, config, support)?,
            rows: annotated.rows.clone(),
            zero_duration_cleanup: annotated.zero_duration_cleanup.clone(),
            join_app_codebook: annotated.join_app_codebook.clone(),
            derive_broad_category: annotated.derive_broad_category.clone(),
            collapse_app_genre: annotated.collapse_app_genre.clone(),
            categorize_apps: annotated.categorize_apps.clone(),
            derive_engagement_basis: annotated.derive_engagement_basis.clone(),
            apply_episode_flags: annotated.apply_episode_flags.clone(),
            episode_annotations: annotated.episode_annotations.clone(),
            suppress_excluded_timing: annotated.suppress_excluded_timing.clone(),
            remove_selected_interaction_types: annotated.remove_selected_interaction_types.clone(),
            remove_zero_duration_rows: annotated.remove_zero_duration_rows.clone(),
            interval_cleaning: annotated.interval_cleaning.clone(),
        };
        let classified = classify_episode_durations(db, raw, early, config, support)?;
        let (foundational_episode_evidence, mut foundational_semantics_evidence) = {
            let classified_payload = classified.value.lease()?;
            let mut episode_evidence =
                super::super::foundational_episode_evidence_from_rows(&classified_payload);
            super::super::canonicalize_foundational_episode_evidence(&mut episode_evidence);
            let semantics_evidence = super::super::foundational_semantics_evidence_for_policies(
                &classified_payload,
                config.micro_use_classification_policy(db),
                config.micro_use_classification_policy_explicit(db),
                config.minimum_usage_duration(db),
                config.minimum_usage_duration_explicit(db),
                config.minimum_duration_comparator(db),
                config.minimum_duration_comparator_explicit(db),
                config.minimum_duration_disposition(db),
                config.minimum_duration_disposition_explicit(db),
                config.episode_reconstruction_strategy(db),
            );
            (episode_evidence, semantics_evidence)
        };
        let split = segment_concurrent_usage(db, raw, early, config, support)?;
        let split_payload = split.value.lease()?;
        super::super::attach_concurrent_subinterval_floor_evidence(
            &mut foundational_semantics_evidence,
            &split_payload,
            config.minimum_usage_duration(db),
            config.apply_minimum_usage_duration_to_concurrent_subintervals(db),
            true,
        );
        foundational_semantics_evidence.zero_duration_cleanup =
            annotated.zero_duration_cleanup.clone();
        let maximum_duration_evidence = super::super::maximum_duration_evidence_for_episode_evidence(
            &foundational_episode_evidence,
            &maximum_duration_request(db, config),
            config.episode_reconstruction_strategy(db),
            config.long_duration_threshold_ns(db),
        )?;
        let base = ReconstructionBase {
            protocol_version: RECONSTRUCTION_BASE_PROTOCOL.into(),
            input_key: reconstruction_base_input_key(db, raw, early, config, support)?,
            rows: split_payload.shared(),
            foundational_episode_evidence,
            foundational_semantics_binding: foundational_semantics_binding(db, config),
            opener_set_evidence,
            foundational_semantics_evidence,
            maximum_duration_evidence,
            eyes_tagged_fau_evidence,
            resolve_excluded_packages: junk.checkpoint.clone(),
            mask_excluded_app_events: blind.checkpoint.clone(),
            build_app_event_index: matcher_input.checkpoint.clone(),
            match_app_episodes: matcher.checkpoint.clone(),
            materialize_candidate_episodes: applied.checkpoint.clone(),
            segment_concurrent_usage: split.checkpoint.clone(),
            reconstruct_episodes: required_query_group_checkpoint(&split, "reconstruct_episodes")?,
            annotation_checkpoint,
            early_metadata,
            screen,
        };
        encode_reconstruction_base(&base)
    }
