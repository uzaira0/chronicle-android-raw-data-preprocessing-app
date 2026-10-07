#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/bluetooth_rssi_zero_filter_socialcom_2013.json");

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
    pivot: f64,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    rssi: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectedObservation {
    case_id: String,
    rssi: f64,
    reason: String,
}

fn source_rssi(value: f64) -> Result<f64, &'static str> {
    if !value.is_finite() {
        return Err("source_requires_finite_rssi");
    }
    if value.fract() != 0.0 {
        return Err("source_requires_integer_rssi");
    }
    Ok(value)
}

#[test]
fn reuses_the_exact_zero_pivot_to_retain_only_source_disclosed_close_proximity_hits() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-bluetooth-rssi-zero-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/socialcom.2013.118");
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
            "method-setting-0f1f138af4fffdf768a93802",
            "features.bluetooth_filter",
            "features.bluetooth_filter: {\"predicate\":\"RSSI = 0\",\"interpretation\":\"best proxy for close social proximity\"}",
            "33cc128b43a73c36c41a969af9e5a0a3d7573e957d25434211a11db574c9ada8",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("rank147.txt:103-125"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "299b50324299c85002330ac67bc02d33afa7b2865fd4c8f5379530c5c219b295"
    );
    assert!(fixture.source_artifacts[1].locator.contains("rank147.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "63dcaed448d25876d801e9eaef94df502a78036eec3a9012912b48b8bb2f19c9"
    );
    assert!(fixture.input_boundary.contains("integer-valued RSSI"));
    assert!(fixture.output_boundary.contains("exactly RSSI-equals-zero"));
    for excluded_claim in [
        "does not parse raw records",
        "does not coerce",
        "does not calibrate physical distance",
        "no tolerance",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("the source-disclosed pivot is finite");
    assert_eq!(classifier.pivot(), 0.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("exclude", "retain", "exclude")
    );

    for observation in fixture.observations {
        let rssi = source_rssi(observation.rssi)
            .unwrap_or_else(|error| panic!("{}: {error}", observation.case_id));
        assert_eq!(
            classifier.category_for(rssi).map(String::as_str),
            Ok(observation.expected_disposition.as_str()),
            "{}",
            observation.case_id
        );
    }
    for rejected in fixture.rejected_observations {
        assert_eq!(
            source_rssi(rejected.rssi),
            Err(rejected.reason.as_str()),
            "{}",
            rejected.case_id
        );
    }
}
