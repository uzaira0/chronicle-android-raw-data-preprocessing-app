import { describe, expect, it } from "vitest";

import {
  buildHeatmapScene,
  buildTimelineScene,
  CATEGORY_COLORS,
} from "@/lib/plotGenerator";
import { renderSceneToSvg, type RectPrim } from "@/lib/plotScene";

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

  it("the SVG of the scene carries the same bar colour (PNG/SVG share geometry)", () => {
    const scene = buildTimelineScene(...TL_ARGS([usage("Games", 10, 11)]));
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain(CATEGORY_COLORS["Games"]!);
    expect(svg).toContain("Time of Day (Hours)");
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
