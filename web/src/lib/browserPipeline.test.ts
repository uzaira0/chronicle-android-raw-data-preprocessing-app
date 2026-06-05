import { describe, expect, it, vi, beforeEach } from "vitest";
import { parquetReadObjects } from "hyparquet";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import { generateAllHeatmapSvgs, generateAllPlots, generateAllPlotSvgs } from "@/lib/plotGenerator";

// Spread the real module and stub the canvas-rendering plot generators:
// browserPipeline imports CATEGORY_COLORS at module scope (PALETTE_CATEGORIES is
// built from it at load time), so a bare mock that omits it would crash on
// import — keep the spread. Plotting and screen usage are now ON by default, so
// the pipeline invokes the app/screen/heatmap generators; each must resolve to
// an (iterable) empty Map so the `for...of` over their results doesn't throw and
// no real canvas is rendered. computeHourDayMatrix stays real (it's pure) and is
// tested directly in heatmap.test.ts.
vi.mock("@/lib/plotGenerator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plotGenerator")>()),
  generateAllPlots: vi.fn(async () => new Map()),
  generateAllScreenPlots: vi.fn(async () => new Map()),
  generateAllHeatmaps: vi.fn(async () => new Map()),
  generateAllPlotSvgs: vi.fn(async () => new Map()),
  generateAllHeatmapSvgs: vi.fn(async () => new Map()),
}));
import type {
  LayeredSessionRow,
  MatcherInput,
  MatcherOutput,
  ProgressEvent,
  ProgressStepKind,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";

function csvBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

async function readOutputCsv(blob: Blob): Promise<string> {
  return await blob.text();
}

describe("browserPipeline", () => {
  it("discovers timezones from raw Chronicle CSV", () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/New_York",
    ].join("\n");

    expect(discoverTimezonesFromRawCsv(csv)).toEqual([
      "America/Chicago",
      "America/New_York",
    ]);
  });

  it("interprets offset-less Chronicle timestamps as UTC before conversion", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        timezoneHandling: "selected-convert",
        selectedTimezone: "America/New_York",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const output = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    expect(output).toContain("2026-03-07 05:00:00-05:00");
    expect(output).toContain("03-07-2026 05:00:00");
  });

  it("produces app and screen outputs from the shared pipeline", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:05,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:15,America/Chicago",
      "Study,P01,Target Child,System,Unknown importance: 16,android,2026-03-07 10:00:20,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [1],
      stopStartIndices: [1],
      stopEventIndices: [2],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        processAppUsage: true,
        processScreenUsage: true,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[0]?.kind).toBe("app");
    expect(await readOutputCsv(result.outputs[0]!.blob)).toContain("App Usage");
    expect(result.outputs[1]?.kind).toBe("screen");
    const screenCsv = await readOutputCsv(result.outputs[1]!.blob);
    expect(screenCsv).toContain("Screen Usage");
    expect(screenCsv).toContain("probable_manual_lock");
  });

  it("only populates consolidated genreId_scraped when source genres agree", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Consensus,Unknown importance: 1,com.example.consensus,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Consensus,Unknown importance: 2,com.example.consensus,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,Disagree,Unknown importance: 1,com.example.disagree,2026-03-07 11:00:00,America/Chicago",
      "Study,P01,Target Child,Disagree,Unknown importance: 2,com.example.disagree,2026-03-07 11:01:00,America/Chicago",
    ].join("\n");

    const codebookCsv = [
      "app_package_name,application_label,play_store_genreId,usc_genreId,babyemu_genreId_scraped",
      "com.example.consensus,Consensus,EDUCATION,EDUCATION,EDUCATION",
      "com.example.disagree,Disagree,NEWS_AND_MAGAZINES,SOCIAL,SOCIAL",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0, 2],
      stopStartIndices: [0, 2],
      stopEventIndices: [1, 3],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: true,
      },
      {
        appCodebookFile: {
          name: "app_codebook.csv",
          bytes: csvBytes(codebookCsv),
        },
      },
      matcher,
    );

    const output = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    expect(output).toContain("genreId_scraped");
    expect(output).toContain("EDUCATION");
    expect(output).toContain("NEWS_AND_MAGAZINES");
    expect(output).toContain("SOCIAL");
  });

  it("omits codebook columns from the app output when codebook use is disabled", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const fullCsv = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    const header = fullCsv.split("\n", 1)[0] ?? "";
    expect(header).not.toContain("genreId_scraped");
    expect(header).not.toContain("play_store_genreId");
    expect(header).not.toContain("broad_app_category");
  });

  it("retains valid missing start timestamps while keeping filtered missing timestamps blank", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Filtered,Unknown importance: 1,com.example.filtered,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Valid,Unknown importance: 1,com.example.valid,2026-03-07 10:10:00,America/Chicago",
    ].join("\n");

    const filterCsv = [
      "app_package_name,known_application_labels",
      "com.example.filtered,Filtered",
    ].join("\n");

    const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
      const resumedIndices = Array.from(input.resumed)
        .map((value, index) => (value ? index : -1))
        .filter((index) => index >= 0);
      return {
        startIndices: resumedIndices,
        stopStartIndices: [],
        stopEventIndices: [],
        missingIndices: resumedIndices,
      };
    };

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: true,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {
        filterFile: {
          name: "filter.csv",
          bytes: csvBytes(filterCsv),
        },
      },
      matcher,
    );

    const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    const lines = csvText.trim().split("\n");
    const headers = (lines[0] ?? "").split(",");
    const rows = lines
      .slice(1)
      .map((line: string) => line.split(","));
    const interactionIndex = headers.indexOf("interaction_type");
    const startTimestampIndex = headers.indexOf("start_timestamp");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[interactionIndex]).toBe("End of Usage Missing");
    expect(rows[0]?.[startTimestampIndex]).toBe("");
    expect(rows[1]?.[interactionIndex]).toBe("End of Usage Missing");
    expect(rows[1]?.[startTimestampIndex]).not.toBe("");
  });

  it("remaps background-app flags and sets the matcher background mask", async () => {
    // Background app (Spotify) resumes, is paused (backgrounded), a normal app
    // runs, then Spotify's Activity Stopped arrives. Rows reach the matcher in
    // timestamp order: [spotify resume, spotify pause, normal resume, normal
    // pause, spotify stopped].
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Audio,Activity Resumed,com.spotify.music,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Audio,Activity Paused,com.spotify.music,2026-03-07 10:05:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.normal.app,2026-03-07 10:06:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.normal.app,2026-03-07 10:10:00,America/Chicago",
      "Study,P01,Target Child,Audio,Activity Stopped,com.spotify.music,2026-03-07 10:20:00,America/Chicago",
    ].join("\n");
    const backgroundCsv = ["package_name,label_or_note", "com.spotify.music,Audio"].join("\n");

    let captured: MatcherInput | null = null;
    const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
      captured = input;
      return { startIndices: [], stopStartIndices: [], stopEventIndices: [], missingIndices: [] };
    };
    const splitter = async (_input: SplitterInput): Promise<SplitterOutput> => [];

    await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: false,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
        useBackgroundAppsFile: true,
        modelConcurrentUsage: false,
      },
      { backgroundAppsFile: { name: "bg.csv", bytes: csvBytes(backgroundCsv) } },
      matcher,
      undefined,
      undefined,
      splitter,
    );

    expect(captured).not.toBeNull();
    const input = captured as unknown as MatcherInput;
    expect(Array.from(input.background)).toEqual([1, 1, 0, 0, 1]);
    // Background app: same_stop fires on its own re-resume (segments the
    // session) and Activity Stopped, but NOT on backgrounding (pause). So the
    // Spotify resume (idx0) and stop (idx4) are same_stops, its pause (idx1) is
    // not. The normal app keeps its pause/resume same_stop flags (idx2, idx3).
    expect(Array.from(input.sameStop)).toEqual([1, 0, 1, 1, 1]);
    // Background app's Activity Stopped is cleared from the fallback channel.
    expect(Array.from(input.stopped)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(input.resumed)).toEqual([1, 0, 1, 0, 0]);
  });

  it("applies the custom interaction-type remap to the matcher input (#4)", async () => {
    // A vendor-specific resume string the built-in map does not know.
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,VENDOR_RESUME,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago",
    ].join("\n");

    const runWith = async (interactionTypeRemap: string[]): Promise<MatcherInput> => {
      let captured: MatcherInput | null = null;
      const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
        captured = input;
        return { startIndices: [], stopStartIndices: [], stopEventIndices: [], missingIndices: [] };
      };
      await processRawCsvContent(
        "Raw P01.csv",
        csv,
        {
          ...DEFAULT_BROWSER_OPTIONS,
          processScreenUsage: false,
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useAppCodebook: false,
          interactionTypeRemap,
        },
        {},
        matcher,
      );
      expect(captured).not.toBeNull();
      return captured as unknown as MatcherInput;
    };

    // Without a remap the vendor string is not recognized as a resume.
    const baseline = await runWith([]);
    expect(Array.from(baseline.resumed)).toEqual([0, 0]);

    // With the remap the vendor row enters the matcher as an Activity Resumed.
    const remapped = await runWith(["VENDOR_RESUME => Activity Resumed"]);
    expect(Array.from(remapped.resumed)).toEqual([1, 0]);
  });

  it("emits aggregate outputs only when enableAggregates is on (#8/#13/#15)", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago",
    ].join("\n");
    const matcher = async (): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });
    const baseOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      enablePlotting: false,
      processScreenUsage: false,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useAppCodebook: false,
      modelConcurrentUsage: false,
    };

    const off = await processRawCsvContent("Raw P01.csv", csv, baseOptions, {}, matcher);
    expect(off.outputs.some((output) => output.kind === "aggregate")).toBe(false);

    const on = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      { ...baseOptions, enableAggregates: true },
      {},
      matcher,
    );
    const aggregates = on.outputs.filter((output) => output.kind === "aggregate");
    const names = aggregates.map((output) => output.outputFileName);
    expect(names).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Daily Summary"),
        expect.stringContaining("Weekly Summary"),
        expect.stringContaining("Top Apps"),
      ]),
    );
    // Category budget (no codebook) and co-usage (no concurrent usage) are gated off.
    expect(names.some((name) => name.includes("Category Time Budget"))).toBe(false);
    expect(names.some((name) => name.includes("App Co-Usage"))).toBe(false);

    const daily = aggregates.find((output) => output.outputFileName.includes("Daily Summary"))!;
    expect(daily.rowCount).toBe(1); // one (participant, date)
    const dailyCsv = await daily.blob.text();
    expect(dailyCsv).toContain("total_app_usage_minutes");
    expect(dailyCsv).toContain("P01");
  });

  it("emits typed Parquet twins of the app/screen CSVs only when enabled (#7)", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:05:00,America/Chicago",
    ].join("\n");
    const matcher = async (): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });
    const baseOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      enablePlotting: false,
      processScreenUsage: true,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useAppCodebook: false,
      modelConcurrentUsage: false,
    };

    const off = await processRawCsvContent("Raw P01.csv", csv, baseOptions, {}, matcher);
    expect(off.outputs.some((output) => output.kind === "parquet")).toBe(false);

    const on = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      { ...baseOptions, enableParquetExport: true },
      {},
      matcher,
    );
    const parquet = on.outputs.filter((output) => output.kind === "parquet");
    expect(parquet.map((p) => p.outputFileName)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Automatically Preprocessed.parquet"),
        expect.stringContaining("Screen Usage Automatically Preprocessed.parquet"),
      ]),
    );

    const appCsv = on.outputs.find((o) => o.kind === "app")!;
    const appParquet = parquet.find(
      (p) => !p.outputFileName.includes("Screen Usage"),
    )!;
    // Parquet row count matches the CSV's.
    expect(appParquet.rowCount).toBe(appCsv.rowCount);

    const buffer = await appParquet.blob.arrayBuffer();
    const rows = (await parquetReadObjects({
      file: { byteLength: buffer.byteLength, slice: (s: number, e?: number) => buffer.slice(s, e) },
    })) as Record<string, unknown>[];
    expect(rows).toHaveLength(appCsv.rowCount);

    // Parquet columns mirror the CSV header exactly (set equality).
    const csvHeader = (await appCsv.blob.text()).split("\n")[0]!.split(",");
    expect(new Set(Object.keys(rows[0]!))).toEqual(new Set(csvHeader));

    // Native dtypes preserved: strings stay strings, numerics are real numbers.
    expect(rows[0]!.participant_id).toBe("P01");
    expect(typeof rows[0]!.duration_minutes).toBe("number");
    expect(typeof rows[0]!.day).toBe("number");
  });

  it("emits progress events for every pipeline phase when onProgress is supplied", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const events: ProgressEvent[] = [];
    await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        processAppUsage: true,
        processScreenUsage: true,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
      undefined,
      (event) => events.push(event),
    );

    const stepKinds = new Set(
      events
        .filter((event): event is Extract<ProgressEvent, { type: "step" }> => event.type === "step")
        .map((event) => event.stepKind),
    );
    const expectedKinds: ProgressStepKind[] = [
      "parse",
      "timezone",
      "filter",
      "screen",
      "matcher",
      "codebook",
      "enrich",
      "output",
    ];
    expectedKinds.forEach((kind) => {
      expect(stepKinds.has(kind)).toBe(true);
    });
    events.forEach((event) => {
      if (event.type === "step") {
        expect(event.fileName).toBe("Raw P01.csv");
        expect(event.percent).toBeGreaterThanOrEqual(0);
        expect(event.percent).toBeLessThanOrEqual(1);
      }
    });
  });

  it("uses injected datetime_of_preprocessing when provided via runtime metadata", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
      { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
    );

    const csv0 = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    expect(csv0).toContain("2026-04-24 00:32:53");
  });

  it("labels default datetime_of_preprocessing as UTC", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const csv0 = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    expect(csv0).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  });

  it("nulls duration fields for sessions below minimumUsageDuration but keeps the row", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:03,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        minimumUsageDuration: 5,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    const lines = csvText.trim().split("\n");
    const headers = (lines[0] ?? "").split(",");
    const dataRows = lines.slice(1).filter(Boolean);
    const durationSecondsIdx = headers.indexOf("duration_seconds");
    const durationMinutesIdx = headers.indexOf("duration_minutes");

    // The row is kept in the output
    expect(dataRows).toHaveLength(1);
    expect(csvText).toContain("App Usage");
    // But duration fields are empty (null → empty CSV cell)
    expect(dataRows[0]?.split(",")[durationSecondsIdx]).toBe("");
    expect(dataRows[0]?.split(",")[durationMinutesIdx]).toBe("");
  });

  it("populates duration fields normally when session meets minimumUsageDuration", async () => {
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:10,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        minimumUsageDuration: 5,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
    const lines = csvText.trim().split("\n");
    const headers = (lines[0] ?? "").split(",");
    const dataRows = lines.slice(1).filter(Boolean);
    const durationSecondsIdx = headers.indexOf("duration_seconds");

    expect(dataRows).toHaveLength(1);
    expect(Number(dataRows[0]?.split(",")[durationSecondsIdx])).toBe(10);
  });

  it("removes zero-duration App Usage rows when filterZeroDurationSessions is true", async () => {
    // Disable duplicate correction so same-timestamp start/stop yields exactly 0 duration.
    const csv = [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,America/Chicago",
    ].join("\n");

    const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    const baseOpts = {
      ...DEFAULT_BROWSER_OPTIONS,
      correctDuplicateEventTimestamps: false,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useAppCodebook: false,
    };

    const withFilter = await processRawCsvContent("Raw P01.csv", csv, { ...baseOpts, filterZeroDurationSessions: true }, {}, matcher);
    const withoutFilter = await processRawCsvContent("Raw P01.csv", csv, { ...baseOpts, filterZeroDurationSessions: false }, {}, matcher);

    const filteredCsv = withFilter.outputs[0]?.blob ? await readOutputCsv(withFilter.outputs[0].blob) : "";
    const unfilteredCsv = withoutFilter.outputs[0]?.blob ? await readOutputCsv(withoutFilter.outputs[0].blob) : "";

    // Without filter: App Usage row is present
    expect(unfilteredCsv).toContain("App Usage");
    // With filter: App Usage row removed (only header remains)
    expect(filteredCsv).not.toContain("App Usage");
  });

  describe("gap-detection pre-algo timestamp capture and plotting", () => {
    beforeEach(() => {
      vi.mocked(generateAllPlots).mockClear();
      vi.mocked(generateAllPlots).mockResolvedValue(new Map());
    });

    it("produces a plot output for each participant when enablePlotting is true", async () => {
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");

      const mockBlob = new Blob(["fake-png"], { type: "image/png" });
      vi.mocked(generateAllPlots).mockResolvedValue(new Map([["P01", mockBlob]]));

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0],
        stopStartIndices: [0],
        stopEventIndices: [1],
        missingIndices: [],
      });

      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...DEFAULT_BROWSER_OPTIONS, enablePlotting: true, useFilterFile: false, useAppsForcingScreenOpenFile: false, useAppCodebook: false },
        {},
        matcher,
      );

      const plotOutputs = result.outputs.filter((o) => o.kind === "plot");
      expect(plotOutputs).toHaveLength(1);
      expect(plotOutputs[0]?.outputFileName).toContain("P01");
      expect(plotOutputs[0]?.outputFileName).toContain("App Usage Plot");
    });

    it("emits SVG plot siblings only when exportPlotsAsSvg is on", async () => {
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");
      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [],
      });
      const pngBlob = new Blob(["fake-png"], { type: "image/png" });
      const svgBlob = new Blob(["<svg/>"], { type: "image/svg+xml" });
      vi.mocked(generateAllPlots).mockResolvedValue(new Map([["P01", pngBlob]]));
      vi.mocked(generateAllPlotSvgs).mockClear();
      vi.mocked(generateAllPlotSvgs).mockResolvedValue(new Map([["P01", svgBlob]]));
      vi.mocked(generateAllHeatmapSvgs).mockResolvedValue(new Map([["P01", svgBlob]]));

      const base = { ...DEFAULT_BROWSER_OPTIONS, enablePlotting: true, enableActivityHeatmap: false, useFilterFile: false, useAppsForcingScreenOpenFile: false, useAppCodebook: false };

      const off = await processRawCsvContent("Raw P01.csv", csv, { ...base, exportPlotsAsSvg: false }, {}, matcher);
      expect(off.outputs.some((o) => o.outputFileName.endsWith(".svg"))).toBe(false);
      expect(vi.mocked(generateAllPlotSvgs)).not.toHaveBeenCalled();

      const on = await processRawCsvContent("Raw P01.csv", csv, { ...base, exportPlotsAsSvg: true }, {}, matcher);
      const svgs = on.outputs.filter((o) => o.outputFileName.endsWith(".svg"));
      expect(svgs).toHaveLength(1);
      expect(svgs[0]?.outputFileName).toContain("App Usage Plot.svg");
      expect(svgs[0]?.kind).toBe("plot");
    });

    it("skips generateAllPlots when enablePlotting is false", async () => {
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [],
      });

      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...DEFAULT_BROWSER_OPTIONS, enablePlotting: false, useFilterFile: false, useAppsForcingScreenOpenFile: false, useAppCodebook: false },
        {},
        matcher,
      );

      expect(vi.mocked(generateAllPlots)).not.toHaveBeenCalled();
      expect(result.outputs.filter((o) => o.kind === "plot")).toHaveLength(0);
    });

    it("passes all pre-algorithm event timestamps to generateAllPlots", async () => {
      // 4 raw rows: the algorithm produces 1 APP_USAGE session.
      // The pre-algo capture must include all 4 rows (all event types).
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,System,Unknown importance: 15,android,2026-03-07 10:02:00,America/Chicago",
        "Study,P01,Target Child,System,Unknown importance: 16,android,2026-03-07 10:04:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");

      let capturedPreAlgoTs: Map<string, bigint[]> | undefined;
      vi.mocked(generateAllPlots).mockImplementation(
        async (_rows, _tz, _opts, _version, preAlgoTs) => {
          capturedPreAlgoTs = preAlgoTs as Map<string, bigint[]>;
          return new Map();
        },
      );

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0], stopStartIndices: [0], stopEventIndices: [3], missingIndices: [],
      });

      await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...DEFAULT_BROWSER_OPTIONS, enablePlotting: true, useFilterFile: false, useAppsForcingScreenOpenFile: false, useAppCodebook: false },
        {},
        matcher,
      );

      // All 4 raw events captured for P01 before the algorithm ran
      expect(capturedPreAlgoTs?.get("P01")).toHaveLength(4);
    });
  });

  describe("modelConcurrentUsage flag", () => {
    it("adds usage_layer column with primary/secondary values when flag is on", async () => {
      // Two overlapping app sessions:
      //   Session 0: 10:00:00 — 10:05:00 (outer, 300s)
      //   Session 1: 10:01:00 — 10:03:00 (inner, 120s)
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Outer,Unknown importance: 1,com.example.outer,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Inner,Unknown importance: 1,com.example.inner,2026-03-07 10:01:00,America/Chicago",
        "Study,P01,Target Child,Inner,Unknown importance: 2,com.example.inner,2026-03-07 10:03:00,America/Chicago",
        "Study,P01,Target Child,Outer,Unknown importance: 2,com.example.outer,2026-03-07 10:05:00,America/Chicago",
      ].join("\n");

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0, 1],
        stopStartIndices: [0, 1],
        stopEventIndices: [3, 2],
        missingIndices: [],
      });

      // Mock splitter: returns a fixed set of LayeredSessionRow objects
      // representing the outer session split into 3 sub-intervals and the
      // inner session as a single primary sub-interval.
      const mockSplitter = async (_input: SplitterInput): Promise<SplitterOutput> => {
        const rows: LayeredSessionRow[] = [
          // session 0 (outer): [0,60s) primary, [60,180s) secondary, [180,300s) primary
          { sessionIndex: 0, startNs: 1741341600000000000n, stopNs: 1741341660000000000n, layer: "primary" },
          { sessionIndex: 0, startNs: 1741341660000000000n, stopNs: 1741341780000000000n, layer: "secondary" },
          { sessionIndex: 0, startNs: 1741341780000000000n, stopNs: 1741341900000000000n, layer: "primary" },
          // session 1 (inner): [0,120s) primary
          { sessionIndex: 1, startNs: 1741341660000000000n, stopNs: 1741341780000000000n, layer: "primary" },
        ];
        return rows;
      };

      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        {
          ...DEFAULT_BROWSER_OPTIONS,
          modelConcurrentUsage: true,
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useAppCodebook: false,
        },
        {},
        matcher,
        undefined,
        undefined,
        mockSplitter,
      );

      const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
      const lines = csvText.trim().split("\n");
      const headers = (lines[0] ?? "").split(",");

      // usage_layer column must be present
      expect(headers).toContain("usage_layer");

      const usageLayerIdx = headers.indexOf("usage_layer");
      const dataRows = lines.slice(1).filter(Boolean);

      // Every App Usage row must have a non-empty layer value
      const layers = dataRows.map((line) => line.split(",")[usageLayerIdx]);
      expect(layers.every((v) => v === "primary" || v === "secondary")).toBe(true);

      // Both primary and secondary values must appear in the output
      expect(layers).toContain("primary");
      expect(layers).toContain("secondary");
    });

    it("computes split sub-interval durations unconditionally (parity: minimumUsageDuration is not applied to split rows on any surface)", async () => {
      // One session, splitter returns a 2-second sub-interval; threshold is 5s.
      // Desktop (Python) and Rust do not null sub-threshold split durations, so
      // web must not either — the duration is populated regardless of threshold.
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Outer,Unknown importance: 1,com.example.outer,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Outer,Unknown importance: 2,com.example.outer,2026-03-07 10:00:10,America/Chicago",
      ].join("\n");

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0],
        stopStartIndices: [0],
        stopEventIndices: [1],
        missingIndices: [],
      });

      // Sub-interval that is only 2 seconds long (below minimumUsageDuration=5)
      const shortSubIntervalSplitter = async (_input: SplitterInput): Promise<SplitterOutput> => {
        const rows: LayeredSessionRow[] = [
          // 2-second primary sub-interval
          { sessionIndex: 0, startNs: 1741341600000000000n, stopNs: 1741341602000000000n, layer: "primary" },
        ];
        return rows;
      };

      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        {
          ...DEFAULT_BROWSER_OPTIONS,
          modelConcurrentUsage: true,
          minimumUsageDuration: 5,
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useAppCodebook: false,
        },
        {},
        matcher,
        undefined,
        undefined,
        shortSubIntervalSplitter,
      );

      const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
      const lines = csvText.trim().split("\n");
      const headers = (lines[0] ?? "").split(",");
      const dataRows = lines.slice(1).filter(Boolean);
      const durationSecondsIdx = headers.indexOf("duration_seconds");
      const durationMinutesIdx = headers.indexOf("duration_minutes");

      // Row is kept and duration fields are populated with the real 2s value
      // (NOT nulled) — matching the desktop and Rust split paths.
      expect(dataRows).toHaveLength(1);
      const durSec = dataRows[0]?.split(",")[durationSecondsIdx];
      const durMin = dataRows[0]?.split(",")[durationMinutesIdx];
      expect(durSec).not.toBe("");
      expect(Number(durSec)).toBeCloseTo(2);
      expect(Number(durMin)).toBeCloseTo(2 / 60);
    });

    it("nulls split sub-interval durations below minimumUsageDuration when applyMinimumUsageDurationToConcurrentSubintervals is on", async () => {
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Outer,Unknown importance: 1,com.example.outer,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Outer,Unknown importance: 2,com.example.outer,2026-03-07 10:00:10,America/Chicago",
      ].join("\n");

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0],
        stopStartIndices: [0],
        stopEventIndices: [1],
        missingIndices: [],
      });

      // 2-second sub-interval, below minimumUsageDuration = 5.
      const shortSubIntervalSplitter = async (_input: SplitterInput): Promise<SplitterOutput> => [
        { sessionIndex: 0, startNs: 1741341600000000000n, stopNs: 1741341602000000000n, layer: "primary" },
      ];

      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        {
          ...DEFAULT_BROWSER_OPTIONS,
          modelConcurrentUsage: true,
          applyMinimumUsageDurationToConcurrentSubintervals: true,
          minimumUsageDuration: 5,
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useAppCodebook: false,
        },
        {},
        matcher,
        undefined,
        undefined,
        shortSubIntervalSplitter,
      );

      const csvText = result.outputs[0]?.blob ? await readOutputCsv(result.outputs[0].blob) : "";
      const lines = csvText.trim().split("\n");
      const headers = (lines[0] ?? "").split(",");
      const dataRows = lines.slice(1).filter(Boolean);
      const durationSecondsIdx = headers.indexOf("duration_seconds");
      const durationMinutesIdx = headers.indexOf("duration_minutes");

      // Row kept; duration fields nulled (empty CSV cell) because the option is on.
      expect(dataRows).toHaveLength(1);
      expect(dataRows[0]?.split(",")[durationSecondsIdx]).toBe("");
      expect(dataRows[0]?.split(",")[durationMinutesIdx]).toBe("");
    });

    it("throws when modelConcurrentUsage is true but no runSplitter is provided", async () => {
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      ].join("\n");

      const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
        startIndices: [0],
        stopStartIndices: [0],
        stopEventIndices: [1],
        missingIndices: [],
      });

      await expect(
        processRawCsvContent(
          "Raw P01.csv",
          csv,
          {
            ...DEFAULT_BROWSER_OPTIONS,
            modelConcurrentUsage: true,
            useFilterFile: false,
            useAppsForcingScreenOpenFile: false,
            useAppCodebook: false,
          },
          {},
          matcher,
          // no runSplitter
        ),
      ).rejects.toThrow("runSplitter must be supplied when modelConcurrentUsage is true");
    });
  });
});
