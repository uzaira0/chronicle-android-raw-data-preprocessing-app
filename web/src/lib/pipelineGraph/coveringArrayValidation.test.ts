import { describe, expect, it } from "vitest";

import { GraphEngine } from "@/lib/pipelineGraph/engine";
import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import type { PipelineCtx } from "@/lib/pipelineGraph/graphDef";
import type { BrowserProcessingOptions } from "@/lib/types";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";

import { def, expectedBypassed, makeCtx, RUN_KEYS, traceGraphExecution } from "./validationHarness";

import coveringT2 from "../../../combinatorial/covering_array_t2.json";
import coveringT3 from "../../../combinatorial/covering_array_t3.json";

/**
 * Executes the PICT-generated covering arrays (docs/dag-validate-ontologize-
 * productize-research.md §S3) through the real engine. The arrays cover every
 * pairwise (t=2) and three-way (t=3) equivalence-class combination of the
 * processing-option contract — far beyond what the hand-written sweeps reach
 * (CCM measured those at ~35% pairwise). Regenerate with:
 *
 *   make combinatorial   (repo root)
 *
 * Invariants per config: the engine finishes; node statuses match the
 * closed-form bypass spec; the ONLY tolerated error state is the documented
 * fail-loud wipe (selected-filter timezone that matches no fixture rows), and
 * when it fires the un-skipped nodes still match the bypass vector.
 */

type CoveringArray = {
  source: string;
  configs: Array<{ id: string; options: Record<string, unknown> }>;
};

const ARRAYS: CoveringArray[] = [coveringT2, coveringT3];

/** The fixture is entirely America/Chicago: a selected-filter run pinned to a
 * different zone removes every row, which the pipeline treats as fail-loud. */
function wipesAllRows(options: BrowserProcessingOptions): boolean {
  return (
    options.timezoneHandling === "selected-filter" &&
    options.selectedTimezone !== "America/Chicago"
  );
}

describe("PICT covering arrays: traced reads ⊆ declarations (cache-key soundness)", () => {
  // The same reads-⊆-declarations audit graphValidation.test.ts §3 runs over
  // its 10 hand-picked configs, here over all 80 covering-array configs: an
  // undeclared read that only manifests under a rare option interaction is
  // exactly what a pairwise/three-way array exists to surface.
  for (const array of ARRAYS) {
    it(`${array.source}: every node reads only declared knobs, support files, and inputs`, async () => {
      for (const config of array.configs) {
        const options: BrowserProcessingOptions = {
          ...DEFAULT_BROWSER_OPTIONS,
          ...(config.options as Partial<BrowserProcessingOptions>),
        };
        const result = await traceGraphExecution(options);
        if (result.error) {
          // Same tolerance as the engine suite below: the only acceptable
          // throw is the documented fail-loud all-rows wipe.
          expect(
            wipesAllRows(options),
            `${config.id}: node "${result.error.nodeId}" threw: ${result.error.message}`,
          ).toBe(true);
        }
        expect(result.violations, config.id).toEqual([]);
      }
    }, 240_000);
  }
});

describe("PICT covering arrays execute clean on the real engine", () => {
  for (const array of ARRAYS) {
    it(`${array.source}: every config runs; statuses match the bypass spec`, async () => {
      for (const config of array.configs) {
        const options: BrowserProcessingOptions = {
          ...DEFAULT_BROWSER_OPTIONS,
          ...(config.options as Partial<BrowserProcessingOptions>),
        };
        const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
        const run = await engine.run(makeCtx(options), RUN_KEYS(options));
        const errored = Object.keys(run.report.errors);

        if (errored.length > 0) {
          expect(
            wipesAllRows(options),
            `${config.id}: unexpected error(s) ${JSON.stringify(run.report.errors)}`,
          ).toBe(true);
        }

        for (const node of def.nodes) {
          const status = run.report.statuses[node.id];
          if (status === "error" || status === "skipped") {
            expect(
              errored.length > 0,
              `${config.id} node ${node.id}: ${status} without any reported error`,
            ).toBe(true);
            continue;
          }
          const expected = expectedBypassed(node.id, options) ? "bypassed" : "recomputed";
          expect(status, `${config.id} node ${node.id}`).toBe(expected);
        }
      }
    }, 240_000);
  }
});
