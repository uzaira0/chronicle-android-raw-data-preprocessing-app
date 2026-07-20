/**
 * Mutation-killing test for the observation_window studyWindows fallback: an
 * absent windows table must resolve to an EMPTY lookup, not a populated one.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import type { CanonicalRow } from "@/lib/browserPipeline";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import type { StudyWindow } from "@/lib/stages/studySupportFiles";
import { resolveWindows } from "@/lib/pipelineGraph/steps/observationWindow";

describe("observation_window resolve_participant_windows", () => {
  it("resolves to an empty lookup when no study windows are configured", () => {
    // Real: `studyWindows ?? []` â resolveParticipantWindows short-circuits on
    // the empty list and returns an EMPTY map. Mutant `?? ["Stryker was here"]`
    // â non-empty list â every participant is entered (mapped to null) â size 1.
    const rows = [{ participant_id: "P1" }] as unknown as CanonicalRow[];
    const ctx = { options: {}, support: {} } as unknown as PipelineCtx;
    const result = resolveWindows.run({ rows }, ctx) as Map<string, StudyWindow | null>;
    expect(result.size).toBe(0);
  });
});
