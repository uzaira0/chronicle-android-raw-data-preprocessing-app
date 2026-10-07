//! Frozen B05 screen-construction and Schoedel-prose semantics.
//!
//! This module is deliberately self-contained.  It does not depend on the
//! pipeline's mutable `Row` representation. The integration seam can therefore
//! be reviewed and tested independently from workflow/runtime wiring. All state is partitioned by
//! participant, all source-sensitive scans preserve `source_data_row`, and a
//! source-named strategy either executes with an applicability receipt or
//! refuses -- it never falls back to Chronicle.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION: &str =
    "chronicle-b05-foundational-semantics/v1";
pub const B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION: &str =
    "chronicle-input-capability-evidence/v1";
pub const B05_SOURCE_ADAPTER_ID: &str = "chronicle_android_usage_event_labels_v1";
pub const B05_CAPABILITY_EVIDENCE_ROLE_ID: &str = "input_capability_evidence_file";
pub const B05_SOURCE_CHECKPOINT: &str =
    "post_decode_pre_filter_pre_dedupe_pre_timestamp_correction";
pub const B05_SOURCE_ORDER_INDEX_SPACE: &str = "raw_csv_data_row";
pub const PARRY_TOTH_SOURCE_ARTIFACT_SHA256: &str =
    "sha256:99787f1c01499dfe335283eff4bc067a4da0246475cc3238ffe80fc5cfff792f";
pub const SCHOEDEL_PROSE_STRATEGY_ID: &str = "schoedel_2026_app_within_screen_prose_v1";
pub const SCHOEDEL_RECONSTRUCTION_RECEIPT_PROTOCOL_VERSION: &str =
    "chronicle-schoedel-reconstruction-receipt/v1";
pub const SCHOEDEL_PROSE_SOURCE_IDENTITY: &str = "doi:10.1017/psy.2026.10083";
pub const SCHOEDEL_PROSE_SOURCE_VERSION: &str = "psychometrika_91_3_final_article";
pub const SCHOEDEL_PROSE_SOURCE_LICENSE_STATUS: &str = "cc_by_nc_4_0";
pub const SCHOEDEL_PROSE_SOURCE_SCOPE_ID: &str = "published_prose_core_not_full_osf_pipeline";
pub const SCHOEDEL_PROSE_ADAPTER_ID: &str =
    "chronicle_schoedel_2026_app_within_screen_prose_adapter_v1";
pub const SCHOEDEL_PROSE_COMPLETION_RULE_IDS: &[&str] = &[
    "source_last_same_package_event_before_next_type_1_or_observed_screen_end",
    "chronicle_singleton_zero_length_v1",
    "chronicle_equal_timestamp_source_row_order_v1",
    "chronicle_right_censored_unbounded_v1",
];

/// IDs expected in the synthetic proof report.  Keeping the list next to the
/// implementation makes omission visible during wiring rather than after a
/// campaign has been sealed.
pub const B05_REQUIRED_PROOF_IDS: &[&str] = &[
    "b05_participant_isolation",
    "b05_raw_order_seam",
    "b05_neighborhood_scope",
    "b05_unlock_changes_start",
    "b05_locked_glance",
    "b05_oem_reversed_order",
    "b05_orphans_duplicates_tail",
    "b05_reboot",
    "b05_equal_time_order",
    "b05_combined_label_refusal",
    "b05_api_signal_refusal",
    "b05_capability_evidence_validation",
    "b05_capable_no_event",
    "b05_lineage",
    "schoedel_distinctness",
    "schoedel_singleton_completion",
    "schoedel_equal_time_screen_edge",
    "schoedel_right_censor",
    "schoedel_b05_dependency",
    "schoedel_hidden_screen_output",
    "schoedel_full_refusal",
];

/// Public values that the integration patch must derive/mirror with
/// deterministic `serde` serialization. Enum wire values must use each
/// type's `canonical_id`, never Rust variant names. Struct field names below
/// are already the intended snake_case runtime names.
pub const B05_SERDE_INTEGRATION_TYPES: &[&str] = &[
    "CapabilityId",
    "CapabilityState",
    "EvidenceBasis",
    "CapabilityDecision",
    "B05ParticipantIssue",
    "B05ParticipantDecision",
    "B05ApplicabilityReceiptV1",
    "ScreenSessionConstructionStrategyId",
    "ScientificRelation",
    "B05RefusalReason",
    "EvidenceScope",
    "CapabilityEvidenceOrigin",
    "ObservationDisposition",
    "ScreenIntervalKind",
    "ScreenIntervalCloseReason",
    "ScreenIntervalEvidence",
    "ScreenConstructionIssueCode",
    "ScreenConstructionIssue",
    "ScreenConstructionReceiptV1",
    "SchoedelCompletion",
    "SchoedelEpisodeEvidence",
    "SchoedelIssueCode",
    "SchoedelIssue",
    "SchoedelRefusalReason",
    "SchoedelApplicabilityReceiptV1",
    "SchoedelReconstructionReceiptV1",
];

/// Mechanical notes for the later shared-file wiring pass.
pub const B05_INTEGRATION_WIRING_NOTES: &str = r#"
1. Declare this module from chronicle_chrono_kernel_wasm/src/lib.rs.
2. Project `screen_session_construction_strategy` into
   ScreenSessionConstructionStrategyId::from_canonical_id_strict.
3. Compute the SHA-256 of exact raw CSV bytes and call parse_capability_evidence
   for the optional `input_capability_evidence_file` support role.
4. Build RawB05Event rows immediately after decode, before B01/filter/dedupe/
   timestamp correction/remap/handover ranking. Preserve raw CSV data-row IDs.
5. Call construct_screen_intervals. Chronicle may receive its established
   canonical stream adapter; Parry-Toth and Zhu must receive the raw branch.
6. Store B05ApplicabilityReceiptV1 plus ScreenConstructionReceiptV1 in result,
   provenance, semantic index, cache identity, and the dedicated receipt.
7. Pass immutable ScreenIntervalEvidence values to reconstruct_schoedel_prose
   even when `process_screen_usage` suppresses the screen CSV product.
8. Runtime JSON fields are `screen_session_construction_strategy` and support
   role `input_capability_evidence_file`; the browser camelCase names are
   `screenSessionConstructionStrategy` and `inputCapabilityEvidenceFile`.
9. Add deterministic serde derives/mirrors for every symbol listed in
   B05_SERDE_INTEGRATION_TYPES. Serialize enums through `canonical_id`; do not
   expose Rust variant spellings. Receipt digests in this module already use
   length-prefixed canonical wire values and are independent of JSON map order.
"#;

const CAPABILITY_HEADER: [&str; 8] = [
    "schema_version",
    "raw_input_sha256",
    "participant_id",
    "capability_id",
    "state",
    "evidence_basis",
    "evidence_reference",
    "evidence_sha256",
];

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum CapabilityId {
    #[serde(rename = "android_usage_event_15_screen_interactive")]
    AndroidUsageEvent15ScreenInteractive,
    #[serde(rename = "android_usage_event_16_screen_non_interactive")]
    AndroidUsageEvent16ScreenNonInteractive,
    #[serde(rename = "android_usage_event_17_keyguard_shown")]
    AndroidUsageEvent17KeyguardShown,
    #[serde(rename = "android_usage_event_18_keyguard_hidden")]
    AndroidUsageEvent18KeyguardHidden,
    #[serde(rename = "android_usage_event_26_device_shutdown")]
    AndroidUsageEvent26DeviceShutdown,
    #[serde(rename = "android_usage_event_27_device_startup")]
    AndroidUsageEvent27DeviceStartup,
    #[serde(rename = "separate_screen_keyguard_event_rows")]
    SeparateScreenKeyguardEventRows,
    #[serde(rename = "full_unfiltered_source_event_stream")]
    FullUnfilteredSourceEventStream,
    #[serde(rename = "source_record_order_preserved")]
    SourceRecordOrderPreserved,
    #[serde(rename = "equal_timestamp_source_order_preserved")]
    EqualTimestampSourceOrderPreserved,
    #[serde(rename = "single_device_stream_per_participant")]
    SingleDeviceStreamPerParticipant,
    #[serde(rename = "complete_observation_window_chunk")]
    CompleteObservationWindowChunk,
    /// Whether Android/system default apps are represented in the collected
    /// app stream. This is parsed for literature input dispositions and is not
    /// a B05 screen-strategy requirement.
    #[serde(rename = "android_default_apps_captured")]
    AndroidDefaultAppsCaptured,
    /// Whether the participant granted the UsageStats permission required for
    /// collection. An absent claim can drive a source-declared participant
    /// exclusion before the ordinary pipeline runs.
    #[serde(rename = "android_usage_stats_permission_granted")]
    AndroidUsageStatsPermissionGranted,
    /// Whether hourly screen-time observations are complete throughout the
    /// paper-selected rolling 30-day window. This literature-only capability
    /// is distinct from structural completeness of a supplied event chunk.
    #[serde(rename = "selected_30_day_screen_time_data_complete")]
    Selected30DayScreenTimeDataComplete,
}

impl CapabilityId {
    pub const ALL: [Self; 12] = [
        Self::AndroidUsageEvent15ScreenInteractive,
        Self::AndroidUsageEvent16ScreenNonInteractive,
        Self::AndroidUsageEvent17KeyguardShown,
        Self::AndroidUsageEvent18KeyguardHidden,
        Self::AndroidUsageEvent26DeviceShutdown,
        Self::AndroidUsageEvent27DeviceStartup,
        Self::SeparateScreenKeyguardEventRows,
        Self::FullUnfilteredSourceEventStream,
        Self::SourceRecordOrderPreserved,
        Self::EqualTimestampSourceOrderPreserved,
        Self::SingleDeviceStreamPerParticipant,
        Self::CompleteObservationWindowChunk,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::AndroidUsageEvent15ScreenInteractive => {
                "android_usage_event_15_screen_interactive"
            }
            Self::AndroidUsageEvent16ScreenNonInteractive => {
                "android_usage_event_16_screen_non_interactive"
            }
            Self::AndroidUsageEvent17KeyguardShown => "android_usage_event_17_keyguard_shown",
            Self::AndroidUsageEvent18KeyguardHidden => "android_usage_event_18_keyguard_hidden",
            Self::AndroidUsageEvent26DeviceShutdown => "android_usage_event_26_device_shutdown",
            Self::AndroidUsageEvent27DeviceStartup => "android_usage_event_27_device_startup",
            Self::SeparateScreenKeyguardEventRows => "separate_screen_keyguard_event_rows",
            Self::FullUnfilteredSourceEventStream => "full_unfiltered_source_event_stream",
            Self::SourceRecordOrderPreserved => "source_record_order_preserved",
            Self::EqualTimestampSourceOrderPreserved => "equal_timestamp_source_order_preserved",
            Self::SingleDeviceStreamPerParticipant => "single_device_stream_per_participant",
            Self::CompleteObservationWindowChunk => "complete_observation_window_chunk",
            Self::AndroidDefaultAppsCaptured => "android_default_apps_captured",
            Self::AndroidUsageStatsPermissionGranted => "android_usage_stats_permission_granted",
            Self::Selected30DayScreenTimeDataComplete => {
                "selected_30_day_screen_time_data_complete"
            }
        }
    }

    pub fn from_canonical_id(value: &str) -> Option<Self> {
        Some(match value {
            "android_usage_event_15_screen_interactive" => {
                Self::AndroidUsageEvent15ScreenInteractive
            }
            "android_usage_event_16_screen_non_interactive" => {
                Self::AndroidUsageEvent16ScreenNonInteractive
            }
            "android_usage_event_17_keyguard_shown" => Self::AndroidUsageEvent17KeyguardShown,
            "android_usage_event_18_keyguard_hidden" => Self::AndroidUsageEvent18KeyguardHidden,
            "android_usage_event_26_device_shutdown" => Self::AndroidUsageEvent26DeviceShutdown,
            "android_usage_event_27_device_startup" => Self::AndroidUsageEvent27DeviceStartup,
            "separate_screen_keyguard_event_rows" => Self::SeparateScreenKeyguardEventRows,
            "full_unfiltered_source_event_stream" => Self::FullUnfilteredSourceEventStream,
            "source_record_order_preserved" => Self::SourceRecordOrderPreserved,
            "equal_timestamp_source_order_preserved" => Self::EqualTimestampSourceOrderPreserved,
            "single_device_stream_per_participant" => Self::SingleDeviceStreamPerParticipant,
            "complete_observation_window_chunk" => Self::CompleteObservationWindowChunk,
            "android_default_apps_captured" => Self::AndroidDefaultAppsCaptured,
            "android_usage_stats_permission_granted" => Self::AndroidUsageStatsPermissionGranted,
            "selected_30_day_screen_time_data_complete" => {
                Self::Selected30DayScreenTimeDataComplete
            }
            _ => return None,
        })
    }

    fn observed_signal(self) -> Option<AndroidUsageSignal> {
        Some(match self {
            Self::AndroidUsageEvent15ScreenInteractive => AndroidUsageSignal::ScreenInteractive,
            Self::AndroidUsageEvent16ScreenNonInteractive => {
                AndroidUsageSignal::ScreenNonInteractive
            }
            Self::AndroidUsageEvent17KeyguardShown => AndroidUsageSignal::KeyguardShown,
            Self::AndroidUsageEvent18KeyguardHidden => AndroidUsageSignal::KeyguardHidden,
            Self::AndroidUsageEvent26DeviceShutdown => AndroidUsageSignal::DeviceShutdown,
            Self::AndroidUsageEvent27DeviceStartup => AndroidUsageSignal::DeviceStartup,
            Self::SeparateScreenKeyguardEventRows
            | Self::FullUnfilteredSourceEventStream
            | Self::SourceRecordOrderPreserved
            | Self::EqualTimestampSourceOrderPreserved
            | Self::SingleDeviceStreamPerParticipant
            | Self::CompleteObservationWindowChunk
            | Self::AndroidDefaultAppsCaptured
            | Self::AndroidUsageStatsPermissionGranted
            | Self::Selected30DayScreenTimeDataComplete => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Capable,
    Absent,
    Unknown,
}

impl CapabilityState {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Capable => "capable",
            Self::Absent => "absent",
            Self::Unknown => "unknown",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "capable" => Self::Capable,
            "absent" => Self::Absent,
            "unknown" => Self::Unknown,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceBasis {
    ProducerManifest,
    ExporterReceipt,
    TransformationReceipt,
    StudyProtocol,
    OperatorAttestation,
    Unspecified,
}

impl EvidenceBasis {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ProducerManifest => "producer_manifest",
            Self::ExporterReceipt => "exporter_receipt",
            Self::TransformationReceipt => "transformation_receipt",
            Self::StudyProtocol => "study_protocol",
            Self::OperatorAttestation => "operator_attestation",
            Self::Unspecified => "unspecified",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "producer_manifest" => Self::ProducerManifest,
            "exporter_receipt" => Self::ExporterReceipt,
            "transformation_receipt" => Self::TransformationReceipt,
            "study_protocol" => Self::StudyProtocol,
            "operator_attestation" => Self::OperatorAttestation,
            "unspecified" => Self::Unspecified,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityClaim {
    pub physical_data_row: u32,
    pub raw_input_sha256: String,
    pub participant_id: String,
    pub capability_id: CapabilityId,
    pub state: CapabilityState,
    pub evidence_basis: EvidenceBasis,
    pub evidence_reference: String,
    pub evidence_sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCapabilityEvidence {
    pub claims: Vec<CapabilityClaim>,
    pub evidence_artifact_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelSourceOrderParticipantDecision {
    pub participant_id: String,
    pub decision: CapabilityDecision,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelSourceOrderResolution {
    pub protocol_version: String,
    pub raw_input_sha256: String,
    pub evidence_artifact_digest: Option<String>,
    pub evidence_assignment_digest: Option<String>,
    pub evidence_bound_to_input: bool,
    pub participant_decisions: Vec<SchoedelSourceOrderParticipantDecision>,
    pub resolution_digest: String,
}

impl SchoedelSourceOrderResolution {
    pub fn capable_participants(&self) -> BTreeSet<String> {
        self.participant_decisions
            .iter()
            .filter(|participant| participant.decision.effective_state == CapabilityState::Capable)
            .map(|participant| participant.participant_id.clone())
            .collect()
    }
}

/// Resolve the structural source-order capability independently of the
/// selected B05 screen strategy. This is required because a Schoedel app tie
/// can be decisive even when the screen constructor had no decisive tie.
pub fn resolve_schoedel_source_order_capability(
    raw_input_sha256: &str,
    participant_ids: &BTreeSet<String>,
    evidence: Option<&ParsedCapabilityEvidence>,
    evidence_assignment_digest: Option<&str>,
) -> SchoedelSourceOrderResolution {
    let mut participant_decisions = Vec::with_capacity(participant_ids.len());
    for participant_id in participant_ids {
        let exact = evidence.and_then(|parsed| {
            parsed.claims.iter().find(|claim| {
                claim.raw_input_sha256 == raw_input_sha256
                    && claim.participant_id == *participant_id
                    && claim.capability_id == CapabilityId::EqualTimestampSourceOrderPreserved
            })
        });
        let wildcard = evidence.and_then(|parsed| {
            parsed.claims.iter().find(|claim| {
                claim.raw_input_sha256 == raw_input_sha256
                    && claim.participant_id == "*"
                    && claim.capability_id == CapabilityId::EqualTimestampSourceOrderPreserved
            })
        });
        let claim = exact.or(wildcard);
        let evidence_scope = if exact.is_some() {
            EvidenceScope::Exact
        } else if wildcard.is_some() {
            EvidenceScope::Wildcard
        } else {
            EvidenceScope::None
        };
        let asserted_state = claim.map(|claim| claim.state);
        let effective_state = asserted_state.unwrap_or(CapabilityState::Unknown);
        participant_decisions.push(SchoedelSourceOrderParticipantDecision {
            participant_id: participant_id.clone(),
            decision: CapabilityDecision {
                capability_id: CapabilityId::EqualTimestampSourceOrderPreserved,
                asserted_state,
                effective_state,
                evidence_scope,
                evidence_origin: if claim.is_some() {
                    CapabilityEvidenceOrigin::ManifestAssertion
                } else {
                    CapabilityEvidenceOrigin::None
                },
                evidence_basis: claim.map(|claim| claim.evidence_basis),
                evidence_reference: claim.map(|claim| claim.evidence_reference.clone()),
                evidence_sha256: claim.and_then(|claim| claim.evidence_sha256.clone()),
                observed_standalone_row_count: 0,
                observation_disposition: match effective_state {
                    CapabilityState::Capable => ObservationDisposition::CapableNoRow,
                    CapabilityState::Absent => ObservationDisposition::Absent,
                    CapabilityState::Unknown => ObservationDisposition::Unknown,
                },
                claim_physical_data_row: claim.map(|claim| claim.physical_data_row),
            },
        });
    }
    let evidence_artifact_digest = evidence.map(|parsed| parsed.evidence_artifact_digest.clone());
    let evidence_bound_to_input = evidence.is_none_or(|parsed| {
        parsed
            .claims
            .iter()
            .any(|claim| claim.raw_input_sha256 == raw_input_sha256)
    });
    let mut resolution = SchoedelSourceOrderResolution {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        raw_input_sha256: raw_input_sha256.into(),
        evidence_artifact_digest,
        evidence_assignment_digest: evidence_assignment_digest.map(str::to_owned),
        evidence_bound_to_input,
        participant_decisions,
        resolution_digest: String::new(),
    };
    resolution.resolution_digest = schoedel_source_order_resolution_digest(&resolution);
    resolution
}

fn schoedel_source_order_resolution_digest(resolution: &SchoedelSourceOrderResolution) -> String {
    let mut material = Vec::new();
    for field in [
        resolution.protocol_version.as_str(),
        resolution.raw_input_sha256.as_str(),
        resolution.evidence_artifact_digest.as_deref().unwrap_or(""),
        resolution
            .evidence_assignment_digest
            .as_deref()
            .unwrap_or(""),
        if resolution.evidence_bound_to_input {
            "bound"
        } else {
            "unbound"
        },
    ] {
        digest_field(&mut material, field);
    }
    for participant in &resolution.participant_decisions {
        digest_field(&mut material, &participant.participant_id);
        let decision = &participant.decision;
        digest_field(
            &mut material,
            decision
                .asserted_state
                .map(CapabilityState::canonical_id)
                .unwrap_or(""),
        );
        digest_field(&mut material, decision.effective_state.canonical_id());
        digest_field(&mut material, decision.evidence_scope.canonical_id());
        digest_field(&mut material, decision.evidence_origin.canonical_id());
        digest_field(
            &mut material,
            decision
                .evidence_basis
                .map(EvidenceBasis::canonical_id)
                .unwrap_or(""),
        );
        digest_field(
            &mut material,
            decision.evidence_reference.as_deref().unwrap_or(""),
        );
        digest_field(
            &mut material,
            decision.evidence_sha256.as_deref().unwrap_or(""),
        );
        digest_field(
            &mut material,
            &decision
                .claim_physical_data_row
                .unwrap_or_default()
                .to_string(),
        );
    }
    sha256_wire(&material)
}

/// Validate every digest-bound sidecar claim against signals observable in
/// the exact raw stream, even when the selected screen strategy does not use
/// that claim. This keeps Chronicle+Schoedel from accepting a structurally
/// valid but internally contradictory capability artifact.
pub fn validate_bound_capability_evidence(
    raw_input_sha256: &str,
    raw_events: &[RawB05Event],
    evidence: Option<&ParsedCapabilityEvidence>,
) -> Result<(), CapabilityEvidenceError> {
    let Some(evidence) = evidence else {
        return Ok(());
    };
    for event in raw_events {
        let Some(capability_id) = event.signal.capability() else {
            continue;
        };
        let exact = evidence.claims.iter().find(|claim| {
            claim.raw_input_sha256 == raw_input_sha256
                && claim.participant_id == event.participant_id
                && claim.capability_id == capability_id
        });
        let wildcard = evidence.claims.iter().find(|claim| {
            claim.raw_input_sha256 == raw_input_sha256
                && claim.participant_id == "*"
                && claim.capability_id == capability_id
        });
        if let Some(claim) = exact.or(wildcard) {
            if claim.state == CapabilityState::Absent {
                return Err(CapabilityEvidenceError::new(
                    CapabilityEvidenceErrorDetail::ObservedSignalContradiction,
                    Some(claim.physical_data_row),
                ));
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityEvidenceErrorDetail {
    EmptyArtifact,
    InvalidUtf8,
    MalformedCsv,
    WrongHeader,
    WrongColumnCount,
    WrongSchemaVersion,
    MalformedRawInputDigest,
    EmptyParticipantId,
    UnknownCapabilityId,
    UnknownState,
    UnknownEvidenceBasis,
    InvalidConditionalEvidenceFields,
    MalformedEvidenceDigest,
    DuplicateClaim,
    ObservedSignalContradiction,
    ChronicleBaselineRequiresCanonicalAdapter,
}

impl CapabilityEvidenceErrorDetail {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::EmptyArtifact => "empty_artifact",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::MalformedCsv => "malformed_csv",
            Self::WrongHeader => "wrong_header",
            Self::WrongColumnCount => "wrong_column_count",
            Self::WrongSchemaVersion => "wrong_schema_version",
            Self::MalformedRawInputDigest => "malformed_raw_input_digest",
            Self::EmptyParticipantId => "empty_participant_id",
            Self::UnknownCapabilityId => "unknown_capability_id",
            Self::UnknownState => "unknown_state",
            Self::UnknownEvidenceBasis => "unknown_evidence_basis",
            Self::InvalidConditionalEvidenceFields => "invalid_conditional_evidence_fields",
            Self::MalformedEvidenceDigest => "malformed_evidence_digest",
            Self::DuplicateClaim => "duplicate_claim",
            Self::ObservedSignalContradiction => "observed_signal_contradiction",
            Self::ChronicleBaselineRequiresCanonicalAdapter => {
                "chronicle_baseline_requires_canonical_adapter"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityEvidenceError {
    pub class: &'static str,
    pub detail: CapabilityEvidenceErrorDetail,
    /// One-based physical line on which the CSV record begins.  `None` is used
    /// for artifact/header errors.  Raw cell contents are intentionally absent.
    pub physical_data_row: Option<u32>,
}

impl CapabilityEvidenceError {
    fn new(detail: CapabilityEvidenceErrorDetail, physical_data_row: Option<u32>) -> Self {
        Self {
            class: "invalid_input_capability_evidence",
            detail,
            physical_data_row,
        }
    }
}

impl fmt::Display for CapabilityEvidenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.class, self.detail.canonical_id())?;
        if let Some(row) = self.physical_data_row {
            write!(formatter, ":row={row}")?;
        }
        Ok(())
    }
}

impl std::error::Error for CapabilityEvidenceError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CsvRecord {
    fields: Vec<String>,
    start_line: u32,
}

/// Parse the closed, long-form capability sidecar and commit its exact bytes.
/// The current raw digest is deliberately *not* selected here; syntactically
/// valid foreign-digest rows remain part of the artifact commitment.
pub fn parse_capability_evidence(
    bytes: &[u8],
) -> Result<ParsedCapabilityEvidence, CapabilityEvidenceError> {
    if bytes.is_empty() {
        return Err(CapabilityEvidenceError::new(
            CapabilityEvidenceErrorDetail::EmptyArtifact,
            None,
        ));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        CapabilityEvidenceError::new(CapabilityEvidenceErrorDetail::InvalidUtf8, None)
    })?;
    let records = parse_csv_records(text)?;
    let Some(header) = records.first() else {
        return Err(CapabilityEvidenceError::new(
            CapabilityEvidenceErrorDetail::EmptyArtifact,
            None,
        ));
    };
    if header.fields.iter().map(String::as_str).collect::<Vec<_>>() != CAPABILITY_HEADER {
        return Err(CapabilityEvidenceError::new(
            CapabilityEvidenceErrorDetail::WrongHeader,
            None,
        ));
    }
    if records.len() == 1 {
        return Err(CapabilityEvidenceError::new(
            CapabilityEvidenceErrorDetail::EmptyArtifact,
            None,
        ));
    }

    let mut claims = Vec::with_capacity(records.len() - 1);
    let mut identities = BTreeSet::new();
    for record in records.into_iter().skip(1) {
        let row = Some(record.start_line);
        if record.fields.len() != CAPABILITY_HEADER.len() {
            return Err(CapabilityEvidenceError::new(
                CapabilityEvidenceErrorDetail::WrongColumnCount,
                row,
            ));
        }
        if record.fields[0] != B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION {
            return Err(CapabilityEvidenceError::new(
                CapabilityEvidenceErrorDetail::WrongSchemaVersion,
                row,
            ));
        }
        if !is_sha256_wire(&record.fields[1]) {
            return Err(CapabilityEvidenceError::new(
                CapabilityEvidenceErrorDetail::MalformedRawInputDigest,
                row,
            ));
        }
        if record.fields[2].is_empty() {
            return Err(CapabilityEvidenceError::new(
                CapabilityEvidenceErrorDetail::EmptyParticipantId,
                row,
            ));
        }
        let capability_id =
            CapabilityId::from_canonical_id(&record.fields[3]).ok_or_else(|| {
                CapabilityEvidenceError::new(
                    CapabilityEvidenceErrorDetail::UnknownCapabilityId,
                    row,
                )
            })?;
        let state = CapabilityState::parse(&record.fields[4]).ok_or_else(|| {
            CapabilityEvidenceError::new(CapabilityEvidenceErrorDetail::UnknownState, row)
        })?;
        let evidence_basis = EvidenceBasis::parse(&record.fields[5]).ok_or_else(|| {
            CapabilityEvidenceError::new(CapabilityEvidenceErrorDetail::UnknownEvidenceBasis, row)
        })?;
        let reference = &record.fields[6];
        let evidence_digest = &record.fields[7];
        match state {
            CapabilityState::Capable | CapabilityState::Absent => {
                if evidence_basis == EvidenceBasis::Unspecified || reference.is_empty() {
                    return Err(CapabilityEvidenceError::new(
                        CapabilityEvidenceErrorDetail::InvalidConditionalEvidenceFields,
                        row,
                    ));
                }
                if !evidence_digest.is_empty() && !is_sha256_wire(evidence_digest) {
                    return Err(CapabilityEvidenceError::new(
                        CapabilityEvidenceErrorDetail::MalformedEvidenceDigest,
                        row,
                    ));
                }
            }
            CapabilityState::Unknown => {
                if evidence_basis != EvidenceBasis::Unspecified
                    || !reference.is_empty()
                    || !evidence_digest.is_empty()
                {
                    return Err(CapabilityEvidenceError::new(
                        CapabilityEvidenceErrorDetail::InvalidConditionalEvidenceFields,
                        row,
                    ));
                }
            }
        }
        let identity = (
            record.fields[1].clone(),
            record.fields[2].clone(),
            capability_id,
        );
        if !identities.insert(identity) {
            return Err(CapabilityEvidenceError::new(
                CapabilityEvidenceErrorDetail::DuplicateClaim,
                row,
            ));
        }
        claims.push(CapabilityClaim {
            physical_data_row: record.start_line,
            raw_input_sha256: record.fields[1].clone(),
            participant_id: record.fields[2].clone(),
            capability_id,
            state,
            evidence_basis,
            evidence_reference: reference.clone(),
            evidence_sha256: (!evidence_digest.is_empty()).then(|| evidence_digest.clone()),
        });
    }

    Ok(ParsedCapabilityEvidence {
        claims,
        evidence_artifact_digest: sha256_wire(bytes),
    })
}

fn parse_csv_records(text: &str) -> Result<Vec<CsvRecord>, CapabilityEvidenceError> {
    let mut records = Vec::new();
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut after_quote = false;
    let mut line = 1_u32;
    let mut record_start_line = 1_u32;
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if quoted {
            match ch {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    field.push('"');
                }
                '"' => {
                    quoted = false;
                    after_quote = true;
                }
                '\n' => {
                    line += 1;
                    field.push(ch);
                }
                _ => field.push(ch),
            }
            continue;
        }
        if after_quote {
            match ch {
                ',' => {
                    fields.push(std::mem::take(&mut field));
                    after_quote = false;
                }
                '\n' => {
                    fields.push(std::mem::take(&mut field));
                    records.push(CsvRecord {
                        fields: std::mem::take(&mut fields),
                        start_line: record_start_line,
                    });
                    line += 1;
                    record_start_line = line;
                    after_quote = false;
                }
                '\r' if chars.peek() == Some(&'\n') => {
                    chars.next();
                    fields.push(std::mem::take(&mut field));
                    records.push(CsvRecord {
                        fields: std::mem::take(&mut fields),
                        start_line: record_start_line,
                    });
                    line += 1;
                    record_start_line = line;
                    after_quote = false;
                }
                _ => {
                    return Err(CapabilityEvidenceError::new(
                        CapabilityEvidenceErrorDetail::MalformedCsv,
                        Some(record_start_line),
                    ));
                }
            }
            continue;
        }
        match ch {
            '"' if field.is_empty() => quoted = true,
            '"' => {
                return Err(CapabilityEvidenceError::new(
                    CapabilityEvidenceErrorDetail::MalformedCsv,
                    Some(record_start_line),
                ));
            }
            ',' => fields.push(std::mem::take(&mut field)),
            '\n' => {
                fields.push(std::mem::take(&mut field));
                records.push(CsvRecord {
                    fields: std::mem::take(&mut fields),
                    start_line: record_start_line,
                });
                line += 1;
                record_start_line = line;
            }
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
                fields.push(std::mem::take(&mut field));
                records.push(CsvRecord {
                    fields: std::mem::take(&mut fields),
                    start_line: record_start_line,
                });
                line += 1;
                record_start_line = line;
            }
            _ => field.push(ch),
        }
    }
    if quoted {
        return Err(CapabilityEvidenceError::new(
            CapabilityEvidenceErrorDetail::MalformedCsv,
            Some(record_start_line),
        ));
    }
    if after_quote || !field.is_empty() || !fields.is_empty() {
        fields.push(field);
        records.push(CsvRecord {
            fields,
            start_line: record_start_line,
        });
    }
    while records.last().is_some_and(|record| {
        record.fields.len() == 1 && record.fields.first().is_some_and(String::is_empty)
    }) {
        records.pop();
    }
    Ok(records)
}

fn is_sha256_wire(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn sha256_wire(bytes: &[u8]) -> String {
    let digest = sha256(bytes);
    let mut output = String::with_capacity(71);
    output.push_str("sha256:");
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String is infallible");
    }
    output
}

/// Exact runtime RoleAssignment identity for the capability sidecar:
/// stable_id(["assignment", role_id, artifact_digest]).
pub fn capability_evidence_assignment_digest(evidence_artifact_digest: &str) -> String {
    sha256_wire(
        format!(
            "assignment\u{1f}{B05_CAPABILITY_EVIDENCE_ROLE_ID}\u{1f}{evidence_artifact_digest}"
        )
        .as_bytes(),
    )
}

// Minimal FIPS 180-4 SHA-256 used so this un-wired module can be tested with
// `rustc --test`.  The integrated crate may replace this helper with `sha2`,
// provided the byte-level tests remain exact.
fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());
    for block in padded.as_chunks::<64>().0 {
        let mut w = [0_u32; 64];
        for (index, word) in block.as_chunks::<4>().0.iter().enumerate() {
            w[index] = u32::from_be_bytes(*word);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(majority);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut output = [0_u8; 32];
    for (chunk, value) in output.as_chunks_mut::<4>().0.iter_mut().zip(h) {
        *chunk = value.to_be_bytes();
    }
    output
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum AndroidUsageSignal {
    ActivityResumed,
    ScreenInteractive,
    ScreenNonInteractive,
    KeyguardShown,
    KeyguardHidden,
    DeviceShutdown,
    DeviceStartup,
    CombinedScreenInteractiveKeyguardShown,
    CombinedScreenNonInteractiveKeyguardHidden,
    Other,
}

impl AndroidUsageSignal {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ActivityResumed => "activity_resumed",
            Self::ScreenInteractive => "screen_interactive",
            Self::ScreenNonInteractive => "screen_non_interactive",
            Self::KeyguardShown => "keyguard_shown",
            Self::KeyguardHidden => "keyguard_hidden",
            Self::DeviceShutdown => "device_shutdown",
            Self::DeviceStartup => "device_startup",
            Self::CombinedScreenInteractiveKeyguardShown => {
                "combined_screen_interactive_keyguard_shown"
            }
            Self::CombinedScreenNonInteractiveKeyguardHidden => {
                "combined_screen_non_interactive_keyguard_hidden"
            }
            Self::Other => "other",
        }
    }

    fn is_fused(self) -> bool {
        matches!(
            self,
            Self::CombinedScreenInteractiveKeyguardShown
                | Self::CombinedScreenNonInteractiveKeyguardHidden
        )
    }

    fn capability(self) -> Option<CapabilityId> {
        Some(match self {
            Self::ScreenInteractive => CapabilityId::AndroidUsageEvent15ScreenInteractive,
            Self::ScreenNonInteractive => CapabilityId::AndroidUsageEvent16ScreenNonInteractive,
            Self::KeyguardShown => CapabilityId::AndroidUsageEvent17KeyguardShown,
            Self::KeyguardHidden => CapabilityId::AndroidUsageEvent18KeyguardHidden,
            Self::DeviceShutdown => CapabilityId::AndroidUsageEvent26DeviceShutdown,
            Self::DeviceStartup => CapabilityId::AndroidUsageEvent27DeviceStartup,
            Self::ActivityResumed
            | Self::CombinedScreenInteractiveKeyguardShown
            | Self::CombinedScreenNonInteractiveKeyguardHidden
            | Self::Other => return None,
        })
    }
}

/// Frozen raw-label adapter.  User interaction remaps must not feed this
/// function.  Adding a spelling is a protocol change because it changes what
/// can count as an observation in a digest-bound input.
pub fn recognize_android_usage_signal_v1(raw_label: &str) -> AndroidUsageSignal {
    match raw_label {
        "Activity Resumed"
        | "ACTIVITY_RESUMED"
        | "Move to Foreground"
        | "Unknown importance: 1"
        | "1" => AndroidUsageSignal::ActivityResumed,
        "Screen Interactive" | "SCREEN_INTERACTIVE" | "Unknown importance: 15" | "15" => {
            AndroidUsageSignal::ScreenInteractive
        }
        "Screen Non-Interactive" | "Screen Non-interactive" | "SCREEN_NON_INTERACTIVE" | "Unknown importance: 16" | "16" => {
            AndroidUsageSignal::ScreenNonInteractive
        }
        "Keyguard Shown" | "KEYGUARD_SHOWN" | "Unknown importance: 17" | "17" => {
            AndroidUsageSignal::KeyguardShown
        }
        "Keyguard Hidden" | "KEYGUARD_HIDDEN" | "Unknown importance: 18" | "18" => {
            AndroidUsageSignal::KeyguardHidden
        }
        "Device Shutdown" | "DEVICE_SHUTDOWN" | "Unknown importance: 26" | "26" => {
            AndroidUsageSignal::DeviceShutdown
        }
        "Device Startup" | "DEVICE_STARTUP" | "Unknown importance: 27" | "27" => {
            AndroidUsageSignal::DeviceStartup
        }
        "Screen Interactive/Keyguard Shown" => {
            AndroidUsageSignal::CombinedScreenInteractiveKeyguardShown
        }
        "Screen Non-Interactive/Keyguard Hidden" => {
            AndroidUsageSignal::CombinedScreenNonInteractiveKeyguardHidden
        }
        _ => AndroidUsageSignal::Other,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawB05Event {
    pub participant_id: String,
    pub timestamp_ns: Option<i64>,
    /// One-based row number in the original raw CSV, excluding no rows and
    /// before any participant partition is materialized.
    pub source_data_row: u32,
    /// Complete physical lineage represented by this logical row. Raw decode
    /// uses one member; post-dedupe app composition can retain several while
    /// `source_data_row` remains the stable ordering key.
    pub source_data_rows: Vec<u32>,
    pub raw_interaction_type: String,
    pub signal: AndroidUsageSignal,
    pub package_name: Option<String>,
    /// App-axis eligibility after B01 retention and B02 opener selection.
    /// B05 ignores this field. Raw adapters default it to native Android
    /// type-1 membership; composed callers may override it before Schoedel.
    pub app_opener_eligible: bool,
}

impl RawB05Event {
    pub fn from_raw_label(
        participant_id: impl Into<String>,
        timestamp_ns: Option<i64>,
        source_data_row: u32,
        raw_interaction_type: impl Into<String>,
        package_name: Option<String>,
    ) -> Self {
        let raw_interaction_type = raw_interaction_type.into();
        let signal = recognize_android_usage_signal_v1(&raw_interaction_type);
        Self {
            participant_id: participant_id.into(),
            timestamp_ns,
            source_data_row,
            source_data_rows: vec![source_data_row],
            signal,
            raw_interaction_type,
            package_name,
            app_opener_eligible: signal == AndroidUsageSignal::ActivityResumed,
        }
    }

    pub fn with_app_opener_eligible(mut self, eligible: bool) -> Self {
        self.app_opener_eligible = eligible;
        self
    }

    pub fn with_source_data_rows(mut self, mut source_data_rows: Vec<u32>) -> Self {
        source_data_rows.sort_unstable();
        source_data_rows.dedup();
        if !source_data_rows.contains(&self.source_data_row) {
            source_data_rows.push(self.source_data_row);
            source_data_rows.sort_unstable();
        }
        self.source_data_rows = source_data_rows;
        self
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ScreenSessionConstructionStrategyId {
    #[default]
    #[serde(rename = "chronicle_screen_interactive_v1")]
    ChronicleScreenInteractiveV1,
    #[serde(rename = "parry_toth_2025_session_glance_v1")]
    ParryToth2025SessionGlanceV1,
    #[serde(rename = "zhu_2018_unlock_lock_v1")]
    Zhu2018UnlockLockV1,
    #[serde(rename = "unlock_to_lock_v1")]
    UnlockToLockV1,
    #[serde(rename = "unlock_to_off_or_lock_v1")]
    UnlockToOffOrLockV1,
}

impl ScreenSessionConstructionStrategyId {
    pub const ALL: [Self; 5] = [
        Self::ChronicleScreenInteractiveV1,
        Self::ParryToth2025SessionGlanceV1,
        Self::Zhu2018UnlockLockV1,
        Self::UnlockToLockV1,
        Self::UnlockToOffOrLockV1,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ChronicleScreenInteractiveV1 => "chronicle_screen_interactive_v1",
            Self::ParryToth2025SessionGlanceV1 => "parry_toth_2025_session_glance_v1",
            Self::Zhu2018UnlockLockV1 => "zhu_2018_unlock_lock_v1",
            Self::UnlockToLockV1 => "unlock_to_lock_v1",
            Self::UnlockToOffOrLockV1 => "unlock_to_off_or_lock_v1",
        }
    }

    pub fn from_canonical_id_strict(value: &str) -> Result<Self, UnknownStrategyId> {
        match value {
            "chronicle_screen_interactive_v1" => Ok(Self::ChronicleScreenInteractiveV1),
            "parry_toth_2025_session_glance_v1" => Ok(Self::ParryToth2025SessionGlanceV1),
            "zhu_2018_unlock_lock_v1" => Ok(Self::Zhu2018UnlockLockV1),
            "unlock_to_lock_v1" => Ok(Self::UnlockToLockV1),
            "unlock_to_off_or_lock_v1" => Ok(Self::UnlockToOffOrLockV1),
            _ => Err(UnknownStrategyId),
        }
    }

    pub fn required_capability_ids(self) -> &'static [CapabilityId] {
        use CapabilityId::*;
        const PARRY_TOTH: &[CapabilityId] = &[
            AndroidUsageEvent15ScreenInteractive,
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
            AndroidUsageEvent26DeviceShutdown,
            AndroidUsageEvent27DeviceStartup,
            SeparateScreenKeyguardEventRows,
            FullUnfilteredSourceEventStream,
            SourceRecordOrderPreserved,
            SingleDeviceStreamPerParticipant,
            CompleteObservationWindowChunk,
        ];
        const ZHU: &[CapabilityId] = &[
            AndroidUsageEvent15ScreenInteractive,
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent18KeyguardHidden,
            AndroidUsageEvent26DeviceShutdown,
            SeparateScreenKeyguardEventRows,
            FullUnfilteredSourceEventStream,
            SourceRecordOrderPreserved,
            SingleDeviceStreamPerParticipant,
            CompleteObservationWindowChunk,
        ];
        const UNLOCK_TO_LOCK: &[CapabilityId] = &[
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
            SeparateScreenKeyguardEventRows,
            FullUnfilteredSourceEventStream,
            SourceRecordOrderPreserved,
            SingleDeviceStreamPerParticipant,
            CompleteObservationWindowChunk,
        ];
        const UNLOCK_TO_OFF_OR_LOCK: &[CapabilityId] = &[
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
            SeparateScreenKeyguardEventRows,
            FullUnfilteredSourceEventStream,
            SourceRecordOrderPreserved,
            SingleDeviceStreamPerParticipant,
            CompleteObservationWindowChunk,
        ];
        match self {
            Self::ChronicleScreenInteractiveV1 => &[],
            Self::ParryToth2025SessionGlanceV1 => PARRY_TOTH,
            Self::Zhu2018UnlockLockV1 => ZHU,
            Self::UnlockToLockV1 => UNLOCK_TO_LOCK,
            Self::UnlockToOffOrLockV1 => UNLOCK_TO_OFF_OR_LOCK,
        }
    }

    pub fn required_signal_ids(self) -> &'static [CapabilityId] {
        use CapabilityId::*;
        const PARRY_TOTH: &[CapabilityId] = &[
            AndroidUsageEvent15ScreenInteractive,
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
            AndroidUsageEvent26DeviceShutdown,
            AndroidUsageEvent27DeviceStartup,
        ];
        const ZHU: &[CapabilityId] = &[
            AndroidUsageEvent15ScreenInteractive,
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent18KeyguardHidden,
            AndroidUsageEvent26DeviceShutdown,
        ];
        const UNLOCK_TO_LOCK: &[CapabilityId] = &[
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
        ];
        const UNLOCK_TO_OFF_OR_LOCK: &[CapabilityId] = &[
            AndroidUsageEvent16ScreenNonInteractive,
            AndroidUsageEvent17KeyguardShown,
            AndroidUsageEvent18KeyguardHidden,
        ];
        match self {
            Self::ChronicleScreenInteractiveV1 => &[],
            Self::ParryToth2025SessionGlanceV1 => PARRY_TOTH,
            Self::Zhu2018UnlockLockV1 => ZHU,
            Self::UnlockToLockV1 => UNLOCK_TO_LOCK,
            Self::UnlockToOffOrLockV1 => UNLOCK_TO_OFF_OR_LOCK,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownStrategyId;

impl fmt::Display for UnknownStrategyId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("unknown_screen_session_construction_strategy")
    }
}

impl std::error::Error for UnknownStrategyId {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScientificRelation {
    BaselineNative,
    BaselineEquivalent,
    SourceNative,
    SourceEquivalent,
    SourceAlignedAdapter,
    ControlledDerivative,
    PartialReplay,
    Refused,
}

impl ScientificRelation {
    pub const ALL: [Self; 8] = [
        Self::BaselineNative,
        Self::BaselineEquivalent,
        Self::SourceNative,
        Self::SourceEquivalent,
        Self::SourceAlignedAdapter,
        Self::ControlledDerivative,
        Self::PartialReplay,
        Self::Refused,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::BaselineNative => "baseline_native",
            Self::BaselineEquivalent => "baseline_equivalent",
            Self::SourceNative => "source_native",
            Self::SourceEquivalent => "source_equivalent",
            Self::SourceAlignedAdapter => "source_aligned_adapter",
            Self::ControlledDerivative => "controlled_derivative",
            Self::PartialReplay => "partial_replay",
            Self::Refused => "refused",
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum B05RefusalReason {
    InputCapabilityEvidenceAbsent,
    CapabilityEvidenceNotBoundToInput,
    ParticipantScopeUndetermined,
    MultipleDeviceStreamsAliased,
    DeviceStreamScopeUnknown,
    CombinedEventRepresentation,
    SourceStreamIncomplete,
    SourceStreamCompletenessUnknown,
    SourceOrderNotPreserved,
    SourceOrderUnknown,
    UnsupportedInputChunk,
    InputChunkStatusUnknown,
    MissingRequiredSignal,
    RequiredSignalCapabilityUnknown,
    UnorderableFullStreamRow,
    NonMonotonicSourceTimestamps,
    AmbiguousEqualTimestamp,
}

impl B05RefusalReason {
    pub const PRIORITY: [Self; 17] = [
        Self::InputCapabilityEvidenceAbsent,
        Self::CapabilityEvidenceNotBoundToInput,
        Self::ParticipantScopeUndetermined,
        Self::MultipleDeviceStreamsAliased,
        Self::DeviceStreamScopeUnknown,
        Self::CombinedEventRepresentation,
        Self::SourceStreamIncomplete,
        Self::SourceStreamCompletenessUnknown,
        Self::SourceOrderNotPreserved,
        Self::SourceOrderUnknown,
        Self::UnsupportedInputChunk,
        Self::InputChunkStatusUnknown,
        Self::MissingRequiredSignal,
        Self::RequiredSignalCapabilityUnknown,
        Self::UnorderableFullStreamRow,
        Self::NonMonotonicSourceTimestamps,
        Self::AmbiguousEqualTimestamp,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::InputCapabilityEvidenceAbsent => "input_capability_evidence_absent",
            Self::CapabilityEvidenceNotBoundToInput => "capability_evidence_not_bound_to_input",
            Self::ParticipantScopeUndetermined => "participant_scope_undetermined",
            Self::MultipleDeviceStreamsAliased => "multiple_device_streams_aliased",
            Self::DeviceStreamScopeUnknown => "device_stream_scope_unknown",
            Self::CombinedEventRepresentation => "combined_event_representation",
            Self::SourceStreamIncomplete => "source_stream_incomplete",
            Self::SourceStreamCompletenessUnknown => "source_stream_completeness_unknown",
            Self::SourceOrderNotPreserved => "source_order_not_preserved",
            Self::SourceOrderUnknown => "source_order_unknown",
            Self::UnsupportedInputChunk => "unsupported_input_chunk",
            Self::InputChunkStatusUnknown => "input_chunk_status_unknown",
            Self::MissingRequiredSignal => "missing_required_signal",
            Self::RequiredSignalCapabilityUnknown => "required_signal_capability_unknown",
            Self::UnorderableFullStreamRow => "unorderable_full_stream_row",
            Self::NonMonotonicSourceTimestamps => "non_monotonic_source_timestamps",
            Self::AmbiguousEqualTimestamp => "ambiguous_equal_timestamp",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceScope {
    Exact,
    Wildcard,
    None,
}

impl EvidenceScope {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Wildcard => "wildcard",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityEvidenceOrigin {
    ObservedInBoundInput,
    ManifestAssertion,
    None,
}

impl CapabilityEvidenceOrigin {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ObservedInBoundInput => "observed_in_bound_input",
            Self::ManifestAssertion => "manifest_assertion",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationDisposition {
    Observed,
    CapableNoRow,
    Absent,
    Unknown,
    NotObservable,
}

impl ObservationDisposition {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Observed => "observed",
            Self::CapableNoRow => "capable_no_row",
            Self::Absent => "absent",
            Self::Unknown => "unknown",
            Self::NotObservable => "not_observable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDecision {
    pub capability_id: CapabilityId,
    pub asserted_state: Option<CapabilityState>,
    pub effective_state: CapabilityState,
    pub evidence_scope: EvidenceScope,
    pub evidence_origin: CapabilityEvidenceOrigin,
    pub evidence_basis: Option<EvidenceBasis>,
    pub evidence_reference: Option<String>,
    pub evidence_sha256: Option<String>,
    pub observed_standalone_row_count: u32,
    pub observation_disposition: ObservationDisposition,
    pub claim_physical_data_row: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B05ParticipantIssue {
    pub reason: B05RefusalReason,
    pub detail: String,
    pub source_data_row: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B05ParticipantDecision {
    pub participant_id: String,
    pub evidence_scope: EvidenceScope,
    pub capability_decisions: Vec<CapabilityDecision>,
    pub decisive_equal_timestamp_group_count: u32,
    pub issues: Vec<B05ParticipantIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B05ApplicabilityReceiptV1 {
    pub protocol_version: String,
    pub input_digest: String,
    pub evidence_artifact_digest: Option<String>,
    pub evidence_assignment_digest: Option<String>,
    pub requested_strategy_id: ScreenSessionConstructionStrategyId,
    pub effective_strategy_id: ScreenSessionConstructionStrategyId,
    pub relation: ScientificRelation,
    pub executable: bool,
    pub refusal_reason: Option<B05RefusalReason>,
    pub refusal_detail: Option<String>,
    pub source_checkpoint: String,
    pub source_order_index_space: String,
    pub source_adapter_id: String,
    pub required_signal_ids: Vec<CapabilityId>,
    pub required_capability_ids: Vec<CapabilityId>,
    pub participant_decisions: Vec<B05ParticipantDecision>,
    pub capability_resolution_digest: String,
    pub options_digest: String,
}

#[derive(Debug)]
pub struct B05ApplicabilityInput<'a> {
    pub raw_input_sha256: &'a str,
    pub raw_events: &'a [RawB05Event],
    pub evidence: Option<&'a ParsedCapabilityEvidence>,
    pub evidence_assignment_digest: Option<&'a str>,
    pub options_digest: &'a str,
    pub selection_was_explicit: bool,
    /// Participants known to have been split across input artifacts without a
    /// serialized state carry.  They refuse instead of closing at the chunk.
    pub fragmented_participants: &'a BTreeSet<String>,
}

/// Resolve digest-bound capability assertions, upgrade only standalone event
/// signals to observed, and choose the deterministic top-level refusal.
pub fn resolve_b05_applicability(
    strategy: ScreenSessionConstructionStrategyId,
    input: B05ApplicabilityInput<'_>,
) -> Result<B05ApplicabilityReceiptV1, CapabilityEvidenceError> {
    let mut participant_rows = BTreeMap::<String, Vec<&RawB05Event>>::new();
    let mut last_source_row = None;
    let mut invalid_source_order_rows = BTreeSet::new();
    for event in input.raw_events {
        if event.source_data_row == 0
            || last_source_row.is_some_and(|previous| event.source_data_row <= previous)
        {
            invalid_source_order_rows.insert(event.source_data_row);
        }
        last_source_row = Some(event.source_data_row);
        participant_rows
            .entry(event.participant_id.clone())
            .or_default()
            .push(event);
    }
    // The execution boundary can know that a participant stream was split
    // across artifacts even when the current artifact contains no row for
    // that participant. Preserve that explicit scope in the typed decision;
    // never infer fragmentation from row absence.
    for participant_id in input.fragmented_participants {
        participant_rows.entry(participant_id.clone()).or_default();
    }
    if participant_rows.is_empty() {
        participant_rows.insert(String::new(), Vec::new());
    }

    // A state machine cannot safely close or carry a participant whose input
    // window is known to be fragmented. This boundary applies equally to the
    // native Chronicle baseline and to source-aligned arms, and it outranks a
    // missing capability sidecar because it is already known by the executor.
    if !input.fragmented_participants.is_empty() {
        let participant_decisions = participant_rows
            .keys()
            .map(|participant_id| B05ParticipantDecision {
                participant_id: participant_id.clone(),
                evidence_scope: EvidenceScope::None,
                capability_decisions: Vec::new(),
                decisive_equal_timestamp_group_count: 0,
                issues: input
                    .fragmented_participants
                    .contains(participant_id)
                    .then(|| B05ParticipantIssue {
                        reason: B05RefusalReason::UnsupportedInputChunk,
                        detail: "participant_stream_fragmented".into(),
                        source_data_row: None,
                    })
                    .into_iter()
                    .collect(),
            })
            .collect::<Vec<_>>();
        let first_fragmented = input
            .fragmented_participants
            .iter()
            .next()
            .expect("nonempty fragmented participant set");
        let mut receipt = B05ApplicabilityReceiptV1 {
            protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
            input_digest: input.raw_input_sha256.to_owned(),
            evidence_artifact_digest: input
                .evidence
                .map(|evidence| evidence.evidence_artifact_digest.clone()),
            evidence_assignment_digest: input.evidence_assignment_digest.map(str::to_owned),
            requested_strategy_id: strategy,
            effective_strategy_id: strategy,
            relation: ScientificRelation::Refused,
            executable: false,
            refusal_reason: Some(B05RefusalReason::UnsupportedInputChunk),
            refusal_detail: Some(format!(
                "participant={first_fragmented};participant_stream_fragmented"
            )),
            source_checkpoint: B05_SOURCE_CHECKPOINT.into(),
            source_order_index_space: B05_SOURCE_ORDER_INDEX_SPACE.into(),
            source_adapter_id: B05_SOURCE_ADAPTER_ID.into(),
            required_signal_ids: strategy.required_signal_ids().to_vec(),
            required_capability_ids: strategy.required_capability_ids().to_vec(),
            participant_decisions,
            capability_resolution_digest: String::new(),
            options_digest: input.options_digest.to_owned(),
        };
        receipt.capability_resolution_digest = applicability_resolution_digest(&receipt);
        return Ok(receipt);
    }

    if strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
        let relation = if input.selection_was_explicit {
            ScientificRelation::BaselineEquivalent
        } else {
            ScientificRelation::BaselineNative
        };
        let mut receipt = B05ApplicabilityReceiptV1 {
            protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
            input_digest: input.raw_input_sha256.to_owned(),
            evidence_artifact_digest: None,
            evidence_assignment_digest: None,
            requested_strategy_id: strategy,
            effective_strategy_id: strategy,
            relation,
            executable: true,
            refusal_reason: None,
            refusal_detail: None,
            source_checkpoint: B05_SOURCE_CHECKPOINT.into(),
            source_order_index_space: B05_SOURCE_ORDER_INDEX_SPACE.into(),
            source_adapter_id: B05_SOURCE_ADAPTER_ID.into(),
            required_signal_ids: Vec::new(),
            required_capability_ids: Vec::new(),
            participant_decisions: participant_rows
                .keys()
                .map(|participant_id| B05ParticipantDecision {
                    participant_id: participant_id.clone(),
                    evidence_scope: EvidenceScope::None,
                    capability_decisions: Vec::new(),
                    decisive_equal_timestamp_group_count: 0,
                    issues: Vec::new(),
                })
                .collect(),
            capability_resolution_digest: String::new(),
            options_digest: input.options_digest.to_owned(),
        };
        receipt.capability_resolution_digest = applicability_resolution_digest(&receipt);
        return Ok(receipt);
    }

    let Some(evidence) = input.evidence else {
        return Ok(refused_without_participants(
            strategy,
            input,
            B05RefusalReason::InputCapabilityEvidenceAbsent,
            "support role input_capability_evidence_file is absent",
        ));
    };
    let bound_claims = evidence
        .claims
        .iter()
        .filter(|claim| claim.raw_input_sha256 == input.raw_input_sha256)
        .collect::<Vec<_>>();
    if bound_claims.is_empty() {
        return Ok(refused_without_participants(
            strategy,
            input,
            B05RefusalReason::CapabilityEvidenceNotBoundToInput,
            "sidecar contains zero rows for the exact raw input digest",
        ));
    }

    let mut participant_decisions = Vec::with_capacity(participant_rows.len());
    for (participant_id, rows) in participant_rows {
        let has_exact = bound_claims
            .iter()
            .any(|claim| claim.participant_id == participant_id);
        let has_wildcard = bound_claims.iter().any(|claim| claim.participant_id == "*");
        let scope = if has_exact {
            EvidenceScope::Exact
        } else if has_wildcard {
            EvidenceScope::Wildcard
        } else {
            EvidenceScope::None
        };
        let mut issues = Vec::new();
        if participant_id.is_empty() {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::ParticipantScopeUndetermined,
                detail: "participant identity or physical source order is not unique".into(),
                source_data_row: rows.first().map(|row| row.source_data_row),
            });
        }
        if let Some(row) = rows
            .iter()
            .find(|row| invalid_source_order_rows.contains(&row.source_data_row))
        {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::UnorderableFullStreamRow,
                detail: "physical source-row indices are not unique and increasing".into(),
                source_data_row: Some(row.source_data_row),
            });
        }
        if input.fragmented_participants.contains(&participant_id) {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::UnsupportedInputChunk,
                detail: "participant_stream_fragmented".into(),
                source_data_row: None,
            });
        }
        if let Some(row) = rows.iter().find(|row| row.signal.is_fused()) {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::CombinedEventRepresentation,
                detail: "source arm requires separate screen and keyguard event rows".into(),
                source_data_row: Some(row.source_data_row),
            });
        }
        if let Some(row) = rows.iter().find(|row| row.timestamp_ns.is_none()) {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::UnorderableFullStreamRow,
                detail: "a full-stream row has no physical timestamp".into(),
                source_data_row: Some(row.source_data_row),
            });
        }
        if let Some(row) = first_non_monotonic_row(&rows) {
            issues.push(B05ParticipantIssue {
                reason: B05RefusalReason::NonMonotonicSourceTimestamps,
                detail: "participant timestamps decrease in physical source order".into(),
                source_data_row: Some(row),
            });
        }

        // The decisiveness probe re-runs the strategy's state machine over
        // the participant's rows. Those machines assume every full-stream row
        // has a physical timestamp (`make_screen_interval` unwraps it), and
        // an issue recorded above already refuses this participant, so the
        // probe is skipped: a blank-timestamp row must surface as the typed
        // `unorderable_full_stream_row` refusal, never as a panic inside the
        // probe. A refused participant's count is descriptive only.
        let decisive_equal_timestamp_group_count = if issues.is_empty() {
            decisive_equal_timestamp_group_count(strategy, &rows)
        } else {
            0
        };
        let mut capability_decisions = Vec::new();
        for capability_id in CapabilityId::ALL {
            let exact = bound_claims.iter().find(|claim| {
                claim.participant_id == participant_id && claim.capability_id == capability_id
            });
            let wildcard = bound_claims
                .iter()
                .find(|claim| claim.participant_id == "*" && claim.capability_id == capability_id);
            let claim = exact.or(wildcard).copied();
            let claim_scope = if exact.is_some() {
                EvidenceScope::Exact
            } else if wildcard.is_some() {
                EvidenceScope::Wildcard
            } else {
                EvidenceScope::None
            };
            let observed_count = rows
                .iter()
                .filter(|row| row.signal.capability() == Some(capability_id))
                .count() as u32;
            if observed_count > 0
                && claim.is_some_and(|selected| selected.state == CapabilityState::Absent)
            {
                return Err(CapabilityEvidenceError::new(
                    CapabilityEvidenceErrorDetail::ObservedSignalContradiction,
                    claim.map(|selected| selected.physical_data_row),
                ));
            }
            let asserted_state = claim.map(|selected| selected.state);
            let (effective_state, evidence_origin, observation_disposition) =
                if observed_count > 0 && capability_id.observed_signal().is_some() {
                    (
                        CapabilityState::Capable,
                        CapabilityEvidenceOrigin::ObservedInBoundInput,
                        ObservationDisposition::Observed,
                    )
                } else {
                    match asserted_state.unwrap_or(CapabilityState::Unknown) {
                        CapabilityState::Capable => (
                            CapabilityState::Capable,
                            CapabilityEvidenceOrigin::ManifestAssertion,
                            ObservationDisposition::CapableNoRow,
                        ),
                        CapabilityState::Absent => (
                            CapabilityState::Absent,
                            CapabilityEvidenceOrigin::ManifestAssertion,
                            ObservationDisposition::Absent,
                        ),
                        CapabilityState::Unknown => (
                            CapabilityState::Unknown,
                            if claim.is_some() {
                                CapabilityEvidenceOrigin::ManifestAssertion
                            } else {
                                CapabilityEvidenceOrigin::None
                            },
                            if capability_id.observed_signal().is_some() {
                                ObservationDisposition::Unknown
                            } else {
                                ObservationDisposition::NotObservable
                            },
                        ),
                    }
                };
            capability_decisions.push(CapabilityDecision {
                capability_id,
                asserted_state,
                effective_state,
                evidence_scope: claim_scope,
                evidence_origin,
                evidence_basis: claim.map(|selected| selected.evidence_basis),
                evidence_reference: claim.map(|selected| selected.evidence_reference.clone()),
                evidence_sha256: claim.and_then(|selected| selected.evidence_sha256.clone()),
                observed_standalone_row_count: observed_count,
                observation_disposition,
                claim_physical_data_row: claim.map(|selected| selected.physical_data_row),
            });
        }

        add_capability_issues(
            strategy,
            &capability_decisions,
            decisive_equal_timestamp_group_count,
            &mut issues,
        );
        issues.sort_by_key(|issue| {
            B05RefusalReason::PRIORITY
                .iter()
                .position(|reason| *reason == issue.reason)
                .unwrap_or(usize::MAX)
        });
        participant_decisions.push(B05ParticipantDecision {
            participant_id,
            evidence_scope: scope,
            capability_decisions,
            decisive_equal_timestamp_group_count,
            issues,
        });
    }
    participant_decisions.sort_by(|left, right| left.participant_id.cmp(&right.participant_id));

    let refusal_reason = B05RefusalReason::PRIORITY.into_iter().find(|reason| {
        participant_decisions
            .iter()
            .flat_map(|participant| &participant.issues)
            .any(|issue| issue.reason == *reason)
    });
    let refusal_detail = refusal_reason.and_then(|reason| {
        participant_decisions
            .iter()
            .flat_map(|participant| {
                participant
                    .issues
                    .iter()
                    .map(move |issue| (participant, issue))
            })
            .find(|(_, issue)| issue.reason == reason)
            .map(|(participant, issue)| {
                format!(
                    "participant={};{}",
                    participant.participant_id, issue.detail
                )
            })
    });
    let executable = refusal_reason.is_none();
    let mut required_capability_ids = strategy.required_capability_ids().to_vec();
    if participant_decisions
        .iter()
        .any(|participant| participant.decisive_equal_timestamp_group_count > 0)
    {
        required_capability_ids.push(CapabilityId::EqualTimestampSourceOrderPreserved);
    }
    required_capability_ids.sort_unstable();
    required_capability_ids.dedup();
    let mut receipt = B05ApplicabilityReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        input_digest: input.raw_input_sha256.to_owned(),
        evidence_artifact_digest: Some(evidence.evidence_artifact_digest.clone()),
        evidence_assignment_digest: input.evidence_assignment_digest.map(str::to_owned),
        requested_strategy_id: strategy,
        effective_strategy_id: strategy,
        relation: if executable {
            ScientificRelation::SourceAlignedAdapter
        } else {
            ScientificRelation::Refused
        },
        executable,
        refusal_reason,
        refusal_detail,
        source_checkpoint: B05_SOURCE_CHECKPOINT.into(),
        source_order_index_space: B05_SOURCE_ORDER_INDEX_SPACE.into(),
        source_adapter_id: B05_SOURCE_ADAPTER_ID.into(),
        required_signal_ids: strategy.required_signal_ids().to_vec(),
        required_capability_ids,
        participant_decisions,
        capability_resolution_digest: String::new(),
        options_digest: input.options_digest.to_owned(),
    };
    receipt.capability_resolution_digest = applicability_resolution_digest(&receipt);
    Ok(receipt)
}

fn refused_without_participants(
    strategy: ScreenSessionConstructionStrategyId,
    input: B05ApplicabilityInput<'_>,
    refusal_reason: B05RefusalReason,
    refusal_detail: &str,
) -> B05ApplicabilityReceiptV1 {
    let mut receipt = B05ApplicabilityReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        input_digest: input.raw_input_sha256.to_owned(),
        evidence_artifact_digest: input
            .evidence
            .map(|evidence| evidence.evidence_artifact_digest.clone()),
        evidence_assignment_digest: input.evidence_assignment_digest.map(str::to_owned),
        requested_strategy_id: strategy,
        effective_strategy_id: strategy,
        relation: ScientificRelation::Refused,
        executable: false,
        refusal_reason: Some(refusal_reason),
        refusal_detail: Some(refusal_detail.to_owned()),
        source_checkpoint: B05_SOURCE_CHECKPOINT.into(),
        source_order_index_space: B05_SOURCE_ORDER_INDEX_SPACE.into(),
        source_adapter_id: B05_SOURCE_ADAPTER_ID.into(),
        required_signal_ids: strategy.required_signal_ids().to_vec(),
        required_capability_ids: strategy.required_capability_ids().to_vec(),
        participant_decisions: Vec::new(),
        capability_resolution_digest: String::new(),
        options_digest: input.options_digest.to_owned(),
    };
    receipt.capability_resolution_digest = applicability_resolution_digest(&receipt);
    receipt
}

fn decision(decisions: &[CapabilityDecision], capability_id: CapabilityId) -> &CapabilityDecision {
    decisions
        .iter()
        .find(|decision| decision.capability_id == capability_id)
        .expect("all closed-domain capability decisions are materialized")
}

fn add_capability_issues(
    strategy: ScreenSessionConstructionStrategyId,
    decisions: &[CapabilityDecision],
    decisive_equal_timestamp_group_count: u32,
    issues: &mut Vec<B05ParticipantIssue>,
) {
    use CapabilityId::*;
    let state = |id| decision(decisions, id).effective_state;
    match state(SingleDeviceStreamPerParticipant) {
        CapabilityState::Absent => issues.push(simple_issue(
            B05RefusalReason::MultipleDeviceStreamsAliased,
            SingleDeviceStreamPerParticipant,
        )),
        CapabilityState::Unknown => issues.push(simple_issue(
            B05RefusalReason::DeviceStreamScopeUnknown,
            SingleDeviceStreamPerParticipant,
        )),
        CapabilityState::Capable => {}
    }
    match state(SeparateScreenKeyguardEventRows) {
        CapabilityState::Absent => issues.push(simple_issue(
            B05RefusalReason::CombinedEventRepresentation,
            SeparateScreenKeyguardEventRows,
        )),
        CapabilityState::Unknown => issues.push(simple_issue(
            B05RefusalReason::RequiredSignalCapabilityUnknown,
            SeparateScreenKeyguardEventRows,
        )),
        CapabilityState::Capable => {}
    }
    match state(FullUnfilteredSourceEventStream) {
        CapabilityState::Absent => issues.push(simple_issue(
            B05RefusalReason::SourceStreamIncomplete,
            FullUnfilteredSourceEventStream,
        )),
        CapabilityState::Unknown => issues.push(simple_issue(
            B05RefusalReason::SourceStreamCompletenessUnknown,
            FullUnfilteredSourceEventStream,
        )),
        CapabilityState::Capable => {}
    }
    match state(SourceRecordOrderPreserved) {
        CapabilityState::Absent => issues.push(simple_issue(
            B05RefusalReason::SourceOrderNotPreserved,
            SourceRecordOrderPreserved,
        )),
        CapabilityState::Unknown => issues.push(simple_issue(
            B05RefusalReason::SourceOrderUnknown,
            SourceRecordOrderPreserved,
        )),
        CapabilityState::Capable => {}
    }
    match state(CompleteObservationWindowChunk) {
        CapabilityState::Absent => issues.push(B05ParticipantIssue {
            reason: B05RefusalReason::UnsupportedInputChunk,
            detail: "participant_stream_fragmented".into(),
            source_data_row: None,
        }),
        CapabilityState::Unknown => issues.push(simple_issue(
            B05RefusalReason::InputChunkStatusUnknown,
            CompleteObservationWindowChunk,
        )),
        CapabilityState::Capable => {}
    }
    for capability_id in strategy.required_signal_ids() {
        match state(*capability_id) {
            CapabilityState::Absent => issues.push(simple_issue(
                B05RefusalReason::MissingRequiredSignal,
                *capability_id,
            )),
            CapabilityState::Unknown => issues.push(simple_issue(
                B05RefusalReason::RequiredSignalCapabilityUnknown,
                *capability_id,
            )),
            CapabilityState::Capable => {}
        }
    }
    if decisive_equal_timestamp_group_count > 0
        && state(EqualTimestampSourceOrderPreserved) != CapabilityState::Capable
    {
        issues.push(simple_issue(
            B05RefusalReason::AmbiguousEqualTimestamp,
            EqualTimestampSourceOrderPreserved,
        ));
    }
}

fn simple_issue(reason: B05RefusalReason, capability_id: CapabilityId) -> B05ParticipantIssue {
    B05ParticipantIssue {
        reason,
        detail: format!("capability={}", capability_id.canonical_id()),
        source_data_row: None,
    }
}

fn first_non_monotonic_row(rows: &[&RawB05Event]) -> Option<u32> {
    rows.windows(2)
        .find_map(|pair| match (pair[0].timestamp_ns, pair[1].timestamp_ns) {
            (Some(left), Some(right)) if right < left => Some(pair[1].source_data_row),
            _ => None,
        })
}

fn decisive_equal_timestamp_group_count(
    strategy: ScreenSessionConstructionStrategyId,
    rows: &[&RawB05Event],
) -> u32 {
    if strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
        return 0;
    }
    let relevant = |signal: AndroidUsageSignal| match strategy {
        ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => matches!(
            signal,
            AndroidUsageSignal::ScreenInteractive
                | AndroidUsageSignal::ScreenNonInteractive
                | AndroidUsageSignal::KeyguardShown
                | AndroidUsageSignal::KeyguardHidden
                | AndroidUsageSignal::DeviceShutdown
                | AndroidUsageSignal::DeviceStartup
        ),
        // Zhu's adjacency is over the complete participant log.
        ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => true,
        ScreenSessionConstructionStrategyId::UnlockToLockV1 => matches!(
            signal,
            AndroidUsageSignal::KeyguardHidden | AndroidUsageSignal::KeyguardShown
        ),
        ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => matches!(
            signal,
            AndroidUsageSignal::KeyguardHidden
                | AndroidUsageSignal::KeyguardShown
                | AndroidUsageSignal::ScreenNonInteractive
        ),
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => false,
    };
    let baseline = screen_semantic_signature(strategy, rows);
    let mut groups = BTreeMap::<i64, Vec<usize>>::new();
    for (index, row) in rows.iter().enumerate() {
        if relevant(row.signal) {
            if let Some(timestamp) = row.timestamp_ns {
                groups.entry(timestamp).or_default().push(index);
            }
        }
    }
    // One scratch buffer for every counterfactual: swap the pair in, compare,
    // swap it back. Allocating a fresh copy of the participant log per pair
    // was the allocation half of the quadratic blowup (issue #5).
    let mut scratch = rows.to_vec();
    groups
        .values()
        .filter(|positions| {
            positions.windows(2).any(|pair| {
                // Zhu's partition machine branches only on ScreenInteractive,
                // KeyguardHidden (as the row after a ScreenInteractive),
                // ScreenNonInteractive, and DeviceShutdown; every other row is
                // transparent to every branch, and intervals/issues reference
                // only branching rows. Swapping two adjacent rows neither of
                // which carries a branching signal therefore cannot change the
                // signature, so the counterfactual run is skipped. Pinned
                // against the exhaustive probe by
                // `optimized_decisiveness_probe_matches_the_exhaustive_probe`.
                if strategy == ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1
                    && !zhu_partition_branches_on(rows[pair[0]].signal)
                    && !zhu_partition_branches_on(rows[pair[1]].signal)
                {
                    return false;
                }
                scratch.swap(pair[0], pair[1]);
                let changed = screen_semantic_signature(strategy, &scratch) != baseline;
                scratch.swap(pair[0], pair[1]);
                changed
            })
        })
        .count() as u32
}

/// The complete signal set `construct_zhu_partition` branches on. A row with
/// any other signal never opens, closes, or issues, and never contributes a
/// source row to an interval or issue.
fn zhu_partition_branches_on(signal: AndroidUsageSignal) -> bool {
    matches!(
        signal,
        AndroidUsageSignal::ScreenInteractive
            | AndroidUsageSignal::KeyguardHidden
            | AndroidUsageSignal::ScreenNonInteractive
            | AndroidUsageSignal::DeviceShutdown
    )
}

/// Probe-only entry point for `examples/profile_b05_decisiveness.rs`, so the
/// hyperfine evidence measures the exact production function rather than an
/// out-of-tree copy. Not part of the product API.
#[doc(hidden)]
pub fn probe_decisive_equal_timestamp_group_count(
    strategy: ScreenSessionConstructionStrategyId,
    rows: &[RawB05Event],
) -> u32 {
    let refs = rows.iter().collect::<Vec<_>>();
    decisive_equal_timestamp_group_count(strategy, &refs)
}

type ScreenSemanticSignature = (Vec<ScreenIntervalEvidence>, Vec<ScreenConstructionIssue>);

fn screen_semantic_signature(
    strategy: ScreenSessionConstructionStrategyId,
    rows: &[&RawB05Event],
) -> ScreenSemanticSignature {
    let participant_id = rows
        .first()
        .map(|row| row.participant_id.as_str())
        .unwrap_or("");
    let (intervals, issues) = match strategy {
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => {
            construct_chronicle_partition(participant_id, rows)
        }
        ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => {
            construct_parry_toth_partition(participant_id, rows)
        }
        ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => {
            construct_zhu_partition(participant_id, rows)
        }
        ScreenSessionConstructionStrategyId::UnlockToLockV1
        | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
            construct_direct_unlock_partition(strategy, participant_id, rows)
        }
    };
    (intervals, issues)
}

fn applicability_resolution_digest(receipt: &B05ApplicabilityReceiptV1) -> String {
    let mut material = Vec::new();
    digest_field(&mut material, &receipt.protocol_version);
    digest_field(&mut material, &receipt.input_digest);
    digest_field(
        &mut material,
        receipt.evidence_artifact_digest.as_deref().unwrap_or(""),
    );
    digest_field(
        &mut material,
        receipt.evidence_assignment_digest.as_deref().unwrap_or(""),
    );
    digest_field(&mut material, receipt.requested_strategy_id.canonical_id());
    digest_field(&mut material, receipt.effective_strategy_id.canonical_id());
    digest_field(&mut material, receipt.relation.canonical_id());
    digest_field(&mut material, if receipt.executable { "1" } else { "0" });
    digest_field(
        &mut material,
        receipt
            .refusal_reason
            .map(B05RefusalReason::canonical_id)
            .unwrap_or(""),
    );
    digest_field(
        &mut material,
        receipt.refusal_detail.as_deref().unwrap_or(""),
    );
    digest_field(&mut material, &receipt.source_checkpoint);
    digest_field(&mut material, &receipt.source_order_index_space);
    digest_field(&mut material, &receipt.source_adapter_id);
    for capability in &receipt.required_signal_ids {
        digest_field(&mut material, capability.canonical_id());
    }
    digest_field(&mut material, "|");
    for capability in &receipt.required_capability_ids {
        digest_field(&mut material, capability.canonical_id());
    }
    for participant in &receipt.participant_decisions {
        digest_field(&mut material, &participant.participant_id);
        digest_field(&mut material, participant.evidence_scope.canonical_id());
        digest_field(
            &mut material,
            &participant.decisive_equal_timestamp_group_count.to_string(),
        );
        for capability in &participant.capability_decisions {
            digest_field(&mut material, capability.capability_id.canonical_id());
            digest_field(
                &mut material,
                capability
                    .asserted_state
                    .map(CapabilityState::canonical_id)
                    .unwrap_or("none"),
            );
            digest_field(&mut material, capability.effective_state.canonical_id());
            digest_field(&mut material, capability.evidence_scope.canonical_id());
            digest_field(&mut material, capability.evidence_origin.canonical_id());
            digest_field(
                &mut material,
                capability
                    .evidence_basis
                    .map(EvidenceBasis::canonical_id)
                    .unwrap_or("none"),
            );
            digest_field(
                &mut material,
                capability.evidence_reference.as_deref().unwrap_or(""),
            );
            digest_field(
                &mut material,
                capability.evidence_sha256.as_deref().unwrap_or(""),
            );
            digest_field(
                &mut material,
                &capability.observed_standalone_row_count.to_string(),
            );
            digest_field(
                &mut material,
                capability.observation_disposition.canonical_id(),
            );
            digest_field(
                &mut material,
                &capability
                    .claim_physical_data_row
                    .map(|row| row.to_string())
                    .unwrap_or_default(),
            );
        }
        for issue in &participant.issues {
            digest_field(&mut material, issue.reason.canonical_id());
            digest_field(&mut material, &issue.detail);
            digest_field(
                &mut material,
                &issue
                    .source_data_row
                    .map(|row| row.to_string())
                    .unwrap_or_default(),
            );
        }
    }
    digest_field(&mut material, &receipt.options_digest);
    sha256_wire(&material)
}

fn digest_field(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(&(value.len() as u64).to_le_bytes());
    output.extend_from_slice(value.as_bytes());
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenIntervalKind {
    Session,
    Glance,
}

impl ScreenIntervalKind {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Glance => "glance",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenIntervalCloseReason {
    ScreenNonInteractive,
    KeyguardShown,
    DeviceScreenOff,
    DeviceShutdown,
    RightCensoredObservationWindow,
}

impl ScreenIntervalCloseReason {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ScreenNonInteractive => "screen_non_interactive",
            Self::KeyguardShown => "keyguard_shown",
            Self::DeviceScreenOff => "device_screen_off",
            Self::DeviceShutdown => "device_shutdown",
            Self::RightCensoredObservationWindow => "right_censored_observation_window",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenIntervalEvidence {
    pub screen_interval_id: String,
    pub participant_id: String,
    pub strategy_id: ScreenSessionConstructionStrategyId,
    pub kind: ScreenIntervalKind,
    pub start_ns: i64,
    pub stop_ns: Option<i64>,
    /// Boundary keys used by the Schoedel half-open membership rule.
    pub start_boundary_source_row: u32,
    pub stop_boundary_source_row: Option<u32>,
    /// Rows that establish each boundary (for example Interactive + Hidden).
    pub start_source_rows: Vec<u32>,
    pub stop_source_rows: Vec<u32>,
    pub close_reason: ScreenIntervalCloseReason,
    pub left_censored: bool,
    pub right_censored: bool,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ScreenConstructionIssueCode {
    ChronicleOrphanStop,
    UnmatchedGlanceStopNoPreviousStart,
    UnmatchedGlanceStopPreviousNotStart,
    UnmatchedGlanceStartNextNotStop,
    UnmatchedGlanceStartNoNextStop,
    UnmatchedSessionStopNoPreviousStart,
    UnmatchedSessionStopPreviousNotStart,
    UnmatchedSessionStartNextNotStop,
    UnmatchedSessionStartNoNextStop,
    #[serde(rename = "screen_interactive_next_not_keyguard_hidden")]
    ZhuScreenInteractiveNextNotKeyguardHidden,
    #[serde(rename = "screen_interactive_no_next_row")]
    ZhuScreenInteractiveNoNextRow,
    ZhuOrphanStop,
}

impl ScreenConstructionIssueCode {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ChronicleOrphanStop => "chronicle_orphan_stop",
            Self::UnmatchedGlanceStopNoPreviousStart => "unmatched_glance_stop_no_previous_start",
            Self::UnmatchedGlanceStopPreviousNotStart => "unmatched_glance_stop_previous_not_start",
            Self::UnmatchedGlanceStartNextNotStop => "unmatched_glance_start_next_not_stop",
            Self::UnmatchedGlanceStartNoNextStop => "unmatched_glance_start_no_next_stop",
            Self::UnmatchedSessionStopNoPreviousStart => "unmatched_session_stop_no_previous_start",
            Self::UnmatchedSessionStopPreviousNotStart => {
                "unmatched_session_stop_previous_not_start"
            }
            Self::UnmatchedSessionStartNextNotStop => "unmatched_session_start_next_not_stop",
            Self::UnmatchedSessionStartNoNextStop => "unmatched_session_start_no_next_stop",
            Self::ZhuScreenInteractiveNextNotKeyguardHidden => {
                "screen_interactive_next_not_keyguard_hidden"
            }
            Self::ZhuScreenInteractiveNoNextRow => "screen_interactive_no_next_row",
            Self::ZhuOrphanStop => "zhu_orphan_stop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenConstructionIssue {
    pub participant_id: String,
    pub source_data_row: u32,
    pub code: ScreenConstructionIssueCode,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenConstructionReceiptV1 {
    pub protocol_version: String,
    pub strategy_id: ScreenSessionConstructionStrategyId,
    pub relation: ScientificRelation,
    pub source_identity: String,
    pub source_artifact_sha256: Option<String>,
    pub source_license_status: String,
    pub input_row_count: u64,
    pub participant_count: u64,
    pub interval_count: u64,
    pub session_count: u64,
    pub glance_count: u64,
    pub right_censored_count: u64,
    pub issue_counts: BTreeMap<String, u64>,
    pub interval_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenConstructionOutput {
    pub intervals: Vec<ScreenIntervalEvidence>,
    pub applicability: B05ApplicabilityReceiptV1,
    pub construction_receipt: Option<ScreenConstructionReceiptV1>,
    pub issues: Vec<ScreenConstructionIssue>,
}

/// Fail-closed semantic validation for persisted B05 construction evidence.
/// The caller supplies the already verified raw artifact identity; no raw rows
/// or participant content is echoed in validation errors.
pub fn validate_screen_construction_output(
    output: &ScreenConstructionOutput,
    expected_input_digest: &str,
    expected_strategy: ScreenSessionConstructionStrategyId,
    expected_input_row_count: u64,
) -> Result<(), &'static str> {
    let applicability = &output.applicability;
    if applicability.input_digest != expected_input_digest {
        return Err("b05_screen_validation_error:input_digest_mismatch");
    }
    if applicability.requested_strategy_id != expected_strategy
        || applicability.effective_strategy_id != expected_strategy
    {
        return Err("b05_screen_validation_error:strategy_mismatch");
    }
    if !applicability.executable
        || applicability.refusal_reason.is_some()
        || applicability.refusal_detail.is_some()
    {
        return Err("b05_screen_validation_error:non_executable_persisted_output");
    }
    if applicability.protocol_version != B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION
        || applicability.source_checkpoint != B05_SOURCE_CHECKPOINT
        || applicability.source_order_index_space != B05_SOURCE_ORDER_INDEX_SPACE
        || applicability.source_adapter_id != B05_SOURCE_ADAPTER_ID
    {
        return Err("b05_screen_validation_error:applicability_source_identity_mismatch");
    }
    let mut expected_required_capability_ids = expected_strategy.required_capability_ids().to_vec();
    if applicability
        .participant_decisions
        .iter()
        .any(|participant| participant.decisive_equal_timestamp_group_count > 0)
    {
        expected_required_capability_ids.push(CapabilityId::EqualTimestampSourceOrderPreserved);
    }
    expected_required_capability_ids.sort_unstable();
    expected_required_capability_ids.dedup();
    if applicability.required_signal_ids != expected_strategy.required_signal_ids()
        || applicability.required_capability_ids != expected_required_capability_ids
    {
        return Err("b05_screen_validation_error:required_capability_identity_mismatch");
    }
    let expected_relation = match expected_strategy {
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => matches!(
            applicability.relation,
            ScientificRelation::BaselineNative | ScientificRelation::BaselineEquivalent
        ),
        ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1
        | ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1
        | ScreenSessionConstructionStrategyId::UnlockToLockV1
        | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
            applicability.relation == ScientificRelation::SourceAlignedAdapter
        }
    };
    if !expected_relation {
        return Err("b05_screen_validation_error:applicability_relation_mismatch");
    }
    if expected_strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
        if applicability.evidence_artifact_digest.is_some()
            || applicability.evidence_assignment_digest.is_some()
        {
            return Err("b05_screen_validation_error:unexpected_chronicle_capability_evidence");
        }
    } else {
        let Some(artifact_digest) = applicability.evidence_artifact_digest.as_deref() else {
            return Err("b05_screen_validation_error:source_capability_evidence_missing");
        };
        if !is_sha256_wire(artifact_digest)
            || applicability.evidence_assignment_digest.as_deref()
                != Some(capability_evidence_assignment_digest(artifact_digest).as_str())
        {
            return Err("b05_screen_validation_error:source_capability_identity_mismatch");
        }
    }
    if applicability.capability_resolution_digest != applicability_resolution_digest(applicability)
    {
        return Err("b05_screen_validation_error:applicability_digest_mismatch");
    }
    if applicability
        .participant_decisions
        .windows(2)
        .any(|pair| pair[0].participant_id >= pair[1].participant_id)
    {
        return Err("b05_screen_validation_error:participant_decision_order_mismatch");
    }
    for participant in &applicability.participant_decisions {
        let expected_capability_ids = if expected_strategy
            == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
        {
            &[][..]
        } else {
            &CapabilityId::ALL[..]
        };
        let capability_ids = participant
            .capability_decisions
            .iter()
            .map(|decision| decision.capability_id)
            .collect::<Vec<_>>();
        if capability_ids != expected_capability_ids
            || capability_ids.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err("b05_screen_validation_error:capability_decision_order_mismatch");
        }
        if !participant.issues.is_empty() {
            return Err("b05_screen_validation_error:executable_participant_issue");
        }
        if expected_strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
            if participant.evidence_scope != EvidenceScope::None
                || participant.decisive_equal_timestamp_group_count != 0
            {
                return Err(
                    "b05_screen_validation_error:unexpected_chronicle_participant_evidence",
                );
            }
            continue;
        }
        if participant.participant_id.is_empty()
            || participant.evidence_scope == EvidenceScope::None
        {
            return Err("b05_screen_validation_error:source_participant_scope_missing");
        }
        for decision in &participant.capability_decisions {
            let has_claim = decision.asserted_state.is_some();
            let valid_claim_shape = if let Some(asserted_state) = decision.asserted_state {
                let basis = decision.evidence_basis;
                let reference = decision.evidence_reference.as_deref();
                decision.evidence_scope != EvidenceScope::None
                    && decision.claim_physical_data_row.is_some_and(|row| row >= 2)
                    && match asserted_state {
                        CapabilityState::Capable | CapabilityState::Absent => {
                            basis.is_some_and(|value| value != EvidenceBasis::Unspecified)
                                && reference.is_some_and(|value| !value.is_empty())
                                && decision
                                    .evidence_sha256
                                    .as_deref()
                                    .is_none_or(is_sha256_wire)
                        }
                        CapabilityState::Unknown => {
                            basis == Some(EvidenceBasis::Unspecified)
                                && reference == Some("")
                                && decision.evidence_sha256.is_none()
                        }
                    }
            } else {
                decision.evidence_scope == EvidenceScope::None
                    && decision.evidence_basis.is_none()
                    && decision.evidence_reference.is_none()
                    && decision.evidence_sha256.is_none()
                    && decision.claim_physical_data_row.is_none()
            };
            if !valid_claim_shape || has_claim != decision.claim_physical_data_row.is_some() {
                return Err("b05_screen_validation_error:capability_claim_shape_mismatch");
            }
            let observable = decision.capability_id.observed_signal().is_some();
            if decision.observed_standalone_row_count > 0 && !observable {
                return Err("b05_screen_validation_error:nonobservable_capability_observed");
            }
            if decision.observed_standalone_row_count > 0
                && decision.asserted_state == Some(CapabilityState::Absent)
            {
                return Err("b05_screen_validation_error:observed_absent_capability");
            }
            let expected_decision = if decision.observed_standalone_row_count > 0 {
                (
                    CapabilityState::Capable,
                    CapabilityEvidenceOrigin::ObservedInBoundInput,
                    ObservationDisposition::Observed,
                )
            } else {
                match decision.asserted_state.unwrap_or(CapabilityState::Unknown) {
                    CapabilityState::Capable => (
                        CapabilityState::Capable,
                        CapabilityEvidenceOrigin::ManifestAssertion,
                        ObservationDisposition::CapableNoRow,
                    ),
                    CapabilityState::Absent => (
                        CapabilityState::Absent,
                        CapabilityEvidenceOrigin::ManifestAssertion,
                        ObservationDisposition::Absent,
                    ),
                    CapabilityState::Unknown => (
                        CapabilityState::Unknown,
                        if has_claim {
                            CapabilityEvidenceOrigin::ManifestAssertion
                        } else {
                            CapabilityEvidenceOrigin::None
                        },
                        if observable {
                            ObservationDisposition::Unknown
                        } else {
                            ObservationDisposition::NotObservable
                        },
                    ),
                }
            };
            if (
                decision.effective_state,
                decision.evidence_origin,
                decision.observation_disposition,
            ) != expected_decision
            {
                return Err("b05_screen_validation_error:capability_decision_incoherent");
            }
            if applicability
                .required_capability_ids
                .contains(&decision.capability_id)
                && decision.effective_state != CapabilityState::Capable
            {
                return Err("b05_screen_validation_error:required_capability_not_capable");
            }
        }
    }
    let required_signal_ids = &applicability.required_signal_ids;
    let required_capability_ids = &applicability.required_capability_ids;
    if required_signal_ids
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
        || required_capability_ids
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
    {
        return Err("b05_screen_validation_error:required_capability_order_mismatch");
    }
    if output.intervals.windows(2).any(|pair| {
        (
            &pair[0].participant_id,
            pair[0].start_ns,
            pair[0].start_boundary_source_row,
        ) >= (
            &pair[1].participant_id,
            pair[1].start_ns,
            pair[1].start_boundary_source_row,
        )
    }) {
        return Err("b05_screen_validation_error:interval_order_mismatch");
    }
    let mut interval_ids = BTreeSet::new();
    for interval in &output.intervals {
        if !interval_ids.insert(&interval.screen_interval_id) {
            return Err("b05_screen_validation_error:duplicate_interval_id");
        }
        if interval.strategy_id != expected_strategy {
            return Err("b05_screen_validation_error:interval_strategy_mismatch");
        }
        if interval.start_source_rows.is_empty()
            || interval.start_boundary_source_row == 0
            || u64::from(interval.start_boundary_source_row) > expected_input_row_count
            || interval
                .start_source_rows
                .iter()
                .chain(interval.stop_source_rows.iter())
                .any(|row| *row == 0 || u64::from(*row) > expected_input_row_count)
            || interval
                .stop_boundary_source_row
                .is_some_and(|row| row == 0 || u64::from(row) > expected_input_row_count)
            || !interval
                .start_source_rows
                .contains(&interval.start_boundary_source_row)
            || interval.stop_ns.is_some() != interval.stop_boundary_source_row.is_some()
            || interval.stop_ns.is_some() == interval.stop_source_rows.is_empty()
            || interval
                .stop_boundary_source_row
                .is_some_and(|row| !interval.stop_source_rows.contains(&row))
            || interval
                .stop_ns
                .is_some_and(|stop| stop < interval.start_ns)
            || (interval.stop_ns.is_none()
                && interval.close_reason
                    != ScreenIntervalCloseReason::RightCensoredObservationWindow)
            || (interval.stop_ns.is_some()
                && interval.close_reason
                    == ScreenIntervalCloseReason::RightCensoredObservationWindow)
        {
            return Err("b05_screen_validation_error:interval_boundary_shape_mismatch");
        }
        let rebuilt = make_screen_interval_from_parts(
            &interval.participant_id,
            interval.strategy_id,
            interval.kind,
            interval.start_ns,
            interval.stop_ns,
            interval.start_boundary_source_row,
            interval.stop_boundary_source_row,
            interval.start_source_rows.clone(),
            interval.stop_source_rows.clone(),
            interval.close_reason,
        );
        if rebuilt != *interval {
            return Err("b05_screen_validation_error:interval_identity_mismatch");
        }
    }
    if invalid_screen_dependency(&output.intervals).is_some() {
        return Err("b05_screen_validation_error:invalid_interval_dependency");
    }
    let Some(receipt) = output.construction_receipt.as_ref() else {
        return Err("b05_screen_validation_error:construction_receipt_missing");
    };
    if receipt.protocol_version != B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION
        || receipt.strategy_id != expected_strategy
        || receipt.relation != applicability.relation
    {
        return Err("b05_screen_validation_error:receipt_identity_mismatch");
    }
    let (source_identity, source_artifact_sha256, source_license_status) = match expected_strategy {
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => (
            "chronicle_feature_baseline_080801a",
            None,
            "GPL-3.0-only_project_native",
        ),
        ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => (
            "parry_toth_2025_doi_10.5117/CCR2025.1.8.PARR_osf_revision_2",
            Some(PARRY_TOTH_SOURCE_ARTIFACT_SHA256),
            "article_CC-BY-4.0_code_license_unset_independent_implementation",
        ),
        ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => (
            "zhu_2018_arxiv_1711.09408v1_doi_10.1177/2050157917748351",
            None,
            "paper_rule_independent_implementation",
        ),
        ScreenSessionConstructionStrategyId::UnlockToLockV1 => (
            "literature_direct_unlock_to_lock_rule_family_v1",
            None,
            "paper_rules_independent_implementation",
        ),
        ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => (
            "literature_direct_unlock_to_off_or_lock_rule_family_v1",
            None,
            "paper_rules_independent_implementation",
        ),
    };
    if receipt.source_identity != source_identity
        || receipt.source_artifact_sha256.as_deref() != source_artifact_sha256
        || receipt.source_license_status != source_license_status
        || receipt.input_row_count != expected_input_row_count
    {
        return Err("b05_screen_validation_error:receipt_source_metadata_mismatch");
    }
    let participant_count = applicability
        .participant_decisions
        .iter()
        .filter(|participant| !participant.participant_id.is_empty())
        .count() as u64;
    let session_count = output
        .intervals
        .iter()
        .filter(|interval| interval.kind == ScreenIntervalKind::Session)
        .count() as u64;
    let glance_count = output.intervals.len() as u64 - session_count;
    let right_censored_count = output
        .intervals
        .iter()
        .filter(|interval| interval.right_censored)
        .count() as u64;
    if receipt.participant_count != participant_count
        || receipt.interval_count != output.intervals.len() as u64
        || receipt.session_count != session_count
        || receipt.glance_count != glance_count
        || receipt.right_censored_count != right_censored_count
        || receipt.interval_digest != screen_interval_digest(&output.intervals)
    {
        return Err("b05_screen_validation_error:receipt_counts_or_digest_mismatch");
    }
    let mut sorted_issues = output.issues.clone();
    sorted_issues.sort_by(|left, right| {
        (&left.participant_id, left.source_data_row, left.code).cmp(&(
            &right.participant_id,
            right.source_data_row,
            right.code,
        ))
    });
    if sorted_issues != output.issues
        || output.issues.windows(2).any(|pair| {
            (
                &pair[0].participant_id,
                pair[0].source_data_row,
                pair[0].code,
            ) >= (
                &pair[1].participant_id,
                pair[1].source_data_row,
                pair[1].code,
            )
        })
    {
        return Err("b05_screen_validation_error:issue_order_mismatch");
    }
    let mut issue_counts = BTreeMap::new();
    for issue in &output.issues {
        *issue_counts
            .entry(issue.code.canonical_id().to_owned())
            .or_insert(0_u64) += 1;
    }
    if receipt.issue_counts != issue_counts {
        return Err("b05_screen_validation_error:issue_counts_mismatch");
    }
    Ok(())
}

/// Rebind request-level provenance without replaying capability resolution or
/// the screen state machine. The options digest is part of the applicability
/// resolution commitment, so callers must use this helper rather than mutate
/// the public field alone.
pub fn rebind_screen_construction_options_digest(
    output: &ScreenConstructionOutput,
    options_digest: &str,
) -> ScreenConstructionOutput {
    let mut rebound = output.clone();
    rebound.applicability.options_digest = options_digest.to_owned();
    rebound.applicability.capability_resolution_digest =
        applicability_resolution_digest(&rebound.applicability);
    rebound
}

/// Rebind the request-level Chronicle relation as well as its exact options
/// provenance. The persisted canonical screen substrate is computationally
/// independent of whether the default was omitted or explicitly selected;
/// that distinction belongs only in the published applicability receipt.
pub fn rebind_chronicle_screen_construction_receipt(
    output: &ScreenConstructionOutput,
    options_digest: &str,
    selection_was_explicit: bool,
) -> ScreenConstructionOutput {
    let mut rebound = rebind_screen_construction_options_digest(output, options_digest);
    debug_assert_eq!(
        rebound.applicability.effective_strategy_id,
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
    );
    let relation = if selection_was_explicit {
        ScientificRelation::BaselineEquivalent
    } else {
        ScientificRelation::BaselineNative
    };
    rebound.applicability.relation = relation;
    if let Some(receipt) = rebound.construction_receipt.as_mut() {
        receipt.relation = relation;
    }
    rebound.applicability.capability_resolution_digest =
        applicability_resolution_digest(&rebound.applicability);
    rebound
}

/// Exact boundary projection supplied by Chronicle's established canonical
/// screen builder.  The B05 core assigns the immutable interval identity and
/// receipt, but deliberately does not rebuild the baseline from raw rows.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleScreenIntervalInput {
    pub participant_id: String,
    pub start_ns: i64,
    pub stop_ns: Option<i64>,
    pub start_boundary_source_row: u32,
    pub stop_boundary_source_row: Option<u32>,
    pub start_source_rows: Vec<u32>,
    pub stop_source_rows: Vec<u32>,
    pub close_reason: ScreenIntervalCloseReason,
}

impl ScreenConstructionOutput {
    pub fn executable(&self) -> bool {
        self.applicability.executable
    }
}

/// Resolve applicability and, only when executable, run the selected B05
/// implementation.  A scientific refusal returns an output receipt with no
/// intervals and never invokes a fallback strategy.
pub fn construct_screen_intervals(
    strategy: ScreenSessionConstructionStrategyId,
    input: B05ApplicabilityInput<'_>,
) -> Result<ScreenConstructionOutput, CapabilityEvidenceError> {
    if strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
        return Err(CapabilityEvidenceError {
            class: "invalid_screen_construction_entry_point",
            detail: CapabilityEvidenceErrorDetail::ChronicleBaselineRequiresCanonicalAdapter,
            physical_data_row: None,
        });
    }
    let raw_events = input.raw_events;
    let applicability = resolve_b05_applicability(strategy, input)?;
    if !applicability.executable {
        return Ok(ScreenConstructionOutput {
            intervals: Vec::new(),
            applicability,
            construction_receipt: None,
            issues: Vec::new(),
        });
    }

    let mut partitions = BTreeMap::<String, Vec<&RawB05Event>>::new();
    for event in raw_events {
        partitions
            .entry(event.participant_id.clone())
            .or_default()
            .push(event);
    }
    let participant_count = partitions.len() as u64;
    let mut intervals = Vec::new();
    let mut issues = Vec::new();
    for (participant_id, rows) in partitions {
        let (mut participant_intervals, mut participant_issues) = match strategy {
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => {
                construct_chronicle_partition(&participant_id, &rows)
            }
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => {
                construct_parry_toth_partition(&participant_id, &rows)
            }
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => {
                construct_zhu_partition(&participant_id, &rows)
            }
            ScreenSessionConstructionStrategyId::UnlockToLockV1
            | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
                construct_direct_unlock_partition(strategy, &participant_id, &rows)
            }
        };
        intervals.append(&mut participant_intervals);
        issues.append(&mut participant_issues);
    }
    intervals.sort_by(|left, right| {
        (
            &left.participant_id,
            left.start_ns,
            left.start_boundary_source_row,
        )
            .cmp(&(
                &right.participant_id,
                right.start_ns,
                right.start_boundary_source_row,
            ))
    });
    issues.sort_by(|left, right| {
        (&left.participant_id, left.source_data_row, left.code).cmp(&(
            &right.participant_id,
            right.source_data_row,
            right.code,
        ))
    });
    let mut issue_counts = BTreeMap::new();
    for issue in &issues {
        *issue_counts
            .entry(issue.code.canonical_id().to_owned())
            .or_insert(0) += 1;
    }
    let interval_digest = screen_interval_digest(&intervals);
    let construction_receipt = ScreenConstructionReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        strategy_id: strategy,
        relation: applicability.relation,
        source_identity: match strategy {
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => {
                "chronicle_feature_baseline_080801a"
            }
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => {
                "parry_toth_2025_doi_10.5117/CCR2025.1.8.PARR_osf_revision_2"
            }
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => {
                "zhu_2018_arxiv_1711.09408v1_doi_10.1177/2050157917748351"
            }
            ScreenSessionConstructionStrategyId::UnlockToLockV1 => {
                "literature_direct_unlock_to_lock_rule_family_v1"
            }
            ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
                "literature_direct_unlock_to_off_or_lock_rule_family_v1"
            }
        }
        .into(),
        source_artifact_sha256: match strategy {
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => {
                Some(PARRY_TOTH_SOURCE_ARTIFACT_SHA256.into())
            }
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
            | ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1
            | ScreenSessionConstructionStrategyId::UnlockToLockV1
            | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => None,
        },
        source_license_status: match strategy {
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => {
                "GPL-3.0-only_project_native"
            }
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => {
                "article_CC-BY-4.0_code_license_unset_independent_implementation"
            }
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => {
                "paper_rule_independent_implementation"
            }
            ScreenSessionConstructionStrategyId::UnlockToLockV1
            | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => {
                "paper_rules_independent_implementation"
            }
        }
        .into(),
        input_row_count: raw_events.len() as u64,
        participant_count,
        interval_count: intervals.len() as u64,
        session_count: intervals
            .iter()
            .filter(|interval| interval.kind == ScreenIntervalKind::Session)
            .count() as u64,
        glance_count: intervals
            .iter()
            .filter(|interval| interval.kind == ScreenIntervalKind::Glance)
            .count() as u64,
        right_censored_count: intervals
            .iter()
            .filter(|interval| interval.right_censored)
            .count() as u64,
        issue_counts,
        interval_digest,
    };
    Ok(ScreenConstructionOutput {
        intervals,
        applicability,
        construction_receipt: Some(construction_receipt),
        issues,
    })
}

/// Finalize the Chronicle baseline from the intervals emitted by the actual
/// canonical/default screen chain.  This is the only accepted baseline
/// adapter: source-sensitive strategies continue to execute directly over the
/// raw physical stream through [`construct_screen_intervals`].
pub fn adapt_chronicle_screen_intervals(
    input: B05ApplicabilityInput<'_>,
    canonical_intervals: &[ChronicleScreenIntervalInput],
) -> Result<ScreenConstructionOutput, CapabilityEvidenceError> {
    adapt_chronicle_screen_intervals_with_issues(input, canonical_intervals, &[])
}

pub fn adapt_chronicle_screen_intervals_with_issues(
    input: B05ApplicabilityInput<'_>,
    canonical_intervals: &[ChronicleScreenIntervalInput],
    canonical_issues: &[ScreenConstructionIssue],
) -> Result<ScreenConstructionOutput, CapabilityEvidenceError> {
    let raw_event_count = input.raw_events.len() as u64;
    let applicability = resolve_b05_applicability(
        ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
        input,
    )?;
    if !applicability.executable {
        return Ok(ScreenConstructionOutput {
            intervals: Vec::new(),
            applicability,
            construction_receipt: None,
            issues: Vec::new(),
        });
    }

    let mut intervals = canonical_intervals
        .iter()
        .map(|interval| {
            make_screen_interval_from_parts(
                &interval.participant_id,
                ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
                ScreenIntervalKind::Session,
                interval.start_ns,
                interval.stop_ns,
                interval.start_boundary_source_row,
                interval.stop_boundary_source_row,
                interval.start_source_rows.clone(),
                interval.stop_source_rows.clone(),
                interval.close_reason,
            )
        })
        .collect::<Vec<_>>();
    intervals.sort_by(|left, right| {
        (
            &left.participant_id,
            left.start_ns,
            left.start_boundary_source_row,
        )
            .cmp(&(
                &right.participant_id,
                right.start_ns,
                right.start_boundary_source_row,
            ))
    });
    let participant_count = applicability
        .participant_decisions
        .iter()
        .filter(|participant| !participant.participant_id.is_empty())
        .count() as u64;
    let mut issues = canonical_issues.to_vec();
    issues.sort_by(|left, right| {
        (&left.participant_id, left.source_data_row, left.code).cmp(&(
            &right.participant_id,
            right.source_data_row,
            right.code,
        ))
    });
    let mut issue_counts = BTreeMap::new();
    for issue in &issues {
        *issue_counts
            .entry(issue.code.canonical_id().to_owned())
            .or_insert(0) += 1;
    }
    let receipt = ScreenConstructionReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        strategy_id: ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
        relation: applicability.relation,
        source_identity: "chronicle_feature_baseline_080801a".into(),
        source_artifact_sha256: None,
        source_license_status: "GPL-3.0-only_project_native".into(),
        input_row_count: raw_event_count,
        participant_count,
        interval_count: intervals.len() as u64,
        session_count: intervals.len() as u64,
        glance_count: 0,
        right_censored_count: intervals
            .iter()
            .filter(|interval| interval.right_censored)
            .count() as u64,
        issue_counts,
        interval_digest: screen_interval_digest(&intervals),
    };
    Ok(ScreenConstructionOutput {
        intervals,
        applicability,
        construction_receipt: Some(receipt),
        issues,
    })
}

#[derive(Debug, Clone)]
struct ChronicleOpen<'a> {
    start: &'a RawB05Event,
    start_source_rows: Vec<u32>,
}

fn construct_chronicle_partition(
    participant_id: &str,
    rows: &[&RawB05Event],
) -> (Vec<ScreenIntervalEvidence>, Vec<ScreenConstructionIssue>) {
    let mut intervals = Vec::new();
    let mut issues = Vec::new();
    let mut open: Option<ChronicleOpen<'_>> = None;
    for row in rows
        .iter()
        .copied()
        .filter(|row| row.timestamp_ns.is_some())
    {
        let is_start = matches!(
            row.signal,
            AndroidUsageSignal::ScreenInteractive
                | AndroidUsageSignal::CombinedScreenInteractiveKeyguardShown
        );
        let is_stop = matches!(
            row.signal,
            AndroidUsageSignal::ScreenNonInteractive
                | AndroidUsageSignal::CombinedScreenNonInteractiveKeyguardHidden
        ) || row.raw_interaction_type == "Device Screen Off";
        if is_start {
            if let Some(current) = open.as_mut() {
                current.start_source_rows.push(row.source_data_row);
            } else {
                open = Some(ChronicleOpen {
                    start: row,
                    start_source_rows: vec![row.source_data_row],
                });
            }
        } else if is_stop {
            if let Some(current) = open.take() {
                intervals.push(make_screen_interval(
                    participant_id,
                    ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
                    ScreenIntervalKind::Session,
                    current.start,
                    Some(row),
                    current.start_source_rows,
                    vec![row.source_data_row],
                    if row.raw_interaction_type == "Device Screen Off" {
                        ScreenIntervalCloseReason::DeviceScreenOff
                    } else {
                        ScreenIntervalCloseReason::ScreenNonInteractive
                    },
                ));
            } else {
                issues.push(ScreenConstructionIssue {
                    participant_id: participant_id.into(),
                    source_data_row: row.source_data_row,
                    code: ScreenConstructionIssueCode::ChronicleOrphanStop,
                });
            }
        }
    }
    if let Some(current) = open {
        intervals.push(make_screen_interval(
            participant_id,
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
            ScreenIntervalKind::Session,
            current.start,
            None,
            current.start_source_rows,
            Vec::new(),
            ScreenIntervalCloseReason::RightCensoredObservationWindow,
        ));
    }
    (intervals, issues)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParryEndpointKind {
    GlanceStart,
    GlanceStop,
    SessionStart,
    SessionStop,
}

impl ParryEndpointKind {
    fn is_start(self) -> bool {
        matches!(self, Self::GlanceStart | Self::SessionStart)
    }

    fn interval_kind(self) -> ScreenIntervalKind {
        match self {
            Self::GlanceStart | Self::GlanceStop => ScreenIntervalKind::Glance,
            Self::SessionStart | Self::SessionStop => ScreenIntervalKind::Session,
        }
    }
}

#[derive(Debug, Clone)]
struct ParryEndpoint<'a> {
    row: &'a RawB05Event,
    kind: ParryEndpointKind,
    classification_rows: Vec<u32>,
}

fn construct_parry_toth_partition(
    participant_id: &str,
    rows: &[&RawB05Event],
) -> (Vec<ScreenIntervalEvidence>, Vec<ScreenConstructionIssue>) {
    let screen_rows = rows
        .iter()
        .copied()
        .filter(|row| {
            matches!(
                row.signal,
                AndroidUsageSignal::ScreenInteractive
                    | AndroidUsageSignal::ScreenNonInteractive
                    | AndroidUsageSignal::KeyguardShown
                    | AndroidUsageSignal::KeyguardHidden
                    | AndroidUsageSignal::DeviceShutdown
                    | AndroidUsageSignal::DeviceStartup
            )
        })
        .collect::<Vec<_>>();
    let mut endpoints = Vec::new();
    for (index, row) in screen_rows.iter().copied().enumerate() {
        let previous = index
            .checked_sub(1)
            .and_then(|index| screen_rows.get(index));
        let next = screen_rows.get(index + 1);
        let neighbor_is = |signal| {
            previous.is_some_and(|event| event.signal == signal)
                || next.is_some_and(|event| event.signal == signal)
        };
        let kind = match row.signal {
            AndroidUsageSignal::ScreenInteractive => {
                if neighbor_is(AndroidUsageSignal::KeyguardHidden) {
                    ParryEndpointKind::SessionStart
                } else {
                    ParryEndpointKind::GlanceStart
                }
            }
            AndroidUsageSignal::ScreenNonInteractive => {
                if neighbor_is(AndroidUsageSignal::KeyguardShown) {
                    ParryEndpointKind::SessionStop
                } else {
                    ParryEndpointKind::GlanceStop
                }
            }
            AndroidUsageSignal::DeviceShutdown => ParryEndpointKind::SessionStop,
            AndroidUsageSignal::DeviceStartup => ParryEndpointKind::SessionStart,
            AndroidUsageSignal::KeyguardShown | AndroidUsageSignal::KeyguardHidden => continue,
            _ => unreachable!("screen projection contains only P&T signals"),
        };
        let mut classification_rows = vec![row.source_data_row];
        let required_neighbor = match kind {
            ParryEndpointKind::SessionStart
                if row.signal == AndroidUsageSignal::ScreenInteractive =>
            {
                Some(AndroidUsageSignal::KeyguardHidden)
            }
            ParryEndpointKind::SessionStop
                if row.signal == AndroidUsageSignal::ScreenNonInteractive =>
            {
                Some(AndroidUsageSignal::KeyguardShown)
            }
            _ => None,
        };
        if let Some(required_neighbor) = required_neighbor {
            if let Some(neighbor) = previous
                .into_iter()
                .chain(next)
                .find(|neighbor| neighbor.signal == required_neighbor)
            {
                classification_rows.push(neighbor.source_data_row);
                classification_rows.sort_unstable();
            }
        }
        endpoints.push(ParryEndpoint {
            row,
            kind,
            classification_rows,
        });
    }

    let mut issues = Vec::new();
    let mut keep = vec![true; endpoints.len()];
    for (index, endpoint) in endpoints.iter().enumerate() {
        match endpoint.kind {
            ParryEndpointKind::GlanceStart => {
                let code = match endpoints.get(index + 1) {
                    None => Some(ScreenConstructionIssueCode::UnmatchedGlanceStartNoNextStop),
                    Some(next) if next.kind != ParryEndpointKind::GlanceStop => {
                        Some(ScreenConstructionIssueCode::UnmatchedGlanceStartNextNotStop)
                    }
                    Some(_) => None,
                };
                if let Some(code) = code {
                    keep[index] = false;
                    issues.push(issue(participant_id, endpoint.row.source_data_row, code));
                }
            }
            ParryEndpointKind::GlanceStop => {
                let code = match index.checked_sub(1).and_then(|index| endpoints.get(index)) {
                    None => Some(ScreenConstructionIssueCode::UnmatchedGlanceStopNoPreviousStart),
                    Some(previous) if previous.kind != ParryEndpointKind::GlanceStart => {
                        Some(ScreenConstructionIssueCode::UnmatchedGlanceStopPreviousNotStart)
                    }
                    Some(_) => None,
                };
                if let Some(code) = code {
                    keep[index] = false;
                    issues.push(issue(participant_id, endpoint.row.source_data_row, code));
                }
            }
            ParryEndpointKind::SessionStart | ParryEndpointKind::SessionStop => {}
        }
    }
    let after_glance = endpoints
        .into_iter()
        .zip(keep)
        .filter_map(|(endpoint, keep)| keep.then_some(endpoint))
        .collect::<Vec<_>>();
    let mut keep = vec![true; after_glance.len()];
    for (index, endpoint) in after_glance.iter().enumerate() {
        match endpoint.kind {
            ParryEndpointKind::SessionStart => {
                let code = match after_glance.get(index + 1) {
                    None => Some(ScreenConstructionIssueCode::UnmatchedSessionStartNoNextStop),
                    Some(next) if next.kind != ParryEndpointKind::SessionStop => {
                        Some(ScreenConstructionIssueCode::UnmatchedSessionStartNextNotStop)
                    }
                    Some(_) => None,
                };
                if let Some(code) = code {
                    keep[index] = false;
                    issues.push(issue(participant_id, endpoint.row.source_data_row, code));
                }
            }
            ParryEndpointKind::SessionStop => {
                let code = match index
                    .checked_sub(1)
                    .and_then(|index| after_glance.get(index))
                {
                    None => Some(ScreenConstructionIssueCode::UnmatchedSessionStopNoPreviousStart),
                    Some(previous) if previous.kind != ParryEndpointKind::SessionStart => {
                        Some(ScreenConstructionIssueCode::UnmatchedSessionStopPreviousNotStart)
                    }
                    Some(_) => None,
                };
                if let Some(code) = code {
                    keep[index] = false;
                    issues.push(issue(participant_id, endpoint.row.source_data_row, code));
                }
            }
            ParryEndpointKind::GlanceStart | ParryEndpointKind::GlanceStop => {}
        }
    }
    let surviving = after_glance
        .into_iter()
        .zip(keep)
        .filter_map(|(endpoint, keep)| keep.then_some(endpoint))
        .collect::<Vec<_>>();
    let mut intervals = Vec::new();
    for pair in surviving.windows(2) {
        let start = &pair[0];
        let stop = &pair[1];
        if !start.kind.is_start() || start.kind.interval_kind() != stop.kind.interval_kind() {
            continue;
        }
        let close_reason = if stop.row.signal == AndroidUsageSignal::DeviceShutdown {
            ScreenIntervalCloseReason::DeviceShutdown
        } else {
            ScreenIntervalCloseReason::ScreenNonInteractive
        };
        intervals.push(make_screen_interval(
            participant_id,
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            start.kind.interval_kind(),
            start.row,
            Some(stop.row),
            start.classification_rows.clone(),
            stop.classification_rows.clone(),
            close_reason,
        ));
    }
    (intervals, issues)
}

fn construct_zhu_partition(
    participant_id: &str,
    rows: &[&RawB05Event],
) -> (Vec<ScreenIntervalEvidence>, Vec<ScreenConstructionIssue>) {
    let mut intervals = Vec::new();
    let mut issues = Vec::new();
    let mut open: Option<(&RawB05Event, Vec<u32>)> = None;
    for (index, row) in rows.iter().copied().enumerate() {
        if open.is_none() {
            if row.signal == AndroidUsageSignal::ScreenInteractive {
                match rows.get(index + 1).copied() {
                    Some(hidden) if hidden.signal == AndroidUsageSignal::KeyguardHidden => {
                        open = Some((hidden, vec![row.source_data_row, hidden.source_data_row]));
                    }
                    Some(_) => issues.push(issue(
                        participant_id,
                        row.source_data_row,
                        ScreenConstructionIssueCode::ZhuScreenInteractiveNextNotKeyguardHidden,
                    )),
                    None => issues.push(issue(
                        participant_id,
                        row.source_data_row,
                        ScreenConstructionIssueCode::ZhuScreenInteractiveNoNextRow,
                    )),
                }
            } else if matches!(
                row.signal,
                AndroidUsageSignal::ScreenNonInteractive | AndroidUsageSignal::DeviceShutdown
            ) {
                issues.push(issue(
                    participant_id,
                    row.source_data_row,
                    ScreenConstructionIssueCode::ZhuOrphanStop,
                ));
            }
            continue;
        }
        if matches!(
            row.signal,
            AndroidUsageSignal::ScreenNonInteractive | AndroidUsageSignal::DeviceShutdown
        ) {
            let (start, start_rows) = open.take().expect("open state was checked");
            intervals.push(make_screen_interval(
                participant_id,
                ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
                ScreenIntervalKind::Session,
                start,
                Some(row),
                start_rows,
                vec![row.source_data_row],
                if row.signal == AndroidUsageSignal::DeviceShutdown {
                    ScreenIntervalCloseReason::DeviceShutdown
                } else {
                    ScreenIntervalCloseReason::ScreenNonInteractive
                },
            ));
        }
    }
    if let Some((start, start_rows)) = open {
        intervals.push(make_screen_interval(
            participant_id,
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
            ScreenIntervalKind::Session,
            start,
            None,
            start_rows,
            Vec::new(),
            ScreenIntervalCloseReason::RightCensoredObservationWindow,
        ));
    }
    (intervals, issues)
}

fn construct_direct_unlock_partition(
    strategy: ScreenSessionConstructionStrategyId,
    participant_id: &str,
    rows: &[&RawB05Event],
) -> (Vec<ScreenIntervalEvidence>, Vec<ScreenConstructionIssue>) {
    debug_assert!(matches!(
        strategy,
        ScreenSessionConstructionStrategyId::UnlockToLockV1
            | ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1
    ));
    let mut intervals = Vec::new();
    let mut open = None;
    for row in rows.iter().copied() {
        if row.signal == AndroidUsageSignal::KeyguardHidden {
            if open.is_none() {
                open = Some(row);
            }
            continue;
        }
        let closes = row.signal == AndroidUsageSignal::KeyguardShown
            || (strategy == ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1
                && row.signal == AndroidUsageSignal::ScreenNonInteractive);
        if closes {
            if let Some(start) = open.take() {
                intervals.push(make_screen_interval(
                    participant_id,
                    strategy,
                    ScreenIntervalKind::Session,
                    start,
                    Some(row),
                    vec![start.source_data_row],
                    vec![row.source_data_row],
                    if row.signal == AndroidUsageSignal::KeyguardShown {
                        ScreenIntervalCloseReason::KeyguardShown
                    } else {
                        ScreenIntervalCloseReason::ScreenNonInteractive
                    },
                ));
            }
        }
    }
    if let Some(start) = open {
        intervals.push(make_screen_interval(
            participant_id,
            strategy,
            ScreenIntervalKind::Session,
            start,
            None,
            vec![start.source_data_row],
            Vec::new(),
            ScreenIntervalCloseReason::RightCensoredObservationWindow,
        ));
    }
    (intervals, Vec::new())
}

fn issue(
    participant_id: &str,
    source_data_row: u32,
    code: ScreenConstructionIssueCode,
) -> ScreenConstructionIssue {
    ScreenConstructionIssue {
        participant_id: participant_id.into(),
        source_data_row,
        code,
    }
}

#[allow(clippy::too_many_arguments)]
fn make_screen_interval(
    participant_id: &str,
    strategy_id: ScreenSessionConstructionStrategyId,
    kind: ScreenIntervalKind,
    start: &RawB05Event,
    stop: Option<&RawB05Event>,
    start_source_rows: Vec<u32>,
    stop_source_rows: Vec<u32>,
    close_reason: ScreenIntervalCloseReason,
) -> ScreenIntervalEvidence {
    let start_ns = start
        .timestamp_ns
        .expect("state-machine applicability excludes missing boundary timestamps");
    let stop_ns = stop.and_then(|event| event.timestamp_ns);
    let stop_boundary_source_row = stop.map(|event| event.source_data_row);
    make_screen_interval_from_parts(
        participant_id,
        strategy_id,
        kind,
        start_ns,
        stop_ns,
        start.source_data_row,
        stop_boundary_source_row,
        start_source_rows,
        stop_source_rows,
        close_reason,
    )
}

#[allow(clippy::too_many_arguments)]
fn make_screen_interval_from_parts(
    participant_id: &str,
    strategy_id: ScreenSessionConstructionStrategyId,
    kind: ScreenIntervalKind,
    start_ns: i64,
    stop_ns: Option<i64>,
    start_boundary_source_row: u32,
    stop_boundary_source_row: Option<u32>,
    mut start_source_rows: Vec<u32>,
    mut stop_source_rows: Vec<u32>,
    close_reason: ScreenIntervalCloseReason,
) -> ScreenIntervalEvidence {
    start_source_rows.sort_unstable();
    start_source_rows.dedup();
    stop_source_rows.sort_unstable();
    stop_source_rows.dedup();
    let right_censored = stop_ns.is_none();
    let mut identity = Vec::new();
    digest_field(&mut identity, B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION);
    digest_field(&mut identity, participant_id);
    digest_field(&mut identity, strategy_id.canonical_id());
    digest_field(&mut identity, kind.canonical_id());
    digest_field(&mut identity, &start_ns.to_string());
    digest_field(&mut identity, &start_boundary_source_row.to_string());
    digest_field(
        &mut identity,
        &stop_ns.map(|value| value.to_string()).unwrap_or_default(),
    );
    digest_field(
        &mut identity,
        &stop_boundary_source_row
            .map(|value| value.to_string())
            .unwrap_or_default(),
    );
    for row in &start_source_rows {
        digest_field(&mut identity, &row.to_string());
    }
    digest_field(&mut identity, "|");
    for row in &stop_source_rows {
        digest_field(&mut identity, &row.to_string());
    }
    digest_field(&mut identity, close_reason.canonical_id());
    digest_field(&mut identity, "0");
    digest_field(&mut identity, if right_censored { "1" } else { "0" });
    let screen_interval_id = format!("urn:chronicle:screen-interval:{}", sha256_wire(&identity));
    ScreenIntervalEvidence {
        screen_interval_id,
        participant_id: participant_id.into(),
        strategy_id,
        kind,
        start_ns,
        stop_ns,
        start_boundary_source_row,
        stop_boundary_source_row,
        start_source_rows,
        stop_source_rows,
        close_reason,
        left_censored: false,
        right_censored,
    }
}

fn screen_interval_digest(intervals: &[ScreenIntervalEvidence]) -> String {
    let mut material = Vec::new();
    for interval in intervals {
        digest_field(&mut material, &interval.screen_interval_id);
        digest_field(&mut material, &interval.participant_id);
        digest_field(&mut material, interval.strategy_id.canonical_id());
        digest_field(&mut material, interval.kind.canonical_id());
        digest_field(&mut material, &interval.start_ns.to_string());
        digest_field(
            &mut material,
            &interval
                .stop_ns
                .map(|value| value.to_string())
                .unwrap_or_default(),
        );
        digest_field(
            &mut material,
            &interval.start_boundary_source_row.to_string(),
        );
        digest_field(
            &mut material,
            &interval
                .stop_boundary_source_row
                .map(|value| value.to_string())
                .unwrap_or_default(),
        );
        for row in &interval.start_source_rows {
            digest_field(&mut material, &row.to_string());
        }
        digest_field(&mut material, "|");
        for row in &interval.stop_source_rows {
            digest_field(&mut material, &row.to_string());
        }
        digest_field(&mut material, interval.close_reason.canonical_id());
        digest_field(
            &mut material,
            if interval.left_censored { "1" } else { "0" },
        );
        digest_field(
            &mut material,
            if interval.right_censored { "1" } else { "0" },
        );
    }
    sha256_wire(&material)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchoedelCompletion {
    LastPackageEventBeforeDifferentApp,
    LastPackageEventBeforeScreenEnd,
    SingletonZeroLength,
    RightCensoredScreenInterval,
}

impl SchoedelCompletion {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::LastPackageEventBeforeDifferentApp => "last_package_event_before_different_app",
            Self::LastPackageEventBeforeScreenEnd => "last_package_event_before_screen_end",
            Self::SingletonZeroLength => "singleton_zero_length",
            Self::RightCensoredScreenInterval => "right_censored_screen_interval",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelEpisodeEvidence {
    pub episode_id: String,
    pub participant_id: String,
    pub package_name: String,
    pub screen_interval_id: String,
    pub b05_strategy_id: ScreenSessionConstructionStrategyId,
    pub start_ns: i64,
    pub stop_ns: Option<i64>,
    pub raw_duration_ns: Option<i64>,
    pub start_source_row: u32,
    pub stop_source_row: Option<u32>,
    pub source_rows: Vec<u32>,
    pub completion: SchoedelCompletion,
    /// False only for an unbounded right-censored evidence row. B03/B04 and
    /// later cleaning still decide the fate of bounded zero-length episodes.
    pub bounded_headline_candidate: bool,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum SchoedelIssueCode {
    #[serde(rename = "screen_interval_without_app_launch")]
    ScreenIntervalWithoutAppLaunch,
    #[serde(rename = "type_1_missing_package")]
    TypeOneMissingPackage,
}

impl SchoedelIssueCode {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ScreenIntervalWithoutAppLaunch => "screen_interval_without_app_launch",
            Self::TypeOneMissingPackage => "type_1_missing_package",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelIssue {
    pub participant_id: String,
    pub screen_interval_id: String,
    pub source_data_row: Option<u32>,
    pub code: SchoedelIssueCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SchoedelRefusalReason {
    #[serde(rename = "ambiguous_equal_timestamp")]
    AmbiguousEqualTimestamp,
    #[serde(rename = "unorderable_full_stream_row")]
    UnorderableAppRow,
    #[serde(rename = "invalid_screen_interval_dependency")]
    InvalidScreenIntervalDependency,
    #[serde(rename = "schoedel_full_osf_missing_prerequisites")]
    SchoedelFullOsfMissingPrerequisites,
    #[serde(rename = "capability_evidence_not_bound_to_input")]
    CapabilityEvidenceNotBoundToInput,
}

impl SchoedelRefusalReason {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::AmbiguousEqualTimestamp => "ambiguous_equal_timestamp",
            Self::UnorderableAppRow => "unorderable_full_stream_row",
            Self::InvalidScreenIntervalDependency => "invalid_screen_interval_dependency",
            Self::SchoedelFullOsfMissingPrerequisites => "schoedel_full_osf_missing_prerequisites",
            Self::CapabilityEvidenceNotBoundToInput => "capability_evidence_not_bound_to_input",
        }
    }
}

pub const SCHOEDEL_FULL_OSF_REQUIRED_INPUTS: &[&str] = &[
    "phonestudy_on_unlocked_off_locked_off_unlocked_states",
    "call_spans",
    "application_category_table",
    "corrected_timestamps",
    "client_ids_and_names",
    "surrounding_query_rows",
    "licensed_source_authority",
];

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelApplicabilityReceiptV1 {
    pub protocol_version: String,
    pub requested_strategy_id: String,
    pub effective_strategy_id: String,
    pub relation: ScientificRelation,
    pub executable: bool,
    pub refusal_reason: Option<SchoedelRefusalReason>,
    pub refusal_detail: Option<String>,
    pub b05_interval_digest: String,
    pub b05_strategy_ids: Vec<ScreenSessionConstructionStrategyId>,
    pub equal_timestamp_source_order_preserved: bool,
    pub decisive_equal_timestamp_group_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_order_resolution: Option<SchoedelSourceOrderResolution>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelReconstructionReceiptV1 {
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
    pub episode_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoedelReconstructionOutput {
    pub episodes: Vec<SchoedelEpisodeEvidence>,
    pub applicability: SchoedelApplicabilityReceiptV1,
    pub reconstruction_receipt: Option<SchoedelReconstructionReceiptV1>,
    pub issues: Vec<SchoedelIssue>,
}

impl SchoedelReconstructionOutput {
    /// Heap bytes the episode and issue records own, for the payload budget.
    /// A method rather than a free function: the workflow field-use scan
    /// attributes field access in free functions reachable from a product
    /// step to that step, and budget accounting is not a data read.
    pub fn heap_bytes(&self) -> usize {
        self.episodes.capacity() * std::mem::size_of::<SchoedelEpisodeEvidence>()
            + self
                .episodes
                .iter()
                .map(|episode| {
                    episode.episode_id.capacity()
                        + episode.participant_id.capacity()
                        + episode.package_name.capacity()
                        + episode.screen_interval_id.capacity()
                        + episode.source_rows.capacity() * std::mem::size_of::<u32>()
                })
                .sum::<usize>()
            + self.issues.capacity() * std::mem::size_of::<SchoedelIssue>()
            + self
                .issues
                .iter()
                .map(|issue| issue.participant_id.capacity() + issue.screen_interval_id.capacity())
                .sum::<usize>()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SchoedelProseInput<'a> {
    pub raw_events: &'a [RawB05Event],
    pub screen_intervals: &'a [ScreenIntervalEvidence],
    pub equal_timestamp_source_order_preserved: bool,
}

/// Production composition input. The selected B05 strategy is carried even
/// when it emitted zero intervals, preventing empty-output crossings from
/// aliasing in the Schoedel receipt.
#[derive(Debug, Clone, Copy)]
pub struct BoundSchoedelProseInput<'a> {
    pub raw_events: &'a [RawB05Event],
    pub screen_intervals: &'a [ScreenIntervalEvidence],
    pub selected_b05_strategy_id: ScreenSessionConstructionStrategyId,
    pub equal_timestamp_source_order_preserved: bool,
    /// Participant-scoped capability assertions; production callers bind this
    /// exact resolution receipt. The global boolean above feeds reconstruction
    /// only: `validate_schoedel_reconstruction_output` derives
    /// `equal_timestamp_source_order_preserved` from this resolution alone, so
    /// an output built on the boolean without a resolution does not validate.
    pub source_order_resolution: Option<&'a SchoedelSourceOrderResolution>,
}

/// Register the deposited full pipeline as structurally unavailable on
/// ordinary Chronicle inputs.  This is intentionally a refusal-only API, not
/// an empty implementation arm.
pub fn schoedel_full_osf_refusal() -> SchoedelApplicabilityReceiptV1 {
    SchoedelApplicabilityReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        requested_strategy_id: "schoedel_2026_full_osf_v1".into(),
        effective_strategy_id: "schoedel_2026_full_osf_v1".into(),
        relation: ScientificRelation::Refused,
        executable: false,
        refusal_reason: Some(SchoedelRefusalReason::SchoedelFullOsfMissingPrerequisites),
        refusal_detail: Some(SCHOEDEL_FULL_OSF_REQUIRED_INPUTS.join(",")),
        b05_interval_digest: sha256_wire(&[]),
        b05_strategy_ids: Vec::new(),
        equal_timestamp_source_order_preserved: false,
        decisive_equal_timestamp_group_count: 0,
        source_order_resolution: None,
    }
}

/// Produce the typed downstream refusal when the selected B05 dependency did
/// not execute. This keeps an upstream scientific refusal distinguishable
/// from an executable Schoedel run that legitimately yields zero episodes.
pub fn schoedel_b05_dependency_refusal(
    b05_applicability: &B05ApplicabilityReceiptV1,
) -> SchoedelReconstructionOutput {
    let reason = b05_applicability
        .refusal_reason
        .map(B05RefusalReason::canonical_id)
        .unwrap_or("b05_not_executable");
    refused_schoedel(
        sha256_wire(&[]),
        vec![b05_applicability.requested_strategy_id],
        false,
        0,
        None,
        SchoedelRefusalReason::InvalidScreenIntervalDependency,
        format!("b05_dependency_refused:{reason}"),
    )
}

/// Independently implement the simplified published prose over immutable B05
/// intervals.  Project-owned singleton, tie, and censor completion rules are
/// explicit in every output row and never attributed to the source method.
pub fn reconstruct_schoedel_prose(input: SchoedelProseInput<'_>) -> SchoedelReconstructionOutput {
    let selected_b05_strategy_id = input
        .screen_intervals
        .first()
        .map(|interval| interval.strategy_id)
        .unwrap_or_default();
    reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
        raw_events: input.raw_events,
        screen_intervals: input.screen_intervals,
        selected_b05_strategy_id,
        equal_timestamp_source_order_preserved: input.equal_timestamp_source_order_preserved,
        source_order_resolution: None,
    })
}

pub fn reconstruct_bound_schoedel_prose(
    input: BoundSchoedelProseInput<'_>,
) -> SchoedelReconstructionOutput {
    let mut intervals = input.screen_intervals.to_vec();
    intervals.sort_by(|left, right| {
        (
            &left.participant_id,
            left.start_ns,
            left.start_boundary_source_row,
        )
            .cmp(&(
                &right.participant_id,
                right.start_ns,
                right.start_boundary_source_row,
            ))
    });
    let b05_interval_digest = screen_interval_digest(&intervals);
    let mut b05_strategy_ids = intervals
        .iter()
        .map(|interval| interval.strategy_id)
        .collect::<Vec<_>>();
    b05_strategy_ids.push(input.selected_b05_strategy_id);
    b05_strategy_ids.sort_by_key(|strategy| strategy.canonical_id());
    b05_strategy_ids.dedup();

    if intervals
        .iter()
        .any(|interval| interval.strategy_id != input.selected_b05_strategy_id)
    {
        return refused_schoedel(
            b05_interval_digest,
            b05_strategy_ids,
            input.equal_timestamp_source_order_preserved,
            0,
            input.source_order_resolution.cloned(),
            SchoedelRefusalReason::InvalidScreenIntervalDependency,
            "screen_interval_strategy_mismatch".into(),
        );
    }

    if let Some(detail) = invalid_screen_dependency(&intervals) {
        return refused_schoedel(
            b05_interval_digest,
            b05_strategy_ids,
            input.equal_timestamp_source_order_preserved,
            0,
            input.source_order_resolution.cloned(),
            SchoedelRefusalReason::InvalidScreenIntervalDependency,
            detail,
        );
    }
    if let Some(row) = input.raw_events.iter().find(|row| {
        row.timestamp_ns.is_none()
            && (row.app_opener_eligible
                || row
                    .package_name
                    .as_ref()
                    .is_some_and(|package| !package.is_empty()))
    }) {
        return refused_schoedel(
            b05_interval_digest,
            b05_strategy_ids,
            input.equal_timestamp_source_order_preserved,
            0,
            input.source_order_resolution.cloned(),
            SchoedelRefusalReason::UnorderableAppRow,
            format!("source_data_row={}", row.source_data_row),
        );
    }
    if input
        .source_order_resolution
        .is_some_and(|resolution| !resolution.evidence_bound_to_input)
    {
        return refused_schoedel(
            b05_interval_digest,
            b05_strategy_ids,
            false,
            0,
            input.source_order_resolution.cloned(),
            SchoedelRefusalReason::CapabilityEvidenceNotBoundToInput,
            "supplied capability evidence has no claim bound to the raw input digest".into(),
        );
    }
    let decisive_equal_timestamp_groups =
        schoedel_decisive_equal_timestamp_groups(input.raw_events, &intervals);
    let decisive_equal_timestamp_group_count = decisive_equal_timestamp_groups.len() as u64;
    let all_decisive_ties_supported = input.equal_timestamp_source_order_preserved
        || decisive_equal_timestamp_groups
            .iter()
            .all(|(participant, _, _)| {
                input.source_order_resolution.is_some_and(|resolution| {
                    resolution.participant_decisions.iter().any(|decision| {
                        decision.participant_id == *participant
                            && decision.decision.effective_state == CapabilityState::Capable
                    })
                })
            });
    let equal_timestamp_source_order_preserved = input.equal_timestamp_source_order_preserved
        || input.source_order_resolution.is_some_and(|resolution| {
            !resolution.participant_decisions.is_empty()
                && resolution.participant_decisions.iter().all(|participant| {
                    participant.decision.effective_state == CapabilityState::Capable
                })
        });
    if decisive_equal_timestamp_group_count > 0 && !all_decisive_ties_supported {
        return refused_schoedel(
            b05_interval_digest,
            b05_strategy_ids,
            false,
            decisive_equal_timestamp_group_count,
            input.source_order_resolution.cloned(),
            SchoedelRefusalReason::AmbiguousEqualTimestamp,
            "a boundary- or package-consequential timestamp tie lacks stable source order".into(),
        );
    }

    let applicability = SchoedelApplicabilityReceiptV1 {
        protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
        requested_strategy_id: SCHOEDEL_PROSE_STRATEGY_ID.into(),
        effective_strategy_id: SCHOEDEL_PROSE_STRATEGY_ID.into(),
        relation: ScientificRelation::ControlledDerivative,
        executable: true,
        refusal_reason: None,
        refusal_detail: None,
        b05_interval_digest,
        b05_strategy_ids,
        equal_timestamp_source_order_preserved,
        decisive_equal_timestamp_group_count,
        source_order_resolution: input.source_order_resolution.cloned(),
    };

    let mut event_partitions = BTreeMap::<String, Vec<&RawB05Event>>::new();
    for event in input.raw_events {
        if event.timestamp_ns.is_some() {
            event_partitions
                .entry(event.participant_id.clone())
                .or_default()
                .push(event);
        }
    }
    for rows in event_partitions.values_mut() {
        rows.sort_by_key(|row| (row.timestamp_ns.expect("filtered"), row.source_data_row));
    }

    let mut episodes = Vec::new();
    let mut issues = Vec::new();
    for interval in &intervals {
        let rows = event_partitions
            .get(&interval.participant_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let members = rows
            .iter()
            .copied()
            .filter(|row| row_is_inside_interval(row, interval))
            .collect::<Vec<_>>();
        let before = episodes.len();
        reconstruct_schoedel_interval(interval, &members, &mut episodes, &mut issues);
        if episodes.len() == before {
            issues.push(SchoedelIssue {
                participant_id: interval.participant_id.clone(),
                screen_interval_id: interval.screen_interval_id.clone(),
                source_data_row: None,
                code: SchoedelIssueCode::ScreenIntervalWithoutAppLaunch,
            });
        }
    }
    episodes.sort_by(|left, right| {
        (&left.participant_id, left.start_ns, left.start_source_row).cmp(&(
            &right.participant_id,
            right.start_ns,
            right.start_source_row,
        ))
    });
    issues.sort_by(|left, right| {
        (
            &left.participant_id,
            &left.screen_interval_id,
            left.source_data_row,
            left.code,
        )
            .cmp(&(
                &right.participant_id,
                &right.screen_interval_id,
                right.source_data_row,
                right.code,
            ))
    });
    let mut issue_counts = BTreeMap::new();
    for issue in &issues {
        *issue_counts
            .entry(issue.code.canonical_id().to_owned())
            .or_insert(0) += 1;
    }
    let reconstruction_receipt = SchoedelReconstructionReceiptV1 {
        protocol_version: SCHOEDEL_RECONSTRUCTION_RECEIPT_PROTOCOL_VERSION.into(),
        strategy_id: SCHOEDEL_PROSE_STRATEGY_ID.into(),
        relation: ScientificRelation::ControlledDerivative,
        source_identity: SCHOEDEL_PROSE_SOURCE_IDENTITY.into(),
        source_version: SCHOEDEL_PROSE_SOURCE_VERSION.into(),
        source_license_status: SCHOEDEL_PROSE_SOURCE_LICENSE_STATUS.into(),
        source_scope_id: SCHOEDEL_PROSE_SOURCE_SCOPE_ID.into(),
        adapter_id: SCHOEDEL_PROSE_ADAPTER_ID.into(),
        completion_rule_ids: SCHOEDEL_PROSE_COMPLETION_RULE_IDS
            .iter()
            .map(|rule| (*rule).to_owned())
            .collect(),
        input_screen_interval_count: intervals.len() as u64,
        input_event_count: input.raw_events.len() as u64,
        episode_count: episodes.len() as u64,
        bounded_episode_count: episodes
            .iter()
            .filter(|episode| episode.raw_duration_ns.is_some())
            .count() as u64,
        singleton_zero_length_count: episodes
            .iter()
            .filter(|episode| episode.completion == SchoedelCompletion::SingletonZeroLength)
            .count() as u64,
        right_censored_evidence_count: episodes
            .iter()
            .filter(|episode| episode.completion == SchoedelCompletion::RightCensoredScreenInterval)
            .count() as u64,
        issue_counts,
        episode_digest: schoedel_episode_digest(&episodes),
    };
    SchoedelReconstructionOutput {
        episodes,
        applicability,
        reconstruction_receipt: Some(reconstruction_receipt),
        issues,
    }
}

/// Validate a completed Schoedel reconstruction against the already validated
/// B05 screen dependency and the trusted size of the exact retained event
/// stream supplied to reconstruction.  The trusted count must come from the
/// producer seam, never from `reconstruction_receipt.input_event_count`.
pub fn validate_schoedel_reconstruction_output(
    output: &SchoedelReconstructionOutput,
    validated_screen: &ScreenConstructionOutput,
    selected_b05_strategy: ScreenSessionConstructionStrategyId,
    trusted_retained_input_event_count: u64,
) -> Result<(), &'static str> {
    let screen_receipt = validated_screen
        .construction_receipt
        .as_ref()
        .ok_or("schoedel_validation_error:screen_receipt_missing")?;
    if !validated_screen.applicability.executable
        || validated_screen.applicability.requested_strategy_id != selected_b05_strategy
        || validated_screen.applicability.effective_strategy_id != selected_b05_strategy
        || screen_receipt.strategy_id != selected_b05_strategy
    {
        return Err("schoedel_validation_error:screen_dependency_mismatch");
    }
    let applicability = &output.applicability;
    if applicability.protocol_version != B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION
        || applicability.requested_strategy_id != SCHOEDEL_PROSE_STRATEGY_ID
        || applicability.effective_strategy_id != SCHOEDEL_PROSE_STRATEGY_ID
        || applicability.relation != ScientificRelation::ControlledDerivative
        || !applicability.executable
        || applicability.refusal_reason.is_some()
        || applicability.refusal_detail.is_some()
        || applicability.b05_interval_digest != screen_receipt.interval_digest
        || applicability.b05_strategy_ids != vec![selected_b05_strategy]
    {
        return Err("schoedel_validation_error:applicability_mismatch");
    }

    if let Some(resolution) = applicability.source_order_resolution.as_ref() {
        if resolution.protocol_version != B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION
            || resolution.raw_input_sha256 != validated_screen.applicability.input_digest
            || !resolution.evidence_bound_to_input
            || resolution
                .participant_decisions
                .windows(2)
                .any(|pair| pair[0].participant_id >= pair[1].participant_id)
            || resolution
                .participant_decisions
                .iter()
                .any(|participant| participant.participant_id.is_empty())
            || resolution.resolution_digest != schoedel_source_order_resolution_digest(resolution)
        {
            return Err("schoedel_validation_error:source_order_resolution_mismatch");
        }
        let has_asserted_claim = resolution
            .participant_decisions
            .iter()
            .any(|participant| participant.decision.asserted_state.is_some());
        match (
            resolution.evidence_artifact_digest.as_deref(),
            resolution.evidence_assignment_digest.as_deref(),
        ) {
            (Some(artifact), Some(assignment))
                if is_sha256_wire(artifact)
                    && assignment == capability_evidence_assignment_digest(artifact) => {}
            (None, None) if !has_asserted_claim => {}
            _ => return Err("schoedel_validation_error:source_order_evidence_identity_mismatch"),
        }
        for participant in &resolution.participant_decisions {
            let decision = &participant.decision;
            if decision.capability_id != CapabilityId::EqualTimestampSourceOrderPreserved {
                return Err("schoedel_validation_error:source_order_capability_mismatch");
            }
            let has_claim = decision.asserted_state.is_some();
            let coherent = match decision.asserted_state {
                Some(asserted) => {
                    decision.effective_state == asserted
                        && decision.evidence_scope != EvidenceScope::None
                        && decision.evidence_origin == CapabilityEvidenceOrigin::ManifestAssertion
                        && decision.claim_physical_data_row.is_some_and(|row| row >= 2)
                        && match asserted {
                            CapabilityState::Capable | CapabilityState::Absent => {
                                decision
                                    .evidence_basis
                                    .is_some_and(|basis| basis != EvidenceBasis::Unspecified)
                                    && decision
                                        .evidence_reference
                                        .as_deref()
                                        .is_some_and(|reference| !reference.is_empty())
                                    && decision
                                        .evidence_sha256
                                        .as_deref()
                                        .is_none_or(is_sha256_wire)
                            }
                            CapabilityState::Unknown => {
                                decision.evidence_basis == Some(EvidenceBasis::Unspecified)
                                    && decision.evidence_reference.as_deref() == Some("")
                                    && decision.evidence_sha256.is_none()
                            }
                        }
                }
                None => {
                    decision.effective_state == CapabilityState::Unknown
                        && decision.evidence_scope == EvidenceScope::None
                        && decision.evidence_origin == CapabilityEvidenceOrigin::None
                        && decision.evidence_basis.is_none()
                        && decision.evidence_reference.is_none()
                        && decision.evidence_sha256.is_none()
                        && decision.claim_physical_data_row.is_none()
                }
            };
            let expected_observation = match decision.effective_state {
                CapabilityState::Capable => ObservationDisposition::CapableNoRow,
                CapabilityState::Absent => ObservationDisposition::Absent,
                CapabilityState::Unknown => ObservationDisposition::Unknown,
            };
            if !coherent
                || has_claim != decision.claim_physical_data_row.is_some()
                || decision.observed_standalone_row_count != 0
                || decision.observation_disposition != expected_observation
            {
                return Err("schoedel_validation_error:source_order_decision_incoherent");
            }
        }
    }
    let resolution_all_capable =
        applicability
            .source_order_resolution
            .as_ref()
            .is_some_and(|resolution| {
                !resolution.participant_decisions.is_empty()
                    && resolution.participant_decisions.iter().all(|participant| {
                        participant.decision.effective_state == CapabilityState::Capable
                    })
            });
    if applicability.equal_timestamp_source_order_preserved != resolution_all_capable
        || (applicability.decisive_equal_timestamp_group_count > 0
            && (!applicability.equal_timestamp_source_order_preserved
                || applicability
                    .source_order_resolution
                    .as_ref()
                    .is_none_or(|resolution| {
                        resolution.participant_decisions.is_empty()
                            || !resolution.participant_decisions.iter().all(|participant| {
                                participant.decision.effective_state == CapabilityState::Capable
                            })
                    })))
    {
        return Err("schoedel_validation_error:source_order_applicability_mismatch");
    }

    if output.episodes.windows(2).any(|pair| {
        (
            &pair[0].participant_id,
            pair[0].start_ns,
            pair[0].start_source_row,
        ) >= (
            &pair[1].participant_id,
            pair[1].start_ns,
            pair[1].start_source_row,
        )
    }) {
        return Err("schoedel_validation_error:episode_order_mismatch");
    }
    let intervals = validated_screen
        .intervals
        .iter()
        .map(|interval| (interval.screen_interval_id.as_str(), interval))
        .collect::<BTreeMap<_, _>>();
    let mut episode_ids = BTreeSet::new();
    for episode in &output.episodes {
        let interval = intervals
            .get(episode.screen_interval_id.as_str())
            .ok_or("schoedel_validation_error:episode_interval_missing")?;
        let after_start = episode.start_ns > interval.start_ns
            || (episode.start_ns == interval.start_ns
                && episode.start_source_row > interval.start_boundary_source_row);
        let before_end = match (interval.stop_ns, interval.stop_boundary_source_row) {
            (Some(stop), Some(row)) => {
                episode.start_ns < stop
                    || (episode.start_ns == stop && episode.start_source_row < row)
            }
            (None, None) => true,
            _ => false,
        };
        let source_rows_canonical = !episode.source_rows.is_empty()
            && episode.source_rows.windows(2).all(|pair| pair[0] < pair[1])
            && episode
                .source_rows
                .iter()
                .all(|row| *row > 0 && u64::from(*row) <= screen_receipt.input_row_count)
            && episode.source_rows.contains(&episode.start_source_row)
            && episode
                .stop_source_row
                .is_none_or(|row| episode.source_rows.contains(&row));
        let completion_shape = match episode.completion {
            SchoedelCompletion::RightCensoredScreenInterval => {
                interval.right_censored
                    && episode.stop_ns.is_none()
                    && episode.stop_source_row.is_none()
                    && episode.raw_duration_ns.is_none()
                    && !episode.bounded_headline_candidate
            }
            SchoedelCompletion::SingletonZeroLength => {
                episode.stop_ns == Some(episode.start_ns)
                    && episode.stop_source_row == Some(episode.start_source_row)
                    && episode.raw_duration_ns == Some(0)
                    && episode.bounded_headline_candidate
            }
            SchoedelCompletion::LastPackageEventBeforeDifferentApp
            | SchoedelCompletion::LastPackageEventBeforeScreenEnd => {
                episode.stop_ns.is_some()
                    && episode.stop_source_row.is_some()
                    && episode.raw_duration_ns.is_some()
                    && episode.bounded_headline_candidate
                    && episode
                        .stop_ns
                        .and_then(|stop| stop.checked_sub(episode.start_ns))
                        == episode.raw_duration_ns
                    && episode
                        .raw_duration_ns
                        .is_some_and(|duration| duration >= 0)
            }
        };
        if episode.participant_id.is_empty()
            || episode.package_name.is_empty()
            || episode.participant_id != interval.participant_id
            || episode.b05_strategy_id != selected_b05_strategy
            || !after_start
            || !before_end
            || !source_rows_canonical
            || !completion_shape
            || episode.episode_id != schoedel_episode_id(episode)
            || !episode_ids.insert(episode.episode_id.as_str())
        {
            return Err("schoedel_validation_error:episode_identity_mismatch");
        }
    }

    if output.issues.windows(2).any(|pair| {
        (
            &pair[0].participant_id,
            &pair[0].screen_interval_id,
            pair[0].source_data_row,
            pair[0].code,
        ) >= (
            &pair[1].participant_id,
            &pair[1].screen_interval_id,
            pair[1].source_data_row,
            pair[1].code,
        )
    }) {
        return Err("schoedel_validation_error:issue_order_mismatch");
    }
    let mut issue_counts = BTreeMap::new();
    for issue in &output.issues {
        let interval = intervals
            .get(issue.screen_interval_id.as_str())
            .ok_or("schoedel_validation_error:issue_interval_missing")?;
        if issue.participant_id != interval.participant_id
            || (issue.code == SchoedelIssueCode::TypeOneMissingPackage)
                != issue.source_data_row.is_some()
            || issue
                .source_data_row
                .is_some_and(|row| row == 0 || u64::from(row) > screen_receipt.input_row_count)
        {
            return Err("schoedel_validation_error:issue_identity_mismatch");
        }
        *issue_counts
            .entry(issue.code.canonical_id().to_owned())
            .or_insert(0_u64) += 1;
    }

    let receipt = output
        .reconstruction_receipt
        .as_ref()
        .ok_or("schoedel_validation_error:reconstruction_receipt_missing")?;
    let bounded_count = output
        .episodes
        .iter()
        .filter(|episode| episode.raw_duration_ns.is_some())
        .count() as u64;
    let singleton_count = output
        .episodes
        .iter()
        .filter(|episode| episode.completion == SchoedelCompletion::SingletonZeroLength)
        .count() as u64;
    let right_censored_count = output
        .episodes
        .iter()
        .filter(|episode| episode.completion == SchoedelCompletion::RightCensoredScreenInterval)
        .count() as u64;
    if receipt.protocol_version != SCHOEDEL_RECONSTRUCTION_RECEIPT_PROTOCOL_VERSION
        || receipt.strategy_id != SCHOEDEL_PROSE_STRATEGY_ID
        || receipt.relation != ScientificRelation::ControlledDerivative
        || receipt.source_identity != SCHOEDEL_PROSE_SOURCE_IDENTITY
        || receipt.source_version != SCHOEDEL_PROSE_SOURCE_VERSION
        || receipt.source_license_status != SCHOEDEL_PROSE_SOURCE_LICENSE_STATUS
        || receipt.source_scope_id != SCHOEDEL_PROSE_SOURCE_SCOPE_ID
        || receipt.adapter_id != SCHOEDEL_PROSE_ADAPTER_ID
        || receipt.completion_rule_ids
            != SCHOEDEL_PROSE_COMPLETION_RULE_IDS
                .iter()
                .map(|rule| (*rule).to_owned())
                .collect::<Vec<_>>()
        || receipt.input_screen_interval_count != validated_screen.intervals.len() as u64
        || receipt.input_event_count != trusted_retained_input_event_count
        || receipt.episode_count != output.episodes.len() as u64
        || receipt.bounded_episode_count != bounded_count
        || receipt.singleton_zero_length_count != singleton_count
        || receipt.right_censored_evidence_count != right_censored_count
        || receipt.issue_counts != issue_counts
        || receipt.episode_digest != schoedel_episode_digest(&output.episodes)
    {
        return Err("schoedel_validation_error:receipt_mismatch");
    }
    Ok(())
}

fn refused_schoedel(
    b05_interval_digest: String,
    b05_strategy_ids: Vec<ScreenSessionConstructionStrategyId>,
    equal_timestamp_source_order_preserved: bool,
    decisive_equal_timestamp_group_count: u64,
    source_order_resolution: Option<SchoedelSourceOrderResolution>,
    reason: SchoedelRefusalReason,
    detail: String,
) -> SchoedelReconstructionOutput {
    SchoedelReconstructionOutput {
        episodes: Vec::new(),
        applicability: SchoedelApplicabilityReceiptV1 {
            protocol_version: B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION.into(),
            requested_strategy_id: SCHOEDEL_PROSE_STRATEGY_ID.into(),
            effective_strategy_id: SCHOEDEL_PROSE_STRATEGY_ID.into(),
            relation: ScientificRelation::Refused,
            executable: false,
            refusal_reason: Some(reason),
            refusal_detail: Some(detail),
            b05_interval_digest,
            b05_strategy_ids,
            equal_timestamp_source_order_preserved,
            decisive_equal_timestamp_group_count,
            source_order_resolution,
        },
        reconstruction_receipt: None,
        issues: Vec::new(),
    }
}

fn invalid_screen_dependency(intervals: &[ScreenIntervalEvidence]) -> Option<String> {
    for interval in intervals {
        if interval.screen_interval_id.is_empty()
            || interval.stop_ns.is_some() != interval.stop_boundary_source_row.is_some()
            || interval.right_censored != interval.stop_ns.is_none()
            || interval
                .stop_ns
                .is_some_and(|stop| stop < interval.start_ns)
        {
            return Some(format!(
                "screen_interval_id={}",
                interval.screen_interval_id
            ));
        }
    }
    for pair in intervals.windows(2) {
        if pair[0].participant_id == pair[1].participant_id {
            let left_end = pair[0].stop_ns.unwrap_or(i64::MAX);
            if pair[1].start_ns < left_end
                || (pair[1].start_ns == left_end
                    && pair[0]
                        .stop_boundary_source_row
                        .is_some_and(|left_row| pair[1].start_boundary_source_row < left_row))
            {
                return Some(format!(
                    "overlapping_screen_intervals={},{}",
                    pair[0].screen_interval_id, pair[1].screen_interval_id
                ));
            }
        }
    }
    None
}

fn row_is_inside_interval(row: &RawB05Event, interval: &ScreenIntervalEvidence) -> bool {
    if row.participant_id != interval.participant_id {
        return false;
    }
    let timestamp = row
        .timestamp_ns
        .expect("only ordered rows are passed to membership");
    let after_start = timestamp > interval.start_ns
        || (timestamp == interval.start_ns
            && row.source_data_row > interval.start_boundary_source_row);
    let before_end = match (interval.stop_ns, interval.stop_boundary_source_row) {
        (Some(stop_ns), Some(stop_row)) => {
            timestamp < stop_ns || (timestamp == stop_ns && row.source_data_row < stop_row)
        }
        (None, None) => true,
        _ => false,
    };
    after_start && before_end
}

#[derive(Debug)]
struct OpenSchoedelEpisode<'a> {
    opener: &'a RawB05Event,
    package_name: String,
    associated_rows: Vec<&'a RawB05Event>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchoedelBoundary {
    DifferentApp,
    ScreenEnd,
    RightCensored,
}

fn reconstruct_schoedel_interval(
    interval: &ScreenIntervalEvidence,
    rows: &[&RawB05Event],
    episodes: &mut Vec<SchoedelEpisodeEvidence>,
    issues: &mut Vec<SchoedelIssue>,
) {
    let mut open: Option<OpenSchoedelEpisode<'_>> = None;
    for row in rows.iter().copied() {
        if row.app_opener_eligible {
            let package = row
                .package_name
                .as_deref()
                .filter(|package| !package.is_empty());
            let Some(package) = package else {
                issues.push(SchoedelIssue {
                    participant_id: interval.participant_id.clone(),
                    screen_interval_id: interval.screen_interval_id.clone(),
                    source_data_row: Some(row.source_data_row),
                    code: SchoedelIssueCode::TypeOneMissingPackage,
                });
                continue;
            };
            if open
                .as_ref()
                .is_some_and(|current| current.package_name != package)
            {
                let completed = open.take().expect("different package checked");
                episodes.push(complete_schoedel_episode(
                    interval,
                    completed,
                    SchoedelBoundary::DifferentApp,
                ));
            }
            if open.is_none() {
                open = Some(OpenSchoedelEpisode {
                    opener: row,
                    package_name: package.to_owned(),
                    associated_rows: vec![row],
                });
            } else if let Some(current) = open.as_mut() {
                current.associated_rows.push(row);
            }
            continue;
        }
        if let Some(current) = open.as_mut() {
            if row.package_name.as_deref() == Some(current.package_name.as_str()) {
                current.associated_rows.push(row);
            }
        }
    }
    if let Some(open) = open {
        episodes.push(complete_schoedel_episode(
            interval,
            open,
            if interval.right_censored {
                SchoedelBoundary::RightCensored
            } else {
                SchoedelBoundary::ScreenEnd
            },
        ));
    }
}

fn complete_schoedel_episode(
    interval: &ScreenIntervalEvidence,
    mut open: OpenSchoedelEpisode<'_>,
    boundary: SchoedelBoundary,
) -> SchoedelEpisodeEvidence {
    open.associated_rows.sort_by_key(|row| {
        (
            row.timestamp_ns.expect("ordered app evidence"),
            row.source_data_row,
        )
    });
    open.associated_rows.dedup_by_key(|row| row.source_data_row);
    let mut source_rows = open
        .associated_rows
        .iter()
        .flat_map(|row| row.source_data_rows.iter().copied())
        .collect::<Vec<_>>();
    source_rows.sort_unstable();
    source_rows.dedup();
    let start_ns = open
        .opener
        .timestamp_ns
        .expect("an opener has an ordered timestamp");
    let (stop_ns, stop_source_row, raw_duration_ns, completion, bounded) = match boundary {
        SchoedelBoundary::RightCensored => (
            None,
            None,
            None,
            SchoedelCompletion::RightCensoredScreenInterval,
            false,
        ),
        SchoedelBoundary::DifferentApp | SchoedelBoundary::ScreenEnd => {
            let last = open
                .associated_rows
                .last()
                .expect("the opener is always associated");
            let stop_ns = last.timestamp_ns.expect("ordered app evidence");
            let completion = if open.associated_rows.len() == 1 {
                SchoedelCompletion::SingletonZeroLength
            } else if boundary == SchoedelBoundary::DifferentApp {
                SchoedelCompletion::LastPackageEventBeforeDifferentApp
            } else {
                SchoedelCompletion::LastPackageEventBeforeScreenEnd
            };
            (
                Some(stop_ns),
                Some(last.source_data_row),
                Some(stop_ns - start_ns),
                completion,
                true,
            )
        }
    };
    let mut episode = SchoedelEpisodeEvidence {
        episode_id: String::new(),
        participant_id: interval.participant_id.clone(),
        package_name: open.package_name,
        screen_interval_id: interval.screen_interval_id.clone(),
        b05_strategy_id: interval.strategy_id,
        start_ns,
        stop_ns,
        raw_duration_ns,
        start_source_row: open.opener.source_data_row,
        stop_source_row,
        source_rows,
        completion,
        bounded_headline_candidate: bounded,
    };
    episode.episode_id = schoedel_episode_id(&episode);
    episode
}

fn schoedel_decisive_equal_timestamp_groups(
    events: &[RawB05Event],
    intervals: &[ScreenIntervalEvidence],
) -> BTreeSet<(String, String, i64)> {
    let mut decisive = BTreeSet::<(String, String, i64)>::new();
    // One owned participant-scoped copy per run of same-participant intervals,
    // not per interval: every counterfactual restores what it swapped, so the
    // copy is unchanged between intervals, and cloning the participant's whole
    // stream once per interval was quadratic in allocations.
    // ponytail: each signature still scans the participant's stream, so the
    // probe stays intervals x events in comparisons; a partition_point range
    // over the sorted events is the upgrade if Schoedel meets very large files.
    let mut participant_events = Vec::<RawB05Event>::new();
    let mut copied_participant: Option<&str> = None;
    for interval in intervals {
        // Every counterfactual
        // below swaps `source_data_row` values in place and restores them, so
        // no per-candidate deep clone of the event stream remains. Signatures
        // are computed over participant-filtered views only, and only
        // participant-owned rows are ever mutated, so each counterfactual view
        // is byte-equivalent to the one the exhaustive form produced. Pinned by
        // optimized_decisiveness_probe_matches_the_exhaustive_probe.
        if copied_participant != Some(interval.participant_id.as_str()) {
            participant_events = events
                .iter()
                .filter(|event| event.participant_id == interval.participant_id)
                .cloned()
                .collect();
            copied_participant = Some(interval.participant_id.as_str());
        }
        let baseline = {
            let view = participant_events.iter().collect::<Vec<_>>();
            schoedel_interval_signature(interval, &view)
        };
        let mut boundaries = vec![(interval.start_ns, interval.start_boundary_source_row, true)];
        if let (Some(stop_ns), Some(stop_row)) =
            (interval.stop_ns, interval.stop_boundary_source_row)
        {
            boundaries.push((stop_ns, stop_row, false));
        }
        for (timestamp, boundary_source_row, is_start) in boundaries {
            let boundary_index = participant_events.iter().position(|candidate| {
                candidate.timestamp_ns == Some(timestamp)
                    && candidate.source_data_row == boundary_source_row
            });
            let candidate_indices = participant_events
                .iter()
                .enumerate()
                .filter(|(_, event)| {
                    event.timestamp_ns == Some(timestamp)
                        && event.source_data_row != boundary_source_row
                        && is_schoedel_app_evidence_candidate(event)
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            let boundary_is_decisive = candidate_indices.into_iter().any(|candidate_index| {
                let candidate_source_row = participant_events[candidate_index].source_data_row;
                if let Some(boundary_index) = boundary_index {
                    participant_events[boundary_index].source_data_row = candidate_source_row;
                }
                participant_events[candidate_index].source_data_row = boundary_source_row;
                let mut counterfactual_interval = interval.clone();
                if is_start {
                    counterfactual_interval.start_boundary_source_row = candidate_source_row;
                } else {
                    counterfactual_interval.stop_boundary_source_row = Some(candidate_source_row);
                }
                let changed = {
                    let view = participant_events.iter().collect::<Vec<_>>();
                    schoedel_interval_signature(&counterfactual_interval, &view) != baseline
                };
                participant_events[candidate_index].source_data_row = candidate_source_row;
                if let Some(boundary_index) = boundary_index {
                    participant_events[boundary_index].source_data_row = boundary_source_row;
                }
                changed
            });
            if boundary_is_decisive {
                decisive.insert((
                    interval.participant_id.clone(),
                    interval.screen_interval_id.clone(),
                    timestamp,
                ));
            }
        }

        let mut groups = BTreeMap::<i64, Vec<usize>>::new();
        for (index, event) in participant_events.iter().enumerate() {
            if let Some(timestamp_ns) = event.timestamp_ns {
                if is_schoedel_app_evidence_candidate(event)
                    && row_is_inside_interval(event, interval)
                {
                    groups.entry(timestamp_ns).or_default().push(index);
                }
            }
        }
        for (timestamp, positions) in groups {
            if positions.len() < 2 {
                continue;
            }
            if positions.windows(2).any(|pair| {
                let left_source_row = participant_events[pair[0]].source_data_row;
                let right_source_row = participant_events[pair[1]].source_data_row;
                participant_events[pair[0]].source_data_row = right_source_row;
                participant_events[pair[1]].source_data_row = left_source_row;
                let changed = {
                    let view = participant_events.iter().collect::<Vec<_>>();
                    schoedel_interval_signature(interval, &view) != baseline
                };
                participant_events[pair[0]].source_data_row = left_source_row;
                participant_events[pair[1]].source_data_row = right_source_row;
                changed
            }) {
                decisive.insert((
                    interval.participant_id.clone(),
                    interval.screen_interval_id.clone(),
                    timestamp,
                ));
            }
        }
    }
    decisive
}

/// Participant scope whose equal-time ordering can change a Schoedel episode
/// or boundary. Capability resolution must be limited to this exact scope so
/// an executable receipt cannot hide one unresolved consequential participant
/// among unrelated capable participants.
pub fn schoedel_decisive_equal_timestamp_participants(
    events: &[RawB05Event],
    intervals: &[ScreenIntervalEvidence],
) -> BTreeSet<String> {
    schoedel_decisive_equal_timestamp_groups(events, intervals)
        .into_iter()
        .map(|(participant_id, _, _)| participant_id)
        .collect()
}

type SchoedelIntervalSignature = (Vec<SchoedelEpisodeEvidence>, Vec<SchoedelIssue>);

fn schoedel_interval_signature(
    interval: &ScreenIntervalEvidence,
    participant_events: &[&RawB05Event],
) -> SchoedelIntervalSignature {
    let mut members = participant_events
        .iter()
        .copied()
        .filter(|event| event.timestamp_ns.is_some() && row_is_inside_interval(event, interval))
        .collect::<Vec<_>>();
    members.sort_by_key(|event| (event.timestamp_ns.expect("filtered"), event.source_data_row));
    let mut episodes = Vec::new();
    let mut issues = Vec::new();
    reconstruct_schoedel_interval(interval, &members, &mut episodes, &mut issues);
    (episodes, issues)
}

fn is_schoedel_app_evidence_candidate(event: &RawB05Event) -> bool {
    event.app_opener_eligible
        || (event
            .package_name
            .as_ref()
            .is_some_and(|package| !package.is_empty())
            && !matches!(
                event.signal,
                AndroidUsageSignal::ScreenInteractive
                    | AndroidUsageSignal::ScreenNonInteractive
                    | AndroidUsageSignal::KeyguardShown
                    | AndroidUsageSignal::KeyguardHidden
                    | AndroidUsageSignal::DeviceShutdown
                    | AndroidUsageSignal::DeviceStartup
                    | AndroidUsageSignal::CombinedScreenInteractiveKeyguardShown
                    | AndroidUsageSignal::CombinedScreenNonInteractiveKeyguardHidden
            ))
}

fn schoedel_episode_digest(episodes: &[SchoedelEpisodeEvidence]) -> String {
    let mut material = Vec::new();
    for episode in episodes {
        digest_field(&mut material, &episode.episode_id);
        digest_field(&mut material, &episode.participant_id);
        digest_field(&mut material, &episode.package_name);
        digest_field(&mut material, &episode.screen_interval_id);
        digest_field(&mut material, episode.b05_strategy_id.canonical_id());
        digest_field(&mut material, &episode.start_ns.to_string());
        digest_field(
            &mut material,
            &episode
                .stop_ns
                .map(|value| value.to_string())
                .unwrap_or_default(),
        );
        digest_field(&mut material, episode.completion.canonical_id());
        for row in &episode.source_rows {
            digest_field(&mut material, &row.to_string());
        }
    }
    sha256_wire(&material)
}

fn schoedel_episode_id(episode: &SchoedelEpisodeEvidence) -> String {
    let mut identity = Vec::new();
    digest_field(&mut identity, B05_FOUNDATIONAL_SEMANTICS_PROTOCOL_VERSION);
    digest_field(&mut identity, SCHOEDEL_PROSE_STRATEGY_ID);
    digest_field(&mut identity, &episode.screen_interval_id);
    digest_field(&mut identity, &episode.package_name);
    digest_field(&mut identity, &episode.start_source_row.to_string());
    digest_field(
        &mut identity,
        &episode
            .stop_source_row
            .map(|row| row.to_string())
            .unwrap_or_default(),
    );
    digest_field(&mut identity, &episode.start_ns.to_string());
    digest_field(
        &mut identity,
        &episode
            .stop_ns
            .map(|value| value.to_string())
            .unwrap_or_default(),
    );
    digest_field(
        &mut identity,
        &episode
            .raw_duration_ns
            .map(|value| value.to_string())
            .unwrap_or_default(),
    );
    for source_row in &episode.source_rows {
        digest_field(&mut identity, &source_row.to_string());
    }
    digest_field(&mut identity, episode.completion.canonical_id());
    digest_field(
        &mut identity,
        if episode.bounded_headline_candidate {
            "1"
        } else {
            "0"
        },
    );
    format!("urn:chronicle:app-episode:{}", sha256_wire(&identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        participant: &str,
        timestamp: i64,
        source_row: u32,
        label: &str,
        package: Option<&str>,
    ) -> RawB05Event {
        RawB05Event::from_raw_label(
            participant,
            Some(timestamp),
            source_row,
            label,
            package.map(str::to_owned),
        )
    }

    fn rows(events: &[RawB05Event]) -> Vec<&RawB05Event> {
        events.iter().collect()
    }

    fn capability_csv(
        raw_digest: &str,
        wildcard_states: &BTreeMap<CapabilityId, CapabilityState>,
        exact_overrides: &[(String, CapabilityId, CapabilityState)],
    ) -> Vec<u8> {
        let mut csv = CAPABILITY_HEADER.join(",");
        csv.push('\n');
        let mut push = |participant: &str, capability: CapabilityId, state: CapabilityState| {
            let (basis, reference) = if state == CapabilityState::Unknown {
                ("unspecified", "")
            } else {
                ("producer_manifest", "urn:test:producer-manifest")
            };
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},\n",
                B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
                raw_digest,
                participant,
                capability.canonical_id(),
                state.canonical_id(),
                basis,
                reference,
            ));
        };
        for capability in CapabilityId::ALL {
            push(
                "*",
                capability,
                wildcard_states
                    .get(&capability)
                    .copied()
                    .unwrap_or(CapabilityState::Capable),
            );
        }
        for (participant, capability, state) in exact_overrides {
            push(participant, *capability, *state);
        }
        csv.into_bytes()
    }

    fn parsed_all_capable(raw_digest: &str) -> ParsedCapabilityEvidence {
        parse_capability_evidence(&capability_csv(raw_digest, &BTreeMap::new(), &[]))
            .expect("valid all-capable evidence")
    }

    fn applicability_input<'a>(
        raw_digest: &'a str,
        raw_events: &'a [RawB05Event],
        evidence: Option<&'a ParsedCapabilityEvidence>,
        fragmented: &'a BTreeSet<String>,
    ) -> B05ApplicabilityInput<'a> {
        B05ApplicabilityInput {
            raw_input_sha256: raw_digest,
            raw_events,
            evidence,
            evidence_assignment_digest: evidence.map(|parsed| {
                // Leak only inside the process-lifetime test fixture so the
                // borrowed applicability input carries the exact wire value.
                Box::leak(
                    capability_evidence_assignment_digest(&parsed.evidence_artifact_digest)
                        .into_boxed_str(),
                ) as &str
            }),
            options_digest:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            selection_was_explicit: true,
            fragmented_participants: fragmented,
        }
    }

    #[test]
    fn sha256_matches_fips_vectors() {
        assert_eq!(
            sha256_wire(b""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_wire(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn raw_adapter_aliases_match_the_established_normalizer_domain() {
        for (canonical, alias, expected) in [
            (
                "Activity Resumed",
                "Unknown importance: 1",
                AndroidUsageSignal::ActivityResumed,
            ),
            (
                "Activity Resumed",
                "Move to Foreground",
                AndroidUsageSignal::ActivityResumed,
            ),
            (
                "Screen Interactive",
                "Unknown importance: 15",
                AndroidUsageSignal::ScreenInteractive,
            ),
            (
                "Screen Non-Interactive",
                "Unknown importance: 16",
                AndroidUsageSignal::ScreenNonInteractive,
            ),
            (
                "Screen Non-Interactive",
                "Screen Non-interactive",
                AndroidUsageSignal::ScreenNonInteractive,
            ),
            (
                "Keyguard Shown",
                "Unknown importance: 17",
                AndroidUsageSignal::KeyguardShown,
            ),
            (
                "Keyguard Hidden",
                "Unknown importance: 18",
                AndroidUsageSignal::KeyguardHidden,
            ),
            (
                "Device Shutdown",
                "Unknown importance: 26",
                AndroidUsageSignal::DeviceShutdown,
            ),
            (
                "Device Startup",
                "Unknown importance: 27",
                AndroidUsageSignal::DeviceStartup,
            ),
        ] {
            assert_eq!(recognize_android_usage_signal_v1(canonical), expected);
            assert_eq!(recognize_android_usage_signal_v1(alias), expected);
        }
    }

    #[test]
    fn scientific_relation_domain_is_additive_complete() {
        assert_eq!(
            ScientificRelation::ALL.map(ScientificRelation::canonical_id),
            [
                "baseline_native",
                "baseline_equivalent",
                "source_native",
                "source_equivalent",
                "source_aligned_adapter",
                "controlled_derivative",
                "partial_replay",
                "refused",
            ]
        );
    }

    #[test]
    fn direct_unlock_rules_use_the_declared_closing_boundary() {
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 10, 2, "Keyguard Hidden", None),
            event("P1", 20, 3, "Activity Resumed", Some("app.a")),
            event("P1", 30, 4, "Screen Non-Interactive", None),
            event("P1", 40, 5, "Keyguard Shown", None),
        ];
        let refs = rows(&events);

        let (lock_only, issues) = construct_direct_unlock_partition(
            ScreenSessionConstructionStrategyId::UnlockToLockV1,
            "P1",
            &refs,
        );
        assert!(issues.is_empty());
        assert_eq!(lock_only.len(), 1);
        assert_eq!(
            (lock_only[0].start_ns, lock_only[0].stop_ns),
            (10, Some(40))
        );
        assert_eq!(
            lock_only[0].close_reason,
            ScreenIntervalCloseReason::KeyguardShown
        );

        let (off_or_lock, issues) = construct_direct_unlock_partition(
            ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1,
            "P1",
            &refs,
        );
        assert!(issues.is_empty());
        assert_eq!(off_or_lock.len(), 1);
        assert_eq!(
            (off_or_lock[0].start_ns, off_or_lock[0].stop_ns),
            (10, Some(30))
        );
        assert_eq!(
            off_or_lock[0].close_reason,
            ScreenIntervalCloseReason::ScreenNonInteractive
        );
    }

    #[test]
    fn capability_csv_is_long_form_strict_and_commits_exact_bytes() {
        let raw_digest = sha256_wire(b"raw input");
        let csv = capability_csv(&raw_digest, &BTreeMap::new(), &[]);
        let parsed = parse_capability_evidence(&csv).expect("valid capability CSV");
        assert_eq!(parsed.claims.len(), CapabilityId::ALL.len());
        assert_eq!(parsed.evidence_artifact_digest, sha256_wire(&csv));
        assert!(parsed
            .claims
            .iter()
            .all(|claim| claim.participant_id == "*"));

        let mut wrong_header = csv.clone();
        wrong_header[0] = b'S';
        assert_eq!(
            parse_capability_evidence(&wrong_header)
                .expect_err("header is exact")
                .detail,
            CapabilityEvidenceErrorDetail::WrongHeader
        );

        let duplicate = [
            csv.as_slice(),
            &csv[CAPABILITY_HEADER.join(",").len() + 1..],
        ]
        .concat();
        assert_eq!(
            parse_capability_evidence(&duplicate)
                .expect_err("duplicate identity is invalid")
                .detail,
            CapabilityEvidenceErrorDetail::DuplicateClaim
        );
    }

    #[test]
    fn capability_csv_reports_record_start_line_without_raw_values() {
        let digest = sha256_wire(b"raw");
        let csv = format!(
            "{}\n{},\"{}\",*,{},unknown,unspecified,\"line one\nline two\",\n",
            CAPABILITY_HEADER.join(","),
            B05_INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
            digest,
            CapabilityId::AndroidUsageEvent15ScreenInteractive.canonical_id(),
        );
        let error = parse_capability_evidence(csv.as_bytes())
            .expect_err("unknown claims cannot have a reference");
        assert_eq!(
            error.detail,
            CapabilityEvidenceErrorDetail::InvalidConditionalEvidenceFields
        );
        assert_eq!(error.physical_data_row, Some(2));
        assert!(!error.to_string().contains("line one"));
    }

    #[test]
    fn exact_participant_claim_overrides_wildcard_and_observation_upgrades_unknown() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Screen Interactive", None)];
        let csv = capability_csv(
            &raw_digest,
            &BTreeMap::new(),
            &[(
                "P1".into(),
                CapabilityId::AndroidUsageEvent15ScreenInteractive,
                CapabilityState::Unknown,
            )],
        );
        let evidence = parse_capability_evidence(&csv).expect("valid exact override");
        let fragmented = BTreeSet::new();
        let receipt = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect("resolution succeeds");
        assert!(receipt.executable);
        let participant = &receipt.participant_decisions[0];
        assert_eq!(participant.evidence_scope, EvidenceScope::Exact);
        let decision = decision(
            &participant.capability_decisions,
            CapabilityId::AndroidUsageEvent15ScreenInteractive,
        );
        assert_eq!(decision.evidence_scope, EvidenceScope::Exact);
        assert_eq!(decision.asserted_state, Some(CapabilityState::Unknown));
        assert_eq!(decision.effective_state, CapabilityState::Capable);
        assert_eq!(
            decision.evidence_origin,
            CapabilityEvidenceOrigin::ObservedInBoundInput
        );
        assert_eq!(
            decision.observation_disposition,
            ObservationDisposition::Observed
        );
    }

    #[test]
    fn observed_absent_contradiction_is_a_phi_safe_validation_error() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Screen Interactive", None)];
        let mut states = BTreeMap::new();
        states.insert(
            CapabilityId::AndroidUsageEvent15ScreenInteractive,
            CapabilityState::Absent,
        );
        let evidence = parse_capability_evidence(&capability_csv(&raw_digest, &states, &[]))
            .expect("structurally valid assertion");
        let fragmented = BTreeSet::new();
        let error = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect_err("observed row contradicts absent claim");
        assert_eq!(
            error.detail,
            CapabilityEvidenceErrorDetail::ObservedSignalContradiction
        );
        assert_eq!(error.physical_data_row, Some(2));
        assert!(!error.to_string().contains("P1"));
    }

    #[test]
    fn source_arm_missing_unbound_and_capable_no_row_are_distinct() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Activity Resumed", Some("app.a"))];
        let fragmented = BTreeSet::new();
        let missing = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
            applicability_input(&raw_digest, &events, None, &fragmented),
        )
        .expect("scientific refusal is a receipt");
        assert_eq!(
            missing.refusal_reason,
            Some(B05RefusalReason::InputCapabilityEvidenceAbsent)
        );

        let foreign_digest = sha256_wire(b"foreign");
        let foreign = parsed_all_capable(&foreign_digest);
        let unbound = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
            applicability_input(&raw_digest, &events, Some(&foreign), &fragmented),
        )
        .expect("unbound evidence is a receipt");
        assert_eq!(
            unbound.refusal_reason,
            Some(B05RefusalReason::CapabilityEvidenceNotBoundToInput)
        );

        let capable = parsed_all_capable(&raw_digest);
        let receipt = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
            applicability_input(&raw_digest, &events, Some(&capable), &fragmented),
        )
        .expect("capable-no-row executes");
        assert!(receipt.executable);
        let hidden = decision(
            &receipt.participant_decisions[0].capability_decisions,
            CapabilityId::AndroidUsageEvent18KeyguardHidden,
        );
        assert_eq!(
            hidden.observation_disposition,
            ObservationDisposition::CapableNoRow
        );
    }

    #[test]
    fn refusal_priority_is_global_and_deterministic() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![RawB05Event::from_raw_label(
            "",
            None,
            1,
            "Screen Interactive/Keyguard Shown",
            None,
        )];
        let mut states = BTreeMap::new();
        states.insert(
            CapabilityId::SourceRecordOrderPreserved,
            CapabilityState::Absent,
        );
        let evidence = parse_capability_evidence(&capability_csv(&raw_digest, &states, &[]))
            .expect("valid assertions");
        let fragmented = BTreeSet::new();
        let receipt = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect("issues resolve");
        assert_eq!(
            receipt.refusal_reason,
            Some(B05RefusalReason::ParticipantScopeUndetermined)
        );
    }

    #[test]
    fn participant_scope_issues_are_not_copied_to_unaffected_participants() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![
            event("", 0, 1, "Screen Interactive", None),
            event("P2", 1, 2, "Activity Resumed", Some("app.a")),
        ];
        let evidence = parsed_all_capable(&raw_digest);
        let fragmented = BTreeSet::new();
        let receipt = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect("issues resolve");
        let empty = receipt
            .participant_decisions
            .iter()
            .find(|participant| participant.participant_id.is_empty())
            .expect("offending participant retained");
        let p2 = receipt
            .participant_decisions
            .iter()
            .find(|participant| participant.participant_id == "P2")
            .expect("unaffected participant retained");
        assert!(empty
            .issues
            .iter()
            .any(|issue| issue.reason == B05RefusalReason::ParticipantScopeUndetermined));
        assert!(!p2
            .issues
            .iter()
            .any(|issue| issue.reason == B05RefusalReason::ParticipantScopeUndetermined));
    }

    #[test]
    fn combined_rows_refuse_without_fallback() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Screen Interactive/Keyguard Shown", None)];
        let evidence = parsed_all_capable(&raw_digest);
        let fragmented = BTreeSet::new();
        let output = construct_screen_intervals(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect("scientific refusal returns receipt");
        assert!(!output.executable());
        assert!(output.intervals.is_empty());
        assert_eq!(
            output.applicability.refusal_reason,
            Some(B05RefusalReason::CombinedEventRepresentation)
        );
    }

    #[test]
    fn decisive_equal_time_requires_order_but_nondecisive_tie_does_not() {
        let raw_digest = sha256_wire(b"raw");
        let decisive = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Screen Non-Interactive", None),
        ];
        let evidence = parse_capability_evidence(&capability_csv(
            &raw_digest,
            &BTreeMap::new(),
            &[(
                "P1".into(),
                CapabilityId::EqualTimestampSourceOrderPreserved,
                CapabilityState::Unknown,
            )],
        ))
        .expect("valid unknown override");
        let fragmented = BTreeSet::new();
        let refused = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &decisive, Some(&evidence), &fragmented),
        )
        .expect("resolution succeeds");
        assert_eq!(
            refused.refusal_reason,
            Some(B05RefusalReason::AmbiguousEqualTimestamp)
        );
        assert_eq!(
            refused.participant_decisions[0].decisive_equal_timestamp_group_count,
            1
        );
        assert!(refused
            .required_capability_ids
            .contains(&CapabilityId::EqualTimestampSourceOrderPreserved));

        let nondecisive = vec![
            event("P1", 0, 1, "Activity Resumed", Some("app.a")),
            event("P1", 0, 2, "Activity Resumed", Some("app.b")),
        ];
        let accepted = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &nondecisive, Some(&evidence), &fragmented),
        )
        .expect("resolution succeeds");
        assert!(accepted.executable);
        assert_eq!(
            accepted.participant_decisions[0].decisive_equal_timestamp_group_count,
            0
        );
        assert!(!accepted
            .required_capability_ids
            .contains(&CapabilityId::EqualTimestampSourceOrderPreserved));
    }

    #[test]
    fn equal_time_endpoint_lineage_change_is_decisive() {
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Screen Interactive", None),
            event("P1", 1, 3, "Screen Non-Interactive", None),
        ];
        assert_eq!(
            decisive_equal_timestamp_group_count(
                ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
                &rows(&events),
            ),
            1,
            "changing the retained physical boundary row changes interval identity",
        );
    }

    #[test]
    fn absent_complete_chunk_uses_frozen_fragment_refusal_detail() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Screen Interactive", None)];
        let evidence = parse_capability_evidence(&capability_csv(
            &raw_digest,
            &BTreeMap::new(),
            &[(
                "P1".into(),
                CapabilityId::CompleteObservationWindowChunk,
                CapabilityState::Absent,
            )],
        ))
        .expect("valid absent override");
        let receipt = resolve_b05_applicability(
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            applicability_input(&raw_digest, &events, Some(&evidence), &BTreeSet::new()),
        )
        .expect("absence is a typed scientific refusal");
        let issue = receipt.participant_decisions[0]
            .issues
            .iter()
            .find(|issue| issue.reason == B05RefusalReason::UnsupportedInputChunk)
            .expect("fragment refusal issue");
        assert_eq!(issue.detail, "participant_stream_fragmented");
    }

    #[test]
    fn executor_fragment_scope_refuses_chronicle_and_source_without_publishing_intervals() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![event("P1", 0, 1, "Screen Interactive", None)];
        let fragmented = BTreeSet::from(["P1".to_owned(), "P2".to_owned()]);

        for strategy in [
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
        ] {
            let receipt = resolve_b05_applicability(
                strategy,
                applicability_input(&raw_digest, &events, None, &fragmented),
            )
            .expect("executor boundary is a typed refusal");
            assert!(!receipt.executable);
            assert_eq!(
                receipt.refusal_reason,
                Some(B05RefusalReason::UnsupportedInputChunk)
            );
            assert_eq!(
                receipt.refusal_detail.as_deref(),
                Some("participant=P1;participant_stream_fragmented")
            );
            assert_eq!(
                receipt
                    .participant_decisions
                    .iter()
                    .map(|decision| decision.participant_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["P1", "P2"],
                "explicit fragment scope survives even when P2 has no row",
            );
        }

        let output = adapt_chronicle_screen_intervals(
            applicability_input(&raw_digest, &events, None, &fragmented),
            &[ChronicleScreenIntervalInput {
                participant_id: "P1".into(),
                start_ns: 0,
                stop_ns: Some(1),
                start_boundary_source_row: 1,
                stop_boundary_source_row: Some(2),
                start_source_rows: vec![1],
                stop_source_rows: vec![2],
                close_reason: ScreenIntervalCloseReason::ScreenNonInteractive,
            }],
        )
        .expect("Chronicle refusal envelope");
        assert!(!output.executable());
        assert!(output.intervals.is_empty());
        assert!(output.construction_receipt.is_none());
        assert!(output.issues.is_empty());
    }

    #[test]
    fn parry_toth_reversed_keyguard_order_is_a_session() {
        let events = vec![
            event("P1", 0, 1, "Keyguard Hidden", None),
            event("P1", 1, 2, "Screen Interactive", None),
            event("P1", 9, 3, "Screen Non-Interactive", None),
            event("P1", 10, 4, "Keyguard Shown", None),
        ];
        let (intervals, issues) = construct_parry_toth_partition("P1", &rows(&events));
        assert!(issues.is_empty());
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].kind, ScreenIntervalKind::Session);
        assert_eq!((intervals[0].start_ns, intervals[0].stop_ns), (1, Some(9)));
        assert_eq!(intervals[0].start_source_rows, vec![1, 2]);
        assert_eq!(intervals[0].stop_source_rows, vec![3, 4]);
    }

    #[test]
    fn parry_toth_orphan_duplicate_tail_fixture_keeps_only_middle_glance() {
        let events = vec![
            event("P1", 0, 1, "Screen Non-Interactive", None),
            event("P1", 1, 2, "Screen Interactive", None),
            event("P1", 2, 3, "Screen Interactive", None),
            event("P1", 3, 4, "Screen Non-Interactive", None),
            event("P1", 4, 5, "Screen Interactive", None),
        ];
        let (intervals, issues) = construct_parry_toth_partition("P1", &rows(&events));
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].kind, ScreenIntervalKind::Glance);
        assert_eq!((intervals[0].start_ns, intervals[0].stop_ns), (2, Some(3)));
        assert_eq!(
            issues
                .iter()
                .map(|issue| (issue.source_data_row, issue.code))
                .collect::<Vec<_>>(),
            vec![
                (
                    1,
                    ScreenConstructionIssueCode::UnmatchedGlanceStopNoPreviousStart
                ),
                (
                    2,
                    ScreenConstructionIssueCode::UnmatchedGlanceStartNextNotStop
                ),
                (
                    5,
                    ScreenConstructionIssueCode::UnmatchedGlanceStartNoNextStop
                ),
            ]
        );
    }

    #[test]
    fn parry_toth_reboot_endpoints_pair_only_when_bounded() {
        let bare = vec![
            event("P1", 5, 1, "Device Shutdown", None),
            event("P1", 20, 2, "Device Startup", None),
        ];
        assert!(construct_parry_toth_partition("P1", &rows(&bare))
            .0
            .is_empty());

        let bounded = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Keyguard Hidden", None),
            event("P1", 5, 3, "Device Shutdown", None),
            event("P1", 20, 4, "Device Startup", None),
            event("P1", 30, 5, "Screen Non-Interactive", None),
            event("P1", 31, 6, "Keyguard Shown", None),
        ];
        let intervals = construct_parry_toth_partition("P1", &rows(&bounded)).0;
        assert_eq!(
            intervals
                .iter()
                .map(|interval| (interval.start_ns, interval.stop_ns))
                .collect::<Vec<_>>(),
            vec![(0, Some(5)), (20, Some(30))]
        );

        let added_start = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Keyguard Hidden", None),
            event("P1", 5, 3, "Device Shutdown", None),
            event("P1", 20, 4, "Device Startup", None),
            event("P1", 21, 5, "Screen Interactive", None),
            event("P1", 22, 6, "Keyguard Hidden", None),
            event("P1", 30, 7, "Screen Non-Interactive", None),
            event("P1", 31, 8, "Keyguard Shown", None),
        ];
        let intervals = construct_parry_toth_partition("P1", &rows(&added_start)).0;
        assert_eq!(
            intervals
                .iter()
                .map(|interval| (interval.start_ns, interval.stop_ns))
                .collect::<Vec<_>>(),
            vec![(0, Some(5)), (21, Some(30))]
        );
    }

    #[test]
    fn parry_toth_equal_time_uses_physical_source_order() {
        let run = |labels: &[&str]| {
            let events = labels
                .iter()
                .enumerate()
                .map(|(index, label)| event("P1", 0, index as u32 + 1, label, None))
                .collect::<Vec<_>>();
            construct_parry_toth_partition("P1", &rows(&events)).0
        };
        assert_eq!(
            run(&[
                "Keyguard Hidden",
                "Screen Interactive",
                "Screen Non-Interactive",
                "Keyguard Shown"
            ])[0]
                .kind,
            ScreenIntervalKind::Session
        );
        assert_eq!(
            run(&[
                "Screen Interactive",
                "Screen Non-Interactive",
                "Keyguard Hidden",
                "Keyguard Shown"
            ])[0]
                .kind,
            ScreenIntervalKind::Glance
        );
        assert_eq!(
            run(&["Screen Interactive", "Screen Non-Interactive"])[0].kind,
            ScreenIntervalKind::Glance
        );
        assert!(run(&["Screen Non-Interactive", "Screen Interactive"]).is_empty());
    }

    #[test]
    fn parry_toth_uses_screen_projection_but_zhu_uses_full_log_adjacency() {
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 2, 3, "Keyguard Hidden", None),
            event("P1", 9, 4, "Screen Non-Interactive", None),
            event("P1", 10, 5, "Keyguard Shown", None),
        ];
        assert_eq!(
            construct_parry_toth_partition("P1", &rows(&events)).0[0].kind,
            ScreenIntervalKind::Session
        );
        assert!(construct_zhu_partition("P1", &rows(&events)).0.is_empty());
    }

    #[test]
    fn zhu_starts_at_unlock_and_preserves_a_right_censored_open() {
        let bounded = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Keyguard Hidden", None),
            event("P1", 10, 3, "Screen Non-Interactive", None),
        ];
        let interval = &construct_zhu_partition("P1", &rows(&bounded)).0[0];
        assert_eq!((interval.start_ns, interval.stop_ns), (1, Some(10)));
        assert_eq!(interval.start_boundary_source_row, 2);

        let open = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Keyguard Hidden", None),
        ];
        let interval = &construct_zhu_partition("P1", &rows(&open)).0[0];
        assert!(interval.right_censored);
        assert_eq!(interval.stop_ns, None);
    }

    #[test]
    fn canonical_chronicle_adapter_preserves_participant_isolation() {
        let raw_digest = sha256_wire(b"raw");
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P2", 5, 2, "Screen Interactive", None),
            event("P1", 10, 3, "Screen Non-Interactive", None),
            event("P2", 15, 4, "Screen Non-Interactive", None),
        ];
        let fragmented = BTreeSet::new();
        let canonical = vec![
            ChronicleScreenIntervalInput {
                participant_id: "P1".into(),
                start_ns: 0,
                stop_ns: Some(10),
                start_boundary_source_row: 1,
                stop_boundary_source_row: Some(3),
                start_source_rows: vec![1],
                stop_source_rows: vec![3],
                close_reason: ScreenIntervalCloseReason::ScreenNonInteractive,
            },
            ChronicleScreenIntervalInput {
                participant_id: "P2".into(),
                start_ns: 5,
                stop_ns: Some(15),
                start_boundary_source_row: 2,
                stop_boundary_source_row: Some(4),
                start_source_rows: vec![2],
                stop_source_rows: vec![4],
                close_reason: ScreenIntervalCloseReason::ScreenNonInteractive,
            },
        ];
        let output = adapt_chronicle_screen_intervals(
            applicability_input(&raw_digest, &events, None, &fragmented),
            &canonical,
        )
        .expect("Chronicle does not require capability evidence");
        assert!(output.executable());
        assert_eq!(output.intervals.len(), 2);
        assert_eq!(
            output
                .intervals
                .iter()
                .map(|interval| {
                    (
                        interval.participant_id.as_str(),
                        interval.start_ns,
                        interval.stop_ns,
                    )
                })
                .collect::<Vec<_>>(),
            vec![("P1", 0, Some(10)), ("P2", 5, Some(15))]
        );
    }

    fn screen_interval(
        participant: &str,
        start_ns: i64,
        start_row: u32,
        stop_ns: Option<i64>,
        stop_row: Option<u32>,
    ) -> ScreenIntervalEvidence {
        let start = event(participant, start_ns, start_row, "Screen Interactive", None);
        let stop = stop_ns.zip(stop_row).map(|(timestamp, source_row)| {
            event(
                participant,
                timestamp,
                source_row,
                "Screen Non-Interactive",
                None,
            )
        });
        make_screen_interval(
            participant,
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
            ScreenIntervalKind::Session,
            &start,
            stop.as_ref(),
            vec![start_row],
            stop_row.into_iter().collect(),
            if stop.is_some() {
                ScreenIntervalCloseReason::ScreenNonInteractive
            } else {
                ScreenIntervalCloseReason::RightCensoredObservationWindow
            },
        )
    }

    fn construct_bound_screen(
        events: &[RawB05Event],
        strategy: ScreenSessionConstructionStrategyId,
    ) -> ScreenConstructionOutput {
        let raw_digest =
            sha256_wire(&serde_json::to_vec(events).expect("serialize bound B05/Schoedel fixture"));
        let fragmented = BTreeSet::new();
        let evidence = parsed_all_capable(&raw_digest);
        let construction =
            if strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
                let mut participant_screen_rows =
                    BTreeMap::<String, (&RawB05Event, &RawB05Event)>::new();
                for event in events {
                    if event.signal == AndroidUsageSignal::ScreenInteractive {
                        participant_screen_rows
                            .entry(event.participant_id.clone())
                            .and_modify(|pair| pair.0 = event)
                            .or_insert((event, event));
                    } else if event.signal == AndroidUsageSignal::ScreenNonInteractive {
                        participant_screen_rows
                            .entry(event.participant_id.clone())
                            .and_modify(|pair| pair.1 = event)
                            .or_insert((event, event));
                    }
                }
                let canonical = participant_screen_rows
                    .into_iter()
                    .map(
                        |(participant_id, (start, stop))| ChronicleScreenIntervalInput {
                            participant_id,
                            start_ns: start.timestamp_ns.expect("screen start timestamp"),
                            stop_ns: stop.timestamp_ns,
                            start_boundary_source_row: start.source_data_row,
                            stop_boundary_source_row: Some(stop.source_data_row),
                            start_source_rows: vec![start.source_data_row],
                            stop_source_rows: vec![stop.source_data_row],
                            close_reason: ScreenIntervalCloseReason::ScreenNonInteractive,
                        },
                    )
                    .collect::<Vec<_>>();
                adapt_chronicle_screen_intervals(
                    applicability_input(&raw_digest, events, None, &fragmented),
                    &canonical,
                )
                .expect("canonical Chronicle B05 construction")
            } else {
                construct_screen_intervals(
                    strategy,
                    applicability_input(&raw_digest, events, Some(&evidence), &fragmented),
                )
                .expect("source B05 construction")
            };
        assert!(
            construction.executable(),
            "{}: {:#?}",
            strategy.canonical_id(),
            construction.applicability
        );
        assert!(
            !construction.intervals.is_empty(),
            "{}",
            strategy.canonical_id()
        );
        construction
    }

    fn construct_and_run_bound_schoedel(
        events: &[RawB05Event],
        strategy: ScreenSessionConstructionStrategyId,
    ) -> SchoedelReconstructionOutput {
        let construction = construct_bound_screen(events, strategy);
        reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
            raw_events: events,
            screen_intervals: &construction.intervals,
            selected_b05_strategy_id: strategy,
            equal_timestamp_source_order_preserved: true,
            source_order_resolution: None,
        })
    }

    #[test]
    fn schoedel_validator_rejects_metadata_count_and_episode_tampering() {
        let strategy = ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1;
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 2, 3, "Activity Paused", Some("app.a")),
            event("P1", 3, 4, "Screen Non-Interactive", None),
        ];
        let screen = construct_bound_screen(&events, strategy);
        let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
            raw_events: &events,
            screen_intervals: &screen.intervals,
            selected_b05_strategy_id: strategy,
            equal_timestamp_source_order_preserved: false,
            source_order_resolution: None,
        });
        validate_schoedel_reconstruction_output(&output, &screen, strategy, events.len() as u64)
            .expect("untampered Schoedel output validates");
        assert!(validate_schoedel_reconstruction_output(
            &output,
            &screen,
            strategy,
            events.len() as u64 + 1,
        )
        .is_err());

        for field in [
            "applicability_protocol",
            "source_identity",
            "source_version",
            "source_license",
            "source_scope",
            "adapter",
            "completion_rules",
            "input_count",
            "episode_id",
            "episode_digest",
        ] {
            let mut tampered = output.clone();
            match field {
                "applicability_protocol" => {
                    tampered.applicability.protocol_version = "foreign/v1".into()
                }
                "source_identity" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .source_identity = "foreign-source".into()
                }
                "source_version" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .source_version = "foreign-version".into()
                }
                "source_license" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .source_license_status = "foreign-license".into()
                }
                "source_scope" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .source_scope_id = "foreign-scope".into()
                }
                "adapter" => {
                    tampered.reconstruction_receipt.as_mut().unwrap().adapter_id =
                        "foreign-adapter".into()
                }
                "completion_rules" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .completion_rule_ids
                        .pop();
                }
                "input_count" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .input_event_count += 1
                }
                "episode_id" => tampered.episodes[0].episode_id.push_str(":tampered"),
                "episode_digest" => {
                    tampered
                        .reconstruction_receipt
                        .as_mut()
                        .unwrap()
                        .episode_digest = sha256_wire(b"foreign episodes")
                }
                _ => unreachable!(),
            }
            assert!(
                validate_schoedel_reconstruction_output(
                    &tampered,
                    &screen,
                    strategy,
                    events.len() as u64,
                )
                .is_err(),
                "accepted Schoedel tamper {field}",
            );
        }
    }

    #[test]
    fn schoedel_validator_rejects_mixed_or_unidentified_decisive_order_evidence() {
        let strategy = ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1;
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Activity Resumed", Some("app.a")),
            event("P1", 4, 3, "Activity Paused", Some("app.a")),
            event("P1", 5, 4, "Screen Non-Interactive", None),
            event("P2", 0, 5, "Screen Interactive", None),
            event("P2", 0, 6, "Activity Resumed", Some("app.b")),
            event("P2", 4, 7, "Activity Paused", Some("app.b")),
            event("P2", 5, 8, "Screen Non-Interactive", None),
        ];
        let screen = construct_bound_screen(&events, strategy);
        let raw_digest = screen.applicability.input_digest.clone();
        let evidence =
            parse_capability_evidence(&capability_csv(&raw_digest, &BTreeMap::new(), &[]))
                .expect("capable source-order evidence");
        let assignment = capability_evidence_assignment_digest(&evidence.evidence_artifact_digest);
        let participants = BTreeSet::from(["P1".to_string(), "P2".to_string()]);
        let resolution = resolve_schoedel_source_order_capability(
            &raw_digest,
            &participants,
            Some(&evidence),
            Some(&assignment),
        );
        let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
            raw_events: &events,
            screen_intervals: &screen.intervals,
            selected_b05_strategy_id: strategy,
            equal_timestamp_source_order_preserved: false,
            source_order_resolution: Some(&resolution),
        });
        assert!(output.applicability.decisive_equal_timestamp_group_count > 0);
        validate_schoedel_reconstruction_output(&output, &screen, strategy, events.len() as u64)
            .expect("all-capable decisive evidence validates");

        for state in [CapabilityState::Unknown, CapabilityState::Absent] {
            let mut tampered = output.clone();
            let resolution = tampered
                .applicability
                .source_order_resolution
                .as_mut()
                .unwrap();
            let decision = &mut resolution.participant_decisions[1].decision;
            decision.asserted_state = Some(state);
            decision.effective_state = state;
            decision.observation_disposition = match state {
                CapabilityState::Unknown => ObservationDisposition::Unknown,
                CapabilityState::Absent => ObservationDisposition::Absent,
                CapabilityState::Capable => unreachable!(),
            };
            if state == CapabilityState::Unknown {
                decision.evidence_basis = Some(EvidenceBasis::Unspecified);
                decision.evidence_reference = Some(String::new());
                decision.evidence_sha256 = None;
            }
            resolution.resolution_digest = schoedel_source_order_resolution_digest(resolution);
            tampered
                .applicability
                .equal_timestamp_source_order_preserved = false;
            assert!(
                validate_schoedel_reconstruction_output(
                    &tampered,
                    &screen,
                    strategy,
                    events.len() as u64,
                )
                .is_err(),
                "accepted mixed decisive state {}",
                state.canonical_id(),
            );
        }

        let mut unidentified = output.clone();
        let resolution = unidentified
            .applicability
            .source_order_resolution
            .as_mut()
            .unwrap();
        resolution.evidence_artifact_digest = None;
        resolution.evidence_assignment_digest = None;
        resolution.resolution_digest = schoedel_source_order_resolution_digest(resolution);
        assert!(validate_schoedel_reconstruction_output(
            &unidentified,
            &screen,
            strategy,
            events.len() as u64,
        )
        .is_err());
    }

    #[test]
    fn schoedel_aa_b_uses_last_package_event_before_boundary() {
        let interval = screen_interval("P1", 0, 1, Some(8), Some(7));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 2, 3, "Activity Paused", Some("app.a")),
            event("P1", 3, 4, "Activity Resumed", Some("app.a")),
            event("P1", 5, 5, "Activity Resumed", Some("app.b")),
            event("P1", 7, 6, "Activity Paused", Some("app.b")),
            event("P1", 8, 7, "Screen Non-Interactive", None),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: true,
        });
        assert!(output.applicability.executable);
        assert_eq!(output.episodes.len(), 2);
        assert_eq!(
            (
                output.episodes[0].package_name.as_str(),
                output.episodes[0].start_ns,
                output.episodes[0].stop_ns,
                output.episodes[0].completion,
            ),
            (
                "app.a",
                1,
                Some(3),
                SchoedelCompletion::LastPackageEventBeforeDifferentApp,
            )
        );
        assert_eq!(
            (
                output.episodes[1].package_name.as_str(),
                output.episodes[1].start_ns,
                output.episodes[1].stop_ns,
                output.episodes[1].completion,
            ),
            (
                "app.b",
                5,
                Some(7),
                SchoedelCompletion::LastPackageEventBeforeScreenEnd,
            )
        );
        assert!(output
            .episodes
            .iter()
            .all(
                |episode| episode.screen_interval_id == output.applicability.b05_interval_digest
                    || !episode.screen_interval_id.is_empty()
            ));
        let receipt = output
            .reconstruction_receipt
            .as_ref()
            .expect("executable prose reconstruction receipt");
        assert_eq!(
            receipt.protocol_version,
            SCHOEDEL_RECONSTRUCTION_RECEIPT_PROTOCOL_VERSION
        );
        assert_eq!(receipt.source_identity, SCHOEDEL_PROSE_SOURCE_IDENTITY);
        assert_eq!(receipt.source_version, SCHOEDEL_PROSE_SOURCE_VERSION);
        assert_eq!(
            receipt.source_license_status,
            SCHOEDEL_PROSE_SOURCE_LICENSE_STATUS
        );
        assert_eq!(receipt.source_scope_id, SCHOEDEL_PROSE_SOURCE_SCOPE_ID);
        assert_eq!(receipt.adapter_id, SCHOEDEL_PROSE_ADAPTER_ID);
        assert_eq!(
            receipt.completion_rule_ids,
            SCHOEDEL_PROSE_COMPLETION_RULE_IDS
                .iter()
                .map(|rule| (*rule).to_owned())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn schoedel_singleton_is_zero_not_extended_to_next_app() {
        let interval = screen_interval("P1", 0, 1, Some(8), Some(5));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 5, 3, "Activity Resumed", Some("app.b")),
            event("P1", 7, 4, "Activity Paused", Some("app.b")),
            event("P1", 8, 5, "Screen Non-Interactive", None),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: true,
        });
        let first = &output.episodes[0];
        assert_eq!(first.completion, SchoedelCompletion::SingletonZeroLength);
        assert_eq!(
            (first.start_ns, first.stop_ns, first.raw_duration_ns),
            (1, Some(1), Some(0))
        );
        assert_eq!(first.source_rows, vec![2]);
    }

    #[test]
    fn schoedel_right_censor_never_borrows_query_end() {
        let interval = screen_interval("P1", 0, 1, None, None);
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 9, 3, "Activity Paused", Some("app.a")),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: true,
        });
        let episode = &output.episodes[0];
        assert_eq!(
            episode.completion,
            SchoedelCompletion::RightCensoredScreenInterval
        );
        assert_eq!(episode.stop_ns, None);
        assert_eq!(episode.raw_duration_ns, None);
        assert!(!episode.bounded_headline_candidate);
    }

    #[test]
    fn schoedel_boundary_ties_use_source_row_and_refuse_when_order_is_unavailable() {
        let interval = screen_interval("P1", 0, 1, Some(8), Some(5));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Activity Resumed", Some("app.a")),
            event("P1", 8, 4, "Activity Paused", Some("app.a")),
            event("P1", 8, 5, "Screen Non-Interactive", None),
            event("P1", 8, 6, "Activity Resumed", Some("app.b")),
        ];
        let executable = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: std::slice::from_ref(&interval),
            equal_timestamp_source_order_preserved: true,
        });
        assert_eq!(executable.episodes.len(), 1);
        assert_eq!(executable.episodes[0].stop_source_row, Some(4));

        let refused = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: false,
        });
        assert!(!refused.applicability.executable);
        assert_eq!(
            refused.applicability.refusal_reason,
            Some(SchoedelRefusalReason::AmbiguousEqualTimestamp)
        );
    }

    #[test]
    fn schoedel_tie_uses_participant_scoped_bound_order_capability() {
        let raw_digest = sha256_wire(b"raw");
        let interval = screen_interval("P1", 0, 1, Some(8), Some(5));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Activity Resumed", Some("app.a")),
            event("P1", 8, 4, "Activity Paused", Some("app.a")),
            event("P1", 8, 5, "Screen Non-Interactive", None),
        ];
        let participants = BTreeSet::from(["P1".to_string()]);
        let resolve = |state| {
            let evidence = ParsedCapabilityEvidence {
                claims: vec![CapabilityClaim {
                    physical_data_row: 2,
                    raw_input_sha256: raw_digest.clone(),
                    participant_id: "P1".into(),
                    capability_id: CapabilityId::EqualTimestampSourceOrderPreserved,
                    state,
                    evidence_basis: if state == CapabilityState::Unknown {
                        EvidenceBasis::Unspecified
                    } else {
                        EvidenceBasis::StudyProtocol
                    },
                    evidence_reference: if state == CapabilityState::Unknown {
                        String::new()
                    } else {
                        "fixture".into()
                    },
                    evidence_sha256: None,
                }],
                evidence_artifact_digest: sha256_wire(b"evidence"),
            };
            resolve_schoedel_source_order_capability(
                &raw_digest,
                &participants,
                Some(&evidence),
                Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            )
        };
        for (state, executable) in [
            (CapabilityState::Capable, true),
            (CapabilityState::Absent, false),
            (CapabilityState::Unknown, false),
        ] {
            let resolution = resolve(state);
            let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
                raw_events: &events,
                screen_intervals: std::slice::from_ref(&interval),
                selected_b05_strategy_id:
                    ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
                equal_timestamp_source_order_preserved: false,
                source_order_resolution: Some(&resolution),
            });
            assert_eq!(output.applicability.executable, executable);
            assert_eq!(
                output
                    .applicability
                    .source_order_resolution
                    .as_ref()
                    .expect("resolution receipt")
                    .resolution_digest,
                resolution.resolution_digest,
            );
        }

        let no_tie_interval = screen_interval("P1", 0, 1, Some(9), Some(6));
        let no_tie_events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 8, 4, "Activity Paused", Some("app.a")),
            event("P1", 9, 6, "Screen Non-Interactive", None),
        ];
        let unknown = resolve(CapabilityState::Unknown);
        let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
            raw_events: &no_tie_events,
            screen_intervals: &[no_tie_interval],
            selected_b05_strategy_id:
                ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1,
            equal_timestamp_source_order_preserved: false,
            source_order_resolution: Some(&unknown),
        });
        assert!(output.applicability.executable);
        assert!(!output.applicability.equal_timestamp_source_order_preserved);
        assert_eq!(output.applicability.decisive_equal_timestamp_group_count, 0);
    }

    #[test]
    fn nonconsequential_pause_at_screen_boundary_does_not_require_tie_order() {
        let interval = screen_interval("P1", 0, 1, Some(8), Some(3));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 8, 2, "Activity Paused", Some("app.a")),
            event("P1", 8, 3, "Screen Non-Interactive", None),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: false,
        });
        assert!(output.applicability.executable);
        assert_eq!(output.applicability.decisive_equal_timestamp_group_count, 0);
        assert!(output.episodes.is_empty());
        assert_eq!(
            output.issues[0].code,
            SchoedelIssueCode::ScreenIntervalWithoutAppLaunch,
        );
    }

    #[test]
    fn schoedel_tied_associated_row_and_different_app_opener_is_decisive() {
        let interval = screen_interval("P1", 0, 1, Some(10), Some(5));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Activity Resumed", Some("app.a")),
            event("P1", 5, 3, "Activity Paused", Some("app.a")),
            event("P1", 5, 4, "Activity Resumed", Some("app.b")),
            event("P1", 10, 5, "Screen Non-Interactive", None),
        ];
        let refused = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: false,
        });
        assert!(!refused.applicability.executable);
        assert_eq!(
            refused.applicability.refusal_reason,
            Some(SchoedelRefusalReason::AmbiguousEqualTimestamp),
        );
        assert_eq!(
            refused.applicability.decisive_equal_timestamp_group_count,
            1
        );
    }

    #[test]
    fn schoedel_zero_length_screen_boundary_tie_is_counted_once() {
        let interval = screen_interval("P1", 0, 1, Some(0), Some(3));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 0, 2, "Activity Resumed", Some("app.a")),
            event("P1", 0, 3, "Screen Non-Interactive", None),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[interval],
            equal_timestamp_source_order_preserved: true,
        });
        assert!(output.applicability.executable);
        assert_eq!(output.applicability.decisive_equal_timestamp_group_count, 1);
    }

    #[test]
    fn schoedel_partitions_participants_and_reports_empty_screen_intervals() {
        let p1 = screen_interval("P1", 0, 1, Some(10), Some(4));
        let p2 = screen_interval("P2", 0, 2, Some(10), Some(5));
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P2", 0, 2, "Screen Interactive", None),
            event("P1", 1, 3, "Activity Resumed", Some("app.a")),
            event("P1", 10, 4, "Screen Non-Interactive", None),
            event("P2", 10, 5, "Screen Non-Interactive", None),
        ];
        let output = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &events,
            screen_intervals: &[p1, p2],
            equal_timestamp_source_order_preserved: true,
        });
        assert_eq!(output.episodes.len(), 1);
        assert_eq!(output.episodes[0].participant_id, "P1");
        assert_eq!(
            output
                .issues
                .iter()
                .filter(|issue| issue.code == SchoedelIssueCode::ScreenIntervalWithoutAppLaunch)
                .count(),
            1
        );
    }

    #[test]
    fn zero_interval_schoedel_receipt_still_binds_each_selected_b05_strategy() {
        for strategy in ScreenSessionConstructionStrategyId::ALL {
            let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
                raw_events: &[],
                screen_intervals: &[],
                selected_b05_strategy_id: strategy,
                equal_timestamp_source_order_preserved: true,
                source_order_resolution: None,
            });
            assert!(
                output.applicability.executable,
                "{}",
                strategy.canonical_id()
            );
            assert_eq!(output.applicability.b05_strategy_ids, vec![strategy]);
        }
    }

    #[test]
    fn every_b05_arm_feeds_nonempty_partition_isolated_schoedel_evidence() {
        let combined = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P2", 0, 2, "Screen Interactive", None),
            event("P1", 1, 3, "Keyguard Hidden", None),
            event("P2", 1, 4, "Keyguard Hidden", None),
            event("P1", 2, 5, "Activity Resumed", Some("app.one")),
            event("P2", 2, 6, "Activity Resumed", Some("app.two")),
            event("P1", 3, 7, "Activity Paused", Some("app.one")),
            event("P2", 3, 8, "Activity Paused", Some("app.two")),
            event("P1", 4, 9, "Keyguard Shown", None),
            event("P2", 4, 10, "Keyguard Shown", None),
            event("P1", 5, 11, "Screen Non-Interactive", None),
            event("P2", 5, 12, "Screen Non-Interactive", None),
        ];
        for strategy in ScreenSessionConstructionStrategyId::ALL {
            let output = construct_and_run_bound_schoedel(&combined, strategy);
            assert!(
                output.applicability.executable,
                "{}",
                strategy.canonical_id()
            );
            assert_eq!(output.applicability.b05_strategy_ids, vec![strategy]);
            assert_eq!(output.episodes.len(), 2, "{}", strategy.canonical_id());
            assert!(output
                .episodes
                .iter()
                .all(|episode| episode.b05_strategy_id == strategy));

            let mut independent_episodes = Vec::new();
            let mut independent_issue_count = 0_usize;
            let mut independent_input_events = 0_u64;
            let mut independent_input_intervals = 0_u64;
            let mut independent_episode_count = 0_u64;
            let mut independent_bounded_count = 0_u64;
            let mut independent_singleton_count = 0_u64;
            let mut independent_right_censored_count = 0_u64;
            let mut independent_issue_counts = BTreeMap::<String, u64>::new();
            let mut independent_receipts = Vec::new();
            for participant in ["P1", "P2"] {
                let participant_events = combined
                    .iter()
                    .filter(|event| event.participant_id == participant)
                    .cloned()
                    .collect::<Vec<_>>();
                let independent = construct_and_run_bound_schoedel(&participant_events, strategy);
                let independent_receipt = independent
                    .reconstruction_receipt
                    .as_ref()
                    .expect("independent receipt");
                independent_input_events += independent_receipt.input_event_count;
                independent_input_intervals += independent_receipt.input_screen_interval_count;
                independent_episode_count += independent_receipt.episode_count;
                independent_bounded_count += independent_receipt.bounded_episode_count;
                independent_singleton_count += independent_receipt.singleton_zero_length_count;
                independent_right_censored_count +=
                    independent_receipt.right_censored_evidence_count;
                for (issue, count) in &independent_receipt.issue_counts {
                    *independent_issue_counts.entry(issue.clone()).or_default() += count;
                }
                independent_receipts.push(independent_receipt.clone());
                independent_issue_count += independent.issues.len();
                independent_episodes.extend(independent.episodes);
            }
            independent_episodes.sort_by(|left, right| {
                (&left.participant_id, left.start_ns, left.start_source_row).cmp(&(
                    &right.participant_id,
                    right.start_ns,
                    right.start_source_row,
                ))
            });
            assert_eq!(output.episodes, independent_episodes);
            assert_eq!(output.issues.len(), independent_issue_count);
            let receipt = output
                .reconstruction_receipt
                .as_ref()
                .expect("combined reconstruction receipt");
            assert_eq!(receipt.input_event_count, independent_input_events);
            assert_eq!(
                receipt.input_screen_interval_count,
                independent_input_intervals
            );
            assert_eq!(receipt.episode_count, independent_episode_count);
            assert_eq!(receipt.episode_count, output.episodes.len() as u64);
            assert_eq!(receipt.bounded_episode_count, independent_bounded_count);
            assert_eq!(
                receipt.singleton_zero_length_count,
                independent_singleton_count
            );
            assert_eq!(
                receipt.right_censored_evidence_count,
                independent_right_censored_count
            );
            assert_eq!(receipt.issue_counts, independent_issue_counts);
            assert_eq!(
                receipt.episode_digest,
                schoedel_episode_digest(&output.episodes)
            );
            for independent in independent_receipts {
                assert_eq!(independent.protocol_version, receipt.protocol_version);
                assert_eq!(independent.strategy_id, receipt.strategy_id);
                assert_eq!(independent.relation, receipt.relation);
                assert_eq!(independent.source_identity, receipt.source_identity);
                assert_eq!(independent.source_version, receipt.source_version);
                assert_eq!(
                    independent.source_license_status,
                    receipt.source_license_status
                );
                assert_eq!(independent.source_scope_id, receipt.source_scope_id);
                assert_eq!(independent.adapter_id, receipt.adapter_id);
                assert_eq!(independent.completion_rule_ids, receipt.completion_rule_ids);
            }
            let source_participant = combined
                .iter()
                .map(|event| (event.source_data_row, event.participant_id.as_str()))
                .collect::<BTreeMap<_, _>>();
            for episode in &output.episodes {
                assert!(episode.source_rows.iter().all(|source| {
                    source_participant.get(source).copied() == Some(episode.participant_id.as_str())
                }));
            }
        }
    }

    #[test]
    fn bound_schoedel_refuses_an_interval_from_a_different_b05_strategy() {
        let interval = screen_interval("P1", 0, 1, Some(8), Some(3));
        let output = reconstruct_bound_schoedel_prose(BoundSchoedelProseInput {
            raw_events: &[],
            screen_intervals: &[interval],
            selected_b05_strategy_id:
                ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            equal_timestamp_source_order_preserved: true,
            source_order_resolution: None,
        });
        assert!(!output.applicability.executable);
        assert_eq!(
            output.applicability.refusal_reason,
            Some(SchoedelRefusalReason::InvalidScreenIntervalDependency),
        );
        assert_eq!(
            output.applicability.refusal_detail.as_deref(),
            Some("screen_interval_strategy_mismatch"),
        );
    }

    #[test]
    fn interval_and_episode_ids_commit_complete_immutable_evidence() {
        let baseline = make_screen_interval_from_parts(
            "P1",
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            ScreenIntervalKind::Session,
            0,
            Some(8),
            1,
            Some(3),
            vec![1],
            vec![3],
            ScreenIntervalCloseReason::ScreenNonInteractive,
        );
        let lineage_changed = make_screen_interval_from_parts(
            "P1",
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            ScreenIntervalKind::Session,
            0,
            Some(8),
            1,
            Some(3),
            vec![1, 2],
            vec![3],
            ScreenIntervalCloseReason::ScreenNonInteractive,
        );
        let close_changed = make_screen_interval_from_parts(
            "P1",
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
            ScreenIntervalKind::Session,
            0,
            Some(8),
            1,
            Some(3),
            vec![1],
            vec![3],
            ScreenIntervalCloseReason::DeviceScreenOff,
        );
        assert_ne!(
            baseline.screen_interval_id,
            lineage_changed.screen_interval_id
        );
        assert_ne!(
            baseline.screen_interval_id,
            close_changed.screen_interval_id
        );

        let mut left_censored = baseline.clone();
        left_censored.left_censored = true;
        assert_ne!(
            screen_interval_digest(std::slice::from_ref(&baseline)),
            screen_interval_digest(&[left_censored]),
        );

        let mut opener = event("P1", 1, 2, "Activity Resumed", Some("app.a"));
        let first = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: std::slice::from_ref(&opener),
            screen_intervals: std::slice::from_ref(&baseline),
            equal_timestamp_source_order_preserved: true,
        });
        opener.source_data_rows.push(9);
        let lineage_variant = reconstruct_schoedel_prose(SchoedelProseInput {
            raw_events: &[opener],
            screen_intervals: &[baseline],
            equal_timestamp_source_order_preserved: true,
        });
        assert_ne!(
            first.episodes[0].episode_id,
            lineage_variant.episodes[0].episode_id,
        );
    }

    #[test]
    fn full_schoedel_binding_is_always_a_named_prerequisite_refusal() {
        let receipt = schoedel_full_osf_refusal();
        assert!(!receipt.executable);
        assert_eq!(receipt.relation, ScientificRelation::Refused);
        assert_eq!(
            receipt.refusal_reason,
            Some(SchoedelRefusalReason::SchoedelFullOsfMissingPrerequisites)
        );
        assert!(SCHOEDEL_FULL_OSF_REQUIRED_INPUTS.len() >= 7);
    }

    #[test]
    fn stable_ids_and_digests_are_reproducible() {
        let interval_a = screen_interval("P1", 0, 1, Some(10), Some(2));
        let interval_b = screen_interval("P1", 0, 1, Some(10), Some(2));
        assert_eq!(interval_a.screen_interval_id, interval_b.screen_interval_id);
        assert_eq!(
            screen_interval_digest(std::slice::from_ref(&interval_a)),
            screen_interval_digest(std::slice::from_ref(&interval_b))
        );
        assert!(interval_a
            .screen_interval_id
            .starts_with("urn:chronicle:screen-interval:sha256:"));
    }

    #[test]
    fn persisted_screen_validator_rejects_rehashed_nested_semantic_tampering() {
        let raw_digest = sha256_wire(b"persisted-validator-input");
        let events = vec![
            event("P1", 0, 1, "Screen Interactive", None),
            event("P1", 1, 2, "Screen Non-Interactive", None),
            event("P1", 2, 3, "Screen Interactive", None),
            event("P1", 3, 4, "Screen Non-Interactive", None),
        ];
        let evidence = parsed_all_capable(&raw_digest);
        let fragmented = BTreeSet::new();
        let strategy = ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1;
        let output = construct_screen_intervals(
            strategy,
            applicability_input(&raw_digest, &events, Some(&evidence), &fragmented),
        )
        .expect("valid construction");
        validate_screen_construction_output(&output, &raw_digest, strategy, events.len() as u64)
            .expect("untampered output validates");

        let assert_rejected = |tampered: &ScreenConstructionOutput| {
            assert!(
                validate_screen_construction_output(
                    tampered,
                    &raw_digest,
                    strategy,
                    events.len() as u64,
                )
                .is_err(),
                "nested semantic mutation must be rejected"
            );
        };

        let mut tampered = output.clone();
        tampered.applicability.source_checkpoint = "tampered-checkpoint".into();
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.applicability.required_capability_ids.pop();
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.applicability.evidence_assignment_digest = None;
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.applicability.evidence_assignment_digest =
            Some(sha256_wire(b"unrelated-assignment"));
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.applicability.evidence_artifact_digest = Some("sha256:not-a-digest".into());
        tampered.applicability.evidence_assignment_digest =
            Some(capability_evidence_assignment_digest("sha256:not-a-digest"));
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let claim_mutations: [fn(&mut CapabilityDecision); 3] = [
            |decision: &mut CapabilityDecision| {
                decision.asserted_state = Some(CapabilityState::Unknown);
                decision.effective_state = CapabilityState::Unknown;
                decision.evidence_basis = Some(EvidenceBasis::StudyProtocol);
                decision.evidence_reference = Some("invalid-unknown-reference".into());
                decision.evidence_sha256 = None;
                decision.evidence_origin = CapabilityEvidenceOrigin::ManifestAssertion;
                decision.observation_disposition = ObservationDisposition::Unknown;
            },
            |decision: &mut CapabilityDecision| {
                decision.asserted_state = Some(CapabilityState::Capable);
                decision.effective_state = CapabilityState::Capable;
                decision.evidence_basis = Some(EvidenceBasis::Unspecified);
                decision.evidence_reference = Some(String::new());
                decision.evidence_sha256 = None;
                decision.evidence_origin = CapabilityEvidenceOrigin::ManifestAssertion;
                decision.observation_disposition = ObservationDisposition::CapableNoRow;
            },
            |decision: &mut CapabilityDecision| {
                decision.evidence_sha256 = Some("sha256:not-a-digest".into());
            },
        ];
        for mutate in claim_mutations {
            let mut tampered = output.clone();
            let decision = tampered.applicability.participant_decisions[0]
                .capability_decisions
                .iter_mut()
                .find(|decision| {
                    decision.capability_id == CapabilityId::EqualTimestampSourceOrderPreserved
                })
                .expect("non-required equal-time capability decision");
            mutate(decision);
            tampered.applicability.capability_resolution_digest =
                applicability_resolution_digest(&tampered.applicability);
            assert_rejected(&tampered);
        }

        let mut tampered = output.clone();
        tampered.applicability.participant_decisions[0].capability_decisions[0]
            .claim_physical_data_row = Some(9_999);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered
            .applicability
            .participant_decisions
            .push(tampered.applicability.participant_decisions[0].clone());
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        let duplicate =
            tampered.applicability.participant_decisions[0].capability_decisions[0].clone();
        tampered.applicability.participant_decisions[0]
            .capability_decisions
            .insert(1, duplicate);
        tampered.applicability.capability_resolution_digest =
            applicability_resolution_digest(&tampered.applicability);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.intervals.swap(0, 1);
        tampered
            .construction_receipt
            .as_mut()
            .expect("construction receipt")
            .interval_digest = screen_interval_digest(&tampered.intervals);
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered.intervals[0]
            .screen_interval_id
            .push_str(":tampered");
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered
            .construction_receipt
            .as_mut()
            .expect("construction receipt")
            .interval_count += 1;
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        let receipt = tampered
            .construction_receipt
            .as_mut()
            .expect("construction receipt");
        receipt.source_identity = "tampered-source".into();
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        let receipt = tampered
            .construction_receipt
            .as_mut()
            .expect("construction receipt");
        receipt.source_artifact_sha256 = Some(sha256_wire(b"tampered-artifact"));
        assert_rejected(&tampered);

        let mut tampered = output.clone();
        tampered
            .construction_receipt
            .as_mut()
            .expect("construction receipt")
            .input_row_count += 1;
        assert_rejected(&tampered);
    }

    /// Test-only oracle: the pre-optimization exhaustive form of
    /// `decisive_equal_timestamp_group_count` (a fresh copy of the participant
    /// log per counterfactual pair, and no Zhu branching-signal skip filter).
    fn exhaustive_decisive_equal_timestamp_group_count(
        strategy: ScreenSessionConstructionStrategyId,
        rows: &[&RawB05Event],
    ) -> u32 {
        if strategy == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
            return 0;
        }
        let relevant = |signal: AndroidUsageSignal| match strategy {
            ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1 => matches!(
                signal,
                AndroidUsageSignal::ScreenInteractive
                    | AndroidUsageSignal::ScreenNonInteractive
                    | AndroidUsageSignal::KeyguardShown
                    | AndroidUsageSignal::KeyguardHidden
                    | AndroidUsageSignal::DeviceShutdown
                    | AndroidUsageSignal::DeviceStartup
            ),
            ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1 => true,
            ScreenSessionConstructionStrategyId::UnlockToLockV1 => matches!(
                signal,
                AndroidUsageSignal::KeyguardHidden | AndroidUsageSignal::KeyguardShown
            ),
            ScreenSessionConstructionStrategyId::UnlockToOffOrLockV1 => matches!(
                signal,
                AndroidUsageSignal::KeyguardHidden
                    | AndroidUsageSignal::KeyguardShown
                    | AndroidUsageSignal::ScreenNonInteractive
            ),
            ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 => false,
        };
        let baseline = screen_semantic_signature(strategy, rows);
        let mut groups = BTreeMap::<i64, Vec<usize>>::new();
        for (index, row) in rows.iter().enumerate() {
            if relevant(row.signal) {
                if let Some(timestamp) = row.timestamp_ns {
                    groups.entry(timestamp).or_default().push(index);
                }
            }
        }
        groups
            .values()
            .filter(|positions| {
                positions.windows(2).any(|pair| {
                    let mut counterfactual = rows.to_vec();
                    counterfactual.swap(pair[0], pair[1]);
                    screen_semantic_signature(strategy, &counterfactual) != baseline
                })
            })
            .count() as u32
    }

    /// Test-only oracle: the pre-optimization exhaustive form of
    /// `schoedel_decisive_equal_timestamp_groups` (a deep clone of the full
    /// event stream per counterfactual candidate or pair).
    fn exhaustive_schoedel_decisive_equal_timestamp_groups(
        events: &[RawB05Event],
        intervals: &[ScreenIntervalEvidence],
    ) -> BTreeSet<(String, String, i64)> {
        let mut decisive = BTreeSet::<(String, String, i64)>::new();
        for interval in intervals {
            let participant_events = events
                .iter()
                .filter(|event| event.participant_id == interval.participant_id)
                .collect::<Vec<_>>();
            let baseline = schoedel_interval_signature(interval, &participant_events);
            let mut boundaries =
                vec![(interval.start_ns, interval.start_boundary_source_row, true)];
            if let (Some(stop_ns), Some(stop_row)) =
                (interval.stop_ns, interval.stop_boundary_source_row)
            {
                boundaries.push((stop_ns, stop_row, false));
            }
            for (timestamp, boundary_source_row, is_start) in boundaries {
                let boundary_is_decisive =
                    events.iter().enumerate().any(|(candidate_index, event)| {
                        if event.participant_id != interval.participant_id
                            || event.timestamp_ns != Some(timestamp)
                            || event.source_data_row == boundary_source_row
                            || !is_schoedel_app_evidence_candidate(event)
                        {
                            return false;
                        }
                        let mut counterfactual_events = events.to_vec();
                        let candidate_source_row =
                            counterfactual_events[candidate_index].source_data_row;
                        if let Some(boundary_index) =
                            counterfactual_events.iter().position(|candidate| {
                                candidate.participant_id == interval.participant_id
                                    && candidate.timestamp_ns == Some(timestamp)
                                    && candidate.source_data_row == boundary_source_row
                            })
                        {
                            counterfactual_events[boundary_index].source_data_row =
                                candidate_source_row;
                        }
                        counterfactual_events[candidate_index].source_data_row =
                            boundary_source_row;
                        let mut counterfactual_interval = interval.clone();
                        if is_start {
                            counterfactual_interval.start_boundary_source_row =
                                candidate_source_row;
                        } else {
                            counterfactual_interval.stop_boundary_source_row =
                                Some(candidate_source_row);
                        }
                        let participant_counterfactual = counterfactual_events
                            .iter()
                            .filter(|event| event.participant_id == interval.participant_id)
                            .collect::<Vec<_>>();
                        schoedel_interval_signature(
                            &counterfactual_interval,
                            &participant_counterfactual,
                        ) != baseline
                    });
                if boundary_is_decisive {
                    decisive.insert((
                        interval.participant_id.clone(),
                        interval.screen_interval_id.clone(),
                        timestamp,
                    ));
                }
            }

            let mut groups = BTreeMap::<i64, Vec<usize>>::new();
            for (index, event) in events.iter().enumerate() {
                if let Some(timestamp_ns) = event.timestamp_ns {
                    if event.participant_id == interval.participant_id
                        && is_schoedel_app_evidence_candidate(event)
                        && row_is_inside_interval(event, interval)
                    {
                        groups.entry(timestamp_ns).or_default().push(index);
                    }
                }
            }
            for (timestamp, positions) in groups {
                if positions.len() < 2 {
                    continue;
                }
                if positions.windows(2).any(|pair| {
                    let mut counterfactual = events.to_vec();
                    let left_source_row = counterfactual[pair[0]].source_data_row;
                    counterfactual[pair[0]].source_data_row =
                        counterfactual[pair[1]].source_data_row;
                    counterfactual[pair[1]].source_data_row = left_source_row;
                    let participant_counterfactual = counterfactual
                        .iter()
                        .filter(|event| event.participant_id == interval.participant_id)
                        .collect::<Vec<_>>();
                    schoedel_interval_signature(interval, &participant_counterfactual) != baseline
                }) {
                    decisive.insert((
                        interval.participant_id.clone(),
                        interval.screen_interval_id.clone(),
                        timestamp,
                    ));
                }
            }
        }
        decisive
    }

    fn lcg_next(state: &mut u64) -> u32 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (*state >> 33) as u32
    }

    /// Deterministic two-participant stream where machine signals frequently
    /// share a timestamp with app rows (zero-step timestamps are common), so
    /// equal-timestamp groups of every composition occur.
    fn decisiveness_probe_stream(seed: u64) -> Vec<RawB05Event> {
        let mut state = seed;
        let mut events = Vec::new();
        let mut source_row = 1u32;
        for participant in ["P1", "P2"] {
            let mut timestamp = 1_000_000_000i64;
            let row_count = 40 + (lcg_next(&mut state) % 21) as usize;
            for _ in 0..row_count {
                timestamp += i64::from(lcg_next(&mut state) % 3) * 1_000_000_000;
                let (label, package) = match lcg_next(&mut state) % 10 {
                    0 => ("Screen Interactive", None),
                    1 => ("Keyguard Hidden", None),
                    2 => ("Screen Non-Interactive", None),
                    3 => ("Device Shutdown", None),
                    4 => ("Device Startup", None),
                    5 => ("Keyguard Shown", None),
                    6 | 7 => ("Activity Resumed", Some("com.example.app")),
                    8 => ("Activity Paused", Some("com.example.other")),
                    _ => ("Standby Bucket Changed", Some("com.example.background")),
                };
                events.push(event(participant, timestamp, source_row, label, package));
                source_row += 1;
            }
        }
        events
    }

    #[test]
    fn optimized_decisiveness_probe_matches_the_exhaustive_probe() {
        let mut saw_nonzero_count = false;
        let mut saw_nonempty_schoedel = false;
        for seed in 1u64..=12 {
            let events = decisiveness_probe_stream(seed);
            let mut intervals = Vec::new();
            for participant in ["P1", "P2"] {
                let participant_rows = events
                    .iter()
                    .filter(|row| row.participant_id == participant)
                    .collect::<Vec<_>>();
                for strategy in [
                    ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
                    ScreenSessionConstructionStrategyId::ParryToth2025SessionGlanceV1,
                ] {
                    let optimized =
                        decisive_equal_timestamp_group_count(strategy, &participant_rows);
                    let exhaustive = exhaustive_decisive_equal_timestamp_group_count(
                        strategy,
                        &participant_rows,
                    );
                    assert_eq!(
                        optimized, exhaustive,
                        "count diverged: seed {seed} participant {participant} strategy {strategy:?}"
                    );
                    saw_nonzero_count |= optimized > 0;
                }
                intervals.extend(construct_zhu_partition(participant, &participant_rows).0);
                intervals.extend(construct_parry_toth_partition(participant, &participant_rows).0);
            }
            let optimized = schoedel_decisive_equal_timestamp_groups(&events, &intervals);
            let exhaustive =
                exhaustive_schoedel_decisive_equal_timestamp_groups(&events, &intervals);
            assert_eq!(
                optimized, exhaustive,
                "schoedel decisive set diverged: seed {seed}"
            );
            saw_nonempty_schoedel |= !optimized.is_empty();
        }
        assert!(
            saw_nonzero_count,
            "streams never produced a decisive count; the property test would be vacuous"
        );
        assert!(
            saw_nonempty_schoedel,
            "streams never produced a decisive schoedel group; the property test would be vacuous"
        );
    }
}
