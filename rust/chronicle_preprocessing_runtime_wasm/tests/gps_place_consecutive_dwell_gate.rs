#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/gps_place_consecutive_dwell_gate_de_montjoye_2013.json");

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
    pivot_minutes: f64,
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
    consecutive_dwell_minutes: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectedObservation {
    case_id: String,
    consecutive_dwell_minutes: f64,
    reason: String,
}

fn source_consecutive_dwell_minutes(value: f64) -> Result<f64, &'static str> {
    if !value.is_finite() {
        return Err("source_requires_finite_dwell");
    }
    if value < 0.0 {
        return Err("source_requires_nonnegative_dwell");
    }
    Ok(value)
}

#[test]
fn reuses_the_exact_pivot_without_fabricating_consecutive_dwell_reconstruction() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-gps-place-consecutive-dwell-gate-source-fixture/v1"
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
            "method-setting-950e4e1a1d9d685c18edb489",
            "feature.place_dwell_gate",
            "feature.place_dwell_gate: {\"comparison\":\"greater than\",\"threshold_minutes\":15,\"source_wording\":\"in a row\"}",
            "c584a72504709c3753995e6cf706d62a4b36de3b86585fd2714a6db3b97a1e7b",
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
        .contains("consecutive dwell duration in minutes"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 15 minutes"));
    for excluded_claim in [
        "does not reconstruct dwell",
        "does not parse GPS records",
        "does not disclose sub-minute measurement precision",
        "No exact study feature code",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_minutes,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("the source-disclosed threshold is finite");
    assert_eq!(classifier.pivot(), 15.0);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("exclude_place", "exclude_place", "retain_place")
    );

    for observation in fixture.observations {
        let consecutive_dwell =
            source_consecutive_dwell_minutes(observation.consecutive_dwell_minutes)
                .unwrap_or_else(|error| panic!("{}: {error}", observation.case_id));
        assert_eq!(
            classifier
                .category_for(consecutive_dwell)
                .map(String::as_str),
            Ok(observation.expected_disposition.as_str()),
            "{}",
            observation.case_id
        );
    }
    for rejected in fixture.rejected_observations {
        assert_eq!(
            source_consecutive_dwell_minutes(rejected.consecutive_dwell_minutes),
            Err(rejected.reason.as_str()),
            "{}",
            rejected.case_id
        );
    }
}
