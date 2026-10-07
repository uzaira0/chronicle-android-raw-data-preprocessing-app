#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/phq9_depression_threshold_sultana_2020.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    score_range: ScoreRange,
    pivot: f64,
    categories: Categories,
    observations: Vec<Observation>,
    invalid_observations: Vec<InvalidObservation>,
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
struct ScoreRange {
    minimum_inclusive: f64,
    maximum_inclusive: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Categories {
    below: String,
    equal: String,
    above: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    case_id: String,
    phq9_score: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    phq9_score: Option<f64>,
    expected_error: String,
}

fn validated_source_score(score: Option<f64>, range: &ScoreRange) -> Result<f64, &'static str> {
    let score = score.ok_or("phq9_score_required")?;
    if !score.is_finite() || score < range.minimum_inclusive || score > range.maximum_inclusive {
        return Err("phq9_score_out_of_source_range");
    }
    Ok(score)
}

#[test]
fn one_pivot_exactly_partitions_both_complementary_phq9_settings() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-phq9-depression-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3410530.3414441");
    assert_eq!(fixture.exact_canonical_settings.len(), 2);
    assert_eq!(
        (
            fixture.exact_canonical_settings[0].setting_id.as_str(),
            fixture.exact_canonical_settings[0].parameter_key.as_str(),
            fixture.exact_canonical_settings[0].source_clause.as_str(),
            fixture.exact_canonical_settings[0]
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_settings[0]
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-994e2587e952171e362b00a0",
            "clinical.depressed",
            "PHQ-9 score at least 10 is depressed",
            "clinical.depressed: {\"comparator\":\">=\",\"threshold\":10}",
            "d0a7e41a51f961d46acb2b9f23f09f976371cac8fa854025eea030d5a6f1baf7",
        )
    );
    assert_eq!(
        (
            fixture.exact_canonical_settings[1].setting_id.as_str(),
            fixture.exact_canonical_settings[1].parameter_key.as_str(),
            fixture.exact_canonical_settings[1].source_clause.as_str(),
            fixture.exact_canonical_settings[1]
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_settings[1]
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-3aacecd369532cadd5475c42",
            "clinical.non_depressed",
            "PHQ-9 score below 10 is non-depressed",
            "clinical.non_depressed: {\"comparator\":\"<\",\"threshold\":10}",
            "1898068b829bbdd8526c21ef56dd76c665cbc3ef65db6732a1417d3b9700db70",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("text/359.txt:113-122"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "c72d2c5dcf2513ab3e8dcf1309fcb636e13396dc7f55c476c353b0827570fe86"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .contains("359-primary.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "de28468872ad2cb37c7683686382743b4b97f1b892ac9ed79670ec9fff677935"
    );
    assert!(fixture
        .input_boundary
        .contains("closed score range 0 through 27"));
    assert!(fixture
        .output_boundary
        .contains("equal to or above 10 as depressed"));
    for excluded_claim in [
        "does not infer questionnaire responses or score construction",
        "does not require integer-valued scores",
        "missing, nonfinite, or out-of-range",
        "18 depressed and 26 non-depressed",
        "UsageStats collection",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source threshold is finite");
    assert_eq!(classifier.pivot(), 10.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("non_depressed", "depressed", "depressed")
    );

    for observation in fixture.observations {
        let score = validated_source_score(Some(observation.phq9_score), &fixture.score_range)
            .expect("valid source-range score");
        assert_eq!(
            classifier.category_for(score).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_source_score(observation.phq9_score, &fixture.score_range),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_source_score(Some(f64::NAN), &fixture.score_range),
        Err("phq9_score_out_of_source_range")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
