import dagre from "@dagrejs/dagre";

import type { Section, ViewGraph } from "@/components/GraphPanel/viewGraph";

/**
 * Pure layout over the declared pipeline graph. The WHOLE graph is laid out by
 * dagre in one pass, so the library owns all positions, ranking and
 * crossing-minimisation — there are no hand-placed coordinates and no overlaps.
 *
 * Dagre receives exactly the graph's declared edges. No semantic category is
 * treated as a privileged "spine", and no synthetic bridge is introduced for
 * layout purposes. That keeps the picture faithful as Rust adds, removes, or
 * regroups workflow nodes.
 *
 * View-only — `graphDef` (data flow, outputs) is unchanged.
 */

export type LayoutDirection = "LR" | "TB";
type EdgeVariant = "flow";

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 78;

interface LayoutNode {
  id: string;
  label: string;
  section: Section;
  x: number;
  y: number;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** Retained for consumers that distinguish declared flow from future overlays. */
  variant: EdgeVariant;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function layoutGraph(def: ViewGraph, direction: LayoutDirection): GraphLayout {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 90, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of def.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Every declared dependency participates equally in layout and rendering.
  const edges: LayoutEdge[] = [];
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      graph.setEdge(input, node.id);
      edges.push({
        id: `${input}->${node.id}`,
        source: input,
        target: node.id,
        variant: "flow",
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
    };
  });

  return { nodes, edges };
}
