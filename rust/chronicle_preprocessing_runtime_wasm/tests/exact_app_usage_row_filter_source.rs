use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/exact_app_usage_row_filter_notification_study.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_artifact: SourceArtifact,
    source_runtime: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    required_aggregation_type: String,
    excluded_app_names: Vec<String>,
    input_boundary: String,
    output_boundary: String,
    cases: Vec<Case>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    source_row_id: String,
    aggregation_type: Option<String>,
    app_name: Option<String>,
    expected_retained: bool,
}

fn retain_app_usage_row(
    aggregation_type: Option<&str>,
    app_name: Option<&str>,
    required_aggregation_type: &str,
    excluded_app_names: &[String],
) -> bool {
    aggregation_type == Some(required_aggregation_type)
        && app_name.is_some_and(|app_name| {
            !excluded_app_names
                .iter()
                .any(|excluded| app_name == excluded)
        })
}

#[test]
fn exact_app_usage_filter_preserves_the_released_r_predicate_order_and_scope() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-exact-app-usage-row-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1080/15213269.2024.2334025");
    assert!(fixture.source_artifact.locator.ends_with("data].R:316-328"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "2bd5bab0c9a917a64f347093972bff72e2b0b5cfd38539a1df229c65cdbd383b"
    );
    assert_eq!(fixture.source_runtime, "R 4.3.2 with dplyr");
    assert_eq!(fixture.required_aggregation_type, "APP_USAGE");
    assert_eq!(
        fixture.excluded_app_names,
        ["YouTube Vanced", "Basic Daydreams"]
    );
    assert!(fixture.input_boundary.contains("before cohort union"));
    assert!(fixture.output_boundary.contains("preserve input order"));
    assert_eq!(fixture.limitations.len(), 3);
    assert_eq!(
        fixture
            .exact_canonical_settings
            .iter()
            .map(|setting| (
                setting.setting_id.as_str(),
                setting.parameter_key.as_str(),
                setting.source_observed_setting.as_str(),
                setting.source_value_sha256.as_str(),
            ))
            .collect::<Vec<_>>(),
        [
            (
                "method-setting-577ac433c188e9c0d1f21311",
                "clean.screen_app_usage_only",
                "clean.screen_app_usage_only: retain aggregation_type == APP_USAGE before cohort union",
                "2bab83b916897b855fd8719f90d76f2752c7be7c234ca761acd088da90d9def2",
            ),
            (
                "method-setting-3f07e9131d5492926afe8c63",
                "clean.screen_exclude.youtube_vanced",
                "clean.screen_exclude.youtube_vanced: app_name != YouTube Vanced",
                "5e593c0468120b0e35452329f46f6234a158c1aefef57880669eefd779e325b9",
            ),
            (
                "method-setting-6945d62974714b285e78cca0",
                "clean.screen_exclude.basic_daydreams",
                "clean.screen_exclude.basic_daydreams: app_name != Basic Daydreams",
                "16a8521864c9e4a4edacea8a4fb0f234ac1806b0770200a003f268dc2411d96f",
            ),
        ]
    );

    let retained = fixture
        .cases
        .iter()
        .filter(|case| {
            let actual = retain_app_usage_row(
                case.aggregation_type.as_deref(),
                case.app_name.as_deref(),
                &fixture.required_aggregation_type,
                &fixture.excluded_app_names,
            );
            assert_eq!(actual, case.expected_retained, "{}", case.source_row_id);
            actual
        })
        .map(|case| case.source_row_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        retained,
        [
            "ordinary",
            "case-variant",
            "space-variant",
            "ordinary-duplicate"
        ]
    );
}
