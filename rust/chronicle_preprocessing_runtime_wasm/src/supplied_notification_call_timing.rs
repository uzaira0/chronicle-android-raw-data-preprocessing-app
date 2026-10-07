//! Supplied-anchor arithmetic and explicit pending-set proxies only.
//! Boehmer CHI2014 pp5,8; MessageMonitor CHI2014 pp5–7;
//! InSitu MobileHCI2014 pp4–6/Fig4; Snooze MobileHCI2018 p6/Fig5;
//! Sensors2024 24:2612 pp7,21. No raw matcher, queue, reading classifier,
//! first-attendance selection, calendar/category constructor or cohort replay.

use super::{
    format_duration_seconds_from_ns, phonestudy_median, supplied_anchor_elapsed_nanoseconds,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const CALL: &str = "chronicle.boehmer-supplied-call-times";
pub(super) const MESSAGE: &str = "chronicle.message-monitor-supplied-attendance";
pub(super) const INSITU: &str = "chronicle.insitu-supplied-proxy-view";
pub(super) const MEDIAN: &str = "chronicle.insitu-qualified-latency-median";
pub(super) const SNOOZE: &str = "chronicle.snooze-supplied-final-deferral";
pub(super) const IDL: &str = "chronicle.sensors-supplied-integer-idl";
pub(super) const ADAPTERS: [&str; 6] = [CALL, MESSAGE, INSITU, MEDIAN, SNOOZE, IDL];
pub(super) const PAIR_FIELDS: [&str; 11] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "source_sequence_id",
    "source_item_id",
    "app_id",
    "start_anchor_json",
    "end_anchor_json",
    "measure",
    "endpoint_resolution_stage",
];
pub(super) const PENDING_FIELDS: [&str; 11] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "source_sequence_id",
    "action_anchor_json",
    "opened_app_id",
    "pending_population_role",
    "pending_membership_stage",
    "pending_items_json",
    "attendance_resolution_stage",
];
pub(super) const MEDIAN_FIELDS: [&str; 7] = [
    "source_row_id",
    "stratum_id",
    "notification_category",
    "weekday_group",
    "latency_membership_stage",
    "latency_members_json",
    "aggregation_boundary",
];
const PAIR_OUT: [&str; 5] = [
    "elapsed_coordinate",
    "elapsed_unit",
    "elapsed_seconds",
    "timing_status",
    "claim_scope",
];
const PENDING_OUT: [&str; 3] = [
    "attributed_items_json",
    "attributed_item_count",
    "claim_scope",
];
const MEDIAN_OUT: [&str; 4] = [
    "qualified_latency_count",
    "median_latency_seconds",
    "median_latency_minutes",
    "claim_scope",
];
const COMPUTED: &str = "computed_supplied_anchor_arithmetic";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Anchor {
    participant_id: String,
    device_id: String,
    source_stream_id: String,
    source_sequence_id: String,
    event_id: String,
    role: String,
    clock_id: Option<String>,
    time_unit: Option<String>,
    precision: Option<u64>,
    timestamp: Option<i64>,
}
impl Anchor {
    fn owner(&self) -> [&str; 4] {
        [
            &self.participant_id,
            &self.device_id,
            &self.source_stream_id,
            &self.source_sequence_id,
        ]
    }
    fn validate(&self) -> Result<(), String> {
        if self.owner().iter().any(|id| id.is_empty())
            || self.event_id.is_empty()
            || self.role.is_empty()
        {
            return Err("anchors require nonempty literal ownership/event/role".into());
        }
        if self.clock_id.as_deref() == Some("") || self.time_unit.as_deref() == Some("") {
            return Err("missing clock/unit uses JSON null, not an empty identity".into());
        }
        if let Some(unit) = self.time_unit.as_deref() {
            scale(unit)?;
        }
        if self.precision == Some(0) {
            return Err("precision must be positive metadata or null".into());
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingItem {
    source_item_id: String,
    app_id: String,
    pending: bool,
    shown_in_drawer: Option<bool>,
    arrival: Anchor,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LatencyMember {
    source_item_id: String,
    app_id: String,
    notification_category: String,
    weekday_group: String,
    arrival: Anchor,
    proxy_view: Anchor,
    endpoint_resolution_stage: String,
    opened_app_id: Option<String>,
    shown_in_drawer: Option<bool>,
}
fn scale(unit: &str) -> Result<i128, String> {
    match unit {
        "ns" => Ok(1),
        "us" => Ok(1_000),
        "ms" => Ok(1_000_000),
        "s" => Ok(1_000_000_000),
        _ => Err("coordinate unit requires explicit ns/us/ms/s".into()),
    }
}
fn owned(anchor: &Anchor, owner: [&str; 4]) -> Result<(), String> {
    anchor.validate()?;
    if anchor.owner() != owner {
        return Err("cross-owned supplied anchor".into());
    }
    Ok(())
}
fn difference(start: &Anchor, end: &Anchor) -> Result<(Option<i128>, Vec<String>), String> {
    if start.owner() != end.owner() {
        return Err("cross-owned supplied anchor pair".into());
    }
    let missing = if start.clock_id.is_none() || end.clock_id.is_none() {
        Some("missing_clock_id")
    } else if start.clock_id != end.clock_id {
        Some("incompatible_clock_ids")
    } else if start.time_unit.is_none() || end.time_unit.is_none() {
        Some("missing_coordinate_unit")
    } else if start.time_unit != end.time_unit {
        Some("incompatible_coordinate_units")
    } else if start.precision.is_none() || end.precision.is_none() {
        Some("missing_precision_metadata")
    } else if start.timestamp.is_none() || end.timestamp.is_none() {
        Some("missing_timestamp")
    } else {
        None
    };
    if let Some(reason) = missing {
        return Ok((
            None,
            vec![
                String::new(),
                String::new(),
                String::new(),
                format!("unavailable:{reason}"),
            ],
        ));
    }
    // Unit-independent widening subtraction. Full i64 difference times1e9 fits i128.
    // Positive precision is retained metadata, never an epoch/modulo/rounding gate.
    let delta =
        supplied_anchor_elapsed_nanoseconds(start.timestamp.unwrap(), end.timestamp.unwrap());
    let unit = start.time_unit.as_deref().unwrap();
    let ns = delta * scale(unit)?;
    Ok((
        Some(ns),
        vec![
            delta.to_string(),
            unit.into(),
            format_duration_seconds_from_ns(ns),
            COMPUTED.into(),
        ],
    ))
}

// A consistency ledger checks supplied known facts only. It never constructs,
// consumes or advances pending state, pairs events, infers a first view or sorts.
type EventKey = (String, String, String, String, String);
#[derive(Default)]
struct Facts {
    events: BTreeMap<EventKey, Anchor>,
    items: BTreeMap<EventKey, (String, String)>,
    terminal_pairs: BTreeMap<EventKey, (String, String, String)>,
    arrival_items: BTreeMap<EventKey, (String, String)>,
    action_apps: BTreeMap<EventKey, String>,
    item_strata: BTreeMap<EventKey, (String, String)>,
    ordered_pairs: BTreeSet<(EventKey, EventKey)>,
    complete_pending_sets: BTreeMap<(EventKey, String, String), BTreeSet<String>>,
}
fn conflict<T: Eq>(a: &Option<T>, b: &Option<T>) -> bool {
    matches!((a, b), (Some(a), Some(b)) if a != b)
}
impl Facts {
    fn key(owner: [&str; 4], id: &str) -> (String, String, String, String, String) {
        (
            owner[0].into(),
            owner[1].into(),
            owner[2].into(),
            owner[3].into(),
            id.into(),
        )
    }
    fn event(&mut self, anchor: &Anchor) -> Result<(), String> {
        let key = Self::key(anchor.owner(), &anchor.event_id);
        if let Some(prior) = self.events.get_mut(&key) {
            if prior.role != anchor.role
                || conflict(&prior.clock_id, &anchor.clock_id)
                || conflict(&prior.time_unit, &anchor.time_unit)
                || conflict(&prior.precision, &anchor.precision)
                || conflict(&prior.timestamp, &anchor.timestamp)
            {
                return Err("contradictory known supplied event facts".into());
            }
            if prior.clock_id.is_none() {
                prior.clock_id = anchor.clock_id.clone();
            }
            if prior.time_unit.is_none() {
                prior.time_unit = anchor.time_unit.clone();
            }
            if prior.precision.is_none() {
                prior.precision = anchor.precision;
            }
            if prior.timestamp.is_none() {
                prior.timestamp = anchor.timestamp;
            }
        } else {
            self.events.insert(key, anchor.clone());
        }
        Ok(())
    }
    fn item(&mut self, item: &str, app: &str, arrival: &Anchor) -> Result<(), String> {
        if item.is_empty() || app.is_empty() {
            return Err("items require nonempty literal item/app identities".into());
        }
        self.event(arrival)?;
        let key = Self::key(arrival.owner(), item);
        let facts = (app.to_owned(), arrival.event_id.clone());
        if self.items.get(&key).is_some_and(|prior| prior != &facts) {
            return Err("contradictory known supplied item/app/initial-anchor facts".into());
        }
        self.items.insert(key, facts);
        self.exclusive_event(item, app, arrival)?;
        Ok(())
    }
    fn exclusive_event(&mut self, item: &str, app: &str, arrival: &Anchor) -> Result<(), String> {
        let key = Self::key(arrival.owner(), &arrival.event_id);
        let facts = (item.to_owned(), app.to_owned());
        if self
            .arrival_items
            .get(&key)
            .is_some_and(|prior| prior != &facts)
        {
            return Err(
                "contradictory known supplied initial/arrival event item attribution".into(),
            );
        }
        self.arrival_items.insert(key, facts);
        Ok(())
    }
    fn stratum(&mut self, member: &LatencyMember) -> Result<(), String> {
        let key = Self::key(member.arrival.owner(), &member.source_item_id);
        let facts = (
            member.notification_category.clone(),
            member.weekday_group.clone(),
        );
        if self
            .item_strata
            .get(&key)
            .is_some_and(|prior| prior != &facts)
        {
            return Err("contradictory known supplied item category/day facts".into());
        }
        self.item_strata.insert(key, facts);
        Ok(())
    }
    fn action_app(&mut self, action: &Anchor, app: &str) -> Result<(), String> {
        if action.role == "application_open" {
            if app.is_empty() {
                return Err("app opening requires nonempty literal opened-app identity".into());
            }
            let key = Self::key(action.owner(), &action.event_id);
            if self.action_apps.get(&key).is_some_and(|prior| prior != app) {
                return Err("contradictory known opened-app action facts".into());
            }
            self.action_apps.insert(key, app.into());
        }
        Ok(())
    }
    fn terminal(
        &mut self,
        item: &str,
        measure: &str,
        start: &Anchor,
        end: &Anchor,
    ) -> Result<(), String> {
        let key = Self::key(start.owner(), item);
        let facts = (
            measure.to_owned(),
            start.event_id.clone(),
            end.event_id.clone(),
        );
        if self
            .terminal_pairs
            .get(&key)
            .is_some_and(|prior| prior != &facts)
        {
            return Err("contradictory known supplied final/outcome pair".into());
        }
        self.terminal_pairs.insert(key, facts);
        Ok(())
    }
    fn require_order(&mut self, start: &Anchor, end: &Anchor) {
        // Only an explicitly supplied source-qualified pair is recorded here.
        self.ordered_pairs.insert((
            Self::key(start.owner(), &start.event_id),
            Self::key(end.owner(), &end.event_id),
        ));
    }
    fn validate_known_order(&self) -> Result<(), String> {
        for (start, end) in &self.ordered_pairs {
            let (ns, _) = difference(&self.events[start], &self.events[end])?;
            if ns.is_some_and(|ns| ns < 0) {
                return Err(
                    "collectively known endpoint order contradicts qualified source span".into(),
                );
            }
        }
        // Merged facts validate declarations only; unavailable row values stay unavailable.
        Ok(())
    }
    fn complete_pending_set(
        &mut self,
        action: &Anchor,
        population: &str,
        app: &str,
        members: BTreeSet<String>,
    ) -> Result<(), String> {
        let key = (
            Self::key(action.owner(), &action.event_id),
            population.to_owned(),
            app.to_owned(),
        );
        if self
            .complete_pending_sets
            .get(&key)
            .is_some_and(|prior| prior != &members)
        {
            return Err("contradictory complete supplied pending membership".into());
        }
        // Set equality does not change the original member/row order or consume items.
        self.complete_pending_sets.insert(key, members);
        Ok(())
    }
}
fn decode<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|error| format!("typed supplied JSON: {error}"))
}
fn pair(
    record: &csv::StringRecord,
    columns: &[usize],
    adapter: &str,
    facts: &mut Facts,
) -> Result<Option<Vec<String>>, String> {
    let v = |i: usize| &record[columns[i]];
    let start: Anchor = decode(v(7))?;
    let end: Anchor = decode(v(8))?;
    let owner = [v(1), v(2), v(3), v(4)];
    owned(&start, owner)?;
    owned(&end, owner)?;
    let roles = match (adapter, v(9)) {
        (CALL, "lab_TN") => (
            "first_incoming_call_notification",
            "conversation_start",
            "caller-resolved-lab-TN-with-postpone-included",
        ),
        (CALL, "field_accepted") => (
            "first_incoming_call_notification",
            "call_accepted",
            "caller-resolved-interruptive-call-outcome",
        ),
        (CALL, "field_declined") => (
            "first_incoming_call_notification",
            "call_declined",
            "caller-resolved-interruptive-call-outcome",
        ),
        (CALL, "field_unanswered") => (
            "first_incoming_call_notification",
            "phone_stopped_ringing",
            "caller-resolved-interruptive-call-outcome",
        ),
        (SNOOZE, "post_to_final_retrigger") => (
            "initial_notification_posting",
            "final_notification_retrigger",
            "caller-resolved-initial-post-final-retrigger",
        ),
        (IDL, "integer_seconds_IDL") => (
            "notification_appearance",
            "notification_bar_removal",
            "caller-resolved-appearance-removal-integer-seconds",
        ),
        _ => return Err("wrong source measure".into()),
    };
    if (start.role.as_str(), end.role.as_str(), v(10)) != roles {
        return Err("wrong source endpoint roles/resolution stage".into());
    }
    facts.item(v(5), v(6), &start)?;
    facts.event(&end)?;
    facts.exclusive_event(v(5), v(6), &end)?;
    facts.terminal(v(5), v(9), &start, &end)?;
    if adapter != IDL {
        facts.require_order(&start, &end);
    }
    if adapter == IDL
        && (start.time_unit.as_deref() != Some("s") || end.time_unit.as_deref() != Some("s"))
    {
        return Err("Sensors IDL requires supplied integer-second endpoints; fractional rounding is unknown".into());
    }
    let (ns, mut result) = difference(&start, &end)?;
    if adapter == IDL {
        // No missingness/censoring rule is invented by the explicit positive filter.
        if ns.is_none() {
            return Err(
                "integer-second IDL filter requires complete comparable supplied anchors".into(),
            );
        }
        if ns.unwrap() <= 0 {
            return Ok(None);
        }
    } else if ns.is_some_and(|ns| ns < 0) {
        return Err("known endpoint order contradicts qualified source span".into());
    }
    result.push(
        if adapter == CALL {
            "supplied_call_span_not_TOT1_TNV_new_call_or_trial_aggregation"
        } else if adapter == SNOOZE {
            "supplied_initial_to_final_only_not_snooze_action_or_retrigger_matching"
        } else {
            "supplied_integer_seconds_positive_IDL_not_removal_reason_or_attention"
        }
        .into(),
    );
    Ok(Some(result))
}
fn pending(
    record: &csv::StringRecord,
    columns: &[usize],
    adapter: &str,
    facts: &mut Facts,
) -> Result<Vec<String>, String> {
    let v = |i: usize| &record[columns[i]];
    let action: Anchor = decode(v(5))?;
    owned(&action, [v(1), v(2), v(3), v(4)])?;
    let drawer = action.role == "notification_drawer_open";
    if !drawer && action.role != "application_open" {
        return Err("wrong supplied attendance action role".into());
    }
    if v(8) != "caller-qualified-complete-preaction-pending-set"
        || v(10) != "caller-resolved-first-attendance-proxy"
    {
        return Err(
            "pending set and first-attendance proxy require explicit caller qualification".into(),
        );
    }
    let population = if adapter == MESSAGE {
        "unread_messages"
    } else if drawer {
        "pending_notifications_shown_in_drawer"
    } else {
        "pending_notifications"
    };
    if v(7) != population || (drawer && !v(6).is_empty()) || (!drawer && v(6).is_empty()) {
        return Err("wrong source pending population or opened-app identity".into());
    }
    facts.event(&action)?;
    facts.action_app(&action, v(6))?;
    let members: Vec<PendingItem> = decode(v(9))?;
    let mut seen = BTreeSet::new();
    let mut attributed = Vec::new();
    for item in members {
        if !seen.insert(item.source_item_id.clone()) {
            return Err("prepared pending set requires unique literal item IDs; no raw deduplication is performed".into());
        }
        owned(&item.arrival, action.owner())?;
        if item.arrival.role != "notification_arrival" || !item.pending {
            return Err("known item facts contradict supplied pending arrival".into());
        }
        if adapter == INSITU && drawer && item.shown_in_drawer != Some(true) {
            return Err("InSitu drawer positive membership requires shown_in_drawer=true".into());
        }
        facts.item(&item.source_item_id, &item.app_id, &item.arrival)?;
        // Every caller-qualified preaction member explicitly supplies this pair,
        // including a nonmatching app member; no missing membership is inferred.
        facts.require_order(&item.arrival, &action);
        let (ns, delta) = difference(&item.arrival, &action)?;
        if ns.is_some_and(|ns| ns < 0) {
            return Err("known arrival follows supplied attendance action".into());
        }
        // App identity is exact lexical equality, not package normalization or click matching.
        if drawer || item.app_id == v(6) {
            facts.terminal(
                &item.source_item_id,
                "caller-resolved-first-attendance",
                &item.arrival,
                &action,
            )?;
            attributed.push(serde_json::json!({
                "source_item_id": item.source_item_id, "app_id": item.app_id,
                "arrival_event_id": item.arrival.event_id, "action_event_id": action.event_id,
                "proxy": if adapter == MESSAGE { "considered_attended" } else { "considered_viewed" },
                "elapsed_coordinate":delta[0], "elapsed_unit":delta[1], "elapsed_seconds":delta[2],
                "timing_status":delta[3], "observed_reading_or_notification_click":false
            }));
        }
    }
    facts.complete_pending_set(&action, population, v(6), seen)?;
    let count = crate::grouped_distinct_count::count_distinct_members_by_group(
        attributed
            .iter()
            .map(|item| ((), item["source_item_id"].as_str().unwrap())),
    )
    .first()
    .map(|group| group.distinct_member_count)
    .unwrap_or(0);
    // An explicitly supplied complete empty set is known zero, not an absent group.
    Ok(vec![serde_json::to_string(&attributed).map_err(|e| e.to_string())?, count.to_string(),
        "supplied_complete_membership_proxy_not_queue_first_view_constructor_reading_or_other_pending_domain".into()])
}
fn median(
    record: &csv::StringRecord,
    columns: &[usize],
    facts: &mut Facts,
) -> Result<Vec<String>, String> {
    let v = |i: usize| &record[columns[i]];
    if !matches!(v(3), "weekday" | "weekend")
        || v(4) != "caller-qualified-complete-nonempty-latency-stratum"
        || v(6) != "caller-supplied-category-weekday-stratum-not-recovered-source-aggregation-unit"
    {
        return Err(
            "qualified median requires explicit nonempty category/weekday stratum boundary".into(),
        );
    }
    let members: Vec<LatencyMember> = decode(v(5))?;
    if members.is_empty() {
        return Err("empty source stratum policy is unknown".into());
    }
    let mut seconds = Vec::new();
    for member in &members {
        member.arrival.validate()?;
        member.proxy_view.validate()?;
        if member.notification_category != v(2)
            || member.weekday_group != v(3)
            || member.arrival.role != "notification_arrival"
            || !matches!(
                member.proxy_view.role.as_str(),
                "notification_drawer_open" | "application_open"
            )
            || member.endpoint_resolution_stage != "caller-resolved-first-attendance-proxy"
        {
            return Err("member contradicts qualified category/day/proxy roles".into());
        }
        facts.item(&member.source_item_id, &member.app_id, &member.arrival)?;
        facts.stratum(member)?;
        facts.event(&member.proxy_view)?;
        if member.proxy_view.role == "application_open" {
            let app = member
                .opened_app_id
                .as_deref()
                .ok_or("qualified app proxy requires opened_app_id")?;
            if app != member.app_id {
                return Err("known opened app contradicts qualified item app".into());
            }
            facts.action_app(&member.proxy_view, app)?;
        } else if member.shown_in_drawer != Some(true) || member.opened_app_id.is_some() {
            return Err(
                "qualified InSitu drawer proxy requires shown membership and no app-open claim"
                    .into(),
            );
        }
        facts.terminal(
            &member.source_item_id,
            "caller-resolved-first-attendance",
            &member.arrival,
            &member.proxy_view,
        )?;
        let (ns, _) = difference(&member.arrival, &member.proxy_view)?;
        let ns = ns.ok_or("qualified median requires all comparable supplied endpoint members")?;
        if ns < 0 {
            return Err("negative supplied proxy latency contradicts qualified member".into());
        }
        seconds.push(ns as f64 / 1_000_000_000.0);
    }
    // Existing median arithmetic with caller membership occurrences as weights;
    // f64 projection is explicit, not a recovered publication runtime.
    let value = phonestudy_median(seconds);
    Ok(vec![members.len().to_string(), value.to_string(), (value / 60.0).to_string(),
        "supplied_nonempty_stratum_median_not_category_calendar_population_constructor_or_empty_policy".into()])
}

pub(super) fn execute_csv(
    raw: &[u8],
    adapter: &str,
) -> Result<(Vec<u8>, usize, usize, &'static str), String> {
    let (fields, outputs, kind): (&[&str], &[&str], _) = match adapter {
        CALL => (
            &PAIR_FIELDS,
            &PAIR_OUT,
            "literature-boehmer-supplied-call-times-csv",
        ),
        SNOOZE => (
            &PAIR_FIELDS,
            &PAIR_OUT,
            "literature-snooze-supplied-final-deferral-csv",
        ),
        IDL => (
            &PAIR_FIELDS,
            &PAIR_OUT,
            "literature-sensors-supplied-integer-idl-csv",
        ),
        MESSAGE => (
            &PENDING_FIELDS,
            &PENDING_OUT,
            "literature-message-monitor-supplied-attendance-csv",
        ),
        INSITU => (
            &PENDING_FIELDS,
            &PENDING_OUT,
            "literature-insitu-supplied-proxy-view-csv",
        ),
        MEDIAN => (
            &MEDIAN_FIELDS,
            &MEDIAN_OUT,
            "literature-insitu-qualified-latency-median-csv",
        ),
        _ => return Err("unregistered supplied notification/call timing adapter".into()),
    };
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let mut header = reader.headers().map_err(|e| e.to_string())?.clone();
    if header.iter().collect::<BTreeSet<_>>().len() != header.len() {
        return Err("requires unique input column names".into());
    }
    if outputs.iter().any(|name| header.iter().any(|h| h == *name)) {
        return Err("refuses supplied computed output columns".into());
    }
    let columns = fields
        .iter()
        .map(|name| {
            header
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("requires column {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let rows = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    header.extend(outputs.iter().copied());
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&header).map_err(|e| e.to_string())?;
    let mut facts = Facts::default();
    let mut emitted = 0;
    for row in &rows {
        let mandatory: &[usize] = if adapter == MEDIAN {
            &[0, 1, 2, 3, 4, 6]
        } else {
            &[0, 1, 2, 3, 4]
        };
        if mandatory.iter().any(|i| row[columns[*i]].is_empty()) {
            return Err("requires nonempty literal row/owner/stratum identities".into());
        }
        let result = if adapter == MEDIAN {
            Some(median(row, &columns, &mut facts)?)
        } else if matches!(adapter, MESSAGE | INSITU) {
            Some(pending(row, &columns, adapter, &mut facts)?)
        } else {
            pair(row, &columns, adapter, &mut facts)?
        };
        if let Some(result) = result {
            let mut out = row.clone();
            out.extend(result.iter().map(String::as_str));
            writer.write_record(&out).map_err(|e| e.to_string())?;
            emitted += 1;
        }
    }
    facts.validate_known_order()?;
    Ok((
        writer.into_inner().map_err(|e| e.to_string())?,
        rows.len(),
        emitted,
        kind,
    ))
}

#[cfg(test)]
#[path = "supplied_notification_call_conformance.rs"]
mod tests;
