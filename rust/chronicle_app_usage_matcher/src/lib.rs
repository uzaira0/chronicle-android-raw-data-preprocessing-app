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
        return Err(MatcherError::new("all input arrays must have the same length"));
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
}
