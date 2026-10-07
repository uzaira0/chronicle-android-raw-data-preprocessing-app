use chronicle_preprocessing_runtime_wasm::screen_academic_row_derivation::{
    derive_screen_academic_rows, retain_complete_screen_academic_background,
    ScreenAcademicBackgroundRow, ScreenAcademicDerivedRow, ScreenAcademicInputRow,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/screen_academic_row_derivation_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    input_boundary: String,
    output_boundary: String,
    r_version: String,
    background_complete_case_filter: BackgroundFilterFixture,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundFilterFixture {
    enabled: bool,
    exact_canonical_setting_ids: Vec<String>,
    configuration_locator: String,
    operation_locator: String,
    rows: Vec<BackgroundFixtureRow>,
    expected_payloads: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundFixtureRow {
    high_school_gpa: Option<f64>,
    parent_education_max: Option<f64>,
    parent_income_mean: Option<f64>,
    payload: String,
}

impl From<BackgroundFixtureRow> for ScreenAcademicBackgroundRow<String> {
    fn from(value: BackgroundFixtureRow) -> Self {
        Self {
            high_school_gpa: value.high_school_gpa,
            parent_education_max: value.parent_education_max,
            parent_income_mean: value.parent_income_mean,
            payload: value.payload,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    case_id: String,
    rows: Vec<FixtureInputRow>,
    expected_grade_sample_sd: String,
    expected_screen_time_sample_sd: String,
    expected_rows: Vec<FixtureExpectedRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureInputRow {
    integer_grade: Option<i32>,
    screen_time: Option<f64>,
    attendance_percent: Option<f64>,
    parent_income_mean: Option<f64>,
    smoke_frequency: Option<f64>,
    course_semester_id: Option<String>,
    payload: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureExpectedRow {
    skipping_percent: String,
    parent_income_ten_thousands: String,
    screen_time_scale_only: String,
    grade_scale_only: String,
    smoker_indicator: String,
    course_id: Option<String>,
    payload: String,
}

impl From<FixtureInputRow> for ScreenAcademicInputRow<String> {
    fn from(value: FixtureInputRow) -> Self {
        Self {
            integer_grade: value.integer_grade,
            screen_time: value.screen_time,
            attendance_percent: value.attendance_percent,
            parent_income_mean: value.parent_income_mean,
            smoke_frequency: value.smoke_frequency,
            course_semester_id: value.course_semester_id,
            payload: value.payload,
        }
    }
}

fn assert_r_number(actual: Option<f64>, expected: &str, context: &str) {
    match expected {
        "NA" => assert!(actual.is_none(), "{context}: expected R NA, got {actual:?}"),
        "NaN" => assert!(
            actual.is_some_and(f64::is_nan),
            "{context}: expected R NaN, got {actual:?}"
        ),
        "Inf" => assert!(
            actual.is_some_and(|value| value == f64::INFINITY),
            "{context}: expected R Inf, got {actual:?}"
        ),
        "-Inf" => assert!(
            actual.is_some_and(|value| value == f64::NEG_INFINITY),
            "{context}: expected R -Inf, got {actual:?}"
        ),
        expected => {
            let expected = expected.parse::<f64>().expect("finite R oracle number");
            let actual = actual.expect(context);
            let tolerance = f64::EPSILON * 16.0 * expected.abs().max(1.0);
            assert!(
                (actual - expected).abs() <= tolerance,
                "{context}: expected {expected:.17}, got {actual:.17}"
            );
        }
    }
}

fn assert_row(
    actual: &ScreenAcademicDerivedRow<String>,
    expected: &FixtureExpectedRow,
    context: &str,
) {
    assert_eq!(actual.payload, expected.payload, "{context}: payload");
    assert_r_number(
        actual.skipping_percent,
        &expected.skipping_percent,
        &format!("{context}: skipping"),
    );
    assert_r_number(
        actual.parent_income_ten_thousands,
        &expected.parent_income_ten_thousands,
        &format!("{context}: parent income"),
    );
    assert_r_number(
        actual.screen_time_scale_only,
        &expected.screen_time_scale_only,
        &format!("{context}: screen time"),
    );
    assert_r_number(
        actual.grade_scale_only,
        &expected.grade_scale_only,
        &format!("{context}: grade"),
    );
    assert_r_number(
        actual.smoker_indicator.map(f64::from),
        &expected.smoker_indicator,
        &format!("{context}: smoker indicator"),
    );
    assert_eq!(actual.course_id, expected.course_id, "{context}: course ID");
}

#[test]
fn deposited_row_derivations_match_r_4_1_2_oracles() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-screen-academic-row-derivation-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1177/0956797620956613");
    assert_eq!(
        fixture.source_code_sha256,
        "b2c12ecb356742dd05c23abb9c7ca78013125a87f24bf279c0b38f778e16302c"
    );
    assert!(fixture.source_locator.ends_with("load_data.R:5-11"));
    assert_eq!(fixture.r_version, "4.1.2");
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-5c3f17fb0b99a68bb5b58faf",
            "method-setting-7ff8cbc41656ef587e3ce315",
            "method-setting-1be0e5d48ec456488904f8f8",
            "method-setting-d7bf0f48272d6fcce11546f9",
            "method-setting-8d69ae47ccd24603e4d86d9e",
        ]
    );
    assert!(fixture.input_boundary.contains("as.integer"));
    assert!(fixture.output_boundary.contains("lines 6-11"));
    assert_eq!(fixture.limitations.len(), 2);

    for case in fixture.cases {
        let case_id = case.case_id.clone();
        let actual =
            derive_screen_academic_rows(case.rows.into_iter().map(Into::into).collect::<Vec<_>>());
        assert_r_number(
            actual.grade_sample_sd,
            &case.expected_grade_sample_sd,
            &format!("{case_id}: grade sample SD"),
        );
        assert_r_number(
            actual.screen_time_sample_sd,
            &case.expected_screen_time_sample_sd,
            &format!("{case_id}: screen-time sample SD"),
        );
        assert_eq!(actual.rows.len(), case.expected_rows.len(), "{case_id}");
        for (index, (actual, expected)) in actual
            .rows
            .iter()
            .zip(case.expected_rows.iter())
            .enumerate()
        {
            assert_row(actual, expected, &format!("{case_id} row {index}"));
        }
    }
}

#[test]
fn grade_and_screen_time_use_their_own_named_denominators() {
    let actual = derive_screen_academic_rows(vec![
        ScreenAcademicInputRow {
            integer_grade: Some(10),
            screen_time: Some(100.0),
            attendance_percent: None,
            parent_income_mean: None,
            smoke_frequency: None,
            course_semester_id: None,
            payload: (),
        },
        ScreenAcademicInputRow {
            integer_grade: Some(12),
            screen_time: Some(104.0),
            attendance_percent: None,
            parent_income_mean: None,
            smoke_frequency: None,
            course_semester_id: None,
            payload: (),
        },
    ]);

    assert_r_number(actual.grade_sample_sd, "1.4142135623730951", "grade SD");
    assert_r_number(
        actual.screen_time_sample_sd,
        "2.8284271247461903",
        "screen-time SD",
    );
    assert_r_number(
        actual.rows[0].grade_scale_only,
        "7.071067811865475",
        "grade",
    );
    assert_r_number(
        actual.rows[0].screen_time_scale_only,
        "35.35533905932737",
        "screen time",
    );
}

#[test]
fn smoker_na_and_fixed_course_suffix_edges_match_r_4_1_2() {
    let actual = derive_screen_academic_rows(vec![
        ScreenAcademicInputRow {
            integer_grade: Some(1),
            screen_time: Some(1.0),
            attendance_percent: None,
            parent_income_mean: None,
            smoke_frequency: Some(f64::NAN),
            course_semester_id: Some("A_\nB_C".to_owned()),
            payload: (),
        },
        ScreenAcademicInputRow {
            integer_grade: Some(2),
            screen_time: Some(2.0),
            attendance_percent: None,
            parent_income_mean: None,
            smoke_frequency: Some(f64::INFINITY),
            course_semester_id: Some("NOSUFFIX".to_owned()),
            payload: (),
        },
        ScreenAcademicInputRow {
            integer_grade: Some(3),
            screen_time: Some(3.0),
            attendance_percent: None,
            parent_income_mean: None,
            smoke_frequency: Some(f64::NEG_INFINITY),
            course_semester_id: Some("_leading".to_owned()),
            payload: (),
        },
    ]);

    assert_eq!(actual.rows[0].smoker_indicator, None);
    assert_eq!(actual.rows[1].smoker_indicator, Some(1));
    assert_eq!(actual.rows[2].smoker_indicator, Some(1));
    assert_eq!(actual.rows[0].course_id.as_deref(), Some("A\nB_C"));
    assert_eq!(actual.rows[1].course_id.as_deref(), Some("NOSUFFIX"));
    assert_eq!(actual.rows[2].course_id.as_deref(), Some(""));
}

#[test]
fn enabled_background_filter_matches_the_three_named_r_predicates() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");
    let filter = fixture.background_complete_case_filter;
    assert!(filter.enabled);
    assert_eq!(
        filter.exact_canonical_setting_ids,
        [
            "method-setting-2c2fd81770205f5258803415",
            "method-setting-c5050ba0fae976cbebaa7bf2",
        ]
    );
    assert!(filter.configuration_locator.ends_with("main_models.R:1-4"));
    assert!(filter.operation_locator.ends_with("load_data.R:19-21"));

    let retained = retain_complete_screen_academic_background(
        filter.rows.into_iter().map(Into::into).collect(),
    );
    assert_eq!(
        retained
            .iter()
            .map(|row| row.payload.clone())
            .collect::<Vec<_>>(),
        filter.expected_payloads
    );
}

#[test]
fn r_nan_is_missing_but_infinities_are_nonmissing() {
    let row = |high_school_gpa, payload| ScreenAcademicBackgroundRow {
        high_school_gpa,
        parent_education_max: Some(12.0),
        parent_income_mean: Some(5.0),
        payload,
    };
    let retained = retain_complete_screen_academic_background(vec![
        row(Some(f64::NAN), "nan"),
        row(Some(f64::INFINITY), "positive-infinity"),
        row(Some(f64::NEG_INFINITY), "negative-infinity"),
    ]);

    assert_eq!(
        retained.iter().map(|row| row.payload).collect::<Vec<_>>(),
        ["positive-infinity", "negative-infinity"]
    );
}
