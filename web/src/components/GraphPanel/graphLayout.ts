import dagre from "@dagrejs/dagre";

import { spliceOut, type Section, type ViewGraph } from "@/components/GraphPanel/viewGraph";

/**
 * Pure layout over the declared pipeline graph. The WHOLE graph is laid out by
 * dagre in one pass, so the library owns all positions, ranking and
 * crossing-minimisation — there are no hand-placed coordinates and no overlaps.
 *
 * Two inputs shape it into a straight lossless backbone with the lossy CLEAN
 * steps on side branches:
 *
 *   1. dagre is fed the real feeds-edges (so every node, clean included, is
 *      ranked) PLUS heavy-weighted "backbone" edges — the clean-free edges and
 *      the bridges spliceOut synthesises across a clean node (e.g. annotate →
 *      observation-window). The heavy weight makes dagre hold the backbone
 *      straight and settle clean nodes into adjacent lanes.
 *   2. Only REAL feeds-edges are DRAWN. The bridges are layout guidance, never
 *      rendered, so no edge implies a dependency the pipeline does not have.
 *
 * Drawn edges touching a clean node are dashed ("tap" in / "rejoin" out); the
 * rest are the solid backbone.
 *
 * View-only — `graphDef` (data flow, outputs) is unchanged.
 */

export type LayoutDirection = "LR" | "TB";
export type EdgeVariant = "spine" | "tap";

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 64;

/** Heavy weight keeps the lossless backbone straight; taps use the default. */
const SPINE_WEIGHT = 12;
const TAP_WEIGHT = 1;

export interface LayoutNode {
  id: string;
  label: string;
  section: Section;
  x: number;
  y: number;
  /** A `clean` node — rendered on a branch off the backbone with dashed edges. */
  offSpine: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** `spine` = solid backbone edge; `tap` = dashed clean-branch connector. */
  variant: EdgeVariant;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function layoutGraph(def: ViewGraph, direction: LayoutDirection): GraphLayout {
  const cleanIds = new Set(
    def.nodes.filter((node) => node.section === "clean").map((node) => node.id),
  );

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 90, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of def.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Layout guidance: heavy backbone edges (clean-free edges + bridges across
  // clean nodes). These straighten the spine; they are NOT drawn.
  const spineDef = spliceOut(def, cleanIds);
  for (const node of spineDef.nodes) {
    for (const input of node.inputs) {
      graph.setEdge(input, node.id, { weight: SPINE_WEIGHT });
    }
  }

  // Real feeds-edges: fed to dagre (so clean nodes are ranked/placed) and DRAWN.
  // An edge touching a clean node is a dashed tap; otherwise it is the solid
  // backbone (a clean-free real edge already carries SPINE_WEIGHT from above,
  // and setEdge de-dupes by endpoints, so the heavy weight is preserved).
  const edges: LayoutEdge[] = [];
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      const tap = cleanIds.has(node.id) || cleanIds.has(input);
      if (tap) graph.setEdge(input, node.id, { weight: TAP_WEIGHT });
      edges.push({
        id: `${input}->${node.id}`,
        source: input,
        target: node.id,
        variant: tap ? "tap" : "spine",
      });
    }
  }

  // dagre.graphlib.Graph() creates Graph<any, any, any>, but dagre.layout accepts that.
  // Type assertion is necessary because the library's type stubs are overly strict.
  dagre.layout(graph as Parameters<typeof dagre.layout>[0]);

  const nodes: LayoutNode[] = def.nodes.map((node) => {
    const placed = graph.node(node.id) as { x: number; y: number };
    // dagre positions node centers; React Flow expects the top-left corner.
    return {
      id: node.id,
      label: node.label,
      section: node.section,
      x: placed.x - NODE_WIDTH / 2,
      y: placed.y - NODE_HEIGHT / 2,
      offSpine: cleanIds.has(node.id),
    };
  });

  return { nodes, edges };
}
