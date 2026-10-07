use crate::pipeline_v2::support::AppFilterRules;
use crate::pipeline_v2::{
    ACTIVITY_PAUSED, ACTIVITY_RESUMED, ACTIVITY_STOPPED, AHashMap, AHashSet,
    ANDROID_PSEUDO_PACKAGE, APP_USAGE, Arc, BTreeMap, BTreeSet, CheckpointHasher,
    DRAXLER_INACTIVITY_NS, END_OF_USAGE_MISSING, EpisodeCloseReason, EpisodeReconstructionStrategy,
    EventRetentionSet, FILTERED_APP_BACKGROUND_USAGE, FILTERED_APP_USAGE, FILTERED_PAUSED,
    FILTERED_RESUMED, FILTERED_STOPPED, GESIS_EVENT_THRESHOLD, GESIS_MAX_TIMEOUT_NS,
    GESIS_START_EVENTS, GESIS_STOP_EVENTS, GESIS_UNMATCHABLE_STOP_EVENTS,
    InlineLineageDigest, LineageSearchDigest, LineageSearchEvidence, MORRISON_LOCK_TIMEOUT_NS,
    MatcherInput, MatcherOutput, MergedMatcherOutput, MicroUseClassification,
    MicroUseClassificationPolicy, MinimumDurationComparator, MinimumDurationDisposition,
    OKOSHI_MICRO_USE_THRESHOLD_NS, OnceLock, OpenerSet, OpenerSetEvidence, PipelineV2Options, Row,
    SCREEN_START_EVENTS, SCREEN_STOP_EVENTS, SharedString, SourceDataRows, UsageLayer, b05,
    b05_evidence_assignment_digest, b06, checkpoint_digest_field, minimum_duration_threshold_ns,
    shared_lineage_text, split_overlapping_sessions,
};

/// Apply an event-retention set to a standardized row stream.
///
/// Returns the rows untouched under `None` so the production path allocates
/// nothing and cannot reorder.
pub(crate) fn apply_event_retention(rows: Vec<Row>, set: EventRetentionSet) -> Vec<Row> {
    if set == EventRetentionSet::None {
        return rows;
    }
    rows.into_iter()
        .filter(|row| set.retains(row.interaction_type.as_str()))
        .collect()
}

pub(crate) fn label_filtered_apps(mut rows: Vec<Row>, rules: &AppFilterRules) -> Vec<Row> {
    if rules.packages.is_empty() {
        return rows;
    }
    for row in rows.iter_mut() {
        let package_match = rules
            .packages
            .get(row.app_package_name.as_str())
            .is_some_and(|labels| {
                labels.is_empty() || labels.contains(row.application_label.as_str())
            });
        if !package_match {
            continue;
        }
        let replacement = match row.interaction_type.as_str() {
            ACTIVITY_RESUMED => Some(FILTERED_RESUMED),
            ACTIVITY_PAUSED => Some(FILTERED_PAUSED),
            ACTIVITY_STOPPED => Some(FILTERED_STOPPED),
            "Activity Destroyed" => Some("Filtered App Destroyed"),
            APP_USAGE => Some(FILTERED_APP_USAGE),
            _ => None,
        };
        if let Some(replacement) = replacement {
            *row.edit_classification().interaction_type = replacement.into();
        }
    }
    rows
}

pub(crate) fn encode_blake3_digest(digest: [u8; 32]) -> [u8; 71] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = [0_u8; 71];
    encoded[..7].copy_from_slice(b"blake3:");
    for (index, byte) in digest.iter().copied().enumerate() {
        encoded[7 + index * 2] = HEX[(byte >> 4) as usize];
        encoded[8 + index * 2] = HEX[(byte & 0x0f) as usize];
    }
    encoded
}

pub(crate) fn inline_lineage_search_suffix_digest(
    row: &Row,
    event_index: usize,
    next_digest: Option<&InlineLineageDigest>,
) -> InlineLineageDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&(event_index as u64).to_le_bytes());
    checkpoint_digest_field(&mut hasher, row.participant_id.as_bytes());
    hasher.update(&row.event_timestamp_ns.to_le_bytes());
    checkpoint_digest_field(&mut hasher, row.interaction_type.as_bytes());
    checkpoint_digest_field(&mut hasher, row.app_package_name.as_bytes());
    hasher.update(&(row.source_data_rows.ranges().len() as u64).to_le_bytes());
    for source_range in row.source_data_rows.ranges() {
        hasher.update(&source_range.first.to_le_bytes());
        hasher.update(&source_range.last.to_le_bytes());
    }
    match next_digest {
        Some(digest) => {
            hasher.update(&[1]);
            checkpoint_digest_field(&mut hasher, &digest.encoded());
        }
        None => {
            hasher.update(&[0]);
        }
    }
    InlineLineageDigest::from_hasher(hasher)
}

pub(crate) fn empty_lineage_search_suffix_digest(event_index: u32) -> String {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&event_index.to_le_bytes());
    hasher.update(&0_u32.to_le_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

pub(crate) fn empty_inline_lineage_search_suffix_digest(event_index: u32) -> InlineLineageDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-chain/v1");
    hasher.update(&event_index.to_le_bytes());
    hasher.update(&0_u32.to_le_bytes());
    InlineLineageDigest::from_hasher(hasher)
}

pub(crate) fn inline_lineage_search_suffix_digests(rows: &[Row]) -> Vec<InlineLineageDigest> {
    let empty_suffix = empty_inline_lineage_search_suffix_digest(rows.len() as u32);
    let mut suffix_digests = vec![empty_suffix; rows.len() + 1];
    for index in (0..rows.len()).rev() {
        suffix_digests[index] = inline_lineage_search_suffix_digest(
            &rows[index],
            index,
            Some(&suffix_digests[index + 1]),
        );
    }
    suffix_digests
}

pub(crate) fn lineage_search_range_digest(
    suffix_digests: &[String],
    start_event_index: u32,
    end_event_index_exclusive: u32,
) -> LineageSearchDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-range/v1");
    hasher.update(&start_event_index.to_le_bytes());
    hasher.update(&end_event_index_exclusive.to_le_bytes());
    checkpoint_digest_field(
        &mut hasher,
        suffix_digests[start_event_index as usize].as_bytes(),
    );
    checkpoint_digest_field(
        &mut hasher,
        suffix_digests[end_event_index_exclusive as usize].as_bytes(),
    );
    LineageSearchDigest::from_hasher(hasher)
}

pub(crate) fn inline_lineage_search_range_digest(
    suffix_digests: &[InlineLineageDigest],
    start_event_index: u32,
    end_event_index_exclusive: u32,
) -> LineageSearchDigest {
    let mut hasher = CheckpointHasher::new();
    checkpoint_digest_field(&mut hasher, b"chronicle-lineage-search-range/v1");
    hasher.update(&start_event_index.to_le_bytes());
    hasher.update(&end_event_index_exclusive.to_le_bytes());
    checkpoint_digest_field(
        &mut hasher,
        &suffix_digests[start_event_index as usize].encoded(),
    );
    checkpoint_digest_field(
        &mut hasher,
        &suffix_digests[end_event_index_exclusive as usize].encoded(),
    );
    LineageSearchDigest::from_hasher(hasher)
}

pub(crate) fn schoedel_opener_eligible(row: &Row, opener_set: OpenerSet) -> bool {
    match opener_set {
        OpenerSet::StrategyDefined => row.interaction_type == ACTIVITY_RESUMED,
        explicit => explicit.explicit_eligible(row.interaction_type.as_str()),
    }
}

pub(crate) fn retained_schoedel_events(
    rows: &[Row],
    opener_set: OpenerSet,
    original_raw_events: &[b05::RawB05Event],
) -> Result<Vec<b05::RawB05Event>, String> {
    let raw_by_source = original_raw_events
        .iter()
        .map(|event| (event.source_data_row, event))
        .collect::<BTreeMap<_, _>>();
    rows.iter()
        .filter_map(|row| {
            let source_data_row = row.source_data_rows.iter().next()?;
            Some((source_data_row, row))
        })
        .map(|(source_data_row, row)| {
            let mut event = raw_by_source
                .get(&source_data_row)
                .copied()
                .cloned()
                .ok_or_else(|| {
                    "schoedel_materialization_error:raw_source_row_missing".to_string()
                })?;
            event.app_opener_eligible = schoedel_opener_eligible(row, opener_set);
            event.source_data_rows = row.source_data_rows.iter().collect();
            Ok(event)
        })
        .collect()
}

pub(crate) fn schoedel_opener_evidence(
    rows: &[Row],
    episodes: &[b05::SchoedelEpisodeEvidence],
    opener_set: OpenerSet,
) -> OpenerSetEvidence {
    let mut selected_opener_type_counts = BTreeMap::new();
    let mut label_by_source_row = BTreeMap::new();
    for row in rows {
        if let Some(source_row) = row.source_data_rows.iter().next() {
            label_by_source_row.insert(source_row, row.interaction_type.to_string());
        }
        if schoedel_opener_eligible(row, opener_set) {
            *selected_opener_type_counts
                .entry(row.interaction_type.to_string())
                .or_insert(0) += 1;
        }
    }
    let mut materialized_opener_type_counts = BTreeMap::new();
    for episode in episodes
        .iter()
        .filter(|episode| episode.bounded_headline_candidate)
    {
        if let Some(label) = label_by_source_row.get(&episode.start_source_row) {
            *materialized_opener_type_counts
                .entry(label.clone())
                .or_insert(0) += 1;
        }
    }
    let suppressed_device_opener_count = if opener_set == OpenerSet::GesisAppScopedStarts {
        rows.iter()
            .filter(|row| {
                matches!(
                    row.interaction_type.as_str(),
                    "Screen Interactive"
                        | "Screen Interactive/Keyguard Shown"
                        | "Keyguard Hidden"
                        | "Device Startup"
                )
            })
            .count() as u32
    } else {
        0
    };
    OpenerSetEvidence {
        applicability: opener_set
            .applicability(EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1),
        suppressed_device_opener_count,
        selected_opener_type_counts,
        materialized_opener_type_counts,
    }
}

pub(crate) fn materialize_schoedel_candidate_rows(
    rows: &[Row],
    reconstruction: &b05::SchoedelReconstructionOutput,
) -> Result<(Vec<Row>, Vec<usize>), String> {
    let row_by_source = rows
        .iter()
        .flat_map(|row| row.source_data_rows.iter().map(move |source| (source, row)))
        .collect::<BTreeMap<_, _>>();
    let mut bounded_rows = Vec::with_capacity(reconstruction.episodes.len());
    let mut unbounded_rows = Vec::new();
    let mut selected_nonresume_closed_indices = Vec::new();
    for episode in &reconstruction.episodes {
        let source = row_by_source
            .get(&episode.start_source_row)
            .ok_or_else(|| "schoedel_materialization_error:start_source_row_missing".to_string())?;
        let mut row = (*source).clone();
        let mut lineage = SourceDataRows::default();
        for source_row in &episode.source_rows {
            lineage.merge(&SourceDataRows::single(*source_row));
        }
        let data = row.edit_all();
        data.source_data_rows = lineage;
        data.start_timestamp_ns = Some(episode.start_ns);
        data.stop_timestamp_ns = episode.stop_ns;
        data.screen_interval_id = Some(episode.screen_interval_id.as_str().into());
        data.schoedel_completion = Some(episode.completion);
        // The projection layer decides whether to emit this optional column.
        // Keeping the completion on the internal row makes the tracked
        // reconstruction independent of view-only output settings.
        data.app_usage_end_reason = Some(episode.completion.canonical_id().into());
        if episode.bounded_headline_candidate {
            let row_index = bounded_rows.len();
            if row.interaction_type != ACTIVITY_RESUMED {
                selected_nonresume_closed_indices.push(row_index);
            }
            bounded_rows.push(row);
        } else {
            let data = row.edit_all();
            data.interaction_type = END_OF_USAGE_MISSING.into();
            data.raw_episode_start_timestamp_ns = Some(episode.start_ns);
            data.raw_episode_stop_timestamp_ns = None;
            data.raw_episode_duration_ns = None;
            data.duration_seconds = None;
            data.duration_minutes = None;
            // Provisional; the shared classify_episode_durations stage
            // re-stamps micro-use and qualification on every
            // END_OF_USAGE_MISSING row regardless of strategy.
            data.micro_use_classification = None;
            data.minimum_duration_qualified = None;
            // minimum_duration_aggregate_eligible is deliberately NOT
            // touched: per its field contract only a qualifying episode
            // under retain_but_exclude makes it false, and an unbounded
            // episode never qualifies. Forcing false here diverged from the
            // fused path and failed the reconstruction-base foundational
            // disposition validation (the schoedelprose influence case).
            unbounded_rows.push(row);
        }
    }
    bounded_rows.extend(unbounded_rows);
    Ok((bounded_rows, selected_nonresume_closed_indices))
}

pub(crate) struct BoundSchoedelReconstruction {
    pub(crate) reconstruction: b05::SchoedelReconstructionOutput,
    pub(crate) retained_events: Vec<b05::RawB05Event>,
    pub(crate) participant_ids: BTreeSet<String>,
}

/// The Schoedel prose reconstruction bound to the finalized screen
/// construction, over the retained event stream. Shared by the app algorithm
/// and the sequential scientific preflight; the tracked
/// `reconstruct_schoedel_preflight` binds the same inputs.
pub(crate) fn bound_schoedel_reconstruction(
    rows: &[Row],
    opts: &PipelineV2Options,
    original_raw_events: &[b05::RawB05Event],
    raw_input_sha256: &str,
    parsed_capability_evidence: Option<&b05::ParsedCapabilityEvidence>,
    screen: &b05::ScreenConstructionOutput,
) -> Result<BoundSchoedelReconstruction, String> {
    let retained_events = retained_schoedel_events(rows, opts.opener_set, original_raw_events)?;
    let participant_ids =
        b05::schoedel_decisive_equal_timestamp_participants(&retained_events, &screen.intervals);
    let evidence_assignment_digest = parsed_capability_evidence
        .map(|evidence| b05_evidence_assignment_digest(&evidence.evidence_artifact_digest));
    b05::validate_bound_capability_evidence(
        raw_input_sha256,
        original_raw_events,
        parsed_capability_evidence,
    )
    .map_err(|error| error.to_string())?;
    let source_order_resolution = b05::resolve_schoedel_source_order_capability(
        raw_input_sha256,
        &participant_ids,
        parsed_capability_evidence,
        evidence_assignment_digest.as_deref(),
    );
    let reconstruction = b05::reconstruct_bound_schoedel_prose(b05::BoundSchoedelProseInput {
        raw_events: &retained_events,
        screen_intervals: &screen.intervals,
        selected_b05_strategy_id: opts.screen_session_construction_strategy,
        equal_timestamp_source_order_preserved: false,
        source_order_resolution: Some(&source_order_resolution),
    });
    Ok(BoundSchoedelReconstruction {
        reconstruction,
        retained_events,
        participant_ids,
    })
}

pub(crate) fn mark_app_policy_matches(
    rows: Vec<Row>,
    enabled: bool,
    filter_rules: &AppFilterRules,
) -> Vec<Row> {
    if enabled {
        label_filtered_apps(rows, filter_rules)
    } else {
        rows
    }
}

pub(crate) fn resolve_excluded_packages(rows: &[Row]) -> BTreeSet<String> {
    rows.iter()
        .filter(|row| {
            matches!(
                row.interaction_type.as_str(),
                FILTERED_RESUMED
                    | FILTERED_PAUSED
                    | FILTERED_STOPPED
                    | "Filtered App Destroyed"
                    | FILTERED_APP_USAGE
                    | FILTERED_APP_BACKGROUND_USAGE
            )
        })
        .map(|row| row.app_package_name.to_string())
        .collect()
}

pub(crate) fn mask_excluded_app_events(mut rows: Vec<Row>) -> Vec<Row> {
    for row in &mut rows {
        let replacement = match row.interaction_type.as_str() {
            FILTERED_RESUMED => Some(ACTIVITY_RESUMED),
            FILTERED_PAUSED => Some(ACTIVITY_PAUSED),
            FILTERED_STOPPED => Some(ACTIVITY_STOPPED),
            "Filtered App Destroyed" => Some("Activity Destroyed"),
            _ => None,
        };
        if let Some(replacement) = replacement {
            *row.edit_classification().interaction_type = replacement.into();
        }
    }
    rows
}

pub(crate) fn build_app_event_index(
    rows: &[Row],
    same_stop_types: &[String],
    other_stop_types: &[String],
    background_apps: &AHashSet<String>,
    model_concurrent_usage: bool,
) -> Result<MatcherInput, String> {
    let same_stop_types = same_stop_types
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    let other_stop_types = other_stop_types
        .iter()
        .map(String::as_str)
        .collect::<AHashSet<_>>();
    let mut resumed = Vec::with_capacity(rows.len());
    let mut same_stop = Vec::with_capacity(rows.len());
    let mut other_stop = Vec::with_capacity(rows.len());
    let mut stopped = Vec::with_capacity(rows.len());
    let mut background = Vec::with_capacity(rows.len());
    let mut app_codes = Vec::with_capacity(rows.len());
    let mut timestamps = Vec::with_capacity(rows.len());
    let mut app_code_lookup: AHashMap<&str, i32> = AHashMap::new();
    for row in rows {
        let interaction = row.interaction_type.as_str();
        let package = row.app_package_name.as_str();
        let next_code = app_code_lookup.len() as i32;
        app_codes.push(*app_code_lookup.entry(package).or_insert(next_code));
        timestamps.push(row.event_timestamp_ns);
        let is_background = background_apps.contains(package);
        resumed.push(interaction == ACTIVITY_RESUMED);
        same_stop.push(if is_background {
            interaction == ACTIVITY_RESUMED || interaction == ACTIVITY_STOPPED
        } else {
            same_stop_types.contains(interaction)
        });
        other_stop.push(!model_concurrent_usage && other_stop_types.contains(interaction));
        stopped.push(!is_background && interaction == ACTIVITY_STOPPED);
        background.push(is_background);
    }
    Ok(MatcherInput {
        app_codes,
        timestamps,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    })
}

// Store-only codec: public serde deliberately omits producer witnesses. The
// Schoedel receipt has JSON-only optional fields; rows still use the exact
// existing binary Row codec, including the population's string table.
pub(crate) fn encode_matcher_payload(output: &MatcherOutput) -> Result<Vec<u8>, String> {
    let MatcherOutput {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns,
        start_timestamps_ns,
        selected_nonresume_closed_indices,
        opener_set_evidence,
        eyes_tagged_fau_evidence,
        eyes_validation_expected_participant_ids,
        schoedel_reconstruction,
        schoedel_candidate_rows,
        schoedel_validation_witness,
    } = output;
    let schoedel_reconstruction = serde_json::to_vec(schoedel_reconstruction).map_err(|error| error.to_string())?;
    postcard::to_allocvec(&(
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns,
        start_timestamps_ns,
        selected_nonresume_closed_indices,
        opener_set_evidence,
        eyes_tagged_fau_evidence,
        eyes_validation_expected_participant_ids,
        schoedel_reconstruction,
        schoedel_candidate_rows,
        schoedel_validation_witness,
    )).map_err(|error| error.to_string())
}

pub(crate) fn decode_matcher_payload(bytes: &[u8]) -> Result<MatcherOutput, String> {
    let (
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns,
        start_timestamps_ns,
        selected_nonresume_closed_indices,
        opener_set_evidence,
        eyes_tagged_fau_evidence,
        eyes_validation_expected_participant_ids,
        schoedel_reconstruction,
        schoedel_candidate_rows,
        schoedel_validation_witness,
    ) = postcard::from_bytes(bytes).map_err(|error| error.to_string())?;
    let schoedel_reconstruction: Vec<u8> = schoedel_reconstruction;
    let schoedel_reconstruction = serde_json::from_slice(&schoedel_reconstruction).map_err(|error| error.to_string())?;
    Ok(MatcherOutput {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns,
        start_timestamps_ns,
        selected_nonresume_closed_indices,
        opener_set_evidence,
        eyes_tagged_fau_evidence,
        eyes_validation_expected_participant_ids,
        schoedel_reconstruction,
        schoedel_candidate_rows,
        schoedel_validation_witness,
    })
}

/// Dispatch the declared episode-reconstruction rule.
///
/// This is the single seam where a `ReconstructionStrategyId` becomes a runtime
/// choice. Every arm consumes the same `MatcherInput` and produces the same
/// `MatcherOutput`, so everything downstream — materialization, duration
/// classification, provenance — is unchanged by the choice.
///
/// `FusedMatcher` is the production path and reproduces the previous behaviour
/// exactly; the other arms are opt-in.
///
/// Every rule below pairs a start row with some *later* row, and none of them
/// reads `participant_id`. One raw export may carry several participants, and
/// `order_source_records` sorts by timestamp alone, so their events interleave.
/// Left unpartitioned, a start belonging to P01 closes on P02's next stop and
/// one participant's screen time is charged to the other — confirmed for all
/// four rules by `an_episode_never_closes_on_another_participants_event`.
/// Package identity does not prevent it, because participants share apps.
///
/// So the participant boundary is enforced here, once, rather than in each
/// rule: every rule already answers correctly for a single-participant stream,
/// and that is exactly what each gets. A single-participant input takes the
/// unpartitioned path untouched, which is why the goldens do not move.
#[allow(clippy::too_many_arguments)]
pub(crate) fn match_app_episodes_with_strategy(
    input: &MatcherInput,
    rows: &[Row],
    strategy: EpisodeReconstructionStrategy,
    opener_set: OpenerSet,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
    proximity_interval_ns: i64,
) -> Result<MatcherOutput, String> {
    if input.app_codes.len() != rows.len() {
        return Err(format!(
            "matcher: index has {} events but {} rows were supplied; \
             the two views must describe the same events",
            input.app_codes.len(),
            rows.len()
        ));
    }

    let applicability = opener_set.applicability(strategy);
    if !applicability.is_executable() {
        let reason = applicability
            .refusal_reason
            .expect("a refused opener crossing must carry a reason");
        return Err(format!(
            "opener_set_refused:{}:{}:{}",
            opener_set.canonical_id(),
            strategy.canonical_id(),
            reason.canonical_id(),
        ));
    }
    let eligible_opener: Vec<bool> = rows
        .iter()
        .map(|row| match opener_set {
            OpenerSet::StrategyDefined => match strategy {
                EpisodeReconstructionStrategy::GesisStartStopRepair => {
                    GESIS_START_EVENTS.contains(&row.interaction_type.as_str())
                }
                _ => row.interaction_type == ACTIVITY_RESUMED,
            },
            explicit => explicit.explicit_eligible(row.interaction_type.as_str()),
        })
        .collect();
    // This was formerly enforced in `build_app_event_index`, before B02 had a
    // chance to admit a type-19-only input. Preserve the default resume/pause
    // error while validating explicit arms against their resolved eligibility.
    let has_pause = rows
        .iter()
        .any(|row| row.interaction_type == ACTIVITY_PAUSED);
    let has_valid_usage_signal = if opener_set == OpenerSet::StrategyDefined {
        // The old pre-B02 guard was evaluated before strategy dispatch and
        // admitted only a native resume or pause. In particular, default
        // GESIS must not let its internal device-scoped Start rows turn a
        // device-only file into valid app data. Explicit arms deliberately use
        // their resolved opener eligibility so a type-19-only input can run.
        input.resumed.iter().any(|&resumed| resumed) || has_pause
    } else {
        eligible_opener.iter().any(|&eligible| eligible) || has_pause
    };
    if !has_valid_usage_signal {
        return Err("No valid app usage data during the study period".to_string());
    }

    let mut selected_opener_type_counts = BTreeMap::new();
    for (row, &eligible) in rows.iter().zip(&eligible_opener) {
        if eligible {
            *selected_opener_type_counts
                .entry(row.interaction_type.to_string())
                .or_insert(0) += 1;
        }
    }
    let suppressed_device_opener_count = if opener_set == OpenerSet::GesisAppScopedStarts {
        rows.iter()
            .filter(|row| {
                matches!(
                    row.interaction_type.as_str(),
                    "Screen Interactive"
                        | "Screen Interactive/Keyguard Shown"
                        | "Keyguard Hidden"
                        | "Device Startup"
                )
            })
            .count() as u32
    } else {
        0
    };
    let evidence = OpenerSetEvidence {
        applicability,
        suppressed_device_opener_count,
        selected_opener_type_counts,
        materialized_opener_type_counts: BTreeMap::new(),
    };

    let mut order: Vec<&str> = Vec::new();
    let mut groups: AHashMap<&str, Vec<usize>> = AHashMap::new();
    for (index, row) in rows.iter().enumerate() {
        let participant = row.participant_id.as_str();
        groups
            .entry(participant)
            .or_insert_with(|| {
                order.push(participant);
                Vec::new()
            })
            .push(index);
    }

    if order.len() <= 1 {
        let mut output = match_app_episodes_for_one_participant(
            input,
            rows,
            &eligible_opener,
            strategy,
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
            proximity_interval_ns,
        )?;
        finalize_opener_output(&mut output, rows, opener_set, evidence);
        return Ok(output);
    }

    let mut merged = MergedMatcherOutput::default();
    for participant in order {
        let indices = &groups[participant];
        let sub_input = MatcherInput {
            app_codes: gather(&input.app_codes, indices),
            timestamps: gather(&input.timestamps, indices),
            resumed: gather(&input.resumed, indices),
            same_stop: gather(&input.same_stop, indices),
            other_stop: gather(&input.other_stop, indices),
            stopped: gather(&input.stopped, indices),
            background: gather(&input.background, indices),
        };
        let sub_rows = gather(rows, indices);
        let sub_eligible_opener = gather(&eligible_opener, indices);
        // A participant whose slice holds no resume or pause is not an error
        // here the way it is for a whole export: the other participants still
        // have data. `build_app_event_index` rejects that case up front, so
        // reaching it now would mean the slice lost events, not that the study
        // is empty — but the rules simply return nothing for it, so skip.
        if !sub_eligible_opener.iter().any(|&eligible| eligible)
            && !sub_rows
                .iter()
                .any(|row| row.interaction_type == ACTIVITY_PAUSED)
        {
            continue;
        }
        let output = match_app_episodes_for_one_participant(
            &sub_input,
            &sub_rows,
            &sub_eligible_opener,
            strategy,
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
            proximity_interval_ns,
        )?;
        merged.absorb(output, indices);
    }
    let mut output = merged.into_output();
    finalize_opener_output(&mut output, rows, opener_set, evidence);
    Ok(output)
}

pub(crate) fn finalize_opener_output(
    output: &mut MatcherOutput,
    rows: &[Row],
    opener_set: OpenerSet,
    mut evidence: OpenerSetEvidence,
) {
    let mut closed: BTreeSet<usize> = output.stop_start_indices.iter().copied().collect();
    // A duplicated EYES fragment is one materialized opener, not several source
    // events. BTreeSet also makes the evidence order deterministic.
    for &index in &closed {
        let native_resume = rows[index].interaction_type == ACTIVITY_RESUMED;
        if native_resume || opener_set != OpenerSet::StrategyDefined {
            *evidence
                .materialized_opener_type_counts
                .entry(rows[index].interaction_type.to_string())
                .or_insert(0) += 1;
        }
        if opener_set != OpenerSet::StrategyDefined && !native_resume {
            output.selected_nonresume_closed_indices.push(index);
        }
    }
    output.selected_nonresume_closed_indices.sort_unstable();
    output.selected_nonresume_closed_indices.dedup();
    output.opener_set_evidence = evidence;
    closed.clear();
}

pub(crate) fn gather<T: Clone>(values: &[T], indices: &[usize]) -> Vec<T> {
    indices.iter().map(|&index| values[index].clone()).collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn match_app_episodes_for_one_participant(
    input: &MatcherInput,
    rows: &[Row],
    eligible_opener: &[bool],
    strategy: EpisodeReconstructionStrategy,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
    proximity_interval_ns: i64,
) -> Result<MatcherOutput, String> {
    use EpisodeReconstructionStrategy as Strategy;
    match strategy {
        Strategy::FusedMatcher => match_app_episodes(
            input,
            eligible_opener,
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
            proximity_interval_ns,
        ),
        Strategy::ParryTothForwardPairing => {
            // Their rule closes an episode on a screen transition as well as on
            // a foreground handover, so it needs `rows` for the screen stream —
            // `MatcherInput` carries only app-event flags. `rows` and every
            // `MatcherInput` array are built in the same pass over the same
            // slice in `build_app_event_index`, so index i denotes the same
            // event in both and the derived flags below stay aligned.
            //
            // These are read from the canonical interaction-type constants, not
            // from `same_stop_types`/`other_stop_types`: those are user options,
            // and this arm reproduces a fixed published rule. None of the
            // MatchOptions above are consulted for the same reason.
            let paused: Vec<bool> = rows
                .iter()
                .map(|row| row.interaction_type.as_str() == ACTIVITY_PAUSED)
                .collect();
            let screen_off: Vec<bool> = rows
                .iter()
                .map(|row| SCREEN_STOP_EVENTS.contains(&row.interaction_type.as_str()))
                .collect();
            // Their reference excludes the "android" system pseudo-package from
            // opening an episode, while still letting it close one.
            let android_pseudo_package: Vec<bool> = rows
                .iter()
                .map(|row| row.app_package_name.as_str() == ANDROID_PSEUDO_PACKAGE)
                .collect();
            let result =
                _rust_app_usage_matcher::match_app_usage_forward_pairing_with_openers_indices_core(
                    &input.app_codes,
                    &input.timestamps,
                    eligible_opener,
                    &input.resumed,
                    &paused,
                    &screen_off,
                    &android_pseudo_package,
                )
                .map_err(|error| format!("matcher: {error}"))?;
            // No rule in the matcher crate splits an episode, so every episode
            // begins at its own start row.
            let whole_episode_starts = vec![None; result.stop_start_indices.len()];
            Ok(MatcherOutput {
                start_indices: result.start_indices,
                stop_start_indices: result.stop_start_indices,
                stop_event_indices: result.stop_event_indices,
                missing_indices: result.missing_indices,
                stop_reasons: result.stop_reasons,
                missing_reasons: result.missing_reasons,
                stop_timestamps_ns: result.stop_timestamps_ns,
                start_timestamps_ns: whole_episode_starts,
                selected_nonresume_closed_indices: Vec::new(),
                opener_set_evidence: OpenerSetEvidence::default(),
                eyes_tagged_fau_evidence: Vec::new(),
                eyes_validation_expected_participant_ids: BTreeSet::new(),
                schoedel_reconstruction: None,
                schoedel_candidate_rows: None,
                schoedel_validation_witness: None,
            })
        }
        Strategy::EyesComplement => {
            eyes_complement_episodes(rows, eligible_opener, proximity_interval_ns)
        }
        Strategy::GesisStartStopRepair => {
            // Their rule reads a much wider event vocabulary than this engine's
            // own open/close flags encode — screen, keyguard and device-power
            // rows are starts and stops to them — so the classification comes
            // from `rows` and the canonical GESIS label sets, not from
            // `input.resumed`/`input.same_stop`. As in the forward-pairing arm,
            // `rows` and every `MatcherInput` array are built in one pass over
            // the same slice, so index i is the same event in both.
            //
            // None of the `MatchOptions` are consulted: this reproduces a fixed
            // published rule with the tutorial's own constants.
            let is_start: Vec<bool> = rows
                .iter()
                .map(|row| GESIS_START_EVENTS.contains(&row.interaction_type.as_str()))
                .collect();
            let is_stop: Vec<bool> = rows
                .iter()
                .map(|row| GESIS_STOP_EVENTS.contains(&row.interaction_type.as_str()))
                .collect();
            let stop_matchable: Vec<bool> = rows
                .iter()
                .map(|row| !GESIS_UNMATCHABLE_STOP_EVENTS.contains(&row.interaction_type.as_str()))
                .collect();
            let android_pseudo_package: Vec<bool> = rows
                .iter()
                .map(|row| row.app_package_name.as_str() == ANDROID_PSEUDO_PACKAGE)
                .collect();
            let result = _rust_app_usage_matcher::match_app_usage_gesis_with_openers_indices_core(
                &input.app_codes,
                &input.timestamps,
                eligible_opener,
                &is_start,
                &is_stop,
                &stop_matchable,
                &android_pseudo_package,
                GESIS_MAX_TIMEOUT_NS,
                GESIS_EVENT_THRESHOLD,
            )
            .map_err(|error| format!("matcher: {error}"))?;
            // No rule in the matcher crate splits an episode, so every episode
            // begins at its own start row.
            let whole_episode_starts = vec![None; result.stop_start_indices.len()];
            Ok(MatcherOutput {
                start_indices: result.start_indices,
                stop_start_indices: result.stop_start_indices,
                stop_event_indices: result.stop_event_indices,
                missing_indices: result.missing_indices,
                stop_reasons: result.stop_reasons,
                missing_reasons: result.missing_reasons,
                stop_timestamps_ns: result.stop_timestamps_ns,
                start_timestamps_ns: whole_episode_starts,
                selected_nonresume_closed_indices: Vec::new(),
                opener_set_evidence: OpenerSetEvidence::default(),
                eyes_tagged_fau_evidence: Vec::new(),
                eyes_validation_expected_participant_ids: BTreeSet::new(),
                schoedel_reconstruction: None,
                schoedel_candidate_rows: None,
                schoedel_validation_witness: None,
            })
        }
        Strategy::ForegroundBackgroundPairing => {
            foreground_background_episodes(rows, eligible_opener)
        }
        Strategy::DraxlerInterruptionAware => draxler_episodes(rows, eligible_opener),
        Strategy::MorrisonLockTolerant => morrison_episodes(rows, eligible_opener),
        Strategy::Schoedel2026AppWithinScreenProseV1 => Err(
            "schoedel_2026_app_within_screen_prose_v1 requires the typed B05 reconstruction seam"
                .into(),
        ),
    }
}

/// Ahmed et al. (2023) / Okoshi et al. (2025): subtract, and repair nothing.
///
/// Every `Activity Resumed` is closed by the next `Activity Paused` carrying
/// the same package. A resume with no later pause of its package produces no
/// episode at all — there is no fallback stop, no timeout and no end-of-stream
/// close, because neither paper describes one. That absence is the point of
/// having this arm: it is the floor the repairing rules are measured against.
///
/// Ahmed's own code reads `getEventType() == 1` and `== 2`
/// (`.refs/osf-ahmed-2023/ahmed_raw_event_processing.download`), which are
/// these two interaction types; his 45-second sessions and micro/review/engage
/// classes sit on later axes, not here.
pub(crate) fn foreground_background_episodes(
    rows: &[Row],
    eligible_opener: &[bool],
) -> Result<MatcherOutput, String> {
    let mut output = MatcherOutput::default();
    // Resumes still waiting for a pause, newest last, one queue per package.
    let mut open: AHashMap<&str, Vec<usize>> = AHashMap::new();
    for (index, row) in rows.iter().enumerate() {
        if eligible_opener[index] {
            output.start_indices.push(index);
            open.entry(row.app_package_name.as_str())
                .or_default()
                .push(index);
        } else if row.interaction_type == ACTIVITY_PAUSED {
            // The earliest still-open resume of this package: a pause ends
            // the use it belongs to, and the paper's arithmetic is one
            // subtraction per pair.
            if let Some(queue) = open.get_mut(row.app_package_name.as_str()) {
                if !queue.is_empty() {
                    let start = queue.remove(0);
                    output.stop_start_indices.push(start);
                    output.stop_event_indices.push(index);
                    output
                        .stop_reasons
                        .push(EpisodeCloseReason::SamePackageBackgrounded);
                    output.stop_timestamps_ns.push(None);
                    output.start_timestamps_ns.push(None);
                }
            }
        }
    }
    // Whatever never paused is reported unobserved rather than closed at a
    // convenient event.
    let mut unmatched: Vec<usize> = open.into_values().flatten().collect();
    unmatched.sort_unstable();
    for start in unmatched {
        output.missing_indices.push(start);
        output.missing_reasons.push(EpisodeCloseReason::Unobserved);
    }
    Ok(output)
}

/// Draxler et al. (2021): an episode ends at whichever comes first of its own
/// package backgrounding, the screen going off, or ten minutes of inactivity.
///
/// The screen-off clause is what makes this arm worth having — it is the only
/// rule here under which a screen event ends an APP episode. The paper's
/// "return within ten minutes is a suspending interruption" belongs to its
/// session layer, not to episode construction: it decides whether the next
/// episode joins this session, which is the session-grouping axis.
pub(crate) fn draxler_episodes(rows: &[Row], eligible_opener: &[bool]) -> Result<MatcherOutput, String> {
    let mut output = MatcherOutput::default();
    let mut open: Option<(usize, &str)> = None;
    let mut last_event_ns: Option<i64> = None;

    let close = |output: &mut MatcherOutput,
                 start: usize,
                 stop: usize,
                 reason: EpisodeCloseReason,
                 at: Option<i64>| {
        output.stop_start_indices.push(start);
        output.stop_event_indices.push(stop);
        output.stop_reasons.push(reason);
        output.stop_timestamps_ns.push(at);
        output.start_timestamps_ns.push(None);
    };

    for (index, row) in rows.iter().enumerate() {
        let now = row.event_timestamp_ns;
        // Inactivity is measured against the previous event of any kind, so a
        // silent stretch closes the episode at the last thing actually seen
        // rather than at the event that broke the silence.
        if let (Some((start, _)), Some(previous)) = (open, last_event_ns) {
            if now - previous > DRAXLER_INACTIVITY_NS {
                close(
                    &mut output,
                    start,
                    index,
                    EpisodeCloseReason::DraxlerInactivityTimeout,
                    Some(previous),
                );
                open = None;
            }
        }
        if eligible_opener[index] {
            // Draxler carries one foreground episode. Its existing pairing
            // transition is atomic: accepting a new opener hands over from the
            // current episode and then opens the selected row. This is not a
            // second close predicate derived from the row's event kind; it is
            // how the single-open rule consumes its opener input.
            if let Some((start, _)) = open {
                close(
                    &mut output,
                    start,
                    index,
                    EpisodeCloseReason::ForegroundHandover,
                    None,
                );
            }
            output.start_indices.push(index);
            open = Some((index, row.app_package_name.as_str()));
        } else {
            match row.interaction_type.as_str() {
                ACTIVITY_PAUSED => {
                    if let Some((start, package)) = open {
                        if package == row.app_package_name.as_str() {
                            close(
                                &mut output,
                                start,
                                index,
                                EpisodeCloseReason::SamePackageBackgrounded,
                                None,
                            );
                            open = None;
                        }
                    }
                }
                other if SCREEN_STOP_EVENTS.contains(&other) => {
                    if let Some((start, _)) = open {
                        close(
                            &mut output,
                            start,
                            index,
                            EpisodeCloseReason::ScreenNonInteractive,
                            None,
                        );
                        open = None;
                    }
                }
                _ => {}
            }
        }
        last_event_ns = Some(now);
    }
    if let Some((start, _)) = open {
        output.missing_indices.push(start);
        output.missing_reasons.push(EpisodeCloseReason::Unobserved);
    }
    Ok(output)
}

/// Morrison et al. (2018): a lock only ends the use if the screen stays off.
///
/// "App use ends on home-screen return, another foreground app, or lock" — but
/// the lock clause carries Böhmer et al.'s (2011) qualifier, inherited by name
/// and value: the screen must have "been locked for 30 seconds". A shorter
/// off/on pair is a pocket-check and the use runs straight through it. Coming
/// back to the same app after a lock that DID count opens a new use, which
/// falls out of closing the old one rather than needing its own clause.
///
/// So a screen-off cannot be acted on when it is read. It is held as a pending
/// lock until something resolves it:
/// - the screen comes back on soon enough → the lock never counted, drop it;
/// - the screen comes back on late, or never comes back at all → the lock
///   counted, and the episode ends AT the screen-off, not at the timeout.
///
/// The end timestamp being the screen-off is why this reason is not an
/// `assumed_` one: the boundary is an observed event. Only the decision to
/// honour it is inferred.
///
/// Both papers are prose; neither ships code. "Has been locked for 30 seconds"
/// reads as satisfied at exactly thirty, so this uses `>=`, and there is no
/// implementation to check that against — unlike the GESIS and Culverhouse
/// bands, where the reference source settled the operator.
pub(crate) fn morrison_episodes(rows: &[Row], eligible_opener: &[bool]) -> Result<MatcherOutput, String> {
    let mut output = MatcherOutput::default();
    let mut open: Option<(usize, &str)> = None;
    // A screen-off seen while an episode was open, not yet known to have ended
    // it: (row index, when it happened).
    let mut pending_lock: Option<(usize, i64)> = None;

    let close = |output: &mut MatcherOutput,
                 start: usize,
                 stop: usize,
                 reason: EpisodeCloseReason,
                 at: Option<i64>| {
        output.stop_start_indices.push(start);
        output.stop_event_indices.push(stop);
        output.stop_reasons.push(reason);
        output.stop_timestamps_ns.push(at);
        output.start_timestamps_ns.push(None);
    };

    for (index, row) in rows.iter().enumerate() {
        let now = row.event_timestamp_ns;
        // Resolve a held lock before anything else reads `open`, so a late
        // screen-on retroactively ends the episode at the screen-off and the
        // event doing the waking cannot be mistaken for part of that episode.
        // Any event at or past the timeout proves the screen stayed off that
        // long — a screen-on event is the only thing that ends a lock — so the
        // lock counted even when the event is the app's own pause.
        if let (Some((start, _)), Some((lock_index, lock_ns))) = (open, pending_lock) {
            if now - lock_ns >= MORRISON_LOCK_TIMEOUT_NS {
                close(
                    &mut output,
                    start,
                    lock_index,
                    EpisodeCloseReason::ScreenLockedPastTimeout,
                    Some(lock_ns),
                );
                open = None;
                pending_lock = None;
            } else if SCREEN_START_EVENTS.contains(&row.interaction_type.as_str()) {
                pending_lock = None;
            }
        }
        if eligible_opener[index] {
            // Like Draxler, Morrison is a single-open state machine. A selected
            // opener therefore exercises the existing handover transition;
            // restricting that transition to native resumes would either
            // ignore the wider opener or invent overlapping state not present
            // in this reconstruction rule.
            if let Some((start, _)) = open {
                close(
                    &mut output,
                    start,
                    index,
                    EpisodeCloseReason::ForegroundHandover,
                    None,
                );
            }
            output.start_indices.push(index);
            open = Some((index, row.app_package_name.as_str()));
            pending_lock = None;
        } else {
            match row.interaction_type.as_str() {
                ACTIVITY_PAUSED => {
                    if let Some((start, package)) = open {
                        if package == row.app_package_name.as_str() {
                            close(
                                &mut output,
                                start,
                                index,
                                EpisodeCloseReason::SamePackageBackgrounded,
                                None,
                            );
                            open = None;
                            pending_lock = None;
                        }
                    }
                }
                // Only the first screen-off of a run can be the one that ended the
                // use; a second without an intervening screen-on is noise, and a
                // screen-off with nothing open ends nothing.
                other
                    if SCREEN_STOP_EVENTS.contains(&other)
                        && open.is_some()
                        && pending_lock.is_none() =>
                {
                    pending_lock = Some((index, now));
                }
                _ => {}
            }
        }
    }
    // The screen never came back on, so the lock lasted for the rest of the
    // recording and therefore counted.
    if let (Some((start, _)), Some((lock_index, lock_ns))) = (open, pending_lock) {
        close(
            &mut output,
            start,
            lock_index,
            EpisodeCloseReason::ScreenLockedPastTimeout,
            Some(lock_ns),
        );
        open = None;
    }
    if let Some((start, _)) = open {
        output.missing_indices.push(start);
        output.missing_reasons.push(EpisodeCloseReason::Unobserved);
    }
    Ok(output)
}

/// Project EYES complement segmentation onto the shared index model.
///
/// EYES needs the whole event stream, not the app-event subset in
/// `MatcherInput`: `ACTIVE` is defined as the complement of SHUTDOWN, IDLE,
/// GAP and GLANCE, and those blocks are built from screen, keyguard and power
/// events. That is why this arm takes `rows` while the other two do not.
///
/// `EyesAppEpisode` carries timestamps, and `MatcherOutput` carries row
/// indices, so each episode is mapped back to the row it came from. The mapping
/// is exact rather than nearest-match: EYES derives every timestamp it reports
/// from one of these rows, so a resume time always identifies the
/// `ACTIVITY_RESUMED` row of that package bearing that timestamp. An episode
/// whose end could not be resolved — `time_stop_ns` absent, or resolved to a
/// timestamp no row carries — is reported as missing rather than closed at a
/// guessed row.
pub(crate) fn eyes_complement_episodes(
    rows: &[Row],
    eligible_opener: &[bool],
    proximity_interval_ns: i64,
) -> Result<MatcherOutput, String> {
    use crate::eyes_complement::{
        segment_eyes_complement, EyesEvent, EyesOptions, EyesParticipantTaggedFauEvidence,
    };

    let events: Vec<EyesEvent<'_>> = rows
        .iter()
        .map(|row| {
            EyesEvent::new(
                row.event_timestamp_ns,
                row.interaction_type.as_str(),
                row.app_package_name.as_str(),
            )
        })
        .collect();

    let options = EyesOptions {
        proximity_interval_seconds: proximity_interval_ns as f64 / 1_000_000_000.0,
        ..EyesOptions::default()
    };
    let segmentation = segment_eyes_complement(&events, &options);

    // (timestamp, package) -> index, restricted to resume rows, so an episode
    // start can only ever bind to a real resume. First occurrence wins, which
    // matches the order EYES consumed them in.
    let mut resume_rows: AHashMap<(i64, &str), usize> = AHashMap::new();
    // timestamp -> index over every row, for ends. EYES may close an episode on
    // a foreign package's resume (its `MST` repair walk), so ends are not
    // restricted by package.
    let mut any_row: AHashMap<i64, usize> = AHashMap::new();
    for (index, row) in rows.iter().enumerate() {
        if eligible_opener[index] {
            resume_rows
                .entry((row.event_timestamp_ns, row.app_package_name.as_str()))
                .or_insert(index);
        }
        any_row.entry(row.event_timestamp_ns).or_insert(index);
    }

    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut missing_indices = Vec::new();
    let mut stop_reasons = Vec::new();
    let mut missing_reasons = Vec::new();
    let mut fragment_starts: Vec<Option<i64>> = Vec::new();
    let mut fragment_stops: Vec<Option<i64>> = Vec::new();

    // Which row each EYES episode is anchored to, by episode index, so a Final
    // App Usage fragment can be traced chunk -> episodes -> resume row.
    let episode_start_rows: Vec<Option<usize>> = segmentation
        .episodes
        .iter()
        .map(|episode| {
            let resume_ns = episode.time_resume_ns?;
            resume_rows
                .get(&(resume_ns, episode.app_package_name.as_str()))
                .copied()
        })
        .collect();

    for (episode_index, episode) in segmentation.episodes.iter().enumerate() {
        let Some(start_index) = episode_start_rows[episode_index] else {
            // No observed resume, or a resume EYES derived rather than read, so
            // there is no row to anchor the episode to.
            continue;
        };
        start_indices.push(start_index);
        // An episode with no bound end is unobserved regardless of how the
        // fragments below fall out; `end_inference` says which repair, if any,
        // EYES tried before giving up.
        if episode.time_stop_ns.is_none() {
            missing_indices.push(start_index);
            missing_reasons.push(eyes_close_reason(episode.end_inference));
        }
    }

    // The episodes above are the raw triplets. What EYES actually credits is
    // `final_app_usage`: each per-app chunk cut wherever the device-state
    // timeline changes underneath it, every fragment tagged with the state that
    // covered it. Only ACTIVE fragments are usage — a stretch covered by IDLE,
    // GAP, GLANCE or SHUTDOWN is time the app was open but the device was not
    // being used, and crediting it is exactly the error this arm used to make
    // by reading `segmentation.episodes` directly.
    for fragment in segmentation.credited_final_app_usage() {
        let chunk = &segmentation.app_usage_chunks[fragment.chunk_index];
        // A chunk merges one or more episodes of the same package. The fragment
        // belongs to the earliest episode in the chunk whose row is known; that
        // is the resume the credited time began under.
        let Some(start_index) = chunk
            .episode_indices
            .iter()
            .filter_map(|&index| episode_start_rows[index])
            .min()
        else {
            continue;
        };
        // The fragment's end is an instant produced by intersecting a chunk
        // with a block boundary. It usually lands on no row at all, which is
        // why both bounds travel explicitly rather than as row indices.
        let stop_index = any_row
            .get(&fragment.end_ns)
            .copied()
            .filter(|&index| index >= start_index)
            .unwrap_or(start_index);
        stop_start_indices.push(start_index);
        stop_event_indices.push(stop_index);
        // Preserve the historical product contract: every credited Final App
        // Usage fragment is bounded by the EYES device-state projection. The
        // selected natural endpoint and its inference remain available on the
        // evidence-only `EyesTaggedFauEvidence.chunk_endpoints` surface.
        stop_reasons.push(EpisodeCloseReason::EyesDeviceStateBoundary);
        fragment_starts.push(Some(fragment.start_ns));
        fragment_stops.push(Some(fragment.end_ns));
    }

    start_indices.sort_unstable();
    start_indices.dedup();
    // An episode that produced at least one credited fragment is not missing an
    // end, whatever its triplet said.
    let credited: AHashSet<usize> = stop_start_indices.iter().copied().collect();
    let mut kept = 0;
    for index in 0..missing_indices.len() {
        if credited.contains(&missing_indices[index]) {
            continue;
        }
        missing_indices[kept] = missing_indices[index];
        missing_reasons[kept] = missing_reasons[index];
        kept += 1;
    }
    missing_indices.truncate(kept);
    missing_reasons.truncate(kept);
    // Sort the pairs together: unlike before, EYES miss reasons vary by
    // `end_inference`, so dropping the reasons and refilling would lose them.
    let mut misses: Vec<(usize, EpisodeCloseReason)> = missing_indices
        .iter()
        .copied()
        .zip(missing_reasons.iter().copied())
        .collect();
    misses.sort_unstable_by_key(|&(index, _)| index);
    misses.dedup_by_key(|&mut (index, _)| index);
    missing_indices = misses.iter().map(|&(index, _)| index).collect();
    missing_reasons = misses.iter().map(|&(_, reason)| reason).collect();
    let eyes_tagged_fau_evidence = vec![EyesParticipantTaggedFauEvidence {
        participant_id: rows
            .first()
            .map(|row| row.participant_id.to_string())
            .unwrap_or_default(),
        evidence: segmentation.tagged_fau_evidence(options),
    }];
    Ok(MatcherOutput {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns: fragment_stops,
        start_timestamps_ns: fragment_starts,
        selected_nonresume_closed_indices: Vec::new(),
        opener_set_evidence: OpenerSetEvidence::default(),
        eyes_tagged_fau_evidence,
        eyes_validation_expected_participant_ids: rows
            .first()
            .map(|row| BTreeSet::from([row.participant_id.to_string()]))
            .unwrap_or_default(),
        schoedel_reconstruction: None,
        schoedel_candidate_rows: None,
        schoedel_validation_witness: None,
    })
}

/// EYES's own end-provenance, mapped onto the shared close-reason vocabulary.
///
/// Only reached for an episode EYES left without an end. `ObservedStop` cannot
/// appear here — an episode with an observed stop has a `time_stop_ns` — so it
/// is mapped to the reason it would carry if it ever did.
pub(crate) fn eyes_close_reason(
    inference: crate::eyes_complement::EyesEpisodeEndInference,
) -> EpisodeCloseReason {
    use crate::eyes_complement::EyesEpisodeEndInference as Inference;
    match inference {
        // Three ways to land on a real `Activity Stopped` of this same package.
        // They differ in which block the stop was recorded against, not in
        // whether the log contained one: `ObservedStop` is this block's own,
        // `AppKilled` is a stop that arrived outside the newest resume's
        // proximity, and `NextBlockStoppedInference` borrows the stop from a
        // later block of the same package. Only blocks that keep a `time_stop`
        // reach here as `AppKilled` or `NextBlockStoppedInference` — the ones
        // without a stop are rewritten by the repair walk in
        // `eyes_complement::resolve_duration_seconds` before this runs — so all
        // three end on an observed stop event.
        Inference::ObservedStop | Inference::AppKilled | Inference::NextBlockStoppedInference => {
            EpisodeCloseReason::EyesTripletClose
        }
        // `MST`: the repair took the *resume* of the next block of a DIFFERENT
        // package as this episode's end. That is an inferred end, but it is
        // still an end — reporting it as `Unobserved` told the researcher no
        // end was found for an episode that has one.
        Inference::MissingStop => EpisodeCloseReason::EyesNextBlockAssumed,
        // The repair walk found nothing usable and this block's own observed
        // `Activity Paused` bounded the episode. No next block is consulted, so
        // this is not an assumed end at the next activity: it is the app moving
        // to the background, which the column already has a word for.
        Inference::PauseFallback => EpisodeCloseReason::SamePackageBackgrounded,
        Inference::Unobserved => EpisodeCloseReason::Unobserved,
        Inference::SystemShutDown => EpisodeCloseReason::EyesDeviceStateBoundary,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn match_app_episodes(
    input: &MatcherInput,
    eligible_opener: &[bool],
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
    proximity_interval_ns: i64,
) -> Result<MatcherOutput, String> {
    let result =
        _rust_app_usage_matcher::match_app_usage_update_indices_with_proximity_openers_core(
            &input.app_codes,
            &input.timestamps,
            eligible_opener,
            &input.resumed,
            &input.same_stop,
            &input.other_stop,
            &input.stopped,
            &input.background,
            _rust_app_usage_matcher::MatchOptions {
                allow_stop_event_reuse,
                use_activity_stopped_as_fallback,
                apply_threshold_to_fallback,
                long_duration_threshold_ns,
            },
            proximity_interval_ns,
        )
        .map_err(|error| format!("matcher: {error}"))?;
    let whole_episode_starts = vec![None; result.stop_start_indices.len()];
    Ok(MatcherOutput {
        start_indices: result.start_indices,
        stop_start_indices: result.stop_start_indices,
        stop_event_indices: result.stop_event_indices,
        missing_indices: result.missing_indices,
        stop_reasons: result.stop_reasons,
        missing_reasons: result.missing_reasons,
        stop_timestamps_ns: result.stop_timestamps_ns,
        start_timestamps_ns: whole_episode_starts,
        selected_nonresume_closed_indices: Vec::new(),
        opener_set_evidence: OpenerSetEvidence::default(),
        eyes_tagged_fau_evidence: Vec::new(),
        eyes_validation_expected_participant_ids: BTreeSet::new(),
        schoedel_reconstruction: None,
        schoedel_candidate_rows: None,
        schoedel_validation_witness: None,
    })
}

pub(crate) fn materialize_candidate_episodes(
    rows: Vec<Row>,
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
) -> Vec<Row> {
    materialize_candidate_episodes_with_suffix(rows, result, filtered_packages, None)
}

pub(crate) fn materialize_candidate_episodes_with_suffix(
    mut rows: Vec<Row>,
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
    persisted_suffix_digests: Option<&[InlineLineageDigest]>,
) -> Vec<Row> {
    materialize_candidate_episodes_in_place(
        &mut rows,
        result,
        filtered_packages,
        persisted_suffix_digests,
    );
    rows
}

/// Write each reconstructed episode onto its start row.
///
/// A rule that splits one episode into several intervals (today only EYES,
/// through `MatcherOutput::start_timestamps_ns`) gets one row per interval: the
/// first interval is written onto the start row as usual, and each further
/// interval is appended as a clone of that row carrying its own bounds. That is
/// why this takes a `Vec` rather than a slice — it can grow. Every other rule
/// leaves the length untouched and takes the identical path it took before
/// intervals existed.
/// Intern the reader-facing close-reason label.
///
/// The set is closed and tiny, so one `Arc<String>` per variant is allocated
/// once and shared by every row that ends that way, rather than allocating a
/// fresh string per episode.
pub(crate) fn shared_end_reason(reason: EpisodeCloseReason) -> SharedString {
    static LABELS: OnceLock<Vec<SharedString>> = OnceLock::new();
    let labels = LABELS.get_or_init(|| {
        EpisodeCloseReason::ALL
            .iter()
            .map(|reason| SharedString::from(reason.output_label()))
            .collect()
    });
    let index = EpisodeCloseReason::ALL
        .iter()
        .position(|&candidate| candidate == reason)
        .expect("EpisodeCloseReason::ALL is exhaustive");
    labels[index].clone()
}

pub(crate) fn materialize_candidate_episodes_in_place(
    rows: &mut Vec<Row>,
    result: &MatcherOutput,
    filtered_packages: &BTreeSet<String>,
    persisted_suffix_digests: Option<&[InlineLineageDigest]>,
) {
    let splits_episodes = result.splits_episodes();
    // Rows appended below are clones of rows already present, so they are held
    // aside until the whole index-addressed walk is finished. Appending during
    // the walk would shift nothing (appends land past every index in use) but
    // would let a later position read a fragment as if it were a source event.
    let mut fragment_rows: Vec<Row> = Vec::new();
    // Which start rows have already been written. Only consulted when a rule
    // splits, so the non-splitting path allocates nothing.
    let mut written_starts: AHashSet<usize> = AHashSet::new();
    let computed_suffix_digests;
    let search_suffix_digests = if let Some(persisted) = persisted_suffix_digests {
        assert_eq!(
            persisted.len(),
            rows.len() + 1,
            "persisted lineage suffix count drift"
        );
        persisted
    } else {
        computed_suffix_digests = inline_lineage_search_suffix_digests(rows);
        &computed_suffix_digests
    };
    for &start_index in &result.start_indices {
        let event_timestamp_ns = rows[start_index].event_timestamp_ns;
        *rows[start_index].edit_temporal().start_timestamp_ns = Some(event_timestamp_ns);
    }
    for (position, &start_index) in result.stop_start_indices.iter().enumerate() {
        let stop_index = result.stop_event_indices[position];
        let lower = start_index.min(stop_index);
        let upper = start_index.max(stop_index);
        let stop_source_rows = rows[stop_index].source_data_rows.clone();
        let search_start_event_index = (lower + 1) as u32;
        let search_end_event_index_exclusive = (upper + 1) as u32;
        let start_participant_id = rows[start_index].participant_id.shared();
        // A rule may end an episode at an instant no row carries — the GESIS
        // timeout cut is `start + max_timeout`, which is a clock value, not an
        // event. When it does, that instant wins over the anchor row's own
        // timestamp; otherwise the anchor row is the end, as before.
        let stop_timestamp_ns = result
            .stop_timestamps_ns
            .get(position)
            .copied()
            .flatten()
            .unwrap_or_else(|| rows[stop_index].event_timestamp_ns);
        // Likewise for the begin instant: a split fragment starts where the
        // device-state cut put it, not where its resume row sits.
        let fragment_start_ns = result.start_timestamps_ns.get(position).copied().flatten();

        // The second and later intervals of one episode do not get to rewrite
        // the start row — they become their own rows.
        let is_further_fragment = splits_episodes && !written_starts.insert(start_index);
        if is_further_fragment {
            let mut fragment = rows[start_index].clone();
            let identity = fragment.edit_identity();
            identity.source_data_rows.merge(&stop_source_rows);
            // The clone inherits the first fragment's search evidence, which
            // describes a different interval. Replace it rather than append, so
            // each fragment row carries exactly the evidence for its own cut.
            let searches = Arc::make_mut(identity.lineage_searches);
            searches.clear();
            searches.push(LineageSearchEvidence {
                protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
                reason: shared_lineage_text("device-state-split-fragment"),
                index_space: shared_lineage_text("pipeline-event-order"),
                start_participant_id,
                start_event_index: search_start_event_index,
                end_event_index_exclusive: search_end_event_index_exclusive,
                candidate_event_count: search_end_event_index_exclusive
                    .saturating_sub(search_start_event_index),
                candidate_chain_digest: inline_lineage_search_range_digest(
                    search_suffix_digests,
                    search_start_event_index,
                    search_end_event_index_exclusive,
                ),
            });
            let temporal = fragment.edit_temporal();
            if let Some(begin_ns) = fragment_start_ns {
                *temporal.start_timestamp_ns = Some(begin_ns);
            }
            *temporal.stop_timestamp_ns = Some(stop_timestamp_ns);
            if let Some(&reason) = result.stop_reasons.get(position) {
                *fragment.edit_classification().app_usage_end_reason =
                    Some(shared_end_reason(reason));
            }
            fragment_rows.push(fragment);
            continue;
        }

        let identity = rows[start_index].edit_identity();
        identity.source_data_rows.merge(&stop_source_rows);
        Arc::make_mut(identity.lineage_searches).push(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("selected-qualifying-stop"),
            index_space: shared_lineage_text("pipeline-event-order"),
            start_participant_id,
            start_event_index: search_start_event_index,
            end_event_index_exclusive: search_end_event_index_exclusive,
            candidate_event_count: search_end_event_index_exclusive
                .saturating_sub(search_start_event_index),
            candidate_chain_digest: inline_lineage_search_range_digest(
                search_suffix_digests,
                search_start_event_index,
                search_end_event_index_exclusive,
            ),
        });
        let temporal = rows[start_index].edit_temporal();
        if let Some(begin_ns) = fragment_start_ns {
            *temporal.start_timestamp_ns = Some(begin_ns);
        }
        *temporal.stop_timestamp_ns = Some(stop_timestamp_ns);
        if let Some(&reason) = result.stop_reasons.get(position) {
            *rows[start_index].edit_classification().app_usage_end_reason =
                Some(shared_end_reason(reason));
        }
    }
    let search_end_event_index_exclusive = rows.len() as u32;
    for (missing_position, &index) in result.missing_indices.iter().enumerate() {
        let row = &mut rows[index];
        let search_start_event_index = (index + 1) as u32;
        let start_participant_id = row.participant_id.shared();
        Arc::make_mut(row.edit_identity().lineage_searches).push(LineageSearchEvidence {
            protocol_version: shared_lineage_text("chronicle-lineage-search/v1"),
            reason: shared_lineage_text("no-qualifying-stop"),
            index_space: shared_lineage_text("pipeline-event-order"),
            start_participant_id,
            start_event_index: search_start_event_index,
            end_event_index_exclusive: search_end_event_index_exclusive,
            candidate_event_count: search_end_event_index_exclusive
                .saturating_sub(search_start_event_index),
            candidate_chain_digest: inline_lineage_search_range_digest(
                search_suffix_digests,
                search_start_event_index,
                search_end_event_index_exclusive,
            ),
        });
        *row.edit_classification().interaction_type = END_OF_USAGE_MISSING.into();
        if let Some(&reason) = result.missing_reasons.get(missing_position) {
            *row.edit_classification().app_usage_end_reason = Some(shared_end_reason(reason));
        }
        // Capture the immutable reconstructed episode evidence before the
        // compatibility projection clears public timing for a filtered app.
        // B03/B04 receipts must see bounded and unbounded episodes through the
        // same pre-filter evidence seam.
        let raw_start = row.start_timestamp_ns;
        let temporal = row.edit_temporal();
        *temporal.stop_timestamp_ns = None;
        *temporal.duration_seconds = None;
        *temporal.duration_minutes = None;
        *temporal.raw_episode_start_timestamp_ns = raw_start;
        *temporal.raw_episode_stop_timestamp_ns = None;
        *temporal.raw_episode_duration_ns = None;
        *temporal.minimum_duration_qualified = None;
        if filtered_packages.contains(row.app_package_name.as_str()) {
            *row.edit_temporal().start_timestamp_ns = None;
        }
    }
    // Empty unless a rule split an episode. `order_app_episodes` sorts, so
    // appending here does not leave them out of order downstream.
    rows.append(&mut fragment_rows);
}

/// The B06 generic maximum-duration stage for one bounded usage row, applied
/// after the B04 floor at the same pre-concurrency checkpoint. Reads the
/// immutable `raw_episode_*` bounds the B04 block just recorded and returns
/// whether a published temporal cell (endpoint or duration) changed.
///
/// Under any explicit B06 selection the raw span is recomputed in `i128`
/// and the run refuses when it does not fit `i64` — even for the shapes
/// (strategy-native, Chronicle arm) whose generic stage is inactive. The
/// omitted shape never enters this function.
pub(crate) fn apply_maximum_duration_to_row(
    row: &mut Row,
    is_filtered: bool,
    maximum_duration: &b06::MaximumDurationRowStage,
) -> Result<bool, String> {
    let (Some(raw_start), Some(raw_stop)) = (
        row.raw_episode_start_timestamp_ns,
        row.raw_episode_stop_timestamp_ns,
    ) else {
        return Ok(false);
    };
    let checked_span = if maximum_duration.checked_i128_active() {
        Some(b06::checked_raw_duration_ns(raw_start, raw_stop).map_err(b06::MaximumDurationRefusalReason::execution_error)?)
    } else {
        None
    };
    if !maximum_duration.generic_stage_active() {
        return Ok(false);
    }
    let threshold_ns = maximum_duration
        .threshold_ns
        .expect("the generic stage carries a fixed threshold");
    // A negative span (`Some(None)`) is an ordering failure B06 never
    // repairs: it stays bounded and never exceeds a positive threshold.
    let raw_duration_ns = match checked_span {
        Some(Some(span)) => span,
        _ => raw_stop.saturating_sub(raw_start),
    };
    let exceeds = b06::qualifies(raw_duration_ns, threshold_ns);
    {
        let temporal = row.edit_temporal();
        *temporal.maximum_duration_qualified = Some(exceeds);
        *temporal.maximum_duration_aggregate_eligible = true;
        *temporal.maximum_duration_drop_pending = false;
        *temporal.maximum_duration_trimmed_ns = None;
        *temporal.effective_endpoint_reason = None;
    }
    if !exceeds {
        return Ok(false);
    }
    match maximum_duration.disposition {
        b06::MaximumDurationDisposition::NotApplicable
        | b06::MaximumDurationDisposition::FlagAndRetain => Ok(false),
        b06::MaximumDurationDisposition::RetainButExclude => {
            *row.edit_temporal().maximum_duration_aggregate_eligible = false;
            Ok(false)
        }
        b06::MaximumDurationDisposition::TruncateToThreshold => {
            let effective_stop =
                b06::truncated_stop_ns(raw_start, threshold_ns).map_err(b06::MaximumDurationRefusalReason::execution_error)?;
            let trimmed_ns = raw_duration_ns - threshold_ns;
            // The B04 blank owns the published duration cells; truncation only
            // moves the endpoint underneath it.
            let blank_wins = row.minimum_duration_blank_applied;
            let temporal = row.edit_temporal();
            *temporal.maximum_duration_trimmed_ns = Some(trimmed_ns);
            if is_filtered {
                // Filtered rows publish no timing at all: the trim is
                // recorded, the endpoint stays blank, no reason is published.
                return Ok(false);
            }
            *temporal.stop_timestamp_ns = Some(effective_stop);
            *temporal.effective_endpoint_reason =
                Some(b06::MaximumDurationEffectiveEndpointReason::MaximumDurationTruncationBoundary);
            if !blank_wins {
                let seconds = threshold_ns as f64 / 1_000_000_000.0;
                *temporal.duration_seconds = Some(seconds);
                *temporal.duration_minutes = Some(seconds / 60.0);
            }
            Ok(true)
        }
        b06::MaximumDurationDisposition::DropRow => {
            *row.edit_temporal().maximum_duration_drop_pending = true;
            Ok(false)
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn classify_episode_durations(
    rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    micro_use_policy: MicroUseClassificationPolicy,
    minimum_usage_duration: f64,
    minimum_duration_comparator: MinimumDurationComparator,
    minimum_duration_disposition: MinimumDurationDisposition,
    selected_nonresume_closed_indices: &[usize],
    maximum_duration: &b06::MaximumDurationRowStage,
) -> Result<Vec<Row>, String> {
    let minimum_threshold_ns = minimum_duration_threshold_ns(minimum_usage_duration);
    let selected_nonresume_closed_indices: BTreeSet<usize> =
        selected_nonresume_closed_indices.iter().copied().collect();
    let maximum_duration_explicit = maximum_duration.explicit;
    rows.into_iter()
        .enumerate()
        .filter(|(_, row)| row.interaction_type != ACTIVITY_PAUSED)
        .filter(|(index, row)| {
            let selected_start = row.interaction_type == ACTIVITY_RESUMED
                || selected_nonresume_closed_indices.contains(index);
            !selected_start || (row.start_timestamp_ns.is_some() && row.stop_timestamp_ns.is_some())
        })
        .map(|(index, mut row)| -> Result<Row, String> {
            if row.interaction_type == END_OF_USAGE_MISSING
                && (row.raw_episode_start_timestamp_ns.is_some()
                    || row.start_timestamp_ns.is_some())
            {
                let raw_start = row
                    .raw_episode_start_timestamp_ns
                    .or(row.start_timestamp_ns);
                if micro_use_policy != MicroUseClassificationPolicy::None {
                    *row.edit_classification().micro_use_classification =
                        Some(MicroUseClassification::NotClassifiable);
                }
                let temporal = row.edit_temporal();
                *temporal.raw_episode_start_timestamp_ns = raw_start;
                *temporal.raw_episode_stop_timestamp_ns = None;
                *temporal.raw_episode_duration_ns = None;
                *temporal.minimum_duration_qualified = None;
            }
            if row.interaction_type == ACTIVITY_RESUMED
                || selected_nonresume_closed_indices.contains(&index)
            {
                let is_filtered = filtered_packages.contains(row.app_package_name.as_str());
                let interaction_type = if is_filtered {
                    FILTERED_APP_USAGE
                } else {
                    APP_USAGE
                }
                .into();
                *row.edit_classification().interaction_type = interaction_type;
                let start = row.start_timestamp_ns.expect("paired usage start");
                let stop = row.stop_timestamp_ns.expect("paired usage stop");
                let duration_ns = stop.saturating_sub(start);
                let duration_seconds = duration_ns as f64 / 1_000_000_000.0;
                let micro_use_classification = match micro_use_policy {
                    MicroUseClassificationPolicy::None => None,
                    MicroUseClassificationPolicy::OkoshiLt5s if duration_ns <= 0 => {
                        Some(MicroUseClassification::NotClassifiable)
                    }
                    MicroUseClassificationPolicy::OkoshiLt5s
                        if duration_ns < OKOSHI_MICRO_USE_THRESHOLD_NS =>
                    {
                        Some(MicroUseClassification::MicroUse)
                    }
                    MicroUseClassificationPolicy::OkoshiLt5s => {
                        Some(MicroUseClassification::NotMicroUse)
                    }
                };
                *row.edit_classification().micro_use_classification = micro_use_classification;

                let qualifies = minimum_threshold_ns.is_some_and(|threshold_ns| {
                    minimum_duration_comparator.qualifies(duration_ns, threshold_ns)
                });
                {
                    let evidence = row.edit_temporal();
                    *evidence.raw_episode_start_timestamp_ns = Some(start);
                    *evidence.raw_episode_stop_timestamp_ns = Some(stop);
                    *evidence.raw_episode_duration_ns = Some(duration_ns);
                    *evidence.minimum_duration_qualified = Some(qualifies);
                    *evidence.minimum_duration_aggregate_eligible = true;
                    *evidence.minimum_duration_blank_applied = false;
                    *evidence.concurrent_subinterval_floor_blank_applied = false;
                    *evidence.minimum_duration_drop_pending = false;
                }
                if is_filtered {
                    let temporal = row.edit_temporal();
                    *temporal.start_timestamp_ns = None;
                    *temporal.stop_timestamp_ns = None;
                    *temporal.duration_seconds = None;
                    *temporal.duration_minutes = None;
                } else {
                    let temporal = row.edit_temporal();
                    *temporal.duration_seconds = Some(duration_seconds);
                    *temporal.duration_minutes = Some(duration_seconds / 60.0);
                }
                if qualifies {
                    let temporal = row.edit_temporal();
                    match minimum_duration_disposition {
                        MinimumDurationDisposition::ChronicleBlankKeepRow => {
                            *temporal.duration_seconds = None;
                            *temporal.duration_minutes = None;
                            *temporal.minimum_duration_blank_applied = true;
                        }
                        MinimumDurationDisposition::RetainAndCredit => {}
                        MinimumDurationDisposition::RetainButExclude => {
                            *temporal.minimum_duration_aggregate_eligible = false;
                        }
                        MinimumDurationDisposition::DropRow => {
                            *temporal.minimum_duration_drop_pending = true;
                        }
                    }
                }
                if maximum_duration_explicit {
                    apply_maximum_duration_to_row(&mut row, is_filtered, maximum_duration)?;
                }
            }
            Ok(row)
        })
        .collect()
}

/// The filtered packages whose reconstructed episodes publish no timing.
/// A filtered package that is also a background app keeps its timing through
/// classification, so `apply_app_inclusion_policy` can publish it as
/// Filtered App Background Usage. Blanking it first made that label
/// unreachable for every reconstructed episode.
pub(crate) fn timing_blanked_packages(
    filtered_packages: &BTreeSet<String>,
    background_apps: &AHashSet<String>,
) -> BTreeSet<String> {
    filtered_packages
        .iter()
        .filter(|package| !background_apps.contains(package.as_str()))
        .cloned()
        .collect()
}

pub(crate) fn apply_app_inclusion_policy(
    mut rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    filtered_application_labels: &AHashSet<String>,
    background_apps: &AHashSet<String>,
) -> Vec<Row> {
    rows.retain(|row| !row.minimum_duration_drop_pending && !row.maximum_duration_drop_pending);
    for row in &mut rows {
        if !filtered_packages.contains(row.app_package_name.as_str())
            && !filtered_application_labels.contains(row.application_label.as_str())
        {
            continue;
        }
        if row.interaction_type == APP_USAGE
            && background_apps.contains(row.app_package_name.as_str())
        {
            *row.edit_classification().interaction_type = FILTERED_APP_BACKGROUND_USAGE.into();
            continue;
        }
        if row.interaction_type == APP_USAGE {
            *row.edit_classification().interaction_type = FILTERED_APP_USAGE.into();
            let temporal = row.edit_temporal();
            *temporal.duration_seconds = None;
            *temporal.duration_minutes = None;
            continue;
        }
        if row.interaction_type == ACTIVITY_STOPPED {
            *row.edit_classification().interaction_type = FILTERED_STOPPED.into();
        }
        let temporal = row.edit_temporal();
        *temporal.start_timestamp_ns = None;
        *temporal.stop_timestamp_ns = None;
        *temporal.duration_seconds = None;
        *temporal.duration_minutes = None;
    }
    rows
}

pub(crate) fn order_app_episodes(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort_by(|left, right| {
        left.event_timestamp_ns
            .cmp(&right.event_timestamp_ns)
            .then(left.index.cmp(&right.index))
    });
    rows
}

pub(crate) fn segment_concurrent_usage(
    rows: Vec<Row>,
    filtered_packages: &BTreeSet<String>,
    background_apps: &AHashSet<String>,
    model_concurrent_usage: bool,
    minimum_usage_duration: f64,
    apply_minimum_to_subintervals: bool,
) -> Result<Vec<Row>, String> {
    if !model_concurrent_usage && background_apps.is_empty() {
        return Ok(order_app_episodes(rows));
    }
    // Concurrency is a within-participant construct. One global sweep would
    // let an interval for participant B demote participant A to the secondary
    // layer, leaking state across participants.
    let mut app_usage_indices_by_participant = BTreeMap::<SharedString, Vec<usize>>::new();
    for (index, row) in rows.iter().enumerate() {
        if row.interaction_type == APP_USAGE
            && !filtered_packages.contains(row.app_package_name.as_str())
        {
            app_usage_indices_by_participant
                .entry(row.participant_id.clone())
                .or_default()
                .push(index);
        }
    }
    let mut layered = Vec::new();
    for app_usage_indices in app_usage_indices_by_participant.values() {
        let starts = app_usage_indices
            .iter()
            .map(|&index| rows[index].start_timestamp_ns.unwrap_or(0))
            .collect::<Vec<_>>();
        let stops = app_usage_indices
            .iter()
            .map(|&index| rows[index].stop_timestamp_ns.unwrap_or(0))
            .collect::<Vec<_>>();
        for session in split_overlapping_sessions(&starts, &stops)
            .map_err(|error| format!("split_overlapping_sessions: {error}"))?
        {
            layered.push((app_usage_indices[session.session_index], session));
        }
    }
    let mut expanded = rows
        .iter()
        .filter(|row| {
            row.interaction_type != APP_USAGE
                || filtered_packages.contains(row.app_package_name.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    let subinterval_threshold_ns = minimum_duration_threshold_ns(minimum_usage_duration);
    for (source_index, layered_session) in &layered {
        let source_index = *source_index;
        let mut row = rows[source_index].clone();
        let duration_ns = layered_session.stop_ns - layered_session.start_ns;
        let duration_seconds = duration_ns as f64 / 1_000_000_000.0;
        let preserve_pre_concurrency_blank = row.minimum_duration_blank_applied;
        let post_split_floor_blank = !preserve_pre_concurrency_blank
            && apply_minimum_to_subintervals
            && subinterval_threshold_ns.is_some_and(|threshold_ns| duration_ns < threshold_ns);
        let temporal = row.edit_temporal();
        *temporal.start_timestamp_ns = Some(layered_session.start_ns);
        *temporal.stop_timestamp_ns = Some(layered_session.stop_ns);
        *temporal.concurrent_subinterval_floor_blank_applied = post_split_floor_blank;
        if preserve_pre_concurrency_blank || post_split_floor_blank {
            *temporal.duration_seconds = None;
            *temporal.duration_minutes = None;
        } else {
            *temporal.duration_seconds = Some(duration_seconds);
            *temporal.duration_minutes = Some(duration_seconds / 60.0);
        }
        *row.edit_classification().usage_layer = Some(match layered_session.layer {
            UsageLayer::Primary => "primary".into(),
            UsageLayer::Secondary => "secondary".into(),
        });
        expanded.push(row);
    }
    Ok(order_app_episodes(expanded))
}
