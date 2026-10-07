//! Source-qualified reductions over already-admitted Android observations.
//!
//! Smartphone2020: doi:10.1145/3410530.3414441, primary text359:146–175,
//! SHA256 c72d2c5dcf2513ab3e8dcf1309fcb636e13396dc7f55c476c353b0827570fe86.
//! PROSIT: doi:10.1016/j.psychres.2023.115298, primary text199:207–220,246–264,
//! SHA256 0a30c6e015958c7317b34d5a09676787bbbe571e85f9672bb3e6b62228bf39da.
//! Opaque participant/device/window/day identities and admitted app/unlock
//! membership are supplied, never constructed from timestamps or raw events.

use super::{format_python_float, record_value, required_header};
use crate::count_ratio::{construct_named_count_ratios, CountRatioRequest};
use crate::grouped_distinct_count::count_distinct_members_by_group;
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use std::collections::{BTreeMap, BTreeSet};

type Owner = (String, String, String);
type Day = (Owner, String);

const USAGE_FIELDS: [&str; 7] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_window_id",
    "app_identity",
    "duration_minutes",
    "launch_count",
];
const UNLOCK_FIELDS: [&str; 7] = [
    "source_row_id",
    "record_type",
    "participant_id",
    "device_id",
    "source_window_id",
    "source_day_id",
    "occurrence_id",
];

fn columns(
    headers: &csv::StringRecord,
    names: &[&str],
    adapter: &str,
) -> Result<Vec<usize>, String> {
    if headers.len() != names.len() || headers.iter().collect::<BTreeSet<_>>().len() != names.len()
    {
        return Err(format!(
            "{adapter} requires exactly {} unique carrier columns",
            names.len()
        ));
    }
    names
        .iter()
        .map(|name| required_header(headers, name, adapter))
        .collect()
}

fn identity(
    record: &csv::StringRecord,
    column: usize,
    name: &str,
    row: usize,
    adapter: &str,
) -> Result<String, String> {
    // Validate presence without normalizing opaque lexical source identities.
    let value = record.get(column).unwrap_or("");
    if value.trim().is_empty() {
        return Err(format!("{adapter} row {row} requires {name}"));
    }
    Ok(value.to_owned())
}

/// Each row supplies an already-selected app contribution to one source window.
/// The source's Table1 window is seven days. A caller may supply another explicit
/// partition, but this component neither constructs it nor attributes it to the
/// study. Repeated app identities count once in A but contribute every D/L row.
pub(super) fn usage_csv(raw_csv: &[u8], adapter: &str) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("{adapter} header: {error}"))?
        .clone();
    let fields = columns(&headers, &USAGE_FIELDS, adapter)?;
    let mut sums = Vec::new();
    let mut launches = BTreeMap::<Owner, u64>::new();
    let mut members = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let row = index + 1;
        let record = record.map_err(|error| format!("{adapter} row {row}: {error}"))?;
        identity(&record, fields[0], USAGE_FIELDS[0], row, adapter)?;
        let owner = (
            identity(&record, fields[1], USAGE_FIELDS[1], row, adapter)?,
            identity(&record, fields[2], USAGE_FIELDS[2], row, adapter)?,
            identity(&record, fields[3], USAGE_FIELDS[3], row, adapter)?,
        );
        let app = identity(&record, fields[4], USAGE_FIELDS[4], row, adapter)?;
        let duration = record_value(&record, Some(fields[5]))
            .trim()
            .parse::<f64>()
            .map_err(|_| {
                format!("{adapter} row {row} requires finite nonnegative duration_minutes")
            })?;
        if !duration.is_finite() || duration < 0.0 {
            return Err(format!(
                "{adapter} row {row} requires finite nonnegative duration_minutes"
            ));
        }
        let count = record_value(&record, Some(fields[6]))
            .trim()
            .parse::<u64>()
            .map_err(|_| format!("{adapter} row {row} requires uint64 launch_count"))?;
        let total = launches.entry(owner.clone()).or_default();
        *total = total
            .checked_add(count)
            .ok_or_else(|| format!("{adapter} launch_count sum overflow"))?;
        sums.push(GroupedScalarInput {
            entity: owner.clone(),
            raw_partition: (),
            passthrough: (),
            value: RCompatibleScalar::Finite(duration),
        });
        members.push((owner, app));
    }
    let source_rows = sums.len();
    // Reuse the existing ordered-sum primitive with identity scaling/projection.
    // All values here are supplied finite minutes; no R missing-value policy is
    // imported into this typed boundary.
    let sums = grouped_scalar_sum_then_project_unique(
        &sums,
        SequentialDivisionConfiguration {
            first_divisor: 1.0,
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|error| format!("{adapter}: {error}"))?;
    let counts = count_distinct_members_by_group(members)
        .into_iter()
        .map(|count| (count.group, count.distinct_member_count))
        .collect::<BTreeMap<_, _>>();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "device_id",
            "source_window_id",
            "duration_minutes",
            "launch_count",
            "distinct_app_count",
            "duration_minutes_per_app",
            "launches_per_app",
            "duration_minutes_per_launch",
        ])
        .map_err(|error| format!("{adapter} output header: {error}"))?;
    for row in &sums {
        let RCompatibleScalar::Finite(duration) = row.sum else {
            return Err(format!("{adapter} duration_minutes sum is not finite"));
        };
        let count = launches[&row.entity];
        if count == 0 {
            // No study zero-denominator rule is disclosed. Refuse the unknown
            // case instead of fabricating an IEEE, zero, or missing output.
            return Err(format!("{adapter} duration-per-launch requires a positive supplied launch denominator; source zero-denominator policy is undisclosed"));
        }
        let apps = u64::try_from(counts[&row.entity])
            .map_err(|_| format!("{adapter} distinct app count overflow"))?;
        let launch_per_app = construct_named_count_ratios([CountRatioRequest {
            name: "launches_per_app",
            numerator: count,
            denominator_terms: vec![apps],
        }])
        .map_err(|error| format!("{adapter}: {error}"))?[0]
            .ratio
            .value();
        writer
            .write_record([
                row.entity.0.clone(),
                row.entity.1.clone(),
                row.entity.2.clone(),
                format_python_float(duration),
                count.to_string(),
                apps.to_string(),
                format_python_float(duration / apps as f64),
                format_python_float(launch_per_app),
                format_python_float(duration / count as f64),
            ])
            .map_err(|error| format!("{adapter} output: {error}"))?;
    }
    let output = writer
        .into_inner()
        .map_err(|error| format!("{adapter} output: {error}"))?;
    Ok((output, source_rows, sums.len()))
}

/// Count unique, already-admitted unlock occurrences on explicit retained days,
/// then divide their total by the exact supplied retained-day inventory size.
/// Neither Android callback classification nor zero/partial-day eligibility is
/// inferred. The carrier requires unique occurrences, not a deduplication rule.
pub(super) fn unlock_csv(raw_csv: &[u8], adapter: &str) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("{adapter} header: {error}"))?
        .clone();
    let fields = columns(&headers, &UNLOCK_FIELDS, adapter)?;
    let mut retained_days = BTreeSet::<Day>::new();
    let mut occurrences = Vec::new();
    let mut unique_occurrences = BTreeSet::<(Owner, String)>::new();
    let mut source_rows = 0;
    for (index, record) in reader.records().enumerate() {
        let row = index + 1;
        let record = record.map_err(|error| format!("{adapter} row {row}: {error}"))?;
        source_rows += 1;
        identity(&record, fields[0], UNLOCK_FIELDS[0], row, adapter)?;
        let owner = (
            identity(&record, fields[2], UNLOCK_FIELDS[2], row, adapter)?,
            identity(&record, fields[3], UNLOCK_FIELDS[3], row, adapter)?,
            identity(&record, fields[4], UNLOCK_FIELDS[4], row, adapter)?,
        );
        let day = identity(&record, fields[5], UNLOCK_FIELDS[5], row, adapter)?;
        let occurrence = record_value(&record, Some(fields[6]));
        match record_value(&record, Some(fields[1])) {
            "observed_day" => {
                if !occurrence.is_empty() || !retained_days.insert((owner, day)) {
                    return Err(format!(
                        "{adapter} requires a unique observed_day row with no occurrence_id"
                    ));
                }
            }
            "unlock" => {
                let occurrence = identity(&record, fields[6], UNLOCK_FIELDS[6], row, adapter)?;
                if !unique_occurrences.insert((owner.clone(), occurrence.clone())) {
                    return Err(format!("{adapter} supplied admitted occurrence_id is not unique within participant/device/window"));
                }
                occurrences.push(((owner, day), occurrence));
            }
            _ => {
                return Err(format!(
                    "{adapter} row {row} requires record_type observed_day or unlock"
                ))
            }
        }
    }
    if occurrences
        .iter()
        .any(|(day, _)| !retained_days.contains(day))
    {
        return Err(format!(
            "{adapter} unlock occurrence has no supplied retained observed day"
        ));
    }
    let counts = count_distinct_members_by_group(occurrences)
        .into_iter()
        .map(|count| (count.group, count.distinct_member_count))
        .collect::<BTreeMap<_, _>>();
    let mut totals = BTreeMap::<Owner, (u64, u64)>::new();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "unlock_count",
            "observed_day_count",
            "mean_daily_unlocks",
        ])
        .map_err(|error| format!("{adapter} output header: {error}"))?;
    for (owner, day) in &retained_days {
        let count = u64::try_from(
            counts
                .get(&(owner.clone(), day.clone()))
                .copied()
                .unwrap_or(0),
        )
        .map_err(|_| format!("{adapter} unlock_count overflow"))?;
        let total = totals.entry(owner.clone()).or_default();
        total.0 = total
            .0
            .checked_add(count)
            .ok_or_else(|| format!("{adapter} unlock_count sum overflow"))?;
        total.1 = total
            .1
            .checked_add(1)
            .ok_or_else(|| format!("{adapter} observed_day_count overflow"))?;
        writer
            .write_record([
                "daily_count".to_owned(),
                owner.0.clone(),
                owner.1.clone(),
                owner.2.clone(),
                day.clone(),
                count.to_string(),
                String::new(),
                String::new(),
            ])
            .map_err(|error| format!("{adapter} output: {error}"))?;
    }
    for (owner, (count, days)) in &totals {
        let mean = construct_named_count_ratios([CountRatioRequest {
            name: "mean_daily_unlocks",
            numerator: *count,
            denominator_terms: vec![*days],
        }])
        .map_err(|error| format!("{adapter}: {error}"))?[0]
            .ratio
            .value();
        writer
            .write_record([
                "participant_mean".to_owned(),
                owner.0.clone(),
                owner.1.clone(),
                owner.2.clone(),
                String::new(),
                count.to_string(),
                days.to_string(),
                format_python_float(mean),
            ])
            .map_err(|error| format!("{adapter} output: {error}"))?;
    }
    let output = writer
        .into_inner()
        .map_err(|error| format!("{adapter} output: {error}"))?;
    Ok((output, source_rows, retained_days.len() + totals.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_read_usage_reduction_hand_cases() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_usage_reductions.json"
        ))
        .unwrap();
        assert_eq!(
            fixture["oracle_status"],
            "source_read_independent_hand_cases_not_author_execution"
        );
        assert_eq!(
            fixture["source_artifacts"][0]["sha256"],
            "c72d2c5dcf2513ab3e8dcf1309fcb636e13396dc7f55c476c353b0827570fe86"
        );
        assert_eq!(
            fixture["source_artifacts"][1]["sha256"],
            "0a30c6e015958c7317b34d5a09676787bbbe571e85f9672bb3e6b62228bf39da"
        );
        let mut total_cases = 0;
        for (section, usage) in [("usage_cases", true), ("unlock_cases", false)] {
            for case in fixture[section].as_array().unwrap() {
                let input = case["input_csv"].as_str().unwrap().as_bytes();
                let result = if usage {
                    usage_csv(input, "usage-hand-case")
                } else {
                    unlock_csv(input, "unlock-hand-case")
                };
                if let Some(expected) = case["expected_csv"].as_str() {
                    let (actual, source, emitted) =
                        result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                    assert_eq!(
                        String::from_utf8(actual).unwrap(),
                        expected,
                        "{}",
                        case["id"]
                    );
                    assert_eq!(
                        source as u64,
                        case["source_rows"].as_u64().unwrap(),
                        "{}",
                        case["id"]
                    );
                    assert_eq!(
                        emitted as u64,
                        case["emitted_rows"].as_u64().unwrap(),
                        "{}",
                        case["id"]
                    );
                } else {
                    assert!(
                        result
                            .expect_err("invalid carrier must fail")
                            .contains(case["expected_error_contains"].as_str().unwrap()),
                        "{}",
                        case["id"]
                    );
                }
                total_cases += 1;
            }
        }
        assert_eq!(total_cases, 20);
    }
}
