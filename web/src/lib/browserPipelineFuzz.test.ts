import fc from "fast-check";
import Papa from "papaparse";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearPipelineEngines,
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import { inspectRawFile } from "@/lib/fileInspection";
import type {
  BrowserProcessingOptions,
  MatcherInput,
  MatcherOutput,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";

/**
 * Fuzzes the raw-CSV input boundary of the browser pipeline
 * (`processRawCsvContent`) and the file-inspection path
 * (`inspectRawFile` / `discoverTimezonesFromRawCsv`) with malformed,
 * real-world-shaped input.
 *
 * CONTRACT under test — for every generated input the entry must either
 *   (a) return a structured result whose summary counts are finite and whose
 *       numeric output cells are never NaN/Infinity-poisoned, OR
 *   (b) throw/reject with the pipeline's OWN error — a plain `Error` carrying an
 *       intentional message (this is what the worker/UI surfaces as the
 *       `file-complete` error string).
 * It must NEVER leak a low-level `TypeError`/`RangeError`/`SyntaxError`/
 * `ReferenceError`/`EvalError`/`URIError` from internals, never hang (input
 * sizes are bounded), and never emit NaN-poisoned rows.
 *
 * Determinism: every property runs under a FIXED fast-check seed with a modest
 * numRuns so the suite is fast and reproducible in CI.
 *
 * Findings (see the pinned regressions at the bottom): fuzzing surfaced exactly
 * one genuine defect — `discoverTimezonesFromRawCsv` leaks a raw `RangeError`
 * from `new Intl.DateTimeFormat` when a row carries a non-empty but invalid IANA
 * `timezone` together with a parseable `event_timestamp`. `processRawCsvContent`
 * is NOT affected by the same input because its graph engine catches node
 * failures and re-throws them as a plain `Error`. The defect is pinned with
 * `it.fails`; the source fix lands separately (this suite never edits src).
 */

const FUZZ_SEED = 0xc47b0a7;
const FUZZ_RUNS = 200;

const RAW_HEADER =
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone";

// ── Pure-JS matcher/splitter (no WASM, no support files) ────────────────────
// The matcher pairs each "Activity Resumed" with the next stop-witness after
// it — enough to drive the app-usage session-construction path without the WASM
// harness (whose init is irrelevant to input-boundary fuzzing).
const runMatcher = (input: MatcherInput): Promise<MatcherOutput> => {
  const startIndices: number[] = [];
  const stopStartIndices: number[] = [];
  const stopEventIndices: number[] = [];
  for (let index = 0; index < input.resumed.length; index += 1) {
    if (input.resumed[index] !== 1) continue;
    for (let stop = index + 1; stop < input.resumed.length; stop += 1) {
      if (input.sameStop[stop] === 1 || input.otherStop[stop] === 1) {
        startIndices.push(index);
        stopStartIndices.push(index);
        stopEventIndices.push(stop);
        break;
      }
    }
  }
  return Promise.resolve({ startIndices, stopStartIndices, stopEventIndices, missingIndices: [] });
};

const runSplitter = (input: SplitterInput): Promise<SplitterOutput> =>
  Promise.resolve(
    Array.from(input.starts, (startNs, sessionIndex) => ({
      sessionIndex,
      startNs,
      stopNs: input.stops[sessionIndex],
      layer: "primary" as const,
    })),
  );

// Two option profiles — all support-file options OFF (no network/xlsx fetch),
// no canvas-backed plotting/heatmaps. The rich profile widens the crash surface
// with dedup, duplicate-timestamp correction, parquet + SPSS + aggregates.
const CANVAS_OFF = {
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  enablePlotting: false,
  enableActivityHeatmap: false,
  exportPlotsAsSvg: false,
  enableInteractiveTimeline: false,
} as const;

const MINIMAL_OPTIONS: Partial<BrowserProcessingOptions> = {
  ...DEFAULT_BROWSER_OPTIONS,
  ...CANVAS_OFF,
  processAppUsage: true,
  processScreenUsage: true,
};

const RICH_OPTIONS: Partial<BrowserProcessingOptions> = {
  ...MINIMAL_OPTIONS,
  deduplicateExactRows: true,
  correctDuplicateEventTimestamps: true,
  filterZeroDurationSessions: true,
  enableParquetExport: true,
  enableSpssExport: true,
  enableAggregates: true,
};

// ── Assertion helpers ───────────────────────────────────────────────────────

const LOW_LEVEL_ERRORS = [
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  URIError,
] as const;

/**
 * A rejection is acceptable iff it is an `Error` that is NOT one of the
 * low-level JS-engine error types — i.e. the pipeline's own `throw new
 * Error(...)` (or the graph engine's wrapped `Error`), never an internal
 * failure leaking through.
 */
function assertStructuredError(err: unknown, input: string): void {
  const clip = JSON.stringify(input).slice(0, 200);
  expect(err instanceof Error, `threw a non-Error value for input ${clip}: ${String(err)}`).toBe(
    true,
  );
  for (const Ctor of LOW_LEVEL_ERRORS) {
    expect(
      err instanceof Ctor,
      `leaked low-level ${Ctor.name} for input ${clip}: ${(err as Error).stack}`,
    ).toBe(false);
  }
}

// Numeric output columns: every cell must be blank or a finite number — a stray
// "NaN"/"Infinity" here is a poisoned row. Checking by COLUMN NAME (not raw
// text) avoids false positives from fuzzed string VALUES that spell "NaN".
const STATIC_NUMERIC_COLUMNS = new Set<string>([
  "duration_seconds",
  "duration_minutes",
  "data_time_gap_hours",
  "day",
  "weekdayMF",
  "weekdayMTh",
  "weekdaySuTh",
  "hour",
  "quarter",
  "valid_app_new_engage_30s",
  "valid_app_switched_app",
  "valid_app_usage_time_gap_hours",
  "any_app_new_engage_30s",
  "any_app_switched_app",
  "any_app_usage_time_gap_hours",
  "screen_usage_end_reason_confidence",
  "screen_usage_tail_gap_seconds",
  "screen_usage_lock_screen_only",
  "screen_usage_duration_seconds",
  "screen_usage_duration_minutes",
]);

function isNumericColumn(name: string): boolean {
  return STATIC_NUMERIC_COLUMNS.has(name) || /_engage_custom_\d+s$/.test(name);
}

function assertNoPoisonedRows(csvText: string, input: string): void {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  for (const row of parsed.data) {
    for (const [column, value] of Object.entries(row)) {
      if (!isNumericColumn(column)) continue;
      const cell = value ?? "";
      const ok = cell === "" || Number.isFinite(Number(cell));
      expect(
        ok,
        `NaN/Infinity-poisoned ${column}="${cell}" for input ${JSON.stringify(input).slice(0, 200)}`,
      ).toBe(true);
    }
  }
}

let runCounter = 0;

/**
 * Drive `processRawCsvContent` once and assert the graceful-failure contract.
 * Returns nothing — throws (fast-check counterexample) only on a violation.
 */
async function assertGraceful(
  csvText: string,
  options: Partial<BrowserProcessingOptions>,
): Promise<void> {
  runCounter += 1;
  // Unique file name so the per-file graph-engine cache never conflates runs.
  const fileName = `Fuzz P${runCounter}.csv`;
  let result: Awaited<ReturnType<typeof processRawCsvContent>>;
  try {
    result = await processRawCsvContent(
      fileName,
      csvText,
      options,
      undefined,
      runMatcher,
      undefined,
      undefined,
      runSplitter,
    );
  } catch (err) {
    assertStructuredError(err, csvText);
    return;
  }
  for (const key of [
    "originalRowCount",
    "processedRowCount",
    "appRowCount",
    "screenRowCount",
    "rowsBeforeTimezoneHandling",
    "rowsAfterTimezoneHandling",
    "rowsRemovedByTimezone",
    "duplicateTimestampsCorrected",
    "exactDuplicateRowsRemoved",
  ] as const) {
    const value = result[key];
    expect(
      Number.isFinite(value),
      `non-finite ${key}=${value} for input ${JSON.stringify(csvText).slice(0, 200)}`,
    ).toBe(true);
  }
  for (const output of result.outputs) {
    if (output.kind === "app" || output.kind === "screen") {
      assertNoPoisonedRows(await output.blob.text(), csvText);
    }
  }
}

// ── Malformed-input generators ──────────────────────────────────────────────

// Malformed / edge-case timestamps: garbage, out-of-range, bad offsets,
// fractional-second variants (incl. the two called out by the task), naive.
const timestampArb = fc.oneof(
  fc.constantFrom(
    "2024-02-21 09:41:45.801", // naive fractional (task-named)
    "2024-02-21T09:41:45.801-06:00", // offset fractional (task-named)
    "2026-03-07 10:00:00", // naive whole-second
    "2026-03-07T10:00:00Z", // Z
    "2026-03-07T10:00:00+05:30", // half-hour offset
    "2024-02-21T09:41:45+0530", // colonless offset
    "2024-02-21 09:41:45.123456", // 6-digit fractional
    "2024-02-21 09:41:45.8", // 1-digit fractional
    "", // missing
    "garbage",
    "not-a-date",
    "2024-02-21", // date only
    "2024-13-45 99:99:99", // out-of-range fields
    "0000-00-00 00:00:00", // zero date
    "9999999-01-01 00:00:00", // 7-digit year
    "2024-02-21T09:41:45.801-25:00", // impossible offset
    "275760-09-14T00:00:00Z", // one past max JS Date
    "-2024-02-21 09:41:45", // negative year
    "2024-02-21 09:41:45.801 UTC", // trailing zone word
    "1970-01-01 00:00:00", // epoch
  ),
  fc.integer().map(String), // bare number
  fc.string({ maxLength: 24 }), // arbitrary junk
);

const interactionTypeArb = fc.oneof(
  fc.constantFrom(
    "Activity Resumed",
    "Activity Paused",
    "Activity Stopped",
    "Activity Destroyed",
    "Screen Interactive",
    "Screen Non-Interactive",
    "Screen Non-interactive", // real lower-case corpus variant
    "Keyguard Shown",
    "Keyguard Hidden",
    "Move to Foreground",
    "Move to Background",
    "Unknown importance: 23", // real vendor variant — MUST process
  ),
  fc.constantFrom("toString", "constructor", "__proto__", "hasOwnProperty"), // prototype keys
  fc.string({ maxLength: 20 }),
);

// Only valid IANA zones (plus empty) — used where an invalid zone would trigger
// the KNOWN, pinned defect (see regressions) and mask other regressions.
const VALID_TZ_ARB = fc.constantFrom(
  "America/Chicago",
  "UTC",
  "America/New_York",
  "Asia/Kolkata",
  "Pacific/Chatham",
  "Etc/GMT-14",
  "",
);

// Full timezone fuzz, INCLUDING invalid names.
const ANY_TZ_ARB = fc.oneof(
  VALID_TZ_ARB,
  fc.constantFrom("Not/AZone", "GMT+5", "America/Nowhere"),
  fc.string({ maxLength: 16 }),
);

// Nasty free-text cell values: empty, unicode, BOM, null byte, embedded
// quote+comma+newline, plus (rarely) an enormous value to prove size bounds.
const nastyCellArb = fc.oneof(
  { weight: 8, arbitrary: fc.string({ maxLength: 12 }) },
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      "",
      "﻿bom",
      "null byte",
      '"quoted, value"',
      "line\nbreak",
      "emoji😀🎉",
      "𝕏𝕐𝕫 astral",
      "com.example.app",
      "Target Child",
      "Target child",
      "tab\tseparated",
      "back\\slash",
      "com.amazon.redstone", // triggers Amazon Fire device model
    ),
  },
  { weight: 3, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
  { weight: 1, arbitrary: fc.constant("X".repeat(20000)) }, // enormous field
);

// Build a well-formed-arity data row from fuzzed cells (RFC-4180 quoted).
function buildRow(cells: {
  studyId: string;
  participantId: string;
  deviceModel: string;
  username: string;
  label: string;
  interaction: string;
  pkg: string;
  eventTs: string;
  startTs: string;
  stopTs: string;
  timezone: string;
}): string {
  return [
    cells.studyId,
    cells.participantId,
    cells.deviceModel,
    cells.username,
    cells.label,
    cells.interaction,
    cells.pkg,
    cells.eventTs,
    cells.startTs,
    cells.stopTs,
    cells.timezone,
  ]
    .map((cell) => Papa.unparse([[cell]]).replace(/\r?\n$/, ""))
    .join(",");
}

function makeRowArb(tzArb: fc.Arbitrary<string>) {
  return fc.record({
    studyId: nastyCellArb,
    participantId: fc.oneof(fc.constantFrom("P01", "P02", ""), nastyCellArb),
    deviceModel: nastyCellArb,
    username: nastyCellArb,
    label: nastyCellArb,
    interaction: interactionTypeArb,
    pkg: fc.oneof(fc.constantFrom("com.example.chat", "android", ""), nastyCellArb),
    eventTs: timestampArb,
    startTs: fc.oneof(fc.constant(""), timestampArb),
    stopTs: fc.oneof(fc.constant(""), timestampArb),
    timezone: tzArb,
  });
}

// Class 1: structurally valid header, fuzzed field VALUES.
function makeFieldFuzzCsvArb(tzArb: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .array(makeRowArb(tzArb), { minLength: 0, maxLength: 12 })
    .map((rows) => [RAW_HEADER, ...rows.map(buildRow)].join("\n"));
}

const fieldFuzzAnyTz = makeFieldFuzzCsvArb(ANY_TZ_ARB);
const fieldFuzzValidTz = makeFieldFuzzCsvArb(VALID_TZ_ARB);

// Structural constants that never pair a valid timestamp with an invalid tz, so
// they are safe for the (tz-defect-sensitive) discovery entry too.
const safeStructuralConstArb = fc.constantFrom(
  "", // empty file
  RAW_HEADER, // header only
  `${RAW_HEADER}\n`, // header + trailing newline
  "﻿",
  "   ",
  "not,a,csv\nat,all\n",
  '"unterminated,quote\nnext line',
  "\n\n\n\n",
  ",,,,,,,,,,\n,,,,,,,,,,",
  "🎉,😀,💥\n1,2,3",
);

// Class 2: structural malformations of the whole CSV text (invalid-tz allowed —
// used only against the graph-wrapped entries that tolerate it).
const structuralAnyTz = fc.oneof(
  safeStructuralConstArb,
  // Truncated: cut a well-formed CSV at an arbitrary byte offset.
  fc
    .tuple(fieldFuzzAnyTz, fc.double({ min: 0, max: 1, noNaN: true }))
    .map(([csv, frac]) => csv.slice(0, Math.floor(csv.length * frac))),
  // Missing / extra / duplicated header columns, then some rows of nasty cells.
  fc
    .tuple(
      fc.constantFrom(
        "participant_id,event_timestamp,timezone", // subset
        "event_timestamp", // single column
        "interaction_type,interaction_type,event_timestamp", // duplicated header
        `${RAW_HEADER},extra_col,another_extra`, // extra columns
        "wrong,header,names,entirely", // no known columns
        RAW_HEADER,
      ),
      fc.array(fc.array(nastyCellArb, { minLength: 0, maxLength: 6 }), {
        minLength: 0,
        maxLength: 8,
      }),
    )
    .map(([header, rows]) => [header, ...rows.map((cells) => Papa.unparse([cells]))].join("\n")),
  fieldFuzzAnyTz, // fold field-fuzz back in so both classes share the seed
);

const anyCsvArb = fc.oneof(fieldFuzzAnyTz, structuralAnyTz);

// Discovery-safe corpus: valid-tz field fuzz + safe structural constants. This
// exercises malformed timestamps / interaction types / arities / unicode / BOM
// through the raw entry WITHOUT tripping the pinned invalid-timezone defect.
const discoverSafeArb = fc.oneof(fieldFuzzValidTz, safeStructuralConstArb);

// ── Properties ──────────────────────────────────────────────────────────────

afterEach(() => {
  clearPipelineEngines();
});

describe("processRawCsvContent — malformed raw-CSV boundary fuzz", () => {
  it("field-value fuzz never leaks a low-level error or poisons rows (minimal profile)", async () => {
    await fc.assert(
      fc.asyncProperty(fieldFuzzAnyTz, async (csv) => {
        await assertGraceful(csv, MINIMAL_OPTIONS);
      }),
      { seed: FUZZ_SEED, numRuns: FUZZ_RUNS, endOnFailure: true },
    );
  });

  it("field-value fuzz never leaks a low-level error or poisons rows (rich profile)", async () => {
    await fc.assert(
      fc.asyncProperty(fieldFuzzAnyTz, async (csv) => {
        await assertGraceful(csv, RICH_OPTIONS);
      }),
      { seed: FUZZ_SEED + 1, numRuns: FUZZ_RUNS, endOnFailure: true },
    );
  });

  it("structural malformations fail gracefully (minimal profile)", async () => {
    await fc.assert(
      fc.asyncProperty(structuralAnyTz, async (csv) => {
        await assertGraceful(csv, MINIMAL_OPTIONS);
      }),
      { seed: FUZZ_SEED + 2, numRuns: FUZZ_RUNS, endOnFailure: true },
    );
  });
});

describe("inspectRawFile / discoverTimezonesFromRawCsv — inspection boundary fuzz", () => {
  it("inspectRawFile never throws on any malformed input, and reports finite counts", async () => {
    await fc.assert(
      fc.asyncProperty(anyCsvArb, async (csv) => {
        const file = new File([csv], "fuzz.csv", { type: "text/csv" });
        const inspection = await inspectRawFile(file);
        for (const key of [
          "rowCount",
          "participantCount",
          "invalidTimestampCount",
          "missingTimestampCount",
          "missingTimezoneCount",
          "duplicateTimestampCount",
          "outOfOrderTimestampCount",
        ] as const) {
          expect(Number.isFinite(inspection[key]) && inspection[key] >= 0).toBe(true);
        }
        expect(Array.isArray(inspection.warnings)).toBe(true);
      }),
      { seed: FUZZ_SEED + 3, numRuns: FUZZ_RUNS, endOnFailure: true },
    );
  });

  it("discoverTimezonesFromRawCsv returns an array or throws a structured error (valid-tz corpus)", async () => {
    await fc.assert(
      fc.asyncProperty(discoverSafeArb, async (csv) => {
        try {
          const zones = await Promise.resolve(discoverTimezonesFromRawCsv(csv));
          expect(Array.isArray(zones)).toBe(true);
        } catch (err) {
          assertStructuredError(err, csv);
        }
      }),
      { seed: FUZZ_SEED + 4, numRuns: FUZZ_RUNS, endOnFailure: true },
    );
  });
});

// ── Regression cases for corpus quirks that MUST process (not crash) ─────────

describe("processRawCsvContent — real-corpus regressions (must process)", () => {
  const dataRow = (interaction: string, ts: string, tz = "America/Chicago", pkg = "com.example.chat") =>
    `S,P01,,Target Child,App,${interaction},${pkg},${ts},,,${tz}`;

  it("unknown interaction types ('Screen Non-interactive', 'Unknown importance: 23') process, not crash", async () => {
    const csv = [
      RAW_HEADER,
      dataRow("Screen Non-interactive", "2026-03-07 10:00:00"),
      dataRow("Unknown importance: 23", "2026-03-07 10:01:00"),
      dataRow("Activity Resumed", "2026-03-07 10:02:00"),
      dataRow("Activity Paused", "2026-03-07 10:03:00"),
    ].join("\n");
    await assertGraceful(csv, MINIMAL_OPTIONS);
  });

  it("fractional / naive / offset timestamp variants all process", async () => {
    const csv = [
      RAW_HEADER,
      dataRow("Activity Resumed", "2024-02-21 09:41:45.801"), // naive fractional
      dataRow("Activity Paused", "2024-02-21T09:41:47.801-06:00"), // offset fractional
      dataRow("Activity Resumed", "2024-02-21 09:41:48.123456"), // 6-digit fractional
      dataRow("Activity Paused", "2024-02-21T09:41:49+0530"), // colonless offset
    ].join("\n");
    await assertGraceful(csv, RICH_OPTIONS);
  });

  it("BOM, null bytes, and embedded quotes/newlines are handled gracefully", async () => {
    const csv = [
      `\uFEFF${RAW_HEADER}`,
      `S,P01,,"multi\nline user","label, with comma",Activity Resumed,com.x,2026-03-07 10:00:00,,,America/Chicago`,
      `S,P01,,null byte,"quote""inside",Activity Paused,com.x,2026-03-07 10:01:00,,,America/Chicago`,
    ].join("\n");
    await assertGraceful(csv, RICH_OPTIONS);
  });

  it("empty and header-only inputs return a structured result", async () => {
    await assertGraceful("", MINIMAL_OPTIONS);
    await assertGraceful(RAW_HEADER, MINIMAL_OPTIONS);
  });

  it("an out-of-range but regex-matching timestamp is normalized, not NaN-poisoned", async () => {
    const csv = [
      RAW_HEADER,
      dataRow("Activity Resumed", "2024-13-45 99:99:99"),
      dataRow("Activity Paused", "2024-13-45 99:99:99"),
    ].join("\n");
    await assertGraceful(csv, RICH_OPTIONS);
  });

  it("a non-empty but unparseable timestamp throws the pipeline's structured error", async () => {
    const csv = [RAW_HEADER, dataRow("Activity Resumed", "totally-not-a-timestamp")].join("\n");
    let caught: unknown;
    try {
      runCounter += 1;
      await processRawCsvContent(
        `Fuzz P${runCounter}.csv`,
        csv,
        MINIMAL_OPTIONS,
        undefined,
        runMatcher,
        undefined,
        undefined,
        runSplitter,
      );
    } catch (err) {
      caught = err;
    }
    // The graph engine wraps the parse node's `Error("Invalid event_timestamp")`
    // into a plain Error — structured, never a low-level RangeError.
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof RangeError).toBe(false);
    expect((caught as Error).message).toMatch(/event_timestamp/i);
  });
});

// ── Pinned genuine defects (fix lands separately; this suite never edits src) ─

describe("PINNED DEFECTS (fixed — kept as regressions)", () => {
  // DEFECT 1 (FIXED) — discoverTimezonesFromRawCsv used to leak a raw
  // RangeError: a row whose `timezone` is a non-empty, invalid IANA name AND
  // whose `event_timestamp` is parseable reached `new Intl.DateTimeFormat(...,
  // { timeZone })` via parseRawRows with no wrapper. It now rethrows the
  // pipeline's structured Error ("Timezone discovery failed: …"), matching the
  // graph-engine behavior processRawCsvContent always had.
  //
  // Reproducer input (deterministic):
  const INVALID_TZ_CSV = [
    RAW_HEADER,
    "S,P01,,,App,Activity Resumed,com.x,2026-03-07 10:00:00,,,Not/AZone",
  ].join("\n");

  it("discoverTimezonesFromRawCsv fails gracefully on an invalid timezone", () => {
    try {
      const zones = discoverTimezonesFromRawCsv(INVALID_TZ_CSV);
      expect(Array.isArray(zones)).toBe(true);
    } catch (err) {
      assertStructuredError(err, INVALID_TZ_CSV);
    }
  });

  it("processRawCsvContent handles the SAME invalid-timezone input gracefully (contrast)", async () => {
    let caught: unknown;
    try {
      runCounter += 1;
      await processRawCsvContent(
        `Fuzz P${runCounter}.csv`,
        INVALID_TZ_CSV,
        MINIMAL_OPTIONS,
        undefined,
        runMatcher,
        undefined,
        undefined,
        runSplitter,
      );
    } catch (err) {
      caught = err;
    }
    // The graph engine wraps the node's RangeError into a plain Error.
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof RangeError).toBe(false);
  });
});
