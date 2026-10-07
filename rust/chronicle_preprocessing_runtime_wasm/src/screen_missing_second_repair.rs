//! CHB2024 first-stage repair of explicitly represented no-retrieved-record
//! one-second units. Supplement Appendix A:17–56, TXT SHA256
//! 5cf0e71b7b13acb70f5c32dce6e594418f43db3afb2fe688a0417b7523fcd7d9;
//! DOCX SHA256 7e23699bbe25b9ff92bc15a5b837b0b66023cb121aef2a9120adee54c75eb825.
//! Equal-bound/even-half arithmetic is reused from the existing legacy owner.
//! No absent second, collector code, time zone, shutdown or battery is inferred.

use super::screen_missing_gap_replacement_states;
use crate::on_bounded_short_off_bridge::ScreenSecondState;
use std::collections::{BTreeMap, BTreeSet};

type Owner = (String, String, String);
const FIELDS: [&str; 6] = [
    "source_unit_id",
    "participant_id",
    "device_id",
    "stream_id",
    "second_index",
    "screen_state",
];
const NO_RECORD: &str = "no-retrieved-record";

#[derive(Clone)]
struct ExplicitSecond {
    unit: String,
    owner: Owner,
    second: i64,
    state: Option<ScreenSecondState>,
}

fn repair(rows: &[ExplicitSecond]) -> Result<Vec<ScreenSecondState>, String> {
    let mut groups = BTreeMap::<&Owner, Vec<usize>>::new();
    let mut clocks = BTreeSet::new();
    let mut units = BTreeSet::new();
    for (index, row) in rows.iter().enumerate() {
        if !clocks.insert((&row.owner, row.second)) {
            return Err("missing-second repair refuses duplicate owner/second_index units".into());
        }
        if !units.insert((&row.owner, row.unit.as_str())) {
            return Err("missing-second repair refuses duplicate owner/source_unit_id".into());
        }
        groups.entry(&row.owner).or_default().push(index);
    }
    let mut result = rows.iter().map(|row| row.state).collect::<Vec<_>>();
    for indices in groups.values_mut() {
        indices.sort_by_key(|index| rows[*index].second);
        if indices
            .windows(2)
            .any(|pair| rows[pair[0]].second.checked_add(1) != Some(rows[pair[1]].second))
        {
            return Err("missing-second repair requires an explicitly supplied consecutive one-second domain; timestamp silence or absent units are not no-retrieved-record units".into());
        }
        let mut position = 0;
        while position < indices.len() {
            if rows[indices[position]].state.is_some() {
                position += 1;
                continue;
            }
            let start = position;
            while position < indices.len() && rows[indices[position]].state.is_none() {
                position += 1;
            }
            let end = position;
            let count = end - start;
            if count > 60 {
                for index in &indices[start..end] {
                    result[*index] = Some(ScreenSecondState::Unknown);
                }
                continue;
            }
            let bounds = start.checked_sub(1).zip(indices.get(end));
            let Some((left_position, right_index)) = bounds else {
                return Err("missing-second repair source-unavailable: a short no-record run lacks both bounding ON/OFF units".into());
            };
            let left = rows[indices[left_position]].state;
            let right = rows[*right_index].state;
            let (Some(left), Some(right)) = (left, right) else {
                return Err("missing-second repair source-unavailable: a short no-record run lacks both bounding ON/OFF units".into());
            };
            if left == ScreenSecondState::Unknown || right == ScreenSecondState::Unknown {
                return Err("missing-second repair source-unavailable: an existing unknown state is not a binary ON/OFF bound or a no-record unit".into());
            }
            let states = screen_missing_gap_replacement_states(left, right, count, true, true)
                .map_err(|error| format!("missing-second repair source-unavailable: {error}"))?
                .ok_or_else(|| {
                    "missing-second repair lacks the existing fill/split operation".to_owned()
                })?;
            for (index, state) in indices[start..end].iter().zip(states) {
                result[*index] = Some(state);
            }
        }
    }
    result
        .into_iter()
        .map(|state| {
            state.ok_or_else(|| {
                "missing-second repair left an unavailable no-record unit".to_owned()
            })
        })
        .collect()
}

pub(super) struct PreparedMissingSeconds {
    pub bytes: Vec<u8>,
    pub source_row_count: usize,
}

pub(super) fn prepare_csv(input: &[u8]) -> Result<PreparedMissingSeconds, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|error| format!("missing-second header: {error}"))?
        .clone();
    if headers.len() != FIELDS.len()
        || headers.iter().collect::<BTreeSet<_>>().len() != FIELDS.len()
    {
        return Err("missing-second repair requires exactly six unique carrier columns".into());
    }
    let fields = FIELDS
        .iter()
        .map(|field| {
            headers
                .iter()
                .position(|header| header == *field)
                .ok_or_else(|| format!("missing-second repair requires {field}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut rows = Vec::new();
    let mut original = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record =
            record.map_err(|error| format!("missing-second row {}: {error}", index + 1))?;
        for field in &fields[..4] {
            if record[*field].trim().is_empty() {
                return Err(format!(
                    "missing-second row {} requires nonblank {}",
                    index + 1,
                    &headers[*field]
                ));
            }
        }
        let label = &record[fields[5]];
        let state = if label == NO_RECORD {
            None
        } else {
            Some(ScreenSecondState::parse(label)?)
        };
        rows.push(ExplicitSecond {
            unit: record[fields[0]].to_owned(),
            owner: (
                record[fields[1]].to_owned(),
                record[fields[2]].to_owned(),
                record[fields[3]].to_owned(),
            ),
            second: record[fields[4]].parse::<i64>().map_err(|_| {
                format!(
                    "missing-second row {} requires signed integer second_index",
                    index + 1
                )
            })?,
            state,
        });
        original.push(record);
    }
    let states = repair(&rows)?;
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "source_unit_id",
            "participant_id",
            "device_id",
            "stream_id",
            "second_index",
            "original_screen_state",
            "screen_state",
            "missing_second_repaired",
        ])
        .map_err(|error| format!("missing-second output header: {error}"))?;
    for ((row, record), state) in rows.iter().zip(&original).zip(states) {
        writer
            .write_record([
                &record[fields[0]],
                &record[fields[1]],
                &record[fields[2]],
                &record[fields[3]],
                &record[fields[4]],
                &record[fields[5]],
                state.source_label(),
                if row.state == Some(state) {
                    "false"
                } else {
                    "true"
                },
            ])
            .map_err(|error| format!("missing-second output row: {error}"))?;
    }
    Ok(PreparedMissingSeconds {
        bytes: writer
            .into_inner()
            .map_err(|error| format!("missing-second output: {error}"))?,
        source_row_count: rows.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn chb_missing_second_source_hand_cases() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/chb_missing_second_repair.json"
        ))
        .unwrap();
        assert_eq!(
            fixture["source_artifacts"][0]["sha256"],
            "5cf0e71b7b13acb70f5c32dce6e594418f43db3afb2fe688a0417b7523fcd7d9"
        );
        assert_eq!(
            fixture["source_artifacts"][1]["sha256"],
            "7e23699bbe25b9ff92bc15a5b837b0b66023cb121aef2a9120adee54c75eb825"
        );
        let cases = fixture["cases"].as_array().unwrap();
        for case in cases {
            let result = prepare_csv(case["input_csv"].as_str().unwrap().as_bytes());
            if let Some(expected) = case["expected_csv"].as_str() {
                let prepared = result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                assert_eq!(
                    String::from_utf8(prepared.bytes).unwrap(),
                    expected,
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    prepared.source_row_count as u64,
                    case["source_rows"].as_u64().unwrap()
                );
            } else {
                assert!(
                    result
                        .err()
                        .expect("unspecified or invalid case must refuse")
                        .contains(case["expected_error_contains"].as_str().unwrap()),
                    "{}",
                    case["id"]
                );
            }
        }
        assert_eq!(cases.len(), 25);
    }
}
