import { describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { topoSort } from "@/lib/pipelineGraph/engine";
import { buildChronicleGraph, UNBOUND_OPTION_KEYS } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";

describe("buildChronicleGraph", () => {
  const def = buildChronicleGraph();

  it("topo-sorts cleanly and ends at the outputs sink", () => {
    const order = topoSort(def as GraphDef<unknown>);
    expect(order[0]).toBe("parse_events");
    expect(order[order.length - 1]).toBe("outputs");
  });

  it("binds every pipeline-semantic option to at least one node", () => {
    const bound = new Set<string>();
    for (const node of def.nodes) {
      for (const knob of node.knobs) bound.add(knob.optionKey);
    }
    const missing = Object.keys(DEFAULT_BROWSER_OPTIONS).filter(
      (key) => !bound.has(key) && !UNBOUND_OPTION_KEYS.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("does not bind options declared presentation/runtime-only", () => {
    const bound = new Set<string>();
    for (const node of def.nodes) {
      for (const knob of node.knobs) bound.add(knob.optionKey);
    }
    const wrongly = [...UNBOUND_OPTION_KEYS].filter((key) => bound.has(key));
    expect(wrongly).toEqual([]);
  });

  it("is a genuine DAG, not a chain: episodes and the state timeline both feed downstream joins", () => {
    const byId = new Map(def.nodes.map((node) => [node.id, node]));
    expect(byId.get("outputs")!.inputs.length).toBeGreaterThan(1);
    expect(byId.get("device_state_timeline")!.inputs).toEqual(["app_policy"]);
    expect(byId.get("reconstruct_episodes")!.inputs).toEqual(["app_policy"]);
  });

  it("uses community-vocabulary ids and sections only", () => {
    const validSections = new Set(["preprocess", "clean", "analyze", "output"]);
    for (const node of def.nodes) {
      expect(node.id).toMatch(/^[a-z][a-z_]+$/);
      expect(validSections.has(node.section)).toBe(true);
    }
    const ids = def.nodes.map((node) => node.id);
    expect(ids).toContain("device_state_timeline");
    expect(ids).toContain("reconstruct_episodes");
    expect(ids).toContain("interval_quality");
    expect(ids).toContain("day_coverage");
  });
});
