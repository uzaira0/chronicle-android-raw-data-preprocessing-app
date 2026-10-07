#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/attendance_evidence_availability_classroom.json");

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
    minimum_available_evidence_sources: u8,
    dispositions: Vec<String>,
    availability_cases: Vec<AvailabilityCase>,
    missing_input_cases: Vec<MissingInputCase>,
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
struct AvailabilityCase {
    observation_id: String,
    wifi_permits_attendance_check: bool,
    gps_permits_attendance_check: bool,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingInputCase {
    observation_id: String,
    wifi_permits_attendance_check: Option<bool>,
    gps_permits_attendance_check: Option<bool>,
    expected_error: String,
}

fn required_evidence_source_count(
    wifi_permits: Option<bool>,
    gps_permits: Option<bool>,
) -> Result<u8, &'static str> {
    let wifi_permits = wifi_permits.ok_or("wifi_attendance_evidence_required")?;
    let gps_permits = gps_permits.ok_or("gps_attendance_evidence_required")?;
    Ok(u8::from(wifi_permits) + u8::from(gps_permits))
}

#[test]
fn excludes_log_data_only_when_neither_wifi_nor_gps_permits_attendance_checking() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-attendance-evidence-availability-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.compedu.2019.103611");
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
            "method-setting-f5d1364d0018c64801ccd99c",
            "attendance.exclude_without_wifi_or_gps",
            "attendance.exclude_without_wifi_or_gps: exclude log data when neither Wi-Fi nor GPS permits attendance checking",
            "a5fd3a96d9bba7536f74a4d64af988da0c4984f28bc807ee2bdacbe43c60f6ae",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:305-328"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "5444bf55d60696984c74e676bfc3dacd388e81074b3f5f09ba07120d2c3e414b"
    );
    assert!(fixture
        .input_boundary
        .contains("Two explicit source-aligned booleans"));
    assert!(fixture
        .output_boundary
        .contains("only when neither Wi-Fi nor GPS"));
    for excluded_claim in [
        "does not infer whether raw Wi-Fi or GPS",
        "does not build or match",
        "does not derive building entry",
        "does not select which retained evidence source takes precedence",
        "does not join retained log data",
        "missing Wi-Fi or GPS permit-attendance-check value fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![f64::from(fixture.minimum_available_evidence_sources)],
        fixture.dispositions,
    )
    .expect("the source availability threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[1.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "exclude_log_data".to_owned(),
            "retain_for_attendance_check".to_owned(),
        ]
    );

    for case in fixture.availability_cases {
        let available_count = required_evidence_source_count(
            Some(case.wifi_permits_attendance_check),
            Some(case.gps_permits_attendance_check),
        )
        .expect("complete source-aligned availability evidence");
        assert_eq!(
            bucketizer
                .category_for(f64::from(available_count))
                .map(String::as_str),
            Ok(case.expected_disposition.as_str()),
            "{}",
            case.observation_id
        );
    }

    for missing in fixture.missing_input_cases {
        assert_eq!(
            required_evidence_source_count(
                missing.wifi_permits_attendance_check,
                missing.gps_permits_attendance_check,
            ),
            Err(missing.expected_error.as_str()),
            "{}",
            missing.observation_id
        );
    }
}
