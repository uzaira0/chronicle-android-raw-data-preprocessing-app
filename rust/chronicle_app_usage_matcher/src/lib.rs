use numpy::PyReadonlyArray1;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyModule;

#[derive(Debug, Clone, Copy)]
struct MatchOptions {
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MatchOutput {
    start_ns: Vec<i64>,
    stop_ns: Vec<i64>,
    missing: Vec<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MatchUpdateIndices {
    start_indices: Vec<usize>,
    stop_start_indices: Vec<usize>,
    stop_event_indices: Vec<usize>,
    missing_indices: Vec<usize>,
}

fn validate_lengths(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
) -> PyResult<usize> {
    let len = app_codes.len();
    if timestamp_ns.len() != len
        || resumed.len() != len
        || same_stop.len() != len
        || other_stop.len() != len
        || stopped.len() != len
    {
        return Err(PyValueError::new_err(
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

fn compatible_open_starts_for_stop(
    stop_index: usize,
    app_codes: &[i32],
    timestamp_ns: &[i64],
    open_start_indices: &[usize],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    options: MatchOptions,
) -> Vec<usize> {
    let current_app = app_codes[stop_index];
    let normal_stop = same_stop[stop_index] || other_stop[stop_index];
    let fallback_stop = stopped[stop_index] && options.use_activity_stopped_as_fallback;
    let mut compatible = Vec::new();

    for &start_index in open_start_indices {
        let start_app = app_codes[start_index];
        let same_app_compatible = same_stop[stop_index] && start_app == current_app;
        let other_app_compatible = other_stop[stop_index] && start_app != current_app;
        let fallback_compatible = !normal_stop && fallback_stop && start_app == current_app;

        if !(same_app_compatible || other_app_compatible || fallback_compatible) {
            continue;
        }

        let enforce_threshold = !fallback_compatible || options.apply_threshold_to_fallback;
        if is_valid_duration(
            timestamp_ns[start_index],
            timestamp_ns[stop_index],
            enforce_threshold,
            options.long_duration_threshold_ns,
        ) {
            compatible.push(start_index);
        }
    }

    compatible
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
    let current_app = app_codes[stop_index];
    let normal_stop = same_stop[stop_index] || other_stop[stop_index];
    let fallback_stop = stopped[stop_index] && options.use_activity_stopped_as_fallback;

    for &start_index in open_start_indices.iter().rev() {
        let start_app = app_codes[start_index];
        let same_app_compatible = same_stop[stop_index] && start_app == current_app;
        let other_app_compatible = other_stop[stop_index] && start_app != current_app;
        let fallback_compatible = !normal_stop && fallback_stop && start_app == current_app;

        if !(same_app_compatible || other_app_compatible || fallback_compatible) {
            continue;
        }

        let enforce_threshold = !fallback_compatible || options.apply_threshold_to_fallback;
        if is_valid_duration(
            timestamp_ns[start_index],
            timestamp_ns[stop_index],
            enforce_threshold,
            options.long_duration_threshold_ns,
        ) {
            return Some(start_index);
        }
    }

    None
}

fn match_app_usage_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    options: MatchOptions,
) -> PyResult<MatchOutput> {
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
            let compatible_open_starts = compatible_open_starts_for_stop(
                index,
                app_codes,
                timestamp_ns,
                &open_start_indices,
                same_stop,
                other_stop,
                stopped,
                options,
            );

            for start_index in compatible_open_starts {
                stop_ns[start_index] = current_timestamp;
                if let Some(position) = open_start_indices.iter().position(|&i| i == start_index) {
                    open_start_indices.remove(position);
                }
            }
        } else if is_normal_stop || is_fallback_stop {
            if let Some(start_index) = nearest_compatible_open_start_for_stop(
                index,
                app_codes,
                timestamp_ns,
                &open_start_indices,
                same_stop,
                other_stop,
                stopped,
                options,
            ) {
                stop_ns[start_index] = current_timestamp;
                if let Some(position) = open_start_indices.iter().position(|&i| i == start_index) {
                    open_start_indices.remove(position);
                }
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

fn match_app_usage_update_indices_core(
    app_codes: &[i32],
    timestamp_ns: &[i64],
    resumed: &[bool],
    same_stop: &[bool],
    other_stop: &[bool],
    stopped: &[bool],
    options: MatchOptions,
) -> PyResult<MatchUpdateIndices> {
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
    let mut open_start_indices: Vec<usize> = Vec::new();

    for index in 0..len {
        let is_normal_stop = same_stop[index] || other_stop[index];
        let is_fallback_stop = stopped[index] && options.use_activity_stopped_as_fallback;

        if options.allow_stop_event_reuse && (is_normal_stop || is_fallback_stop) {
            let compatible_open_starts = compatible_open_starts_for_stop(
                index,
                app_codes,
                timestamp_ns,
                &open_start_indices,
                same_stop,
                other_stop,
                stopped,
                options,
            );

            for start_index in compatible_open_starts {
                stop_start_indices.push(start_index);
                stop_event_indices.push(index);
                if let Some(position) = open_start_indices.iter().position(|&i| i == start_index) {
                    open_start_indices.remove(position);
                }
            }
        } else if is_normal_stop || is_fallback_stop {
            if let Some(start_index) = nearest_compatible_open_start_for_stop(
                index,
                app_codes,
                timestamp_ns,
                &open_start_indices,
                same_stop,
                other_stop,
                stopped,
                options,
            ) {
                stop_start_indices.push(start_index);
                stop_event_indices.push(index);
                if let Some(position) = open_start_indices.iter().position(|&i| i == start_index) {
                    open_start_indices.remove(position);
                }
            }
        }

        if resumed[index] {
            start_indices.push(index);
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
    )?;

    Ok((output.start_ns, output.stop_ns, output.missing))
}

#[allow(clippy::type_complexity)]
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
    )?;

    Ok((
        output.start_indices,
        output.stop_start_indices,
        output.stop_event_indices,
        output.missing_indices,
    ))
}

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
    )?;

    Ok((output.start_ns, output.stop_ns, output.missing))
}

#[pymodule]
fn _rust_app_usage_matcher(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(match_app_usage, m)?)?;
    m.add_function(wrap_pyfunction!(match_app_usage_update_indices, m)?)?;
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
}
