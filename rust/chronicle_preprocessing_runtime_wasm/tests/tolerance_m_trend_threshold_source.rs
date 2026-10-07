#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/tolerance_m_trend_threshold_lin_2017.json");

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
    pivot_m_trend: f64,
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
    superseded_alias_setting_ids: Vec<String>,
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
    m_trend: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    m_trend: Option<f64>,
    expected_error: String,
}

fn validated_m_trend(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("m_trend_required")?;
    if !value.is_finite() {
        return Err("m_trend_must_be_finite");
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
fn tolerance_requires_m_trend_strictly_above_zero() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-tolerance-m-trend-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.4088/jcp.15m10310");

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
            "method-setting-5b1144a46bc1ce3713e5c905",
            "method-setting-5b1144a46bc1ce3713e5c905",
            "extraction-ed0490b2d5b9b4e60b69",
            "screen-epoch-trend-15m10310:protocol.tolerance_threshold",
            "canonical_current_two_superseded_aliases",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        )
    );
    assert_eq!(
        identity.superseded_alias_setting_ids,
        [
            "method-setting-6afac1ef44f8ec2c67cc045b",
            "method-setting-atomic-b416205a29c2ca345e74",
        ]
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
            "protocol.tolerance_threshold",
            "protocol.tolerance_threshold: {\"criterion\":\"criterionapp A3\",\"feature\":\"M-trend\",\"operator\":\"strictly greater than\",\"threshold\":0,\"inherited_from_reference\":12}",
            "c1d4c56b5813cdc0798c687b1d52c7f6974b45403255b928d6777291c589f9aa",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert_eq!(
        artifact(&fixture, "lin-2017-app-measures.txt").sha256,
        "776fa598cac4d28b198263bd5ea5a984d11515e67564444b242df0d1e0723e6e"
    );
    assert_eq!(
        artifact(&fixture, "app-measures-addiction-2017/primary.pdf").sha256,
        "1396f31fd2d4028a17fd643b534d820e0f5e48d69205787a43f096b41be9409e"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "769abdeaa949dfd90569c022865f30d8c5d9e9d5d5d5e922f0d382c9ed2792a8"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture
        .input_boundary
        .contains("empirical mode decomposition"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than zero"));
    for residue in [
        "psychiatric diagnosis",
        "inherited from reference 12",
        "does not release the exact signal",
        "missing or nonfinite M-trend fails closed",
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
        fixture.pivot_m_trend,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), 0.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("not_tolerance", "not_tolerance", "tolerance")
    );

    for observation in fixture.observations {
        let m_trend =
            validated_m_trend(Some(observation.m_trend)).expect("fixture M-trend is finite");
        assert_eq!(
            classifier.category_for(m_trend).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_m_trend(observation.m_trend),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_m_trend(Some(f64::NAN)),
        Err("m_trend_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
