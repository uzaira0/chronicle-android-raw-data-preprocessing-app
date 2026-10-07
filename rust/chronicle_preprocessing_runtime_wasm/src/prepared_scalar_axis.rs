//! STDD named reductions on complete caller-supplied fifty-sample axis windows;
//! Touchstroke mean only on caller-supplied attempt/stream/dimension members.
//! DOI:10.3390/s20051396 retained primary pp8-9/text727-750 and Table 2.
//! The paper names the statistics; it does not publish author code/defaults.
//! No raw grid, overlap, anchor, resampling, missingness or vector is recovered.

use crate::keyboard_stress_axis_statistics::{
    mean_energy_only, ordered_square_sum, AxisStatistic, AxisStatisticsCsv,
};
use crate::prepared_sensor_window::reduce_s3_axis;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const STDD_STATISTICS: [&str; 9] = [
    "arithmetic_mean", "maximum", "minimum", "root_mean_square",
    "root_sum_square", "sum", "sum_absolute_values", "mean_absolute_values", "range",
];

/// Only the nine named scalar operations. In particular this never calls the
/// complete keyboard reducer or computes STDD's unspecified energy/moment/quartile features.
pub(crate) fn reduce_stdd_axis(samples: &[f64]) -> Result<Vec<AxisStatistic>, String> {
    if samples.len() != 50 || samples.iter().any(|x| !x.is_finite()) {
        return Err("STDD requires a complete supplied fifty-sample finite axis window".into());
    }
    let base = reduce_s3_axis(samples)?;
    let inherited = |source_name, name| -> Result<AxisStatistic, String> {
        let value = &base.iter().find(|(statistic, _)| *statistic == source_name)
            .ok_or("reviewed prepared sensor reducer lacks a required scalar")?.1;
        Ok(AxisStatistic {
            statistic: name, value: value.value, status: value.status,
            reason: value.reason, output_unit_relation: "input_unit",
        })
    };
    let numeric = |name, value| AxisStatistic::computed(name, value, "input_unit");
    let underflow = |name| AxisStatistic::unavailable(
        name, "arithmetic_unavailable", "floating_point_energy_underflow", "input_unit",
    );
    let energy = mean_energy_only(samples)?;
    let rms = AxisStatistic {
        statistic: "root_mean_square", value: energy.value.map(f64::sqrt),
        status: energy.status, reason: energy.reason, output_unit_relation: "input_unit",
    };
    // RSS uses the shared squared sum directly, not RMS * sqrt(n), and remains
    // independently computable if only mean-energy division loses the value.
    let squared_sum = ordered_square_sum(samples);
    let rss = if squared_sum == 0.0 && samples.iter().any(|x| *x != 0.0) {
        underflow("root_sum_square")
    } else {
        numeric("root_sum_square", squared_sum.sqrt())
    };
    let absolute_sum = samples.iter().map(|x| x.abs()).sum::<f64>();
    let absolute_mean = absolute_sum / 50.0;
    let absolute_mean = if absolute_mean == 0.0 && absolute_sum != 0.0 {
        AxisStatistic::unavailable(
            "mean_absolute_values", "arithmetic_unavailable",
            "floating_point_mean_underflow", "input_unit",
        )
    } else {
        numeric("mean_absolute_values", absolute_mean)
    };
    Ok(vec![
        inherited("average", "arithmetic_mean")?,
        inherited("maximum", "maximum")?,
        inherited("minimum", "minimum")?,
        rms, rss,
        numeric("sum", samples.iter().sum::<f64>()),
        numeric("sum_absolute_values", absolute_sum),
        absolute_mean,
        inherited("peak_to_peak", "range")?,
    ])
}

/// Membership is caller-resolved. Fifty finite records and the supplied width
/// qualify a complete axis window; integer order labels are not a regular grid.
/// First-seen window groups are retained, and arithmetic follows numeric order.
pub(crate) fn prepare_stdd_csv(
    input: &[u8], selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    if selected.is_empty() || selected.iter().any(|x| !STDD_STATISTICS.contains(x)) {
        return Err("STDD requires one or more of its nine exact scalar statistics".into());
    }
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| format!("STDD header: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("STDD refuses duplicate column names".into());
    }
    let required = |field| headers.iter().position(|x| x == field)
        .ok_or_else(|| format!("STDD requires {field}"));
    let participant = required("participant_id")?;
    let device_type = required("device_type")?;
    let device_id = required("device_id")?;
    let axis = required("axis")?;
    let window = required("window_id")?;
    let sample_id = required("sample_id")?;
    let order = required("sample_order")?;
    let value = required("value")?;
    let unit = required("input_unit")?;
    let width = required("window_duration_seconds")?;
    type Scope = (String, String, String, String, String);
    let mut group_indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, String, Vec<(u64, f64)>)>::new();
    let mut sample_ids = BTreeSet::new();
    let mut sample_orders = BTreeSet::new();
    let mut source_row_count = 0;
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("STDD row {}: {e}", index + 1))?;
        for field in [participant, device_type, device_id, axis, window, sample_id, unit] {
            if record[field].trim().is_empty() {
                return Err(format!("STDD requires nonblank {}", &headers[field]));
            }
        }
        if !matches!(&record[device_type], "phone" | "watch")
            || !matches!(&record[axis], "x" | "y" | "z")
        {
            return Err("STDD requires a supplied phone/watch accelerometer axis x/y/z".into());
        }
        if record[width].parse::<f64>().ok() != Some(1.0) {
            return Err("STDD supplied memberships must declare the source one-second window, not a cadence or gap".into());
        }
        let scalar = record[value].parse::<f64>().ok().filter(|x| x.is_finite())
            .ok_or("STDD requires finite value; no missingness or imputation is inferred")?;
        let sample_order = record[order].parse::<u64>()
            .map_err(|_| "STDD requires unsigned integer sample_order")?;
        let scope = (
            record[participant].to_owned(), record[device_type].to_owned(),
            record[device_id].to_owned(), record[axis].to_owned(), record[window].to_owned(),
        );
        if !sample_ids.insert((scope.clone(), record[sample_id].to_owned()))
            || !sample_orders.insert((scope.clone(), sample_order))
        {
            return Err("STDD refuses duplicate scoped sample identity or order".into());
        }
        let next = groups.len();
        let group_index = *group_indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope, record[unit].to_owned(), Vec::new()));
            next
        });
        let group = &mut groups[group_index];
        if group.1 != record[unit] {
            return Err("STDD requires one unchanged lexical input_unit per supplied axis window".into());
        }
        group.2.push((sample_order, scalar));
        source_row_count += 1;
    }
    if groups.is_empty() || groups.iter().any(|(_, _, samples)| samples.len() != 50) {
        return Err("STDD requires exactly fifty supplied samples in every complete axis window".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer.write_record([
        "participant_id", "device_type", "device_id", "axis", "window_id", "input_unit",
        "window_duration_seconds", "sample_count", "statistic", "value",
        "status", "reason", "output_unit_relation",
    ]).map_err(|e| format!("STDD output header: {e}"))?;
    let mut output_row_count = 0;
    for (scope, unit, mut samples) in groups {
        samples.sort_by_key(|x| x.0);
        let values = samples.iter().map(|x| x.1).collect::<Vec<_>>();
        for result in reduce_stdd_axis(&values)? {
            if !selected.contains(result.statistic) { continue; }
            writer.serialize((
                &scope.0, &scope.1, &scope.2, &scope.3, &scope.4, &unit,
                1, values.len(), result.statistic, result.value,
                result.status, result.reason, result.output_unit_relation,
            )).map_err(|e| format!("STDD output row: {e}"))?;
            output_row_count += 1;
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| format!("STDD output: {e}"))?,
        source_row_count, output_row_count,
    })
}

/// The qualified S3 arithmetic-mean body uses the existing grouped summary;
/// no Touchstroke SD/skewness/kurtosis convention is introduced.
pub(crate) fn prepared_mean_only(samples: &[f64]) -> Result<AxisStatistic, String> {
    let mean = reduce_s3_axis(samples)?.into_iter()
        .find(|(statistic, _)| *statistic == "average")
        .ok_or("reviewed prepared sensor reducer lacks arithmetic mean")?.1;
    Ok(AxisStatistic {
        statistic: "arithmetic_mean", value: mean.value, status: mean.status,
        reason: mean.reason, output_unit_relation: "input_unit",
    })
}

/// Touchstroke primary p32/PDFp6/text242-247 names mean on x/y/z/magnitude
/// for each sensor. Attempt, stream and dimension memberships are supplied,
/// not acquired, filtered, synchronized, reconstructed or expanded to a matrix.
pub(crate) fn prepare_touchstroke_mean_csv(input: &[u8]) -> Result<AxisStatisticsCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| format!("Touchstroke mean header: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Touchstroke mean refuses duplicate columns".into());
    }
    let required = |field| headers.iter().position(|x| x == field)
        .ok_or_else(|| format!("Touchstroke mean requires {field}"));
    let participant = required("participant_id")?;
    let attempt = required("attempt_id")?;
    let stream = required("sensor_stream")?;
    let dimension = required("dimension")?;
    let sample = required("sample_id")?;
    let order = required("sample_order")?;
    let value = required("value")?;
    let unit = required("input_unit")?;
    type Scope = (String, String, String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, String, Vec<(u64, f64)>)>::new();
    let mut sample_ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut source_row_count = 0;
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("Touchstroke mean row {}: {e}", index + 1))?;
        for field in [participant, attempt, stream, dimension, sample, unit] {
            if record[field].trim().is_empty() {
                return Err(format!("Touchstroke mean requires nonblank {}", &headers[field]));
            }
        }
        if !matches!(&record[stream], "raw_accelerometer" | "low_pass_accelerometer"
            | "high_pass_accelerometer" | "gravity" | "gyroscope" | "magnetometer" | "orientation")
            || !matches!(&record[dimension], "x" | "y" | "z" | "magnitude")
        {
            return Err("Touchstroke mean requires a disclosed sensor stream and x/y/z/magnitude dimension".into());
        }
        let scalar = record[value].parse::<f64>().ok().filter(|x| x.is_finite())
            .ok_or("Touchstroke mean requires finite supplied values; no missingness is inferred")?;
        if &record[dimension] == "magnitude" && scalar < 0.0 {
            return Err("Touchstroke supplied magnitude must be nonnegative; magnitude is not constructed here".into());
        }
        let sample_order = record[order].parse::<u64>()
            .map_err(|_| "Touchstroke mean requires unsigned integer sample_order")?;
        let scope = (
            record[participant].to_owned(), record[attempt].to_owned(),
            record[stream].to_owned(), record[dimension].to_owned(),
        );
        if !sample_ids.insert((scope.clone(), record[sample].to_owned()))
            || !orders.insert((scope.clone(), sample_order))
        {
            return Err("Touchstroke mean refuses duplicate scoped sample identity or order".into());
        }
        let next = groups.len();
        let group_index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope, record[unit].to_owned(), Vec::new()));
            next
        });
        let group = &mut groups[group_index];
        if group.1 != record[unit] {
            return Err("Touchstroke mean requires one unchanged lexical unit per supplied dimension".into());
        }
        group.2.push((sample_order, scalar));
        source_row_count += 1;
    }
    if groups.is_empty() {
        return Err("Touchstroke mean requires nonempty supplied memberships".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer.write_record([
        "participant_id", "attempt_id", "sensor_stream", "dimension", "input_unit",
        "sample_count", "statistic", "value", "status", "reason", "output_unit_relation",
    ]).map_err(|e| format!("Touchstroke mean output header: {e}"))?;
    for (scope, unit, samples) in &mut groups {
        samples.sort_by_key(|x| x.0);
        let values = samples.iter().map(|x| x.1).collect::<Vec<_>>();
        let result = prepared_mean_only(&values)?;
        writer.serialize((
            &scope.0, &scope.1, &scope.2, &scope.3, &unit, values.len(),
            result.statistic, result.value, result.status, result.reason, result.output_unit_relation,
        )).map_err(|e| format!("Touchstroke mean output row: {e}"))?;
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| format!("Touchstroke mean output: {e}"))?,
        source_row_count, output_row_count: groups.len(),
    })
}
