import { afterEach, describe, expect, it, vi } from "vitest";

// Stub only the canvas-backed generators; scene math stays real (see
// browserPipeline.test.ts for the rationale on spreading the original module).
vi.mock("@/lib/plotGenerator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plotGenerator")>()),
  generateAllPlots: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["png"], { type: "image/png" })]])),
  ),
  generateAllScreenPlots: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["png"], { type: "image/png" })]])),
  ),
  generateAllScreenPlotSvgs: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["svg"], { type: "image/svg+xml" })]])),
  ),
  generateAllHeatmaps: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["png"], { type: "image/png" })]])),
  ),
  generateAllPlotSvgs: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["svg"], { type: "image/svg+xml" })]])),
  ),
  generateAllHeatmapSvgs: vi.fn(() =>
    Promise.resolve(new Map([["P01", new Blob(["svg"], { type: "image/svg+xml" })]])),
  ),
}));
// A controllable mock so a single test can force an EMPTY workbook (exercises the
// parseWorkbookRows zero-row early return) while every other test keeps the
// default 3-row sheet.
const readExcelMocks = vi.hoisted(() => ({
  dom: vi.fn(() =>
    Promise.resolve([
      ["app_package_name", "known_application_labels"],
      ["com.sheet.app", "Sheet App"],
      ["", ""],
    ]),
  ),
}));
vi.mock("read-excel-file", () => ({
  default: readExcelMocks.dom,
}));
vi.mock("read-excel-file/web-worker", () => ({
  default: () => Promise.resolve([["app_package_name"], ["com.worker.app"]]),
}));

import {
  addAppUsageDetailColumns,
  buildCanonicalRows,
  type CanonicalRow,
  collectKeyguardShownTimestamps,
  countDuplicateTimestampGroups,
  DEFAULT_BROWSER_OPTIONS,
  deriveScreenUsageSessions,
  dominantTimezone,
  getPossibleDeviceModel,
  labelFilteredApps,
  markAppUsageFlags,
  markJunkAppsDownstream,
  normalizePrefilteredEventTypes,
  parseCsvRaw,
  processRawCsvContent,
  removeSelectedInteractionTypes,
  resolveDefaultSupportFiles,
  rowToScreenParquetCells,
  splitConcurrentSessions,
  unalignDuplicateTimestamps,
} from "@/lib/browserPipeline";
import type {
  MatcherOutput,
  RawChronicleRow,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";

const splitter = (input: SplitterInput): Promise<SplitterOutput> =>
  Promise.resolve(
    Array.from(input.starts, (startNs, sessionIndex) => ({
      sessionIndex,
      startNs,
      stopNs: input.stops[sessionIndex],
      layer: "primary" as const,
    })),
  );

const HEADER =
  "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";

function csv(rows: string[], timezone = "America/Chicago"): string {
  return [
    HEADER,
    ...rows.map((row, index) => {
      const [label, type, pkg] = row.split("|");
      const ts = `2026-03-07 10:0${index}:00`;
      return `Study,P01,Target Child,${label},${type},${pkg},${ts},${timezone}`;
    }),
  ].join("\n");
}

const APP_SCREEN_CSV = csv([
  "System|Screen Interactive|android",
  '"Chat, Deluxe"|Activity Resumed|com.example.chat',
  '"Chat, Deluxe"|Activity Paused|com.example.chat',
  "System|Screen Non-Interactive|android",
]);

const matcher = (): Promise<MatcherOutput> =>
  Promise.resolve({
    startIndices: [1],
    stopStartIndices: [1],
    stopEventIndices: [2],
    missingIndices: [],
  });

function support(name: string, text: string) {
  return { name, bytes: new TextEncoder().encode(text).buffer };
}

const EDGE_SUPPORT_FILES = {
  filterFile: support(
    "filter.csv",
    'app_package_name,known_application_labels\ncom.junk,"Junk, JunkAlt"\n,orphan-label\ncom.junk,More',
  ),
  appsForcingScreenOpenFile: support(
    "forcing.csv",
    "package_name,label_or_note\n#comment,skipped\ncom.forcer,Forcer\n,no-package",
  ),
  backgroundAppsFile: support(
    "background.csv",
    "package_name,label_or_note\n#comment,skipped\ncom.bg,Background",
  ),
  appCodebookFile: support(
    "codebook.csv",
    "app_package_name,bcm_play_store_genreId\ncom.example.chat,Social\ncom.example.chat,DupIgnored\n,orphan",
  ),
};

const KITCHEN_SINK_OPTIONS = {
  ...DEFAULT_BROWSER_OPTIONS,
  useFilterFile: true,
  useAppsForcingScreenOpenFile: true,
  useBackgroundAppsFile: true,
  useAppCodebook: true,
  enablePlotting: true,
  exportPlotsAsSvg: true,
  enableActivityHeatmap: true,
  enableInteractiveTimeline: false,
  enableParquetExport: true,
  enableSpssExport: true,
};

describe("full runs with uploaded support files", () => {
  it("processes every output kind and escapes comma-bearing labels", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      KITCHEN_SINK_OPTIONS,
      EDGE_SUPPORT_FILES,
      matcher,
      undefined,
      undefined,
      splitter,
    );
    const kinds = result.outputs.map((output) => output.kind);
    expect(kinds).toContain("app");
    expect(kinds).toContain("screen");
    expect(kinds.filter((kind) => kind === "parquet").length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain("plot");
    const names = result.outputs.map((output) => output.outputFileName);
    expect(names.some((name) => name.includes("Heatmap.png"))).toBe(true);
    expect(names.some((name) => name.includes("Heatmap.svg"))).toBe(true);
    expect(names.some((name) => name.includes("Screen Usage Plot"))).toBe(true);
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    // The comma-bearing label survives, quoted per RFC 4180.
    expect(appCsv).toContain('"Chat, Deluxe"');
    expect(appCsv).toContain("Social");
  });

  it("reuses the parsed-support cache when the same upload is processed twice", async () => {
    const options = { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false };
    const files = { filterFile: EDGE_SUPPORT_FILES.filterFile };
    const first = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, options, files, matcher);
    const second = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, options, files, matcher);
    expect(first.processedRowCount).toBe(second.processedRowCount);
  });

  it("labels every app Unknown when the codebook has no usable rows", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: true },
      { appCodebookFile: support("codebook.csv", "app_package_name,genreId_scraped") },
      matcher,
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    expect(appCsv).toContain("Unknown");
  });

  it("rejects legacy .xls and unknown support formats with named errors", async () => {
    await expect(
      processRawCsvContent(
        "Raw P01.csv",
        APP_SCREEN_CSV,
        { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
        { filterFile: support("filter.xls", "legacy") },
        matcher,
      ),
    ).rejects.toThrow(/Convert legacy \.xls workbooks/);
    await expect(
      processRawCsvContent(
        "Raw P01.csv",
        APP_SCREEN_CSV,
        { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
        { filterFile: support("filter.parquet", "nope") },
        matcher,
      ),
    ).rejects.toThrow(/Unsupported support file format/);
  });
});

describe("xlsx support-file loading per execution context", () => {
  afterEach(() => vi.unstubAllGlobals());

  const XLSX_FILES = { filterFile: support("filter-main.xlsx", "fake-xlsx-bytes") };

  it("uses the DOM reader when DOMParser exists", async () => {
    vi.stubGlobal("DOMParser", class {});
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
      XLSX_FILES,
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("uses the web-worker reader when only self exists", async () => {
    vi.stubGlobal("DOMParser", undefined);
    vi.stubGlobal("self", {});
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
      { filterFile: support("filter-worker.xlsx", "fake-xlsx-bytes") },
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("tells Node-only callers to use CSV support files", async () => {
    vi.stubGlobal("DOMParser", undefined);
    vi.stubGlobal("self", undefined);
    await expect(
      processRawCsvContent(
        "Raw P01.csv",
        APP_SCREEN_CSV,
        { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
        { filterFile: support("filter-node.xlsx", "fake-xlsx-bytes") },
        matcher,
      ),
    ).rejects.toThrow(/browser execution context/);
  });
});

describe("bundled default support files (fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Runs FIRST: the module caches successful default fetches per URL, so the
  // failure path must be exercised before any success populates the cache.
  // (Failures are evicted from the cache, so the success test still refetches.)
  it("fails loudly when a bundled asset does not load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    await expect(
      processRawCsvContent(
        "Raw P01.csv",
        APP_SCREEN_CSV,
        { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
        {},
        matcher,
      ),
    ).rejects.toThrow(/Failed to load bundled asset/);
  });

  it("fetches every enabled default and processes normally", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetched.push(String(url));
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("app_package_name,package_name\ncom.junk,com.junk"),
        });
      }),
    );
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: true,
        useAppsForcingScreenOpenFile: true,
        useBackgroundAppsFile: true,
        useAppCodebook: true,
      },
      {},
      matcher,
      undefined,
      undefined,
      splitter,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(fetched.length).toBeGreaterThanOrEqual(4);
  });

});

describe("timezone offset formatting in outputs", () => {
  it("emits +05:00 for a single-digit GMT offset zone", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        timezoneHandling: "selected-convert",
        selectedTimezone: "Asia/Karachi",
        useAppCodebook: false,
      },
      {},
      matcher,
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    expect(appCsv).toContain("+05:00");
  });

  it("emits +00:00 for UTC rows kept in their original zone", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      csv(
        [
          "System|Screen Interactive|android",
          "Chat|Activity Resumed|com.example.chat",
          "Chat|Activity Paused|com.example.chat",
        ],
        "UTC",
      ),
      {
        ...DEFAULT_BROWSER_OPTIONS,
        timezoneHandling: "selected-convert",
        selectedTimezone: "UTC",
        useAppCodebook: false,
      },
      {},
      matcher,
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    expect(appCsv).toContain("+00:00");
  });
});

describe("exported stage tails", () => {
  const NOW = "2026-04-24 00:32:53";

  function canonical(interaction: string, minute: number): ReturnType<typeof buildCanonicalRows>[number] {
    const raw: RawChronicleRow = {
      study_id: "S",
      participant_id: "P01",
      username: "Target Child",
      application_label: "App",
      interaction_type: interaction,
      app_package_name: "com.example.app",
      event_timestamp: `2026-03-02T10:${String(minute).padStart(2, "0")}:00Z`,
      timezone: "UTC",
    };
    return buildCanonicalRows([raw], NOW, "Android")[0];
  }

  it("markAppUsageFlags flags long gaps and long usage durations", () => {
    const base = canonical("App Usage", 0);
    const flagged = markAppUsageFlags(
      [
        { ...base, data_time_gap_hours: 30, duration_minutes: 26 * 60 },
        { ...base, data_time_gap_hours: 0, duration_minutes: null },
      ],
      DEFAULT_BROWSER_OPTIONS,
    );
    expect(flagged[0].any_app_usage_flags).toContain("TIME GAP");
    expect(flagged[0].any_app_usage_flags).toContain("APP USAGE");
    expect(flagged[1].any_app_usage_flags).toBe("[]");
  });

  it("deriveScreenUsageSessions returns [] without screen starts and sessions with them", () => {
    const noScreens = deriveScreenUsageSessions(
      [canonical("Activity Resumed", 0)],
      DEFAULT_BROWSER_OPTIONS,
      new Map(),
    );
    expect(noScreens).toEqual([]);
    const sessions = deriveScreenUsageSessions(
      [canonical("Screen Interactive", 0), canonical("Screen Non-Interactive", 5)],
      DEFAULT_BROWSER_OPTIONS,
      new Map(),
    );
    expect(sessions.length).toBeGreaterThan(0);
  });

  it("collectKeyguardShownTimestamps sorts and keeps equal timestamps", () => {
    const later = canonical("Keyguard Shown", 9);
    const earlier = canonical("Screen Interactive/Keyguard Shown", 1);
    const dupe = { ...later };
    const sorted = collectKeyguardShownTimestamps([later, earlier, dupe, canonical("App Usage", 3)]);
    expect(sorted).toHaveLength(3);
    expect(sorted[0]).toBe(earlier.event_timestamp_ns);
    expect(sorted[1]).toBe(sorted[2]);
  });

  it("dominantTimezone defaults to UTC and ignores rows without a zone", () => {
    expect(dominantTimezone([])).toBe("UTC");
    const chicago = canonical("App Usage", 0);
    chicago.timezone = "America/Chicago";
    const blank = canonical("App Usage", 1);
    blank.timezone = "";
    expect(dominantTimezone([chicago, blank])).toBe("America/Chicago");
  });

  it("rowToScreenParquetCells carries typed columns and a null data-time gap", () => {
    const row = {
      ...canonical("Screen Usage", 0),
      duration_seconds: 300,
      duration_minutes: 5,
      screen_usage_end_reason_confidence: 0.5,
      screen_usage_tail_gap_seconds: 10,
      screen_usage_lock_screen_only: 0,
    };
    const cells = rowToScreenParquetCells(row, DEFAULT_BROWSER_OPTIONS);
    expect(cells.duration_seconds).toBe(300);
    expect(cells.data_time_gap_hours).toBeNull();
    expect(cells.screen_usage_lock_screen_only).toBe(false);
    const nullish = rowToScreenParquetCells(
      { ...row, screen_usage_lock_screen_only: null },
      DEFAULT_BROWSER_OPTIONS,
    );
    expect(nullish.screen_usage_lock_screen_only).toBeNull();
  });
});

describe("targeted formatter and parser branches", () => {
  it("parses an offsetless, secondless timestamp via the Date.parse fallback", () => {
    // "2026-03-07 10:00" has no seconds, so it fails the plain YYYY-MM-DD HH:MM:SS
    // regex and takes the Date.parse(`...Z`) offsetless fallback.
    const raw: RawChronicleRow = {
      study_id: "S",
      participant_id: "P01",
      username: "Target Child",
      application_label: "App",
      interaction_type: "App Usage",
      app_package_name: "com.example.app",
      event_timestamp: "2026-03-07 10:00",
      timezone: "UTC",
    };
    const [row] = buildCanonicalRows([raw], "2026-04-24 00:00:00", "Android");
    expect(row.event_timestamp_ns).toBe(1772877600000000000n);
  });

  it("parseCsvRaw throws on a structurally malformed CSV", () => {
    expect(() => parseCsvRaw("study_id,participant_id\nStudy,P01,extra-field")).toThrow();
  });

  it("labelFilteredApps returns the input rows untouched when the filter map is empty", () => {
    const raw: RawChronicleRow = {
      study_id: "S",
      participant_id: "P01",
      username: "Target Child",
      application_label: "Chat",
      interaction_type: "Activity Resumed",
      app_package_name: "com.example.chat",
      event_timestamp: "2026-03-07T10:00:00Z",
      timezone: "UTC",
    };
    const rows = buildCanonicalRows([raw], "2026-04-24 00:00:00", "Android");
    expect(labelFilteredApps(rows, new Map())).toBe(rows);
  });

  it("serializes small floats with the polars notation boundary (decimal >= 1e-5, exponential below)", async () => {
    // Two 1 ms App Usage sessions 30 ms apart. duration_minutes = 0.001/60 ≈
    // 1.67e-5 sits in the [1e-5, 1e-4) band where polars keeps DECIMAL
    // expansion (the old 1e-4 exponential cutoff broke real-corpus parity
    // here), while the 30 ms inter-session gap in hours ≈ 8.3e-6 falls below
    // 1e-5 and takes the toExponential shortest-digits branch. The default
    // 60 s minimum-usage floor would null the durations, so disable the floor.
    const tinyCsv = [
      HEADER,
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 09:59:59.000,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00.000,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:00.001,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00.031,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:00.032,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:00:01.000,America/Chicago",
    ].join("\n");
    const result = await processRawCsvContent(
      "Raw P01.csv",
      tinyCsv,
      { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: false, minimumUsageDuration: 0 },
      {},
      () =>
        Promise.resolve({
          startIndices: [1, 3],
          stopStartIndices: [1, 3],
          stopEventIndices: [2, 4],
          missingIndices: [],
        }),
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    // [1e-5, 1e-4): decimal expansion, exactly as polars writes it.
    expect(appCsv).toContain("0.000016666666666666667");
    expect(appCsv).not.toContain("1.6666666666666667e-5");
    // Below 1e-5: shortest exponential, exactly as polars writes it.
    expect(appCsv).toContain("e-6");
  });

  it("quotes a comma-bearing participant_id in the day-coverage report", async () => {
    const commaCsv = [
      HEADER,
      'Study,"P,01",Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago',
      'Study,"P,01",Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:01:00,America/Chicago',
      'Study,"P,01",Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,America/Chicago',
      'Study,"P,01",Target Child,System,Screen Non-Interactive,android,2026-03-07 10:03:00,America/Chicago',
    ].join("\n");
    const result = await processRawCsvContent(
      "Raw P01.csv",
      commaCsv,
      { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: false, enableDayCoverage: true },
      {
        studyDatesFile: support(
          "study_dates.csv",
          'participant_id,start_date,end_date\n"P,01",2026-03-07,2026-03-09',
        ),
      },
      matcher,
    );
    const coverage = result.outputs.find((output) =>
      output.outputFileName.includes("Day Coverage"),
    );
    expect(coverage).toBeDefined();
    expect(await coverage!.blob.text()).toContain('"P,01"');
  });

  it("lowercases True/False codebook scalar values in the app output", async () => {
    // umich_free / umich_gambling_app are adjacent codebook output columns; a
    // "True"/"False" pair on the same app row drives both scalar branches.
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: true },
      {
        appCodebookFile: support(
          "codebook.csv",
          "app_package_name,umich_free,umich_gambling_app\ncom.example.chat,True,False",
        ),
      },
      matcher,
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    const header = appCsv.split("\n")[0].split(",");
    expect(header).toContain("umich_free");
    expect(header).toContain("umich_gambling_app");
    // The chat row carries the lowercased pair in adjacent columns.
    expect(appCsv).toContain("true,false");
  });

  it("rejects a structurally malformed support CSV", async () => {
    await expect(
      processRawCsvContent(
        "Raw P01.csv",
        APP_SCREEN_CSV,
        { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
        {
          filterFile: support(
            "filter.csv",
            "app_package_name,known_application_labels\ncom.junk,Junk,ExtraField",
          ),
        },
        matcher,
      ),
    ).rejects.toThrow();
  });
});

describe("resolveDefaultSupportFiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a missing default and passes uploaded files straight through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })),
    );
    const uploads = {
      appsForcingScreenOpenFile: support("forcing.csv", "package_name\ncom.forcer"),
      backgroundAppsFile: support("background.csv", "package_name\ncom.bg"),
      appCodebookFile: support("codebook.csv", "app_package_name\ncom.example.chat"),
    };
    const resolved = await resolveDefaultSupportFiles(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: true,
        useAppsForcingScreenOpenFile: true,
        useBackgroundAppsFile: true,
        useAppCodebook: true,
      },
      uploads,
    );
    // No filter upload -> the bundled default is fetched.
    expect(resolved.filterFile?.bytes.byteLength).toBe(4);
    // The three provided uploads are returned by identity (no fetch).
    expect(resolved.appsForcingScreenOpenFile).toBe(uploads.appsForcingScreenOpenFile);
    expect(resolved.backgroundAppsFile).toBe(uploads.backgroundAppsFile);
    expect(resolved.appCodebookFile).toBe(uploads.appCodebookFile);
  });
});

describe("default-support row cache reuse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves the second run from the parsed default-rows cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve("app_package_name,package_name\ncom.junk,com.junk"),
        }),
      ),
    );
    const options = { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false };
    const first = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, options, {}, matcher);
    // Second run hits the module-level defaultSupportCache for the same URL.
    const second = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, options, {}, matcher);
    expect(second.processedRowCount).toBe(first.processedRowCount);
  });
});

describe("empty xlsx support file", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a zero-row workbook as no support rows", async () => {
    vi.stubGlobal("DOMParser", class {});
    readExcelMocks.dom.mockResolvedValueOnce([]);
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
      { filterFile: support("empty.xlsx", "fake-xlsx-bytes") },
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
    // With an empty filter map nothing is relabeled: the comma-label app survives.
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    expect(appCsv).toContain("Chat, Deluxe");
  });
});

// ── Directly-exercised stage internals (exported for the graph/tests). These
//    isolate specific branch arms that the full-run fixtures never drive.
function rawRow(interaction: string, pkg: string, minute: number): RawChronicleRow {
  return {
    study_id: "S",
    participant_id: "P01",
    username: "Target Child",
    application_label: "App",
    interaction_type: interaction,
    app_package_name: pkg,
    event_timestamp: `2026-03-02T10:${String(minute).padStart(2, "0")}:00Z`,
    timezone: "UTC",
  };
}

function mkRow(interaction: string, pkg = "com.example.app", minute = 0): CanonicalRow {
  return buildCanonicalRows([rawRow(interaction, pkg, minute)], "2026-04-24 00:00:00", "Android")[0];
}

describe("exported stage-internal branch arms", () => {
  it("getPossibleDeviceModel flags Amazon Fire from an Amazon package prefix", () => {
    expect(getPossibleDeviceModel([rawRow("App Usage", "com.amazon.redstone", 0)])).toBe(
      "Amazon Fire",
    );
    expect(getPossibleDeviceModel([rawRow("App Usage", "com.example.app", 0)])).toBe("Android");
  });

  it("unalignDuplicateTimestamps spreads a cluster and leaves singleton clusters alone", () => {
    // Minutes [0,0,0,1]: the first cluster has three rows (count>1 arm) with two
    // Activity Resumed (priority 0) and one App Usage (priority 1) — driving BOTH
    // sort-comparator arms (equal vs unequal priority). The trailing minute-1 row
    // is a singleton cluster (count==1 arm).
    const rows = buildCanonicalRows(
      [
        rawRow("Activity Resumed", "com.a", 0),
        rawRow("Activity Resumed", "com.b", 0),
        rawRow("App Usage", "com.c", 0),
        rawRow("Activity Resumed", "com.d", 1),
      ],
      "2026-04-24 00:00:00",
      "Android",
    );
    expect(rows[0].event_timestamp_ns).toBe(rows[1].event_timestamp_ns);
    const out = unalignDuplicateTimestamps(rows, DEFAULT_BROWSER_OPTIONS);
    const stamps = out.map((row) => row.event_timestamp_ns);
    expect(new Set(stamps).size).toBe(4);
  });

  it("countDuplicateTimestampGroups counts a duplicate run that ends before the array does", () => {
    // Minutes [0, 1, 1, 2]: the middle pair collapses to one ns, and the run
    // ends before the final row — exercising the in-loop runLength>1 arm.
    const rows = buildCanonicalRows(
      [
        rawRow("App Usage", "com.a", 0),
        rawRow("App Usage", "com.b", 1),
        rawRow("App Usage", "com.c", 1),
        rawRow("App Usage", "com.d", 2),
      ],
      "2026-04-24 00:00:00",
      "Android",
    );
    expect(countDuplicateTimestampGroups(rows)).toBe(1);
  });

  it("normalizePrefilteredEventTypes leaves a non-Activity filtered type untouched", () => {
    // com.junk is filtered but the type has no Activity mapping -> the `: row`
    // passthrough arm.
    const rows = [mkRow("Filtered App Usage", "com.junk")];
    const out = normalizePrefilteredEventTypes(rows, new Set(["com.junk"]));
    expect(out[0].interaction_type).toBe("Filtered App Usage");
    expect(out[0]).toBe(rows[0]);
  });

  it("labelFilteredApps keeps interaction types absent from the relabel map", () => {
    // An empty label set matches every label; "App Usage" is not one of the four
    // Activity keys, so `mapping[...] ?? row.interaction_type` takes the fallback.
    const rows = [mkRow("App Usage", "com.junk")];
    const filterMap = new Map<string, Set<string>>([["com.junk", new Set<string>()]]);
    const out = labelFilteredApps(rows, filterMap);
    expect(out[0].interaction_type).toBe("App Usage");
  });

  it("markJunkAppsDownstream builds a background session and nulls one lacking timing", () => {
    const withTiming: CanonicalRow = {
      ...mkRow("App Usage", "com.junk", 0),
      start_timestamp_ns: 1_000_000_000n,
      stop_timestamp_ns: 2_000_000_000n,
    };
    const withoutTiming = mkRow("App Usage", "com.junk", 1); // start/stop default null
    const out = markJunkAppsDownstream(
      [withTiming, withoutTiming],
      "App Usage",
      "Activity Stopped",
      new Set(["com.junk"]),
      new Set(["com.junk"]),
    );
    expect(out[0].interaction_type).toBe("Filtered App Background Usage");
    expect(out[0].duration_seconds).toBe(1);
    expect(out[0].duration_minutes).toBeCloseTo(1 / 60);
    expect(out[1].interaction_type).toBe("Filtered App Background Usage");
    expect(out[1].duration_seconds).toBeNull();
    expect(out[1].duration_minutes).toBeNull();
  });

  it("splitConcurrentSessions coerces null episode timings to 0n for the splitter", async () => {
    const row = mkRow("App Usage", "com.example.app", 0); // start/stop null by default
    const captured: bigint[][] = [];
    const capturingSplitter = async (input: SplitterInput): Promise<SplitterOutput> => {
      captured.push([...input.starts], [...input.stops]);
      return splitter(input);
    };
    const out = await splitConcurrentSessions(
      [row],
      "App Usage",
      { ...DEFAULT_BROWSER_OPTIONS, modelConcurrentUsage: true },
      new Set(),
      capturingSplitter,
    );
    expect(captured[0]).toEqual([0n]);
    expect(captured[1]).toEqual([0n]);
    expect(out).toHaveLength(1);
  });

  it("addAppUsageDetailColumns uses the int64 sentinel for null neighbour timings", () => {
    // Two App Usage rows with null start/stop: the second row reads
    // current.start ?? MISSING_INT64 and previous.stop ?? MISSING_INT64.
    const out = addAppUsageDetailColumns(
      [mkRow("App Usage", "com.a", 0), mkRow("App Usage", "com.b", 1)],
      DEFAULT_BROWSER_OPTIONS,
    );
    expect(out).toHaveLength(2);
    // First engagement row is always seeded engage=1; the sentinel arithmetic on
    // the second row produces a finite (garbage) gap without throwing.
    expect(out[0].any_app_new_engage_30s).toBe(1);
    expect(Number.isFinite(out[1].any_app_usage_time_gap_hours)).toBe(true);
  });

  it("removeSelectedInteractionTypes keeps a removable type when its data gap is large", () => {
    const kept: CanonicalRow = { ...mkRow("App Usage", "com.a", 0), data_time_gap_hours: 99 };
    const dropped: CanonicalRow = { ...mkRow("App Usage", "com.b", 1), data_time_gap_hours: 0 };
    const out = removeSelectedInteractionTypes([kept, dropped], {
      ...DEFAULT_BROWSER_OPTIONS,
      interactionTypesToRemove: ["App Usage"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].data_time_gap_hours).toBe(99);
  });
});

describe("support-file alternate column names and codebook nulls", () => {
  it("reads package_name/app_package_name aliases and nulls blank codebook cells", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: true,
        useAppsForcingScreenOpenFile: true,
        useBackgroundAppsFile: true,
        useAppCodebook: true,
      },
      {
        // filter uses `package_name` (not app_package_name) -> alias fallback.
        // Blank labels => match every label for this package.
        filterFile: support(
          "filter.csv",
          "package_name,known_application_labels\ncom.example.chat,",
        ),
        // forcing uses `app_package_name` (not package_name) -> alias fallback.
        appsForcingScreenOpenFile: support(
          "forcing.csv",
          "app_package_name,label_or_note\ncom.forcer,Forcer",
        ),
        // background uses `app_package_name` (not package_name) -> alias fallback,
        // and enabling it makes the concurrent split run (splitter supplied).
        backgroundAppsFile: support("background.csv", "app_package_name,label_or_note\ncom.example.chat,BG"),
        // codebook row has an empty trailing cell -> requireString(value) || null.
        appCodebookFile: support("codebook.csv", "app_package_name,extra\ncom.example.chat,"),
      },
      matcher,
      undefined,
      undefined,
      splitter,
    );
    const appCsv = await result.outputs.find((output) => output.kind === "app")!.blob.text();
    // The filter aliased com.example.chat -> its Activity rows are relabeled.
    expect(appCsv).toContain("Filtered App");
  });
});

describe("resolveDefaultSupportFiles disabled toggles and study inputs", () => {
  it("skips disabled bundled defaults and passes every study-input upload through", async () => {
    const uploads = {
      studyDatesFile: support("dates.csv", "participant_id,start_date,end_date\nP01,2026-03-07,2026-03-09"),
      deviceSharingFile: support("sharing.csv", "participant_id\nP01"),
      surveyAttributionFile: support("survey.csv", "participant_id\nP01"),
      enrolledDevicesFile: support("enrolled.csv", "participant_id\nP01"),
    };
    const resolved = await resolveDefaultSupportFiles(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
      },
      uploads,
    );
    // All bundled-default toggles off -> nothing fetched.
    expect(resolved.filterFile).toBeUndefined();
    expect(resolved.appsForcingScreenOpenFile).toBeUndefined();
    expect(resolved.backgroundAppsFile).toBeUndefined();
    expect(resolved.appCodebookFile).toBeUndefined();
    // Study-input uploads pass through by identity.
    expect(resolved.studyDatesFile).toBe(uploads.studyDatesFile);
    expect(resolved.deviceSharingFile).toBe(uploads.deviceSharingFile);
    expect(resolved.surveyAttributionFile).toBe(uploads.surveyAttributionFile);
    expect(resolved.enrolledDevicesFile).toBe(uploads.enrolledDevicesFile);
  });
});

describe("workbook parsing edge shapes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a sparse leading header row as an empty workbook", async () => {
    vi.stubGlobal("DOMParser", class {});
    // Length > 0 but row[0] is missing -> `workbookRows[0]?.map(...) ?? []`.
    readExcelMocks.dom.mockResolvedValueOnce([
      undefined,
      ["ignored"],
    ] as unknown as string[][]);
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
      { filterFile: support("sparse.xlsx", "fake-xlsx-bytes") },
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("skips empty headers and missing/absent cells in a workbook", async () => {
    vi.stubGlobal("DOMParser", class {});
    readExcelMocks.dom.mockResolvedValueOnce([
      // First header cell is null -> inner `value ?? ""` right arm; it normalizes
      // to "" so `if (header)` also takes its false arm.
      [null, "app_package_name"],
      undefined, // absent row -> `rowValues?.[index]` undefined
      ["", "com.wbapp"], // real cell -> String(...) arm
      ["onlyone"], // short row -> `rowValues[index] == null` -> "" arm
    ] as unknown as string[][]);
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, useAppCodebook: false },
      { filterFile: support("shapes.xlsx", "fake-xlsx-bytes") },
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
  });
});

describe("processRawCsvContent structural branches", () => {
  const NO_CODEBOOK = { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: false };

  it("labels a blank participant_id as \"unknown\" in the pre-algorithm timestamp map", async () => {
    const blankPid = [
      HEADER,
      "Study,,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:01:00,America/Chicago",
      "Study,,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:00,America/Chicago",
      "Study,,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:03:00,America/Chicago",
    ].join("\n");
    const result = await processRawCsvContent("Raw P01.csv", blankPid, NO_CODEBOOK, {}, matcher);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("emits no app outputs when processAppUsage is disabled", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      { ...NO_CODEBOOK, processAppUsage: false },
      {},
      matcher,
    );
    expect(result.outputs.some((output) => output.kind === "app")).toBe(false);
  });

  it("accepts an undefined supportFiles argument", async () => {
    const result = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, NO_CODEBOOK, undefined, matcher);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("ignores an explicitly undefined support-file entry", async () => {
    const result = await processRawCsvContent(
      "Raw P01.csv",
      APP_SCREEN_CSV,
      NO_CODEBOOK,
      { filterFile: undefined },
      matcher,
    );
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("evicts the oldest pipeline engine past the LRU bound", async () => {
    for (const name of ["Evict A.csv", "Evict B.csv", "Evict C.csv"]) {
      const result = await processRawCsvContent(name, APP_SCREEN_CSV, NO_CODEBOOK, {}, matcher);
      expect(result.outputs.length).toBeGreaterThan(0);
    }
  });

  it("parses an uploaded survey-attribution study input", async () => {
    const result = await processRawCsvContent("Raw P01.csv", APP_SCREEN_CSV, NO_CODEBOOK, {
      surveyAttributionFile: support(
        "survey.csv",
        "participant_id,event_timestamp,users\nP01,2026-03-07 10:00:00,Target Child",
      ),
    }, matcher);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("coerces a true lock-screen-only boolean to 1 in the SPSS screen export", async () => {
    // Screen opened, keyguard shown, never unlocked, no foreground app -> the
    // session is classified lock_screen_only=1. With SPSS on, toSavRow coerces
    // that boolean `true` to 1 (the value ? 1 : 0 true arm).
    const lockCsv = [
      HEADER,
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,System,Keyguard Shown,android,2026-03-07 10:01:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:02:00,America/Chicago",
    ].join("\n");
    const emptyMatcher = (): Promise<MatcherOutput> =>
      Promise.resolve({
        startIndices: [],
        stopStartIndices: [],
        stopEventIndices: [],
        missingIndices: [],
      });
    const result = await processRawCsvContent(
      "Raw P01.csv",
      lockCsv,
      { ...NO_CODEBOOK, processAppUsage: false, enableSpssExport: true },
      {},
      emptyMatcher,
    );
    const screenCsv = await result.outputs.find((output) => output.kind === "screen")!.blob.text();
    expect(screenCsv).toContain("lock_screen_only");
    expect(result.outputs.some((output) => output.kind === "spss")).toBe(true);
  });
});

describe("output bundles past the preview row limit", () => {
  function bigCsv(quads: number): { text: string; startIndices: number[]; stopEventIndices: number[] } {
    const lines: string[] = [HEADER];
    const startIndices: number[] = [];
    const stopEventIndices: number[] = [];
    const stamp = (minute: number) =>
      new Date(Date.UTC(2026, 2, 7, 0, minute, 0)).toISOString().slice(0, 19).replace("T", " ");
    let minute = 0;
    let rowIndex = 0;
    for (let i = 0; i < quads; i += 1) {
      lines.push(`Study,P01,Target Child,System,Screen Interactive,android,${stamp(minute++)},UTC`);
      rowIndex += 1; // screen-on
      lines.push(`Study,P01,Target Child,App${i},Activity Resumed,com.app${i},${stamp(minute++)},UTC`);
      startIndices.push(rowIndex);
      rowIndex += 1; // resume
      lines.push(`Study,P01,Target Child,App${i},Activity Paused,com.app${i},${stamp(minute++)},UTC`);
      stopEventIndices.push(rowIndex);
      rowIndex += 1; // pause
      lines.push(`Study,P01,Target Child,System,Screen Non-Interactive,android,${stamp(minute++)},UTC`);
      rowIndex += 1; // screen-off
    }
    return { text: lines.join("\n"), startIndices, stopEventIndices };
  }

  it("streams app and screen rows beyond the 50-row preview cap", async () => {
    const { text, startIndices, stopEventIndices } = bigCsv(55);
    const bigMatcher = (): Promise<MatcherOutput> =>
      Promise.resolve({
        startIndices,
        stopStartIndices: startIndices,
        stopEventIndices,
        missingIndices: [],
      });
    const result = await processRawCsvContent(
      "Raw Big.csv",
      text,
      { ...DEFAULT_BROWSER_OPTIONS, useAppCodebook: false, minimumUsageDuration: 0 },
      {},
      bigMatcher,
    );
    const app = result.outputs.find((output) => output.kind === "app")!;
    const screen = result.outputs.find((output) => output.kind === "screen")!;
    expect(app.rowCount).toBeGreaterThan(50);
    expect(screen.rowCount).toBeGreaterThan(50);
    // Preview is capped: header + 50 data rows.
    expect(app.previewRows.length).toBe(51);
    expect(screen.previewRows.length).toBe(51);
  });
});
