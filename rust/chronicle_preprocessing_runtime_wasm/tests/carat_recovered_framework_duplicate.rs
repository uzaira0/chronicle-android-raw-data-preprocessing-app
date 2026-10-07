#[path = "../src/adjacent_record_duplicate.rs"]
mod adjacent_record_duplicate;

use adjacent_record_duplicate::{should_suppress_adjacent_record, AdjacentRecordDuplicateError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/carat_recovered_framework_duplicate_opoku_asare_2021.json");
const CARAT_DUPLICATE_INTERVAL_SECONDS: f64 = 300.0;
const CARAT_INSTALL_STATE_IMPORTANCES: [&str; 4] =
    ["installed", "disabled", "replaced", "uninstalled"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_variant_id: String,
    deployed_study_revision_status: String,
    exact_canonical_setting_ids: Vec<String>,
    source_value_sha256: String,
    source_artifacts: SourceArtifacts,
    source_locator: String,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    comparison_cases: Vec<ComparisonCase>,
    install_state_exception_values: Vec<String>,
    adjacent_sequence: Vec<FixtureSample>,
    adjacent_sequence_expected_suppressed: Vec<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceArtifacts {
    recovered_commit: String,
    constants_sha256: String,
    sampler_sha256: String,
    upload_caller_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComparisonCase {
    case_id: String,
    previous: Option<FixtureSample>,
    current: FixtureSample,
    expected_suppressed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSample {
    timestamp_seconds: f64,
    battery_level: f64,
    battery_state: String,
    time_zone: String,
    battery_capacity: f64,
    battery_technology: String,
    battery_charger: String,
    battery_health: String,
    process_importances: Vec<String>,
}

fn carat_should_suppress(
    current: &FixtureSample,
    previous: Option<&FixtureSample>,
) -> Result<bool, AdjacentRecordDuplicateError> {
    let compared_fields_equal = previous.is_some_and(|previous| {
        current.battery_level == previous.battery_level
            && current.battery_state == previous.battery_state
            && current.time_zone == previous.time_zone
            && current.battery_capacity == previous.battery_capacity
            && current.battery_technology == previous.battery_technology
            && current.battery_charger == previous.battery_charger
            && current.battery_health == previous.battery_health
    });
    let retain_current_exception = current
        .process_importances
        .iter()
        .any(|importance| CARAT_INSTALL_STATE_IMPORTANCES.contains(&importance.as_str()));
    should_suppress_adjacent_record(
        current.timestamp_seconds,
        previous.map(|sample| sample.timestamp_seconds),
        CARAT_DUPLICATE_INTERVAL_SECONDS,
        compared_fields_equal,
        retain_current_exception,
    )
}

#[test]
fn reproduces_the_recovered_framework_predicate_and_adjacent_upload_order() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T33 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-carat-recovered-framework-duplicate-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    assert_eq!(
        fixture.source_variant_id,
        "recovered_carat_android_f4242acf_adjacent_upload"
    );
    assert_eq!(fixture.deployed_study_revision_status, "unresolved");
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-f1f151152a7cb4f59ba26374"]
    );
    assert_eq!(
        fixture.source_value_sha256,
        "58d25df3b01e1854f5fddf89aacdb739012d67c7cd0c648801b3b5334b8a25b8"
    );
    assert_eq!(
        fixture.source_artifacts.recovered_commit,
        "f4242acf3fe8f7db9d2a47ac9af4940ac3eacd39"
    );
    assert_eq!(
        fixture.source_artifacts.constants_sha256,
        "e2ac09b6fd0fb79178707e38d1b13fd901076bed2d923c50e99b1e62646ff2ca"
    );
    assert_eq!(
        fixture.source_artifacts.sampler_sha256,
        "8709a3a2a2dfb8bd7f837fb29493fa07440c27dca4b070c9126e988da5d3bde7"
    );
    assert_eq!(
        fixture.source_artifacts.upload_caller_sha256,
        "dce8cb300e6ef8ed22ba6e2d1277dbe24b64ea373bc1fc179d65412df6a06b95"
    );
    assert!(fixture.source_locator.contains("Constants.java:16"));
    assert!(fixture.source_locator.contains("Sampler.java:258-295"));
    assert!(fixture
        .source_locator
        .contains("CommunicationManager.java:152-177"));
    assert!(fixture.input_boundary.contains("immediately preceding"));
    assert!(fixture.output_boundary.contains("suppress"));
    for limitation in ["deployed", "pre-store", "null", "temperature"] {
        assert!(fixture
            .limitations
            .iter()
            .any(|value| value.contains(limitation)));
    }
    assert_eq!(CARAT_DUPLICATE_INTERVAL_SECONDS, 300.0);
    assert_eq!(
        fixture.install_state_exception_values,
        CARAT_INSTALL_STATE_IMPORTANCES
    );

    for case in fixture.comparison_cases {
        assert_eq!(
            carat_should_suppress(&case.current, case.previous.as_ref())
                .unwrap_or_else(|error| panic!("{}: {error}", case.case_id)),
            case.expected_suppressed,
            "{}",
            case.case_id
        );
    }

    let sequence = fixture.adjacent_sequence;
    let mut previous = None;
    let mut actual = Vec::new();
    for current in &sequence {
        actual.push(
            carat_should_suppress(current, previous)
                .expect("chronological adjacent source sequence"),
        );
        previous = Some(current); // Source advances even when `current` was suppressed.
    }
    assert_eq!(actual, fixture.adjacent_sequence_expected_suppressed);
}

#[test]
fn invalid_timestamps_and_reversed_input_order_fail_closed() {
    assert!(matches!(
        should_suppress_adjacent_record(f64::NAN, None, 300.0, true, false),
        Err(AdjacentRecordDuplicateError::NonFiniteTimestamp {
            record_role: "current",
            ..
        })
    ));
    assert!(matches!(
        should_suppress_adjacent_record(1.0, Some(f64::INFINITY), 300.0, true, false),
        Err(AdjacentRecordDuplicateError::NonFiniteTimestamp {
            record_role: "previous",
            ..
        })
    ));
    assert!(matches!(
        should_suppress_adjacent_record(9.0, Some(10.0), 300.0, true, false),
        Err(AdjacentRecordDuplicateError::CurrentPrecedesPrevious { .. })
    ));
    assert!(matches!(
        should_suppress_adjacent_record(10.0, Some(9.0), 0.0, true, false),
        Err(AdjacentRecordDuplicateError::InvalidExclusiveInterval { .. })
    ));
}
