//! MessageMonitor CHI2014, DOI10.1145/2556288.2556973, printed3325/PDFp7 Table3.
//! Selected-anchor arithmetic and qualified inventory cardinality only.
//! Raw last-event selection, ties, pending lifecycle, proximity/pocket detection,
//! source clock encoding, calendar, attention labels and prediction remain unknown.

use super::{format_duration_seconds_from_ns, supplied_anchor_elapsed_nanoseconds};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const RECENCY: &str = "chronicle.message-monitor-table3-supplied-recencies";
pub(super) const COUNT: &str = "chronicle.message-monitor-table3-supplied-pending-count";
pub(super) const ADAPTERS: [&str; 2] = [RECENCY, COUNT];
pub(super) const RECENCY_FIELDS: [&str; 19] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "source_sequence_id",
    "evaluation_id",
    "feature_evaluation_role",
    "feature_name",
    "last_event_id",
    "last_event_role",
    "last_anchor_selection_stage",
    "last_timestamp",
    "evaluation_timestamp",
    "last_clock_id",
    "evaluation_clock_id",
    "last_time_unit",
    "evaluation_time_unit",
    "last_precision",
    "evaluation_precision",
];
pub(super) const COUNT_FIELDS: [&str; 14] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "source_sequence_id",
    "evaluation_id",
    "feature_evaluation_role",
    "evaluation_timestamp",
    "evaluation_clock_id",
    "evaluation_time_unit",
    "evaluation_precision",
    "pending_population_role",
    "pending_membership_stage",
    "pending_item_ids_json",
];
const RECENCY_OUT: [&str; 3] = ["recency_seconds", "timing_status", "claim_scope"];
const COUNT_OUT: [&str; 2] = ["PendingNotCount", "claim_scope"];
const SELECTED: &str = "caller-qualified-unique-last-eligible-Table3-anchor";
const COMPLETE: &str = "caller-qualified-complete-Table3-PendingNotCount-inventory";
const POPULATION: &str = "Table3-unveiled-notifications";
const RECENCY_CLAIM: &str =
    "supplied_Table3_last_anchor_arithmetic_not_history_ties_detector_or_original_clock_encoding";
const COUNT_CLAIM: &str = "supplied_Table3_unveiled_inventory_cardinality_audit_unviewed_interpretation_not_raw_pending_lifecycle";

type Scope = [String; 5]; // Literal participant/device/stream/sequence/evaluation.
type EventKey = [String; 5]; // Literal participant/device/stream/sequence/event.
#[derive(Clone, Default)]
struct Coordinate {
    timestamp: Option<i64>,
    clock: Option<String>,
    unit: Option<String>,
    precision: Option<u64>,
}
fn unit_scale(unit: &str) -> Result<i128, String> {
    match unit {
        "ns" => Ok(1),
        "us" => Ok(1_000),
        "ms" => Ok(1_000_000),
        "s" => Ok(1_000_000_000),
        _ => Err("explicit carrier unit must be ns/us/ms/s".into()),
    }
}
fn coordinate(
    timestamp: &str,
    clock: &str,
    unit: &str,
    precision: &str,
) -> Result<Coordinate, String> {
    let timestamp = if timestamp.is_empty() {
        None
    } else {
        Some(
            timestamp
                .parse::<i64>()
                .map_err(|_| "typed coordinate requires signed i64 integer")?,
        )
    };
    let precision = if precision.is_empty() {
        None
    } else {
        Some(
            precision
                .parse::<u64>()
                .map_err(|_| "precision requires positive integer metadata")?,
        )
    };
    if precision == Some(0) {
        return Err("precision requires positive integer metadata".into());
    }
    if !unit.is_empty() {
        unit_scale(unit)?;
    }
    Ok(Coordinate {
        timestamp,
        precision,
        clock: (!clock.is_empty()).then(|| clock.into()),
        unit: (!unit.is_empty()).then(|| unit.into()),
    })
}
fn merge<T: Clone + Eq>(prior: &mut Option<T>, next: &Option<T>) -> Result<(), String> {
    if matches!((&*prior, next), (Some(a), Some(b)) if a != b) {
        return Err("contradictory known Table3 coordinate facts".into());
    }
    if prior.is_none() {
        *prior = next.clone();
    }
    Ok(())
}
impl Coordinate {
    fn merge(&mut self, next: &Self) -> Result<(), String> {
        merge(&mut self.timestamp, &next.timestamp)?;
        merge(&mut self.clock, &next.clock)?;
        merge(&mut self.unit, &next.unit)?;
        merge(&mut self.precision, &next.precision)
    }
}
fn delta(start: &Coordinate, end: &Coordinate) -> Result<(Option<i128>, &'static str), String> {
    let reason = if start.clock.is_none() || end.clock.is_none() {
        "unavailable:missing_clock_id"
    } else if start.clock != end.clock {
        "unavailable:incompatible_clock_ids"
    } else if start.unit.is_none() || end.unit.is_none() {
        "unavailable:missing_coordinate_unit"
    } else if start.unit != end.unit {
        "unavailable:incompatible_coordinate_units"
    } else if start.precision.is_none() || end.precision.is_none() {
        "unavailable:missing_precision_metadata"
    } else if start.timestamp.is_none() || end.timestamp.is_none() {
        "unavailable:missing_timestamp"
    } else {
        "computed_supplied_Table3_anchor_arithmetic"
    };
    if reason.starts_with("unavailable:") {
        return Ok((None, reason));
    }
    let ns = supplied_anchor_elapsed_nanoseconds(start.timestamp.unwrap(), end.timestamp.unwrap())
        * unit_scale(start.unit.as_deref().unwrap())?;
    Ok((Some(ns), reason))
}
fn eligible(feature: &str, role: &str) -> Result<bool, String> {
    Ok(match feature {
        "TimeSinceLastNotSec" => role == "notification_received",
        "TimeSinceLastViewed" => role == "notification_viewed_proxy",
        "TimeSinceLastScreenOnOff" => matches!(role, "screen_on" | "screen_off"),
        "TimeSinceLastScreenOn" => role == "screen_on",
        "TimeSinceLastScreenOff" => role == "screen_off",
        "TimeSinceCoverChangedEvent" => matches!(
            role,
            "proximity_state_changed" | "proximity_covered" | "proximity_uncovered"
        ),
        "TimeSinceLastScreenCovered" => role == "proximity_covered",
        "TimeSinceLastScreenUnCovered" => role == "proximity_uncovered",
        _ => return Err("unknown named Table3 recency".into()),
    })
}
#[derive(Default)]
struct SuppliedDeclarations {
    evaluations: BTreeMap<Scope, Coordinate>,
    events: BTreeMap<EventKey, (String, Coordinate)>,
    selected: BTreeMap<(Scope, String), EventKey>,
    inventories: BTreeMap<(Scope, String), BTreeSet<String>>,
}
impl SuppliedDeclarations {
    fn evaluation(&mut self, scope: &Scope, value: &Coordinate) -> Result<(), String> {
        self.evaluations
            .entry(scope.clone())
            .or_default()
            .merge(value)
    }
    fn last(
        &mut self,
        scope: &Scope,
        feature: &str,
        id: &str,
        role: &str,
        value: &Coordinate,
    ) -> Result<(), String> {
        let key: EventKey =
            std::array::from_fn(|i| if i == 4 { id.into() } else { scope[i].clone() });
        if let Some((prior_role, prior)) = self.events.get_mut(&key) {
            if prior_role != role {
                return Err("contradictory known Table3 event role".into());
            }
            prior.merge(value)?;
        } else {
            self.events
                .insert(key.clone(), (role.into(), value.clone()));
        }
        let selection = (scope.clone(), feature.into());
        if self
            .selected
            .get(&selection)
            .is_some_and(|prior| prior != &key)
        {
            return Err("contradictory supplied unique-last selection".into());
        }
        self.selected.insert(selection, key);
        Ok(())
    }
    fn validate(&self) -> Result<(), String> {
        for ((scope, feature), key) in &self.selected {
            let last = &self.events[key].1;
            let evaluation = &self.evaluations[scope];
            if delta(last, evaluation)?.0.is_some_and(|ns| ns < 0) {
                return Err("known last anchor follows Table3 feature evaluation".into());
            }
            // An explicitly known eligible event can contradict another supplied
            // evaluation's last claim under the same literal owner. Strict interior
            // only: do not choose a replacement, infer history or equal-time order.
            let first: EventKey = std::array::from_fn(|i| {
                if i == 4 {
                    String::new()
                } else {
                    scope[i].clone()
                }
            });
            for (_, (role, candidate)) in self
                .events
                .range(first..)
                .take_while(|(other, _)| other[..4] == scope[..4])
            {
                if eligible(feature, role)?
                    && delta(last, candidate)?.0.is_some_and(|ns| ns > 0)
                    && delta(candidate, evaluation)?.0.is_some_and(|ns| ns > 0)
                {
                    return Err(
                        "known supplied later eligible anchor contradicts unique-last declaration"
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }
}
pub(super) fn execute_csv(
    raw: &[u8],
    adapter: &str,
) -> Result<(Vec<u8>, usize, &'static str), String> {
    let (fields, outputs, kind): (&[&str], &[&str], _) = match adapter {
        RECENCY => (
            &RECENCY_FIELDS,
            &RECENCY_OUT,
            "literature-message-monitor-table3-recencies-csv",
        ),
        COUNT => (
            &COUNT_FIELDS,
            &COUNT_OUT,
            "literature-message-monitor-table3-pending-count-csv",
        ),
        _ => return Err("unregistered Table3 adapter".into()),
    };
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let mut header = reader.headers().map_err(|e| e.to_string())?.clone();
    if header.iter().collect::<BTreeSet<_>>().len() != header.len() {
        return Err("requires unique Table3 input column names".into());
    }
    if outputs.iter().any(|name| header.iter().any(|h| h == *name)) {
        return Err("refuses supplied Table3 computed output columns".into());
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
    let mut declarations = SuppliedDeclarations::default();
    for row in &rows {
        let v = |i: usize| &row[columns[i]];
        if (0..=5).any(|i| v(i).is_empty()) || v(6) != "caller-supplied-feature-evaluation" {
            return Err(
                "requires literal ownership/evaluation and qualified evaluation role".into(),
            );
        }
        let scope: Scope = std::array::from_fn(|i| v(i + 1).into());
        let result = if adapter == RECENCY {
            eligible(v(7), "")?;
            let evaluation = coordinate(v(12), v(14), v(16), v(18))?;
            declarations.evaluation(&scope, &evaluation)?;
            let (ns, status) = if v(10) == "not_supplied" {
                if [8, 9, 11, 13, 15, 17].iter().any(|i| !v(*i).is_empty()) {
                    return Err("absent last anchor cannot contain claimed event facts".into());
                }
                (None, "unavailable:last_anchor_not_supplied")
            } else {
                if v(10) != SELECTED || v(8).is_empty() || !eligible(v(7), v(9))? {
                    return Err("requires caller-qualified eligible unique-last anchor role".into());
                }
                let last = coordinate(v(11), v(13), v(15), v(17))?;
                declarations.last(&scope, v(7), v(8), v(9), &last)?;
                let result = delta(&last, &evaluation)?;
                if result.0.is_some_and(|ns| ns < 0) {
                    return Err("known last anchor follows Table3 feature evaluation".into());
                }
                result
            };
            vec![
                ns.map(format_duration_seconds_from_ns).unwrap_or_default(),
                status.into(),
                RECENCY_CLAIM.into(),
            ]
        } else {
            let evaluation = coordinate(v(7), v(8), v(9), v(10))?;
            declarations.evaluation(&scope, &evaluation)?;
            if v(11) != POPULATION || v(12) != COMPLETE {
                return Err("requires complete caller-qualified Table3 unveiled inventory, not a raw pending classifier".into());
            }
            let ids: Vec<String> = serde_json::from_str(v(13))
                .map_err(|e| format!("typed pending identity inventory: {e}"))?;
            if ids.iter().any(String::is_empty) {
                return Err("requires nonempty literal pending item identities".into());
            }
            let members = ids.iter().cloned().collect::<BTreeSet<_>>();
            let key = (scope, v(11).to_owned());
            if declarations
                .inventories
                .get(&key)
                .is_some_and(|prior| prior != &members)
            {
                return Err("contradictory complete Table3 inventory declarations".into());
            }
            declarations.inventories.insert(key, members);
            let count = crate::grouped_distinct_count::count_distinct_members_by_group(
                ids.iter().map(|id| ((), id)),
            )
            .first()
            .map(|group| group.distinct_member_count)
            .unwrap_or(0);
            // Zero requires a supplied COMPLETE empty inventory, not missing input.
            vec![count.to_string(), COUNT_CLAIM.into()]
        };
        let mut out = row.clone();
        out.extend(result.iter().map(String::as_str));
        writer.write_record(&out).map_err(|e| e.to_string())?;
    }
    declarations.validate()?; // Known-fact refusal only; never impute row-local outputs.
    Ok((
        writer.into_inner().map_err(|e| e.to_string())?,
        rows.len(),
        kind,
    ))
}

#[cfg(test)]
#[path = "message_monitor_table3_conformance.rs"]
mod tests;
