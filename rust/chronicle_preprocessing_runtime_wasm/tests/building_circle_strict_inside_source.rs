#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/building_circle_strict_inside_classroom.json");

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
    fixture_circle_radius: f64,
    categories: Vec<String>,
    coordinates: Vec<CoordinateDistance>,
    missing_input_cases: Vec<MissingInputCase>,
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
struct CoordinateDistance {
    observation_id: String,
    center_distance: f64,
    expected_category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingInputCase {
    observation_id: String,
    circle_radius: Option<f64>,
    center_distance: Option<f64>,
    expected_error: String,
}

fn required_circle_inputs(
    radius: Option<f64>,
    distance: Option<f64>,
) -> Result<(f64, f64), &'static str> {
    let radius = radius.ok_or("building_circle_radius_required")?;
    let distance = distance.ok_or("building_center_distance_required")?;
    Ok((radius, distance))
}

#[test]
fn a_coordinate_is_inside_only_when_distance_is_strictly_below_radius() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-building-circle-membership-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.compedu.2019.103611");
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
            "method-setting-fe9b841235ec149984be1015",
            "attendance.manual_building_circles",
            "attendance.manual_building_circles: manually defined circular building boundaries; inside when distance to center is less than radius",
            "558b4b683ebe970ac24b431cdb29efe71b76c4ea8080614a85634f43b13fdcac",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:318-328"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "5444bf55d60696984c74e676bfc3dacd388e81074b3f5f09ba07120d2c3e414b"
    );
    assert!(fixture
        .input_boundary
        .contains("caller-supplied finite circle radius"));
    assert!(fixture
        .output_boundary
        .contains("strictly less than radius"));
    for excluded_claim in [
        "radius is synthetic fixture configuration",
        "does not derive a distance",
        "does not detect a temporal boundary crossing",
        "does not implement the source GPS-missing",
        "does not implement Wi-Fi fingerprint",
        "does not join a building classification",
        "missing or non-finite radius or distance fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }
    assert_eq!(fixture.categories.len(), 3);

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.fixture_circle_radius,
        fixture.categories[0].clone(),
        fixture.categories[1].clone(),
        fixture.categories[2].clone(),
    )
    .expect("fixture radius is finite");
    assert_eq!(classifier.pivot(), 100.0);
    assert_eq!(
        classifier.categories(),
        (
            &"inside".to_owned(),
            &"not_inside".to_owned(),
            &"not_inside".to_owned()
        )
    );

    for coordinate in fixture.coordinates {
        assert_eq!(
            classifier
                .category_for(coordinate.center_distance)
                .map(String::as_str),
            Ok(coordinate.expected_category.as_str()),
            "{}",
            coordinate.observation_id
        );
    }

    for missing in fixture.missing_input_cases {
        assert_eq!(
            required_circle_inputs(missing.circle_radius, missing.center_distance),
            Err(missing.expected_error.as_str()),
            "{}",
            missing.observation_id
        );
    }
    assert_eq!(
        FiniteScalarPivotClassifier::new(f64::NAN, "inside", "not_inside", "not_inside"),
        Err(FiniteScalarPivotClassifierError::NonFinitePivot)
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
