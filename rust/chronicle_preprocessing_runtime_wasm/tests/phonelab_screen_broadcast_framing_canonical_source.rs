use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/phonelab_screen_broadcast_framing_canonical_source.json");
const ADAPTER_CONTRACT: &str = include_str!(concat!(
    env!("CHRONICLE_REPOSITORY_ROOT"),
    "/web/schema/literature-input-adapter-contract.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    existing_owner_at_audit: ExistingOwner,
    input_boundary: String,
    output_boundary: String,
    shared_integration_requirement: String,
    valid_cases: Vec<ValidCase>,
    invalid_cases: Vec<InvalidCase>,
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
struct ExistingOwner {
    adapter_id: String,
    adapter_version: String,
    source_field: String,
    rules: Vec<OwnerRule>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerRule {
    owner_alias: String,
    source_token: String,
    canonical_interaction_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceRow {
    participant_id: String,
    source_order: u32,
    timestamp_coordinate: i64,
    source_event_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidCase {
    case_id: String,
    rows: Vec<SourceRow>,
    expected_frames: Vec<InteractionFrame>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCase {
    case_id: String,
    rows: Vec<SourceRow>,
    expected_error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InteractionFrame {
    participant_id: String,
    start_source_order: u32,
    stop_source_order: u32,
    start_timestamp_coordinate: i64,
    stop_timestamp_coordinate: i64,
    start_source_event_type: String,
    stop_source_event_type: String,
    start_interaction_type: String,
    stop_interaction_type: String,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Test-only source-neutral seam for one closed two-token map and well-formed
/// participant-scoped frames. It never assigns a SCREEN OFF cause.
fn frame_screen_interactions(rows: &[SourceRow]) -> Result<Vec<InteractionFrame>, &'static str> {
    let mut previous_order = None;
    let mut open = BTreeMap::<String, &SourceRow>::new();
    let mut frames = Vec::new();
    for row in rows {
        if row.participant_id.is_empty() {
            return Err("participant_id_required");
        }
        if previous_order.is_some_and(|previous| row.source_order <= previous) {
            return Err("source_order_not_strictly_increasing");
        }
        previous_order = Some(row.source_order);
        match row.source_event_type.as_str() {
            "SCREEN ON" => {
                if open.insert(row.participant_id.clone(), row).is_some() {
                    return Err("screen_on_while_frame_open");
                }
            }
            "SCREEN OFF" => {
                let start = open
                    .remove(row.participant_id.as_str())
                    .ok_or("screen_off_without_open_frame")?;
                if row.timestamp_coordinate <= start.timestamp_coordinate {
                    return Err("nonincreasing_frame_timestamp");
                }
                frames.push(InteractionFrame {
                    participant_id: row.participant_id.clone(),
                    start_source_order: start.source_order,
                    stop_source_order: row.source_order,
                    start_timestamp_coordinate: start.timestamp_coordinate,
                    stop_timestamp_coordinate: row.timestamp_coordinate,
                    start_source_event_type: start.source_event_type.clone(),
                    stop_source_event_type: row.source_event_type.clone(),
                    start_interaction_type: "Screen Interactive".to_owned(),
                    stop_interaction_type: "Screen Non-Interactive".to_owned(),
                });
            }
            _ => return Err("source_event_type_outside_closed_set"),
        }
    }
    if !open.is_empty() {
        return Err("unclosed_screen_frame");
    }
    frames.sort_by_key(|frame| frame.start_source_order);
    Ok(frames)
}

fn contract_source_schema<'a>(
    contract: &'a Value,
    canonical_id: &str,
    owner_alias: &str,
    source_token: &str,
) -> Option<(&'a Value, &'a Value, Option<&'a Value>)> {
    contract["groups"].as_array()?.iter().find_map(|group| {
        group["sourceSchemas"]
            .as_array()?
            .iter()
            .find_map(|schema| {
                if schema["methodSettingId"] != canonical_id
                    && schema["methodSettingId"] != owner_alias
                {
                    return None;
                }
                let nested = schema["eventMatches"].as_array().and_then(|matches| {
                    matches
                        .iter()
                        .find(|entry| entry["sourceMatchValue"] == source_token)
                });
                (schema["sourceValue"] == source_token
                    || schema["sourceMatchValue"] == source_token
                    || nested.is_some())
                .then_some((group, schema, nested))
            })
    })
}

#[test]
fn composite_screen_broadcast_atom_has_one_closed_map_and_fail_closed_frames() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    let contract: Value = serde_json::from_str(ADAPTER_CONTRACT).expect("valid adapter contract");

    assert_eq!(
        fixture.schema_version,
        "chronicle-phonelab-screen-broadcast-framing-canonical-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2858036.2858267");
    assert_eq!(
        (
            fixture.canonical_setting.setting_id.as_str(),
            fixture.canonical_setting.parameter_key.as_str(),
            fixture.canonical_setting.source_observed_setting.as_str(),
            fixture.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-eb314ac09a0b1414bdc50cc8",
            "event_schema.screen_broadcasts",
            "event_schema.screen_broadcasts: SCREEN ON and SCREEN OFF broadcasts frame interaction; hardware button opens, and timeout or another button press closes",
            "41e26543773ddd6bef1497f0b8aabbe3bf413972244fbe152b323a3f06da9367",
        )
    );
    assert_eq!(
        sha256(fixture.canonical_setting.source_observed_setting.as_bytes()),
        fixture.canonical_setting.source_value_sha256
    );
    assert_eq!(
        fixture.superseded_aliases,
        [
            "atomic-b6b6b641b466282522d2a2e0",
            "atomic-962f326078193ac4caeb70b6",
        ]
    );
    assert_eq!(fixture.source_artifacts.len(), 4);
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    assert_eq!(
        (
            fixture.existing_owner_at_audit.adapter_id.as_str(),
            fixture.existing_owner_at_audit.adapter_version.as_str(),
            fixture.existing_owner_at_audit.source_field.as_str(),
        ),
        ("chronicle.source-event-schema", "v1", "source_event_type")
    );
    assert_eq!(fixture.existing_owner_at_audit.rules.len(), 2);
    for rule in &fixture.existing_owner_at_audit.rules {
        let (group, schema, event_match) = contract_source_schema(
            &contract,
            &fixture.canonical_setting.setting_id,
            &rule.owner_alias,
            &rule.source_token,
        )
        .expect("existing alias or future canonical composite source-event rule");
        assert_eq!(
            group["adapterId"],
            fixture.existing_owner_at_audit.adapter_id
        );
        assert_eq!(
            group["adapterVersion"],
            fixture.existing_owner_at_audit.adapter_version
        );
        assert_eq!(schema["kind"], "event_type");
        assert_eq!(
            schema["sourceField"],
            fixture.existing_owner_at_audit.source_field
        );
        assert_eq!(
            event_match.map_or(&schema["sourceValue"], |entry| &entry["sourceMatchValue"]),
            &rule.source_token
        );
        assert_eq!(
            event_match.map_or(&schema["canonicalValue"], |entry| &entry["canonicalValue"]),
            &rule.canonical_interaction_type
        );
        assert_eq!(schema["requiresPackage"], false);
    }

    assert!(fixture.input_boundary.contains("immutable source order"));
    assert!(fixture
        .input_boundary
        .contains("No raw PhoneLab logger schema is inferred"));
    assert!(fixture
        .output_boundary
        .contains("No per-row closing cause is emitted"));
    assert!(fixture
        .shared_integration_requirement
        .contains("one canonical source-event-schema setting"));
    assert!(fixture
        .shared_integration_requirement
        .contains("Do not promote the two superseded aliases"));

    for case in &fixture.valid_cases {
        assert_eq!(
            frame_screen_interactions(&case.rows),
            Ok(case.expected_frames.clone()),
            "{}",
            case.case_id
        );
    }
    for case in &fixture.invalid_cases {
        assert_eq!(
            frame_screen_interactions(&case.rows),
            Err(case.expected_error.as_str()),
            "{}",
            case.case_id
        );
    }
    for required_limitation in [
        "unpublished raw logger schema",
        "does not disclose a per-row off-cause field",
        "unit, epoch, precision, timezone, and raw parsing are outside",
        "fail closed because the source does not specify their repair policy",
        "not the keyguard state machine or any study result",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_limitation)));
    }
}
