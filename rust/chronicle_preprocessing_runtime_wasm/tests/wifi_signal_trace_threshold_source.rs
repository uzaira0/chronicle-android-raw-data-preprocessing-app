#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/wifi_signal_trace_threshold_rahmati_2012.json");

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
    pivot_dbm: f64,
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
    rssi_dbm: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    rssi_dbm: Option<f64>,
    expected_error: String,
}

fn validated_wifi_rssi_dbm(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("wifi_rssi_dbm_required")?;
    if !value.is_finite() {
        return Err("wifi_rssi_dbm_must_be_finite");
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
fn exact_trace_variant_keeps_minus_80_equality_poor_without_collapsing_strict_variants() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-wifi-signal-trace-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2465529.2466586");

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
            "method-setting-8a188c8364d1d50b36e04783",
            "method-setting-8a188c8364d1d50b36e04783",
            "extraction-831e2a46ae19dfa4ec63",
            "signal-power-2466586:trace.analysis.wifi",
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
            "trace.threshold.wifi",
            "trace.threshold.wifi: {\"technology\":\"Wi-Fi\",\"poor_when\":\"RSSI <= -80 dBm\"}",
            "d90349279abc742944b37eae2f42c4610afb85d0064cff92e964eea5531b5239",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert_eq!(
        artifact(&fixture, "114-raw.txt:427-447").sha256,
        "8dc10be1c73d1017b1c528e3a24646057bf288c60fce852ea0fe0738e5e2e17e"
    );
    assert_eq!(
        artifact(&fixture, "114-primary.pdf").sha256,
        "9022b28ab8725ae23e7766edda71b295d32e7e7fbe75a7e762d62db8e18ff164"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "5e6dfd5f5b87c0850a39ad9aa28412b542dc090c557e69a8282c4a65781554df"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture
        .input_boundary
        .contains("finite Wi-Fi received-signal-strength value expressed in dBm"));
    assert!(fixture
        .output_boundary
        .contains("below or equal to -80 dBm as poor"));
    for residue in [
        "nearby trace prose paraphrases",
        "does not adjudicate or erase that wording conflict",
        "method-setting-9897b5f9ba40756397553301",
        "does not disclose a measurement serialization type",
        "missing or nonfinite RSSI value fails closed",
        "does not parse collector records",
        "reproduce the 3,785-user trace",
        "Controlled packet/power experiments",
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
        fixture.pivot_dbm,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), -80.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("poor", "poor", "not_poor")
    );

    for observation in fixture.observations {
        let value =
            validated_wifi_rssi_dbm(Some(observation.rssi_dbm)).expect("fixture RSSI is finite");
        assert_eq!(
            classifier.category_for(value).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_wifi_rssi_dbm(observation.rssi_dbm),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_wifi_rssi_dbm(Some(f64::NAN)),
        Err("wifi_rssi_dbm_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
