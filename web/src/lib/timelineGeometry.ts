/**
 * Pure geometry + hit-testing for the interactive timeline explorer (#18).
 *
 * No DOM/Canvas here — this module only maps the session payload to pixel
 * rectangles for a given viewport and answers "what's under (x, y)?", so it can
 * be unit-tested in isolation (the React component just draws the rects it
 * returns and forwards pointer events).
 *
 * Time axis: horizontal, absolute nanoseconds, zoomable/pannable. Rows: one per
 * participant, each split into an app lane (top) and a screen lane (bottom).
 */

import type { TimelineSession } from "@/lib/types";

export type TimelineViewport = { startNs: bigint; endNs: bigint };

export type TimelineRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  sessionIndex: number;
};

export type TimelineRow = { participantId: string; y: number; height: number };

export type TimelineLayout = {
  width: number;
  height: number;
  plotLeft: number;
  plotTop: number;
  rows: TimelineRow[];
  rects: TimelineRect[];
};

export const TIMELINE_MARGIN = { top: 28, right: 16, bottom: 8, left: 120 };
export const LANE_HEIGHT = 16;
export const ROW_GAP = 6;
const ROW_HEIGHT = LANE_HEIGHT * 2; // app lane + screen lane

/** Smallest/largest session instant; falls back to a 1-hour window when empty. */
export function fitViewport(sessions: readonly TimelineSession[]): TimelineViewport {
  let start: bigint | null = null;
  let end: bigint | null = null;
  for (const s of sessions) {
    if (start === null || s.startNs < start) start = s.startNs;
    if (end === null || s.stopNs > end) end = s.stopNs;
  }
  if (start === null || end === null || end <= start) {
    const base = start ?? 0n;
    return { startNs: base, endNs: base + 3_600_000_000_000n };
  }
  return { startNs: start, endNs: end };
}

/**
 * Fraction of where `ns` falls within the viewport. Computed in bigint (scaled
 * by 1e9) before the final double divide, so it stays exact for multi-month
 * spans where `Number(endNs - startNs)` would lose sub-nanosecond bits past the
 * 2^53 boundary (~104 days). Not clamped — partially-visible sessions return
 * values outside [0,1] and the caller lets the canvas clip them.
 */
const FRACTION_SCALE = 1_000_000_000n;
function fractionOf(ns: bigint, viewport: TimelineViewport): number {
  const span = viewport.endNs - viewport.startNs;
  if (span <= 0n) return 0;
  return Number(((ns - viewport.startNs) * FRACTION_SCALE) / span) / Number(FRACTION_SCALE);
}

export function nsToX(ns: bigint, viewport: TimelineViewport, width: number): number {
  const plotWidth = width - TIMELINE_MARGIN.left - TIMELINE_MARGIN.right;
  return TIMELINE_MARGIN.left + fractionOf(ns, viewport) * plotWidth;
}

export function xToNs(x: number, viewport: TimelineViewport, width: number): bigint {
  const plotWidth = width - TIMELINE_MARGIN.left - TIMELINE_MARGIN.right;
  if (plotWidth <= 0) return viewport.startNs;
  const fraction = (x - TIMELINE_MARGIN.left) / plotWidth;
  const span = Number(viewport.endNs - viewport.startNs);
  return viewport.startNs + BigInt(Math.round(fraction * span));
}

/** Total canvas height needed for the given participants. */
export function timelineHeight(participantCount: number): number {
  return (
    TIMELINE_MARGIN.top +
    Math.max(1, participantCount) * (ROW_HEIGHT + ROW_GAP) +
    TIMELINE_MARGIN.bottom
  );
}

/**
 * Lay out the visible sessions into pixel rects for `viewport`. Sessions whose
 * kind is not in `visibleKinds`, or that fall entirely outside the viewport, are
 * culled (so they don't draw and aren't hit-testable). Each kept rect is at
 * least 1px wide so thin sessions stay clickable.
 */
export function layoutTimeline(
  sessions: readonly TimelineSession[],
  viewport: TimelineViewport,
  width: number,
  visibleKinds: ReadonlySet<TimelineSession["kind"]>,
): TimelineLayout {
  const participants = [...new Set(sessions.map((s) => s.participantId))].sort((a, b) =>
    a.localeCompare(b),
  );
  const rowIndex = new Map(participants.map((p, i) => [p, i]));
  const rows: TimelineRow[] = participants.map((participantId, i) => ({
    participantId,
    y: TIMELINE_MARGIN.top + i * (ROW_HEIGHT + ROW_GAP),
    height: ROW_HEIGHT,
  }));

  // When any participant has a secondary concurrent-usage layer, split the app
  // lane into two stacked half-height sub-rows so the primary/secondary bands of
  // overlapping apps don't occlude each other. Computed over ALL sessions (not the
  // viewport/kind-filtered subset) so lane geometry is stable under pan/zoom and
  // the App/Screen toggles. No-op (full-height app lane, byte-identical to before)
  // when nothing is secondary — i.e. whenever concurrent modeling is off.
  const hasSecondary = sessions.some((s) => s.usageLayer === "secondary");
  const appLaneHeight = hasSecondary ? LANE_HEIGHT / 2 : LANE_HEIGHT;

  const rects: TimelineRect[] = [];
  sessions.forEach((session, sessionIndex) => {
    if (!visibleKinds.has(session.kind)) return;
    if (session.stopNs <= viewport.startNs || session.startNs >= viewport.endNs) return;
    const i = rowIndex.get(session.participantId);
    if (i === undefined) return;
    const x0 = nsToX(session.startNs, viewport, width);
    const x1 = nsToX(session.stopNs, viewport, width);
    const rowY = TIMELINE_MARGIN.top + i * (ROW_HEIGHT + ROW_GAP);
    let y: number;
    let h: number;
    if (session.kind === "screen") {
      y = rowY + LANE_HEIGHT;
      h = LANE_HEIGHT;
    } else if (hasSecondary && session.usageLayer === "secondary") {
      y = rowY + appLaneHeight; // bottom half of the app lane
      h = appLaneHeight;
    } else {
      y = rowY; // app primary/null → top of the app lane
      h = appLaneHeight;
    }
    rects.push({
      x: x0,
      y,
      w: Math.max(1, x1 - x0),
      h,
      sessionIndex,
    });
  });

  return {
    width,
    height: timelineHeight(participants.length),
    plotLeft: TIMELINE_MARGIN.left,
    plotTop: TIMELINE_MARGIN.top,
    rows,
    rects,
  };
}

/** Topmost session rect under (x, y), or null. Later rects win (drawn on top). */
export function hitTest(layout: TimelineLayout, x: number, y: number): number | null {
  for (let i = layout.rects.length - 1; i >= 0; i--) {
    const r = layout.rects[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return r.sessionIndex;
    }
  }
  return null;
}

/** Zoom around `focusNs` by `factor` (>1 zooms in). Keeps focus point fixed. */
export function zoomViewport(
  viewport: TimelineViewport,
  focusNs: bigint,
  factor: number,
): TimelineViewport {
  const span = Number(viewport.endNs - viewport.startNs);
  const newSpan = Math.max(1000, span / factor); // floor at 1µs
  const focusFraction = span > 0 ? Number(focusNs - viewport.startNs) / span : 0.5;
  const startNs = focusNs - BigInt(Math.round(focusFraction * newSpan));
  return { startNs, endNs: startNs + BigInt(Math.round(newSpan)) };
}

/** Pan the viewport by a fraction of its current span (negative = earlier). */
export function panViewport(viewport: TimelineViewport, fraction: number): TimelineViewport {
  const span = viewport.endNs - viewport.startNs;
  const delta = BigInt(Math.round(Number(span) * fraction));
  return { startNs: viewport.startNs + delta, endNs: viewport.endNs + delta };
}
