import { describe, expect, it } from "vitest";

import { drawDataGaps } from "@/lib/plotGenerator";

// drawDataGaps shades windows with no device activity (> 1h between consecutive
// raw events) as faint grey bands, and is shared by the app-usage and screen-usage
// plots. The bug-prone part is the multi-day tiling: a gap that straddles day
// boundaries must fill the tail of the start day, every full day in between, and
// the head of the end day. These tests exercise that geometry via a recording
// canvas double, keying each fillRect to its row by (y + height/2) so no internal
// layout constant has to be imported.

const HOUR_NS = 3_600_000_000_000n;
const DAY_NS = 86_400_000_000_000n;
// 2026-03-07T00:00:00Z in epoch-ns (a stable, DST-free reference midnight UTC).
const DAY0_MIDNIGHT_NS = BigInt(Date.UTC(2026, 2, 7)) * 1_000_000n;

function at(dayOffset: number, hour: number): bigint {
  return DAY0_MIDNIGHT_NS + BigInt(dayOffset) * DAY_NS + BigInt(Math.round(hour * 3_600)) * 1_000_000_000n;
}

function nsToIso(ns: bigint): string {
  return new Date(Number(ns / 1_000_000n)).toISOString().slice(0, 10);
}

function nsToLocalHours(ns: bigint): number {
  return Number(((ns % DAY_NS) + DAY_NS) % DAY_NS) / Number(HOUR_NS);
}

type Rect = { x: number; y: number; w: number; h: number; alpha: number };

/** Minimal CanvasRenderingContext2D double recording fillRect calls + alpha. */
function recordingCtx() {
  const rects: Rect[] = [];
  let globalAlpha = 1;
  const ctx = {
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, alpha: globalAlpha });
    },
    // The real signature needs the full 2D context surface; the cast is safe
    // because drawDataGaps only touches globalAlpha, fillStyle and fillRect.
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, getAlpha: () => globalAlpha };
}

// Three consecutive day rows; the y values are arbitrary stand-ins for the plot's
// row centers. Each rect drawn for a day must center on that day's value.
const dateToY = new Map<string, number>([
  [nsToIso(at(0, 12)), 100],
  [nsToIso(at(1, 12)), 200],
  [nsToIso(at(2, 12)), 300],
]);

/** Which configured day-row a recorded rect belongs to, via its vertical center. */
function rowCenterOf(r: Rect): number {
  return r.y + r.h / 2;
}

describe("drawDataGaps", () => {
  it("draws nothing and returns false when no span exceeds the 1h threshold", () => {
    const { ctx, rects } = recordingCtx();
    const events = [at(0, 1), at(0, 1.5), at(0, 2)]; // 30-min spacing
    const drew = drawDataGaps(ctx, events, dateToY, nsToLocalHours, nsToIso);
    expect(drew).toBe(false);
    expect(rects).toHaveLength(0);
  });

  it("treats an exactly-1h span as not a gap (threshold is exclusive)", () => {
    const { ctx, rects } = recordingCtx();
    const events = [at(0, 2), at(0, 3)]; // exactly 1h apart
    const drew = drawDataGaps(ctx, events, dateToY, nsToLocalHours, nsToIso);
    expect(drew).toBe(false);
    expect(rects).toHaveLength(0);
  });

  it("draws a single faint band for a same-day gap", () => {
    const { ctx, rects } = recordingCtx();
    const events = [at(0, 2), at(0, 8)]; // 6h gap, same day
    const drew = drawDataGaps(ctx, events, dateToY, nsToLocalHours, nsToIso);
    expect(drew).toBe(true);
    expect(rects).toHaveLength(1);
    expect(rowCenterOf(rects[0])).toBe(100); // day 0 row
    expect(rects[0].w).toBeGreaterThan(0);
    expect(rects[0].alpha).toBeCloseTo(0.15); // faint shading
  });

  it("tiles a multi-day gap across tail, full middle day(s), and head", () => {
    const { ctx, rects } = recordingCtx();
    // 22:00 on day 0 → 03:00 on day 2: tail of day 0, all of day 1, head of day 2.
    const events = [at(0, 22), at(2, 3)];
    const drew = drawDataGaps(ctx, events, dateToY, nsToLocalHours, nsToIso);
    expect(drew).toBe(true);
    expect(rects).toHaveLength(3);

    const byRow = new Map(rects.map((r) => [rowCenterOf(r), r]));
    expect([...byRow.keys()].sort((a, b) => a - b)).toEqual([100, 200, 300]);

    const tail = byRow.get(100)!;
    const middle = byRow.get(200)!;
    const head = byRow.get(300)!;

    // The full middle day must be the widest band; the partial tail/head are narrower.
    expect(middle.w).toBeGreaterThan(tail.w);
    expect(middle.w).toBeGreaterThan(head.w);
    // Tail starts to the right of the middle's left edge (it begins at 22:00).
    expect(tail.x).toBeGreaterThan(middle.x);
    // Head starts at the middle's left edge (the day's start) and is shorter.
    expect(head.x).toBeCloseTo(middle.x);
    expect(rects.every((r) => r.alpha === 0.15)).toBe(true);
  });

  it("restores globalAlpha to 1 after shading", () => {
    const { ctx, getAlpha } = recordingCtx();
    drawDataGaps(ctx, [at(0, 2), at(0, 8)], dateToY, nsToLocalHours, nsToIso);
    expect(getAlpha()).toBe(1);
  });

  it("skips gaps whose day rows are absent from dateToY without throwing", () => {
    const { ctx, rects } = recordingCtx();
    const empty = new Map<string, number>();
    const drew = drawDataGaps(ctx, [at(0, 2), at(0, 8)], empty, nsToLocalHours, nsToIso);
    // Still reports a gap was detected (for the legend) even if no row maps.
    expect(drew).toBe(true);
    expect(rects).toHaveLength(0);
  });
});
