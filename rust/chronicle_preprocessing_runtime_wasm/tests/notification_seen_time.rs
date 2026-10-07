#[path = "../src/notification_seen_time.rs"]
mod notification_seen_time;

use notification_seen_time::{
    derive_notification_seen_times, NotificationPhoneEventKind, NotificationSeenExclusionReason,
    NotificationSeenResolution, NotificationSeenTimeConfiguration, NotificationSeenTimeDisposition,
    OrderedNotificationPhoneEvent,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/notification_seen_time_mehrotra.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: String,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    configuration: FixtureConfiguration,
    execution_boundary: ExecutionBoundary,
    cases: Vec<FixtureCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureConfiguration {
    maximum_seen_time_nanoseconds: i64,
    discard_comparator: String,
    equal_timestamp_ordering: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionBoundary {
    input_stage: String,
    output_stage: String,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    case_id: String,
    events: Vec<FixtureEvent>,
    expected: Vec<ExpectedOutcome>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureEvent {
    participant_id: String,
    timestamp_ns: i64,
    kind: String,
    notification_id: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExpectedOutcome {
    participant_id: String,
    notification_id: String,
    arrival_timestamp_ns: i64,
    status: String,
    seen_timestamp_ns: Option<i64>,
    seen_time_ns: Option<i64>,
    resolution: Option<String>,
    exclusion_reason: Option<String>,
    candidate_seen_timestamp_ns: Option<i64>,
    candidate_seen_time_ns: Option<i64>,
}

fn expected_outcome(
    outcome: notification_seen_time::NotificationSeenTimeOutcome,
) -> ExpectedOutcome {
    let (
        status,
        seen_timestamp_ns,
        seen_time_ns,
        resolution,
        exclusion_reason,
        candidate_seen_timestamp_ns,
        candidate_seen_time_ns,
    ) = match outcome.disposition {
        NotificationSeenTimeDisposition::Retained {
            seen_timestamp_ns,
            seen_time_ns,
            resolution,
        } => (
            "retained".to_owned(),
            Some(seen_timestamp_ns),
            Some(seen_time_ns),
            Some(
                match resolution {
                    NotificationSeenResolution::AlreadyUnlocked => "already_unlocked",
                    NotificationSeenResolution::NextUnlock => "next_unlock",
                }
                .to_owned(),
            ),
            None,
            None,
            None,
        ),
        NotificationSeenTimeDisposition::Excluded {
            reason,
            candidate_seen_timestamp_ns,
            candidate_seen_time_ns,
        } => (
            "excluded".to_owned(),
            None,
            None,
            None,
            Some(
                match reason {
                    NotificationSeenExclusionReason::UnknownPhoneStateAtArrival => {
                        "unknown_phone_state_at_arrival"
                    }
                    NotificationSeenExclusionReason::NoFollowingUnlock => "no_following_unlock",
                    NotificationSeenExclusionReason::ExceededMaximumSeenTime => {
                        "exceeded_maximum_seen_time"
                    }
                }
                .to_owned(),
            ),
            candidate_seen_timestamp_ns,
            candidate_seen_time_ns,
        ),
    };
    ExpectedOutcome {
        participant_id: outcome.participant_id,
        notification_id: outcome.notification_id,
        arrival_timestamp_ns: outcome.arrival_timestamp_ns,
        status,
        seen_timestamp_ns,
        seen_time_ns,
        resolution,
        exclusion_reason,
        candidate_seen_timestamp_ns,
        candidate_seen_time_ns,
    }
}

#[test]
fn source_boundaries_and_failure_reasons_match_the_fixture() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-notification-seen-time-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3131901");
    assert_eq!(
        fixture.source_sha256,
        "2f1a06612f0ea26c2c09c634850b99a91e125784f2f4412b74725d69b1ea146e"
    );
    assert!(fixture.source_locator.ends_with("rank149.txt:359-369"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-19df120d26b64e11efb807ab",
            "method-setting-74d0f04af4fa8ee64ddd9b81",
            "method-setting-f095986a1bdd7eb9f5ce9b0d",
        ]
    );
    assert_eq!(
        fixture.configuration.discard_comparator,
        "strictly_greater_than"
    );
    assert_eq!(
        fixture.configuration.equal_timestamp_ordering,
        "caller_input_order"
    );
    assert_eq!(
        fixture.execution_boundary.input_stage,
        "ordered participant notification-arrival and phone lock/unlock events"
    );
    assert_eq!(
        fixture.execution_boundary.output_stage,
        "per-notification retained or explicitly excluded seen-time outcome"
    );
    assert!(fixture
        .execution_boundary
        .limitations
        .iter()
        .any(|limitation| limitation.contains("phone state before")));

    for case in fixture.cases {
        let events = case
            .events
            .into_iter()
            .map(|event| OrderedNotificationPhoneEvent {
                participant_id: event.participant_id,
                timestamp_ns: event.timestamp_ns,
                kind: match event.kind.as_str() {
                    "phone_locked" => NotificationPhoneEventKind::PhoneLocked,
                    "phone_unlocked" => NotificationPhoneEventKind::PhoneUnlocked,
                    "notification_arrival" => NotificationPhoneEventKind::NotificationArrival {
                        notification_id: event.notification_id.unwrap_or_else(|| {
                            panic!("{} notification lacks identity", case.case_id)
                        }),
                    },
                    other => panic!("{} unknown event kind {other}", case.case_id),
                },
            })
            .collect::<Vec<_>>();
        let actual = derive_notification_seen_times(
            &events,
            NotificationSeenTimeConfiguration {
                maximum_seen_time_ns: fixture.configuration.maximum_seen_time_nanoseconds,
            },
        )
        .unwrap_or_else(|error| panic!("{} failed: {error}", case.case_id))
        .into_iter()
        .map(expected_outcome)
        .collect::<Vec<_>>();
        assert_eq!(actual, case.expected, "{}", case.case_id);
    }
}

#[test]
fn input_order_is_validated_per_participant_without_rejecting_timestamp_ties() {
    let tied = [
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: 1,
            kind: NotificationPhoneEventKind::PhoneLocked,
        },
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: 1,
            kind: NotificationPhoneEventKind::NotificationArrival {
                notification_id: "n".into(),
            },
        },
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: 1,
            kind: NotificationPhoneEventKind::PhoneUnlocked,
        },
    ];
    assert!(derive_notification_seen_times(
        &tied,
        NotificationSeenTimeConfiguration {
            maximum_seen_time_ns: 1
        }
    )
    .is_ok());

    let out_of_order = [
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: 2,
            kind: NotificationPhoneEventKind::PhoneLocked,
        },
        OrderedNotificationPhoneEvent {
            participant_id: "other".into(),
            timestamp_ns: 0,
            kind: NotificationPhoneEventKind::PhoneUnlocked,
        },
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: 1,
            kind: NotificationPhoneEventKind::PhoneUnlocked,
        },
    ];
    let error = derive_notification_seen_times(
        &out_of_order,
        NotificationSeenTimeConfiguration {
            maximum_seen_time_ns: 1,
        },
    )
    .expect_err("per-participant reversal must fail closed");
    assert!(error.to_string().contains("precedes"));
}

#[test]
fn elapsed_time_overflow_fails_closed() {
    let events = [
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: i64::MIN,
            kind: NotificationPhoneEventKind::PhoneLocked,
        },
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: i64::MIN,
            kind: NotificationPhoneEventKind::NotificationArrival {
                notification_id: "n".into(),
            },
        },
        OrderedNotificationPhoneEvent {
            participant_id: "p".into(),
            timestamp_ns: i64::MAX,
            kind: NotificationPhoneEventKind::PhoneUnlocked,
        },
    ];
    let error = derive_notification_seen_times(
        &events,
        NotificationSeenTimeConfiguration {
            maximum_seen_time_ns: i64::MAX,
        },
    )
    .expect_err("an unrepresentable nanosecond span must fail closed");
    assert!(error.to_string().contains("overflows nanoseconds"));
}
