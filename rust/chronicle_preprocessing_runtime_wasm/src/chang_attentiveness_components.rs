//! Chang/Tang attending-action arithmetic on caller-qualified streams/pairs.
use std::collections::{BTreeMap, BTreeSet};
use super::{complete_standalone_component_adaptation, format_duration_seconds_from_ns,
    required_header, supplied_anchor_elapsed_nanoseconds, AdaptedLiteratureInput,
    MethodProfileInputBindingReceipt};
use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};

const GAPS: &str = "chronicle.chang-supplied-attending-action-gaps";
const MEAN: &str = "chronicle.chang-supplied-occupancy-gap-mean";
pub(super) const ADAPTERS: [&str; 2] = [GAPS, MEAN];

fn prepared_rows(raw: &[u8], fields: &[&str], adapter: &str, stage: &str)
    -> Result<(Vec<usize>, Vec<csv::StringRecord>), String>
{
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter} header: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{adapter} refuses duplicate headers"));
    }
    let columns = fields.iter().map(|field| required_header(&headers, field, adapter)).collect::<Result<Vec<_>, _>>()?;
    let stage_column = required_header(&headers, "input_stage", adapter)?;
    let mut records = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter} row: {e}"))?;
        if columns.iter().any(|column| record.get(*column).unwrap_or("").trim().is_empty())
            || record.get(stage_column) != Some(stage) {
            return Err(format!("{adapter} requires complete caller-qualified {stage} input"));
        }
        records.push(record);
    }
    Ok((columns, records))
}

pub(super) fn adapt(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    match adapter { GAPS => gaps(raw,digest,bindings), MEAN => mean(raw,digest,bindings),
        _ => Err("unregistered Chang component".into()) }
}

fn gaps(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (c, rows) = prepared_rows(raw,
        &["source_row_id","participant_id","coverage_scope_id","clock_id","attending_action_id",
          "attending_role","source_order","timestamp_ns","input_stage"],
        GAPS, "caller-qualified-ordered-general-attending-actions")?;
    if rows.len() < 2 { return Err(format!("{GAPS} requires at least two supplied attending actions; source edge policy is unknown")); }
    let first = &rows[0];
    let mut actions = BTreeSet::new();
    let mut anchors = Vec::new();
    for row in &rows {
        if [1,2,3].into_iter().any(|field| row[c[field]] != first[c[field]]) {
            return Err(format!("{GAPS} requires one exact participant/coverage/common-clock scope"));
        }
        if !matches!(&row[c[5]], "wake_or_unlock" | "notification_bar_action" | "outgoing_notification_app_message") {
            return Err(format!("{GAPS} requires a caller-qualified attending-action role, not notification arrival/reading"));
        }
        let order = row[c[6]].parse::<u64>().map_err(|_| format!("{GAPS} source_order requires u64"))?;
        let time = row[c[7]].parse::<i64>().map_err(|_| format!("{GAPS} requires signed i64 common-clock nanoseconds"))?;
        if anchors.last().is_some_and(|(prior_order,prior_time)| order <= *prior_order || time <= *prior_time)
            || !actions.insert(&row[c[4]]) {
            return Err(format!("{GAPS} requires distinct actions with strict supplied source/time order; no duplicate/tie/edge policy is inferred"));
        }
        anchors.push((order,time));
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["participant_id","coverage_scope_id","clock_id","start_source_row_id","end_source_row_id",
        "start_attending_action_id","end_attending_action_id","start_attending_role","end_attending_role",
        "start_timestamp_ns","end_timestamp_ns","gap_nanoseconds","gap_seconds"])
        .map_err(|e| format!("{GAPS} output header: {e}"))?;
    for (index,pair) in rows.windows(2).enumerate() {
        let elapsed = supplied_anchor_elapsed_nanoseconds(anchors[index].1,anchors[index+1].1);
        writer.write_record([&first[c[1]],&first[c[2]],&first[c[3]],&pair[0][c[0]],&pair[1][c[0]],
            &pair[0][c[4]],&pair[1][c[4]],&pair[0][c[5]],&pair[1][c[5]],
            &anchors[index].1.to_string(),&anchors[index+1].1.to_string(),
            &elapsed.to_string(),&format_duration_seconds_from_ns(elapsed)])
            .map_err(|e| format!("{GAPS} output: {e}"))?;
    }
    let bytes = writer.into_inner().map_err(|e| format!("{GAPS} finish: {e}"))?;
    complete_standalone_component_adaptation(GAPS,"literature-chang-supplied-attending-action-gaps-csv",
        digest,bindings,rows.len(),rows.len()-1,bytes)
}

fn mean(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (c, rows) = prepared_rows(raw,
        &["source_row_id","participant_id","occupancy_id","clock_id","ringer_mode","occupancy_start_ns","occupancy_end_ns",
          "start_attending_action_id","start_timestamp_ns","end_attending_action_id","end_timestamp_ns","input_stage"],
        MEAN, "caller-qualified-successive-attending-pairs-strictly-inside-occupancy")?;
    let first = rows.first().ok_or_else(|| format!("{MEAN} requires a qualified gap inventory; no fewer-than-two-action default is known"))?;
    if !matches!(&first[c[4]], "Normal" | "Vibrate" | "Silent") {
        return Err(format!("{MEAN} requires a supplied source ringer mode"));
    }
    let start = first[c[5]].parse::<i64>().map_err(|_| format!("{MEAN} occupancy start requires i64 nanoseconds"))?;
    let end = first[c[6]].parse::<i64>().map_err(|_| format!("{MEAN} occupancy end requires i64 nanoseconds"))?;
    if start >= end { return Err(format!("{MEAN} requires a positive supplied occupancy span")); }
    let mut events = BTreeMap::new();
    let mut successors = BTreeMap::new();
    let mut predecessors = BTreeMap::new();
    let mut numeric = Vec::new();
    for row in &rows {
        if [1,2,3,4,5,6].into_iter().any(|field| row[c[field]] != first[c[field]]) {
            return Err(format!("{MEAN} requires one exact supplied participant/occupancy/clock/mode/span"));
        }
        let a = row[c[8]].parse::<i64>().map_err(|_| format!("{MEAN} attending start requires i64 nanoseconds"))?;
        let b = row[c[10]].parse::<i64>().map_err(|_| format!("{MEAN} attending end requires i64 nanoseconds"))?;
        if !(start < a && a < b && b < end) {
            return Err(format!("{MEAN} requires positive gaps strictly inside occupancy; boundary/crossing policy is source-unknown"));
        }
        let from = &row[c[7]];
        let to = &row[c[9]];
        if successors.get(from).is_some_and(|prior| *prior != to)
            || predecessors.get(to).is_some_and(|prior| *prior != from) {
            return Err(format!("{MEAN} conflicting supplied successor/predecessor declarations"));
        }
        successors.insert(from, to);
        predecessors.insert(to, from);
        for (field,time) in [(7,a),(9,b)] {
            let id = &row[c[field]];
            if events.get(id).is_some_and(|prior| *prior != time) {
                return Err(format!("{MEAN} conflicting supplied attending-action time"));
            }
            events.insert(id,time);
        }
        let seconds = supplied_anchor_elapsed_nanoseconds(a,b) as f64 / 1_000_000_000.0;
        numeric.push(GroupedNumericRow {group:Some(first[c[2]].to_owned()),values:vec![Some(seconds)]});
    }
    // Refuse only contradictions among supplied facts; do not form or select pairs.
    for row in &rows {
        let a = events[&row[c[7]]];
        let b = events[&row[c[9]]];
        if events.values().any(|known| a < *known && *known < b) {
            return Err(format!("{MEAN} a known supplied endpoint lies strictly inside a declared successive pair"));
        }
    }
    // Reuse the existing grouped arithmetic mean on complete, finite values.
    let summaries = summarize_columns_by_first_seen_group(&numeric)
        .map_err(|e| format!("{MEAN} supplied mean: {e:?}"))?;
    let seconds = summaries[0].means[0];
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["participant_id","occupancy_id","clock_id","ringer_mode","occupancy_start_ns","occupancy_end_ns",
        "qualified_gap_count","mean_gap_seconds","mean_gap_minutes"])
        .map_err(|e| format!("{MEAN} output header: {e}"))?;
    writer.write_record([&first[c[1]],&first[c[2]],&first[c[3]],&first[c[4]],&first[c[5]],&first[c[6]],
        &rows.len().to_string(),&seconds.to_string(),&(seconds/60.0).to_string()])
        .map_err(|e| format!("{MEAN} output: {e}"))?;
    let bytes = writer.into_inner().map_err(|e| format!("{MEAN} finish: {e}"))?;
    complete_standalone_component_adaptation(MEAN,"literature-chang-supplied-occupancy-gap-mean-csv",
        digest,bindings,rows.len(),1,bytes)
}
