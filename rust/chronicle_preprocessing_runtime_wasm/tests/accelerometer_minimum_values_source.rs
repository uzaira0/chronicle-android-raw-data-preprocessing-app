#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/accelerometer_minimum_values_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting_id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
    source_artifact: SourceArtifact,
    source_test_artifact: SourceTestArtifact,
    threshold: u32,
    categories: Vec<String>,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    path: String,
    sha256: String,
    locator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceTestArtifact {
    path: String,
    sha256: String,
    locator: String,
    coverage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureCase {
    case_id: String,
    magnitude_count: u32,
    expected_category: String,
}

#[test]
fn reuses_lower_inclusive_threshold_for_source_magnitude_count_gate() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-accelerometer-minimum-values-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
    assert_eq!(
        fixture.exact_canonical_setting_id,
        "method-setting-7d18dc8d566bfe8d6b6aa541"
    );
    assert_eq!(
        fixture.parameter_key,
        "feature.accelerometer.minimum_values"
    );
    assert_eq!(
        fixture.source_value,
        "a burst contributes to state standard-deviation features only when it contains at least 200 magnitudes"
    );
    assert_eq!(
        fixture.source_value_sha256,
        "6460aeca7309655a3dd440d1ff05c4446d43027b5b334d2d5887c5c55048ef3f"
    );
    assert!(fixture.source_artifact.path.ends_with("state.py"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532"
    );
    assert_eq!(fixture.source_artifact.locator, "state.py:631-707");
    assert!(fixture.source_test_artifact.path.ends_with("test_state.py"));
    assert_eq!(
        fixture.source_test_artifact.sha256,
        "8257552c5fa29eb72ede03b884be65e4cb4a091212f477509928a81a5d7907c6"
    );
    assert_eq!(
        fixture.source_test_artifact.locator,
        "test_state.py:191-224"
    );
    assert!(fixture.source_test_artifact.coverage.contains("199/200"));
    assert_eq!(fixture.threshold, 200);
    assert_eq!(fixture.categories, ["excluded", "included"]);
    assert_eq!(fixture.limitations.len(), 3);

    let bucketizer =
        OrderedThresholdBucketizer::new(vec![f64::from(fixture.threshold)], fixture.categories)
            .expect("source threshold configuration");
    assert_eq!(bucketizer.thresholds(), [200.0]);
    assert_eq!(bucketizer.categories(), ["excluded", "included"]);

    for case in fixture.cases {
        assert_eq!(
            bucketizer
                .category_for(f64::from(case.magnitude_count))
                .expect("integer count is finite"),
            &case.expected_category,
            "case {}",
            case.case_id
        );
    }
}
