use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str = include_str!("fixtures/predictor_event_schema_canonical_source.json");
const ADAPTER_CONTRACT: &str = include_str!(concat!(
    env!("CHRONICLE_REPOSITORY_ROOT"),
    "/web/schema/literature-input-adapter-contract.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_variant: String,
    local_primary_bytes_available: bool,
    source_artifacts: Vec<SourceArtifact>,
    canonical_settings: Vec<CanonicalSetting>,
    existing_owners: Vec<ExistingOwner>,
    acceptance_claim: String,
    shared_integration_requirement: String,
    timestamp_cases: Vec<TimestampCase>,
    app_open_event_cases: Vec<AppOpenEventCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    role: String,
    locator: String,
    source_locator: Option<String>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_value: String,
    source_observed_setting: String,
    source_value_sha256: String,
    superseded_alias: String,
    alias_resolution: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExistingOwner {
    canonical_setting_id: String,
    owner_alias_at_audit: String,
    adapter_id: String,
    adapter_version: String,
    kind: String,
    source_field: String,
    source_match_value: Option<String>,
    canonical_field: String,
    canonical_value: Option<String>,
    requires_package: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TimestampCase {
    case_id: String,
    source_timestamp: Option<String>,
    existing_event_timestamp: Option<String>,
    expected_event_timestamp: Option<String>,
    expected_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppOpenEventCase {
    case_id: String,
    source_event_type: Option<String>,
    event_timestamp: Option<String>,
    app_package_name: Option<String>,
    expected_source_event_type: Option<String>,
    expected_chronicle_interaction_type: Option<String>,
    expected_error: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct BoundAppOpenEvent {
    source_event_type: String,
    event_timestamp: String,
    app_package_name: String,
    chronicle_interaction_type: &'static str,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Test-only reference for the existing source-field adapter's typed boundary.
///
/// It deliberately performs no timestamp parsing, normalization, or ordering.
fn bind_opaque_timestamp_alias(
    source_timestamp: Option<&str>,
    existing_event_timestamp: Option<&str>,
) -> Result<String, &'static str> {
    let source = source_timestamp.filter(|value| !value.is_empty());
    let existing = existing_event_timestamp.filter(|value| !value.is_empty());
    if source.is_some() && existing.is_some() && source != existing {
        return Err("conflicting_event_timestamp_alias");
    }
    source
        .or(existing)
        .map(str::to_owned)
        .ok_or("nonempty_event_timestamp_required")
}

/// Test-only reference for the existing closed source-event adapter boundary.
///
/// The source token is preserved. The Chronicle interaction category is an
/// adapter projection and does not purport to reconstruct an event payload.
fn bind_app_open_event(
    source_event_type: Option<&str>,
    event_timestamp: Option<&str>,
    app_package_name: Option<&str>,
) -> Result<BoundAppOpenEvent, &'static str> {
    if source_event_type != Some("AppOpenEvent") {
        return Err("source_event_type_outside_closed_set");
    }
    let event_timestamp = event_timestamp
        .filter(|value| !value.is_empty())
        .ok_or("nonempty_event_timestamp_required")?;
    let app_package_name = app_package_name
        .filter(|value| !value.is_empty())
        .ok_or("nonempty_app_package_name_required")?;
    Ok(BoundAppOpenEvent {
        source_event_type: "AppOpenEvent".to_owned(),
        event_timestamp: event_timestamp.to_owned(),
        app_package_name: app_package_name.to_owned(),
        chronicle_interaction_type: "Activity Resumed",
    })
}

fn contract_source_schema<'a>(
    contract: &'a Value,
    method_setting_id: &str,
) -> Option<(&'a Value, &'a Value)> {
    contract["groups"].as_array()?.iter().find_map(|group| {
        group["sourceSchemas"]
            .as_array()?
            .iter()
            .find(|schema| schema["methodSettingId"] == method_setting_id)
            .map(|schema| (group, schema))
    })
}

#[test]
fn canonical_timestamp_and_app_open_type_reuse_existing_typed_schema_boundaries() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    let contract: Value = serde_json::from_str(ADAPTER_CONTRACT).expect("valid adapter contract");

    assert_eq!(
        fixture.schema_version,
        "chronicle-predictor-event-schema-canonical-source-fixture/v1"
    );
    assert_eq!(
        (
            fixture.source_work_id.as_str(),
            fixture.source_variant.as_str(),
            fixture.local_primary_bytes_available,
        ),
        (
            "doi:10.1007/s00530-018-0601-1",
            "author-provided Springer e-offprint rendering",
            false,
        )
    );

    let expected_artifacts = [
        (
            "author-rendering locator manifest",
            ".tmp-literature-review-private/source-completeness-artifacts/doi-10.1007-s00530-018-0601-1/author-rendering-locator-manifest.json#section:event-schema",
            "145ed74fac5e19402a4b5661b9008a4454781b98b746f31fb164ba4dbebe0e4e",
        ),
        (
            "canonical source-completeness audit",
            ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1007-s00530-018-0601-1.json",
            "d742168db63926916cfc9f1ae122d2a7b406b49f241cba2ba9c3f710f9ca4e40",
        ),
        (
            "canonical alias and tombstone ledger",
            ".tmp-literature-review-private/ontology-sublation-20260831/method-setting-alias-tombstones.json",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        ),
    ];
    assert_eq!(fixture.source_artifacts.len(), expected_artifacts.len());
    for (artifact, expected) in fixture.source_artifacts.iter().zip(expected_artifacts) {
        assert_eq!(
            (
                artifact.role.as_str(),
                artifact.locator.as_str(),
                artifact.sha256.as_str(),
            ),
            expected
        );
    }
    assert_eq!(
        fixture.source_artifacts[0].source_locator.as_deref(),
        Some("author rendering PDF page 5, indexed PDF lines 312-349; Table 1 and Table 2")
    );
    assert!(fixture.source_artifacts[1].source_locator.is_none());

    let expected_settings = [
        (
            "method-setting-7ece46fcbf67cfd7c2fb8c5e",
            "event.timestamp",
            "Timestamp in the illustrated event sequence",
            "event.timestamp: Timestamp in the illustrated event sequence",
            "2e5d38475d8dda8a311452c7c8568978190ead75c9e5ae9706457acfec51ff42",
            "atomic-9d14abd749f3ef5c0a00be20",
        ),
        (
            "method-setting-2749a0339e3c4bb4c3b0ba7e",
            "event.type.AppOpenEvent",
            "AppOpenEvent",
            "event.type.AppOpenEvent: AppOpenEvent",
            "e4951d31dcea641fbc0b49e2e10c55f616c33e4efea82184aea018fc81af079c",
            "atomic-092ad85131a08132d9d87b6a",
        ),
    ];
    assert_eq!(fixture.canonical_settings.len(), expected_settings.len());
    for (setting, expected) in fixture.canonical_settings.iter().zip(expected_settings) {
        assert_eq!(
            (
                setting.setting_id.as_str(),
                setting.parameter_key.as_str(),
                setting.source_value.as_str(),
                setting.source_observed_setting.as_str(),
                setting.source_value_sha256.as_str(),
                setting.superseded_alias.as_str(),
            ),
            expected
        );
        assert_eq!(setting.alias_resolution, "superseded_by");
        assert_eq!(
            sha256(setting.source_observed_setting.as_bytes()),
            setting.source_value_sha256,
            "{} canonical source-value digest",
            setting.setting_id
        );
    }

    assert_eq!(fixture.existing_owners.len(), 2);
    for owner in &fixture.existing_owners {
        let (group, schema) = contract_source_schema(&contract, &owner.canonical_setting_id)
            .or_else(|| contract_source_schema(&contract, &owner.owner_alias_at_audit))
            .unwrap_or_else(|| panic!("missing existing owner for {}", owner.canonical_setting_id));
        assert_eq!(group["adapterId"], owner.adapter_id);
        assert_eq!(group["adapterVersion"], owner.adapter_version);
        assert_eq!(schema["kind"], owner.kind);
        assert_eq!(schema["sourceField"], owner.source_field);
        assert_eq!(schema["canonicalField"], owner.canonical_field);
        assert_eq!(schema["requiresPackage"], owner.requires_package);
        match owner.source_match_value.as_deref() {
            Some(expected) => assert_eq!(
                schema["sourceMatchValue"]
                    .as_str()
                    .or_else(|| schema["sourceValue"].as_str()),
                Some(expected)
            ),
            None => assert!(schema.get("sourceMatchValue").is_none()),
        }
        match owner.canonical_value.as_deref() {
            Some(expected) => assert_eq!(schema["canonicalValue"], expected),
            None => assert!(schema.get("canonicalValue").is_none()),
        }
    }

    assert!(fixture
        .acceptance_claim
        .contains("timestamp field as an opaque scalar"));
    assert!(fixture
        .acceptance_claim
        .contains("exact AppOpenEvent type token"));
    assert!(fixture
        .shared_integration_requirement
        .contains("Replace the two live tombstoned alias registrations"));
    for required_limitation in [
        "primary PDF bytes and full dataset are unavailable locally",
        "does not disclose timestamp unit, format, epoch, precision, timezone, or parsing rules",
        "does not disclose an AppOpenEvent payload schema or payload semantics",
        "not a claimed reconstruction of an undisclosed AppOpenEvent payload",
        "does not infer participant identifiers, dataset row order, event completeness",
        "retained only as owner-resolution evidence",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_limitation)));
    }

    for case in &fixture.timestamp_cases {
        let actual = bind_opaque_timestamp_alias(
            case.source_timestamp.as_deref(),
            case.existing_event_timestamp.as_deref(),
        );
        match (&case.expected_event_timestamp, &case.expected_error) {
            (Some(expected), None) => {
                assert_eq!(actual.as_deref(), Ok(expected.as_str()), "{}", case.case_id)
            }
            (None, Some(expected)) => {
                assert_eq!(actual, Err(expected.as_str()), "{}", case.case_id)
            }
            _ => panic!("{} has an incoherent timestamp oracle", case.case_id),
        }
    }

    for case in &fixture.app_open_event_cases {
        let actual = bind_app_open_event(
            case.source_event_type.as_deref(),
            case.event_timestamp.as_deref(),
            case.app_package_name.as_deref(),
        );
        match (
            &case.expected_source_event_type,
            &case.expected_chronicle_interaction_type,
            &case.expected_error,
        ) {
            (Some(source_type), Some(interaction_type), None) => {
                let actual = actual.unwrap_or_else(|error| {
                    panic!("{} unexpectedly failed: {error}", case.case_id)
                });
                assert_eq!(actual.source_event_type, *source_type, "{}", case.case_id);
                assert_eq!(
                    actual.event_timestamp,
                    case.event_timestamp.as_deref().unwrap(),
                    "{} opaque timestamp",
                    case.case_id
                );
                assert_eq!(
                    actual.app_package_name,
                    case.app_package_name.as_deref().unwrap(),
                    "{} package",
                    case.case_id
                );
                assert_eq!(
                    actual.chronicle_interaction_type, interaction_type,
                    "{} Chronicle-only projection",
                    case.case_id
                );
            }
            (None, None, Some(expected)) => {
                assert_eq!(actual, Err(expected.as_str()), "{}", case.case_id)
            }
            _ => panic!("{} has an incoherent AppOpenEvent oracle", case.case_id),
        }
    }
}
