#[path = "../src/daily_contact_count.rs"]
mod daily_contact_count;

use daily_contact_count::{
    count_contacts_on_day_spine, AbsentDailyCountPolicy, DailyContactCount, DailyContactCountError,
    DatedContact, ParticipantDay,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("fixtures/notification_daily_zero_fill_source_variants.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    spine: Vec<FixtureKey>,
    post_selection_contacts: Vec<FixtureKey>,
    r_oracle: ROracle,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureKey {
    participant_id: String,
    date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ROracle {
    released_code_counts: Vec<u64>,
    stated_intended_counts: Vec<u64>,
}

fn inputs() -> (Fixture, Vec<ParticipantDay>, Vec<DatedContact>) {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("source-variant fixture JSON");
    let spine = fixture
        .spine
        .iter()
        .map(|row| ParticipantDay {
            participant_id: row.participant_id.clone(),
            date: row.date.clone(),
        })
        .collect();
    let contacts = fixture
        .post_selection_contacts
        .iter()
        .map(|row| DatedContact {
            participant_id: row.participant_id.clone(),
            date: row.date.clone(),
        })
        .collect();
    (fixture, spine, contacts)
}

fn counts(rows: &[DailyContactCount]) -> Vec<u64> {
    rows.iter().map(|row| row.contact_count).collect()
}

#[test]
fn released_joined_row_count_and_stated_zero_fill_remain_distinct() {
    let (fixture, spine, contacts) = inputs();
    let released =
        count_contacts_on_day_spine(&spine, &contacts, AbsentDailyCountPolicy::CountJoinedRows)
            .expect("released joined-row count");
    let intended = count_contacts_on_day_spine(
        &spine,
        &contacts,
        AbsentDailyCountPolicy::CountMatchesAndZeroFill,
    )
    .expect("stated zero-fill intent");

    assert_eq!(counts(&released), fixture.r_oracle.released_code_counts);
    assert_eq!(counts(&intended), fixture.r_oracle.stated_intended_counts);
    assert_eq!(
        released
            .iter()
            .map(|row| (row.participant_id.as_str(), row.date.as_str()))
            .collect::<Vec<_>>(),
        [
            ("P1", "2026-01-01"),
            ("P1", "2026-01-02"),
            ("P2", "2026-01-01"),
            ("P2", "2026-01-02"),
        ]
    );
    assert_ne!(released, intended);
}

#[test]
fn duplicate_spine_and_malformed_keys_fail_closed() {
    let duplicate = ParticipantDay {
        participant_id: "P1".into(),
        date: "2026-01-01".into(),
    };
    let error = count_contacts_on_day_spine(
        &[duplicate.clone(), duplicate],
        &[],
        AbsentDailyCountPolicy::CountMatchesAndZeroFill,
    )
    .expect_err("duplicate spine must fail closed");
    assert!(matches!(
        error,
        DailyContactCountError::DuplicateSpineDay { .. }
    ));

    let malformed = DatedContact {
        participant_id: "".into(),
        date: "2026-01-01".into(),
    };
    let error = count_contacts_on_day_spine(
        &[ParticipantDay {
            participant_id: "P1".into(),
            date: "2026-01-01".into(),
        }],
        &[malformed],
        AbsentDailyCountPolicy::CountMatchesAndZeroFill,
    )
    .expect_err("malformed contact must fail closed");
    assert_eq!(error, DailyContactCountError::EmptyParticipantId);
}
