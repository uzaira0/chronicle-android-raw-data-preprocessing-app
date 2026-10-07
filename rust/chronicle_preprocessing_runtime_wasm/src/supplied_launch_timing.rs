//! OhApp primary p3 Navigation Time and Jones primary physical pp5–6
//! (retained layout text264–272,311–322). These computations start at supplied
//! matched anchors or qualified participant-ordered launch rows. Exact i64
//! nanoseconds are Chronicle input coordinates, not inferred author epochs.

use super::{format_duration_seconds_from_ns, supplied_anchor_elapsed_nanoseconds};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const OHAPP_ADAPTER: &str = "chronicle.ohapp-matched-navigation-time";
pub(super) const JONES_ADAPTER: &str = "chronicle.jones-ordered-interlaunch-time";
pub(super) const OHAPP_FIELDS: [&str; 17] = [
    "source_row_id",
    "start_participant_id",
    "end_participant_id",
    "start_device_id",
    "end_device_id",
    "start_navigation_id",
    "end_navigation_id",
    "start_event_id",
    "end_event_id",
    "start_event_kind",
    "end_event_kind",
    "start_clock_id",
    "end_clock_id",
    "start_timestamp_ns",
    "end_timestamp_ns",
    "time_unit",
    "anchor_pairing_stage",
];
pub(super) const JONES_FIELDS: [&str; 10] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_sequence_id",
    "event_kind",
    "source_stream_role",
    "clock_id",
    "time_unit",
    "launch_timestamp_ns",
    "source_order_stage",
];

fn headers(
    raw: &[u8],
    required: &[&str],
    outputs: &[&str],
    adapter: &str,
) -> Result<(csv::StringRecord, Vec<usize>, Vec<csv::StringRecord>), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|error| error.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{adapter} requires unique column names"));
    }
    if outputs
        .iter()
        .any(|field| headers.iter().any(|header| header == *field))
    {
        return Err(format!(
            "{adapter} refuses supplied computed output columns"
        ));
    }
    let columns = required
        .iter()
        .map(|field| {
            headers
                .iter()
                .position(|header| header == *field)
                .ok_or_else(|| format!("{adapter} requires column {field}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok((headers, columns, records))
}

fn timestamp(raw: &str, adapter: &str, row: usize) -> Result<Option<i64>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse().map(Some).map_err(|_| {
        format!(
            "{adapter} row {row} requires an integer-nanosecond timestamp or an empty missing cell"
        )
    })
}

fn difference(
    start: Option<i64>,
    end: Option<i64>,
    start_clock: &str,
    end_clock: &str,
) -> [String; 3] {
    let unavailable = if start_clock.trim().is_empty() || end_clock.trim().is_empty() {
        Some("missing_clock_id")
    } else if start_clock != end_clock {
        Some("incompatible_clock_ids")
    } else if start.is_none() || end.is_none() {
        Some("missing_timestamp")
    } else {
        None
    };
    if let Some(reason) = unavailable {
        return [
            String::new(),
            String::new(),
            format!("unavailable:{reason}"),
        ];
    }
    let delta = supplied_anchor_elapsed_nanoseconds(start.unwrap(), end.unwrap());
    [
        delta.to_string(),
        format_duration_seconds_from_ns(delta),
        "computed_supplied_order_arithmetic".into(),
    ]
}

pub(super) fn ohapp_csv(raw: &[u8]) -> Result<(Vec<u8>, usize), String> {
    const OUTPUTS: [&str; 3] = [
        "navigation_elapsed_nanoseconds",
        "navigation_time_seconds",
        "navigation_timing_status",
    ];
    let (mut output_headers, columns, records) =
        headers(raw, &OHAPP_FIELDS, &OUTPUTS, OHAPP_ADAPTER)?;
    output_headers.extend(OUTPUTS);
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&output_headers)
        .map_err(|error| error.to_string())?;
    for (index, record) in records.iter().enumerate() {
        let value = |field: usize| &record[columns[field]];
        if (0..11).any(|field| value(field).trim().is_empty()) {
            return Err(format!(
                "{OHAPP_ADAPTER} requires complete supplied ownership and endpoint roles"
            ));
        }
        if value(1) != value(2) || value(3) != value(4) || value(5) != value(6) {
            return Err(format!(
                "{OHAPP_ADAPTER} requires matching participant, device and navigation identities"
            ));
        }
        if value(7) == value(8)
            || value(9) != "navigation_type_opened"
            || value(10) != "app_started"
        {
            return Err(format!(
                "{OHAPP_ADAPTER} requires distinct navigation_type_opened and app_started events"
            ));
        }
        if value(15) != "ns" || value(16) != "caller-resolved" {
            return Err(format!("{OHAPP_ADAPTER} requires explicit time_unit=ns and caller-resolved anchor_pairing_stage"));
        }
        let extra = difference(
            timestamp(value(13), OHAPP_ADAPTER, index + 1)?,
            timestamp(value(14), OHAPP_ADAPTER, index + 1)?,
            value(11),
            value(12),
        );
        let mut output = record.clone();
        output.extend(extra.iter().map(String::as_str));
        writer
            .write_record(&output)
            .map_err(|error| error.to_string())?;
    }
    Ok((
        writer.into_inner().map_err(|error| error.to_string())?,
        records.len(),
    ))
}

pub(super) fn jones_csv(raw: &[u8]) -> Result<(Vec<u8>, usize), String> {
    const OUTPUTS: [&str; 5] = [
        "participant_launch_ordinal",
        "preceding_launch_source_row_id",
        "interlaunch_elapsed_nanoseconds",
        "interlaunch_elapsed_seconds",
        "interlaunch_timing_status",
    ];
    let (mut output_headers, columns, records) =
        headers(raw, &JONES_FIELDS, &OUTPUTS, JONES_ADAPTER)?;
    output_headers.extend(OUTPUTS);
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&output_headers)
        .map_err(|error| error.to_string())?;
    let mut previous =
        BTreeMap::<String, (String, String, String, Option<i64>, String, usize)>::new();
    for (index, record) in records.iter().enumerate() {
        let value = |field: usize| &record[columns[field]];
        if (0..4).any(|field| value(field).trim().is_empty()) {
            return Err(format!("{JONES_ADAPTER} requires nonempty participant/device/sequence/source-row ownership"));
        }
        if value(4) != "app_launch"
            || value(5) != "jones_eligible_any_app_launches"
            || value(7) != "ns"
            || value(9) != "caller-qualified-ordered"
        {
            return Err(format!("{JONES_ADAPTER} requires the explicit eligible any-app launch role, nanosecond coordinates and caller-qualified order"));
        }
        let current = timestamp(value(8), JONES_ADAPTER, index + 1)?;
        let (ordinal, previous_id, extra) = match previous.get(value(1)) {
            Some((device, sequence, clock, time, id, ordinal)) => {
                if device != value(2) || sequence != value(3) {
                    return Err(format!("{JONES_ADAPTER} participant must retain one explicitly supplied device/sequence; no hidden repartition"));
                }
                (
                    ordinal + 1,
                    id.clone(),
                    difference(*time, current, clock, value(6)),
                )
            }
            None => (
                1,
                String::new(),
                [
                    String::new(),
                    String::new(),
                    "unavailable:no_supplied_preceding_launch".into(),
                ],
            ),
        };
        let mut output = record.clone();
        output.push_field(&ordinal.to_string());
        output.push_field(&previous_id);
        output.extend(extra.iter().map(String::as_str));
        writer
            .write_record(&output)
            .map_err(|error| error.to_string())?;
        // Missing times remain in adjacency. Never skip across a missing row,
        // filter by application identity, sort, deduplicate or impute zero.
        previous.insert(
            value(1).to_owned(),
            (
                value(2).to_owned(),
                value(3).to_owned(),
                value(6).to_owned(),
                current,
                value(0).to_owned(),
                ordinal,
            ),
        );
    }
    Ok((
        writer.into_inner().map_err(|error| error.to_string())?,
        records.len(),
    ))
}

#[cfg(test)]
pub(super) fn fixture_csv(case: &serde_json::Value, defaults: &serde_json::Value) -> Vec<u8> {
    let kind = case["kind"].as_str().unwrap();
    let mut fields: Vec<&str> = if kind == "ohapp" {
        OHAPP_FIELDS.to_vec()
    } else {
        JONES_FIELDS.to_vec()
    };
    if let Some(extra) = case["extra_columns"].as_array() {
        fields.extend(extra.iter().map(|value| value.as_str().unwrap()));
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&fields).unwrap();
    for row in case["rows"].as_array().unwrap() {
        let values = fields.iter().map(|field| {
            row.get(*field)
                .or_else(|| defaults[kind].get(*field))
                .and_then(|value| value.as_str())
                .unwrap_or("")
        });
        writer.write_record(values).unwrap();
    }
    writer.into_inner().unwrap()
}

#[cfg(test)]
pub(super) fn assert_fixture_output(case: &serde_json::Value, input: &[u8], output: &[u8]) {
    let mut source = csv::Reader::from_reader(input);
    let source_headers = source.headers().unwrap().clone();
    let source_rows = source.records().collect::<Result<Vec<_>, _>>().unwrap();
    let mut derived = csv::Reader::from_reader(output);
    assert_eq!(
        derived
            .headers()
            .unwrap()
            .iter()
            .take(source_headers.len())
            .collect::<Vec<_>>(),
        source_headers.iter().collect::<Vec<_>>()
    );
    let derived_rows = derived.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(source_rows.len(), derived_rows.len());
    let expected: Vec<Vec<String>> = serde_json::from_value(case["expected"].clone()).unwrap();
    assert_eq!(expected.len(), derived_rows.len(), "{} row count", case["id"]);
    for ((original, output), expected) in source_rows.iter().zip(derived_rows.iter()).zip(expected)
    {
        assert_eq!(
            original.iter().collect::<Vec<_>>(),
            output.iter().take(source_headers.len()).collect::<Vec<_>>(),
            "{} original lexical row",
            case["id"]
        );
        assert_eq!(
            output
                .iter()
                .skip(source_headers.len())
                .map(str::to_owned)
                .collect::<Vec<_>>(),
            expected,
            "{} derived row",
            case["id"]
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supplied_launch_timing_independent_full_range_hand_math() {
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MIN, i64::MAX),
            18_446_744_073_709_551_615_i128
        );
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MAX, i64::MIN),
            -18_446_744_073_709_551_615_i128
        );
        assert_eq!(supplied_anchor_elapsed_nanoseconds(1, 0), -1);
        assert_eq!(format_duration_seconds_from_ns(-1_i128), "-0.000000001");
        assert_eq!(
            format_duration_seconds_from_ns(18_446_744_073_709_551_615_i128),
            "18446744073.709551615"
        );
        assert_eq!(
            format_duration_seconds_from_ns(-18_446_744_073_709_551_615_i128),
            "-18446744073.709551615"
        );
    }

    #[test]
    fn supplied_launch_timing_source_read_hand_cases() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_launch_timing.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let input = fixture_csv(case, &fixtures["defaults"]);
            let result = if case["kind"] == "ohapp" {
                ohapp_csv(&input)
            } else {
                jones_csv(&input)
            };
            if let Some(error) = case["error"].as_str() {
                assert!(
                    result.expect_err("fixture must fail").contains(error),
                    "{}",
                    case["id"]
                );
            } else {
                let (output, rows) =
                    result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                assert_eq!(rows, case["rows"].as_array().unwrap().len());
                assert_fixture_output(case, &input, &output);
            }
        }
    }
}
