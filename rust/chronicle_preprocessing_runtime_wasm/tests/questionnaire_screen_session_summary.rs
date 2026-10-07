#[path = "../src/questionnaire_screen_session_summary.rs"]
mod questionnaire_screen_session_summary;

use questionnaire_screen_session_summary::{
    summarize_questionnaire_screen_sessions, MaterializedQuestionnaireScreenSession,
    RCompatibleNumber, ScreenSessionDurationBins, ScreenSessionState, ScreenSessionStateSummary,
};
use serde::Deserialize;
use std::collections::BTreeMap;

const ORACLE: &str = include_str!("fixtures/screen_usage_session_summary_r_oracle.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleFixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: SourceDigests,
    source_locators: SourceLocators,
    exact_canonical_setting_ids: Vec<String>,
    execution_boundary: ExecutionBoundary,
    runtime: OracleRuntime,
    cases: Vec<OracleCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceDigests {
    screen_usage_within: String,
    aggregation: String,
}

#[derive(Debug, Deserialize)]
struct SourceLocators {
    summary: String,
    aggregation: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionBoundary {
    input_stage: String,
    output_stage: String,
    deliberately_outside: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleRuntime {
    r_version: String,
    dplyr_version: String,
    tidyr_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCase {
    case_id: String,
    questionnaire_id: String,
    input_sessions: Vec<OracleSession>,
    expected: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleSession {
    questionnaire_id: String,
    kind: String,
    start_timestamp_ns: Option<i64>,
    end_timestamp_ns: Option<i64>,
}

fn bins() -> ScreenSessionDurationBins {
    ScreenSessionDurationBins {
        short_max_seconds_inclusive: 5.0 * 60.0,
        medium_max_seconds_inclusive: 30.0 * 60.0,
    }
}

fn insert_number(
    output: &mut BTreeMap<String, RCompatibleNumber>,
    key: &str,
    value: RCompatibleNumber,
) {
    assert!(output.insert(key.to_owned(), value).is_none());
}

fn insert_count(output: &mut BTreeMap<String, RCompatibleNumber>, key: &str, value: usize) {
    insert_number(output, key, RCompatibleNumber::Finite(value as f64));
}

fn insert_state(
    output: &mut BTreeMap<String, RCompatibleNumber>,
    prefix: &str,
    summary: &ScreenSessionStateSummary,
) {
    insert_count(
        output,
        &format!("{prefix}_num_int_all"),
        summary.session_count,
    );
    insert_number(
        output,
        &format!("{prefix}_sum_duration"),
        summary.sum_duration_seconds,
    );
    insert_number(
        output,
        &format!("{prefix}_mean_duration"),
        summary.mean_duration_seconds,
    );
    insert_number(
        output,
        &format!("{prefix}_sd_duration"),
        summary.sample_sd_duration_seconds,
    );
    insert_number(
        output,
        &format!("{prefix}_median_duration"),
        summary.median_duration_seconds,
    );
    insert_count(
        output,
        &format!("{prefix}_num_int_5"),
        summary.short_duration_count,
    );
    insert_count(
        output,
        &format!("{prefix}_num_int_530"),
        summary.medium_duration_count,
    );
    insert_count(
        output,
        &format!("{prefix}_num_int_30"),
        summary.long_duration_count,
    );
    insert_number(
        output,
        &format!("{prefix}_quadratic"),
        summary.quadratic_concentration,
    );
    insert_number(
        output,
        &format!("{prefix}_sum_squared_duration"),
        summary.sum_squared_duration_seconds2,
    );
    insert_number(
        output,
        &format!("{prefix}_squared_sum_duration"),
        summary.squared_sum_duration_seconds2,
    );
}

fn assert_source_number(case_id: &str, field: &str, actual: RCompatibleNumber, expected: &str) {
    match (actual, expected) {
        (RCompatibleNumber::Missing, "NA")
        | (RCompatibleNumber::NotANumber, "NaN")
        | (RCompatibleNumber::PositiveInfinity, "+Inf")
        | (RCompatibleNumber::NegativeInfinity, "-Inf") => {}
        (RCompatibleNumber::Finite(actual), expected) => {
            let expected = expected
                .parse::<f64>()
                .unwrap_or_else(|_| panic!("{case_id} {field}: invalid oracle number {expected}"));
            let tolerance = 1e-12_f64.max(expected.abs() * 2e-14);
            assert!(
                (actual - expected).abs() <= tolerance,
                "{case_id} {field}: actual={actual:.17}, expected={expected:.17}, tolerance={tolerance}"
            );
        }
        (actual, expected) => {
            panic!("{case_id} {field}: actual={actual:?}, expected={expected}")
        }
    }
}

#[test]
fn locked_deposited_r_summary_cases_match_field_for_field() {
    let oracle: OracleFixture = serde_json::from_str(ORACLE).expect("summary R oracle JSON");
    assert_eq!(
        oracle.schema_version,
        "chronicle-screen-usage-summary-source-oracle/v1"
    );
    assert_eq!(oracle.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        oracle.source_sha256.screen_usage_within,
        "51b0f06c317c8473a07eb3a11cbc5f29529b9714a58a1b7e0fca92b75522e519"
    );
    assert_eq!(
        oracle.source_sha256.aggregation,
        "219e057a39610002db1e5afd14b2a1364b0e0f8e9b065dcf6572f46e999196cb"
    );
    assert!(oracle
        .source_locators
        .summary
        .ends_with("scripts/featureExtraction/screen/Screen_usageSessions_Microlevel.R:130-193"));
    assert!(oracle
        .source_locators
        .aggregation
        .ends_with("scripts/featureExtraction/helper/aggregation.R:3-20"));
    assert_eq!(
        oracle.exact_canonical_setting_ids,
        [
            "method-setting-21b693ea5436305503be0fc9",
            "method-setting-41f40cf50e2210db84b80ce0",
            "method-setting-74c15d5497b1555a3d9012c6",
            "method-setting-79838bb0f52b46cffe29dc20",
            "method-setting-7d18b91f12fe2fb12a0f42d3",
            "method-setting-871bd5023df26c4a76acd52e",
            "method-setting-9b9c7f366541d4009cb9a92e",
            "method-setting-ab0497a3ed56ed90cbebebae",
            "method-setting-ae60c0a30acbf2cec8789654",
            "method-setting-d0b50ad57572c44a8f6008f2",
            "method-setting-e41b43bb033bdfb28de3f6f3",
            "method-setting-f3fc5ca3be3305fde9e47c94",
            "method-setting-f86a0ddaba70f5e4741674d3",
        ]
    );
    assert_eq!(
        oracle.execution_boundary.input_stage,
        "post_materialized_usage_nonusage_sessions"
    );
    assert_eq!(
        oracle.execution_boundary.output_stage,
        "per_questionnaire_usage_nonusage_feature_table_pre_ema_join_pre_modeling"
    );
    assert!(oracle
        .execution_boundary
        .deliberately_outside
        .iter()
        .any(|item| item == "five-second preprocessing join"));
    assert_eq!(oracle.runtime.r_version, "R version 4.1.2 (2021-11-01)");
    assert_eq!(oracle.runtime.dplyr_version, "1.0.8");
    assert_eq!(oracle.runtime.tidyr_version, "1.2.0");

    for case in oracle.cases {
        let sessions = case
            .input_sessions
            .into_iter()
            .map(|session| MaterializedQuestionnaireScreenSession {
                questionnaire_id: session.questionnaire_id,
                state: match session.kind.as_str() {
                    "usage" => ScreenSessionState::Usage,
                    "nonusage" => ScreenSessionState::Nonusage,
                    other => panic!("unknown session state {other}"),
                },
                start_timestamp_ns: session.start_timestamp_ns,
                end_timestamp_ns: session.end_timestamp_ns,
            })
            .collect::<Vec<_>>();
        let rows = summarize_questionnaire_screen_sessions(&sessions, bins())
            .unwrap_or_else(|error| panic!("{} failed: {error}", case.case_id));
        let row = rows
            .iter()
            .find(|row| row.questionnaire_id == case.questionnaire_id)
            .unwrap_or_else(|| panic!("{} missing output row", case.case_id));
        assert_eq!(rows.len(), 1, "{} unexpected output rows", case.case_id);

        let mut actual = BTreeMap::new();
        insert_state(&mut actual, "Usage", &row.usage);
        insert_state(&mut actual, "Nonusage", &row.nonusage);
        assert_eq!(actual.len(), case.expected.len(), "{} fields", case.case_id);
        for (field, expected) in &case.expected {
            let actual = *actual
                .get(field)
                .unwrap_or_else(|| panic!("{} missing field {field}", case.case_id));
            assert_source_number(&case.case_id, field, actual, expected);
        }
    }
}

#[test]
fn bin_configuration_rejects_ambiguous_or_nonfinite_boundaries() {
    let sessions = [MaterializedQuestionnaireScreenSession {
        questionnaire_id: "q".into(),
        state: ScreenSessionState::Usage,
        start_timestamp_ns: Some(0),
        end_timestamp_ns: Some(1),
    }];
    for invalid in [
        ScreenSessionDurationBins {
            short_max_seconds_inclusive: f64::NAN,
            medium_max_seconds_inclusive: 1800.0,
        },
        ScreenSessionDurationBins {
            short_max_seconds_inclusive: 300.0,
            medium_max_seconds_inclusive: f64::INFINITY,
        },
        ScreenSessionDurationBins {
            short_max_seconds_inclusive: -1.0,
            medium_max_seconds_inclusive: 1800.0,
        },
        ScreenSessionDurationBins {
            short_max_seconds_inclusive: 300.0,
            medium_max_seconds_inclusive: 300.0,
        },
    ] {
        assert!(summarize_questionnaire_screen_sessions(&sessions, invalid).is_err());
    }
}
