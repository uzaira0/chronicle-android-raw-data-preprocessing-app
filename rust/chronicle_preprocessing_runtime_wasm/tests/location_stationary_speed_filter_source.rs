#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/location_stationary_speed_filter_places_activities.json");

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
    pivot_speed_kmh: f64,
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
    speed_kmh: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    speed_kmh: Option<f64>,
    expected_error: String,
}

fn validated_speed_kmh(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("location_speed_kmh_required")?;
    if !value.is_finite() {
        return Err("location_speed_kmh_must_be_finite");
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
fn strict_five_kmh_stationary_rule_excludes_equality_as_moving() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-location-stationary-speed-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3131901");

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
            "method-setting-2c6e3ce303322e1543eee698",
            "method-setting-2c6e3ce303322e1543eee698",
            "extraction-2c6e3ce303322e1543eee698",
            "location-3131901:location.motion_filter",
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
            "location.motion_filter",
            "location.motion_filter: {\"stationary_when\":\"speed_kmh < 5\",\"discard_moving\":true}",
            "21c40d25365e0477e39a88c4d1740141b957c5cafbb15b1fe2c1c9059f20f46b",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert_eq!(
        artifact(&fixture, "rank149.txt:284-301").sha256,
        "2f1a06612f0ea26c2c09c634850b99a91e125784f2f4412b74725d69b1ea146e"
    );
    assert_eq!(
        artifact(&fixture, "149-8LF898Z3").sha256,
        "f16aaeda02375162832f60e61b75819be4a10d15442ba50a4c0038282905e082"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "62f04437c016a6fd4d0ceee9be5be74ad0f3175949c7ee6dab96b2f0a4ba50c6"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture.input_boundary.contains("previous and current"));
    assert!(fixture.output_boundary.contains("strictly below 5 km/h"));
    for residue in [
        "accuracy filter",
        "first-row disposition",
        "missing or nonfinite speed fails closed",
        "Significant-place clustering",
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
        fixture.pivot_speed_kmh,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), 5.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("retain_stationary", "exclude_moving", "exclude_moving")
    );

    for observation in fixture.observations {
        let speed =
            validated_speed_kmh(Some(observation.speed_kmh)).expect("fixture speed is finite");
        assert_eq!(
            classifier.category_for(speed).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_speed_kmh(observation.speed_kmh),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_speed_kmh(Some(f64::NAN)),
        Err("location_speed_kmh_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
