//! Supplied-numeric formulas only, DOI10.1007/s00530-018-0601-1.
//! Author-supplied online e-offprint: §3.2 Eq1 (rendered715–830),
//! §4.3 Eqs4–6 (rendered1362–1461,1534–1596). PDF bytes/runtime unknown.
//! Counts, similarities, feature occurrence/distinctness and cluster membership
//! are caller-resolved inputs. This is not GPS, embeddings, clustering or CEV.

use super::{format_python_float, required_header};
use crate::count_ratio::{construct_named_count_ratios, CountRatioRequest};
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use crate::keyboard_stress_axis_statistics::ordered_square_sum;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const DISTANCE: &str = "chronicle.recommender-supplied-feature-distance";
pub(super) const NORM: &str = "chronicle.recommender-supplied-eight-feature-norm";
pub(super) const FREQUENCY: &str = "chronicle.recommender-supplied-feature-frequency";
pub(super) const STABILITY: &str = "chronicle.recommender-supplied-feature-stability";
pub(super) const CREDIBILITY: &str = "chronicle.recommender-supplied-complete-credibility";
pub(super) const ADAPTERS: [&str; 5] = [DISTANCE, NORM, FREQUENCY, STABILITY, CREDIBILITY];
/// Engineering aliases for the eight Table2 dimensions, not collector fields.
pub(super) const FEATURES: [&str; 8] = [
    "last_opened_app", "last_audio_cable", "last_location", "last_charge_cable",
    "last_wifi", "last_data", "last_bluetooth", "last_light",
];
pub(super) const COMPLETE_DOMAIN: &str = "caller-complete-paper-eight-session-features";

pub(super) fn fields(adapter: &str) -> &'static [&'static str] {
    match adapter {
        DISTANCE | NORM => &[
            "source_row_id", "participant_id", "device_id", "pair_id",
            "left_instance_id", "right_instance_id", "feature_key", "similarity",
            "feature_domain", "input_stage",
        ],
        FREQUENCY => &[
            "source_row_id", "participant_id", "device_id", "cluster_id", "feature_key",
            "cluster_instance_count", "occurrence_count", "input_stage",
        ],
        STABILITY => &[
            "source_row_id", "participant_id", "device_id", "cluster_id", "feature_key",
            "cluster_instance_count", "distinct_value_count", "input_stage",
        ],
        CREDIBILITY => &[
            "source_row_id", "participant_id", "device_id", "cluster_id", "feature_key",
            "frequency", "stability", "feature_domain", "input_stage",
        ],
        _ => unreachable!("closed recommender numeric adapter"),
    }
}
pub(super) fn output_fields(adapter: &str) -> &'static [&'static str] {
    match adapter {
        DISTANCE => &["feature_distance"],
        FREQUENCY => &["ratio_numerator", "ratio_denominator", "feature_frequency"],
        STABILITY => &["ratio_numerator", "ratio_denominator", "feature_stability"],
        NORM => &["participant_id", "device_id", "pair_id", "left_instance_id", "right_instance_id",
            "feature_domain", "source_row_ids_json", "source_headers_json", "source_rows_json", "euclidean_distance"],
        CREDIBILITY => &["participant_id", "device_id", "cluster_id", "feature_domain",
            "source_row_ids_json", "source_headers_json", "source_rows_json", "cluster_credibility"],
        _ => unreachable!(),
    }
}

struct Table {
    headers: csv::StringRecord,
    rows: Vec<csv::StringRecord>,
    columns: BTreeMap<&'static str, usize>,
}
impl Table {
    fn value<'a>(&self, row: &'a csv::StringRecord, field: &str) -> &'a str {
        row.get(self.columns[field]).unwrap_or("")
    }
    fn identity(&self, row: &csv::StringRecord, field: &str) -> Result<String, String> {
        let value = self.value(row, field);
        if value.trim().is_empty() { return Err(format!("requires nonblank {field}")); }
        Ok(value.to_owned()) // Validate, never normalize opaque IDs.
    }
    fn finite_unit(&self, row: &csv::StringRecord, field: &str) -> Result<f64, String> {
        let value = self.value(row, field).parse::<f64>()
            .map_err(|_| format!("{field} requires a supplied binary64 value in [0,1]"))?;
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(format!("{field} requires a supplied binary64 value in [0,1]"));
        }
        Ok(value)
    }
    fn count(&self, row: &csv::StringRecord, field: &str) -> Result<u64, String> {
        self.value(row, field).parse().map_err(|_| format!("{field} requires a supplied u64 count"))
    }
}
fn read(raw: &[u8], adapter: &str) -> Result<Table, String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("requires unique carrier columns".into());
    }
    let reserved = ["feature_distance", "ratio_numerator", "ratio_denominator",
        "feature_frequency", "feature_stability", "euclidean_distance", "cluster_credibility",
        "source_row_ids_json", "source_headers_json", "source_rows_json"];
    if headers.iter().any(|h| reserved.contains(&h)) {
        return Err("refuses derived-output columns in supplied input".into());
    }
    let columns = fields(adapter).iter().map(|field| {
        Ok((*field, required_header(&headers, field, adapter)?))
    }).collect::<Result<_, String>>()?;
    let rows = reader.records().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let table = Table { headers, rows, columns };
    let mut ids = BTreeSet::new();
    for row in &table.rows {
        let id = table.identity(row, "source_row_id")?;
        let participant = table.identity(row, "participant_id")?;
        let device = table.identity(row, "device_id")?;
        if !ids.insert((participant, device, id)) { return Err("duplicate source row identity".into()); }
        if !FEATURES.contains(&table.value(row, "feature_key")) {
            return Err("requires a named source Table2 feature".into());
        }
        let stage = match adapter {
            DISTANCE | NORM => "caller-supplied-normalized-feature-similarities",
            FREQUENCY | STABILITY => "caller-supplied-qualified-cluster-feature-counts",
            CREDIBILITY => "caller-supplied-qualified-feature-frequency-stability",
            _ => unreachable!(),
        };
        if table.value(row, "input_stage") != stage { return Err("requires exact supplied input stage".into()); }
    }
    Ok(table)
}

/// First-seen groups; within each group preserve supplied CSV occurrence order.
/// Full aggregates require every one of the eight named features exactly once.
pub(super) fn execute(adapter: &str, raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let table = read(raw, adapter)?;
    let aggregate = adapter == NORM || adapter == CREDIBILITY;
    let mut writer = csv::Writer::from_writer(Vec::new());
    if aggregate { writer.write_record(output_fields(adapter)).map_err(|e| e.to_string())?; }
    else {
        let mut header = table.headers.clone();
        header.extend(output_fields(adapter).iter().copied());
        writer.write_record(&header).map_err(|e| e.to_string())?;
    }
    if !aggregate {
        for row in &table.rows {
            let mut output = row.clone();
            if adapter == DISTANCE {
                table.identity(row, "pair_id")?;
                table.identity(row, "left_instance_id")?;
                table.identity(row, "right_instance_id")?;
                if table.value(row, "feature_domain") != "caller-supplied-single-source-feature" {
                    return Err("per-feature distance requires single-feature qualification".into());
                }
                output.push_field(&format_python_float(1.0 - table.finite_unit(row, "similarity")?));
            } else {
                table.identity(row, "cluster_id")?;
                let denominator = table.count(row, "cluster_instance_count")?;
                let numerator = table.count(row, if adapter == FREQUENCY { "occurrence_count" } else { "distinct_value_count" })?;
                if numerator > denominator { return Err("feature count exceeds cluster instance count".into()); }
                let ratios = construct_named_count_ratios([CountRatioRequest {
                    name: (), numerator, denominator_terms: vec![denominator],
                }]).map_err(|e| format!("{e}; source zero-denominator behavior is undisclosed"))?;
                let ratio = ratios[0].ratio;
                output.push_field(&ratio.numerator.to_string());
                output.push_field(&ratio.denominator.to_string());
                output.push_field(&format_python_float(if adapter == FREQUENCY { ratio.value() } else { 1.0 - ratio.value() }));
            }
            writer.write_record(&output).map_err(|e| e.to_string())?;
        }
        let bytes = writer.into_inner().map_err(|e| e.to_string())?;
        return Ok((bytes, table.rows.len(), table.rows.len()));
    }
    let mut group_indices = BTreeMap::new();
    let mut groups: Vec<((String, String, String), Vec<usize>)> = Vec::new();
    for (index, row) in table.rows.iter().enumerate() {
        let owner = (table.identity(row, "participant_id")?, table.identity(row, "device_id")?,
            table.identity(row, if adapter == NORM { "pair_id" } else { "cluster_id" })?);
        let slot = *group_indices.entry(owner.clone()).or_insert_with(|| {
            let slot = groups.len(); groups.push((owner, Vec::new())); slot
        });
        groups[slot].1.push(index);
    }
    for (owner, indices) in &groups {
        let first = &table.rows[indices[0]];
        let mut features = BTreeSet::new();
        let mut values = Vec::new();
        for index in indices {
            let row = &table.rows[*index];
            if table.value(row, "feature_domain") != COMPLETE_DOMAIN {
                return Err("aggregate requires caller-complete paper eight-feature domain".into());
            }
            if !features.insert(table.value(row, "feature_key")) {
                return Err("aggregate refuses duplicate feature membership".into());
            }
            if adapter == NORM {
                for field in ["left_instance_id", "right_instance_id"] {
                    table.identity(row, field)?;
                    if table.value(row, field) != table.value(first, field) {
                        return Err("pair identity has conflicting instance membership".into());
                    }
                }
                values.push(1.0 - table.finite_unit(row, "similarity")?);
            } else {
                values.push(table.finite_unit(row, "frequency")? + table.finite_unit(row, "stability")?);
            }
        }
        if features.len() != FEATURES.len() { return Err("aggregate requires exactly eight unique source features".into()); }
        let value = if adapter == NORM { ordered_square_sum(&values).sqrt() }
        else {
            finite_scalar_extrema_by_group(values.iter().map(|value| ((), *value)))
                .map_err(|_| "requires finite supplied frequency/stability sums")?[0].maximum
        };
        let mut output = vec![owner.0.clone(), owner.1.clone(), owner.2.clone()];
        if adapter == NORM { output.extend([table.value(first, "left_instance_id").into(), table.value(first, "right_instance_id").into()]); }
        output.push(COMPLETE_DOMAIN.into());
        output.push(serde_json::to_string(&indices.iter().map(|i| table.value(&table.rows[*i], "source_row_id")).collect::<Vec<_>>()).map_err(|e| e.to_string())?);
        output.push(serde_json::to_string(&table.headers.iter().collect::<Vec<_>>()).map_err(|e| e.to_string())?);
        output.push(serde_json::to_string(&indices.iter().map(|i| table.rows[*i].iter().collect::<Vec<_>>()).collect::<Vec<_>>()).map_err(|e| e.to_string())?);
        output.push(format_python_float(value));
        writer.write_record(output).map_err(|e| e.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    Ok((bytes, table.rows.len(), groups.len()))
}

#[cfg(test)]
pub(super) fn adapter_for_kind(kind: &str) -> &str {
    match kind { "distance" => DISTANCE, "norm" => NORM, "frequency" => FREQUENCY,
        "stability" => STABILITY, "credibility" => CREDIBILITY, _ => panic!("unknown fixture kind") }
}
#[cfg(test)]
pub(super) fn fixture_csv(case: &serde_json::Value, defaults: &serde_json::Value) -> Vec<u8> {
    let adapter = adapter_for_kind(case["kind"].as_str().unwrap());
    let mut headers = fields(adapter).iter().map(|h| h.to_string()).collect::<Vec<_>>();
    if let Some(extra) = case["extra_headers"].as_array() { headers.extend(extra.iter().map(|v| v.as_str().unwrap().into())); }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&headers).unwrap();
    for row in case["rows"].as_array().unwrap() {
        writer.write_record(headers.iter().map(|field| row[field].as_str().or_else(|| defaults[case["kind"].as_str().unwrap()][field].as_str()).unwrap_or(""))).unwrap();
    }
    writer.into_inner().unwrap()
}
#[cfg(test)]
pub(super) fn assert_fixture_output(case: &serde_json::Value, input: &[u8], output: &[u8]) {
    let adapter = adapter_for_kind(case["kind"].as_str().unwrap());
    let mut source = csv::Reader::from_reader(input);
    let headers = source.headers().unwrap().clone();
    let rows = source.records().collect::<Result<Vec<_>, _>>().unwrap();
    let mut result = csv::Reader::from_reader(output);
    let actual_headers = result.headers().unwrap().clone();
    let actual = result.records().collect::<Result<Vec<_>, _>>().unwrap();
    let expected = case["expected"].as_array().unwrap();
    assert_eq!(actual.len(), expected.len(), "{}", case["id"]);
    if adapter == NORM || adapter == CREDIBILITY {
        assert_eq!(actual_headers.iter().collect::<Vec<_>>(), output_fields(adapter));
        for (row, expectation) in actual.iter().zip(expected) {
            assert_eq!(row.get(row.len()-1).unwrap().parse::<f64>().unwrap().to_bits(), expectation["value"].as_str().unwrap().parse::<f64>().unwrap().to_bits(), "{}", case["id"]);
            let ids: Vec<String> = serde_json::from_str(row.get(row.len()-4).unwrap()).unwrap();
            assert_eq!(ids, expectation["source_ids"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect::<Vec<_>>());
            let retained_headers: Vec<String> = serde_json::from_str(row.get(row.len()-3).unwrap()).unwrap();
            assert_eq!(retained_headers, headers.iter().collect::<Vec<_>>());
            let retained: Vec<Vec<String>> = serde_json::from_str(row.get(row.len()-2).unwrap()).unwrap();
            let id_column = headers.iter().position(|h| h == "source_row_id").unwrap();
            let participant_column = headers.iter().position(|h| h == "participant_id").unwrap();
            let device_column = headers.iter().position(|h| h == "device_id").unwrap();
            let scope_column = headers.iter().position(|h| h == if adapter == NORM { "pair_id" } else { "cluster_id" }).unwrap();
            let expected_rows = rows.iter().filter(|r| r.get(participant_column) == row.get(0)
                && r.get(device_column) == row.get(1) && r.get(scope_column) == row.get(2)
                && ids.contains(&r[id_column].to_owned())).map(|r| r.iter().map(str::to_owned).collect::<Vec<_>>()).collect::<Vec<_>>();
            assert_eq!(retained, expected_rows);
            assert_eq!(&row[0], expectation["participant_id"].as_str().unwrap_or("P"));
            assert_eq!(&row[1], expectation["device_id"].as_str().unwrap_or("D"));
            assert_eq!(&row[2], expectation["scope_id"].as_str().unwrap_or("Q"));
        }
    } else {
        for (index, (row, expectation)) in actual.iter().zip(expected).enumerate() {
            assert_eq!(row.iter().take(headers.len()).collect::<Vec<_>>(), rows[index].iter().collect::<Vec<_>>());
            let expected = expectation.as_array().unwrap();
            assert_eq!(row.iter().skip(headers.len()).take(expected.len()-1).collect::<Vec<_>>(), expected.iter().take(expected.len()-1).map(|v| v.as_str().unwrap()).collect::<Vec<_>>(), "{}", case["id"]);
            assert_eq!(row.get(row.len()-1).unwrap().parse::<f64>().unwrap().to_bits(), expected.last().unwrap().as_str().unwrap().parse::<f64>().unwrap().to_bits(), "{}", case["id"]);
        }
    }
}
