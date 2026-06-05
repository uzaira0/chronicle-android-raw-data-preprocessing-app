/**
 * Browser-side app-usage chart generator.
 *
 * Produces a horizontal-bar timeline (one row per calendar date, bars coloured
 * by broad_app_category) that mirrors the matplotlib output from the Python
 * desktop pipeline.  Runs entirely in-browser via OffscreenCanvas / Canvas.
 */

import type { Primitive, Scene, SceneRegion } from "@/lib/plotScene";
import { sceneToSvgBlob } from "@/lib/plotScene";
import type { BrowserProcessingOptions } from "@/lib/types";

type Ctx2DBase = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Paint a {@link Scene} onto a 2D canvas context. The raster (PNG) twin of
 * `renderSceneToSvg`: both consume the identical primitive list, so the PNG and
 * SVG renderings of a plot cannot drift apart. Primitives paint in array order.
 */
export function renderSceneToCanvas(ctx: Ctx2DBase, scene: Scene): void {
  for (const p of scene.primitives) {
    if (p.type === "rect") {
      ctx.globalAlpha = p.alpha ?? 1;
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth ?? 1;
        ctx.setLineDash([]);
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      }
      ctx.globalAlpha = 1;
    } else if (p.type === "text") {
      ctx.font = p.font;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === "start" ? "left" : p.anchor === "middle" ? "center" : "right";
      ctx.textBaseline = p.baseline;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.type === "line") {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth ?? 1;
      ctx.setLineDash(p.dash ?? []);
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // poly
      ctx.beginPath();
      p.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      if (p.closed) ctx.closePath();
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth ?? 1;
        ctx.stroke();
      }
    }
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

// ─── types ────────────────────────────────────────────────────────────────────

type PlotRow = {
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  interaction_type: string;
  broad_app_category?: string | null;
  app_package_name: string;
  username?: string;
};

// ─── constants ────────────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  "Games": "#e6194b",
  "Video Players (e.g. YouTube)": "#4363d8",
  "Social & Communication": "#fabed4",
  "Entertainment": "#f58231",
  "Lifestyle": "#42d4f4",
  "Productivity & Business": "#aaffc3",
  "Health": "#469990",
  "Education": "#800000",
  "Travel & Local": "#9a6324",
  "News & Magazines": "#dcbeff",
  "Photography": "yellow",
  "Uncategorised": "#222222",
  "Unknown": "#555555",
};
const GAP_COLOR = "#808080";

const APP_USAGE_TYPE = "App Usage";
const FILTERED_APP_USAGE_TYPE = "Filtered App Usage";
const DEVICE_SHUTDOWN_TYPE = "Device Shutdown";
const DEVICE_STARTUP_TYPE = "Device Startup";
const END_OF_USAGE_MISSING_TYPE = "End of Usage Missing";

// Canvas layout constants
const CANVAS_WIDTH = 1800;
const ROW_HEIGHT = 28;
const MARGIN = { top: 60, right: 260, bottom: 60, left: 160 };
const FONT = "13px system-ui, sans-serif";
const FONT_SMALL = "11px system-ui, sans-serif";

// ─── formatter cache (module-level, reused across calls) ─────────────────────
const _hoursFmtCache = new Map<string, Intl.DateTimeFormat>();
const _dateFmtCache = new Map<string, Intl.DateTimeFormat>();

function getHoursFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = _hoursFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    _hoursFmtCache.set(tz, fmt);
  }
  return fmt;
}

function getDateFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = _dateFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("sv", { timeZone: tz });
    _dateFmtCache.set(tz, fmt);
  }
  return fmt;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** ISO "YYYY-MM-DD" → integer day serial (days since 2000-01-01, arbitrary but stable) */
function dateSerial(isoDate: string): number {
  const [y, mo, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000);
}

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    weekday: "short",
    timeZone: "UTC",
  });
}

// ─── core ─────────────────────────────────────────────────────────────────────

function buildCanvas(height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(CANVAS_WIDTH, height);
  }
  const el = document.createElement("canvas");
  el.width = CANVAS_WIDTH;
  el.height = height;
  return el;
}

function plotWidth(): number {
  return CANVAS_WIDTH - MARGIN.left - MARGIN.right;
}

/** Minimum canvas height so the right-hand legend isn't clipped. The legend
 * starts at the plot top and can have more rows than the plot has date rows
 * (e.g. 13 app categories on a 2-day plot), which otherwise runs off the
 * bottom — taking the "Data Gap" entry with it. */
function legendFloorHeight(legendRowCount: number): number {
  const LEGEND_LINE_H = 20;
  return MARGIN.top + legendRowCount * LEGEND_LINE_H + 40 + MARGIN.bottom;
}

function hoursToX(h: number): number {
  return MARGIN.left + (h / 24) * plotWidth();
}

/** Title + subtitle primitives for the app-usage timeline. */
function titlePrimitives(
  participantId: string,
  includeFiltered: boolean,
  dateStr: string,
  version: string,
): Primitive[] {
  // Always annotate the filtered-apps state both ways (mirrors the desktop
  // plot) so "unfiltered" is explicit, not merely the absence of a label.
  const suffix = includeFiltered ? " (Including Filtered Apps)" : " (Target Child Only)";
  return [
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 28,
      text: `App Usage for ${participantId}${suffix}`,
      fill: "#111",
      font: "bold 16px system-ui, sans-serif",
      anchor: "middle",
      baseline: "alphabetic",
    },
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 46,
      text: `Created on ${dateStr} · Preprocessor v${version}`,
      fill: "#666",
      font: FONT_SMALL,
      anchor: "middle",
      baseline: "alphabetic",
    },
  ];
}

const SWATCH_SIZE = 12;
const LEGEND_LINE_H = 20;

/** One legend entry: a colour swatch (optional outline / alpha) + its label. */
function legendEntry(
  x: number,
  y: number,
  color: string,
  label: string,
  opts: { outline?: boolean; alpha?: number } = {},
): Primitive[] {
  return [
    {
      type: "rect",
      x,
      y: y - SWATCH_SIZE / 2,
      w: SWATCH_SIZE,
      h: SWATCH_SIZE,
      fill: color,
      ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}),
      ...(opts.outline ? { stroke: "#aaa", strokeWidth: 0.5 } : {}),
    },
    {
      type: "text",
      x: x + SWATCH_SIZE + 5,
      y,
      text: label,
      fill: "#333",
      font: FONT_SMALL,
      anchor: "start",
      baseline: "middle",
    },
  ];
}

/** Right-hand legend for the app-usage timeline (categories + events/gaps). */
function legendPrimitives(
  legendTop: number,
  hasShutdown: boolean,
  hasStartup: boolean,
  hasMissing: boolean,
  hasGap: boolean,
): Primitive[] {
  const x = CANVAS_WIDTH - MARGIN.right + 16;
  let y = legendTop;
  const prims: Primitive[] = [];
  const header = (text: string): void => {
    prims.push({
      type: "text",
      x,
      y,
      text,
      fill: "#333",
      font: "bold 12px system-ui, sans-serif",
      anchor: "start",
      baseline: "middle",
    });
  };

  header("App Categories");
  y += LEGEND_LINE_H + 4;
  for (const [label, color] of Object.entries(CATEGORY_COLORS)) {
    prims.push(...legendEntry(x, y, color, label, { outline: true }));
    y += LEGEND_LINE_H;
  }

  if (hasGap || hasShutdown || hasStartup || hasMissing) {
    y += 6;
    header("Events & Gaps");
    y += LEGEND_LINE_H + 4;
  }

  if (hasGap) {
    prims.push(...legendEntry(x, y, GAP_COLOR, "Data Gap", { alpha: 0.35 }));
    y += LEGEND_LINE_H;
  }

  if (hasShutdown) {
    prims.push(...legendEntry(x, y, "red", "Device Shutdown"));
    y += LEGEND_LINE_H;
  }
  if (hasStartup) {
    prims.push(...legendEntry(x, y, "green", "Device Startup"));
    y += LEGEND_LINE_H;
  }
  if (hasMissing) {
    prims.push(...legendEntry(x, y, "#888", "End of Usage Missing"));
  }
  return prims;
}

/** A small downward device-event arrow (shaft + filled head). */
function arrowPrimitives(x: number, yMid: number, color: string): Primitive[] {
  const len = 10;
  const headLen = 5;
  return [
    { type: "line", x1: x, y1: yMid - len / 2, x2: x, y2: yMid + len / 2, stroke: color, strokeWidth: 2 },
    {
      type: "poly",
      points: [
        [x - headLen / 2, yMid + len / 2 - headLen],
        [x, yMid + len / 2],
        [x + headLen / 2, yMid + len / 2 - headLen],
      ],
      fill: color,
      closed: true,
    },
  ];
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Shade windows with no device activity (a "data gap") as faint grey bands.
 * Shared by the app-usage and screen-usage plots so both define a gap the same
 * way: a >1h span between consecutive raw event timestamps. `allEventNs` must be
 * sorted ascending. Returns true when at least one gap was drawn (so the caller
 * can include the "Data Gap" legend entry).
 *
 * Exported for unit testing the gap-band geometry (notably the multi-day tiling),
 * which both the app-usage and screen-usage plots rely on.
 */
export type GapRect = { x: number; y: number; w: number; h: number };

/**
 * Pure geometry for data-gap shading: the faint grey bands covering windows with
 * no device activity (a >1h span between consecutive raw events). `allEventNs`
 * must be sorted ascending. Returns the rectangles to shade plus `hadGap`, which
 * reports whether any qualifying gap existed at all — true even when a gap's day
 * rows are absent from `dateToY` (no rect emitted), so the caller can still show
 * the "Data Gap" legend entry. The single source of gap geometry for both the
 * canvas (PNG) and scene (SVG) paths and for both plot kinds.
 */
export function computeDataGapRects(
  allEventNs: bigint[],
  dateToY: Map<string, number>,
  nsToLocalHours: (ns: bigint) => number,
  nsToIso: (ns: bigint) => string,
): { rects: GapRect[]; hadGap: boolean } {
  const GAP_THRESHOLD_NS = 3_600_000_000_000n; // 1 hour in ns
  const rects: GapRect[] = [];
  let hadGap = false;
  for (let i = 0; i + 1 < allEventNs.length; i++) {
    const gapNs = allEventNs[i + 1]! - allEventNs[i]!;
    if (gapNs <= GAP_THRESHOLD_NS) continue;
    hadGap = true;
    const startH = nsToLocalHours(allEventNs[i]!);
    const endH = nsToLocalHours(allEventNs[i + 1]!);
    const startIso = nsToIso(allEventNs[i]!);
    const endIso = nsToIso(allEventNs[i + 1]!);

    if (startIso === endIso) {
      const yCenter = dateToY.get(startIso);
      if (yCenter !== undefined) {
        const x1 = hoursToX(startH);
        rects.push({ x: x1, y: yCenter - ROW_HEIGHT / 2, w: hoursToX(endH) - x1, h: ROW_HEIGHT });
      }
    } else {
      // multi-day gap: fill tail of start day, full middle days, head of end day
      const yStart = dateToY.get(startIso);
      if (yStart !== undefined) {
        const x1 = hoursToX(startH);
        rects.push({ x: x1, y: yStart - ROW_HEIGHT / 2, w: hoursToX(24) - x1, h: ROW_HEIGHT });
      }
      const startSerial = dateSerial(startIso);
      const endSerial = dateSerial(endIso);
      for (let s = startSerial + 1; s < endSerial; s++) {
        const isoD = new Date(s * 86_400_000).toISOString().slice(0, 10);
        const yMid = dateToY.get(isoD);
        if (yMid !== undefined) {
          rects.push({ x: MARGIN.left, y: yMid - ROW_HEIGHT / 2, w: plotWidth(), h: ROW_HEIGHT });
        }
      }
      const yEnd = dateToY.get(endIso);
      if (yEnd !== undefined) {
        rects.push({ x: MARGIN.left, y: yEnd - ROW_HEIGHT / 2, w: hoursToX(endH) - MARGIN.left, h: ROW_HEIGHT });
      }
    }
  }
  return { rects, hadGap };
}

/**
 * Canvas wrapper around {@link computeDataGapRects} for the imperative
 * screen-usage renderer. Returns true when at least one gap was detected.
 */
export function drawDataGaps(
  ctx: Ctx2D,
  allEventNs: bigint[],
  dateToY: Map<string, number>,
  nsToLocalHours: (ns: bigint) => number,
  nsToIso: (ns: bigint) => string,
): boolean {
  const { rects, hadGap } = computeDataGapRects(allEventNs, dateToY, nsToLocalHours, nsToIso);
  ctx.fillStyle = GAP_COLOR;
  for (const r of rects) {
    ctx.globalAlpha = 0.15;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
  return hadGap;
}

/** Gap rects as scene primitives (faint grey, alpha 0.15). */
function gapPrimitives(rects: GapRect[]): Primitive[] {
  return rects.map((r) => ({
    type: "rect" as const,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    fill: GAP_COLOR,
    alpha: 0.15,
  }));
}

// ─── public API ───────────────────────────────────────────────────────────────

/** White page background covering the whole canvas. */
function backgroundPrimitive(height: number): Primitive {
  return { type: "rect", x: 0, y: 0, w: CANVAS_WIDTH, h: height, fill: "#ffffff" };
}

/** Dashed hour gridlines (every 4h) + their "HH:00" labels under the plot. */
function xAxisPrimitives(plotTop: number, plotBottom: number): Primitive[] {
  const prims: Primitive[] = [];
  for (let h = 0; h <= 24; h += 4) {
    const x = hoursToX(h);
    prims.push({ type: "line", x1: x, y1: plotTop, x2: x, y2: plotBottom, stroke: "#cccccc", strokeWidth: 1, dash: [4, 4] });
    prims.push({
      type: "text",
      x,
      y: plotBottom + 6,
      text: String(h).padStart(2, "0") + ":00",
      fill: "#444",
      font: FONT_SMALL,
      anchor: "middle",
      baseline: "top",
    });
  }
  return prims;
}

/** Faint interior horizontal rules separating date rows. */
function rowSeparatorPrimitives(rowCount: number, plotTop: number): Primitive[] {
  const prims: Primitive[] = [];
  for (let i = 1; i < rowCount; i++) {
    const y = plotTop + i * ROW_HEIGHT;
    prims.push({ type: "line", x1: MARGIN.left, y1: y, x2: MARGIN.left + plotWidth(), y2: y, stroke: "#cccccc", strokeWidth: 1 });
  }
  return prims;
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Build the resolution-independent {@link Scene} for an app-usage timeline. All
 * timeline geometry lives here; the PNG and SVG renderers both consume this, so
 * they cannot drift. `dateStr` is passed in (not read from the clock) so the
 * builder is pure and unit-testable.
 */
export function buildTimelineScene(
  participantId: string,
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
  dateStr: string,
  preAlgoEventNs?: bigint[],
  /** When provided, per-session hover hit-regions (scene coords) are collected
   * here for the interactive View tab. Omitted by the PNG/SVG export paths. */
  regionsOut?: SceneRegion[],
): Scene {
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (row.date) dateSet.add(row.date);
  }
  const sortedDates = [...dateSet].sort();
  if (sortedDates.length === 0) {
    return { width: 1, height: 1, primitives: [] };
  }

  const plotAreaHeight = sortedDates.length * ROW_HEIGHT;
  // app legend rows: categories + "Events & Gaps" header + Data Gap + up to 3
  // device-event markers (shutdown/startup/missing) + a header line.
  const totalHeight = Math.max(
    MARGIN.top + plotAreaHeight + MARGIN.bottom,
    legendFloorHeight(Object.keys(CATEGORY_COLORS).length + 6),
  );
  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;

  // date → y-center mapping (top row = earliest date)
  const dateToY = new Map<string, number>();
  sortedDates.forEach((d, i) => {
    dateToY.set(d, plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  });

  // Per-call memoization caches — scoped here to avoid cross-participant leaks
  const nsToHoursCache = new Map<bigint, number>();
  const nsToIsoCache = new Map<bigint, string>();
  const hoursFmt = getHoursFormatter(timezone);
  const dateFmt = getDateFormatter(timezone);

  function cachedNsToLocalHours(ns: bigint): number {
    let v = nsToHoursCache.get(ns);
    if (v === undefined) {
      const ms = Number(ns / 1_000_000n);
      try {
        const parts = hoursFmt.formatToParts(new Date(ms));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
        const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
        const s = Number(parts.find((p) => p.type === "second")?.value ?? 0);
        v = (h % 24) + m / 60 + s / 3600;
      } catch {
        v = (ms / 3_600_000) % 24;
      }
      nsToHoursCache.set(ns, v);
    }
    return v;
  }

  function cachedNsToIso(ns: bigint): string {
    let v = nsToIsoCache.get(ns);
    if (v === undefined) {
      const ms = Number(ns / 1_000_000n);
      v = dateFmt.format(new Date(ms));
      nsToIsoCache.set(ns, v);
    }
    return v;
  }

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight));
  prims.push(...titlePrimitives(participantId, options.includeFilteredAppUsageInPlots, dateStr, version));

  // Date row labels (no row striping — the background must stay uniform so the
  // category-coloured bars and faint gap shading read accurately; rows are
  // delimited by horizontal separator rules instead).
  sortedDates.forEach((d, i) => {
    prims.push({
      type: "text",
      x: MARGIN.left - 8,
      y: plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2,
      text: formatDateLabel(d),
      fill: "#555",
      font: FONT,
      anchor: "end",
      baseline: "middle",
    });
  });

  prims.push(...rowSeparatorPrimitives(sortedDates.length, plotTop));
  prims.push(...xAxisPrimitives(plotTop, plotBottom));

  // ── data-gap shading ──────────────────────────────────────────────────────
  // Use pre-algorithm timestamps when available (they include all 30+ raw event
  // types, so a gap is genuine absence of any device activity). Without them,
  // fall back to the post-algorithm event_timestamp_ns values, which only cover
  // output-type rows and will miss inter-session raw events.
  const allEventNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const { rects: gapRects, hadGap: gapLegendNeeded } = computeDataGapRects(
    allEventNs,
    dateToY,
    cachedNsToLocalHours,
    cachedNsToIso,
  );
  prims.push(...gapPrimitives(gapRects));

  // ── app-usage bars ────────────────────────────────────────────────────────
  const usageTypes = new Set([APP_USAGE_TYPE]);
  if (options.includeFilteredAppUsageInPlots) usageTypes.add(FILTERED_APP_USAGE_TYPE);

  for (const row of rows) {
    if (!usageTypes.has(row.interaction_type)) continue;
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;

    const color =
      CATEGORY_COLORS[row.broad_app_category ?? "Unknown"] ??
      CATEGORY_COLORS["Uncategorised"]!;

    const startIso = cachedNsToIso(row.start_timestamp_ns);
    const stopIso = cachedNsToIso(row.stop_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const yCenter = dateToY.get(isoD);
      if (yCenter === undefined) continue;

      let x1: number, barW: number;
      if (s === startSerial && s === stopSerial) {
        const sh = cachedNsToLocalHours(row.start_timestamp_ns);
        const eh = cachedNsToLocalHours(row.stop_timestamp_ns);
        x1 = hoursToX(sh);
        barW = hoursToX(Math.min(eh, 24)) - x1;
      } else if (s === startSerial) {
        const sh = cachedNsToLocalHours(row.start_timestamp_ns);
        x1 = hoursToX(sh);
        barW = hoursToX(24) - x1;
      } else if (s === stopSerial) {
        const eh = cachedNsToLocalHours(row.stop_timestamp_ns);
        x1 = MARGIN.left;
        barW = hoursToX(eh) - x1;
      } else {
        x1 = MARGIN.left;
        barW = plotWidth();
      }

      if (barW > 0) {
        const ry = yCenter - ROW_HEIGHT * 0.35;
        const rw = Math.max(barW, 1);
        const rh = ROW_HEIGHT * 0.7;
        prims.push({ type: "rect", x: x1, y: ry, w: rw, h: rh, fill: color });
        if (regionsOut) {
          const durMin = Number(row.stop_timestamp_ns - row.start_timestamp_ns) / 60_000_000_000;
          regionsOut.push({
            x: x1,
            y: ry,
            w: rw,
            h: rh,
            title: row.app_package_name || "(app)",
            lines: [row.broad_app_category ?? "Unknown", `${durMin.toFixed(1)} min · ${row.interaction_type}`],
          });
        }
      }
    }
  }

  // ── device-event arrows ───────────────────────────────────────────────────
  let hasShutdown = false;
  let hasStartup = false;
  let hasMissing = false;

  for (const row of rows) {
    const { interaction_type: type, event_timestamp_ns: evNs, date } = row;
    if (
      type !== DEVICE_SHUTDOWN_TYPE &&
      type !== DEVICE_STARTUP_TYPE &&
      type !== END_OF_USAGE_MISSING_TYPE
    ) continue;

    const yCenter = dateToY.get(date);
    if (yCenter === undefined) continue;
    const x = hoursToX(cachedNsToLocalHours(evNs));

    if (type === DEVICE_SHUTDOWN_TYPE) {
      prims.push(...arrowPrimitives(x, yCenter, "red"));
      hasShutdown = true;
    } else if (type === DEVICE_STARTUP_TYPE) {
      prims.push(...arrowPrimitives(x, yCenter, "green"));
      hasStartup = true;
    } else {
      prims.push(...arrowPrimitives(x, yCenter, "#888"));
      hasMissing = true;
    }
  }

  // Plot border
  prims.push({ type: "rect", x: MARGIN.left, y: plotTop, w: plotWidth(), h: plotAreaHeight, stroke: "#ccc", strokeWidth: 1 });

  // X-axis label (anchored to the plot, not the canvas bottom, which may be
  // taller than the plot when the legend dominates).
  prims.push({
    type: "text",
    x: MARGIN.left + plotWidth() / 2,
    y: plotBottom + MARGIN.bottom - 10,
    text: "Time of Day (Hours)",
    fill: "#444",
    font: FONT,
    anchor: "middle",
    baseline: "alphabetic",
  });

  prims.push(...legendPrimitives(plotTop, hasShutdown, hasStartup, hasMissing, gapLegendNeeded));

  return { width: CANVAS_WIDTH, height: totalHeight, primitives: prims };
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function sceneToPngBlob(scene: Scene): Promise<Blob> {
  const canvas = buildCanvas(scene.height);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  renderSceneToCanvas(ctx, scene);
  return canvasToBlob(canvas);
}

export async function generateParticipantPlotBlob(
  participantId: string,
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  /** Preprocessor version, stamped in the plot subtitle for provenance. */
  version: string,
  /** All event timestamps from before the app-usage algorithm ran, sorted ascending.
   * When provided these are used for gap detection instead of the post-algorithm
   * event_timestamp_ns values, so gaps reflect genuinely missing raw events. */
  preAlgoEventNs?: bigint[],
): Promise<Blob> {
  const scene = buildTimelineScene(participantId, rows, timezone, options, version, todayLabel(), preAlgoEventNs);
  return sceneToPngBlob(scene);
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

// ─── screen-usage plot ────────────────────────────────────────────────────────

type ScreenPlotRow = {
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  screen_usage_end_reason?: string | null;
};

const SCREEN_REASON_COLORS: Record<string, string> = {
  probable_manual_lock: "#4CAF50",
  probable_auto_lock: "#2196F3",
  app_kept_awake_or_extended: "#FF9800",
  lock_screen_only: "#9C27B0",
  extended_idle_or_unknown: "#607D8B",
  unknown: "#9E9E9E",
  missing_stop: "#F44336",
};

const SCREEN_REASON_LABELS: Record<string, string> = {
  probable_manual_lock: "Probable manual lock",
  probable_auto_lock: "Probable auto-lock",
  app_kept_awake_or_extended: "App kept awake / extended",
  lock_screen_only: "Lock screen only",
  extended_idle_or_unknown: "Extended idle / unknown",
  unknown: "Unknown",
  missing_stop: "Missing stop",
};

/**
 * Build the resolution-independent {@link Scene} for a screen-usage timeline.
 * The screen twin of {@link buildTimelineScene}: identical day-grid geometry,
 * bars coloured by `screen_usage_end_reason`. Both the PNG and SVG renderers
 * consume this scene, so the screen plot's raster and vector outputs cannot
 * drift (previously the screen plot drew straight to a canvas and had no SVG
 * path). `dateStr` is passed in (not read from the clock) so the builder is pure.
 */
export function buildScreenScene(
  participantId: string,
  rows: ScreenPlotRow[],
  timezone: string,
  version: string,
  dateStr: string,
  preAlgoEventNs?: bigint[],
  /** When provided, per-session hover hit-regions (scene coords) are collected
   * here for the interactive View tab. Omitted by the PNG/SVG export paths. */
  regionsOut?: SceneRegion[],
): Scene {
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (row.date) dateSet.add(row.date);
  }
  const sortedDates = [...dateSet].sort();
  if (sortedDates.length === 0) {
    return { width: 1, height: 1, primitives: [] };
  }

  const plotAreaHeight = sortedDates.length * ROW_HEIGHT;
  // screen legend rows: end reasons + header + Data Gap entry + spacing.
  const totalHeight = Math.max(
    MARGIN.top + plotAreaHeight + MARGIN.bottom,
    legendFloorHeight(Object.keys(SCREEN_REASON_COLORS).length + 3),
  );
  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;

  const dateToY = new Map<string, number>();
  sortedDates.forEach((d, i) => {
    dateToY.set(d, plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  });

  const nsToHoursCache = new Map<bigint, number>();
  const nsToIsoCache = new Map<bigint, string>();
  const hoursFmt = getHoursFormatter(timezone);
  const dateFmt = getDateFormatter(timezone);

  function nsToLocalHours(ns: bigint): number {
    let v = nsToHoursCache.get(ns);
    if (v === undefined) {
      const ms = Number(ns / 1_000_000n);
      try {
        const parts = hoursFmt.formatToParts(new Date(ms));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
        const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
        const s = Number(parts.find((p) => p.type === "second")?.value ?? 0);
        v = (h % 24) + m / 60 + s / 3600;
      } catch {
        v = (ms / 3_600_000) % 24;
      }
      nsToHoursCache.set(ns, v);
    }
    return v;
  }

  function nsToIso(ns: bigint): string {
    let v = nsToIsoCache.get(ns);
    if (v === undefined) {
      const ms = Number(ns / 1_000_000n);
      v = dateFmt.format(new Date(ms));
      nsToIsoCache.set(ns, v);
    }
    return v;
  }

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight));
  prims.push(
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 28,
      text: `Screen Usage for ${participantId}`,
      fill: "#111",
      font: "bold 16px system-ui, sans-serif",
      anchor: "middle",
      baseline: "alphabetic",
    },
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 46,
      text: `Created on ${dateStr} · Preprocessor v${version}`,
      fill: "#666",
      font: FONT_SMALL,
      anchor: "middle",
      baseline: "alphabetic",
    },
  );

  // Date row labels (no striping — uniform background so bars/gaps read true).
  sortedDates.forEach((d, i) => {
    prims.push({
      type: "text",
      x: MARGIN.left - 8,
      y: plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2,
      text: formatDateLabel(d),
      fill: "#555",
      font: FONT,
      anchor: "end",
      baseline: "middle",
    });
  });

  prims.push(...rowSeparatorPrimitives(sortedDates.length, plotTop));
  prims.push(...xAxisPrimitives(plotTop, plotBottom));

  // Data-gap shading (drawn before the session bars so bars sit on top). Uses
  // the pre-algorithm raw timestamps when supplied; otherwise the screen-session
  // event timestamps, which only mark session starts and miss inter-session
  // activity — so genuine gap detection needs the pre-algorithm timestamps.
  const screenGapNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const { rects: gapRects, hadGap: gapLegendNeeded } = computeDataGapRects(
    screenGapNs,
    dateToY,
    nsToLocalHours,
    nsToIso,
  );
  prims.push(...gapPrimitives(gapRects));

  // End-reason coloured session bars.
  for (const row of rows) {
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;

    const reason = row.screen_usage_end_reason ?? "unknown";
    const color = SCREEN_REASON_COLORS[reason] ?? SCREEN_REASON_COLORS["unknown"]!;

    const startIso = nsToIso(row.start_timestamp_ns);
    const stopIso = nsToIso(row.stop_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const yCenter = dateToY.get(isoD);
      if (yCenter === undefined) continue;

      let x1: number, barW: number;
      if (s === startSerial && s === stopSerial) {
        x1 = hoursToX(nsToLocalHours(row.start_timestamp_ns));
        barW = hoursToX(Math.min(nsToLocalHours(row.stop_timestamp_ns), 24)) - x1;
      } else if (s === startSerial) {
        x1 = hoursToX(nsToLocalHours(row.start_timestamp_ns));
        barW = hoursToX(24) - x1;
      } else if (s === stopSerial) {
        x1 = MARGIN.left;
        barW = hoursToX(nsToLocalHours(row.stop_timestamp_ns)) - x1;
      } else {
        x1 = MARGIN.left;
        barW = plotWidth();
      }

      if (barW > 0) {
        const ry = yCenter - ROW_HEIGHT * 0.35;
        const rw = Math.max(barW, 1);
        const rh = ROW_HEIGHT * 0.7;
        prims.push({ type: "rect", x: x1, y: ry, w: rw, h: rh, fill: color });
        if (regionsOut) {
          const durMin = Number(row.stop_timestamp_ns - row.start_timestamp_ns) / 60_000_000_000;
          regionsOut.push({
            x: x1,
            y: ry,
            w: rw,
            h: rh,
            title: "Screen",
            lines: [SCREEN_REASON_LABELS[reason] ?? reason, `${durMin.toFixed(1)} min`],
          });
        }
      }
    }
  }

  // Plot border.
  prims.push({ type: "rect", x: MARGIN.left, y: plotTop, w: plotWidth(), h: plotAreaHeight, stroke: "#ccc", strokeWidth: 1 });

  prims.push({
    type: "text",
    x: MARGIN.left + plotWidth() / 2,
    y: plotBottom + MARGIN.bottom - 10,
    text: "Time of Day (Hours)",
    fill: "#444",
    font: FONT,
    anchor: "middle",
    baseline: "alphabetic",
  });

  prims.push(...screenLegendPrimitives(plotTop, gapLegendNeeded));

  return { width: CANVAS_WIDTH, height: totalHeight, primitives: prims };
}

/** Right-hand legend for the screen-usage timeline (end reasons + data gap). */
function screenLegendPrimitives(legendTop: number, hasGap: boolean): Primitive[] {
  const x = CANVAS_WIDTH - MARGIN.right + 16;
  let y = legendTop;
  const prims: Primitive[] = [
    {
      type: "text",
      x,
      y,
      text: "End Reason",
      fill: "#333",
      font: "bold 12px system-ui, sans-serif",
      anchor: "start",
      baseline: "middle",
    },
  ];
  y += LEGEND_LINE_H + 4;
  for (const [reason, color] of Object.entries(SCREEN_REASON_COLORS)) {
    prims.push(...legendEntry(x, y, color, SCREEN_REASON_LABELS[reason] ?? reason, { outline: true }));
    y += LEGEND_LINE_H;
  }
  if (hasGap) {
    y += 6;
    prims.push(...legendEntry(x, y, GAP_COLOR, "Data Gap", { alpha: 0.35 }));
  }
  return prims;
}

async function generateParticipantScreenPlotBlob(
  participantId: string,
  rows: ScreenPlotRow[],
  timezone: string,
  /** Preprocessor version, stamped in the plot subtitle for provenance. */
  version: string,
  /** Pre-algorithm raw event timestamps (sorted or unsorted) used for data-gap
   * shading — same source the app-usage plot uses, so both plots agree on where
   * device activity is genuinely absent. */
  preAlgoEventNs?: bigint[],
): Promise<Blob> {
  return sceneToPngBlob(
    buildScreenScene(participantId, rows, timezone, version, todayLabel(), preAlgoEventNs),
  );
}

/** Bucket plot rows by their participant_id column (missing → "unknown"). */
function groupByParticipant<T>(rows: T[]): Map<string, T[]> {
  const byParticipant = new Map<string, T[]>();
  for (const row of rows) {
    const pid = ((row as unknown as Record<string, unknown>)["participant_id"] as string) ?? "unknown";
    const arr = byParticipant.get(pid) ?? [];
    arr.push(row);
    byParticipant.set(pid, arr);
  }
  return byParticipant;
}

export async function generateAllScreenPlots(
  rows: ScreenPlotRow[],
  timezone: string,
  /** Preprocessor version, stamped in each plot subtitle. */
  version: string,
  /** Pre-algorithm event timestamps per participant (keyed by participant_id),
   * same map the app-usage plots use, so screen gaps match app gaps. */
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const gapNs = preAlgoTsByParticipant?.get(pid);
    result.set(pid, await generateParticipantScreenPlotBlob(pid, pRows, timezone, version, gapNs));
  }
  return result;
}

/** Vector (SVG) twin of {@link generateAllScreenPlots} — one SVG per participant. */
export async function generateAllScreenPlotSvgs(
  rows: ScreenPlotRow[],
  timezone: string,
  version: string,
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): Promise<Map<string, Blob>> {
  const dateStr = todayLabel();
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const scene = buildScreenScene(pid, pRows, timezone, version, dateStr, preAlgoTsByParticipant?.get(pid));
    result.set(pid, sceneToSvgBlob(scene));
  }
  return result;
}

// ─── batch entry point ────────────────────────────────────────────────────────

export async function generateAllPlots(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  /** Preprocessor version, stamped in each plot subtitle. */
  version: string,
  /** Pre-algorithm event timestamps per participant (keyed by participant_id).
   * Collected before runAppUsageAlgorithm so gap detection sees all raw event
   * types, not only the session-level rows in the final output. */
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const gapNs = preAlgoTsByParticipant?.get(pid);
    result.set(pid, await generateParticipantPlotBlob(pid, pRows, timezone, options, version, gapNs));
  }
  return result;
}

/** Vector (SVG) twin of {@link generateAllPlots} — one SVG per participant. */
export async function generateAllPlotSvgs(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): Promise<Map<string, Blob>> {
  const dateStr = todayLabel();
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const scene = buildTimelineScene(
      pid,
      pRows,
      timezone,
      options,
      version,
      dateStr,
      preAlgoTsByParticipant?.get(pid),
    );
    result.set(pid, sceneToSvgBlob(scene));
  }
  return result;
}

/** One participant's interactive timeline: the day-grid scene plus per-session
 * hover regions. Powers the in-app View tab (#18). */
export type ParticipantTimelineView = {
  participantId: string;
  scene: Scene;
  regions: SceneRegion[];
};

/** Build interactive app-usage timeline views (scene + hover regions) for every
 * participant — the same day-grid geometry as the PNG/SVG export. */
export function buildAppTimelineViews(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): ParticipantTimelineView[] {
  const dateStr = todayLabel();
  const views: ParticipantTimelineView[] = [];
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const regions: SceneRegion[] = [];
    const scene = buildTimelineScene(
      pid,
      pRows,
      timezone,
      options,
      version,
      dateStr,
      preAlgoTsByParticipant?.get(pid),
      regions,
    );
    views.push({ participantId: pid, scene, regions });
  }
  return views;
}

/** Build interactive screen-usage timeline views (scene + hover regions). */
export function buildScreenTimelineViews(
  rows: ScreenPlotRow[],
  timezone: string,
  version: string,
  preAlgoTsByParticipant?: Map<string, bigint[]>,
): ParticipantTimelineView[] {
  const dateStr = todayLabel();
  const views: ParticipantTimelineView[] = [];
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const regions: SceneRegion[] = [];
    const scene = buildScreenScene(pid, pRows, timezone, version, dateStr, preAlgoTsByParticipant?.get(pid), regions);
    views.push({ participantId: pid, scene, regions });
  }
  return views;
}

// ─── hour × day activity heatmap (#19) ──────────────────────────────────────

export type HourDayMatrix = {
  /** Calendar dates (ISO "YYYY-MM-DD"), one per heatmap row, ascending. */
  dates: string[];
  /** dates.length × 24; cell value = seconds of app usage in that (date, hour). */
  cells: number[][];
  /** Largest single-cell value, for normalising the colour scale. */
  maxCell: number;
};

/** ns → fractional local hour-of-day [0,24) in `timezone`. */
function nsToLocalHours(ns: bigint, hoursFmt: Intl.DateTimeFormat): number {
  const ms = Number(ns / 1_000_000n);
  try {
    const parts = hoursFmt.formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const s = Number(parts.find((p) => p.type === "second")?.value ?? 0);
    return (h % 24) + m / 60 + s / 3600;
  } catch {
    return (ms / 3_600_000) % 24;
  }
}

/**
 * Aggregate app-usage seconds into an hour-of-day × calendar-day matrix,
 * distributing each session across the hour buckets it overlaps (and across
 * day rows for sessions that cross midnight). Pure and unit-tested; mirrors the
 * per-day segmentation the timeline bars use.
 */
export function computeHourDayMatrix(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots"> = {
    includeFilteredAppUsageInPlots: false,
  },
): HourDayMatrix {
  const hoursFmt = getHoursFormatter(timezone);
  const dateFmt = getDateFormatter(timezone);
  const nsToIso = (ns: bigint): string => dateFmt.format(new Date(Number(ns / 1_000_000n)));

  const usageTypes = new Set([APP_USAGE_TYPE]);
  if (options.includeFilteredAppUsageInPlots) usageTypes.add(FILTERED_APP_USAGE_TYPE);

  // Seed the date axis from the calendar dates each usage session actually spans
  // (start date through stop date), not just row.date. A session crossing
  // midnight onto a day with no other activity would otherwise have its
  // post-midnight slice silently dropped — there'd be no row to land in. Using
  // session-spanned dates (rather than a contiguous min→max fill) keeps the axis
  // tight for participants with sparse activity across a wide span.
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (!usageTypes.has(row.interaction_type)) continue;
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;
    const startSerial = dateSerial(nsToIso(row.start_timestamp_ns));
    const stopSerial = dateSerial(nsToIso(row.stop_timestamp_ns));
    for (let s = startSerial; s <= stopSerial; s++) {
      dateSet.add(
        s === startSerial
          ? nsToIso(row.start_timestamp_ns)
          : new Date(s * 86_400_000).toISOString().slice(0, 10),
      );
    }
  }
  const dates = [...dateSet].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const cells: number[][] = dates.map(() => new Array<number>(24).fill(0));

  for (const row of rows) {
    if (!usageTypes.has(row.interaction_type)) continue;
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;

    const startIso = nsToIso(row.start_timestamp_ns);
    const stopIso = nsToIso(row.stop_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const di = dateIndex.get(isoD);
      if (di === undefined) continue;
      const cellRow = cells[di];
      if (cellRow === undefined) continue;

      let h0: number;
      let h1: number;
      if (s === startSerial && s === stopSerial) {
        h0 = nsToLocalHours(row.start_timestamp_ns, hoursFmt);
        h1 = nsToLocalHours(row.stop_timestamp_ns, hoursFmt);
      } else if (s === startSerial) {
        h0 = nsToLocalHours(row.start_timestamp_ns, hoursFmt);
        h1 = 24;
      } else if (s === stopSerial) {
        h0 = 0;
        h1 = nsToLocalHours(row.stop_timestamp_ns, hoursFmt);
      } else {
        h0 = 0;
        h1 = 24;
      }
      if (h1 <= h0) continue;

      for (let hour = Math.floor(h0); hour < Math.ceil(h1) && hour < 24; hour++) {
        const overlapHours = Math.min(h1, hour + 1) - Math.max(h0, hour);
        if (overlapHours > 0) cellRow[hour] += overlapHours * 3600;
      }
    }
  }

  let maxCell = 0;
  for (const cellRow of cells) {
    for (const value of cellRow) if (value > maxCell) maxCell = value;
  }
  return { dates, cells, maxCell };
}

/** White → blue sequential colour ramp for a normalised intensity in [0,1]. */
function heatColor(t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const r = Math.round(255 + (8 - 255) * clamp);
  const g = Math.round(255 + (81 - 255) * clamp);
  const b = Math.round(255 + (156 - 255) * clamp);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Build the resolution-independent {@link Scene} for an activity heatmap. Shared
 * by the PNG and SVG renderers so they cannot drift; `dateStr` is injected for
 * purity/testability.
 */
export function buildHeatmapScene(
  participantId: string,
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
  dateStr: string,
): Scene {
  const { dates, cells, maxCell } = computeHourDayMatrix(rows, timezone, options);
  if (dates.length === 0 || maxCell === 0) {
    return { width: 1, height: 1, primitives: [] };
  }

  const plotAreaHeight = dates.length * ROW_HEIGHT;
  const totalHeight = Math.max(MARGIN.top + plotAreaHeight + MARGIN.bottom, legendFloorHeight(8));
  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;
  const colWidth = plotWidth() / 24;

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight));
  prims.push({
    type: "text",
    x: MARGIN.left,
    y: 28,
    text: `${participantId} — Hourly Activity Heatmap`,
    fill: "#222",
    font: "bold 18px system-ui, sans-serif",
    anchor: "start",
    baseline: "alphabetic",
  });
  prims.push({
    type: "text",
    x: MARGIN.left,
    y: 46,
    text: `Generated ${dateStr} · v${version} · ${timezone}`,
    fill: "#777",
    font: FONT_SMALL,
    anchor: "start",
    baseline: "alphabetic",
  });

  // Cells
  for (let di = 0; di < dates.length; di++) {
    const y = plotTop + di * ROW_HEIGHT;
    const cellRow = cells[di]!;
    for (let hour = 0; hour < 24; hour++) {
      prims.push({
        type: "rect",
        x: hoursToX(hour),
        y,
        w: colWidth,
        h: ROW_HEIGHT,
        fill: heatColor(cellRow[hour]! / maxCell),
      });
    }
  }

  // Date labels (left)
  dates.forEach((d, i) => {
    prims.push({
      type: "text",
      x: MARGIN.left - 8,
      y: plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2,
      text: formatDateLabel(d),
      fill: "#555",
      font: FONT,
      anchor: "end",
      baseline: "middle",
    });
  });

  // Hour labels (top) every 2 hours
  for (let hour = 0; hour <= 24; hour += 2) {
    prims.push({
      type: "text",
      x: hoursToX(hour),
      y: plotTop - 6,
      text: String(hour),
      fill: "#666",
      font: FONT_SMALL,
      anchor: "middle",
      baseline: "alphabetic",
    });
  }

  // Grid border
  prims.push({ type: "rect", x: MARGIN.left, y: plotTop, w: plotWidth(), h: plotAreaHeight, stroke: "#ccc", strokeWidth: 1 });

  prims.push({
    type: "text",
    x: MARGIN.left + plotWidth() / 2,
    y: plotBottom + MARGIN.bottom - 10,
    text: "Time of Day (Hours)",
    fill: "#444",
    font: FONT,
    anchor: "middle",
    baseline: "alphabetic",
  });

  // Colour-scale legend (right)
  const legendX = CANVAS_WIDTH - MARGIN.right + 24;
  const legendTop = plotTop;
  const legendH = Math.min(plotAreaHeight, 200);
  const steps = 32;
  for (let i = 0; i < steps; i++) {
    const t = 1 - i / (steps - 1);
    prims.push({
      type: "rect",
      x: legendX,
      y: legendTop + (i / steps) * legendH,
      w: 16,
      h: legendH / steps + 1,
      fill: heatColor(t),
    });
  }
  const legendLabel = (x: number, y: number, text: string): Primitive => ({
    type: "text",
    x,
    y,
    text,
    fill: "#555",
    font: FONT_SMALL,
    anchor: "start",
    baseline: "middle",
  });
  prims.push(legendLabel(legendX + 22, legendTop, `${Math.round(maxCell / 60)} min`));
  prims.push(legendLabel(legendX + 22, legendTop + legendH, "0 min"));
  prims.push(legendLabel(legendX, legendTop - 12, "App usage / hour"));

  return { width: CANVAS_WIDTH, height: totalHeight, primitives: prims };
}

export async function generateParticipantHeatmapBlob(
  participantId: string,
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
): Promise<Blob> {
  return sceneToPngBlob(buildHeatmapScene(participantId, rows, timezone, options, version, todayLabel()));
}

export async function generateAllHeatmaps(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    result.set(pid, await generateParticipantHeatmapBlob(pid, pRows, timezone, options, version));
  }
  return result;
}

/** Vector (SVG) twin of {@link generateAllHeatmaps} — one SVG per participant. */
export async function generateAllHeatmapSvgs(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
): Promise<Map<string, Blob>> {
  const dateStr = todayLabel();
  const result = new Map<string, Blob>();
  for (const [pid, pRows] of groupByParticipant(rows)) {
    result.set(pid, sceneToSvgBlob(buildHeatmapScene(pid, pRows, timezone, options, version, dateStr)));
  }
  return result;
}
