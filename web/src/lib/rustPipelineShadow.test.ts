import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parquetReadObjects } from "hyparquet";
import {
  DEFAULT_BROWSER_OPTIONS,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import { matchAppUsageWithProximity } from "@/lib/proximityMatcher";
import * as kernel from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";
import * as matcherKernel from "@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js";
import {
  buildRustV2Options,
  discoverRustTimezones,
  executeRustRuntime,
  runRustV2Shadow,
  rustV2IneligibilityReasons,
  setRustPersistenceForTesting,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import { processRawCsvWithRustAuthority } from "@/lib/rustPipelineAuthority";
import type {
  BrowserProcessingOptions,
  MatcherInput,
  MatcherOutput,
  ProcessedFileResult,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";

vi.mock("@/lib/plotGenerator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plotGenerator")>()),
  generateAllPlots: vi.fn(() => Promise.resolve(new Map())),
  generateAllScreenPlots: vi.fn(() => Promise.resolve(new Map())),
  generateAllScreenPlotSvgs: vi.fn(() => Promise.resolve(new Map())),
  generateAllHeatmaps: vi.fn(() => Promise.resolve(new Map())),
  generateAllPlotSvgs: vi.fn(() => Promise.resolve(new Map())),
  generateAllHeatmapSvgs: vi.fn(() => Promise.resolve(new Map())),
}));

const eligibleOptions: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  studyName: "Shadow Study",
  processAppUsage: true,
  processScreenUsage: false,
  selectedTimezone: "America/Chicago",
  timezoneHandling: "selected-convert",
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  enablePlotting: false,
  proximityIntervalSeconds: 0,
};

beforeAll(async () => {
  const [wasmBytes, matcherWasmBytes] = await Promise.all([
    readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
    readFile(
      new URL(
        "../wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
  ]);
  kernel.initSync({ module: wasmBytes });
  matcherKernel.initSync({ module: matcherWasmBytes });
  setRustRuntimeForTesting(kernel);
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256Uri(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function defaultSupportFiles() {
  const root = new URL("../assets/defaults/", import.meta.url);
  const [filterFile, forcingFile, codebookFile] = await Promise.all([
    readFile(
      new URL(
        "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
        root,
      ),
    ),
    readFile(
      new URL(
        "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
        root,
      ),
    ),
    readFile(new URL("unified_app_codebook.csv", root)),
  ]);
  return {
    filterFile: { name: "filter.csv", bytes: toArrayBuffer(filterFile) },
    appsForcingScreenOpenFile: {
      name: "forcing.csv",
      bytes: toArrayBuffer(forcingFile),
    },
    appCodebookFile: {
      name: "codebook.csv",
      bytes: toArrayBuffer(codebookFile),
    },
  };
}

const deterministicMatcher = (input: {
  resumed: Uint8Array;
  sameStop: Uint8Array;
  otherStop: Uint8Array;
}): Promise<MatcherOutput> => {
  const startIndices: number[] = [];
  const stopStartIndices: number[] = [];
  const stopEventIndices: number[] = [];
  const missingIndices: number[] = [];
  for (let start = 0; start < input.resumed.length; start += 1) {
    if (input.resumed[start] !== 1) continue;
    startIndices.push(start);
    let stop = start + 1;
    while (
      stop < input.resumed.length &&
      input.sameStop[stop] !== 1 &&
      input.otherStop[stop] !== 1
    ) {
      stop += 1;
    }
    if (stop < input.resumed.length) {
      stopStartIndices.push(start);
      stopEventIndices.push(stop);
    } else {
      missingIndices.push(start);
    }
  }
  return Promise.resolve({
    startIndices,
    stopStartIndices,
    stopEventIndices,
    missingIndices,
  });
};

const wasmMatcher = (input: MatcherInput): Promise<MatcherOutput> =>
  Promise.resolve(
    matcherKernel.matchAppUsageUpdateIndicesV2(
      input.appCodes,
      input.timestampNs,
      input.resumed,
      input.sameStop,
      input.otherStop,
      input.stopped,
      input.background,
      input.options.allowStopEventReuse,
      input.options.useActivityStoppedAsFallback,
      input.options.applyThresholdToFallback,
      input.options.longDurationThresholdNs,
      input.options.proximityNs,
    ) as MatcherOutput,
  );

const wasmSplitter = (input: SplitterInput): Promise<SplitterOutput> =>
  Promise.resolve(
    matcherKernel.splitOverlappingSessions(
      input.starts,
      input.stops,
    ) as SplitterOutput,
  );

describe("bounded Rust v2 shadow boundary", () => {
  it("discovers sorted timezone values through Rust/WASM", async () => {
    const csv = new TextEncoder().encode(
      [
        "event_timestamp,timezone",
        "2026-03-07 10:00:00,America/New_York",
        "2026-03-07 11:00:00,",
        "2026-03-07 12:00:00,America/Chicago",
      ].join("\n"),
    );
    await expect(discoverRustTimezones(csv)).resolves.toEqual([
      "America/Chicago",
      "America/New_York",
      "UTC",
    ]);
  });
  it("fails closed with every unsupported production-default branch", () => {
    const reasons = rustV2IneligibilityReasons(DEFAULT_BROWSER_OPTIONS);
    expect(reasons).toContain(
      "selectedTimezone is required for the selected timezone policy",
    );
    expect(reasons).not.toContain("proximity matcher is unsupported");
    expect(reasons).not.toContain(
      "an explicit appCodebookFile is required for Rust shadow",
    );
  });

  it("maps the eligible contract to the snake-case Rust envelope", () => {
    const mapped = buildRustV2Options(eligibleOptions, {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
    });
    expect(mapped).toMatchObject({
      study_name: "Shadow Study",
      timezone: "America/Chicago",
      timezone_handling: "selected-convert",
      usage_session_mode: "app_usage",
      include_app_output: true,
      include_screen_output: false,
      datetime_of_preprocessing: "2026-07-21 12:00:00 UTC",
      model_concurrent_usage: false,
    });
  });

  it("fails closed for incomplete option envelopes and maps all usage modes", () => {
    expect(() =>
      buildRustV2Options(DEFAULT_BROWSER_OPTIONS, {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      }),
    ).toThrow(/selectedTimezone is required/);
    expect(() => buildRustV2Options(eligibleOptions, {})).toThrow(
      /datetimeOfPreprocessing is required/,
    );
    expect(
      buildRustV2Options(
        { ...eligibleOptions, processScreenUsage: true },
        { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" },
      ).usage_session_mode,
    ).toBe("app_and_screen_usage");
    expect(
      buildRustV2Options(
        {
          ...eligibleOptions,
          processAppUsage: false,
          processScreenUsage: true,
          timezoneHandling: "primary-convert",
          selectedTimezone: "",
        },
        { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" },
      ),
    ).toMatchObject({ usage_session_mode: "screen_usage", timezone: "UTC" });
  });

  it("compares exact base CSV bytes and authoritative counts through WASM", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");
    const runtime = {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      persistRustWorkspace: false,
    };
    const matcher = (): Promise<MatcherOutput> =>
      Promise.resolve({
        startIndices: [0],
        stopStartIndices: [0],
        stopEventIndices: [1],
        missingIndices: [],
      });
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      eligibleOptions,
      {},
      matcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      eligibleOptions,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(report.counts?.matches).toBe(true);
    expect(report.artifacts).toHaveLength(1);
    expect(report.artifacts[0]).toMatchObject({ kind: "app", matches: true });
    expect(report.workspaceRootDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.productContractDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.journalDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.reviewSummaryMatches).toBe(true);
  });

  it("reports nested review-summary divergence with the first precise path", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");
    const runtime = {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      persistRustWorkspace: false,
    };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      eligibleOptions,
      {},
      wasmMatcher,
      runtime,
    );
    const nestedMismatch = {
      ...tsResult,
      reviewSummary: {
        ...(tsResult.reviewSummary ?? { participants: [] }),
        participants: [{ participantId: "DIFFERENT" }],
      },
    } as ProcessedFileResult;
    const nested = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      eligibleOptions,
      {},
      runtime,
      nestedMismatch,
    );
    expect(nested).toMatchObject({
      status: "diverged",
      reviewSummaryMatches: false,
    });
    expect(nested.reasons.join(" ")).toContain("$.participants[0]");

    const lengthMismatch = {
      ...tsResult,
      reviewSummary: {
        ...(tsResult.reviewSummary ?? { participants: [] }),
        participants: [],
      },
    } as ProcessedFileResult;
    const length = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      eligibleOptions,
      {},
      runtime,
      lengthMismatch,
    );
    expect(length.reasons.join(" ")).toContain(".length:");
  });

  it("loads enabled bundled support once, rejects failed assets, and requires uploaded study dates", async () => {
    const csv = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      ].join("\n"),
    );
    const background = await readFile(
      new URL(
        "../assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv",
        import.meta.url,
      ),
    );
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(Uint8Array.from(background), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const options = {
        ...eligibleOptions,
        useBackgroundAppsFile: true,
      };
      await executeRustRuntime(csv, "Bundled A.csv", options, undefined, {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        persistRustWorkspace: false,
      });
      await executeRustRuntime(csv, "Bundled B.csv", options, undefined, {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        persistRustWorkspace: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }

    const filter = await readFile(
      new URL(
        "../assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
        import.meta.url,
      ),
    );
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(Uint8Array.from(filter), { status: 200 }),
      );
    vi.stubGlobal("fetch", retryFetch);
    try {
      await expect(
        executeRustRuntime(
          csv,
          "Failed support.csv",
          { ...eligibleOptions, useFilterFile: true },
          undefined,
          {
            datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
            persistRustWorkspace: false,
          },
        ),
      ).rejects.toThrow(/failed to load bundled asset \(503\)/);
      await expect(
        executeRustRuntime(
          csv,
          "Recovered support.csv",
          { ...eligibleOptions, useFilterFile: true },
          undefined,
          {
            datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
            persistRustWorkspace: false,
          },
        ),
      ).resolves.toMatchObject({ manifest: { counts: { original: 2 } } });
      expect(retryFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }

    await expect(
      executeRustRuntime(
        csv,
        "Missing study dates.csv",
        { ...eligibleOptions, enableStudyWindowFilter: true },
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
          persistRustWorkspace: false,
        },
      ),
    ).rejects.toThrow(/studyDatesFile is required/);
  });

  it("constructs the production result from Rust artifacts without the TypeScript graph", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");
    const runtime = {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      persistRustWorkspace: false,
    };
    const rustResult = await processRawCsvWithRustAuthority(
      "Raw P01.csv",
      new TextEncoder().encode(csv),
      eligibleOptions,
      {},
      runtime,
    );
    const typescriptResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      eligibleOptions,
      {},
      wasmMatcher,
      runtime,
    );
    expect(await rustResult.outputs[0].blob.text()).toBe(
      await typescriptResult.outputs[0].blob.text(),
    );
    expect(rustResult.reviewSummary).toEqual(typescriptResult.reviewSummary);
    expect(rustResult).toMatchObject({
      originalRowCount: 2,
      processedRowCount: 2,
      appRowCount: 1,
      screenRowCount: 0,
      availableTimezones: ["America/Chicago"],
      timezone: "America/Chicago",
      timezoneAction: "converted_to_selected",
      rowsBeforeTimezoneHandling: 2,
      rowsAfterTimezoneHandling: 2,
      rowsRemovedByTimezone: 0,
      duplicateTimestampsCorrected: 0,
      exactDuplicateRowsRemoved: 0,
    });
    expect(rustResult.rustRuntimeReceipt).toMatchObject({
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      openObligationCount: 0,
    });
    expect(rustResult.rustRuntimeReceipt?.workspaceRootDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(Object.keys(rustResult.graphReport?.statuses ?? {})).toHaveLength(15);
    expect(rustResult.executionLedger).toHaveLength(15);
    expect(
      rustResult.executionLedger?.flatMap(({ steps }) => steps),
    ).toHaveLength(55);
  });

  it.each(["wide", "long"] as const)(
    "matches every Rust-owned %s aggregate artifact and production filename",
    async (aggregateShape) => {
      const options: BrowserProcessingOptions = {
        ...eligibleOptions,
        processScreenUsage: true,
        enableAggregates: true,
        aggregateShape,
        minimumUsageDuration: 0,
      };
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
        "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 10:02:00,America/Chicago",
        "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 10:04:00,America/Chicago",
        "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");
      const runtime = {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        persistRustWorkspace: false,
      };
      const typescriptResult = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        options,
        {},
        wasmMatcher,
        runtime,
      );
      const report = await runRustV2Shadow(
        new TextEncoder().encode(csv),
        options,
        {},
        runtime,
        typescriptResult,
      );
      const rustResult = await processRawCsvWithRustAuthority(
        "Raw P01.csv",
        new TextEncoder().encode(csv),
        options,
        {},
        runtime,
      );
      for (const typescriptOutput of typescriptResult.outputs.filter(
        ({ kind }) => kind === "aggregate",
      )) {
        const rustOutput = rustResult.outputs.find(
          ({ outputFileName }) =>
            outputFileName === typescriptOutput.outputFileName,
        );
        expect(rustOutput).toBeDefined();
        expect(await rustOutput!.blob.text()).toBe(
          await typescriptOutput.blob.text(),
        );
      }
      expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
      expect(
        report.artifacts
          .slice(-3)
          .map(({ kind, matches }) => ({ kind, matches })),
      ).toEqual([
        { kind: "aggregate-daily", matches: true },
        { kind: "aggregate-weekly", matches: true },
        { kind: "aggregate-top-apps", matches: true },
      ]);
      expect(
        rustResult.outputs
          .filter(({ kind }) => kind === "aggregate")
          .map(({ outputFileName, rowCount }) => ({ outputFileName, rowCount })),
      ).toEqual(
        typescriptResult.outputs
          .filter(({ kind }) => kind === "aggregate")
          .map(({ outputFileName, rowCount }) => ({ outputFileName, rowCount })),
      );
    },
  );

  it("matches the codebook category and concurrent co-usage aggregate branches", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      useAppCodebook: true,
      modelConcurrentUsage: true,
      enableAggregates: true,
      minimumUsageDuration: 0,
    };
    const supportFiles = await defaultSupportFiles();
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,YouTube,Activity Resumed,com.google.android.youtube,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:03:00,America/Chicago",
      "Study,P01,Target Child,YouTube,Activity Paused,com.google.android.youtube,2026-03-07 10:04:00,America/Chicago",
    ].join("\n");
    const runtime = {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      persistRustWorkspace: false,
    };
    const typescriptResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      supportFiles,
      wasmMatcher,
      runtime,
      undefined,
      wasmSplitter,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      supportFiles,
      runtime,
      typescriptResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(report.artifacts.slice(-2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "aggregate-category-budget",
          matches: true,
        }),
        expect.objectContaining({ kind: "aggregate-co-usage", matches: true }),
      ]),
    );
  });

  it("round-trips Rust-owned Parquet semantically and preserves deterministic SPSS bytes", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      processScreenUsage: true,
      enableParquetExport: true,
      enableSpssExport: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago",
      "Study,P01,Target Child,Café,Activity Resumed,com.example.cafe,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Café,Activity Paused,com.example.cafe,2026-03-07 10:01:30,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:02:00,America/Chicago",
    ].join("\n");
    const runtime = {
      datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
      persistRustWorkspace: false,
    };
    const typescriptResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      wasmMatcher,
      runtime,
    );
    const rustResult = await processRawCsvWithRustAuthority(
      "Raw P01.csv",
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      typescriptResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(
      report.artifacts
        .filter(({ kind }) => kind.includes("parquet") || kind.includes("spss"))
        .map(({ kind, matches, comparison }) => ({
          kind,
          matches,
          comparison,
        })),
    ).toEqual([
      { kind: "app-parquet", matches: true, comparison: "decoded-values" },
      {
        kind: "screen-parquet",
        matches: true,
        comparison: "decoded-values",
      },
      { kind: "app-spss", matches: true, comparison: "exact-bytes" },
      { kind: "screen-spss", matches: true, comparison: "exact-bytes" },
    ]);
    const binary = (result: typeof rustResult, kind: "parquet" | "spss") =>
      result.outputs.filter((output) => output.kind === kind);
    expect(
      binary(rustResult, "parquet").map(({ outputFileName, rowCount }) => ({
        outputFileName,
        rowCount,
      })),
    ).toEqual(
      binary(typescriptResult, "parquet").map(
        ({ outputFileName, rowCount }) => ({ outputFileName, rowCount }),
      ),
    );
    for (const typescriptOutput of binary(typescriptResult, "parquet")) {
      const rustOutput = binary(rustResult, "parquet").find(
        ({ outputFileName }) =>
          outputFileName === typescriptOutput.outputFileName,
      )!;
      const read = async (blob: Blob) => {
        const bytes = await blob.arrayBuffer();
        return parquetReadObjects({
          file: {
            byteLength: bytes.byteLength,
            slice: (start: number, end?: number) => bytes.slice(start, end),
          },
        });
      };
      expect(await read(rustOutput.blob)).toEqual(
        await read(typescriptOutput.blob),
      );
    }
    const typescriptSav = binary(typescriptResult, "spss");
    const rustSav = binary(rustResult, "spss");
    expect(rustSav.map(({ outputFileName }) => outputFileName)).toEqual(
      typescriptSav.map(({ outputFileName }) => outputFileName),
    );
    for (const typescriptOutput of typescriptSav) {
      const rustOutput = rustSav.find(
        ({ outputFileName }) =>
          outputFileName === typescriptOutput.outputFileName,
      )!;
      expect(Buffer.from(await rustOutput.blob.arrayBuffer())).toEqual(
        Buffer.from(await typescriptOutput.blob.arrayBuffer()),
      );
    }
  });

  it("persists the complete Rust-declared closure after recovering the prior root", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");
    const csvBytes = new TextEncoder().encode(csv);
    const previousWorkspaceRootDigest = `sha256:${"1".repeat(64)}`;
    let persisted:
      | {
          workspaceRootDigest: string;
          previousWorkspaceRootDigest: string | null;
          artifacts: Array<{ kind: string; digest: string; size: number }>;
        }
      | undefined;
    let openedWorkspaceId: string | undefined;
    setRustPersistenceForTesting({
      openRoot: (workspaceId) => {
        openedWorkspaceId = workspaceId;
        return Promise.resolve({} as FileSystemDirectoryHandle);
      },
      recover: () =>
        Promise.resolve({
          protocolVersion: "chronicle-opfs-root/v1",
          generation: 6,
          workspaceRootDigest: previousWorkspaceRootDigest,
          previousWorkspaceRootDigest: null,
          artifactDigests: [],
          checksum: `sha256:${"2".repeat(64)}`,
        }),
      persist: (_root, input) => {
        persisted = input;
        return Promise.resolve({
          protocolVersion: "chronicle-opfs-root/v1",
          generation: 7,
          workspaceRootDigest: input.workspaceRootDigest,
          previousWorkspaceRootDigest: input.previousWorkspaceRootDigest,
          artifactDigests: input.artifacts.map(({ digest }) => digest),
          checksum: `sha256:${"3".repeat(64)}`,
        });
      },
    });
    try {
      const runtime = {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        persistRustWorkspace: true,
      };
      const tsResult = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        eligibleOptions,
        {},
        wasmMatcher,
        runtime,
      );
      const report = await runRustV2Shadow(
        csvBytes,
        eligibleOptions,
        {},
        runtime,
        tsResult,
      );
      expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
      expect(report.persistedWorkspace).toEqual({
        generation: 7,
        workspaceRootDigest: report.workspaceRootDigest,
      });
      expect(persisted?.previousWorkspaceRootDigest).toBe(
        previousWorkspaceRootDigest,
      );
      expect(persisted?.workspaceRootDigest).toBe(report.workspaceRootDigest);
      expect(openedWorkspaceId).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(persisted?.artifacts.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining([
          "ingress:raw_chronicle_csv",
          "processing-options-json",
          "review-summary-json",
          "visualization-data-json",
          "evidence-journal",
          "workspace-root-json",
          "stage-view-json",
          "artifact-view-json",
          "obligation-view-json",
          "explanation-view-json",
        ]),
      );
      expect(
        persisted?.artifacts.some(
          ({ kind, digest }) =>
            kind === "workspace-root-json" &&
            digest === report.workspaceRootDigest,
        ),
      ).toBe(true);
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  it("matches the explicit filter/codebook/screen-support profile", async () => {
    const supportFiles = await defaultSupportFiles();
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      processScreenUsage: true,
      useFilterFile: true,
      useAppsForcingScreenOpenFile: true,
      useAppCodebook: true,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,YouTube,Unknown importance: 1,com.google.android.youtube,2026-03-07 10:00:05,America/Chicago",
      "Study,P01,Target Child,YouTube,Unknown importance: 2,com.google.android.youtube,2026-03-07 10:01:05,America/Chicago",
      "Study,P01,Target Child,System,Unknown importance: 16,android,2026-03-07 10:01:10,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      supportFiles,
      deterministicMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      supportFiles,
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(
      report.artifacts.map(({ kind, matches }) => ({ kind, matches })),
    ).toEqual([
      { kind: "app", matches: true },
      { kind: "screen", matches: true },
    ]);
    expect(report.openObligationCount).toBe(0);
  });

  it("matches the production-default Rust proximity behavior", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      proximityIntervalSeconds: 2,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:01:00.500,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 23,com.example.chat,2026-03-07 10:01:01,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:10,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      (input) => Promise.resolve(matchAppUsageWithProximity(input)),
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
  });

  it("matches custom remap, disabled deduplication, and zero-duration filtering", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      interactionTypeRemap: ["VENDOR_RESUME => Activity Resumed"],
      deduplicateExactRows: false,
      filterZeroDurationSessions: true,
      correctDuplicateEventTimestamps: false,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,VENDOR_RESUME,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,VENDOR_RESUME,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      deterministicMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(report.counts?.matches).toBe(true);
  });

  it.each([
    "selected-filter",
    "selected-convert",
    "primary-filter",
    "primary-convert",
  ] as const)("matches the %s timezone policy", async (timezoneHandling) => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      selectedTimezone: "America/Chicago",
      timezoneHandling,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      deterministicMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
  });

  it("preserves selected-filter counts through the browser WASM ABI", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      timezoneHandling: "selected-filter",
      minimumUsageDuration: 0,
    };
    const csvBytes = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/New_York",
        "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/New_York",
        "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 11:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 11:01:00,America/Chicago",
      ].join("\n"),
    );
    const runtimeSupportFiles = new kernel.RuntimeSupportFiles();
    const handle = kernel.execute_bounded_v2_shadow(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        requestId: "timezone-abi-proof",
        command: "ExecuteBoundedV2Shadow",
        workspaceRootDigest: null,
        workspaceId: `sha256:${"a".repeat(64)}`,
        inputFileName: "Raw P01.csv",
        inputSha256: await sha256Uri(csvBytes),
        options: buildRustV2Options(options, {
          datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        }),
      }),
      csvBytes,
      runtimeSupportFiles,
    );
    try {
      const manifest = JSON.parse(handle.manifest_json()) as {
        counts: {
          original: number;
          processed: number;
          app: number;
          screen: number;
        };
      };
      expect(manifest.counts).toEqual({
        original: 4,
        processed: 2,
        app: 1,
        screen: 0,
      });
    } finally {
      handle.free();
      runtimeSupportFiles.free();
    }
  });

  it("matches concurrent session splitting and usage-layer output", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      modelConcurrentUsage: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Video,Activity Resumed,com.example.video,2026-03-07 10:02:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:10:00,America/Chicago",
      "Study,P01,Target Child,Video,Activity Paused,com.example.video,2026-03-07 10:12:00,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      wasmMatcher,
      runtime,
      undefined,
      wasmSplitter,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    if (report.status === "diverged") {
      const csvBytes = new TextEncoder().encode(csv);
      const runtimeSupportFiles = new kernel.RuntimeSupportFiles();
      const handle = kernel.execute_bounded_v2_shadow(
        JSON.stringify({
          protocolVersion: "chronicle-preprocessing-runtime/v1",
          requestId: "concurrent-diff-proof",
          command: "ExecuteBoundedV2Shadow",
          workspaceRootDigest: null,
          workspaceId: `sha256:${"b".repeat(64)}`,
          inputFileName: "Raw P01.csv",
          inputSha256: await sha256Uri(csvBytes),
          options: buildRustV2Options(options, runtime),
        }),
        csvBytes,
        runtimeSupportFiles,
      );
      try {
        const metadata = Array.from(
          { length: handle.artifact_count },
          (_, index) => ({
            index,
            value: JSON.parse(handle.artifact_metadata_json(index)) as {
              kind: string;
            },
          }),
        ).find(({ value }) => value.kind === "app-csv");
        expect(metadata).toBeDefined();
        const rustText = new TextDecoder().decode(
          handle.take_artifact_bytes(metadata!.index),
        );
        const tsText = await tsResult.outputs
          .find(({ kind }) => kind === "app")!
          .blob.text();
        expect(rustText).toBe(tsText);
      } finally {
        handle.free();
        runtimeSupportFiles.free();
      }
    }
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
  });

  it.each([false, true])(
    "matches background-app masks, own-stop lifetime, and layered output (filtered=%s)",
    async (useFilterFile) => {
      const options: BrowserProcessingOptions = {
        ...eligibleOptions,
        useBackgroundAppsFile: true,
        useFilterFile,
        minimumUsageDuration: 0,
      };
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Audio,Activity Resumed,com.spotify.music,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Audio,Activity Paused,com.spotify.music,2026-03-07 10:05:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Resumed,com.normal.app,2026-03-07 10:06:00,America/Chicago",
        "Study,P01,Target Child,Chat,Activity Paused,com.normal.app,2026-03-07 10:10:00,America/Chicago",
        "Study,P01,Target Child,Audio,Activity Stopped,com.spotify.music,2026-03-07 10:20:00,America/Chicago",
      ].join("\n");
      const background = new TextEncoder().encode(
        ["package_name,label_or_note", "com.spotify.music,Audio"].join("\n"),
      );
      const filter = new TextEncoder().encode(
        [
          "package_name,known_application_labels",
          "com.spotify.music,Audio",
        ].join("\n"),
      );
      const supportFiles = {
        backgroundAppsFile: {
          name: "background.csv",
          bytes: toArrayBuffer(background),
        },
        ...(useFilterFile
          ? { filterFile: { name: "filter.csv", bytes: toArrayBuffer(filter) } }
          : {}),
      };
      const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
      const tsResult = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        options,
        supportFiles,
        wasmMatcher,
        runtime,
        undefined,
        wasmSplitter,
      );
      const report = await runRustV2Shadow(
        new TextEncoder().encode(csv),
        options,
        supportFiles,
        runtime,
        tsResult,
      );
      expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    },
  );

  it("matches no-activity placeholder materialization by participant-day", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      addNoActivityPlaceholderDays: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,System,User Interaction,android,2026-03-08 09:00:00,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      wasmMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
  });

  it("matches screen-gated credited intervals and the side-by-side credited CSV", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      enableScreenGatedCrediting: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 09:59:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:10:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:11:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:30:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:31:00,America/Chicago",
    ].join("\n");
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      options,
      {},
      wasmMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      {},
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(report.artifacts.map(({ kind }) => kind)).toEqual([
      "app",
      "credited-app",
    ]);
  });

  it("matches inclusive study-window filtering with exact participant identity", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      enableStudyWindowFilter: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P100,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P100,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P100,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-08 10:00:00,America/Chicago",
      "Study,P100,Target Child,Chat,Activity Paused,com.example.chat,2026-03-08 10:01:00,America/Chicago",
    ].join("\n");
    const studyDates = new TextEncoder().encode(
      ["participant_id,start_date,end_date", "P100,2026-03-07,2026-03-07"].join(
        "\n",
      ),
    );
    const supportFiles = {
      studyDatesFile: {
        name: "study-dates.csv",
        bytes: toArrayBuffer(studyDates),
      },
    };
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw P100.csv",
      csv,
      options,
      supportFiles,
      wasmMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      supportFiles,
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
  });

  it("matches shared-device person attribution, kids-shell defaults, and survey overrides", async () => {
    const options: BrowserProcessingOptions = {
      ...eligibleOptions,
      enablePersonAttribution: true,
      enableStudyWindowFilter: true,
      enableDayCoverage: true,
      enableComplianceScoring: true,
      addNoActivityPlaceholderDays: true,
      minimumUsageDuration: 0,
    };
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P100,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P100,,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,P100,,Kids Home,Activity Resumed,com.amazon.tahoe,2026-03-07 10:02:00,America/Chicago",
      "Study,P100,,Kids Home,Activity Paused,com.amazon.tahoe,2026-03-07 10:03:00,America/Chicago",
      "Study,P200,,Game,Activity Resumed,com.example.game,2026-03-07 10:04:00,America/Chicago",
      "Study,P200,,Game,Activity Paused,com.example.game,2026-03-07 10:05:00,America/Chicago",
    ].join("\n");
    const deviceSharing = new TextEncoder().encode(
      ["Participant_ID,Sharing_Status", "P100,Shared", "P200,Non-Shared"].join(
        "\n",
      ),
    );
    const surveyAttribution = new TextEncoder().encode(
      [
        "PARTICIPANT_ID,EVENT_TIMESTAMP,USERS",
        "P100,2026-03-07 10:00:00,Other",
      ].join("\n"),
    );
    const studyDates = new TextEncoder().encode(
      [
        "participant_id,start_date,end_date",
        "P100,2026-03-07,2026-03-08",
        "P200,2026-03-07,2026-03-08",
      ].join("\n"),
    );
    const enrolledDevices = new TextEncoder().encode(
      ["participant_id,device_count", "P100,2", "P200,1"].join("\n"),
    );
    const supportFiles = {
      studyDatesFile: {
        name: "study-dates.csv",
        bytes: toArrayBuffer(studyDates),
      },
      deviceSharingFile: {
        name: "device-sharing.csv",
        bytes: toArrayBuffer(deviceSharing),
      },
      surveyAttributionFile: {
        name: "survey-attribution.csv",
        bytes: toArrayBuffer(surveyAttribution),
      },
      enrolledDevicesFile: {
        name: "enrolled-devices.csv",
        bytes: toArrayBuffer(enrolledDevices),
      },
    };
    const runtime = { datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC" };
    const tsResult = await processRawCsvContent(
      "Raw shared devices.csv",
      csv,
      options,
      supportFiles,
      wasmMatcher,
      runtime,
    );
    const report = await runRustV2Shadow(
      new TextEncoder().encode(csv),
      options,
      supportFiles,
      runtime,
      tsResult,
    );
    expect(report.status, JSON.stringify(report, null, 2)).toBe("matched");
    expect(report.artifacts.map(({ kind }) => kind)).toEqual([
      "app",
      "day-coverage",
      "compliance",
    ]);
  });
});
