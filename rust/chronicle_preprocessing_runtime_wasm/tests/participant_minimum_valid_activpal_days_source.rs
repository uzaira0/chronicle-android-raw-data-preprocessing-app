#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_valid_activpal_days_pastime.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
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
    valid_activpal_day_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    valid_activpal_day_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_valid_activpal_day_count_required")
}

#[test]
fn excludes_participants_only_below_four_palanalysis_valid_activpal_days() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/s10865-024-00499-x");

    let expected_settings = [
        (
            "method-setting-atomic-69156158af538c61d60d",
            "analysis.minimum_valid_days",
            "analysis.minimum_valid_days: 4",
            "b9b9455f2833afe0da36c2688d27b64022d0ad5dd3fe74562fc61c5f2c2a473c",
        ),
        (
            "method-setting-atomic-9cd62c7a581c151683c0",
            "analysis.insufficient_valid_days_disposition",
            "analysis.insufficient_valid_days_disposition: Exclude participant",
            "0bff44dcdcc7c9c43cafa643d2b2cf8a40a2b5489a4c0725d3a0f37d01f1f99a",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 2);
    for (actual, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                actual.setting_id.as_str(),
                actual.parameter_key.as_str(),
                actual.source_observed_setting.as_str(),
                actual.source_value_sha256.as_str(),
            ),
            expected
        );
    }
    assert!(fixture.source_artifact.locator.ends_with(
        "strict-screen-native-ranks37-73-20260831T0415Z/text/60-pastime.txt:176-177,191-198"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "b1dc48785f5c0db64bb3b19349ed7304a315ea8c0abb50d9a8a5a073471bbd53"
    );
    assert!(fixture
        .input_boundary
        .contains("PALanalysis-valid activPAL days"));
    assert!(fixture.output_boundary.contains("strictly below four"));
    for excluded_claim in [
        "does not classify activPAL wear time",
        "does not group activPAL observations",
        "are not substituted for activPAL-valid days",
        "missing participant count fails closed",
        "two excluded participants are descriptive evidence",
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
    assert_eq!(bucketizer.thresholds(), &[4.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "exclude_participant".to_owned(),
            "retain_participant".to_owned()
        ]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.valid_activpal_day_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.valid_activpal_day_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
