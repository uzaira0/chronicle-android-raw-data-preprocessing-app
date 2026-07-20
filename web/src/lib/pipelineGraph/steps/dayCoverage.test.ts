/**
 * Mutation-killing tests for the day_coverage step gates plus coverage for the
 * studyWindows fallback path in build_coverage_table.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import type { CanonicalRow } from "@/lib/browserPipeline";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import { buildCoverageTable, injectPlaceholders } from "@/lib/pipelineGraph/steps/dayCoverage";
import type { DayCoverageResult } from "@/lib/stages/dayCoverage";

describe("day_coverage gates", () => {
  it("gates inject_placeholders on addNoActivityPlaceholderDays", () => {
    expect(injectPlaceholders.bypassedWhen!({ addNoActivityPlaceholderDays: true })).toBe(false);
    expect(injectPlaceholders.bypassedWhen!({ addNoActivityPlaceholderDays: false })).toBe(true);
  });

  it("gates build_coverage_table on enableDayCoverage", () => {
    expect(buildCoverageTable.bypassedWhen!({ enableDayCoverage: true })).toBe(false);
    expect(buildCoverageTable.bypassedWhen!({ enableDayCoverage: false })).toBe(true);
  });
});

describe("day_coverage build_coverage_table body", () => {
  const usageRow = (participant: string, date: string): CanonicalRow =>
    ({
      participant_id: participant,
      date,
      interaction_type: "App Usage",
      duration_minutes: 5,
    }) as unknown as CanonicalRow;

  it("returns null when day coverage is disabled", () => {
    const ctx = { options: { enableDayCoverage: false }, support: {} } as unknown as PipelineCtx;
    const result = buildCoverageTable.run(
      { rows: [usageRow("P1", "2024-01-01")], rawDates: new Map() },
      ctx,
    );
    expect(result).toBeNull();
  });

  it("builds a coverage table when enabled even with no configured study windows", () => {
    // Exercises the `ctx.support.studyWindows ?? []` fallback path (studyWindows
    // absent) so the coverage table is computed windowless.
    const ctx = { options: { enableDayCoverage: true }, support: {} } as unknown as PipelineCtx;
    const rawDates = new Map<string, Set<string>>([["P1", new Set(["2024-01-01"])]]);
    const result = buildCoverageTable.run(
      { rows: [usageRow("P1", "2024-01-01")], rawDates },
      ctx,
    ) as DayCoverageResult;
    expect(result.usageDays).toBe(1);
    expect(result.coverage).toHaveLength(1);
    expect(result.coverage[0]).toMatchObject({ participantId: "P1", status: "usage" });
  });
});
