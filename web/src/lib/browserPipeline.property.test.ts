/**
 * Property-based tests for browserPipeline.ts using fast-check.
 *
 * Most internal helpers are not exported, so properties are exercised through
 * the two public entry-points:
 *   - discoverTimezonesFromRawCsv
 *   - processRawCsvContent
 *
 * Where a behaviour can only be verified inside an internal (non-exported)
 * function we use thin wrappers built by calling the public surface with data
 * crafted by arbitraries and then asserting invariants on the observable
 * output.
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
  TIMEZONE_HANDLING_OPTIONS,
  INTERACTION_TYPES_TO_REMOVE_OPTIONS,
} from "@/lib/browserPipeline";
import type { MatcherInput, MatcherOutput } from "@/lib/types";

vi.mock("@/lib/plotGenerator", () => ({
  generateAllPlots: vi.fn().mockResolvedValue(new Map()),
  generateAllScreenPlots: vi.fn().mockResolvedValue(new Map()),
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A matcher that pairs every resumed event with the very next event. */
const passthroughMatcher = async (input: MatcherInput): Promise<MatcherOutput> => {
  const startIndices: number[] = [];
  const stopStartIndices: number[] = [];
  const stopEventIndices: number[] = [];
  const missingIndices: number[] = [];
  for (let i = 0; i < input.resumed.length; i++) {
    if (input.resumed[i] === 1) {
      if (i + 1 < input.timestampNs.length) {
        startIndices.push(i);
        stopStartIndices.push(i);
        stopEventIndices.push(i + 1);
      } else {
        missingIndices.push(i);
      }
    }
  }
  return { startIndices, stopStartIndices, stopEventIndices, missingIndices };
};

/** A matcher that returns all-missing (no matches found). */
const missingMatcher = async (input: MatcherInput): Promise<MatcherOutput> => {
  const missingIndices: number[] = [];
  for (let i = 0; i < input.resumed.length; i++) {
    if (input.resumed[i] === 1) missingIndices.push(i);
  }
  return { startIndices: [], stopStartIndices: [], stopEventIndices: [], missingIndices };
};

function csvBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/** Escape a single CSV cell value. */
function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Build a minimal Chronicle CSV string from the given rows. */
function buildCsvFromRows(rows: Array<Record<string, string>>): string {
  const header = "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
  const lines = rows.map((row) =>
    [
      row.study_id ?? "Study",
      row.participant_id ?? "P01",
      row.username ?? "Target Child",
      row.application_label ?? "Chat",
      row.interaction_type ?? "Unknown importance: 1",
      row.app_package_name ?? "com.example.chat",
      row.event_timestamp ?? "2026-01-01 00:00:00",
      row.timezone ?? "UTC",
    ].map(escapeCsvCell).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Base options used by most property tests (no network I/O). */
const BASE_OPTIONS = {
  ...DEFAULT_BROWSER_OPTIONS,
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useAppCodebook: false,
  processScreenUsage: false,
  processAppUsage: true,
  enablePlotting: false,
  correctDuplicateEventTimestamps: true,
  timezoneHandling: "primary-convert" as const,
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Valid IANA timezone strings for the test data. */
const timezoneArb = fc.constantFrom(
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
);

/** Valid ISO-8601-like timestamp strings (no offset — Chronicle-style). */
const chronicleTimestampArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(
    ([y, mo, d, h, mi, s]) =>
      `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
  );

/** Timestamps with explicit UTC offset (Z suffix). */
const isoTimestampWithOffsetArb = chronicleTimestampArb.map((ts) => `${ts.replace(" ", "T")}Z`);

/** Timestamps with explicit numeric offset. */
const isoTimestampWithNumericOffsetArb = fc
  .tuple(
    chronicleTimestampArb,
    fc.integer({ min: -12, max: 14 }),
    fc.constantFrom(0, 30),
  )
  .map(([ts, h, m]) => {
    const sign = h < 0 ? "-" : "+";
    const absH = Math.abs(h);
    return `${ts.replace(" ", "T")}${sign}${String(absH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

/** A basic pair of rows suitable for the simplest app-usage scenario. */
const rowPairArb = (timezone: string) =>
  fc.tuple(chronicleTimestampArb, fc.integer({ min: 60, max: 3600 })).map(
    ([startTs, durationSec]) => {
      // Produce a deterministic stop timestamp by parsing the start and adding seconds.
      const [datePart, timePart] = startTs.split(" ") as [string, string];
      const [y, mo, d] = datePart.split("-").map(Number) as [number, number, number];
      const [h, mi, s] = timePart.split(":").map(Number) as [number, number, number];
      const startMs = Date.UTC(y, mo - 1, d, h, mi, s);
      const stopDate = new Date(startMs + durationSec * 1000);
      const stopTs = stopDate.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
      return {
        start: { event_timestamp: startTs, interaction_type: "Unknown importance: 1", timezone },
        stop: { event_timestamp: stopTs, interaction_type: "Unknown importance: 2", timezone },
      };
    },
  );

// ---------------------------------------------------------------------------
// Property 1: discoverTimezonesFromRawCsv is idempotent w.r.t. result set
// Calling it twice on the same CSV produces the same sorted array.
// ---------------------------------------------------------------------------
describe("Property 1: discoverTimezonesFromRawCsv — deterministic and sorted", () => {
  it("returns a sorted, deduplicated array regardless of input timezone mix", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(chronicleTimestampArb, timezoneArb),
          { minLength: 1, maxLength: 20 },
        ),
        (pairs) => {
          const rows = pairs.map(([ts, tz], idx) => ({
            event_timestamp: ts,
            interaction_type: idx % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2",
            timezone: tz,
          }));
          const csv = buildCsvFromRows(rows);
          const result = discoverTimezonesFromRawCsv(csv);

          // Must be sorted lexicographically.
          for (let i = 1; i < result.length; i++) {
            expect(result[i]!.localeCompare(result[i - 1]!)).toBeGreaterThan(0);
          }

          // Must be a deduplicated subset of the input timezones.
          const inputSet = new Set<string>(pairs.map(([, tz]) => tz));
          result.forEach((tz) => expect(inputSet.has(tz)).toBe(true));

          // Calling it a second time gives the same result.
          expect(discoverTimezonesFromRawCsv(csv)).toEqual(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Timestamp parsing never produces NaN for valid ISO strings
// We verify this by checking that the event_timestamp column in the output
// is a properly formatted string (no "NaN" anywhere in it) for every valid
// Chronicle offset-less timestamp we can generate.
// ---------------------------------------------------------------------------
describe("Property 2: Timestamp parsing — no NaN for valid inputs", () => {
  it("offset-less Chronicle timestamps never produce NaN in output", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(chronicleTimestampArb, fc.integer({ min: 60, max: 7200 })),
        async ([startTs, durationSec]) => {
          const [datePart, timePart] = startTs.split(" ") as [string, string];
          const [y, mo, d] = datePart.split("-").map(Number) as [number, number, number];
          const [h, mi, s] = timePart.split(":").map(Number) as [number, number, number];
          const startMs = Date.UTC(y, mo - 1, d, h, mi, s);
          const stopDate = new Date(startMs + durationSec * 1000);
          const stopTs = stopDate.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

          const csv = buildCsvFromRows([
            { event_timestamp: startTs, interaction_type: "Unknown importance: 1", timezone: "UTC" },
            { event_timestamp: stopTs, interaction_type: "Unknown importance: 2", timezone: "UTC" },
          ]);

          const matcher = async (): Promise<MatcherOutput> => ({
            startIndices: [0],
            stopStartIndices: [0],
            stopEventIndices: [1],
            missingIndices: [],
          });

          const result = await processRawCsvContent("test.csv", csv, BASE_OPTIONS, {}, matcher);
          const outputCsv = result.outputs[0]?.blob
            ? await result.outputs[0].blob.text()
            : "";

          // The event_timestamp column must never contain "NaN".
          expect(outputCsv).not.toContain("NaN");
        },
      ),
      { numRuns: 80 },
    );
  });

  it("ISO timestamps with Z suffix never produce NaN in output", async () => {
    await fc.assert(
      fc.asyncProperty(isoTimestampWithOffsetArb, async (startTs) => {
        const startMs = Date.parse(startTs);
        if (Number.isNaN(startMs)) return; // skip unparseable (shouldn't happen)
        const stopTs = new Date(startMs + 120_000).toISOString();
        const csv = buildCsvFromRows([
          { event_timestamp: startTs, interaction_type: "Unknown importance: 1", timezone: "UTC" },
          { event_timestamp: stopTs, interaction_type: "Unknown importance: 2", timezone: "UTC" },
        ]);

        const matcher = async (): Promise<MatcherOutput> => ({
          startIndices: [0],
          stopStartIndices: [0],
          stopEventIndices: [1],
          missingIndices: [],
        });

        const result = await processRawCsvContent("test.csv", csv, BASE_OPTIONS, {}, matcher);
        const outputCsv = result.outputs[0]?.blob
          ? await result.outputs[0].blob.text()
          : "";

        expect(outputCsv).not.toContain("NaN");
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Filter operations never produce more rows than input
// After processing, the row count in the output cannot exceed the row count
// that was parsed from the input.
// ---------------------------------------------------------------------------
describe("Property 3: Row count never exceeds input after processing", () => {
  it("processedRowCount <= originalRowCount for any set of valid rows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            chronicleTimestampArb,
            fc.constantFrom(
              "Unknown importance: 1",
              "Unknown importance: 2",
              "Unknown importance: 15",
              "Unknown importance: 16",
            ),
          ),
          { minLength: 2, maxLength: 28 },
        ),
        async (pairs) => {
          // Always prepend one guaranteed Activity Resumed + Activity Paused pair so
          // that the pipeline never throws "No valid app usage data". We do this at a
          // fixed early timestamp so it sorts to the front.
          const guaranteedRows: Array<Record<string, string>> = [
            { event_timestamp: "2019-01-01 00:00:00", interaction_type: "Unknown importance: 1", timezone: "UTC" },
            { event_timestamp: "2019-01-01 00:01:00", interaction_type: "Unknown importance: 2", timezone: "UTC" },
          ];

          const extraRows = pairs.map(([ts, type]) => ({
            event_timestamp: ts,
            interaction_type: type,
            timezone: "UTC",
          }));

          const csv = buildCsvFromRows([...guaranteedRows, ...extraRows]);
          const result = await processRawCsvContent(
            "test.csv",
            csv,
            {
              ...BASE_OPTIONS,
              processScreenUsage: false,
              processAppUsage: true,
            },
            {},
            passthroughMatcher,
          );

          expect(result.processedRowCount).toBeLessThanOrEqual(result.originalRowCount);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: App usage gap detection produces non-negative durations
// Every App Usage row in the output must have duration_seconds >= 0 (or null).
// ---------------------------------------------------------------------------
describe("Property 4: App usage durations are non-negative", () => {
  it("no App Usage row has a negative duration_seconds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(chronicleTimestampArb, fc.integer({ min: 30, max: 7200 })),
          { minLength: 1, maxLength: 10 },
        ),
        async (pairs) => {
          // Build a series of resume/pause pairs.
          let cursor = Date.UTC(2026, 0, 1, 8, 0, 0);
          const rows: Array<Record<string, string>> = [];
          for (const [, durationSec] of pairs) {
            const startTs = new Date(cursor)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "")
              .slice(0, 19);
            cursor += 1000; // 1 second gap between events
            const stopTs = new Date(cursor + durationSec * 1000)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "")
              .slice(0, 19);
            cursor += durationSec * 1000 + 5000; // move cursor past stop + gap
            rows.push({ event_timestamp: startTs, interaction_type: "Unknown importance: 1", timezone: "UTC" });
            rows.push({ event_timestamp: stopTs, interaction_type: "Unknown importance: 2", timezone: "UTC" });
          }

          const csv = buildCsvFromRows(rows);
          const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
            const startIndices: number[] = [];
            const stopStartIndices: number[] = [];
            const stopEventIndices: number[] = [];
            for (let i = 0; i < input.resumed.length; i++) {
              if (input.resumed[i] === 1 && i + 1 < input.timestampNs.length) {
                startIndices.push(i);
                stopStartIndices.push(i);
                stopEventIndices.push(i + 1);
              }
            }
            return { startIndices, stopStartIndices, stopEventIndices, missingIndices: [] };
          };

          const result = await processRawCsvContent("test.csv", csv, BASE_OPTIONS, {}, matcher);
          const outputCsv = result.outputs[0]?.blob
            ? await result.outputs[0].blob.text()
            : "";

          // Parse duration_seconds column and assert non-negative.
          const lines = outputCsv.trim().split("\n");
          if (lines.length <= 1) return;
          const header = lines[0]!.split(",");
          const durIdx = header.indexOf("duration_seconds");
          if (durIdx < 0) return;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const durStr = cells[durIdx];
            if (!durStr || durStr === "") continue; // null durations are fine
            const dur = parseFloat(durStr);
            if (!Number.isNaN(dur)) {
              expect(dur).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: CSV escaping round-trip invariant
// csvEscape (internal) must produce output that PapaParse can round-trip.
// We verify through the pipeline: the output CSV, when re-parsed by a simple
// splitter, preserves string values that do NOT contain commas/quotes/newlines.
// For fields that do, they must be wrapped in double-quotes.
// ---------------------------------------------------------------------------
describe("Property 5: CSV escaping — special characters are wrapped", () => {
  it("app_package_name with commas/quotes in output is properly escaped", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate app package names that may contain CSV-special characters.
        // We avoid newlines in package names because they would break the raw
        // input CSV row structure before any escaping can help.
        fc.stringMatching(/^[A-Za-z0-9._\-,"'!]{1,40}$/),
        async (packageName) => {
          // Ensure packageName doesn't start/end with whitespace (PapaParse trims headers).
          const pkg = packageName.trim();
          if (!pkg) return; // skip degenerate whitespace-only strings

          const csv = buildCsvFromRows([
            {
              app_package_name: pkg,
              event_timestamp: "2026-01-01 10:00:00",
              interaction_type: "Unknown importance: 1",
              timezone: "UTC",
            },
            {
              app_package_name: pkg,
              event_timestamp: "2026-01-01 10:01:00",
              interaction_type: "Unknown importance: 2",
              timezone: "UTC",
            },
          ]);

          const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
            if (input.resumed.length < 2) {
              return { startIndices: [], stopStartIndices: [], stopEventIndices: [], missingIndices: [] };
            }
            return {
              startIndices: [0],
              stopStartIndices: [0],
              stopEventIndices: [1],
              missingIndices: [],
            };
          };

          // Should not throw.
          const result = await processRawCsvContent(
            "test.csv",
            csv,
            BASE_OPTIONS,
            {},
            matcher,
          );

          const outputCsv = result.outputs[0]?.blob
            ? await result.outputs[0].blob.text()
            : "";

          // If package name contains a comma or quote the field should be quoted in output.
          if (/[",\n]/.test(pkg)) {
            const escaped = `"${pkg.replaceAll('"', '""')}"`;
            expect(outputCsv).toContain(escaped);
          } else {
            expect(outputCsv).toContain(pkg);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Null/empty string handling — pipeline never throws for empty fields
// Any combination of empty optional fields must not cause the pipeline to
// throw (it may produce zero rows but must not crash).
// ---------------------------------------------------------------------------
describe("Property 6: Empty/null field tolerance", () => {
  it("empty optional fields do not throw", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          study_id: fc.constantFrom("", "Study", "  "),
          participant_id: fc.constantFrom("", "P01", "  "),
          username: fc.constantFrom("", "Target Child", "  "),
          application_label: fc.constantFrom("", "Chat", "  "),
          app_package_name: fc.constantFrom("", "com.example.app", "com.example.chat"),
        }),
        async (fields) => {
          const csv = buildCsvFromRows([
            {
              ...fields,
              event_timestamp: "2026-01-01 10:00:00",
              interaction_type: "Unknown importance: 1",
              timezone: "UTC",
            },
            {
              ...fields,
              event_timestamp: "2026-01-01 10:01:00",
              interaction_type: "Unknown importance: 2",
              timezone: "UTC",
            },
          ]);

          const matcher = async (): Promise<MatcherOutput> => ({
            startIndices: [0],
            stopStartIndices: [0],
            stopEventIndices: [1],
            missingIndices: [],
          });

          // Must not throw.
          await expect(
            processRawCsvContent("test.csv", csv, BASE_OPTIONS, {}, matcher),
          ).resolves.toBeDefined();
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Timezone handling — filtered rows <= input rows
// When using "selected-filter" or "primary-filter", rows can only decrease
// (or stay the same). They can never increase.
// ---------------------------------------------------------------------------
describe("Property 7: Timezone filtering never increases row count", () => {
  it("rowsAfterTimezoneHandling <= rowsBeforeTimezoneHandling for filter modes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(timezoneArb, { minLength: 2, maxLength: 15 }),
        fc.constantFrom("selected-filter", "primary-filter" as const),
        async (timezones, mode) => {
          const rows = timezones.map((tz, i) => ({
            event_timestamp: `2026-01-${String((i % 28) + 1).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00:00`,
            interaction_type: i % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2",
            timezone: tz,
          }));

          const csv = buildCsvFromRows(rows);

          // Disable app usage processing so that empty data after timezone filtering
          // does not throw "No valid app usage data". We are only testing the
          // timezone filter bookkeeping counters here.
          const result = await processRawCsvContent(
            "test.csv",
            csv,
            {
              ...BASE_OPTIONS,
              processAppUsage: false,
              processScreenUsage: false,
              timezoneHandling: mode,
              selectedTimezone: "UTC",
            },
            {},
            passthroughMatcher,
          );

          expect(result.rowsAfterTimezoneHandling).toBeLessThanOrEqual(
            result.rowsBeforeTimezoneHandling,
          );
          expect(result.rowsRemovedByTimezone).toBeGreaterThanOrEqual(0);
          expect(result.rowsRemovedByTimezone).toBe(
            result.rowsBeforeTimezoneHandling - result.rowsAfterTimezoneHandling,
          );
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: interactionTypesToRemove — removing types only decreases rows
// Configuring interactionTypesToRemove with a non-empty set can only reduce
// (or leave equal) the output row count versus not removing anything.
// ---------------------------------------------------------------------------
describe("Property 8: interactionTypesToRemove only reduces rows", () => {
  it("removing interaction types never produces more rows than removing nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(
          INTERACTION_TYPES_TO_REMOVE_OPTIONS.filter((t) => t !== "End of Usage Missing"),
          { minLength: 1, maxLength: 5 },
        ),
        async (typesToRemove) => {
          const csv = buildCsvFromRows([
            { event_timestamp: "2026-01-01 08:00:00", interaction_type: "Unknown importance: 1", timezone: "UTC" },
            { event_timestamp: "2026-01-01 08:01:00", interaction_type: "Unknown importance: 2", timezone: "UTC" },
            { event_timestamp: "2026-01-01 09:00:00", interaction_type: "Unknown importance: 15", timezone: "UTC" },
            { event_timestamp: "2026-01-01 09:05:00", interaction_type: "Unknown importance: 16", timezone: "UTC" },
          ]);

          const matcher = async (): Promise<MatcherOutput> => ({
            startIndices: [0],
            stopStartIndices: [0],
            stopEventIndices: [1],
            missingIndices: [],
          });

          const baseResult = await processRawCsvContent(
            "test.csv",
            csv,
            { ...BASE_OPTIONS, interactionTypesToRemove: [] },
            {},
            matcher,
          );
          const filteredResult = await processRawCsvContent(
            "test.csv",
            csv,
            { ...BASE_OPTIONS, interactionTypesToRemove: typesToRemove },
            {},
            matcher,
          );

          const baseRowCount = baseResult.appRowCount;
          const filteredRowCount = filteredResult.appRowCount;
          expect(filteredRowCount).toBeLessThanOrEqual(baseRowCount);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Output row count from pipeline with all-missing matcher
// When the matcher reports all resumed events as missing (no paired stop),
// rows get marked "End of Usage Missing" rather than "App Usage". The output
// row count should still be deterministic — no crash, and the app output
// blob must be present (possibly with 0 rows if they were all removed).
// ---------------------------------------------------------------------------
describe("Property 9: All-missing matcher produces stable output", () => {
  it("pipeline does not crash when all starts are missing stops", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(chronicleTimestampArb, { minLength: 2, maxLength: 10 }),
        async (timestamps) => {
          const sorted = [...timestamps].sort();
          const rows = sorted.map((ts, i) => ({
            event_timestamp: ts,
            interaction_type: i % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2",
            timezone: "UTC",
          }));

          const csv = buildCsvFromRows(rows);

          await expect(
            processRawCsvContent(
              "test.csv",
              csv,
              { ...BASE_OPTIONS, interactionTypesToRemove: [] },
              {},
              missingMatcher,
            ),
          ).resolves.toBeDefined();
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Duplicate timestamp correction is idempotent
// Running the pipeline with correctDuplicateEventTimestamps=true on a CSV
// that already has unique timestamps produces the same row count as with
// correctDuplicateEventTimestamps=false.
// ---------------------------------------------------------------------------
describe("Property 10: Duplicate timestamp correction is idempotent on unique timestamps", () => {
  it("unique-timestamp input: row count is same with or without correction", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: 0, max: 86399 }),
          { minLength: 2, maxLength: 20 },
        ).map((offsets) =>
          [...new Set(offsets)] // force uniqueness
            .sort((a, b) => a - b)
            .slice(0, 20),
        ).filter((offsets) => offsets.length >= 2),
        async (offsets) => {
          const base = Date.UTC(2026, 0, 1, 0, 0, 0);
          const rows = offsets.map((offsetSec, i) => ({
            event_timestamp: new Date(base + offsetSec * 1000)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "")
              .slice(0, 19),
            interaction_type: i % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2",
            timezone: "UTC",
          }));

          const csv = buildCsvFromRows(rows);

          const [resultWith, resultWithout] = await Promise.all([
            processRawCsvContent("test.csv", csv, { ...BASE_OPTIONS, correctDuplicateEventTimestamps: true }, {}, passthroughMatcher),
            processRawCsvContent("test.csv", csv, { ...BASE_OPTIONS, correctDuplicateEventTimestamps: false }, {}, passthroughMatcher),
          ]);

          // processedRowCount should be equal since there are no duplicates.
          expect(resultWith.processedRowCount).toBe(resultWithout.processedRowCount);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: Timezone handling — convert modes preserve row count
// When using "selected-convert" or "primary-convert", every row is kept
// (just time-column adjusted), so rowsAfterTimezoneHandling === rowsBeforeTimezoneHandling.
// ---------------------------------------------------------------------------
describe("Property 11: Timezone convert modes preserve row count", () => {
  it("rowsAfterTimezoneHandling === rowsBeforeTimezoneHandling for convert modes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(timezoneArb, { minLength: 1, maxLength: 15 }),
        fc.constantFrom("selected-convert", "primary-convert" as const),
        async (timezones, mode) => {
          const rows = timezones.map((tz, i) => ({
            event_timestamp: `2026-01-${String((i % 28) + 1).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00:00`,
            interaction_type: i % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2",
            timezone: tz,
          }));

          const csv = buildCsvFromRows(rows);
          const result = await processRawCsvContent(
            "test.csv",
            csv,
            {
              ...BASE_OPTIONS,
              timezoneHandling: mode,
              selectedTimezone: "UTC",
            },
            {},
            passthroughMatcher,
          );

          expect(result.rowsAfterTimezoneHandling).toBe(result.rowsBeforeTimezoneHandling);
          expect(result.rowsRemovedByTimezone).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: minimum duration filtering — filtered rows have no short sessions
// When minimumUsageDuration > 0, no App Usage row in the output should have
// duration_seconds set to a value below that threshold.
// ---------------------------------------------------------------------------
describe("Property 12: minimumUsageDuration threshold respected", () => {
  it("no duration_seconds value below threshold appears in output", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 300 }),
        fc.array(fc.integer({ min: 5, max: 600 }), { minLength: 2, maxLength: 10 }),
        async (threshold, durations) => {
          let cursor = Date.UTC(2026, 0, 1, 8, 0, 0);
          const rows: Array<Record<string, string>> = [];
          for (const dur of durations) {
            const startTs = new Date(cursor)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "")
              .slice(0, 19);
            const stopTs = new Date(cursor + dur * 1000)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "")
              .slice(0, 19);
            cursor += dur * 1000 + 60_000; // advance cursor
            rows.push({ event_timestamp: startTs, interaction_type: "Unknown importance: 1", timezone: "UTC" });
            rows.push({ event_timestamp: stopTs, interaction_type: "Unknown importance: 2", timezone: "UTC" });
          }

          const csv = buildCsvFromRows(rows);
          const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
            const startIndices: number[] = [];
            const stopStartIndices: number[] = [];
            const stopEventIndices: number[] = [];
            for (let i = 0; i < input.resumed.length; i++) {
              if (input.resumed[i] === 1 && i + 1 < input.timestampNs.length) {
                startIndices.push(i);
                stopStartIndices.push(i);
                stopEventIndices.push(i + 1);
              }
            }
            return { startIndices, stopStartIndices, stopEventIndices, missingIndices: [] };
          };

          const result = await processRawCsvContent(
            "test.csv",
            csv,
            {
              ...BASE_OPTIONS,
              minimumUsageDuration: threshold,
              filterZeroDurationSessions: false,
            },
            {},
            matcher,
          );

          const outputCsv = result.outputs[0]?.blob
            ? await result.outputs[0].blob.text()
            : "";

          const lines = outputCsv.trim().split("\n");
          if (lines.length <= 1) return;
          const header = lines[0]!.split(",");
          const durIdx = header.indexOf("duration_seconds");
          const typeIdx = header.indexOf("interaction_type");
          if (durIdx < 0 || typeIdx < 0) return;

          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const itype = cells[typeIdx]?.trim();
            const durStr = cells[durIdx]?.trim();
            if (itype !== "App Usage") continue;
            if (!durStr || durStr === "") continue; // null — acceptable
            const dur = parseFloat(durStr);
            if (!Number.isNaN(dur)) {
              // duration must be >= threshold OR be null/missing (handled above)
              expect(dur).toBeGreaterThanOrEqual(threshold);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
