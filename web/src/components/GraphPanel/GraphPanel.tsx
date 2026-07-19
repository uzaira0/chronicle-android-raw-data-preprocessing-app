import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import {
  affectedBy,
  builtFrom,
  joinPoints,
  mustPassThrough,
  sentenceFor,
  sharedUpstream,
  spliceOut,
} from "@/lib/pipelineGraph/analysis";
import type { GraphDef, NodeStatus, Section } from "@/lib/pipelineGraph/graphTypes";
import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import {
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutDirection,
} from "@/components/GraphPanel/graphLayout";
import { SentenceBar } from "@/components/GraphPanel/SentenceBar";

/**
 * Interactive pipeline graph. The declared dependency graph is the single
 * source of truth (web/src/lib/pipelineGraph/graphDef.ts); this panel renders
 * it with dagre positions and answers path questions visually:
 *   click        → everything downstream of the clicked step lights up
 *   second click → if one step is built from the other, the connecting path
 *                  pulses (a chain); otherwise their shared upstream pulses
 *   hover (with a selection) → the steps every effect passes through thicken
 * Status badges come from the most recent run's engine report.
 */

const SECTION_LABELS: Record<Section, string> = {
  preprocess: "Preprocess",
  clean: "Clean",
  analyze: "Analyze",
  output: "Output",
};

const STATUS_LABELS: Record<NodeStatus, string> = {
  cached: "cached",
  recomputed: "ran",
  dirty: "needs re-run",
  error: "error",
  skipped: "skipped",
  bypassed: "off",
};

// React Flow markers do NOT inherit CSS edge styling, so the arrowhead needs a
// concrete color (slate-500 reads on both themes). One shared object — edges
// are rebuilt per render and must not allocate fresh marker literals each time.
const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 22,
  height: 22,
  color: "#64748b",
} as const;

type PipelineNodeData = {
  label: string;
  section: Section;
  status: NodeStatus | null;
  isJoin: boolean;
  /** Gated off by the CURRENT settings (independent of any run report). */
  isOff: boolean;
  /** Plain-English step explanation (tooltip + selection detail line). */
  description: string | null;
  [key: string]: unknown;
};

type PipelineFlowNode = Node<PipelineNodeData, "pipeline">;

function PipelineNode({
  data,
  targetPosition,
  sourcePosition,
}: NodeProps<PipelineFlowNode>): ReactElement {
  return (
    <div
      className={`graph-node graph-node--${data.section}`}
      data-testid={`graph-node-body`}
      title={data.description ?? undefined}
    >
      {/* React Flow drops any edge whose endpoint node has no Handle —
          these invisible handles are what let the edges render at all. */}
      <Handle
        type="target"
        position={targetPosition ?? Position.Top}
        className="graph-node__handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={sourcePosition ?? Position.Bottom}
        className="graph-node__handle"
        isConnectable={false}
      />
      <span className="graph-node__section">{SECTION_LABELS[data.section]}</span>
      <span className="graph-node__label">{data.label}</span>
      <span className="graph-node__badges">
        {/* Current settings win over a (possibly stale) run report: a step
            that is off RIGHT NOW says so, whatever the last run did. */}
        {data.isOff ? (
          <span
            className="graph-node__status graph-node__status--bypassed"
            title="Turned off by the current settings — this step passes data through unchanged."
          >
            off
          </span>
        ) : data.status ? (
          <span className={`graph-node__status graph-node__status--${data.status}`}>
            {STATUS_LABELS[data.status]}
          </span>
        ) : null}
        {data.isJoin ? (
          <span
            className="graph-node__join"
            title="Two separate chains combine at this step — results after it link everything that feeds it."
          >
            join
          </span>
        ) : null}
      </span>
    </div>
  );
}

const NODE_TYPES = { pipeline: PipelineNode };

type Props = {
  results: ProcessedFileResult[];
  displayMasker: DemoDisplayMasker;
  options: BrowserProcessingOptions;
};

export function GraphPanel({ results, displayMasker, options }: Props): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [showOff, setShowOff] = useState(false);
  const instanceRef = useRef<ReactFlowInstance<PipelineFlowNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const def = useMemo<GraphDef<unknown>>(() => buildChronicleGraph() as GraphDef<unknown>, []);

  // Steps the CURRENT settings turn off entirely — evaluated live from the
  // declared bypassedWhen predicates, no run needed.
  const offNodes = useMemo(() => {
    const bag = options as unknown as Record<string, unknown>;
    return new Set(
      def.nodes.filter((node) => node.bypassedWhen?.(bag) === true).map((node) => node.id),
    );
  }, [def, options]);

  // Off steps are HIDDEN by default (the graph shows the pipeline your
  // settings actually run); the toggle reveals them dashed. Hiding splices
  // each off pass-through out, rewiring consumers to visible ancestors.
  const visibleDef = useMemo(
    () => (showOff || offNodes.size === 0 ? def : spliceOut(def, offNodes)),
    [def, offNodes, showOff],
  );

  // A node can disappear under an active selection (option toggled off, or
  // the reveal toggle flipped) — drop stale references or the path queries
  // would ask about ids the visible graph no longer has.
  useEffect(() => {
    const ids = new Set(visibleDef.nodes.map((node) => node.id));
    if (selected && !ids.has(selected)) {
      setSelected(null);
      setSecond(null);
    } else if (second && !ids.has(second)) {
      setSecond(null);
    }
    if (hovered && !ids.has(hovered)) setHovered(null);
  }, [visibleDef, selected, second, hovered]);

  const layout = useMemo(() => layoutGraph(visibleDef, direction), [visibleDef, direction]);

  const bounds = useMemo(() => {
    const minX = Math.min(...layout.nodes.map((node) => node.x));
    const minY = Math.min(...layout.nodes.map((node) => node.y));
    const maxX = Math.max(...layout.nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...layout.nodes.map((node) => node.y + NODE_HEIGHT));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [layout]);

  // Readable anchored view: fit the graph's CROSS axis (sized to the canvas's
  // real aspect ratio) and anchor at the start of the flow, so nodes open at
  // legible size and the user scrolls along the flow — never "squeeze all
  // ranks into the canvas" (unreadably small).
  const applyAnchoredFit = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const canvas = canvasRef.current;
    const aspect =
      canvas && canvas.clientWidth > 0 ? canvas.clientHeight / canvas.clientWidth : 0.6;
    const view =
      direction === "TB"
        ? {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: Math.min(bounds.height, bounds.width * aspect),
          }
        : {
            x: bounds.x,
            y: bounds.y,
            width: Math.min(bounds.width, bounds.height / aspect),
            height: bounds.height,
          };
    void instance.fitBounds(view, { padding: 0.06 });
  }, [bounds, direction]);

  // Re-anchor whenever the layout orientation (and therefore bounds) changes —
  // no React Flow remount needed.
  useEffect(() => {
    applyAnchoredFit();
  }, [applyAnchoredFit]);

  const joins = useMemo(() => new Set(joinPoints(visibleDef)), [visibleDef]);
  const labelById = useMemo(
    () => new Map(def.nodes.map((node) => [node.id, node.label])),
    [def],
  );
  const descriptionById = useMemo(
    () => new Map(def.nodes.map((node) => [node.id, node.description ?? null])),
    [def],
  );

  const reportedResults = results.filter((result) => result.graphReport);
  const activeResult =
    reportedResults.find((result) => result.inputFileName === reportFileName) ??
    reportedResults[reportedResults.length - 1] ??
    null;
  const statuses = activeResult?.graphReport?.statuses ?? null;

  const cone = useMemo(
    () => (selected ? new Set(affectedBy(visibleDef, selected)) : null),
    [visibleDef, selected],
  );
  // Two selected nodes are either a CHAIN (one is built from the other — show
  // the CONNECTING PATH and say how they connect) or genuine siblings (then
  // their shared upstream is what links them).
  const relation = useMemo(() => {
    if (!selected || !second || !cone) return null;
    const nodeIds = new Set(visibleDef.nodes.map((node) => node.id));
    const chainBetween = (from: string, to: string) => {
      // Every node on SOME path from `from` to `to`: downstream of the first
      // AND upstream of the second. `via` (nodes on EVERY path) is only the
      // choke points — highlighting just those leaves the path visually
      // disconnected wherever it branches.
      const down = new Set(affectedBy(visibleDef, from));
      const up = new Set(builtFrom(visibleDef, to).filter((id) => nodeIds.has(id)));
      const path = new Set([from, to]);
      for (const id of down) if (up.has(id)) path.add(id);
      const toNode = visibleDef.nodes.find((node) => node.id === to);
      return {
        kind: "chain" as const,
        from,
        to,
        direct: toNode?.inputs.includes(from) ?? false,
        via: new Set(mustPassThrough(visibleDef, from, to)),
        path,
      };
    };
    if (cone.has(second)) return chainBetween(selected, second);
    if (affectedBy(visibleDef, second).includes(selected)) return chainBetween(second, selected);
    return {
      kind: "siblings" as const,
      shared: new Set(sharedUpstream(visibleDef, selected, second)),
    };
  }, [visibleDef, cone, selected, second]);
  const through = useMemo(
    () =>
      selected && !second && hovered && hovered !== selected
        ? new Set(mustPassThrough(visibleDef, selected, hovered))
        : null,
    [visibleDef, selected, second, hovered],
  );

  const labels = (ids: Iterable<string>): string =>
    [...ids].map((id) => labelById.get(id) ?? id).join(", ");

  let sentence: string | null = null;
  if (selected && second && relation) {
    if (relation.kind === "chain") {
      // "directly" is claimed ONLY when a direct edge exists; an empty `via`
      // on its own just means there is no single choke point between them.
      const how = relation.direct
        ? "directly"
        : relation.via.size > 0
          ? `through ${labels(relation.via)}`
          : "along several parallel paths";
      sentence = sentenceFor("chain", {
        from: labelById.get(relation.from) ?? relation.from,
        to: labelById.get(relation.to) ?? relation.to,
        how,
      });
    } else {
      sentence =
        relation.shared.size > 0
          ? sentenceFor("sharedUpstream", {
              a: labelById.get(selected) ?? selected,
              b: labelById.get(second) ?? second,
              shared: labels(relation.shared),
            })
          : `${labelById.get(selected) ?? selected} and ${labelById.get(second) ?? second} share no upstream steps — they move independently.`;
    }
  } else if (selected && through && through.size > 0 && hovered) {
    sentence = sentenceFor("mustPassThrough", {
      source: labelById.get(selected) ?? selected,
      target: labelById.get(hovered) ?? hovered,
      through: labels(through),
    });
  } else if (selected && cone) {
    sentence = sentenceFor("affectedBy", {
      source: labelById.get(selected) ?? selected,
      count: cone.size,
      outputs: "every result built after it",
    });
  }

  // The full highlight set for a two-node selection: the connecting path for
  // a chain, the common ancestors (plus the pair) for siblings.
  const linked =
    selected && second && relation
      ? relation.kind === "chain"
        ? relation.path
        : new Set([...relation.shared, selected, second])
      : null;

  const nodes: PipelineFlowNode[] = layout.nodes.map((node) => {
    const inCone = cone?.has(node.id) ?? false;
    const isSelected = node.id === selected;
    const isSecond = node.id === second;
    const classes = ["graph-flow-node"];
    if (linked) {
      if (linked.has(node.id) && !isSelected && !isSecond) classes.push("is-pulsing");
      else if (!isSelected && !isSecond) classes.push("is-dimmed");
    } else if (selected) {
      if (!isSelected && !inCone) classes.push("is-dimmed");
      if (through?.has(node.id)) classes.push("is-emphasized");
    }
    if (isSelected || isSecond) classes.push("is-selected");
    if (offNodes.has(node.id)) classes.push("is-off");
    return {
      id: node.id,
      type: "pipeline",
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      // dagre places every node in flow order, so handles face the flow (TB:
      // top-in / bottom-out, LR: left-in / right-out) for all nodes; clean nodes
      // are distinguished by their branch position + dashed edges, not handles.
      targetPosition: direction === "TB" ? Position.Top : Position.Left,
      sourcePosition: direction === "TB" ? Position.Bottom : Position.Right,
      className: classes.join(" "),
      data: {
        label: node.label,
        section: node.section,
        status: statuses ? (statuses[node.id] ?? null) : null,
        isJoin: joins.has(node.id),
        isOff: offNodes.has(node.id),
        description: descriptionById.get(node.id) ?? null,
      },
      draggable: false,
      connectable: false,
    };
  });

  const edges: Edge[] = layout.edges.map((edge) => {
    const active =
      !selected ||
      (linked
        ? linked.has(edge.source) && linked.has(edge.target)
        : (edge.source === selected || (cone?.has(edge.source) ?? false)) &&
          (cone?.has(edge.target) ?? false));
    const tap = edge.variant === "tap";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      className: [
        "graph-flow-edge",
        tap ? "graph-flow-edge--tap" : "",
        active ? "" : "is-dimmed",
      ]
        .filter(Boolean)
        .join(" "),
      // Dashed connectors read as the optional off-spine detour; solid = backbone.
      style: tap ? { strokeDasharray: "6 4" } : undefined,
      markerEnd: EDGE_MARKER,
    };
  });

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.id === selected && !second) {
      setSelected(null);
      setSecond(null);
      return;
    }
    if (selected && !second && node.id !== selected) {
      setSecond(node.id);
      return;
    }
    setSelected(node.id);
    setSecond(null);
  };

  const switchDirection = (next: LayoutDirection): void => {
    setDirection(next);
    // The layout shifts under the cursor and no mouseleave fires — a stale
    // hover would keep describing a node the pointer is no longer on.
    setHovered(null);
  };

  return (
    <section className="workflow-section" aria-labelledby="graph-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="graph-title" className="workflow-section__title">Pipeline graph</h2>
          <p className="workflow-section__intro">
            Every step the app runs, what feeds it, and what your settings act on.
            {offNodes.size > 0
              ? ` ${offNodes.size} step${offNodes.size === 1 ? " is" : "s are"} turned off by your current settings${showOff ? " (shown dashed)" : " and hidden"}.`
              : ""}
            {statuses
              ? " Badges show what the last run actually recomputed versus reused."
              : " Process a file to see per-step run status here."}
          </p>
        </div>
        <div className="graph-toolbar">
          <div className="graph-direction-toggle" role="group" aria-label="Graph orientation">
            <button
              type="button"
              className={`btn btn--ghost${direction === "LR" ? " is-active" : ""}`}
              data-testid="graph-direction-lr"
              aria-pressed={direction === "LR"}
              onClick={() => switchDirection("LR")}
            >
              Horizontal
            </button>
            <button
              type="button"
              className={`btn btn--ghost${direction === "TB" ? " is-active" : ""}`}
              data-testid="graph-direction-tb"
              aria-pressed={direction === "TB"}
              onClick={() => switchDirection("TB")}
            >
              Vertical
            </button>
          </div>
          {offNodes.size > 0 ? (
            <button
              type="button"
              className={`btn btn--ghost${showOff ? " is-active" : ""}`}
              data-testid="graph-show-off-toggle"
              aria-pressed={showOff}
              onClick={() => setShowOff((current) => !current)}
            >
              {showOff ? "Hide" : "Show"} {offNodes.size} off step{offNodes.size === 1 ? "" : "s"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="graph-reset-view"
            onClick={applyAnchoredFit}
          >
            Reset view
          </button>
        </div>
        {reportedResults.length > 1 ? (
          <label className="graph-report-picker">
            Run status from
            <select
              className="input"
              data-testid="graph-report-picker"
              value={activeResult?.inputFileName ?? ""}
              onChange={(event) => setReportFileName(event.target.value)}
            >
              {reportedResults.map((result) => (
                <option key={result.inputFileName} value={result.inputFileName}>
                  {displayMasker.fileName(result.inputFileName)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <SentenceBar
        sentence={sentence}
        detail={
          selected && !second
            ? (() => {
                const description = descriptionById.get(selected);
                const label = labelById.get(selected) ?? selected;
                return description ? `${label}: ${description}` : null;
              })()
            : null
        }
      />

      <div className="graph-canvas" data-testid="graph-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={(_event, node) => setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
          onPaneClick={() => {
            setSelected(null);
            setSecond(null);
          }}
          onInit={(instance) => {
            instanceRef.current = instance;
            applyAnchoredFit();
          }}
          minZoom={0.1}
          maxZoom={2}
          panOnScroll
          zoomOnPinch
          nodesConnectable={false}
          nodesDraggable={false}
        >
          <Background gap={24} />
          {/* The built-in fit-view button squeezes the WHOLE graph into the
              canvas — exactly the unreadable view the anchored fit replaces —
              so it is disabled in favor of the Reset view button above. */}
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>

      <div className="graph-legend" aria-hidden="true">
        {(Object.keys(SECTION_LABELS) as Section[]).map((section) => (
          <span key={section} className={`graph-legend__item graph-legend__item--${section}`}>
            {SECTION_LABELS[section]}
          </span>
        ))}
      </div>
    </section>
  );
}
