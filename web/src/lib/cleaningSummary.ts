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
          ? `Retained but excluded ${sessionCount} below-minimum sessions.`
          : minimumReceipt.effectiveDisposition === "drop_row"
            ? `Dropped ${sessionCount} below-minimum sessions.`
            : `Retained and credited ${sessionCount} below-minimum sessions.`;
    steps.push({
      step: "Minimum usage duration (seconds)",
      detail: `${dispositionDetail}${subintervalCount ? ` Also blanked ${subintervalCount} concurrent subintervals.` : ""}`,
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
      step: "Maximum-duration policy",
      detail: `Flagged ${flagged} episodes, retained but excluded ${excluded}, truncated ${truncated}, and dropped ${dropped}.`,
      count: flagged + excluded + truncated + dropped,
    });
  }

  if (options.intervalQualityPolicy !== "none") {
    steps.push({
      step: "Interval quality policy",
      detail: `Truncated ${cleaningCounts.culverhouseBoundedIntervals} App Usage rows and flagged ${cleaningCounts.culverhouseFlaggedDays} participant-days.`,
      count: cleaningCounts.culverhouseBoundedIntervals,
    });
  }

  if (options.dropOutOfSourceOrderEvents) {
    steps.push({
      step: "Drop events written out of chronological order",
      detail: `Dropped ${cleaningCounts.outOfOrderEventsDropped} events written out of chronological order.`,
      count: cleaningCounts.outOfOrderEventsDropped,
    });
  }

  if (options.filterZeroDurationSessions) {
    steps.push({
      step: "Filter zero duration sessions",
      detail: `Removed ${zeroDurationReceipt.removedRowCount} zero-duration rows.`,
      count: zeroDurationReceipt.removedRowCount,
    });
  }

  if (options.screenSessionMaximumDurationDisposition !== "none") {
    if (options.screenSessionMaximumDurationDisposition === "truncate") {
      steps.push({
        step: "Screen-session maximum-duration action",
        detail: `Truncated ${cleaningCounts.screenSessionsCapped} screen sessions to ${options.screenSessionMaximumDurationMinutes} minutes.`,
        count: cleaningCounts.screenSessionsCapped,
      });
    } else {
      steps.push({
        step: "Screen-session maximum-duration action",
        detail: `Excluded ${cleaningCounts.screenDurationExcludedParticipants} participants whose screen sessions exceeded ${options.screenSessionMaximumDurationMinutes} minutes.`,
        count: cleaningCounts.screenDurationExcludedParticipants,
      });
    }
  }

  if (options.enableScreenGatedCrediting) {
    steps.push({
      step: "Screen-gated usage credit",
      detail: `${creditedAppRowCount} rows written to the Credited App Usage file.`,
      count: creditedAppRowCount,
    });
  }

  return steps;
}
