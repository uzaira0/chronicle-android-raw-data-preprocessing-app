use crate::payload_store::PayloadHandle;
use super::{
    Arc, BTreeMap, BTreeSet, CheckpointHasher, EpisodeCloseReason,
    EpisodeReconstructionStrategy, MicroUseClassification, MicroUseClassificationPolicy,
    MinimumDurationComparator, MinimumDurationDisposition, OnceLock, OpenerSet,
    OpenerSetApplicability, PayloadBytes, PipelineV2OptionsValidationError,
    ScreenSessionConstructionStrategyId, SmallVec, aggregates, b05, b06, default_true,
    deserialize_codebook_fields, deserialize_lineage_searches, deserialize_screen_lineage,
    deserialize_shared_arc_string, encode_blake3_digest, serialize_codebook_fields,
    serialize_lineage_searches, serialize_shared_arc_string, sha256_wire,
};

pub const PREPROCESSOR_VERSION: &str = "1.0.0";

/// Closed product contract for timezone handling. Tests enumerate every
/// ordered transition so a fifth policy cannot be added without explicit
/// invalidation and output checks.
pub const TIMEZONE_HANDLING_MODES: [&str; 4] = [
    "selected-filter",
    "selected-convert",
    "primary-filter",
    "primary-convert",
];

// ---- canonical interaction-type constants -------------------------------

pub(super) const ACTIVITY_RESUMED: &str = "Activity Resumed";

pub(super) const ACTIVITY_PAUSED: &str = "Activity Paused";

pub(super) const ACTIVITY_STOPPED: &str = "Activity Stopped";

pub(super) const FILTERED_RESUMED: &str = "Filtered App Resumed";

pub(super) const FILTERED_PAUSED: &str = "Filtered App Paused";

pub(super) const FILTERED_STOPPED: &str = "Filtered App Stopped";

pub(super) const APP_USAGE: &str = "App Usage";

/// The zero-length `App Usage` row a raw-data day without usage gets when
/// no-activity placeholder days are on. It marks the day; it is not a session.
pub(super) const NO_ACTIVITY_PLACEHOLDER_PACKAGE: &str = "com.placeholder.noactivity";

pub(super) const FILTERED_APP_USAGE: &str = "Filtered App Usage";

pub(super) const FILTERED_APP_BACKGROUND_USAGE: &str = "Filtered App Background Usage";

pub(super) const NON_TARGET_CHILD_APP_USAGE: &str = "Non-Target Child App Usage";

pub(super) const END_OF_USAGE_MISSING: &str = "End of Usage Missing";

pub(super) const SCREEN_USAGE: &str = "Screen Usage";

/// Android `NOTIFICATION_SEEN` (type 10) and `NOTIFICATION_INTERRUPTION`
/// (type 12) after normalization. Both are app-scoped instants, never
/// intervals, and no reconstruction strategy opens an episode on either.
pub(super) const NOTIFICATION_SEEN: &str = "Notification Seen";

pub(super) const NOTIFICATION_INTERRUPTION: &str = "Notification Interruption";

/// The framework itself, not an app the user opened. Parry & Toth's reference
/// implementation refuses to open an episode on it while still letting it close
/// one; only `EpisodeReconstructionStrategy::ParryTothForwardPairing` reads this.
pub(super) const ANDROID_PSEUDO_PACKAGE: &str = "android";

// ---- GESIS event classification -----------------------------------------
//
// GESIS classifies raw `UsageEvents` rows by numeric `eventType`, with a far
// wider vocabulary than this engine reads: starts
// `{1, 4, 11, 14, 15, 18, 19, 22, 27}` and stops
// `{2, 3, 10, 13, 16, 17, 20, 23, 24, 25, 26}`. Chronicle exports labels, not
// numbers. These constants intentionally preserve the source-partial event
// vocabulary used by Chronicle's pre-B02 GESIS implementation: they remain the
// compatibility default and the classified Start/Stop repair pool, so widening
// them here would silently change both legacy bytes and B03 closer semantics.
//
// B02 can now transport canonical labels for source types 4, 11, 14, 19, 20,
// and 22. The app-scoped *start* members are admitted separately by
// `OpenerSet::GesisAppScopedStarts`; they do not expand this legacy repair pool.
// Other source types with no Chronicle label remain absent from the input. This
// is therefore a source-aligned opener adapter, not full GESIS fidelity.
//
// Chronicle also fuses two coincident raw events into one label. Those two are
// the only rows with no exact GESIS counterpart, and each is classified by its
// *screen* component, the leading event of the pair:
//   "Screen Interactive/Keyguard Shown"     -> 15 start (not 17 stop)
//   "Screen Non-Interactive/Keyguard Hidden" -> 16 stop  (not 18 start)
pub(super) const GESIS_START_EVENTS: &[&str] = &[
    "Activity Resumed",                  // 1
    "Filtered App Resumed",              // 1
    "Screen Interactive",                // 15
    "Keyguard Hidden",                   // 18
    "Device Startup",                    // 27
    "Screen Interactive/Keyguard Shown", // 15, fused
];

pub(super) const GESIS_STOP_EVENTS: &[&str] = &[
    "Activity Paused",                        // 2
    "Filtered App Paused",                    // 2
    "Screen Non-Interactive",                 // 16
    "Device Screen Off",                      // 16
    "Keyguard Shown",                         // 17
    "Activity Stopped",                       // 23
    "Filtered App Stopped",                   // 23
    "Activity Destroyed",                     // 24
    "Filtered App Destroyed",                 // 24
    "Device Shutdown",                        // 26
    "Screen Non-Interactive/Keyguard Hidden", // 16, fused
];

/// Rows GESIS classifies as a stop but excludes from the table it searches for
/// an `original` stop. In their code this is type 10, notification-seen.
/// Chronicle exports it as `Notification Seen`; the exclusion is inert today
/// only because that label is in no GESIS start or stop set, and it is applied
/// rather than assumed away if that ever changes.
pub(super) const GESIS_UNMATCHABLE_STOP_EVENTS: &[&str] = &[NOTIFICATION_SEEN];

/// GESIS `max_timeout`: the tutorial's fixed 600 s cut.
pub(super) const GESIS_MAX_TIMEOUT_NS: i64 = 600 * 1_000_000_000;

/// GESIS `event_threshold`: at most this many events may sit between a start
/// and the same-app stop it accepts as `original`.
pub(super) const GESIS_EVENT_THRESHOLD: usize = 10;

/// Draxler et al. (2021): the ten-minute inactivity cut. Not a contract option
/// for the same reason the Culverhouse bands are not — a retunable value would
/// make the citation false.
pub(super) const DRAXLER_INACTIVITY_NS: i64 = 10 * 60 * 1_000_000_000;

/// Morrison et al. (2018): how long the screen must STAY off before the lock
/// counts as ending the app use. Inherited by name from Böhmer et al. (2011) —
/// "the screen has been locked for 30 seconds" — and reported as such, so it is
/// a citation and not a knob.
pub(super) const MORRISON_LOCK_TIMEOUT_NS: i64 = 30 * 1_000_000_000;

pub(super) const KIDS_SHELL_PACKAGES: &[&str] = &[
    "com.amazon.tahoe",
    "com.sencatech.iwawa.iwawahome",
    "com.google.android.apps.kids.home",
    "com.kiddoware.kidsplace",
    "com.tcl.kidsmode",
];

// ---- screen-state constants ---------------------------------------------

pub(super) const SCREEN_START_EVENTS: &[&str] = &["Screen Interactive", "Screen Interactive/Keyguard Shown"];

pub(super) const SCREEN_STOP_EVENTS: &[&str] = &[
    "Screen Non-Interactive",
    "Device Screen Off",
    "Screen Non-Interactive/Keyguard Hidden",
    "Screen Non-Interactive/Manual Hardware Button",
    "Screen Non-Interactive/Aborted Unlock",
    "Screen Non-Interactive/Idle Timeout",
];

pub(super) const LOCK_SCREEN_EVENTS: &[&str] = &["Keyguard Shown", "Screen Interactive/Keyguard Shown"];

pub(super) const UNLOCK_EVENTS: &[&str] = &[
    "Keyguard Hidden",
    "User Unlocked",
    "Screen Non-Interactive/Keyguard Hidden",
];

pub(super) const FOREGROUND_EVENTS: &[&str] = &["Activity Resumed", "Filtered App Resumed"];

pub(super) const MEANINGFUL_ACTIVITY_EVENTS: &[&str] = &[
    "Activity Resumed",
    "Filtered App Resumed",
    "User Interaction",
    "Shortcut Invocation",
    "Chooser Action",
    "App Component Used",
    "User Unlocked",
    "Keyguard Hidden",
];

pub(super) const AMAZON_APPS: &[&str] = &[
    "com.amazon.redstone",
    "com.amazon.firelauncher",
    "com.amazon.imp",
    "com.amazon.alta.h2clientservice",
    "com.amazon.media.session.monitor",
];

// Codebook column rename map. Matches CODEBOOK_COLUMN_RENAME_MAP in TS.
// Order MUST match TS Object.values order — JS preserves insertion order.
pub(super) const CODEBOOK_RENAME_PAIRS: &[(&str, &str)] = &[
    ("application_label", "codebook_application_label"),
    ("bcm_play_store_genreId", "bcm_play_store_genreId"),
    ("bcm_play_store_genre", "bcm_play_store_genre"),
    (
        "bcm_play_store_broad_app_category",
        "bcm_play_store_broad_app_category",
    ),
    ("bcm_play_store_developer", "bcm_play_store_developer"),
    ("bcm_play_store_free", "bcm_play_store_free"),
    ("bcm_play_store_rating", "bcm_play_store_rating"),
    ("bcm_play_store_downloads", "bcm_play_store_downloads"),
    ("usc_broad_app_category", "usc_broad_app_category"),
    ("usc_genreId", "usc_genreId"),
    (
        "umich_child_app_category_code",
        "umich_child_app_category_code",
    ),
    ("umich_child_app_category", "umich_child_app_category"),
    (
        "umich_adult_app_category_code",
        "umich_adult_app_category_code",
    ),
    ("umich_adult_app_category", "umich_adult_app_category"),
    ("umich_free", "umich_free"),
    ("umich_gambling_app", "umich_gambling_app"),
    ("umich_inappropriate_app", "umich_inappropriate_app"),
    ("babyemu_genreId_scraped", "babyemu_genreId_scraped"),
    ("babyemu_genreId_manual", "babyemu_genreId_manual"),
    ("babyemu_broad_app_category", "babyemu_broad_app_category"),
    ("babyemu_medium_app_category", "babyemu_medium_app_category"),
    ("babyemu_fine_app_category", "babyemu_fine_app_category"),
    (
        "babyemu_alternate_fine_app_category",
        "babyemu_alternate_fine_app_category",
    ),
    ("babyemu_kids", "babyemu_kids"),
    ("bcm_cnrc_heuristic_category", "bcm_cnrc_heuristic_category"),
    (
        "bcm_cnrc_categorization_source",
        "bcm_cnrc_categorization_source",
    ),
    ("bluelight_play_store_genreId", "bluelight_play_store_genreId"),
    ("bluelight_play_store_genre", "bluelight_play_store_genre"),
    (
        "bluelight_play_store_broad_app_category",
        "bluelight_play_store_broad_app_category",
    ),
    ("bluelight_play_store_developer", "bluelight_play_store_developer"),
    ("bluelight_play_store_free", "bluelight_play_store_free"),
    ("bluelight_play_store_rating", "bluelight_play_store_rating"),
    ("bluelight_play_store_downloads", "bluelight_play_store_downloads"),
    ("dataset", "codebook_dataset"),
];

/// Codebook output columns whose first non-blank value becomes
/// `broad_app_category`, highest precedence first.
pub(super) const BROAD_CATEGORY_COLUMNS: [&str; 5] = [
    "bcm_play_store_broad_app_category",
    "bluelight_play_store_broad_app_category",
    "usc_broad_app_category",
    "babyemu_broad_app_category",
    "bcm_cnrc_heuristic_category",
];

/// Codebook genre-id columns `collapse_app_genre` collapses into
/// `genre_id_scraped` when every non-blank one agrees.
pub(super) const GENRE_ID_COLUMNS: [&str; 5] = [
    "babyemu_genreId_scraped",
    "babyemu_genreId_manual",
    "bcm_play_store_genreId",
    "usc_genreId",
    "bluelight_play_store_genreId",
];

/// Positions of `GENRE_ID_COLUMNS` in `CODEBOOK_RENAME_PAIRS` (pinned by a test).
pub(super) const COLLAPSED_GENRE_FIELD_INDICES: [usize; 5] = [1, 9, 17, 18, 26];

pub(super) const FOUNDATIONAL_SEMANTICS_CHECKPOINT: &str = "episode_materialized_pre_concurrency";

pub(super) const ZERO_DURATION_CLEANUP_CHECKPOINT: &str = "post_interval_quality_before_zero_duration_cleanup";

pub(super) const OKOSHI_MICRO_USE_THRESHOLD_NS: i64 = 5_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroUseReceipt {
    pub protocol_version: String,
    pub requested_policy: MicroUseClassificationPolicy,
    pub effective_policy: MicroUseClassificationPolicy,
    pub relation: String,
    pub source_id: Option<String>,
    pub comparator: Option<String>,
    pub threshold_ns: Option<i64>,
    pub checkpoint: String,
    pub class_counts: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimumDurationExcludedEpisode {
    pub participant_id: String,
    pub app_package_name: String,
    pub source_data_row_ranges: Vec<SourceDataRowRange>,
    pub raw_start_timestamp_ns: i64,
    pub raw_stop_timestamp_ns: i64,
    pub raw_duration_ns: i64,
    pub reason: String,
    pub disposition: MinimumDurationDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimumDurationReceipt {
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
    pub excluded_lineage_digest: String,
}

/// Receipt for the older, independently enabled floor on concurrency-created
/// fragments. This is deliberately not folded into B04: it is a strict-`<`,
/// blank-only projection at a later checkpoint and therefore answers a
/// different scientific question.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrentSubintervalFloorReceipt {
    pub protocol_version: String,
    pub requested_applied: bool,
    pub effective_applied: bool,
    pub comparator: String,
    pub threshold_ns: i64,
    pub checkpoint: String,
    pub generated_subinterval_count: u32,
    pub blanked_subinterval_count: u32,
}

/// Canonical identity of a row actually removed by the independently selected
/// exact-zero cleanup.  This lineage is deliberately separate from B04's
/// minimum-duration exclusion evidence: B04 has already run (including
/// DropRow) before this checkpoint is observed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZeroDurationRemovedRow {
    pub participant_id: String,
    pub app_package_name: String,
    pub interaction_type: String,
    pub source_data_row_ranges: Vec<SourceDataRowRange>,
    pub event_timestamp_ns: i64,
    pub start_timestamp_ns: Option<i64>,
    pub stop_timestamp_ns: Option<i64>,
    pub raw_episode_start_timestamp_ns: Option<i64>,
    pub raw_episode_stop_timestamp_ns: Option<i64>,
    pub raw_episode_duration_ns: Option<i64>,
    pub evidence_basis: String,
    pub usage_layer: Option<String>,
}

/// Receipt for exact-zero cleanup at its own post-B04 workflow checkpoint.
/// Candidate count is descriptive even when the option is off; removed count
/// and lineage record only rows causally removed by this operation.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZeroDurationCleanupReceipt {
    pub protocol_version: String,
    pub requested_applied: bool,
    pub effective_applied: bool,
    pub checkpoint: String,
    pub zero_episode_candidate_count: u32,
    pub removed_row_count: u32,
    pub removed_lineage_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZeroDurationCleanupEvidence {
    pub receipt: ZeroDurationCleanupReceipt,
    pub removed_rows: Vec<ZeroDurationRemovedRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundationalSemanticsEvidence {
    pub micro_use: MicroUseReceipt,
    pub minimum_duration: MinimumDurationReceipt,
    pub concurrent_subinterval_floor: ConcurrentSubintervalFloorReceipt,
    pub zero_duration_cleanup: ZeroDurationCleanupEvidence,
    pub minimum_duration_excluded_episodes: Vec<MinimumDurationExcludedEpisode>,
}

/// Minimal immutable pre-concurrency episode substrate from which the B03/B04
/// receipts are derived.  Keeping this projection separate from public timing
/// lets persistence validators deduplicate concurrency fragments without
/// accidentally counting one reconstructed episode more than once.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct FoundationalEpisodeEvidence {
    pub(super) participant_id: String,
    pub(super) app_package_name: String,
    pub(super) source_data_row_ranges: Vec<SourceDataRowRange>,
    pub(super) raw_start_timestamp_ns: i64,
    pub(super) raw_stop_timestamp_ns: Option<i64>,
    pub(super) raw_duration_ns: Option<i64>,
    pub(super) micro_use_classification: Option<MicroUseClassification>,
    pub(super) minimum_duration_qualified: Option<bool>,
}

/// Small scientific receipt persisted alongside reconstructed rows so a warm
/// restore cannot return correct bytes with evidence from another B02 arm.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerSetEvidence {
    pub applicability: OpenerSetApplicability,
    pub suppressed_device_opener_count: u32,
    pub selected_opener_type_counts: BTreeMap<String, u32>,
    pub materialized_opener_type_counts: BTreeMap<String, u32>,
}

impl OpenerSetEvidence {
    pub(super) fn empty(opener_set: OpenerSet, strategy: EpisodeReconstructionStrategy) -> Self {
        Self {
            applicability: opener_set.applicability(strategy),
            suppressed_device_opener_count: 0,
            selected_opener_type_counts: BTreeMap::new(),
            materialized_opener_type_counts: BTreeMap::new(),
        }
    }
}

impl Default for OpenerSetEvidence {
    fn default() -> Self {
        Self::empty(
            OpenerSet::StrategyDefined,
            EpisodeReconstructionStrategy::FusedMatcher,
        )
    }
}

#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct CodebookEntry {
    /// Indexed by codebook_col_index() output name (e.g. "codebook_application_label", "bcm_play_store_genreId"…)
    pub fields: Arc<Vec<Option<String>>>,
}

// ---- canonical row ------------------------------------------------------

/// Cheaply cloned immutable text used inside row-bearing incremental query
/// results. A `Row` is copied at several real transformation boundaries; the
/// text itself normally does not change at those boundaries, so sharing it
/// avoids allocating another copy for every cached query result.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(super) struct SharedString(pub(super) Arc<String>);

impl Default for SharedString {
    fn default() -> Self {
        static EMPTY: OnceLock<Arc<String>> = OnceLock::new();
        Self(Arc::clone(EMPTY.get_or_init(|| Arc::new(String::new()))))
    }
}

impl SharedString {
    pub(super) fn as_str(&self) -> &str {
        self.0.as_str()
    }

    pub(super) fn shared(&self) -> Arc<String> {
        Arc::clone(&self.0)
    }

    pub(super) fn into_shared(self) -> Arc<String> {
        self.0
    }
}

impl std::ops::Deref for SharedString {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl std::fmt::Display for SharedString {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::borrow::Borrow<str> for SharedString {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl From<String> for SharedString {
    fn from(value: String) -> Self {
        Self(Arc::new(value))
    }
}

impl From<&str> for SharedString {
    fn from(value: &str) -> Self {
        Self(Arc::new(value.to_owned()))
    }
}

impl PartialEq<&str> for SharedString {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone)]
pub struct Row(pub(super) Arc<RowInner>);

/// The derived checkpoint parts travel with the immutable row value. Each
/// semantic component is cached separately so a classification-only edit does
/// not force the identity and temporal bytes through the hash function again.
pub(super) struct RowInner {
    pub(super) data: RowData,
    pub(super) checkpoint_parts: RowCheckpointCache,
}

#[derive(Default)]
pub(super) struct RowCheckpointCache {
    pub(super) identity: OnceLock<[u8; 16]>,
    pub(super) temporal: OnceLock<[u8; 16]>,
    pub(super) classification: OnceLock<[u8; 16]>,
}

/// Carrying the memoized parts into the clone is deliberate, and it is only
/// sound because of one invariant: a `RowCheckpointCache` is never separated
/// from the `RowData` it was computed over. `RowInner::clone` clones both
/// together, so the copy describes byte-identical data; `Deserialize` restores
/// the parts that were persisted beside those exact bytes; and every mutation
/// goes through `edit_*`, which clears the components it hands out. Dropping
/// the values instead would be safe but would rehash every cloned row —
/// `review_reconstructed_rows` alone clones the whole table per revision.
///
/// The rule this depends on is enforced elsewhere: `RowCheckpointCache` has no
/// public constructor that takes parts without data, and the bucket views are
/// the only write path that does not clear all three components.
impl Clone for RowCheckpointCache {
    fn clone(&self) -> Self {
        fn copy_lock(source: &OnceLock<[u8; 16]>) -> OnceLock<[u8; 16]> {
            let copy = OnceLock::new();
            if let Some(value) = source.get() {
                copy.set(*value).expect("fresh checkpoint lock");
            }
            copy
        }

        Self {
            identity: copy_lock(&self.identity),
            temporal: copy_lock(&self.temporal),
            classification: copy_lock(&self.classification),
        }
    }
}

impl RowInner {
    pub(super) fn new(data: RowData) -> Self {
        Self {
            data,
            checkpoint_parts: RowCheckpointCache::default(),
        }
    }
}

impl Clone for RowInner {
    fn clone(&self) -> Self {
        Self {
            data: self.data.clone(),
            checkpoint_parts: self.checkpoint_parts.clone(),
        }
    }
}

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RowData {
    /// One-based raw CSV data-row numbers (the header is not counted) that
    /// may contribute to this row. Matching/state-machine outputs retain a
    /// conservative dependency set rather than claiming false exactness.
    pub(super) source_data_rows: SourceDataRows,
    /// Exact descriptions of candidate regions searched to establish that a
    /// required matching event was absent. These remain separate from rows
    /// that directly supplied output values.
    #[serde(
        serialize_with = "serialize_lineage_searches",
        deserialize_with = "deserialize_lineage_searches"
    )]
    pub(super) lineage_searches: Arc<SmallVec<[LineageSearchEvidence; 1]>>,
    pub(super) study_id: SharedString,
    pub(super) participant_id: SharedString,
    pub(super) possible_device_model: SharedString,
    pub(super) username: SharedString,
    pub(super) application_label: SharedString,
    pub(super) interaction_type: SharedString,
    pub(super) app_package_name: SharedString,
    pub(super) event_timestamp_ns: i64,
    pub(super) timezone: SharedString,
    pub(super) data_time_gap_hours: f64,
    pub(super) date: SharedString,
    pub(super) day: u8,
    pub(super) weekday_mf: u8,
    pub(super) weekday_mth: u8,
    pub(super) weekday_su_th: u8,
    pub(super) hour: u8,
    pub(super) quarter: u8,
    pub(super) start_timestamp_ns: Option<i64>,
    pub(super) stop_timestamp_ns: Option<i64>,
    pub(super) duration_seconds: Option<f64>,
    pub(super) duration_minutes: Option<f64>,
    /// Immutable reconstructed evidence captured before B03/B04 projection or
    /// any optional concurrency split. These fields are internal unless a
    /// non-default foundational-semantics output explicitly exposes them.
    #[serde(default)]
    pub(super) raw_episode_start_timestamp_ns: Option<i64>,
    #[serde(default)]
    pub(super) raw_episode_stop_timestamp_ns: Option<i64>,
    #[serde(default)]
    pub(super) raw_episode_duration_ns: Option<i64>,
    #[serde(default)]
    pub(super) micro_use_classification: Option<MicroUseClassification>,
    #[serde(default)]
    pub(super) minimum_duration_qualified: Option<bool>,
    /// Only `retain_but_exclude` makes this false. It is intentionally
    /// separate from public duration so retained evidence cannot accidentally
    /// re-enter a headline denominator.
    #[serde(default = "default_true")]
    pub(super) minimum_duration_aggregate_eligible: bool,
    /// Internal projection markers. They travel through concurrency by clone,
    /// but are never inferred from a blank duration.
    #[serde(default)]
    pub(super) minimum_duration_blank_applied: bool,
    /// True only when the separate legacy concurrent-subinterval floor
    /// blanked this generated fragment. It never changes the pre-concurrency
    /// B04 qualification or disposition fields above.
    #[serde(default)]
    pub(super) concurrent_subinterval_floor_blank_applied: bool,
    #[serde(default)]
    pub(super) minimum_duration_drop_pending: bool,
    /// B06 generic maximum-duration stage. `None` until the stage has looked
    /// at a bounded episode under `post_reconstruction_strict_max_v1`; the
    /// omitted, strategy-native and Chronicle-arm shapes never touch it.
    #[serde(default)]
    pub(super) maximum_duration_qualified: Option<bool>,
    /// Only `retain_but_exclude` makes this false.
    #[serde(default = "default_true")]
    pub(super) maximum_duration_aggregate_eligible: bool,
    #[serde(default)]
    pub(super) maximum_duration_drop_pending: bool,
    /// Nanoseconds removed from the published endpoint by
    /// `truncate_to_threshold` (raw duration minus the threshold).
    #[serde(default)]
    pub(super) maximum_duration_trimmed_ns: Option<i64>,
    /// Set only on a published row whose stop endpoint was replaced by the
    /// truncation boundary.
    #[serde(default)]
    pub(super) effective_endpoint_reason: Option<b06::MaximumDurationEffectiveEndpointReason>,
    pub(super) screen_usage_end_reason: Option<SharedString>,
    /// Why this app episode ended, in the reader-facing Title Case form.
    /// Populated only when `include_app_usage_end_reason` is on, so with the
    /// option off every row carries `None` and the output is unchanged.
    pub(super) app_usage_end_reason: Option<SharedString>,
    /// Present only for the Schoedel controlled-derivative arm. These bind an
    /// app episode to the exact immutable B05 interval and disclose the
    /// project-owned completion rule.
    #[serde(default)]
    pub(super) screen_interval_id: Option<SharedString>,
    #[serde(default)]
    pub(super) schoedel_completion: Option<b05::SchoedelCompletion>,
    /// Which usage session this app episode belongs to, numbered from 0 within
    /// each participant. Populated only when `session_grouping_policy` is not
    /// `none`, so with the option off every row carries `None` and the output
    /// is unchanged.
    pub(super) usage_session_id: Option<i64>,
    pub(super) screen_usage_end_reason_confidence: Option<f64>,
    pub(super) screen_usage_stop_event_type: Option<SharedString>,
    pub(super) screen_usage_last_activity_timestamp_ns: Option<i64>,
    pub(super) screen_usage_tail_gap_seconds: Option<f64>,
    pub(super) screen_usage_foreground_app_package: Option<SharedString>,
    /// Interval-wide foreground evidence: true = at least one identified app;
    /// false = no foreground events in this constructed bout; None = unknown.
    /// Never forward-fill this evidence into the current foreground package.
    #[serde(default)]
    pub(super) screen_usage_app_observed: Option<bool>,
    pub(super) screen_usage_session_classification: Option<SharedString>,
    pub(super) screen_usage_apps_forcing_screen_open_label: Option<SharedString>,
    pub(super) screen_usage_lock_screen_only: Option<u8>,
    pub(super) any_app_usage_flags: SharedString,
    pub(super) valid_app_new_engage_30s: i32,
    pub(super) valid_app_new_engage_custom: i32,
    pub(super) valid_app_switched_app: i32,
    pub(super) valid_app_usage_time_gap_hours: f64,
    pub(super) any_app_new_engage_30s: i32,
    pub(super) any_app_new_engage_custom: i32,
    pub(super) any_app_switched_app: i32,
    pub(super) any_app_usage_time_gap_hours: f64,
    pub(super) genre_id_scraped: Option<SharedString>,
    pub(super) broad_app_category: Option<SharedString>,
    /// Per-codebook column values (Option<String>) parallel to CODEBOOK_RENAME_PAIRS.
    #[serde(
        serialize_with = "serialize_codebook_fields",
        deserialize_with = "deserialize_codebook_fields"
    )]
    pub(super) codebook_fields: Arc<Vec<Option<String>>>,
    pub(super) codebook_genre_fields_cleared: bool,
    pub(super) index: usize,
    /// Present only when `model_concurrent_usage` is true. Value is "primary"
    /// or "secondary". None when the flag is off (column absent from output).
    pub(super) usage_layer: Option<SharedString>,
}

impl Row {
    pub(super) fn new(data: RowData) -> Self {
        Self(Arc::new(RowInner::new(data)))
    }

    pub(super) fn edit_components(
        &mut self,
        identity: bool,
        temporal: bool,
        classification: bool,
    ) -> &mut RowData {
        let inner = Arc::make_mut(&mut self.0);
        if identity {
            inner.checkpoint_parts.identity = OnceLock::new();
        }
        if temporal {
            inner.checkpoint_parts.temporal = OnceLock::new();
        }
        if classification {
            inner.checkpoint_parts.classification = OnceLock::new();
        }
        &mut inner.data
    }

    /// Invalidate the identity memo and hand back write access to the identity
    /// fields, and only those. A write outside the bucket is a type error.
    pub(super) fn edit_identity(&mut self) -> RowIdentityView<'_> {
        split_row_buckets(self.edit_components(true, false, false)).identity
    }

    /// Invalidate the temporal memo and hand back write access to the temporal
    /// fields, and only those.
    pub(super) fn edit_temporal(&mut self) -> RowTemporalView<'_> {
        split_row_buckets(self.edit_components(false, true, false)).temporal
    }

    /// Invalidate the classification memo and hand back write access to the
    /// classification fields, and only those.
    pub(super) fn edit_classification(&mut self) -> RowClassificationView<'_> {
        split_row_buckets(self.edit_components(false, false, true)).classification
    }

    /// Invalidate all three memos and hand back the whole row. This is the
    /// honest way to write across buckets; `DerefMut` routes here.
    pub(super) fn edit_all(&mut self) -> &mut RowData {
        self.edit_components(true, true, true)
    }
}

/// Write access to exactly one semantic component of a row.
///
/// `edit_temporal()` used to hand back `&mut RowData` — the whole row — while
/// clearing only the temporal memo, so writing an identity or classification
/// field through it published a checkpoint describing values the row no longer
/// held. That was not hypothetical: the concurrency splitter wrote `index`
/// (identity) through `edit_temporal()`, and it was correct only because the
/// statement above it happened to go through `DerefMut`, which clears all
/// three. Nothing enforced that adjacency.
///
/// These views make the hazard a type error. Each exposes only the fields
/// whose bytes `encode_row_checkpoint_parts` hashes into that component, as
/// `&mut` bindings, so a write to any other field does not compile.
/// `split_row_buckets` is the single place the partition is written down, and
/// it is exhaustive: adding a `RowData` field fails its pattern, and routing
/// one binding into two views fails the borrow checker.
///
/// Each view enumerates its whole bucket, not only the fields something
/// writes today. That is the point: the three structs together are the written
/// partition `encode_row_checkpoint_parts` hashes, and a field with no current
/// writer still has to have a home so the next writer lands in the right one.
#[allow(dead_code)]
/// Identity: what the row *is* and where it came from.
pub(super) struct RowIdentityView<'a> {
    pub(super) source_data_rows: &'a mut SourceDataRows,
    pub(super) lineage_searches: &'a mut Arc<SmallVec<[LineageSearchEvidence; 1]>>,
    pub(super) index: &'a mut usize,
}

/// Temporal: when the row happened and how long it lasted, including the
/// B03/B04/B06 evidence every writer of those endpoints also moves.
#[allow(dead_code)]
pub(super) struct RowTemporalView<'a> {
    pub(super) event_timestamp_ns: &'a mut i64,
    pub(super) timezone: &'a mut SharedString,
    pub(super) data_time_gap_hours: &'a mut f64,
    pub(super) date: &'a mut SharedString,
    pub(super) day: &'a mut u8,
    pub(super) weekday_mf: &'a mut u8,
    pub(super) weekday_mth: &'a mut u8,
    pub(super) weekday_su_th: &'a mut u8,
    pub(super) hour: &'a mut u8,
    pub(super) quarter: &'a mut u8,
    pub(super) start_timestamp_ns: &'a mut Option<i64>,
    pub(super) stop_timestamp_ns: &'a mut Option<i64>,
    pub(super) duration_seconds: &'a mut Option<f64>,
    pub(super) duration_minutes: &'a mut Option<f64>,
    pub(super) raw_episode_start_timestamp_ns: &'a mut Option<i64>,
    pub(super) raw_episode_stop_timestamp_ns: &'a mut Option<i64>,
    pub(super) raw_episode_duration_ns: &'a mut Option<i64>,
    pub(super) minimum_duration_qualified: &'a mut Option<bool>,
    pub(super) minimum_duration_aggregate_eligible: &'a mut bool,
    pub(super) minimum_duration_blank_applied: &'a mut bool,
    pub(super) concurrent_subinterval_floor_blank_applied: &'a mut bool,
    pub(super) minimum_duration_drop_pending: &'a mut bool,
    pub(super) maximum_duration_qualified: &'a mut Option<bool>,
    pub(super) maximum_duration_aggregate_eligible: &'a mut bool,
    pub(super) maximum_duration_drop_pending: &'a mut bool,
    pub(super) maximum_duration_trimmed_ns: &'a mut Option<i64>,
    pub(super) effective_endpoint_reason: &'a mut Option<b06::MaximumDurationEffectiveEndpointReason>,
    pub(super) screen_usage_last_activity_timestamp_ns: &'a mut Option<i64>,
    pub(super) screen_usage_tail_gap_seconds: &'a mut Option<f64>,
    pub(super) valid_app_usage_time_gap_hours: &'a mut f64,
    pub(super) any_app_usage_time_gap_hours: &'a mut f64,
}

/// Classification: the labels and derived categorical columns.
#[allow(dead_code)]
pub(super) struct RowClassificationView<'a> {
    pub(super) study_id: &'a mut SharedString,
    pub(super) participant_id: &'a mut SharedString,
    pub(super) possible_device_model: &'a mut SharedString,
    pub(super) username: &'a mut SharedString,
    pub(super) application_label: &'a mut SharedString,
    pub(super) interaction_type: &'a mut SharedString,
    pub(super) app_package_name: &'a mut SharedString,
    pub(super) any_app_usage_flags: &'a mut SharedString,
    pub(super) screen_usage_end_reason: &'a mut Option<SharedString>,
    pub(super) app_usage_end_reason: &'a mut Option<SharedString>,
    pub(super) screen_interval_id: &'a mut Option<SharedString>,
    pub(super) schoedel_completion: &'a mut Option<b05::SchoedelCompletion>,
    pub(super) usage_session_id: &'a mut Option<i64>,
    pub(super) screen_usage_end_reason_confidence: &'a mut Option<f64>,
    pub(super) screen_usage_stop_event_type: &'a mut Option<SharedString>,
    pub(super) screen_usage_foreground_app_package: &'a mut Option<SharedString>,
    pub(super) screen_usage_app_observed: &'a mut Option<bool>,
    pub(super) screen_usage_session_classification: &'a mut Option<SharedString>,
    pub(super) screen_usage_apps_forcing_screen_open_label: &'a mut Option<SharedString>,
    pub(super) screen_usage_lock_screen_only: &'a mut Option<u8>,
    pub(super) valid_app_new_engage_30s: &'a mut i32,
    pub(super) valid_app_new_engage_custom: &'a mut i32,
    pub(super) valid_app_switched_app: &'a mut i32,
    pub(super) any_app_new_engage_30s: &'a mut i32,
    pub(super) any_app_new_engage_custom: &'a mut i32,
    pub(super) any_app_switched_app: &'a mut i32,
    pub(super) genre_id_scraped: &'a mut Option<SharedString>,
    pub(super) broad_app_category: &'a mut Option<SharedString>,
    pub(super) codebook_fields: &'a mut Arc<Vec<Option<String>>>,
    pub(super) codebook_genre_fields_cleared: &'a mut bool,
    pub(super) usage_layer: &'a mut Option<SharedString>,
    pub(super) micro_use_classification: &'a mut Option<MicroUseClassification>,
}

pub(super) struct RowBucketViews<'a> {
    pub(super) identity: RowIdentityView<'a>,
    pub(super) temporal: RowTemporalView<'a>,
    pub(super) classification: RowClassificationView<'a>,
}

/// The one written statement of which field belongs to which checkpoint
/// component, kept beside `encode_row_checkpoint_parts`, which hashes the same
/// partition.
///
/// Exhaustive by construction: the pattern names every `RowData` field, so a
/// new field fails to compile until it is placed; each `&mut` binding is moved
/// into exactly one view, so placing a field in two buckets is a use-after-move.
#[deny(unused_variables)]
pub(super) fn split_row_buckets(data: &mut RowData) -> RowBucketViews<'_> {
    let RowData {
        source_data_rows,
        lineage_searches,
        study_id,
        participant_id,
        possible_device_model,
        username,
        application_label,
        interaction_type,
        app_package_name,
        event_timestamp_ns,
        timezone,
        data_time_gap_hours,
        date,
        day,
        weekday_mf,
        weekday_mth,
        weekday_su_th,
        hour,
        quarter,
        start_timestamp_ns,
        stop_timestamp_ns,
        duration_seconds,
        duration_minutes,
        raw_episode_start_timestamp_ns,
        raw_episode_stop_timestamp_ns,
        raw_episode_duration_ns,
        micro_use_classification,
        minimum_duration_qualified,
        minimum_duration_aggregate_eligible,
        minimum_duration_blank_applied,
        concurrent_subinterval_floor_blank_applied,
        minimum_duration_drop_pending,
        maximum_duration_qualified,
        maximum_duration_aggregate_eligible,
        maximum_duration_drop_pending,
        maximum_duration_trimmed_ns,
        effective_endpoint_reason,
        screen_usage_end_reason,
        app_usage_end_reason,
        screen_interval_id,
        schoedel_completion,
        usage_session_id,
        screen_usage_end_reason_confidence,
        screen_usage_stop_event_type,
        screen_usage_last_activity_timestamp_ns,
        screen_usage_tail_gap_seconds,
        screen_usage_foreground_app_package,
        screen_usage_app_observed,
        screen_usage_session_classification,
        screen_usage_apps_forcing_screen_open_label,
        screen_usage_lock_screen_only,
        any_app_usage_flags,
        valid_app_new_engage_30s,
        valid_app_new_engage_custom,
        valid_app_switched_app,
        valid_app_usage_time_gap_hours,
        any_app_new_engage_30s,
        any_app_new_engage_custom,
        any_app_switched_app,
        any_app_usage_time_gap_hours,
        genre_id_scraped,
        broad_app_category,
        codebook_fields,
        codebook_genre_fields_cleared,
        index,
        usage_layer,
    } = data;
    RowBucketViews {
        identity: RowIdentityView {
            source_data_rows,
            lineage_searches,
            index,
        },
        temporal: RowTemporalView {
            event_timestamp_ns,
            timezone,
            data_time_gap_hours,
            date,
            day,
            weekday_mf,
            weekday_mth,
            weekday_su_th,
            hour,
            quarter,
            start_timestamp_ns,
            stop_timestamp_ns,
            duration_seconds,
            duration_minutes,
            raw_episode_start_timestamp_ns,
            raw_episode_stop_timestamp_ns,
            raw_episode_duration_ns,
            minimum_duration_qualified,
            minimum_duration_aggregate_eligible,
            minimum_duration_blank_applied,
            concurrent_subinterval_floor_blank_applied,
            minimum_duration_drop_pending,
            maximum_duration_qualified,
            maximum_duration_aggregate_eligible,
            maximum_duration_drop_pending,
            maximum_duration_trimmed_ns,
            effective_endpoint_reason,
            screen_usage_last_activity_timestamp_ns,
            screen_usage_tail_gap_seconds,
            valid_app_usage_time_gap_hours,
            any_app_usage_time_gap_hours,
        },
        classification: RowClassificationView {
            study_id,
            participant_id,
            possible_device_model,
            username,
            application_label,
            interaction_type,
            app_package_name,
            any_app_usage_flags,
            screen_usage_end_reason,
            app_usage_end_reason,
            screen_interval_id,
            schoedel_completion,
            usage_session_id,
            screen_usage_end_reason_confidence,
            screen_usage_stop_event_type,
            screen_usage_foreground_app_package,
            screen_usage_app_observed,
        screen_usage_session_classification,
            screen_usage_apps_forcing_screen_open_label,
            screen_usage_lock_screen_only,
            valid_app_new_engage_30s,
            valid_app_new_engage_custom,
            valid_app_switched_app,
            any_app_new_engage_30s,
            any_app_new_engage_custom,
            any_app_switched_app,
            genre_id_scraped,
            broad_app_category,
            codebook_fields,
            codebook_genre_fields_cleared,
            usage_layer,
            micro_use_classification,
        },
    }
}

impl std::ops::Deref for Row {
    type Target = RowData;

    fn deref(&self) -> &Self::Target {
        &self.0.data
    }
}

impl std::ops::DerefMut for Row {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.edit_all()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDataRowRange {
    pub first: u32,
    pub last: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageSearchEvidence {
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub protocol_version: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub reason: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub index_space: Arc<String>,
    #[serde(
        serialize_with = "serialize_shared_arc_string",
        deserialize_with = "deserialize_shared_arc_string"
    )]
    pub start_participant_id: Arc<String>,
    pub start_event_index: u32,
    pub end_event_index_exclusive: u32,
    pub candidate_event_count: u32,
    pub candidate_chain_digest: LineageSearchDigest,
}

/// Raw BLAKE3 output that retains the public `blake3:<hex>` wire format
/// without allocating a unique 71-byte string for every searched event range.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LineageSearchDigest(pub(super) [u8; 32]);

impl LineageSearchDigest {
    pub(super) fn from_hasher(hasher: CheckpointHasher) -> Self {
        Self(*hasher.finalize().as_bytes())
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        let hex = value
            .strip_prefix("blake3:")
            .ok_or_else(|| "lineage search digest does not use blake3".to_string())?;
        let mut digest = [0_u8; 32];
        hex::decode_to_slice(hex, &mut digest)
            .map_err(|error| format!("decode lineage search digest: {error}"))?;
        Ok(Self(digest))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub(super) fn encoded(self) -> [u8; 71] {
        encode_blake3_digest(self.0)
    }
}

impl std::fmt::Display for LineageSearchDigest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let encoded = self.encoded();
        formatter.write_str(std::str::from_utf8(&encoded).expect("BLAKE3 digest is ASCII"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SourceDataRows(pub(super) Arc<SmallVec<[SourceDataRowRange; 2]>>);

impl Default for SourceDataRows {
    fn default() -> Self {
        static EMPTY: OnceLock<Arc<SmallVec<[SourceDataRowRange; 2]>>> = OnceLock::new();
        Self(Arc::clone(EMPTY.get_or_init(|| Arc::new(SmallVec::new()))))
    }
}

impl SourceDataRows {
    pub(super) fn single(row: u32) -> Self {
        let mut rows = SmallVec::new();
        rows.push(SourceDataRowRange {
            first: row,
            last: row,
        });
        Self(Arc::new(rows))
    }

    pub(super) fn len(&self) -> usize {
        self.0
            .iter()
            .map(|range| (range.last - range.first) as usize + 1)
            .sum()
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = u32> + '_ {
        self.0.iter().flat_map(|range| range.first..=range.last)
    }

    #[cfg(test)]
    pub(super) fn contains(&self, row: u32) -> bool {
        self.0
            .binary_search_by(|range| {
                if row < range.first {
                    std::cmp::Ordering::Greater
                } else if row > range.last {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .is_ok()
    }

    pub(super) fn ranges(&self) -> &[SourceDataRowRange] {
        &self.0
    }

    pub(super) fn merge(&mut self, additional: &Self) {
        if additional.0.is_empty() {
            return;
        }
        if self.0.is_empty() {
            self.0.clone_from(&additional.0);
            return;
        }

        let mut merged =
            SmallVec::<[SourceDataRowRange; 2]>::with_capacity(self.0.len() + additional.0.len());
        let mut left = 0;
        let mut right = 0;
        while left < self.0.len() || right < additional.0.len() {
            let next = if right == additional.0.len()
                || (left < self.0.len() && self.0[left].first <= additional.0[right].first)
            {
                let range = self.0[left];
                left += 1;
                range
            } else {
                let range = additional.0[right];
                right += 1;
                range
            };
            if let Some(current) = merged.last_mut() {
                if next.first <= current.last.saturating_add(1) {
                    current.last = current.last.max(next.last);
                    continue;
                }
            }
            merged.push(next);
        }
        self.0 = Arc::new(merged);
    }

    pub(super) fn cmp_expanded(&self, other: &Self) -> std::cmp::Ordering {
        self.iter().cmp(other.iter())
    }

    #[cfg(test)]
    pub(super) fn to_vec(&self) -> Vec<u32> {
        self.iter().collect()
    }
}

/// Internal Rust-side result; not directly returned across the boundary.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineV2Result {
    /// Output artifacts are budgeted payload chunks, never a second
    /// contiguous copy: consumers stream them or materialize transiently.
    pub app_csv_bytes: PayloadBytes,
    pub screen_csv_bytes: PayloadBytes,
    pub day_coverage_csv_bytes: PayloadBytes,
    pub compliance_csv_bytes: PayloadBytes,
    pub credited_app_csv_bytes: PayloadBytes,
    pub notification_contact_csv_bytes: PayloadBytes,
    pub polled_emulation_csv_bytes: PayloadBytes,
    pub interval_expansion_csv_bytes: PayloadBytes,
    pub review_summary_json_bytes: PayloadBytes,
    pub visualization_data_json_bytes: PayloadBytes,
    pub aggregate_csv_outputs: Arc<Vec<aggregates::AggregateCsvOutput<PayloadBytes>>>,
    pub row_lineage: Arc<Vec<PipelineRowLineage>>,
    pub opener_set_evidence: OpenerSetEvidence,
    pub foundational_semantics_evidence: FoundationalSemanticsEvidence,
    /// B06 receipt. `None` for the omitted shape so the pre-B06 wire form is
    /// unchanged; every explicit selection (including strategy-native) has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_duration_evidence: Option<b06::MaximumDurationEvidence>,
    pub eyes_tagged_fau_evidence: Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eyes_input_partition_preflight: Option<EyesInputPartitionPreflightResult>,
    pub b05_schoedel_preflight: B05SchoedelPreflightResult,
    /// Live, producer-seam validation marker. It is intentionally absent from
    /// the result wire form; deserialization installs the invalid sentinel so
    /// a round-tripped result cannot self-certify scientific evidence.
    #[serde(skip, default)]
    pub(super) b05_schoedel_validation_context: B05SchoedelValidationContext,
    /// Active-EYES producer witness. It is skipped from the result wire form
    /// and deserializes to an invalid sentinel.
    #[serde(skip, default)]
    pub(super) eyes_tagged_fau_validation_context: EyesTaggedFauValidationContext,
    pub original_row_count: u32,
    pub processed_row_count: u32,
    pub app_row_count: u32,
    pub screen_row_count: u32,
    pub day_coverage_row_count: u32,
    pub compliance_row_count: u32,
    pub credited_app_row_count: u32,
    pub notification_contact_row_count: u32,
    pub polled_emulation_row_count: u32,
    pub interval_expansion_row_count: u32,
    pub duplicate_timestamps_corrected: u32,
    pub exact_duplicate_rows_removed: u32,
    pub available_timezones: Vec<String>,
    pub timezone: String,
    pub timezone_action: String,
    pub rows_before_timezone_handling: u32,
    pub rows_after_timezone_handling: u32,
    pub rows_removed_by_timezone: u32,
    /// Exact retained raw-row membership after timezone filtering and before
    /// any conversion or downstream transformation.
    pub timezone_retained_source_rows_digest: String,
    /// Exact normalized-event state after the timezone policy has resolved its
    /// target and populated local calendar fields, before dedupe/order.
    pub timezone_stage_digest: String,
    /// Product-local checkpoints for the authored physical query groups.
    /// These are complete hashes of the state emitted by that specific stage,
    /// not a copy of the final fused-pipeline digest. They let the incremental
    /// scheduler stop a configuration perturbation as soon as the actual stage
    /// value converges while retaining the fused Rust implementation.
    pub workflow_query_group_digests: BTreeMap<String, String>,
    /// Typed decomposition of every workflow checkpoint. The terminal digest
    /// above commits to these exact component digests.
    pub workflow_query_group_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
    /// Exact results at every registered physical preprocessing query.
    pub workflow_query_digests: BTreeMap<String, String>,
    pub workflow_query_checkpoints: BTreeMap<String, WorkflowCheckpoint>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCheckpoint {
    pub protocol_version: String,
    pub subject_id: String,
    pub row_membership_digest: String,
    pub row_order_digest: String,
    pub temporal_state_digest: String,
    pub classification_digest: String,
    pub payload_digest: String,
    pub schema_digest: String,
    pub terminal_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRowLineage {
    #[serde(deserialize_with = "deserialize_shared_arc_string")]
    pub output_kind: Arc<String>,
    pub output_row_index: u32,
    pub source_data_row_ranges: Vec<SourceDataRowRange>,
    pub source_data_row_count: u32,
    pub searches: Vec<LineageSearchEvidence>,
    #[serde(deserialize_with = "deserialize_shared_arc_string")]
    pub terminal_query_group: Arc<String>,
    /// The screen-interval and Schoedel members, boxed: the rows of the app,
    /// credited, and neutral-strategy screen outputs carry none of them and
    /// hold one pointer instead of seven options (a 580k-row export has
    /// millions of such rows). Flattened, so the wire shape is the same seven
    /// optional camelCase members it always was; a row without them reads
    /// back as `None`, never as a box of seven `None`s.
    #[serde(flatten, deserialize_with = "deserialize_screen_lineage")]
    pub screen: Option<Box<ScreenIntervalLineage>>,
}

/// The screen-interval and Schoedel members of a [`PipelineRowLineage`].
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenIntervalLineage {
    /// Stable scientific subject for a source-B05 screen interval or a
    /// Schoedel app episode's immutable enclosing interval. Compatibility
    /// rows omit this field entirely on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_interval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_construction_strategy_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_interval_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_interval_close_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_interval_left_censored: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_interval_right_censored: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schoedel_completion: Option<String>,
}

impl ScreenIntervalLineage {
    /// Heap bytes of the five owned option strings.
    pub(super) fn owned_string_bytes(&self) -> usize {
        self.screen_interval_id.as_ref().map_or(0, String::capacity)
            + self
                .screen_construction_strategy_id
                .as_ref()
                .map_or(0, String::capacity)
            + self.screen_interval_kind.as_ref().map_or(0, String::capacity)
            + self
                .screen_interval_close_reason
                .as_ref()
                .map_or(0, String::capacity)
            + self.schoedel_completion.as_ref().map_or(0, String::capacity)
    }

    /// `None` when every member is absent, so a row that carries nothing
    /// holds no box.
    pub(super) fn boxed(self) -> Option<Box<Self>> {
        (self != Self::default()).then(|| Box::new(self))
    }
}

impl PipelineRowLineage {
    pub fn screen_interval_id(&self) -> Option<&str> {
        self.screen.as_ref()?.screen_interval_id.as_deref()
    }

    pub fn screen_construction_strategy_id(&self) -> Option<&str> {
        self.screen.as_ref()?.screen_construction_strategy_id.as_deref()
    }

    pub fn screen_interval_kind(&self) -> Option<&str> {
        self.screen.as_ref()?.screen_interval_kind.as_deref()
    }

    pub fn screen_interval_close_reason(&self) -> Option<&str> {
        self.screen.as_ref()?.screen_interval_close_reason.as_deref()
    }

    pub fn screen_interval_left_censored(&self) -> Option<bool> {
        self.screen.as_ref()?.screen_interval_left_censored
    }

    pub fn screen_interval_right_censored(&self) -> Option<bool> {
        self.screen.as_ref()?.screen_interval_right_censored
    }

    pub fn schoedel_completion(&self) -> Option<&str> {
        self.screen.as_ref()?.schoedel_completion.as_deref()
    }

    /// Heap bytes beyond the struct array and its two vectors, for the
    /// payload budget: the screen box and its five owned option strings.
    /// The interned `Arc<String>` fields are shared and not charged here.
    /// A method rather than a free function: the workflow field-use scan
    /// attributes field access in free functions reachable from a product
    /// step to that step, and budget accounting is not a data read.
    pub(crate) fn owned_heap_bytes(&self) -> usize {
        self.screen.as_ref().map_or(0, |screen| {
            std::mem::size_of::<ScreenIntervalLineage>() + screen.owned_string_bytes()
        })
    }
}

pub const B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION: &str = "chronicle-b05-schoedel-preflight/v1";

pub const EYES_INPUT_PARTITION_PREFLIGHT_PROTOCOL_VERSION: &str =
    "chronicle-eyes-input-partition-preflight/v2";

pub const B05_RETAINED_RAW_INPUT_REQUIRED_ERROR: &str =
    "b05_prepared_execution_error:retained_raw_input_required";

pub const RETAINED_RAW_INPUT_REQUIRED_FOR_DECODE_ERROR: &str =
    "decode_source_records_error:retained_raw_input_required";

pub const EYES_RETAINED_RAW_INPUT_REQUIRED_ERROR: &str =
    "eyes_input_partition_preflight_error:retained_raw_input_required";

/// Input-dependent scientific decision available before the ordinary app
/// reconstruction cone runs. A source-method refusal is represented inside
/// the typed receipts and is therefore not conflated with an executable run
/// that happens to yield zero intervals or episodes.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B05SchoedelPreflightResult {
    pub protocol_version: String,
    pub disposition: ScientificPreflightDisposition,
    /// Runtime JCS request digest when supplied, otherwise the explicitly
    /// labeled kernel component digest used by direct callers.
    pub options_digest: String,
    /// Narrow router identity: activation, selected strategies, and the
    /// omitted-versus-explicit relation bit. It deliberately excludes the
    /// inputs owned by the raw B05 and retained-app computations below.
    pub component_options_digest: String,
    /// Options read by the raw source-B05 constructor. Canonical Chronicle
    /// rows are bound separately by their screen-skeleton checkpoint.
    pub screen_component_options_digest: String,
    /// Options read by Schoedel after B01/B02. Its input stream and selected
    /// B05 interval digest are separate stage inputs, not folded into this
    /// options-only identity.
    pub schoedel_component_options_digest: String,
    pub options_digest_origin: B05OptionsDigestOrigin,
    pub requested_screen_strategy_id: ScreenSessionConstructionStrategyId,
    pub effective_screen_strategy_id: ScreenSessionConstructionStrategyId,
    /// Canonical ontology ids are carried directly so runtime/browser proof
    /// does not have to infer the requested or effective app arm from options.
    pub requested_episode_strategy_id: String,
    pub effective_episode_strategy_id: Option<String>,
    pub screen_construction_phase: B05ComputationPhase,
    pub schoedel_reconstruction_phase: B05ComputationPhase,
    pub screen_construction: Option<b05::ScreenConstructionOutput>,
    pub schoedel_reconstruction: Option<b05::SchoedelReconstructionOutput>,
}

pub const B05_SCHOEDEL_VALIDATION_RECEIPT_PROTOCOL_VERSION: &str =
    "chronicle-b05-schoedel-validation-receipt/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum B05SchoedelValidationStatus {
    InvalidUnvalidated,
    NotApplicable,
    ScreenValidated,
    ScreenAndSchoedelValidated,
}

/// PHI-free attestation emitted only after kernel-owned validation of the
/// finalized B05/Schoedel evidence. The receipt is not serialized as part of
/// `PipelineV2Result`; runtime publishes its exact JCS as a dedicated artifact
/// after calling [`validated_b05_schoedel_receipt`].
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B05SchoedelValidationReceipt {
    pub protocol_version: String,
    pub status: B05SchoedelValidationStatus,
    pub verified_raw_input_digest: String,
    pub decoded_input_row_count: u64,
    pub request_options_digest: String,
    pub options_digest_origin: B05OptionsDigestOrigin,
    pub router_component_options_digest: String,
    pub screen_component_options_digest: String,
    pub schoedel_component_options_digest: String,
    pub foundational_semantics_evidence_jcs_digest: String,
    pub foundational_episode_count: u32,
    pub foundational_bounded_episode_count: u32,
    pub foundational_unbounded_episode_count: u32,
    pub minimum_duration_excluded_episode_count: u32,
    pub concurrent_generated_subinterval_count: u32,
    pub zero_duration_removed_row_count: u32,
    pub finalized_preflight_jcs_digest: String,
    pub selected_b05_strategy_id: ScreenSessionConstructionStrategyId,
    pub screen_interval_digest: Option<String>,
    pub screen_construction_output_jcs_digest: Option<String>,
    pub screen_scientific_evidence_digest: Option<String>,
    pub trusted_schoedel_retained_event_count: Option<u64>,
    pub schoedel_decisive_participant_count: u32,
    pub schoedel_reconstruction_output_jcs_digest: Option<String>,
    pub schoedel_scientific_evidence_digest: Option<String>,
    pub validation_digest: String,
}

impl Default for B05SchoedelValidationReceipt {
    fn default() -> Self {
        Self {
            protocol_version: String::new(),
            status: B05SchoedelValidationStatus::InvalidUnvalidated,
            verified_raw_input_digest: String::new(),
            decoded_input_row_count: 0,
            request_options_digest: String::new(),
            options_digest_origin: B05OptionsDigestOrigin::KernelRouterComponent,
            router_component_options_digest: String::new(),
            screen_component_options_digest: String::new(),
            schoedel_component_options_digest: String::new(),
            foundational_semantics_evidence_jcs_digest: String::new(),
            foundational_episode_count: 0,
            foundational_bounded_episode_count: 0,
            foundational_unbounded_episode_count: 0,
            minimum_duration_excluded_episode_count: 0,
            concurrent_generated_subinterval_count: 0,
            zero_duration_removed_row_count: 0,
            finalized_preflight_jcs_digest: String::new(),
            selected_b05_strategy_id: ScreenSessionConstructionStrategyId::default(),
            screen_interval_digest: None,
            screen_construction_output_jcs_digest: None,
            screen_scientific_evidence_digest: None,
            trusted_schoedel_retained_event_count: None,
            schoedel_decisive_participant_count: 0,
            schoedel_reconstruction_output_jcs_digest: None,
            schoedel_scientific_evidence_digest: None,
            validation_digest: String::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct B05SchoedelValidationContext {
    pub(super) receipt: B05SchoedelValidationReceipt,
    pub(super) result_original_row_count: u32,
    pub(super) foundational_semantics_evidence_jcs_digest: String,
    pub(super) expected_options_digest: String,
    pub(super) expected_options_digest_origin: B05OptionsDigestOrigin,
}

impl Default for B05SchoedelValidationContext {
    fn default() -> Self {
        Self {
            receipt: B05SchoedelValidationReceipt::default(),
            result_original_row_count: 0,
            foundational_semantics_evidence_jcs_digest: String::new(),
            expected_options_digest: String::new(),
            expected_options_digest_origin: B05OptionsDigestOrigin::KernelRouterComponent,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct SchoedelValidationWitness {
    pub(super) trusted_retained_event_count: u64,
    pub(super) decisive_participant_ids: BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum B05ComputationPhase {
    NotApplicable,
    DeferredCanonicalBaseline,
    PreparedRawSourceArm,
    DeferredRetainedAppStream,
    Finalized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScientificPreflightDisposition {
    NotApplicable,
    Executable,
    Refused,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesInputPartitionRefusalReason {
    UnsupportedInputChunk,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct EyesInputPartitionPreflightIdentity<'a> {
    pub verified_request_options_digest: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesInputPartitionOptionsDigestOrigin {
    VerifiedRequestJcs,
    KernelComponent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EyesInputPartitionPreflightError {
    InvalidVerifiedRequestOptionsDigest,
}

impl std::fmt::Display for EyesInputPartitionPreflightError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidVerifiedRequestOptionsDigest => formatter.write_str(
                "eyes_input_partition_preflight_identity_error:invalid_request_options_digest",
            ),
        }
    }
}

impl std::error::Error for EyesInputPartitionPreflightError {}

impl EyesInputPartitionRefusalReason {
    pub const fn canonical_id(self) -> &'static str {
        match self {
            Self::UnsupportedInputChunk => "unsupported_input_chunk",
        }
    }
}

/// Typed EYES applicability at the participant-partition boundary. Literal
/// participant identities and deterministic commitments derived from them are
/// deliberately private to execution; the public receipt exposes only count.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesInputPartitionPreflightResult {
    pub protocol_version: String,
    pub disposition: ScientificPreflightDisposition,
    pub input_digest: String,
    pub options_digest: String,
    pub options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
    pub requested_episode_strategy_id: String,
    pub effective_episode_strategy_id: Option<String>,
    pub relation: Option<b05::ScientificRelation>,
    pub refusal_reason: Option<EyesInputPartitionRefusalReason>,
    pub refusal_detail: Option<String>,
    pub fragmented_participant_count: u32,
    pub resolution_digest: String,
}

pub const EYES_TAGGED_FAU_VALIDATION_RECEIPT_PROTOCOL_VERSION: &str =
    "chronicle-eyes-tagged-fau-validation-receipt/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EyesTaggedFauValidationStatus {
    InvalidUnvalidated,
    Validated,
}

/// PHI-free attestation for an active EYES execution. Literal participant
/// identities remain only in the authorized full evidence artifact and the
/// skipped live witness; this receipt exposes aggregate counts only.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyesTaggedFauValidationReceipt {
    pub protocol_version: String,
    pub status: EyesTaggedFauValidationStatus,
    pub verified_raw_input_digest: String,
    pub decoded_input_row_count: u64,
    pub request_options_digest: String,
    pub options_digest_origin: EyesInputPartitionOptionsDigestOrigin,
    pub effective_options: crate::eyes_complement::EyesOptions,
    pub source_version: String,
    pub source_commit: String,
    pub source_license_status: String,
    pub reference_defect_repair_ids: Vec<String>,
    pub headline_projection: crate::eyes_complement::EyesHeadlineProjection,
    pub reference_primary_secondary_concurrency_ported: bool,
    pub pickup_export_exposed: bool,
    pub limitations: Vec<crate::eyes_complement::EyesPartialReplayLimitation>,
    pub final_partition_resolution_digest: String,
    pub participant_count: u32,
    pub device_state_block_count: u64,
    pub episode_count: u64,
    pub app_usage_chunk_count: u64,
    pub fragment_count: u64,
    pub credited_fragment_count: u64,
    pub chunk_endpoint_count: u64,
    pub pickup_export_row_count: u64,
    pub tagged_fau_artifact_jcs_digest: String,
    pub validation_digest: String,
}

impl Default for EyesTaggedFauValidationReceipt {
    fn default() -> Self {
        Self {
            protocol_version: String::new(),
            status: EyesTaggedFauValidationStatus::InvalidUnvalidated,
            verified_raw_input_digest: String::new(),
            decoded_input_row_count: 0,
            request_options_digest: String::new(),
            options_digest_origin: EyesInputPartitionOptionsDigestOrigin::KernelComponent,
            effective_options: crate::eyes_complement::EyesOptions::default(),
            source_version: String::new(),
            source_commit: String::new(),
            source_license_status: String::new(),
            reference_defect_repair_ids: Vec::new(),
            headline_projection: crate::eyes_complement::EyesHeadlineProjection::ActiveOnly,
            reference_primary_secondary_concurrency_ported: false,
            pickup_export_exposed: false,
            limitations: Vec::new(),
            final_partition_resolution_digest: String::new(),
            participant_count: 0,
            device_state_block_count: 0,
            episode_count: 0,
            app_usage_chunk_count: 0,
            fragment_count: 0,
            credited_fragment_count: 0,
            chunk_endpoint_count: 0,
            pickup_export_row_count: 0,
            tagged_fau_artifact_jcs_digest: String::new(),
            validation_digest: String::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct EyesTaggedFauValidationContext {
    pub(super) receipt: EyesTaggedFauValidationReceipt,
    pub(super) expected_participant_ids: BTreeSet<String>,
    pub(super) expected_raw_input_digest: String,
    pub(super) expected_options_digest: String,
    pub(super) expected_options_digest_origin: Option<EyesInputPartitionOptionsDigestOrigin>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum B05OptionsDigestOrigin {
    VerifiedRequestJcs,
    KernelRouterComponent,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct B05PreflightIdentity<'a> {
    pub verified_request_options_digest: Option<&'a str>,
    pub verified_evidence_artifact_digest: Option<&'a str>,
    pub verified_evidence_assignment_digest: Option<&'a str>,
}

/// Input-boundary facts supplied by the execution layer independently of the
/// scientific capability sidecar and exact request-options identity.
#[derive(Clone, Copy, Debug, Default)]
pub struct ParticipantInputBoundary<'a> {
    pub fragmented_participant_ids: &'a [String],
}

/// Backward-compatible name for B05 callers; the boundary itself is shared
/// execution metadata and is not owned by B05.
pub type B05InputBoundary<'a> = ParticipantInputBoundary<'a>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum B05PreflightIdentityField {
    RequestOptionsDigest,
    EvidenceArtifactDigest,
    EvidenceAssignmentDigest,
}

impl B05PreflightIdentityField {
    pub(super) fn canonical_id(self) -> &'static str {
        match self {
            Self::RequestOptionsDigest => "request_options_digest",
            Self::EvidenceArtifactDigest => "evidence_artifact_digest",
            Self::EvidenceAssignmentDigest => "evidence_assignment_digest",
        }
    }
}

#[derive(Debug)]
pub enum B05PreflightError {
    InvalidPipelineOptions(PipelineV2OptionsValidationError),
    CapabilityEvidence(b05::CapabilityEvidenceError),
    InvalidVerifiedDigest(B05PreflightIdentityField),
    EvidenceIdentityWithoutArtifact,
    EvidenceArtifactDigestMismatch,
    EvidenceAssignmentDigestMismatch,
    InvalidVerifiedRawInputDigest,
    RawInputDigestMismatch,
    ScreenSubstrateOptionsMismatch,
}

impl std::fmt::Display for B05PreflightError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPipelineOptions(error) => error.fmt(formatter),
            Self::CapabilityEvidence(error) => error.fmt(formatter),
            Self::InvalidVerifiedDigest(field) => write!(
                formatter,
                "b05_preflight_identity_error:invalid_{}",
                field.canonical_id(),
            ),
            Self::EvidenceIdentityWithoutArtifact => formatter
                .write_str("b05_preflight_identity_error:evidence_identity_without_artifact"),
            Self::EvidenceArtifactDigestMismatch => formatter
                .write_str("b05_preflight_identity_error:evidence_artifact_digest_mismatch"),
            Self::EvidenceAssignmentDigestMismatch => formatter
                .write_str("b05_preflight_identity_error:evidence_assignment_digest_mismatch"),
            Self::InvalidVerifiedRawInputDigest => {
                formatter.write_str("b05_preflight_identity_error:invalid_raw_input_digest")
            }
            Self::RawInputDigestMismatch => {
                formatter.write_str("b05_preflight_identity_error:raw_input_digest_mismatch")
            }
            Self::ScreenSubstrateOptionsMismatch => formatter
                .write_str("b05_preflight_identity_error:screen_substrate_options_mismatch"),
        }
    }
}

impl std::error::Error for B05PreflightError {}

impl From<b05::CapabilityEvidenceError> for B05PreflightError {
    fn from(error: b05::CapabilityEvidenceError) -> Self {
        Self::CapabilityEvidence(error)
    }
}

/// One kernel-owned preparation object is reused by preflight publication and
/// execution. Raw decoded rows stay private and are never serialized into a
/// manifest; the evidence projection is deterministic and persistable.
#[derive(Clone)]
pub struct B05SchoedelPreparedInput {
    pub(super) raw_input_sha256: String,
    pub(super) component_options_digest: String,
    pub(super) screen_component_options_digest: String,
    pub(super) schoedel_component_options_digest: String,
    pub(super) evidence_artifact_digest: Option<String>,
    pub(super) verified_request_options_digest: Option<String>,
    pub(super) verified_evidence_artifact_digest: Option<String>,
    pub(super) verified_evidence_assignment_digest: Option<String>,
    pub(super) fragmented_participants: BTreeSet<String>,
    pub(super) raw_rows: Arc<Vec<RawRow>>,
    pub(super) parsed_capability_evidence: Option<Arc<b05::ParsedCapabilityEvidence>>,
    // Keep the request-neutral source-arm product even when a router rebind
    // makes the public evidence projection inactive and therefore omits it.
    // This is what makes chained active -> inactive -> active rebinding reuse
    // the original decode/parse/state-machine substrate exactly.
    pub(super) source_screen_construction: Option<b05::ScreenConstructionOutput>,
    pub(super) evidence: B05SchoedelPreflightResult,
}

/// Reusable, request-neutral raw B05 substrate. It owns one decoded raw-row
/// table and one capability/state-machine result; cheap request rebinding can
/// then change router provenance or downstream B01/B02 semantics without
/// parsing or replaying this stage.
#[derive(Clone)]
pub struct B05ScreenPreparedSubstrate {
    pub(super) raw_input_sha256: String,
    pub(super) screen_component_options_digest: String,
    pub(super) selected_strategy_id: ScreenSessionConstructionStrategyId,
    pub(super) evidence_artifact_digest: Option<String>,
    pub(super) verified_evidence_artifact_digest: Option<String>,
    pub(super) verified_evidence_assignment_digest: Option<String>,
    pub(super) fragmented_participants: BTreeSet<String>,
    pub(super) raw_rows: Arc<Vec<RawRow>>,
    pub(super) parsed_capability_evidence: Option<Arc<b05::ParsedCapabilityEvidence>>,
    pub(super) source_screen_construction: Option<b05::ScreenConstructionOutput>,
}

impl PartialEq for B05ScreenPreparedSubstrate {
    fn eq(&self, other: &Self) -> bool {
        self.raw_input_sha256 == other.raw_input_sha256
            && self.screen_component_options_digest == other.screen_component_options_digest
            && self.selected_strategy_id == other.selected_strategy_id
            && self.evidence_artifact_digest == other.evidence_artifact_digest
            && self.verified_evidence_artifact_digest == other.verified_evidence_artifact_digest
            && self.verified_evidence_assignment_digest == other.verified_evidence_assignment_digest
            && self.fragmented_participants == other.fragmented_participants
            && self.parsed_capability_evidence == other.parsed_capability_evidence
            && self.source_screen_construction == other.source_screen_construction
    }
}

impl Eq for B05ScreenPreparedSubstrate {}

impl B05ScreenPreparedSubstrate {
    pub fn raw_input_sha256(&self) -> &str {
        &self.raw_input_sha256
    }

    pub fn selected_strategy_id(&self) -> ScreenSessionConstructionStrategyId {
        self.selected_strategy_id
    }
}

impl B05SchoedelPreparedInput {
    pub fn evidence(&self) -> &B05SchoedelPreflightResult {
        &self.evidence
    }

    pub fn into_evidence(self) -> B05SchoedelPreflightResult {
        self.evidence
    }
}

impl B05SchoedelPreflightResult {
    pub fn is_executable(&self) -> bool {
        self.disposition == ScientificPreflightDisposition::Executable
    }

    pub fn is_refused(&self) -> bool {
        self.disposition == ScientificPreflightDisposition::Refused
    }
}

impl Default for B05SchoedelPreflightResult {
    fn default() -> Self {
        let component_options_digest = sha256_wire(&[]);
        Self {
            protocol_version: B05_SCHOEDEL_PREFLIGHT_PROTOCOL_VERSION.into(),
            disposition: ScientificPreflightDisposition::NotApplicable,
            options_digest: component_options_digest.clone(),
            component_options_digest,
            screen_component_options_digest: sha256_wire(&[]),
            schoedel_component_options_digest: sha256_wire(&[]),
            options_digest_origin: B05OptionsDigestOrigin::KernelRouterComponent,
            requested_screen_strategy_id: ScreenSessionConstructionStrategyId::default(),
            effective_screen_strategy_id: ScreenSessionConstructionStrategyId::default(),
            requested_episode_strategy_id: EpisodeReconstructionStrategy::default()
                .canonical_id()
                .into(),
            effective_episode_strategy_id: None,
            screen_construction_phase: B05ComputationPhase::NotApplicable,
            schoedel_reconstruction_phase: B05ComputationPhase::NotApplicable,
            screen_construction: None,
            schoedel_reconstruction: None,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct B05RouterOptionsIdentity<'a> {
    pub(super) protocol_version: &'static str,
    pub(super) usage_session_mode: &'static str,
    pub(super) screen_session_construction_strategy: &'a str,
    pub(super) screen_session_construction_strategy_explicit: bool,
    pub(super) episode_reconstruction_strategy: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct B05ScreenOptionsIdentity<'a> {
    pub(super) protocol_version: &'static str,
    pub(super) screen_session_construction_strategy: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SchoedelOptionsIdentity<'a> {
    pub(super) protocol_version: &'static str,
    pub(super) screen_session_construction_strategy: &'a str,
    pub(super) episode_reconstruction_strategy: &'a str,
    pub(super) event_retention_set: &'a str,
    pub(super) opener_set: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EyesInputPartitionOptionsIdentity<'a> {
    pub(super) protocol_version: &'static str,
    pub(super) usage_session_mode: &'static str,
    pub(super) episode_reconstruction_strategy: &'a str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum B05PreparedExecutionError {
    RawInputDigestMismatch,
    ComponentOptionsDigestMismatch,
    ScreenComponentOptionsDigestMismatch,
    SchoedelComponentOptionsDigestMismatch,
    RequestOptionsDigestMismatch,
    EvidenceArtifactDigestMismatch,
    EvidenceAssignmentDigestMismatch,
    FragmentedParticipantScopeMismatch,
    ScientificPreflightRefused,
}

impl std::fmt::Display for B05PreparedExecutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::RawInputDigestMismatch => {
                "b05_prepared_execution_error:raw_input_digest_mismatch"
            }
            Self::ComponentOptionsDigestMismatch => {
                "b05_prepared_execution_error:component_options_digest_mismatch"
            }
            Self::ScreenComponentOptionsDigestMismatch => {
                "b05_prepared_execution_error:screen_component_options_digest_mismatch"
            }
            Self::SchoedelComponentOptionsDigestMismatch => {
                "b05_prepared_execution_error:schoedel_component_options_digest_mismatch"
            }
            Self::RequestOptionsDigestMismatch => {
                "b05_prepared_execution_error:request_options_digest_mismatch"
            }
            Self::EvidenceArtifactDigestMismatch => {
                "b05_prepared_execution_error:evidence_artifact_digest_mismatch"
            }
            Self::EvidenceAssignmentDigestMismatch => {
                "b05_prepared_execution_error:evidence_assignment_digest_mismatch"
            }
            Self::FragmentedParticipantScopeMismatch => {
                "b05_prepared_execution_error:fragmented_participant_scope_mismatch"
            }
            Self::ScientificPreflightRefused => {
                "b05_prepared_execution_error:scientific_preflight_refused"
            }
        })
    }
}

impl std::error::Error for B05PreparedExecutionError {}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct RawRow {
    pub(super) source_data_row: u32,
    pub(super) event_timestamp: String,
    pub(super) timezone: String,
    pub(super) app_package_name: String,
    pub(super) interaction_type: String,
    pub(super) application_label: String,
    pub(super) study_id: String,
    pub(super) participant_id: String,
    pub(super) username: String,
}

impl RawRow {
    /// Heap bytes of the eight owned field strings, for the payload budget.
    /// A method rather than a free function: the workflow field-use scan
    /// attributes field access in free functions reachable from a product
    /// step to that step, and budget accounting is not a data read.
    pub(super) fn owned_string_bytes(&self) -> usize {
        self.event_timestamp.capacity()
            + self.timezone.capacity()
            + self.app_package_name.capacity()
            + self.interaction_type.capacity()
            + self.application_label.capacity()
            + self.study_id.capacity()
            + self.participant_id.capacity()
            + self.username.capacity()
    }
}

/// Raw BLAKE3 output for a lineage suffix. Persisting 32-byte hashes avoids
/// storing the 71-byte ASCII form for every event; the protocol spelling is
/// reconstructed on the stack only when another hash consumes it.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct InlineLineageDigest(pub(super) [u8; 32]);

impl InlineLineageDigest {
    pub(super) fn from_hasher(hasher: CheckpointHasher) -> Self {
        Self(*hasher.finalize().as_bytes())
    }

    pub(super) fn encoded(self) -> [u8; 71] {
        encode_blake3_digest(self.0)
    }
}

// ---- Culverhouse trim-and-log -------------------------------------------
//
// Port of `chronicle-preprocessed-cleaning`. Every constant below is one of
// that tool's published defaults, transcribed in
// `docs/workflow/prior-art-vocabulary.md`. They are deliberately NOT contract
// options: the two long bands and the cap are what makes a run citable as
// "Culverhouse trim-and-log", and a retunable band would make the citation
// false. `long_usage_duration_thresholds` remains this app's own configurable
// flag overlay and is untouched by this policy.

/// "Multiple app instances reflect one usage": adjacent same-app rows with a
/// gap no larger than this merge into one.
pub(super) const CULVERHOUSE_SAME_APP_COLLAPSE_NS: i64 = 1_000_000_000;

/// Per-package cap for the bad-apps class. Brief legitimate use survives
/// untouched; the cap amputates the implausible idle tail.
pub(super) const CULVERHOUSE_BAD_APP_CAP_NS: i64 = 10 * 60 * 1_000_000_000;

/// Lower long band — flag only.
pub(super) const CULVERHOUSE_LONG_3H_NS: i64 = 3 * 3_600 * 1_000_000_000;

/// Upper long band — flag plus the `truncate_to_bad_app` action.
pub(super) const CULVERHOUSE_LONG_6H_NS: i64 = 6 * 3_600 * 1_000_000_000;

/// A data gap at least this long makes the days on both sides partial.
pub(super) const CULVERHOUSE_PARTIAL_DAY_GAP_HOURS: f64 = 12.0;

pub(super) const CULVERHOUSE_COLLAPSED_FLAG: &str = "CULVERHOUSE COLLAPSED";

pub(super) const CULVERHOUSE_BAD_APP_CAP_FLAG: &str = "CULVERHOUSE BAD-APP CAP";

pub(super) const CULVERHOUSE_LONG_3H_FLAG: &str = "CULVERHOUSE LONG-3H";

pub(super) const CULVERHOUSE_LONG_6H_FLAG: &str = "CULVERHOUSE LONG-6H";

pub(super) const CULVERHOUSE_PARTIAL_DAY_FLAG: &str = "CULVERHOUSE PARTIAL DAY";

pub(super) const CULVERHOUSE_DST_DAY_FLAG: &str = "CULVERHOUSE DST DAY";

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub(super) struct StudyWindowExclusion {
    pub(super) start_date: String,
    pub(super) end_date: String,
    pub(super) label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct StudyWindow {
    pub(super) participant_id: String,
    pub(super) start_date: String,
    pub(super) end_date: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) exclusions: Vec<StudyWindowExclusion>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct ResolvedParticipantWindow {
    pub(super) participant_id: String,
    pub(super) window: Option<StudyWindow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum SharingStatus {
    Shared,
    NonShared,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct SharingEntry {
    pub(super) participant_id: String,
    pub(super) status: SharingStatus,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SharingResolution {
    pub(super) status_by_participant: BTreeMap<String, SharingStatus>,
    pub(super) shared_participants: Vec<String>,
    pub(super) non_shared_participants: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionReport {
    pub(super) shared_participants: Vec<String>,
    pub(super) non_shared_participants: Vec<String>,
    pub(super) survey_relabels: usize,
    pub(super) non_target_rows: usize,
    pub(super) kids_shell_attributions: usize,
    pub(super) null_usernames_filled: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverageDayCheckpoint {
    pub(super) participant_id: String,
    pub(super) date: String,
    pub(super) status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DayCoverageCheckpoint {
    pub(super) coverage: Vec<CoverageDayCheckpoint>,
    pub(super) usage_days: usize,
    pub(super) no_activity_days: usize,
    pub(super) no_data_days: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComplianceDayCheckpoint {
    pub(super) participant_id: String,
    pub(super) date: String,
    pub(super) sharing_status: String,
    pub(super) known_minutes: f64,
    pub(super) unknown_minutes: f64,
    pub(super) compliance_percent: f64,
    pub(super) zero_real_usage: bool,
    pub(super) is_valid: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComplianceResultCheckpoint {
    pub(super) days: Vec<ComplianceDayCheckpoint>,
    pub(super) valid_days: usize,
    pub(super) invalid_days: usize,
    pub(super) zero_usage_days: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) enum ScreenCreditState {
    On,
    Off,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct ScreenChangePoint {
    pub(super) timestamp_ns: i64,
    pub(super) state: ScreenCreditState,
    pub(super) source_data_rows: SourceDataRows,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub(super) struct ScreenCreditSubstrate {
    pub(super) points: BTreeMap<String, Vec<ScreenChangePoint>>,
    pub(super) boots: BTreeMap<String, Vec<i64>>,
    pub(super) all_timestamps: BTreeMap<String, Vec<i64>>,
    pub(super) source_events: BTreeMap<String, Vec<(i64, SourceDataRows)>>,
    pub(super) source_event_suffix_digests: BTreeMap<String, Vec<String>>,
    pub(super) capable: BTreeSet<String>,
}

pub(super) type CreditInterval = (i64, i64);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum CreditDecision {
    Passthrough,
    Intervals {
        intervals: Vec<CreditInterval>,
        session_capped: bool,
        no_witness_fallback: bool,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreditEmissionCounts {
    pub(super) truncated_sessions: usize,
    pub(super) no_witness_fallbacks: usize,
    pub(super) fully_dead_sessions: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreditPartitionCheckpoint<'a> {
    pub(super) session_count: usize,
    pub(super) rest_count: usize,
    pub(super) session_rows_digest: &'a str,
    pub(super) rest_rows_digest: &'a str,
}

pub(super) struct ScreenCreditOutput {
    pub(super) csv_bytes: Vec<u8>,
    pub(super) row_count: u32,
    pub(super) row_lineage: Vec<PipelineRowLineage>,
    pub(super) effective_usage_checkpoint: WorkflowCheckpoint,
}

// ---- B08 notification-derived proxy contacts ----------------------------

/// Flag prefix stamped on every proxy contact row, naming the rule that
/// emitted it. Provenance rides in `any_app_usage_flags` for the same reason
/// Culverhouse's truncation amount does: a run with this axis on stays
/// schema-compatible with one that has it off.
pub(super) const NOTIFICATION_PROXY_FLAG_PREFIX: &str = "NOTIFICATION PROXY";

/// The notification instant fell inside a reconstructed episode of the SAME
/// package, so this contact is time already counted as observed usage.
pub(super) const NOTIFICATION_WITHIN_USAGE_FLAG: &str = "WITHIN OBSERVED USAGE";

/// The instant fell outside every episode of its package. This is the case a
/// researcher counting notification-driven contact actually wants: the app
/// reached the user without being opened.
pub(super) const NOTIFICATION_OUTSIDE_USAGE_FLAG: &str = "OUTSIDE OBSERVED USAGE";

/// B09. Flag prefix stamped on every emulated row, naming the method and the
/// cadence that produced it. Same carrier and same reason as the B08 prefix
/// above.
pub(super) const POLLED_EMULATION_FLAG_PREFIX: &str = "POLLED EMULATION";

/// Stamped on EVERY emulated row without exception. A reader who takes an
/// emulated row for collected data has been misled by this output, so the
/// disclaimer travels on the row rather than in a header, a filename, or
/// documentation that a spreadsheet will never show them.
pub(super) const POLLED_EMULATION_NOT_OBSERVED_FLAG: &str = "EMULATED NOT OBSERVED";

/// Stamped on a run closed by the forced terminal rule rather than by an
/// observed gap or package change. Ross's released code forces the last row's
/// gap so that it counts; without this flag that row is indistinguishable from
/// one whose end was actually sampled.
pub(super) const POLLED_EMULATION_FORCED_TERMINAL_FLAG: &str = "FORCED TERMINAL SAMPLE";

pub(super) struct PolledEmulationOutput {
    pub(super) csv_bytes: Vec<u8>,
    pub(super) row_count: u32,
    pub(super) row_lineage: Vec<PipelineRowLineage>,
    pub(super) checkpoint: WorkflowCheckpoint,
}

pub(super) struct NotificationContactOutput {
    pub(super) csv_bytes: Vec<u8>,
    pub(super) row_count: u32,
    pub(super) row_lineage: Vec<PipelineRowLineage>,
    pub(super) checkpoint: WorkflowCheckpoint,
}

pub(super) struct TimezoneSelection {
    pub rows: Arc<Vec<Row>>,
    pub target_timezone: String,
    pub action: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RowCountReport {
    pub before: u32,
    pub after: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatcherInput {
    pub app_codes: Vec<i32>,
    pub timestamps: Vec<i64>,
    pub resumed: Vec<bool>,
    pub same_stop: Vec<bool>,
    pub other_stop: Vec<bool>,
    pub stopped: Vec<bool>,
    pub background: Vec<bool>,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatcherOutput {
    pub start_indices: Vec<usize>,
    pub stop_start_indices: Vec<usize>,
    pub stop_event_indices: Vec<usize>,
    pub missing_indices: Vec<usize>,
    /// Why each closed episode ended, parallel to `stop_start_indices`.
    /// Every arm answers in its own vocabulary; see `EpisodeCloseReason`.
    pub stop_reasons: Vec<EpisodeCloseReason>,
    /// Why each unclosed episode has no end, parallel to `missing_indices`.
    pub missing_reasons: Vec<EpisodeCloseReason>,
    /// Explicit end instants, parallel to `stop_start_indices`. `None` — which
    /// is what every row-anchored arm reports for every episode — means "the end
    /// is the timestamp of `stop_event_indices[i]`". Only a rule whose close
    /// lands between events, such as the GESIS timeout cut, sets this.
    pub stop_timestamps_ns: Vec<Option<i64>>,
    /// Explicit begin instants, parallel to `stop_start_indices`. `None` means
    /// "the episode begins at the timestamp of its start row".
    ///
    /// This is what lets one opened episode become SEVERAL disjoint intervals:
    /// a start index may appear at more than one position, each position
    /// carrying its own begin and end. EYES needs it — its Final App Usage
    /// split cuts one app-usage chunk wherever the device-state timeline
    /// changes underneath it, so one resume can yield several ACTIVE fragments
    /// separated by IDLE or GAP.
    ///
    /// It lives here rather than in `MatchUpdateIndices` because no rule in the
    /// matcher crate splits an episode; adding it there would be a field that
    /// is always `None`.
    pub start_timestamps_ns: Vec<Option<i64>>,
    /// Closed starts selected by an explicit B02 arm whose source event was not
    /// native type 1. Both classifiers consume these indices without rewriting
    /// the retained source event before classification.
    pub selected_nonresume_closed_indices: Vec<usize>,
    pub opener_set_evidence: OpenerSetEvidence,
    /// Complete, evidence-only EYES surfaces, one serial segmentation per
    /// participant. Empty for every other reconstruction strategy.
    pub eyes_tagged_fau_evidence: Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
    /// Private producer witness for the exact participant slices actually
    /// sent through EYES. It is captured before evidence assembly and is never
    /// serialized or reconstructed from the public artifact.
    #[serde(skip, default)]
    pub eyes_validation_expected_participant_ids: BTreeSet<String>,
    /// Present only for the Schoedel controlled-derivative arm. Candidate
    /// rows are materialized by the shared adapter downstream so B03/B04 and
    /// every later tracked query remain unchanged.
    #[serde(default)]
    pub schoedel_reconstruction: Option<b05::SchoedelReconstructionOutput>,
    #[serde(default)]
    pub schoedel_candidate_rows: Option<Vec<Row>>,
    /// Private producer witness from the exact retained stream supplied to
    /// Schoedel reconstruction. Never recovered from the public receipt.
    #[serde(skip, default)]
    pub(super) schoedel_validation_witness: Option<SchoedelValidationWitness>,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SchoedelPreflightProduct {
    pub(super) output: b05::SchoedelReconstructionOutput,
    pub(super) validation_witness: SchoedelValidationWitness,
}

impl MatcherOutput {
    /// Whether any episode was split into more than one interval. False for
    /// every rule but EYES, and the materializer's fast path depends on it:
    /// when this is false the materialization is byte-for-byte what it was
    /// before intervals existed.
    pub(super) fn splits_episodes(&self) -> bool {
        self.start_timestamps_ns.iter().any(Option::is_some)
    }
}

/// Per-participant results, reassembled into the single event-ordered
/// `MatcherOutput` the rest of the pipeline expects.
///
/// Sorting is by the global start row and is stable, so a rule that emits
/// several intervals for one start — `eyes_complement` does — keeps them in the
/// order it produced them.
/// One closed episode, in the global row space: start row, closing row, why it
/// closed, and the explicit end and begin instants when the rule set them.
pub(super) type MergedEpisode = (usize, usize, EpisodeCloseReason, Option<i64>, Option<i64>);

#[derive(Default)]
pub(super) struct MergedMatcherOutput {
    pub(super) starts: Vec<usize>,
    pub(super) closed: Vec<MergedEpisode>,
    pub(super) missing: Vec<(usize, EpisodeCloseReason)>,
    pub(super) eyes_tagged_fau_evidence: Vec<crate::eyes_complement::EyesParticipantTaggedFauEvidence>,
    pub(super) eyes_validation_expected_participant_ids: BTreeSet<String>,
}

impl MergedMatcherOutput {
    pub(super) fn absorb(&mut self, output: MatcherOutput, indices: &[usize]) {
        self.starts
            .extend(output.start_indices.iter().map(|&local| indices[local]));
        for position in 0..output.stop_start_indices.len() {
            self.closed.push((
                indices[output.stop_start_indices[position]],
                indices[output.stop_event_indices[position]],
                output.stop_reasons[position],
                output.stop_timestamps_ns[position],
                output.start_timestamps_ns[position],
            ));
        }
        self.missing.extend(
            output
                .missing_indices
                .iter()
                .zip(output.missing_reasons.iter())
                .map(|(&local, &reason)| (indices[local], reason)),
        );
        self.eyes_tagged_fau_evidence
            .extend(output.eyes_tagged_fau_evidence);
        self.eyes_validation_expected_participant_ids
            .extend(output.eyes_validation_expected_participant_ids);
    }

    pub(super) fn into_output(mut self) -> MatcherOutput {
        self.starts.sort_unstable();
        self.closed.sort_by_key(|entry| entry.0);
        self.missing.sort_by_key(|entry| entry.0);
        self.eyes_tagged_fau_evidence
            .sort_by(|left, right| left.participant_id.cmp(&right.participant_id));
        MatcherOutput {
            start_indices: self.starts,
            stop_start_indices: self.closed.iter().map(|entry| entry.0).collect(),
            stop_event_indices: self.closed.iter().map(|entry| entry.1).collect(),
            missing_indices: self.missing.iter().map(|entry| entry.0).collect(),
            stop_reasons: self.closed.iter().map(|entry| entry.2).collect(),
            missing_reasons: self.missing.iter().map(|entry| entry.1).collect(),
            stop_timestamps_ns: self.closed.iter().map(|entry| entry.3).collect(),
            start_timestamps_ns: self.closed.iter().map(|entry| entry.4).collect(),
            selected_nonresume_closed_indices: Vec::new(),
            opener_set_evidence: OpenerSetEvidence::default(),
            eyes_tagged_fau_evidence: self.eyes_tagged_fau_evidence,
            eyes_validation_expected_participant_ids: self.eyes_validation_expected_participant_ids,
            schoedel_reconstruction: None,
            schoedel_candidate_rows: None,
            schoedel_validation_witness: None,
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditPartition {
    pub sessions: Vec<Row>,
    pub rest: Vec<Row>,
    pub session_rows_digest: String,
    pub rest_rows_digest: String,
}

pub(super) type DayApps = BTreeMap<(String, String), BTreeSet<String>>;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditEmission {
    pub credited: Vec<Row>,
    pub counts: CreditEmissionCounts,
    pub credited_rows_digest: String,
}

// ---- B08 notification-derived proxy contacts ----------------------------

/// One (participant, package) pair and every observed usage span it has.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ObservedUsageSpanGroup {
    pub participant_id: String,
    pub app_package_name: String,
    pub spans: Vec<(i64, i64)>,
}

/// Observed usage spans a notification instant can fall inside.
///
/// A sorted `Vec` rather than a map: this value is serialized straight into a
/// query checkpoint, so its order has to be the same on every run or an
/// unchanged input would register as a changed step -- and a map keyed by a
/// `(participant, package)` tuple is not representable in JSON at all.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub(super) struct ObservedUsageSpans {
    pub groups: Vec<ObservedUsageSpanGroup>,
}

impl ObservedUsageSpans {
    /// The spans for one pair, or empty when the package has none.
    pub fn spans_for(&self, participant_id: &str, app_package_name: &str) -> &[(i64, i64)] {
        match self.groups.binary_search_by(|group| {
            (group.participant_id.as_str(), group.app_package_name.as_str())
                .cmp(&(participant_id, app_package_name))
        }) {
            Ok(index) => &self.groups[index].spans,
            Err(_) => &[],
        }
    }
}

/// Shared by the sequential oracle and the tracked query so both fingerprint
/// the same field ORDER. A `json!` literal serializes its keys alphabetically
/// while a struct keeps declaration order, and the two paths must agree.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NotificationSelectionCheckpoint {
    pub rule: String,
    pub seen_count: usize,
    pub interruption_count: usize,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NotificationContactCounts {
    pub within_observed_usage: usize,
    pub outside_observed_usage: usize,
}

// ---- B09 polled-method emulation ---------------------------------------

/// One instant a polled collector would have recorded, and what it would have
/// seen there.
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PolledSample {
    pub row_index: usize,
    pub instant_ns: i64,
}

/// One emulated session: a run of consecutive samples the method groups
/// together.
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PolledRun {
    pub row_index: usize,
    pub first_instant_ns: i64,
    pub last_instant_ns: i64,
    pub sample_count: usize,
    pub forced_terminal: bool,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PolledEmulationCounts {
    pub method: String,
    pub interval_ns: i64,
    pub gap_ns: i64,
    pub samples: usize,
    pub runs: usize,
    pub forced_terminal_runs: usize,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CreditResult {
    pub rows: Vec<Row>,
    pub credited_rows_digest: String,
    pub rest_rows_digest: String,
    pub report: CreditReportOwned,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreditReportOwned {
    pub sessions: usize,
    pub credited_rows: usize,
    pub credited_minutes: f64,
    pub raw_session_minutes: f64,
    pub truncated_sessions: usize,
    pub fully_dead_sessions: usize,
    pub no_witness_fallbacks: usize,
    pub screen_incapable_participants: Vec<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct WindowedRows {
    pub rows: PayloadHandle<Vec<Row>>,
    pub dropped_rows: usize,
    pub participants_without_window: Vec<String>,
    pub applied: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) enum SharingResolutionValue {
    Disabled,
    Enabled(SharingResolution),
}

pub(super) type SurveyLookup = BTreeMap<(String, i64), String>;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct AttributedRows {
    pub rows: PayloadHandle<Vec<Row>>,
    pub report: Option<AttributionReport>,
    pub shared_participants: BTreeSet<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CoverageOutput {
    pub csv_bytes: Vec<u8>,
    pub report: DayCoverageCheckpoint,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionMinutes {
    pub participants_seen: BTreeMap<String, BTreeSet<String>>,
    pub buckets: BTreeMap<(String, String), (f64, f64)>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionCompletenessDay {
    pub participant_id: String,
    pub date: String,
    pub sharing_status: String,
    pub known_minutes: f64,
    pub unknown_minutes: f64,
    pub compliance_percent: f64,
    pub zero_real_usage: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttributionCompleteness {
    pub zero_usage_days: usize,
    pub days: Vec<AttributionCompletenessDay>,
}
