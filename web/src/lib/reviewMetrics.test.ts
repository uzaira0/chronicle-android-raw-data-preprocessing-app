import { describe, expect, it } from "vitest";

import { type AggregateInputRow } from "@/lib/aggregations";
import { buildReviewSummary } from "@/lib/reviewMetrics";

const BASE = 1_000_000_000_000_000_000n;
const at = (m: number): bigint => BASE + BigInt(Math.round(m * 60)) * 1_000_000_000n;

function appSession(
  over: Partial<AggregateInputRow> & {
    app_package_name: string;
    startMin: number;
    stopMin: number;
  },
): AggregateInputRow {
  const { startMin, stopMin, ...rest } = over;
  return {
    study_id: "S",
    participant_id: "P1",
    date: "2026-06-01",
    timezone: "America/Chicago",
    application_label: rest.app_package_name,
    broad_app_category: null,
    interaction_type: "App Usage",
    start_timestamp_ns: at(startMin),
    stop_timestamp_ns: at(stopMin),
    duration_minutes: stopMin - startMin,
    day: 2,
    weekdayMF: 1,
    weekdayMTh: 1,
    weekdaySuTh: 1,
    ...rest,
  };
}

function screenSession(
  over: Partial<AggregateInputRow> & { startMin: number; stopMin: number },
): AggregateInputRow {
  return appSession({ app_package_name: "screen", ...over, interaction_type: "Screen Usage" });
}

describe("buildReviewSummary", () => {
  it("produces one participant entry with summed totals and per-day metrics", () => {
    const appRows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, date: "2026-06-01" }),
      appSession({ app_package_name: "com.b", startMin: 10, stopMin: 13, date: "2026-06-01" }),
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 7, date: "2026-06-02" }),
    ];
    const screenRows = [screenSession({ startMin: 0, stopMin: 4, date: "2026-06-01" })];

    const summary = buildReviewSummary(appRows, screenRows);
    expect(summary.participants).toHaveLength(1);
    const p = summary.participants[0];
    expect(p.participantId).toBe("P1");
    expect(p.totals.appUsageMinutes).toBeCloseTo(15, 4); // 5 + 3 + 7
    expect(p.totals.screenUsageMinutes).toBeCloseTo(4, 4);
    expect(p.totals.appSessionCount).toBe(3);
    expect(p.totals.daysWithUsage).toBe(2);
    expect(p.totals.totalDays).toBe(2);
    expect(p.perDay.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("fills in-span gap days as zeroed, no_usage_day-flagged rows", () => {
    const appRows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, date: "2026-06-01" }),
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, date: "2026-06-03" }),
    ];
    const summary = buildReviewSummary(appRows, []);
    const p = summary.participants[0];
    expect(p.perDay.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    const gap = p.perDay.find((d) => d.date === "2026-06-02")!;
    expect(gap.flags).toContain("no_usage_day");
    expect(gap.appSessionCount).toBe(0);
    expect(p.totals.totalDays).toBe(3);
    expect(p.totals.daysWithUsage).toBe(2);
  });

  it("ranks day-detail top apps by minutes and tags categories", () => {
    const appRows = [
      appSession({
        app_package_name: "com.long",
        startMin: 0,
        stopMin: 30,
        broad_app_category: "Games",
        date: "2026-06-01",
      }),
      appSession({
        app_package_name: "com.short",
        startMin: 40,
        stopMin: 45,
        broad_app_category: "Education",
        date: "2026-06-01",
      }),
    ];
    const summary = buildReviewSummary(appRows, []);
    const top = summary.participants[0].topAppsByDate["2026-06-01"];
    expect(top.map((a) => a.appPackageName)).toEqual(["com.long", "com.short"]);
    expect(top[0].category).toBe("Games");
    expect(top[0].minutes).toBeCloseTo(30, 4);
  });

  it("separates participants and sorts them by id", () => {
    const appRows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, participant_id: "P2" }),
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, participant_id: "P1" }),
    ];
    const summary = buildReviewSummary(appRows, []);
    expect(summary.participants.map((p) => p.participantId)).toEqual(["P1", "P2"]);
  });

  it("returns no participants for an empty run", () => {
    expect(buildReviewSummary([], []).participants).toEqual([]);
  });

  it("yields an empty per-day span when the observed date is unparseable", () => {
    // A non-numeric date can't be turned into an epoch, so datesInSpan bails out
    // (both the per-component finiteness guard and the NaN cursor/last guard),
    // leaving the participant with an empty per-day span and zero total days.
    const appRows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, date: "not-a-date" }),
    ];
    const summary = buildReviewSummary(appRows, []);
    const p = summary.participants[0];
    expect(p.perDay).toEqual([]);
    expect(p.totals.totalDays).toBe(0);
    expect(p.totals.daysWithUsage).toBe(0);
  });

  it("treats an undefined session duration as zero minutes in the top-apps roll-up", () => {
    // duration_minutes filters only strict null; an undefined duration survives
    // the filter and is coalesced to 0 in the per-app minutes sum.
    const appRows = [
      appSession({
        app_package_name: "com.a",
        startMin: 0,
        stopMin: 5,
        date: "2026-06-01",
        duration_minutes: undefined,
      }),
    ];
    const summary = buildReviewSummary(appRows, []);
    const top = summary.participants[0].topAppsByDate["2026-06-01"];
    expect(top).toBeDefined();
    expect(top[0].appPackageName).toBe("com.a");
    expect(top[0].minutes).toBe(0);
  });

  it("omits top-apps for a day that has only screen sessions (no app rows)", () => {
    // The screen-only date is an observed day (it has a daily summary) but has no
    // app rows, so the top-apps lookup finds nothing and that date is absent from
    // topAppsByDate — while the app-bearing date still gets its list.
    const appRows = [
      appSession({ app_package_name: "com.a", startMin: 0, stopMin: 5, date: "2026-06-01" }),
    ];
    const screenRows = [screenSession({ startMin: 0, stopMin: 4, date: "2026-06-02" })];
    const summary = buildReviewSummary(appRows, screenRows);
    const p = summary.participants[0];
    expect(p.perDay.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(p.topAppsByDate["2026-06-01"]).toBeDefined();
    expect(p.topAppsByDate["2026-06-02"]).toBeUndefined();
  });
});
