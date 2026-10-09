/**
 * Browser-side app-usage chart generator.
 *
 * Produces a horizontal-bar timeline (one row per calendar date, bars coloured
 * by broad_app_category) that mirrors the matplotlib output from the Python
 * desktop pipeline.  Runs entirely in-browser via OffscreenCanvas / Canvas.
 */

import { BUILD_LABEL } from "@/lib/buildInfo";
import { requireDefined } from "@/lib/invariant";
import type { Primitive, Scene, SceneRegion } from "@/lib/plotScene";
import { sceneToSvgBlob, textPaintX, type DstRowMarks } from "@/lib/plotScene";
import type { BrowserProcessingOptions } from "@/lib/types";

const LOOP_BOUND_INVARIANT = "the loop bound `i + 1 < length` keeps both indices inside the array";

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
      ctx.fillText(p.text, textPaintX(p), p.y);
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
  application_label?: string | null;
  username?: string;
};

// ─── constants ────────────────────────────────────────────────────────────────

/** Fallback for categories missing from {@link CATEGORY_COLORS} (also its "Uncategorised" entry). */
const UNCATEGORISED_COLOR = "#222222";

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
  "System / OEM": "#a9a9a9",
  "Uncategorised": UNCATEGORISED_COLOR,
  "Unknown": "#555555",
};

/**
 * The kernel coalesces four codebook category columns without normalizing,
 * so a row's category arrives in the Play-Store title case above, babyemu's
 * UPPER_SNAKE (`GAMING`, `PRODUCTIVITY_AND_BUSINESS`) or the BCM heuristic's
 * `System/OEM`. 3,401 of the shipped codebook's 12,531 packages carry an
 * off-palette spelling, and every one drew as "Uncategorised" black while the
 * legend showed a swatch the plot never used. Spellings are folded here;
 * a value that still matches nothing keeps the Uncategorised colour.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  GAMING: "Games",
  GAME: "Games",
  VIDEO: "Video Players (e.g. YouTube)",
  VIDEO_PLAYERS: "Video Players (e.g. YouTube)",
  COMMUNICATION: "Social & Communication",
  SOCIAL: "Social & Communication",
  SOCIAL_AND_COMMUNICATION: "Social & Communication",
  PRODUCTIVITY_AND_BUSINESS: "Productivity & Business",
  PRODUCTIVITY: "Productivity & Business",
  UTILITIES: "Productivity & Business",
  TOOLS: "Productivity & Business",
  LIFESTYLE_MANAGEMENT: "Lifestyle",
  ARTS_AND_LEISURE: "Entertainment",
  KNOWLEDGE_AND_INFORMATION: "Education",
  SYSTEM_OEM: "System / OEM",
  OTHER: "Uncategorised",
};

function normalizeCategoryKey(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CATEGORY_COLOR_BY_KEY: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [label, color] of Object.entries(CATEGORY_COLORS)) {
    map.set(normalizeCategoryKey(label), color);
  }
  for (const [alias, label] of Object.entries(CATEGORY_ALIASES)) {
    map.set(alias, CATEGORY_COLORS[label] ?? UNCATEGORISED_COLOR);
  }
  return map;
})();

/** Palette colour for a row's derived category, whatever its source spelling. */
export function categoryColor(label: string | null | undefined): string {
  if (label === null || label === undefined) return CATEGORY_COLORS["Unknown"] ?? UNCATEGORISED_COLOR;
  return (
    CATEGORY_COLORS[label] ??
    CATEGORY_COLOR_BY_KEY.get(normalizeCategoryKey(label)) ??
    UNCATEGORISED_COLOR
  );
}
const GAP_COLOR = "#808080";

const APP_USAGE_TYPE = "App Usage";
const FILTERED_APP_USAGE_TYPE = "Filtered App Usage";
/** Construct-and-mark category: a filtered app's CONSTRUCTED background session
 * (real timing). Plots as a bar (not an event tick) under the same
 * include-filtered toggle. */
const FILTERED_APP_BACKGROUND_USAGE_TYPE = "Filtered App Background Usage";
const FILTERED_USAGE_EVENT_DETAIL = "Filtered App Usage event";
const DEVICE_SHUTDOWN_TYPE = "Device Shutdown";
const DEVICE_STARTUP_TYPE = "Device Startup";
const END_OF_USAGE_MISSING_TYPE = "End of Usage Missing";

// Canvas layout constants
const CANVAS_WIDTH = 1800;
const ROW_HEIGHT = 28;
const MARGIN = { top: 60, right: 260, bottom: 60, left: 160 };
const FONT = "13px system-ui, sans-serif";
const FONT_SMALL = "11px system-ui, sans-serif";
const FONT_TINY = "9px system-ui, sans-serif";

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

/**
 * Local-day geometry in one timezone. Every plot row is one local calendar
 * day, and a position within it is REAL elapsed time since that day began, so
 * a DST day is a 23 h (spring-forward) or 25 h (fall-back) row: the repeated
 * fall-back hour gets its own slot instead of drawing on top of (or, for a
 * session ending in the second pass, vanishing behind) the first, and the
 * skipped spring-forward hour takes no width. On a 24 h day elapsed time is
 * clock time, and the h + m/60 + s/3600 form reproduces the old clock-time
 * values bit for bit.
 */
type DayClock = {
  /** Local calendar date ("YYYY-MM-DD") of an instant. */
  iso: (ns: bigint) => string;
  /** Elapsed hours (whole-second precision) since the start of that date. */
  hours: (ns: bigint) => number;
  /** Real length of a local date in hours: 24, or 23/25 on a DST day. */
  dayHours: (iso: string) => number;
  /** Wall-clock minute of the day (0–1439) `elapsedH` hours after a date began. */
  clockMinutes: (iso: string, elapsedH: number) => number;
};

function makeDayClock(timezone: string): DayClock {
  const hoursFmt = getHoursFormatter(timezone);
  const dateFmt = getDateFormatter(timezone);
  const isoCache = new Map<bigint, string>();
  const hoursCache = new Map<bigint, number>();
  const startCache = new Map<string, number>();

  const isoOfMs = (ms: number): string => dateFmt.format(new Date(ms));
  function iso(ns: bigint): string {
    let v = isoCache.get(ns);
    if (v === undefined) {
      v = isoOfMs(Number(ns / 1_000_000n));
      isoCache.set(ns, v);
    }
    return v;
  }
  /** First whole second whose local date is `date` (local midnight, or the
   * first instant after a transition that skips midnight). UTC offsets lie in
   * [-12 h, +14 h], so it falls inside the searched window. */
  function dayStartMs(date: string): number {
    let v = startCache.get(date);
    if (v === undefined) {
      const utcMidnight = dateSerial(date) * 86_400_000;
      let lo = utcMidnight - 15 * 3_600_000;
      let hi = utcMidnight + 13 * 3_600_000;
      while (hi - lo > 1000) {
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
        if (isoOfMs(mid) >= date) hi = mid;
        else lo = mid;
      }
      v = hi;
      startCache.set(date, v);
    }
    return v;
  }
  function hours(ns: bigint): number {
    let v = hoursCache.get(ns);
    if (v === undefined) {
      const ms = Number(ns / 1_000_000n);
      try {
        const sec = Math.floor((ms - dayStartMs(iso(ns))) / 1000);
        v = Math.floor(sec / 3600) + Math.floor((sec % 3600) / 60) / 60 + (sec % 60) / 3600;
      } catch {
        v = (ms / 3_600_000) % 24;
      }
      hoursCache.set(ns, v);
    }
    return v;
  }
  return {
    iso,
    hours,
    dayHours: (date) => (dayStartMs(serialToIso(dateSerial(date) + 1)) - dayStartMs(date)) / 3_600_000,
    clockMinutes: (date, elapsedH) => {
      const parts = hoursFmt.formatToParts(new Date(dayStartMs(date) + elapsedH * 3_600_000));
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
      return h * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    },
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function serialToIso(serial: number): string {
  return new Date(serial * 86_400_000).toISOString().slice(0, 10);
}

/** ISO "YYYY-MM-DD" → integer day serial (days since 2000-01-01, arbitrary but stable) */
/** Every local calendar date from a session's start through its stop. */
function addSessionSpannedDates(
  dateSet: Set<string>,
  rows: ReadonlyArray<{ start_timestamp_ns: bigint | null; stop_timestamp_ns: bigint | null }>,
  dateFmt: Intl.DateTimeFormat,
): void {
  const iso = (ns: bigint): string => dateFmt.format(new Date(Number(ns / 1_000_000n)));
  for (const row of rows) {
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;
    const startIso = iso(row.start_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(iso(row.stop_timestamp_ns));
    for (let s = startSerial; s <= stopSerial; s++) {
      dateSet.add(s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10));
    }
  }
}

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

/** "HH:MM:SS" for a ns timestamp in the formatter's timezone. Uses parts (not
 * `format`) so midnight reads "00:..", never "24:..", matching `nsToLocalHours`. */
function nsToClock(fmt: Intl.DateTimeFormat, ns: bigint): string {
  const ms = Number(ns / 1_000_000n);
  try {
    const parts = fmt.formatToParts(new Date(ms));
    const hh = String(Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24).padStart(2, "0");
    const mm = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
    const ss = (parts.find((p) => p.type === "second")?.value ?? "00").padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "";
  }
}

/** A "start → stop" tooltip line for a session, dating both ends only when the
 * session spans more than one calendar day (the day-grid row already gives the
 * date, so a same-day session needs the date prefix just once). */
function formatSessionRange(
  fmt: Intl.DateTimeFormat,
  startIso: string,
  startNs: bigint,
  stopIso: string,
  stopNs: bigint,
): string {
  const a = nsToClock(fmt, startNs);
  const b = nsToClock(fmt, stopNs);
  return startIso === stopIso
    ? `${startIso} ${a} → ${b}`
    : `${startIso} ${a} → ${stopIso} ${b}`;
}

// ─── core ─────────────────────────────────────────────────────────────────────

function buildCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  // DOM-only fallback: reached only when OffscreenCanvas is absent, which never
  // happens in a real browser (all supported targets have it) or in the node
  // test env (which stubs OffscreenCanvas). No algorithm.
  /* v8 ignore start */
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
  /* v8 ignore stop */
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

/** The app-usage timeline title, including its explicit filtered-apps state. */
function appTimelineTitle(
  participantId: string,
  includeFiltered: boolean,
): string {
  // Always annotate the filtered-apps state both ways (mirrors the desktop
  // plot) so "unfiltered" is explicit, not merely the absence of a label.
  const suffix = includeFiltered ? " (Including Filtered Apps)" : " (Excluding Filtered Apps)";
  return `App Usage for ${participantId}${suffix}`;
}

/**
 * Title + subtitle primitives for the app-usage and screen-usage report scenes.
 *
 * The subtitle carries the timezone. Every hour position in both scenes is
 * computed through `Intl` in that zone, so a plot without it cannot be read
 * back correctly — the heatmap has always stamped it and these two did not,
 * which made two exports of the same run disagree about what "14:00" meant.
 * Both scenes share this one builder so PNG, SVG, and any other consumer of the
 * Scene cannot drift apart.
 */
function titlePrimitives(
  title: string,
  dateStr: string,
  version: string,
  timezone: string,
): Primitive[] {
  return [
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 28,
      text: title,
      fill: "#111",
      font: "bold 16px system-ui, sans-serif",
      anchor: "middle",
      baseline: "alphabetic",
    },
    {
      type: "text",
      x: CANVAS_WIDTH / 2,
      y: 46,
      text: `Created on ${dateStr} · Preprocessor v${version} · build ${BUILD_LABEL} · ${timezone}`,
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
  shiftX = 0,
): Primitive[] {
  const x = CANVAS_WIDTH - MARGIN.right + 16 + shiftX;
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
  /** When provided, a hover hit-region (scene coords) is collected for every gap
   * band, carrying the gap's exact start→stop time. Omitted by the PNG/SVG paths. */
  regionsOut?: SceneRegion[],
  /** Clock formatter ("HH:MM:SS") for the gap tooltip; required to emit regions. */
  nsToClock?: (ns: bigint) => string,
  /** Real length of a date row in hours (23/25 on a DST day); 24 when omitted. */
  dayHours: (iso: string) => number = () => 24,
): { rects: GapRect[]; hadGap: boolean } {
  const GAP_THRESHOLD_NS = 3_600_000_000_000n; // 1 hour in ns
  const rects: GapRect[] = [];
  let hadGap = false;
  for (let i = 0; i + 1 < allEventNs.length; i++) {
    const currentNs = requireDefined(allEventNs[i], LOOP_BOUND_INVARIANT);
    const nextNs = requireDefined(allEventNs[i + 1], LOOP_BOUND_INVARIANT);
    const gapNs = nextNs - currentNs;
    if (gapNs <= GAP_THRESHOLD_NS) continue;
    hadGap = true;
    const startH = nsToLocalHours(currentNs);
    const endH = nsToLocalHours(nextNs);
    const startIso = nsToIso(currentNs);
    const endIso = nsToIso(nextNs);

    // One tooltip describes the whole gap; every band of a multi-day gap shares
    // it so hovering any band shows the gap's full extent.
    let gapLines: string[] | null = null;
    if (regionsOut && nsToClock) {
      const gapMin = Number(gapNs) / 60_000_000_000;
      const dur = gapMin >= 60 ? `${(gapMin / 60).toFixed(1)} h` : `${gapMin.toFixed(1)} min`;
      const a = nsToClock(currentNs);
      const b = nsToClock(nextNs);
      const range =
        startIso === endIso ? `${startIso} ${a} → ${b}` : `${startIso} ${a} → ${endIso} ${b}`;
      gapLines = [`No device events · ${dur}`, range];
    }
    const pushRect = (r: GapRect): void => {
      rects.push(r);
      if (regionsOut && gapLines) regionsOut.push({ ...r, title: "Data gap", lines: gapLines });
    };

    if (startIso === endIso) {
      const yCenter = dateToY.get(startIso);
      if (yCenter !== undefined) {
        const x1 = hoursToX(startH);
        pushRect({ x: x1, y: yCenter - ROW_HEIGHT / 2, w: hoursToX(endH) - x1, h: ROW_HEIGHT });
      }
    } else {
      // multi-day gap: fill tail of start day, full middle days, head of end day
      const yStart = dateToY.get(startIso);
      if (yStart !== undefined) {
        const x1 = hoursToX(startH);
        pushRect({ x: x1, y: yStart - ROW_HEIGHT / 2, w: hoursToX(dayHours(startIso)) - x1, h: ROW_HEIGHT });
      }
      const startSerial = dateSerial(startIso);
      const endSerial = dateSerial(endIso);
      for (let s = startSerial + 1; s < endSerial; s++) {
        const isoD = new Date(s * 86_400_000).toISOString().slice(0, 10);
        const yMid = dateToY.get(isoD);
        if (yMid !== undefined) {
          pushRect({ x: MARGIN.left, y: yMid - ROW_HEIGHT / 2, w: (plotWidth() * dayHours(isoD)) / 24, h: ROW_HEIGHT });
        }
      }
      const yEnd = dateToY.get(endIso);
      if (yEnd !== undefined) {
        pushRect({ x: MARGIN.left, y: yEnd - ROW_HEIGHT / 2, w: hoursToX(endH) - MARGIN.left, h: ROW_HEIGHT });
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

const WF = {
  width: 1200,
  gutter: 112,
  padRight: 0,
  padTop: 6,
  padBottom: 10,
  rowH: 32,
};

function wfPlotWidth(): number {
  return WF.width - WF.gutter - WF.padRight;
}

function wfHoursToX(h: number): number {
  return WF.gutter + (h / 24) * wfPlotWidth();
}

/** Shared waterfall x-geometry (width, gutter, plot area, hour→x mapping). The
 * A/B comparison scene reuses this so its rows line up pixel-for-pixel with the
 * single-arm waterfalls it's built from. */
export const WATERFALL_GEOMETRY = {
  width: WF.width,
  gutter: WF.gutter,
  get plotWidth(): number {
    return wfPlotWidth();
  },
  hoursToX: wfHoursToX,
} as const;

export type WaterfallSession = {
  startNs: bigint;
  stopNs: bigint;
  instant?: boolean;
  color: string;
  title: string;
  detail: string[];
};

export type WaterfallMarker = {
  ns: bigint;
  color: string;
  title: string;
  detail?: string[];
};

/**
 * Bare, full-width waterfall scene for the interactive surfaces. This is
 * intentionally separate from `buildTimelineScene` / `buildScreenScene` so the
 * report PNG/SVG geometry, legends, axes, and unit-tested gap layout stay
 * unchanged.
 */
export function buildWaterfallScene(
  sessions: WaterfallSession[],
  allEventNs: bigint[],
  timezone: string,
  regionsOut?: SceneRegion[],
  markers: WaterfallMarker[] = [],
): Scene {
  if (sessions.length === 0 && markers.length === 0) {
    return { width: 1, height: 1, primitives: [] };
  }

  const hoursFmt = getHoursFormatter(timezone);
  const clock = makeDayClock(timezone);
  const nsToLocalHours = clock.hours;
  const nsToIso = clock.iso;

  const dateSet = new Set<string>();
  let minDateSerial = Number.POSITIVE_INFINITY;
  let maxDateSerial = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    const startIso = nsToIso(session.startNs);
    const stopIso = nsToIso(session.stopNs);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);
    minDateSerial = Math.min(minDateSerial, startSerial, stopSerial);
    maxDateSerial = Math.max(maxDateSerial, startSerial, stopSerial);
    for (let s = startSerial; s <= stopSerial; s++) {
      dateSet.add(s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10));
    }
  }
  for (const marker of markers) {
    const date = nsToIso(marker.ns);
    dateSet.add(date);
    const daySerial = dateSerial(date);
    minDateSerial = Math.min(minDateSerial, daySerial);
    maxDateSerial = Math.max(maxDateSerial, daySerial);
  }

  for (const eventNs of allEventNs) {
    const date = nsToIso(eventNs);
    dateSet.add(date);
    const daySerial = dateSerial(date);
    minDateSerial = Math.min(minDateSerial, daySerial);
    maxDateSerial = Math.max(maxDateSerial, daySerial);
  }

  if (Number.isFinite(minDateSerial) && Number.isFinite(maxDateSerial)) {
    for (let day = minDateSerial; day <= maxDateSerial; day++) {
      dateSet.add(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  }

  const sortedDates = [...dateSet].sort();
  const height = WF.padTop + sortedDates.length * WF.rowH + WF.padBottom;
  // A 25 h fall-back row runs past the 24 h mark; widen the scene to hold it.
  const extraW = dstExtraWidth(sortedDates, clock, wfPlotWidth());
  const width = WF.width + extraW;
  const rowsMeta = sortedDates.map((date, i) => {
    const dst = dstRowMarks(clock, date);
    return { date, y: WF.padTop + i * WF.rowH, h: WF.rowH, ...(dst ? { dst } : {}) };
  });
  const dateToY = new Map<string, number>();
  sortedDates.forEach((d, i) => {
    dateToY.set(d, WF.padTop + i * WF.rowH + WF.rowH / 2);
  });

  const prims: Primitive[] = [
    { type: "rect", x: 0, y: 0, w: width, h: height, fill: "#ffffff" },
  ];

  for (const [i, d] of sortedDates.entries()) {
    prims.push({
      type: "text",
      x: WF.gutter - 10,
      y: WF.padTop + i * WF.rowH + WF.rowH / 2,
      text: formatDateLabel(d),
      fill: "#555",
      font: FONT_SMALL,
      anchor: "end",
      baseline: "middle",
    });
  }

  for (let i = 1; i < sortedDates.length; i++) {
    const y = WF.padTop + i * WF.rowH;
    prims.push({
      type: "line",
      x1: 0,
      y1: y,
      x2: width,
      y2: y,
      stroke: "#e4e7eb",
      strokeWidth: 1,
    });
  }

  for (const row of rowsMeta) {
    if (row.dst) prims.push(...dstRowPrimitives(row.dst, row.y, row.h, wfHoursToX));
  }

  const gapRegions: SceneRegion[] = [];
  const sortedEvents = allEventNs.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const GAP_THRESHOLD_NS = 3_600_000_000_000n;
  const pushGapRect = (r: GapRect, lines: string[]): void => {
    prims.push({ type: "rect", x: r.x, y: r.y, w: r.w, h: r.h, fill: GAP_COLOR, alpha: 0.15 });
    if (regionsOut) gapRegions.push({ ...r, title: "Data gap", lines, kind: "gap" });
  };

  for (let i = 0; i + 1 < sortedEvents.length; i++) {
    const startNs = requireDefined(sortedEvents[i], LOOP_BOUND_INVARIANT);
    const endNs = requireDefined(sortedEvents[i + 1], LOOP_BOUND_INVARIANT);
    const gapNs = endNs - startNs;
    if (gapNs <= GAP_THRESHOLD_NS) continue;

    const startIso = nsToIso(startNs);
    const endIso = nsToIso(endNs);
    const gapMin = Number(gapNs) / 60_000_000_000;
    const dur = gapMin >= 60 ? `${(gapMin / 60).toFixed(1)} h` : `${gapMin.toFixed(1)} min`;
    const range =
      startIso === endIso
        ? `${startIso} ${nsToClock(hoursFmt, startNs)} → ${nsToClock(hoursFmt, endNs)}`
        : `${startIso} ${nsToClock(hoursFmt, startNs)} → ${endIso} ${nsToClock(hoursFmt, endNs)}`;
    const lines = [`No device events · ${dur}`, range];

    if (startIso === endIso) {
      const yCenter = dateToY.get(startIso);
      if (yCenter !== undefined) {
        const x1 = wfHoursToX(nsToLocalHours(startNs));
        pushGapRect({ x: x1, y: yCenter - WF.rowH / 2, w: wfHoursToX(nsToLocalHours(endNs)) - x1, h: WF.rowH }, lines);
      }
    } else {
      const yStart = dateToY.get(startIso);
      if (yStart !== undefined) {
        const x1 = wfHoursToX(nsToLocalHours(startNs));
        pushGapRect({ x: x1, y: yStart - WF.rowH / 2, w: wfHoursToX(clock.dayHours(startIso)) - x1, h: WF.rowH }, lines);
      }
      const startSerial = dateSerial(startIso);
      const endSerial = dateSerial(endIso);
      for (let s = startSerial + 1; s < endSerial; s++) {
        const isoD = new Date(s * 86_400_000).toISOString().slice(0, 10);
        const yMid = dateToY.get(isoD);
        if (yMid !== undefined) {
          pushGapRect({ x: WF.gutter, y: yMid - WF.rowH / 2, w: (wfPlotWidth() * clock.dayHours(isoD)) / 24, h: WF.rowH }, lines);
        }
      }
      const yEnd = dateToY.get(endIso);
      if (yEnd !== undefined) {
        pushGapRect({ x: WF.gutter, y: yEnd - WF.rowH / 2, w: wfHoursToX(nsToLocalHours(endNs)) - WF.gutter, h: WF.rowH }, lines);
      }
    }
  }

  for (const session of sessions) {
    const startIso = nsToIso(session.startNs);
    const stopIso = nsToIso(session.stopNs);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);
    const range = session.instant
      ? `${startIso} ${nsToClock(hoursFmt, session.startNs)}`
      : formatSessionRange(hoursFmt, startIso, session.startNs, stopIso, session.stopNs);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const yCenter = dateToY.get(isoD);
      if (yCenter === undefined) continue;

      let x1: number;
      let barW: number;
      if (session.instant) {
        x1 = wfHoursToX(nsToLocalHours(session.startNs));
        barW = 1;
      } else if (s === startSerial && s === stopSerial) {
        x1 = wfHoursToX(nsToLocalHours(session.startNs));
        barW = wfHoursToX(Math.min(nsToLocalHours(session.stopNs), clock.dayHours(isoD))) - x1;
      } else if (s === startSerial) {
        x1 = wfHoursToX(nsToLocalHours(session.startNs));
        barW = wfHoursToX(clock.dayHours(isoD)) - x1;
      } else if (s === stopSerial) {
        x1 = WF.gutter;
        barW = wfHoursToX(nsToLocalHours(session.stopNs)) - x1;
      } else {
        x1 = WF.gutter;
        barW = (wfPlotWidth() * clock.dayHours(isoD)) / 24;
      }

      if (barW <= 0) continue;
      const ry = yCenter - WF.rowH * 0.35;
      const rw = Math.max(barW, 1);
      const rh = WF.rowH * 0.7;
      prims.push({ type: "rect", x: x1, y: ry, w: rw, h: rh, fill: session.color });
      if (regionsOut) {
        regionsOut.push({
          x: x1,
          y: ry,
          w: rw,
          h: rh,
          title: session.title,
          lines: [...session.detail, range],
          fill: session.color,
          kind: "session",
        });
      }
    }
  }

  for (const marker of markers) {
    const iso = nsToIso(marker.ns);
    const yCenter = dateToY.get(iso);
    if (yCenter === undefined) continue;
    const x = wfHoursToX(nsToLocalHours(marker.ns));
    prims.push(...arrowPrimitives(x, yCenter, marker.color));
    if (regionsOut) {
      regionsOut.push({
        x: x - 8,
        y: yCenter - 10,
        w: 16,
        h: 20,
        title: marker.title,
        lines: [...(marker.detail ?? []), `${iso} ${nsToClock(hoursFmt, marker.ns)}`],
        fill: marker.color,
        kind: "marker",
      });
    }
  }

  if (regionsOut) regionsOut.push(...gapRegions);

  return {
    width,
    height,
    primitives: prims,
    meta: {
      kind: "waterfall",
      gutter: WF.gutter,
      plotWidth: wfPlotWidth() + extraW,
      rows: rowsMeta,
    },
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

/** White page background covering the whole canvas. */
function backgroundPrimitive(height: number, extraW = 0): Primitive {
  return { type: "rect", x: 0, y: 0, w: CANVAS_WIDTH + extraW, h: height, fill: "#ffffff" };
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

/** Width a plot must grow by so its longest (25 h fall-back) row fits; 0 when
 * every row is 24 h or shorter, which leaves the layout untouched. */
function dstExtraWidth(dates: readonly string[], clock: DayClock, fullDayWidth: number): number {
  const longest = dates.reduce((max, d) => Math.max(max, clock.dayHours(d)), 24);
  return ((longest - 24) / 24) * fullDayWidth;
}

/** "H", or "H:MM" off the hour (half-hour zones such as Australia/Lord_Howe). */
function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

/** A DST row's real length and the wall clock at each elapsed hour
 * (…0,1,1,2… on fall-back, …1,3… on spring-forward, 1,2,3… when midnight
 * itself is skipped); undefined on a 24 h row. */
function dstRowMarks(clock: DayClock, date: string): DstRowMarks | undefined {
  const dayHours = clock.dayHours(date);
  if (dayHours === 24) return undefined;
  const labels: string[] = [];
  for (let k = 0; k < dayHours; k++) labels.push(clockLabel(clock.clockMinutes(date, k)));
  return { dayHours, labels };
}

/**
 * Marks for a DST (non-24 h) row, which the shared hour axis cannot describe:
 * its clock labels, the missing tail of a short row, and a rule at the row's
 * real end. Drawn before the bars so bars stay on top. Labels are anchored at
 * their hour with the pad in `dx`, so a zoomed row moves them with their hour.
 * Shared with the A/B comparison scene, which reads the marks from row meta.
 */
export function dstRowPrimitives(
  marks: DstRowMarks,
  rowTop: number,
  rowH: number,
  toX: (h: number) => number,
): Primitive[] {
  const dayH = marks.dayHours;
  const prims: Primitive[] = [];
  const endX = toX(dayH);
  if (dayH < 24) prims.push({ type: "rect", x: endX, y: rowTop, w: toX(24) - endX, h: rowH, fill: "#f3f3f3" });
  marks.labels.forEach((text, k) => {
    prims.push({
      type: "text",
      x: toX(k),
      dx: 2,
      y: rowTop + 1,
      text,
      fill: "#888",
      font: FONT_TINY,
      anchor: "start",
      baseline: "top",
    });
  });
  prims.push({ type: "line", x1: endX, y1: rowTop, x2: endX, y2: rowTop + rowH, stroke: "#666", strokeWidth: 1.5 });
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
  // The bar loop below walks every date a session spans; a date with no row
  // of its own had no axis slot, and the post-midnight slice was dropped.
  // Seed the spanned dates the way the heatmap does.
  addSessionSpannedDates(dateSet, rows, getDateFormatter(timezone));
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
  const hoursFmt = getHoursFormatter(timezone);
  const clock = makeDayClock(timezone);
  const cachedNsToLocalHours = clock.hours;
  const cachedNsToIso = clock.iso;
  // A 25 h fall-back row runs past the 24 h mark; widen the canvas to hold it.
  const extraW = dstExtraWidth(sortedDates, clock, plotWidth());

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight, extraW));
  prims.push(
    ...titlePrimitives(
      appTimelineTitle(participantId, options.includeFilteredAppUsageInPlots),
      dateStr,
      version,
      timezone,
    ),
  );

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
  sortedDates.forEach((d, i) => {
    const marks = dstRowMarks(clock, d);
    if (marks) prims.push(...dstRowPrimitives(marks, plotTop + i * ROW_HEIGHT, ROW_HEIGHT, hoursToX));
  });

  // ── data-gap shading ──────────────────────────────────────────────────────
  // Use pre-algorithm timestamps when available (they include all 30+ raw event
  // types, so a gap is genuine absence of any device activity). Without them,
  // fall back to the post-algorithm event_timestamp_ns values, which only cover
  // output-type rows and will miss inter-session raw events.
  const allEventNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const gapRegions: SceneRegion[] = [];
  const { rects: gapRects, hadGap: gapLegendNeeded } = computeDataGapRects(
    allEventNs,
    dateToY,
    cachedNsToLocalHours,
    cachedNsToIso,
    regionsOut ? gapRegions : undefined,
    regionsOut ? (ns) => nsToClock(hoursFmt, ns) : undefined,
    clock.dayHours,
  );
  prims.push(...gapPrimitives(gapRects));

  // ── app-usage bars ────────────────────────────────────────────────────────
  const usageTypes = new Set([APP_USAGE_TYPE]);
  if (options.includeFilteredAppUsageInPlots) {
    usageTypes.add(FILTERED_APP_USAGE_TYPE);
    usageTypes.add(FILTERED_APP_BACKGROUND_USAGE_TYPE);
  }

  for (const row of rows) {
    if (!usageTypes.has(row.interaction_type)) continue;

    const color = categoryColor(row.broad_app_category);

    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) {
      if (row.interaction_type !== FILTERED_APP_USAGE_TYPE) continue;
      const eventIso = cachedNsToIso(row.event_timestamp_ns);
      const yCenter = dateToY.get(eventIso) ?? dateToY.get(row.date);
      if (yCenter === undefined) continue;
      const x = hoursToX(cachedNsToLocalHours(row.event_timestamp_ns));
      const ry = yCenter - ROW_HEIGHT * 0.35;
      prims.push({ type: "rect", x, y: ry, w: 2, h: ROW_HEIGHT * 0.7, fill: color });
      if (regionsOut) {
        regionsOut.push({
          x,
          y: ry,
          w: 2,
          h: ROW_HEIGHT * 0.7,
          title: row.app_package_name || "(app)",
          lines: [
            row.broad_app_category ?? "Unknown",
            FILTERED_USAGE_EVENT_DETAIL,
            `${eventIso} ${nsToClock(hoursFmt, row.event_timestamp_ns)}`,
          ],
        });
      }
      continue;
    }

    const startIso = cachedNsToIso(row.start_timestamp_ns);
    const stopIso = cachedNsToIso(row.stop_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const yCenter = dateToY.get(isoD);
      if (yCenter === undefined) continue;

      let x1: number, barW: number;
      const dayH = clock.dayHours(isoD);
      if (s === startSerial && s === stopSerial) {
        const sh = cachedNsToLocalHours(row.start_timestamp_ns);
        const eh = cachedNsToLocalHours(row.stop_timestamp_ns);
        x1 = hoursToX(sh);
        barW = hoursToX(Math.min(eh, dayH)) - x1;
      } else if (s === startSerial) {
        const sh = cachedNsToLocalHours(row.start_timestamp_ns);
        x1 = hoursToX(sh);
        barW = hoursToX(dayH) - x1;
      } else if (s === stopSerial) {
        const eh = cachedNsToLocalHours(row.stop_timestamp_ns);
        x1 = MARGIN.left;
        barW = hoursToX(eh) - x1;
      } else {
        x1 = MARGIN.left;
        barW = (plotWidth() * dayH) / 24;
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
            lines: [
              row.broad_app_category ?? "Unknown",
              `${durMin.toFixed(1)} min · ${row.interaction_type}`,
              formatSessionRange(hoursFmt, startIso, row.start_timestamp_ns, stopIso, row.stop_timestamp_ns),
            ],
          });
        }
      }
    }
  }

  // Gap regions last so a session bar wins the hover hit-test on any overlap.
  if (regionsOut) regionsOut.push(...gapRegions);

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

  prims.push(...legendPrimitives(plotTop, hasShutdown, hasStartup, hasMissing, gapLegendNeeded, extraW));

  return { width: CANVAS_WIDTH + extraW, height: totalHeight, primitives: prims };
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function sceneToPngBlob(scene: Scene): Promise<Blob> {
  const canvas = buildCanvas(Math.max(scene.width, CANVAS_WIDTH), scene.height);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  renderSceneToCanvas(ctx, scene);
  return canvasToBlob(canvas);
}

async function generateParticipantPlotBlob(
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
  // DOM-only fallback: the HTMLCanvasElement.toBlob path is reached only when
  // buildCanvas returned a real <canvas>, i.e. when OffscreenCanvas is absent
  // (never in a browser or the stubbed test env).
  /* v8 ignore start */
  return new Promise<Blob>((resolve, reject) => {
    (canvas).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
  /* v8 ignore stop */
}

// ─── screen-usage plot ────────────────────────────────────────────────────────

type ScreenPlotRow = {
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  screen_usage_end_reason?: string | null;
};

/** Fallback for reasons missing from {@link SCREEN_REASON_COLORS} (also its "unknown" entry). */
const UNKNOWN_SCREEN_REASON_COLOR = "#9E9E9E";

const SCREEN_REASON_COLORS: Record<string, string> = {
  probable_manual_lock: "#4CAF50",
  probable_auto_lock: "#2196F3",
  app_kept_awake_or_extended: "#FF9800",
  lock_screen_only: "#9C27B0",
  extended_idle_or_unknown: "#607D8B",
  unknown: UNKNOWN_SCREEN_REASON_COLOR,
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
  addSessionSpannedDates(dateSet, rows, getDateFormatter(timezone));
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

  const hoursFmt = getHoursFormatter(timezone);
  const clock = makeDayClock(timezone);
  const nsToLocalHours = clock.hours;
  const nsToIso = clock.iso;
  const extraW = dstExtraWidth(sortedDates, clock, plotWidth());

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight, extraW));
  prims.push(
    ...titlePrimitives(
      `Screen Usage for ${participantId}`,
      dateStr,
      version,
      timezone,
    ),
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
  sortedDates.forEach((d, i) => {
    const marks = dstRowMarks(clock, d);
    if (marks) prims.push(...dstRowPrimitives(marks, plotTop + i * ROW_HEIGHT, ROW_HEIGHT, hoursToX));
  });

  // Data-gap shading (drawn before the session bars so bars sit on top). Uses
  // the pre-algorithm raw timestamps when supplied; otherwise the screen-session
  // event timestamps, which only mark session starts and miss inter-session
  // activity — so genuine gap detection needs the pre-algorithm timestamps.
  const screenGapNs = (preAlgoEventNs ?? rows.map((r) => r.event_timestamp_ns)).slice().sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const gapRegions: SceneRegion[] = [];
  const { rects: gapRects, hadGap: gapLegendNeeded } = computeDataGapRects(
    screenGapNs,
    dateToY,
    nsToLocalHours,
    nsToIso,
    regionsOut ? gapRegions : undefined,
    regionsOut ? (ns) => nsToClock(hoursFmt, ns) : undefined,
    clock.dayHours,
  );
  prims.push(...gapPrimitives(gapRects));

  // End-reason coloured session bars.
  for (const row of rows) {
    if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;

    const reason = row.screen_usage_end_reason ?? "unknown";
    const color = SCREEN_REASON_COLORS[reason] ?? SCREEN_REASON_COLORS["unknown"];

    const startIso = nsToIso(row.start_timestamp_ns);
    const stopIso = nsToIso(row.stop_timestamp_ns);
    const startSerial = dateSerial(startIso);
    const stopSerial = dateSerial(stopIso);

    for (let s = startSerial; s <= stopSerial; s++) {
      const isoD = s === startSerial ? startIso : new Date(s * 86_400_000).toISOString().slice(0, 10);
      const yCenter = dateToY.get(isoD);
      if (yCenter === undefined) continue;

      let x1: number, barW: number;
      const dayH = clock.dayHours(isoD);
      if (s === startSerial && s === stopSerial) {
        x1 = hoursToX(nsToLocalHours(row.start_timestamp_ns));
        barW = hoursToX(Math.min(nsToLocalHours(row.stop_timestamp_ns), dayH)) - x1;
      } else if (s === startSerial) {
        x1 = hoursToX(nsToLocalHours(row.start_timestamp_ns));
        barW = hoursToX(dayH) - x1;
      } else if (s === stopSerial) {
        x1 = MARGIN.left;
        barW = hoursToX(nsToLocalHours(row.stop_timestamp_ns)) - x1;
      } else {
        x1 = MARGIN.left;
        barW = (plotWidth() * dayH) / 24;
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
            lines: [
              SCREEN_REASON_LABELS[reason] ?? reason,
              `${durMin.toFixed(1)} min`,
              formatSessionRange(hoursFmt, startIso, row.start_timestamp_ns, stopIso, row.stop_timestamp_ns),
            ],
          });
        }
      }
    }
  }

  // Gap regions last so a session bar wins the hover hit-test on any overlap.
  if (regionsOut) regionsOut.push(...gapRegions);

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

  prims.push(...screenLegendPrimitives(plotTop, gapLegendNeeded, extraW));

  return { width: CANVAS_WIDTH + extraW, height: totalHeight, primitives: prims };
}

/** Right-hand legend for the screen-usage timeline (end reasons + data gap). */
function screenLegendPrimitives(legendTop: number, hasGap: boolean, shiftX = 0): Primitive[] {
  const x = CANVAS_WIDTH - MARGIN.right + 16 + shiftX;
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
export function generateAllScreenPlotSvgs(
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
  return Promise.resolve(result);
}

// ─── batch entry point ────────────────────────────────────────────────────────

export async function generateAllPlots(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  /** Preprocessor version, stamped in each plot subtitle. */
  version: string,
  /** Pre-algorithm event timestamps per participant (keyed by participant_id).
   * Collected before app-usage session reconstruction so gap detection sees all
   * raw event types, not only the session-level rows in the final output. */
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
export function generateAllPlotSvgs(
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
  return Promise.resolve(result);
}

/** One participant's interactive waterfall scene plus per-session hover regions.
 * Powers the in-app View tab and exported HTML viewer (#18). */
export type ParticipantTimelineView = {
  participantId: string;
  scene: Scene;
  regions: SceneRegion[];
};

/** Build interactive app-usage waterfall views (scene + hover regions) for every
 * participant. The report PNG/SVG paths keep the full chrome plot builders. */
export function buildAppTimelineViews(
  rows: PlotRow[],
  timezone: string,
  options: Pick<BrowserProcessingOptions, "includeFilteredAppUsageInPlots">,
  version: string,
  preAlgoTsByParticipant?: Map<string, bigint[]>,
  includeFilteredOverride = options.includeFilteredAppUsageInPlots,
): ParticipantTimelineView[] {
  void version;
  const views: ParticipantTimelineView[] = [];
  const usageTypes = new Set([APP_USAGE_TYPE]);
  if (includeFilteredOverride) {
    usageTypes.add(FILTERED_APP_USAGE_TYPE);
    usageTypes.add(FILTERED_APP_BACKGROUND_USAGE_TYPE);
  }
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const regions: SceneRegion[] = [];
    const sessions: WaterfallSession[] = [];
    const markers: WaterfallMarker[] = [];
    for (const row of pRows) {
      if (
        row.interaction_type === DEVICE_SHUTDOWN_TYPE ||
        row.interaction_type === DEVICE_STARTUP_TYPE ||
        row.interaction_type === END_OF_USAGE_MISSING_TYPE
      ) {
        const color =
          row.interaction_type === DEVICE_SHUTDOWN_TYPE
            ? "red"
            : row.interaction_type === DEVICE_STARTUP_TYPE
              ? "green"
              : "#888";
        markers.push({
          ns: row.event_timestamp_ns,
          color,
          title: row.interaction_type,
        });
        continue;
      }
      if (!usageTypes.has(row.interaction_type)) continue;
      const category = row.broad_app_category ?? "Unknown";
      const color = categoryColor(category);
      const appLabel = row.application_label?.trim();
      const packageName = row.app_package_name || "(app)";
      const title = appLabel || packageName;
      const packageDetail = appLabel && appLabel !== packageName ? [packageName] : [];
      if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) {
        if (row.interaction_type !== FILTERED_APP_USAGE_TYPE) continue;
        sessions.push({
          startNs: row.event_timestamp_ns,
          stopNs: row.event_timestamp_ns,
          instant: true,
          color,
          title,
          detail: [...packageDetail, category, FILTERED_USAGE_EVENT_DETAIL],
        });
        continue;
      }
      const durMin = Number(row.stop_timestamp_ns - row.start_timestamp_ns) / 60_000_000_000;
      const detail = appLabel && appLabel !== packageName
        ? [packageName, category, `${durMin.toFixed(1)} min · ${row.interaction_type}`]
        : [category, `${durMin.toFixed(1)} min · ${row.interaction_type}`];
      sessions.push({
        startNs: row.start_timestamp_ns,
        stopNs: row.stop_timestamp_ns,
        color,
        title,
        detail,
      });
    }
    const allEventNs = preAlgoTsByParticipant?.get(pid) ?? pRows.map((r) => r.event_timestamp_ns);
    const scene = buildWaterfallScene(sessions, allEventNs, timezone, regions, markers);
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
  void version;
  const views: ParticipantTimelineView[] = [];
  for (const [pid, pRows] of groupByParticipant(rows)) {
    const regions: SceneRegion[] = [];
    const sessions: WaterfallSession[] = [];
    for (const row of pRows) {
      if (row.start_timestamp_ns === null || row.stop_timestamp_ns === null) continue;
      const reason = row.screen_usage_end_reason ?? "unknown";
      const durMin = Number(row.stop_timestamp_ns - row.start_timestamp_ns) / 60_000_000_000;
      sessions.push({
        startNs: row.start_timestamp_ns,
        stopNs: row.stop_timestamp_ns,
        color: SCREEN_REASON_COLORS[reason] ?? UNKNOWN_SCREEN_REASON_COLOR,
        title: "Screen",
        detail: [SCREEN_REASON_LABELS[reason] ?? reason, `${durMin.toFixed(1)} min`],
      });
    }
    const allEventNs = preAlgoTsByParticipant?.get(pid) ?? pRows.map((r) => r.event_timestamp_ns);
    const scene = buildWaterfallScene(sessions, allEventNs, timezone, regions);
    views.push({ participantId: pid, scene, regions });
  }
  return views;
}

// ─── hour × day activity heatmap (#19) ──────────────────────────────────────

export type HourDayMatrix = {
  /** Calendar dates (ISO "YYYY-MM-DD"), one per heatmap row, ascending. */
  dates: string[];
  /** One row per date; cell value = seconds of app usage in that (date, hour).
   * Hours are real elapsed hours since local midnight, so a row has 24 cells,
   * or 23/25 on a DST day. */
  cells: number[][];
  /** Largest single-cell value, for normalising the colour scale. */
  maxCell: number;
};

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
  const clock = makeDayClock(timezone);
  const nsToIso = clock.iso;

  const usageTypes = new Set([APP_USAGE_TYPE]);
  if (options.includeFilteredAppUsageInPlots) {
    usageTypes.add(FILTERED_APP_USAGE_TYPE);
    usageTypes.add(FILTERED_APP_BACKGROUND_USAGE_TYPE);
  }

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
  const cells: number[][] = dates.map((d) => new Array<number>(Math.ceil(clock.dayHours(d))).fill(0));

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
      const cellRow = requireDefined(
        cells[di],
        "`cells` has one row per entry of `dates`, which is what `dateIndex` indexes",
      );

      let h0: number;
      let h1: number;
      const dayH = clock.dayHours(isoD);
      if (s === startSerial && s === stopSerial) {
        h0 = clock.hours(row.start_timestamp_ns);
        h1 = clock.hours(row.stop_timestamp_ns);
      } else if (s === startSerial) {
        h0 = clock.hours(row.start_timestamp_ns);
        h1 = dayH;
      } else if (s === stopSerial) {
        h0 = 0;
        h1 = clock.hours(row.stop_timestamp_ns);
      } else {
        h0 = 0;
        h1 = dayH;
      }
      if (h1 <= h0) continue;

      for (let hour = Math.floor(h0); hour < Math.ceil(h1) && hour < cellRow.length; hour++) {
        const overlapHours = Math.min(h1, hour + 1) - Math.max(h0, hour);
        if (overlapHours > 0) cellRow[hour] = (cellRow[hour] ?? 0) + overlapHours * 3600;
      }
    }
  }

  let maxCell = 0;
  for (const cellRow of cells) {
    for (const value of cellRow) if (value > maxCell) maxCell = value;
  }
  return { dates, cells, maxCell };
}

/**
 * The two ends of the heatmap colour scale, named in a unit that can express
 * the value the darkest cell actually holds.
 *
 * `maxCell` is in seconds and the ramp normalises every cell by it
 * (`heatColor(cell / maxCell)`), so saturation is independent of magnitude. The
 * old label rounded to whole minutes, which printed "0 min" at BOTH ends for a
 * sparse participant whose busiest hour held under 30 s — a fully saturated
 * column above a scale that read zero to zero. Below one minute the scale is
 * stated in seconds so both ends stay in one unit and the top end is never 0.
 */
export function heatmapLegendLabels(maxCellSeconds: number): {
  max: string;
  min: string;
} {
  if (!(maxCellSeconds > 0)) return { max: "0 min", min: "0 min" };
  if (maxCellSeconds < 60) {
    // One decimal still rounded 0.01 s and 0.04 s to "0 s", reproducing the
    // original defect one unit down: both ends reading zero under a saturated
    // column. Below the smallest value a decimal can show, state the bound
    // instead of a rounded zero — the exact figure is not the point, "there is
    // usage here and it is under a tenth of a second" is.
    if (maxCellSeconds < 0.05) return { max: "<0.1 s", min: "0 s" };
    const seconds =
      maxCellSeconds < 10
        ? maxCellSeconds.toFixed(1).replace(/\.0$/, "")
        : String(Math.round(maxCellSeconds));
    return { max: `${seconds} s`, min: "0 s" };
  }
  const minutes = maxCellSeconds / 60;
  return {
    max: minutes < 10 ? `${minutes.toFixed(1)} min` : `${Math.round(minutes)} min`,
    min: "0 min",
  };
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
  const clock = makeDayClock(timezone);
  const plotAreaHeight = dates.length * ROW_HEIGHT;
  const totalHeight = Math.max(MARGIN.top + plotAreaHeight + MARGIN.bottom, legendFloorHeight(8));
  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + plotAreaHeight;
  const colWidth = plotWidth() / 24;
  // A row longer than 24 h runs past the grid in whole cells (a 24.5 h day has
  // 25); widen the canvas by those cells so the legend clears them.
  const extraW = (cells.reduce((max, r) => Math.max(max, r.length), 24) - 24) * colWidth;

  const prims: Primitive[] = [];
  prims.push(backgroundPrimitive(totalHeight, extraW));
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
    const cellRow = cells[di];
    if (cellRow === undefined) continue;
    for (let hour = 0; hour < cellRow.length; hour++) {
      prims.push({
        type: "rect",
        x: hoursToX(hour),
        y,
        w: colWidth,
        h: ROW_HEIGHT,
        fill: heatColor((cellRow[hour] ?? 0) / maxCell),
      });
    }
    const date = dates[di];
    if (date !== undefined && clock.dayHours(date) !== 24) {
      prims.push(...heatmapDstRowPrimitives(clock, date, cellRow, maxCell, y, colWidth));
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
  const legendX = CANVAS_WIDTH - MARGIN.right + 24 + extraW;
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
  const legendScale = heatmapLegendLabels(maxCell);
  prims.push(legendLabel(legendX + 22, legendTop, legendScale.max));
  prims.push(legendLabel(legendX + 22, legendTop + legendH, legendScale.min));
  prims.push(legendLabel(legendX, legendTop - 12, "App usage / hour"));

  return { width: CANVAS_WIDTH + extraW, height: totalHeight, primitives: prims };
}

/**
 * Labels for a DST heatmap row, whose cells are real elapsed hours. Each cell's
 * wall clock is compared with the previous cell's plus one hour (midnight for
 * cell 0): the cell where the clock repeats reads "1 (repeat)", the cell after
 * a skip reads "3 (2 skip)" ("1 (0 skip)" when midnight itself is skipped),
 * and other shifts read "2:30 +30m" / "1:30 −30m". Each form fits one 9 px
 * cell (plotDst.test.ts bounds the width), so text never spills into a
 * neighbour whose colour it was not chosen for. Time past the
 * row's real end, up to its last whole cell, is greyed so it cannot be read as
 * an hour of zero usage.
 */
function heatmapDstRowPrimitives(
  clock: DayClock,
  date: string,
  cellRow: readonly number[],
  maxCell: number,
  y: number,
  colWidth: number,
): Primitive[] {
  const prims: Primitive[] = [];
  const dayH = clock.dayHours(date);
  const gridEnd = Math.max(24, cellRow.length);
  if (dayH < gridEnd) {
    const x = hoursToX(dayH);
    prims.push({ type: "rect", x, y, w: hoursToX(gridEnd) - x, h: ROW_HEIGHT, fill: "#e6e6e6" });
  }
  for (let k = 0; k < cellRow.length; k++) {
    const now = clock.clockMinutes(date, k);
    const expected = k === 0 ? 0 : (clock.clockMinutes(date, k - 1) + 60) % 1440;
    const shift = ((((now - expected) % 1440) + 1440 + 720) % 1440) - 720; // (-720, 720]
    if (shift === 0) continue;
    const label = clockLabel(now);
    let text: string;
    if (shift < 0) {
      text = shift === -60 ? `${label} (repeat)` : `${label} −${-shift}m`;
    } else if (shift % 60 === 0 && expected % 60 === 0) {
      const first = expected / 60;
      const last = (first + shift / 60 - 1) % 24;
      text = `${label} (${first === last ? first : `${first}–${last}`} skip)`;
    } else {
      text = `${label} +${shift}m`;
    }
    prims.push({
      type: "text",
      x: hoursToX(k) + colWidth / 2,
      y: y + ROW_HEIGHT / 2,
      text,
      fill: (cellRow[k] ?? 0) / maxCell > 0.5 ? "#fff" : "#333",
      font: FONT_TINY,
      anchor: "middle",
      baseline: "middle",
    });
  }
  return prims;
}

async function generateParticipantHeatmapBlob(
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
export function generateAllHeatmapSvgs(
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
  return Promise.resolve(result);
}
