/**
 * Every processing option, one change at a time: the cases the feature matrix
 * (preview-feature-matrix.spec.ts) and the upgrade check
 * (scripts/check_upgrade_from_live.mts) both run.
 */
import {
  AGGREGATE_SHAPE_VALUES,
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
  TIMEZONE_HANDLING_VALUES,
} from "../src/lib/generatedContract";
import {
  completeMaximumDurationVector,
  MAXIMUM_DURATION_VECTOR_KEYS,
  type MaximumDurationVectorKey,
} from "../src/lib/maximumDurationVector";

export type Options = Record<string, unknown>;
export type Case = { name: string; diff: Options };

const DEFAULTS = DEFAULT_BROWSER_OPTIONS as unknown as Options;

const ENUM_VALUES: Record<string, readonly string[]> = {
  ...RESEARCH_AXIS_VALUES_BY_OPTION,
  aggregateShape: AGGREGATE_SHAPE_VALUES,
  timezoneHandling: TIMEZONE_HANDLING_VALUES,
};

/** Values for options that are neither enums nor booleans: edges and a typical change. */
const VALUE_CASES: Record<string, unknown[]> = {
  studyName: ["Matrix Study"],
  selectedTimezone: ["America/Chicago", "Asia/Kolkata"],
  longDurationThresholdHours: [1, 6, 48],
  longDurationThresholdHoursExplicit: [true],
  maximumDurationThresholdNs: ["3600000000000"],
  minimumUsageDuration: [0, 2, 600],
  customAppEngagementDuration: [30, 3600],
  longUsageDurationThresholds: [[1], [2, 24]],
  longDataTimeGapThresholds: [[1], [24]],
  screenUsageAutoLockTimeoutSeconds: [1, 30, 1800], // range 1–3600
  screenUsageAutoLockToleranceSeconds: [0, 300],
  screenUsageManualLockMaxTailGapSeconds: [0, 300],
  screenUsageKeyguardNearStopSeconds: [0, 60],
  parallelMaxWorkers: [1],
  sameAppInteractionTypesToStopUsageAt: [[]],
  otherInteractionTypesToStopUsageAt: [[]],
  interactionTypesToRemove: [["Unknown importance: 11"]],
  interactionTypeRemap: [["Unknown importance: 1 => Activity Resumed"]],
  proximityIntervalSeconds: [0, 60],
  creditedSessionCapMinutes: [1, 1440],
  deviceLivenessGapToleranceMinutes: [1, 1440], // range 1–1440
  autoLockBridgeSeconds: [0, 600],
  noWitnessMinDayApps: [1, 10], // range 1–100
  polledEmulationIntervalSeconds: [1, 60],
  polledEmulationGapSeconds: [1, 120],
  complianceThresholdPercent: [0, 100],
  applicationLabelExclusions: [["System"]],
  aggregateTopAppsLimit: [1, 5],
  screenSessionMaximumDurationMinutes: [1, 1440],
};

/** An option whose effect needs another option on is tested with that option on. */
const PARENT: Record<string, Options> = {
  aggregateShape: { enableAggregates: true },
  packageExclusionPreset: { useFilterFile: true },
  longDurationThresholdHoursExplicit: { longDurationThresholdHours: 6 },
  applyMinimumUsageDurationToConcurrentSubintervals: { modelConcurrentUsage: true },
  sessionGapBasis: { sessionGroupingPolicy: "ross_15s" },
  sessionBoundaryScope: { sessionGroupingPolicy: "ross_15s" },
  emitSessionBreakLineage: { sessionGroupingPolicy: "ross_15s" },
  screenGatingRule: { enableScreenGatedCrediting: true },
  creditedSessionCapMinutes: { enableScreenGatedCrediting: true },
  deviceLivenessGapToleranceMinutes: { enableScreenGatedCrediting: true },
  autoLockBridgeSeconds: { enableScreenGatedCrediting: true },
  noWitnessMinDayApps: { enableScreenGatedCrediting: true },
  polledEmulationIntervalSeconds: { polledEmulationMethod: "ross_2025_sampled_gap_v1" },
  polledEmulationGapSeconds: { polledEmulationMethod: "ross_2025_sampled_gap_v1" },
  complianceThresholdPercent: { enableComplianceScoring: true },
  aggregateTopAppsLimit: { enableAggregates: true },
  // The screen-session cap travels as a pair: (none, 0) or (truncate |
  // exclude_participant, > 0); the kernel refuses any other shape. Each case is
  // the pair applyScreenMaximumDurationChange (ScreenDetectionCard) completes a
  // single-control change to: a positive minute value turns "none" into
  // "truncate", and an active disposition starts from 60 minutes.
  screenSessionMaximumDurationMinutes: { screenSessionMaximumDurationDisposition: "truncate" },
  screenSessionMaximumDurationDisposition: { screenSessionMaximumDurationMinutes: 60 },
};

function buildCases(): { cases: Case[]; uncovered: string[] } {
  const cases: Case[] = [{ name: "defaults", diff: {} }];
  const uncovered: string[] = [];
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
    const fallback = DEFAULTS[key];
    let values: unknown[];
    if (ENUM_VALUES[key]) values = ENUM_VALUES[key].filter((value) => value !== fallback);
    else if (typeof fallback === "boolean") values = [!fallback];
    else if (VALUE_CASES[key]) values = VALUE_CASES[key];
    else {
      uncovered.push(key);
      continue;
    }
    for (const value of values) {
      // The four maximum-duration keys travel as one of five legal vectors; a
      // partial set is returned to omission on purpose, so each case is the
      // vector the Settings control would complete it to.
      const diff = (MAXIMUM_DURATION_VECTOR_KEYS as readonly string[]).includes(key)
        ? Object.fromEntries(
            Object.entries(
              completeMaximumDurationVector({}, key as MaximumDurationVectorKey, value),
            ).filter(([, entry]) => entry !== undefined),
          )
        : { ...(PARENT[key] ?? {}), [key]: value };
      cases.push({ name: `${key}=${JSON.stringify(value)}`, diff });
    }
  }
  return { cases, uncovered };
}

export const { cases: CASES, uncovered: UNCOVERED } = buildCases();

// Values the app offers but refuses by design, with the refusal they must show.
export const EXPECTED_REFUSALS: Record<string, string> = {
  'maximumDurationThresholdSource="b12_adaptive_participant"':
    "adaptive_maximum_threshold_provider_unavailable",
  // The source-sensitive screen arms need a capability evidence CSV (none here).
  'screenSessionConstructionStrategy="parry_toth_2025_session_glance_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="zhu_2018_unlock_lock_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="unlock_to_lock_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="unlock_to_off_or_lock_v1"':
    "needs an input capability evidence CSV",
  // Stages whose companion file this fixture does not supply.
  "enablePersonAttribution=true": "deviceSharingFile is required",
  "enableStudyWindowFilter=true": "studyDatesFile is required",
};
