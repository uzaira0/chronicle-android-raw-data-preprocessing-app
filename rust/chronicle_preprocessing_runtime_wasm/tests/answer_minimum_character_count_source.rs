#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/answer_minimum_character_count_hmog.json");

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
    minimum_characters: u64,
    dispositions: Vec<String>,
    answers: Vec<AnswerCount>,
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
struct AnswerCount {
    observation_id: String,
    character_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    observation_id: String,
    character_count: Option<u64>,
    expected_error: String,
}

fn required_character_count(value: Option<u64>) -> Result<u64, &'static str> {
    value.ok_or("answer_character_count_required")
}

#[test]
fn an_answer_meets_the_requirement_at_two_hundred_fifty_characters() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-answer-character-count-threshold-source-fixture/v1"
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
            "method-setting-f40dd0d3ae5d9d47c9738214",
            "study.minimum_characters_per_answer",
            "study.minimum_characters_per_answer: 250",
            "8a977db916d05518c18d2ee5fb169162ac0a0260f3ff758d82c735ee4430cdc7",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-packet-04-ranks-074-123-20260831/text/112.txt:249-250"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "769cd3fcfeacc85e78a0dd7b1a11c75f615ac115ac93c1ece6d28c3cd7bf44fc"
    );
    assert!(fixture
        .input_boundary
        .contains("already-derived nonnegative source-aligned character count"));
    assert!(fixture
        .output_boundary
        .contains("at or above 250 characters"));
    for excluded_claim in [
        "does not choose how a character is counted",
        "does not clean answer text",
        "does not construct questions, prompts",
        "does not determine completion",
        "does not extract touch or keystroke features",
        "missing answer character count fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_characters as f64],
        fixture.dispositions,
    )
    .expect("the source count threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[250.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "below_requirement".to_owned(),
            "meets_requirement".to_owned()
        ]
    );

    for answer in fixture.answers {
        assert_eq!(
            bucketizer
                .category_for(answer.character_count as f64)
                .map(String::as_str),
            Ok(answer.expected_disposition.as_str()),
            "{}",
            answer.observation_id
        );
    }

    assert_eq!(
        required_character_count(fixture.missing_count_case.character_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.observation_id
    );
}
