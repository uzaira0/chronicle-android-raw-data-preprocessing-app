#[path = "../src/fixed_weekly_self_report_cap.rs"]
mod fixed_weekly_self_report_cap;

use fixed_weekly_self_report_cap::{
    cap_weekly_self_reports_at_84_hours, CappedWeeklySelfReport, FixedWeeklyCapError,
    WeeklySelfReportRecord, SOURCE_WEEKLY_CAP_HOURS,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/fixed_weekly_self_report_cap_lee_2021.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_pdf_sha256: String,
    source_text_sha256: String,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    configuration_relation: String,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    records: Vec<FixtureRecord>,
    expected: Vec<FixtureExpected>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRecord {
    participant_id: String,
    measure_id: String,
    weekly_hours: f64,
    payload: String,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct FixtureExpected {
    participant_id: String,
    measure_id: String,
    original_weekly_hours: f64,
    analysis_weekly_hours: f64,
    source_outlier: bool,
    payload: String,
}

impl From<FixtureRecord> for WeeklySelfReportRecord<String> {
    fn from(value: FixtureRecord) -> Self {
        Self {
            participant_id: value.participant_id,
            measure_id: value.measure_id,
            weekly_hours: value.weekly_hours,
            payload: value.payload,
        }
    }
}

impl From<CappedWeeklySelfReport<String>> for FixtureExpected {
    fn from(value: CappedWeeklySelfReport<String>) -> Self {
        Self {
            participant_id: value.participant_id,
            measure_id: value.measure_id,
            original_weekly_hours: value.original_weekly_hours,
            analysis_weekly_hours: value.analysis_weekly_hours,
            source_outlier: value.source_outlier,
            payload: value.payload,
        }
    }
}

#[test]
fn applies_the_inclusive_fixed_cap_without_removing_records() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T31 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-fixed-weekly-self-report-cap-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.30773/pi.2020.0197");
    assert_eq!(
        fixture.source_pdf_sha256,
        "b3d9cb188e84d0fba927d18af2926337916a1eb63fbe5f3f65c2865b6f967717"
    );
    assert_eq!(
        fixture.source_text_sha256,
        "0054e43b008cae345f5b741d252cb6f54935d2f4ee92ee86f0490c5bf9cd50bd"
    );
    assert!(fixture.source_locator.ends_with("rank153.txt:112-128"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-71f115f4d10a7a596fcaa44c",
            "method-setting-8635523f80433dc441372044",
        ]
    );
    assert_eq!(fixture.configuration_relation, "joint_predicate_and_action");
    assert!(fixture.input_boundary.contains("already-computed"));
    assert!(fixture.output_boundary.contains("Every input row remains"));
    for missing in [
        "questionnaire",
        "missing-item",
        "supplement",
        "category scope",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(missing)));
    }
    assert_eq!(SOURCE_WEEKLY_CAP_HOURS, 84.0);

    let input_count = fixture.records.len();
    let actual =
        cap_weekly_self_reports_at_84_hours(fixture.records.into_iter().map(Into::into).collect())
            .expect("valid source-shaped weekly self-report records")
            .into_iter()
            .map(Into::into)
            .collect::<Vec<FixtureExpected>>();
    assert_eq!(actual.len(), input_count, "the source retains outlier rows");
    assert_eq!(actual, fixture.expected);
}

#[test]
fn invalid_or_unidentified_weekly_measures_fail_closed() {
    let record =
        |participant_id: &str, measure_id: &str, weekly_hours: f64| WeeklySelfReportRecord {
            participant_id: participant_id.to_owned(),
            measure_id: measure_id.to_owned(),
            weekly_hours,
            payload: (),
        };

    assert!(matches!(
        cap_weekly_self_reports_at_84_hours(vec![record("", "total", 1.0)]),
        Err(FixedWeeklyCapError::EmptyParticipantId { .. })
    ));
    assert!(matches!(
        cap_weekly_self_reports_at_84_hours(vec![record("P1", "", 1.0)]),
        Err(FixedWeeklyCapError::EmptyMeasureId { .. })
    ));
    for value in [-1.0, f64::NAN, f64::INFINITY] {
        assert!(matches!(
            cap_weekly_self_reports_at_84_hours(vec![record("P1", "total", value)]),
            Err(FixedWeeklyCapError::InvalidWeeklyHours { .. })
        ));
    }
}
