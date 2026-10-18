import type {
  CleaningCounts,
  MaximumDurationReceipt,
  RuntimeScientificEvidenceSummary,
} from "@/lib/generatedRuntimeBoundary";
import type { BrowserProcessingOptions, CleaningSummaryStep } from "@/lib/types";

/** One plain-English line per cleaning step that is ON, from the run's counts. */
export function buildCleaningSummary(
  options: BrowserProcessingOptions,
  cleaningCounts: CleaningCounts,
  scientificEvidence: RuntimeScientificEvidenceSummary,
  maximumDurationReceipt: MaximumDurationReceipt | undefined,
  creditedAppRowCount: number,
): CleaningSummaryStep[] {
  const steps: CleaningSummaryStep[] = [];
  const minimumReceipt = scientificEvidence.minimumDurationReceipt;
  const concurrentReceipt = scientificEvidence.concurrentSubintervalFloorReceipt;
  const zeroDurationReceipt = scientificEvidence.zeroDurationCleanupReceipt;

  if (options.useFilterFile || options.applicationLabelExclusions.length > 0) {
    const sources = [
      ...(options.useFilterFile ? ["the filter file"] : []),
      ...(options.applicationLabelExclusions.length
        ? ["exact application label exclusions"]
        : []),
    ];
    steps.push({
      step: "Filter file",
      detail: `${cleaningCounts.filterRelabeledRows} App Usage rows marked filtered by ${sources.join(" and ")}.`,
      count: cleaningCounts.filterRelabeledRows,
    });
  }

  if (options.minimumUsageDuration > 0) {
    const sessionCount =
      minimumReceipt.effectiveDisposition === "chronicle_blank_keep_row" ||
      minimumReceipt.effectiveDisposition === "retain_but_exclude"
        ? minimumReceipt.retainedExcludedCount
        : minimumReceipt.effectiveDisposition === "drop_row"
          ? minimumReceipt.droppedCount
          : minimumReceipt.qualifyingCount;
    const subintervalCount = concurrentReceipt.effectiveApplied
      ? concurrentReceipt.blankedSubintervalCount
      : 0;
    const dispositionDetail =
      minimumReceipt.effectiveDisposition === "chronicle_blank_keep_row"
        ? `Blanked timing for ${sessionCount} below-minimum sessions.`
        : minimumReceipt.effectiveDisposition === "retain_but_exclude"
          ? `Kept ${sessionCount} below-minimum sessions but left them out of totals.`
          : minimumReceipt.effectiveDisposition === "drop_row"
            ? `Dropped ${sessionCount} below-minimum sessions.`
            : `Kept and counted ${sessionCount} below-minimum sessions.`;
    steps.push({
      step: "Minimum app-use time (seconds)",
      detail: `${dispositionDetail}${subintervalCount ? ` Also blanked ${subintervalCount} pieces of overlapping use.` : ""}`,
      count: sessionCount + subintervalCount,
    });
  }

  if (options.maximumDurationPolicy !== undefined) {
    const outcomes = maximumDurationReceipt?.outcomeCounts ?? {};
    const flagged = outcomes.flagged_retained ?? 0;
    const excluded = outcomes.retained_excluded ?? 0;
    const truncated = outcomes.truncated ?? 0;
    const dropped = outcomes.dropped ?? 0;
    steps.push({
      step: "Long episode rule",
      detail: `Flagged ${flagged} episodes, left ${excluded} out of totals, shortened ${truncated}, and removed ${dropped}.`,
      count: flagged + excluded + truncated + dropped,
    });
  }

  if (options.intervalQualityPolicy !== "none") {
    steps.push({
      step: "Clean unusual intervals",
      detail: `Shortened ${cleaningCounts.culverhouseBoundedIntervals} App Usage rows and flagged ${cleaningCounts.culverhouseFlaggedDays} participant-days.`,
      count: cleaningCounts.culverhouseBoundedIntervals,
    });
  }

  if (options.dropOutOfSourceOrderEvents) {
    steps.push({
      step: "Remove events out of time order",
      detail: `Removed ${cleaningCounts.outOfOrderEventsDropped} events logged out of time order.`,
      count: cleaningCounts.outOfOrderEventsDropped,
    });
  }

  if (options.filterZeroDurationSessions) {
    steps.push({
      step: "Remove zero-time sessions",
      detail: `Removed ${zeroDurationReceipt.removedRowCount} zero-duration rows.`,
      count: zeroDurationReceipt.removedRowCount,
    });
  }

  if (options.screenSessionMaximumDurationDisposition !== "none") {
    if (options.screenSessionMaximumDurationDisposition === "truncate") {
      steps.push({
        step: "What to do with long screen sessions",
        detail: `Shortened ${cleaningCounts.screenSessionsCapped} screen sessions to ${options.screenSessionMaximumDurationMinutes} minutes.`,
        count: cleaningCounts.screenSessionsCapped,
      });
    } else {
      steps.push({
        step: "What to do with long screen sessions",
        detail: `Excluded ${cleaningCounts.screenDurationExcludedParticipants} participants whose screen sessions exceeded ${options.screenSessionMaximumDurationMinutes} minutes.`,
        count: cleaningCounts.screenDurationExcludedParticipants,
      });
    }
  }

  if (options.enableScreenGatedCrediting) {
    steps.push({
      step: "Count screen-on app time",
      detail: `${creditedAppRowCount} rows written to the Credited App Usage file.`,
      count: creditedAppRowCount,
    });
  }

  return steps;
}
