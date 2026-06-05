import { describe, expect, it } from "vitest";

import {
  buildAggregateOutputs,
  computeCategoryBudget,
  computeCoUsage,
  computePeriodSummaries,
  computeTopApps,
  isoWeekInfo,
  type AggregateInputRow,
  type BuildAggregateOptions,
} from "@/lib/aggregations";

const BASE = 1_000_000_000_000_000_000n;
/** Nanosecond instant `m` minutes after the base. */
const at = (m: number): bigint => BASE + BigInt(Math.round(m * 60)) * 1_000_000_000n;

function appSession(
  over: Partial<AggregateInputRow> & {
    app_package_name: string;
    startMin: number;
    stopMin: number;
  },
): AggregateInputRow {
  const { startMin, stopMin, ...rest } = over;
  const start = at(startMin);
  const stop = at(stopMin);
  return {
    study_id: "S",
    participant_id: "P1",
    date: "2026-06-01",
    timezone: "America/Chicago",
    application_label: rest.app_package_name,
    broad_app_category: null,
    interaction_type: "App Usage",
    start_timestamp_ns: start,
    stop_timestamp_ns: stop,
    duration_minutes: stopMin - startMin,
    day: 2,
    weekdayMF: 1,
    weekdayMTh: 1,
    weekdaySuTh: 1,
    ...rest,
  };
}

function screenSession(startMin: number, stopMin: number, over: Partial<AggregateInputRow> = {}): AggregateInputRow {
  return appSession({ app_package_name: "screen", startMin, stopMin, ...over, interaction_type: "Screen Usage" });
}

const STUB_OPTIONS: BuildAggregateOptions = {
  studyName: "Demo",
  shape: "wide",
  includeCategoryBudget: false,
  includeCoUsage: false,
  formatTimestamp: (ns) => `T${ns - BASE}`,
};

describe("isoWeekInfo", () => {
  it("computes ISO year-week and Monday week-start, including year boundaries", () => {
    expect(isoWeekInfo("2026-01-01")).toEqual({ key: "2026-W01", weekStart: "2025-12-29" });
    expect(isoWeekInfo("2026-01-05")).toEqual({ key: "2026-W02", weekStart: "2026-01-05" });
    // A late-December Monday belonging to the next ISO year's week 1.
    expect(isoWeekInfo("2025-12-29")).toEqual({ key: "2026-W01", weekStart: "2025-12-29" });
  });
});

describe("computePeriodSummaries (daily)", () => {
  const appRows = [
    appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5 }),
    appSession({ app_package_name: "com.b", startMin: 5, stopMin: 8 }),
    appSession({ app_package_name: "com.a", startMin: 8, stopMin: 10 }),
  ];
  const screenRows = [screenSession(0, 12), screenSession(20, 25)];

  it("computes per-day totals, counts, switches, pickups, mean, longest, window", () => {
    const [entry] = computePeriodSummaries(appRows, screenRows, (date) => date);
    expect(entry!.participant_id).toBe("P1");
    expect(entry!.period).toBe("2026-06-01");
    const s = entry!.summary;
    expect(s.total_app_usage_minutes).toBe(10);
    expect(s.total_screen_usage_minutes).toBe(17);
    expect(s.app_session_count).toBe(3);
    expect(s.screen_session_count).toBe(2);
    expect(s.app_switches).toBe(2); // a→b, b→a
    expect(s.pickups).toBe(2);
    expect(s.mean_app_session_minutes).toBe(3.3333);
    expect(s.longest_app_session_minutes).toBe(5);
    expect(s.active_window_minutes).toBe(25); // first 0 → last 25
    expect(s.first_use_ns).toBe(at(0));
    expect(s.last_use_ns).toBe(at(25));
  });

  it("keeps two studies that reuse a participant_id in separate buckets", () => {
    const rows = [
      appSession({ study_id: "S1", app_package_name: "com.a", startMin: 0, stopMin: 5 }),
      appSession({ study_id: "S2", app_package_name: "com.a", startMin: 0, stopMin: 9 }),
    ];
    const summaries = computePeriodSummaries(rows, [], (date) => date);
    expect(summaries.map((e) => [e.summary.study_id, e.summary.total_app_usage_minutes])).toEqual([
      ["S1", 5],
      ["S2", 9],
    ]);
  });

  it("counts a nulled-duration session but excludes it from time totals/mean/longest", () => {
    const withNull = [
      ...appRows,
      appSession({ app_package_name: "com.c", startMin: 30, stopMin: 31, duration_minutes: null }),
    ];
    const [entry] = computePeriodSummaries(withNull, screenRows, (date) => date);
    const s = entry!.summary;
    expect(s.app_session_count).toBe(4); // counted
    expect(s.total_app_usage_minutes).toBe(10); // 0 contribution
    expect(s.mean_app_session_minutes).toBe(3.3333); // denominator still 3
    expect(s.longest_app_session_minutes).toBe(5);
  });
});

describe("computeTopApps", () => {
  it("ranks apps by total minutes, ties broken by package name", () => {
    const rows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5 }),
      appSession({ app_package_name: "com.a", startMin: 6, stopMin: 8 }), // a = 7 total
      appSession({ app_package_name: "com.b", startMin: 8, stopMin: 18 }), // b = 10 total
    ];
    const ranked = computeTopApps(rows, (date) => date);
    // No usage_layer → everything is foreground; background_minutes is 0 and
    // total_minutes == foreground_minutes (no-op when concurrent modeling is off).
    expect(
      ranked.map((r) => [
        r.rank,
        r.app_package_name,
        r.foreground_minutes,
        r.background_minutes,
        r.total_minutes,
        r.session_count,
      ]),
    ).toEqual([
      [1, "com.b", 10, 0, 10, 1],
      [2, "com.a", 7, 0, 7, 2],
    ]);
  });
});

describe("computeCategoryBudget", () => {
  it("aggregates by category, handling spaces in category names", () => {
    const rows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, broad_app_category: "Social & Communication" }),
      appSession({ app_package_name: "com.b", startMin: 5, stopMin: 8, broad_app_category: "Social & Communication" }),
      appSession({ app_package_name: "com.c", startMin: 8, stopMin: 18, broad_app_category: "Games" }),
    ];
    expect(computeCategoryBudget(rows)).toEqual([
      {
        study_id: "S",
        participant_id: "P1",
        date: "2026-06-01",
        broad_app_category: "Games",
        foreground_minutes: 10,
        background_minutes: 0,
        total_minutes: 10,
        session_count: 1,
      },
      {
        study_id: "S",
        participant_id: "P1",
        date: "2026-06-01",
        broad_app_category: "Social & Communication",
        foreground_minutes: 8,
        background_minutes: 0,
        total_minutes: 8,
        session_count: 2,
      },
    ]);
  });

  it("buckets missing categories as Unknown", () => {
    const rows = [appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, broad_app_category: "  " })];
    expect(computeCategoryBudget(rows)[0]!.broad_app_category).toBe("Unknown");
  });
});

describe("computeCoUsage", () => {
  it("records overlapping app pairs and skips non-overlapping/self pairs", () => {
    const rows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 10 }),
      appSession({ app_package_name: "com.b", startMin: 5, stopMin: 15 }), // overlaps a by 5 min
      appSession({ app_package_name: "com.c", startMin: 20, stopMin: 25 }), // no overlap
    ];
    expect(computeCoUsage(rows)).toEqual([
      {
        study_id: "S",
        participant_id: "P1",
        app_a: "com.a",
        app_b: "com.b",
        co_usage_count: 1,
        total_overlap_minutes: 5,
      },
    ]);
  });

  it("never pairs overlapping sessions that belong to different studies", () => {
    const rows = [
      appSession({ study_id: "S1", app_package_name: "com.a", startMin: 0, stopMin: 10 }),
      appSession({ study_id: "S2", app_package_name: "com.b", startMin: 5, stopMin: 15 }),
    ];
    expect(computeCoUsage(rows)).toEqual([]);
  });

  it("returns an empty list when sessions are sequential (no overlap)", () => {
    const rows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5 }),
      appSession({ app_package_name: "com.b", startMin: 5, stopMin: 10 }),
    ];
    expect(computeCoUsage(rows)).toEqual([]);
  });
});

describe("buildAggregateOutputs", () => {
  const appRows = [
    appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, broad_app_category: "Games" }),
    appSession({ app_package_name: "com.b", startMin: 3, stopMin: 8, broad_app_category: "Games" }),
  ];
  const screenRows = [screenSession(0, 10)];

  it("emits daily + weekly + top-apps by default (no category/co-usage)", () => {
    const outputs = buildAggregateOutputs(appRows, screenRows, STUB_OPTIONS);
    expect(outputs.map((o) => o.suffix)).toEqual([
      " Daily Summary.csv",
      " Weekly Summary.csv",
      " Top Apps.csv",
    ]);
  });

  it("adds category budget and co-usage only when enabled", () => {
    const outputs = buildAggregateOutputs(appRows, screenRows, {
      ...STUB_OPTIONS,
      includeCategoryBudget: true,
      includeCoUsage: true,
    });
    expect(outputs.map((o) => o.suffix)).toContain(" Category Time Budget.csv");
    expect(outputs.map((o) => o.suffix)).toContain(" App Co-Usage.csv");
  });

  it("leads every secondary output header with study_id,study_name (multi-study contract)", () => {
    const outputs = buildAggregateOutputs(appRows, screenRows, {
      ...STUB_OPTIONS,
      includeCategoryBudget: true,
      includeCoUsage: true,
    });
    const headerOf = (suffix: string): string =>
      outputs.find((o) => o.suffix === suffix)!.csv.split("\n")[0]!;
    // FU5: study_name now follows study_id on every secondary output, matching the
    // daily/weekly summaries (uniform leading identity columns across all CSVs).
    expect(headerOf(" Top Apps.csv").startsWith("study_id,study_name,participant_id,")).toBe(true);
    expect(headerOf(" Category Time Budget.csv").startsWith("study_id,study_name,participant_id,")).toBe(true);
    expect(headerOf(" App Co-Usage.csv").startsWith("study_id,study_name,participant_id,")).toBe(true);
  });

  it("wide daily summary has metric columns plus first_use/last_use", () => {
    const daily = buildAggregateOutputs(appRows, screenRows, STUB_OPTIONS)[0]!;
    const header = daily.csv.split("\n")[0]!;
    expect(header).toContain("total_app_usage_minutes");
    expect(header).toContain("first_use");
    expect(header).toContain("last_use");
    expect(daily.rowCount).toBe(1); // one (participant, date)
  });

  it("long daily summary melts numeric scalars only (metric/value), 10 rows per period", () => {
    const daily = buildAggregateOutputs(appRows, screenRows, { ...STUB_OPTIONS, shape: "long" })[0]!;
    const header = daily.csv.split("\n")[0]!;
    expect(header).toBe("study_id,study_name,participant_id,date,timezone,metric,value");
    expect(header).not.toContain("first_use");
    // 10 numeric metrics: total_app_usage_minutes now has total_background_app_usage_minutes beside it.
    expect(daily.rowCount).toBe(10); // 1 period × 10 numeric metrics
    expect(daily.csv).toContain("total_background_app_usage_minutes");
  });
});

describe("concurrent-usage layer handling (FU1 — show foreground/background separately)", () => {
  // Post-split rows: a foreground primary session plus a background secondary
  // sub-interval (a different app) overlapping it. The period/device total must
  // NOT add the secondary layer (it double-counts the shared wall-clock); top apps
  // and category budget show the two layers as SEPARATE columns so a background-only
  // app is visible, not dropped; co-usage sees both (it measures the overlap).
  const layered: AggregateInputRow[] = [
    appSession({ app_package_name: "com.a", startMin: 0, stopMin: 10, usage_layer: "primary" }),
    appSession({ app_package_name: "com.b", startMin: 3, stopMin: 7, usage_layer: "secondary" }),
  ];

  it("period summary keeps total_app_usage_minutes foreground-only and reports background beside it", () => {
    const summary = computePeriodSummaries(layered, [], (d) => d)[0]!.summary;
    expect(summary.total_app_usage_minutes).toBe(10); // foreground device timeline, not 14
    expect(summary.total_background_app_usage_minutes).toBe(4); // secondary, shown separately
    expect(summary.app_session_count).toBe(1); // one foreground session, not 2
  });

  it("top apps show a background-only app instead of dropping it", () => {
    const top = computeTopApps(layered, (d) => d);
    // com.a is foreground (10 fg); com.b is background-only (4 bg) — now visible.
    // Ranked by total_minutes desc.
    expect(
      top.map((r) => [r.app_package_name, r.foreground_minutes, r.background_minutes, r.total_minutes]),
    ).toEqual([
      ["com.a", 10, 0, 10],
      ["com.b", 0, 4, 4],
    ]);
  });

  it("top apps split a mixed-layer app's own foreground and background time", () => {
    // The real background-app shape: one app foregrounded then backgrounded. Its
    // primary and secondary sub-intervals are disjoint, so total = fg + bg.
    const mixed: AggregateInputRow[] = [
      appSession({ app_package_name: "com.spotify", startMin: 0, stopMin: 5, usage_layer: "primary" }),
      appSession({ app_package_name: "com.spotify", startMin: 5, stopMin: 12, usage_layer: "secondary" }),
    ];
    const [row] = computeTopApps(mixed, (d) => d);
    expect([row!.foreground_minutes, row!.background_minutes, row!.total_minutes]).toEqual([5, 7, 12]);
    expect(row!.session_count).toBe(2);
  });

  it("category budget reports foreground and background minutes separately", () => {
    const withCat: AggregateInputRow[] = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 10, usage_layer: "primary", broad_app_category: "Social" }),
      appSession({ app_package_name: "com.b", startMin: 3, stopMin: 7, usage_layer: "secondary", broad_app_category: "Social" }),
    ];
    const budget = computeCategoryBudget(withCat);
    expect(budget).toHaveLength(1);
    expect(budget[0]!.foreground_minutes).toBe(10);
    expect(budget[0]!.background_minutes).toBe(4);
    expect(budget[0]!.total_minutes).toBe(14); // fg + bg (distinct apps in the category)
    expect(budget[0]!.session_count).toBe(2);
  });

  it("attributes a background overlap crossing midnight to its own date (no silent drop)", () => {
    // A secondary sub-interval whose date differs from its foreground app's date
    // (a midnight-crossing overlap) must still surface its background minutes —
    // its key isn't in the foreground key set, so it gets its own period row.
    const rows: AggregateInputRow[] = [
      appSession({ app_package_name: "com.fg", startMin: 0, stopMin: 10, usage_layer: "primary", date: "2026-06-01" }),
      appSession({ app_package_name: "com.bg", startMin: 0, stopMin: 6, usage_layer: "secondary", date: "2026-06-02" }),
    ];
    const byDate = new Map(computePeriodSummaries(rows, [], (d) => d).map((e) => [e.period, e.summary]));
    expect(byDate.get("2026-06-01")!.total_app_usage_minutes).toBe(10);
    expect(byDate.get("2026-06-01")!.total_background_app_usage_minutes).toBe(0);
    expect(byDate.get("2026-06-02")!.total_app_usage_minutes).toBe(0);
    expect(byDate.get("2026-06-02")!.total_background_app_usage_minutes).toBe(6);
  });

  it("co-usage DOES use both layers (the overlap it measures)", () => {
    const co = computeCoUsage(layered);
    expect(co).toHaveLength(1);
    expect([co[0]!.app_a, co[0]!.app_b].sort()).toEqual(["com.a", "com.b"]);
    expect(co[0]!.total_overlap_minutes).toBe(4); // [3,7] overlap = 4 min
  });

  it("is a no-op when no row is secondary (concurrent off → background 0, total == foreground)", () => {
    const primaryOnly: AggregateInputRow[] = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 10, usage_layer: "primary" }),
      appSession({ app_package_name: "com.b", startMin: 20, stopMin: 25, usage_layer: null }),
    ];
    const summary = computePeriodSummaries(primaryOnly, [], (d) => d)[0]!.summary;
    expect(summary.total_app_usage_minutes).toBe(15);
    expect(summary.total_background_app_usage_minutes).toBe(0);
    expect(summary.app_session_count).toBe(2);
    const top = computeTopApps(primaryOnly, (d) => d);
    expect(
      top.every((r) => r.background_minutes === 0 && r.total_minutes === r.foreground_minutes),
    ).toBe(true);
  });
});

describe("aggregate CSV column consistency (FU5)", () => {
  const rows: AggregateInputRow[] = [
    appSession({ app_package_name: "com.a", startMin: 0, stopMin: 10, broad_app_category: "Social" }),
    appSession({ app_package_name: "com.b", startMin: 2, stopMin: 8 }),
  ];
  const opts: BuildAggregateOptions = { ...STUB_OPTIONS, includeCategoryBudget: true, includeCoUsage: true };

  it("Top Apps / Category / Co-Usage all carry a study_name column", () => {
    const outputs = buildAggregateOutputs(rows, [], opts);
    const headerFor = (suffix: string): string =>
      outputs.find((o) => o.suffix.includes(suffix))!.csv.split("\n")[0]!;
    expect(headerFor("Top Apps")).toBe(
      "study_id,study_name,participant_id,date,rank,app_package_name,application_label,foreground_minutes,background_minutes,total_minutes,session_count",
    );
    expect(headerFor("Category Time Budget")).toBe(
      "study_id,study_name,participant_id,date,broad_app_category,foreground_minutes,background_minutes,total_minutes,session_count",
    );
    expect(headerFor("Co-Usage")).toBe(
      "study_id,study_name,participant_id,app_a,app_b,co_usage_count,total_overlap_minutes",
    );
  });
});
