#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/daily_stress_binary_label_lepri_2014.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_identity_resolution: CanonicalIdentityResolution,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    score_range: ScoreRange,
    pivot_score: f64,
    cases: Vec<Case>,
    invalid_cases: Vec<InvalidCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalIdentityResolution {
    canonical_setting_id: String,
    alias_setting_id: String,
    source_extraction_id: String,
    resolution: String,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScoreRange {
    minimum_inclusive: f64,
    maximum_inclusive: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    case_id: String,
    daily_stress_score: f64,
    expected_code: u8,
    expected_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCase {
    case_id: String,
    daily_stress_score: Option<f64>,
    expected_error: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BinaryStressLabel {
    code: u8,
    name: &'static str,
}

fn validated_source_score(score: Option<f64>, range: &ScoreRange) -> Result<f64, &'static str> {
    let score = score.ok_or("daily_stress_score_required")?;
    if !score.is_finite() || score < range.minimum_inclusive || score > range.maximum_inclusive {
        return Err("daily_stress_score_must_be_finite_within_source_anchors");
    }
    Ok(score)
}

fn artifact<'a>(fixture: &'a Fixture, fragment: &str) -> &'a SourceArtifact {
    fixture
        .source_artifacts
        .iter()
        .find(|artifact| artifact.locator.contains(fragment))
        .unwrap_or_else(|| panic!("missing source artifact containing {fragment}"))
}

#[test]
fn source_neutral_pivot_preserves_the_daily_stress_label_boundary_and_neutral_assignment() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-daily-stress-binary-label-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2647868.2654933");

    let identity = &fixture.canonical_identity_resolution;
    assert_eq!(
        (
            identity.canonical_setting_id.as_str(),
            identity.alias_setting_id.as_str(),
            identity.source_extraction_id.as_str(),
            identity.resolution.as_str(),
            identity.tombstone_registry_sha256.as_str(),
        ),
        (
            "method-setting-08dbec13e6499e2df3d79733",
            "method-setting-96198e8493f540e031319156",
            "extraction-a3036fc657c9177e7aa0",
            "superseded_by",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        )
    );
    assert_eq!(
        fixture.exact_canonical_setting.setting_id,
        identity.canonical_setting_id
    );
    assert_eq!(
        (
            fixture.exact_canonical_setting.parameter_key.as_str(),
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
            "outcome.binary_label",
            "outcome.binary_label: {\"labels\":{\"0\":\"not stressed\",\"1\":\"stressed\"},\"rules\":{\"not_stressed\":\"score <= 4\",\"stressed\":\"score > 4\"},\"neutral_score_assigned_to\":0}",
            "59c81d5e7344e465a1e1b0de372aa04d0e72dc62ab8b0ea6637b2778c2398f1d",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 5);
    assert_eq!(
        artifact(&fixture, "fp266-lepri.tex;lines=588-598").sha256,
        "9ebfdf1dd12d842b8943672d7f94cfe6f984a73ff14261a267c88285c0c0b213"
    );
    assert_eq!(
        artifact(&fixture, "080-primary.pdf").sha256,
        "cec0119cecc151a885b1da2a4562f9604e374e3c01cdc566f325f666495a61d2"
    );
    assert_eq!(
        artifact(&fixture, "text/080.txt").sha256,
        "ca9fd45f81f94a040de49d29bd334c24b30c0372d5c8a5ab607194b3a04c2252"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "ab79e10840323b1401ea0ee7907164af03e603ed09d07bd88785ab605280785e"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture
        .input_boundary
        .contains("closed anchor range 1 through 7"));
    assert!(fixture
        .output_boundary
        .contains("including the neutral anchor 4"));
    for residue in [
        "seven items scale",
        "does not infer questionnaire construction",
        "does not disclose raw response serialization",
        "without imposing integer-only input",
        "missing, nonfinite, below-anchor, or above-anchor",
        "day attribution",
        "consecutive-data cohort gate",
        "normalization",
        "participant-disjoint train/test splitting",
        "not released target-analysis code or data",
    ] {
        assert!(
            fixture
                .limitations
                .iter()
                .any(|limitation| limitation.contains(residue)),
            "missing limitation for {residue}"
        );
    }

    let not_stressed = BinaryStressLabel {
        code: 0,
        name: "not stressed",
    };
    let stressed = BinaryStressLabel {
        code: 1,
        name: "stressed",
    };
    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_score,
        not_stressed.clone(),
        not_stressed,
        stressed,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), 4.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!((below.code, equal.code, above.code), (0, 0, 1));

    for case in fixture.cases {
        let score = validated_source_score(Some(case.daily_stress_score), &fixture.score_range)
            .expect("fixture case is within source anchors");
        let label = classifier
            .category_for(score)
            .expect("validated source score is finite");
        assert_eq!(label.code, case.expected_code, "{}", case.case_id);
        assert_eq!(label.name, case.expected_name, "{}", case.case_id);
    }
    for case in fixture.invalid_cases {
        assert_eq!(
            validated_source_score(case.daily_stress_score, &fixture.score_range),
            Err(case.expected_error.as_str()),
            "{}",
            case.case_id
        );
    }
    assert_eq!(
        validated_source_score(Some(f64::NAN), &fixture.score_range),
        Err("daily_stress_score_must_be_finite_within_source_anchors")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
