import { describe, expect, it } from "vitest";

import {
  buildHeatmapScene,
  buildAppTimelineViews,
  buildScreenScene,
  buildTimelineScene,
  buildWaterfallScene,
  CATEGORY_COLORS,
} from "@/lib/plotGenerator";
import { renderSceneToSvg, type RectPrim, type SceneRegion } from "@/lib/plotScene";

/** Guarded lookup: every category named in these tests ships in CATEGORY_COLORS. */
function categoryColor(name: string): string {
  const color = CATEGORY_COLORS[name];
  if (color === undefined) throw new Error(`no CATEGORY_COLORS entry for ${name}`);
  return color;
}

// All timestamps in UTC so the scene geometry is deterministic across machines.
const at = (h: number, m = 0): bigint =>
  BigInt(Date.UTC(2026, 2, 7, h, m, 0)) * 1_000_000n;

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
};

function usage(category: string, startH: number, stopH: number): Row {
  return {
    date: "2026-03-07",
    start_timestamp_ns: at(startH),
    stop_timestamp_ns: at(stopH),
    event_timestamp_ns: at(startH),
    interaction_type: "App Usage",
    broad_app_category: category,
    app_package_name: "com.example.app",
  };
}

const TL_ARGS = (rows: Row[]) =>
  [
    "P01",
    rows as unknown as Parameters<typeof buildTimelineScene>[1],
    "UTC",
    { includeFilteredAppUsageInPlots: false },
    "1.0.0",
    "March 7, 2026",
  ] as const;

const rectsWithFill = (prims: { type: string }[], fill: string): RectPrim[] =>
  prims.filter((p): p is RectPrim => p.type === "rect" && (p as RectPrim).fill === fill);

describe("buildTimelineScene", () => {
  it("returns a 1×1 empty scene when there are no dated rows", () => {
    const scene = buildTimelineScene(...TL_ARGS([]));
    expect(scene).toEqual({ width: 1, height: 1, primitives: [] });
  });

  it("emits a category-coloured bar, a title, a border and a legend", () => {
    const scene = buildTimelineScene(...TL_ARGS([usage("Games", 10, 11)]));
    expect(scene.width).toBe(1800);

    // The session bar is filled with the Games category colour.
    const gamesColor = categoryColor("Games");
    expect(rectsWithFill(scene.primitives, gamesColor).length).toBeGreaterThan(0);

    // Stroke-only plot border (a rect with stroke and no fill).
    const border = scene.primitives.find(
      (p): p is RectPrim => p.type === "rect" && p.fill === undefined && p.stroke === "#ccc",
    );
    expect(border).toBeDefined();

    // Title + legend text.
    const texts = scene.primitives.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
    expect(texts).toContain("App Usage for P01 (Target Child Only)");
    expect(texts).toContain("App Categories");
    expect(texts).toContain("Time of Day (Hours)");
  });

  it("collects hover regions: bars carry exact start→stop times, gaps get a tooltip", () => {
    const regions: SceneRegion[] = [];
    // Session 10:00–11:00, then a >1h data gap from 11:00 to 14:00 (raw events).
    buildTimelineScene(...TL_ARGS([usage("Games", 10, 11)]), [at(10), at(11), at(14)], regions);

    const bar = regions.find((r) => r.title === "com.example.app");
    expect(bar).toBeDefined();
    // Existing category + duration·type lines, PLUS the new exact time range.
    expect(bar!.lines).toContain("Games");
    expect(bar!.lines.some((l) => l.includes("60.0 min · App Usage"))).toBe(true);
    expect(bar!.lines.some((l) => l.includes("2026-03-07 10:00:00 → 11:00:00"))).toBe(true);

    const gap = regions.find((r) => r.title === "Data gap");
    expect(gap).toBeDefined();
    expect(gap!.lines.some((l) => l.includes("No device events · 3.0 h"))).toBe(true);
    expect(gap!.lines.some((l) => l.includes("2026-03-07 11:00:00 → 14:00:00"))).toBe(true);

    // Bar region precedes the gap region so a bar wins the hover hit-test on overlap.
    expect(regions.indexOf(bar!)).toBeLessThan(regions.indexOf(gap!));
  });

  it("renders filtered usage events when plot settings include filtered usage", () => {
    const rows = [
      usage("Games", 10, 11),
      {
        ...usage("Education", 12, 13),
        interaction_type: "Filtered App Usage",
        app_package_name: "com.example.filtered",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: at(12, 15),
      },
    ] as unknown as Parameters<typeof buildTimelineScene>[1];
    const regions: SceneRegion[] = [];

    buildTimelineScene(
      "P01",
      rows,
      "UTC",
      { includeFilteredAppUsageInPlots: true },
      "1.0.0",
      "March 7, 2026",
      undefined,
      regions,
    );

    const filtered = regions.find((r) => r.title === "com.example.filtered");
    expect(filtered).toBeDefined();
    expect(filtered!.lines).toContain("Filtered App Usage event");
    expect(filtered!.lines).toContain("2026-03-07 12:15:00");
  });

  it("the SVG of the scene carries the same bar colour (PNG/SVG share geometry)", () => {
    const scene = buildTimelineScene(...TL_ARGS([usage("Games", 10, 11)]));
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain(categoryColor("Games"));
    expect(svg).toContain("Time of Day (Hours)");
  });
});

describe("buildScreenScene", () => {
  it("collects hover regions: screen bars carry start→stop times, gaps get a tooltip", () => {
    const regions: SceneRegion[] = [];
    const rows = [
      {
        date: "2026-03-07",
        start_timestamp_ns: at(10),
        stop_timestamp_ns: at(11),
        event_timestamp_ns: at(10),
        screen_usage_end_reason: "probable_manual_lock",
      },
    ] as unknown as Parameters<typeof buildScreenScene>[1];
    // Same session + >1h gap setup as the app test, so screen mirrors app.
    buildScreenScene("P01", rows, "UTC", "1.0.0", "March 7, 2026", [at(10), at(11), at(14)], regions);

    const bar = regions.find((r) => r.title === "Screen");
    expect(bar).toBeDefined();
    expect(bar!.lines).toContain("Probable manual lock");
    expect(bar!.lines.some((l) => l.includes("2026-03-07 10:00:00 → 11:00:00"))).toBe(true);

    const gap = regions.find((r) => r.title === "Data gap");
    expect(gap).toBeDefined();
    expect(gap!.lines.some((l) => l.includes("2026-03-07 11:00:00 → 14:00:00"))).toBe(true);

    expect(regions.indexOf(bar!)).toBeLessThan(regions.indexOf(gap!));
  });
});

describe("buildWaterfallScene", () => {
  it("builds a bare fit-width scene with bar and gap hover regions", () => {
    const regions: SceneRegion[] = [];
    const scene = buildWaterfallScene(
      [
        {
          startNs: at(10),
          stopNs: at(11),
          color: categoryColor("Games"),
          title: "com.example.app",
          detail: ["Games", "60.0 min · App Usage"],
        },
      ],
      [at(10), at(11), at(14)],
      "UTC",
      regions,
    );

    expect(scene.width).toBe(1200);
    expect(scene.height).toBeGreaterThan(1);
    expect(scene.meta).toMatchObject({
      kind: "waterfall",
      gutter: 112,
      plotWidth: 1088,
      rows: [{ date: "2026-03-07", y: 6, h: 32 }],
    });
    expect(rectsWithFill(scene.primitives, categoryColor("Games")).length).toBeGreaterThan(0);

    const texts = scene.primitives.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
    expect(texts).toContain("Sat, Mar 07, 2026");
    expect(texts).not.toContain("Time of Day (Hours)");
    expect(texts).not.toContain("App Categories");

    const separators = scene.primitives.filter(
      (p) => p.type === "line" && p.stroke === "#e4e7eb",
    );
    expect(separators.length).toBe(0);

    const bar = regions.find((r) => r.title === "com.example.app");
    expect(bar).toBeDefined();
    expect(bar!.lines).toContain("Games");
    expect(bar!.lines.some((l) => l.includes("2026-03-07 10:00:00 → 11:00:00"))).toBe(true);

    const gap = regions.find((r) => r.title === "Data gap");
    expect(gap).toBeDefined();
    expect(gap!.lines.some((l) => l.includes("No device events · 3.0 h"))).toBe(true);
    expect(gap!.lines.some((l) => l.includes("2026-03-07 11:00:00 → 14:00:00"))).toBe(true);
    expect(regions.indexOf(bar!)).toBeLessThan(regions.indexOf(gap!));
  });

  it("inserts contiguous date rows for skipped days so gaps span empty days", () => {
    const regions: SceneRegion[] = [];
    const scene = buildWaterfallScene(
      [
        {
          startNs: atDay(7, 10),
          stopNs: atDay(7, 11),
          color: categoryColor("Games"),
          title: "com.example.app",
          detail: ["Games", "60.0 min · App Usage"],
        },
      ],
      [atDay(7, 10), atDay(7, 11), atDay(10, 12)],
      "UTC",
      regions,
    );

    const dates = (scene.meta?.kind === "waterfall" ? scene.meta.rows.map((row) => row.date) : []);
    expect(dates).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(dates).toHaveLength(4);
    const gap = regions.find((r) => r.title === "Data gap");
    expect(gap).toBeDefined();
    expect(gap!.lines.some((l) => l.includes("2026-03-07 11:00:00 → 2026-03-10 12:00:00"))).toBe(
      true,
    );
  });

  it("draws clean separator lines between day rows", () => {
    const scene = buildWaterfallScene(
      [
        {
          startNs: at(10),
          stopNs: at(11),
          color: categoryColor("Games"),
          title: "com.example.app",
          detail: ["Games", "60.0 min · App Usage"],
        },
        {
          startNs: BigInt(Date.UTC(2026, 2, 8, 10, 0, 0)) * 1_000_000n,
          stopNs: BigInt(Date.UTC(2026, 2, 8, 11, 0, 0)) * 1_000_000n,
          color: categoryColor("Education"),
          title: "com.example.learn",
          detail: ["Education", "60.0 min · App Usage"],
        },
      ],
      [at(10), at(11), BigInt(Date.UTC(2026, 2, 8, 10, 0, 0)) * 1_000_000n],
      "UTC",
    );

    const separators = scene.primitives.filter(
      (p) => p.type === "line" && p.stroke === "#e4e7eb",
    );
    expect(separators).toHaveLength(1);
  });

  it("draws device event markers with hover regions", () => {
    const regions: SceneRegion[] = [];
    const scene = buildWaterfallScene(
      [
        {
          startNs: at(10),
          stopNs: at(11),
          color: categoryColor("Games"),
          title: "Chat",
          detail: ["com.example.chat", "Games", "60.0 min · App Usage"],
        },
      ],
      [at(9), at(10), at(11)],
      "UTC",
      regions,
      [{ ns: at(9), color: "red", title: "Device Shutdown" }],
    );

    expect(scene.primitives.some((p) => p.type === "poly" && p.fill === "red")).toBe(true);
    const marker = regions.find((r) => r.title === "Device Shutdown");
    expect(marker).toBeDefined();
    expect(marker!.lines).toContain("2026-03-07 09:00:00");
  });

  it("draws instant sessions without requiring a duration", () => {
    const regions: SceneRegion[] = [];
    const scene = buildWaterfallScene(
      [
        {
          startNs: at(10, 5),
          stopNs: at(10, 5),
          instant: true,
          color: categoryColor("Education"),
          title: "Filtered Reader",
          detail: ["com.example.filtered", "Education", "Filtered App Usage event"],
        },
      ],
      [at(10, 5)],
      "UTC",
      regions,
    );

    expect(rectsWithFill(scene.primitives, categoryColor("Education"))).toHaveLength(1);
    const instant = regions.find((r) => r.title === "Filtered Reader");
    expect(instant).toBeDefined();
    expect(instant!.w).toBe(1);
    expect(instant!.lines).toContain("Filtered App Usage event");
    expect(instant!.lines).toContain("2026-03-07 10:05:00");
  });
});

describe("buildAppTimelineViews", () => {
  it("can build included and excluded filtered usage variants after processing clears filtered timing", () => {
    const rows = [
      {
        ...usage("Games", 10, 11),
        participant_id: "P01",
      },
      {
        ...usage("Education", 12, 13),
        participant_id: "P01",
        interaction_type: "Filtered App Usage",
        app_package_name: "com.example.filtered",
        application_label: "Filtered Reader",
        start_timestamp_ns: null,
        stop_timestamp_ns: null,
        event_timestamp_ns: at(12, 15),
      },
    ] as unknown as Parameters<typeof buildAppTimelineViews>[0];

    const excluded = buildAppTimelineViews(
      rows,
      "UTC",
      { includeFilteredAppUsageInPlots: false },
      "1.0.0",
      undefined,
      false,
    );
    const included = buildAppTimelineViews(
      rows,
      "UTC",
      { includeFilteredAppUsageInPlots: false },
      "1.0.0",
      undefined,
      true,
    );

    const hasFilteredRegion = (views: typeof included): boolean =>
      views.some((view) =>
        view.regions.some((region) =>
          region.lines.some((line) => line.includes("Filtered App Usage")),
        ),
      );

    expect(hasFilteredRegion(excluded)).toBe(false);
    expect(hasFilteredRegion(included)).toBe(true);
  });
});

describe("buildHeatmapScene", () => {
  it("returns a 1×1 empty scene when there is no usage", () => {
    const scene = buildHeatmapScene(
      "P01",
      [],
      "UTC",
      { includeFilteredAppUsageInPlots: false },
      "1.0.0",
      "March 7, 2026",
    );
    expect(scene).toEqual({ width: 1, height: 1, primitives: [] });
  });

  it("emits 24 cell rects per date row plus the heatmap title", () => {
    const rows = [usage("Games", 10, 11)] as unknown as Parameters<typeof buildHeatmapScene>[1];
    const scene = buildHeatmapScene("P01", rows, "UTC", { includeFilteredAppUsageInPlots: false }, "1.0.0", "March 7, 2026");
    // 24 hour cells for the single date row (other rects: border + legend swatches).
    const cellRects = scene.primitives.filter(
      (p): p is RectPrim => p.type === "rect" && p.fill !== undefined && p.fill.startsWith("rgb("),
    );
    expect(cellRects.length).toBeGreaterThanOrEqual(24);
    const texts = scene.primitives.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
    expect(texts).toContain("P01 — Hourly Activity Heatmap");
  });
});
