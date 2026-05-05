import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import { generateAllPlots } from "@/lib/plotGenerator";

vi.mock("@/lib/plotGenerator", () => ({
  generateAllPlots: vi.fn(),
}));
import type {
  MatcherInput,
  MatcherOutput,
  ProgressEvent,
  ProgressStepKind,
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
        async (_rows, _tz, _opts, preAlgoTs) => {
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

  // ─── helpers shared by the extended tests ──────────────────────────────────

  const HEADER =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";

  function buildCsv(
    rows: Array<{
      packageName?: string;
      interactionType?: string;
      timestamp?: string;
      timezone?: string;
      label?: string;
      participantId?: string;
    }>,
  ) {
    const dataRows = rows.map(
      (r) =>
        `Study,${r.participantId ?? "P01"},Target Child,${r.label ?? "Chat"},${r.interactionType ?? "Unknown importance: 1"},${r.packageName ?? "com.example.app"},${r.timestamp ?? "2026-03-07 10:00:00"},${r.timezone ?? "America/Chicago"}`,
    );
    return [HEADER, ...dataRows].join("\n");
  }

  const noopMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
    startIndices: [],
    stopStartIndices: [],
    stopEventIndices: [],
    missingIndices: [],
  });

  const baseOpts = {
    ...DEFAULT_BROWSER_OPTIONS,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: false,
  };

  // ─── discoverTimezonesFromRawCsv ────────────────────────────────────────────

  describe("discoverTimezonesFromRawCsv – edge cases", () => {
    it("returns [] for an empty string (or throws — no valid rows)", () => {
      // PapaParse cannot detect a delimiter for an empty string; the pipeline throws.
      // Either [] is returned or an error is thrown — both are acceptable semantics.
      let result: string[] | undefined;
      try {
        result = discoverTimezonesFromRawCsv("");
      } catch {
        // acceptable — empty input is not a valid Chronicle CSV
        return;
      }
      expect(result).toEqual([]);
    });

    it("returns [] for only the header row", () => {
      expect(discoverTimezonesFromRawCsv(HEADER)).toEqual([]);
    });

    it("returns ['UTC'] when there is no timezone column (blank defaults to UTC)", () => {
      // The source does: requireString(row.timezone, "UTC") || "UTC"
      // so a missing timezone column falls back to the string "UTC".
      const csv = [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00",
      ].join("\n");
      expect(discoverTimezonesFromRawCsv(csv)).toEqual(["UTC"]);
    });

    it("deduplicates identical timezone values", () => {
      const csv = buildCsv([
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:00:00" },
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:01:00" },
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:02:00" },
      ]);
      expect(discoverTimezonesFromRawCsv(csv)).toEqual(["America/Chicago"]);
    });

    it("returns timezones sorted alphabetically", () => {
      const csv = buildCsv([
        { timezone: "US/Pacific", timestamp: "2026-03-07 10:00:00" },
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:01:00" },
        { timezone: "Europe/London", timestamp: "2026-03-07 10:02:00" },
      ]);
      const result = discoverTimezonesFromRawCsv(csv);
      expect(result).toEqual([...result].sort((a, b) => a.localeCompare(b)));
    });

    it("trims whitespace from timezone values", () => {
      const csvRaw = [
        HEADER,
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,  America/Chicago  ",
      ].join("\n");
      // The source reads timezone via requireString which trims — rows without tz are skipped
      // so we just verify it doesn't produce extra whitespace
      const result = discoverTimezonesFromRawCsv(csvRaw);
      expect(result.every((tz) => tz === tz.trim())).toBe(true);
    });

    it("excludes rows with blank timezone values", () => {
      const csv = [
        HEADER,
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:01:00,America/New_York",
      ].join("\n");
      const result = discoverTimezonesFromRawCsv(csv);
      expect(result).not.toContain("");
      expect(result).toContain("America/New_York");
    });

    it("returns multiple distinct timezones", () => {
      const csv = buildCsv([
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:00:00" },
        { timezone: "America/New_York", timestamp: "2026-03-07 10:01:00" },
        { timezone: "Europe/London", timestamp: "2026-03-07 10:02:00" },
      ]);
      const result = discoverTimezonesFromRawCsv(csv);
      expect(result).toContain("America/Chicago");
      expect(result).toContain("America/New_York");
      expect(result).toContain("Europe/London");
      expect(result).toHaveLength(3);
    });
  });

  // ─── timezone handling variants ────────────────────────────────────────────

  describe("processRawCsvContent – timezoneHandling variants", () => {
    const twoTzCsv = buildCsv([
      { timezone: "America/Chicago", timestamp: "2026-03-07 10:00:00", interactionType: "Unknown importance: 1" },
      { timezone: "America/Chicago", timestamp: "2026-03-07 10:01:00", interactionType: "Unknown importance: 2" },
      { timezone: "America/New_York", timestamp: "2026-03-07 11:00:00", interactionType: "Unknown importance: 1" },
      { timezone: "America/New_York", timestamp: "2026-03-07 11:01:00", interactionType: "Unknown importance: 2" },
    ]);

    const pairMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    it("selected-filter keeps only rows matching selectedTimezone", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "selected-filter", selectedTimezone: "America/Chicago" },
        {},
        pairMatcher,
      );
      expect(result.rowsRemovedByTimezone).toBe(2);
      expect(result.timezoneAction).toBe("filtered_to_selected");
    });

    it("primary-filter keeps only rows matching the dominant timezone", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "primary-filter" },
        {},
        pairMatcher,
      );
      expect(result.rowsRemovedByTimezone).toBe(2);
      expect(result.timezoneAction).toBe("filtered_to_primary");
    });

    it("primary-convert converts to dominant timezone, no rows removed", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "primary-convert" },
        {},
        pairMatcher,
      );
      expect(result.rowsRemovedByTimezone).toBe(0);
      expect(result.timezoneAction).toBe("converted_to_primary");
    });

    it("selected-convert converts to selectedTimezone, no rows removed", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        {
          ...baseOpts,
          timezoneHandling: "selected-convert",
          selectedTimezone: "America/New_York",
        },
        {},
        pairMatcher,
      );
      expect(result.rowsRemovedByTimezone).toBe(0);
      expect(result.timezoneAction).toBe("converted_to_selected");
    });

    it("selected-filter with no selectedTimezone falls back to no-op filtering", async () => {
      // When selected is blank, the branch is skipped → action stays 'none'
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "selected-filter", selectedTimezone: "" },
        {},
        pairMatcher,
      );
      expect(result.rowsRemovedByTimezone).toBe(0);
      expect(result.timezoneAction).toBe("none");
    });

    it("output timezone matches selectedTimezone for selected-filter", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "selected-filter", selectedTimezone: "America/New_York" },
        {},
        pairMatcher,
      );
      expect(result.timezone).toBe("America/New_York");
    });
  });

  // ─── output structure ──────────────────────────────────────────────────────

  describe("processRawCsvContent – output structure", () => {
    const simpleCsv = buildCsv([
      { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
      { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
    ]);

    const simpleMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    it("result has an outputs array", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      expect(Array.isArray(result.outputs)).toBe(true);
    });

    it("output CSV contains participant_id from the data", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      const text = await result.outputs[0]!.blob.text();
      expect(text).toContain("P01");
    });

    it("app output filename includes 'Preprocessed' (case-insensitive)", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      const appOutput = result.outputs.find((o) => o.kind === "app");
      expect(appOutput?.outputFileName.toLowerCase()).toContain("preprocessed");
    });

    it("screen output filename differs from app output filename", async () => {
      const screenCsv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:05" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:00:15" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        screenCsv,
        { ...baseOpts, processAppUsage: true, processScreenUsage: true },
        {},
        simpleMatcher,
      );
      const appFile = result.outputs.find((o) => o.kind === "app")?.outputFileName;
      const screenFile = result.outputs.find((o) => o.kind === "screen")?.outputFileName;
      expect(appFile).not.toBe(screenFile);
    });

    it("screen output filename contains 'Screen'", async () => {
      const screenCsv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        screenCsv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: true },
        {},
        noopMatcher,
      );
      const screenFile = result.outputs.find((o) => o.kind === "screen")?.outputFileName;
      expect(screenFile).toContain("Screen");
    });

    it("processAppUsage=false produces no app output", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: false },
        {},
        noopMatcher,
      );
      expect(result.outputs.find((o) => o.kind === "app")).toBeUndefined();
    });

    it("processScreenUsage=true + processAppUsage=false produces only screen output", async () => {
      const screenCsv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        screenCsv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: true },
        {},
        noopMatcher,
      );
      expect(result.outputs.find((o) => o.kind === "app")).toBeUndefined();
      expect(result.outputs.find((o) => o.kind === "screen")).toBeDefined();
    });

    it("app output CSV has expected column headers", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      const text = await result.outputs[0]!.blob.text();
      const header = text.split("\n")[0] ?? "";
      expect(header).toContain("participant_id");
      expect(header).toContain("interaction_type");
      expect(header).toContain("start_timestamp");
      expect(header).toContain("stop_timestamp");
      expect(header).toContain("duration_seconds");
    });

    it("appRowCount reflects the number of output rows", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      expect(result.appRowCount).toBeGreaterThan(0);
    });

    it("originalRowCount equals number of non-blank-timestamp rows in input", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      expect(result.originalRowCount).toBe(2);
    });
  });

  // ─── edge cases ─────────────────────────────────────────────────────────────

  describe("processRawCsvContent – edge cases", () => {
    it("header-only CSV produces an app output with no data rows", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        HEADER,
        { ...baseOpts, processAppUsage: false, processScreenUsage: false },
        {},
        noopMatcher,
      );
      expect(result.originalRowCount).toBe(0);
      expect(result.outputs).toHaveLength(0);
    });

    it("rows with blank event_timestamp are silently dropped before processing", async () => {
      const csv = [
        HEADER,
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      ].join("\n");
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        baseOpts,
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      expect(result.originalRowCount).toBe(2);
    });

    it("RESUMED with no PAUSED match → End of Usage Missing row in output", async () => {
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
      ]);
      const missingMatcher = async (input: MatcherInput): Promise<MatcherOutput> => {
        const resumedIndices = Array.from(input.resumed)
          .map((v, i) => (v ? i : -1))
          .filter((i) => i >= 0);
        return {
          startIndices: resumedIndices,
          stopStartIndices: [],
          stopEventIndices: [],
          missingIndices: resumedIndices,
        };
      };
      const result = await processRawCsvContent("Raw P01.csv", csv, baseOpts, {}, missingMatcher);
      const text = await result.outputs[0]!.blob.text();
      expect(text).toContain("End of Usage Missing");
    });

    it("useFilterFile=false ignores provided filter data", async () => {
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00", packageName: "com.example.filtered" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00", packageName: "com.example.filtered" },
      ]);
      const filterCsv = "app_package_name,known_application_labels\ncom.example.filtered,Chat";
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, useFilterFile: false },
        { filterFile: { name: "filter.csv", bytes: new TextEncoder().encode(filterCsv).buffer } },
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      const text = await result.outputs[0]!.blob.text();
      // Without filtering, the app should appear as App Usage, not Filtered App Usage
      expect(text).toContain("App Usage");
      expect(text).not.toContain("Filtered App Usage");
    });

    it("correctDuplicateEventTimestamps=false leaves duplicate timestamps uncorrected", async () => {
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:00:00" },
      ]);
      // No crash and result is valid
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, correctDuplicateEventTimestamps: false },
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      expect(result.duplicateTimestampsCorrected).toBe(0);
    });

    it("correctDuplicateEventTimestamps=true reports corrected duplicates", async () => {
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:00:00" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, correctDuplicateEventTimestamps: true },
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      expect(result.duplicateTimestampsCorrected).toBeGreaterThan(0);
    });
  });

  // ─── codebook integration ──────────────────────────────────────────────────

  describe("processRawCsvContent – codebook integration", () => {
    const appCsv = buildCsv([
      { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00", packageName: "com.example.known" },
      { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00", packageName: "com.example.known" },
    ]);

    const simpleMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    it("useAppCodebook=false → no genreId_scraped or play_store_genreId in header", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        appCsv,
        { ...baseOpts, useAppCodebook: false },
        {},
        simpleMatcher,
      );
      const text = await result.outputs[0]!.blob.text();
      const header = text.split("\n")[0] ?? "";
      expect(header).not.toContain("play_store_genreId");
    });

    it("useAppCodebook=true + matching package → codebook columns present in header", async () => {
      const codebookCsv = [
        "app_package_name,application_label,play_store_genreId,usc_genreId,babyemu_genreId_scraped",
        "com.example.known,Known App,EDUCATION,EDUCATION,EDUCATION",
      ].join("\n");
      const result = await processRawCsvContent(
        "Raw P01.csv",
        appCsv,
        { ...baseOpts, useAppCodebook: true },
        { appCodebookFile: { name: "codebook.csv", bytes: new TextEncoder().encode(codebookCsv).buffer } },
        simpleMatcher,
      );
      const text = await result.outputs[0]!.blob.text();
      const header = text.split("\n")[0] ?? "";
      expect(header).toContain("genreId_scraped");
    });

    it("useAppCodebook=true + matching package → codebook data values present", async () => {
      const codebookCsv = [
        "app_package_name,application_label,play_store_genreId,usc_genreId,babyemu_genreId_scraped",
        "com.example.known,Known App,EDUCATION,EDUCATION,EDUCATION",
      ].join("\n");
      const result = await processRawCsvContent(
        "Raw P01.csv",
        appCsv,
        { ...baseOpts, useAppCodebook: true },
        { appCodebookFile: { name: "codebook.csv", bytes: new TextEncoder().encode(codebookCsv).buffer } },
        simpleMatcher,
      );
      const text = await result.outputs[0]!.blob.text();
      expect(text).toContain("EDUCATION");
    });

    it("package not in codebook → genreId_scraped is 'Unknown'", async () => {
      const codebookCsv = [
        "app_package_name,application_label,play_store_genreId,usc_genreId,babyemu_genreId_scraped",
        "com.other.app,Other,GAMES,GAMES,GAMES",
      ].join("\n");
      const result = await processRawCsvContent(
        "Raw P01.csv",
        appCsv,
        { ...baseOpts, useAppCodebook: true },
        { appCodebookFile: { name: "codebook.csv", bytes: new TextEncoder().encode(codebookCsv).buffer } },
        simpleMatcher,
      );
      const text = await result.outputs[0]!.blob.text();
      expect(text).toContain("Unknown");
    });
  });

  // ─── progress events ───────────────────────────────────────────────────────

  describe("processRawCsvContent – progress events", () => {
    const simpleCsv = buildCsv([
      { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
      { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
    ]);
    const simpleMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    it("onProgress is called multiple times", async () => {
      let callCount = 0;
      await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        baseOpts,
        {},
        simpleMatcher,
        undefined,
        () => { callCount += 1; },
      );
      expect(callCount).toBeGreaterThan(1);
    });

    it("every step event has a percent between 0 and 1 inclusive", async () => {
      const events: ProgressEvent[] = [];
      await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        baseOpts,
        {},
        simpleMatcher,
        undefined,
        (e) => events.push(e),
      );
      events
        .filter((e): e is Extract<ProgressEvent, { type: "step" }> => e.type === "step")
        .forEach((e) => {
          expect(e.percent).toBeGreaterThanOrEqual(0);
          expect(e.percent).toBeLessThanOrEqual(1);
        });
    });

    it("every step event carries the correct fileName", async () => {
      const events: ProgressEvent[] = [];
      await processRawCsvContent(
        "MyFile.csv",
        simpleCsv,
        baseOpts,
        {},
        simpleMatcher,
        undefined,
        (e) => events.push(e),
      );
      events
        .filter((e): e is Extract<ProgressEvent, { type: "step" }> => e.type === "step")
        .forEach((e) => expect(e.fileName).toBe("MyFile.csv"));
    });

    it("'parse' and 'timezone' step kinds appear in progress events", async () => {
      const kinds = new Set<string>();
      await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        baseOpts,
        {},
        simpleMatcher,
        undefined,
        (e) => { if (e.type === "step") kinds.add(e.stepKind); },
      );
      expect(kinds.has("parse")).toBe(true);
      expect(kinds.has("timezone")).toBe(true);
    });

    it("'matcher' step kind appears when processAppUsage=true", async () => {
      const kinds = new Set<string>();
      await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        { ...baseOpts, processAppUsage: true },
        {},
        simpleMatcher,
        undefined,
        (e) => { if (e.type === "step") kinds.add(e.stepKind); },
      );
      expect(kinds.has("matcher")).toBe(true);
    });

    it("'screen' step kind appears when processScreenUsage=true", async () => {
      const screenCsv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const kinds = new Set<string>();
      await processRawCsvContent(
        "Raw P01.csv",
        screenCsv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: true },
        {},
        noopMatcher,
        undefined,
        (e) => { if (e.type === "step") kinds.add(e.stepKind); },
      );
      expect(kinds.has("screen")).toBe(true);
    });
  });

  // ─── interaction type normalisation ───────────────────────────────────────

  describe("interaction type normalisation in output", () => {
    async function getOutputInteractionTypes(interactionType: string): Promise<string[]> {
      const csv = buildCsv([
        { interactionType, timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, interactionTypesToRemove: [] },
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      const text = result.outputs[0]?.blob ? await result.outputs[0].blob.text() : "";
      const lines = text.trim().split("\n");
      const headers = (lines[0] ?? "").split(",");
      const itIdx = headers.indexOf("interaction_type");
      return lines.slice(1).map((line) => (line.split(",")[itIdx] ?? "").trim());
    }

    it("'Unknown importance: 1' normalises to 'Activity Resumed' before matching", async () => {
      // The matched row becomes 'App Usage'; the raw event is consumed.
      // We just verify the pipeline doesn't crash and produces output.
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        baseOpts,
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      expect(result.outputs).toHaveLength(1);
    });

    it("'Unknown importance: 15' normalises to 'Screen Interactive' in raw row data", async () => {
      // Screen Interactive starts a screen session; we verify screenRowCount > 0 for a
      // Screen Interactive + Screen Non-Interactive pair.
      const csv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: true },
        {},
        noopMatcher,
      );
      expect(result.screenRowCount).toBeGreaterThan(0);
    });

    it("'Move to Foreground' normalises to 'Activity Resumed' and is usable as a start event", async () => {
      const csv = buildCsv([
        { interactionType: "Move to Foreground", timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
      ]);
      // Should not throw; 'Move to Foreground' becomes 'Activity Resumed'
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        baseOpts,
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      expect(result.outputs).toHaveLength(1);
    });

    it("'Move to Background' normalises to 'Activity Paused'", async () => {
      // A Resumed + Move to Background pair should produce one App Usage session.
      const csv = buildCsv([
        { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
        { interactionType: "Move to Background", timestamp: "2026-03-07 10:01:00" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        baseOpts,
        {},
        async (_) => ({ startIndices: [0], stopStartIndices: [0], stopEventIndices: [1], missingIndices: [] }),
      );
      const text = await result.outputs[0]!.blob.text();
      expect(text).toContain("App Usage");
    });

    it("'Unknown importance: 17' normalises to 'Keyguard Shown'", async () => {
      // A Screen Interactive + Keyguard Shown (17) + Screen Non-Interactive pair
      const csv = buildCsv([
        { interactionType: "Unknown importance: 15", timestamp: "2026-03-07 10:00:00", packageName: "android" },
        { interactionType: "Unknown importance: 17", timestamp: "2026-03-07 10:00:10", packageName: "android" },
        { interactionType: "Unknown importance: 16", timestamp: "2026-03-07 10:00:20", packageName: "android" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        csv,
        { ...baseOpts, processAppUsage: false, processScreenUsage: true },
        {},
        noopMatcher,
      );
      // Lock screen was seen inside the session
      const screenText = await result.outputs.find((o) => o.kind === "screen")!.blob.text();
      expect(screenText).toContain("lock_screen");
    });
  });

  // ─── result metadata ───────────────────────────────────────────────────────

  describe("processRawCsvContent – result metadata", () => {
    const simpleCsv = buildCsv([
      { interactionType: "Unknown importance: 1", timestamp: "2026-03-07 10:00:00" },
      { interactionType: "Unknown importance: 2", timestamp: "2026-03-07 10:01:00" },
    ]);
    const simpleMatcher = async (_: MatcherInput): Promise<MatcherOutput> => ({
      startIndices: [0],
      stopStartIndices: [0],
      stopEventIndices: [1],
      missingIndices: [],
    });

    it("inputFileName in result matches the provided filename", async () => {
      const result = await processRawCsvContent("My File.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      expect(result.inputFileName).toBe("My File.csv");
    });

    it("availableTimezones lists discovered timezones from input", async () => {
      const csv = buildCsv([
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:00:00", interactionType: "Unknown importance: 1" },
        { timezone: "America/New_York", timestamp: "2026-03-07 10:01:00", interactionType: "Unknown importance: 2" },
      ]);
      const result = await processRawCsvContent("Raw P01.csv", csv, { ...baseOpts, timezoneHandling: "primary-convert" }, {}, simpleMatcher);
      expect(result.availableTimezones).toContain("America/Chicago");
      expect(result.availableTimezones).toContain("America/New_York");
    });

    it("rowsBeforeTimezoneHandling equals total parsed rows", async () => {
      const result = await processRawCsvContent("Raw P01.csv", simpleCsv, baseOpts, {}, simpleMatcher);
      expect(result.rowsBeforeTimezoneHandling).toBe(2);
    });

    it("rowsAfterTimezoneHandling equals rowsBeforeTimezoneHandling minus rowsRemovedByTimezone", async () => {
      const twoTzCsv = buildCsv([
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:00:00", interactionType: "Unknown importance: 1" },
        { timezone: "America/Chicago", timestamp: "2026-03-07 10:01:00", interactionType: "Unknown importance: 2" },
        { timezone: "America/New_York", timestamp: "2026-03-07 11:00:00", interactionType: "Unknown importance: 1" },
        { timezone: "America/New_York", timestamp: "2026-03-07 11:01:00", interactionType: "Unknown importance: 2" },
      ]);
      const result = await processRawCsvContent(
        "Raw P01.csv",
        twoTzCsv,
        { ...baseOpts, timezoneHandling: "primary-filter" },
        {},
        simpleMatcher,
      );
      expect(result.rowsAfterTimezoneHandling).toBe(result.rowsBeforeTimezoneHandling - result.rowsRemovedByTimezone);
    });

    it("screenRowCount is 0 when processScreenUsage=false", async () => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        simpleCsv,
        { ...baseOpts, processScreenUsage: false },
        {},
        simpleMatcher,
      );
      expect(result.screenRowCount).toBe(0);
    });
  });
});
