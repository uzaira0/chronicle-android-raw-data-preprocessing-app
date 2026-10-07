#[path = "../src/participation_day_warmup.rs"]
mod participation_day_warmup;

use participation_day_warmup::{
    exclude_first_participation_day_hour, ParticipationDayBoundary, ParticipationDayRecord,
    ParticipationDayWarmupError, SOURCE_WARMUP_DURATION_NS,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/participation_day_warmup_chen_2023.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: String,
    source_locator: String,
    released_code_sha256: String,
    exact_canonical_setting_ids: Vec<String>,
    source_schedule_metadata: SourceScheduleMetadata,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    boundaries: Vec<FixtureBoundary>,
    records: Vec<FixtureRecord>,
    expected_payloads: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceScheduleMetadata {
    default_start: String,
    default_end: String,
    start_and_end_user_adjustable: bool,
    operational_use: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBoundary {
    participant_id: String,
    source_day_id: String,
    start_timestamp_ns: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRecord {
    participant_id: String,
    source_day_id: String,
    event_timestamp_ns: i64,
    payload: String,
}

impl From<FixtureBoundary> for ParticipationDayBoundary {
    fn from(value: FixtureBoundary) -> Self {
        Self {
            participant_id: value.participant_id,
            source_day_id: value.source_day_id,
            start_timestamp_ns: value.start_timestamp_ns,
        }
    }
}

impl From<FixtureRecord> for ParticipationDayRecord<String> {
    fn from(value: FixtureRecord) -> Self {
        Self {
            participant_id: value.participant_id,
            source_day_id: value.source_day_id,
            event_timestamp_ns: value.event_timestamp_ns,
            payload: value.payload,
        }
    }
}

#[test]
fn excludes_the_source_first_hour_from_supplied_participation_day_boundaries() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T30 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participation-day-warmup-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3544548.3580689");
    assert_eq!(
        fixture.source_sha256,
        "ac549455d86f7572e6f3e0b2b0ba012ab6f47d175836bf92f51a5d83f1b5b931"
    );
    assert!(fixture
        .source_locator
        .ends_with("223-1-ac549455d86f.txt:403-416"));
    assert_eq!(
        fixture.released_code_sha256,
        "61a6776961867487c90f0e71d81cd39f3a3135c17b464b15f541f359b334032c"
    );
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-50d746b62ee05404bbbfaac8"]
    );
    assert_eq!(fixture.source_schedule_metadata.default_start, "10:00");
    assert_eq!(fixture.source_schedule_metadata.default_end, "22:00");
    assert!(
        fixture
            .source_schedule_metadata
            .start_and_end_user_adjustable
    );
    assert_eq!(
        fixture.source_schedule_metadata.operational_use,
        "provenance_only_not_a_boundary_inference_rule"
    );
    assert!(fixture.input_boundary.contains("supplied separately"));
    assert!(fixture.output_boundary.contains("input order"));
    for missing_rule in [
        "assigned to participation days",
        "midnight",
        "already-prepared",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(missing_rule)));
    }
    assert_eq!(SOURCE_WARMUP_DURATION_NS, 3_600_000_000_000);

    let retained = exclude_first_participation_day_hour(
        fixture.records.into_iter().map(Into::into).collect(),
        fixture.boundaries.into_iter().map(Into::into).collect(),
    )
    .expect("every fixture record has an explicit participation-day boundary");
    assert_eq!(
        retained
            .into_iter()
            .map(|record| record.payload)
            .collect::<Vec<_>>(),
        fixture.expected_payloads
    );
}

#[test]
fn missing_or_inconsistent_participation_day_boundaries_fail_closed() {
    let record = ParticipationDayRecord {
        participant_id: "P1".to_owned(),
        source_day_id: "day-1".to_owned(),
        event_timestamp_ns: SOURCE_WARMUP_DURATION_NS,
        payload: (),
    };
    assert!(matches!(
        exclude_first_participation_day_hour(vec![record.clone()], vec![]),
        Err(ParticipationDayWarmupError::MissingBoundary { .. })
    ));

    let duplicate = ParticipationDayBoundary {
        participant_id: "P1".to_owned(),
        source_day_id: "day-1".to_owned(),
        start_timestamp_ns: 0,
    };
    assert!(matches!(
        exclude_first_participation_day_hour(
            vec![record.clone()],
            vec![duplicate.clone(), duplicate]
        ),
        Err(ParticipationDayWarmupError::DuplicateBoundary { .. })
    ));

    let before = ParticipationDayRecord {
        event_timestamp_ns: -1,
        ..record
    };
    assert!(matches!(
        exclude_first_participation_day_hour(
            vec![before],
            vec![ParticipationDayBoundary {
                participant_id: "P1".to_owned(),
                source_day_id: "day-1".to_owned(),
                start_timestamp_ns: 0,
            }]
        ),
        Err(ParticipationDayWarmupError::EventBeforeBoundary { .. })
    ));
}
