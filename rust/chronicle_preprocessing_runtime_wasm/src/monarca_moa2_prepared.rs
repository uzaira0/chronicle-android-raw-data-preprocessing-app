//! Prepared scalar/window and calendar reductions only. No raw acquisition,
//! window constructor, resampling, stationary filter, clock or timezone policy.
//! MONARCA DOI:10.1109/mprv.2015.54 retained Android-cohort source pp4–5,
//! text259–279; MoA2 DOI:10.1145/2968219.2968302 primary p5 text175–183.

use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::keyboard_stress_axis_statistics::{
    reduce_ordered_axis, AxisStatistic, AxisStatisticsCsv,
};
use chronicle_chrono_kernel_wasm::source_local_calendar_weekday;
use std::collections::{BTreeMap, BTreeSet};

fn result(statistic: &'static str, value: Option<f64>, reason: &'static str) -> AxisStatistic {
    AxisStatistic {
        statistic,
        value,
        status: if value.is_some() {
            "computed"
        } else {
            "arithmetic_unavailable"
        },
        reason,
        output_unit_relation: "input_unit",
    }
}

/// sqrt(mean_energy), reusing the reviewed finite-sample formula and its
/// numerical-loss guards. Other Table 4 statistic statuses do not gate RMS.
pub(crate) fn prepared_scalar_rms(samples: &[f64]) -> Result<AxisStatistic, String> {
    let energy = reduce_ordered_axis(samples)?
        .into_iter()
        .find(|x| x.statistic == "mean_energy")
        .ok_or("reviewed axis reducer lacks mean_energy")?;
    Ok(result(
        "root_mean_square",
        energy.value.map(f64::sqrt),
        energy.reason,
    ))
}

pub(crate) fn prepared_daily_rms_mean(windows: &[AxisStatistic]) -> Result<AxisStatistic, String> {
    if windows.is_empty() {
        return Err("MONARCA daily mean requires supplied windows".into());
    }
    let Some(values) = windows.iter().map(|x| x.value).collect::<Option<Vec<_>>>() else {
        return Ok(result(
            "daily_mean_root_mean_square",
            None,
            "window_rms_unavailable",
        ));
    };
    // Finite qualification is established by the reviewed RMS result. Missing
    // windows are not dropped through the shared helper's other-source policy.
    let rows = values
        .iter()
        .map(|x| GroupedNumericRow {
            group: Some("supplied_day".into()),
            values: vec![Some(*x)],
        })
        .collect::<Vec<_>>();
    let mean = summarize_columns_by_first_seen_group(&rows)
        .map_err(|_| "MONARCA supplied-day mean failed")?[0]
        .means[0];
    Ok(if !mean.is_finite() {
        result("daily_mean_root_mean_square", None, "nonfinite_arithmetic")
    } else if mean == 0.0 && values.iter().any(|x| *x != 0.0) {
        result(
            "daily_mean_root_mean_square",
            None,
            "floating_point_mean_underflow",
        )
    } else {
        result("daily_mean_root_mean_square", Some(mean), "")
    })
}

/// All identities and unit labels remain lexical. Order is caller-supplied;
/// order gaps are not clocks. Width=10 qualifies membership, not endpoints,
/// overlap/stride, cadence, acquisition rate, or a fixed sample count.
pub(crate) fn prepare_monarca_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|e| format!("MONARCA header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("MONARCA refuses duplicate columns".into());
    }
    let required = |field| {
        headers
            .iter()
            .position(|h| h == field)
            .ok_or_else(|| format!("MONARCA requires {field}"))
    };
    let participant = required("participant_id")?;
    let day = required("day_id")?;
    let stream = required("stream_id")?;
    let window = required("window_id")?;
    let window_order = required("window_order")?;
    let sample = required("sample_id")?;
    let sample_order = required("sample_order")?;
    let value = required("value")?;
    let unit = required("input_unit")?;
    let width = required("window_duration_seconds")?;
    type DayKey = (String, String, String);
    type Windows = BTreeMap<String, (u64, Vec<(u64, f64)>)>;
    let mut groups = BTreeMap::<DayKey, (String, Windows)>::new();
    let mut group_order = Vec::new();
    let mut sample_ids = BTreeSet::new();
    let mut sample_orders = BTreeSet::new();
    let mut window_orders = BTreeSet::new();
    let mut source_row_count = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("MONARCA row: {e}"))?;
        for field in [participant, day, stream, window, sample, unit] {
            if record[field].trim().is_empty() {
                return Err(format!("MONARCA requires nonblank {}", &headers[field]));
            }
        }
        if record[width].parse::<f64>().ok() != Some(10.0) {
            return Err("MONARCA requires supplied ten-second membership, not cadence/gap".into());
        }
        let scalar = record[value]
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite())
            .ok_or("MONARCA requires finite samples; missingness is not inferred")?;
        let wo = record[window_order]
            .parse::<u64>()
            .map_err(|_| "MONARCA requires unsigned integer window_order")?;
        let so = record[sample_order]
            .parse::<u64>()
            .map_err(|_| "MONARCA requires unsigned integer sample_order")?;
        let key = (
            record[participant].to_owned(),
            record[day].to_owned(),
            record[stream].to_owned(),
        );
        let scope = (key.clone(), record[window].to_owned());
        if !sample_ids.insert((scope.clone(), record[sample].to_owned()))
            || !sample_orders.insert((scope, so))
        {
            return Err(
                "MONARCA refuses duplicate sample identity/order within a supplied window".into(),
            );
        }
        if !groups.contains_key(&key) {
            group_order.push(key.clone());
        }
        let group = groups
            .entry(key.clone())
            .or_insert_with(|| (record[unit].to_owned(), BTreeMap::new()));
        if group.0 != record[unit] {
            return Err(
                "MONARCA requires one unchanged input_unit per participant/day/stream".into(),
            );
        }
        if !group.1.contains_key(&record[window]) && !window_orders.insert((key, wo)) {
            return Err(
                "MONARCA refuses duplicate window order within a supplied day/stream".into(),
            );
        }
        let members = group
            .1
            .entry(record[window].to_owned())
            .or_insert_with(|| (wo, Vec::new()));
        if members.0 != wo {
            return Err("MONARCA window_order changes within one window".into());
        }
        members.1.push((so, scalar));
        source_row_count += 1;
    }
    if source_row_count == 0 {
        return Err("MONARCA requires supplied sample rows".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "day_id",
            "stream_id",
            "input_unit",
            "window_id",
            "window_order",
            "window_duration_seconds",
            "sample_count",
            "window_count",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| format!("MONARCA output header: {e}"))?;
    let mut output_row_count = 0;
    for key in group_order {
        let (unit, windows) = groups.remove(&key).ok_or("MONARCA lost supplied group")?;
        let mut windows = windows.into_iter().collect::<Vec<_>>();
        windows.sort_by_key(|(_, (order, _))| *order);
        let count = windows.len();
        let total_samples = windows
            .iter()
            .map(|(_, (_, values))| values.len())
            .sum::<usize>();
        let mut reductions = Vec::new();
        for (window, (order, mut samples)) in windows {
            samples.sort_by_key(|x| x.0);
            let values = samples.iter().map(|x| x.1).collect::<Vec<_>>();
            let rms = prepared_scalar_rms(&values)?;
            if selected.contains(rms.statistic) {
                writer
                    .serialize((
                        &key.0,
                        &key.1,
                        &key.2,
                        &unit,
                        window,
                        Some(order),
                        Some(10),
                        values.len(),
                        count,
                        rms.statistic,
                        rms.value,
                        rms.status,
                        rms.reason,
                        rms.output_unit_relation,
                    ))
                    .map_err(|e| format!("MONARCA window output: {e}"))?;
                output_row_count += 1;
            }
            reductions.push(rms);
        }
        let mean = prepared_daily_rms_mean(&reductions)?;
        if selected.contains(mean.statistic) {
            writer
                .serialize((
                    &key.0,
                    &key.1,
                    &key.2,
                    &unit,
                    "",
                    None::<u64>,
                    None::<u64>,
                    total_samples,
                    count,
                    mean.statistic,
                    mean.value,
                    mean.status,
                    mean.reason,
                    mean.output_unit_relation,
                ))
                .map_err(|e| format!("MONARCA daily output: {e}"))?;
            output_row_count += 1;
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer
            .into_inner()
            .map_err(|e| format!("MONARCA output: {e}"))?,
        source_row_count,
        output_row_count,
    })
}

pub(crate) fn prepare_moa2_calendar_csv(input: &[u8]) -> Result<AxisStatisticsCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|e| format!("MoA2 header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("MoA2 refuses duplicate columns".into());
    }
    let required = |field| {
        headers
            .iter()
            .position(|h| h == field)
            .ok_or_else(|| format!("MoA2 requires {field}"))
    };
    let participant = required("participant_id")?;
    let row = required("source_row_id")?;
    let date = required("source_local_date")?;
    let mut identities = BTreeSet::new();
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "source_row_id",
            "source_local_date",
            "weekday_weekend_type",
            "status",
        ])
        .map_err(|e| format!("MoA2 output header: {e}"))?;
    let mut source_row_count = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("MoA2 row: {e}"))?;
        if record[participant].trim().is_empty() || record[row].trim().is_empty() {
            return Err("MoA2 requires nonblank lexical participant/source-row identities".into());
        }
        if !identities.insert((record[participant].to_owned(), record[row].to_owned())) {
            return Err("MoA2 refuses duplicate source row within participant".into());
        }
        let weekday = source_local_calendar_weekday(&record[date]).ok_or(
            "MoA2 requires a valid supplied YYYY-MM-DD source-local calendar date, not a timestamp",
        )?;
        writer
            .write_record([
                &record[participant],
                &record[row],
                &record[date],
                if weekday == 1 || weekday == 7 {
                    "weekend"
                } else {
                    "weekday"
                },
                "computed",
            ])
            .map_err(|e| format!("MoA2 output row: {e}"))?;
        source_row_count += 1;
    }
    if source_row_count == 0 {
        return Err("MoA2 requires supplied calendar rows".into());
    }
    Ok(AxisStatisticsCsv {
        bytes: writer
            .into_inner()
            .map_err(|e| format!("MoA2 output: {e}"))?,
        source_row_count,
        output_row_count: source_row_count,
    })
}
