import { describe, expect, it } from "vitest";

import productPlan from "../../../../.semantic-federation/semantic/resources/chronicle.plan.json";
import type { ViewGraph } from "@/components/GraphPanel/viewGraph";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/components/GraphPanel/graphLayout";

describe("graph layout (single dagre pass, real edges only)", () => {
  const def: ViewGraph = {
    nodes: productPlan.nodes.map((node) => ({
      id: node.node_id,
      label: node.label,
      section: node.section as ViewGraph["nodes"][number]["section"],
      inputs: node.input_nodes,
    })),
  };
  const cleanIds = new Set(
    def.nodes.filter((node) => node.section === "clean").map((node) => node.id),
  );
  const layout = layoutGraph(def, "LR");
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  it("produces a finite position for every declared node", () => {
    expect(layout.nodes).toHaveLength(def.nodes.length);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("marks clean nodes off-spine and every other node on-spine", () => {
    for (const node of layout.nodes) {
      expect(node.offSpine).toBe(cleanIds.has(node.id));
    }
    expect(cleanIds.size).toBeGreaterThan(0);
  });

  it("draws exactly the real feeds-edges — no synthesised edges", () => {
    const declared = def.nodes.flatMap((node) =>
      node.inputs.map((input) => `${input}->${node.id}`),
    );
    expect(layout.edges).toHaveLength(declared.length);
    const drawn = new Set(layout.edges.map((e) => e.id));
    for (const id of declared) expect(drawn.has(id)).toBe(true);
  });

  it("tags an edge dashed iff it touches a clean node", () => {
    for (const edge of layout.edges) {
      const touchesClean = cleanIds.has(edge.source) || cleanIds.has(edge.target);
      expect(edge.variant).toBe(touchesClean ? "tap" : "spine");
    }
  });

  it("never overlaps two node boxes", () => {
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const overlaps =
          Math.abs(a.x - b.x) < NODE_WIDTH - 8 && Math.abs(a.y - b.y) < NODE_HEIGHT - 8;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("lays data flow left to right: every edge source sits left of its target", () => {
    for (const edge of layout.edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(source.x, `${edge.id}`).toBeLessThan(target.x);
    }
  });

  it("lays data flow top to bottom in TB mode", () => {
    const vertical = layoutGraph(def, "TB");
    const verticalById = new Map(vertical.nodes.map((node) => [node.id, node]));
    for (const edge of vertical.edges) {
      const source = verticalById.get(edge.source)!;
      const target = verticalById.get(edge.target)!;
      expect(source.y, `${edge.id}`).toBeLessThan(target.y);
    }
  });
});
