#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_es_observations_pspp0000469.json");

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
    initial_sensing_row_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    initial_sensing_row_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_initial_sensing_row_count_required")
}

#[test]
fn retains_participants_at_the_fourteen_initial_sensing_row_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1037/pspp0000469");
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
            "method-setting-fe3940aa365717252569bced",
            "quality.participant_minimum_es",
            "quality.participant_minimum_es: retain participants with at least 14 ES observations",
            "806d692a174f7959f4797885c312c0880939a5bf551205871a1ab23bef97a8cc",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "rank203-osf-b7krz/osfstorage/Feature_Engineering/04_SOURCE_ExclusionCriteria.R:5-9,28-31"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "fb9eb6fa5ae224d9a840fe2211f572b2d097c412e510360bf6f32928b5ea123d"
    );
    assert!(fixture
        .input_boundary
        .contains("initially loaded sensingVariables.rds"));
    assert!(fixture
        .input_boundary
        .contains("before applying its later exclusions"));
    assert!(fixture.output_boundary.contains("at or above 14"));
    for excluded_claim in [
        "does not load or construct sensingVariables.rds",
        "does not group sensing rows",
        "does not reinterpret the source row count",
        "separate adjacent source operations",
        "missing per-user row count fails closed",
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
    assert_eq!(bucketizer.thresholds(), &[14.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.initial_sensing_row_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.initial_sensing_row_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
