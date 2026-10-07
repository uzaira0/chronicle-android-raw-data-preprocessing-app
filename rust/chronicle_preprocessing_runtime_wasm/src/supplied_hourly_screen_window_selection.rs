//! Supplied-inventory selector, not the Ginger.io collector or rolling-grid builder.
//! PONE 10.1371/journal.pone.0165331, primary p3 / rank132:132–149;
//! text SHA256 59639ddbada613877a6750bac09df32160d5567744ab9e7cb0ff8e39cdf55e4a.
//! The whole-hour typed domain excludes unresolved partial-hour missingness.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const INPUT_FIELDS: [&str; 11] = [
    "participant_id",
    "source_device_id",
    "source_stream_id",
    "clock_id",
    "inventory_id",
    "app_observation_days",
    "inventory_state",
    "expected_day_ids_json",
    "hourly_days_json",
    "expected_candidate_ids_json",
    "candidates_json",
];
const OUTPUT_FIELDS: [&str; 8] = [
    "selection_status",
    "selected_candidate_id",
    "selected_start_day_order",
    "selected_end_day_order",
    "selected_missing_hour_count",
    "selected_expected_hour_count",
    "selected_day_ids_json",
    "selected_hourly_days_json",
];
const WINDOW_DAYS: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum HourState {
    ValidEmpty,
    ValidObserved,
    Missing,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HourlyDay {
    source_day_id: String,
    day_order: i64,
    expected_hour_ids: Vec<String>,
    // Independent expected inventory above prevents an absent hour becoming valid zero.
    hour_states: Vec<(String, HourState)>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Candidate {
    candidate_id: String,
    start_day_order: i64,
    source_day_ids: Vec<String>,
}

pub struct PreparedHourlyScreenWindowSelection {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

fn identity(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("hourly window selection requires nonblank {field}"))
    } else {
        // Blank validation only. Lexical identities are never trimmed or normalized.
        Ok(())
    }
}

fn inventory_ids<'a>(values: &'a [String], field: &str) -> Result<BTreeSet<&'a str>, String> {
    let mut ids = BTreeSet::new();
    for value in values {
        identity(value, field)?;
        if !ids.insert(value.as_str()) {
            return Err(format!("duplicate {field}"));
        }
    }
    Ok(ids)
}

fn add(left: usize, right: usize) -> Result<usize, String> {
    left.checked_add(right)
        .ok_or_else(|| "hour count overflow".into())
}

fn select(
    app_days: f64,
    inventory_state: &str,
    expected_days: &[String],
    days: &[HourlyDay],
    expected_candidates: &[String],
    candidates: &[Candidate],
) -> Result<Vec<String>, String> {
    if !app_days.is_finite() || app_days < 0.0 {
        return Err("app_observation_days requires finite nonnegative supplied days".into());
    }
    if !matches!(inventory_state, "complete" | "known_empty") {
        return Err("inventory_state must be complete or known_empty; unknown is not empty".into());
    }
    let expected_day_ids = inventory_ids(expected_days, "expected source day ID")?;
    let expected_candidate_ids = inventory_ids(expected_candidates, "expected candidate ID")?;
    let mut day_by_id = BTreeMap::new();
    let mut day_orders = BTreeSet::new();
    let mut day_counts = BTreeMap::new();
    let mut observed_hours = 0usize;
    for day in days {
        identity(&day.source_day_id, "source_day_id")?;
        if day_by_id.insert(day.source_day_id.as_str(), day).is_some()
            || !day_orders.insert(day.day_order)
        {
            return Err(
                "source day IDs and supplied chronological day orders must be unique".into(),
            );
        }
        let expected_hours = inventory_ids(&day.expected_hour_ids, "expected source hour ID")?;
        if expected_hours.is_empty() {
            return Err(
                "each supplied day requires a nonempty complete expected-hour inventory".into(),
            );
        }
        let mut actual_hours = BTreeSet::new();
        let mut missing = 0usize;
        for (hour_id, state) in &day.hour_states {
            identity(hour_id, "source_hour_id")?;
            if !actual_hours.insert(hour_id.as_str()) {
                return Err("duplicate source hour ID within a day".into());
            }
            if *state == HourState::Missing {
                missing = add(missing, 1)?;
            } else {
                observed_hours = add(observed_hours, 1)?;
            }
        }
        if actual_hours != expected_hours {
            return Err(
                "hour states must exactly cover the independently supplied expected hours".into(),
            );
        }
        day_counts.insert(day.source_day_id.as_str(), (missing, actual_hours.len()));
    }
    if day_by_id.keys().copied().collect::<BTreeSet<_>>() != expected_day_ids {
        return Err(
            "hourly days must exactly cover the independently supplied expected day inventory"
                .into(),
        );
    }
    let mut candidate_ids = BTreeSet::new();
    let mut candidate_starts = BTreeSet::new();
    let mut scored = Vec::new();
    for candidate in candidates {
        identity(&candidate.candidate_id, "candidate_id")?;
        if !candidate_ids.insert(candidate.candidate_id.as_str())
            || !candidate_starts.insert(candidate.start_day_order)
        {
            return Err("candidate IDs and start-day orders must be unique; duplicate windows are not deduplicated".into());
        }
        if candidate.source_day_ids.len() != WINDOW_DAYS {
            return Err(
                "each supplied candidate must reference exactly 30 consecutive source days".into(),
            );
        }
        let mut missing = 0usize;
        let mut total = 0usize;
        for (offset, id) in candidate.source_day_ids.iter().enumerate() {
            let day = day_by_id
                .get(id.as_str())
                .ok_or("candidate references an absent source day")?;
            let expected_order = candidate
                .start_day_order
                .checked_add(offset as i64)
                .ok_or("candidate day-order overflow")?;
            if day.day_order != expected_order {
                return Err("candidate day references must follow the supplied consecutive chronological order".into());
            }
            let (day_missing, day_total) = day_counts[id.as_str()];
            missing = add(missing, day_missing)?;
            total = add(total, day_total)?;
        }
        scored.push((candidate, missing, total));
    }
    if candidate_ids != expected_candidate_ids {
        return Err(
            "candidates must exactly cover the independently supplied candidate inventory".into(),
        );
    }
    if inventory_state == "known_empty"
        && (!expected_days.is_empty()
            || !days.is_empty()
            || !expected_candidates.is_empty()
            || !candidates.is_empty())
    {
        return Err("known_empty requires explicitly empty day and candidate inventories".into());
    }
    if inventory_state == "complete" && days.is_empty() {
        return Err("complete hourly inventory must be nonempty; absent is not all-missing".into());
    }
    let excluded = |status: &str| {
        let mut output = vec![String::new(); OUTPUT_FIELDS.len()];
        output[0] = status.into();
        output
    };
    // App observation duration is separate from observed-hour/day counts.
    if app_days < 30.0 {
        return Ok(excluded("excluded-less-than-30-observation-days"));
    }
    if days.is_empty() {
        return Err("empty hourly inventory cannot establish 100-percent missingness".into());
    }
    if observed_hours == 0 {
        return Ok(excluded("excluded-100-percent-missing"));
    }
    let (chosen, missing, total) = scored
        .into_iter()
        .min_by_key(|(candidate, missing, _)| (*missing, candidate.start_day_order))
        .ok_or("eligible participant requires at least one supplied complete candidate")?;
    let selected_days = chosen
        .source_day_ids
        .iter()
        .map(|id| day_by_id[id.as_str()])
        .collect::<Vec<_>>();
    Ok(vec![
        "selected".into(),
        chosen.candidate_id.clone(),
        chosen.start_day_order.to_string(),
        chosen
            .start_day_order
            .checked_add(29)
            .ok_or("candidate day-order overflow")?
            .to_string(),
        missing.to_string(),
        total.to_string(),
        serde_json::to_string(&chosen.source_day_ids).map_err(|e| e.to_string())?,
        serde_json::to_string(&selected_days).map_err(|e| e.to_string())?,
    ])
}

pub fn execute_supplied_hourly_screen_window_selection_csv(
    input: &[u8],
) -> Result<PreparedHourlyScreenWindowSelection, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let header_set = headers.iter().collect::<BTreeSet<_>>();
    if headers.len() != INPUT_FIELDS.len()
        || header_set != INPUT_FIELDS.into_iter().collect::<BTreeSet<_>>()
    {
        return Err(
            "supplied hourly selector requires exactly its 11 unique registered columns".into(),
        );
    }
    let positions = INPUT_FIELDS.map(|field| headers.iter().position(|h| h == field).unwrap());
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut output_headers = headers.clone();
    for field in OUTPUT_FIELDS {
        output_headers.push_field(field);
    }
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    let mut participants = BTreeSet::new();
    let mut row_count = 0usize;
    for record in reader.records() {
        let mut record = record.map_err(|e| e.to_string())?;
        for (position, field) in positions.iter().zip(INPUT_FIELDS).take(5) {
            identity(&record[*position], field)?;
        }
        if !participants.insert(record[positions[0]].to_owned()) {
            return Err("one complete inventory per lexical participant is required; cross-device/stream/clock inventories are not merged".into());
        }
        let app_days = record[positions[5]]
            .trim()
            .parse::<f64>()
            .map_err(|_| "app_observation_days must be numeric supplied days")?;
        let expected_days: Vec<String> = serde_json::from_str(&record[positions[7]])
            .map_err(|e| format!("invalid expected_day_ids_json: {e}"))?;
        let days: Vec<HourlyDay> = serde_json::from_str(&record[positions[8]])
            .map_err(|e| format!("invalid hourly_days_json: {e}"))?;
        let expected_candidates: Vec<String> = serde_json::from_str(&record[positions[9]])
            .map_err(|e| format!("invalid expected_candidate_ids_json: {e}"))?;
        let candidates: Vec<Candidate> = serde_json::from_str(&record[positions[10]])
            .map_err(|e| format!("invalid candidates_json: {e}"))?;
        let selection = select(
            app_days,
            &record[positions[6]],
            &expected_days,
            &days,
            &expected_candidates,
            &candidates,
        )?;
        for field in selection {
            record.push_field(&field);
        }
        writer.write_record(&record).map_err(|e| e.to_string())?;
        row_count = add(row_count, 1)?;
    }
    let csv_bytes = writer.into_inner().map_err(|e| e.to_string())?;
    Ok(PreparedHourlyScreenWindowSelection {
        csv_bytes,
        row_count,
    })
}
