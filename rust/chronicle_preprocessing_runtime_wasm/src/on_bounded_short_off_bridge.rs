//! Isolated CHB2024 short-OFF repair, after upstream missing/unknown repair.
//! Source: supplement-mmc1.txt:70-76, SHA256
//! 5cf0e71b7b13acb70f5c32dce6e594418f43db3afb2fe688a0417b7523fcd7d9.
//! No missing second, unknown state, clock, session or attribution is inferred.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScreenSecondState {
    On,
    Off,
    Unknown,
}

impl ScreenSecondState {
    pub(crate) fn source_label(self) -> &'static str {
        match self {
            Self::On => "screen-on",
            Self::Off => "screen-off",
            Self::Unknown => "screen-unknown",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "screen-on" => Ok(Self::On),
            "screen-off" => Ok(Self::Off),
            "screen-unknown" => Ok(Self::Unknown),
            _ => Err("short-OFF bridge requires an exact normalized screen state".into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScreenSecond {
    pub participant_id: String,
    pub second_index: i64,
    pub state: ScreenSecondState,
}

/// Result positions correspond exactly to supplied input positions.
pub(crate) fn bridge_on_bounded_short_off_runs(
    rows: &[ScreenSecond],
) -> Result<Vec<ScreenSecondState>, String> {
    let mut groups = BTreeMap::<&str, Vec<usize>>::new();
    let mut seen = BTreeSet::new();
    for (index, row) in rows.iter().enumerate() {
        if row.participant_id.trim().is_empty() {
            return Err("short-OFF bridge requires a nonblank participant_id".into());
        }
        if !seen.insert((row.participant_id.as_str(), row.second_index)) {
            return Err("short-OFF bridge refuses duplicate participant/second_index clocks".into());
        }
        groups.entry(&row.participant_id).or_default().push(index);
    }
    let mut result = rows.iter().map(|row| row.state).collect::<Vec<_>>();
    for indices in groups.values_mut() {
        indices.sort_by_key(|index| rows[*index].second_index);
        let mut position = 0;
        while position < indices.len() {
            if rows[indices[position]].state != ScreenSecondState::Off {
                position += 1;
                continue;
            }
            let start = position;
            while position < indices.len()
                && rows[indices[position]].state == ScreenSecondState::Off
            {
                position += 1;
            }
            let end = position;
            let bounded = start > 0
                && end < indices.len()
                && rows[indices[start - 1]].state == ScreenSecondState::On
                && rows[indices[end]].state == ScreenSecondState::On;
            if !bounded || end - start > 3 {
                continue;
            }
            // Include both ON bounds. Adjacency in a sparse array is not one second.
            let consecutive = indices[start - 1..=end].windows(2).all(|pair| {
                rows[pair[0]].second_index.checked_add(1) == Some(rows[pair[1]].second_index)
            });
            if consecutive {
                for index in &indices[start..end] {
                    result[*index] = ScreenSecondState::On;
                }
            }
        }
    }
    Ok(result)
}

pub(crate) struct ShortOffBridgeCsv {
    pub bytes: Vec<u8>,
    pub source_row_count: usize,
}

pub(crate) fn prepare_short_off_bridge_csv(input: &[u8]) -> Result<ShortOffBridgeCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|error| format!("short-OFF header: {error}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("short-OFF bridge refuses duplicate column names".into());
    }
    let required = |field| headers.iter().position(|header| header == field)
        .ok_or_else(|| format!("short-OFF bridge requires {field}"));
    let participant = required("participant_id")?;
    let second = required("second_index")?;
    let state = required("screen_state")?;
    let mut original = Vec::new();
    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| format!("short-OFF row {}: {error}", index + 1))?;
        rows.push(ScreenSecond {
            participant_id: record[participant].to_owned(),
            second_index: record[second].parse::<i64>()
                .map_err(|_| format!("short-OFF row {} requires integer second_index", index + 1))?,
            state: ScreenSecondState::parse(&record[state])?,
        });
        original.push(record);
    }
    let states = bridge_on_bounded_short_off_runs(&rows)?;
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer.write_record([
        "participant_id", "second_index", "original_screen_state", "screen_state", "short_off_bridge_repaired",
    ]).map_err(|error| format!("short-OFF output header: {error}"))?;
    for ((row, record), state) in rows.iter().zip(&original).zip(states) {
        writer.write_record([
            &record[participant], &record[second], row.state.source_label(), state.source_label(),
            if row.state != state { "true" } else { "false" },
        ]).map_err(|error| format!("short-OFF output row: {error}"))?;
    }
    Ok(ShortOffBridgeCsv {
        bytes: writer.into_inner().map_err(|error| format!("short-OFF output: {error}"))?,
        source_row_count: rows.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(states: &[ScreenSecondState]) -> Vec<ScreenSecond> {
        states.iter().enumerate().map(|(second, state)| ScreenSecond {
            participant_id: "p".into(), second_index: second as i64, state: *state,
        }).collect()
    }

    #[test]
    fn only_one_through_three_on_bounded_seconds_are_repaired() {
        for count in 1..=4 {
            let mut states = vec![ScreenSecondState::On];
            states.extend(std::iter::repeat_n(ScreenSecondState::Off, count));
            states.push(ScreenSecondState::On);
            let expected = if count <= 3 { vec![ScreenSecondState::On; count + 2] } else { states.clone() };
            assert_eq!(bridge_on_bounded_short_off_runs(&rows(&states)).unwrap(), expected);
        }
    }

    #[test]
    fn gaps_unknowns_and_unbounded_runs_are_not_filled() {
        use ScreenSecondState::{Off, On, Unknown};
        for states in [vec![Off, On], vec![On, Off], vec![Unknown, Off, On],
            vec![On, Off, Unknown, Off, On]] {
            assert_eq!(bridge_on_bounded_short_off_runs(&rows(&states)).unwrap(), states);
        }
        for missing in [1, 2] {
            let mut input = rows(&[On, Off, On]);
            for row in &mut input[missing..] { row.second_index += 1; }
            assert_eq!(bridge_on_bounded_short_off_runs(&input).unwrap(), vec![On, Off, On]);
        }
    }

    #[test]
    fn participant_clock_is_explicit_and_input_order_is_preserved() {
        use ScreenSecondState::{Off, On};
        let input = vec![
            ScreenSecond { participant_id: "p".into(), second_index: 2, state: On },
            ScreenSecond { participant_id: "q".into(), second_index: 1, state: Off },
            ScreenSecond { participant_id: "p".into(), second_index: 0, state: On },
            ScreenSecond { participant_id: "p".into(), second_index: 1, state: Off },
        ];
        let result = bridge_on_bounded_short_off_runs(&input).unwrap();
        assert_eq!(result, vec![On, Off, On, On]);
        let repaired = input.iter().zip(result).map(|(row, state)| ScreenSecond { state, ..row.clone() }).collect::<Vec<_>>();
        assert_eq!(bridge_on_bounded_short_off_runs(&repaired).unwrap(), vec![On, Off, On, On]);
        let mut duplicate = input;
        duplicate.push(duplicate[0].clone());
        assert!(bridge_on_bounded_short_off_runs(&duplicate).is_err());
    }

    #[test]
    fn csv_preserves_lexical_indices_and_refuses_invalid_states_or_clocks() {
        let input = b"participant_id,second_index,screen_state\np,0002,screen-on\np,0000,screen-on\np,0001,screen-off\n";
        assert_eq!(prepare_short_off_bridge_csv(input).unwrap().bytes,
            b"participant_id,second_index,original_screen_state,screen_state,short_off_bridge_repaired\np,0002,screen-on,screen-on,false\np,0000,screen-on,screen-on,false\np,0001,screen-off,screen-on,true\n");
        for invalid in [
            "participant_id,second_index,screen_state\np,0,true\n",
            "participant_id,second_index,screen_state\np,1.0,screen-on\n",
            "participant_id,second_index,screen_state\np,0,screen-on\np,0,screen-off\n",
            "participant_id,second_index,screen_state\n ,0,screen-on\n",
        ] { assert!(prepare_short_off_bridge_csv(invalid.as_bytes()).is_err()); }
        assert_eq!(prepare_short_off_bridge_csv(b"participant_id,second_index,screen_state\n").unwrap().source_row_count, 0);
    }
}
