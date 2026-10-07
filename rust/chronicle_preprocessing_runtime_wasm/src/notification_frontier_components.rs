//! Retained source rules over explicit caller-prepared rows, not collectors.
use std::collections::{BTreeMap, BTreeSet};
use super::{
    complete_standalone_component_adaptation, format_duration_seconds_from_ns,
    required_header, supplied_anchor_elapsed_nanoseconds, AdaptedLiteratureInput,
    MethodProfileInputBindingReceipt,
};
use crate::grouped_category_count::count_categories_by_group;

const DISMISSED: &str = "chronicle.dismissed-supplied-burst-last";
const ANNOTIF: &str = "chronicle.annotif-supplied-summary-hash-filter";
const DINGLER: &str = "chronicle.dingler-supplied-foreground-exclusion";
const MYPHONE: &str = "chronicle.myphoneme-supplied-response-times";
pub(super) const ADAPTERS: [&str; 4] = [DISMISSED, ANNOTIF, DINGLER, MYPHONE];

// Transport validation only. It neither constructs source groups nor pairs events.
fn rows(raw: &[u8], fields: &[&str], adapter: &str, stage: &str)
    -> Result<(csv::StringRecord, Vec<usize>, Vec<csv::StringRecord>), String>
{
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter} header: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{adapter} refuses duplicate headers"));
    }
    let columns = fields.iter().map(|field| required_header(&headers, field, adapter)).collect::<Result<Vec<_>, _>>()?;
    let stage_column = required_header(&headers, "input_stage", adapter)?;
    let mut records = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("{adapter} row {}: {e}", index + 1))?;
        if columns.iter().any(|column| record.get(*column).unwrap_or("").trim().is_empty())
            || record.get(stage_column) != Some(stage)
        {
            return Err(format!("{adapter} row {} requires complete {stage} input", index + 1));
        }
        records.push(record);
    }
    Ok((headers, columns, records))
}

pub(super) fn adapt(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    match adapter {
        DISMISSED => dismissed(raw, digest, bindings),
        ANNOTIF => annotif(raw, digest, bindings),
        DINGLER => dingler(raw, digest, bindings),
        MYPHONE => myphone(raw, digest, bindings),
        _ => Err("unregistered prepared notification component".into()),
    }
}

fn selected_output(adapter: &str, kind: &'static str, digest: &str,
    bindings: &[MethodProfileInputBindingReceipt], headers: &csv::StringRecord,
    records: &[csv::StringRecord], retained: &[bool]) -> Result<AdaptedLiteratureInput, String>
{
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(headers).map_err(|e| format!("{adapter} output header: {e}"))?;
    let mut count = 0;
    for (record, keep) in records.iter().zip(retained) {
        if *keep {
            writer.write_record(record).map_err(|e| format!("{adapter} output row: {e}"))?;
            count += 1;
        }
    }
    let bytes = writer.into_inner().map_err(|e| format!("{adapter} finish output: {e}"))?;
    complete_standalone_component_adaptation(adapter, kind, digest, bindings, records.len(), count, bytes)
}

fn dismissed(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (headers, c, records) = rows(raw,
        &["source_row_id", "participant_id", "same_second_burst_id", "source_order", "callback_kind", "input_stage"],
        DISMISSED, "caller-resolved-same-second-bursts-after-title-cleaning")?;
    let mut previous_order = BTreeMap::new();
    let mut last = BTreeMap::new();
    for (index, record) in records.iter().enumerate() {
        if &record[c[4]] != "notification_posted" {
            return Err(format!("{DISMISSED} requires notification_posted callbacks"));
        }
        let order = record[c[3]].parse::<u64>().map_err(|_| format!("{DISMISSED} source_order requires u64"))?;
        let participant = &record[c[1]];
        if previous_order.get(participant).is_some_and(|previous| *previous >= order) {
            return Err(format!("{DISMISSED} requires strictly increasing supplied participant source_order; ties are unresolved"));
        }
        previous_order.insert(participant, order);
        last.insert((participant, &record[c[2]]), index);
    }
    let retained = records.iter().enumerate().map(|(i, r)| last[&(&r[c[1]], &r[c[2]])] == i).collect::<Vec<_>>();
    selected_output(DISMISSED, "literature-dismissed-supplied-burst-last-csv", digest, bindings, &headers, &records, &retained)
}

fn annotif(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (headers, c, records) = rows(raw,
        &["source_row_id", "participant_id", "app_day_cluster_id", "app_package", "day_id", "group_key", "is_group_summary", "content_sha256", "source_order", "input_stage"],
        ANNOTIF, "caller-resolved-app-day-clusters-before-summary-filter")?;
    let mut cluster_identity = BTreeMap::new();
    let mut cluster_by_scope = BTreeMap::new();
    let mut order_by_cluster = BTreeMap::new();
    let mut observations = Vec::new();
    for record in &records {
        let summary = match &record[c[6]] { "true" => true, "false" => false, _ => return Err(format!("{ANNOTIF} is_group_summary requires true/false")) };
        let hash = &record[c[7]];
        // Require the caller's canonical hash representation; do not lowercase it.
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(format!("{ANNOTIF} content_sha256 requires a supplied 64-lowercase-hex digest"));
        }
        let cluster = (&record[c[1]], &record[c[2]]);
        let identity = (&record[c[3]], &record[c[4]]);
        if cluster_identity.get(&cluster).is_some_and(|prior| prior != &identity) {
            return Err(format!("{ANNOTIF} supplied cluster cannot change app/day identity"));
        }
        cluster_identity.insert(cluster, identity);
        let scope = (&record[c[1]], &record[c[3]], &record[c[4]]);
        if cluster_by_scope.get(&scope).is_some_and(|prior| prior != &cluster) {
            return Err(format!("{ANNOTIF} supplied participant/app/day cannot split across cluster aliases"));
        }
        cluster_by_scope.insert(scope, cluster);
        let order = record[c[8]].parse::<u64>().map_err(|_| format!("{ANNOTIF} source_order requires u64"))?;
        if order_by_cluster.get(&cluster).is_some_and(|previous| *previous >= order) {
            return Err(format!("{ANNOTIF} requires strictly increasing declared first-instance order per cluster"));
        }
        order_by_cluster.insert(cluster, order);
        observations.push(((cluster, identity, &record[c[5]]), summary));
    }
    // Reuse the exact grouped observation-count operator; any child suffices.
    let child_groups = count_categories_by_group(observations.iter().cloned()).into_iter()
        .filter(|count| !count.category).map(|count| count.group).collect::<BTreeSet<_>>();
    let mut hashes = BTreeSet::new();
    let retained = records.iter().zip(&observations).map(|(r, (group, summary))| {
        if *summary && child_groups.contains(group) { return false; }
        // FIRST supplied survivor wins, exactly as the existing Ethica row filter.
        hashes.insert((&r[c[1]], &r[c[2]], &r[c[3]], &r[c[4]], &r[c[7]]))
    }).collect::<Vec<_>>();
    selected_output(ANNOTIF, "literature-annotif-supplied-summary-hash-filter-csv", digest, bindings, &headers, &records, &retained)
}

fn dingler(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (headers, c, records) = rows(raw,
        &["source_row_id", "participant_id", "notification_id", "notification_package", "foreground_package_at_arrival", "input_stage"],
        DINGLER, "caller-resolved-arrival-foreground")?;
    let retained = records.iter().map(|r| r[c[3]] != r[c[4]]).collect::<Vec<_>>();
    selected_output(DINGLER, "literature-dingler-supplied-foreground-exclusion-csv", digest, bindings, &headers, &records, &retained)
}

fn myphone(raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let (mut headers, c, records) = rows(raw,
        &["source_row_id", "participant_id", "notification_id", "clock_id", "arrival_event_id", "arrival_timestamp_ns",
          "assumed_seen_event_id", "assumed_seen_timestamp_ns", "action_event_id", "action_timestamp_ns",
          "arrival_unlock_state", "action_kind", "input_stage"],
        MYPHONE, "caller-resolved-arrival-seen-action")?;
    const OUTPUTS: [&str; 6] = ["seen_time_nanoseconds", "seen_time_seconds", "decision_time_nanoseconds", "decision_time_seconds", "response_time_nanoseconds", "response_time_seconds"];
    if headers.iter().any(|field| OUTPUTS.contains(&field)) {
        return Err(format!("{MYPHONE} refuses supplied elapsed outputs"));
    }
    for field in OUTPUTS { headers.push_field(field); }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&headers).map_err(|e| format!("{MYPHONE} output header: {e}"))?;
    let mut events = BTreeMap::new();
    for mut record in records.iter().cloned() {
        let mut times = Vec::with_capacity(3);
        for field in [4, 6, 8] {
            let timestamp = record[c[field + 1]].parse::<i64>().map_err(|_| format!("{MYPHONE} requires signed i64 nanosecond endpoints"))?;
            times.push(timestamp);
        }
        // One phone unlock can be the assumed-seen anchor for many notifications.
        // An unlocked arrival instead supplies a derived arrival-time proxy, not an unlock.
        let seen_role = match &record[c[10]] {
            "locked" => ("phone_unlock", None),
            "already_unlocked_or_in_use" if times[0] == times[1] => {
                let role = if record[c[6]] == record[c[4]] { "notification_arrival" } else { "arrival_time_seen_proxy" };
                (role, Some(record[c[2]].to_owned()))
            },
            "already_unlocked_or_in_use" => return Err(format!("{MYPHONE} unlocked convention requires supplied assumed-seen anchor at arrival")),
            _ => return Err(format!("{MYPHONE} requires explicit arrival_unlock_state")),
        };
        if !matches!(&record[c[11]], "notification_bar_click" | "corresponding_app_launch" | "swipe_dismiss") {
            return Err(format!("{MYPHONE} requires a source action role, not generic removal"));
        }
        let roles = [
            ("notification_arrival", Some(record[c[2]].to_owned())),
            seen_role,
            (&record[c[11]], Some(record[c[2]].to_owned())),
        ];
        for ((field, timestamp), (role, notification)) in [4, 6, 8].into_iter().zip(&times).zip(roles) {
            let key = (record[c[1]].to_owned(), record[c[field]].to_owned());
            let identity = (record[c[3]].to_owned(), *timestamp, role.to_owned(), notification);
            if events.get(&key).is_some_and(|prior| prior != &identity) {
                return Err(format!("{MYPHONE} conflicting supplied event clock/time/role or notification attribution"));
            }
            events.insert(key, identity);
        }
        let seen = supplied_anchor_elapsed_nanoseconds(times[0], times[1]);
        let decision = supplied_anchor_elapsed_nanoseconds(times[1], times[2]);
        let total = supplied_anchor_elapsed_nanoseconds(times[0], times[2]);
        for elapsed in [seen, decision, total] {
            record.push_field(&elapsed.to_string());
            record.push_field(&format_duration_seconds_from_ns(elapsed));
        }
        writer.write_record(&record).map_err(|e| format!("{MYPHONE} output row: {e}"))?;
    }
    let bytes = writer.into_inner().map_err(|e| format!("{MYPHONE} finish output: {e}"))?;
    complete_standalone_component_adaptation(MYPHONE, "literature-myphoneme-supplied-response-times-csv",
        digest, bindings, records.len(), records.len(), bytes)
}
