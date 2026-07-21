import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";
import type {
  RuntimeManifest,
  RustRuntimeExecution,
} from "@/lib/rustPipelineRuntime";

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
  return {
    counts: { original: 4, processed: 3, app: 2, screen: 1 },
    input: { digest: `sha256:${"1".repeat(64)}` },
    workspaceRootDigest: `sha256:${"2".repeat(64)}`,
    workspaceId: `sha256:${"3".repeat(64)}`,
    planDigest: `sha256:${"4".repeat(64)}`,
    profileDigest: `sha256:${"5".repeat(64)}`,
    profileLockDigest: `sha256:${"6".repeat(64)}`,
    productContractDigest: `sha256:${"7".repeat(64)}`,
    openObligations: [{ role: "optional" }],
    journalDigest: `sha256:${"8".repeat(64)}`,
    artifacts,
    previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
    roleAssignments: [],
    nodeExecutions: [
      { node_id: "parse_events", status: "recomputed", reason_id: "changed-input" },
      { node_id: "outputs", status: "cached", reason_id: "same-input" },
    ],
    processingSummary: {
      availableTimezones: ["America/Chicago"],
      timezone: "America/Chicago",
      timezoneAction: "filtered_to_selected",
      rowsBeforeTimezoneHandling: 4,
      rowsAfterTimezoneHandling: 3,
      rowsRemovedByTimezone: 1,
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
    kind,
    digest: `sha256:${"a".repeat(64)}`,
    size: bytes.byteLength,
    rowCount: kind.includes("aggregate") || kind === "row-lineage-arrow" ? 7 : undefined,
  }));
  return {
    workspaceId: `sha256:${"3".repeat(64)}`,
    manifest: manifest(metadata),
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
        "Raw P01 Timeline Viewer.html",
        "Raw P01 P01 App Usage Plot.png",
        "Raw P01 P01 App Usage Heatmap.svg",
        "Raw P01 P01 Screen Usage Plot.svg",
      ]),
    );
    expect(result.timelineView?.app).toEqual([{ participantId: "included" }]);
    expect(result.graphReport).toEqual({
      statuses: { parse_events: "recomputed", outputs: "cached" },
      errors: {},
    });
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

  it("fails loudly when Rust omits an artifact or emits malformed CSV", async () => {
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

    const malformed = fullExecution();
    malformed.artifacts.set("app-csv", enc.encode('header\n"unterminated'));
    mocks.executeRustRuntime.mockResolvedValueOnce(malformed);
    await expect(
      processRawCsvWithRustAuthority(
        "Raw.csv",
        enc.encode("raw"),
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC", processScreenUsage: false },
        {},
        { persistRustWorkspace: false },
      ),
    ).rejects.toThrow(/CSV preview parse failed/);
  });

  it("derives aggregate row counts when metadata omits them and rejects malformed rows", async () => {
    const execution = fullExecution();
    execution.manifest.artifacts = execution.manifest.artifacts.map((artifact) =>
      artifact.kind === "aggregate-daily-summary-csv"
        ? { ...artifact, rowCount: undefined }
        : artifact,
    );
    execution.artifacts.set(
      "aggregate-daily-summary-csv",
      enc.encode('header\n"unterminated'),
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
    ).rejects.toThrow(/CSV row-count parse failed/);
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
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ kind: "lineage" });
    expect(result.timelineView).toMatchObject({ app: [], screen: [] });
  });
});
