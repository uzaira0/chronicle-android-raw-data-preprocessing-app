import { describe, expect, it } from "vitest";

import {
  fitViewport,
  hitTest,
  layoutTimeline,
  nsToX,
  panViewport,
  TIMELINE_MARGIN,
  xToNs,
  zoomViewport,
} from "@/lib/timelineGeometry";
import type { TimelineSession } from "@/lib/types";

const MIN = 60_000_000_000n;
const at = (minutes: number): bigint => BigInt(minutes) * MIN;

function session(over: Partial<TimelineSession> = {}): TimelineSession {
  return {
    participantId: "P1",
    kind: "app",
    startNs: at(0),
    stopNs: at(10),
    appPackage: "com.a",
    appLabel: "A",
    category: "Games",
    interactionType: "App Usage",
    usageLayer: null,
    ...over,
  };
}

const WIDTH = 920;
const ALL = new Set<TimelineSession["kind"]>(["app", "screen"]);

describe("fitViewport", () => {
  it("spans the earliest start to the latest stop", () => {
    const vp = fitViewport([session({ startNs: at(5), stopNs: at(8) }), session({ startNs: at(2), stopNs: at(20) })]);
    expect(vp).toEqual({ startNs: at(2), endNs: at(20) });
  });

  it("falls back to a 1-hour window when there are no sessions", () => {
    expect(fitViewport([])).toEqual({ startNs: 0n, endNs: 3_600_000_000_000n });
  });
});

describe("nsToX / xToNs", () => {
  const vp = { startNs: at(0), endNs: at(60) };
  it("maps the viewport edges to the plot edges and round-trips", () => {
    expect(nsToX(vp.startNs, vp, WIDTH)).toBeCloseTo(TIMELINE_MARGIN.left, 5);
    expect(nsToX(vp.endNs, vp, WIDTH)).toBeCloseTo(WIDTH - TIMELINE_MARGIN.right, 5);
    const mid = nsToX(at(30), vp, WIDTH);
    expect(xToNs(mid, vp, WIDTH)).toBe(at(30));
  });
});

describe("layoutTimeline", () => {
  const sessions = [
    session({ participantId: "P1", kind: "app", startNs: at(0), stopNs: at(10) }),
    session({ participantId: "P1", kind: "screen", startNs: at(0), stopNs: at(12) }),
    session({ participantId: "P2", kind: "app", startNs: at(5), stopNs: at(9) }),
    session({ participantId: "P1", kind: "app", startNs: at(100), stopNs: at(110) }), // out of viewport
  ];
  const vp = { startNs: at(0), endNs: at(20) };

  it("creates one row per participant and places app/screen in separate lanes", () => {
    const layout = layoutTimeline(sessions, vp, WIDTH, ALL);
    expect(layout.rows.map((r) => r.participantId)).toEqual(["P1", "P2"]);
    const app = layout.rects.find((r) => r.sessionIndex === 0)!;
    const screen = layout.rects.find((r) => r.sessionIndex === 1)!;
    expect(screen.y).toBeGreaterThan(app.y); // screen lane sits below the app lane
  });

  it("culls sessions outside the viewport", () => {
    const layout = layoutTimeline(sessions, vp, WIDTH, ALL);
    expect(layout.rects.some((r) => r.sessionIndex === 3)).toBe(false);
  });

  it("respects the visible-kinds filter", () => {
    const layout = layoutTimeline(sessions, vp, WIDTH, new Set<TimelineSession["kind"]>(["app"]));
    expect(layout.rects.some((r) => r.sessionIndex === 1)).toBe(false); // screen hidden
  });

  it("keeps a minimum 1px width for thin sessions", () => {
    const tiny = [session({ startNs: at(0), stopNs: at(0) + 1n })];
    const layout = layoutTimeline(tiny, { startNs: at(0), endNs: at(600) }, WIDTH, ALL);
    expect(layout.rects[0]!.w).toBeGreaterThanOrEqual(1);
  });
});

describe("hitTest", () => {
  const sessions = [session({ startNs: at(0), stopNs: at(10) })];
  const layout = layoutTimeline(sessions, { startNs: at(0), endNs: at(20) }, WIDTH, ALL);

  it("returns the session under the point and null elsewhere", () => {
    const r = layout.rects[0]!;
    expect(hitTest(layout, r.x + r.w / 2, r.y + r.h / 2)).toBe(0);
    expect(hitTest(layout, r.x + r.w / 2, r.y - 50)).toBeNull();
  });
});

describe("zoom / pan", () => {
  const vp = { startNs: at(0), endNs: at(100) };

  it("zoom in halves the span and keeps the focus point fixed", () => {
    const zoomed = zoomViewport(vp, at(50), 2);
    expect(Number(zoomed.endNs - zoomed.startNs)).toBeCloseTo(Number(at(50)), -6);
    // focus (midpoint) stays at the same time
    expect(zoomed.startNs).toBe(at(25));
    expect(zoomed.endNs).toBe(at(75));
  });

  it("pan shifts the window by a fraction of its span", () => {
    const panned = panViewport(vp, 0.5);
    expect(panned.startNs).toBe(at(50));
    expect(panned.endNs).toBe(at(150));
  });
});
