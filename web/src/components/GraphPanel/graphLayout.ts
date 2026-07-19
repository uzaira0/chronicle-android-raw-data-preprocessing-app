import dagre from "@dagrejs/dagre";

import { spliceOut } from "@/lib/pipelineGraph/analysis";
import type { GraphDef, Section } from "@/lib/pipelineGraph/graphTypes";

/**
 * Pure layout over the declared pipeline graph, drawn as a lossless
 * PREPROCESSING SPINE with the lossy CLEAN steps hanging OFF to the side.
 *
 * The spine (every non-`clean` node) is laid out by dagre with the clean nodes
 * spliced out, so consumers rewire to their nearest non-clean ancestor and the
 * backbone stays one straight, continuous chain (preprocess → analyze → output),
 * left-to-right by default or top-to-bottom when asked. Each `clean` node is then
 * placed in a side lane next to its tap point and connected with dashed "tap"
 * edges (its real inputs) and dashed "rejoin" edges (its real consumers). The
 * spine edges are solid; they include the bridges spliceOut synthesises across a
 * clean node (e.g. annotate → observation-window), which is exactly the path the
 * data takes when that clean step is turned off.
 *
 * This is a VIEW decision only — `graphDef` (data flow, outputs) is unchanged.
 */

export type LayoutDirection = "LR" | "TB";
export type EdgeVariant = "spine" | "tap";

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 64;

/** Cross-axis gap between the spine and a side lane (per lane). */
const LANE_STEP_TB = NODE_WIDTH + 56;
const LANE_STEP_LR = NODE_HEIGHT + 56;

export interface LayoutNode {
  id: string;
  label: string;
  section: Section;
  x: number;
  y: number;
  /** A `clean` node drawn off the spine (dashed connectors, side lane). */
  offSpine: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** `spine` = solid backbone edge; `tap` = dashed side-branch connector. */
  variant: EdgeVariant;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function layoutGraph(def: GraphDef<unknown>, direction: LayoutDirection): GraphLayout {
  const tb = direction === "TB";
  const cleanIds = new Set(
    def.nodes.filter((node) => node.section === "clean").map((node) => node.id),
  );

  // Spine = everything except clean; clean nodes spliced out so consumers
  // rewire to their nearest non-clean ancestor and the backbone is continuous.
  const spineDef = spliceOut(def, cleanIds);

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 28, ranksep: 96, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of spineDef.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const spineEdges: LayoutEdge[] = [];
  for (const node of spineDef.nodes) {
    for (const input of node.inputs) {
      graph.setEdge(input, node.id);
      spineEdges.push({
        id: `${input}->${node.id}`,
        source: input,
        target: node.id,
        variant: "spine",
      });
    }
  }
  dagre.layout(graph);

  // dagre positions node centers; React Flow expects the top-left corner.
  const pos = new Map<string, { x: number; y: number }>();
  for (const node of spineDef.nodes) {
    const placed = graph.node(node.id) as { x: number; y: number };
    pos.set(node.id, { x: placed.x - NODE_WIDTH / 2, y: placed.y - NODE_HEIGHT / 2 });
  }

  // Along = position along the flow; cross = perpendicular (the side lanes grow
  // along the cross axis).
  const along = (p: { x: number; y: number }): number => (tb ? p.y : p.x);
  const cross = (p: { x: number; y: number }): number => (tb ? p.x : p.y);
  const laneStep = tb ? LANE_STEP_TB : LANE_STEP_LR;
  const alongSpan = tb ? NODE_HEIGHT : NODE_WIDTH;

  const consumersOf = (id: string): string[] =>
    def.nodes.filter((node) => node.inputs.includes(id)).map((node) => node.id);

  // Place clean nodes whose inputs are all already positioned first (so a clean
  // node feeding another — effective-usage ← interval-cleaning — lands outboard
  // of its clean input rather than on top of the spine).
  const cleanNodes = def.nodes.filter((node) => cleanIds.has(node.id));
  const ordered = [...cleanNodes].sort(
    (a, b) =>
      a.inputs.filter((i) => cleanIds.has(i)).length -
      b.inputs.filter((i) => cleanIds.has(i)).length,
  );

  const placedLanes: { along: number; lane: number }[] = [];
  for (const node of ordered) {
    const inPos = node.inputs.map((i) => pos.get(i)).find(Boolean) ?? { x: 0, y: 0 };
    const consumerPositions = consumersOf(node.id)
      .map((id) => pos.get(id))
      .filter((p): p is { x: number; y: number } => Boolean(p))
      .sort((a, b) => along(a) - along(b));
    const alongCoord =
      consumerPositions.length > 0
        ? (along(inPos) + along(consumerPositions[0])) / 2
        : along(inPos) + alongSpan;

    // Smallest side lane (≥1) with no along-axis overlap against earlier taps.
    let lane = 1;
    const gap = alongSpan + 24;
    while (placedLanes.some((p) => p.lane === lane && Math.abs(p.along - alongCoord) < gap)) {
      lane += 1;
    }
    placedLanes.push({ along: alongCoord, lane });

    const crossCoord = cross(inPos) + laneStep * lane;
    pos.set(node.id, tb ? { x: crossCoord, y: alongCoord } : { x: alongCoord, y: crossCoord });
  }

  // Dashed connectors: every real feeds-edge that touches a clean node. The
  // clean-free real edges are already covered by the (possibly bridged) spine.
  const seen = new Set(spineEdges.map((edge) => edge.id));
  const tapEdges: LayoutEdge[] = [];
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      if (!cleanIds.has(node.id) && !cleanIds.has(input)) continue;
      const id = `${input}->${node.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      tapEdges.push({ id, source: input, target: node.id, variant: "tap" });
    }
  }

  const nodes: LayoutNode[] = def.nodes.map((node) => {
    const placed = pos.get(node.id) ?? { x: 0, y: 0 };
    return {
      id: node.id,
      label: node.label,
      section: node.section,
      x: placed.x,
      y: placed.y,
      offSpine: cleanIds.has(node.id),
    };
  });

  return { nodes, edges: [...spineEdges, ...tapEdges] };
}
