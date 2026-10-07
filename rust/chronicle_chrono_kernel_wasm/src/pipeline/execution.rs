use super::Arc;
#[cfg(feature = "incremental-v2")]
use super::{BTreeMap, PipelineRowLineage, PipelineV2Result};
#[cfg(feature = "incremental-v2")]
use super::payload::query_payload;

/// Raw CSV bytes offered to the tracked inputs. Borrowed bytes are copied
/// into the Salsa input only when they differ from the live input; shared
/// bytes are adopted as they are, so a runtime that already owns the file as
/// an `Arc` and the input hold one allocation between them.
#[derive(Clone, Copy)]
pub enum RawCsvBytes<'a> {
    Borrowed(&'a [u8]),
    Shared(&'a Arc<Vec<u8>>),
}

impl RawCsvBytes<'_> {
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Self::Borrowed(bytes) => bytes,
            Self::Shared(bytes) => bytes.as_slice(),
        }
    }

    pub(crate) fn to_shared(self) -> Arc<Vec<u8>> {
        match self {
            Self::Borrowed(bytes) => Arc::new(bytes.to_vec()),
            Self::Shared(bytes) => Arc::clone(bytes),
        }
    }
}

#[cfg(feature = "incremental-v2")]
pub struct IncrementalPipelineV2Execution {
    pub result: Arc<PipelineV2Result>,
    pub output_payloads: BTreeMap<String, crate::payload_store::PayloadBytes>,
    pub lineage_payload: crate::payload_store::PayloadHandle<Vec<PipelineRowLineage>>,
    pub executed_queries: Vec<String>,
    /// Derived cache queries that are not product steps. Exposed separately so
    /// performance tests can prove expensive terminal work stayed cached
    /// without pretending physical queries are additional semantic transformations.
    pub internal_executed_queries: Vec<String>,
}

#[cfg(feature = "incremental-v2")]
impl IncrementalPipelineV2Execution {
    /// Wrap a run of the sequential scheduler in the shape the runtime
    /// consumes. Every registry query executed, so every query reports as
    /// recomputed; nothing was memoized, so no internal cache query ran.
    pub fn from_sequential(
        store: &crate::payload_store::PayloadStore, result: PipelineV2Result) -> Self {
        let output_payloads = result.output_payloads();
        let lineage_payload = query_payload(store, Arc::clone(&result.row_lineage));
        Self {
            result: Arc::new(result),
            output_payloads,
            lineage_payload,
            executed_queries: crate::workflow_contract::WORKFLOW_QUERIES
                .iter()
                .map(|step| step.id.to_string())
                .collect(),
            internal_executed_queries: Vec::new(),
        }
    }
}
