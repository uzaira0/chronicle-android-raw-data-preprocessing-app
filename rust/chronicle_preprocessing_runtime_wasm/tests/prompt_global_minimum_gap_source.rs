#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/prompt_global_minimum_gap_moa2.json");

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
    minimum_permitted_gap_minutes: f64,
    dispositions: Vec<String>,
    candidate_prompts: Vec<CandidatePrompt>,
    invalid_input_cases: Vec<InvalidInputCase>,
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
struct CandidatePrompt {
    candidate_id: String,
    elapsed_minutes_since_previous_prompt: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInputCase {
    candidate_id: String,
    elapsed_minutes_since_previous_prompt: Option<f64>,
    expected_error: String,
}

fn validated_elapsed_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("elapsed_since_previous_prompt_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("elapsed_since_previous_prompt_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn permits_a_candidate_only_at_or_above_the_global_fifteen_minute_gap() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-prompt-global-minimum-gap-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2968219.2968302");
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
            "method-setting-9394a68ebba99f6c81d9b845",
            "prompt.global_gap",
            "prompt.global_gap: at least 15 minutes between any two prompts",
            "386abfdd27b50067be43ffaf13baf08e3a8aa2354291ff94efe931adf9172085",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("text/357.txt:108-114"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "758788f984b88a328c855c98e7363509ed8b025e14f57b0c4d8a88ef17db08a2"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "5d7e3f6afe00bbd31350968444575475339717d4ea2cc982e0acfd195b9c700a"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "1b04586877ab30b6d49f2d94a64b99f1b657b0fefc6aece09c903be96e300d64"
    );
    assert!(fixture
        .input_boundary
        .contains("immediately previous emitted prompt"));
    assert!(fixture
        .output_boundary
        .contains("permit it at equality or above"));
    for excluded_claim in [
        "does not define the no-prior-prompt case",
        "whether prompt means scheduled, displayed, or successfully delivered",
        "does not disclose clock source",
        "no sub-minute policy is inferred",
        "collision or priority handling",
        "separate five-minute, screen-active guard",
        "No study-version source",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_permitted_gap_minutes],
        fixture.dispositions,
    )
    .expect("source gap threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[15.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "suppress_candidate".to_owned(),
            "permit_candidate".to_owned()
        ]
    );

    for candidate in fixture.candidate_prompts {
        let elapsed_minutes =
            validated_elapsed_minutes(Some(candidate.elapsed_minutes_since_previous_prompt))
                .expect("fixture duration satisfies the source adapter precondition");
        assert_eq!(
            bucketizer.category_for(elapsed_minutes).map(String::as_str),
            Ok(candidate.expected_disposition.as_str()),
            "{}",
            candidate.candidate_id
        );
    }

    for invalid_case in fixture.invalid_input_cases {
        assert_eq!(
            validated_elapsed_minutes(invalid_case.elapsed_minutes_since_previous_prompt),
            Err(invalid_case.expected_error.as_str()),
            "{}",
            invalid_case.candidate_id
        );
    }
    assert_eq!(
        bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
