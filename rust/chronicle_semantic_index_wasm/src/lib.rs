//! Derived RDF/SPARQL index for the Chronicle raw-data preprocessing app.
//!
//! The OPFS content-addressed artifact closure and evidence journal remain the
//! authority. This crate deterministically projects a bounded semantic source
//! into N-Quads and evaluates only product-registered SPARQL queries.

use oxigraph::io::RdfFormat;
use oxigraph::model::NamedNode;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

const ASSIGNMENTS_GRAPH: &str = "urn:chronicle:derived:assignments";
const OBLIGATIONS_GRAPH: &str = "urn:chronicle:derived:obligations";
const EXECUTION_GRAPH: &str = "urn:chronicle:derived:actual-execution";
const REASONS_GRAPH: &str = "urn:chronicle:derived:reasons";
const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PROV_ACTIVITY: &str = "http://www.w3.org/ns/prov#Activity";
const PROV_STARTED: &str = "http://www.w3.org/ns/prov#startedAtTime";
const PROV_ENDED: &str = "http://www.w3.org/ns/prov#endedAtTime";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexSource {
    protocol_version: String,
    input_digest: String,
    execution_timestamp: String,
    role_assignments: Vec<RoleAssignment>,
    open_obligations: Vec<OpenObligation>,
    state_reasons: Vec<StateReason>,
    node_executions: Vec<NodeExecution>,
    execution_ledger: Value,
}

#[derive(Debug, Deserialize)]
struct RoleAssignment {
    assignment_id: String,
    role_id: String,
    artifact: Artifact,
}

#[derive(Debug, Deserialize)]
struct Artifact {
    artifact_id: String,
    digest: String,
}

#[derive(Debug, Deserialize)]
struct OpenObligation {
    obligation_id: String,
    role_id: String,
    node_id: Option<String>,
    state: String,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
struct StateReason {
    reason_id: String,
    subject_id: String,
    state: String,
    source_id: String,
}

#[derive(Debug, Deserialize)]
struct NodeExecution {
    node_id: String,
    status: String,
    reason_id: String,
}

fn iri(value: &str) -> String {
    format!("<{value}>")
}

fn literal(value: &str) -> String {
    serde_json::to_string(value).expect("JSON strings are N-Triples literals")
}

fn quad(subject: &str, predicate: &str, object: &str, graph: &str) -> String {
    format!("{subject} {predicate} {object} <{graph}> .")
}

fn predicate(name: &str) -> String {
    iri(&format!("urn:chronicle:predicate:{name}"))
}

fn urn(kind: &str, value: &str) -> String {
    iri(&format!(
        "urn:chronicle:{kind}:{}",
        value.replace(['<', '>', ' ', '\"'], "_")
    ))
}

fn resource_iri(kind: &str, value: &str) -> String {
    if NamedNode::new(value.to_owned()).is_ok() {
        iri(value)
    } else {
        urn(kind, value)
    }
}

fn build_index(source: &IndexSource) -> Vec<u8> {
    let mut quads = Vec::new();
    for assignment in &source.role_assignments {
        let assignment_iri = resource_iri("assignment", &assignment.assignment_id);
        let artifact_iri = resource_iri("artifact", &assignment.artifact.artifact_id);
        quads.push(quad(
            &assignment_iri,
            &predicate("role"),
            &resource_iri("role", &assignment.role_id),
            ASSIGNMENTS_GRAPH,
        ));
        quads.push(quad(
            &assignment_iri,
            &predicate("artifact"),
            &artifact_iri,
            ASSIGNMENTS_GRAPH,
        ));
        quads.push(quad(
            &artifact_iri,
            &predicate("digest"),
            &literal(&assignment.artifact.digest),
            ASSIGNMENTS_GRAPH,
        ));
    }
    for obligation in &source.open_obligations {
        let obligation_iri = resource_iri("obligation", &obligation.obligation_id);
        quads.push(quad(
            &obligation_iri,
            &predicate("role"),
            &resource_iri("role", &obligation.role_id),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("node"),
            &urn("node", obligation.node_id.as_deref().unwrap_or("root")),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("state"),
            &urn("state", &obligation.state),
            OBLIGATIONS_GRAPH,
        ));
        quads.push(quad(
            &obligation_iri,
            &predicate("reason"),
            &resource_iri("reason", &obligation.reason_id),
            OBLIGATIONS_GRAPH,
        ));
    }
    for execution in &source.node_executions {
        let execution_iri = urn(
            "execution",
            &format!("{}:{}", source.input_digest, execution.node_id),
        );
        quads.push(quad(
            &execution_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ACTIVITY),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("node"),
            &urn("node", &execution.node_id),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("status"),
            &urn("execution-status", &execution.status),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_STARTED),
            &literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_ENDED),
            &literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("reason"),
            &resource_iri("reason", &execution.reason_id),
            EXECUTION_GRAPH,
        ));
    }
    for reason in &source.state_reasons {
        let transition = urn("transition", &reason.reason_id);
        quads.push(quad(
            &transition,
            &predicate("subject"),
            &urn("subject", &reason.subject_id),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("toState"),
            &urn("state", &reason.state),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("reason"),
            &resource_iri("reason", &reason.reason_id),
            REASONS_GRAPH,
        ));
        quads.push(quad(
            &transition,
            &predicate("source"),
            &resource_iri("source", &reason.source_id),
            REASONS_GRAPH,
        ));
    }
    quads.sort();
    quads.dedup();
    let mut bytes = quads.join("\n").into_bytes();
    if !bytes.is_empty() {
        bytes.push(b'\n');
    }
    bytes
}

fn registered_query(query_id: &str) -> Option<&'static str> {
    match query_id {
        "open-obligations" => Some("SELECT ?obligation ?role ?node ?reason WHERE { GRAPH <urn:chronicle:derived:obligations> { ?obligation <urn:chronicle:predicate:role> ?role ; <urn:chronicle:predicate:node> ?node ; <urn:chronicle:predicate:state> <urn:chronicle:state:open> ; <urn:chronicle:predicate:reason> ?reason . } } ORDER BY ?node ?role"),
        "actual-executions" => Some("SELECT ?execution ?node ?status ?started ?ended WHERE { GRAPH <urn:chronicle:derived:actual-execution> { ?execution a <http://www.w3.org/ns/prov#Activity> ; <urn:chronicle:predicate:node> ?node ; <urn:chronicle:predicate:status> ?status ; <http://www.w3.org/ns/prov#startedAtTime> ?started . OPTIONAL { ?execution <http://www.w3.org/ns/prov#endedAtTime> ?ended } } } ORDER BY ?started ?node"),
        "role-assignments" => Some("SELECT ?assignment ?role ?artifact ?digest WHERE { GRAPH <urn:chronicle:derived:assignments> { ?assignment <urn:chronicle:predicate:role> ?role ; <urn:chronicle:predicate:artifact> ?artifact . ?artifact <urn:chronicle:predicate:digest> ?digest . } } ORDER BY ?role ?digest"),
        "reason-trace" => Some("SELECT ?transition ?subject ?from ?to ?reason ?source WHERE { GRAPH <urn:chronicle:derived:reasons> { ?transition <urn:chronicle:predicate:subject> ?subject ; <urn:chronicle:predicate:toState> ?to ; <urn:chronicle:predicate:reason> ?reason ; <urn:chronicle:predicate:source> ?source . OPTIONAL { ?transition <urn:chronicle:predicate:fromState> ?from } } } ORDER BY ?transition"),
        _ => None,
    }
}

fn query(index: &[u8], query_id: &str) -> Result<Value, String> {
    let query = registered_query(query_id)
        .ok_or_else(|| format!("unregistered production query: {query_id}"))?;
    let store = Store::new().map_err(|error| error.to_string())?;
    store
        .load_from_slice(RdfFormat::NQuads, index)
        .map_err(|error| format!("load derived N-Quads: {error}"))?;
    let results = SparqlEvaluator::new()
        .parse_query(query)
        .map_err(|error| format!("parse registered query: {error}"))?
        .on_store(&store)
        .execute()
        .map_err(|error| format!("execute registered query: {error}"))?;
    match results {
        QueryResults::Solutions(mut solutions) => {
            let result_variables = solutions.variables().to_vec();
            let variables = result_variables
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            for solution in &mut solutions {
                let solution = solution.map_err(|error| error.to_string())?;
                let mut row = BTreeMap::new();
                for variable in &result_variables {
                    if let Some(term) = solution.get(variable) {
                        row.insert(variable.to_string(), term.to_string());
                    }
                }
                rows.push(row);
            }
            Ok(json!({ "queryId": query_id, "variables": variables, "rows": rows }))
        }
        QueryResults::Boolean(value) => Ok(json!({ "queryId": query_id, "boolean": value })),
        QueryResults::Graph(_) => Err("registered query unexpectedly returned a graph".into()),
    }
}

#[wasm_bindgen]
pub fn rebuild_semantic_index(source_json: &[u8]) -> Result<Vec<u8>, JsValue> {
    console_error_panic_hook::set_once();
    rebuild_semantic_index_native(source_json).map_err(|error| JsValue::from_str(&error))
}

pub fn rebuild_semantic_index_native(source_json: &[u8]) -> Result<Vec<u8>, String> {
    let source: IndexSource = serde_json::from_slice(source_json)
        .map_err(|error| format!("invalid semantic index source: {error}"))?;
    if source.protocol_version != "chronicle-semantic-index-source/v1" {
        return Err("unsupported semantic index source".into());
    }
    if !source.execution_ledger.is_array() {
        return Err("semantic index source ledger is invalid".into());
    }
    let index = build_index(&source);
    let store = Store::new().map_err(|error| error.to_string())?;
    store
        .load_from_slice(RdfFormat::NQuads, &index)
        .map_err(|error| format!("validate derived N-Quads: {error}"))?;
    Ok(index)
}

#[wasm_bindgen]
pub fn query_registered(index: &[u8], query_id: &str) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    query_registered_native(index, query_id).map_err(|error| JsValue::from_str(&error))
}

pub fn query_registered_native(index: &[u8], query_id: &str) -> Result<String, String> {
    query(index, query_id)
        .and_then(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_source() -> Value {
        json!({
            "protocolVersion": "chronicle-semantic-index-source/v1",
            "inputDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "executionTimestamp": "2026-07-21 12:00:00 UTC",
            "roleAssignments": [{
                "assignment_id": "assignment with spaces",
                "role_id": "raw role",
                "artifact": { "artifact_id": "urn:artifact:1", "digest": "sha256:aaaa" }
            }],
            "openObligations": [
                {
                    "obligation_id": "urn:obligation:1", "role_id": "urn:role:filter",
                    "node_id": "app_policy", "state": "open", "reason_id": "urn:reason:missing-filter"
                },
                {
                    "obligation_id": "root obligation", "role_id": "root role",
                    "node_id": null, "state": "open", "reason_id": "root reason"
                }
            ],
            "stateReasons": [{
                "reason_id": "reason with spaces", "subject_id": "app policy",
                "state": "open", "source_id": "product contract"
            }],
            "nodeExecutions": [{
                "node_id": "parse_events", "status": "recomputed", "reason_id": "urn:reason:1"
            }],
            "executionLedger": []
        })
    }

    #[test]
    fn index_rebuild_is_deterministic_and_registered_queries_are_bounded() {
        let source = complete_source();
        let parsed: IndexSource = serde_json::from_value(source).unwrap();
        let first = build_index(&parsed);
        assert_eq!(first, build_index(&parsed));
        for (query_id, expected_rows) in [
            ("role-assignments", 1),
            ("open-obligations", 2),
            ("actual-executions", 1),
            ("reason-trace", 1),
        ] {
            let result = query(&first, query_id).unwrap();
            assert_eq!(result["rows"].as_array().unwrap().len(), expected_rows);
        }
        assert!(String::from_utf8(first.clone())
            .unwrap()
            .contains("assignment_with_spaces"));
        assert!(query(&first, "DROP ALL")
            .unwrap_err()
            .contains("unregistered"));
        assert!(query(b"not n-quads", "role-assignments")
            .unwrap_err()
            .contains("load derived N-Quads"));
    }

    #[test]
    fn native_and_wasm_facades_validate_sources_and_return_registered_results() {
        let bytes = serde_json::to_vec(&complete_source()).unwrap();
        let native = rebuild_semantic_index_native(&bytes).unwrap();
        assert_eq!(native, rebuild_semantic_index(&bytes).unwrap());
        let native_query = query_registered_native(&native, "open-obligations").unwrap();
        let wasm_query = query_registered(&native, "open-obligations").unwrap();
        assert_eq!(native_query, wasm_query);

        assert!(rebuild_semantic_index_native(b"{")
            .unwrap_err()
            .contains("invalid semantic index source"));
        let mut unsupported = complete_source();
        unsupported["protocolVersion"] = Value::String("future".into());
        assert_eq!(
            rebuild_semantic_index_native(&serde_json::to_vec(&unsupported).unwrap()).unwrap_err(),
            "unsupported semantic index source"
        );
        let mut invalid_ledger = complete_source();
        invalid_ledger["executionLedger"] = Value::Null;
        assert_eq!(
            rebuild_semantic_index_native(&serde_json::to_vec(&invalid_ledger).unwrap())
                .unwrap_err(),
            "semantic index source ledger is invalid"
        );
        assert!(query_registered_native(&native, "arbitrary-query").is_err());
    }

    #[test]
    fn empty_source_produces_a_valid_empty_index() {
        let mut empty = complete_source();
        empty["roleAssignments"] = json!([]);
        empty["openObligations"] = json!([]);
        empty["stateReasons"] = json!([]);
        empty["nodeExecutions"] = json!([]);
        let parsed: IndexSource = serde_json::from_value(empty).unwrap();
        assert!(build_index(&parsed).is_empty());
    }
}
