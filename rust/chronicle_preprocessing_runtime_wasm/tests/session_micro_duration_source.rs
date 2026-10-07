#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/session_micro_duration_academic_3468192.json");

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
    pivot_seconds: f64,
    sessions: Vec<SessionDuration>,
    invalid_input_cases: Vec<InvalidInputCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalIdentityResolution {
    setting_id: String,
    superseded_extraction_id: String,
    alias_tombstone_disposition: String,
    alias_tombstone_registry_sha256: String,
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
struct SessionDuration {
    session_id: String,
    source_defined_duration_seconds: f64,
    expected_category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInputCase {
    session_id: String,
    source_defined_duration_seconds: Option<f64>,
    expected_error: String,
}

fn validated_duration_seconds(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("source_defined_session_duration_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("source_defined_session_duration_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn classifies_fifteen_seconds_as_micro_without_claiming_session_reconstruction() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-session-micro-duration-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3429360.3468192");
    assert_eq!(
        (
            fixture.canonical_identity_resolution.setting_id.as_str(),
            fixture
                .canonical_identity_resolution
                .superseded_extraction_id
                .as_str(),
            fixture
                .canonical_identity_resolution
                .alias_tombstone_disposition
                .as_str(),
            fixture
                .canonical_identity_resolution
                .alias_tombstone_registry_sha256
                .as_str(),
        ),
        (
            "method-setting-06352b6f143bde0daf1066ba",
            "extraction-381d9bfaca7066d98ab6",
            "canonical projected setting has no alias or tombstone entry",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        )
    );
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
            "method-setting-06352b6f143bde0daf1066ba",
            "sessions.micro",
            "sessions.micro: duration <=15 seconds",
            "64bb4472c477dcc9c1dff55b91854d25c3ec4bc1407e7f6f6471ff6c8af283d2",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("text/360.txt:186-201"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "9300cc3091f69f5a6b07c54995b783672c5fcfe16f7bb90c01b8db97317025ff"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "f714a8cdcf5911c105217acf800a2ec5ad47023dad0c43085d41631a03554b0e"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "03e335522e628862b3b05eef97e99aac1c0517af27f21bbf73c833f43f933225"
    );
    assert_eq!(
        fixture.source_artifacts[3].sha256,
        "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5"
    );
    assert!(fixture
        .input_boundary
        .contains("already-reconstructed app-usage session"));
    assert!(fixture.output_boundary.contains("equality remains micro"));
    for excluded_claim in [
        "greater-than-45-second inter-app break rule constructs sessions upstream",
        "two duration-calculation methods",
        "does not disclose timestamp ordering",
        "no sub-second measurement policy is inferred",
        "review and greater-than-60-second engage categories remain separate",
        "Negative, missing, or nonfinite duration fails closed",
        "No study app, source code, dataset",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier =
        FiniteScalarPivotClassifier::new(fixture.pivot_seconds, "micro", "micro", "not_micro")
            .expect("source duration pivot is finite");
    assert_eq!(classifier.pivot(), 15.0);
    assert_eq!(classifier.categories(), (&"micro", &"micro", &"not_micro"));

    for session in fixture.sessions {
        let duration_seconds =
            validated_duration_seconds(Some(session.source_defined_duration_seconds))
                .expect("fixture duration satisfies source adapter precondition");
        assert_eq!(
            classifier.category_for(duration_seconds),
            Ok(&session.expected_category.as_str()),
            "{}",
            session.session_id
        );
    }

    for invalid_case in fixture.invalid_input_cases {
        assert_eq!(
            validated_duration_seconds(invalid_case.source_defined_duration_seconds),
            Err(invalid_case.expected_error.as_str()),
            "{}",
            invalid_case.session_id
        );
    }
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
