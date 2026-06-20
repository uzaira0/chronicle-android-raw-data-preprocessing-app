import { describe, expect, it } from "vitest";

import { WATERFALL_GEOMETRY } from "@/lib/plotGenerator";
import type { RectPrim, SceneRegion, WaterfallSceneMeta } from "@/lib/plotScene";
import type { TimelineParticipantView } from "@/lib/types";

import { buildComparisonWaterfallScene } from "@/lib/reviewCompareScene";

const GEO = WATERFALL_GEOMETRY;

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
    expect(meta!.rows[1]!.y - meta!.rows[0]!.y).toBe(58);

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
});
