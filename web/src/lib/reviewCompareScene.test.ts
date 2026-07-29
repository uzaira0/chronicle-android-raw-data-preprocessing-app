import { describe, expect, it } from "vitest";

import { WATERFALL_GEOMETRY } from "@/lib/plotGenerator";
import type { RectPrim, SceneRegion, TextPrim, WaterfallSceneMeta } from "@/lib/plotScene";
import type { TimelineParticipantView } from "@/lib/types";

import { buildComparisonWaterfallScene } from "@/lib/reviewCompareScene";

const GEO = WATERFALL_GEOMETRY;

// Mirrors the source's internal LAYOUT constants (padTop / laneAY), which are
// module-private. Kept here only to locate emitted geometry in assertions.
const LAYOUT_PAD_TOP = 26;
const LAYOUT_LANE_A_Y = 6;

/** A minimal single-arm view: only the row metadata and hover regions the
 * comparison builder reads (it ignores the source primitives entirely). */
function makeView(
  participantId: string,
  rows: Array<{ date: string; y: number; h: number }>,
  regions: SceneRegion[],
): TimelineParticipantView {
  const meta: WaterfallSceneMeta = {
    kind: "waterfall",
    gutter: GEO.gutter,
    plotWidth: GEO.plotWidth,
    rows,
  };
  return {
    participantId,
    scene: { width: GEO.width, height: 100, primitives: [], meta },
    regions,
  };
}

function sessionRegion(y: number, fill: string, title: string): SceneRegion {
  return { x: GEO.gutter + 100, y, w: 40, h: 20, fill, title, lines: ["pkg", "12.0 min"], kind: "session" };
}

const ROWS_AB = [
  { date: "2026-03-07", y: 6, h: 32 },
  { date: "2026-03-08", y: 38, h: 32 },
];

describe("buildComparisonWaterfallScene", () => {
  it("weaves both arms into one row per date with A/B-tagged regions", () => {
    const a = makeView("P01", ROWS_AB, [sessionRegion(10, "#aa0000", "App A")]);
    const b = makeView("P01", ROWS_AB, [sessionRegion(42, "#00aa00", "App B")]);

    const out = buildComparisonWaterfallScene(
      a,
      b,
      new Map([["2026-03-07", 30]]),
      new Map([["2026-03-08", 50]]),
    );

    expect(out.participantId).toBe("P01");
    const meta = out.scene.meta?.kind === "waterfall" ? out.scene.meta : undefined;
    expect(meta?.rows.map((r) => r.date)).toEqual(["2026-03-07", "2026-03-08"]);
    // One row per date, 58px apart.
    expect(meta!.rows[1].y - meta!.rows[0].y).toBe(58);

    const aSeg = out.regions.find((r) => r.title === "App A · A");
    const bSeg = out.regions.find((r) => r.title === "App B · B");
    expect(aSeg).toBeTruthy();
    expect(bSeg).toBeTruthy();
    // A session is in row 0's top lane; B session in row 1's lower lane.
    expect(aSeg!.y).toBeLessThan(bSeg!.y);
    // Time geometry (x/w) carries through unchanged.
    expect(aSeg!.x).toBe(GEO.gutter + 100);
    expect(aSeg!.w).toBe(40);
  });

  it("draws a Δ strip green when B exceeds A and red when it falls short", () => {
    const rows = [{ date: "2026-03-07", y: 6, h: 32 }];
    const a = makeView("P01", rows, []);
    const b = makeView("P01", rows, []);

    const up = buildComparisonWaterfallScene(a, b, new Map([["2026-03-07", 10]]), new Map([["2026-03-07", 40]]));
    const upRects = up.scene.primitives.filter((p): p is RectPrim => p.type === "rect");
    expect(upRects.some((p) => p.fill === "#178a4c")).toBe(true); // green, B > A
    expect(upRects.some((p) => p.fill === "#c43d38")).toBe(false);

    const down = buildComparisonWaterfallScene(a, b, new Map([["2026-03-07", 40]]), new Map([["2026-03-07", 10]]));
    const downRects = down.scene.primitives.filter((p): p is RectPrim => p.type === "rect");
    expect(downRects.some((p) => p.fill === "#c43d38")).toBe(true); // red, B < A

    // Every date gets a Δ hover region, even with no bar.
    const deltaRegion = up.regions.find((r) => r.title === "Δ usage (B − A)");
    expect(deltaRegion).toBeTruthy();
    expect(deltaRegion!.lines).toContain("Δ +30.0 min");
  });

  it("unions dates across both arms and the per-day metric maps", () => {
    const a = makeView("P01", [{ date: "2026-03-07", y: 6, h: 32 }], []);
    const b = makeView("P01", [{ date: "2026-03-09", y: 6, h: 32 }], []);
    const out = buildComparisonWaterfallScene(
      a,
      b,
      new Map(),
      new Map([["2026-03-08", 5]]),
    );
    const meta = out.scene.meta?.kind === "waterfall" ? out.scene.meta : undefined;
    expect(meta?.rows.map((r) => r.date)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("drops a region whose centerY lands outside every date row band", () => {
    // The binary search over row bands finds no containing row for a region far
    // below the last band, so that region is skipped rather than mis-assigned.
    const a = makeView("P01", ROWS_AB, [sessionRegion(500, "#aa0000", "Orphan")]);
    const b = makeView("P01", ROWS_AB, []);
    const out = buildComparisonWaterfallScene(a, b, new Map(), new Map());
    expect(out.regions.find((r) => r.title === "Orphan · A")).toBeUndefined();
  });

  it("renders device-event markers as thin lane ticks", () => {
    const rows = [{ date: "2026-03-07", y: 6, h: 32 }];
    const marker: SceneRegion = {
      x: GEO.gutter + 200,
      y: 12,
      w: 16,
      h: 20,
      fill: "red",
      title: "Device Shutdown",
      lines: ["10:00:00"],
      kind: "marker",
    };
    const a = makeView("P01", rows, [marker]);
    const b = makeView("P01", rows, []);
    const out = buildComparisonWaterfallScene(a, b, new Map(), new Map());
    const tick = out.regions.find((r) => r.title === "Device Shutdown · A");
    expect(tick).toBeTruthy();
    expect(tick!.kind).toBe("marker");
  });

  it("treats a view without waterfall meta as contributing no lane items or rows", () => {
    // A source view whose scene has no waterfall meta: laneItemsByDate short-
    // circuits (returns empty) and the date-union loop reads no rows from it.
    // Only the per-day metric maps then supply the dates.
    const noMeta: TimelineParticipantView = {
      participantId: "P01",
      scene: { width: GEO.width, height: 100, primitives: [], meta: undefined },
      regions: [sessionRegion(10, "#aa0000", "Ignored")],
    };
    const b = makeView("P01", [{ date: "2026-03-07", y: 6, h: 32 }], []);
    const out = buildComparisonWaterfallScene(noMeta, b, new Map([["2026-03-07", 5]]), new Map());
    const meta = out.scene.meta?.kind === "waterfall" ? out.scene.meta : undefined;
    // The no-meta arm's region is never assigned to a row.
    expect(out.regions.find((r) => r.title === "Ignored · A")).toBeUndefined();
    // The date still appears — sourced from B's rows / the per-day map, not A.
    expect(meta?.rows.map((r) => r.date)).toEqual(["2026-03-07"]);
  });

  it("assigns regions correctly when the binary search must descend left (≥3 rows)", () => {
    // Three rows so the binary search's first probe lands on the middle row and,
    // for a region in the top row, must take the centerY < r.y branch to go left.
    const rows = [
      { date: "2026-03-05", y: 6, h: 32 },
      { date: "2026-03-06", y: 38, h: 32 },
      { date: "2026-03-07", y: 70, h: 32 },
    ];
    // centerY = 10 + 20/2 = 20, which is inside row 0's [6, 38) band but below
    // the middle row 1's y (38), forcing the leftward descent.
    const a = makeView("P01", rows, [sessionRegion(10, "#aa0000", "TopRow")]);
    const b = makeView("P01", rows, []);
    const out = buildComparisonWaterfallScene(a, b, new Map(), new Map());
    const seg = out.regions.find((r) => r.title === "TopRow · A");
    expect(seg).toBeTruthy();
    // Placed in the FIRST comparison row's A lane (top of the scene).
    expect(seg!.y).toBe(LAYOUT_PAD_TOP + LAYOUT_LANE_A_Y);
  });

  it("defaults a region's kind to session and its fill to grey when both are absent", () => {
    const rows = [{ date: "2026-03-07", y: 6, h: 32 }];
    // No `kind` (→ defaults to "session") and no `fill` (→ "#888").
    const bare: SceneRegion = {
      x: GEO.gutter + 100,
      y: 10,
      w: 40,
      h: 20,
      title: "Bare",
      lines: ["pkg"],
    };
    const a = makeView("P01", rows, [bare]);
    const b = makeView("P01", rows, []);
    const out = buildComparisonWaterfallScene(a, b, new Map(), new Map());
    const seg = out.regions.find((r) => r.title === "Bare · A");
    expect(seg).toBeTruthy();
    expect(seg!.kind).toBe("session");
    expect(seg!.fill).toBe("#888");
  });

  it("skips a region whose kind is neither session nor marker (e.g. gap)", () => {
    const rows = [{ date: "2026-03-07", y: 6, h: 32 }];
    const gap: SceneRegion = {
      x: GEO.gutter + 100,
      y: 10,
      w: 40,
      h: 20,
      fill: "#ddd",
      title: "GapRegion",
      lines: [],
      kind: "gap",
    };
    const a = makeView("P01", rows, [gap]);
    const b = makeView("P01", rows, []);
    const out = buildComparisonWaterfallScene(a, b, new Map(), new Map());
    expect(out.regions.find((r) => r.title === "GapRegion · A")).toBeUndefined();
  });

  it("omits the weekday sublabel and uses the short-string default formatter for an unparseable date", () => {
    // A date key that Date can't parse → dayOfWeek returns "" → no DOW text is
    // emitted. It is also <5 chars, so the DEFAULT formatter returns it verbatim.
    const a = makeView("P01", [], []);
    const b = makeView("P01", [], []);
    const out = buildComparisonWaterfallScene(a, b, new Map([["bad", 5]]), new Map());
    const texts = out.scene.primitives.filter((p): p is TextPrim => p.type === "text");
    // The gutter still carries the (verbatim, unformatted) date label…
    expect(texts.some((t) => t.text === "bad")).toBe(true);
    // …but no weekday label is drawn for the unparseable date.
    const meta = out.scene.meta?.kind === "waterfall" ? out.scene.meta : undefined;
    const rowY = LAYOUT_PAD_TOP; // single row
    expect(texts.some((t) => t.y === rowY + 28)).toBe(false);
    expect(meta?.rows.map((r) => r.date)).toEqual(["bad"]);
  });

  it("formats a large Δ (|Δ| ≥ 100) with zero decimal places", () => {
    const rows = [{ date: "2026-03-07", y: 6, h: 32 }];
    const a = makeView("P01", rows, []);
    const b = makeView("P01", rows, []);
    // Δ = 150 (≥ 100) → the strip's magnitude label uses toFixed(0): "+150m".
    const out = buildComparisonWaterfallScene(a, b, new Map([["2026-03-07", 0]]), new Map([["2026-03-07", 150]]));
    const texts = out.scene.primitives.filter((p): p is TextPrim => p.type === "text");
    expect(texts.some((t) => t.text === "+150m")).toBe(true);
  });
});
