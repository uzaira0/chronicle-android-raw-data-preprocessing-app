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

fn validate_lengths(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
) -> MatcherResult<usize> {
    let len = app_codes.len();
    if timestamp_ns.len() != len
        || resumed.len() != len
        || same_stop.len() != len
        || other_stop.len() != len
        || stopped.len() != len
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
    options: MatchOptions,
) -> bool {
    let current_app = app_codes[stop_index];
    let normal_stop = same_stop[stop_index] || other_stop[stop_index];
    let fallback_stop = stopped[stop_index] && options.use_activity_stopped_as_fallback;
    let start_app = app_codes[start_index];
    let same_app_compatible = same_stop[stop_index] && start_app == current_app;
    let other_app_compatible = other_stop[stop_index] && start_app != current_app;
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
    options: MatchOptions,
) -> MatcherResult<MatchOutput> {
    let len = validate_lengths(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
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
    options: MatchOptions,
) -> MatcherResult<MatchUpdateIndices> {
    let len = validate_lengths(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
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
                            |start_index| app_codes[start_index] != current_app,
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
                            |_start_index| true,
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
                        |start_index| app_codes[start_index] != current_app,
                    ),
                    SparseStopMode::AnyApp => open_starts.latest_matching_global(
                        stop_timestamp_ns,
                        enforce_threshold,
                        threshold_ns,
                        timestamp_ns,
                        |_start_index| true,
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

    let output = match_app_usage_core(
        app_codes,
        timestamp_ns,
        resumed,
        same_stop,
        other_stop,
        stopped,
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
#[pymodule]
fn _rust_app_usage_matcher(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(match_app_usage, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_update_indices, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_update_arrays, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_arrays, m)?)?;
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
        match_app_usage_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
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
        match_app_usage_update_indices_core(
            app_codes,
            timestamp_ns,
            resumed,
            same_stop,
            other_stop,
            stopped,
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

    fn next_u64(seed: &mut u64) -> u64 {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        *seed
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

    #[test]
    fn sparse_update_indices_match_dense_output_for_generated_event_streams() {
        for seed_start in 0..128 {
            let mut seed = seed_start;
            let len = (next_u64(&mut seed) % 48) as usize;
            let mut app_codes = Vec::with_capacity(len);
            let mut timestamps = Vec::with_capacity(len);
            let mut resumed = Vec::with_capacity(len);
            let mut same_stop = Vec::with_capacity(len);
            let mut other_stop = Vec::with_capacity(len);
            let mut stopped = Vec::with_capacity(len);
            let mut timestamp = 0_i64;

            for _ in 0..len {
                timestamp += (next_u64(&mut seed) % 600) as i64;
                app_codes.push((next_u64(&mut seed) % 7) as i32);
                timestamps.push(timestamp);
                resumed.push(next_u64(&mut seed) % 5 == 0);
                same_stop.push(next_u64(&mut seed) % 6 == 0);
                other_stop.push(next_u64(&mut seed) % 7 == 0);
                stopped.push(next_u64(&mut seed) % 8 == 0);
            }

            for options in [
                MatchOptions {
                    allow_stop_event_reuse: false,
                    use_activity_stopped_as_fallback: false,
                    apply_threshold_to_fallback: true,
                    long_duration_threshold_ns: 1_200,
                },
                MatchOptions {
                    allow_stop_event_reuse: false,
                    use_activity_stopped_as_fallback: true,
                    apply_threshold_to_fallback: true,
                    long_duration_threshold_ns: 1_200,
                },
                MatchOptions {
                    allow_stop_event_reuse: true,
                    use_activity_stopped_as_fallback: true,
                    apply_threshold_to_fallback: false,
                    long_duration_threshold_ns: 1_200,
                },
            ] {
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

                for index in 0..len {
                    if dense.stop_ns[index] != -1 {
                        assert_ne!(dense.start_ns[index], -1);
                        assert!(dense.stop_ns[index] >= dense.start_ns[index]);
                    }
                    if dense.missing[index] {
                        assert_ne!(dense.start_ns[index], -1);
                        assert_eq!(dense.stop_ns[index], -1);
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Behavioral scenario tests
    // -----------------------------------------------------------------------

    // Convenience: standard 12-hour threshold in nanoseconds
    const THRESHOLD_12H: i64 = 12 * 60 * 60 * 1_000_000_000i64;

    // ---- Group A: Explicit same_stop matching --------------------------------

    #[test]
    fn explicit_same_stop_closes_session() {
        let app_codes = [1, 1];
        let timestamps = [0i64, 300];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop at index 1

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 300);
        assert!(!out.missing[0]);
    }

    #[test]
    fn explicit_same_stop_wrong_app_no_match() {
        // same_stop requires app_codes[start] == app_codes[stop]; here 1 ≠ 2
        let app_codes = [1, 2];
        let timestamps = [0i64, 300];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop at index 1, but app=2 while open start is app=1

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // same_stop incompatible → file-end closes at t=300
        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 300);
        assert!(!out.missing[0]);
    }

    #[test]
    fn explicit_same_stop_nearest_when_two_open() {
        // Two app=1 starts open; stop closes only nearest (index 1), index 0 gets file-end
        let app_codes = [1, 1, 1];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // index 1 (nearest) closed by same_stop at 300
        assert_eq!(out.stop_ns[1], 300);
        // index 0 closed by file-end at 300
        assert_eq!(out.stop_ns[0], 300);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    #[test]
    fn explicit_same_stop_no_start_is_noop() {
        // same_stop at index 0, but nothing is resumed before it
        let app_codes = [5, 5];
        let timestamps = [0i64, 300];
        let resumed = [false, false];
        let mut flags = base_flags(2);
        flags.0[0] = true; // same_stop at index 0

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns, vec![-1, -1]);
        assert_eq!(out.stop_ns, vec![-1, -1]);
        assert_eq!(out.missing, vec![false, false]);
    }

    #[test]
    fn explicit_same_stop_multiple_apps_only_right_app_closed() {
        // app=[2,1,2], resumed=[T,T,F], same_stop[2]=T (app=2) closes start at 0 (app=2)
        // start at 1 (app=1) has no compatible same_stop → file-end
        let app_codes = [2, 1, 2];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // index 0 (app=2) closed by same_stop at 300
        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 300);
        assert!(!out.missing[0]);
        // index 1 (app=1) closed by file-end at 300
        assert_eq!(out.start_ns[1], 100);
        assert_eq!(out.stop_ns[1], 300);
        assert!(!out.missing[1]);
    }

    #[test]
    fn same_stop_closes_across_options_with_reuse() {
        // reuse=true, two app=1 starts, same_stop at index 2 → both closed
        let app_codes = [1, 1, 1];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 300);
        assert_eq!(out.stop_ns[1], 300);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    #[test]
    fn same_stop_closes_when_duration_within_threshold() {
        // same_stop closes the session when duration is within the threshold
        let app_codes = [1, 1];
        let ts = 10 * 60 * 60 * 1_000_000_000i64; // 10 hours (< 12h threshold)
        let timestamps = [0i64, ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], ts);
        assert!(!out.missing[0]);
    }

    #[test]
    fn same_stop_at_start_position_not_matched_before_open() {
        // Index 0 is both resumed=T and same_stop=T; stop runs first (nothing open yet),
        // then start opens. Later index 1 (same_stop) closes it.
        let app_codes = [3, 3];
        let timestamps = [0i64, 200];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[0] = true; // same_stop at index 0 (same event as the start)
        flags.0[1] = true; // same_stop at index 1

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Index 0 is a start; stop at 0 has nothing to close (processed before open)
        assert_eq!(out.start_ns[0], 0);
        // Index 1 same_stop closes it
        assert_eq!(out.stop_ns[0], 200);
        assert!(!out.missing[0]);
    }

    // ---- Group B: Explicit other_stop matching --------------------------------

    #[test]
    fn explicit_other_stop_closes_different_app() {
        // app=[1,2], other_stop[1]=T; current stop app=2, open start app=1 (≠2) → closes
        let app_codes = [1, 2];
        let timestamps = [0i64, 500];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.1[1] = true; // other_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 500);
        assert!(!out.missing[0]);
    }

    #[test]
    fn explicit_other_stop_same_app_no_match() {
        // other_stop requires app_codes[start] ≠ app_codes[stop]; here both are app=1
        let app_codes = [1, 1];
        let timestamps = [0i64, 500];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.1[1] = true; // other_stop, but both app=1 → incompatible

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // other_stop incompatible → file-end closes at t=500
        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 500);
        assert!(!out.missing[0]);
    }

    #[test]
    fn explicit_other_stop_nearest_across_apps() {
        // app=[1,2,1], resumed=[T,T,F], other_stop[2]=T (current app=1)
        // index 1 (app=2 ≠ 1) is nearest compatible; index 0 gets file-end
        let app_codes = [1, 2, 1];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.1[2] = true; // other_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[1], 300); // nearest different-app closed
        assert_eq!(out.stop_ns[0], 300); // file-end
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    #[test]
    fn other_stop_no_compatible_start_noop() {
        // other_stop at index 0, nothing open before it
        let app_codes = [7, 9];
        let timestamps = [0i64, 200];
        let resumed = [false, false];
        let mut flags = base_flags(2);
        flags.1[0] = true; // other_stop at 0

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns, vec![-1, -1]);
        assert_eq!(out.stop_ns, vec![-1, -1]);
        assert_eq!(out.missing, vec![false, false]);
    }

    #[test]
    fn other_stop_multiple_apps_closes_only_different() {
        // app=[3,5,3], resumed=[T,T,F], other_stop[2]=T (current app=3)
        // index 1 (app=5 ≠ 3) closed; index 0 (app=3 == 3) skipped by other_stop
        let app_codes = [3, 5, 3];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.1[2] = true; // other_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[1], 300); // app=5 closed
        assert_eq!(out.stop_ns[0], 300); // app=3: file-end
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    #[test]
    fn other_stop_closes_when_duration_within_threshold() {
        // other_stop closes the session when duration is within the threshold
        let app_codes = [1, 2];
        let ts = 10 * 60 * 60 * 1_000_000_000i64; // 10 hours (< 12h threshold)
        let timestamps = [0i64, ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.1[1] = true; // other_stop

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], ts);
        assert!(!out.missing[0]);
    }

    // ---- Group C: Fallback (stopped) stop matching ---------------------------

    #[test]
    fn fallback_stop_same_app_closes() {
        let app_codes = [7, 7];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn fallback_stop_disabled_when_flag_false() {
        // use_fallback=false → stopped event ignored; file-end closes
        let app_codes = [7, 7];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped, but fallback disabled

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // fallback disabled → file-end closes at t=100
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn fallback_stop_different_app_no_match() {
        // fallback requires same app code; app=[7,8] → no fallback match
        let app_codes = [7, 8];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // fallback incompatible (different app) → file-end closes at t=100
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn fallback_threshold_blocks_when_apply_true() {
        // Duration > threshold AND apply_threshold_to_fallback=true → missing
        let app_codes = [7, 7];
        let long_ts = 13 * 60 * 60 * 1_000_000_000i64; // 13h > 12h threshold
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn fallback_threshold_allowed_when_apply_false() {
        // Duration > threshold but apply_threshold_to_fallback=false → closes
        let app_codes = [7, 7];
        let long_ts = 13 * 60 * 60 * 1_000_000_000i64;
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], long_ts);
        assert!(!out.missing[0]);
    }

    #[test]
    fn fallback_no_match_when_normal_stop_present() {
        // same_stop AND stopped both true; same_app_compatible=T so normal match wins,
        // fallback_compatible checks !normal_stop → false, but same_stop already matched
        let app_codes = [4, 4];
        let timestamps = [0i64, 200];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop
        flags.2[1] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 200);
        assert!(!out.missing[0]);
    }

    #[test]
    fn fallback_multiple_starts_nearest_closed() {
        // Two same-app starts, fallback stop, reuse=false → closes nearest
        let app_codes = [6, 6, 6];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.2[2] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[1], 300); // nearest closed by fallback
        assert_eq!(out.stop_ns[0], 300); // file-end
    }

    #[test]
    fn fallback_reuse_closes_all_same_app() {
        // reuse=true, two same-app starts, fallback stop → closes both
        let app_codes = [6, 6, 6];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.2[2] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 300);
        assert_eq!(out.stop_ns[1], 300);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    // ---- Group D: Stop reuse behavior ----------------------------------------

    #[test]
    fn reuse_enabled_closes_all_same_app_starts() {
        let app_codes = [1, 1, 1, 1];
        let timestamps = [0i64, 60, 300, 360];
        let resumed = [true, true, false, false];
        let mut flags = base_flags(4);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 300);
        assert_eq!(out.stop_ns[1], 300);
    }

    #[test]
    fn reuse_disabled_closes_only_nearest() {
        let app_codes = [1, 1, 1, 1];
        let timestamps = [0i64, 60, 300, 360];
        let resumed = [true, true, false, false];
        let mut flags = base_flags(4);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Only nearest (index 1) closed by same_stop; index 0 gets file-end at 360
        assert_eq!(out.stop_ns[1], 300);
        assert_eq!(out.stop_ns[0], 360);
    }

    #[test]
    fn reuse_other_stop_closes_all_different_apps() {
        // app=[1,2,1], reuse=true, other_stop[2]=T (app=1) → closes index 1 (app=2 ≠ 1)
        let app_codes = [1, 2, 1];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.1[2] = true; // other_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[1], 300);
        // index 0 (app=1 == stop app=1) → not closed by other_stop
    }

    #[test]
    fn reuse_any_app_mode_closes_all() {
        // both same_stop and other_stop true → AnyApp mode → closes all open starts
        let app_codes = [1, 2, 3];
        let timestamps = [0i64, 100, 300];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop
        flags.1[2] = true; // other_stop → AnyApp

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Both starts should be closed
        assert_ne!(out.stop_ns[0], -1);
        assert_ne!(out.stop_ns[1], -1);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
    }

    #[test]
    fn reuse_respects_threshold_for_fallback() {
        // reuse=true, fallback, long duration, apply_threshold=true → threshold blocks
        let app_codes = [5, 5, 5];
        let long_ts = 13 * 60 * 60 * 1_000_000_000i64;
        let timestamps = [0i64, 100, long_ts];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.2[2] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Both starts are > threshold from stopped event → missing
        assert!(out.missing[0]);
        assert!(out.missing[1]);
    }

    #[test]
    fn reuse_vs_no_reuse_consistent_on_single_start() {
        // With exactly one open start, both reuse modes produce same result
        let app_codes = [3, 3];
        let timestamps = [0i64, 150];
        let resumed = [true, false];
        let mut flags_reuse = base_flags(2);
        flags_reuse.0[1] = true;
        let mut flags_no_reuse = base_flags(2);
        flags_no_reuse.0[1] = true;

        let opts_reuse = MatchOptions {
            allow_stop_event_reuse: true,
            use_activity_stopped_as_fallback: false,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: THRESHOLD_12H,
        };
        let opts_no_reuse = MatchOptions {
            allow_stop_event_reuse: false,
            ..opts_reuse
        };

        let out_reuse = run(
            &app_codes,
            &timestamps,
            &[true, false],
            &flags_reuse.0,
            &flags_reuse.1,
            &flags_reuse.2,
            opts_reuse,
        );
        let out_no_reuse = run(
            &app_codes,
            &timestamps,
            &[true, false],
            &flags_no_reuse.0,
            &flags_no_reuse.1,
            &flags_no_reuse.2,
            opts_no_reuse,
        );

        assert_eq!(out_reuse.stop_ns, out_no_reuse.stop_ns);
        assert_eq!(out_reuse.missing, out_no_reuse.missing);
    }

    #[test]
    fn reuse_fallback_same_app_closes_all_matching() {
        // reuse=true, fallback, two same-app and one different-app start
        // only same-app ones should be closed by fallback
        let app_codes = [9, 9, 8, 9];
        let timestamps = [0i64, 50, 100, 300];
        let resumed = [true, true, true, false];
        let mut flags = base_flags(4);
        flags.2[3] = true; // stopped (fallback), app=9

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // indices 0 and 1 (app=9) closed by fallback
        assert_eq!(out.stop_ns[0], 300);
        assert_eq!(out.stop_ns[1], 300);
        // index 2 (app=8) not closed by fallback (different app) → file-end
        assert_eq!(out.stop_ns[2], 300);
    }

    #[test]
    fn no_reuse_sequential_stops_close_in_order() {
        // Multiple starts, multiple same_stop events, no reuse → each closes nearest
        let app_codes = [1, 1, 1, 1];
        let timestamps = [0i64, 100, 200, 300];
        let resumed = [true, true, false, false];
        let mut flags = base_flags(4);
        flags.0[2] = true; // same_stop at 2 → closes index 1
        flags.0[3] = true; // same_stop at 3 → closes index 0

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[1], 200); // nearest start closed first
        assert_eq!(out.stop_ns[0], 300); // then the earlier start
    }

    // ---- Group E: File-end closure -------------------------------------------

    #[test]
    fn file_end_closes_within_threshold() {
        let app_codes = [1, 2];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn file_end_missing_when_exceeds_threshold() {
        let app_codes = [1, 2];
        let timestamps = [0i64, 2_000];
        let resumed = [true, false];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn file_end_exactly_threshold_is_valid() {
        // duration == threshold → is_valid_duration (≤ threshold) → closed
        let app_codes = [1, 2];
        let timestamps = [0i64, 1_000];
        let resumed = [true, false];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(out.stop_ns[0], 1_000);
        assert!(!out.missing[0]);
    }

    #[test]
    fn file_end_skipped_when_start_is_last_event() {
        // Start is the only/last event → last_index == start_index → missing
        let app_codes = [42];
        let timestamps = [0i64];
        let resumed = [true];
        let flags = base_flags(1);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn file_end_multiple_starts_mixed_outcome() {
        // start at 0 → close at file-end (within threshold)
        // start at 1 → last event; missing
        let app_codes = [1, 2];
        let timestamps = [0i64, 100];
        let resumed = [true, true];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // index 0: file-end at 100, within threshold → closed
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
        // index 1: is the last event → missing
        assert_eq!(out.stop_ns[1], -1);
        assert!(out.missing[1]);
    }

    #[test]
    fn file_end_uses_last_timestamp_exactly() {
        let app_codes = [1, 9, 9];
        let timestamps = [0i64, 50, 999];
        let resumed = [true, false, false];
        let flags = base_flags(3);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 999);
    }

    // ---- Group F: MatchOptions combinations ----------------------------------

    #[test]
    fn opts_all_false_fallback_ignored() {
        // All bool opts false, stopped=T → nothing matched by fallback, file-end closes
        let app_codes = [3, 3];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // fallback disabled; file-end closes at 100
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn opts_reuse_only_enabled() {
        // only allow_stop_event_reuse=T, same_stop=T → multi-close
        let app_codes = [2, 2, 2];
        let timestamps = [0i64, 50, 200];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 200);
        assert_eq!(out.stop_ns[1], 200);
    }

    #[test]
    fn opts_fallback_no_threshold() {
        // fallback=T, threshold_apply=F, long duration → closes
        let app_codes = [8, 8];
        let long_ts = 50 * 60 * 60 * 1_000_000_000i64;
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], long_ts);
        assert!(!out.missing[0]);
    }

    #[test]
    fn opts_fallback_with_threshold() {
        // fallback=T, threshold_apply=T, long duration → missing
        let app_codes = [8, 8];
        let long_ts = 50 * 60 * 60 * 1_000_000_000i64;
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn opts_zero_threshold_blocks_fallback() {
        // threshold=0, any positive duration fallback → missing
        let app_codes = [5, 5];
        let timestamps = [0i64, 1]; // duration=1 > 0
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: 0,
            },
        );

        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn opts_large_threshold_never_blocks() {
        // threshold=i64::MAX/2, fallback → closes regardless of duration
        let app_codes = [5, 5];
        let long_ts = 99 * 60 * 60 * 1_000_000_000i64;
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped

        let out = run(
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
                long_duration_threshold_ns: i64::MAX / 2,
            },
        );

        assert_eq!(out.stop_ns[0], long_ts);
        assert!(!out.missing[0]);
    }

    #[test]
    fn opts_normal_stop_closes_when_within_threshold() {
        // same_stop closes the session as long as duration is within the threshold
        let app_codes = [1, 1];
        let timestamps = [0i64, 500]; // small duration, within threshold=1000
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop

        let out = run(
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

        assert_eq!(out.stop_ns[0], 500);
        assert!(!out.missing[0]);
    }

    #[test]
    fn opts_no_fallback_stopped_event_noop() {
        // use_fallback=F, stopped=T → ignored; file-end closes
        let app_codes = [2, 2];
        let timestamps = [0i64, 500];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[1] = true; // stopped, but fallback disabled

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: true,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 500);
        assert!(!out.missing[0]);
    }

    // ---- Group G: MatchUpdateIndices correctness ----------------------------

    #[test]
    fn update_indices_start_indices_match_resumed_positions() {
        let app_codes = [1, 2, 3, 1];
        let timestamps = [0i64, 100, 200, 300];
        let resumed = [true, false, true, false];
        let flags = base_flags(4);

        let updates = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        let mut start_indices = updates.start_indices.clone();
        start_indices.sort_unstable();
        assert_eq!(start_indices, vec![0, 2]);
    }

    #[test]
    fn update_indices_stop_pairs_same_length() {
        let app_codes = [1, 1, 2, 2];
        let timestamps = [0i64, 50, 100, 150];
        let resumed = [true, false, true, false];
        let same_stop = [false, true, false, true];
        let flags = base_flags(4);

        let updates = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(
            updates.stop_start_indices.len(),
            updates.stop_event_indices.len()
        );
    }

    #[test]
    fn update_indices_no_index_in_both_missing_and_stopped() {
        let app_codes = [1, 2, 1];
        let timestamps = [0i64, 100, 200];
        let resumed = [true, false, false];
        let flags = base_flags(3);

        let updates = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // An index cannot appear in both missing_indices and stop_start_indices
        for mi in &updates.missing_indices {
            assert!(
                !updates.stop_start_indices.contains(mi),
                "index {} in both missing and stopped",
                mi
            );
        }
    }

    #[test]
    fn update_indices_file_end_closure_marks_missing() {
        // Single start, no stop → file-end tries to close; if exceeds threshold → missing
        let app_codes = [42];
        let timestamps = [0i64];
        let resumed = [true];
        let flags = base_flags(1);

        let updates = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(updates.missing_indices.contains(&0));
        assert!(!updates.stop_start_indices.contains(&0));
    }

    #[test]
    fn update_indices_sparse_dense_consistent_same_stop() {
        let app_codes = [1, 1, 2, 2];
        let timestamps = [0i64, 100, 200, 400];
        let resumed = [true, false, true, false];
        let same_stop = [false, true, false, true];
        let flags = base_flags(4);
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: false,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: THRESHOLD_12H,
        };

        let dense = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &flags.1,
            &flags.2,
            options,
        );
        let sparse = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &flags.1,
            &flags.2,
            options,
        );

        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            dense
        );
    }

    #[test]
    fn update_indices_sparse_dense_consistent_other_stop() {
        let app_codes = [1, 2, 1, 2];
        let timestamps = [0i64, 100, 200, 350];
        let resumed = [true, true, false, false];
        let other_stop = [false, false, true, true];
        let flags = base_flags(4);
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: false,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: THRESHOLD_12H,
        };

        let dense = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &other_stop,
            &flags.2,
            options,
        );
        let sparse = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &other_stop,
            &flags.2,
            options,
        );

        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            dense
        );
    }

    #[test]
    fn update_indices_sparse_dense_consistent_fallback() {
        let app_codes = [3, 3, 4];
        let timestamps = [0i64, 200, 500];
        let resumed = [true, false, false];
        let stopped = [false, true, false];
        let flags = base_flags(3);
        let options = MatchOptions {
            allow_stop_event_reuse: false,
            use_activity_stopped_as_fallback: true,
            apply_threshold_to_fallback: false,
            long_duration_threshold_ns: THRESHOLD_12H,
        };

        let dense = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &stopped,
            options,
        );
        let sparse = run_update_indices(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &stopped,
            options,
        );

        assert_eq!(
            reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
            dense
        );
    }

    #[test]
    fn update_indices_empty_input() {
        let updates = run_update_indices(
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(updates.start_indices.is_empty());
        assert!(updates.stop_start_indices.is_empty());
        assert!(updates.stop_event_indices.is_empty());
        assert!(updates.missing_indices.is_empty());
    }

    // ---- Group H: Error/validation tests ------------------------------------

    #[test]
    fn error_mismatched_lengths_app_codes() {
        let result = match_app_usage_core(
            &[1, 2, 3],   // length 3
            &[0i64, 100], // length 2
            &[true, false],
            &[false, false],
            &[false, false],
            &[false, false],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn error_mismatched_lengths_timestamps() {
        let result = match_app_usage_core(
            &[1, 2],
            &[0i64, 100, 200], // length 3 vs 2
            &[true, false],
            &[false, false],
            &[false, false],
            &[false, false],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn error_negative_app_code_update_indices() {
        // SparseOpenStarts may reject negative app codes
        let result = match_app_usage_update_indices_core(
            &[-1, 2],
            &[0i64, 100],
            &[true, false],
            &[false, true],
            &[false, false],
            &[false, false],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn ok_zero_app_code_accepted() {
        let result = match_app_usage_core(
            &[0, 0],
            &[0i64, 100],
            &[true, false],
            &[false, true],
            &[false, false],
            &[false, false],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(result.is_ok());
    }

    #[test]
    fn empty_input_returns_empty_output_core() {
        let out = run(
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(out.start_ns.is_empty());
        assert!(out.stop_ns.is_empty());
        assert!(out.missing.is_empty());
    }

    #[test]
    fn empty_input_returns_empty_output_indices() {
        let updates = run_update_indices(
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(updates.start_indices.is_empty());
        assert!(updates.stop_start_indices.is_empty());
        assert!(updates.stop_event_indices.is_empty());
        assert!(updates.missing_indices.is_empty());
    }

    // ---- Group I: Complex multi-app scenarios --------------------------------

    #[test]
    fn two_apps_sequential_sessions() {
        // [1,1,2,2]: start1→stop1, start2→stop2
        let app_codes = [1, 1, 2, 2];
        let timestamps = [0i64, 100, 200, 300];
        let resumed = [true, false, true, false];
        let mut flags = base_flags(4);
        flags.0[1] = true; // same_stop
        flags.0[3] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 100);
        assert_eq!(out.start_ns[2], 200);
        assert_eq!(out.stop_ns[2], 300);
        assert!(!out.missing[0]);
        assert!(!out.missing[2]);
    }

    #[test]
    fn three_apps_interleaved() {
        // 6 events, three apps alternating, each has one start and one stop
        let app_codes = [1, 2, 3, 1, 2, 3];
        let timestamps = [0i64, 50, 100, 200, 250, 300];
        let resumed = [true, true, true, false, false, false];
        let other_stop = [false, false, false, true, true, true];
        let flags = base_flags(6);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &other_stop,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Each start should be closed
        assert_ne!(out.stop_ns[0], -1);
        assert_ne!(out.stop_ns[1], -1);
        assert_ne!(out.stop_ns[2], -1);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
        assert!(!out.missing[2]);
    }

    #[test]
    fn app_starts_without_stop_then_same_app_starts_again() {
        // app=[1,1], resumed=[T,T], no stop → both open, file-end closes both
        let app_codes = [1, 1];
        let timestamps = [0i64, 100];
        let resumed = [true, true];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // Both open; index 1 is the last event → missing; index 0 gets file-end at 100
        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.start_ns[1], 100);
        assert_eq!(out.stop_ns[0], 100);
        assert!(out.missing[1]);
    }

    #[test]
    fn stop_event_with_no_compatible_open_start_noop() {
        // Stop event arrives when no open starts exist
        let app_codes = [5, 5];
        let timestamps = [0i64, 100];
        let resumed = [false, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns, vec![-1, -1]);
        assert_eq!(out.stop_ns, vec![-1, -1]);
        assert_eq!(out.missing, vec![false, false]);
    }

    #[test]
    fn same_and_other_stop_true_any_app_mode() {
        // Both same_stop and other_stop true at same event → AnyApp mode
        let app_codes = [1, 2, 5];
        let timestamps = [0i64, 100, 200];
        let resumed = [true, true, false];
        let mut flags = base_flags(3);
        flags.0[2] = true; // same_stop
        flags.1[2] = true; // other_stop → AnyApp

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // At least the nearest start is closed; in AnyApp mode with reuse=false, nearest closed
        assert_ne!(out.stop_ns[1], -1);
    }

    #[test]
    fn resumed_and_stopped_same_event() {
        // resumed=T AND stopped=T at index 0: stop runs first (nothing to stop),
        // then start opens; index 1 (same_stop) closes it
        let app_codes = [2, 2];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.2[0] = true; // stopped at index 0 (same event as start)
        flags.0[1] = true; // same_stop at index 1

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: true,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn interleaved_apps_with_reuse_closes_correct_sets() {
        // app=[1,2,1,2], reuse=T
        // same_stop events close all app=1; other_stop events close all app≠current
        let app_codes = [1, 2, 1, 2];
        let timestamps = [0i64, 50, 100, 200];
        let resumed = [true, true, false, false];
        let same_stop = [false, false, true, false]; // at 2 (app=1) → closes 0 (app=1) with reuse
        let other_stop = [false, false, false, true]; // at 3 (app=2) → closes 0 if still open (app=1 ≠ 2)
        let flags = base_flags(4);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &other_stop,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_ne!(out.stop_ns[0], -1);
        assert_ne!(out.stop_ns[1], -1);
    }

    #[test]
    fn same_stop_blocked_by_threshold_unlike_no_threshold_fallback() {
        // Confirm: same_stop IS blocked when duration exceeds threshold.
        // The distinction is: fallback blocking is controlled by apply_threshold_to_fallback,
        // but normal stops (same_stop/other_stop) always enforce long_duration_threshold_ns.
        let app_codes = [7, 7];
        let long_ts = 100 * 60 * 60 * 1_000_000_000i64; // 100h >> threshold=1
        let timestamps = [0i64, long_ts];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop

        let out = run(
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
                long_duration_threshold_ns: 1, // tiny threshold blocks same_stop too
            },
        );

        // same_stop duration > threshold → not closed → file-end also blocked → missing
        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn five_sessions_each_paired() {
        // 10 events, 5 app=N starts each matched by same_stop
        let app_codes = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
        let timestamps = [0i64, 10, 20, 30, 40, 100, 110, 120, 130, 140];
        let resumed = [
            true, true, true, true, true, false, false, false, false, false,
        ];
        let same_stop = [
            false, false, false, false, false, true, true, true, true, true,
        ];
        let flags = base_flags(10);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        for i in 0..5 {
            assert_ne!(out.start_ns[i], -1, "start at {i} should be set");
            assert_ne!(out.stop_ns[i], -1, "stop at {i} should be set");
            assert!(!out.missing[i], "start at {i} should not be missing");
        }
    }

    #[test]
    fn stop_event_same_index_as_start_no_self_close() {
        // resumed=T and same_stop=T at index 0; stop runs first (nothing open), then start opens
        let app_codes = [1, 1];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[0] = true; // same_stop at 0 (same event as start)

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // index 0 is a start (stop at 0 had nothing to close)
        assert_eq!(out.start_ns[0], 0);
        // file-end closes at 100
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn sequential_apps_different_thresholds_mixed_outcome() {
        // Two starts: one gets file-end within threshold, one exceeds threshold
        let app_codes = [1, 2, 3];
        // index 0 starts at 0; index 1 starts at 100; last event at 500
        // threshold=200 → index 0 duration=500>200 → missing; index 1 duration=400>200 → missing
        // Use a large threshold so only distance-from-file-end matters
        let timestamps = [0i64, 490, 500];
        let resumed = [true, true, false];
        let flags = base_flags(3);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: 100, // threshold=100ns
            },
        );

        // index 0: duration to file-end = 500 > 100 → missing
        assert!(out.missing[0]);
        // index 1: duration to file-end = 10 < 100 → closed
        assert_eq!(out.stop_ns[1], 500);
        assert!(!out.missing[1]);
    }

    #[test]
    fn nested_sessions_same_app_with_reuse() {
        // app=[1,1,1,1,1], three starts then one same_stop with reuse → all three closed
        let app_codes = [1, 1, 1, 1, 1];
        let timestamps = [0i64, 50, 100, 200, 300];
        let resumed = [true, true, true, false, false];
        let mut flags = base_flags(5);
        flags.0[3] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: true,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.stop_ns[0], 200);
        assert_eq!(out.stop_ns[1], 200);
        assert_eq!(out.stop_ns[2], 200);
        assert!(!out.missing[0]);
        assert!(!out.missing[1]);
        assert!(!out.missing[2]);
    }

    // ---- Group J: Sentinel value integrity ----------------------------------

    #[test]
    fn non_started_events_have_sentinel_start() {
        let app_codes = [1, 2, 1];
        let timestamps = [0i64, 100, 200];
        let resumed = [true, false, false]; // only index 0 is a start
        let flags = base_flags(3);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[1], -1);
        assert_eq!(out.start_ns[2], -1);
    }

    #[test]
    fn non_stopped_events_have_sentinel_stop() {
        // index 1 and 2 are not starts and are not stop targets
        let app_codes = [1, 9, 8];
        let timestamps = [0i64, 100, 200];
        let resumed = [true, false, false];
        let flags = base_flags(3);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        // indices 1 and 2 are not starts → stop_ns = -1
        assert_eq!(out.stop_ns[1], -1);
        assert_eq!(out.stop_ns[2], -1);
    }

    #[test]
    fn missing_flag_false_for_non_started() {
        let app_codes = [1, 9, 9];
        let timestamps = [0i64, 100, 200];
        let resumed = [true, false, false];
        let flags = base_flags(3);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(!out.missing[1]);
        assert!(!out.missing[2]);
    }

    #[test]
    fn start_ns_values_are_exact_input_timestamps() {
        let app_codes = [1, 2, 1, 2];
        let timestamps = [10i64, 20, 30, 40];
        let resumed = [true, true, false, false];
        let flags = base_flags(4);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        for (i, &sn) in out.start_ns.iter().enumerate() {
            if sn != -1 {
                assert!(
                    timestamps.contains(&sn),
                    "start_ns[{i}]={sn} not in input timestamps"
                );
            }
        }
    }

    #[test]
    fn stop_ns_values_are_exact_input_timestamps() {
        let app_codes = [1, 1, 2, 2];
        let timestamps = [0i64, 100, 200, 300];
        let resumed = [true, false, true, false];
        let same_stop = [false, true, false, true];
        let flags = base_flags(4);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &same_stop,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        for (i, &sn) in out.stop_ns.iter().enumerate() {
            if sn != -1 {
                assert!(
                    timestamps.contains(&sn),
                    "stop_ns[{i}]={sn} not in input timestamps"
                );
            }
        }
    }

    // ---- Group K: Additional edge cases -------------------------------------

    #[test]
    fn single_event_resumed_only_is_missing() {
        let app_codes = [1];
        let timestamps = [0i64];
        let resumed = [true];
        let flags = base_flags(1);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], -1);
        assert!(out.missing[0]);
    }

    #[test]
    fn single_event_no_flags_no_session() {
        let app_codes = [7];
        let timestamps = [42i64];
        let resumed = [false];
        let flags = base_flags(1);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], -1);
        assert_eq!(out.stop_ns[0], -1);
        assert!(!out.missing[0]);
    }

    #[test]
    fn two_events_no_stop_first_within_threshold() {
        // resumed[0]=T, no stop, timestamps=[0,100], threshold=1000 → file-end closes at 100
        let app_codes = [3, 9];
        let timestamps = [0i64, 100];
        let resumed = [true, false];
        let flags = base_flags(2);

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: 1_000,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 100);
        assert!(!out.missing[0]);
    }

    #[test]
    fn timestamps_all_zero_valid() {
        // All timestamps are 0, duration=0 → valid (non-negative)
        let app_codes = [1, 1];
        let timestamps = [0i64, 0];
        let resumed = [true, false];
        let mut flags = base_flags(2);
        flags.0[1] = true; // same_stop

        let out = run(
            &app_codes,
            &timestamps,
            &resumed,
            &flags.0,
            &flags.1,
            &flags.2,
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert_eq!(out.start_ns[0], 0);
        assert_eq!(out.stop_ns[0], 0);
        assert!(!out.missing[0]);
    }

    #[test]
    fn large_app_code_value_accepted() {
        let result = match_app_usage_core(
            &[10_000, 10_000],
            &[0i64, 100],
            &[true, false],
            &[false, true],
            &[false, false],
            &[false, false],
            MatchOptions {
                allow_stop_event_reuse: false,
                use_activity_stopped_as_fallback: false,
                apply_threshold_to_fallback: false,
                long_duration_threshold_ns: THRESHOLD_12H,
            },
        );

        assert!(result.is_ok());
        let out = result.unwrap();
        assert_eq!(out.stop_ns[0], 100);
    }

    // -----------------------------------------------------------------------
    // proptest-based property tests
    // -----------------------------------------------------------------------

    use proptest::prelude::*;

    /// Build correlated input vecs all of the same length.
    /// Timestamps are monotonically non-decreasing (each delta is 0..600 ns).
    fn arb_input(
        max_len: usize,
    ) -> impl Strategy<
        Value = (
            Vec<i32>,
            Vec<i64>,
            Vec<bool>,
            Vec<bool>,
            Vec<bool>,
            Vec<bool>,
        ),
    > {
        (0usize..=max_len).prop_flat_map(|len| {
            (
                prop::collection::vec(0i32..7, len),
                prop::collection::vec(0i64..600, len).prop_map(|deltas| {
                    let mut acc = 0i64;
                    deltas
                        .into_iter()
                        .map(|d| {
                            acc += d;
                            acc
                        })
                        .collect::<Vec<_>>()
                }),
                prop::collection::vec(proptest::bool::ANY, len),
                prop::collection::vec(proptest::bool::ANY, len),
                prop::collection::vec(proptest::bool::ANY, len),
                prop::collection::vec(proptest::bool::ANY, len),
            )
        })
    }

    fn arb_options() -> impl Strategy<Value = MatchOptions> {
        (
            proptest::bool::ANY,
            proptest::bool::ANY,
            proptest::bool::ANY,
            1i64..=10_000i64,
        )
            .prop_map(|(a, b, c, d)| MatchOptions {
                allow_stop_event_reuse: a,
                use_activity_stopped_as_fallback: b,
                apply_threshold_to_fallback: c,
                long_duration_threshold_ns: d,
            })
    }

    proptest! {
        // 1. Sparse and dense outputs are always equivalent.
        #[test]
        fn prop_sparse_dense_equivalence(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let dense = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            let sparse = run_update_indices(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            prop_assert_eq!(
                reconstruct_sparse_output(app_codes.len(), &timestamps, sparse),
                dense
            );
        }

        // 2. Output length always equals input length.
        #[test]
        fn prop_output_length_equals_input_length(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let n = app_codes.len();
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            prop_assert_eq!(out.start_ns.len(), n);
            prop_assert_eq!(out.stop_ns.len(), n);
            prop_assert_eq!(out.missing.len(), n);
        }

        // 3. `missing[i]` is false whenever `start_ns[i] == -1`.
        #[test]
        fn prop_missing_only_set_when_start_is_set(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for i in 0..app_codes.len() {
                if out.start_ns[i] == -1 {
                    prop_assert!(!out.missing[i],
                        "missing[{i}] set but start_ns[{i}] == -1");
                }
            }
        }

        // 4. `missing[i]` true implies `stop_ns[i] == -1`.
        #[test]
        fn prop_missing_implies_no_stop(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for i in 0..app_codes.len() {
                if out.missing[i] {
                    prop_assert_eq!(out.stop_ns[i], -1,
                        "missing[{}] is true but stop_ns[{}] != -1", i, i);
                }
            }
        }

        // 5. A non-sentinel stop requires a non-sentinel start.
        #[test]
        fn prop_stop_requires_start(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for i in 0..app_codes.len() {
                if out.stop_ns[i] != -1 {
                    prop_assert_ne!(out.start_ns[i], -1,
                        "stop_ns[{}] is set but start_ns[{}] == -1", i, i);
                }
            }
        }

        // 6. When a stop is recorded, it is >= the start.
        #[test]
        fn prop_start_before_or_equal_stop(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for i in 0..app_codes.len() {
                if out.stop_ns[i] != -1 {
                    prop_assert!(out.stop_ns[i] >= out.start_ns[i],
                        "stop_ns[{i}]={} < start_ns[{i}]={}", out.stop_ns[i], out.start_ns[i]);
                }
            }
        }

        // 7. Sorted (monotone) timestamps never cause a panic.
        #[test]
        fn prop_sorted_timestamps_dont_panic(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            // timestamps from arb_input are already monotone; just confirm no panic.
            let _ = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
        }

        // 8. Empty input produces empty output.
        #[test]
        fn prop_empty_input_produces_empty_output(options in arb_options()) {
            let out = run(&[], &[], &[], &[], &[], &[], options);
            prop_assert!(out.start_ns.is_empty());
            prop_assert!(out.stop_ns.is_empty());
            prop_assert!(out.missing.is_empty());
        }

        // 9. A single resumed event always produces start_ns[0] != -1,
        //    and either stop_ns[0] == -1 or missing[0] is true (no partner row exists).
        #[test]
        fn prop_single_resumed_always_starts_session(
            app_code in 0i32..7,
            timestamp in 0i64..600,
            options in arb_options(),
        ) {
            let out = run(
                &[app_code],
                &[timestamp],
                &[true],   // resumed
                &[false],  // same_stop
                &[false],  // other_stop
                &[false],  // stopped
                options,
            );
            prop_assert_ne!(out.start_ns[0], -1,
                "single resumed row must open a session");
            // With no stop events the session cannot be closed.
            prop_assert_eq!(out.stop_ns[0], -1);
            prop_assert!(out.missing[0]);
        }

        // 10. When no event flags are set the matcher finds no sessions.
        #[test]
        fn prop_no_events_no_sessions(
            (app_codes, timestamps, ..) in arb_input(50),
            options in arb_options(),
        ) {
            let n = app_codes.len();
            let all_false = vec![false; n];
            let out = run(
                &app_codes, &timestamps,
                &all_false, &all_false, &all_false, &all_false,
                options,
            );
            prop_assert!(out.start_ns.iter().all(|&v| v == -1));
            prop_assert!(out.stop_ns.iter().all(|&v| v == -1));
            prop_assert!(out.missing.iter().all(|&v| !v));
        }

        // 11. Sparse update indices never reference out-of-bounds positions.
        #[test]
        fn prop_sparse_indices_in_bounds(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let n = app_codes.len();
            let sparse = run_update_indices(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for &i in &sparse.start_indices {
                prop_assert!(i < n, "start_index {i} >= len {n}");
            }
            for &i in &sparse.stop_start_indices {
                prop_assert!(i < n, "stop_start_index {i} >= len {n}");
            }
            for &i in &sparse.stop_event_indices {
                prop_assert!(i < n, "stop_event_index {i} >= len {n}");
            }
            for &i in &sparse.missing_indices {
                prop_assert!(i < n, "missing_index {i} >= len {n}");
            }
        }

        // 12. Every session start recorded in the sparse output maps to a
        //     resumed row (start_ns comes directly from timestamps[start_index]).
        #[test]
        fn prop_sparse_start_timestamps_match_input(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let sparse = run_update_indices(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for &i in &sparse.start_indices {
                prop_assert_eq!(
                    timestamps[i], timestamps[i],   // trivially; real check below
                    "invariant placeholder"
                );
                // The reconstructed dense output records timestamps[i] as start.
                let dense = reconstruct_sparse_output(app_codes.len(), &timestamps, {
                    run_update_indices(
                        &app_codes, &timestamps, &resumed, &same_stop,
                        &other_stop, &stopped, options,
                    )
                });
                prop_assert_eq!(dense.start_ns[i], timestamps[i]);
            }
        }

        // 13. All start timestamps in the output are present in the input
        //     timestamp slice (no invented values).
        #[test]
        fn prop_start_ns_values_are_input_timestamps(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for v in &out.start_ns {
                if *v != -1 {
                    prop_assert!(timestamps.contains(v),
                        "start_ns value {v} not found in input timestamps");
                }
            }
        }

        // 14. All stop timestamps in the output are present in the input
        //     timestamp slice (no invented values).
        #[test]
        fn prop_stop_ns_values_are_input_timestamps(
            (app_codes, timestamps, resumed, same_stop, other_stop, stopped)
                in arb_input(50),
            options in arb_options(),
        ) {
            let out = run(
                &app_codes, &timestamps, &resumed, &same_stop, &other_stop,
                &stopped, options,
            );
            for v in &out.stop_ns {
                if *v != -1 {
                    prop_assert!(timestamps.contains(v),
                        "stop_ns value {v} not found in input timestamps");
                }
            }
        }
    }
}
