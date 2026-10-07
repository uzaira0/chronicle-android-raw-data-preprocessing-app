#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/party_location_minimum_dwell_minutes_studentlife.json");

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
    minimum_retained_minutes: f64,
    dispositions: Vec<String>,
    party_location_dwells: Vec<PartyLocationDwell>,
    missing_dwell_case: MissingDwellCase,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PartyLocationDwell {
    observation_id: String,
    dwell_minutes: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingDwellCase {
    observation_id: String,
    dwell_minutes: Option<f64>,
    expected_error: String,
}

fn required_dwell_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    value.ok_or("party_location_dwell_minutes_required")
}

#[test]
fn retains_a_party_location_dwell_at_the_thirty_minute_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-party-location-dwell-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/978-3-319-51394-2_2");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-2bf931232c4bd435f1403c59",
            "gpa.party_minimum_minutes",
            "gpa.party_minimum_minutes: 30",
            "e324fce02542dcf8fda49ca1dade8878025bff6692a8ef0e7646bde984d0682f",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-08-ranks277-329-20260831/fulltext/rank280-primary.txt:854-859"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "377f08b265cbf3da8b6200fc478ae3f0c335a3924f7aa52900510ad196d85276"
    );
    assert!(fixture
        .input_boundary
        .contains("already-derived finite dwell"));
    assert!(fixture.output_boundary.contains("at or above 30 minutes"));
    for excluded_claim in [
        "does not identify Greek houses, dorms",
        "does not reconstruct visits",
        "does not apply the source day-of-week",
        "does not partition a retained dwell",
        "does not derive audio or activity",
        "missing or non-finite partying-location dwell duration fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_minutes],
        fixture.dispositions,
    )
    .expect("the source duration threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[30.0]);
    assert_eq!(
        bucketizer.categories(),
        &["discarded_dwell".to_owned(), "retained_dwell".to_owned()]
    );

    for dwell in fixture.party_location_dwells {
        assert_eq!(
            bucketizer
                .category_for(dwell.dwell_minutes)
                .map(String::as_str),
            Ok(dwell.expected_disposition.as_str()),
            "{}",
            dwell.observation_id
        );
    }

    assert_eq!(
        required_dwell_minutes(fixture.missing_dwell_case.dwell_minutes),
        Err(fixture.missing_dwell_case.expected_error.as_str()),
        "{}",
        fixture.missing_dwell_case.observation_id
    );
    assert_eq!(
        bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
