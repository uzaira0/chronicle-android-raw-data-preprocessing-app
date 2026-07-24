import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  COMPUTATIONAL_BROWSER_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  EXECUTION_BROWSER_OPTION_KEYS,
  VIEW_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";
import type {
  RuntimeManifest,
  RustRuntimeExecution,
} from "@/lib/rustPipelineRuntime";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";

const mocks = vi.hoisted(() => ({
  executeRustRuntime: vi.fn(),
  buildAppTimelineViews: vi.fn(
    (_rows: unknown, _timezone: string, _options: unknown, _version: string, _events: unknown, include: boolean) =>
      [{ participantId: include ? "included" : "excluded" }],
  ),
  buildScreenTimelineViews: vi.fn(() => [{ participantId: "screen" }]),
  generateAllPlots: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["app-png"])]]))),
  generateAllPlotSvgs: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["app-svg"])]]))),
  generateAllHeatmaps: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["heat-png"])]]))),
  generateAllHeatmapSvgs: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["heat-svg"])]]))),
  generateAllScreenPlots: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["screen-png"])]]))),
  generateAllScreenPlotSvgs: vi.fn(() => Promise.resolve(new Map([["P01", new Blob(["screen-svg"])]]))),
}));

vi.mock("@/lib/rustPipelineRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rustPipelineRuntime")>()),
  executeRustRuntime: mocks.executeRustRuntime,
}));

vi.mock("@/lib/plotGenerator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plotGenerator")>()),
  buildAppTimelineViews: mocks.buildAppTimelineViews,
  buildScreenTimelineViews: mocks.buildScreenTimelineViews,
  generateAllPlots: mocks.generateAllPlots,
  generateAllPlotSvgs: mocks.generateAllPlotSvgs,
  generateAllHeatmaps: mocks.generateAllHeatmaps,
  generateAllHeatmapSvgs: mocks.generateAllHeatmapSvgs,
  generateAllScreenPlots: mocks.generateAllScreenPlots,
  generateAllScreenPlotSvgs: mocks.generateAllScreenPlotSvgs,
}));

import { processRawCsvWithRustAuthority } from "@/lib/rustPipelineAuthority";

const enc = new TextEncoder();
const json = (value: unknown) => enc.encode(JSON.stringify(value));
const csv = (body = "name,value\nexample,1\n") => enc.encode(body);

function manifest(artifacts: RuntimeManifest["artifacts"]): RuntimeManifest {
  const stageDigest = `sha256:${"b".repeat(64)}`;
  const stepIds = Array.from({ length: 55 }, (_, index) => ({
    stepId: `test-step-${index + 1}`,
    unitId: "test-unit",
  }));
  const pipelineStepDigests = Object.fromEntries(
    stepIds.map(({ stepId }) => [stepId, stageDigest]),
  );
  const pipelineStepCheckpoints = Object.fromEntries(
    stepIds.map(({ stepId }) => [
      stepId,
      {
        protocolVersion: "chronicle-logical-stage-checkpoint/v3" as const,
        nodeId: stepId,
        rowMembershipDigest: `blake3:${"1".repeat(64)}`,
        rowOrderDigest: `blake3:${"2".repeat(64)}`,
        temporalStateDigest: `blake3:${"3".repeat(64)}`,
        classificationDigest: `blake3:${"4".repeat(64)}`,
        payloadDigest: `blake3:${"5".repeat(64)}`,
        schemaDigest: `blake3:${"6".repeat(64)}`,
        terminalDigest: stageDigest,
      },
    ]),
  );
  return {
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    preprocessorVersion: "1.0.0",
    requestId: "execute-test",
    command: "ExecuteWorkspace",
    implementation: "test-runtime/0.1.0",
    scope: "selected-runtime-csv-artifacts",
    counts: { original: 4, processed: 3, app: 2, screen: 1 },
    input: {
      artifact_id: "artifact:raw",
      digest: `sha256:${"1".repeat(64)}`,
      media_type: "text/csv",
      size: 1,
      derived_from: [],
      qualifiers: {},
    },
    workspaceRootDigest: `sha256:${"2".repeat(64)}`,
    workspaceId: `sha256:${"3".repeat(64)}`,
    implementationDigest: `sha256:${"0".repeat(64)}`,
    buildEnvironmentDigest: `sha256:${"f".repeat(64)}`,
    planDigest: `sha256:${"4".repeat(64)}`,
    profileDigest: `sha256:${"5".repeat(64)}`,
    profileLockDigest: `sha256:${"6".repeat(64)}`,
    runtimeAuthorityDigest: `sha256:${"a".repeat(64)}`,
    productContractDigest: `sha256:${"7".repeat(64)}`,
    dependencyCertificateDigest: `sha256:${"e".repeat(64)}`,
    dependencyCacheDecision: {
      mode: "certified_narrow",
      certificate_digest: `sha256:${"e".repeat(64)}`,
      binding_surface_digest: `sha256:${"f".repeat(64)}`,
      empirical_evidence_current: true,
      reasons: ["dependency_surface_structurally_certified"],
    },
    qualificationTraces: [],
    requirementTraces: [],
    openObligations: [
      {
        obligation_id: "obligation:optional",
        role_id: "optional_support",
        node_id: null,
        state: "open",
        reason_id: "reason:optional",
      },
    ],
    stateReasons: [],
    journalDigest: `sha256:${"8".repeat(64)}`,
    artifacts,
    previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
    roleAssignments: [],
    nodeExecutions: [
      {
        node_id: "parse_events",
        capability_id: "chronicle.parse_events",
        status: "recomputed",
        input_key: `sha256:${"1".repeat(64)}`,
        output: null,
        reason_id: "changed-input",
      },
      {
        node_id: "outputs",
        capability_id: "chronicle.outputs",
        status: "cached",
        input_key: `sha256:${"2".repeat(64)}`,
        output: null,
        reason_id: "same-input",
      },
    ],
    stepExecutions: stepIds.map(({ stepId, unitId }) => ({
      step_id: stepId,
      unit_id: unitId,
      status: "recomputed",
      input_key: `sha256:${"1".repeat(64)}`,
      output_digest: stageDigest,
      reason_id: `sha256:${"2".repeat(64)}`,
    })),
    processingSummary: {
      availableTimezones: ["America/Chicago"],
      timezone: "America/Chicago",
      timezoneAction: "filtered_to_selected",
      rowsBeforeTimezoneHandling: 4,
      rowsAfterTimezoneHandling: 3,
      rowsRemovedByTimezone: 1,
      timezoneRetainedSourceRowsDigest: `sha256:${"a".repeat(64)}`,
      timezoneStageDigest: stageDigest,
      logicalStageDigests: { parse_events: stageDigest },
      logicalStageCheckpoints: {
        parse_events: {
          protocolVersion: "chronicle-logical-stage-checkpoint/v3",
          nodeId: "parse_events",
          rowMembershipDigest: `blake3:${"1".repeat(64)}`,
          rowOrderDigest: `blake3:${"2".repeat(64)}`,
          temporalStateDigest: `blake3:${"3".repeat(64)}`,
          classificationDigest: `blake3:${"4".repeat(64)}`,
          payloadDigest: `blake3:${"5".repeat(64)}`,
          schemaDigest: `blake3:${"6".repeat(64)}`,
          terminalDigest: stageDigest,
        },
      },
      pipelineStepDigests,
      pipelineStepCheckpoints,
      publishedOutputsDigest: `sha256:${"c".repeat(64)}`,
      provenanceDigest: `sha256:${"d".repeat(64)}`,
      duplicateTimestampsCorrected: 2,
      exactDuplicateRowsRemoved: 1,
    },
  };
}

function fullExecution(): RustRuntimeExecution {
  const artifacts = new Map<string, Uint8Array>();
  for (const kind of [
    "app-csv",
    "screen-csv",
    "credited-app-csv",
    "compliance-csv",
    "day-coverage-csv",
    "aggregate-daily-summary-csv",
    "aggregate-weekly-summary-csv",
    "aggregate-top-apps-csv",
    "aggregate-category-time-budget-csv",
    "aggregate-app-co-usage-csv",
  ]) {
    artifacts.set(kind, csv());
  }
  for (const kind of [
    "app-parquet",
    "screen-parquet",
    "app-spss",
    "screen-spss",
    "row-lineage-arrow",
    "source-coordinate-index-arrow",
    "result-cell-correspondence-arrow",
  ]) {
    artifacts.set(kind, enc.encode(kind));
  }
  artifacts.set(
    "visualization-data-json",
    json({
      appRows: [
        {
          participantId: "P01",
          date: "2026-03-07",
          startTimestampNs: "1",
          stopTimestampNs: "2",
          eventTimestampNs: "1",
          interactionType: "App Usage",
          broadAppCategory: "Social",
          appPackageName: "com.example",
          applicationLabel: "Example",
          username: "Target Child",
          screenUsageEndReason: null,
        },
        {
          participantId: "P01",
          date: "2026-03-07",
          startTimestampNs: null,
          stopTimestampNs: null,
          eventTimestampNs: "3",
          interactionType: "End of Usage Missing",
          broadAppCategory: null,
          appPackageName: "com.example",
          applicationLabel: "Example",
          username: "Target Child",
          screenUsageEndReason: null,
        },
      ],
      screenRows: [],
      eventTimestampsByParticipant: { P01: ["1", "2"] },
    }),
  );
  artifacts.set("review-summary-json", json({ participants: [] }));
  artifacts.set("execution-ledger-json", json([]));
  artifacts.set("evidence-journal", enc.encode("journal"));
  artifacts.set("artifact-closure-json", json({ artifacts: [] }));
  artifacts.set("dependency-certificate-json", json({ status: "verified" }));
  artifacts.set("correspondence-index-json", json({ correspondences: [] }));
  artifacts.set("semantic-index-source-json", json({ records: [] }));
  artifacts.set(
    "stage-view-json",
    json({
      protocol_version: "0.1",
      view_id: "chronicle.stage.v1",
      family: "incremental-dataflow",
      schema_id: "urn:chronicle:view:stage:v1",
      revision: 1,
      root_digest: `sha256:${"2".repeat(64)}`,
      payload: { stage: null, node_states: [], step_states: [] },
    }),
  );
  const metadata = [...artifacts].map(([kind, bytes]) => ({
    artifactId: `artifact:${kind}`,
    kind,
    mediaType: "application/octet-stream",
    digest: `sha256:${"a".repeat(64)}`,
    size: bytes.byteLength,
    derivedFrom: [],
    rowCount:
      kind.endsWith("-csv") ||
      kind === "row-lineage-arrow" ||
      kind === "source-coordinate-index-arrow" ||
      kind === "result-cell-correspondence-arrow"
        ? 7
        : undefined,
    previewRows: kind.endsWith("-csv")
      ? [["name", "value"], ["example", "1"]]
      : undefined,
  }));
  return {
    workspaceId: `sha256:${"3".repeat(64)}`,
    manifest: manifest(metadata),
    manifestJson: JSON.stringify(manifest(metadata)),
    artifacts,
    persistedWorkspace: {
      protocolVersion: "chronicle-opfs-root/v1",
      generation: 11,
      workspaceRootDigest: `sha256:${"2".repeat(64)}`,
      previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
      artifactDigests: [],
      checksum: `sha256:${"b".repeat(64)}`,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRustRuntime.mockResolvedValue(fullExecution());
});

describe("configuration-axis authority", () => {
  it("partitions every browser option exactly once and pins the factored axes", () => {
    expect(ANNOTATION_BROWSER_OPTION_KEYS).toEqual(["studyName"]);
    expect(VIEW_BROWSER_OPTION_KEYS).toEqual([
      "enablePlotting",
      "includeFilteredAppUsageInPlots",
      "enableActivityHeatmap",
      "exportPlotsAsSvg",
      "enableInteractiveTimeline",
    ]);
    expect(EXECUTION_BROWSER_OPTION_KEYS).toEqual([
      "parallelProcessing",
      "parallelMaxWorkers",
    ]);
    expect(COMPUTATIONAL_BROWSER_OPTION_KEYS).toHaveLength(46);

    const partition = [
      ...COMPUTATIONAL_BROWSER_OPTION_KEYS,
      ...ANNOTATION_BROWSER_OPTION_KEYS,
      ...VIEW_BROWSER_OPTION_KEYS,
      ...EXECUTION_BROWSER_OPTION_KEYS,
    ];
    expect(new Set(partition).size).toBe(BROWSER_PROCESSING_OPTION_KEYS.length);
    expect([...partition].sort()).toEqual([...BROWSER_PROCESSING_OPTION_KEYS].sort());
  });

  it("keeps view/execution axes out of Rust while projecting studyName only as annotation", () => {
    const runtimeOptions = { datetimeOfPreprocessing: "2026-07-21 00:00:00 UTC" };
    const baselineOptions: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      selectedTimezone: "UTC",
    };
    const baseline = buildRustV2Options(baselineOptions, runtimeOptions);
    const factoredAlternates: Partial<BrowserProcessingOptions> = {
      enablePlotting: !DEFAULT_BROWSER_OPTIONS.enablePlotting,
      includeFilteredAppUsageInPlots:
        !DEFAULT_BROWSER_OPTIONS.includeFilteredAppUsageInPlots,
      enableActivityHeatmap: !DEFAULT_BROWSER_OPTIONS.enableActivityHeatmap,
      exportPlotsAsSvg: !DEFAULT_BROWSER_OPTIONS.exportPlotsAsSvg,
      enableInteractiveTimeline: !DEFAULT_BROWSER_OPTIONS.enableInteractiveTimeline,
      parallelProcessing: !DEFAULT_BROWSER_OPTIONS.parallelProcessing,
      parallelMaxWorkers: 2,
    };
    for (const key of [
      ...VIEW_BROWSER_OPTION_KEYS,
      ...EXECUTION_BROWSER_OPTION_KEYS,
    ]) {
      expect(
        buildRustV2Options(
          {
            ...baselineOptions,
            [key]: factoredAlternates[key as keyof BrowserProcessingOptions],
          },
          runtimeOptions,
        ),
        key,
      ).toEqual(baseline);
    }

    const annotated = buildRustV2Options(
      { ...baselineOptions, studyName: "Named study" },
      runtimeOptions,
    );
    expect(annotated.study_name).toBe("Named study");
    expect({ ...annotated, study_name: baseline.study_name }).toEqual(baseline);
  });
});

describe("Rust authority browser projection", () => {
  it("projects every Rust-owned output and every optional visualization branch", async () => {
    const options: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      selectedTimezone: "America/Chicago",
      processAppUsage: true,
      processScreenUsage: true,
      enableParquetExport: true,
      enableSpssExport: true,
      enableScreenGatedCrediting: true,
      enableComplianceScoring: true,
      enableDayCoverage: true,
      enableAggregates: true,
      useAppCodebook: true,
      modelConcurrentUsage: true,
      enablePlotting: true,
      exportPlotsAsSvg: true,
      enableActivityHeatmap: true,
      enableInteractiveTimeline: true,
      includeFilteredAppUsageInPlots: true,
    };
    const progress: string[] = [];
    const result = await processRawCsvWithRustAuthority(
      "Raw P01.CSV",
      enc.encode("raw"),
      options,
      undefined,
      { datetimeOfPreprocessing: "2026-07-21 00:00:00 UTC" },
      (event) => {
        if (event.type === "step") {
          progress.push(`${event.stepKind}:${event.percent}`);
        }
      },
    );

    expect(mocks.executeRustRuntime).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "Raw P01.CSV",
      options,
      undefined,
      expect.objectContaining({ persistRustWorkspace: true }),
      undefined,
    );
    expect(result.outputs.map(({ outputFileName }) => outputFileName)).toEqual(
      expect.arrayContaining([
        "Raw P01 Automatically Preprocessed.csv",
        "Raw P01 Screen Usage Automatically Preprocessed.csv",
        "Raw P01 Automatically Preprocessed.parquet",
        "Raw P01 Screen Usage Automatically Preprocessed.sav",
        "Raw P01 Category Time Budget.csv",
        "Raw P01 App Co-Usage.csv",
        "Raw P01 Row Lineage.arrow",
        "Raw P01 Source Coordinate Index.arrow",
        "Raw P01 Result Cell Correspondence.arrow",
        "Raw P01 Timeline Viewer.html",
        "Raw P01 P01 App Usage Plot.png",
        "Raw P01 P01 App Usage Heatmap.svg",
        "Raw P01 P01 Screen Usage Plot.svg",
      ]),
    );
    expect(result.timelineView?.app).toEqual([{ participantId: "included" }]);
    expect(result.rustRuntimeReceipt).toMatchObject({
      workspaceId: `sha256:${"3".repeat(64)}`,
      openObligationCount: 1,
      persistedGeneration: 11,
    });
    expect(progress).toEqual([
      "parse:0",
      "parse:1",
      "timezone:1",
      "filter:1",
      "screen:1",
      "matcher:1",
      "codebook:1",
      "enrich:1",
      "output:1",
    ]);
  });

  it("fails loudly when Rust omits an artifact or its CSV display metadata", async () => {
    const missing = fullExecution();
    missing.artifacts.delete("app-csv");
    mocks.executeRustRuntime.mockResolvedValueOnce(missing);
    await expect(
      processRawCsvWithRustAuthority(
        "Raw.csv",
        enc.encode("raw"),
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC", processScreenUsage: false },
        {},
        { persistRustWorkspace: false },
      ),
    ).rejects.toThrow(/omitted required artifact: app-csv/);

    const missingMetadata = fullExecution();
    missingMetadata.manifest.artifacts = missingMetadata.manifest.artifacts.map(
      (artifact) => artifact.kind === "app-csv"
        ? { ...artifact, previewRows: undefined }
        : artifact,
    );
    mocks.executeRustRuntime.mockResolvedValueOnce(missingMetadata);
    await expect(
      processRawCsvWithRustAuthority(
        "Raw.csv",
        enc.encode("raw"),
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC", processScreenUsage: false },
        {},
        { persistRustWorkspace: false },
      ),
    ).rejects.toThrow(/omitted CSV display metadata: app-csv/);
  });

  it("requires Rust to provide exact aggregate row counts", async () => {
    const execution = fullExecution();
    execution.manifest.artifacts = execution.manifest.artifacts.map((artifact) =>
      artifact.kind === "aggregate-daily-summary-csv"
        ? { ...artifact, rowCount: undefined }
        : artifact,
    );
    mocks.executeRustRuntime.mockResolvedValueOnce(execution);
    await expect(
      processRawCsvWithRustAuthority(
        "Raw.csv",
        enc.encode("raw"),
        {
          ...DEFAULT_BROWSER_OPTIONS,
          selectedTimezone: "UTC",
          processScreenUsage: false,
          enableAggregates: true,
          useAppCodebook: false,
        },
        {},
        { persistRustWorkspace: false },
      ),
    ).rejects.toThrow(/omitted CSV display metadata: aggregate-daily-summary-csv/);
  });

  it("does not project disabled app/screen or binary families", async () => {
    const result = await processRawCsvWithRustAuthority(
      "Raw.csv",
      enc.encode("raw"),
      {
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "UTC",
        processAppUsage: false,
        processScreenUsage: false,
        enableParquetExport: true,
        enableSpssExport: true,
        enablePlotting: false,
        enableInteractiveTimeline: false,
        enableAggregates: false,
        enableScreenGatedCrediting: false,
        enableComplianceScoring: false,
        enableDayCoverage: false,
      },
      {},
      { persistRustWorkspace: false },
    );
    expect(result.outputs).toHaveLength(11);
    expect(result.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "lineage",
        outputFileName: "Raw Row Lineage.arrow",
      }),
      expect.objectContaining({
        kind: "lineage",
        outputFileName: "Raw Source Coordinate Index.arrow",
      }),
      expect.objectContaining({
        kind: "lineage",
        outputFileName: "Raw Result Cell Correspondence.arrow",
      }),
      expect.objectContaining({ outputFileName: "Raw Evidence Journal.cbor" }),
      expect.objectContaining({ outputFileName: "Raw Artifact Closure.json" }),
      expect.objectContaining({ outputFileName: "Raw Dependency Certificate.json" }),
      expect.objectContaining({ outputFileName: "Raw Correspondence Index.json" }),
      expect.objectContaining({ outputFileName: "Raw Execution Ledger.json" }),
      expect.objectContaining({ outputFileName: "Raw Stage View.json" }),
      expect.objectContaining({ outputFileName: "Raw Semantic Index Source.json" }),
      expect.objectContaining({ outputFileName: "Raw Runtime Manifest.json" }),
    ]));
    expect(result.timelineView).toMatchObject({ app: [], screen: [] });
  });
});
