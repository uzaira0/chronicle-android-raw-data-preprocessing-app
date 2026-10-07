#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/battery_stop_default_threshold_apisense_2013.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    adjacent_configurable_setting: AdjacentSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    pivot_percentage_points: f64,
    actions: Actions,
    observations: Vec<Observation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_clause: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdjacentSetting {
    setting_id: String,
    relationship: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Actions {
    below: String,
    equal: String,
    above: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    case_id: String,
    battery_percentage_points: f64,
    expected_action: String,
}

#[test]
fn default_battery_stop_action_applies_only_strictly_below_twenty_percent() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-battery-stop-default-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/978-3-642-38541-4_4");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_clause.as_str(),
            fixture
                .exact_canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-039630561cb82a4dfa0c3d2a",
            "platform.battery_stop_default",
            "platform.battery_stop_default: {\"operator\":\"below\",\"percent\":20,\"default\":true,\"action\":\"suspend scripting engine and stop all experiments\"}",
            "below 20 percent by default suspends the scripting engine and stops all running experiments",
            "f62bdcaab2c28345c7ec47de1c8a9c4e23aec672c4a944168ea309fd757de940",
        )
    );
    assert_eq!(
        fixture.adjacent_configurable_setting.setting_id,
        "method-setting-1c29dbc4cec73cf93ca26d78"
    );
    assert!(fixture
        .adjacent_configurable_setting
        .relationship
        .contains("not collapsed into this default-20 binding"));
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("source-pdfs/184-primary.txt:266-270"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "0a981bd3ca30fb9fcd4a28c72b43701fa0ab8a56c5a25bec13334b22d63b25b7"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .contains("184-primary.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "4508d402f72b9bc76dd91786977639f345dc2007d0cc96a84eda2e338b97d5d0"
    );
    assert!(fixture
        .input_boundary
        .contains("finite numeric current-battery-level value"));
    assert!(fixture
        .output_boundary
        .contains("only below 20 percentage points"));
    for excluded_claim in [
        "does not decode Android battery events",
        "No encoded battery range",
        "separate configurable setting",
        "transition idempotence",
        "charging-only dataset upload trigger",
        "missing or nonfinite",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_percentage_points,
        fixture.actions.below,
        fixture.actions.equal,
        fixture.actions.above,
    )
    .expect("source default threshold is finite");
    assert_eq!(classifier.pivot(), 20.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        (
            "suspend_scripting_engine_and_stop_all_running_experiments",
            "continue_running_experiments",
            "continue_running_experiments",
        )
    );

    for observation in fixture.observations {
        assert_eq!(
            classifier
                .category_for(observation.battery_percentage_points)
                .map(String::as_str),
            Ok(observation.expected_action.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
