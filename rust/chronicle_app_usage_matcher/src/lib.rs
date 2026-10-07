// The minicov profile runtime backs coverage-instrumented builds; the
// explicit extern keeps its C runtime in this cdylib's link.
#[cfg(feature = "coverage-runtime")]
extern crate minicov;

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;

#[cfg(feature = "python")]
use numpy::{IntoPyArray, PyArray1, PyReadonlyArray1};
#[cfg(feature = "python")]
use pyo3::exceptions::PyValueError;
#[cfg(feature = "python")]
use pyo3::prelude::*;
#[cfg(feature = "python")]
use pyo3::types::PyModule;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatcherError(String);

impl MatcherError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for MatcherError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for MatcherError {}

type MatcherResult<T> = Result<T, MatcherError>;

#[derive(Debug, Clone, Copy)]
pub struct MatchOptions {
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchOutput {
    pub start_ns: Vec<i64>,
    pub stop_ns: Vec<i64>,
    pub missing: Vec<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchUpdateIndices {
    pub start_indices: Vec<usize>,
    pub stop_start_indices: Vec<usize>,
    pub stop_event_indices: Vec<usize>,
    pub missing_indices: Vec<usize>,
    /// Why each closed episode ended. Parallel to `stop_start_indices`.
    pub stop_reasons: Vec<EpisodeCloseReason>,
    /// Why each unclosed episode has no end. Parallel to `missing_indices`.
    pub missing_reasons: Vec<EpisodeCloseReason>,
    /// Explicit end instants for rules whose close does not land on an event.
    /// Parallel to `stop_start_indices`; `None` means "use the timestamp of
    /// `stop_event_indices[i]`", which is what every row-anchored rule reports.
    ///
    /// GESIS is the reason this exists: its timeout close is `start + 600 s`, a
    /// synthetic instant no event carries. Snapping that to the nearest row
    /// would silently report an end the rule never chose.
    pub stop_timestamps_ns: Vec<Option<i64>>,
}

/// Why an app-usage episode ended.
///
/// Every reconstruction rule answers the same question — *what bounds an
/// episode?* — and each answers it with a different vocabulary. Rather than
/// flatten them into one lossy set, each rule's own answers are named here, so
/// a per-episode trace says what that rule actually did. Cross-rule comparison
/// groups them via [`EpisodeCloseReason::lineage_reason`].
///
/// The pipeline previously carried one bit of this information: an episode
/// either got a stop or became `End of Usage Missing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum EpisodeCloseReason {
    // ---- fused matcher (this repository's production rule) ----
    /// A stop event for the episode's own package.
    SameAppStop,
    /// A stop event belonging to a different package, under the
    /// non-concurrent-usage model where any foreground change ends the episode.
    ///
    /// There is deliberately no separate "any app" reason. The sparse matcher
    /// has an `AnyApp` *matching mode* that closes same- and other-package
    /// starts in one sweep, but that is how the stop was searched, not why a
    /// given episode ended; each episode it closes is still a same-app or an
    /// other-app close. The randomized legacy-oracle test pins this.
    OtherAppStop,
    /// `Activity Stopped` accepted as a stand-in because no ordinary stop
    /// arrived — `use_activity_stopped_as_fallback`.
    ActivityStoppedFallback,
    /// The event stream ended while the episode was still open, and the last
    /// observed event was accepted as its end.
    EndOfStream,
    /// No end could be observed at all. Becomes `End of Usage Missing`.
    Unobserved,

    // ---- Parry & Toth forward pairing ----
    /// The screen became non-interactive.
    ScreenNonInteractive,
    /// The episode's own package moved to the background.
    SamePackageBackgrounded,
    /// A different package took the foreground.
    ForegroundHandover,

    // ---- GESIS / Zerrer ----
    /// A real same-app Stop within the event-distance threshold.
    GesisOriginalStop,
    /// No usable Stop, so the next global event closed it.
    GesisNextGlobalEvent,
    /// Neither was available, so the maximum-duration timeout closed it.
    GesisTimeout,

    // ---- EYES complement ----
    /// The device-state timeline (SHUTDOWN / IDLE / GAP / GLANCE) bounded the
    /// fragment.
    EyesDeviceStateBoundary,
    /// The resume/pause/stop triplet supplied the end directly.
    EyesTripletClose,
    /// No end was in the triplet, so the start of the next activity block was
    /// taken as this episode's end. Kept separate from `EyesTripletClose`
    /// because that one is an observed stop and this one is not: collapsing
    /// them made the end-reason column report an inference as an observation,
    /// which is the single distinction the column exists to carry.
    EyesNextBlockAssumed,

    // ---- Draxler et al. (2021) ----
    /// Ten minutes passed with no event of any kind, so the episode was cut at
    /// its last observed activity. Distinct from `Unobserved` and from the
    /// GESIS timeout: this end is a declared inactivity rule, not a failure to
    /// find a stop and not a maximum-duration cap.
    DraxlerInactivityTimeout,

    // ---- Morrison et al. (2018) ----
    /// The screen went off and stayed off past the lock timeout, so the lock
    /// counted as ending the use. The end itself is the screen-off event, which
    /// was observed — the timeout only decides whether that event closed
    /// anything, so this reason is not an `assumed_` one. Kept apart from
    /// `ScreenNonInteractive` because that reason closes at the screen-off
    /// unconditionally and this one had to look past it first.
    ScreenLockedPastTimeout,
}

impl EpisodeCloseReason {
    /// The value this reason takes inside a `LineageSearchEvidence.reason`.
    ///
    /// Deliberately `kebab-case`, not the `snake_case` that
    /// `EpisodeReconstructionStrategy::canonical_id` and the other contract
    /// option values use. Three casings coexist in this pipeline, each owned by
    /// a layer: lineage/provenance strings are kebab (`selected-qualifying-stop`,
    /// `pipeline-event-order`), contract option values are snake
    /// (`parry_toth_forward_pairing`), and output CSV cell values are Title Case
    /// (`End of Usage Missing`). These reasons sit beside the first group, so
    /// they match it. The method is named `lineage_reason` rather than
    /// `canonical_id` precisely so it is not mistaken for the snake-case layer.
    pub const fn lineage_reason(self) -> &'static str {
        match self {
            Self::SameAppStop => "same-app-stop",
            Self::OtherAppStop => "other-app-stop",
            Self::ActivityStoppedFallback => "activity-stopped-fallback",
            Self::EndOfStream => "end-of-stream",
            Self::Unobserved => "unobserved",
            Self::ScreenNonInteractive => "screen-non-interactive",
            Self::SamePackageBackgrounded => "same-package-backgrounded",
            Self::ForegroundHandover => "foreground-handover",
            Self::GesisOriginalStop => "gesis-original",
            Self::GesisNextGlobalEvent => "gesis-activity-based",
            Self::GesisTimeout => "gesis-timeout",
            Self::EyesDeviceStateBoundary => "eyes-device-state-boundary",
            Self::EyesTripletClose => "eyes-triplet-close",
            Self::EyesNextBlockAssumed => "eyes-next-block-assumed",
            Self::DraxlerInactivityTimeout => "draxler-inactivity-timeout",
            Self::ScreenLockedPastTimeout => "screen-locked-past-timeout",
        }
    }

    /// The value written into an output CSV cell.
    ///
    /// snake_case, matching `screen_usage_end_reason` — this column's twin on
    /// the screen table, which already ships values like `lock_screen_only`.
    /// A researcher with both open should not meet two spellings of the same
    /// idea. This is deliberately NOT `lineage_reason()`: those are kebab-case
    /// provenance identifiers on their own protocol, and sharing one string
    /// would let a rename of either silently rewrite the other.
    ///
    /// Two rules that observed the same thing return the same value. A reader
    /// wants to know the app's own stop event closed the episode; which rule
    /// noticed it is already recorded once, as the selected option, so the map
    /// is deliberately not injective.
    ///
    /// `assumed_` prefixes every end the log did not contain. That prefix is
    /// the whole point of the column: a repaired end and a real one are
    /// indistinguishable in the duration column, and a reader should not need
    /// a legend to tell them apart.
    pub const fn output_label(self) -> &'static str {
        match self {
            Self::SameAppStop | Self::GesisOriginalStop | Self::EyesTripletClose => {
                "same_app_stop_event"
            }
            Self::OtherAppStop => "other_app_stop_event",
            Self::ActivityStoppedFallback => "activity_stopped_event",
            Self::ForegroundHandover => "another_app_opened",
            Self::SamePackageBackgrounded => "app_moved_to_background",
            // Both ends ARE the screen-off event; they differ only in what the
            // rule had to check before accepting it, and which rule ran is
            // already recorded once as the selected option.
            Self::ScreenNonInteractive | Self::ScreenLockedPastTimeout => "screen_turned_off",
            Self::EyesDeviceStateBoundary => "device_powered_off_or_idle",
            Self::GesisNextGlobalEvent => "assumed_end_at_next_event",
            Self::EyesNextBlockAssumed => "assumed_end_at_next_activity",
            Self::GesisTimeout => "assumed_end_at_timeout",
            // Deliberately shares no label with `GesisTimeout`: that one caps a
            // run-away episode at a maximum duration, this one ends an episode
            // because nothing happened for ten minutes.
            Self::DraxlerInactivityTimeout => "assumed_end_after_inactivity",
            Self::EndOfStream => "recording_ended_while_open",
            Self::Unobserved => "no_end_found",
        }
    }

    /// Every reason, so a round-trip test can cover the set exhaustively rather
    /// than a sample. Adding a variant without adding it here fails that test.
    pub const ALL: &'static [Self] = &[
        Self::SameAppStop,
        Self::OtherAppStop,
        Self::ActivityStoppedFallback,
        Self::EndOfStream,
        Self::Unobserved,
        Self::ScreenNonInteractive,
        Self::SamePackageBackgrounded,
        Self::ForegroundHandover,
        Self::GesisOriginalStop,
        Self::GesisNextGlobalEvent,
        Self::GesisTimeout,
        Self::EyesDeviceStateBoundary,
        Self::EyesTripletClose,
        Self::EyesNextBlockAssumed,
        Self::DraxlerInactivityTimeout,
        Self::ScreenLockedPastTimeout,
    ];

    /// Inverse of [`Self::lineage_reason`].
    ///
    /// Unlike `IntervalQualityPolicy::from_canonical_id` and
    /// `EpisodeReconstructionStrategy::from_canonical_id`, an unrecognised
    /// value is an error rather than a silent fallback. Those two decode a
    /// *user option*, where falling back to the production path is the safe
    /// answer. This decodes a *record of what happened*, where inventing
    /// `SameAppStop` for an unreadable value would fabricate provenance — the
    /// one thing a lineage trace must never do.
    pub fn from_lineage_reason(value: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|reason| reason.lineage_reason() == value)
    }

    /// True when the episode has no observed end and must be reported as
    /// `End of Usage Missing` rather than credited.
    pub const fn is_unobserved(self) -> bool {
        matches!(self, Self::Unobserved)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageLayer {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayeredSession {
    pub session_index: usize,
    pub start_ns: i64,
    pub stop_ns: i64,
    pub layer: UsageLayer,
}

/// Split possibly-overlapping app sessions into primary/secondary sub-interval
/// rows. `starts[i]`/`stops[i]` are the bounds of paired session `i`
/// (`stops[i] >= starts[i]`). In any sub-interval the open session with the
/// greatest `start_ns` is `primary` (tie broken by greatest input index);
/// every other open session is `secondary`. Adjacent same-session same-layer
/// sub-intervals are coalesced. Output is ordered by `session_index`, then by
/// `start_ns`.
pub fn split_overlapping_sessions(
    starts: &[i64],
    stops: &[i64],
) -> MatcherResult<Vec<LayeredSession>> {
    if starts.len() != stops.len() {
        return Err(MatcherError::new(
            "starts and stops must have the same length",
        ));
    }
    for i in 0..starts.len() {
        if stops[i] < starts[i] {
            return Err(MatcherError::new("stop must be >= start for every session"));
        }
    }

    // Sweep start/stop events while tracking only layer transitions. The old
    // implementation emitted one temporary row for every open session at
    // every boundary and then coalesced adjacent equal-layer rows. That made
    // a highly overlapping input consume O(open sessions x boundaries)
    // temporary memory even when the final answer contained only a few layer
    // changes per session.
    //
    // A session's layer can change only when it starts, stops, becomes the
    // newest open session, or stops being the newest open session. Recording
    // those transitions directly produces the same maximal intervals without
    // constructing the redundant per-boundary rows.
    let n = starts.len();
    let mut by_start: Vec<usize> = (0..n).collect();
    by_start.sort_unstable_by_key(|&i| (starts[i], i));
    let mut by_stop: Vec<usize> = (0..n).collect();
    by_stop.sort_unstable_by_key(|&i| (stops[i], i));

    let mut open: std::collections::BTreeSet<(i64, usize)> = std::collections::BTreeSet::new();
    let mut active_segments: Vec<Option<(i64, UsageLayer)>> = vec![None; n];
    let mut ps = 0usize;
    let mut pe = 0usize;
    let mut out: Vec<LayeredSession> = Vec::with_capacity(n.saturating_mul(2));
    let mut started_now = Vec::new();

    let transition = |session_index: usize,
                      next_layer: UsageLayer,
                      timestamp: i64,
                      active_segments: &mut [Option<(i64, UsageLayer)>],
                      out: &mut Vec<LayeredSession>| {
        let Some((segment_start, previous_layer)) = active_segments[session_index] else {
            return;
        };
        if previous_layer == next_layer {
            return;
        }
        if timestamp > segment_start {
            out.push(LayeredSession {
                session_index,
                start_ns: segment_start,
                stop_ns: timestamp,
                layer: previous_layer,
            });
        }
        active_segments[session_index] = Some((timestamp, next_layer));
    };

    while ps < n || pe < n {
        let next_start = (ps < n).then(|| starts[by_start[ps]]);
        let next_stop = (pe < n).then(|| stops[by_stop[pe]]);
        let timestamp = match (next_start, next_stop) {
            (Some(start), Some(stop)) => start.min(stop),
            (Some(start), None) => start,
            (None, Some(stop)) => stop,
            (None, None) => break,
        };
        let previous_primary = open.iter().next_back().map(|&(_, index)| index);

        // A stop at T is not open on [T, next boundary), so close/remove stops
        // before selecting the primary for the interval beginning at T.
        while pe < n && stops[by_stop[pe]] <= timestamp {
            let i = by_stop[pe];
            if let Some((segment_start, layer)) = active_segments[i].take() {
                if timestamp > segment_start {
                    out.push(LayeredSession {
                        session_index: i,
                        start_ns: segment_start,
                        stop_ns: timestamp,
                        layer,
                    });
                }
            }
            open.remove(&(starts[i], i));
            pe += 1;
        }

        started_now.clear();
        while ps < n && starts[by_start[ps]] <= timestamp {
            let i = by_start[ps];
            if stops[i] > timestamp {
                open.insert((starts[i], i));
                started_now.push(i);
            }
            ps += 1;
        }

        let current_primary = open.iter().next_back().map(|&(_, index)| index);
        if previous_primary != current_primary {
            if let Some(index) = previous_primary.filter(|index| active_segments[*index].is_some())
            {
                transition(
                    index,
                    UsageLayer::Secondary,
                    timestamp,
                    &mut active_segments,
                    &mut out,
                );
            }
            if let Some(index) = current_primary.filter(|index| active_segments[*index].is_some()) {
                transition(
                    index,
                    UsageLayer::Primary,
                    timestamp,
                    &mut active_segments,
                    &mut out,
                );
            }
        }
        for &index in &started_now {
            active_segments[index] = Some((
                timestamp,
                if Some(index) == current_primary {
                    UsageLayer::Primary
                } else {
                    UsageLayer::Secondary
                },
            ));
        }
    }

    // Zero-width sessions (start == stop) are covered by no positive sub-interval
    // window. Emit one primary row so the session remains observable.
    for i in 0..starts.len() {
        if starts[i] == stops[i] {
            out.push(LayeredSession {
                session_index: i,
                start_ns: starts[i],
                stop_ns: stops[i],
                layer: UsageLayer::Primary,
            });
        }
    }
    out.sort_by(|a, b| {
        a.session_index
            .cmp(&b.session_index)
            .then(a.start_ns.cmp(&b.start_ns))
    });

    Ok(out)
}

fn validate_lengths(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
) -> MatcherResult<usize> {
    let len = app_codes.len();
    if timestamp_ns.len() != len
        || resumed.len() != len
        || same_stop.len() != len
        || other_stop.len() != len
        || stopped.len() != len
        || background.len() != len
    {
        return Err(MatcherError::new(
            "all input arrays must have the same length",
        ));
    }
    Ok(len)
}

fn is_valid_duration(
    start_ns: i64,
    stop_ns: i64,
    enforce_threshold: bool,
    threshold_ns: i64,
) -> bool {
    let duration_ns = i128::from(stop_ns) - i128::from(start_ns);
    if duration_ns < 0 {
        return false;
    }
    !enforce_threshold || duration_ns <= i128::from(threshold_ns)
}

#[allow(clippy::too_many_arguments)]
fn is_compatible_open_start_for_stop(
    stop_index: usize,
    start_index: usize,
    app_codes: &[i32],
    timestamp_ns: &[i64],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
) -> bool {
    let current_app = app_codes[stop_index];
    let normal_stop = same_stop[stop_index] || other_stop[stop_index];
    let fallback_stop = stopped[stop_index] && options.use_activity_stopped_as_fallback;
    let start_app = app_codes[start_index];
    let same_app_compatible = same_stop[stop_index] && start_app == current_app;
    // A background app's session is never closed by another app foregrounding
    // (an `other_stop` event); it stays alive until its own stop. Callers handle
    // the background app's own `same_stop`/`stopped` via flag remapping.
    let other_app_compatible =
        other_stop[stop_index] && start_app != current_app && !background[start_index];
    let fallback_compatible = !normal_stop && fallback_stop && start_app == current_app;

    if !(same_app_compatible || other_app_compatible || fallback_compatible) {
        return false;
    }

    let enforce_threshold = !fallback_compatible || options.apply_threshold_to_fallback;
    is_valid_duration(
        timestamp_ns[start_index],
        timestamp_ns[stop_index],
        enforce_threshold,
        options.long_duration_threshold_ns,
    )
}

#[allow(clippy::too_many_arguments)]
fn nearest_compatible_open_start_for_stop(
    stop_index: usize,
    app_codes: &[i32],
    timestamp_ns: &[i64],
    open_start_indices: &[usize],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
) -> Option<usize> {
    for (position, &start_index) in open_start_indices.iter().enumerate().rev() {
        if is_compatible_open_start_for_stop(
            stop_index,
            start_index,
            app_codes,
            timestamp_ns,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
        ) {
            return Some(position);
        }
    }

    None
}

#[allow(clippy::too_many_arguments)]
fn close_reused_starts<F>(
    stop_index: usize,
    app_codes: &[i32],
    timestamp_ns: &[i64],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
    open_start_indices: &mut Vec<usize>,
    mut close_start: F,
) where
    F: FnMut(usize),
{
    let mut write_index = 0;

    for read_index in 0..open_start_indices.len() {
        let start_index = open_start_indices[read_index];
        if is_compatible_open_start_for_stop(
            stop_index,
            start_index,
            app_codes,
            timestamp_ns,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
        ) {
            close_start(start_index);
        } else {
            open_start_indices[write_index] = start_index;
            write_index += 1;
        }
    }

    open_start_indices.truncate(write_index);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)]
enum SparseStopMode {
    SameApp,
    OtherApp,
    AnyApp,
    FallbackSameApp,
}

/// Classify every close appended since `stop_reasons` was last filled.
///
/// One stop event can close several open starts, and under the sparse matcher's
/// `AnyApp` mode those closes are not all the same kind. Classifying per start
/// — rather than once per stop — is what keeps the sparse and legacy paths
/// agreeing; the randomized oracle test fails otherwise.
fn classify_new_closes(
    stop_reasons: &mut Vec<EpisodeCloseReason>,
    stop_start_indices: &[usize],
    stop_index: usize,
    app_codes: &[i32],
    same_stop: &[bool],
    other_stop: &[bool],
    background: &[bool],
) {
    for &start_index in &stop_start_indices[stop_reasons.len()..] {
        stop_reasons.push(legacy_close_reason(
            stop_index,
            start_index,
            app_codes,
            same_stop,
            other_stop,
            background,
        ));
    }
}

/// Which compatibility test let `stop_index` close `start_index`.
///
/// The legacy proximity path does not carry a `SparseStopMode`; it re-derives
/// compatibility per candidate start. This mirrors that test in the same order,
/// so the reported reason is the one that actually matched rather than a guess.
/// `AnyAppStop` is unreachable here: that mode exists only in the sparse path's
/// background-modelling branch.
fn legacy_close_reason(
    stop_index: usize,
    start_index: usize,
    app_codes: &[i32],
    same_stop: &[bool],
    other_stop: &[bool],
    background: &[bool],
) -> EpisodeCloseReason {
    let same_app = app_codes[start_index] == app_codes[stop_index];
    if same_stop[stop_index] && same_app {
        EpisodeCloseReason::SameAppStop
    } else if other_stop[stop_index] && !same_app && !background[start_index] {
        EpisodeCloseReason::OtherAppStop
    } else {
        EpisodeCloseReason::ActivityStoppedFallback
    }
}

fn sparse_stop_mode(
    index: usize,
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    options: MatchOptions,
) -> Option<SparseStopMode> {
    let has_same_stop = same_stop[index];
    let has_other_stop = other_stop[index];
    let has_fallback_stop = stopped[index] && options.use_activity_stopped_as_fallback;

    if has_same_stop && has_other_stop {
        Some(SparseStopMode::AnyApp)
    } else if has_same_stop {
        Some(SparseStopMode::SameApp)
    } else if has_other_stop {
        Some(SparseStopMode::OtherApp)
    } else if has_fallback_stop {
        Some(SparseStopMode::FallbackSameApp)
    } else {
        None
    }
}

fn sparse_stop_enforces_threshold(mode: SparseStopMode, options: MatchOptions) -> bool {
    !matches!(mode, SparseStopMode::FallbackSameApp) || options.apply_threshold_to_fallback
}

#[derive(Debug)]
struct SparseOpenStarts {
    global_prev: Vec<i32>,
    app_prev: Vec<i32>,
    closed: Vec<bool>,
    app_heads: Vec<i32>,
    global_head: i32,
}

impl SparseOpenStarts {
    fn new(len: usize, app_codes: &[i32]) -> MatcherResult<Self> {
        if app_codes.iter().any(|&code| code < 0) {
            return Err(MatcherError::new(
                "app code arrays must contain only non-negative values",
            ));
        }
        let max_app_code = app_codes.iter().copied().max().unwrap_or(0) as usize;
        Ok(Self {
            global_prev: vec![-1; len],
            app_prev: vec![-1; len],
            closed: vec![false; len],
            app_heads: vec![-1; max_app_code.saturating_add(1)],
            global_head: -1,
        })
    }

    fn open(&mut self, index: usize, app_code: i32) {
        let slot = app_code as usize;
        self.global_prev[index] = self.global_head;
        self.app_prev[index] = self.app_heads[slot];
        self.global_head = index as i32;
        self.app_heads[slot] = index as i32;
    }

    fn close(&mut self, index: usize) {
        self.closed[index] = true;
    }

    fn prune_global_head(&mut self) {
        while self.global_head >= 0 && self.closed[self.global_head as usize] {
            self.global_head = self.global_prev[self.global_head as usize];
        }
    }

    fn prune_app_head(&mut self, app_code: i32) {
        let slot = app_code as usize;
        while self.app_heads[slot] >= 0 && self.closed[self.app_heads[slot] as usize] {
            self.app_heads[slot] = self.app_prev[self.app_heads[slot] as usize];
        }
    }

    fn latest_same_app(
        &mut self,
        app_code: i32,
        stop_timestamp_ns: i64,
        enforce_threshold: bool,
        threshold_ns: i64,
        timestamp_ns: &[i64],
    ) -> Option<usize> {
        self.prune_app_head(app_code);
        let slot = app_code as usize;
        let cursor = self.app_heads[slot];
        if cursor < 0 {
            return None;
        }

        let index = cursor as usize;
        if !is_valid_duration(
            timestamp_ns[index],
            stop_timestamp_ns,
            enforce_threshold,
            threshold_ns,
        ) {
            return None;
        }
        Some(index)
    }

    fn latest_matching_global<F>(
        &mut self,
        stop_timestamp_ns: i64,
        enforce_threshold: bool,
        threshold_ns: i64,
        timestamp_ns: &[i64],
        mut predicate: F,
    ) -> Option<usize>
    where
        F: FnMut(usize) -> bool,
    {
        self.prune_global_head();
        let mut cursor = self.global_head;
        while cursor >= 0 {
            let index = cursor as usize;
            cursor = self.global_prev[index];

            if self.closed[index] {
                continue;
            }
            if !is_valid_duration(
                timestamp_ns[index],
                stop_timestamp_ns,
                enforce_threshold,
                threshold_ns,
            ) {
                return None;
            }
            if predicate(index) {
                return Some(index);
            }
        }
        None
    }

    fn close_same_app_matches<F>(
        &mut self,
        app_code: i32,
        stop_timestamp_ns: i64,
        enforce_threshold: bool,
        threshold_ns: i64,
        timestamp_ns: &[i64],
        mut on_close: F,
    ) where
        F: FnMut(usize),
    {
        self.prune_app_head(app_code);
        let slot = app_code as usize;
        let mut cursor = self.app_heads[slot];
        while cursor >= 0 {
            let index = cursor as usize;
            cursor = self.app_prev[index];

            if self.closed[index] {
                continue;
            }
            if !is_valid_duration(
                timestamp_ns[index],
                stop_timestamp_ns,
                enforce_threshold,
                threshold_ns,
            ) {
                break;
            }

            self.close(index);
            on_close(index);
        }
        self.prune_app_head(app_code);
        self.prune_global_head();
    }

    fn close_matching_global<P, F>(
        &mut self,
        stop_timestamp_ns: i64,
        enforce_threshold: bool,
        threshold_ns: i64,
        timestamp_ns: &[i64],
        mut predicate: P,
        mut on_close: F,
    ) where
        P: FnMut(usize) -> bool,
        F: FnMut(usize),
    {
        self.prune_global_head();
        let mut cursor = self.global_head;
        while cursor >= 0 {
            let index = cursor as usize;
            cursor = self.global_prev[index];

            if self.closed[index] {
                continue;
            }
            if !is_valid_duration(
                timestamp_ns[index],
                stop_timestamp_ns,
                enforce_threshold,
                threshold_ns,
            ) {
                break;
            }
            if predicate(index) {
                self.close(index);
                on_close(index);
            }
        }
        self.prune_global_head();
    }

    fn finish_open_starts<F, G>(
        &mut self,
        last_index: usize,
        timestamp_ns: &[i64],
        threshold_ns: i64,
        mut on_close: F,
        mut on_missing: G,
    ) where
        F: FnMut(usize, usize),
        G: FnMut(usize),
    {
        self.prune_global_head();
        let mut cursor = self.global_head;
        while cursor >= 0 {
            let index = cursor as usize;
            cursor = self.global_prev[index];

            if self.closed[index] {
                continue;
            }
            if last_index > index
                && is_valid_duration(
                    timestamp_ns[index],
                    timestamp_ns[last_index],
                    true,
                    threshold_ns,
                )
            {
                self.close(index);
                on_close(index, last_index);
            } else {
                on_missing(index);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
) -> MatcherResult<MatchOutput> {
    let len = validate_lengths(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    )?;
    let mut start_ns = vec![-1; len];
    let mut stop_ns = vec![-1; len];
    let mut missing = vec![false; len];
    let mut open_start_indices: Vec<usize> = Vec::new();

    for index in 0..len {
        let is_normal_stop = same_stop[index] || other_stop[index];
        let is_fallback_stop = stopped[index] && options.use_activity_stopped_as_fallback;
        let current_timestamp = timestamp_ns[index];

        if options.allow_stop_event_reuse && (is_normal_stop || is_fallback_stop) {
            close_reused_starts(
                index,
                app_codes,
                timestamp_ns,
                same_stop,
                other_stop,
                stopped,
                background,
                options,
                &mut open_start_indices,
                |start_index| stop_ns[start_index] = current_timestamp,
            );
        } else if is_normal_stop || is_fallback_stop {
            if let Some(position) = nearest_compatible_open_start_for_stop(
                index,
                app_codes,
                timestamp_ns,
                &open_start_indices,
                same_stop,
                other_stop,
                stopped,
                background,
                options,
            ) {
                let start_index = open_start_indices.remove(position);
                stop_ns[start_index] = current_timestamp;
            }
        }

        if resumed[index] {
            start_ns[index] = current_timestamp;
            open_start_indices.push(index);
        }
    }

    if !open_start_indices.is_empty() {
        let last_index = len - 1;
        let last_timestamp = timestamp_ns[last_index];
        let still_open = std::mem::take(&mut open_start_indices);

        for start_index in still_open {
            if last_index > start_index
                && is_valid_duration(
                    timestamp_ns[start_index],
                    last_timestamp,
                    true,
                    options.long_duration_threshold_ns,
                )
            {
                stop_ns[start_index] = last_timestamp;
            } else {
                missing[start_index] = true;
            }
        }
    }

    Ok(MatchOutput {
        start_ns,
        stop_ns,
        missing,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_update_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
) -> MatcherResult<MatchUpdateIndices> {
    let len = validate_lengths(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    )?;
    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut missing_indices = Vec::new();
    let mut stop_reasons: Vec<EpisodeCloseReason> = Vec::new();
    let mut missing_reasons: Vec<EpisodeCloseReason> = Vec::new();
    let mut open_starts = SparseOpenStarts::new(len, app_codes)?;
    let threshold_ns = options.long_duration_threshold_ns;

    for index in 0..len {
        if let Some(stop_mode) = sparse_stop_mode(index, same_stop, other_stop, stopped, options) {
            let current_app = app_codes[index];
            let stop_timestamp_ns = timestamp_ns[index];
            let enforce_threshold = sparse_stop_enforces_threshold(stop_mode, options);
            // One stop event can close several open starts (reuse mode), and
            // every close it performs carries this stop's mode. Rather than
            // thread a reason through each closure, backfill whatever this
            // block appended — `resize` only ever extends, so entries recorded
            // by earlier blocks keep their own reason.

            if options.allow_stop_event_reuse {
                match stop_mode {
                    SparseStopMode::SameApp | SparseStopMode::FallbackSameApp => {
                        open_starts.close_same_app_matches(
                            current_app,
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| {
                                stop_start_indices.push(start_index);
                                stop_event_indices.push(index);
                            },
                        );
                    }
                    SparseStopMode::OtherApp => {
                        open_starts.close_matching_global(
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| {
                                app_codes[start_index] != current_app && !background[start_index]
                            },
                            |start_index| {
                                stop_start_indices.push(start_index);
                                stop_event_indices.push(index);
                            },
                        );
                    }
                    SparseStopMode::AnyApp => {
                        open_starts.close_matching_global(
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| {
                                app_codes[start_index] == current_app || !background[start_index]
                            },
                            |start_index| {
                                stop_start_indices.push(start_index);
                                stop_event_indices.push(index);
                            },
                        );
                    }
                }
            } else {
                let matched_start = match stop_mode {
                    SparseStopMode::SameApp | SparseStopMode::FallbackSameApp => open_starts
                        .latest_same_app(
                            current_app,
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                        ),
                    SparseStopMode::OtherApp => open_starts.latest_matching_global(
                        stop_timestamp_ns,
                        enforce_threshold,
                        threshold_ns,
                        timestamp_ns,
                        |start_index| {
                            app_codes[start_index] != current_app && !background[start_index]
                        },
                    ),
                    SparseStopMode::AnyApp => open_starts.latest_matching_global(
                        stop_timestamp_ns,
                        enforce_threshold,
                        threshold_ns,
                        timestamp_ns,
                        |start_index| {
                            app_codes[start_index] == current_app || !background[start_index]
                        },
                    ),
                };

                if let Some(start_index) = matched_start {
                    open_starts.close(start_index);
                    stop_start_indices.push(start_index);
                    stop_event_indices.push(index);
                }
            }
            classify_new_closes(
                &mut stop_reasons,
                &stop_start_indices,
                index,
                app_codes,
                same_stop,
                other_stop,
                background,
            );
        }

        if resumed[index] {
            start_indices.push(index);
            open_starts.open(index, app_codes[index]);
        }
    }

    if len > 0 {
        let last_index = len - 1;
        open_starts.finish_open_starts(
            last_index,
            timestamp_ns,
            threshold_ns,
            |start_index, stop_index| {
                stop_start_indices.push(start_index);
                stop_event_indices.push(stop_index);
            },
            |start_index| missing_indices.push(start_index),
        );
        // Everything appended above came from the end-of-stream sweep: the
        // stream ran out with these episodes still open.
        stop_reasons.resize(stop_start_indices.len(), EpisodeCloseReason::EndOfStream);
        missing_reasons.resize(missing_indices.len(), EpisodeCloseReason::Unobserved);
    }

    // Every close these rules make lands on a real event, so no explicit end
    // instants are needed. Bound before the literal: the struct moves
    // `stop_start_indices` on the line above.
    let row_anchored_stops = vec![None; stop_start_indices.len()];
    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns: row_anchored_stops,
    })
}

/// Reference-compatible matcher with the intra-app teardown grace used by the
/// browser product. A zero proximity delegates to the optimized sparse
/// matcher. A positive proximity keeps a re-resumed session open when an
/// Activity-Stopped fallback lands inside the grace window, matching the
/// product's former TypeScript implementation exactly.
#[allow(clippy::too_many_arguments)]
fn match_sorted_app_usage_update_indices_with_proximity(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    eligible_opener: &[bool],
    native_resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
    proximity_ns: i64,
) -> MatcherResult<MatchUpdateIndices> {
    let len = app_codes.len();
    let max_app_code = app_codes.iter().copied().max().unwrap_or(0);
    let app_slots = max_app_code as usize + 1;
    let mut last_event_ns = vec![None; app_slots];
    let mut last_was_same_stop = vec![false; app_slots];
    let mut is_reresume = vec![false; len];
    let mut open_starts = SparseOpenStarts::new(len, app_codes)?;
    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut missing_indices = Vec::new();
    let mut stop_reasons: Vec<EpisodeCloseReason> = Vec::new();
    let mut missing_reasons: Vec<EpisodeCloseReason> = Vec::new();
    let mut closed = Vec::new();
    let threshold_ns = options.long_duration_threshold_ns;

    for index in 0..len {
        if let Some(stop_mode) = sparse_stop_mode(index, same_stop, other_stop, stopped, options) {
            let current_app = app_codes[index];
            let stop_timestamp_ns = timestamp_ns[index];
            let enforce_threshold = sparse_stop_enforces_threshold(stop_mode, options);

            if options.allow_stop_event_reuse {
                // Sparse lists run newest-to-oldest. Buffer and reverse the
                // matches so the public result retains the legacy order.
                closed.clear();
                match stop_mode {
                    SparseStopMode::SameApp | SparseStopMode::FallbackSameApp => {
                        open_starts.close_same_app_matches(
                            current_app,
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| closed.push(start_index),
                        );
                    }
                    SparseStopMode::OtherApp => {
                        open_starts.close_matching_global(
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| {
                                app_codes[start_index] != current_app && !background[start_index]
                            },
                            |start_index| closed.push(start_index),
                        );
                    }
                    SparseStopMode::AnyApp => {
                        open_starts.close_matching_global(
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                            |start_index| {
                                app_codes[start_index] == current_app || !background[start_index]
                            },
                            |start_index| closed.push(start_index),
                        );
                    }
                }
                for start_index in closed.drain(..).rev() {
                    stop_start_indices.push(start_index);
                    stop_event_indices.push(index);
                }
            } else {
                let matched_start = match stop_mode {
                    SparseStopMode::SameApp => open_starts.latest_same_app(
                        current_app,
                        stop_timestamp_ns,
                        true,
                        threshold_ns,
                        timestamp_ns,
                    ),
                    SparseStopMode::FallbackSameApp => {
                        let candidate = open_starts.latest_same_app(
                            current_app,
                            stop_timestamp_ns,
                            enforce_threshold,
                            threshold_ns,
                            timestamp_ns,
                        );
                        candidate.filter(|&start_index| {
                            !(is_reresume[start_index]
                                && i128::from(stop_timestamp_ns)
                                    - i128::from(timestamp_ns[start_index])
                                    < i128::from(proximity_ns))
                        })
                    }
                    SparseStopMode::OtherApp => open_starts.latest_matching_global(
                        stop_timestamp_ns,
                        true,
                        threshold_ns,
                        timestamp_ns,
                        |start_index| {
                            app_codes[start_index] != current_app && !background[start_index]
                        },
                    ),
                    SparseStopMode::AnyApp => open_starts.latest_matching_global(
                        stop_timestamp_ns,
                        true,
                        threshold_ns,
                        timestamp_ns,
                        |start_index| {
                            app_codes[start_index] == current_app || !background[start_index]
                        },
                    ),
                };

                if let Some(start_index) = matched_start {
                    open_starts.close(start_index);
                    stop_start_indices.push(start_index);
                    stop_event_indices.push(index);
                }
            }
            classify_new_closes(
                &mut stop_reasons,
                &stop_start_indices,
                index,
                app_codes,
                same_stop,
                other_stop,
                background,
            );
        }

        if eligible_opener[index] {
            let slot = app_codes[index] as usize;
            is_reresume[index] = native_resumed[index]
                && last_event_ns[slot].is_some_and(|last| {
                    last_was_same_stop[slot]
                        && i128::from(timestamp_ns[index]) - i128::from(last)
                            < i128::from(proximity_ns)
                });
            start_indices.push(index);
            open_starts.open(index, app_codes[index]);
        }

        let slot = app_codes[index] as usize;
        last_event_ns[slot] = Some(timestamp_ns[index]);
        last_was_same_stop[slot] = same_stop[index];
    }

    if len > 0 {
        let last_index = len - 1;
        let mut final_stops = Vec::new();
        let mut final_missing = Vec::new();
        open_starts.finish_open_starts(
            last_index,
            timestamp_ns,
            threshold_ns,
            |start_index, stop_index| final_stops.push((start_index, stop_index)),
            |start_index| final_missing.push(start_index),
        );
        for (start_index, stop_index) in final_stops.into_iter().rev() {
            stop_start_indices.push(start_index);
            stop_event_indices.push(stop_index);
        }
        missing_indices.extend(final_missing.into_iter().rev());
        stop_reasons.resize(stop_start_indices.len(), EpisodeCloseReason::EndOfStream);
        missing_reasons.resize(missing_indices.len(), EpisodeCloseReason::Unobserved);
    }

    // Every close these rules make lands on a real event, so no explicit end
    // instants are needed. Bound before the literal: the struct moves
    // `stop_start_indices` on the line above.
    let row_anchored_stops = vec![None; stop_start_indices.len()];
    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns: row_anchored_stops,
    })
}

#[allow(clippy::too_many_arguments)]
fn match_legacy_app_usage_update_indices_with_proximity(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    eligible_opener: &[bool],
    native_resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
    proximity_ns: i64,
) -> MatcherResult<MatchUpdateIndices> {
    let len = app_codes.len();
    let max_app_code = app_codes.iter().copied().max().unwrap_or(0);
    if app_codes.iter().any(|&code| code < 0) {
        return Err(MatcherError::new(
            "app code arrays must contain only non-negative values",
        ));
    }
    let app_slots = max_app_code as usize + 1;
    let mut last_event_ns = vec![None; app_slots];
    let mut last_was_same_stop = vec![false; app_slots];
    let mut is_reresume = vec![false; len];
    let mut open_start_indices = Vec::new();
    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut missing_indices = Vec::new();
    let mut stop_reasons: Vec<EpisodeCloseReason> = Vec::new();
    let mut missing_reasons: Vec<EpisodeCloseReason> = Vec::new();

    for index in 0..len {
        let current_app = app_codes[index];
        let is_normal_stop = same_stop[index] || other_stop[index];
        let is_fallback_stop = stopped[index] && options.use_activity_stopped_as_fallback;

        if options.allow_stop_event_reuse && (is_normal_stop || is_fallback_stop) {
            close_reused_starts(
                index,
                app_codes,
                timestamp_ns,
                same_stop,
                other_stop,
                stopped,
                background,
                options,
                &mut open_start_indices,
                |start_index| {
                    stop_start_indices.push(start_index);
                    stop_event_indices.push(index);
                    stop_reasons.push(legacy_close_reason(
                        index,
                        start_index,
                        app_codes,
                        same_stop,
                        other_stop,
                        background,
                    ));
                },
            );
        } else if is_normal_stop || is_fallback_stop {
            let mut matched_position = None;
            for (position, &start_index) in open_start_indices.iter().enumerate().rev() {
                let start_app = app_codes[start_index];
                let same_app_compatible = same_stop[index] && start_app == current_app;
                let other_app_compatible =
                    other_stop[index] && start_app != current_app && !background[start_index];
                let fallback_compatible =
                    !is_normal_stop && is_fallback_stop && start_app == current_app;
                if !(same_app_compatible || other_app_compatible || fallback_compatible) {
                    continue;
                }
                let enforce_threshold = !fallback_compatible || options.apply_threshold_to_fallback;
                if !is_valid_duration(
                    timestamp_ns[start_index],
                    timestamp_ns[index],
                    enforce_threshold,
                    options.long_duration_threshold_ns,
                ) {
                    continue;
                }
                if fallback_compatible
                    && is_reresume[start_index]
                    && i128::from(timestamp_ns[index]) - i128::from(timestamp_ns[start_index])
                        < i128::from(proximity_ns)
                {
                    // Intra-app teardown artifact: leave this start open for
                    // the next genuine stop event.
                    break;
                }
                matched_position = Some(position);
                break;
            }
            if let Some(position) = matched_position {
                let start_index = open_start_indices.remove(position);
                stop_start_indices.push(start_index);
                stop_event_indices.push(index);
                stop_reasons.push(legacy_close_reason(
                    index,
                    start_index,
                    app_codes,
                    same_stop,
                    other_stop,
                    background,
                ));
            }
        }

        if eligible_opener[index] {
            let slot = current_app as usize;
            is_reresume[index] = native_resumed[index]
                && last_event_ns[slot].is_some_and(|last| {
                    last_was_same_stop[slot]
                        && i128::from(timestamp_ns[index]) - i128::from(last)
                            < i128::from(proximity_ns)
                });
            start_indices.push(index);
            open_start_indices.push(index);
        }

        let slot = current_app as usize;
        last_event_ns[slot] = Some(timestamp_ns[index]);
        last_was_same_stop[slot] = same_stop[index];
    }

    if len > 0 {
        let last_index = len - 1;
        for start_index in open_start_indices {
            if last_index > start_index
                && is_valid_duration(
                    timestamp_ns[start_index],
                    timestamp_ns[last_index],
                    true,
                    options.long_duration_threshold_ns,
                )
            {
                stop_start_indices.push(start_index);
                stop_event_indices.push(last_index);
                stop_reasons.push(EpisodeCloseReason::EndOfStream);
            } else {
                missing_indices.push(start_index);
                missing_reasons.push(EpisodeCloseReason::Unobserved);
            }
        }
    }

    // Every close these rules make lands on a real event, so no explicit end
    // instants are needed. Bound before the literal: the struct moves
    // `stop_start_indices` on the line above.
    let row_anchored_stops = vec![None; stop_start_indices.len()];
    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns: row_anchored_stops,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_update_indices_with_proximity_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
    proximity_ns: i64,
) -> MatcherResult<MatchUpdateIndices> {
    match_app_usage_update_indices_with_proximity_openers_core(
        app_codes,
        timestamp_ns,
        resumed,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
        options,
        proximity_ns,
    )
}

/// Fused matcher with opener eligibility separated from Android's native
/// `ACTIVITY_RESUMED` signal.
///
/// `eligible_opener` controls only which rows may enter the open-start set.
/// `native_resumed` remains the lifecycle signal used by the proximity repair
/// to recognize a real re-resume. Close and handover behavior continues to be
/// supplied by `same_stop`/`other_stop`; callers must not derive those arrays
/// from the selected opener set.
#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_update_indices_with_proximity_openers_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    eligible_opener: &[bool],
    native_resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    background: &[bool],
    options: MatchOptions,
    proximity_ns: i64,
) -> MatcherResult<MatchUpdateIndices> {
    validate_lengths(
        app_codes,
        timestamp_ns,
        native_resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    )?;
    if eligible_opener.len() != app_codes.len() {
        return Err(MatcherError::new(
            "all input arrays must have the same length",
        ));
    }
    if proximity_ns < 0 {
        return Err(MatcherError::new("proximity_ns must be non-negative"));
    }
    if proximity_ns == 0 {
        return match_app_usage_update_indices_core(
            app_codes,
            timestamp_ns,
            eligible_opener,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
        );
    }

    if timestamp_ns.windows(2).all(|pair| pair[0] <= pair[1]) {
        return match_sorted_app_usage_update_indices_with_proximity(
            app_codes,
            timestamp_ns,
            eligible_opener,
            native_resumed,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
            proximity_ns,
        );
    }

    match_legacy_app_usage_update_indices_with_proximity(
        app_codes,
        timestamp_ns,
        eligible_opener,
        native_resumed,
        same_stop,
        other_stop,
        stopped,
        background,
        options,
        proximity_ns,
    )
}

/// GESIS episode reconstruction (Zerrer, Wieland & de Alwis).
///
/// Ported from the tutorial's `red_start_stop` pipeline at
/// github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data
/// (MIT, `readme.qmd`), doi:10.71627/How-to-work-with-Android-App-Logging-Data.1.
///
/// An episode opens on every `Start` row whose package is not the Android
/// system pseudo-package. Its end is chosen in three tiers:
///
/// 1. **`original`** — the nearest same-app `Stop` strictly after the start,
///    accepted when at most `event_threshold` events sit between them.
/// 2. **`activity_based`** — otherwise (too many intervening events, or no
///    same-app stop at all) the *next global event* of any package, accepted
///    only if it falls within `max_timeout` of the start.
/// 3. **`timeout`** — otherwise the episode is cut at `start + max_timeout`, an
///    instant no event carries. This is why `stop_timestamps_ns` exists.
///
/// Defaults are the tutorial's: `max_timeout = 600 s`, `event_threshold = 10`.
///
/// Three details are reproduced deliberately because they are load-bearing and
/// each would look like a bug to someone porting from the prose:
///
/// - **The threshold comparison is inclusive on both sides.** The R writes
///   `events_between <= threshold` for tier 1 and `>= threshold` for tier 2,
///   which overlap at exactly `threshold`; `case_when` takes the first match,
///   so exactly-`threshold` resolves to `original`. Reproduced here.
/// - **A later same-app `Start` can serve as a `Stop`.** Their stop table is
///   built from rows classified `Start` *or* `Stop`, keeping any whose next
///   same-app event is not a `Stop` — which admits `Start` rows. An episode can
///   therefore be closed by the same app opening again. This looks accidental,
///   but it is what their published code does and what their results reflect.
/// - **No episode ever ends unobserved.** Tier 3 always produces an end, so
///   `missing_indices` is empty for this rule. Unlike every other rule here,
///   GESIS cannot report "no end was observable" — it always answers.
///
/// `same_app_stop` marks rows this rule classifies as a stop; `is_start` marks
/// rows it classifies as a start. Their event-type vocabulary is far wider than
/// this repository's — `Standby bucket changed` is a start, `Flush to disk` a
/// stop — so the classification is supplied by the caller rather than derived
/// from this matcher's own `resumed`/`same_stop` flags, which encode a
/// different theory of what an episode is.
#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_gesis_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    is_start: &[bool],
    is_stop: &[bool],
    stop_matchable: &[bool],
    android_pseudo_package: &[bool],
    max_timeout_ns: i64,
    event_threshold: usize,
) -> MatcherResult<MatchUpdateIndices> {
    match_app_usage_gesis_with_openers_indices_core(
        app_codes,
        timestamp_ns,
        is_start,
        is_start,
        is_stop,
        stop_matchable,
        android_pseudo_package,
        max_timeout_ns,
        event_threshold,
    )
}

/// GESIS reconstruction with the selected opener set separated from the
/// source-compatible Start/Stop repair pool.
///
/// `eligible_opener` controls which rows may open an episode. The published R
/// rule's stop-candidate table still uses `baseline_classified_start` together
/// with `is_stop`; changing that pool would also change B03 closer semantics.
#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_gesis_with_openers_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    eligible_opener: &[bool],
    baseline_classified_start: &[bool],
    is_stop: &[bool],
    stop_matchable: &[bool],
    android_pseudo_package: &[bool],
    max_timeout_ns: i64,
    event_threshold: usize,
) -> MatcherResult<MatchUpdateIndices> {
    let len = app_codes.len();
    if timestamp_ns.len() != len
        || eligible_opener.len() != len
        || baseline_classified_start.len() != len
        || is_stop.len() != len
        || stop_matchable.len() != len
        || android_pseudo_package.len() != len
    {
        return Err(MatcherError::new(
            "all input arrays must have the same length",
        ));
    }

    // Their `app_stops` table, built exactly as the reference does it.
    //
    // The pool is Start AND Stop rows (`event %in% c("Start","Stop")`), and a
    // row is dropped only when the NEXT row of the same app is a Stop. Two
    // consequences, both load-bearing and both easy to lose by "simplifying"
    // this to "the next stop":
    //
    //  1. A run of consecutive same-app stops collapses to its LAST stop, so a
    //     start binds to the end of the run, not its first member. Taking the
    //     first changes the end timestamp AND `events_between`, which can flip
    //     the episode into a different tier entirely.
    //  2. A Start survives into the table whenever the next same-app event is
    //     not a Stop. So an app with no stop event closes at its own next
    //     Start, as tier `original`. This looks like an oversight in the
    //     published R, but it is the behaviour their reported numbers come
    //     from, and it fires on exactly the missing-stop case the rule exists
    //     to repair. Ported deliberately, not reproduced by accident.
    let mut is_stop_candidate = vec![false; len];
    {
        let mut next_pool_row: BTreeMap<i32, usize> = BTreeMap::new();
        for index in (0..len).rev() {
            if !stop_matchable[index] || (!baseline_classified_start[index] && !is_stop[index]) {
                continue;
            }
            let followed_by_stop = next_pool_row
                .get(&app_codes[index])
                .is_some_and(|&next| is_stop[next]);
            is_stop_candidate[index] = !followed_by_stop;
            next_pool_row.insert(app_codes[index], index);
        }
    }

    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut stop_reasons = Vec::new();
    let mut stop_timestamps_ns = Vec::new();

    for index in 0..len {
        if !eligible_opener[index] || android_pseudo_package[index] {
            continue;
        }
        start_indices.push(index);
        let package = app_codes[index];
        let start_ns = timestamp_ns[index];

        // Tier 1 candidate: nearest same-app stop strictly after the start.
        // `stop_matchable` excludes the event types their stop table drops
        // (notification-seen, type 10) while leaving them able to act as the
        // next global event in tier 2.
        let candidate =
            (index + 1..len).find(|&probe| is_stop_candidate[probe] && app_codes[probe] == package);
        let events_between = candidate.map(|stop| stop - index - 1);

        // Tier 2 candidate: the next event of any package, regardless of kind.
        let next_global = index + 1;
        let next_global_within_timeout = next_global < len
            && timestamp_ns[next_global].saturating_sub(start_ns) <= max_timeout_ns;

        let (stop_index, stop_ns, reason) = match (candidate, events_between) {
            (Some(stop), Some(between)) if between <= event_threshold => {
                (Some(stop), None, EpisodeCloseReason::GesisOriginalStop)
            }
            _ if next_global_within_timeout => (
                Some(next_global),
                None,
                EpisodeCloseReason::GesisNextGlobalEvent,
            ),
            _ => (
                None,
                Some(start_ns.saturating_add(max_timeout_ns)),
                EpisodeCloseReason::GesisTimeout,
            ),
        };

        stop_start_indices.push(index);
        // A timeout close has no event to point at. The start row is recorded
        // as the anchor so the parallel arrays stay index-addressable, and the
        // authoritative end travels in `stop_timestamps_ns`.
        stop_event_indices.push(stop_index.unwrap_or(index));
        stop_timestamps_ns.push(stop_ns);
        stop_reasons.push(reason);
    }

    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        // Tier 3 always yields an end, so this rule never reports one missing.
        missing_indices: Vec::new(),
        stop_reasons,
        missing_reasons: Vec::new(),
        stop_timestamps_ns,
    })
}

/// Parry & Toth (2025) forward pairing, at the app-episode level.
///
/// Source: *Extracting Meaningful Measures of Smartphone Usage from Android
/// Event Log Data: A Methodological Primer*, doi:10.5117/CCR2025.1.8.PARR.
///
/// This implements the rule as their **reference implementation** performs it,
/// not as the prose of Steps 6–7 reads in isolation. The distinction is
/// load-bearing and was measured, so it is recorded here rather than left to be
/// rediscovered:
///
/// An episode opens on every type-1 (`ACTIVITY_RESUMED`) row whose package is
/// not the `"android"` system pseudo-package, and closes at the **first**
/// following row that is any of:
///
///   1. `screen_off` — the screen becomes non-interactive (event type 16);
///   2. `paused` carrying the *same* package — that app moves to the background
///      (event type 2);
///   3. `resumed` carrying a *different* package — another app takes the
///      foreground (event type 1).
///
/// A start with no such successor anywhere in the stream has no observable end
/// and lands in `missing_indices`; it is never extended to a later row.
///
/// Why all three, when Steps 6–7 name only the third: Step 7 alone ("the
/// timestamp from the subsequent row can be used to indicate the stop of the
/// current episode") gives one closer. The other two come from Steps 3, 8 and 9,
/// which bracket episodes against the screen stream and discard those falling
/// outside a session or glance. Implementing 6–7 without 3/8/9 leaves an
/// overnight episode with nothing to close it before the next morning's first
/// foreground event — which is what this function did until 2026-08-08.
///
/// Their R reference (`build_app_usage`, in the Chronicle adaptation at
/// github.com/joshculverhouse/chronicle-android-preprocessing, which labels its
/// output `source_dataset = "ParryToth-adapted"`) encodes exactly the three
/// closers above and then drops unclosed rows outright.
///
/// Two deliberate departures from the prose, both matching that reference:
/// - **No Step-6 same-package collapse.** Consecutive same-package resumes each
///   open an episode. The reference defers collapsing to its downstream
///   cleaning pass, which merges adjacent same-package segments within 1 s.
/// - **No cap, threshold, or gap tolerance.** The paper states none, so
///   `MatchOptions` is not consulted; closer 1 is what bounds an overnight
///   episode, and passing an option must not silently change the result.
pub fn match_app_usage_forward_pairing_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    paused: &[bool],
    screen_off: &[bool],
    android_pseudo_package: &[bool],
) -> MatcherResult<MatchUpdateIndices> {
    match_app_usage_forward_pairing_with_openers_indices_core(
        app_codes,
        timestamp_ns,
        resumed,
        resumed,
        paused,
        screen_off,
        android_pseudo_package,
    )
}

/// Parry & Toth forward pairing with opener eligibility separated from native
/// Android lifecycle events.
///
/// `eligible_opener` controls only which rows open episodes. A different-app
/// handover is still recognized exclusively from `native_resumed`, so adding a
/// type-19 opener cannot silently turn type 19 into a B03 close signal.
#[allow(clippy::too_many_arguments)]
pub fn match_app_usage_forward_pairing_with_openers_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    eligible_opener: &[bool],
    native_resumed: &[bool],
    paused: &[bool],
    screen_off: &[bool],
    android_pseudo_package: &[bool],
) -> MatcherResult<MatchUpdateIndices> {
    // Not `validate_lengths`: that helper is shaped for the fused matcher's
    // seven arrays, and padding this call with a repeated slice to fit would
    // assert a relationship that does not exist here.
    let len = app_codes.len();
    if timestamp_ns.len() != len
        || eligible_opener.len() != len
        || native_resumed.len() != len
        || paused.len() != len
        || screen_off.len() != len
        || android_pseudo_package.len() != len
    {
        return Err(MatcherError::new(
            "all input arrays must have the same length",
        ));
    }

    let mut start_indices = Vec::new();
    let mut stop_start_indices = Vec::new();
    let mut stop_event_indices = Vec::new();
    let mut missing_indices = Vec::new();
    let mut stop_reasons = Vec::new();
    let mut missing_reasons = Vec::new();

    for index in 0..len {
        if !eligible_opener[index] || android_pseudo_package[index] {
            continue;
        }
        let package = app_codes[index];
        start_indices.push(index);

        // First matching successor wins. Scanning forward per start is O(n·k)
        // in the worst case, but k is the distance to the next screen or
        // foreground transition, which is small on real streams; the previous
        // pairwise formulation was cheaper only because it ignored two of the
        // three closers.
        let closer = (index + 1..len).find(|&probe| {
            screen_off[probe]
                || (paused[probe] && app_codes[probe] == package)
                || (native_resumed[probe] && app_codes[probe] != package)
        });

        match closer {
            Some(stop) => {
                stop_start_indices.push(index);
                stop_event_indices.push(stop);
                // Which of the three closers fired. Tested in the order the
                // reference checks them, so a row that is both (a screen-off
                // and a handover cannot coincide, but a same-package pause and
                // a screen-off can) resolves the same way it did above.
                stop_reasons.push(if screen_off[stop] {
                    EpisodeCloseReason::ScreenNonInteractive
                } else if paused[stop] {
                    EpisodeCloseReason::SamePackageBackgrounded
                } else {
                    EpisodeCloseReason::ForegroundHandover
                });
            }
            // The reference drops these rows. Reporting them as missing is the
            // equivalent here: this pipeline maps `missing_indices` to
            // End of Usage Missing, which carries null start/stop and credits
            // zero duration. Dropping them silently would instead hide how
            // often the rule fails to observe an end.
            None => {
                missing_indices.push(index);
                missing_reasons.push(EpisodeCloseReason::Unobserved);
            }
        }
    }

    // Every close these rules make lands on a real event, so no explicit end
    // instants are needed. Bound before the literal: the struct moves
    // `stop_start_indices` on the line above.
    let row_anchored_stops = vec![None; stop_start_indices.len()];
    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
        stop_reasons,
        missing_reasons,
        stop_timestamps_ns: row_anchored_stops,
    })
}

#[cfg(feature = "python")]
fn to_py_error(error: MatcherError) -> PyErr {
    PyValueError::new_err(error.to_string())
}

#[cfg(feature = "python")]
#[pyfunction]
fn match_app_usage(
    app_codes: Vec<i32>,
    timestamp_ns: Vec<i64>,
    resumed: Vec<bool>,
    same_stop: Vec<bool>,
    other_stop: Vec<bool>,
    stopped: Vec<bool>,
    background: Vec<bool>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
) -> PyResult<(Vec<i64>, Vec<i64>, Vec<bool>)> {
    let output = match_app_usage_core(
        &app_codes,
        &timestamp_ns,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        &background,
        MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
    )
    .map_err(to_py_error)?;

    Ok((output.start_ns, output.stop_ns, output.missing))
}

#[allow(clippy::type_complexity)]
#[cfg(feature = "python")]
#[pyfunction]
fn match_app_usage_update_indices(
    app_codes: PyReadonlyArray1<'_, i32>,
    timestamp_ns: PyReadonlyArray1<'_, i64>,
    resumed: PyReadonlyArray1<'_, bool>,
    same_stop: PyReadonlyArray1<'_, bool>,
    other_stop: PyReadonlyArray1<'_, bool>,
    stopped: PyReadonlyArray1<'_, bool>,
    background: PyReadonlyArray1<'_, bool>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
) -> PyResult<(Vec<usize>, Vec<usize>, Vec<usize>, Vec<usize>)> {
    let output = match_app_usage_update_indices_core(
        app_codes.as_slice()?,
        timestamp_ns.as_slice()?,
        resumed.as_slice()?,
        same_stop.as_slice()?,
        other_stop.as_slice()?,
        stopped.as_slice()?,
        background.as_slice()?,
        MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
    )
    .map_err(to_py_error)?;

    Ok((
        output.start_indices,
        output.stop_start_indices,
        output.stop_event_indices,
        output.missing_indices,
    ))
}

#[allow(clippy::type_complexity)]
#[cfg(feature = "python")]
#[pyfunction]
fn match_app_usage_update_arrays<'py>(
    py: Python<'py>,
    app_codes: PyReadonlyArray1<'_, i32>,
    timestamp_ns: PyReadonlyArray1<'_, i64>,
    resumed: PyReadonlyArray1<'_, bool>,
    same_stop: PyReadonlyArray1<'_, bool>,
    other_stop: PyReadonlyArray1<'_, bool>,
    stopped: PyReadonlyArray1<'_, bool>,
    background: PyReadonlyArray1<'_, bool>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
) -> PyResult<(
    Bound<'py, PyArray1<usize>>,
    Bound<'py, PyArray1<usize>>,
    Bound<'py, PyArray1<usize>>,
    Bound<'py, PyArray1<usize>>,
)> {
    let output = match_app_usage_update_indices_core(
        app_codes.as_slice()?,
        timestamp_ns.as_slice()?,
        resumed.as_slice()?,
        same_stop.as_slice()?,
        other_stop.as_slice()?,
        stopped.as_slice()?,
        background.as_slice()?,
        MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
    )
    .map_err(to_py_error)?;

    Ok((
        output.start_indices.into_pyarray(py),
        output.stop_start_indices.into_pyarray(py),
        output.stop_event_indices.into_pyarray(py),
        output.missing_indices.into_pyarray(py),
    ))
}

#[cfg(feature = "python")]
#[pyfunction]
fn match_app_usage_arrays(
    app_codes: PyReadonlyArray1<'_, i32>,
    timestamp_ns: PyReadonlyArray1<'_, i64>,
    resumed: PyReadonlyArray1<'_, bool>,
    same_stop: PyReadonlyArray1<'_, bool>,
    other_stop: PyReadonlyArray1<'_, bool>,
    stopped: PyReadonlyArray1<'_, bool>,
    background: PyReadonlyArray1<'_, bool>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
) -> PyResult<(Vec<i64>, Vec<i64>, Vec<bool>)> {
    let app_codes = app_codes.as_slice()?;
    let timestamp_ns = timestamp_ns.as_slice()?;
    let resumed = resumed.as_slice()?;
    let same_stop = same_stop.as_slice()?;
    let other_stop = other_stop.as_slice()?;
    let stopped = stopped.as_slice()?;
    let background = background.as_slice()?;

    let output = match_app_usage_core(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
        MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
    )
    .map_err(to_py_error)?;

    Ok((output.start_ns, output.stop_ns, output.missing))
}

#[cfg(feature = "python")]
#[pyfunction]
fn split_overlapping_sessions_py(
    starts: PyReadonlyArray1<'_, i64>,
    stops: PyReadonlyArray1<'_, i64>,
) -> PyResult<(Vec<usize>, Vec<i64>, Vec<i64>, Vec<bool>)> {
    let rows =
        split_overlapping_sessions(starts.as_slice()?, stops.as_slice()?).map_err(to_py_error)?;
    let mut session_index = Vec::with_capacity(rows.len());
    let mut start_ns = Vec::with_capacity(rows.len());
    let mut stop_ns = Vec::with_capacity(rows.len());
    let mut is_primary = Vec::with_capacity(rows.len());
    for row in rows {
        session_index.push(row.session_index);
        start_ns.push(row.start_ns);
        stop_ns.push(row.stop_ns);
        is_primary.push(row.layer == UsageLayer::Primary);
    }
    Ok((session_index, start_ns, stop_ns, is_primary))
}

#[cfg(feature = "python")]
#[pymodule]
fn _rust_app_usage_matcher(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(match_app_usage, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_update_indices, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_update_arrays, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_arrays, m)?)?;
    m.add_function(wrap_pyfunction!(split_overlapping_sessions_py, m)?)?;
    Ok(())
}

#[cfg(test)]
mod forward_pairing_tests {
    use super::*;

    #[test]
    fn selected_nonresume_openers_do_not_become_parry_toth_handover_closers() {
        let output = match_app_usage_forward_pairing_with_openers_indices_core(
            &[1, 2, 3],
            &[0, 10, 20],
            &[true, true, true],
            &[false, false, true],
            &[false; 3],
            &[false; 3],
            &[false; 3],
        )
        .expect("separated opener signals should match");
        assert_eq!(output.start_indices, vec![0, 1, 2]);
        assert_eq!(output.stop_start_indices, vec![0, 1]);
        assert_eq!(output.stop_event_indices, vec![2, 2]);
        assert_eq!(output.missing_indices, vec![2]);
    }

    #[test]
    fn gesis_selected_openers_do_not_expand_the_legacy_repair_pool() {
        let output = match_app_usage_gesis_with_openers_indices_core(
            &[1, 1, 1],
            &[0, 10, 20],
            &[true, true, false],
            &[false, false, true],
            &[false; 3],
            &[true; 3],
            &[false; 3],
            1_000,
            10,
        )
        .expect("separated GESIS signals should match");
        assert_eq!(output.start_indices, vec![0, 1]);
        assert_eq!(output.stop_event_indices, vec![2, 2]);
        assert_eq!(
            output.stop_reasons,
            vec![
                EpisodeCloseReason::GesisOriginalStop,
                EpisodeCloseReason::GesisOriginalStop,
            ]
        );
    }

    const GESIS_TIMEOUT_NS: i64 = 600 * 1_000_000_000;

    /// Rows are `(app_code, timestamp_ns, is_start, is_stop, stop_matchable, is_android)`.
    fn run_gesis(rows: &[(i32, i64, bool, bool, bool, bool)]) -> MatchUpdateIndices {
        let app_codes: Vec<i32> = rows.iter().map(|row| row.0).collect();
        let timestamp_ns: Vec<i64> = rows.iter().map(|row| row.1).collect();
        let is_start: Vec<bool> = rows.iter().map(|row| row.2).collect();
        let is_stop: Vec<bool> = rows.iter().map(|row| row.3).collect();
        let stop_matchable: Vec<bool> = rows.iter().map(|row| row.4).collect();
        let android: Vec<bool> = rows.iter().map(|row| row.5).collect();
        match_app_usage_gesis_indices_core(
            &app_codes,
            &timestamp_ns,
            &is_start,
            &is_stop,
            &stop_matchable,
            &android,
            GESIS_TIMEOUT_NS,
            10,
        )
        .expect("gesis should succeed")
    }

    const S: i64 = 1_000_000_000;

    #[test]
    fn gesis_binds_a_run_of_same_app_stops_to_its_last_stop() {
        // Their `app_stops` drops a stop that is immediately followed by
        // another stop of the same app, so the start binds to the END of the
        // run. Taking the nearest stop instead moves the episode end AND
        // changes `events_between`, which can flip the tier.
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (1, 10 * S, false, true, true, false),
            (1, 40 * S, false, true, true, false),
        ]);
        assert_eq!(
            result.stop_event_indices,
            vec![2],
            "bound to the first stop of the run instead of its last"
        );
        assert_eq!(
            result.stop_reasons,
            vec![EpisodeCloseReason::GesisOriginalStop]
        );
    }

    #[test]
    fn gesis_closes_a_stopless_app_at_its_own_next_start() {
        // The published stop table is built from Start AND Stop rows and only
        // drops a row when the next same-app row is a Stop, so a Start stays in
        // it. An app that never stops therefore closes at its own next Start,
        // as an original stop — not at the next global event and not at the
        // timeout. This is the missing-stop case the rule exists to repair, so
        // getting it wrong would misreport exactly what the rule is for.
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (2, 5 * S, true, false, true, false),
            (1, 20 * S, true, false, true, false),
        ]);
        assert_eq!(result.start_indices, vec![0, 1, 2]);
        assert_eq!(result.stop_event_indices[0], 2);
        assert_eq!(
            result.stop_reasons[0],
            EpisodeCloseReason::GesisOriginalStop
        );
    }

    #[test]
    fn gesis_tier_one_takes_the_nearest_same_app_stop() {
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (1, 30 * S, false, true, true, false),
        ]);
        assert_eq!(result.stop_event_indices, vec![1]);
        assert_eq!(
            result.stop_reasons,
            vec![EpisodeCloseReason::GesisOriginalStop]
        );
        assert_eq!(result.stop_timestamps_ns, vec![None]);
    }

    #[test]
    fn gesis_falls_back_to_the_next_global_event_when_too_many_events_intervene() {
        // 11 filler events sit between the start and its same-app stop, which
        // exceeds the threshold of 10, so tier 1 is refused.
        let mut rows = vec![(1, 0, true, false, true, false)];
        for step in 1..=11 {
            rows.push((9, step * S, false, false, true, false));
        }
        rows.push((1, 12 * S, false, true, true, false));
        let result = run_gesis(&rows);
        assert_eq!(
            result.stop_reasons,
            vec![EpisodeCloseReason::GesisNextGlobalEvent]
        );
        assert_eq!(result.stop_event_indices, vec![1], "the next global event");
    }

    #[test]
    fn gesis_accepts_exactly_the_threshold_as_an_original_stop() {
        // The R's two branches overlap at exactly `event_threshold`, and
        // `case_when` resolves the tie to `original`. Pin that boundary.
        let mut rows = vec![(1, 0, true, false, true, false)];
        for step in 1..=10 {
            rows.push((9, step * S, false, false, true, false));
        }
        rows.push((1, 11 * S, false, true, true, false));
        let result = run_gesis(&rows);
        assert_eq!(
            result.stop_reasons,
            vec![EpisodeCloseReason::GesisOriginalStop],
            "exactly 10 intervening events must still count as original"
        );
    }

    #[test]
    fn gesis_cuts_at_the_timeout_when_nothing_else_is_close_enough() {
        // A lone start, then silence past the timeout.
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (9, 900 * S, false, false, true, false),
        ]);
        assert_eq!(result.stop_reasons, vec![EpisodeCloseReason::GesisTimeout]);
        assert_eq!(
            result.stop_timestamps_ns,
            vec![Some(GESIS_TIMEOUT_NS)],
            "the end is start + 600s, an instant no row carries"
        );
    }

    /// `delivery:B06` (`b06_gesis_600_equality`): the GESIS timeout is the
    /// strategy's own maximum and stays independent of any B06 selection. A
    /// next global event at exactly 600 s closes as an observed next-global
    /// event (`<=`); one nanosecond later the adapter synthesizes the timeout
    /// instant `start + 600 s`. Equal 600 s durations keep distinct reasons.
    #[test]
    fn gesis_next_global_equality_at_the_timeout_keeps_distinct_endpoint_provenance() {
        for (delta_ns, expect_reason, expect_stop) in [
            (
                GESIS_TIMEOUT_NS - 1,
                EpisodeCloseReason::GesisNextGlobalEvent,
                None,
            ),
            (
                GESIS_TIMEOUT_NS,
                EpisodeCloseReason::GesisNextGlobalEvent,
                None,
            ),
            (
                GESIS_TIMEOUT_NS + 1,
                EpisodeCloseReason::GesisTimeout,
                Some(GESIS_TIMEOUT_NS),
            ),
        ] {
            let result = run_gesis(&[
                (1, 0, true, false, true, false),
                (9, delta_ns, false, false, true, false),
            ]);
            assert_eq!(result.stop_start_indices, vec![0], "delta {delta_ns}");
            assert_eq!(result.stop_reasons, vec![expect_reason], "delta {delta_ns}");
            assert_eq!(
                result.stop_timestamps_ns,
                vec![expect_stop],
                "delta {delta_ns}"
            );
            // Observed closes point at the next-global row; the synthesized
            // timeout anchors on the start row and carries its own instant.
            assert_eq!(
                result.stop_event_indices,
                vec![if expect_stop.is_none() { 1 } else { 0 }],
                "delta {delta_ns}"
            );
        }
    }

    /// `delivery:B06` (`b06_gesis_i64_saturation_boundaries`): the adapter's
    /// `start + 600 s` and `next − start` are saturating, so a start within
    /// 600 s of `i64::MAX` yields a deterministic endpoint of `i64::MAX`
    /// (never a wrap), and a `MIN → MAX` next-global delta stays outside the
    /// next-global branch and closes at the exact timeout `MIN + 600 s`.
    #[test]
    fn gesis_saturates_deterministically_at_the_i64_endpoints() {
        for (start_ns, expect_stop) in [
            (i64::MIN, i64::MIN + GESIS_TIMEOUT_NS),
            (i64::MAX - GESIS_TIMEOUT_NS, i64::MAX),
            (i64::MAX - GESIS_TIMEOUT_NS + 1, i64::MAX),
            (i64::MAX, i64::MAX),
        ] {
            let result = run_gesis(&[(1, start_ns, true, false, true, false)]);
            assert_eq!(
                result.stop_reasons,
                vec![EpisodeCloseReason::GesisTimeout],
                "start {start_ns}"
            );
            assert_eq!(
                result.stop_timestamps_ns,
                vec![Some(expect_stop)],
                "start {start_ns}"
            );
        }
        let result = run_gesis(&[
            (1, i64::MIN, true, false, true, false),
            (9, i64::MAX, false, false, true, false),
        ]);
        assert_eq!(result.stop_reasons, vec![EpisodeCloseReason::GesisTimeout]);
        assert_eq!(
            result.stop_timestamps_ns,
            vec![Some(i64::MIN + GESIS_TIMEOUT_NS)]
        );
    }

    #[test]
    fn gesis_never_reports_an_episode_as_missing() {
        // Unlike every other rule here, the timeout tier always supplies an
        // end, so this rule cannot say "no end was observable".
        let result = run_gesis(&[(1, 0, true, false, true, false)]);
        assert!(result.missing_indices.is_empty());
        assert_eq!(result.stop_reasons, vec![EpisodeCloseReason::GesisTimeout]);
    }

    #[test]
    fn gesis_lets_a_later_same_app_start_close_an_episode() {
        // Their stop table is built from Start-or-Stop rows, so a same-app
        // Start can act as the stop. This looks accidental and is reproduced
        // because it is what their published code does.
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (1, 30 * S, true, true, true, false),
        ]);
        assert_eq!(result.stop_event_indices, vec![1, 1]);
        assert_eq!(
            result.stop_reasons[0],
            EpisodeCloseReason::GesisOriginalStop
        );
    }

    #[test]
    fn gesis_will_not_open_an_episode_on_the_android_pseudo_package() {
        let result = run_gesis(&[
            (9, 0, true, false, true, true),
            (1, 30 * S, true, false, true, false),
        ]);
        assert_eq!(result.start_indices, vec![1]);
    }

    #[test]
    fn gesis_skips_unmatchable_stops_when_choosing_an_original_stop() {
        // Type 10 (notification seen) is classified a stop but excluded from
        // their stop table, while remaining eligible as the next global event.
        let result = run_gesis(&[
            (1, 0, true, false, true, false),
            (1, 10 * S, false, true, false, false),
            (1, 20 * S, false, true, true, false),
        ]);
        assert_eq!(
            result.stop_event_indices,
            vec![2],
            "the unmatchable stop at index 1 must not be chosen"
        );
    }

    #[test]
    fn an_assumed_label_marks_exactly_the_ends_the_log_did_not_contain() {
        // The prefix is load-bearing, not decoration: it is the only thing in
        // the cell separating a repaired end from a real one. If a reason is
        // ever added on the wrong side of this list the column starts
        // reporting inferences as observations, silently.
        for reason in EpisodeCloseReason::ALL {
            let inferred = matches!(
                reason,
                EpisodeCloseReason::GesisNextGlobalEvent
                    | EpisodeCloseReason::GesisTimeout
                    | EpisodeCloseReason::EyesNextBlockAssumed
                    // The log contains nothing at this instant — that absence
                    // IS the rule. `ScreenLockedPastTimeout` deliberately sits
                    // on the other side: its end is a real screen-off row, and
                    // only the decision to honour it was inferred.
                    | EpisodeCloseReason::DraxlerInactivityTimeout
            );
            assert_eq!(
                reason.output_label().starts_with("assumed_"),
                inferred,
                "{:?} carries {:?}, which disagrees with whether the log actually ended it",
                reason,
                reason.output_label()
            );
        }
    }

    #[test]
    fn reasons_sharing_an_output_label_describe_the_same_observation() {
        // Three rules can each find the app's own stop event. The reader wants
        // the fact, not the finder, so the labels collapse — but lineage must
        // still tell them apart, or provenance loses which rule ran.
        let shared = [
            EpisodeCloseReason::SameAppStop,
            EpisodeCloseReason::GesisOriginalStop,
            EpisodeCloseReason::EyesTripletClose,
        ];
        for reason in shared {
            assert_eq!(reason.output_label(), "same_app_stop_event");
        }
        let mut lineage: Vec<&str> = shared.iter().map(|r| r.lineage_reason()).collect();
        lineage.sort_unstable();
        lineage.dedup();
        assert_eq!(
            lineage.len(),
            shared.len(),
            "collapsing the output label must not collapse provenance"
        );
    }

    #[test]
    fn no_output_label_names_the_rule_that_produced_it() {
        // A data cell is not a citation. The reader is looking at their own
        // study's numbers; making them decode a tool or paper name to find out
        // whether an episode really ended is a cost the column exists to
        // remove. The rule is already recorded once, as the selected option.
        const BRANDS: &[&str] = &[
            "gesis",
            "eyes",
            "zerrer",
            "parry",
            "toth",
            "culverhouse",
            "chronicle",
        ];
        for reason in EpisodeCloseReason::ALL {
            let label = reason.output_label().to_ascii_lowercase();
            for brand in BRANDS {
                assert!(
                    !label.contains(brand),
                    "output label {:?} names {brand}, so the cell cites a rule instead of \
                     describing what happened to the device",
                    reason.output_label()
                );
            }
        }
    }

    #[test]
    fn an_output_label_is_never_a_lineage_string() {
        // Both layers are lowercase now, so the separation rests on the
        // separator: lineage is kebab-case, output cells are snake_case. A
        // label that grew a hyphen would read as a provenance identifier in a
        // researcher's spreadsheet and a later rename would couple the two.
        for reason in EpisodeCloseReason::ALL {
            let label = reason.output_label();
            assert_ne!(label, reason.lineage_reason());
            assert!(!label.contains('-'), "{label} reads like a lineage string");
            assert!(
                label.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{label} is not snake_case, so it does not match screen_usage_end_reason"
            );
        }
    }

    #[test]
    fn every_close_reason_round_trips_through_its_lineage_string() {
        for &reason in EpisodeCloseReason::ALL {
            assert_eq!(
                EpisodeCloseReason::from_lineage_reason(reason.lineage_reason()),
                Some(reason),
                "{reason:?} does not survive a round trip"
            );
        }
    }

    #[test]
    fn lineage_strings_are_distinct_and_kebab_case() {
        // Two reasons sharing a string would silently merge in a trace, and the
        // values sit beside `selected-qualifying-stop` in
        // `LineageSearchEvidence.reason`, which is kebab. Snake here would be
        // the contract-option layer's convention, not this one.
        let mut seen = Vec::new();
        for &reason in EpisodeCloseReason::ALL {
            let text = reason.lineage_reason();
            assert!(
                !text.is_empty()
                    && text
                        .chars()
                        .all(|character| character.is_ascii_lowercase() || character == '-'),
                "{text} is not kebab-case"
            );
            assert!(!seen.contains(&text), "{text} is used by two reasons");
            seen.push(text);
        }
    }

    #[test]
    fn an_unknown_lineage_string_is_rejected_rather_than_guessed() {
        // Deliberately unlike the option decoders, which fall back to the
        // production path. Guessing here would fabricate provenance.
        assert_eq!(
            EpisodeCloseReason::from_lineage_reason("same_app_stop"),
            None
        );
        assert_eq!(EpisodeCloseReason::from_lineage_reason(""), None);
    }

    /// Rows are `(app_code, timestamp_ns, resumed, paused, screen_off, is_android)`.
    fn run_forward_pairing(rows: &[(i32, i64, bool, bool, bool, bool)]) -> MatchUpdateIndices {
        let app_codes: Vec<i32> = rows.iter().map(|row| row.0).collect();
        let timestamp_ns: Vec<i64> = rows.iter().map(|row| row.1).collect();
        let resumed: Vec<bool> = rows.iter().map(|row| row.2).collect();
        let paused: Vec<bool> = rows.iter().map(|row| row.3).collect();
        let screen_off: Vec<bool> = rows.iter().map(|row| row.4).collect();
        let android: Vec<bool> = rows.iter().map(|row| row.5).collect();
        match_app_usage_forward_pairing_indices_core(
            &app_codes,
            &timestamp_ns,
            &resumed,
            &paused,
            &screen_off,
            &android,
        )
        .expect("forward pairing should succeed")
    }

    /// Closer 3. Also the only closer the pre-2026-08-08 implementation had.
    #[test]
    fn a_different_package_taking_the_foreground_ends_the_episode() {
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (2, 100, true, false, false, false),
        ]);
        assert_eq!(result.start_indices, vec![0, 1]);
        assert_eq!(result.stop_start_indices, vec![0]);
        assert_eq!(result.stop_event_indices, vec![1]);
        assert_eq!(result.missing_indices, vec![1]);
    }

    /// Closer 1, and the reason the arm exists in this shape. Without it an
    /// overnight episode runs to the next morning's first foreground event.
    #[test]
    fn the_screen_going_off_ends_the_episode() {
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (0, 50, false, false, true, false),
            // Nine hours later, the next morning. Under the one-closer reading
            // this row — not the screen-off — would have ended the episode.
            (2, 32_400, true, false, false, false),
        ]);
        assert_eq!(result.stop_start_indices, vec![0]);
        assert_eq!(
            result.stop_event_indices,
            vec![1],
            "the episode must end at the screen-off, not at the next resume"
        );
    }

    /// Closer 2.
    #[test]
    fn the_same_package_moving_to_the_background_ends_the_episode() {
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (1, 50, false, true, false, false),
            (2, 100, true, false, false, false),
        ]);
        assert_eq!(result.stop_start_indices, vec![0]);
        assert_eq!(result.stop_event_indices, vec![1]);
    }

    #[test]
    fn a_different_package_pausing_does_not_end_the_episode() {
        // Closer 2 is package-scoped: only the episode's own app pausing counts.
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (2, 50, false, true, false, false),
            (3, 100, true, false, false, false),
        ]);
        assert_eq!(result.stop_start_indices, vec![0]);
        assert_eq!(result.stop_event_indices, vec![2]);
    }

    #[test]
    fn activity_stopped_never_ends_an_episode_on_its_own() {
        // Type 23 is not among the three closers. With nothing else following,
        // the episode has no observable end at all.
        let result = run_forward_pairing(&[(1, 0, true, false, false, false)]);
        assert_eq!(result.start_indices, vec![0]);
        assert!(result.stop_start_indices.is_empty());
        assert_eq!(result.missing_indices, vec![0]);
    }

    #[test]
    fn consecutive_same_package_resumes_each_open_an_episode() {
        // No Step-6 collapse: the reference implementation defers merging to its
        // downstream cleaning pass. Each resume opens, and the next same-package
        // resume does NOT close (closer 3 requires a *different* package), so
        // all three run to the type-2 row.
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (1, 10, true, false, false, false),
            (1, 20, true, false, false, false),
            (2, 30, true, false, false, false),
        ]);
        assert_eq!(result.start_indices, vec![0, 1, 2, 3]);
        assert_eq!(result.stop_event_indices, vec![3, 3, 3]);
        assert_eq!(result.missing_indices, vec![3]);
    }

    #[test]
    fn the_android_pseudo_package_can_close_an_episode_but_never_open_one() {
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (9, 50, true, false, false, true),
        ]);
        assert_eq!(
            result.start_indices,
            vec![0],
            "the android row must not open an episode"
        );
        assert_eq!(
            result.stop_event_indices,
            vec![1],
            "but it must still close the one that was open"
        );
    }

    #[test]
    fn an_unclosed_episode_is_reported_missing_rather_than_extended() {
        let result = run_forward_pairing(&[
            (1, 0, true, false, false, false),
            (2, 10, true, false, false, false),
        ]);
        assert_eq!(result.missing_indices, vec![1]);
    }

    #[test]
    fn no_events_yields_no_episodes() {
        let result = run_forward_pairing(&[]);
        assert!(result.start_indices.is_empty());
        assert!(result.missing_indices.is_empty());
    }

    #[test]
    fn rows_that_are_not_resumes_are_ignored_entirely() {
        let result = run_forward_pairing(&[
            (1, 0, false, false, false, false),
            (1, 10, false, true, false, false),
            (2, 20, false, false, true, false),
        ]);
        assert!(result.start_indices.is_empty());
    }

    #[test]
    fn mismatched_input_lengths_are_rejected() {
        let error = match_app_usage_forward_pairing_indices_core(
            &[1, 2],
            &[0],
            &[true, true],
            &[false, false],
            &[false, false],
            &[false, false],
        );
        assert!(error.is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        app_codes: &[i32],
        timestamp_ns: &[i64],
        resumed: &[bool],
        same_stop: &[bool],
        other_stop: &[bool],
        stopped: &[bool],
        options: MatchOptions,
    ) -> MatchOutput {
        let background = vec![false; app_codes.len()];
        match_app_usage_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
            &background,
            options,
        )
        .expect("core matcher should succeed")
    }

    fn run_update_indices(
        app_codes: &[i32],
        timestamp_ns: &[i64],
        resumed: &[bool],
        same_stop: &[bool],
        other_stop: &[bool],
        stopped: &[bool],
        options: MatchOptions,
    ) -> MatchUpdateIndices {
        let background = vec![false; app_codes.len()];
        match_app_usage_update_indices_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
            &background,
            options,
        )
        .expect("sparse matcher should succeed")
    }

    fn reconstruct_sparse_output(
        len: usize,
        timestamp_ns: &[i64],
        updates: MatchUpdateIndices,
    ) -> MatchOutput {
        let mut start_ns = vec![-1; len];
        let mut stop_ns = vec![-1; len];
        let mut missing = vec![false; len];

        for start_index in updates.start_indices {
            start_ns[start_index] = timestamp_ns[start_index];
        }
        for (start_index, stop_index) in updates
            .stop_start_indices
            .into_iter()
            .zip(updates.stop_event_indices)
        {
            stop_ns[start_index] = timestamp_ns[stop_index];
        }
        for missing_index in updates.missing_indices {
            missing[missing_index] = true;
        }

        MatchOutput {
            start_ns,
            stop_ns,
            missing,
        }
    }

    fn base_flags(len: usize) -> (Vec<bool>, Vec<bool>, Vec<bool>, Vec<bool>) {
        (
            vec![false; len],
            vec![false; len],
            vec![false; len],
            vec![false; len],
        )
    }

    #[test]
    fn every_input_array_length_is_validated_independently() {
        let app_codes = [1];
        let timestamps = [0];
        let flags = [false];
        assert_eq!(
            validate_lengths(
                &app_codes,
                &timestamps,
                &flags,
                &flags,
                &flags,
                &flags,
                &flags,
            ),
            Ok(1),
        );

        for short_index in 0..6 {
            let empty_i64: &[i64] = &[];
            let empty_bool: &[bool] = &[];
            let result = validate_lengths(
                &app_codes,
                if short_index == 0 {
                    empty_i64
                } else {
                    &timestamps
                },
                if short_index == 1 { empty_bool } else { &flags },
                if short_index == 2 { empty_bool } else { &flags },
                if short_index == 3 { empty_bool } else { &flags },
                if short_index == 4 { empty_bool } else { &flags },
                if short_index == 5 { empty_bool } else { &flags },
            );
            assert!(
                result.is_err(),
                "input array {short_index} was not validated"
            );
        }
    }

    #[test]
    fn stop_compatibility_covers_same_other_background_fallback_and_threshold_boundaries() {
        let app_codes = [1, 2];
        let timestamps = [10, 20];
        let none = [false, false];
        let stop_at_one = [false, true];
        let foreground = [false, false];
        let background_start = [true, false];
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 10,
        };

        assert!(!is_compatible_open_start_for_stop(
            1,
            0,
            &app_codes,
            &timestamps,
            &stop_at_one,
            &none,
            &none,
            &foreground,
            options,
        ));
        assert!(is_compatible_open_start_for_stop(
            1,
            0,
            &app_codes,
            &timestamps,
            &none,
            &stop_at_one,
            &none,
            &foreground,
            options,
        ));
        assert!(!is_compatible_open_start_for_stop(
            1,
            0,
            &app_codes,
            &timestamps,
            &none,
            &stop_at_one,
            &none,
            &background_start,
            options,
        ));

        let same_app_codes = [2, 2];
        assert!(is_compatible_open_start_for_stop(
            1,
            0,
            &same_app_codes,
            &timestamps,
            &stop_at_one,
            &none,
            &none,
            &foreground,
            options,
        ));
        assert!(is_compatible_open_start_for_stop(
            1,
            0,
            &same_app_codes,
            &timestamps,
            &none,
            &none,
            &stop_at_one,
            &foreground,
            options,
        ));
        let too_late = [10, 21];
        assert!(!is_compatible_open_start_for_stop(
            1,
            0,
            &same_app_codes,
            &too_late,
            &none,
            &none,
            &stop_at_one,
            &foreground,
            options,
        ));
        let fallback_without_threshold = MatchOptions {
            apply_threshold_to_fallback: false,
            ..options
        };
        assert!(is_compatible_open_start_for_stop(
            1,
            0,
            &same_app_codes,
            &too_late,
            &none,
            &none,
            &stop_at_one,
            &foreground,
            fallback_without_threshold,
        ));
        let fallback_disabled = MatchOptions {
            use_activity_stopped_as_fallback: false,
            ..options
        };
        assert!(!is_compatible_open_start_for_stop(
            1,
            0,
            &same_app_codes,
            &timestamps,
            &none,
            &none,
            &stop_at_one,
            &foreground,
            fallback_disabled,
        ));
    }

    #[test]
    fn sparse_stop_classification_is_exhaustive() {
        let off = [false];
        let on = [true];
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: 1,
        };
        assert_eq!(sparse_stop_mode(0, &off, &off, &off, options), None);
        assert_eq!(
            sparse_stop_mode(0, &on, &off, &off, options),
            Some(SparseStopMode::SameApp),
        );
        assert_eq!(
            sparse_stop_mode(0, &off, &on, &off, options),
            Some(SparseStopMode::OtherApp),
        );
        assert_eq!(
            sparse_stop_mode(0, &on, &on, &off, options),
            Some(SparseStopMode::AnyApp),
        );
        assert_eq!(
            sparse_stop_mode(0, &off, &off, &on, options),
            Some(SparseStopMode::FallbackSameApp),
        );
        assert!(!sparse_stop_enforces_threshold(
            SparseStopMode::FallbackSameApp,
            options,
        ));
        assert!(sparse_stop_enforces_threshold(
            SparseStopMode::FallbackSameApp,
            MatchOptions {
                apply_threshold_to_fallback: true,
                ..options
            },
        ));
        assert!(sparse_stop_enforces_threshold(
            SparseStopMode::SameApp,
            options,
        ));
    }

    #[test]
    fn proximity_ignores_intra_app_teardown_after_reresume() {
        let app_codes = [1, 1, 1, 1, 1];
        let timestamps = [0, 100, 150, 200, 1_000];
        let resumed = [true, false, true, false, false];
        let same_stop = [false, true, false, false, true];
        let other_stop = [false; 5];
        let stopped = [false, false, false, true, false];
        let background = [false; 5];
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 10_000,
        };

        let output = match_app_usage_update_indices_with_proximity_core(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
            200,
        )
        .unwrap();
        assert_eq!(output.start_indices, vec![0, 2]);
        assert_eq!(output.stop_start_indices, vec![0, 2]);
        assert_eq!(output.stop_event_indices, vec![1, 4]);
        assert!(output.missing_indices.is_empty());

        let without_proximity = match_app_usage_update_indices_with_proximity_core(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
            0,
        )
        .unwrap();
        assert_eq!(without_proximity.stop_event_indices, vec![1, 3]);
    }

    #[test]
    fn negative_proximity_fails_closed() {
        let error = match_app_usage_update_indices_with_proximity_core(
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 1,
            },
            -1,
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "proximity_ns must be non-negative");
    }

    #[test]
    fn sorted_sparse_proximity_matches_the_legacy_oracle_across_random_inputs() {
        struct Lcg(u64);

        impl Lcg {
            fn next(&mut self) -> u64 {
                self.0 = self
                    .0
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                self.0
            }

            fn flag(&mut self, one_in: u64) -> bool {
                self.next().is_multiple_of(one_in)
            }
        }

        let mut random = Lcg(0x4348_524f_4e49_434c);
        for case_index in 0..2_000 {
            let len = (random.next() % 160) as usize;
            let mut timestamp_ns = Vec::with_capacity(len);
            let mut timestamp = 0_i64;
            for _ in 0..len {
                // Includes equal timestamps and exact threshold/proximity
                // boundaries; the optimized path only requires nondecreasing
                // event order.
                timestamp += (random.next() % 9) as i64;
                timestamp_ns.push(timestamp);
            }
            let app_codes = (0..len)
                .map(|_| (random.next() % 7) as i32)
                .collect::<Vec<_>>();
            let resumed = (0..len).map(|_| random.flag(3)).collect::<Vec<_>>();
            let same_stop = (0..len).map(|_| random.flag(4)).collect::<Vec<_>>();
            let other_stop = (0..len).map(|_| random.flag(5)).collect::<Vec<_>>();
            let stopped = (0..len).map(|_| random.flag(4)).collect::<Vec<_>>();
            let background = (0..len).map(|_| random.flag(5)).collect::<Vec<_>>();
            let options = MatchOptions {
                allow_stop_event_reuse: random.flag(2),
                use_activity_stopped_as_fallback: random.flag(2),
                apply_threshold_to_fallback: random.flag(2),
                long_duration_threshold_ns: (random.next() % 80) as i64,
            };
            let proximity_ns = 1 + (random.next() % 20) as i64;

            let expected = match_legacy_app_usage_update_indices_with_proximity(
                &app_codes,
                &timestamp_ns,
                &resumed,
                &resumed,
                &same_stop,
                &other_stop,
                &stopped,
                &background,
                options,
                proximity_ns,
            )
            .expect("legacy oracle should accept generated input");
            let actual = match_sorted_app_usage_update_indices_with_proximity(
                &app_codes,
                &timestamp_ns,
                &resumed,
                &resumed,
                &same_stop,
                &other_stop,
                &stopped,
                &background,
                options,
                proximity_ns,
            )
            .expect("sorted sparse matcher should accept generated input");

            assert_eq!(actual, expected, "randomized case {case_index}");
        }
    }

    #[test]
    fn same_app_stop_closes_session() {
        let app_codes = [1, 1];
        let timestamps = [0, 300];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.1[1] = true;

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(output.start_ns, vec![0, -1]);
        assert_eq!(output.stop_ns, vec![300, -1]);
        assert_eq!(output.missing, vec![false, false]);
    }

    #[test]
    fn other_app_stop_closes_session() {
        let app_codes = [10, 20];
        let timestamps = [0, 500];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true;

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(output.start_ns, vec![0, -1]);
        assert_eq!(output.stop_ns, vec![500, -1]);
        assert_eq!(output.missing, vec![false, false]);
    }

    #[test]
    fn fallback_threshold_blocks_overlong_activity_stopped() {
        let app_codes = [7, 7];
        let timestamps = [0, 13 * 60 * 60 * 1_000_000_000];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.3[1] = true;

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.3,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 12 * 60 * 60 * 1_000_000_000,
            },
        );

        assert_eq!(output.start_ns, vec![0, -1]);
        assert_eq!(output.stop_ns, vec![-1, -1]);
        assert_eq!(output.missing, vec![true, false]);
    }

    /// `delivery:B06` legacy arm (`chronicle_observed_close_rejection_v1`):
    /// an observed same-app close is admissible only when the implied
    /// duration is at most the legacy maximum — strictly greater rejects the
    /// candidate and the episode surfaces as End of Usage Missing. Equality
    /// is retained. Pinned so the explicit B06 arm names exactly this rule.
    #[test]
    fn chronicle_candidate_admissibility_is_strictly_above_the_legacy_maximum() {
        let threshold_ns = 60 * 1_000_000_000;
        for (label, delta_ns, expect_closed) in [
            ("T-1", threshold_ns - 1, true),
            ("T", threshold_ns, true),
            ("T+1", threshold_ns + 1, false),
        ] {
            let app_codes = [7, 7];
            let timestamps = [0, delta_ns];
            let resumed = [true, false];
            let mut flags = base_flags(2);
            flags.0[1] = true; // same-app stop (Activity Paused)
            let output = run(
                &app_codes,
                &timestamps,
                &resumed,
                &flags.0,
                &flags.1,
                &flags.3,
                MatchOptions {
                    allow_stop_event_reuse: false,
                    use_activity_stopped_as_fallback: true,
                    apply_threshold_to_fallback: true,
                    long_duration_threshold_ns: threshold_ns,
                },
            );
            assert_eq!(output.start_ns, vec![0, -1], "{label}");
            if expect_closed {
                assert_eq!(output.stop_ns, vec![delta_ns, -1], "{label}: retained");
                assert_eq!(output.missing, vec![false, false], "{label}");
            } else {
                assert_eq!(output.stop_ns, vec![-1, -1], "{label}: candidate rejected");
                assert_eq!(
                    output.missing,
                    vec![true, false],
                    "{label}: End of Usage Missing"
                );
            }
        }
    }

    /// The nonnegative-duration requirement is an ordering rule, not a
    /// maximum: a same-app stop that precedes its start never closes it,
    /// whatever the legacy maximum is.
    #[test]
    fn negative_candidate_durations_remain_an_ordering_failure_not_a_maximum() {
        // Stop event listed before the start it would otherwise close.
        let app_codes = [7, 7, 7];
        let timestamps = [0, 5, 10];
        let resumed = [false, true, false];
        let mut flags = base_flags(3);
        flags.0[0] = true;
        flags.0[2] = true;
        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.3,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: i64::MAX,
            },
        );
        // The earlier stop closes nothing; the later one closes the start at 5.
        assert_eq!(output.start_ns, vec![-1, 5, -1]);
        assert_eq!(output.stop_ns, vec![-1, 10, -1]);
        assert_eq!(output.missing, vec![false, false, false]);
    }

    /// The end-of-stream closure is bounded by the same rule as an observed
    /// candidate: a last event exactly T after the opener closes it, one
    /// nanosecond later leaves it missing — no query-end is invented.
    #[test]
    fn the_end_of_stream_candidate_uses_the_exact_legacy_rule() {
        let threshold_ns = 60 * 1_000_000_000;
        for (label, delta_ns, expect_closed) in
            [("T", threshold_ns, true), ("T+1", threshold_ns + 1, false)]
        {
            let app_codes = [3, 9];
            let timestamps = [0, delta_ns];
            let resumed = [true, false];
            let flags = base_flags(2);
            let output = run(
                &app_codes,
                &timestamps,
                &resumed,
                &flags.0,
                &flags.1,
                &flags.2,
                MatchOptions {
                    allow_stop_event_reuse: false,
                    use_activity_stopped_as_fallback: true,
                    apply_threshold_to_fallback: true,
                    long_duration_threshold_ns: threshold_ns,
                },
            );
            assert_eq!(output.start_ns, vec![0, -1], "{label}");
            if expect_closed {
                assert_eq!(output.stop_ns, vec![delta_ns, -1], "{label}");
                assert_eq!(output.missing, vec![false, false], "{label}");
            } else {
                assert_eq!(output.stop_ns, vec![-1, -1], "{label}");
                assert_eq!(output.missing, vec![true, false], "{label}");
            }
        }
    }

    /// Fallback enablement (`use_activity_stopped_as_fallback`) and threshold
    /// application (`apply_threshold_to_fallback`) are independent controls.
    #[test]
    fn fallback_enablement_and_threshold_application_are_independent_controls() {
        let threshold_ns = 60 * 1_000_000_000;
        let over = threshold_ns + 1;
        for (use_fallback, apply_threshold, expect_stop, expect_missing) in [
            // Fallback disabled: the Activity Stopped never closes; the
            // episode stays open until the file end, which is also over T.
            (false, false, -1, true),
            (false, true, -1, true),
            // Fallback enabled without the threshold: over-long close accepted.
            (true, false, over, false),
            // Fallback enabled with the threshold: over-long close rejected.
            (true, true, -1, true),
        ] {
            let app_codes = [7, 7];
            let timestamps = [0, over];
            let resumed = [true, false];
            let mut flags = base_flags(2);
            flags.3[1] = true; // Activity Stopped
            let output = run(
                &app_codes,
                &timestamps,
                &resumed,
                &flags.0,
                &flags.1,
                &flags.3,
                MatchOptions {
                    allow_stop_event_reuse: false,
                    use_activity_stopped_as_fallback: use_fallback,
                    apply_threshold_to_fallback: apply_threshold,
                    long_duration_threshold_ns: threshold_ns,
                },
            );
            assert_eq!(
                (output.stop_ns[0], output.missing[0]),
                (expect_stop, expect_missing),
                "use_fallback={use_fallback} apply_threshold={apply_threshold}"
            );
        }
    }

    #[test]
    fn file_end_closure_uses_last_timestamp() {
        let app_codes = [3, 9];
        let timestamps = [0, 10 * 60 * 1_000_000_000];
        let resumed = [true, false];
        let flags = base_flags(2);

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 12 * 60 * 60 * 1_000_000_000,
            },
        );

        assert_eq!(output.start_ns, vec![0, -1]);
        assert_eq!(output.stop_ns, vec![10 * 60 * 1_000_000_000, -1]);
        assert_eq!(output.missing, vec![false, false]);
    }

    #[test]
    fn missing_end_marks_open_start() {
        let app_codes = [42];
        let timestamps = [0];
        let resumed = [true];
        let flags = base_flags(1);

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 12 * 60 * 60 * 1_000_000_000,
            },
        );

        assert_eq!(output.start_ns, vec![0]);
        assert_eq!(output.stop_ns, vec![-1]);
        assert_eq!(output.missing, vec![true]);
    }

    #[test]
    fn stop_reuse_enabled_closes_all_compatible_starts() {
        let app_codes = [1, 1, 1, 1];
        let timestamps = [0, 60, 300, 360];
        let resumed = [true, true, false, false];
        let mut flags = base_flags(4);
        flags.0[2] = true;

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(output.stop_ns, vec![300, 300, -1, -1]);
    }

    #[test]
    fn stop_reuse_disabled_uses_nearest_compatible_start() {
        let app_codes = [1, 1, 1, 9];
        let timestamps = [0, 60, 300, 360];
        let resumed = [true, true, false, false];
        let mut flags = base_flags(4);
        flags.0[2] = true;

        let output = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(output.stop_ns, vec![360, 300, -1, -1]);
    }

    #[test]
    fn sparse_update_indices_reconstruct_dense_output() {
        let app_codes = [1, 2, 1, 2, 1, 3, 3];
        let timestamps = [0, 50, 100, 180, 240, 400, 500];
        let resumed = [true, true, false, false, true, true, false];
        let same_stop = [false, false, true, false, false, false, true];
        let other_stop = [false, false, false, true, false, false, false];
        let stopped = [false, false, false, false, false, false, false];
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 1_000,
        };

        let dense = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            options,
        );
        let sparse = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            options,
        );

        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            dense
        );
    }

    #[test]
    fn sparse_update_indices_with_stop_reuse_reconstruct_dense_output() {
        let app_codes = [1, 1, 2, 1, 2, 3, 3, 1];
        let timestamps = [0, 50, 100, 150, 200, 250, 300, 400];
        let resumed = [true, true, true, false, false, true, false, false];
        let same_stop = [false, false, false, true, false, false, true, false];
        let other_stop = [false, false, false, false, true, false, false, true];
        let stopped = [false, false, false, false, false, false, false, false];
        let options = MatchOptions {
            allow_stop_event_reuse: true,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 1_000,
        };

        let dense = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            options,
        );
        let sparse = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            options,
        );

        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            dense
        );
    }

    // ── background-app tests ────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn run_bg(
        app_codes: &[i32],
        timestamp_ns: &[i64],
        resumed: &[bool],
        same_stop: &[bool],
        other_stop: &[bool],
        stopped: &[bool],
        background: &[bool],
        options: MatchOptions,
    ) -> MatchOutput {
        match_app_usage_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
        )
        .expect("core matcher should succeed")
    }

    #[allow(clippy::too_many_arguments)]
    fn run_update_indices_bg(
        app_codes: &[i32],
        timestamp_ns: &[i64],
        resumed: &[bool],
        same_stop: &[bool],
        other_stop: &[bool],
        stopped: &[bool],
        background: &[bool],
        options: MatchOptions,
    ) -> MatchUpdateIndices {
        match_app_usage_update_indices_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
            background,
            options,
        )
        .expect("sparse matcher should succeed")
    }

    fn background_options() -> MatchOptions {
        MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: true,
            long_duration_threshold_ns: 24 * 60 * 60 * 1_000_000_000,
        }
    }

    #[test]
    fn background_app_survives_other_stop_and_closes_on_same_stop() {
        // index 0: background app S (code 1) resumes at t=0
        // index 1: app N (code 2) resumes at t=100 with an other-stop that would
        //          normally close S
        // index 2: S's (caller-remapped) Activity Stopped arrives as a same-app
        //          stop at t=300
        let app_codes = [1, 2, 1];
        let timestamps = [0, 100, 300];
        let resumed = [true, true, false];
        let same_stop = [false, false, true];
        let other_stop = [false, true, false];
        let stopped = [false, false, false];
        let background = [true, false, true];
        let options = background_options();

        let output = run_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        // S survived N's other-stop (stop=300, not 100); N runs to file end (300).
        assert_eq!(output.start_ns, vec![0, 100, -1]);
        assert_eq!(output.stop_ns, vec![300, 300, -1]);
        assert_eq!(output.missing, vec![false, false, false]);

        // Sparse path agrees with dense.
        let sparse = run_update_indices_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            output
        );
    }

    #[test]
    fn non_background_app_is_closed_by_other_stop() {
        // Same events, but S is not a background app: N's other-stop closes it at 100.
        let app_codes = [1, 2, 1];
        let timestamps = [0, 100, 300];
        let resumed = [true, true, false];
        let same_stop = [false, false, true];
        let other_stop = [false, true, false];
        let stopped = [false, false, false];
        let background = [false, false, false];
        let options = background_options();

        let output = run_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        assert_eq!(output.start_ns, vec![0, 100, -1]);
        assert_eq!(output.stop_ns, vec![100, 300, -1]);

        let sparse = run_update_indices_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            output
        );
    }

    #[test]
    fn background_only_protects_against_other_stop_with_reuse() {
        // With stop-event reuse on, a foreground app N's other-stop still must not
        // close the background app S, while a non-background app B (code 3) is
        // closed by it.
        let app_codes = [1, 3, 2];
        let timestamps = [0, 50, 100];
        let resumed = [true, true, false];
        let same_stop = [false, false, false];
        let other_stop = [false, false, true];
        let stopped = [false, false, false];
        let background = [true, false, false];
        let options = MatchOptions {
            allow_stop_event_reuse: true,
            ..background_options()
        };

        let output = run_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        // index 2 (app 2) other-stop closes B (code 3) but not S (code 1, background).
        // S stays open -> file-end closure at last timestamp (100).
        assert_eq!(output.start_ns, vec![0, 50, -1]);
        assert_eq!(output.stop_ns, vec![100, 100, -1]);

        let sparse = run_update_indices_bg(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &stopped,
            &background,
            options,
        );
        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            output
        );
    }

    // ── split_overlapping_sessions tests ────────────────────────────────────

    fn split(starts: &[i64], stops: &[i64]) -> Vec<LayeredSession> {
        split_overlapping_sessions(starts, stops).expect("split should succeed")
    }

    /// The original O(N^2) boundary-rescan implementation, kept verbatim as the
    /// byte-for-byte reference oracle for the sweep-line rewrite. The fuzz test
    /// below proves the optimized `split_overlapping_sessions` matches this on
    /// thousands of random inputs plus edge cases — a self-contained gate that does
    /// not depend on the Python mirror or the WASM/PyO3 build (which can silently
    /// skip). Do NOT "optimize" this; its only job is to be obviously correct.
    fn reference_split(starts: &[i64], stops: &[i64]) -> Vec<LayeredSession> {
        let mut boundaries: Vec<i64> = Vec::with_capacity(starts.len() * 2);
        boundaries.extend_from_slice(starts);
        boundaries.extend_from_slice(stops);
        boundaries.sort_unstable();
        boundaries.dedup();

        let mut raw: Vec<LayeredSession> = Vec::new();
        for window in boundaries.windows(2) {
            let (t0, t1) = (window[0], window[1]);
            if t1 <= t0 {
                continue;
            }
            let mut open: Vec<usize> = Vec::new();
            for i in 0..starts.len() {
                if starts[i] <= t0 && stops[i] >= t1 {
                    open.push(i);
                }
            }
            if open.is_empty() {
                continue;
            }
            let primary = *open
                .iter()
                .max_by(|&&a, &&b| starts[a].cmp(&starts[b]).then(a.cmp(&b)))
                .expect("open is non-empty");
            for &i in &open {
                raw.push(LayeredSession {
                    session_index: i,
                    start_ns: t0,
                    stop_ns: t1,
                    layer: if i == primary {
                        UsageLayer::Primary
                    } else {
                        UsageLayer::Secondary
                    },
                });
            }
        }

        raw.sort_by(|a, b| {
            a.session_index
                .cmp(&b.session_index)
                .then(a.start_ns.cmp(&b.start_ns))
        });
        let mut out: Vec<LayeredSession> = Vec::with_capacity(raw.len());
        for row in raw {
            if let Some(last) = out.last_mut() {
                if last.session_index == row.session_index
                    && last.layer == row.layer
                    && last.stop_ns == row.start_ns
                {
                    last.stop_ns = row.stop_ns;
                    continue;
                }
            }
            out.push(row);
        }
        let present: std::collections::HashSet<usize> =
            out.iter().map(|r| r.session_index).collect();
        for i in 0..starts.len() {
            if !present.contains(&i) {
                out.push(LayeredSession {
                    session_index: i,
                    start_ns: starts[i],
                    stop_ns: stops[i],
                    layer: UsageLayer::Primary,
                });
            }
        }
        out.sort_by(|a, b| {
            a.session_index
                .cmp(&b.session_index)
                .then(a.start_ns.cmp(&b.start_ns))
        });
        out
    }

    #[test]
    fn sweep_line_matches_reference_fuzz() {
        // Deterministic LCG (no rand dependency) — vary by index so the corpus is
        // reproducible. Small value ranges densely produce the cases that matter:
        // coincident timestamps across sessions, fully nested, adjacent-touching
        // (stop == next start), duplicate boundaries, zero-width (stop == start),
        // empty (n == 0) and single-session inputs.
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as i64
        };
        for _ in 0..20_000 {
            let n = next().rem_euclid(14) as usize; // 0..=13 (includes empty + single)
            let mut starts = Vec::with_capacity(n);
            let mut stops = Vec::with_capacity(n);
            for _ in 0..n {
                let s = next().rem_euclid(40);
                let d = next().rem_euclid(40); // d == 0 => zero-width session
                starts.push(s);
                stops.push(s + d);
            }
            let got = split_overlapping_sessions(&starts, &stops).expect("ok");
            let want = reference_split(&starts, &stops);
            assert_eq!(got, want, "mismatch starts={starts:?} stops={stops:?}");
        }

        // Explicit edges (in addition to the random corpus above).
        let edges: &[(Vec<i64>, Vec<i64>)] = &[
            (vec![], vec![]),                  // empty
            (vec![5], vec![5]),                // single zero-width
            (vec![0], vec![10]),               // single
            (vec![0, 0], vec![10, 10]),        // coincident identical
            (vec![0, 0, 0], vec![10, 10, 10]), // triple coincident
            (vec![0, 40], vec![100, 60]),      // fully nested
            (vec![0, 10], vec![10, 20]),       // adjacent-touching (stop == next start)
            (vec![0, 5, 10], vec![5, 5, 15]),  // zero-width nested in a run
            (vec![10, 0, 5], vec![20, 30, 5]), // unsorted input with zero-width
        ];
        for (starts, stops) in edges {
            assert_eq!(
                split_overlapping_sessions(starts, stops).expect("ok"),
                reference_split(starts, stops),
                "edge mismatch starts={starts:?} stops={stops:?}",
            );
        }

        // Dense overlap is the case that previously created a much larger
        // temporary per-boundary table than the coalesced result. Keep a
        // moderately large exact comparison here so that the memory-saving
        // transition sweep cannot change interval or tie-breaking semantics.
        let starts = (0..512).map(i64::from).collect::<Vec<_>>();
        let stops = (0..512)
            .map(|index| 1_024_i64 - i64::from(index % 17))
            .collect::<Vec<_>>();
        assert_eq!(
            split_overlapping_sessions(&starts, &stops).expect("ok"),
            reference_split(&starts, &stops),
            "dense-overlap transition sweep must match the reference",
        );
    }

    #[test]
    fn no_overlap_yields_one_primary_row_each() {
        let out = split(&[0, 100], &[50, 150]);
        assert_eq!(
            out,
            vec![
                LayeredSession {
                    session_index: 0,
                    start_ns: 0,
                    stop_ns: 50,
                    layer: UsageLayer::Primary
                },
                LayeredSession {
                    session_index: 1,
                    start_ns: 100,
                    stop_ns: 150,
                    layer: UsageLayer::Primary
                },
            ]
        );
    }

    #[test]
    fn enclosed_session_makes_outer_secondary_during_overlap() {
        // A: [0,100]  B: [40,60]  -> A primary [0,40), B primary [40,60), A secondary [40,60), A primary [60,100)
        let out = split(&[0, 40], &[100, 60]);
        assert_eq!(
            out,
            vec![
                LayeredSession {
                    session_index: 0,
                    start_ns: 0,
                    stop_ns: 40,
                    layer: UsageLayer::Primary
                },
                LayeredSession {
                    session_index: 0,
                    start_ns: 40,
                    stop_ns: 60,
                    layer: UsageLayer::Secondary
                },
                LayeredSession {
                    session_index: 0,
                    start_ns: 60,
                    stop_ns: 100,
                    layer: UsageLayer::Primary
                },
                LayeredSession {
                    session_index: 1,
                    start_ns: 40,
                    stop_ns: 60,
                    layer: UsageLayer::Primary
                },
            ]
        );
    }

    #[test]
    fn partial_overlap_splits_both() {
        // A: [0,60]  B: [40,100]
        let out = split(&[0, 40], &[60, 100]);
        assert_eq!(
            out,
            vec![
                LayeredSession {
                    session_index: 0,
                    start_ns: 0,
                    stop_ns: 40,
                    layer: UsageLayer::Primary
                },
                LayeredSession {
                    session_index: 0,
                    start_ns: 40,
                    stop_ns: 60,
                    layer: UsageLayer::Secondary
                },
                LayeredSession {
                    session_index: 1,
                    start_ns: 40,
                    stop_ns: 100,
                    layer: UsageLayer::Primary
                },
            ]
        );
    }

    #[test]
    fn identical_start_resolves_by_input_order() {
        // A and B both [0,100]; later input index wins primary.
        let out = split(&[0, 0], &[100, 100]);
        assert_eq!(
            out,
            vec![
                LayeredSession {
                    session_index: 0,
                    start_ns: 0,
                    stop_ns: 100,
                    layer: UsageLayer::Secondary
                },
                LayeredSession {
                    session_index: 1,
                    start_ns: 0,
                    stop_ns: 100,
                    layer: UsageLayer::Primary
                },
            ]
        );
    }

    #[test]
    fn rejects_mismatched_lengths() {
        assert!(split_overlapping_sessions(&[0], &[1, 2]).is_err());
    }

    #[test]
    fn adjacent_same_layer_intervals_are_coalesced() {
        // A:[0,40], B:[10,20], C:[20,30]
        // Sub-intervals: [0,10) A only -> A primary; [10,20) A+B open, B starts later -> B primary, A secondary;
        // [20,30) A+C open, C starts later -> C primary, A secondary; [30,40) A only -> A primary.
        // After coalesce, A's two adjacent secondary windows [10,20) and [20,30) merge into [10,30).
        let out = split(&[0, 10, 20], &[40, 20, 30]);
        let a_secondary: Vec<_> = out
            .iter()
            .filter(|r| r.session_index == 0 && r.layer == UsageLayer::Secondary)
            .collect();
        assert_eq!(
            a_secondary.len(),
            1,
            "two adjacent secondary intervals should coalesce to one"
        );
        assert_eq!(a_secondary[0].start_ns, 10);
        assert_eq!(a_secondary[0].stop_ns, 30);
    }

    #[test]
    fn empty_input_returns_empty() {
        assert_eq!(split(&[], &[]), Vec::<LayeredSession>::new());
    }

    #[test]
    fn inverted_bounds_rejected() {
        assert!(split_overlapping_sessions(&[10], &[5]).is_err());
    }

    #[test]
    fn three_way_coincident_highest_index_wins_primary() {
        // Three identical intervals: greatest index (2) must be primary; 0 and 1 secondary.
        let out = split(&[0, 0, 0], &[100, 100, 100]);
        assert_eq!(
            out,
            vec![
                LayeredSession {
                    session_index: 0,
                    start_ns: 0,
                    stop_ns: 100,
                    layer: UsageLayer::Secondary
                },
                LayeredSession {
                    session_index: 1,
                    start_ns: 0,
                    stop_ns: 100,
                    layer: UsageLayer::Secondary
                },
                LayeredSession {
                    session_index: 2,
                    start_ns: 0,
                    stop_ns: 100,
                    layer: UsageLayer::Primary
                },
            ]
        );
    }
}
