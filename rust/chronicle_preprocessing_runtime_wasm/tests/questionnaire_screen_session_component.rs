#[path = "../src/ema_screen_session_materialization.rs"]
mod ema_screen_session_materialization;
#[path = "../src/questionnaire_screen_session_component.rs"]
mod questionnaire_screen_session_component;
#[path = "../src/questionnaire_screen_session_summary.rs"]
mod questionnaire_screen_session_summary;

use questionnaire_screen_session_component::{
    execute_questionnaire_screen_session_component_csv,
    QuestionnaireScreenSessionComponentConfiguration,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("fixtures/schoedel_questionnaire_screen_session_component.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_method_variant_id: String,
    source_sha256: SourceSha256,
    source_locators: Vec<String>,
    exact_canonical_setting_ids: Vec<String>,
    input_schema: Vec<String>,
    configuration: QuestionnaireScreenSessionComponentConfiguration,
    raw_csv: String,
    expected_derived_csv: String,
    expected_input_row_count: usize,
    expected_materialized_row_count: usize,
    expected_materialized_session_count: usize,
    expected_output_row_count: usize,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSha256 {
    screen_usage_within: String,
    aggregation: String,
}

#[test]
fn mixed_questionnaire_window_materializes_and_summarizes_at_the_declared_boundary() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("component fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-questionnaire-screen-session-component-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        fixture.source_method_variant_id,
        "source-audit-configuration-space-8b14e63d69954819163df993"
    );
    assert_eq!(
        fixture.source_sha256.screen_usage_within,
        "51b0f06c317c8473a07eb3a11cbc5f29529b9714a58a1b7e0fca92b75522e519"
    );
    assert_eq!(
        fixture.source_sha256.aggregation,
        "219e057a39610002db1e5afd14b2a1364b0e0f8e9b065dcf6572f46e999196cb"
    );
    assert!(fixture
        .source_locators
        .iter()
        .any(|locator| locator.ends_with("Screen_usageSessions_Microlevel.R:25-193")));
    assert_eq!(fixture.exact_canonical_setting_ids.len(), 15);
    assert_eq!(
        fixture.input_schema,
        [
            "window_questionnaire_id",
            "window_start_timestamp_ns",
            "window_end_timestamp_ns",
            "source_row_id",
            "event_timestamp_ns",
            "row_questionnaire_id",
            "usage_id",
            "nonusage_id",
        ]
    );
    assert!(fixture.limitations.iter().any(|limitation| {
        limitation.contains("Questionnaire membership") && limitation.contains("usage/nonusage IDs")
    }));

    let result = execute_questionnaire_screen_session_component_csv(
        fixture.raw_csv.as_bytes(),
        &fixture.configuration,
    )
    .expect("bounded component executes");
    assert_eq!(result.input_row_count, fixture.expected_input_row_count);
    assert_eq!(
        result.materialized_row_count,
        fixture.expected_materialized_row_count
    );
    assert_eq!(
        result.materialized_session_count,
        fixture.expected_materialized_session_count
    );
    assert_eq!(result.output_row_count, fixture.expected_output_row_count);
    assert_eq!(
        String::from_utf8(result.derived_csv).expect("UTF-8 derived CSV"),
        fixture.expected_derived_csv
    );
}

#[test]
fn input_boundary_fails_closed_before_materialization() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("component fixture JSON");
    let mut configuration = fixture.configuration.clone();
    configuration.input_stage = "raw_screen_events".to_owned();
    let error = execute_questionnaire_screen_session_component_csv(
        fixture.raw_csv.as_bytes(),
        &configuration,
    )
    .expect_err("raw rows cannot be relabeled implicitly");
    assert!(error.contains("requires input stage"));

    let wrong_header =
        fixture
            .raw_csv
            .replacen("row_questionnaire_id", "inferred_questionnaire_id", 1);
    let error = execute_questionnaire_screen_session_component_csv(
        wrong_header.as_bytes(),
        &fixture.configuration,
    )
    .expect_err("the input schema is closed");
    assert!(error.contains("header must be exactly"));
}
