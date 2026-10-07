//! AffectPro supplied-sequence arithmetic, not its unreleased IME/session constructor.
//!
//! Pinned primary DOI 10.1145/3536221.3556603, printed p218 (text114-125):
//! n touches; duration t[n]-t[1]; consecutive ITD t[i+1]-t[i]. Supplied order
//! is authoritative. Clock/tie/anomaly/missingness admission is not reconstructed.

use crate::grouped_category_count::count_categories_by_group;
use std::collections::{BTreeMap, BTreeSet};

pub const ADAPTER: &str = "chronicle.affectpro-ordered-touch-features";
pub const RESULT_KIND: &str = "literature-affectpro-ordered-touch-features-csv";
pub const STREAM_ROLE: &str = "affectpro_supplied_session_touch_sequence";
pub const OWNERS: [&str; 6] = [
    "participant_id",
    "device_id",
    "application_id",
    "task_id",
    "session_id",
    "source_sequence_id",
];
pub const OUTPUT_FIELDS: [&str; 11] = [
    "touch_sequence_ordinal",
    "session_touch_count",
    "session_duration",
    "session_duration_status",
    "session_duration_unit",
    "next_touch_source_row_id",
    "next_touch_sequence_ordinal",
    "inter_tap_duration",
    "inter_tap_duration_status",
    "inter_tap_duration_unit",
    "timing_claim_scope",
];

pub struct PreparedAffectProFeatures {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

#[derive(Clone)]
struct TouchClock {
    clock: String,
    unit: String,
    precision: Option<i64>,
    timestamp: Option<i64>,
}

/// One widened subtraction shared by duration and consecutive ITDs. Units do
/// not affect subtraction, and precision metadata is never an epoch modulus.
fn difference(first: &TouchClock, last: &TouchClock) -> Result<(i128, String), &'static str> {
    if first.clock.trim().is_empty() || last.clock.trim().is_empty() {
        return Err("missing_clock_id");
    }
    if first.clock != last.clock {
        return Err("incompatible_clock_ids");
    }
    if !matches!(first.unit.as_str(), "ns" | "us" | "ms" | "s")
        || !matches!(last.unit.as_str(), "ns" | "us" | "ms" | "s")
    {
        return Err("missing_or_unsupported_time_unit");
    }
    if first.unit != last.unit {
        return Err("incompatible_time_units");
    }
    if !first.precision.is_some_and(|p| p > 0) || !last.precision.is_some_and(|p| p > 0) {
        return Err("missing_or_invalid_precision_metadata");
    }
    let first_time = first
        .timestamp
        .ok_or("missing_or_noninteger_touch_timestamp")?;
    let last_time = last
        .timestamp
        .ok_or("missing_or_noninteger_touch_timestamp")?;
    Ok((
        i128::from(last_time) - i128::from(first_time),
        first.unit.clone(),
    ))
}

fn rendered(result: Result<(i128, String), &'static str>) -> [String; 3] {
    match result {
        Ok((value, unit)) => [
            value.to_string(),
            "computed_supplied_order_arithmetic".into(),
            unit,
        ],
        Err(reason) => [
            String::new(),
            format!("unavailable:{reason}"),
            String::new(),
        ],
    }
}

/// Every supplied row is one touch occurrence, including repeated identical
/// rows/source IDs. The caller attests sequence membership; no five-second rule,
/// sorting, character/key classification, raw app-switch API, or cohort filter.
/// All original lexical values and row order survive. Timing refusals are local
/// to each difference; they never erase independently defined occurrence counts.
pub fn execute_affectpro_touch_csv(raw: &[u8]) -> Result<PreparedAffectProFeatures, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("AffectPro requires unique CSV column names".into());
    }
    if OUTPUT_FIELDS
        .iter()
        .any(|field| headers.iter().any(|h| h == *field))
    {
        return Err("AffectPro refuses supplied computed output columns".into());
    }
    let column = |name: &str| {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| format!("{ADAPTER} requires column {name}"))
    };
    let owner_columns = OWNERS
        .iter()
        .map(|field| column(field))
        .collect::<Result<Vec<_>, _>>()?;
    let source_row = column("source_row_id")?;
    let role = column("source_stream_role")?;
    let clock = column("clock_id")?;
    let unit = column("time_unit")?;
    let precision = column("time_precision")?;
    let timestamp = column("touch_timestamp")?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut owners = Vec::with_capacity(records.len());
    let mut clocks = Vec::with_capacity(records.len());
    let mut groups = BTreeMap::<Vec<String>, Vec<usize>>::new();
    for (index, record) in records.iter().enumerate() {
        let owner = owner_columns
            .iter()
            .map(|&column| record[column].to_owned())
            .collect::<Vec<_>>();
        if owner.iter().any(|value| value.trim().is_empty()) || record[source_row].trim().is_empty()
        {
            return Err("AffectPro requires nonempty lexical ownership and source-row IDs".into());
        }
        if &record[role] != STREAM_ROLE {
            return Err(format!(
                "AffectPro requires caller-attested source_stream_role={STREAM_ROLE}"
            ));
        }
        groups.entry(owner.clone()).or_default().push(index);
        owners.push(owner);
        clocks.push(TouchClock {
            clock: record[clock].to_owned(),
            unit: record[unit].to_owned(),
            precision: record[precision].parse::<i64>().ok(),
            timestamp: record[timestamp].parse::<i64>().ok(),
        });
    }
    // Reuse the existing all-occurrence counter, not distinct-member counting.
    // Its sorted summaries are only looked up; source output order is untouched.
    let counts = count_categories_by_group(owners.iter().cloned().map(|owner| (owner, ())))
        .into_iter()
        .map(|count| (count.group, count.observation_count))
        .collect::<BTreeMap<_, _>>();
    let mut appended = vec![Vec::<String>::new(); records.len()];
    for (owner, indices) in &groups {
        let first = indices[0];
        let last = indices[indices.len() - 1];
        let duration = if indices.len() < 2 {
            rendered(Err("single_touch_source_behavior_undisclosed"))
        } else {
            rendered(difference(&clocks[first], &clocks[last]))
        };
        for (ordinal, &index) in indices.iter().enumerate() {
            let (next_id, next_ordinal, itd) = match indices.get(ordinal + 1) {
                Some(&next) => (
                    records[next][source_row].to_owned(),
                    (ordinal + 2).to_string(),
                    rendered(difference(&clocks[index], &clocks[next])),
                ),
                None => (
                    String::new(),
                    String::new(),
                    [
                        String::new(),
                        "not_applicable:sequence_end".into(),
                        String::new(),
                    ],
                ),
            };
            appended[index] = vec![
                (ordinal + 1).to_string(),
                counts[owner].to_string(),
                duration[0].clone(),
                duration[1].clone(),
                duration[2].clone(),
                next_id,
                next_ordinal,
                itd[0].clone(),
                itd[1].clone(),
                itd[2].clone(),
                "arithmetic_only_not_source_session_admission".into(),
            ];
        }
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    let mut output_headers = headers.clone();
    output_headers.extend(OUTPUT_FIELDS);
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    for (record, extra) in records.iter().zip(appended) {
        let mut output = record.clone();
        output.extend(extra.iter().map(String::as_str));
        writer.write_record(&output).map_err(|e| e.to_string())?;
    }
    Ok(PreparedAffectProFeatures {
        csv_bytes: writer.into_inner().map_err(|e| e.to_string())?,
        row_count: records.len(),
    })
}
