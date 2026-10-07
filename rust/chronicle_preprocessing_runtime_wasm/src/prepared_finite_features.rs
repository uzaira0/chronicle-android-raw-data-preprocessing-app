//! Prepared finite scalar and occurrence reductions from five retained papers.
//! Memberships, source-local stages, units and complete inventories are caller
//! qualifications, never raw joins, lag/window constructors or model policies.

use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_distinct_count::count_distinct_members_by_group;
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use crate::keyboard_stress_axis_statistics::{AxisStatistic, AxisStatisticsCsv};
use crate::prepared_scalar_axis::prepared_mean_only;
use std::collections::{BTreeMap, BTreeSet};

/// DOI:10.1016/j.pmcj.2017.01.011 p6/485 and Table2 p8/487.
/// Only finite supplied feature readings. Categorical encodings, unknown null
/// policy and the raw interruption/decision joins are deliberately not supplied.
pub(crate) fn prepare_reachable_means_csv(
    input: &[u8],
    between: bool,
) -> Result<AxisStatisticsCsv, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|e| format!("Reachable header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Reachable refuses duplicate columns".into());
    }
    let field = |name| {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| format!("Reachable requires {name}"))
    };
    let fields = [
        "participant_id",
        "interruption_id",
        "use_state",
        "stage",
        "outcome",
        "feature_stream",
        "sample_id",
        "sample_order",
        "value",
        "input_unit",
        "inventory_complete",
    ];
    let positions = fields
        .iter()
        .map(|name| field(*name))
        .collect::<Result<Vec<_>, _>>()?;
    type Scope = (String, String, String, String, String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut use_states = BTreeMap::<(String, String), String>::new();
    let mut groups = Vec::<(Scope, String, Vec<(u64, f64)>)>::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut source_row_count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| format!("Reachable row: {e}"))?;
        let r = positions.iter().map(|i| &row[*i]).collect::<Vec<_>>();
        if r.iter().any(|x| x.trim().is_empty()) || r[10] != "true" {
            return Err(
                "Reachable requires nonblank fields and a caller-qualified complete inventory"
                    .into(),
            );
        }
        let cell = (r[2], r[3], r[4]);
        let allowed = if between {
            matches!(
                cell,
                ("not_in_use", "I-D1", "Rc" | "Eg" | "Rv")
                    | ("not_in_use", "D1-D2", "Eg" | "Rv")
                    | ("not_in_use", "D2-D3", "Rv")
                    | ("in_use", "I-D3", "Rv")
            )
        } else {
            matches!(cell, ("in_use" | "not_in_use", "pre_interruption", "none"))
        };
        if !allowed {
            return Err("Reachable requires its exact supplied pre-interruption or Table2 stage/outcome cell".into());
        }
        let use_state = use_states
            .entry((r[0].to_owned(), r[1].to_owned()))
            .or_insert_with(|| r[2].to_owned());
        if use_state != r[2] {
            return Err("Reachable requires one use_state per lexical participant/interruption".into());
        }
        let value = r[8].parse::<f64>().ok().filter(|x| x.is_finite()).ok_or("Reachable requires finite supplied numeric readings; no null/categorical policy is inferred")?;
        let order = r[7]
            .parse::<u64>()
            .map_err(|_| "Reachable requires unsigned sample_order")?;
        let scope = (
            r[0].into(),
            r[1].into(),
            r[2].into(),
            r[3].into(),
            r[4].into(),
            r[5].into(),
        );
        if !ids.insert((scope.clone(), r[6].to_owned())) || !orders.insert((scope.clone(), order)) {
            return Err("Reachable refuses duplicate scoped sample identity/order".into());
        }
        let next = groups.len();
        let index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope, r[9].into(), Vec::new()));
            next
        });
        if groups[index].1 != r[9] {
            return Err(
                "Reachable requires unchanged lexical units within each supplied feature cell"
                    .into(),
            );
        }
        groups[index].2.push((order, value));
        source_row_count += 1;
    }
    if groups.is_empty() {
        return Err("Reachable requires nonempty supplied readings".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "interruption_id",
            "use_state",
            "stage",
            "outcome",
            "feature_stream",
            "input_unit",
            "sample_count",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    for (scope, unit, samples) in &mut groups {
        samples.sort_by_key(|x| x.0);
        let values = samples.iter().map(|x| x.1).collect::<Vec<_>>();
        let mean = prepared_mean_only(&values)?;
        writer
            .serialize((
                &scope.0,
                &scope.1,
                &scope.2,
                &scope.3,
                &scope.4,
                &scope.5,
                unit,
                values.len(),
                mean.statistic,
                mean.value,
                mean.status,
                mean.reason,
                mean.output_unit_relation,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count: groups.len(),
    })
}

/// Moodable DOI:10.1016/j.smhl.2020.100118 Eq1-3 p6. Each supplied
/// prediction/metric has exactly14 feature slots, each with14 or5 lag values.
/// Slot/lag indices qualify an already resolved vector; they create no dates.
pub(crate) fn prepare_moodable_slots_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let metrics = [
        "call_frequency",
        "incoming_text_sentiment",
        "incoming_text_frequency",
    ];
    if selected.is_empty() || selected.iter().any(|x| !metrics.contains(x)) {
        return Err("Moodable requires exact Eq1-3 metrics".into());
    }
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Moodable refuses duplicate columns".into());
    }
    let fields = [
        "participant_id",
        "prediction_id",
        "metric",
        "slot_index",
        "lag_index",
        "sample_id",
        "value",
        "input_unit",
        "inventory_complete",
    ];
    let positions = fields
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("Moodable requires {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    type Scope = (String, String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, String, BTreeMap<u8, BTreeMap<u8, f64>>)>::new();
    let mut ids = BTreeSet::new();
    let mut source_row_count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let r = positions.iter().map(|i| &row[*i]).collect::<Vec<_>>();
        if r.iter().any(|x| x.trim().is_empty()) || r[8] != "true" || !metrics.contains(&r[2]) {
            return Err("Moodable requires complete finite supplied Eq1-3 slot memberships".into());
        }
        let slot = r[3]
            .parse::<u8>()
            .ok()
            .filter(|x| (1..=14).contains(x))
            .ok_or("Moodable requires slot_index1..14")?;
        let n = if r[2] == "call_frequency" { 14 } else { 5 };
        let lag = r[4]
            .parse::<u8>()
            .ok()
            .filter(|x| (1..=n).contains(x))
            .ok_or("Moodable lag_index must match Eq1=14 or Eq2-3=5")?;
        let value = r[6]
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite())
            .ok_or("Moodable requires finite supplied lag values")?;
        if r[2] != "incoming_text_sentiment" && value < 0.0 {
            return Err(
                "Moodable supplied frequencies must be nonnegative; sentiment remains signed"
                    .into(),
            );
        }
        let scope = (r[0].into(), r[1].into(), r[2].into());
        if !ids.insert((scope.clone(), slot, r[5].to_owned())) {
            return Err("Moodable refuses duplicate sample identity within a slot".into());
        }
        let next = groups.len();
        let index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope, r[7].into(), BTreeMap::new()));
            next
        });
        if groups[index].1 != r[7] {
            return Err(
                "Moodable preserves one lexical unit per supplied prediction/metric".into(),
            );
        }
        if groups[index]
            .2
            .entry(slot)
            .or_default()
            .insert(lag, value)
            .is_some()
        {
            return Err("Moodable refuses duplicate slot/lag membership".into());
        }
        source_row_count += 1;
    }
    let predictions = groups
        .iter()
        .map(|g| (&g.0 .0, &g.0 .1))
        .collect::<BTreeSet<_>>();
    if groups.is_empty()
        || predictions.iter().any(|(participant, prediction)| {
            selected.iter().any(|metric| {
                !groups
                    .iter()
                    .any(|g| &g.0 .0 == *participant && &g.0 .1 == *prediction && g.0 .2 == *metric)
            })
        })
    {
        return Err("Moodable requires every selected metric for each supplied participant/prediction inventory".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "prediction_id",
            "metric",
            "slot_index",
            "input_unit",
            "lag_count",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut output_row_count = 0;
    for (scope, unit, slots) in groups {
        let n = if scope.2 == "call_frequency" { 14 } else { 5 };
        if slots.len() != 14 || slots.values().any(|lags| lags.len() != n) {
            return Err("Moodable requires all14 supplied slots and all14 or5 lag values per slot; no partial vector/imputation".into());
        }
        if !selected.contains(scope.2.as_str()) {
            continue;
        }
        for (slot, lags) in slots {
            let values = lags.values().copied().collect::<Vec<_>>();
            let mean = prepared_mean_only(&values)?;
            writer
                .serialize((
                    &scope.0,
                    &scope.1,
                    &scope.2,
                    slot,
                    &unit,
                    n,
                    mean.value,
                    mean.status,
                    mean.reason,
                    mean.output_unit_relation,
                ))
                .map_err(|e| e.to_string())?;
            output_row_count += 1;
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count,
    })
}

/// Murnane DOI:10.1145/2935334.2935383 p7: supplied eligible sessions,
/// used-app observations and qualified switch occurrences in supplied T.
/// A window manifest qualifies complete inventory, including explicit zero
/// counts. No unlock/session closer, clipping, categories or switch detection.
pub(crate) fn prepare_alertness_inventory_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let allowed = [
        "session_duration_mean",
        "distinct_app_diversity",
        "switch_occurrence_count",
    ];
    if selected.is_empty() || selected.iter().any(|x| !allowed.contains(x)) {
        return Err("Alertness requires its exact three prepared reductions".into());
    }
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Alertness refuses duplicate columns".into());
    }
    let fields = [
        "participant_id",
        "window_id",
        "record_kind",
        "source_row_id",
        "row_order",
        "duration_seconds",
        "app_id",
        "input_unit",
        "inventory_complete",
    ];
    let positions = fields
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("Alertness requires {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    type Scope = (String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, String, bool, Vec<(u64, f64)>, Vec<String>, Vec<u64>)>::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut source_row_count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let r = positions.iter().map(|i| &row[*i]).collect::<Vec<_>>();
        if [0, 1, 2, 3, 4, 7, 8]
            .iter()
            .any(|i| r[*i].trim().is_empty())
            || r[8] != "true"
        {
            return Err("Alertness requires lexical identities, units and caller-qualified complete inventories".into());
        }
        let order = r[4]
            .parse::<u64>()
            .map_err(|_| "Alertness requires unsigned row_order")?;
        let scope = (r[0].into(), r[1].into());
        if !ids.insert((scope.clone(), r[3].to_owned())) || !orders.insert((scope.clone(), order)) {
            return Err("Alertness refuses duplicate scoped occurrence identity/order".into());
        }
        let next = groups.len();
        let index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((
                scope,
                r[7].into(),
                false,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ));
            next
        });
        let group = &mut groups[index];
        if group.1 != r[7] {
            return Err("Alertness preserves one lexical duration unit per supplied T".into());
        }
        match r[2] {
            "window" if r[5].is_empty() && r[6].is_empty() && !group.2 => group.2 = true,
            "session" if r[6].is_empty() => {
                let value = r[5].parse::<f64>().ok().filter(|x| x.is_finite() && *x >= 0.0).ok_or("Alertness requires finite nonnegative supplied eligible session duration_seconds")?;
                group.3.push((order, value));
            }
            "app_use" if r[5].is_empty() && !r[6].trim().is_empty() => group.4.push(r[6].into()),
            "switch" if r[5].is_empty() && r[6].is_empty() => group.5.push(order),
            _ => return Err("Alertness requires one window manifest and typed eligible session/app-use/switch observations, without cross-kind fields".into()),
        }
        source_row_count += 1;
    }
    if groups.is_empty() || groups.iter().any(|g| !g.2) {
        return Err(
            "Alertness requires one complete window inventory manifest per supplied T".into(),
        );
    }
    let distinct = count_distinct_members_by_group(
        groups
            .iter()
            .enumerate()
            .flat_map(|(i, g)| g.4.iter().map(move |app| (i, app))),
    )
    .into_iter()
    .map(|x| (x.group, x.distinct_member_count))
    .collect::<BTreeMap<_, _>>();
    let switches = count_categories_by_group(
        groups
            .iter()
            .enumerate()
            .flat_map(|(i, g)| g.5.iter().map(move |_| (i, ()))),
    )
    .into_iter()
    .map(|x| (x.group, x.observation_count))
    .collect::<BTreeMap<_, _>>();
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "window_id",
            "input_unit",
            "statistic",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut output_row_count = 0;
    for (index, (scope, unit, _, mut sessions, _, _)) in groups.into_iter().enumerate() {
        sessions.sort_by_key(|x| x.0);
        let mean = if sessions.is_empty() {
            AxisStatistic::unavailable(
                "session_duration_mean",
                "source_undefined",
                "empty_session_mean_not_disclosed",
                "seconds_per_session",
            )
        } else {
            let mean = prepared_mean_only(&sessions.iter().map(|x| x.1).collect::<Vec<_>>())?;
            AxisStatistic {
                statistic: "session_duration_mean",
                output_unit_relation: "seconds_per_session",
                ..mean
            }
        };
        if selected.contains(mean.statistic) {
            writer
                .serialize((
                    &scope.0,
                    &scope.1,
                    &unit,
                    mean.statistic,
                    mean.value,
                    mean.status,
                    mean.reason,
                    mean.output_unit_relation,
                ))
                .map_err(|e| e.to_string())?;
            output_row_count += 1;
        }
        for (statistic, count, relation) in [
            (
                "distinct_app_diversity",
                *distinct.get(&index).unwrap_or(&0),
                "distinct_apps",
            ),
            (
                "switch_occurrence_count",
                *switches.get(&index).unwrap_or(&0),
                "switch_occurrences",
            ),
        ] {
            if !selected.contains(statistic) {
                continue;
            }
            writer
                .serialize((
                    &scope.0, &scope.1, &unit, statistic, count, "computed", "", relation,
                ))
                .map_err(|e| e.to_string())?;
            output_row_count += 1;
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count,
    })
}

/// Screen-text DOI:10.1145/3613904.3642347 p4 §3.2-3.3. Count saved
/// screens and phrase occurrences per screen. Repeated text is NOT deduplicated;
/// source set-difference semantics belong only to the separate churn measure.
pub(crate) fn prepare_screen_density_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let allowed = ["screen_update_count", "phrase_occurrence_density"];
    if selected.is_empty() || selected.iter().any(|x| !allowed.contains(x)) {
        return Err(
            "Screen density requires saved-screen count or per-screen phrase occurrence count"
                .into(),
        );
    }
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Screen density refuses duplicate columns".into());
    }
    let fields = [
        "participant_id",
        "inventory_id",
        "record_kind",
        "screen_id",
        "screen_order",
        "phrase_occurrence_id",
        "inventory_complete",
    ];
    let positions = fields
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("Screen density requires {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    type Scope = (String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, bool, BTreeMap<String, (u64, bool, Vec<String>)>)>::new();
    let mut phrase_ids = BTreeSet::new();
    let mut screen_orders = BTreeSet::new();
    let mut source_row_count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let r = positions.iter().map(|i| &row[*i]).collect::<Vec<_>>();
        if [0, 1, 2, 6].iter().any(|i| r[*i].trim().is_empty()) || r[6] != "true" {
            return Err("Screen density requires lexical identities and caller-qualified complete saved-screen/phrase inventory".into());
        }
        let scope = (r[0].into(), r[1].into());
        let next = groups.len();
        let index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope.clone(), false, BTreeMap::new()));
            next
        });
        let group = &mut groups[index];
        if r[2] == "inventory" {
            if group.1 || !r[3].is_empty() || !r[4].is_empty() || !r[5].is_empty() {
                return Err("Screen density requires one unambiguous inventory manifest".into());
            }
            group.1 = true;
        } else {
            if r[3].trim().is_empty() || !matches!(r[2], "screen" | "phrase") {
                return Err("Screen density requires typed saved screen/phrase occurrences".into());
            }
            let order = r[4]
                .parse::<u64>()
                .map_err(|_| "Screen density requires unsigned screen_order")?;
            let screen = group
                .2
                .entry(r[3].into())
                .or_insert((order, false, Vec::new()));
            if screen.0 != order {
                return Err(
                    "Screen density refuses inconsistent order for one saved screen".into(),
                );
            }
            if r[2] == "screen" {
                if screen.1 || !r[5].is_empty() || !screen_orders.insert((scope, order)) {
                    return Err("Screen density refuses duplicate saved screen/order or phrase field on screen record".into());
                }
                screen.1 = true;
            } else {
                if r[5].trim().is_empty()
                    || !phrase_ids.insert((scope, r[3].to_owned(), r[5].to_owned()))
                {
                    return Err(
                        "Screen density refuses blank/duplicate scoped phrase occurrence identity"
                            .into(),
                    );
                }
                screen.2.push(r[5].into());
            }
        }
        source_row_count += 1;
    }
    if groups.is_empty() || groups.iter().any(|g| !g.1 || g.2.values().any(|s| !s.1)) {
        return Err("Screen density requires complete manifests and a declared saved screen for every phrase".into());
    }
    let updates = count_categories_by_group(
        groups
            .iter()
            .enumerate()
            .flat_map(|(i, g)| g.2.values().map(move |_| (i, ()))),
    )
    .into_iter()
    .map(|x| (x.group, x.observation_count))
    .collect::<BTreeMap<_, _>>();
    let phrases = count_categories_by_group(groups.iter().enumerate().flat_map(|(i, g)| {
        g.2.iter()
            .flat_map(move |(screen, data)| data.2.iter().map(move |_| ((i, screen.clone()), ())))
    }))
    .into_iter()
    .map(|x| (x.group, x.observation_count))
    .collect::<BTreeMap<_, _>>();
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "inventory_id",
            "statistic",
            "screen_id",
            "screen_order",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut output_row_count = 0;
    for (index, (scope, _, screens)) in groups.into_iter().enumerate() {
        if selected.contains("screen_update_count") {
            writer
                .serialize((
                    &scope.0,
                    &scope.1,
                    "screen_update_count",
                    "",
                    "",
                    *updates.get(&index).unwrap_or(&0),
                    "computed",
                    "",
                    "saved_screen_occurrences",
                ))
                .map_err(|e| e.to_string())?;
            output_row_count += 1;
        }
        if selected.contains("phrase_occurrence_density") {
            let mut screens = screens.into_iter().collect::<Vec<_>>();
            screens.sort_by_key(|(_, data)| data.0);
            for (screen, data) in screens {
                writer
                    .serialize((
                        &scope.0,
                        &scope.1,
                        "phrase_occurrence_density",
                        &screen,
                        data.0,
                        *phrases.get(&(index, screen.clone())).unwrap_or(&0),
                        "computed",
                        "",
                        "phrase_occurrences_per_screen",
                    ))
                    .map_err(|e| e.to_string())?;
                output_row_count += 1;
            }
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count,
    })
}

/// Silencer DOI:10.1145/2632048.2632060 p2. Finite scalar samples in
/// supplied first-two-second/post-calibration stages; no magnitude/timer/mute.
pub(crate) fn prepare_silencer_csv(
    input: &[u8],
    selected: &BTreeSet<&str>,
) -> Result<AxisStatisticsCsv, String> {
    let allowed = [
        "calibration_maximum",
        "calibration_threshold",
        "strict_exceedance",
    ];
    if selected.is_empty() || selected.iter().any(|x| !allowed.contains(x)) {
        return Err("Silencer requires its narrow maximum/threshold/comparison".into());
    }
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Silencer refuses duplicate columns".into());
    }
    let fields = [
        "participant_id",
        "call_id",
        "scalar_stream",
        "stage",
        "sample_id",
        "sample_order",
        "value",
        "input_unit",
        "calibration_duration_seconds",
        "inventory_complete",
    ];
    let positions = fields
        .iter()
        .map(|name| {
            headers
                .iter()
                .position(|h| h == *name)
                .ok_or_else(|| format!("Silencer requires {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    type Scope = (String, String, String);
    let mut indices = BTreeMap::<Scope, usize>::new();
    let mut groups = Vec::<(Scope, String, Vec<(u64, String, f64, bool)>)>::new();
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut source_row_count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let r = positions.iter().map(|i| &row[*i]).collect::<Vec<_>>();
        if r.iter().any(|x| x.trim().is_empty())
            || r[9] != "true"
            || r[8].parse::<f64>().ok() != Some(2.0)
            || !matches!(r[3], "calibration" | "post_calibration")
        {
            return Err(
                "Silencer requires complete supplied first-two-second and post-calibration stages"
                    .into(),
            );
        }
        let value = r[6]
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite())
            .ok_or("Silencer requires finite supplied scalar acceleration")?;
        let order = r[5]
            .parse::<u64>()
            .map_err(|_| "Silencer requires unsigned sample_order")?;
        let scope = (r[0].into(), r[1].into(), r[2].into());
        if !ids.insert((scope.clone(), r[4].to_owned())) || !orders.insert((scope.clone(), order)) {
            return Err("Silencer refuses duplicate call/stream sample identity/order".into());
        }
        let next = groups.len();
        let index = *indices.entry(scope.clone()).or_insert_with(|| {
            groups.push((scope, r[7].into(), Vec::new()));
            next
        });
        if groups[index].1 != r[7] {
            return Err("Silencer requires unchanged lexical scalar units per call/stream".into());
        }
        groups[index]
            .2
            .push((order, r[4].into(), value, r[3] == "calibration"));
        source_row_count += 1;
    }
    if groups.is_empty() {
        return Err("Silencer requires supplied samples".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "call_id",
            "scalar_stream",
            "input_unit",
            "statistic",
            "sample_id",
            "sample_order",
            "value",
            "status",
            "reason",
            "output_unit_relation",
        ])
        .map_err(|e| e.to_string())?;
    let mut output_row_count = 0;
    for (scope, unit, mut samples) in groups {
        samples.sort_by_key(|x| x.0);
        let calibration = samples.iter().filter(|x| x.3).collect::<Vec<_>>();
        let last = calibration
            .last()
            .ok_or("Silencer requires nonempty supplied calibration samples")?
            .0;
        if samples.iter().any(|x| !x.3 && x.0 <= last) {
            return Err(
                "Silencer supplied order contradicts calibration preceding later samples".into(),
            );
        }
        let maximum = finite_scalar_extrema_by_group(calibration.iter().map(|x| ((), x.2)))
            .map_err(|_| "Silencer scalar maximum unavailable")?[0]
            .maximum;
        let threshold =
            AxisStatistic::computed("calibration_threshold", maximum * 1.5, "input_unit");
        for result in [
            AxisStatistic::computed("calibration_maximum", maximum, "input_unit"),
            threshold,
        ] {
            if !selected.contains(result.statistic) {
                continue;
            }
            writer
                .serialize((
                    &scope.0,
                    &scope.1,
                    &scope.2,
                    &unit,
                    result.statistic,
                    "",
                    "",
                    result.value.map(|x| x.to_string()).unwrap_or_default(),
                    result.status,
                    result.reason,
                    result.output_unit_relation,
                ))
                .map_err(|e| e.to_string())?;
            output_row_count += 1;
        }
        if selected.contains("strict_exceedance") {
            let threshold = maximum * 1.5;
            for (order, id, value, _) in samples.iter().filter(|x| !x.3) {
                let computed = threshold.is_finite();
                writer
                    .serialize((
                        &scope.0,
                        &scope.1,
                        &scope.2,
                        &unit,
                        "strict_exceedance",
                        id,
                        order,
                        if computed {
                            (value > &threshold).to_string()
                        } else {
                            String::new()
                        },
                        if computed {
                            "computed"
                        } else {
                            "arithmetic_unavailable"
                        },
                        if computed {
                            ""
                        } else {
                            "calibration_threshold_unavailable"
                        },
                        "boolean",
                    ))
                    .map_err(|e| e.to_string())?;
                output_row_count += 1;
            }
        }
    }
    Ok(AxisStatisticsCsv {
        bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count,
        output_row_count,
    })
}
