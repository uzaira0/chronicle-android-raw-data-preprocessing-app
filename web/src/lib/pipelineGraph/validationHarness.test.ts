/**
 * Tests for the pipeline-graph validation harness itself.
 *
 * The default-case guards in expectedBypassed / altValue are exercised
 * directly. The stale-cache violation branches in traceGraphExecution only
 * fire on a graph whose node bodies read values NOT in their cache key, so
 * this file mocks graphDef.buildChronicleGraph to inject deliberately-buggy
 * nodes — one per violation class — and asserts each is reported.
 */

import { describe, expect, it, vi } from "vitest";
import type { NodeDef } from "@/lib/pipelineGraph/graphTypes";
import type { PipelineCtx } from "@/lib/pipelineGraph/graphDef";

const { FAKE_GRAPH } = vi.hoisted(() => {
  const mk = (
    id: string,
    inputs: string[],
    run: (ctx: PipelineCtx, inputs: Record<string, unknown>) => unknown,
    extra: Partial<NodeDef<PipelineCtx>> = {},
  ): NodeDef<PipelineCtx> => ({
    id,
    label: id,
    section: "preprocess",
    inputs,
    knobs: [],
    run,
    ...extra,
  });

  const nodes: NodeDef<PipelineCtx>[] = [
    // A clean source node so a downstream node can declare a real input.
    mk("src", [], () => 1),
    // Reads an option that is not in its (empty) knob set → line 429.
    mk("leaky_opt", [], (ctx) => {
      void (ctx.options as unknown as Record<string, unknown>).ghost_option;
      return null;
    }),
    // Reads a support field that maps to no known file → line 436.
    mk("leaky_support_unknown", [], (ctx) => {
      void (ctx.support as unknown as Record<string, unknown>).ghost_field;
      return null;
    }),
    // Reads a real support field whose file is NOT declared here → line 438.
    mk("leaky_support_undeclared", [], (ctx) => {
      void ctx.support.filterMap;
      return null;
    }),
    // Reads an upstream input it never declared → line 443.
    mk("leaky_input", [], (_ctx, inputs) => {
      void inputs.ghost_input;
      return null;
    }),
    // A non-source node (has inputs) that reads csvText → line 447.
    mk("leaky_csv", ["src"], (ctx) => {
      void ctx.csvText;
      return null;
    }),
  ];

  return { FAKE_GRAPH: { nodes } };
});

vi.mock("@/lib/pipelineGraph/graphDef", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipelineGraph/graphDef")>();
  return { ...actual, buildChronicleGraph: () => FAKE_GRAPH };
});

// Imported AFTER the mock so the module-level `def`/`byId`/`order` derive from
// the injected buggy graph.
const { traceGraphExecution, expectedBypassed, altValue, ALL_ON } = await import(
  "@/lib/pipelineGraph/validationHarness"
);

describe("expectedBypassed", () => {
  it("throws for a node id that has no bypass spec", () => {
    expect(() => expectedBypassed("no_such_node", ALL_ON)).toThrow(
      /no bypass spec for node "no_such_node"/,
    );
  });
});

describe("altValue", () => {
  it("flips booleans and bumps numbers without a case", () => {
    expect(altValue("processAppUsage", true)).toBe(false);
    expect(altValue("someCount", 3)).toBe(4);
  });

  it("changes both product-owned output identity domains in either direction", () => {
    expect(altValue("studyName", "")).toBe("Alternative Study");
    expect(altValue("studyName", "Existing Study")).toBe("");
    expect(altValue("aggregateShape", "wide")).toBe("long");
    expect(altValue("aggregateShape", "long")).toBe("wide");
  });

  it("throws for an option key with no alternate-value case", () => {
    expect(() => altValue("no_such_option", "x")).toThrow(
      /no alternate value for option "no_such_option"/,
    );
  });
});

describe("traceGraphExecution flags undeclared reads (stale-cache soundness)", () => {
  it("reports every violation class for a graph of buggy nodes", async () => {
    const result = await traceGraphExecution(ALL_ON);
    // No node body threw — the walk completed and collected violations.
    expect(result.error).toBeNull();
    const has = (needle: string) => result.violations.some((v) => v.includes(needle));

    // 429: option read not in the node's knob set.
    expect(has('leaky_opt reads option "ghost_option" not in its knob set')).toBe(true);
    // 436: support read that maps to no known file.
    expect(has('leaky_support_unknown reads unknown support field "ghost_field"')).toBe(true);
    // 438: support read whose file is not declared on the node.
    expect(
      has('leaky_support_undeclared reads support "filterMap" (filterFile) not declared'),
    ).toBe(true);
    // 443: read of an undeclared upstream input.
    expect(has('leaky_input reads undeclared upstream "ghost_input"')).toBe(true);
    // 447: csvText read by a non-source node.
    expect(has("leaky_csv reads csvText but is not a source node")).toBe(true);
  });
});
