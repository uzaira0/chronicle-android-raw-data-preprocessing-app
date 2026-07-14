import { useMemo, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import {
  affectedBy,
  joinPoints,
  mustPassThrough,
  sentenceFor,
  sharedUpstream,
} from "@/lib/pipelineGraph/analysis";
import type { GraphDef, NodeStatus, Section } from "@/lib/pipelineGraph/graphTypes";
import type { ProcessedFileResult } from "@/lib/types";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/components/GraphPanel/graphLayout";
import { SentenceBar } from "@/components/GraphPanel/SentenceBar";

/**
 * Interactive pipeline graph. The declared dependency graph is the single
 * source of truth (web/src/lib/pipelineGraph/graphDef.ts); this panel renders
 * it with dagre positions and answers path questions visually:
 *   click        → everything downstream of the clicked step lights up
 *   second click → the shared upstream of the two steps pulses
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
};

type PipelineNodeData = {
  label: string;
  section: Section;
  status: NodeStatus | null;
  isJoin: boolean;
  [key: string]: unknown;
};

type PipelineFlowNode = Node<PipelineNodeData, "pipeline">;

function PipelineNode({ data }: NodeProps<PipelineFlowNode>): ReactElement {
  return (
    <div className={`graph-node graph-node--${data.section}`} data-testid={`graph-node-body`}>
      <span className="graph-node__section">{SECTION_LABELS[data.section]}</span>
      <span className="graph-node__label">{data.label}</span>
      <span className="graph-node__badges">
        {data.status ? (
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
};

export function GraphPanel({ results, displayMasker }: Props): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);

  const def = useMemo<GraphDef<unknown>>(() => buildChronicleGraph() as GraphDef<unknown>, []);
  const layout = useMemo(() => layoutGraph(def), [def]);
  const joins = useMemo(() => new Set(joinPoints(def)), [def]);
  const labelById = useMemo(
    () => new Map(def.nodes.map((node) => [node.id, node.label])),
    [def],
  );

  const reportedResults = results.filter((result) => result.graphReport);
  const activeResult =
    reportedResults.find((result) => result.inputFileName === reportFileName) ??
    reportedResults[reportedResults.length - 1] ??
    null;
  const statuses = activeResult?.graphReport?.statuses ?? null;

  const cone = useMemo(
    () => (selected ? new Set(affectedBy(def, selected)) : null),
    [def, selected],
  );
  const shared = useMemo(
    () => (selected && second ? new Set(sharedUpstream(def, selected, second)) : null),
    [def, selected, second],
  );
  const through = useMemo(
    () =>
      selected && !second && hovered && hovered !== selected
        ? new Set(mustPassThrough(def, selected, hovered))
        : null,
    [def, selected, second, hovered],
  );

  const labels = (ids: Iterable<string>): string =>
    [...ids].map((id) => labelById.get(id) ?? id).join(", ");

  let sentence: string | null = null;
  if (selected && second && shared) {
    sentence =
      shared.size > 0
        ? sentenceFor("sharedUpstream", {
            a: labelById.get(selected) ?? selected,
            b: labelById.get(second) ?? second,
            shared: labels(shared),
          })
        : `${labelById.get(selected) ?? selected} and ${labelById.get(second) ?? second} share no upstream steps — they move independently.`;
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

  const nodes: PipelineFlowNode[] = layout.nodes.map((node) => {
    const inCone = cone?.has(node.id) ?? false;
    const isSelected = node.id === selected;
    const isSecond = node.id === second;
    const classes = ["graph-flow-node"];
    if (selected && second) {
      if (shared?.has(node.id)) classes.push("is-pulsing");
      else if (!isSelected && !isSecond) classes.push("is-dimmed");
    } else if (selected) {
      if (!isSelected && !inCone) classes.push("is-dimmed");
      if (through?.has(node.id)) classes.push("is-emphasized");
    }
    if (isSelected || isSecond) classes.push("is-selected");
    return {
      id: node.id,
      type: "pipeline",
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      className: classes.join(" "),
      data: {
        label: node.label,
        section: node.section,
        status: statuses ? (statuses[node.id] ?? null) : null,
        isJoin: joins.has(node.id),
      },
      draggable: false,
      connectable: false,
    };
  });

  const edges: Edge[] = layout.edges.map((edge) => {
    const active =
      !selected ||
      (second
        ? (shared?.has(edge.source) || edge.source === selected || edge.source === second) &&
          (shared?.has(edge.target) || edge.target === selected || edge.target === second)
        : (edge.source === selected || (cone?.has(edge.source) ?? false)) &&
          (cone?.has(edge.target) ?? false));
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      className: active ? "graph-flow-edge" : "graph-flow-edge is-dimmed",
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

  return (
    <section className="workflow-section" aria-labelledby="graph-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="graph-title" className="workflow-section__title">Pipeline graph</h2>
          <p className="workflow-section__intro">
            Every step the app runs, what feeds it, and what your settings act on.
            {statuses
              ? " Badges show what the last run actually recomputed versus reused."
              : " Process a file to see per-step run status here."}
          </p>
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

      <SentenceBar sentence={sentence} />

      <div className="graph-canvas" data-testid="graph-canvas">
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
          fitView
          minZoom={0.2}
          nodesConnectable={false}
          nodesDraggable={false}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
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
