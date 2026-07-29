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
enum SparseStopMode {
    SameApp,
    OtherApp,
    AnyApp,
    FallbackSameApp,
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
    let mut open_starts = SparseOpenStarts::new(len, app_codes)?;
    let threshold_ns = options.long_duration_threshold_ns;

    for index in 0..len {
        if let Some(stop_mode) = sparse_stop_mode(index, same_stop, other_stop, stopped, options) {
            let current_app = app_codes[index];
            let stop_timestamp_ns = timestamp_ns[index];
            let enforce_threshold = sparse_stop_enforces_threshold(stop_mode, options);

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
    }

    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
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
    resumed: &[bool],
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
        }

        if resumed[index] {
            let slot = app_codes[index] as usize;
            is_reresume[index] = last_event_ns[slot].is_some_and(|last| {
                last_was_same_stop[slot]
                    && i128::from(timestamp_ns[index]) - i128::from(last) < i128::from(proximity_ns)
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
    }

    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
    })
}

#[allow(clippy::too_many_arguments)]
fn match_legacy_app_usage_update_indices_with_proximity(
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
            }
        }

        if resumed[index] {
            let slot = current_app as usize;
            is_reresume[index] = last_event_ns[slot].is_some_and(|last| {
                last_was_same_stop[slot]
                    && i128::from(timestamp_ns[index]) - i128::from(last) < i128::from(proximity_ns)
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
            } else {
                missing_indices.push(start_index);
            }
        }
    }

    Ok(MatchUpdateIndices {
        start_indices,
        stop_start_indices,
        stop_event_indices,
        missing_indices,
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
    validate_lengths(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
    )?;
    if proximity_ns < 0 {
        return Err(MatcherError::new("proximity_ns must be non-negative"));
    }
    if proximity_ns == 0 {
        return match_app_usage_update_indices_core(
            app_codes,
            timestamp_ns,
            resumed,
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
            resumed,
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
        resumed,
        same_stop,
        other_stop,
        stopped,
        background,
        options,
        proximity_ns,
    )
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
