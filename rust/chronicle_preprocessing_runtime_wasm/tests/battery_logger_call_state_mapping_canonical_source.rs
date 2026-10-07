use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/battery_logger_call_state_mapping_canonical_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    shared_integration_requirement: String,
    valid_raw_states: Vec<ValidRawState>,
    invalid_raw_states: Vec<InvalidRawState>,
    apk_framework_to_logger_cases: Vec<FrameworkCase>,
    limitations: Vec<String>,
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
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidRawState {
    case_id: String,
    raw_call_state: Value,
    expected_source_meaning: String,
    expected_communication_state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidRawState {
    case_id: String,
    raw_call_state: Value,
    expected_error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameworkCase {
    framework_state: i64,
    expected_raw_call_state: i64,
}

#[derive(Debug, PartialEq, Eq)]
struct MappedCallState {
    raw_call_state: i64,
    source_meaning: &'static str,
    communication_state: &'static str,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Test-only source-neutral closed integer-category mapping seam.
fn map_closed_integer_call_state(value: &Value) -> Result<MappedCallState, &'static str> {
    let raw_call_state = value.as_i64().ok_or("integer_raw_call_state_required")?;
    let (source_meaning, communication_state) = match raw_call_state {
        -1 => ("Unknown", "unknown"),
        0 => ("Ringing", "ringing"),
        1 => ("Waiting/Android idle", "waiting"),
        2 => ("Calling/off-hook", "calling"),
        _ => return Err("raw_call_state_outside_closed_set"),
    };
    Ok(MappedCallState {
        raw_call_state,
        source_meaning,
        communication_state,
    })
}

/// Exact switch behavior recovered from BatteryLoggerService.java:72-91.
fn logger_code_from_framework_state(framework_state: i64) -> i64 {
    match framework_state {
        0 => 1,
        1 => 0,
        2 => 2,
        _ => -1,
    }
}

#[test]
fn canonical_battery_logger_call_state_map_preserves_all_four_raw_codes() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-battery-logger-call-state-mapping-canonical-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/APNOMS.2011.6077030");
    assert_eq!(
        (
            fixture.canonical_setting.setting_id.as_str(),
            fixture.canonical_setting.parameter_key.as_str(),
            fixture.canonical_setting.source_observed_setting.as_str(),
            fixture.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-edc157e8995c64e134eff044",
            "schema.call_state_mapping",
            "schema.call_state_mapping: {\"0\":\"Ringing\",\"1\":\"Waiting/Android idle\",\"2\":\"Calling/off-hook\",\"-1\":\"Unknown\"}",
            "404fe180226fd6ee24a206b3e526af2c1dfa2f36bbfcadc3422bbd80c905f33a",
        )
    );
    assert_eq!(
        sha256(fixture.canonical_setting.source_observed_setting.as_bytes()),
        fixture.canonical_setting.source_value_sha256
    );
    assert_eq!(
        fixture.superseded_aliases,
        [
            "method-setting-7ba4199fa1442d0d09159602",
            "method-setting-e2b4d3c650e3bd81c1920c80",
            "method-setting-f8c9a89d47ec1407f7c1d128",
        ]
    );
    assert_eq!(fixture.source_artifacts.len(), 7);
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert!(fixture.input_boundary.contains("strictly parses"));
    assert!(fixture.input_boundary.contains("JSON integer"));
    assert!(fixture.input_boundary.contains("does not coerce strings"));
    assert!(fixture.output_boundary.contains("complete closed mapping"));
    assert!(fixture
        .output_boundary
        .contains("No call direction, peer, duration, or state precedence is inferred"));
    assert!(fixture
        .shared_integration_requirement
        .contains("one source-neutral closed integer-category map"));
    assert!(fixture
        .shared_integration_requirement
        .contains("Never promote the three tombstoned"));

    for case in &fixture.valid_raw_states {
        let actual = map_closed_integer_call_state(&case.raw_call_state)
            .unwrap_or_else(|error| panic!("{} unexpectedly failed: {error}", case.case_id));
        assert_eq!(actual.raw_call_state, case.raw_call_state.as_i64().unwrap());
        assert_eq!(
            actual.source_meaning, case.expected_source_meaning,
            "{} source meaning",
            case.case_id
        );
        assert_eq!(
            actual.communication_state, case.expected_communication_state,
            "{} Chronicle projection",
            case.case_id
        );
    }
    for case in &fixture.invalid_raw_states {
        assert_eq!(
            map_closed_integer_call_state(&case.raw_call_state),
            Err(case.expected_error.as_str()),
            "{}",
            case.case_id
        );
    }
    for case in &fixture.apk_framework_to_logger_cases {
        assert_eq!(
            logger_code_from_framework_state(case.framework_state),
            case.expected_raw_call_state,
            "framework state {}",
            case.framework_state
        );
    }
    for required_limitation in [
        "not an attested deployed study build",
        "recovered study logs are unavailable",
        "strict numeric-token parsing are caller-owned",
        "Waiting/Android idle wording without adding a new state",
        "state precedence, simultaneous-state policy, gap handling, session boundaries",
        "network-upload path is neither invoked nor modeled",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_limitation)));
    }
}
