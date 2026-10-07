import {
  AGGREGATE_SHAPE_VALUES,
  BOOLEAN_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  FILTER_MATCH_FIELD_VALUES,
  INTERACTION_TYPE_REMOVAL_MODE_VALUES,
  INTERVAL_EXPANSION_METHOD_VALUES,
  LOCKED_SCREEN_AUDIO_DISPOSITION_VALUES,
  SCREEN_SESSION_CLASSIFICATION_POLICY_VALUES,
  SCREEN_SESSION_MAXIMUM_DURATION_DISPOSITION_VALUES,
  TIMEZONE_HANDLING_VALUES,
  type EpisodeReconstructionStrategy,
  type EventRetentionSet,
  type IntervalQualityPolicy,
  type SessionGapBasis,
  type SessionBoundaryScope,
  type MaximumDurationDisposition,
  type MaximumDurationPolicy,
  type MaximumDurationThresholdSource,
  type MicroUseClassificationPolicy,
  type MinimumDurationComparator,
  type MinimumDurationDisposition,
  type OpenerSet,
  type DayBoundaryAttribution,
  type NotificationProxyRule,
  type PolledEmulationMethod,
  type PackageExclusionPreset,
  type ScreenGatingRule,
  type ScreenSessionConstructionStrategy,
  type SessionGroupingPolicy,
} from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";

export type EquivalenceClass = { label: string; value: unknown };

/// Which arms the campaign treats as behaviourally interchangeable.
///
/// Running every arm of every axis is not free, so the campaign samples. What
/// it must NOT do is sample silently: these maps are total, so a new arm fails
/// to compile until someone states which behaviour class it joins. Before this,
/// the sample was a bare array and a new arm simply went unrepresented.
///
/// A key that maps to itself is a representative — it is the arm the campaign
/// actually runs. A key that maps to another arm is a claim that the two cannot
/// be told apart by anything the campaign measures.
const RECONSTRUCTION_REPRESENTATIVE = {
  // Each of these four reconstructs different episodes from the same events.
  fused_matcher: "fused_matcher",
  parry_toth_forward_pairing: "parry_toth_forward_pairing",
  eyes_complement: "eyes_complement",
  gesis_start_stop_repair: "gesis_start_stop_repair",
  // Pairing with no repair of any kind: the strict subset of forward pairing,
  // represented by it.
  foreground_background_pairing: "parry_toth_forward_pairing",
  // Both close on a device-state condition forward of the closing event, which
  // GESIS's three-tier repair is the represented form of.
  draxler_interruption_aware: "gesis_start_stop_repair",
  morrison_lock_tolerant: "gesis_start_stop_repair",
  schoedel_2026_app_within_screen_prose_v1:
    "schoedel_2026_app_within_screen_prose_v1",
} satisfies Record<EpisodeReconstructionStrategy, EpisodeReconstructionStrategy>;

/// Every retention arm here is its own representative.
///
/// The criterion is the one the sibling maps above use: a representative claims
/// two arms cannot be told apart by anything the campaign measures. These five
/// can — `every_event_retention_set_means_the_same_thing_warm_and_cold`
/// (pipeline_v2_incremental.rs) asserts all five produce PAIRWISE DIFFERENT app
/// CSVs on a fixture carrying the foreground pair, a screen pair, a shutdown
/// and a user interaction. Collapsing any pair would drop an arm that measurably
/// differs.
///
/// An earlier version of this comment justified the split by claiming "no two
/// of them nest". That is false — {1,2} is a strict subset of both {1,2,7,26,27}
/// and {1,2,17,26} — and it was the wrong criterion anyway: nesting is about set
/// containment, and a strict subset produces DIFFERENT episodes precisely
/// because it retains fewer closing events.
const EVENT_RETENTION_REPRESENTATIVE = {
  none: "none",
  parry_toth_7: "parry_toth_7",
  usage_logger_5: "usage_logger_5",
  toth_trifonova_app: "toth_trifonova_app",
  foreground_background_only: "foreground_background_only",
} satisfies Record<EventRetentionSet, EventRetentionSet>;

/// B02 starts with no collapsed campaign arms. Even when an explicit opener is
/// output-equivalent to a strategy's native rule on a particular fixture, its
/// requested value and compatibility receipt remain distinct. A future collapse
/// requires evidence across the campaign's measured outcomes, not an assumed
/// equivalence from the set definition alone.
const OPENER_SET_REPRESENTATIVE = {
  strategy_defined: "strategy_defined",
  activity_resumed_only: "activity_resumed_only",
  gesis_app_scoped_starts: "gesis_app_scoped_starts",
} satisfies Record<OpenerSet, OpenerSet>;

const MICRO_USE_REPRESENTATIVE = {
  none: "none",
  okoshi_lt_5s: "okoshi_lt_5s",
} satisfies Record<MicroUseClassificationPolicy, MicroUseClassificationPolicy>;

const MINIMUM_DURATION_COMPARATOR_REPRESENTATIVE = {
  strict_lt: "strict_lt",
  inclusive_le: "inclusive_le",
} satisfies Record<MinimumDurationComparator, MinimumDurationComparator>;

const MINIMUM_DURATION_DISPOSITION_REPRESENTATIVE = {
  chronicle_blank_keep_row: "chronicle_blank_keep_row",
  retain_and_credit: "retain_and_credit",
  retain_but_exclude: "retain_but_exclude",
  drop_row: "drop_row",
} satisfies Record<MinimumDurationDisposition, MinimumDurationDisposition>;

/// B06. The four maximum-duration keys are optional and travel as one vector
/// (`@/lib/maximumDurationVector`): every class below is a legal single-key
/// intervention because `withValue` completes the siblings. `unset` is the
/// omitted legacy shape, which is a different arm from explicit
/// `strategy_native` (that one emits a receipt).
const MAXIMUM_DURATION_POLICY_REPRESENTATIVE = {
  strategy_native: "strategy_native",
  chronicle_observed_close_rejection_v1: "chronicle_observed_close_rejection_v1",
  post_reconstruction_strict_max_v1: "post_reconstruction_strict_max_v1",
} satisfies Record<MaximumDurationPolicy, MaximumDurationPolicy>;

const MAXIMUM_DURATION_DISPOSITION_REPRESENTATIVE = {
  not_applicable: "not_applicable",
  flag_and_retain: "flag_and_retain",
  retain_but_exclude: "retain_but_exclude",
  truncate_to_threshold: "truncate_to_threshold",
  drop_row: "drop_row",
} satisfies Record<MaximumDurationDisposition, MaximumDurationDisposition>;

/// `b12_adaptive_participant` is total here but not run: in v1 it refuses with
/// `adaptive_maximum_threshold_provider_unavailable` before reconstruction (no
/// provider exists yet), which the Rust and browser preflight tests pin. It
/// joins the campaign when B12 lands.
const MAXIMUM_DURATION_THRESHOLD_SOURCE_REPRESENTATIVE = {
  strategy_native: "strategy_native",
  chronicle_legacy_config: "chronicle_legacy_config",
  fixed_parameter: "fixed_parameter",
  b12_adaptive_participant: null,
} satisfies Record<MaximumDurationThresholdSource, MaximumDurationThresholdSource | null>;

const SCREEN_SESSION_CONSTRUCTION_REPRESENTATIVE = {
  chronicle_screen_interactive_v1: "chronicle_screen_interactive_v1",
  parry_toth_2025_session_glance_v1: "parry_toth_2025_session_glance_v1",
  zhu_2018_unlock_lock_v1: "zhu_2018_unlock_lock_v1",
  unlock_to_lock_v1: "unlock_to_lock_v1",
  unlock_to_off_or_lock_v1: "unlock_to_off_or_lock_v1",
} satisfies Record<
  ScreenSessionConstructionStrategy,
  ScreenSessionConstructionStrategy
>;

const SCREEN_GATING_RULE_REPRESENTATIVE = {
  screen_and_liveness_v1: "screen_and_liveness_v1",
  screen_witness_only: "screen_witness_only",
  strict_visual_only: "strict_visual_only",
  device_liveness_only: "device_liveness_only",
} satisfies Record<ScreenGatingRule, ScreenGatingRule>;

const DAY_BOUNDARY_ATTRIBUTION_REPRESENTATIVE = {
  attribute_to_start_day: "attribute_to_start_day",
  split_at_local_midnight: "split_at_local_midnight",
} satisfies Record<DayBoundaryAttribution, DayBoundaryAttribution>;

const PACKAGE_EXCLUSION_PRESET_REPRESENTATIVE = {
  all_supplied_rows: "all_supplied_rows",
  honor_filter_flag: "honor_filter_flag",
  system_scope_only: "system_scope_only",
} satisfies Record<PackageExclusionPreset, PackageExclusionPreset>;

const NOTIFICATION_PROXY_RULE_REPRESENTATIVE = {
  none: "none",
  seen_contact_v1: "seen_contact_v1",
  interruption_contact_v1: "interruption_contact_v1",
  any_notification_contact_v1: "any_notification_contact_v1",
} satisfies Record<NotificationProxyRule, NotificationProxyRule>;

const POLLED_EMULATION_METHOD_REPRESENTATIVE = {
  none: "none",
  ross_2025_sampled_gap_v1: "ross_2025_sampled_gap_v1",
  cerit_2025_sample_count_v1: "cerit_2025_sample_count_v1",
} satisfies Record<PolledEmulationMethod, PolledEmulationMethod>;

/// Both bases are distinct: they read a DIFFERENT endpoint, so neither can
/// stand in for the other on any input where episodes overlap.
const SESSION_GAP_BASIS_REPRESENTATIVE = {
  previous_episode_stop_v1: "previous_episode_stop_v1",
  session_running_maximum_stop_v1: "session_running_maximum_stop_v1",
} satisfies Record<SessionGapBasis, SessionGapBasis>;

/// The scopes nest, and each adds a distinct field to the partition key, so
/// none of the three collapses into another.
const SESSION_BOUNDARY_SCOPE_REPRESENTATIVE = {
  participant_v1: "participant_v1",
  participant_and_study_v1: "participant_and_study_v1",
  participant_study_and_person_v1: "participant_study_and_person_v1",
} satisfies Record<SessionBoundaryScope, SessionBoundaryScope>;

const INTERVAL_QUALITY_REPRESENTATIVE = {
  none: "none",
  culverhouse_trim_and_log: "culverhouse_trim_and_log",
} satisfies Record<IntervalQualityPolicy, IntervalQualityPolicy>;

const SESSION_GROUPING_REPRESENTATIVE = {
  none: "none",
  // Everything with a plain strict > on a gap constant and no package clause
  // differs only in the constant. Zerrer represents them because its strict
  // comparator is read from the deposited code (`time_gap > 60`), not prose.
  zerrer_60s: "zerrer_60s",
  church_5s: "zerrer_60s",
  grosse_deters_10s: "zerrer_60s",
  van_berkel_45s: "zerrer_60s",
  // The source code joins strictly below five seconds, so equality differs
  // from every strict-`>` fixed arm; unlike Ross, a package change is not a
  // boundary. It therefore requires its own campaign representative.
  smartphone_wellbeing_strict_lt_5s: "smartphone_wellbeing_strict_lt_5s",
  // Ross is the only policy that is boundary-inclusive (>=) AND ends a session
  // on a package change, so it cannot stand in for any other.
  ross_15s: "ross_15s",
  // Peng & Zhu derive the threshold from each participant's own intervals, so
  // no fixed-constant arm can represent it: its behaviour is a function of
  // the data, not of a quoted number.
  peng_zhu_2020_participant_median: "peng_zhu_2020_participant_median",
} satisfies Record<SessionGroupingPolicy, SessionGroupingPolicy>;

/// The campaign's label for each representative arm. Kept short and kept
/// EXACTLY as it was before these maps existed: the labels key golden files, so
/// renaming one churns goldens without any behaviour changing.
const REPRESENTATIVE_LABELS: Record<string, string> = {
  fused_matcher: "fused",
  parry_toth_forward_pairing: "forward",
  eyes_complement: "eyes",
  gesis_start_stop_repair: "gesis",
  schoedel_2026_app_within_screen_prose_v1: "schoedelprose",
  none: "none",
  parry_toth_7: "parrytoth7",
  usage_logger_5: "usagelogger5",
  toth_trifonova_app: "tothtrifonova",
  foreground_background_only: "fgbgonly",
  strategy_defined: "strategydefined",
  activity_resumed_only: "resumedonly",
  gesis_app_scoped_starts: "gesisappstarts",
  okoshi_lt_5s: "okoshilt5s",
  strict_lt: "strictlt",
  inclusive_le: "inclusivele",
  chronicle_blank_keep_row: "blankkeeprow",
  retain_and_credit: "retaincredit",
  retain_but_exclude: "retainexclude",
  drop_row: "droprow",
  chronicle_screen_interactive_v1: "chroniclescreenv1",
  parry_toth_2025_session_glance_v1: "parrytothscreen",
  zhu_2018_unlock_lock_v1: "zhuscreen",
  unlock_to_lock_v1: "unlocklock",
  unlock_to_off_or_lock_v1: "unlockofflock",
  culverhouse_trim_and_log: "culverhouse",
  zerrer_60s: "zerrer60s",
  smartphone_wellbeing_strict_lt_5s: "smartphonewellbeinglt5s",
  ross_15s: "ross15s",
  peng_zhu_2020_participant_median: "pengzhumedian",
  strategy_native: "strategynative",
  chronicle_observed_close_rejection_v1: "chroniclerejection",
  post_reconstruction_strict_max_v1: "postreconstrictmax",
  not_applicable: "notapplicable",
  flag_and_retain: "flagretain",
  truncate_to_threshold: "truncate",
  chronicle_legacy_config: "legacyconfig",
  fixed_parameter: "fixedparameter",
  screen_and_liveness_v1: "screenandliveness",
  screen_witness_only: "screenonly",
  strict_visual_only: "strictvisualonly",
  device_liveness_only: "livenessonly",
  attribute_to_start_day: "startday",
  split_at_local_midnight: "splitmidnight",
  all_supplied_rows: "allsuppliedrows",
  honor_filter_flag: "honorfilterflag",
  system_scope_only: "systemscopeonly",
  seen_contact_v1: "seencontact",
  interruption_contact_v1: "interruptioncontact",
  any_notification_contact_v1: "anynotificationcontact",
  ross_2025_sampled_gap_v1: "rosssampledgap",
  cerit_2025_sample_count_v1: "ceritsamplecount",
  previous_episode_stop_v1: "prevstop",
  session_running_maximum_stop_v1: "runningmaxstop",
  participant_v1: "participantonly",
  participant_and_study_v1: "participantstudy",
  participant_study_and_person_v1: "participantstudyperson",
};

/// The distinct representatives of a total arm-to-representative map, in first
/// appearance order, as equivalence classes.
function representativeClasses(map: Record<string, string | null>): EquivalenceClass[] {
  const seen = new Set<string>();
  const classes: EquivalenceClass[] = [];
  for (const representative of Object.values(map)) {
    if (representative === null || seen.has(representative)) continue;
    seen.add(representative);
    const label = REPRESENTATIVE_LABELS[representative];
    if (label === undefined) {
      throw new Error(`no campaign label for representative arm ${representative}`);
    }
    classes.push({ label, value: representative });
  }
  return classes;
}

const sanitizeLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const BOOL_CLASSES: EquivalenceClass[] = [
  { label: "true", value: true },
  { label: "false", value: false },
];

/// Presence-marker booleans (`true` | absent): the contract declares them
/// optional with no default, and absence — not `false` — is the wire form.
const PRESENCE_MARKER_CLASSES: EquivalenceClass[] = [
  { label: "unset", value: undefined },
  { label: "true", value: true },
];

const NON_BOOLEAN_CLASSES: Partial<
  Record<keyof BrowserProcessingOptions, EquivalenceClass[]>
> = {
  studyName: [
    { label: "empty", value: "" },
    { label: "named", value: "Deterministic Parity" },
  ],
  selectedTimezone: [
    { label: "none", value: "" },
    { label: "america_chicago", value: "America/Chicago" },
    { label: "america_new_york", value: "America/New_York" },
  ],
  timezoneHandling: TIMEZONE_HANDLING_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  aggregateShape: AGGREGATE_SHAPE_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  aggregateTopAppsLimit: [
    { label: "all", value: DEFAULT_BROWSER_OPTIONS.aggregateTopAppsLimit },
    { label: "top5", value: 5 },
  ],
  filterMatchField: FILTER_MATCH_FIELD_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  applicationLabelExclusions: [
    { label: "none", value: [] },
    { label: "unknown_app", value: ["Uncatalogued Research App"] },
  ],
  longDurationThresholdHours: [
    { label: "h12", value: 12 },
    { label: "h1", value: 1 },
  ],
  minimumUsageDuration: [
    { label: "s0", value: 0 },
    { label: "s60", value: 60 },
  ],
  customAppEngagementDuration: [
    { label: "s300", value: 300 },
    { label: "s0", value: 0 },
  ],
  longUsageDurationThresholds: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds },
    { label: "empty", value: [] },
  ],
  longDataTimeGapThresholds: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds },
    { label: "empty", value: [] },
  ],
  screenUsageAutoLockTimeoutSeconds: [
    { label: "s120", value: 120 },
    { label: "s0", value: 0 },
  ],
  screenUsageAutoLockToleranceSeconds: [
    { label: "s30", value: 30 },
    { label: "s0", value: 0 },
  ],
  screenUsageManualLockMaxTailGapSeconds: [
    { label: "s30", value: 30 },
    { label: "s0", value: 0 },
  ],
  screenUsageKeyguardNearStopSeconds: [
    { label: "s2", value: 2 },
    { label: "s0", value: 0 },
  ],
  parallelMaxWorkers: [
    { label: "unset", value: undefined },
    { label: "w2", value: 2 },
  ],
  sameAppInteractionTypesToStopUsageAt: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt },
    { label: "empty", value: [] },
  ],
  otherInteractionTypesToStopUsageAt: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt },
    { label: "empty", value: [] },
  ],
  interactionTypesToRemove: [
    { label: "none", value: [] },
    { label: "usage_stat", value: ["Usage Stat"] },
  ],
  interactionTypeRemap: [
    { label: "none", value: [] },
    { label: "custom", value: ["Custom Foreground => Activity Resumed"] },
  ],
  proximityIntervalSeconds: [
    { label: "s2", value: 2 },
    { label: "s0", value: 0 },
    { label: "s60", value: 60 },
  ],
  creditedSessionCapMinutes: [
    { label: "m360", value: 360 },
    { label: "m0", value: 0 },
  ],
  deviceLivenessGapToleranceMinutes: [
    { label: "m120", value: 120 },
    { label: "m0", value: 0 },
  ],
  autoLockBridgeSeconds: [
    { label: "s120", value: 120 },
    { label: "s0", value: 0 },
  ],
  noWitnessMinDayApps: [
    { label: "n2", value: 2 },
    { label: "n0", value: 0 },
  ],
  eventRetentionSet: representativeClasses(EVENT_RETENTION_REPRESENTATIVE),
  openerSet: representativeClasses(OPENER_SET_REPRESENTATIVE),
  episodeReconstructionStrategy: representativeClasses(RECONSTRUCTION_REPRESENTATIVE),
  microUseClassificationPolicy: representativeClasses(MICRO_USE_REPRESENTATIVE),
  minimumDurationComparator: representativeClasses(
    MINIMUM_DURATION_COMPARATOR_REPRESENTATIVE,
  ),
  minimumDurationDisposition: representativeClasses(
    MINIMUM_DURATION_DISPOSITION_REPRESENTATIVE,
  ),
  maximumDurationPolicy: [
    { label: "unset", value: undefined },
    ...representativeClasses(MAXIMUM_DURATION_POLICY_REPRESENTATIVE),
  ],
  maximumDurationDisposition: [
    { label: "unset", value: undefined },
    ...representativeClasses(MAXIMUM_DURATION_DISPOSITION_REPRESENTATIVE),
  ],
  maximumDurationThresholdSource: [
    { label: "unset", value: undefined },
    ...representativeClasses(MAXIMUM_DURATION_THRESHOLD_SOURCE_REPRESENTATIVE),
  ],
  // Exact nanosecond strings, never numbers. `ns1` qualifies every bounded
  // episode (the strongest branch witness); the two hour values bracket the
  // legacy 12 h default (`ns12h` is the completed vector's default threshold).
  maximumDurationThresholdNs: [
    { label: "unset", value: undefined },
    { label: "ns1", value: "1" },
    { label: "ns1h", value: "3600000000000" },
    { label: "ns12h", value: "43200000000000" },
  ],
  intervalQualityPolicy: representativeClasses(INTERVAL_QUALITY_REPRESENTATIVE),
  sessionGroupingPolicy: representativeClasses(SESSION_GROUPING_REPRESENTATIVE),
  sessionGapBasis: representativeClasses(SESSION_GAP_BASIS_REPRESENTATIVE),
  sessionBoundaryScope: representativeClasses(SESSION_BOUNDARY_SCOPE_REPRESENTATIVE),
  screenSessionConstructionStrategy: representativeClasses(
    SCREEN_SESSION_CONSTRUCTION_REPRESENTATIVE,
  ),
  screenSessionClassificationPolicy: SCREEN_SESSION_CLASSIFICATION_POLICY_VALUES.map(
    (value) => ({ label: sanitizeLabel(value), value }),
  ),
  screenSessionMaximumDurationMinutes: [
    {
      label: "disabled",
      value: DEFAULT_BROWSER_OPTIONS.screenSessionMaximumDurationMinutes,
    },
    { label: "m60", value: 60 },
  ],
  screenSessionMaximumDurationDisposition:
    SCREEN_SESSION_MAXIMUM_DURATION_DISPOSITION_VALUES.map((value) => ({
      label: sanitizeLabel(value),
      value,
    })),
  lockedScreenAudioDisposition: LOCKED_SCREEN_AUDIO_DISPOSITION_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  screenGatingRule: representativeClasses(SCREEN_GATING_RULE_REPRESENTATIVE),
  dayBoundaryAttribution: representativeClasses(DAY_BOUNDARY_ATTRIBUTION_REPRESENTATIVE),
  packageExclusionPreset: representativeClasses(PACKAGE_EXCLUSION_PRESET_REPRESENTATIVE),
  notificationProxyRule: representativeClasses(NOTIFICATION_PROXY_RULE_REPRESENTATIVE),
  polledEmulationMethod: representativeClasses(POLLED_EMULATION_METHOD_REPRESENTATIVE),
  intervalExpansionMethod: INTERVAL_EXPANSION_METHOD_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  interactionTypeRemovalMode: INTERACTION_TYPE_REMOVAL_MODE_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  polledEmulationIntervalSeconds: [
    { label: "cadence10s", value: 10 },
    { label: "cadence5s", value: 5 },
    { label: "cadence60s", value: 60 },
  ],
  polledEmulationGapSeconds: [
    { label: "gap15s", value: 15 },
    { label: "gap0s", value: 0 },
    { label: "gap120s", value: 120 },
  ],
  complianceThresholdPercent: [
    { label: "p70", value: 70 },
    { label: "p0", value: 0 },
    { label: "p100", value: 100 },
  ],
};

const BOOLEAN_KEY_SET = new Set<string>(BOOLEAN_BROWSER_OPTION_KEYS);

export function configurationEquivalenceClasses(
  key: string,
): readonly EquivalenceClass[] {
  if (BOOLEAN_KEY_SET.has(key)) {
    const optionalMarker =
      DEFAULT_BROWSER_OPTIONS[key as keyof BrowserProcessingOptions] === undefined;
    return (optionalMarker ? PRESENCE_MARKER_CLASSES : BOOL_CLASSES).map((entry) => ({
      ...entry,
    }));
  }
  const classes = NON_BOOLEAN_CLASSES[key as keyof BrowserProcessingOptions];
  if (!classes) {
    throw new Error(
      `Contract key "${key}" has no equivalence classes; update configurationEquivalenceClasses.ts`,
    );
  }
  return classes.map((entry) => ({ ...entry }));
}

for (const key of BROWSER_PROCESSING_OPTION_KEYS) configurationEquivalenceClasses(key);
for (const key of Object.keys(NON_BOOLEAN_CLASSES)) {
  if (!(BROWSER_PROCESSING_OPTION_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Equivalence-class entry "${key}" is not a contract key`);
  }
}
