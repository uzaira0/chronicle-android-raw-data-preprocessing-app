//! Product runtime boundary for the Chronicle raw-data preprocessing app.
//!
//! This crate composes the existing Rust preprocessing kernel with the
//! product-owned semantic adapter. It is deliberately not a reusable graph
//! engine: the reusable surface is the versioned request/result envelope,
//! content-addressed artifacts, role assignments, obligations, and evidence.

mod adjacent_record_duplicate;
pub mod affectpro_touch_features;
pub mod aggregated_app_observation;
pub mod anchor_relative_category_window;
mod android_method_profile_registry;
pub mod app_relationship_matrices;
#[path = "execution/state.rs"]
mod execution_state;
#[path = "execution/dispatch.rs"]
mod execution_dispatch;
#[path = "execution/preflight.rs"]
mod execution_preflight;
use execution_state::*;
use execution_dispatch::*;
use execution_preflight::*;

fn scientific_preflight_native_raw(request_json: &str, raw_csv: RawCsvBytes<'_>, support_files: &RuntimeSupportFiles) -> Result<String, String> {
    let services = ExecutionServices { store: chronicle_chrono_kernel_wasm::payload_store::current_store() };
    INCREMENTAL_RUNTIME_STATES.with(|states| execution_preflight::scientific_preflight_native_raw(&mut states.borrow_mut(), &services, request_json, raw_csv, support_files))
}
mod binary_exports;
mod bundled_gzip;
mod bjerre_sparse_panel_support;
mod call_state_summary;
mod categorical_response_rate;
mod clear_all_notification_grouping;
pub mod categorical_threshold_bucketizer;
pub mod communication_detail_record;
mod count_ratio;
pub mod daily_contact_count;
pub mod daily_screen_session_participant_summary;
mod distance_matrix_medoid;
mod duration_span_window_projection;
pub mod ema_screen_session_materialization;
pub mod esm_app_sampling_gate;
pub mod esm_timezone_window_correction;
mod finite_scalar_pivot_classifier;
pub mod fixed_grid_categorical_dwell;
pub mod fixed_minute_packet_aggregation;
pub mod fixed_weekly_self_report_cap;
mod grouped_category_count;
mod grouped_column_summary;
mod grouped_distinct_count;
mod grouped_scalar_extrema;
mod grouped_scalar_sum_projection;
mod grouped_unique_mode;
pub mod integer_screen_state_csv;
mod keyboard_stress_axis_statistics;
mod prepared_sensor_window;
mod monarca_moa2_prepared;
mod prepared_scalar_axis;
mod prepared_finite_features;
mod prepared_amplitude_reference;
#[cfg(test)]
mod keyboard_stress_axis_statistics_tests;
#[cfg(test)]
mod prepared_finite_features_tests;
#[cfg(test)]
mod prepared_scalar_axis_tests;
#[cfg(test)]
mod prepared_sensor_window_tests;
#[cfg(test)]
mod monarca_moa2_prepared_tests;
#[cfg(test)]
mod prepared_amplitude_reference_tests;
pub mod literature_input_adapters;
pub mod motion_sensor_vector;
pub mod notification_seen_time;
mod on_bounded_short_off_bridge;
mod packed_json;
mod participant_scoped_interval_union;
pub mod participation_day_warmup;
pub mod questionnaire_screen_session_component;
pub mod questionnaire_screen_session_summary;
mod scan_signal_proximity_summary;
pub mod scoped_quality_exclusion;
pub mod screen_academic_row_derivation;
pub mod screen_bout_daily_summary;
pub mod screenomics_text_image_statistics;
mod sleep_diary_replication;
mod source_artifact_provenance_registry;
pub mod supplied_android_usage_statistics;
pub mod prepared_liwc_daily_display_ratio;
pub mod supplied_hourly_screen_window_selection;
pub mod source_byte_state_calculations;
pub mod source_timestamp_sessions;
pub mod timezone_correction_component;
pub mod timezone_offset_knn;
pub mod touch_keyboard_event_vector;
pub mod workflow_provenance;

use literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit, receipt_is_kernel_input_eligible,
    receipt_uses_capability_evidence, refuse_reserved_adapter_columns,
    validate_input_bindings_for_source, AdaptedLiteratureInput, LiteratureInputAdaptationReceipt,
    MethodProfileInputBindingReceipt,
};
use sleep_diary_replication::{
    validate_sleep_diary_binding, validate_sleep_diary_receipt_identity,
    DiaryReplicationBindingReceipt,
};

use calamine::{Reader, Xlsx};
use chronicle_chrono_kernel_wasm::b05_foundational_semantics::{
    B05ApplicabilityReceiptV1, B05RefusalReason, SchoedelApplicabilityReceiptV1,
    SchoedelReconstructionReceiptV1, SchoedelRefusalReason, ScientificRelation,
    ScreenConstructionReceiptV1, ScreenSessionConstructionStrategyId,
};
use chronicle_chrono_kernel_wasm::b06_maximum_duration::{
    self as b06, MaximumDurationApplicability, MaximumDurationReceipt,
};
use chronicle_chrono_kernel_wasm::eyes_complement::eyes_tagged_fau_artifact_jcs_bytes;
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    canonical_raw_participant_keys, discover_timezones_v2_native, eyes_complement_is_active,
    is_screen_session_start, minimum_duration_excluded_lineage_bytes, opener_set_applicability,
    reconstruction_base_header_bytes, split_raw_by_study,
    review_base_header_bytes, select_persisted_review_base,
    validate_foundational_semantics_evidence_for_options, validate_pipeline_v2_options,
    validate_pipeline_v2_options_with, validated_b05_schoedel_receipt,
    validated_eyes_tagged_fau_receipt, zero_duration_removed_lineage_bytes, B05ComputationPhase,
    B05OptionsDigestOrigin, B05SchoedelPreflightResult, B05SchoedelValidationReceipt,
    B05SchoedelValidationStatus, ConcurrentSubintervalFloorReceipt, EpisodeReconstructionStrategy,
    b05_schoedel_is_active, reconstruction_base_is_reusable,
    validate_supplied_communication_relationships,
    EyesInputPartitionOptionsDigestOrigin, EyesInputPartitionPreflightResult,
    CleaningCounts, EyesTaggedFauValidationReceipt, IncrementalPipelineV2Engine, IncrementalPipelineV2Execution,
    MaximumDurationValidation,
    MicroUseReceipt, MinimumDurationComparator, MinimumDurationDisposition, MinimumDurationReceipt,
    OpenerSetEvidence, OpenerStrategyRelation, PersistedReviewBaseSelection, PipelineV2Options,
    PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles, RawCsvBytes,
    ScientificPreflightDisposition, UsageSessionMode, VerifiedRawInput, WorkflowCheckpoint,
    ZeroDurationCleanupReceipt,
};
#[cfg(test)]
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, TIMEZONE_HANDLING_MODES,
};
use chronicle_chrono_kernel_wasm::workflow_contract::{
    query_request_fields, query_source_role_bindings, ApplicabilityExpression,
    QuerySourceRolePredicate, ReviewBehavior, WorkflowContractDigests, WORKFLOW_QUERIES,
};
use chronicle_chrono_kernel_wasm::{
    is_recognized_interaction_type, is_valid_chronicle_timezone, normalize_interaction_type,
    parse_chronicle_timestamp_ns,
};
use chronicle_preprocessing_semantic_adapter::{
    embedded_dependency_certificate, embedded_dependency_certificate_bytes, embedded_plan,
    embedded_plan_bytes, embedded_profile_bytes, embedded_profile_lock_bytes,
    embedded_runtime_authority_bytes, evaluate_dependency_cache_decision, evaluate_materialization,
    journal::{EvidenceJournal, Transition},
    views::{artifact_view, encode_view, explanation_view, obligation_view},
    ArtifactRef, DependencyCacheDecision, DependencyCacheMode, ExecutionStatus,
    MaterializationState, QueryGroupExecution, RoleAssignment, Sha256Digest, CERTIFIED_OPTION_KEYS,
    EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256, EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256, EMBEDDED_RUNTIME_AUTHORITY_SHA256,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{BufWriter, Cursor, Write};
use std::sync::atomic::{compiler_fence, Ordering};
use std::sync::{Arc, OnceLock};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

pub const RUNTIME_PROTOCOL_VERSION: &str = "chronicle-preprocessing-runtime/v2";
pub const SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION: &str = "chronicle-runtime-scientific-preflight/v2";
const SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR: &str =
    "scientific_preflight_retry_required:verified_raw_and_support_required:required_base_kind=none";
/// A sequential-engine review holds no memo or base to resume from, so a
/// raw-less review request must be retried with the raw file.
const SEQUENTIAL_ENGINE_RAW_REQUIRED_ERROR: &str =
    "sequential_engine_raw_required: the sequential engine runs from the raw file";

/// Native-only per-segment attribution for the runtime envelope around the
/// tracked kernel, mirroring the kernel's `QueryTimer`. WASM builds never
/// enable `query-timing` (no monotonic clock there).
#[cfg(feature = "query-timing")]
struct EnvelopeTimer {
    label: &'static str,
    started: std::time::Instant,
}

#[cfg(feature = "query-timing")]
impl EnvelopeTimer {
    fn start(label: &'static str) -> Self {
        Self {
            label,
            started: std::time::Instant::now(),
        }
    }

    fn finish(self) {
        drop(self);
    }
}

#[cfg(feature = "query-timing")]
impl Drop for EnvelopeTimer {
    fn drop(&mut self) {
        eprintln!(
            "runtime_segment label={} elapsed_ms={:.3}",
            self.label,
            self.started.elapsed().as_secs_f64() * 1_000.0,
        );
    }
}

#[cfg(not(feature = "query-timing"))]
struct EnvelopeTimer;

#[cfg(not(feature = "query-timing"))]
impl EnvelopeTimer {
    #[inline(always)]
    fn start(_label: &'static str) -> Self {
        Self
    }

    #[inline(always)]
    fn finish(self) {}
}
pub const EXECUTE_WORKSPACE_COMMAND: &str = "ExecuteWorkspace";
pub const QUERY_REVIEW_COMMAND: &str = "QueryReview";
pub const IMPLEMENTATION_BUILD_DIGEST: &str = env!("CHRONICLE_IMPLEMENTATION_BUILD_DIGEST");
pub const BUILD_ENVIRONMENT_DIGEST: &str = env!("CHRONICLE_BUILD_ENVIRONMENT_DIGEST");
const REVIEW_BASE_RUNTIME_MAGIC: &[u8; 8] = b"CHRRVR02";
const RECONSTRUCTION_BASE_RUNTIME_MAGIC: &[u8; 8] = b"CHRRXR02";
/// Persisted-base formats this build can still recognize but not read. The v01
/// envelopes had no scientific-preflight trailer, so their final four bytes are
/// kernel payload rather than a trailer length. Naming them here keeps an
/// existing OPFS workspace degrading to the raw path instead of erroring.
const SUPERSEDED_PERSISTED_BASE_RUNTIME_MAGICS: &[&[u8; 8]] = &[b"CHRRVR01", b"CHRRXR01"];
const PERSISTED_BASE_RUNTIME_HEADER_BYTES: usize = 8 + 32;
const PERSISTED_PREFLIGHT_TRAILER_LENGTH_BYTES: usize = 4;
const MAX_REVIEW_BASE_ENCODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_RECONSTRUCTION_BASE_ENCODED_BYTES: usize = 96 * 1024 * 1024;
const MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES: usize = 128 * 1024 * 1024;
const REQUIRED_VIEWS: [(&str, &str, &str); 4] = [
    (
        "workflow-explorer-view-json",
        "chronicle-workflow-explorer/v1",
        "urn:chronicle:view:workflow-explorer:v1",
    ),
    (
        "artifact-view-json",
        "chronicle.artifact.v1",
        "urn:chronicle:view:artifact:v1",
    ),
    (
        "obligation-view-json",
        "chronicle.obligation.v1",
        "urn:chronicle:view:obligation:v1",
    ),
    (
        "explanation-view-json",
        "chronicle.explanation.v1",
        "urn:chronicle:view:explanation:v1",
    ),
];
const SUPPORT_ROLES: &[&str] = &[
    "filter_file",
    "apps_forcing_screen_open_file",
    "background_apps_file",
    "app_codebook_file",
    "study_dates_file",
    "device_sharing_file",
    "survey_attribution_file",
    "enrolled_devices_file",
    "input_capability_evidence_file",
    "analysis_feature_matrix_file",
    "call_sms_eligibility_file",
    "phonestudy_ps_communication_file",
    "phonestudy_es_file",
    "anchor_events_file",
];

fn is_registered_support_role(role: &str) -> bool {
    SUPPORT_ROLES.contains(&role)
}

fn persisted_base_runtime_identity() -> [u8; 32] {
    static IDENTITY: OnceLock<[u8; 32]> = OnceLock::new();
    *IDENTITY.get_or_init(|| {
        let mut digest = Sha256::new();
        for value in [
            IMPLEMENTATION_BUILD_DIGEST,
            BUILD_ENVIRONMENT_DIGEST,
            EMBEDDED_PRODUCT_CONTRACT_SHA256,
            EMBEDDED_RUNTIME_AUTHORITY_SHA256,
            EMBEDDED_PLAN_SHA256,
            EMBEDDED_PROFILE_LOCK_SHA256,
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        ] {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
        digest.finalize().into()
    })
}

fn wrap_persisted_base(payload: Vec<u8>, magic: &[u8; 8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(PERSISTED_BASE_RUNTIME_HEADER_BYTES + payload.len());
    encoded.extend_from_slice(magic);
    encoded.extend_from_slice(&persisted_base_runtime_identity());
    encoded.extend_from_slice(&payload);
    encoded
}

/// The scientific-preflight commitment of the run that wrote a persisted base,
/// carried inside that base so a later raw-less review can resume from it.
///
/// `state.pending_scientific_preflight` is in-worker state that dies with the
/// worker; the persisted bases are the only durable objects a raw-less resume
/// holds. Both members are exactly what `validate_pending_scientific_preflight`
/// and `validate_b05_schoedel_finalization` already compare, so nothing here is
/// a second description of the preflight — it is the same receipt, persisted.
///
/// Batch-scoped participant tokens, the batch id, and literal participant ids
/// are deliberately absent: they are private per-request transport, and the key
/// already commits to their count and scope digest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedScientificPreflight {
    receipt: RuntimeScientificPreflightReceipt,
    exact_b05_schoedel: B05SchoedelPreflightResult,
}

/// Append the preflight commitment after the kernel payload, with its length as
/// the final four bytes.
///
/// The trailer goes at the END because `review_base_probe_spec_json` hands the
/// browser a fixed prefix length and `prepare_review_from_prepared` reads the
/// kernel header out of that prefix. A variable-length blob in front of the
/// kernel payload would move the header out of every probe.
fn attach_persisted_preflight(
    mut base: Vec<u8>,
    preflight: Option<&PersistedScientificPreflight>,
) -> Result<Vec<u8>, String> {
    let encoded = match preflight {
        Some(preflight) => serde_json::to_vec(preflight)
            .map_err(|error| format!("encode persisted scientific preflight: {error}"))?,
        None => Vec::new(),
    };
    let length = u32::try_from(encoded.len())
        .map_err(|_| "persisted scientific preflight is too large".to_string())?;
    base.extend_from_slice(&encoded);
    base.extend_from_slice(&length.to_le_bytes());
    Ok(base)
}

/// Split a verified persisted-base payload into the kernel payload and the
/// preflight commitment the writing run attached. An empty payload (absent or
/// stale base) carries neither.
fn split_persisted_preflight<'a>(
    payload: &'a [u8],
    label: &str,
) -> Result<(&'a [u8], Option<PersistedScientificPreflight>), String> {
    if payload.is_empty() {
        return Ok((payload, None));
    }
    if payload.len() < PERSISTED_PREFLIGHT_TRAILER_LENGTH_BYTES {
        return Err(format!("{label} is missing its preflight trailer"));
    }
    let (body, length_bytes) =
        payload.split_at(payload.len() - PERSISTED_PREFLIGHT_TRAILER_LENGTH_BYTES);
    let length = u32::from_le_bytes(
        length_bytes
            .try_into()
            .map_err(|_| format!("{label} preflight length is malformed"))?,
    ) as usize;
    if length > body.len() {
        return Err(format!("{label} preflight trailer is truncated"));
    }
    let (kernel_payload, encoded) = body.split_at(body.len() - length);
    if length == 0 {
        return Ok((kernel_payload, None));
    }
    let preflight = serde_json::from_slice::<PersistedScientificPreflight>(encoded)
        .map_err(|error| format!("decode {label} scientific preflight: {error}"))?;
    Ok((kernel_payload, Some(preflight)))
}

type ExportedBases = (Option<Vec<u8>>, Option<Vec<u8>>);

/// Keep only the exported bases a later request can read back: the writer
/// never persists an envelope `validate_persisted_base_encoded_lengths` would
/// refuse, so that reader-side ceiling stays a pure tamper check and a large
/// input degrades to "no resume" instead of failing its next run. The review
/// base is the one `select_persisted_base_kind` starts from, so a
/// reconstruction base is never kept without it; when the pair would exceed
/// the combined ceiling the reconstruction base is the one dropped.
fn persistable_bases(
    review_base: Option<Vec<u8>>,
    reconstruction_base: Option<Vec<u8>>,
) -> ExportedBases {
    let review_base = review_base.filter(|encoded| encoded.len() <= MAX_REVIEW_BASE_ENCODED_BYTES);
    let review_bytes = review_base.as_ref().map_or(0, Vec::len);
    let reconstruction_base = reconstruction_base.filter(|encoded| {
        review_base.is_some()
            && encoded.len() <= MAX_RECONSTRUCTION_BASE_ENCODED_BYTES
            && review_bytes + encoded.len() <= MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES
    });
    (review_base, reconstruction_base)
}

fn validate_persisted_base_encoded_lengths(
    review_bytes: usize,
    reconstruction_bytes: usize,
    cache_mode: DependencyCacheMode,
) -> Result<(), String> {
    if cache_mode != DependencyCacheMode::CertifiedNarrow {
        return Ok(());
    }
    if review_bytes > MAX_REVIEW_BASE_ENCODED_BYTES {
        return Err(format!(
            "review base is too large: {review_bytes} bytes exceeds {MAX_REVIEW_BASE_ENCODED_BYTES}"
        ));
    }
    if reconstruction_bytes > MAX_RECONSTRUCTION_BASE_ENCODED_BYTES {
        return Err(format!(
            "reconstruction base is too large: {reconstruction_bytes} bytes exceeds {MAX_RECONSTRUCTION_BASE_ENCODED_BYTES}"
        ));
    }
    let combined = review_bytes
        .checked_add(reconstruction_bytes)
        .ok_or_else(|| "combined persisted-base size overflow".to_string())?;
    if combined > MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES {
        return Err(format!(
            "combined persisted bases are too large: {combined} bytes exceeds {MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES}"
        ));
    }
    Ok(())
}

fn verified_persisted_base_payload<'a>(
    encoded: &'a [u8],
    magic: &[u8; 8],
    label: &str,
    cache_mode: DependencyCacheMode,
) -> Result<&'a [u8], String> {
    if cache_mode != DependencyCacheMode::CertifiedNarrow || encoded.is_empty() {
        return Ok(&[]);
    }
    if encoded.len() < PERSISTED_BASE_RUNTIME_HEADER_BYTES {
        return Err(format!("{label} runtime envelope is truncated"));
    }
    if &encoded[..magic.len()] != magic {
        if SUPERSEDED_PERSISTED_BASE_RUNTIME_MAGICS
            .iter()
            .any(|superseded| &encoded[..superseded.len()] == superseded.as_slice())
        {
            // A base written by an older envelope format is stale, not hostile.
            // Treat it exactly like a stale build identity so an existing OPFS
            // workspace degrades to the raw path instead of failing the run.
            return Ok(&[]);
        }
        return Err(format!("{label} runtime envelope has the wrong format"));
    }
    if encoded[magic.len()..PERSISTED_BASE_RUNTIME_HEADER_BYTES]
        != persisted_base_runtime_identity()
    {
        // A cache written by different code or contracts is simply stale. It
        // must not become input to the current Rust kernel.
        return Ok(&[]);
    }
    Ok(&encoded[PERSISTED_BASE_RUNTIME_HEADER_BYTES..])
}

#[wasm_bindgen]
pub fn runtime_version() -> String {
    format!(
        "chronicle-preprocessing-runtime/{}",
        env!("CARGO_PKG_VERSION")
    )
}

#[wasm_bindgen]
pub fn implementation_build_digest() -> String {
    IMPLEMENTATION_BUILD_DIGEST.into()
}

/// Discover normalized IANA timezones through the same Rust boundary used by
/// production preprocessing.
#[wasm_bindgen]
pub fn discover_timezones_v2(csv_bytes: &[u8]) -> Result<Vec<String>, JsValue> {
    discover_timezones_v2_native(csv_bytes).map_err(|error| JsValue::from_str(&error))
}

/// The per-study parts of a picked raw file that mixes studies, taken out one
/// at a time so the browser never holds two copies of every part. Study IDs
/// are already published in every output row.
#[wasm_bindgen]
pub struct RawStudySplit {
    parts: Vec<(String, Vec<u8>)>,
}

#[wasm_bindgen]
impl RawStudySplit {
    /// Sorted study IDs; empty for a single-study file.
    pub fn study_ids(&self) -> Vec<String> {
        self.parts.iter().map(|(study, _)| study.clone()).collect()
    }

    pub fn take_part(&mut self, index: u32) -> Vec<u8> {
        self.parts
            .get_mut(index as usize)
            .map(|(_, bytes)| std::mem::take(bytes))
            .unwrap_or_default()
    }
}

#[wasm_bindgen]
pub fn split_raw_by_study_v1(csv_bytes: &[u8]) -> RawStudySplit {
    RawStudySplit {
        parts: split_raw_by_study(csv_bytes),
    }
}

// timezone is deliberately absent: a missing timezone column (or blank/"None"
// cells) is documented input and rows fall back to UTC.
const ADVISORY_RAW_COLUMNS: [&str; 6] = [
    "study_id",
    "participant_id",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp",
];
const PARTICIPANT_PARTITION_BATCH_DOMAIN: &[u8] = b"chronicle-participant-partition-batch/v1\0";
const PARTICIPANT_PARTITION_TOKEN_DOMAIN: &[u8] = b"chronicle-participant-partition-token/v2\0";
const MAX_LIVE_PARTICIPANT_INSPECTION_BATCHES: usize = 16;

/// Erase sensitive bytes with observable volatile stores so optimized release
/// and WASM builds cannot dead-store-eliminate a wipe immediately before drop.
fn secure_zero_bytes(bytes: &mut [u8]) {
    for byte in bytes {
        // SAFETY: `byte` is an exclusive, valid mutable reference for this
        // iteration; the volatile write stays within that one-byte allocation.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

struct ParticipantInspectionBatch {
    secret: [u8; 32],
    /// Token → `(study_id, participant_id)` per raw artifact.
    participants_by_artifact: BTreeMap<Sha256Digest, BTreeMap<Sha256Digest, (String, String)>>,
}

thread_local! {
    static PARTICIPANT_INSPECTION_BATCHES: RefCell<BTreeMap<Sha256Digest, ParticipantInspectionBatch>> =
        const { RefCell::new(BTreeMap::new()) };
}

/// v2 binds the study: a participant stream is one participant within one
/// study, so the same ID in two studies' files is two streams, not a fragment.
fn participant_partition_token(
    secret: &[u8; 32],
    study_id: &str,
    participant_id: &str,
) -> Sha256Digest {
    let mut digest = Sha256::new();
    digest.update(PARTICIPANT_PARTITION_TOKEN_DOMAIN);
    digest.update(secret);
    digest.update((study_id.len() as u64).to_le_bytes());
    digest.update(study_id.as_bytes());
    digest.update(participant_id.as_bytes());
    format!("sha256:{}", hex::encode(digest.finalize()))
}

#[wasm_bindgen]
pub fn begin_raw_inspection_batch(mut secret_bytes: Vec<u8>) -> Result<String, JsValue> {
    begin_raw_inspection_batch_zeroing(&mut secret_bytes).map_err(|error| JsValue::from_str(&error))
}

fn begin_raw_inspection_batch_zeroing(secret_bytes: &mut [u8]) -> Result<String, String> {
    let result = begin_raw_inspection_batch_native(secret_bytes);
    secure_zero_bytes(secret_bytes);
    result
}

fn begin_raw_inspection_batch_native(secret_bytes: &[u8]) -> Result<String, String> {
    let mut secret: [u8; 32] = secret_bytes
        .try_into()
        .map_err(|_| "raw inspection batch requires 32 bytes of entropy".to_string())?;
    let result = if secret.iter().all(|byte| *byte == 0) {
        Err("raw inspection batch entropy must not be all zero".into())
    } else {
        let mut digest = Sha256::new();
        digest.update(PARTICIPANT_PARTITION_BATCH_DOMAIN);
        digest.update(secret);
        let batch_id = format!("sha256:{}", hex::encode(digest.finalize()));
        PARTICIPANT_INSPECTION_BATCHES.with(|batches| {
            let mut batches = batches.borrow_mut();
            if let Some(existing) = batches.get(&batch_id) {
                if existing.secret == secret {
                    // The shared inspection worker may receive duplicate setup
                    // messages during one browser lifecycle. Idempotence keeps
                    // that lifecycle usable without serializing the secret into
                    // a request or copying the registry into pooled workers.
                    return Ok(batch_id);
                }
                return Err("raw inspection batch identity collision".into());
            }
            if batches.len() >= MAX_LIVE_PARTICIPANT_INSPECTION_BATCHES {
                return Err("too many live raw inspection batches; dispose an older batch".into());
            }
            batches.insert(
                batch_id.clone(),
                ParticipantInspectionBatch {
                    secret,
                    participants_by_artifact: BTreeMap::new(),
                },
            );
            Ok(batch_id)
        })
    };
    secure_zero_bytes(&mut secret);
    result
}

#[wasm_bindgen]
pub fn dispose_raw_inspection_batch(batch_id: &str) -> bool {
    PARTICIPANT_INSPECTION_BATCHES.with(|batches| {
        let mut batches = batches.borrow_mut();
        let Some(mut batch) = batches.remove(batch_id) else {
            return false;
        };
        secure_zero_bytes(&mut batch.secret);
        for participants in batch.participants_by_artifact.values_mut() {
            for (study_id, participant_id) in participants.values_mut() {
                for identifier in [study_id, participant_id] {
                    let mut identifier_bytes = std::mem::take(identifier).into_bytes();
                    secure_zero_bytes(&mut identifier_bytes);
                }
            }
            participants.clear();
        }
        batch.participants_by_artifact.clear();
        true
    })
}

fn register_participants_in_batch(
    batch_id: &str,
    artifact_digest: &str,
    participants: &BTreeSet<(String, String)>,
) -> Result<Vec<Sha256Digest>, String> {
    PARTICIPANT_INSPECTION_BATCHES.with(|batches| {
        let mut batches = batches.borrow_mut();
        let batch = batches.get_mut(batch_id).ok_or_else(|| {
            "raw inspection batch is unavailable; re-inspect the files".to_string()
        })?;
        let participant_by_token = batch
            .participants_by_artifact
            .entry(artifact_digest.to_string())
            .or_default();
        let mut tokens = Vec::with_capacity(participants.len());
        for key @ (study_id, participant_id) in participants {
            let token = participant_partition_token(&batch.secret, study_id, participant_id);
            if participant_by_token
                .insert(token.clone(), key.clone())
                .is_some_and(|previous| previous != *key)
            {
                return Err("raw inspection participant token collision".into());
            }
            tokens.push(token);
        }
        tokens.sort();
        tokens.dedup();
        Ok(tokens)
    })
}

/// Register the exact execution-decoder participant set for one raw artifact
/// in an already configured ephemeral batch. This pool-worker setup API never
/// serializes participant identifiers or the batch secret and is deliberately
/// separate from RuntimeRequest/options/provenance.
#[wasm_bindgen]
pub fn register_raw_participant_partition_artifact(
    csv_bytes: &[u8],
    participant_partition_batch_id: &str,
) -> Result<(), JsValue> {
    let participants = canonical_raw_participant_keys(csv_bytes);
    register_participants_in_batch(
        participant_partition_batch_id,
        &sha256(csv_bytes),
        &participants,
    )
    .map(|_| ())
    .map_err(|error| JsValue::from_str(&error))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawFileInspection {
    file_name: String,
    size_bytes: u64,
    row_count: usize,
    participant_count: usize,
    participant_partition_batch_id: Option<Sha256Digest>,
    /// Sorted batch-scoped opaque tokens used only to detect one participant
    /// stream split across distinct raw artifacts. Literal participant IDs and
    /// stable cross-batch pseudonyms do not cross the inspection boundary.
    participant_tokens: Vec<Sha256Digest>,
    columns: Vec<String>,
    timezones: Vec<String>,
    has_required_columns: bool,
    invalid_timestamp_count: usize,
    missing_timestamp_count: usize,
    missing_timezone_count: usize,
    duplicate_timestamp_count: usize,
    out_of_order_timestamp_count: usize,
    first_out_of_order_row: Option<usize>,
    unrecognized_interaction_types: Vec<String>,
    /// Rows whose canonical interaction type opens a screen session. Zero in a
    /// non-empty file means the device never logged screen state, so a
    /// screen-usage run can only produce an empty output.
    screen_start_event_count: usize,
    warnings: Vec<String>,
}

fn physical_data_row_count(bytes: &[u8]) -> usize {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let bytes = trimmed.as_bytes();
    let mut separators = 0usize;
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                separators += 1;
                index += usize::from(bytes.get(index + 1) == Some(&b'\n'));
            }
            b'\n' => separators += 1,
            _ => {}
        }
        index += 1;
    }
    separators
}

fn duplicate_safe_headers(raw_headers: &csv::StringRecord) -> (Vec<String>, bool) {
    let mut used = BTreeSet::new();
    let mut columns = Vec::with_capacity(raw_headers.len());
    let mut duplicate = false;
    for (index, raw) in raw_headers.iter().enumerate() {
        let mut base = raw.trim().trim_start_matches('\u{feff}').to_string();
        if index > 0 {
            base = raw.trim().to_string();
        }
        let mut column = base.clone();
        let mut suffix = 1usize;
        while used.contains(&column) {
            duplicate = true;
            column = format!("{base}_{suffix}");
            suffix += 1;
        }
        used.insert(column.clone());
        columns.push(column);
    }
    (columns, duplicate)
}

fn raw_cell<'a>(
    record: &'a csv::StringRecord,
    header_indexes: &BTreeMap<String, usize>,
    name: &str,
) -> &'a str {
    header_indexes
        .get(name)
        .and_then(|index| record.get(*index))
        .unwrap_or_default()
        .trim()
}

/// Tolerant upload inspection owned by the same Rust runtime as execution.
/// Malformed CSV is reported through warnings instead of escaping as an error,
/// because upload inspection is advisory and must never crash the file picker.
#[wasm_bindgen]
pub fn inspect_raw_file_v1(csv_bytes: &[u8], file_name: &str, size_bytes: f64) -> String {
    inspect_raw_file_native(csv_bytes, file_name, size_bytes, None)
        .expect("v1 inspection without a participant batch cannot fail")
}

#[wasm_bindgen]
pub fn inspect_raw_file_v2(
    csv_bytes: &[u8],
    file_name: &str,
    size_bytes: f64,
    participant_partition_batch_id: &str,
) -> Result<String, JsValue> {
    inspect_raw_file_native(
        csv_bytes,
        file_name,
        size_bytes,
        Some(participant_partition_batch_id),
    )
    .map_err(|error| JsValue::from_str(&error))
}

fn inspect_raw_file_native(
    csv_bytes: &[u8],
    file_name: &str,
    size_bytes: f64,
    participant_partition_batch_id: Option<&str>,
) -> Result<String, String> {
    if let Some(batch_id) = participant_partition_batch_id {
        let available =
            PARTICIPANT_INSPECTION_BATCHES.with(|batches| batches.borrow().contains_key(batch_id));
        if !available {
            return Err("raw inspection batch is unavailable; re-inspect the files".into());
        }
    }
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_bytes);
    let (raw_headers, mut parse_warning) = match reader.headers() {
        Ok(headers) => (headers.clone(), None),
        Err(error) => (csv::StringRecord::new(), Some(error.to_string())),
    };
    let (columns, duplicate_headers) = duplicate_safe_headers(&raw_headers);
    let header_indexes = raw_headers
        .iter()
        .enumerate()
        .map(|(index, value)| {
            (
                value.trim().trim_start_matches('\u{feff}').to_string(),
                index,
            )
        })
        // Last duplicate wins, as in the execution decoder: inspection must
        // read the column execution will.
        .collect::<BTreeMap<_, _>>();
    let missing = ADVISORY_RAW_COLUMNS
        .iter()
        .filter(|column| !header_indexes.contains_key(**column))
        .copied()
        .collect::<Vec<_>>();

    let mut rows = Vec::new();
    for result in reader.records() {
        match result {
            Ok(record) if record.iter().any(|cell| !cell.trim().is_empty()) => rows.push(record),
            Ok(_) => {}
            Err(error) => {
                parse_warning.get_or_insert_with(|| error.to_string());
            }
        }
    }

    let mut participants = BTreeSet::new();
    let mut timezones = BTreeSet::new();
    let mut invalid_timezones = BTreeSet::new();
    let mut timestamp_counts = BTreeMap::<String, usize>::new();
    let mut max_timestamp_by_participant = BTreeMap::<String, i64>::new();
    let mut unrecognized_interaction_types = BTreeSet::new();
    let mut invalid_timestamp_count = 0usize;
    let mut missing_timestamp_count = 0usize;
    let mut missing_timezone_count = 0usize;
    let mut out_of_order_timestamp_count = 0usize;
    let mut first_out_of_order_row = None;
    let mut screen_start_event_count = 0usize;

    for (index, row) in rows.iter().enumerate() {
        let participant = raw_cell(row, &header_indexes, "participant_id");
        if !participant.is_empty() {
            participants.insert(participant.to_string());
        }
        let timezone = raw_cell(row, &header_indexes, "timezone");
        if timezone.is_empty() || timezone == "None" {
            // Blank and literal "None" cells are real Chronicle export values;
            // preprocessing falls back to UTC for them, so the inspection
            // reports UTC as the effective timezone and keeps only the count.
            missing_timezone_count += 1;
            timezones.insert("UTC".to_string());
        } else {
            // An invalid value is reported, never offered: the app selects a
            // lone discovered timezone automatically and the run would then
            // compute in UTC without saying so.
            if is_valid_chronicle_timezone(timezone) {
                timezones.insert(timezone.to_string());
            } else {
                invalid_timezones.insert(timezone.to_string());
            }
        }
        let interaction_type = raw_cell(row, &header_indexes, "interaction_type");
        if !interaction_type.is_empty() && !is_recognized_interaction_type(interaction_type) {
            unrecognized_interaction_types.insert(interaction_type.to_string());
        }
        if is_screen_session_start(normalize_interaction_type(interaction_type)) {
            screen_start_event_count += 1;
        }

        let timestamp = raw_cell(row, &header_indexes, "event_timestamp");
        if timestamp.is_empty() {
            missing_timestamp_count += 1;
            continue;
        }
        *timestamp_counts.entry(timestamp.to_string()).or_default() += 1;
        let Some(timestamp_ns) = parse_chronicle_timestamp_ns(timestamp) else {
            invalid_timestamp_count += 1;
            continue;
        };
        // Preserve the old informational metric: offset-bearing timestamps are
        // valid input but were skipped by the browser's UTC wall-clock scan.
        let has_explicit_zone = timestamp.ends_with('Z')
            || timestamp
                .char_indices()
                .rev()
                .find(|(_, character)| matches!(character, '+' | '-'))
                .is_some_and(|(offset, _)| offset >= 19);
        if has_explicit_zone {
            continue;
        }
        let previous = max_timestamp_by_participant
            .get(participant)
            .copied()
            .unwrap_or(i64::MIN);
        if timestamp_ns < previous {
            out_of_order_timestamp_count += 1;
            first_out_of_order_row.get_or_insert(index + 1);
        } else {
            max_timestamp_by_participant.insert(participant.to_string(), timestamp_ns);
        }
    }

    let duplicate_timestamp_count = timestamp_counts
        .values()
        .filter(|count| **count > 1)
        .count();
    // Fragment membership must use the exact same decoder and duplicate-header
    // precedence as execution. The tolerant inspector above remains advisory.
    let canonical_participants = canonical_raw_participant_keys(csv_bytes);
    let mut warnings = Vec::new();
    if !file_name.to_lowercase().ends_with(".csv") {
        warnings.push("File extension is not .csv.".to_string());
    }
    if canonical_participants.len() > 1 {
        warnings.push(format!(
            "This file contains {} participants. Preprocessing keeps episode and session matching participant-scoped; verify that each participant stream is not split across multiple uploaded files.",
            canonical_participants.len()
        ));
    }
    if size_bytes == 0.0 || csv_bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        warnings.push("File is empty.".to_string());
    }
    if !missing.is_empty() {
        warnings.push(format!("Missing required columns: {}", missing.join(", ")));
    }
    if duplicate_headers {
        warnings.push("Duplicate column headers found.".to_string());
    }
    if !invalid_timezones.is_empty() {
        // PHI safety: report only the count — raw cell values must never
        // enter warning strings surfaced to the UI.
        warnings.push(format!(
            "Invalid timezone values: {} distinct value(s) in the timezone column.",
            invalid_timezones.len()
        ));
    }
    if missing_timestamp_count > 0 && !missing.contains(&"event_timestamp") {
        warnings.push(format!(
            "{missing_timestamp_count} rows are missing event_timestamp values."
        ));
    }
    if invalid_timestamp_count > 0 {
        warnings.push(format!(
            "{invalid_timestamp_count} rows have invalid event_timestamp values."
        ));
    }
    if let Some(warning) = parse_warning {
        warnings.push(warning);
    }
    if let Err(error) = validate_supplied_communication_relationships(csv_bytes) {
        warnings.push(error);
    }

    let raw_artifact_digest = sha256(csv_bytes);
    let participant_tokens = participant_partition_batch_id
        .map(|batch_id| {
            register_participants_in_batch(batch_id, &raw_artifact_digest, &canonical_participants)
        })
        .transpose()?
        .unwrap_or_default();
    Ok(serde_json::to_string(&RawFileInspection {
        file_name: file_name.to_string(),
        size_bytes: size_bytes.max(0.0) as u64,
        row_count: physical_data_row_count(csv_bytes),
        participant_count: canonical_participants.len(),
        participant_partition_batch_id: participant_partition_batch_id.map(str::to_owned),
        participant_tokens,
        columns,
        timezones: timezones.into_iter().collect(),
        has_required_columns: missing.is_empty(),
        invalid_timestamp_count,
        missing_timestamp_count,
        missing_timezone_count,
        duplicate_timestamp_count,
        out_of_order_timestamp_count,
        first_out_of_order_row,
        unrecognized_interaction_types: unrecognized_interaction_types.into_iter().collect(),
        screen_start_event_count,
        warnings,
    })
    .expect("RawFileInspection serialization cannot fail"))
}

#[wasm_bindgen]
pub fn build_environment_digest() -> String {
    BUILD_ENVIRONMENT_DIGEST.into()
}

// Small identity DTO exposed as a typed JS object. Bulk runtime requests,
// manifests, and artifacts deliberately stay on the existing string/byte
// boundary so they do not pay per-field JS allocation costs. It crosses the
// ABI as `Ts<RuntimeIdentity>`: tsify's `into_wasm_abi` attribute is
// deprecated because a serialization failure inside the ABI conversion
// leaks, while `Ts` serializes inside the function and returns a `JsError`.
/// Protocol, implementation, build-environment, and embedded-authority digests
/// of the loaded runtime; the same value `runtime_identity_json` serializes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub protocol_version: String,
    pub implementation_digest: String,
    pub build_environment_digest: String,
    pub product_contract_digest: String,
    pub plan_digest: String,
    pub profile_digest: String,
    pub profile_lock_digest: String,
    pub runtime_authority_digest: String,
    pub dependency_certificate_digest: String,
}

fn current_runtime_identity() -> RuntimeIdentity {
    RuntimeIdentity {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
        plan_digest: EMBEDDED_PLAN_SHA256.into(),
        profile_digest: EMBEDDED_PROFILE_SHA256.into(),
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256.into(),
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
    }
}

#[wasm_bindgen]
pub fn runtime_identity() -> Result<Ts<RuntimeIdentity>, JsError> {
    Ok(current_runtime_identity().into_ts()?)
}

#[wasm_bindgen]
pub fn runtime_identity_json() -> String {
    serde_jcs::to_string(&current_runtime_identity()).expect("runtime identity is serializable")
}

#[wasm_bindgen]
pub fn workflow_contract_json() -> String {
    serde_json::to_string(&chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract())
        .expect("Rust workflow contract is serializable")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowExplorerSupportRole {
    pub role_id: String,
    pub present: bool,
    #[serde(default)]
    pub digest: Option<Sha256Digest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowExplorerRequest {
    pub options: Value,
    #[serde(default)]
    pub support_roles: Vec<WorkflowExplorerSupportRole>,
    #[serde(default)]
    pub selected_run_root: Option<Sha256Digest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerPhaseState {
    pub phase_id: String,
    pub label: String,
    pub description: String,
    pub display_order: u16,
    pub input_phase_ids: Vec<String>,
    pub applicable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerOperationState {
    pub operation_id: String,
    pub label: String,
    pub description: String,
    pub phase_id: String,
    pub role: String,
    pub epistemic_role: String,
    pub input_artifact_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub data_effects: Vec<String>,
    pub applicable: bool,
    pub run_state: String,
    pub off_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerArtifactState {
    pub artifact_id: String,
    pub label: String,
    pub kind: String,
    pub producer_operation_id: Option<String>,
    pub consumer_operation_ids: Vec<String>,
    pub run_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerQueryState {
    pub query_id: String,
    pub query_group_id: String,
    pub input_query_ids: Vec<String>,
    pub operation_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub applicability: String,
    pub physical_state: String,
    pub reuse_reason: Option<String>,
    pub checkpoint_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerDecisionImpact {
    pub input_id: String,
    pub input_kind: String,
    pub direct_query_ids: Vec<String>,
    pub affected_operation_ids: Vec<String>,
    pub affected_artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExplorerView {
    pub protocol_version: String,
    pub view_id: String,
    pub schema_id: String,
    pub revision: u64,
    pub root_digest: Sha256Digest,
    pub selected_run_root: Option<Sha256Digest>,
    pub contract_digests: WorkflowContractDigests,
    pub phases: Vec<WorkflowExplorerPhaseState>,
    pub operations: Vec<WorkflowExplorerOperationState>,
    pub artifacts: Vec<WorkflowExplorerArtifactState>,
    pub queries: Vec<WorkflowExplorerQueryState>,
    pub decisions: Vec<WorkflowExplorerDecisionImpact>,
}

fn serialized_enum<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .expect("workflow enum is serializable")
        .as_str()
        .expect("workflow enum serializes as a string")
        .to_string()
}

fn evaluate_workflow_applicability(
    expression: &ApplicabilityExpression,
    options: &Value,
    support_roles: &BTreeSet<&str>,
) -> bool {
    match expression {
        ApplicabilityExpression::Always => true,
        ApplicabilityExpression::OptionTrue { option_key } => options
            .get(*option_key)
            .and_then(Value::as_bool)
            .unwrap_or(false),
        ApplicabilityExpression::OptionBooleanEquals { option_key, value } => options
            .get(*option_key)
            .and_then(Value::as_bool)
            .is_some_and(|actual| actual == *value),
        ApplicabilityExpression::OptionStringEquals { option_key, value } => options
            .get(*option_key)
            .and_then(Value::as_str)
            .is_some_and(|actual| actual == *value),
        ApplicabilityExpression::ArrayNonempty { option_key } => options
            .get(*option_key)
            .and_then(Value::as_array)
            .is_some_and(|value| !value.is_empty()),
        ApplicabilityExpression::StringNonempty { option_key } => options
            .get(*option_key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty()),
        ApplicabilityExpression::SupportPresent { role_id } => support_roles.contains(role_id),
        ApplicabilityExpression::All { terms } => terms
            .iter()
            .all(|term| evaluate_workflow_applicability(term, options, support_roles)),
        ApplicabilityExpression::Any { terms } => terms
            .iter()
            .any(|term| evaluate_workflow_applicability(term, options, support_roles)),
        ApplicabilityExpression::Not { term } => {
            !evaluate_workflow_applicability(term, options, support_roles)
        }
    }
}

fn workflow_phase_applicable<'a, I>(
    phase_id: &str,
    operations: I,
    options: &Value,
    support_roles: &BTreeSet<&str>,
) -> bool
where
    I: IntoIterator<Item = (&'a str, &'a ApplicabilityExpression)>,
{
    operations
        .into_iter()
        .any(|(operation_phase_id, applicability)| {
            operation_phase_id == phase_id
                && evaluate_workflow_applicability(applicability, options, support_roles)
        })
}

fn explorer_query_state(
    execution: Option<&RuntimeQueryExecution>,
) -> (&'static str, Option<String>) {
    match execution.map(|execution| execution.status) {
        Some(ExecutionStatus::Recomputed) => ("executed", None),
        Some(ExecutionStatus::Cached) => ("memoized", Some("same_effective_inputs".into())),
        Some(ExecutionStatus::Skipped) => ("omitted", Some("review_not_requested".into())),
        Some(ExecutionStatus::Bypassed) => ("omitted", Some("not_applicable".into())),
        Some(ExecutionStatus::Error) => ("error", None),
        None => ("not_observed", None),
    }
}

fn is_workflow_support_role(role_id: &str) -> bool {
    role_id != "processing_options"
        && chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract()
            .semantic
            .root_roles
            .iter()
            .any(|role| role.role_id == role_id)
}

fn build_workflow_explorer_view(
    request: &WorkflowExplorerRequest,
    query_executions: &[RuntimeQueryExecution],
    revision: u64,
    run_root: Option<&str>,
) -> Result<WorkflowExplorerView, String> {
    let exact_options: PipelineV2OptionsJson = serde_json::from_value(request.options.clone())
        .map_err(|error| format!("invalid workflow-explorer options: {error}"))?;
    // The contract's applicability rules name exact request fields
    // (`usage_session_mode`, `include_app_output`, `include_screen_output`,
    // `materialize_visualization_data`) beside certified keys. The certified
    // projection alone drops the exact ones, and an absent key evaluates false:
    // the app, screen and credited table builders were drawn "not applicable"
    // for every options value. Evaluate against both spellings.
    let mut semantic_options = serde_json::to_value(&exact_options)
        .map_err(|error| format!("serialize workflow-explorer options: {error}"))?;
    if let (Some(merged), Value::Object(certified)) = (
        semantic_options.as_object_mut(),
        semantic_options_value(&exact_options)?,
    ) {
        merged.extend(certified);
    }
    let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let known_roles = contract
        .semantic
        .root_roles
        .iter()
        .map(|role| role.role_id)
        .collect::<BTreeSet<_>>();
    let unknown_roles = request
        .support_roles
        .iter()
        .map(|role| role.role_id.as_str())
        .filter(|role| !known_roles.contains(role))
        .collect::<Vec<_>>();
    if !unknown_roles.is_empty() {
        return Err(format!("unknown workflow support roles: {unknown_roles:?}"));
    }
    let present_roles = request
        .support_roles
        .iter()
        .filter(|role| role.present)
        .map(|role| role.role_id.as_str())
        .collect::<BTreeSet<_>>();
    let execution_by_query = query_executions
        .iter()
        .map(|execution| (execution.query_id.as_str(), execution))
        .collect::<BTreeMap<_, _>>();
    let mut operation_run_states = BTreeMap::<&str, String>::new();
    let operations = contract
        .semantic
        .operations
        .iter()
        .map(|operation| {
            let applicable = evaluate_workflow_applicability(
                &operation.applicability,
                &semantic_options,
                &present_roles,
            );
            let executions = operation
                .query_ids
                .iter()
                .filter_map(|query_id| execution_by_query.get(query_id).copied())
                .collect::<Vec<_>>();
            let run_state = if !applicable {
                "not_applicable"
            } else if executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Error)
            {
                "error"
            } else {
                // Query execution is physical evidence only. A fused query can
                // realize several operations with different applicability and
                // no-op paths, so it cannot truthfully prove that any one
                // semantic operation was applied. Operation-specific evidence
                // may promote this state in a later protocol; until then the
                // honest state is not observed.
                "not_observed"
            };
            operation_run_states.insert(operation.id, run_state.to_string());
            WorkflowExplorerOperationState {
                operation_id: operation.id.to_string(),
                label: operation.label.to_string(),
                description: operation.description.to_string(),
                phase_id: operation.phase_id.to_string(),
                role: serialized_enum(operation.role),
                epistemic_role: serialized_enum(operation.epistemic_role),
                input_artifact_ids: operation.input_artifacts.clone(),
                output_artifact_ids: operation.output_artifacts.clone(),
                data_effects: operation
                    .data_effects
                    .iter()
                    .map(|effect| serialized_enum(*effect))
                    .collect(),
                applicable,
                run_state: run_state.to_string(),
                off_reason: (!applicable)
                    .then(|| "off because its applicability rule is false".into()),
            }
        })
        .collect::<Vec<_>>();

    let operation_by_id = contract
        .semantic
        .operations
        .iter()
        .map(|operation| (operation.id, operation))
        .collect::<BTreeMap<_, _>>();
    let mut phase_inputs = BTreeMap::<&str, BTreeSet<&str>>::new();
    for operation in &contract.semantic.operations {
        for input in &operation.input_artifacts {
            let Some(artifact) = contract
                .semantic
                .artifacts
                .iter()
                .find(|artifact| artifact.id == *input)
            else {
                continue;
            };
            let Some(producer) = artifact
                .producer_operation_id
                .and_then(|producer| operation_by_id.get(producer))
            else {
                continue;
            };
            if producer.phase_id != operation.phase_id {
                phase_inputs
                    .entry(operation.phase_id)
                    .or_default()
                    .insert(producer.phase_id);
            }
        }
    }
    let phases = contract
        .presentation
        .phases
        .iter()
        .map(|phase| WorkflowExplorerPhaseState {
            phase_id: phase.id.to_string(),
            label: phase.label.to_string(),
            description: phase.description.to_string(),
            display_order: phase.display_order,
            input_phase_ids: phase_inputs
                .get(phase.id)
                .into_iter()
                .flat_map(|inputs| inputs.iter())
                .map(|input| (*input).to_string())
                .collect(),
            applicable: workflow_phase_applicable(
                phase.id,
                contract
                    .semantic
                    .operations
                    .iter()
                    .map(|operation| (operation.phase_id, &operation.applicability)),
                &semantic_options,
                &present_roles,
            ),
        })
        .collect::<Vec<_>>();

    let artifacts = contract
        .semantic
        .artifacts
        .iter()
        .map(|artifact| {
            let run_state = artifact
                .producer_operation_id
                .and_then(|producer| operation_run_states.get(producer))
                .map(|state| match state.as_str() {
                    "not_applicable" => "absent",
                    "error" => "error",
                    _ => "not_observed",
                })
                .unwrap_or("not_observed");
            WorkflowExplorerArtifactState {
                artifact_id: artifact.id.clone(),
                label: artifact.label.clone(),
                kind: serialized_enum(artifact.kind),
                producer_operation_id: artifact.producer_operation_id.map(str::to_string),
                consumer_operation_ids: artifact
                    .consumer_operation_ids
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                run_state: run_state.to_string(),
            }
        })
        .collect::<Vec<_>>();

    let queries = contract
        .execution
        .queries
        .iter()
        .map(|query| {
            let applicable = evaluate_workflow_applicability(
                &query.applicability,
                &semantic_options,
                &present_roles,
            );
            let execution = execution_by_query.get(query.id).copied();
            let (physical_state, reuse_reason) = explorer_query_state(execution);
            WorkflowExplorerQueryState {
                query_id: query.id.to_string(),
                query_group_id: query.group.to_string(),
                input_query_ids: query.inputs.iter().map(|id| (*id).to_string()).collect(),
                operation_ids: query
                    .operation_ids
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                output_artifact_ids: query.output_ports.clone(),
                applicability: if applicable {
                    "applicable"
                } else {
                    "not_applicable"
                }
                .into(),
                physical_state: physical_state.into(),
                reuse_reason,
                checkpoint_source: execution
                    .filter(|execution| execution.status == ExecutionStatus::Cached)
                    .map(|_| "memory_or_persisted_base".into()),
            }
        })
        .collect::<Vec<_>>();

    let mut impacts = BTreeMap::<(String, String), WorkflowExplorerDecisionImpact>::new();
    for query in &contract.execution.queries {
        for field in query.request_fields {
            let impact = impacts
                .entry(("option".into(), (*field).to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: (*field).to_string(),
                    input_kind: "option".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
            impact.direct_query_ids.push(query.id.to_string());
        }
        for role in query.source_roles {
            let impact = impacts
                .entry(("support".into(), (*role).to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: (*role).to_string(),
                    input_kind: "support".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
            impact.direct_query_ids.push(query.id.to_string());
        }
    }
    // Some output encoders live in the runtime rather than a kernel query.
    // Their settings/supports still belong in Decisions even though they have
    // no direct physical query to report.
    for operation in &contract.semantic.operations {
        for dependency in &operation.config_dependencies {
            impacts
                .entry(("option".into(), dependency.field.clone()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: dependency.field.clone(),
                    input_kind: "option".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
        }
        for artifact_id in &operation.input_artifacts {
            let Some(role_id) = artifact_id.strip_prefix("source.") else {
                continue;
            };
            impacts
                .entry(("support".into(), role_id.to_string()))
                .or_insert_with(|| WorkflowExplorerDecisionImpact {
                    input_id: role_id.to_string(),
                    input_kind: "support".into(),
                    direct_query_ids: Vec::new(),
                    affected_operation_ids: Vec::new(),
                    affected_artifact_ids: Vec::new(),
                });
        }
    }
    let mut decisions = impacts.into_values().collect::<Vec<_>>();
    for impact in &mut decisions {
        impact.direct_query_ids.sort();
        impact.direct_query_ids.dedup();
        // Query reachability explains physical cache reconsideration, but it
        // is not the semantic operation graph. Start semantic impact at the
        // operation's own declared option/support dependency, then follow
        // typed artifact consumers. This keeps fused physical queries from
        // falsely making every co-located operation a direct dependency.
        let source_artifact =
            (impact.input_kind == "support").then(|| format!("source.{}", impact.input_id));
        let mut affected_operations = contract
            .semantic
            .operations
            .iter()
            .filter(|operation| {
                if impact.input_kind == "option" {
                    operation
                        .config_dependencies
                        .iter()
                        .any(|dependency| dependency.field == impact.input_id)
                } else {
                    source_artifact
                        .as_ref()
                        .is_some_and(|source| operation.input_artifacts.contains(source))
                }
            })
            .map(|operation| operation.id)
            .collect::<BTreeSet<_>>();
        // Contract operations are topologically ordered, so one forward pass
        // computes the complete downstream closure. Repeating to a fixed point
        // adds no reachability and obscures that ordering guarantee.
        for operation in &contract.semantic.operations {
            if operation
                .input_artifacts
                .iter()
                .filter_map(|input| {
                    contract
                        .semantic
                        .artifacts
                        .iter()
                        .find(|artifact| artifact.id == *input)
                })
                .filter_map(|artifact| artifact.producer_operation_id)
                .any(|producer| affected_operations.contains(producer))
            {
                affected_operations.insert(operation.id);
            }
        }
        for operation_id in affected_operations {
            let operation = operation_by_id[operation_id];
            impact.affected_operation_ids.push(operation_id.to_string());
            impact
                .affected_artifact_ids
                .extend(operation.output_artifacts.clone());
        }
        impact.affected_operation_ids.sort();
        impact.affected_operation_ids.dedup();
        impact.affected_artifact_ids.sort();
        impact.affected_artifact_ids.dedup();
    }
    let selected_run_root = run_root
        .map(str::to_string)
        .or_else(|| request.selected_run_root.clone());
    let planned_root_digest = sha256(
        &serde_jcs::to_vec(&serde_json::json!({
            "protocol": "chronicle-workflow-explorer/v1",
            "workspaceCompatibility": contract.digests.workspace_compatibility,
            "options": request.options,
            "supports": request.support_roles,
            "selectedRunRoot": selected_run_root,
        }))
        .map_err(|error| format!("canonicalize workflow explorer root: {error}"))?,
    );
    let root_digest = run_root.map(str::to_string).unwrap_or(planned_root_digest);
    Ok(WorkflowExplorerView {
        protocol_version: "chronicle-workflow-explorer/v1".into(),
        view_id: "chronicle-workflow-explorer/v1".into(),
        schema_id: "urn:chronicle:view:workflow-explorer:v1".into(),
        revision,
        root_digest,
        selected_run_root,
        contract_digests: contract.digests.clone(),
        phases,
        operations,
        artifacts,
        queries,
        decisions,
    })
}

#[wasm_bindgen]
pub fn plan_workflow_explorer_view_json(request_json: &str) -> Result<String, JsValue> {
    plan_workflow_explorer_view_native(request_json).map_err(|error| JsValue::from_str(&error))
}

pub fn plan_workflow_explorer_view_native(request_json: &str) -> Result<String, String> {
    let request: WorkflowExplorerRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("invalid workflow-explorer request: {error}"))?;
    serde_json::to_string(&build_workflow_explorer_view(&request, &[], 0, None)?)
        .map_err(|error| format!("serialize workflow explorer view: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MethodProfileBindingReceipt {
    pub setting_id: String,
    pub slot: String,
    pub value: Value,
    pub conformance_fixture_id: String,
    pub conformance_result_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MethodProfileDocumentaryBindingReceipt {
    pub setting_id: String,
    pub registry_input: Value,
    pub conformance_fixture_id: String,
    pub conformance_result_digest: String,
    pub execution_eligible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MethodProfileOutputBindingReceipt {
    pub setting_id: String,
    pub output_kind: String,
    pub source_field: String,
    pub source_position: usize,
    pub canonical_field: String,
    pub conformance_fixture_id: String,
    pub conformance_result_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MethodProfileReceipt {
    pub method_profile_id: String,
    pub source_work_id: String,
    pub source_method_variant_id: String,
    pub source_method_variant_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_method_combination_id: Option<String>,
    pub method_profile_version: String,
    pub setting_ids: Vec<String>,
    pub bindings: Vec<MethodProfileBindingReceipt>,
    #[serde(default)]
    pub input_bindings: Vec<MethodProfileInputBindingReceipt>,
    #[serde(default)]
    pub documentary_bindings: Vec<MethodProfileDocumentaryBindingReceipt>,
    #[serde(default)]
    pub output_bindings: Vec<MethodProfileOutputBindingReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diary_replication_binding: Option<DiaryReplicationBindingReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRequest {
    pub protocol_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_root_digest: Option<String>,
    pub workspace_id: String,
    pub input_file_name: String,
    pub input_sha256: String,
    /// Review-summary digests the caller already holds (ETag semantics).
    /// When a review request recomputes a summary whose digest is in this
    /// list, the runtime returns the manifest with `review_summary_reused:
    /// true` and no artifact bytes, so the caller keeps its cached copy
    /// instead of re-receiving 2+ MB. A list (not a single digest) because
    /// the interactive comparison loop toggles A -> B -> A: the caller holds
    /// a small LRU of recent summaries, and any of them can match.
    #[serde(default)]
    pub known_review_summary_digests: Option<Vec<String>>,
    /// Ephemeral worker-owned inspection batch and sorted opaque participant
    /// tokens. Literal participant IDs never cross this boundary. These
    /// transport facts remain separate from the exact options JCS.
    #[serde(default)]
    pub participant_partition_batch_id: Option<Sha256Digest>,
    #[serde(default)]
    pub fragmented_participant_tokens: Vec<Sha256Digest>,
    #[serde(default)]
    pub method_profile_receipt: Option<MethodProfileReceipt>,
    #[serde(default)]
    pub method_profile_receipts: Vec<MethodProfileReceipt>,
    /// Which scheduler runs the registry. `sequential` (the default) runs
    /// every query from the raw bytes on each request, keeps no memo, and
    /// exports no base; `incremental` (opt-in, and the engine the campaigns
    /// request explicitly) memoizes tracked queries in the worker and exports
    /// resume bases.
    #[serde(default)]
    pub execution_engine: ExecutionEngine,
    /// Build the source-coordinate index, result-cell correspondence and
    /// source-result influence witness. `false` (the default) never runs
    /// their builders; `row-lineage-arrow` and every researcher output are
    /// built either way. Campaigns request them explicitly.
    #[serde(default)]
    pub provenance_evidence: bool,
    pub options: PipelineV2OptionsJson,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionEngine {
    Incremental,
    #[default]
    Sequential,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenerSetPreflightStatus {
    Executable,
    Refused,
}

/// Configuration-only applicability decision for the B02 opener-set axis.
///
/// The requested id is retained verbatim for stale-client diagnostics while
/// the resolved and effective ids expose the exact safe-fallback semantics the
/// kernel will execute. `options_digest` is produced by the same canonical
/// receipt function used by execution, so callers can bind preflight to a
/// subsequently returned manifest without trusting a second implementation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerSetPreflightDecision {
    pub status: OpenerSetPreflightStatus,
    pub requested_opener_set_id: String,
    pub resolved_opener_set_id: String,
    pub effective_opener_set_id: Option<String>,
    pub relation: OpenerStrategyRelation,
    pub reason_code: Option<String>,
    pub options_digest: Sha256Digest,
}

/// Compact, runtime-owned projection of the kernel's potentially large B05
/// and Schoedel preflight. Full interval and episode evidence is committed by
/// digest here and published separately after execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeB05SchoedelPreflightReceipt {
    pub protocol_version: String,
    pub disposition: ScientificPreflightDisposition,
    pub options_digest: Sha256Digest,
    pub component_options_digest: Sha256Digest,
    pub screen_component_options_digest: Sha256Digest,
    pub schoedel_component_options_digest: Sha256Digest,
    pub options_digest_origin: B05OptionsDigestOrigin,
    pub requested_screen_strategy_id: ScreenSessionConstructionStrategyId,
    pub effective_screen_strategy_id: ScreenSessionConstructionStrategyId,
    pub requested_episode_strategy_id: String,
    pub effective_episode_strategy_id: Option<String>,
    pub screen_construction_phase: B05ComputationPhase,
    pub schoedel_reconstruction_phase: B05ComputationPhase,
    pub screen_applicability: Option<RuntimeB05ApplicabilityProjection>,
    pub schoedel_applicability: Option<RuntimeSchoedelApplicabilityProjection>,
}

/// Closed, PHI-safe replacement for the kernel's free-form B05 refusal
/// detail. The kernel receipt can include a literal participant identifier in
/// that string, so the runtime never serializes or hashes the free-form value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeB05RefusalDetail {
    CapabilityEvidenceAbsent,
    CapabilityEvidenceNotBoundToInput,
    ParticipantScopeUndetermined,
    MultipleDeviceStreamsAliased,
    DeviceStreamScopeUnknown,
    CombinedEventRepresentation,
    SourceStreamIncomplete,
    SourceStreamCompletenessUnknown,
    SourceOrderNotPreserved,
    SourceOrderUnknown,
    ParticipantStreamFragmented,
    InputChunkStatusUnknown,
    MissingRequiredSignal,
    RequiredSignalCapabilityUnknown,
    UnorderableFullStreamRow,
    NonMonotonicSourceTimestamps,
    AmbiguousEqualTimestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeB05ApplicabilityProjection {
    pub protocol_version: String,
    pub relation: ScientificRelation,
    pub executable: bool,
    pub refusal_reason: Option<B05RefusalReason>,
    pub refusal_detail: Option<RuntimeB05RefusalDetail>,
}

/// Schoedel refusal details are likewise projected into a closed domain. This
/// prevents future kernel detail text from accidentally widening the public
/// preflight boundary to participant labels or source rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSchoedelRefusalDetail {
    AmbiguousEqualTimestamp,
    UnorderableFullStreamRow,
    InvalidScreenIntervalDependency,
    FullOsfPrerequisitesUnavailable,
    CapabilityEvidenceNotBoundToInput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSchoedelApplicabilityProjection {
    pub protocol_version: String,
    pub relation: ScientificRelation,
    pub executable: bool,
    pub refusal_reason: Option<SchoedelRefusalReason>,
    pub refusal_detail: Option<RuntimeSchoedelRefusalDetail>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActiveIngressRoleIdentity {
    pub artifact_digest: Sha256Digest,
    pub assignment_id: Sha256Digest,
}

/// PHI-safe scientific-input identity. Fragmented participant identities stay
/// private; the public commitment is over batch-scoped opaque browser tokens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeScientificPreflightKey {
    pub protocol_version: String,
    pub options_digest: Sha256Digest,
    pub input_digest: Sha256Digest,
    pub input_size_bytes: u64,
    pub active_ingress_roles: BTreeMap<String, RuntimeActiveIngressRoleIdentity>,
    pub fragmented_participant_count: u32,
    pub fragmented_participant_token_scope_digest: Sha256Digest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeScientificPreflightReceipt {
    pub protocol_version: String,
    pub key: RuntimeScientificPreflightKey,
    pub key_digest: Sha256Digest,
    pub b05_schoedel: RuntimeB05SchoedelPreflightReceipt,
    pub b05_schoedel_digest: Sha256Digest,
    pub eyes_input_partition: EyesInputPartitionPreflightResult,
    pub eyes_input_partition_digest: Sha256Digest,
    pub commit_digest: Sha256Digest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScientificPreflightCommitMaterial<'a> {
    protocol_version: &'static str,
    key_digest: &'a str,
    b05_schoedel_digest: &'a str,
    eyes_input_partition_digest: &'a str,
}


fn jcs_digest(value: &impl Serialize, label: &str) -> Result<Sha256Digest, String> {
    serde_jcs::to_vec(value)
        .map(|bytes| sha256(&bytes))
        .map_err(|error| format!("canonicalize {label}: {error}"))
}

fn runtime_b05_refusal_detail(
    applicability: &B05ApplicabilityReceiptV1,
) -> Option<RuntimeB05RefusalDetail> {
    // Presence still comes from the kernel-owned detail. Its contents never
    // cross this boundary because the unsupported-chunk branch embeds a raw
    // participant identifier before its stable detail suffix.
    applicability.refusal_detail.as_ref()?;
    applicability.refusal_reason.map(|reason| match reason {
        B05RefusalReason::InputCapabilityEvidenceAbsent => {
            RuntimeB05RefusalDetail::CapabilityEvidenceAbsent
        }
        B05RefusalReason::CapabilityEvidenceNotBoundToInput => {
            RuntimeB05RefusalDetail::CapabilityEvidenceNotBoundToInput
        }
        B05RefusalReason::ParticipantScopeUndetermined => {
            RuntimeB05RefusalDetail::ParticipantScopeUndetermined
        }
        B05RefusalReason::MultipleDeviceStreamsAliased => {
            RuntimeB05RefusalDetail::MultipleDeviceStreamsAliased
        }
        B05RefusalReason::DeviceStreamScopeUnknown => {
            RuntimeB05RefusalDetail::DeviceStreamScopeUnknown
        }
        B05RefusalReason::CombinedEventRepresentation => {
            RuntimeB05RefusalDetail::CombinedEventRepresentation
        }
        B05RefusalReason::SourceStreamIncomplete => RuntimeB05RefusalDetail::SourceStreamIncomplete,
        B05RefusalReason::SourceStreamCompletenessUnknown => {
            RuntimeB05RefusalDetail::SourceStreamCompletenessUnknown
        }
        B05RefusalReason::SourceOrderNotPreserved => {
            RuntimeB05RefusalDetail::SourceOrderNotPreserved
        }
        B05RefusalReason::SourceOrderUnknown => RuntimeB05RefusalDetail::SourceOrderUnknown,
        B05RefusalReason::UnsupportedInputChunk => {
            RuntimeB05RefusalDetail::ParticipantStreamFragmented
        }
        B05RefusalReason::InputChunkStatusUnknown => {
            RuntimeB05RefusalDetail::InputChunkStatusUnknown
        }
        B05RefusalReason::MissingRequiredSignal => RuntimeB05RefusalDetail::MissingRequiredSignal,
        B05RefusalReason::RequiredSignalCapabilityUnknown => {
            RuntimeB05RefusalDetail::RequiredSignalCapabilityUnknown
        }
        B05RefusalReason::UnorderableFullStreamRow => {
            RuntimeB05RefusalDetail::UnorderableFullStreamRow
        }
        B05RefusalReason::NonMonotonicSourceTimestamps => {
            RuntimeB05RefusalDetail::NonMonotonicSourceTimestamps
        }
        B05RefusalReason::AmbiguousEqualTimestamp => {
            RuntimeB05RefusalDetail::AmbiguousEqualTimestamp
        }
    })
}

fn runtime_b05_applicability(
    applicability: &B05ApplicabilityReceiptV1,
) -> RuntimeB05ApplicabilityProjection {
    RuntimeB05ApplicabilityProjection {
        protocol_version: applicability.protocol_version.clone(),
        relation: applicability.relation,
        executable: applicability.executable,
        refusal_reason: applicability.refusal_reason,
        refusal_detail: runtime_b05_refusal_detail(applicability),
    }
}

fn runtime_schoedel_refusal_detail(
    applicability: &SchoedelApplicabilityReceiptV1,
) -> Option<RuntimeSchoedelRefusalDetail> {
    applicability.refusal_detail.as_ref()?;
    applicability.refusal_reason.map(|reason| match reason {
        SchoedelRefusalReason::AmbiguousEqualTimestamp => {
            RuntimeSchoedelRefusalDetail::AmbiguousEqualTimestamp
        }
        SchoedelRefusalReason::UnorderableAppRow => {
            RuntimeSchoedelRefusalDetail::UnorderableFullStreamRow
        }
        SchoedelRefusalReason::InvalidScreenIntervalDependency => {
            RuntimeSchoedelRefusalDetail::InvalidScreenIntervalDependency
        }
        SchoedelRefusalReason::SchoedelFullOsfMissingPrerequisites => {
            RuntimeSchoedelRefusalDetail::FullOsfPrerequisitesUnavailable
        }
        SchoedelRefusalReason::CapabilityEvidenceNotBoundToInput => {
            RuntimeSchoedelRefusalDetail::CapabilityEvidenceNotBoundToInput
        }
    })
}

fn runtime_schoedel_applicability(
    applicability: &SchoedelApplicabilityReceiptV1,
) -> RuntimeSchoedelApplicabilityProjection {
    RuntimeSchoedelApplicabilityProjection {
        protocol_version: applicability.protocol_version.clone(),
        relation: applicability.relation,
        executable: applicability.executable,
        refusal_reason: applicability.refusal_reason,
        refusal_detail: runtime_schoedel_refusal_detail(applicability),
    }
}

fn compact_b05_schoedel_preflight(
    preflight: &B05SchoedelPreflightResult,
) -> Result<RuntimeB05SchoedelPreflightReceipt, String> {
    Ok(RuntimeB05SchoedelPreflightReceipt {
        protocol_version: preflight.protocol_version.clone(),
        disposition: preflight.disposition,
        options_digest: preflight.options_digest.clone(),
        component_options_digest: preflight.component_options_digest.clone(),
        screen_component_options_digest: preflight.screen_component_options_digest.clone(),
        schoedel_component_options_digest: preflight.schoedel_component_options_digest.clone(),
        options_digest_origin: preflight.options_digest_origin,
        requested_screen_strategy_id: preflight.requested_screen_strategy_id,
        effective_screen_strategy_id: preflight.effective_screen_strategy_id,
        requested_episode_strategy_id: preflight.requested_episode_strategy_id.clone(),
        effective_episode_strategy_id: preflight.effective_episode_strategy_id.clone(),
        screen_construction_phase: preflight.screen_construction_phase,
        schoedel_reconstruction_phase: preflight.schoedel_reconstruction_phase,
        screen_applicability: preflight
            .screen_construction
            .as_ref()
            .map(|output| runtime_b05_applicability(&output.applicability)),
        schoedel_applicability: preflight
            .schoedel_reconstruction
            .as_ref()
            .map(|output| runtime_schoedel_applicability(&output.applicability)),
    })
}

fn fragmented_participant_token_scope_digest(
    fragmented_participant_tokens: &[Sha256Digest],
) -> Result<Sha256Digest, String> {
    jcs_digest(
        &fragmented_participant_tokens
            .iter()
            .collect::<BTreeSet<_>>(),
        "batch-scoped fragmented participant token scope",
    )
}

fn scientific_preflight_key(
    prepared: &PreparedRuntimeWorkspace,
) -> Result<RuntimeScientificPreflightKey, String> {
    let active_ingress_roles = prepared
        .ingress
        .assignments
        .iter()
        .map(|(role, assignment)| {
            (
                role.clone(),
                RuntimeActiveIngressRoleIdentity {
                    artifact_digest: assignment.artifact.digest.clone(),
                    assignment_id: assignment.assignment_id.clone(),
                },
            )
        })
        .collect();
    let (input_digest, input_size_bytes) = prepared
        .literature_input
        .as_ref()
        .filter(|adapted| receipt_is_kernel_input_eligible(&adapted.receipt))
        .map(|adapted| {
            (
                adapted.receipt.adapted_input_digest.clone(),
                adapted.csv_bytes.len() as u64,
            )
        })
        .unwrap_or_else(|| {
            (
                prepared.ingress.input.digest.clone(),
                prepared.ingress.input.size,
            )
        });
    Ok(RuntimeScientificPreflightKey {
        protocol_version: SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION.into(),
        options_digest: prepared.options_digest.clone(),
        input_digest,
        input_size_bytes,
        active_ingress_roles,
        fragmented_participant_count: prepared.fragmented_participant_ids.len() as u32,
        fragmented_participant_token_scope_digest: fragmented_participant_token_scope_digest(
            &prepared.request.fragmented_participant_tokens,
        )?,
    })
}

fn build_scientific_preflight_receipt(
    key: RuntimeScientificPreflightKey,
    // The kernel binds the computation options digest (exact options minus
    // artifact-only fields) into its receipts, while the key keeps the full
    // exact-options digest as the preflight-commit identity. The caller passes
    // the digest it actually handed the kernel so this cross-check compares
    // like with like.
    expected_kernel_options_digest: &str,
    b05_schoedel: &B05SchoedelPreflightResult,
    eyes_input_partition: EyesInputPartitionPreflightResult,
) -> Result<RuntimeScientificPreflightReceipt, String> {
    if b05_schoedel.options_digest != expected_kernel_options_digest
        || eyes_input_partition.options_digest != expected_kernel_options_digest
        || eyes_input_partition.input_digest != key.input_digest
        || eyes_input_partition.fragmented_participant_count != key.fragmented_participant_count
    {
        return Err("scientific preflight identity disagrees with runtime ingress".into());
    }
    let b05_schoedel = compact_b05_schoedel_preflight(b05_schoedel)?;
    let key_digest = jcs_digest(&key, "scientific preflight key")?;
    let b05_schoedel_digest = jcs_digest(&b05_schoedel, "compact B05/Schoedel preflight")?;
    let eyes_input_partition_digest =
        jcs_digest(&eyes_input_partition, "EYES input-partition preflight")?;
    let commit_digest = jcs_digest(
        &ScientificPreflightCommitMaterial {
            protocol_version: SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION,
            key_digest: &key_digest,
            b05_schoedel_digest: &b05_schoedel_digest,
            eyes_input_partition_digest: &eyes_input_partition_digest,
        },
        "scientific preflight commit",
    )?;
    Ok(RuntimeScientificPreflightReceipt {
        protocol_version: SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION.into(),
        key,
        key_digest,
        b05_schoedel,
        b05_schoedel_digest,
        eyes_input_partition,
        eyes_input_partition_digest,
        commit_digest,
    })
}

fn validate_scientific_preflight_receipt_integrity(
    receipt: &RuntimeScientificPreflightReceipt,
) -> Result<(), String> {
    if receipt.protocol_version != SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION
        || receipt.key.protocol_version != SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION
    {
        return Err("scientific preflight protocol mismatch".into());
    }
    let key_digest = jcs_digest(&receipt.key, "scientific preflight key")?;
    let b05_schoedel_digest = jcs_digest(&receipt.b05_schoedel, "compact B05/Schoedel preflight")?;
    let eyes_input_partition_digest = jcs_digest(
        &receipt.eyes_input_partition,
        "EYES input-partition preflight",
    )?;
    let commit_digest = jcs_digest(
        &ScientificPreflightCommitMaterial {
            protocol_version: SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION,
            key_digest: &key_digest,
            b05_schoedel_digest: &b05_schoedel_digest,
            eyes_input_partition_digest: &eyes_input_partition_digest,
        },
        "scientific preflight commit",
    )?;
    if key_digest != receipt.key_digest
        || b05_schoedel_digest != receipt.b05_schoedel_digest
        || eyes_input_partition_digest != receipt.eyes_input_partition_digest
        || commit_digest != receipt.commit_digest
    {
        return Err("scientific preflight commit integrity mismatch".into());
    }
    Ok(())
}

fn validate_pending_scientific_preflight(
    pending: &PendingScientificPreflightCommit,
    expected_key: &RuntimeScientificPreflightKey,
    request: &RuntimeRequest,
    fragmented_participant_ids: &[String],
) -> Result<(), String> {
    validate_scientific_preflight_receipt_integrity(&pending.receipt)?;
    if compact_b05_schoedel_preflight(&pending.exact_b05_schoedel)? != pending.receipt.b05_schoedel
        || pending.receipt.key != *expected_key
        || pending.participant_partition_batch_id != request.participant_partition_batch_id
        || pending.fragmented_participant_tokens != request.fragmented_participant_tokens
        || pending.fragmented_participant_ids != fragmented_participant_ids
        || pending.receipt.key.fragmented_participant_count
            != fragmented_participant_ids.len() as u32
        || pending
            .receipt
            .key
            .fragmented_participant_token_scope_digest
            != fragmented_participant_token_scope_digest(&request.fragmented_participant_tokens)?
    {
        return Err("scientific preflight does not match the exact prepared workspace".into());
    }
    Ok(())
}

/// Accept a persisted base's preflight as this request's scientific
/// authorization, or fail closed.
///
/// Every check a live preflight passes is repeated here except the two that
/// cannot exist without raw bytes: the physical re-run on the engine, and the
/// batch-scoped token/id witness, which is private transport the bases
/// deliberately do not store.
///
/// What replaces them is MEASUREMENT identity, not request identity. The key's
/// `options_digest` is the full exact-options digest, which moves when a purely
/// artifact-only field such as `enable_spss_export` is flipped — that is a
/// different request but the same measurement, and refusing it would leave the
/// raw-less resume dead for the reason issue #6 names. Two key fields are
/// therefore not compared byte-for-byte: `options_digest` itself, and the
/// `processing_options` ingress artifact, which is that same options document
/// under another digest. Both are replaced by the computation projection the
/// kernel actually bound into these receipts. Every other key field, including
/// the raw input artifact, the set of active roles, and the participant
/// partition scope, is compared exactly.
///
/// The adoption is not the final word: `validate_b05_schoedel_finalization` and
/// `validate_eyes_input_partition_finalization` still compare this receipt
/// against what the run produces, so an adoption that was wrong fails the run
/// rather than publishing a mismatched receipt.
fn adopt_persisted_scientific_preflight(
    persisted: &PersistedScientificPreflight,
    expected_key: &RuntimeScientificPreflightKey,
    computation_options_digest: &str,
    request: &RuntimeRequest,
    fragmented_participant_ids: &[String],
    options: &PipelineV2Options,
) -> Result<Option<PendingScientificPreflightCommit>, String> {
    validate_scientific_preflight_receipt_integrity(&persisted.receipt)?;
    let key = &persisted.receipt.key;
    // The `processing_options` ingress artifact IS the serialized full options
    // document, so its digest moves for an artifact-only flip exactly as the
    // key's `options_digest` does. Comparing it would re-impose the request
    // identity this function is deliberately not gating on. Its
    // measurement-relevant content is the computation projection compared
    // below, so drop it from the identity comparison — but still require the
    // same set of roles, since a role appearing or disappearing is a different
    // input even when every surviving role is byte-identical.
    let data_ingress_roles = |roles: &BTreeMap<String, RuntimeActiveIngressRoleIdentity>| {
        roles
            .iter()
            .filter(|(role, _)| role.as_str() != "processing_options")
            .map(|(role, identity)| (role.clone(), identity.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    // Split deliberately. A base whose stored receipt disagrees with the
    // preflight stored beside it is CORRUPT: no amount of raw bytes makes that
    // base trustworthy, so it fails hard and by its own name.
    if compact_b05_schoedel_preflight(&persisted.exact_b05_schoedel)?
        != persisted.receipt.b05_schoedel
    {
        return Err(
            "persisted scientific preflight receipt does not match its own preflight".into(),
        );
    }
    // Everything below is measurement IDENTITY, not integrity. A base written
    // for a different measurement is exactly as unusable as a base carrying no
    // commitment at all -- and that case, a few lines up in
    // `execute_incremental_pipeline`, returns
    // `SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR` so the caller re-runs from the raw
    // file. Reporting this case under a bespoke message instead made the whole
    // request fail: `queryPersistedRustReview` treats
    // `scientific_preflight_retry_required` as a persisted-review miss and
    // falls back to the raw path, and treats every other error as a hard
    // failure. An A/B comparison moves a computation option by definition, so
    // the raw-less arm of every comparison surfaced
    // "persisted scientific preflight does not match this measurement" instead
    // of quietly re-running with bytes. Fail closed the way the missing-base
    // path already does.
    // The protocol_version term is unreachable today: the integrity check
    // above already hard-fails any version other than the current constant,
    // and a base from an OLDER protocol is dropped earlier still, because
    // `persisted_base_runtime_identity` binds IMPLEMENTATION_BUILD_DIGEST,
    // which necessarily moves when the protocol source constant does. That
    // second guard is accidental: if the protocol version ever becomes
    // data-driven, or the identity stops binding the implementation digest,
    // an old-protocol base is STALENESS (this retry arm), not corruption --
    // keep the term here so it degrades to raw instead of hard-failing.
    if key.protocol_version != expected_key.protocol_version
        || key.input_digest != expected_key.input_digest
        || key.input_size_bytes != expected_key.input_size_bytes
        || key.active_ingress_roles.keys().collect::<Vec<_>>()
            != expected_key.active_ingress_roles.keys().collect::<Vec<_>>()
        || data_ingress_roles(&key.active_ingress_roles)
            != data_ingress_roles(&expected_key.active_ingress_roles)
        || key.fragmented_participant_count != expected_key.fragmented_participant_count
        || key.fragmented_participant_token_scope_digest
            != expected_key.fragmented_participant_token_scope_digest
        || persisted.receipt.b05_schoedel.options_digest != computation_options_digest
        || persisted.receipt.eyes_input_partition.options_digest != computation_options_digest
        || key.fragmented_participant_count != fragmented_participant_ids.len() as u32
        || key.fragmented_participant_token_scope_digest
            != fragmented_participant_token_scope_digest(&request.fragmented_participant_tokens)?
    {
        return Err(SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR.into());
    }
    if !scientific_preflight_is_executable(options, &persisted.receipt) {
        return Err("persisted scientific preflight is not executable".into());
    }
    Ok(Some(PendingScientificPreflightCommit {
        receipt: persisted.receipt.clone(),
        exact_b05_schoedel: persisted.exact_b05_schoedel.clone(),
        participant_partition_batch_id: request.participant_partition_batch_id.clone(),
        fragmented_participant_tokens: request.fragmented_participant_tokens.clone(),
        fragmented_participant_ids: fragmented_participant_ids.to_vec(),
        // Adoption executes nothing: the physical work this receipt describes
        // was done by the run that wrote the base, and its results are already
        // inside that base.
        executed_queries: Vec::new(),
    }))
}







fn requires_live_scientific_preflight(options: &PipelineV2Options) -> bool {
    b05_schoedel_is_active(options) || eyes_complement_is_active(options)
}

fn scientific_preflight_is_executable(
    options: &PipelineV2Options,
    receipt: &RuntimeScientificPreflightReceipt,
) -> bool {
    if !requires_live_scientific_preflight(options) {
        return false;
    }
    let b05_required = b05_schoedel_is_active(options);
    let eyes_required = eyes_complement_is_active(options);
    (!b05_required
        || receipt.b05_schoedel.disposition == ScientificPreflightDisposition::Executable)
        && (!eyes_required
            || receipt.eyes_input_partition.disposition
                == ScientificPreflightDisposition::Executable)
}

fn method_profile_json_equal(left: &Value, right: &Value) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}

const APPLICATION_LABEL_FIXTURE_ID: &str = "extension.application-label-exclusion.v1";
const APPLICATION_LABEL_FIXTURE_DIGEST: &str =
    "sha256:003dbfa335b8b68fbece41d1f85fd8b7f481158c0417d5c7e3b43a71eb660345";
const APPLICATION_LABEL_SETTING_IDS: [&str; 2] = [
    "method-setting-3f07e9131d5492926afe8c63",
    "method-setting-6945d62974714b285e78cca0",
];

fn validate_application_label_binding_registry(
    receipt: &MethodProfileReceipt,
) -> Result<(), String> {
    let special_slots = ["filter_match_field", "application_label_exclusions"];
    let relevant = receipt.bindings.iter().filter(|binding| {
        binding.conformance_fixture_id == APPLICATION_LABEL_FIXTURE_ID
            || special_slots.contains(&binding.slot.as_str())
    });
    if relevant.clone().next().is_none() {
        return Ok(());
    }
    let setting_ids = receipt
        .setting_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if !APPLICATION_LABEL_SETTING_IDS
        .iter()
        .all(|setting_id| setting_ids.contains(setting_id))
    {
        return Err("application-label source receipt requires both registered setting IDs".into());
    }
    for binding in relevant {
        if !APPLICATION_LABEL_SETTING_IDS.contains(&binding.setting_id.as_str())
            || binding.conformance_fixture_id != APPLICATION_LABEL_FIXTURE_ID
            || binding.conformance_result_digest != APPLICATION_LABEL_FIXTURE_DIGEST
        {
            return Err(
                "application-label source receipt contains an unregistered identity tuple".into(),
            );
        }
        let expected = match binding.slot.as_str() {
            "filter_match_field" => serde_json::json!("application_label"),
            "application_label_exclusions" => {
                serde_json::json!(["YouTube Vanced", "Basic Daydreams"])
            }
            _ => {
                return Err("application-label source receipt contains an unregistered slot".into())
            }
        };
        if binding.value != expected {
            return Err("application-label source receipt contains an unregistered value".into());
        }
    }
    for setting_id in APPLICATION_LABEL_SETTING_IDS {
        for slot in special_slots {
            if receipt
                .bindings
                .iter()
                .filter(|binding| {
                    binding.setting_id == setting_id
                        && binding.slot == slot
                        && binding.conformance_fixture_id == APPLICATION_LABEL_FIXTURE_ID
                        && binding.conformance_result_digest == APPLICATION_LABEL_FIXTURE_DIGEST
                })
                .count()
                != 1
            {
                return Err("application-label source receipt must bind each registered setting exactly once per slot".into());
            }
        }
    }
    Ok(())
}

impl MethodProfileReceipt {
    fn validate_against(&self, options: &PipelineV2OptionsJson) -> Result<(), String> {
        self.validate_against_with_android_admission(
            options,
            android_method_profile_registry::CanonicalReceiptAdmission::CompletedProofRequired,
        )
    }

    fn validate_against_with_android_admission(
        &self,
        options: &PipelineV2OptionsJson,
        admission: android_method_profile_registry::CanonicalReceiptAdmission,
    ) -> Result<(), String> {
        #[cfg(test)]
        let _ = admission;
        if self.method_profile_id.trim().is_empty()
            || self.source_work_id.trim().is_empty()
            || self.source_method_variant_id.trim().is_empty()
            || self.method_profile_version.trim().is_empty()
        {
            return Err("methodProfileReceipt identities are required".into());
        }
        let source_method_variant_ids = self
            .source_method_variant_ids
            .iter()
            .collect::<BTreeSet<_>>();
        if source_method_variant_ids.len() != self.source_method_variant_ids.len()
            || source_method_variant_ids.is_empty()
            || source_method_variant_ids
                .iter()
                .any(|variant_id| variant_id.trim().is_empty())
        {
            return Err(
                "methodProfileReceipt sourceMethodVariantIds must be non-empty and unique".into(),
            );
        }
        if self
            .source_method_combination_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty())
        {
            return Err("methodProfileReceipt sourceMethodCombinationId must be non-empty".into());
        }
        if self.diary_replication_binding.is_some()
            && (self.source_method_combination_id.is_some()
                || self.source_method_variant_ids.len() != 1
                || self.source_method_variant_ids[0] != self.source_method_variant_id)
        {
            return Err(
                "sleep-diary methodProfileReceipt sourceMethodVariantIds must exactly match its registered source variant"
                    .into(),
            );
        }
        let setting_ids = self.setting_ids.iter().collect::<BTreeSet<_>>();
        if setting_ids.len() != self.setting_ids.len()
            || setting_ids
                .iter()
                .any(|setting_id| setting_id.trim().is_empty())
        {
            return Err("methodProfileReceipt settingIds must be non-empty and unique".into());
        }
        validate_application_label_binding_registry(self)?;
        validate_input_bindings_for_source(
            &self.input_bindings,
            Some(&self.source_work_id),
            Some(&self.source_method_variant_id),
        )?;
        android_method_profile_registry::validate_output_bindings(
            self,
            options.include_app_output,
            options.include_screen_output,
        )?;
        let mut documentary_ids = BTreeSet::new();
        for binding in &self.documentary_bindings {
            if !documentary_ids.insert(&binding.setting_id) {
                return Err("methodProfileReceipt documentary setting IDs must be unique".into());
            }
            if !android_method_profile_registry::validate_protocol_documentary_binding(
                &self.method_profile_id,
                &self.source_work_id,
                &self.source_method_variant_id,
                &self.method_profile_version,
                &binding.setting_id,
                &binding.registry_input,
                &binding.conformance_fixture_id,
                &binding.conformance_result_digest,
                binding.execution_eligible,
            )? {
                source_artifact_provenance_registry::validate_documentary_binding(
                    &self.method_profile_id,
                    &self.source_work_id,
                    &self.source_method_variant_id,
                    &self.method_profile_version,
                    &binding.setting_id,
                    &binding.registry_input,
                    &binding.conformance_fixture_id,
                    &binding.conformance_result_digest,
                    binding.execution_eligible,
                )?;
            }
        }
        if let Some(binding) = &self.diary_replication_binding {
            validate_sleep_diary_binding(binding)?;
            validate_sleep_diary_receipt_identity(
                &self.method_profile_id,
                &self.source_work_id,
                &self.source_method_variant_id,
                &self.method_profile_version,
                binding,
            )?;
        }
        #[cfg(not(test))]
        if self.diary_replication_binding.is_none() {
            match admission {
                android_method_profile_registry::CanonicalReceiptAdmission::CompletedProofRequired => {
                    android_method_profile_registry::validate_receipt(self)?;
                }
                android_method_profile_registry::CanonicalReceiptAdmission::ConformanceAttempt => {
                    android_method_profile_registry::validate_receipt_for_conformance_attempt(self)?;
                }
            }
        }
        let binding_setting_ids = self
            .bindings
            .iter()
            .map(|binding| &binding.setting_id)
            .chain(
                self.input_bindings
                    .iter()
                    .map(|binding| &binding.setting_id),
            )
            .chain(
                self.diary_replication_binding
                    .iter()
                    .map(|binding| &binding.setting_id),
            )
            .chain(
                self.documentary_bindings
                    .iter()
                    .map(|binding| &binding.setting_id),
            )
            .chain(
                self.output_bindings
                    .iter()
                    .map(|binding| &binding.setting_id),
            )
            .collect::<BTreeSet<_>>();
        if setting_ids != binding_setting_ids {
            return Err(
                "methodProfileReceipt settingIds must exactly equal bound setting IDs".into(),
            );
        }
        let exact_options = semantic_options_value(options)?;
        let exact_options = exact_options
            .as_object()
            .ok_or_else(|| "serialized runtime options are not an object".to_string())?;
        let mut bound_slots: BTreeMap<&str, &Value> = BTreeMap::new();
        for binding in &self.bindings {
            if binding.slot.trim().is_empty() {
                return Err("methodProfileReceipt binding slot is required".into());
            }
            if binding.conformance_fixture_id.trim().is_empty()
                || !binding
                    .conformance_result_digest
                    .strip_prefix("sha256:")
                    .is_some_and(|digest| {
                        digest.len() == 64
                            && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
                            && digest == digest.to_ascii_lowercase()
                    })
            {
                return Err(
                    "methodProfileReceipt binding conformance fixture and lowercase SHA-256 result are required"
                        .into(),
                );
            }
            let actual = exact_options.get(&binding.slot).ok_or_else(|| {
                format!(
                    "methodProfileReceipt slot cannot be verified at the runtime boundary: {}",
                    binding.slot
                )
            })?;
            if !method_profile_json_equal(actual, &binding.value) {
                return Err(format!(
                    "methodProfileReceipt binding disagrees with runtime option: {}",
                    binding.slot
                ));
            }
            if let Some(previous) = bound_slots.insert(&binding.slot, &binding.value) {
                if !method_profile_json_equal(previous, &binding.value) {
                    return Err(format!(
                        "methodProfileReceipt contains conflicting values for slot: {}",
                        binding.slot
                    ));
                }
            }
        }
        Ok(())
    }
}

impl RuntimeRequest {
    fn active_method_profile_receipts(&self) -> Result<Vec<&MethodProfileReceipt>, String> {
        if self.method_profile_receipt.is_some() && !self.method_profile_receipts.is_empty() {
            return Err(
                "request cannot contain both methodProfileReceipt and methodProfileReceipts".into(),
            );
        }
        let receipts = self
            .method_profile_receipts
            .iter()
            .chain(self.method_profile_receipt.iter())
            .collect::<Vec<_>>();
        if receipts.len() > 2 {
            return Err(
                "request supports at most one Android and one sleep-diary method profile receipt"
                    .into(),
            );
        }
        let mut kinds = BTreeSet::new();
        for receipt in &receipts {
            let kind = if receipt.diary_replication_binding.is_some() {
                "sleep-diary"
            } else {
                "android"
            };
            if !kinds.insert(kind) {
                return Err(format!(
                    "request contains duplicate {kind} method profile receipts"
                ));
            }
        }
        Ok(receipts)
    }

    /// Every request-level check, with a complete B06 judgement. Execution
    /// and review paths use this.
    fn validate_fields(&self) -> Result<(), String> {
        self.validate_fields_with(MaximumDurationValidation::Complete)
    }

    /// Request-level validation with an explicit B06 scope; see
    /// `MaximumDurationValidation` for which preflight uses which.
    fn validate_fields_with(
        &self,
        maximum_duration: MaximumDurationValidation,
    ) -> Result<(), String> {
        self.validate_fields_with_android_admission(
            maximum_duration,
            android_method_profile_registry::CanonicalReceiptAdmission::CompletedProofRequired,
        )
    }

    fn validate_fields_with_android_admission(
        &self,
        maximum_duration: MaximumDurationValidation,
        admission: android_method_profile_registry::CanonicalReceiptAdmission,
    ) -> Result<(), String> {
        if self.protocol_version != RUNTIME_PROTOCOL_VERSION {
            return Err(format!(
                "unsupported protocol version: {}",
                self.protocol_version
            ));
        }
        if self.command != EXECUTE_WORKSPACE_COMMAND && self.command != QUERY_REVIEW_COMMAND {
            return Err(format!("unsupported command: {}", self.command));
        }
        if self.request_id.trim().is_empty() {
            return Err("requestId is required".into());
        }
        if self.input_file_name.trim().is_empty() {
            return Err("inputFileName is required".into());
        }
        validate_pipeline_v2_options_with(
            &self.options.clone().into_pipeline_options(),
            maximum_duration,
        )
        .map_err(|error| error.to_string())?;
        for receipt in self.active_method_profile_receipts()? {
            match admission {
                android_method_profile_registry::CanonicalReceiptAdmission::CompletedProofRequired => {
                    receipt.validate_against(&self.options)?;
                }
                android_method_profile_registry::CanonicalReceiptAdmission::ConformanceAttempt => {
                    receipt.validate_against_with_android_admission(&self.options, admission)?;
                }
            }
            if self.command == EXECUTE_WORKSPACE_COMMAND {
                if let Some(binding) = &receipt.diary_replication_binding {
                    if binding.profile_execution_status != "executable" {
                        return Err(format!(
                            "diary_replication_profile_not_executable:{}",
                            binding.profile_execution_status
                        ));
                    }
                }
            }
        }
        let effective_visualization_target =
            self.options.enable_plotting || self.options.enable_interactive_timeline;
        if self
            .options
            .materialize_visualization_data
            .is_some_and(|declared| declared != effective_visualization_target)
        {
            return Err(
                "materializeVisualizationData must equal enablePlotting OR enableInteractiveTimeline"
                    .into(),
            );
        }
        validate_digest(&self.input_sha256).map_err(|message| format!("inputSha256 {message}"))?;
        if let Some(root) = &self.workspace_root_digest {
            validate_digest(root).map_err(|message| format!("workspaceRootDigest {message}"))?;
        }
        validate_digest(&self.workspace_id).map_err(|message| format!("workspaceId {message}"))?;
        Ok(())
    }

    fn validate_participant_partition_transport(&self) -> Result<(), String> {
        if self
            .fragmented_participant_tokens
            .iter()
            .any(|digest| validate_digest(digest).is_err())
        {
            return Err("fragmentedParticipantTokens must contain only valid opaque tokens".into());
        }
        if self
            .fragmented_participant_tokens
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        {
            return Err(
                "fragmentedParticipantTokens must be sorted and contain no duplicates".into(),
            );
        }
        match (
            self.participant_partition_batch_id.as_deref(),
            self.fragmented_participant_tokens.is_empty(),
        ) {
            (None, true) => Ok(()),
            (Some(batch_id), false) => validate_digest(batch_id)
                .map_err(|_| "participantPartitionBatchId must be a valid batch identity".into()),
            _ => Err(
                "participantPartitionBatchId and fragmentedParticipantTokens must be supplied together"
                    .into(),
            ),
        }
    }

    fn validate(&self, csv_bytes: &[u8]) -> Result<String, String> {
        self.validate_fields()?;
        let actual = sha256(csv_bytes);
        if self.input_sha256 != actual {
            return Err(format!(
                "input digest mismatch: declared={} actual={actual}",
                self.input_sha256
            ));
        }
        Ok(actual)
    }

    fn validate_android_profile_conformance_attempt(
        &self,
        csv_bytes: &[u8],
    ) -> Result<String, String> {
        let receipts = self.active_method_profile_receipts()?;
        if self.command != EXECUTE_WORKSPACE_COMMAND
            || receipts.len() != 1
            || receipts[0].diary_replication_binding.is_some()
        {
            return Err(
                "Android profile conformance attempt requires ExecuteWorkspace and exactly one Android methodProfileReceipt"
                    .into(),
            );
        }
        self.validate_fields_with_android_admission(
            MaximumDurationValidation::Complete,
            android_method_profile_registry::CanonicalReceiptAdmission::ConformanceAttempt,
        )?;
        let actual = sha256(csv_bytes);
        if self.input_sha256 != actual {
            return Err(format!(
                "input digest mismatch: declared={} actual={actual}",
                self.input_sha256
            ));
        }
        Ok(actual)
    }

    fn validate_persisted_input(&self) -> Result<String, String> {
        self.validate_fields()?;
        Ok(self.input_sha256.clone())
    }
}

fn resolve_fragmented_participant_ids(
    verified_input_digest: &str,
    batch_id: Option<&str>,
    participant_tokens: &[Sha256Digest],
) -> Result<Vec<String>, String> {
    if participant_tokens.is_empty() {
        return Ok(Vec::new());
    }
    let batch_id = batch_id.ok_or_else(|| {
        "participant partition batch is unavailable; re-inspect the files".to_string()
    })?;
    PARTICIPANT_INSPECTION_BATCHES.with(|batches| {
        let batches = batches.borrow();
        let batch = batches.get(batch_id).ok_or_else(|| {
            "participant partition batch is unavailable; re-inspect the files".to_string()
        })?;
        let participant_by_token = batch
            .participants_by_artifact
            .get(verified_input_digest)
            .ok_or_else(|| {
                "participant partition batch does not contain the verified raw artifact; re-inspect the files"
                    .to_string()
            })?;
        // The kernel boundary names participants; a file that still mixes
        // studies can resolve one participant twice, so keep the first.
        let mut participant_ids = Vec::with_capacity(participant_tokens.len());
        for token in participant_tokens {
            let (study_id, participant_id) = participant_by_token.get(token).ok_or_else(|| {
                "participant partition token is unknown for the verified raw artifact; re-inspect the files"
                    .to_string()
            })?;
            if participant_partition_token(&batch.secret, study_id, participant_id) != *token {
                return Err(
                    "participant partition metadata does not match the verified raw artifact"
                        .to_string(),
                );
            }
            if !participant_ids.contains(participant_id) {
                participant_ids.push(participant_id.clone());
            }
        }
        Ok(participant_ids)
    })
}

fn canonicalize_exact_options(
    options: &PipelineV2OptionsJson,
) -> Result<(Value, Vec<u8>, Sha256Digest), String> {
    let exact_options_value = serde_json::to_value(options)
        .map_err(|error| format!("serialize exact Rust options: {error}"))?;
    let options_bytes = serde_jcs::to_vec(&exact_options_value)
        .map_err(|error| format!("canonicalize exact Rust options: {error}"))?;
    let options_digest = sha256(&options_bytes);
    Ok((exact_options_value, options_bytes, options_digest))
}

/// Digest of the exact request options minus the fields the workflow contract
/// declares artifact-only (`RUNTIME_ARTIFACT_REQUEST_FIELDS`). This is the
/// options identity the kernel binds into scientific receipts (B05/Schoedel
/// and EYES `options_digest`), which fold into the tracked
/// `assemble_result_manifest` checkpoint: a pure output-format toggle such as
/// `enable_spss_export` must not perturb any tracked computation fingerprint.
/// The kernel enforces that every exact wire field is either query-bound or in
/// that artifact-only list, so this projection is exactly the union of all
/// query-bound request fields. The full-options digest remains the workspace,
/// artifact-store, and preflight-commit identity.
fn computation_options_digest(exact_options_value: &Value) -> Result<Sha256Digest, String> {
    let exact_object = exact_options_value
        .as_object()
        .ok_or_else(|| "exact Rust options must serialize as an object".to_string())?;
    let mut computation_object = exact_object.clone();
    for field in chronicle_chrono_kernel_wasm::workflow_contract::RUNTIME_ARTIFACT_REQUEST_FIELDS {
        computation_object.remove(*field);
    }
    let computation_bytes = serde_jcs::to_vec(&Value::Object(computation_object))
        .map_err(|error| format!("canonicalize computation Rust options: {error}"))?;
    Ok(sha256(&computation_bytes))
}

fn opener_set_preflight_decision(
    request: &RuntimeRequest,
) -> Result<OpenerSetPreflightDecision, String> {
    // A legal B06 vector refused for the selected strategy or provider is
    // the B06 preflight's report (and the execution guard's rejection), not
    // an invalid request on this axis; malformed B06 is still rejected here.
    request.validate_fields_with(MaximumDurationValidation::MalformedOnly)?;
    let (_, _, options_digest) = canonicalize_exact_options(&request.options)?;
    let applicability = opener_set_applicability(
        &request.options.opener_set,
        &request.options.episode_reconstruction_strategy,
    );
    Ok(OpenerSetPreflightDecision {
        status: if applicability.is_executable() {
            OpenerSetPreflightStatus::Executable
        } else {
            OpenerSetPreflightStatus::Refused
        },
        requested_opener_set_id: request.options.opener_set.clone(),
        resolved_opener_set_id: applicability.requested.canonical_id().into(),
        effective_opener_set_id: applicability
            .effective
            .map(|opener_set| opener_set.canonical_id().into()),
        relation: applicability.relation,
        reason_code: applicability
            .refusal_reason
            .map(|reason| reason.canonical_id().into()),
        options_digest,
    })
}

fn reject_refused_opener_set(options: &PipelineV2OptionsJson) -> Result<(), String> {
    let applicability = opener_set_applicability(
        &options.opener_set,
        &options.episode_reconstruction_strategy,
    );
    let Some(reason) = applicability.refusal_reason else {
        return Ok(());
    };
    let strategy =
        EpisodeReconstructionStrategy::from_canonical_id(&options.episode_reconstruction_strategy);
    Err(format!(
        "opener_set_refused:{}:{}:{}",
        applicability.requested.canonical_id(),
        strategy.canonical_id(),
        reason.canonical_id(),
    ))
}

/// Return the exact configuration decision without reading input or support
/// bytes. Execution repeats the refusal check before ingress/reconstruction.
pub fn opener_set_applicability_native(request_json: &str) -> Result<String, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    serde_json::to_string(&opener_set_preflight_decision(&request)?)
        .map_err(|error| format!("serialize opener-set preflight decision: {error}"))
}

#[wasm_bindgen]
pub fn opener_set_applicability_json(request_json: &str) -> Result<String, JsValue> {
    opener_set_applicability_native(request_json).map_err(|error| JsValue::from_str(&error))
}

/// Artifact kind of the published B06 receipt.
pub const MAXIMUM_DURATION_RECEIPT_KIND: &str = "maximum-duration-receipt-json";

/// Configuration-only B06 decision, bound to the exact options digest the
/// manifest will carry. Never reads input or support bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationPreflightDecision {
    pub status: OpenerSetPreflightStatus,
    pub applicability: MaximumDurationApplicability,
    pub reason_code: Option<String>,
    pub options_digest: Sha256Digest,
}

fn maximum_duration_preflight_decision(
    request: &RuntimeRequest,
) -> Result<MaximumDurationPreflightDecision, String> {
    // Every request-level check except the B06 judgement itself, which this
    // decision reports as data (malformed and refused alike).
    request.validate_fields_with(MaximumDurationValidation::Skip)?;
    let (_, _, options_digest) = canonicalize_exact_options(&request.options)?;
    let options = request.options.clone().into_pipeline_options();
    let applicability = b06::maximum_duration_applicability(
        &options.maximum_duration,
        options.episode_reconstruction_strategy,
        options.long_duration_threshold_ns,
    );
    Ok(MaximumDurationPreflightDecision {
        status: if applicability.is_executable() {
            OpenerSetPreflightStatus::Executable
        } else {
            OpenerSetPreflightStatus::Refused
        },
        reason_code: applicability
            .refusal_reason
            .map(|reason| reason.canonical_id().to_string()),
        applicability,
        options_digest,
    })
}

pub fn maximum_duration_applicability_native(request_json: &str) -> Result<String, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    serde_json::to_string(&maximum_duration_preflight_decision(&request)?)
        .map_err(|error| format!("serialize maximum-duration preflight decision: {error}"))
}

#[wasm_bindgen]
pub fn maximum_duration_applicability_json(request_json: &str) -> Result<String, JsValue> {
    maximum_duration_applicability_native(request_json).map_err(|error| JsValue::from_str(&error))
}

/// A single rendered preview cell. Unlike every other boundary string this one
/// is legitimately empty when the source column is empty, so the generated
/// browser validator only requires a string here.
pub type PreviewCell = String;

const EYES_RUNTIME_SUMMARY_PROTOCOL_VERSION: &str = "chronicle-eyes-runtime-summary/v2";
const EYES_TAGGED_FAU_EVIDENCE_KIND: &str = "eyes-tagged-fau-evidence-json";
const EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND: &str = "eyes-tagged-fau-validation-receipt-json";

/// Applicability of the evidence-only EYES surface for this exact binding.
///
/// `not_applicable` is deliberately distinct from an empty EYES replay. A
/// non-EYES binding therefore has neither an EYES artifact nor a fabricated
/// EYES receipt; only this compact status remains explicit in JSON manifests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeEyesEvidenceStatus {
    PartialReplay,
    NotApplicable,
}

/// Small typed surface carried by review and processing manifests. Full
/// episodes/chunks/fragments and literal participant IDs remain exclusively in
/// the authorized dedicated evidence artifact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEyesEvidenceSummary {
    pub protocol_version: String,
    pub status: RuntimeEyesEvidenceStatus,
    pub episode_reconstruction_strategy: String,
    pub tagged_fau_artifact_digest: Option<Sha256Digest>,
    pub validation_receipt: Option<EyesTaggedFauValidationReceipt>,
    pub validation_receipt_artifact_digest: Option<Sha256Digest>,
}

struct RuntimeEyesEvidenceBundle {
    summary: RuntimeEyesEvidenceSummary,
    artifact_bytes: Option<Vec<u8>>,
    validation_receipt_bytes: Option<Vec<u8>>,
}

const SCIENTIFIC_EVIDENCE_SUMMARY_PROTOCOL_VERSION: &str =
    "chronicle-runtime-scientific-evidence-summary/v2";
const FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND: &str = "foundational-semantics-receipt-json";
const MINIMUM_DURATION_EXCLUDED_LINEAGE_KIND: &str = "minimum-duration-excluded-lineage-json";
const ZERO_DURATION_CLEANUP_EVIDENCE_KIND: &str = "zero-duration-cleanup-evidence-json";
const ZERO_DURATION_REMOVED_LINEAGE_KIND: &str = "zero-duration-removed-lineage-json";
const B05_SCREEN_CONSTRUCTION_EVIDENCE_KIND: &str = "b05-screen-construction-evidence-json";
const SCHOEDEL_RECONSTRUCTION_EVIDENCE_KIND: &str = "schoedel-reconstruction-evidence-json";
const B05_SCHOEDEL_VALIDATION_RECEIPT_KIND: &str = "b05-schoedel-validation-receipt-json";

/// PHI-safe, typed scientific receipt projection shared verbatim by full,
/// processing, and review manifests. Participant-level evidence remains in
/// its dedicated content-addressed artifact; this summary carries only the
/// kernel-owned aggregate receipts and exact artifact commitments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeScientificEvidenceSummary {
    pub protocol_version: String,
    pub foundational_semantics_artifact_digest: Sha256Digest,
    pub micro_use_receipt: MicroUseReceipt,
    pub minimum_duration_receipt: RuntimeMinimumDurationReceipt,
    pub concurrent_subinterval_floor_receipt: ConcurrentSubintervalFloorReceipt,
    pub zero_duration_cleanup_receipt: RuntimeZeroDurationCleanupReceipt,
    pub minimum_duration_excluded_lineage_artifact_digest: Option<Sha256Digest>,
    pub zero_duration_cleanup_evidence_artifact_digest: Option<Sha256Digest>,
    pub zero_duration_removed_lineage_artifact_digest: Option<Sha256Digest>,
    pub finalized_b05_schoedel: RuntimeB05SchoedelPreflightReceipt,
    pub b05_screen_construction_receipt: Option<RuntimeScreenConstructionReceipt>,
    pub b05_screen_construction_artifact_digest: Option<Sha256Digest>,
    pub schoedel_reconstruction_receipt: Option<RuntimeSchoedelReconstructionReceipt>,
    pub schoedel_reconstruction_artifact_digest: Option<Sha256Digest>,
    pub eyes_input_partition: Option<EyesInputPartitionPreflightResult>,
    pub eyes_tagged_fau_validation_receipt: Option<EyesTaggedFauValidationReceipt>,
    pub eyes_tagged_fau_validation_receipt_artifact_digest: Option<Sha256Digest>,
    pub b05_schoedel_validation_receipt: RuntimeB05SchoedelValidationReceipt,
    pub b05_schoedel_validation_receipt_artifact_digest: Sha256Digest,
}

/// Aggregate B04 projection. The exact excluded-lineage digest hashes
/// participant/package/timestamp evidence and remains only in the authorized
/// foundational and lineage artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMinimumDurationReceipt {
    pub protocol_version: String,
    pub relation: String,
    pub requested_comparator: MinimumDurationComparator,
    pub effective_comparator: MinimumDurationComparator,
    pub threshold_ns: i64,
    pub requested_disposition: MinimumDurationDisposition,
    pub effective_disposition: MinimumDurationDisposition,
    pub checkpoint: String,
    pub bounded_episode_count: u32,
    pub unbounded_episode_count: u32,
    pub qualifying_count: u32,
    pub retained_credited_count: u32,
    pub retained_excluded_count: u32,
    pub dropped_count: u32,
}

impl From<&MinimumDurationReceipt> for RuntimeMinimumDurationReceipt {
    fn from(receipt: &MinimumDurationReceipt) -> Self {
        Self {
            protocol_version: receipt.protocol_version.clone(),
            relation: receipt.relation.clone(),
            requested_comparator: receipt.requested_comparator,
            effective_comparator: receipt.effective_comparator,
            threshold_ns: receipt.threshold_ns,
            requested_disposition: receipt.requested_disposition,
            effective_disposition: receipt.effective_disposition,
            checkpoint: receipt.checkpoint.clone(),
            bounded_episode_count: receipt.bounded_episode_count,
            unbounded_episode_count: receipt.unbounded_episode_count,
            qualifying_count: receipt.qualifying_count,
            retained_credited_count: receipt.retained_credited_count,
            retained_excluded_count: receipt.retained_excluded_count,
            dropped_count: receipt.dropped_count,
        }
    }
}

/// Aggregate exact-zero cleanup projection. The removed-lineage digest stays
/// within its dedicated authorized evidence closure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeZeroDurationCleanupReceipt {
    pub protocol_version: String,
    pub requested_applied: bool,
    pub effective_applied: bool,
    pub checkpoint: String,
    pub zero_episode_candidate_count: u32,
    pub removed_row_count: u32,
}

impl From<&ZeroDurationCleanupReceipt> for RuntimeZeroDurationCleanupReceipt {
    fn from(receipt: &ZeroDurationCleanupReceipt) -> Self {
        Self {
            protocol_version: receipt.protocol_version.clone(),
            requested_applied: receipt.requested_applied,
            effective_applied: receipt.effective_applied,
            checkpoint: receipt.checkpoint.clone(),
            zero_episode_candidate_count: receipt.zero_episode_candidate_count,
            removed_row_count: receipt.removed_row_count,
        }
    }
}

/// Aggregate-only screen-construction receipt. The kernel's interval digest
/// commits participant identifiers, timestamps, and source rows, so it stays
/// in the authorized detailed evidence artifact and never crosses this public
/// manifest/source boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeScreenConstructionReceipt {
    pub protocol_version: String,
    pub strategy_id: ScreenSessionConstructionStrategyId,
    pub relation: ScientificRelation,
    pub source_identity: String,
    pub source_artifact_sha256: Option<Sha256Digest>,
    pub source_license_status: String,
    pub input_row_count: u64,
    pub participant_count: u64,
    pub interval_count: u64,
    pub session_count: u64,
    pub glance_count: u64,
    pub right_censored_count: u64,
    pub issue_counts: BTreeMap<String, u64>,
}

impl From<&ScreenConstructionReceiptV1> for RuntimeScreenConstructionReceipt {
    fn from(receipt: &ScreenConstructionReceiptV1) -> Self {
        Self {
            protocol_version: receipt.protocol_version.clone(),
            strategy_id: receipt.strategy_id,
            relation: receipt.relation,
            source_identity: receipt.source_identity.clone(),
            source_artifact_sha256: receipt.source_artifact_sha256.clone(),
            source_license_status: receipt.source_license_status.clone(),
            input_row_count: receipt.input_row_count,
            participant_count: receipt.participant_count,
            interval_count: receipt.interval_count,
            session_count: receipt.session_count,
            glance_count: receipt.glance_count,
            right_censored_count: receipt.right_censored_count,
            issue_counts: receipt.issue_counts.clone(),
        }
    }
}

/// Aggregate-only Schoedel reconstruction receipt. `episodeDigest` is omitted
/// because its preimage contains participant/package/time/source-row data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSchoedelReconstructionReceipt {
    pub protocol_version: String,
    pub strategy_id: String,
    pub relation: ScientificRelation,
    pub source_identity: String,
    pub source_version: String,
    pub source_license_status: String,
    pub source_scope_id: String,
    pub adapter_id: String,
    pub completion_rule_ids: Vec<String>,
    pub input_screen_interval_count: u64,
    pub input_event_count: u64,
    pub episode_count: u64,
    pub bounded_episode_count: u64,
    pub singleton_zero_length_count: u64,
    pub right_censored_evidence_count: u64,
    pub issue_counts: BTreeMap<String, u64>,
}

impl From<&SchoedelReconstructionReceiptV1> for RuntimeSchoedelReconstructionReceipt {
    fn from(receipt: &SchoedelReconstructionReceiptV1) -> Self {
        Self {
            protocol_version: receipt.protocol_version.clone(),
            strategy_id: receipt.strategy_id.clone(),
            relation: receipt.relation,
            source_identity: receipt.source_identity.clone(),
            source_version: receipt.source_version.clone(),
            source_license_status: receipt.source_license_status.clone(),
            source_scope_id: receipt.source_scope_id.clone(),
            adapter_id: receipt.adapter_id.clone(),
            completion_rule_ids: receipt.completion_rule_ids.clone(),
            input_screen_interval_count: receipt.input_screen_interval_count,
            input_event_count: receipt.input_event_count,
            episode_count: receipt.episode_count,
            bounded_episode_count: receipt.bounded_episode_count,
            singleton_zero_length_count: receipt.singleton_zero_length_count,
            right_censored_evidence_count: receipt.right_censored_evidence_count,
            issue_counts: receipt.issue_counts.clone(),
        }
    }
}

/// PHI-safe public projection of the exact kernel validation receipt. The
/// exact receipt, including internal scientific sub-digests, is published once
/// as its dedicated authorized artifact and supplied transiently to semantic
/// validation rather than duplicated in manifests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeB05SchoedelValidationReceipt {
    pub protocol_version: String,
    pub status: B05SchoedelValidationStatus,
    pub decoded_input_row_count: u64,
    pub foundational_episode_count: u32,
    pub foundational_bounded_episode_count: u32,
    pub foundational_unbounded_episode_count: u32,
    pub minimum_duration_excluded_episode_count: u32,
    pub concurrent_generated_subinterval_count: u32,
    pub zero_duration_removed_row_count: u32,
    pub selected_b05_strategy_id: ScreenSessionConstructionStrategyId,
    pub trusted_schoedel_retained_event_count: Option<u64>,
    pub schoedel_decisive_participant_count: u32,
}

impl From<&B05SchoedelValidationReceipt> for RuntimeB05SchoedelValidationReceipt {
    fn from(receipt: &B05SchoedelValidationReceipt) -> Self {
        Self {
            protocol_version: receipt.protocol_version.clone(),
            status: receipt.status,
            decoded_input_row_count: receipt.decoded_input_row_count,
            foundational_episode_count: receipt.foundational_episode_count,
            foundational_bounded_episode_count: receipt.foundational_bounded_episode_count,
            foundational_unbounded_episode_count: receipt.foundational_unbounded_episode_count,
            minimum_duration_excluded_episode_count: receipt
                .minimum_duration_excluded_episode_count,
            concurrent_generated_subinterval_count: receipt.concurrent_generated_subinterval_count,
            zero_duration_removed_row_count: receipt.zero_duration_removed_row_count,
            selected_b05_strategy_id: receipt.selected_b05_strategy_id,
            trusted_schoedel_retained_event_count: receipt.trusted_schoedel_retained_event_count,
            schoedel_decisive_participant_count: receipt.schoedel_decisive_participant_count,
        }
    }
}

struct RuntimeScientificEvidenceBundle {
    summary: RuntimeScientificEvidenceSummary,
    artifacts: Vec<RuntimeArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactMetadata {
    pub artifact_id: String,
    pub kind: String,
    pub media_type: String,
    pub digest: Sha256Digest,
    pub size: u64,
    pub derived_from: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scientific_source_bindings: Vec<RuntimeScientificSourceBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_rows: Option<Vec<Vec<PreviewCell>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeScientificSourceBinding {
    pub role_id: String,
    pub artifact_digest: Sha256Digest,
    pub assignment_id: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCounts {
    pub original: u32,
    pub processed: u32,
    pub app: u32,
    pub screen: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeQueryExecution {
    pub query_id: String,
    pub query_group_id: String,
    pub status: ExecutionStatus,
    pub input_key: Sha256Digest,
    pub output_digest: Sha256Digest,
    pub reason_id: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessingSummary {
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    pub timezone_retained_source_rows_digest: Sha256Digest,
    pub timezone_stage_digest: Sha256Digest,
    pub workflow_query_group_digests: BTreeMap<String, Sha256Digest>,
    pub workflow_query_group_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    pub workflow_query_digests: BTreeMap<String, Sha256Digest>,
    pub workflow_query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    pub published_outputs_digest: Sha256Digest,
    pub provenance_digest: Sha256Digest,
    pub opener_set_receipt: OpenerSetEvidence,
    /// B06 aggregate receipt; absent for the omitted shape so the pre-B06
    /// manifest bytes are unchanged. Like the B04 receipt, this is the
    /// PHI-safe aggregate only: the participant-level excluded lineage lives
    /// in the `maximum-duration-receipt-json` artifact (whole evidence, JCS),
    /// bound here by `excluded_lineage_digest`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_receipt: Option<MaximumDurationReceipt>,
    pub eyes_evidence: RuntimeEyesEvidenceSummary,
    pub scientific_evidence: RuntimeScientificEvidenceSummary,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub cleaning_counts: CleaningCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub protocol_version: String,
    pub preprocessor_version: String,
    pub request_id: String,
    pub command: String,
    pub implementation: String,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub scope: String,
    pub plan_digest: Sha256Digest,
    pub profile_digest: Sha256Digest,
    pub profile_lock_digest: Sha256Digest,
    pub runtime_authority_digest: Sha256Digest,
    pub product_contract_digest: Sha256Digest,
    pub dependency_certificate_digest: Sha256Digest,
    pub dependency_cache_decision: DependencyCacheDecision,
    pub previous_workspace_root_digest: Option<Sha256Digest>,
    pub workspace_id: Sha256Digest,
    pub workspace_root_digest: Sha256Digest,
    pub options_digest: Sha256Digest,
    pub input: ArtifactRef,
    pub role_assignments: Vec<RoleAssignment>,
    pub qualification_traces: Vec<chronicle_preprocessing_semantic_adapter::QualificationTrace>,
    pub requirement_traces: Vec<chronicle_preprocessing_semantic_adapter::RoleRequirementTrace>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
    pub query_group_executions: Vec<QueryGroupExecution>,
    pub query_executions: Vec<RuntimeQueryExecution>,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
    pub counts: RuntimeCounts,
    pub eyes_evidence: RuntimeEyesEvidenceSummary,
    pub scientific_evidence: RuntimeScientificEvidenceSummary,
    pub processing_summary: RuntimeProcessingSummary,
    pub journal_digest: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiteratureComponentExecutionReceipt {
    pub protocol_version: String,
    pub component_id: String,
    pub component_execution_status: String,
    pub full_profile_execution_status: String,
    pub parent_method_profile_id: String,
    pub source_work_id: String,
    pub source_method_variant_id: String,
    pub method_profile_version: String,
    pub setting_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub limitations: Vec<String>,
    pub original_input_digest: Sha256Digest,
    pub support_artifact_digests: BTreeMap<String, Sha256Digest>,
    pub support_adapter_input_digests: BTreeMap<String, Sha256Digest>,
    pub support_formats: BTreeMap<String, String>,
    pub component_method_receipt_digest: Sha256Digest,
    pub adaptation_receipt_digest: Sha256Digest,
    pub derived_result_kind: String,
    pub derived_result_digest: Sha256Digest,
    pub derived_result_row_count: u32,
    pub oracle_id: String,
    pub kernel_input_eligible: bool,
    pub canonical_kernel_input_digest: Option<Sha256Digest>,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub input_adapter_contract_digest: Sha256Digest,
    pub input_adapter_conformance_digest: Sha256Digest,
    pub android_method_profile_registry_content_digest: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiteratureComponentMethodReceipt {
    pub protocol_version: String,
    pub component_id: String,
    pub parent_method_profile_id: String,
    pub parent_profile_execution_status: String,
    pub source_work_id: String,
    pub source_method_variant_id: String,
    pub method_profile_version: String,
    pub setting_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub limitations: Vec<String>,
    pub input_bindings: Vec<MethodProfileInputBindingReceipt>,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub input_adapter_contract_digest: Sha256Digest,
    pub input_adapter_conformance_digest: Sha256Digest,
    pub android_method_profile_registry_content_digest: Sha256Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiteratureComponentRuntimeManifest {
    pub protocol_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_id: Sha256Digest,
    pub previous_workspace_root_digest: Option<Sha256Digest>,
    pub workspace_root_digest: Sha256Digest,
    pub artifact_closure_digest: Sha256Digest,
    pub input_file_name: String,
    pub input_digest: Sha256Digest,
    pub component_id: String,
    pub component_execution_receipt_digest: Sha256Digest,
    pub source_row_count: u32,
    pub derived_result_row_count: u32,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub input_adapter_contract_digest: Sha256Digest,
    pub input_adapter_conformance_digest: Sha256Digest,
    pub android_method_profile_registry_content_digest: Sha256Digest,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiteratureComponentArtifactClosure<'a> {
    protocol_version: &'static str,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<Sha256Digest>,
    input_digest: &'a str,
    assignment_digests: &'a BTreeMap<String, Sha256Digest>,
    support_artifact_digests: &'a BTreeMap<String, Sha256Digest>,
    support_adapter_input_digests: &'a BTreeMap<String, Sha256Digest>,
    component_id: &'a str,
    parent_method_profile_id: &'a str,
    full_profile_execution_status: &'a str,
    source_work_id: &'a str,
    source_method_variant_id: &'a str,
    method_profile_version: &'a str,
    setting_ids: &'a [String],
    component_execution_receipt_digest: &'a str,
    oracle_id: &'a str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    input_adapter_contract_digest: &'a str,
    input_adapter_conformance_digest: &'a str,
    android_method_profile_registry_content_digest: &'a str,
    artifacts: Vec<&'a RuntimeArtifactMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiteratureComponentRoot<'a> {
    protocol_version: &'static str,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<Sha256Digest>,
    input_digest: &'a str,
    assignment_digests: &'a BTreeMap<String, Sha256Digest>,
    support_artifact_digests: &'a BTreeMap<String, Sha256Digest>,
    support_adapter_input_digests: &'a BTreeMap<String, Sha256Digest>,
    component_id: &'a str,
    parent_method_profile_id: &'a str,
    full_profile_execution_status: &'a str,
    source_work_id: &'a str,
    source_method_variant_id: &'a str,
    method_profile_version: &'a str,
    setting_ids: &'a [String],
    component_execution_receipt_digest: &'a str,
    oracle_id: &'a str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    input_adapter_contract_digest: &'a str,
    input_adapter_conformance_digest: &'a str,
    android_method_profile_registry_content_digest: &'a str,
    artifact_digests: Vec<&'a str>,
    artifact_closure_digest: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRuntimeManifest {
    pub protocol_version: String,
    pub preprocessor_version: String,
    pub request_id: String,
    pub command: String,
    pub workspace_id: Sha256Digest,
    pub previous_workspace_root_digest: Option<Sha256Digest>,
    pub input_digest: Sha256Digest,
    pub options_digest: Sha256Digest,
    /// See `computation_options_digest`: the exact options minus the
    /// contract-declared artifact-only fields. Scientific receipts bind this
    /// identity, so the browser firewall verifies them against this field
    /// rather than the full request digest.
    pub computation_options_digest: Sha256Digest,
    pub implementation_digest: Sha256Digest,
    pub build_environment_digest: Sha256Digest,
    pub plan_digest: Sha256Digest,
    pub profile_digest: Sha256Digest,
    pub profile_lock_digest: Sha256Digest,
    pub product_contract_digest: Sha256Digest,
    pub dependency_certificate_digest: Sha256Digest,
    pub dependency_cache_decision: DependencyCacheDecision,
    pub role_assignments: Vec<RoleAssignment>,
    pub artifacts: Vec<RuntimeArtifactMetadata>,
    pub opener_set_receipt: OpenerSetEvidence,
    /// B06 aggregate receipt (see `RuntimeProcessingSummary`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_receipt: Option<MaximumDurationReceipt>,
    pub eyes_evidence: RuntimeEyesEvidenceSummary,
    pub scientific_evidence: RuntimeScientificEvidenceSummary,
    pub counts: RuntimeCounts,
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub cleaning_counts: CleaningCounts,
    pub query_group_executions: Vec<QueryGroupExecution>,
    pub query_executions: Vec<RuntimeQueryExecution>,
    pub cache_sources: Vec<String>,
    pub review_summary_digest: Sha256Digest,
    pub comparison_digest: Sha256Digest,
    /// True when the request's `knownReviewSummaryDigests` list matched the
    /// recomputed summary, so only those review-summary bytes are omitted and
    /// the caller keeps its cached copy. Independently content-addressed
    /// scientific evidence remains present unless separately negotiated.
    #[serde(default)]
    pub review_summary_reused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementsReport {
    pub protocol_version: &'static str,
    pub ready: bool,
    pub role_assignments: Vec<RoleAssignment>,
    pub qualification_traces: Vec<chronicle_preprocessing_semantic_adapter::QualificationTrace>,
    pub requirement_traces: Vec<chronicle_preprocessing_semantic_adapter::RoleRequirementTrace>,
    pub open_obligations: Vec<chronicle_preprocessing_semantic_adapter::OpenObligation>,
    pub role_states: BTreeMap<String, MaterializationState>,
    pub query_group_states: BTreeMap<String, MaterializationState>,
    pub state_reasons: Vec<chronicle_preprocessing_semantic_adapter::StateReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootCommit<'a> {
    protocol_version: &'a str,
    workflow_model_version: &'static str,
    workflow_compatibility_digest: &'a str,
    command: &'a str,
    implementation_digest: &'a str,
    build_environment_digest: &'a str,
    product_contract_digest: &'a str,
    plan_digest: &'a str,
    profile_digest: &'a str,
    profile_lock_digest: &'a str,
    runtime_authority_digest: &'a str,
    dependency_certificate_digest: &'a str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<String>,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    artifact_digests: Vec<&'a str>,
    execution_state_digest: &'a str,
    required_views: &'a [RequiredViewBinding],
    journal_digest: &'a str,
    artifact_closure_digest: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequiredViewBinding {
    artifact_kind: &'static str,
    view_id: &'static str,
    schema_id: &'static str,
    artifact_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionStateCommit<'a> {
    protocol_version: &'static str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    product_contract_digest: &'static str,
    plan_digest: &'static str,
    profile_digest: &'static str,
    profile_lock_digest: &'static str,
    runtime_authority_digest: &'static str,
    dependency_certificate_digest: &'static str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    workspace_id: &'a str,
    previous_workspace_root_digest: &'a Option<String>,
    input_digest: &'a str,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    computational_artifact_digests: Vec<&'a str>,
    journal_digest: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactClosure<'a> {
    protocol_version: &'static str,
    workspace_id: &'a str,
    input_digest: &'a str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    plan_digest: &'static str,
    profile_digest: &'static str,
    profile_lock_digest: &'static str,
    runtime_authority_digest: &'static str,
    product_contract_digest: &'static str,
    dependency_certificate_digest: &'static str,
    dependency_cache_mode: chronicle_preprocessing_semantic_adapter::DependencyCacheMode,
    previous_workspace_root_digest: &'a Option<String>,
    options_digest: &'a str,
    assignment_digests: BTreeMap<&'a str, &'a str>,
    execution_state_digest: &'a str,
    journal_digest: &'a str,
    artifacts: Vec<&'a RuntimeArtifactMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CorrespondenceEdge {
    edge_id: String,
    source_kind: &'static str,
    source_id: String,
    relation: String,
    target_kind: &'static str,
    target_id: String,
    precision: &'static str,
    evidence_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CorrespondenceIndex {
    protocol_version: &'static str,
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    plan_digest: &'static str,
    profile_lock_digest: &'static str,
    product_contract_digest: &'static str,
    claim_boundary: &'static str,
    source_coordinate_artifact_kind: &'static str,
    row_correspondence_artifact_kind: &'static str,
    cell_correspondence_artifact_kind: &'static str,
    influence_witness_artifact_kind: &'static str,
    edges: Vec<CorrespondenceEdge>,
}

use chronicle_chrono_kernel_wasm::payload_store::{PayloadBytes, PayloadHandle};

#[derive(Clone)]
struct RuntimeArtifact {
    metadata: RuntimeArtifactMetadata,
    /// Budgeted payload chunks: until the caller takes them, artifact bytes
    /// spill and reload like every other payload instead of pinning the heap.
    bytes: PayloadBytes,
}







struct CorrespondenceIndexInputs<'a> {
    plan: &'a chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    assignments: &'a BTreeMap<String, RoleAssignment>,
    materialization: &'a chronicle_preprocessing_semantic_adapter::Materialization,
    query_group_executions: &'a [QueryGroupExecution],
    options: &'a Value,
    artifacts: &'a [RuntimeArtifact],
    checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
    query_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
}

struct IngressMaterialization {
    input: ArtifactRef,
    assignments: BTreeMap<String, RoleAssignment>,
    materialization: chronicle_preprocessing_semantic_adapter::Materialization,
    journal: EvidenceJournal,
}

struct PreparedRuntimeWorkspace {
    request: RuntimeRequest,
    options_value: Value,
    exact_options_value: Value,
    options_bytes: Vec<u8>,
    options_digest: String,
    /// See `computation_options_digest`: the exact options minus artifact-only
    /// fields — the identity the kernel binds into scientific receipts.
    computation_options_digest: String,
    /// Literal participant IDs exist only inside this prepared Rust value and
    /// are passed directly into the kernel boundary.
    fragmented_participant_ids: Vec<String>,
    resolved_support: Arc<ResolvedSupportFiles>,
    pipeline_options: PipelineV2Options,
    ingress: IngressMaterialization,
    literature_input: Option<AdaptedLiteratureInput>,
}

#[wasm_bindgen]
pub struct PreparedReviewWorkspace {
    prepared: Option<PreparedRuntimeWorkspace>,
    csv_bytes: Option<Vec<u8>>,
    review_probe: Vec<u8>,
    reconstruction_probe: Vec<u8>,
    selection: PersistedReviewBaseSelection,
    warm_verified_input: bool,
}

#[wasm_bindgen]
pub struct RuntimeHandle {
    manifest_json: String,
    artifacts: Vec<RuntimeArtifact>,
}


















thread_local! {
    static INCREMENTAL_RUNTIME_STATES: RefCell<IncrementalRuntimeStateCache> =
        RefCell::new(IncrementalRuntimeStateCache::default());
}

#[wasm_bindgen]
pub fn set_payload_budget_bytes(bytes: u64) -> Result<(), String> {
    chronicle_chrono_kernel_wasm::payload_store::set_payload_budget_bytes(bytes)
}

#[wasm_bindgen(typescript_custom_section)]
const PAYLOAD_SPILL_BRIDGE_TS: &str = r#"
export type PayloadSpillBridge = {
  put(id: number, bytes: Uint8Array): void;
  get(id: number): Uint8Array;
  remove(id: number): void;
};
"#;

#[wasm_bindgen]
extern "C" {
    /// A JS object that stores spilled payloads outside WASM memory (the
    /// worker backs it with an OPFS sync access handle; see
    /// `web/src/workers/payloadSpill.ts`).
    #[wasm_bindgen(typescript_type = "PayloadSpillBridge")]
    pub type PayloadSpillBridge;
    #[wasm_bindgen(method, catch)]
    fn put(this: &PayloadSpillBridge, id: f64, bytes: &[u8]) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn get(this: &PayloadSpillBridge, id: f64) -> Result<Vec<u8>, JsValue>;
    #[wasm_bindgen(method)]
    fn remove(this: &PayloadSpillBridge, id: f64);
}

struct BridgedSpillBackend(PayloadSpillBridge);
// The runtime has no shared-memory threads (GitHub Pages is not cross-origin
// isolated), so the bridge never leaves the worker that installed it.
unsafe impl Send for BridgedSpillBackend {}
unsafe impl Sync for BridgedSpillBackend {}

fn spill_error(action: &str, id: u64, error: JsValue) -> String {
    format!(
        "{action} payload {id}: {}",
        error.as_string().unwrap_or_else(|| format!("{error:?}"))
    )
}

impl chronicle_chrono_kernel_wasm::payload_store::SpillBackend for BridgedSpillBackend {
    fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
        self.0
            .put(id as f64, bytes)
            .map_err(|error| spill_error("spill", id, error))
    }
    fn get(&self, id: u64) -> Result<Vec<u8>, String> {
        self.0
            .get(id as f64)
            .map_err(|error| spill_error("reload", id, error))
    }
    fn remove(&self, id: u64) {
        self.0.remove(id as f64);
    }
}

/// Routes payload spills through `bridge` and caps resident payload bytes at
/// `budget_bytes`. Call once, before the first execution; handles published
/// earlier keep the store they were published into.
#[wasm_bindgen]
pub fn install_payload_spill(bridge: PayloadSpillBridge, budget_bytes: u64) {
    chronicle_chrono_kernel_wasm::payload_store::replace_current_store(
        chronicle_chrono_kernel_wasm::payload_store::PayloadStore::new(
            budget_bytes,
            Arc::new(BridgedSpillBackend(bridge)),
        ),
    );
}

#[wasm_bindgen]
pub fn set_comparison_cache_capacity(capacity: usize) {
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        let mut cache = states.borrow_mut();
        cache.set_capacity(capacity);
        cache.compact_all(&chronicle_chrono_kernel_wasm::payload_store::current_store());
    });
}

#[wasm_bindgen]
pub fn get_comparison_cache_retained() -> usize {
    INCREMENTAL_RUNTIME_STATES.with(|states| states.borrow().retained_count())
}

/// Byte-only compatibility fallback for browsers without DecompressionStream.
/// It does not construct or execute a workspace or initialize Salsa state.
#[wasm_bindgen]
pub fn decompress_bundled_gzip(packed: &[u8], expected_bytes: u32) -> Result<Vec<u8>, JsValue> {
    packed_json::decode_gzip_bytes(packed, expected_bytes as usize)
        .map_err(|error| JsValue::from_str(&error))
}

#[cfg(test)]
thread_local! {
    static TRACKED_PHYSICAL_EXECUTION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static STABLE_ARTIFACT_GENERATION_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// The provenance record whose RFC 8785 canonical JSON is hashed into the
/// result digest. Production hashing streams it member by member through
/// `write_canonical_object` (the derived form buffers the entire row lineage
/// text); the test below pins the two to the same bytes.
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PipelineResultProvenance<'a> {
    original: u32,
    processed: u32,
    app: u32,
    screen: u32,
    duplicate_timestamps_corrected: u32,
    exact_duplicate_rows_removed: u32,
    cleaning_counts: &'a CleaningCounts,
    available_timezones: &'a [String],
    timezone: &'a str,
    timezone_action: &'a str,
    rows_before_timezone_handling: u32,
    rows_after_timezone_handling: u32,
    rows_removed_by_timezone: u32,
    timezone_retained_source_rows_digest: &'a str,
    timezone_stage_digest: &'a str,
    row_lineage: &'a [chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage],
    workflow_query_group_digests: &'a BTreeMap<String, String>,
    workflow_query_group_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
    workflow_query_digests: &'a BTreeMap<String, String>,
    workflow_query_checkpoints: &'a BTreeMap<String, WorkflowCheckpoint>,
    opener_set_receipt: &'a OpenerSetEvidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    maximum_duration_receipt: Option<&'a b06::MaximumDurationEvidence>,
    eyes_tagged_fau_artifact_digest: &'a Option<Sha256Digest>,
    eyes_validation_receipt_artifact_digest: &'a Option<Sha256Digest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scientific_evidence: Option<&'a RuntimeScientificEvidenceSummary>,
}

struct Sha256Writer<'a>(&'a mut Sha256);

impl Write for Sha256Writer<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Test oracle: the same prefix as production, then `serde_jcs` over the
/// derived record in one buffer. Production streams the record instead.
#[cfg(test)]
fn derived_pipeline_result_digest(
    result: &PipelineV2Result,
    published_outputs_digest: &str,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
    scientific_evidence: Option<&RuntimeScientificEvidenceSummary>,
) -> String {
    let mut derived = Sha256::new();
    derived.update((IMPLEMENTATION_BUILD_DIGEST.len() as u64).to_le_bytes());
    derived.update(IMPLEMENTATION_BUILD_DIGEST.as_bytes());
    derived.update((BUILD_ENVIRONMENT_DIGEST.len() as u64).to_le_bytes());
    derived.update(BUILD_ENVIRONMENT_DIGEST.as_bytes());
    derived.update((published_outputs_digest.len() as u64).to_le_bytes());
    derived.update(published_outputs_digest.as_bytes());
    derived.update(
        serde_jcs::to_vec(&PipelineResultProvenance {
            original: result.original_row_count,
            processed: result.processed_row_count,
            app: result.app_row_count,
            screen: result.screen_row_count,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
            cleaning_counts: &result.cleaning_counts,
            available_timezones: &result.available_timezones,
            timezone: &result.timezone,
            timezone_action: &result.timezone_action,
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            timezone_retained_source_rows_digest: &result.timezone_retained_source_rows_digest,
            timezone_stage_digest: &result.timezone_stage_digest,
            row_lineage: &result.row_lineage,
            workflow_query_group_digests: &result.workflow_query_group_digests,
            workflow_query_group_checkpoints: &result.workflow_query_group_checkpoints,
            workflow_query_digests: &result.workflow_query_digests,
            workflow_query_checkpoints: &result.workflow_query_checkpoints,
            opener_set_receipt: &result.opener_set_evidence,
            maximum_duration_receipt: result.maximum_duration_evidence.as_ref(),
            eyes_tagged_fau_artifact_digest: &eyes_evidence.tagged_fau_artifact_digest,
            eyes_validation_receipt_artifact_digest: &eyes_evidence
                .validation_receipt_artifact_digest,
            scientific_evidence,
        })
        .unwrap(),
    );
    format!("sha256:{}", hex::encode(derived.finalize()))
}

#[cfg(test)]
fn compute_pipeline_result_digest(
    result: &PipelineV2Result,
    published_outputs_digest: &str,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
) -> String {
    compute_pipeline_result_digest_with_scientific(
        result,
        published_outputs_digest,
        eyes_evidence,
        None,
    )
}

fn compute_pipeline_result_digest_with_scientific(
    result: &PipelineV2Result,
    published_outputs_digest: &str,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
    scientific_evidence: Option<&RuntimeScientificEvidenceSummary>,
) -> String {
    let mut digest = Sha256::new();
    digest.update((IMPLEMENTATION_BUILD_DIGEST.len() as u64).to_le_bytes());
    digest.update(IMPLEMENTATION_BUILD_DIGEST.as_bytes());
    digest.update((BUILD_ENVIRONMENT_DIGEST.len() as u64).to_le_bytes());
    digest.update(BUILD_ENVIRONMENT_DIGEST.as_bytes());
    // The published-output commitment already binds every output kind, byte
    // length, row count, and SHA-256. Re-hashing the full CSV/JSON payloads here
    // made provenance construction traverse the largest outputs a second time.
    digest.update((published_outputs_digest.len() as u64).to_le_bytes());
    digest.update(published_outputs_digest.as_bytes());
    // JCS emits many tiny writes for each lineage field. Batch them before
    // SHA-256 while preserving the exact canonical byte stream.
    let mut writer = BufWriter::with_capacity(64 * 1024, Sha256Writer(&mut digest));
    let lineage = &result.row_lineage;
    let mut members: Vec<CanonicalMember<'_, BufWriter<Sha256Writer<'_>>>> = vec![
        canonical_member("original", &result.original_row_count),
        canonical_member("processed", &result.processed_row_count),
        canonical_member("app", &result.app_row_count),
        canonical_member("screen", &result.screen_row_count),
        canonical_member(
            "duplicateTimestampsCorrected",
            &result.duplicate_timestamps_corrected,
        ),
        canonical_member(
            "exactDuplicateRowsRemoved",
            &result.exact_duplicate_rows_removed,
        ),
        canonical_member("cleaningCounts", &result.cleaning_counts),
        canonical_member("availableTimezones", &result.available_timezones),
        canonical_member("timezone", &result.timezone),
        canonical_member("timezoneAction", &result.timezone_action),
        canonical_member(
            "rowsBeforeTimezoneHandling",
            &result.rows_before_timezone_handling,
        ),
        canonical_member(
            "rowsAfterTimezoneHandling",
            &result.rows_after_timezone_handling,
        ),
        canonical_member("rowsRemovedByTimezone", &result.rows_removed_by_timezone),
        canonical_member(
            "timezoneRetainedSourceRowsDigest",
            &result.timezone_retained_source_rows_digest,
        ),
        canonical_member("timezoneStageDigest", &result.timezone_stage_digest),
        (
            "rowLineage",
            Box::new(move |writer: &mut BufWriter<Sha256Writer<'_>>| {
                // One serializer reuses its field buffers across all rows.
                // The outer array streams directly to the hashing buffer.
                chronicle_chrono_kernel_wasm::jcs::to_writer(&mut *writer, lineage)
                    .map_err(|error| error.to_string())
            }),
        ),
        canonical_member(
            "workflowQueryGroupDigests",
            &result.workflow_query_group_digests,
        ),
        canonical_member(
            "workflowQueryGroupCheckpoints",
            &result.workflow_query_group_checkpoints,
        ),
        canonical_member("workflowQueryDigests", &result.workflow_query_digests),
        canonical_member(
            "workflowQueryCheckpoints",
            &result.workflow_query_checkpoints,
        ),
        canonical_member("openerSetReceipt", &result.opener_set_evidence),
        canonical_member(
            "eyesTaggedFauArtifactDigest",
            &eyes_evidence.tagged_fau_artifact_digest,
        ),
        canonical_member(
            "eyesValidationReceiptArtifactDigest",
            &eyes_evidence.validation_receipt_artifact_digest,
        ),
    ];
    if let Some(receipt) = result.maximum_duration_evidence.as_ref() {
        members.push(canonical_member("maximumDurationReceipt", receipt));
    }
    if let Some(evidence) = scientific_evidence {
        members.push(canonical_member("scientificEvidence", evidence));
    }
    write_canonical_object(&mut writer, members)
        .expect("pipeline result digest metadata is serializable");
    writer.flush().expect("pipeline result digest writer flushes");
    drop(writer);
    format!("sha256:{}", hex::encode(digest.finalize()))
}

type CanonicalMember<'a, W> = (
    &'static str,
    Box<dyn FnOnce(&mut W) -> Result<(), String> + 'a>,
);

fn canonical_member<'a, W: Write, T: Serialize + ?Sized + 'a>(
    key: &'static str,
    value: &'a T,
) -> CanonicalMember<'a, W> {
    (
        key,
        Box::new(move |writer: &mut W| {
            chronicle_chrono_kernel_wasm::jcs::to_writer(&mut *writer, value)
                .map_err(|error| error.to_string())
        }),
    )
}

/// RFC 8785 canonical JSON of one object, streamed member by member: names
/// sorted by UTF-16 code units, each value canonicalized straight into the
/// writer. `serde_jcs` buffers every member's full text before sorting, which
/// for the provenance record meant the entire row lineage JSON sat in memory
/// next to the result. Same bytes, one lineage entry buffered at a time.
fn write_canonical_object<W: Write>(
    writer: &mut W,
    mut members: Vec<CanonicalMember<'_, W>>,
) -> Result<(), String> {
    members.sort_by_cached_key(|(key, _)| key.encode_utf16().collect::<Vec<u16>>());
    writer.write_all(b"{").map_err(|error| error.to_string())?;
    for (index, (key, write_value)) in members.into_iter().enumerate() {
        if index > 0 {
            writer.write_all(b",").map_err(|error| error.to_string())?;
        }
        serde_jcs::to_writer(&mut *writer, key).map_err(|error| error.to_string())?;
        writer.write_all(b":").map_err(|error| error.to_string())?;
        write_value(writer)?;
    }
    writer.write_all(b"}").map_err(|error| error.to_string())
}

/// Digest only researcher-visible computational outputs. Configuration choice
/// and lineage remain separately observable in `compute_pipeline_result_digest`, so
/// equal bytes can collapse without erasing how those bytes were obtained.
#[derive(Clone)]
struct PipelineResultDigests {
    published_outputs_digest: String,
    provenance_digest: String,
    output_digests: BTreeMap<String, String>,
}

#[cfg(test)]
fn pipeline_result_digests(
    result: &PipelineV2Result,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
) -> PipelineResultDigests {
    pipeline_result_digests_with_optional_scientific(result, eyes_evidence, None)
        .expect("pipeline outputs readable")
}

fn pipeline_result_digests_with_scientific(
    result: &PipelineV2Result,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
    scientific_evidence: &RuntimeScientificEvidenceSummary,
) -> Result<PipelineResultDigests, String> {
    pipeline_result_digests_with_optional_scientific(
        result,
        eyes_evidence,
        Some(scientific_evidence),
    )
}

fn pipeline_result_digests_with_optional_scientific(
    result: &PipelineV2Result,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
    scientific_evidence: Option<&RuntimeScientificEvidenceSummary>,
) -> Result<PipelineResultDigests, String> {
    let mut output_digests = BTreeMap::new();
    let mut published = Sha256::new();
    let mut fixed_outputs = vec![
        (
            "app-csv",
            &result.app_csv_bytes,
            result.app_row_count,
        ),
        (
            "screen-csv",
            &result.screen_csv_bytes,
            result.screen_row_count,
        ),
        (
            "day-coverage-csv",
            &result.day_coverage_csv_bytes,
            result.day_coverage_row_count,
        ),
        (
            "compliance-csv",
            &result.compliance_csv_bytes,
            result.compliance_row_count,
        ),
        (
            "credited-app-csv",
            &result.credited_app_csv_bytes,
            result.credited_app_row_count,
        ),
        (
            "notification-contact-csv",
            &result.notification_contact_csv_bytes,
            result.notification_contact_row_count,
        ),
        (
            "polled-emulation-csv",
            &result.polled_emulation_csv_bytes,
            result.polled_emulation_row_count,
        ),
        (
            "review-summary-json",
            &result.review_summary_json_bytes,
            0,
        ),
        (
            "visualization-data-json",
            &result.visualization_data_json_bytes,
            0,
        ),
    ];
    if !result.interval_expansion_csv_bytes.is_empty() {
        fixed_outputs.push((
            "interval-expansion-csv",
            &result.interval_expansion_csv_bytes,
            result.interval_expansion_row_count,
        ));
    }
    let output_count = fixed_outputs.len() + result.aggregate_csv_outputs.len();
    published.update(b"chronicle-published-outputs-digest/v2");
    published.update((output_count as u64).to_le_bytes());
    for (kind, bytes, row_count) in
        fixed_outputs
            .into_iter()
            .chain(result.aggregate_csv_outputs.iter().map(|aggregate| {
                (
                    aggregate.kind.as_str(),
                    &aggregate.bytes,
                    aggregate.row_count,
                )
            }))
    {
        let digest = sha256_payload(bytes)?;
        for field in [kind.as_bytes(), digest.as_bytes()] {
            published.update((field.len() as u64).to_le_bytes());
            published.update(field);
        }
        published.update((bytes.len() as u64).to_le_bytes());
        published.update(row_count.to_le_bytes());
        output_digests.insert(kind.to_string(), digest);
    }
    let published_outputs_digest = format!("sha256:{}", hex::encode(published.finalize()));
    let provenance_digest = compute_pipeline_result_digest_with_scientific(
        result,
        published_outputs_digest.as_str(),
        eyes_evidence,
        scientific_evidence,
    );
    Ok(PipelineResultDigests {
        published_outputs_digest,
        provenance_digest,
        output_digests,
    })
}

/// Project the stable Rust ABI onto the product plan's option vocabulary.
///
/// The plan intentionally uses product-facing semantic names while the fused
/// kernel retains its established wire field names. Keeping this adapter
/// explicit prevents the reusable scheduler from learning Chronicle-specific
/// aliases and makes every applicability/invalidation input inspectable.
fn semantic_options_value(options: &PipelineV2OptionsJson) -> Result<Value, String> {
    let mut value = serde_json::to_value(options)
        .map_err(|error| format!("serialize semantic options: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "serialized semantic options must be an object".to_string())?;
    // Legacy native callers omit this newly introduced option. The typed
    // boundary tracks that omission to preserve their exact request bytes,
    // while the certified semantic projection binds the compatibility value
    // explicitly so receipts and workflow keys can verify it.
    object
        .entry("interval_expansion_method")
        .or_insert_with(|| Value::String("none".into()));
    object
        .entry("interaction_type_removal_mode")
        .or_insert_with(|| Value::String("gap_preserving".into()));
    object
        .entry("aggregate_top_apps_limit")
        .or_insert_with(|| Value::from(0));
    object
        .entry("filter_match_field")
        .or_insert_with(|| Value::String("app_package_name".into()));
    object
        .entry("application_label_exclusions")
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("drop_out_of_source_order_events")
        .or_insert_with(|| Value::Bool(false));
    object
        .entry("screen_session_classification_policy")
        .or_insert_with(|| Value::String("none".into()));
    object
        .entry("screen_session_maximum_duration_minutes")
        .or_insert_with(|| Value::from(0.0));
    object
        .entry("screen_session_maximum_duration_disposition")
        .or_insert_with(|| Value::String("none".into()));
    object
        .entry("locked_screen_audio_disposition")
        .or_insert_with(|| Value::String("include".into()));
    // Optional wire field: the browser sends it only when on, so an off
    // request keeps its exact bytes; the certified projection binds `false`.
    object
        .entry("neutralize_spreadsheet_formulas")
        .or_insert_with(|| Value::Bool(false));
    object
        .entry("bridge_screen_off_to_session_end")
        .or_insert_with(|| Value::Bool(false));
    for (key, value) in [
        (
            "process_app_usage",
            Value::Bool(matches!(
                options.usage_session_mode.as_str(),
                "app_usage" | "app_and_screen_usage"
            )),
        ),
        (
            "process_screen_usage",
            Value::Bool(matches!(
                options.usage_session_mode.as_str(),
                "screen_usage" | "app_and_screen_usage"
            )),
        ),
        ("selected_timezone", Value::String(options.timezone.clone())),
        (
            "use_apps_forcing_screen_open_file",
            Value::Bool(options.use_apps_forcing_screen_open),
        ),
        (
            "long_duration_threshold_hours",
            Value::from(options.long_duration_threshold_ns as f64 / 3_600_000_000_000.0),
        ),
        (
            "proximity_interval_seconds",
            Value::from(options.proximity_interval_ns as f64 / 1_000_000_000.0),
        ),
        (
            "same_app_interaction_types_to_stop_usage_at",
            Value::from(options.same_app_stop_types.clone()),
        ),
        (
            "other_interaction_types_to_stop_usage_at",
            Value::from(options.other_stop_types.clone()),
        ),
        (
            "screen_usage_auto_lock_timeout_seconds",
            Value::from(options.screen_auto_lock_timeout_seconds),
        ),
        (
            "screen_usage_auto_lock_tolerance_seconds",
            Value::from(options.screen_auto_lock_tolerance_seconds),
        ),
        (
            "screen_usage_manual_lock_max_tail_gap_seconds",
            Value::from(options.screen_manual_lock_max_tail_seconds),
        ),
        (
            "screen_usage_keyguard_near_stop_seconds",
            Value::from(options.screen_keyguard_near_stop_seconds),
        ),
        // B06: the four selection keys are omitted from the exact wire when
        // absent (own-property presence is the omitted/explicit distinction),
        // so the certified projection carries them as null; the browser's
        // presence marker `long_duration_threshold_hours_explicit` is the
        // exact field `long_duration_threshold_explicit`.
        (
            "maximum_duration_policy",
            Value::from(options.maximum_duration_policy.clone()),
        ),
        (
            "maximum_duration_disposition",
            Value::from(options.maximum_duration_disposition.clone()),
        ),
        (
            "maximum_duration_threshold_source",
            Value::from(options.maximum_duration_threshold_source.clone()),
        ),
        (
            "maximum_duration_threshold_ns",
            Value::from(options.maximum_duration_threshold_ns.clone()),
        ),
        (
            "long_duration_threshold_hours_explicit",
            Value::from(options.long_duration_threshold_explicit),
        ),
    ] {
        object.insert(key.into(), value);
    }
    object.retain(|key, _| CERTIFIED_OPTION_KEYS.contains(&key.as_str()));
    let actual_keys = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected_keys = CERTIFIED_OPTION_KEYS
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if actual_keys != expected_keys {
        return Err(format!(
            "semantic option projection does not match the dependency certificate: missing={:?} unexpected={:?}",
            expected_keys.difference(&actual_keys).collect::<Vec<_>>(),
            actual_keys.difference(&expected_keys).collect::<Vec<_>>(),
        ));
    }
    Ok(value)
}

/// Exact-serialization option keys that [`semantic_options_value`] renames or
/// derives before the certified-key filter. Every exact key absent from this
/// table projects to itself. The influence witness resolves option scopes
/// (exact top-level keys of the `processing_options` document) against plan
/// knobs (certified keys) through this same table, so the two spaces cannot
/// drift apart silently.
pub(crate) const EXACT_TO_CERTIFIED_OPTION_KEYS: &[(&str, &[&str])] = &[
    (
        "usage_session_mode",
        &["process_app_usage", "process_screen_usage"],
    ),
    ("timezone", &["selected_timezone"]),
    (
        "use_apps_forcing_screen_open",
        &["use_apps_forcing_screen_open_file"],
    ),
    (
        "long_duration_threshold_ns",
        &["long_duration_threshold_hours"],
    ),
    ("proximity_interval_ns", &["proximity_interval_seconds"]),
    (
        "same_app_stop_types",
        &["same_app_interaction_types_to_stop_usage_at"],
    ),
    (
        "other_stop_types",
        &["other_interaction_types_to_stop_usage_at"],
    ),
    (
        "screen_auto_lock_timeout_seconds",
        &["screen_usage_auto_lock_timeout_seconds"],
    ),
    (
        "screen_auto_lock_tolerance_seconds",
        &["screen_usage_auto_lock_tolerance_seconds"],
    ),
    (
        "screen_manual_lock_max_tail_seconds",
        &["screen_usage_manual_lock_max_tail_gap_seconds"],
    ),
    (
        "screen_keyguard_near_stop_seconds",
        &["screen_usage_keyguard_near_stop_seconds"],
    ),
    (
        "long_duration_threshold_explicit",
        &["long_duration_threshold_hours_explicit"],
    ),
];

/// Whether influence through the exact-serialization option key reaches the
/// given certified option key after the [`semantic_options_value`] projection.
pub(crate) fn exact_option_key_reaches_certified(exact_key: &str, certified_key: &str) -> bool {
    match EXACT_TO_CERTIFIED_OPTION_KEYS
        .iter()
        .find(|(exact, _)| *exact == exact_key)
    {
        Some((_, certified)) => certified.contains(&certified_key),
        None => exact_key == certified_key,
    }
}

/// Product support artifacts injected by registered semantic role. Adding a
/// role does not change the execution ABI or reorder existing inputs.
#[wasm_bindgen]
#[derive(Default)]
pub struct RuntimeSupportFiles {
    files: BTreeMap<String, RuntimeSupportFile>,
    resolved_without_capability: OnceLock<Result<Arc<ResolvedSupportFiles>, String>>,
    resolved_with_capability: OnceLock<Result<Arc<ResolvedSupportFiles>, String>>,
}

struct RuntimeSupportFile {
    name: String,
    bytes: Vec<u8>,
}

struct ResolvedSupportFile {
    media_type: &'static str,
    original_bytes: Vec<u8>,
    pipeline_csv: Vec<u8>,
    normalized_from_xlsx: bool,
    content_validation_error: Option<String>,
}

#[derive(Default)]
struct ResolvedSupportFiles {
    files: BTreeMap<String, ResolvedSupportFile>,
}

#[wasm_bindgen]
impl RuntimeSupportFiles {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&mut self, role: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.put_native(role, &format!("{role}.csv"), bytes)
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn put_with_name(&mut self, role: &str, name: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.put_native(role, name, bytes)
            .map_err(|error| JsValue::from_str(&error))
    }
}

impl RuntimeSupportFiles {
    fn put_native(&mut self, role: &str, name: &str, bytes: &[u8]) -> Result<(), String> {
        if !is_registered_support_role(role) {
            return Err(format!("unsupported support role: {role}"));
        }
        if bytes.is_empty() {
            return Err(format!(
                "support role {role} cannot contain an empty artifact"
            ));
        }
        if name.trim().is_empty() {
            return Err(format!("support role {role} requires a file name"));
        }
        if self.files.contains_key(role) {
            return Err(format!("duplicate support role: {role}"));
        }
        let _ = self.resolved_without_capability.take();
        let _ = self.resolved_with_capability.take();
        self.files.insert(
            role.into(),
            RuntimeSupportFile {
                name: name.into(),
                bytes: bytes.to_vec(),
            },
        );
        Ok(())
    }

    fn resolve(
        &self,
        use_input_capability_evidence: bool,
    ) -> Result<Arc<ResolvedSupportFiles>, String> {
        let cache = if use_input_capability_evidence {
            &self.resolved_with_capability
        } else {
            &self.resolved_without_capability
        };
        cache
            .get_or_init(|| {
                let mut resolved = ResolvedSupportFiles::default();
                for (role, file) in &self.files {
                    if role == "input_capability_evidence_file" {
                        if !use_input_capability_evidence {
                            // A retained inactive upload is deliberately not
                            // inspected, normalized, assigned, or cached.
                            continue;
                        }
                        if !file.name.to_ascii_lowercase().ends_with(".csv") {
                            return Err(
                                "input_capability_evidence_file must use the .csv format".into(),
                            );
                        }
                        resolved.files.insert(
                            role.clone(),
                            ResolvedSupportFile {
                                media_type: "text/csv",
                                original_bytes: file.bytes.clone(),
                                pipeline_csv: file.bytes.clone(),
                                normalized_from_xlsx: false,
                                // The kernel is the sole parser and validator
                                // for this source-sensitive scientific input.
                                content_validation_error: None,
                            },
                        );
                        continue;
                    }
                    let lower = file.name.to_ascii_lowercase();
                    let (media_type, pipeline_csv, normalized_from_xlsx) =
                        if lower.ends_with(".csv") {
                            ("text/csv", file.bytes.clone(), false)
                        } else if lower.ends_with(".xlsx") {
                            (
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                xlsx_to_csv(&file.bytes).map_err(|error| {
                                    format!("{role} ({name}): {error}", name = file.name)
                                })?,
                                true,
                            )
                        } else if lower.ends_with(".xls") {
                            return Err(format!(
                                "unsupported support file format for {role}: {}. Convert legacy .xls workbooks to .xlsx or CSV",
                                file.name
                            ));
                        } else {
                            return Err(format!(
                                "unsupported support file format for {role}: {}",
                                file.name
                            ));
                        };
                    let content_validation_error =
                        chronicle_chrono_kernel_wasm::pipeline_v2::validate_support_csv(
                            role,
                            &pipeline_csv,
                        )
                        .err();
                    resolved.files.insert(
                        role.clone(),
                        ResolvedSupportFile {
                            media_type,
                            original_bytes: file.bytes.clone(),
                            pipeline_csv,
                            normalized_from_xlsx,
                            content_validation_error,
                        },
                    );
                }
                Ok(Arc::new(resolved))
            })
            .clone()
    }
}

impl ResolvedSupportFiles {
    fn get(&self, role: &str) -> &[u8] {
        self.files
            .get(role)
            .map(|file| file.pipeline_csv.as_slice())
            .unwrap_or_default()
    }

    fn pipeline_files<'a>(
        &'a self,
        computation_options_digest: &'a str,
        assignments: &'a BTreeMap<String, RoleAssignment>,
        fragmented_participant_ids: &'a [String],
    ) -> PipelineV2SupportFiles<'a> {
        let capability_assignment = assignments.get("input_capability_evidence_file");
        PipelineV2SupportFiles {
            filter_csv: self.get("filter_file"),
            apps_forcing_csv: self.get("apps_forcing_screen_open_file"),
            background_apps_csv: self.get("background_apps_file"),
            codebook_csv: self.get("app_codebook_file"),
            study_dates_csv: self.get("study_dates_file"),
            device_sharing_csv: self.get("device_sharing_file"),
            survey_attribution_csv: self.get("survey_attribution_file"),
            enrolled_devices_csv: self.get("enrolled_devices_file"),
            input_capability_evidence_csv: self.get("input_capability_evidence_file"),
            verified_request_options_digest: Some(computation_options_digest),
            verified_input_capability_evidence_artifact_digest: capability_assignment
                .map(|assignment| assignment.artifact.digest.as_str()),
            verified_input_capability_evidence_assignment_digest: capability_assignment
                .map(|assignment| assignment.assignment_id.as_str()),
            fragmented_participant_ids,
        }
    }
}

fn uses_input_capability_evidence(options: &PipelineV2Options) -> bool {
    let source_sensitive_screen = b05_schoedel_is_active(options)
        && options.screen_session_construction_strategy
            != ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1;
    let schoedel_app = matches!(
        options.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    ) && options.episode_reconstruction_strategy
        == EpisodeReconstructionStrategy::Schoedel2026AppWithinScreenProseV1;
    source_sensitive_screen || schoedel_app
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSourceRoleIdentity {
    artifact_digest: String,
    assignment_id: String,
}

#[derive(Serialize)]
struct RuntimeQueryKeyMaterial<'a> {
    implementation_digest: &'static str,
    build_environment_digest: &'static str,
    query_closure_digest: &'a str,
    applicable: bool,
    upstream: BTreeMap<String, String>,
    request_fields: BTreeMap<String, Value>,
    source_roles: BTreeMap<String, Option<RuntimeSourceRoleIdentity>>,
    output_mode: Option<&'static str>,
}

fn query_output_mode(
    review_behavior: ReviewBehavior,
    materialize_full_outputs: bool,
) -> Option<&'static str> {
    (review_behavior != ReviewBehavior::Execute).then_some(if materialize_full_outputs {
        "full"
    } else {
        "review"
    })
}

fn active_source_roles(
    query_id: &str,
    exact_options: &serde_json::Map<String, Value>,
    assignments: &BTreeMap<String, RoleAssignment>,
) -> BTreeMap<String, Option<RuntimeSourceRoleIdentity>> {
    query_source_role_bindings(query_id)
        .into_iter()
        .filter_map(|binding| {
            let active = binding.when_all.iter().all(|predicate| match predicate {
                QuerySourceRolePredicate::BooleanEquals {
                    request_field,
                    value,
                } => exact_options
                    .get(*request_field)
                    .and_then(Value::as_bool)
                    .is_some_and(|actual| actual == *value),
                QuerySourceRolePredicate::StringOneOf {
                    request_field,
                    values,
                } => exact_options
                    .get(*request_field)
                    .and_then(Value::as_str)
                    .is_some_and(|actual| values.contains(&actual)),
            });
            active.then(|| {
                let role = binding.role;
                (
                    role.to_string(),
                    assignments
                        .get(role)
                        .map(|assignment| RuntimeSourceRoleIdentity {
                            artifact_digest: assignment.artifact.digest.clone(),
                            assignment_id: assignment.assignment_id.clone(),
                        }),
                )
            })
        })
        .collect()
}

const FOUNDATIONAL_SCIENTIFIC_QUERY_ROOTS: &[&str] = &[
    "classify_episode_durations",
    "segment_concurrent_usage",
    "remove_selected_interaction_types",
];
const B05_SCREEN_SCIENTIFIC_QUERY_ROOTS: &[&str] = &["construct_screen_intervals"];
const SCHOEDEL_SCIENTIFIC_QUERY_ROOTS: &[&str] = &["match_app_episodes"];

fn scientific_query_cone(query_roots: &[&str]) -> BTreeSet<&'static str> {
    let definitions = WORKFLOW_QUERIES
        .iter()
        .map(|definition| (definition.id, definition))
        .collect::<BTreeMap<_, _>>();
    let mut pending = query_roots.to_vec();
    let mut cone = BTreeSet::new();
    while let Some(query_id) = pending.pop() {
        let Some(definition) = definitions.get(query_id) else {
            continue;
        };
        if cone.insert(definition.id) {
            pending.extend(definition.inputs.iter().copied());
        }
    }
    cone
}

fn scientific_assignments_for_query_cone(
    exact_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
    query_executions: &[RuntimeQueryExecution],
    query_roots: &[&str],
) -> BTreeMap<String, RoleAssignment> {
    let exact_options = exact_options
        .as_object()
        .expect("exact options serialize as an object");
    let mut active_roles = BTreeSet::from([
        "raw_chronicle_csv".to_string(),
        "processing_options".to_string(),
    ]);
    let bypassed = query_executions
        .iter()
        .filter(|execution| execution.status == ExecutionStatus::Bypassed)
        .map(|execution| execution.query_id.as_str())
        .collect::<BTreeSet<_>>();
    for query_id in scientific_query_cone(query_roots) {
        if bypassed.contains(query_id) {
            continue;
        }
        for (role, assignment) in active_source_roles(query_id, exact_options, assignments) {
            if assignment.is_some() {
                active_roles.insert(role);
            }
        }
    }
    active_roles
        .into_iter()
        .filter_map(|role| {
            assignments
                .get(&role)
                .cloned()
                .map(|assignment| (role, assignment))
        })
        .collect()
}

struct RuntimeScientificAssignmentSets {
    foundational: BTreeMap<String, RoleAssignment>,
    screen: BTreeMap<String, RoleAssignment>,
    schoedel: BTreeMap<String, RoleAssignment>,
}

impl RuntimeScientificAssignmentSets {
    fn active_union(&self) -> BTreeMap<String, RoleAssignment> {
        self.foundational
            .iter()
            .chain(&self.screen)
            .chain(&self.schoedel)
            .map(|(role, assignment)| (role.clone(), assignment.clone()))
            .collect()
    }
}

fn runtime_scientific_assignment_sets(
    exact_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
    query_executions: &[RuntimeQueryExecution],
) -> RuntimeScientificAssignmentSets {
    RuntimeScientificAssignmentSets {
        foundational: scientific_assignments_for_query_cone(
            exact_options,
            assignments,
            query_executions,
            FOUNDATIONAL_SCIENTIFIC_QUERY_ROOTS,
        ),
        screen: scientific_assignments_for_query_cone(
            exact_options,
            assignments,
            query_executions,
            B05_SCREEN_SCIENTIFIC_QUERY_ROOTS,
        ),
        schoedel: scientific_assignments_for_query_cone(
            exact_options,
            assignments,
            query_executions,
            SCHOEDEL_SCIENTIFIC_QUERY_ROOTS,
        ),
    }
}








/// Which receipt field diverged from this build, or `None` when the evidence is
/// current.
///
/// This exists so a stale certificate can NAME ITSELF. When it is stale,
/// `evaluate_dependency_cache_decision` returns `ConservativeFull`, which wipes
/// the Salsa engine and every projection cache on each run — so roughly seven
/// warm-reuse tests fail with messages about warm reuse and none of them
/// mentions the certificate. The cause is one field of one JSON file and the
/// cure is one command, but nothing in the failure says so. Editing any Rust
/// source after an evidence run reaches this state, and `make all` cannot
/// recover on its own because it never regenerates the evidence.
#[cfg(not(feature = "dependency-campaign-bootstrap"))]
fn dependency_evidence_staleness(
    certificate: &chronicle_preprocessing_semantic_adapter::DependencyCertificate,
) -> Option<String> {
    let receipt = &certificate.evidence.implementation_receipt;
    let mismatch = |field: &str, recorded: &str, built: &str| {
        Some(format!(
            "dependency certificate is stale: {field} recorded={recorded} built={built}\n\
             The empirical evidence no longer describes this source tree, so the runtime \
             falls back to DependencyCacheMode::ConservativeFull and rebuilds from cold on \
             every run.\n\
             Fix: run `make dependency-evidence` with NO Rust edit in flight (it builds WASM \
             from the live worktree), then re-run the tests."
        ))
    };
    if receipt.implementation != "chronicle_preprocessing_runtime_wasm/0.1.0" {
        return mismatch(
            "implementation",
            &receipt.implementation,
            "chronicle_preprocessing_runtime_wasm/0.1.0",
        );
    }
    if receipt.implementation_digest != IMPLEMENTATION_BUILD_DIGEST {
        return mismatch(
            "implementation_digest",
            &receipt.implementation_digest,
            IMPLEMENTATION_BUILD_DIGEST,
        );
    }
    if receipt.plan_digest != EMBEDDED_PLAN_SHA256 {
        return mismatch("plan_digest", &receipt.plan_digest, EMBEDDED_PLAN_SHA256);
    }
    if receipt.profile_digest != EMBEDDED_PROFILE_SHA256 {
        return mismatch(
            "profile_digest",
            &receipt.profile_digest,
            EMBEDDED_PROFILE_SHA256,
        );
    }
    if receipt.profile_lock_digest != EMBEDDED_PROFILE_LOCK_SHA256 {
        return mismatch(
            "profile_lock_digest",
            &receipt.profile_lock_digest,
            EMBEDDED_PROFILE_LOCK_SHA256,
        );
    }
    if receipt.runtime_authority_digest != EMBEDDED_RUNTIME_AUTHORITY_SHA256 {
        return mismatch(
            "runtime_authority_digest",
            &receipt.runtime_authority_digest,
            EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        );
    }
    if receipt.product_contract_digest != EMBEDDED_PRODUCT_CONTRACT_SHA256 {
        return mismatch(
            "product_contract_digest",
            &receipt.product_contract_digest,
            EMBEDDED_PRODUCT_CONTRACT_SHA256,
        );
    }
    None
}

/// Campaign-footprint capture (Ekstazi-style selection evidence). Present
/// only in the throwaway bootstrap campaign WASM: returns the LLVM profraw
/// counters accumulated in this instance so the dependency-evidence refresh
/// can record which production source files each campaign actually executed.
#[cfg(feature = "dependency-campaign-bootstrap")]
#[wasm_bindgen]
pub fn capture_coverage_profraw() -> Result<Vec<u8>, JsValue> {
    footprint_capture::capture_coverage_no_value_profile()
        .map_err(|code| JsValue::from_str(&format!("lprofWriteData failed: {code}")))
}

// The C profile runtime (lprofWriteData and the counter/data section symbols)
// is bundled inside the minicov rlib; an explicit extern-crate keeps it in the
// link because no minicov Rust function is called directly.
#[cfg(feature = "dependency-campaign-bootstrap")]
extern crate minicov;

#[cfg(feature = "dependency-campaign-bootstrap")]
mod footprint_capture {
    //! Coverage-only profraw capture. `minicov::capture_coverage` always hands
    //! the vendored runtime its value-profile reader, whose per-record data
    //! walk faults on this module (value profiling exists for PGO and carries
    //! nothing `-Cinstrument-coverage` needs). `writeValueProfData` documents a
    //! NULL reader as a clean no-op, and the data/counter/name sections are
    //! written as raw section copies before it runs, so this calls the same
    //! linked `lprofWriteData` with a NULL reader instead.
    #![allow(non_snake_case)]

    #[repr(C)]
    struct ProfDataIOVec {
        Data: *mut u8,
        ElmSize: usize,
        NumElm: usize,
        UseZeroPadding: i32,
    }

    #[repr(C)]
    struct ProfDataWriter {
        Write: unsafe extern "C" fn(*mut ProfDataWriter, *mut ProfDataIOVec, u32) -> u32,
        WriterCtx: *mut u8,
    }

    enum VPDataReaderType {}

    extern "C" {
        fn lprofWriteData(
            Writer: *mut ProfDataWriter,
            VPDataReader: *mut VPDataReaderType,
            SkipNameDataWrite: i32,
        ) -> i32;
    }

    unsafe extern "C" fn write_to_vec(
        this: *mut ProfDataWriter,
        iovecs: *mut ProfDataIOVec,
        num_iovecs: u32,
    ) -> u32 {
        let out = &mut *((*this).WriterCtx as *mut Vec<u8>);
        for iov in core::slice::from_raw_parts(iovecs, num_iovecs as usize) {
            let len = iov.ElmSize * iov.NumElm;
            if iov.Data.is_null() {
                out.resize(out.len() + len, 0);
            } else {
                out.extend_from_slice(core::slice::from_raw_parts(iov.Data, len));
            }
        }
        0
    }

    /// Capture counters + mapping data as profraw bytes, skipping the
    /// value-profile section entirely.
    pub fn capture_coverage_no_value_profile() -> Result<Vec<u8>, i32> {
        let mut out: Vec<u8> = Vec::new();
        let mut writer = ProfDataWriter {
            Write: write_to_vec,
            WriterCtx: &mut out as *mut Vec<u8> as *mut u8,
        };
        let res = unsafe { lprofWriteData(&mut writer, core::ptr::null_mut(), 0) };
        if res == 0 {
            Ok(out)
        } else {
            Err(res)
        }
    }
}

fn dependency_evidence_current(
    certificate: &chronicle_preprocessing_semantic_adapter::DependencyCertificate,
) -> bool {
    #[cfg(feature = "dependency-campaign-bootstrap")]
    {
        // This build exists only so a changed implementation can regenerate
        // the evidence that production requires. Its package is temporary and
        // its distinct build-environment digest makes the mode observable.
        let _ = certificate;
        true
    }

    #[cfg(not(feature = "dependency-campaign-bootstrap"))]
    {
        dependency_evidence_staleness(certificate).is_none()
    }
}


fn write_csv_cell(output: &mut Vec<u8>, value: &str) {
    if value.contains([',', '"', '\n', '\r']) {
        output.push(b'"');
        for byte in value.bytes() {
            if byte == b'"' {
                output.push(b'"');
            }
            output.push(byte);
        }
        output.push(b'"');
    } else {
        output.extend_from_slice(value.as_bytes());
    }
}

fn xlsx_to_csv(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut workbook = Xlsx::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let sheet = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "workbook contains no worksheets".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| error.to_string())?;
    let mut output = Vec::new();
    for row in range.rows() {
        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                output.push(b',');
            }
            // `Display` writes a date-formatted cell as its bare serial
            // ("45108"), so no workbook could carry a study window or a
            // timestamp column. Durations keep their serial.
            let text = match cell {
                calamine::Data::DateTime(value) if value.is_datetime() => {
                    let (year, month, day, hour, minute, second, milli) =
                        value.to_ymd_hms_milli();
                    if (hour, minute, second, milli) == (0, 0, 0, 0) {
                        format!("{year:04}-{month:02}-{day:02}")
                    } else if milli == 0 {
                        format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
                    } else {
                        // Survey rows are joined to raw events by exact
                        // instant, so sub-second time must survive.
                        format!(
                            "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{milli:03}"
                        )
                    }
                }
                other => other.to_string(),
            };
            write_csv_cell(&mut output, &text);
        }
        output.push(b'\n');
    }
    Ok(output)
}

#[wasm_bindgen]
impl RuntimeHandle {
    pub fn manifest_json(&self) -> String {
        self.manifest_json.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn artifact_count(&self) -> u32 {
        self.artifacts.len() as u32
    }

    pub fn artifact_metadata_json(&self, index: u32) -> Result<String, JsValue> {
        let artifact = self
            .artifacts
            .get(index as usize)
            .ok_or_else(|| JsValue::from_str("artifact index out of range"))?;
        serde_json::to_string(&artifact.metadata)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn take_artifact_bytes(&mut self, index: u32) -> Result<Vec<u8>, JsValue> {
        let artifact = self
            .artifacts
            .get_mut(index as usize)
            .ok_or_else(|| JsValue::from_str("artifact index out of range"))?;
        // Reload every chunk before taking the bytes, so a failed reload
        // leaves the artifact in place instead of consuming it.
        artifact
            .bytes
            .for_each_chunk(|_| {})
            .map_err(|error| JsValue::from_str(&error))?;
        std::mem::take(&mut artifact.bytes)
            .into_vec()
            .map_err(|error| JsValue::from_str(&error))
    }
}

#[wasm_bindgen]
pub fn review_base_probe_spec_json() -> String {
    serde_json::json!({
        "reviewBaseBytes": PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes(),
        "reconstructionBaseBytes": PERSISTED_BASE_RUNTIME_HEADER_BYTES
            + reconstruction_base_header_bytes(),
    })
    .to_string()
}

#[wasm_bindgen]
pub fn prepare_workspace_review(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, JsValue> {
    prepare_workspace_review_native(
        request_json,
        csv_bytes,
        review_probe,
        reconstruction_probe,
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Prepare a review from an already verified OPFS workspace. Only the small
/// persisted-base headers cross the boundary until Rust selects the exact
/// compatible base; the unchanged raw file stays in its content-addressed
/// object. A cache miss is reported as `none` and the browser must call the
/// ordinary raw-input API.
#[wasm_bindgen]
pub fn prepare_persisted_workspace_review(
    request_json: &str,
    input_size_bytes: u32,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, JsValue> {
    let prepared = prepare_runtime_workspace_from_persisted_input(
        request_json,
        u64::from(input_size_bytes),
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))?;
    prepare_review_from_prepared(prepared, None, review_probe, reconstruction_probe)
        .map_err(|error| JsValue::from_str(&error))
}

fn prepare_workspace_review_native(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedReviewWorkspace, String> {
    let prepared = prepare_runtime_workspace(request_json, &csv_bytes, support_files)?;
    prepare_review_from_prepared(
        prepared,
        Some(csv_bytes),
        review_probe,
        reconstruction_probe,
    )
}

fn validate_optional_probe_length(
    probe: &[u8],
    expected_bytes: usize,
    label: &str,
) -> Result<(), String> {
    if probe.is_empty() || probe.len() == expected_bytes {
        Ok(())
    } else {
        Err(format!(
            "{label} probe must contain exactly {expected_bytes} bytes"
        ))
    }
}

/// The transferred base must be the object the verified probe was read from:
/// it starts with the probe AND carries a payload after it. Every encoded base
/// is its header followed by a non-empty compressed row table, so a transfer of
/// the probe bytes alone (a header-only base) is never a complete base, and by
/// this point the raw CSV has already been dropped.
fn selected_base_matches_probe(probe: &[u8], selected_base: &[u8]) -> bool {
    !probe.is_empty() && selected_base.len() > probe.len() && selected_base.starts_with(probe)
}

fn prepare_review_from_prepared(
    prepared: PreparedRuntimeWorkspace,
    csv_bytes: Option<Vec<u8>>,
    review_probe: &[u8],
    reconstruction_probe: &[u8],
) -> Result<PreparedReviewWorkspace, String> {
    let expected_review_probe_bytes =
        PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
    let expected_reconstruction_probe_bytes =
        PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();
    validate_optional_probe_length(review_probe, expected_review_probe_bytes, "review-base")?;
    validate_optional_probe_length(
        reconstruction_probe,
        expected_reconstruction_probe_bytes,
        "reconstruction-base",
    )?;
    if prepared.request.command != QUERY_REVIEW_COMMAND {
        return Err("prepared review workspace requires QueryReview".into());
    }
    let cache_decision = prepared_cache_decision(&prepared)?;
    let incremental = prepared.request.execution_engine == ExecutionEngine::Incremental;
    let warm_verified_input = incremental
        && cache_decision.mode == DependencyCacheMode::CertifiedNarrow
        && INCREMENTAL_RUNTIME_STATES.with(|states| {
            states.borrow().has_warm_review_input(
                &prepared.request.workspace_id,
                prepared.request.workspace_root_digest.as_deref(),
                &prepared.request.input_sha256,
            )
        });
    let selection = if warm_verified_input {
        PersistedReviewBaseSelection::None
    } else if incremental && cache_decision.mode == DependencyCacheMode::CertifiedNarrow {
        let review_header = verified_persisted_base_payload(
            review_probe,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base probe",
            cache_decision.mode,
        )?;
        let reconstruction_header = verified_persisted_base_payload(
            reconstruction_probe,
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            "reconstruction base probe",
            cache_decision.mode,
        )?;
        select_persisted_review_base(
            &prepared.request.input_sha256,
            review_header,
            reconstruction_header,
            &prepared.pipeline_options,
            prepared.resolved_support.pipeline_files(
                &prepared.computation_options_digest,
                &prepared.ingress.assignments,
                &prepared.fragmented_participant_ids,
            ),
        )?
    } else {
        PersistedReviewBaseSelection::None
    };
    Ok(PreparedReviewWorkspace {
        prepared: Some(prepared),
        csv_bytes,
        review_probe: review_probe.to_vec(),
        reconstruction_probe: reconstruction_probe.to_vec(),
        selection,
        warm_verified_input,
    })
}

#[wasm_bindgen]
impl PreparedReviewWorkspace {
    pub fn required_base_kind(&self) -> String {
        if self.warm_verified_input {
            return "salsa-memory".into();
        }
        match self.selection {
            PersistedReviewBaseSelection::None => "none",
            PersistedReviewBaseSelection::Review => "review-base",
            PersistedReviewBaseSelection::Reconstruction => "reconstruction-base",
        }
        .into()
    }

    pub fn execute_selected_base(
        &mut self,
        selected_base: Vec<u8>,
    ) -> Result<RuntimeHandle, JsValue> {
        self.execute_selected_base_native(selected_base)
            .map_err(|error| JsValue::from_str(&error))
    }

    /// A reconstruction resume needs both complete envelopes: the
    /// reconstruction base owns the validated reconstruction and foundational
    /// receipts while the independently keyed review base owns the annotation
    /// substrate, and the kernel fails closed on a header-only review base.
    pub fn execute_selected_base_pair(
        &mut self,
        review_base: Vec<u8>,
        reconstruction_base: Vec<u8>,
    ) -> Result<RuntimeHandle, JsValue> {
        self.execute_selected_base_pair_native(review_base, reconstruction_base)
            .map_err(|error| JsValue::from_str(&error))
    }
}

impl PreparedReviewWorkspace {
    fn execute_selected_base_native(
        &mut self,
        selected_base: Vec<u8>,
    ) -> Result<RuntimeHandle, String> {
        if self.prepared.is_none() {
            return Err("prepared review workspace has already executed".into());
        }
        if self.warm_verified_input && !selected_base.is_empty() {
            return Err("warm review must not receive a persisted base".into());
        }
        let (review_base, reconstruction_base) = match self.selection {
            PersistedReviewBaseSelection::None => {
                if !selected_base.is_empty() {
                    return Err("prepared review workspace selected no persisted base".into());
                }
                (Vec::new(), Vec::new())
            }
            PersistedReviewBaseSelection::Review => {
                if !selected_base_matches_probe(&self.review_probe, &selected_base) {
                    return Err("selected review base does not match its verified probe".into());
                }
                (selected_base, Vec::new())
            }
            PersistedReviewBaseSelection::Reconstruction => {
                // The kernel fails closed on a header-only review base for a
                // raw-less reconstruction resume (the reconstruction restore
                // does not self-certify its stored annotation rows), so the
                // caller must transfer both complete envelopes.
                return Err(
                    "reconstruction resume requires the complete review and reconstruction bases"
                        .into(),
                );
            }
        };
        self.finish_selected_bases(review_base, reconstruction_base)
    }

    fn execute_selected_base_pair_native(
        &mut self,
        review_base: Vec<u8>,
        reconstruction_base: Vec<u8>,
    ) -> Result<RuntimeHandle, String> {
        if self.prepared.is_none() {
            return Err("prepared review workspace has already executed".into());
        }
        if self.warm_verified_input {
            return Err("warm review must not receive a persisted base".into());
        }
        if self.selection != PersistedReviewBaseSelection::Reconstruction {
            return Err("prepared review workspace did not select the reconstruction base".into());
        }
        if !selected_base_matches_probe(&self.review_probe, &review_base) {
            return Err("selected review base does not match its verified probe".into());
        }
        if !selected_base_matches_probe(&self.reconstruction_probe, &reconstruction_base) {
            return Err("selected reconstruction base does not match its verified probe".into());
        }
        self.finish_selected_bases(review_base, reconstruction_base)
    }

    fn finish_selected_bases(
        &mut self,
        review_base: Vec<u8>,
        reconstruction_base: Vec<u8>,
    ) -> Result<RuntimeHandle, String> {
        let prepared = self
            .prepared
            .take()
            .ok_or_else(|| "prepared review workspace has already executed".to_string())?;
        let raw_fallback =
            if self.selection == PersistedReviewBaseSelection::None && !self.warm_verified_input {
                Some(self.csv_bytes.take().ok_or_else(|| {
                    "persisted review base did not match; retry with raw input".to_string()
                })?)
            } else {
                self.csv_bytes.take();
                None
            };
        let verified_persisted_input = raw_fallback.is_none();
        execute_prepared_workspace(
            prepared,
            Arc::default(),
            None,
            raw_fallback,
            verified_persisted_input,
            self.warm_verified_input,
            &review_base,
            &reconstruction_base,
        )
    }
}

#[wasm_bindgen]
pub fn execute_workspace(
    request_json: &str,
    csv_bytes: Vec<u8>,
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native_shared(request_json, Arc::new(csv_bytes), &[], &[], support_files)
        .map_err(|error| JsValue::from_str(&error))
}

/// Execute an interactive review with an optional verified early-row cache.
/// The Rust kernel rechecks the cache key against the raw input and all
/// options/support files that can affect those rows; a mismatch is a normal
/// cache miss and runs the raw path.
#[wasm_bindgen]
pub fn execute_workspace_with_review_base(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native_shared(
        request_json,
        Arc::new(csv_bytes),
        review_base_bytes,
        &[],
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Execute an interactive review with independently verified post-review and
/// post-reconstruction checkpoints. The reconstruction header is rejected before payload
/// decompression when any semantic input to reconstruction changed.
#[wasm_bindgen]
pub fn execute_workspace_with_review_bases(
    request_json: &str,
    csv_bytes: Vec<u8>,
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_workspace_native_shared(
        request_json,
        Arc::new(csv_bytes),
        review_base_bytes,
        reconstruction_base_bytes,
        support_files,
    )
    .map_err(|error| JsValue::from_str(&error))
}

/// Resolve product-owned role requirements without executing computation.
/// The browser can render binding holes from this report; ExecuteWorkspace
/// independently enforces the same report and fails closed when it is not
/// ready, so UI validation can never become the only safety boundary.
#[wasm_bindgen]
pub fn evaluate_workspace_requirements(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, JsValue> {
    evaluate_workspace_requirements_native(request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

pub fn evaluate_workspace_requirements_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let verified_input_digest = request.validate(csv_bytes)?;
    let options_value = semantic_options_value(&request.options)?;
    // Cache and provenance identity use the exact Rust request, not the reduced
    // semantic/UI projection. The latter is only for applicability and human
    // explanations. This prevents an accepted Rust field from changing the
    // computation while disappearing from the cache key.
    let (_, options_bytes, _) = canonicalize_exact_options(&request.options)?;
    let pipeline_options = request.options.clone().into_pipeline_options();
    let method_uses_capability = request
        .active_method_profile_receipts()?
        .into_iter()
        .any(|receipt| receipt_uses_capability_evidence(&receipt.input_bindings));
    let resolved_support = support_files
        .resolve(uses_input_capability_evidence(&pipeline_options) || method_uses_capability)?;
    let ingress = materialize_ingress(
        csv_bytes,
        csv_bytes.len() as u64,
        &verified_input_digest,
        &options_bytes,
        &options_value,
        &resolved_support,
    )?;
    let report = RuntimeRequirementsReport {
        protocol_version: "chronicle-requirements-report/v1",
        ready: ingress.materialization.obligations.is_empty(),
        role_assignments: ingress.assignments.values().cloned().collect(),
        qualification_traces: ingress.materialization.qualification_traces,
        requirement_traces: ingress.materialization.requirement_traces,
        open_obligations: ingress.materialization.obligations,
        role_states: ingress.materialization.role_states,
        query_group_states: ingress.materialization.query_group_states,
        state_reasons: ingress.materialization.reasons,
    };
    let bytes = serde_jcs::to_vec(&report)
        .map_err(|error| format!("canonicalize requirements report: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("requirements report was not UTF-8: {error}"))
}

fn reject_open_binding_holes(
    materialization: &chronicle_preprocessing_semantic_adapter::Materialization,
) -> Result<(), String> {
    let roles = materialization
        .obligations
        .iter()
        .map(|obligation| obligation.role_id.as_str())
        .collect::<BTreeSet<_>>();
    if roles.is_empty() {
        return Ok(());
    }
    Err(format!(
        "unresolved binding holes for required roles: {}; evaluate requirements before execution",
        roles.into_iter().collect::<Vec<_>>().join(", ")
    ))
}

fn prepare_runtime_workspace(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let timer = EnvelopeTimer::start("prepare_input_digest_verify");
    let verified_input_digest = request.validate(csv_bytes)?;
    timer.finish();
    prepare_runtime_workspace_verified(
        request,
        verified_input_digest,
        csv_bytes,
        csv_bytes.len() as u64,
        support_files,
    )
}

fn prepare_runtime_workspace_for_android_conformance_attempt(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let timer = EnvelopeTimer::start("prepare_input_digest_verify");
    let verified_input_digest = request.validate_android_profile_conformance_attempt(csv_bytes)?;
    timer.finish();
    prepare_runtime_workspace_verified(
        request,
        verified_input_digest,
        csv_bytes,
        csv_bytes.len() as u64,
        support_files,
    )
}

fn prepare_runtime_workspace_from_persisted_input(
    request_json: &str,
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let verified_input_digest = request.validate_persisted_input()?;
    prepare_runtime_workspace_verified(
        request,
        verified_input_digest,
        &[],
        input_size_bytes,
        support_files,
    )
}

fn prepare_runtime_workspace_verified(
    mut request: RuntimeRequest,
    verified_input_digest: String,
    csv_bytes: &[u8],
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<PreparedRuntimeWorkspace, String> {
    let timer = EnvelopeTimer::start("prepare_options_canonicalize");
    refuse_reserved_adapter_columns(csv_bytes)?;
    validate_supplied_communication_relationships(csv_bytes)?;
    let options_value = semantic_options_value(&request.options)?;
    let (exact_options_value, options_bytes, options_digest) =
        canonicalize_exact_options(&request.options)?;
    let computation_options_digest = computation_options_digest(&exact_options_value)?;
    // This is the authoritative execution-side guard. It runs before support
    // resolution, ingress materialization, or any reconstruction/cache path.
    reject_refused_opener_set(&request.options)?;
    let pipeline_options = request.options.clone().into_pipeline_options();
    // B06 refusals (shape, threshold grammar, strategy incompatibility, the
    // adaptive provider, legacy canonicalization) are typed option
    // validation; repeat it here as the execution-side guard.
    validate_pipeline_v2_options(&pipeline_options).map_err(|error| error.to_string())?;
    let fragmented_participant_ids = if requires_live_scientific_preflight(&pipeline_options) {
        request.validate_participant_partition_transport()?;
        resolve_fragmented_participant_ids(
            &verified_input_digest,
            request.participant_partition_batch_id.as_deref(),
            &request.fragmented_participant_tokens,
        )?
    } else {
        // Fragment metadata is an exact-read, non-option transport. If no
        // B05/Schoedel/EYES arm consumes it, detach retained browser state
        // before any cache, preflight, provenance, or kernel boundary.
        request.participant_partition_batch_id = None;
        request.fragmented_participant_tokens.clear();
        Vec::new()
    };
    timer.finish();
    let timer = EnvelopeTimer::start("prepare_support_resolve");
    let method_uses_capability = request
        .active_method_profile_receipts()?
        .into_iter()
        .any(|receipt| receipt_uses_capability_evidence(&receipt.input_bindings));
    let resolved_support = support_files
        .resolve(uses_input_capability_evidence(&pipeline_options) || method_uses_capability)?;
    if pipeline_options.use_filter_file
        && pipeline_options.filter_match_field
            == chronicle_chrono_kernel_wasm::pipeline_v2::FilterMatchField::AppPackageName
    {
        chronicle_chrono_kernel_wasm::pipeline_v2::validate_filter_file_for_preset(
            resolved_support.get("filter_file"),
            pipeline_options.package_exclusion_preset,
        )?;
    }
    timer.finish();
    let timer = EnvelopeTimer::start("prepare_materialize_ingress");
    let ingress = materialize_ingress(
        csv_bytes,
        input_size_bytes,
        &verified_input_digest,
        &options_bytes,
        &options_value,
        &resolved_support,
    )?;
    reject_open_binding_holes(&ingress.materialization)?;
    let literature_input = request
        .active_method_profile_receipts()?
        .into_iter()
        .find(|receipt| !receipt.input_bindings.is_empty())
        .map(|receipt| {
            adapt_literature_inputs(
                csv_bytes,
                &verified_input_digest,
                &receipt.input_bindings,
                |role| resolved_support.get(role),
            )
        })
        .transpose()?
        .flatten();
    timer.finish();
    Ok(PreparedRuntimeWorkspace {
        request,
        options_value,
        exact_options_value,
        options_bytes,
        options_digest,
        computation_options_digest,
        fragmented_participant_ids,
        resolved_support,
        pipeline_options,
        ingress,
        literature_input,
    })
}

fn prepared_cache_decision(
    prepared: &PreparedRuntimeWorkspace,
) -> Result<DependencyCacheDecision, String> {
    let certificate = embedded_dependency_certificate();
    evaluate_dependency_cache_decision(
        embedded_plan(),
        Some(certificate),
        Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
        Some(EMBEDDED_PLAN_SHA256),
        dependency_evidence_current(certificate),
        &prepared.options_value,
        &prepared.ingress.assignments,
    )
    .map_err(|error| error.to_string())
}

/// Run all input-dependent scientific applicability checks on the exact
/// workspace engine that execution will reuse. Typed refusals remain inside
/// the returned receipt; malformed identity or input still fails closed.
#[wasm_bindgen]
pub fn scientific_preflight_json(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, JsValue> {
    scientific_preflight_native(request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

pub fn scientific_preflight_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    scientific_preflight_native_raw(request_json, RawCsvBytes::Borrowed(csv_bytes), support_files)
}

/// Native-only conformance admission uses the same prepared preflight owner.
pub fn scientific_preflight_native_conformance_attempt(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    let prepared = prepare_runtime_workspace_for_android_conformance_attempt(
        request_json, csv_bytes, support_files,
    )?;
    let services = ExecutionServices { store: chronicle_chrono_kernel_wasm::payload_store::current_store() };
    INCREMENTAL_RUNTIME_STATES.with(|states| execution_preflight::scientific_preflight_prepared(
        &mut states.borrow_mut(), &services, prepared, RawCsvBytes::Borrowed(csv_bytes),
    ))
}

/// `scientific_preflight_native` over raw bytes the tracked input adopts
/// without copying.
pub fn scientific_preflight_native_shared(
    request_json: &str,
    csv_bytes: &Arc<Vec<u8>>,
    support_files: &RuntimeSupportFiles,
) -> Result<String, String> {
    scientific_preflight_native_raw(request_json, RawCsvBytes::Shared(csv_bytes), support_files)
}


#[wasm_bindgen]
pub fn verify_evidence_journal_cbor(bytes: &[u8]) -> Result<u32, JsValue> {
    EvidenceJournal::from_cbor(bytes)
        .map(|journal| journal.events().len() as u32)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

pub fn execute_workspace_native(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native_with_review_bases(request_json, csv_bytes, &[], &[], support_files)
}

/// Execute one exact canonical Android profile configuration through the same
/// prepared workspace used by production, solely to create its A/B
/// conformance evidence before registry promotion. Ordinary execution remains
/// gated by `execute_workspace_native` and a completed configuration proof.
pub fn execute_workspace_native_conformance_attempt(
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let prepared = prepare_runtime_workspace_for_android_conformance_attempt(
        request_json,
        csv_bytes,
        support_files,
    )?;
    let csv_bytes = Arc::new(csv_bytes.to_vec());
    let verified = VerifiedRawInput::verify_owned(
        Arc::clone(&csv_bytes), &prepared.request.input_sha256,
    )?;
    execute_prepared_workspace(prepared, csv_bytes, Some(verified), None, false, false, &[], &[])
}

/// Execute one registered literature component without entering the canonical
/// Chronicle event kernel. The closed component authority constructs its
/// method receipt from the embedded adapter/conformance registries, so a
/// blocked parent paper profile is never misreported as fully executable.
pub fn execute_literature_component_native(
    component_id: &str,
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let store = chronicle_chrono_kernel_wasm::payload_store::current_store();
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    if request.method_profile_receipt.is_some() || !request.method_profile_receipts.is_empty() {
        return Err(
            "literature component authority constructs its receipt from the embedded component contract"
                .into(),
        );
    }
    let input_digest = request.validate(csv_bytes)?;
    if request.command != EXECUTE_WORKSPACE_COMMAND {
        return Err("literature component requires an ExecuteWorkspace command".into());
    }
    if request.participant_partition_batch_id.is_some()
        || !request.fragmented_participant_tokens.is_empty()
        || request.known_review_summary_digests.is_some()
    {
        return Err("literature component execution refuses kernel/review transport state".into());
    }

    let (registration, input_bindings) = literature_component_execution_unit(component_id)?;
    let component_setting_ids = input_bindings
        .iter()
        .map(|binding| binding.setting_id.clone())
        .collect::<Vec<_>>();
    if registration.canonical_registration_status.as_deref() == Some("outside_frozen143_extension") {
        // The embedded adapter contract validates the closed extension tuple.
        android_method_profile_registry::validate_outside_frozen_component_parent(
            &registration.parent_method_profile_id, &registration.source_work_id, &component_setting_ids,
        )?;
    } else {
        android_method_profile_registry::validate_blocked_component_parent(
            component_id,
            &registration.parent_method_profile_id,
            &registration.source_work_id,
            &registration.source_method_variant_id,
            &registration.method_profile_version,
            &component_setting_ids,
        )?;
    }
    let input_adapter_contract_digest =
        literature_input_adapters::literature_input_adapter_contract_digest();
    let input_adapter_conformance_digest =
        literature_input_adapters::literature_input_adapter_conformance_digest();
    let android_method_profile_registry_content_digest =
        android_method_profile_registry::validated_registry_content_digest()?;
    let required_support_roles = registration
        .required_support_roles
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let supplied_support_roles = support_files
        .files
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if supplied_support_roles != required_support_roles {
        return Err(format!(
            "{component_id} requires exactly the registered support roles: {:?}",
            registration.required_support_roles
        ));
    }
    for role in &registration.required_support_roles {
        let file = support_files
            .files
            .get(role)
            .expect("supplied support roles equal registered roles");
        if !file.name.to_ascii_lowercase().ends_with(".csv") {
            return Err(format!(
                "{component_id} requires {role} in source-faithful CSV format"
            ));
        }
    }
    let resolved_support = support_files
        .resolve(required_support_roles.contains("input_capability_evidence_file"))?;
    for role in &registration.required_support_roles {
        if resolved_support.get(role).is_empty() {
            return Err(format!("{component_id} requires {role} support"));
        }
    }
    let component_method_receipt = LiteratureComponentMethodReceipt {
        protocol_version: "chronicle-literature-component-method-receipt/v1".into(),
        component_id: registration.component_id.clone(),
        parent_method_profile_id: registration.parent_method_profile_id.clone(),
        parent_profile_execution_status: registration.full_profile_execution_status.clone(),
        source_work_id: registration.source_work_id.clone(),
        source_method_variant_id: registration.source_method_variant_id.clone(),
        method_profile_version: registration.method_profile_version.clone(),
        setting_ids: component_setting_ids,
        limitations: registration.limitations.clone(),
        input_bindings,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        input_adapter_contract_digest: input_adapter_contract_digest.clone(),
        input_adapter_conformance_digest: input_adapter_conformance_digest.clone(),
        android_method_profile_registry_content_digest:
            android_method_profile_registry_content_digest.clone(),
    };
    let component_method_receipt_bytes = serde_jcs::to_vec(&component_method_receipt)
        .map_err(|error| format!("canonicalize component method receipt: {error}"))?;
    let component_method_receipt_digest = sha256(&component_method_receipt_bytes);
    let adapted = adapt_literature_inputs(
        csv_bytes,
        &input_digest,
        &component_method_receipt.input_bindings,
        |role| resolved_support.get(role),
    )?
    .ok_or_else(|| "literature component authority produced no adaptation".to_string())?;
    if receipt_is_kernel_input_eligible(&adapted.receipt) {
        return Err("literature component authority refuses a kernel-eligible adapter".into());
    }
    let expected_adapter_ids = component_method_receipt
        .input_bindings
        .iter()
        .map(|binding| format!("{}/{}", binding.adapter_id, binding.adapter_version))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if adapted.receipt.adapter_ids != expected_adapter_ids
        || adapted.receipt.original_input_digest != input_digest
    {
        return Err("literature component adaptation identity drift".into());
    }
    let derived_receipt = adapted.receipt.derived_result.as_ref().ok_or_else(|| {
        "literature component adapter emitted no derived-result receipt".to_string()
    })?;
    let derived_bytes = adapted.derived_result_bytes.as_ref().ok_or_else(|| {
        "literature component adapter emitted no derived-result bytes".to_string()
    })?;
    if derived_receipt.kind != registration.derived_result_kind
        || derived_receipt.digest != sha256(derived_bytes)
    {
        return Err("literature component derived-result identity drift".into());
    }
    let oracle_id = adapted
        .receipt
        .source_oracle_id()
        .map(str::to_owned)
        .ok_or_else(|| "literature component adapter omitted source oracle identity".to_string())?;
    if oracle_id != registration.source_oracle_id {
        return Err("literature component source oracle identity drift".into());
    }
    let adaptation_receipt_bytes = serde_jcs::to_vec(&adapted.receipt)
        .map_err(|error| format!("canonicalize component adaptation receipt: {error}"))?;
    let adaptation_receipt_digest = sha256(&adaptation_receipt_bytes);
    let support_artifact_digests = registration
        .required_support_roles
        .iter()
        .map(|role| {
            let file = support_files
                .files
                .get(role)
                .expect("registered support was validated above");
            (role.clone(), sha256(&file.bytes))
        })
        .collect::<BTreeMap<_, _>>();
    let support_adapter_input_digests = registration
        .required_support_roles
        .iter()
        .map(|role| (role.clone(), sha256(resolved_support.get(role))))
        .collect::<BTreeMap<_, _>>();
    let support_formats = registration
        .required_support_roles
        .iter()
        .map(|role| {
            let resolved = resolved_support
                .files
                .get(role)
                .expect("registered support was resolved above");
            (
                role.clone(),
                format!(
                    "{}; normalizedFromXlsx={}",
                    resolved.media_type, resolved.normalized_from_xlsx
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let execution_receipt = LiteratureComponentExecutionReceipt {
        protocol_version: "chronicle-literature-component-execution-receipt/v1".into(),
        component_id: registration.component_id.clone(),
        component_execution_status: "executed".into(),
        full_profile_execution_status: registration.full_profile_execution_status.clone(),
        parent_method_profile_id: registration.parent_method_profile_id.clone(),
        source_work_id: registration.source_work_id.clone(),
        source_method_variant_id: registration.source_method_variant_id.clone(),
        method_profile_version: registration.method_profile_version.clone(),
        setting_ids: component_method_receipt.setting_ids.clone(),
        limitations: registration.limitations.clone(),
        original_input_digest: input_digest.clone(),
        support_artifact_digests: support_artifact_digests.clone(),
        support_adapter_input_digests: support_adapter_input_digests.clone(),
        support_formats,
        component_method_receipt_digest: component_method_receipt_digest.clone(),
        adaptation_receipt_digest: adaptation_receipt_digest.clone(),
        derived_result_kind: derived_receipt.kind.into(),
        derived_result_digest: derived_receipt.digest.clone(),
        derived_result_row_count: derived_receipt.row_count,
        oracle_id,
        kernel_input_eligible: false,
        canonical_kernel_input_digest: None,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        input_adapter_contract_digest: input_adapter_contract_digest.clone(),
        input_adapter_conformance_digest: input_adapter_conformance_digest.clone(),
        android_method_profile_registry_content_digest:
            android_method_profile_registry_content_digest.clone(),
    };
    let execution_receipt_bytes = serde_jcs::to_vec(&execution_receipt)
        .map_err(|error| format!("canonicalize component execution receipt: {error}"))?;
    let execution_receipt_digest = sha256(&execution_receipt_bytes);
    let mut source_dependency_digests = vec![input_digest.clone()];
    for role in &registration.required_support_roles {
        source_dependency_digests.push(
            support_artifact_digests
                .get(role)
                .expect("registered support artifact digest exists")
                .clone(),
        );
        source_dependency_digests.push(
            support_adapter_input_digests
                .get(role)
                .expect("registered support adapter digest exists")
                .clone(),
        );
    }
    source_dependency_digests.extend([
        component_method_receipt_digest.clone(),
        IMPLEMENTATION_BUILD_DIGEST.into(),
        BUILD_ENVIRONMENT_DIGEST.into(),
        input_adapter_contract_digest.clone(),
        input_adapter_conformance_digest.clone(),
        android_method_profile_registry_content_digest.clone(),
    ]);
    let source_dependencies = scientific_artifact_dependencies(source_dependency_digests);
    let mut artifacts = vec![
        runtime_artifact_with_digest(
            &store,
            "literature-component-method-receipt-json",
            "application/json",
            component_method_receipt_bytes,
            Vec::new(),
            component_method_receipt_digest,
        ),
        runtime_artifact_with_digest(
            &store,
            "literature-input-adaptation-receipt-json",
            "application/json",
            adaptation_receipt_bytes,
            source_dependencies.clone(),
            adaptation_receipt_digest,
        ),
    ];
    let mut derived_artifact = runtime_artifact_with_digest(
        &store,
        derived_receipt.kind,
        registration.table_media_type(),
        derived_bytes.clone(),
        source_dependencies.clone(),
        derived_receipt.digest.clone(),
    );
    derived_artifact.metadata.row_count = Some(derived_receipt.row_count);
    artifacts.push(derived_artifact);
    if let Some(kind) = &registration.adapted_result_kind {
        let mut artifact = runtime_artifact_with_digest(
            &store,
            kind,
            registration.table_media_type(),
            adapted.csv_bytes.clone(),
            source_dependencies.clone(),
            adapted.receipt.adapted_input_digest.clone(),
        );
        if &artifact.metadata.kind != kind || artifact.metadata.digest != sha256(&adapted.csv_bytes)
        {
            return Err("literature component adapted-result identity drift".into());
        }
        artifact.metadata.row_count = Some(adapted.receipt.emitted_row_count);
        artifacts.push(artifact);
    }
    artifacts.push(runtime_artifact_with_digest(
        &store,
        "literature-component-execution-receipt-json",
        "application/json",
        execution_receipt_bytes,
        vec![
            execution_receipt.component_method_receipt_digest.clone(),
            execution_receipt.adaptation_receipt_digest.clone(),
            execution_receipt.derived_result_digest.clone(),
        ],
        execution_receipt_digest.clone(),
    ));
    let mut assignment_digests = support_artifact_digests.clone();
    assignment_digests.insert(
        registration
            .primary_input_role(&component_method_receipt.input_bindings)?
            .to_owned(),
        input_digest.clone(),
    );
    let component_artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.clone())
        .collect::<Vec<_>>();
    let closure_bytes = serde_jcs::to_vec(&LiteratureComponentArtifactClosure {
        protocol_version: "chronicle-literature-component-artifact-closure/v1",
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &input_digest,
        assignment_digests: &assignment_digests,
        support_artifact_digests: &support_artifact_digests,
        support_adapter_input_digests: &support_adapter_input_digests,
        component_id: &registration.component_id,
        parent_method_profile_id: &registration.parent_method_profile_id,
        full_profile_execution_status: &registration.full_profile_execution_status,
        source_work_id: &registration.source_work_id,
        source_method_variant_id: &registration.source_method_variant_id,
        method_profile_version: &registration.method_profile_version,
        setting_ids: &component_method_receipt.setting_ids,
        component_execution_receipt_digest: &execution_receipt_digest,
        oracle_id: &execution_receipt.oracle_id,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        input_adapter_contract_digest: &input_adapter_contract_digest,
        input_adapter_conformance_digest: &input_adapter_conformance_digest,
        android_method_profile_registry_content_digest:
            &android_method_profile_registry_content_digest,
        artifacts: artifacts
            .iter()
            .map(|artifact| &artifact.metadata)
            .collect(),
    })
    .map_err(|error| format!("canonicalize component artifact closure: {error}"))?;
    let closure_artifact = runtime_artifact(
        &store,
        "artifact-closure-json",
        "application/json",
        closure_bytes,
        component_artifact_digests.clone(),
    );
    let artifact_closure_digest = closure_artifact.metadata.digest.clone();
    artifacts.push(closure_artifact);
    let artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let root_bytes = serde_jcs::to_vec(&LiteratureComponentRoot {
        protocol_version: "chronicle-literature-component-root/v1",
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &input_digest,
        assignment_digests: &assignment_digests,
        support_artifact_digests: &support_artifact_digests,
        support_adapter_input_digests: &support_adapter_input_digests,
        component_id: &registration.component_id,
        parent_method_profile_id: &registration.parent_method_profile_id,
        full_profile_execution_status: &registration.full_profile_execution_status,
        source_work_id: &registration.source_work_id,
        source_method_variant_id: &registration.source_method_variant_id,
        method_profile_version: &registration.method_profile_version,
        setting_ids: &component_method_receipt.setting_ids,
        component_execution_receipt_digest: &execution_receipt_digest,
        oracle_id: &execution_receipt.oracle_id,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        input_adapter_contract_digest: &input_adapter_contract_digest,
        input_adapter_conformance_digest: &input_adapter_conformance_digest,
        android_method_profile_registry_content_digest:
            &android_method_profile_registry_content_digest,
        artifact_digests,
        artifact_closure_digest: &artifact_closure_digest,
    })
    .map_err(|error| format!("canonicalize component root: {error}"))?;
    let root_digest = sha256(&root_bytes);
    artifacts.push(runtime_artifact_with_digest(
        &store,
        "workspace-root-json",
        "application/json",
        root_bytes,
        vec![artifact_closure_digest.clone()],
        root_digest.clone(),
    ));
    let manifest = LiteratureComponentRuntimeManifest {
        protocol_version: "chronicle-literature-component-runtime/v1".into(),
        request_id: request.request_id,
        command: "ExecuteLiteratureComponent".into(),
        workspace_id: request.workspace_id,
        previous_workspace_root_digest: request.workspace_root_digest,
        workspace_root_digest: root_digest,
        artifact_closure_digest,
        input_file_name: request.input_file_name,
        input_digest,
        component_id: registration.component_id,
        component_execution_receipt_digest: execution_receipt_digest,
        source_row_count: adapted.receipt.source_row_count,
        derived_result_row_count: derived_receipt.row_count,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        input_adapter_contract_digest,
        input_adapter_conformance_digest,
        android_method_profile_registry_content_digest,
        artifacts: artifacts
            .iter()
            .map(|artifact| artifact.metadata.clone())
            .collect(),
    };
    let handle = RuntimeHandle {
        manifest_json: serde_jcs::to_string(&manifest)
            .map_err(|error| format!("canonicalize component manifest: {error}"))?,
        artifacts,
    };
    let _ = store.enforce_budget();
    Ok(handle)
}

#[wasm_bindgen]
pub fn execute_literature_component(
    component_id: &str,
    request_json: &str,
    csv_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, JsValue> {
    execute_literature_component_native(component_id, request_json, csv_bytes, support_files)
        .map_err(|error| JsValue::from_str(&error))
}

pub fn execute_workspace_native_with_review_base(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native_with_review_bases(
        request_json,
        csv_bytes,
        review_base_bytes,
        &[],
        support_files,
    )
}

pub fn execute_workspace_native_with_review_bases(
    request_json: &str,
    csv_bytes: &[u8],
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    execute_workspace_native_shared(
        request_json,
        Arc::new(csv_bytes.to_vec()),
        review_base_bytes,
        reconstruction_base_bytes,
        support_files,
    )
}

/// `execute_workspace_native_with_review_bases` over raw bytes the caller
/// hands over as an `Arc`: the tracked input adopts them (or keeps its own
/// equal copy), so one copy of the raw file is live during the execution.
pub fn execute_workspace_native_shared(
    request_json: &str,
    csv_bytes: Arc<Vec<u8>>,
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let request: RuntimeRequest =
        serde_json::from_str(request_json).map_err(|error| format!("invalid request: {error}"))?;
    let timer = EnvelopeTimer::start("prepare_input_digest_verify");
    request.validate_fields()?;
    let verified_raw = VerifiedRawInput::verify_owned(csv_bytes, &request.input_sha256)?;
    timer.finish();
    let prepared = prepare_runtime_workspace_verified(
        request,
        verified_raw.digest().to_owned(),
        verified_raw.bytes(),
        verified_raw.bytes().len() as u64,
        support_files,
    )?;
    let csv_bytes = verified_raw.shared_bytes();
    execute_prepared_workspace(
        prepared,
        csv_bytes,
        Some(verified_raw),
        None,
        false,
        false,
        review_base_bytes,
        reconstruction_base_bytes,
    )
}

/// Skip the SHA-256 re-hash of the raw CSV when the caller knows the engine
/// already has verified input for this workspace (warm review iteration).
/// Falls back to the full-verify path if the engine state doesn't confirm.
pub fn execute_workspace_native_warm_review(
    request_json: &str,
    input_size_bytes: u64,
    support_files: &RuntimeSupportFiles,
) -> Result<RuntimeHandle, String> {
    let prepared = prepare_runtime_workspace_from_persisted_input(
        request_json,
        input_size_bytes,
        support_files,
    )?;
    // This entry point hashes no bytes; only a review over the engine's
    // retained input may skip that. Any other command would run the whole
    // pipeline over zero bytes under the declared digest.
    if prepared.request.command != QUERY_REVIEW_COMMAND {
        return Err("warm_review_requires_query_review_command".to_string());
    }
    execute_prepared_workspace(prepared, Arc::default(), None, None, true, true, &[], &[])
}

fn required_view_contract_matches(
    kind: &str,
    view: &Value,
    expected_kind: &str,
    expected_view_id: &str,
    expected_schema_id: &str,
    expected_root_digest: &str,
) -> bool {
    let (view_id_key, schema_id_key, root_digest_key) =
        if expected_kind == "workflow-explorer-view-json" {
            ("viewId", "schemaId", "rootDigest")
        } else {
            ("view_id", "schema_id", "root_digest")
        };
    kind == expected_kind
        && view.get(view_id_key).and_then(Value::as_str) == Some(expected_view_id)
        && view.get(schema_id_key).and_then(Value::as_str) == Some(expected_schema_id)
        && view.get(root_digest_key).and_then(Value::as_str) == Some(expected_root_digest)
}

/// The store-failure bracket of the whole request. The one inside
/// `execute_incremental_pipeline` ends with the engine; the result digests,
/// the binary exports and the source-coordinate index below it reload the
/// memoized output payloads too, and a reload that fails there left the
/// workspace engine owning an unreadable payload for every retry.
#[allow(clippy::too_many_arguments)]
fn execute_prepared_workspace(
    prepared: PreparedRuntimeWorkspace,
    csv_bytes: Arc<Vec<u8>>,
    verified_raw: Option<VerifiedRawInput<'static>>,
    owned_review_csv: Option<Vec<u8>>,
    verified_persisted_input: bool,
    warm_verified_input: bool,
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
) -> Result<RuntimeHandle, String> {
    let workspace_id = prepared.request.workspace_id.clone();
    let services = ExecutionServices { store: chronicle_chrono_kernel_wasm::payload_store::current_store() };
    INCREMENTAL_RUNTIME_STATES.with(|states| {
        let mut states = states.borrow_mut();
        let store_failures_before = store_failures_at_request_entry(&services.store);
        let handle = execute_prepared_workspace_closure(
            &mut states,
            &services,
            prepared,
            csv_bytes,
            verified_raw,
            owned_review_csv,
            verified_persisted_input,
            warm_verified_input,
            review_base_bytes,
            reconstruction_base_bytes,
        );
        if handle.is_err() {
            reset_incremental_state_after_store_failure(&mut states, &services, &workspace_id, store_failures_before);
        }
        handle
    })
}

#[allow(clippy::too_many_arguments)]
fn execute_prepared_workspace_closure(
    states: &mut IncrementalRuntimeStateCache,
    services: &ExecutionServices,
    prepared: PreparedRuntimeWorkspace,
    csv_bytes: Arc<Vec<u8>>,
    verified_raw: Option<VerifiedRawInput<'static>>,
    owned_review_csv: Option<Vec<u8>>,
    verified_persisted_input: bool,
    warm_verified_input: bool,
    review_base_bytes: &[u8],
    reconstruction_base_bytes: &[u8],
) -> Result<RuntimeHandle, String> {
    let scientific_preflight_key = scientific_preflight_key(&prepared)?;
    let PreparedRuntimeWorkspace {
        request,
        options_value,
        exact_options_value,
        options_bytes,
        options_digest,
        computation_options_digest,
        fragmented_participant_ids,
        resolved_support,
        pipeline_options,
        mut ingress,
        literature_input,
    } = prepared;
    let kernel_adapted = literature_input.as_ref()
        .filter(|a| receipt_is_kernel_input_eligible(&a.receipt));
    let original_source_csv = (request.provenance_evidence && kernel_adapted.is_some())
        .then(|| Arc::clone(&csv_bytes));
    let effective_owned_review_csv = kernel_adapted
        .map(|a| a.csv_bytes.clone()).or(owned_review_csv);
    let (effective_csv_bytes, effective_verified_raw) = if let Some(a) = kernel_adapted {
        let bytes = Arc::new(a.csv_bytes.clone());
        let verified = VerifiedRawInput::verify_owned(
            Arc::clone(&bytes), &a.receipt.adapted_input_digest,
        )?;
        (bytes, Some(verified))
    } else {
        (csv_bytes, verified_raw)
    };
    let IncrementalPipelineExecution {
        result,
        raw_csv,
        output_payloads,
        lineage_payload,
        review_base,
        reconstruction_base,
        query_group_executions,
        query_executions,
        cache_sources,
        cache_decision: dependency_cache_decision,
        node_artifacts,
    } = execute_incremental_pipeline(
        states, services,
        &request,
        &ingress.assignments,
        &computation_options_digest,
        &scientific_preflight_key,
        &fragmented_participant_ids,
        effective_csv_bytes,
        effective_verified_raw,
        effective_owned_review_csv,
        verified_persisted_input,
        PersistedReviewBases {
            review: review_base_bytes,
            reconstruction: reconstruction_base_bytes,
            warm_verified_input,
        },
        &options_value,
        &exact_options_value,
        &pipeline_options,
        &resolved_support,
    )?;
    let assignment_digests = ingress
        .assignments
        .values()
        .map(|assignment| assignment.artifact.digest.clone())
        .collect::<Vec<_>>();
    // The kernel's raw-input identity is the deterministic adapted CSV. The
    // manifest retains the uploaded input identity separately, and the
    // adaptation receipt cryptographically links both.
    let kernel_input_digest = literature_input
        .as_ref()
        .filter(|adapted| receipt_is_kernel_input_eligible(&adapted.receipt))
        .map(|adapted| adapted.receipt.adapted_input_digest.as_str())
        .unwrap_or(ingress.input.digest.as_str());
    let timer = EnvelopeTimer::start("post_evidence");
    let mut eyes_evidence_bundle = build_runtime_eyes_evidence(
        &result,
        &request.options,
        &pipeline_options,
        kernel_input_digest,
        &computation_options_digest,
    )?;
    let eyes_evidence_summary = eyes_evidence_bundle.summary.clone();
    let scientific_assignment_sets = runtime_scientific_assignment_sets(
        &exact_options_value,
        &ingress.assignments,
        &query_executions,
    );
    let eyes_scientific_assignments = ["raw_chronicle_csv", "processing_options"]
        .into_iter()
        .filter_map(|role| {
            ingress
                .assignments
                .get(role)
                .cloned()
                .map(|assignment| (role.to_string(), assignment))
        })
        .collect::<BTreeMap<_, _>>();
    // Authenticate every scientific receipt against the independently
    // computed verified input and exact request-JCS digests before either the
    // review early return or the stable-artifact cache can observe it.
    let mut scientific_evidence_bundle = build_runtime_scientific_evidence(&services.store,
        &result,
        &pipeline_options,
        kernel_input_digest,
        &computation_options_digest,
        &options_digest,
        &scientific_assignment_sets,
        &eyes_evidence_summary,
    )?;
    let scientific_evidence_summary = scientific_evidence_bundle.summary.clone();
    timer.finish();
    if request.command == QUERY_REVIEW_COMMAND {
        let timer = EnvelopeTimer::start("review_manifest_build");
        let review_summary_digest = sha256_payload(&result.review_summary_json_bytes)?;
        let active_ingress_roles = scientific_assignment_sets
            .active_union()
            .into_iter()
            .map(|(role_id, assignment)| {
                (
                    role_id,
                    RuntimeActiveIngressRoleIdentity {
                        artifact_digest: assignment.artifact.digest,
                        assignment_id: assignment.assignment_id,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        let comparison_digest = sha256(
            &serde_jcs::to_vec(&serde_json::json!({
                "protocolVersion": RUNTIME_PROTOCOL_VERSION,
                "command": QUERY_REVIEW_COMMAND,
                "workspaceId": request.workspace_id,
                "inputDigest": ingress.input.digest,
                "optionsDigest": options_digest,
                "activeIngressRoles": active_ingress_roles,
                "implementationDigest": IMPLEMENTATION_BUILD_DIGEST,
                "planDigest": EMBEDDED_PLAN_SHA256,
                "reviewSummaryDigest": review_summary_digest,
                "eyesEvidence": &eyes_evidence_summary,
                "scientificEvidence": &scientific_evidence_summary,
                "cleaningCounts": result.cleaning_counts,
            }))
            .map_err(|error| format!("canonicalize review comparison digest: {error}"))?,
        );
        let review_summary_reused =
            request
                .known_review_summary_digests
                .as_ref()
                .is_some_and(|digests| {
                    digests
                        .iter()
                        .any(|digest| digest == &review_summary_digest)
                });
        let mut artifacts = Vec::new();
        if let Some(artifact) = method_profile_receipts_artifact(&services.store,&request, &options_digest)? {
            artifacts.push(artifact);
        }
        if let Some(artifact) = literature_input_adaptation_artifact(
            &services.store,
            literature_input.as_ref().map(|adapted| &adapted.receipt),
            &assignment_digests,
        )? {
            artifacts.push(artifact);
        }
        if !review_summary_reused {
            artifacts.push(shared_pipeline_artifact(
                &output_payloads,
                "review-summary-json",
                "application/json",
                assignment_digests.clone(),
                review_summary_digest.clone(),
            ));
        }
        artifacts.append(&mut scientific_evidence_bundle.artifacts);
        append_runtime_eyes_evidence_artifacts(&services.store,
            &mut artifacts,
            &mut eyes_evidence_bundle,
            &eyes_evidence_summary,
            &ingress.input.digest,
            &options_digest,
            &eyes_scientific_assignments,
        )?;
        let manifest = ReviewRuntimeManifest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            preprocessor_version: chronicle_chrono_kernel_wasm::pipeline_v2::PREPROCESSOR_VERSION
                .into(),
            request_id: request.request_id,
            command: QUERY_REVIEW_COMMAND.into(),
            workspace_id: request.workspace_id,
            previous_workspace_root_digest: request.workspace_root_digest,
            input_digest: ingress.input.digest,
            options_digest,
            computation_options_digest,
            implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
            build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
            plan_digest: EMBEDDED_PLAN_SHA256.into(),
            profile_digest: EMBEDDED_PROFILE_SHA256.into(),
            profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
            product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
            dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
            dependency_cache_decision,
            role_assignments: ingress.assignments.values().cloned().collect(),
            artifacts: artifacts
                .iter()
                .map(|artifact| artifact.metadata.clone())
                .collect(),
            opener_set_receipt: result.opener_set_evidence.clone(),
            maximum_duration_receipt: result
                .maximum_duration_evidence
                .as_ref()
                .map(|evidence| evidence.receipt.clone()),
            eyes_evidence: eyes_evidence_summary,
            scientific_evidence: scientific_evidence_summary,
            counts: RuntimeCounts {
                original: result.original_row_count,
                processed: result.processed_row_count,
                app: result.app_row_count,
                screen: result.screen_row_count,
            },
            available_timezones: result.available_timezones.clone(),
            timezone: result.timezone.clone(),
            timezone_action: result.timezone_action.clone(),
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
            cleaning_counts: result.cleaning_counts,
            query_group_executions,
            query_executions,
            cache_sources,
            review_summary_digest,
            comparison_digest,
            review_summary_reused,
        };
        let manifest_json = serde_json::to_string(&manifest)
            .map_err(|error| format!("serialize review runtime manifest: {error}"))?;
        timer.finish();
        drop(result);
        // The outputs above are computed and resident; a spill that failed
        // while making room cannot change them, and the store counted it
        // (`failure_count`). Consuming it here keeps it out of the next
        // request, which starts from a clean store.
        let _ = services.store.enforce_budget();
        return Ok(RuntimeHandle {
            manifest_json,
            artifacts,
        });
    }
    let plan = embedded_plan();
    let stable_key = stable_artifact_key(
        &request.workspace_id,
        &ingress.input.digest,
        &options_digest,
        &ingress.assignments,
        &result,
        dependency_cache_decision.mode,
        request.provenance_evidence,
    )?;
    let cached_bundle = (dependency_cache_decision.mode == DependencyCacheMode::CertifiedNarrow)
        .then(|| cached_stable_artifact_bundle(states, &request.workspace_id, &stable_key))
        .flatten();
    let (result_digests, mut binary_artifacts, source_coordinate_artifacts) =
        if let Some(bundle) = cached_bundle {
            for artifact in bundle
                .binary_artifacts
                .iter()
                .chain(bundle.source_coordinate_artifacts.iter())
            {
                if artifact.metadata.size != artifact.bytes.len() as u64 {
                    return Err("stable artifact cache metadata drift".into());
                }
            }
            (
                bundle.result_digests,
                bundle.binary_artifacts,
                bundle.source_coordinate_artifacts,
            )
        } else {
            #[cfg(test)]
            STABLE_ARTIFACT_GENERATION_COUNT.with(|count| count.set(count.get() + 1));
            let timer = EnvelopeTimer::start("post_result_digests");
            let result_digests = pipeline_result_digests_with_scientific(
                &result,
                &eyes_evidence_summary,
                &scientific_evidence_summary,
            )?;
            timer.finish();
            let timer = EnvelopeTimer::start("post_binary_exports");
            let mut binary_artifacts = Vec::new();
            append_binary_exports(&services.store,
                &mut binary_artifacts,
                &result,
                &lineage_payload,
                &request.options,
                &assignment_digests,
                &ingress.input.digest,
                &result_digests.output_digests,
                request.provenance_evidence,
            )?;
            timer.finish();
            let timer = EnvelopeTimer::start("post_source_coordinates");
            let mut source_coordinate_artifacts = Vec::new();
            if request.provenance_evidence {
                append_source_coordinate_index(&services.store,
                    &mut source_coordinate_artifacts,
                    &result,
                    &lineage_payload,
                    &binary_artifacts,
                    match original_source_csv.as_ref() {
                        Some(bytes) => Arc::clone(bytes),
                        None => raw_csv.materialize()?,
                    },
                    &options_bytes,
                    &ingress.assignments,
                    &resolved_support,
                    plan,
                )?;
            }
            timer.finish();
            let expected_source_coordinate_artifacts =
                if request.provenance_evidence { 2 } else { 0 };
            if source_coordinate_artifacts.len() != expected_source_coordinate_artifacts {
                return Err("source-coordinate generator emitted an invalid artifact count".into());
            }
            let cache_stable_artifacts = dependency_cache_decision.mode
                == DependencyCacheMode::CertifiedNarrow
                && stable_artifacts_fit_cache(&binary_artifacts, &source_coordinate_artifacts);
            if cache_stable_artifacts {
                store_stable_artifact_bundle(states,
                    &request.workspace_id,
                    StableArtifactBundle {
                        key: stable_key,
                        result_digests: result_digests.clone(),
                        binary_artifacts: binary_artifacts.clone(),
                        source_coordinate_artifacts: source_coordinate_artifacts.clone(),
                    },
                );
            }
            (
                result_digests,
                binary_artifacts,
                source_coordinate_artifacts,
            )
        };
    // Binary indexes borrow the canonical output bytes above. Once they are
    // complete, transfer those Vec allocations into the runtime artifacts
    // instead of cloning every large CSV/JSON output.
    let timer = EnvelopeTimer::start("post_artifacts_misc");
    let mut artifacts = output_artifacts(
        Arc::clone(&result),
        &output_payloads,
        &assignment_digests,
        &result_digests.output_digests,
    );
    artifacts.append(&mut binary_artifacts);
    artifacts.extend(node_artifacts);
    artifacts.append(&mut scientific_evidence_bundle.artifacts);
    append_semantic_bundle_artifacts(&services.store, &mut artifacts);
    append_normalized_support_artifacts(&services.store, &mut artifacts, &ingress.assignments, &resolved_support)?;
    artifacts.push(runtime_artifact_with_digest(&services.store,
        "processing-options-json",
        "application/json",
        options_bytes.clone(),
        Vec::new(),
        options_digest.clone(),
    ));
    if let Some(artifact) = method_profile_receipts_artifact(&services.store,&request, &options_digest)? {
        artifacts.push(artifact);
    }
    if let Some(artifact) = literature_input_adaptation_artifact(
        &services.store,
        literature_input.as_ref().map(|adapted| &adapted.receipt),
        &assignment_digests,
    )? {
        artifacts.push(artifact);
    }
    if let Some(artifact) =
        literature_input_adapted_csv_artifact(&services.store,literature_input.as_ref(), &assignment_digests)
    {
        artifacts.push(artifact);
    }
    if let Some(artifact) =
        literature_input_derived_result_artifact(&services.store,literature_input.as_ref(), &assignment_digests)
    {
        artifacts.push(artifact);
    }
    let eyes_tagged_fau_artifact_digest = append_runtime_eyes_evidence_artifacts(&services.store,
        &mut artifacts,
        &mut eyes_evidence_bundle,
        &eyes_evidence_summary,
        &ingress.input.digest,
        &options_digest,
        &eyes_scientific_assignments,
    )?;
    let opener_set_receipt_bytes = serde_jcs::to_vec(&result.opener_set_evidence)
        .map_err(|error| format!("canonicalize opener-set receipt: {error}"))?;
    let mut opener_set_receipt_dependencies = assignment_digests.clone();
    opener_set_receipt_dependencies.push(options_digest.clone());
    let opener_set_receipt_artifact = runtime_artifact(&services.store,
        "opener-set-receipt-json",
        "application/json",
        opener_set_receipt_bytes,
        opener_set_receipt_dependencies,
    );
    let opener_set_receipt_digest = opener_set_receipt_artifact.metadata.digest.clone();
    artifacts.push(opener_set_receipt_artifact);
    // B06: published only for an explicit selection. The omitted shape has no
    // receipt, no artifact, and no extra semantic-index key.
    let maximum_duration_receipt_digest = match result.maximum_duration_evidence.as_ref() {
        Some(evidence) => {
            b06::validate_evidence(evidence)?;
            let bytes = serde_jcs::to_vec(evidence)
                .map_err(|error| format!("canonicalize maximum-duration receipt: {error}"))?;
            let mut dependencies = assignment_digests.clone();
            dependencies.push(options_digest.clone());
            let artifact = runtime_artifact(&services.store,
                MAXIMUM_DURATION_RECEIPT_KIND,
                "application/json",
                bytes,
                dependencies,
            );
            let digest = artifact.metadata.digest.clone();
            artifacts.push(artifact);
            Some(digest)
        }
        None => None,
    };
    // Absent when the run's review base exceeded its size ceiling: the
    // closure then carries no resume and a later review of this input takes
    // the raw path (`select_persisted_base_kind` on an empty base is `None`).
    if let Some(review_base) = review_base {
        let mut review_base_dependencies = assignment_digests.clone();
        review_base_dependencies.push(options_digest.clone());
        artifacts.push(runtime_artifact(&services.store,
            "review-base",
            "application/vnd.chronicle.review-base+postcard+lz4",
            review_base,
            review_base_dependencies,
        ));
    }
    if let Some(reconstruction_base) = reconstruction_base {
        artifacts.push(runtime_artifact(&services.store,
            "reconstruction-base",
            "application/vnd.chronicle.reconstruction-base+postcard+lz4",
            reconstruction_base,
            assignment_digests
                .iter()
                .cloned()
                .chain(std::iter::once(options_digest.clone()))
                .collect(),
        ));
    }
    artifacts.extend(source_coordinate_artifacts);
    timer.finish();
    let timer = EnvelopeTimer::start("post_ledger_provenance");
    let satisfied_query_groups: BTreeSet<_> = query_group_executions
        .iter()
        .filter(|execution| {
            !matches!(
                execution.status,
                ExecutionStatus::Error | ExecutionStatus::Skipped
            )
        })
        .map(|execution| execution.query_group_id.clone())
        .collect();
    let materialization = evaluate_materialization(
        plan,
        &ingress.assignments,
        &options_value,
        &satisfied_query_groups,
        &BTreeSet::new(),
    );
    let execution_ledger_bytes = build_execution_ledger(
        plan,
        &query_group_executions,
        &query_executions,
        &options_value,
        &request.options.datetime_of_preprocessing,
    )?;
    let execution_ledger_artifact = runtime_artifact(&services.store,
        "execution-ledger-json",
        "application/json",
        execution_ledger_bytes,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    );
    let execution_ledger_digest = execution_ledger_artifact.metadata.digest.clone();
    artifacts.push(execution_ledger_artifact);
    let mut workflow_provenance_dependencies = vec![
        ingress.input.digest.clone(),
        options_digest.clone(),
        execution_ledger_digest,
    ];
    workflow_provenance_dependencies.extend(eyes_tagged_fau_artifact_digest.iter().cloned());
    workflow_provenance_dependencies.extend(scientific_evidence_artifact_digests(
        &scientific_evidence_summary,
    ));
    workflow_provenance_dependencies.sort();
    workflow_provenance_dependencies.dedup();
    artifacts.push(runtime_artifact(&services.store,
        "workflow-provenance-jsonld",
        "application/ld+json",
        workflow_provenance::build_workflow_provenance_jsonld(
            // request_id is transport-only and must not perturb the semantic
            // workspace root. The workspace/input/parameter tuple below is
            // the stable scope for this content-addressed run projection.
            &request.workspace_id,
            &ingress.input.digest,
            &options_digest,
            &exact_options_value,
            &request.options.datetime_of_preprocessing,
            &query_executions,
        )?,
        workflow_provenance_dependencies,
    ));
    timer.finish();
    let timer = EnvelopeTimer::start("post_semantic_index");
    let mut scientific_artifact_metadata = artifacts
        .iter()
        .filter(|artifact| is_scientific_evidence_kind(&artifact.metadata.kind))
        .map(|artifact| artifact.metadata.clone())
        .collect::<Vec<_>>();
    scientific_artifact_metadata.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.digest.cmp(&right.digest))
    });
    let mut scientific_validation_substrate_kinds = vec![
        B05_SCHOEDEL_VALIDATION_RECEIPT_KIND.to_string(),
        FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND.to_string(),
    ];
    if scientific_evidence_summary
        .b05_screen_construction_artifact_digest
        .is_some()
    {
        scientific_validation_substrate_kinds
            .push(B05_SCREEN_CONSTRUCTION_EVIDENCE_KIND.to_string());
    }
    if scientific_evidence_summary
        .schoedel_reconstruction_artifact_digest
        .is_some()
    {
        scientific_validation_substrate_kinds
            .push(SCHOEDEL_RECONSTRUCTION_EVIDENCE_KIND.to_string());
    }
    if eyes_evidence_summary.tagged_fau_artifact_digest.is_some() {
        scientific_validation_substrate_kinds.push(EYES_TAGGED_FAU_EVIDENCE_KIND.to_string());
    }
    scientific_validation_substrate_kinds.sort();
    let mut semantic_index_source_value = serde_json::json!({
        "protocolVersion": "chronicle-semantic-index-source/v7",
        "inputDigest": ingress.input.digest,
        "executionTimestamp": request.options.datetime_of_preprocessing,
        "exactOptions": &request.options,
        "exactOptionsDigest": options_digest,
        "roleAssignments": ingress.assignments.values().collect::<Vec<_>>(),
        "qualificationTraces": materialization.qualification_traces,
        "requirementTraces": materialization.requirement_traces,
        "openObligations": materialization.obligations,
        "stateReasons": materialization.reasons,
        "queryExecutions": query_executions,
        "workflowQueryDigests": result.workflow_query_digests,
        "workflowQueryCheckpoints": result.workflow_query_checkpoints,
        "openerSetReceipt": result.opener_set_evidence,
        "openerSetReceiptDigest": opener_set_receipt_digest.clone(),
        "eyesEvidence": &eyes_evidence_summary,
        "scientificEvidence": &scientific_evidence_summary,
        "scientificEvidenceArtifacts": scientific_artifact_metadata,
        "scientificValidationSubstrateKinds": scientific_validation_substrate_kinds,
        "dependencyCacheDecision": dependency_cache_decision
    });
    if let (Some(evidence), Some(digest)) = (
        result.maximum_duration_evidence.as_ref(),
        maximum_duration_receipt_digest.as_ref(),
    ) {
        let object = semantic_index_source_value
            .as_object_mut()
            .expect("semantic index source is an object");
        object.insert(
            "maximumDurationReceipt".into(),
            serde_json::to_value(evidence)
                .map_err(|error| format!("serialize maximum-duration receipt: {error}"))?,
        );
        object.insert(
            "maximumDurationReceiptDigest".into(),
            Value::String(digest.clone()),
        );
    }
    let semantic_index_source = serde_jcs::to_vec(&semantic_index_source_value)
        .map_err(|error| format!("canonicalize semantic index source: {error}"))?;
    let mut semantic_index_dependencies = vec![
        ingress.input.digest.clone(),
        options_digest.clone(),
        opener_set_receipt_digest,
    ];
    semantic_index_dependencies.extend(maximum_duration_receipt_digest.iter().cloned());
    semantic_index_dependencies.extend(eyes_tagged_fau_artifact_digest.iter().cloned());
    semantic_index_dependencies.extend(scientific_evidence_artifact_digests(
        &scientific_evidence_summary,
    ));
    semantic_index_dependencies.sort();
    semantic_index_dependencies.dedup();
    artifacts.push(runtime_artifact(&services.store,
        "semantic-index-source-json",
        "application/json",
        semantic_index_source,
        semantic_index_dependencies,
    ));
    timer.finish();
    let timer = EnvelopeTimer::start("post_correspondence");
    let correspondence_bytes = build_correspondence_index(CorrespondenceIndexInputs {
        plan,
        assignments: &ingress.assignments,
        materialization: &materialization,
        query_group_executions: &query_group_executions,
        options: &options_value,
        artifacts: &artifacts,
        checkpoints: &result.workflow_query_group_checkpoints,
        query_checkpoints: &result.workflow_query_checkpoints,
    })?;
    let correspondence_dependencies = artifacts
        .iter()
        .filter(|artifact| {
            artifact.metadata.kind.starts_with("node-output:")
                || is_researcher_output_kind(&artifact.metadata.kind)
                || matches!(
                    artifact.metadata.kind.as_str(),
                    "source-coordinate-index-arrow"
                        | "result-cell-correspondence-arrow"
                        | "source-result-influence-arrow"
                )
        })
        .map(|artifact| artifact.metadata.digest.clone())
        .chain(
            ingress
                .assignments
                .values()
                .map(|assignment| assignment.artifact.digest.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    artifacts.push(runtime_artifact(&services.store,
        "correspondence-index-json",
        "application/json",
        correspondence_bytes,
        correspondence_dependencies,
    ));
    timer.finish();
    let timer = EnvelopeTimer::start("post_journal_views_root");
    for (index, execution) in query_group_executions.iter().enumerate() {
        let from_state = ingress
            .materialization
            .query_group_states
            .get(&execution.query_group_id)
            .copied();
        let to_state = materialization.query_group_states[&execution.query_group_id];
        ingress
            .journal
            .append(Transition {
                event_kind: match execution.status {
                    ExecutionStatus::Cached => "node-cached",
                    ExecutionStatus::Recomputed => "node-recomputed",
                    ExecutionStatus::Error => "node-error",
                    ExecutionStatus::Skipped => "node-skipped",
                    ExecutionStatus::Bypassed => "node-bypassed",
                },
                subject_id: &execution.query_group_id,
                from_state,
                to_state,
                reason_id: &execution.reason_id,
                source_id: EMBEDDED_PRODUCT_CONTRACT_SHA256,
                revision: ingress.assignments.len() as u64 + index as u64 + 1,
            })
            .map_err(|error| error.to_string())?;
    }
    ingress
        .journal
        .verify()
        .map_err(|error| error.to_string())?;
    let journal_bytes = ingress
        .journal
        .to_cbor()
        .map_err(|error| error.to_string())?;
    let journal_artifact = runtime_artifact(&services.store,
        "evidence-journal",
        "application/cbor",
        journal_bytes,
        vec![ingress.input.digest.clone(), options_digest.clone()],
    );
    let journal_digest = journal_artifact.metadata.digest.clone();
    artifacts.push(journal_artifact);
    let assignment_digests = ingress
        .assignments
        .iter()
        .map(|(role, assignment)| (role.as_str(), assignment.artifact.digest.as_str()))
        .collect::<BTreeMap<_, _>>();
    let computational_artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let execution_state_bytes = serde_jcs::to_vec(&ExecutionStateCommit {
        protocol_version: "chronicle-execution-state/v1",
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &ingress.input.digest,
        options_digest: &options_digest,
        assignment_digests: assignment_digests.clone(),
        computational_artifact_digests,
        journal_digest: &journal_digest,
    })
    .map_err(|error| format!("canonicalize execution state: {error}"))?;
    let execution_state_artifact = runtime_artifact(&services.store,
        "execution-state-json",
        "application/json",
        execution_state_bytes,
        vec![
            ingress.input.digest.clone(),
            options_digest.clone(),
            journal_digest.clone(),
        ],
    );
    let execution_state_digest = execution_state_artifact.metadata.digest.clone();
    artifacts.push(execution_state_artifact);

    let revision = ingress.assignments.len() as u64
        + query_group_executions.len() as u64
        + query_executions.len() as u64;
    let assignments: Vec<_> = ingress.assignments.values().cloned().collect();
    let artifact_refs: Vec<_> = artifacts
        .iter()
        .map(|artifact| ArtifactRef {
            artifact_id: artifact.metadata.artifact_id.clone(),
            digest: artifact.metadata.digest.clone(),
            media_type: artifact.metadata.media_type.clone(),
            size: artifact.metadata.size,
            derived_from: artifact.metadata.derived_from.clone(),
            qualifiers: BTreeMap::new(),
        })
        .collect();
    let explorer_request = WorkflowExplorerRequest {
        options: exact_options_value.clone(),
        support_roles: ingress
            .assignments
            .iter()
            .filter(|(role_id, _)| is_workflow_support_role(role_id))
            .map(|(role_id, assignment)| WorkflowExplorerSupportRole {
                role_id: role_id.clone(),
                present: true,
                digest: Some(assignment.artifact.digest.clone()),
            })
            .collect(),
        selected_run_root: Some(execution_state_digest.clone()),
    };
    let views = [
        (
            "workflow-explorer-view-json",
            serde_json::to_value(build_workflow_explorer_view(
                &explorer_request,
                &query_executions,
                revision,
                Some(&execution_state_digest),
            )?)
            .map_err(|error| format!("serialize workflow explorer view: {error}"))?,
        ),
        (
            "artifact-view-json",
            encode_view(&artifact_view(
                artifact_refs,
                assignments.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
        (
            "obligation-view-json",
            encode_view(&obligation_view(
                materialization.obligations.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
        (
            "explanation-view-json",
            encode_view(&explanation_view(
                materialization.reasons.clone(),
                materialization.qualification_traces.clone(),
                materialization.requirement_traces.clone(),
                revision,
                &execution_state_digest,
            )),
        ),
    ];
    let mut required_views = Vec::with_capacity(REQUIRED_VIEWS.len());
    for ((expected_kind, expected_view_id, expected_schema_id), (kind, view)) in
        REQUIRED_VIEWS.into_iter().zip(views)
    {
        if !required_view_contract_matches(
            kind,
            &view,
            expected_kind,
            expected_view_id,
            expected_schema_id,
            &execution_state_digest,
        ) {
            return Err(format!("typed view contract drift: {kind}"));
        }
        let bytes = serde_jcs::to_vec(&view)
            .map_err(|error| format!("canonicalize typed view {kind}: {error}"))?;
        let artifact = runtime_artifact(&services.store,
            kind,
            "application/json",
            bytes,
            vec![execution_state_digest.clone()],
        );
        required_views.push(RequiredViewBinding {
            artifact_kind: expected_kind,
            view_id: expected_view_id,
            schema_id: expected_schema_id,
            artifact_digest: artifact.metadata.digest.clone(),
        });
        artifacts.push(artifact);
    }

    let closure_bytes = serde_jcs::to_vec(&ArtifactClosure {
        protocol_version: "chronicle-artifact-closure/v1",
        workspace_id: &request.workspace_id,
        input_digest: &ingress.input.digest,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        previous_workspace_root_digest: &request.workspace_root_digest,
        options_digest: &options_digest,
        assignment_digests: assignment_digests.clone(),
        execution_state_digest: &execution_state_digest,
        journal_digest: &journal_digest,
        artifacts: artifacts
            .iter()
            .map(|artifact| &artifact.metadata)
            .collect(),
    })
    .map_err(|error| format!("canonicalize artifact closure: {error}"))?;
    let closure_artifact = runtime_artifact(&services.store,
        "artifact-closure-json",
        "application/json",
        closure_bytes,
        vec![execution_state_digest.clone(), journal_digest.clone()],
    );
    let artifact_closure_digest = closure_artifact.metadata.digest.clone();
    artifacts.push(closure_artifact);

    let artifact_digests = artifacts
        .iter()
        .map(|artifact| artifact.metadata.digest.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let workflow_contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    let root_commit = RootCommit {
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        workflow_model_version:
            chronicle_chrono_kernel_wasm::workflow_contract::WORKFLOW_MODEL_VERSION,
        workflow_compatibility_digest: &workflow_contract.digests.workspace_compatibility,
        command: EXECUTE_WORKSPACE_COMMAND,
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_digest: EMBEDDED_PROFILE_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        dependency_cache_mode: dependency_cache_decision.mode,
        workspace_id: &request.workspace_id,
        previous_workspace_root_digest: &request.workspace_root_digest,
        input_digest: &ingress.input.digest,
        options_digest: &options_digest,
        assignment_digests,
        artifact_digests,
        execution_state_digest: &execution_state_digest,
        required_views: &required_views,
        journal_digest: &journal_digest,
        artifact_closure_digest: &artifact_closure_digest,
    };
    let root_bytes = serde_jcs::to_vec(&root_commit)
        .map_err(|error| format!("canonicalize root commit: {error}"))?;
    let root_artifact = runtime_artifact(&services.store,
        "workspace-root-json",
        "application/json",
        root_bytes,
        vec![artifact_closure_digest.clone()],
    );
    let workspace_root_digest = root_artifact.metadata.digest.clone();
    record_incremental_workspace_root(states, &request.workspace_id, &workspace_root_digest);
    artifacts.push(root_artifact);
    timer.finish();
    let timer = EnvelopeTimer::start("post_manifest");
    let result_published_outputs_digest = result_digests.published_outputs_digest;
    let result_provenance_digest = result_digests.provenance_digest;
    let manifest = RuntimeManifest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        preprocessor_version: chronicle_chrono_kernel_wasm::pipeline_v2::PREPROCESSOR_VERSION
            .into(),
        request_id: request.request_id,
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        implementation: "chronicle_preprocessing_runtime_wasm/0.1.0".into(),
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST.into(),
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST.into(),
        scope: "selected-runtime-csv-artifacts".into(),
        plan_digest: EMBEDDED_PLAN_SHA256.into(),
        profile_digest: EMBEDDED_PROFILE_SHA256.into(),
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256.into(),
        runtime_authority_digest: EMBEDDED_RUNTIME_AUTHORITY_SHA256.into(),
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256.into(),
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
        dependency_cache_decision,
        previous_workspace_root_digest: request.workspace_root_digest,
        workspace_id: request.workspace_id,
        workspace_root_digest,
        options_digest,
        input: ingress.input,
        role_assignments: assignments,
        qualification_traces: materialization.qualification_traces,
        requirement_traces: materialization.requirement_traces,
        open_obligations: materialization.obligations,
        state_reasons: materialization.reasons,
        query_group_executions,
        query_executions,
        artifacts: artifacts
            .iter()
            .map(|artifact| artifact.metadata.clone())
            .collect(),
        counts: RuntimeCounts {
            original: result.original_row_count,
            processed: result.processed_row_count,
            app: result.app_row_count,
            screen: result.screen_row_count,
        },
        eyes_evidence: eyes_evidence_summary.clone(),
        scientific_evidence: scientific_evidence_summary.clone(),
        processing_summary: RuntimeProcessingSummary {
            available_timezones: result.available_timezones.clone(),
            timezone: result.timezone.clone(),
            timezone_action: result.timezone_action.clone(),
            rows_before_timezone_handling: result.rows_before_timezone_handling,
            rows_after_timezone_handling: result.rows_after_timezone_handling,
            rows_removed_by_timezone: result.rows_removed_by_timezone,
            timezone_retained_source_rows_digest: result
                .timezone_retained_source_rows_digest
                .clone(),
            timezone_stage_digest: result.timezone_stage_digest.clone(),
            workflow_query_group_digests: result.workflow_query_group_digests.clone(),
            workflow_query_group_checkpoints: result.workflow_query_group_checkpoints.clone(),
            workflow_query_digests: result.workflow_query_digests.clone(),
            workflow_query_checkpoints: result.workflow_query_checkpoints.clone(),
            published_outputs_digest: result_published_outputs_digest,
            provenance_digest: result_provenance_digest,
            opener_set_receipt: result.opener_set_evidence.clone(),
            maximum_duration_receipt: result
                .maximum_duration_evidence
                .as_ref()
                .map(|evidence| evidence.receipt.clone()),
            eyes_evidence: eyes_evidence_summary,
            scientific_evidence: scientific_evidence_summary,
            duplicate_timestamps_corrected: result.duplicate_timestamps_corrected,
            exact_duplicate_rows_removed: result.exact_duplicate_rows_removed,
            cleaning_counts: result.cleaning_counts,
        },
        journal_digest,
    };
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|error| format!("serialize runtime manifest: {error}"))?;
    timer.finish();
    drop(result);
    // See the review branch above: a failed spill never changes a finished
    // result and is counted by the store.
    let _ = services.store.enforce_budget();
    Ok(RuntimeHandle {
        manifest_json,
        artifacts,
    })
}

fn build_execution_ledger(
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
    executions: &[QueryGroupExecution],
    query_executions: &[RuntimeQueryExecution],
    options: &Value,
    timestamp: &str,
) -> Result<Vec<u8>, String> {
    let status_by_query_group: BTreeMap<_, _> = executions
        .iter()
        .map(|execution| (execution.query_group_id.as_str(), execution.status))
        .collect();
    let execution_by_query = query_executions
        .iter()
        .map(|execution| (execution.query_id.as_str(), execution))
        .collect::<BTreeMap<_, _>>();
    let ledger = plan
        .query_groups
        .iter()
        .map(|node| {
            let status = status_by_query_group
                .get(node.query_group_id.as_str())
                .copied()
                .unwrap_or(ExecutionStatus::Error);
            let queries = plan
                .queries
                .iter()
                .filter(|query| query.query_group_id == node.query_group_id)
                .map(|query| {
                    let execution = execution_by_query.get(query.query_id.as_str()).copied();
                    serde_json::json!({
                        "queryId": query.query_id,
                        "queryGroupId": query.query_group_id,
                        "status": execution.map(|execution| execution.status).unwrap_or(ExecutionStatus::Error),
                        "inputKey": execution.map(|execution| execution.input_key.as_str()),
                        "outputDigest": execution.map(|execution| execution.output_digest.as_str()),
                        "reasonId": execution.map(|execution| execution.reason_id.as_str()),
                        "applicable": query.applicability.evaluate(options),
                        "rowsIn": Value::Null,
                        "rowsOut": Value::Null,
                        "droppedRows": Value::Null,
                        "expectations": [],
                        "timing": {
                            "startedAt": timestamp,
                            "endedAt": timestamp,
                            "durationMs": 0
                        }
                    })
                })
                .collect::<Vec<_>>();
            let status = match status {
                ExecutionStatus::Cached => "cached",
                ExecutionStatus::Recomputed => "recomputed",
                ExecutionStatus::Error => "error",
                ExecutionStatus::Skipped => "skipped",
                ExecutionStatus::Bypassed => "bypassed",
            };
            serde_json::json!({
                "queryGroupId": node.query_group_id,
                "status": status,
                "rowsIn": Value::Null,
                "rowsOut": Value::Null,
                "expectations": [],
                "queries": queries,
                "timing": {
                    "startedAt": timestamp,
                    "endedAt": timestamp,
                    "durationMs": 0
                }
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_vec(&ledger).map_err(|error| format!("serialize execution ledger: {error}"))
}

fn materialize_ingress(
    csv_bytes: &[u8],
    input_size_bytes: u64,
    verified_input_digest: &str,
    options_bytes: &[u8],
    options: &Value,
    support_files: &ResolvedSupportFiles,
) -> Result<IngressMaterialization, String> {
    let plan = embedded_plan();
    let mut assignments = BTreeMap::new();
    let input = assign(
        &mut assignments,
        "raw_chronicle_csv",
        "text/csv",
        csv_bytes,
        Some(verified_input_digest),
        Some(input_size_bytes),
        BTreeMap::new(),
    )?;
    assign(
        &mut assignments,
        "processing_options",
        "application/json",
        options_bytes,
        None,
        None,
        BTreeMap::new(),
    )?;
    for (role, file) in &support_files.files {
        let qualifiers = if role == "input_capability_evidence_file" {
            BTreeMap::from([
                ("content_validation".into(), "not-required".into()),
                ("content_validation_authority".into(), "rust-kernel".into()),
                (
                    "assignment_authority".into(),
                    "chronicle-runtime-scientific-ingress/v1".into(),
                ),
            ])
        } else {
            let mut qualifiers = BTreeMap::from([(
                "content_validation".into(),
                if file.content_validation_error.is_none() {
                    "passed".into()
                } else {
                    "failed".into()
                },
            )]);
            qualifiers.insert(
                "content_validation_rule".into(),
                format!("chronicle.support-schema.{role}.v1"),
            );
            if let Some(error) = &file.content_validation_error {
                qualifiers.insert("content_validation_error".into(), error.clone());
            }
            qualifiers
        };
        assign(
            &mut assignments,
            role,
            file.media_type,
            &file.original_bytes,
            None,
            None,
            qualifiers,
        )?;
    }
    let materialization = evaluate_materialization(
        plan,
        &assignments,
        options,
        &BTreeSet::new(),
        &BTreeSet::new(),
    );
    if let Some(capability_assignment) = assignments.get("input_capability_evidence_file") {
        let qualified = materialization.qualification_traces.iter().any(|trace| {
            trace.candidate_id == capability_assignment.assignment_id
                && trace.selected_role_id.as_deref() == Some("input_capability_evidence_file")
                && trace.decision
                    == chronicle_preprocessing_semantic_adapter::QualificationDecision::Accepted
        });
        if !qualified {
            return Err(
                "active scientific ingress role is not registered by the embedded semantic plan"
                    .into(),
            );
        }
    }
    let mut journal = EvidenceJournal::default();
    for assignment in assignments.values() {
        journal
            .append(Transition {
                event_kind: "role-assigned",
                subject_id: &assignment.role_id,
                from_state: Some(MaterializationState::Open),
                to_state: MaterializationState::Satisfied,
                reason_id: &assignment.assignment_id,
                source_id: &assignment.artifact.digest,
                revision: assignment.revision,
            })
            .map_err(|error| error.to_string())?;
    }
    journal.verify().map_err(|error| error.to_string())?;
    Ok(IngressMaterialization {
        input,
        assignments,
        materialization,
        journal,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_normalized_support_artifacts(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    artifacts: &mut Vec<RuntimeArtifact>,
    assignments: &BTreeMap<String, RoleAssignment>,
    support_files: &ResolvedSupportFiles,
) -> Result<(), String> {
    for (role, file) in &support_files.files {
        if !file.normalized_from_xlsx {
            continue;
        }
        let source = assignments.get(role).ok_or_else(|| {
            format!("missing source assignment for normalized support role {role}")
        })?;
        artifacts.push(runtime_artifact(store,
            &format!("normalized-support:{role}"),
            "text/csv",
            file.pipeline_csv.clone(),
            vec![source.artifact.digest.clone()],
        ));
    }
    Ok(())
}

struct CorrespondenceEdgeSpec {
    source_kind: &'static str,
    source_id: String,
    relation: String,
    target_kind: &'static str,
    target_id: String,
    precision: &'static str,
    evidence_ids: Vec<String>,
}

fn correspondence_edge(
    source_kind: &'static str,
    source_id: impl Into<String>,
    relation: impl Into<String>,
    target_kind: &'static str,
    target_id: impl Into<String>,
    precision: &'static str,
) -> CorrespondenceEdgeSpec {
    CorrespondenceEdgeSpec {
        source_kind,
        source_id: source_id.into(),
        relation: relation.into(),
        target_kind,
        target_id: target_id.into(),
        precision,
        evidence_ids: Vec::new(),
    }
}

impl CorrespondenceEdgeSpec {
    fn with_evidence(mut self, evidence_ids: Vec<String>) -> Self {
        self.evidence_ids = evidence_ids;
        self
    }
}

fn append_correspondence_edge(edges: &mut Vec<CorrespondenceEdge>, spec: CorrespondenceEdgeSpec) {
    let mut evidence_ids = spec.evidence_ids;
    evidence_ids.sort();
    evidence_ids.dedup();
    let edge_id = stable_id(&[
        "correspondence-edge",
        spec.source_kind,
        &spec.source_id,
        &spec.relation,
        spec.target_kind,
        &spec.target_id,
        spec.precision,
        &evidence_ids.join(","),
    ]);
    edges.push(CorrespondenceEdge {
        edge_id,
        source_kind: spec.source_kind,
        source_id: spec.source_id,
        relation: spec.relation,
        target_kind: spec.target_kind,
        target_id: spec.target_id,
        precision: spec.precision,
        evidence_ids,
    });
}

fn is_researcher_output_kind(kind: &str) -> bool {
    matches!(
        kind,
        "app-csv"
            | "screen-csv"
            | "day-coverage-csv"
            | "compliance-csv"
            | "credited-app-csv"
            | "notification-contact-csv"
            | "polled-emulation-csv"
            | "interval-expansion-csv"
            | "review-summary-json"
            | "visualization-data-json"
            | "app-parquet"
            | "screen-parquet"
            | "app-spss"
            | "screen-spss"
            | "row-lineage-arrow"
    ) || kind.starts_with("aggregate-")
}

fn is_scientific_evidence_kind(kind: &str) -> bool {
    matches!(
        kind,
        FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND
            | MINIMUM_DURATION_EXCLUDED_LINEAGE_KIND
            | ZERO_DURATION_CLEANUP_EVIDENCE_KIND
            | ZERO_DURATION_REMOVED_LINEAGE_KIND
            | B05_SCREEN_CONSTRUCTION_EVIDENCE_KIND
            | SCHOEDEL_RECONSTRUCTION_EVIDENCE_KIND
            | B05_SCHOEDEL_VALIDATION_RECEIPT_KIND
            | EYES_TAGGED_FAU_EVIDENCE_KIND
            | EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND
    )
}

fn is_canonical_cell_output_kind(kind: &str) -> bool {
    matches!(
        kind,
        "app-csv" | "screen-csv" | "day-coverage-csv" | "compliance-csv" | "credited-app-csv"
    ) || kind.starts_with("aggregate-")
}

fn build_correspondence_index(inputs: CorrespondenceIndexInputs<'_>) -> Result<Vec<u8>, String> {
    let CorrespondenceIndexInputs {
        plan,
        assignments,
        materialization,
        query_group_executions,
        options,
        artifacts,
        checkpoints,
        query_checkpoints,
    } = inputs;
    let mut edges = Vec::new();

    for assignment in assignments.values() {
        let trace = materialization.qualification_traces.iter().find(|trace| {
            trace.candidate_id == assignment.assignment_id
                && trace.selected_role_id.as_deref() == Some(assignment.role_id.as_str())
        });
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "artifact",
                assignment.artifact.digest.clone(),
                "qualified-as",
                "role",
                assignment.role_id.clone(),
                "exact",
            )
            .with_evidence(
                trace
                    .map(|trace| vec![trace.trace_id.clone()])
                    .unwrap_or_default(),
            ),
        );
        if let Some(trace) = trace {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "qualification-trace",
                    trace.trace_id.clone(),
                    "selects-assignment",
                    "assignment",
                    assignment.assignment_id.clone(),
                    "exact",
                )
                .with_evidence(vec![trace.reason_id.clone()]),
            );
        }
    }

    if let Some(raw) = assignments.get("raw_chronicle_csv") {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "role",
                raw.role_id.clone(),
                "binds-input",
                "workflow-query-group",
                "parse_events",
                "declared",
            )
            .with_evidence(vec![raw.assignment_id.clone()]),
        );
    }

    let processing_assignment = assignments.get("processing_options");
    let option_keys = plan
        .query_groups
        .iter()
        .flat_map(|node| node.knobs.iter().map(|knob| knob.option_key.as_str()))
        .collect::<BTreeSet<_>>();
    for option_key in option_keys {
        let value = options.get(option_key).unwrap_or(&Value::Null);
        let value_digest = sha256(&serde_jcs::to_vec(value).map_err(|error| {
            format!("canonicalize correspondence option {option_key}: {error}")
        })?);
        let option_id = format!("option:{option_key}:{value_digest}");
        if let Some(assignment) = processing_assignment {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    assignment.artifact.digest.clone(),
                    "contains-resolved-option",
                    "configuration-value",
                    option_id.clone(),
                    "exact",
                )
                .with_evidence(vec![assignment.assignment_id.clone()]),
            );
        }
        for node in &plan.query_groups {
            for knob in node
                .knobs
                .iter()
                .filter(|knob| knob.option_key == option_key)
            {
                append_correspondence_edge(
                    &mut edges,
                    correspondence_edge(
                        "configuration-value",
                        option_id.clone(),
                        format!("{}-node", knob.edge),
                        "workflow-query-group",
                        node.query_group_id.clone(),
                        "declared",
                    )
                    .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
                );
            }
        }
    }

    for node in &plan.query_groups {
        for role_id in &node.support_roles {
            let evidence = assignments
                .get(role_id)
                .map(|assignment| vec![assignment.assignment_id.clone()])
                .unwrap_or_default();
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "role",
                    role_id.clone(),
                    "binds-support",
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "declared",
                )
                .with_evidence(evidence),
            );
        }
        for input_node in &node.input_query_groups {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-group",
                    input_node.clone(),
                    "feeds",
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = checkpoints.get(&node.query_group_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "workflow-query-group",
                    node.query_group_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for step in &plan.queries {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "workflow-query",
                step.query_id.clone(),
                "belongs-to",
                "workflow-query-group",
                step.query_group_id.clone(),
                "declared",
            )
            .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
        );
        for input_step in &step.input_queries {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query",
                    input_step.clone(),
                    "feeds",
                    "workflow-query",
                    step.query_id.clone(),
                    "declared",
                )
                .with_evidence(vec![EMBEDDED_PLAN_SHA256.into()]),
            );
        }
        if let Some(checkpoint) = query_checkpoints.get(&step.query_id) {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-checkpoint",
                    checkpoint.terminal_digest.clone(),
                    "commits-state-of",
                    "workflow-query",
                    step.query_id.clone(),
                    "exact",
                )
                .with_evidence(vec![checkpoint.schema_digest.clone()]),
            );
        }
    }

    for execution in query_group_executions {
        if let Some(output) = &execution.output {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "workflow-query-group",
                    execution.query_group_id.clone(),
                    "materializes",
                    "artifact",
                    output.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![
                    execution.reason_id.clone(),
                    execution.input_key.clone(),
                ]),
            );
        }
    }
    for artifact in artifacts
        .iter()
        .filter(|artifact| is_researcher_output_kind(&artifact.metadata.kind))
    {
        append_correspondence_edge(
            &mut edges,
            correspondence_edge(
                "workflow-query-group",
                if artifact.metadata.kind == "credited-app-csv" {
                    "effective_usage"
                } else {
                    "outputs"
                },
                "publishes",
                "artifact",
                artifact.metadata.digest.clone(),
                "exact",
            )
            .with_evidence(artifact.metadata.derived_from.clone()),
        );
    }

    if let Some(cell_index) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "result-cell-correspondence-arrow")
    {
        for output in artifacts
            .iter()
            .filter(|artifact| is_canonical_cell_output_kind(&artifact.metadata.kind))
        {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    cell_index.metadata.digest.clone(),
                    "indexes-cells-of",
                    "artifact",
                    output.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![cell_index.metadata.digest.clone()]),
            );
        }
        if let Some(row_index) = artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == "row-lineage-arrow")
        {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    cell_index.metadata.digest.clone(),
                    "joins-row-correspondence",
                    "artifact",
                    row_index.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![cell_index.metadata.digest.clone()]),
            );
        }
    }

    if let Some(source_index) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "source-coordinate-index-arrow")
    {
        for assignment in assignments.values() {
            append_correspondence_edge(
                &mut edges,
                correspondence_edge(
                    "artifact",
                    assignment.artifact.digest.clone(),
                    "has-source-coordinates-in",
                    "artifact",
                    source_index.metadata.digest.clone(),
                    "exact",
                )
                .with_evidence(vec![assignment.assignment_id.clone()]),
            );
        }
    }

    if let Some(influence) = artifacts
        .iter()
        .find(|artifact| artifact.metadata.kind == "source-result-influence-arrow")
    {
        for (source_kind, relation, precision) in [
            (
                "source-coordinate-index-arrow",
                "supplies-source-coordinates-to",
                "exact",
            ),
            (
                "result-cell-correspondence-arrow",
                "supplies-result-coordinates-to",
                "exact",
            ),
            (
                "row-lineage-arrow",
                "supplies-conservative-row-witnesses-to",
                "conservative",
            ),
        ] {
            if let Some(source) = artifacts
                .iter()
                .find(|artifact| artifact.metadata.kind == source_kind)
            {
                append_correspondence_edge(
                    &mut edges,
                    correspondence_edge(
                        "artifact",
                        source.metadata.digest.clone(),
                        relation,
                        "artifact",
                        influence.metadata.digest.clone(),
                        precision,
                    )
                    .with_evidence(vec![EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into()]),
                );
            }
        }
    }

    edges.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
    let index = CorrespondenceIndex {
        protocol_version: "chronicle-correspondence-index/v4",
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        build_environment_digest: BUILD_ENVIRONMENT_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        product_contract_digest: EMBEDDED_PRODUCT_CONTRACT_SHA256,
        claim_boundary: "Bidirectional graph traversal over exact source/result coordinate identities, qualification, checkpoint, execution, publication, and cell-to-row joins plus declared plan/role/knob dependencies. The influence witness makes declared checkpoint reachability, conservative raw-row candidate cells, and unresolved result scopes explicit. Exact raw-field/support-record contribution is not claimed, and absence of a cell edge is never a non-influence claim.",
        source_coordinate_artifact_kind: "source-coordinate-index-arrow",
        row_correspondence_artifact_kind: "row-lineage-arrow",
        cell_correspondence_artifact_kind: "result-cell-correspondence-arrow",
        influence_witness_artifact_kind: "source-result-influence-arrow",
        edges,
    };
    serde_jcs::to_vec(&index).map_err(|error| format!("canonicalize correspondence index: {error}"))
}

fn assign(
    assignments: &mut BTreeMap<String, RoleAssignment>,
    role_id: &str,
    media_type: &str,
    bytes: &[u8],
    verified_digest: Option<&str>,
    verified_size: Option<u64>,
    qualifiers: BTreeMap<String, String>,
) -> Result<ArtifactRef, String> {
    let digest = verified_digest
        .map(str::to_owned)
        .unwrap_or_else(|| sha256(bytes));
    validate_digest(&digest)
        .map_err(|message| format!("artifact digest for role {role_id} {message}"))?;
    let artifact = ArtifactRef {
        artifact_id: semantic_artifact_id(role_id, &digest),
        digest,
        media_type: media_type.to_string(),
        size: verified_size.unwrap_or(bytes.len() as u64),
        derived_from: Vec::new(),
        qualifiers: qualifiers.clone(),
    };
    let revision = assignments.len() as u64 + 1;
    assignments.insert(
        role_id.into(),
        RoleAssignment {
            assignment_id: stable_id(&["assignment", role_id, &artifact.digest]),
            role_id: role_id.into(),
            artifact: artifact.clone(),
            qualifiers,
            revision,
        },
    );
    Ok(artifact)
}

fn output_artifacts(
    result: Arc<PipelineV2Result>,
    payloads: &BTreeMap<String, PayloadBytes>,
    dependencies: &[String],
    output_digests: &BTreeMap<String, String>,
) -> Vec<RuntimeArtifact> {
    let digest_for = |kind: &str| {
        output_digests
            .get(kind)
            .unwrap_or_else(|| panic!("missing precomputed output digest for {kind}"))
            .clone()
    };
    let mut artifacts = Vec::new();
    if !result.app_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "app-csv",
            result.app_row_count,
            dependencies,
            digest_for("app-csv"),
        ));
    }
    if !result.screen_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "screen-csv",
            result.screen_row_count,
            dependencies,
            digest_for("screen-csv"),
        ));
    }
    if !result.day_coverage_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "day-coverage-csv",
            result.day_coverage_row_count,
            dependencies,
            digest_for("day-coverage-csv"),
        ));
    }
    if !result.compliance_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "compliance-csv",
            result.compliance_row_count,
            dependencies,
            digest_for("compliance-csv"),
        ));
    }
    if !result.credited_app_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "credited-app-csv",
            result.credited_app_row_count,
            dependencies,
            digest_for("credited-app-csv"),
        ));
    }
    if !result.notification_contact_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "notification-contact-csv",
            result.notification_contact_row_count,
            dependencies,
            digest_for("notification-contact-csv"),
        ));
    }
    if !result.polled_emulation_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "polled-emulation-csv",
            result.polled_emulation_row_count,
            dependencies,
            digest_for("polled-emulation-csv"),
        ));
    }
    if !result.interval_expansion_csv_bytes.is_empty() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            "interval-expansion-csv",
            result.interval_expansion_row_count,
            dependencies,
            digest_for("interval-expansion-csv"),
        ));
    }
    for aggregate in result.aggregate_csv_outputs.iter() {
        artifacts.push(shared_pipeline_aggregate_artifact(
            payloads,
            &aggregate.kind,
            aggregate.row_count,
            dependencies,
            digest_for(&aggregate.kind),
        ));
    }
    artifacts.push(shared_pipeline_artifact(
        payloads,
        "review-summary-json",
        "application/json",
        dependencies.to_vec(),
        digest_for("review-summary-json"),
    ));
    artifacts.push(shared_pipeline_artifact(
        payloads,
        "visualization-data-json",
        "application/json",
        dependencies.to_vec(),
        digest_for("visualization-data-json"),
    ));
    artifacts
}

fn shared_pipeline_artifact(
    payloads: &BTreeMap<String, PayloadBytes>,
    kind: &str,
    media_type: &str,
    derived_from: Vec<String>,
    digest: String,
) -> RuntimeArtifact {
    let bytes = payloads.get(kind)
        .unwrap_or_else(|| panic!("missing shared pipeline output for {kind}"));
    let size = bytes.len() as u64;
    RuntimeArtifact {
        metadata: RuntimeArtifactMetadata {
            artifact_id: semantic_artifact_id(kind, &digest),
            kind: kind.into(),
            media_type: media_type.into(),
            digest,
            size,
            derived_from,
            scientific_source_bindings: Vec::new(),
            row_count: None,
            preview_rows: None,
        },
        bytes: bytes.clone(),
    }
}

fn shared_pipeline_aggregate_artifact(
    payloads: &BTreeMap<String, PayloadBytes>,
    kind: &str,
    row_count: u32,
    dependencies: &[String],
    digest: String,
) -> RuntimeArtifact {
    let mut artifact =
        shared_pipeline_artifact(payloads, kind, "text/csv", dependencies.to_vec(), digest);
    artifact.metadata.row_count = Some(row_count);
    artifact
}

fn canonical_cell_outputs(result: &PipelineV2Result) -> Vec<binary_exports::CanonicalOutput<'_>> {
    // Index the researcher-facing tabular values once. Review and visualization
    // JSON are deterministic views of these outputs and retain artifact-level
    // content hashes; indexing every copied JSON leaf duplicated the same data.
    let mut outputs = Vec::new();
    let candidates = [
        (
            "app-csv",
            "text/csv",
            &result.app_csv_bytes,
            "outputs",
        ),
        (
            "screen-csv",
            "text/csv",
            &result.screen_csv_bytes,
            "outputs",
        ),
        (
            "day-coverage-csv",
            "text/csv",
            &result.day_coverage_csv_bytes,
            "day_coverage",
        ),
        (
            "compliance-csv",
            "text/csv",
            &result.compliance_csv_bytes,
            "score_compliance",
        ),
        (
            "credited-app-csv",
            "text/csv",
            &result.credited_app_csv_bytes,
            "effective_usage",
        ),
        // notification-contact-csv and polled-emulation-csv are deliberately
        // NOT cell-index candidates: the contract's output_cell_bindings() /
        // ROW_ADDRESSED_OUTPUT_KINDS declare no cells for them, and their
        // earlier half-inclusion here (from the B08/B09 axis commits) meant
        // that with either axis on, their cells landed in
        // result-cell-correspondence-arrow and their digests in its
        // derived_from while is_canonical_cell_output_kind published no
        // indexes-cells-of edge and expected_cell_dependencies would red —
        // three surfaces disagreeing. This list now matches
        // is_canonical_cell_output_kind exactly. Both kinds keep byte-level
        // artifact publication, digests, and researcher-output `publishes`
        // edges; promoting them to cell-addressed is the recorded
        // four-declaration operator decision in docs/verification-sweep-goal.md.
    ];
    for (kind, media_type, bytes, terminal_query_group) in candidates {
        if !bytes.is_empty() {
            outputs.push(binary_exports::CanonicalOutput {
                kind,
                media_type,
                bytes,
                terminal_query_group,
            });
        }
    }
    outputs.extend(result.aggregate_csv_outputs.iter().map(|aggregate| {
        binary_exports::CanonicalOutput {
            kind: aggregate.kind.as_str(),
            media_type: "text/csv",
            bytes: &aggregate.bytes,
            terminal_query_group: "outputs",
        }
    }));
    outputs
}

/// The enabled binary encodings of one canonical CSV family: the Parquet bytes
/// and the SPSS bytes, each present only when that export option is on.
type EncodedExportFamily = (Option<Vec<u8>>, Option<Vec<u8>>);

#[allow(clippy::too_many_arguments)]
fn append_binary_exports(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    artifacts: &mut Vec<RuntimeArtifact>,
    result: &PipelineV2Result,
    lineage_payload: &PayloadHandle<Vec<chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage>>,
    options: &PipelineV2OptionsJson,
    dependencies: &[String],
    input_digest: &str,
    output_digests: &BTreeMap<String, String>,
    build_provenance_evidence: bool,
) -> Result<(), String> {
    let lineage = lineage_payload.lease()?;
    {
        let mut append = |kind: &str, media_type: &str, bytes: PayloadBytes, row_count: u32| {
            let mut artifact = payload_artifact(kind, media_type, bytes, dependencies.to_vec())?;
            artifact.metadata.row_count = Some(row_count);
            artifacts.push(artifact);
            Ok::<(), String>(())
        };
        // Parquet and SPSS are two encodings of the same canonical CSV, so the
        // reparse is shared: with both enabled, the 40k-row app CSV used to be
        // parsed twice (measured 48.1 ms and 44.3 MB of `CsvTable` strings per
        // parse; see `binary_exports::perf_measurement`). `encode_export_family`
        // parses one CSV family once, writes every enabled encoding of it, and
        // drops the table before the next family is parsed, so peak memory
        // still holds at most one `CsvTable`. The writers only read the table,
        // so both encodings are byte-identical to an independent reparse —
        // `binary_exports::tests::shared_export_table_is_byte_identical_to_independent_reparse`
        // pins that.
        let encode_export_family = |csv_bytes: &PayloadBytes,
                                    include: bool,
                                    screen: bool|
         -> Result<EncodedExportFamily, String> {
            if !include || !(options.enable_parquet_export || options.enable_spss_export) {
                return Ok((None, None));
            }
            let table = binary_exports::parse_csv(csv_bytes.reader())?;
            let parquet = options
                .enable_parquet_export
                .then(|| binary_exports::parquet_from_table(&table, screen))
                .transpose()?;
            let spss = options
                .enable_spss_export
                .then(|| binary_exports::sav_from_table(&table, screen))
                .transpose()?;
            Ok((parquet, spss))
        };
        let (app_parquet, app_spss) =
            encode_export_family(&result.app_csv_bytes, options.include_app_output, false)?;
        let (screen_parquet, screen_spss) = encode_export_family(
            &result.screen_csv_bytes,
            options.include_screen_output,
            true,
        )?;
        // Unchanged artifact order: app-parquet, screen-parquet, app-spss, screen-spss.
        if let Some(bytes) = app_parquet {
            append(
                "app-parquet",
                "application/vnd.apache.parquet",
                PayloadBytes::from_vec_with_store(bytes, store),
                result.app_row_count,
            )?;
        }
        if let Some(bytes) = screen_parquet {
            append(
                "screen-parquet",
                "application/vnd.apache.parquet",
                PayloadBytes::from_vec_with_store(bytes, store),
                result.screen_row_count,
            )?;
        }
        if let Some(bytes) = app_spss {
            append(
                "app-spss",
                "application/x-spss-sav",
                PayloadBytes::from_vec_with_store(bytes, store),
                result.app_row_count,
            )?;
        }
        if let Some(bytes) = screen_spss {
            append(
                "screen-spss",
                "application/x-spss-sav",
                PayloadBytes::from_vec_with_store(bytes, store),
                result.screen_row_count,
            )?;
        }
        let lineage_record_count = lineage
            .iter()
            .try_fold(0_u32, |count, lineage| {
                count
                    .checked_add(lineage.source_data_row_ranges.len() as u32)?
                    .checked_add(lineage.searches.len() as u32)
            })
            .ok_or_else(|| "row-lineage record count exceeds u32 metadata capacity".to_string())?;
        append(
            "row-lineage-arrow",
            "application/vnd.apache.arrow.file",
            binary_exports::row_lineage_arrow(store, &lineage, input_digest)?,
            lineage_record_count,
        )?;
    }

    if build_provenance_evidence {
        let canonical_outputs = canonical_cell_outputs(result);
        let canonical_kinds = canonical_outputs
            .iter()
            .map(|output| output.kind)
            .collect::<BTreeSet<_>>();
        let cell_dependencies = canonical_kinds
            .iter()
            .map(|kind| {
                output_digests
                    .get(*kind)
                    .cloned()
                    .ok_or_else(|| format!("missing canonical output digest for {kind}"))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .chain(
                artifacts
                    .iter()
                    .filter(|artifact| artifact.metadata.kind == "row-lineage-arrow")
                    .map(|artifact| artifact.metadata.digest.clone()),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let (cell_bytes, cell_count) =
            binary_exports::result_cell_correspondence_arrow(store, &canonical_outputs, &lineage)?;
        let mut cell_artifact = payload_artifact(
            "result-cell-correspondence-arrow",
            "application/vnd.apache.arrow.file",
            cell_bytes,
            cell_dependencies,
        )?;
        cell_artifact.metadata.row_count = Some(cell_count);
        artifacts.push(cell_artifact);
    }
    Ok(())
}

/// The raw CSV's header record alone, re-serialized so it parses to exactly
/// the columns the full file's header parses to.
fn raw_csv_header_record(raw_csv: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("read raw CSV header for the influence witness: {error}"))?
        .clone();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&headers)
        .and_then(|()| writer.flush().map_err(csv::Error::from))
        .map_err(|error| format!("write raw CSV header for the influence witness: {error}"))?;
    writer
        .into_inner()
        .map_err(|error| format!("write raw CSV header for the influence witness: {error}"))
}

fn canonical_sources<'a>(
    raw_csv: &'a [u8],
    options_json: &'a [u8],
    assignments: &'a BTreeMap<String, RoleAssignment>,
    support_files: &'a ResolvedSupportFiles,
) -> Result<Vec<binary_exports::CanonicalSource<'a>>, String> {
    let assignment = |role: &str| {
        assignments
            .get(role)
            .ok_or_else(|| format!("missing source-coordinate assignment for role {role}"))
    };
    let raw_assignment = assignment("raw_chronicle_csv")?;
    let options_assignment = assignment("processing_options")?;
    let mut sources = vec![
        binary_exports::CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest: &raw_assignment.artifact.digest,
            source_media_type: &raw_assignment.artifact.media_type,
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: raw_csv,
        },
        binary_exports::CanonicalSource {
            role_id: "processing_options",
            source_artifact_digest: &options_assignment.artifact.digest,
            source_media_type: &options_assignment.artifact.media_type,
            coordinate_media_type: "application/json",
            normalization: "canonical-json",
            bytes: options_json,
        },
    ];
    for (role, file) in &support_files.files {
        let source_assignment = assignment(role)?;
        sources.push(binary_exports::CanonicalSource {
            role_id: role,
            source_artifact_digest: &source_assignment.artifact.digest,
            source_media_type: &source_assignment.artifact.media_type,
            coordinate_media_type: "text/csv",
            normalization: if file.normalized_from_xlsx {
                "xlsx-first-sheet-to-csv"
            } else {
                "identity-csv"
            },
            bytes: &file.pipeline_csv,
        });
    }
    Ok(sources)
}

#[allow(clippy::too_many_arguments)]
fn append_source_coordinate_index(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    artifacts: &mut Vec<RuntimeArtifact>,
    result: &PipelineV2Result,
    lineage_payload: &PayloadHandle<Vec<chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage>>,
    binary_artifacts: &[RuntimeArtifact],
    raw_csv: Arc<Vec<u8>>,
    options_json: &[u8],
    assignments: &BTreeMap<String, RoleAssignment>,
    support_files: &ResolvedSupportFiles,
    plan: &chronicle_preprocessing_semantic_adapter::ChroniclePlan,
) -> Result<(), String> {
    let sources = canonical_sources(&raw_csv, options_json, assignments, support_files)?;
    let (bytes, row_count) = binary_exports::source_coordinate_index_arrow(store, &sources)?;
    let dependencies = assignments
        .values()
        .map(|assignment| assignment.artifact.digest.clone())
        .collect();
    let mut artifact = payload_artifact(
        "source-coordinate-index-arrow",
        "application/vnd.apache.arrow.file",
        bytes,
        dependencies,
    )?;
    artifact.metadata.row_count = Some(row_count);
    let source_coordinate_digest = artifact.metadata.digest.clone();
    artifacts.push(artifact);

    // The witness reads the raw source only for its header (which supplied
    // columns exist) and the options JSON for its coordinates. The raw
    // bytes go before it starts, and so does everything the payload store
    // kept resident under its budget: the index just written, the outputs,
    // the binary exports. The witness's own records are then the only
    // large thing on the heap while it sorts them, and each payload comes
    // back one at a time when something next leases it.
    let raw_header = raw_csv_header_record(&raw_csv)?;
    drop(sources);
    drop(raw_csv);
    store.evict_unpinned()?;
    let sources = canonical_sources(&raw_header, options_json, assignments, support_files)?;

    let canonical_outputs = canonical_cell_outputs(result);
    let context = binary_exports::InfluenceContext {
        implementation_digest: IMPLEMENTATION_BUILD_DIGEST,
        plan_digest: EMBEDDED_PLAN_SHA256,
        profile_lock_digest: EMBEDDED_PROFILE_LOCK_SHA256,
        dependency_certificate_digest: EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
    };
    let lineage = lineage_payload.lease()?;
    let (bytes, row_count) = binary_exports::source_result_influence_witness_arrow(store,
        &sources,
        &canonical_outputs,
        &lineage,
        plan,
        &result.workflow_query_group_checkpoints,
        &context,
    )?;
    let mut dependencies = vec![
        source_coordinate_digest,
        EMBEDDED_PLAN_SHA256.into(),
        EMBEDDED_PROFILE_LOCK_SHA256.into(),
        EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256.into(),
    ];
    dependencies.extend(
        binary_artifacts
            .iter()
            .filter(|artifact| {
                matches!(
                    artifact.metadata.kind.as_str(),
                    "result-cell-correspondence-arrow" | "row-lineage-arrow"
                )
            })
            .map(|artifact| artifact.metadata.digest.clone()),
    );
    dependencies.sort();
    dependencies.dedup();
    let mut artifact = payload_artifact(
        "source-result-influence-arrow",
        "application/vnd.apache.arrow.file",
        bytes,
        dependencies,
    )?;
    artifact.metadata.row_count = Some(row_count);
    artifacts.push(artifact);
    Ok(())
}

fn append_semantic_bundle_artifacts(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore, artifacts: &mut Vec<RuntimeArtifact>) {
    for (kind, bytes, expected_digest) in [
        (
            "chronicle-plan-json",
            embedded_plan_bytes(),
            EMBEDDED_PLAN_SHA256,
        ),
        (
            "runtime-authority-json",
            embedded_runtime_authority_bytes(),
            EMBEDDED_RUNTIME_AUTHORITY_SHA256,
        ),
        (
            "semantic-profile-json",
            embedded_profile_bytes(),
            EMBEDDED_PROFILE_SHA256,
        ),
        (
            "semantic-profile-lock-json",
            embedded_profile_lock_bytes(),
            EMBEDDED_PROFILE_LOCK_SHA256,
        ),
        (
            "dependency-certificate-json",
            embedded_dependency_certificate_bytes(),
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        ),
    ] {
        let artifact = runtime_artifact(store, kind, "application/json", bytes.to_vec(), Vec::new());
        assert_eq!(artifact.metadata.digest, expected_digest);
        artifacts.push(artifact);
    }
}

#[allow(clippy::too_many_arguments)]
fn runtime_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    kind: &str,
    media_type: &str,
    bytes: Vec<u8>,
    derived_from: Vec<String>,
) -> RuntimeArtifact {
    let digest = sha256(&bytes);
    runtime_artifact_with_digest(store, kind, media_type, bytes, derived_from, digest)
}

fn method_profile_receipt_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    receipt: Option<&MethodProfileReceipt>,
    options_digest: &str,
) -> Result<Option<RuntimeArtifact>, String> {
    receipt
        .map(|receipt| {
            Ok(runtime_artifact(
                store,
                "method-profile-receipt-json",
                "application/json",
                serde_jcs::to_vec(receipt)
                    .map_err(|error| format!("canonicalize method-profile receipt: {error}"))?,
                vec![options_digest.to_owned()],
            ))
        })
        .transpose()
}

fn method_profile_receipts_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    request: &RuntimeRequest,
    options_digest: &str,
) -> Result<Option<RuntimeArtifact>, String> {
    let mut receipts = request.active_method_profile_receipts()?;
    if receipts.len() <= 1 {
        return method_profile_receipt_artifact(store, receipts.first().copied(), options_digest);
    }
    receipts.sort_by_key(|receipt| receipt.diary_replication_binding.is_some());
    Ok(Some(runtime_artifact(
        store,
        "method-profile-receipts-json",
        "application/json",
        serde_jcs::to_vec(&receipts)
            .map_err(|error| format!("canonicalize method-profile receipts: {error}"))?,
        vec![options_digest.to_owned()],
    )))
}

fn literature_input_adaptation_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    receipt: Option<&LiteratureInputAdaptationReceipt>,
    derived_from: &[String],
) -> Result<Option<RuntimeArtifact>, String> {
    receipt
        .map(|receipt| {
            Ok(runtime_artifact(
                store,
                "literature-input-adaptation-receipt-json",
                "application/json",
                serde_jcs::to_vec(receipt).map_err(|error| {
                    format!("canonicalize literature input adaptation receipt: {error}")
                })?,
                derived_from.to_vec(),
            ))
        })
        .transpose()
}

fn literature_input_adapted_csv_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    adapted: Option<&AdaptedLiteratureInput>,
    derived_from: &[String],
) -> Option<RuntimeArtifact> {
    let adapted = adapted?;
    adapted
        .receipt
        .adapter_ids
        .iter()
        .any(|id| {
            matches!(
                id.as_str(),
                "chronicle.screen-state-network-classifier/v1"
                    | "chronicle.network-window-coalescer/v1"
                    | "chronicle.sms-response-linker/v1"
                    | "chronicle.communication-event-schema/v1"
                    | "chronicle.estar-network-call-reconstruction/v1"
                    | "chronicle.battery-period-day-exclusion/v1"
                    | "chronicle.call-sms-volume-gate/v1"
                    | "chronicle.dekker-post-persistence/v1"
                    | "chronicle.source-field-schema/v1"
            )
        })
        .then(|| {
            runtime_artifact_with_digest(
                store,
                "literature-input-adapted-csv",
                "text/csv",
                adapted.csv_bytes.clone(),
                derived_from.to_vec(),
                adapted.receipt.adapted_input_digest.clone(),
            )
        })
}

fn literature_input_derived_result_artifact(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    adapted: Option<&AdaptedLiteratureInput>,
    derived_from: &[String],
) -> Option<RuntimeArtifact> {
    let adapted = adapted?;
    let receipt = adapted.receipt.derived_result.as_ref()?;
    let bytes = adapted.derived_result_bytes.as_ref()?;
    Some(runtime_artifact_with_digest(
        store,
        receipt.kind,
        "text/csv",
        bytes.clone(),
        derived_from.to_vec(),
        receipt.digest.clone(),
    ))
}

#[allow(clippy::too_many_arguments)]
fn runtime_artifact_with_digest(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    kind: &str,
    media_type: &str,
    bytes: Vec<u8>,
    derived_from: Vec<String>,
    digest: String,
) -> RuntimeArtifact {
    debug_assert_eq!(digest, sha256(&bytes), "precomputed artifact digest drift");
    payload_artifact_with_digest(
        kind,
        media_type,
        PayloadBytes::from_vec_with_store(bytes, store),
        derived_from,
        digest,
    )
}

/// An artifact written straight into the payload store, digested chunk by
/// chunk.
fn payload_artifact(
    kind: &str,
    media_type: &str,
    bytes: PayloadBytes,
    derived_from: Vec<String>,
) -> Result<RuntimeArtifact, String> {
    let digest = sha256_payload(&bytes)?;
    Ok(payload_artifact_with_digest(
        kind,
        media_type,
        bytes,
        derived_from,
        digest,
    ))
}

fn payload_artifact_with_digest(
    kind: &str,
    media_type: &str,
    bytes: PayloadBytes,
    derived_from: Vec<String>,
    digest: String,
) -> RuntimeArtifact {
    RuntimeArtifact {
        metadata: RuntimeArtifactMetadata {
            artifact_id: semantic_artifact_id(kind, &digest),
            kind: kind.into(),
            media_type: media_type.into(),
            digest,
            size: bytes.len() as u64,
            derived_from,
            scientific_source_bindings: Vec::new(),
            row_count: None,
            preview_rows: None,
        },
        bytes,
    }
}

fn semantic_artifact_id(kind_or_role: &str, digest: &str) -> String {
    format!("urn:chronicle:artifact:{kind_or_role}:{}", &digest[7..])
}

#[cfg(test)]
fn runtime_aggregate_artifact(
    kind: &str,
    bytes: Vec<u8>,
    row_count: u32,
    dependencies: &[String],
) -> RuntimeArtifact {
    let digest = sha256(&bytes);
    runtime_aggregate_artifact_with_digest(kind, bytes, row_count, dependencies, digest)
}

#[cfg(test)]
fn runtime_aggregate_artifact_with_digest(
    kind: &str,
    bytes: Vec<u8>,
    row_count: u32,
    dependencies: &[String],
    digest: String,
) -> RuntimeArtifact {
    let mut artifact =
        runtime_artifact_with_digest(&chronicle_chrono_kernel_wasm::payload_store::current_store(), kind, "text/csv", bytes, dependencies.to_vec(), digest);
    artifact.metadata.row_count = Some(row_count);
    artifact
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

/// Digest of a chunked output without a contiguous copy.
fn sha256_payload(bytes: &PayloadBytes) -> Result<String, String> {
    let mut hasher = Sha256::new();
    bytes.for_each_chunk(|chunk| hasher.update(chunk))?;
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn scientific_artifact_dependencies(dependencies: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut dependencies = dependencies.into_iter().collect::<Vec<_>>();
    dependencies.sort();
    dependencies.dedup();
    dependencies
}

fn scientific_source_bindings(
    assignments: &BTreeMap<String, RoleAssignment>,
) -> Vec<RuntimeScientificSourceBinding> {
    assignments
        .iter()
        .map(|(role_id, assignment)| RuntimeScientificSourceBinding {
            role_id: role_id.clone(),
            artifact_digest: assignment.artifact.digest.clone(),
            assignment_id: assignment.assignment_id.clone(),
        })
        .collect()
}

fn bind_scientific_sources(
    mut artifact: RuntimeArtifact,
    assignments: &BTreeMap<String, RoleAssignment>,
) -> RuntimeArtifact {
    artifact.metadata.scientific_source_bindings = scientific_source_bindings(assignments);
    artifact
}

fn scientific_evidence_artifact_digests(summary: &RuntimeScientificEvidenceSummary) -> Vec<String> {
    std::iter::once(summary.foundational_semantics_artifact_digest.clone())
        .chain(
            summary
                .minimum_duration_excluded_lineage_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(
            summary
                .zero_duration_cleanup_evidence_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(
            summary
                .zero_duration_removed_lineage_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(
            summary
                .b05_screen_construction_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(
            summary
                .schoedel_reconstruction_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(
            summary
                .eyes_tagged_fau_validation_receipt_artifact_digest
                .iter()
                .cloned(),
        )
        .chain(std::iter::once(
            summary
                .b05_schoedel_validation_receipt_artifact_digest
                .clone(),
        ))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn build_runtime_scientific_evidence(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    result: &PipelineV2Result,
    options: &PipelineV2Options,
    verified_raw_input_digest: &str,
    // Kernel receipts bind the computation options digest (exact options minus
    // artifact-only fields); artifact dependency edges keep pointing at the
    // full exact-options ingress identity.
    computation_options_digest: &str,
    verified_options_digest: &str,
    assignment_sets: &RuntimeScientificAssignmentSets,
    eyes_evidence: &RuntimeEyesEvidenceSummary,
) -> Result<RuntimeScientificEvidenceBundle, String> {
    validate_foundational_semantics_evidence_for_options(
        &result.foundational_semantics_evidence,
        options,
    )?;
    let validation_receipt = validated_b05_schoedel_receipt(
        result,
        options,
        verified_raw_input_digest,
        computation_options_digest,
        B05OptionsDigestOrigin::VerifiedRequestJcs,
    )?;
    let finalized_b05_schoedel = compact_b05_schoedel_preflight(&result.b05_schoedel_preflight)?;

    let dependencies_for = |assignments: &BTreeMap<String, RoleAssignment>| {
        scientific_artifact_dependencies(
            assignments
                .values()
                .map(|assignment| assignment.artifact.digest.clone())
                .chain(std::iter::once(verified_options_digest.to_owned())),
        )
    };
    let foundational_dependencies = dependencies_for(&assignment_sets.foundational);
    let foundational_bytes = serde_jcs::to_vec(&result.foundational_semantics_evidence)
        .map_err(|error| format!("canonicalize foundational semantics evidence: {error}"))?;
    let foundational_artifact = bind_scientific_sources(
        runtime_artifact(store,
            FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND,
            "application/json",
            foundational_bytes,
            foundational_dependencies.clone(),
        ),
        &assignment_sets.foundational,
    );
    if foundational_artifact.metadata.digest
        != validation_receipt.foundational_semantics_evidence_jcs_digest
    {
        return Err("validated foundational semantics artifact digest drift".into());
    }
    let foundational_digest = foundational_artifact.metadata.digest.clone();
    let mut artifacts = vec![foundational_artifact];

    let minimum_duration_excluded_lineage_artifact_digest = if result
        .foundational_semantics_evidence
        .minimum_duration_excluded_episodes
        .is_empty()
    {
        None
    } else {
        let artifact = runtime_artifact(store,
            MINIMUM_DURATION_EXCLUDED_LINEAGE_KIND,
            "application/json",
            minimum_duration_excluded_lineage_bytes(&result.foundational_semantics_evidence)?,
            vec![foundational_digest.clone()],
        );
        if artifact.metadata.digest
            != result
                .foundational_semantics_evidence
                .minimum_duration
                .excluded_lineage_digest
        {
            return Err("validated B04 excluded-lineage artifact digest drift".into());
        }
        let digest = artifact.metadata.digest.clone();
        artifacts.push(artifact);
        Some(digest)
    };

    let app_stage = matches!(
        options.usage_session_mode,
        UsageSessionMode::AppUsage | UsageSessionMode::AppAndScreenUsage
    );
    let zero_duration_cleanup_evidence_artifact_digest = if app_stage {
        let bytes =
            serde_jcs::to_vec(&result.foundational_semantics_evidence.zero_duration_cleanup)
                .map_err(|error| format!("canonicalize zero-duration cleanup evidence: {error}"))?;
        let artifact = runtime_artifact(store,
            ZERO_DURATION_CLEANUP_EVIDENCE_KIND,
            "application/json",
            bytes,
            vec![foundational_digest.clone()],
        );
        let digest = artifact.metadata.digest.clone();
        artifacts.push(artifact);
        Some(digest)
    } else {
        None
    };
    let zero_duration_removed_lineage_artifact_digest = if result
        .foundational_semantics_evidence
        .zero_duration_cleanup
        .removed_rows
        .is_empty()
    {
        None
    } else {
        let artifact = runtime_artifact(store,
            ZERO_DURATION_REMOVED_LINEAGE_KIND,
            "application/json",
            zero_duration_removed_lineage_bytes(&result.foundational_semantics_evidence)?,
            vec![foundational_digest.clone()],
        );
        if artifact.metadata.digest
            != result
                .foundational_semantics_evidence
                .zero_duration_cleanup
                .receipt
                .removed_lineage_digest
        {
            return Err("validated zero-duration removed-lineage artifact digest drift".into());
        }
        let digest = artifact.metadata.digest.clone();
        artifacts.push(artifact);
        Some(digest)
    };

    let mut b05_screen_construction_receipt = None;
    let mut b05_screen_construction_artifact_digest = None;
    if let Some(screen) = result.b05_schoedel_preflight.screen_construction.as_ref() {
        let mut dependencies = dependencies_for(&assignment_sets.screen);
        dependencies.extend(
            screen
                .applicability
                .evidence_artifact_digest
                .iter()
                .cloned(),
        );
        let bytes = serde_jcs::to_vec(screen)
            .map_err(|error| format!("canonicalize B05 screen construction evidence: {error}"))?;
        let artifact = bind_scientific_sources(
            runtime_artifact(store,
                B05_SCREEN_CONSTRUCTION_EVIDENCE_KIND,
                "application/json",
                bytes,
                scientific_artifact_dependencies(dependencies),
            ),
            &assignment_sets.screen,
        );
        if Some(artifact.metadata.digest.as_str())
            != validation_receipt
                .screen_construction_output_jcs_digest
                .as_deref()
        {
            return Err("validated B05 screen evidence artifact digest drift".into());
        }
        b05_screen_construction_receipt = screen
            .construction_receipt
            .as_ref()
            .map(RuntimeScreenConstructionReceipt::from);
        b05_screen_construction_artifact_digest = Some(artifact.metadata.digest.clone());
        artifacts.push(artifact);
    }

    let mut schoedel_reconstruction_receipt = None;
    let mut schoedel_reconstruction_artifact_digest = None;
    if let Some(schoedel) = result
        .b05_schoedel_preflight
        .schoedel_reconstruction
        .as_ref()
    {
        let mut dependencies = dependencies_for(&assignment_sets.schoedel);
        dependencies.extend(b05_screen_construction_artifact_digest.iter().cloned());
        dependencies.extend(
            schoedel
                .applicability
                .source_order_resolution
                .iter()
                .flat_map(|resolution| resolution.evidence_artifact_digest.iter().cloned()),
        );
        let bytes = serde_jcs::to_vec(schoedel)
            .map_err(|error| format!("canonicalize Schoedel reconstruction evidence: {error}"))?;
        let artifact = bind_scientific_sources(
            runtime_artifact(store,
                SCHOEDEL_RECONSTRUCTION_EVIDENCE_KIND,
                "application/json",
                bytes,
                scientific_artifact_dependencies(dependencies),
            ),
            &assignment_sets.schoedel,
        );
        if Some(artifact.metadata.digest.as_str())
            != validation_receipt
                .schoedel_reconstruction_output_jcs_digest
                .as_deref()
        {
            return Err("validated Schoedel evidence artifact digest drift".into());
        }
        schoedel_reconstruction_receipt = schoedel
            .reconstruction_receipt
            .as_ref()
            .map(RuntimeSchoedelReconstructionReceipt::from);
        schoedel_reconstruction_artifact_digest = Some(artifact.metadata.digest.clone());
        artifacts.push(artifact);
    }

    let validation_bytes = serde_jcs::to_vec(&validation_receipt)
        .map_err(|error| format!("canonicalize B05/Schoedel validation receipt: {error}"))?;
    let active_dependencies = dependencies_for(&assignment_sets.active_union());
    let validation_dependencies = scientific_artifact_dependencies(
        active_dependencies
            .into_iter()
            .chain(std::iter::once(foundational_digest.clone()))
            .chain(
                minimum_duration_excluded_lineage_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                zero_duration_cleanup_evidence_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(
                zero_duration_removed_lineage_artifact_digest
                    .iter()
                    .cloned(),
            )
            .chain(b05_screen_construction_artifact_digest.iter().cloned())
            .chain(schoedel_reconstruction_artifact_digest.iter().cloned()),
    );
    let active_assignments = assignment_sets.active_union();
    let validation_artifact = bind_scientific_sources(
        runtime_artifact(store,
            B05_SCHOEDEL_VALIDATION_RECEIPT_KIND,
            "application/json",
            validation_bytes,
            validation_dependencies,
        ),
        &active_assignments,
    );
    let validation_artifact_digest = validation_artifact.metadata.digest.clone();
    artifacts.push(validation_artifact);

    let summary = RuntimeScientificEvidenceSummary {
        protocol_version: SCIENTIFIC_EVIDENCE_SUMMARY_PROTOCOL_VERSION.into(),
        foundational_semantics_artifact_digest: foundational_digest,
        micro_use_receipt: result.foundational_semantics_evidence.micro_use.clone(),
        minimum_duration_receipt: RuntimeMinimumDurationReceipt::from(
            &result.foundational_semantics_evidence.minimum_duration,
        ),
        concurrent_subinterval_floor_receipt: result
            .foundational_semantics_evidence
            .concurrent_subinterval_floor
            .clone(),
        zero_duration_cleanup_receipt: RuntimeZeroDurationCleanupReceipt::from(
            &result
                .foundational_semantics_evidence
                .zero_duration_cleanup
                .receipt,
        ),
        minimum_duration_excluded_lineage_artifact_digest,
        zero_duration_cleanup_evidence_artifact_digest,
        zero_duration_removed_lineage_artifact_digest,
        finalized_b05_schoedel,
        b05_screen_construction_receipt,
        b05_screen_construction_artifact_digest,
        schoedel_reconstruction_receipt,
        schoedel_reconstruction_artifact_digest,
        eyes_input_partition: result.eyes_input_partition_preflight.clone(),
        eyes_tagged_fau_validation_receipt: eyes_evidence.validation_receipt.clone(),
        eyes_tagged_fau_validation_receipt_artifact_digest: eyes_evidence
            .validation_receipt_artifact_digest
            .clone(),
        b05_schoedel_validation_receipt: RuntimeB05SchoedelValidationReceipt::from(
            &validation_receipt,
        ),
        b05_schoedel_validation_receipt_artifact_digest: validation_artifact_digest,
    };
    Ok(RuntimeScientificEvidenceBundle { summary, artifacts })
}

fn build_runtime_eyes_evidence(
    result: &PipelineV2Result,
    options: &PipelineV2OptionsJson,
    pipeline_options: &PipelineV2Options,
    verified_raw_input_digest: &str,
    // Kernel EYES receipts bind the computation options digest (exact options
    // minus artifact-only fields).
    computation_options_digest: &str,
) -> Result<RuntimeEyesEvidenceBundle, String> {
    let episode_reconstruction_strategy = options.episode_reconstruction_strategy.as_str();
    if episode_reconstruction_strategy.trim().is_empty() {
        return Err("EYES evidence requires a non-empty reconstruction strategy id".into());
    }

    // Applicability comes from the kernel's own predicate (strategy AND
    // usage-session mode), never re-derived from the strategy id alone: a
    // screen-usage-only request with eyes_complement selected produces no
    // tagged-FAU work, and the kernel correctly returns no receipt for it.
    let status = if eyes_complement_is_active(pipeline_options) {
        RuntimeEyesEvidenceStatus::PartialReplay
    } else {
        if !result.eyes_tagged_fau_evidence.is_empty() {
            return Err(
                "inactive EYES vector returned EYES evidence; refusing fabricated provenance"
                    .into(),
            );
        }
        RuntimeEyesEvidenceStatus::NotApplicable
    };

    let validation_receipt = validated_eyes_tagged_fau_receipt(
        result,
        pipeline_options,
        verified_raw_input_digest,
        computation_options_digest,
        EyesInputPartitionOptionsDigestOrigin::VerifiedRequestJcs,
    )?;
    let (
        artifact_bytes,
        tagged_fau_artifact_digest,
        validation_receipt_bytes,
        validation_receipt_artifact_digest,
    ) = match (status, validation_receipt.as_ref()) {
        (RuntimeEyesEvidenceStatus::PartialReplay, Some(receipt)) => {
            let bytes = eyes_tagged_fau_artifact_jcs_bytes(&result.eyes_tagged_fau_evidence)?;
            let digest = sha256(&bytes);
            if digest != receipt.tagged_fau_artifact_jcs_digest {
                return Err("kernel EYES artifact and validation receipt disagree".into());
            }
            let receipt_bytes = serde_jcs::to_vec(receipt)
                .map_err(|error| format!("canonicalize EYES validation receipt: {error}"))?;
            let receipt_digest = sha256(&receipt_bytes);
            (
                Some(bytes),
                Some(digest),
                Some(receipt_bytes),
                Some(receipt_digest),
            )
        }
        (RuntimeEyesEvidenceStatus::NotApplicable, None) => (None, None, None, None),
        _ => return Err("EYES applicability and validation receipt presence disagree".into()),
    };
    Ok(RuntimeEyesEvidenceBundle {
        summary: RuntimeEyesEvidenceSummary {
            protocol_version: EYES_RUNTIME_SUMMARY_PROTOCOL_VERSION.into(),
            status,
            episode_reconstruction_strategy: episode_reconstruction_strategy.into(),
            tagged_fau_artifact_digest,
            validation_receipt,
            validation_receipt_artifact_digest,
        },
        artifact_bytes,
        validation_receipt_bytes,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_runtime_eyes_evidence_artifacts(
    store: &chronicle_chrono_kernel_wasm::payload_store::PayloadStore,
    artifacts: &mut Vec<RuntimeArtifact>,
    bundle: &mut RuntimeEyesEvidenceBundle,
    summary: &RuntimeEyesEvidenceSummary,
    verified_raw_input_digest: &str,
    verified_options_digest: &str,
    assignments: &BTreeMap<String, RoleAssignment>,
) -> Result<Option<Sha256Digest>, String> {
    let base_dependencies = scientific_artifact_dependencies([
        verified_raw_input_digest.to_owned(),
        verified_options_digest.to_owned(),
    ]);
    let evidence_digest = match (
        bundle.artifact_bytes.take(),
        summary.tagged_fau_artifact_digest.clone(),
    ) {
        (Some(bytes), Some(digest)) => {
            artifacts.push(bind_scientific_sources(
                runtime_artifact_with_digest(store,
                    EYES_TAGGED_FAU_EVIDENCE_KIND,
                    "application/json",
                    bytes,
                    base_dependencies.clone(),
                    digest.clone(),
                ),
                assignments,
            ));
            Some(digest)
        }
        (None, None) => None,
        _ => return Err("EYES evidence artifact bytes/digest presence disagrees".into()),
    };
    match (
        bundle.validation_receipt_bytes.take(),
        summary.validation_receipt_artifact_digest.clone(),
    ) {
        (Some(bytes), Some(digest)) => {
            let evidence_digest = evidence_digest.clone().ok_or_else(|| {
                "EYES validation receipt exists without its evidence artifact".to_string()
            })?;
            artifacts.push(bind_scientific_sources(
                runtime_artifact_with_digest(store,
                    EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND,
                    "application/json",
                    bytes,
                    scientific_artifact_dependencies(
                        base_dependencies
                            .into_iter()
                            .chain(std::iter::once(evidence_digest)),
                    ),
                    digest,
                ),
                assignments,
            ));
        }
        (None, None) => {}
        _ => return Err("EYES validation receipt artifact bytes/digest presence disagrees".into()),
    }
    Ok(evidence_digest)
}

fn stable_id(parts: &[&str]) -> String {
    sha256(parts.join("\u{1f}").as_bytes())
}

fn validate_digest(value: &str) -> Result<(), &'static str> {
    let Some(hex_value) = value.strip_prefix("sha256:") else {
        return Err("must start with sha256:");
    };
    if hex_value.len() != 64
        || !hex_value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("must contain exactly 64 lowercase hexadecimal characters");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn source_field_adapted_artifact_preserves_every_registered_fixture_cell() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/literature_input_adapter_conformance.json"
        ))
        .unwrap();
        let cases = fixtures["groups"]
            .as_array()
            .unwrap()
            .iter()
            .find(|group| group["adapterId"] == "chronicle.source-field-schema/v1")
            .unwrap()["cases"]
            .as_array()
            .unwrap();
        assert_eq!(cases.len(), 10);
        for case in cases {
            let setting = case["methodSettingId"].as_str().unwrap();
            let raw = format!(
                "{}\n",
                case["rawCsvLines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|line| line.as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("\n")
            );
            let binding = literature_input_adapters::tests::binding(setting);
            let adapted = adapt_literature_inputs(
                raw.as_bytes(),
                &sha256(raw.as_bytes()),
                &[binding],
                |_| &[],
            )
            .unwrap()
            .unwrap();
            let dependencies = vec![sha256(raw.as_bytes())];
            let artifact = literature_input_adapted_csv_artifact(&chronicle_chrono_kernel_wasm::payload_store::current_store(),Some(&adapted), &dependencies)
                .unwrap_or_else(|| panic!("source fields have no published artifact: {setting}"));
            assert_eq!(artifact.metadata.kind, "literature-input-adapted-csv");
            assert_eq!(
                artifact.metadata.digest,
                adapted.receipt.adapted_input_digest
            );
            assert_eq!(artifact.metadata.digest, sha256(&adapted.csv_bytes));
            let bytes = artifact.bytes.into_vec().unwrap();
            assert_eq!(bytes, adapted.csv_bytes);
            let mut original = csv::Reader::from_reader(raw.as_bytes());
            let original_headers = original.headers().unwrap().clone();
            let mut published = csv::Reader::from_reader(bytes.as_slice());
            let published_headers = published.headers().unwrap().clone();
            assert_eq!(
                &published_headers
                    .iter()
                    .take(original_headers.len())
                    .collect::<Vec<_>>(),
                &original_headers.iter().collect::<Vec<_>>()
            );
            let input_rows = original.records().collect::<Result<Vec<_>, _>>().unwrap();
            let output_rows = published.records().collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(input_rows.len(), output_rows.len());
            for (index, (before, after)) in input_rows.iter().zip(&output_rows).enumerate() {
                assert_eq!(
                    before.iter().collect::<Vec<_>>(),
                    after.iter().take(before.len()).collect::<Vec<_>>()
                );
                let lineage = published_headers
                    .iter()
                    .position(|field| field == "literature_source_data_row")
                    .unwrap();
                assert_eq!(&after[lineage], &(index + 1).to_string());
            }
            assert!(adapted.receipt.derived_result.is_none());
        }
        assert!(literature_input_adapted_csv_artifact(&chronicle_chrono_kernel_wasm::payload_store::current_store(),None, &[]).is_none());
    }

    fn build_runtime_eyes_evidence(
        result: &PipelineV2Result,
        options: &PipelineV2OptionsJson,
    ) -> Result<RuntimeEyesEvidenceBundle, String> {
        let pipeline_options = options.clone().into_pipeline_options();
        let (exact_options_value, _, _) = canonicalize_exact_options(options)?;
        let computation_digest = computation_options_digest(&exact_options_value)?;
        let raw_digest = result
            .eyes_input_partition_preflight
            .as_ref()
            .map(|receipt| receipt.input_digest.clone())
            .unwrap_or_else(|| sha256(b"inactive EYES test identity"));
        super::build_runtime_eyes_evidence(
            result,
            options,
            &pipeline_options,
            &raw_digest,
            &computation_digest,
        )
    }

    #[test]
    fn persisted_bases_are_bound_to_runtime_identity_and_certified_cache_mode() {
        assert_eq!(MAX_REVIEW_BASE_ENCODED_BYTES, 67_108_864);
        assert_eq!(MAX_RECONSTRUCTION_BASE_ENCODED_BYTES, 100_663_296);
        assert_eq!(MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES, 134_217_728);
        let runtime_identity = persisted_base_runtime_identity();
        assert_ne!(runtime_identity, [0; 32]);
        assert_ne!(runtime_identity, [1; 32]);

        let payload = b"typed-kernel-cache".to_vec();
        let encoded = wrap_persisted_base(payload.clone(), REVIEW_BASE_RUNTIME_MAGIC);
        assert_eq!(
            verified_persisted_base_payload(
                &encoded,
                REVIEW_BASE_RUNTIME_MAGIC,
                "review base",
                DependencyCacheMode::CertifiedNarrow,
            )
            .unwrap(),
            payload
        );
        let empty_payload = wrap_persisted_base(Vec::new(), REVIEW_BASE_RUNTIME_MAGIC);
        assert_eq!(empty_payload.len(), PERSISTED_BASE_RUNTIME_HEADER_BYTES);
        assert!(verified_persisted_base_payload(
            &empty_payload,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .unwrap()
        .is_empty());
        for truncated_len in [1, PERSISTED_BASE_RUNTIME_HEADER_BYTES - 1] {
            assert!(verified_persisted_base_payload(
                &empty_payload[..truncated_len],
                REVIEW_BASE_RUNTIME_MAGIC,
                "review base",
                DependencyCacheMode::CertifiedNarrow,
            )
            .unwrap_err()
            .contains("truncated"));
        }

        let mut stale_identity = encoded.clone();
        stale_identity[REVIEW_BASE_RUNTIME_MAGIC.len()] ^= 0xff;
        assert!(verified_persisted_base_payload(
            &stale_identity,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .unwrap()
        .is_empty());

        assert!(verified_persisted_base_payload(
            &encoded,
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::ConservativeFull,
        )
        .unwrap()
        .is_empty());
        assert!(verified_persisted_base_payload(
            b"malformed-but-ignored",
            REVIEW_BASE_RUNTIME_MAGIC,
            "review base",
            DependencyCacheMode::ConservativeFull,
        )
        .unwrap()
        .is_empty());
        assert!(verified_persisted_base_payload(
            &encoded,
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
            "reconstruction base",
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());

        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES + 1,
            0,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            0,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            0,
            MAX_RECONSTRUCTION_BASE_ENCODED_BYTES + 1,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            0,
            MAX_RECONSTRUCTION_BASE_ENCODED_BYTES,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES - MAX_REVIEW_BASE_ENCODED_BYTES,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_ok());
        assert!(validate_persisted_base_encoded_lengths(
            MAX_REVIEW_BASE_ENCODED_BYTES,
            MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES - MAX_REVIEW_BASE_ENCODED_BYTES + 1,
            DependencyCacheMode::CertifiedNarrow,
        )
        .is_err());
        assert!(validate_persisted_base_encoded_lengths(
            usize::MAX,
            usize::MAX,
            DependencyCacheMode::ConservativeFull,
        )
        .is_ok());
    }

    /// A large input whose resume envelope outgrows the reader's ceilings must
    /// degrade to "no persisted resume", never to a failed run: the exporter
    /// keeps exactly the pairs `validate_persisted_base_encoded_lengths`
    /// accepts, and the read-side "is too large" errors stay reachable only by
    /// a foreign or tampered store.
    #[test]
    fn an_oversized_base_is_dropped_at_export_instead_of_failing_the_next_run() {
        let accepted = |bases: &ExportedBases| {
            validate_persisted_base_encoded_lengths(
                bases.0.as_ref().map_or(0, Vec::len),
                bases.1.as_ref().map_or(0, Vec::len),
                DependencyCacheMode::CertifiedNarrow,
            )
        };
        let review = vec![1u8; MAX_REVIEW_BASE_ENCODED_BYTES];
        let reconstruction = vec![2u8; MAX_RECONSTRUCTION_BASE_ENCODED_BYTES];

        let at_ceiling = persistable_bases(Some(review.clone()), None);
        assert!(
            at_ceiling.0.is_some(),
            "a review base exactly at its ceiling is kept"
        );
        accepted(&at_ceiling).expect("the reader accepts what the writer kept");

        let over = persistable_bases(Some(vec![1u8; MAX_REVIEW_BASE_ENCODED_BYTES + 1]), None);
        assert_eq!(
            over,
            (None, None),
            "a review base past its ceiling is dropped"
        );
        accepted(&over).expect("an empty pair is always accepted");

        let orphaned = persistable_bases(None, Some(vec![2u8; 8]));
        assert_eq!(
            orphaned,
            (None, None),
            "a reconstruction base needs its review base"
        );

        let reconstruction_over = persistable_bases(
            Some(vec![1u8; 8]),
            Some(vec![2u8; MAX_RECONSTRUCTION_BASE_ENCODED_BYTES + 1]),
        );
        assert_eq!(
            reconstruction_over,
            (Some(vec![1u8; 8]), None),
            "a reconstruction base past its ceiling is dropped alone",
        );
        accepted(&reconstruction_over).expect("the surviving review base is accepted");

        let combined_over = persistable_bases(Some(review), Some(reconstruction));
        assert!(
            combined_over.0.is_some() && combined_over.1.is_none(),
            "a pair past the combined ceiling keeps the review base only",
        );
        accepted(&combined_over).expect("the reader accepts the trimmed pair");

        let within = persistable_bases(Some(vec![1u8; 8]), Some(vec![2u8; 8]));
        assert_eq!(within, (Some(vec![1u8; 8]), Some(vec![2u8; 8])));
        accepted(&within).expect("a small pair is kept whole");
    }

    #[test]
    fn raw_file_inspection_reads_the_duplicate_column_execution_reads() {
        // Execution maps headers through a HashMap, so the last duplicate
        // wins; inspection must not vouch for the column execution ignores.
        let csv = b"participant_id,event_timestamp, event_timestamp \nP01,2026-03-07 12:00:00,\n";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "raw.csv", csv.len() as f64)).unwrap();
        assert_eq!(inspection["missingTimestampCount"], 1);
    }

    #[test]
    fn raw_file_inspection_uses_runtime_semantics_without_throwing() {
        let csv = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone,timezone\n\
Study,P01,Chat,Unknown importance: 1,com.example,2026-03-07 12:00:00,America/Chicago,America/Chicago\n\
Study,P01,Chat,Vendor Event,com.example,2026-03-07 09:00:00,Not/AZone,Not/AZone\n\
Study,P02,Chat,Activity Paused,com.example,,America/Chicago,America/Chicago\n";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "raw.txt", csv.len() as f64)).unwrap();
        assert_eq!(inspection["rowCount"], 3);
        assert_eq!(inspection["participantCount"], 2);
        assert_eq!(inspection["outOfOrderTimestampCount"], 1);
        assert_eq!(inspection["firstOutOfOrderRow"], 2);
        assert_eq!(inspection["missingTimestampCount"], 1);
        assert_eq!(inspection["invalidTimestampCount"], 0);
        assert_eq!(
            inspection["unrecognizedInteractionTypes"][0],
            "Vendor Event"
        );
        assert_eq!(inspection["columns"][7], "timezone_1");
        assert_eq!(inspection["screenStartEventCount"], 0);
        let warnings = inspection["warnings"].as_array().unwrap();
        assert!(warnings
            .iter()
            .any(|warning| warning == "File extension is not .csv."));
        assert!(warnings
            .iter()
            .any(|warning| warning == "Duplicate column headers found."));
        // PHI safety: the invalid-timezone warning reports only a count —
        // the raw cell value must never appear in UI-surfaced text.
        assert!(warnings.iter().any(|warning| warning
            == "Invalid timezone values: 1 distinct value(s) in the timezone column."));
        assert!(!warnings
            .iter()
            .any(|warning| warning.as_str().unwrap().contains("Not/AZone")));
    }

    #[test]
    fn raw_file_inspection_counts_screen_session_starts_by_canonical_type() {
        // Raw Android codes, a canonical spelling, and a stop event: only the
        // two starts count, and the count never becomes a Rust-side warning
        // because the browser conditions it on the screen-usage option.
        let csv = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\n\
Study,P01,System,Unknown importance: 15,android,2026-03-07 10:00:00,America/Chicago\n\
Study,P01,System,Unknown importance: 16,android,2026-03-07 10:05:00,America/Chicago\n\
Study,P01,System,Screen Interactive,android,2026-03-07 11:00:00,America/Chicago\n\
Study,P01,Chat,Unknown importance: 1,com.example,2026-03-07 11:01:00,America/Chicago\n";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "raw.csv", csv.len() as f64)).unwrap();
        assert_eq!(inspection["rowCount"], 4);
        assert_eq!(inspection["screenStartEventCount"], 2);
        assert!(!inspection["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning.as_str().unwrap().contains("screen")));
    }

    #[test]
    fn raw_file_inspection_handles_empty_and_malformed_bytes() {
        let empty: Value =
            serde_json::from_str(&inspect_raw_file_v1(b"", "empty.csv", 0.0)).unwrap();
        assert_eq!(empty["rowCount"], 0);
        assert_eq!(empty["hasRequiredColumns"], false);
        assert!(empty["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));

        let malformed = inspect_raw_file_v1(b"event_timestamp,timezone\n\xff,UTC", "bad.csv", 31.0);
        assert!(serde_json::from_str::<Value>(&malformed).is_ok());
    }

    #[test]
    fn participant_partition_tokens_are_batch_scoped_artifact_bound_and_phi_safe() {
        let participant_a = "Sensitive Participant Alpha";
        let participant_b = "Sensitive Participant Beta";
        let raw = |participant: &str, timestamp: &str| {
            format!(
                "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,{participant},App,Activity Resumed,pkg,{timestamp},UTC\n"
            )
            .into_bytes()
        };
        let raw_a = raw(participant_a, "2026-03-07 12:00:00");
        let raw_a_second_artifact = raw(participant_a, "2026-03-07 12:00:01");
        let raw_b = raw(participant_b, "2026-03-07 12:00:02");
        let secret_a = [0x31; 32];
        let secret_b = [0x42; 32];
        let batch_a = begin_raw_inspection_batch_native(&secret_a).unwrap();
        let batch_b = begin_raw_inspection_batch_native(&secret_b).unwrap();

        let inspect = |bytes: &[u8], name: &str, batch: &str| -> (String, Value) {
            let json =
                inspect_raw_file_native(bytes, name, bytes.len() as f64, Some(batch)).unwrap();
            let value = serde_json::from_str(&json).unwrap();
            (json, value)
        };
        let (json_a, inspection_a) = inspect(&raw_a, "a.csv", &batch_a);
        let (json_a_second, inspection_a_second) =
            inspect(&raw_a_second_artifact, "a-second.csv", &batch_a);
        let (json_b, _inspection_b) = inspect(&raw_b, "b.csv", &batch_a);
        let (_, inspection_cross_batch) = inspect(&raw_a, "a.csv", &batch_b);

        for json in [&json_a, &json_a_second, &json_b] {
            assert!(!json.contains(participant_a));
            assert!(!json.contains(participant_b));
        }
        let token_a = inspection_a["participantTokens"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            inspection_a_second["participantTokens"][0],
            token_a,
            "one participant must have the same opaque token across distinct artifacts in one batch"
        );
        assert_ne!(
            inspection_cross_batch["participantTokens"][0], token_a,
            "tokens must not link the same participant across inspection batches"
        );
        let other_study = String::from_utf8(raw_a.clone())
            .unwrap()
            .replace("\nS,", "\nT,")
            .into_bytes();
        let (_, inspection_other_study) = inspect(&other_study, "a-study-t.csv", &batch_a);
        assert_ne!(
            inspection_other_study["participantTokens"][0], token_a,
            "the same participant ID in another study is another person, not a fragment"
        );
        assert_eq!(inspection_a["participantPartitionBatchId"], batch_a);

        assert_eq!(
            resolve_fragmented_participant_ids(
                &sha256(&raw_a),
                Some(&batch_a),
                std::slice::from_ref(&token_a)
            )
            .unwrap(),
            [participant_a]
        );
        assert!(resolve_fragmented_participant_ids(
            &sha256(&raw_b),
            Some(&batch_a),
            std::slice::from_ref(&token_a)
        )
        .unwrap_err()
        .contains("unknown for the verified raw artifact"));
        let tampered = sha256(b"unknown opaque token");
        assert!(
            resolve_fragmented_participant_ids(&sha256(&raw_a), Some(&batch_a), &[tampered])
                .unwrap_err()
                .contains("unknown for the verified raw artifact")
        );

        let mut participants = BTreeSet::new();
        participants.insert(("S".to_string(), participant_a.to_string()));
        participants.insert(("S".to_string(), participant_b.to_string()));
        let tokens =
            register_participants_in_batch(&batch_a, &sha256(b"combined"), &participants).unwrap();
        assert!(tokens.windows(2).all(|pair| pair[0] < pair[1]));

        assert!(dispose_raw_inspection_batch(&batch_a));
        assert!(
            resolve_fragmented_participant_ids(&sha256(&raw_a), Some(&batch_a), &[token_a])
                .unwrap_err()
                .contains("batch is unavailable")
        );
        assert!(!dispose_raw_inspection_batch(&batch_a));
        assert!(dispose_raw_inspection_batch(&batch_b));
    }

    #[test]
    fn participant_partition_tokens_follow_exact_kernel_decoder_on_ambiguous_csv() {
        let secret = [0x67; 32];
        let batch = begin_raw_inspection_batch_native(&secret).unwrap();
        let cases = [
            (
                "duplicate.csv",
                "participant_id,participant_id,event_timestamp,timezone,interaction_type,app_package_name\nP_FIRST,P_LAST,2026-03-07 10:00:00,UTC,Activity Resumed,pkg\n",
                "P_LAST",
                "P_FIRST",
            ),
            (
                "triple.csv",
                "participant_id,participant_id,participant_id,event_timestamp,timezone,interaction_type,app_package_name\nP_FIRST,P_MIDDLE,P_LAST,2026-03-07 10:00:00,UTC,Activity Resumed,pkg\n",
                "P_LAST",
                "P_FIRST",
            ),
            (
                "quoted-unicode.csv",
                "participant_id,event_timestamp,timezone,interaction_type,app_package_name\n\"Quoted, 参与者 🧪\",2026-03-07 10:00:00,UTC,Activity Resumed,pkg\n",
                "Quoted, 参与者 🧪",
                "definitely absent",
            ),
        ];
        for (name, raw, expected, decoy) in cases {
            let inspection_json =
                inspect_raw_file_native(raw.as_bytes(), name, raw.len() as f64, Some(&batch))
                    .unwrap();
            assert!(!inspection_json.contains(expected));
            assert!(!inspection_json.contains(decoy));
            let inspection: Value = serde_json::from_str(&inspection_json).unwrap();
            let token = inspection["participantTokens"][0]
                .as_str()
                .unwrap()
                .to_string();
            assert_eq!(
                resolve_fragmented_participant_ids(
                    &sha256(raw.as_bytes()),
                    Some(&batch),
                    &[token],
                )
                .unwrap(),
                [expected],
            );
            assert_eq!(inspection["participantCount"], 1);
        }

        let long_id = format!("长{}尾", "x".repeat(2_048));
        let long_raw = format!(
            "participant_id,event_timestamp,timezone,interaction_type,app_package_name\n\"{long_id}\",2026-03-07 10:00:00,UTC,Activity Resumed,pkg\n"
        );
        let inspection_json = inspect_raw_file_native(
            long_raw.as_bytes(),
            "long.csv",
            long_raw.len() as f64,
            Some(&batch),
        )
        .unwrap();
        assert!(!inspection_json.contains(&long_id));
        let inspection: Value = serde_json::from_str(&inspection_json).unwrap();
        let token = inspection["participantTokens"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            resolve_fragmented_participant_ids(
                &sha256(long_raw.as_bytes()),
                Some(&batch),
                &[token],
            )
            .unwrap(),
            [long_id],
        );

        let missing = b"event_timestamp,timezone\n2026-03-07 10:00:00,UTC\n";
        let inspection: Value = serde_json::from_str(
            &inspect_raw_file_native(missing, "missing.csv", missing.len() as f64, Some(&batch))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(inspection["participantCount"], 0);
        assert!(inspection["participantTokens"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(dispose_raw_inspection_batch(&batch));
    }

    #[test]
    fn execution_lane_registration_uses_exact_raw_artifact_and_batch_secret() {
        let secret = [0x29; 32];
        let participant = "Lane Registration Participant";
        let raw = format!(
            "participant_id,event_timestamp,timezone,interaction_type,app_package_name\n{participant},2026-03-07 10:00:00,UTC,Activity Resumed,pkg\n"
        );
        let batch = begin_raw_inspection_batch_native(&secret).unwrap();
        register_raw_participant_partition_artifact(raw.as_bytes(), &batch).unwrap();
        let token = participant_partition_token(&secret, "", participant);
        assert_eq!(
            resolve_fragmented_participant_ids(&sha256(raw.as_bytes()), Some(&batch), &[token],)
                .unwrap(),
            [participant]
        );
        assert!(dispose_raw_inspection_batch(&batch));
    }

    #[test]
    fn wasm_batch_secret_copy_is_zeroed_on_success_and_rejection() {
        let mut valid = vec![0x6d; 32];
        let batch = begin_raw_inspection_batch_zeroing(&mut valid).unwrap();
        assert_eq!(valid, vec![0; 32]);
        assert!(dispose_raw_inspection_batch(&batch));

        let mut invalid = vec![0x7e; 31];
        assert!(begin_raw_inspection_batch_zeroing(&mut invalid).is_err());
        assert_eq!(invalid, vec![0; 31]);
    }

    #[test]
    fn secure_zero_bytes_erases_the_shared_secret_and_participant_buffer_primitive() {
        fn assert_zeroize_on_drop<T: sha2::digest::zeroize::ZeroizeOnDrop>() {}
        // Compile-time pin: removing sha2's `zeroize` feature makes the
        // secret-bearing hasher buffer fail this test to compile.
        assert_zeroize_on_drop::<Sha256>();

        let mut fixed_secret = [0xa5; 32];
        secure_zero_bytes(&mut fixed_secret);
        assert_eq!(fixed_secret, [0; 32]);

        let mut participant = String::from("Low entropy participant P01").into_bytes();
        secure_zero_bytes(&mut participant);
        assert!(participant.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn registered_fragment_metadata_precedes_malformed_raw_parsing() {
        let participant = "Sensitive Malformed Participant";
        let malformed_raw = format!(
            "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,{participant},App,Activity Resumed,pkg,not-a-timestamp,UTC\n"
        )
        .into_bytes();
        let batch = begin_raw_inspection_batch_native(&[0x53; 32]).unwrap();
        let inspection: Value = serde_json::from_str(
            &inspect_raw_file_native(
                &malformed_raw,
                "malformed.csv",
                malformed_raw.len() as f64,
                Some(&batch),
            )
            .unwrap(),
        )
        .unwrap();
        let token = inspection["participantTokens"][0]
            .as_str()
            .unwrap()
            .to_string();
        let participant_ids =
            resolve_fragmented_participant_ids(&sha256(&malformed_raw), Some(&batch), &[token])
                .unwrap();
        assert_eq!(participant_ids, [participant]);

        let mut options = serde_json::from_str::<RuntimeRequest>(&request(&malformed_raw))
            .unwrap()
            .options
            .into_pipeline_options();
        options.episode_reconstruction_strategy = EpisodeReconstructionStrategy::EyesComplement;
        let support = PipelineV2SupportFiles {
            fragmented_participant_ids: &participant_ids,
            ..PipelineV2SupportFiles::default()
        };
        let engine = IncrementalPipelineV2Engine::default();
        let receipt = engine
            .preflight_eyes_complement_input_partition(&malformed_raw, &options, support)
            .unwrap();
        assert_eq!(receipt.disposition, ScientificPreflightDisposition::Refused);
        assert_eq!(
            receipt.refusal_reason.map(|reason| reason.canonical_id()),
            Some("unsupported_input_chunk")
        );
        let receipt_json = serde_json::to_string(&receipt).unwrap();
        assert!(!receipt_json.contains(participant));
        let forbidden_unsalted_scope_digest =
            sha256(&serde_json::to_vec(&BTreeSet::from([participant.to_string()])).unwrap());
        assert!(!receipt_json.contains(&forbidden_unsalted_scope_digest));
        assert!(!receipt_json.contains("fragmentedParticipantScopeDigest"));

        let mut request_value: Value = serde_json::from_str(&request(&malformed_raw)).unwrap();
        request_value["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        request_value["participantPartitionBatchId"] = Value::String(batch.clone());
        request_value["fragmentedParticipantTokens"] =
            json!([inspection["participantTokens"][0].as_str().unwrap()]);
        let request_json = request_value.to_string();
        let runtime_preflight = scientific_preflight_native(
            &request_json,
            &malformed_raw,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        assert!(!runtime_preflight.contains(participant));
        assert!(!runtime_preflight.contains(&forbidden_unsalted_scope_digest));
        assert!(!runtime_preflight.contains("fragmentedParticipantScopeDigest"));
        assert!(runtime_preflight.contains("fragmentedParticipantTokenScopeDigest"));
        let execution_error = match execute_workspace_native(
            &request_json,
            &malformed_raw,
            &RuntimeSupportFiles::default(),
        ) {
            Ok(_) => panic!("refused EYES preflight was cached for execution"),
            Err(error) => error,
        };
        assert!(!execution_error.contains(participant));
        assert!(!execution_error.contains(&forbidden_unsalted_scope_digest));
        assert!(dispose_raw_inspection_batch(&batch));
    }

    #[test]
    fn runtime_digest_validation_rejects_noncanonical_uppercase_hex() {
        assert!(validate_digest(&format!("sha256:{}", "a".repeat(64))).is_ok());
        assert_eq!(
            validate_digest(&format!("sha256:{}", "A".repeat(64))),
            Err("must contain exactly 64 lowercase hexadecimal characters")
        );
    }

    #[test]
    fn inactive_fragment_transport_is_detached_without_registry_lookup() {
        let csv = csv();
        let baseline_json = request(&csv);
        let mut retained: Value = serde_json::from_str(&baseline_json).unwrap();
        retained["participantPartitionBatchId"] = Value::String("expired-batch".into());
        retained["fragmentedParticipantTokens"] =
            json!(["not-a-digest", "also-not-sorted-or-valid"]);
        let retained_json = retained.to_string();

        let baseline =
            prepare_runtime_workspace(&baseline_json, &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let detached =
            prepare_runtime_workspace(&retained_json, &csv, &RuntimeSupportFiles::default())
                .unwrap();
        assert!(!requires_live_scientific_preflight(
            &baseline.pipeline_options
        ));
        assert!(detached.request.participant_partition_batch_id.is_none());
        assert!(detached.request.fragmented_participant_tokens.is_empty());
        assert!(detached.fragmented_participant_ids.is_empty());
        assert_eq!(
            scientific_preflight_key(&baseline).unwrap(),
            scientific_preflight_key(&detached).unwrap()
        );
        assert_eq!(baseline.options_digest, detached.options_digest);
        assert_eq!(baseline.ingress.assignments, detached.ingress.assignments);
        assert_eq!(
            jcs_digest(
                &baseline.ingress.materialization,
                "baseline materialization"
            )
            .unwrap(),
            jcs_digest(
                &detached.ingress.materialization,
                "detached materialization"
            )
            .unwrap()
        );
    }

    #[test]
    fn app_only_screen_policies_require_preflight_and_source_capability_evidence() {
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["screen_session_construction_strategy"] =
            Value::String("parry_toth_2025_session_glance_v1".into());

        request_value["options"]["screen_session_maximum_duration_minutes"] = Value::from(60.0);
        request_value["options"]["screen_session_maximum_duration_disposition"] =
            Value::String("exclude_participant".into());
        let maximum_exclusion = serde_json::from_value::<RuntimeRequest>(request_value.clone())
            .unwrap()
            .options
            .into_pipeline_options();
        assert!(requires_live_scientific_preflight(&maximum_exclusion));
        assert!(uses_input_capability_evidence(&maximum_exclusion));

        request_value["options"]["screen_session_maximum_duration_minutes"] = Value::from(0.0);
        request_value["options"]["screen_session_maximum_duration_disposition"] =
            Value::String("none".into());
        request_value["options"]["locked_screen_audio_disposition"] =
            Value::String("exclude_from_phone_and_app_sessions".into());
        let locked_audio_exclusion = serde_json::from_value::<RuntimeRequest>(request_value)
            .unwrap()
            .options
            .into_pipeline_options();
        assert!(requires_live_scientific_preflight(&locked_audio_exclusion));
        assert!(uses_input_capability_evidence(&locked_audio_exclusion));
    }

    #[test]
    fn app_only_parry_maximum_exclusion_exports_only_the_reusable_review_base() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Resumed,app.a,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,app.a,2026-03-07 10:02:00,UTC\n",
            "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 12:01:00,UTC\n",
        )
        .as_bytes()
        .to_vec();
        let mut capability_csv = String::from(
            "schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256\n"
        );
        for capability in
            chronicle_chrono_kernel_wasm::b05_foundational_semantics::CapabilityId::ALL
        {
            capability_csv.push_str(&format!(
                "{},{},*,{},capable,producer_manifest,urn:chronicle:test,\n",
                chronicle_chrono_kernel_wasm::b05_foundational_semantics::B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
                sha256(&csv),
                capability.canonical_id(),
            ));
        }
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "input_capability_evidence_file",
                "input-capability-evidence.csv",
                capability_csv.as_bytes(),
            )
            .unwrap();

        let mut full_request = request_for_workspace(&csv, 'd');
        full_request["options"]["screen_session_construction_strategy"] =
            Value::String("parry_toth_2025_session_glance_v1".into());
        full_request["options"]["screen_session_maximum_duration_minutes"] = Value::from(60.0);
        full_request["options"]["screen_session_maximum_duration_disposition"] =
            Value::String("exclude_participant".into());
        let full_json = full_request.to_string();
        scientific_preflight_native(&full_json, &csv, &support).unwrap();
        let mut full = execute_workspace_native(&full_json, &csv, &support).unwrap();
        let full_manifest: RuntimeManifest = serde_json::from_str(&full.manifest_json).unwrap();
        let mut review_base = None;
        let mut reconstruction_base_seen = false;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            if metadata.kind == "review-base" {
                review_base = Some(full.take_artifact_bytes(index).unwrap());
            } else if metadata.kind == "reconstruction-base" {
                reconstruction_base_seen = true;
            }
        }
        let review_base = review_base.expect("source-sensitive execution review base");
        assert!(!review_base.is_empty());
        assert!(!reconstruction_base_seen);

        let mut review_request = full_request.clone();
        review_request["requestId"] = Value::String("parry-review-base".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(full_manifest.workspace_root_digest.clone());
        let review_json = review_request.to_string();
        reset_tracked_execution_count();
        scientific_preflight_native(&review_json, &csv, &support).unwrap();
        let resumed =
            execute_workspace_native_with_review_base(&review_json, &csv, &review_base, &support)
                .unwrap();
        let resumed: ReviewRuntimeManifest = serde_json::from_str(&resumed.manifest_json).unwrap();

        reset_tracked_execution_count();
        review_request["requestId"] = Value::String("parry-cold-review".into());
        let cold_json = review_request.to_string();
        scientific_preflight_native(&cold_json, &csv, &support).unwrap();
        let cold = execute_workspace_native(&cold_json, &csv, &support).unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(resumed.review_summary_digest, cold.review_summary_digest);
        assert_eq!(resumed.comparison_digest, cold.comparison_digest);
        assert_eq!(
            (
                resumed.counts.original,
                resumed.counts.processed,
                resumed.counts.app,
                resumed.counts.screen,
            ),
            (
                cold.counts.original,
                cold.counts.processed,
                cold.counts.app,
                cold.counts.screen,
            ),
        );
    }

    #[test]
    fn locked_audio_exclusion_with_zero_duration_exports_only_the_review_base() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Resumed,app.a,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,app.a,2026-03-07 10:01:00,UTC\n",
            "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:02:00,UTC\n",
        )
        .as_bytes()
        .to_vec();
        let support = RuntimeSupportFiles::default();
        let mut full_request = request_for_workspace(&csv, 'e');
        full_request["options"]["correct_duplicate_event_timestamps"] = Value::Bool(false);
        full_request["options"]["locked_screen_audio_disposition"] =
            Value::String("exclude_from_phone_and_app_sessions".into());
        let full_json = full_request.to_string();
        scientific_preflight_native(&full_json, &csv, &support).unwrap();
        let mut full = execute_workspace_native(&full_json, &csv, &support).unwrap();
        let full_manifest: RuntimeManifest = serde_json::from_str(&full.manifest_json).unwrap();
        assert_eq!(full_manifest.counts.app, 0);

        let mut review_base = None;
        let mut reconstruction_base_seen = false;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            if metadata.kind == "review-base" {
                review_base = Some(full.take_artifact_bytes(index).unwrap());
            } else if metadata.kind == "reconstruction-base" {
                reconstruction_base_seen = true;
            }
        }
        let review_base = review_base.expect("locked-screen execution review base");
        assert!(!review_base.is_empty());
        assert!(!reconstruction_base_seen);

        let mut review_request = full_request.clone();
        review_request["requestId"] = Value::String("locked-audio-review-base".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(full_manifest.workspace_root_digest.clone());
        let review_json = review_request.to_string();
        reset_tracked_execution_count();
        scientific_preflight_native(&review_json, &csv, &support).unwrap();
        let resumed =
            execute_workspace_native_with_review_base(&review_json, &csv, &review_base, &support)
                .unwrap();
        let resumed: ReviewRuntimeManifest = serde_json::from_str(&resumed.manifest_json).unwrap();

        reset_tracked_execution_count();
        review_request["requestId"] = Value::String("locked-audio-cold-review".into());
        let cold_json = review_request.to_string();
        scientific_preflight_native(&cold_json, &csv, &support).unwrap();
        let cold = execute_workspace_native(&cold_json, &csv, &support).unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(resumed.review_summary_digest, cold.review_summary_digest);
        assert_eq!(resumed.comparison_digest, cold.comparison_digest);
        assert_eq!(
            (
                resumed.counts.original,
                resumed.counts.processed,
                resumed.counts.app,
                resumed.counts.screen,
            ),
            (
                cold.counts.original,
                cold.counts.processed,
                cold.counts.app,
                cold.counts.screen,
            ),
        );
    }

    #[test]
    fn finalized_scientific_receipts_reject_each_previously_unchecked_field() {
        let baseline = B05SchoedelPreflightResult::default();
        assert!(validate_b05_schoedel_finalization(&baseline, &baseline).is_ok());

        let mut changed = baseline.clone();
        changed.screen_construction_phase = B05ComputationPhase::Finalized;
        assert!(validate_b05_schoedel_finalization(&baseline, &changed).is_err());
        let mut changed = baseline.clone();
        changed.schoedel_reconstruction_phase = B05ComputationPhase::Finalized;
        assert!(validate_b05_schoedel_finalization(&baseline, &changed).is_err());
        let mut changed = baseline.clone();
        changed.protocol_version = "foreign-preflight/v1".into();
        assert!(validate_b05_schoedel_finalization(&baseline, &changed).is_err());
        let mut changed = baseline.clone();
        changed.options_digest = sha256(b"foreign options");
        assert!(validate_b05_schoedel_finalization(&baseline, &changed).is_err());
    }

    #[test]
    fn finalized_eyes_receipt_rejects_identity_count_and_resolution_tamper() {
        let raw = csv();
        let mut options = serde_json::from_str::<RuntimeRequest>(&request(&raw))
            .unwrap()
            .options
            .into_pipeline_options();
        options.episode_reconstruction_strategy = EpisodeReconstructionStrategy::EyesComplement;
        let engine = IncrementalPipelineV2Engine::default();
        let receipt = engine
            .preflight_eyes_complement_input_partition(
                &raw,
                &options,
                PipelineV2SupportFiles::default(),
            )
            .unwrap();
        assert_eq!(
            receipt.disposition,
            ScientificPreflightDisposition::Executable
        );
        assert!(validate_eyes_input_partition_finalization(&receipt, Some(&receipt)).is_ok());

        for field in ["identity", "count", "resolution"] {
            let mut tampered = receipt.clone();
            match field {
                "identity" => tampered.input_digest = sha256(b"foreign raw"),
                "count" => tampered.fragmented_participant_count += 1,
                "resolution" => tampered.resolution_digest = sha256(b"foreign resolution"),
                _ => unreachable!(),
            }
            assert!(
                validate_eyes_input_partition_finalization(&receipt, Some(&tampered)).is_err(),
                "one-field {field} tamper was accepted"
            );
        }

        let mut inactive_options = options.clone();
        inactive_options.episode_reconstruction_strategy =
            EpisodeReconstructionStrategy::FusedMatcher;
        let inactive = engine
            .preflight_eyes_complement_input_partition(
                &raw,
                &inactive_options,
                PipelineV2SupportFiles::default(),
            )
            .unwrap();
        assert_eq!(
            inactive.disposition,
            ScientificPreflightDisposition::NotApplicable
        );
        assert!(validate_eyes_input_partition_finalization(&inactive, None).is_ok());
        assert!(validate_eyes_input_partition_finalization(&inactive, Some(&inactive)).is_err());
    }

    /// `preflight_b05_schoedel` appends the product bodies it forces to a
    /// buffer that lives on the engine, and only `take_preflight_executed_queries`
    /// clears it. The engine outlives the request, so anything still in that
    /// buffer when a request ends is picked up by the NEXT request's drain and
    /// reported in that request's manifest as work it did.
    ///
    /// `preflight_on_incremental_engine` used to drain only on the success
    /// path. Measured here: that ordering is **not** reachable today, because
    /// the only failure the EYES partition preflight can raise (a malformed
    /// verified options digest) is raised first by the B05 preflight, which
    /// validates the same digest before it executes anything — the first two
    /// assertions below pin exactly that, so the day someone adds an
    /// EYES-only refusal the pin says what changed. The drain is
    /// unconditional regardless, and the last assertion is what that buys: a
    /// failing preflight leaves the engine's buffer empty whatever was in it
    /// on the way in, instead of depending on the caller having emptied it.
    #[test]
    fn a_failed_scientific_preflight_leaves_no_executions_on_the_engine() {
        let raw = csv();
        let mut options = serde_json::from_str::<RuntimeRequest>(&request(&raw))
            .unwrap()
            .options
            .into_pipeline_options();
        // Screen mode makes the B05 preflight active, so it forces real bodies.
        options.usage_session_mode = UsageSessionMode::AppAndScreenUsage;
        let valid_digest = sha256(b"runtime options");
        let valid_digest_static: &'static str = Box::leak(valid_digest.clone().into_boxed_str());
        let support = |digest: &'static str| PipelineV2SupportFiles {
            verified_request_options_digest: Some(digest),
            ..PipelineV2SupportFiles::default()
        };

        // Why the leak is not reachable through this pair today: both
        // preflights refuse the same malformed digest, and the recording one
        // refuses first.
        let mut probe = IncrementalPipelineV2Engine::default();
        probe
            .preflight_b05_schoedel(&raw, &options, support("not-a-sha256-digest"))
            .expect_err("the B05 preflight must refuse a malformed verified options digest");
        assert!(
            probe
                .preflight_eyes_complement_input_partition(
                    &raw,
                    &options,
                    support("not-a-sha256-digest"),
                )
                .is_err(),
            "the EYES partition preflight has a refusal the B05 preflight does not share, so a \
             reachable drain-skipping order now exists and this test must be widened",
        );

        // Non-vacuity: this request shape really does execute product bodies
        // inside the preflight, so the empty drain asserted below is the
        // unconditional drain and not a preflight that never ran anything.
        probe
            .preflight_b05_schoedel(&raw, &options, support(valid_digest_static))
            .expect("the B05 preflight answers for a screen-mode request");
        let recorded = probe.take_preflight_executed_queries();
        assert!(
            !recorded.is_empty(),
            "the B05 preflight executed nothing, so this fixture cannot detect a leaked window",
        );

        // The invariant: whatever the engine's buffer holds on the way in, a
        // failing `preflight_on_incremental_engine` leaves it empty on the way
        // out. Re-fill it the same way a preflight does, then fail the call.
        let mut engine = IncrementalPipelineV2Engine::default();
        engine
            .preflight_b05_schoedel(&raw, &options, support(valid_digest_static))
            .expect("the B05 preflight answers for a screen-mode request");
        let key = RuntimeScientificPreflightKey {
            protocol_version: SCIENTIFIC_PREFLIGHT_PROTOCOL_VERSION.into(),
            options_digest: valid_digest.clone(),
            input_digest: sha256(&raw),
            input_size_bytes: raw.len() as u64,
            active_ingress_roles: BTreeMap::new(),
            fragmented_participant_count: 0,
            fragmented_participant_token_scope_digest: sha256(b"scope"),
        };
        let error = preflight_on_incremental_engine(
            &mut engine,
            RawCsvBytes::Borrowed(&raw),
            key,
            &options,
            support("not-a-sha256-digest"),
        )
        .err()
        .expect("a malformed verified options digest must fail the preflight");
        assert!(error.contains("digest"), "unexpected refusal: {error}",);
        assert_eq!(
            engine.take_preflight_executed_queries(),
            Vec::<String>::new(),
            "the failed preflight left executions on the engine, where the next request's \
             drain reports them as that request's work",
        );
    }

    #[test]
    fn physical_rows_and_duplicate_headers_cover_every_separator_and_suffix_boundary() {
        assert_eq!(physical_data_row_count(b""), 0);
        assert_eq!(physical_data_row_count(b"header\nrow-1\nrow-2\n"), 2);
        assert_eq!(physical_data_row_count(b"header\rrow-1\rrow-2\r"), 2);
        assert_eq!(physical_data_row_count(b"header\r\nrow-1\r\nrow-2\r\n"), 2);

        let headers = csv::StringRecord::from(vec![
            "\u{feff}name",
            "name",
            "name",
            "\u{feff}kept-on-nonfirst",
        ]);
        let (columns, duplicate) = duplicate_safe_headers(&headers);
        assert!(duplicate);
        assert_eq!(
            columns,
            ["name", "name_1", "name_2", "\u{feff}kept-on-nonfirst"]
        );
        let (unique_columns, unique_duplicate) =
            duplicate_safe_headers(&csv::StringRecord::from(vec!["a", "b"]));
        assert_eq!(unique_columns, ["a", "b"]);
        assert!(!unique_duplicate);
    }

    #[test]
    fn raw_inspection_counts_each_advisory_condition_exactly() {
        let csv = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\r\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\r\n\
,,,,,,\r\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:00:00,America/Chicago\r\n\
S,P2,Chat,Unknown Event,pkg,not-a-time,\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07 11:00:00,None\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07T10:00:00Z,UTC\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07T09:00:00+00:00,UTC\r\n\
S,P2,Chat,Activity Resumed,pkg,2026-03-07 10:00:00,UTC";
        let inspection: Value =
            serde_json::from_str(&inspect_raw_file_v1(csv, "exact.csv", csv.len() as f64)).unwrap();
        assert_eq!(inspection["rowCount"], 8);
        assert_eq!(inspection["participantCount"], 2);
        assert_eq!(inspection["missingTimezoneCount"], 2);
        assert_eq!(inspection["missingTimestampCount"], 0);
        assert_eq!(inspection["invalidTimestampCount"], 1);
        assert_eq!(inspection["duplicateTimestampCount"], 1);
        assert_eq!(inspection["outOfOrderTimestampCount"], 1);
        assert_eq!(inspection["firstOutOfOrderRow"], 7);
        assert_eq!(
            inspection["timezones"],
            serde_json::json!(["America/Chicago", "UTC"])
        );
        assert_eq!(
            inspection["unrecognizedInteractionTypes"],
            serde_json::json!(["Unknown Event"])
        );
        let warnings = inspection["warnings"]
            .as_array()
            .expect("inspection warnings");
        assert!(warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.starts_with("This file contains 2 participants."))));
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing timezone"))));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows have invalid event_timestamp values."));
        assert!(!warnings
            .iter()
            .any(|warning| warning == "No timezone values found."));
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.starts_with("Invalid timezone values:"))));
    }

    /// The invalid-timezone advisory is the only signal a researcher gets that
    /// a device wrote a timezone preprocessing cannot resolve, so it has to
    /// fire on exactly those values and stay silent on the ones it can. It
    /// reports a distinct count and never the cell text: timezone values are
    /// participant data and warnings are surfaced in the UI.
    #[test]
    fn the_invalid_timezone_advisory_names_only_timezones_chronicle_cannot_resolve() {
        let header = "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";

        let resolvable = format!(
            "{header}\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:01:00,UTC\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:02:00,Australia/Eucla"
        );
        let resolvable: Value = serde_json::from_str(&inspect_raw_file_v1(
            resolvable.as_bytes(),
            "resolvable.csv",
            resolvable.len() as f64,
        ))
        .unwrap();
        assert_eq!(
            resolvable["timezones"],
            serde_json::json!(["America/Chicago", "Australia/Eucla", "UTC"])
        );
        assert!(
            !resolvable["warnings"]
                .as_array()
                .expect("inspection warnings")
                .iter()
                .any(|warning| warning
                    .as_str()
                    .is_some_and(|text| text.starts_with("Invalid timezone values:"))),
            "a file whose every timezone parses was still advised about invalid timezones"
        );

        let unresolvable = format!(
            "{header}\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:00:00,America/Chicago\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:01:00,Middle_Earth/Shire\n\
S,P1,Chat,Activity Resumed,pkg,2026-03-07 12:02:00,GMT+25\n\
S,P1,Chat,Activity Paused,pkg,2026-03-07 12:03:00,Middle_Earth/Shire"
        );
        let unresolvable: Value = serde_json::from_str(&inspect_raw_file_v1(
            unresolvable.as_bytes(),
            "unresolvable.csv",
            unresolvable.len() as f64,
        ))
        .unwrap();
        let warnings = unresolvable["warnings"]
            .as_array()
            .expect("inspection warnings");
        assert!(
            warnings.iter().any(|warning| warning
                == "Invalid timezone values: 2 distinct value(s) in the timezone column."),
            "two distinct unresolvable timezones were not advised exactly once each: {warnings:?}"
        );
        for warning in warnings {
            let text = warning.as_str().expect("warning text");
            assert!(
                !text.contains("Middle_Earth") && !text.contains("GMT+25"),
                "a raw timezone cell leaked into a warning: {text}"
            );
        }
    }

    #[test]
    fn empty_missing_and_present_columns_produce_distinct_warnings() {
        let zero_size: Value =
            serde_json::from_str(&inspect_raw_file_v1(b"foo\nvalue", "x.csv", 0.0)).unwrap();
        assert!(zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));
        assert!(zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning
                .as_str()
                .is_some_and(|text| text.starts_with("Missing required columns:"))));
        assert!(!zero_size["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "No timezone values found."));

        let whitespace: Value =
            serde_json::from_str(&inspect_raw_file_v1(b" \n ", "x.csv", 3.0)).unwrap();
        assert!(whitespace["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "File is empty."));

        let present_but_empty = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,P1,App,Activity Resumed,pkg,,";
        let present: Value = serde_json::from_str(&inspect_raw_file_v1(
            present_but_empty,
            "x.csv",
            present_but_empty.len() as f64,
        ))
        .unwrap();
        let warnings = present["warnings"].as_array().unwrap();
        assert!(!warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("timezone"))));
        assert_eq!(present["missingTimezoneCount"], 1);
        assert_eq!(present["timezones"], serde_json::json!(["UTC"]));
        assert!(warnings
            .iter()
            .any(|warning| warning == "1 rows are missing event_timestamp values."));
        assert!(present["hasRequiredColumns"].as_bool().unwrap());

        let clean = b"study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone\nS,P1,App,Activity Resumed,pkg,2026-03-07 12:00:00,UTC";
        let clean: Value =
            serde_json::from_str(&inspect_raw_file_v1(clean, "clean.csv", clean.len() as f64))
                .unwrap();
        assert_eq!(clean["participantCount"], 1);
        assert_eq!(clean["missingTimezoneCount"], 0);
        assert_eq!(clean["missingTimestampCount"], 0);
        assert_eq!(clean["invalidTimestampCount"], 0);
        let clean_warnings = clean["warnings"].as_array().unwrap();
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("participants"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing timezone"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("missing event_timestamp"))));
        assert!(!clean_warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("invalid event_timestamp"))));
    }

    #[test]
    fn exported_build_and_workflow_contract_identities_are_not_placeholders() {
        assert_eq!(build_environment_digest(), BUILD_ENVIRONMENT_DIGEST);
        assert!(build_environment_digest().starts_with("sha256:"));
        assert_eq!(build_environment_digest().len(), 71);
        let identity: Value = serde_json::from_str(&runtime_identity_json()).unwrap();
        assert_eq!(identity["protocolVersion"], RUNTIME_PROTOCOL_VERSION);
        assert_eq!(
            identity["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert_eq!(identity["buildEnvironmentDigest"], BUILD_ENVIRONMENT_DIGEST);
        assert_eq!(
            identity["productContractDigest"],
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(identity["planDigest"], EMBEDDED_PLAN_SHA256);
        assert_eq!(identity["profileDigest"], EMBEDDED_PROFILE_SHA256);
        assert_eq!(identity["profileLockDigest"], EMBEDDED_PROFILE_LOCK_SHA256);
        assert_eq!(
            identity["runtimeAuthorityDigest"],
            EMBEDDED_RUNTIME_AUTHORITY_SHA256
        );
        assert_eq!(
            identity["dependencyCertificateDigest"],
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256
        );
        // The typed JS export and the canonical JSON export serialize one
        // identity value (`runtime_identity` itself needs a JS host).
        assert_eq!(
            serde_json::from_value::<RuntimeIdentity>(identity.clone()).unwrap(),
            current_runtime_identity()
        );
        let contract: Value = serde_json::from_str(&workflow_contract_json()).unwrap();
        assert_eq!(
            contract["protocolVersion"],
            "chronicle-workflow-contract/v1"
        );
        assert_eq!(
            contract["execution"]["queries"].as_array().unwrap().len(),
            WORKFLOW_QUERIES.len()
        );
    }

    fn direct_pipeline_result(
        csv: &[u8],
        enable_aggregates: bool,
    ) -> (RuntimeRequest, PipelineV2Result, Value, Value) {
        let mut request_value: Value = serde_json::from_str(&request(csv)).unwrap();
        request_value["options"]["enable_aggregates"] = Value::Bool(enable_aggregates);
        let request: RuntimeRequest = serde_json::from_value(request_value).unwrap();
        let semantic_options = semantic_options_value(&request.options).unwrap();
        let exact_options = serde_json::to_value(&request.options).unwrap();
        let options = request.options.clone().into_pipeline_options();
        let (exact_options_value, _, _) = canonicalize_exact_options(&request.options).unwrap();
        let computation_digest = computation_options_digest(&exact_options_value).unwrap();
        let result = run_pipeline_v2_with_supports(
            csv,
            &options,
            PipelineV2SupportFiles {
                verified_request_options_digest: Some(&computation_digest),
                ..PipelineV2SupportFiles::default()
            },
        )
        .unwrap();
        (request, result, semantic_options, exact_options)
    }

    fn direct_eyes_pipeline_result(
        csv: &[u8],
        enable_aggregates: bool,
    ) -> (RuntimeRequest, PipelineV2Result) {
        let mut request_value: Value = serde_json::from_str(&request(csv)).unwrap();
        request_value["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        request_value["options"]["proximity_interval_ns"] = json!(2_000_000_000_i64);
        request_value["options"]["minimum_usage_duration"] = json!(0.0);
        request_value["options"]["enable_aggregates"] = Value::Bool(enable_aggregates);
        let request: RuntimeRequest = serde_json::from_value(request_value).unwrap();
        let (exact_options_value, _, _) = canonicalize_exact_options(&request.options).unwrap();
        let computation_digest = computation_options_digest(&exact_options_value).unwrap();
        let result = run_pipeline_v2_with_supports(
            csv,
            &request.options.clone().into_pipeline_options(),
            PipelineV2SupportFiles {
                verified_request_options_digest: Some(&computation_digest),
                ..PipelineV2SupportFiles::default()
            },
        )
        .unwrap();
        (request, result)
    }

    fn direct_scientific_evidence_bundle(
        csv: &[u8],
        request: &RuntimeRequest,
        result: &PipelineV2Result,
    ) -> RuntimeScientificEvidenceBundle {
        let (exact_options_value, options_bytes, options_digest) =
            canonicalize_exact_options(&request.options).unwrap();
        let computation_digest = computation_options_digest(&exact_options_value).unwrap();
        let input_digest = sha256(csv);
        let mut assignments = BTreeMap::new();
        assign(
            &mut assignments,
            "raw_chronicle_csv",
            "text/csv",
            csv,
            Some(&input_digest),
            Some(csv.len() as u64),
            BTreeMap::new(),
        )
        .unwrap();
        assign(
            &mut assignments,
            "processing_options",
            "application/json",
            &options_bytes,
            Some(&options_digest),
            Some(options_bytes.len() as u64),
            BTreeMap::new(),
        )
        .unwrap();
        let assignment_sets = RuntimeScientificAssignmentSets {
            foundational: assignments.clone(),
            screen: assignments.clone(),
            schoedel: assignments,
        };
        let eyes_evidence = build_runtime_eyes_evidence(result, &request.options)
            .unwrap()
            .summary;
        build_runtime_scientific_evidence(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            result,
            &request.options.clone().into_pipeline_options(),
            &input_digest,
            &computation_digest,
            &options_digest,
            &assignment_sets,
            &eyes_evidence,
        )
        .unwrap()
    }

    fn direct_verified_pipeline_result_from_value(
        csv: &[u8],
        request_value: Value,
    ) -> (RuntimeRequest, PipelineV2Result) {
        let request: RuntimeRequest = serde_json::from_value(request_value).unwrap();
        let (exact_options_value, _, _) = canonicalize_exact_options(&request.options).unwrap();
        let computation_digest = computation_options_digest(&exact_options_value).unwrap();
        let result = run_pipeline_v2_with_supports(
            csv,
            &request.options.clone().into_pipeline_options(),
            PipelineV2SupportFiles {
                verified_request_options_digest: Some(&computation_digest),
                ..PipelineV2SupportFiles::default()
            },
        )
        .unwrap();
        (request, result)
    }

    #[test]
    fn scientific_evidence_artifacts_are_typed_unique_closed_and_provenance_only() {
        let csv = csv();
        let (request, result, _, _) = direct_pipeline_result(&csv, false);
        let bundle = direct_scientific_evidence_bundle(&csv, &request, &result);
        let kinds = bundle
            .artifacts
            .iter()
            .map(|artifact| artifact.metadata.kind.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(kinds.len(), bundle.artifacts.len());
        assert!(kinds.contains(FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND));
        assert!(kinds.contains(ZERO_DURATION_CLEANUP_EVIDENCE_KIND));
        assert!(kinds.contains(B05_SCHOEDEL_VALIDATION_RECEIPT_KIND));
        assert!(!kinds.contains(MINIMUM_DURATION_EXCLUDED_LINEAGE_KIND));
        assert!(!kinds.contains(ZERO_DURATION_REMOVED_LINEAGE_KIND));
        assert!(!kinds.contains(B05_SCREEN_CONSTRUCTION_EVIDENCE_KIND));
        assert!(!kinds.contains(SCHOEDEL_RECONSTRUCTION_EVIDENCE_KIND));

        let foundational = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == FOUNDATIONAL_SEMANTICS_EVIDENCE_KIND)
            .unwrap();
        assert_eq!(
            foundational.bytes.to_vec(),
            serde_jcs::to_vec(&result.foundational_semantics_evidence).unwrap()
        );
        assert_eq!(
            foundational.metadata.digest,
            bundle.summary.foundational_semantics_artifact_digest
        );
        assert_eq!(
            bundle.summary.micro_use_receipt,
            result.foundational_semantics_evidence.micro_use
        );
        assert_eq!(
            bundle.summary.minimum_duration_receipt,
            RuntimeMinimumDurationReceipt::from(
                &result.foundational_semantics_evidence.minimum_duration,
            )
        );
        assert_eq!(
            bundle.summary.zero_duration_cleanup_receipt,
            RuntimeZeroDurationCleanupReceipt::from(
                &result
                    .foundational_semantics_evidence
                    .zero_duration_cleanup
                    .receipt,
            )
        );

        let (_, options_bytes, options_digest) =
            canonicalize_exact_options(&request.options).unwrap();
        let roots = BTreeSet::from([sha256(&csv), sha256(&options_bytes), options_digest]);
        let mut materialized = roots;
        for artifact in &bundle.artifacts {
            for dependency in &artifact.metadata.derived_from {
                assert!(
                    materialized.contains(dependency),
                    "{} has an unresolved scientific dependency {dependency}",
                    artifact.metadata.kind
                );
            }
            materialized.insert(artifact.metadata.digest.clone());
        }

        let eyes = build_runtime_eyes_evidence(&result, &request.options)
            .unwrap()
            .summary;
        let original =
            pipeline_result_digests_with_scientific(&result, &eyes, &bundle.summary).unwrap();
        // Pins the optional `scientificEvidence` member of the streamed
        // provenance record, which the None-side byte-equality test cannot.
        assert_eq!(
            original.provenance_digest,
            derived_pipeline_result_digest(
                &result,
                &original.published_outputs_digest,
                &eyes,
                Some(&bundle.summary)
            )
        );
        let mut changed_summary = bundle.summary.clone();
        changed_summary.b05_schoedel_validation_receipt_artifact_digest =
            format!("sha256:{}", "f".repeat(64));
        let changed =
            pipeline_result_digests_with_scientific(&result, &eyes, &changed_summary).unwrap();
        assert_eq!(
            original.published_outputs_digest, changed.published_outputs_digest,
            "scientific evidence must remain outside headline product identity"
        );
        assert_ne!(original.provenance_digest, changed.provenance_digest);
    }

    #[test]
    fn destructive_b04_and_zero_cleanup_publish_exact_separate_lineage_arrays() {
        let short_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:01,UTC"
        )
        .as_bytes()
        .to_vec();
        let mut request_value: Value = serde_json::from_str(&request(&short_csv)).unwrap();
        request_value["options"]["minimum_usage_duration"] = json!(2.0);
        request_value["options"]["minimum_duration_disposition"] = Value::String("drop_row".into());
        let (short_request, result) =
            direct_verified_pipeline_result_from_value(&short_csv, request_value);
        assert!(!result
            .foundational_semantics_evidence
            .minimum_duration_excluded_episodes
            .is_empty());
        let bundle = direct_scientific_evidence_bundle(&short_csv, &short_request, &result);
        let excluded = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == MINIMUM_DURATION_EXCLUDED_LINEAGE_KIND)
            .expect("B04 excluded-lineage artifact");
        assert_eq!(
            excluded.bytes.to_vec(),
            minimum_duration_excluded_lineage_bytes(&result.foundational_semantics_evidence)
                .unwrap()
        );
        assert_eq!(
            excluded.metadata.digest,
            result
                .foundational_semantics_evidence
                .minimum_duration
                .excluded_lineage_digest
        );
        let public_minimum_receipt =
            serde_json::to_string(&bundle.summary.minimum_duration_receipt).unwrap();
        assert!(!public_minimum_receipt.contains("excludedLineageDigest"));
        assert!(!public_minimum_receipt.contains(
            &result
                .foundational_semantics_evidence
                .minimum_duration
                .excluded_lineage_digest
        ));
        assert!(bundle
            .summary
            .b05_schoedel_validation_receipt_artifact_digest
            .starts_with("sha256:"));
        let validation = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == B05_SCHOEDEL_VALIDATION_RECEIPT_KIND)
            .unwrap();
        assert!(validation
            .metadata
            .derived_from
            .contains(&excluded.metadata.digest));

        let zero_csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:00,UTC"
        )
        .as_bytes()
        .to_vec();
        let mut request_value: Value = serde_json::from_str(&request(&zero_csv)).unwrap();
        request_value["options"]["minimum_usage_duration"] = json!(0.0);
        request_value["options"]["minimum_duration_disposition"] =
            Value::String("retain_and_credit".into());
        request_value["options"]["correct_duplicate_event_timestamps"] = Value::Bool(false);
        request_value["options"]["filter_zero_duration_sessions"] = Value::Bool(true);
        let (request, result) =
            direct_verified_pipeline_result_from_value(&zero_csv, request_value);
        assert!(!result
            .foundational_semantics_evidence
            .zero_duration_cleanup
            .removed_rows
            .is_empty());
        let bundle = direct_scientific_evidence_bundle(&zero_csv, &request, &result);
        let cleanup = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == ZERO_DURATION_CLEANUP_EVIDENCE_KIND)
            .expect("zero cleanup evidence artifact");
        assert_eq!(
            cleanup.bytes.to_vec(),
            serde_jcs::to_vec(&result.foundational_semantics_evidence.zero_duration_cleanup)
                .unwrap()
        );
        let removed = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == ZERO_DURATION_REMOVED_LINEAGE_KIND)
            .expect("zero removed-lineage artifact");
        assert_eq!(
            removed.bytes.to_vec(),
            zero_duration_removed_lineage_bytes(&result.foundational_semantics_evidence).unwrap()
        );
        assert_eq!(
            removed.metadata.digest,
            result
                .foundational_semantics_evidence
                .zero_duration_cleanup
                .receipt
                .removed_lineage_digest
        );
        let public_zero_receipt =
            serde_json::to_string(&bundle.summary.zero_duration_cleanup_receipt).unwrap();
        assert!(!public_zero_receipt.contains("removedLineageDigest"));
        assert!(!public_zero_receipt.contains(
            &result
                .foundational_semantics_evidence
                .zero_duration_cleanup
                .receipt
                .removed_lineage_digest
        ));
        let validation = bundle
            .artifacts
            .iter()
            .find(|artifact| artifact.metadata.kind == B05_SCHOEDEL_VALIDATION_RECEIPT_KIND)
            .unwrap();
        for dependency in [&cleanup.metadata.digest, &removed.metadata.digest] {
            assert!(validation.metadata.derived_from.contains(dependency));
        }
    }

    #[test]
    fn published_output_count_is_exact_and_binding_gaps_fail_closed() {
        let csv = csv();
        let (request, result, semantic_options, exact_options) = direct_pipeline_result(&csv, true);
        assert!(!result.aggregate_csv_outputs.is_empty());
        let eyes_evidence = build_runtime_eyes_evidence(&result, &request.options)
            .unwrap()
            .summary;

        let mut expected = Sha256::new();
        let mut fixed_outputs = vec![
            (
                "app-csv",
                &result.app_csv_bytes,
                result.app_row_count,
            ),
            (
                "screen-csv",
                &result.screen_csv_bytes,
                result.screen_row_count,
            ),
            (
                "day-coverage-csv",
                &result.day_coverage_csv_bytes,
                result.day_coverage_row_count,
            ),
            (
                "compliance-csv",
                &result.compliance_csv_bytes,
                result.compliance_row_count,
            ),
            (
                "credited-app-csv",
                &result.credited_app_csv_bytes,
                result.credited_app_row_count,
            ),
            (
                "notification-contact-csv",
                &result.notification_contact_csv_bytes,
                result.notification_contact_row_count,
            ),
            (
                "polled-emulation-csv",
                &result.polled_emulation_csv_bytes,
                result.polled_emulation_row_count,
            ),
            (
                "review-summary-json",
                &result.review_summary_json_bytes,
                0,
            ),
            (
                "visualization-data-json",
                &result.visualization_data_json_bytes,
                0,
            ),
        ];
        if !result.interval_expansion_csv_bytes.is_empty() {
            fixed_outputs.push((
                "interval-expansion-csv",
                &result.interval_expansion_csv_bytes,
                result.interval_expansion_row_count,
            ));
        }
        expected.update(b"chronicle-published-outputs-digest/v2");
        expected.update(
            ((fixed_outputs.len() + result.aggregate_csv_outputs.len()) as u64).to_le_bytes(),
        );
        for (kind, bytes, row_count) in
            fixed_outputs
                .into_iter()
                .chain(result.aggregate_csv_outputs.iter().map(|output| {
                    (
                        output.kind.as_str(),
                        &output.bytes,
                        output.row_count,
                    )
                }))
        {
            let digest = sha256(&bytes.to_vec());
            for field in [kind.as_bytes(), digest.as_bytes()] {
                expected.update((field.len() as u64).to_le_bytes());
                expected.update(field);
            }
            expected.update((bytes.len() as u64).to_le_bytes());
            expected.update(row_count.to_le_bytes());
        }
        assert_eq!(
            pipeline_result_digests(&result, &eyes_evidence).published_outputs_digest,
            format!("sha256:{}", hex::encode(expected.finalize()))
        );
        let published_digest =
            pipeline_result_digests(&result, &eyes_evidence).published_outputs_digest;
        let result_digest =
            compute_pipeline_result_digest(&result, &published_digest, &eyes_evidence);
        assert!(result_digest.starts_with("sha256:"));
        assert_eq!(result_digest.len(), 71);
        // The streamed canonical object must hash the exact bytes `serde_jcs`
        // produces for the derived record; a member added to one side only, or
        // a mis-sorted name, changes every published result digest.
        assert!(
            !result.row_lineage.is_empty(),
            "the fixture must exercise the streamed array"
        );
        assert_eq!(
            result_digest,
            derived_pipeline_result_digest(&result, &published_digest, &eyes_evidence, None)
        );
        let mut direct_digest = Sha256::new();
        let written = Sha256Writer(&mut direct_digest).write(b"abc").unwrap();
        assert_eq!(written, 3);
        assert_eq!(hex::encode(direct_digest.finalize()), sha256(b"abc")[7..]);

        let plan = embedded_plan();
        let mut cache = BTreeMap::new();
        let cold = build_runtime_query_executions(
            plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &WORKFLOW_QUERIES
                    .iter()
                    .map(|step| step.id.to_string())
                    .collect::<Vec<_>>(),
                materialize_full_outputs: true,
                previous_observations: &mut cache,
            },
        )
        .unwrap();
        assert!(cold
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Bypassed));
        let applicable = cold
            .iter()
            .find(|execution| execution.status != ExecutionStatus::Bypassed)
            .unwrap()
            .query_id
            .clone();
        cache.get_mut(&applicable).unwrap().output_digest = format!("sha256:{}", "f".repeat(64));
        let error = build_runtime_query_executions(
            plan,
            &semantic_options,
            &exact_options,
            &BTreeMap::new(),
            &result,
            &mut RuntimeQueryExecutionState {
                executed_queries: &WORKFLOW_QUERIES
                    .iter()
                    .map(|step| step.id.to_string())
                    .collect::<Vec<_>>(),
                materialize_full_outputs: true,
                previous_observations: &mut cache,
            },
        )
        .unwrap_err();
        assert!(error.contains("tracked query output changed without a changed bound input"));
        assert!(error.contains(&applicable));
    }

    /// A stale dependency certificate must say so in one place, by name.
    ///
    /// Without this, the only symptom is roughly seven warm-reuse tests failing
    /// with `Recomputed` where they expect `Cached` and "warm run must not call
    /// the kernel" — none of which mentions the certificate, the implementation
    /// digest, or `make dependency-evidence`. This asserts the checked-in
    /// evidence describes THIS build, and prints the diverging field and the
    /// cure when it does not.
    #[cfg(not(feature = "dependency-campaign-bootstrap"))]
    #[test]
    fn a_stale_dependency_certificate_names_itself_and_the_command_that_fixes_it() {
        if let Some(explanation) = dependency_evidence_staleness(embedded_dependency_certificate())
        {
            panic!("{explanation}");
        }
    }

    #[test]
    fn dependency_evidence_requires_every_receipt_identity_field() {
        let mut certificate = embedded_dependency_certificate().clone();
        let receipt = &mut certificate.evidence.implementation_receipt;
        receipt.implementation = "chronicle_preprocessing_runtime_wasm/0.1.0".into();
        receipt.implementation_digest = IMPLEMENTATION_BUILD_DIGEST.into();
        receipt.plan_digest = EMBEDDED_PLAN_SHA256.into();
        receipt.profile_digest = EMBEDDED_PROFILE_SHA256.into();
        receipt.profile_lock_digest = EMBEDDED_PROFILE_LOCK_SHA256.into();
        receipt.runtime_authority_digest = EMBEDDED_RUNTIME_AUTHORITY_SHA256.into();
        receipt.product_contract_digest = EMBEDDED_PRODUCT_CONTRACT_SHA256.into();
        assert!(dependency_evidence_current(&certificate));

        let replacements = [
            "implementation",
            "implementation_digest",
            "plan_digest",
            "profile_digest",
            "profile_lock_digest",
            "runtime_authority_digest",
            "product_contract_digest",
        ];
        for field in replacements {
            let mut stale = certificate.clone();
            let receipt = &mut stale.evidence.implementation_receipt;
            match field {
                "implementation" => receipt.implementation.push_str("-stale"),
                "implementation_digest" => receipt.implementation_digest.push_str("-stale"),
                "plan_digest" => receipt.plan_digest.push_str("-stale"),
                "profile_digest" => receipt.profile_digest.push_str("-stale"),
                "profile_lock_digest" => receipt.profile_lock_digest.push_str("-stale"),
                "runtime_authority_digest" => receipt.runtime_authority_digest.push_str("-stale"),
                "product_contract_digest" => receipt.product_contract_digest.push_str("-stale"),
                _ => unreachable!(),
            }
            assert!(
                !dependency_evidence_current(&stale),
                "a stale {field} must disable certified narrow reuse"
            );
        }
    }

    fn reset_tracked_execution_count() {
        TRACKED_PHYSICAL_EXECUTION_COUNT.with(|count| count.set(0));
        STABLE_ARTIFACT_GENERATION_COUNT.with(|count| count.set(0));
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
    }

    fn tracked_execution_count() -> usize {
        TRACKED_PHYSICAL_EXECUTION_COUNT.with(std::cell::Cell::get)
    }

    fn stable_artifact_generation_count() -> usize {
        STABLE_ARTIFACT_GENERATION_COUNT.with(std::cell::Cell::get)
    }

    #[test]
    fn stable_artifact_cache_is_bounded_before_bytes_are_shared() {
        assert_eq!(MAX_STABLE_ARTIFACT_CACHE_BYTES, 33_554_432);
        let small = runtime_artifact(&chronicle_chrono_kernel_wasm::payload_store::current_store(), "small", "application/octet-stream", vec![1, 2, 3], vec![]);
        assert!(stable_artifacts_fit_cache(
            std::slice::from_ref(&small),
            &[]
        ));
        let mut oversized = small;
        oversized.metadata.size = MAX_STABLE_ARTIFACT_CACHE_BYTES + 1;
        assert!(!stable_artifacts_fit_cache(&[oversized], &[]));
    }

    /// A store failure raised outside the `execute` window — the base export
    /// and the scientific preflight both run tracked bodies that lease
    /// payloads — must still drop the workspace engine, or the Err salsa
    /// memoized there replays on every later request in that workspace.
    #[test]
    fn a_store_failure_outside_the_execute_window_drops_the_workspace_engine() {
        struct RefusingSpill;
        impl chronicle_chrono_kernel_wasm::payload_store::SpillBackend for RefusingSpill {
            fn put(&self, id: u64, _bytes: &[u8]) -> Result<(), String> {
                Err(format!("spill payload {id} refused"))
            }
            fn get(&self, id: u64) -> Result<Vec<u8>, String> {
                Err(format!("reload payload {id} refused"))
            }
            fn remove(&self, _id: u64) {}
        }

        reset_tracked_execution_count();
        let csv = csv();
        let request_json = request(&csv);
        let workspace_id = serde_json::from_str::<RuntimeRequest>(&request_json)
            .unwrap()
            .workspace_id;
        execute_workspace_native(&request_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        let warm = INCREMENTAL_RUNTIME_STATES.with(|states| {
            states
                .borrow_mut()
                .get_mut(&workspace_id)
                .is_some_and(|state| !state.previous_query_observations.is_empty())
        });
        assert!(warm, "the first run must leave a warm workspace engine");

        // A request that fails after `execute`, while the store reported a
        // failure, reaches the guard with this snapshot.
        let previous_store = chronicle_chrono_kernel_wasm::payload_store::replace_current_store(
            chronicle_chrono_kernel_wasm::payload_store::PayloadStore::new(
                1,
                Arc::new(RefusingSpill),
            ),
        );
        let store_failures_before = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store());
        let _refused = chronicle_chrono_kernel_wasm::payload_store::current_store()
            .publish_with_codec(
                Arc::new(vec![0_u8; 64]),
                1024,
                |value: &Vec<u8>| Ok(value.clone()),
                |bytes: &[u8]| Ok(bytes.to_vec()),
            );
        let counted = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store()) > store_failures_before;
        let services = ExecutionServices { store: chronicle_chrono_kernel_wasm::payload_store::current_store() };
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            reset_incremental_state_after_store_failure(&mut states.borrow_mut(), &services, &workspace_id, store_failures_before);
        });
        let retained = INCREMENTAL_RUNTIME_STATES.with(|states| {
            states.borrow_mut().get_mut(&workspace_id).is_some_and(|state| {
                !state.previous_query_observations.is_empty()
                    || state.stable_artifact_bundle.is_some()
            })
        });
        chronicle_chrono_kernel_wasm::payload_store::replace_current_store(previous_store);
        assert!(counted, "the refused spill must be counted");
        assert!(
            !retained,
            "a store failure after execute must still drop the workspace engine"
        );
    }

    /// A spill refused BEFORE a request counts its failure and parks the error
    /// in the store. `PayloadHandle::lease` *takes* that parked error without
    /// touching `failure_count`, so handed to a tracked body inside the request
    /// it is memoized as that query's result while the guard's delta stays at
    /// zero and the poisoned engine is kept. The request-entry drain is what
    /// keeps a pre-request failure out of the request.
    #[test]
    fn a_store_failure_parked_before_a_request_never_reaches_a_lease_inside_it() {
        // Refuses the first spill and serves every later one: the failure is
        // counted and parked before the request, then storage recovers.
        #[derive(Default)]
        struct RefuseFirstSpill {
            inner: chronicle_chrono_kernel_wasm::payload_store::MemorySpillBackend,
            refused: std::sync::atomic::AtomicBool,
        }
        impl chronicle_chrono_kernel_wasm::payload_store::SpillBackend for RefuseFirstSpill {
            fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
                if !self.refused.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    return Err(format!("spill payload {id} refused"));
                }
                self.inner.put(id, bytes)
            }
            fn get(&self, id: u64) -> Result<Vec<u8>, String> {
                self.inner.get(id)
            }
            fn remove(&self, id: u64) {
                self.inner.remove(id)
            }
        }

        let previous_store = chronicle_chrono_kernel_wasm::payload_store::replace_current_store(
            chronicle_chrono_kernel_wasm::payload_store::PayloadStore::new(
                1,
                Arc::new(RefuseFirstSpill::default()),
            ),
        );
        // Charged past the budget, so the spill is attempted and refused: the
        // failure is counted and its error parked, value still resident. This
        // is the shape `compact_all` leaves behind between requests.
        let handle = chronicle_chrono_kernel_wasm::payload_store::current_store()
            .publish_with_codec(
                Arc::new(vec![0_u8; 64]),
                1024,
                |value: &Vec<u8>| Ok(value.clone()),
                |bytes: &[u8]| Ok(bytes.to_vec()),
            );
        let parked = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store());
        let store_failures_before = store_failures_at_request_entry(&chronicle_chrono_kernel_wasm::payload_store::current_store());
        let leased = handle.lease().map(|_| ());
        let moved = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store()) > store_failures_before;
        chronicle_chrono_kernel_wasm::payload_store::replace_current_store(previous_store);

        assert!(parked > 0, "the refused spill must be counted before the request");
        assert!(
            leased.is_ok(),
            "a failure parked before the request was handed to a lease inside it, where a \
             tracked body memoizes it: {:?}",
            leased.err(),
        );
        assert!(
            !moved,
            "the pre-request failure was re-counted inside the request, which would reset a \
             workspace engine that nothing poisoned",
        );
    }

    /// End to end over `execute_workspace_native`: a reload refused inside the
    /// request fails it, and the tracked query that leased the payload has
    /// memoized that error on the workspace engine, which outlives the request.
    /// Only the reset the guard performs lets the identical retry recompute
    /// after storage recovers — without it the retry either replays the
    /// memoized error or, had the failure landed outside Salsa, reports a fully
    /// cached run.
    #[test]
    fn a_store_failure_during_a_request_lets_the_identical_retry_recompute() {
        #[derive(Default)]
        struct FailOneReload {
            inner: chronicle_chrono_kernel_wasm::payload_store::MemorySpillBackend,
            fail_next_get: std::sync::atomic::AtomicBool,
        }
        impl chronicle_chrono_kernel_wasm::payload_store::SpillBackend for FailOneReload {
            fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
                self.inner.put(id, bytes)
            }
            fn get(&self, id: u64) -> Result<Vec<u8>, String> {
                if self
                    .fail_next_get
                    .swap(false, std::sync::atomic::Ordering::Relaxed)
                {
                    return Err("storage unavailable".into());
                }
                self.inner.get(id)
            }
            fn remove(&self, id: u64) {
                self.inner.remove(id)
            }
        }

        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let request_json = request_for_workspace(&csv, '5').to_string();
        let backend = Arc::new(FailOneReload::default());
        // A one-byte budget spills every payload, so the first stage that reads
        // an upstream table reloads it — and that reload is the refused one.
        let previous_store = chronicle_chrono_kernel_wasm::payload_store::replace_current_store(
            chronicle_chrono_kernel_wasm::payload_store::PayloadStore::new(1, backend.clone()),
        );
        backend
            .fail_next_get
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let failures_before = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store());
        let failed = execute_workspace_native(&request_json, &csv, &support).err();
        let counted = store_failure_count(&chronicle_chrono_kernel_wasm::payload_store::current_store()) > failures_before;
        // Storage has recovered: the backend refuses only the first reload.
        let retry = execute_workspace_native(&request_json, &csv, &support)
            .map(|handle| serde_json::from_str::<RuntimeManifest>(&handle.manifest_json).unwrap());
        chronicle_chrono_kernel_wasm::payload_store::replace_current_store(previous_store);

        let failed = failed.expect("the refused reload must fail the request");
        assert!(counted, "the refused reload must be counted: {failed}");
        let retry = retry.expect("the retry after storage recovered must succeed");
        assert!(
            retry
                .query_executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Recomputed),
            "the retry reused the engine the failed request poisoned"
        );
    }

    fn request(csv: &[u8]) -> String {
        serde_json::json!({
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "requestId": "req-1",
            "command": EXECUTE_WORKSPACE_COMMAND,
            "executionEngine": "incremental",
            "provenanceEvidence": true,
            "workspaceRootDigest": null,
            "workspaceId": format!("sha256:{}", "a".repeat(64)),
            "inputFileName": "Raw P01.csv",
            "inputSha256": sha256(csv),
            "options": {
                "study_name": "Runtime Study",
                "timezone": "America/Chicago",
                "usage_session_mode": "app_usage",
                "include_app_output": true,
                "include_screen_output": false,
                "use_filter_file": false,
                "use_apps_forcing_screen_open": false,
                "use_app_codebook": false,
                "correct_duplicate_event_timestamps": true,
                "allow_stop_event_reuse": false,
                "use_activity_stopped_as_fallback": true,
                "apply_threshold_to_fallback": true,
                "long_duration_threshold_ns": 43200000000000_i64,
                "proximity_interval_ns": 0_i64,
                "custom_app_engagement_duration": 300.0,
                "long_data_time_gap_thresholds": [1.0, 2.0],
                "long_usage_duration_thresholds": [1.0, 2.0],
                "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
                "other_stop_types": ["Activity Resumed", "Device Shutdown"],
                "interaction_types_to_remove": [],
                "screen_auto_lock_timeout_seconds": 120.0,
                "screen_auto_lock_tolerance_seconds": 30.0,
                "screen_manual_lock_max_tail_seconds": 30.0,
                "screen_keyguard_near_stop_seconds": 2.0,
                "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
                "model_concurrent_usage": false,
                "minimum_usage_duration": 60.0,
                // `classify_episode_durations` binds all four minimum-duration
                // request fields (workflow_contract.rs `query_request_fields`),
                // so each must be present in the exact request document or the
                // query input key would omit an option that decides the result.
                // The runtime fails closed on that rather than compute a key
                // that cannot invalidate. `buildRustV2Options` always sends all
                // four, so these values are the production request shape; they
                // are the canonical defaults, leaving behavior unchanged.
                "micro_use_classification_policy": "none",
                "minimum_duration_comparator": "strict_lt",
                "minimum_duration_disposition": "chronicle_blank_keep_row",
                "apply_minimum_usage_duration_to_concurrent_subintervals": false
            }
        })
        .to_string()
    }

    fn request_for_workspace(csv: &[u8], marker: char) -> Value {
        let mut value: Value = serde_json::from_str(&request(csv)).unwrap();
        value["workspaceId"] = Value::String(format!("sha256:{}", marker.to_string().repeat(64)));
        value
    }

    #[test]
    fn integer_screen_component_consumes_its_required_digest_bound_capability_upload() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/literature_input_adapter_conformance.json"
        ))
        .unwrap();
        let case = fixture["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|group| group["cases"].as_array().unwrap())
            .find(|case| case["fixtureId"] == "literature-input.integer-screen-state-session.v1")
            .unwrap();
        let raw = case["rawCsvLines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let evidence = case["supportCsvLines"]["input_capability_evidence_file"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            .replace("{{RAW_INPUT_SHA256}}", &sha256(raw.as_bytes()))
            + "\n";
        let component = "chronicle.integer-screen-state-session/v1";
        let request_json = request_for_workspace(raw.as_bytes(), 'c').to_string();
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "input_capability_evidence_file",
                "capability.csv",
                evidence.as_bytes(),
            )
            .unwrap();
        // Resolving an inactive upload must not activate it or poison the active cache.
        assert!(support
            .resolve(false)
            .unwrap()
            .get("input_capability_evidence_file")
            .is_empty());
        let mut handle =
            execute_literature_component_native(component, &request_json, raw.as_bytes(), &support)
                .expect("registered component consumes its required uploaded capability evidence");
        let manifest: LiteratureComponentRuntimeManifest =
            serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(manifest.source_row_count, 10);
        assert_eq!(manifest.derived_result_row_count, 3);
        let mut output = None;
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, sha256(&bytes));
            if metadata.kind == "literature-unlock-to-off-or-lock-screen-intervals-csv" {
                output = Some(String::from_utf8(bytes).unwrap());
            }
        }
        let output = output.unwrap();
        for expected in case["expected"]["outputContains"].as_array().unwrap() {
            assert!(output.contains(expected.as_str().unwrap()), "{output}");
        }
        for excluded in case["expected"]["outputExcludes"].as_array().unwrap() {
            assert!(!output.contains(excluded.as_str().unwrap()), "{output}");
        }
        for role in [None, Some("study_dates_file")] {
            let mut wrong_support = RuntimeSupportFiles::default();
            if let Some(role) = role {
                wrong_support
                    .put_native(role, "wrong-role.csv", evidence.as_bytes())
                    .unwrap();
            }
            let error = execute_literature_component_native(
                component,
                &request_json,
                raw.as_bytes(),
                &wrong_support,
            )
            .err()
            .unwrap();
            assert!(
                error.contains("requires exactly the registered support roles"),
                "{error}"
            );
        }
        let mut wrong_digest = RuntimeSupportFiles::default();
        wrong_digest
            .put_native(
                "input_capability_evidence_file",
                "capability.csv",
                evidence
                    .replace(&sha256(raw.as_bytes()), &sha256(b"another upload"))
                    .as_bytes(),
            )
            .unwrap();
        let error = execute_literature_component_native(
            component,
            &request_json,
            raw.as_bytes(),
            &wrong_digest,
        )
        .err()
        .unwrap();
        assert!(error.contains("raw input digest"), "{error}");
        let mut inactive = RuntimeSupportFiles::default();
        inactive
            .put_native(
                "input_capability_evidence_file",
                "untrusted.xlsx",
                b"not evidence",
            )
            .unwrap();
        assert!(inactive
            .resolve(false)
            .unwrap()
            .get("input_capability_evidence_file")
            .is_empty());
    }

    /// The app's default options are `app_and_screen_usage`, which demands the
    /// live scientific preflight. That preflight runs on the tracked cone; the
    /// sequential engine then computes its own receipt, and the finalization
    /// check requires the two to agree exactly.
    #[test]
    fn the_sequential_engine_finalizes_against_the_live_scientific_preflight() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let mut value = request_for_workspace(&csv, 'c');
        value["executionEngine"] = Value::String("sequential".into());
        value["options"]["usage_session_mode"] = Value::String("app_and_screen_usage".into());
        value["options"]["include_screen_output"] = Value::Bool(true);
        let request_json = value.to_string();
        scientific_preflight_native(&request_json, &csv, &support).unwrap();
        let handle = execute_workspace_native(&request_json, &csv, &support)
            .expect("sequential execute after the live preflight");
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let memoized = manifest
            .query_executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Cached)
            .map(|execution| execution.query_id.clone())
            .collect::<Vec<_>>();
        assert!(memoized.is_empty(), "{memoized:?}");

        let mut incremental = value.clone();
        incremental["executionEngine"] = Value::String("incremental".into());
        incremental["workspaceId"] = Value::String(format!("sha256:{}", "d".repeat(64)));
        let incremental_json = incremental.to_string();
        scientific_preflight_native(&incremental_json, &csv, &support).unwrap();
        let tracked = execute_workspace_native(&incremental_json, &csv, &support).unwrap();
        let tracked_manifest: RuntimeManifest = serde_json::from_str(&tracked.manifest_json).unwrap();
        let digests = |manifest: &RuntimeManifest| {
            manifest
                .query_executions
                .iter()
                .map(|execution| (execution.query_id.clone(), execution.output_digest.clone()))
                .collect::<BTreeMap<_, _>>()
        };
        assert_eq!(digests(&manifest), digests(&tracked_manifest));
    }

    /// A request without `executionEngine` runs the sequential engine: its
    /// preflight and execute never load the tracked engine, nothing is
    /// memoized, and the query outputs equal an explicit sequential run's.
    #[test]
    fn an_omitted_execution_engine_selects_the_sequential_engine() {
        assert_eq!(ExecutionEngine::default(), ExecutionEngine::Sequential);
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let mut omitted = request_for_workspace(&csv, 'e');
        omitted.as_object_mut().unwrap().remove("executionEngine");
        omitted["options"]["usage_session_mode"] = Value::String("app_and_screen_usage".into());
        omitted["options"]["include_screen_output"] = Value::Bool(true);
        let omitted_json = omitted.to_string();
        let parsed: RuntimeRequest = serde_json::from_str(&omitted_json).unwrap();
        assert_eq!(parsed.execution_engine, ExecutionEngine::Sequential);

        scientific_preflight_native(&omitted_json, &csv, &support).unwrap();
        let handle = execute_workspace_native(&omitted_json, &csv, &support).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let workspace_id = omitted["workspaceId"].as_str().unwrap().to_owned();
        let input_sha256 = omitted["inputSha256"].as_str().unwrap().to_owned();
        let tracked_holds_input = INCREMENTAL_RUNTIME_STATES.with(|states| {
            states
                .borrow_mut()
                .get_mut(&workspace_id)
                .is_some_and(|state| state.incremental_engine.has_verified_input(&input_sha256))
        });
        assert!(!tracked_holds_input, "an omitted engine warmed the tracked engine");
        assert!(manifest
            .query_executions
            .iter()
            .all(|execution| execution.status != ExecutionStatus::Cached));

        let mut sequential = omitted.clone();
        sequential["executionEngine"] = Value::String("sequential".into());
        sequential["workspaceId"] = Value::String(format!("sha256:{}", "f".repeat(64)));
        let sequential_json = sequential.to_string();
        scientific_preflight_native(&sequential_json, &csv, &support).unwrap();
        let explicit = execute_workspace_native(&sequential_json, &csv, &support).unwrap();
        let explicit: RuntimeManifest = serde_json::from_str(&explicit.manifest_json).unwrap();
        let digests = |manifest: &RuntimeManifest| {
            manifest
                .query_executions
                .iter()
                .map(|execution| (execution.query_id.clone(), execution.output_digest.clone()))
                .collect::<BTreeMap<_, _>>()
        };
        assert_eq!(digests(&manifest), digests(&explicit));
    }

    #[test]
    fn provenance_evidence_is_omitted_by_default_and_opt_in() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let mut disabled = request_for_workspace(&csv, '0');
        disabled.as_object_mut().unwrap().remove("provenanceEvidence");
        disabled["requestId"] = Value::String("req-provenance-disabled".into());
        let parsed: RuntimeRequest = serde_json::from_str(&disabled.to_string()).unwrap();
        assert!(!parsed.provenance_evidence);

        let disabled_handle = execute_workspace_native(&disabled.to_string(), &csv, &support)
            .expect("execute without provenance evidence");
        let disabled_manifest: RuntimeManifest =
            serde_json::from_str(&disabled_handle.manifest_json).unwrap();
        let disabled_kinds = disabled_manifest
            .artifacts
            .iter()
            .map(|artifact| artifact.kind.as_str())
            .collect::<BTreeSet<_>>();
        assert!(disabled_kinds.contains("row-lineage-arrow"));
        for kind in [
            "source-coordinate-index-arrow",
            "result-cell-correspondence-arrow",
            "source-result-influence-arrow",
        ] {
            assert!(!disabled_kinds.contains(kind), "unexpected {kind}");
        }

        let mut enabled = disabled;
        enabled["requestId"] = Value::String("req-provenance-enabled".into());
        enabled["provenanceEvidence"] = Value::Bool(true);
        let enabled_handle = execute_workspace_native(&enabled.to_string(), &csv, &support)
            .expect("execute with provenance evidence");
        let enabled_manifest: RuntimeManifest =
            serde_json::from_str(&enabled_handle.manifest_json).unwrap();
        let enabled_kinds = enabled_manifest
            .artifacts
            .iter()
            .map(|artifact| artifact.kind.as_str())
            .collect::<BTreeSet<_>>();
        for kind in [
            "row-lineage-arrow",
            "source-coordinate-index-arrow",
            "result-cell-correspondence-arrow",
            "source-result-influence-arrow",
        ] {
            assert!(enabled_kinds.contains(kind), "missing {kind}");
        }
    }

    /// The sequential engine's scientific preflight binds the receipt the
    /// tracked engine binds, and neither it nor the execute that follows
    /// touches the tracked engine.
    #[test]
    fn the_sequential_engine_preflight_binds_the_tracked_receipt_off_the_tracked_engine() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let engine_holds_input = |workspace_id: &str, input_sha256: &str| {
            INCREMENTAL_RUNTIME_STATES.with(|states| {
                states
                    .borrow_mut()
                    .get_mut(workspace_id)
                    .is_some_and(|state| state.incremental_engine.has_verified_input(input_sha256))
            })
        };
        for (incremental_marker, sequential_marker, mode, strategy) in [
            ('1', '2', "app_and_screen_usage", None),
            ('3', '4', "screen_usage", None),
            (
                '5',
                '6',
                "app_and_screen_usage",
                Some("schoedel_2026_app_within_screen_prose_v1"),
            ),
        ] {
            let mut value = request_for_workspace(&csv, incremental_marker);
            value["options"]["usage_session_mode"] = Value::String(mode.into());
            value["options"]["include_screen_output"] = Value::Bool(true);
            if let Some(strategy) = strategy {
                value["options"]["episode_reconstruction_strategy"] = Value::String(strategy.into());
            }
            let incremental_receipt =
                scientific_preflight_native(&value.to_string(), &csv, &support).unwrap();

            value["workspaceId"] =
                Value::String(format!("sha256:{}", sequential_marker.to_string().repeat(64)));
            value["executionEngine"] = Value::String("sequential".into());
            let workspace_id = value["workspaceId"].as_str().unwrap().to_owned();
            let input_sha256 = value["inputSha256"].as_str().unwrap().to_owned();
            let sequential_receipt =
                scientific_preflight_native(&value.to_string(), &csv, &support).unwrap();
            assert_eq!(sequential_receipt, incremental_receipt, "{mode} {strategy:?}");
            assert!(
                !engine_holds_input(&workspace_id, &input_sha256),
                "sequential preflight warmed the tracked engine for {mode} {strategy:?}"
            );

            if strategy.is_none() {
                execute_workspace_native(&value.to_string(), &csv, &support)
                    .expect("sequential execute after the sequential preflight");
                assert!(
                    !engine_holds_input(&workspace_id, &input_sha256),
                    "sequential execute warmed the tracked engine for {mode}"
                );
            }
        }
    }

    /// A preflight whose execute never arrived leaves its commit parked on the
    /// workspace, and the workspace id is the input's alone. The next request
    /// for the same file that needs no live preflight drops the leftover; it
    /// used to fail once with "does not match the exact prepared workspace".
    #[test]
    fn a_stale_pending_preflight_does_not_fail_a_request_that_needs_none() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let mut screen = request_for_workspace(&csv, '7');
        screen["options"]["usage_session_mode"] = Value::String("app_and_screen_usage".into());
        screen["options"]["include_screen_output"] = Value::Bool(true);
        scientific_preflight_native(&screen.to_string(), &csv, &support).unwrap();

        let app_only = request_for_workspace(&csv, '7');
        execute_workspace_native(&app_only.to_string(), &csv, &support)
            .expect("an app-only request after an abandoned screen preflight");
    }

    /// The sequential engine is the product default in the app: every request
    /// runs the whole registry from the raw bytes, reports every query as
    /// recomputed, keeps nothing warm, and persists no resume base — while
    /// producing byte-identical query outputs to the incremental engine.
    #[test]
    fn the_sequential_engine_recomputes_every_query_and_persists_no_base() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let incremental = execute_workspace_native(&request(&csv), &csv, &support).unwrap();
        let incremental_manifest: RuntimeManifest =
            serde_json::from_str(&incremental.manifest_json).unwrap();
        let digests = |manifest: &RuntimeManifest| {
            manifest
                .query_executions
                .iter()
                .map(|execution| (execution.query_id.clone(), execution.output_digest.clone()))
                .collect::<BTreeMap<_, _>>()
        };
        assert!(incremental_manifest
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "review-base"));

        let mut value = request_for_workspace(&csv, 'b');
        value["executionEngine"] = Value::String("sequential".into());
        let first = execute_workspace_native(&value.to_string(), &csv, &support).unwrap();
        let first_manifest: RuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        value["requestId"] = Value::String("req-2".into());
        value["workspaceRootDigest"] = Value::String(first_manifest.workspace_root_digest.clone());
        let second = execute_workspace_native(&value.to_string(), &csv, &support).unwrap();
        let second_manifest: RuntimeManifest = serde_json::from_str(&second.manifest_json).unwrap();
        for manifest in [&first_manifest, &second_manifest] {
            let memoized = manifest
                .query_executions
                .iter()
                .filter(|execution| {
                    !matches!(
                        execution.status,
                        ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                    )
                })
                .map(|execution| format!("{}={:?}", execution.query_id, execution.status))
                .collect::<Vec<_>>();
            assert!(
                memoized.is_empty(),
                "sequential run reported a memoized query: {memoized:?}"
            );
            assert!(
                !manifest.artifacts.iter().any(|artifact| {
                    artifact.kind == "review-base" || artifact.kind == "reconstruction-base"
                }),
                "sequential run persisted a resume base"
            );
            assert_eq!(digests(manifest), digests(&incremental_manifest));
        }

        // A review request runs from the bytes it is handed; without bytes it
        // asks for the raw file instead of pretending to hold a memo.
        value["requestId"] = Value::String("req-3".into());
        value["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        value["workspaceRootDigest"] = Value::String(second_manifest.workspace_root_digest.clone());
        let review = execute_workspace_native(&value.to_string(), &csv, &support).unwrap();
        let review_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review.manifest_json).unwrap();
        assert!(!review_manifest
            .query_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Cached));
        assert!(review_manifest.cache_sources.is_empty(), "{:?}", review_manifest.cache_sources);
        // The persisted-review probe is how the app asks whether a raw-less
        // resume is possible; a sequential request never offers one, so the
        // caller sends the raw file.
        let prepared =
            prepare_workspace_review_native(&value.to_string(), csv.clone(), &[], &[], &support)
                .unwrap();
        assert_eq!(prepared.required_base_kind(), "none");
    }

    #[test]
    fn explicit_default_method_options_remain_in_the_scientific_receipt_identity() {
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        let parsed: RuntimeRequest = serde_json::from_value(request_value.clone()).unwrap();
        let mut emitted_options = serde_json::to_value(parsed.options).unwrap();
        emitted_options["filter_match_field"] = json!("app_package_name");
        emitted_options["application_label_exclusions"] = json!([]);
        emitted_options["aggregate_top_apps_limit"] = json!(0);
        request_value["options"] = emitted_options.clone();

        let receipt: RuntimeScientificPreflightReceipt = serde_json::from_str(
            &scientific_preflight_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            )
            .unwrap(),
        )
        .unwrap();
        let exact_digest = sha256(&serde_jcs::to_vec(&emitted_options).unwrap());
        let computation_digest = computation_options_digest(&emitted_options).unwrap();

        assert_eq!(receipt.key.options_digest, exact_digest);
        assert_eq!(receipt.b05_schoedel.options_digest, computation_digest);
        assert_eq!(
            receipt.eyes_input_partition.options_digest,
            computation_digest
        );
    }

    #[test]
    fn opener_set_preflight_defaults_and_binds_the_exact_options_receipt() {
        let csv = csv();
        let request_json = request(&csv);
        let parsed_request: RuntimeRequest = serde_json::from_str(&request_json).unwrap();
        let decision: OpenerSetPreflightDecision =
            serde_json::from_str(&opener_set_applicability_native(&request_json).unwrap()).unwrap();
        let (_, _, exact_options_digest) =
            canonicalize_exact_options(&parsed_request.options).unwrap();

        assert_eq!(decision.status, OpenerSetPreflightStatus::Executable);
        assert_eq!(decision.requested_opener_set_id, "strategy_defined");
        assert_eq!(decision.resolved_opener_set_id, "strategy_defined");
        assert_eq!(
            decision.effective_opener_set_id.as_deref(),
            Some("strategy_defined")
        );
        assert_eq!(decision.relation, OpenerStrategyRelation::BaselineNative);
        assert_eq!(decision.reason_code, None);
        assert_eq!(decision.options_digest, exact_options_digest);

        // A stale or misspelled arm is refused and named at the request
        // boundary. It used to resolve to `strategy_defined` and run, which is
        // a computation the request never selected.
        let mut stale_request: Value = serde_json::from_str(&request_json).unwrap();
        stale_request["options"]["opener_set"] = Value::String("removed_legacy_arm".into());
        let refusal = opener_set_applicability_native(&stale_request.to_string())
            .expect_err("an unknown opener set is refused");
        assert!(
            refusal.starts_with("invalid request: unknown_opener_set: \"removed_legacy_arm\""),
            "{refusal}",
        );
    }

    /// A legal B06 vector that is refused for the selected reconstruction
    /// strategy or threshold provider is not an invalid request on the
    /// opener-set axis: the opener preflight answers, the B06 preflight
    /// reports the refusal as data, and execution rejects it before any
    /// tracked query runs. Malformed B06 stays rejected by every surface
    /// that judges it. (Found by the interaction tomography campaign: the
    /// product runs the opener preflight first, so its raw
    /// `pipeline_options_invalid:b06=…` error hid the typed refusal.)
    #[test]
    fn refused_maximum_duration_vectors_pass_the_opener_preflight_and_surface_through_the_b06_preflight(
    ) {
        let csv = csv();
        let legacy_companions = [
            (
                "b06_legacy_threshold_hours_canonical",
                Value::String("12".into()),
            ),
            (
                "b06_legacy_threshold_ns_canonical",
                Value::String("43200000000000".into()),
            ),
        ];
        let refused_vectors = [
            (
                "chronicle rejection outside the fused matcher",
                serde_json::json!({
                    "maximum_duration_policy": "chronicle_observed_close_rejection_v1",
                    "maximum_duration_disposition": "not_applicable",
                    "maximum_duration_threshold_source": "chronicle_legacy_config",
                    "episode_reconstruction_strategy": "gesis_start_stop_repair",
                }),
                "maximum_duration_policy_incompatible_with_reconstruction_strategy",
            ),
            (
                "adaptive provider unavailable",
                serde_json::json!({
                    "maximum_duration_policy": "post_reconstruction_strict_max_v1",
                    "maximum_duration_disposition": "flag_and_retain",
                    "maximum_duration_threshold_source": "b12_adaptive_participant",
                }),
                "adaptive_maximum_threshold_provider_unavailable",
            ),
        ];
        for (label, patch, reason) in refused_vectors {
            reset_tracked_execution_count();
            let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
            for (key, value) in patch.as_object().unwrap() {
                request_value["options"][key.as_str()] = value.clone();
            }
            for (key, value) in legacy_companions.iter() {
                request_value["options"][*key] = value.clone();
            }
            let request_json = request_value.to_string();

            let opener: OpenerSetPreflightDecision = serde_json::from_str(
                &opener_set_applicability_native(&request_json).unwrap_or_else(|error| {
                    panic!("{label}: opener preflight must answer: {error}")
                }),
            )
            .unwrap();
            assert_eq!(
                opener.status,
                OpenerSetPreflightStatus::Executable,
                "{label}"
            );

            let b06: MaximumDurationPreflightDecision = serde_json::from_str(
                &maximum_duration_applicability_native(&request_json).unwrap(),
            )
            .unwrap();
            assert_eq!(b06.status, OpenerSetPreflightStatus::Refused, "{label}");
            assert_eq!(b06.reason_code.as_deref(), Some(reason), "{label}");
            assert_eq!(b06.options_digest, opener.options_digest, "{label}");

            let error = match execute_workspace_native(
                &request_json,
                &csv,
                &RuntimeSupportFiles::default(),
            ) {
                Ok(_) => panic!("{label}: a refused vector must not execute"),
                Err(error) => error,
            };
            assert_eq!(
                error,
                format!("pipeline_options_invalid:b06={reason}"),
                "{label}"
            );
            assert_eq!(tracked_execution_count(), 0, "{label}");
        }

        // Malformed B06 is an invalid request on the opener axis and refused
        // data on the B06 axis.
        let mut malformed: Value = serde_json::from_str(&request(&csv)).unwrap();
        for (key, value) in [
            (
                "maximum_duration_policy",
                "post_reconstruction_strict_max_v1",
            ),
            ("maximum_duration_disposition", "flag_and_retain"),
            ("maximum_duration_threshold_source", "fixed_parameter"),
            ("maximum_duration_threshold_ns", "01"),
        ]
        .into_iter()
        .chain(
            legacy_companions
                .iter()
                .map(|(key, value)| (*key, value.as_str().unwrap())),
        ) {
            malformed["options"][key] = Value::String(value.into());
        }
        let malformed_json = malformed.to_string();
        assert_eq!(
            opener_set_applicability_native(&malformed_json).unwrap_err(),
            "pipeline_options_invalid:b06=maximum_duration_threshold_malformed"
        );
        let b06: MaximumDurationPreflightDecision =
            serde_json::from_str(&maximum_duration_applicability_native(&malformed_json).unwrap())
                .unwrap();
        assert_eq!(b06.status, OpenerSetPreflightStatus::Refused);
        assert_eq!(
            b06.reason_code.as_deref(),
            Some("maximum_duration_threshold_malformed")
        );
        // Neither preflight accepts a request that is malformed outside B06.
        let mut bad_protocol = malformed.clone();
        bad_protocol["protocolVersion"] =
            Value::String("chronicle-preprocessing-runtime/v0".into());
        assert!(
            maximum_duration_applicability_native(&bad_protocol.to_string())
                .unwrap_err()
                .starts_with("unsupported protocol version")
        );
    }

    /// The manifest carries only the PHI-safe aggregate B06 receipt (as B04
    /// does): the participant-level excluded lineage — participant ids and
    /// i64 nanosecond timestamps that cannot cross the browser boundary as
    /// JSON numbers — lives in the content-addressed
    /// `maximum-duration-receipt-json` artifact, bound to the manifest by the
    /// receipt's `excludedLineageDigest`. The fixed threshold is a decimal
    /// string on every surface so the full i64 range travels exactly.
    /// (The B06 `@smoke` e2e first exposed the manifest decode failure.)
    #[test]
    fn maximum_duration_manifest_carries_the_aggregate_receipt_and_the_artifact_carries_the_lineage(
    ) {
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        for (key, value) in [
            (
                "maximum_duration_policy",
                "post_reconstruction_strict_max_v1",
            ),
            ("maximum_duration_disposition", "truncate_to_threshold"),
            ("maximum_duration_threshold_source", "fixed_parameter"),
            // The fixture's only episode is 60 s; the largest legal threshold
            // never qualifies it, and its 19-digit value is exactly what a JS
            // number could not carry.
            ("maximum_duration_threshold_ns", "9223372036854775807"),
            ("b06_legacy_threshold_hours_canonical", "12"),
            ("b06_legacy_threshold_ns_canonical", "43200000000000"),
        ] {
            request_value["options"][key] = Value::String(value.into());
        }
        let mut handle = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let receipt = manifest
            .processing_summary
            .maximum_duration_receipt
            .clone()
            .expect("explicit vector publishes a receipt");
        assert_eq!(
            receipt.applicability.threshold_ns.as_deref(),
            Some("9223372036854775807")
        );
        assert_eq!(receipt.qualifying_count, 0);
        let manifest_value: Value = serde_json::from_str(&handle.manifest_json).unwrap();
        let summary_receipt = &manifest_value["processingSummary"]["maximumDurationReceipt"];
        assert!(summary_receipt.get("excludedEpisodes").is_none());
        assert!(summary_receipt.get("receipt").is_none());
        assert_eq!(
            summary_receipt["applicability"]["thresholdNs"],
            Value::String("9223372036854775807".into())
        );
        let preflight: MaximumDurationPreflightDecision = serde_json::from_str(
            &maximum_duration_applicability_native(&request_value.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(preflight.applicability, receipt.applicability);

        let receipt_index = manifest
            .artifacts
            .iter()
            .position(|artifact| artifact.kind == MAXIMUM_DURATION_RECEIPT_KIND)
            .expect("maximum-duration receipt artifact");
        let receipt_metadata = &manifest.artifacts[receipt_index];
        assert!(receipt_metadata
            .derived_from
            .contains(&manifest.options_digest));
        let receipt_bytes = handle.take_artifact_bytes(receipt_index as u32).unwrap();
        assert_eq!(receipt_metadata.digest, sha256(&receipt_bytes));
        let evidence: b06::MaximumDurationEvidence =
            serde_json::from_slice(&receipt_bytes).unwrap();
        assert_eq!(evidence.receipt, receipt);
        assert_eq!(receipt_bytes, serde_jcs::to_vec(&evidence).unwrap());
        assert_eq!(
            b06::excluded_lineage_digest(&evidence.excluded_episodes).unwrap(),
            receipt.excluded_lineage_digest
        );
        b06::validate_evidence(&evidence).unwrap();
    }

    #[test]
    fn screen_only_eyes_complement_executes_with_not_applicable_eyes_evidence() {
        // pict_26 regression (2026-08-13): the runtime derived EYES evidence
        // status from the strategy id alone, while the kernel's applicability
        // (eyes_complement_is_active) also requires app usage. A
        // screen-usage-only request with eyes_complement selected produced
        // (PartialReplay, no receipt) and failed with "EYES applicability and
        // validation receipt presence disagree". The status now comes from
        // the kernel predicate: such a request executes, and its manifest
        // reports not_applicable EYES evidence with no receipt.
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["usage_session_mode"] = Value::String("screen_usage".into());
        request_value["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        let request_json = request_value.to_string();
        scientific_preflight_native(&request_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        let handle =
            execute_workspace_native(&request_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(
            manifest.eyes_evidence.status,
            RuntimeEyesEvidenceStatus::NotApplicable
        );
        assert_eq!(manifest.eyes_evidence.tagged_fau_artifact_digest, None);
        assert!(manifest.eyes_evidence.validation_receipt.is_none());
    }

    #[test]
    fn eyes_with_gesis_openers_is_refused_before_reconstruction() {
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["opener_set"] = Value::String("gesis_app_scoped_starts".into());
        request_value["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        let request_json = request_value.to_string();
        let decision: OpenerSetPreflightDecision =
            serde_json::from_str(&opener_set_applicability_native(&request_json).unwrap()).unwrap();

        assert_eq!(decision.status, OpenerSetPreflightStatus::Refused);
        assert_eq!(decision.requested_opener_set_id, "gesis_app_scoped_starts");
        assert_eq!(decision.resolved_opener_set_id, "gesis_app_scoped_starts");
        assert_eq!(decision.effective_opener_set_id, None);
        assert_eq!(decision.relation, OpenerStrategyRelation::Refused);
        assert_eq!(
            decision.reason_code.as_deref(),
            Some("eyes_requires_lifecycle_triplets")
        );
        assert_eq!(
            execute_workspace_native(&request_json, &csv, &RuntimeSupportFiles::default())
                .err()
                .unwrap(),
            "opener_set_refused:gesis_app_scoped_starts:eyes_complement:eyes_requires_lifecycle_triplets"
        );
    }

    #[test]
    fn opener_set_receipt_is_manifested_artifacted_and_review_stable() {
        reset_tracked_execution_count();
        let csv = csv();
        let request_json = request(&csv);
        let decision: OpenerSetPreflightDecision =
            serde_json::from_str(&opener_set_applicability_native(&request_json).unwrap()).unwrap();
        let mut handle =
            execute_workspace_native(&request_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();

        assert_eq!(manifest.options_digest, decision.options_digest);
        assert_eq!(
            manifest
                .processing_summary
                .opener_set_receipt
                .applicability
                .requested
                .canonical_id(),
            decision.resolved_opener_set_id
        );
        assert_eq!(
            manifest
                .processing_summary
                .opener_set_receipt
                .applicability
                .effective
                .map(|opener_set| opener_set.canonical_id()),
            decision.effective_opener_set_id.as_deref()
        );
        assert_eq!(
            manifest
                .processing_summary
                .opener_set_receipt
                .applicability
                .relation,
            decision.relation
        );

        let processing_options = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "processing-options-json")
            .expect("processing-options artifact");
        assert_eq!(processing_options.digest, manifest.options_digest);
        assert_eq!(
            manifest.eyes_evidence.status,
            RuntimeEyesEvidenceStatus::NotApplicable
        );
        assert_eq!(
            manifest.eyes_evidence,
            manifest.processing_summary.eyes_evidence
        );
        assert!(manifest.eyes_evidence.validation_receipt.is_none());
        assert!(manifest
            .eyes_evidence
            .validation_receipt_artifact_digest
            .is_none());
        assert!(manifest.eyes_evidence.tagged_fau_artifact_digest.is_none());
        assert!(manifest
            .artifacts
            .iter()
            .all(|artifact| artifact.kind != EYES_TAGGED_FAU_EVIDENCE_KIND));
        let (direct_request, direct_result, _, _) = direct_pipeline_result(&csv, false);
        let direct_eyes = build_runtime_eyes_evidence(&direct_result, &direct_request.options)
            .unwrap()
            .summary;
        assert_eq!(
            manifest.processing_summary.published_outputs_digest,
            pipeline_result_digests(&direct_result, &direct_eyes).published_outputs_digest,
            "explicit non-EYES status must not alter the researcher-output closure"
        );

        let receipt_index = manifest
            .artifacts
            .iter()
            .position(|artifact| artifact.kind == "opener-set-receipt-json")
            .expect("opener-set receipt artifact");
        let receipt_metadata = &manifest.artifacts[receipt_index];
        assert!(receipt_metadata
            .derived_from
            .contains(&manifest.input.digest));
        assert!(receipt_metadata
            .derived_from
            .contains(&manifest.options_digest));
        let receipt_bytes = handle.take_artifact_bytes(receipt_index as u32).unwrap();
        assert_eq!(receipt_metadata.digest, sha256(&receipt_bytes));
        assert_eq!(
            serde_json::from_slice::<OpenerSetEvidence>(&receipt_bytes).unwrap(),
            manifest.processing_summary.opener_set_receipt
        );
        assert_eq!(
            receipt_bytes,
            serde_jcs::to_vec(&manifest.processing_summary.opener_set_receipt).unwrap()
        );

        let semantic_index = manifest
            .artifacts
            .iter()
            .position(|artifact| artifact.kind == "semantic-index-source-json")
            .expect("semantic-index source artifact");
        assert!(manifest.artifacts[semantic_index]
            .derived_from
            .contains(&receipt_metadata.digest));
        let semantic_index_bytes = handle.take_artifact_bytes(semantic_index as u32).unwrap();
        let semantic_index_source: Value = serde_json::from_slice(&semantic_index_bytes).unwrap();
        assert_eq!(
            semantic_index_source["protocolVersion"],
            "chronicle-semantic-index-source/v7"
        );
        assert_eq!(
            semantic_index_source["openerSetReceipt"],
            serde_json::to_value(&manifest.processing_summary.opener_set_receipt).unwrap()
        );
        assert_eq!(
            semantic_index_source["openerSetReceiptDigest"].as_str(),
            Some(receipt_metadata.digest.as_str())
        );
        assert_eq!(
            semantic_index_source["eyesEvidence"],
            serde_json::to_value(&manifest.eyes_evidence).unwrap()
        );
        assert!(semantic_index_source.get("queryGroupExecutions").is_none());
        assert!(semantic_index_source.get("executionLedger").is_none());
        assert!(semantic_index_source["queryExecutions"].is_array());

        let mut warm_request: Value = serde_json::from_str(&request_json).unwrap();
        warm_request["requestId"] = Value::String("req-opener-warm-review".into());
        warm_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        warm_request["workspaceRootDigest"] = Value::String(manifest.workspace_root_digest.clone());
        let review = execute_workspace_native(
            &warm_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let review_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review.manifest_json).unwrap();
        assert_eq!(review_manifest.options_digest, decision.options_digest);
        assert_eq!(
            review_manifest.opener_set_receipt,
            manifest.processing_summary.opener_set_receipt
        );
        assert_eq!(review_manifest.eyes_evidence, manifest.eyes_evidence);
    }

    #[test]
    fn opener_set_receipt_is_committed_by_pipeline_provenance() {
        let csv = csv();
        let (request, result, _, _) = direct_pipeline_result(&csv, false);
        let eyes_evidence = build_runtime_eyes_evidence(&result, &request.options)
            .unwrap()
            .summary;
        let original = pipeline_result_digests(&result, &eyes_evidence);
        let mut changed = result.clone();
        changed.opener_set_evidence.suppressed_device_opener_count += 1;
        let changed = pipeline_result_digests(&changed, &eyes_evidence);

        assert_eq!(
            original.published_outputs_digest, changed.published_outputs_digest,
            "receipt-only evidence changes must not pretend the published CSV bytes changed"
        );
        assert_ne!(
            original.provenance_digest, changed.provenance_digest,
            "pipeline provenance must commit the opener-set evidence receipt"
        );
    }

    #[test]
    fn eyes_full_review_and_processing_manifests_share_typed_receipts() {
        reset_tracked_execution_count();
        let csv = eyes_csv();
        let mut request_value = request_for_workspace(&csv, '8');
        request_value["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        request_value["options"]["proximity_interval_ns"] = json!(2_000_000_000_i64);
        request_value["options"]["minimum_usage_duration"] = json!(0.0);
        request_value["options"]["enable_aggregates"] = Value::Bool(true);
        scientific_preflight_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut full = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&full.manifest_json).unwrap();
        assert_eq!(
            manifest.eyes_evidence.status,
            RuntimeEyesEvidenceStatus::PartialReplay
        );
        assert_eq!(
            manifest.eyes_evidence,
            manifest.processing_summary.eyes_evidence
        );
        let receipt = manifest
            .eyes_evidence
            .validation_receipt
            .as_ref()
            .expect("active EYES aggregate validation receipt");
        assert_eq!(receipt.participant_count, 1);
        assert_eq!(
            receipt.status,
            chronicle_chrono_kernel_wasm::pipeline_v2::EyesTaggedFauValidationStatus::Validated
        );
        assert_eq!(receipt.source_version, "0.1.0");
        assert_eq!(
            receipt.source_commit,
            "89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108"
        );
        assert_eq!(receipt.source_license_status, "unresolved");
        assert!(receipt.validation_digest.starts_with("sha256:"));
        assert!(!full.manifest_json.contains("\"fragments\""));
        assert!(!full.manifest_json.contains("\"appUsageChunks\""));
        assert!(!full.manifest_json.contains("P01"));

        let artifact_index = manifest
            .artifacts
            .iter()
            .position(|artifact| artifact.kind == EYES_TAGGED_FAU_EVIDENCE_KIND)
            .unwrap();
        let artifact_metadata = manifest.artifacts[artifact_index].clone();
        let artifact_bytes = full.take_artifact_bytes(artifact_index as u32).unwrap();
        assert_eq!(artifact_metadata.digest, sha256(&artifact_bytes));
        assert_eq!(
            manifest.eyes_evidence.tagged_fau_artifact_digest.as_deref(),
            Some(artifact_metadata.digest.as_str())
        );
        let artifact_value: Value = serde_json::from_slice(&artifact_bytes).unwrap();
        assert_eq!(artifact_bytes, serde_jcs::to_vec(&artifact_value).unwrap());
        assert_eq!(artifact_value["status"], "partial_replay");
        assert_eq!(
            artifact_value["episodeReconstructionStrategy"],
            "eyes_complement"
        );
        assert_eq!(artifact_value["participants"].as_array().unwrap().len(), 1);
        assert!(!artifact_value["participants"][0]["evidence"]["fragments"]
            .as_array()
            .unwrap()
            .is_empty());

        let semantic_index = manifest
            .artifacts
            .iter()
            .position(|artifact| artifact.kind == "semantic-index-source-json")
            .unwrap();
        assert!(manifest.artifacts[semantic_index]
            .derived_from
            .contains(&artifact_metadata.digest));
        assert!(!manifest.artifacts[semantic_index].derived_from.is_empty());
        let semantic_source: Value =
            serde_json::from_slice(&full.take_artifact_bytes(semantic_index as u32).unwrap())
                .unwrap();
        let indexed_eyes: RuntimeEyesEvidenceSummary =
            serde_json::from_value(semantic_source["eyesEvidence"].clone()).unwrap();
        assert_eq!(indexed_eyes, manifest.eyes_evidence);
        assert!(!semantic_source.to_string().contains("P01"));

        let provenance = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "workflow-provenance-jsonld")
            .unwrap();
        assert!(provenance.derived_from.contains(&artifact_metadata.digest));

        let mut materialized_digests = manifest
            .artifacts
            .iter()
            .map(|artifact| artifact.digest.as_str())
            .collect::<BTreeSet<_>>();
        materialized_digests.extend(
            manifest
                .role_assignments
                .iter()
                .map(|assignment| assignment.artifact.digest.as_str()),
        );
        materialized_digests.insert(manifest.input.digest.as_str());
        for dependency in &artifact_metadata.derived_from {
            assert!(materialized_digests.contains(dependency.as_str()));
        }
        let mut review_request = request_value;
        review_request["requestId"] = Value::String("eyes-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(manifest.workspace_root_digest.clone());
        scientific_preflight_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let review = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let review_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review.manifest_json).unwrap();
        assert_eq!(review_manifest.eyes_evidence, manifest.eyes_evidence);
        assert!(!review.manifest_json.contains("\"fragments\""));
        assert!(!review.manifest_json.contains("P01"));
        assert!(review.artifact_count() >= 2);
    }

    /// Campaign-discovered (dependency-evidence run, warm influence case
    /// `influence:warm:enableSpssExport:active:catalog-random:true:false`):
    /// flipping an artifact-only wire field on a warm workspace changed the
    /// tracked `assemble_result_manifest` output digest with no changed bound
    /// input ("tracked query output changed without a changed bound input"),
    /// because scientific receipts bound a digest of the FULL exact options.
    /// The runtime now hands the kernel the computation projection — exact
    /// options minus `RUNTIME_ARTIFACT_REQUEST_FIELDS` — so a pure
    /// output-format toggle leaves every tracked query digest and input key
    /// byte-identical.
    #[test]
    fn artifact_only_option_flip_leaves_every_tracked_query_digest_unchanged() {
        let csv = csv();
        let mut active = request_for_workspace(&csv, 'e');
        active["options"]["usage_session_mode"] = Value::String("app_and_screen_usage".into());
        let cold_json = active.to_string();
        let support = RuntimeSupportFiles::default();
        scientific_preflight_native(&cold_json, &csv, &support).unwrap();
        let cold = execute_workspace_native(&cold_json, &csv, &support).unwrap();
        let cold_manifest: RuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();

        let mut flipped = active.clone();
        flipped["requestId"] = Value::String("artifact-only-flip".into());
        let previous_spss = flipped["options"]["enable_spss_export"]
            .as_bool()
            .unwrap_or(false);
        flipped["options"]["enable_spss_export"] = Value::Bool(!previous_spss);
        flipped["workspaceRootDigest"] = Value::String(cold_manifest.workspace_root_digest.clone());
        let flipped_json = flipped.to_string();
        scientific_preflight_native(&flipped_json, &csv, &support).unwrap();
        let warm = execute_workspace_native(&flipped_json, &csv, &support)
            .expect("artifact-only flip must not trip the binding-gap invariant");
        let warm_manifest: RuntimeManifest = serde_json::from_str(&warm.manifest_json).unwrap();

        let executions = |manifest: &RuntimeManifest| {
            manifest
                .query_executions
                .iter()
                .map(|execution| {
                    (
                        execution.query_id.clone(),
                        (execution.output_digest.clone(), execution.input_key.clone()),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        };
        assert_eq!(
            executions(&warm_manifest),
            executions(&cold_manifest),
            "an artifact-only option flip moved a tracked query digest or input key"
        );
    }

    /// `materialize_visualization_data` is derived in the browser from
    /// `enable_plotting || enable_interactive_timeline`, both artifact-only.
    /// It reached the computation projection because it is also a bound
    /// request field of `assemble_result_manifest` (it selects whether the
    /// visualization JSON is built), so drawing plots or not moved the
    /// `options_digest` inside B05/EYES receipts for the same measurement.
    #[test]
    fn visualization_materialization_flip_leaves_the_computation_options_digest_unchanged() {
        let csv = csv();
        let mut active = request_for_workspace(&csv, 'd');
        active["options"]["usage_session_mode"] = Value::String("app_and_screen_usage".into());
        active["options"]["enable_plotting"] = Value::Bool(true);
        active["options"]["enable_interactive_timeline"] = Value::Bool(false);
        active["options"]["materialize_visualization_data"] = Value::Bool(true);
        let with_json = active.to_string();
        let support = RuntimeSupportFiles::default();
        scientific_preflight_native(&with_json, &csv, &support).unwrap();
        let with = execute_workspace_native(&with_json, &csv, &support).unwrap();
        let with_manifest: RuntimeManifest = serde_json::from_str(&with.manifest_json).unwrap();

        let mut without = active.clone();
        without["requestId"] = Value::String("visualization-off".into());
        without["options"]["enable_plotting"] = Value::Bool(false);
        without["options"]["materialize_visualization_data"] = Value::Bool(false);
        without["workspaceRootDigest"] = Value::String(with_manifest.workspace_root_digest.clone());
        let without_json = without.to_string();
        scientific_preflight_native(&without_json, &csv, &support).unwrap();
        let without = execute_workspace_native(&without_json, &csv, &support).unwrap();
        let without_manifest: RuntimeManifest =
            serde_json::from_str(&without.manifest_json).unwrap();

        assert_ne!(
            with_manifest.options_digest, without_manifest.options_digest,
            "the full request identity must still distinguish the artifact set"
        );
        let receipt_digest = |manifest: &RuntimeManifest| {
            manifest
                .scientific_evidence
                .finalized_b05_schoedel
                .options_digest
                .clone()
        };
        assert_eq!(
            receipt_digest(&with_manifest),
            receipt_digest(&without_manifest),
            "drawing plots or not is not a different measurement"
        );

        // A computation option, by contrast, must move it.
        let mut floor = active.clone();
        floor["requestId"] = Value::String("floor-flip".into());
        floor["options"]["minimum_usage_duration"] = Value::from(61.0);
        floor["workspaceRootDigest"] = Value::String(with_manifest.workspace_root_digest.clone());
        let floor_json = floor.to_string();
        scientific_preflight_native(&floor_json, &csv, &support).unwrap();
        let floor = execute_workspace_native(&floor_json, &csv, &support).unwrap();
        let floor_manifest: RuntimeManifest = serde_json::from_str(&floor.manifest_json).unwrap();
        assert_ne!(
            receipt_digest(&floor_manifest),
            receipt_digest(&with_manifest)
        );
    }

    #[test]
    fn scientific_preflight_commit_is_one_shot_and_never_poisoned_into_inactive_runs() {
        let csv = eyes_csv();
        let workspace_id = format!("sha256:{}", "d".repeat(64));
        let mut active = request_for_workspace(&csv, 'd');
        active["options"]["episode_reconstruction_strategy"] =
            Value::String("eyes_complement".into());
        active["options"]["minimum_usage_duration"] = json!(0.0);
        let active_json = active.to_string();

        scientific_preflight_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        execute_workspace_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            assert!(states
                .borrow()
                .states
                .get(&workspace_id)
                .is_some_and(|state| state.pending_scientific_preflight.is_none()));
        });

        let execution_error = |result: Result<RuntimeHandle, String>| match result {
            Ok(_) => panic!("scientific execution unexpectedly succeeded"),
            Err(error) => error,
        };
        let missing_fresh_preflight = execution_error(execute_workspace_native(
            &active_json,
            &csv,
            &RuntimeSupportFiles::default(),
        ));
        assert!(missing_fresh_preflight.contains("scientific_preflight_retry_required"));

        scientific_preflight_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        let mut changed_active = active.clone();
        changed_active["requestId"] = Value::String("changed-active-after-preflight".into());
        changed_active["options"]["proximity_interval_ns"] = json!(3_000_000_000_i64);
        let changed_active_json = changed_active.to_string();
        let mismatch = execution_error(execute_workspace_native(
            &changed_active_json,
            &csv,
            &RuntimeSupportFiles::default(),
        ));
        assert!(mismatch.contains("scientific preflight"));
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            assert!(states
                .borrow()
                .states
                .get(&workspace_id)
                .is_some_and(|state| state.pending_scientific_preflight.is_none()));
        });
        assert!(execution_error(execute_workspace_native(
            &changed_active_json,
            &csv,
            &RuntimeSupportFiles::default(),
        ))
        .contains("scientific_preflight_retry_required"));
        scientific_preflight_native(&changed_active_json, &csv, &RuntimeSupportFiles::default())
            .unwrap();
        execute_workspace_native(&changed_active_json, &csv, &RuntimeSupportFiles::default())
            .unwrap();

        scientific_preflight_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        set_comparison_cache_capacity(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES);
        assert!(execution_error(execute_workspace_native(
            &active_json,
            &csv,
            &RuntimeSupportFiles::default(),
        ))
        .contains("scientific_preflight_retry_required"));

        let mut inactive = active.clone();
        inactive["requestId"] = Value::String("inactive-after-eyes".into());
        inactive["options"]["episode_reconstruction_strategy"] =
            Value::String("fused_matcher".into());
        execute_workspace_native(&inactive.to_string(), &csv, &RuntimeSupportFiles::default())
            .expect("an inactive request must not consume stale active partition state");

        scientific_preflight_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        execute_workspace_native(&active_json, &csv, &RuntimeSupportFiles::default()).unwrap();
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            assert!(states
                .borrow()
                .states
                .get(&workspace_id)
                .is_some_and(|state| state.pending_scientific_preflight.is_none()));
        });
    }

    #[test]
    fn eyes_evidence_tamper_is_rejected_and_receipt_identity_is_provenance_only() {
        let csv = eyes_csv();
        let (request, result) = direct_eyes_pipeline_result(&csv, true);
        assert!(!result.eyes_tagged_fau_evidence.is_empty());
        assert!(!result.aggregate_csv_outputs.is_empty());
        let original_app = result.app_csv_bytes.clone();
        let original_aggregates = result
            .aggregate_csv_outputs
            .iter()
            .map(|aggregate| (aggregate.kind.clone(), aggregate.bytes.clone()))
            .collect::<Vec<_>>();
        let original_evidence = build_runtime_eyes_evidence(&result, &request.options).unwrap();
        let original_digests = pipeline_result_digests(&result, &original_evidence.summary);

        let mut changed = result.clone();
        changed.eyes_tagged_fau_evidence[0]
            .evidence
            .receipt
            .pickup_export_row_count += 1;
        assert!(build_runtime_eyes_evidence(&changed, &request.options).is_err());
        let mut changed_summary = original_evidence.summary.clone();
        changed_summary
            .validation_receipt
            .as_mut()
            .unwrap()
            .participant_count += 1;
        changed_summary.validation_receipt_artifact_digest =
            Some(format!("sha256:{}", "f".repeat(64)));
        let changed_digests = pipeline_result_digests(&result, &changed_summary);

        assert_eq!(changed.app_csv_bytes, original_app);
        assert_eq!(
            changed.aggregate_csv_outputs.len(),
            original_aggregates.len()
        );
        for (aggregate, (kind, bytes)) in result
            .aggregate_csv_outputs
            .iter()
            .zip(&original_aggregates)
        {
            assert_eq!(&aggregate.kind, kind);
            assert_eq!(&aggregate.bytes, bytes);
        }
        assert_eq!(
            original_digests.published_outputs_digest, changed_digests.published_outputs_digest,
            "evidence-only state must not alter headline or aggregate byte identity"
        );
        assert_ne!(
            original_digests.provenance_digest, changed_digests.provenance_digest,
            "the provenance digest must commit changed evidence"
        );
        assert_eq!(
            original_evidence.summary.tagged_fau_artifact_digest,
            changed_summary.tagged_fau_artifact_digest
        );
    }

    #[test]
    fn eyes_receipts_must_agree_with_the_request_and_each_other() {
        let csv = eyes_csv();
        let (request, result) = direct_eyes_pipeline_result(&csv, false);

        let mut stale_options = request.options.clone();
        stale_options.proximity_interval_ns += 1_000_000_000;
        // fe3ec9b replaced the field-by-field receipt comparison (which named
        // proximity specifically) with the computation-options digest bound
        // into the result context: any computation-option divergence,
        // proximity included, now fails as a context mismatch.
        assert_eq!(
            build_runtime_eyes_evidence(&result, &stale_options)
                .err()
                .unwrap(),
            "eyes_tagged_fau_validation_error:result_context_mismatch"
        );

        let mut disagreeing = result.clone();
        let mut second = disagreeing.eyes_tagged_fau_evidence[0].clone();
        second.participant_id = "P02".into();
        second.evidence.receipt.effective_options.block_glue_seconds += 1.0;
        disagreeing.eyes_tagged_fau_evidence.push(second);
        // fe3ec9b replaced the pairwise participant comparison with a
        // per-participant identity check: every receipt's effective options
        // must equal the request-derived options directly
        // (eyes_complement::validate_tagged_fau_receipt), so the disagreeing
        // participant fails receipt identity.
        assert_eq!(
            build_runtime_eyes_evidence(&disagreeing, &request.options)
                .err()
                .unwrap(),
            "eyes_tagged_fau_validation_error:receipt_identity"
        );
    }

    #[test]
    fn review_query_returns_review_summary_and_scientific_evidence_matching_full_execution() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut review_request = request_for_workspace(&csv, 'b');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let mut review = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let review_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review.manifest_json).unwrap();
        assert_eq!(review_manifest.command, QUERY_REVIEW_COMMAND);
        assert_eq!(
            review_manifest.query_executions.len(),
            WORKFLOW_QUERIES.len()
        );
        assert_eq!(
            review.artifact_count(),
            u32::try_from(review_manifest.artifacts.len()).unwrap()
        );
        let review_metadata = (0..review.artifact_count())
            .map(|index| {
                serde_json::from_str::<RuntimeArtifactMetadata>(
                    &review.artifact_metadata_json(index).unwrap(),
                )
                .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(&review_metadata).unwrap(),
            serde_json::to_value(&review_manifest.artifacts).unwrap()
        );
        let summary_index = review_metadata
            .iter()
            .position(|metadata| metadata.kind == "review-summary-json")
            .expect("review summary artifact");
        let scientific_digests =
            scientific_evidence_artifact_digests(&review_manifest.scientific_evidence);
        assert!(!scientific_digests.is_empty());
        assert_eq!(
            review_metadata
                .iter()
                .filter(|metadata| metadata.kind != "review-summary-json")
                .map(|metadata| metadata.digest.as_str())
                .collect::<BTreeSet<_>>(),
            scientific_digests
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
        );
        let review_bytes = review
            .take_artifact_bytes(u32::try_from(summary_index).unwrap())
            .unwrap();
        assert_eq!(sha256(&review_bytes), review_manifest.review_summary_digest);
        assert_eq!(stable_artifact_generation_count(), 0);

        let full_request = request_for_workspace(&csv, 'f');
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let full_review_bytes = (0..full.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "review-summary-json")
                    .then(|| full.take_artifact_bytes(index).unwrap())
            })
            .expect("full execution review summary");
        assert_eq!(review_bytes, full_review_bytes);
        assert_eq!(stable_artifact_generation_count(), 1);
    }

    /// A review never materializes artifacts, so it is the only command whose
    /// query-group projection is served from the previous run's cache when a
    /// stage's inputs did not change. That cache is only sound if the stage
    /// view it serves is the one a cold review of the same options reports —
    /// the workflow explorer view is the evidence a researcher reads to see which part of
    /// the pipeline an option touched, and a stale entry there is a false
    /// claim about the run. Status and reason differ by construction (a warm
    /// run reports what it reused); identity, key and output must not.
    #[test]
    fn a_warm_review_after_an_option_edit_projects_the_stages_a_cold_review_reports() {
        reset_tracked_execution_count();
        // The plain `csv()` fixture carries only unrecognized interaction
        // types, so it produces no sessions and no duration option can move
        // its output. This fixture has two 60 s Resumed/Paused pairs.
        let csv = mixed_timezone_csv();
        let support = RuntimeSupportFiles::default();

        let mut first_request = request_for_workspace(&csv, '3');
        first_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let first = execute_workspace_native(&first_request.to_string(), &csv, &support).unwrap();
        let first: ReviewRuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();

        // 90 s raises the floor above both 60 s sessions in the fixture, so the
        // edit moves the summary as well as the keys. An edit that only moved
        // keys would leave a stale cached stage output indistinguishable from a
        // fresh one.
        let mut edited_request = first_request.clone();
        edited_request["requestId"] = Value::String("warm-review-after-edit".into());
        edited_request["options"]["minimum_usage_duration"] = serde_json::json!(90.0);
        let warm = execute_workspace_native(&edited_request.to_string(), &csv, &support).unwrap();
        let warm: ReviewRuntimeManifest = serde_json::from_str(&warm.manifest_json).unwrap();

        let mut cold_request = request_for_workspace(&csv, '4');
        cold_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        cold_request["requestId"] = Value::String("cold-review-oracle".into());
        cold_request["options"]["minimum_usage_duration"] = serde_json::json!(90.0);
        let cold = execute_workspace_native(&cold_request.to_string(), &csv, &support).unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();

        assert!(
            warm.query_group_executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Cached),
            "the warm review recomputed every stage, so it never exercised the projection cache"
        );
        assert_ne!(
            warm.review_summary_digest, first.review_summary_digest,
            "the option edit left the review summary unchanged, so a stale stage output would be invisible"
        );
        assert_eq!(warm.review_summary_digest, cold.review_summary_digest);

        // Steps first: a query's bound-input key is the primitive fact, and a
        // stage key is built from its members', so a query disagreement is the
        // smaller and more exact report.
        fn query_identity(executions: &[RuntimeQueryExecution]) -> Vec<(&str, &str, &str, &str)> {
            executions
                .iter()
                .map(|execution| {
                    (
                        execution.query_id.as_str(),
                        execution.query_group_id.as_str(),
                        execution.input_key.as_str(),
                        execution.output_digest.as_str(),
                    )
                })
                .collect::<Vec<_>>()
        }
        let warm_queries = query_identity(&warm.query_executions);
        let cold_queries = query_identity(&cold.query_executions);
        let disagreeing_queries = warm_queries
            .iter()
            .zip(cold_queries.iter())
            .filter(|(warm_step, cold_step)| warm_step != cold_step)
            .collect::<Vec<_>>();
        assert_eq!(
            warm_queries.len(),
            cold_queries.len(),
            "a warm review reported a different number of queries than a cold review"
        );
        assert!(
            disagreeing_queries.is_empty(),
            "a warm review reported query bindings a cold review of the same options does not: {disagreeing_queries:#?}"
        );

        type StageIdentity<'a> = (&'a str, &'a str, &'a str, Option<(&'a str, &'a str, u64)>);
        fn stage_identity(executions: &[QueryGroupExecution]) -> Vec<StageIdentity<'_>> {
            executions
                .iter()
                .map(|execution| {
                    (
                        execution.query_group_id.as_str(),
                        execution.capability_id.as_str(),
                        execution.input_key.as_str(),
                        execution.output.as_ref().map(|output| {
                            (
                                output.artifact_id.as_str(),
                                output.digest.as_str(),
                                output.size,
                            )
                        }),
                    )
                })
                .collect::<Vec<_>>()
        }
        let warm_stages = stage_identity(&warm.query_group_executions);
        let cold_stages = stage_identity(&cold.query_group_executions);
        let disagreeing_stages = warm_stages
            .iter()
            .zip(cold_stages.iter())
            .filter(|(warm_stage, cold_stage)| warm_stage != cold_stage)
            .collect::<Vec<_>>();
        assert_eq!(
            warm_stages.len(),
            cold_stages.len(),
            "a warm review reported a different number of query groups than a cold review"
        );
        assert!(
            disagreeing_stages.is_empty(),
            "a warm review projected query groups a cold review of the same options does not: {disagreeing_stages:#?}"
        );
    }

    #[test]
    fn review_reuses_client_summary_when_known_digest_matches() {
        let csv = csv();
        let mut review_request = request_for_workspace(&csv, 'e');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        let mut first = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&first.manifest_json).unwrap();
        assert!(!first_manifest.review_summary_reused);
        assert_eq!(
            first.artifact_count(),
            u32::try_from(first_manifest.artifacts.len()).unwrap()
        );
        let summary_index = first_manifest
            .artifacts
            .iter()
            .position(|metadata| metadata.kind == "review-summary-json")
            .expect("cold review summary artifact");
        let first_scientific_metadata = first_manifest
            .artifacts
            .iter()
            .filter(|metadata| metadata.kind != "review-summary-json")
            .cloned()
            .collect::<Vec<_>>();
        assert!(!first_scientific_metadata.is_empty());
        let first_bytes = first
            .take_artifact_bytes(u32::try_from(summary_index).unwrap())
            .unwrap();
        assert_eq!(sha256(&first_bytes), first_manifest.review_summary_digest);

        // Same options + the digest the client already holds: only the summary
        // bytes are omitted. Independently content-addressed scientific
        // evidence remains exposed and authenticated by the review manifest.
        let mut repeat = review_request.clone();
        repeat["knownReviewSummaryDigests"] = serde_json::json!([
            format!("sha256:{}", "1".repeat(64)),
            first_manifest.review_summary_digest.clone(),
        ]);
        let reused =
            execute_workspace_native(&repeat.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let reused_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&reused.manifest_json).unwrap();
        assert!(reused_manifest.review_summary_reused);
        assert_eq!(
            reused.artifact_count(),
            u32::try_from(first_scientific_metadata.len()).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&reused_manifest.artifacts).unwrap(),
            serde_json::to_value(&first_scientific_metadata).unwrap()
        );
        assert!(reused_manifest
            .artifacts
            .iter()
            .all(|metadata| metadata.kind != "review-summary-json"));
        assert_eq!(
            reused_manifest.review_summary_digest,
            first_manifest.review_summary_digest
        );

        // A stale digest must still receive the real bytes.
        let mut stale = review_request.clone();
        stale["knownReviewSummaryDigests"] =
            serde_json::json!([format!("sha256:{}", "0".repeat(64))]);
        let mut fresh =
            execute_workspace_native(&stale.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let fresh_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&fresh.manifest_json).unwrap();
        assert!(!fresh_manifest.review_summary_reused);
        assert_eq!(
            fresh.artifact_count(),
            u32::try_from(fresh_manifest.artifacts.len()).unwrap()
        );
        let fresh_summary_index = fresh_manifest
            .artifacts
            .iter()
            .position(|metadata| metadata.kind == "review-summary-json")
            .expect("fresh review summary artifact");
        assert_eq!(
            fresh
                .take_artifact_bytes(u32::try_from(fresh_summary_index).unwrap())
                .unwrap(),
            first_bytes
        );
    }

    /// Warm interactive-loop attribution through the FULL runtime envelope
    /// (request parse -> ingress -> cache decision -> engine -> manifest) on a
    /// real raw export, mirroring the view tab's repeated settings edits:
    ///   CHRONICLE_ATTR_CSV=/path/to/raw.csv \
    ///   cargo test --release --features query-timing \
    ///     warm_review_repeat_attribution_from_csv -- --ignored --nocapture
    #[test]
    #[ignore]
    fn warm_review_repeat_attribution_from_csv() {
        let path = std::env::var("CHRONICLE_ATTR_CSV")
            .expect("set CHRONICLE_ATTR_CSV to a raw Chronicle export");
        let csv = std::fs::read(&path).expect("read CHRONICLE_ATTR_CSV");
        let mut review_request = request_for_workspace(&csv, 'c');
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        review_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        review_request["options"]["minimum_usage_duration"] = serde_json::json!(60.0);
        eprintln!(
            "attribution_phase=warm_build file={path} bytes={}",
            csv.len()
        );
        let started = std::time::Instant::now();
        let mut first = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: Value = serde_json::from_str(&first.manifest_json).unwrap();
        eprintln!(
            "attribution_total warm_build_ms={:.1} review_summary_bytes={} cache_decision={} cache_sources={}",
            started.elapsed().as_secs_f64() * 1000.0,
            first.take_artifact_bytes(0).unwrap().len(),
            manifest["dependency_cache_decision"]["mode"],
            manifest["cache_sources"],
        );
        for (case, key, values) in [
            (
                "narrow_minimum_usage_duration",
                "minimum_usage_duration",
                vec![
                    serde_json::json!(2.0),
                    serde_json::json!(3.0),
                    serde_json::json!(4.0),
                ],
            ),
            (
                "heavy_concurrent_usage_toggle",
                "model_concurrent_usage",
                vec![Value::Bool(false), Value::Bool(true), Value::Bool(false)],
            ),
        ] {
            for (step, value) in values.into_iter().enumerate() {
                let mut repeat = review_request.clone();
                repeat["options"][key] = value;
                eprintln!("attribution_phase=warm_repeat case={case} step={step}");
                let started = std::time::Instant::now();
                execute_workspace_native(
                    &repeat.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                eprintln!(
                    "attribution_total case={case} warm_repeat_step={step} total_ms={:.1}",
                    started.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
    }

    #[test]
    fn correspondence_predicates_keep_outputs_and_traces_exact() {
        assert!(is_researcher_output_kind("app-csv"));
        assert!(is_researcher_output_kind("aggregate-daily-csv"));
        assert!(!is_researcher_output_kind("workflow-explorer-view-json"));

        let plan = embedded_plan();
        let assignment = RoleAssignment {
            assignment_id: "assignment-raw".into(),
            role_id: "raw_chronicle_csv".into(),
            artifact: chronicle_preprocessing_semantic_adapter::ArtifactRef {
                artifact_id: "artifact-raw".into(),
                digest: format!("sha256:{}", "a".repeat(64)),
                media_type: "text/csv".into(),
                size: 1,
                derived_from: Vec::new(),
                qualifiers: BTreeMap::new(),
            },
            qualifiers: BTreeMap::new(),
            revision: 1,
        };
        let assignments = BTreeMap::from([(assignment.role_id.clone(), assignment.clone())]);
        let mut materialization =
            chronicle_preprocessing_semantic_adapter::evaluate_materialization(
                plan,
                &assignments,
                &serde_json::json!({}),
                &BTreeSet::new(),
                &BTreeSet::new(),
            );
        let mut mismatched = materialization
            .qualification_traces
            .first()
            .expect("raw qualification trace")
            .clone();
        mismatched.selected_role_id = Some("processing_options".into());
        materialization.qualification_traces = vec![mismatched];

        let index: Value = serde_json::from_slice(
            &build_correspondence_index(CorrespondenceIndexInputs {
                plan,
                assignments: &assignments,
                materialization: &materialization,
                query_group_executions: &[],
                options: &serde_json::json!({}),
                artifacts: &[],
                checkpoints: &BTreeMap::new(),
                query_checkpoints: &BTreeMap::new(),
            })
            .unwrap(),
        )
        .unwrap();
        let qualified = index["edges"]
            .as_array()
            .unwrap()
            .iter()
            .find(|edge| edge["relation"] == "qualified-as")
            .expect("qualified-as edge");
        assert!(
            qualified["evidenceIds"].as_array().unwrap().is_empty(),
            "a trace matching only the candidate, not the selected role, is not evidence"
        );
    }

    #[test]
    fn pre_run_workflow_explorer_view_is_rust_owned_complete_and_has_no_fake_execution() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let explorer_request = serde_json::json!({
            "options": request_value["options"],
            "supportRoles": [],
        });
        let view: Value = serde_json::from_str(
            &plan_workflow_explorer_view_native(&explorer_request.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(view["viewId"], "chronicle-workflow-explorer/v1");
        assert_eq!(view["revision"], 0);
        assert!(!view["phases"].as_array().unwrap().is_empty());
        assert!(!view["operations"].as_array().unwrap().is_empty());
        assert!(!view["artifacts"].as_array().unwrap().is_empty());
        assert!(!view["queries"].as_array().unwrap().is_empty());
        assert!(view["queries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|query| query["physicalState"] == "not_observed"));
        assert!(view["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation["runState"] == "not_applicable"));
        assert!(view["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation["runState"] == "not_observed"));
        // The default request is an app-usage run with the app table on: its
        // builder is applicable. Its rule reads exact request fields, which
        // the certified projection alone does not carry.
        let app_table = view["operations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|operation| operation["operationId"] == "publish.project_app_table")
            .expect("app table operation");
        assert_ne!(app_table["runState"], "not_applicable");
        let filter_impact = view["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|impact| impact["inputId"] == "use_filter_file")
            .expect("filter decision impact");
        // `assemble_result_manifest` declares nearly the full option set since
        // the B03-B05 source freeze (fe3ec9b): the manifest reconstructs the
        // exact options, so `use_filter_file` is a declared direct read there
        // as well as at the early matcher and post-reconstruction application
        // policy, which consumes parsed_filter_rules for label matching.
        // The dependency-evidence campaign verifies observed Salsa reads.
        assert_eq!(
            filter_impact["directQueryIds"],
            serde_json::json!([
                "apply_app_inclusion_policy",
                "assemble_result_manifest",
                "mark_app_policy_matches"
            ])
        );
        let affected = filter_impact["affectedOperationIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>();
        assert!(affected.contains("policy.match_app_exclusion_rows"));
        assert!(!affected.contains("reconstruct.infer_screen_session_skeletons"));
        assert!(!affected.contains("reconstruct.index_app_events"));
        assert!(!affected.contains("reconstruct.match_app_episodes"));

        let parquet_impact = view["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|impact| impact["inputId"] == "enable_parquet_export")
            .expect("runtime encoder decision impact");
        assert!(parquet_impact["directQueryIds"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(parquet_impact["affectedOperationIds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation == "publish.encode_selected_formats"));
    }

    #[test]
    fn workflow_applicability_and_explorer_projection_are_exact() {
        let options = serde_json::json!({
            "enabled": true,
            "disabled": false,
            "mode": "app",
            "items": [1],
            "emptyItems": [],
            "text": "value",
            "blank": "",
        });
        let supports = BTreeSet::from(["filter_file"]);
        let cases = [
            (ApplicabilityExpression::Always, true),
            (
                ApplicabilityExpression::OptionTrue {
                    option_key: "enabled",
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionTrue {
                    option_key: "disabled",
                },
                false,
            ),
            (
                ApplicabilityExpression::OptionBooleanEquals {
                    option_key: "disabled",
                    value: false,
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionBooleanEquals {
                    option_key: "enabled",
                    value: false,
                },
                false,
            ),
            (
                ApplicabilityExpression::OptionStringEquals {
                    option_key: "mode",
                    value: "app",
                },
                true,
            ),
            (
                ApplicabilityExpression::OptionStringEquals {
                    option_key: "mode",
                    value: "screen",
                },
                false,
            ),
            (
                ApplicabilityExpression::ArrayNonempty {
                    option_key: "items",
                },
                true,
            ),
            (
                ApplicabilityExpression::ArrayNonempty {
                    option_key: "emptyItems",
                },
                false,
            ),
            (
                ApplicabilityExpression::StringNonempty { option_key: "text" },
                true,
            ),
            (
                ApplicabilityExpression::StringNonempty {
                    option_key: "blank",
                },
                false,
            ),
            (
                ApplicabilityExpression::SupportPresent {
                    role_id: "filter_file",
                },
                true,
            ),
            (
                ApplicabilityExpression::SupportPresent {
                    role_id: "study_dates_file",
                },
                false,
            ),
            (
                ApplicabilityExpression::All {
                    terms: vec![
                        ApplicabilityExpression::Always,
                        ApplicabilityExpression::OptionTrue {
                            option_key: "enabled",
                        },
                    ],
                },
                true,
            ),
            (
                ApplicabilityExpression::Any {
                    terms: vec![
                        ApplicabilityExpression::OptionTrue {
                            option_key: "disabled",
                        },
                        ApplicabilityExpression::SupportPresent {
                            role_id: "filter_file",
                        },
                    ],
                },
                true,
            ),
            (
                ApplicabilityExpression::Not {
                    term: Box::new(ApplicabilityExpression::OptionTrue {
                        option_key: "disabled",
                    }),
                },
                true,
            ),
        ];
        for (expression, expected) in cases {
            assert_eq!(
                evaluate_workflow_applicability(&expression, &options, &supports),
                expected,
                "{expression:?}",
            );
        }
        let always = ApplicabilityExpression::Always;
        let disabled = ApplicabilityExpression::OptionTrue {
            option_key: "disabled",
        };
        let phase_operations = [("other", &always), ("target", &disabled)];
        assert!(!workflow_phase_applicable(
            "target",
            phase_operations,
            &options,
            &supports,
        ));
        let enabled = ApplicabilityExpression::OptionTrue {
            option_key: "enabled",
        };
        assert!(workflow_phase_applicable(
            "target",
            [("target", &enabled)],
            &options,
            &supports,
        ));
        assert!(is_workflow_support_role("raw_chronicle_csv"));
        assert!(!is_workflow_support_role("processing_options"));

        let csv = csv();
        let request_value = request_for_workspace(&csv, '1');
        let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
        let statuses = [
            ExecutionStatus::Recomputed,
            ExecutionStatus::Cached,
            ExecutionStatus::Skipped,
            ExecutionStatus::Bypassed,
            ExecutionStatus::Error,
        ];
        let executions = contract
            .execution
            .queries
            .iter()
            .enumerate()
            .map(|(index, query)| RuntimeQueryExecution {
                query_id: query.id.into(),
                query_group_id: query.group.into(),
                status: statuses[index % statuses.len()],
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        let view = build_workflow_explorer_view(
            &WorkflowExplorerRequest {
                options: request_value["options"].clone(),
                support_roles: vec![WorkflowExplorerSupportRole {
                    role_id: "filter_file".into(),
                    present: true,
                    digest: Some(format!("sha256:{}", "4".repeat(64))),
                }],
                selected_run_root: None,
            },
            &executions,
            99,
            Some(&format!("sha256:{}", "a".repeat(64))),
        )
        .unwrap();
        let bytes = serde_jcs::to_vec(&view).unwrap();
        // Change-detector over the projected workflow contract.
        // Re-recorded 2026-08-13 for the B03-B05 contract expansion (fe3ec9b)
        // plus the review-summary non-row cell bindings (49b0dd2), and again
        // 2026-08-17 for the B06 maximum-duration request fields, row fields,
        // output columns and the policy.apply_maximum_duration operation, and
        // again 2026-08-19 for the B07 screen_gating_rule request field and the
        // credit.intersect_evidence read of it, and again 2026-08-20 for the
        // B14 divide_sessions_at_day_boundary query and its
        // day_boundary_attribution read, and again 2026-08-22 for the
        // assign_usage_session_ids query and its session_grouping_policy read
        // (issue #4), and again 2026-08-22 for the two
        // derive_engagement_basis reads of raw_episode_start_timestamp_ns /
        // raw_episode_stop_timestamp_ns that the filtered-row engagement fix
        // added, and again 2026-08-22 for the B10 package_exclusion_preset
        // request field and the mark_app_policy_matches reads of
        // filter_file.app_filter_category / filter_file.filter_bool that it
        // makes live, and again 2026-08-22 for the four B08 notification-proxy
        // queries, their notification_proxy_rule request field and the
        // not-the-default applicability that lets them bypass, and again
        // 2026-08-24 for the participant-amount-summary contract expansion
        // (the publish.build_participant_amount_summary operation, its
        // enable_participant_amount_summary request field and gated
        // applicability) alongside the Peng & Zhu session-grouping arm; the
        // view builder itself was unchanged from #96 until 2026-09-19, when
        // applicability began to be evaluated against the exact request fields
        // as well as the certified keys: the app, screen and credited table
        // builders, the participant summary and the visualization data had
        // been projected "not applicable" for every options value. Refreshed
        // 2026-09-04 (literature branch) for the reviewed application-label,
        // screen-policy and source-order contract additions; structured
        // activation assertions remain above.
        // Refreshed 2026-09-28 for the actual classify_screen_session read of
        // screen_interval_id; only its mirror-derived contract digests changed.
        // Refreshed 2026-09-30 for the merged output-only timestamp,
        // background-app and study-window dependency mirrors and main's
        // exact serialized-option projection before certified applicability.
        // Refreshed 2026-10-02 for interval-wide screen_usage_app_observed
        // replacing latest-package reads in the classification contract.
        // Main re-recorded it 2026-09-29 when bind_processing_timestamp moved to
        // the outputs group and 2026-10-01 for the Culverhouse reads of
        // suppress_excluded_timing; refreshed 2026-10-02 again for the merge of
        // main #50-#53 with the interval-wide app evidence.
        // Refreshed 2026-10-03 for the opt-in neutralize_spreadsheet_formulas
        // option: its outputs-group tunes edge, its assemble_result_manifest and
        // publish.commit_workspace_bundle request field, and the contract digests
        // that move with them.
        // Refreshed 2026-10-09 for the seven Blue Light codebook field reads
        // (app_codebook_file.bluelight_play_store_*) in the workflow contract.
        // Refreshed 2026-10-09 for contract v6: the study-window step's
        // "clean" section, the 0 s minimum-usage default and the
        // Non-Target Participant App Usage label.
        // Refreshed 2026-10-09 for the opt-in bridge_screen_off_to_session_end
        // option: its credit tunes edge, its derive_credited_intervals and
        // assemble_result_manifest request field, and the contract digests
        // that move with them.
        assert_eq!(
            sha256(&bytes),
            "sha256:090b6d8473b2c8b34cee60516a167701bc220efb58492321e34f284360cd31da"
        );
    }

    #[test]
    fn workflow_support_roles_exclude_literature_only_artifacts() {
        assert!(is_workflow_support_role("raw_chronicle_csv"));
        assert!(!is_workflow_support_role("processing_options"));
        assert!(!is_workflow_support_role("analysis_feature_matrix_file"));
        assert!(!is_workflow_support_role("call_sms_eligibility_file"));
        assert!(!is_workflow_support_role(
            "phonestudy_ps_communication_file"
        ));
        assert!(!is_workflow_support_role("phonestudy_es_file"));
        assert!(!is_workflow_support_role("anchor_events_file"));
    }

    fn assert_sha256_identity(value: &str) {
        let hexadecimal = value.strip_prefix("sha256:").expect("sha256 prefix");
        assert_eq!(hexadecimal.len(), 64);
        assert!(hexadecimal.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    fn csv() -> Vec<u8> {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago"
        )
        .as_bytes()
        .to_vec()
    }

    fn eyes_csv() -> Vec<u8> {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Stopped,com.example.chat,2026-03-07 10:01:01,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Resumed,com.example.other,2026-03-07 10:02:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Paused,com.example.other,2026-03-07 10:03:00,America/Chicago\n",
            "Study,P01,Target Child,Other,Activity Stopped,com.example.other,2026-03-07 10:03:01,America/Chicago"
        )
        .as_bytes()
        .to_vec()
    }

    /// Existing mixed-timezone synthetic fixture shared by the runtime's
    /// transition and selected-filter tests so they cannot drift apart.
    fn mixed_timezone_csv() -> Vec<u8> {
        concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec()
    }

    fn representative_600_event_csv() -> Vec<u8> {
        let mut csv = String::from(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        );
        for index in 0..600 {
            let hour = index / 60;
            let minute = index % 60;
            let interaction = if index % 2 == 0 {
                "Activity Resumed"
            } else {
                "Activity Paused"
            };
            csv.push_str(&format!(
                "Study,P01,Target Child,Chat,{interaction},com.example.chat,2026-03-07 {hour:02}:{minute:02}:00,America/Chicago\n"
            ));
        }
        csv.into_bytes()
    }

    #[test]
    fn representative_result_cell_index_has_a_bounded_storage_ratio() {
        let csv = representative_600_event_csv();
        let handle =
            execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let cell_index = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap();
        let source_index = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-coordinate-index-arrow")
            .unwrap();
        let influence = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-result-influence-arrow")
            .unwrap();
        let canonical_bytes = manifest
            .artifacts
            .iter()
            .filter(|artifact| is_canonical_cell_output_kind(&artifact.kind))
            .map(|artifact| artifact.size)
            .sum::<u64>();
        assert!(cell_index.row_count.unwrap() > manifest.counts.app);
        assert!(influence.row_count.unwrap() > manifest.counts.original);
        assert!(
            cell_index.size <= canonical_bytes.saturating_mul(3) + 65_536,
            "cell index {} bytes exceeded bounded ratio for {} canonical bytes",
            cell_index.size,
            canonical_bytes,
        );
        assert!(
            influence.size <= canonical_bytes + 65_536,
            "normalized influence witness {} bytes exceeded bounded ratio for {} canonical bytes",
            influence.size,
            canonical_bytes,
        );
        eprintln!(
            "representative-result-cell-index input_rows={} app_rows={} source_rows={} cell_rows={} witness_rows={} canonical_bytes={} source_index_bytes={} cell_index_bytes={} witness_bytes={} cell_ratio={:.3} witness_to_index_ratio={:.3}",
            manifest.counts.original,
            manifest.counts.app,
            source_index.row_count.unwrap(),
            cell_index.row_count.unwrap(),
            influence.row_count.unwrap(),
            canonical_bytes,
            source_index.size,
            cell_index.size,
            influence.size,
            cell_index.size as f64 / canonical_bytes as f64,
            influence.size as f64 / (source_index.size + cell_index.size) as f64,
        );
    }

    #[test]
    fn one_call_runtime_returns_verified_artifacts_materialization_and_root() {
        let csv = csv();
        let mut handle =
            execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.request_id, "req-1");
        assert_eq!(manifest.implementation_digest, IMPLEMENTATION_BUILD_DIGEST);
        assert_eq!(implementation_build_digest(), IMPLEMENTATION_BUILD_DIGEST);
        assert!(IMPLEMENTATION_BUILD_DIGEST.starts_with("sha256:"));
        assert_eq!(IMPLEMENTATION_BUILD_DIGEST.len(), 71);
        assert_eq!(manifest.plan_digest, EMBEDDED_PLAN_SHA256);
        assert_eq!(
            manifest.dependency_certificate_digest,
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256
        );
        assert_eq!(
            manifest.dependency_cache_decision.mode,
            if dependency_evidence_current(embedded_dependency_certificate()) {
                chronicle_preprocessing_semantic_adapter::DependencyCacheMode::CertifiedNarrow
            } else {
                chronicle_preprocessing_semantic_adapter::DependencyCacheMode::ConservativeFull
            }
        );
        if dependency_evidence_current(embedded_dependency_certificate()) {
            assert!(manifest
                .dependency_cache_decision
                .reasons
                .contains(&"dependency_surface_structurally_certified".into()));
        } else {
            assert!(manifest
                .dependency_cache_decision
                .reasons
                .contains(&"empirical_dependency_evidence_stale_release_blocking".into()));
        }
        assert_eq!(
            manifest.product_contract_digest,
            EMBEDDED_PRODUCT_CONTRACT_SHA256
        );
        assert_eq!(manifest.build_environment_digest, BUILD_ENVIRONMENT_DIGEST);
        assert_eq!(manifest.query_executions.len(), WORKFLOW_QUERIES.len());
        assert_eq!(
            manifest
                .query_executions
                .iter()
                .map(|execution| execution.query_id.as_str())
                .collect::<BTreeSet<_>>(),
            WORKFLOW_QUERIES
                .iter()
                .map(|step| step.id)
                .collect::<BTreeSet<_>>()
        );
        assert!(manifest.query_executions.iter().all(|execution| {
            manifest
                .processing_summary
                .workflow_query_digests
                .get(&execution.query_id)
                == Some(&execution.output_digest)
        }));
        assert_eq!(manifest.counts.original, 2);
        assert_eq!(manifest.counts.processed, 2);
        assert_eq!(manifest.counts.app, 1);
        assert!(manifest.workspace_root_digest.starts_with("sha256:"));
        assert_eq!(manifest.role_assignments.len(), 2);
        assert_eq!(manifest.qualification_traces.len(), 2);
        assert!(manifest
            .qualification_traces
            .iter()
            .all(|trace| trace.decision
                == chronicle_preprocessing_semantic_adapter::QualificationDecision::Accepted));
        assert_eq!(
            manifest.requirement_traces.len(),
            embedded_plan().root_roles.len()
        );
        assert_eq!(
            manifest
                .role_assignments
                .iter()
                .map(|assignment| assignment.revision)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        for assignment in &manifest.role_assignments {
            assert_sha256_identity(&assignment.assignment_id);
        }
        assert_eq!(
            manifest.query_group_executions.len(),
            embedded_plan().query_groups.len()
        );
        for execution in &manifest.query_group_executions {
            assert_sha256_identity(&execution.reason_id);
        }
        assert!(manifest
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "dependency-certificate-json"
                && artifact.digest == EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256));
        assert!(is_researcher_output_kind("app-csv"));
        assert!(is_researcher_output_kind("aggregate-daily-summary-csv"));
        assert!(!is_researcher_output_kind("workspace-root-json"));
        let correspondence_artifact = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "correspondence-index-json")
            .unwrap();
        assert!(manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                artifact.kind.starts_with("node-output:")
                    || is_researcher_output_kind(&artifact.kind)
            })
            .all(|artifact| correspondence_artifact
                .derived_from
                .contains(&artifact.digest)));
        let dependency_kinds = manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                correspondence_artifact
                    .derived_from
                    .contains(&artifact.digest)
            })
            .map(|artifact| artifact.kind.as_str())
            .collect::<BTreeSet<_>>();
        assert!(dependency_kinds.contains("node-output:outputs"));
        assert!(dependency_kinds.contains("app-csv"));
        assert!(dependency_kinds.contains("source-coordinate-index-arrow"));
        assert!(dependency_kinds.contains("result-cell-correspondence-arrow"));
        assert!(dependency_kinds.contains("source-result-influence-arrow"));
        assert!(!dependency_kinds.contains("workflow-explorer-view-json"));
        assert!(manifest.open_obligations.is_empty());
        assert!(manifest.state_reasons.iter().any(|reason| {
            reason.subject_id == "outputs" && reason.state == MaterializationState::Satisfied
        }));
        let assignment_digests = manifest
            .role_assignments
            .iter()
            .map(|assignment| assignment.artifact.digest.as_str())
            .collect::<BTreeSet<_>>();
        for artifact in manifest.artifacts.iter().filter(|artifact| {
            matches!(
                artifact.kind.as_str(),
                "app-csv" | "review-summary-json" | "visualization-data-json"
            )
        }) {
            assert_eq!(
                artifact
                    .derived_from
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>(),
                assignment_digests,
                "{} must bind every active input/support/config assignment",
                artifact.kind,
            );
        }
        assert_eq!(
            handle.artifact_count() as usize,
            manifest.artifacts.len(),
            "the transport handle and manifest must expose the same complete closure",
        );
        let mut kinds = BTreeSet::new();
        let mut ledger = None;
        let mut workflow_explorer_value = None;
        let mut explanation_view_value = None;
        let mut closure_value = None;
        let mut correspondence_value = None;
        let mut workspace_root_value = None;
        let mut journal = None;
        for index in 0..handle.artifact_count() {
            let metadata_json = handle.artifact_metadata_json(index).unwrap();
            let metadata: RuntimeArtifactMetadata = serde_json::from_str(&metadata_json).unwrap();
            kinds.insert(metadata.kind.clone());
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, sha256(&bytes));
            if metadata.kind == "execution-ledger-json" {
                ledger = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "workflow-explorer-view-json" {
                workflow_explorer_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "explanation-view-json" {
                explanation_view_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "artifact-closure-json" {
                closure_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "correspondence-index-json" {
                correspondence_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "workspace-root-json" {
                workspace_root_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
            } else if metadata.kind == "evidence-journal" {
                journal = Some(EvidenceJournal::from_cbor(&bytes).unwrap());
            }
        }
        let ledger = ledger.unwrap();
        assert_eq!(
            ledger.as_array().unwrap().len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            ledger
                .as_array()
                .unwrap()
                .iter()
                .map(|unit| unit["queries"].as_array().unwrap().len())
                .sum::<usize>(),
            WORKFLOW_QUERIES.len()
        );
        assert!(kinds.contains("workflow-explorer-view-json"));
        assert!(kinds.contains("artifact-view-json"));
        assert!(kinds.contains("obligation-view-json"));
        assert!(kinds.contains("explanation-view-json"));
        assert!(kinds.contains("workspace-root-json"));
        assert!(kinds.contains("semantic-profile-lock-json"));
        assert!(kinds.contains("semantic-index-source-json"));
        assert!(kinds.contains("workflow-provenance-jsonld"));
        assert!(kinds.contains("correspondence-index-json"));
        assert!(kinds.contains("artifact-closure-json"));
        assert!(kinds.contains("row-lineage-arrow"));
        assert!(kinds.contains("result-cell-correspondence-arrow"));
        assert!(kinds.contains("source-coordinate-index-arrow"));
        assert!(kinds.contains("source-result-influence-arrow"));
        assert!(!kinds.iter().any(|kind| kind.starts_with("ingress:")));
        assert_eq!(
            kinds
                .iter()
                .filter(|kind| kind.starts_with("node-output:"))
                .count(),
            embedded_plan().query_groups.len()
        );
        let workflow_explorer_value = workflow_explorer_value.unwrap();
        assert_eq!(
            workflow_explorer_value["revision"],
            (manifest.role_assignments.len()
                + manifest.query_group_executions.len()
                + manifest.query_executions.len()) as u64
        );
        assert!(
            workflow_explorer_value["phases"]
                .as_array()
                .unwrap()
                .iter()
                .any(|phase| phase["phaseId"] == "create_deliverables"),
            "{}",
            workflow_explorer_value
        );
        assert!(workflow_explorer_value["queries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|query| query["physicalState"] == "executed"));
        let explanation_view_value = explanation_view_value.unwrap();
        assert_eq!(
            explanation_view_value["payload"]["qualification_traces"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            explanation_view_value["payload"]["requirement_traces"]
                .as_array()
                .unwrap()
                .len(),
            embedded_plan().root_roles.len()
        );
        let closure_value = closure_value.unwrap();
        assert_eq!(
            closure_value["protocolVersion"],
            "chronicle-artifact-closure/v1"
        );
        assert_eq!(closure_value["workspaceId"], manifest.workspace_id);
        assert_eq!(
            closure_value["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert!(closure_value["artifacts"].as_array().unwrap().len() >= 10);
        let correspondence_value = correspondence_value.unwrap();
        assert_eq!(
            correspondence_value["protocolVersion"],
            "chronicle-correspondence-index/v4"
        );
        assert_eq!(
            correspondence_value["sourceCoordinateArtifactKind"],
            "source-coordinate-index-arrow"
        );
        assert_eq!(
            correspondence_value["rowCorrespondenceArtifactKind"],
            "row-lineage-arrow"
        );
        assert_eq!(
            correspondence_value["cellCorrespondenceArtifactKind"],
            "result-cell-correspondence-arrow"
        );
        assert_eq!(
            correspondence_value["influenceWitnessArtifactKind"],
            "source-result-influence-arrow"
        );
        assert_eq!(
            correspondence_value["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        assert_eq!(
            workspace_root_value.unwrap()["implementationDigest"],
            IMPLEMENTATION_BUILD_DIGEST
        );
        let correspondence_edges = correspondence_value["edges"].as_array().unwrap();
        let option_edges = correspondence_edges
            .iter()
            .filter(|edge| {
                edge["sourceKind"] == "configuration-value"
                    && edge["targetKind"] == "workflow-query-group"
            })
            .collect::<Vec<_>>();
        let declared_knob_count = embedded_plan()
            .query_groups
            .iter()
            .map(|node| node.knobs.len())
            .sum::<usize>();
        assert_eq!(option_edges.len(), declared_knob_count);
        for edge in option_edges {
            let source_id = edge["sourceId"].as_str().unwrap();
            let option_key = source_id
                .strip_prefix("option:")
                .and_then(|suffix| suffix.split_once(':'))
                .map(|(key, _)| key)
                .unwrap();
            let query_group_id = edge["targetId"].as_str().unwrap();
            let relation = edge["relation"].as_str().unwrap();
            assert!(embedded_plan().query_groups.iter().any(|node| {
                node.query_group_id == query_group_id
                    && node.knobs.iter().any(|knob| {
                        knob.option_key == option_key && relation == format!("{}-node", knob.edge)
                    })
            }));
        }
        assert!(manifest.qualification_traces.iter().all(|trace| {
            correspondence_edges.iter().any(|edge| {
                edge["sourceKind"] == "qualification-trace"
                    && edge["sourceId"] == trace.trace_id
                    && edge["relation"] == "selects-assignment"
            })
        }));
        let raw_digest = &manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "raw_chronicle_csv")
            .unwrap()
            .artifact
            .digest;
        let app_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "app-csv")
            .unwrap()
            .digest;
        let cell_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap()
            .digest;
        let source_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-coordinate-index-arrow")
            .unwrap()
            .digest;
        let row_index_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "row-lineage-arrow")
            .unwrap()
            .digest;
        let influence_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "source-result-influence-arrow")
            .unwrap()
            .digest;
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "workflow-query-group"
                && edge["sourceId"] == "outputs"
                && edge["relation"] == "publishes"
                && edge["targetId"] == *app_digest
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "artifact"
                && edge["sourceId"] == *raw_digest
                && edge["relation"] == "has-source-coordinates-in"
                && edge["targetId"] == *source_index_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *source_index_digest
                && edge["relation"] == "supplies-source-coordinates-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "supplies-result-coordinates-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *row_index_digest
                && edge["relation"] == "supplies-conservative-row-witnesses-to"
                && edge["targetId"] == *influence_digest
                && edge["precision"] == "conservative"
        }));
        let cell_index_metadata = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "result-cell-correspondence-arrow")
            .unwrap();
        let expected_cell_dependencies = manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                is_canonical_cell_output_kind(&artifact.kind)
                    || artifact.kind == "row-lineage-arrow"
            })
            .map(|artifact| artifact.digest.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            cell_index_metadata
                .derived_from
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            expected_cell_dependencies,
        );
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "indexes-cells-of"
                && edge["targetId"] == *app_digest
                && edge["precision"] == "exact"
        }));
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceId"] == *cell_index_digest
                && edge["relation"] == "joins-row-correspondence"
                && edge["targetId"] == *row_index_digest
                && edge["precision"] == "exact"
        }));
        let adjacency = correspondence_edges.iter().fold(
            BTreeMap::<String, BTreeSet<String>>::new(),
            |mut adjacency, edge| {
                adjacency
                    .entry(edge["sourceId"].as_str().unwrap().into())
                    .or_default()
                    .insert(edge["targetId"].as_str().unwrap().into());
                adjacency
            },
        );
        let mut reached = BTreeSet::from([raw_digest.clone()]);
        let mut frontier = vec![raw_digest.clone()];
        while let Some(source) = frontier.pop() {
            for target in adjacency.get(&source).into_iter().flatten() {
                if reached.insert(target.clone()) {
                    frontier.push(target.clone());
                }
            }
        }
        assert!(
            reached.contains(app_digest),
            "raw artifact must have a forward correspondence path to the app output"
        );
        let journal = journal.unwrap();
        // 19 since B09: the polled-emulation group is one more journal event.
        assert_eq!(journal.events().len(), 19);
        assert_eq!(
            journal
                .events()
                .iter()
                .map(|event| event.revision)
                .collect::<Vec<_>>(),
            std::iter::once(2)
                .chain(std::iter::once(1))
                .chain(3..=19)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            journal
                .events()
                .iter()
                .filter(|event| event.event_kind == "node-bypassed")
                .count(),
            manifest
                .query_group_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Bypassed)
                .count()
        );
    }

    #[test]
    fn warm_workspace_reuses_tracked_results_and_option_change_recomputes_exact_cone() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "study_dates_file",
                "study_dates.csv",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n",
            )
            .unwrap();
        let first_request = request_for_workspace(&csv, 'c');
        let first = execute_workspace_native(&first_request.to_string(), &csv, &support).unwrap();
        let first: RuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert_eq!(stable_artifact_generation_count(), 1);
        assert!(first.query_group_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                )
        }));

        let mut warm_request = first_request.clone();
        warm_request["requestId"] = Value::String("warm-run".into());
        warm_request["workspaceRootDigest"] = Value::String(first.workspace_root_digest.clone());
        let mut warm_handle =
            execute_workspace_native(&warm_request.to_string(), &csv, &support).unwrap();
        let warm: RuntimeManifest = serde_json::from_str(&warm_handle.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            1,
            "warm run must not call the kernel"
        );
        assert_eq!(
            stable_artifact_generation_count(),
            1,
            "warm run must reuse immutable terminal artifacts"
        );
        assert!(warm.query_group_executions.iter().all(|execution| {
            execution.output.is_some()
                && matches!(
                    execution.status,
                    ExecutionStatus::Cached | ExecutionStatus::Bypassed
                )
        }));
        assert_eq!(warm.query_executions.len(), WORKFLOW_QUERIES.len());
        assert!(warm.query_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed
        )));
        // Reusing a cached stage projection is a reporting shortcut, never a
        // licence to publish less. Evidence artifacts (the ledger, journal,
        // workflow explorer view, workspace root) legitimately differ between the two
        // runs because they describe the run itself; every query-group
        // output must be republished byte for byte, or the second run of the
        // same request hands the user a shorter download list than the first.
        fn stage_outputs(manifest: &RuntimeManifest) -> BTreeSet<(&str, &str, u64)> {
            manifest
                .artifacts
                .iter()
                .filter(|artifact| artifact.kind.starts_with("node-output:"))
                .map(|artifact| {
                    (
                        artifact.kind.as_str(),
                        artifact.digest.as_str(),
                        artifact.size,
                    )
                })
                .collect::<BTreeSet<_>>()
        }
        assert_eq!(
            stage_outputs(&first).len(),
            first.query_group_executions.len(),
            "the cold run did not publish one output artifact per query group"
        );
        assert_eq!(
            stage_outputs(&warm),
            stage_outputs(&first),
            "a warm repeat of the same request stopped publishing query-group outputs"
        );
        let mut warm_ledger = None;
        let mut warm_journal = None;
        for index in 0..warm_handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&warm_handle.artifact_metadata_json(index).unwrap()).unwrap();
            if metadata.kind == "execution-ledger-json" {
                warm_ledger = Some(
                    serde_json::from_slice::<Value>(
                        &warm_handle.take_artifact_bytes(index).unwrap(),
                    )
                    .unwrap(),
                );
            } else if metadata.kind == "evidence-journal" {
                warm_journal = Some(
                    EvidenceJournal::from_cbor(&warm_handle.take_artifact_bytes(index).unwrap())
                        .unwrap(),
                );
            }
        }
        let warm_ledger = warm_ledger.unwrap();
        let warm_ledger_queries = warm_ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["queries"].as_array().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(warm_ledger_queries.len(), WORKFLOW_QUERIES.len());
        assert!(warm_ledger_queries.iter().all(|query| {
            matches!(query["status"].as_str(), Some("cached" | "bypassed"))
                && query["inputKey"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && query["outputDigest"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
                && query["reasonId"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("sha256:"))
        }));
        let warm_journal = warm_journal.unwrap();
        assert_eq!(
            warm_journal
                .events()
                .iter()
                .filter(|event| event.event_kind == "node-cached")
                .count(),
            warm.query_group_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Cached)
                .count()
        );

        let mut changed_request = warm_request;
        changed_request["requestId"] = Value::String("day-coverage-change".into());
        changed_request["workspaceRootDigest"] = Value::String(warm.workspace_root_digest.clone());
        changed_request["options"]["enable_day_coverage"] = Value::Bool(true);
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &support).unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            2,
            "changed executions: {:?}",
            changed
                .query_group_executions
                .iter()
                .map(|execution| (
                    &execution.query_group_id,
                    execution.status,
                    &execution.input_key
                ))
                .collect::<Vec<_>>()
        );
        assert_eq!(stable_artifact_generation_count(), 2);
        let recomputed: BTreeSet<_> = changed
            .query_group_executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect();
        let evidence_current = dependency_evidence_current(embedded_dependency_certificate());
        if evidence_current {
            assert_eq!(recomputed, BTreeSet::from(["day_coverage", "outputs"]));
        } else {
            assert!(recomputed.contains("day_coverage"));
            assert!(recomputed.contains("outputs"));
            assert!(recomputed.contains("parse_events"));
        }
        assert_eq!(
            changed
                .query_executions
                .iter()
                .filter(|execution| execution.status == ExecutionStatus::Recomputed)
                .map(|execution| execution.query_id.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["build_participant_day_coverage", "assemble_result_manifest"])
        );
        assert_eq!(
            changed
                .query_group_executions
                .iter()
                .find(|execution| execution.query_group_id == "parse_events")
                .unwrap()
                .status,
            if evidence_current {
                ExecutionStatus::Cached
            } else {
                ExecutionStatus::Recomputed
            }
        );
    }

    #[test]
    fn exact_option_bindings_drive_step_invalidation_and_match_a_cold_rust_run() {
        reset_tracked_execution_count();
        let csv = csv();
        let initial_request = request_for_workspace(&csv, 'e');
        let initial =
            execute_workspace_native(&initial_request.to_string(), &csv, &Default::default())
                .unwrap();
        let initial: RuntimeManifest = serde_json::from_str(&initial.manifest_json).unwrap();

        let mut changed_request = initial_request;
        changed_request["requestId"] = Value::String("one-nanosecond-proximity-change".into());
        changed_request["workspaceRootDigest"] =
            Value::String(initial.workspace_root_digest.clone());
        changed_request["options"]["proximity_interval_ns"] = Value::from(1_i64);
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &Default::default())
                .unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        let by_id = changed
            .query_executions
            .iter()
            .map(|execution| (execution.query_id.as_str(), execution))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            by_id["match_app_episodes"].status,
            ExecutionStatus::Recomputed
        );
        assert_eq!(
            by_id["decode_source_records"].status,
            ExecutionStatus::Cached
        );
        assert_ne!(
            by_id["match_app_episodes"].input_key,
            initial
                .query_executions
                .iter()
                .find(|execution| execution.query_id == "match_app_episodes")
                .unwrap()
                .input_key
        );

        let mut cold_request = request_for_workspace(&csv, 'f');
        cold_request["requestId"] = Value::String("cold-one-nanosecond-oracle".into());
        cold_request["options"]["proximity_interval_ns"] = Value::from(1_i64);
        let cold = execute_workspace_native(
            &cold_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cold: RuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(
            changed.processing_summary.workflow_query_digests,
            cold.processing_summary.workflow_query_digests
        );
        assert_eq!(
            changed.processing_summary.workflow_query_checkpoints,
            cold.processing_summary.workflow_query_checkpoints
        );
        assert_eq!(
            changed.processing_summary.published_outputs_digest,
            cold.processing_summary.published_outputs_digest
        );
    }

    #[test]
    fn preprocessing_timestamp_is_an_exact_bound_input_not_an_untracked_label() {
        reset_tracked_execution_count();
        let csv = csv();
        let initial_request = request_for_workspace(&csv, '7');
        let initial =
            execute_workspace_native(&initial_request.to_string(), &csv, &Default::default())
                .unwrap();
        let initial: RuntimeManifest = serde_json::from_str(&initial.manifest_json).unwrap();

        let mut changed_request = initial_request;
        changed_request["requestId"] = Value::String("timestamp-change".into());
        changed_request["workspaceRootDigest"] = Value::String(initial.workspace_root_digest);
        changed_request["options"]["datetime_of_preprocessing"] =
            Value::String("2026-07-21 12:00:01 UTC".into());
        let changed =
            execute_workspace_native(&changed_request.to_string(), &csv, &Default::default())
                .unwrap();
        let changed: RuntimeManifest = serde_json::from_str(&changed.manifest_json).unwrap();
        let by_id = changed
            .query_executions
            .iter()
            .map(|execution| (execution.query_id.as_str(), execution.status))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            by_id["bind_processing_timestamp"],
            ExecutionStatus::Recomputed
        );
        assert_eq!(by_id["validate_remap_rules"], ExecutionStatus::Cached);
        assert_eq!(by_id["decode_source_records"], ExecutionStatus::Cached);
        assert_eq!(
            by_id["assemble_result_manifest"],
            ExecutionStatus::Recomputed
        );
    }

    #[test]
    fn query_group_output_artifacts_publish_their_exact_checkpoint() {
        reset_tracked_execution_count();
        let csv = csv();
        let request = request_for_workspace(&csv, 'a');
        let mut handle =
            execute_workspace_native(&request.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(
            manifest
                .processing_summary
                .workflow_query_group_digests
                .len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            manifest
                .processing_summary
                .workflow_query_group_checkpoints
                .len(),
            embedded_plan().query_groups.len()
        );
        assert_eq!(
            manifest.processing_summary.workflow_query_digests.len(),
            WORKFLOW_QUERIES.len()
        );
        assert_eq!(
            manifest.processing_summary.workflow_query_checkpoints.len(),
            WORKFLOW_QUERIES.len()
        );
        for (query_id, checkpoint) in &manifest.processing_summary.workflow_query_checkpoints {
            assert_eq!(&checkpoint.subject_id, query_id);
            assert_eq!(
                manifest
                    .processing_summary
                    .workflow_query_digests
                    .get(query_id),
                Some(&checkpoint.terminal_digest)
            );
        }

        let mut published = BTreeMap::new();
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            if !metadata.kind.starts_with("node-output:") {
                continue;
            }
            let fingerprint: Value =
                serde_json::from_slice(&handle.take_artifact_bytes(index).unwrap()).unwrap();
            assert_eq!(
                fingerprint["checkpointProtocol"],
                "chronicle-workflow-checkpoint/v1"
            );
            assert_eq!(
                fingerprint["typedCheckpoint"]["subjectId"],
                fingerprint["workflowQueryGroupId"]
            );
            assert_eq!(
                fingerprint["physicalExecution"],
                "salsa-tracked-rust-pipeline-v2"
            );
            published.insert(
                fingerprint["workflowQueryGroupId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                fingerprint["semanticOutputDigest"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        assert_eq!(published.len(), embedded_plan().query_groups.len());
        for (node, digest) in &manifest.processing_summary.workflow_query_group_digests {
            if node != "outputs" {
                assert_eq!(published.get(node), Some(digest), "checkpoint for {node}");
            }
        }
        assert_eq!(
            published.values().collect::<BTreeSet<_>>().len(),
            embedded_plan().query_groups.len(),
            "node identity must keep converged/empty stage values distinct"
        );
    }

    #[test]
    fn incremental_workspace_cache_is_bounded() {
        reset_tracked_execution_count();
        let csv = csv();
        for index in 0..(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES + 3) {
            let marker = char::from_digit((index % 10) as u32, 10).unwrap();
            let request_value = request_for_workspace(&csv, marker);
            execute_workspace_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
        }
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            assert_eq!(
                states.borrow().states.len(),
                DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES
            );
        });
        assert_eq!(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES, 1);
    }

    #[test]
    fn set_capacity_raises_and_compacts_state_cache() {
        reset_tracked_execution_count();
        let csv = csv();
        set_comparison_cache_capacity(4);
        for index in 0..4 {
            let marker = char::from_digit(index as u32, 10).unwrap();
            let request_value = request_for_workspace(&csv, marker);
            execute_workspace_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
        }
        assert_eq!(get_comparison_cache_retained(), 4);
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            states.borrow_mut().compact_all(&chronicle_chrono_kernel_wasm::payload_store::current_store());
            let cache = states.borrow();
            assert_eq!(cache.retained_count(), 4);
            for state in cache.states.values() {
                assert!(state.stable_artifact_bundle.is_none());
                assert!(state.previous_stage_outputs.is_empty());
            }
        });
        set_comparison_cache_capacity(2);
        assert_eq!(get_comparison_cache_retained(), 2);
        set_comparison_cache_capacity(DEFAULT_MAX_INCREMENTAL_RUNTIME_STATES);
        assert_eq!(get_comparison_cache_retained(), 1);
    }

    /// A warm review resumes from Salsa state already in this worker instead
    /// of reparsing the input. Both halves of that claim have to hold: the
    /// workspace must be at the root the request expects, and the engine must
    /// already have verified *this* input. Accepting either one alone would
    /// resume a review against a digest the engine never parsed.
    #[test]
    fn a_warm_review_needs_the_workspace_root_and_the_verified_input_together() {
        let mut cache = IncrementalRuntimeStateCache::default();
        let workspace = "warm-review-workspace";
        let root = format!("sha256:{}", "a".repeat(64));
        let input = format!("sha256:{}", "b".repeat(64));
        cache.state_for(workspace, &ExecutionServices { store: chronicle_chrono_kernel_wasm::payload_store::current_store() }).last_workspace_root = Some(root.clone());

        assert!(
            !cache.has_warm_review_input(workspace, Some(root.as_str()), &input),
            "a matching workspace root alone claimed a warm review input the engine never verified"
        );
        assert!(
            !cache.has_warm_review_input(workspace, Some("sha256:other"), &input),
            "a workspace at a different root claimed a warm review input"
        );
        assert!(
            !cache.has_warm_review_input(workspace, None, &input),
            "a request carrying no workspace root claimed a warm review input"
        );
        assert!(
            !cache.has_warm_review_input("unknown-workspace", Some(root.as_str()), &input),
            "a workspace with no state at all claimed a warm review input"
        );
    }

    #[test]
    fn mismatched_previous_root_resets_incremental_state() {
        reset_tracked_execution_count();
        let csv = csv();
        let request_value = request_for_workspace(&csv, 'd');
        execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut mismatch = request_value;
        mismatch["workspaceRootDigest"] = Value::String(format!("sha256:{}", "e".repeat(64)));
        let result =
            execute_workspace_native(&mismatch.to_string(), &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&result.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 2);
        assert!(manifest
            .query_group_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Recomputed));
    }

    #[test]
    fn repeated_review_reuses_cold_rebuild_based_on_a_verified_existing_root() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut request_value = request_for_workspace(&csv, 'b');
        request_value["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        request_value["workspaceRootDigest"] = Value::String(format!("sha256:{}", "a".repeat(64)));

        let first = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first: ReviewRuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert!(first
            .query_executions
            .iter()
            .any(|execution| execution.status == ExecutionStatus::Recomputed));

        request_value["requestId"] = Value::String("same-root-review-b".into());
        let second = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let second: ReviewRuntimeManifest = serde_json::from_str(&second.manifest_json).unwrap();
        assert_eq!(
            tracked_execution_count(),
            1,
            "the second review arm must reuse the first arm's cold rebuild"
        );
        assert!(second.query_executions.iter().all(|execution| matches!(
            execution.status,
            ExecutionStatus::Cached | ExecutionStatus::Bypassed | ExecutionStatus::Skipped
        )));
    }

    #[test]
    fn persisted_review_base_reenters_a_fresh_runtime_without_result_drift() {
        reset_tracked_execution_count();
        let csv = csv();
        let mut full_request = request_for_workspace(&csv, '9');
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let full_manifest: RuntimeManifest = serde_json::from_str(&full.manifest_json).unwrap();
        let review_base_index = (0..full.artifact_count())
            .find(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(*index).unwrap()).unwrap();
                metadata.kind == "review-base"
                    && metadata.media_type == "application/vnd.chronicle.review-base+postcard+lz4"
            })
            .expect("full execution review base");
        let review_base = full.take_artifact_bytes(review_base_index).unwrap();
        assert!(!review_base.is_empty());
        let reconstruction_base_index = (0..full.artifact_count())
            .find(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&full.artifact_metadata_json(*index).unwrap()).unwrap();
                metadata.kind == "reconstruction-base"
                    && metadata.media_type
                        == "application/vnd.chronicle.reconstruction-base+postcard+lz4"
            })
            .expect("full execution reconstruction base");
        let reconstruction_base = full.take_artifact_bytes(reconstruction_base_index).unwrap();
        assert!(!reconstruction_base.is_empty());

        let mut review_request = full_request;
        review_request["requestId"] = Value::String("cached-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] =
            Value::String(full_manifest.workspace_root_digest.clone());
        // B03/B04 folded the minimum-duration axes into the reconstruction-base
        // key, so a minimum-duration flip now resumes from the review base.
        // Perturb an annotation-level option instead: it stays outside the
        // reconstruction key and keeps the reconstruction-base transfer path
        // under test.
        review_request["options"]["custom_app_engagement_duration"] = Value::from(120.0);

        reset_tracked_execution_count();
        let cached = execute_workspace_native_with_review_bases(
            &review_request.to_string(),
            &csv,
            &review_base,
            &reconstruction_base,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cached: ReviewRuntimeManifest = serde_json::from_str(&cached.manifest_json).unwrap();
        assert_eq!(tracked_execution_count(), 1);
        assert_eq!(cached.cache_sources, ["verified-reconstruction-base"]);
        assert_eq!(
            cached
                .query_executions
                .iter()
                .find(|execution| execution.query_id == "decode_source_records")
                .unwrap()
                .status,
            ExecutionStatus::Cached
        );
        for query_id in [
            "match_app_episodes",
            "materialize_candidate_episodes",
            "segment_concurrent_usage",
        ] {
            assert_eq!(
                cached
                    .query_executions
                    .iter()
                    .find(|execution| execution.query_id == query_id)
                    .unwrap()
                    .status,
                ExecutionStatus::Cached,
                "persisted reconstruction did not reuse {query_id}"
            );
        }

        reset_tracked_execution_count();
        review_request["requestId"] = Value::String("cold-review".into());
        let cold = execute_workspace_native(
            &review_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert!(cold.cache_sources.is_empty());
        assert_eq!(cached.review_summary_digest, cold.review_summary_digest);
        assert_eq!(cached.comparison_digest, cold.comparison_digest);
        assert_eq!(
            (
                cached.counts.original,
                cached.counts.processed,
                cached.counts.app,
                cached.counts.screen,
            ),
            (
                cold.counts.original,
                cold.counts.processed,
                cold.counts.app,
                cold.counts.screen,
            )
        );
        assert_eq!(cached.timezone, cold.timezone);
        assert_eq!(cached.timezone_action, cold.timezone_action);

        let mut corrupt = review_base;
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0xff;
        reset_tracked_execution_count();
        let error = match execute_workspace_native_with_review_base(
            &review_request.to_string(),
            &csv,
            &corrupt,
            &RuntimeSupportFiles::default(),
        ) {
            Ok(_) => panic!("corrupt review base was accepted"),
            Err(error) => error,
        };
        assert!(
            error.contains("review base") || error.contains("decompress"),
            "unexpected corrupt review-base error: {error}"
        );
    }

    /// A review of a screen-processing run under DEFAULT settings used to be
    /// impossible without the raw file: `requires_live_scientific_preflight` is
    /// true whenever screen usage is processed, a raw-less resume has no bytes
    /// to preflight from, and `execute_incremental_pipeline` returned
    /// `SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR` unconditionally. The persisted
    /// review path was therefore dead for the settings almost every run uses
    /// (preview issue #6).
    ///
    /// Both persisted bases now carry the receipt of the run that wrote them,
    /// and a resume adopts it when it describes the same measurement.
    #[test]
    fn a_screen_processing_review_resumes_from_a_persisted_base_without_raw_bytes() {
        let csv = csv();
        let support = RuntimeSupportFiles::default();
        let mut full_request = request_for_workspace(&csv, '6');
        full_request["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        full_request["options"]["include_screen_output"] = Value::Bool(true);
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        let full_json = full_request.to_string();
        assert!(
            requires_live_scientific_preflight(
                &serde_json::from_str::<RuntimeRequest>(&full_json)
                    .unwrap()
                    .options
                    .into_pipeline_options()
            ),
            "this fixture must exercise the live-preflight arm"
        );
        scientific_preflight_native(&full_json, &csv, &support).unwrap();
        let mut full = execute_workspace_native(&full_json, &csv, &support).unwrap();
        let mut review_base = None;
        let mut reconstruction_base = None;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            match metadata.kind.as_str() {
                "review-base" => review_base = Some(full.take_artifact_bytes(index).unwrap()),
                "reconstruction-base" => {
                    reconstruction_base = Some(full.take_artifact_bytes(index).unwrap())
                }
                _ => {}
            }
        }
        let review_base = review_base.expect("full execution review base");
        let reconstruction_base = reconstruction_base.expect("full execution reconstruction base");
        let review_probe_bytes = PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
        let reconstruction_probe_bytes =
            PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();

        // Both bases carry a commitment, and it is the one this run issued.
        let carried_from = |base: &[u8]| {
            split_persisted_preflight(&base[PERSISTED_BASE_RUNTIME_HEADER_BYTES..], "base")
                .unwrap()
                .1
                .expect("a persisted base must carry its scientific preflight")
        };
        let carried = carried_from(&reconstruction_base);
        assert_eq!(carried, carried_from(&review_base));
        validate_scientific_preflight_receipt_integrity(&carried.receipt).unwrap();

        let resume = |request: &Value, review: &[u8], reconstruction: &[u8]| {
            INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
            let prepared = prepare_runtime_workspace_from_persisted_input(
                &request.to_string(),
                csv.len() as u64,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
            let mut prepared = prepare_review_from_prepared(
                prepared,
                None,
                &review[..review_probe_bytes],
                &reconstruction[..reconstruction_probe_bytes],
            )
            .unwrap();
            let kind = prepared.required_base_kind();
            let result = match kind.as_str() {
                "review-base" => prepared.execute_selected_base_native(review.to_vec()),
                "reconstruction-base" => prepared
                    .execute_selected_base_pair_native(review.to_vec(), reconstruction.to_vec()),
                other => panic!("a raw-less resume must select a persisted base, not {other}"),
            };
            (kind, result)
        };

        // Reopening the same measurement after a reload: identical options,
        // fresh worker, no raw file. This is the case issue #6 says died.
        let mut review_request = full_request.clone();
        review_request["requestId"] = Value::String("rawless-screen-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] = Value::Null;
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "5".repeat(64)));
        let (kind, resumed) = resume(&review_request, &review_base, &reconstruction_base);
        let resumed = resumed
            .unwrap_or_else(|error| panic!("a raw-less screen review from {kind} failed: {error}"));
        let resumed: ReviewRuntimeManifest = serde_json::from_str(&resumed.manifest_json).unwrap();
        assert!(!resumed.cache_sources.is_empty());

        // The resume is only worth having if it is the same review.
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        let mut cold_request = review_request.clone();
        cold_request["requestId"] = Value::String("cold-screen-review".into());
        let cold_json = cold_request.to_string();
        scientific_preflight_native(&cold_json, &csv, &support).unwrap();
        let cold = execute_workspace_native(&cold_json, &csv, &support).unwrap();
        let cold: ReviewRuntimeManifest = serde_json::from_str(&cold.manifest_json).unwrap();
        assert_eq!(resumed.review_summary_digest, cold.review_summary_digest);
        assert_eq!(resumed.comparison_digest, cold.comparison_digest);
        assert_eq!(
            (resumed.counts.app, resumed.counts.screen),
            (cold.counts.app, cold.counts.screen)
        );

        // An artifact-only flip is a different REQUEST but the same
        // MEASUREMENT, so the commitment still applies. Gating on the full
        // exact-options digest would refuse this and leave the path dead for
        // anyone who toggles an export format.
        let mut artifact_only = review_request.clone();
        artifact_only["requestId"] = Value::String("rawless-artifact-flip".into());
        let previous_spss = artifact_only["options"]["enable_spss_export"]
            .as_bool()
            .unwrap_or(false);
        artifact_only["options"]["enable_spss_export"] = Value::Bool(!previous_spss);
        let (_, flipped) = resume(&artifact_only, &review_base, &reconstruction_base);
        let flipped: ReviewRuntimeManifest = serde_json::from_str(
            &flipped
                .unwrap_or_else(|error| panic!("an artifact-only flip must still resume: {error}"))
                .manifest_json,
        )
        .unwrap();
        assert_eq!(flipped.review_summary_digest, resumed.review_summary_digest);

        // A computation option IS a different measurement. The commitment does
        // not cover it, so the resume asks for the raw file rather than
        // publishing a receipt for a run it did not describe.
        let mut computation = review_request.clone();
        computation["requestId"] = Value::String("rawless-computation-flip".into());
        computation["options"]["custom_app_engagement_duration"] = Value::from(120.0);
        let (_, moved) = resume(&computation, &review_base, &reconstruction_base);
        let error = match moved {
            Ok(_) => panic!("a changed measurement was resumed from a stale commitment"),
            Err(error) => error,
        };
        // The token matters, not just the word. `queryPersistedRustReview`
        // returns a persisted-review MISS -- and lets its caller re-run from
        // the raw file -- only for `scientific_preflight_retry_required`; any
        // other message propagates as a hard failure of the whole request. A
        // comparison run (Arm B) moves a computation option by definition, so
        // the bespoke "does not match this measurement" message this used to
        // return failed the browser's raw-less arm outright instead of falling
        // back. The old assertion accepted either message, which is why the
        // difference was invisible here.
        assert!(
            error.contains("scientific_preflight_retry_required"),
            "a changed measurement must ask for raw bytes by name: {error}"
        );

        // Bases with no commitment still demand the raw file. This is the
        // pre-change behavior, and the reason the trailer had to exist.
        let without_commitment = |base: &[u8], magic: &[u8; 8]| {
            wrap_persisted_base(
                attach_persisted_preflight(
                    split_persisted_preflight(&base[PERSISTED_BASE_RUNTIME_HEADER_BYTES..], "base")
                        .unwrap()
                        .0
                        .to_vec(),
                    None,
                )
                .unwrap(),
                magic,
            )
        };
        let (_, stripped) = resume(
            &review_request,
            &without_commitment(&review_base, REVIEW_BASE_RUNTIME_MAGIC),
            &without_commitment(&reconstruction_base, RECONSTRUCTION_BASE_RUNTIME_MAGIC),
        );
        let error = match stripped {
            Ok(_) => panic!("a commitment-free resume was accepted"),
            Err(error) => error,
        };
        assert!(
            error.contains("scientific_preflight_retry_required"),
            "commitment-free bases must ask for raw bytes: {error}"
        );

        // A tampered commitment fails closed rather than authorizing the run.
        let mut tampered_receipt = carried.clone();
        tampered_receipt.receipt.key.input_size_bytes += 1;
        let tampered = wrap_persisted_base(
            attach_persisted_preflight(
                split_persisted_preflight(
                    &reconstruction_base[PERSISTED_BASE_RUNTIME_HEADER_BYTES..],
                    "reconstruction base",
                )
                .unwrap()
                .0
                .to_vec(),
                Some(&tampered_receipt),
            )
            .unwrap(),
            RECONSTRUCTION_BASE_RUNTIME_MAGIC,
        );
        let (_, tampered) = resume(
            &review_request,
            &without_commitment(&review_base, REVIEW_BASE_RUNTIME_MAGIC),
            &tampered,
        );
        let error = match tampered {
            Ok(_) => panic!("a tampered commitment authorized a run"),
            Err(error) => error,
        };
        // Fail closed means fail, not fall back: a tampered commitment must
        // NOT come back as the retryable token, because the caller would treat
        // that as an ordinary cache miss and silently re-run. SCOPE OF THE
        // CLAIM: the integrity checks are self-consistency (the receipt's own
        // recomputed digests and its agreement with the preflight stored
        // beside it) -- there is no MAC, so a forger who recomputes every
        // digest in step produces a base indistinguishable from a legitimate
        // different measurement and receives the retry token. That arm is
        // safe because the retry path re-verifies everything against the raw
        // bytes (fresh preflight, byte-equality repeat, finalization against
        // produced output): a self-consistent forgery buys a re-run, never an
        // accepted result. Do NOT read this assertion as "all tampering fails
        // hard" and remove the raw-path re-verification as redundant.
        assert!(
            error.contains("scientific preflight")
                && !error.contains("scientific_preflight_retry_required"),
            "a tampered commitment must fail closed: {error}"
        );

        // A base written under the previous envelope format is stale, not
        // fatal: it degrades to the raw path like a stale build identity.
        for (magic, superseded) in [
            (REVIEW_BASE_RUNTIME_MAGIC, b"CHRRVR01"),
            (RECONSTRUCTION_BASE_RUNTIME_MAGIC, b"CHRRXR01"),
        ] {
            let mut old_format = reconstruction_base.clone();
            old_format[..superseded.len()].copy_from_slice(superseded.as_slice());
            assert!(verified_persisted_base_payload(
                &old_format,
                magic,
                "persisted base",
                DependencyCacheMode::CertifiedNarrow,
            )
            .unwrap()
            .is_empty());
        }
    }

    /// The raw-less adoption gate has exactly two failure modes and they must
    /// not be interchangeable.
    ///
    /// * A base whose stored receipt disagrees with the preflight stored beside
    ///   it is CORRUPT -- raw bytes do not redeem it, so it fails hard.
    /// * A base written for a DIFFERENT measurement is merely inapplicable. It
    ///   is the same situation as a base carrying no commitment at all, and
    ///   that case already answers `SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR` so
    ///   the browser re-runs from the raw file.
    ///
    /// The second case used to answer "persisted scientific preflight does not
    /// match this measurement" instead. `queryPersistedRustReview` maps only
    /// the retry token to a persisted-review miss and propagates every other
    /// message as a hard failure, so the raw-less arm of an A/B comparison --
    /// which moves a computation option by definition; that is what a
    /// comparison IS -- surfaced that message to the user instead of falling
    /// back. The e2e "View tab compares the run against a second config (Arm B)"
    /// is the case that showed it.
    ///
    /// This exercises `adopt_persisted_scientific_preflight` directly rather
    /// than through `prepare_review_from_prepared`, so it holds regardless of
    /// the dependency-certificate cache mode that gates base SELECTION.
    #[test]
    fn a_persisted_preflight_for_another_measurement_asks_for_raw_bytes_by_name() {
        let csv = csv();
        let mut request_value = request_for_workspace(&csv, '7');
        request_value["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        request_value["options"]["include_screen_output"] = Value::Bool(true);
        let request_json = request_value.to_string();
        let request: RuntimeRequest = serde_json::from_str(&request_json).unwrap();
        let options = request.options.clone().into_pipeline_options();
        assert!(
            requires_live_scientific_preflight(&options),
            "this fixture must exercise the live-preflight arm"
        );
        let support = RuntimeSupportFiles::default();
        scientific_preflight_native(&request_json, &csv, &support).unwrap();
        let mut full = execute_workspace_native(&request_json, &csv, &support).unwrap();
        let mut reconstruction_base = None;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            if metadata.kind.as_str() == "reconstruction-base" {
                reconstruction_base = Some(full.take_artifact_bytes(index).unwrap());
            }
        }
        let reconstruction_base = reconstruction_base.expect("full execution reconstruction base");
        let carried = split_persisted_preflight(
            &reconstruction_base[PERSISTED_BASE_RUNTIME_HEADER_BYTES..],
            "reconstruction base",
        )
        .unwrap()
        .1
        .expect("a persisted base must carry its scientific preflight");
        let key = carried.receipt.key.clone();
        let measurement = carried.receipt.b05_schoedel.options_digest.clone();

        // Control: the commitment the run issued for THIS measurement is
        // adoptable, so the two refusals below are refusals of what they name
        // and not of the fixture.
        adopt_persisted_scientific_preflight(&carried, &key, &measurement, &request, &[], &options)
            .expect("a run's own commitment must be adoptable")
            .expect("adoption must produce a pending commit");

        let moved = adopt_persisted_scientific_preflight(
            &carried,
            &key,
            &format!("sha256:{}", "a".repeat(64)),
            &request,
            &[],
            &options,
        )
        .expect_err("a commitment for another measurement must not authorize this run");
        assert_eq!(
            moved, SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR,
            "a different measurement must ask for raw bytes by the exact token \
             `queryPersistedRustReview` treats as a persisted-review miss",
        );

        // Corruption is not a cache miss.
        let mut corrupt = carried.clone();
        corrupt.exact_b05_schoedel.protocol_version.push('!');
        let corrupted = adopt_persisted_scientific_preflight(
            &corrupt,
            &key,
            &measurement,
            &request,
            &[],
            &options,
        )
        .expect_err("a receipt that disagrees with its own preflight must not be adopted");
        assert_ne!(
            corrupted, SCIENTIFIC_PREFLIGHT_RAW_RETRY_ERROR,
            "a corrupt base must fail closed, not be retried as an ordinary miss",
        );
        assert!(
            corrupted.contains("does not match its own preflight"),
            "unexpected corrupt-commitment error: {corrupted}"
        );
    }

    /// `execute_workspace_native_warm_review` hashes no bytes and hands the
    /// engine an empty input under the request's declared digest. Only a
    /// review over the engine's retained input may do that; an
    /// `ExecuteWorkspace` request would run the whole pipeline over zero bytes
    /// and commit a receipt naming a real file. It is refused by name.
    #[test]
    fn warm_review_entry_point_refuses_a_non_review_command() {
        let csv = csv();
        let request = request_for_workspace(&csv, '7');
        assert_eq!(request["command"], EXECUTE_WORKSPACE_COMMAND);
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        match execute_workspace_native_warm_review(
            &request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        ) {
            Ok(handle) => panic!(
                "the warm review entry point ran {EXECUTE_WORKSPACE_COMMAND} over zero raw bytes: {}",
                handle.manifest_json
            ),
            Err(error) => assert_eq!(error, "warm_review_requires_query_review_command"),
        }
    }

    /// The selected-base guard compares the transferred object with the probe
    /// Rust verified at prepare time. A transfer of the probe bytes alone (a
    /// header-only review base) carries no rows: the raw CSV is already
    /// dropped, so accepting it would review an empty input under a receipt
    /// that names the real file. It must fail closed, while the complete base
    /// for the same selection is still accepted.
    #[test]
    fn a_header_only_selected_review_base_fails_closed() {
        let csv = csv();
        let mut full_request = request_for_workspace(&csv, '2');
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut review_base = None;
        let mut reconstruction_base = None;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            match metadata.kind.as_str() {
                "review-base" => review_base = Some(full.take_artifact_bytes(index).unwrap()),
                "reconstruction-base" => {
                    reconstruction_base = Some(full.take_artifact_bytes(index).unwrap())
                }
                _ => {}
            }
        }
        let review_base = review_base.unwrap();
        let reconstruction_base = reconstruction_base.unwrap();
        let review_probe_bytes = PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
        let reconstruction_probe_bytes =
            PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();
        assert!(review_base.len() > review_probe_bytes);

        let mut review_request = full_request.clone();
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] = Value::Null;
        // Concurrent-usage modelling is inside the reconstruction-base key but
        // not the review-base key, so turning it off resumes from the review
        // base (as in `prepared_review_transfers_only_the_rust_selected_full_base`).
        review_request["options"]["model_concurrent_usage"] = Value::Bool(false);
        let prepare = |marker: char| {
            let mut request = review_request.clone();
            request["requestId"] = Value::String(format!("header-only-review-base-{marker}"));
            request["workspaceId"] =
                Value::String(format!("sha256:{}", marker.to_string().repeat(64)));
            INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
            let prepared = prepare_runtime_workspace_from_persisted_input(
                &request.to_string(),
                csv.len() as u64,
                &RuntimeSupportFiles::default(),
            )
            .unwrap();
            let mut prepared = prepare_review_from_prepared(
                prepared,
                None,
                &review_base[..review_probe_bytes],
                &reconstruction_base[..reconstruction_probe_bytes],
            )
            .unwrap();
            // Under a current dependency certificate this option change
            // selects the review base; a stale certificate selects none and
            // never consults the guard. Pin the review selection so the test
            // exercises the guard whatever the certificate's freshness.
            prepared.selection = PersistedReviewBaseSelection::Review;
            prepared
        };

        let header_only = review_base[..review_probe_bytes].to_vec();
        match prepare('a').execute_selected_base_native(header_only) {
            Ok(handle) => panic!(
                "a header-only review base was accepted after the raw input was dropped: {}",
                handle.manifest_json
            ),
            Err(error) => assert!(
                error.contains("selected review base does not match its verified probe"),
                "unexpected refusal: {error}"
            ),
        }

        // The complete objects the probes were read from still pass the guard
        // (their end-to-end resume is `prepared_review_transfers_only_the_rust_selected_full_base`).
        assert!(selected_base_matches_probe(&review_base[..review_probe_bytes], &review_base));
        assert!(selected_base_matches_probe(
            &reconstruction_base[..reconstruction_probe_bytes],
            &reconstruction_base
        ));
        assert!(!selected_base_matches_probe(
            &reconstruction_base[..reconstruction_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes]
        ));
    }

    #[test]
    fn prepared_review_transfers_only_the_rust_selected_full_base() {
        let csv = csv();
        let mut full_request = request_for_workspace(&csv, '2');
        full_request["options"]["model_concurrent_usage"] = Value::Bool(true);
        let mut full = execute_workspace_native(
            &full_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut review_base = None;
        let mut reconstruction_base = None;
        for index in 0..full.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&full.artifact_metadata_json(index).unwrap()).unwrap();
            match metadata.kind.as_str() {
                "review-base" => review_base = Some(full.take_artifact_bytes(index).unwrap()),
                "reconstruction-base" => {
                    reconstruction_base = Some(full.take_artifact_bytes(index).unwrap())
                }
                _ => {}
            }
        }
        let review_base = review_base.unwrap();
        let reconstruction_base = reconstruction_base.unwrap();
        let review_probe_bytes = PERSISTED_BASE_RUNTIME_HEADER_BYTES + review_base_header_bytes();
        let reconstruction_probe_bytes =
            PERSISTED_BASE_RUNTIME_HEADER_BYTES + reconstruction_base_header_bytes();
        assert_eq!(
            serde_json::from_str::<Value>(&review_base_probe_spec_json()).unwrap(),
            serde_json::json!({
                "reviewBaseBytes": review_probe_bytes,
                "reconstructionBaseBytes": reconstruction_probe_bytes,
            })
        );

        let mut review_request = full_request.clone();
        review_request["requestId"] = Value::String("prepared-reconstruction-review".into());
        review_request["command"] = Value::String(QUERY_REVIEW_COMMAND.into());
        review_request["workspaceRootDigest"] = Value::Null;
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "3".repeat(64)));
        // B03/B04 folded the minimum-duration axes into the reconstruction-base
        // key, so a minimum-duration flip now resumes from the review base.
        // Perturb an annotation-level option instead: it stays outside the
        // reconstruction key and keeps the reconstruction-base transfer path
        // under test.
        review_request["options"]["custom_app_engagement_duration"] = Value::from(120.0);
        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        let persisted_prepared = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut prepared = prepare_review_from_prepared(
            persisted_prepared,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(prepared.required_base_kind(), "reconstruction-base");
        // A reconstruction resume transfers BOTH complete envelopes: the
        // kernel fails closed on a header-only review base because the
        // reconstruction restore does not self-certify its stored annotation
        // rows. The single-base entry point therefore refuses the selection.
        assert!(prepared
            .execute_selected_base_native(reconstruction_base.clone())
            .err()
            .unwrap()
            .contains("requires the complete review and reconstruction bases"));
        assert!(prepared
            .execute_selected_base_pair_native(
                reconstruction_base.clone(),
                reconstruction_base.clone()
            )
            .err()
            .unwrap()
            .contains("selected review base"));
        assert!(prepared
            .execute_selected_base_pair_native(review_base.clone(), review_base.clone())
            .err()
            .unwrap()
            .contains("selected reconstruction base"));
        let cached = prepared
            .execute_selected_base_pair_native(review_base.clone(), reconstruction_base.clone())
            .unwrap();
        let cached: ReviewRuntimeManifest = serde_json::from_str(&cached.manifest_json).unwrap();
        assert_eq!(cached.cache_sources, ["verified-reconstruction-base"]);
        assert_eq!(cached.query_executions.len(), WORKFLOW_QUERIES.len());
        assert!(prepared
            .execute_selected_base_pair_native(review_base.clone(), reconstruction_base.clone())
            .err()
            .unwrap()
            .contains("already executed"));

        review_request["requestId"] = Value::String("prepared-warm-review".into());
        // A minimum-duration flip now invalidates the reconstruction cone
        // (B03/B04 folded it into the reconstruction-base key), which would
        // re-restore the annotation substrate from the retained review base
        // and truthfully report "verified-review-base". Keep this section on
        // the pure salsa-memory path with an annotation-level perturbation.
        review_request["options"]["custom_app_engagement_duration"] = Value::from(240.0);
        let warm_prepared = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut warm = prepare_review_from_prepared(
            warm_prepared,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(warm.required_base_kind(), "salsa-memory");
        assert!(warm
            .execute_selected_base_native(review_base.clone())
            .err()
            .unwrap()
            .contains("must not receive"));
        let warm_result = warm.execute_selected_base_native(Vec::new()).unwrap();
        let warm_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&warm_result.manifest_json).unwrap();
        assert_eq!(warm_manifest.cache_sources, ["salsa-memory"]);
        assert_eq!(warm_manifest.query_executions.len(), WORKFLOW_QUERIES.len());

        review_request["requestId"] = Value::String("prepared-review-only".into());
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "4".repeat(64)));
        review_request["options"]["model_concurrent_usage"] = Value::Bool(false);
        let persisted_review_only = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut review_only = prepare_review_from_prepared(
            persisted_review_only,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(review_only.required_base_kind(), "review-base");
        let review_only_result = review_only
            .execute_selected_base_native(review_base.clone())
            .unwrap();
        let review_only_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&review_only_result.manifest_json).unwrap();
        assert_eq!(review_only_manifest.cache_sources, ["verified-review-base"]);

        review_request["requestId"] = Value::String("prepared-cold".into());
        review_request["workspaceId"] = Value::String(format!("sha256:{}", "5".repeat(64)));
        review_request["options"]["timezone_handling"] = Value::String("primary-convert".into());
        let mut cold = prepare_workspace_review_native(
            &review_request.to_string(),
            csv.clone(),
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        assert_eq!(cold.required_base_kind(), "none");
        assert!(cold
            .execute_selected_base_native(review_base.clone())
            .err()
            .unwrap()
            .contains("selected no persisted base"));
        let cold_result = cold.execute_selected_base_native(Vec::new()).unwrap();
        let cold_manifest: ReviewRuntimeManifest =
            serde_json::from_str(&cold_result.manifest_json).unwrap();
        assert!(cold_manifest.cache_sources.is_empty());
        assert_eq!(cold_manifest.query_executions.len(), WORKFLOW_QUERIES.len());

        INCREMENTAL_RUNTIME_STATES.with(|states| *states.borrow_mut() = Default::default());
        let persisted_miss = prepare_runtime_workspace_from_persisted_input(
            &review_request.to_string(),
            csv.len() as u64,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let mut persisted_miss = prepare_review_from_prepared(
            persisted_miss,
            None,
            &review_base[..review_probe_bytes],
            &reconstruction_base[..reconstruction_probe_bytes],
        )
        .unwrap();
        assert_eq!(persisted_miss.required_base_kind(), "none");
        assert!(persisted_miss
            .execute_selected_base_native(Vec::new())
            .err()
            .unwrap()
            .contains("retry with raw input"));

        assert!(prepare_workspace_review_native(
            &review_request.to_string(),
            csv,
            &review_base[..review_probe_bytes - 1],
            &reconstruction_base[..reconstruction_probe_bytes],
            &RuntimeSupportFiles::default(),
        )
        .err()
        .unwrap()
        .contains("exactly"));
    }

    #[test]
    fn execution_ledger_records_an_enabled_or_no_op_query_as_executed() {
        let csv = csv();
        let mut request_value = request_for_workspace(&csv, 'f');
        request_value["options"]["deduplicate_exact_rows"] = Value::Bool(false);
        let mut result = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let ledger = (0..result.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&result.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "execution-ledger-json").then(|| {
                    serde_json::from_slice::<Value>(&result.take_artifact_bytes(index).unwrap())
                        .unwrap()
                })
            })
            .unwrap();
        let coalesce_duplicate_event_keys = ledger
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|unit| unit["queries"].as_array().unwrap())
            .find(|query| query["queryId"] == "coalesce_duplicate_event_keys")
            .unwrap();
        assert_eq!(coalesce_duplicate_event_keys["status"], "recomputed");
    }

    #[test]
    fn runtime_preserves_selected_filter_counts_from_nested_options() {
        let csv = mixed_timezone_csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["timezone_handling"] = Value::String("selected-filter".into());
        let handle = execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        assert_eq!(manifest.counts.original, 4);
        assert_eq!(manifest.counts.processed, 2);
        assert_eq!(manifest.counts.app, 1);
    }

    #[test]
    fn every_ordered_timezone_transition_matches_a_cold_full_rust_oracle() {
        let csv = mixed_timezone_csv();
        let expected_touched = embedded_plan()
            .query_groups
            .iter()
            .map(|node| node.query_group_id.clone())
            .filter(|query_group_id| query_group_id != "parse_events")
            .collect::<BTreeSet<_>>();

        for (from_index, from) in TIMEZONE_HANDLING_MODES.iter().enumerate() {
            for (to_index, to) in TIMEZONE_HANDLING_MODES.iter().enumerate() {
                if from == to {
                    continue;
                }
                reset_tracked_execution_count();
                let marker = char::from_digit(((from_index * 4 + to_index) % 10) as u32, 10)
                    .expect("decimal marker");
                let mut initial = request_for_workspace(&csv, marker);
                initial["options"]["timezone_handling"] = Value::String((*from).into());
                let initial_handle = execute_workspace_native(
                    &initial.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                let initial_manifest: RuntimeManifest =
                    serde_json::from_str(&initial_handle.manifest_json).unwrap();

                let mut changed = initial;
                changed["requestId"] = Value::String(format!("transition-{from}-to-{to}"));
                changed["workspaceRootDigest"] =
                    Value::String(initial_manifest.workspace_root_digest);
                changed["options"]["timezone_handling"] = Value::String((*to).into());
                let changed_handle = execute_workspace_native(
                    &changed.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                let manifest: RuntimeManifest =
                    serde_json::from_str(&changed_handle.manifest_json).unwrap();
                let mut oracle_request: RuntimeRequest =
                    serde_json::from_str(&request(&csv)).unwrap();
                oracle_request.options.timezone_handling = (*to).into();
                let oracle_options = oracle_request.options.clone();
                let (oracle_exact_options, _, _) =
                    canonicalize_exact_options(&oracle_options).unwrap();
                let oracle_computation_digest =
                    computation_options_digest(&oracle_exact_options).unwrap();
                let oracle_result = run_pipeline_v2_with_supports(
                    &csv,
                    &oracle_options.clone().into_pipeline_options(),
                    PipelineV2SupportFiles {
                        verified_request_options_digest: Some(&oracle_computation_digest),
                        ..PipelineV2SupportFiles::default()
                    },
                )
                .unwrap();
                let oracle_eyes = build_runtime_eyes_evidence(&oracle_result, &oracle_options)
                    .unwrap()
                    .summary;
                // The production provenance digest embeds the scientific
                // evidence summary, so the cold oracle must carry it too.
                let oracle_scientific =
                    direct_scientific_evidence_bundle(&csv, &oracle_request, &oracle_result)
                        .summary;
                let oracle = pipeline_result_digests_with_scientific(
                    &oracle_result,
                    &oracle_eyes,
                    &oracle_scientific,
                ).unwrap();
                assert_eq!(
                    manifest.processing_summary.timezone_stage_digest,
                    oracle_result.timezone_stage_digest,
                    "{from} -> {to}: normalized state diverged from cold oracle"
                );
                assert_eq!(
                    manifest.processing_summary.published_outputs_digest,
                    oracle.published_outputs_digest,
                    "{from} -> {to}: published output diverged from cold oracle"
                );
                assert_eq!(
                    manifest.processing_summary.provenance_digest, oracle.provenance_digest,
                    "{from} -> {to}: provenance diverged from cold oracle"
                );

                let touched = manifest
                    .query_group_executions
                    .iter()
                    .filter(|execution| {
                        matches!(
                            execution.status,
                            ExecutionStatus::Recomputed | ExecutionStatus::Bypassed
                        )
                    })
                    .map(|execution| execution.query_group_id.clone())
                    .collect::<BTreeSet<_>>();
                let evidence_current =
                    dependency_evidence_current(embedded_dependency_certificate());
                if evidence_current {
                    assert!(
                        touched == expected_touched,
                        "{from} -> {to}: exact changed-node set differs: missing={:?} extra={:?}",
                        expected_touched.difference(&touched).collect::<Vec<_>>(),
                        touched.difference(&expected_touched).collect::<Vec<_>>()
                    );
                } else {
                    assert!(
                        expected_touched.is_subset(&touched),
                        "{from} -> {to}: under-invalidated nodes: {:?}",
                        expected_touched.difference(&touched).collect::<Vec<_>>()
                    );
                }
                assert_eq!(
                    manifest
                        .query_group_executions
                        .iter()
                        .find(|execution| execution.query_group_id == "parse_events")
                        .unwrap()
                        .status,
                    if evidence_current {
                        ExecutionStatus::Cached
                    } else {
                        ExecutionStatus::Recomputed
                    },
                    "{from} -> {to}: parse status must reflect certified versus conservative execution"
                );
            }
        }
    }

    #[test]
    fn transport_request_identity_does_not_change_semantic_workspace_root() {
        let csv = csv();
        let first = execute_workspace_native(&request(&csv), &csv, &RuntimeSupportFiles::default())
            .unwrap();
        let mut second_request: Value = serde_json::from_str(&request(&csv)).unwrap();
        second_request["requestId"] = Value::String("req-2".into());
        let second = execute_workspace_native(
            &second_request.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let first: RuntimeManifest = serde_json::from_str(&first.manifest_json).unwrap();
        let second: RuntimeManifest = serde_json::from_str(&second.manifest_json).unwrap();
        assert_eq!(first.workspace_root_digest, second.workspace_root_digest);
    }

    #[test]
    fn tampered_input_and_unknown_fields_fail_closed() {
        let csv = csv();
        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["inputSha256"] = Value::String(format!("sha256:{:0>64}", 0));
        let error =
            execute_workspace_native(&value.to_string(), &csv, &RuntimeSupportFiles::default())
                .err()
                .expect("tampered digest must fail");
        assert!(error.contains("input digest mismatch"));

        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["surprise"] = Value::Bool(true);
        let error =
            execute_workspace_native(&value.to_string(), &csv, &RuntimeSupportFiles::default())
                .err()
                .expect("unknown field must fail");
        assert!(error.contains("unknown field"));
    }

    #[test]
    fn support_roles_are_registered_nonempty_and_single_assignment() {
        let mut support = RuntimeSupportFiles::default();
        assert!(support
            .put_native("unknown_role", "unknown.csv", b"value")
            .is_err());
        assert!(support
            .put_native("filter_file", "filter.csv", b"")
            .is_err());
        support
            .put_native("filter_file", "filter.csv", b"package_name\ncom.example")
            .unwrap();
        support
            .put_native(
                "analysis_feature_matrix_file",
                "feature-matrix.csv",
                b"participant_id,feature_id,value,missing_state,feature_set_id\nP1,f1,1,observed,setA\n",
            )
            .unwrap();
        support
            .put_native(
                "call_sms_eligibility_file",
                "call-sms-eligibility.csv",
                b"participant_id,modality_scope,availability_state,year_equivalent_exposure_numerator,year_equivalent_exposure_denominator\nP1,call_text_combined,available,1,1\n",
            )
            .unwrap();
        support
            .put_native(
                "phonestudy_ps_communication_file",
                "ps_communication.csv",
                b"id,contact_hash\nc-1,peer-a\n",
            )
            .unwrap();
        support
            .put_native(
                "phonestudy_es_file",
                "es.csv",
                b"user_id,es_questionnaire_id\nu-1,es-1\n",
            )
            .unwrap();
        support
            .put_native(
                "anchor_events_file",
                "anchors.csv",
                b"participant_id,anchor_timestamp\nu-1,2026-01-01 12:00:00\n",
            )
            .unwrap();
        assert!(support
            .put_native("filter_file", "other.csv", b"package_name\ncom.other",)
            .is_err());
    }

    #[test]
    fn immutable_support_resolution_is_reused_and_invalidated_on_insert() {
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "filter.csv", b"package_name\ncom.example")
            .unwrap();
        let first = support.resolve(false).unwrap();
        let second = support.resolve(false).unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        support
            .put_native(
                "background_apps_file",
                "background.csv",
                b"package_name\ncom.background",
            )
            .unwrap();
        let updated = support.resolve(false).unwrap();
        assert!(!Arc::ptr_eq(&first, &updated));
        assert_eq!(updated.files.len(), 2);
    }

    #[test]
    fn requirements_report_exposes_binding_holes_and_execution_fails_closed() {
        let csv = csv();
        let mut value: Value = serde_json::from_str(&request(&csv)).unwrap();
        value["options"]["use_filter_file"] = Value::Bool(true);
        let request = value.to_string();
        let report =
            evaluate_workspace_requirements_native(&request, &csv, &RuntimeSupportFiles::default())
                .unwrap();
        let report: Value = serde_json::from_str(&report).unwrap();
        assert_eq!(
            report["protocolVersion"],
            "chronicle-requirements-report/v1"
        );
        assert_eq!(report["ready"], false);
        assert_eq!(report["qualificationTraces"].as_array().unwrap().len(), 2);
        let filter_requirement = report["requirementTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["role_id"] == "filter_file")
            .expect("filter requirement trace");
        assert_eq!(filter_requirement["condition_result"], true);
        assert_eq!(filter_requirement["state"], "open");
        assert!(report["openObligations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|obligation| obligation["role_id"] == "filter_file"));
        assert_eq!(report["queryGroupStates"]["app_policy"], "open");

        let error = execute_workspace_native(&request, &csv, &RuntimeSupportFiles::default())
            .err()
            .expect("missing required role must block execution");
        assert!(error.contains("unresolved binding holes"));
        assert!(error.contains("filter_file"));

        let mut wrong_schema = RuntimeSupportFiles::default();
        wrong_schema
            .put_native(
                "filter_file",
                "filter.csv",
                b"participant_id,value\nP01,unrelated\n",
            )
            .unwrap();
        let invalid =
            evaluate_workspace_requirements_native(&request, &csv, &wrong_schema).unwrap();
        let invalid: Value = serde_json::from_str(&invalid).unwrap();
        assert_eq!(invalid["ready"], false);
        assert_eq!(invalid["roleStates"]["filter_file"], "invalid");
        assert_eq!(invalid["queryGroupStates"]["app_policy"], "invalid");
        let rejected = invalid["qualificationTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["asserted_role_ids"][0] == "filter_file")
            .unwrap();
        assert_eq!(rejected["decision"], "rejected");
        assert!(rejected["rule_evaluations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|rule| {
                rule["rule_id"] == "chronicle.binding.content-validation.v1"
                    && rule["passed"] == false
            }));

        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "filter_file",
                "filter.csv",
                b"app_package_name,known_application_labels\ncom.invalid,System\n",
            )
            .unwrap();
        let ready = evaluate_workspace_requirements_native(&request, &csv, &support).unwrap();
        let ready: Value = serde_json::from_str(&ready).unwrap();
        assert_eq!(ready["ready"], true);
        assert!(ready["openObligations"].as_array().unwrap().is_empty());
        let filter_qualification = ready["qualificationTraces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["selected_role_id"] == "filter_file")
            .expect("accepted filter qualification trace");
        assert_eq!(filter_qualification["decision"], "accepted");
    }

    /// A date-formatted worksheet cell reaches the support parsers as an ISO
    /// date, not as Excel's serial number (2023-07-01 used to arrive as 45108,
    /// which no date column accepts).
    #[test]
    fn xlsx_date_cells_are_normalized_to_iso_dates() {
        let csv = xlsx_to_csv(include_bytes!(
            "../tests/fixtures/study_dates_with_date_cells.xlsx"
        ))
        .unwrap();
        assert_eq!(
            String::from_utf8(csv).unwrap(),
            "participant_id,start_date,end_date,first_seen\n\
             P0001,2023-07-01,2023-07-14,2023-07-01 08:30:05\n"
        );
    }

    /// Survey answers join raw events by exact instant, so a sub-second
    /// date-time cell keeps its milliseconds.
    #[test]
    fn xlsx_datetime_cells_keep_their_milliseconds() {
        let csv = xlsx_to_csv(include_bytes!(
            "../tests/fixtures/attribution_with_millisecond_cells.xlsx"
        ))
        .unwrap();
        assert_eq!(
            String::from_utf8(csv).unwrap(),
            "participant_id,event_timestamp,users\n\
             P0001,2023-07-01 12:00:00.500,Target Child\n"
        );
    }

    #[test]
    fn xlsx_support_is_preserved_normalized_and_materialized() {
        let workbook = include_bytes!(concat!(
            env!("CHRONICLE_REPOSITORY_ROOT"),
            "/apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
        ));
        let mut support = RuntimeSupportFiles::default();
        let expected_width = {
            let mut workbook_reader = Xlsx::new(Cursor::new(workbook.as_slice())).unwrap();
            let sheet = workbook_reader.sheet_names().first().unwrap().clone();
            workbook_reader.worksheet_range(&sheet).unwrap().width()
        };
        let normalized_csv = xlsx_to_csv(workbook).unwrap();
        let normalized_width = csv::Reader::from_reader(normalized_csv.as_slice())
            .headers()
            .unwrap()
            .len();
        assert_eq!(normalized_width, expected_width);
        support
            .put_native("filter_file", "filter.xlsx", workbook)
            .unwrap();
        let mut request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        request_value["options"]["use_filter_file"] = Value::Bool(true);
        let mut handle =
            execute_workspace_native(&request_value.to_string(), &csv(), &support).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let assignment = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "filter_file")
            .unwrap();
        assert_eq!(
            assignment.artifact.media_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert!(manifest.open_obligations.is_empty());
        let normalized = (0..handle.artifact_count())
            .find_map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                (metadata.kind == "normalized-support:filter_file")
                    .then(|| handle.take_artifact_bytes(index).unwrap())
            })
            .expect("normalized support artifact");
        assert!(String::from_utf8(normalized)
            .unwrap()
            .contains("app_package_name"));
    }

    #[test]
    fn identical_support_bytes_keep_distinct_role_identity_and_shared_content_identity() {
        let workbook = include_bytes!(concat!(
            env!("CHRONICLE_REPOSITORY_ROOT"),
            "/apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
        ));
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "filter.xlsx", workbook)
            .unwrap();
        support
            .put_native("background_apps_file", "background.xlsx", workbook)
            .unwrap();
        let csv = csv();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["use_filter_file"] = Value::Bool(true);
        request_value["options"]["use_background_apps_file"] = Value::Bool(true);
        let handle = execute_workspace_native(&request_value.to_string(), &csv, &support).unwrap();
        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let filter = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "filter_file")
            .unwrap();
        let background = manifest
            .role_assignments
            .iter()
            .find(|assignment| assignment.role_id == "background_apps_file")
            .unwrap();
        assert_eq!(filter.artifact.digest, background.artifact.digest);
        assert_ne!(filter.artifact.artifact_id, background.artifact.artifact_id);

        let normalized = manifest
            .artifacts
            .iter()
            .filter(|artifact| artifact.kind.starts_with("normalized-support:"))
            .collect::<Vec<_>>();
        let normalized_filter = normalized
            .iter()
            .find(|artifact| artifact.kind == "normalized-support:filter_file")
            .unwrap();
        let normalized_background = normalized
            .iter()
            .find(|artifact| artifact.kind == "normalized-support:background_apps_file")
            .unwrap();
        assert_eq!(normalized_filter.digest, normalized_background.digest);
        assert_ne!(
            normalized_filter.artifact_id,
            normalized_background.artifact_id
        );
    }

    #[test]
    fn legacy_xls_support_fails_closed_with_conversion_guidance() {
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native("filter_file", "legacy.xls", b"not-an-xls")
            .unwrap();
        let error = support.resolve(false).err().expect("legacy xls must fail");
        assert!(error.contains("Convert legacy .xls"));
    }

    #[test]
    fn request_support_and_digest_boundaries_fail_closed() {
        assert!(runtime_version().starts_with("chronicle-preprocessing-runtime/"));
        assert!(plan_workflow_explorer_view_native("{")
            .unwrap_err()
            .contains("invalid workflow-explorer request"));
        let csv = csv();
        let base: RuntimeRequest = serde_json::from_str(&request(&csv)).unwrap();
        let mut review = base.clone();
        review.command = QUERY_REVIEW_COMMAND.into();
        assert!(review.validate_fields().is_ok());

        let receipt = MethodProfileReceipt {
            method_profile_id: "method-profile:doi:example".into(),
            source_work_id: "doi:example".into(),
            source_method_variant_id: "primary".into(),
            source_method_variant_ids: vec!["primary".into()],
            source_method_combination_id: None,
            method_profile_version: "v1".into(),
            setting_ids: vec!["setting:minimum".into()],
            bindings: vec![MethodProfileBindingReceipt {
                setting_id: "setting:minimum".into(),
                slot: "minimum_usage_duration".into(),
                value: serde_json::json!(60),
                conformance_fixture_id: "fixture:example:minimum".into(),
                conformance_result_digest: format!("sha256:{}", "a".repeat(64)),
            }],
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: Vec::new(),
            diary_replication_binding: None,
        };
        let mut profiled = base.clone();
        profiled.method_profile_receipt = Some(receipt.clone());
        assert!(profiled.validate_fields().is_ok());
        let mut missing_variant = profiled.clone();
        missing_variant
            .method_profile_receipt
            .as_mut()
            .unwrap()
            .source_method_variant_ids
            .clear();
        assert!(missing_variant
            .validate_fields()
            .unwrap_err()
            .contains("sourceMethodVariantIds must be non-empty and unique"));
        let mut duplicate_variant = profiled.clone();
        duplicate_variant
            .method_profile_receipt
            .as_mut()
            .unwrap()
            .source_method_variant_ids
            .push("primary".into());
        assert!(duplicate_variant
            .validate_fields()
            .unwrap_err()
            .contains("sourceMethodVariantIds must be non-empty and unique"));
        let artifact = method_profile_receipt_artifact(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            profiled.method_profile_receipt.as_ref(),
            "sha256:options",
        )
        .unwrap()
        .unwrap();
        assert_eq!(artifact.metadata.kind, "method-profile-receipt-json");
        let mut drifted = profiled;
        drifted.method_profile_receipt.as_mut().unwrap().bindings[0].value = serde_json::json!(61);
        assert!(drifted
            .validate_fields()
            .unwrap_err()
            .contains("disagrees with runtime option"));

        let diary_binding = crate::sleep_diary_replication::tests::registered_binding();
        let mut diary_profiled = base.clone();
        diary_profiled.method_profile_receipt = Some(MethodProfileReceipt {
            method_profile_id:
                "chronicle-diary-replication:version-zenodo-sleepdiaries-v1.1.3:sleepdiaries-v1-csv"
                    .into(),
            source_work_id: "work-zenodo-sleepdiaries".into(),
            source_method_variant_id: "version-zenodo-sleepdiaries-v1.1.3".into(),
            source_method_variant_ids: vec!["version-zenodo-sleepdiaries-v1.1.3".into()],
            source_method_combination_id: None,
            method_profile_version: "1".into(),
            setting_ids: vec![diary_binding.setting_id.clone()],
            bindings: Vec::new(),
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: Vec::new(),
            diary_replication_binding: Some(diary_binding),
        });
        diary_profiled
            .method_profile_receipt
            .as_ref()
            .unwrap()
            .validate_against(&diary_profiled.options)
            .unwrap();
        assert_eq!(
            diary_profiled.validate_fields().unwrap_err(),
            "diary_replication_profile_not_executable:blocked"
        );
        let mut diary_review = diary_profiled.clone();
        diary_review.command = QUERY_REVIEW_COMMAND.into();
        diary_review.validate_fields().unwrap();
        let mut forged_diary_profiled = diary_profiled.clone();
        forged_diary_profiled
            .method_profile_receipt
            .as_mut()
            .unwrap()
            .source_work_id = "work-forged".into();
        assert!(forged_diary_profiled
            .validate_fields()
            .unwrap_err()
            .contains("outer diary identity disagrees"));
        let artifact = method_profile_receipt_artifact(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            diary_profiled.method_profile_receipt.as_ref(),
            "sha256:options",
        )
        .unwrap()
        .unwrap();
        let bytes = artifact.bytes.into_vec().unwrap();
        let payload: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            payload["diaryReplicationBinding"]["mappingProfileId"],
            "sleepdiaries-v1-csv"
        );

        let minap_binding = crate::sleep_diary_replication::tests::registered_minap_binding();
        let mut minap_profiled = base.clone();
        minap_profiled.method_profile_receipt = Some(MethodProfileReceipt {
            method_profile_id:
                "chronicle-diary-replication:version-zenodo-minap-v1.0:minap-v1-event-sheet".into(),
            source_work_id: "work-zenodo-minap-go".into(),
            source_method_variant_id: "version-zenodo-minap-v1.0".into(),
            source_method_variant_ids: vec!["version-zenodo-minap-v1.0".into()],
            source_method_combination_id: None,
            method_profile_version: "1".into(),
            setting_ids: vec![minap_binding.setting_id.clone()],
            bindings: Vec::new(),
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: Vec::new(),
            diary_replication_binding: Some(minap_binding),
        });
        minap_profiled
            .method_profile_receipt
            .as_ref()
            .unwrap()
            .validate_against(&minap_profiled.options)
            .unwrap();
        assert_eq!(
            minap_profiled.validate_fields().unwrap_err(),
            "diary_replication_profile_not_executable:blocked"
        );
        let mut minap_review = minap_profiled.clone();
        minap_review.command = QUERY_REVIEW_COMMAND.into();
        minap_review.validate_fields().unwrap();
        let artifact = method_profile_receipt_artifact(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            minap_profiled.method_profile_receipt.as_ref(),
            "sha256:options",
        )
        .unwrap()
        .unwrap();
        let bytes = artifact.bytes.into_vec().unwrap();
        let payload: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            payload["diaryReplicationBinding"]["mappingProfileId"],
            "minap-v1-event-sheet"
        );
        assert_eq!(
            payload["diaryReplicationBinding"]["profileExecutionStatus"],
            "blocked"
        );
        assert_eq!(
            payload["diaryReplicationBinding"]["blockerCodes"]
                .as_array()
                .unwrap()
                .len(),
            29
        );
        let mut composite = base.clone();
        composite.command = QUERY_REVIEW_COMMAND.into();
        composite.method_profile_receipts = vec![
            receipt.clone(),
            minap_profiled.method_profile_receipt.clone().unwrap(),
        ];
        composite.validate_fields().unwrap();
        let artifact = method_profile_receipts_artifact(&chronicle_chrono_kernel_wasm::payload_store::current_store(),&composite, "sha256:options")
            .unwrap()
            .unwrap();
        assert_eq!(artifact.metadata.kind, "method-profile-receipts-json");
        let bytes = artifact.bytes.into_vec().unwrap();
        let payload: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(payload.as_array().unwrap().len(), 2);
        assert!(payload[0].get("diaryReplicationBinding").is_none());
        assert_eq!(
            payload[1]["diaryReplicationBinding"]["mappingProfileId"],
            "minap-v1-event-sheet"
        );
        let mut composite_execute = composite.clone();
        composite_execute.command = EXECUTE_WORKSPACE_COMMAND.into();
        assert_eq!(
            composite_execute.validate_fields().unwrap_err(),
            "diary_replication_profile_not_executable:blocked"
        );
        let mut duplicate = composite.clone();
        duplicate.method_profile_receipts.push(receipt.clone());
        assert!(duplicate
            .validate_fields()
            .unwrap_err()
            .contains("at most one"));
        let mut mixed_legacy = composite;
        mixed_legacy.method_profile_receipt = Some(receipt.clone());
        assert!(mixed_legacy
            .validate_fields()
            .unwrap_err()
            .contains("cannot contain both"));
        let mut forged_minap = minap_profiled;
        forged_minap
            .method_profile_receipt
            .as_mut()
            .unwrap()
            .source_method_variant_id = "version-zenodo-sleepdiaries-v1.1.3".into();
        forged_minap
            .method_profile_receipt
            .as_mut()
            .unwrap()
            .source_method_variant_ids = vec!["version-zenodo-sleepdiaries-v1.1.3".into()];
        assert!(forged_minap
            .validate_fields()
            .unwrap_err()
            .contains("outer diary identity disagrees"));

        for (plotting, timeline, declared) in [
            (false, false, false),
            (true, false, true),
            (false, true, true),
            (true, true, true),
        ] {
            let mut value = base.clone();
            value.options.enable_plotting = plotting;
            value.options.enable_interactive_timeline = timeline;
            value.options.materialize_visualization_data = Some(declared);
            assert!(value.validate_fields().is_ok());
            value.options.materialize_visualization_data = Some(!declared);
            assert!(value
                .validate_fields()
                .unwrap_err()
                .contains("materializeVisualizationData"));
        }
        let cases = [
            ("protocol", {
                let mut value = base.clone();
                value.protocol_version = "future".into();
                value
            }),
            ("command", {
                let mut value = base.clone();
                value.command = "ExecuteArbitraryCode".into();
                value
            }),
            ("request", {
                let mut value = base.clone();
                value.request_id = "  ".into();
                value
            }),
            ("inputFileName", {
                let mut value = base.clone();
                value.input_file_name = String::new();
                value
            }),
            ("workspaceId", {
                let mut value = base.clone();
                value.workspace_id = "not-a-digest".into();
                value
            }),
            ("workspaceRootDigest", {
                let mut value = base.clone();
                value.workspace_root_digest = Some("sha256:short".into());
                value
            }),
        ];
        for (expected, value) in cases {
            assert!(value.validate(&csv).unwrap_err().contains(expected));
        }
        assert_eq!(
            validate_digest("missing-prefix"),
            Err("must start with sha256:")
        );
        assert_eq!(
            validate_digest("sha256:xyz"),
            Err("must contain exactly 64 lowercase hexadecimal characters")
        );
        assert!(validate_digest(&format!("sha256:{}", "a".repeat(64))).is_ok());
        assert!(validate_digest(&format!("sha256:{}", "a".repeat(63))).is_err());
        assert!(validate_digest(&format!("sha256:{}g", "a".repeat(63))).is_err());

        let mut support = RuntimeSupportFiles::new();
        assert!(support.put_native("filter_file", " ", b"x").is_err());
        support
            .put_native("background_apps_file", "background.bin", b"x")
            .unwrap();
        assert!(support
            .resolve(false)
            .err()
            .expect("unsupported extension must fail")
            .contains("unsupported support file format"));
        let mut corrupt = RuntimeSupportFiles::default();
        corrupt
            .put_native("filter_file", "filter.xlsx", b"not-an-xlsx")
            .unwrap();
        assert!(corrupt.resolve(false).is_err());

        let mut resolved = ResolvedSupportFiles::default();
        resolved.files.insert(
            "filter_file".into(),
            ResolvedSupportFile {
                media_type: "text/csv",
                original_bytes: b"original".to_vec(),
                pipeline_csv: b"normalized".to_vec(),
                normalized_from_xlsx: false,
                content_validation_error: None,
            },
        );
        assert_eq!(resolved.get("filter_file"), b"normalized");
        assert!(resolved.get("missing").is_empty());
        let options_digest = format!("sha256:{}", "a".repeat(64));
        let assignments = BTreeMap::new();
        let pipeline_files = resolved.pipeline_files(&options_digest, &assignments, &[]);
        assert_eq!(pipeline_files.filter_csv, b"normalized");
        assert!(pipeline_files.apps_forcing_csv.is_empty());
        assert!(pipeline_files.background_apps_csv.is_empty());
        assert!(pipeline_files.codebook_csv.is_empty());
        assert!(pipeline_files.study_dates_csv.is_empty());
        assert!(pipeline_files.device_sharing_csv.is_empty());
        assert!(pipeline_files.survey_attribution_csv.is_empty());
        assert!(pipeline_files.enrolled_devices_csv.is_empty());

        let mut cell = Vec::new();
        write_csv_cell(&mut cell, "a,\"b\"\n");
        assert_eq!(String::from_utf8(cell).unwrap(), "\"a,\"\"b\"\"\n\"");
    }

    #[test]
    fn literature_input_binding_executes_the_registered_raw_event_adapter_and_receipts_it() {
        let csv = b"study_id,participant_id,event_timestamp,timezone,interaction_type,app_package_name,application_label,username,source_event_type,source_event_type_map\nS1,P01,2026-01-01 00:00:00,UTC,,,,Target Child,screen-on condition,\"{\"\"screen-on condition\"\":\"\"Screen Interactive\"\",\"\"screen-off condition\"\":\"\"Screen Non-Interactive\"\"}\"\nS1,P01,2026-01-01 00:00:10,UTC,,,,Target Child,screen-off condition,\"{\"\"screen-on condition\"\":\"\"Screen Interactive\"\",\"\"screen-off condition\"\":\"\"Screen Non-Interactive\"\"}\"\n".to_vec();
        let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
        request_value["options"]["usage_session_mode"] = Value::String("screen_usage".into());
        request_value["options"]["include_app_output"] = Value::Bool(false);
        request_value["options"]["include_screen_output"] = Value::Bool(true);
        request_value["options"]["screen_session_construction_strategy"] =
            Value::String("chronicle_screen_interactive_v1".into());
        request_value["methodProfileReceipt"] = serde_json::json!({
            "methodProfileId": "method-profile:doi:10.4088/jcp.15m10310",
            "sourceWorkId": "doi:10.4088/jcp.15m10310",
            "sourceMethodVariantId": "source-audit-configuration-space-c4d94f8f8253dbd23ad0d6fa",
            "sourceMethodVariantIds": ["source-audit-configuration-space-c4d94f8f8253dbd23ad0d6fa"],
            "methodProfileVersion": "literature-sublation-v3-atomic+source-complete-v1",
            "settingIds": ["method-setting-2c9fed2f1de18abea29320cb"],
            "bindings": [],
            "inputBindings": [{
                "settingId": "method-setting-2c9fed2f1de18abea29320cb",
                "routeKind": "protocol_input",
                "inputRole": "raw_chronicle_csv",
                "schemaId": "chronicle-raw-event-map/v1",
                "adapterId": "chronicle.raw-event-map",
                "adapterVersion": "v1",
                "requiredFields": [
                    "participant_id", "source_event_type", "source_event_type_map",
                    "event_timestamp", "app_package_name when app-scoped"
                ],
                "sourceValue": ["screen-on condition", "screen-off condition"],
                "conformanceFixtureId": "literature-input.screen-state-event-conditions.v1",
                "conformanceResultDigest": "sha256:b23d6460e215d55cee046fb962687ffacc6fd2f8da5e3aa8dc774aaabb61c3ff"
            }]
        });
        let mut scientific_outputs = None;
        for engine in ["sequential", "incremental"] {
            for provenance_evidence in [false, true] {
                request_value["executionEngine"] = Value::String(engine.into());
                request_value["provenanceEvidence"] = Value::Bool(provenance_evidence);
                let request_json = request_value.to_string();
                let support = RuntimeSupportFiles::default();
                let preflight: RuntimeScientificPreflightReceipt = serde_json::from_str(
                    &scientific_preflight_native(&request_json, &csv, &support).unwrap(),
                ).unwrap();
                assert_ne!(preflight.key.input_digest, sha256(&csv));
                let mut handle = execute_workspace_native(&request_json, &csv, &support).unwrap();
                let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
                assert_eq!(manifest.input.digest, sha256(&csv));
                for kind in ["method-profile-receipt-json", "literature-input-adaptation-receipt-json"] {
                    let index = manifest.artifacts.iter().position(|artifact| artifact.kind == kind)
                        .expect("mandatory method/adaptation receipt even when provenance is disabled");
                    let metadata = &manifest.artifacts[index];
                    let bytes = handle.take_artifact_bytes(index as u32).unwrap();
                    assert_eq!(sha256(&bytes), metadata.digest);
                    assert_eq!(bytes.len() as u64, metadata.size);
                    if kind == "literature-input-adaptation-receipt-json" {
                        let receipt: Value = serde_json::from_slice(&bytes).unwrap();
                        assert_eq!(receipt["originalInputDigest"], sha256(&csv));
                        assert_eq!(receipt["adaptedInputDigest"], preflight.key.input_digest);
                    }
                }
                for kind in ["source-coordinate-index-arrow", "result-cell-correspondence-arrow", "source-result-influence-arrow"] {
                    assert_eq!(manifest.artifacts.iter().any(|artifact| artifact.kind == kind), provenance_evidence);
                }
                if provenance_evidence {
                    let prepared = prepare_runtime_workspace(&request_json, &csv, &support).unwrap();
                    let sources = canonical_sources(
                        &csv, &prepared.options_bytes, &prepared.ingress.assignments, &prepared.resolved_support,
                    ).unwrap();
                    let (expected, _) = binary_exports::source_coordinate_index_arrow(
                        &chronicle_chrono_kernel_wasm::payload_store::current_store(), &sources,
                    ).unwrap();
                    let index = manifest.artifacts.iter().position(|artifact| artifact.kind == "source-coordinate-index-arrow").unwrap();
                    let metadata = &manifest.artifacts[index];
                    let bytes = handle.take_artifact_bytes(index as u32).unwrap();
                    assert_eq!(sha256(&bytes), metadata.digest);
                    assert_eq!(bytes, expected.into_vec().unwrap(), "source coordinates retain original upload cells, not adapted CSV");
                }
                let screen_index = manifest.artifacts.iter().position(|artifact| artifact.kind == "screen-csv").unwrap();
                let outputs = (serde_json::to_value(&manifest.counts).unwrap(), handle.take_artifact_bytes(screen_index as u32).unwrap());
                if let Some(expected) = &scientific_outputs {
                    assert_eq!(&outputs, expected, "scientific outputs are invariant across engines/provenance controls");
                } else {
                    scientific_outputs = Some(outputs);
                }
            }
        }
        request_value["methodProfileReceipt"]["sourceMethodVariantId"] =
            Value::String("source-configuration-space-forged".into());
        assert!(execute_workspace_native(
            &request_value.to_string(),
            &csv,
            &RuntimeSupportFiles::default(),
        )
        .err()
        .unwrap()
        .contains("registered conformance tuple"));
    }

    #[test]
    fn malformed_b04_threshold_fails_before_tracked_execution_on_native_runtime_path() {
        let csv = csv();
        for (threshold, expected) in [
            (
                serde_json::json!(-1.0),
                "pipeline_options_invalid:minimum_usage_duration:negative",
            ),
            (
                serde_json::json!(10_000_000_000.0),
                "pipeline_options_invalid:minimum_usage_duration:nanosecond_overflow",
            ),
        ] {
            reset_tracked_execution_count();
            let mut request_value: Value = serde_json::from_str(&request(&csv)).unwrap();
            request_value["options"]["minimum_usage_duration"] = threshold;
            let error = match execute_workspace_native(
                &request_value.to_string(),
                &csv,
                &RuntimeSupportFiles::default(),
            ) {
                Ok(_) => panic!("invalid B04 threshold must fail before execution"),
                Err(error) => error,
            };
            assert_eq!(error, expected);
            assert_eq!(tracked_execution_count(), 0);
            assert_eq!(stable_artifact_generation_count(), 0);
            let preflight_error = opener_set_applicability_native(&request_value.to_string())
                .expect_err("configuration-only preflight must reject the same threshold");
            assert_eq!(preflight_error, expected);
        }

        let nonfinite = request(&csv).replace(
            "\"minimum_usage_duration\":60.0",
            "\"minimum_usage_duration\":NaN",
        );
        let error =
            match execute_workspace_native(&nonfinite, &csv, &RuntimeSupportFiles::default()) {
                Ok(_) => panic!("JSON non-finite threshold must be parser-rejected"),
                Err(error) => error,
            };
        assert!(error.contains("invalid request"), "{error}");
    }

    #[test]
    fn review_behavior_is_contract_owned_and_timezone_discovery_is_exact() {
        let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
        assert_eq!(contract.execution.queries.len(), WORKFLOW_QUERIES.len());
        // Pin the exact Omit set, not its mere existence: `query_review_behavior`
        // lives in `workflow_contract.rs`, which is deliberately excised from
        // the implementation digest, so the kernel golden (re-recorded by
        // `UPDATE_GOLDEN=1`) was otherwise the only gate that pinned it by
        // value. This list is the review-mode omission surface -- editing it
        // is a semantic change and must fail a second, independent gate.
        let mut omit_queries = contract
            .execution
            .queries
            .iter()
            .filter(|query| query.review_behavior == ReviewBehavior::Omit)
            .map(|query| query.id)
            .collect::<Vec<_>>();
        omit_queries.sort_unstable();
        assert_eq!(
            omit_queries,
            [
                "aggregate_attribution_minutes",
                "assemble_credit_outputs",
                "assemble_notification_contact_outputs",
                "assemble_polled_emulation_outputs",
                "assess_screen_evidence_capability",
                "build_activity_witness_indexes",
                "build_participant_day_coverage",
                "classify_compliance_days",
                "classify_notification_contacts",
                "compute_attribution_completeness",
                "derive_credited_intervals",
                "group_polled_runs",
                "identify_credit_eligible_sessions",
                "index_observed_usage_spans",
                "index_raw_dates",
                "materialize_credited_rows",
                "materialize_polled_rows",
                "sample_polled_timeline",
                "select_notification_events",
                "summarize_daily_apps",
            ],
            "review-behavior Omit set drifted from the pinned list"
        );
        assert!(contract.execution.queries.iter().all(|query| {
            let expected_mode = query.review_behavior != ReviewBehavior::Execute;
            query_output_mode(query.review_behavior, false).is_some() == expected_mode
                && query_output_mode(query.review_behavior, true).is_some() == expected_mode
        }));
        assert_eq!(
            discover_timezones_v2(&mixed_timezone_csv()).unwrap(),
            ["America/Chicago", "America/New_York"]
        );
    }

    #[test]
    fn direct_invalidation_predicates_cover_each_independent_condition() {
        assert!(validate_verified_review_inputs(false, true, true).is_ok());
        assert!(validate_verified_review_inputs(true, false, false).is_ok());
        assert!(validate_verified_review_inputs(true, true, false).is_err());
        assert!(validate_verified_review_inputs(true, false, true).is_err());

        for label in ["review-base", "reconstruction-base"] {
            assert!(validate_optional_probe_length(&[], 4, label).is_ok());
            assert!(validate_optional_probe_length(&[0; 4], 4, label).is_ok());
            assert!(validate_optional_probe_length(&[0; 3], 4, label)
                .unwrap_err()
                .contains(label));
        }
        assert!(!selected_base_matches_probe(&[], b"prefix-payload"));
        assert!(!selected_base_matches_probe(b"prefix", b"wrong-payload"));
        assert!(selected_base_matches_probe(b"prefix", b"prefix-payload"));
        assert!(!selected_base_matches_probe(b"prefix", b"prefix"));

        let cached = RuntimeQueryExecution {
            query_id: "step".into(),
            query_group_id: "unit".into(),
            status: ExecutionStatus::Cached,
            input_key: "input".into(),
            output_digest: "output".into(),
            reason_id: "reason".into(),
        };
        let mut recomputed = cached.clone();
        recomputed.status = ExecutionStatus::Recomputed;
        assert!(should_report_salsa_memory(true, true, &[cached]));
        assert!(!should_report_salsa_memory(false, true, &[]));
        assert!(!should_report_salsa_memory(true, false, &[]));
        assert!(!should_report_salsa_memory(true, true, &[recomputed]));

        assert_eq!(
            query_group_status(true, false, false, false, false),
            ExecutionStatus::Error
        );
        assert_eq!(
            query_group_status(false, true, false, false, false),
            ExecutionStatus::Bypassed
        );
        assert_eq!(
            query_group_status(false, false, true, false, false),
            ExecutionStatus::Skipped
        );
        for changed in [(true, false), (false, true)] {
            assert_eq!(
                query_group_status(false, false, false, changed.0, changed.1),
                ExecutionStatus::Recomputed
            );
        }
        assert_eq!(
            query_group_status(false, false, false, false, false),
            ExecutionStatus::Cached
        );
    }

    /// A query group may report `recomputed` only when a member query
    /// actually executed or the run deactivated the group. Nothing else — no
    /// projection key move, no artifact rebuild — may reach that status, so a
    /// stage badge can never contradict the manifest's own `queryExecutions`.
    #[test]
    fn no_query_group_reports_recomputed_without_an_executed_member() {
        for bits in 0..(1_u8 << 5) {
            let has_error = bits & 1 != 0;
            let bypassed = bits & 2 != 0;
            let has_skipped_query = bits & 4 != 0;
            let group_deactivated = bits & 8 != 0;
            let has_executed_member = bits & 16 != 0;
            let status = query_group_status(
                has_error,
                bypassed,
                has_skipped_query,
                group_deactivated,
                has_executed_member,
            );
            if status == ExecutionStatus::Recomputed {
                assert!(
                    group_deactivated || has_executed_member,
                    "recomputed without an executed member or a deactivated group: {bits:05b}"
                );
            }
            // The converse, which the original assertion left open: `cached`
            // publishes the reason `all-active-queries-reused`, so it may not
            // be reachable from an input set in which a member query ran. Only
            // `error`, `bypassed` and `skipped` -- each of which withdraws the
            // reuse claim rather than making one -- outrank an execution.
            if status == ExecutionStatus::Cached {
                assert!(
                    !has_executed_member,
                    "cached claims every active query was reused, but a member \
                     query executed: {bits:05b}"
                );
            }
        }
    }

    /// The end-to-end pin for the same invariant: drive the real projection
    /// with a previous run whose stage keys all differ, every member query
    /// reported cached by Salsa, and no deactivated group. Every stage must
    /// come back `cached`, because a moved projection key is not an execution
    /// event. A support artifact rewritten with CRLF line endings is exactly
    /// this shape — the raw digest inside `active_source_roles` moves, the
    /// parsed rows do not, and Salsa runs nothing.
    #[test]
    fn a_moved_projection_key_alone_never_badges_a_stage_recomputed() {
        let csv = csv();
        let (_request, result, semantic_options, _exact_options) =
            direct_pipeline_result(&csv, false);
        let plan = embedded_plan();
        // Salsa reported every member query cached: nothing physically ran.
        let query_executions = WORKFLOW_QUERIES
            .iter()
            .map(|definition| RuntimeQueryExecution {
                query_id: definition.id.to_string(),
                query_group_id: definition.group.to_string(),
                status: ExecutionStatus::Cached,
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        // Every stage's remembered key differs from the one this run builds,
        // so `projection_changed` is true for all of them.
        let mut previous_stage_inputs = plan
            .query_groups
            .iter()
            .map(|node| {
                (
                    node.query_group_id.clone(),
                    format!("sha256:{}", "9".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            plan,
            &semantic_options,
            &result,
            &query_executions,
            &BTreeSet::new(),
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection over cached members");
        assert_eq!(executions.len(), plan.query_groups.len());
        let recomputed = executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            recomputed,
            Vec::<&str>::new(),
            "a moved projection key alone reported physical recomputation"
        );
        // The projection still rebuilt the stage artifacts, and the moved key
        // is still published — only the execution claim is withheld.
        assert!(executions
            .iter()
            .all(|execution| execution.output.is_some()));
        assert!(plan.query_groups.iter().all(|node| previous_stage_inputs
            .get(&node.query_group_id)
            .is_some_and(|key| key != &format!("sha256:{}", "9".repeat(64)))));

        // One member query that actually executed is what makes its stage
        // recomputed, and only that stage.
        let executed = WORKFLOW_QUERIES.first().expect("workflow query registry");
        let mut with_execution = query_executions.clone();
        with_execution[0].status = ExecutionStatus::Recomputed;
        let executed_queries = BTreeSet::from([executed.id]);
        let mut previous_stage_inputs = plan
            .query_groups
            .iter()
            .map(|node| {
                (
                    node.query_group_id.clone(),
                    format!("sha256:{}", "9".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            plan,
            &semantic_options,
            &result,
            &with_execution,
            &executed_queries,
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection with one executed member");
        let recomputed = executions
            .iter()
            .filter(|execution| execution.status == ExecutionStatus::Recomputed)
            .map(|execution| execution.query_group_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(recomputed, vec![executed.group]);
    }

    /// The step ladder in `build_runtime_query_executions` resolves `Bypassed`
    /// ahead of `Recomputed`, so a query that is not applicable is badged
    /// `Bypassed` even when Salsa ran its query. Deriving the stage badge from
    /// the member badges therefore loses that execution, and the stage answers
    /// `Cached` -- published as `all-active-queries-reused` -- for a run in
    /// which a query ran.
    ///
    /// `day_coverage` is where the two applicability conditions genuinely
    /// differ (`workflow_contract.rs`): the group is applicable when
    /// `add_no_activity_placeholder_days` alone is on, while its member
    /// `build_participant_day_coverage` additionally requires `enable_day_coverage`. So
    /// the stage is not bypassed, no member is badged `Recomputed`, and the
    /// contradiction is reachable rather than theoretical.
    #[test]
    fn a_bypassed_member_whose_query_ran_still_recomputes_its_stage() {
        let csv = csv();
        let (_request, result, mut semantic_options, _exact_options) =
            direct_pipeline_result(&csv, false);
        semantic_options["process_app_usage"] = Value::Bool(true);
        semantic_options["add_no_activity_placeholder_days"] = Value::Bool(true);
        semantic_options["enable_day_coverage"] = Value::Bool(false);
        let plan = embedded_plan();
        let node = plan
            .query_groups
            .iter()
            .find(|node| node.query_group_id == "day_coverage")
            .expect("day_coverage stage");
        assert!(
            node.applicability.evaluate(&semantic_options),
            "the stage must stay applicable, or `bypassed` would outrank the \
             execution for an unrelated reason"
        );

        // Salsa ran exactly one query in this stage, and it is the member the
        // options make inapplicable.
        let executed_id = "build_participant_day_coverage";
        let query_executions = WORKFLOW_QUERIES
            .iter()
            .map(|definition| RuntimeQueryExecution {
                query_id: definition.id.to_string(),
                query_group_id: definition.group.to_string(),
                status: if definition.id == executed_id {
                    ExecutionStatus::Bypassed
                } else {
                    ExecutionStatus::Cached
                },
                input_key: format!("sha256:{}", "1".repeat(64)),
                output_digest: format!("sha256:{}", "2".repeat(64)),
                reason_id: format!("sha256:{}", "3".repeat(64)),
            })
            .collect::<Vec<_>>();
        assert!(
            !query_executions
                .iter()
                .any(|execution| execution.status == ExecutionStatus::Recomputed),
            "no member is badged recomputed, which is exactly why reading the \
             badges back reported this stage cached"
        );

        let mut previous_stage_inputs = BTreeMap::new();
        let mut previous_stage_outputs = BTreeMap::new();
        let (executions, _artifacts) = project_query_groups(
            &chronicle_chrono_kernel_wasm::payload_store::current_store(),
            plan,
            &semantic_options,
            &result,
            &query_executions,
            &BTreeSet::from([executed_id]),
            &BTreeSet::new(),
            &mut previous_stage_inputs,
            &mut previous_stage_outputs,
            true,
        )
        .expect("projection with one executed but inapplicable member");
        let status = executions
            .iter()
            .find(|execution| execution.query_group_id == "day_coverage")
            .map(|execution| execution.status)
            .expect("day_coverage stage execution");
        assert_eq!(
            status,
            ExecutionStatus::Recomputed,
            "a stage whose member query ran may not claim every active query \
             was reused"
        );
    }

    #[test]
    fn source_role_gates_and_required_view_fields_are_independent() {
        let csv = csv();
        let request: RuntimeRequest = serde_json::from_str(&request(&csv)).unwrap();
        let mut exact = serde_json::to_value(&request.options)
            .unwrap()
            .as_object()
            .unwrap()
            .clone();
        let assignments = BTreeMap::new();
        assert_eq!(
            active_source_roles("decode_source_records", &exact, &assignments),
            BTreeMap::from([("raw_chronicle_csv".to_string(), None)])
        );
        assert!(active_source_roles("mark_app_policy_matches", &exact, &assignments).is_empty());
        exact.insert("use_filter_file".into(), Value::Bool(true));
        assert_eq!(
            active_source_roles("mark_app_policy_matches", &exact, &assignments),
            BTreeMap::from([("filter_file".to_string(), None)])
        );
        assert!(active_source_roles("assemble_result_manifest", &exact, &assignments).is_empty());
        exact.insert("enable_compliance_scoring".into(), Value::Bool(true));
        assert_eq!(
            active_source_roles("assemble_result_manifest", &exact, &assignments),
            BTreeMap::from([("enrolled_devices_file".to_string(), None)])
        );
        exact.insert(
            "usage_session_mode".into(),
            Value::String("screen_usage".into()),
        );
        assert!(active_source_roles("assemble_result_manifest", &exact, &assignments).is_empty());

        let expected_root = format!("sha256:{}", "a".repeat(64));
        let valid = serde_json::json!({
            "viewId": "chronicle-workflow-explorer/v1",
            "schemaId": "urn:chronicle:view:workflow-explorer:v1",
            "rootDigest": expected_root,
        });
        assert!(required_view_contract_matches(
            "workflow-explorer-view-json",
            &valid,
            "workflow-explorer-view-json",
            "chronicle-workflow-explorer/v1",
            "urn:chronicle:view:workflow-explorer:v1",
            expected_root.as_str(),
        ));
        for (kind, view) in [
            ("wrong-kind", valid.clone()),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"wrong", "schemaId":"urn:chronicle:view:workflow-explorer:v1", "rootDigest":expected_root}),
            ),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"chronicle-workflow-explorer/v1", "schemaId":"wrong", "rootDigest":expected_root}),
            ),
            (
                "workflow-explorer-view-json",
                serde_json::json!({"viewId":"chronicle-workflow-explorer/v1", "schemaId":"urn:chronicle:view:workflow-explorer:v1", "rootDigest":"sha256:wrong"}),
            ),
        ] {
            assert!(!required_view_contract_matches(
                kind,
                &view,
                "workflow-explorer-view-json",
                "chronicle-workflow-explorer/v1",
                "urn:chronicle:view:workflow-explorer:v1",
                expected_root.as_str(),
            ));
        }
    }

    /// Raw exposure is limited to the queries that provably need it, across the
    /// WHOLE option space.
    ///
    /// This test used to evaluate `active_source_roles` with an EMPTY exact
    /// options map and assert that every query except `decode_source_records`
    /// was raw-free. With no options present, every predicated binding
    /// evaluates false, so it only ever asserted "no query reads raw
    /// UNCONDITIONALLY" -- weaker than its name, and blind to the three
    /// predicated raw bindings in `query_source_role_bindings`:
    /// `construct_screen_intervals` (unconditional),
    /// `match_app_episodes` (SCHOEDEL_EPISODE_STRATEGY) and
    /// `assemble_result_manifest` (APP_MODE_WITH_EYES_COMPLEMENT). Two of those
    /// predate this change and the empty map hid them both.
    ///
    /// It now names the permitted readers and evaluates every option
    /// combination that can switch a raw binding on, so a NEW raw reader fails
    /// here whether it is gated or not.
    ///
    /// `construct_screen_intervals` is on the list because it publishes the raw
    /// digest as `B05ApplicabilityInput::raw_input_sha256` ->
    /// `applicability.input_digest`, which
    /// `b05_foundational_semantics::validate_screen_construction_output`
    /// compares against the current input when resuming a persisted screen
    /// construction. That binding is a fail-closed tamper check: dropping it
    /// would let a saved construction be resumed against a different input
    /// artifact. Its presence is a deliberate product property, not drift.
    #[test]
    fn raw_artifact_is_exposed_only_to_the_parse_node() {
        // Every query permitted to read the raw artifact, with the reason it is
        // permitted. Adding an entry here is a decision about product data flow.
        const PERMITTED_RAW_READERS: &[(&str, &str)] = &[
            ("decode_source_records", "the parse node itself"),
            (
                "construct_screen_intervals",
                "publishes applicability.input_digest, the resume-time tamper check",
            ),
            (
                "match_app_episodes",
                "Schoedel prose reconstruction re-reads the raw stream",
            ),
            (
                "assemble_result_manifest",
                "EYES complement input-partition preflight",
            ),
        ];

        // Each map switches on a different predicated raw binding. The empty map
        // is kept as the first case so the original unconditional-only coverage
        // is not lost.
        let option_cases: Vec<serde_json::Map<String, Value>> = vec![
            serde_json::Map::new(),
            match serde_json::json!({
                "screen_session_construction_strategy": "parry_toth_2025_session_glance_v1",
            }) {
                Value::Object(map) => map,
                _ => unreachable!(),
            },
            match serde_json::json!({
                "episode_reconstruction_strategy": "schoedel_2026_app_within_screen_prose_v1",
            }) {
                Value::Object(map) => map,
                _ => unreachable!(),
            },
            match serde_json::json!({
                "usage_session_mode": "app_and_screen_usage",
                "episode_reconstruction_strategy": "eyes_complement",
            }) {
                Value::Object(map) => map,
                _ => unreachable!(),
            },
        ];

        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let assignments = BTreeMap::from([(
            "raw_chronicle_csv".to_string(),
            RoleAssignment {
                assignment_id: stable_id(&["assignment", "raw_chronicle_csv", &raw_digest]),
                role_id: "raw_chronicle_csv".into(),
                artifact: ArtifactRef {
                    artifact_id: "artifact:raw_chronicle_csv".into(),
                    digest: raw_digest.clone(),
                    media_type: "text/csv".into(),
                    size: 1,
                    derived_from: Vec::new(),
                    qualifiers: BTreeMap::new(),
                },
                qualifiers: BTreeMap::new(),
                revision: 1,
            },
        )]);
        let expected_identity = Some(Some(RuntimeSourceRoleIdentity {
            artifact_digest: raw_digest.clone(),
            assignment_id: stable_id(&["assignment", "raw_chronicle_csv", &raw_digest]),
        }));

        let mut observed_readers = BTreeSet::new();
        for exact in &option_cases {
            for definition in WORKFLOW_QUERIES {
                let sources = active_source_roles(definition.id, exact, &assignments);
                let reads_raw = sources.contains_key("raw_chronicle_csv");

                // NEGATIVE: nothing outside the named set may reach the raw
                // artifact under any option combination.
                assert!(
                    !reads_raw
                        || PERMITTED_RAW_READERS
                            .iter()
                            .any(|(id, _)| *id == definition.id),
                    "{} must not read the raw artifact (options {exact:?}). If this read is \
                     intended, add it to PERMITTED_RAW_READERS with its justification -- do not \
                     delete this assertion.",
                    definition.id
                );

                if reads_raw {
                    // When a permitted reader is active it must carry the exact
                    // artifact identity, or its input key cannot invalidate.
                    assert_eq!(
                        sources.get("raw_chronicle_csv").cloned(),
                        expected_identity.clone(),
                        "{} binds the raw role without the exact artifact identity",
                        definition.id
                    );
                    observed_readers.insert(definition.id);
                }

                if definition.id == "decode_source_records" {
                    assert_eq!(definition.group, "parse_events");
                    // POSITIVE: the parse node reads raw unconditionally, so it
                    // must be present even with no options set.
                    assert!(
                        reads_raw,
                        "the parse node must always read the raw artifact"
                    );
                }
            }
        }

        // POSITIVE: every permitted reader must actually be reachable. A stale
        // entry here would silently license a raw read that no longer exists.
        let permitted = PERMITTED_RAW_READERS
            .iter()
            .map(|(id, _)| *id)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            observed_readers, permitted,
            "PERMITTED_RAW_READERS does not match the queries that actually bind the raw role"
        );
    }

    #[test]
    fn every_optional_output_family_is_emitted_by_the_rust_authority() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Screen,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Screen,Screen Non-interactive,android,2026-03-07 10:02:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec();
        let mut request_value = request_for_workspace(&csv, '9');
        request_value["options"]["usage_session_mode"] =
            Value::String("app_and_screen_usage".into());
        request_value["options"]["include_screen_output"] = Value::Bool(true);
        request_value["options"]["enable_day_coverage"] = Value::Bool(true);
        request_value["options"]["enable_compliance_scoring"] = Value::Bool(true);
        request_value["options"]["enable_screen_gated_crediting"] = Value::Bool(true);
        request_value["options"]["enable_aggregates"] = Value::Bool(true);
        request_value["options"]["enable_parquet_export"] = Value::Bool(true);
        request_value["options"]["enable_spss_export"] = Value::Bool(true);
        let mut support = RuntimeSupportFiles::default();
        support
            .put_native(
                "study_dates_file",
                "study-dates.csv",
                b"participant_id,start_date,end_date\nP01,2026-03-07,2026-03-07\n",
            )
            .unwrap();
        support
            .put_native(
                "device_sharing_file",
                "device-sharing.csv",
                b"participant_id,sharing_status\nP01,Non-Shared\n",
            )
            .unwrap();
        scientific_preflight_native(&request_value.to_string(), &csv, &support).unwrap();
        let mut handle =
            execute_workspace_native(&request_value.to_string(), &csv, &support).unwrap();
        assert_eq!(handle.manifest_json(), handle.manifest_json);
        let mut correspondence_value = None;
        let kinds = (0..handle.artifact_count())
            .map(|index| {
                let metadata: RuntimeArtifactMetadata =
                    serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                let bytes = handle.take_artifact_bytes(index).unwrap();
                assert!(!bytes.is_empty());
                if metadata.kind == "correspondence-index-json" {
                    correspondence_value = Some(serde_json::from_slice::<Value>(&bytes).unwrap());
                }
                if metadata.media_type == "text/csv" {
                    assert!(metadata.row_count.is_some(), "{} row count", metadata.kind);
                    assert!(
                        metadata.preview_rows.is_none(),
                        "{} should not retain unused CSV preview rows",
                        metadata.kind
                    );
                }
                metadata.kind
            })
            .collect::<BTreeSet<_>>();
        for expected in [
            "app-csv",
            "screen-csv",
            "day-coverage-csv",
            "compliance-csv",
            "credited-app-csv",
            "app-parquet",
            "screen-parquet",
            "app-spss",
            "screen-spss",
            "row-lineage-arrow",
            "result-cell-correspondence-arrow",
        ] {
            assert!(kinds.contains(expected), "missing {expected}: {kinds:?}");
        }
        assert!(kinds.iter().any(|kind| kind.starts_with("aggregate-")));

        let manifest: RuntimeManifest = serde_json::from_str(&handle.manifest_json).unwrap();
        let credited_app_digest = &manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "credited-app-csv")
            .unwrap()
            .digest;
        let correspondence_value = correspondence_value.unwrap();
        let correspondence_edges = correspondence_value["edges"].as_array().unwrap();
        assert!(correspondence_edges.iter().any(|edge| {
            edge["sourceKind"] == "workflow-query-group"
                && edge["sourceId"] == "effective_usage"
                && edge["relation"] == "publishes"
                && edge["targetId"] == *credited_app_digest
        }));
    }

    /// `encode_export_family`'s guard, `!include || !(parquet || spss)`, decides
    /// two independent things: whether this CSV family is published at all, and
    /// whether any binary encoding of it was asked for. A run with both families
    /// included and both formats on separates neither — it enters the body
    /// however the operators are read, which is why
    /// `every_optional_output_family_is_emitted_by_the_rust_authority` above
    /// leaves both operators free. Sweep the cases that do separate them.
    #[test]
    fn export_encoding_is_gated_on_the_family_and_on_at_least_one_format() {
        let csv = concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,Screen,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
            "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n",
            "Study,P01,Target Child,Screen,Screen Non-interactive,android,2026-03-07 10:02:00,America/Chicago\n"
        )
        .as_bytes()
        .to_vec();
        let export_kinds =
            |marker: char, include_app: bool, include_screen: bool, parquet: bool, spss: bool| {
                let mut request_value = request_for_workspace(&csv, marker);
                request_value["options"]["usage_session_mode"] =
                    Value::String("app_and_screen_usage".into());
                request_value["options"]["include_app_output"] = Value::Bool(include_app);
                request_value["options"]["include_screen_output"] = Value::Bool(include_screen);
                request_value["options"]["enable_parquet_export"] = Value::Bool(parquet);
                request_value["options"]["enable_spss_export"] = Value::Bool(spss);
                scientific_preflight_native(
                    &request_value.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                let handle = execute_workspace_native(
                    &request_value.to_string(),
                    &csv,
                    &RuntimeSupportFiles::default(),
                )
                .unwrap();
                (0..handle.artifact_count())
                    .map(|index| {
                        let metadata: RuntimeArtifactMetadata =
                            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap())
                                .unwrap();
                        metadata.kind
                    })
                    .filter(|kind| kind.ends_with("-parquet") || kind.ends_with("-spss"))
                    .collect::<BTreeSet<_>>()
            };

        // One format on is enough to enter the body. Reading the inner `||` as
        // `&&` makes `!(true && false)` true and skips every export.
        assert_eq!(
            export_kinds('0', true, true, true, false),
            BTreeSet::from(["app-parquet".to_string(), "screen-parquet".to_string()]),
            "parquet alone must still be encoded"
        );
        assert_eq!(
            export_kinds('1', true, true, false, true),
            BTreeSet::from(["app-spss".to_string(), "screen-spss".to_string()]),
            "spss alone must still be encoded"
        );

        // An excluded family is never encoded, whatever the formats say.
        // Reading the outer `||` as `&&` makes the guard false for the excluded
        // family, which then gets parsed and published anyway.
        assert_eq!(
            export_kinds('5', false, true, true, true),
            BTreeSet::from(["screen-parquet".to_string(), "screen-spss".to_string()]),
            "an excluded app family must not be encoded"
        );
        assert_eq!(
            export_kinds('6', true, false, true, true),
            BTreeSet::from(["app-parquet".to_string(), "app-spss".to_string()]),
            "an excluded screen family must not be encoded"
        );

        // Neither format on: nothing is encoded and no CSV is reparsed.
        assert_eq!(
            export_kinds('8', true, true, false, false),
            BTreeSet::new(),
            "no export format means no binary export"
        );
    }

    #[test]
    fn internal_error_and_recovery_helpers_are_observable() {
        let mut artifacts = Vec::new();
        let files = ResolvedSupportFiles {
            files: BTreeMap::from([(
                "filter_file".into(),
                ResolvedSupportFile {
                    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    original_bytes: vec![1],
                    pipeline_csv: b"header\n".to_vec(),
                    normalized_from_xlsx: true,
                    content_validation_error: None,
                },
            )]),
        };
        assert!(
            append_normalized_support_artifacts(&chronicle_chrono_kernel_wasm::payload_store::current_store(), &mut artifacts, &BTreeMap::new(), &files)
                .unwrap_err()
                .contains("missing source assignment")
        );
        INCREMENTAL_RUNTIME_STATES.with(|states| {
            record_incremental_workspace_root(
                &mut states.borrow_mut(),
                "unknown-workspace",
                &format!("sha256:{}", "a".repeat(64)),
            );
        });

        let plan = embedded_plan();
        let ledger: Value = serde_json::from_slice(
            &build_execution_ledger(plan, &[], &[], &serde_json::json!({}), "now").unwrap(),
        )
        .unwrap();
        assert!(ledger
            .as_array()
            .unwrap()
            .iter()
            .all(|unit| unit["status"] == "error"));

        let aggregate =
            runtime_aggregate_artifact("aggregate-test", b"x\n".to_vec(), 1, &["input".into()]);
        assert_eq!(aggregate.metadata.row_count, Some(1));
    }

    #[test]
    fn wasm_exported_success_facade_delegates_to_the_native_authority() {
        let csv = csv();
        let request_value = request_for_workspace(&csv, '7');
        let explorer_request = serde_json::json!({
            "options": request_value["options"],
            "supportRoles": [],
        });
        let view: Value = serde_json::from_str(
            &plan_workflow_explorer_view_json(&explorer_request.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(view["viewId"], "chronicle-workflow-explorer/v1");

        let mut support = RuntimeSupportFiles::new();
        support.put("filter_file", b"package_name\n").unwrap();
        support
            .put_with_name("background_apps_file", "background.csv", b"package_name\n")
            .unwrap();
        assert_eq!(support.files["filter_file"].name, "filter_file.csv");
        assert_eq!(support.files["background_apps_file"].name, "background.csv");
        let requirements: Value = serde_json::from_str(
            &evaluate_workspace_requirements(&request_value.to_string(), &csv, &support).unwrap(),
        )
        .unwrap();
        assert_eq!(
            requirements["protocolVersion"],
            "chronicle-requirements-report/v1"
        );
        assert_eq!(requirements["ready"], true);
        let primary = execute_workspace(&request_value.to_string(), csv.clone(), &support).unwrap();
        assert!(primary.manifest_json().contains(EXECUTE_WORKSPACE_COMMAND));
        let mut journal = EvidenceJournal::default();
        journal
            .append(Transition {
                event_kind: "state",
                subject_id: "node",
                from_state: None,
                to_state: MaterializationState::Ready,
                reason_id: "reason",
                source_id: "source",
                revision: 1,
            })
            .unwrap();
        journal
            .append(Transition {
                event_kind: "state",
                subject_id: "node-2",
                from_state: Some(MaterializationState::Ready),
                to_state: MaterializationState::Satisfied,
                reason_id: "reason-2",
                source_id: "source",
                revision: 2,
            })
            .unwrap();
        assert_eq!(
            verify_evidence_journal_cbor(&journal.to_cbor().unwrap()).unwrap(),
            2
        );
    }

    #[test]
    fn semantic_option_units_are_projected_exactly() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let mut options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        options.long_duration_threshold_ns = 43_200_000_000_000;
        options.proximity_interval_ns = 2_500_000_000;
        let projected = semantic_options_value(&options).unwrap();
        assert_eq!(projected["long_duration_threshold_hours"], 12.0);
        assert_eq!(projected["proximity_interval_seconds"], 2.5);
        let projected_keys = projected
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let certified_keys = CERTIFIED_OPTION_KEYS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(projected_keys, certified_keys);
        for excluded in [
            "enable_plotting",
            "enable_activity_heatmap",
            "parallel_processing",
            "parallel_max_workers",
        ] {
            assert!(projected.get(excluded).is_none());
        }
    }

    #[test]
    fn exact_to_certified_option_key_table_matches_the_projection() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        let exact_value = serde_json::to_value(&options).unwrap();
        // The exact-serialization key space is every top-level key the
        // `processing_options` document can carry: the fields this request
        // serializes plus the optional fields that are omitted when absent
        // (the B06 selection keys and marker), which the contract names.
        let exact_keys = exact_value
            .as_object()
            .unwrap()
            .keys()
            .map(String::clone)
            .chain(
                chronicle_chrono_kernel_wasm::workflow_contract::OPTIONAL_REQUEST_FIELDS
                    .iter()
                    .map(|field| (*field).to_string()),
            )
            .collect::<BTreeSet<_>>();

        for (exact_key, certified_keys) in EXACT_TO_CERTIFIED_OPTION_KEYS {
            assert!(
                exact_keys.contains(*exact_key),
                "table exact key {exact_key} is not a serialized option field"
            );
            assert!(
                !CERTIFIED_OPTION_KEYS.contains(exact_key),
                "table exact key {exact_key} is itself certified; identity would be ambiguous"
            );
            for certified_key in *certified_keys {
                assert!(
                    CERTIFIED_OPTION_KEYS.contains(certified_key),
                    "table target {certified_key} is not a certified option key"
                );
            }
        }

        let reachable = exact_keys
            .iter()
            .flat_map(|exact_key| {
                CERTIFIED_OPTION_KEYS
                    .iter()
                    .filter(|certified_key| {
                        exact_option_key_reaches_certified(exact_key, certified_key)
                    })
                    .copied()
            })
            .collect::<BTreeSet<_>>();
        let certified = CERTIFIED_OPTION_KEYS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            reachable, certified,
            "every certified knob key must be reachable from exactly the exact-serialization keys"
        );
    }

    #[test]
    fn method_profile_receipts_bind_every_certified_public_option_and_reject_unsupported_slots() {
        let mut request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        request_value["options"]["filter_match_field"] = json!("application_label");
        request_value["options"]["application_label_exclusions"] =
            json!(["YouTube Vanced", "Basic Daydreams"]);
        let options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        let projected = semantic_options_value(&options).unwrap();
        let projected = projected.as_object().unwrap();
        let mut setting_ids = projected
            .keys()
            .filter(|slot| {
                !["filter_match_field", "application_label_exclusions"].contains(&slot.as_str())
            })
            .map(|slot| format!("setting:{slot}"))
            .collect::<Vec<_>>();
        setting_ids.extend(APPLICATION_LABEL_SETTING_IDS.iter().map(|id| (*id).into()));
        let mut bindings = projected
            .iter()
            .filter(|(slot, _)| {
                !["filter_match_field", "application_label_exclusions"].contains(&slot.as_str())
            })
            .map(|(slot, value)| MethodProfileBindingReceipt {
                setting_id: format!("setting:{slot}"),
                slot: slot.clone(),
                value: value.clone(),
                conformance_fixture_id: "fixture:certified-public-options".into(),
                conformance_result_digest: format!("sha256:{}", "a".repeat(64)),
            })
            .collect::<Vec<_>>();
        for setting_id in APPLICATION_LABEL_SETTING_IDS {
            for slot in ["filter_match_field", "application_label_exclusions"] {
                bindings.push(MethodProfileBindingReceipt {
                    setting_id: setting_id.into(),
                    slot: slot.into(),
                    value: projected[slot].clone(),
                    conformance_fixture_id: APPLICATION_LABEL_FIXTURE_ID.into(),
                    conformance_result_digest: APPLICATION_LABEL_FIXTURE_DIGEST.into(),
                });
            }
        }
        let receipt = MethodProfileReceipt {
            method_profile_id: "profile:certified-public-options".into(),
            source_work_id: "source:certified-public-options".into(),
            source_method_variant_id: "primary".into(),
            source_method_variant_ids: vec!["primary".into()],
            source_method_combination_id: None,
            method_profile_version: "v1".into(),
            setting_ids,
            bindings,
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: Vec::new(),
            diary_replication_binding: None,
        };
        receipt.validate_against(&options).unwrap();

        let mut unsupported = receipt;
        unsupported
            .setting_ids
            .push("setting:parallel_processing".into());
        unsupported.bindings.push(MethodProfileBindingReceipt {
            setting_id: "setting:parallel_processing".into(),
            slot: "parallel_processing".into(),
            value: Value::Bool(true),
            conformance_fixture_id: "fixture:unsupported-public-option".into(),
            conformance_result_digest: format!("sha256:{}", "b".repeat(64)),
        });
        assert!(unsupported
            .validate_against(&options)
            .unwrap_err()
            .contains("slot cannot be verified at the runtime boundary: parallel_processing"));
    }

    #[test]
    fn documentary_receipt_requires_the_exact_closed_registry_fixture() {
        let request_value: Value = serde_json::from_str(&request(&csv())).unwrap();
        let options: PipelineV2OptionsJson =
            serde_json::from_value(request_value["options"].clone()).unwrap();
        let registry: Value = serde_json::from_str(include_str!(
            "../../../web/src/generated/source-artifact-provenance-registry.json"
        ))
        .unwrap();
        let fixture = registry["positive_fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|fixture| {
                fixture["method_setting_id"] == "method-setting-0d4c2d71ec4c6dea11ac19b0"
            })
            .unwrap();
        let setting_id = fixture["method_setting_id"].as_str().unwrap().to_owned();
        let binding = MethodProfileDocumentaryBindingReceipt {
            setting_id: setting_id.clone(),
            registry_input: fixture["input"].clone(),
            conformance_fixture_id: fixture["fixture_id"].as_str().unwrap().to_owned(),
            conformance_result_digest: fixture["result_digest"].as_str().unwrap().to_owned(),
            execution_eligible: false,
        };
        let receipt = MethodProfileReceipt {
            method_profile_id: "method-profile:doi:10.1016/j.chb.2023.107977".into(),
            source_work_id: "doi:10.1016/j.chb.2023.107977".into(),
            source_method_variant_id: "source-configuration-space-8b14e63d69954819163df993".into(),
            source_method_variant_ids: vec!["source-method-variant-documentary".into()],
            source_method_combination_id: None,
            method_profile_version: "literature-sublation-v3-atomic".into(),
            setting_ids: vec![setting_id],
            bindings: Vec::new(),
            input_bindings: Vec::new(),
            documentary_bindings: vec![binding],
            output_bindings: Vec::new(),
            diary_replication_binding: None,
        };
        receipt.validate_against(&options).unwrap();
        let mut forged = receipt.clone();
        forged.documentary_bindings[0].conformance_result_digest =
            format!("sha256:{}", "0".repeat(64));
        assert!(forged.validate_against(&options).is_err());
        let mut forged = receipt.clone();
        forged.documentary_bindings[0]
            .registry_input
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), Value::Bool(true));
        assert!(forged.validate_against(&options).is_err());
        for field in ["profile", "work", "variant", "version"] {
            let mut forged = receipt.clone();
            match field {
                "profile" => forged.method_profile_id = "forged".into(),
                "work" => forged.source_work_id = "doi:forged".into(),
                "variant" => forged.source_method_variant_id = "forged".into(),
                "version" => forged.method_profile_version = "forged".into(),
                _ => unreachable!(),
            }
            assert!(
                forged.validate_against(&options).is_err(),
                "accepted forged outer {field}"
            );
        }
    }
}
