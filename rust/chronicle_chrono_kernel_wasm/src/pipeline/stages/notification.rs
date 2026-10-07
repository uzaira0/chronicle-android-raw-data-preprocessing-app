use crate::pipeline_v2::model::NotificationSelectionCheckpoint;
use crate::pipeline_v2::{
    BTreeMap, NOTIFICATION_SEEN, NOTIFICATION_OUTSIDE_USAGE_FLAG, NOTIFICATION_PROXY_FLAG_PREFIX,
    NOTIFICATION_WITHIN_USAGE_FLAG, NotificationContactCounts, NotificationProxyRule,
    ObservedUsageSpanGroup, ObservedUsageSpans, Row, push_row_flag,
};

/// Index the reconstructed episodes a notification instant can fall inside.
///
/// Only an episode with BOTH endpoints contributes. A row whose interval was
/// blanked -- by the minimum-duration floor, by exclusion, or by End of Usage
/// Missing -- is not evidence that the user was in the app at any particular
/// instant, so it must not make a contact read as already-counted.
pub(crate) fn index_observed_usage_spans(app_rows: &[Row]) -> ObservedUsageSpans {
    let mut by_participant_package: BTreeMap<(&str, &str), Vec<(i64, i64)>> = BTreeMap::new();
    for row in app_rows {
        let (Some(start), Some(stop)) = (row.start_timestamp_ns, row.stop_timestamp_ns) else {
            continue;
        };
        if stop < start {
            continue;
        }
        by_participant_package
            .entry((row.participant_id.as_str(), row.app_package_name.as_str()))
            .or_default()
            .push((start, stop));
    }
    ObservedUsageSpans {
        groups: by_participant_package
            .into_iter()
            .map(|((participant_id, app_package_name), mut spans)| {
                spans.sort_unstable();
                ObservedUsageSpanGroup {
                    participant_id: participant_id.to_string(),
                    app_package_name: app_package_name.to_string(),
                    spans,
                }
            })
            .collect(),
    }
}

/// Whether `instant` lies within any span, endpoints included.
///
/// Inclusive on both ends: a notification stamped exactly at an episode's
/// start or stop is the same instant the episode already accounts for, and
/// calling that "outside" would overcount contact by one row per boundary.
/// `spans` is sorted by start, so only the prefix that has already opened can
/// contain the instant.
pub(crate) fn instant_within_spans(spans: &[(i64, i64)], instant: i64) -> bool {
    let opened = spans.partition_point(|(start, _)| *start <= instant);
    spans[..opened].iter().any(|(_, stop)| *stop >= instant)
}

/// The raw rows this rule admits as proxy contact sources, in input order.
pub(crate) fn select_notification_events(
    policy_rows: &[Row],
    rule: NotificationProxyRule,
) -> Vec<Row> {
    policy_rows
        .iter()
        .filter(|row| rule.admits_interaction_type(row.interaction_type.as_str()))
        .cloned()
        .collect()
}

/// Stamp each contact with the rule that emitted it and the observed-usage
/// join, and report how the contacts split.
///
/// Provenance rides in `any_app_usage_flags` for the same reason Culverhouse's
/// truncation amount does: a run with this axis on stays schema-compatible
/// with one that has it off.
pub(crate) fn classify_notification_contacts(
    contacts: &mut [Row],
    spans: &ObservedUsageSpans,
    rule: NotificationProxyRule,
) -> NotificationContactCounts {
    let mut counts = NotificationContactCounts::default();
    for row in contacts {
        let within = instant_within_spans(
            spans.spans_for(row.participant_id.as_str(), row.app_package_name.as_str()),
            row.event_timestamp_ns,
        );
        if within {
            counts.within_observed_usage += 1;
        } else {
            counts.outside_observed_usage += 1;
        }
        push_row_flag(
            row,
            &format!("{NOTIFICATION_PROXY_FLAG_PREFIX} {}", rule.canonical_id()),
        );
        push_row_flag(
            row,
            if within {
                NOTIFICATION_WITHIN_USAGE_FLAG
            } else {
                NOTIFICATION_OUTSIDE_USAGE_FLAG
            },
        );
    }
    counts
}

pub(crate) fn notification_selection_checkpoint(
    contacts: &[Row],
    rule: NotificationProxyRule,
) -> NotificationSelectionCheckpoint {
    let seen_count = contacts
        .iter()
        .filter(|row| row.interaction_type.as_str() == NOTIFICATION_SEEN)
        .count();
    NotificationSelectionCheckpoint {
        rule: rule.canonical_id().to_string(),
        seen_count,
        interruption_count: contacts.len() - seen_count,
    }
}
