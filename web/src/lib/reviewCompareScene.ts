/**
 * Interleaved A/B comparison waterfall (the View tab's compare mode).
 *
 * Instead of stacking arm A's timeline above arm B's, this weaves both into one
 * scene: every date is a single row carrying an A sub-lane (top), a B sub-lane
 * (below), and a Δ strip whose length encodes that day's change in usage. It
 * mirrors the reference knob-explorer's `drawLane` + delta-strip geometry.
 *
 * It is a pure function of the two already-built single-arm views: each session
 * region is self-describing (carries its colour via {@link SceneRegion.fill}),
 * and both arms share the exact x-geometry ({@link WATERFALL_GEOMETRY}), so a
 * region's `x`/`w` transfer into the combined row unchanged. No re-derivation,
 * no extra worker payload.
 */

import { WATERFALL_GEOMETRY } from "@/lib/plotGenerator";
import type { Primitive, Scene, SceneRegion, WaterfallSceneMeta } from "@/lib/plotScene";
import type { TimelineParticipantView } from "@/lib/types";

/** Arm identity colours, matching the reference (A amber, B teal) and the
 * right-rail metric cards. */
const ARM_A_COLOR = "#c66a00";
const ARM_B_COLOR = "#0b7d8e";
/** Δ strip: green when B exceeds A, red when B falls short (B − A). */
const DELTA_POS = "#178a4c";
const DELTA_NEG = "#c43d38";

/** Per-row geometry. Two 18px lanes + a 5px Δ strip inside a 58px row, with a
 * top band reserved for the hour axis. */
const LAYOUT = {
  padTop: 26,
  padBottom: 12,
  rowH: 58,
  laneAY: 6,
  laneBY: 28,
  laneH: 18,
  deltaY: 50,
  deltaH: 5,
} as const;

/** A Δ of this many minutes (or more) saturates the strip to full width. */
const DELTA_FULL_SCALE_MIN = 120;
const FONT_DATE = "600 11px system-ui, sans-serif";
const FONT_DOW = "10px system-ui, sans-serif";
const FONT_AXIS = "10px system-ui, sans-serif";
const FONT_DELTA = "9px system-ui, sans-serif";

/** One placed bar/marker lifted out of a single-arm view, ready to re-emit into
 * a comparison lane. `x`/`w` are already in shared scene coordinates. */
type LaneItem = {
  x: number;
  w: number;
  fill: string;
  title: string;
  lines: string[];
  marker: boolean;
};

function waterfallMeta(view: TimelineParticipantView): WaterfallSceneMeta | undefined {
  return view.scene.meta?.kind === "waterfall" ? view.scene.meta : undefined;
}

/** Binary search for the row whose [y, y+h) band contains `centerY`. Rows are
 * sorted ascending and non-overlapping, so this is O(log N) per region instead
 * of the O(N) linear scan that made drawer-open O(regions × rows). */
function findRowByY(
  rows: ReadonlyArray<{ y: number; h: number; date: string }>,
  centerY: number,
): { date: string } | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid];
    if (r === undefined) return undefined;
    if (centerY < r.y) hi = mid - 1;
    else if (centerY >= r.y + r.h) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/** Group a view's session/marker regions by the date row they fall in. */
function laneItemsByDate(view: TimelineParticipantView): Map<string, LaneItem[]> {
  const byDate = new Map<string, LaneItem[]>();
  const meta = waterfallMeta(view);
  if (!meta) return byDate;
  const rows = [...meta.rows].sort((a, b) => a.y - b.y);
  for (const region of view.regions) {
    const kind = region.kind ?? "session";
    if (kind !== "session" && kind !== "marker") continue;
    const centerY = region.y + region.h / 2;
    const row = findRowByY(rows, centerY);
    if (!row) continue;
    const items = byDate.get(row.date) ?? [];
    items.push({
      x: region.x,
      w: region.w,
      fill: region.fill ?? "#888",
      title: region.title,
      lines: region.lines,
      marker: kind === "marker",
    });
    byDate.set(row.date, items);
  }
  return byDate;
}

function dayOfWeek(iso: string): string {
  const dt = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
}

/**
 * Build the interleaved A/B comparison view for one participant.
 *
 * @param aView   Arm-A single-arm waterfall view (the current run).
 * @param bView   Arm-B single-arm waterfall view (the compared run).
 * @param perDayA Arm-A usage minutes by date — drives the Δ strip.
 * @param perDayB Arm-B usage minutes by date.
 * @param formatDate Gutter label for a date. Defaults to the compact "MM-DD";
 *   the caller passes a demo-masking-aware formatter so dates don't leak in demo
 *   mode (the post-build text masker can't catch a year-less "MM-DD" string).
 */
export function buildComparisonWaterfallScene(
  aView: TimelineParticipantView,
  bView: TimelineParticipantView,
  perDayA: Map<string, number>,
  perDayB: Map<string, number>,
  formatDate: (iso: string) => string = (iso) => (iso.length >= 5 ? iso.slice(5) : iso),
): TimelineParticipantView {
  const geo = WATERFALL_GEOMETRY;
  const aByDate = laneItemsByDate(aView);
  const bByDate = laneItemsByDate(bView);

  const dateSet = new Set<string>();
  for (const meta of [waterfallMeta(aView), waterfallMeta(bView)]) {
    for (const row of meta?.rows ?? []) dateSet.add(row.date);
  }
  for (const d of perDayA.keys()) dateSet.add(d);
  for (const d of perDayB.keys()) dateSet.add(d);
  const dates = [...dateSet].sort();

  const height = LAYOUT.padTop + dates.length * LAYOUT.rowH + LAYOUT.padBottom;
  const prims: Primitive[] = [{ type: "rect", x: 0, y: 0, w: geo.width, h: height, fill: "#ffffff" }];
  const regions: SceneRegion[] = [];

  // Hour axis: labels along the top band (every 6h). Per-row gridline segments
  // are added inside the row loop so they zoom with the row content.
  for (let hh = 0; hh <= 24; hh += 6) {
    prims.push({
      type: "text",
      x: geo.hoursToX(hh),
      y: LAYOUT.padTop - 10,
      text: String(hh).padStart(2, "0"),
      fill: "#6b7682",
      font: FONT_AXIS,
      anchor: "middle",
      baseline: "middle",
    });
  }

  const emitLane = (items: LaneItem[], laneTop: number, armColor: string, tag: "A" | "B"): void => {
    // Arm-identity tick at the lane's left edge (outside the plot → stays fixed
    // under row zoom).
    prims.push({ type: "rect", x: geo.gutter - 5, y: laneTop + 2, w: 2, h: LAYOUT.laneH - 4, fill: armColor });
    for (const item of items) {
      if (item.marker) {
        const cx = item.x + item.w / 2;
        prims.push({ type: "rect", x: cx - 1, y: laneTop + 1, w: 2, h: LAYOUT.laneH - 2, fill: item.fill });
        regions.push({
          x: cx - 4,
          y: laneTop,
          w: 8,
          h: LAYOUT.laneH,
          title: `${item.title} · ${tag}`,
          lines: item.lines,
          fill: item.fill,
          kind: "marker",
        });
        continue;
      }
      const w = Math.max(item.w, 1);
      prims.push({ type: "rect", x: item.x, y: laneTop, w, h: LAYOUT.laneH, fill: item.fill });
      regions.push({
        x: item.x,
        y: laneTop,
        w,
        h: LAYOUT.laneH,
        title: `${item.title} · ${tag}`,
        lines: item.lines,
        fill: item.fill,
        kind: "session",
      });
    }
  };

  dates.forEach((date, i) => {
    const rowY = LAYOUT.padTop + i * LAYOUT.rowH;

    // Row separator above every row after the first.
    if (i > 0) {
      prims.push({ type: "line", x1: 0, y1: rowY, x2: geo.width, y2: rowY, stroke: "#e4e7eb", strokeWidth: 1 });
    }

    // Faint per-row hour gridlines (6/12/18) — vertical within the row, so the
    // interactive viewer's per-row x-zoom carries them along.
    for (const hh of [6, 12, 18]) {
      const x = geo.hoursToX(hh);
      prims.push({ type: "line", x1: x, y1: rowY + 2, x2: x, y2: rowY + LAYOUT.rowH - 2, stroke: "#f0f2f5", strokeWidth: 1 });
    }

    // Date + weekday label in the gutter.
    prims.push({
      type: "text",
      x: geo.gutter - 10,
      y: rowY + 14,
      text: formatDate(date),
      fill: "#4d5763",
      font: FONT_DATE,
      anchor: "end",
      baseline: "middle",
    });
    const dow = dayOfWeek(date);
    if (dow) {
      prims.push({
        type: "text",
        x: geo.gutter - 10,
        y: rowY + 28,
        text: dow,
        fill: "#9aa3ae",
        font: FONT_DOW,
        anchor: "end",
        baseline: "middle",
      });
    }

    emitLane(aByDate.get(date) ?? [], rowY + LAYOUT.laneAY, ARM_A_COLOR, "A");
    emitLane(bByDate.get(date) ?? [], rowY + LAYOUT.laneBY, ARM_B_COLOR, "B");

    // Δ strip: length ∝ |B − A| daily minutes, green up / red down.
    const aMin = perDayA.get(date) ?? 0;
    const bMin = perDayB.get(date) ?? 0;
    const delta = bMin - aMin;
    if (Math.abs(delta) > 0.05) {
      const mag = Math.min(Math.abs(delta) / DELTA_FULL_SCALE_MIN, 1);
      const stripW = Math.max(geo.plotWidth * mag, 2);
      const color = delta > 0 ? DELTA_POS : DELTA_NEG;
      prims.push({
        type: "rect",
        x: geo.gutter,
        y: rowY + LAYOUT.deltaY,
        w: stripW,
        h: LAYOUT.deltaH,
        fill: color,
        alpha: 0.3 + 0.6 * mag,
      });
      prims.push({
        type: "text",
        x: geo.gutter + stripW + 4,
        y: rowY + LAYOUT.deltaY + LAYOUT.deltaH / 2,
        text: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(delta >= 100 || delta <= -100 ? 0 : 1)}m`,
        fill: color,
        font: FONT_DELTA,
        anchor: "start",
        baseline: "middle",
      });
    }
    // Δ hover spans the whole strip lane, even when no bar is drawn.
    regions.push({
      x: geo.gutter,
      y: rowY + LAYOUT.deltaY - 3,
      w: geo.plotWidth,
      h: LAYOUT.deltaH + 6,
      title: "Δ usage (B − A)",
      lines: [
        `A ${aMin.toFixed(1)} min`,
        `B ${bMin.toFixed(1)} min`,
        `Δ ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toFixed(1)} min`,
      ],
    });
  });

  const meta: WaterfallSceneMeta = {
    kind: "waterfall",
    gutter: geo.gutter,
    plotWidth: geo.plotWidth,
    rows: dates.map((date, i) => ({ date, y: LAYOUT.padTop + i * LAYOUT.rowH, h: LAYOUT.rowH })),
  };

  const scene: Scene = { width: geo.width, height, primitives: prims, meta };
  return { participantId: aView.participantId, scene, regions };
}
