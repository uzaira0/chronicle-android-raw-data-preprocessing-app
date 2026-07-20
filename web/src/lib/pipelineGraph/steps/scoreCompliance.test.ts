/**
 * Mutation-killing test for the score_compliance shared-participant fallback:
 * an absent attribution report must yield an EMPTY shared set, so every day
 * scores as Non-Shared (100%) rather than being scored against the threshold.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import type {
  AttributionMinutesAccumulation,
  ComplianceResult,
} from "@/lib/stages/scoreCompliance";
import { scoreDays } from "@/lib/pipelineGraph/steps/scoreCompliance";

describe("score_compliance score_days", () => {
  it("scores every participant Non-Shared when the report is absent (empty shared-set fallback)", () => {
    // The accumulation names a participant literally "Stryker was here" so that
    // the mutant `?? ["Stryker was here"]` would (wrongly) mark it Shared and
    // score it 30% (known 30 / total 100). The real empty fallback keeps it
    // Non-Shared at 100%.
    const accumulation: AttributionMinutesAccumulation = {
      buckets: new Map([["Stryker was here 2024-01-01", { known: 30, unknown: 70 }]]),
      participantsSeen: new Map([["Stryker was here", new Set(["2024-01-01"])]]),
    };
    const ctx = { options: { complianceThresholdPercent: 70 }, support: {} } as unknown as PipelineCtx;
    const result = scoreDays.run({ accumulation, report: null }, ctx) as ComplianceResult;
    expect(result.days).toHaveLength(1);
    expect(result.days[0].sharingStatus).toBe("Non-Shared");
    expect(result.days[0].compliancePercent).toBe(100);
  });
});
