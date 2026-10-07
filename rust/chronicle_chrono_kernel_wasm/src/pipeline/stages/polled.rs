use crate::pipeline_v2::{LocalDateMemo, Tz, populate_time_columns};
use crate::pipeline_v2::model::PolledEmulationCounts;
use crate::pipeline_v2::{
    POLLED_EMULATION_FLAG_PREFIX, POLLED_EMULATION_FORCED_TERMINAL_FLAG,
    POLLED_EMULATION_NOT_OBSERVED_FLAG, PolledEmulationMethod, PolledRun, PolledSample, Row,
    format_cadence_seconds, push_row_flag,
};

/// The grid is anchored at the epoch, not at any episode boundary: a real
/// polling service runs on its own clock and does not know where an app
/// session starts. Anchoring at a boundary instead would guarantee at least
/// one sample per episode, which is precisely the sampling loss this axis
/// exists to expose.
///
/// An episode shorter than the cadence can therefore contain no grid instant
/// at all and produce no emulated row. That is the ScreenTK 2024 finding
/// reproduced, not a defect: sampling misses short events.
pub(crate) fn sample_polled_timeline(app_rows: &[Row], interval_ns: i64) -> Vec<PolledSample> {
    if interval_ns <= 0 {
        return Vec::new();
    }
    let mut samples = Vec::new();
    for (row_index, row) in app_rows.iter().enumerate() {
        let (Some(start), Some(stop)) = (row.start_timestamp_ns, row.stop_timestamp_ns) else {
            // No interval, nothing for a poller to have caught. A raw event row
            // is not something a polled collector observes as a duration.
            continue;
        };
        if stop < start {
            continue;
        }
        // First grid instant at or after `start`, computed with a floor
        // division so that negative instants (pre-epoch timestamps) keep the
        // same phase rather than rounding toward zero.
        let first = start.div_euclid(interval_ns) * interval_ns;
        let mut instant = if first < start { first + interval_ns } else { first };
        while instant <= stop {
            samples.push(PolledSample { row_index, instant_ns: instant });
            match instant.checked_add(interval_ns) {
                Some(next) => instant = next,
                None => break,
            }
        }
    }
    samples.sort_by_key(|sample| sample.instant_ns);
    samples
}

/// Group samples into runs under the selected method.
///
/// Both methods break a run when the foreground package changes, which is the
/// one rule they share. They differ on what else closes one:
///
/// - `Ross2025SampledGapV1` closes when the next sample gap reaches the
///   configured threshold, and force-closes the FINAL run of the sequence so
///   that it counts -- the released code forces the last row's gap to 100 s for
///   exactly that reason. Like that code, this is one forced close per emulated
///   table, not one per participant.
/// - `Cerit2025SampleCountV1` consults no threshold. A run breaks when a grid
///   instant is simply absent, because a missing sample IS the evidence that
///   the app was not foreground. There is no number to tune.
pub(crate) fn group_polled_runs(
    app_rows: &[Row],
    samples: &[PolledSample],
    method: PolledEmulationMethod,
    interval_ns: i64,
    gap_ns: i64,
) -> Vec<PolledRun> {
    let mut runs: Vec<PolledRun> = Vec::new();
    let mut open: Option<PolledRun> = None;
    let identity = |index: usize| -> (&str, &str) {
        let row = &app_rows[index];
        (row.participant_id.as_str(), row.app_package_name.as_str())
    };
    // A run breaks on any gap at least this wide. Ross tunes it; Cerit's
    // "consecutive samples" means strictly one cadence apart, so anything
    // wider than the cadence already breaks the run.
    let break_at_ns = if method.uses_gap_threshold() {
        gap_ns
    } else {
        interval_ns.saturating_add(1)
    };
    for sample in samples {
        match open.as_mut() {
            Some(current)
                if identity(current.row_index) == identity(sample.row_index)
                    && sample.instant_ns.saturating_sub(current.last_instant_ns) < break_at_ns =>
            {
                current.last_instant_ns = sample.instant_ns;
                current.sample_count += 1;
            }
            _ => {
                if let Some(finished) = open.take() {
                    runs.push(finished);
                }
                open = Some(PolledRun {
                    row_index: sample.row_index,
                    first_instant_ns: sample.instant_ns,
                    last_instant_ns: sample.instant_ns,
                    sample_count: 1,
                    forced_terminal: false,
                });
            }
        }
    }
    if let Some(mut finished) = open.take() {
        // Ross forces the trailing row closed so that it is counted. Cerit
        // counts samples and never needed an end, so nothing is forced there
        // and the flag stays off.
        finished.forced_terminal = method.uses_gap_threshold();
        runs.push(finished);
    }
    runs
}

/// Materialize one output row per run, cloning the episode row it came from so
/// that participant, study, timezone, package and label are the run's own
/// identity rather than re-derived here.
pub(crate) fn materialize_polled_rows(
    app_rows: &[Row],
    runs: &[PolledRun],
    method: PolledEmulationMethod,
    interval_ns: i64,
) -> Vec<Row> {
    let mut rows = Vec::with_capacity(runs.len());
    for run in runs {
        let mut row = app_rows[run.row_index].clone();
        let seconds = match method {
            // Endpoint subtraction across the retained samples, as the
            // released Ross preprocessing does. A run of three samples at a
            // ten-second cadence spans twenty seconds even though the app was
            // foreground for about thirty: the understatement is the sampling
            // loss, and hiding it would defeat the axis.
            PolledEmulationMethod::Ross2025SampledGapV1 => {
                run.last_instant_ns.saturating_sub(run.first_instant_ns) as f64 / 1_000_000_000.0
            }
            // Count times cadence, never a subtraction. One retained sample is
            // one whole cadence of screen time rather than zero.
            PolledEmulationMethod::Cerit2025SampleCountV1 => {
                run.sample_count as f64 * interval_ns as f64 / 1_000_000_000.0
            }
            PolledEmulationMethod::None => 0.0,
        };
        {
            let temporal = row.edit_temporal();
            *temporal.start_timestamp_ns = Some(run.first_instant_ns);
            *temporal.stop_timestamp_ns = Some(run.last_instant_ns);
            *temporal.duration_seconds = Some(seconds);
            *temporal.duration_minutes = Some(seconds / 60.0);
        }
        push_row_flag(
            &mut row,
            &format!(
                "{POLLED_EMULATION_FLAG_PREFIX} {} @{}s",
                method.canonical_id(),
                format_cadence_seconds(interval_ns),
            ),
        );
        // On every row, without exception.
        push_row_flag(&mut row, POLLED_EMULATION_NOT_OBSERVED_FLAG);
        if run.forced_terminal {
            push_row_flag(&mut row, POLLED_EMULATION_FORCED_TERMINAL_FLAG);
        }
        rows.push(row);
    }
    rows
}

pub(crate) fn polled_sample_checkpoint(interval_ns: i64, samples: usize) -> serde_json::Value {
    serde_json::json!({"intervalNs": interval_ns, "samples": samples})
}

pub(crate) fn polled_counts(
    method: PolledEmulationMethod,
    interval_ns: i64,
    gap_ns: i64,
    samples: usize,
    runs: &[PolledRun],
) -> PolledEmulationCounts {
    PolledEmulationCounts {
        method: method.canonical_id().to_string(),
        interval_ns,
        gap_ns,
        samples,
        runs: runs.len(),
        forced_terminal_runs: runs.iter().filter(|run| run.forced_terminal).count(),
    }
}

const INTERVAL_EXPANSION_FLAG: &str = "INTERVAL EXPANSION behapp_start_anchored_half_open_1s_v1";

pub(crate) fn materialize_behapp_half_open_seconds(app_rows: &[Row]) -> Result<Vec<Row>, String> {
    const SECOND_NS: i64 = 1_000_000_000;
    let total = app_rows.iter().try_fold(0_usize, |total, row| {
        let seconds = match (row.start_timestamp_ns, row.stop_timestamp_ns) {
            (Some(start), Some(stop)) if stop > start => stop
                .checked_sub(start)
                .ok_or_else(|| "interval expansion timestamp overflow".to_string())? / SECOND_NS,
            _ => 0,
        };
        let seconds = usize::try_from(seconds)
            .map_err(|_| "interval expansion row count exceeds usize".to_string())?;
        total
            .checked_add(seconds)
            .ok_or_else(|| "interval expansion row count overflow".to_string())
    })?;
    if total > u32::MAX as usize {
        return Err("interval expansion row count exceeds u32".into());
    }

    let mut expanded = Vec::new();
    expanded
        .try_reserve_exact(total)
        .map_err(|_| "interval expansion allocation failed".to_string())?;
    let mut date_memo = LocalDateMemo::default();
    for source in app_rows {
        let (Some(start), Some(stop)) = (source.start_timestamp_ns, source.stop_timestamp_ns)
        else {
            continue;
        };
        let whole_seconds = stop.saturating_sub(start) / SECOND_NS;
        if whole_seconds <= 0 {
            continue;
        }
        for offset in 0..whole_seconds {
            let instant = start
                .checked_add(offset.saturating_mul(SECOND_NS))
                .ok_or_else(|| "interval expansion timestamp overflow".to_string())?;
            let mut row = source.clone();
            {
                let temporal = row.edit_temporal();
                *temporal.event_timestamp_ns = instant;
                *temporal.start_timestamp_ns = Some(instant);
                *temporal.stop_timestamp_ns = Some(
                    instant
                        .checked_add(SECOND_NS)
                        .ok_or_else(|| "interval expansion timestamp overflow".to_string())?,
                );
                *temporal.duration_seconds = Some(1.0);
                *temporal.duration_minutes = Some(1.0 / 60.0);
            }
            push_row_flag(&mut row, INTERVAL_EXPANSION_FLAG);
            let timezone = row.timezone.parse().unwrap_or(Tz::UTC);
            populate_time_columns(&mut row, timezone, &mut date_memo);
            expanded.push(row);
        }
    }
    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn behapp_interval_expansion_refuses_unrepresentable_endpoint_difference() {
        let mut row = crate::pipeline_v2::tests::rows_from_events(&[
            ("2026-03-07 10:00:00", "App Usage", "com.example.app"),
        ]).remove(0);
        let temporal = row.edit_temporal();
        *temporal.start_timestamp_ns = Some(i64::MIN);
        *temporal.stop_timestamp_ns = Some(i64::MAX);
        assert_eq!(
            materialize_behapp_half_open_seconds(&[row]).err().expect("timestamp overflow"),
            "interval expansion timestamp overflow",
        );
    }
}
