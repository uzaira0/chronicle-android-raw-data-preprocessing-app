import { describe, expect, it } from "vitest";

import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";
import { layoutGraph } from "@/components/GraphPanel/graphLayout";

describe("graph layout (spine + off-spine clean taps)", () => {
  const def = buildChronicleGraph() as GraphDef<unknown>;
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
    // The design has clean nodes to hang off — guard the fixture didn't lose them.
    expect(cleanIds.size).toBeGreaterThan(0);
  });

  it("spine edges are solid and never touch a clean node", () => {
    for (const edge of layout.edges.filter((e) => e.variant === "spine")) {
      expect(cleanIds.has(edge.source)).toBe(false);
      expect(cleanIds.has(edge.target)).toBe(false);
    }
  });

  it("every real feeds-edge touching a clean node is drawn as a dashed tap", () => {
    const taps = new Set(
      layout.edges.filter((e) => e.variant === "tap").map((e) => `${e.source}->${e.target}`),
    );
    for (const node of def.nodes) {
      for (const input of node.inputs) {
        if (cleanIds.has(node.id) || cleanIds.has(input)) {
          expect(taps.has(`${input}->${node.id}`)).toBe(true);
        }
      }
    }
    // Tap edges must each touch a clean node (no stray backbone in the dashed set).
    for (const edge of layout.edges.filter((e) => e.variant === "tap")) {
      expect(cleanIds.has(edge.source) || cleanIds.has(edge.target)).toBe(true);
    }
  });

  it("keeps every clean-free real edge as a spine edge (backbone stays whole)", () => {
    const spine = new Set(
      layout.edges.filter((e) => e.variant === "spine").map((e) => `${e.source}->${e.target}`),
    );
    for (const node of def.nodes) {
      if (cleanIds.has(node.id)) continue;
      for (const input of node.inputs) {
        if (cleanIds.has(input)) continue;
        expect(spine.has(`${input}->${node.id}`)).toBe(true);
      }
    }
  });

  it("lays the spine left to right: every spine edge source sits left of its target", () => {
    for (const edge of layout.edges.filter((e) => e.variant === "spine")) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(source.x).toBeLessThan(target.x);
    }
  });

  it("lays the spine top to bottom in TB mode", () => {
    const vertical = layoutGraph(def, "TB");
    const verticalById = new Map(vertical.nodes.map((node) => [node.id, node]));
    for (const edge of vertical.edges.filter((e) => e.variant === "spine")) {
      const source = verticalById.get(edge.source)!;
      const target = verticalById.get(edge.target)!;
      expect(source.y).toBeLessThan(target.y);
    }
  });

  it("offsets each clean node off the spine, outboard of its own tap point", () => {
    // In TB the side lanes grow along +x; a clean node must sit strictly outboard
    // of the node it taps (its first input) — including when it taps another
    // clean node (effective-usage ← interval-cleaning), which lands further out.
    const vertical = layoutGraph(def, "TB");
    const vById = new Map(vertical.nodes.map((n) => [n.id, n]));
    for (const node of def.nodes.filter((n) => cleanIds.has(n.id))) {
      const placed = vById.get(node.id)!;
      const tapInput = node.inputs.map((i) => vById.get(i)).find(Boolean)!;
      expect(placed.x).toBeGreaterThan(tapInput.x);
    }
  });
});
