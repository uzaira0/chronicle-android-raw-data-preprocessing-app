#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_gps_hour_coverage_s41598_2019.json");

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
    minimum_retained_percent: f64,
    dispositions: Vec<String>,
    participants: Vec<ParticipantCoverage>,
    missing_coverage_case: MissingCoverageCase,
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
struct ParticipantCoverage {
    participant_id: String,
    gps_hours_available_percent: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCoverageCase {
    participant_id: String,
    gps_hours_available_percent: Option<f64>,
    expected_error: String,
}

fn required_coverage_percent(value: Option<f64>) -> Result<f64, &'static str> {
    value.ok_or("participant_gps_hour_coverage_percent_required")
}

#[test]
fn retains_users_at_the_eighty_percent_gps_hour_coverage_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-percentage-source-fixture/v1"
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
            "method-setting-c0af8e44de56c0abaabcc7ff",
            "gps.coverage_gate",
            "gps.coverage_gate: {\"hours_available_percent\":80,\"comparator\":\"at_least\"}",
            "58d150f5ae0f03312a6c09fdc6ad8cf34bf373bd9295f7d78e9987c35582ac4f",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-queue-a-20260831/evidence/rank11.txt:81-94,398-402"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "d720426185ece4744a2cec4dcf47ac6e5b73f6dfda46bcd6b3b786bccdf530de"
    );
    assert!(fixture
        .input_boundary
        .contains("observation hours for which GPS locations are available"));
    assert!(fixture.output_boundary.contains("at or above 80%"));
    for excluded_claim in [
        "does not select accepted location observations",
        "does not group observations by user",
        "separate user-level source gate",
        "separate downstream source operations",
        "missing GPS-hour coverage percentage fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_percent],
        fixture.dispositions,
    )
    .expect("the source percentage threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[80.0]);
    assert_eq!(
        bucketizer.categories(),
        &["filter_user".to_owned(), "retain_user".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.gps_hours_available_percent)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_coverage_percent(fixture.missing_coverage_case.gps_hours_available_percent,),
        Err(fixture.missing_coverage_case.expected_error.as_str()),
        "{}",
        fixture.missing_coverage_case.participant_id
    );
}
