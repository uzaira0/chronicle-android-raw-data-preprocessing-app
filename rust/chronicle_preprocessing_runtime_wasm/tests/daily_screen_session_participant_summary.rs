#[path = "../src/daily_screen_session_participant_summary.rs"]
mod daily_screen_session_participant_summary;

use daily_screen_session_participant_summary::{
    execute_daily_screen_session_participant_summary_csv,
    DailyScreenSessionParticipantSummaryConfiguration, DAILY_SCREEN_SESSION_SUMMARY_INPUT_STAGE,
};
use serde::Deserialize;

const ORACLE: &str =
    include_str!("fixtures/daily_screen_session_participant_summary_r_oracle.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleFixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting_ids: Vec<String>,
    source_sha256: SourceDigests,
    source_locators: SourceLocators,
    runtime: OracleRuntime,
    execution_boundary: ExecutionBoundary,
    configuration: DailyScreenSessionParticipantSummaryConfiguration,
    cases: Vec<OracleCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceDigests {
    screen_usage_macrolevel: String,
    aggregation: String,
}

#[derive(Debug, Deserialize)]
struct SourceLocators {
    usage: String,
    nonusage: String,
    #[serde(rename = "final")]
    final_locator: String,
    quadratic: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleRuntime {
    container_image: String,
    r_version: String,
    dplyr_version: String,
    lubridate_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionBoundary {
    input_stage: String,
    questionnaire_schema: String,
    deliberately_outside: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCase {
    case_id: String,
    sensing_csv: String,
    questionnaire_csv: String,
    expected_output_csv: String,
    expected_stats: ExpectedStats,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedStats {
    sensing_row_count: usize,
    questionnaire_row_count: usize,
    usage_session_count: usize,
    nonusage_session_count: usize,
    excluded_day_count: usize,
    output_row_count: usize,
}

fn assert_csv_matches_r(case_id: &str, actual: &[u8], expected: &str) {
    let mut actual_reader = csv::Reader::from_reader(actual);
    let mut expected_reader = csv::Reader::from_reader(expected.as_bytes());
    assert_eq!(
        actual_reader.headers().expect("actual headers"),
        expected_reader.headers().expect("oracle headers"),
        "{case_id} headers"
    );
    let actual_rows = actual_reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .expect("actual records");
    let expected_rows = expected_reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .expect("oracle records");
    assert_eq!(actual_rows.len(), expected_rows.len(), "{case_id} rows");
    for (actual_row, expected_row) in actual_rows.iter().zip(&expected_rows) {
        assert_eq!(actual_row.len(), expected_row.len(), "{case_id} columns");
        for (index, (actual, expected)) in actual_row.iter().zip(expected_row).enumerate() {
            if index + 1 == actual_row.len() || matches!(expected, "NA" | "NaN" | "+Inf" | "-Inf") {
                assert_eq!(actual, expected, "{case_id} column {index}");
                continue;
            }
            let actual = actual
                .parse::<f64>()
                .unwrap_or_else(|_| panic!("{case_id} column {index}: invalid actual {actual}"));
            let expected = expected
                .parse::<f64>()
                .unwrap_or_else(|_| panic!("{case_id} column {index}: invalid oracle {expected}"));
            let tolerance = 1e-9_f64.max(expected.abs() * 2e-14);
            assert!(
                (actual - expected).abs() <= tolerance,
                "{case_id} column {index}: actual={actual:.17}, expected={expected:.17}, tolerance={tolerance}"
            );
        }
    }
}

#[test]
fn deposited_r_macro_summary_matches_field_for_field() {
    let oracle: OracleFixture = serde_json::from_str(ORACLE).expect("macro R oracle JSON");
    assert_eq!(
        oracle.schema_version,
        "chronicle-daily-screen-session-participant-summary-r-oracle/v1"
    );
    assert_eq!(oracle.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        oracle.exact_canonical_setting_ids,
        ["method-setting-ca2f4e0c8e206a6b21dfb32e"]
    );
    assert_eq!(
        oracle.source_sha256.screen_usage_macrolevel,
        "8289ff398419d34ba94f5dcf767dd5bdd4d6d5ea3aa0c01ce34bfa674d63202f"
    );
    assert_eq!(
        oracle.source_sha256.aggregation,
        "219e057a39610002db1e5afd14b2a1364b0e0f8e9b065dcf6572f46e999196cb"
    );
    assert!(oracle
        .source_locators
        .usage
        .ends_with("Screen_usageSessions_Macrolevel.R:13-67"));
    assert!(oracle
        .source_locators
        .nonusage
        .ends_with("Screen_usageSessions_Macrolevel.R:70-166"));
    assert!(oracle
        .source_locators
        .final_locator
        .ends_with("Screen_usageSessions_Macrolevel.R:169-175"));
    assert!(oracle
        .source_locators
        .quadratic
        .ends_with("aggregation.R:3-8"));
    assert_eq!(
        oracle.runtime.container_image,
        "rocker/tidyverse@sha256:879098acd5a8277f3c368a1e2c431019d00d952959a588da12cdaaee9d968b8b"
    );
    assert_eq!(oracle.runtime.r_version, "R version 4.1.2 (2021-11-01)");
    assert_eq!(oracle.runtime.dplyr_version, "1.0.8");
    assert_eq!(oracle.runtime.lubridate_version, "1.8.0");
    assert_eq!(
        oracle.execution_boundary.input_stage,
        DAILY_SCREEN_SESSION_SUMMARY_INPUT_STAGE
    );
    assert_eq!(
        oracle.execution_boundary.questionnaire_schema,
        "phonestudy_es_file"
    );
    assert!(oracle
        .execution_boundary
        .deliberately_outside
        .iter()
        .any(|item| item == "downstream model fitting"));

    for case in oracle.cases {
        let output = execute_daily_screen_session_participant_summary_csv(
            case.sensing_csv.as_bytes(),
            case.questionnaire_csv.as_bytes(),
            &oracle.configuration,
        )
        .unwrap_or_else(|error| panic!("{} failed: {error}", case.case_id));
        assert_csv_matches_r(
            &case.case_id,
            &output.derived_csv,
            &case.expected_output_csv,
        );
        assert_eq!(
            output.sensing_row_count, case.expected_stats.sensing_row_count,
            "{} sensing rows",
            case.case_id
        );
        assert_eq!(
            output.questionnaire_row_count, case.expected_stats.questionnaire_row_count,
            "{} questionnaire rows",
            case.case_id
        );
        assert_eq!(
            output.usage_session_count, case.expected_stats.usage_session_count,
            "{} usage sessions",
            case.case_id
        );
        assert_eq!(
            output.nonusage_session_count, case.expected_stats.nonusage_session_count,
            "{} nonusage sessions",
            case.case_id
        );
        assert_eq!(
            output.excluded_day_count, case.expected_stats.excluded_day_count,
            "{} excluded days",
            case.case_id
        );
        assert_eq!(
            output.output_row_count, case.expected_stats.output_row_count,
            "{} output rows",
            case.case_id
        );
    }
}

#[test]
fn invalid_boundaries_and_incomplete_input_fail_closed() {
    let oracle: OracleFixture = serde_json::from_str(ORACLE).expect("macro R oracle JSON");
    let case = &oracle.cases[0];

    let mut wrong_stage = oracle.configuration.clone();
    wrong_stage.input_stage = "raw_screen_events".to_owned();
    assert!(execute_daily_screen_session_participant_summary_csv(
        case.sensing_csv.as_bytes(),
        case.questionnaire_csv.as_bytes(),
        &wrong_stage,
    )
    .unwrap_err()
    .contains("requires input stage"));

    let mut ambiguous_bins = oracle.configuration.clone();
    ambiguous_bins.medium_max_seconds_inclusive = ambiguous_bins.short_max_seconds_inclusive;
    assert!(execute_daily_screen_session_participant_summary_csv(
        case.sensing_csv.as_bytes(),
        case.questionnaire_csv.as_bytes(),
        &ambiguous_bins,
    )
    .unwrap_err()
    .contains("invalid activity labels or duration bins"));

    let missing_usage_header = case
        .sensing_csv
        .replacen(",\"usage\",", ",\"usage_missing\",", 1);
    assert!(execute_daily_screen_session_participant_summary_csv(
        missing_usage_header.as_bytes(),
        case.questionnaire_csv.as_bytes(),
        &oracle.configuration,
    )
    .unwrap_err()
    .contains("requires column usage"));

    let mismatched_participant =
        case.questionnaire_csv
            .replacen("participant-1", "participant-2", 1);
    assert!(execute_daily_screen_session_participant_summary_csv(
        case.sensing_csv.as_bytes(),
        mismatched_participant.as_bytes(),
        &oracle.configuration,
    )
    .unwrap_err()
    .contains("exactly one matching participant"));

    let fractional_nonusage = case.sensing_csv.replacen(
        ",NA,\"2023-01-01T08:00:00Z\"",
        ",1.5,\"2023-01-01T08:00:00Z\"",
        1,
    );
    assert!(execute_daily_screen_session_participant_summary_csv(
        fractional_nonusage.as_bytes(),
        case.questionnaire_csv.as_bytes(),
        &oracle.configuration,
    )
    .unwrap_err()
    .contains("integer-or-NA nonusage"));
}
