#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!(
    "fixtures/participant_minimum_authentication_training_vector_count_tifs_2015.json"
);

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
    training_vector_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    training_vector_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_training_vector_count_required")
}

#[test]
fn retains_users_at_the_eighty_authentication_training_vector_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/tifs.2015.2506542");
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
            "method-setting-9ecc557d468c83a74e47b9cb",
            "authentication.minimum_training_vectors",
            "authentication.minimum_training_vectors: {\"comparator\":\"at least\",\"value\":80}",
            "acd8ac1cd9ac5dff7c5bd0cf4ea6a1b63716ef6a251849cb2e9a2f92e85f488c",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-packet-04-ranks-074-123-20260831/text/112.txt:278-291"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "769cd3fcfeacc85e78a0dd7b1a11c75f615ac115ac93c1ece6d28c3cd7bf44fc"
    );
    assert!(fixture.input_boundary.contains("training vectors per user"));
    assert!(fixture.output_boundary.contains("at or above 80"));
    for excluded_claim in [
        "does not select portrait-orientation observations",
        "does not construct HMOG tap vectors",
        "does not group or count training vectors",
        "separate downstream source operations",
        "missing per-user training-vector count fails closed",
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
    assert_eq!(bucketizer.thresholds(), &[80.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "discard_from_authentication".to_owned(),
            "retain_for_authentication".to_owned(),
        ]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.training_vector_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.training_vector_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
