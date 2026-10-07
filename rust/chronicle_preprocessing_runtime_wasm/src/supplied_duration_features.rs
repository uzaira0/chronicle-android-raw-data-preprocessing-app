//! Bounded supplied-duration computations, not raw collectors or study models.
//! Habitual use doi:10.1145/3447991, accepted manuscript physical p10/article9
//! §3.2.1 lines503–514, SHA256 6199496d4514a7243e54c6d867a4f694d466346a77a5681767297e92abe38ffb.
//! Its historical35 OS is unnamed. This is an explicitly typed Android
//! adaptation of the duration bag, not TF-IDF or the distinct Socialize20 branch.
//! Finesse doi:10.1145/3479600, later repository commit
//! b8f401fb52c069d2fe6083504c7b46670c71be2c (2022-03-21), Feature.kt:54–55,137–140,
//! SHA256 ec65bf9488415f7b9b500a0ee66fe0dfb29cc8a26dffdc8afd33f2d595cafa7c.
//! No deployed2020 build, feature classifier or original serializer is claimed.

use super::{format_python_float, required_header, supplied_anchor_elapsed_nanoseconds};
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const BAG_ADAPTER: &str = "chronicle.habitual-android-duration-bag";
pub(super) const FINESSE_ADAPTER: &str = "chronicle.finesse-later-feature-time";
const RELEASE: &str = "b8f401fb52c069d2fe6083504c7b46670c71be2c";
pub(super) const BAG_FIELDS: [&str; 10] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_session_id",
    "app_identity",
    "duration",
    "duration_unit",
    "platform",
    "branch_adaptation",
    "duration_stage",
];
pub(super) const FINESSE_FIELDS: [&str; 16] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "package_session_id",
    "feature_occurrence_id",
    "package_name",
    "feature_package_name",
    "package_clock_id",
    "feature_start_clock_id",
    "feature_end_clock_id",
    "package_start_ms",
    "feature_start_ms",
    "feature_end_ms",
    "time_unit",
    "anchor_pairing_stage",
    "source_version_commit",
];
pub(super) const BAG_OUTPUT: [&str; 6] = [
    "participant_id",
    "device_id",
    "source_session_id",
    "app_identity",
    "duration_unit",
    "app_duration",
];
pub(super) const FINESSE_OUTPUT: [&str; 6] = [
    "feature_duration_ms",
    "feature_duration_status",
    "feature_start_offset_ms",
    "feature_start_offset_status",
    "feature_end_offset_ms",
    "feature_end_offset_status",
];

fn columns(
    headers: &csv::StringRecord,
    fields: &[&str],
    adapter: &str,
) -> Result<Vec<usize>, String> {
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{adapter} requires unique carrier columns"));
    }
    fields
        .iter()
        .map(|field| required_header(headers, field, adapter))
        .collect()
}

fn identity(
    record: &csv::StringRecord,
    column: usize,
    name: &str,
    adapter: &str,
) -> Result<String, String> {
    let value = record.get(column).unwrap_or("");
    if value.trim().is_empty() {
        return Err(format!("{adapter} requires {name}"));
    }
    Ok(value.to_owned()) // Presence checking does not normalize lexical ownership.
}

/// Supplied nonoverlapping/otherwise source-qualified app-duration contributions.
/// Units are caller-declared and retained without scaling. Binary64 is the
/// Chronicle numeric boundary, not an assertion about the paper's scalar type.
pub(super) fn bag_csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let adapter = BAG_ADAPTER;
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader
        .headers()
        .map_err(|e| format!("{adapter} header: {e}"))?
        .clone();
    let cols = columns(&headers, &BAG_FIELDS, adapter)?;
    let mut rows = Vec::new();
    let mut owner_units = BTreeMap::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("{adapter} row {}: {e}", index + 1))?;
        let values = cols
            .iter()
            .map(|c| record.get(*c).unwrap_or(""))
            .collect::<Vec<_>>();
        for column in [0, 1, 2, 3, 4, 6] {
            identity(&record, cols[column], BAG_FIELDS[column], adapter)?;
        }
        if values[7] != "android"
            || values[8] != "historical_duration_bag_android_adaptation"
            || values[9] != "caller-qualified-session-app-contribution"
        {
            return Err(format!("{adapter} requires the explicit Android historical-duration adaptation and qualified contribution role"));
        }
        if !matches!(values[6], "ns" | "us" | "ms" | "s" | "min") {
            return Err(format!(
                "{adapter} requires an explicit supported duration_unit"
            ));
        }
        let owner = (
            values[1].to_owned(),
            values[2].to_owned(),
            values[3].to_owned(),
        );
        if owner_units
            .get(&owner)
            .is_some_and(|unit| unit != values[6])
        {
            return Err(format!(
                "{adapter} session mixes duration units; no conversion is inferred"
            ));
        }
        owner_units.insert(owner.clone(), values[6].to_owned());
        let duration = values[5].trim().parse::<f64>().map_err(|_| format!("{adapter} requires finite nonnegative supplied duration; missingness policy is undisclosed"))?;
        if !duration.is_finite() || duration < 0.0 {
            return Err(format!("{adapter} requires finite nonnegative supplied duration; missingness policy is undisclosed"));
        }
        rows.push(GroupedScalarInput {
            entity: (
                owner.0,
                owner.1,
                owner.2,
                values[4].to_owned(),
                values[6].to_owned(),
            ),
            raw_partition: (),
            passthrough: (),
            value: RCompatibleScalar::Finite(duration),
        });
    }
    let source_rows = rows.len();
    // Identity projection/scaling reuses the current grouped sum. No R missing
    // policy is imported: this typed input admits only qualified finite values.
    let totals = grouped_scalar_sum_then_project_unique(
        &rows,
        SequentialDivisionConfiguration {
            first_divisor: 1.0,
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|e| format!("{adapter}: {e}"))?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(BAG_OUTPUT)
        .map_err(|e| format!("{adapter} output: {e}"))?;
    for total in &totals {
        let RCompatibleScalar::Finite(value) = total.sum else {
            return Err(format!("{adapter} supplied duration sum is not finite"));
        };
        let owner = &total.entity;
        writer
            .write_record([
                owner.0.clone(),
                owner.1.clone(),
                owner.2.clone(),
                owner.3.clone(),
                owner.4.clone(),
                format_python_float(value),
            ])
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    // First-seen row presentation is an engineering choice, not a sequence
    // feature: only membership and per-app total remain in the duration bag.
    Ok((
        writer
            .into_inner()
            .map_err(|e| format!("{adapter} output: {e}"))?,
        source_rows,
        totals.len(),
    ))
}

fn timestamp(value: &str) -> Result<Option<i64>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    value
        .trim()
        .parse()
        .map(Some)
        .map_err(|_| format!("{FINESSE_ADAPTER} requires signed int64 millisecond coordinates"))
}

fn released_difference(
    start: Option<i64>,
    end: Option<i64>,
    start_clock: &str,
    end_clock: &str,
) -> (String, &'static str) {
    if start_clock.is_empty() || end_clock.is_empty() {
        return (String::new(), "unavailable:missing_clock_id");
    }
    if start_clock != end_clock {
        return (String::new(), "unavailable:incompatible_clock_ids");
    }
    let (Some(start), Some(end)) = (start, end) else {
        return (String::new(), "unavailable:missing_timestamp");
    };
    // The existing helper is unit-independent subtraction despite its ns name.
    // Explicit truncation reproduces Kotlin/JVM Long subtraction modulo 2^64;
    // unlike OhApp/Jones, the released operation must NOT retain an i128 result.
    (
        (supplied_anchor_elapsed_nanoseconds(start, end) as i64).to_string(),
        "computed_later_release_long_arithmetic",
    )
}

/// Prepared same-package Feature anchors, supplied without classifier execution.
/// Each independent subtraction can remain available when an unrelated anchor
/// is missing. Local unavailable statuses are Chronicle diagnostics, not source
/// zero filling or a recovered missing-clock/collector admission policy.
pub(super) fn finesse_csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let adapter = FINESSE_ADAPTER;
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader
        .headers()
        .map_err(|e| format!("{adapter} header: {e}"))?
        .clone();
    let cols = columns(&headers, &FINESSE_FIELDS, adapter)?;
    if headers.iter().any(|field| FINESSE_OUTPUT.contains(&field)) {
        return Err(format!("{adapter} refuses supplied computed-output fields"));
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut output_headers = headers.clone();
    for name in FINESSE_OUTPUT {
        output_headers.push_field(name);
    }
    writer
        .write_record(&output_headers)
        .map_err(|e| format!("{adapter} output: {e}"))?;
    let mut rows = 0;
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("{adapter} row {}: {e}", index + 1))?;
        let values = cols
            .iter()
            .map(|c| record.get(*c).unwrap_or(""))
            .collect::<Vec<_>>();
        for column in 0..7 {
            identity(&record, cols[column], FINESSE_FIELDS[column], adapter)?;
        }
        if values[5] != values[6] {
            return Err(format!("{adapter} requires supplied same-package anchors"));
        }
        if values[13] != "ms"
            || values[14] != "caller-resolved-later-release"
            || values[15] != RELEASE
        {
            return Err(format!(
                "{adapter} requires millisecond anchors qualified to the exact later release"
            ));
        }
        let package = timestamp(values[10])?;
        let start = timestamp(values[11])?;
        let end = timestamp(values[12])?;
        let calculations = [
            released_difference(start, end, values[8], values[9]),
            released_difference(package, start, values[7], values[8]),
            released_difference(package, end, values[7], values[9]),
        ];
        let mut output = record.clone();
        for (value, status) in calculations {
            output.push_field(&value);
            output.push_field(status);
        }
        writer
            .write_record(&output)
            .map_err(|e| format!("{adapter} output: {e}"))?;
        rows += 1;
    }
    Ok((
        writer
            .into_inner()
            .map_err(|e| format!("{adapter} output: {e}"))?,
        rows,
        rows,
    ))
}

#[cfg(test)]
pub(super) fn fixture_csv(case: &serde_json::Value, defaults: &serde_json::Value) -> Vec<u8> {
    let fields: &[&str] = if case["kind"] == "bag" {
        &BAG_FIELDS
    } else {
        &FINESSE_FIELDS
    };
    let kind = case["kind"].as_str().unwrap();
    let mut writer = csv::Writer::from_writer(Vec::new());
    let extras = case["extra_headers"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>())
        .unwrap_or_default();
    writer
        .write_record(fields.iter().copied().chain(extras.iter().copied()))
        .unwrap();
    for (index, row) in case["rows"].as_array().unwrap().iter().enumerate() {
        writer
            .write_record(
                fields
                    .iter()
                    .copied()
                    .chain(extras.iter().copied())
                    .map(|name| {
                        if name == "source_row_id" && row.get(name).is_none() {
                            return format!("row{}", index + 1);
                        }
                        row.get(name)
                            .or_else(|| defaults[kind].get(name))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_owned()
                    }),
            )
            .unwrap();
    }
    writer.into_inner().unwrap()
}

#[cfg(test)]
pub(super) fn assert_fixture_output(case: &serde_json::Value, input: &[u8], output: &[u8]) {
    let mut reader = csv::Reader::from_reader(output);
    let headers = reader.headers().unwrap().clone();
    let records = reader.records().map(Result::unwrap).collect::<Vec<_>>();
    let expected = case["expected"].as_array().unwrap();
    assert_eq!(records.len(), expected.len(), "{}", case["id"]);
    if case["kind"] == "bag" {
        assert_eq!(headers.iter().collect::<Vec<_>>(), BAG_OUTPUT);
        for (record, expected) in records.iter().zip(expected) {
            assert_eq!(
                record.iter().collect::<Vec<_>>(),
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>(),
                "{}",
                case["id"]
            );
        }
    } else {
        let mut source = csv::Reader::from_reader(input);
        let input_headers = source.headers().unwrap().clone();
        assert_eq!(
            headers.iter().take(input_headers.len()).collect::<Vec<_>>(),
            input_headers.iter().collect::<Vec<_>>()
        );
        assert_eq!(
            headers.iter().skip(input_headers.len()).collect::<Vec<_>>(),
            FINESSE_OUTPUT
        );
        for ((record, original), expected) in records
            .iter()
            .zip(source.records().map(Result::unwrap))
            .zip(expected)
        {
            assert_eq!(
                record.iter().take(original.len()).collect::<Vec<_>>(),
                original.iter().collect::<Vec<_>>()
            );
            assert_eq!(
                record.iter().skip(original.len()).collect::<Vec<_>>(),
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>(),
                "{}",
                case["id"]
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplied_duration_features_independent_long_wrap_hand_math() {
        assert_eq!(
            released_difference(Some(i64::MIN), Some(i64::MAX), "c", "c").0,
            "-1"
        );
        assert_eq!(
            released_difference(Some(i64::MAX), Some(i64::MIN), "c", "c").0,
            "1"
        );
        assert_eq!(released_difference(Some(1), Some(0), "c", "c").0, "-1");
        assert_eq!(
            released_difference(Some(9007199254740992), Some(9007199254740993), "c", "c").0,
            "1"
        );
    }
    #[test]
    fn supplied_duration_features_all_source_hand_cases() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_duration_features.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let input = fixture_csv(case, &fixtures["defaults"]);
            let result = if case["kind"] == "bag" {
                bag_csv(&input)
            } else {
                finesse_csv(&input)
            };
            if let Some(error) = case["error"].as_str() {
                assert!(result.unwrap_err().contains(error), "{}", case["id"]);
            } else {
                let (output, source, emitted) =
                    result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
                assert_eq!(
                    source,
                    case["rows"].as_array().unwrap().len(),
                    "{} source",
                    case["id"]
                );
                assert_eq!(
                    emitted,
                    case["expected"].as_array().unwrap().len(),
                    "{} emitted",
                    case["id"]
                );
                assert_fixture_output(case, &input, &output);
            }
        }
    }
}
