#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/communication_jaro_winkler_threshold_albayram_2016.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_identity: CanonicalIdentity,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    pivot_percent: f64,
    categories: Categories,
    observations: Vec<Observation>,
    invalid_observations: Vec<InvalidObservation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalIdentity {
    setting_id: String,
    source_current_setting_id: String,
    source_extraction_id: String,
    #[serde(rename = "sourceExecutionUnitId")]
    source_execution_unit: String,
    alias_resolution: String,
    tombstone_registry_sha256: String,
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
struct Observation {
    case_id: String,
    similarity_percent: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    similarity_percent: Option<f64>,
    expected_error: String,
}

fn validated_similarity_percent(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("communication_similarity_percent_required")?;
    if !value.is_finite() {
        return Err("communication_similarity_percent_must_be_finite");
    }
    if !(0.0..=100.0).contains(&value) {
        return Err("communication_similarity_percent_out_of_range");
    }
    Ok(value)
}

fn artifact<'a>(fixture: &'a Fixture, fragment: &str) -> &'a SourceArtifact {
    fixture
        .source_artifacts
        .iter()
        .find(|artifact| artifact.locator.contains(fragment))
        .unwrap_or_else(|| panic!("missing source artifact containing {fragment}"))
}

#[test]
fn communication_answers_are_correct_only_strictly_above_eighty_five_percent() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-communication-jaro-winkler-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1186/s13673-016-0072-3");

    let identity = &fixture.canonical_identity;
    assert_eq!(
        (
            identity.setting_id.as_str(),
            identity.source_current_setting_id.as_str(),
            identity.source_extraction_id.as_str(),
            identity.source_execution_unit.as_str(),
            identity.alias_resolution.as_str(),
            identity.tombstone_registry_sha256.as_str(),
        ),
        (
            "method-setting-c2058445d529153381cac8a7",
            "method-setting-c2058445d529153381cac8a7",
            "extraction-c2058445d529153381cac8a7",
            "dynamic-security-0072:communication_question",
            "canonical_current_no_alias_or_tombstone",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        )
    );
    assert_eq!(
        fixture.exact_canonical_setting.setting_id,
        identity.setting_id
    );
    assert_eq!(
        (
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "communication.score_threshold",
            "communication.score_threshold: {\"comparator\":\">\",\"value\":85,\"unit\":\"percent\",\"pass_score\":\"correct\",\"fail_score\":0}",
            "7df695df7bcbf7362ce5c47197ebb607439cc1612c2d410e34876094ea23ef42",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert_eq!(
        artifact(&fixture, "s13673-fulltext-layout.txt:526-539").sha256,
        "dc076e537744bea22bb6f50f28cb4f635dadcdc90378e5e299a6200b13b1a190"
    );
    assert_eq!(
        artifact(&fixture, "s13673-fulltext.pdf").sha256,
        "99f6cfcf5bb973503fc0e55c7a13ac4d521688c746a9b7b18a4addee69a12bff"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "fd62368ccc3f583f8e963317c92e01385f18ec87b62b0823d692f1e3e86b6abe"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture
        .input_boundary
        .contains("Jaro-Winkler similarity score"));
    assert!(fixture.input_boundary.contains("0 through 100"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 85 percent"));
    for residue in [
        "already-derived similarity percentage",
        "missing, nonfinite, negative, or above-100",
        "no rescaling",
        "question generator",
        "multi-question session score",
        "Call/SMS log collection",
        "reported authentication analyses",
    ] {
        assert!(
            fixture
                .limitations
                .iter()
                .any(|limitation| limitation.contains(residue)),
            "missing limitation for {residue}"
        );
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_percent,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), 85.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("score_0", "score_0", "correct")
    );

    for observation in fixture.observations {
        let value = validated_similarity_percent(Some(observation.similarity_percent))
            .expect("fixture similarity percentage is valid");
        assert_eq!(
            classifier.category_for(value).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_similarity_percent(observation.similarity_percent),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_similarity_percent(Some(f64::NAN)),
        Err("communication_similarity_percent_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
