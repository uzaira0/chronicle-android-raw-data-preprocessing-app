#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/gps_place_distance_threshold_de_montjoye_2013.json");

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
    pivot_meters: f64,
    categories: Categories,
    observations: Vec<Observation>,
    rejected_observations: Vec<RejectedObservation>,
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
    distance_meters: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectedObservation {
    case_id: String,
    distance_meters: f64,
    reason: String,
}

fn source_distance_meters(value: f64) -> Result<f64, &'static str> {
    if !value.is_finite() {
        return Err("source_requires_finite_distance");
    }
    if value < 0.0 {
        return Err("source_requires_nonnegative_distance");
    }
    Ok(value)
}

#[test]
fn reuses_the_exact_pivot_while_preserving_the_sources_strict_less_than_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-gps-place-distance-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/978-3-642-37210-0_6");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
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
            "method-setting-7f3cb5bc3ef6e02c130d9d97",
            "feature.place_distance_threshold",
            "feature.place_distance_threshold: {\"comparison\":\"less than\",\"threshold_meters\":50}",
            "67a4f32f34f96bf05ff1a8244d1c8a543a0e5718a38f4844a9f749658cb92901",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("de-montjoye-2013-author.txt:228-234"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "e7695acc8e8cbcd32bf9421deb18f2e14719f59116a4dcc33a08c79b8d348f1a"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .contains("de-montjoye-2013-author.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "239a23caebc02f3d81d16442c5dbb28984a1594a99bce820028f7038481ff8d2"
    );
    assert!(fixture
        .input_boundary
        .contains("caller-computed finite nonnegative distance in meters"));
    assert!(fixture
        .output_boundary
        .contains("strictly less than 50 meters"));
    for excluded_claim in [
        "does not parse GPS records",
        "does not infer clustering linkage",
        "does not calculate the center of mass",
        "No rounding or tolerance",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_meters,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("the source-disclosed threshold is finite");
    assert_eq!(classifier.pivot(), 50.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        (
            "satisfies_place_distance_relation",
            "does_not_satisfy_place_distance_relation",
            "does_not_satisfy_place_distance_relation",
        )
    );

    for observation in fixture.observations {
        let distance = source_distance_meters(observation.distance_meters)
            .unwrap_or_else(|error| panic!("{}: {error}", observation.case_id));
        assert_eq!(
            classifier.category_for(distance).map(String::as_str),
            Ok(observation.expected_disposition.as_str()),
            "{}",
            observation.case_id
        );
    }
    for rejected in fixture.rejected_observations {
        assert_eq!(
            source_distance_meters(rejected.distance_meters),
            Err(rejected.reason.as_str()),
            "{}",
            rejected.case_id
        );
    }
}
