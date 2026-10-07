use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const REGISTRY_JSON: &str =
    include_str!("../../../web/src/generated/source-artifact-provenance-registry.json");
const BLOCKED_SETTING_ID: &str = "method-setting-ba42e53a2bb684a034aa67e0";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourcePacket {
    batch_id: String,
    canonical_ledger_row_count: usize,
    selected_immutable_source_projection_sha256: String,
    packet_manifest_sha256: String,
    imported_candidate_count: usize,
    receipt_ready_count: usize,
    blocked_method_setting_ids: Vec<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProfileIdentity {
    method_profile_id: String,
    source_work_id: String,
    source_method_variant_id: String,
    method_profile_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryRow {
    method_setting_id: String,
    source_work_id: String,
    source_extraction_id: String,
    source_value_sha256: String,
    source_artifact_provenance: Value,
    source_artifact_provenance_object_digest: String,
    provenance_keys: Vec<String>,
    candidate_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryArtifact {
    schema_version: String,
    source_packet: SourcePacket,
    profile_identities: Vec<ProfileIdentity>,
    rows: Vec<RegistryRow>,
    positive_fixtures: Vec<Value>,
    negative_fixtures: Vec<Value>,
    content_digest: String,
}

#[cfg(test)]
#[allow(
    dead_code,
    reason = "summary is exercised by the source-registry integration test, not the library test target"
)]
#[derive(Debug, PartialEq, Eq)]
pub struct RegistrySummary {
    pub row_count: usize,
    pub receipt_ready_count: usize,
    pub blocked_method_setting_ids: Vec<String>,
    pub positive_fixture_count: usize,
    pub negative_fixture_count: usize,
}

pub fn jcs_digest(value: &Value) -> Result<String, String> {
    let bytes = serde_jcs::to_vec(value)
        .map_err(|error| format!("canonicalize source-artifact provenance JSON: {error}"))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn exact_keys(value: &Value, expected: &[String]) -> bool {
    let Some(object) = object(value) else {
        return false;
    };
    let mut keys = object.keys().cloned().collect::<Vec<_>>();
    keys.sort();
    keys == expected
}

fn parse_registry(registry_json: &str) -> Result<RegistryArtifact, String> {
    let raw: Value = serde_json::from_str(registry_json)
        .map_err(|error| format!("parse source-artifact provenance registry: {error}"))?;
    let artifact: RegistryArtifact = serde_json::from_value(raw.clone())
        .map_err(|error| format!("shape source-artifact provenance registry: {error}"))?;
    let mut payload = raw;
    let declared_digest = payload
        .as_object_mut()
        .and_then(|object| object.remove("content_digest"))
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| "source-artifact registry content_digest is missing".to_owned())?;
    if declared_digest != artifact.content_digest || jcs_digest(&payload)? != declared_digest {
        return Err("source-artifact provenance registry content drift".to_owned());
    }
    let expected_profiles = [
        (
            "doi:10.1016/j.chb.2023.107977",
            "source-configuration-space-8b14e63d69954819163df993",
        ),
        (
            "doi:10.1080/15213269.2020.1768122",
            "source-configuration-space-9a5dfdec15e1a632fd9a13f4",
        ),
        (
            "doi:10.1177/00936502241276793",
            "source-configuration-space-e9ce7cff19d18e050e47a180",
        ),
    ]
    .map(|(work, variant)| ProfileIdentity {
        method_profile_id: format!("method-profile:{work}"),
        source_work_id: work.to_owned(),
        source_method_variant_id: variant.to_owned(),
        method_profile_version: "literature-sublation-v3-atomic".to_owned(),
    });
    if artifact.schema_version != "chronicle-source-artifact-provenance-closed-registry/v2"
        || artifact.source_packet.batch_id != "source-artifact-provenance-receipt-batch-1"
        || artifact.source_packet.canonical_ledger_row_count != 1806
        || artifact
            .source_packet
            .selected_immutable_source_projection_sha256
            != "sha256:acc53ad3dc930ed7e3d7a3c620e7a42c7132b36f34c8966dbe4efce4ffebe297"
        || artifact.source_packet.packet_manifest_sha256
            != "sha256:54fe6f58398f34e66377950dfc53ba37f1225f3b7ee6255f48c22f69fdc1c10e"
        || artifact.profile_identities != expected_profiles
        || artifact.source_packet.imported_candidate_count != 19
        || artifact.source_packet.receipt_ready_count != 18
        || artifact.source_packet.blocked_method_setting_ids != [BLOCKED_SETTING_ID]
        || artifact.rows.len() != 19
        || artifact.positive_fixtures.len() != 19
        || artifact.negative_fixtures.len() != 11
    {
        return Err("source-artifact provenance registry identity or count drift".to_owned());
    }
    let mut ids = artifact
        .rows
        .iter()
        .map(|row| row.method_setting_id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    let mut blocked_ids = artifact
        .rows
        .iter()
        .filter(|row| row.candidate_status.starts_with("blocked_"))
        .map(|row| row.method_setting_id.clone())
        .collect::<Vec<_>>();
    blocked_ids.sort();
    let mut declared_blocked_ids = artifact.source_packet.blocked_method_setting_ids.clone();
    declared_blocked_ids.sort();
    if ids.len() != 19
        || artifact
            .rows
            .iter()
            .filter(|row| row.candidate_status == "ready_for_typed_registry")
            .count()
            != 18
        || blocked_ids != declared_blocked_ids
        || blocked_ids != [BLOCKED_SETTING_ID]
    {
        return Err("source-artifact provenance registry row partition drift".to_owned());
    }
    for row in &artifact.rows {
        let provenance_id = row
            .source_artifact_provenance
            .get("source_artifact_provenance_id")
            .and_then(Value::as_str);
        if !exact_keys(&row.source_artifact_provenance, &row.provenance_keys)
            || provenance_id
                != Some(format!("source-artifact-provenance:{}", row.method_setting_id).as_str())
            || jcs_digest(&row.source_artifact_provenance)?
                != row.source_artifact_provenance_object_digest
        {
            return Err(format!(
                "source-artifact provenance row drift: {}",
                row.method_setting_id
            ));
        }
    }
    Ok(artifact)
}

fn load_registry() -> Result<RegistryArtifact, String> {
    parse_registry(REGISTRY_JSON)
}

#[cfg(test)]
#[allow(
    dead_code,
    reason = "exercised by the source-registry integration test, not the library test target"
)]
pub(crate) fn validate_registry_json(registry_json: &str) -> Result<RegistrySummary, String> {
    let artifact = parse_registry(registry_json)?;
    Ok(RegistrySummary {
        row_count: artifact.rows.len(),
        receipt_ready_count: artifact
            .rows
            .iter()
            .filter(|row| row.candidate_status == "ready_for_typed_registry")
            .count(),
        blocked_method_setting_ids: artifact.source_packet.blocked_method_setting_ids,
        positive_fixture_count: artifact.positive_fixtures.len(),
        negative_fixture_count: artifact.negative_fixtures.len(),
    })
}

#[cfg(test)]
#[allow(
    dead_code,
    reason = "exercised by the source-registry integration test, not the library test target"
)]
pub fn validate_registry() -> Result<RegistrySummary, String> {
    validate_registry_json(REGISTRY_JSON)
}

// Keep the outer identity and exact conformance receipt fields explicit at this trust boundary.
#[allow(clippy::too_many_arguments)]
pub fn validate_documentary_binding(
    method_profile_id: &str,
    source_work_id: &str,
    source_method_variant_id: &str,
    method_profile_version: &str,
    setting_id: &str,
    registry_input: &Value,
    conformance_fixture_id: &str,
    conformance_result_digest: &str,
    execution_eligible: bool,
) -> Result<(), String> {
    if execution_eligible {
        return Err("source-artifact documentary binding cannot be execution eligible".to_owned());
    }
    let artifact = load_registry()?;
    let row = artifact
        .rows
        .iter()
        .find(|row| row.method_setting_id == setting_id)
        .ok_or_else(|| "source-artifact documentary setting is not registered".to_owned())?;
    let profile = artifact
        .profile_identities
        .iter()
        .find(|profile| profile.source_work_id == row.source_work_id)
        .ok_or_else(|| {
            "source-artifact documentary profile identity is not registered".to_owned()
        })?;
    if method_profile_id != profile.method_profile_id
        || source_work_id != profile.source_work_id
        || source_method_variant_id != profile.source_method_variant_id
        || method_profile_version != profile.method_profile_version
    {
        return Err(
            "source-artifact documentary binding outer profile identity mismatch".to_owned(),
        );
    }
    let fixture = artifact
        .positive_fixtures
        .iter()
        .find(|fixture| {
            fixture.get("method_setting_id").and_then(Value::as_str) == Some(setting_id)
        })
        .ok_or_else(|| "source-artifact documentary setting is not registered".to_owned())?;
    if fixture.get("fixture_id").and_then(Value::as_str) != Some(conformance_fixture_id)
        || fixture.get("result_digest").and_then(Value::as_str) != Some(conformance_result_digest)
        || fixture.get("input") != Some(registry_input)
    {
        return Err(
            "source-artifact documentary binding does not exactly match its conformance fixture"
                .to_owned(),
        );
    }
    let result = register_source_artifact_provenance(registry_input);
    if result.get("accepted").and_then(Value::as_bool) != Some(true)
        || result.get("executionEligible").and_then(Value::as_bool) != Some(false)
        || fixture.get("expected_result") != Some(&result)
        || jcs_digest(&result)? != conformance_result_digest
    {
        return Err("source-artifact documentary conformance result drift".to_owned());
    }
    Ok(())
}

fn reject(error_code: &str) -> Value {
    json!({
        "accepted": false,
        "registryStatus": "rejected",
        "errorCode": error_code,
        "artifactContentsAvailable": false,
        "contentDigestVerified": false,
        "executionEligible": false,
    })
}

pub fn register_source_artifact_provenance(input: &Value) -> Value {
    let Ok(artifact) = load_registry() else {
        return reject("registry_artifact_invalid");
    };
    let input_keys = [
        "method_setting_id",
        "operation",
        "public_contract_version",
        "source_artifact_provenance",
        "source_artifact_provenance_object_digest",
        "source_extraction_id",
        "source_value_sha256",
        "source_work_id",
    ]
    .map(str::to_owned);
    if !exact_keys(input, &input_keys) {
        return reject("invalid_input_keys");
    }
    if input.get("operation").and_then(Value::as_str) != Some("register_source_artifact_provenance")
        || input.get("public_contract_version").and_then(Value::as_str)
            != Some("source-artifact-provenance-registry/v1")
    {
        return reject("unsupported_contract_operation");
    }
    let Some(setting_id) = input.get("method_setting_id").and_then(Value::as_str) else {
        return reject("unknown_setting_id");
    };
    let Some(registered) = artifact
        .rows
        .iter()
        .find(|row| row.method_setting_id == setting_id)
    else {
        return reject("unknown_setting_id");
    };
    if input.get("source_work_id").and_then(Value::as_str)
        != Some(registered.source_work_id.as_str())
    {
        return reject("source_work_identity_mismatch");
    }
    if input.get("source_extraction_id").and_then(Value::as_str)
        != Some(registered.source_extraction_id.as_str())
    {
        return reject("source_extraction_identity_mismatch");
    }
    if input.get("source_value_sha256").and_then(Value::as_str)
        != Some(registered.source_value_sha256.as_str())
    {
        return reject("source_value_digest_mismatch");
    }
    let provenance = &input["source_artifact_provenance"];
    if !exact_keys(provenance, &registered.provenance_keys) {
        return reject("invalid_provenance_keys");
    }
    if provenance
        .get("source_artifact_provenance_id")
        .and_then(Value::as_str)
        != Some(format!("source-artifact-provenance:{setting_id}").as_str())
    {
        return reject("provenance_setting_identity_mismatch");
    }
    let Ok(computed_digest) = jcs_digest(provenance) else {
        return reject("provenance_digest_mismatch");
    };
    if input
        .get("source_artifact_provenance_object_digest")
        .and_then(Value::as_str)
        != Some(computed_digest.as_str())
    {
        return reject("provenance_digest_mismatch");
    }
    if computed_digest != registered.source_artifact_provenance_object_digest {
        return reject("unregistered_provenance_object");
    }
    if registered.candidate_status.starts_with("blocked_") {
        return reject(&registered.candidate_status);
    }
    let contents_available = provenance
        .as_object()
        .is_some_and(|object| object.contains_key("locally_validated_artifact_digest"));
    json!({
        "accepted": true,
        "registryStatus": "registered_documentary_provenance",
        "methodSettingId": setting_id,
        "sourceArtifactProvenanceId": provenance["source_artifact_provenance_id"],
        "assertionDigest": computed_digest,
        "artifactContentsAvailable": contents_available,
        "contentDigestVerified": contents_available,
        "executionEligible": false,
        "browserRoundtripAssertion": provenance,
    })
}
