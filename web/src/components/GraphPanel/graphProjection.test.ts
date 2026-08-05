import { describe, expect, it } from "vitest";

import {
  collapseProjection,
  graphForMode,
} from "@/components/GraphPanel/graphProjection";
import type { RustExecutionLedger } from "@/lib/rustExecutionRecords";
import type { RustWorkflowExplorerView } from "@/lib/types";

const view: RustWorkflowExplorerView = {
  protocolVersion: "chronicle-workflow-explorer/v1",
  viewId: "chronicle-workflow-explorer/v1",
  schemaId: "urn:chronicle:view:workflow-explorer:v1",
  revision: 0,
  rootDigest: "sha256:test",
  selectedRunRoot: null,
  contractDigests: {
    semantic: "sha256:semantic",
    presentation: "sha256:presentation",
    execution: "sha256:execution",
    checkpointPolicy: "sha256:checkpoint",
    evidence: "sha256:evidence",
    workspaceCompatibility: "sha256:compatibility",
  },
  phases: [
    {
      phaseId: "phase_a",
      label: "Prepare evidence",
      description: "Prepare typed evidence.",
      displayOrder: 10,
      inputPhaseIds: [],
      applicable: true,
    },
    {
      phaseId: "phase_b",
      label: "Apply rule",
      description: "Apply a configured rule.",
      displayOrder: 20,
      inputPhaseIds: ["phase_a"],
      applicable: false,
    },
  ],
  operations: [
    {
      operationId: "operation.prepare",
      label: "Prepare rows",
      description: "Prepare source rows.",
      phaseId: "phase_a",
      role: "normalize",
      epistemicRole: "observed",
      inputArtifactIds: ["source.raw"],
      outputArtifactIds: ["artifact.prepared"],
      dataEffects: ["preserves"],
      applicable: true,
      runState: "not_observed",
      offReason: null,
    },
    {
      operationId: "operation.rule",
      label: "Apply exclusion rule",
      description: "Remove rows selected by policy.",
      phaseId: "phase_b",
      role: "policy_apply",
      epistemicRole: "policy_applied",
      inputArtifactIds: ["artifact.prepared", "source.filter_file"],
      outputArtifactIds: ["artifact.result"],
      dataEffects: ["drops_rows", "rewrites_values"],
      applicable: false,
      runState: "not_applicable",
      offReason: "off because its applicability rule is false",
    },
  ],
  artifacts: [
    {
      artifactId: "source.raw",
      label: "Raw source",
      kind: "source",
      producerOperationId: null,
      consumerOperationIds: ["operation.prepare"],
      runState: "not_observed",
    },
    {
      artifactId: "source.filter_file",
      label: "Filter support",
      kind: "source",
      producerOperationId: null,
      consumerOperationIds: ["operation.rule"],
      runState: "not_observed",
    },
    {
      artifactId: "artifact.prepared",
      label: "Prepared rows",
      kind: "records",
      producerOperationId: "operation.prepare",
      consumerOperationIds: ["operation.rule"],
      runState: "not_observed",
    },
    {
      artifactId: "artifact.result",
      label: "Result table",
      kind: "table",
      producerOperationId: "operation.rule",
      consumerOperationIds: [],
      runState: "absent",
    },
  ],
  queries: [
    {
      queryId: "query_prepare",
      queryGroupId: "prepare",
      inputQueryIds: [],
      operationIds: ["operation.prepare"],
      outputArtifactIds: ["artifact.prepared"],
      applicability: "applicable",
      physicalState: "executed",
      reuseReason: null,
      checkpointSource: null,
    },
    {
      queryId: "query_rule",
      queryGroupId: "rule",
      inputQueryIds: ["query_prepare"],
      operationIds: ["operation.rule"],
      outputArtifactIds: ["artifact.result"],
      applicability: "not_applicable",
      physicalState: "omitted",
      reuseReason: "not_applicable",
      checkpointSource: null,
    },
  ],
  decisions: [
    {
      inputId: "remove_selected_rows",
      inputKind: "option",
      directQueryIds: ["query_rule"],
      affectedOperationIds: ["operation.rule"],
      affectedArtifactIds: ["artifact.result"],
    },
    {
      inputId: "filter_file",
      inputKind: "support",
      directQueryIds: ["query_rule"],
      affectedOperationIds: ["operation.rule"],
      affectedArtifactIds: ["artifact.result"],
    },
  ],
};

const ledger: RustExecutionLedger = [
  {
    queryGroupId: "prepare",
    status: "recomputed",
    rowsIn: 8,
    rowsOut: 7,
    expectations: [],
    timing: { startedAt: "start", endedAt: "end", durationMs: 2.4 },
    queries: [
      {
        queryId: "query_prepare",
        queryGroupId: "prepare",
        status: "recomputed",
        inputKey: null,
        outputDigest: "sha256:output",
        reasonId: null,
        applicable: true,
        rowsIn: 8,
        rowsOut: 7,
        droppedRows: 1,
        expectations: [],
        timing: { startedAt: "start", endedAt: "end", durationMs: 2.4 },
      },
    ],
  },
];

describe("Workflow Explorer projections", () => {
  it("keeps decision impact categories and support availability distinct", () => {
    const projection = graphForMode(view, "decisions", {
      supportPresence: new Map([["filter_file", false]]),
    });
    const support = projection.nodes.find((node) => node.id.endsWith(":filter_file"));
    expect(support?.supportPresence).toBe("unavailable");
    expect(support?.impact).toEqual({
      directQueries: 1,
      affectedOperations: 1,
      affectedArtifacts: 1,
    });
    expect(projection.nodes.find((node) => node.id === "physical:query_rule")?.eyebrow)
      .toBe("direct physical reader");
    expect(projection.nodes.find((node) => node.id === "operation.rule")?.eyebrow)
      .toContain("row-set impact");
    expect(projection.nodes.find((node) => node.id === "artifact.result")?.eyebrow)
      .toBe("may-change artifact");
  });

  it("shows observed query timing and rows and labels absent evidence honestly", () => {
    const observed = graphForMode(view, "execution", { executionLedger: ledger });
    expect(observed.nodes.find((node) => node.id === "query_prepare")?.metrics)
      .toBe("8 → 7 rows · 2 ms");
    expect(observed.nodes.find((node) => node.id === "query_rule")?.metrics)
      .toContain("timing unavailable");
  });

  it("preserves off reasons and does not call terminal evidence a deliverable", () => {
    const audit = graphForMode(view, "audit");
    expect(audit.nodes.find((node) => node.id === "operation.rule")?.offReason)
      .toBe("off because its applicability rule is false");
    const lineage = graphForMode(view, "lineage");
    expect(lineage.nodes.find((node) => node.id === "artifact.result")?.detail)
      .toContain("does not classify it as a user deliverable");
  });

  it("collapses phase members and rewires only their declared external edges", () => {
    const audit = graphForMode(view, "audit");
    const collapsed = collapseProjection(audit, view, new Set(["phase_a"]));
    expect(collapsed.nodes.some((node) => node.id === "operation.prepare")).toBe(false);
    expect(collapsed.nodes.find((node) => node.id === "collapsed-phase:phase_a")?.detail)
      .toContain("1 visible item");
    expect(collapsed.nodes.find((node) => node.id === "operation.rule")?.inputs)
      .toEqual(["collapsed-phase:phase_a"]);
  });
});
