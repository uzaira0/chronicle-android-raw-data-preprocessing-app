//! EYES complement-based device-state segmentation (`eyes_complement`).
//!
//! Port of the ACOI-UofSC EYES toolbox, taken from the reference source rather
//! than from a prose summary:
//!
//! | Reference file | What this module ports |
//! |---|---|
//! | `eyeslib/usage/chronicle_app_log_parser4.py` | app triplet reconstruction, `duration()` |
//! | `eyeslib/segments/build_shutdown_blocks.py` | SHUTDOWN glue + pairing |
//! | `eyeslib/segments/build_idle_blocks.py` | IDLE glue + pairing |
//! | `eyeslib/segments/identify_gap_segments.py` | GAP detection |
//! | `eyeslib/segments/build_gap_blocks.py` | GAP block pairing |
//! | `eyeslib/segments/build_glance_blocks.py` | GLANCE candidates + revocation |
//! | `eyeslib/segments/build_all_blocks.py` | reconciliation, precedence, block set |
//! | `eyeslib/exports/gen_pickups.py` | ACTIVE materialization + pickups export |
//! | `eyeslib/usage/get_app_screen_time.py` | per-app chunk merge |
//! | `eyeslib/usage/merge_app_status.py` | Final App Usage split-and-tag |
//!
//! The defining idea is the opposite of this engine's witness-based screen-gated
//! crediting: EYES detects the NON-active states explicitly and calls whatever
//! is left over active.
//!
//! ```text
//! ACTIVE = ¬(SHUTDOWN ∪ IDLE ∪ GAP ∪ GLANCE)
//! ```
//!
//! ACTIVE is a complement, not a guarantee of real use. It is never a stored
//! block in the reference's block file; it is materialized only where a hole
//! between blocks is wide enough (`gen_pickups.fill_active_blocks`).
//!
//! The single public entry point is [`segment_eyes_complement`]. One call
//! segments ONE device's event stream; callers holding a multi-participant
//! stream group by participant and call once per group.
//!
//! # Structural facts of the reference worth stating
//!
//! * **Concurrent app episodes are by design.** `ScreenTimeLogs` keys all three
//!   work queues by package (`queues_resume[app_name]`, `queues_pause[...]`,
//!   `queues_stop[...]`, created at `chronicle_app_log_parser4.py:271-276`,
//!   `:288-292`, `:371-374`). No code path lets one package's event touch
//!   another package's queue except the reboot branch (`:475-506`), which closes
//!   every open block for every package with `SSD`. The comment block at
//!   `:356-368` documents interleaved sequences such as
//!   `Paused(A1) → Resumed(A2) → Stopped(A1)` as the expected common case.
//!   Overlapping episodes are therefore not a tolerated artifact of reading
//!   `T=∞` literally — they are what the per-package queue structure produces.
//! * **`Activity Destroyed` is not a signal.** `stop_states`
//!   (`chronicle_app_log_parser4.py:32-35`) is exactly
//!   `['Activity Stopped', 'Unknown importance: 23']`. Destroyed falls through
//!   to the `else: pass` at `:508-511`. `AppKilled` comes only from a stop that
//!   is *not* within proximity of the newest resume (`:448-473`).
//! * **`stop_states` carries a live TODO in the reference**
//!   (`chronicle_app_log_parser4.py:31`):
//!   `# todo: we should also add 'screen non-interactive' here`.
//!   Screen-Non-Interactive is **not** a stop today. This module implements the
//!   shipped behavior; the TODO is recorded as a known incompleteness of the
//!   reference, not silently adopted.
//! * **The proximity interval is a CLI argument**, not a constant:
//!   `ScreenTimeLogs(filename, seconds, ...)` reads `sys.argv[2]`
//!   (`:610-614`, `:629`). 2 s is *our* default in
//!   [`EyesOptions::proximity_interval_seconds`], matching this repo's locked
//!   research configuration; the reference hardcodes nothing.
//! * **`struct_logic` is a second duration semantics**, also a CLI argument
//!   (`Y/N`, `:610`, `:616-619`), implemented at `:115-129`. With it off,
//!   duration is simply `time_pause - time_resume` and the stop is ignored
//!   entirely. Modelled as [`EyesDurationMode`].
//! * **Final App Usage splits and tags; it never filters.**
//!   `merge_app_status.process_and_split` two-pointer splits each app chunk
//!   against the block timeline, tagging every fragment with `device_status` —
//!   the block's type where it overlaps a block, `ACTIVE` where it does not
//!   (`merge_app_status.py:45-84`) — and rewrites the duration per fragment
//!   (`:90-100`). Blocks shorter than the threshold are dropped from the block
//!   timeline *before* the split (`:25-27`), which is what lets a brief idle
//!   flicker read as ACTIVE.
//!
//! # Interpretive decisions
//!
//! * The inference enums use the reference's own constant names
//!   (`MAR`/`NPI`/`NSI`/`MST`/`AKD`/`SSD`/`MPB`/`MCB`,
//!   `chronicle_app_log_parser4.py:14-24`) so provenance stays legible.
//! * Block identity comparisons use index identity. The reference's
//!   `ActivityBlock.__eq__` (`:194-197`) compares `str(self)`, i.e. structural
//!   equality; it happens to work only because the target block is mutated
//!   before the comparison loop runs.
//! * The reference's primary/secondary concurrency layering
//!   (`separate_overlap_screen_time.py`, and the `secondary_duration` rewrite at
//!   `merge_app_status.py:90-100`) is NOT ported. This repo models concurrent
//!   foreground usage natively through `usage_layer`; duplicating it here would
//!   be a second representation of the same thing.
//!
//! # Deliberate divergences from the reference
//!
//! Each of these is a reference defect that would corrupt output. They are
//! listed rather than silently repaired.
//!
//! 1. **Stale predecessor after a forward reboot gap.**
//!    `identify_gap_segments.py:192-193` does `i = j; continue`, skipping
//!    `prev_record = record`, so the next iteration measures silence from a
//!    record before the reboot and can fire a spurious long-silence gap. This
//!    module advances the predecessor with the cursor.
//! 2. **Non-monotonic gap emission.** The forward branch has no ordering guard
//!    while the backward branch does (`:204`), and `build_gap_blocks.py` never
//!    sorts despite its docstring claiming it does. This module keeps gap
//!    segments ordered and non-overlapping.
//! 3. **Nested-block cursor reset in `fill_active_blocks`.**
//!    `gen_pickups.py:70` assigns `curr = b` without taking `max(end_ts)`, so a
//!    block nested inside its predecessor rewinds the running end and emits a
//!    spurious overlapping ACTIVE row. This module carries the running maximum.

use std::collections::{BTreeMap, BTreeSet};

use crate::normalize_interaction_type;

/// Reference identity carried by the production EYES partial-replay receipt.
pub const EYES_REFERENCE_VERSION: &str = "0.1.0";
pub const EYES_REFERENCE_COMMIT: &str = "89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108";
pub const EYES_REFERENCE_LICENSE: &str = "unresolved";

/// Deliberate reference-defect repairs made by this port. These identifiers are
/// stable provenance vocabulary, not user-facing descriptions.
pub const EYES_REFERENCE_DEFECT_REPAIR_IDS: [&str; 3] = [
    "stale_predecessor_after_forward_reboot_gap",
    "non_monotonic_gap_emission",
    "nested_block_cursor_reset",
];

// ---- public input -------------------------------------------------------

/// One Chronicle Android usage event, as EYES sees it.
///
/// `interaction_type` accepts either a raw Android spelling or a canonical
/// value; it is normalized through [`normalize_interaction_type`] on entry.
/// `app_package_name` is empty for device-scoped events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EyesEvent<'a> {
    pub timestamp_ns: i64,
    pub interaction_type: &'a str,
    pub app_package_name: &'a str,
}

impl<'a> EyesEvent<'a> {
    pub fn new(timestamp_ns: i64, interaction_type: &'a str, app_package_name: &'a str) -> Self {
        Self {
            timestamp_ns,
            interaction_type,
            app_package_name,
        }
    }
}

/// The reference's `struct_logic` flag (`chronicle_app_log_parser4.py:115-129`),
/// a CLI `Y/N` argument selecting how an episode's duration is measured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesDurationMode {
    /// `struct_logic=Y`. Full triplet semantics: a clean stop measures to the
    /// stop, an anomalous stop measures to a repaired endpoint, and only a
    /// block with no usable stop falls back to the pause.
    TripletStructured,
    /// `struct_logic=N`. Duration is `time_pause - time_resume` and the stop is
    /// ignored entirely; a block with no pause has zero duration.
    PauseBound,
}

/// EYES thresholds.
///
/// [`Default`] carries the values the reference's runners actually pass, which
/// are not always the in-code defaults: `run_all_blocks.py` passes `60` for the
/// glue, `run_gap_segments.py` sets `min_hours = 3` (overriding `detect_gaps`'s
/// own `gap_hours=6`), and `Makefile:25` passes `5 5` for the pickups floor and
/// the ACTIVE hole floor.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesOptions {
    /// `ScreenTimeLogs.proximity_interval` — binds resume/pause/stop triplets.
    /// A CLI argument in the reference; 2 s is this repo's default.
    pub proximity_interval_seconds: f64,
    /// The reference's `struct_logic` flag.
    pub duration_mode: EyesDurationMode,
    /// Same-type consecutive-event glue for the SHUTDOWN and IDLE streams.
    pub block_glue_seconds: f64,
    /// Silence at or above this length is missing data.
    pub gap_silence_hours: f64,
    /// A reboot event gaps to the first event at least this far away.
    pub gap_reboot_neighbor_seconds: f64,
    /// Block-to-gap reconciliation tolerance.
    pub gap_reconcile_seconds: f64,
    /// Duration floor for a row in the pickups export, applied to every type.
    pub pickup_minimum_seconds: f64,
    /// Minimum hole between consecutive blocks that becomes an ACTIVE row.
    /// Holes below it are left uncovered, exactly as the reference leaves them.
    pub pickup_active_hole_seconds: f64,
    /// Blocks shorter than this are dropped from the device-state timeline
    /// before Final App Usage splits against it.
    pub fau_block_minimum_seconds: f64,
}

impl Default for EyesOptions {
    fn default() -> Self {
        Self {
            proximity_interval_seconds: 2.0,
            duration_mode: EyesDurationMode::TripletStructured,
            block_glue_seconds: 60.0,
            gap_silence_hours: 3.0,
            gap_reboot_neighbor_seconds: 1.0,
            gap_reconcile_seconds: 10.0,
            pickup_minimum_seconds: 5.0,
            pickup_active_hole_seconds: 5.0,
            fau_block_minimum_seconds: 5.0,
        }
    }
}

// ---- public output ------------------------------------------------------

/// The five EYES device states. ACTIVE is the complement of the other four.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum EyesBlockType {
    Shutdown,
    Idle,
    Glance,
    Gap,
    Active,
}

impl EyesBlockType {
    /// The literal `block_type` value the reference writes.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Shutdown => "SHUTDOWN",
            Self::Idle => "IDLE",
            Self::Glance => "GLANCE",
            Self::Gap => "GAP",
            Self::Active => "ACTIVE",
        }
    }
}

/// `EventBlock.kind` (`eyeslib/core/event_block.py:32-47`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesBlockKind {
    Paired,
    StartOnly,
    EndOnly,
    Empty,
}

/// One device-state block. Endpoints are optional because SHUTDOWN blocks are
/// emitted partial (`start_only` / `end_only`) and survive into the block file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesBlock {
    pub block_type: EyesBlockType,
    pub start_ns: Option<i64>,
    pub end_ns: Option<i64>,
}

impl EyesBlock {
    pub const fn kind(&self) -> EyesBlockKind {
        match (self.start_ns, self.end_ns) {
            (Some(_), Some(_)) => EyesBlockKind::Paired,
            (Some(_), None) => EyesBlockKind::StartOnly,
            (None, Some(_)) => EyesBlockKind::EndOnly,
            (None, None) => EyesBlockKind::Empty,
        }
    }

    pub fn duration_ns(&self) -> Option<i64> {
        match (self.start_ns, self.end_ns) {
            (Some(start), Some(end)) => Some(end - start),
            _ => None,
        }
    }

    /// `EventBlock.duration_seconds` — `int(...)`, truncated toward zero.
    pub fn duration_seconds_truncated(&self) -> Option<i64> {
        self.duration_ns().map(|ns| ns / 1_000_000_000)
    }

    fn paired(&self) -> Option<(i64, i64)> {
        match (self.start_ns, self.end_ns) {
            (Some(start), Some(end)) if end > start => Some((start, end)),
            _ => None,
        }
    }
}

/// One row of the pickups export.
///
/// The export deliberately carries EVERY block type that clears the duration
/// floor, discriminated by `block_type` (`gen_pickups.py:98-101`). The ACTIVE
/// rows within it are the pickups; see [`EyesSegmentation::pickups`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesPickupRow {
    pub block_type: EyesBlockType,
    pub start_ns: i64,
    pub end_ns: i64,
}

impl EyesPickupRow {
    pub const fn duration_ns(&self) -> i64 {
        self.end_ns - self.start_ns
    }
}

/// How an episode's opening was determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesResumeInference {
    /// A real `Activity Resumed` / `Move to Foreground`.
    Observed,
    /// `MAR` — a pause arrived with no preceding resume for the package.
    MissingActivityResumed,
}

/// How an episode's pause was determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesPauseInference {
    /// No pause was ever bound to this episode.
    Unobserved,
    /// A real `Activity Paused` / `Move to Background`.
    Observed,
    /// `MPB` — bound to the block preceding the newest resume, because that
    /// newest resume landed within the proximity interval.
    MatchingPreviousBlock,
    /// `MCB` — bound to the newest resume.
    MatchingCurrentBlock,
    /// `NPI` — an older resume superseded by a newer one for the same package.
    NextBlockPausedInference,
}

/// How an episode's end was determined. Provenance, not decoration: every
/// episode carries one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesEpisodeEndInference {
    /// No stop was ever bound and no repair applied.
    Unobserved,
    /// A real `Activity Stopped`.
    ObservedStop,
    /// `NSI` — the end came from a later block of the SAME package that carried
    /// a stop.
    NextBlockStoppedInference,
    /// `MST` — the end came from the resume timestamp of the next block of a
    /// DIFFERENT package. This is Parry & Toth forward pairing, used as EYES's
    /// repair rule when its own triplet rule fails
    /// (`chronicle_app_log_parser4.py:172-175`).
    MissingStop,
    /// `AKD` — a stop arrived outside the proximity of the newest resume, so the
    /// whole package was treated as killed.
    AppKilled,
    /// `SSD` — a reboot-class event closed every open block.
    SystemShutDown,
    /// The repair walk found nothing usable and the pause bounded the episode.
    PauseFallback,
}

/// One reconstructed app-usage episode (an `ActivityBlock`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesAppEpisode {
    pub app_package_name: String,
    pub time_resume_ns: Option<i64>,
    pub time_pause_ns: Option<i64>,
    pub time_stop_ns: Option<i64>,
    pub resume_inference: EyesResumeInference,
    pub pause_inference: EyesPauseInference,
    pub end_inference: EyesEpisodeEndInference,
    /// `ActivityBlock.duration()` in seconds, after any repair.
    pub duration_seconds: f64,
}

/// A per-app merged usage interval (`get_app_screen_time.merge_app_chunks`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesAppUsageChunk {
    pub app_package_name: String,
    pub start_ns: i64,
    pub end_ns: i64,
    /// Indices into [`EyesSegmentation::episodes`] merged into this chunk, so a
    /// chunk's provenance stays reachable.
    pub episode_indices: Vec<usize>,
}

/// One Final App Usage fragment: a slice of an app chunk tagged with the device
/// state that covered it. Fragments of EVERY device status are emitted.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesFinalAppUsage {
    pub app_package_name: String,
    /// Index into [`EyesSegmentation::app_usage_chunks`].
    pub chunk_index: usize,
    pub start_ns: i64,
    pub end_ns: i64,
    /// `ACTIVE` where no block covered the fragment, else the covering block's
    /// type.
    pub device_status: EyesBlockType,
}

/// Provenance for the source episode that determines a merged app chunk's
/// natural endpoint.
///
/// Several same-package episodes can merge into one chunk. The reference
/// output exposes only the merged bound, so the production adapter needs this
/// evidence to distinguish an interior device-state cut from the chunk's
/// natural app-episode end. Candidates are episodes whose effective endpoint
/// equals the merged chunk endpoint. Selection is deterministic: greatest
/// resume timestamp, then greatest episode index.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesChunkEndpointEvidence {
    pub chunk_index: usize,
    pub endpoint_ns: i64,
    pub candidate_episode_indices: Vec<usize>,
    pub selected_episode_index: usize,
    pub selected_end_inference: EyesEpisodeEndInference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesReplayStatus {
    PartialReplay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesHeadlineProjection {
    ActiveOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesPartialReplayLimitation {
    ReferencePrimarySecondaryConcurrencyUnported,
    PickupExportUnavailableOnProductSurface,
    HeadlineProjectsActiveFragmentsOnly,
}

/// Scientific receipt for Chronicle's deliberately partial EYES replay.
///
/// Selecting `eyes_complement` does not claim that Chronicle has ported EYES's
/// primary/secondary concurrency layer or exposed the reference pickup export.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesPartialReplayReceipt {
    pub protocol_version: String,
    pub status: EyesReplayStatus,
    pub source_version: String,
    pub source_commit: String,
    pub source_license_status: String,
    pub effective_options: EyesOptions,
    pub reference_defect_repair_ids: Vec<String>,
    pub headline_projection: EyesHeadlineProjection,
    pub full_tagged_fau_evidence_available: bool,
    pub reference_primary_secondary_concurrency_ported: bool,
    pub pickup_export_exposed: bool,
    pub pickup_export_row_count: u32,
    pub limitations: Vec<EyesPartialReplayLimitation>,
}

/// Evidence-only full Final App Usage surface. Headline app outputs continue to
/// use only `ACTIVE` fragments; the complete tagged fragments live here so the
/// exclusion is inspectable without changing scientific totals.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesTaggedFauEvidence {
    pub protocol_version: String,
    pub receipt: EyesPartialReplayReceipt,
    pub device_state_blocks: Vec<EyesBlock>,
    pub episodes: Vec<EyesAppEpisode>,
    pub app_usage_chunks: Vec<EyesAppUsageChunk>,
    pub fragments: Vec<EyesFinalAppUsage>,
    pub chunk_endpoints: Vec<EyesChunkEndpointEvidence>,
}

/// Participant boundary around one complete, serial EYES segmentation. Chunk
/// and episode indices are local to `evidence`; separate participant bundles
/// are never reindexed or statefully merged.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesParticipantTaggedFauEvidence {
    pub participant_id: String,
    pub evidence: EyesTaggedFauEvidence,
}

impl EyesParticipantTaggedFauEvidence {
    /// Heap bytes the participant's O(episodes) evidence vectors own, for the
    /// payload budget. A method rather than a free function: the workflow field-use scan
    /// attributes field access in free functions reachable from a product
    /// step to that step, and budget accounting is not a data read.
    pub fn heap_bytes(&self) -> usize {
        let evidence = &self.evidence;
        self.participant_id.capacity()
            + evidence.device_state_blocks.capacity() * std::mem::size_of::<EyesBlock>()
            + evidence.episodes.capacity() * std::mem::size_of::<EyesAppEpisode>()
            + evidence
                .episodes
                .iter()
                .map(|episode| episode.app_package_name.capacity())
                .sum::<usize>()
            + evidence.app_usage_chunks.capacity() * std::mem::size_of::<EyesAppUsageChunk>()
            + evidence
                .app_usage_chunks
                .iter()
                .map(|chunk| {
                    chunk.app_package_name.capacity()
                        + chunk.episode_indices.capacity() * std::mem::size_of::<usize>()
                })
                .sum::<usize>()
            + evidence.fragments.capacity() * std::mem::size_of::<EyesFinalAppUsage>()
            + evidence
                .fragments
                .iter()
                .map(|fragment| fragment.app_package_name.capacity())
                .sum::<usize>()
            + evidence.chunk_endpoints.capacity() * std::mem::size_of::<EyesChunkEndpointEvidence>()
            + evidence
                .chunk_endpoints
                .iter()
                .map(|endpoint| {
                    endpoint.candidate_episode_indices.capacity() * std::mem::size_of::<usize>()
                })
                .sum::<usize>()
    }
}

/// Kernel-owned content-addressed wrapper for the complete tagged Final App
/// Usage evidence. Runtime and semantic indexing must use these exact JCS
/// bytes instead of maintaining parallel serializers.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EyesTaggedFauArtifact<'a> {
    protocol_version: &'static str,
    status: EyesReplayStatus,
    episode_reconstruction_strategy: &'static str,
    participants: &'a [EyesParticipantTaggedFauEvidence],
}

pub const EYES_TAGGED_FAU_ARTIFACT_PROTOCOL_VERSION: &str = "chronicle-eyes-tagged-fau-artifact/v1";

/// Return the exact JCS bytes whose digest identifies the full EYES evidence
/// artifact. Participant bundles must already be in their canonical strict
/// order; silently sorting here would let the serialized artifact disagree
/// with the live producer witness.
pub fn eyes_tagged_fau_artifact_jcs_bytes(
    participants: &[EyesParticipantTaggedFauEvidence],
) -> Result<Vec<u8>, String> {
    if participants
        .iter()
        .any(|participant| participant.participant_id.trim().is_empty())
        || participants
            .windows(2)
            .any(|pair| pair[0].participant_id >= pair[1].participant_id)
    {
        return Err("eyes_tagged_fau_validation_error:participant_order".into());
    }
    serde_jcs::to_vec(&EyesTaggedFauArtifact {
        protocol_version: EYES_TAGGED_FAU_ARTIFACT_PROTOCOL_VERSION,
        status: EyesReplayStatus::PartialReplay,
        episode_reconstruction_strategy: "eyes_complement",
        participants,
    })
    .map_err(|error| format!("serialize EYES tagged-FAU artifact: {error}"))
}

fn expected_episode_duration_seconds(
    episode: &EyesAppEpisode,
    duration_mode: EyesDurationMode,
) -> Result<f64, String> {
    let Some(resume) = episode.time_resume_ns else {
        return Ok(0.0);
    };
    let seconds = |end: i64| -> Result<f64, String> {
        let delta = i128::from(end)
            .checked_sub(i128::from(resume))
            .ok_or_else(|| "eyes_tagged_fau_validation_error:duration_overflow".to_string())?;
        if delta < 0 || delta > i128::from(i64::MAX) {
            return Err("eyes_tagged_fau_validation_error:negative_episode_duration".into());
        }
        Ok(delta as f64 / 1_000_000_000.0)
    };
    match duration_mode {
        EyesDurationMode::PauseBound => episode
            .time_pause_ns
            .map(seconds)
            .transpose()
            .map(|duration| duration.unwrap_or(0.0)),
        EyesDurationMode::TripletStructured => match episode.end_inference {
            EyesEpisodeEndInference::ObservedStop
            | EyesEpisodeEndInference::NextBlockStoppedInference
            | EyesEpisodeEndInference::MissingStop
            | EyesEpisodeEndInference::AppKilled
            | EyesEpisodeEndInference::SystemShutDown => episode
                .time_stop_ns
                .map(seconds)
                .transpose()
                .map(|duration| duration.unwrap_or(0.0)),
            EyesEpisodeEndInference::PauseFallback => episode
                .time_pause_ns
                .map(seconds)
                .transpose()
                .map(|duration| duration.unwrap_or(0.0)),
            EyesEpisodeEndInference::Unobserved => Ok(0.0),
        },
    }
}

fn validate_tagged_fau_receipt(
    evidence: &EyesTaggedFauEvidence,
    effective_options: EyesOptions,
) -> Result<(), String> {
    let receipt = &evidence.receipt;
    let expected_repairs = EYES_REFERENCE_DEFECT_REPAIR_IDS
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let expected_limitations = vec![
        EyesPartialReplayLimitation::ReferencePrimarySecondaryConcurrencyUnported,
        EyesPartialReplayLimitation::PickupExportUnavailableOnProductSurface,
        EyesPartialReplayLimitation::HeadlineProjectsActiveFragmentsOnly,
    ];
    if evidence.protocol_version != "chronicle-eyes-tagged-fau-evidence/v1"
        || receipt.protocol_version != "chronicle-eyes-partial-replay-receipt/v1"
        || receipt.status != EyesReplayStatus::PartialReplay
        || receipt.source_version != EYES_REFERENCE_VERSION
        || receipt.source_commit != EYES_REFERENCE_COMMIT
        || receipt.source_license_status != EYES_REFERENCE_LICENSE
        || receipt.effective_options != effective_options
        || receipt.reference_defect_repair_ids != expected_repairs
        || receipt.headline_projection != EyesHeadlineProjection::ActiveOnly
        || !receipt.full_tagged_fau_evidence_available
        || receipt.reference_primary_secondary_concurrency_ported
        || receipt.pickup_export_exposed
        || receipt.limitations != expected_limitations
    {
        return Err("eyes_tagged_fau_validation_error:receipt_identity".into());
    }
    let expected_pickup_count =
        u32::try_from(build_pickup_export(&evidence.device_state_blocks, &effective_options).len())
            .map_err(|_| "eyes_tagged_fau_validation_error:pickup_count_overflow".to_string())?;
    if receipt.pickup_export_row_count != expected_pickup_count {
        return Err("eyes_tagged_fau_validation_error:pickup_count".into());
    }
    Ok(())
}

/// Validate the complete, evidence-only EYES Final App Usage surface without
/// replaying raw Chronicle events. This closes all deterministic structural
/// projections (receipt identity, chunks, tagged fragments, endpoints and
/// pickup census); authenticity against raw input is supplied separately by
/// the live result marker in `pipeline_v2`.
pub fn validate_eyes_tagged_fau_evidence(
    participants: &[EyesParticipantTaggedFauEvidence],
    effective_options: EyesOptions,
) -> Result<(), String> {
    let numeric_options = [
        effective_options.proximity_interval_seconds,
        effective_options.block_glue_seconds,
        effective_options.gap_silence_hours,
        effective_options.gap_reboot_neighbor_seconds,
        effective_options.gap_reconcile_seconds,
        effective_options.pickup_minimum_seconds,
        effective_options.pickup_active_hole_seconds,
        effective_options.fau_block_minimum_seconds,
    ];
    if numeric_options
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
    {
        return Err("eyes_tagged_fau_validation_error:effective_options".into());
    }
    let mut seen = BTreeSet::new();
    let mut previous: Option<&str> = None;
    for participant in participants {
        let participant_id = participant.participant_id.as_str();
        if participant_id.trim().is_empty()
            || previous.is_some_and(|value| value >= participant_id)
            || !seen.insert(participant_id)
        {
            return Err("eyes_tagged_fau_validation_error:participant_order".into());
        }
        previous = Some(participant_id);
        let evidence = &participant.evidence;

        let mut canonical_blocks = evidence.device_state_blocks.clone();
        canonical_blocks.sort_by_key(|block| (block.start_ns, block.end_ns, block.block_type));
        if canonical_blocks != evidence.device_state_blocks
            || evidence.device_state_blocks.iter().any(|block| {
                block.block_type == EyesBlockType::Active
                    || block.kind() == EyesBlockKind::Empty
                    || (block.kind() != EyesBlockKind::Paired
                        && block.block_type != EyesBlockType::Shutdown)
                    || match (block.start_ns, block.end_ns) {
                        (Some(start), Some(end)) => {
                            // A zero-length SHUTDOWN is produced on purpose
                            // (`build_bracket_blocks` pairs it with `>=`); a
                            // shutdown and a boot logged at one timestamp used
                            // to abort the whole EYES run here.
                            let duration = i128::from(end) - i128::from(start);
                            duration < 0
                                || (duration == 0 && block.block_type != EyesBlockType::Shutdown)
                                || duration > i128::from(i64::MAX)
                        }
                        _ => false,
                    }
            })
        {
            return Err("eyes_tagged_fau_validation_error:block_shape".into());
        }
        let mut running_end: Option<i64> = None;
        for block in &evidence.device_state_blocks {
            let (Some(start), Some(end)) = (block.start_ns, block.end_ns) else {
                continue;
            };
            if let Some(previous_end) = running_end {
                let gap = i128::from(start) - i128::from(previous_end);
                if gap < i128::from(i64::MIN) || gap > i128::from(i64::MAX) {
                    return Err("eyes_tagged_fau_validation_error:block_gap_overflow".into());
                }
            }
            running_end = Some(running_end.map_or(end, |previous| previous.max(end)));
        }
        // This recomputes the pickup export and therefore intentionally runs
        // only after the checked-i128 block preflight above.
        validate_tagged_fau_receipt(evidence, effective_options)?;

        for episode in &evidence.episodes {
            if episode.app_package_name.trim().is_empty()
                || !episode.duration_seconds.is_finite()
                || episode.duration_seconds < 0.0
                || episode.duration_seconds
                    != expected_episode_duration_seconds(episode, effective_options.duration_mode)?
            {
                return Err("eyes_tagged_fau_validation_error:episode_duration".into());
            }
        }
        let expected_chunks = merge_app_chunks(&evidence.episodes);
        // Zero-width chunks are valid evidence: a zero-duration episode
        // survives reconstruction by design (B03-B05 research decision - the
        // separate filter_zero_duration_sessions policy owns removal), and
        // merge_app_chunks maps it to a chunk with start_ns == end_ns, which
        // split_and_tag_app_usage then renders as zero fragments. Only a
        // negative or i64-overflowing span is impossible.
        if evidence.app_usage_chunks != expected_chunks
            || expected_chunks.iter().any(|chunk| {
                let duration = i128::from(chunk.end_ns) - i128::from(chunk.start_ns);
                duration < 0 || duration > i128::from(i64::MAX)
            })
        {
            return Err("eyes_tagged_fau_validation_error:app_usage_chunks".into());
        }
        let expected_fragments = split_and_tag_app_usage(
            &expected_chunks,
            &evidence.device_state_blocks,
            &effective_options,
        );
        if evidence.fragments != expected_fragments {
            return Err("eyes_tagged_fau_validation_error:fragments".into());
        }
        let segmentation = EyesSegmentation {
            blocks: evidence.device_state_blocks.clone(),
            pickup_export: build_pickup_export(&evidence.device_state_blocks, &effective_options),
            episodes: evidence.episodes.clone(),
            app_usage_chunks: expected_chunks,
            final_app_usage: expected_fragments,
            observation_start_ns: 0,
            observation_end_ns: 0,
        };
        let expected_endpoints = (0..segmentation.app_usage_chunks.len())
            .filter_map(|chunk_index| segmentation.chunk_endpoint_evidence(chunk_index))
            .collect::<Vec<_>>();
        if evidence.chunk_endpoints != expected_endpoints {
            return Err("eyes_tagged_fau_validation_error:chunk_endpoints".into());
        }
    }
    Ok(())
}

impl EyesFinalAppUsage {
    pub const fn duration_ns(&self) -> i64 {
        self.end_ns - self.start_ns
    }
}

/// Everything one EYES segmentation produces.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesSegmentation {
    /// The reconciled block set — the reference's `*_BLOCKS.csv`. Partials are
    /// included; ACTIVE is not, because ACTIVE is the complement and is
    /// materialized only in `pickup_export`.
    pub blocks: Vec<EyesBlock>,
    /// The reference's `*_PICKUPS.csv`: partials dropped, ACTIVE holes
    /// materialized, then the duration floor applied to every type.
    pub pickup_export: Vec<EyesPickupRow>,
    /// Triplet-reconstructed episodes.
    pub episodes: Vec<EyesAppEpisode>,
    /// Per-app merged usage intervals fed to the Final App Usage split.
    pub app_usage_chunks: Vec<EyesAppUsageChunk>,
    /// App usage split against the device-state timeline and tagged.
    pub final_app_usage: Vec<EyesFinalAppUsage>,
    pub observation_start_ns: i64,
    pub observation_end_ns: i64,
}

impl EyesSegmentation {
    /// The pickups proper: the ACTIVE rows of the pickups export.
    pub fn pickups(&self) -> impl Iterator<Item = &EyesPickupRow> {
        self.pickup_export
            .iter()
            .filter(|row| row.block_type == EyesBlockType::Active)
    }

    /// The Final App Usage fragments that fell in ACTIVE device state — the
    /// credited half of the split.
    pub fn credited_final_app_usage(&self) -> impl Iterator<Item = &EyesFinalAppUsage> {
        self.final_app_usage
            .iter()
            .filter(|row| row.device_status == EyesBlockType::Active)
    }

    /// Credited (ACTIVE) Final App Usage nanoseconds per package.
    pub fn credited_usage_by_package(&self) -> BTreeMap<&str, i64> {
        let mut totals: BTreeMap<&str, i64> = BTreeMap::new();
        for row in self.credited_final_app_usage() {
            *totals.entry(row.app_package_name.as_str()).or_insert(0) += row.duration_ns();
        }
        totals
    }

    /// Resolve the source episode governing a merged chunk's natural endpoint.
    ///
    /// This method deliberately does not infer an endpoint reason for interior
    /// Final App Usage fragments. Those fragments end at a device-state
    /// boundary; only a fragment ending at `endpoint_ns` inherits the selected
    /// episode's end inference.
    pub fn chunk_endpoint_evidence(&self, chunk_index: usize) -> Option<EyesChunkEndpointEvidence> {
        let chunk = self.app_usage_chunks.get(chunk_index)?;
        let mut candidates: Vec<usize> = chunk
            .episode_indices
            .iter()
            .copied()
            .filter(|&episode_index| {
                self.episodes
                    .get(episode_index)
                    .and_then(|episode| episode.time_stop_ns.or(episode.time_pause_ns))
                    == Some(chunk.end_ns)
            })
            .collect();
        candidates.sort_unstable();

        let selected_episode_index = candidates.iter().copied().max_by_key(|&episode_index| {
            let resume_ns = self.episodes[episode_index]
                .time_resume_ns
                .unwrap_or(i64::MIN);
            (resume_ns, episode_index)
        })?;
        let selected_end_inference = self.episodes[selected_episode_index].end_inference;

        Some(EyesChunkEndpointEvidence {
            chunk_index,
            endpoint_ns: chunk.end_ns,
            candidate_episode_indices: candidates,
            selected_episode_index,
            selected_end_inference,
        })
    }

    /// Materialize the evidence-only EYES surface and its partial-replay
    /// receipt. The orthogonal Chronicle concurrency option remains committed
    /// by the complete processing-options vector; it does not upgrade the
    /// unported EYES reference layer.
    pub fn tagged_fau_evidence(&self, effective_options: EyesOptions) -> EyesTaggedFauEvidence {
        let chunk_endpoints = (0..self.app_usage_chunks.len())
            .filter_map(|chunk_index| self.chunk_endpoint_evidence(chunk_index))
            .collect();
        EyesTaggedFauEvidence {
            protocol_version: "chronicle-eyes-tagged-fau-evidence/v1".to_owned(),
            receipt: EyesPartialReplayReceipt {
                protocol_version: "chronicle-eyes-partial-replay-receipt/v1".to_owned(),
                status: EyesReplayStatus::PartialReplay,
                source_version: EYES_REFERENCE_VERSION.to_owned(),
                source_commit: EYES_REFERENCE_COMMIT.to_owned(),
                source_license_status: EYES_REFERENCE_LICENSE.to_owned(),
                effective_options,
                reference_defect_repair_ids: EYES_REFERENCE_DEFECT_REPAIR_IDS
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                headline_projection: EyesHeadlineProjection::ActiveOnly,
                full_tagged_fau_evidence_available: true,
                reference_primary_secondary_concurrency_ported: false,
                pickup_export_exposed: false,
                pickup_export_row_count: self.pickup_export.len() as u32,
                limitations: vec![
                    EyesPartialReplayLimitation::ReferencePrimarySecondaryConcurrencyUnported,
                    EyesPartialReplayLimitation::PickupExportUnavailableOnProductSurface,
                    EyesPartialReplayLimitation::HeadlineProjectsActiveFragmentsOnly,
                ],
            },
            device_state_blocks: self.blocks.clone(),
            episodes: self.episodes.clone(),
            app_usage_chunks: self.app_usage_chunks.clone(),
            fragments: self.final_app_usage.clone(),
            chunk_endpoints,
        }
    }
}

// ---- entry point --------------------------------------------------------

/// Segment one device's event stream with the EYES complement paradigm.
///
/// `events` need not be sorted; the segmentation sorts a copy stably by
/// timestamp so equal-timestamp events keep caller order — the reference relies
/// on a stable `kind="mergesort"` sort for the same reason
/// (`build_glance_blocks.py:63`).
pub fn segment_eyes_complement(
    events: &[EyesEvent<'_>],
    options: &EyesOptions,
) -> EyesSegmentation {
    let mut ordered = events.to_vec();
    ordered.sort_by_key(|event| event.timestamp_ns);

    let Some(&first) = ordered.first() else {
        return EyesSegmentation::default();
    };
    let window_start = first.timestamp_ns;
    let window_end = ordered
        .last()
        .map(|event| event.timestamp_ns)
        .unwrap_or(window_start);

    let signals: Vec<EyesSignal> = ordered
        .iter()
        .map(|event| EyesSignal::classify(event.interaction_type))
        .collect();

    let blocks = build_block_set(&ordered, &signals, options);
    let pickup_export = build_pickup_export(&blocks, options);
    let episodes = reconstruct_app_triplets(&ordered, &signals, options);
    let app_usage_chunks = merge_app_chunks(&episodes);
    let final_app_usage = split_and_tag_app_usage(&app_usage_chunks, &blocks, options);

    EyesSegmentation {
        blocks,
        pickup_export,
        episodes,
        app_usage_chunks,
        final_app_usage,
        observation_start_ns: window_start,
        observation_end_ns: window_end,
    }
}

// ---- signal vocabulary --------------------------------------------------

/// The EYES-relevant slice of the Chronicle interaction vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EyesSignal {
    DeviceShutdown,
    UserStopped,
    DeviceStartup,
    UserUnlocked,
    ScreenNonInteractive,
    KeyguardShown,
    ScreenInteractive,
    KeyguardHidden,
    ActivityResumed,
    ActivityPaused,
    ActivityStopped,
    Other,
}

impl EyesSignal {
    fn classify(interaction_type: &str) -> Self {
        // The reference spells this one `Screen Non-interactive`; this crate's
        // canonical form capitalizes the I. Accept both.
        let canonical = if interaction_type == "Screen Non-interactive" {
            "Screen Non-Interactive"
        } else {
            normalize_interaction_type(interaction_type)
        };
        match canonical {
            "Device Shutdown" => Self::DeviceShutdown,
            "User Stopped" => Self::UserStopped,
            "Device Startup" => Self::DeviceStartup,
            "User Unlocked" => Self::UserUnlocked,
            "Screen Non-Interactive" => Self::ScreenNonInteractive,
            "Keyguard Shown" => Self::KeyguardShown,
            "Screen Interactive" => Self::ScreenInteractive,
            "Keyguard Hidden" => Self::KeyguardHidden,
            "Activity Resumed" => Self::ActivityResumed,
            "Activity Paused" => Self::ActivityPaused,
            "Activity Stopped" => Self::ActivityStopped,
            // `Activity Destroyed` deliberately lands here: the reference's
            // `stop_states` does not contain it.
            _ => Self::Other,
        }
    }

    /// `build_shutdown_blocks.RAW_SHUTDOWN_EVENTS`. EYES folds user-stopped into
    /// shutdown.
    const fn opens_shutdown(self) -> bool {
        matches!(self, Self::DeviceShutdown | Self::UserStopped)
    }

    /// `build_shutdown_blocks.RAW_BOOT_EVENTS`.
    const fn closes_shutdown(self) -> bool {
        matches!(self, Self::DeviceStartup | Self::UserUnlocked)
    }

    /// `build_idle_blocks.IDLE_START_EVENTS`.
    const fn opens_idle(self) -> bool {
        matches!(self, Self::ScreenNonInteractive | Self::KeyguardShown)
    }

    /// `build_idle_blocks.IDLE_END_EVENTS`.
    const fn closes_idle(self) -> bool {
        matches!(self, Self::ScreenInteractive | Self::KeyguardHidden)
    }

    /// `identify_gap_segments.end_reboot_states` — searches FORWARD for the gap.
    const fn is_shutdown_class_reboot(self) -> bool {
        matches!(self, Self::DeviceShutdown | Self::UserStopped)
    }

    /// `identify_gap_segments.start_reboot_states` — searches BACKWARD.
    const fn is_startup_class_reboot(self) -> bool {
        matches!(self, Self::DeviceStartup | Self::UserUnlocked)
    }

    /// `chronicle_app_log_parser4.reboot_states` — closes every open episode.
    const fn is_triplet_reboot(self) -> bool {
        matches!(
            self,
            Self::DeviceShutdown | Self::DeviceStartup | Self::UserUnlocked | Self::UserStopped
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BracketRole {
    Open,
    Close,
}

fn seconds_to_ns(seconds: f64) -> i64 {
    (seconds * 1_000_000_000.0).round() as i64
}

// ---- block construction -------------------------------------------------

/// `build_shutdown_blocks.glue_events` / `build_idle_blocks.glue_events`.
///
/// Glues same-type CONSECUTIVE EVENTS, strictly pairwise: at most two at a time,
/// and after a glue the cursor jumps by two so runs do not chain. An opening
/// pair keeps the SECOND timestamp, a closing pair keeps the FIRST — the
/// operation always shrinks the bracket. Bound is `0 <= dt <= glue`.
fn glue_pairwise(stream: &[(i64, BracketRole)], glue_ns: i64) -> Vec<(i64, BracketRole)> {
    let mut glued = Vec::with_capacity(stream.len());
    let mut index = 0usize;
    while index < stream.len() {
        let (timestamp, role) = stream[index];
        if let Some(&(next_timestamp, next_role)) = stream.get(index + 1) {
            if next_role == role {
                let delta = next_timestamp - timestamp;
                if (0..=glue_ns).contains(&delta) {
                    glued.push((
                        match role {
                            BracketRole::Open => next_timestamp,
                            BracketRole::Close => timestamp,
                        },
                        role,
                    ));
                    index += 2;
                    continue;
                }
            }
        }
        glued.push((timestamp, role));
        index += 1;
    }
    glued
}

/// `build_shutdown_blocks.build_shutdown_blocks_from_glued` and its IDLE twin.
///
/// `close_requires_strictly_after` reproduces a real asymmetry: SHUTDOWN pairs
/// with `ts >= pending` (`build_shutdown_blocks.py:120`) so a zero-length
/// shutdown IS created, while IDLE pairs with `ts > pending`
/// (`build_idle_blocks.py:103`) so a zero-length idle is not. In both, a close
/// that fails the test emits an `end_only` block and deliberately LEAVES the
/// pending open, so a later close can still pair with it.
fn build_bracket_blocks(
    glued: &[(i64, BracketRole)],
    block_type: EyesBlockType,
    close_requires_strictly_after: bool,
) -> Vec<EyesBlock> {
    let mut blocks = Vec::new();
    let mut pending: Option<i64> = None;
    for &(timestamp, role) in glued {
        match role {
            BracketRole::Open => {
                if let Some(previous) = pending {
                    blocks.push(EyesBlock {
                        block_type,
                        start_ns: Some(previous),
                        end_ns: None,
                    });
                }
                pending = Some(timestamp);
            }
            BracketRole::Close => {
                let pairs = pending.is_some_and(|start| {
                    if close_requires_strictly_after {
                        timestamp > start
                    } else {
                        timestamp >= start
                    }
                });
                if pairs {
                    blocks.push(EyesBlock {
                        block_type,
                        start_ns: pending.take(),
                        end_ns: Some(timestamp),
                    });
                } else {
                    blocks.push(EyesBlock {
                        block_type,
                        start_ns: None,
                        end_ns: Some(timestamp),
                    });
                }
            }
        }
    }
    if let Some(start) = pending {
        blocks.push(EyesBlock {
            block_type,
            start_ns: Some(start),
            end_ns: None,
        });
    }
    blocks
}

fn bracket_stream(
    events: &[EyesEvent<'_>],
    signals: &[EyesSignal],
    opens: fn(EyesSignal) -> bool,
    closes: fn(EyesSignal) -> bool,
) -> Vec<(i64, BracketRole)> {
    events
        .iter()
        .zip(signals)
        .filter_map(|(event, &signal)| {
            if opens(signal) {
                Some((event.timestamp_ns, BracketRole::Open))
            } else if closes(signal) {
                Some((event.timestamp_ns, BracketRole::Close))
            } else {
                None
            }
        })
        .collect()
}

/// `identify_gap_segments.detect_gaps`.
///
/// Three rules, in `elif` order so at most one fires per event:
/// 1. silence `>=` the long-silence threshold, measured against the predecessor;
/// 2. a shutdown-class reboot gaps FORWARD to the first event at least the
///    reboot-neighbour threshold later;
/// 3. a startup-class reboot gaps BACKWARD to the first event at least that far
///    earlier.
///
/// The first event can never produce a gap: every rule sits behind the
/// predecessor check.
fn detect_gap_segments(
    events: &[EyesEvent<'_>],
    signals: &[EyesSignal],
    options: &EyesOptions,
) -> Vec<(i64, i64)> {
    let silence_ns = seconds_to_ns(options.gap_silence_hours * 3600.0);
    let neighbour_ns = seconds_to_ns(options.gap_reboot_neighbor_seconds);
    let mut segments: Vec<(i64, i64)> = Vec::new();
    let mut previous: Option<i64> = None;
    let mut index = 0usize;
    while index < events.len() {
        let timestamp = events[index].timestamp_ns;
        if let Some(previous_timestamp) = previous {
            if timestamp - previous_timestamp >= silence_ns {
                push_gap_segment(&mut segments, previous_timestamp, timestamp);
            } else if signals[index].is_shutdown_class_reboot() {
                let far = events[index..]
                    .iter()
                    .position(|event| event.timestamp_ns - timestamp >= neighbour_ns)
                    .map(|offset| index + offset);
                if let Some(far) = far.filter(|&far| far > index) {
                    push_gap_segment(&mut segments, timestamp, events[far].timestamp_ns);
                    // Divergence 1: the reference jumps the cursor here but
                    // leaves its predecessor behind. Carry it with the cursor.
                    previous = Some(timestamp);
                    index = far;
                    continue;
                }
            } else if signals[index].is_startup_class_reboot() {
                let far = events[..=index]
                    .iter()
                    .rposition(|event| timestamp - event.timestamp_ns >= neighbour_ns);
                if let Some(far) = far.filter(|&far| far < index) {
                    push_gap_segment(&mut segments, events[far].timestamp_ns, timestamp);
                }
            }
        }
        previous = Some(timestamp);
        index += 1;
    }
    segments
}

/// `build_gap_blocks` requires `end > start` and drops anything else. Divergence
/// 2 also keeps the sequence ordered and non-overlapping.
fn push_gap_segment(segments: &mut Vec<(i64, i64)>, start: i64, end: i64) {
    if end <= start {
        return;
    }
    match segments.last_mut() {
        Some(last) if start < last.1 => {
            if end > last.1 {
                last.1 = end;
            }
        }
        _ => segments.push((start, end)),
    }
}

/// `build_glance_blocks.build_glance_blocks_from_events`.
///
/// The candidate stream is the union of the IDLE, SHUTDOWN and GAP event
/// streams filtered to `relevant_events` — which is why `Keyguard Shown`,
/// `Device Startup` and `User Unlocked` play no part here at all. In particular
/// `User Unlocked` does NOT revoke; only `Keyguard Hidden` does, plus the cancel
/// set `{Device Shutdown, User Stopped, Gap Start}`.
///
/// A revoked candidate is discarded permanently, but a later `Screen Interactive`
/// re-arms a fresh one — so `wake → unlock → wake → sleep` DOES emit a glance.
/// The "no intervening unlock" rule is relative to the LATEST wake only.
fn build_glance_blocks(
    events: &[EyesEvent<'_>],
    signals: &[EyesSignal],
    gap_segments: &[(i64, i64)],
) -> Vec<EyesBlock> {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum GlanceSignal {
        Wake,
        Sleep,
        Unlock,
        Cancel,
    }

    // The reference builds this stream by concatenating three files in the order
    // idle, shutdown, gap and then sorting with a STABLE mergesort
    // (`build_glance_blocks.load_glance_event_stream`). So at an equal timestamp
    // an idle event is processed before a shutdown event, and both before a gap,
    // regardless of where they sat in the raw log. Ranking by source stream
    // first and raw order second reproduces that; ranking by raw order alone let
    // a `Device Shutdown` sharing a timestamp with a `Screen Interactive` arm a
    // glance candidate the reference had already cancelled.
    const IDLE_STREAM: usize = 0;
    const SHUTDOWN_STREAM: usize = 1;
    const GAP_STREAM: usize = 2;

    let mut stream: Vec<(i64, usize, usize, GlanceSignal)> = Vec::new();
    for (order, (event, &signal)) in events.iter().zip(signals).enumerate() {
        let (source, glance_signal) = match signal {
            EyesSignal::ScreenInteractive => (IDLE_STREAM, GlanceSignal::Wake),
            EyesSignal::ScreenNonInteractive => (IDLE_STREAM, GlanceSignal::Sleep),
            EyesSignal::KeyguardHidden => (IDLE_STREAM, GlanceSignal::Unlock),
            EyesSignal::DeviceShutdown | EyesSignal::UserStopped => {
                (SHUTDOWN_STREAM, GlanceSignal::Cancel)
            }
            _ => continue,
        };
        stream.push((event.timestamp_ns, source, order, glance_signal));
    }
    // `Gap Start` is a cancel event carried by the third file.
    for (index, &(start, _)) in gap_segments.iter().enumerate() {
        stream.push((start, GAP_STREAM, index, GlanceSignal::Cancel));
    }
    stream.sort_by_key(|&(timestamp, source, order, _)| (timestamp, source, order));

    let mut blocks = Vec::new();
    let mut pending_start: Option<i64> = None;
    for (timestamp, _, _, glance_signal) in stream {
        match glance_signal {
            // Repeated wakes overwrite with the latest wake time.
            GlanceSignal::Wake => pending_start = Some(timestamp),
            GlanceSignal::Unlock => {
                if pending_start.is_some_and(|start| timestamp >= start) {
                    pending_start = None;
                }
            }
            GlanceSignal::Sleep => {
                if let Some(start) = pending_start {
                    if timestamp > start {
                        blocks.push(EyesBlock {
                            block_type: EyesBlockType::Glance,
                            start_ns: Some(start),
                            end_ns: Some(timestamp),
                        });
                    }
                }
                pending_start = None;
            }
            GlanceSignal::Cancel => pending_start = None,
        }
    }
    // A candidate still pending at the end of the stream is not a glance: the
    // definition needs the observed screen-off.
    blocks
}

/// `build_all_blocks.reconcile_shutdown_with_gaps` / `reconcile_idle_with_gaps`.
///
/// A two-pointer merge of bracket blocks against gap blocks. Evidence is a
/// BLOCK, not an event: a gap is relabelled when an independently built
/// shutdown/idle block lines up with it. Partial brackets are backfilled from
/// the gap's endpoint, which is how a boot with no shutdown acquires a start.
///
/// `guard_unclaimed` is the SHUTDOWN > IDLE > GAP precedence: the shutdown pass
/// runs first and claims unconditionally, and the idle pass then refuses to
/// reclaim anything shutdown already took.
fn reconcile_with_gaps(
    brackets: &mut [EyesBlock],
    gaps: &mut [EyesBlock],
    tolerance_ns: i64,
    claim_type: EyesBlockType,
    guard_unclaimed: bool,
) {
    let tolerance_seconds = tolerance_ns / 1_000_000_000;
    // The reference's `if block.duration_seconds and ... <= tol` short-circuits
    // on falsy, so `None` and `0` both fall through into the matching logic
    // instead of being skipped.
    let skippable = |block: &EyesBlock| {
        block
            .duration_seconds_truncated()
            .is_some_and(|seconds| seconds != 0 && seconds <= tolerance_seconds)
    };

    let (mut bracket_index, mut gap_index) = (0usize, 0usize);
    while bracket_index < brackets.len() && gap_index < gaps.len() {
        if skippable(&brackets[bracket_index]) {
            bracket_index += 1;
            continue;
        }
        if skippable(&gaps[gap_index]) {
            gap_index += 1;
            continue;
        }
        let bracket = brackets[bracket_index];
        let gap = gaps[gap_index];
        let (Some(gap_start), Some(gap_end)) = (gap.start_ns, gap.end_ns) else {
            gap_index += 1;
            continue;
        };
        let claimable = !guard_unclaimed || gap.block_type == EyesBlockType::Gap;

        match (bracket.start_ns, bracket.end_ns) {
            (None, Some(bracket_end)) => {
                if (bracket_end - gap_end).abs() <= tolerance_ns {
                    if claimable {
                        gaps[gap_index].block_type = claim_type;
                        brackets[bracket_index].start_ns = Some(gap_start);
                    }
                    bracket_index += 1;
                    gap_index += 1;
                } else if gap_end > bracket_end {
                    bracket_index += 1;
                } else {
                    gap_index += 1;
                }
            }
            (Some(bracket_start), None) => {
                if (bracket_start - gap_start).abs() <= tolerance_ns {
                    if claimable {
                        gaps[gap_index].block_type = claim_type;
                        brackets[bracket_index].end_ns = Some(gap_end);
                    }
                    bracket_index += 1;
                    gap_index += 1;
                } else if gap_start > bracket_start {
                    bracket_index += 1;
                } else {
                    gap_index += 1;
                }
            }
            (Some(bracket_start), Some(bracket_end)) => {
                // Containment, not overlap. One bracket can absorb several gaps,
                // which is why only the gap cursor advances on a match.
                if gap_start >= bracket_start - tolerance_ns
                    && gap_end <= bracket_end + tolerance_ns
                {
                    if claimable {
                        gaps[gap_index].block_type = claim_type;
                    }
                    gap_index += 1;
                } else if gap_end > bracket_end {
                    bracket_index += 1;
                } else {
                    gap_index += 1;
                }
            }
            (None, None) => bracket_index += 1,
        }
    }
}

/// `build_all_blocks.exclude_shutdown_from_idle_blocks`.
///
/// A real interval subtraction: SHUTDOWN is carved out of IDLE, splitting the
/// idle block when the shutdown sits inside it. Idle partials and gap-relabelled
/// idles are dropped here, which is why IDLE partials never reach the block file
/// while SHUTDOWN partials do.
fn exclude_shutdown_from_idle(idle: &[EyesBlock], shutdown: &[EyesBlock]) -> Vec<EyesBlock> {
    let mut carved: Vec<EyesBlock> = Vec::new();
    let mut shutdown_spans: Vec<(i64, i64)> = shutdown
        .iter()
        .filter(|block| block.block_type == EyesBlockType::Shutdown)
        .filter_map(EyesBlock::paired)
        .collect();
    shutdown_spans.sort_unstable();

    for block in idle {
        if block.block_type != EyesBlockType::Idle {
            continue;
        }
        let Some((start, end)) = block.paired() else {
            continue;
        };
        let mut cursor = start;
        for &(shutdown_start, shutdown_end) in &shutdown_spans {
            if shutdown_end <= cursor {
                continue;
            }
            if shutdown_start >= end {
                break;
            }
            if shutdown_start > cursor {
                carved.push(EyesBlock {
                    block_type: EyesBlockType::Idle,
                    start_ns: Some(cursor),
                    end_ns: Some(shutdown_start.min(end)),
                });
            }
            cursor = cursor.max(shutdown_end);
            if cursor >= end {
                break;
            }
        }
        if cursor < end {
            carved.push(EyesBlock {
                block_type: EyesBlockType::Idle,
                start_ns: Some(cursor),
                end_ns: Some(end),
            });
        }
    }
    carved
}

/// `build_all_blocks.exclude_overlapping_blocks`, called with zero tolerance.
///
/// A glance overlapping any shutdown or any surviving gap is dropped WHOLE — it
/// is never trimmed to the non-overlapping part.
fn exclude_overlapping_blocks(blocks: &[EyesBlock], masks: &[EyesBlock]) -> Vec<EyesBlock> {
    let mask_spans: Vec<(i64, i64)> = masks.iter().filter_map(EyesBlock::paired).collect();
    blocks
        .iter()
        .filter(|block| {
            let Some((start, end)) = block.paired() else {
                return false;
            };
            !mask_spans
                .iter()
                .any(|&(mask_start, mask_end)| mask_end > start && mask_start < end)
        })
        .copied()
        .collect()
}

/// `build_all_blocks.main` — the build, reconcile and exclude order.
fn build_block_set(
    events: &[EyesEvent<'_>],
    signals: &[EyesSignal],
    options: &EyesOptions,
) -> Vec<EyesBlock> {
    let glue_ns = seconds_to_ns(options.block_glue_seconds);
    let tolerance_ns = seconds_to_ns(options.gap_reconcile_seconds);

    let shutdown_stream = bracket_stream(
        events,
        signals,
        EyesSignal::opens_shutdown,
        EyesSignal::closes_shutdown,
    );
    let mut shutdown_blocks = build_bracket_blocks(
        &glue_pairwise(&shutdown_stream, glue_ns),
        EyesBlockType::Shutdown,
        false,
    );

    let idle_stream = bracket_stream(
        events,
        signals,
        EyesSignal::opens_idle,
        EyesSignal::closes_idle,
    );
    let mut idle_blocks = build_bracket_blocks(
        &glue_pairwise(&idle_stream, glue_ns),
        EyesBlockType::Idle,
        true,
    );

    let gap_segments = detect_gap_segments(events, signals, options);
    let mut gap_blocks: Vec<EyesBlock> = gap_segments
        .iter()
        .map(|&(start, end)| EyesBlock {
            block_type: EyesBlockType::Gap,
            start_ns: Some(start),
            end_ns: Some(end),
        })
        .collect();

    let glance_blocks = build_glance_blocks(events, signals, &gap_segments);

    // Precedence is realized by ordering, not by a sort key: the shutdown pass
    // claims unconditionally, the idle pass only what is still unclaimed.
    reconcile_with_gaps(
        &mut shutdown_blocks,
        &mut gap_blocks,
        tolerance_ns,
        EyesBlockType::Shutdown,
        false,
    );
    reconcile_with_gaps(
        &mut idle_blocks,
        &mut gap_blocks,
        tolerance_ns,
        EyesBlockType::Idle,
        true,
    );

    let carved_idle = exclude_shutdown_from_idle(&idle_blocks, &shutdown_blocks);
    let surviving_gaps: Vec<EyesBlock> = gap_blocks
        .iter()
        .filter(|block| block.block_type == EyesBlockType::Gap)
        .copied()
        .collect();
    let mut mask = shutdown_blocks.clone();
    mask.extend_from_slice(&surviving_gaps);
    let surviving_glances = exclude_overlapping_blocks(&glance_blocks, &mask);

    let mut blocks = shutdown_blocks;
    blocks.extend(carved_idle);
    blocks.extend(surviving_glances);
    blocks.extend(surviving_gaps);
    // The reference writes four grouped passes and leaves the file unsorted;
    // `blocks_from_csv` sorts by `start_ts` before anything consumes it. Sort
    // here so the value this module hands back is already the consumable order.
    blocks.sort_by_key(|block| (block.start_ns, block.end_ns, block.block_type));
    blocks
}

/// `gen_pickups.fill_active_blocks` plus the export floor.
///
/// The "fill" is a FLOOR, not a tolerance: only a hole at or above
/// `pickup_active_hole_seconds` becomes an ACTIVE row. Shorter holes are left
/// uncovered — absorbed by neither neighbour — so the pickup timeline is
/// deliberately not a partition of the observation window.
fn build_pickup_export(blocks: &[EyesBlock], options: &EyesOptions) -> Vec<EyesPickupRow> {
    let hole_ns = seconds_to_ns(options.pickup_active_hole_seconds);
    let floor_seconds = options.pickup_minimum_seconds as i64;

    let mut usable: Vec<(i64, i64, EyesBlockType)> = blocks
        .iter()
        .filter_map(|block| {
            block
                .paired()
                .map(|(start, end)| (start, end, block.block_type))
        })
        .collect();
    usable.sort_by_key(|&(start, end, block_type)| (start, end, block_type));

    let mut rows: Vec<EyesPickupRow> = Vec::new();
    let mut running_end: Option<i64> = None;
    for (start, end, block_type) in usable {
        if let Some(previous_end) = running_end {
            if start - previous_end >= hole_ns {
                rows.push(EyesPickupRow {
                    block_type: EyesBlockType::Active,
                    start_ns: previous_end,
                    end_ns: start,
                });
            }
        }
        rows.push(EyesPickupRow {
            block_type,
            start_ns: start,
            end_ns: end,
        });
        // Divergence 3: carry the running maximum so a nested block cannot
        // rewind the cursor and manufacture an overlapping ACTIVE row.
        running_end = Some(running_end.map_or(end, |previous| previous.max(end)));
    }

    // `duration_seconds` is integer-truncated before the floor is applied.
    rows.retain(|row| row.duration_ns() / 1_000_000_000 >= floor_seconds);
    rows
}

// ---- app triplets -------------------------------------------------------

#[derive(Debug, Clone)]
struct TripletBlock {
    app_name: String,
    time_resume: Option<i64>,
    time_pause: Option<i64>,
    time_stop: Option<i64>,
    resume_inference: EyesResumeInference,
    pause_inference: EyesPauseInference,
    end_inference: EyesEpisodeEndInference,
    /// The GLOBAL creation-order successor. Built at the three places the
    /// reference links blocks: a resume (`:267-269`), a `MAR` pause
    /// (`:346-348`), and an orphan stop (`:382-384`).
    next: Option<usize>,
}

#[derive(Default)]
struct PackageQueues {
    resume: Vec<usize>,
    pause: Vec<usize>,
    stop: Vec<usize>,
}

/// `ScreenTimeLogs.reconstruct_blocks` followed by `ActivityBlock.duration`.
fn reconstruct_app_triplets(
    events: &[EyesEvent<'_>],
    signals: &[EyesSignal],
    options: &EyesOptions,
) -> Vec<EyesAppEpisode> {
    let proximity_ns = seconds_to_ns(options.proximity_interval_seconds);
    // `in_proximity` is `abs(seconds) < proximity_interval` — strict, and
    // symmetric about zero.
    let in_proximity = |left: i64, right: i64| (right - left).abs() < proximity_ns;

    let mut arena: Vec<TripletBlock> = Vec::new();
    let mut queues: BTreeMap<String, PackageQueues> = BTreeMap::new();
    // The reference iterates plain dicts, so package order is first-seen order.
    let mut package_order: Vec<String> = Vec::new();
    let mut previous_linked: Option<usize> = None;
    let mut last_stop_block: Option<usize> = None;

    for (event, &signal) in events.iter().zip(signals) {
        let package = event.app_package_name;
        match signal {
            EyesSignal::ActivityResumed => {
                arena.push(TripletBlock {
                    app_name: package.to_owned(),
                    time_resume: Some(event.timestamp_ns),
                    time_pause: None,
                    time_stop: None,
                    resume_inference: EyesResumeInference::Observed,
                    pause_inference: EyesPauseInference::Unobserved,
                    end_inference: EyesEpisodeEndInference::Unobserved,
                    next: None,
                });
                let created = arena.len() - 1;
                if let Some(previous) = previous_linked {
                    arena[previous].next = Some(created);
                }
                previous_linked = Some(created);
                ensure_package(&mut queues, &mut package_order, package);
                queues
                    .get_mut(package)
                    .expect("package queues just created")
                    .resume
                    .push(created);
            }
            EyesSignal::ActivityPaused => {
                ensure_package(&mut queues, &mut package_order, package);
                let resume_len = queues[package].resume.len();
                if resume_len >= 2 {
                    let queue = &queues[package].resume;
                    let older = queue[resume_len - 2];
                    let newest = queue[resume_len - 1];
                    // Bind to the older block when the newest resume directly
                    // succeeds it AND arrived within the proximity interval.
                    let target = if arena[older].next == Some(newest)
                        && arena[newest]
                            .time_resume
                            .is_some_and(|resume| in_proximity(resume, event.timestamp_ns))
                    {
                        arena[older].pause_inference = EyesPauseInference::MatchingPreviousBlock;
                        older
                    } else {
                        arena[newest].pause_inference = EyesPauseInference::MatchingCurrentBlock;
                        newest
                    };
                    arena[target].time_pause = Some(event.timestamp_ns);

                    let package_queues = queues.get_mut(package).expect("package queues");
                    while !package_queues.resume.is_empty() {
                        let front = package_queues.resume.remove(0);
                        if front == target {
                            break;
                        }
                        arena[front].pause_inference = EyesPauseInference::NextBlockPausedInference;
                        package_queues.pause.push(front);
                    }
                    package_queues.pause.push(target);
                } else if resume_len == 1 {
                    let package_queues = queues.get_mut(package).expect("package queues");
                    let block = package_queues.resume.remove(0);
                    arena[block].time_pause = Some(event.timestamp_ns);
                    arena[block].pause_inference = EyesPauseInference::Observed;
                    package_queues.pause.push(block);
                } else {
                    // MAR — a pause with no preceding resume for this package.
                    arena.push(TripletBlock {
                        app_name: package.to_owned(),
                        time_resume: None,
                        time_pause: Some(event.timestamp_ns),
                        time_stop: None,
                        resume_inference: EyesResumeInference::MissingActivityResumed,
                        pause_inference: EyesPauseInference::Observed,
                        end_inference: EyesEpisodeEndInference::Unobserved,
                        next: None,
                    });
                    let created = arena.len() - 1;
                    if let Some(previous) = previous_linked {
                        arena[previous].next = Some(created);
                    }
                    previous_linked = Some(created);
                    queues
                        .get_mut(package)
                        .expect("package queues")
                        .pause
                        .push(created);
                }
            }
            EyesSignal::ActivityStopped => {
                ensure_package(&mut queues, &mut package_order, package);
                if queues[package].resume.is_empty() {
                    if queues[package].pause.is_empty() {
                        // A lone stop. Unusual, but the reference keeps it.
                        arena.push(TripletBlock {
                            app_name: package.to_owned(),
                            time_resume: None,
                            time_pause: None,
                            time_stop: Some(event.timestamp_ns),
                            resume_inference: EyesResumeInference::Observed,
                            pause_inference: EyesPauseInference::Unobserved,
                            end_inference: EyesEpisodeEndInference::ObservedStop,
                            next: None,
                        });
                        let created = arena.len() - 1;
                        if let Some(previous) = previous_linked {
                            arena[previous].next = Some(created);
                        }
                        previous_linked = Some(created);
                        queues
                            .get_mut(package)
                            .expect("package queues")
                            .stop
                            .push(created);
                    } else {
                        let package_queues = queues.get_mut(package).expect("package queues");
                        let current = *package_queues.pause.last().expect("non-empty pause queue");
                        arena[current].time_stop = Some(event.timestamp_ns);
                        arena[current].end_inference = EyesEpisodeEndInference::ObservedStop;
                        last_stop_block = Some(current);
                        while !package_queues.pause.is_empty() {
                            let front = package_queues.pause.remove(0);
                            if front == current {
                                break;
                            }
                            if arena[front].end_inference == EyesEpisodeEndInference::Unobserved {
                                arena[front].end_inference =
                                    EyesEpisodeEndInference::NextBlockStoppedInference;
                            }
                            package_queues.stop.push(front);
                        }
                        package_queues.stop.push(current);
                    }
                } else {
                    let newest = *queues[package]
                        .resume
                        .last()
                        .expect("non-empty resume queue");
                    let near = arena[newest]
                        .time_resume
                        .is_some_and(|resume| in_proximity(resume, event.timestamp_ns));
                    if near {
                        let package_queues = queues.get_mut(package).expect("package queues");
                        let current = if let Some(block) = package_queues.pause.pop() {
                            block
                        } else {
                            package_queues.resume.remove(0)
                        };
                        arena[current].time_stop = Some(event.timestamp_ns);
                        arena[current].end_inference = EyesEpisodeEndInference::ObservedStop;
                        last_stop_block = Some(current);
                        package_queues.stop.push(current);
                    } else {
                        // The stop is far from the newest resume: the package
                        // was killed, and every one of its blocks closes.
                        let package_queues = queues.get_mut(package).expect("package queues");
                        let carrier = package_queues
                            .resume
                            .last()
                            .or_else(|| package_queues.pause.last())
                            .copied();
                        if let Some(carrier) = carrier {
                            arena[carrier].time_stop = Some(event.timestamp_ns);
                            arena[carrier].end_inference = EyesEpisodeEndInference::AppKilled;
                        }
                        while !package_queues.pause.is_empty() {
                            let front = package_queues.pause.remove(0);
                            if arena[front].end_inference == EyesEpisodeEndInference::Unobserved {
                                arena[front].end_inference = EyesEpisodeEndInference::AppKilled;
                            }
                            package_queues.stop.push(front);
                        }
                        while !package_queues.resume.is_empty() {
                            let front = package_queues.resume.remove(0);
                            arena[front].end_inference = EyesEpisodeEndInference::AppKilled;
                            package_queues.stop.push(front);
                        }
                    }
                }
            }
            signal if signal.is_triplet_reboot() => {
                if let Some(current) = last_stop_block {
                    if arena[current].time_stop.is_none() {
                        arena[current].time_stop = Some(event.timestamp_ns);
                        arena[current].end_inference = EyesEpisodeEndInference::SystemShutDown;
                    }
                }
                // A reboot is the one event that reaches across packages.
                for package_name in &package_order {
                    let package_queues = queues.get_mut(package_name).expect("package queues");
                    while !package_queues.pause.is_empty() {
                        let front = package_queues.pause.remove(0);
                        arena[front].end_inference = EyesEpisodeEndInference::SystemShutDown;
                        package_queues.stop.push(front);
                    }
                    while !package_queues.resume.is_empty() {
                        let front = package_queues.resume.remove(0);
                        arena[front].end_inference = EyesEpisodeEndInference::SystemShutDown;
                        package_queues.stop.push(front);
                    }
                }
            }
            _ => {}
        }
    }

    // `blocks2csv` walks the resume, pause and stop queues in that order, and
    // `duration()` mutates `time_stop` as it goes, so a later walk can observe an
    // endpoint an earlier one repaired. Preserve that order.
    let mut emission_order: Vec<usize> = Vec::with_capacity(arena.len());
    for select in 0..3 {
        for package_name in &package_order {
            let package_queues = &queues[package_name];
            let queue = match select {
                0 => &package_queues.resume,
                1 => &package_queues.pause,
                _ => &package_queues.stop,
            };
            emission_order.extend(queue.iter().copied());
        }
    }

    let mut episodes = Vec::with_capacity(emission_order.len());
    for index in emission_order {
        let duration_seconds = resolve_duration(&mut arena, index, options.duration_mode);
        let block = &arena[index];
        episodes.push(EyesAppEpisode {
            app_package_name: block.app_name.clone(),
            time_resume_ns: block.time_resume,
            time_pause_ns: block.time_pause,
            time_stop_ns: block.time_stop,
            resume_inference: block.resume_inference,
            pause_inference: block.pause_inference,
            end_inference: block.end_inference,
            duration_seconds,
        });
    }
    episodes
}

fn ensure_package(
    queues: &mut BTreeMap<String, PackageQueues>,
    package_order: &mut Vec<String>,
    package: &str,
) {
    if !queues.contains_key(package) {
        queues.insert(package.to_owned(), PackageQueues::default());
        package_order.push(package.to_owned());
    }
}

fn seconds_between(start: i64, end: i64) -> f64 {
    (end - start) as f64 / 1_000_000_000.0
}

/// `ActivityBlock.duration`.
///
/// Repair precedence when the stop is anomalous and undated:
/// 1. an endpoint already on the block wins;
/// 2. else walk the GLOBAL block chain forward to the first block that either
///    carries a stop or belongs to a different package;
/// 3. same package → adopt that block's stop, tag `NSI`;
/// 4. different package → adopt that block's RESUME, tag `MST`;
/// 5. walk ran off the end → use this block's own pause;
/// 6. otherwise zero.
fn resolve_duration(
    arena: &mut [TripletBlock],
    index: usize,
    duration_mode: EyesDurationMode,
) -> f64 {
    let Some(resume) = arena[index].time_resume else {
        return 0.0;
    };

    if duration_mode == EyesDurationMode::PauseBound {
        return arena[index]
            .time_pause
            .map_or(0.0, |pause| seconds_between(resume, pause));
    }

    if arena[index].end_inference == EyesEpisodeEndInference::ObservedStop {
        if let Some(stop) = arena[index].time_stop {
            return seconds_between(resume, stop);
        }
    }

    // `anomaly_states = [MAR, NPI, NSI, AKD, SSD]`, but the reference tests only
    // `stop_event` against that list, and `ActivityBlock` keeps `resume_event`,
    // `pause_event` and `stop_event` as three separate fields. `MAR` is only
    // ever written to `resume_event` and `NPI` only ever to `pause_event`, so
    // both are dead entries in the list: the test reduces to
    // `stop_event ∈ {NSI, AKD, SSD}`. Widening it to the resume and pause tags
    // would fire the repair walk on blocks the reference leaves at zero — an
    // `NPI` block has already been superseded by a newer resume of the same
    // package, so crediting it to the next foreign app's resume double-counts.
    //
    // `MissingStop` (`MST`) is listed by the reference but is unreachable here
    // for the same reason it is unreachable there: `MST` is only ever assigned
    // inside this function, and each block's duration is resolved exactly once.
    let anomalous = matches!(
        arena[index].end_inference,
        EyesEpisodeEndInference::NextBlockStoppedInference
            | EyesEpisodeEndInference::AppKilled
            | EyesEpisodeEndInference::SystemShutDown
    );

    if anomalous {
        if let Some(stop) = arena[index].time_stop {
            return seconds_between(resume, stop);
        }
        let mut cursor = arena[index].next;
        while let Some(candidate) = cursor {
            if arena[candidate].time_stop.is_some()
                || arena[candidate].app_name != arena[index].app_name
            {
                break;
            }
            cursor = arena[candidate].next;
        }
        match cursor {
            None => {
                if let Some(pause) = arena[index].time_pause {
                    arena[index].end_inference = EyesEpisodeEndInference::PauseFallback;
                    return seconds_between(resume, pause);
                }
            }
            Some(candidate) => {
                if arena[candidate].app_name == arena[index].app_name {
                    arena[index].time_stop = arena[candidate].time_stop;
                    arena[index].end_inference = EyesEpisodeEndInference::NextBlockStoppedInference;
                } else {
                    arena[index].time_stop = arena[candidate].time_resume;
                    arena[index].end_inference = EyesEpisodeEndInference::MissingStop;
                }
                if let Some(stop) = arena[index].time_stop {
                    return seconds_between(resume, stop);
                }
            }
        }
        return 0.0;
    }

    // Never stopped at all: fall back to the pause.
    if let Some(pause) = arena[index].time_pause {
        arena[index].end_inference = EyesEpisodeEndInference::PauseFallback;
        return seconds_between(resume, pause);
    }
    0.0
}

// ---- Final App Usage ----------------------------------------------------

/// `get_app_screen_time.get_app_chunks` + `merge_app_chunks`.
///
/// A chunk runs from the resume to the stop, or to the pause when there is no
/// stop; a block with neither is skipped. Chunks are then merged per package, so
/// overlapping episodes of one app become one interval before the split.
fn merge_app_chunks(episodes: &[EyesAppEpisode]) -> Vec<EyesAppUsageChunk> {
    let mut by_package: BTreeMap<&str, Vec<(i64, i64, usize)>> = BTreeMap::new();
    for (index, episode) in episodes.iter().enumerate() {
        let Some(start) = episode.time_resume_ns else {
            continue;
        };
        let Some(end) = episode.time_stop_ns.or(episode.time_pause_ns) else {
            continue;
        };
        by_package
            .entry(episode.app_package_name.as_str())
            .or_default()
            .push((start, end, index));
    }

    let mut chunks = Vec::new();
    for (package, mut intervals) in by_package {
        intervals.sort_by_key(|&(start, end, _)| (start, end));
        let mut current: Option<EyesAppUsageChunk> = None;
        for (start, end, episode_index) in intervals {
            match current.as_mut() {
                Some(chunk) if start <= chunk.end_ns => {
                    chunk.end_ns = chunk.end_ns.max(end);
                    chunk.episode_indices.push(episode_index);
                }
                _ => {
                    if let Some(chunk) = current.take() {
                        chunks.push(chunk);
                    }
                    current = Some(EyesAppUsageChunk {
                        app_package_name: package.to_owned(),
                        start_ns: start,
                        end_ns: end,
                        episode_indices: vec![episode_index],
                    });
                }
            }
        }
        if let Some(chunk) = current {
            chunks.push(chunk);
        }
    }
    chunks.sort_by(|left, right| {
        left.start_ns
            .cmp(&right.start_ns)
            .then_with(|| left.app_package_name.cmp(&right.app_package_name))
    });
    chunks
}

/// `merge_app_status.process_and_split`.
///
/// Splits every chunk against the device-state timeline and tags each fragment.
/// It does NOT filter: a fragment covered by a block is emitted carrying that
/// block's type, and a fragment covered by nothing is emitted as ACTIVE. Blocks
/// shorter than the threshold are dropped from the timeline first, which is what
/// lets a brief idle flicker read as ACTIVE.
fn split_and_tag_app_usage(
    chunks: &[EyesAppUsageChunk],
    blocks: &[EyesBlock],
    options: &EyesOptions,
) -> Vec<EyesFinalAppUsage> {
    let minimum_ns = seconds_to_ns(options.fau_block_minimum_seconds);
    let mut timeline: Vec<(i64, i64, EyesBlockType)> = blocks
        .iter()
        .filter_map(|block| {
            block
                .paired()
                .filter(|&(start, end)| end - start >= minimum_ns)
                .map(|(start, end)| (start, end, block.block_type))
        })
        .collect();
    timeline.sort_by_key(|&(start, end, block_type)| (start, end, block_type));

    let mut rows = Vec::new();
    for (chunk_index, chunk) in chunks.iter().enumerate() {
        let mut cursor = chunk.start_ns;
        for &(block_start, block_end, block_type) in &timeline {
            if cursor >= chunk.end_ns || block_start >= chunk.end_ns {
                break;
            }
            if block_end <= cursor {
                continue;
            }
            if block_start > cursor {
                let boundary = block_start.min(chunk.end_ns);
                push_fragment(
                    &mut rows,
                    chunk,
                    chunk_index,
                    cursor,
                    boundary,
                    EyesBlockType::Active,
                );
                cursor = boundary;
            }
            let overlap_end = block_end.min(chunk.end_ns);
            push_fragment(
                &mut rows,
                chunk,
                chunk_index,
                cursor,
                overlap_end,
                block_type,
            );
            cursor = cursor.max(overlap_end);
        }
        if cursor < chunk.end_ns {
            push_fragment(
                &mut rows,
                chunk,
                chunk_index,
                cursor,
                chunk.end_ns,
                EyesBlockType::Active,
            );
        }
    }
    rows
}

fn push_fragment(
    rows: &mut Vec<EyesFinalAppUsage>,
    chunk: &EyesAppUsageChunk,
    chunk_index: usize,
    start: i64,
    end: i64,
    device_status: EyesBlockType,
) {
    if end > start {
        rows.push(EyesFinalAppUsage {
            app_package_name: chunk.app_package_name.clone(),
            chunk_index,
            start_ns: start,
            end_ns: end,
            device_status,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    /// One second, in nanoseconds. Every fixture below is written in seconds.
    const S: i64 = 1_000_000_000;
    const HOUR: i64 = 3600 * S;

    use BracketRole::{Close, Open};
    use EyesBlockType::{Active, Gap, Glance, Idle, Shutdown};

    fn signals_of(events: &[EyesEvent<'_>]) -> Vec<EyesSignal> {
        events
            .iter()
            .map(|event| EyesSignal::classify(event.interaction_type))
            .collect()
    }

    fn block(block_type: EyesBlockType, start: Option<i64>, end: Option<i64>) -> EyesBlock {
        EyesBlock {
            block_type,
            start_ns: start,
            end_ns: end,
        }
    }

    fn paired(block_type: EyesBlockType, start: i64, end: i64) -> EyesBlock {
        block(block_type, Some(start), Some(end))
    }

    fn triplets(events: &[EyesEvent<'_>], options: &EyesOptions) -> Vec<EyesAppEpisode> {
        reconstruct_app_triplets(events, &signals_of(events), options)
    }

    fn find_episode<'a>(
        episodes: &'a [EyesAppEpisode],
        package: &str,
        resume_ns: i64,
    ) -> &'a EyesAppEpisode {
        episodes
            .iter()
            .find(|episode| {
                episode.app_package_name == package && episode.time_resume_ns == Some(resume_ns)
            })
            .unwrap_or_else(|| panic!("no episode for {package} resuming at {resume_ns}"))
    }

    fn synthetic_episode(
        package: &str,
        resume: Option<i64>,
        pause: Option<i64>,
        stop: Option<i64>,
    ) -> EyesAppEpisode {
        EyesAppEpisode {
            app_package_name: package.to_owned(),
            time_resume_ns: resume,
            time_pause_ns: pause,
            time_stop_ns: stop,
            resume_inference: EyesResumeInference::Observed,
            pause_inference: EyesPauseInference::Observed,
            end_inference: EyesEpisodeEndInference::ObservedStop,
            duration_seconds: 0.0,
        }
    }

    fn synthetic_chunk(package: &str, start: i64, end: i64) -> EyesAppUsageChunk {
        EyesAppUsageChunk {
            app_package_name: package.to_owned(),
            start_ns: start,
            end_ns: end,
            episode_indices: Vec::new(),
        }
    }

    fn committed_eyes_fixture_rows(participant_id: &str) -> Vec<(i64, String, String)> {
        const FIXTURE: &[u8] =
            include_bytes!("../../../web/src/testSupport/fixtures/eyes-fau-close-provenance.csv");
        assert_eq!(
            hex::encode(Sha256::digest(FIXTURE)),
            "d492c19344bf638bcdfdb14a035f38941eeaf062fcb564641d02ea8d64918cb1"
        );
        let mut reader = csv::Reader::from_reader(FIXTURE);
        let headers = reader.headers().unwrap().clone();
        let column = |name: &str| {
            headers
                .iter()
                .position(|header| header == name)
                .unwrap_or_else(|| panic!("missing fixture column {name}"))
        };
        let participant = column("participant_id");
        let timestamp = column("event_timestamp");
        let interaction = column("interaction_type");
        let package = column("app_package_name");
        reader
            .records()
            .map(Result::unwrap)
            .filter(|record| record.get(participant) == Some(participant_id))
            .map(|record| {
                (
                    crate::parse_chronicle_timestamp_ns(record.get(timestamp).unwrap()).unwrap(),
                    record.get(interaction).unwrap().to_owned(),
                    record.get(package).unwrap().to_owned(),
                )
            })
            .collect()
    }

    // -- vocabulary -------------------------------------------------------

    #[test]
    fn unknown_importance_codes_normalize_into_the_eyes_vocabulary() {
        assert_eq!(
            EyesSignal::classify("Unknown importance: 23"),
            EyesSignal::ActivityStopped
        );
        assert_eq!(
            EyesSignal::classify("Unknown importance: 16"),
            EyesSignal::ScreenNonInteractive
        );
        assert_eq!(
            EyesSignal::classify("Unknown importance: 26"),
            EyesSignal::DeviceShutdown
        );
        assert_eq!(
            EyesSignal::classify("Unknown importance: 29"),
            EyesSignal::UserStopped
        );
        assert_eq!(
            EyesSignal::classify("Move to Foreground"),
            EyesSignal::ActivityResumed
        );
        // The reference spells this one with a lowercase `i`.
        assert_eq!(
            EyesSignal::classify("Screen Non-interactive"),
            EyesSignal::ScreenNonInteractive
        );
    }

    #[test]
    fn the_partial_replay_receipt_vocabulary_is_exact_and_versioned() {
        assert_eq!(EYES_REFERENCE_VERSION, "0.1.0");
        assert_eq!(
            EYES_REFERENCE_COMMIT,
            "89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108"
        );
        assert_eq!(EYES_REFERENCE_LICENSE, "unresolved");
        assert_eq!(
            EYES_REFERENCE_DEFECT_REPAIR_IDS,
            [
                "stale_predecessor_after_forward_reboot_gap",
                "non_monotonic_gap_emission",
                "nested_block_cursor_reset",
            ]
        );
    }

    #[test]
    fn activity_destroyed_is_not_in_the_eyes_vocabulary() {
        // `stop_states` at chronicle_app_log_parser4.py:32-35 does not contain
        // it; it falls through the `else: pass` at :508-511.
        assert_eq!(
            EyesSignal::classify("Activity Destroyed"),
            EyesSignal::Other
        );
        assert_eq!(
            EyesSignal::classify("Unknown importance: 24"),
            EyesSignal::Other
        );
    }

    #[test]
    fn block_types_carry_the_reference_labels() {
        assert_eq!(Shutdown.label(), "SHUTDOWN");
        assert_eq!(Idle.label(), "IDLE");
        assert_eq!(Glance.label(), "GLANCE");
        assert_eq!(Gap.label(), "GAP");
        assert_eq!(Active.label(), "ACTIVE");
    }

    #[test]
    fn block_kind_reports_which_endpoints_were_observed() {
        assert_eq!(paired(Shutdown, 0, S).kind(), EyesBlockKind::Paired);
        assert_eq!(
            block(Shutdown, Some(0), None).kind(),
            EyesBlockKind::StartOnly
        );
        assert_eq!(
            block(Shutdown, None, Some(0)).kind(),
            EyesBlockKind::EndOnly
        );
        assert_eq!(block(Shutdown, None, None).kind(), EyesBlockKind::Empty);
    }

    // -- pairwise event glue ----------------------------------------------

    #[test]
    fn an_opening_glue_pair_keeps_the_second_timestamp() {
        assert_eq!(
            glue_pairwise(&[(0, Open), (10 * S, Open)], 60 * S),
            vec![(10 * S, Open)]
        );
    }

    #[test]
    fn a_closing_glue_pair_keeps_the_first_timestamp() {
        assert_eq!(
            glue_pairwise(&[(0, Close), (10 * S, Close)], 60 * S),
            vec![(0, Close)]
        );
    }

    #[test]
    fn glue_is_strictly_pairwise_and_does_not_chain() {
        // The cursor jumps by two after a glue, so the third event stands alone
        // even though it is within the window of the second.
        assert_eq!(
            glue_pairwise(&[(0, Open), (10 * S, Open), (20 * S, Open)], 60 * S),
            vec![(10 * S, Open), (20 * S, Open)]
        );
    }

    #[test]
    fn the_glue_bound_is_inclusive() {
        assert_eq!(
            glue_pairwise(&[(0, Open), (60 * S, Open)], 60 * S),
            vec![(60 * S, Open)]
        );
        assert_eq!(
            glue_pairwise(&[(0, Open), (60 * S + 1, Open)], 60 * S),
            vec![(0, Open), (60 * S + 1, Open)]
        );
    }

    #[test]
    fn glue_never_joins_an_open_to_a_close() {
        let stream = [(0, Open), (S, Close)];
        assert_eq!(glue_pairwise(&stream, 60 * S), stream.to_vec());
    }

    // -- bracket pairing ---------------------------------------------------

    #[test]
    fn shutdown_pairs_at_equal_timestamps_but_idle_does_not() {
        // build_shutdown_blocks.py:120 uses `>=`; build_idle_blocks.py:103
        // uses `>`. A zero-length shutdown exists; a zero-length idle does not.
        let stream = [(0, Open), (0, Close)];
        assert_eq!(
            build_bracket_blocks(&stream, Shutdown, false),
            vec![paired(Shutdown, 0, 0)]
        );
        assert_eq!(
            build_bracket_blocks(&stream, Idle, true),
            vec![block(Idle, None, Some(0)), block(Idle, Some(0), None)]
        );
    }

    #[test]
    fn an_unpairable_close_leaves_the_pending_open_for_a_later_close() {
        let stream = [(10 * S, Open), (5 * S, Close), (20 * S, Close)];
        assert_eq!(
            build_bracket_blocks(&stream, Shutdown, false),
            vec![
                block(Shutdown, None, Some(5 * S)),
                paired(Shutdown, 10 * S, 20 * S),
            ]
        );
    }

    #[test]
    fn a_second_open_flushes_the_first_as_a_start_only_block() {
        assert_eq!(
            build_bracket_blocks(
                &[(0, Open), (10 * S, Open), (20 * S, Close)],
                Shutdown,
                false
            ),
            vec![
                block(Shutdown, Some(0), None),
                paired(Shutdown, 10 * S, 20 * S),
            ]
        );
    }

    #[test]
    fn a_trailing_open_survives_as_a_start_only_shutdown_block() {
        assert_eq!(
            build_bracket_blocks(&[(0, Open)], Shutdown, false),
            vec![block(Shutdown, Some(0), None)]
        );
    }

    // -- gap detection -----------------------------------------------------

    #[test]
    fn a_long_silence_is_a_gap() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(4 * HOUR, "Screen Interactive", ""),
        ];
        assert_eq!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()),
            vec![(0, 4 * HOUR)]
        );
    }

    #[test]
    fn a_shutdown_class_reboot_gaps_forward_past_events_that_are_too_close() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Device Shutdown", ""),
            EyesEvent::new(S + S / 2, "Screen Non-Interactive", ""),
            EyesEvent::new(60 * S, "Screen Interactive", ""),
        ];
        assert_eq!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()),
            vec![(S, 60 * S)]
        );
    }

    #[test]
    fn a_startup_class_reboot_gaps_backward_past_events_that_are_too_close() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(60 * S - S / 2, "Screen Non-Interactive", ""),
            EyesEvent::new(60 * S, "Device Startup", ""),
        ];
        assert_eq!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()),
            vec![(0, 60 * S)]
        );
    }

    #[test]
    fn a_long_silence_suppresses_the_reboot_rule_for_the_same_event() {
        // The reference's rules are an `elif` chain, so at most one fires.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(4 * HOUR, "Device Shutdown", ""),
            EyesEvent::new(4 * HOUR + 60 * S, "Screen Interactive", ""),
        ];
        assert_eq!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()),
            vec![(0, 4 * HOUR)]
        );
    }

    #[test]
    fn the_first_event_can_never_open_a_gap() {
        let events = [
            EyesEvent::new(0, "Device Shutdown", ""),
            EyesEvent::new(60 * S, "Screen Interactive", ""),
        ];
        assert!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()).is_empty()
        );
    }

    #[test]
    fn the_predecessor_advances_with_the_cursor_after_a_forward_reboot_gap() {
        // Divergence 1. The reference's `i = j; continue`
        // (identify_gap_segments.py:192-193) skips `prev_record = record`, so
        // the event after the jump would measure silence from t=0, cross the
        // 3 h threshold, and emit a second overlapping gap.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(2 * HOUR, "Device Shutdown", ""),
            EyesEvent::new(7 * HOUR / 2, "Screen Interactive", ""),
        ];
        assert_eq!(
            detect_gap_segments(&events, &signals_of(&events), &EyesOptions::default()),
            vec![(2 * HOUR, 7 * HOUR / 2)]
        );
    }

    // -- glance ------------------------------------------------------------

    #[test]
    fn a_wake_then_sleep_with_no_unlock_is_a_glance() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(10 * S, "Screen Non-Interactive", ""),
        ];
        assert_eq!(
            build_glance_blocks(&events, &signals_of(&events), &[]),
            vec![paired(Glance, 0, 10 * S)]
        );
    }

    #[test]
    fn keyguard_hidden_revokes_a_glance_candidate() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(10 * S, "Screen Non-Interactive", ""),
        ];
        assert!(build_glance_blocks(&events, &signals_of(&events), &[]).is_empty());
    }

    #[test]
    fn user_unlocked_does_not_revoke_a_glance_candidate() {
        // build_glance_blocks filters to `relevant_events`, and User Unlocked
        // is not among them. Only Keyguard Hidden revokes.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "User Unlocked", ""),
            EyesEvent::new(10 * S, "Screen Non-Interactive", ""),
        ];
        assert_eq!(
            build_glance_blocks(&events, &signals_of(&events), &[]),
            vec![paired(Glance, 0, 10 * S)]
        );
    }

    #[test]
    fn a_revoked_candidate_does_not_block_a_later_glance() {
        // The "no intervening unlock" rule is relative to the LATEST wake only.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(10 * S, "Screen Interactive", ""),
            EyesEvent::new(20 * S, "Screen Non-Interactive", ""),
        ];
        assert_eq!(
            build_glance_blocks(&events, &signals_of(&events), &[]),
            vec![paired(Glance, 10 * S, 20 * S)]
        );
    }

    #[test]
    fn repeated_wakes_overwrite_the_candidate_with_the_latest() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(5 * S, "Screen Interactive", ""),
            EyesEvent::new(20 * S, "Screen Non-Interactive", ""),
        ];
        assert_eq!(
            build_glance_blocks(&events, &signals_of(&events), &[]),
            vec![paired(Glance, 5 * S, 20 * S)]
        );
    }

    #[test]
    fn a_gap_start_cancels_a_glance_candidate() {
        // `Gap Start` is in build_glance_blocks.CANCEL_EVENTS.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(20 * S, "Screen Non-Interactive", ""),
        ];
        assert!(build_glance_blocks(&events, &signals_of(&events), &[(10 * S, 15 * S)]).is_empty());
    }

    #[test]
    fn device_shutdown_and_user_stopped_cancel_a_glance_candidate() {
        for cancel in ["Device Shutdown", "User Stopped"] {
            let events = [
                EyesEvent::new(0, "Screen Interactive", ""),
                EyesEvent::new(5 * S, cancel, ""),
                EyesEvent::new(20 * S, "Screen Non-Interactive", ""),
            ];
            assert!(
                build_glance_blocks(&events, &signals_of(&events), &[]).is_empty(),
                "{cancel} should cancel the candidate"
            );
        }
    }

    /// The reference reads the idle file before the shutdown file and sorts
    /// stably, so at an identical timestamp the wake is processed first and the
    /// shutdown then cancels the candidate it just armed — no glance. Ordering
    /// by raw log position instead would process the shutdown first (cancelling
    /// nothing) and let the wake survive to be closed by the screen-off.
    #[test]
    fn a_shutdown_sharing_a_timestamp_with_a_wake_still_cancels_it() {
        let events = [
            EyesEvent::new(0, "Device Shutdown", ""),
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(20 * S, "Screen Non-Interactive", ""),
        ];
        assert!(
            build_glance_blocks(&events, &signals_of(&events), &[]).is_empty(),
            "the idle stream sorts before the shutdown stream at an equal timestamp"
        );
    }

    #[test]
    fn a_never_closed_glance_candidate_is_dropped() {
        let events = [EyesEvent::new(0, "Screen Interactive", "")];
        assert!(build_glance_blocks(&events, &signals_of(&events), &[]).is_empty());
    }

    // -- reconciliation ----------------------------------------------------

    #[test]
    fn a_gap_contained_in_a_shutdown_bracket_is_relabelled_shutdown() {
        let mut brackets = [paired(Shutdown, 0, 100 * S)];
        let mut gaps = [paired(Gap, 20 * S, 80 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(gaps[0].block_type, Shutdown);
    }

    #[test]
    fn a_gap_outside_the_bracket_is_left_alone() {
        let mut brackets = [paired(Shutdown, 0, 100 * S)];
        let mut gaps = [paired(Gap, 200 * S, 300 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(gaps[0].block_type, Gap);
    }

    #[test]
    fn an_end_only_shutdown_bracket_backfills_its_start_from_the_gap() {
        // A boot with no witnessed shutdown acquires a start from the gap that
        // an independent detector found in the same place.
        let mut brackets = [block(Shutdown, None, Some(100 * S))];
        let mut gaps = [paired(Gap, 20 * S, 100 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(brackets[0].start_ns, Some(20 * S));
        assert_eq!(gaps[0].block_type, Shutdown);
    }

    #[test]
    fn a_start_only_shutdown_bracket_backfills_its_end_from_the_gap() {
        let mut brackets = [block(Shutdown, Some(20 * S), None)];
        let mut gaps = [paired(Gap, 20 * S, 100 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(brackets[0].end_ns, Some(100 * S));
        assert_eq!(gaps[0].block_type, Shutdown);
    }

    #[test]
    fn the_idle_pass_cannot_reclaim_a_gap_that_shutdown_already_took() {
        // SHUTDOWN > IDLE > GAP precedence, realized by pass ordering.
        let mut brackets = [paired(Idle, 0, 100 * S)];
        let mut gaps = [paired(Shutdown, 20 * S, 80 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Idle, true);
        assert_eq!(gaps[0].block_type, Shutdown);
    }

    #[test]
    fn one_bracket_can_absorb_several_contained_gaps() {
        // Only the gap cursor advances on a containment match
        // (build_all_blocks.py:127-129), so one bracket claims every gap inside
        // it.
        let mut brackets = [paired(Shutdown, 0, 200 * S)];
        let mut gaps = [paired(Gap, 10 * S, 40 * S), paired(Gap, 60 * S, 120 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert!(gaps.iter().all(|gap| gap.block_type == Shutdown));
    }

    #[test]
    fn a_block_at_or_below_the_tolerance_is_skipped_by_reconciliation() {
        // `if block.duration_seconds and block.duration_seconds <= tol:
        // continue` (build_all_blocks.py:96-103). Both cursors have their own
        // skip, and `duration_seconds` is integer-truncated.
        let mut brackets = [paired(Shutdown, 0, 200 * S)];
        let mut gaps = [paired(Gap, 10 * S, 20 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(
            gaps[0].block_type, Gap,
            "a 10 s gap is exactly at the tolerance"
        );

        let mut gaps = [paired(Gap, 10 * S, 20 * S + 1)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(
            gaps[0].block_type, Gap,
            "truncation keeps a 10.000000001 s gap at 10 s"
        );

        let mut gaps = [paired(Gap, 10 * S, 21 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(gaps[0].block_type, Shutdown);
    }

    #[test]
    fn a_zero_length_block_is_not_skipped_by_reconciliation() {
        // Python's `and` short-circuits on a falsy 0, so a zero-length shutdown
        // bracket falls through into the matching logic rather than being
        // skipped.
        let mut brackets = [paired(Shutdown, 50 * S, 50 * S)];
        let mut gaps = [paired(Gap, 50 * S, 200 * S)];
        reconcile_with_gaps(&mut brackets, &mut gaps, 10 * S, Shutdown, false);
        assert_eq!(
            gaps[0].block_type, Gap,
            "containment fails, but it was tried"
        );
        assert_eq!(
            brackets[0].end_ns,
            Some(50 * S),
            "a paired bracket is never backfilled"
        );
    }

    // -- exclusion ---------------------------------------------------------

    #[test]
    fn a_shutdown_inside_an_idle_block_splits_it() {
        let carved = exclude_shutdown_from_idle(
            &[paired(Idle, 0, 100 * S)],
            &[paired(Shutdown, 40 * S, 60 * S)],
        );
        assert_eq!(
            carved,
            vec![paired(Idle, 0, 40 * S), paired(Idle, 60 * S, 100 * S)]
        );
    }

    #[test]
    fn a_shutdown_covering_an_idle_block_removes_it_entirely() {
        let carved = exclude_shutdown_from_idle(
            &[paired(Idle, 10 * S, 20 * S)],
            &[paired(Shutdown, 0, 100 * S)],
        );
        assert!(carved.is_empty());
    }

    #[test]
    fn an_idle_partial_does_not_survive_the_shutdown_subtraction() {
        // This is why SHUTDOWN partials reach the block file and IDLE partials
        // never do.
        assert!(exclude_shutdown_from_idle(&[block(Idle, None, Some(100 * S))], &[]).is_empty());
        assert!(exclude_shutdown_from_idle(&[block(Idle, Some(0), None)], &[]).is_empty());
    }

    #[test]
    fn an_overlapping_glance_is_dropped_whole_rather_than_trimmed() {
        let survivors = exclude_overlapping_blocks(
            &[paired(Glance, 0, 100 * S)],
            &[paired(Shutdown, 90 * S, 95 * S)],
        );
        assert!(survivors.is_empty());
    }

    #[test]
    fn a_glance_that_only_abuts_a_mask_survives() {
        let survivors = exclude_overlapping_blocks(
            &[paired(Glance, 0, 100 * S)],
            &[paired(Shutdown, 100 * S, 200 * S)],
        );
        assert_eq!(survivors, vec![paired(Glance, 0, 100 * S)]);
    }

    // -- pickups -----------------------------------------------------------

    #[test]
    fn only_holes_at_or_above_the_floor_become_active_rows() {
        // The "fill" is a floor, not a tolerance: the 2 s hole is left
        // uncovered by any row at all.
        let rows = build_pickup_export(
            &[
                paired(Idle, 0, 10 * S),
                paired(Idle, 12 * S, 30 * S),
                paired(Idle, 40 * S, 60 * S),
            ],
            &EyesOptions::default(),
        );
        let active: Vec<(i64, i64)> = rows
            .iter()
            .filter(|row| row.block_type == Active)
            .map(|row| (row.start_ns, row.end_ns))
            .collect();
        assert_eq!(active, vec![(30 * S, 40 * S)]);
        assert_eq!(rows.len(), 4);
    }

    #[test]
    fn the_pickup_duration_floor_applies_to_every_block_type() {
        let rows = build_pickup_export(
            &[paired(Idle, 0, 3 * S), paired(Glance, 20 * S, 30 * S)],
            &EyesOptions::default(),
        );
        assert_eq!(
            rows,
            vec![
                EyesPickupRow {
                    block_type: Active,
                    start_ns: 3 * S,
                    end_ns: 20 * S
                },
                EyesPickupRow {
                    block_type: Glance,
                    start_ns: 20 * S,
                    end_ns: 30 * S
                },
            ]
        );
        assert_eq!(rows[0].duration_ns(), 17 * S);
    }

    #[test]
    fn a_nested_block_does_not_rewind_the_active_cursor() {
        // Divergence 3. gen_pickups.py:70 assigns `curr = b` without taking the
        // running maximum, so the nested glance would rewind the end to 20 s and
        // emit an ACTIVE row overlapping the idle block it sits inside.
        let rows = build_pickup_export(
            &[
                paired(Idle, 0, 100 * S),
                paired(Glance, 10 * S, 20 * S),
                paired(Idle, 200 * S, 300 * S),
            ],
            &EyesOptions::default(),
        );
        let active: Vec<(i64, i64)> = rows
            .iter()
            .filter(|row| row.block_type == Active)
            .map(|row| (row.start_ns, row.end_ns))
            .collect();
        assert_eq!(active, vec![(100 * S, 200 * S)]);
    }

    #[test]
    fn partial_blocks_never_reach_the_pickups_export() {
        let rows = build_pickup_export(
            &[block(Shutdown, Some(0), None), paired(Idle, 10 * S, 60 * S)],
            &EyesOptions::default(),
        );
        assert_eq!(
            rows,
            vec![EyesPickupRow {
                block_type: Idle,
                start_ns: 10 * S,
                end_ns: 60 * S
            }]
        );
    }

    // -- triplet reconstruction --------------------------------------------

    #[test]
    fn a_clean_resume_pause_stop_triplet_measures_to_the_stop() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Activity Paused", "com.a"),
            EyesEvent::new(101 * S, "Activity Stopped", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(episodes.len(), 1);
        let episode = &episodes[0];
        assert_eq!(episode.time_stop_ns, Some(101 * S));
        assert_eq!(episode.end_inference, EyesEpisodeEndInference::ObservedStop);
        assert_eq!(episode.duration_seconds, 101.0);
    }

    #[test]
    fn a_resume_inside_the_proximity_interval_binds_the_pause_to_the_previous_block() {
        // MPB: chronicle_app_log_parser4.py:296-332.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(S, "Activity Resumed", "com.a"),
            EyesEvent::new(2 * S, "Activity Paused", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(
            find_episode(&episodes, "com.a", 0).pause_inference,
            EyesPauseInference::MatchingPreviousBlock
        );
        assert_eq!(
            find_episode(&episodes, "com.a", 0).time_pause_ns,
            Some(2 * S)
        );
        assert_eq!(find_episode(&episodes, "com.a", S).time_pause_ns, None);
    }

    #[test]
    fn a_distant_resume_binds_the_pause_to_itself_and_marks_its_predecessor_npi() {
        // MCB + NPI.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(20 * S, "Activity Paused", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(
            find_episode(&episodes, "com.a", 10 * S).pause_inference,
            EyesPauseInference::MatchingCurrentBlock
        );
        assert_eq!(
            find_episode(&episodes, "com.a", 0).pause_inference,
            EyesPauseInference::NextBlockPausedInference
        );
    }

    #[test]
    fn a_pause_with_no_preceding_resume_creates_a_mar_block() {
        let events = [EyesEvent::new(10 * S, "Activity Paused", "com.a")];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(episodes.len(), 1);
        assert_eq!(
            episodes[0].resume_inference,
            EyesResumeInference::MissingActivityResumed
        );
        assert_eq!(episodes[0].time_resume_ns, None);
        assert_eq!(episodes[0].duration_seconds, 0.0);
    }

    #[test]
    fn a_stop_far_from_the_newest_resume_kills_the_package() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Activity Stopped", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(
            episodes[0].end_inference,
            EyesEpisodeEndInference::AppKilled
        );
        assert_eq!(episodes[0].duration_seconds, 100.0);
    }

    #[test]
    fn the_proximity_interval_is_a_strict_bound_and_is_configurable() {
        // `in_proximity` is `abs(seconds) < proximity_interval`. At exactly the
        // interval the stop is NOT in proximity, so the package reads as killed.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(2 * S, "Activity Stopped", "com.a"),
        ];
        let at_default = triplets(&events, &EyesOptions::default());
        assert_eq!(
            at_default[0].end_inference,
            EyesEpisodeEndInference::AppKilled
        );

        let widened = EyesOptions {
            proximity_interval_seconds: 3.0,
            ..EyesOptions::default()
        };
        let at_three = triplets(&events, &widened);
        assert_eq!(
            at_three[0].end_inference,
            EyesEpisodeEndInference::ObservedStop
        );
        assert_eq!(at_three[0].duration_seconds, 2.0);
    }

    #[test]
    fn a_reboot_closes_every_open_episode_across_every_package() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(S, "Activity Resumed", "com.b"),
            EyesEvent::new(100 * S, "Device Shutdown", ""),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(episodes.len(), 2);
        // com.b has nothing after it, so its SSD tag survives the repair walk.
        assert_eq!(
            find_episode(&episodes, "com.b", S).end_inference,
            EyesEpisodeEndInference::SystemShutDown
        );
    }

    #[test]
    fn a_reboot_with_nothing_after_it_leaves_the_episode_undated_and_zero() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Device Shutdown", ""),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(
            episodes[0].end_inference,
            EyesEpisodeEndInference::SystemShutDown
        );
        assert_eq!(episodes[0].time_stop_ns, None);
        assert_eq!(episodes[0].duration_seconds, 0.0);
    }

    #[test]
    fn activity_destroyed_does_not_close_an_episode_but_activity_stopped_does() {
        let destroyed = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(50 * S, "Activity Paused", "com.a"),
            EyesEvent::new(51 * S, "Activity Destroyed", "com.a"),
        ];
        let episodes = triplets(&destroyed, &EyesOptions::default());
        assert_eq!(episodes[0].time_stop_ns, None);
        assert_eq!(
            episodes[0].end_inference,
            EyesEpisodeEndInference::PauseFallback
        );
        assert_eq!(episodes[0].duration_seconds, 50.0);

        let stopped = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(50 * S, "Activity Paused", "com.a"),
            EyesEvent::new(51 * S, "Unknown importance: 23", "com.a"),
        ];
        let episodes = triplets(&stopped, &EyesOptions::default());
        assert_eq!(episodes[0].time_stop_ns, Some(51 * S));
        assert_eq!(
            episodes[0].end_inference,
            EyesEpisodeEndInference::ObservedStop
        );
        assert_eq!(episodes[0].duration_seconds, 51.0);
    }

    // -- the repair walk (NSI / MST) ---------------------------------------

    #[test]
    fn the_repair_walk_adopts_a_later_same_package_stop_as_nsi() {
        // `ActivityBlock.duration` :151-180, the `next_block.app_name ==
        // self.app_name` branch. The first block's chain crosses one undated
        // same-package block before reaching the one that carries a stop.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(20 * S, "Activity Paused", "com.a"),
            EyesEvent::new(30 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(40 * S, "Activity Paused", "com.a"),
            EyesEvent::new(41 * S, "Activity Stopped", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        let first = find_episode(&episodes, "com.a", 0);
        assert_eq!(
            first.end_inference,
            EyesEpisodeEndInference::NextBlockStoppedInference
        );
        assert_eq!(first.time_stop_ns, Some(41 * S));
        assert_eq!(first.duration_seconds, 41.0);
    }

    #[test]
    fn the_repair_walk_adopts_a_foreign_blocks_resume_as_mst() {
        // `ActivityBlock.duration` :172-175, the `else` branch. This is Parry &
        // Toth forward pairing used as EYES's fallback repair: the next app's
        // RESUME, not its stop, bounds the orphaned episode.
        //
        // The block has to be anomalous by the reference's own test —
        // `stop_event ∈ {NSI, AKD, SSD}` — before the walk runs at all. Here
        // the far stop of com.a kills the package, which tags the superseded
        // com.a block `AKD` with no stop of its own; the next block in the
        // global chain belongs to com.b, so the walk adopts com.b's resume.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.b"),
            EyesEvent::new(20 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Activity Stopped", "com.a"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        let first = find_episode(&episodes, "com.a", 0);
        assert_eq!(first.end_inference, EyesEpisodeEndInference::MissingStop);
        assert_eq!(first.time_stop_ns, Some(10 * S));
        assert_eq!(first.duration_seconds, 10.0);
    }

    /// The reference tests only `stop_event` against `anomaly_states`, and `NPI`
    /// is only ever written to `pause_event`. A block superseded by a newer
    /// resume of the same package therefore stays at zero — it is not credited
    /// forward to the next app's resume, which would double-count it against
    /// the newer block.
    #[test]
    fn a_block_superseded_by_a_newer_resume_is_not_repaired_forward() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(20 * S, "Activity Paused", "com.a"),
            EyesEvent::new(30 * S, "Activity Resumed", "com.b"),
            EyesEvent::new(40 * S, "Activity Paused", "com.b"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        let first = find_episode(&episodes, "com.a", 0);
        assert_eq!(first.duration_seconds, 0.0);
        assert_eq!(first.time_stop_ns, None);
        assert_ne!(first.end_inference, EyesEpisodeEndInference::MissingStop);
    }

    #[test]
    fn an_existing_stop_wins_over_the_repair_walk() {
        // Precedence step 1. Without it the walk would reach com.b's resume at
        // 200 s and report 200, not the 100 s the kill actually witnessed.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Activity Stopped", "com.a"),
            EyesEvent::new(200 * S, "Activity Resumed", "com.b"),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        let first = find_episode(&episodes, "com.a", 0);
        assert_eq!(first.end_inference, EyesEpisodeEndInference::AppKilled);
        assert_eq!(first.time_stop_ns, Some(100 * S));
        assert_eq!(first.duration_seconds, 100.0);
    }

    #[test]
    fn a_walk_that_runs_off_the_end_falls_back_to_the_pause() {
        // Precedence step 5: `if not next_block: ... return diff(resume, pause)`.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(50 * S, "Activity Paused", "com.a"),
            EyesEvent::new(100 * S, "Device Shutdown", ""),
        ];
        let episodes = triplets(&events, &EyesOptions::default());
        assert_eq!(
            episodes[0].end_inference,
            EyesEpisodeEndInference::PauseFallback
        );
        assert_eq!(episodes[0].duration_seconds, 50.0);
    }

    // -- duration_mode -----------------------------------------------------

    #[test]
    fn pause_bound_duration_ignores_the_stop_entirely() {
        // `struct_logic=N` (chronicle_app_log_parser4.py:115-129).
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(50 * S, "Activity Paused", "com.a"),
            EyesEvent::new(51 * S, "Activity Stopped", "com.a"),
        ];
        let structured = triplets(&events, &EyesOptions::default());
        assert_eq!(structured[0].duration_seconds, 51.0);

        let pause_bound = EyesOptions {
            duration_mode: EyesDurationMode::PauseBound,
            ..EyesOptions::default()
        };
        let bounded = triplets(&events, &pause_bound);
        assert_eq!(bounded[0].duration_seconds, 50.0);
        // The endpoint is still recorded; only the measurement changes.
        assert_eq!(bounded[0].time_stop_ns, Some(51 * S));
    }

    #[test]
    fn pause_bound_duration_is_zero_without_a_pause() {
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(S, "Activity Stopped", "com.a"),
        ];
        let structured = triplets(&events, &EyesOptions::default());
        assert_eq!(structured[0].duration_seconds, 1.0);

        let pause_bound = EyesOptions {
            duration_mode: EyesDurationMode::PauseBound,
            ..EyesOptions::default()
        };
        assert_eq!(triplets(&events, &pause_bound)[0].duration_seconds, 0.0);
    }

    #[test]
    fn pause_bound_duration_never_runs_the_repair_walk() {
        // The MST fixture, measured the other way: com.a's first block has no
        // pause, so it reads zero instead of adopting com.b's resume.
        let events = [
            EyesEvent::new(0, "Activity Resumed", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(20 * S, "Activity Paused", "com.a"),
            EyesEvent::new(30 * S, "Activity Resumed", "com.b"),
            EyesEvent::new(40 * S, "Activity Paused", "com.b"),
        ];
        let pause_bound = EyesOptions {
            duration_mode: EyesDurationMode::PauseBound,
            ..EyesOptions::default()
        };
        let episodes = triplets(&events, &pause_bound);
        let first = find_episode(&episodes, "com.a", 0);
        assert_eq!(first.duration_seconds, 0.0);
        assert_eq!(first.time_stop_ns, None);
        assert_eq!(first.end_inference, EyesEpisodeEndInference::Unobserved);
    }

    // -- app chunks --------------------------------------------------------

    #[test]
    fn overlapping_episodes_of_one_app_merge_into_a_single_chunk() {
        let episodes = [
            synthetic_episode("com.a", Some(0), None, Some(100 * S)),
            synthetic_episode("com.a", Some(50 * S), None, Some(200 * S)),
        ];
        let chunks = merge_app_chunks(&episodes);
        assert_eq!(chunks.len(), 1);
        assert_eq!((chunks[0].start_ns, chunks[0].end_ns), (0, 200 * S));
        assert_eq!(chunks[0].episode_indices, vec![0, 1]);
    }

    #[test]
    fn disjoint_episodes_of_one_app_stay_separate_chunks() {
        let episodes = [
            synthetic_episode("com.a", Some(0), None, Some(100 * S)),
            synthetic_episode("com.a", Some(200 * S), None, Some(300 * S)),
        ];
        assert_eq!(merge_app_chunks(&episodes).len(), 2);
    }

    #[test]
    fn episodes_of_different_apps_are_never_merged() {
        let episodes = [
            synthetic_episode("com.a", Some(0), None, Some(100 * S)),
            synthetic_episode("com.b", Some(50 * S), None, Some(200 * S)),
        ];
        assert_eq!(merge_app_chunks(&episodes).len(), 2);
    }

    #[test]
    fn a_chunk_ends_at_the_stop_or_the_pause_and_is_skipped_without_either() {
        let episodes = [
            synthetic_episode("com.a", Some(0), Some(50 * S), Some(100 * S)),
            synthetic_episode("com.b", Some(0), Some(50 * S), None),
            synthetic_episode("com.c", Some(0), None, None),
            synthetic_episode("com.d", None, Some(50 * S), Some(100 * S)),
        ];
        let chunks = merge_app_chunks(&episodes);
        let spans: Vec<(&str, i64, i64)> = chunks
            .iter()
            .map(|chunk| {
                (
                    chunk.app_package_name.as_str(),
                    chunk.start_ns,
                    chunk.end_ns,
                )
            })
            .collect();
        assert_eq!(spans, vec![("com.a", 0, 100 * S), ("com.b", 0, 50 * S)]);
    }

    #[test]
    fn merged_chunk_endpoint_selects_the_latest_resume_and_records_all_candidates() {
        let mut episodes = vec![
            synthetic_episode("com.a", Some(0), None, Some(100 * S)),
            synthetic_episode("com.a", Some(50 * S), Some(100 * S), None),
        ];
        episodes[0].end_inference = EyesEpisodeEndInference::ObservedStop;
        episodes[1].end_inference = EyesEpisodeEndInference::PauseFallback;
        let app_usage_chunks = merge_app_chunks(&episodes);
        let segmentation = EyesSegmentation {
            episodes,
            app_usage_chunks,
            ..EyesSegmentation::default()
        };

        assert_eq!(
            segmentation.chunk_endpoint_evidence(0),
            Some(EyesChunkEndpointEvidence {
                chunk_index: 0,
                endpoint_ns: 100 * S,
                candidate_episode_indices: vec![0, 1],
                selected_episode_index: 1,
                selected_end_inference: EyesEpisodeEndInference::PauseFallback,
            })
        );
    }

    #[test]
    fn merged_chunk_endpoint_ties_select_the_greatest_episode_index() {
        let mut episodes = vec![
            synthetic_episode("com.a", Some(50 * S), None, Some(100 * S)),
            synthetic_episode("com.a", Some(50 * S), None, Some(100 * S)),
        ];
        episodes[0].end_inference = EyesEpisodeEndInference::ObservedStop;
        episodes[1].end_inference = EyesEpisodeEndInference::AppKilled;
        let app_usage_chunks = merge_app_chunks(&episodes);
        let segmentation = EyesSegmentation {
            episodes,
            app_usage_chunks,
            ..EyesSegmentation::default()
        };

        let evidence = segmentation.chunk_endpoint_evidence(0).unwrap();
        assert_eq!(evidence.candidate_episode_indices, vec![0, 1]);
        assert_eq!(evidence.selected_episode_index, 1);
        assert_eq!(
            evidence.selected_end_inference,
            EyesEpisodeEndInference::AppKilled
        );
        assert_eq!(segmentation.chunk_endpoint_evidence(1), None);
    }

    // -- Final App Usage ---------------------------------------------------

    #[test]
    fn final_app_usage_splits_and_tags_rather_than_filtering() {
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 0, 100 * S)],
            &[paired(Idle, 40 * S, 60 * S)],
            &EyesOptions::default(),
        );
        let shape: Vec<(EyesBlockType, i64, i64)> = rows
            .iter()
            .map(|row| (row.device_status, row.start_ns, row.end_ns))
            .collect();
        assert_eq!(
            shape,
            vec![
                (Active, 0, 40 * S),
                (Idle, 40 * S, 60 * S),
                (Active, 60 * S, 100 * S),
            ]
        );
        // Nothing is discarded: the fragments tile the chunk exactly.
        assert_eq!(
            rows.iter().map(EyesFinalAppUsage::duration_ns).sum::<i64>(),
            100 * S
        );
    }

    #[test]
    fn a_sub_threshold_block_is_dropped_before_the_split_and_reads_active() {
        // merge_app_status.py:25-27 filters the block timeline first, which is
        // what lets a brief idle flicker read through as ACTIVE.
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 0, 100 * S)],
            &[paired(Idle, 40 * S, 42 * S)],
            &EyesOptions::default(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].device_status, Active);
        assert_eq!((rows[0].start_ns, rows[0].end_ns), (0, 100 * S));
    }

    #[test]
    fn a_chunk_wholly_inside_a_block_yields_one_tagged_fragment() {
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 50 * S, 60 * S)],
            &[paired(Idle, 0, 100 * S)],
            &EyesOptions::default(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].device_status, Idle);
        assert_eq!((rows[0].start_ns, rows[0].end_ns), (50 * S, 60 * S));
    }

    #[test]
    fn fau_fragments_partition_their_chunk_with_no_gap_or_overlap() {
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 0, 500 * S)],
            &[
                paired(Idle, 40 * S, 60 * S),
                paired(Shutdown, 100 * S, 200 * S),
                paired(Glance, 300 * S, 320 * S),
                paired(Gap, 480 * S, 600 * S),
            ],
            &EyesOptions::default(),
        );
        let mut cursor = 0;
        for row in &rows {
            assert_eq!(
                row.start_ns, cursor,
                "fragment must start where the last one ended"
            );
            assert!(row.end_ns > row.start_ns);
            cursor = row.end_ns;
        }
        assert_eq!(cursor, 500 * S);
        let statuses: Vec<EyesBlockType> = rows.iter().map(|row| row.device_status).collect();
        assert_eq!(
            statuses,
            vec![Active, Idle, Active, Shutdown, Active, Glance, Active, Gap]
        );
    }

    #[test]
    fn a_chunk_beyond_every_block_is_wholly_active() {
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 900 * S, 1000 * S)],
            &[paired(Idle, 0, 100 * S)],
            &EyesOptions::default(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].device_status, Active);
    }

    // -- entry point -------------------------------------------------------

    #[test]
    fn an_empty_stream_produces_an_empty_segmentation() {
        assert_eq!(
            segment_eyes_complement(&[], &EyesOptions::default()),
            EyesSegmentation::default()
        );
    }

    #[test]
    fn unsorted_input_is_ordered_before_segmentation() {
        let ordered = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(200 * S, "Screen Interactive", ""),
            EyesEvent::new(600 * S, "Activity Paused", "com.a"),
            EyesEvent::new(601 * S, "Activity Stopped", "com.a"),
        ];
        let mut shuffled = ordered;
        shuffled.reverse();
        assert_eq!(
            segment_eyes_complement(&ordered, &EyesOptions::default()),
            segment_eyes_complement(&shuffled, &EyesOptions::default())
        );
    }

    #[test]
    fn active_is_never_a_stored_block() {
        // ACTIVE is the complement, materialized only in the pickups export.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(100 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(200 * S, "Screen Interactive", ""),
            EyesEvent::new(201 * S, "Keyguard Hidden", ""),
            EyesEvent::new(300 * S, "Screen Non-Interactive", ""),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());
        assert!(!segmentation.blocks.is_empty());
        assert!(segmentation
            .blocks
            .iter()
            .all(|block| block.block_type != Active));
    }

    #[test]
    fn an_idle_span_is_subtracted_from_credited_app_usage() {
        // End to end: one app session spanning one screen-off, credited by the
        // complement rather than by a screen-on witness.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(200 * S, "Screen Interactive", ""),
            EyesEvent::new(201 * S, "Keyguard Hidden", ""),
            EyesEvent::new(600 * S, "Activity Paused", "com.a"),
            EyesEvent::new(601 * S, "Activity Stopped", "com.a"),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());

        assert_eq!(segmentation.blocks, vec![paired(Idle, 100 * S, 200 * S)]);
        assert_eq!(segmentation.observation_start_ns, 0);
        assert_eq!(segmentation.observation_end_ns, 601 * S);

        assert_eq!(segmentation.app_usage_chunks.len(), 1);
        assert_eq!(
            (
                segmentation.app_usage_chunks[0].start_ns,
                segmentation.app_usage_chunks[0].end_ns
            ),
            (2 * S, 601 * S)
        );

        let statuses: Vec<EyesBlockType> = segmentation
            .final_app_usage
            .iter()
            .map(|row| row.device_status)
            .collect();
        assert_eq!(statuses, vec![Active, Idle, Active]);

        // 599 s of raw session, less the 100 s screen-off.
        let credited = segmentation.credited_usage_by_package();
        assert_eq!(credited.get("com.a").copied(), Some(499 * S));
        assert_eq!(segmentation.credited_final_app_usage().count(), 2);
    }

    #[test]
    fn a_retained_zero_duration_episode_validates_as_a_zero_width_chunk() {
        // pict_12 regression (2026-08-13): with filter_zero_duration_sessions
        // off, a zero-duration episode survives reconstruction by design and
        // merge_app_chunks maps it to a start_ns == end_ns chunk. The
        // validator used to reject any chunk with duration <= 0, so the
        // covering-array campaign failed with
        // eyes_tagged_fau_validation_error:app_usage_chunks on evidence the
        // pipeline itself produced. Zero-width must validate; negative must
        // still be impossible.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(2 * S, "Activity Stopped", "com.a"),
            EyesEvent::new(10 * S, "Activity Resumed", "com.b"),
            EyesEvent::new(100 * S, "Activity Paused", "com.b"),
            EyesEvent::new(101 * S, "Activity Stopped", "com.b"),
        ];
        let options = EyesOptions::default();
        let segmentation = segment_eyes_complement(&events, &options);
        let evidence = segmentation.tagged_fau_evidence(options);
        let zero_width = evidence
            .app_usage_chunks
            .iter()
            .find(|chunk| chunk.app_package_name == "com.a")
            .expect("zero-duration episode must survive into chunking");
        assert_eq!(zero_width.start_ns, zero_width.end_ns);
        assert!(evidence
            .fragments
            .iter()
            .all(|fragment| fragment.app_package_name != "com.a"));
        let participants = vec![EyesParticipantTaggedFauEvidence {
            participant_id: "p1".into(),
            evidence,
        }];
        validate_eyes_tagged_fau_evidence(&participants, options)
            .expect("zero-width chunk from a retained zero-duration episode is valid evidence");
    }

    /// The producer pairs a shutdown with a boot at the same timestamp into a
    /// zero-length SHUTDOWN block; the validator has to accept what the
    /// producer makes.
    #[test]
    fn a_zero_length_shutdown_block_is_valid_evidence() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(50 * S, "Activity Paused", "com.a"),
            EyesEvent::new(200 * S, "Device Shutdown", ""),
            EyesEvent::new(200 * S, "Device Startup", ""),
        ];
        let options = EyesOptions::default();
        let evidence = segment_eyes_complement(&events, &options).tagged_fau_evidence(options);
        assert!(
            evidence.device_state_blocks.iter().any(|block| {
                block.block_type == EyesBlockType::Shutdown
                    && block.start_ns.is_some()
                    && block.start_ns == block.end_ns
            }),
            "the fixture must produce the zero-length shutdown: {:?}",
            evidence.device_state_blocks
        );
        validate_eyes_tagged_fau_evidence(
            &[EyesParticipantTaggedFauEvidence {
                participant_id: "p1".into(),
                evidence,
            }],
            options,
        )
        .expect("a zero-length shutdown block is valid evidence");
    }

    #[test]
    fn tagged_fau_evidence_is_complete_while_the_headline_stays_active_only() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(40 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(60 * S, "Screen Interactive", ""),
            EyesEvent::new(61 * S, "Keyguard Hidden", ""),
            EyesEvent::new(100 * S, "Activity Paused", "com.a"),
            EyesEvent::new(101 * S, "Activity Stopped", "com.a"),
        ];
        let options = EyesOptions::default();
        let segmentation = segment_eyes_complement(&events, &options);
        let evidence = segmentation.tagged_fau_evidence(options);

        assert_eq!(evidence.device_state_blocks, segmentation.blocks);
        assert_eq!(evidence.episodes, segmentation.episodes);
        assert_eq!(evidence.app_usage_chunks, segmentation.app_usage_chunks);
        assert_eq!(evidence.fragments, segmentation.final_app_usage);
        assert!(evidence
            .fragments
            .iter()
            .any(|fragment| fragment.device_status == Idle));
        assert_eq!(segmentation.credited_final_app_usage().count(), 2);
        assert_eq!(
            evidence.protocol_version,
            "chronicle-eyes-tagged-fau-evidence/v1"
        );
        assert_eq!(
            evidence.receipt.protocol_version,
            "chronicle-eyes-partial-replay-receipt/v1"
        );
        assert_eq!(evidence.receipt.status, EyesReplayStatus::PartialReplay);
        assert_eq!(
            evidence.receipt.source_commit,
            "89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108"
        );
        assert_eq!(evidence.receipt.effective_options, options);
        assert_eq!(
            evidence.receipt.headline_projection,
            EyesHeadlineProjection::ActiveOnly
        );
        assert!(evidence.receipt.full_tagged_fau_evidence_available);
        assert!(
            !evidence
                .receipt
                .reference_primary_secondary_concurrency_ported
        );
        assert!(!evidence.receipt.pickup_export_exposed);
        assert_eq!(evidence.chunk_endpoints.len(), 1);
    }

    #[test]
    fn the_committed_eyes_fixture_activates_observed_and_repaired_endpoint_evidence() {
        let observed_rows = committed_eyes_fixture_rows("P01");
        let observed_events: Vec<EyesEvent<'_>> = observed_rows
            .iter()
            .map(|(timestamp, interaction, package)| {
                EyesEvent::new(*timestamp, interaction, package)
            })
            .collect();
        let observed = segment_eyes_complement(&observed_events, &EyesOptions::default());
        assert_eq!(
            observed
                .final_app_usage
                .iter()
                .map(|fragment| fragment.device_status)
                .collect::<Vec<_>>(),
            vec![Active, Idle, Active]
        );
        assert_eq!(
            observed
                .chunk_endpoint_evidence(0)
                .unwrap()
                .selected_end_inference,
            EyesEpisodeEndInference::ObservedStop
        );

        let repaired_rows = committed_eyes_fixture_rows("P02");
        let repaired_events: Vec<EyesEvent<'_>> = repaired_rows
            .iter()
            .map(|(timestamp, interaction, package)| {
                EyesEvent::new(*timestamp, interaction, package)
            })
            .collect();
        let repaired = segment_eyes_complement(&repaired_events, &EyesOptions::default());
        let alpha_chunk = repaired
            .app_usage_chunks
            .iter()
            .position(|chunk| chunk.app_package_name == "com.example.alpha")
            .expect("repaired Alpha chunk");
        assert_eq!(
            repaired
                .chunk_endpoint_evidence(alpha_chunk)
                .unwrap()
                .selected_end_inference,
            EyesEpisodeEndInference::MissingStop
        );
    }

    #[test]
    fn an_isolated_glance_is_never_credited_as_app_usage() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            EyesEvent::new(100 * S, "Screen Non-Interactive", ""),
            // A wake with no unlock, then straight back to sleep: a glance.
            EyesEvent::new(200 * S, "Screen Interactive", ""),
            EyesEvent::new(210 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(300 * S, "Screen Interactive", ""),
            EyesEvent::new(301 * S, "Keyguard Hidden", ""),
            EyesEvent::new(400 * S, "Activity Paused", "com.a"),
            EyesEvent::new(401 * S, "Activity Stopped", "com.a"),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());
        assert!(
            segmentation
                .blocks
                .contains(&paired(Glance, 200 * S, 210 * S)),
            "expected a glance block, got {:?}",
            segmentation.blocks
        );

        let glance_credited: i64 = segmentation
            .final_app_usage
            .iter()
            .filter(|row| row.device_status == Glance)
            .map(EyesFinalAppUsage::duration_ns)
            .sum();
        assert_eq!(glance_credited, 10 * S);
        assert!(segmentation
            .credited_final_app_usage()
            .all(|row| row.start_ns >= 210 * S || row.end_ns <= 100 * S));
    }

    #[test]
    fn a_long_silence_is_credited_as_a_gap_not_as_use() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(2 * S, "Activity Resumed", "com.a"),
            // Nothing at all for four hours, then the session finally closes.
            EyesEvent::new(4 * HOUR, "Activity Paused", "com.a"),
            EyesEvent::new(4 * HOUR + S, "Activity Stopped", "com.a"),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());
        assert_eq!(segmentation.blocks, vec![paired(Gap, 2 * S, 4 * HOUR)]);

        // Only the second between the pause and the stop is left over.
        let credited = segmentation.credited_usage_by_package();
        assert_eq!(credited.get("com.a").copied(), Some(S));
    }

    #[test]
    fn the_pickups_export_carries_every_type_and_pickups_are_its_active_rows() {
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(S, "Keyguard Hidden", ""),
            EyesEvent::new(100 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(200 * S, "Screen Interactive", ""),
            EyesEvent::new(201 * S, "Keyguard Hidden", ""),
            EyesEvent::new(400 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(500 * S, "Screen Interactive", ""),
            EyesEvent::new(501 * S, "Keyguard Hidden", ""),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());
        assert_eq!(
            segmentation.blocks,
            vec![
                paired(Idle, 100 * S, 200 * S),
                paired(Idle, 400 * S, 500 * S)
            ]
        );
        let pickups: Vec<(i64, i64)> = segmentation
            .pickups()
            .map(|row| (row.start_ns, row.end_ns))
            .collect();
        assert_eq!(pickups, vec![(200 * S, 400 * S)]);
        assert_eq!(segmentation.pickup_export.len(), 3);
    }

    #[test]
    fn a_shutdown_claims_the_gap_it_explains_and_idle_does_not_reclaim_it() {
        // Device Shutdown then Device Startup four hours later: the silence is
        // detected as a GAP, and the shutdown bracket claims it, so the block
        // set reports SHUTDOWN rather than missing data.
        let events = [
            EyesEvent::new(0, "Screen Interactive", ""),
            EyesEvent::new(10 * S, "Screen Non-Interactive", ""),
            EyesEvent::new(11 * S, "Device Shutdown", ""),
            EyesEvent::new(4 * HOUR, "Device Startup", ""),
            EyesEvent::new(4 * HOUR + S, "Screen Interactive", ""),
        ];
        let segmentation = segment_eyes_complement(&events, &EyesOptions::default());
        assert!(
            segmentation
                .blocks
                .iter()
                .any(|block| block.block_type == Shutdown && block.paired().is_some()),
            "expected a paired shutdown block, got {:?}",
            segmentation.blocks
        );
        assert!(
            segmentation
                .blocks
                .iter()
                .all(|block| block.block_type != Gap),
            "the shutdown pass should have claimed the gap, got {:?}",
            segmentation.blocks
        );
    }

    #[test]
    fn thresholds_are_data_not_constants() {
        let tightened = EyesOptions {
            fau_block_minimum_seconds: 1.0,
            ..EyesOptions::default()
        };
        let rows = split_and_tag_app_usage(
            &[synthetic_chunk("com.a", 0, 100 * S)],
            &[paired(Idle, 40 * S, 42 * S)],
            &tightened,
        );
        // The same 2 s block that the default threshold discards is honoured.
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1].device_status, Idle);
    }
}
