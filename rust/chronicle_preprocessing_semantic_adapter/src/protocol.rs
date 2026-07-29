use crate::model::{ArtifactRef, NodeExecution, OpenObligation};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WORKER_PROTOCOL_VERSION: &str = "0.1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRequest {
    pub protocol_version: String,
    pub request_id: String,
    pub workspace_root_digest: Option<String>,
    pub command: WorkerCommand,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "PascalCase")]
pub enum WorkerCommand {
    OpenWorkspace {
        root_digest: Option<String>,
    },
    VerifyWorkspace,
    Ingest {
        role_id: String,
        artifact: ArtifactRef,
    },
    EvaluateRequirements,
    ExecuteCone {
        requested_nodes: Vec<String>,
    },
    GetView {
        view_id: String,
        filters: Value,
    },
    GetExplanation {
        subject_id: String,
    },
    QueryRegistered {
        query_id: String,
        parameters: Value,
    },
    ExportClosure,
    RebuildIndex,
    GarbageCollect {
        retained_roots: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResponse {
    pub protocol_version: String,
    pub request_id: String,
    pub workspace_root_digest: Option<String>,
    pub result: WorkerResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "PascalCase")]
pub enum WorkerResult {
    WorkspaceOpened { root_digest: String },
    WorkspaceVerified { valid: bool, reasons: Vec<String> },
    Ingested { artifact: ArtifactRef },
    Requirements { obligations: Vec<OpenObligation> },
    Executed { executions: Vec<NodeExecution> },
    View { value: Value },
    Explanation { value: Value },
    QueryResult { value: Value },
    Closure { value: Value },
    IndexRebuilt { triple_count: u64 },
    GarbageCollected { removed_digests: Vec<String> },
    Error { code: String, message: String },
}

impl WorkerRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.protocol_version != WORKER_PROTOCOL_VERSION {
            return Err("unsupported protocol version");
        }
        if self.request_id.trim().is_empty() {
            return Err("request id is required");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_command_fails_deserialization_closed() {
        let json = serde_json::json!({
            "protocolVersion": "0.1",
            "requestId": "req-1",
            "workspaceRootDigest": null,
            "command": {"type": "ExecuteArbitraryCode", "payload": {}}
        });
        assert!(serde_json::from_value::<WorkerRequest>(json).is_err());
    }

    #[test]
    fn protocol_version_and_request_identity_are_required() {
        let request = WorkerRequest {
            protocol_version: "future".into(),
            request_id: String::new(),
            workspace_root_digest: None,
            command: WorkerCommand::VerifyWorkspace,
        };
        assert_eq!(request.validate(), Err("unsupported protocol version"));
        let request = WorkerRequest {
            protocol_version: WORKER_PROTOCOL_VERSION.into(),
            request_id: "   ".into(),
            workspace_root_digest: None,
            command: WorkerCommand::VerifyWorkspace,
        };
        assert_eq!(request.validate(), Err("request id is required"));
        let request = WorkerRequest {
            request_id: "req-1".into(),
            ..request
        };
        assert_eq!(request.validate(), Ok(()));
    }
}
