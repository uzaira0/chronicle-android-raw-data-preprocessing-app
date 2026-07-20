import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTimezoneHandling,
  buildCanonicalRows,
  DEFAULT_BROWSER_OPTIONS,
  resolveDefaultSupportFiles,
  unalignDuplicateTimestamps,
} from "@/lib/browserPipeline";
import type { RawChronicleRow } from "@/lib/types";

const NOW = "2026-04-24 00:32:53";

function rawRow(overrides: Partial<RawChronicleRow>): RawChronicleRow {
  return {
    study_id: "S",
    participant_id: "P01",
    username: "Target Child",
    application_label: "App",
    interaction_type: "Activity Resumed",
    app_package_name: "com.example.app",
    event_timestamp: "2026-03-02 10:00:00-06:00",
    timezone: "America/Chicago",
    ...overrides,
  };
}

describe("buildCanonicalRows timestamp parsing branches", () => {
  it("parses explicit-offset, offsetless, and regex-fallback timestamps", () => {
    const rows = buildCanonicalRows(
      [
        rawRow({ event_timestamp: "2026-03-02 10:00:00-06:00" }),
        rawRow({ event_timestamp: "2026-03-02T16:00:00Z" }),
        rawRow({ event_timestamp: "2026-03-02 16:00:00" }), // offsetless → wall-clock as UTC
        rawRow({ event_timestamp: "2026-03-02 16:00:00.5" }), // fractional pad branch
      ],
      NOW,
      "Android",
    );
    expect(rows[0].event_timestamp_ns).toBe(rows[1].event_timestamp_ns);
    expect(rows[2].event_timestamp_ns).toBe(rows[1].event_timestamp_ns);
    expect(rows[3].event_timestamp_ns - rows[2].event_timestamp_ns).toBe(500_000_000n);
  });

  it("throws loud, named errors on unparseable or missing timestamps", () => {
    expect(() =>
      buildCanonicalRows([rawRow({ event_timestamp: "not a time" })], NOW, "Android"),
    ).toThrow(/Invalid event_timestamp: not a time/);
    expect(() =>
      buildCanonicalRows([rawRow({ event_timestamp: "garbage+05:00" })], NOW, "Android"),
    ).toThrow(/Invalid event_timestamp/);
    expect(() =>
      buildCanonicalRows([rawRow({ event_timestamp: "   " })], NOW, "Android"),
    ).toThrow(/Missing event_timestamp/);
  });

  it("defaults a blank raw timezone to UTC", () => {
    const rows = buildCanonicalRows(
      [rawRow({ event_timestamp: "2026-03-02T16:00:00Z", timezone: "" })],
      NOW,
      "Android",
    );
    expect(rows[0].timezone).toBe("UTC");
    expect(rows[0].hour).toBe(16);
  });
});

describe("applyTimezoneHandling wrapper", () => {
  it("delegates to strategy + restamp and reports counts", () => {
    const rows = buildCanonicalRows(
      [
        rawRow({ event_timestamp: "2026-03-02 10:00:00-06:00" }),
        rawRow({ event_timestamp: "2026-03-02 11:00:00-05:00", timezone: "America/New_York" }),
      ],
      NOW,
      "Android",
    );
    const result = applyTimezoneHandling(rows, {
      ...DEFAULT_BROWSER_OPTIONS,
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-filter",
    });
    expect(result.timezone).toBe("America/Chicago");
    expect(result.rowsBefore).toBe(2);
    expect(result.rowsAfter).toBe(1);
    expect(result.rowsRemoved).toBe(1);
    expect(result.rows[0].timezone).toBe("America/Chicago");
  });
});

describe("unalignDuplicateTimestamps", () => {
  const T = 1_772_000_000_000_000_000n;

  function canonical(interaction: string, ns: bigint, index: number) {
    const [row] = buildCanonicalRows(
      [rawRow({ interaction_type: interaction, event_timestamp: "2026-03-02T16:00:00Z" })],
      NOW,
      "Android",
    );
    row.event_timestamp_ns = ns;
    row.__index = index;
    return row;
  }

  it("returns rows untouched when timestamps are already strictly increasing", () => {
    const rows = [canonical("Activity Resumed", T, 0), canonical("Activity Paused", T + 10n, 1)];
    const result = unalignDuplicateTimestamps(rows, DEFAULT_BROWSER_OPTIONS);
    expect(result.map((row) => row.event_timestamp_ns)).toEqual([T, T + 10n]);
  });

  it("spreads a duplicate group backwards with Resumed first and stop types last", () => {
    const stopType = DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt[0];
    const rows = [
      canonical(stopType, T, 0),
      canonical("Activity Resumed", T, 1),
      canonical("Notification Seen", T, 2),
    ];
    const result = unalignDuplicateTimestamps(rows, DEFAULT_BROWSER_OPTIONS);
    // All nudged strictly below T, unique, and ordered Resumed < other < stop.
    const byType = new Map(result.map((row) => [row.interaction_type, row.event_timestamp_ns]));
    const resumed = byType.get("Activity Resumed")!;
    const seen = byType.get("Notification Seen")!;
    const stop = byType.get(stopType)!;
    expect(new Set(result.map((row) => row.event_timestamp_ns)).size).toBe(3);
    expect(resumed).toBeLessThan(seen);
    expect(seen).toBeLessThan(stop);
    expect(stop).toBeLessThan(T);
    // Output is re-sorted by (timestamp, original index).
    expect(result.map((row) => row.event_timestamp_ns)).toEqual(
      [...result.map((row) => row.event_timestamp_ns)].sort((a, b) => (a < b ? -1 : 1)),
    );
  });

  it("normalizes the lowercase Screen Non-interactive spelling when ranking duplicates", () => {
    const rows = [
      canonical("Screen Non-interactive", T, 0),
      canonical("Activity Resumed", T, 1),
    ];
    const result = unalignDuplicateTimestamps(rows, {
      ...DEFAULT_BROWSER_OPTIONS,
      otherInteractionTypesToStopUsageAt: ["Screen Non-Interactive"],
    });
    const byType = new Map(result.map((row) => [row.interaction_type, row.event_timestamp_ns]));
    expect(byType.get("Activity Resumed")!).toBeLessThan(byType.get("Screen Non-interactive")!);
  });
});

describe("resolveDefaultSupportFiles (fetch stubbed)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches bundled defaults for enabled files and passes uploads through untouched", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetched.push(String(url));
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode("package_name\ncom.x").buffer),
        });
      }),
    );
    const upload = { name: "mine.csv", bytes: new ArrayBuffer(4) };
    const result = await resolveDefaultSupportFiles(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: true,
        useAppsForcingScreenOpenFile: true,
        useBackgroundAppsFile: true,
        useAppCodebook: true,
      },
      { filterFile: upload, studyDatesFile: upload },
    );
    // Uploaded filter file wins — only the other three are fetched.
    expect(result.filterFile).toBe(upload);
    expect(result.studyDatesFile).toBe(upload);
    expect(fetched).toHaveLength(3);
    expect(result.appsForcingScreenOpenFile?.bytes.byteLength).toBeGreaterThan(0);
    expect(result.appCodebookFile?.name).toBeTruthy();
    expect(result.backgroundAppsFile?.name).toBeTruthy();
  });

  it("throws a named error when a bundled asset fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    await expect(
      resolveDefaultSupportFiles({ ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true }, undefined),
    ).rejects.toThrow(/Failed to load bundled asset/);
  });
});
