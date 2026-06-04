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
    expect(ranked.map((r) => [r.rank, r.app_package_name, r.total_minutes, r.session_count])).toEqual([
      [1, "com.b", 10, 1],
      [2, "com.a", 7, 2],
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
      { participant_id: "P1", date: "2026-06-01", broad_app_category: "Games", total_minutes: 10, session_count: 1 },
      {
        participant_id: "P1",
        date: "2026-06-01",
        broad_app_category: "Social & Communication",
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
      { participant_id: "P1", app_a: "com.a", app_b: "com.b", co_usage_count: 1, total_overlap_minutes: 5 },
    ]);
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

  it("wide daily summary has metric columns plus first_use/last_use", () => {
    const daily = buildAggregateOutputs(appRows, screenRows, STUB_OPTIONS)[0]!;
    const header = daily.csv.split("\n")[0]!;
    expect(header).toContain("total_app_usage_minutes");
    expect(header).toContain("first_use");
    expect(header).toContain("last_use");
    expect(daily.rowCount).toBe(1); // one (participant, date)
  });

  it("long daily summary melts numeric scalars only (metric/value), 9 rows per period", () => {
    const daily = buildAggregateOutputs(appRows, screenRows, { ...STUB_OPTIONS, shape: "long" })[0]!;
    const header = daily.csv.split("\n")[0]!;
    expect(header).toBe("study_id,study_name,participant_id,date,timezone,metric,value");
    expect(header).not.toContain("first_use");
    expect(daily.rowCount).toBe(9); // 1 period × 9 numeric metrics
  });
});
