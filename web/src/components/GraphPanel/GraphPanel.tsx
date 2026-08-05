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
  collapseProjection,
  graphForMode,
  type ExplorerMode,
  type SupportPresence,
} from "@/components/GraphPanel/graphProjection";
import { affectedBy, joinPoints } from "@/components/GraphPanel/viewGraph";
import type { NodeStatus, Section } from "@/components/GraphPanel/viewGraph";
import {
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutDirection,
} from "@/components/GraphPanel/graphLayout";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type {
  ProcessedFileResult,
  RustWorkflowExplorerView,
  WorkflowExplorerSupportRole,
} from "@/lib/types";

const SECTION_LABELS: Record<Section, string> = {
  phase: "Research phase",
  decision: "Configuration input",
  operation: "Semantic operation",
  artifact: "Typed artifact",
  source: "Source artifact",
  execution: "Physical query",
};

const STATUS_LABELS: Record<NodeStatus, string> = {
  cached: "reused",
  recomputed: "ran",
  error: "error",
  skipped: "omitted",
  bypassed: "off",
  not_observed: "not observed",
};

const SUPPORT_LABELS: Record<SupportPresence, string> = {
  available: "available",
  unavailable: "unavailable",
  not_observed: "availability not observed",
};

const MODE_LABELS: Record<ExplorerMode, string> = {
  overview: "Overview",
  decisions: "Decisions",
  lineage: "Data lineage",
  execution: "Execution",
  audit: "Audit",
};

const MODE_DESCRIPTIONS: Record<ExplorerMode, string> = {
  overview: "Research-facing phases from the current Rust workflow projection.",
  decisions: "Settings and support inputs, direct physical readers, and semantic impact closures.",
  lineage: "Typed source, intermediate, and terminal artifacts linked through semantic operations.",
  execution: "Physical queries with observed reuse, row counts, and timing from the selected run.",
  audit: "The complete semantic operation registry, including operations that are off.",
};

const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 22,
  height: 22,
  color: "#64748b",
} as const;

type ExplorerNodeData = {
  label: string;
  section: Section;
  status: NodeStatus | null;
  isJoin: boolean;
  isOff: boolean;
  description: string | null;
  eyebrow: string;
  metrics: string | null;
  warnings: string[];
  supportPresence: SupportPresence | null;
  [key: string]: unknown;
};

type ExplorerFlowNode = Node<ExplorerNodeData, "workflow">;

function ExplorerNode({
  data,
  targetPosition,
  sourcePosition,
}: NodeProps<ExplorerFlowNode>): ReactElement {
  return (
    <div
      className={`graph-node graph-node--${data.section}`}
      data-testid="graph-node-body"
      data-node-category={data.section}
      title={data.description ?? undefined}
    >
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
      <span className="graph-node__section">{data.eyebrow}</span>
      <span className="graph-node__label">{data.label}</span>
      <span className="graph-node__badges">
        {data.isOff ? (
          <span className="graph-node__status graph-node__status--bypassed">off</span>
        ) : data.status ? (
          <span className={`graph-node__status graph-node__status--${data.status}`}>
            {STATUS_LABELS[data.status]}
          </span>
        ) : null}
        {data.supportPresence ? (
          <span className={`graph-node__availability graph-node__availability--${data.supportPresence}`}>
            {SUPPORT_LABELS[data.supportPresence]}
          </span>
        ) : null}
        {data.isJoin ? <span className="graph-node__join">join</span> : null}
        {data.warnings.length > 0 ? (
          <span
            className="graph-node__warn"
            data-testid="graph-node-warn"
            title={data.warnings.join("\n")}
          >
            warning {data.warnings.length}
          </span>
        ) : null}
      </span>
      {data.metrics ? (
        <span className="graph-node__metrics" data-testid="graph-node-metrics">
          {data.metrics}
        </span>
      ) : null}
    </div>
  );
}

const NODE_TYPES = { workflow: ExplorerNode };

type Props = {
  results: ProcessedFileResult[];
  workflowExplorerView: RustWorkflowExplorerView | null;
  supportRoles: WorkflowExplorerSupportRole[];
  displayMasker: DemoDisplayMasker;
};

function artifactSizes(
  result: ProcessedFileResult | null,
): Map<string, { bytes: number; mediaType: string }> {
  const sizes = new Map<string, { bytes: number; mediaType: string }>();
  const ambiguous = new Set<string>();
  for (const output of result?.outputs ?? []) {
    const artifact = output.persistedArtifact;
    if (!artifact) continue;
    const existing = sizes.get(artifact.kind);
    if (
      existing &&
      (existing.bytes !== artifact.size || existing.mediaType !== artifact.mediaType)
    ) {
      ambiguous.add(artifact.kind);
    } else {
      sizes.set(artifact.kind, { bytes: artifact.size, mediaType: artifact.mediaType });
    }
  }
  for (const kind of ambiguous) sizes.delete(kind);
  return sizes;
}

function outputSize(output: ProcessedFileResult["outputs"][number]): string {
  const bytes = output.persistedArtifact?.size ?? output.blob?.size;
  return bytes === undefined ? "size unavailable" : `${bytes.toLocaleString()} bytes`;
}

export function GraphPanel({
  results,
  workflowExplorerView,
  supportRoles,
  displayMasker,
}: Props): ReactElement {
  const [mode, setMode] = useState<ExplorerMode>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(new Set());
  const [auditSearch, setAuditSearch] = useState("");
  const instanceRef = useRef<ReactFlowInstance<ExplorerFlowNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const reportedResults = results.filter((result) => result.workflowExplorerView);
  const activeResult =
    reportedResults.find((result) => result.inputFileName === reportFileName) ??
    reportedResults.at(-1) ??
    null;
  const view = activeResult?.workflowExplorerView ?? workflowExplorerView;
  const evidence = useMemo(
    () => ({
      executionLedger: activeResult?.executionLedger,
      artifactSizes: artifactSizes(activeResult),
      // A persisted result does not currently echo support presence. Never
      // relabel an old run using today's file-picker state.
      supportPresence: activeResult
        ? undefined
        : new Map(supportRoles.map((role) => [role.roleId, role.present])),
    }),
    [activeResult, supportRoles],
  );
  const baseProjection = useMemo(
    () => graphForMode(view, mode, evidence),
    [view, mode, evidence],
  );
  const projection = useMemo(
    () => collapseProjection(baseProjection, view, collapsedPhaseIds),
    [baseProjection, view, collapsedPhaseIds],
  );
  const metadata = useMemo(
    () => new Map(projection.nodes.map((node) => [node.id, node])),
    [projection.nodes],
  );
  const layout = useMemo(
    () => layoutGraph(projection.graph, direction),
    [projection.graph, direction],
  );
  const joins = useMemo(() => new Set(joinPoints(projection.graph)), [projection.graph]);
  const downstream = useMemo(
    () => (selected ? new Set(affectedBy(projection.graph, selected)) : null),
    [projection.graph, selected],
  );
  const auditMatches = useMemo(() => {
    const needle = auditSearch.trim().toLocaleLowerCase();
    if (mode !== "audit" || !needle) return [];
    return projection.nodes.filter((node) =>
      [
        node.id,
        node.label,
        node.description,
        node.eyebrow,
        node.detail,
        node.offReason,
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [auditSearch, mode, projection.nodes]);
  const auditMatchIds = useMemo(
    () => new Set(auditMatches.map((node) => node.id)),
    [auditMatches],
  );

  useEffect(() => {
    if (selected && !metadata.has(selected)) setSelected(null);
  }, [metadata, selected]);

  const bounds = useMemo(() => {
    if (layout.nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
    const minX = Math.min(...layout.nodes.map((node) => node.x));
    const minY = Math.min(...layout.nodes.map((node) => node.y));
    const maxX = Math.max(...layout.nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...layout.nodes.map((node) => node.y + NODE_HEIGHT));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [layout.nodes]);

  const applyAnchoredFit = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const canvas = canvasRef.current;
    const aspect =
      canvas && canvas.clientWidth > 0 ? canvas.clientHeight / canvas.clientWidth : 0.6;
    const viewport =
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
    void instance.fitBounds(viewport, { padding: 0.06 });
  }, [bounds, direction]);

  useEffect(() => applyAnchoredFit(), [applyAnchoredFit]);

  const focusNode = useCallback((id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      const instance = instanceRef.current;
      const node = instance?.getNode(id);
      if (instance && node) void instance.fitView({ nodes: [node], padding: 0.5 });
    });
  }, []);

  const nodes: ExplorerFlowNode[] = layout.nodes.map((node) => {
    const data = metadata.get(node.id)!;
    const selectionDimmed = selected && node.id !== selected && !downstream?.has(node.id);
    const searchDimmed =
      mode === "audit" && auditSearch.trim() && !auditMatchIds.has(node.id);
    return {
      id: node.id,
      type: "workflow",
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      targetPosition: direction === "TB" ? Position.Top : Position.Left,
      sourcePosition: direction === "TB" ? Position.Bottom : Position.Right,
      className: [
        "graph-flow-node",
        data.off ? "is-off" : "",
        node.id === selected ? "is-selected" : "",
        selectionDimmed || searchDimmed ? "is-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        label: data.label,
        section: data.section,
        status: data.status,
        isJoin: joins.has(node.id),
        isOff: data.off,
        description: data.description ?? null,
        eyebrow: data.eyebrow,
        metrics: data.metrics,
        warnings: data.warnings,
        supportPresence: data.supportPresence,
      },
      draggable: false,
      connectable: false,
    };
  });

  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    className: [
      "graph-flow-edge",
      selected && !(edge.source === selected || downstream?.has(edge.source))
        ? "is-dimmed"
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    markerEnd: EDGE_MARKER,
  }));

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    setSelected((current) => (current === node.id ? null : node.id));
  };
  const selectedNode = selected ? metadata.get(selected) : null;
  const availablePhases = useMemo(() => {
    const projected = new Set(baseProjection.nodes.flatMap((node) => node.phaseId ?? []));
    return [...(view?.phases ?? [])]
      .filter((phase) => projected.has(phase.phaseId))
      .sort((left, right) => left.displayOrder - right.displayOrder);
  }, [baseProjection.nodes, view?.phases]);
  const allPhasesCollapsed =
    availablePhases.length > 0 &&
    availablePhases.every((phase) => collapsedPhaseIds.has(phase.phaseId));

  return (
    <section className="workflow-section" aria-labelledby="graph-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="graph-title" className="workflow-section__title">Pipeline Explorer</h2>
          <p className="workflow-section__intro">
            Explore the workflow at five distinct interpretation layers. Off and unobserved items
            stay visible, and observed run evidence is never inferred from configuration alone.
          </p>
        </div>
        <div className="graph-toolbar">
          <div className="graph-direction-toggle" role="group" aria-label="Explorer view">
            {(Object.keys(MODE_LABELS) as ExplorerMode[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`btn btn--ghost${mode === candidate ? " is-active" : ""}`}
                data-testid={`graph-mode-${candidate}`}
                aria-pressed={mode === candidate}
                onClick={() => {
                  setMode(candidate);
                  setSelected(null);
                }}
              >
                {MODE_LABELS[candidate]}
              </button>
            ))}
          </div>
          <div className="graph-direction-toggle" role="group" aria-label="Graph orientation">
            {(["LR", "TB"] as LayoutDirection[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`btn btn--ghost${direction === candidate ? " is-active" : ""}`}
                data-testid={`graph-direction-${candidate.toLocaleLowerCase()}`}
                aria-pressed={direction === candidate}
                onClick={() => setDirection(candidate)}
              >
                {candidate === "LR" ? "Horizontal" : "Vertical"}
              </button>
            ))}
          </div>
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
            Run evidence from
            <select
              className="input"
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

      <p className="graph-mode-description" data-testid="graph-mode-description">
        {MODE_DESCRIPTIONS[mode]}
      </p>

      {mode !== "overview" && availablePhases.length > 0 ? (
        <div className="graph-phase-controls" data-testid="graph-phase-controls">
          <span>Phase detail</span>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="graph-collapse-all-phases"
            onClick={() =>
              setCollapsedPhaseIds(
                allPhasesCollapsed
                  ? new Set()
                  : new Set(availablePhases.map((phase) => phase.phaseId)),
              )
            }
          >
            {allPhasesCollapsed ? "Expand all" : "Collapse all"}
          </button>
          {availablePhases.map((phase) => {
            const collapsed = collapsedPhaseIds.has(phase.phaseId);
            return (
              <button
                key={phase.phaseId}
                type="button"
                className={`graph-phase-chip${collapsed ? " is-active" : ""}`}
                data-testid={`graph-phase-toggle-${phase.phaseId}`}
                aria-pressed={collapsed}
                onClick={() =>
                  setCollapsedPhaseIds((current) => {
                    const next = new Set(current);
                    if (next.has(phase.phaseId)) next.delete(phase.phaseId);
                    else next.add(phase.phaseId);
                    return next;
                  })
                }
              >
                {collapsed ? `Expand ${phase.label}` : `Collapse ${phase.label}`}
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === "audit" ? (
        <div className="graph-audit-tools">
          <label>
            Search and focus audit operations
            <input
              className="input"
              type="search"
              value={auditSearch}
              data-testid="graph-audit-search"
              onChange={(event) => setAuditSearch(event.target.value)}
              placeholder="Name, role, effect, or reason"
            />
          </label>
          {auditSearch.trim() ? (
            <div className="graph-audit-results" data-testid="graph-audit-results">
              {auditMatches.length > 0 ? (
                auditMatches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => focusNode(node.id)}
                  >
                    Focus {node.label}
                  </button>
                ))
              ) : (
                <span>No audit operations match.</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="graph-sentence" role="status" aria-live="polite" data-testid="graph-sentence">
        {selectedNode ? (
          <>
            <strong>{selectedNode.label}</strong>
            {selectedNode.description ? ` — ${selectedNode.description}` : ""}
            {selectedNode.detail ? ` ${selectedNode.detail}.` : ""}
            {selectedNode.offReason ? ` Off reason: ${selectedNode.offReason}.` : ""}
            {downstream && downstream.size > 0
              ? ` It reaches ${downstream.size} downstream item${downstream.size === 1 ? "" : "s"} in this view.`
              : ""}
          </>
        ) : (
          <>Select an item to trace everything downstream from it.</>
        )}
      </div>

      {selectedNode?.impact ? (
        <dl className="graph-impact-details" data-testid="graph-impact-details">
          <div><dt>Direct physical readers</dt><dd>{selectedNode.impact.directQueries}</dd></div>
          <div><dt>Operations that may change</dt><dd>{selectedNode.impact.affectedOperations}</dd></div>
          <div><dt>Artifacts that may change</dt><dd>{selectedNode.impact.affectedArtifacts}</dd></div>
        </dl>
      ) : null}

      <div className="graph-canvas" data-testid="graph-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelected(null)}
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
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>

      <div className="graph-legend" aria-label="Node categories">
        {(Object.keys(SECTION_LABELS) as Section[]).map((section) => (
          <span key={section} className={`graph-legend__item graph-legend__item--${section}`}>
            {SECTION_LABELS[section]}
          </span>
        ))}
      </div>

      <section className="graph-deliverables" data-testid="graph-deliverables">
        <h3>Deliverables</h3>
        {!activeResult ? (
          <p>Not observed — process a file to see the outputs actually emitted by a run.</p>
        ) : activeResult.outputs.length === 0 ? (
          <p>No deliverables were emitted by this run.</p>
        ) : (
          <ul>
            {activeResult.outputs.map((output) => (
              <li key={`${output.kind}:${output.outputFileName}`}>
                <strong>{displayMasker.fileName(output.outputFileName)}</strong>{" "}
                <span>
                  {output.kind.replaceAll("_", " ")} · {output.rowCount.toLocaleString()} rows ·{" "}
                  {outputSize(output)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
