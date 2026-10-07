import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAppTimelineViews,
  buildHeatmapScene,
  buildScreenScene,
  buildScreenTimelineViews,
  buildTimelineScene,
  computeHourDayMatrix,
} from "@/lib/plotGenerator";
import { renderSceneToSvg, type Scene, type SceneRegion } from "@/lib/plotScene";
import { buildComparisonWaterfallScene } from "@/lib/reviewCompareScene";

// DST rows are drawn at their real length (23 h spring-forward, 25 h fall-back)
// with bars placed by real elapsed time since local midnight. America/Chicago:
// 2026-03-08 02:00 CST → 03:00 CDT, 2026-11-01 02:00 CDT → 01:00 CST.
const TZ = "America/Chicago";
const OPTS = { includeFilteredAppUsageInPlots: true };
const ns = (iso: string): bigint => BigInt(Date.parse(iso)) * 1_000_000n;

type Row = {
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  interaction_type: string;
  broad_app_category?: string | null;
  app_package_name: string;
  participant_id?: string;
  screen_usage_end_reason?: string | null;
};

function usage(date: string, start: string, stop: string, type = "App Usage"): Row {
  return {
    date,
    start_timestamp_ns: ns(start),
    stop_timestamp_ns: ns(stop),
    event_timestamp_ns: ns(start),
    interaction_type: type,
    broad_app_category: "Games",
    app_package_name: "com.example.app",
    participant_id: "P01",
    screen_usage_end_reason: "probable_auto_lock",
  };
}

function event(date: string, at: string, type: string): Row {
  return {
    date,
    start_timestamp_ns: null,
    stop_timestamp_ns: null,
    event_timestamp_ns: ns(at),
    interaction_type: type,
    app_package_name: "system",
    participant_id: "P01",
  };
}

const digest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)))
    .digest("hex");

// Normal (24 h) days in Chicago, including a cross-midnight session, a
// multi-day data gap, device events, and a filtered instant event.
const NORMAL_ROWS: Row[] = [
  usage("2026-10-20", "2026-10-20T14:05:07-05:00", "2026-10-20T15:47:31-05:00"),
  usage("2026-10-20", "2026-10-20T23:10:00-05:00", "2026-10-21T01:20:13-05:00"),
  usage("2026-10-22", "2026-10-22T08:00:00-05:00", "2026-10-22T08:33:59-05:00", "Filtered App Background Usage"),
  event("2026-10-21", "2026-10-21T09:30:00-05:00", "Filtered App Usage"),
  event("2026-10-21", "2026-10-21T12:00:00-05:00", "Device Shutdown"),
  event("2026-10-21", "2026-10-21T18:00:00-05:00", "Device Startup"),
  event("2026-10-22", "2026-10-22T20:00:00-05:00", "End of Usage Missing"),
];
const NORMAL_PRE_ALGO = [
  ns("2026-10-20T14:00:00-05:00"),
  ns("2026-10-20T16:00:00-05:00"),
  ns("2026-10-20T23:00:00-05:00"),
  ns("2026-10-22T07:59:00-05:00"),
  ns("2026-10-22T21:00:00-05:00"),
];

function normalScenes(): Record<string, unknown> {
  const tlRegions: SceneRegion[] = [];
  const scRegions: SceneRegion[] = [];
  const pre = new Map([["P01", NORMAL_PRE_ALGO]]);
  return {
    timeline: buildTimelineScene("P01", NORMAL_ROWS, TZ, OPTS, "1.0.0", "Jan 1", NORMAL_PRE_ALGO, tlRegions),
    timelineRegions: tlRegions,
    screen: buildScreenScene("P01", NORMAL_ROWS, TZ, "1.0.0", "Jan 1", NORMAL_PRE_ALGO, scRegions),
    screenRegions: scRegions,
    heatmap: buildHeatmapScene("P01", NORMAL_ROWS, TZ, OPTS, "1.0.0", "Jan 1"),
    appViews: buildAppTimelineViews(NORMAL_ROWS, TZ, OPTS, "1.0.0", pre),
    screenViews: buildScreenTimelineViews(NORMAL_ROWS, TZ, "1.0.0", pre),
  };
}

describe("normal days are unchanged by DST-aware rows", () => {
  it("renders every surface byte-identically to the pre-DST output", () => {
    const scenes = normalScenes();
    const digests = Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, digest(v)]));
    // Recorded from main 3845fff73, before rows became DST-aware.
    expect(digests).toEqual({
      appViews: "6d70b76afd294dcdedbe4c980e84f10df3bc3fd4e0739ca6dba54fb0058747a2",
      heatmap: "5019cabac7483d82591d3c31837fe5b782eb2847f2c18d6309b2335558a18564",
      screen: "9ff582a40eaa3280c5d0f857716260a6ac30d0b818b579008104ee4ef31a9441",
      screenRegions: "c08108b5f61511f592baf81ef89bf285f42ae5da6a6f6e41ade3d6de8fea3d38",
      screenViews: "b3c688f9edd6155a055ba5746fc3ca95ce95d7de4317ffaec188758d0d354663",
      timeline: "24c5d6171390e779697c4ee2fa46af9b4ea49cdfa60b8779c0ffd2f33d7e1277",
      timelineRegions: "a12dc7185d3335ff3738d778775afde9c7994c60539a5d624b9d854a88e24ade",
    });
  });
});

// ── DST rows ────────────────────────────────────────────────────────────────
// Report scenes: plot area starts at x=160 and 24 h spans 1380 px. Waterfall
// scenes carry their own gutter/plotWidth in `meta` (24 h = meta width of a
// normal scene, 1088 px).
const REPORT = { left: 160, dayWidth: 1380 };
const WATERFALL = { left: 112, dayWidth: 1088 };
const GAMES = "#e6194b";
const AUTO_LOCK = "#2196F3";

type Bar = { rowTop: number; h0: number; h1: number };

/** Bars of one fill colour, converted back to elapsed hours since midnight. */
function bars(scene: Scene, fill: string, geo: { left: number; dayWidth: number }): Bar[] {
  const toH = (x: number): number => Math.round(((x - geo.left) / geo.dayWidth) * 24 * 1e6) / 1e6;
  return scene.primitives.flatMap((p) =>
    p.type === "rect" && p.fill === fill && p.w > 0 && p.h > 15 && p.h < 30
      ? [{ rowTop: p.y, h0: toH(p.x), h1: toH(p.x + p.w) }]
      : [],
  );
}

/** Row-top y of each date row, in row order, from a report scene's labels. */
function tinyLabels(scene: Scene): Map<number, string[]> {
  const byRow = new Map<number, string[]>();
  for (const p of scene.primitives) {
    if (p.type !== "text" || !p.font.startsWith("9px")) continue;
    byRow.set(p.y, [...(byRow.get(p.y) ?? []), p.text]);
  }
  return byRow;
}

const FALL = "2026-11-01";
const SPRING = "2026-03-08";
// Fall-back: 02:00 CDT (07:00Z) → 01:00 CST. Spring-forward: 02:00 CST (08:00Z) → 03:00 CDT.
const FALL_A = usage(FALL, "2026-11-01T01:30:00-05:00", "2026-11-01T01:15:00-06:00"); // 45 min
const FALL_B = usage(FALL, "2026-11-01T00:30:00-05:00", "2026-11-01T01:30:00-06:00"); // 2 h
const SPRING_S = usage(SPRING, "2026-03-08T01:30:00-06:00", "2026-03-08T03:30:00-05:00"); // 1 h
// Cross-midnight INTO the fall-back day, and OUT of it past the 24 h mark.
const INTO_FALL = usage("2026-10-31", "2026-10-31T23:00:00-05:00", "2026-11-01T01:30:00-06:00");
const OUT_OF_FALL = usage(FALL, "2026-11-01T23:30:00-06:00", "2026-11-02T00:30:00-06:00");
const OUT_OF_SPRING = usage(SPRING, "2026-03-08T23:00:00-05:00", "2026-03-09T00:30:00-05:00");

const timeline = (rows: Row[]): Scene =>
  buildTimelineScene("P01", rows, TZ, OPTS, "1.0.0", "Jan 1");

describe("fall-back (25 h) rows", () => {
  it("(A) draws 01:30 CDT → 01:15 CST at real elapsed 1.5 h..2.25 h instead of vanishing", () => {
    expect(bars(timeline([FALL_A]), GAMES, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[1.5, 2.25]]);
  });

  it("(B) draws 00:30 CDT → 01:30 CST as 2 h wide, not 1 h", () => {
    expect(bars(timeline([FALL_B]), GAMES, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[0.5, 2.5]]);
  });

  it("splits cross-midnight sessions at the real 25 h day end", () => {
    const scene = timeline([INTO_FALL, OUT_OF_FALL, usage("2026-11-02", "2026-11-02T09:00:00-06:00", "2026-11-02T09:30:00-06:00")]);
    // Bar tops: row top + 4.2 (bars fill the middle 70% of a 28 px row).
    const [oct31, nov1, nov2] = [60, 88, 116];
    const got = bars(scene, GAMES, REPORT).map(({ rowTop, h0, h1 }) => [rowTop, h0, h1]);
    expect(got).toEqual([
      [oct31 + 4.2, 23, 24],
      [nov1 + 4.2, 0, 2.5],
      [nov1 + 4.2, 24.5, 25],
      [nov2 + 4.2, 0, 0.5],
      [nov2 + 4.2, 9, 9.5],
    ]);
    // The canvas grows by exactly one hour so the 25th hour is not under the legend.
    expect(scene.width).toBe(1800 + 1380 / 24);
  });

  it("labels the row with the wall clock at each elapsed hour (…0,1,1,2…)", () => {
    const labels = tinyLabels(timeline([FALL_A, usage("2026-11-02", "2026-11-02T09:00:00-06:00", "2026-11-02T09:30:00-06:00")]));
    // Only the DST row is labelled; the 24 h row keeps the shared axis alone.
    expect([...labels.keys()]).toEqual([61]);
    const row = labels.get(61) ?? [];
    expect(row).toHaveLength(25);
    expect(row.slice(0, 5)).toEqual(["0", "1", "1", "2", "3"]);
    expect(row.at(-1)).toBe("23");
  });

  it("draws the same geometry in the screen timeline", () => {
    const scene = buildScreenScene("P01", [FALL_A, FALL_B], TZ, "1.0.0", "Jan 1");
    expect(bars(scene, AUTO_LOCK, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[1.5, 2.25], [0.5, 2.5]]);
  });

  it("draws the same geometry in the interactive waterfall, widened to hold 25 h", () => {
    const [view] = buildAppTimelineViews([FALL_A, FALL_B, OUT_OF_FALL], TZ, OPTS, "1.0.0");
    const scene = view?.scene as Scene;
    expect(bars(scene, GAMES, WATERFALL).map(({ h0, h1 }) => [h0, h1])).toEqual([
      [1.5, 2.25],
      [0.5, 2.5],
      [24.5, 25],
      [0, 0.5],
    ]);
    expect(scene.width).toBe(1200 + 1088 / 24);
    expect(scene.meta?.plotWidth).toBe(1088 + 1088 / 24);
    // The A/B comparison carries the wider arm's width so the 25th hour is not clipped.
    const compare = buildComparisonWaterfallScene(view as NonNullable<typeof view>, view as NonNullable<typeof view>, new Map(), new Map()).scene;
    expect(compare.width).toBe(scene.width);
    expect(compare.meta?.plotWidth).toBe(scene.meta?.plotWidth);
    const [screenView] = buildScreenTimelineViews([FALL_A], TZ, "1.0.0");
    expect(bars(screenView?.scene as Scene, AUTO_LOCK, WATERFALL).map(({ h0, h1 }) => [h0, h1])).toEqual([[1.5, 2.25]]);
  });

  it("credits the heatmap with real seconds in 25 hour cells, labelling the repeat", () => {
    const m = computeHourDayMatrix([FALL_A, FALL_B], TZ);
    expect(m.cells[0]).toHaveLength(25);
    // A: 1800 s in elapsed hour 1 (01:30–02:00 CDT) + 900 s in hour 2 (01:00–01:15 CST).
    // B: 1800 in hour 0, 3600 in hour 1, 1800 in hour 2.
    expect(m.cells[0]?.slice(0, 4)).toEqual([1800, 5400, 2700, 0]);
    expect(m.cells[0]?.reduce((a, b) => a + b, 0)).toBe(2700 + 7200);
    const scene = buildHeatmapScene("P01", [FALL_A, FALL_B], TZ, OPTS, "1.0.0", "Jan 1");
    const texts = scene.primitives.flatMap((p) => (p.type === "text" && p.font.startsWith("9px") ? [p.text] : []));
    expect(texts).toEqual(["1 (repeat)"]);
    expect(scene.width).toBe(1800 + 1380 / 24);
  });

  it("puts a cross-midnight slice into the 25th heatmap cell", () => {
    const m = computeHourDayMatrix([INTO_FALL, OUT_OF_FALL], TZ);
    expect(m.dates).toEqual(["2026-10-31", FALL, "2026-11-02"]);
    expect(m.cells[0]?.[23]).toBe(3600);
    expect(m.cells[1]?.slice(0, 3)).toEqual([3600, 3600, 1800]);
    expect(m.cells[1]?.[24]).toBe(1800);
    expect(m.cells[2]?.[0]).toBe(1800);
  });
});

describe("spring-forward (23 h) rows", () => {
  it("draws 01:30 CST → 03:30 CDT as 1 h wide, not 2 h", () => {
    expect(bars(timeline([SPRING_S]), GAMES, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[1.5, 2.5]]);
  });

  it("ends the row at 23 h and splits a cross-midnight session there", () => {
    const scene = timeline([OUT_OF_SPRING]);
    expect(bars(scene, GAMES, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[22, 23], [0, 0.5]]);
    // No widening for a short row; its missing hour is greyed and a rule marks its end.
    expect(scene.width).toBe(1800);
    const endRule = scene.primitives.find((p) => p.type === "line" && p.stroke === "#666");
    expect(endRule).toMatchObject({ x1: 160 + (1380 * 23) / 24 });
    const labels = tinyLabels(scene).get(61) ?? [];
    expect(labels).toHaveLength(23);
    expect(labels.slice(0, 4)).toEqual(["0", "1", "3", "4"]);
  });

  it("credits the heatmap with real seconds in 23 hour cells, labelling the skip", () => {
    const m = computeHourDayMatrix([SPRING_S], TZ);
    expect(m.cells[0]).toHaveLength(23);
    expect(m.cells[0]?.slice(0, 4)).toEqual([0, 1800, 1800, 0]);
    expect(m.maxCell).toBe(1800);
    const scene = buildHeatmapScene("P01", [SPRING_S], TZ, OPTS, "1.0.0", "Jan 1");
    const texts = scene.primitives.flatMap((p) => (p.type === "text" && p.font.startsWith("9px") ? [p.text] : []));
    expect(texts).toEqual(["3 (2 skip)"]);
  });
});

// ── Review round 1: zones and surfaces beyond Chicago ─────────────────────────

const HAVANA = "America/Havana"; // 2026-03-08 00:00 CST → 01:00 CDT: midnight is skipped.
const LORD_HOWE = "Australia/Lord_Howe"; // half-hour DST: 23.5 h and 24.5 h days.
const tinyTexts = (scene: Scene): string[] =>
  scene.primitives.flatMap((p) => (p.type === "text" && p.font.startsWith("9px") ? [p.text] : []));

describe("a spring-forward that skips midnight (America/Havana)", () => {
  const HAVANA_S = usage("2026-03-08", "2026-03-08T01:30:00-04:00", "2026-03-08T02:00:00-04:00");

  it("labels heatmap cell 0 with its real hour and the skipped midnight hour", () => {
    const m = computeHourDayMatrix([HAVANA_S], HAVANA);
    expect(m.cells[0]).toHaveLength(23);
    // The day begins at 01:00 CDT, so 01:30–02:00 is elapsed 0.5 h–1 h.
    expect(m.cells[0]?.slice(0, 2)).toEqual([1800, 0]);
    const scene = buildHeatmapScene("P01", [HAVANA_S], HAVANA, OPTS, "1.0.0", "Jan 1");
    expect(tinyTexts(scene)).toEqual(["1 (0 skip)"]);
  });

  it("labels the timeline row from its real first hour", () => {
    const scene = buildTimelineScene("P01", [HAVANA_S], HAVANA, OPTS, "1.0.0", "Jan 1");
    expect(tinyTexts(scene).slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(bars(scene, GAMES, REPORT).map(({ h0, h1 }) => [h0, h1])).toEqual([[0.5, 1]]);
  });
});

describe("half-hour DST days (Australia/Lord_Howe)", () => {
  // 2026-10-04 02:00 LHST → 02:30 LHDT (23.5 h); 2026-04-05 02:00 LHDT → 01:30 LHST (24.5 h).
  const SPRING_LH = usage("2026-10-04", "2026-10-04T01:30:00+10:30", "2026-10-04T03:00:00+11:00"); // 1 h real
  const FALL_LH = usage("2026-04-05", "2026-04-05T01:45:00+11:00", "2026-04-05T01:45:00+10:30"); // 30 min real
  const colW = 1380 / 24;
  const rects = (scene: Scene, fill: string) =>
    scene.primitives.flatMap((p) => (p.type === "rect" && p.fill === fill ? [p] : []));

  it("treats a 23.5 h day as a DST row: marks, the skipped half hour, a grey half cell", () => {
    const m = computeHourDayMatrix([SPRING_LH], LORD_HOWE);
    expect(m.cells[0]).toHaveLength(24);
    expect(m.cells[0]?.slice(0, 4)).toEqual([0, 1800, 1800, 0]);
    const scene = buildHeatmapScene("P01", [SPRING_LH], LORD_HOWE, OPTS, "1.0.0", "Jan 1");
    expect(tinyTexts(scene)).toEqual(["2:30 +30m"]);
    expect(rects(scene, "#e6e6e6")).toEqual([
      expect.objectContaining({ x: 160 + 23.5 * colW, w: 0.5 * colW }),
    ]);
    expect(scene.width).toBe(1800);
  });

  it("sizes a 24.5 h heatmap row to whole cells so the legend clears cell 25", () => {
    const m = computeHourDayMatrix([FALL_LH], LORD_HOWE);
    expect(m.cells[0]).toHaveLength(25);
    expect(m.cells[0]?.slice(0, 3)).toEqual([0, 900, 900]);
    const scene = buildHeatmapScene("P01", [FALL_LH], LORD_HOWE, OPTS, "1.0.0", "Jan 1");
    expect(tinyTexts(scene)).toEqual(["1:30 −30m"]);
    expect(scene.width).toBe(1800 + colW);
    expect(rects(scene, "#e6e6e6")).toEqual([
      expect.objectContaining({ x: 160 + 24.5 * colW, w: 0.5 * colW }),
    ]);
    const legendTitle = scene.primitives.find((p) => p.type === "text" && p.text === "App usage / hour");
    expect(legendTitle).toMatchObject({ x: 1800 - 260 + 24 + colW });
  });

  it("labels half-hour clock times on the timeline row", () => {
    const scene = buildTimelineScene("P01", [SPRING_LH], LORD_HOWE, OPTS, "1.0.0", "Jan 1");
    expect(tinyTexts(scene).slice(0, 4)).toEqual(["0", "1", "2:30", "3:30"]);
    expect(tinyTexts(scene)).toHaveLength(24);
  });
});

describe("A/B comparison rows keep each arm's DST marks", () => {
  const compareOf = (rows: Row[]): Scene => {
    const [view] = buildAppTimelineViews(rows, TZ, OPTS, "1.0.0");
    const v = view as NonNullable<typeof view>;
    return buildComparisonWaterfallScene(v, v, new Map(), new Map()).scene;
  };
  // Comparison rows are 58 px tall from y=26 (LAYOUT in reviewCompareScene.ts).
  const inRow = (scene: Scene, date: string) => {
    const row = scene.meta?.rows.find((r) => r.date === date);
    if (!row) throw new Error(`no row ${date}`);
    return scene.primitives.filter((p) => {
      const y = p.type === "line" ? (p.y1 + p.y2) / 2 : p.type === "poly" ? 0 : p.y + (p.type === "rect" ? p.h / 2 : 0);
      return y >= row.y && y < row.y + row.h;
    });
  };
  const NEXT_DAY = usage("2026-11-02", "2026-11-02T09:00:00-06:00", "2026-11-02T09:30:00-06:00");

  it("draws the fall-back row's clock labels and real end, without 24 h gridlines", () => {
    const scene = compareOf([FALL_A, NEXT_DAY]);
    const fall = inRow(scene, FALL);
    const labels = fall.flatMap((p) => (p.type === "text" && p.font.startsWith("9px") ? [p.text] : []));
    expect(labels).toHaveLength(25);
    expect(labels.slice(0, 4)).toEqual(["0", "1", "1", "2"]);
    const ends = fall.flatMap((p) => (p.type === "line" && p.stroke === "#666" ? [p.x1] : []));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeCloseTo(112 + (1088 * 25) / 24, 9);
    expect(fall.filter((p) => p.type === "line" && p.stroke === "#f0f2f5")).toHaveLength(0);
    // The 24 h row keeps its 6/12/18 gridlines and gets no DST marks.
    const normal = inRow(scene, "2026-11-02");
    expect(normal.filter((p) => p.type === "line" && p.stroke === "#f0f2f5")).toHaveLength(3);
    expect(normal.filter((p) => p.type === "text" && p.font.startsWith("9px"))).toHaveLength(0);
  });

  it("greys the missing hour of a spring-forward row", () => {
    const scene = compareOf([SPRING_S]);
    const tails = inRow(scene, SPRING).flatMap((p) => (p.type === "rect" && p.fill === "#f3f3f3" ? [p] : []));
    expect(tails).toHaveLength(1);
    expect(tails[0]?.x).toBeCloseTo(112 + (1088 * 23) / 24, 9);
    expect(tails[0]?.w).toBeCloseTo(1088 / 24, 9);
  });
});

describe("DST row labels are anchored to their hour, padded separately", () => {
  it("stores the hour position as x and the 2 px pad as dx; static renderers add them", () => {
    const scene = timeline([FALL_A]);
    const first = scene.primitives.find((p) => p.type === "text" && p.font.startsWith("9px"));
    expect(first).toMatchObject({ x: 160, dx: 2, text: "0" });
    expect(renderSceneToSvg(scene)).toContain('<text x="162" y="61" fill="#888" font-size="9px"');
  });
});

describe("heatmap DST labels fit inside their cell", () => {
  // DejaVu Sans advance widths (units per 2048 em), the widest common
  // system-ui fallback, so this bounds the painted width from above.
  const ADVANCE: Record<string, number> = {
    "0": 1303, "1": 1303, "2": 1303, "3": 1303, "4": 1303, "5": 1303, "6": 1303, "7": 1303, "8": 1303, "9": 1303,
    ":": 690, " ": 651, "(": 799, ")": 799, "+": 1716, "−": 1716, "–": 1024,
    m: 1995, s: 1067, k: 1186, i: 569, p: 1300, r: 842, e: 1260, a: 1255, t: 803,
  };
  const width9px = (text: string): number =>
    [...text].reduce((w, c) => {
      const adv = ADVANCE[c];
      if (adv === undefined) throw new Error(`no advance width for ${JSON.stringify(c)}`);
      return w + (adv * 9) / 2048;
    }, 0);
  const CELL = 1380 / 24;
  const cases: Array<[string, Row]> = [
    [TZ, SPRING_S],
    [TZ, FALL_A],
    [HAVANA, usage("2026-03-08", "2026-03-08T01:30:00-04:00", "2026-03-08T02:00:00-04:00")],
    [LORD_HOWE, usage("2026-10-04", "2026-10-04T01:30:00+10:30", "2026-10-04T03:00:00+11:00")],
    [LORD_HOWE, usage("2026-04-05", "2026-04-05T01:45:00+11:00", "2026-04-05T01:45:00+10:30")],
  ];

  it.each(cases)("%s %#", (tz, row) => {
    const labels = tinyTexts(buildHeatmapScene("P01", [row], tz, OPTS, "1.0.0", "Jan 1"));
    expect(labels).toHaveLength(1);
    for (const text of labels) expect(width9px(text), text).toBeLessThanOrEqual(CELL);
  });
});
