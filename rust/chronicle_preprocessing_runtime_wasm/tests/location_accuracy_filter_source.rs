#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/location_accuracy_filter_per_2309.json");

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
    maximum_retained_radius_meters: f64,
    dispositions: Dispositions,
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
struct Dispositions {
    below: String,
    equal: String,
    above: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    case_id: String,
    error_radius_meters: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectedObservation {
    case_id: String,
    error_radius_meters: Option<String>,
    expected_error: String,
}

fn parse_error_radius(encoded: Option<&str>) -> Result<f64, &'static str> {
    let encoded = encoded.ok_or("error_radius_meters_required")?;
    let radius = match encoded {
        "NaN" => f64::NAN,
        "+inf" => f64::INFINITY,
        "-inf" => f64::NEG_INFINITY,
        value => value
            .parse::<f64>()
            .map_err(|_| "error_radius_meters_must_be_finite_and_nonnegative")?,
    };
    if !radius.is_finite() || radius < 0.0 {
        return Err("error_radius_meters_must_be_finite_and_nonnegative");
    }
    Ok(radius)
}

#[test]
fn retains_location_accuracy_at_100_meters_and_drops_only_strictly_above_it() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-location-accuracy-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
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
            "method-setting-bda663746ffd6ebe747788f4",
            "preparation.location_accuracy",
            "preparation.location_accuracy: drop location points with error radius greater than 100 meters",
            "3d6ff4ea857cdbd6e583099d0c1b9a0aa7e68e72fb2e1c5a82af8a389278d8b7",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-06-ranks174-223-20260831/text/183-1-b3facb592d62.txt:1514-1527"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "990b3f3289030e18c5ed2abf6b0766af6616787a020f529545f2fb9f4d9c780b"
    );
    assert!(fixture.input_boundary.contains("finite, nonnegative"));
    assert!(fixture.output_boundary.contains("drop only above 100"));
    for excluded_claim in [
        "does not parse",
        "does not disclose behavior",
        "does not implement the subsequent 500-second spacing",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.maximum_retained_radius_meters,
        fixture.dispositions.below,
        fixture.dispositions.equal,
        fixture.dispositions.above,
    )
    .expect("the source threshold is finite");
    assert_eq!(classifier.pivot(), 100.0);
    assert_eq!(
        classifier.categories(),
        (
            &"retain".to_owned(),
            &"retain".to_owned(),
            &"drop".to_owned()
        )
    );

    for observation in fixture.observations {
        let radius = parse_error_radius(Some(&observation.error_radius_meters.to_string()))
            .unwrap_or_else(|error| panic!("{}: {error}", observation.case_id));
        assert_eq!(
            classifier.category_for(radius).map(String::as_str),
            Ok(observation.expected_disposition.as_str()),
            "{}",
            observation.case_id
        );
    }

    for rejected in fixture.rejected_observations {
        assert_eq!(
            parse_error_radius(rejected.error_radius_meters.as_deref()),
            Err(rejected.expected_error.as_str()),
            "{}",
            rejected.case_id
        );
    }
}
