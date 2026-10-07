#[path = "../src/integer_screen_state_csv.rs"]
mod integer_screen_state_csv;

use std::collections::BTreeSet;

use chronicle_chrono_kernel_wasm::b05_foundational_semantics::{
    capability_evidence_assignment_digest, construct_screen_intervals, parse_capability_evidence,
    AndroidUsageSignal, B05ApplicabilityInput, CapabilityId, ScreenIntervalCloseReason,
    ScreenSessionConstructionStrategyId, B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
};
use integer_screen_state_csv::parse_integer_screen_state_csv;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str = include_str!("fixtures/integer_screen_state_session_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    status_mappings: Vec<StatusMapping>,
    raw_csv_lines: Vec<String>,
    expected_intervals: Vec<ExpectedInterval>,
    invalid_csv_cases: Vec<InvalidCsvCase>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusMapping {
    source_status: String,
    canonical_signal: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedInterval {
    device_id: String,
    start_ns: i64,
    stop_ns: i64,
    start_source_row: u32,
    stop_source_row: u32,
    close_reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCsvCase {
    case_id: String,
    csv_lines: Vec<String>,
    expected_error_code: String,
}

fn csv_bytes(lines: &[String]) -> Vec<u8> {
    let mut bytes = lines.join("\n").into_bytes();
    bytes.push(b'\n');
    bytes
}

fn sha256_wire(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn required_capability_csv(raw_input_sha256: &str) -> Vec<u8> {
    let mut lines = vec![
        "schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256".to_owned(),
    ];
    for capability in [
        CapabilityId::AndroidUsageEvent16ScreenNonInteractive,
        CapabilityId::AndroidUsageEvent17KeyguardShown,
        CapabilityId::AndroidUsageEvent18KeyguardHidden,
        CapabilityId::SeparateScreenKeyguardEventRows,
        CapabilityId::FullUnfilteredSourceEventStream,
        CapabilityId::SourceRecordOrderPreserved,
        CapabilityId::SingleDeviceStreamPerParticipant,
        CapabilityId::CompleteObservationWindowChunk,
    ] {
        lines.push(format!(
            "{B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION},{raw_input_sha256},*,{},capable,producer_manifest,urn:test:integer-screen-state-source,",
            capability.canonical_id()
        ));
    }
    csv_bytes(&lines)
}

#[test]
fn canonical_integer_screen_schema_feeds_first_off_or_lock_constructor() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-integer-screen-state-session-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3422821");
    assert_eq!(
        (
            fixture.canonical_setting.setting_id.as_str(),
            fixture.canonical_setting.parameter_key.as_str(),
            fixture.canonical_setting.source_observed_setting.as_str(),
            fixture.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-0d00eddbbf9b14cb90ae31f0",
            "screen.schema_and_constructor",
            "screen.schema_and_constructor: screen states on/off/lock/unlock; interaction begins at unlock and ends at the first off or lock",
            "5a4259fa42cef30c1243703f696d7660176abe5b98ef5d34caf880a022dabebc",
        )
    );
    assert_eq!(fixture.superseded_aliases.len(), 7);
    assert!(fixture
        .superseded_aliases
        .iter()
        .all(|setting_id| setting_id.starts_with("atomic-")));
    assert_eq!(fixture.source_artifacts.len(), 4);
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert_eq!(fixture.limitations.len(), 3);

    let raw_csv = csv_bytes(&fixture.raw_csv_lines);
    let events = parse_integer_screen_state_csv(&raw_csv).expect("source schema parses");
    assert_eq!(events.len(), 10);
    assert_eq!(
        events
            .iter()
            .map(|event| event.source_data_row)
            .collect::<Vec<_>>(),
        (1..=10).collect::<Vec<_>>()
    );
    assert_eq!(
        events
            .iter()
            .map(|event| event.participant_id.as_str())
            .collect::<Vec<_>>(),
        [
            "device-a", "device-b", "device-a", "device-b", "device-a", "device-b", "device-a",
            "device-a", "device-a", "device-a",
        ]
    );

    let mapped = fixture
        .status_mappings
        .iter()
        .map(|mapping| {
            let event = events
                .iter()
                .find(|event| event.raw_interaction_type == mapping.source_status)
                .expect("every declared status appears in the source-shaped rows");
            (
                mapping.source_status.as_str(),
                mapping.canonical_signal.as_str(),
                event.signal.canonical_id(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        mapped,
        [
            (
                "0",
                "screen_non_interactive",
                AndroidUsageSignal::ScreenNonInteractive.canonical_id(),
            ),
            (
                "1",
                "screen_interactive",
                AndroidUsageSignal::ScreenInteractive.canonical_id(),
            ),
            (
                "2",
                "keyguard_shown",
                AndroidUsageSignal::KeyguardShown.canonical_id(),
            ),
            (
                "3",
                "keyguard_hidden",
                AndroidUsageSignal::KeyguardHidden.canonical_id(),
            ),
        ]
    );

    for case in &fixture.invalid_csv_cases {
        let error = parse_integer_screen_state_csv(&csv_bytes(&case.csv_lines))
            .expect_err(&format!("{} unexpectedly parsed", case.case_id));
        assert_eq!(error.code(), case.expected_error_code, "{}", case.case_id);
    }

    let raw_digest = sha256_wire(&raw_csv);
    let capability_csv = required_capability_csv(&raw_digest);
    let capability_evidence =
        parse_capability_evidence(&capability_csv).expect("valid bound capability evidence");
    let evidence_assignment_digest =
        capability_evidence_assignment_digest(&capability_evidence.evidence_artifact_digest);
    let fragmented_participants = BTreeSet::new();
    let output = construct_screen_intervals(
        ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1,
        B05ApplicabilityInput {
            raw_input_sha256: &raw_digest,
            raw_events: &events,
            evidence: Some(&capability_evidence),
            evidence_assignment_digest: Some(&evidence_assignment_digest),
            options_digest:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            selection_was_explicit: true,
            fragmented_participants: &fragmented_participants,
        },
    )
    .expect("screen construction input is valid");
    assert!(output.executable());
    assert_eq!(output.intervals.len(), fixture.expected_intervals.len());
    for (actual, expected) in output.intervals.iter().zip(&fixture.expected_intervals) {
        assert_eq!(actual.participant_id, expected.device_id);
        assert_eq!(actual.start_ns, expected.start_ns);
        assert_eq!(actual.stop_ns, Some(expected.stop_ns));
        assert_eq!(actual.start_boundary_source_row, expected.start_source_row);
        assert_eq!(
            actual.stop_boundary_source_row,
            Some(expected.stop_source_row)
        );
        assert_eq!(actual.close_reason.canonical_id(), expected.close_reason);
    }
    assert_eq!(
        output.intervals[0].close_reason,
        ScreenIntervalCloseReason::ScreenNonInteractive
    );
    assert_eq!(output.intervals[0].stop_boundary_source_row, Some(7));
    assert!(!output.intervals[0].stop_source_rows.contains(&8));
}
