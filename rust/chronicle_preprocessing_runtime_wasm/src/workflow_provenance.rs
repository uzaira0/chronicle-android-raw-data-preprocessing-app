//! Rust-owned JSON-LD projection of one workflow run.
//!
//! This module deliberately keeps prospective semantic operations separate
//! from observed physical-query executions. A fused query can map to several
//! operations with different applicability, so query success is never promoted
//! into a false claim that every mapped semantic operation was applied.
//! TypeScript only transports the resulting bytes.

use crate::RuntimeQueryExecution;
use chronicle_preprocessing_semantic_adapter::ExecutionStatus;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const CHRON: &str = "https://w3id.org/chronicle-usage-ontology/core/";
const ROOT_OPERATION_ID: &str = "workflow.run";

fn digest_suffix<'a>(digest: &'a str, label: &str) -> Result<&'a str, String> {
    let suffix = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| format!("workflow provenance {label} must use sha256:<hex>"))?;
    if suffix.len() != 64
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!(
            "workflow provenance {label} has an invalid SHA-256 digest"
        ));
    }
    Ok(suffix)
}

fn checked_id<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~'))
    {
        return Err(format!(
            "workflow provenance {label} is not an IRI-safe stable id: {value}"
        ));
    }
    Ok(value)
}

fn operation_iri(operation_id: &str) -> Result<String, String> {
    Ok(format!(
        "urn:chronicle:operation:{}",
        checked_id(operation_id, "operation id")?
    ))
}

fn query_iri(query_id: &str) -> Result<String, String> {
    Ok(format!(
        "urn:chronicle:query:{}",
        checked_id(query_id, "query id")?
    ))
}

fn execution_iri(run_suffix: &str, layer: &str, definition_id: &str) -> Result<String, String> {
    Ok(format!(
        "urn:chronicle:execution:{run_suffix}:{}:{}",
        checked_id(layer, "execution layer")?,
        checked_id(definition_id, "execution definition id")?
    ))
}

fn iri_ref(iri: impl Into<String>) -> Value {
    json!({ "@id": iri.into() })
}

fn iri_values(values: impl IntoIterator<Item = String>) -> Value {
    Value::Array(values.into_iter().map(iri_ref).collect())
}

fn string_values(values: impl IntoIterator<Item = String>) -> Value {
    Value::Array(values.into_iter().map(Value::String).collect())
}

fn datetime_value(timestamp: &str) -> Value {
    json!({ "@value": timestamp, "@type": "xsd:dateTime" })
}

fn serialized_enum(value: impl Serialize) -> Result<String, String> {
    serde_json::to_value(value)
        .map_err(|error| format!("serialize workflow provenance enum: {error}"))?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "workflow provenance enum did not serialize as a string".to_string())
}

fn canonical_value(value: &Value) -> Result<String, String> {
    let bytes = serde_jcs::to_vec(value)
        .map_err(|error| format!("canonicalize workflow provenance binding: {error}"))?;
    String::from_utf8(bytes)
        .map_err(|error| format!("workflow provenance binding was not UTF-8: {error}"))
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn run_suffix(run_id: &str, input_digest: &str, parameter_set_digest: &str) -> String {
    let mut hasher = Sha256::new();
    for value in [run_id, input_digest, parameter_set_digest] {
        hasher.update((value.len() as u64).to_le_bytes());
        hasher.update(value.as_bytes());
    }
    hex::encode(hasher.finalize())
}

fn execution_status(status: ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::Cached => "cached",
        ExecutionStatus::Recomputed => "recomputed",
        ExecutionStatus::Error => "error",
        ExecutionStatus::Skipped => "skipped",
        ExecutionStatus::Bypassed => "bypassed",
    }
}

/// Emit the deterministic JSON-LD sidecar used by production runs and the
/// ontology conformance gate.
///
/// Semantic operations are prospective definitions. Retrospective child
/// activities are `QueryExecution` nodes covering every supplied physical
/// execution state, including cached, bypassed, skipped, and failed evidence.
#[allow(clippy::too_many_arguments)]
pub fn build_workflow_provenance_jsonld(
    run_id: &str,
    input_digest: &str,
    parameter_set_digest: &str,
    parameter_set: &Value,
    timestamp: &str,
    query_executions: &[RuntimeQueryExecution],
) -> Result<Vec<u8>, String> {
    if run_id.trim().is_empty() {
        return Err("workflow provenance run id must be non-empty".into());
    }
    if timestamp.trim().is_empty() {
        return Err("workflow provenance timestamp must be non-empty".into());
    }
    let input_suffix = digest_suffix(input_digest, "input digest")?;
    let parameter_suffix = digest_suffix(parameter_set_digest, "parameter-set digest")?;
    let parameter_object = parameter_set
        .as_object()
        .ok_or_else(|| "workflow provenance parameter set must be a JSON object".to_string())?;
    let parameter_bytes = serde_jcs::to_vec(parameter_set)
        .map_err(|error| format!("canonicalize workflow provenance parameter set: {error}"))?;
    if sha256(&parameter_bytes) != parameter_set_digest {
        return Err(
            "workflow provenance parameter-set digest does not match its canonical value".into(),
        );
    }

    let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let contract_queries = contract
        .execution
        .queries
        .iter()
        .map(|query| (query.id, query))
        .collect::<BTreeMap<_, _>>();
    let mut execution_by_query = BTreeMap::<&str, &RuntimeQueryExecution>::new();
    for execution in query_executions {
        let Some(definition) = contract_queries.get(execution.query_id.as_str()) else {
            return Err(format!(
                "workflow provenance received unknown query execution: {}",
                execution.query_id
            ));
        };
        if execution.query_group_id != definition.group {
            return Err(format!(
                "workflow provenance query {} names group {}, expected {}",
                execution.query_id, execution.query_group_id, definition.group
            ));
        }
        if execution_by_query
            .insert(execution.query_id.as_str(), execution)
            .is_some()
        {
            return Err(format!(
                "workflow provenance received duplicate query execution: {}",
                execution.query_id
            ));
        }
    }

    let run_suffix = run_suffix(run_id, input_digest, parameter_set_digest);
    let plan_iri = format!(
        "urn:chronicle:workflow-plan:{}",
        contract.workflow_model_version
    );
    let root_operation_iri = operation_iri(ROOT_OPERATION_ID)?;
    let root_execution_iri = execution_iri(&run_suffix, "operation", ROOT_OPERATION_ID)?;
    let parameter_set_iri = format!("urn:chronicle:parameter-set:{parameter_suffix}");
    let input_iri = format!("urn:chronicle:input:{input_suffix}");
    let agent_iri = format!(
        "urn:chronicle:agent:preprocessor:{}",
        checked_id(contract.preprocessor_version, "preprocessor version")?
    );

    let mut graph = Vec::<Value>::new();
    let mut plan_operations = vec![iri_ref(root_operation_iri.clone())];
    plan_operations.extend(
        contract
            .semantic
            .operations
            .iter()
            .map(|operation| operation_iri(operation.id).map(iri_ref))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let plan_queries = contract
        .execution
        .queries
        .iter()
        .map(|query| query_iri(query.id).map(iri_ref))
        .collect::<Result<Vec<_>, _>>()?;
    graph.push(json!({
        "@id": plan_iri,
        "@type": "chron:WorkflowPlan",
        "chron:plan_id": format!("chron:workflow-plan-{}", contract.workflow_model_version),
        "chron:operations": plan_operations,
        "chron:queries": plan_queries,
        "chron:semantic_contract_digest": contract.digests.semantic,
        "chron:execution_contract_digest": contract.digests.execution,
        "chron:evidence_contract_digest": contract.digests.evidence,
    }));

    let binding_nodes = parameter_object
        .iter()
        .map(|(key, value)| {
            Ok(json!({
                "@id": format!(
                    "urn:chronicle:parameter-set:{parameter_suffix}:binding:{}",
                    checked_id(key, "parameter key")?
                ),
                "@type": "chron:ParameterBinding",
                "chron:knob_key": key,
                "chron:knob_value": canonical_value(value)?,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let binding_refs = binding_nodes
        .iter()
        .filter_map(|node| node.get("@id").and_then(Value::as_str))
        .map(|iri| iri_ref(iri.to_string()))
        .collect::<Vec<_>>();
    let mut parameter_node = Map::from_iter([
        ("@id".into(), Value::String(parameter_set_iri.clone())),
        ("@type".into(), json!(["chron:ParameterSet", "prov:Entity"])),
        (
            "chron:parameter_set_sha256".into(),
            Value::String(parameter_set_digest.into()),
        ),
        ("chron:bindings".into(), Value::Array(binding_refs)),
    ]);
    if binding_nodes.is_empty() {
        parameter_node.remove("chron:bindings");
    }
    graph.push(Value::Object(parameter_node));
    graph.extend(binding_nodes);
    graph.push(json!({
        "@id": input_iri,
        "@type": "prov:Entity",
        "chron:input_sha256": input_digest,
    }));
    graph.push(json!({
        "@id": agent_iri,
        "@type": ["prov:Agent", "prov:SoftwareAgent"],
        "chron:preprocessor_version": contract.preprocessor_version,
    }));
    graph.push(json!({
        "@id": root_operation_iri,
        "@type": "chron:OperationDefinition",
        "chron:operation_id": ROOT_OPERATION_ID,
        "chron:verb": "execute workflow",
        "chron:engine": "chronicle_preprocessing_runtime_wasm",
        "rdfs:label": "Run the Chronicle preprocessing workflow",
    }));

    let artifact_producers = contract
        .semantic
        .artifacts
        .iter()
        .filter_map(|artifact| {
            artifact
                .producer_operation_id
                .map(|producer| (artifact.id.as_str(), producer))
        })
        .collect::<BTreeMap<_, _>>();
    for operation in &contract.semantic.operations {
        let depends_on = operation
            .input_artifacts
            .iter()
            .filter_map(|artifact| artifact_producers.get(artifact.as_str()).copied())
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let data_effects = operation
            .data_effects
            .iter()
            .map(|effect| serialized_enum(*effect))
            .collect::<Result<Vec<_>, _>>()?;
        let mut definition = Map::from_iter([
            ("@id".into(), Value::String(operation_iri(operation.id)?)),
            (
                "@type".into(),
                Value::String("chron:OperationDefinition".into()),
            ),
            (
                "chron:operation_id".into(),
                Value::String(operation.id.into()),
            ),
            ("chron:verb".into(), Value::String(operation.label.into())),
            (
                "chron:engine".into(),
                Value::String("chronicle_chrono_kernel_wasm".into()),
            ),
            (
                "chron:operation_role".into(),
                Value::String(serialized_enum(operation.role)?),
            ),
            (
                "chron:epistemic_role".into(),
                Value::String(serialized_enum(operation.epistemic_role)?),
            ),
            (
                "chron:consumes".into(),
                string_values(operation.input_artifacts.iter().cloned()),
            ),
            (
                "chron:produces".into(),
                string_values(operation.output_artifacts.iter().cloned()),
            ),
            (
                "chron:depends_on".into(),
                string_values(depends_on.into_iter()),
            ),
            (
                "chron:configuration_dependencies".into(),
                string_values(
                    operation
                        .config_dependencies
                        .iter()
                        .map(|dependency| dependency.field.clone()),
                ),
            ),
            ("chron:data_effects".into(), string_values(data_effects)),
            (
                "dcterms:isPartOf".into(),
                iri_ref(root_operation_iri.clone()),
            ),
            ("rdfs:label".into(), Value::String(operation.label.into())),
            (
                "dcterms:description".into(),
                Value::String(operation.description.into()),
            ),
        ]);
        for key in [
            "chron:consumes",
            "chron:produces",
            "chron:depends_on",
            "chron:configuration_dependencies",
            "chron:data_effects",
        ] {
            if definition
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                definition.remove(key);
            }
        }
        graph.push(Value::Object(definition));
    }

    for query in &contract.execution.queries {
        let mut definition = Map::from_iter([
            ("@id".into(), Value::String(query_iri(query.id)?)),
            (
                "@type".into(),
                Value::String("chron:QueryDefinition".into()),
            ),
            ("chron:query_id".into(), Value::String(query.id.into())),
            (
                "chron:query_group_id".into(),
                Value::String(query.group.into()),
            ),
            (
                "chron:query_dependencies".into(),
                iri_values(
                    query
                        .inputs
                        .iter()
                        .map(|input| query_iri(input))
                        .collect::<Result<Vec<_>, _>>()?,
                ),
            ),
            (
                "chron:realizes_operations".into(),
                iri_values(
                    query
                        .operation_ids
                        .iter()
                        .map(|operation| operation_iri(operation))
                        .collect::<Result<Vec<_>, _>>()?,
                ),
            ),
            (
                "chron:query_outputs".into(),
                string_values(query.output_ports.iter().cloned()),
            ),
            (
                "chron:query_request_fields".into(),
                string_values(
                    query
                        .request_fields
                        .iter()
                        .map(|field| (*field).to_string()),
                ),
            ),
        ]);
        for key in [
            "chron:query_dependencies",
            "chron:realizes_operations",
            "chron:query_outputs",
            "chron:query_request_fields",
        ] {
            if definition
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                definition.remove(key);
            }
        }
        graph.push(Value::Object(definition));
    }

    graph.push(json!({
        "@id": root_execution_iri,
        "@type": ["chron:OperationExecution", "prov:Activity"],
        "chron:execution_id": format!("chron:workflow-run-{run_suffix}"),
        "chron:executes_operation": iri_ref(root_operation_iri.clone()),
        "chron:used_parameter_set": iri_ref(parameter_set_iri.clone()),
        "prov:used": [iri_ref(input_iri), iri_ref(parameter_set_iri.clone())],
        "prov:wasAssociatedWith": iri_ref(agent_iri),
        "prov:startedAtTime": datetime_value(timestamp),
        "prov:endedAtTime": datetime_value(timestamp),
    }));

    for query in &contract.execution.queries {
        let Some(execution) = execution_by_query.get(query.id).copied() else {
            continue;
        };
        let informed_by = query
            .inputs
            .iter()
            .filter(|input| execution_by_query.contains_key(**input))
            .map(|input| execution_iri(&run_suffix, "query", input).map(iri_ref))
            .collect::<Result<Vec<_>, _>>()?;
        let mut node = Map::from_iter([
            (
                "@id".into(),
                Value::String(execution_iri(&run_suffix, "query", query.id)?),
            ),
            (
                "@type".into(),
                json!(["chron:QueryExecution", "prov:Activity"]),
            ),
            ("chron:executes_query".into(), iri_ref(query_iri(query.id)?)),
            (
                "chron:used_parameter_set".into(),
                iri_ref(parameter_set_iri.clone()),
            ),
            (
                "chron:query_execution_status".into(),
                Value::String(execution_status(execution.status).into()),
            ),
            (
                "chron:query_input_key".into(),
                Value::String(execution.input_key.clone()),
            ),
            (
                "chron:query_output_digest".into(),
                Value::String(execution.output_digest.clone()),
            ),
            (
                "chron:query_reason_id".into(),
                Value::String(execution.reason_id.clone()),
            ),
            (
                "dcterms:isPartOf".into(),
                iri_ref(root_execution_iri.clone()),
            ),
            ("prov:startedAtTime".into(), datetime_value(timestamp)),
            ("prov:endedAtTime".into(), datetime_value(timestamp)),
            ("prov:wasInformedBy".into(), Value::Array(informed_by)),
        ]);
        if node
            .get("prov:wasInformedBy")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            node.remove("prov:wasInformedBy");
        }
        graph.push(Value::Object(node));
    }

    serde_jcs::to_vec(&json!({
        "@context": {
            "chron": CHRON,
            "prov": "http://www.w3.org/ns/prov#",
            "dcterms": "http://purl.org/dc/terms/",
            "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
            "xsd": "http://www.w3.org/2001/XMLSchema#"
        },
        "@graph": graph,
    }))
    .map_err(|error| format!("canonicalize workflow provenance JSON-LD: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn execution(
        query_id: &str,
        query_group_id: &str,
        status: ExecutionStatus,
    ) -> RuntimeQueryExecution {
        RuntimeQueryExecution {
            query_id: query_id.into(),
            query_group_id: query_group_id.into(),
            status,
            input_key: format!("sha256:{}", "1".repeat(64)),
            output_digest: format!("sha256:{}", "2".repeat(64)),
            reason_id: format!("sha256:{}", "3".repeat(64)),
        }
    }

    fn parameter_set() -> Value {
        json!({"process_app_usage": true, "minimum_usage_duration": 1.0})
    }

    fn parameter_digest(value: &Value) -> String {
        sha256(&serde_jcs::to_vec(value).unwrap())
    }

    #[test]
    fn sidecar_is_deterministic_and_does_not_infer_semantic_operation_execution() {
        let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
        let query = |query_id| {
            contract
                .execution
                .queries
                .iter()
                .find(|query| query.id == query_id)
                .expect("provenance fixture query must have a stable contract identity")
        };
        let first_query = query("validate_remap_rules");
        let second_query = query("decode_source_records");
        let executions = [
            execution(
                first_query.id,
                first_query.group,
                ExecutionStatus::Recomputed,
            ),
            execution(
                second_query.id,
                second_query.group,
                ExecutionStatus::Bypassed,
            ),
        ];
        let parameters = parameter_set();
        let digest = parameter_digest(&parameters);
        let input_digest = format!("sha256:{}", "b".repeat(64));
        let first = build_workflow_provenance_jsonld(
            "run-1",
            &input_digest,
            &digest,
            &parameters,
            "2026-08-03T00:00:00Z",
            &executions,
        )
        .unwrap();
        let second = build_workflow_provenance_jsonld(
            "run-1",
            &input_digest,
            &digest,
            &parameters,
            "2026-08-03T00:00:00Z",
            &executions.iter().cloned().rev().collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(first, second);

        let document: Value = serde_json::from_slice(&first).unwrap();
        let graph = document["@graph"].as_array().unwrap();
        assert!(graph
            .iter()
            .any(|node| node["@type"] == "chron:WorkflowPlan"));
        assert_eq!(
            graph
                .iter()
                .filter(|node| {
                    node["@type"].as_array().is_some_and(|types| {
                        types.iter().any(|kind| kind == "chron:OperationExecution")
                    })
                })
                .count(),
            1,
            "only the root workflow execution has operation-specific evidence"
        );
        let query_executions = graph
            .iter()
            .filter(|node| {
                node["@type"]
                    .as_array()
                    .is_some_and(|types| types.iter().any(|kind| kind == "chron:QueryExecution"))
            })
            .collect::<Vec<_>>();
        assert_eq!(query_executions.len(), 2);
        assert!(query_executions
            .iter()
            .any(|node| { node["chron:query_execution_status"] == "recomputed" }));
        assert!(query_executions
            .iter()
            .any(|node| { node["chron:query_execution_status"] == "bypassed" }));
    }

    #[test]
    fn sidecar_rejects_noncanonical_or_mismatched_identity_inputs() {
        let parameters = parameter_set();
        let digest = parameter_digest(&parameters);
        let input_digest = format!("sha256:{}", "b".repeat(64));
        assert!(build_workflow_provenance_jsonld(
            "run-1",
            "not-a-digest",
            &digest,
            &parameters,
            "2026-08-03T00:00:00Z",
            &[],
        )
        .is_err());
        assert!(build_workflow_provenance_jsonld(
            "run-1",
            &input_digest,
            &format!("sha256:{}", "a".repeat(64)),
            &parameters,
            "2026-08-03T00:00:00Z",
            &[],
        )
        .is_err());
        assert!(build_workflow_provenance_jsonld(
            "run-1",
            &input_digest,
            &digest,
            &Value::Array(Vec::new()),
            "2026-08-03T00:00:00Z",
            &[],
        )
        .is_err());
        assert!(build_workflow_provenance_jsonld(
            " ",
            &input_digest,
            &digest,
            &parameters,
            "2026-08-03T00:00:00Z",
            &[],
        )
        .is_err());
    }
}
