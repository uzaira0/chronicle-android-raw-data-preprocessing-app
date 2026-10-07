//! Retained RAPIDS1.9.4 screen_episodes.R:18–65, member SHA256 ae3cf3fb….
//! Qualified typed participant-wide rows, in supplied order, on one common ms
//! clock. This is a portable CSV projection, not read.csv/R serializer parity.
use super::required_header;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const ADAPTER: &str = "chronicle.rapids-released-screen-episodes";
pub(super) const KIND: &str = "literature-rapids-released-screen-episodes-csv";
pub(super) const FIELDS: [&str; 9] = [
    "source_row_id",
    "participant_id",
    "inventory_id",
    "clock_id",
    "clock_unit",
    "input_stage",
    "timestamp_ms",
    "device_id",
    "screen_status",
];
const OUTPUT_FIELDS: [&str; 8] = [
    "episode_id",
    "episode",
    "device_id",
    "screen_sequence",
    "start_timestamp",
    "end_timestamp",
    "original_start_source_row_index",
    "original_end_source_row_index",
];
struct Screen {
    time: f64,
    state: u16,
    device: String,
    source_index: usize,
}

// Each pass reads its complete input snapshot. R filter drops an NA predicate:
// a first LOCK has TRUE & NA & NA, whereas a first non-LOCK has FALSE & NA.
fn filter_locks<'a>(rows: &[&'a Screen], predecessor: u16) -> Vec<&'a Screen> {
    rows.iter()
        .enumerate()
        .filter_map(|(i, row)| {
            let drop = row.state == 2
                && (i == 0
                    || (rows[i - 1].state == predecessor && row.time - rows[i - 1].time < 50.0));
            (!drop).then_some(*row)
        })
        .collect()
}

pub(super) fn csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader
        .headers()
        .map_err(|e| format!("{ADAPTER} header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{ADAPTER} refuses duplicate column identities"));
    }
    let fields = FIELDS
        .iter()
        .map(|name| required_header(&headers, name, ADAPTER).map(|i| (*name, i)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut source = Vec::<Screen>::new();
    let mut owner = None;
    let mut ids = BTreeSet::new();
    for row in reader.records() {
        let row = row.map_err(|e| format!("{ADAPTER} row: {e}"))?;
        let v = |name: &str| &row[fields[name]];
        for name in [
            "source_row_id",
            "participant_id",
            "inventory_id",
            "clock_id",
            "device_id",
        ] {
            if v(name).trim().is_empty() {
                return Err(format!("{ADAPTER} requires {name}"));
            }
        }
        let this_owner = [v("participant_id"), v("inventory_id"), v("clock_id")].map(str::to_owned);
        if owner.as_ref().is_some_and(|prior| *prior != this_owner) {
            return Err(format!(
                "{ADAPTER} requires one qualified participant/common-clock inventory"
            ));
        }
        owner = Some(this_owner);
        if !ids.insert(v("source_row_id").to_owned()) {
            return Err(format!(
                "{ADAPTER} requires distinct supplied occurrence identities"
            ));
        }
        if v("clock_unit") != "ms" || v("input_stage") != "caller-complete-v194-typed-screen-rows" {
            return Err(format!(
                "{ADAPTER} requires complete typed rows on an explicit common ms clock"
            ));
        }
        let time = v("timestamp_ms")
            .parse::<f64>()
            .ok()
            .filter(|time| time.is_finite())
            .ok_or_else(|| format!("{ADAPTER} requires finite typed millisecond coordinates"))?;
        let state = v("screen_status")
            .parse::<u16>()
            .ok()
            .filter(|state| *state <= 3)
            .ok_or_else(|| format!("{ADAPTER} requires known integer screen states 0,1,2,3"))?;
        source.push(Screen {
            time,
            state,
            device: v("device_id").to_owned(),
            source_index: source.len() + 1,
        });
    }
    let mut output = csv::Writer::from_writer(Vec::new());
    // R's n<2 branch lacks episode_id and has character timestamp columns. A
    // fixed portable schema deliberately normalizes that empty-schema variation.
    output
        .write_record(OUTPUT_FIELDS)
        .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    let mut emitted = 0;
    if source.len() >= 2 {
        let source_refs = source.iter().collect::<Vec<_>>();
        let after_on = filter_locks(&source_refs, 1);
        let rows = filter_locks(&after_on, 0);
        // OFF IDs are 1-based positions AFTER both filters, not episode counters.
        // fill(updown) first fills UP to the next OFF, then DOWN the trailing tail.
        let mut episode_ids = vec![None; rows.len()];
        let mut next_off = None;
        for i in (0..rows.len()).rev() {
            if rows[i].state == 0 {
                next_off = Some(i + 1);
            }
            episode_ids[i] = next_off;
        }
        let mut previous_id = None;
        let mut groups = BTreeMap::<usize, Vec<&Screen>>::new();
        for (row, id) in rows.iter().zip(episode_ids.iter_mut()) {
            if id.is_none() {
                *id = previous_id;
            }
            previous_id = *id;
            // An all-NA group has no OFF, so the later 3/0 predicate is empty.
            if let Some(id) = id {
                groups.entry(*id).or_default().push(*row);
            }
        }
        for (episode_id, group) in groups {
            // Three vectorized mutations; the second sees the marked snapshot,
            // never an in-place moving-neighbor scan. Only states are swapped.
            let marked = group
                .iter()
                .enumerate()
                .map(|(i, row)| {
                    if row.state == 1
                        && i > 0
                        && group[i - 1].state == 3
                        && row.time - group[i - 1].time < 800.0
                    {
                        800
                    } else {
                        row.state
                    }
                })
                .collect::<Vec<_>>();
            let swapped = marked
                .iter()
                .enumerate()
                .map(|(i, state)| {
                    let state = if *state == 3 && marked.get(i + 1) == Some(&800) {
                        1
                    } else {
                        *state
                    };
                    if state == 800 {
                        3
                    } else {
                        state
                    }
                })
                .collect::<Vec<_>>();
            let without_on = group
                .iter()
                .zip(swapped)
                .filter(|(_, state)| *state != 1)
                .map(|(row, state)| (*row, state))
                .collect::<Vec<_>>();
            let selected = without_on
                .iter()
                .enumerate()
                .filter_map(|(i, row)| {
                    let keep = (row.1 == 3
                        && without_on.get(i + 1).is_some_and(|next| next.1 == 0))
                        || (row.1 == 0 && i > 0 && without_on[i - 1].1 == 3);
                    // Missing lead/lag yields NA or FALSE unless the other arm is
                    // TRUE; retaining only TRUE implements R filter's NA dropping.
                    keep.then_some(*row)
                })
                .collect::<Vec<_>>();
            if let (Some(first), Some(last)) = (selected.first(), selected.last()) {
                if first.1 != 3 || last.1 != 0 {
                    continue;
                }
                let sequence = selected
                    .iter()
                    .map(|(_, state)| state.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                output
                    .write_record([
                        episode_id.to_string(),
                        "unlock".to_owned(),
                        first.0.device.clone(),
                        sequence,
                        first.0.time.to_string(),
                        last.0.time.to_string(),
                        first.0.source_index.to_string(),
                        last.0.source_index.to_string(),
                    ])
                    .map_err(|e| format!("{ADAPTER} output: {e}"))?;
                emitted += 1;
            }
        }
    }
    Ok((
        output
            .into_inner()
            .map_err(|e| format!("{ADAPTER} output: {e}"))?,
        source.len(),
        emitted,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rapids_screen_released_source_hand_cases_preserve_filters_ids_order_and_swap_boundaries() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/rapids_released_screen_episodes_hand.json"
        ))
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let raw = format!(
                "{}\n",
                case["rawCsvLines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("\n")
            );
            let (bytes, source_rows, emitted) = csv(raw.as_bytes()).unwrap();
            assert_eq!(
                source_rows,
                case["rawCsvLines"].as_array().unwrap().len() - 1
            );
            let mut reader = csv::Reader::from_reader(bytes.as_slice());
            assert_eq!(
                reader.headers().unwrap().iter().collect::<Vec<_>>(),
                OUTPUT_FIELDS
            );
            let actual = reader.records().map(Result::unwrap).collect::<Vec<_>>();
            let expected = case["expectedRows"].as_array().unwrap();
            assert_eq!(emitted, expected.len(), "{}", case["caseId"]);
            assert_eq!(actual.len(), expected.len(), "{}", case["caseId"]);
            for (actual, expected) in actual.iter().zip(expected) {
                assert_eq!(
                    actual.iter().collect::<Vec<_>>(),
                    expected
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap())
                        .collect::<Vec<_>>(),
                    "{}",
                    case["caseId"]
                );
            }
        }
    }
    #[test]
    fn rapids_screen_typed_input_refuses_unknown_states_nonfinite_clocks_and_scope_pooling() {
        let header = FIELDS.join(",");
        let base = "r,P,inventory,clock,ms,caller-complete-v194-typed-screen-rows,0,D,3";
        for invalid in [
            base.replace(",3", ",4"),
            base.replace(",0,D", ",NaN,D"),
            base.replace(",ms,", ",seconds,"),
            base.replace(",clock,", ",,"),
            format!(
                "{base}\ns,Q,inventory,clock,ms,caller-complete-v194-typed-screen-rows,100,D,0"
            ),
            format!("{base}\n{base}"),
        ] {
            assert!(csv(format!("{header}\n{invalid}\n").as_bytes()).is_err());
        }
    }
}
