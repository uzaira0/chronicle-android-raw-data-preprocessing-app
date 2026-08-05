import type { NodeStatus, ViewGraph } from "@/components/GraphPanel/viewGraph";
import type { RustExecutionLedger } from "@/lib/rustExecutionRecords";
import type { RustWorkflowExplorerView } from "@/lib/types";

export type ExplorerMode =
  | "overview"
  | "decisions"
  | "lineage"
  | "execution"
  | "audit";

export type SupportPresence = "available" | "unavailable" | "not_observed";

export type ExplorerGraphNode = ViewGraph["nodes"][number] & {
  status: NodeStatus | null;
  off: boolean;
  eyebrow: string;
  detail: string | null;
  metrics: string | null;
  warnings: string[];
  phaseId: string | null;
  offReason: string | null;
  supportPresence: SupportPresence | null;
  impact: {
    directQueries: number;
    affectedOperations: number;
    affectedArtifacts: number;
  } | null;
};

export type ExplorerProjection = {
  graph: ViewGraph;
  nodes: ExplorerGraphNode[];
};

type QueryExecutionRecord = RustExecutionLedger[number]["queries"][number];

export type ProjectionEvidence = {
  executionLedger?: RustExecutionLedger;
  supportPresence?: ReadonlyMap<string, boolean>;
  artifactSizes?: ReadonlyMap<string, { bytes: number; mediaType: string }>;
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function operationStatus(
  state: RustWorkflowExplorerView["operations"][number]["runState"],
): NodeStatus {
  if (state === "applied") return "recomputed";
  if (state === "bypassed" || state === "not_applicable") return "bypassed";
  if (state === "error") return "error";
  return "not_observed";
}

function queryStatus(
  state: RustWorkflowExplorerView["queries"][number]["physicalState"],
): NodeStatus {
  if (state === "executed") return "recomputed";
  if (state === "memoized" || state === "restored") return "cached";
  if (state === "omitted") return "bypassed";
  if (state === "error") return "error";
  return "not_observed";
}

function artifactStatus(
  state: RustWorkflowExplorerView["artifacts"][number]["runState"],
): NodeStatus {
  if (state === "materialized") return "recomputed";
  if (state === "absent") return "bypassed";
  if (state === "error") return "error";
  return "not_observed";
}

function effectCategories(effects: readonly string[]): string[] {
  const categories = new Set<string>();
  for (const effect of effects) {
    if (["drops_rows", "splits_rows", "synthesizes_rows"].includes(effect)) {
      categories.add("row-set impact");
    } else if (["rewrites_values", "classifies"].includes(effect)) {
      categories.add("value impact");
    } else if (effect === "aggregates") {
      categories.add("summary impact");
    } else if (effect === "encodes") {
      categories.add("format impact");
    } else if (effect === "preserves") {
      categories.add("preserving");
    } else {
      categories.add(humanize(effect));
    }
  }
  return [...categories];
}

function operationDetail(
  operation: RustWorkflowExplorerView["operations"][number],
): string {
  const categories = effectCategories(operation.dataEffects);
  return [
    `Evidence role: ${humanize(operation.epistemicRole)}`,
    `Impact: ${categories.join(", ") || "not classified"}`,
    operation.offReason ? `Off reason: ${operation.offReason}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function queryRecords(
  ledger: RustExecutionLedger | undefined,
): Map<string, QueryExecutionRecord> {
  return new Map(
    (ledger ?? []).flatMap((group) =>
      group.queries.map((query) => [query.queryId, query] as const),
    ),
  );
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return "timing unavailable";
  if (durationMs < 1) return "<1 ms";
  return `${Math.round(durationMs)} ms`;
}

function queryMetrics(record: QueryExecutionRecord | undefined): string {
  if (!record) return "not observed · row counts unavailable · timing unavailable";
  const rows =
    record.rowsIn === null && record.rowsOut === null
      ? "row counts unavailable"
      : `${record.rowsIn ?? "?"} → ${record.rowsOut ?? "?"} rows`;
  return `${rows} · ${formatDuration(record.timing.durationMs)}`;
}

function artifactMetrics(
  kind: string,
  sizes: ProjectionEvidence["artifactSizes"],
): string {
  const evidence = sizes?.get(kind);
  if (!evidence) return "size unavailable";
  return `${evidence.bytes.toLocaleString()} bytes · ${evidence.mediaType}`;
}

function makeProjection(nodes: ExplorerGraphNode[]): ExplorerProjection {
  return {
    graph: {
      nodes: nodes.map(({ id, label, description, section, inputs }) => ({
        id,
        label,
        description,
        section,
        inputs,
      })),
    },
    nodes,
  };
}

/** Project Rust's distinct interpretation layers without inventing workflow boundaries. */
export function graphForMode(
  view: RustWorkflowExplorerView | null,
  mode: ExplorerMode,
  evidence: ProjectionEvidence = {},
): ExplorerProjection {
  if (!view) return makeProjection([]);
  const operationById = new Map(
    view.operations.map((operation) => [operation.operationId, operation]),
  );
  const artifactById = new Map(
    view.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const queryById = new Map(view.queries.map((query) => [query.queryId, query]));
  const recordByQueryId = queryRecords(evidence.executionLedger);

  if (mode === "overview") {
    return makeProjection(
      [...view.phases]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((phase) => ({
          id: phase.phaseId,
          label: phase.label,
          description: phase.description,
          section: "phase" as const,
          inputs: phase.inputPhaseIds,
          status: "not_observed" as const,
          off: !phase.applicable,
          eyebrow: "research workflow phase",
          detail: phase.applicable
            ? "Included by the current settings; phase-level execution is not observed"
            : "No operation in this phase is active",
          metrics: null,
          warnings: [],
          phaseId: phase.phaseId,
          offReason: phase.applicable ? null : "No operation in this phase is active",
          supportPresence: null,
          impact: null,
        })),
    );
  }

  if (mode === "decisions") {
    const decisionId = (kind: string, id: string): string => `decision:${kind}:${id}`;
    const directQuerySources = new Map<string, string[]>();
    for (const decision of view.decisions) {
      for (const queryId of decision.directQueryIds) {
        const sources = directQuerySources.get(queryId) ?? [];
        sources.push(decisionId(decision.inputKind, decision.inputId));
        directQuerySources.set(queryId, sources);
      }
    }
    const decisionNodes: ExplorerGraphNode[] = view.decisions.map((decision) => {
      const observed =
        decision.inputKind === "support"
          ? evidence.supportPresence?.get(decision.inputId)
          : undefined;
      const supportPresence: SupportPresence | null =
        decision.inputKind !== "support"
          ? null
          : observed === undefined
            ? "not_observed"
            : observed
              ? "available"
              : "unavailable";
      return {
        id: decisionId(decision.inputKind, decision.inputId),
        label: humanize(decision.inputId),
        description:
          decision.inputKind === "support"
            ? "A support-file role considered by the Rust workflow projection."
            : "A processing setting considered by the Rust workflow projection.",
        section: "decision",
        inputs: [],
        status: null,
        off: false,
        eyebrow: decision.inputKind === "support" ? "support input" : "setting",
        detail: [
          `${plural(decision.directQueryIds.length, "direct physical reader")}`,
          `${plural(decision.affectedOperationIds.length, "operation")} may change`,
          `${plural(decision.affectedArtifactIds.length, "artifact")} may change`,
          supportPresence ? `Support availability: ${humanize(supportPresence)}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(" · "),
        metrics: null,
        warnings: [],
        phaseId: null,
        offReason: null,
        supportPresence,
        impact: {
          directQueries: decision.directQueryIds.length,
          affectedOperations: decision.affectedOperationIds.length,
          affectedArtifacts: decision.affectedArtifactIds.length,
        },
      };
    });
    const directQueryNodes: ExplorerGraphNode[] = [...directQuerySources].map(
      ([queryId, inputs]) => {
        const query = queryById.get(queryId);
        const operation = query?.operationIds
          .map((operationId) => operationById.get(operationId))
          .find((candidate) => candidate !== undefined);
        return {
          id: `physical:${queryId}`,
          label: operation?.label ?? humanize(queryId),
          description: `Physical query ${queryId}.`,
          section: "execution",
          inputs,
          status: query ? queryStatus(query.physicalState) : "not_observed",
          off: query?.applicability === "not_applicable",
          eyebrow: "direct physical reader",
          detail: query ? `Execution group: ${humanize(query.queryGroupId)}` : "Query detail unavailable",
          metrics: queryMetrics(recordByQueryId.get(queryId)),
          warnings: recordByQueryId
            .get(queryId)
            ?.expectations.filter((expectation) => !expectation.ok)
            .map((expectation) => expectation.message) ?? [],
          phaseId: operation?.phaseId ?? null,
          offReason:
            query?.applicability === "not_applicable" ? "Its applicability rule is false" : null,
          supportPresence: null,
          impact: null,
        };
      },
    );
    const affectedIds = new Set(
      view.decisions.flatMap((decision) => decision.affectedOperationIds),
    );
    const affectedInputs = new Map<string, Set<string>>();
    for (const operation of view.operations) {
      if (!affectedIds.has(operation.operationId)) continue;
      const upstream = operation.inputArtifactIds
        .map((artifactId) => artifactById.get(artifactId)?.producerOperationId)
        .filter(
          (producer): producer is string =>
            producer !== null && producer !== undefined && affectedIds.has(producer),
        );
      affectedInputs.set(operation.operationId, new Set(upstream));
    }
    // Attach each decision only to the first affected operations visible in
    // its semantic closure. "First visible" is intentionally weaker than
    // claiming a direct semantic dependency, which this projection does not expose.
    for (const decision of view.decisions) {
      const closure = new Set(decision.affectedOperationIds);
      for (const operationId of closure) {
        const inputs = affectedInputs.get(operationId);
        if (!inputs) continue;
        const hasAffectedPredecessor = [...inputs].some((input) => closure.has(input));
        if (!hasAffectedPredecessor) {
          inputs.add(decisionId(decision.inputKind, decision.inputId));
        }
      }
    }
    const affectedOperations: ExplorerGraphNode[] = view.operations
      .filter((operation) => affectedIds.has(operation.operationId))
      .map((operation) => ({
        id: operation.operationId,
        label: operation.label,
        description: operation.description,
        section: "operation",
        inputs: [...(affectedInputs.get(operation.operationId) ?? [])],
        status: operationStatus(operation.runState),
        off: !operation.applicable,
        eyebrow: `${effectCategories(operation.dataEffects).join(" + ") || "unclassified"} operation`,
        detail: operationDetail(operation),
        metrics: null,
        warnings: [],
        phaseId: operation.phaseId,
        offReason: operation.offReason,
        supportPresence: null,
        impact: null,
      }));
    const affectedArtifactIds = new Set(
      view.decisions.flatMap((decision) => decision.affectedArtifactIds),
    );
    const affectedArtifacts: ExplorerGraphNode[] = view.artifacts
      .filter((artifact) => affectedArtifactIds.has(artifact.artifactId))
      .map((artifact) => ({
        id: artifact.artifactId,
        label: artifact.label,
        description: `${humanize(artifact.kind)} artifact`,
        section: "artifact",
        inputs: artifact.producerOperationId ? [artifact.producerOperationId] : [],
        status: artifactStatus(artifact.runState),
        off: artifact.runState === "absent",
        eyebrow: "may-change artifact",
        detail: "This artifact is in at least one selected decision's semantic impact closure",
        metrics: artifactMetrics(artifact.kind, evidence.artifactSizes),
        warnings: [],
        phaseId: artifact.producerOperationId
          ? (operationById.get(artifact.producerOperationId)?.phaseId ?? null)
          : null,
        offReason: artifact.runState === "absent" ? "Its producer is not active" : null,
        supportPresence: null,
        impact: null,
      }));
    return makeProjection([
      ...decisionNodes,
      ...directQueryNodes,
      ...affectedOperations,
      ...affectedArtifacts,
    ]);
  }

  if (mode === "execution") {
    return makeProjection(
      view.queries.map((query) => {
        const operation = query.operationIds
          .map((id) => operationById.get(id))
          .find((candidate) => candidate !== undefined);
        const record = recordByQueryId.get(query.queryId);
        const reuse = query.reuseReason
          ? humanize(query.reuseReason)
          : query.physicalState === "executed"
            ? "recomputed"
            : query.physicalState === "not_observed"
              ? "not observed"
              : "unavailable";
        return {
          id: query.queryId,
          label: operation?.label ?? humanize(query.queryId),
          description: `Physical query in ${humanize(query.queryGroupId)}.`,
          section: "execution" as const,
          inputs: query.inputQueryIds,
          status: queryStatus(query.physicalState),
          off: query.applicability === "not_applicable",
          eyebrow: "physical query",
          detail: [
            `Reuse: ${reuse}`,
            query.checkpointSource ? `Checkpoint: ${humanize(query.checkpointSource)}` : null,
            "Output size unavailable in this projection",
          ]
            .filter((value): value is string => value !== null)
            .join(" · "),
          metrics: queryMetrics(record),
          warnings:
            record?.expectations
              .filter((expectation) => !expectation.ok)
              .map((expectation) => expectation.message) ?? [],
          phaseId: operation?.phaseId ?? null,
          offReason:
            query.applicability === "not_applicable" ? "Its applicability rule is false" : null,
          supportPresence: null,
          impact: null,
        };
      }),
    );
  }

  const operationInputs = (operationId: string): string[] => {
    const operation = operationById.get(operationId);
    if (!operation) return [];
    return operation.inputArtifactIds.flatMap((artifactId) => {
      const producer = artifactById.get(artifactId)?.producerOperationId;
      return producer ? [producer] : [];
    });
  };
  const operations: ExplorerGraphNode[] = view.operations.map((operation) => ({
    id: operation.operationId,
    label: operation.label,
    description: operation.description,
    section: "operation",
    inputs: mode === "audit" ? operationInputs(operation.operationId) : operation.inputArtifactIds,
    status: operationStatus(operation.runState),
    off: !operation.applicable,
    eyebrow:
      mode === "audit"
        ? `${effectCategories(operation.dataEffects).join(" + ") || "unclassified"} operation`
        : "semantic operation",
    detail: operationDetail(operation),
    metrics: null,
    warnings: [],
    phaseId: operation.phaseId,
    offReason: operation.offReason,
    supportPresence: null,
    impact: null,
  }));
  if (mode === "audit") return makeProjection(operations);

  const artifacts: ExplorerGraphNode[] = view.artifacts.map((artifact) => {
    const producer = artifact.producerOperationId
      ? operationById.get(artifact.producerOperationId)
      : undefined;
    return {
      id: artifact.artifactId,
      label: artifact.label,
      description: `${humanize(artifact.kind)} artifact`,
      section: artifact.producerOperationId ? "artifact" : "source",
      inputs: artifact.producerOperationId ? [artifact.producerOperationId] : [],
      status: artifactStatus(artifact.runState),
      off: artifact.runState === "absent",
      eyebrow: artifact.producerOperationId ? "typed artifact" : "source artifact",
      detail:
        artifact.consumerOperationIds.length > 0
          ? `Consumed by ${plural(artifact.consumerOperationIds.length, "operation")}`
          : "Terminal artifact; the projection does not classify it as a user deliverable",
      metrics: artifactMetrics(artifact.kind, evidence.artifactSizes),
      warnings: [],
      phaseId: producer?.phaseId ?? null,
      offReason: artifact.runState === "absent" ? "Its producer is not active" : null,
      supportPresence: null,
      impact: null,
    };
  });
  return makeProjection([...artifacts, ...operations]);
}

function combinedStatus(nodes: readonly ExplorerGraphNode[]): NodeStatus | null {
  const statuses = new Set(nodes.map((node) => node.status).filter(Boolean));
  for (const status of [
    "error",
    "recomputed",
    "cached",
    "skipped",
    "bypassed",
    "not_observed",
  ] as const) {
    if (statuses.has(status)) return status;
  }
  return null;
}

/** Collapse detailed nodes into phase proxies while preserving external DAG edges. */
export function collapseProjection(
  projection: ExplorerProjection,
  view: RustWorkflowExplorerView | null,
  collapsedPhaseIds: ReadonlySet<string>,
): ExplorerProjection {
  if (!view || collapsedPhaseIds.size === 0) return projection;
  const phaseById = new Map(view.phases.map((phase) => [phase.phaseId, phase]));
  const membersByPhase = new Map<string, ExplorerGraphNode[]>();
  for (const node of projection.nodes) {
    if (!node.phaseId || !collapsedPhaseIds.has(node.phaseId)) continue;
    const members = membersByPhase.get(node.phaseId) ?? [];
    members.push(node);
    membersByPhase.set(node.phaseId, members);
  }
  if (membersByPhase.size === 0) return projection;

  const memberToProxy = new Map<string, string>();
  for (const [phaseId, members] of membersByPhase) {
    for (const member of members) memberToProxy.set(member.id, `collapsed-phase:${phaseId}`);
  }
  const resolveInput = (input: string): string => memberToProxy.get(input) ?? input;
  const visible = projection.nodes
    .filter((node) => !memberToProxy.has(node.id))
    .map((node) => ({
      ...node,
      inputs: [...new Set(node.inputs.map(resolveInput))].filter((input) => input !== node.id),
    }));
  const proxies: ExplorerGraphNode[] = [...membersByPhase].map(([phaseId, members]) => {
    const id = `collapsed-phase:${phaseId}`;
    const phase = phaseById.get(phaseId);
    const memberIds = new Set(members.map((member) => member.id));
    const inputs = [
      ...new Set(
        members.flatMap((member) =>
          member.inputs
            .filter((input) => !memberIds.has(input))
            .map(resolveInput)
            .filter((input) => input !== id),
        ),
      ),
    ];
    return {
      id,
      label: phase?.label ?? humanize(phaseId),
      description: phase?.description,
      section: "phase",
      inputs,
      status: combinedStatus(members),
      off: members.every((member) => member.off),
      eyebrow: "collapsed phase",
      detail: `${plural(members.length, "visible item")} collapsed into this phase`,
      metrics: null,
      warnings: members.flatMap((member) => member.warnings),
      phaseId,
      offReason: members.every((member) => member.off)
        ? "Every visible item in this phase is off"
        : null,
      supportPresence: null,
      impact: null,
    };
  });
  return makeProjection([...visible, ...proxies]);
}
