import dagre from "@dagrejs/dagre";

import type { GraphDef, Section } from "@/lib/pipelineGraph/graphTypes";

/**
 * Pure dagre layout over the declared pipeline graph: left-to-right ranks so
 * data flows preprocess → clean → analyze → output. Only `feeds` edges are
 * drawn; option bindings surface as node details, not as graph nodes.
 */

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 64;

export interface LayoutNode {
  id: string;
  label: string;
  section: Section;
  x: number;
  y: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function layoutGraph(def: GraphDef<unknown>): GraphLayout {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 72, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of def.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const edges: LayoutEdge[] = [];
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      graph.setEdge(input, node.id);
      edges.push({ id: `${input}->${node.id}`, source: input, target: node.id });
    }
  }

  dagre.layout(graph);

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
