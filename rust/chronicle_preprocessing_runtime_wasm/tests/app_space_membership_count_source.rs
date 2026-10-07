#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/app_space_membership_count_s41598_2019.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifact: SourceArtifact,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    window_weeks: u64,
    minimum_included_count: u64,
    dispositions: Vec<String>,
    user_apps: Vec<UserAppCount>,
    missing_count_case: MissingCountCase,
    mismatched_window_case: MismatchedWindowCase,
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
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserAppCount {
    observation_id: String,
    use_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    observation_id: String,
    use_count: Option<u64>,
    expected_error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MismatchedWindowCase {
    observation_id: String,
    window_weeks: u64,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("user_app_use_count_required")
}

fn require_source_window(actual_weeks: u64, required_weeks: u64) -> Result<(), &'static str> {
    if actual_weeks == required_weeks {
        Ok(())
    } else {
        Err("app_space_window_must_be_20_weeks")
    }
}

#[test]
fn includes_apps_at_two_uses_in_the_twenty_week_app_space() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-windowed-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1038/s41598-019-47493-x");
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
            "method-setting-67e693711b7a065ce63386f3",
            "space.app_membership",
            "space.app_membership: {\"minimum_uses\":2,\"window_weeks\":20}",
            "dd7616ee87bebbbf85c9c83e0a4472bcfcf07219ce98118c237117725b7daae3",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-queue-a-20260831/evidence/rank11.txt:137-145"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "d720426185ece4744a2cec4dcf47ac6e5b73f6dfda46bcd6b3b786bccdf530de"
    );
    assert!(fixture
        .input_boundary
        .contains("source-aligned 20-week window"));
    assert!(fixture.output_boundary.contains("at or above two uses"));
    for excluded_claim in [
        "does not define or identify an application-use event",
        "does not group app-use events",
        "does not construct, anchor, or slide",
        "separate downstream source operations",
        "missing user-app use count fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }
    require_source_window(fixture.window_weeks, 20).expect("fixture uses exact source window");

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_included_count as f64],
        fixture.dispositions,
    )
    .expect("the source count threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[2.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "outside_app_space".to_owned(),
            "inside_app_space".to_owned(),
        ]
    );

    for user_app in fixture.user_apps {
        assert_eq!(
            bucketizer
                .category_for(user_app.use_count as f64)
                .map(String::as_str),
            Ok(user_app.expected_disposition.as_str()),
            "{}",
            user_app.observation_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.use_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.observation_id
    );
    assert_eq!(
        require_source_window(
            fixture.mismatched_window_case.window_weeks,
            fixture.window_weeks
        ),
        Err(fixture.mismatched_window_case.expected_error.as_str()),
        "{}",
        fixture.mismatched_window_case.observation_id
    );
}
