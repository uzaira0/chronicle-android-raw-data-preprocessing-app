#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_full_days_harbach_2016.json");

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
    full_day_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    full_day_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_full_day_count_required")
}

#[test]
fn excludes_participants_only_below_thirty_source_qualified_full_days() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2858036.2858267");
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
            "method-setting-91f671f5ed4f7d35dca6a5ce",
            "cohort.minimum_observation",
            "cohort.minimum_observation: exclude participants with fewer than 30 full days of data; 57 of 202 excluded",
            "ade871c66a78518c084befe32849429a515ce9206cad78d226d4bb35c2339c14",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-queue-a-20260831/evidence/rank22.txt:293-299"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "bca55fccaab4d7368190875715e7757dcfdbb21e59c275f4db055e502457c6b9"
    );
    assert!(fixture
        .input_boundary
        .contains("source-qualified full data days"));
    assert!(fixture.output_boundary.contains("strictly below 30"));
    for excluded_claim in [
        "does not define the event coverage",
        "does not assign timestamps to calendar days",
        "does not group day evidence",
        "missing participant count fails closed",
        "57-of-202 exclusion count is descriptive evidence",
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
    assert_eq!(bucketizer.thresholds(), &[30.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.full_day_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.full_day_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
