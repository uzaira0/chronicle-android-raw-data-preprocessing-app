use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/exact_category_membership_filter_notification_study.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_artifact: SourceArtifact,
    source_runtime: String,
    exact_canonical_setting: CanonicalSetting,
    production_binding_status: String,
    input_boundary: String,
    output_boundary: String,
    allowed_values: Vec<String>,
    limitations: Vec<String>,
    cases: Vec<Case>,
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
    row_id: String,
    key: Option<String>,
    expected_retained: bool,
}

fn retain_exact_category(key: Option<&str>, allowed_values: &[String]) -> bool {
    key.is_some_and(|key| allowed_values.iter().any(|allowed| key == allowed))
}

#[test]
fn specifies_the_exact_source_category_filter_without_absorbing_later_cleaning() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-exact-category-membership-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1080/15213269.2024.2334025");
    assert!(fixture.source_artifact.locator.ends_with("data].R:610-618"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "2bd5bab0c9a917a64f347093972bff72e2b0b5cfd38539a1df229c65cdbd383b"
    );
    assert_eq!(fixture.source_runtime, "R 4.3.2 with dplyr");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-f1678dedade69eec5fc81829",
            "clean.social_categories",
            "clean.social_categories: from CATEGORY_USAGE inputs retain key == social or communication",
            "ef71431934eb7ada08027c0ae08ce6aa426f5398ef4280033a864c2a1e42b145",
        )
    );
    assert_eq!(
        fixture.production_binding_status,
        "missing_exact_category_membership_filter_binding"
    );
    assert_eq!(fixture.allowed_values, ["social", "communication"]);
    assert!(fixture.input_boundary.contains("CATEGORY_USAGE"));
    assert!(fixture.output_boundary.contains("preserve input order"));
    assert_eq!(fixture.limitations.len(), 3);

    let retained = fixture
        .cases
        .iter()
        .filter(|case| {
            let actual = retain_exact_category(case.key.as_deref(), &fixture.allowed_values);
            assert_eq!(actual, case.expected_retained, "{}", case.row_id);
            actual
        })
        .map(|case| case.row_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(retained, ["social", "communication", "social-duplicate"]);
}
