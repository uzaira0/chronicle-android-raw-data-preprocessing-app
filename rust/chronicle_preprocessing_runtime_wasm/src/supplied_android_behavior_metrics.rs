//! Supplied Android behavior arithmetic, not raw session/event construction.
//! HUSH rank169:460–470,631–643,750–762; Jones p5–6; CognitiveRhythms p7;
//! Rodrigues §4.3/Table1. Exact source/profile tuples live in the existing contract.
use crate::count_ratio::{construct_named_count_ratios, CountRatioRequest};
use crate::finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use serde::Deserialize;
use serde_json::{json, value::RawValue, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Stage {
    HushBfc,
    HushStaleness,
    JonesBacktracking,
    JonesReturn,
    CognitivePhoneHour,
    RodriguesTypingMean,
    PrefTerm,
    PrefReminder,
    DinglerAttendance,
    MultiActive,
    MathurGap,
    MathurRatio,
    DismissedDaily,
    DismissedConversion,
    SarsenCount,
    SarsenDuration,
    FinessePresence,
    TouchStroke,
    HushBeta,
    HushAlpha,
}
impl Stage {
    pub(super) fn adapter_id(self) -> &'static str {
        match self {
            Self::HushBfc => "chronicle.hush-supplied-bfc",
            Self::HushStaleness => "chronicle.hush-supplied-staleness",
            Self::JonesBacktracking => "chronicle.jones-supplied-session-backtracking",
            Self::JonesReturn => "chronicle.jones-supplied-app-return",
            Self::CognitivePhoneHour => "chronicle.cognitive-supplied-phone-hour",
            Self::RodriguesTypingMean => "chronicle.rodrigues-supplied-typing-mean",
            Self::PrefTerm => "chronicle.prefminer-supplied-term-frequency",
            Self::PrefReminder => "chronicle.prefminer-supplied-app-click-rate",
            Self::DinglerAttendance => "chronicle.dingler-supplied-attendance-delay",
            Self::MultiActive => "chronicle.multidevice-supplied-android-active-time",
            Self::MathurGap => "chronicle.mathur-supplied-signed-app-gap",
            Self::MathurRatio => "chronicle.mathur-supplied-active-time-ratio",
            Self::DismissedDaily => "chronicle.dismissed-supplied-daily-category-median",
            Self::DismissedConversion => "chronicle.dismissed-supplied-category-conversion",
            Self::SarsenCount => "chronicle.sarsen-supplied-hour-launch-count",
            Self::SarsenDuration => "chronicle.sarsen-supplied-hour-duration-total",
            Self::FinessePresence => "chronicle.finesse-supplied-session-feature-fraction",
            Self::TouchStroke => "chronicle.touchposter-supplied-stroke-time",
            Self::HushBeta => "chronicle.hush-supplied-beta-sensitivity",
            Self::HushAlpha => "chronicle.hush-supplied-alpha-sensitivity",
        }
    }
    pub(super) fn result_kind(self) -> &'static str {
        match self {
            Self::HushBfc => "literature-hush-supplied-bfc-csv",
            Self::HushStaleness => "literature-hush-supplied-staleness-csv",
            Self::JonesBacktracking => "literature-jones-supplied-session-backtracking-csv",
            Self::JonesReturn => "literature-jones-supplied-app-return-csv",
            Self::CognitivePhoneHour => "literature-cognitive-supplied-phone-hour-csv",
            Self::RodriguesTypingMean => "literature-rodrigues-supplied-typing-mean-csv",
            Self::PrefTerm => "literature-prefminer-supplied-term-frequency-csv",
            Self::PrefReminder => "literature-prefminer-supplied-app-click-rate-csv",
            Self::DinglerAttendance => "literature-dingler-supplied-attendance-delay-csv",
            Self::MultiActive => "literature-multidevice-supplied-android-active-time-csv",
            Self::MathurGap => "literature-mathur-supplied-signed-app-gap-csv",
            Self::MathurRatio => "literature-mathur-supplied-active-time-ratio-csv",
            Self::DismissedDaily => "literature-dismissed-supplied-daily-category-median-csv",
            Self::DismissedConversion => "literature-dismissed-supplied-category-conversion-csv",
            Self::SarsenCount => "literature-sarsen-supplied-hour-launch-count-csv",
            Self::SarsenDuration => "literature-sarsen-supplied-hour-duration-total-csv",
            Self::FinessePresence => "literature-finesse-supplied-session-feature-fraction-csv",
            Self::TouchStroke => "literature-touchposter-supplied-stroke-time-csv",
            Self::HushBeta => "literature-hush-supplied-beta-sensitivity-csv",
            Self::HushAlpha => "literature-hush-supplied-alpha-sensitivity-csv",
        }
    }
    pub(super) fn selected(active: &BTreeSet<&str>) -> Option<Self> {
        [
            Self::HushBfc,
            Self::HushStaleness,
            Self::JonesBacktracking,
            Self::JonesReturn,
            Self::CognitivePhoneHour,
            Self::RodriguesTypingMean,
            Self::PrefTerm,
            Self::PrefReminder,
            Self::DinglerAttendance,
            Self::MultiActive,
            Self::MathurGap,
            Self::MathurRatio,
            Self::DismissedDaily,
            Self::DismissedConversion,
            Self::SarsenCount,
            Self::SarsenDuration,
            Self::FinessePresence,
            Self::TouchStroke,
            Self::HushBeta,
            Self::HushAlpha,
        ]
        .into_iter()
        .find(|stage| active.contains(stage.adapter_id()))
    }
    pub(super) fn fields(self) -> &'static [&'static str] {
        match self {
            Self::HushBfc => &[
                "app_id",
                "beta",
                "alpha",
                "sequence_origin",
                "observations_json",
            ],
            Self::HushStaleness => &[
                "app_id",
                "coordinate_unit",
                "timestamp_precision",
                "foreground_activities_json",
            ],
            Self::JonesBacktracking => &["launches_json"],
            Self::JonesReturn => &[
                "app_id",
                "coordinate_unit",
                "timestamp_precision",
                "previous_launch_json",
                "current_launch_json",
            ],
            Self::CognitivePhoneHour => &[
                "hour_duration_seconds",
                "duration_unit",
                "sessions_json",
                "duration_contributions_json",
            ],
            Self::RodriguesTypingMean => &[
                "coordinate_unit",
                "timestamp_precision",
                "typing_pairs_json",
            ],
            Self::PrefTerm => &[
                "app_id",
                "term_id",
                "participation_days",
                "selected_N",
                "notifications_json",
            ],
            Self::PrefReminder => &["app_id", "notifications_json"],
            Self::DinglerAttendance => &[
                "coordinate_unit",
                "timestamp_precision",
                "notification_id",
                "start_anchor_json",
                "end_anchor_json",
            ],
            Self::MultiActive => &[
                "device_type",
                "day_id",
                "coordinate_unit",
                "timestamp_precision",
                "intervals_json",
            ],
            Self::MathurGap => &[
                "coordinate_unit",
                "timestamp_precision",
                "context_id",
                "start_anchor_json",
                "end_anchor_json",
            ],
            Self::MathurRatio => &[
                "last_hour_id",
                "active_time_unit",
                "last_hour_app_count",
                "last_hour_active_time",
            ],
            Self::DismissedDaily => &["category_id", "users_json"],
            Self::DismissedConversion => &["category_id", "notifications_json"],
            Self::SarsenCount => &["hour_id", "launches_json"],
            Self::SarsenDuration => &["hour_id", "duration_unit", "contributions_json"],
            Self::FinessePresence => &["app_id", "feature_id", "sessions_json"],
            Self::TouchStroke => &[
                "coordinate_unit",
                "timestamp_precision",
                "stroke_id",
                "start_anchor_json",
                "end_anchor_json",
            ],
            Self::HushBeta => &["app_id", "sequence_origin", "observations_json"],
            Self::HushAlpha => &["app_id", "beta", "sequence_origin", "observations_json"],
        }
    }
    fn qualification(self) -> &'static str {
        match self {
            Self::HushBfc => {
                "caller-qualified-complete-ordered-app-active-background-following-screen-on"
            }
            Self::HushStaleness => {
                "caller-qualified-complete-device-app-foregrounds-with-latest-prior-activities"
            }
            Self::JonesBacktracking => {
                "caller-qualified-complete-ordered-unlock-lock-session-launches"
            }
            Self::JonesReturn => "caller-qualified-consecutive-same-app-launch-pair",
            Self::CognitivePhoneHour => {
                "caller-qualified-whole-phone-hour-session-and-duration-inventories"
            }
            Self::RodriguesTypingMean => {
                "caller-qualified-complete-trial-session-hold-flight-pairs"
            }
            Self::PrefTerm => "caller-qualified-complete-paper-notification-term-presence",
            Self::PrefReminder => "caller-qualified-complete-paper-app-accepted-notifications",
            Self::DinglerAttendance => {
                "caller-qualified-notification-arrival-first-inferred-attendance"
            }
            Self::MultiActive => "caller-qualified-complete-disjoint-closed-screen-on-device-day",
            Self::MathurGap => "caller-qualified-previous-app-close-current-app-open",
            Self::MathurRatio => "caller-qualified-lasthour-count-and-active-time",
            Self::DismissedDaily => "caller-qualified-complete-category-user-day-count-inventories",
            Self::DismissedConversion => {
                "caller-qualified-complete-source-eligible-category-consumed-notifications"
            }
            Self::SarsenCount => "caller-qualified-complete-phone-participant-hour-launches",
            Self::SarsenDuration => "caller-qualified-complete-phone-participant-hour-durations",
            Self::FinessePresence => {
                "caller-qualified-complete-nonempty-app-session-feature-presence"
            }
            Self::TouchStroke => "caller-qualified-closed-touch-scanning-stroke",
            Self::HushBeta => {
                "caller-qualified-complete-ordered-app-active-background-following-screen-on"
            }
            Self::HushAlpha => {
                "caller-qualified-complete-ordered-app-active-background-following-screen-on"
            }
        }
    }
}
pub(super) const COMMON_FIELDS: &[&str] = &[
    "source_row_id",
    "participant_id",
    "source_device_id",
    "source_stream_id",
    "source_platform",
    "scope_id",
    "input_stage",
];
const OUTPUTS: &[&str] = &["supplied_calculation_json", "supplied_calculation_status"];
fn nonempty(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        Err("identity must be supplied".into())
    } else {
        Ok(())
    }
}
fn ratio(n: usize, d: usize) -> Result<Option<f64>, String> {
    if d == 0 {
        return Ok(None);
    }
    let n = u64::try_from(n).map_err(|e| e.to_string())?;
    let d = u64::try_from(d).map_err(|e| e.to_string())?;
    Ok(Some(
        construct_named_count_ratios([CountRatioRequest {
            name: (),
            numerator: n,
            denominator_terms: vec![d],
        }])
        .map_err(|e| e.to_string())?[0]
            .ratio
            .value(),
    ))
}
// Use the existing ordered sum/projection with an explicit divisor. Missing
// dominates; no dropping, zero imputation or SD behavior is imported.
fn reduce(values: &[Option<f64>], mean: bool) -> Result<Option<f64>, String> {
    if values.is_empty() {
        return Ok(if mean { None } else { Some(0.0) });
    }
    let rows = values
        .iter()
        .map(|value| GroupedScalarInput {
            entity: (),
            raw_partition: (),
            passthrough: (),
            value: value.map_or(RCompatibleScalar::Missing, RCompatibleScalar::Finite),
        })
        .collect::<Vec<_>>();
    let result = grouped_scalar_sum_then_project_unique(
        &rows,
        SequentialDivisionConfiguration {
            first_divisor: if mean { values.len() as f64 } else { 1.0 },
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|e| e.to_string())?;
    match result[0].first_scaled_value {
        RCompatibleScalar::Missing => Ok(None),
        RCompatibleScalar::Finite(x) if x.is_finite() => Ok(Some(x)),
        _ => Err("supplied reduction exceeds finite binary64 domain".into()),
    }
}
fn duration(raw: &RawValue) -> Result<Option<f64>, String> {
    match raw.get() {
        "null" => Ok(None),
        text if text.starts_with('"') => super::supplied_learning_session_net_duration::duration(
            &serde_json::from_str::<String>(text).map_err(|e| e.to_string())?,
        ),
        text if text.starts_with('-') || text.starts_with(|c: char| c.is_ascii_digit()) => {
            super::supplied_learning_session_net_duration::duration(text)
        }
        _ => Err("duration requires numeric seconds, numeric text or null".into()),
    }
}
fn inventory<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<Option<Vec<T>>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(raw)
        .map(Some)
        .map_err(|e| format!("invalid supplied inventory: {e}"))
}
fn parsed<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<Option<T>, String> {
    if raw.is_empty() || raw == "null" {
        return Ok(None);
    }
    serde_json::from_str(raw)
        .map(Some)
        .map_err(|e| format!("invalid supplied anchor: {e}"))
}
// Only local supplied-fact consistency. None is absence of a fact, never a
// replacement input for this row. Keys are device plus actual event/item scope.
fn known(
    facts: &mut BTreeMap<Vec<String>, String>,
    key: Vec<String>,
    value: Option<String>,
) -> Result<(), String> {
    if let Some(value) = value {
        if facts.get(&key).is_some_and(|prior| prior != &value) {
            return Err("supplied identity has contradictory known facts".into());
        }
        facts.insert(key, value);
    }
    Ok(())
}
#[derive(Deserialize)]
struct BfcObservation {
    background_interval_id: String,
    following_screen_on_interval_id: String,
    source_order: usize,
    x_foreground: Option<bool>,
    was_suppressed: Option<bool>,
}
fn hush_bfc(
    get: &impl Fn(&str) -> String,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    // Required selections, not global defaults or silently selected values.
    if get("beta") != "0.5"
        || get("alpha") != "0.1"
        || get("sequence_origin") != "caller-qualified-source-sequence-from-initial-0.5"
    {
        return Err("HUSH requires explicit paper-selected beta0.5/alpha0.1 and source-sequence origin initial0.5".into());
    }
    hush_bfc_at(get, scope, facts, 0.5, 0.1)
}
fn hush_bfc_at(
    get: &impl Fn(&str) -> String,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
    beta: f64,
    alpha: f64,
) -> Result<Value, String> {
    let Some(entries) = inventory::<BfcObservation>(&get("observations_json"))? else {
        return Ok(
            json!({"static_bfc":null,"updates":null,"status":"unavailable:missing_inventory"}),
        );
    };
    let mut ids = BTreeSet::new();
    let mut next_ids = BTreeSet::new();
    let mut full_order = Vec::new();
    let mut state = Some(0.5);
    let mut updates = Vec::new();
    let mut foreground = 0;
    let mut complete = true;
    let suppress =
        FiniteScalarPivotClassifier::new(alpha, true, true, false).map_err(|e| e.to_string())?;
    for (order, entry) in entries.iter().enumerate() {
        nonempty(&entry.background_interval_id)?;
        nonempty(&entry.following_screen_on_interval_id)?;
        if entry.source_order != order
            || !ids.insert(&entry.background_interval_id)
            || !next_ids.insert(&entry.following_screen_on_interval_id)
        {
            return Err("HUSH requires supplied distinct ordered background/following-screen-on interval identities".into());
        }
        full_order.push(entry.background_interval_id.clone());
        let mut key = scope.to_vec();
        key.extend([
            "BFC".into(),
            entry.background_interval_id.clone(),
            "following".into(),
        ]);
        known(
            facts,
            key,
            Some(entry.following_screen_on_interval_id.clone()),
        )?;
        let mut key = scope.to_vec();
        key.extend([
            "BFC".into(),
            entry.background_interval_id.clone(),
            "X".into(),
        ]);
        known(facts, key, entry.x_foreground.map(|v| v.to_string()))?;
        let previous = state;
        complete &= entry.x_foreground.is_some();
        foreground += usize::from(entry.x_foreground == Some(true));
        state = match (state, entry.x_foreground) {
            (Some(previous), Some(x)) => {
                Some(beta * previous + (1.0 - beta) * f64::from(u8::from(x)))
            }
            _ => None,
        }; // Update even when the supplied observation was suppressed.
        updates.push(json!({"background_interval_id":entry.background_interval_id,
            "following_screen_on_interval_id":entry.following_screen_on_interval_id,
            "source_order":order,"was_suppressed":entry.was_suppressed,
            "previous_bfc":previous,"bfc":state,
            "suppress_using_previous_bfc":previous.map(|v| *suppress.category_for(v).expect("finite BFC")),
            "suppress_using_updated_bfc":state.map(|v| *suppress.category_for(v).expect("finite BFC"))}));
    }
    let mut key = scope.to_vec();
    key.push("BFC-complete-order".into());
    known(
        facts,
        key,
        Some(serde_json::to_string(&full_order).unwrap()),
    )?;
    Ok(
        json!({"background_count":entries.len(),"foreground_count":if complete {Some(foreground)} else {None},
        "static_bfc":if complete {ratio(foreground,entries.len())?} else {None},
        "initial_bfc":0.5,"beta":beta,"alpha":alpha,"updates":updates,
        "status":if complete {"computed_supplied_sequence"} else {"unavailable:missing_X"}}),
    )
}
#[derive(Deserialize)]
struct Launch {
    launch_id: String,
    app_id: Option<String>,
    source_order: usize,
}
fn jones_backtracking(
    get: &impl Fn(&str) -> String,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    let Some(entries) = inventory::<Launch>(&get("launches_json"))? else {
        return Ok(
            json!({"sequence_length":null,"fb_string":null,"backtracking_ratio":null,"status":"unavailable:missing_inventory"}),
        );
    };
    let mut seen = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let mut symbols = String::new();
    let mut back = 0;
    let mut complete = true;
    let mut full_order = Vec::new();
    for (order, entry) in entries.iter().enumerate() {
        nonempty(&entry.launch_id)?;
        if entry.source_order != order || !ids.insert(&entry.launch_id) {
            return Err("Jones requires distinct launch IDs in qualified session order".into());
        }
        full_order.push(entry.launch_id.clone());
        let mut key = scope.to_vec();
        key.extend(["launch-app".into(), entry.launch_id.clone()]);
        known(facts, key, entry.app_id.clone())?;
        known(
            facts,
            vec![
                scope[0].clone(),
                "source-launch-app".into(),
                entry.launch_id.clone(),
            ],
            entry.app_id.clone(),
        )?;
        if let Some(app) = &entry.app_id {
            nonempty(app)?;
            if seen.insert(app.clone()) {
                symbols.push('F');
            } else {
                symbols.push('B');
                back += 1;
            }
        } else {
            complete = false;
        }
    }
    let mut key = scope.to_vec();
    key.push("complete-launch-order".into());
    known(
        facts,
        key,
        Some(serde_json::to_string(&full_order).unwrap()),
    )?;
    Ok(
        json!({"sequence_length":entries.len(),"fb_string":if complete {Some(symbols)} else {None},
        "backtracking_count":if complete {Some(back)} else {None},
        "backtracking_ratio":if complete {ratio(back,entries.len())?} else {None},
        "status":if complete {"computed_supplied_session"} else {"unavailable:missing_app_identity"}}),
    )
}
#[derive(Clone, Deserialize)]
struct AppAnchor {
    source_event_id: String,
    app_id: String,
    event_role: String,
    clock_id: Option<String>,
    coordinate: Option<i64>,
}
fn app_anchor(
    anchor: &AppAnchor,
    app: &str,
    role: &str,
    device: &str,
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<(), String> {
    nonempty(&anchor.source_event_id)?;
    if anchor.app_id != app || anchor.event_role != role {
        return Err("anchor requires matching app and source event role".into());
    }
    known(
        facts,
        vec![
            device.into(),
            anchor.source_event_id.clone(),
            "event-owner".into(),
        ],
        Some(format!("{app}/{role}")),
    )?;
    if let Some(clock) = &anchor.clock_id {
        nonempty(clock)?;
    }
    known(
        facts,
        vec![
            device.into(),
            anchor.source_event_id.clone(),
            "clock".into(),
        ],
        anchor.clock_id.clone(),
    )?;
    known(
        facts,
        vec![
            device.into(),
            anchor.source_event_id.clone(),
            "coordinate".into(),
        ],
        anchor.coordinate.map(|v| v.to_string()),
    )
}
fn elapsed(start: &AppAnchor, end: &AppAnchor) -> Result<Option<i128>, String> {
    elapsed_coordinates(
        &start.clock_id,
        &end.clock_id,
        start.coordinate,
        end.coordinate,
    )
}
fn elapsed_coordinates(
    start_clock: &Option<String>,
    end_clock: &Option<String>,
    start: Option<i64>,
    end: Option<i64>,
) -> Result<Option<i128>, String> {
    match (start_clock, end_clock, start, end) {
        (Some(a), Some(b), _, _) if a != b => {
            Err("supplied endpoints require one coherent declared clock".into())
        }
        (Some(_), Some(_), Some(a), Some(b)) => {
            Ok(Some(super::supplied_anchor_elapsed_nanoseconds(a, b)))
        }
        _ => Ok(None),
    }
}
fn milliseconds_scale(unit: &str) -> Result<f64, String> {
    match unit {
        "ns" => Ok(0.000001),
        "us" => Ok(0.001),
        "ms" => Ok(1.0),
        "s" => Ok(1000.0),
        _ => Err("coordinate_unit must explicitly be ns/us/ms/s".into()),
    }
}
fn precision(get: &impl Fn(&str) -> String) -> Result<(), String> {
    let p = get("timestamp_precision")
        .parse::<u64>()
        .map_err(|_| "timestamp_precision requires a positive integer in coordinate units")?;
    if p == 0 {
        return Err("timestamp_precision must be positive metadata, not an alignment step".into());
    }
    Ok(())
}
fn jones_return(
    get: &impl Fn(&str) -> String,
    device: &str,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    milliseconds_scale(&get("coordinate_unit"))?;
    precision(get)?;
    let app = get("app_id");
    let prior = parsed::<AppAnchor>(&get("previous_launch_json"))?;
    let current = parsed::<AppAnchor>(&get("current_launch_json"))?;
    for (name, anchor) in [("previous", prior.as_ref()), ("current", current.as_ref())] {
        if let Some(a) = anchor {
            app_anchor(a, &app, "application_launch", device, facts)?;
            let mut key = scope.to_vec();
            key.push(name.into());
            known(facts, key, Some(a.source_event_id.clone()))?;
        }
    }
    let difference = match (&prior, &current) {
        (Some(a), Some(b)) => {
            if a.source_event_id == b.source_event_id {
                return Err("return pair requires distinct launches".into());
            }
            elapsed(a, b)?
        }
        _ => None,
    };
    if difference.is_some_and(|v| v < 0) {
        return Err("qualified consecutive return endpoints contradict supplied chronology".into());
    }
    Ok(
        json!({"app_id":app,"elapsed_coordinates":difference.map(|v|v.to_string()),
        "coordinate_unit":get("coordinate_unit"),"status":if difference.is_some(){"computed_exact_supplied_pair"}else{"unavailable:missing_endpoint_or_clock"}}),
    )
}
#[derive(Deserialize)]
struct Foreground {
    foreground: AppAnchor,
    prior_background_state: String,
    prior_background: Option<AppAnchor>,
    prior_foreground_state: String,
    prior_foreground: Option<AppAnchor>,
}
fn prior_gap(
    state: &str,
    prior: &Option<AppAnchor>,
    current: &AppAnchor,
    role: &str,
    app: &str,
    device: &str,
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<(bool, Option<i128>), String> {
    match (state, prior) {
        ("absent", None) => Ok((true, None)),
        ("unavailable", None) => Ok((false, None)),
        ("present", Some(a)) => {
            app_anchor(a, app, role, device, facts)?;
            if a.source_event_id == current.source_event_id {
                return Err("prior activity cannot be current activity".into());
            }
            let gap = elapsed(a, current)?;
            if gap.is_some_and(|v| v < 0) {
                return Err("qualified previous activity occurs after supplied foreground".into());
            }
            Ok((gap.is_some(), gap))
        }
        _ => Err(
            "prior activity needs explicit present/absent/unavailable state and matching anchor"
                .into(),
        ),
    }
}
fn hush_staleness(
    get: &impl Fn(&str) -> String,
    device: &str,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    milliseconds_scale(&get("coordinate_unit"))?;
    precision(get)?;
    let Some(entries) = inventory::<Foreground>(&get("foreground_activities_json"))? else {
        return Ok(
            json!({"mean_staleness_coordinates":null,"foreground_minima":null,"status":"unavailable:missing_inventory"}),
        );
    };
    let app = get("app_id");
    let mut ids = BTreeSet::new();
    let mut order = Vec::new();
    let mut minima = Vec::new();
    let mut terms = Vec::new();
    for e in entries {
        app_anchor(&e.foreground, &app, "foreground", device, facts)?;
        if !ids.insert(e.foreground.source_event_id.clone()) {
            return Err("complete foreground inventory requires distinct activity IDs".into());
        }
        order.push(e.foreground.source_event_id.clone());
        let (bk, bg) = prior_gap(
            &e.prior_background_state,
            &e.prior_background,
            &e.foreground,
            "background",
            &app,
            device,
            facts,
        )?;
        let (fk, fg) = prior_gap(
            &e.prior_foreground_state,
            &e.prior_foreground,
            &e.foreground,
            "foreground",
            &app,
            device,
            facts,
        )?;
        let minimum = if bk && fk {
            match (bg, fg) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (Some(a), None) | (None, Some(a)) => Some(a),
                (None, None) => None,
            }
        } else {
            None
        };
        for (role, a) in [
            ("prior-background", e.prior_background.as_ref()),
            ("prior-foreground", e.prior_foreground.as_ref()),
        ] {
            let mut key = scope.to_vec();
            key.extend([e.foreground.source_event_id.clone(), role.into()]);
            known(facts, key, a.map(|a| a.source_event_id.clone()))?;
        }
        for (role, state) in [
            ("prior-background-state", &e.prior_background_state),
            ("prior-foreground-state", &e.prior_foreground_state),
        ] {
            let mut key = scope.to_vec();
            key.extend([e.foreground.source_event_id.clone(), role.into()]);
            known(facts, key, (state != "unavailable").then(|| state.clone()))?;
        }
        terms.push(minimum.map(|v| v as f64));
        minima.push(json!({"foreground_event_id":e.foreground.source_event_id,"minimum_elapsed_coordinates":minimum.map(|v|v.to_string())}));
    }
    let mut key = scope.to_vec();
    key.push("complete-foreground-order".into());
    known(facts, key, Some(serde_json::to_string(&order).unwrap()))?;
    let mean = reduce(&terms, true)?;
    Ok(
        json!({"foreground_count":terms.len(),"foreground_minima":minima,"mean_staleness_coordinates":mean,
        "coordinate_unit":get("coordinate_unit"),"status":if mean.is_some(){"computed_binary64_mean_of_exact_minima"}else{"unavailable:undefined_or_missing_foreground_staleness"}}),
    )
}
#[derive(Deserialize)]
struct PhoneSession {
    session_id: String,
    full_session_duration_seconds: Box<RawValue>,
}
#[derive(Deserialize)]
struct HourContribution {
    contribution_id: String,
    duration_seconds: Box<RawValue>,
}
fn cognitive(
    get: &impl Fn(&str) -> String,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    if get("duration_unit") != "s" || get("hour_duration_seconds") != "3600" {
        return Err(
            "phone-hour stage requires explicit seconds and qualified3600-second hour".into(),
        );
    }
    let sessions = inventory::<PhoneSession>(&get("sessions_json"))?;
    let contributions = inventory::<HourContribution>(&get("duration_contributions_json"))?;
    let mut terms = Vec::new();
    let mut classes = Vec::new();
    let mut short_count = 0;
    let mut complete = true;
    let class =
        FiniteScalarPivotClassifier::new(30.0, true, false, false).map_err(|e| e.to_string())?;
    if let Some(entries) = &sessions {
        let mut ids = BTreeSet::new();
        let mut order = Vec::new();
        for e in entries {
            nonempty(&e.session_id)?;
            if !ids.insert(&e.session_id) {
                return Err("complete phone-session inventory requires distinct IDs".into());
            }
            order.push(e.session_id.clone());
            let d = duration(&e.full_session_duration_seconds)?;
            let mut key = scope.to_vec();
            key.extend(["phone-session-duration".into(), e.session_id.clone()]);
            known(facts, key, d.map(|v| v.to_string()))?;
            known(
                facts,
                vec![
                    scope[0].clone(),
                    "source-phone-session-duration".into(),
                    e.session_id.clone(),
                ],
                d.map(|v| v.to_string()),
            )?;
            let short = d.map(|v| *class.category_for(v).expect("qualified finite seconds"));
            complete &= short.is_some();
            short_count += usize::from(short == Some(true));
            terms.push(d);
            classes.push(json!({"session_id":e.session_id,"short":short}));
        }
        let mut key = scope.to_vec();
        key.push("whole-phone-session-order".into());
        known(facts, key, Some(serde_json::to_string(&order).unwrap()))?;
    }
    let mut hour_terms = Vec::new();
    if let Some(entries) = &contributions {
        let mut ids = BTreeSet::new();
        let mut order = Vec::new();
        for e in entries {
            nonempty(&e.contribution_id)?;
            if !ids.insert(&e.contribution_id) {
                return Err(
                    "whole-hour duration inventory requires distinct contribution IDs".into(),
                );
            }
            order.push(e.contribution_id.clone());
            let d = duration(&e.duration_seconds)?;
            let mut key = scope.to_vec();
            key.extend([
                "hour-duration-contribution".into(),
                e.contribution_id.clone(),
            ]);
            known(facts, key, d.map(|v| v.to_string()))?;
            hour_terms.push(d);
        }
        let mut key = scope.to_vec();
        key.push("whole-hour-contribution-order".into());
        known(facts, key, Some(serde_json::to_string(&order).unwrap()))?;
    }
    let mean = if sessions.is_some() {
        reduce(&terms, true)?
    } else {
        None
    };
    let total = if contributions.is_some() {
        reduce(&hour_terms, false)?
    } else {
        None
    };
    Ok(
        json!({"phone_session_count":sessions.as_ref().map(Vec::len),"hourly_total_phone_duration_seconds":total,
        "mean_phone_session_duration_seconds":mean,"short_session_classes":if sessions.is_some(){Some(classes)}else{None},
        "short_session_count":if sessions.is_some()&&complete{Some(short_count)}else{None},
        "status":if sessions.is_some()&&contributions.is_some()&&complete&&total.is_some(){"computed_supplied_hour"}else{"unavailable:missing_inventory_or_duration"}}),
    )
}
#[derive(Deserialize)]
struct KeyAnchor {
    source_event_id: String,
    key_instance_id: String,
    event_role: String,
    clock_id: Option<String>,
    coordinate: Option<i64>,
}
#[derive(Deserialize)]
struct TypingPair {
    pair_id: String,
    kind: String,
    pair_stage: String,
    start_anchor: KeyAnchor,
    end_anchor: KeyAnchor,
}
fn typing(
    get: &impl Fn(&str) -> String,
    device: &str,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Value, String> {
    let scale = milliseconds_scale(&get("coordinate_unit"))?;
    precision(get)?;
    let Some(entries) = inventory::<TypingPair>(&get("typing_pairs_json"))? else {
        return Ok(
            json!({"hold_mean_ms":null,"flight_mean_ms":null,"pairs":null,"status":"unavailable:missing_inventory"}),
        );
    };
    let mut ids = BTreeSet::new();
    let mut order = Vec::new();
    let mut hold = Vec::new();
    let mut flight = Vec::new();
    let mut output = Vec::new();
    for e in entries {
        nonempty(&e.pair_id)?;
        if !ids.insert(e.pair_id.clone()) {
            return Err("complete typing inventory requires distinct pair IDs".into());
        }
        order.push(e.pair_id.clone());
        let (start_role, end_role, stage) = match e.kind.as_str() {
            "hold" => (
                "key_press",
                "key_release",
                "caller-resolved-same-key-press-release",
            ),
            "flight" => (
                "key_release",
                "key_press",
                "caller-resolved-release-next-keypress",
            ),
            _ => return Err("typing kind must be hold or flight".into()),
        };
        if e.pair_stage != stage
            || e.start_anchor.event_role != start_role
            || e.end_anchor.event_role != end_role
        {
            return Err("typing pair requires source-qualified hold/flight endpoint roles".into());
        }
        for a in [&e.start_anchor, &e.end_anchor] {
            nonempty(&a.source_event_id)?;
            nonempty(&a.key_instance_id)?;
            if let Some(clock) = &a.clock_id {
                nonempty(clock)?;
            }
            known(
                facts,
                vec![device.into(), a.source_event_id.clone(), "key-role".into()],
                Some(format!("{}/{}", a.key_instance_id, a.event_role)),
            )?;
            known(
                facts,
                vec![device.into(), a.source_event_id.clone(), "clock".into()],
                a.clock_id.clone(),
            )?;
            known(
                facts,
                vec![
                    device.into(),
                    a.source_event_id.clone(),
                    "coordinate".into(),
                ],
                a.coordinate.map(|v| v.to_string()),
            )?;
        }
        if e.start_anchor.source_event_id == e.end_anchor.source_event_id
            || (e.kind == "hold" && e.start_anchor.key_instance_id != e.end_anchor.key_instance_id)
            || (e.kind == "flight"
                && e.start_anchor.key_instance_id == e.end_anchor.key_instance_id)
        {
            return Err("typing anchors contradict qualified key-instance pairing".into());
        }
        let difference = elapsed_coordinates(
            &e.start_anchor.clock_id,
            &e.end_anchor.clock_id,
            e.start_anchor.coordinate,
            e.end_anchor.coordinate,
        )?;
        if e.kind == "hold" && difference.is_some_and(|v| v < 0) {
            return Err("closed same-key hold has negative duration".into());
        }
        let mut key = scope.to_vec();
        key.extend(["typing-pair".into(), e.pair_id.clone()]);
        known(
            facts,
            key,
            Some(
                serde_json::to_string(&(
                    &e.kind,
                    &e.start_anchor.source_event_id,
                    &e.end_anchor.source_event_id,
                ))
                .map_err(|e| e.to_string())?,
            ),
        )?;
        let term = difference.map(|v| v as f64 * scale);
        if e.kind == "hold" {
            hold.push(term);
        } else {
            flight.push(term);
        }
        output.push(json!({"pair_id":e.pair_id,"kind":e.kind,"elapsed_coordinates":difference.map(|v|v.to_string())}));
    }
    let mut key = scope.to_vec();
    key.push("complete-typing-pair-order".into());
    known(facts, key, Some(serde_json::to_string(&order).unwrap()))?;
    let hm = reduce(&hold, true)?;
    let fm = reduce(&flight, true)?;
    Ok(
        json!({"hold_pair_count":hold.len(),"flight_pair_count":flight.len(),"hold_mean_ms":hm,"flight_mean_ms":fm,
        "coordinate_unit":get("coordinate_unit"),"pairs":output,
        "status":if hm.is_some()&&fm.is_some(){"computed_binary64_named_means"}else{"unavailable:empty_or_missing_named_domain"}}),
    )
}

// Bounded source-disclosed follow-on stages. They consume caller-qualified
// inventories/endpoints, never construct raw events, sessions, days or words.
#[derive(Deserialize)]
struct SuppliedFlag {
    item_id: String,
    source_order: usize,
    value: Option<bool>,
}
#[derive(Deserialize)]
struct SuppliedDuration {
    item_id: String,
    source_order: usize,
    value: Box<RawValue>,
}
#[derive(Deserialize)]
struct SuppliedOccurrence {
    item_id: String,
    source_order: usize,
}
#[derive(Deserialize)]
struct SuppliedDay {
    day_id: String,
    count: Option<u64>,
}
#[derive(Deserialize)]
struct SuppliedUserDays {
    user_id: String,
    days: Option<Vec<SuppliedDay>>,
}
#[derive(Clone, Deserialize)]
struct SuppliedEndpoint {
    source_event_id: String,
    event_role: String,
    clock_id: Option<String>,
    coordinate: Option<i64>,
}
#[derive(Deserialize)]
struct ClosedScreenInterval {
    interval_id: String,
    source_order: usize,
    start: SuppliedEndpoint,
    end: SuppliedEndpoint,
}
fn supplied_order(
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
    order: &[String],
    domain: &str,
) -> Result<(), String> {
    if order.iter().collect::<BTreeSet<_>>().len() != order.len() {
        return Err("supplied complete inventory has duplicate literal identities".into());
    }
    for id in order {
        nonempty(id)?;
    }
    let mut key = scope.to_vec();
    key.push(domain.into());
    known(facts, key, Some(serde_json::to_string(order).unwrap()))
}
fn flags(
    get: &impl Fn(&str) -> String,
    field: &str,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Option<Vec<Option<bool>>>, String> {
    let Some(entries) = inventory::<SuppliedFlag>(&get(field))? else {
        return Ok(None);
    };
    let mut order = Vec::new();
    let mut values = Vec::new();
    for (i, e) in entries.into_iter().enumerate() {
        if e.source_order != i {
            return Err("supplied inventory requires zero-based declared list order".into());
        }
        order.push(e.item_id.clone());
        let mut key = scope.to_vec();
        key.extend([field.into(), e.item_id, "value".into()]);
        known(facts, key, e.value.map(|x| x.to_string()))?;
        values.push(e.value);
    }
    supplied_order(scope, facts, &order, field)?;
    Ok(Some(values))
}
fn flag_ratio(values: &[Option<bool>]) -> Result<Option<f64>, String> {
    if values.iter().any(Option::is_none) {
        return Ok(None);
    }
    ratio(
        values.iter().filter(|x| **x == Some(true)).count(),
        values.len(),
    )
}
fn unit(get: &impl Fn(&str) -> String, field: &str) -> Result<(), String> {
    nonempty(&get(field))
}
fn supplied_endpoint(
    e: &SuppliedEndpoint,
    role: &str,
    device: &str,
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<(), String> {
    nonempty(&e.source_event_id)?;
    if e.event_role != role {
        return Err("endpoint requires the exact qualified source event role".into());
    }
    if let Some(clock) = &e.clock_id {
        nonempty(clock)?;
    }
    known(
        facts,
        vec![
            "extra-event".into(),
            device.into(),
            e.source_event_id.clone(),
            "role".into(),
        ],
        Some(role.into()),
    )?;
    known(
        facts,
        vec![
            "extra-event".into(),
            device.into(),
            e.source_event_id.clone(),
            "clock".into(),
        ],
        e.clock_id.clone(),
    )?;
    known(
        facts,
        vec![
            "extra-event".into(),
            device.into(),
            e.source_event_id.clone(),
            "coordinate".into(),
        ],
        e.coordinate.map(|x| x.to_string()),
    )
}
fn supplied_pair(
    start: &SuppliedEndpoint,
    end: &SuppliedEndpoint,
    roles: (&str, &str),
    device: &str,
    key: Vec<String>,
    nonnegative: bool,
    facts: &mut BTreeMap<Vec<String>, String>,
) -> Result<Option<i128>, String> {
    if start.source_event_id == end.source_event_id {
        return Err("resolved endpoint identities must be distinct".into());
    }
    supplied_endpoint(start, roles.0, device, facts)?;
    supplied_endpoint(end, roles.1, device, facts)?;
    known(
        facts,
        key,
        Some(
            serde_json::to_string(&(
                device,
                &start.source_event_id,
                &end.source_event_id,
                nonnegative,
            ))
            .unwrap(),
        ),
    )?;
    let d = elapsed_coordinates(
        &start.clock_id,
        &end.clock_id,
        start.coordinate,
        end.coordinate,
    )?;
    if nonnegative && d.is_some_and(|v| v < 0) {
        return Err("closed/source-ordered duration must be nonnegative".into());
    }
    Ok(d)
}
// Refusal-only consistency, independent of declaration order. No retained
// endpoint replaces a missing original endpoint in any row's calculation.
fn validate_followon_known(facts: &BTreeMap<Vec<String>, String>) -> Result<(), String> {
    let endpoint = |device: &str, id: &str| {
        let prefix = vec!["extra-event".into(), device.into(), id.into()];
        let mut key = prefix.clone();
        key.push("clock".into());
        let clock = facts.get(&key).cloned();
        let mut key = prefix;
        key.push("coordinate".into());
        let coordinate = facts.get(&key).map(|v| v.parse::<i64>().unwrap());
        (clock, coordinate)
    };
    for (key, value) in facts {
        if key.first().map(String::as_str) != Some("extra-pair") {
            continue;
        }
        let (device, start, end, nonnegative): (String, String, String, bool) =
            serde_json::from_str(value).unwrap();
        let (ac, a) = endpoint(&device, &start);
        let (bc, b) = endpoint(&device, &end);
        let d = elapsed_coordinates(&ac, &bc, a, b)?;
        if nonnegative && d.is_some_and(|v| v < 0) {
            return Err("known endpoints contradict qualified nonnegative duration".into());
        }
    }
    for (key, value) in facts {
        if key.first().map(String::as_str) != Some("extra-policy") {
            continue;
        }
        let (device, nonnegative): (String, bool) = serde_json::from_str(value).unwrap();
        let mut akey = key.clone();
        akey[0] = "extra-start".into();
        let mut bkey = key.clone();
        bkey[0] = "extra-end".into();
        if let (Some(aid), Some(bid)) = (facts.get(&akey), facts.get(&bkey)) {
            if aid == bid {
                return Err("resolved endpoint identities must be distinct".into());
            }
            let (ac, a) = endpoint(&device, aid);
            let (bc, b) = endpoint(&device, bid);
            let d = elapsed_coordinates(&ac, &bc, a, b)?;
            if nonnegative && d.is_some_and(|v| v < 0) {
                return Err("known endpoints contradict qualified nonnegative duration".into());
            }
        }
    }
    // Only caller-supplied closed screen-ON intervals claiming disjointness.
    // Strict overlap of known, coherent coordinates is a contradiction; no
    // union, unknown endpoint/clock fill, tie policy or interval selection.
    for (key, value) in facts {
        if key.first().map(String::as_str) != Some("screen-inventory") {
            continue;
        }
        let intervals: Vec<(String, String, String)> = serde_json::from_str(value).unwrap();
        // ponytail: quadratic within one supplied day; sort qualified closed intervals only if measured large inputs demand it.
        for (i, (device, a, b)) in intervals.iter().enumerate() {
            let (ac, aa) = endpoint(device, a);
            let (bc, bb) = endpoint(device, b);
            for (_, c, d) in intervals.iter().skip(i + 1) {
                let (cc, ccc) = endpoint(device, c);
                let (dc, dd) = endpoint(device, d);
                if let (Some(clock), Some(aa), Some(bb), Some(ccc), Some(dd)) =
                    (&ac, aa, bb, ccc, dd)
                {
                    if bc.as_ref() == Some(clock)
                        && cc.as_ref() == Some(clock)
                        && dc.as_ref() == Some(clock)
                        && aa.max(ccc) < bb.min(dd)
                    {
                        return Err("known closed screen-ON intervals contradict supplied disjoint membership".into());
                    }
                }
            }
        }
    }
    Ok(())
}
fn followon(
    get: &impl Fn(&str) -> String,
    device: &str,
    scope: &[String],
    facts: &mut BTreeMap<Vec<String>, String>,
    stage: Stage,
) -> Result<Value, String> {
    match stage {
        Stage::HushBeta | Stage::HushAlpha => {
            if get("sequence_origin") != "caller-qualified-source-sequence-from-initial-0.5" {
                return Err(
                    "HUSH sensitivity requires explicitly qualified sequence origin initial0.5"
                        .into(),
                );
            }
            if stage == Stage::HushAlpha && get("beta") != "0.5" {
                return Err("disclosed alpha alternatives require explicit beta0.5".into());
            }
            let selections: &[f64] = if stage == Stage::HushBeta {
                &[0.1, 0.5, 0.9]
            } else {
                &[0.0, 0.1, 0.2, 0.8]
            };
            let mut results = Vec::new();
            for &selection in selections {
                let (beta, alpha) = if stage == Stage::HushBeta {
                    (selection, 0.0)
                } else {
                    (0.5, selection)
                };
                let mut result = hush_bfc_at(get, scope, facts, beta, alpha)?;
                if stage == Stage::HushBeta {
                    if let Some(object) = result.as_object_mut() {
                        object.remove("alpha");
                    }
                    if let Some(updates) = result["updates"].as_array_mut() {
                        for update in updates {
                            let object = update.as_object_mut().unwrap();
                            object.remove("suppress_using_previous_bfc");
                            object.remove("suppress_using_updated_bfc");
                        }
                    }
                }
                results.push(result);
            }
            Ok(
                json!({"selections":selections,"results":results,"status":if results.iter().all(|v|v["status"]=="computed_supplied_sequence"){"computed_disclosed_alternatives"}else{"unavailable:missing_inventory_or_X"}}),
            )
        }
        Stage::PrefTerm
        | Stage::PrefReminder
        | Stage::DismissedConversion
        | Stage::FinessePresence => {
            let field = if stage == Stage::FinessePresence {
                "sessions_json"
            } else {
                "notifications_json"
            };
            let Some(values) = flags(get, field, scope, facts)? else {
                return Ok(json!({"value":null,"status":"unavailable:missing_inventory"}));
            };
            let total = values.len();
            let yes = if values.iter().any(Option::is_none) {
                None
            } else {
                Some(values.iter().filter(|v| **v == Some(true)).count())
            };
            let fraction = flag_ratio(&values)?;
            if stage == Stage::PrefTerm {
                if get("selected_N") != "2" {
                    return Err(
                        "PrefMiner requires explicit paper-selected N2, not a global default"
                            .into(),
                    );
                }
                let days: Option<u64> =
                    if get("participation_days").is_empty() {
                        None
                    } else {
                        Some(get("participation_days").parse().map_err(|_| {
                            "participation_days requires an exact nonnegative integer"
                        })?)
                    };
                let mut key = scope.to_vec();
                key.push("participation-days".into());
                known(facts, key, days.map(|x| x.to_string()))?;
                let mut alternatives = Vec::new();
                for n in 1u64..=7 {
                    let threshold = match (days, total) {
                        (Some(d), t) if t > 0 => {
                            let denom = u64::try_from(t)
                                .map_err(|e| e.to_string())?
                                .checked_mul(n)
                                .ok_or("term denominator overflow")?;
                            Some(
                                construct_named_count_ratios([CountRatioRequest {
                                    name: (),
                                    numerator: d,
                                    denominator_terms: vec![denom],
                                }])
                                .map_err(|e| e.to_string())?[0]
                                    .ratio
                                    .value(),
                            )
                        }
                        _ => None,
                    };
                    // Cancel the identical nonempty denominator for an exact
                    // strict comparison; preserve equality without float drift.
                    let removed = match (yes, days, total) {
                        (Some(y), Some(d), t) if t > 0 => {
                            Some((y as u128) * u128::from(n) < u128::from(d))
                        }
                        _ => None,
                    };
                    alternatives
                        .push(json!({"N":n,"threshold":threshold,"remove_strict_lower":removed}));
                }
                return Ok(
                    json!({"total_notifications":total,"notifications_containing_term":yes,"term_frequency":fraction,"participation_days":days,"selected_N":2,"alternatives":alternatives,"status":if fraction.is_some()&&days.is_some(){"computed_paper_presence_TF"}else{"unavailable:empty_or_missing_domain"}}),
                );
            }
            let value = if stage == Stage::PrefReminder {
                fraction.map(|x| x * 100.0)
            } else {
                fraction
            };
            Ok(json!({"total":total,"true_count":yes,"value":value,
                "zero_click_reminder":if stage==Stage::PrefReminder{fraction.map(|x|x==0.0)}else{None},
                "status":if value.is_some(){"computed_supplied_inventory"}else{"unavailable:empty_or_missing_domain"}}))
        }
        Stage::MathurRatio => {
            unit(get, "active_time_unit")?;
            let count: Option<u64> = if get("last_hour_app_count").is_empty() {
                None
            } else {
                Some(
                    get("last_hour_app_count")
                        .parse()
                        .map_err(|_| "LastHourAppCount requires an exact u64")?,
                )
            };
            let active = super::supplied_learning_session_net_duration::duration(&get(
                "last_hour_active_time",
            ))
            .map_err(|_| "active time requires a finite nonnegative caller-unit scalar")?;
            for (name, value) in [
                ("count", count.map(|v| v.to_string())),
                ("active", active.map(|v| v.to_string())),
            ] {
                let mut key = scope.to_vec();
                key.push(name.into());
                known(facts, key, value)?;
            }
            let value=match(count,active) {
                (Some(c),Some(a)) if a>0.0=>Some(super::supplied_network_interaction_rates::taps_per_second(c,a).map_err(|_|"count/caller-unit quotient exceeds the disclosed exact-count finite binary64 domain")?),
                _=>None,
            };
            Ok(
                json!({"app_count":count,"active_time":active,"active_time_unit":get("active_time_unit"),"apps_per_declared_active_time_unit":value,"status":if value.is_some(){"computed_caller_unit_quotient"}else{"unavailable:missing_or_zero_denominator"}}),
            )
        }
        Stage::SarsenCount => {
            let Some(entries) = inventory::<SuppliedOccurrence>(&get("launches_json"))? else {
                return Ok(json!({"launch_count":null,"status":"unavailable:missing_inventory"}));
            };
            let mut order = Vec::new();
            for (i, e) in entries.into_iter().enumerate() {
                if e.source_order != i {
                    return Err("launch inventory requires declared zero-based order".into());
                }
                order.push(e.item_id);
            }
            supplied_order(scope, facts, &order, "launches")?;
            Ok(
                json!({"launch_count":order.len(),"status":"computed_supplied_hour_launch_count"}),
            )
        }
        Stage::SarsenDuration => {
            unit(get, "duration_unit")?;
            let Some(entries) = inventory::<SuppliedDuration>(&get("contributions_json"))? else {
                return Ok(json!({"duration_total":null,"status":"unavailable:missing_inventory"}));
            };
            let mut order = Vec::new();
            let mut values = Vec::new();
            for (i, e) in entries.into_iter().enumerate() {
                if e.source_order != i {
                    return Err("duration inventory requires declared zero-based order".into());
                }
                let value = duration(&e.value).map_err(|_| {
                    "duration contribution requires a finite nonnegative declared-unit scalar"
                })?;
                let mut key = scope.to_vec();
                key.extend(["duration".into(), e.item_id.clone()]);
                known(facts, key, value.map(|v| v.to_string()))?;
                order.push(e.item_id);
                values.push(value);
            }
            supplied_order(scope, facts, &order, "durations")?;
            let total = reduce(&values, false)?;
            Ok(
                json!({"contribution_count":values.len(),"duration_total":total,"duration_unit":get("duration_unit"),"status":if total.is_some(){"computed_supplied_hour_duration_sum"}else{"unavailable:missing_contribution"}}),
            )
        }
        Stage::DismissedDaily => {
            let Some(users) = inventory::<SuppliedUserDays>(&get("users_json"))? else {
                return Ok(
                    json!({"user_means":null,"median_user_daily_mean":null,"status":"unavailable:missing_user_inventory"}),
                );
            };
            let mut ids = Vec::new();
            let mut means = Vec::new();
            let mut output = Vec::new();
            for user in users {
                let mut domain = scope.to_vec();
                domain.extend(["user".into(), user.user_id.clone()]);
                let mean = if let Some(days) = user.days {
                    let mut dayids = Vec::new();
                    let mut counts = Vec::new();
                    for day in days {
                        let mut key = domain.clone();
                        key.push(day.day_id.clone());
                        known(facts, key, day.count.map(|v| v.to_string()))?;
                        let count = day
                            .count
                            .map(|n| {
                                let x = n as f64;
                                if x as u128 != u128::from(n) {
                                    Err("notification count must project exactly to binary64")
                                } else {
                                    Ok(x)
                                }
                            })
                            .transpose()?;
                        dayids.push(day.day_id);
                        counts.push(count);
                    }
                    supplied_order(&domain, facts, &dayids, "complete-days")?;
                    reduce(&counts, true)?
                } else {
                    None
                };
                ids.push(user.user_id.clone());
                means.push(mean);
                output.push(json!({"user_id":user.user_id,"mean_notifications_per_day":mean}));
            }
            supplied_order(scope, facts, &ids, "complete-users")?;
            let median = if means.is_empty() || means.iter().any(Option::is_none) {
                None
            } else {
                Some(super::phonestudy_median(
                    means.iter().map(|v| v.unwrap()).collect(),
                ))
            };
            Ok(
                json!({"user_means":output,"median_user_daily_mean":median,"status":if median.is_some(){"computed_mean_per_user_then_median"}else{"unavailable:empty_or_missing_user_day_domain"}}),
            )
        }
        Stage::DinglerAttendance | Stage::MathurGap | Stage::TouchStroke => {
            precision(get)?;
            milliseconds_scale(&get("coordinate_unit"))?; // validates explicit coordinate unit only
            let (idfield, roles, nonnegative) = match stage {
                Stage::DinglerAttendance => (
                    "notification_id",
                    ("notification_arrival", "first_inferred_attendance"),
                    true,
                ),
                Stage::MathurGap => (
                    "context_id",
                    ("previous_app_close", "current_app_open"),
                    false,
                ),
                _ => ("stroke_id", ("stroke_start", "stroke_end"), true),
            };
            nonempty(&get(idfield))?;
            let start = parsed::<SuppliedEndpoint>(&get("start_anchor_json"))?;
            let end = parsed::<SuppliedEndpoint>(&get("end_anchor_json"))?;
            let key = vec![
                "extra-pair".into(),
                device.into(),
                stage.adapter_id().into(),
                get(idfield),
            ];
            let mut policy = key.clone();
            policy[0] = "extra-policy".into();
            known(
                facts,
                policy,
                Some(serde_json::to_string(&(device, nonnegative)).unwrap()),
            )?;
            // A provided endpoint is checked even when its companion is missing.
            if let Some(a) = &start {
                supplied_endpoint(a, roles.0, device, facts)?;
                let mut k = key.clone();
                k[0] = "extra-start".into();
                known(facts, k, Some(a.source_event_id.clone()))?;
            }
            if let Some(b) = &end {
                supplied_endpoint(b, roles.1, device, facts)?;
                let mut k = key.clone();
                k[0] = "extra-end".into();
                known(facts, k, Some(b.source_event_id.clone()))?;
            }
            let value = match (&start, &end) {
                (Some(a), Some(b)) => supplied_pair(a, b, roles, device, key, nonnegative, facts)?,
                _ => None,
            };
            let ms = if stage == Stage::TouchStroke {
                value.map(|v| v as f64 * milliseconds_scale(&get("coordinate_unit")).unwrap())
            } else {
                None
            };
            Ok(
                json!({"elapsed_coordinate_units":value.map(|v|v.to_string()),"coordinate_unit":get("coordinate_unit"),"stroke_time_ms":ms,
                "status":if value.is_some(){"computed_supplied_endpoints"}else{"unavailable:missing_endpoint_clock_or_coordinate"}}),
            )
        }
        Stage::MultiActive => {
            precision(get)?;
            milliseconds_scale(&get("coordinate_unit"))?;
            if !["phone", "tablet", "watch"].contains(&get("device_type").as_str()) {
                return Err("requires supplied Android phone/tablet/watch".into());
            }
            let Some(entries) = inventory::<ClosedScreenInterval>(&get("intervals_json"))? else {
                return Ok(
                    json!({"active_time_coordinate_units":null,"status":"unavailable:missing_inventory"}),
                );
            };
            let mut order = Vec::new();
            let mut sums = Vec::new();
            let mut pairs = Vec::new();
            let mut exact = Some(0i128);
            for (i, e) in entries.into_iter().enumerate() {
                if e.source_order != i {
                    return Err(
                        "closed interval inventory requires declared zero-based order".into(),
                    );
                }
                let key = vec![
                    "extra-pair".into(),
                    device.into(),
                    stage.adapter_id().into(),
                    e.interval_id.clone(),
                ];
                let d = supplied_pair(
                    &e.start,
                    &e.end,
                    ("screen_on", "screen_off"),
                    device,
                    key,
                    true,
                    facts,
                )?;
                exact = match (exact, d) {
                    (Some(a), Some(b)) => {
                        Some(a.checked_add(b).ok_or("exact duration total overflow")?)
                    }
                    _ => None,
                };
                sums.push(d.map(|v| v as f64));
                order.push(e.interval_id);
                pairs.push((
                    device.to_owned(),
                    e.start.source_event_id,
                    e.end.source_event_id,
                ));
            }
            supplied_order(scope, facts, &order, "closed-intervals")?;
            let mut key = vec!["screen-inventory".into()];
            key.extend(scope.to_vec());
            known(facts, key, Some(serde_json::to_string(&pairs).unwrap()))?;
            let projected = reduce(&sums, false)?;
            Ok(
                json!({"closed_interval_count":sums.len(),"active_time_coordinate_units":exact.map(|v|v.to_string()),"active_time_binary64":projected,"coordinate_unit":get("coordinate_unit"),
                "status":if exact.is_some(){"computed_supplied_closed_screen_on_sum"}else{"unavailable:missing_interval_clock_or_coordinate"}}),
            )
        }
        _ => unreachable!("priority stages dispatched before follow-on"),
    }
}
// Refuse only contradictions proved by supplied known facts after all rows are
// read. These facts never replace the original inputs used for row results.
fn validate_known_claims(
    records: &[csv::StringRecord],
    columns: &BTreeMap<&str, usize>,
    stage: Stage,
    facts: &BTreeMap<Vec<String>, String>,
) -> Result<(), String> {
    if !matches!(
        stage,
        Stage::JonesReturn | Stage::HushStaleness | Stage::RodriguesTypingMean
    ) {
        return Ok(());
    }
    let endpoint = |device: &str, id: &str| {
        let clock = facts
            .get(&vec![device.into(), id.into(), "clock".into()])
            .cloned();
        let coordinate = facts
            .get(&vec![device.into(), id.into(), "coordinate".into()])
            .map(|v| {
                v.parse::<i64>()
                    .expect("coordinate fact was stored from i64")
            });
        (clock, coordinate)
    };
    let pair = |device: &str, start: &str, end: &str, nonnegative: bool| -> Result<(), String> {
        if start == end {
            return Err("qualified endpoint identities must be distinct".into());
        }
        let (a_clock, a) = endpoint(device, start);
        let (b_clock, b) = endpoint(device, end);
        let difference = elapsed_coordinates(&a_clock, &b_clock, a, b)?;
        if nonnegative && difference.is_some_and(|v| v < 0) {
            return Err("retained known endpoints contradict qualified chronology".into());
        }
        Ok(())
    };
    let no_interior = |device: &str,
                       app: &str,
                       role: &str,
                       start: &str,
                       end: &str|
     -> Result<(), String> {
        let (Some(a_clock), Some(a)) = endpoint(device, start) else {
            return Ok(());
        };
        let (Some(b_clock), Some(b)) = endpoint(device, end) else {
            return Ok(());
        };
        if a_clock != b_clock {
            return Ok(());
        }
        let owner = format!("{app}/{role}");
        // ponytail: O(pairs * known anchors); index by qualified device/app/role/clock/time only if measured large inputs require it.
        for (key, value) in facts {
            if key.len() != 3 || key[0] != device || key[2] != "event-owner" || *value != owner {
                continue;
            }
            let (clock, coordinate) = endpoint(device, &key[1]);
            if clock.as_ref() == Some(&a_clock) && coordinate.is_some_and(|v| a < v && v < b) {
                return Err("known eligible strict-interior anchor contradicts supplied consecutive/latest-prior claim".into());
            }
        }
        Ok(())
    };
    for record in records {
        let get = |name: &str| record[columns[name]].to_owned();
        let device = get("source_device_id");
        match stage {
            Stage::JonesReturn => {
                let scope = get("scope_id");
                let prior = facts.get(&vec![device.clone(), scope.clone(), "previous".into()]);
                let current = facts.get(&vec![device.clone(), scope, "current".into()]);
                if let (Some(a), Some(b)) = (prior, current) {
                    pair(&device, a, b, true)?;
                    no_interior(&device, &get("app_id"), "application_launch", a, b)?;
                }
            }
            Stage::HushStaleness => {
                if let Some(entries) = inventory::<Foreground>(&get("foreground_activities_json"))?
                {
                    for entry in entries {
                        for (state, prior, role) in [
                            (
                                &entry.prior_background_state,
                                &entry.prior_background,
                                "background",
                            ),
                            (
                                &entry.prior_foreground_state,
                                &entry.prior_foreground,
                                "foreground",
                            ),
                        ] {
                            if state == "present" {
                                let a = prior.as_ref().expect("present anchor already validated");
                                pair(
                                    &device,
                                    &a.source_event_id,
                                    &entry.foreground.source_event_id,
                                    true,
                                )?;
                                no_interior(
                                    &device,
                                    &get("app_id"),
                                    role,
                                    &a.source_event_id,
                                    &entry.foreground.source_event_id,
                                )?;
                            }
                        }
                    }
                }
            }
            Stage::RodriguesTypingMean => {
                if let Some(entries) = inventory::<TypingPair>(&get("typing_pairs_json"))? {
                    for entry in entries {
                        pair(
                            &device,
                            &entry.start_anchor.source_event_id,
                            &entry.end_anchor.source_event_id,
                            entry.kind == "hold",
                        )?;
                    }
                }
            }
            _ => unreachable!("non-endpoint stages returned before validation"),
        }
    }
    Ok(())
}
pub(super) fn csv(raw: &[u8], stage: Stage) -> Result<(Vec<u8>, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
        || headers.iter().any(|h| OUTPUTS.contains(&h))
    {
        return Err("requires unique raw columns without supplied calculated output".into());
    }
    let columns = COMMON_FIELDS
        .iter()
        .chain(stage.fields())
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .map(|i| (*name, i))
                .ok_or_else(|| format!("{} requires {name}", stage.adapter_id()))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut out_headers = headers.clone();
    out_headers.extend(OUTPUTS.iter().copied());
    writer
        .write_record(&out_headers)
        .map_err(|e| e.to_string())?;
    let mut rows = BTreeMap::new();
    let mut owners = BTreeMap::new();
    let mut device_owners = BTreeMap::new();
    let mut facts = BTreeMap::new();
    for record in &records {
        let get = |name: &str| record[columns[name]].to_owned();
        for name in COMMON_FIELDS
            .iter()
            .filter(|n| !["source_platform", "input_stage"].contains(n))
        {
            nonempty(&get(name))?;
        }
        if get("source_platform") != "Android" || get("input_stage") != stage.qualification() {
            return Err("requires explicit Android source-stage qualification".into());
        }
        let device = get("source_device_id");
        let stream = get("source_stream_id");
        let scope = vec![device.clone(), get("scope_id")];
        let row_key = (device.clone(), stream.clone(), get("source_row_id"));
        if rows.get(&row_key).is_some_and(|p| p != record) {
            return Err("source row ID has conflicting lexical input".into());
        }
        rows.insert(row_key, record.clone());
        let mut owner = vec![get("participant_id"), stream];
        for name in [
            "app_id",
            "coordinate_unit",
            "timestamp_precision",
            "beta",
            "alpha",
            "sequence_origin",
            "duration_unit",
            "hour_duration_seconds",
            "term_id",
            "category_id",
            "feature_id",
            "day_id",
            "hour_id",
            "last_hour_id",
            "active_time_unit",
            "device_type",
        ] {
            if columns.contains_key(name) {
                nonempty(&get(name))?;
                owner.push(get(name));
            }
        }
        let mut device_owner = vec![get("participant_id"), get("source_stream_id")];
        for name in ["coordinate_unit", "timestamp_precision"] {
            if columns.contains_key(name) {
                device_owner.push(get(name));
            }
        }
        if device_owners
            .get(&device)
            .is_some_and(|p| p != &device_owner)
        {
            return Err("one supplied device requires stable participant/source-stream and declared clock-unit/precision metadata".into());
        }
        device_owners.insert(device.clone(), device_owner);
        if owners.get(&scope).is_some_and(|p| p != &owner) {
            return Err("supplied scope has contradictory participant/device-stream/app/unit/precision ownership".into());
        }
        owners.insert(scope.clone(), owner);
        let result = match stage {
            Stage::HushBfc => hush_bfc(&get, &scope, &mut facts)?,
            Stage::HushStaleness => hush_staleness(&get, &device, &scope, &mut facts)?,
            Stage::JonesBacktracking => jones_backtracking(&get, &scope, &mut facts)?,
            Stage::JonesReturn => jones_return(&get, &device, &scope, &mut facts)?,
            Stage::CognitivePhoneHour => cognitive(&get, &scope, &mut facts)?,
            Stage::RodriguesTypingMean => typing(&get, &device, &scope, &mut facts)?,
            _ => followon(&get, &device, &scope, &mut facts, stage)?,
        };
        let mut out = record.clone();
        out.push_field(&serde_json::to_string(&result).map_err(|e| e.to_string())?);
        out.push_field(
            result["status"]
                .as_str()
                .expect("each stage reports status"),
        );
        writer.write_record(&out).map_err(|e| e.to_string())?;
    }
    validate_known_claims(&records, &columns, stage, &facts)?;
    validate_followon_known(&facts)?;
    Ok((
        writer.into_inner().map_err(|e| e.to_string())?,
        records.len(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reviewed_boundary_failures(registered: bool) -> Vec<String> {
        let table: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_android_behavior_boundary_cases.json"
        ))
        .unwrap();
        let mut failures = Vec::new();
        for case in table["cases"].as_array().unwrap() {
            let index = case["stage_index"].as_u64().unwrap() as usize;
            let raw = (case["raw_csv_lines"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>()
                .join("\n")
                + "\n")
                .into_bytes();
            let calculated = if registered {
                let f = fixture();
                let id = f["cases"][index]["method_setting_ids"][0].as_str().unwrap();
                super::super::adapt_literature_inputs(
                    &raw,
                    &super::super::sha256(&raw),
                    &[super::super::tests::binding(id)],
                    |_| &[],
                )
                .map(|v| v.expect("registered standalone result").csv_bytes)
            } else {
                csv(&raw, stage(index)).map(|(out, _)| out)
            };
            let name = case["name"].as_str().unwrap();
            if case["expected_refusal"] == true {
                if calculated.is_ok() {
                    failures.push(format!("{name}: contradictory input accepted"));
                }
                continue;
            }
            let out = match calculated {
                Ok(out) => out,
                Err(error) => {
                    failures.push(format!("{name}: valid input refused: {error}"));
                    continue;
                }
            };
            let mut original = csv::Reader::from_reader(raw.as_slice());
            let original_rows = original.records().collect::<Result<Vec<_>, _>>().unwrap();
            let mut reader = csv::Reader::from_reader(out.as_slice());
            let headers = reader.headers().unwrap().clone();
            let col = headers.iter().position(|h| h == OUTPUTS[0]).unwrap();
            let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(rows.len(), original_rows.len(), "{name}: row count");
            for (i, row) in rows.iter().enumerate() {
                assert_eq!(
                    row.iter().take(original_rows[i].len()).collect::<Vec<_>>(),
                    original_rows[i].iter().collect::<Vec<_>>(),
                    "{name}: literal input preservation"
                );
                let result: Value = serde_json::from_str(&row[col]).unwrap();
                for (field, expected) in case["expected_fields_per_row"][i].as_object().unwrap() {
                    let actual = &result[field];
                    let same = if actual.is_number() && expected.is_number() {
                        actual.as_f64() == expected.as_f64()
                    } else {
                        actual == expected
                    };
                    if !same {
                        failures.push(format!(
                            "{name}: row{i} {field} expected{expected} actual{actual}"
                        ));
                    }
                }
            }
        }
        failures
    }
    #[test]
    fn reviewed_boundary_table_helper() {
        assert_eq!(reviewed_boundary_failures(false), Vec::<String>::new());
    }
    #[test]
    fn reviewed_boundary_table_registered_csv() {
        assert_eq!(reviewed_boundary_failures(true), Vec::<String>::new());
    }
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_android_behavior_metrics_hand_oracle.json"
        ))
        .unwrap()
    }
    fn input(index: usize) -> Vec<u8> {
        let f = fixture();
        let lines = f["cases"][index]["raw_csv_lines"].as_array().unwrap();
        (lines
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n")
            .into_bytes()
    }
    fn stage(index: usize) -> Stage {
        [
            Stage::HushBfc,
            Stage::HushStaleness,
            Stage::JonesBacktracking,
            Stage::JonesReturn,
            Stage::CognitivePhoneHour,
            Stage::RodriguesTypingMean,
        ][index]
    }
    fn mutate(index: usize, changes: &[(&str, &str)]) -> Vec<u8> {
        let raw = input(index);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let headers = reader.headers().unwrap().clone();
        let mut rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
        for row in &mut rows {
            let values = headers
                .iter()
                .enumerate()
                .map(|(i, h)| {
                    changes
                        .iter()
                        .find(|(name, _)| *name == h)
                        .map(|(_, v)| *v)
                        .unwrap_or(&row[i])
                })
                .collect::<Vec<_>>();
            *row = csv::StringRecord::from(values);
        }
        write(&headers, &rows)
    }
    fn write(headers: &csv::StringRecord, rows: &[csv::StringRecord]) -> Vec<u8> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(headers).unwrap();
        for r in rows {
            w.write_record(r).unwrap();
        }
        w.into_inner().unwrap()
    }
    fn result(raw: &[u8], stage: Stage) -> Value {
        let (out, _) = csv(raw, stage).unwrap();
        let mut r = csv::Reader::from_reader(out.as_slice());
        let headers = r.headers().unwrap().clone();
        let col = headers.iter().position(|h| h == OUTPUTS[0]).unwrap();
        serde_json::from_str(&r.records().next().unwrap().unwrap()[col]).unwrap()
    }
    #[test]
    fn six_independent_hand_values_preserve_original_cells() {
        for i in 0..6 {
            let raw = input(i);
            let (out, count) = csv(&raw, stage(i)).unwrap();
            assert_eq!(count, 1);
            let mut original = csv::Reader::from_reader(raw.as_slice());
            let oh = original.headers().unwrap().clone();
            let first = original.records().next().unwrap().unwrap();
            let mut emitted = csv::Reader::from_reader(out.as_slice());
            let eh = emitted.headers().unwrap().clone();
            assert_eq!(
                eh.iter().take(oh.len()).collect::<Vec<_>>(),
                oh.iter().collect::<Vec<_>>()
            );
            let row = emitted.records().next().unwrap().unwrap();
            assert_eq!(
                row.iter().take(first.len()).collect::<Vec<_>>(),
                first.iter().collect::<Vec<_>>()
            );
            assert_eq!(
                serde_json::from_str::<Value>(&row[oh.len()]).unwrap(),
                fixture()["cases"][i]["expected_result_json"]
            );
        }
    }
    #[test]
    fn hush_ordered_decay_selected_parameters_missingness_and_equality() {
        let zeros=(0..4).map(|i|json!({"background_interval_id":format!("b{i}"),"following_screen_on_interval_id":format!("on{i}"),"source_order":i,"x_foreground":false,"was_suppressed":true})).collect::<Vec<_>>();
        let raw = mutate(
            0,
            &[("observations_json", &serde_json::to_string(&zeros).unwrap())],
        );
        let r = result(&raw, Stage::HushBfc);
        assert_eq!(r["static_bfc"], 0.0);
        assert_eq!(
            r["updates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v["bfc"].as_f64().unwrap())
                .collect::<Vec<_>>(),
            vec![0.25, 0.125, 0.0625, 0.03125]
        );
        assert_eq!(r["updates"][2]["suppress_using_updated_bfc"], true);
        let mut unknown = zeros;
        unknown[1]["x_foreground"] = Value::Null;
        let r = result(
            &mutate(
                0,
                &[(
                    "observations_json",
                    &serde_json::to_string(&unknown).unwrap(),
                )],
            ),
            Stage::HushBfc,
        );
        assert!(r["static_bfc"].is_null());
        assert!(r["updates"][2]["bfc"].is_null());
        assert_eq!(r["updates"][0]["bfc"], 0.25);
        assert!(
            result(&mutate(0, &[("observations_json", "[]")]), Stage::HushBfc)["static_bfc"]
                .is_null()
        );
        for changes in [
            [("beta", "")],
            [("alpha", "0.2")],
            [("sequence_origin", "arbitrary-window")],
        ] {
            assert!(csv(&mutate(0, &changes), Stage::HushBfc).is_err());
        }
        let threshold = FiniteScalarPivotClassifier::new(0.1, true, true, false).unwrap();
        assert!(*threshold.category_for(0.1).unwrap());
        assert!(!*threshold.category_for(0.10000000000000002).unwrap());
    }
    #[test]
    fn staleness_executes_minimum_then_complete_domain_mean() {
        let raw = input(1);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let h = reader.headers().unwrap().clone();
        let row = reader.records().next().unwrap().unwrap();
        let col = h
            .iter()
            .position(|h| h == "foreground_activities_json")
            .unwrap();
        let mut entries: Value = serde_json::from_str(&row[col]).unwrap();
        entries[0]["prior_background_state"] = json!("unavailable");
        entries[0]["prior_background"] = Value::Null;
        let r = result(
            &mutate(1, &[("foreground_activities_json", &entries.to_string())]),
            Stage::HushStaleness,
        );
        assert!(r["mean_staleness_coordinates"].is_null());
        assert!(r["foreground_minima"][0]["minimum_elapsed_coordinates"].is_null());
        entries[0]["prior_background_state"] = json!("absent");
        let r = result(
            &mutate(1, &[("foreground_activities_json", &entries.to_string())]),
            Stage::HushStaleness,
        );
        assert_eq!(r["mean_staleness_coordinates"], 7.5);
        entries[0]["foreground"]["clock_id"] = json!("different");
        assert!(csv(
            &mutate(1, &[("foreground_activities_json", &entries.to_string())]),
            Stage::HushStaleness
        )
        .is_err());
        assert!(result(
            &mutate(1, &[("foreground_activities_json", "[]")]),
            Stage::HushStaleness
        )["mean_staleness_coordinates"]
            .is_null());
        // Declared precision is metadata, not an epoch/modulo/alignment gate.
        assert!(csv(
            &mutate(1, &[("timestamp_precision", "3")]),
            Stage::HushStaleness
        )
        .is_ok());
    }
    #[test]
    fn jones_empty_unknown_app_distinct_sessions_and_same_app_exact_pair() {
        let r = result(
            &mutate(2, &[("launches_json", "[]")]),
            Stage::JonesBacktracking,
        );
        assert_eq!(r["sequence_length"], 0);
        assert!(r["backtracking_ratio"].is_null());
        let raw = input(2);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let h = reader.headers().unwrap().clone();
        let row = reader.records().next().unwrap().unwrap();
        let col = h.iter().position(|h| h == "launches_json").unwrap();
        let mut launches: Value = serde_json::from_str(&row[col]).unwrap();
        launches[1]["app_id"] = Value::Null;
        let r = result(
            &mutate(2, &[("launches_json", &launches.to_string())]),
            Stage::JonesBacktracking,
        );
        assert_eq!(r["sequence_length"], 5);
        assert!(r["fb_string"].is_null());
        launches[1]["source_order"] = json!(4);
        assert!(csv(
            &mutate(2, &[("launches_json", &launches.to_string())]),
            Stage::JonesBacktracking
        )
        .is_err());
        let mut a = reader_anchor(3, "previous_launch_json");
        let mut b = reader_anchor(3, "current_launch_json");
        a["coordinate"] = json!(i64::MIN);
        b["coordinate"] = json!(i64::MAX);
        let r = result(
            &mutate(
                3,
                &[
                    ("previous_launch_json", &a.to_string()),
                    ("current_launch_json", &b.to_string()),
                ],
            ),
            Stage::JonesReturn,
        );
        assert_eq!(r["elapsed_coordinates"], "18446744073709551615");
        b["app_id"] = json!("other");
        assert!(csv(
            &mutate(3, &[("current_launch_json", &b.to_string())]),
            Stage::JonesReturn
        )
        .is_err());
        let raw = input(2);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let h = reader.headers().unwrap().clone();
        let a = reader.records().next().unwrap().unwrap();
        let mut b = a.iter().map(str::to_owned).collect::<Vec<_>>();
        b[h.iter().position(|h| h == "source_row_id").unwrap()] = "second".into();
        b[h.iter().position(|h| h == "scope_id").unwrap()] = "second-session".into();
        let (out, n) = csv(
            &write(&h, &[a, csv::StringRecord::from(b)]),
            Stage::JonesBacktracking,
        )
        .unwrap();
        assert_eq!(n, 2);
        let mut r = csv::Reader::from_reader(out.as_slice());
        let h = r.headers().unwrap().clone();
        let c = h.iter().position(|h| h == OUTPUTS[0]).unwrap();
        for row in r.records() {
            assert_eq!(
                serde_json::from_str::<Value>(&row.unwrap()[c]).unwrap()["fb_string"],
                "FFFBB"
            );
        }
    }
    fn reader_anchor(index: usize, name: &str) -> Value {
        let raw = input(index);
        let mut r = csv::Reader::from_reader(raw.as_slice());
        let h = r.headers().unwrap().clone();
        let c = h.iter().position(|h| h == name).unwrap();
        serde_json::from_str(&r.records().next().unwrap().unwrap()[c]).unwrap()
    }
    #[test]
    fn phone_hour_distinct_inventories_strict_threshold_missingness_and_lexical_guard() {
        let r = result(
            &mutate(4, &[("sessions_json", "[]")]),
            Stage::CognitivePhoneHour,
        );
        assert_eq!(r["phone_session_count"], 0);
        assert_eq!(r["hourly_total_phone_duration_seconds"], 90.0);
        assert!(r["mean_phone_session_duration_seconds"].is_null());
        let r = result(
            &mutate(
                4,
                &[(
                    "sessions_json",
                    r#"[{"session_id":"s","full_session_duration_seconds":null}]"#,
                )],
            ),
            Stage::CognitivePhoneHour,
        );
        assert_eq!(r["phone_session_count"], 1);
        assert!(r["short_session_count"].is_null());
        assert!(r["mean_phone_session_duration_seconds"].is_null());
        for input in [
            r#"[{"session_id":"s","full_session_duration_seconds":-1e-400}]"#,
            r#"[{"session_id":"s","full_session_duration_seconds":"-1e-400"}]"#,
            r#"[{"session_id":"s","full_session_duration_seconds":20,"full_session_duration_seconds":0}]"#,
        ] {
            assert!(csv(
                &mutate(4, &[("sessions_json", input)]),
                Stage::CognitivePhoneHour
            )
            .is_err());
        }
        let r = result(
            &mutate(
                4,
                &[(
                    "sessions_json",
                    r#"[{"session_id":"s","full_session_duration_seconds":-0e-400}]"#,
                )],
            ),
            Stage::CognitivePhoneHour,
        );
        assert_eq!(r["short_session_count"], 1);
        let r = result(
            &mutate(
                4,
                &[
                    ("sessions_json", "[]"),
                    ("duration_contributions_json", "[]"),
                ],
            ),
            Stage::CognitivePhoneHour,
        );
        assert_eq!(r["phone_session_count"], 0);
        assert_eq!(r["hourly_total_phone_duration_seconds"], 0.0);
        assert_eq!(r["short_session_count"], 0);
    }
    #[test]
    fn typing_named_means_units_roles_and_missing_domain() {
        let raw = input(5);
        let mut reader = csv::Reader::from_reader(raw.as_slice());
        let h = reader.headers().unwrap().clone();
        let row = reader.records().next().unwrap().unwrap();
        let c = h.iter().position(|h| h == "typing_pairs_json").unwrap();
        let mut pairs: Value = serde_json::from_str(&row[c]).unwrap();
        pairs[0]["start_anchor"]["coordinate"] = Value::Null;
        let r = result(
            &mutate(5, &[("typing_pairs_json", &pairs.to_string())]),
            Stage::RodriguesTypingMean,
        );
        assert!(r["hold_mean_ms"].is_null());
        assert_eq!(r["flight_mean_ms"], 10.0);
        pairs[0]["start_anchor"]["event_role"] = json!("key_release");
        assert!(csv(
            &mutate(5, &[("typing_pairs_json", &pairs.to_string())]),
            Stage::RodriguesTypingMean
        )
        .is_err());
        let r = result(
            &mutate(5, &[("coordinate_unit", "us")]),
            Stage::RodriguesTypingMean,
        );
        assert_eq!(r["hold_mean_ms"], 0.02);
        assert_eq!(r["flight_mean_ms"], 0.01);
        assert!(result(
            &mutate(5, &[("typing_pairs_json", "[]")]),
            Stage::RodriguesTypingMean
        )["hold_mean_ms"]
            .is_null());
        let negative = r#"[{"pair_id":"f","kind":"flight","pair_stage":"caller-resolved-release-next-keypress","start_anchor":{"source_event_id":"r","key_instance_id":"k1","event_role":"key_release","clock_id":"c","coordinate":10},"end_anchor":{"source_event_id":"p","key_instance_id":"k2","event_role":"key_press","clock_id":"c","coordinate":5}}]"#;
        let r = result(
            &mutate(5, &[("typing_pairs_json", negative)]),
            Stage::RodriguesTypingMean,
        );
        assert_eq!(r["flight_mean_ms"], -5.0);
        assert!(r["hold_mean_ms"].is_null());
    }
    #[test]
    fn source_identity_consistency_never_imputes_current_missing_pair() {
        let raw = input(3);
        let mut r = csv::Reader::from_reader(raw.as_slice());
        let h = r.headers().unwrap().clone();
        let a = r.records().next().unwrap().unwrap();
        let mut b = a.iter().map(str::to_owned).collect::<Vec<_>>();
        b[h.iter().position(|h| h == "source_row_id").unwrap()] = "second".into();
        let c = h.iter().position(|h| h == "current_launch_json").unwrap();
        let mut anchor: Value = serde_json::from_str(&b[c]).unwrap();
        anchor["coordinate"] = Value::Null;
        b[c] = anchor.to_string();
        let (out, _) = csv(
            &write(&h, &[a.clone(), csv::StringRecord::from(b.clone())]),
            Stage::JonesReturn,
        )
        .unwrap();
        let mut r = csv::Reader::from_reader(out.as_slice());
        let oh = r.headers().unwrap().clone();
        let o = oh.iter().position(|h| h == OUTPUTS[0]).unwrap();
        let rows = r.records().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&rows[0][o]).unwrap()["elapsed_coordinates"],
            "7"
        );
        assert!(
            serde_json::from_str::<Value>(&rows[1][o]).unwrap()["elapsed_coordinates"].is_null()
        );
        anchor["coordinate"] = json!(9);
        b[c] = anchor.to_string();
        assert!(csv(
            &write(&h, &[a.clone(), csv::StringRecord::from(b)]),
            Stage::JonesReturn
        )
        .is_err());
        for (field, bad) in [
            ("source_stream_id", "other-stream"),
            ("participant_id", "other-participant"),
            ("coordinate_unit", "s"),
        ] {
            let mut b = a.iter().map(str::to_owned).collect::<Vec<_>>();
            b[h.iter().position(|h| h == "source_row_id").unwrap()] = "second".into();
            b[h.iter().position(|h| h == field).unwrap()] = bad.into();
            assert!(csv(
                &write(&h, &[a.clone(), csv::StringRecord::from(b)]),
                Stage::JonesReturn
            )
            .is_err());
        }
    }
    #[test]
    fn repeated_source_launch_and_full_phone_session_facts_are_consistent_across_scopes() {
        for (index, inventory_field, item_field, new_value) in [
            (2, "launches_json", "app_id", json!("different-app")),
            (
                4,
                "sessions_json",
                "full_session_duration_seconds",
                json!(11),
            ),
        ] {
            let raw = input(index);
            let mut reader = csv::Reader::from_reader(raw.as_slice());
            let h = reader.headers().unwrap().clone();
            let first = reader.records().next().unwrap().unwrap();
            let mut second = first.iter().map(str::to_owned).collect::<Vec<_>>();
            second[h.iter().position(|h| h == "source_row_id").unwrap()] = "second".into();
            second[h.iter().position(|h| h == "scope_id").unwrap()] = "different-scope".into();
            let col = h.iter().position(|h| h == inventory_field).unwrap();
            let mut inventory: Value = serde_json::from_str(&second[col]).unwrap();
            inventory[0][item_field] = new_value;
            second[col] = inventory.to_string();
            assert!(csv(
                &write(&h, &[first, csv::StringRecord::from(second)]),
                stage(index)
            )
            .is_err());
        }
    }
    #[test]
    fn registered_csv_refuses_missing_source_roles_wrong_units_clocks_and_negative_underflow() {
        let examples = [
            (0, mutate(0, &[("sequence_origin", "arbitrary-window")])),
            (1, mutate(1, &[("coordinate_unit", "unreported")])),
            (2, mutate(2, &[("input_stage", "unqualified-launches")])),
            (
                3,
                mutate(
                    3,
                    &[(
                        "current_launch_json",
                        r#"{"source_event_id":"l2","app_id":"app","event_role":"application_launch","clock_id":"other","coordinate":8}"#,
                    )],
                ),
            ),
            (
                4,
                mutate(
                    4,
                    &[(
                        "sessions_json",
                        r#"[{"session_id":"s","full_session_duration_seconds":-1e-400}]"#,
                    )],
                ),
            ),
            (5, mutate(5, &[("input_stage", "raw-key-events")])),
        ];
        let f = fixture();
        for (index, raw) in examples {
            let id = f["cases"][index]["method_setting_ids"][0].as_str().unwrap();
            let binding = super::super::tests::binding(id);
            assert!(super::super::adapt_literature_inputs(
                &raw,
                &super::super::sha256(&raw),
                &[binding],
                |_| &[]
            )
            .is_err());
        }
    }

    #[test]
    fn all_fourteen_exact_reserved_atoms_run_through_registered_csv_adapter() {
        let tuples: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_android_behavior_metrics_hand_oracle.json"
        ))
        .unwrap();
        for case in tuples["cases"].as_array().unwrap() {
            let component = case["component"].as_str().unwrap();
            let adapter = component.strip_suffix("/v1").unwrap();
            for id in case["method_setting_ids"].as_array().unwrap() {
                let binding = super::super::tests::binding(id.as_str().unwrap());
                assert_eq!(binding.adapter_id, adapter);
                let raw = (case["raw_csv_lines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("\n")
                    + "\n")
                    .into_bytes();
                let adapted = super::super::adapt_literature_inputs(
                    &raw,
                    &super::super::sha256(&raw),
                    &[binding],
                    |_| &[],
                )
                .unwrap()
                .unwrap();
                assert_eq!(adapted.receipt.source_row_count, 1);
                assert_eq!(adapted.receipt.emitted_row_count, 1);
                assert_eq!(
                    adapted.receipt.derived_result.as_ref().unwrap().kind,
                    stage_from_adapter(adapter).result_kind()
                );
                let mut reader = csv::Reader::from_reader(adapted.csv_bytes.as_slice());
                let h = reader.headers().unwrap().clone();
                let c = h.iter().position(|h| h == OUTPUTS[0]).unwrap();
                assert_eq!(
                    serde_json::from_str::<Value>(&reader.records().next().unwrap().unwrap()[c])
                        .unwrap(),
                    case["expected_result_json"]
                );
            }
        }
    }
    fn stage_from_adapter(adapter: &str) -> Stage {
        Stage::selected(&BTreeSet::from([adapter])).unwrap()
    }
    fn followon_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_android_followon_hand_oracle.json"
        ))
        .unwrap()
    }
    fn followon_csv(case: &Value) -> Vec<u8> {
        (case["raw_csv_lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n")
            .into_bytes()
    }
    fn hand_equal(actual: &Value, expected: &Value) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => {
                let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
                assert!(
                    (a - b).abs() <= 1e-13 * b.abs().max(1.0),
                    "hand numeric {a} != {b}"
                );
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len());
                for (a, b) in a.iter().zip(b) {
                    hand_equal(a, b);
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
                for (k, b) in b {
                    hand_equal(&a[k], b);
                }
            }
            _ => assert_eq!(actual, expected),
        }
    }
    fn followon_output(case: &Value, registered: bool) -> Result<Vec<u8>, String> {
        let raw = followon_csv(case);
        let adapter = case["component"]
            .as_str()
            .unwrap()
            .strip_suffix("/v1")
            .unwrap();
        if registered {
            let id = case["method_setting_ids"][0].as_str().unwrap();
            Ok(super::super::adapt_literature_inputs(
                &raw,
                &super::super::sha256(&raw),
                &[super::super::tests::binding(id)],
                |_| &[],
            )?
            .unwrap()
            .csv_bytes)
        } else {
            Ok(csv(&raw, stage_from_adapter(adapter))?.0)
        }
    }
    fn followon_hand_check(registered: bool) {
        let f = followon_fixture();
        for case in f["cases"].as_array().unwrap() {
            let raw = followon_csv(case);
            let out = followon_output(case, registered).unwrap();
            let mut original = csv::Reader::from_reader(raw.as_slice());
            let old = original.records().collect::<Result<Vec<_>, _>>().unwrap();
            let mut reader = csv::Reader::from_reader(out.as_slice());
            let h = reader.headers().unwrap().clone();
            let c = h.iter().position(|h| h == OUTPUTS[0]).unwrap();
            let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(
                rows[0].iter().take(old[0].len()).collect::<Vec<_>>(),
                old[0].iter().collect::<Vec<_>>()
            );
            hand_equal(
                &serde_json::from_str::<Value>(&rows[0][c]).unwrap(),
                &case["expected_result_json"],
            );
        }
    }
    #[test]
    fn followon_fourteen_independent_hand_values() {
        followon_hand_check(false);
    }
    #[test]
    fn followon_fifteen_source_atoms_registered_csv() {
        let f = followon_fixture();
        let mut count = 0;
        for case in f["cases"].as_array().unwrap() {
            for id in case["method_setting_ids"].as_array().unwrap() {
                let raw = followon_csv(case);
                let binding = super::super::tests::binding(id.as_str().unwrap());
                let adapted = super::super::adapt_literature_inputs(
                    &raw,
                    &super::super::sha256(&raw),
                    &[binding],
                    |_| &[],
                )
                .unwrap()
                .unwrap();
                assert_eq!(adapted.receipt.source_row_count, 1);
                assert_eq!(adapted.receipt.emitted_row_count, 1);
                count += 1;
            }
        }
        assert_eq!(count, 15);
        followon_hand_check(true);
    }
    fn followon_boundary_check(registered: bool) {
        let table: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_android_followon_boundary_cases.json"
        ))
        .unwrap();
        let f = followon_fixture();
        let mut unexpected_refusals = Vec::new();
        for case in table["cases"].as_array().unwrap() {
            let mut input = case.clone();
            let i = case["stage_index"].as_u64().unwrap() as usize;
            input["method_setting_ids"] = f["cases"][i]["method_setting_ids"].clone();
            let result = followon_output(&input, registered);
            let name = case["name"].as_str().unwrap();
            if case["expected_refusal"] == true {
                assert!(result.is_err(), "{name}: accepted");
                continue;
            }
            let out = match result {
                Ok(out) => out,
                Err(e) => {
                    unexpected_refusals.push(format!("{name}: {e}"));
                    continue;
                }
            };
            let mut reader = csv::Reader::from_reader(out.as_slice());
            let h = reader.headers().unwrap().clone();
            let c = h.iter().position(|h| h == OUTPUTS[0]).unwrap();
            let rows = reader
                .records()
                .map(|r| serde_json::from_str::<Value>(&r.unwrap()[c]).unwrap())
                .collect::<Vec<_>>();
            for expected in case["expected_values"].as_array().unwrap() {
                let row = expected["row"].as_u64().unwrap() as usize;
                hand_equal(
                    rows[row]
                        .pointer(expected["pointer"].as_str().unwrap())
                        .unwrap(),
                    &expected["value"],
                );
            }
        }
        assert!(
            unexpected_refusals.is_empty(),
            "{}",
            unexpected_refusals.join("\n")
        );
    }
    #[test]
    fn followon_source_boundary_table_helper() {
        followon_boundary_check(false);
    }
    #[test]
    fn followon_source_boundary_table_registered() {
        followon_boundary_check(true);
    }
}
