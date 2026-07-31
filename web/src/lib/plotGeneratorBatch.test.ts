import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAppTimelineViews,
  buildHeatmapScene,
  buildScreenScene,
  buildScreenTimelineViews,
  buildTimelineScene,
  buildWaterfallScene,
  computeDataGapRects,
  computeHourDayMatrix,
  generateAllHeatmaps,
  generateAllHeatmapSvgs,
  generateAllPlots,
  generateAllPlotSvgs,
  generateAllScreenPlots,
  generateAllScreenPlotSvgs,
  type WaterfallMarker,
  type WaterfallSession,
} from "@/lib/plotGenerator";
import type { SceneRegion } from "@/lib/plotScene";

const atDay = (day: number, h: number, m = 0): bigint =>
  BigInt(Date.UTC(2026, 2, day, h, m, 0)) * 1_000_000n;

type Row = {
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  interaction_type: string;
  broad_app_category?: string | null;
  app_package_name: string;
  participant_id?: string;
  screen_usage_end_reason?: string | null;
};

function usage(date: string, startNs: bigint, stopNs: bigint, pid = "P01"): Row {
  return {
    date,
    start_timestamp_ns: startNs,
    stop_timestamp_ns: stopNs,
    event_timestamp_ns: startNs,
    interaction_type: "App Usage",
    broad_app_category: "Games",
    app_package_name: "com.example.app",
    participant_id: pid,
  };
}

function deviceEvent(type: string, ns: bigint): Row {
  return {
    date: "2026-03-07",
    start_timestamp_ns: null,
    stop_timestamp_ns: null,
    event_timestamp_ns: ns,
    interaction_type: type,
    app_package_name: "system",
    participant_id: "P01",
  };
}

/**
 * Three dated rows + one session spanning all three days: exercises every
 * bar-placement branch (same-day, starts-here, ends-here, runs-through) in
 * each scene builder that renders per-day rows.
 */
const SPANNING_ROWS: Row[] = [
  usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
  // Spans 2026-03-07 22:00 → 2026-03-09 02:00 (start row, full middle row, stop row).
  usage("2026-03-07", atDay(7, 22), atDay(9, 2)),
  usage("2026-03-08", atDay(8, 12), atDay(8, 13)),
  usage("2026-03-09", atDay(9, 12), atDay(9, 13)),
];

const OPTS = { includeFilteredAppUsageInPlots: false };

function sceneTexts(scene: { primitives: Array<{ type: string }> }): string[] {
  return scene.primitives
    .filter((p) => p.type === "text")
    .map((p) => (p as unknown as { text: string }).text);
}

describe("multi-day sessions and device events", () => {
  it("renders a spanning session across start/middle/stop day rows with separators", () => {
    const rows = [
      ...SPANNING_ROWS,
      deviceEvent("Device Shutdown", atDay(7, 20)),
      deviceEvent("Device Startup", atDay(7, 21)),
      deviceEvent("End of Usage Missing", atDay(7, 23)),
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const scene = buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "March 7, 2026");
    // Three date rows → two separator lines exist among the primitives.
    expect(scene.primitives.some((p) => p.type === "line")).toBe(true);
    // All three device-event legend entries were switched on.
    const texts = sceneTexts(scene);
    expect(texts).toContain("Device Shutdown");
    expect(texts).toContain("Device Startup");
    expect(texts).toContain("End of Usage Missing");
    // Arrow heads are polys.
    expect(scene.primitives.filter((p) => p.type === "poly").length).toBeGreaterThanOrEqual(3);
  });

  it("buildScreenScene places spanning bars on every covered day and returns empty for no rows", () => {
    expect(buildScreenScene("P01", [], "UTC", "1.0.0", "d")).toEqual({
      width: 1,
      height: 1,
      primitives: [],
    });
    const rows = SPANNING_ROWS.map((row) => ({
      ...row,
      screen_usage_end_reason: "probable_manual_lock",
    })) as unknown as Parameters<typeof buildScreenScene>[1];
    const scene = buildScreenScene("P01", rows, "UTC", "1.0.0", "March 7, 2026");
    expect(scene.width).toBeGreaterThan(1);
    expect(scene.primitives.filter((p) => p.type === "rect").length).toBeGreaterThanOrEqual(4);
  });

  it("buildWaterfallScene spreads a spanning session across day rows and draws markers", () => {
    const sessions: WaterfallSession[] = [
      {
        startNs: atDay(7, 10),
        stopNs: atDay(7, 11),
        color: "#123456",
        title: "same-day",
        detail: ["one hour"],
      },
      {
        startNs: atDay(7, 22),
        stopNs: atDay(9, 2),
        color: "#654321",
        title: "spanning",
        detail: ["two nights"],
      },
      {
        startNs: atDay(9, 12),
        stopNs: atDay(9, 12),
        instant: true,
        color: "#abcdef",
        title: "instant",
        detail: [],
      },
    ];
    const markers: WaterfallMarker[] = [
      { ns: atDay(8, 6), color: "red", title: "shutdown", detail: ["power"] },
    ];
    const regions: SceneRegion[] = [];
    const scene = buildWaterfallScene(sessions, [atDay(7, 10), atDay(9, 12)], "UTC", regions, markers);
    expect(scene.primitives.filter((p) => p.type === "rect").length).toBeGreaterThanOrEqual(4);
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(buildWaterfallScene([], [], "UTC")).toEqual({ width: 1, height: 1, primitives: [] });
  });

  it("buildHeatmapScene accumulates a spanning session into every covered day column", () => {
    const rows = SPANNING_ROWS as unknown as Parameters<typeof buildHeatmapScene>[1];
    const scene = buildHeatmapScene("P01", rows, "UTC", OPTS, "1.0.0", "March 7, 2026");
    expect(scene.primitives.filter((p) => p.type === "rect").length).toBeGreaterThan(24);
  });
});

describe("Intl fallback paths", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to UTC-ms arithmetic when formatToParts throws", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(() => {
      throw new Error("no ICU");
    });
    const regions: SceneRegion[] = [];
    const rows = SPANNING_ROWS as unknown as Parameters<typeof buildTimelineScene>[1];
    const scene = buildTimelineScene(
      "P01",
      rows,
      "UTC",
      OPTS,
      "1.0.0",
      "March 7, 2026",
      [atDay(7, 10)],
      regions,
    );
    expect(scene.primitives.length).toBeGreaterThan(0);
    const screen = buildScreenScene(
      "P01",
      SPANNING_ROWS.map((row) => ({ ...row, screen_usage_end_reason: "unknown" })),
      "UTC",
      "1.0.0",
      "d",
    );
    expect(screen.primitives.length).toBeGreaterThan(0);
    const waterfall = buildWaterfallScene(
      [{ startNs: atDay(7, 10), stopNs: atDay(7, 11), color: "#000", title: "t", detail: [] }],
      [],
      "UTC",
    );
    expect(waterfall.primitives.length).toBeGreaterThan(0);
    const heat = buildHeatmapScene(
      "P01",
      SPANNING_ROWS,
      "UTC",
      OPTS,
      "1.0.0",
      "d",
    );
    expect(heat.primitives.length).toBeGreaterThan(0);
  });
});

describe("batch entry points", () => {
  afterEach(() => vi.unstubAllGlobals());

  const TWO_PIDS = [
    ...SPANNING_ROWS,
    usage("2026-03-07", atDay(7, 14), atDay(7, 15), "P02"),
  ] as unknown as Parameters<typeof generateAllPlots>[0];

  it("SVG twins produce one vector blob per participant", async () => {
    const svgs = await generateAllPlotSvgs(TWO_PIDS, "UTC", OPTS, "1.0.0");
    expect([...svgs.keys()].sort()).toEqual(["P01", "P02"]);
    for (const blob of svgs.values()) expect(blob.type).toContain("svg");

    const screenSvgs = await generateAllScreenPlotSvgs(TWO_PIDS, "UTC", "1.0.0");
    expect(screenSvgs.size).toBe(2);
    const heatSvgs = await generateAllHeatmapSvgs(TWO_PIDS, "UTC", OPTS, "1.0.0");
    expect(heatSvgs.size).toBe(2);
  });

  it("PNG batches render through OffscreenCanvas when available", async () => {
    const noop = () => {};
    const ctx = new Proxy(
      { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "alphabetic" },
      {
        get(target, prop: string) {
          if (prop in target) return (target as Record<string, unknown>)[prop];
          return noop;
        },
        set(target, prop: string, value) {
          (target as Record<string, unknown>)[prop] = value;
          return true;
        },
      },
    );
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return ctx;
      }
      convertToBlob({ type }: { type: string }) {
        return Promise.resolve(new Blob(["png-bytes"], { type }));
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);

    const pngs = await generateAllPlots(TWO_PIDS, "UTC", OPTS, "1.0.0", new Map([["P01", [atDay(7, 10)]]]));
    expect(pngs.size).toBe(2);
    for (const blob of pngs.values()) expect(blob.type).toBe("image/png");

    const screenPngs = await generateAllScreenPlots(TWO_PIDS, "UTC", "1.0.0");
    expect(screenPngs.size).toBe(2);
    const heatPngs = await generateAllHeatmaps(TWO_PIDS, "UTC", OPTS, "1.0.0");
    expect(heatPngs.size).toBe(2);
  });
});

// ── Direct helpers for computeDataGapRects (UTC arithmetic, no layout imports) ──
const GAP_DAY_NS = 86_400_000_000_000n;
const gapIso = (ns: bigint): string => new Date(Number(ns / 1_000_000n)).toISOString().slice(0, 10);
const gapHours = (ns: bigint): number =>
  Number(((ns % GAP_DAY_NS) + GAP_DAY_NS) % GAP_DAY_NS) / 3_600_000_000_000;
const gapClock = (ns: bigint): string => new Date(Number(ns / 1_000_000n)).toISOString().slice(11, 19);

describe("computeDataGapRects multi-day paths", () => {
  it("tiles a multi-day gap and dates both ends of every band's tooltip", () => {
    const dateToY = new Map<string, number>([
      ["2026-03-07", 100],
      ["2026-03-08", 200],
      ["2026-03-09", 300],
    ]);
    const regions: SceneRegion[] = [];
    const { rects, hadGap } = computeDataGapRects(
      [atDay(7, 22), atDay(9, 2)],
      dateToY,
      gapHours,
      gapIso,
      regions,
      gapClock,
    );
    expect(hadGap).toBe(true);
    // tail of 03-07, the full 03-08, head of 03-09.
    expect(rects).toHaveLength(3);
    expect(regions).toHaveLength(3);
    expect(regions.every((r) => r.title === "Data gap")).toBe(true);
    // Multi-day range dates BOTH ends (the else arm of the range ternary).
    expect(regions[0]?.lines[1]).toBe("2026-03-07 22:00:00 → 2026-03-09 02:00:00");
  });

  it("still reports a multi-day gap when none of its day rows are mapped", () => {
    const { rects, hadGap } = computeDataGapRects(
      [atDay(7, 22), atDay(9, 2)],
      new Map<string, number>(),
      gapHours,
      gapIso,
    );
    // hadGap stays true (legend needed) but the unmapped tail/middle/head emit nothing.
    expect(hadGap).toBe(true);
    expect(rects).toHaveLength(0);
  });
});

describe("buildTimelineScene edge cases", () => {
  it("skips null-timestamp app rows, unmapped device events, and fills unknown categories", () => {
    const rows = [
      usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
      { ...usage("2026-03-07", atDay(7, 12), atDay(7, 13)), broad_app_category: null }, // null cat → "Unknown"
      { ...usage("2026-03-07", atDay(7, 14), atDay(7, 15)), broad_app_category: "Nonexistent Category" }, // → Uncategorised
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 16),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
        participant_id: "P01",
      }, // App Usage with null timings → skipped
      {
        date: "",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 20),
        interaction_type: "Device Shutdown",
        app_package_name: "system",
        participant_id: "P01",
      }, // blank date → not seeded, device-event lookup misses → skipped
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const scene = buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "d");
    // Plot-area bars only (x < 1540) so the always-present legend swatches for
    // these categories don't make the assertion tautological.
    const plotBar = (fill: string): boolean =>
      scene.primitives.some(
        (p) => p.type === "rect" && (p as { fill?: string }).fill === fill && (p as { x: number }).x < 1540,
      );
    expect(plotBar("#222222")).toBe(true); // Uncategorised, for the unknown category
    expect(plotBar("#555555")).toBe(true); // "Unknown", for the null category
  });

  it("drops session day-slices with no mapped row and non-positive-width bars", () => {
    const rows = [
      // Spans 03-20 22:00 → 03-22 02:00 but only 03-20 is a dated row: the
      // post-midnight slices land on unmapped days and are dropped.
      {
        date: "2026-03-20",
        start_timestamp_ns: atDay(20, 22),
        stop_timestamp_ns: atDay(22, 2),
        event_timestamp_ns: atDay(20, 22),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
        participant_id: "P01",
      },
      // Same-day session whose stop precedes its start → non-positive width, skipped.
      {
        date: "2026-03-20",
        start_timestamp_ns: atDay(20, 11),
        stop_timestamp_ns: atDay(20, 10),
        event_timestamp_ns: atDay(20, 11),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const scene = buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "d");
    // Plot-area bars only (x < the legend gutter at 1540), excluding the legend swatch.
    const gamesBars = scene.primitives.filter(
      (p) => p.type === "rect" && (p as { fill?: string }).fill === "#e6194b" && (p as { x: number }).x < 1540,
    );
    // Only the start-day slice of the spanning row survives; the reversed
    // same-day session (non-positive width) contributes no bar.
    expect(gamesBars).toHaveLength(1);
  });

  it("filtered ticks fall back to the row date, label blanks, and drop unmapped rows", () => {
    const FILTERED = "Filtered App Usage";
    const optsInc = { includeFilteredAppUsageInPlots: true };
    const rowsA = [
      usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(9, 12), // event on an UNMAPPED day → falls back to row.date
        interaction_type: FILTERED,
        broad_app_category: null, // null category → "Unknown" tooltip line
        app_package_name: "", // blank package → "(app)" title
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const regions: SceneRegion[] = [];
    buildTimelineScene("P01", rowsA, "UTC", optsInc, "1.0.0", "d", undefined, regions);
    const tick = regions.find((r) => r.title === "(app)");
    expect(tick).toBeDefined();
    expect(tick!.lines).toContain("Unknown");
    expect(tick!.lines).toContain("Filtered App Usage event");

    // A filtered tick WITHOUT a regions sink still draws; a filtered row whose
    // event AND row date are both unmapped is dropped entirely.
    const rowsB = [
      usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 12),
        interaction_type: FILTERED,
        broad_app_category: "Games",
        app_package_name: "com.filtered",
        participant_id: "P01",
      },
      {
        date: "",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(30, 5), // unmapped event + blank date → dropped
        interaction_type: FILTERED,
        broad_app_category: "Games",
        app_package_name: "com.dropped",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const scene = buildTimelineScene("P01", rowsB, "UTC", optsInc, "1.0.0", "d");
    expect(scene.primitives.length).toBeGreaterThan(0);
  });

  it("session hover regions label blank packages and null categories", () => {
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 10),
        stop_timestamp_ns: atDay(7, 11),
        event_timestamp_ns: atDay(7, 10),
        interaction_type: "App Usage",
        broad_app_category: null, // null category → "Unknown" tooltip line
        app_package_name: "", // blank package → "(app)" region title
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const regions: SceneRegion[] = [];
    buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "d", undefined, regions);
    const region = regions.find((r) => r.title === "(app)" && r.lines.some((l) => l.includes("· App Usage")));
    expect(region).toBeDefined();
    expect(region!.lines).toContain("Unknown");
  });

  it("sorts unsorted pre-algorithm event timestamps for gap detection", () => {
    const rows = [usage("2026-03-07", atDay(7, 10), atDay(7, 11))] as unknown as Parameters<
      typeof buildTimelineScene
    >[1];
    // Descending pair + a duplicate exercises both comparator ternary arms.
    const unsorted = [atDay(7, 14), atDay(7, 10), atDay(7, 10), atDay(7, 2)];
    const scene = buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "d", unsorted);
    expect(scene.primitives.length).toBeGreaterThan(0);
  });
});

describe("buildScreenScene edge cases", () => {
  it("handles blank dates, null/reversed sessions, and unknown end reasons", () => {
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 10),
        stop_timestamp_ns: atDay(7, 11),
        event_timestamp_ns: atDay(7, 10),
        screen_usage_end_reason: "bogus_reason", // unknown reason → grey fallback colour + raw label
        participant_id: "P01",
      },
      {
        date: "", // blank date → not seeded (session still lands via its 03-07 timestamps)
        start_timestamp_ns: atDay(7, 12),
        stop_timestamp_ns: atDay(7, 13),
        event_timestamp_ns: atDay(7, 12),
        screen_usage_end_reason: "probable_manual_lock",
        participant_id: "P01",
      },
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 14),
        screen_usage_end_reason: null, // null timings → skipped
        participant_id: "P01",
      },
      {
        date: "2026-03-20",
        start_timestamp_ns: atDay(20, 22),
        stop_timestamp_ns: atDay(22, 2), // spans onto unmapped days → those slices dropped
        event_timestamp_ns: atDay(20, 22),
        screen_usage_end_reason: "probable_auto_lock",
        participant_id: "P01",
      },
      {
        date: "2026-03-20",
        start_timestamp_ns: atDay(20, 11),
        stop_timestamp_ns: atDay(20, 10), // stop before start → non-positive width, skipped
        event_timestamp_ns: atDay(20, 11),
        screen_usage_end_reason: "probable_auto_lock",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildScreenScene>[1];
    const regions: SceneRegion[] = [];
    const scene = buildScreenScene("P01", rows, "UTC", "1.0.0", "d", undefined, regions);
    // Unknown reason → the "unknown" grey colour, on an actual plot bar (x < 1540)
    // rather than the always-present legend swatch.
    expect(
      scene.primitives.some(
        (p) => p.type === "rect" && (p as { fill?: string }).fill === "#9E9E9E" && (p as { x: number }).x < 1540,
      ),
    ).toBe(true);
    // ...and the raw reason string as its tooltip label.
    expect(regions.some((r) => r.lines.includes("bogus_reason"))).toBe(true);
  });

  it("sorts unsorted screen pre-algorithm timestamps", () => {
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 10),
        stop_timestamp_ns: atDay(7, 11),
        event_timestamp_ns: atDay(7, 10),
        screen_usage_end_reason: "unknown",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildScreenScene>[1];
    const scene = buildScreenScene("P01", rows, "UTC", "1.0.0", "d", [
      atDay(7, 14),
      atDay(7, 10),
      atDay(7, 10),
      atDay(7, 2),
    ]);
    expect(scene.primitives.length).toBeGreaterThan(0);
  });
});

describe("buildWaterfallScene edge cases", () => {
  it("sorts unsorted events and draws markers without a regions sink", () => {
    const sessions: WaterfallSession[] = [
      { startNs: atDay(7, 10), stopNs: atDay(7, 11), color: "#123456", title: "s", detail: [] },
    ];
    const markers: WaterfallMarker[] = [
      { ns: atDay(7, 9), color: "red", title: "shutdown", detail: ["power"] },
    ];
    // Unsorted events exercise the sort comparator; omitting regionsOut (arg 4)
    // exercises the marker path with no hover sink.
    const scene = buildWaterfallScene(
      sessions,
      [atDay(7, 14), atDay(7, 10), atDay(7, 10), atDay(7, 2)],
      "UTC",
      undefined,
      markers,
    );
    expect(scene.primitives.some((p) => p.type === "poly" && (p as { fill?: string }).fill === "red")).toBe(true);
  });
});

describe("buildAppTimelineViews edge cases", () => {
  it("builds a marker per device-event type and handles unknown/label-less usage", () => {
    const rows = [
      {
        ...usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
        broad_app_category: "Nonexistent", // no colour + no application_label field
      },
      {
        ...usage("2026-03-07", atDay(7, 15), atDay(7, 16)),
        app_package_name: "", // blank package + no label → "(app)" session title
      },
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 12),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
        participant_id: "P01",
      }, // App Usage with null timings → skipped in the views loop
      deviceEvent("Device Shutdown", atDay(7, 8)), // → red
      deviceEvent("Device Startup", atDay(7, 9)), // → green
      deviceEvent("End of Usage Missing", atDay(7, 13)), // → #888
    ] as unknown as Parameters<typeof buildAppTimelineViews>[0];
    const views = buildAppTimelineViews(rows, "UTC", OPTS, "1.0.0");
    expect(views).toHaveLength(1);
    const polyFills = views[0]?.scene.primitives
      .filter((p) => p.type === "poly")
      .map((p) => (p as { fill?: string }).fill);
    expect(polyFills).toEqual(expect.arrayContaining(["red", "green", "#888"]));
    // Unknown category → Uncategorised colour for the session bar.
    expect(views[0]?.scene.primitives.some((p) => p.type === "rect" && (p as { fill?: string }).fill === "#222222")).toBe(true);
    // Blank-package session falls back to the "(app)" title.
    expect(views[0]?.regions.some((r) => r.title === "(app)")).toBe(true);
  });
});

describe("buildScreenTimelineViews edge cases", () => {
  it("falls back for null and unknown end reasons and skips null-timing rows", () => {
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 10),
        stop_timestamp_ns: atDay(7, 11),
        event_timestamp_ns: atDay(7, 10),
        screen_usage_end_reason: null, // → "unknown" → "Unknown" label
        participant_id: "P01",
      },
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 12),
        stop_timestamp_ns: atDay(7, 13),
        event_timestamp_ns: atDay(7, 12),
        screen_usage_end_reason: "bogus_reason", // unknown → grey colour + raw label
        participant_id: "P01",
      },
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 14),
        screen_usage_end_reason: "unknown",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof buildScreenTimelineViews>[0];
    const views = buildScreenTimelineViews(rows, "UTC", "1.0.0");
    expect(views).toHaveLength(1);
    const regionLines = views[0]?.regions.flatMap((r) => r.lines);
    expect(regionLines).toContain("Unknown");
    expect(regionLines).toContain("bogus_reason");
    expect(views[0]?.scene.primitives.some((p) => p.type === "rect" && (p as { fill?: string }).fill === "#9E9E9E")).toBe(true);
  });
});

describe("computeHourDayMatrix and groupByParticipant edge cases", () => {
  it("computeHourDayMatrix ignores rows without a start/stop timestamp", () => {
    const rows = [
      usage("2026-03-07", atDay(7, 10), atDay(7, 11)),
      {
        date: "2026-03-07",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: atDay(7, 12),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
        participant_id: "P01",
      },
    ] as unknown as Parameters<typeof computeHourDayMatrix>[0];
    const m = computeHourDayMatrix(rows, "UTC");
    expect(m.dates).toEqual(["2026-03-07"]);
    expect(m.maxCell).toBeGreaterThan(0);
  });

  it("buckets rows without a participant_id under 'unknown'", async () => {
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: atDay(7, 10),
        stop_timestamp_ns: atDay(7, 11),
        event_timestamp_ns: atDay(7, 10),
        interaction_type: "App Usage",
        broad_app_category: "Games",
        app_package_name: "com.example.app",
      },
    ] as unknown as Parameters<typeof generateAllHeatmapSvgs>[0];
    const svgs = await generateAllHeatmapSvgs(rows, "UTC", OPTS, "1.0.0");
    expect([...svgs.keys()]).toEqual(["unknown"]);
  });
});

describe("Intl empty-parts fallbacks (no throw)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses default clock/hour fields when formatToParts returns no parts", () => {
    // formatToParts returning an empty array (rather than throwing) drives every
    // `.find(...)?.value ?? default` arm across the ns→clock / ns→hours helpers.
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([] as never);

    const rows = SPANNING_ROWS as unknown as Parameters<typeof buildTimelineScene>[1];
    const regions: SceneRegion[] = [];
    const tl = buildTimelineScene("P01", rows, "UTC", OPTS, "1.0.0", "d", [atDay(7, 10), atDay(9, 12)], regions);
    expect(tl.primitives.length).toBeGreaterThan(0);
    expect(regions.length).toBeGreaterThan(0);

    const screenRows = SPANNING_ROWS.map((row) => ({ ...row, screen_usage_end_reason: "unknown" })) as never;
    const screenRegions: SceneRegion[] = [];
    buildScreenScene("P01", screenRows, "UTC", "1.0.0", "d", [atDay(7, 10), atDay(9, 12)], screenRegions);

    const wfRegions: SceneRegion[] = [];
    buildWaterfallScene(
      [{ startNs: atDay(7, 10), stopNs: atDay(9, 2), color: "#000", title: "t", detail: [] }],
      [atDay(7, 10), atDay(9, 12)],
      "UTC",
      wfRegions,
      [{ ns: atDay(8, 6), color: "red", title: "m" }],
    );

    const m = computeHourDayMatrix(rows, "UTC");
    expect(m.dates.length).toBeGreaterThan(0);
  });
});
