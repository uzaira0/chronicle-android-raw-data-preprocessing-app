//! Derived RDF/SPARQL index for the Chronicle raw-data preprocessing app.
//!
//! The OPFS content-addressed artifact closure and evidence journal remain the
//! authority. This crate deterministically projects a bounded semantic source
//! into N-Quads and evaluates only product-registered SPARQL queries.

use oxigraph::model::NamedNode;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use oxttl::NQuadsParser;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

const ASSIGNMENTS_GRAPH: &str = "urn:chronicle:derived:assignments";
const QUALIFICATION_GRAPH: &str = "urn:chronicle:derived:qualification";
const OBLIGATIONS_GRAPH: &str = "urn:chronicle:derived:obligations";
const EXECUTION_GRAPH: &str = "urn:chronicle:derived:actual-execution";
const REASONS_GRAPH: &str = "urn:chronicle:derived:reasons";
const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PROV_ACTIVITY: &str = "http://www.w3.org/ns/prov#Activity";
const PROV_ENTITY: &str = "http://www.w3.org/ns/prov#Entity";
const PROV_USED: &str = "http://www.w3.org/ns/prov#used";
const PROV_STARTED: &str = "http://www.w3.org/ns/prov#startedAtTime";
const PROV_ENDED: &str = "http://www.w3.org/ns/prov#endedAtTime";
const PPLAN_CORRESPONDS_TO_STEP: &str = "http://purl.org/net/p-plan#correspondsToStep";
const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";
const XSD_DATE_TIME: &str = "http://www.w3.org/2001/XMLSchema#dateTime";
const XSD_UNSIGNED_LONG: &str = "http://www.w3.org/2001/XMLSchema#unsignedLong";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexSource {
    protocol_version: String,
    input_digest: String,
    execution_timestamp: String,
    role_assignments: Vec<RoleAssignment>,
    qualification_traces: Vec<QualificationTrace>,
    requirement_traces: Vec<RoleRequirementTrace>,
    open_obligations: Vec<OpenObligation>,
    state_reasons: Vec<StateReason>,
    node_executions: Vec<NodeExecution>,
    step_executions: Vec<StepExecution>,
    pipeline_step_digests: BTreeMap<String, String>,
    pipeline_step_checkpoints: BTreeMap<String, PipelineStepCheckpoint>,
    #[serde(default)]
    dependency_cache_decision: Option<DependencyCacheDecision>,
    execution_ledger: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DependencyCacheDecision {
    mode: String,
    certificate_digest: Option<String>,
    binding_surface_digest: Option<String>,
    empirical_evidence_current: bool,
    reasons: Vec<String>,
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
struct QualificationTrace {
    trace_id: String,
    candidate_id: String,
    candidate_revision: u64,
    artifact_digest: String,
    qualifiers_digest: String,
    asserted_role_ids: Vec<String>,
    selected_role_id: Option<String>,
    decision: String,
    rule_evaluations: Vec<QualificationRuleEvaluation>,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
struct QualificationRuleEvaluation {
    rule_id: String,
    passed: bool,
    expected: String,
    observed: String,
}

#[derive(Debug, Deserialize)]
struct RoleRequirementTrace {
    trace_id: String,
    role_id: String,
    required: bool,
    unconditional: bool,
    condition_id: Option<String>,
    condition_result: Option<bool>,
    candidate_trace_ids: Vec<String>,
    accepted_assignment_ids: Vec<String>,
    state: String,
    reason_id: String,
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

#[derive(Debug, Deserialize)]
struct StepExecution {
    step_id: String,
    unit_id: String,
    status: String,
    input_key: String,
    output_digest: String,
    reason_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PipelineStepCheckpoint {
    protocol_version: String,
    node_id: String,
    row_membership_digest: String,
    row_order_digest: String,
    temporal_state_digest: String,
    classification_digest: String,
    payload_digest: String,
    schema_digest: String,
    terminal_digest: String,
}

fn iri(value: &str) -> String {
    format!("<{value}>")
}

fn literal(value: &str) -> String {
    serde_json::to_string(value).expect("JSON strings are N-Triples literals")
}

fn date_time_literal(value: &str) -> String {
    let normalized = value
        .strip_suffix(" UTC")
        .map(|without_zone| format!("{}Z", without_zone.replacen(' ', "T", 1)))
        .unwrap_or_else(|| value.to_string());
    format!("{}^^<{}>", literal(&normalized), XSD_DATE_TIME)
}

fn boolean_literal(value: bool) -> String {
    format!("\"{value}\"^^<{}>", XSD_BOOLEAN)
}

fn unsigned_long_literal(value: u64) -> String {
    format!("\"{value}\"^^<{}>", XSD_UNSIGNED_LONG)
}

fn quad(subject: &str, predicate: &str, object: &str, graph: &str) -> String {
    format!("{subject} {predicate} {object} <{graph}> .")
}

fn predicate(name: &str) -> String {
    iri(&format!("urn:chronicle:predicate:{name}"))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_checkpoint_component_digest(value: &str) -> bool {
    value.len() == 37
        && value.starts_with("xxh3:")
        && value[5..].bytes().all(|byte| byte.is_ascii_hexdigit())
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
            &artifact_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ENTITY),
            ASSIGNMENTS_GRAPH,
        ));
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
    for trace in &source.qualification_traces {
        let trace_iri = resource_iri("qualification-trace", &trace.trace_id);
        quads.push(quad(
            &trace_iri,
            &predicate("candidate"),
            &resource_iri("candidate", &trace.candidate_id),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("candidateRevision"),
            &unsigned_long_literal(trace.candidate_revision),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("artifactDigest"),
            &literal(&trace.artifact_digest),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("qualifiersDigest"),
            &literal(&trace.qualifiers_digest),
            QUALIFICATION_GRAPH,
        ));
        for role_id in &trace.asserted_role_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("assertedRole"),
                &resource_iri("role", role_id),
                QUALIFICATION_GRAPH,
            ));
        }
        if let Some(role_id) = &trace.selected_role_id {
            quads.push(quad(
                &trace_iri,
                &predicate("selectedRole"),
                &resource_iri("role", role_id),
                QUALIFICATION_GRAPH,
            ));
        }
        quads.push(quad(
            &trace_iri,
            &predicate("decision"),
            &urn("qualification-decision", &trace.decision),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("reason"),
            &resource_iri("reason", &trace.reason_id),
            QUALIFICATION_GRAPH,
        ));
        for (index, rule) in trace.rule_evaluations.iter().enumerate() {
            let evaluation_iri = urn(
                "qualification-evaluation",
                &format!("{}:{index}:{}", trace.trace_id, rule.rule_id),
            );
            quads.push(quad(
                &trace_iri,
                &predicate("ruleEvaluation"),
                &evaluation_iri,
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("rule"),
                &resource_iri("qualification-rule", &rule.rule_id),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("passed"),
                &boolean_literal(rule.passed),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("expected"),
                &literal(&rule.expected),
                QUALIFICATION_GRAPH,
            ));
            quads.push(quad(
                &evaluation_iri,
                &predicate("observed"),
                &literal(&rule.observed),
                QUALIFICATION_GRAPH,
            ));
        }
    }
    for trace in &source.requirement_traces {
        let trace_iri = resource_iri("requirement-trace", &trace.trace_id);
        quads.push(quad(
            &trace_iri,
            &predicate("role"),
            &resource_iri("role", &trace.role_id),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("required"),
            &boolean_literal(trace.required),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("unconditional"),
            &boolean_literal(trace.unconditional),
            QUALIFICATION_GRAPH,
        ));
        if let Some(condition_id) = &trace.condition_id {
            quads.push(quad(
                &trace_iri,
                &predicate("condition"),
                &resource_iri("condition", condition_id),
                QUALIFICATION_GRAPH,
            ));
        }
        if let Some(condition_result) = trace.condition_result {
            quads.push(quad(
                &trace_iri,
                &predicate("conditionResult"),
                &boolean_literal(condition_result),
                QUALIFICATION_GRAPH,
            ));
        }
        for candidate_trace_id in &trace.candidate_trace_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("candidateTrace"),
                &resource_iri("qualification-trace", candidate_trace_id),
                QUALIFICATION_GRAPH,
            ));
        }
        for assignment_id in &trace.accepted_assignment_ids {
            quads.push(quad(
                &trace_iri,
                &predicate("acceptedAssignment"),
                &resource_iri("assignment", assignment_id),
                QUALIFICATION_GRAPH,
            ));
        }
        quads.push(quad(
            &trace_iri,
            &predicate("state"),
            &urn("state", &trace.state),
            QUALIFICATION_GRAPH,
        ));
        quads.push(quad(
            &trace_iri,
            &predicate("reason"),
            &resource_iri("reason", &trace.reason_id),
            QUALIFICATION_GRAPH,
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
    if let Some(decision) = &source.dependency_cache_decision {
        let decision_iri = urn("dependency-cache-decision", &source.input_digest);
        quads.push(quad(
            &decision_iri,
            &predicate("cacheMode"),
            &urn("dependency-cache-mode", &decision.mode),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &decision_iri,
            &predicate("empiricalEvidenceCurrent"),
            &boolean_literal(decision.empirical_evidence_current),
            EXECUTION_GRAPH,
        ));
        if let Some(digest) = &decision.certificate_digest {
            quads.push(quad(
                &decision_iri,
                &predicate("dependencyCertificate"),
                &resource_iri("dependency-certificate", digest),
                EXECUTION_GRAPH,
            ));
        }
        if let Some(digest) = &decision.binding_surface_digest {
            quads.push(quad(
                &decision_iri,
                &predicate("bindingSurfaceDigest"),
                &literal(digest),
                EXECUTION_GRAPH,
            ));
        }
        for reason in &decision.reasons {
            quads.push(quad(
                &decision_iri,
                &predicate("reason"),
                &urn("dependency-cache-reason", reason),
                EXECUTION_GRAPH,
            ));
        }
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
            &iri(PPLAN_CORRESPONDS_TO_STEP),
            &urn("node", &execution.node_id),
            EXECUTION_GRAPH,
        ));
        for assignment in &source.role_assignments {
            quads.push(quad(
                &execution_iri,
                &iri(PROV_USED),
                &resource_iri("artifact", &assignment.artifact.artifact_id),
                EXECUTION_GRAPH,
            ));
        }
        quads.push(quad(
            &execution_iri,
            &predicate("status"),
            &urn("execution-status", &execution.status),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_STARTED),
            &date_time_literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_ENDED),
            &date_time_literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("reason"),
            &resource_iri("reason", &execution.reason_id),
            EXECUTION_GRAPH,
        ));
    }
    for execution in &source.step_executions {
        let execution_iri = urn(
            "step-execution",
            &format!("{}:{}", source.input_digest, execution.step_id),
        );
        quads.push(quad(
            &execution_iri,
            &iri(RDF_TYPE),
            &iri(PROV_ACTIVITY),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PPLAN_CORRESPONDS_TO_STEP),
            &urn("step", &execution.step_id),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("unit"),
            &urn("node", &execution.unit_id),
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
            &predicate("inputKey"),
            &literal(&execution.input_key),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &predicate("outputDigest"),
            &literal(&execution.output_digest),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_STARTED),
            &date_time_literal(&source.execution_timestamp),
            EXECUTION_GRAPH,
        ));
        quads.push(quad(
            &execution_iri,
            &iri(PROV_ENDED),
            &date_time_literal(&source.execution_timestamp),
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

include!(concat!(env!("OUT_DIR"), "/registered_queries.rs"));

fn store_from_nquads(index: &[u8]) -> Result<Store, String> {
    let store = Store::new().map_err(|error| error.to_string())?;
    let quads = NQuadsParser::new()
        .for_slice(index)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("parse derived N-Quads: {error}"))?;
    store
        .extend(quads)
        .map_err(|error| format!("index derived N-Quads: {error}"))?;
    Ok(store)
}

fn query(index: &[u8], query_id: &str) -> Result<Value, String> {
    let query = registered_query(query_id)
        .ok_or_else(|| format!("unregistered production query: {query_id}"))?;
    let store = store_from_nquads(index)?;
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
    if source.protocol_version != "chronicle-semantic-index-source/v2" {
        return Err("unsupported semantic index source".into());
    }
    if !source.execution_ledger.is_array() {
        return Err("semantic index source ledger is invalid".into());
    }
    if source.step_executions.len() != 55
        || source.pipeline_step_digests.len() != 55
        || source.pipeline_step_checkpoints.len() != 55
    {
        return Err("semantic index source must contain exactly 55 Rust steps".into());
    }
    let mut execution_ids = std::collections::BTreeSet::new();
    for execution in &source.step_executions {
        if !execution_ids.insert(execution.step_id.as_str())
            || !matches!(
                execution.status.as_str(),
                "cached" | "recomputed" | "error" | "skipped" | "bypassed"
            )
            || !is_sha256(&execution.input_key)
            || !is_sha256(&execution.output_digest)
            || !is_sha256(&execution.reason_id)
            || source.pipeline_step_digests.get(&execution.step_id)
                != Some(&execution.output_digest)
        {
            return Err("semantic index step execution is invalid".into());
        }
    }
    if execution_ids
        != source
            .pipeline_step_digests
            .keys()
            .map(String::as_str)
            .collect()
    {
        return Err("semantic index step execution and digest domains disagree".into());
    }
    for (step_id, checkpoint) in &source.pipeline_step_checkpoints {
        let component_digests = [
            &checkpoint.row_membership_digest,
            &checkpoint.row_order_digest,
            &checkpoint.temporal_state_digest,
            &checkpoint.classification_digest,
            &checkpoint.payload_digest,
            &checkpoint.schema_digest,
        ];
        if checkpoint.protocol_version != "chronicle-logical-stage-checkpoint/v7"
            || checkpoint.node_id != *step_id
            || source.pipeline_step_digests.get(step_id) != Some(&checkpoint.terminal_digest)
            || component_digests
                .into_iter()
                .any(|digest| !is_checkpoint_component_digest(digest))
        {
            return Err(format!(
                "semantic index step checkpoint is invalid for {step_id}: protocol={} node={} terminal={} expected={:?}",
                checkpoint.protocol_version,
                checkpoint.node_id,
                checkpoint.terminal_digest,
                source.pipeline_step_digests.get(step_id),
            ));
        }
    }
    if let Some(decision) = &source.dependency_cache_decision {
        if !matches!(
            decision.mode.as_str(),
            "certified_narrow" | "conservative_full"
        ) || (decision.mode == "certified_narrow"
            && (decision.certificate_digest.is_none() || decision.binding_surface_digest.is_none()))
        {
            return Err("semantic index dependency cache decision is invalid".into());
        }
    }
    let index = build_index(&source);
    store_from_nquads(&index)?;
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
        let digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let component_digest = "xxh3:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let step_executions = (0..55)
            .map(|index| {
                json!({
                    "step_id": format!("step-{index:02}"),
                    "unit_id": "parse_events",
                    "status": "recomputed",
                    "input_key": digest,
                    "output_digest": digest,
                    "reason_id": digest,
                })
            })
            .collect::<Vec<_>>();
        let pipeline_step_digests = (0..55)
            .map(|index| (format!("step-{index:02}"), digest))
            .collect::<BTreeMap<_, _>>();
        let pipeline_step_checkpoints = (0..55)
            .map(|index| {
                let step_id = format!("step-{index:02}");
                (
                    step_id.clone(),
                    json!({
                        "protocolVersion": "chronicle-logical-stage-checkpoint/v7",
                        "nodeId": step_id,
                        "rowMembershipDigest": component_digest,
                        "rowOrderDigest": component_digest,
                        "temporalStateDigest": component_digest,
                        "classificationDigest": component_digest,
                        "payloadDigest": component_digest,
                        "schemaDigest": component_digest,
                        "terminalDigest": digest,
                    }),
                )
            })
            .collect::<BTreeMap<_, _>>();
        json!({
            "protocolVersion": "chronicle-semantic-index-source/v2",
            "inputDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "executionTimestamp": "2026-07-21 12:00:00 UTC",
            "roleAssignments": [{
                "assignment_id": "assignment with spaces",
                "role_id": "raw role",
                "artifact": { "artifact_id": "urn:artifact:1", "digest": "sha256:aaaa" }
            }],
            "qualificationTraces": [{
                "trace_id": "urn:qualification-trace:1",
                "candidate_id": "assignment with spaces",
                "candidate_revision": 3,
                "artifact_digest": "sha256:aaaa",
                "qualifiers_digest": "sha256:bbbb",
                "asserted_role_ids": ["raw role"],
                "selected_role_id": "raw role",
                "decision": "accepted",
                "rule_evaluations": [{
                    "rule_id": "chronicle.binding.media-type.v1",
                    "passed": true,
                    "expected": "text/csv",
                    "observed": "text/csv"
                }],
                "reason_id": "urn:reason:qualified"
            }],
            "requirementTraces": [{
                "trace_id": "urn:requirement-trace:1",
                "role_id": "raw role",
                "required": true,
                "unconditional": true,
                "condition_id": null,
                "condition_result": null,
                "candidate_trace_ids": ["urn:qualification-trace:1"],
                "accepted_assignment_ids": ["assignment with spaces"],
                "state": "satisfied",
                "reason_id": "urn:reason:requirement-satisfied"
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
            "stepExecutions": step_executions,
            "pipelineStepDigests": pipeline_step_digests,
            "pipelineStepCheckpoints": pipeline_step_checkpoints,
            "dependencyCacheDecision": {
                "mode": "certified_narrow",
                "certificate_digest": "sha256:cccc",
                "binding_surface_digest": "sha256:dddd",
                "empirical_evidence_current": true,
                "reasons": ["dependency_surface_structurally_certified"]
            },
            "executionLedger": []
        })
    }

    #[test]
    fn index_rebuild_is_deterministic_and_registered_queries_are_bounded() {
        let registry: Value = serde_json::from_str(REGISTERED_QUERY_RESOURCE_JSON).unwrap();
        for declared in registry["queries"].as_array().unwrap() {
            assert_eq!(
                registered_query(declared["query_id"].as_str().unwrap()),
                declared["sparql"].as_str(),
            );
        }
        let source = complete_source();
        let parsed: IndexSource = serde_json::from_value(source).unwrap();
        let first = build_index(&parsed);
        assert_eq!(first, build_index(&parsed));
        for (query_id, expected_rows) in [
            ("role-assignments", 1),
            ("qualification-traces", 1),
            ("requirement-traces", 1),
            ("open-obligations", 2),
            ("actual-executions", 1),
            ("reason-trace", 1),
        ] {
            let result = query(&first, query_id).unwrap();
            assert_eq!(result["rows"].as_array().unwrap().len(), expected_rows);
        }
        assert_eq!(
            query(&first, "has-open-obligations").unwrap()["boolean"],
            true
        );
        assert!(String::from_utf8(first.clone())
            .unwrap()
            .contains("assignment_with_spaces"));
        let nquads = String::from_utf8(first.clone()).unwrap();
        assert!(nquads.contains("http://purl.org/net/p-plan#correspondsToStep"));
        assert!(nquads.contains("http://www.w3.org/ns/prov#used"));
        assert!(nquads.contains("http://www.w3.org/2001/XMLSchema#dateTime"));
        assert!(nquads.contains("2026-07-21T12:00:00Z"));
        assert!(nquads.contains("chronicle.binding.media-type.v1"));
        assert!(nquads.contains("qualifiersDigest"));
        assert!(nquads.contains("certified_narrow"));
        assert!(nquads.contains("empiricalEvidenceCurrent"));
        assert!(query(&first, "DROP ALL")
            .unwrap_err()
            .contains("unregistered"));
        assert!(query(b"not n-quads", "role-assignments")
            .unwrap_err()
            .contains("parse derived N-Quads"));
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
        let mut invalid_cache = complete_source();
        invalid_cache["dependencyCacheDecision"]["mode"] = Value::String("unsafe".into());
        assert_eq!(
            rebuild_semantic_index_native(&serde_json::to_vec(&invalid_cache).unwrap())
                .unwrap_err(),
            "semantic index dependency cache decision is invalid"
        );
        let mut already_normalized_time = complete_source();
        already_normalized_time["executionTimestamp"] =
            Value::String("2026-07-21T12:00:00Z".into());
        let normalized_index =
            rebuild_semantic_index_native(&serde_json::to_vec(&already_normalized_time).unwrap())
                .unwrap();
        assert!(String::from_utf8(normalized_index)
            .unwrap()
            .contains("2026-07-21T12:00:00Z"));
        assert!(query_registered_native(&native, "arbitrary-query").is_err());
    }

    #[test]
    fn missing_step_execution_surface_fails_closed() {
        for field in [
            "stepExecutions",
            "pipelineStepDigests",
            "pipelineStepCheckpoints",
        ] {
            let mut incomplete = complete_source();
            incomplete[field] = if field == "stepExecutions" {
                json!([])
            } else {
                json!({})
            };
            assert_eq!(
                rebuild_semantic_index_native(&serde_json::to_vec(&incomplete).unwrap())
                    .unwrap_err(),
                "semantic index source must contain exactly 55 Rust steps",
                "missing {field} must fail independently",
            );
        }
    }

    #[test]
    fn digest_and_nquads_boundaries_are_exact() {
        let sha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let xxh3 = "xxh3:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assert!(is_sha256(sha));
        assert!(!is_sha256(&sha[1..]));
        assert!(!is_sha256(&format!("xxh3:{}", "a".repeat(32))));
        assert!(!is_sha256(&format!("sha256:{}g", "a".repeat(63))));
        assert!(is_checkpoint_component_digest(xxh3));
        assert!(!is_checkpoint_component_digest(&xxh3[1..]));
        assert!(!is_checkpoint_component_digest(&format!("sha256:{}", "b".repeat(64))));
        assert!(!is_checkpoint_component_digest(&format!("xxh3:{}g", "b".repeat(31))));

        let parsed: IndexSource = serde_json::from_value(complete_source()).unwrap();
        let index = build_index(&parsed);
        assert!(!index.is_empty());
        assert_eq!(index.last(), Some(&b'\n'));
    }

    #[test]
    fn each_step_execution_constraint_fails_independently() {
        let expected = "semantic index step execution is invalid";
        let cases = [
            ("status", "unknown"),
            ("input_key", "sha256:short"),
            (
                "output_digest",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            ("reason_id", "sha256:short"),
        ];
        for (field, value) in cases {
            let mut source = complete_source();
            source["stepExecutions"][0][field] = Value::String(value.into());
            assert_eq!(
                rebuild_semantic_index_native(&serde_json::to_vec(&source).unwrap()).unwrap_err(),
                expected,
                "invalid {field} must fail independently",
            );
        }

        let mut duplicate = complete_source();
        duplicate["stepExecutions"][1]["step_id"] = Value::String("step-00".into());
        assert_eq!(
            rebuild_semantic_index_native(&serde_json::to_vec(&duplicate).unwrap()).unwrap_err(),
            expected,
        );
    }

    #[test]
    fn each_step_checkpoint_and_cache_constraint_fails_independently() {
        let checkpoint_error = "semantic index step checkpoint is invalid for step-00";
        for (field, value) in [
            ("protocolVersion", "future"),
            ("nodeId", "other-step"),
            (
                "terminalDigest",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            ("rowMembershipDigest", "xxh3:short"),
        ] {
            let mut source = complete_source();
            source["pipelineStepCheckpoints"]["step-00"][field] = Value::String(value.into());
            assert!(
                rebuild_semantic_index_native(&serde_json::to_vec(&source).unwrap())
                    .unwrap_err()
                    .starts_with(checkpoint_error),
                "invalid {field} must fail independently",
            );
        }

        let mut conservative = complete_source();
        conservative["dependencyCacheDecision"] = json!({
            "mode": "conservative_full",
            "certificate_digest": null,
            "binding_surface_digest": null,
            "empirical_evidence_current": false,
            "reasons": ["certificate_mismatch"]
        });
        assert!(rebuild_semantic_index_native(&serde_json::to_vec(&conservative).unwrap()).is_ok());

        for missing in ["certificate_digest", "binding_surface_digest"] {
            let mut invalid = complete_source();
            invalid["dependencyCacheDecision"][missing] = Value::Null;
            assert_eq!(
                rebuild_semantic_index_native(&serde_json::to_vec(&invalid).unwrap()).unwrap_err(),
                "semantic index dependency cache decision is invalid",
                "certified narrowing requires {missing}",
            );
        }
    }
}
