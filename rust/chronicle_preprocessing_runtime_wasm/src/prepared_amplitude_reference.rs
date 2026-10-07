//! Supplied cleaned microphone reductions and supplied reference arithmetic.
//! Retained Ruegger MicrophoneStateAggregator v3 state.py:319-407;
//! PASTime primary text:176-190; Fukazawa primary Eq12-13.
//! These operations do not clean amplitudes, construct reference populations,
//! join raw streams, infer integration grids or reproduce author serialization.

use crate::categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use crate::keyboard_stress_axis_statistics::{mean_energy_only, AxisStatistic, AxisStatisticsCsv};
use crate::prepared_scalar_axis::prepared_mean_only;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const RUEGGER_STATISTICS: [&str; 6] = [
    "mean_energy",
    "arithmetic_mean",
    "minimum",
    "maximum",
    "population_standard_deviation",
    "decibels",
];

fn rename(mut result: AxisStatistic, name: &'static str, unit: &'static str) -> AxisStatistic {
    result.statistic = name;
    result.output_unit_relation = unit;
    result
}

/// At least ten cleaned amplitudes WITHIN one recorded sample, not ten samples
/// in the outer interval. Finite input is an explicit qualification; no sample
/// removal or peach.audio.clean_sample policy is inferred.
pub(crate) fn ruegger_sample_statistics(samples: &[f64]) -> Result<Vec<AxisStatistic>, String> {
    if samples.len() < 10 || samples.iter().any(|x| !x.is_finite()) {
        return Err(
            "Ruegger requires at least ten finite caller-cleaned amplitudes per recorded sample"
                .into(),
        );
    }
    let mean = prepared_mean_only(samples)?;
    let extrema = finite_scalar_extrema_by_group(samples.iter().map(|x| ((), *x)))
        .map_err(|_| "Ruegger requires finite supplied amplitudes")?;
    let (deviation, decibels) = match mean.value {
        Some(m) => {
            let centered = samples.iter().map(|x| *x - m).collect::<Vec<_>>();
            let deviation = if centered.iter().any(|x| !x.is_finite()) {
                AxisStatistic::computed("population_standard_deviation", f64::NAN, "input_unit")
            } else {
                // np.std(clean_amplitudes) uses ddof=0. The shared mean-energy
                // body gives sum((x-mean)^2)/n, never the sample-SD denominator.
                let mut variance = mean_energy_only(&centered)?;
                variance.value = variance.value.map(f64::sqrt);
                if variance.reason == "floating_point_energy_underflow" {
                    variance.reason = "floating_point_population_variance_underflow";
                }
                rename(variance, "population_standard_deviation", "input_unit")
            };
            let decibels = if m <= 0.0 {
                // Released math.log10 would raise for this domain. This CSV's
                // per-statistic refusal does not claim author-runtime parity.
                AxisStatistic::unavailable(
                    "decibels",
                    "source_undefined",
                    "nonpositive_mean_log10",
                    "source_20_log10_input_scalar",
                )
            } else {
                AxisStatistic::computed(
                    "decibels",
                    20.0 * m.log10(),
                    "source_20_log10_input_scalar",
                )
            };
            (deviation, decibels)
        }
        None => (
            AxisStatistic::unavailable(
                "population_standard_deviation",
                mean.status,
                mean.reason,
                "input_unit",
            ),
            AxisStatistic::unavailable(
                "decibels",
                mean.status,
                mean.reason,
                "source_20_log10_input_scalar",
            ),
        ),
    };
    Ok(vec![
        mean_energy_only(samples)?,
        mean,
        AxisStatistic::computed("minimum", extrema[0].minimum, "input_unit"),
        AxisStatistic::computed("maximum", extrema[0].maximum, "input_unit"),
        deviation,
        decibels,
    ])
}

/// One value per qualified recorded sample contributes equal weight. An
/// unavailable result is not silently removed or weighted by amplitude count.
pub(crate) fn ruegger_interval_mean(
    values: &[&AxisStatistic],
    statistic: &'static str,
    unit: &'static str,
) -> Result<AxisStatistic, String> {
    if values.is_empty() {
        return Ok(AxisStatistic::unavailable(
            statistic,
            "source_undefined",
            "empty_qualified_source_sample_list",
            unit,
        ));
    }
    if let Some(value) = values.iter().find(|x| x.value.is_none()) {
        return Ok(AxisStatistic::unavailable(
            statistic,
            value.status,
            value.reason,
            unit,
        ));
    }
    let finite = values.iter().map(|x| x.value.unwrap()).collect::<Vec<_>>();
    Ok(rename(prepared_mean_only(&finite)?, statistic, unit))
}

/// Released state.py:404-405 selects first i members BEFORE np.nanmean's NaN
/// removal, and only when the TOTAL list length is strictly greater than i.
/// None here means an explicitly supplied source NaN, never absent membership
/// or an arithmetic-unavailable result relabeled as NaN.
pub(crate) fn ruegger_prefix_mean(
    values: &[Option<f64>],
    i: usize,
    statistic: &'static str,
    unit: &'static str,
) -> Result<AxisStatistic, String> {
    if !(1..=12).contains(&i) || values.iter().flatten().any(|x| !x.is_finite()) {
        return Err("Ruegger released prefix requires i in1..12 and finite or explicitly source-NaN members".into());
    }
    if values.len() <= i {
        return Ok(AxisStatistic::unavailable(
            statistic,
            "source_undefined",
            "source_strict_sample_count_guard",
            unit,
        ));
    }
    let first = values[..i].iter().flatten().copied().collect::<Vec<_>>();
    if first.is_empty() {
        return Ok(AxisStatistic::unavailable(
            statistic,
            "source_undefined",
            "all_source_nan_prefix_members",
            unit,
        ));
    }
    Ok(rename(prepared_mean_only(&first)?, statistic, unit))
}

/// PASTime's reference moments are supplied, not estimated or OS-pooled here.
/// Equality at either cap is unchanged; zero supplied SD gives a valid point
/// interval. The source's three-SD rule is not percentile winsorization.
pub(crate) fn pastime_usage_clip(
    value: f64,
    mean: f64,
    sd: f64,
) -> Result<Vec<AxisStatistic>, String> {
    if !value.is_finite() || !mean.is_finite() || !sd.is_finite() || sd < 0.0 {
        return Err(
            "PASTime clipping requires finite supplied value/mean and nonnegative supplied SD"
                .into(),
        );
    }
    let spread = 3.0 * sd;
    let lower = mean - spread;
    let upper = mean + spread;
    let clipped = if !spread.is_finite() || !lower.is_finite() || !upper.is_finite() {
        AxisStatistic::unavailable(
            "winsorized_usage",
            "arithmetic_unavailable",
            "nonfinite_supplied_cap_arithmetic",
            "input_unit",
        )
    } else {
        AxisStatistic::computed("winsorized_usage", value.clamp(lower, upper), "input_unit")
    };
    Ok(vec![
        AxisStatistic::computed("lower_cap", lower, "input_unit"),
        AxisStatistic::computed("upper_cap", upper, "input_unit"),
        clipped,
    ])
}

/// Literal signed subtraction on already supplied stage-qualified scalars.
/// No scalar-to-duration conversion, moment estimator or NA-removal is needed.
pub(crate) fn supplied_center(
    value: f64,
    mean: f64,
    statistic: &'static str,
) -> Result<AxisStatistic, String> {
    if !value.is_finite() || !mean.is_finite() {
        return Err("prepared centering requires finite supplied value and reference mean".into());
    }
    Ok(AxisStatistic::computed(
        statistic,
        value - mean,
        "input_unit",
    ))
}

/// Fukazawa Eq13 with supplied person-specific moments. Zero SD has no real
/// quotient; negative SD is not a standard deviation. Finite signed x/mu and
/// negative z-scores are retained without the positive-only ratio adapter.
pub(crate) fn fukazawa_supplied_zscore(
    value: f64,
    mean: f64,
    sd: f64,
) -> Result<AxisStatistic, String> {
    if !value.is_finite() || !mean.is_finite() || !sd.is_finite() || sd < 0.0 {
        return Err(
            "Fukazawa requires finite supplied value/mean and nonnegative person SD".into(),
        );
    }
    if sd == 0.0 {
        return Ok(AxisStatistic::unavailable(
            "within_person_zscore",
            "source_undefined",
            "zero_supplied_standard_deviation",
            "dimensionless",
        ));
    }
    let centered = supplied_center(value, mean, "within_person_zscore")?;
    let Some(difference) = centered.value else {
        return Ok(rename(centered, "within_person_zscore", "dimensionless"));
    };
    let z = difference / sd;
    Ok(if z == 0.0 && difference != 0.0 {
        AxisStatistic::unavailable(
            "within_person_zscore",
            "arithmetic_unavailable",
            "floating_point_standardization_underflow",
            "dimensionless",
        )
    } else {
        AxisStatistic::computed("within_person_zscore", z, "dimensionless")
    })
}

/// Fukazawa Eq12 pointwise SAME supplied sample. Eq11's continuous integral is
/// separate; no cadence-times-count, norm, gravity removal or join occurs here.
pub(crate) fn fukazawa_same_sample_one_hot(
    brightness: f64,
    acceleration: f64,
) -> Result<[u8; 9], String> {
    if !brightness.is_finite()
        || !acceleration.is_finite()
        || brightness < 0.0
        || acceleration < 0.0
    {
        return Err("Fukazawa Eq12 requires finite nonnegative lux and gravity-removed acceleration magnitude".into());
    }
    let br = OrderedThresholdBucketizer::new(vec![300.0, 1000.0], vec![0, 1, 2])
        .map_err(|e| e.to_string())?;
    let acc = OrderedThresholdBucketizer::new(vec![2.0, 5.0], vec![0, 1, 2])
        .map_err(|e| e.to_string())?;
    let index = 3 * *acc.category_for(acceleration).map_err(|e| e.to_string())?
        + *br.category_for(brightness).map_err(|e| e.to_string())?;
    let mut result = [0; 9];
    result[index] = 1;
    Ok(result)
}

// Source-specific CSV transport only. Lexical identities/units are never
// trimmed; trimming is used solely to refuse blank required fields.
fn supplied_rows(input: &[u8], fields: &[&str]) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("prepared amplitude/reference refuses duplicate columns".into());
    }
    let positions = fields
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("prepared amplitude/reference requires {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let rows = reader
        .records()
        .map(|row| {
            let row = row.map_err(|e| e.to_string())?;
            Ok(positions.iter().map(|i| row[*i].to_owned()).collect())
        })
        .collect::<Result<Vec<Vec<String>>, String>>()?;
    if rows.is_empty() {
        return Err("prepared amplitude/reference requires a supplied inventory".into());
    }
    Ok(rows)
}
fn finite(text: &str) -> Result<f64, String> {
    text.parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| {
            "prepared amplitude/reference requires finite scalars; no NA removal or imputation"
                .into()
        })
}
fn order(text: &str) -> Result<u64, String> {
    text.parse()
        .map_err(|_| "prepared amplitude/reference requires unsigned explicit order".into())
}
fn write_stat(
    writer: &mut csv::Writer<Vec<u8>>,
    mut prefix: Vec<String>,
    stat: &AxisStatistic,
) -> Result<(), String> {
    prefix.extend([
        stat.statistic.to_owned(),
        stat.value.map(|x| x.to_string()).unwrap_or_default(),
        stat.status.to_owned(),
        stat.reason.to_owned(),
        stat.output_unit_relation.to_owned(),
    ]);
    writer.write_record(prefix).map_err(|e| e.to_string())
}
fn finish(
    writer: csv::Writer<Vec<u8>>,
    source_row_count: usize,
    output_row_count: usize,
) -> Result<AxisStatisticsCsv, String> {
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count,
    })
}
fn ruegger_unit(statistic: &str) -> &'static str {
    match statistic {
        "mean_energy" => "input_unit_squared",
        "decibels" => "source_20_log10_input_scalar",
        _ => "input_unit",
    }
}

/// Complete supplied cleaned samples for one source state interval. A manifest
/// explicitly declares even an empty interval. No raw interval construction.
pub(crate) fn prepare_ruegger_samples_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    if selected.is_empty() || selected.iter().any(|s| !RUEGGER_STATISTICS.contains(s)) {
        return Err("Ruegger requires its exact released base statistic owners".into());
    }
    let rows = supplied_rows(
        input,
        &[
            "participant_id",
            "state_interval_id",
            "microphone_stream",
            "input_unit",
            "platform",
            "inventory_complete",
            "source_build",
            "record_kind",
            "sample_id",
            "sample_order",
            "amplitude_id",
            "amplitude_order",
            "value",
        ],
    )?;
    type Scope = (String, String, String);
    struct Sample {
        id: String,
        order: u64,
        amplitudes: Vec<(u64, f64)>,
    }
    struct Interval {
        scope: Scope,
        unit: String,
        manifest: bool,
        samples: Vec<Sample>,
        index: BTreeMap<String, usize>,
    }
    let mut groups = Vec::<Interval>::new();
    let mut indices = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut sample_orders = BTreeMap::new();
    for r in &rows {
        if r[..8].iter().any(|v| v.trim().is_empty())
            || r[4] != "android"
            || r[5] != "true"
            || r[6] != "MicrophoneStateAggregator/v3"
        {
            return Err(
                "Ruegger requires Android complete caller-cleaned released-v3 memberships".into(),
            );
        }
        let scope = (r[0].clone(), r[1].clone(), r[2].clone());
        let next = groups.len();
        let gi = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push(Interval {
                scope: scope.clone(),
                unit: r[3].clone(),
                manifest: false,
                samples: Vec::new(),
                index: BTreeMap::new(),
            });
            next
        });
        let g = &mut groups[gi];
        if g.unit != r[3] {
            return Err("Ruegger refuses conflicting lexical interval units".into());
        }
        if r[7] == "manifest" {
            if g.manifest || r[8..].iter().any(|v| !v.is_empty()) {
                return Err("Ruegger requires one blank-member manifest per interval".into());
            }
            g.manifest = true;
            continue;
        }
        if r[7] != "amplitude" || r[8..].iter().any(|v| v.trim().is_empty()) {
            return Err("Ruegger requires amplitude members or an interval manifest".into());
        }
        let so = order(&r[9])?;
        let ao = order(&r[11])?;
        let value = finite(&r[12])?;
        let si = if let Some(si) = g.index.get(&r[8]) {
            *si
        } else {
            if sample_orders
                .insert((scope.clone(), so), r[8].clone())
                .is_some()
            {
                return Err("Ruegger refuses duplicate scoped sample order".into());
            }
            let si = g.samples.len();
            g.samples.push(Sample {
                id: r[8].clone(),
                order: so,
                amplitudes: Vec::new(),
            });
            g.index.insert(r[8].clone(), si);
            si
        };
        let sample = &mut g.samples[si];
        if sample.order != so
            || !ids.insert((scope.clone(), r[8].clone(), r[10].clone()))
            || !orders.insert((scope, r[8].clone(), ao))
        {
            return Err(
                "Ruegger refuses conflicting sample order or duplicate amplitude identity/order"
                    .into(),
            );
        }
        sample.amplitudes.push((ao, value));
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "state_interval_id",
            "microphone_stream",
            "input_unit",
            "stage",
            "sample_id",
            "sample_order",
            "member_count",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut emitted = 0;
    for g in &mut groups {
        if !g.manifest {
            return Err("Ruegger requires an explicit complete interval manifest".into());
        }
        g.samples.sort_by_key(|s| s.order);
        let mut reduced = Vec::new();
        for s in &mut g.samples {
            s.amplitudes.sort_by_key(|a| a.0);
            let values = s.amplitudes.iter().map(|a| a.1).collect::<Vec<_>>();
            let stats = ruegger_sample_statistics(&values)?;
            for stat in &stats {
                if selected.contains(stat.statistic) {
                    write_stat(
                        &mut writer,
                        vec![
                            g.scope.0.clone(),
                            g.scope.1.clone(),
                            g.scope.2.clone(),
                            g.unit.clone(),
                            "cleaned_sample".into(),
                            s.id.clone(),
                            s.order.to_string(),
                            values.len().to_string(),
                        ],
                        stat,
                    )?;
                    emitted += 1;
                }
            }
            reduced.push(stats);
        }
        for (index, statistic) in RUEGGER_STATISTICS.iter().enumerate() {
            if selected.contains(statistic) {
                let members = reduced.iter().map(|s| &s[index]).collect::<Vec<_>>();
                let stat = ruegger_interval_mean(&members, statistic, ruegger_unit(statistic))?;
                write_stat(
                    &mut writer,
                    vec![
                        g.scope.0.clone(),
                        g.scope.1.clone(),
                        g.scope.2.clone(),
                        g.unit.clone(),
                        "state_unweighted_mean".into(),
                        String::new(),
                        String::new(),
                        reduced.len().to_string(),
                    ],
                    &stat,
                )?;
                emitted += 1;
            }
        }
    }
    finish(writer, rows.len(), emitted)
}

/// Released six aligned statistic lists, explicit source NaN, first-i then
/// nanmean and strict total-count>i. No arithmetic failure is converted to NaN.
pub(crate) fn prepare_ruegger_prefix_csv(input: &[u8]) -> Result<AxisStatisticsCsv, String> {
    let rows = supplied_rows(
        input,
        &[
            "participant_id",
            "state_interval_id",
            "microphone_stream",
            "input_unit",
            "platform",
            "inventory_complete",
            "source_build",
            "record_kind",
            "sample_id",
            "sample_order",
            "mean_energy",
            "arithmetic_mean",
            "minimum",
            "maximum",
            "population_standard_deviation",
            "decibels",
        ],
    )?;
    type Scope = (String, String, String);
    let mut groups = Vec::<(Scope, String, bool, Vec<(u64, Vec<Option<f64>>)>)>::new();
    let mut indices = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    for r in &rows {
        if r[..8].iter().any(|v| v.trim().is_empty())
            || r[4] != "android"
            || r[5] != "true"
            || r[6] != "MicrophoneStateAggregator/v3"
        {
            return Err(
                "Ruegger prefix requires complete Android released-v3 statistic-list inventory"
                    .into(),
            );
        }
        let scope = (r[0].clone(), r[1].clone(), r[2].clone());
        let next = groups.len();
        let gi = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope.clone(), r[3].clone(), false, Vec::new()));
            next
        });
        let g = &mut groups[gi];
        if g.1 != r[3] {
            return Err("Ruegger prefix refuses conflicting lexical units".into());
        }
        if r[7] == "manifest" {
            if g.2 || r[8..].iter().any(|v| !v.is_empty()) {
                return Err("Ruegger prefix requires one blank-member manifest".into());
            }
            g.2 = true;
            continue;
        }
        if r[7] != "sample_statistics" || r[8..].iter().any(|v| v.trim().is_empty()) {
            return Err(
                "Ruegger prefix refuses missing members; source NaN must be explicit source_NaN"
                    .into(),
            );
        }
        let so = order(&r[9])?;
        if !ids.insert((scope.clone(), r[8].clone())) || !orders.insert((scope, so)) {
            return Err("Ruegger prefix refuses duplicate sample identity/order".into());
        }
        let values = r[10..]
            .iter()
            .map(|v| {
                if v == "source_NaN" {
                    Ok(None)
                } else {
                    finite(v).map(Some)
                }
            })
            .collect::<Result<Vec<_>, String>>()?;
        if values[0].is_some_and(|v| v < 0.0) || values[4].is_some_and(|v| v < 0.0) {
            return Err("Ruegger prefix requires nonnegative source energy/population SD".into());
        }
        g.3.push((so, values));
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "state_interval_id",
            "microphone_stream",
            "input_unit",
            "source_sample_count",
            "prefix_i",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut emitted = 0;
    for (scope, unit, manifest, samples) in &mut groups {
        if !*manifest {
            return Err("Ruegger prefix requires its explicit inventory manifest".into());
        }
        samples.sort_by_key(|s| s.0);
        for (index, statistic) in RUEGGER_STATISTICS.iter().enumerate() {
            let values = samples.iter().map(|s| s.1[index]).collect::<Vec<_>>();
            for i in 1..=12 {
                let stat = ruegger_prefix_mean(&values, i, statistic, ruegger_unit(statistic))?;
                write_stat(
                    &mut writer,
                    vec![
                        scope.0.clone(),
                        scope.1.clone(),
                        scope.2.clone(),
                        unit.clone(),
                        samples.len().to_string(),
                        i.to_string(),
                    ],
                    &stat,
                )?;
                emitted += 1;
            }
        }
    }
    finish(writer, rows.len(), emitted)
}

/// Supplied Android usage/reference arithmetic or supplied feature/person
/// Eq13. Explicit reference identity/scope are checked, not constructed.
pub(crate) fn prepare_reference_csv(
    input: &[u8],
    stage: &str,
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let with_sd = matches!(stage, "usage_clipping" | "within_person_zscore");
    if !matches!(
        stage,
        "usage_clipping"
            | "within_person_centering"
            | "between_person_centering"
            | "within_person_zscore"
    ) {
        return Err("unknown prepared reference stage".into());
    }
    let mut fields = vec![
        "participant_id",
        "source_partition_id",
        "feature_stream",
        "source_row_id",
        "row_order",
        "value",
        "input_unit",
        "platform",
        "inventory_complete",
        "reference_id",
        "reference_scope_id",
        "reference_mean",
    ];
    if with_sd {
        fields.push("reference_sd");
    }
    let rows = supplied_rows(input, &fields)?;
    let mut refs = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "source_partition_id",
            "feature_stream",
            "source_row_id",
            "row_order",
            "input_unit",
            "reference_id",
            "reference_scope_id",
            "stage",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut emitted = 0;
    for r in &rows {
        if r.iter().any(|v| v.trim().is_empty()) || r[7] != "android" || r[8] != "true" {
            return Err("prepared reference requires complete Android memberships and nonblank supplied references".into());
        }
        let ro = order(&r[4])?;
        let scope = (r[0].clone(), r[1].clone(), r[2].clone());
        if !ids.insert((scope.clone(), r[3].clone())) || !orders.insert((scope, ro)) {
            return Err("prepared reference refuses duplicate scoped row identity/order".into());
        }
        let value = finite(&r[5])?;
        let mean = finite(&r[11])?;
        let sd = if with_sd { finite(&r[12])? } else { 0.0 };
        let person = if stage == "between_person_centering" {
            ""
        } else {
            &r[0]
        };
        let ref_scope = (person.to_owned(), r[2].clone(), r[9].clone(), r[10].clone());
        let reference = (mean.to_bits(), sd.to_bits(), r[6].clone());
        if refs.get(&ref_scope).is_some_and(|old| old != &reference) {
            return Err("prepared reference refuses conflicting supplied moments/units for one lexical reference scope".into());
        }
        refs.insert(ref_scope, reference);
        let stats = match stage {
            "usage_clipping" => pastime_usage_clip(value, mean, sd)?,
            "within_person_centering" => vec![supplied_center(
                value,
                mean,
                "within_person_centered_usage",
            )?],
            "between_person_centering" => vec![supplied_center(
                value,
                mean,
                "between_person_centered_usual_usage",
            )?],
            _ => vec![fukazawa_supplied_zscore(value, mean, sd)?],
        };
        if selected.is_empty()
            || selected
                .iter()
                .any(|s| !stats.iter().any(|r| r.statistic == *s))
        {
            return Err("prepared reference requires exact selected stage outputs".into());
        }
        for stat in stats.iter().filter(|s| selected.contains(s.statistic)) {
            write_stat(
                &mut writer,
                vec![
                    r[0].clone(),
                    r[1].clone(),
                    r[2].clone(),
                    r[3].clone(),
                    r[4].clone(),
                    r[6].clone(),
                    r[9].clone(),
                    r[10].clone(),
                    stage.into(),
                ],
                stat,
            )?;
            emitted += 1;
        }
    }
    finish(writer, rows.len(), emitted)
}

pub(crate) fn prepare_fukazawa_conjunction_csv(input: &[u8]) -> Result<AxisStatisticsCsv, String> {
    let rows = supplied_rows(
        input,
        &[
            "participant_id",
            "device_id",
            "clock_id",
            "sample_id",
            "same_time_id",
            "row_order",
            "brightness_stream",
            "acceleration_stream",
            "brightness",
            "brightness_unit",
            "gravity_removed_acceleration_magnitude",
            "acceleration_unit",
            "platform",
            "inventory_complete",
            "same_time_qualified",
            "gravity_removed_qualified",
        ],
    )?;
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut streams = BTreeMap::new();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "device_id",
            "clock_id",
            "sample_id",
            "same_time_id",
            "row_order",
            "brightness_stream",
            "acceleration_stream",
            "brightness_unit",
            "acceleration_unit",
            "cell_0",
            "cell_1",
            "cell_2",
            "cell_3",
            "cell_4",
            "cell_5",
            "cell_6",
            "cell_7",
            "cell_8",
            "status",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    for r in &rows {
        if r.iter().any(|v| v.trim().is_empty())
            || r[9] != "lux"
            || r[11] != "m/s^2"
            || r[12] != "android"
            || r[13..].iter().any(|v| v != "true")
        {
            return Err("Fukazawa Eq12 requires same-time qualified complete Android lux/gravity-removed m/s^2 memberships".into());
        }
        if r[6] == r[7] {
            return Err(
                "Fukazawa Eq12 requires separately identified brightness and acceleration streams"
                    .into(),
            );
        }
        let scope = (
            r[0].clone(),
            r[1].clone(),
            r[2].clone(),
            r[6].clone(),
            r[7].clone(),
        );
        let ro = order(&r[5])?;
        if !ids.insert((scope.clone(), r[3].clone())) || !orders.insert((scope, ro)) {
            return Err("Fukazawa Eq12 refuses duplicate scoped sample identity/order".into());
        }
        let key = (r[0].clone(), r[1].clone(), r[2].clone(), r[3].clone());
        let identity = (r[4].clone(), r[6].clone(), r[7].clone());
        if streams.get(&key).is_some_and(|old| old != &identity) {
            return Err(
                "Fukazawa Eq12 refuses conflicting common sample/time/stream identity".into(),
            );
        }
        streams.insert(key, identity);
        let cells = fukazawa_same_sample_one_hot(finite(&r[8])?, finite(&r[10])?)?;
        let mut out = vec![
            r[0].clone(),
            r[1].clone(),
            r[2].clone(),
            r[3].clone(),
            r[4].clone(),
            r[5].clone(),
            r[6].clone(),
            r[7].clone(),
            r[9].clone(),
            r[11].clone(),
        ];
        out.extend(cells.iter().map(|x| x.to_string()));
        out.extend(["computed".into(), "boolean_one_hot".into()]);
        writer.write_record(out).map_err(|e| e.to_string())?;
    }
    finish(writer, rows.len(), rows.len())
}
