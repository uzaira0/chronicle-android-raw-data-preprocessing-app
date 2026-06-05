import { describe, expect, it } from "vitest";

import {
  buildHeatmapScene,
  buildScreenScene,
  buildTimelineScene,
  buildWaterfallScene,
  CATEGORY_COLORS,
} from "@/lib/plotGenerator";
import { renderSceneToSvg, type RectPrim, type SceneRegion } from "@/lib/plotScene";

// All timestamps in UTC so the scene geometry is deterministic across machines.
const at = (h: number, m = 0): bigint =>
  BigInt(Date.UTC(2026, 2, 7, h, m, 0)) * 1_000_000n;

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
    const gamesColor = CATEGORY_COLORS["Games"]!;
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

  it("the SVG of the scene carries the same bar colour (PNG/SVG share geometry)", () => {
    const scene = buildTimelineScene(...TL_ARGS([usage("Games", 10, 11)]));
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain(CATEGORY_COLORS["Games"]!);
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
          color: CATEGORY_COLORS["Games"]!,
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
    expect(rectsWithFill(scene.primitives, CATEGORY_COLORS["Games"]!).length).toBeGreaterThan(0);

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

  it("draws clean separator lines between day rows", () => {
    const scene = buildWaterfallScene(
      [
        {
          startNs: at(10),
          stopNs: at(11),
          color: CATEGORY_COLORS["Games"]!,
          title: "com.example.app",
          detail: ["Games", "60.0 min · App Usage"],
        },
        {
          startNs: BigInt(Date.UTC(2026, 2, 8, 10, 0, 0)) * 1_000_000n,
          stopNs: BigInt(Date.UTC(2026, 2, 8, 11, 0, 0)) * 1_000_000n,
          color: CATEGORY_COLORS["Education"]!,
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
          color: CATEGORY_COLORS["Games"]!,
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
});

describe("buildHeatmapScene", () => {
  it("returns a 1×1 empty scene when there is no usage", () => {
    const scene = buildHeatmapScene(
      "P01",
      [] as unknown as Parameters<typeof buildHeatmapScene>[1],
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
