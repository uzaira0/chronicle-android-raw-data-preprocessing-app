use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer::{
    OrderedThresholdBucketizer, ThresholdBucketizerError,
};
use serde::Deserialize;

const FIXTURE_JSON: &str =
    include_str!("fixtures/categorical_threshold_bucketizer_boundaries.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundaryFixture {
    schema_version: String,
    source_work_id: String,
    source_locators: Vec<String>,
    configurations: Vec<BoundaryConfiguration>,
    rejected_observations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundaryConfiguration {
    configuration_id: String,
    unit: String,
    thresholds: Vec<f64>,
    categories: Vec<String>,
    observations: Vec<BoundaryObservation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundaryObservation {
    value: f64,
    expected_category: String,
}

fn next_lower_finite(value: f64) -> f64 {
    assert!(value.is_finite() && value > 0.0);
    f64::from_bits(value.to_bits() - 1)
}

#[test]
fn source_boundary_fixture_uses_lower_inclusive_buckets_and_refuses_non_finite_values() {
    let fixture: BoundaryFixture = serde_json::from_str(FIXTURE_JSON).expect("valid fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-categorical-threshold-boundary-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.jbi.2019.103151");
    assert_eq!(fixture.source_locators.len(), 3);

    for configuration in fixture.configurations {
        assert!(!configuration.configuration_id.is_empty());
        assert!(!configuration.unit.is_empty());
        let bucketizer = OrderedThresholdBucketizer::new(
            configuration.thresholds.clone(),
            configuration.categories.clone(),
        )
        .expect("source thresholds form a valid ordered configuration");

        for observation in configuration.observations {
            assert_eq!(
                bucketizer
                    .category_for(observation.value)
                    .expect("finite fixture observation"),
                &observation.expected_category,
                "{} at {} {}",
                configuration.configuration_id,
                observation.value,
                configuration.unit
            );
        }

        for (threshold_index, threshold) in configuration.thresholds.iter().copied().enumerate() {
            assert_eq!(
                bucketizer.category_for(next_lower_finite(threshold)),
                Ok(&configuration.categories[threshold_index]),
                "{} immediately below {} {}",
                configuration.configuration_id,
                threshold,
                configuration.unit
            );
            assert_eq!(
                bucketizer.category_for(threshold),
                Ok(&configuration.categories[threshold_index + 1]),
                "{} exactly at {} {}",
                configuration.configuration_id,
                threshold,
                configuration.unit
            );
        }

        for rejected in &fixture.rejected_observations {
            let value = match rejected.as_str() {
                "NaN" => f64::NAN,
                "+Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                other => panic!("unsupported rejected observation {other}"),
            };
            assert_eq!(
                bucketizer.category_for(value),
                Err(ThresholdBucketizerError::NonFiniteObservation),
                "{} must reject {rejected}",
                configuration.configuration_id
            );
        }
    }
}
