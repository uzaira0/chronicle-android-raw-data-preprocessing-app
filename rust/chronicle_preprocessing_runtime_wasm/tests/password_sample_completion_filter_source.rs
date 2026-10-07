#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/password_sample_completion_filter_keyboard.json");

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
    minimum_completion_evidence: u8,
    dispositions: Vec<String>,
    samples: Vec<PasswordSample>,
    missing_predicate_case: MissingPredicateCase,
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
struct PasswordSample {
    observation_id: String,
    whole_password_typed_before_send: bool,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingPredicateCase {
    observation_id: String,
    whole_password_typed_before_send: Option<bool>,
    expected_error: String,
}

fn required_completion_predicate(value: Option<bool>) -> Result<bool, &'static str> {
    value.ok_or("whole_password_before_send_required")
}

#[test]
fn retains_only_samples_with_the_whole_password_typed_before_send() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-password-sample-completion-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2406367.2406384");
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
            "method-setting-64e5c8f54270755059d8b163",
            "usability.complete_filter",
            "usability.complete_filter: retain only correctly sent samples where whole password was typed before send",
            "11b5d3ffb9d20f56c7de53c78c72dea8a2c9f9a4032f6ed6dd202116b11f6977",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("corrective-packet-09-ranks330-381-20260831/text/347.txt:405-410"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "1ef2dbd6fa8cc53e97ac7d8eff56e566b55bdeac75c43b19526f26d6a627693f"
    );
    assert!(fixture
        .input_boundary
        .contains("whole password was typed before the Send action"));
    assert!(fixture.output_boundary.contains("retain it when true"));
    for excluded_claim in [
        "does not invent a second independent correctness predicate",
        "does not parse raw key or Send events",
        "does not reconstruct the typed password",
        "does not reproduce the study's manual dataset corrections",
        "does not calculate entry time, error rate",
        "missing whole-password-before-Send predicate fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![f64::from(fixture.minimum_completion_evidence)],
        fixture.dispositions,
    )
    .expect("the Boolean completion threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[1.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "exclude_incomplete".to_owned(),
            "retain_complete".to_owned(),
        ]
    );

    for sample in fixture.samples {
        assert_eq!(
            bucketizer
                .category_for(f64::from(
                    u8::from(sample.whole_password_typed_before_send,)
                ))
                .map(String::as_str),
            Ok(sample.expected_disposition.as_str()),
            "{}",
            sample.observation_id
        );
    }

    assert_eq!(
        required_completion_predicate(
            fixture
                .missing_predicate_case
                .whole_password_typed_before_send,
        ),
        Err(fixture.missing_predicate_case.expected_error.as_str()),
        "{}",
        fixture.missing_predicate_case.observation_id
    );
}
