import {
  AGGREGATE_SHAPE_VALUES,
  BOOLEAN_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  TIMEZONE_HANDLING_VALUES,
} from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";

export type EquivalenceClass = { label: string; value: unknown };

const sanitizeLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const BOOL_CLASSES: EquivalenceClass[] = [
  { label: "true", value: true },
  { label: "false", value: false },
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
  if (BOOLEAN_KEY_SET.has(key)) return BOOL_CLASSES.map((entry) => ({ ...entry }));
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
