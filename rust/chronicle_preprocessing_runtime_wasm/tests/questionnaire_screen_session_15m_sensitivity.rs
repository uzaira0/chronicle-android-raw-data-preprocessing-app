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

const FIXTURE: &str =
    include_str!("fixtures/schoedel_questionnaire_screen_session_15m_sensitivity.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_method_variant_id: String,
    source_sha256: SourceSha256,
    source_locators: Vec<String>,
    exact_canonical_setting_ids: Vec<String>,
    configuration: QuestionnaireScreenSessionComponentConfiguration,
    raw_csv: String,
    expected_derived_csv: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSha256 {
    screen_usage_within_15_minutes: String,
    aggregation: String,
}

#[test]
fn deposited_fifteen_minute_sensitivity_reuses_the_existing_component_by_configuration() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("15-minute fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-questionnaire-screen-session-15m-sensitivity-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        fixture.source_method_variant_id,
        "source-audit-configuration-space-8b14e63d69954819163df993"
    );
    assert_eq!(
        fixture.source_sha256.screen_usage_within_15_minutes,
        "153d6cbb3d5f6af97fece46f41f0867d1144d572c9b6990b98fc327fb2040b1b"
    );
    assert_eq!(
        fixture.source_sha256.aggregation,
        "219e057a39610002db1e5afd14b2a1364b0e0f8e9b065dcf6572f46e999196cb"
    );
    assert!(fixture
        .source_locators
        .iter()
        .any(|locator| locator.ends_with("Screen_usageSessions_Microlevel_15min.R:25-193")));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-df6a7a0da35c55ea648ded57"]
    );
    assert_eq!(
        fixture.configuration.expected_window_duration_ns,
        900_000_000_000
    );

    let output = execute_questionnaire_screen_session_component_csv(
        fixture.raw_csv.as_bytes(),
        &fixture.configuration,
    )
    .expect("15-minute configuration executes");
    assert_eq!(output.input_row_count, 3);
    assert_eq!(output.materialized_row_count, 3);
    assert_eq!(output.materialized_session_count, 1);
    assert_eq!(output.output_row_count, 1);
    assert_eq!(
        String::from_utf8(output.derived_csv).expect("derived UTF-8"),
        fixture.expected_derived_csv
    );

    let mut main_configuration = fixture.configuration;
    main_configuration.expected_window_duration_ns = 3_600_000_000_000;
    let error = execute_questionnaire_screen_session_component_csv(
        fixture.raw_csv.as_bytes(),
        &main_configuration,
    )
    .expect_err("the 60-minute configuration must reject a 15-minute window");
    assert!(error.contains("unexpected duration"));
}
