#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/experience_sampling_minimum_answer_gap_per_2309.json");

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
    minimum_retained_gap_minutes: f64,
    dispositions: Vec<String>,
    candidate_answers: Vec<CandidateAnswer>,
    invalid_gap_cases: Vec<InvalidGapCase>,
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
struct CandidateAnswer {
    case_id: String,
    elapsed_minutes_since_previous_answer: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidGapCase {
    case_id: String,
    elapsed_minutes_since_previous_answer: Option<f64>,
    expected_error: String,
}

fn validated_gap_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("elapsed_minutes_since_previous_answer_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("elapsed_minutes_since_previous_answer_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn removes_only_answers_strictly_under_the_thirty_minute_gap() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-experience-sampling-minimum-answer-gap-source-fixture/v1"
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
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-9853159ea7a1ec5f47c85d34",
            "preparation.minimum_spacing",
            "preparation.minimum_spacing: remove surveys less than 30 minutes after the previous survey answer",
            "2450aef6cee0e0fdcdd3528fe6ea7460fdd4b3b2c999d9b16f06d5c55a3e20ef",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("processing/data_preparation/prepare-data-REVISION2.Rmd:51-63"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "0da09adaa61068b4e410c519a7e9fb365290e8cf79931fc144bb632b2276fcfd"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "990b3f3289030e18c5ed2abf6b0766af6616787a020f529545f2fb9f4d9c780b"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "83d64d098978094763d197968c262b0ea200a38b6e46b1c91ef57eca101cb253"
    );
    assert!(fixture
        .input_boundary
        .contains("previous experience-sampling survey answer"));
    assert!(fixture.output_boundary.contains("strictly less than 30"));
    for excluded_claim in [
        "does not include that helper's implementation",
        "selection of the previous answer",
        "15,699 rows before and 15,682 after",
        "No integer rounding",
        "fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_gap_minutes],
        fixture.dispositions,
    )
    .expect("source gap threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[30.0]);
    assert_eq!(
        bucketizer.categories(),
        &["remove".to_owned(), "retain".to_owned()]
    );

    for answer in fixture.candidate_answers {
        let gap = validated_gap_minutes(Some(answer.elapsed_minutes_since_previous_answer))
            .expect("fixture gap satisfies the source adapter boundary");
        assert_eq!(
            bucketizer.category_for(gap).map(String::as_str),
            Ok(answer.expected_disposition.as_str()),
            "{}",
            answer.case_id
        );
    }
    for invalid in fixture.invalid_gap_cases {
        assert_eq!(
            validated_gap_minutes(invalid.elapsed_minutes_since_previous_answer),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.case_id
        );
    }
    assert_eq!(
        bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
