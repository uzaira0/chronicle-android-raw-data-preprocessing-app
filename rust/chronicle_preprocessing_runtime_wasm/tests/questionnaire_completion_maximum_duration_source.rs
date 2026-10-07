#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/questionnaire_completion_maximum_duration_pspp0000469.json");

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
    maximum_retained_minutes: f64,
    categories: Categories,
    questionnaires: Vec<Questionnaire>,
    invalid_completion_durations: Vec<InvalidCompletionDuration>,
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
#[serde(deny_unknown_fields)]
struct Categories {
    below: String,
    equal: String,
    above: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Questionnaire {
    case_id: String,
    completion_minutes: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCompletionDuration {
    case_id: String,
    completion_minutes: Option<f64>,
    expected_error: String,
}

fn validated_completion_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("questionnaire_completion_minutes_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("questionnaire_completion_minutes_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn excludes_only_questionnaires_strictly_over_fifteen_minutes() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-questionnaire-maximum-completion-duration-source-fixture/v1"
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
            "method-setting-81aa8e8b5e23b45f8267a498",
            "quality.es_completion_filter",
            "quality.es_completion_filter: exclude ES questionnaires taking more than 15 minutes",
            "f7d427fbd6b8ecb6493381d78c64f9885ce7a97f0594a61df91fa765c949905a",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("Feature_Engineering/02_SOURCE_FeatureExtraction.R:89-99"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "edcf64f7e5ceb1a5e2dd48dd08bc7542dd6abe8865eff0f9ea372997fd0bbf3d"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("Online Supplemental Material.pdf:pages=1-2"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "72e0a7a61c67ef839bf5cfb55635fc786ee91be162e4894d2aef92a2f4d43fe2"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "46a848981ae6492d52589d2260d05b8263ccc75920d68178837aa8902e72fa22"
    );
    assert!(fixture
        .input_boundary
        .contains("corrected questionnaire start"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 15 minutes"));
    for excluded_claim in [
        "does not identify experience-sampling questionnaires",
        "Timestamp correction",
        "no integer rounding",
        "less than 60 minutes",
        "fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.maximum_retained_minutes,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source duration threshold is finite");
    assert_eq!(classifier.pivot(), 15.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("retain", "retain", "exclude")
    );

    for questionnaire in fixture.questionnaires {
        let completion_minutes =
            validated_completion_minutes(Some(questionnaire.completion_minutes))
                .expect("fixture duration satisfies the source adapter boundary");
        assert_eq!(
            classifier
                .category_for(completion_minutes)
                .map(String::as_str),
            Ok(questionnaire.expected_disposition.as_str()),
            "{}",
            questionnaire.case_id
        );
    }
    for invalid in fixture.invalid_completion_durations {
        assert_eq!(
            validated_completion_minutes(invalid.completion_minutes),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.case_id
        );
    }
    assert_eq!(
        validated_completion_minutes(Some(f64::NAN)),
        Err("questionnaire_completion_minutes_must_be_nonnegative_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
