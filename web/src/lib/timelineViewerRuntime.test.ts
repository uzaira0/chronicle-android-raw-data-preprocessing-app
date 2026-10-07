import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { buildAppTimelineViews } from "@/lib/plotGenerator";
import { textPaintX, type Scene, type TextPrim } from "@/lib/plotScene";
import { buildComparisonWaterfallScene } from "@/lib/reviewCompareScene";
import type { TimelineParticipantView } from "@/lib/types";

// Runs the exported viewer's runtime (inlined verbatim into the .html) against a
// stub DOM and records where each glyph is painted after real shift+wheel
// zooms, so row-zoom behaviour is checked in the code that ships.
const RUNTIME = readFileSync(new URL("./timelineViewerRuntime.js", import.meta.url), "utf8");

type Painted = { text: string; x: number; y: number };

function runViewer(view: TimelineParticipantView) {
  const handlers: Record<string, (e: unknown) => void> = {};
  let painted: Painted[] = [];
  const noop = (): void => undefined;
  const ctx = new Proxy(
    { fillText: (text: string, x: number, y: number) => painted.push({ text, x, y }) },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop), set: () => true },
  );
  const canvas = {
    style: {},
    getContext: () => ctx,
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  // Wrapper as wide as the scene → scale 1, so client px == scene px.
  const wrap = { getBoundingClientRect: () => ({ width: view.scene.width }) };
  const fig = {
    getAttribute: (name: string) => (name === "data-tv-type" ? "app" : "0"),
    querySelector: (sel: string) => (sel === ".tv-canvas" ? canvas : sel === ".tv-canvas-wrap" ? wrap : null),
  };
  const document = {
    getElementById: () => ({ textContent: JSON.stringify({ app: [view], screen: [] }) }),
    querySelectorAll: (sel: string) => (sel === ".tv-scene" ? [fig] : []),
    querySelector: () => null,
  };
  const window = { devicePixelRatio: 1, addEventListener: noop };
  runInNewContext(RUNTIME, { document, window });
  return {
    paintedNow: () => painted,
    /** Zoom the row under (x, y) in by `steps` shift+wheel notches (×1.2 each, capped at 24×). */
    zoom(x: number, y: number, steps: number): Painted[] {
      for (let i = 0; i < steps; i++) {
        painted = [];
        handlers.wheel?.({ shiftKey: true, deltaY: -1, deltaX: 0, clientX: x, clientY: y, preventDefault: noop });
      }
      return painted;
    },
  };
}

const TZ = "America/Chicago";
const ns = (iso: string): bigint => BigInt(Date.parse(iso)) * 1_000_000n;
const usage = (date: string, start: string, stop: string) => ({
  date,
  start_timestamp_ns: ns(start),
  stop_timestamp_ns: ns(stop),
  event_timestamp_ns: ns(start),
  interaction_type: "App Usage",
  broad_app_category: "Games",
  app_package_name: "com.example.app",
  participant_id: "P01",
});
// Fall-back day (25 h) plus an ordinary day, with a daily Δ so the strip label exists.
const ROWS = [
  usage("2026-11-01", "2026-11-01T01:30:00-05:00", "2026-11-01T01:15:00-06:00"),
  usage("2026-11-02", "2026-11-02T09:00:00-06:00", "2026-11-02T09:30:00-06:00"),
];

function compareView(): TimelineParticipantView {
  const [view] = buildAppTimelineViews(ROWS, TZ, { includeFilteredAppUsageInPlots: false }, "1.0.0");
  const v = view as NonNullable<typeof view>;
  const perDay = (m: number) => new Map([["2026-11-01", m], ["2026-11-02", m]]);
  return buildComparisonWaterfallScene(v, v, perDay(10), perDay(20));
}

const textPrims = (scene: Scene): TextPrim[] =>
  scene.primitives.filter((p): p is TextPrim => p.type === "text");

describe("exported viewer runtime under row zoom", () => {
  const view = compareView();
  const meta = view.scene.meta;
  if (!meta) throw new Error("comparison scene has no waterfall meta");
  const fallRow = meta.rows.find((r) => r.date === "2026-11-01");
  const normalRow = meta.rows.find((r) => r.date === "2026-11-02");
  if (!fallRow || !normalRow) throw new Error("missing rows");
  // Zooming at the plot's left edge keeps the row offset at 0, so a zoomed
  // x is gutter + (x - gutter) * zoom exactly.
  const zoomAt = (row: { y: number; h: number }) => runViewer(view).zoom(meta.gutter, row.y + row.h / 2, 20);
  const ZOOM = 24; // 1.2^20 ≈ 38, clamped to the viewer's 24× maximum.

  it("moves a DST clock label with its hour and keeps the 2 px pad unscaled", () => {
    const painted = zoomAt(fallRow).filter((p) => p.y > fallRow.y && p.y < fallRow.y + fallRow.h);
    const labels = textPrims(view.scene).filter(
      (p) => p.dx !== undefined && p.y > fallRow.y && p.y < fallRow.y + fallRow.h,
    );
    expect(labels.length).toBe(25);
    const second = labels[1] as TextPrim; // clock "1" at elapsed 1 h
    const hit = painted.find((p) => p.text === second.text && Math.abs(p.y - second.y) < 1e-9);
    const expected = meta.gutter + (second.x - meta.gutter) * ZOOM + (second.dx ?? 0);
    expect(hit?.x).toBeCloseTo(expected, 9);
  });

  it("paints the Δ label exactly where the scene puts it at every zoom, as on main", () => {
    const delta = textPrims(view.scene).find(
      (p) => /m$/.test(p.text) && p.y > normalRow.y && p.y < normalRow.y + normalRow.h,
    );
    expect(delta).toBeDefined();
    const painted = zoomAt(normalRow).find((p) => p.text === delta?.text && p.y === delta.y);
    expect(painted?.x).toBe(delta?.x);
  });
});

describe("textPaintX (the in-app viewer's rule)", () => {
  const tx = (x: number): number => 100 + (x - 100) * 10;
  it("moves only row-anchored text, adding its pad after the zoom", () => {
    const base: TextPrim = {
      type: "text", x: 150, y: 0, text: "1", fill: "#000", font: "9px x", anchor: "start", baseline: "top",
    };
    expect(textPaintX(base, tx)).toBe(150);
    expect(textPaintX({ ...base, dx: 2 }, tx)).toBe(602);
    expect(textPaintX({ ...base, dx: 2 })).toBe(152);
  });
});
