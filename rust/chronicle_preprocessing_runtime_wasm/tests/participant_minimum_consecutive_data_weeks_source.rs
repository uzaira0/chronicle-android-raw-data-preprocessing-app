#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_consecutive_data_weeks_lepri_2014.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    minimum_retained_weeks: f64,
    dispositions: Vec<String>,
    participants: Vec<ParticipantDuration>,
    missing_duration_case: MissingDurationCase,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_clause: String,
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
struct ParticipantDuration {
    participant_id: String,
    consecutive_data_weeks: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingDurationCase {
    participant_id: String,
    consecutive_data_weeks: Option<f64>,
    expected_error: String,
}

fn required_duration(duration_weeks: Option<f64>) -> Result<f64, &'static str> {
    duration_weeks.ok_or("participant_consecutive_data_duration_required")
}

#[test]
fn retains_equality_without_inventing_consecutive_data_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-consecutive-data-weeks-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2647868.2654933");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture.exact_canonical_setting.source_clause.as_str(),
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
            "method-setting-8564f76c3ce6576b1e10c475",
            "eligibility.consecutive_data_gate",
            "only subjects who had provided at least 2 weeks of consecutive data were used",
            "eligibility.consecutive_data_gate: {\"minimum\":\"at least 2 weeks\",\"consecutive\":true,\"eligible_subjects\":111}",
            "22ddc0be7a8a92d16b2bd6db68119b1a4902fd6425144faa11ededd6fe6a1954",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts[0]
        .locator
        .contains("arxiv-1410.5816v1-source.tar#member=fp266-lepri.tex;lines=317-321"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "9ebfdf1dd12d842b8943672d7f94cfe6f984a73ff14261a267c88285c0c0b213"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("text/080.txt:168-173"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "ca9fd45f81f94a040de49d29bd334c24b30c0372d5c8a5ab607194b3a04c2252"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "cec0119cecc151a885b1da2a4562f9604e374e3c01cdc566f325f666495a61d2"
    );
    assert!(fixture
        .input_boundary
        .contains("already adjudicated as the source's undefined consecutive-data span"));
    assert!(fixture
        .output_boundary
        .contains("retain equality or a longer duration"));
    for excluded_claim in [
        "does not identify which event, sensor, survey, or combined stream",
        "does not define gap tolerance",
        "not silently rewritten as fourteen complete participant-days",
        "missing or nonfinite",
        "111 eligible subjects",
        "Raw Android and stress-survey parsing",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer =
        OrderedThresholdBucketizer::new(vec![fixture.minimum_retained_weeks], fixture.dispositions)
            .expect("source duration threshold is finite");
    assert_eq!(bucketizer.thresholds(), &[2.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.consecutive_data_weeks)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }
    assert_eq!(
        required_duration(fixture.missing_duration_case.consecutive_data_weeks),
        Err(fixture.missing_duration_case.expected_error.as_str()),
        "{}",
        fixture.missing_duration_case.participant_id
    );
    assert_eq!(
        bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
