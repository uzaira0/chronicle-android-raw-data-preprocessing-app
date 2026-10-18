import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type {
  MaximumDurationReceipt,
  RuntimeScientificEvidenceSummary,
} from "@/lib/generatedRuntimeBoundary";
import { buildCleaningSummary } from "@/lib/cleaningSummary";
import type { BrowserProcessingOptions } from "@/lib/types";

const cleaningCounts: Parameters<typeof buildCleaningSummary>[1] = {
  filterRelabeledRows: 1,
  outOfOrderEventsDropped: 1,
  culverhouseBoundedIntervals: 1,
  culverhouseFlaggedDays: 1,
  screenSessionsCapped: 1,
  screenDurationExcludedParticipants: 1,
};

const scientificEvidence = {
  minimumDurationReceipt: {
    effectiveDisposition: "chronicle_blank_keep_row",
    qualifyingCount: 1,
    retainedExcludedCount: 1,
    droppedCount: 0,
  },
  concurrentSubintervalFloorReceipt: {
    effectiveApplied: true,
    blankedSubintervalCount: 1,
  },
  zeroDurationCleanupReceipt: { removedRowCount: 1 },
} as RuntimeScientificEvidenceSummary;

const maximumDurationReceipt = {
  outcomeCounts: {
    flagged_retained: 1,
    retained_excluded: 1,
    truncated: 1,
    dropped: 1,
  },
} as unknown as MaximumDurationReceipt;

const enabledCases: [string, Partial<BrowserProcessingOptions>][] = [
  [
    "Filter file",
    { useFilterFile: true, applicationLabelExclusions: ["Chat"] },
  ],
  ["Minimum app-use time (seconds)", { minimumUsageDuration: 30 }],
  [
    "Long episode rule",
    { maximumDurationPolicy: "post_reconstruction_strict_max_v1" },
  ],
  [
    "Clean unusual intervals",
    { intervalQualityPolicy: "culverhouse_trim_and_log" },
  ],
  [
    "Remove events out of time order",
    { dropOutOfSourceOrderEvents: true },
  ],
  ["Remove zero-time sessions", { filterZeroDurationSessions: true }],
  [
    "What to do with long screen sessions",
    { screenSessionMaximumDurationDisposition: "truncate" },
  ],
  ["Count screen-on app time", { enableScreenGatedCrediting: true }],
];

describe("buildCleaningSummary", () => {
  it("returns no steps with the default settings", () => {
    expect(
      buildCleaningSummary(
        DEFAULT_BROWSER_OPTIONS,
        cleaningCounts,
        scientificEvidence,
        undefined,
        0,
      ),
    ).toEqual([]);
  });

  it.each(enabledCases)("includes %s only when enabled", (step, update) => {
    const summary = buildCleaningSummary(
      { ...DEFAULT_BROWSER_OPTIONS, ...update },
      cleaningCounts,
      scientificEvidence,
      maximumDurationReceipt,
      1,
    );
    expect(summary.map((entry) => entry.step)).toEqual([step]);
    expect(
      buildCleaningSummary(
        DEFAULT_BROWSER_OPTIONS,
        cleaningCounts,
        scientificEvidence,
        maximumDurationReceipt,
        1,
      ).map((entry) => entry.step),
    ).not.toContain(step);
  });
});
