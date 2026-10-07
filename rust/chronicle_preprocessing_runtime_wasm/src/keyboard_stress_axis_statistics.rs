//! Literal Table 4 reductions on a caller-supplied ordered, finite axis window.
//! DOI:10.1007/s10916-020-1530-z, retained 110-primary.pdf p8,
//! SHA256 c253f1743a27407de8a5588cac89d9932a83b222a31c34d39abd46ca127f3101.
//! This does not construct windows or recover author ordering, missingness,
//! units, release-field mapping, fractional-rank interpolation or intended SK/K.

use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, PartialEq)]
pub(crate) struct AxisStatistic {
    pub statistic: &'static str,
    pub value: Option<f64>,
    pub status: &'static str,
    pub reason: &'static str,
    pub output_unit_relation: &'static str,
}

impl AxisStatistic {
    pub(crate) fn computed(statistic: &'static str, value: f64, unit: &'static str) -> Self {
        if !value.is_finite() {
            return Self::unavailable(
                statistic,
                "arithmetic_unavailable",
                "nonfinite_arithmetic",
                unit,
            );
        }
        Self {
            statistic,
            value: Some(value),
            status: "computed",
            reason: "",
            output_unit_relation: unit,
        }
    }

    pub(crate) fn unavailable(
        statistic: &'static str,
        status: &'static str,
        reason: &'static str,
        unit: &'static str,
    ) -> Self {
        Self {
            statistic,
            value: None,
            status,
            reason,
            output_unit_relation: unit,
        }
    }
}

/// The reviewed ordered sum-of-squares expression, shared without executing
/// any other Table 4 statistic. Callers qualify nonempty finite samples.
pub(crate) fn ordered_square_sum(samples: &[f64]) -> f64 {
    samples.iter().map(|value| value * value).sum::<f64>()
}

/// Only Table 4 equation 16, preserving its existing arithmetic/underflow
/// statuses. This does not dispatch quartiles, moments or other statistics.
pub(crate) fn mean_energy_only(samples: &[f64]) -> Result<AxisStatistic, String> {
    if samples.is_empty() || samples.iter().any(|value| !value.is_finite()) {
        return Err("axis statistics require a nonempty finite supplied window".into());
    }
    let energy = ordered_square_sum(samples);
    let mean_energy = energy / samples.len() as f64;
    Ok(if mean_energy == 0.0 && samples.iter().any(|value| *value != 0.0) {
        AxisStatistic::unavailable(
            "mean_energy", "arithmetic_unavailable",
            "floating_point_energy_underflow", "input_unit_squared",
        )
    } else {
        AxisStatistic::computed("mean_energy", mean_energy, "input_unit_squared")
    })
}

/// The order is the table's enumeration, not a recovered 112-vector serializer.
pub(crate) fn reduce_ordered_axis(samples: &[f64]) -> Result<Vec<AxisStatistic>, String> {
    if samples.is_empty() || samples.iter().any(|value| !value.is_finite()) {
        return Err("axis statistics require a nonempty finite supplied window".into());
    }
    let extrema = finite_scalar_extrema_by_group(samples.iter().map(|value| ((), *value)))
        .map_err(|_| "axis statistics require finite samples")?;
    // Strict finite validation above prevents this shared helper's NA-removal
    // policy from silently becoming a policy for the paper.
    let rows = samples
        .iter()
        .map(|value| GroupedNumericRow {
            group: Some("supplied_axis".into()),
            values: vec![Some(*value)],
        })
        .collect::<Vec<_>>();
    let summary = summarize_columns_by_first_seen_group(&rows)
        .map_err(|_| "axis statistics could not summarize the supplied window")?;
    let mean = summary[0].means[0];
    let sd = summary[0].sample_standard_deviations[0];
    let n = samples.len() as f64;
    let sum = samples.iter().sum::<f64>();
    let moment = |power| {
        samples
            .iter()
            .map(|value| (*value - mean).powi(power))
            .sum::<f64>()
    };
    let squared_deviations = moment(2);
    let variance = squared_deviations / (n - 1.0);
    let moment_underflow = (squared_deviations == 0.0 || variance == 0.0)
        && samples.iter().any(|value| *value != mean);
    let simple = |name, value, unit| AxisStatistic::computed(name, value, unit);
    let undefined =
        |name, reason, unit| AxisStatistic::unavailable(name, "source_undefined", reason, unit);
    let arithmetic = |name, reason, unit| {
        AxisStatistic::unavailable(name, "arithmetic_unavailable", reason, unit)
    };
    let product = samples.iter().product::<f64>();
    let geometric = if !product.is_finite() {
        arithmetic("geometric_mean", "nonfinite_arithmetic", "input_unit")
    } else if product == 0.0 && samples.iter().all(|value| *value != 0.0) {
        arithmetic(
            "geometric_mean",
            "floating_point_product_underflow",
            "input_unit",
        )
    } else if product < 0.0 && samples.len().is_multiple_of(2) {
        undefined(
            "geometric_mean",
            "negative_product_even_root_has_no_real_value",
            "input_unit",
        )
    } else {
        let root = if product < 0.0 {
            -(-product).powf(1.0 / n)
        } else {
            product.powf(1.0 / n)
        };
        simple("geometric_mean", root, "input_unit")
    };
    let harmonic = if samples.contains(&0.0) {
        undefined(
            "harmonic_mean",
            "zero_sample_reciprocal_undefined",
            "input_unit",
        )
    } else {
        let reciprocal_sum = samples.iter().map(|value| 1.0 / value).sum::<f64>();
        if !reciprocal_sum.is_finite() {
            arithmetic("harmonic_mean", "nonfinite_arithmetic", "input_unit")
        } else if reciprocal_sum == 0.0 {
            undefined(
                "harmonic_mean",
                "zero_reciprocal_sum_has_no_finite_value",
                "input_unit",
            )
        } else {
            simple("harmonic_mean", n / reciprocal_sum, "input_unit")
        }
    };
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let quartile = |name, numerator, denominator| {
        let rank_numerator = samples
            .len()
            .checked_add(1)
            .and_then(|n| n.checked_mul(numerator));
        match rank_numerator {
            Some(rank) if rank % denominator != 0 => undefined(
                name,
                "fractional_rank_interpolation_undisclosed",
                "input_unit",
            ),
            Some(rank) if rank / denominator >= 1 && rank / denominator <= sorted.len() => {
                simple(name, sorted[rank / denominator - 1], "input_unit")
            }
            Some(_) => undefined(name, "rank_outside_supplied_window", "input_unit"),
            None => arithmetic(name, "rank_arithmetic_overflow", "input_unit"),
        }
    };
    let rooted_moment = |name, power| {
        let Some(sd) = sd else {
            return undefined(name, "requires_at_least_two_samples", "dimensionless");
        };
        if sd == 0.0 {
            if moment_underflow {
                return arithmetic(name, "floating_point_moment_underflow", "dimensionless");
            }
            return undefined(
                name,
                "zero_standard_deviation_convention_undisclosed",
                "dimensionless",
            );
        }
        let numerator = moment(power);
        let denominator = (n - 1.0) * sd.powi(power);
        if !numerator.is_finite() || !denominator.is_finite() || denominator == 0.0 {
            return arithmetic(name, "nonfinite_or_underflow_arithmetic", "dimensionless");
        }
        let radicand = numerator / denominator;
        if radicand < 0.0 {
            return undefined(
                name,
                "printed_square_root_has_negative_radicand",
                "dimensionless",
            );
        }
        simple(name, radicand.sqrt(), "dimensionless")
    };
    let zero_crossings = samples
        .windows(2)
        .filter(|pair| {
            (pair[0] < 0.0 && pair[1] > 0.0)
                || (pair[0] > 0.0 && pair[1] < 0.0)
                || (pair[0] != 0.0 && pair[1] == 0.0)
        })
        .count();
    Ok(vec![
        simple("minimum", extrema[0].minimum, "input_unit"),
        simple("maximum", extrema[0].maximum, "input_unit"),
        sd.map(|value| {
            if moment_underflow {
                arithmetic(
                    "sample_standard_deviation",
                    "floating_point_moment_underflow",
                    "input_unit",
                )
            } else {
                simple("sample_standard_deviation", value, "input_unit")
            }
        })
        .unwrap_or_else(|| {
            undefined(
                "sample_standard_deviation",
                "requires_at_least_two_samples",
                "input_unit",
            )
        }),
        simple("arithmetic_mean", mean, "input_unit"),
        simple("absolute_arithmetic_mean", mean.abs(), "input_unit"),
        geometric,
        harmonic,
        simple("sum", sum, "input_unit"),
        quartile("first_quartile", 1, 4),
        quartile("median", 1, 2),
        quartile("third_quartile", 3, 4),
        if moment_underflow {
            arithmetic(
                "sample_variance",
                "floating_point_moment_underflow",
                "input_unit_squared",
            )
        } else if samples.len() >= 2 {
            simple("sample_variance", variance, "input_unit_squared")
        } else {
            undefined(
                "sample_variance",
                "requires_at_least_two_samples",
                "input_unit_squared",
            )
        },
        rooted_moment("literal_root_skewness", 3),
        rooted_moment("literal_root_kurtosis", 4),
        simple("zero_crossings", zero_crossings as f64, "count"),
        mean_energy_only(samples)?,
        simple(
            "mean_curve_length",
            samples
                .windows(2)
                .map(|pair| (pair[1] - pair[0]).abs())
                .sum::<f64>()
                / n,
            "input_unit",
        ),
        simple(
            "mean_teager_energy",
            samples
                .windows(3)
                .map(|triple| triple[1] * triple[1] - triple[2] * triple[0])
                .sum::<f64>()
                / n,
            "input_unit_squared",
        ),
    ])
}

pub(crate) struct AxisStatisticsCsv {
    pub bytes: Vec<u8>,
    pub source_row_count: usize,
    pub output_row_count: usize,
}

/// Window/axis membership and order are caller-owned, not inferred from files,
/// resets, clocks, subjects or 100/200/300-row boundaries. Integer order gaps
/// are permitted: this is order, not a timestamp or resampling grid.
pub(crate) fn prepare_axis_statistics_csv(
    input: &[u8],
    selected_statistics: Option<&BTreeSet<&str>>,
) -> Result<AxisStatisticsCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|error| format!("axis statistics header: {error}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("axis statistics refuse duplicate column names".into());
    }
    let required = |field| {
        headers
            .iter()
            .position(|header| header == field)
            .ok_or_else(|| format!("axis statistics require {field}"))
    };
    let window = required("window_id")?;
    let sample = required("sample_id")?;
    let order = required("sample_order")?;
    let axis = required("axis")?;
    let value = required("value")?;
    let unit = required("input_unit")?;
    let mut groups = BTreeMap::<(String, String), (String, Vec<(u64, f64)>)>::new();
    let mut sample_ids = BTreeSet::new();
    let mut sample_orders = BTreeSet::new();
    let mut source_row_count = 0;
    for (index, record) in reader.records().enumerate() {
        let record =
            record.map_err(|error| format!("axis statistics row {}: {error}", index + 1))?;
        for field in [window, sample, axis, unit] {
            if record[field].trim().is_empty() {
                return Err(format!(
                    "axis statistics require nonblank {}",
                    &headers[field]
                ));
            }
        }
        if !matches!(
            &record[axis],
            "accelerometer_x"
                | "accelerometer_y"
                | "accelerometer_z"
                | "gyroscope_x"
                | "gyroscope_y"
                | "gyroscope_z"
        ) {
            return Err("axis statistics require one of the six disclosed axis identities".into());
        }
        let sample_order = record[order]
            .parse::<u64>()
            .map_err(|_| "axis statistics require unsigned integer sample_order")?;
        let scalar = record[value]
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .ok_or("axis statistics require finite value; no missing-sample policy is inferred")?;
        let key = (record[window].to_owned(), record[axis].to_owned());
        if !sample_ids.insert((key.clone(), record[sample].to_owned()))
            || !sample_orders.insert((key.clone(), sample_order))
        {
            return Err(
                "axis statistics refuse duplicate window/axis sample identity or order".into(),
            );
        }
        let group = groups
            .entry(key)
            .or_insert_with(|| (record[unit].to_owned(), Vec::new()));
        if group.0 != record[unit] {
            return Err("axis statistics require one unchanged input_unit per window/axis".into());
        }
        group.1.push((sample_order, scalar));
        source_row_count += 1;
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "window_id",
            "axis",
            "input_unit",
            "sample_count",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|error| format!("axis statistics output header: {error}"))?;
    let mut output_row_count = 0;
    for ((window, axis), (unit, mut samples)) in groups {
        samples.sort_by_key(|sample| sample.0);
        let values = samples.iter().map(|sample| sample.1).collect::<Vec<_>>();
        for statistic in reduce_ordered_axis(&values)? {
            if selected_statistics.is_some_and(|selected| !selected.contains(statistic.statistic)) {
                continue;
            }
            writer
                .serialize((
                    &window,
                    &axis,
                    &unit,
                    values.len(),
                    statistic.statistic,
                    statistic.value,
                    statistic.status,
                    statistic.reason,
                    statistic.output_unit_relation,
                ))
                .map_err(|error| format!("axis statistics output row: {error}"))?;
            output_row_count += 1;
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer
            .into_inner()
            .map_err(|error| format!("axis statistics output: {error}"))?,
        source_row_count,
        output_row_count,
    })
}
