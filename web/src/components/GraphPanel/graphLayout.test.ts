import { describe, expect, it } from "vitest";

import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";
import { layoutGraph } from "@/components/GraphPanel/graphLayout";

describe("graph layout", () => {
  const def = buildChronicleGraph() as GraphDef<unknown>;
  const layout = layoutGraph(def);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  it("produces a finite position for every declared node", () => {
    expect(layout.nodes).toHaveLength(def.nodes.length);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("draws one edge per feeds input", () => {
    const declared = def.nodes.reduce((sum, node) => sum + node.inputs.length, 0);
    expect(layout.edges).toHaveLength(declared);
  });

  it("lays data flow left to right: every edge source sits left of its target", () => {
    for (const edge of layout.edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(source.x).toBeLessThan(target.x);
    }
  });

  it("orders the section lanes preprocess → analyze → output by mean x", () => {
    const meanX = (section: string): number => {
      const nodes = layout.nodes.filter((node) => node.section === section);
      return nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    };
    // Preprocess and clean interleave by design (device-state runs early);
    // the coarse flow direction is what must hold.
    expect(meanX("preprocess")).toBeLessThan(meanX("analyze"));
    expect(meanX("clean")).toBeLessThan(meanX("analyze"));
    expect(meanX("analyze")).toBeLessThan(meanX("output"));
  });
});
