#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/three_g_signal_trace_threshold_rahmati_2012.json");

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
    pivot_dbm: f64,
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
    rssi_dbm: f64,
    expected_class: String,
}

#[test]
fn reuses_the_exact_trace_pivot_and_keeps_the_separate_validation_threshold_out() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-three-g-signal-trace-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2465529.2466586");
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
            "method-setting-0f2b73dee364dc49f4044772",
            "trace.threshold.3g",
            "trace.threshold.3g: {\"technology\":\"3G\",\"poor_when\":\"RSSI < -91.7 dBm\",\"good_when\":\"RSSI >= -91.7 dBm\",\"basis\":\"Ofcom\"}",
            "da151a721df5dfd96d23ee792de4065facbeba28f06d6aeafa62108b231e06ba",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("114-raw.txt:358-390"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "8dc10be1c73d1017b1c528e3a24646057bf288c60fce852ea0fe0738e5e2e17e"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .contains("114-primary.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "9022b28ab8725ae23e7766edda71b295d32e7e7fbe75a7e762d62db8e18ff164"
    );
    assert!(fixture
        .input_boundary
        .contains("finite 3G received-signal-strength value expressed in dBm"));
    assert!(fixture.output_boundary.contains("strictly below -91.7 dBm"));
    for excluded_claim in [
        "does not parse collector records",
        "does not calculate time fractions",
        "distinct -100 dBm 3G validation threshold",
        "No measurement quantization",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_dbm,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("the source-disclosed pivot is finite");
    assert_eq!(classifier.pivot(), -91.7);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("poor", "good", "good")
    );

    for observation in fixture.observations {
        assert_eq!(
            classifier
                .category_for(observation.rssi_dbm)
                .map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
