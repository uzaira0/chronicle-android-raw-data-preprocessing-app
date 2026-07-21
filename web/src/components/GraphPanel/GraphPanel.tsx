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
 * Interactive pipeline graph. Rust projects the product-owned topology and
 * run state; this panel maps that typed view to dagre positions and answers
 * path questions visually:
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

/** Per-node run metrics projected from the ExecutionLedger. */
type NodeMetrics = {
  rowsIn: number | null;
  rowsOut: number | null;
  durationMs: number;
  /** Messages of VIOLATED (ok: false) expectations on this record. */
  violations: string[];
};

type PipelineNodeData = {
  label: string;
  section: Section;
  status: NodeStatus | null;
  isJoin: boolean;
  /** Gated off by the CURRENT settings (independent of any run report). */
  isOff: boolean;
  /** Plain-English step explanation (tooltip + selection detail line). */
  description: string | null;
  /**
   * At step scale: the label of the execution unit this step runs inside
   * (the engine's memoization boundary — an arbitrary grouping, shown as
   * the eyebrow). Null at unit scale.
   */
  unit: string | null;
  /** Ledger metrics from the active run (null before any run). */
  metrics: NodeMetrics | null;
  [key: string]: unknown;
};

/** Compact "in→out" row-count text; null when neither side is row-shaped. */
function formatRows(metrics: NodeMetrics): string | null {
  if (metrics.rowsIn === null && metrics.rowsOut === null) return null;
  const side = (count: number | null): string => (count === null ? "·" : String(count));
  return `${side(metrics.rowsIn)}→${side(metrics.rowsOut)}`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1 ? "<1ms" : `${Math.round(durationMs)}ms`;
}

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
      <span className="graph-node__section">
        {data.unit ?? SECTION_LABELS[data.section]}
      </span>
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
        {data.metrics ? (
          <span
            className="graph-node__metrics"
            data-testid="graph-node-metrics"
            title={`Last run: ${formatRows(data.metrics) ?? "no row-shaped data"} rows, ${formatDuration(data.metrics.durationMs)}`}
          >
            {[formatRows(data.metrics), formatDuration(data.metrics.durationMs)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
        {data.metrics && data.metrics.violations.length > 0 ? (
          <span
            className="graph-node__warn"
            data-testid="graph-node-warn"
            title={data.metrics.violations.join("\n")}
          >
            ⚠ {data.metrics.violations.length}
          </span>
        ) : null}
      </span>
    </div>
  );
}

const NODE_TYPES = { pipeline: PipelineNode };

type Props = {
  results: ProcessedFileResult[];
  planStageView: ProcessedFileResult["rustStageView"] | null;
  displayMasker: DemoDisplayMasker;
  options: BrowserProcessingOptions;
};

/**
 * The unit/step boundary is an ARBITRARY scale choice — units are only the
 * engine's memoization boundary. "steps" (the default) is the full flat DAG
 * of every real transformation; "units" is the coarse grouping.
 */
type GraphScale = "units" | "steps";

export function GraphPanel({ results, planStageView, displayMasker }: Props): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [scale, setScale] = useState<GraphScale>("steps");
  const [showOff, setShowOff] = useState(false);
  const instanceRef = useRef<ReactFlowInstance<PipelineFlowNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const reportedResults = results.filter((result) => result.rustStageView);
  const activeResult =
    reportedResults.find((result) => result.inputFileName === reportFileName) ??
    reportedResults[reportedResults.length - 1] ??
    null;
  const stageView = activeResult?.rustStageView ?? planStageView;

  // Rust owns both topology and run state. These are family-specific view
  // records projected into the small graph shape used only for interaction.
  const unitDef = useMemo<GraphDef<unknown>>(
    () =>
      ({
        nodes:
          stageView?.payload.node_states.map((node) => ({
            id: node.node_id,
            label: node.label,
            section: node.section,
            inputs: node.input_nodes,
            // Path analysis accepts option bindings when present; Rust has
            // already evaluated applicability for this projection, so the UI
            // deliberately receives no option-to-node semantic bindings.
            knobs: [],
          })) ?? [],
      }) as unknown as GraphDef<unknown>,
    [stageView],
  );
  const stepDef = useMemo<GraphDef<unknown>>(() => {
    const sectionByUnit = new Map(
      stageView?.payload.node_states.map((node) => [node.node_id, node.section]) ?? [],
    );
    return {
      nodes:
        stageView?.payload.step_states.map((step) => ({
          id: step.step_id,
          label: step.label,
          description: step.description,
          section: sectionByUnit.get(step.unit_id) ?? "preprocess",
          inputs: step.input_steps,
          knobs: [],
        })) ?? [],
    } as unknown as GraphDef<unknown>;
  }, [stageView]);
  const def = scale === "steps" ? stepDef : unitDef;
  const stepToUnit = useMemo(
    () =>
      new Map(
        stageView?.payload.step_states.map((step) => [step.step_id, step.unit_id]) ?? [],
      ),
    [stageView],
  );
  const unitLabelById = useMemo(
    () => new Map(unitDef.nodes.map((node) => [node.id, node.label])),
    [unitDef],
  );

  const statusById = useMemo(() => {
    const statuses = new Map<string, NodeStatus>();
    for (const node of stageView?.payload.node_states ?? []) {
      if (node.execution_status) statuses.set(node.node_id, node.execution_status);
      else if (node.materialization_state === "not_applicable") {
        statuses.set(node.node_id, "bypassed");
      }
    }
    for (const step of stageView?.payload.step_states ?? []) {
      if (step.execution_status) statuses.set(step.step_id, step.execution_status);
    }
    return statuses;
  }, [stageView]);

  // Applicability is evaluated by Rust from the product contract. The UI only
  // decides whether to hide or reveal the already-projected bypassed nodes.
  const offNodes = useMemo(() => {
    return new Set(def.nodes.filter((node) => statusById.get(node.id) === "bypassed").map((node) => node.id));
  }, [def, statusById]);

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
    if (layout.nodes.length === 0) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
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

  // Ledger metrics keyed by node id. Unit ids and step ids share one
  // collision-free namespace (checked at build time), so one map serves
  // both scales.
  const ledger = activeResult?.executionLedger ?? null;
  const metricsById = useMemo(() => {
    if (!ledger) return null;
    const map = new Map<string, NodeMetrics>();
    const violationsOf = (expectations: { ok: boolean; message: string }[]): string[] =>
      expectations.filter((expectation) => !expectation.ok).map((expectation) => expectation.message);
    for (const unit of ledger) {
      map.set(unit.unit, {
        rowsIn: unit.rowsIn,
        rowsOut: unit.rowsOut,
        durationMs: unit.timing.durationMs,
        violations: violationsOf(unit.expectations),
      });
      for (const step of unit.steps) {
        map.set(step.stepId, {
          rowsIn: step.rowsIn,
          rowsOut: step.rowsOut,
          durationMs: step.timing.durationMs,
          violations: violationsOf(step.expectations),
        });
      }
    }
    return map;
  }, [ledger]);

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
        status: statusById.get(node.id) ?? null,
        isJoin: joins.has(node.id),
        isOff: offNodes.has(node.id),
        description: descriptionById.get(node.id) ?? null,
        unit:
          scale === "steps"
            ? (unitLabelById.get(stepToUnit.get(node.id) ?? "") ?? null)
            : null,
        metrics: metricsById?.get(node.id) ?? null,
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

  const switchScale = (next: GraphScale): void => {
    setScale(next);
    // Node ids differ between scales — a selection cannot survive the switch.
    setSelected(null);
    setSecond(null);
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
            {activeResult
              ? " Badges show what the last run actually recomputed versus reused."
              : " Process a file to see per-step run status here."}
          </p>
        </div>
        <div className="graph-toolbar">
          <div className="graph-direction-toggle" role="group" aria-label="Graph scale">
            <button
              type="button"
              className={`btn btn--ghost${scale === "steps" ? " is-active" : ""}`}
              data-testid="graph-scale-steps"
              aria-pressed={scale === "steps"}
              onClick={() => switchScale("steps")}
              title="Every real transformation as its own node — the full DAG."
            >
              Steps
            </button>
            <button
              type="button"
              className={`btn btn--ghost${scale === "units" ? " is-active" : ""}`}
              data-testid="graph-scale-units"
              aria-pressed={scale === "units"}
              onClick={() => switchScale("units")}
              title="Grouped by execution unit (the engine's caching boundary)."
            >
              Units
            </button>
          </div>
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
                const unit =
                  scale === "steps"
                    ? unitLabelById.get(stepToUnit.get(selected) ?? "")
                    : null;
                return description
                  ? `${unit ? `${unit} · ` : ""}${label}: ${description}`
                  : null;
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
