use chronicle_preprocessing_runtime_wasm::integer_screen_state_csv;

use integer_screen_state_csv::parse_integer_screen_state_csv;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/integer_screen_state_vocabulary_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    claimed_boundary: String,
    source_artifacts: Vec<SourceArtifact>,
    raw_csv_lines: Vec<String>,
    expected_events: Vec<ExpectedEvent>,
    excluded_claims: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    method_value: Vec<String>,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedEvent {
    source_data_row: u32,
    timestamp_ns: i64,
    device_id: String,
    source_status: String,
    method_label: String,
    canonical_signal: String,
}

fn csv_bytes(lines: &[String]) -> Vec<u8> {
    let mut bytes = lines.join("\n").into_bytes();
    bytes.push(b'\n');
    bytes
}

#[test]
fn loneliness_source_screen_vocabulary_maps_at_parsed_event_boundary_only() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-integer-screen-state-vocabulary-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/13209");
    assert_eq!(
        (
            fixture.canonical_setting.setting_id.as_str(),
            fixture.canonical_setting.parameter_key.as_str(),
            fixture.canonical_setting.source_observed_setting.as_str(),
            fixture.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-a0e0d56bd1a6f08372f0c3e9",
            "schema.screen_status_events",
            "schema.screen_status_events: [\"on\",\"off\",\"lock\",\"unlock\"]",
            "d30cdf80eb3323e0c95ec0167eba324753091e8a3726fc612ca8a34ad90894ef",
        )
    );
    assert_eq!(
        fixture.canonical_setting.method_value,
        ["on", "off", "lock", "unlock"]
    );
    assert_eq!(fixture.claimed_boundary, "parsed_event_vocabulary_only");
    assert_eq!(fixture.superseded_aliases.len(), 4);
    assert!(fixture
        .superseded_aliases
        .iter()
        .all(|setting_id| setting_id.starts_with("atomic-")));
    assert_eq!(fixture.source_artifacts.len(), 5);
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    let events = parse_integer_screen_state_csv(&csv_bytes(&fixture.raw_csv_lines))
        .expect("pinned AWARE screen vocabulary parses");
    assert_eq!(events.len(), fixture.expected_events.len());
    for (event, expected) in events.iter().zip(&fixture.expected_events) {
        assert_eq!(event.source_data_row, expected.source_data_row);
        assert_eq!(event.timestamp_ns, Some(expected.timestamp_ns));
        assert_eq!(event.participant_id, expected.device_id);
        assert_eq!(event.raw_interaction_type, expected.source_status);
        assert_eq!(event.signal.canonical_id(), expected.canonical_signal);
    }
    assert_eq!(
        fixture
            .expected_events
            .iter()
            .map(|event| event.method_label.as_str())
            .collect::<Vec<_>>(),
        fixture
            .canonical_setting
            .method_value
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        fixture.excluded_claims,
        [
            "session_construction",
            "interaction_duration",
            "event_aggregation",
            "study_specific_android_only_filtering",
        ]
    );
}
