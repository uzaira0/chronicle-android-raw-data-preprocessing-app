#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/class_attendance_dwell_fraction_studentlife.json");

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
    minimum_attended_percent: f64,
    dispositions: Vec<String>,
    class_periods: Vec<ClassPeriodDwell>,
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
struct ClassPeriodDwell {
    observation_id: String,
    location_dwell_percent: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingDwellCase {
    observation_id: String,
    location_dwell_percent: Option<f64>,
    expected_error: String,
}

fn required_dwell_percent(value: Option<f64>) -> Result<f64, &'static str> {
    value.ok_or("class_period_dwell_percent_required")
}

#[test]
fn attends_class_at_the_ninety_percent_location_dwell_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-class-period-dwell-threshold-source-fixture/v1"
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
            "method-setting-b361e4912604d386fb7d7735",
            "gpa.class_attendance_rule",
            "gpa.class_attendance_rule: Location dwell at least 90% of scheduled class period",
            "006dc3a486103c2343b310ec3e8f0bf28deaa80bee1c98d6e8a4470950af6d34",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-08-ranks277-329-20260831/fulltext/rank280-primary.txt:827-834"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "377f08b265cbf3da8b6200fc478ae3f0c335a3924f7aa52900510ad196d85276"
    );
    assert!(fixture.input_boundary.contains("scheduled class location"));
    assert!(fixture.output_boundary.contains("at or above 90%"));
    for excluded_claim in [
        "does not identify a student's classes",
        "does not determine whether location observations belong",
        "does not reconstruct dwell intervals",
        "does not aggregate per-class classifications",
        "missing class-period dwell percentage fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_attended_percent],
        fixture.dispositions,
    )
    .expect("the source percentage threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[90.0]);
    assert_eq!(
        bucketizer.categories(),
        &["not_attended".to_owned(), "attended".to_owned()]
    );

    for class_period in fixture.class_periods {
        assert_eq!(
            bucketizer
                .category_for(class_period.location_dwell_percent)
                .map(String::as_str),
            Ok(class_period.expected_disposition.as_str()),
            "{}",
            class_period.observation_id
        );
    }

    assert_eq!(
        required_dwell_percent(fixture.missing_dwell_case.location_dwell_percent),
        Err(fixture.missing_dwell_case.expected_error.as_str()),
        "{}",
        fixture.missing_dwell_case.observation_id
    );
}
