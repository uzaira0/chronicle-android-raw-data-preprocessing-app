use super::{B05SchoedelValidationContext, EyesTaggedFauValidationContext};
use crate::pipeline_v2::{
    APP_USAGE, Arc, B05ComputationPhase, B05InputBoundary, B05OptionsDigestOrigin,
    B05PreflightError, B05PreflightIdentity, B05PreflightIdentityField, B05PreparedExecutionError,
    B05RouterOptionsIdentity, B05SchoedelPreflightResult, B05SchoedelPreparedInput,
    B05SchoedelValidationReceipt, B05SchoedelValidationStatus, B05ScreenOptionsIdentity,
    B05ScreenPreparedSubstrate, B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION,
    B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION, BTreeMap, BTreeSet,
    ConcurrentSubintervalFloorReceipt, Digest, EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION,
    EYES_TAGGED_FAU_VALIDATION_RECEIPT_PROTOCOL_VERSION, EpisodeReconstructionStrategy,
    EyesInputPartitionOptionsDigestOrigin, EyesInputPartitionOptionsIdentity,
    EyesInputPartitionPreflightError, EyesInputPartitionPreflightIdentity,
    EyesInputPartitionPreflightResult, EyesInputPartitionRefusalReason,
    EyesTaggedFauValidationReceipt, EyesTaggedFauValidationStatus,
    FOUNDATIONAL_SEMANTICS_CHECKPOINT, FoundationalEpisodeEvidence, FoundationalSemanticsEvidence,
    MicroUseClassification, MicroUseClassificationPolicy, MicroUseReceipt,
    MinimumDurationComparator, MinimumDurationDisposition, MinimumDurationExcludedEpisode,
    MinimumDurationReceipt, OKOSHI_MICRO_USE_THRESHOLD_NS, ParticipantInputBoundary,
    PipelineV2Options, PipelineV2Result, PipelineV2SupportFiles, RawRow, Row,
    SchoedelOptionsIdentity, SchoedelValidationWitness, ScientificPreflightDisposition,
    ScreenSessionConstructionStrategyId, Sha256, SourceDataRowRange, UsageSessionMode,
    ZERO_DURATION_CLEANUP_CHECKPOINT, ZeroDurationCleanupEvidence, ZeroDurationCleanupReceipt,
    ZeroDurationRemovedRow, b05, b06, checked_minimum_duration_threshold_ns,
    is_zero_duration_cleanup_candidate, minimum_duration_threshold_ns,
    parse_chronicle_timestamp_ns, source, validate_pipeline_v2_options,
};
#[cfg(test)]
use crate::pipeline_v2::{
    B05_PREPARE_DECODE_COUNT, B05_PREPARE_EVIDENCE_PARSE_COUNT, B05_SCREEN_CONSTRUCTION_COUNT,
};

pub(crate) fn canonicalize_foundational_episode_evidence(episodes: &mut [FoundationalEpisodeEvidence]) {
    episodes.sort_by(|left, right| {
        left.participant_id
            .cmp(&right.participant_id)
            .then(
                left.raw_start_timestamp_ns
                    .cmp(&right.raw_start_timestamp_ns),
            )
            .then(left.raw_stop_timestamp_ns.cmp(&right.raw_stop_timestamp_ns))
            .then(left.app_package_name.cmp(&right.app_package_name))
            .then_with(|| {
                left.source_data_row_ranges
                    .iter()
                    .map(|range| (range.first, range.last))
                    .cmp(
                        right
                            .source_data_row_ranges
                            .iter()
                            .map(|range| (range.first, range.last)),
                    )
            })
            .then(left.raw_duration_ns.cmp(&right.raw_duration_ns))
            .then(
                left.micro_use_classification
                    .map(MicroUseClassification::canonical_id)
                    .cmp(
                        &right
                            .micro_use_classification
                            .map(MicroUseClassification::canonical_id),
                    ),
            )
            .then(
                left.minimum_duration_qualified
                    .cmp(&right.minimum_duration_qualified),
            )
    });
}

pub(crate) fn zero_duration_cleanup_evidence(
    rows_at_cleanup_checkpoint: &[Row],
    requested_applied: bool,
    app_stage_executed: bool,
) -> ZeroDurationCleanupEvidence {
    let candidates = rows_at_cleanup_checkpoint
        .iter()
        .filter(|row| is_zero_duration_cleanup_candidate(row))
        .collect::<Vec<_>>();
    let effective_applied = requested_applied && app_stage_executed;
    let mut removed_rows = if effective_applied {
        candidates
            .iter()
            .map(|row| ZeroDurationRemovedRow {
                participant_id: row.participant_id.to_string(),
                app_package_name: row.app_package_name.to_string(),
                interaction_type: row.interaction_type.to_string(),
                source_data_row_ranges: row.source_data_rows.ranges().to_vec(),
                event_timestamp_ns: row.event_timestamp_ns,
                start_timestamp_ns: row.start_timestamp_ns,
                stop_timestamp_ns: row.stop_timestamp_ns,
                raw_episode_start_timestamp_ns: row.raw_episode_start_timestamp_ns,
                raw_episode_stop_timestamp_ns: row.raw_episode_stop_timestamp_ns,
                raw_episode_duration_ns: row.raw_episode_duration_ns,
                evidence_basis: if row.raw_episode_duration_ns == Some(0) {
                    "raw_episode_duration_ns".into()
                } else {
                    "legacy_public_duration_seconds".into()
                },
                usage_layer: row.usage_layer.as_ref().map(ToString::to_string),
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    canonicalize_zero_duration_removed_rows(&mut removed_rows);
    let removed_lineage_digest = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(
            serde_json::to_vec(&removed_rows).expect("zero-duration removed lineage serializes")
        ))
    );
    ZeroDurationCleanupEvidence {
        receipt: ZeroDurationCleanupReceipt {
            protocol_version: "chronicle-zero-duration-cleanup-receipt/v1".into(),
            requested_applied,
            effective_applied,
            checkpoint: ZERO_DURATION_CLEANUP_CHECKPOINT.into(),
            zero_episode_candidate_count: candidates.len() as u32,
            removed_row_count: removed_rows.len() as u32,
            removed_lineage_digest,
        },
        removed_rows,
    }
}

pub(crate) fn canonicalize_zero_duration_removed_rows(rows: &mut [ZeroDurationRemovedRow]) {
    rows.sort_by(|left, right| {
        left.participant_id
            .cmp(&right.participant_id)
            .then(left.event_timestamp_ns.cmp(&right.event_timestamp_ns))
            .then(left.start_timestamp_ns.cmp(&right.start_timestamp_ns))
            .then(left.stop_timestamp_ns.cmp(&right.stop_timestamp_ns))
            .then(left.app_package_name.cmp(&right.app_package_name))
            .then(left.interaction_type.cmp(&right.interaction_type))
            .then_with(|| {
                left.source_data_row_ranges
                    .iter()
                    .map(|range| (range.first, range.last))
                    .cmp(
                        right
                            .source_data_row_ranges
                            .iter()
                            .map(|range| (range.first, range.last)),
                    )
            })
            .then(
                left.raw_episode_start_timestamp_ns
                    .cmp(&right.raw_episode_start_timestamp_ns),
            )
            .then(
                left.raw_episode_stop_timestamp_ns
                    .cmp(&right.raw_episode_stop_timestamp_ns),
            )
            .then(
                left.raw_episode_duration_ns
                    .cmp(&right.raw_episode_duration_ns),
            )
            .then(left.evidence_basis.cmp(&right.evidence_basis))
            .then(left.usage_layer.cmp(&right.usage_layer))
    });
}

pub(crate) fn canonicalize_minimum_duration_excluded_episodes(
    episodes: &mut [MinimumDurationExcludedEpisode],
) {
    episodes.sort_by(|left, right| {
        left.participant_id
            .cmp(&right.participant_id)
            .then(
                left.raw_start_timestamp_ns
                    .cmp(&right.raw_start_timestamp_ns),
            )
            .then(left.raw_stop_timestamp_ns.cmp(&right.raw_stop_timestamp_ns))
            .then(left.app_package_name.cmp(&right.app_package_name))
            .then_with(|| {
                left.source_data_row_ranges
                    .iter()
                    .map(|range| (range.first, range.last))
                    .cmp(
                        right
                            .source_data_row_ranges
                            .iter()
                            .map(|range| (range.first, range.last)),
                    )
            })
            .then(left.raw_duration_ns.cmp(&right.raw_duration_ns))
            .then(left.reason.cmp(&right.reason))
            .then(
                left.disposition
                    .canonical_id()
                    .cmp(right.disposition.canonical_id()),
            )
    });
}

/// B06 receipt from the rows at the classification checkpoint (pre-inclusion,
/// so `drop_row` episodes are still present as `maximum_duration_drop_pending`).
pub(crate) fn maximum_duration_evidence_for_rows(
    rows_at_classification_checkpoint: &[Row],
    options: &PipelineV2Options,
) -> Result<Option<b06::MaximumDurationEvidence>, String> {
    let episodes = foundational_episode_evidence_from_rows(rows_at_classification_checkpoint);
    maximum_duration_evidence_for_episode_evidence(
        &episodes,
        &options.maximum_duration,
        options.episode_reconstruction_strategy,
        options.long_duration_threshold_ns,
    )
}

/// The same receipt from the immutable episode census; used by the persisted
/// reconstruction-base validator so a stored receipt is recomputed, never
/// trusted.
pub(crate) fn maximum_duration_evidence_for_episode_evidence(
    episodes: &[FoundationalEpisodeEvidence],
    request: &b06::MaximumDurationRequest,
    strategy: EpisodeReconstructionStrategy,
    long_duration_threshold_ns: i64,
) -> Result<Option<b06::MaximumDurationEvidence>, String> {
    let (config, applicability) =
        b06::resolve_maximum_duration(request, strategy, long_duration_threshold_ns)
            .map_err(|reason| format!("pipeline_options_invalid:{}", reason.error_token()))?;
    b06::build_evidence(
        episodes.iter().map(|episode| b06::MaximumDurationEpisodeInput {
            participant_id: &episode.participant_id,
            app_package_name: &episode.app_package_name,
            source_data_row_ranges: &episode.source_data_row_ranges,
            raw_start_timestamp_ns: episode.raw_start_timestamp_ns,
            raw_stop_timestamp_ns: episode.raw_stop_timestamp_ns,
            raw_duration_ns: episode.raw_duration_ns,
        }),
        &config,
        &applicability,
    )
}

pub(crate) fn attach_zero_duration_cleanup_evidence(
    evidence: &mut FoundationalSemanticsEvidence,
    rows_at_cleanup_checkpoint: &[Row],
    requested_applied: bool,
    app_stage_executed: bool,
) {
    evidence.zero_duration_cleanup = zero_duration_cleanup_evidence(
        rows_at_cleanup_checkpoint,
        requested_applied,
        app_stage_executed,
    );
}

pub(crate) fn foundational_semantics_evidence(
    rows_at_classification_checkpoint: &[Row],
    options: &PipelineV2Options,
) -> FoundationalSemanticsEvidence {
    foundational_semantics_evidence_for_policies(
        rows_at_classification_checkpoint,
        options.micro_use_classification_policy,
        options.micro_use_classification_policy_explicit,
        options.minimum_usage_duration,
        options.minimum_usage_duration_explicit,
        options.minimum_duration_comparator,
        options.minimum_duration_comparator_explicit,
        options.minimum_duration_disposition,
        options.minimum_duration_disposition_explicit,
        options.episode_reconstruction_strategy,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn foundational_semantics_evidence_for_policies(
    rows_at_classification_checkpoint: &[Row],
    micro_use_classification_policy: MicroUseClassificationPolicy,
    micro_use_classification_policy_explicit: bool,
    minimum_usage_duration: f64,
    minimum_usage_duration_explicit: bool,
    minimum_duration_comparator: MinimumDurationComparator,
    minimum_duration_comparator_explicit: bool,
    minimum_duration_disposition: MinimumDurationDisposition,
    minimum_duration_disposition_explicit: bool,
    episode_reconstruction_strategy: EpisodeReconstructionStrategy,
) -> FoundationalSemanticsEvidence {
    let episodes = foundational_episode_evidence_from_rows(rows_at_classification_checkpoint);
    foundational_semantics_evidence_for_episode_evidence(
        &episodes,
        micro_use_classification_policy,
        micro_use_classification_policy_explicit,
        minimum_usage_duration,
        minimum_usage_duration_explicit,
        minimum_duration_comparator,
        minimum_duration_comparator_explicit,
        minimum_duration_disposition,
        minimum_duration_disposition_explicit,
        episode_reconstruction_strategy,
    )
}

pub(crate) fn foundational_episode_evidence_from_rows(
    rows_at_classification_checkpoint: &[Row],
) -> Vec<FoundationalEpisodeEvidence> {
    rows_at_classification_checkpoint
        .iter()
        .filter_map(|row| {
            row.raw_episode_start_timestamp_ns
                .map(|raw_start_timestamp_ns| FoundationalEpisodeEvidence {
                    participant_id: row.participant_id.to_string(),
                    app_package_name: row.app_package_name.to_string(),
                    source_data_row_ranges: row.source_data_rows.ranges().to_vec(),
                    raw_start_timestamp_ns,
                    raw_stop_timestamp_ns: row.raw_episode_stop_timestamp_ns,
                    raw_duration_ns: row.raw_episode_duration_ns,
                    micro_use_classification: row.micro_use_classification,
                    minimum_duration_qualified: row.minimum_duration_qualified,
                })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn foundational_semantics_evidence_for_episode_evidence(
    episodes: &[FoundationalEpisodeEvidence],
    micro_use_classification_policy: MicroUseClassificationPolicy,
    micro_use_classification_policy_explicit: bool,
    minimum_usage_duration: f64,
    minimum_usage_duration_explicit: bool,
    minimum_duration_comparator: MinimumDurationComparator,
    minimum_duration_comparator_explicit: bool,
    minimum_duration_disposition: MinimumDurationDisposition,
    minimum_duration_disposition_explicit: bool,
    episode_reconstruction_strategy: EpisodeReconstructionStrategy,
) -> FoundationalSemanticsEvidence {
    let mut class_counts = BTreeMap::<String, u32>::new();
    let mut bounded_episode_count = 0_u32;
    let mut unbounded_episode_count = 0_u32;
    let mut qualifying_count = 0_u32;
    let mut retained_credited_count = 0_u32;
    let mut retained_excluded_count = 0_u32;
    let mut dropped_count = 0_u32;
    let mut excluded = Vec::new();

    for episode in episodes {
        match episode.micro_use_classification {
            Some(classification) => {
                *class_counts
                    .entry(classification.canonical_id().to_string())
                    .or_default() += 1;
            }
            None => {
                *class_counts
                    .entry(
                        MicroUseClassification::NotClassifiable
                            .canonical_id()
                            .into(),
                    )
                    .or_default() += 1;
            }
        }

        let (Some(raw_start), Some(raw_stop), Some(raw_duration)) = (
            Some(episode.raw_start_timestamp_ns),
            episode.raw_stop_timestamp_ns,
            episode.raw_duration_ns,
        ) else {
            unbounded_episode_count += 1;
            continue;
        };
        bounded_episode_count += 1;
        let qualifies = episode.minimum_duration_qualified.unwrap_or(false);
        if !qualifies {
            retained_credited_count += 1;
            continue;
        }
        qualifying_count += 1;
        let (reason, records_lineage) = match minimum_duration_disposition {
            MinimumDurationDisposition::ChronicleBlankKeepRow => {
                retained_excluded_count += 1;
                ("below_minimum_duration_blank_timing", true)
            }
            MinimumDurationDisposition::RetainAndCredit => {
                retained_credited_count += 1;
                ("below_minimum_duration_retained_and_credited", false)
            }
            MinimumDurationDisposition::RetainButExclude => {
                retained_excluded_count += 1;
                ("below_minimum_duration_headline_excluded", true)
            }
            MinimumDurationDisposition::DropRow => {
                dropped_count += 1;
                ("below_minimum_duration_drop_row", true)
            }
        };
        if records_lineage {
            excluded.push(MinimumDurationExcludedEpisode {
                participant_id: episode.participant_id.clone(),
                app_package_name: episode.app_package_name.clone(),
                source_data_row_ranges: episode.source_data_row_ranges.clone(),
                raw_start_timestamp_ns: raw_start,
                raw_stop_timestamp_ns: raw_stop,
                raw_duration_ns: raw_duration,
                reason: reason.into(),
                disposition: minimum_duration_disposition,
            });
        }
    }
    canonicalize_minimum_duration_excluded_episodes(&mut excluded);
    let excluded_lineage_digest = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(
            serde_json::to_vec(&excluded).expect("B04 excluded lineage serializes")
        ))
    );
    let (relation, source_id, comparator, threshold_ns) = match micro_use_classification_policy {
        MicroUseClassificationPolicy::None => (
            if micro_use_classification_policy_explicit {
                "baseline_equivalent"
            } else {
                "baseline_native"
            },
            None,
            None,
            None,
        ),
        MicroUseClassificationPolicy::OkoshiLt5s => (
            if episode_reconstruction_strategy
                == EpisodeReconstructionStrategy::ForegroundBackgroundPairing
            {
                "source_aligned_adapter"
            } else {
                "controlled_derivative"
            },
            Some("okoshi_cyberoception_2025_arxiv_2504.16378v1".to_string()),
            Some("strict_lt".to_string()),
            Some(OKOSHI_MICRO_USE_THRESHOLD_NS),
        ),
    };
    let minimum_threshold_ns = minimum_duration_threshold_ns(minimum_usage_duration).unwrap_or(0);
    let b04_is_native_vector = minimum_threshold_ns == 60_000_000_000
        && minimum_duration_comparator == MinimumDurationComparator::StrictLt
        && minimum_duration_disposition == MinimumDurationDisposition::ChronicleBlankKeepRow;
    let b04_any_field_explicit = minimum_usage_duration_explicit
        || minimum_duration_comparator_explicit
        || minimum_duration_disposition_explicit;
    let b04_relation = if !b04_is_native_vector {
        "controlled_derivative"
    } else if b04_any_field_explicit {
        "baseline_equivalent"
    } else {
        "baseline_native"
    };
    FoundationalSemanticsEvidence {
        micro_use: MicroUseReceipt {
            protocol_version: "chronicle-micro-use-receipt/v2".into(),
            requested_policy: micro_use_classification_policy,
            effective_policy: micro_use_classification_policy,
            relation: relation.into(),
            source_id,
            comparator,
            threshold_ns,
            checkpoint: FOUNDATIONAL_SEMANTICS_CHECKPOINT.into(),
            class_counts,
        },
        minimum_duration: MinimumDurationReceipt {
            protocol_version: "chronicle-minimum-duration-receipt/v2".into(),
            relation: b04_relation.into(),
            requested_comparator: minimum_duration_comparator,
            effective_comparator: minimum_duration_comparator,
            threshold_ns: minimum_threshold_ns,
            requested_disposition: minimum_duration_disposition,
            effective_disposition: minimum_duration_disposition,
            checkpoint: FOUNDATIONAL_SEMANTICS_CHECKPOINT.into(),
            bounded_episode_count,
            unbounded_episode_count,
            qualifying_count,
            retained_credited_count,
            retained_excluded_count,
            dropped_count,
            excluded_lineage_digest,
        },
        concurrent_subinterval_floor: ConcurrentSubintervalFloorReceipt {
            protocol_version: "chronicle-concurrent-subinterval-floor-receipt/v1".into(),
            requested_applied: false,
            effective_applied: false,
            comparator: "strict_lt".into(),
            threshold_ns: minimum_threshold_ns,
            checkpoint: "concurrent_subinterval_post_segmentation".into(),
            generated_subinterval_count: 0,
            blanked_subinterval_count: 0,
        },
        zero_duration_cleanup: zero_duration_cleanup_evidence(&[], false, false),
        minimum_duration_excluded_episodes: excluded,
    }
}

pub(crate) fn attach_concurrent_subinterval_floor_evidence(
    evidence: &mut FoundationalSemanticsEvidence,
    segmented_rows: &[Row],
    minimum_usage_duration: f64,
    requested_applied: bool,
    app_stage_executed: bool,
) {
    let generated_subinterval_count = segmented_rows
        .iter()
        .filter(|row| row.usage_layer.is_some())
        .count() as u32;
    let blanked_subinterval_count = segmented_rows
        .iter()
        .filter(|row| row.concurrent_subinterval_floor_blank_applied)
        .count() as u32;
    evidence.concurrent_subinterval_floor = ConcurrentSubintervalFloorReceipt {
        protocol_version: "chronicle-concurrent-subinterval-floor-receipt/v1".into(),
        requested_applied,
        effective_applied: app_stage_executed
            && requested_applied
            && minimum_duration_threshold_ns(minimum_usage_duration).is_some(),
        comparator: "strict_lt".into(),
        threshold_ns: minimum_duration_threshold_ns(minimum_usage_duration).unwrap_or(0),
        checkpoint: "concurrent_subinterval_post_segmentation".into(),
        generated_subinterval_count,
        blanked_subinterval_count,
    };
}

/// Canonical artifact bytes for B04 destructive-exclusion evidence. Runtime
/// publication must use this exact bare array, never a wrapper object.
pub fn minimum_duration_excluded_lineage_bytes(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&evidence.minimum_duration_excluded_episodes)
        .map_err(|error| format!("serialize B04 excluded lineage: {error}"))
}

/// Fail closed if a receipt and its canonical excluded-lineage artifact have
/// diverged. This is shared by later runtime/semantic publication work.
pub fn validate_minimum_duration_excluded_lineage(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<(), String> {
    let mut canonical = evidence.minimum_duration_excluded_episodes.clone();
    canonicalize_minimum_duration_excluded_episodes(&mut canonical);
    if canonical != evidence.minimum_duration_excluded_episodes {
        return Err("minimum_duration_excluded_lineage_noncanonical_order".into());
    }
    let bytes = minimum_duration_excluded_lineage_bytes(evidence)?;
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&bytes)));
    if digest != evidence.minimum_duration.excluded_lineage_digest {
        return Err("minimum_duration_excluded_lineage_digest_mismatch".into());
    }
    Ok(())
}

pub(crate) fn validate_minimum_duration_receipt_shape(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<(), String> {
    let receipt = &evidence.minimum_duration;
    if receipt.protocol_version != "chronicle-minimum-duration-receipt/v2"
        || receipt.checkpoint != FOUNDATIONAL_SEMANTICS_CHECKPOINT
        || receipt.requested_comparator != receipt.effective_comparator
        || receipt.requested_disposition != receipt.effective_disposition
    {
        return Err("minimum_duration_receipt_shape_mismatch".into());
    }
    let bounded_total = receipt
        .bounded_episode_count
        .checked_add(receipt.unbounded_episode_count)
        .ok_or_else(|| "minimum_duration_receipt_count_overflow".to_string())?;
    let disposition_total = receipt
        .retained_credited_count
        .checked_add(receipt.retained_excluded_count)
        .and_then(|value| value.checked_add(receipt.dropped_count))
        .ok_or_else(|| "minimum_duration_receipt_count_overflow".to_string())?;
    let micro_total = evidence
        .micro_use
        .class_counts
        .values()
        .try_fold(0_u32, |total, count| total.checked_add(*count))
        .ok_or_else(|| "micro_use_receipt_count_overflow".to_string())?;
    if disposition_total != receipt.bounded_episode_count
        || receipt.qualifying_count > receipt.bounded_episode_count
        || receipt.dropped_count
            != evidence
                .minimum_duration_excluded_episodes
                .iter()
                .filter(|episode| episode.disposition == MinimumDurationDisposition::DropRow)
                .count() as u32
        || bounded_total != micro_total
    {
        return Err("minimum_duration_receipt_count_mismatch".into());
    }
    Ok(())
}

pub(crate) fn validate_micro_use_receipt_shape(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<(), String> {
    let receipt = &evidence.micro_use;
    if receipt.protocol_version != "chronicle-micro-use-receipt/v2"
        || receipt.checkpoint != FOUNDATIONAL_SEMANTICS_CHECKPOINT
        || receipt.requested_policy != receipt.effective_policy
    {
        return Err("micro_use_receipt_shape_mismatch".into());
    }
    Ok(())
}

/// Validate the complete B03/B04 and independently controlled cleanup
/// evidence against the exact request vector that produced it.  Runtime and
/// semantic publication deliberately call this kernel-owned validator rather
/// than reconstructing scientific rules at a transport boundary.
pub fn validate_foundational_semantics_evidence_for_options(
    evidence: &FoundationalSemanticsEvidence,
    options: &PipelineV2Options,
) -> Result<(), String> {
    validate_pipeline_v2_options(options).map_err(|error| error.to_string())?;
    validate_micro_use_receipt_shape(evidence)?;
    validate_minimum_duration_receipt_shape(evidence)?;
    validate_minimum_duration_excluded_lineage(evidence)?;
    validate_zero_duration_cleanup_evidence(&evidence.zero_duration_cleanup)?;

    let app_stage_executed = matches!(
        options.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    );
    let expected_micro_relation = match options.micro_use_classification_policy {
        MicroUseClassificationPolicy::None => {
            if options.micro_use_classification_policy_explicit {
                "baseline_equivalent"
            } else {
                "baseline_native"
            }
        }
        MicroUseClassificationPolicy::OkoshiLt5s => {
            if options.episode_reconstruction_strategy
                == EpisodeReconstructionStrategy::ForegroundBackgroundPairing
            {
                "source_aligned_adapter"
            } else {
                "controlled_derivative"
            }
        }
    };
    let expected_micro_source = (options.micro_use_classification_policy
        == MicroUseClassificationPolicy::OkoshiLt5s)
        .then_some("okoshi_cyberoception_2025_arxiv_2504.16378v1");
    let expected_micro_comparator = (options.micro_use_classification_policy
        == MicroUseClassificationPolicy::OkoshiLt5s)
        .then_some("strict_lt");
    let expected_micro_threshold = (options.micro_use_classification_policy
        == MicroUseClassificationPolicy::OkoshiLt5s)
        .then_some(OKOSHI_MICRO_USE_THRESHOLD_NS);
    let micro = &evidence.micro_use;
    if micro.requested_policy != options.micro_use_classification_policy
        || micro.effective_policy != options.micro_use_classification_policy
        || micro.relation != expected_micro_relation
        || micro.source_id.as_deref() != expected_micro_source
        || micro.comparator.as_deref() != expected_micro_comparator
        || micro.threshold_ns != expected_micro_threshold
    {
        return Err("micro_use_receipt_options_mismatch".into());
    }
    let allowed_micro_classes = ["micro_use", "not_micro_use", "not_classifiable"]
        .into_iter()
        .collect::<BTreeSet<_>>();
    if micro
        .class_counts
        .keys()
        .any(|key| !allowed_micro_classes.contains(key.as_str()))
    {
        return Err("micro_use_receipt_unknown_class_key".into());
    }
    if options.micro_use_classification_policy == MicroUseClassificationPolicy::None
        && micro
            .class_counts
            .iter()
            .any(|(key, count)| key != "not_classifiable" && *count != 0)
    {
        return Err("micro_use_none_policy_classified_episode".into());
    }
    let micro_episode_count = micro
        .class_counts
        .values()
        .try_fold(0_u32, |total, count| total.checked_add(*count))
        .ok_or_else(|| "micro_use_receipt_count_overflow".to_string())?;

    let expected_minimum_threshold =
        checked_minimum_duration_threshold_ns(options.minimum_usage_duration)
            .map_err(|error| error.to_string())?
            .unwrap_or(0);
    let native_minimum_vector = expected_minimum_threshold == 60_000_000_000
        && options.minimum_duration_comparator == MinimumDurationComparator::StrictLt
        && options.minimum_duration_disposition
            == MinimumDurationDisposition::ChronicleBlankKeepRow;
    let any_minimum_field_explicit = options.minimum_usage_duration_explicit
        || options.minimum_duration_comparator_explicit
        || options.minimum_duration_disposition_explicit;
    let expected_minimum_relation = if !native_minimum_vector {
        "controlled_derivative"
    } else if any_minimum_field_explicit {
        "baseline_equivalent"
    } else {
        "baseline_native"
    };
    let minimum = &evidence.minimum_duration;
    if minimum.relation != expected_minimum_relation
        || minimum.requested_comparator != options.minimum_duration_comparator
        || minimum.effective_comparator != options.minimum_duration_comparator
        || minimum.threshold_ns != expected_minimum_threshold
        || minimum.requested_disposition != options.minimum_duration_disposition
        || minimum.effective_disposition != options.minimum_duration_disposition
    {
        return Err("minimum_duration_receipt_options_mismatch".into());
    }
    let total_episode_count = minimum
        .bounded_episode_count
        .checked_add(minimum.unbounded_episode_count)
        .ok_or_else(|| "minimum_duration_receipt_count_overflow".to_string())?;
    if total_episode_count != micro_episode_count {
        return Err("foundational_semantics_episode_count_mismatch".into());
    }
    if expected_minimum_threshold == 0 && minimum.qualifying_count != 0 {
        return Err("minimum_duration_disabled_with_qualifying_episodes".into());
    }
    let nonqualifying_bounded = minimum
        .bounded_episode_count
        .checked_sub(minimum.qualifying_count)
        .ok_or_else(|| "minimum_duration_receipt_count_mismatch".to_string())?;
    let (expected_credited, expected_excluded, expected_dropped, expected_lineage_count) =
        match options.minimum_duration_disposition {
            MinimumDurationDisposition::ChronicleBlankKeepRow
            | MinimumDurationDisposition::RetainButExclude => (
                nonqualifying_bounded,
                minimum.qualifying_count,
                0,
                minimum.qualifying_count,
            ),
            MinimumDurationDisposition::RetainAndCredit => (minimum.bounded_episode_count, 0, 0, 0),
            MinimumDurationDisposition::DropRow => (
                nonqualifying_bounded,
                0,
                minimum.qualifying_count,
                minimum.qualifying_count,
            ),
        };
    if minimum.retained_credited_count != expected_credited
        || minimum.retained_excluded_count != expected_excluded
        || minimum.dropped_count != expected_dropped
        || evidence.minimum_duration_excluded_episodes.len() as u32 != expected_lineage_count
    {
        return Err("minimum_duration_receipt_disposition_count_mismatch".into());
    }
    let expected_reason = match options.minimum_duration_disposition {
        MinimumDurationDisposition::ChronicleBlankKeepRow => {
            Some("below_minimum_duration_blank_timing")
        }
        MinimumDurationDisposition::RetainAndCredit => None,
        MinimumDurationDisposition::RetainButExclude => {
            Some("below_minimum_duration_headline_excluded")
        }
        MinimumDurationDisposition::DropRow => Some("below_minimum_duration_drop_row"),
    };
    if evidence
        .minimum_duration_excluded_episodes
        .iter()
        .any(|episode| {
            let valid_ranges = !episode.source_data_row_ranges.is_empty()
                && episode
                    .source_data_row_ranges
                    .iter()
                    .all(|range| range.first > 0 && range.first <= range.last)
                && episode
                    .source_data_row_ranges
                    .windows(2)
                    .all(|pair| pair[0].last < pair[1].first);
            let valid_timing = episode.raw_stop_timestamp_ns >= episode.raw_start_timestamp_ns
                && episode
                    .raw_stop_timestamp_ns
                    .checked_sub(episode.raw_start_timestamp_ns)
                    == Some(episode.raw_duration_ns)
                && episode.raw_duration_ns >= 0;
            episode.disposition != options.minimum_duration_disposition
                || Some(episode.reason.as_str()) != expected_reason
                || !valid_ranges
                || !valid_timing
                || !options
                    .minimum_duration_comparator
                    .qualifies(episode.raw_duration_ns, expected_minimum_threshold)
        })
    {
        return Err("minimum_duration_excluded_lineage_semantics_mismatch".into());
    }
    let mut excluded_identities = BTreeSet::new();
    for episode in &evidence.minimum_duration_excluded_episodes {
        let identity = serde_json::to_string(episode)
            .map_err(|error| format!("serialize B04 excluded identity: {error}"))?;
        if !excluded_identities.insert(identity) {
            return Err("minimum_duration_excluded_lineage_duplicate_identity".into());
        }
    }

    let concurrent = &evidence.concurrent_subinterval_floor;
    let expected_concurrent_effective = app_stage_executed
        && options.apply_minimum_usage_duration_to_concurrent_subintervals
        && expected_minimum_threshold > 0;
    if concurrent.protocol_version != "chronicle-concurrent-subinterval-floor-receipt/v1"
        || concurrent.requested_applied
            != options.apply_minimum_usage_duration_to_concurrent_subintervals
        || concurrent.effective_applied != expected_concurrent_effective
        || concurrent.comparator != "strict_lt"
        || concurrent.threshold_ns != expected_minimum_threshold
        || concurrent.checkpoint != "concurrent_subinterval_post_segmentation"
        || concurrent.blanked_subinterval_count > concurrent.generated_subinterval_count
        || (!concurrent.effective_applied && concurrent.blanked_subinterval_count != 0)
    {
        return Err("concurrent_subinterval_floor_receipt_mismatch".into());
    }

    let zero = &evidence.zero_duration_cleanup.receipt;
    let expected_zero_effective = app_stage_executed && options.filter_zero_duration_sessions;
    if zero.requested_applied != options.filter_zero_duration_sessions
        || zero.effective_applied != expected_zero_effective
    {
        return Err("zero_duration_cleanup_options_mismatch".into());
    }
    if !app_stage_executed
        && (micro_episode_count != 0
            || minimum.bounded_episode_count != 0
            || minimum.unbounded_episode_count != 0
            || minimum.qualifying_count != 0
            || minimum.retained_credited_count != 0
            || minimum.retained_excluded_count != 0
            || minimum.dropped_count != 0
            || !evidence.minimum_duration_excluded_episodes.is_empty()
            || concurrent.generated_subinterval_count != 0
            || concurrent.blanked_subinterval_count != 0
            || zero.zero_episode_candidate_count != 0
            || zero.removed_row_count != 0
            || !evidence.zero_duration_cleanup.removed_rows.is_empty())
    {
        return Err("foundational_semantics_no_app_stage_nonempty".into());
    }
    Ok(())
}

pub(crate) fn validate_foundational_semantics_source_ranges_with_bound(
    evidence: &FoundationalSemanticsEvidence,
    decoded_input_row_count: u64,
) -> Result<(), String> {
    let valid_ranges = |ranges: &[SourceDataRowRange]| {
        !ranges.is_empty()
            && ranges.iter().all(|range| {
                range.first > 0
                    && range.first <= range.last
                    && u64::from(range.last) <= decoded_input_row_count
            })
            && ranges.windows(2).all(|pair| pair[0].last < pair[1].first)
    };
    if evidence
        .minimum_duration_excluded_episodes
        .iter()
        .any(|episode| !valid_ranges(&episode.source_data_row_ranges))
        || evidence
            .zero_duration_cleanup
            .removed_rows
            .iter()
            .any(|row| !valid_ranges(&row.source_data_row_ranges))
    {
        return Err("foundational_semantics_source_lineage_out_of_bounds".into());
    }
    Ok(())
}

/// Fail closed if exact-zero cleanup receipt identity diverges from its
/// canonical, sorted removed-row lineage.  The empty lineage intentionally
/// hashes the bare JSON array `[]`.
pub fn validate_zero_duration_cleanup_lineage(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<(), String> {
    validate_zero_duration_cleanup_evidence(&evidence.zero_duration_cleanup)
}

/// Canonical artifact bytes for exact-zero removed-row lineage. Runtime must
/// publish this bare array only when it is nonempty; the receipt always binds
/// the digest of these exact bytes, including the canonical empty `[]` case.
pub fn zero_duration_removed_lineage_bytes(
    evidence: &FoundationalSemanticsEvidence,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&evidence.zero_duration_cleanup.removed_rows)
        .map_err(|error| format!("serialize zero-duration cleanup lineage: {error}"))
}

pub fn validate_zero_duration_cleanup_evidence(
    cleanup: &ZeroDurationCleanupEvidence,
) -> Result<(), String> {
    let receipt = &cleanup.receipt;
    let removed_rows = &cleanup.removed_rows;
    if receipt.protocol_version != "chronicle-zero-duration-cleanup-receipt/v1" {
        return Err("zero_duration_cleanup_protocol_mismatch".into());
    }
    if receipt.checkpoint != ZERO_DURATION_CLEANUP_CHECKPOINT {
        return Err("zero_duration_cleanup_checkpoint_mismatch".into());
    }
    if receipt.removed_row_count != removed_rows.len() as u32 {
        return Err("zero_duration_cleanup_removed_count_mismatch".into());
    }
    if receipt.effective_applied != (receipt.requested_applied && receipt.effective_applied) {
        return Err("zero_duration_cleanup_effective_without_request".into());
    }
    if !receipt.effective_applied && !removed_rows.is_empty() {
        return Err("zero_duration_cleanup_inactive_with_removed_rows".into());
    }
    if receipt.effective_applied
        && receipt.zero_episode_candidate_count != receipt.removed_row_count
    {
        return Err("zero_duration_cleanup_candidate_removed_count_mismatch".into());
    }
    if removed_rows.iter().any(|row| {
        !matches!(
            (row.evidence_basis.as_str(), row.raw_episode_duration_ns),
            ("raw_episode_duration_ns", Some(0)) | ("legacy_public_duration_seconds", None)
        ) || (row.evidence_basis == "legacy_public_duration_seconds"
            && row.interaction_type != APP_USAGE)
    }) {
        return Err("zero_duration_cleanup_nonzero_removed_identity".into());
    }
    let mut canonical = removed_rows.clone();
    canonicalize_zero_duration_removed_rows(&mut canonical);
    if canonical != *removed_rows {
        return Err("zero_duration_cleanup_noncanonical_lineage_order".into());
    }
    let bytes = serde_json::to_vec(removed_rows)
        .map_err(|error| format!("serialize zero-duration cleanup lineage: {error}"))?;
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&bytes)));
    if digest != receipt.removed_lineage_digest {
        return Err("zero_duration_cleanup_lineage_digest_mismatch".into());
    }
    Ok(())
}

/// Validate the private producer marker and return the exact PHI-free receipt
/// runtime may publish. Deserialized or otherwise unvalidated results fail
/// closed because their skipped context contains the invalid sentinel.
pub fn validated_b05_schoedel_receipt(
    result: &PipelineV2Result,
    options: &PipelineV2Options,
    expected_verified_raw_input_digest: &str,
    expected_options_digest: &str,
    expected_options_digest_origin: B05OptionsDigestOrigin,
) -> Result<B05SchoedelValidationReceipt, String> {
    let receipt = &result.b05_schoedel_validation_context.receipt;
    if receipt.status == B05SchoedelValidationStatus::InvalidUnvalidated {
        return Err("b05_schoedel_validation_error:unvalidated_result_sentinel".into());
    }
    if receipt.verified_raw_input_digest != expected_verified_raw_input_digest
        || receipt.request_options_digest != expected_options_digest
        || receipt.options_digest_origin != expected_options_digest_origin
        || result
            .b05_schoedel_validation_context
            .expected_options_digest
            != expected_options_digest
        || result
            .b05_schoedel_validation_context
            .expected_options_digest_origin
            != expected_options_digest_origin
        || result.b05_schoedel_preflight.options_digest
            != result
                .b05_schoedel_validation_context
                .expected_options_digest
        || result.b05_schoedel_preflight.options_digest_origin
            != result
                .b05_schoedel_validation_context
                .expected_options_digest_origin
        || result
            .b05_schoedel_validation_context
            .result_original_row_count
            != result.original_row_count
        || u64::from(result.original_row_count) > receipt.decoded_input_row_count
    {
        return Err("b05_schoedel_validation_error:result_context_mismatch".into());
    }
    validate_finalized_b05_schoedel_preflight_identity(
        &result.b05_schoedel_preflight,
        options,
        expected_options_digest,
        expected_options_digest_origin,
    )?;
    validate_foundational_semantics_evidence_for_options(
        &result.foundational_semantics_evidence,
        options,
    )?;
    let foundational_digest = sha256_jcs(
        &result.foundational_semantics_evidence,
        "serialize foundational semantics evidence",
    )?;
    if foundational_digest
        != result
            .b05_schoedel_validation_context
            .foundational_semantics_evidence_jcs_digest
        || foundational_digest != receipt.foundational_semantics_evidence_jcs_digest
    {
        return Err("b05_schoedel_validation_error:foundational_evidence_mismatch".into());
    }
    let decoded_row_count = receipt.decoded_input_row_count;
    let valid_ranges = |ranges: &[SourceDataRowRange]| {
        !ranges.is_empty()
            && ranges.iter().all(|range| {
                range.first > 0
                    && range.first <= range.last
                    && u64::from(range.last) <= decoded_row_count
            })
            && ranges.windows(2).all(|pair| pair[0].last < pair[1].first)
    };
    validate_foundational_semantics_source_ranges_with_bound(
        &result.foundational_semantics_evidence,
        decoded_row_count,
    )?;
    if result.row_lineage.iter().any(|lineage| {
        !lineage.source_data_row_ranges.is_empty() && !valid_ranges(&lineage.source_data_row_ranges)
    }) {
        return Err("b05_schoedel_validation_error:result_lineage_out_of_bounds".into());
    }
    for lineage in result.row_lineage.iter() {
        let exact_count = lineage
            .source_data_row_ranges
            .iter()
            .try_fold(0_u32, |count, range| {
                range
                    .last
                    .checked_sub(range.first)
                    .and_then(|span| span.checked_add(1))
                    .and_then(|range_count| count.checked_add(range_count))
            })
            .ok_or_else(|| {
                "b05_schoedel_validation_error:result_lineage_count_overflow".to_string()
            })?;
        if exact_count != lineage.source_data_row_count {
            return Err("b05_schoedel_validation_error:result_lineage_count_mismatch".into());
        }
    }
    validate_b05_schoedel_validation_receipt_integrity(
        receipt,
        &result.b05_schoedel_preflight,
        &result.foundational_semantics_evidence,
        options,
    )?;
    Ok(receipt.clone())
}

pub(crate) fn sha256_jcs<T: serde::Serialize>(value: &T, label: &str) -> Result<String, String> {
    let bytes = crate::jcs::to_vec(value).map_err(|error| format!("{label}: {error}"))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

pub(crate) fn b05_schoedel_validation_digest(
    receipt: &B05SchoedelValidationReceipt,
) -> Result<String, String> {
    let mut unsigned = receipt.clone();
    unsigned.validation_digest.clear();
    sha256_jcs(&unsigned, "serialize B05/Schoedel validation receipt")
}

pub(crate) fn requires_b05_screen_validation(options: &PipelineV2Options) -> bool {
    b05_schoedel_is_active(options)
}

pub(crate) fn requires_schoedel_validation(options: &PipelineV2Options) -> bool {
    matches!(
        options.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    ) && options.episode_reconstruction_strategy
        == EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1
}

pub(crate) fn validate_finalized_b05_schoedel_preflight_identity(
    preflight: &B05SchoedelPreflightResult,
    options: &PipelineV2Options,
    expected_options_digest: &str,
    expected_options_digest_origin: B05OptionsDigestOrigin,
) -> Result<(), String> {
    let screen_required = requires_b05_screen_validation(options);
    let schoedel_required = requires_schoedel_validation(options);
    let router_digest = b05_router_options_digest(options);
    if preflight.protocol_version != B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION
        || preflight.component_options_digest != router_digest
        || preflight.screen_component_options_digest != b05_screen_options_digest(options)
        || preflight.schoedel_component_options_digest != schoedel_options_digest(options)
        || preflight.requested_screen_strategy_id != options.screen_session_construction_strategy
        || preflight.effective_screen_strategy_id != options.screen_session_construction_strategy
        || preflight.requested_episode_strategy_id
            != options.episode_reconstruction_strategy.canonical_id()
        || preflight.options_digest != expected_options_digest
        || preflight.options_digest_origin != expected_options_digest_origin
        || preflight.effective_episode_strategy_id.as_deref()
            != schoedel_required.then_some(options.episode_reconstruction_strategy.canonical_id())
    {
        return Err("b05_schoedel_validation_error:preflight_identity_mismatch".into());
    }
    match preflight.options_digest_origin {
        B05OptionsDigestOrigin::VerifiedRequestJcs => {
            if !valid_sha256_wire(&preflight.options_digest) {
                return Err("b05_schoedel_validation_error:verified_options_digest_invalid".into());
            }
        }
        B05OptionsDigestOrigin::KernelRouterComponent => {
            if preflight.options_digest != router_digest {
                return Err(
                    "b05_schoedel_validation_error:component_options_digest_mismatch".into(),
                );
            }
        }
    }
    let expected_disposition = if screen_required {
        ScientificPreflightDisposition::Executable
    } else {
        ScientificPreflightDisposition::NotApplicable
    };
    let expected_screen_phase = if screen_required {
        B05ComputationPhase::Finalized
    } else {
        B05ComputationPhase::NotApplicable
    };
    let expected_schoedel_phase = if schoedel_required {
        B05ComputationPhase::Finalized
    } else {
        B05ComputationPhase::NotApplicable
    };
    if preflight.disposition != expected_disposition
        || preflight.screen_construction_phase != expected_screen_phase
        || preflight.schoedel_reconstruction_phase != expected_schoedel_phase
        || preflight.screen_construction.is_some() != screen_required
        || preflight.schoedel_reconstruction.is_some() != schoedel_required
    {
        return Err("b05_schoedel_validation_error:preflight_phase_mismatch".into());
    }
    if let Some(screen) = preflight.screen_construction.as_ref() {
        let expected_relation = match options.screen_session_construction_strategy {
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => {
                if options.screen_session_construction_strategy_explicit {
                    b05::ScientificRelation::BaselineEquivalent
                } else {
                    b05::ScientificRelation::BaselineNative
                }
            }
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1
            | ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1
            | ScreenSessionConstructionStrategyId::UnlockToLockV1
            | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
                b05::ScientificRelation::SourceAlignedAdapter
            }
        };
        if screen.applicability.options_digest != preflight.options_digest
            || screen.applicability.relation != expected_relation
        {
            return Err("b05_schoedel_validation_error:screen_options_relation_mismatch".into());
        }
    }
    Ok(())
}

pub(crate) fn build_b05_schoedel_validation_receipt(
    preflight: &B05SchoedelPreflightResult,
    foundational_evidence: &FoundationalSemanticsEvidence,
    options: &PipelineV2Options,
    verified_raw_input_digest: &str,
    decoded_input_row_count: u64,
    schoedel_witness: Option<&SchoedelValidationWitness>,
) -> Result<B05SchoedelValidationReceipt, String> {
    if !valid_sha256_wire(verified_raw_input_digest) {
        return Err("b05_schoedel_validation_error:invalid_raw_input_digest".into());
    }
    validate_finalized_b05_schoedel_preflight_identity(
        preflight,
        options,
        &preflight.options_digest,
        preflight.options_digest_origin,
    )?;
    validate_foundational_semantics_evidence_for_options(foundational_evidence, options)?;
    validate_foundational_semantics_source_ranges_with_bound(
        foundational_evidence,
        decoded_input_row_count,
    )?;
    let foundational_semantics_evidence_jcs_digest = sha256_jcs(
        foundational_evidence,
        "serialize foundational semantics evidence",
    )?;
    let foundational_episode_count = foundational_evidence
        .micro_use
        .class_counts
        .values()
        .try_fold(0_u32, |count, value| count.checked_add(*value))
        .ok_or_else(|| {
            "b05_schoedel_validation_error:foundational_episode_count_overflow".to_string()
        })?;
    let minimum_duration_excluded_episode_count = u32::try_from(
        foundational_evidence
            .minimum_duration_excluded_episodes
            .len(),
    )
    .map_err(|_| "b05_schoedel_validation_error:excluded_episode_count_overflow".to_string())?;
    let zero_duration_removed_row_count = u32::try_from(
        foundational_evidence
            .zero_duration_cleanup
            .removed_rows
            .len(),
    )
    .map_err(|_| "b05_schoedel_validation_error:zero_removed_count_overflow".to_string())?;
    // The screen output's digest hashes its own bytes inside the preflight's
    // JCS instead of serializing it a second time.
    let (preflight_jcs, screen_jcs_range) =
        crate::jcs::to_vec_capturing(preflight, "screenConstruction")
            .map_err(|error| format!("serialize finalized B05/Schoedel preflight: {error}"))?;
    let finalized_preflight_jcs_digest = sha256_wire(&preflight_jcs);
    let screen_required = requires_b05_screen_validation(options);
    let schoedel_required = requires_schoedel_validation(options);
    if !screen_required {
        if preflight.disposition != ScientificPreflightDisposition::NotApplicable
            || preflight.screen_construction_phase != B05ComputationPhase::NotApplicable
            || preflight.schoedel_reconstruction_phase != B05ComputationPhase::NotApplicable
            || preflight.screen_construction.is_some()
            || preflight.schoedel_reconstruction.is_some()
            || schoedel_witness.is_some()
        {
            return Err("b05_schoedel_validation_error:inactive_evidence_present".into());
        }
        let mut receipt = B05SchoedelValidationReceipt {
            protocol_version: B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION.into(),
            status: B05SchoedelValidationStatus::NotApplicable,
            verified_raw_input_digest: verified_raw_input_digest.into(),
            decoded_input_row_count,
            request_options_digest: preflight.options_digest.clone(),
            options_digest_origin: preflight.options_digest_origin,
            router_component_options_digest: preflight.component_options_digest.clone(),
            screen_component_options_digest: preflight.screen_component_options_digest.clone(),
            schoedel_component_options_digest: preflight.schoedel_component_options_digest.clone(),
            foundational_semantics_evidence_jcs_digest: foundational_semantics_evidence_jcs_digest
                .clone(),
            foundational_episode_count,
            foundational_bounded_episode_count: foundational_evidence
                .minimum_duration
                .bounded_episode_count,
            foundational_unbounded_episode_count: foundational_evidence
                .minimum_duration
                .unbounded_episode_count,
            minimum_duration_excluded_episode_count,
            concurrent_generated_subinterval_count: foundational_evidence
                .concurrent_subinterval_floor
                .generated_subinterval_count,
            zero_duration_removed_row_count,
            finalized_preflight_jcs_digest,
            selected_b05_strategy_id: options.screen_session_construction_strategy,
            ..B05SchoedelValidationReceipt::default()
        };
        receipt.validation_digest = b05_schoedel_validation_digest(&receipt)?;
        return Ok(receipt);
    }
    if preflight.disposition != ScientificPreflightDisposition::Executable
        || preflight.screen_construction_phase != B05ComputationPhase::Finalized
        || preflight.requested_screen_strategy_id != options.screen_session_construction_strategy
        || preflight.effective_screen_strategy_id != options.screen_session_construction_strategy
    {
        return Err("b05_schoedel_validation_error:screen_preflight_not_finalized".into());
    }
    let screen = preflight
        .screen_construction
        .as_ref()
        .ok_or_else(|| "b05_schoedel_validation_error:screen_output_missing".to_string())?;
    b05::validate_screen_construction_output(
        screen,
        verified_raw_input_digest,
        options.screen_session_construction_strategy,
        decoded_input_row_count,
    )
    .map_err(str::to_owned)?;
    let screen_receipt = screen
        .construction_receipt
        .as_ref()
        .ok_or_else(|| "b05_schoedel_validation_error:screen_receipt_missing".to_string())?;
    let screen_output_digest = match screen_jcs_range {
        Some(range) => sha256_wire(&preflight_jcs[range]),
        None => sha256_jcs(screen, "serialize B05 screen construction output")?,
    };

    let (status, trusted_count, schoedel_output_digest, schoedel_scientific_digest) =
        if schoedel_required {
            if preflight.schoedel_reconstruction_phase != B05ComputationPhase::Finalized {
                return Err(
                    "b05_schoedel_validation_error:schoedel_preflight_not_finalized".into(),
                );
            }
            let witness = schoedel_witness.ok_or_else(|| {
                "b05_schoedel_validation_error:trusted_retained_event_count_missing".to_string()
            })?;
            let trusted_count = witness.trusted_retained_event_count;
            let output = preflight.schoedel_reconstruction.as_ref().ok_or_else(|| {
                "b05_schoedel_validation_error:schoedel_output_missing".to_string()
            })?;
            b05::validate_schoedel_reconstruction_output(
                output,
                screen,
                options.screen_session_construction_strategy,
                trusted_count,
            )
            .map_err(str::to_owned)?;
            let resolved_participants = output
                .applicability
                .source_order_resolution
                .as_ref()
                .map(|resolution| {
                    resolution
                        .participant_decisions
                        .iter()
                        .map(|participant| participant.participant_id.clone())
                        .collect::<BTreeSet<_>>()
                })
                .unwrap_or_default();
            if resolved_participants != witness.decisive_participant_ids {
                return Err(
                    "b05_schoedel_validation_error:decisive_participant_scope_mismatch".into(),
                );
            }
            let scientific_digest = output
                .reconstruction_receipt
                .as_ref()
                .ok_or_else(|| {
                    "b05_schoedel_validation_error:schoedel_receipt_missing".to_string()
                })?
                .episode_digest
                .clone();
            (
                B05SchoedelValidationStatus::ScreenAndSchoedelValidated,
                Some(trusted_count),
                Some(sha256_jcs(
                    output,
                    "serialize Schoedel reconstruction output",
                )?),
                Some(scientific_digest),
            )
        } else {
            if preflight.schoedel_reconstruction_phase != B05ComputationPhase::NotApplicable
                || preflight.schoedel_reconstruction.is_some()
                || schoedel_witness.is_some()
            {
                return Err(
                    "b05_schoedel_validation_error:inactive_schoedel_evidence_present".into(),
                );
            }
            (
                B05SchoedelValidationStatus::ScreenValidated,
                None,
                None,
                None,
            )
        };
    let mut receipt = B05SchoedelValidationReceipt {
        protocol_version: B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION.into(),
        status,
        verified_raw_input_digest: verified_raw_input_digest.into(),
        decoded_input_row_count,
        request_options_digest: preflight.options_digest.clone(),
        options_digest_origin: preflight.options_digest_origin,
        router_component_options_digest: preflight.component_options_digest.clone(),
        screen_component_options_digest: preflight.screen_component_options_digest.clone(),
        schoedel_component_options_digest: preflight.schoedel_component_options_digest.clone(),
        foundational_semantics_evidence_jcs_digest,
        foundational_episode_count,
        foundational_bounded_episode_count: foundational_evidence
            .minimum_duration
            .bounded_episode_count,
        foundational_unbounded_episode_count: foundational_evidence
            .minimum_duration
            .unbounded_episode_count,
        minimum_duration_excluded_episode_count,
        concurrent_generated_subinterval_count: foundational_evidence
            .concurrent_subinterval_floor
            .generated_subinterval_count,
        zero_duration_removed_row_count,
        finalized_preflight_jcs_digest,
        selected_b05_strategy_id: options.screen_session_construction_strategy,
        screen_interval_digest: Some(screen_receipt.interval_digest.clone()),
        screen_construction_output_jcs_digest: Some(screen_output_digest),
        screen_scientific_evidence_digest: Some(screen_receipt.interval_digest.clone()),
        trusted_schoedel_retained_event_count: trusted_count,
        schoedel_decisive_participant_count: schoedel_witness
            .map(|witness| witness.decisive_participant_ids.len() as u32)
            .unwrap_or(0),
        schoedel_reconstruction_output_jcs_digest: schoedel_output_digest,
        schoedel_scientific_evidence_digest: schoedel_scientific_digest,
        validation_digest: String::new(),
    };
    receipt.validation_digest = b05_schoedel_validation_digest(&receipt)?;
    Ok(receipt)
}

/// Revalidate a standalone receipt against the exact typed evidence it
/// attests. The retained-event count is trusted only because a live kernel
/// result-level validation produced the receipt; this function proves the
/// evidence/digest closure used later by the semantic index.
pub fn validate_b05_schoedel_validation_receipt_integrity(
    receipt: &B05SchoedelValidationReceipt,
    preflight: &B05SchoedelPreflightResult,
    foundational_evidence: &FoundationalSemanticsEvidence,
    options: &PipelineV2Options,
) -> Result<(), String> {
    if receipt.status == B05SchoedelValidationStatus::InvalidUnvalidated
        || receipt.protocol_version != B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION
        || receipt.validation_digest != b05_schoedel_validation_digest(receipt)?
    {
        return Err("b05_schoedel_validation_error:receipt_integrity_mismatch".into());
    }
    let expected = build_b05_schoedel_validation_receipt(
        preflight,
        foundational_evidence,
        options,
        &receipt.verified_raw_input_digest,
        receipt.decoded_input_row_count,
        receipt
            .trusted_schoedel_retained_event_count
            .map(|trusted_retained_event_count| SchoedelValidationWitness {
                trusted_retained_event_count,
                decisive_participant_ids: preflight
                    .schoedel_reconstruction
                    .as_ref()
                    .and_then(|output| output.applicability.source_order_resolution.as_ref())
                    .map(|resolution| {
                        resolution
                            .participant_decisions
                            .iter()
                            .map(|participant| participant.participant_id.clone())
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .as_ref(),
    )?;
    if expected != *receipt {
        return Err("b05_schoedel_validation_error:receipt_evidence_mismatch".into());
    }
    Ok(())
}

pub(crate) fn digest_options_identity(identity: &impl serde::Serialize) -> String {
    let bytes = serde_json::to_vec(identity)
        .expect("foundational options identity contains only infallible scalar values");
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

pub(crate) fn b05_router_options_digest(opts: &PipelineV2Options) -> String {
    digest_options_identity(&B05RouterOptionsIdentity {
        protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION,
        usage_session_mode: match opts.usage_session_mode {
            UsageSessionMode::NoUsage => "no_usage",
            UsageSessionMode::AppUsage => "app_usage",
            UsageSessionMode::ScreenUsage => "screen_usage",
            UsageSessionMode::AppAndScreenUsage => "app_and_screen_usage",
        },
        screen_session_construction_strategy: opts
            .screen_session_construction_strategy
            .canonical_id(),
        screen_session_construction_strategy_explicit: opts
            .screen_session_construction_strategy_explicit,
        episode_reconstruction_strategy: opts.episode_reconstruction_strategy.canonical_id(),
    })
}

pub(crate) fn b05_screen_options_digest(opts: &PipelineV2Options) -> String {
    b05_screen_strategy_digest(opts.screen_session_construction_strategy)
}

pub(crate) fn b05_screen_strategy_digest(strategy: ScreenSessionConstructionStrategyId) -> String {
    digest_options_identity(&B05ScreenOptionsIdentity {
        protocol_version: "chronicle-b05-screen-options/v1",
        screen_session_construction_strategy: strategy.canonical_id(),
    })
}

pub(crate) fn schoedel_options_digest(opts: &PipelineV2Options) -> String {
    digest_options_identity(&SchoedelOptionsIdentity {
        protocol_version: "chronicle-schoedel-options/v1",
        screen_session_construction_strategy: opts
            .screen_session_construction_strategy
            .canonical_id(),
        episode_reconstruction_strategy: opts.episode_reconstruction_strategy.canonical_id(),
        event_retention_set: opts.event_retention_set.canonical_id(),
        opener_set: opts.opener_set.canonical_id(),
    })
}

pub(crate) fn eyes_input_partition_options_digest(opts: &PipelineV2Options) -> String {
    digest_options_identity(&EyesInputPartitionOptionsIdentity {
        protocol_version: EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION,
        usage_session_mode: match opts.usage_session_mode {
            UsageSessionMode::NoUsage => "no_usage",
            UsageSessionMode::AppUsage => "app_usage",
            UsageSessionMode::ScreenUsage => "screen_usage",
            UsageSessionMode::AppAndScreenUsage => "app_and_screen_usage",
        },
        episode_reconstruction_strategy: opts.episode_reconstruction_strategy.canonical_id(),
    })
}

/// The single applicability authority for EYES tagged-FAU evidence: the
/// strategy must be `eyes_complement` AND app usage must be processed. The
/// runtime derives its evidence status from this predicate rather than
/// re-deriving it from the strategy id alone (which disagreed on
/// screen-usage-only requests and failed the covering-array campaign at
/// pict_26).
pub fn eyes_complement_is_active(opts: &PipelineV2Options) -> bool {
    matches!(
        opts.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    ) && opts.episode_reconstruction_strategy == EpisodeReconstructionStrategy::EyesComplement
}

/// Exact EYES option vector selected by the pipeline. Only proximity is a
/// request option; every other reference threshold remains the locked default.
pub fn eyes_effective_options(opts: &PipelineV2Options) -> crate::eyes_complement::EyesOptions {
    crate::eyes_complement::EyesOptions {
        proximity_interval_seconds: opts.proximity_interval_ns as f64 / 1_000_000_000.0,
        ..crate::eyes_complement::EyesOptions::default()
    }
}

pub fn preflight_eyes_complement_input_partition(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    identity: EyesInputPartitionPreflightIdentity<'_>,
    input_boundary: ParticipantInputBoundary<'_>,
) -> Result<EyesInputPartitionPreflightResult, EyesInputPartitionPreflightError> {
    preflight_eyes_input_partition_with_raw_digest(
        sha256_wire(raw_csv_bytes),
        opts,
        identity,
        input_boundary,
    )
}

/// `raw_input_digest` must be `sha256_wire` of the raw bytes, computed by this
/// crate in the same call chain; the receipt records it as the input digest.
pub(crate) fn preflight_eyes_input_partition_with_raw_digest(
    raw_input_digest: String,
    opts: &PipelineV2Options,
    identity: EyesInputPartitionPreflightIdentity<'_>,
    input_boundary: ParticipantInputBoundary<'_>,
) -> Result<EyesInputPartitionPreflightResult, EyesInputPartitionPreflightError> {
    if identity
        .verified_request_options_digest
        .is_some_and(|digest| !valid_sha256_wire(digest))
    {
        return Err(EyesInputPartitionPreflightError::InvalidVerifiedRequestOptionsDigest);
    }
    let component_options_digest = eyes_input_partition_options_digest(opts);
    let (options_digest, options_digest_origin) = identity
        .verified_request_options_digest
        .map(|digest| {
            (
                digest.to_owned(),
                EyesInputPartitionOptionsDigestOrigin::VerifiedRequestJcs,
            )
        })
        .unwrap_or((
            component_options_digest,
            EyesInputPartitionOptionsDigestOrigin::KernelComponent,
        ));
    let fragmented_participants = input_boundary
        .fragmented_participant_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let active = eyes_complement_is_active(opts);
    let refused = active && !fragmented_participants.is_empty();
    let mut receipt = EyesInputPartitionPreflightResult {
        protocol_version: EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION.into(),
        disposition: if !active {
            ScientificPreflightDisposition::NotApplicable
        } else if refused {
            ScientificPreflightDisposition::Refused
        } else {
            ScientificPreflightDisposition::Executable
        },
        input_digest: raw_input_digest,
        options_digest,
        options_digest_origin,
        requested_episode_strategy_id: opts.episode_reconstruction_strategy.canonical_id().into(),
        effective_episode_strategy_id: (active && !refused)
            .then(|| opts.episode_reconstruction_strategy.canonical_id().into()),
        relation: if !active {
            None
        } else if refused {
            Some(b05::ScientificRelation::Refused)
        } else {
            Some(b05::ScientificRelation::PartialReplay)
        },
        refusal_reason: refused.then_some(EyesInputPartitionRefusalReason::UnsupportedInputChunk),
        refusal_detail: refused.then(|| "participant_stream_fragmented".into()),
        fragmented_participant_count: fragmented_participants.len() as u32,
        resolution_digest: String::new(),
    };
    receipt.resolution_digest = sha256_wire(
        &serde_json::to_vec(&receipt).expect("EYES partition applicability receipt serializes"),
    );
    Ok(receipt)
}

pub(crate) fn validate_finalized_eyes_input_partition(
    preflight: &EyesInputPartitionPreflightResult,
    opts: &PipelineV2Options,
    expected_raw_input_digest: &str,
    expected_options_digest: &str,
    expected_options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
) -> Result<(), String> {
    let mut unsigned = preflight.clone();
    unsigned.resolution_digest.clear();
    let expected_resolution_digest = sha256_wire(
        &serde_json::to_vec(&unsigned)
            .map_err(|error| format!("serialize EYES partition receipt: {error}"))?,
    );
    if !eyes_complement_is_active(opts)
        || preflight.protocol_version != EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION
        || preflight.disposition != ScientificPreflightDisposition::Executable
        || preflight.input_digest != expected_raw_input_digest
        || preflight.options_digest != expected_options_digest
        || preflight.options_digest_origin != expected_options_digest_origin
        || preflight.requested_episode_strategy_id != "eyes_complement"
        || preflight.effective_episode_strategy_id.as_deref() != Some("eyes_complement")
        || preflight.relation != Some(b05::ScientificRelation::PartialReplay)
        || preflight.refusal_reason.is_some()
        || preflight.refusal_detail.is_some()
        || preflight.fragmented_participant_count != 0
        || preflight.resolution_digest != expected_resolution_digest
    {
        return Err("eyes_tagged_fau_validation_error:partition_identity".into());
    }
    match expected_options_digest_origin {
        EyesInputPartitionOptionsDigestOrigin::VerifiedRequestJcs => {
            if !valid_sha256_wire(expected_options_digest) {
                return Err("eyes_tagged_fau_validation_error:options_digest".into());
            }
        }
        EyesInputPartitionOptionsDigestOrigin::KernelComponent => {
            if expected_options_digest != eyes_input_partition_options_digest(opts) {
                return Err("eyes_tagged_fau_validation_error:component_options_digest".into());
            }
        }
    }
    Ok(())
}

pub(crate) fn eyes_tagged_fau_validation_digest(
    receipt: &EyesTaggedFauValidationReceipt,
) -> Result<String, String> {
    let mut unsigned = receipt.clone();
    unsigned.validation_digest.clear();
    sha256_jcs(&unsigned, "serialize EYES tagged-FAU validation receipt")
}

pub(crate) fn checked_evidence_count(
    participants: &[crate::eyes_complement::EyesParticipantTaggedFauEvidence],
    count: impl Fn(&crate::eyes_complement::EyesTaggedFauEvidence) -> usize,
    label: &str,
) -> Result<u64, String> {
    participants.iter().try_fold(0_u64, |total, participant| {
        let value = u64::try_from(count(&participant.evidence))
            .map_err(|_| format!("eyes_tagged_fau_validation_error:{label}_overflow"))?;
        total
            .checked_add(value)
            .ok_or_else(|| format!("eyes_tagged_fau_validation_error:{label}_overflow"))
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_eyes_tagged_fau_validation_receipt(
    evidence: &[crate::eyes_complement::EyesParticipantTaggedFauEvidence],
    expected_participant_ids: &BTreeSet<String>,
    final_partition: &EyesInputPartitionPreflightResult,
    opts: &PipelineV2Options,
    verified_raw_input_digest: &str,
    decoded_input_row_count: u64,
    request_options_digest: &str,
    options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
) -> Result<EyesTaggedFauValidationReceipt, String> {
    if !valid_sha256_wire(verified_raw_input_digest) {
        return Err("eyes_tagged_fau_validation_error:raw_input_digest".into());
    }
    validate_finalized_eyes_input_partition(
        final_partition,
        opts,
        verified_raw_input_digest,
        request_options_digest,
        options_digest_origin,
    )?;
    let effective_options = eyes_effective_options(opts);
    crate::eyes_complement::validate_eyes_tagged_fau_evidence(evidence, effective_options)?;
    let actual_participant_ids = evidence
        .iter()
        .map(|participant| participant.participant_id.clone())
        .collect::<BTreeSet<_>>();
    if &actual_participant_ids != expected_participant_ids {
        return Err("eyes_tagged_fau_validation_error:participant_witness".into());
    }
    let artifact_bytes = crate::eyes_complement::eyes_tagged_fau_artifact_jcs_bytes(evidence)?;
    let participant_count = u32::try_from(evidence.len())
        .map_err(|_| "eyes_tagged_fau_validation_error:participant_count_overflow".to_string())?;
    let mut receipt = EyesTaggedFauValidationReceipt {
        protocol_version: EYES_TAGGED_FAU_VALIDATION_RECEIPT_PROTOCOL_VERSION.into(),
        status: EyesTaggedFauValidationStatus::Validated,
        verified_raw_input_digest: verified_raw_input_digest.into(),
        decoded_input_row_count,
        request_options_digest: request_options_digest.into(),
        options_digest_origin,
        effective_options,
        source_version: crate::eyes_complement::EYES_REFERENCE_VERSION.into(),
        source_commit: crate::eyes_complement::EYES_REFERENCE_COMMIT.into(),
        source_license_status: crate::eyes_complement::EYES_REFERENCE_LICENSE.into(),
        reference_defect_repair_ids: crate::eyes_complement::EYES_REFERENCE_DEFECT_REPAIR_IDS
            .into_iter()
            .map(str::to_owned)
            .collect(),
        headline_projection: crate::eyes_complement::EyesHeadlineProjection::ActiveOnly,
        reference_primary_secondary_concurrency_ported: false,
        pickup_export_exposed: false,
        limitations: vec![
            crate::eyes_complement::EyesPartialReplayLimitation::ReferencePrimarySecondaryConcurrencyUnported,
            crate::eyes_complement::EyesPartialReplayLimitation::PickupExportUnavailableOnProductSurface,
            crate::eyes_complement::EyesPartialReplayLimitation::HeadlineProjectsActiveFragmentsOnly,
        ],
        final_partition_resolution_digest: final_partition.resolution_digest.clone(),
        participant_count,
        device_state_block_count: checked_evidence_count(
            evidence,
            |value| value.device_state_blocks.len(),
            "block_count",
        )?,
        episode_count: checked_evidence_count(
            evidence,
            |value| value.episodes.len(),
            "episode_count",
        )?,
        app_usage_chunk_count: checked_evidence_count(
            evidence,
            |value| value.app_usage_chunks.len(),
            "chunk_count",
        )?,
        fragment_count: checked_evidence_count(
            evidence,
            |value| value.fragments.len(),
            "fragment_count",
        )?,
        credited_fragment_count: checked_evidence_count(
            evidence,
            |value| {
                value
                    .fragments
                    .iter()
                    .filter(|fragment| {
                        fragment.device_status == crate::eyes_complement::EyesBlockType::Active
                    })
                    .count()
            },
            "credited_fragment_count",
        )?,
        chunk_endpoint_count: checked_evidence_count(
            evidence,
            |value| value.chunk_endpoints.len(),
            "endpoint_count",
        )?,
        pickup_export_row_count: evidence.iter().try_fold(0_u64, |total, participant| {
            total
                .checked_add(u64::from(
                    participant.evidence.receipt.pickup_export_row_count,
                ))
                .ok_or_else(|| {
                    "eyes_tagged_fau_validation_error:pickup_count_overflow".to_string()
                })
        })?,
        tagged_fau_artifact_jcs_digest: sha256_wire(&artifact_bytes),
        validation_digest: String::new(),
    };
    receipt.validation_digest = eyes_tagged_fau_validation_digest(&receipt)?;
    Ok(receipt)
}

/// Authenticate the active EYES evidence carried by a live pipeline result.
/// Inactive results return `None` without consulting the skipped marker.
pub fn validated_eyes_tagged_fau_receipt(
    result: &PipelineV2Result,
    opts: &PipelineV2Options,
    expected_verified_raw_input_digest: &str,
    expected_options_digest: &str,
    expected_options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
) -> Result<Option<EyesTaggedFauValidationReceipt>, String> {
    if !eyes_complement_is_active(opts) {
        if !result.eyes_tagged_fau_evidence.is_empty()
            || result.eyes_input_partition_preflight.is_some()
        {
            return Err("eyes_tagged_fau_validation_error:inactive_evidence_present".into());
        }
        return Ok(None);
    }
    let context = &result.eyes_tagged_fau_validation_context;
    if context.receipt.status == EyesTaggedFauValidationStatus::InvalidUnvalidated {
        return Err("eyes_tagged_fau_validation_error:unvalidated_result_sentinel".into());
    }
    if context.expected_raw_input_digest != expected_verified_raw_input_digest
        || context.expected_options_digest != expected_options_digest
        || context.expected_options_digest_origin != Some(expected_options_digest_origin)
    {
        return Err("eyes_tagged_fau_validation_error:result_context_mismatch".into());
    }
    let final_partition = result
        .eyes_input_partition_preflight
        .as_ref()
        .ok_or_else(|| "eyes_tagged_fau_validation_error:partition_missing".to_string())?;
    let expected = build_eyes_tagged_fau_validation_receipt(
        &result.eyes_tagged_fau_evidence,
        &context.expected_participant_ids,
        final_partition,
        opts,
        expected_verified_raw_input_digest,
        context.receipt.decoded_input_row_count,
        expected_options_digest,
        expected_options_digest_origin,
    )?;
    if expected != context.receipt {
        return Err("eyes_tagged_fau_validation_error:receipt_evidence_mismatch".into());
    }
    Ok(Some(context.receipt.clone()))
}

/// Revalidate a published EYES attestation against its exact canonical
/// evidence and independently supplied request/input identities.
#[allow(clippy::too_many_arguments)]
pub fn validate_eyes_tagged_fau_validation_receipt_integrity(
    receipt: &EyesTaggedFauValidationReceipt,
    evidence: &[crate::eyes_complement::EyesParticipantTaggedFauEvidence],
    final_partition: &EyesInputPartitionPreflightResult,
    opts: &PipelineV2Options,
    expected_verified_raw_input_digest: &str,
    expected_options_digest: &str,
    expected_options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
) -> Result<(), String> {
    if receipt.protocol_version != EYES_TAGGED_FAU_VALIDATION_RECEIPT_PROTOCOL_VERSION
        || receipt.status != EyesTaggedFauValidationStatus::Validated
        || receipt.validation_digest != eyes_tagged_fau_validation_digest(receipt)?
    {
        return Err("eyes_tagged_fau_validation_error:receipt_integrity".into());
    }
    let participant_ids = evidence
        .iter()
        .map(|participant| participant.participant_id.clone())
        .collect::<BTreeSet<_>>();
    let expected = build_eyes_tagged_fau_validation_receipt(
        evidence,
        &participant_ids,
        final_partition,
        opts,
        expected_verified_raw_input_digest,
        receipt.decoded_input_row_count,
        expected_options_digest,
        expected_options_digest_origin,
    )?;
    if expected != *receipt {
        return Err("eyes_tagged_fau_validation_error:receipt_evidence_mismatch".into());
    }
    Ok(())
}

pub(crate) fn eyes_input_partition_refusal_error(preflight: &EyesInputPartitionPreflightResult) -> String {
    format!(
        "scientific_preflight_refused:eyes={}",
        preflight
            .refusal_reason
            .map(EyesInputPartitionRefusalReason::canonical_id)
            .unwrap_or("none"),
    )
}

pub(crate) fn sha256_wire(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

pub(crate) fn valid_sha256_wire(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

/// Exact cross-boundary `RoleAssignment::assignment_id` protocol from the
/// runtime: stable_id(["assignment", role_id, artifact.digest]).
pub(crate) fn b05_evidence_assignment_digest(evidence_artifact_digest: &str) -> String {
    b05::capability_evidence_assignment_digest(evidence_artifact_digest)
}

pub(crate) fn raw_b05_events(raw_rows: &[RawRow]) -> Vec<b05::RawB05Event> {
    raw_rows
        .iter()
        .map(|raw| {
            b05::RawB05Event::from_raw_label(
                raw.participant_id.clone(),
                parse_chronicle_timestamp_ns(&raw.event_timestamp),
                raw.source_data_row,
                raw.interaction_type.clone(),
                (!raw.app_package_name.is_empty()).then(|| raw.app_package_name.clone()),
            )
        })
        .collect()
}

/// Decode and resolve the raw/source B05 stage once under a request-neutral
/// component digest. Exact request JCS and downstream app-policy choices are
/// attached later by [`bind_b05_screen_substrate`].
pub fn prepare_b05_screen_substrate(
    raw_csv_bytes: &[u8],
    strategy: ScreenSessionConstructionStrategyId,
    capability_evidence_csv: &[u8],
    verified_raw_input_digest: Option<&str>,
    verified_evidence_artifact_digest: Option<&str>,
    verified_evidence_assignment_digest: Option<&str>,
) -> Result<B05ScreenPreparedSubstrate, B05PreflightError> {
    prepare_b05_screen_substrate_with_input_boundary(
        raw_csv_bytes,
        strategy,
        capability_evidence_csv,
        verified_raw_input_digest,
        verified_evidence_artifact_digest,
        verified_evidence_assignment_digest,
        B05InputBoundary::default(),
    )
}

/// Prepare the reusable B05 screen substrate while binding executor-known
/// participant partition boundaries independently of options JCS and the
/// capability-evidence artifact.
#[allow(clippy::too_many_arguments)]
pub fn prepare_b05_screen_substrate_with_input_boundary(
    raw_csv_bytes: &[u8],
    strategy: ScreenSessionConstructionStrategyId,
    capability_evidence_csv: &[u8],
    verified_raw_input_digest: Option<&str>,
    verified_evidence_artifact_digest: Option<&str>,
    verified_evidence_assignment_digest: Option<&str>,
    input_boundary: B05InputBoundary<'_>,
) -> Result<B05ScreenPreparedSubstrate, B05PreflightError> {
    prepare_b05_screen_substrate_with_schoedel_evidence(
        raw_csv_bytes,
        strategy,
        capability_evidence_csv,
        verified_raw_input_digest,
        verified_evidence_artifact_digest,
        verified_evidence_assignment_digest,
        false,
        input_boundary,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_b05_screen_substrate_with_schoedel_evidence(
    raw_csv_bytes: &[u8],
    strategy: ScreenSessionConstructionStrategyId,
    capability_evidence_csv: &[u8],
    verified_raw_input_digest: Option<&str>,
    verified_evidence_artifact_digest: Option<&str>,
    verified_evidence_assignment_digest: Option<&str>,
    bind_schoedel_evidence: bool,
    input_boundary: B05InputBoundary<'_>,
    // `sha256_wire(raw_csv_bytes)` already computed by this crate in the same
    // call chain. `None` hashes here. Never a caller-supplied claim: those go
    // through `verified_raw_input_digest` and are checked against the bytes.
    computed_raw_input_sha256: Option<String>,
) -> Result<B05ScreenPreparedSubstrate, B05PreflightError> {
    prepare_b05_screen_substrate_with_schoedel_evidence_with_stages(&super::StageFunctions::production(), raw_csv_bytes, strategy, capability_evidence_csv, verified_raw_input_digest, verified_evidence_artifact_digest, verified_evidence_assignment_digest, bind_schoedel_evidence, input_boundary, computed_raw_input_sha256)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_b05_screen_substrate_with_schoedel_evidence_with_stages(
    stages: &super::StageFunctions,
    raw_csv_bytes: &[u8],
    strategy: ScreenSessionConstructionStrategyId,
    capability_evidence_csv: &[u8],
    verified_raw_input_digest: Option<&str>,
    verified_evidence_artifact_digest: Option<&str>,
    verified_evidence_assignment_digest: Option<&str>,
    bind_schoedel_evidence: bool,
    input_boundary: B05InputBoundary<'_>,
    // `sha256_wire(raw_csv_bytes)` already computed by this crate in the same
    // call chain. `None` hashes here. Never a caller-supplied claim: those go
    // through `verified_raw_input_digest` and are checked against the bytes.
    computed_raw_input_sha256: Option<String>,
) -> Result<B05ScreenPreparedSubstrate, B05PreflightError> {
    let source_sensitive = strategy != ScreenSessionConstructionStrategyId::default();
    let fragmented_participants = input_boundary
        .fragmented_participant_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let evidence_bound =
        (source_sensitive || bind_schoedel_evidence) && fragmented_participants.is_empty();
    if verified_raw_input_digest.is_some_and(|digest| !valid_sha256_wire(digest)) {
        return Err(B05PreflightError::InvalidVerifiedRawInputDigest);
    }
    if evidence_bound {
        for (field, digest) in [
            (
                B05PreflightIdentityField::EvidenceArtifactDigest,
                verified_evidence_artifact_digest,
            ),
            (
                B05PreflightIdentityField::EvidenceAssignmentDigest,
                verified_evidence_assignment_digest,
            ),
        ] {
            if digest.is_some_and(|value| !valid_sha256_wire(value)) {
                return Err(B05PreflightError::InvalidVerifiedDigest(field));
            }
        }
    }
    let raw_input_sha256 =
        computed_raw_input_sha256.unwrap_or_else(|| sha256_wire(raw_csv_bytes));
    if verified_raw_input_digest.is_some_and(|digest| digest != raw_input_sha256) {
        return Err(B05PreflightError::RawInputDigestMismatch);
    }
    if evidence_bound
        && capability_evidence_csv.is_empty()
        && (verified_evidence_artifact_digest.is_some()
            || verified_evidence_assignment_digest.is_some())
    {
        return Err(B05PreflightError::EvidenceIdentityWithoutArtifact);
    }
    let evidence_artifact_digest = (evidence_bound && !capability_evidence_csv.is_empty())
        .then(|| sha256_wire(capability_evidence_csv));
    if let (Some(verified), Some(computed)) = (
        verified_evidence_artifact_digest,
        evidence_artifact_digest.as_deref(),
    ) {
        if verified != computed {
            return Err(B05PreflightError::EvidenceArtifactDigestMismatch);
        }
    }
    let evidence_assignment_digest = evidence_artifact_digest
        .as_deref()
        .map(b05_evidence_assignment_digest);
    if let (Some(verified), Some(computed)) = (
        verified_evidence_assignment_digest,
        evidence_assignment_digest.as_deref(),
    ) {
        if verified != computed {
            return Err(B05PreflightError::EvidenceAssignmentDigestMismatch);
        }
    }
    #[cfg(test)]
    B05_PREPARE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
    let raw_rows = Arc::new((stages.decode_source_records)(raw_csv_bytes));
    let screen_component_options_digest = b05_screen_strategy_digest(strategy);
    let parsed_capability_evidence = if evidence_bound && !capability_evidence_csv.is_empty() {
        #[cfg(test)]
        B05_PREPARE_EVIDENCE_PARSE_COUNT.with(|count| count.set(count.get() + 1));
        Some(Arc::new(b05::parse_capability_evidence(
            capability_evidence_csv,
        )?))
    } else {
        None
    };
    let source_screen_construction = if source_sensitive {
        #[cfg(test)]
        B05_SCREEN_CONSTRUCTION_COUNT.with(|count| count.set(count.get() + 1));
        Some(b05::construct_screen_intervals(
            strategy,
            b05::B05ApplicabilityInput {
                raw_input_sha256: &raw_input_sha256,
                raw_events: &raw_b05_events(&raw_rows),
                evidence: parsed_capability_evidence.as_deref(),
                evidence_assignment_digest: evidence_assignment_digest.as_deref(),
                options_digest: &screen_component_options_digest,
                selection_was_explicit: true,
                fragmented_participants: &fragmented_participants,
            },
        )?)
    } else if !fragmented_participants.is_empty() {
        Some(b05::adapt_chronicle_screen_intervals(
            b05::B05ApplicabilityInput {
                raw_input_sha256: &raw_input_sha256,
                raw_events: &raw_b05_events(&raw_rows),
                evidence: None,
                evidence_assignment_digest: None,
                options_digest: &screen_component_options_digest,
                selection_was_explicit: false,
                fragmented_participants: &fragmented_participants,
            },
            &[],
        )?)
    } else {
        None
    };
    Ok(B05ScreenPreparedSubstrate {
        raw_input_sha256,
        screen_component_options_digest,
        selected_strategy_id: strategy,
        evidence_artifact_digest,
        verified_evidence_artifact_digest: evidence_bound
            .then_some(verified_evidence_artifact_digest)
            .flatten()
            .map(str::to_owned),
        verified_evidence_assignment_digest: evidence_bound
            .then_some(verified_evidence_assignment_digest)
            .flatten()
            .map(str::to_owned),
        fragmented_participants,
        raw_rows,
        parsed_capability_evidence,
        source_screen_construction,
    })
}

/// Attach exact request provenance and downstream Schoedel policy to a cached
/// screen substrate without decoding, parsing the sidecar, or replaying B05.
pub fn bind_b05_screen_substrate(
    substrate: &B05ScreenPreparedSubstrate,
    opts: &PipelineV2Options,
    verified_raw_input_digest: &str,
    identity: B05PreflightIdentity<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    if !valid_sha256_wire(verified_raw_input_digest) {
        return Err(B05PreflightError::InvalidVerifiedRawInputDigest);
    }
    if verified_raw_input_digest != substrate.raw_input_sha256 {
        return Err(B05PreflightError::RawInputDigestMismatch);
    }
    if b05_screen_options_digest(opts) != substrate.screen_component_options_digest
        || opts.screen_session_construction_strategy != substrate.selected_strategy_id
    {
        return Err(B05PreflightError::ScreenSubstrateOptionsMismatch);
    }
    if identity
        .verified_request_options_digest
        .is_some_and(|digest| !valid_sha256_wire(digest))
    {
        return Err(B05PreflightError::InvalidVerifiedDigest(
            B05PreflightIdentityField::RequestOptionsDigest,
        ));
    }
    let active = b05_schoedel_is_active(opts);
    let source_sensitive =
        opts.screen_session_construction_strategy != ScreenSessionConstructionStrategyId::default();
    let evidence_bound = ((active && source_sensitive) || schoedel_is_active(opts))
        && substrate.fragmented_participants.is_empty();
    if evidence_bound {
        if identity.verified_evidence_artifact_digest
            != substrate.verified_evidence_artifact_digest.as_deref()
        {
            return Err(B05PreflightError::EvidenceArtifactDigestMismatch);
        }
        if identity.verified_evidence_assignment_digest
            != substrate.verified_evidence_assignment_digest.as_deref()
        {
            return Err(B05PreflightError::EvidenceAssignmentDigestMismatch);
        }
    }
    let component_options_digest = b05_router_options_digest(opts);
    let screen_component_options_digest = b05_screen_options_digest(opts);
    let schoedel_component_options_digest = schoedel_options_digest(opts);
    let (options_digest, options_digest_origin) = identity
        .verified_request_options_digest
        .map(|digest| {
            (
                digest.to_owned(),
                B05OptionsDigestOrigin::VerifiedRequestJcs,
            )
        })
        .unwrap_or_else(|| {
            (
                component_options_digest.clone(),
                B05OptionsDigestOrigin::KernelRouterComponent,
            )
        });
    let screen_construction =
        if active && (source_sensitive || !substrate.fragmented_participants.is_empty()) {
            let construction = substrate
                .source_screen_construction
                .as_ref()
                .ok_or(B05PreflightError::ScreenSubstrateOptionsMismatch)?;
            Some(if source_sensitive {
                b05::rebind_screen_construction_options_digest(construction, &options_digest)
            } else {
                b05::rebind_chronicle_screen_construction_receipt(
                    construction,
                    &options_digest,
                    opts.screen_session_construction_strategy_explicit,
                )
            })
        } else {
            None
        };
    let b05_refusal = screen_construction
        .as_ref()
        .filter(|output| !output.executable());
    let schoedel_reconstruction = if schoedel_is_active(opts) {
        b05_refusal.map(|output| b05::schoedel_b05_dependency_refusal(&output.applicability))
    } else {
        None
    };
    let evidence = B05SchoedelPreflightResult {
        protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
        disposition: if !active {
            ScientificPreflightDisposition::NotApplicable
        } else if b05_refusal.is_some() {
            ScientificPreflightDisposition::Refused
        } else {
            ScientificPreflightDisposition::Executable
        },
        options_digest,
        component_options_digest: component_options_digest.clone(),
        screen_component_options_digest: screen_component_options_digest.clone(),
        schoedel_component_options_digest: schoedel_component_options_digest.clone(),
        options_digest_origin,
        requested_screen_strategy_id: opts.screen_session_construction_strategy,
        effective_screen_strategy_id: screen_construction
            .as_ref()
            .map(|output| output.applicability.effective_strategy_id)
            .unwrap_or(opts.screen_session_construction_strategy),
        requested_episode_strategy_id: opts.episode_reconstruction_strategy.canonical_id().into(),
        effective_episode_strategy_id: schoedel_is_active(opts)
            .then(|| opts.episode_reconstruction_strategy.canonical_id().into()),
        screen_construction_phase: if !active {
            B05ComputationPhase::NotApplicable
        } else if source_sensitive {
            B05ComputationPhase::PreparedRawSourceArm
        } else if screen_construction.is_some() {
            B05ComputationPhase::Finalized
        } else {
            B05ComputationPhase::DeferredCanonicalBaseline
        },
        schoedel_reconstruction_phase: if !schoedel_is_active(opts) {
            B05ComputationPhase::NotApplicable
        } else if schoedel_reconstruction.is_some() {
            B05ComputationPhase::Finalized
        } else {
            B05ComputationPhase::DeferredRetainedAppStream
        },
        screen_construction,
        schoedel_reconstruction,
    };
    Ok(B05SchoedelPreparedInput {
        raw_input_sha256: substrate.raw_input_sha256.clone(),
        component_options_digest,
        screen_component_options_digest,
        schoedel_component_options_digest,
        evidence_artifact_digest: evidence_bound
            .then(|| substrate.evidence_artifact_digest.clone())
            .flatten(),
        verified_request_options_digest: identity
            .verified_request_options_digest
            .map(str::to_owned),
        verified_evidence_artifact_digest: evidence_bound
            .then_some(identity.verified_evidence_artifact_digest)
            .flatten()
            .map(str::to_owned),
        verified_evidence_assignment_digest: evidence_bound
            .then_some(identity.verified_evidence_assignment_digest)
            .flatten()
            .map(str::to_owned),
        fragmented_participants: substrate.fragmented_participants.clone(),
        raw_rows: Arc::clone(&substrate.raw_rows),
        parsed_capability_evidence: substrate.parsed_capability_evidence.clone(),
        source_screen_construction: substrate.source_screen_construction.clone(),
        evidence,
    })
}

/// Rebind an existing prepared object's reusable screen substrate to a new
/// exact request. B01/B02 and explicit-selection edits do not decode, parse,
/// or replay source B05; a strategy/raw/evidence identity change fails closed.
pub fn rebind_b05_schoedel_prepared(
    prepared: &B05SchoedelPreparedInput,
    opts: &PipelineV2Options,
    verified_raw_input_digest: &str,
    identity: B05PreflightIdentity<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    let substrate = B05ScreenPreparedSubstrate {
        raw_input_sha256: prepared.raw_input_sha256.clone(),
        screen_component_options_digest: prepared.screen_component_options_digest.clone(),
        selected_strategy_id: prepared.evidence.requested_screen_strategy_id,
        evidence_artifact_digest: prepared.evidence_artifact_digest.clone(),
        verified_evidence_artifact_digest: prepared.verified_evidence_artifact_digest.clone(),
        verified_evidence_assignment_digest: prepared.verified_evidence_assignment_digest.clone(),
        fragmented_participants: prepared.fragmented_participants.clone(),
        raw_rows: Arc::clone(&prepared.raw_rows),
        parsed_capability_evidence: prepared.parsed_capability_evidence.clone(),
        source_screen_construction: prepared.source_screen_construction.clone(),
    };
    bind_b05_screen_substrate(&substrate, opts, verified_raw_input_digest, identity)
}

/// Decode once, resolve identity agreement, and construct the selected B05 and
/// Schoedel evidence before the ordinary app-reconstruction cone. Runtime
/// callers retain this object and pass it to execution; the private raw rows
/// are then reused rather than decoded a second time.
pub fn prepare_b05_schoedel(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    prepare_b05_schoedel_with_input_boundary(
        raw_csv_bytes,
        opts,
        capability_evidence_csv,
        identity,
        B05InputBoundary::default(),
    )
}

/// Prepare B05/Schoedel with explicit executor-known participant partition
/// facts. The boundary metadata remains separate from request JCS and from
/// the capability-evidence artifact identity.
pub fn prepare_b05_schoedel_with_input_boundary(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    prepare_b05_schoedel_with_raw_digest(
        raw_csv_bytes,
        sha256_wire(raw_csv_bytes),
        opts,
        capability_evidence_csv,
        identity,
        input_boundary,
    )
}

/// `raw_input_sha256` must be `sha256_wire(raw_csv_bytes)` computed by this
/// crate in the same call chain.
pub(crate) fn prepare_b05_schoedel_with_raw_digest(
    raw_csv_bytes: &[u8],
    raw_input_sha256: String,
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    prepare_b05_schoedel_with_raw_digest_with_stages(&super::StageFunctions::production(), raw_csv_bytes, raw_input_sha256, opts, capability_evidence_csv, identity, input_boundary)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_b05_schoedel_with_raw_digest_with_stages(
    stages: &super::StageFunctions,
    raw_csv_bytes: &[u8],
    raw_input_sha256: String,
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
) -> Result<B05SchoedelPreparedInput, B05PreflightError> {
    // B04 validation is intentionally independent of B05 applicability. The
    // public runner also repeats this guard at execution, while this preflight
    // entrypoint rejects malformed options before raw input decoding.
    validate_pipeline_v2_options(opts).map_err(B05PreflightError::InvalidPipelineOptions)?;
    let source_screen_active = matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    ) && opts.screen_session_construction_strategy
        != ScreenSessionConstructionStrategyId::default();
    let evidence_bound = (source_screen_active || schoedel_is_active(opts))
        && input_boundary.fragmented_participant_ids.is_empty();
    let mut verified_digests = vec![(
        B05PreflightIdentityField::RequestOptionsDigest,
        identity.verified_request_options_digest,
    )];
    if evidence_bound {
        verified_digests.extend([
            (
                B05PreflightIdentityField::EvidenceArtifactDigest,
                identity.verified_evidence_artifact_digest,
            ),
            (
                B05PreflightIdentityField::EvidenceAssignmentDigest,
                identity.verified_evidence_assignment_digest,
            ),
        ]);
    }
    for (field, digest) in verified_digests {
        if digest.is_some_and(|value| !valid_sha256_wire(value)) {
            return Err(B05PreflightError::InvalidVerifiedDigest(field));
        }
    }

    if b05_schoedel_is_active(opts) {
        let substrate = prepare_b05_screen_substrate_with_schoedel_evidence_with_stages(
            stages,
            raw_csv_bytes,
            opts.screen_session_construction_strategy,
            capability_evidence_csv,
            None,
            identity.verified_evidence_artifact_digest,
            identity.verified_evidence_assignment_digest,
            schoedel_is_active(opts),
            input_boundary,
            Some(raw_input_sha256.clone()),
        )?;
        return bind_b05_screen_substrate(&substrate, opts, &raw_input_sha256, identity);
    }
    if evidence_bound
        && capability_evidence_csv.is_empty()
        && (identity.verified_evidence_artifact_digest.is_some()
            || identity.verified_evidence_assignment_digest.is_some())
    {
        return Err(B05PreflightError::EvidenceIdentityWithoutArtifact);
    }

    #[cfg(test)]
    B05_PREPARE_DECODE_COUNT.with(|count| count.set(count.get() + 1));
    let raw_rows = Arc::new((stages.decode_source_records)(raw_csv_bytes));
    let component_options_digest = b05_router_options_digest(opts);
    let screen_component_options_digest = b05_screen_options_digest(opts);
    let schoedel_component_options_digest = schoedel_options_digest(opts);
    let (options_digest, options_digest_origin) = identity
        .verified_request_options_digest
        .map(|digest| {
            (
                digest.to_owned(),
                B05OptionsDigestOrigin::VerifiedRequestJcs,
            )
        })
        .unwrap_or_else(|| {
            (
                component_options_digest.clone(),
                B05OptionsDigestOrigin::KernelRouterComponent,
            )
        });
    let evidence_artifact_digest = (evidence_bound && !capability_evidence_csv.is_empty())
        .then(|| sha256_wire(capability_evidence_csv));
    if let (Some(verified), Some(computed)) = (
        identity.verified_evidence_artifact_digest,
        evidence_artifact_digest.as_deref(),
    ) {
        if verified != computed {
            return Err(B05PreflightError::EvidenceArtifactDigestMismatch);
        }
    }
    let evidence_assignment_digest = evidence_artifact_digest
        .as_deref()
        .map(b05_evidence_assignment_digest);
    if let (Some(verified), Some(computed)) = (
        identity.verified_evidence_assignment_digest,
        evidence_assignment_digest.as_deref(),
    ) {
        if verified != computed {
            return Err(B05PreflightError::EvidenceAssignmentDigestMismatch);
        }
    }

    let evidence = preflight_b05_schoedel_from_raw_rows(
        &raw_input_sha256,
        &raw_rows,
        opts,
        capability_evidence_csv,
        &options_digest,
        &component_options_digest,
        &screen_component_options_digest,
        &schoedel_component_options_digest,
        options_digest_origin,
        evidence_artifact_digest.as_deref(),
        evidence_assignment_digest.as_deref(),
        &input_boundary
            .fragmented_participant_ids
            .iter()
            .cloned()
            .collect(),
    )?;
    let source_screen_construction = evidence.screen_construction.clone();
    Ok(B05SchoedelPreparedInput {
        raw_input_sha256,
        component_options_digest,
        screen_component_options_digest,
        schoedel_component_options_digest,
        evidence_artifact_digest,
        verified_request_options_digest: identity
            .verified_request_options_digest
            .map(str::to_owned),
        verified_evidence_artifact_digest: evidence_bound
            .then_some(identity.verified_evidence_artifact_digest)
            .flatten()
            .map(str::to_owned),
        verified_evidence_assignment_digest: evidence_bound
            .then_some(identity.verified_evidence_assignment_digest)
            .flatten()
            .map(str::to_owned),
        fragmented_participants: input_boundary
            .fragmented_participant_ids
            .iter()
            .cloned()
            .collect(),
        raw_rows,
        parsed_capability_evidence: None,
        source_screen_construction,
        evidence,
    })
}

/// Convenience read-only preflight for direct kernel callers. Full execution
/// should use `prepare_b05_schoedel` and pass the same prepared object onward.
pub fn preflight_b05_schoedel(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
) -> Result<B05SchoedelPreflightResult, B05PreflightError> {
    prepare_b05_schoedel(raw_csv_bytes, opts, capability_evidence_csv, identity)
        .map(B05SchoedelPreparedInput::into_evidence)
}

pub fn preflight_b05_schoedel_with_input_boundary(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
) -> Result<B05SchoedelPreflightResult, B05PreflightError> {
    prepare_b05_schoedel_with_input_boundary(
        raw_csv_bytes,
        opts,
        capability_evidence_csv,
        identity,
        input_boundary,
    )
    .map(B05SchoedelPreparedInput::into_evidence)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn preflight_b05_schoedel_from_raw_rows(
    raw_input_sha256: &str,
    raw_rows: &[RawRow],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    options_digest: &str,
    component_options_digest: &str,
    screen_component_options_digest: &str,
    schoedel_component_options_digest: &str,
    options_digest_origin: B05OptionsDigestOrigin,
    evidence_artifact_digest: Option<&str>,
    evidence_assignment_digest: Option<&str>,
    fragmented_participants: &BTreeSet<String>,
) -> Result<B05SchoedelPreflightResult, B05PreflightError> {
    if !b05_schoedel_is_active(opts) {
        return Ok(B05SchoedelPreflightResult {
            protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
            disposition: ScientificPreflightDisposition::NotApplicable,
            options_digest: options_digest.into(),
            component_options_digest: component_options_digest.into(),
            screen_component_options_digest: screen_component_options_digest.into(),
            schoedel_component_options_digest: schoedel_component_options_digest.into(),
            options_digest_origin,
            requested_screen_strategy_id: opts.screen_session_construction_strategy,
            effective_screen_strategy_id: opts.screen_session_construction_strategy,
            requested_episode_strategy_id: opts
                .episode_reconstruction_strategy
                .canonical_id()
                .into(),
            effective_episode_strategy_id: None,
            screen_construction_phase: B05ComputationPhase::NotApplicable,
            schoedel_reconstruction_phase: B05ComputationPhase::NotApplicable,
            screen_construction: None,
            schoedel_reconstruction: None,
        });
    }
    let strategy = opts.screen_session_construction_strategy;
    let raw_events = raw_b05_events(raw_rows);
    let source_sensitive = strategy != ScreenSessionConstructionStrategyId::default();
    let evidence = if source_sensitive
        && fragmented_participants.is_empty()
        && !capability_evidence_csv.is_empty()
    {
        #[cfg(test)]
        B05_PREPARE_EVIDENCE_PARSE_COUNT.with(|count| count.set(count.get() + 1));
        let parsed = b05::parse_capability_evidence(capability_evidence_csv)?;
        if evidence_artifact_digest != Some(parsed.evidence_artifact_digest.as_str()) {
            return Err(B05PreflightError::EvidenceArtifactDigestMismatch);
        }
        Some(parsed)
    } else {
        // The detached Chronicle baseline deliberately does not parse, bind,
        // or validate an uploaded sidecar.
        None
    };
    // Only the source-sensitive B05 state machine belongs on the raw branch.
    // Chronicle is finalized from the established canonical/default screen
    // builder, and Schoedel always waits for B01 retention plus B02 opener
    // eligibility before reading app rows.
    let applicability_input = || b05::B05ApplicabilityInput {
        raw_input_sha256,
        raw_events: &raw_events,
        evidence: evidence.as_ref(),
        evidence_assignment_digest,
        options_digest,
        selection_was_explicit: opts.screen_session_construction_strategy_explicit,
        fragmented_participants,
    };
    let screen_construction = if source_sensitive {
        Some(b05::construct_screen_intervals(
            strategy,
            applicability_input(),
        )?)
    } else if !fragmented_participants.is_empty() {
        // Chronicle's canonical intervals are deliberately deferred, but an
        // executor-known fragmented participant is already a complete typed
        // refusal and must be visible before canonical parsing starts.
        Some(b05::adapt_chronicle_screen_intervals(
            applicability_input(),
            &[],
        )?)
    } else {
        None
    };
    let b05_refusal = screen_construction
        .as_ref()
        .filter(|output| !output.executable());
    let schoedel_reconstruction = if schoedel_is_active(opts) {
        b05_refusal.map(|output| b05::schoedel_b05_dependency_refusal(&output.applicability))
    } else {
        None
    };
    let disposition = if b05_refusal.is_some() {
        ScientificPreflightDisposition::Refused
    } else {
        ScientificPreflightDisposition::Executable
    };
    Ok(B05SchoedelPreflightResult {
        protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
        disposition,
        options_digest: options_digest.into(),
        component_options_digest: component_options_digest.into(),
        screen_component_options_digest: screen_component_options_digest.into(),
        schoedel_component_options_digest: schoedel_component_options_digest.into(),
        options_digest_origin,
        requested_screen_strategy_id: strategy,
        effective_screen_strategy_id: screen_construction
            .as_ref()
            .map(|output| output.applicability.effective_strategy_id)
            .unwrap_or(strategy),
        requested_episode_strategy_id: opts.episode_reconstruction_strategy.canonical_id().into(),
        effective_episode_strategy_id: schoedel_is_active(opts)
            .then(|| opts.episode_reconstruction_strategy.canonical_id().into()),
        screen_construction_phase: if source_sensitive {
            B05ComputationPhase::PreparedRawSourceArm
        } else if screen_construction.is_some() {
            B05ComputationPhase::Finalized
        } else {
            B05ComputationPhase::DeferredCanonicalBaseline
        },
        schoedel_reconstruction_phase: if !schoedel_is_active(opts) {
            B05ComputationPhase::NotApplicable
        } else if schoedel_reconstruction.is_some() {
            B05ComputationPhase::Finalized
        } else {
            B05ComputationPhase::DeferredRetainedAppStream
        },
        screen_construction,
        schoedel_reconstruction,
    })
}

pub fn b05_schoedel_is_active(opts: &PipelineV2Options) -> bool {
    matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    ) || schoedel_is_active(opts)
        || opts.screen_session_maximum_duration_disposition
            == super::ScreenSessionMaximumDurationDisposition::ExcludeParticipant
        || opts.locked_screen_audio_disposition
            == super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
}

/// Whether the reconstruction base carries every identity needed for reuse.
/// Source-sensitive B05 and locked-screen policy decisions require retained
/// raw evidence that the reconstructed row table cannot substitute for.
pub fn reconstruction_base_is_reusable(opts: &PipelineV2Options) -> bool {
    let source_sensitive_b05 = b05_schoedel_is_active(opts)
        && opts.screen_session_construction_strategy
            != ScreenSessionConstructionStrategyId::default();
    !source_sensitive_b05
        && !schoedel_is_active(opts)
        && opts.locked_screen_audio_disposition
            != super::LockedScreenAudioDisposition::ExcludeFromPhoneAndAppSessions
}

pub(crate) fn schoedel_is_active(opts: &PipelineV2Options) -> bool {
    matches!(
        opts.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    ) && opts.episode_reconstruction_strategy
        == EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1
}

pub(crate) fn b05_schoedel_refusal_error(preflight: &B05SchoedelPreflightResult) -> String {
    let b05_reason = preflight
        .screen_construction
        .as_ref()
        .filter(|output| !output.applicability.executable)
        .and_then(|output| output.applicability.refusal_reason)
        .map(b05::B05RefusalReason::canonical_id);
    let schoedel_reason = preflight
        .schoedel_reconstruction
        .as_ref()
        .filter(|output| !output.applicability.executable)
        .and_then(|output| output.applicability.refusal_reason)
        .map(b05::SchoedelRefusalReason::canonical_id);
    format!(
        "scientific_preflight_refused:b05={}:schoedel={}",
        b05_reason.unwrap_or("none"),
        schoedel_reason.unwrap_or("none"),
    )
}

pub(crate) fn b05_identity_from_support(support: PipelineV2SupportFiles<'_>) -> B05PreflightIdentity<'_> {
    B05PreflightIdentity {
        verified_request_options_digest: support.verified_request_options_digest,
        verified_evidence_artifact_digest: support
            .verified_input_capability_evidence_artifact_digest,
        verified_evidence_assignment_digest: support
            .verified_input_capability_evidence_assignment_digest,
    }
}

pub(crate) fn participant_input_boundary_from_support(
    support: PipelineV2SupportFiles<'_>,
) -> ParticipantInputBoundary<'_> {
    ParticipantInputBoundary {
        fragmented_participant_ids: support.fragmented_participant_ids,
    }
}

pub(crate) fn eyes_input_partition_identity_from_support(
    support: PipelineV2SupportFiles<'_>,
) -> EyesInputPartitionPreflightIdentity<'_> {
    EyesInputPartitionPreflightIdentity {
        verified_request_options_digest: support.verified_request_options_digest,
    }
}

/// Repeat the trust-boundary checks immediately before execution. This guard
/// is public so runtime can fail before entering the expensive reconstruction
/// cone while still publishing the prepared object's typed refusal receipt.
pub fn validate_prepared_b05_schoedel(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    prepared: &B05SchoedelPreparedInput,
) -> Result<(), B05PreparedExecutionError> {
    validate_prepared_b05_schoedel_with_input_boundary(
        raw_csv_bytes,
        opts,
        capability_evidence_csv,
        identity,
        B05InputBoundary::default(),
        prepared,
    )
}

pub fn validate_prepared_b05_schoedel_with_input_boundary(
    raw_csv_bytes: &[u8],
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
    prepared: &B05SchoedelPreparedInput,
) -> Result<(), B05PreparedExecutionError> {
    validate_prepared_b05_schoedel_with_raw_digest(
        &sha256_wire(raw_csv_bytes),
        opts,
        capability_evidence_csv,
        identity,
        input_boundary,
        prepared,
    )
}

/// `raw_input_sha256` must be `sha256_wire` of the raw bytes, computed by this
/// crate in the same call chain, so the tamper check still compares the bytes.
pub(crate) fn validate_prepared_b05_schoedel_with_raw_digest(
    raw_input_sha256: &str,
    opts: &PipelineV2Options,
    capability_evidence_csv: &[u8],
    identity: B05PreflightIdentity<'_>,
    input_boundary: B05InputBoundary<'_>,
    prepared: &B05SchoedelPreparedInput,
) -> Result<(), B05PreparedExecutionError> {
    if raw_input_sha256 != prepared.raw_input_sha256 {
        return Err(B05PreparedExecutionError::RawInputDigestMismatch);
    }
    if b05_router_options_digest(opts) != prepared.component_options_digest {
        return Err(B05PreparedExecutionError::ComponentOptionsDigestMismatch);
    }
    if b05_screen_options_digest(opts) != prepared.screen_component_options_digest {
        return Err(B05PreparedExecutionError::ScreenComponentOptionsDigestMismatch);
    }
    if schoedel_options_digest(opts) != prepared.schoedel_component_options_digest {
        return Err(B05PreparedExecutionError::SchoedelComponentOptionsDigestMismatch);
    }
    if identity.verified_request_options_digest
        != prepared.verified_request_options_digest.as_deref()
    {
        return Err(B05PreparedExecutionError::RequestOptionsDigestMismatch);
    }
    let source_screen_active = matches!(
        opts.usage_session_mode,
        UsageSessionMode::ScreenUsage | UsageSessionMode::AppAndScreenUsage
    ) && opts.screen_session_construction_strategy
        != ScreenSessionConstructionStrategyId::default();
    let fragmented_participants = input_boundary
        .fragmented_participant_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let evidence_bound =
        (source_screen_active || schoedel_is_active(opts)) && fragmented_participants.is_empty();
    let artifact_digest = (evidence_bound && !capability_evidence_csv.is_empty())
        .then(|| sha256_wire(capability_evidence_csv));
    if artifact_digest != prepared.evidence_artifact_digest {
        return Err(B05PreparedExecutionError::EvidenceArtifactDigestMismatch);
    }
    let verified_artifact = evidence_bound
        .then_some(identity.verified_evidence_artifact_digest)
        .flatten();
    if verified_artifact != prepared.verified_evidence_artifact_digest.as_deref() {
        return Err(B05PreparedExecutionError::EvidenceArtifactDigestMismatch);
    }
    let verified_assignment = evidence_bound
        .then_some(identity.verified_evidence_assignment_digest)
        .flatten();
    if verified_assignment != prepared.verified_evidence_assignment_digest.as_deref() {
        return Err(B05PreparedExecutionError::EvidenceAssignmentDigestMismatch);
    }
    if verified_assignment.is_some()
        && artifact_digest
            .as_deref()
            .map(b05_evidence_assignment_digest)
            .as_deref()
            != verified_assignment
    {
        return Err(B05PreparedExecutionError::EvidenceAssignmentDigestMismatch);
    }
    if b05_schoedel_is_active(opts) && fragmented_participants != prepared.fragmented_participants {
        return Err(B05PreparedExecutionError::FragmentedParticipantScopeMismatch);
    }
    if prepared.evidence.is_refused() {
        return Err(B05PreparedExecutionError::ScientificPreflightRefused);
    }
    Ok(())
}

/// The finalized B05/Schoedel receipt: the tracked engine binds it after
/// `construct_screen_intervals` and `reconstruct_schoedel_preflight`, the
/// sequential preflight after the same constructions with the sequential
/// helpers. One binder, so the two engines cannot disagree on the wire form.
pub(crate) fn bind_finalized_b05_preflight(
    options: &PipelineV2Options,
    verified_request_options_digest: Option<&str>,
    neutral_screen: &b05::ScreenConstructionOutput,
    schoedel_reconstruction: Option<b05::SchoedelReconstructionOutput>,
) -> B05SchoedelPreflightResult {
    let component_options_digest = b05_router_options_digest(options);
    let (options_digest, options_digest_origin) = verified_request_options_digest
        .map(|digest| {
            (
                digest.to_owned(),
                B05OptionsDigestOrigin::VerifiedRequestJcs,
            )
        })
        .unwrap_or_else(|| {
            (
                component_options_digest.clone(),
                B05OptionsDigestOrigin::KernelRouterComponent,
            )
        });
    let screen_construction = if options.screen_session_construction_strategy
        == ScreenSessionConstructionStrategyId::default()
    {
        b05::rebind_chronicle_screen_construction_receipt(
            neutral_screen,
            &options_digest,
            options.screen_session_construction_strategy_explicit,
        )
    } else {
        b05::rebind_screen_construction_options_digest(neutral_screen, &options_digest)
    };
    let disposition = if !screen_construction.executable()
        || schoedel_reconstruction
            .as_ref()
            .is_some_and(|value| !value.applicability.executable)
    {
        ScientificPreflightDisposition::Refused
    } else {
        ScientificPreflightDisposition::Executable
    };
    let schoedel_active = schoedel_is_active(options);
    B05SchoedelPreflightResult {
        protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
        disposition,
        options_digest,
        component_options_digest,
        screen_component_options_digest: b05_screen_options_digest(options),
        schoedel_component_options_digest: schoedel_options_digest(options),
        options_digest_origin,
        requested_screen_strategy_id: options.screen_session_construction_strategy,
        effective_screen_strategy_id: screen_construction.applicability.effective_strategy_id,
        requested_episode_strategy_id: options
            .episode_reconstruction_strategy
            .canonical_id()
            .into(),
        effective_episode_strategy_id: schoedel_active.then(|| {
            options
                .episode_reconstruction_strategy
                .canonical_id()
                .into()
        }),
        screen_construction_phase: B05ComputationPhase::Finalized,
        schoedel_reconstruction_phase: if schoedel_active {
            B05ComputationPhase::Finalized
        } else {
            B05ComputationPhase::NotApplicable
        },
        screen_construction: Some(screen_construction),
        schoedel_reconstruction,
    }
}

pub(crate) fn inactive_b05_preflight(
    options: &PipelineV2Options,
    verified_request_options_digest: Option<&str>,
) -> B05SchoedelPreflightResult {
    let component_options_digest = b05_router_options_digest(options);
    let (options_digest, options_digest_origin) = verified_request_options_digest
        .map(|digest| {
            (
                digest.to_owned(),
                B05OptionsDigestOrigin::VerifiedRequestJcs,
            )
        })
        .unwrap_or_else(|| {
            (
                component_options_digest.clone(),
                B05OptionsDigestOrigin::KernelRouterComponent,
            )
        });
    B05SchoedelPreflightResult {
        protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
        disposition: ScientificPreflightDisposition::NotApplicable,
        options_digest,
        component_options_digest,
        screen_component_options_digest: b05_screen_options_digest(options),
        schoedel_component_options_digest: schoedel_options_digest(options),
        options_digest_origin,
        requested_screen_strategy_id: options.screen_session_construction_strategy,
        effective_screen_strategy_id: options.screen_session_construction_strategy,
        requested_episode_strategy_id: options
            .episode_reconstruction_strategy
            .canonical_id()
            .into(),
        effective_episode_strategy_id: None,
        screen_construction_phase: B05ComputationPhase::NotApplicable,
        schoedel_reconstruction_phase: B05ComputationPhase::NotApplicable,
        screen_construction: None,
        schoedel_reconstruction: None,
    }
}

pub(crate) fn validate_verified_request_options_digest(digest: Option<&str>) -> Result<(), String> {
    if digest.is_some_and(|value| !valid_sha256_wire(value)) {
        return Err(B05PreflightError::InvalidVerifiedDigest(
            B05PreflightIdentityField::RequestOptionsDigest,
        )
        .to_string());
    }
    Ok(())
}

/// The decoded raw rows of a preflight and, once something reads them, the
/// canonical rows parsed from them. The raw table is consumed by the parse,
/// never copied beside it.
pub(crate) struct PreflightRows {
    pub(crate) raw_rows: Option<Arc<Vec<RawRow>>>,
    pub(crate) canonical: Option<Vec<Row>>,
}

impl PreflightRows {
    pub(crate) fn canonical(&mut self, stages: &super::StageFunctions, opts: &PipelineV2Options) -> Result<&[Row], String> {
        if self.canonical.is_none() {
            let raw_rows = self
                .raw_rows
                .take()
                .ok_or_else(|| "preflight raw rows already consumed".to_string())?;
            self.canonical = Some(canonical_rows_for_preflight(
                stages,
                Arc::unwrap_or_clone(raw_rows),
                opts,
            )?);
        }
        Ok(self.canonical.as_deref().expect("filled above"))
    }
}

/// `decode_source_records` through `derive_time_gap_evidence`: the helpers
/// the run and the tracked queries call, with no checkpoint recording.
pub(crate) fn canonical_rows_for_preflight(
    stages: &super::StageFunctions,
    raw_rows: Vec<RawRow>,
    opts: &PipelineV2Options,
) -> Result<Vec<Row>, String> {
    let interaction_remap = source::validate_remap_rules(&opts.interaction_type_remap);
    let raw_rows = source::remove_missing_timestamps(raw_rows);
    let possible_device_model = source::attach_device_models(&raw_rows);
    let rows = (stages.canonicalize_source_rows)(
        &raw_rows,
        &opts.timezone,
        &interaction_remap,
        &possible_device_model,
    )?;
    drop(raw_rows);
    let rows = source::order_source_records_with_policy(rows, opts.drop_out_of_source_order_events);
    let primary_timezone = source::estimate_dominant_timezone(&rows);
    let selection = source::resolve_timezone_strategy(
        Arc::new(rows),
        &opts.timezone,
        &opts.timezone_handling,
        &primary_timezone,
    )?;
    let rows = Arc::unwrap_or_clone(selection.rows);
    let rows = source::standardize_event_clock(rows, &selection.target_timezone)?;
    let deduped = source::coalesce_duplicate_event_keys(rows, opts.deduplicate_exact_rows);
    let dupe_corrected = source::disambiguate_duplicate_timestamps(
        deduped,
        opts.correct_duplicate_event_timestamps,
        &opts.same_app_stop_types,
        &opts.other_stop_types,
    )?;
    Ok(source::mark_gaps(dupe_corrected))
}

/// `parse_schoedel_capability_evidence_query` for the sequential preflight:
/// the optional sidecar, checked against the verified digests.
pub(crate) fn parse_schoedel_capability_evidence(
    support: PipelineV2SupportFiles<'_>,
) -> Result<Option<Arc<b05::ParsedCapabilityEvidence>>, String> {
    let bytes = support.input_capability_evidence_csv;
    let verified_artifact = support.verified_input_capability_evidence_artifact_digest;
    let verified_assignment = support.verified_input_capability_evidence_assignment_digest;
    if bytes.is_empty() {
        verify_schoedel_sidecar_identity(None, verified_artifact, verified_assignment)?;
        return Ok(None);
    }
    let artifact_digest = sha256_wire(bytes);
    verify_schoedel_sidecar_identity(Some(&artifact_digest), verified_artifact, verified_assignment)?;
    b05::parse_capability_evidence(bytes)
        .map(Arc::new)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Verify only identities already acquired by the caller. The tracked adapter
/// checks the artifact before acquiring the assignment identity.
pub(crate) fn verify_schoedel_sidecar_identity(
    artifact_digest: Option<&str>,
    verified_artifact: Option<&str>,
    verified_assignment: Option<&str>,
) -> Result<(), String> {
    let Some(artifact_digest) = artifact_digest else {
        return if verified_artifact.is_some() || verified_assignment.is_some() {
            Err(B05PreflightError::EvidenceIdentityWithoutArtifact.to_string())
        } else {
            Ok(())
        };
    };
    if verified_artifact.is_some_and(|verified| verified != artifact_digest) {
        return Err(B05PreflightError::EvidenceArtifactDigestMismatch.to_string());
    }
    if let Some(verified) = verified_assignment {
        let assignment_digest = b05_evidence_assignment_digest(artifact_digest);
        if verified != assignment_digest {
            return Err(B05PreflightError::EvidenceAssignmentDigestMismatch.to_string());
        }
    }
    Ok(())
}

pub(crate) fn build_b05_schoedel_validation_context(
    preflight: &B05SchoedelPreflightResult,
    foundational_evidence: &FoundationalSemanticsEvidence,
    opts: &PipelineV2Options,
    raw_input_digest: &str,
    raw_row_count: u64,
    original_count: u32,
    schoedel_witness: Option<&SchoedelValidationWitness>,
) -> Result<B05SchoedelValidationContext, String> {
    Ok(B05SchoedelValidationContext {
        receipt: build_b05_schoedel_validation_receipt(
            preflight,
            foundational_evidence,
            opts,
            raw_input_digest,
            raw_row_count,
            schoedel_witness,
        )?,
        result_original_row_count: original_count,
        foundational_semantics_evidence_jcs_digest: sha256_jcs(
            foundational_evidence,
            "serialize foundational semantics evidence",
        )?,
        expected_options_digest: preflight.options_digest.clone(),
        expected_options_digest_origin: preflight.options_digest_origin,
    })
}

pub(crate) fn build_eyes_tagged_fau_validation_context(
    evidence: &[crate::eyes_complement::EyesParticipantTaggedFauEvidence],
    expected_participant_ids: BTreeSet<String>,
    final_partition: &EyesInputPartitionPreflightResult,
    opts: &PipelineV2Options,
    raw_input_digest: &str,
    raw_row_count: u64,
) -> Result<EyesTaggedFauValidationContext, String> {
    let receipt = build_eyes_tagged_fau_validation_receipt(
        evidence,
        &expected_participant_ids,
        final_partition,
        opts,
        raw_input_digest,
        raw_row_count,
        &final_partition.options_digest,
        final_partition.options_digest_origin,
    )?;
    Ok(EyesTaggedFauValidationContext {
        receipt,
        expected_participant_ids,
        expected_raw_input_digest: raw_input_digest.to_owned(),
        expected_options_digest: final_partition.options_digest.clone(),
        expected_options_digest_origin: Some(final_partition.options_digest_origin),
    })
}

pub(crate) fn neutral_chronicle_screen_construction(
    raw_input_sha256: &str,
    raw_events: &[b05::RawB05Event],
    fragmented_participants: &BTreeSet<String>,
    intervals: &[b05::ChronicleScreenIntervalInput],
    issues: &[b05::ScreenConstructionIssue],
) -> Result<b05::ScreenConstructionOutput, String> {
    let options_digest = b05_screen_strategy_digest(
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
    );
    let input = b05::B05ApplicabilityInput {
        raw_input_sha256,
        raw_events,
        evidence: None,
        evidence_assignment_digest: None,
        options_digest: &options_digest,
        selection_was_explicit: false,
        fragmented_participants,
    };
    if !fragmented_participants.is_empty() {
        b05::adapt_chronicle_screen_intervals(input, &[])
    } else {
        b05::adapt_chronicle_screen_intervals_with_issues(input, intervals, issues)
    }
    .map_err(|error| error.to_string())
}
