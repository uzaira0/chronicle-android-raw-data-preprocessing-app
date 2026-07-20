/**
 * Mutation-killing tests for the dedup_and_order step gates: each bypass is the
 * negation of its option, so the `!`-removal mutants flip the observed value.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import { exactDedupe, nudgeDuplicateTimestamps } from "@/lib/pipelineGraph/steps/dedupAndOrder";

describe("dedup_and_order gates", () => {
  it("gates exact_dedupe on deduplicateExactRows", () => {
    expect(exactDedupe.bypassedWhen!({ deduplicateExactRows: true })).toBe(false);
    expect(exactDedupe.bypassedWhen!({ deduplicateExactRows: false })).toBe(true);
  });

  it("gates nudge_duplicate_timestamps on correctDuplicateEventTimestamps", () => {
    expect(nudgeDuplicateTimestamps.bypassedWhen!({ correctDuplicateEventTimestamps: true })).toBe(
      false,
    );
    expect(nudgeDuplicateTimestamps.bypassedWhen!({ correctDuplicateEventTimestamps: false })).toBe(
      true,
    );
  });
});
