import { describe, expect, it } from "vitest";
import { applyScreenGatedCredit, type CreditOptions } from "@/lib/stages/effectiveUsage";
import { populateTimeColumns, type CanonicalRow } from "@/lib/browserPipeline";
import fixture from "@/lib/stages/__fixtures__/screen_gated_credit/basic.json";

const DEFAULT_OPTS: CreditOptions = {
  capMinutes: 360,
  livenessToleranceMinutes: 120,
  autoLockBridgeSeconds: 120,
  noWitnessMinDayApps: 2,
};

const NS = 1_000_000_000n;

function isoToNs(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1_000_000n;
}

function eventRow(pid: string, iso: string, interactionType: string): CanonicalRow {
  return {
    participant_id: pid,
    interaction_type: interactionType,
    event_timestamp_ns: isoToNs(iso),
    timezone: "America/Chicago",
  } as unknown as CanonicalRow;
}

function sessionRow(
  pid: string,
  app: string,
  startIso: string,
  stopIso: string,
  extra: Partial<CanonicalRow> = {},
): CanonicalRow {
  const start = isoToNs(startIso);
  const stop = isoToNs(stopIso);
  const durationSeconds = Number(stop - start) / 1e9;
  const row = {
    participant_id: pid,
    interaction_type: "App Usage",
    app_package_name: app,
    application_label: app.split(".").pop(),
    username: "Target Child",
    timezone: "America/Chicago",
    start_timestamp_ns: start,
    stop_timestamp_ns: stop,
    event_timestamp_ns: start,
    duration_seconds: durationSeconds,
    duration_minutes: durationSeconds / 60,
    date: "",
    hour: 0,
    day: 0,
    weekdayMF: 0,
    weekdayMTh: 0,
    weekdaySuTh: 0,
    quarter: 0,
    ...extra,
  } as unknown as CanonicalRow;
  if (row.start_timestamp_ns !== null) {
    populateTimeColumns(row, row.start_timestamp_ns, row.timezone);
  }
  return row;
}

describe("applyScreenGatedCredit — Python parity fixture", () => {
  type FixtureEvent = { participant_id: string; iso: string; interaction_type: string };
  type FixtureSession = {
    participant_id: string;
    interaction_type: string;
    app_package_name: string;
    start_iso: string;
    stop_iso: string;
    duration_seconds: number | null;
    duration_minutes: number | null;
  };
  type FixtureExpected = FixtureSession & {
    date: string;
    hour: number;
    day: number;
    weekdayMF: number;
    weekdayMTh: number;
    weekdaySuTh: number;
    quarter: number;
  };

  const events = (fixture.events as FixtureEvent[]).map((event) =>
    eventRow(event.participant_id, event.iso, event.interaction_type),
  );
  const sessions = (fixture.sessions as FixtureSession[]).map((session) =>
    sessionRow(session.participant_id, session.app_package_name, session.start_iso, session.stop_iso, {
      interaction_type: session.interaction_type,
      duration_seconds: session.duration_seconds,
      duration_minutes:
        session.duration_minutes === null ? null : session.duration_seconds! / 60,
    }),
  );

  it("reproduces the Python original row-for-row (start/stop/durations/calendar)", () => {
    const result = applyScreenGatedCredit(sessions, events, DEFAULT_OPTS);
    const actual = [...result.creditedRows].sort((left, right) => {
      const key = (row: CanonicalRow) =>
        `${row.participant_id} ${row.app_package_name} ${String(row.start_timestamp_ns ?? row.event_timestamp_ns).padStart(25, "0")}`;
      return key(left).localeCompare(key(right));
    });
    const expected = fixture.expected as FixtureExpected[];
    expect(actual.length).toBe(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      const want = expected[index]!;
      const got = actual[index]!;
      const label = `${want.participant_id}/${want.app_package_name}@${want.start_iso}`;
      expect(got.participant_id, label).toBe(want.participant_id);
      expect(got.app_package_name, label).toBe(want.app_package_name);
      if (want.start_iso) {
        expect(got.start_timestamp_ns, label).toBe(isoToNs(want.start_iso));
        expect(got.stop_timestamp_ns, label).toBe(isoToNs(want.stop_iso));
      }
      if (want.duration_minutes === null) {
        expect(got.duration_minutes, label).toBeNull();
      } else {
        expect(got.duration_minutes!, label).toBeCloseTo(want.duration_minutes, 6);
      }
      // Calendar columns recomputed from the credited LOCAL start.
      if (want.interaction_type === "App Usage" && want.duration_minutes !== null) {
        expect(got.date, label).toBe(want.date);
        expect(got.hour, label).toBe(want.hour);
        expect(got.day, label).toBe(want.day);
        expect(got.weekdayMF, label).toBe(want.weekdayMF);
        expect(got.weekdayMTh, label).toBe(want.weekdayMTh);
        expect(got.weekdaySuTh, label).toBe(want.weekdaySuTh);
        expect(got.quarter, label).toBe(want.quarter);
      }
    }
  });

  it("reports the credit summary faithfully", () => {
    const result = applyScreenGatedCredit(sessions, events, DEFAULT_OPTS);
    expect(result.report.sessions).toBe(9);
    expect(result.report.truncatedSessions).toBe(1); // the 8h S02 session
    expect(result.report.fullyDeadSessions).toBe(2); // S04 lone-app phantom + S06 ghost
    expect(result.report.noWitnessFallbacks).toBe(3); // S04 day-1 sessions
    expect(result.report.screenIncapableParticipants).toEqual(["S05"]);
  });
});

describe("applyScreenGatedCredit — unit edge cases", () => {
  const T0 = "2026-03-07T20:00:00Z";
  const plus = (minutes: number) =>
    new Date(Date.parse(T0) + minutes * 60_000).toISOString().replace(".000Z", "Z");

  it("bridges a screen-off blip shorter than the auto-lock", () => {
    const events = [
      eventRow("P", plus(-5), "Screen Non-Interactive"),
      eventRow("P", plus(-1), "Screen Interactive"),
      eventRow("P", plus(0), "Activity Resumed"),
      eventRow("P", plus(10), "Screen Non-Interactive"),
      eventRow("P", plus(11), "Screen Interactive"), // 60s off < 120s bridge
      eventRow("P", plus(30), "Activity Paused"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(30))], events, DEFAULT_OPTS);
    expect(result.creditedRows).toHaveLength(1);
    expect(result.creditedRows[0]!.duration_minutes).toBeCloseTo(30, 6);
  });

  it("does NOT bridge an off longer than the auto-lock", () => {
    const events = [
      eventRow("P", plus(-5), "Screen Non-Interactive"),
      eventRow("P", plus(-1), "Screen Interactive"),
      eventRow("P", plus(0), "Activity Resumed"),
      eventRow("P", plus(10), "Screen Non-Interactive"),
      eventRow("P", plus(15), "Screen Interactive"), // 5min off > 2min
      eventRow("P", plus(30), "Activity Paused"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(30))], events, DEFAULT_OPTS);
    expect(result.creditedRows).toHaveLength(2);
    expect(result.creditedRows[0]!.duration_minutes).toBeCloseTo(10, 6);
    expect(result.creditedRows[1]!.duration_minutes).toBeCloseTo(15, 6);
  });

  it("a liveness gap above tolerance breaks credit even while screen-ON", () => {
    const events = [
      eventRow("P", plus(-5), "Screen Non-Interactive"),
      eventRow("P", plus(-1), "Screen Interactive"),
      eventRow("P", plus(0), "Activity Resumed"),
      eventRow("P", plus(10), "Standby Bucket Changed"),
      // silence 10 -> 200 (190min > 120min tol)
      eventRow("P", plus(200), "Standby Bucket Changed"),
      eventRow("P", plus(240), "Activity Paused"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(240))], events, DEFAULT_OPTS);
    const minutes = result.creditedRows.map((row) => row.duration_minutes);
    expect(minutes[0]).toBeCloseTo(10, 6); // 0..10
    expect(minutes[1]).toBeCloseTo(40, 6); // 200..240
  });

  it("a Device Startup inside a gap breaks the chain even under tolerance", () => {
    const events = [
      eventRow("P", plus(-5), "Screen Non-Interactive"),
      eventRow("P", plus(-1), "Screen Interactive"),
      eventRow("P", plus(0), "Activity Resumed"),
      eventRow("P", plus(10), "Standby Bucket Changed"),
      eventRow("P", plus(60), "Device Startup"), // gap 10..60 is 50min <= tol, but boot breaks
      eventRow("P", plus(90), "Activity Paused"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(90))], events, DEFAULT_OPTS);
    expect(result.creditedRows[0]!.duration_minutes).toBeCloseTo(10, 6);
  });

  it("cross-midnight credited intervals get their calendar recomputed from the new local start", () => {
    // Session 23:00 -> 01:30 local (05:00Z -> 07:30Z in CST): ON throughout.
    const startIso = "2026-03-08T04:00:00Z"; // 22:00 local Mar 7
    const stopIso = "2026-03-08T07:30:00Z"; // 01:30 local Mar 8
    const events = [
      eventRow("P", "2026-03-08T03:00:00Z", "Screen Non-Interactive"),
      eventRow("P", "2026-03-08T03:59:00Z", "Screen Interactive"),
      eventRow("P", startIso, "Activity Resumed"),
      eventRow("P", "2026-03-08T05:30:00Z", "Standby Bucket Changed"),
      // Real lock at 06:00Z (00:00 local), back on at 06:10Z.
      eventRow("P", "2026-03-08T06:00:00Z", "Screen Non-Interactive"),
      eventRow("P", "2026-03-08T06:10:00Z", "Screen Interactive"),
      eventRow("P", stopIso, "Activity Paused"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", startIso, stopIso)], events, DEFAULT_OPTS);
    expect(result.creditedRows).toHaveLength(2);
    expect(result.creditedRows[0]!.date).toBe("2026-03-07"); // pre-midnight interval
    expect(result.creditedRows[1]!.date).toBe("2026-03-08"); // post-midnight interval
    expect(result.creditedRows[1]!.hour).toBe(0);
  });

  it("throws loudly on residual unmapped interaction labels", () => {
    const events = [
      eventRow("P", plus(0), "Unknown importance: 99"),
      eventRow("P", plus(1), "Screen Interactive"),
      eventRow("P", plus(2), "Screen Non-Interactive"),
    ];
    expect(() =>
      applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(30))], events, DEFAULT_OPTS),
    ).toThrow(/unmapped interaction type/);
  });

  it("passes sub-floor (null-duration) rows through untouched", () => {
    const glance = sessionRow("P", "com.a", plus(0), plus(0.5), {
      duration_seconds: null,
      duration_minutes: null,
    });
    const result = applyScreenGatedCredit([glance], [], DEFAULT_OPTS);
    expect(result.creditedRows).toEqual([glance]);
    expect(result.report.sessions).toBe(0);
  });
});
