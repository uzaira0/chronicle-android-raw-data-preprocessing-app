#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/participant_minimum_esm_count_per_2309.json");

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
    minimum_retained_count: u64,
    dispositions: Vec<String>,
    participants: Vec<ParticipantCount>,
    missing_count_case: MissingCountCase,
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
struct ParticipantCount {
    participant_id: String,
    response_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    response_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_esm_response_count_required")
}

#[test]
fn retains_android_participants_at_the_one_esm_response_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture
                .exact_canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-f0b202a476f3b87b72455d14",
            "cohort.require_one_esm",
            "cohort.require_one_esm: Android participant must provide at least one experience-sampling response",
            "7a07567e8a932efff2c45fa62f60d99ca60e1f95af00dea772d860aa03d62cfd",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-06-ranks174-223-20260831/text/183-1-b3facb592d62.txt:208-219"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "990b3f3289030e18c5ed2abf6b0766af6616787a020f529545f2fb9f4d9c780b"
    );
    assert!(fixture.input_boundary.contains("per Android participant"));
    assert!(fixture.output_boundary.contains("at least one response"));
    for excluded_claim in [
        "does not identify or deduplicate",
        "does not group responses",
        "Android-platform eligibility is a separate upstream",
        "missing participant count fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_count as f64],
        fixture.dispositions,
    )
    .expect("the source count threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[1.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.response_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.response_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
