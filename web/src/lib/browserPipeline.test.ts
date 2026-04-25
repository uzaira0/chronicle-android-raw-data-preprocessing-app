import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import type {
  MatcherInput,
  MatcherOutput,
  ProgressEvent,
  ProgressStepKind,
} from "@/lib/types";

function csvBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
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
        usageSessionMode: "app_and_screen_usage",
        useFilterFile: false,
        useKeepAwakeAppsFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[0]?.kind).toBe("app");
    expect(result.outputs[0]?.csv).toContain("App Usage");
    expect(result.outputs[1]?.kind).toBe("screen");
    expect(result.outputs[1]?.csv).toContain("Screen Usage");
    expect(result.outputs[1]?.csv).toContain("probable_manual_lock");
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
        useKeepAwakeAppsFile: false,
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

    const output = result.outputs[0]?.csv ?? "";
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
        useKeepAwakeAppsFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
    );

    const header = (result.outputs[0]?.csv ?? "").split("\n", 1)[0] ?? "";
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
        useKeepAwakeAppsFile: false,
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

    const rows = (result.outputs[0]?.csv ?? "")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(","));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[9]).toBe("End of Usage Missing");
    expect(rows[0]?.[10]).toBe("");
    expect(rows[1]?.[9]).toBe("End of Usage Missing");
    expect(rows[1]?.[10]).not.toBe("");
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
        usageSessionMode: "app_and_screen_usage",
        useFilterFile: false,
        useKeepAwakeAppsFile: false,
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
        useKeepAwakeAppsFile: false,
        useAppCodebook: false,
      },
      {},
      matcher,
      { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
    );

    expect(result.outputs[0]?.csv).toContain("2026-04-24 00:32:53");
  });
});
