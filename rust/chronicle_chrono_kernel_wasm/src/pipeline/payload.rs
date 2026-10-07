use super::{AttributedRows, WindowedRows, ResolvedParticipantWindow, StudyWindow, SharingResolutionValue, SurveyLookup, BTreeSet, apply_study_window, attribute_person};
use super::attribution::disabled_window_participants;
#[cfg(feature = "incremental-v2")]
use super::{B05SchoedelPreflightResult, BTreeMap, PayloadBytes, PipelineV2Options, PipelineV2Result, ScreenSessionConstructionStrategyId, write_app_csv_to, write_screen_csv_with_b05_to};
#[cfg(feature = "incremental-v2")]
use super::aggregates;
use super::{
    Arc,
    CreditPartition,
    CreditResult,
    EpisodeCloseReason,
    LineageSearchEvidence,
    MatcherInput,
    MatcherOutput,
    PipelineRowLineage,
    RawRow,
    Row,
    RowInner,
    SourceDataRowRange,
    decode_matcher_payload,
    encode_matcher_payload,
};
use crate::payload_store::PayloadHandle;
#[cfg(feature = "incremental-v2")]
use super::incremental::tracked;

/// Nominal deep size of a row table when it is the only holder of its rows:
/// the records plus source-row ranges and lineage searches. The store uses
/// `row_table_footprint` to discount identical immutable allocations across
/// resident tables while preserving this conservative nominal size for
/// per-type diagnostics. Interned strings are shared by nearly every row
/// and are not charged.
pub(crate) fn row_table_bytes(rows: &[Row]) -> u64 {
    fn owned<T: ?Sized>(arc: &Arc<T>, heap: usize) -> usize {
        std::mem::size_of_val(&**arc) + heap
    }
    rows.iter()
        .map(|row| {
            let data = &row.0.data;
            let sources = &data.source_data_rows.0;
            let sources_heap = if sources.spilled() {
                sources.capacity() * std::mem::size_of::<SourceDataRowRange>()
            } else {
                0
            };
            let searches = &data.lineage_searches;
            let searches_heap = if searches.spilled() {
                searches.capacity() * std::mem::size_of::<LineageSearchEvidence>()
            } else {
                0
            };
            std::mem::size_of::<Row>()
                + owned(&row.0, 0)
                + owned(sources, sources_heap)
                + owned(searches, searches_heap)
        })
        .sum::<usize>() as u64
}

/// The allocations a resident row table actually owns. Adjacent tracked
/// tables often share most immutable `RowInner` allocations. The payload
/// store accounts each such allocation once across resident tables while
/// charging each table's own vector and accounting metadata in full.
pub(crate) struct RowTableFootprint {
    pub(crate) table_bytes: u64,
    pub(crate) rows: Vec<(usize, u64)>,
}

pub(crate) fn row_table_footprint(rows: &Vec<Row>) -> RowTableFootprint {
    let mut allocations = Vec::with_capacity(rows.len());
    for row in rows {
        let data = &row.0.data;
        let sources = &data.source_data_rows.0;
        let searches = &data.lineage_searches;
        let sources_heap = if sources.spilled() {
            sources.capacity() * std::mem::size_of::<SourceDataRowRange>()
        } else {
            0
        };
        let searches_heap = if searches.spilled() {
            searches.capacity() * std::mem::size_of::<LineageSearchEvidence>()
        } else {
            0
        };
        let deep_bytes = std::mem::size_of_val(&*row.0)
            + std::mem::size_of_val(&**sources)
            + sources_heap
            + std::mem::size_of_val(&**searches)
            + searches_heap;
        allocations.push((Arc::as_ptr(&row.0) as usize, deep_bytes as u64));
    }
    RowTableFootprint {
        table_bytes: (rows.capacity() * std::mem::size_of::<Row>()
            + allocations.capacity() * std::mem::size_of::<(usize, u64)>()) as u64,
        rows: allocations,
    }
}

/// Heap bytes the owned field strings of a raw table hold. `RawRow`'s eight
/// fields are independent `String` allocations built by
/// `decode_source_records`, not interned strings shared with other tables, so
/// charging the records alone hid roughly a third of the table from the
/// budget — the same undercharge `row_table_bytes` documents for `Vec<Row>`.
pub(crate) fn raw_row_string_bytes(rows: &[RawRow]) -> usize {
    rows.iter().map(|row| row.owned_string_bytes()).sum()
}

/// Heap bytes the matcher memo's two per-episode evidence surfaces hold. Both
/// are owned by the memo and both are O(episodes): under the Schoedel and EYES
/// arms every index vector is empty and these surfaces are the bulk of the
/// value, so leaving them out of the charge let the store treat an episode
/// census as near-free. Their records own strings and index vectors, charged
/// here for the same reason `row_table_bytes` documents.
pub(crate) fn matcher_evidence_bytes(output: &MatcherOutput) -> usize {
    let schoedel = output
        .schoedel_reconstruction
        .as_ref()
        .map_or(0, |reconstruction| reconstruction.heap_bytes());
    let eyes = output.eyes_tagged_fau_evidence.capacity()
        * std::mem::size_of::<crate::eyes_complement::EyesParticipantTaggedFauEvidence>()
        + output
            .eyes_tagged_fau_evidence
            .iter()
            .map(|participant| participant.heap_bytes())
            .sum::<usize>();
    schoedel + eyes
}

/// Charge a memo value to the payload store by its row footprint; values
/// the store cannot budget stay resident.
#[track_caller]
pub(crate) fn query_payload<T: Send + Sync + 'static>(
    store: &crate::payload_store::PayloadStore, value: Arc<T>) -> PayloadHandle<T> {
    let erased: Arc<dyn std::any::Any + Send + Sync> = value.clone();
    if let Ok(rows) = erased.clone().downcast::<Vec<Row>>() {
        let count = rows.len();
        let bytes = row_table_bytes(&rows);
        drop(value);
        drop(erased);
        return store
            .publish(rows, bytes)
            .with_len(count)
            .cast();
    }
    // The credit memos carry their row tables inside a record; budget the
    // record by those tables so the memo cannot pin them for the life of
    // the engine.
    if let Ok(partition) = erased.clone().downcast::<CreditPartition>() {
        let bytes = row_table_bytes(&partition.sessions) + row_table_bytes(&partition.rest);
        drop(value);
        drop(erased);
        return store.publish(partition, bytes).cast();
    }
    #[cfg(feature = "incremental-v2")]
    if let Ok(step) = erased.clone().downcast::<tracked::CreditEmissionStep>() {
        let bytes = row_table_bytes(&step.emission.credited);
        drop(value);
        drop(erased);
        return store.publish(step, bytes).cast();
    }
    if let Ok(result) = erased.clone().downcast::<CreditResult>() {
        let bytes = row_table_bytes(&result.rows);
        drop(value);
        drop(erased);
        return store.publish(result, bytes).cast();
    }
    if let Ok(rows) = erased.clone().downcast::<Vec<RawRow>>() {
        let count = rows.len();
        let bytes =
            rows.capacity() * std::mem::size_of::<RawRow>() + raw_row_string_bytes(&rows);
        drop(value);
        drop(erased);
        return store
            .publish(rows, bytes as u64)
            .with_len(count)
            .cast();
    }
    if let Ok(lineage) = erased.clone().downcast::<Vec<PipelineRowLineage>>() {
        let count = lineage.len();
        let bytes = lineage.capacity() * std::mem::size_of::<PipelineRowLineage>()
            + lineage
                .iter()
                .map(|row| {
                    row.source_data_row_ranges.capacity()
                        * std::mem::size_of::<SourceDataRowRange>()
                        + row.searches.capacity() * std::mem::size_of::<LineageSearchEvidence>()
                        // The screen box and its five owned option strings
                        // are per-row heap, not the interned `Arc<String>` of
                        // `output_kind` / `terminal_query_group`, and the
                        // stored mirror serializes them, so they belong in
                        // the charge.
                        + row.owned_heap_bytes()
                })
                .sum::<usize>();
        drop(value);
        drop(erased);
        // Postcard through the stored mirror, not the lineage's own serde
        // shape: its `skip_serializing_if` fields are absent from a
        // non-self-describing encoding, and JSON text for a 580k-row table
        // was the tallest allocation of the whole run when it reloaded.
        return store
            .publish_with_codec(
                lineage,
                bytes as u64,
                |lineage| super::encode_row_lineage_payload(lineage),
                super::decode_row_lineage_payload,
            )
            .with_len(count)
            .cast();
    }
    if let Ok(input) = erased.clone().downcast::<MatcherInput>() {
        let bytes = std::mem::size_of::<MatcherInput>()
            + input.app_codes.capacity() * std::mem::size_of::<i32>()
            + input.timestamps.capacity() * std::mem::size_of::<i64>()
            + input.resumed.capacity()
            + input.same_stop.capacity()
            + input.other_stop.capacity()
            + input.stopped.capacity()
            + input.background.capacity();
        drop(value);
        drop(erased);
        return store.publish(input, bytes as u64).cast();
    }

    if let Ok(output) = erased.clone().downcast::<MatcherOutput>() {
        let bytes = (output.start_indices.capacity()
            + output.stop_start_indices.capacity()
            + output.stop_event_indices.capacity()
            + output.missing_indices.capacity()
            + output.selected_nonresume_closed_indices.capacity()) * std::mem::size_of::<usize>()
            + (output.stop_reasons.capacity() + output.missing_reasons.capacity())
                * std::mem::size_of::<EpisodeCloseReason>()
            + (output.stop_timestamps_ns.capacity() + output.start_timestamps_ns.capacity())
                * std::mem::size_of::<Option<i64>>()
            + output.schoedel_candidate_rows.as_ref().map_or(0, |rows| {
                rows.len() * (std::mem::size_of::<Row>() + std::mem::size_of::<RowInner>())
            })
            + matcher_evidence_bytes(&output)
            + std::mem::size_of::<MatcherOutput>();
        drop(value);
        drop(erased);
        return store.publish_with_codec(
            output,
            bytes as u64,
            encode_matcher_payload,
            decode_matcher_payload,
        ).cast();
    }

    // Review memos carry their rows as handles, so the wrapper itself
    // stays resident and only the row table is budgeted.
    PayloadHandle::resident(value)
}

#[cfg(feature = "incremental-v2")]
mod output {
    use super::{Arc, B05SchoedelPreflightResult, PayloadBytes, PipelineRowLineage, PipelineV2Options, PipelineV2Result, Row, ScreenSessionConstructionStrategyId, aggregates, write_app_csv_to, write_screen_csv_with_b05_to};
    use crate::payload_store::{PayloadHandle, PayloadByteWriter};

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct AssembledOutputs {
        pub(crate) app_csv_bytes: PayloadBytes,
        pub(crate) screen_csv_bytes: PayloadBytes,
        pub(crate) day_coverage_csv_bytes: PayloadBytes,
        pub(crate) compliance_csv_bytes: PayloadBytes,
        pub(crate) credited_app_csv_bytes: PayloadBytes,
        pub(crate) notification_contact_csv_bytes: PayloadBytes,
        pub(crate) polled_emulation_csv_bytes: PayloadBytes,
        pub(crate) interval_expansion_csv_bytes: PayloadBytes,
        pub(crate) interval_expansion_row_count: u32,
        pub(crate) review_summary_json_bytes: PayloadBytes,
        pub(crate) visualization_data_json_bytes: PayloadBytes,
        pub(crate) aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput<PayloadBytes>>>,
        pub(crate) row_lineage: PayloadHandle<Vec<PipelineRowLineage>>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct PrimaryOutputs {
        pub(crate) app_csv_bytes: PayloadBytes,
        pub(crate) screen_csv_bytes: PayloadBytes,
        pub(crate) credited_app_csv_bytes: PayloadBytes,
        pub(crate) notification_contact_csv_bytes: PayloadBytes,
        pub(crate) polled_emulation_csv_bytes: PayloadBytes,
        pub(crate) interval_expansion_csv_bytes: PayloadBytes,
        pub(crate) interval_expansion_row_count: u32,
        pub(crate) review_summary_json_bytes: PayloadBytes,
        pub(crate) visualization_data_json_bytes: PayloadBytes,
        pub(crate) aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput<PayloadBytes>>>,
        pub(crate) row_lineage: PayloadHandle<Vec<PipelineRowLineage>>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct StoredPipelineResult {
        pub(crate) metadata: PipelineV2Result,
        pub(crate) outputs: AssembledOutputs,
    }

    impl std::ops::Deref for StoredPipelineResult {
        type Target = AssembledOutputs;
        fn deref(&self) -> &Self::Target { &self.outputs }
    }

    impl StoredPipelineResult {
        /// Handles only: the runtime's result shares the memo's payload
        /// chunks, so no output exists twice. The lineage stays leased for
        /// the life of the result because the runtime borrows it as a slice.
        pub(crate) fn materialize(&self) -> Result<Arc<PipelineV2Result>, String> {
            let mut result = self.metadata.clone();
            result.app_csv_bytes = self.outputs.app_csv_bytes.clone();
            result.screen_csv_bytes = self.outputs.screen_csv_bytes.clone();
            result.day_coverage_csv_bytes = self.outputs.day_coverage_csv_bytes.clone();
            result.compliance_csv_bytes = self.outputs.compliance_csv_bytes.clone();
            result.credited_app_csv_bytes = self.outputs.credited_app_csv_bytes.clone();
            result.notification_contact_csv_bytes = self.outputs.notification_contact_csv_bytes.clone();
            result.polled_emulation_csv_bytes = self.outputs.polled_emulation_csv_bytes.clone();
            result.interval_expansion_csv_bytes = self.outputs.interval_expansion_csv_bytes.clone();
            result.interval_expansion_row_count = self.outputs.interval_expansion_row_count;
            result.review_summary_json_bytes = self.outputs.review_summary_json_bytes.clone();
            result.visualization_data_json_bytes = self.outputs.visualization_data_json_bytes.clone();
            result.aggregate_csv_outputs = Arc::clone(&self.outputs.aggregate_csv_outputs);
            result.row_lineage = self.outputs.row_lineage.lease()?.shared();
            Ok(Arc::new(result))
        }
    }

    pub(crate) fn app_csv_payload<'a>(store: &crate::payload_store::PayloadStore, rows: impl Iterator<Item = &'a Row>, options: &PipelineV2Options, aliases: bool) -> Result<PayloadBytes, String> {
        let mut writer = PayloadByteWriter::with_store(store.clone());
        write_app_csv_to(rows, options, aliases, &mut writer)?;
        Ok(writer.finish())
    }

    pub(crate) fn screen_csv_payload(store: &crate::payload_store::PayloadStore, rows: &[Row], options: &PipelineV2Options, preflight: &B05SchoedelPreflightResult) -> Result<PayloadBytes, String> {
        let intervals = if options.screen_session_construction_strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
            None
        } else {
            let intervals = &preflight.screen_construction.as_ref()
                .ok_or_else(|| "b05_output_error:screen_construction_absent".to_string())?.intervals;
            Some(intervals.as_slice())
        };
        let mut writer = PayloadByteWriter::with_store(store.clone());
        write_screen_csv_with_b05_to(rows, options, intervals, &mut writer)?;
        Ok(writer.finish())
    }

    pub(crate) fn json_payload(store: &crate::payload_store::PayloadStore, value: &impl serde::Serialize) -> Result<PayloadBytes, String> {
        let mut writer = PayloadByteWriter::with_store(store.clone());
        serde_json::to_writer(&mut writer, value).map_err(|error| error.to_string())?;
        Ok(writer.finish())
    }
}
#[cfg(feature = "incremental-v2")]
pub(super) use output::*;

#[cfg(feature = "incremental-v2")]
impl PipelineV2Result {
    pub(crate) fn output_payloads(&self) -> BTreeMap<String, PayloadBytes> {
        let mut outputs = BTreeMap::from([
            ("app-csv".to_string(), self.app_csv_bytes.clone()),
            ("screen-csv".to_string(), self.screen_csv_bytes.clone()),
            ("day-coverage-csv".to_string(), self.day_coverage_csv_bytes.clone()),
            ("compliance-csv".to_string(), self.compliance_csv_bytes.clone()),
            ("credited-app-csv".to_string(), self.credited_app_csv_bytes.clone()),
            ("notification-contact-csv".to_string(), self.notification_contact_csv_bytes.clone()),
            ("polled-emulation-csv".to_string(), self.polled_emulation_csv_bytes.clone()),
            ("interval-expansion-csv".to_string(), self.interval_expansion_csv_bytes.clone()),
            ("review-summary-json".to_string(), self.review_summary_json_bytes.clone()),
            ("visualization-data-json".to_string(), self.visualization_data_json_bytes.clone()),
        ]);
        outputs.extend(
            self
                .aggregate_csv_outputs
                .iter()
                .map(|output| (output.kind.clone(), output.bytes.clone())),
        );
        outputs
    }
}

#[cfg(feature = "incremental-v2")]
pub(crate) fn payload_bytes(store: &crate::payload_store::PayloadStore, bytes: Vec<u8>) -> super::PayloadBytes {
    super::PayloadBytes::from_vec_with_store(bytes, store)
}




pub(crate) fn filter_to_window(
    store: &crate::payload_store::PayloadStore,
    rows: &PayloadHandle<Vec<Row>>,
    resolved: &[ResolvedParticipantWindow],
    enabled: bool,
    windows: &[StudyWindow],
) -> Result<WindowedRows, String> {
    if enabled {
        if windows.is_empty() {
            return Err(
                "Study dates file is required when study-window filtering is enabled".into(),
            );
        }
        let (rows, dropped_rows, participants_without_window) =
            apply_study_window((*rows.lease()?).clone(), resolved);
        Ok(WindowedRows {
            rows: query_payload(store, Arc::new(rows)),
            dropped_rows,
            participants_without_window,
            applied: true,
        })
    } else {
        let participants_without_window = disabled_window_participants(resolved);
        Ok(WindowedRows {
            rows: rows.clone(),
            dropped_rows: 0,
            participants_without_window,
            applied: false,
        })
    }
}



pub(crate) fn classify_person_attribution(
    store: &crate::payload_store::PayloadStore,
    rows: &PayloadHandle<Vec<Row>>,
    resolution: &SharingResolutionValue,
    survey: &SurveyLookup,
) -> Result<AttributedRows, String> {
    match resolution {
        SharingResolutionValue::Disabled => Ok(AttributedRows {
            rows: rows.clone(),
            report: None,
            shared_participants: BTreeSet::new(),
        }),
        SharingResolutionValue::Enabled(resolution) => {
            let shared_participants = resolution
                .shared_participants
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>();
            let (rows, report) = attribute_person((*rows.lease()?).clone(), resolution, survey)?;
            Ok(AttributedRows {
                rows: query_payload(store, Arc::new(rows)),
                report: Some(report),
                shared_participants,
            })
        }
    }
}
