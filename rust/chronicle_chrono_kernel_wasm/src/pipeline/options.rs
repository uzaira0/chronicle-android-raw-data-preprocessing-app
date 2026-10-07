use super::{
    FOREGROUND_EVENTS, LOCK_SCREEN_EVENTS, NOTIFICATION_INTERRUPTION, NOTIFICATION_SEEN,
    SCREEN_START_EVENTS, SCREEN_STOP_EVENTS, ScreenSessionConstructionStrategyId, b06,
};

// ---- options ------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PipelineV2Options {
    pub study_name: String,
    pub timezone: String,
    pub timezone_handling: String,
    pub usage_session_mode: UsageSessionMode,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    pub use_background_apps_file: bool,
    pub use_app_codebook: bool,
    pub include_category_column: bool,
    pub include_app_usage_end_reason: bool,
    /// Prefix `'` to every text cell of every published CSV that a spreadsheet
    /// would evaluate as a formula. Off by default; off is byte-identical.
    pub neutralize_spreadsheet_formulas: bool,
    pub deduplicate_exact_rows: bool,
    pub drop_out_of_source_order_events: bool,
    pub interaction_type_remap: Vec<String>,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
    pub proximity_interval_ns: i64,
    pub custom_app_engagement_duration: f64,
    pub long_data_time_gap_thresholds: Vec<f64>,
    pub long_usage_duration_thresholds: Vec<f64>,
    pub same_app_stop_types: Vec<String>,
    pub other_stop_types: Vec<String>,
    pub interaction_types_to_remove: Vec<String>,
    pub interaction_type_removal_mode: InteractionTypeRemovalMode,
    pub screen_auto_lock_timeout_seconds: f64,
    pub screen_auto_lock_tolerance_seconds: f64,
    pub screen_manual_lock_max_tail_seconds: f64,
    pub screen_keyguard_near_stop_seconds: f64,
    pub datetime_of_preprocessing: String,
    pub model_concurrent_usage: bool,
    pub micro_use_classification_policy: MicroUseClassificationPolicy,
    /// True only when the request envelope carried the B03 key. The effective
    /// value alone cannot distinguish the omitted native baseline from an
    /// explicit behaviorally-equivalent selection.
    pub micro_use_classification_policy_explicit: bool,
    pub minimum_usage_duration: f64,
    /// Per-field presence is retained so the complete B04 request vector is
    /// reconstructable even when every effective value equals the baseline.
    pub minimum_usage_duration_explicit: bool,
    pub minimum_duration_comparator: MinimumDurationComparator,
    pub minimum_duration_comparator_explicit: bool,
    pub minimum_duration_disposition: MinimumDurationDisposition,
    pub minimum_duration_disposition_explicit: bool,
    pub apply_minimum_usage_duration_to_concurrent_subintervals: bool,
    pub filter_zero_duration_sessions: bool,
    pub add_no_activity_placeholder_days: bool,
    pub enable_study_window_filter: bool,
    pub enable_person_attribution: bool,
    pub enable_day_coverage: bool,
    pub enable_compliance_scoring: bool,
    pub compliance_threshold_percent: f64,
    pub enable_screen_gated_crediting: bool,
    pub screen_gating_rule: ScreenGatingRule,
    pub day_boundary_attribution: DayBoundaryAttribution,
    pub filter_match_field: FilterMatchField,
    pub application_label_exclusions: Vec<String>,
    pub package_exclusion_preset: PackageExclusionPreset,
    pub notification_proxy_rule: NotificationProxyRule,
    pub polled_emulation_method: PolledEmulationMethod,
    pub polled_emulation_interval_seconds: f64,
    pub polled_emulation_gap_seconds: f64,
    pub interval_expansion_method: IntervalExpansionMethod,
    pub enable_aggregates: bool,
    pub aggregate_shape: String,
    pub aggregate_top_apps_limit: u32,
    /// One row per participant: Wenz/Keusch/Bach daily amount + winsorized
    /// variant + Stachl Huber M column. Off by default; absent artifact.
    pub enable_participant_amount_summary: bool,
    /// Effective browser view target for the final output query only. The raw
    /// UI flags remain in the receipt; their OR is the only value that can
    /// affect Rust output materialization.
    pub materialize_visualization_data: bool,
    pub credited_session_cap_minutes: f64,
    pub device_liveness_gap_tolerance_minutes: f64,
    pub auto_lock_bridge_seconds: f64,
    pub no_witness_min_day_apps: u32,
    pub screen_session_construction_strategy: ScreenSessionConstructionStrategyId,
    /// Preserves omitted-versus-explicit baseline selection so the B05 receipt
    /// distinguishes `baseline_native` from `baseline_equivalent` without
    /// changing compatibility output bytes.
    pub screen_session_construction_strategy_explicit: bool,
    pub screen_session_classification_policy: ScreenSessionClassificationPolicy,
    pub screen_session_maximum_duration_minutes: f64,
    pub screen_session_maximum_duration_disposition: ScreenSessionMaximumDurationDisposition,
    pub locked_screen_audio_disposition: LockedScreenAudioDisposition,
    pub opener_set: OpenerSet,
    pub episode_reconstruction_strategy: EpisodeReconstructionStrategy,
    pub interval_quality_policy: IntervalQualityPolicy,
    pub session_grouping_policy: SessionGroupingPolicy,
    pub session_gap_basis: SessionGapBasis,
    pub session_boundary_scope: SessionBoundaryScope,
    pub emit_session_break_lineage: bool,
    pub event_retention_set: EventRetentionSet,
    /// The five B06 wire keys plus the legacy canonicalization companions,
    /// exactly as they arrived. Presence is own-property membership; the
    /// typed configuration is resolved by `validate_pipeline_v2_options` and
    /// again (identically) by the classification stage.
    pub maximum_duration: b06::MaximumDurationRequest,
}

/// Descriptive classification applied to an already-materialized app episode.
///
/// This axis never changes episode membership, timing, aggregate eligibility,
/// or reconstruction. `None` is deliberately the compatibility default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MicroUseClassificationPolicy {
    #[default]
    None,
    /// Okoshi et al. (Cyberoception, CHI 2025): a strictly positive bounded
    /// episode shorter than five seconds is micro-use.
    OkoshiLt5s,
}

impl MicroUseClassificationPolicy {
    pub const ALL: [Self; 2] = [Self::None, Self::OkoshiLt5s];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::OkoshiLt5s => "okoshi_lt_5s",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "okoshi_lt_5s" => Self::OkoshiLt5s,
            _ => Self::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MicroUseClassification {
    MicroUse,
    NotMicroUse,
    NotClassifiable,
}

impl MicroUseClassification {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::MicroUse => "micro_use",
            Self::NotMicroUse => "not_micro_use",
            Self::NotClassifiable => "not_classifiable",
        }
    }
}

/// Which observation the B07 screen-gated credit rests on.
///
/// Chronicle's shipped rule intersects two independently observed conditions:
/// witnessed screen-ON intervals (bridged across sub-auto-lock blips) and
/// demonstrably-alive spans (event cadence within the liveness tolerance,
/// broken by a Device Startup). Naming the rule makes each conjunct selectable
/// on its own. Every value affects only the credited side output; the headline
/// app-usage output never changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenGatingRule {
    /// Compatibility default: screen intervals intersected with alive spans,
    /// byte-identical to the pre-B07 credited output.
    #[default]
    ScreenAndLivenessV1,
    /// Screen witness alone; a lit screen inside a long silence still credits.
    ScreenWitnessOnly,
    /// Visual-only source rule: no screen witness means no credited interval.
    StrictVisualOnly,
    /// Alive spans alone; no screen evidence is consulted, so the
    /// no-screen-witness fallback never applies.
    DeviceLivenessOnly,
}

impl ScreenGatingRule {
    pub const ALL: [Self; 4] = [
        Self::ScreenAndLivenessV1,
        Self::ScreenWitnessOnly,
        Self::StrictVisualOnly,
        Self::DeviceLivenessOnly,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ScreenAndLivenessV1 => "screen_and_liveness_v1",
            Self::ScreenWitnessOnly => "screen_witness_only",
            Self::StrictVisualOnly => "strict_visual_only",
            Self::DeviceLivenessOnly => "device_liveness_only",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "screen_witness_only" => Self::ScreenWitnessOnly,
            "strict_visual_only" => Self::StrictVisualOnly,
            "device_liveness_only" => Self::DeviceLivenessOnly,
            _ => Self::ScreenAndLivenessV1,
        }
    }

    /// True when the rule reads screen events at all. `device_liveness_only`
    /// does not, which is why it skips the no-screen-witness fallback.
    pub fn consults_screen_witness(self) -> bool {
        !matches!(self, Self::DeviceLivenessOnly)
    }

    pub fn requires_screen_witness(self) -> bool {
        matches!(self, Self::StrictVisualOnly)
    }
}

/// How a session that runs past local midnight is attributed to calendar days.
///
/// Chronicle dates a session by the local calendar day of its START instant
/// and never divides it, so a 23:40-00:20 session contributes all forty
/// minutes to the first day and none to the second. A study reporting daily
/// screen time is asking how much use fell within each day, which is a
/// different question, so the rule is named rather than assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DayBoundaryAttribution {
    /// Compatibility default: one row, dated by its start day. Byte-identical
    /// to the pre-B14 output.
    #[default]
    AttributeToStartDay,
    /// One row per calendar day the session touches, each with its own start,
    /// stop, duration and date, all carrying the same raw source evidence.
    SplitAtLocalMidnight,
}

impl DayBoundaryAttribution {
    pub const ALL: [Self; 2] = [Self::AttributeToStartDay, Self::SplitAtLocalMidnight];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::AttributeToStartDay => "attribute_to_start_day",
            Self::SplitAtLocalMidnight => "split_at_local_midnight",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "split_at_local_midnight" => Self::SplitAtLocalMidnight,
            _ => Self::AttributeToStartDay,
        }
    }

    pub fn divides_sessions(self) -> bool {
        matches!(self, Self::SplitAtLocalMidnight)
    }
}

/// Which rows of the supplied package-filter file actually exclude a package.
///
/// The shipped default filter file carries an `app_filter_category`
/// classification and a per-row `filter_bool`, and before this axis existed no
/// kernel step read either: `build_filter_map` used the package and label
/// columns alone, so every supplied row excluded regardless of its category and
/// a row marked `filter_bool` 0 was excluded anyway. Naming the rule resolves
/// that silent disagreement between a shipped artifact and engine behavior.
///
/// Exclusion is a RELABEL, never a deletion -- an excluded episode is retained
/// as `Filtered App Usage`, keeps its raw evidence, and still bounds its
/// neighbours -- so every value here moves which rows carry the excluded label
/// and nothing about how an episode is reconstructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackageExclusionPreset {
    /// Compatibility default: every supplied row excludes, whatever its
    /// category and whatever its flag says. Byte-identical to the pre-B10
    /// output, and the only value under which both extra columns stay unread.
    #[default]
    AllSuppliedRows,
    /// Read `filter_bool`: a row whose flag parses as false does not exclude.
    HonorFilterFlag,
    /// Read `app_filter_category`: exclude only `system` / `system-defensive`.
    SystemScopeOnly,
}

impl PackageExclusionPreset {
    pub const ALL: [Self; 3] = [
        Self::AllSuppliedRows,
        Self::HonorFilterFlag,
        Self::SystemScopeOnly,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::AllSuppliedRows => "all_supplied_rows",
            Self::HonorFilterFlag => "honor_filter_flag",
            Self::SystemScopeOnly => "system_scope_only",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "honor_filter_flag" => Self::HonorFilterFlag,
            "system_scope_only" => Self::SystemScopeOnly,
            _ => Self::AllSuppliedRows,
        }
    }

    /// Whether this value reads any column beyond package and label. False for
    /// the default, which is what keeps the extra columns observationally
    /// unread under the shipped configuration.
    pub fn reads_row_scope_columns(self) -> bool {
        !matches!(self, Self::AllSuppliedRows)
    }

    /// Whether a filter-file row excludes its package under this preset.
    ///
    /// `category` and `flag` are the row's raw cells, already trimmed. An
    /// absent or unparseable cell is treated as "no reason to narrow": an
    /// unreadable flag still excludes, because a typo in a support file must
    /// not quietly start crediting an excluded package.
    pub fn row_excludes(self, category: &str, flag: &str) -> bool {
        match self {
            Self::AllSuppliedRows => true,
            Self::HonorFilterFlag => !matches!(
                flag.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            ),
            Self::SystemScopeOnly => matches!(
                category.trim().to_ascii_lowercase().as_str(),
                "system" | "system-defensive"
            ),
        }
    }
}

/// B08: which raw notification rows, if any, become explicit proxy contact
/// events.
///
/// Chronicle records Android's `NOTIFICATION_SEEN` (type 10) and
/// `NOTIFICATION_INTERRUPTION` (type 12) as app-scoped rows carrying a package,
/// and the app-usage reconstruction reads neither: output rows are episodes, so
/// a notification row produces nothing at all. The one existing notification
/// decision in this engine is `GESIS_UNMATCHABLE_STOP_EVENTS`, which declares
/// `Notification Seen` unmatchable as a stop inside a single strategy. This
/// axis makes the class explicit instead of leaving it implicit.
///
/// A notification is an INSTANT, not an interval. Every value here emits proxy
/// contact events into a side-by-side channel and never contributes a duration
/// to app usage; the headline output is byte-identical under all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationProxyRule {
    /// Compatibility default: notification rows play no role beyond whatever a
    /// reconstruction strategy already does with them, and no proxy channel is
    /// emitted at all.
    #[default]
    None,
    /// `Notification Seen` (type 10) only -- the notification was posted and
    /// surfaced to the user, without any evidence that it was acted on.
    SeenContactV1,
    /// `Notification Interruption` (type 12) only -- the notification actively
    /// interrupted, a stronger contact signal than merely being seen.
    InterruptionContactV1,
    /// Both notification types.
    AnyNotificationContactV1,
}

impl NotificationProxyRule {
    pub const ALL: [Self; 4] = [
        Self::None,
        Self::SeenContactV1,
        Self::InterruptionContactV1,
        Self::AnyNotificationContactV1,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::SeenContactV1 => "seen_contact_v1",
            Self::InterruptionContactV1 => "interruption_contact_v1",
            Self::AnyNotificationContactV1 => "any_notification_contact_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "seen_contact_v1" => Self::SeenContactV1,
            "interruption_contact_v1" => Self::InterruptionContactV1,
            "any_notification_contact_v1" => Self::AnyNotificationContactV1,
            _ => Self::None,
        }
    }

    /// Whether this rule emits a proxy channel at all.
    pub fn emits_contacts(self) -> bool {
        !matches!(self, Self::None)
    }

    /// Whether a raw row's canonical interaction type is a proxy source here.
    pub fn admits_interaction_type(self, interaction_type: &str) -> bool {
        match self {
            Self::None => false,
            Self::SeenContactV1 => interaction_type == NOTIFICATION_SEEN,
            Self::InterruptionContactV1 => interaction_type == NOTIFICATION_INTERRUPTION,
            Self::AnyNotificationContactV1 => {
                matches!(interaction_type, NOTIFICATION_SEEN | NOTIFICATION_INTERRUPTION)
            }
        }
    }
}

/// B09. Which published polled-collection method to emulate over the
/// reconstructed timeline.
///
/// Chronicle collects the event stream: every foreground transition carries its
/// own timestamp. A large part of the smartphone-use literature does not -- a
/// background service records "what is on screen now" at a fixed cadence, and
/// sessions are derived from those samples. Totals from the two instruments are
/// not comparable, and nothing here let a researcher ask what their own data
/// would have looked like under the other one.
///
/// Both named values are rules DECLARED IN PUBLISHED CODE OR PROSE, not
/// inferred:
///
/// - Ross, Rhee, Le, Mount, Chang & Bayer (2025), *Scientific Reports*,
///   `10.1038/s41598-025-25174-2`, OSF `bjh2m`. The released preprocessing
///   retains interactive samples and treats a retained record as a session
///   end when the next sample gap is at least 15 s or the next foreground
///   package differs, forcing the last row closed so that it counts.
///   Acquisition lineage polled foreground up to every ten seconds.
/// - Cerit et al. (2025), `10.2196/59875`. Screen time is sample count
///   converted by the five-second cadence -- duration by COUNTING samples,
///   never by subtracting endpoints.
///
/// Every value emits a side-by-side channel and never changes the headline
/// output. Emulation resamples an event-derived timeline, so it can only lose
/// detail relative to the event stream; it does not reproduce what a real
/// polled collector would additionally have missed through jitter, doze, or
/// permission loss. That is a lower bound on the difference between
/// instruments, not a simulation of one, and every emitted row says so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolledEmulationMethod {
    /// Compatibility default: no emulation channel is emitted at all.
    #[default]
    None,
    /// Close a run of samples when the next sample gap reaches the configured
    /// threshold or the foreground package changes; the terminal sample is
    /// forced closed so that it counts. Duration is measured across the
    /// retained sample endpoints.
    Ross2025SampledGapV1,
    /// Duration is the retained sample count multiplied by the cadence. No
    /// endpoint is ever subtracted, so a single retained sample is one whole
    /// cadence of screen time rather than zero.
    Cerit2025SampleCountV1,
}

impl PolledEmulationMethod {
    pub const ALL: [Self; 3] = [
        Self::None,
        Self::Ross2025SampledGapV1,
        Self::Cerit2025SampleCountV1,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Ross2025SampledGapV1 => "ross_2025_sampled_gap_v1",
            Self::Cerit2025SampleCountV1 => "cerit_2025_sample_count_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "ross_2025_sampled_gap_v1" => Self::Ross2025SampledGapV1,
            "cerit_2025_sample_count_v1" => Self::Cerit2025SampleCountV1,
            _ => Self::None,
        }
    }

    /// Whether this method emits an emulation channel at all.
    pub fn emits_emulation(self) -> bool {
        !matches!(self, Self::None)
    }

    /// Whether the method closes a run on a sampled gap. `Cerit` counts
    /// samples per foreground package and never consults a gap threshold, so
    /// the gap option is inert under it -- stated here rather than left for a
    /// reader to infer from the absence of a branch.
    pub fn uses_gap_threshold(self) -> bool {
        matches!(self, Self::Ross2025SampledGapV1)
    }
}

/// Comparator for the post-materialization B04 minimum-duration decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinimumDurationComparator {
    #[default]
    StrictLt,
    InclusiveLe,
}

impl MinimumDurationComparator {
    pub const ALL: [Self; 2] = [Self::StrictLt, Self::InclusiveLe];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::StrictLt => "strict_lt",
            Self::InclusiveLe => "inclusive_le",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "inclusive_le" => Self::InclusiveLe,
            _ => Self::StrictLt,
        }
    }

    pub(super) fn qualifies(self, duration_ns: i64, threshold_ns: i64) -> bool {
        match self {
            Self::StrictLt => duration_ns < threshold_ns,
            Self::InclusiveLe => duration_ns <= threshold_ns,
        }
    }
}

/// Disposition applied after one B04 qualification decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinimumDurationDisposition {
    /// Compatibility behavior: keep boundaries/row and blank public duration.
    #[default]
    ChronicleBlankKeepRow,
    /// Keep raw/public duration and headline eligibility.
    RetainAndCredit,
    /// Keep raw/public duration but explicitly remove the row from headline
    /// summaries and aggregate denominators.
    RetainButExclude,
    /// Remove the public row while preserving a dedicated lineage record.
    DropRow,
}

impl MinimumDurationDisposition {
    pub const ALL: [Self; 4] = [
        Self::ChronicleBlankKeepRow,
        Self::RetainAndCredit,
        Self::RetainButExclude,
        Self::DropRow,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::ChronicleBlankKeepRow => "chronicle_blank_keep_row",
            Self::RetainAndCredit => "retain_and_credit",
            Self::RetainButExclude => "retain_but_exclude",
            Self::DropRow => "drop_row",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "retain_and_credit" => Self::RetainAndCredit,
            "retain_but_exclude" => Self::RetainButExclude,
            "drop_row" => Self::DropRow,
            _ => Self::ChronicleBlankKeepRow,
        }
    }
}

/// Configuration error raised before any episode reconstruction can observe
/// an invalid B04 threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineV2OptionsValidationError {
    MinimumUsageDurationNonFinite,
    MinimumUsageDurationNegative,
    MinimumUsageDurationNanosecondOverflow,
    /// A request `f64` option that is `NaN` or infinite. The field name is the
    /// wire key, so the refusal names the exact option a researcher sent.
    NonFiniteRealOption(&'static str),
    ScreenSessionMaximumDurationShape,
    /// A typed B06 refusal raised before any decode or reconstruction.
    MaximumDuration(b06::MaximumDurationRefusalReason),
    /// A duration option below zero.
    NegativeRealOption(&'static str),
}

impl std::fmt::Display for PipelineV2OptionsValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::MinimumUsageDurationNonFinite => {
                "pipeline_options_invalid:minimum_usage_duration:non_finite"
            }
            Self::MinimumUsageDurationNegative => {
                "pipeline_options_invalid:minimum_usage_duration:negative"
            }
            Self::MinimumUsageDurationNanosecondOverflow => {
                "pipeline_options_invalid:minimum_usage_duration:nanosecond_overflow"
            }
            Self::NegativeRealOption(field) => {
                return write!(formatter, "pipeline_options_invalid:{field}:negative");
            }
            Self::NonFiniteRealOption(field) => {
                return write!(formatter, "pipeline_options_invalid:{field}:non_finite");
            }
            Self::ScreenSessionMaximumDurationShape => {
                "pipeline_options_invalid:screen_session_maximum_duration:invalid_shape"
            }
            Self::MaximumDuration(reason) => {
                return write!(
                    formatter,
                    "pipeline_options_invalid:{}",
                    reason.error_token()
                );
            }
        })
    }
}

impl std::error::Error for PipelineV2OptionsValidationError {}

pub(super) fn checked_minimum_duration_threshold_ns(
    seconds: f64,
) -> Result<Option<i64>, PipelineV2OptionsValidationError> {
    if !seconds.is_finite() {
        return Err(PipelineV2OptionsValidationError::MinimumUsageDurationNonFinite);
    }
    if seconds < 0.0 {
        return Err(PipelineV2OptionsValidationError::MinimumUsageDurationNegative);
    }
    if seconds == 0.0 {
        return Ok(None);
    }
    let nanoseconds = seconds * 1_000_000_000.0;
    // `i64::MAX as f64` rounds to the exclusive 2^63 boundary. Rejecting at
    // that boundary avoids accepting a value whose saturating Rust cast would
    // fabricate i64::MAX rather than the requested integer nanoseconds.
    if !nanoseconds.is_finite() || nanoseconds.round() >= i64::MAX as f64 {
        return Err(PipelineV2OptionsValidationError::MinimumUsageDurationNanosecondOverflow);
    }
    let rounded = nanoseconds.round() as i64;
    // The public receipt is integer nanoseconds.  Any positive sub-nanosecond
    // request that rounds to zero must therefore have the same disabled
    // semantics as an exact zero request; publishing threshold_ns=0 while
    // still qualifying zero-length episodes would be irreproducible.
    Ok((rounded > 0).then_some(rounded))
}

/// How much of the B06 maximum-duration vector a validation pass judges.
///
/// A malformed vector (illegal shape, non-canonical threshold, legacy
/// companions that disagree with the wire hours) is an invalid request on
/// every surface. A *legal* vector that is refused for the selected
/// reconstruction strategy or threshold provider is a typed refusal: the B06
/// preflight reports it as data and execution rejects it, but a
/// configuration-only preflight for another axis (the opener set) must not
/// turn it into a raw request error, or the browser and the campaign
/// harnesses would surface the raw token instead of the typed refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaximumDurationValidation {
    /// Every B06 outcome other than success is an error (execution paths).
    Complete,
    /// Malformed vectors are errors; refusals for the selected strategy or
    /// provider are left to the B06 preflight and the execution guard.
    MalformedOnly,
    /// B06 is not judged here at all (the B06 preflight itself, which reports
    /// every B06 outcome — malformed or refused — as data).
    Skip,
}

/// Validate request-level scientific options before raw input decoding,
/// reconstruction, cache selection, or output materialization.
pub fn validate_pipeline_v2_options(
    options: &PipelineV2Options,
) -> Result<(), PipelineV2OptionsValidationError> {
    validate_pipeline_v2_options_with(options, MaximumDurationValidation::Complete)
}

/// `validate_pipeline_v2_options` with an explicit B06 judgement scope; the
/// non-B06 checks always run.
pub fn validate_pipeline_v2_options_with(
    options: &PipelineV2Options,
    maximum_duration: MaximumDurationValidation,
) -> Result<(), PipelineV2OptionsValidationError> {
    checked_minimum_duration_threshold_ns(options.minimum_usage_duration)?;
    validate_option_real_numbers(options)?;
    if !matches!(
        (
            options.screen_session_maximum_duration_disposition,
            options.screen_session_maximum_duration_minutes,
        ),
        (ScreenSessionMaximumDurationDisposition::None, 0.0)
    ) && !(matches!(
        options.screen_session_maximum_duration_disposition,
        ScreenSessionMaximumDurationDisposition::Truncate
            | ScreenSessionMaximumDurationDisposition::ExcludeParticipant
    ) && options.screen_session_maximum_duration_minutes > 0.0)
    {
        return Err(PipelineV2OptionsValidationError::ScreenSessionMaximumDurationShape);
    }
    match (maximum_duration, resolve_maximum_duration(options)) {
        (MaximumDurationValidation::Skip, _) | (_, Ok(_)) => Ok(()),
        (MaximumDurationValidation::MalformedOnly, Err(reason))
            if reason.is_applicability_refusal() =>
        {
            Ok(())
        }
        (_, Err(reason)) => Err(PipelineV2OptionsValidationError::MaximumDuration(reason)),
    }
}

/// Refuse a request that carries a non-finite `f64` option.
///
/// JSON ingress cannot deliver a non-finite value (serde_json refuses an
/// out-of-range float literal, and `JSON.stringify(Infinity)` emits `null`,
/// which fails the field type) -- the paired test measures both refusals.
/// This gate protects the TYPED public API: native profiling examples,
/// campaign harnesses, and any direct Rust caller construct
/// `PipelineV2Options` without JSON, and every consumer of these fields
/// either compares them (an infinite bound silently answers every
/// comparison), converts them to integer nanoseconds, or commits them to a
/// Salsa cache key through `to_bits()` (where the two NaN spellings key as
/// two inputs). `checked_minimum_duration_threshold_ns` already guarded the
/// B04 floor and `seconds_to_ns_floor` already floors the two B09 polling
/// knobs to "no grid"; this gate refuses the rest of the real surface at the
/// same place, before any decode or reconstruction.
///
/// The destructure is exhaustive under `#[deny(unused_variables)]`: adding a
/// request option fails this pattern, and binding one without routing it to
/// `finite_real`, `finite_reals`, or `not_a_real_number` fails the lint.
/// What the lint does NOT check is that the ROUTE is right: a real-valued
/// field misrouted to `not_a_real_number` still compiles. The paired test's
/// setter-table equality is the gate for that direction, and it holds only
/// while the test-side classification stays honest -- reviewers of a new
/// `f64` option must check both sides.
#[deny(unused_variables)]
pub(super) fn validate_option_real_numbers(
    options: &PipelineV2Options,
) -> Result<(), PipelineV2OptionsValidationError> {
    fn finite_real(
        field: &'static str,
        value: f64,
    ) -> Result<(), PipelineV2OptionsValidationError> {
        if value.is_finite() {
            Ok(())
        } else {
            Err(PipelineV2OptionsValidationError::NonFiniteRealOption(field))
        }
    }
    fn finite_reals(
        field: &'static str,
        values: &[f64],
    ) -> Result<(), PipelineV2OptionsValidationError> {
        if values.iter().copied().all(f64::is_finite) {
            Ok(())
        } else {
            Err(PipelineV2OptionsValidationError::NonFiniteRealOption(field))
        }
    }
    /// Bound and dismissed: the field carries no binary64 value, so no
    /// finiteness question exists for it.
    fn not_a_real_number<T: ?Sized>(_field: &T) {}

    let PipelineV2Options {
        study_name,
        timezone,
        timezone_handling,
        usage_session_mode,
        include_app_output,
        include_screen_output,
        use_filter_file,
        use_apps_forcing_screen_open,
        use_background_apps_file,
        use_app_codebook,
        include_category_column,
        include_app_usage_end_reason,
        neutralize_spreadsheet_formulas,
        deduplicate_exact_rows,
        drop_out_of_source_order_events,
        interaction_type_remap,
        correct_duplicate_event_timestamps,
        allow_stop_event_reuse,
        use_activity_stopped_as_fallback,
        apply_threshold_to_fallback,
        long_duration_threshold_ns,
        proximity_interval_ns,
        custom_app_engagement_duration,
        long_data_time_gap_thresholds,
        long_usage_duration_thresholds,
        same_app_stop_types,
        other_stop_types,
        interaction_types_to_remove,
        interaction_type_removal_mode,
        screen_auto_lock_timeout_seconds,
        screen_auto_lock_tolerance_seconds,
        screen_manual_lock_max_tail_seconds,
        screen_keyguard_near_stop_seconds,
        datetime_of_preprocessing,
        model_concurrent_usage,
        micro_use_classification_policy,
        micro_use_classification_policy_explicit,
        minimum_usage_duration,
        minimum_usage_duration_explicit,
        minimum_duration_comparator,
        minimum_duration_comparator_explicit,
        minimum_duration_disposition,
        minimum_duration_disposition_explicit,
        apply_minimum_usage_duration_to_concurrent_subintervals,
        filter_zero_duration_sessions,
        add_no_activity_placeholder_days,
        enable_study_window_filter,
        enable_person_attribution,
        enable_day_coverage,
        enable_compliance_scoring,
        compliance_threshold_percent,
        enable_screen_gated_crediting,
        screen_gating_rule,
        day_boundary_attribution,
        package_exclusion_preset,
        notification_proxy_rule,
        polled_emulation_method,
        polled_emulation_interval_seconds,
        polled_emulation_gap_seconds,
        interval_expansion_method,
        enable_aggregates,
        aggregate_shape,
        aggregate_top_apps_limit,
        enable_participant_amount_summary,
        materialize_visualization_data,
        credited_session_cap_minutes,
        device_liveness_gap_tolerance_minutes,
        auto_lock_bridge_seconds,
        no_witness_min_day_apps,
        screen_session_construction_strategy,
        screen_session_construction_strategy_explicit,
        screen_session_classification_policy,
        screen_session_maximum_duration_minutes,
        screen_session_maximum_duration_disposition,
        locked_screen_audio_disposition,
        opener_set,
        episode_reconstruction_strategy,
        interval_quality_policy,
        session_grouping_policy,
        session_gap_basis,
        session_boundary_scope,
        emit_session_break_lineage,
        event_retention_set,
        maximum_duration,
        filter_match_field,
        application_label_exclusions,
    } = options;

    not_a_real_number(study_name);
    not_a_real_number(timezone);
    not_a_real_number(timezone_handling);
    not_a_real_number(usage_session_mode);
    not_a_real_number(include_app_output);
    not_a_real_number(include_screen_output);
    not_a_real_number(use_filter_file);
    not_a_real_number(filter_match_field);
    not_a_real_number(application_label_exclusions);
    not_a_real_number(use_apps_forcing_screen_open);
    not_a_real_number(use_background_apps_file);
    not_a_real_number(use_app_codebook);
    not_a_real_number(include_category_column);
    not_a_real_number(neutralize_spreadsheet_formulas);
    not_a_real_number(include_app_usage_end_reason);
    not_a_real_number(deduplicate_exact_rows);
    not_a_real_number(drop_out_of_source_order_events);
    not_a_real_number(interaction_type_remap);
    not_a_real_number(correct_duplicate_event_timestamps);
    not_a_real_number(allow_stop_event_reuse);
    not_a_real_number(use_activity_stopped_as_fallback);
    not_a_real_number(apply_threshold_to_fallback);
    not_a_real_number(long_duration_threshold_ns);
    not_a_real_number(proximity_interval_ns);
    finite_real(
        "custom_app_engagement_duration",
        *custom_app_engagement_duration,
    )?;
    finite_reals(
        "long_data_time_gap_thresholds",
        long_data_time_gap_thresholds,
    )?;
    finite_reals(
        "long_usage_duration_thresholds",
        long_usage_duration_thresholds,
    )?;
    not_a_real_number(same_app_stop_types);
    not_a_real_number(other_stop_types);
    not_a_real_number(interaction_types_to_remove);
    not_a_real_number(interaction_type_removal_mode);
    for (field, value) in [
        ("screen_auto_lock_timeout_seconds", *screen_auto_lock_timeout_seconds),
        ("screen_auto_lock_tolerance_seconds", *screen_auto_lock_tolerance_seconds),
        ("screen_manual_lock_max_tail_seconds", *screen_manual_lock_max_tail_seconds),
        ("screen_keyguard_near_stop_seconds", *screen_keyguard_near_stop_seconds),
    ] {
        finite_real(field, value)?;
        if value < 0.0 {
            return Err(PipelineV2OptionsValidationError::NegativeRealOption(field));
        }
    }
    not_a_real_number(datetime_of_preprocessing);
    not_a_real_number(model_concurrent_usage);
    not_a_real_number(micro_use_classification_policy);
    not_a_real_number(micro_use_classification_policy_explicit);
    // `checked_minimum_duration_threshold_ns` above owns this field and
    // reports the more specific negative / overflow refusals for it.
    not_a_real_number(minimum_usage_duration);
    not_a_real_number(minimum_usage_duration_explicit);
    not_a_real_number(minimum_duration_comparator);
    not_a_real_number(minimum_duration_comparator_explicit);
    not_a_real_number(minimum_duration_disposition);
    not_a_real_number(minimum_duration_disposition_explicit);
    not_a_real_number(apply_minimum_usage_duration_to_concurrent_subintervals);
    not_a_real_number(filter_zero_duration_sessions);
    not_a_real_number(add_no_activity_placeholder_days);
    not_a_real_number(enable_study_window_filter);
    not_a_real_number(enable_person_attribution);
    not_a_real_number(enable_day_coverage);
    not_a_real_number(enable_compliance_scoring);
    finite_real(
        "compliance_threshold_percent",
        *compliance_threshold_percent,
    )?;
    not_a_real_number(enable_screen_gated_crediting);
    not_a_real_number(screen_gating_rule);
    not_a_real_number(day_boundary_attribution);
    not_a_real_number(package_exclusion_preset);
    not_a_real_number(notification_proxy_rule);
    not_a_real_number(polled_emulation_method);
    finite_real(
        "polled_emulation_interval_seconds",
        *polled_emulation_interval_seconds,
    )?;
    finite_real(
        "polled_emulation_gap_seconds",
        *polled_emulation_gap_seconds,
    )?;
    not_a_real_number(interval_expansion_method);
    not_a_real_number(enable_aggregates);
    not_a_real_number(aggregate_shape);
    not_a_real_number(aggregate_top_apps_limit);
    not_a_real_number(enable_participant_amount_summary);
    not_a_real_number(materialize_visualization_data);
    finite_real(
        "credited_session_cap_minutes",
        *credited_session_cap_minutes,
    )?;
    finite_real(
        "device_liveness_gap_tolerance_minutes",
        *device_liveness_gap_tolerance_minutes,
    )?;
    finite_real("auto_lock_bridge_seconds", *auto_lock_bridge_seconds)?;
    not_a_real_number(no_witness_min_day_apps);
    not_a_real_number(screen_session_construction_strategy);
    not_a_real_number(screen_session_construction_strategy_explicit);
    not_a_real_number(screen_session_classification_policy);
    finite_real(
        "screen_session_maximum_duration_minutes",
        *screen_session_maximum_duration_minutes,
    )?;
    not_a_real_number(screen_session_maximum_duration_disposition);
    not_a_real_number(locked_screen_audio_disposition);
    not_a_real_number(opener_set);
    not_a_real_number(episode_reconstruction_strategy);
    not_a_real_number(interval_quality_policy);
    not_a_real_number(session_grouping_policy);
    not_a_real_number(session_gap_basis);
    not_a_real_number(session_boundary_scope);
    not_a_real_number(emit_session_break_lineage);
    not_a_real_number(event_retention_set);
    not_a_real_number(maximum_duration);
    Ok(())
}

/// Resolve the B06 request against the selected reconstruction strategy and
/// the wire legacy threshold. Shared by validation, the classification stage,
/// the receipt, and the configuration-only applicability export so no two
/// surfaces can disagree.
pub fn resolve_maximum_duration(
    options: &PipelineV2Options,
) -> Result<
    (
        b06::MaximumDurationConfig,
        b06::MaximumDurationApplicability,
    ),
    b06::MaximumDurationRefusalReason,
> {
    b06::resolve_maximum_duration(
        &options.maximum_duration,
        options.episode_reconstruction_strategy,
        options.long_duration_threshold_ns,
    )
}

/// The row-affecting B06 stage for an already-validated request. Every
/// public execution path runs `validate_pipeline_v2_options` first; a request
/// that fails here can only reach this helper through a test that skipped
/// validation, and it then falls back to omission rather than panicking.
pub fn maximum_duration_row_stage(options: &PipelineV2Options) -> b06::MaximumDurationRowStage {
    resolve_maximum_duration(options)
        .map(|(config, _)| config.row_stage())
        .unwrap_or_else(|_| b06::MaximumDurationRowStage::omitted())
}

/// B09. Convert a seconds-valued polling option to integer nanoseconds once,
/// so every downstream comparison is integer arithmetic rather than repeated
/// binary64 multiplication. Non-finite or non-positive values floor to zero,
/// which `sample_polled_timeline` treats as "no grid", emitting nothing rather
/// than dividing by it.
pub(super) fn seconds_to_ns_floor(seconds: f64) -> i64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    let ns = seconds * 1_000_000_000.0;
    if ns >= i64::MAX as f64 {
        i64::MAX
    } else {
        ns as i64
    }
}

/// Convert the existing seconds-valued browser option once, then compare raw
/// episode durations using integer nanoseconds. A zero floor disables B04.
/// All public execution paths run `validate_pipeline_v2_options` before this
/// helper is reached; the fallible conversion remains shared so validation and
/// classification cannot disagree about representability.
pub(super) fn minimum_duration_threshold_ns(seconds: f64) -> Option<i64> {
    checked_minimum_duration_threshold_ns(seconds)
        .ok()
        .flatten()
}

/// Which published rule groups already-reconstructed app episodes into usage
/// sessions.
///
/// A THIRD axis, crossed with the reconstruction rule rather than part of it.
/// Ahmed et al. (2023) and Okoshi et al. (2025) reconstruct episodes
/// identically — they share `ForegroundBackgroundPairing` — and differ only
/// here and on micro-use. Keeping grouping separate is what lets one arm carry
/// both papers without either citation becoming false.
///
/// Every policy answers the same question with a different constant: how big a
/// gap between one episode's end and the next one's start starts a new session.
/// What is NOT shared, and what the variants exist to keep straight, is the
/// comparison operator and whether anything besides the gap breaks a session.
///
/// `None` is the default, so with this option unset no session column is
/// emitted and golden output is byte-identical to before the axis existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SessionGroupingPolicy {
    /// Do not group. No `usage_session_id` column is produced.
    #[default]
    None,
    /// Church et al. (2015), 5 s. Reported second-hand: the value is quoted by
    /// van Berkel et al. (2016) in their survey of competing definitions, and
    /// this repository has not read Church's own statement of it. Treated as
    /// the weakest-provenance member of the set for exactly that reason.
    ChurchFiveSeconds,
    /// Schoedel et al. (2024, Computers in Human Behavior,
    /// doi:10.1016/j.chb.2023.107977), from the deposited
    /// `SmartphoneUsage_Wellbeing` preprocessing code. That code computes the
    /// previous-session stop to next-session start gap and joins only when
    /// `diff.to.previous < 5`. This needs its own arm beside `church_5s`:
    /// both use five seconds, but here equality explicitly starts a new
    /// session.
    SmartphoneWellbeingStrictLtFiveSeconds,
    /// große Deters et al. (2026), 10 s. Stated as a merge — "sessions within
    /// ten seconds are merged" — which is the same cut expressed from the other
    /// side, so it joins the set rather than needing its own mechanism.
    GrosseDetersTenSeconds,
    /// Ross et al. (2023, 2025), 15 s, and the only member with a second
    /// clause: a session also ends when the next record's package differs,
    /// regardless of the gap. Their released preprocessing reads a POLLED
    /// foreground stream, where a package change between samples is the only
    /// evidence of a switch; on Chronicle's event stream the switch is
    /// explicit, so this clause is preserved as published and not silently
    /// dropped as redundant.
    RossFifteenSeconds,
    /// Legacy `van_berkel_45s` identifier: app-episode gaps <=45 s join,
    /// `>45 s` split. Not van Berkel's source-exact Constant Classifier:
    /// that paper classifies device-session gaps as continuous iff Gap<T,
    /// new otherwise, against participant objective-continuation labels.
    /// Its 45 s recommendation is sample/objective-specific and explicitly
    /// not generalizable. Later citations do not establish identical inputs,
    /// pipeline stages or equality behavior. Preserve this compatibility
    /// behavior without promoting it as an exact paper method.
    VanBerkelFortyFiveSeconds,
    /// Zerrer et al. (2026), 60 s. Prose and code disagree in the source:
    /// `readme.qmd:644` says "at least 60 seconds" while `:653` is
    /// `time_gap > 60`. The code wins, because the code is what produced their
    /// published numbers.
    ZerrerSixtySeconds,
    /// Peng & Zhu (2020, JCMC, 10.1093/jcmc/zmz029), the only individualized
    /// member of the set: "An individualized threshold, which is the median
    /// score of a user's inter-app intervals, is adopted for each user. If the
    /// inter-app interval is smaller than the median inter-app interval of a
    /// user, then the two apps are grouped into a mobile session; otherwise,
    /// they are assigned to two distinct sessions." There is no constant to
    /// quote: the threshold is the median of each partition's own
    /// previous-stop → next-start intervals, derived inside
    /// `assign_usage_session_ids` (see `doubled_median_gap_ns`). "Smaller
    /// than … joins" makes a gap exactly equal to the median start a new
    /// session, so this arm shares Ross's boundary behaviour but not his
    /// package clause.
    PengZhu2020ParticipantMedian,
}

impl SessionGroupingPolicy {
    /// Every policy, so a test that must cover all of them fails loudly when a
    /// new one is added rather than quietly skipping it.
    pub const ALL: &'static [Self] = &[
        Self::None,
        Self::ChurchFiveSeconds,
        Self::SmartphoneWellbeingStrictLtFiveSeconds,
        Self::GrosseDetersTenSeconds,
        Self::RossFifteenSeconds,
        Self::VanBerkelFortyFiveSeconds,
        Self::ZerrerSixtySeconds,
        Self::PengZhu2020ParticipantMedian,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ChurchFiveSeconds => "church_5s",
            Self::SmartphoneWellbeingStrictLtFiveSeconds => "smartphone_wellbeing_strict_lt_5s",
            Self::GrosseDetersTenSeconds => "grosse_deters_10s",
            Self::RossFifteenSeconds => "ross_15s",
            Self::VanBerkelFortyFiveSeconds => "van_berkel_45s",
            Self::ZerrerSixtySeconds => "zerrer_60s",
            Self::PengZhu2020ParticipantMedian => "peng_zhu_2020_participant_median",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "church_5s" => Self::ChurchFiveSeconds,
            "smartphone_wellbeing_strict_lt_5s" => Self::SmartphoneWellbeingStrictLtFiveSeconds,
            "grosse_deters_10s" => Self::GrosseDetersTenSeconds,
            "ross_15s" => Self::RossFifteenSeconds,
            "van_berkel_45s" => Self::VanBerkelFortyFiveSeconds,
            "zerrer_60s" => Self::ZerrerSixtySeconds,
            "peng_zhu_2020_participant_median" => Self::PengZhu2020ParticipantMedian,
            _ => Self::None,
        }
    }

    /// The gap threshold this policy compares against. The fixed arms carry
    /// their published constant; Peng & Zhu derive each partition's median
    /// instead, so no value can be named here and the walk supplies it.
    pub fn gap_threshold(self) -> Option<SessionGapThreshold> {
        let seconds = match self {
            Self::None => return None,
            Self::PengZhu2020ParticipantMedian => {
                return Some(SessionGapThreshold::PartitionMedian)
            }
            Self::ChurchFiveSeconds | Self::SmartphoneWellbeingStrictLtFiveSeconds => 5,
            Self::GrosseDetersTenSeconds => 10,
            Self::RossFifteenSeconds => 15,
            Self::VanBerkelFortyFiveSeconds => 45,
            Self::ZerrerSixtySeconds => 60,
        };
        Some(SessionGapThreshold::FixedNs(seconds * 1_000_000_000))
    }

    /// Whether a gap exactly equal to the threshold starts a new session.
    ///
    /// The SmartphoneUsage_Wellbeing code does (`diff.to.previous < 5`), as do
    /// Ross and Peng & Zhu — their "smaller than the median … joins" leaves
    /// equality on the splitting side. Every other source states or ships a
    /// strict `>`, and this method exists so that difference is a value rather
    /// than a comment nobody reads.
    pub fn boundary_gap_starts_new_session(self) -> bool {
        matches!(
            self,
            Self::SmartphoneWellbeingStrictLtFiveSeconds
                | Self::RossFifteenSeconds
                | Self::PengZhu2020ParticipantMedian
        )
    }

    /// Whether a change of foreground package also ends a session.
    pub fn package_change_ends_session(self) -> bool {
        matches!(self, Self::RossFifteenSeconds)
    }
}

/// What `assign_usage_session_ids` compares each gap against.
///
/// The fixed arms compare against a published constant, known before any row
/// is read. Peng & Zhu (2020) compare against the median of the partition's
/// own intervals, which exists only once the partition is assembled — so the
/// policy names the rule here and the walk derives the number per partition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionGapThreshold {
    FixedNs(i64),
    PartitionMedian,
}

/// Which endpoint a session gap is measured FROM.
///
/// Every published grouping rule in `SessionGroupingPolicy` is stated over a
/// stream in which episodes do not overlap: a polled foreground sample, or a
/// table already reduced to one app at a time. Chronicle's event stream is not
/// that stream. `segment_concurrent_usage` only splits overlapping episodes
/// when `model_concurrent_usage` is on, and that option defaults OFF, so on a
/// default run an episode nested inside a longer one reaches grouping intact.
///
/// The published reading — `PreviousEpisodeStop` — then measures the gap from
/// whichever episode happens to start last, which for a nested pair is the
/// SHORT one. A 30 min episode with a 1 min episode nested at its start,
/// followed by a third episode 20 s after the long one ends, is measured as a
/// 28 min 20 s gap and split, although the participant's screen was covered
/// continuously throughout. Verified against
/// `assign_usage_session_ids`: `[Some(0), Some(0), Some(1)]`.
///
/// `SessionRunningMaximumStop` measures instead from the furthest stop seen so
/// far in the session, which is the coverage envelope the rules describe in
/// prose. It is opt-in because it is NOT what any of the published rules ship;
/// choosing it is a stated departure from them, and the default keeps every
/// published citation exactly true.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SessionGapBasis {
    /// The immediately preceding episode's stop, in start order. What every
    /// published rule ships, and what keeps output byte-identical.
    #[default]
    PreviousEpisodeStop,
    /// The maximum stop of every episode already placed in this session — the
    /// coverage envelope. An episode nested inside a longer one can no longer
    /// pull the measuring point backwards.
    SessionRunningMaximumStop,
}

impl SessionGapBasis {
    pub const ALL: &'static [Self] = &[Self::PreviousEpisodeStop, Self::SessionRunningMaximumStop];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::PreviousEpisodeStop => "previous_episode_stop_v1",
            Self::SessionRunningMaximumStop => "session_running_maximum_stop_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "session_running_maximum_stop_v1" => Self::SessionRunningMaximumStop,
            _ => Self::PreviousEpisodeStop,
        }
    }
}

/// Which rows are numbered as ONE sequence of sessions.
///
/// `assign_usage_session_ids` partitions by `participant_id` alone. Every other
/// dimension of the row's classification key — `study_id`, `username` — varies
/// WITHIN a participant in this pipeline's own model:
///
/// * `username` is a raw Chronicle column and is per-row. `attribute_person`
///   retypes a shared device's non-target rows to `NON_TARGET_CHILD_APP_USAGE`,
///   which `is_culverhouse_usage_row` then excludes — but that runs only when a
///   device-sharing file is configured. Without one, a sibling's episodes stay
///   `APP_USAGE` and are numbered into the target child's sequence.
/// * `study_id` is part of the published classification key
///   (`classification:study_id,participant_id,possible_device_model,username,`)
///   and nothing constrains one export to a single study.
///
/// The failure is not a spurious break but a MISSED one: a foreign row landing
/// inside a participant's silence bridges it, and the participant's session is
/// never split. Verified: three episodes where study A is silent for 950 s and
/// study B's episode sits inside that silence number `[Some(0), Some(0),
/// Some(0)]` under a 60 s rule.
///
/// The scopes nest — participant ⊂ +study ⊂ +person — so widening the scope can
/// only ever split a sequence further, never merge two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SessionBoundaryScope {
    /// `participant_id` alone. What ships today.
    #[default]
    Participant,
    /// `(study_id, participant_id)`. A participant id reused across studies no
    /// longer bridges either study's silences.
    ParticipantAndStudy,
    /// `(study_id, participant_id, username)`. Also separates the people on a
    /// shared device when no device-sharing file has reclassified them.
    ParticipantStudyAndPerson,
}

impl SessionBoundaryScope {
    pub const ALL: &'static [Self] = &[
        Self::Participant,
        Self::ParticipantAndStudy,
        Self::ParticipantStudyAndPerson,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Participant => "participant_v1",
            Self::ParticipantAndStudy => "participant_and_study_v1",
            Self::ParticipantStudyAndPerson => "participant_study_and_person_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "participant_and_study_v1" => Self::ParticipantAndStudy,
            "participant_study_and_person_v1" => Self::ParticipantStudyAndPerson,
            _ => Self::Participant,
        }
    }

    /// Whether this scope reads `study_id`.
    pub fn reads_study(self) -> bool {
        !matches!(self, Self::Participant)
    }

    /// Whether this scope reads `username`.
    pub fn reads_person(self) -> bool {
        matches!(self, Self::ParticipantStudyAndPerson)
    }
}

/// Which raw event types survive into reconstruction.
///
/// A FOURTH axis, upstream of the reconstruction rule rather than part of it.
/// Every published rule reads "the next event", and which rows count as an event
/// is a separate published decision that changes the answer without changing the
/// rule — slice A's own synthesis says the result "depends critically on which
/// event types survive filtering".
///
/// Chronicle exports labels, not numeric `eventType`s, so each set below is the
/// intersection of a paper's numeric set with the labels Chronicle emits, the
/// same mapping `GESIS_START_EVENTS` already performs. A numeric type Chronicle
/// never exports is ABSENT FROM THE INPUT, not dropped by the rule; that
/// distinction is why the sets are written as labels rather than numbers.
///
/// `None` is the default and retains everything, so golden output with the
/// option unset is byte-identical to before this enum existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum EventRetentionSet {
    /// Retain every row. The production path.
    #[default]
    None,
    /// Parry & Toth (2025): types 1, 15, 16, 17, 18, 26, 27.
    ///
    /// Type 2 (Activity Paused) is NOT in their set: an app handover closes
    /// through the next type 1 instead. This is a real difference from
    /// `EpisodeReconstructionStrategy::ParryTothForwardPairing`, which ports the
    /// Chronicle ADAPTATION in `.refs/chronicle-android-preprocessing`
    /// (`source_dataset = "ParryToth-adapted"`) and does close on a same-package
    /// type 2 while closing on only type 16 among the screen/device types. The
    /// adaptation and the paper disagree; both are selectable, and neither is
    /// silently substituted for the other.
    ParryToth,
    /// Geyer, Ellis, Shaw & Davidson Usage Logger: types 1, 2, 7, 26, 27.
    /// Type 7 is `USER_INTERACTION`, which Chronicle does export.
    UsageLogger,
    /// Toth & Trifonova (2021), app level: starts at 1, ends at 2, 17 or 26.
    /// Their device level uses a different pair of sets and is not this axis.
    TothTrifonova,
    /// The bare foreground/background pair, types 1 and 2.
    ///
    /// It is a strict subset of `UsageLogger` and `TothTrifonova`, but NOT of
    /// `ParryToth`, which is the one set that drops type 2. An earlier version
    /// of this comment called it "the strict subset every other set contains",
    /// which is false in exactly the direction the axis exists to expose.
    ForegroundBackgroundOnly,
}

impl EventRetentionSet {
    pub const ALL: [Self; 5] = [
        Self::None,
        Self::ParryToth,
        Self::UsageLogger,
        Self::TothTrifonova,
        Self::ForegroundBackgroundOnly,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ParryToth => "parry_toth_7",
            Self::UsageLogger => "usage_logger_5",
            Self::TothTrifonova => "toth_trifonova_app",
            Self::ForegroundBackgroundOnly => "foreground_background_only",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "parry_toth_7" => Self::ParryToth,
            "usage_logger_5" => Self::UsageLogger,
            "toth_trifonova_app" => Self::TothTrifonova,
            "foreground_background_only" => Self::ForegroundBackgroundOnly,
            _ => Self::None,
        }
    }

    /// Whether this set keeps `interaction_type`.
    ///
    /// The `Filtered App *` labels are Chronicle's own marking of the same
    /// underlying type on a filtered package, so they are kept or dropped with
    /// the type they carry — dropping them separately would make the retention
    /// set depend on the filter file.
    pub fn retains(self, interaction_type: &str) -> bool {
        // These reference the file's existing label lists rather than
        // re-spelling them. Copies drifted immediately: the first version of
        // this function spelled type 17 as `["Keyguard Shown"]` and so dropped
        // `Screen Interactive/Keyguard Shown`, the fused label that carries a
        // real type-17 event, from every set that keeps 17 but not 15.
        const RESUMED: &[&str] = FOREGROUND_EVENTS;
        const PAUSED: &[&str] = &["Activity Paused", "Filtered App Paused"];
        const SCREEN_ON: &[&str] = SCREEN_START_EVENTS;
        const SCREEN_OFF: &[&str] = SCREEN_STOP_EVENTS;
        const KEYGUARD_SHOWN: &[&str] = LOCK_SCREEN_EVENTS;
        const KEYGUARD_HIDDEN: &[&str] = &["Keyguard Hidden"];
        const SHUTDOWN: &[&str] = &["Device Shutdown"];
        const STARTUP: &[&str] = &["Device Startup"];
        const USER_INTERACTION: &[&str] = &["User Interaction"];

        let in_any = |sets: &[&[&str]]| sets.iter().any(|set| set.contains(&interaction_type));
        match self {
            Self::None => true,
            // 1, 15, 16, 17, 18, 26, 27
            Self::ParryToth => in_any(&[
                RESUMED,
                SCREEN_ON,
                SCREEN_OFF,
                KEYGUARD_SHOWN,
                KEYGUARD_HIDDEN,
                SHUTDOWN,
                STARTUP,
            ]),
            // 1, 2, 7, 26, 27
            Self::UsageLogger => in_any(&[RESUMED, PAUSED, USER_INTERACTION, SHUTDOWN, STARTUP]),
            // 1, 2, 17, 26
            Self::TothTrifonova => in_any(&[RESUMED, PAUSED, KEYGUARD_SHOWN, SHUTDOWN]),
            // 1, 2
            Self::ForegroundBackgroundOnly => in_any(&[RESUMED, PAUSED]),
        }
    }
}

/// Which published policy bounds the quality of already-reconstructed
/// intervals.
///
/// This is a **different axis** from [`EpisodeReconstructionStrategy`].
/// Reconstruction decides where an episode starts and ends. This decides what
/// to do about an episode that is already reconstructed and is implausible.
/// Culverhouse never redefines episodes — see
/// `docs/workflow/prior-art-vocabulary.md`, "Never redefines episodes; bounds
/// implausibility, transparently" — so binding it as a fourth reconstruction
/// variant would have misstated what the tool does.
///
/// `None` is the default and the production path. Selecting anything else is
/// opt-in, so golden output with the option unset is byte-identical to before
/// this enum existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum IntervalQualityPolicy {
    /// This engine's own interval cleaning: filtered-package timing is blanked,
    /// selected interaction types are removed, zero-duration rows are dropped.
    #[default]
    None,
    /// Culverhouse `chronicle-preprocessed-cleaning` trim-and-log. Adjacent
    /// same-app rows collapse, bad-app rows are capped rather than blanked,
    /// implausibly long rows are truncated to the bad-app cap, and every
    /// mutation is stamped in-row. Nothing is deleted.
    CulverhouseTrimAndLog,
}

impl IntervalQualityPolicy {
    /// Every policy, in declaration order. The other two axes already carry an
    /// `ALL`; this one did not, which is why the enum/ontology agreement test
    /// could only ever cover reconstruction.
    pub const ALL: [Self; 2] = [Self::None, Self::CulverhouseTrimAndLog];

    /// The canonical ontology id. Kept as a method rather than a serde rename
    /// so the wire format of persisted options is not coupled to the ontology
    /// string by accident.
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::CulverhouseTrimAndLog => "culverhouse_trim_and_log",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "culverhouse_trim_and_log" => Self::CulverhouseTrimAndLog,
            _ => Self::None,
        }
    }

    /// Whether the fused annotation walks may blank filtered-package timing
    /// inline. Culverhouse caps those rows instead of blanking them, so under
    /// that policy the inline blanking must not run; the dispatch function owns
    /// the whole step.
    pub fn blanks_filtered_timing(self) -> bool {
        matches!(self, Self::None)
    }
}

/// Which published rule turns raw `UsageEvents` rows into app episodes.
///
/// These are the `ReconstructionStrategyId` permissible values declared in
/// `web/schema/chronicle-research-ontology.linkml.yaml`. Forward pairing is a
/// distinct algorithm, not a knob setting on the fused matcher: it reads a
/// different subset of the event vocabulary and cannot be reached by any
/// combination of `MatchOptions`.
///
/// `FusedMatcher` is the default and the production path. Selecting anything
/// else is opt-in, so golden output with the option unset is byte-identical to
/// before this enum existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum EpisodeReconstructionStrategy {
    /// This engine's fused open/close matcher.
    #[default]
    FusedMatcher,
    /// Parry & Toth (2025) start-only bracket-first forward pairing.
    ParryTothForwardPairing,
    /// EYES complement-based segmentation
    /// (`ACTIVE = not(SHUTDOWN or IDLE or GAP or GLANCE)`).
    EyesComplement,
    /// GESIS / Zerrer start-stop repair: nearest same-package stop, else the
    /// next event of any kind, else a fixed timeout cut.
    GesisStartStopRepair,
    /// Plain foreground-to-background subtraction, with no repair of any kind:
    /// each `Activity Resumed` is closed by the next `Activity Paused` of the
    /// same package, and a start with no such pause yields no episode.
    ///
    /// One arm, two papers. Ahmed et al. (2023) read `getEventType() == 1` and
    /// `== 2` and subtract (`.refs/osf-ahmed-2023`, OSF `sxjp6`); Okoshi et al.
    /// (2025) pair `ACTIVITY_RESUMED` with `ACTIVITY_PAUSED`. On Chronicle's
    /// vocabulary those are the same two event types, so the two published
    /// reconstructions are the same rule and it would be padding to list them
    /// twice. What differs between the papers is what they do afterwards —
    /// Ahmed's 45-second sessions and micro/review/engage classes, Okoshi's
    /// five-second micro-use label — and those live on the session-grouping and
    /// micro-use axes.
    ForegroundBackgroundPairing,
    /// Draxler et al. (2021): an episode ends at whichever comes first of its
    /// own package backgrounding, the screen going off, or ten minutes of
    /// inactivity. The only rule here that lets a screen event close an APP
    /// episode — every other rule reads screen state for context at most.
    DraxlerInterruptionAware,
    /// Morrison et al. (2018): an app use ends on a handover to another app or
    /// on the screen locking — but only if the screen STAYS off for thirty
    /// seconds. A shorter lock is a pocket-check, and the use continues through
    /// it. Coming back to the same app after a lock that did count starts a new
    /// use rather than resuming the old one.
    ///
    /// This is the only rule here that has to look FORWARD past a closing event
    /// before it can decide the event closed anything, which is why it cannot
    /// be expressed as a variation of `DraxlerInterruptionAware` — Draxler ends
    /// at the screen-off itself, unconditionally.
    ///
    /// The thirty seconds is inherited, by name and value, from Böhmer et al.
    /// (2011); Morrison's own contribution is the 21.4-second micro-use
    /// breakpoint, which lives on the duration-classification axis, not here.
    MorrisonLockTolerant,
    /// Schoedel et al. (2026) published-prose reconstruction over immutable
    /// B05 screen-interval evidence. The full deposited OSF workflow is a
    /// separate, refusal-only applicability arm because Chronicle lacks its
    /// required input tables and state columns.
    #[serde(rename = "schoedel_2026_app_within_screen_prose_v1")]
    Schoedel2026AppWithinScreenProseV1,
}

impl EpisodeReconstructionStrategy {
    /// Every rule, so a test that must cover all of them fails to compile — or
    /// fails loudly — when a new one is added rather than quietly skipping it.
    pub const ALL: &'static [Self] = &[
        Self::FusedMatcher,
        Self::ParryTothForwardPairing,
        Self::EyesComplement,
        Self::GesisStartStopRepair,
        Self::ForegroundBackgroundPairing,
        Self::DraxlerInterruptionAware,
        Self::MorrisonLockTolerant,
        Self::Schoedel2026AppWithinScreenProseV1,
    ];

    /// The canonical ontology id. Kept as a method rather than a serde rename
    /// so the wire format of persisted options is not coupled to the ontology
    /// string by accident.
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::FusedMatcher => "fused_matcher",
            Self::ParryTothForwardPairing => "parry_toth_forward_pairing",
            Self::EyesComplement => "eyes_complement",
            Self::GesisStartStopRepair => "gesis_start_stop_repair",
            Self::ForegroundBackgroundPairing => "foreground_background_pairing",
            Self::DraxlerInterruptionAware => "draxler_interruption_aware",
            Self::MorrisonLockTolerant => "morrison_lock_tolerant",
            Self::Schoedel2026AppWithinScreenProseV1 => "schoedel_2026_app_within_screen_prose_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "parry_toth_forward_pairing" => Self::ParryTothForwardPairing,
            "eyes_complement" => Self::EyesComplement,
            "gesis_start_stop_repair" => Self::GesisStartStopRepair,
            "foreground_background_pairing" => Self::ForegroundBackgroundPairing,
            "draxler_interruption_aware" => Self::DraxlerInterruptionAware,
            "morrison_lock_tolerant" => Self::MorrisonLockTolerant,
            "schoedel_2026_app_within_screen_prose_v1" => Self::Schoedel2026AppWithinScreenProseV1,
            _ => Self::FusedMatcher,
        }
    }
}

/// Which retained event kinds are eligible to open an app episode.
///
/// This is an axis independent of reconstruction: the selected strategy still
/// owns pairing, closers, repair, and unmatched-open behavior. The compatibility
/// default deliberately delegates to each strategy's pre-B02 implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenerSet {
    #[default]
    StrategyDefined,
    ActivityResumedOnly,
    GesisAppScopedStarts,
}

impl OpenerSet {
    pub const ALL: [Self; 3] = [
        Self::StrategyDefined,
        Self::ActivityResumedOnly,
        Self::GesisAppScopedStarts,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::StrategyDefined => "strategy_defined",
            Self::ActivityResumedOnly => "activity_resumed_only",
            Self::GesisAppScopedStarts => "gesis_app_scoped_starts",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "activity_resumed_only" => Self::ActivityResumedOnly,
            "gesis_app_scoped_starts" => Self::GesisAppScopedStarts,
            _ => Self::StrategyDefined,
        }
    }

    /// Eligibility for explicit arms only. `StrategyDefined` is resolved by
    /// the strategy dispatcher because its native opener differs by strategy.
    pub fn explicit_eligible(self, interaction_type: &str) -> bool {
        match self {
            Self::StrategyDefined => false,
            Self::ActivityResumedOnly => FOREGROUND_EVENTS.contains(&interaction_type),
            Self::GesisAppScopedStarts => matches!(
                interaction_type,
                "Activity Resumed"
                    | "Filtered App Resumed"
                    | "Continue Previous Day"
                    | "Standby Bucket Changed"
                    | "Slice Pinned App"
                    | "Foreground Service Start"
                    | "Rollover Foreground Service"
            ),
        }
    }

    pub fn applicability(self, strategy: EpisodeReconstructionStrategy) -> OpenerSetApplicability {
        use EpisodeReconstructionStrategy as Strategy;
        use OpenerStrategyRelation as Relation;
        let (effective, relation, refusal_reason) = match (self, strategy) {
            (Self::StrategyDefined, _) => (Some(self), Relation::BaselineNative, None),
            (Self::ActivityResumedOnly, Strategy::FusedMatcher) => {
                (Some(self), Relation::BaselineEquivalent, None)
            }
            (Self::ActivityResumedOnly, Strategy::GesisStartStopRepair) => {
                (Some(self), Relation::ControlledDerivative, None)
            }
            (Self::ActivityResumedOnly, _) => (Some(self), Relation::SourceEquivalent, None),
            (Self::GesisAppScopedStarts, Strategy::EyesComplement) => (
                None,
                Relation::Refused,
                Some(OpenerSetRefusalReason::EyesRequiresLifecycleTriplets),
            ),
            (Self::GesisAppScopedStarts, Strategy::GesisStartStopRepair) => {
                (Some(self), Relation::SourceAlignedAdapter, None)
            }
            (Self::GesisAppScopedStarts, _) => (Some(self), Relation::ControlledDerivative, None),
        };
        OpenerSetApplicability {
            requested: self,
            effective,
            relation,
            refusal_reason,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenerStrategyRelation {
    BaselineNative,
    BaselineEquivalent,
    SourceEquivalent,
    SourceAlignedAdapter,
    ControlledDerivative,
    Refused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenerSetRefusalReason {
    EyesRequiresLifecycleTriplets,
}

impl OpenerSetRefusalReason {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::EyesRequiresLifecycleTriplets => "eyes_requires_lifecycle_triplets",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerSetApplicability {
    pub requested: OpenerSet,
    pub effective: Option<OpenerSet>,
    pub relation: OpenerStrategyRelation,
    pub refusal_reason: Option<OpenerSetRefusalReason>,
}

impl OpenerSetApplicability {
    pub fn is_executable(&self) -> bool {
        self.relation != OpenerStrategyRelation::Refused
    }
}

/// Configuration-only preflight for native and WASM callers. Both inputs use
/// the same safe unknown fallbacks as pipeline execution.
pub fn opener_set_applicability(
    opener_set_id: &str,
    reconstruction_strategy_id: &str,
) -> OpenerSetApplicability {
    OpenerSet::from_canonical_id(opener_set_id).applicability(
        EpisodeReconstructionStrategy::from_canonical_id(reconstruction_strategy_id),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UsageSessionMode {
    NoUsage,
    AppUsage,
    ScreenUsage,
    AppAndScreenUsage,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PipelineV2SupportFiles<'a> {
    pub filter_csv: &'a [u8],
    pub apps_forcing_csv: &'a [u8],
    pub background_apps_csv: &'a [u8],
    pub codebook_csv: &'a [u8],
    pub study_dates_csv: &'a [u8],
    pub device_sharing_csv: &'a [u8],
    pub survey_attribution_csv: &'a [u8],
    pub enrolled_devices_csv: &'a [u8],
    /// Exact bytes of the optional, immutable capability-evidence CSV. The
    /// Chronicle baseline never parses or binds this role.
    pub input_capability_evidence_csv: &'a [u8],
    /// Runtime-authoritative SHA-256(JCS(PipelineV2OptionsJson)). Direct kernel
    /// callers may omit it and receive an explicitly labeled component digest
    /// instead; the two identities are never presented as equivalent.
    pub verified_request_options_digest: Option<&'a str>,
    /// Optional runtime agreement witnesses. The kernel recomputes both from
    /// exact sidecar bytes and rejects disagreement without echoing values.
    pub verified_input_capability_evidence_artifact_digest: Option<&'a str>,
    pub verified_input_capability_evidence_assignment_digest: Option<&'a str>,
    /// Executor-supplied participant partition metadata. These identifiers
    /// describe streams split across input artifacts; they are not browser
    /// options, are not part of request JCS, and are never inferred from a
    /// participant's absence in this artifact.
    pub fragmented_participant_ids: &'a [String],
}

/// A request value together with whether its key was present in the original
/// JSON object. Missing values receive a safe compatibility default but remain
/// omitted when the typed request is serialized again, preserving exact JCS
/// and receipt identity. An explicitly supplied default serializes normally.
#[derive(Debug, Clone, PartialEq)]
pub struct PresenceTrackedOption<T> {
    pub(super) value: T,
    pub(super) explicit: bool,
}

impl<T> PresenceTrackedOption<T> {
    pub(super) fn omitted(value: T) -> Self {
        Self {
            value,
            explicit: false,
        }
    }

    pub(super) fn is_omitted(&self) -> bool {
        !self.explicit
    }

    pub(super) fn into_parts(self) -> (T, bool) {
        (self.value, self.explicit)
    }

    #[cfg(test)]
    pub(super) fn value(&self) -> &T {
        &self.value
    }
}

impl<T: serde::Serialize> serde::Serialize for PresenceTrackedOption<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.value.serialize(serializer)
    }
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for PresenceTrackedOption<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Self {
            value: T::deserialize(deserializer)?,
            explicit: true,
        })
    }
}

/// A closed option vocabulary: the enum's arms are exactly the permissible
/// values of one contract enum, and `REQUEST_FIELD` is the one request key it
/// types.
///
/// The options document is the request boundary, so this is where an unknown
/// value is refused. Every enum axis used to read an unrecognized spelling as
/// its default, which ran a computation the researcher never selected and
/// reported no error; a misspelled `screen_gating_rule` credited under the
/// compatibility rule. The browser sanitizes stored settings back into the
/// vocabulary before it builds a request, so a refusal here means the request
/// itself is wrong.
pub trait OptionVocabulary: Sized + Copy + 'static {
    const REQUEST_FIELD: &'static str;

    fn arms() -> &'static [Self];

    fn arm_id(self) -> &'static str;

    fn parse_request_value(value: &str) -> Result<Self, String> {
        Self::arms()
            .iter()
            .copied()
            .find(|arm| arm.arm_id() == value)
            .ok_or_else(|| {
                unknown_option_value(
                    Self::REQUEST_FIELD,
                    value,
                    Self::arms().iter().map(|arm| arm.arm_id()),
                )
            })
    }
}

/// `unknown_<field>: "<value>" is not one of: a, b`. The token prefix matches
/// the existing `unknown_usage_session_mode` refusal; the echoed value is
/// bounded so a hostile request cannot inflate the message.
pub(super) fn unknown_option_value<'a>(
    field: &str,
    value: &str,
    permitted: impl Iterator<Item = &'a str>,
) -> String {
    const MAX_ECHO_CHARS: usize = 64;
    let echoed: String = value.chars().take(MAX_ECHO_CHARS).collect();
    let ellipsis = if value.chars().count() > MAX_ECHO_CHARS { "…" } else { "" };
    format!(
        "unknown_{field}: {echoed:?}{ellipsis} is not one of: {}",
        permitted.collect::<Vec<_>>().join(", ")
    )
}

macro_rules! option_vocabulary {
    ($($vocabulary:ty => $field:literal, $arms:expr;)*) => {
        $(
            impl OptionVocabulary for $vocabulary {
                const REQUEST_FIELD: &'static str = $field;

                fn arms() -> &'static [Self] {
                    $arms
                }

                fn arm_id(self) -> &'static str {
                    self.canonical_id()
                }
            }
        )*
    };
}

option_vocabulary! {
    MicroUseClassificationPolicy => "micro_use_classification_policy", &MicroUseClassificationPolicy::ALL;
    ScreenGatingRule => "screen_gating_rule", &ScreenGatingRule::ALL;
    DayBoundaryAttribution => "day_boundary_attribution", &DayBoundaryAttribution::ALL;
    PackageExclusionPreset => "package_exclusion_preset", &PackageExclusionPreset::ALL;
    NotificationProxyRule => "notification_proxy_rule", &NotificationProxyRule::ALL;
    PolledEmulationMethod => "polled_emulation_method", &PolledEmulationMethod::ALL;
    MinimumDurationComparator => "minimum_duration_comparator", &MinimumDurationComparator::ALL;
    MinimumDurationDisposition => "minimum_duration_disposition", &MinimumDurationDisposition::ALL;
    SessionGroupingPolicy => "session_grouping_policy", SessionGroupingPolicy::ALL;
    SessionGapBasis => "session_gap_basis", SessionGapBasis::ALL;
    SessionBoundaryScope => "session_boundary_scope", SessionBoundaryScope::ALL;
    EventRetentionSet => "event_retention_set", &EventRetentionSet::ALL;
    IntervalQualityPolicy => "interval_quality_policy", &IntervalQualityPolicy::ALL;
    EpisodeReconstructionStrategy => "episode_reconstruction_strategy", EpisodeReconstructionStrategy::ALL;
    OpenerSet => "opener_set", &OpenerSet::ALL;
    FilterMatchField => "filter_match_field", &FilterMatchField::ALL;
    IntervalExpansionMethod => "interval_expansion_method", &IntervalExpansionMethod::ALL;
    ScreenSessionClassificationPolicy => "screen_session_classification_policy", &ScreenSessionClassificationPolicy::ALL;
    ScreenSessionMaximumDurationDisposition => "screen_session_maximum_duration_disposition", &ScreenSessionMaximumDurationDisposition::ALL;
    LockedScreenAudioDisposition => "locked_screen_audio_disposition", &LockedScreenAudioDisposition::ALL;
    InteractionTypeRemovalMode => "interaction_type_removal_mode", &InteractionTypeRemovalMode::ALL;
}

/// `deserialize_with` for a plain-string vocabulary field.
pub(super) fn deserialize_vocabulary<'de, V, D>(deserializer: D) -> Result<String, D::Error>
where
    V: OptionVocabulary,
    D: serde::Deserializer<'de>,
{
    let value = <String as serde::Deserialize>::deserialize(deserializer)?;
    V::parse_request_value(&value).map_err(serde::de::Error::custom)?;
    Ok(value)
}

/// `deserialize_with` for a presence-tracked vocabulary field. A present key
/// is explicit, exactly as the blanket `PresenceTrackedOption` impl records it.
pub(super) fn deserialize_tracked_vocabulary<'de, V, D>(
    deserializer: D,
) -> Result<PresenceTrackedOption<String>, D::Error>
where
    V: OptionVocabulary,
    D: serde::Deserializer<'de>,
{
    Ok(PresenceTrackedOption {
        value: deserialize_vocabulary::<V, D>(deserializer)?,
        explicit: true,
    })
}

/// The `AggregateShape` contract enum. The kernel keeps the field a string,
/// and an unknown spelling used to lay the summaries out wide.
pub const AGGREGATE_SHAPES: [&str; 2] = ["wide", "long"];

fn deserialize_closed_string<'de, D>(
    deserializer: D,
    field: &str,
    permitted: &[&str],
) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <String as serde::Deserialize>::deserialize(deserializer)?;
    if permitted.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom(unknown_option_value(
            field,
            &value,
            permitted.iter().copied(),
        )))
    }
}

pub(super) fn deserialize_timezone_handling<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_closed_string(deserializer, "timezone_handling", &super::TIMEZONE_HANDLING_MODES)
}

pub(super) fn deserialize_aggregate_shape<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_closed_string(deserializer, "aggregate_shape", &AGGREGATE_SHAPES)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// The enclosing `RuntimeRequest` refuses unknown members; without the same
// refusal here a renamed or stale option key is dropped on the floor and the
// field silently takes its serde default, so the run computes something other
// than what was asked for and reports no error. Every producer of this
// document (the browser's `buildRustV2Options`, the native profiling
// examples, the campaign harnesses) emits exactly the keys below.
#[serde(deny_unknown_fields)]
pub struct PipelineV2OptionsJson {
    pub study_name: String,
    pub timezone: String,
    #[serde(deserialize_with = "deserialize_timezone_handling", default = "default_timezone_handling")]
    pub timezone_handling: String,
    #[serde(deserialize_with = "deserialize_usage_session_mode")]
    pub usage_session_mode: String,
    pub include_app_output: bool,
    pub include_screen_output: bool,
    pub use_filter_file: bool,
    pub use_apps_forcing_screen_open: bool,
    #[serde(default)]
    pub use_background_apps_file: bool,
    pub use_app_codebook: bool,
    #[serde(default)]
    pub include_category_column: bool,
    // Follows the published contract default, which is on: an omitted field
    // must take the same value the schema promises a researcher, or a request
    // that leaves it out silently produces a narrower table than the one the
    // documented default describes.
    #[serde(default = "default_true")]
    pub include_app_usage_end_reason: bool,
    /// Security X3 (formula injection). An optional wire field like
    /// `long_duration_threshold_explicit`: the browser sends it only when on,
    /// and absence is the canonical off, so an off request keeps the exact
    /// bytes, options digest and receipts it had before the key existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub neutralize_spreadsheet_formulas: Option<bool>,
    #[serde(default = "default_true")]
    pub deduplicate_exact_rows: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drop_out_of_source_order_events: Option<bool>,
    #[serde(default)]
    pub interaction_type_remap: Vec<String>,
    pub correct_duplicate_event_timestamps: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub long_duration_threshold_ns: i64,
    /// The contract's 2 s teardown grace (`proximity_interval_seconds`). An
    /// omitted key used to read 0 s, a different matcher configuration from
    /// the one the schema promises.
    #[serde(default = "default_proximity_interval_ns")]
    pub proximity_interval_ns: i64,
    pub custom_app_engagement_duration: f64,
    pub long_data_time_gap_thresholds: Vec<f64>,
    pub long_usage_duration_thresholds: Vec<f64>,
    pub same_app_stop_types: Vec<String>,
    pub other_stop_types: Vec<String>,
    pub interaction_types_to_remove: Vec<String>,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<InteractionTypeRemovalMode, _>",
        default = "default_interaction_type_removal_mode",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub interaction_type_removal_mode: PresenceTrackedOption<String>,
    pub screen_auto_lock_timeout_seconds: f64,
    pub screen_auto_lock_tolerance_seconds: f64,
    pub screen_manual_lock_max_tail_seconds: f64,
    pub screen_keyguard_near_stop_seconds: f64,
    pub datetime_of_preprocessing: String,
    #[serde(default)]
    pub model_concurrent_usage: bool,
    /// Canonical `MicroUseClassificationPolicyId`. A missing value preserves
    /// the pre-B03 non-classifying behavior; an unknown one is refused.
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<MicroUseClassificationPolicy, _>",
        default = "default_micro_use_classification_policy",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub micro_use_classification_policy: PresenceTrackedOption<String>,
    #[serde(
        default = "default_minimum_usage_duration",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub minimum_usage_duration: PresenceTrackedOption<f64>,
    /// Canonical `MinimumDurationComparatorId`.
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<MinimumDurationComparator, _>",
        default = "default_minimum_duration_comparator",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub minimum_duration_comparator: PresenceTrackedOption<String>,
    /// Canonical `MinimumDurationDispositionId`.
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<MinimumDurationDisposition, _>",
        default = "default_minimum_duration_disposition",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub minimum_duration_disposition: PresenceTrackedOption<String>,
    #[serde(default)]
    pub apply_minimum_usage_duration_to_concurrent_subintervals: bool,
    #[serde(default)]
    pub filter_zero_duration_sessions: bool,
    #[serde(default)]
    pub add_no_activity_placeholder_days: bool,
    #[serde(default)]
    pub enable_study_window_filter: bool,
    #[serde(default)]
    pub enable_person_attribution: bool,
    #[serde(default)]
    pub enable_day_coverage: bool,
    #[serde(default)]
    pub enable_compliance_scoring: bool,
    #[serde(default = "default_compliance_threshold_percent")]
    pub compliance_threshold_percent: f64,
    #[serde(default)]
    pub enable_screen_gated_crediting: bool,
    #[serde(deserialize_with = "deserialize_vocabulary::<ScreenGatingRule, _>", default = "default_screen_gating_rule")]
    pub screen_gating_rule: String,
    #[serde(deserialize_with = "deserialize_vocabulary::<DayBoundaryAttribution, _>", default = "default_day_boundary_attribution")]
    pub day_boundary_attribution: String,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<FilterMatchField, _>",
        default = "default_filter_match_field",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub filter_match_field: PresenceTrackedOption<String>,
    #[serde(
        default = "default_application_label_exclusions",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub application_label_exclusions: PresenceTrackedOption<Vec<String>>,
    #[serde(deserialize_with = "deserialize_vocabulary::<PackageExclusionPreset, _>", default = "default_package_exclusion_preset")]
    pub package_exclusion_preset: String,
    #[serde(deserialize_with = "deserialize_vocabulary::<NotificationProxyRule, _>", default = "default_notification_proxy_rule")]
    pub notification_proxy_rule: String,
    #[serde(deserialize_with = "deserialize_vocabulary::<PolledEmulationMethod, _>", default = "default_polled_emulation_method")]
    pub polled_emulation_method: String,
    #[serde(default = "default_polled_emulation_interval_seconds")]
    pub polled_emulation_interval_seconds: f64,
    #[serde(default = "default_polled_emulation_gap_seconds")]
    pub polled_emulation_gap_seconds: f64,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<IntervalExpansionMethod, _>",
        default = "default_interval_expansion_method",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub interval_expansion_method: PresenceTrackedOption<String>,
    #[serde(default)]
    pub enable_parquet_export: bool,
    #[serde(default)]
    pub enable_spss_export: bool,
    #[serde(default)]
    pub enable_aggregates: bool,
    #[serde(deserialize_with = "deserialize_aggregate_shape", default = "default_aggregate_shape")]
    pub aggregate_shape: String,
    #[serde(
        default = "default_aggregate_top_apps_limit",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub aggregate_top_apps_limit: PresenceTrackedOption<u32>,
    #[serde(default)]
    pub enable_participant_amount_summary: bool,
    // Exact browser view settings are carried in the Rust receipt even though
    // the dependency certificate correctly excludes them from preprocessing.
    #[serde(default = "default_true")]
    pub enable_plotting: bool,
    // Contract default on; an omitted key used to read off.
    #[serde(default = "default_true")]
    pub enable_activity_heatmap: bool,
    #[serde(default)]
    pub export_plots_as_svg: bool,
    #[serde(default)]
    pub enable_interactive_timeline: bool,
    #[serde(default)]
    pub include_filtered_app_usage_in_plots: bool,
    #[serde(default)]
    pub materialize_visualization_data: Option<bool>,
    #[serde(default = "default_credited_session_cap_minutes")]
    pub credited_session_cap_minutes: f64,
    #[serde(default = "default_device_liveness_gap_tolerance_minutes")]
    pub device_liveness_gap_tolerance_minutes: f64,
    #[serde(default = "default_auto_lock_bridge_seconds")]
    pub auto_lock_bridge_seconds: f64,
    #[serde(default = "default_no_witness_min_day_apps")]
    pub no_witness_min_day_apps: u32,
    /// Canonical `OpenerSetId`. A missing or null value preserves each
    /// strategy's pre-B02 opener behavior; an unknown one is refused.
    #[serde(
        default = "default_opener_set",
        deserialize_with = "deserialize_opener_set"
    )]
    pub opener_set: String,
    /// Canonical `ReconstructionStrategyId`. Absent means the production fused
    /// matcher, so options persisted before this key existed keep their exact
    /// previous behaviour.
    #[serde(deserialize_with = "deserialize_vocabulary::<EpisodeReconstructionStrategy, _>", default = "default_episode_reconstruction_strategy")]
    pub episode_reconstruction_strategy: String,
    /// Canonical `ScreenSessionConstructionStrategyId`. `None` is retained
    /// through conversion as the native compatibility selection; an explicit
    /// Chronicle value is scientifically equivalent but separately receipted.
    #[serde(default, deserialize_with = "deserialize_optional_screen_strategy")]
    pub screen_session_construction_strategy: Option<String>,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<ScreenSessionClassificationPolicy, _>",
        default = "default_screen_session_classification_policy",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub screen_session_classification_policy: PresenceTrackedOption<String>,
    #[serde(
        default = "default_screen_session_maximum_duration_minutes",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub screen_session_maximum_duration_minutes: PresenceTrackedOption<f64>,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<ScreenSessionMaximumDurationDisposition, _>",
        default = "default_screen_session_maximum_duration_disposition",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub screen_session_maximum_duration_disposition: PresenceTrackedOption<String>,
    #[serde(
        deserialize_with = "deserialize_tracked_vocabulary::<LockedScreenAudioDisposition, _>",
        default = "default_locked_screen_audio_disposition",
        skip_serializing_if = "PresenceTrackedOption::is_omitted"
    )]
    pub locked_screen_audio_disposition: PresenceTrackedOption<String>,
    /// Canonical `IntervalQualityPolicyId`. Absent means this engine's own
    /// interval cleaning, so options persisted before this key existed keep
    /// their exact previous behaviour.
    #[serde(deserialize_with = "deserialize_vocabulary::<IntervalQualityPolicy, _>", default = "default_interval_quality_policy")]
    pub interval_quality_policy: String,
    /// Canonical `SessionGroupingPolicyId`. Absent means no grouping and no
    /// session column, so options persisted before this key existed keep their
    /// exact previous behaviour.
    #[serde(deserialize_with = "deserialize_vocabulary::<SessionGroupingPolicy, _>", default = "default_session_grouping_policy")]
    pub session_grouping_policy: String,
    /// Canonical `SessionGapBasisId`. Absent is the published reading — the
    /// immediately preceding episode's stop — so options persisted before this
    /// key existed keep their exact previous numbering.
    #[serde(deserialize_with = "deserialize_vocabulary::<SessionGapBasis, _>", default = "default_session_gap_basis")]
    pub session_gap_basis: String,
    /// Canonical `SessionBoundaryScopeId`. Absent is `participant_v1`, which
    /// is the partition this pipeline has always used.
    #[serde(deserialize_with = "deserialize_vocabulary::<SessionBoundaryScope, _>", default = "default_session_boundary_scope")]
    pub session_boundary_scope: String,
    /// Stamp each numbered row with the rule that placed it. Absent is off,
    /// and off writes no flag, so the app table is byte-identical.
    #[serde(default)]
    pub emit_session_break_lineage: bool,
    #[serde(deserialize_with = "deserialize_vocabulary::<EventRetentionSet, _>", default = "default_event_retention_set")]
    pub event_retention_set: String,
    /// `MaximumDurationPolicyId`. Absent is the pre-B06 behaviour; unknown
    /// values refuse instead of widening. The seven B06 keys are the only
    /// optional wire fields: they serialize only when present, so the exact
    /// options the runtime re-serializes are byte-identical to what the
    /// browser sent (`workflow_contract::OPTIONAL_REQUEST_FIELDS` lets the
    /// query key material bind an absent one as `null`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_policy: Option<String>,
    /// `MaximumDurationConfiguredDispositionId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_disposition: Option<String>,
    /// `MaximumDurationThresholdSourceId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_threshold_source: Option<String>,
    /// Canonical decimal string `[1-9][0-9]{0,18}` (never a JSON number).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_threshold_ns: Option<String>,
    /// `true` only when the user chose the legacy hours value; absence is the
    /// canonical false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_duration_threshold_explicit: Option<bool>,
    /// Companions the browser derives for every explicit B06 selection:
    /// the canonical decimal spelling of the stored legacy hours and its exact
    /// nanosecond value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b06_legacy_threshold_hours_canonical: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b06_legacy_threshold_ns_canonical: Option<String>,
}

pub(super) const fn default_true() -> bool {
    true
}

pub(super) fn default_episode_reconstruction_strategy() -> String {
    "fused_matcher".into()
}

pub(super) fn default_opener_set() -> String {
    "strategy_defined".into()
}

pub(super) fn default_micro_use_classification_policy() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted("none".into())
}

pub(super) fn default_minimum_usage_duration() -> PresenceTrackedOption<f64> {
    PresenceTrackedOption::omitted(60.0)
}

pub(super) fn default_minimum_duration_comparator() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted("strict_lt".into())
}

pub(super) fn default_minimum_duration_disposition() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted("chronicle_blank_keep_row".into())
}

pub(super) fn deserialize_opener_set<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // `null` is the omitted spelling and keeps each strategy's own opener
    // behavior; any present string must be an `OpenerSetId`.
    let value = <Option<String> as serde::Deserialize>::deserialize(deserializer)?;
    match value {
        None => Ok(default_opener_set()),
        Some(value) => {
            OpenerSet::parse_request_value(&value).map_err(serde::de::Error::custom)?;
            Ok(value)
        }
    }
}

pub(super) fn default_interval_quality_policy() -> String {
    "none".into()
}

pub(super) fn default_session_grouping_policy() -> String {
    "none".into()
}

pub(super) fn default_session_gap_basis() -> String {
    "previous_episode_stop_v1".into()
}

pub(super) fn default_session_boundary_scope() -> String {
    "participant_v1".into()
}

pub(super) fn default_event_retention_set() -> String {
    "none".into()
}

pub(super) fn deserialize_optional_screen_strategy<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <Option<String> as serde::Deserialize>::deserialize(deserializer)?;
    if let Some(value) = value.as_deref() {
        ScreenSessionConstructionStrategyId::from_canonical_id_strict(value).map_err(|_| {
            serde::de::Error::custom("unknown_screen_session_construction_strategy")
        })?;
    }
    Ok(value)
}

/// The runtime plans app and screen work from this string and the kernel
/// used to read any unknown spelling as `app_usage`, so a stale or misspelled
/// mode ran the matcher under a plan that said nothing would run.
pub(super) fn deserialize_usage_session_mode<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <String as serde::Deserialize>::deserialize(deserializer)?;
    match value.as_str() {
        "no_usage" | "app_usage" | "screen_usage" | "app_and_screen_usage" => Ok(value),
        _ => Err(serde::de::Error::custom("unknown_usage_session_mode")),
    }
}

pub(super) fn default_timezone_handling() -> String {
    "selected-convert".into()
}

pub(super) fn default_aggregate_shape() -> String {
    "wide".into()
}

pub(super) const fn default_proximity_interval_ns() -> i64 {
    2_000_000_000
}

pub(super) const fn default_compliance_threshold_percent() -> f64 {
    70.0
}

pub(super) fn default_screen_gating_rule() -> String {
    ScreenGatingRule::default().canonical_id().to_string()
}

pub(super) fn default_day_boundary_attribution() -> String {
    DayBoundaryAttribution::default().canonical_id().to_string()
}

pub(super) fn default_package_exclusion_preset() -> String {
    PackageExclusionPreset::default().canonical_id().to_string()
}

pub(super) fn default_notification_proxy_rule() -> String {
    NotificationProxyRule::default().canonical_id().to_string()
}

pub(super) fn default_polled_emulation_method() -> String {
    PolledEmulationMethod::default().canonical_id().to_string()
}

/// Ross et al.'s acquisition lineage reports foreground polling up to every
/// ten seconds. Cerit et al.'s cadence is five; a researcher emulating that
/// study sets this to 5 rather than inheriting a second hidden default.
pub(super) const fn default_polled_emulation_interval_seconds() -> f64 {
    10.0
}

/// The 15 s in Ross et al.'s released preprocessing code. The literature brief
/// is explicit that this is an engineering rule embedded in code, not a
/// validated behavioral cutoff, which is exactly why it is a named number here
/// rather than a constant folded into the rule.
pub(super) const fn default_polled_emulation_gap_seconds() -> f64 {
    15.0
}

pub(super) const fn default_credited_session_cap_minutes() -> f64 {
    360.0
}

pub(super) const fn default_device_liveness_gap_tolerance_minutes() -> f64 {
    120.0
}

pub(super) const fn default_auto_lock_bridge_seconds() -> f64 {
    120.0
}

pub(super) const fn default_no_witness_min_day_apps() -> u32 {
    2
}

impl PipelineV2OptionsJson {
    pub fn into_pipeline_options(self) -> PipelineV2Options {
        let (micro_use_classification_policy, micro_use_classification_policy_explicit) =
            self.micro_use_classification_policy.into_parts();
        let (minimum_usage_duration, minimum_usage_duration_explicit) =
            self.minimum_usage_duration.into_parts();
        let (minimum_duration_comparator, minimum_duration_comparator_explicit) =
            self.minimum_duration_comparator.into_parts();
        let (minimum_duration_disposition, minimum_duration_disposition_explicit) =
            self.minimum_duration_disposition.into_parts();
        let (interaction_type_removal_mode, _) = self.interaction_type_removal_mode.into_parts();
        let (interval_expansion_method, _) = self.interval_expansion_method.into_parts();
        let (filter_match_field, _) = self.filter_match_field.into_parts();
        let (application_label_exclusions, _) = self.application_label_exclusions.into_parts();
        let (aggregate_top_apps_limit, _) = self.aggregate_top_apps_limit.into_parts();
        let (screen_session_classification_policy, _) =
            self.screen_session_classification_policy.into_parts();
        let (screen_session_maximum_duration_minutes, _) =
            self.screen_session_maximum_duration_minutes.into_parts();
        let (screen_session_maximum_duration_disposition, _) = self
            .screen_session_maximum_duration_disposition
            .into_parts();
        let (locked_screen_audio_disposition, _) =
            self.locked_screen_audio_disposition.into_parts();
        let parsed_screen_strategy = self
            .screen_session_construction_strategy
            .as_deref()
            .and_then(|value| {
                ScreenSessionConstructionStrategyId::from_canonical_id_strict(value).ok()
            });
        let screen_session_construction_strategy_explicit = parsed_screen_strategy.is_some();
        let screen_session_construction_strategy = parsed_screen_strategy.unwrap_or_default();
        let materialize_visualization_data = self
            .materialize_visualization_data
            .unwrap_or(self.enable_plotting || self.enable_interactive_timeline);
        let mode = match self.usage_session_mode.as_str() {
            "no_usage" => UsageSessionMode::NoUsage,
            "screen_usage" => UsageSessionMode::ScreenUsage,
            "app_and_screen_usage" => UsageSessionMode::AppAndScreenUsage,
            _ => UsageSessionMode::AppUsage,
        };
        PipelineV2Options {
            study_name: self.study_name,
            timezone: self.timezone,
            timezone_handling: self.timezone_handling,
            usage_session_mode: mode,
            include_app_output: self.include_app_output,
            include_screen_output: self.include_screen_output,
            use_filter_file: self.use_filter_file,
            use_apps_forcing_screen_open: self.use_apps_forcing_screen_open,
            use_background_apps_file: self.use_background_apps_file,
            use_app_codebook: self.use_app_codebook,
            include_category_column: self.include_category_column,
            include_app_usage_end_reason: self.include_app_usage_end_reason,
            neutralize_spreadsheet_formulas: self.neutralize_spreadsheet_formulas.unwrap_or(false),
            deduplicate_exact_rows: self.deduplicate_exact_rows,
            drop_out_of_source_order_events: self.drop_out_of_source_order_events.unwrap_or(false),
            interaction_type_remap: self.interaction_type_remap,
            correct_duplicate_event_timestamps: self.correct_duplicate_event_timestamps,
            allow_stop_event_reuse: self.allow_stop_event_reuse,
            use_activity_stopped_as_fallback: self.use_activity_stopped_as_fallback,
            apply_threshold_to_fallback: self.apply_threshold_to_fallback,
            long_duration_threshold_ns: self.long_duration_threshold_ns,
            proximity_interval_ns: self.proximity_interval_ns,
            custom_app_engagement_duration: self.custom_app_engagement_duration,
            long_data_time_gap_thresholds: self.long_data_time_gap_thresholds,
            long_usage_duration_thresholds: self.long_usage_duration_thresholds,
            same_app_stop_types: self.same_app_stop_types,
            other_stop_types: self.other_stop_types,
            interaction_types_to_remove: self.interaction_types_to_remove,
            interaction_type_removal_mode: InteractionTypeRemovalMode::from_canonical_id(
                &interaction_type_removal_mode,
            ),
            screen_auto_lock_timeout_seconds: self.screen_auto_lock_timeout_seconds,
            screen_auto_lock_tolerance_seconds: self.screen_auto_lock_tolerance_seconds,
            screen_manual_lock_max_tail_seconds: self.screen_manual_lock_max_tail_seconds,
            screen_keyguard_near_stop_seconds: self.screen_keyguard_near_stop_seconds,
            datetime_of_preprocessing: self.datetime_of_preprocessing,
            model_concurrent_usage: self.model_concurrent_usage,
            micro_use_classification_policy: MicroUseClassificationPolicy::from_canonical_id(
                &micro_use_classification_policy,
            ),
            micro_use_classification_policy_explicit,
            minimum_usage_duration,
            minimum_usage_duration_explicit,
            minimum_duration_comparator: MinimumDurationComparator::from_canonical_id(
                &minimum_duration_comparator,
            ),
            minimum_duration_comparator_explicit,
            minimum_duration_disposition: MinimumDurationDisposition::from_canonical_id(
                &minimum_duration_disposition,
            ),
            minimum_duration_disposition_explicit,
            apply_minimum_usage_duration_to_concurrent_subintervals: self
                .apply_minimum_usage_duration_to_concurrent_subintervals,
            filter_zero_duration_sessions: self.filter_zero_duration_sessions,
            add_no_activity_placeholder_days: self.add_no_activity_placeholder_days,
            enable_study_window_filter: self.enable_study_window_filter,
            enable_person_attribution: self.enable_person_attribution,
            enable_day_coverage: self.enable_day_coverage,
            enable_compliance_scoring: self.enable_compliance_scoring,
            compliance_threshold_percent: self.compliance_threshold_percent,
            enable_screen_gated_crediting: self.enable_screen_gated_crediting,
            screen_gating_rule: ScreenGatingRule::from_canonical_id(&self.screen_gating_rule),
            day_boundary_attribution: DayBoundaryAttribution::from_canonical_id(
                &self.day_boundary_attribution,
            ),
            filter_match_field: FilterMatchField::from_canonical_id(&filter_match_field),
            application_label_exclusions,
            package_exclusion_preset: PackageExclusionPreset::from_canonical_id(
                &self.package_exclusion_preset,
            ),
            notification_proxy_rule: NotificationProxyRule::from_canonical_id(
                &self.notification_proxy_rule,
            ),
            polled_emulation_method: PolledEmulationMethod::from_canonical_id(
                &self.polled_emulation_method,
            ),
            polled_emulation_interval_seconds: self.polled_emulation_interval_seconds,
            polled_emulation_gap_seconds: self.polled_emulation_gap_seconds,
            interval_expansion_method: IntervalExpansionMethod::from_canonical_id(
                &interval_expansion_method,
            ),
            enable_aggregates: self.enable_aggregates,
            aggregate_shape: self.aggregate_shape,
            aggregate_top_apps_limit,
            enable_participant_amount_summary: self.enable_participant_amount_summary,
            materialize_visualization_data,
            credited_session_cap_minutes: self.credited_session_cap_minutes,
            device_liveness_gap_tolerance_minutes: self.device_liveness_gap_tolerance_minutes,
            auto_lock_bridge_seconds: self.auto_lock_bridge_seconds,
            no_witness_min_day_apps: self.no_witness_min_day_apps,
            screen_session_construction_strategy,
            screen_session_construction_strategy_explicit,
            screen_session_classification_policy:
                ScreenSessionClassificationPolicy::from_canonical_id(
                    &screen_session_classification_policy,
                ),
            screen_session_maximum_duration_minutes,
            screen_session_maximum_duration_disposition:
                ScreenSessionMaximumDurationDisposition::from_canonical_id(
                    &screen_session_maximum_duration_disposition,
                ),
            locked_screen_audio_disposition: LockedScreenAudioDisposition::from_canonical_id(
                &locked_screen_audio_disposition,
            ),
            opener_set: OpenerSet::from_canonical_id(&self.opener_set),
            episode_reconstruction_strategy: EpisodeReconstructionStrategy::from_canonical_id(
                &self.episode_reconstruction_strategy,
            ),
            interval_quality_policy: IntervalQualityPolicy::from_canonical_id(
                &self.interval_quality_policy,
            ),
            session_grouping_policy: SessionGroupingPolicy::from_canonical_id(
                &self.session_grouping_policy,
            ),
            session_gap_basis: SessionGapBasis::from_canonical_id(&self.session_gap_basis),
            session_boundary_scope: SessionBoundaryScope::from_canonical_id(
                &self.session_boundary_scope,
            ),
            emit_session_break_lineage: self.emit_session_break_lineage,
            event_retention_set: EventRetentionSet::from_canonical_id(&self.event_retention_set),
            maximum_duration: b06::MaximumDurationRequest {
                policy: self.maximum_duration_policy,
                disposition: self.maximum_duration_disposition,
                threshold_source: self.maximum_duration_threshold_source,
                threshold_ns: self.maximum_duration_threshold_ns,
                long_duration_threshold_explicit: self
                    .long_duration_threshold_explicit
                    .unwrap_or(false),
                legacy_threshold_hours_canonical: self.b06_legacy_threshold_hours_canonical,
                legacy_threshold_ns_canonical: self.b06_legacy_threshold_ns_canonical,
            },
        }
    }
}

/// The complete set of rules that turn ordered episodes into numbered sessions.
///
/// `policy` is the published gap definition; the other three are the axes B11
/// adds around it. All three default to the behaviour that shipped with the
/// policies, so a `SessionGroupingRules::published(policy)` run is byte-for-byte
/// the run that existed before this struct did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionGroupingRules {
    pub policy: SessionGroupingPolicy,
    pub gap_basis: SessionGapBasis,
    pub scope: SessionBoundaryScope,
    /// Stamp each numbered row with the rule that placed it. Off by default:
    /// it writes `any_app_usage_flags`, and a run with it off must stay
    /// byte-identical.
    pub emit_lineage: bool,
}

impl PipelineV2Options {
    /// The complete grouping rule this run selected.
    pub fn session_grouping_rules(&self) -> SessionGroupingRules {
        SessionGroupingRules {
            policy: self.session_grouping_policy,
            gap_basis: self.session_gap_basis,
            scope: self.session_boundary_scope,
            emit_lineage: self.emit_session_break_lineage,
        }
    }
}

impl SessionGroupingRules {
    /// The 60 s rule with none of B11's departures applied. The tests measure
    /// each axis against a fixed policy: Zerrer et al. is a plain strict `>`
    /// on a gap constant with no package clause, and its comparator is read
    /// from the deposited code (`time_gap > 60`), not from prose.
    #[cfg(test)]
    pub(super) fn default_policy_only() -> Self {
        Self::published(SessionGroupingPolicy::ZerrerSixtySeconds)
    }

    /// The published rule with none of B11's departures applied.
    pub fn published(policy: SessionGroupingPolicy) -> Self {
        Self {
            policy,
            gap_basis: SessionGapBasis::PreviousEpisodeStop,
            scope: SessionBoundaryScope::Participant,
            emit_lineage: false,
        }
    }
}

/// Field used to match filter-file rows to raw app rows.
///
/// Package matching is the compatibility path. Application-label matching is
/// deliberately exact and row-scoped: it never manufactures a package rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMatchField {
    #[default]
    AppPackageName,
    ApplicationLabel,
}

impl FilterMatchField {
    pub const ALL: [Self; 2] = [Self::AppPackageName, Self::ApplicationLabel];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::AppPackageName => "app_package_name",
            Self::ApplicationLabel => "application_label",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "application_label" => Self::ApplicationLabel,
            _ => Self::AppPackageName,
        }
    }
}

/// Source-declared expansion of bounded app intervals into a separate derived
/// timeline. Unlike `PolledEmulationMethod`, this is anchored at each source
/// interval start and never consults an epoch-aligned sampling grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntervalExpansionMethod {
    #[default]
    None,
    /// `Match_ESM_App.py` for `10.1037/emo0001485`: end is
    /// `start + int(duration)`, then start..end is enumerated at one second
    /// under a half-open boundary.
    BehappStartAnchoredHalfOpen1sV1,
}

impl IntervalExpansionMethod {
    pub const ALL: [Self; 2] = [Self::None, Self::BehappStartAnchoredHalfOpen1sV1];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::BehappStartAnchoredHalfOpen1sV1 => "behapp_start_anchored_half_open_1s_v1",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "behapp_start_anchored_half_open_1s_v1" => Self::BehappStartAnchoredHalfOpen1sV1,
            _ => Self::None,
        }
    }

    pub fn emits_expansion(self) -> bool {
        !matches!(self, Self::None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenSessionClassificationPolicy {
    #[default]
    None,
    PhoneCheckInclusive15s,
    NullNoAppStrictGt15sVsApp,
}

impl ScreenSessionClassificationPolicy {
    pub const ALL: [Self; 3] = [
        Self::None,
        Self::PhoneCheckInclusive15s,
        Self::NullNoAppStrictGt15sVsApp,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::PhoneCheckInclusive15s => "phone_check_inclusive_15s",
            Self::NullNoAppStrictGt15sVsApp => "null_no_app_strict_gt15s_vs_app",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "phone_check_inclusive_15s" => Self::PhoneCheckInclusive15s,
            "null_no_app_strict_gt15s_vs_app" => Self::NullNoAppStrictGt15sVsApp,
            _ => Self::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenSessionMaximumDurationDisposition {
    #[default]
    None,
    Truncate,
    ExcludeParticipant,
}

impl ScreenSessionMaximumDurationDisposition {
    pub const ALL: [Self; 3] = [Self::None, Self::Truncate, Self::ExcludeParticipant];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Truncate => "truncate",
            Self::ExcludeParticipant => "exclude_participant",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "truncate" => Self::Truncate,
            "exclude_participant" => Self::ExcludeParticipant,
            _ => Self::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockedScreenAudioDisposition {
    #[default]
    Include,
    ExcludeFromPhoneAndAppSessions,
}

impl LockedScreenAudioDisposition {
    pub const ALL: [Self; 2] = [Self::Include, Self::ExcludeFromPhoneAndAppSessions];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::ExcludeFromPhoneAndAppSessions => "exclude_from_phone_and_app_sessions",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "exclude_from_phone_and_app_sessions" => Self::ExcludeFromPhoneAndAppSessions,
            _ => Self::Include,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum InteractionTypeRemovalMode {
    #[default]
    GapPreserving,
    Unconditional,
}

impl InteractionTypeRemovalMode {
    pub const ALL: [Self; 2] = [Self::GapPreserving, Self::Unconditional];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::GapPreserving => "gap_preserving",
            Self::Unconditional => "unconditional",
        }
    }

    /// A request value outside this vocabulary is refused when the options
    /// document is parsed (`OptionVocabulary`), so the fallback arm is reached
    /// only by an in-process caller that bypassed the request boundary.
    pub fn from_canonical_id(value: &str) -> Self {
        match value {
            "unconditional" => Self::Unconditional,
            _ => Self::GapPreserving,
        }
    }
}

fn default_interaction_type_removal_mode() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted("gap_preserving".into())
}

fn default_filter_match_field() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted(FilterMatchField::default().canonical_id().to_string())
}

fn default_application_label_exclusions() -> PresenceTrackedOption<Vec<String>> {
    PresenceTrackedOption::omitted(Vec::new())
}

fn default_interval_expansion_method() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted(IntervalExpansionMethod::default().canonical_id().into())
}

fn default_aggregate_top_apps_limit() -> PresenceTrackedOption<u32> {
    PresenceTrackedOption::omitted(0)
}

fn default_screen_session_classification_policy() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted(
        ScreenSessionClassificationPolicy::default()
            .canonical_id()
            .into(),
    )
}

fn default_screen_session_maximum_duration_minutes() -> PresenceTrackedOption<f64> {
    PresenceTrackedOption::omitted(0.0)
}

fn default_screen_session_maximum_duration_disposition() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted(
        ScreenSessionMaximumDurationDisposition::default()
            .canonical_id()
            .into(),
    )
}

fn default_locked_screen_audio_disposition() -> PresenceTrackedOption<String> {
    PresenceTrackedOption::omitted(
        LockedScreenAudioDisposition::default()
            .canonical_id()
            .into(),
    )
}
