/**
 * Browser-side app-usage chart generator.
 *
 * Produces a horizontal-bar timeline (one row per calendar date, bars coloured
 * by broad_app_category) that mirrors the matplotlib output from the Python
 * desktop pipeline.  Runs entirely in-browser via OffscreenCanvas / Canvas.
 */

import type { BrowserProcessingOptions } from "@/lib/types";

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

function drawBackground(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, height: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, height);
}

function drawXAxis(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, plotTop: number, plotBottom: number): void {
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 1;
  ctx.font = FONT_SMALL;
  ctx.fillStyle = "#444";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let h = 0; h <= 24; h += 4) {
    const x = hoursToX(h);
    const label = String(h).padStart(2, "0") + ":00";
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(label, x, plotBottom + 6);
  }
  ctx.textBaseline = "alphabetic";
}

function drawTitle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  participantId: string,
  includeFiltered: boolean,
  dateStr: string,
  version: string,
): void {
  // Always annotate the filtered-apps state both ways (mirrors the desktop
  // plot) so "unfiltered" is explicit, not merely the absence of a label.
  const suffix = includeFiltered ? " (Including Filtered Apps)" : " (Target Child Only)";
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    `App Usage for ${participantId}${suffix}`,
    CANVAS_WIDTH / 2,
    28,
  );
  ctx.font = FONT_SMALL;
  ctx.fillStyle = "#666";
  ctx.fillText(`Created on ${dateStr} · Preprocessor v${version}`, CANVAS_WIDTH / 2, 46);
}

function drawLegend(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  legendTop: number,
  hasShutdown: boolean,
  hasStartup: boolean,
  hasMissing: boolean,
): void {
  const x = CANVAS_WIDTH - MARGIN.right + 16;
  let y = legendTop;
  const swatchSize = 12;
  const lineH = 20;

  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillStyle = "#333";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("App Categories", x, y);
  y += lineH + 4;

  ctx.font = FONT_SMALL;
  for (const [label, color] of Object.entries(CATEGORY_COLORS)) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y - swatchSize / 2, swatchSize, swatchSize);
    ctx.fillStyle = "#333";
    ctx.fillText(label, x + swatchSize + 5, y);
    y += lineH;
  }

  y += 6;
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillStyle = "#333";
  ctx.fillText("Events & Gaps", x, y);
  y += lineH + 4;
  ctx.font = FONT_SMALL;

  ctx.fillStyle = GAP_COLOR;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#333";
  ctx.fillText("Data Gap", x + swatchSize + 5, y);
  y += lineH;

  if (hasShutdown) {
    ctx.fillStyle = "red";
    ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
    ctx.fillStyle = "#333";
    ctx.fillText("Device Shutdown", x + swatchSize + 5, y);
    y += lineH;
  }
  if (hasStartup) {
    ctx.fillStyle = "green";
    ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
    ctx.fillStyle = "#333";
    ctx.fillText("Device Startup", x + swatchSize + 5, y);
    y += lineH;
  }
  if (hasMissing) {
    ctx.fillStyle = "#888";
    ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
    ctx.fillStyle = "#333";
    ctx.fillText("End of Usage Missing", x + swatchSize + 5, y);
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  yMid: number,
  color: string,
): void {
  const len = 10;
  const headLen = 5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(x, yMid - len / 2);
  ctx.lineTo(x, yMid + len / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - headLen / 2, yMid + len / 2 - headLen);
  ctx.lineTo(x, yMid + len / 2);
  ctx.lineTo(x + headLen / 2, yMid + len / 2 - headLen);
  ctx.fill();
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Shade windows with no device activity (a "data gap") as faint grey bands.
 * Shared by the app-usage and screen-usage plots so both define a gap the same
 * way: a >1h span between consecutive raw event timestamps. `allEventNs` must be
 * sorted ascending. Returns true when at least one gap was drawn (so the caller
 * can include the "Data Gap" legend entry).
 */
function drawDataGaps(
  ctx: Ctx2D,
  allEventNs: bigint[],
  dateToY: Map<string, number>,
  nsToLocalHours: (ns: bigint) => number,
  nsToIso: (ns: bigint) => string,
): boolean {
  const GAP_THRESHOLD_NS = 3_600_000_000_000n; // 1 hour in ns
  let drewGap = false;
  for (let i = 0; i + 1 < allEventNs.length; i++) {
    const gapNs = allEventNs[i + 1]! - allEventNs[i]!;
    if (gapNs <= GAP_THRESHOLD_NS) continue;
    drewGap = true;
    const startH = nsToLocalHours(allEventNs[i]!);
    const endH = nsToLocalHours(allEventNs[i + 1]!);
    const startIso = nsToIso(allEventNs[i]!);
    const endIso = nsToIso(allEventNs[i + 1]!);
    ctx.fillStyle = GAP_COLOR;
    ctx.globalAlpha = 0.15;

    if (startIso === endIso) {
      const yCenter = dateToY.get(startIso);
      if (yCenter !== undefined) {
        const x1 = hoursToX(startH);
        const w = hoursToX(endH) - x1;
        ctx.fillRect(x1, yCenter - ROW_HEIGHT / 2, w, ROW_HEIGHT);
      }
    } else {
      // multi-day gap: fill tail of start day, full middle days, head of end day
      const yStart = dateToY.get(startIso);
      if (yStart !== undefined) {
        const x1 = hoursToX(startH);
        ctx.fillRect(x1, yStart - ROW_HEIGHT / 2, hoursToX(24) - x1, ROW_HEIGHT);
      }
      const startSerial = dateSerial(startIso);
      const endSerial = dateSerial(endIso);
      for (let s = startSerial + 1; s < endSerial; s++) {
        const isoD = new Date(s * 86_400_000).toISOString().slice(0, 10);
        const yMid = dateToY.get(isoD);
        if (yMid !== undefined) {
          ctx.fillRect(MARGIN.left, yMid - ROW_HEIGHT / 2, plotWidth(), ROW_HEIGHT);
        }
      }
      const yEnd = dateToY.get(endIso);
      if (yEnd !== undefined) {
        ctx.fillRect(MARGIN.left, yEnd - ROW_HEIGHT / 2, hoursToX(endH) - MARGIN.left, ROW_HEIGHT);
      }
    }
    ctx.globalAlpha = 1;
  }
  return drewGap;
}

/** Faint horizontal rules between date rows so they read as distinct rows now
 * that the background is uniform (no striping). Drawn early so bars/gaps overlay
 * them. Top/bottom edges are handled by the plot border, so only interior
 * boundaries are drawn. */
function drawRowSeparators(ctx: Ctx2D, rowCount: number, plotTop: number): void {
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (let i = 1; i < rowCount; i++) {
    const y = plotTop + i * ROW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + plotWidth(), y);
    ctx.stroke();
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

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
  // Collect sorted unique dates
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (row.date) dateSet.add(row.date);
  }
  const sortedDates = [...dateSet].sort();
  if (sortedDates.length === 0) {
    // Return 1×1 transparent PNG
    const fallback = buildCanvas(1);
    const ctx2 = fallback.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx2.clearRect(0, 0, 1, 1);
    return canvasToBlob(fallback);
  }

  const plotAreaHeight = sortedDates.length * ROW_HEIGHT;
  // app legend rows: categories + "Events & Gaps" header + Data Gap + up to 3
  // device-event markers (shutdown/startup/missing) + a header line.
  const totalHeight = Math.max(
    MARGIN.top + plotAreaHeight + MARGIN.bottom,
    legendFloorHeight(Object.keys(CATEGORY_COLORS).length + 6),
  );
  const canvas = buildCanvas(totalHeight);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  drawBackground(ctx, totalHeight);

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  drawTitle(ctx, participantId, options.includeFilteredAppUsageInPlots, dateStr, version);

  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;

  // date → y-center mapping (top row = earliest date)
  const dateToY = new Map<string, number>();
  sortedDates.forEach((d, i) => {
    dateToY.set(d, plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  });

  // Date row labels (no row striping — the background must stay uniform so the
  // category-coloured bars and faint gap shading read accurately; rows are
  // delimited by horizontal separator rules instead).
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#555";
  ctx.textAlign = "right";
  sortedDates.forEach((d, i) => {
    const y = plotTop + i * ROW_HEIGHT;
    ctx.fillText(formatDateLabel(d), MARGIN.left - 8, y + ROW_HEIGHT / 2);
  });

  drawRowSeparators(ctx, sortedDates.length, plotTop);
  drawXAxis(ctx, plotTop, plotBottom);

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

  // ── data-gap shading ──────────────────────────────────────────────────────
  // Use pre-algorithm timestamps when available (they include all 30+ raw event
  // types, so a gap is genuine absence of any device activity). Without them,
  // fall back to the post-algorithm event_timestamp_ns values, which only cover
  // output-type rows and will miss inter-session raw events.
  const allEventNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const gapLegendNeeded = drawDataGaps(ctx, allEventNs, dateToY, cachedNsToLocalHours, cachedNsToIso);

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
        ctx.fillStyle = color;
        ctx.fillRect(x1, yCenter - ROW_HEIGHT * 0.35, Math.max(barW, 1), ROW_HEIGHT * 0.7);
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
    const evH = cachedNsToLocalHours(evNs);
    const x = hoursToX(evH);

    if (type === DEVICE_SHUTDOWN_TYPE) {
      drawArrow(ctx, x, yCenter, "red");
      hasShutdown = true;
    } else if (type === DEVICE_STARTUP_TYPE) {
      drawArrow(ctx, x, yCenter, "green");
      hasStartup = true;
    } else {
      drawArrow(ctx, x, yCenter, "#888");
      hasMissing = true;
    }
  }

  // Plot border
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(MARGIN.left, plotTop, plotWidth(), plotAreaHeight);

  // X-axis label (anchored to the plot, not the canvas bottom, which may be
  // taller than the plot when the legend dominates).
  ctx.font = FONT;
  ctx.fillStyle = "#444";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Time of Day (Hours)", MARGIN.left + plotWidth() / 2, plotBottom + MARGIN.bottom - 10);

  drawLegend(ctx, plotTop, hasShutdown, hasStartup, hasMissing || gapLegendNeeded);

  return canvasToBlob(canvas);
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
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (row.date) dateSet.add(row.date);
  }
  const sortedDates = [...dateSet].sort();
  if (sortedDates.length === 0) {
    const fallback = buildCanvas(1);
    const ctx2 = fallback.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx2.clearRect(0, 0, 1, 1);
    return canvasToBlob(fallback);
  }

  const plotAreaHeight = sortedDates.length * ROW_HEIGHT;
  // screen legend rows: end reasons + header + Data Gap entry + spacing.
  const totalHeight = Math.max(
    MARGIN.top + plotAreaHeight + MARGIN.bottom,
    legendFloorHeight(Object.keys(SCREEN_REASON_COLORS).length + 3),
  );
  const canvas = buildCanvas(totalHeight);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  drawBackground(ctx, totalHeight);

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Screen Usage for ${participantId}`, CANVAS_WIDTH / 2, 28);
  ctx.font = FONT_SMALL;
  ctx.fillStyle = "#666";
  ctx.fillText(`Created on ${dateStr} · Preprocessor v${version}`, CANVAS_WIDTH / 2, 46);

  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;

  const dateToY = new Map<string, number>();
  sortedDates.forEach((d, i) => {
    dateToY.set(d, plotTop + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  });

  // Date row labels (no row striping — keep the background uniform so the
  // end-reason bars and faint gap shading read accurately; rows are delimited by
  // horizontal separator rules instead).
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#555";
  ctx.textAlign = "right";
  sortedDates.forEach((d, i) => {
    const y = plotTop + i * ROW_HEIGHT;
    ctx.fillText(formatDateLabel(d), MARGIN.left - 8, y + ROW_HEIGHT / 2);
  });

  drawRowSeparators(ctx, sortedDates.length, plotTop);
  drawXAxis(ctx, plotTop, plotBottom);

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

  // Data-gap shading (drawn before the session bars so bars sit on top). Uses
  // the pre-algorithm raw timestamps when supplied; otherwise the screen-session
  // event timestamps, which only mark session starts and miss inter-session
  // activity — so genuine gap detection needs the pre-algorithm timestamps.
  const screenGapNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const gapLegendNeeded = drawDataGaps(ctx, screenGapNs, dateToY, nsToLocalHours, nsToIso);

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
        ctx.fillStyle = color;
        ctx.fillRect(x1, yCenter - ROW_HEIGHT * 0.35, Math.max(barW, 1), ROW_HEIGHT * 0.7);
      }
    }
  }

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(MARGIN.left, plotTop, plotWidth(), plotAreaHeight);

  ctx.font = FONT;
  ctx.fillStyle = "#444";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Time of Day (Hours)", MARGIN.left + plotWidth() / 2, plotBottom + MARGIN.bottom - 10);

  // Legend
  const lx = CANVAS_WIDTH - MARGIN.right + 16;
  let ly = plotTop;
  const swatchSize = 12;
  const lineH = 20;
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillStyle = "#333";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("End Reason", lx, ly);
  ly += lineH + 4;
  ctx.font = FONT_SMALL;
  for (const [reason, color] of Object.entries(SCREEN_REASON_COLORS)) {
    const label = SCREEN_REASON_LABELS[reason] ?? reason;
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly - swatchSize / 2, swatchSize, swatchSize);
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly - swatchSize / 2, swatchSize, swatchSize);
    ctx.fillStyle = "#333";
    ctx.fillText(label, lx + swatchSize + 5, ly);
    ly += lineH;
  }

  if (gapLegendNeeded) {
    ly += 6;
    ctx.fillStyle = GAP_COLOR;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(lx, ly - swatchSize / 2, swatchSize, swatchSize);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#333";
    ctx.fillText("Data Gap", lx + swatchSize + 5, ly);
  }

  return canvasToBlob(canvas);
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
  const byParticipant = new Map<string, ScreenPlotRow[]>();
  for (const row of rows) {
    const pid = (row as unknown as Record<string, unknown>)["participant_id"] as string ?? "unknown";
    const arr = byParticipant.get(pid) ?? [];
    arr.push(row);
    byParticipant.set(pid, arr);
  }

  const result = new Map<string, Blob>();
  for (const [pid, pRows] of byParticipant) {
    const gapNs = preAlgoTsByParticipant?.get(pid);
    result.set(pid, await generateParticipantScreenPlotBlob(pid, pRows, timezone, version, gapNs));
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
  const byParticipant = new Map<string, PlotRow[]>();
  for (const row of rows) {
    const pid = (row as unknown as Record<string, unknown>)["participant_id"] as string ?? "unknown";
    const arr = byParticipant.get(pid) ?? [];
    arr.push(row);
    byParticipant.set(pid, arr);
  }

  const result = new Map<string, Blob>();
  for (const [pid, pRows] of byParticipant) {
    const gapNs = preAlgoTsByParticipant?.get(pid);
    result.set(pid, await generateParticipantPlotBlob(pid, pRows, timezone, options, version, gapNs));
  }
  return result;
}
