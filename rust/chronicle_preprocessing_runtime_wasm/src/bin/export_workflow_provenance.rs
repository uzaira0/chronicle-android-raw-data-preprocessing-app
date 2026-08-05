use chronicle_preprocessing_runtime_wasm::{
    workflow_provenance::build_workflow_provenance_jsonld, RuntimeQueryExecution,
};
use chronicle_preprocessing_semantic_adapter::ExecutionStatus;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::{self, Write};

fn fixture_bytes() -> Result<Vec<u8>, String> {
    let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let executions = contract
        .execution
        .queries
        .iter()
        .map(|query| RuntimeQueryExecution {
            query_id: query.id.into(),
            query_group_id: query.group.into(),
            status: ExecutionStatus::Recomputed,
            input_key: format!("sha256:{}", "1".repeat(64)),
            output_digest: format!("sha256:{}", "2".repeat(64)),
            reason_id: format!("sha256:{}", "3".repeat(64)),
        })
        .collect::<Vec<_>>();
    if executions.is_empty() {
        return Err("workflow contract has no query for the provenance fixture".into());
    }
    let parameter_set = json!({
        "fixture": "schema-conformance",
        "process_app_usage": true,
    });
    let parameter_bytes = serde_jcs::to_vec(&parameter_set)
        .map_err(|error| format!("canonicalize fixture parameter set: {error}"))?;
    let parameter_digest = format!("sha256:{}", hex::encode(Sha256::digest(&parameter_bytes)));
    build_workflow_provenance_jsonld(
        "schema-conformance-run",
        &format!("sha256:{}", "b".repeat(64)),
        &parameter_digest,
        &parameter_set,
        "2026-08-03T00:00:00Z",
        &executions,
    )
}

fn main() -> Result<(), String> {
    let bytes = fixture_bytes()?;
    io::stdout()
        .write_all(&bytes)
        .map_err(|error| format!("write workflow provenance fixture: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::fixture_bytes;

    #[test]
    fn fixture_is_nonempty_valid_jsonld() {
        let bytes = fixture_bytes().expect("build workflow provenance fixture");
        let document: serde_json::Value =
            serde_json::from_slice(&bytes).expect("parse workflow provenance fixture");

        assert!(document.is_object());
        assert!(document
            .get("@graph")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|graph| !graph.is_empty()));
    }
}
