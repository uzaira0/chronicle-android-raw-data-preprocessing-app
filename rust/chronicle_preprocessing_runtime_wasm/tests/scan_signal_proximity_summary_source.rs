#[path = "../src/scan_signal_proximity_summary.rs"]
mod scan_signal_proximity_summary;

use scan_signal_proximity_summary::{
    summarize_scan_signal_proximity, ScanSignalProximityConfig, ScanSignalProximityError,
    ScanSignalProximitySummary,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/scan_signal_proximity_summary_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_locator: String,
    released_test_coverage: String,
    source_runtime: SourceRuntime,
    exact_canonical_settings: Vec<CanonicalSetting>,
    configuration: FixtureConfig,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceRuntime {
    container_image: String,
    container_image_id: String,
    python: String,
    numpy: String,
    pandas: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_value: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureConfig {
    above_exclusive_lower: String,
    inclusive_lower: String,
    inclusive_upper: String,
    above_weight: String,
    within_weight: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureCase {
    case_id: String,
    scans: Vec<Vec<String>>,
    expected: ExpectedSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedSummary {
    observations_per_scan: String,
    above_per_scan: String,
    within_per_scan: String,
    weighted_proximity_mean: String,
}

fn numeric(value: &str) -> f64 {
    value.parse::<f64>().expect("fixture numeric value")
}

#[test]
fn matches_released_nested_scan_threshold_and_denominator_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-scan-signal-proximity-summary-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
    assert_eq!(
        fixture.source_code_sha256,
        "74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532"
    );
    assert!(fixture.source_locator.ends_with("state.py:224-293"));
    assert!(fixture
        .released_test_coverage
        .contains("no dedicated BluetoothStateAggregator test"));
    assert_eq!(
        fixture.source_runtime.container_image,
        "chronicle/rueegger-per2309:python3.7.1"
    );
    assert_eq!(
        fixture.source_runtime.container_image_id,
        "sha256:1ef375425fbba3b0f47c7c07838c12c78d94bea31e06307ed3cfa7834b80f58d"
    );
    assert_eq!(fixture.source_runtime.python, "3.7.1");
    assert_eq!(fixture.source_runtime.numpy, "1.16.2");
    assert_eq!(fixture.source_runtime.pandas, "1.0.5");
    assert_canonical_settings(&fixture.exact_canonical_settings);
    assert_eq!(fixture.limitations.len(), 3);

    let config = ScanSignalProximityConfig {
        above_exclusive_lower: numeric(&fixture.configuration.above_exclusive_lower),
        inclusive_lower: numeric(&fixture.configuration.inclusive_lower),
        inclusive_upper: numeric(&fixture.configuration.inclusive_upper),
        above_weight: numeric(&fixture.configuration.above_weight),
        within_weight: numeric(&fixture.configuration.within_weight),
    };
    for case in fixture.cases {
        let scans = case
            .scans
            .iter()
            .map(|scan| scan.iter().map(|value| numeric(value)).collect())
            .collect::<Vec<Vec<f64>>>();
        let actual = summarize_scan_signal_proximity(&scans, config)
            .expect("source fixture has valid finite configuration");
        assert_summary(&case.case_id, actual, &case.expected);
    }
}

#[test]
fn rejects_invalid_configuration_without_reclassifying_observations() {
    let scans = vec![vec![f64::NAN, f64::INFINITY, f64::NEG_INFINITY]];
    let valid = ScanSignalProximityConfig {
        above_exclusive_lower: -70.0,
        inclusive_lower: -90.0,
        inclusive_upper: -70.0,
        above_weight: 1.0,
        within_weight: 3.0,
    };
    assert!(summarize_scan_signal_proximity(&scans, valid).is_ok());
    assert_eq!(
        summarize_scan_signal_proximity(
            &scans,
            ScanSignalProximityConfig {
                inclusive_lower: -60.0,
                inclusive_upper: -90.0,
                ..valid
            }
        ),
        Err(ScanSignalProximityError::ReversedInclusiveRange)
    );
    assert_eq!(
        summarize_scan_signal_proximity(
            &scans,
            ScanSignalProximityConfig {
                above_weight: f64::NAN,
                ..valid
            }
        ),
        Err(ScanSignalProximityError::NonFiniteConfiguration)
    );
}

fn assert_canonical_settings(settings: &[CanonicalSetting]) {
    let expected = [
        (
            "method-setting-7e3f8a2bea952e5643083e97",
            "feature.13_bt_devices_in_the_environment",
            "13_bt_devices_in_the_environment",
        ),
        (
            "method-setting-6f388e47ce29e465d8760b64",
            "feature.23_peopleclosedist",
            "23_PeopleCloseDist",
        ),
        (
            "method-setting-a757d043298bc2ecdb4767f1",
            "feature.24_peopleinterdist",
            "24_PeopleInterDist",
        ),
        (
            "method-setting-9de0ec641dcc228c19b43819",
            "feature.25_meandistance",
            "25_MeanDistance",
        ),
    ];
    assert_eq!(settings.len(), expected.len());
    for (setting, (setting_id, parameter_key, feature)) in settings.iter().zip(expected) {
        assert_eq!(setting.setting_id, setting_id);
        assert_eq!(setting.parameter_key, parameter_key);
        assert_eq!(setting.source_value["feature"], feature);
        assert_eq!(setting.source_value["source_sensor"], "bluetooth");
        assert_eq!(setting.source_value["source_sensor_short"], "bt");
        assert_eq!(setting.source_value["level"], "state");
        assert_eq!(setting.source_value["status"], "included");
    }
}

fn assert_summary(case_id: &str, actual: ScanSignalProximitySummary, expected: &ExpectedSummary) {
    assert_number(
        case_id,
        "observationsPerScan",
        actual.observations_per_scan,
        &expected.observations_per_scan,
    );
    assert_number(
        case_id,
        "abovePerScan",
        actual.above_per_scan,
        &expected.above_per_scan,
    );
    assert_number(
        case_id,
        "withinPerScan",
        actual.within_per_scan,
        &expected.within_per_scan,
    );
    assert_number(
        case_id,
        "weightedProximityMean",
        actual.weighted_proximity_mean,
        &expected.weighted_proximity_mean,
    );
}

fn assert_number(case_id: &str, field: &str, actual: f64, expected: &str) {
    let expected = numeric(expected);
    if expected.is_nan() {
        assert!(actual.is_nan(), "case {case_id}, field {field}");
    } else {
        assert_eq!(actual, expected, "case {case_id}, field {field}");
    }
}
