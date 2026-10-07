#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/bluetooth_negative_rssi_filter_lepri_2014.json");

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
    rssi: f64,
    expected_disposition: String,
}

#[test]
fn reuses_the_exact_zero_pivot_without_transferring_another_sources_rssi_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-bluetooth-negative-rssi-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2647868.2654933");
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
            "method-setting-691e82b28c4c61f0dc0c33b3",
            "feature.bluetooth_rssi_filter",
            "feature.bluetooth_rssi_filter: {\"exclude_when\":\"RSSI < 0\",\"retain_when\":\"RSSI >= 0\",\"units_and_device_semantics\":null,\"source_value_preserved_without_sign_correction\":true}",
            "f78f6ce95878fbb9471b4e066196201acfbf42d599a6f3257122572175eff9f6",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("arxiv-1410.5816v1-source.tar"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "9ebfdf1dd12d842b8943672d7f94cfe6f984a73ff14261a267c88285c0c0b213"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("#member=fp266-lepri.tex;lines=548-553"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "98f061c214a98fdb35421c85d12f7b3f57d2e612949954d112fcd447d0cac70d"
    );
    assert!(fixture
        .input_boundary
        .contains("preserved exactly as stored"));
    assert!(fixture.output_boundary.contains("below zero"));
    assert!(fixture.output_boundary.contains("zero or positive"));
    for excluded_claim in [
        "does not disclose RSSI units",
        "does not parse raw Bluetooth records",
        "does not implement the downstream Bluetooth",
        "integer-only semantics from another paper are not transferred",
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
        ("exclude", "retain", "retain")
    );

    for observation in fixture.observations {
        assert_eq!(
            classifier
                .category_for(observation.rssi)
                .map(String::as_str),
            Ok(observation.expected_disposition.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
