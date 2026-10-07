#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/daily_happiness_pivot_labels_socialcom_2013.json");

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
    pivot: f64,
    labels: Labels,
    observations: Vec<Observation>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Labels {
    below: i8,
    equal: i8,
    above: i8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    observation_id: String,
    score: f64,
    expected_label: i8,
}

#[test]
fn preserves_the_disclosed_below_equal_above_daily_happiness_classes() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-finite-scalar-pivot-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/socialcom.2013.118");

    let expected_settings = [
        (
            "method-setting-859db1341c366e052b69daed",
            "labels.class_not_happy",
            "labels.class_not_happy: {\"label\":-1,\"predicate\":\"score < 4\"}",
            "a5070117f0956286e9c81d968b0a64e84da81697c87f45260389b38b5053a3e8",
        ),
        (
            "method-setting-0e72d6265ee03fcb1d07b5a6",
            "labels.class_neutral",
            "labels.class_neutral: {\"label\":0,\"predicate\":\"score = 4\"}",
            "9509a53f278694b598e99af30c008266d7123802bb1124dd69881ad352fcf989",
        ),
        (
            "method-setting-944b443a92867aa4c05d57c4",
            "labels.class_happy",
            "labels.class_happy: {\"label\":1,\"predicate\":\"score > 4\"}",
            "ef9d7d88a21d3d20ee68d9bc24c0e7dc0008efdee70d67915c88e3e24caa1e82",
        ),
    ];
    assert_eq!(
        fixture.exact_canonical_settings.len(),
        expected_settings.len()
    );
    for (setting, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                setting.setting_id.as_str(),
                setting.parameter_key.as_str(),
                setting.source_observed_setting.as_str(),
                setting.source_value_sha256.as_str(),
            ),
            expected
        );
    }

    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("rank147.txt:155-166"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "299b50324299c85002330ac67bc02d33afa7b2865fd4c8f5379530c5c219b295"
    );
    assert!(fixture.source_artifacts[1].locator.contains("rank147.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "63dcaed448d25876d801e9eaef94df502a78036eec3a9012912b48b8bb2f19c9"
    );
    assert!(fixture.input_boundary.contains("already been constructed"));
    assert!(fixture.output_boundary.contains("exact equality"));
    for excluded_claim in [
        "does not construct",
        "does not enforce a scale range",
        "does not derive participant/day joins",
        "No tolerance",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot,
        fixture.labels.below,
        fixture.labels.equal,
        fixture.labels.above,
    )
    .expect("the source pivot is finite");
    assert_eq!(classifier.pivot(), 4.0);
    assert_eq!(classifier.categories(), (&-1, &0, &1));

    for observation in fixture.observations {
        assert!(
            observation.score.is_finite(),
            "{}",
            observation.observation_id
        );
        assert_eq!(
            classifier.category_for(observation.score),
            Ok(&observation.expected_label),
            "{}",
            observation.observation_id
        );
    }

    assert_eq!(
        FiniteScalarPivotClassifier::new(f64::NAN, -1_i8, 0, 1),
        Err(FiniteScalarPivotClassifierError::NonFinitePivot)
    );
    assert_eq!(
        classifier.category_for(f64::INFINITY),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
