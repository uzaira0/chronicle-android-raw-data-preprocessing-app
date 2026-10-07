//! Sparse app-transition and co-occurrence matrices over ordered launch rows.
//!
//! Hour/day assignment is caller-owned. Policies that a source does not disclose
//! must remain `Undisclosed`; materialization then fails instead of guessing.

use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagonalPolicy {
    Include,
    Exclude,
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbabilityNormalization {
    RowTotal,
    AllOccurrences,
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairOrientation {
    Symmetric,
    SourceOrdered,
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CooccurrenceMultiplicity {
    AllLaunchPairs,
    DistinctAppsPerScope,
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CooccurrenceConfiguration {
    pub pair_orientation: PairOrientation,
    pub multiplicity: CooccurrenceMultiplicity,
    pub diagonal_policy: DiagonalPolicy,
    pub probability_normalization: ProbabilityNormalization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub transition_diagonal_policy: DiagonalPolicy,
    pub transition_probability_normalization: ProbabilityNormalization,
    pub same_hour: CooccurrenceConfiguration,
    pub same_day: CooccurrenceConfiguration,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderedAppLaunch {
    pub entity_id: String,
    pub app_id: String,
    /// Unique identity for the caller-defined local clock-hour interval.
    pub hour_scope_id: String,
    /// Unique identity for the caller-defined local calendar day.
    pub day_scope_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Relationship {
    ConsecutiveTransition,
    SameHour,
    SameDay,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatrixRecord {
    pub entity_id: String,
    pub relationship: Relationship,
    pub source_app_id: String,
    pub target_app_id: String,
    pub occurrence_count: u64,
    pub probability: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MaximumTransition {
    pub entity_id: String,
    pub source_app_id: String,
    pub probability: f64,
    pub target_app_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Undisclosed,
}

type Counts = BTreeMap<(String, String), u64>;

fn validate(configuration: Configuration) -> Result<(), Error> {
    let complete = |policy: CooccurrenceConfiguration| {
        policy.pair_orientation != PairOrientation::Undisclosed
            && policy.multiplicity != CooccurrenceMultiplicity::Undisclosed
            && policy.diagonal_policy != DiagonalPolicy::Undisclosed
            && policy.probability_normalization != ProbabilityNormalization::Undisclosed
    };
    if configuration.transition_diagonal_policy == DiagonalPolicy::Undisclosed
        || configuration.transition_probability_normalization
            == ProbabilityNormalization::Undisclosed
        || !complete(configuration.same_hour)
        || !complete(configuration.same_day)
    {
        Err(Error::Undisclosed)
    } else {
        Ok(())
    }
}

fn increment(counts: &mut Counts, source: &str, target: &str) {
    *counts
        .entry((source.to_owned(), target.to_owned()))
        .or_default() += 1;
}

fn cooccurrences(
    rows: &[&OrderedAppLaunch],
    same_hour: bool,
    policy: CooccurrenceConfiguration,
) -> Counts {
    let mut scopes = BTreeMap::<&str, Vec<&str>>::new();
    for row in rows {
        let scope = if same_hour {
            row.hour_scope_id.as_str()
        } else {
            row.day_scope_id.as_str()
        };
        scopes.entry(scope).or_default().push(row.app_id.as_str());
    }
    let mut counts = Counts::new();
    for apps in scopes.values() {
        let apps = match policy.multiplicity {
            CooccurrenceMultiplicity::AllLaunchPairs => apps.clone(),
            CooccurrenceMultiplicity::DistinctAppsPerScope => {
                let mut seen = BTreeSet::new();
                apps.iter()
                    .copied()
                    .filter(|app| seen.insert(*app))
                    .collect()
            }
            CooccurrenceMultiplicity::Undisclosed => unreachable!("validated"),
        };
        for left in 0..apps.len() {
            for right in left + 1..apps.len() {
                let (source, target) = (apps[left], apps[right]);
                if source == target && policy.diagonal_policy == DiagonalPolicy::Exclude {
                    continue;
                }
                increment(&mut counts, source, target);
                if source != target && policy.pair_orientation == PairOrientation::Symmetric {
                    increment(&mut counts, target, source);
                }
            }
        }
    }
    counts
}

fn matrix_records(
    entity_id: &str,
    relationship: Relationship,
    counts: &Counts,
    normalization: ProbabilityNormalization,
) -> Vec<MatrixRecord> {
    let total = counts.values().sum::<u64>();
    let mut rows = BTreeMap::<&str, u64>::new();
    for ((source, _), count) in counts {
        *rows.entry(source).or_default() += count;
    }
    counts
        .iter()
        .map(|((source, target), count)| {
            let denominator = match normalization {
                ProbabilityNormalization::RowTotal => rows[source.as_str()],
                ProbabilityNormalization::AllOccurrences => total,
                ProbabilityNormalization::Undisclosed => unreachable!("validated"),
            };
            MatrixRecord {
                entity_id: entity_id.to_owned(),
                relationship,
                source_app_id: source.clone(),
                target_app_id: target.clone(),
                occurrence_count: *count,
                probability: *count as f64 / denominator as f64,
            }
        })
        .collect()
}

/// Returns sparse positive matrix cells and a maximum transition for every app
/// with at least one outgoing transition, independently per entity.
pub fn materialize(
    launches: &[OrderedAppLaunch],
    configuration: Configuration,
) -> Result<(Vec<MatrixRecord>, Vec<MaximumTransition>), Error> {
    validate(configuration)?;
    let mut entities = BTreeMap::<&str, Vec<&OrderedAppLaunch>>::new();
    for launch in launches {
        entities.entry(&launch.entity_id).or_default().push(launch);
    }

    let mut records = Vec::new();
    let mut maxima = Vec::new();
    for (entity_id, rows) in entities {
        let mut transition = Counts::new();
        for pair in rows.windows(2) {
            if pair[0].app_id != pair[1].app_id
                || configuration.transition_diagonal_policy == DiagonalPolicy::Include
            {
                increment(&mut transition, &pair[0].app_id, &pair[1].app_id);
            }
        }
        let transition_records = matrix_records(
            entity_id,
            Relationship::ConsecutiveTransition,
            &transition,
            configuration.transition_probability_normalization,
        );
        for source in transition
            .keys()
            .map(|(source, _)| source)
            .collect::<BTreeSet<_>>()
        {
            let candidates = transition_records
                .iter()
                .filter(|record| record.source_app_id == *source);
            let probability = candidates
                .clone()
                .map(|record| record.probability)
                .fold(0.0, f64::max);
            maxima.push(MaximumTransition {
                entity_id: entity_id.to_owned(),
                source_app_id: source.clone(),
                probability,
                target_app_ids: candidates
                    .filter(|record| record.probability == probability)
                    .map(|record| record.target_app_id.clone())
                    .collect(),
            });
        }
        records.extend(transition_records);
        for (relationship, counts, normalization) in [
            (
                Relationship::SameHour,
                cooccurrences(&rows, true, configuration.same_hour),
                configuration.same_hour.probability_normalization,
            ),
            (
                Relationship::SameDay,
                cooccurrences(&rows, false, configuration.same_day),
                configuration.same_day.probability_normalization,
            ),
        ] {
            records.extend(matrix_records(
                entity_id,
                relationship,
                &counts,
                normalization,
            ));
        }
    }
    Ok((records, maxima))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configuration() -> Configuration {
        Configuration {
            transition_diagonal_policy: DiagonalPolicy::Exclude,
            transition_probability_normalization: ProbabilityNormalization::RowTotal,
            same_hour: CooccurrenceConfiguration {
                pair_orientation: PairOrientation::Symmetric,
                multiplicity: CooccurrenceMultiplicity::DistinctAppsPerScope,
                diagonal_policy: DiagonalPolicy::Exclude,
                probability_normalization: ProbabilityNormalization::RowTotal,
            },
            same_day: CooccurrenceConfiguration {
                pair_orientation: PairOrientation::SourceOrdered,
                multiplicity: CooccurrenceMultiplicity::AllLaunchPairs,
                diagonal_policy: DiagonalPolicy::Include,
                probability_normalization: ProbabilityNormalization::AllOccurrences,
            },
        }
    }

    fn launch(app: &str, hour: &str, day: &str) -> OrderedAppLaunch {
        OrderedAppLaunch {
            entity_id: "device-1".into(),
            app_id: app.into(),
            hour_scope_id: hour.into(),
            day_scope_id: day.into(),
        }
    }

    #[test]
    fn materializes_source_shaped_models_and_fails_closed() {
        // DOI 10.1145/2638728.2641700: ordered launches feed transition,
        // same-hour/day matrices and each app's maximum transition probability.
        let launches = vec![
            launch("A", "d1h1", "d1"),
            launch("B", "d1h1", "d1"),
            launch("A", "d1h2", "d1"),
            launch("C", "d1h2", "d1"),
            launch("B", "d2h1", "d2"),
        ];
        let (records, maxima) = materialize(&launches, configuration()).unwrap();
        let find = |kind, source: &str, target: &str| {
            records
                .iter()
                .find(|record| {
                    record.relationship == kind
                        && record.source_app_id == source
                        && record.target_app_id == target
                })
                .unwrap()
        };
        assert_eq!(
            (
                find(Relationship::ConsecutiveTransition, "A", "B").occurrence_count,
                find(Relationship::ConsecutiveTransition, "A", "B").probability,
            ),
            (1, 0.5)
        );
        assert_eq!(find(Relationship::SameHour, "B", "A").probability, 1.0);
        assert_eq!(find(Relationship::SameDay, "B", "C").probability, 1.0 / 6.0);
        assert_eq!(find(Relationship::SameDay, "A", "A").occurrence_count, 1);
        assert_eq!(records.len(), 13); // 4 transition + 4 hour + 5 day cells.
        assert_eq!(
            maxima
                .iter()
                .find(|row| row.source_app_id == "A")
                .unwrap()
                .target_app_ids,
            ["B", "C"]
        );

        let mut undisclosed = configuration();
        undisclosed.same_hour.pair_orientation = PairOrientation::Undisclosed;
        assert_eq!(materialize(&launches, undisclosed), Err(Error::Undisclosed));
    }
}
