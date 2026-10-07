//! Formula-only reductions on caller-supplied five-second sensor memberships.
//! S3 DOI:10.3390/s21113765 p12 and AUToSen DOI:10.1109/jiot.2020.2975779 p5012.
//! No raw-window construction, cadence, alignment, imputation or units are inferred.

use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, PartialEq)]
pub(crate) struct SensorResult {
    pub value: Option<f64>,
    pub status: &'static str,
    pub reason: &'static str,
}

impl SensorResult {
    fn numeric(value: f64) -> Self {
        if value.is_finite() {
            Self {
                value: Some(value),
                status: "computed",
                reason: "",
            }
        } else {
            Self::unavailable("arithmetic_unavailable", "nonfinite_arithmetic")
        }
    }

    fn unavailable(status: &'static str, reason: &'static str) -> Self {
        Self {
            value: None,
            status,
            reason,
        }
    }
}

fn extrema(samples: &[f64]) -> Result<(f64, f64), String> {
    if samples.is_empty() || samples.iter().any(|x| !x.is_finite()) {
        return Err("prepared sensor windows require nonempty finite supplied samples".into());
    }
    let result = finite_scalar_extrema_by_group(samples.iter().map(|x| ((), *x)))
        .map_err(|_| "prepared sensor windows require finite samples")?;
    Ok((result[0].minimum, result[0].maximum))
}

pub(crate) fn reduce_s3_axis(samples: &[f64]) -> Result<Vec<(&'static str, SensorResult)>, String> {
    let (minimum, maximum) = extrema(samples)?;
    // Validation above qualifies the shared NA-removing summary; no source
    // missingness convention is borrowed from the helper's other callers.
    let rows = samples
        .iter()
        .map(|x| GroupedNumericRow {
            group: Some("supplied_axis".into()),
            values: vec![Some(*x)],
        })
        .collect::<Vec<_>>();
    let mean = summarize_columns_by_first_seen_group(&rows)
        .map_err(|_| "prepared sensor window summary failed")?[0]
        .means[0];
    let sum = samples.iter().sum::<f64>();
    let mean = if mean == 0.0 && sum != 0.0 {
        SensorResult::unavailable("arithmetic_unavailable", "floating_point_mean_underflow")
    } else {
        SensorResult::numeric(mean)
    };
    Ok(vec![
        ("average", mean),
        ("minimum", SensorResult::numeric(minimum)),
        ("maximum", SensorResult::numeric(maximum)),
        ("peak_to_peak", SensorResult::numeric(maximum - minimum)),
    ])
}

pub(crate) fn normalize_autosen_dimension(samples: &[f64]) -> Result<Vec<SensorResult>, String> {
    let (minimum, maximum) = extrema(samples)?;
    let range = maximum - minimum;
    Ok(samples
        .iter()
        .map(|x| {
            if maximum == minimum {
                SensorResult::unavailable("source_undefined", "zero_range_behavior_undisclosed")
            } else if !range.is_finite() {
                SensorResult::unavailable("arithmetic_unavailable", "nonfinite_arithmetic")
            } else {
                let normalized = (*x - minimum) / range;
                if normalized == 0.0 && *x != minimum {
                    SensorResult::unavailable(
                        "arithmetic_unavailable",
                        "floating_point_normalization_underflow",
                    )
                } else {
                    SensorResult::numeric(normalized)
                }
            }
        })
        .collect())
}

pub(crate) struct PreparedSensorCsv {
    pub bytes: Vec<u8>,
    pub source_row_count: usize,
    pub output_row_count: usize,
}

/// Each group is caller-owned (participant, window, dimension). Five seconds
/// qualifies the supplied membership, not timestamp endpoints. Sample IDs are
/// unique only within that group. Values/units are never converted or resampled.
pub(crate) fn prepare_sensor_window_csv(
    input: &[u8],
    normalize: bool,
    selected_statistics: Option<&BTreeSet<&str>>,
) -> Result<PreparedSensorCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|e| format!("prepared sensor header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("prepared sensor windows refuse duplicate column names".into());
    }
    let required = |field| {
        headers
            .iter()
            .position(|h| h == field)
            .ok_or_else(|| format!("prepared sensor windows require {field}"))
    };
    let participant = required("participant_id")?;
    let window = required("window_id")?;
    let sample = required("sample_id")?;
    let dimension = required("dimension")?;
    let value = required("value")?;
    let unit = required("input_unit")?;
    let width = required("window_duration_seconds")?;
    let mut groups = BTreeMap::<(String, String, String), (String, Vec<(String, f64)>)>::new();
    let mut identities = BTreeSet::new();
    let mut source_row_count = 0;
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("prepared sensor row {}: {e}", index + 1))?;
        for field in [participant, window, sample, dimension, unit] {
            if record[field].trim().is_empty() {
                return Err(format!(
                    "prepared sensor windows require nonblank {}",
                    &headers[field]
                ));
            }
        }
        if record[width].parse::<f64>().ok() != Some(5.0) {
            return Err("prepared sensor memberships must declare the source five-second window, not its sampling/vector cadence".into());
        }
        if !normalize
            && !matches!(
                &record[dimension],
                "accelerometer_x"
                    | "accelerometer_y"
                    | "accelerometer_z"
                    | "gyroscope_x"
                    | "gyroscope_y"
                    | "gyroscope_z"
            )
        {
            return Err(
                "S3 prepared sensor windows require an accelerometer or gyroscope axis".into(),
            );
        }
        let scalar = record[value].parse::<f64>().ok().filter(|x| x.is_finite())
            .ok_or("prepared sensor windows require finite value; missingness/imputation is not inferred")?;
        let key = (
            record[participant].to_owned(),
            record[window].to_owned(),
            record[dimension].to_owned(),
        );
        if !identities.insert((key.clone(), record[sample].to_owned())) {
            return Err("prepared sensor windows refuse duplicate sample identity within participant/window/dimension".into());
        }
        let group = groups
            .entry(key)
            .or_insert_with(|| (record[unit].to_owned(), Vec::new()));
        if group.0 != record[unit] {
            return Err("prepared sensor windows require one unchanged input_unit per participant/window/dimension".into());
        }
        group.1.push((record[sample].to_owned(), scalar));
        source_row_count += 1;
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "window_id",
            "dimension",
            "input_unit",
            "window_duration_seconds",
            "sample_count",
            "sample_id",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| format!("prepared sensor output header: {e}"))?;
    let mut output_row_count = 0;
    for ((participant, window, dimension), (unit, samples)) in groups {
        let values = samples.iter().map(|x| x.1).collect::<Vec<_>>();
        let results = if normalize {
            normalize_autosen_dimension(&values)?
                .into_iter()
                .zip(&samples)
                .map(|(result, sample)| (sample.0.clone(), "min_max_normalization", result))
                .collect::<Vec<_>>()
        } else {
            reduce_s3_axis(&values)?
                .into_iter()
                .filter(|(statistic, _)| {
                    selected_statistics.is_none_or(|selected| selected.contains(statistic))
                })
                .map(|(statistic, result)| (String::new(), statistic, result))
                .collect::<Vec<_>>()
        };
        for (sample, statistic, result) in results {
            writer
                .serialize((
                    &participant,
                    &window,
                    &dimension,
                    &unit,
                    5,
                    values.len(),
                    sample,
                    statistic,
                    result.value,
                    result.status,
                    result.reason,
                    if normalize {
                        "dimensionless"
                    } else {
                        "input_unit"
                    },
                ))
                .map_err(|e| format!("prepared sensor output row: {e}"))?;
            output_row_count += 1;
        }
    }
    Ok(PreparedSensorCsv {
        bytes: writer
            .into_inner()
            .map_err(|e| format!("prepared sensor output: {e}"))?,
        source_row_count,
        output_row_count,
    })
}
