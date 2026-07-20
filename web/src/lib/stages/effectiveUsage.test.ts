import { describe, expect, it } from "vitest";
import {
  applyScreenGatedCredit,
  assembleCreditResult,
  buildSubstrate,
  creditAllSessions,
  emitCreditedRows,
  partitionCreditSessions,
  screenIncapableParticipants,
  type CreditedSessionOutcome,
  type CreditOptions,
  type Substrate,
} from "@/lib/stages/effectiveUsage";
import { populateTimeColumns, RECIP_60, type CanonicalRow } from "@/lib/browserPipeline";
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
    duration_minutes: durationSeconds * RECIP_60,
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
        session.duration_minutes === null ? null : session.duration_seconds! * RECIP_60,
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
      const want = expected[index];
      const got = actual[index];
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
    expect(result.creditedRows[0].duration_minutes).toBeCloseTo(30, 6);
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
    expect(result.creditedRows[0].duration_minutes).toBeCloseTo(10, 6);
    expect(result.creditedRows[1].duration_minutes).toBeCloseTo(15, 6);
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
    expect(result.creditedRows[0].duration_minutes).toBeCloseTo(10, 6);
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
    expect(result.creditedRows[0].date).toBe("2026-03-07"); // pre-midnight interval
    expect(result.creditedRows[1].date).toBe("2026-03-08"); // post-midnight interval
    expect(result.creditedRows[1].hour).toBe(0);
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

  it("keeps a malformed eligible session (stop <= start) verbatim", () => {
    // Positive duration_minutes makes it credit-eligible, but stop == start
    // means eRaw <= s: the credit computation returns null and the session is
    // emitted unchanged rather than dropped.
    const malformed = sessionRow("P", "com.a", plus(0), plus(30), {
      stop_timestamp_ns: isoToNs(plus(0)),
    });
    const result = applyScreenGatedCredit([malformed], [], DEFAULT_OPTS);
    expect(result.creditedRows).toHaveLength(1);
    expect(result.creditedRows[0]).toBe(malformed);
    expect(result.report.sessions).toBe(1);
    expect(result.report.creditedRows).toBe(1);
  });

  it("bridges a zero-length OFF blip between two ON runs at the same instant", () => {
    // A Screen-Off and Screen-On stamped at the SAME nanosecond create two change
    // points at one timestamp. The segment walk then produces a zero-width segment
    // whose `segEnd > cur` guard is false, so it is skipped and the two ON runs
    // fuse into one credited interval.
    const events = [
      eventRow("P", plus(0), "Screen Interactive"),
      eventRow("P", plus(10), "Screen Non-Interactive"),
      eventRow("P", plus(10), "Screen Interactive"), // same instant as the off
      eventRow("P", plus(30), "Screen Non-Interactive"),
    ];
    const result = applyScreenGatedCredit([sessionRow("P", "com.a", plus(0), plus(30))], events, DEFAULT_OPTS);
    expect(result.creditedRows).toHaveLength(1);
    expect(result.creditedRows[0].duration_minutes).toBeCloseTo(30, 6);
  });

  it("treats a session whose participant has no raw events as screen-incapable", () => {
    // The ghost participant is absent from the substrate: allTs and boots resolve
    // through their `?? []` arms and pts is undefined, so the session is credited
    // whole (screen-incapable pass-through) and the participant is reported.
    const events = [
      eventRow("P", plus(0), "Screen Interactive"),
      eventRow("P", plus(1), "Screen Non-Interactive"),
    ];
    const result = applyScreenGatedCredit(
      [sessionRow("GHOST", "com.a", plus(0), plus(30))],
      events,
      DEFAULT_OPTS,
    );
    expect(result.report.screenIncapableParticipants).toContain("GHOST");
    expect(result.creditedRows).toHaveLength(1);
    expect(result.creditedRows[0].duration_minutes).toBeCloseTo(30, 6);
  });
});

describe("effectiveUsage — canonicalType guard (regex/string mutants)", () => {
  it("does NOT throw when 'Unknown importance:' appears mid-string (anchored ^)", () => {
    // 1586: /^Unknown importance:/ → /Unknown importance:/ would throw here.
    expect(() => buildSubstrate([eventRow("P", "2026-03-07T00:00:00Z", "x Unknown importance: 1")])).not.toThrow();
  });

  it("does NOT throw when 'n: <digit>' appears mid-string (anchored ^)", () => {
    // 1587: /^n: \d/ → /n: \d/ would throw here.
    expect(() => buildSubstrate([eventRow("P", "2026-03-07T00:00:00Z", "xn: 5")])).not.toThrow();
  });

  it("throws on a leading 'n: <digit>' label, requiring the digit class", () => {
    // 1588: /^n: \d/ → /^n: \D/ would NOT throw here (5 is a digit, not \D).
    expect(() => buildSubstrate([eventRow("P", "2026-03-07T00:00:00Z", "n: 5")])).toThrow(
      /unmapped interaction type/,
    );
  });

  it("throws with the full remediation sentence in the message", () => {
    // 1591: the line-85 string literal → "" would drop this clause.
    expect(() =>
      buildSubstrate([eventRow("P", "2026-03-07T00:00:00Z", "Unknown importance: 9")]),
    ).toThrow(/extend the interaction-type mapping before crediting/);
  });
});

describe("effectiveUsage — buildSubstrate change points / capability / sort", () => {
  it("dedupes consecutive same-state events and drops non-witness events into no change point", () => {
    // 1593 (out=[] not ["Stryker..."]) and 1602 (state===null||state===last continue).
    const sub = buildSubstrate([
      eventRow("P", "2026-03-07T00:00:00Z", "Screen Interactive"), // ON
      eventRow("P", "2026-03-07T00:01:00Z", "User Interaction"), // ON again → deduped
      eventRow("P", "2026-03-07T00:02:00Z", "Standby Bucket Changed"), // null → skipped
      eventRow("P", "2026-03-07T00:03:00Z", "Screen Non-Interactive"), // OFF
    ]);
    const pts = sub.pts.get("P")!;
    expect(pts).toEqual([
      { t: isoToNs("2026-03-07T00:00:00Z"), state: "ON" },
      { t: isoToNs("2026-03-07T00:03:00Z"), state: "OFF" },
    ]);
  });

  it("marks a participant capable only when BOTH a screen-on and screen-off witness are present", () => {
    // 1818/1820 (hasOn some/===), 1823/1825 (hasOff some/===), 1826/1828 (hasOn && hasOff).
    const onlyOn = buildSubstrate([eventRow("A", "2026-03-07T00:00:00Z", "Screen Interactive")]);
    expect(onlyOn.capable.has("A")).toBe(false);
    const onlyOff = buildSubstrate([eventRow("B", "2026-03-07T00:00:00Z", "Screen Non-Interactive")]);
    expect(onlyOff.capable.has("B")).toBe(false);
    const both = buildSubstrate([
      eventRow("C", "2026-03-07T00:00:00Z", "Screen Interactive"),
      eventRow("C", "2026-03-07T00:01:00Z", "Screen Non-Interactive"),
    ]);
    expect(both.capable.has("C")).toBe(true);
  });

  it("collects Device Startup timestamps as boots and sorts all events ascending", () => {
    // 1805/1806/1807/1808 sort comparator arms.
    const sub = buildSubstrate([
      eventRow("P", "2026-03-07T00:05:00Z", "Screen Interactive"),
      eventRow("P", "2026-03-07T00:01:00Z", "Device Startup"),
      eventRow("P", "2026-03-07T00:03:00Z", "Screen Non-Interactive"),
    ]);
    expect(sub.boots.get("P")).toEqual([isoToNs("2026-03-07T00:01:00Z")]);
    expect(sub.allTs.get("P")).toEqual([
      isoToNs("2026-03-07T00:01:00Z"),
      isoToNs("2026-03-07T00:03:00Z"),
      isoToNs("2026-03-07T00:05:00Z"),
    ]);
  });

  it("preserves input order for tied-timestamp opposite-state events (stable sort)", () => {
    // 1808: `left.t < right.t` → `left.t <= right.t` reverses tied elements, so the
    // change points would come out [OFF, ON] instead of the input order [ON, OFF].
    const t = "2026-03-07T00:00:00Z";
    const sub = buildSubstrate([
      eventRow("P", t, "Screen Interactive"), // ON, first in input
      eventRow("P", t, "Screen Non-Interactive"), // OFF, same instant, second
    ]);
    expect(sub.pts.get("P")).toEqual([
      { t: isoToNs(t), state: "ON" },
      { t: isoToNs(t), state: "OFF" },
    ]);
  });
});

describe("effectiveUsage — direct substrate / helper coverage", () => {
  const MIN = 60n * NS;

  function rawSession(pid: string, startNs: bigint, stopNs: bigint): CanonicalRow {
    return {
      participant_id: pid,
      interaction_type: "App Usage",
      app_package_name: "com.a",
      application_label: "a",
      username: "Target Child",
      timezone: "America/Chicago",
      start_timestamp_ns: startNs,
      stop_timestamp_ns: stopNs,
      event_timestamp_ns: startNs,
      duration_seconds: Number(stopNs - startNs) / 1e9,
      duration_minutes: (Number(stopNs - startNs) / 1e9) * RECIP_60,
      date: "2026-03-07",
    } as unknown as CanonicalRow;
  }

  it("buckets an event with a blank participant_id under \"unknown\" and sorts ties/reorders", () => {
    // Blank participant_id → the `|| "unknown"` arm. Out-of-order plus a tied
    // timestamp exercises every arm of the per-participant sort comparator.
    const events: CanonicalRow[] = [
      eventRow("", "2026-03-07T00:10:00Z", "Screen Interactive"),
      eventRow("", "2026-03-07T00:00:00Z", "Screen Non-Interactive"),
      eventRow("", "2026-03-07T00:10:00Z", "User Interaction"), // ties the first event's ts
    ];
    const sub = buildSubstrate(events);
    expect(sub.allTs.has("unknown")).toBe(true);
    const ts = sub.allTs.get("unknown")!;
    // Sorted ascending, tie preserved.
    expect(ts).toEqual([...ts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(ts[0]).toBe(isoToNs("2026-03-07T00:00:00Z"));
  });

  it("falls back to a zero day-app count when the (pid, date) key is absent from the map", () => {
    // creditAllSessions with an empty dayApps map → `dayApps.get(...)?.size ?? 0`
    // takes its nullish arm, so the no-witness fallback is not granted.
    const sub = buildSubstrate([]); // no screen witnesses at all → incapable
    const outcomes = creditAllSessions(
      [rawSession("P", 0n, 10n * MIN)],
      sub,
      new Map<string, Set<string>>(),
      DEFAULT_OPTS,
    );
    expect(outcomes).toHaveLength(1);
    // No pts for P → screen-incapable → credited whole.
    expect(outcomes[0].intervals).toEqual([[0n, 10n * MIN]]);
  });

  it("returns no alive intervals when the participant has zero events in-window", () => {
    // allTs is empty for P, so aliveIntervals slices an empty window (win.length
    // === 0 → early return []), leaving nothing to credit.
    const sub: Substrate = {
      pts: new Map([
        ["P", [
          { t: 0n, state: "ON" },
          { t: MIN, state: "OFF" },
        ]],
      ]),
      boots: new Map([["P", []]]),
      allTs: new Map([["P", []]]),
      capable: new Set(["P"]),
    };
    const outcomes = creditAllSessions([rawSession("P", 10n * MIN, 20n * MIN)], sub, new Map(), DEFAULT_OPTS);
    expect(outcomes[0].intervals).toEqual([]);
  });

  it("intersects disjoint ON and alive intervals to nothing", () => {
    // ON runs are [0,5] and [20,25]; the device is only alive [10,15]. Every
    // compared pair is disjoint (hi <= lo), so the intersection guard never pushes.
    const sub: Substrate = {
      pts: new Map([
        ["P", [
          { t: 0n, state: "ON" },
          { t: 5n * MIN, state: "OFF" },
          { t: 20n * MIN, state: "ON" },
          { t: 25n * MIN, state: "OFF" },
        ]],
      ]),
      boots: new Map([["P", []]]),
      allTs: new Map([["P", [10n * MIN, 15n * MIN]]]),
      capable: new Set(["P"]),
    };
    const outcomes = creditAllSessions([rawSession("P", 0n, 30n * MIN)], sub, new Map(), DEFAULT_OPTS);
    expect(outcomes[0].intervals).toEqual([]);
  });

  it("skips a zero-width credited interval and counts the session fully dead", () => {
    const outcome: CreditedSessionOutcome = {
      row: rawSession("P", 0n, 10n * MIN),
      intervals: [[5n * MIN, 5n * MIN]], // b <= a → skipped
      truncated: false,
      usedNoWitnessFallback: false,
    };
    const emission = emitCreditedRows([outcome]);
    expect(emission.credited).toHaveLength(0);
    expect(emission.fullyDeadSessions).toBe(1);
  });

  it("defaults a credited row's timezone to UTC when the source row has none", () => {
    const row = { ...rawSession("P", 0n, 10n * MIN), timezone: "" };
    const emission = emitCreditedRows([
      { row, intervals: [[0n, 10n * MIN]], truncated: false, usedNoWitnessFallback: false },
    ]);
    expect(emission.credited).toHaveLength(1);
    // Calendar is recomputed from the interval start (0n) against the fallback
    // "UTC" zone → the UTC epoch date, proving the `timezone || "UTC"` arm ran.
    expect(emission.credited[0].date).toBe("1970-01-01");
    expect(emission.credited[0].hour).toBe(0);
  });

  it("treats null durations as zero minutes when tallying the credit report", () => {
    // Both reduce accumulators (credited + raw session minutes) hit their
    // `?? 0` arms when a row's duration_minutes is null.
    const nullDur = { ...rawSession("P", 0n, 10n * MIN), duration_minutes: null } as CanonicalRow;
    const result = assembleCreditResult(
      { sessions: [nullDur], rest: [] },
      [],
      { credited: [nullDur], truncatedSessions: 0, noWitnessFallbacks: 0, fullyDeadSessions: 0 },
    );
    expect(result.report.creditedMinutes).toBe(0);
    expect(result.report.rawSessionMinutes).toBe(0);
    expect(result.report.creditedRows).toBe(1);
    expect(result.report.sessions).toBe(1);
  });
});

describe("effectiveUsage — partition / incapable / report reduce mutants", () => {
  const MIN = 60n * NS;

  function mkRow(over: Partial<CanonicalRow>): CanonicalRow {
    return {
      participant_id: "P",
      interaction_type: "App Usage",
      app_package_name: "com.a",
      timezone: "America/Chicago",
      start_timestamp_ns: 0n,
      stop_timestamp_ns: 10n * MIN,
      event_timestamp_ns: 0n,
      duration_seconds: 600,
      duration_minutes: 10,
      date: "2026-03-07",
      ...over,
    } as unknown as CanonicalRow;
  }

  it("splits App-Usage rows into eligible-vs-rest strictly by positive non-null duration", () => {
    // 1894 (!== null → true), 1896 (> 0 → true), 1897 (> 0 → >= 0).
    const positive = { ...mkRow({}), duration_minutes: 10 } as CanonicalRow;
    const zero = { ...mkRow({}), duration_minutes: 0 } as CanonicalRow;
    const negative = { ...mkRow({}), duration_minutes: -5 } as CanonicalRow;
    const nullDur = { ...mkRow({}), duration_minutes: null } as CanonicalRow;
    const part = partitionCreditSessions([positive, zero, negative, nullDur]);
    expect(part.sessions).toEqual([positive]);
    expect(part.rest).toEqual([zero, negative, nullDur]);
  });

  it("reports a participant with change points but no ON+OFF pair as screen-incapable", () => {
    // 1911 (|| → &&), 1912 / 1915 (filter predicate → false).
    // Only ON-witness ("User Interaction") events → pts non-empty, capable=false.
    const sub = buildSubstrate([
      eventRow("Q", "2026-03-07T00:00:00Z", "User Interaction"),
      eventRow("Q", "2026-03-07T00:01:00Z", "User Interaction"),
    ]);
    expect(sub.pts.get("Q")!.length).toBeGreaterThan(0);
    expect(sub.capable.has("Q")).toBe(false);
    const incapable = screenIncapableParticipants([{ ...mkRow({}), participant_id: "Q" }], sub);
    expect(incapable).toEqual(["Q"]);
  });

  it("lists a capable-but-empty-pts participant as incapable (pts guard arms)", () => {
    // 1912 (`!pts || pts.length === 0` → false) / 1915 (`pts.length === 0` → false):
    // an (adversarial) substrate whose pts is empty yet capable must still be reported
    // incapable — dropping the pts checks leans on capability alone and excludes it.
    const sub: Substrate = {
      pts: new Map([["Z", []]]),
      boots: new Map([["Z", []]]),
      allTs: new Map([["Z", []]]),
      capable: new Set(["Z"]),
    };
    const incapable = screenIncapableParticipants([{ ...mkRow({}), participant_id: "Z" }], sub);
    expect(incapable).toEqual(["Z"]);
  });

  it("sums credited and raw session minutes additively with the nullish fallback", () => {
    // 1992/1995 (+ → -), 1993/1996 (?? 0 → && 0).
    const r3 = { ...mkRow({}), duration_minutes: 3 } as CanonicalRow;
    const r5 = { ...mkRow({}), duration_minutes: 5 } as CanonicalRow;
    const result = assembleCreditResult(
      { sessions: [r3, r5], rest: [] },
      [],
      { credited: [r3, r5], truncatedSessions: 0, noWitnessFallbacks: 0, fullyDeadSessions: 0 },
    );
    expect(result.report.creditedMinutes).toBeCloseTo(8, 6);
    expect(result.report.rawSessionMinutes).toBeCloseTo(8, 6);
  });
});

describe("effectiveUsage — creditAllSessions malformed guard / truncation", () => {
  const MIN = 60n * NS;

  function mkSession(startNs: bigint | null, stopNs: bigint | null): CanonicalRow {
    return {
      participant_id: "P",
      interaction_type: "App Usage",
      app_package_name: "com.a",
      timezone: "America/Chicago",
      start_timestamp_ns: startNs,
      stop_timestamp_ns: stopNs,
      event_timestamp_ns: startNs,
      duration_seconds: 600,
      duration_minutes: 10,
      date: "2026-03-07",
    } as unknown as CanonicalRow;
  }

  it("keeps a stop<=start session malformed (null intervals, not truncated, no fallback)", () => {
    // 1935/1937/1939 (guard conditionals → false), 1946/1947 (return booleans false).
    const sub = buildSubstrate([]);
    const [outcome] = creditAllSessions([mkSession(10n * MIN, 5n * MIN)], sub, new Map(), DEFAULT_OPTS);
    expect(outcome.intervals).toBeNull();
    expect(outcome.truncated).toBe(false);
    expect(outcome.usedNoWitnessFallback).toBe(false);
  });

  it("keeps a null-start session malformed rather than crediting it", () => {
    // 1936: `s===null || eRaw===null` → `s===null && eRaw===null` would let a
    // null-start / non-null-stop row through into the credit path.
    const sub = buildSubstrate([]);
    const [outcome] = creditAllSessions([mkSession(null, 10n * MIN)], sub, new Map(), DEFAULT_OPTS);
    expect(outcome.intervals).toBeNull();
  });

  it("keeps a negative-start / null-stop session malformed (eRaw===null guard arm)", () => {
    // 1939: `eRaw === null` → false. With eRaw null and a negative start, `eRaw <= s`
    // is `null <= s` = false, so dropping the null check lets the row into the credit
    // path where `e + tolNs` (null + bigint) throws. The guard keeps it verbatim.
    const sub = buildSubstrate([]);
    const [outcome] = creditAllSessions([mkSession(-1n, null)], sub, new Map(), DEFAULT_OPTS);
    expect(outcome.intervals).toBeNull();
  });

  it("does NOT mark a session truncated when its span exactly equals the cap", () => {
    // 1954: `eRaw > s + capNs` → `eRaw >= s + capNs` flips this boundary to true.
    const capNs = BigInt(Math.round(DEFAULT_OPTS.capMinutes * 60)) * NS;
    const sub = buildSubstrate([]);
    const [outcome] = creditAllSessions([mkSession(0n, capNs)], sub, new Map(), DEFAULT_OPTS);
    expect(outcome.truncated).toBe(false);
  });
});

describe("effectiveUsage — helper-path mutants via creditAllSessions", () => {
  const MIN = 60n * NS;
  const SEC = NS;

  type CP = { t: bigint; state: "ON" | "OFF" };

  function makeSub(pts: CP[], allTs: bigint[], boots: bigint[] = [], capable = true): Substrate {
    return {
      pts: new Map([["P", pts]]),
      boots: new Map([["P", boots]]),
      allTs: new Map([["P", allTs]]),
      capable: capable ? new Set(["P"]) : new Set<string>(),
    };
  }

  function sess(sNs: bigint, eNs: bigint): CanonicalRow {
    return {
      participant_id: "P",
      interaction_type: "App Usage",
      app_package_name: "com.a",
      timezone: "America/Chicago",
      start_timestamp_ns: sNs,
      stop_timestamp_ns: eNs,
      event_timestamp_ns: sNs,
      duration_seconds: Number(eNs - sNs) / 1e9,
      duration_minutes: (Number(eNs - sNs) / 1e9) * RECIP_60,
      date: "2026-03-07",
    } as unknown as CanonicalRow;
  }

  const noDayApps = new Map<string, Set<string>>();
  const twoDayApps = new Map<string, Set<string>>([["P 2026-03-07", new Set(["a", "b"])]]);
  const only = (sub: Substrate, row: CanonicalRow, dayApps = noDayApps, opts = DEFAULT_OPTS) =>
    creditAllSessions([row], sub, dayApps, opts)[0];

  it("credits a live ON window whole; forcing every gap 'booted' would erase it", () => {
    // 1678: `index < boots.length && ...` → `true` makes booted always true, splitting
    // alive into empty single points.
    const sub = makeSub([{ t: 0n, state: "ON" }, { t: 10n * MIN, state: "OFF" }], [0n, 10n * MIN]);
    expect(only(sub, sess(0n, 10n * MIN)).intervals).toEqual([[0n, 10n * MIN]]);
  });

  it("breaks the alive chain when a boot lands exactly at the epsilon boundary", () => {
    // 1682: `boots[index] <= b + BOOT_EPSILON_NS` → `<` would keep the chain alive.
    const boot = 60n * MIN + 10n * SEC; // exactly last-event + BOOT_EPSILON_NS
    const sub = makeSub([{ t: 0n, state: "ON" }], [0n, 60n * MIN], [boot]);
    expect(only(sub, sess(0n, 60n * MIN)).intervals).toEqual([]);
  });

  it("keeps the chain alive across a gap exactly equal to the tolerance", () => {
    // 1695: `t - last <= tolNs` → `<` would break a gap that exactly equals tolerance.
    const sub = makeSub([{ t: 0n, state: "ON" }], [0n, 120n * MIN]); // tol = 120 min
    expect(only(sub, sess(0n, 120n * MIN)).intervals).toEqual([[0n, 120n * MIN]]);
  });

  it("does not credit an ON window that only TOUCHES the alive window at an instant", () => {
    // 1739: `hi > lo` → `hi >= lo` would emit a zero-width [10min,10min] interval.
    const sub = makeSub(
      [{ t: 0n, state: "ON" }, { t: 10n * MIN, state: "OFF" }],
      [10n * MIN, 20n * MIN], // alive = [10min,20min]; onFull = [0,10min] → touch only
    );
    expect(only(sub, sess(0n, 20n * MIN)).intervals).toEqual([]);
  });

  it("splits at an OFF exactly equal to the auto-lock (no bridge)", () => {
    // 1766/1767/1768/1770 (bridge condition true) and 1774 (`dur < autoLockNs` → `<=`).
    const sub = makeSub(
      [
        { t: 0n, state: "ON" },
        { t: 10n * MIN, state: "OFF" },
        { t: 12n * MIN, state: "ON" }, // OFF span 10..12 == 120s auto-lock
        { t: 20n * MIN, state: "OFF" },
      ],
      [0n, 20n * MIN],
    );
    expect(only(sub, sess(0n, 20n * MIN)).intervals).toEqual([
      [0n, 10n * MIN],
      [12n * MIN, 20n * MIN],
    ]);
  });

  it("bridges a sub-auto-lock OFF that runs to the window end (extends credit)", () => {
    // 1776 (bridge block → {}).
    const sub = makeSub([{ t: 0n, state: "ON" }, { t: 10n * MIN, state: "OFF" }], [0n, 11n * MIN]);
    expect(only(sub, sess(0n, 11n * MIN)).intervals).toEqual([[0n, 11n * MIN]]);
  });

  it("preserves the credit's original start when bridging an interior OFF blip", () => {
    // 1777: the bridge `cur = [cur[0], seg.b]` → `[]` would drop the start (5min), and
    // the following ON re-opens from `undefined`, so intersect widens credit back to the
    // alive start (0) instead of the true ON start (5min).
    const sub = makeSub(
      [
        { t: 5n * MIN, state: "ON" }, // ON begins at 5min
        { t: 10n * MIN, state: "OFF" },
        { t: 11n * MIN, state: "ON" }, // 1-min blip bridged
        { t: 20n * MIN, state: "OFF" },
      ],
      [0n, 20n * MIN], // device alive from 0
    );
    expect(only(sub, sess(0n, 20n * MIN)).intervals).toEqual([[5n * MIN, 20n * MIN]]);
  });

  it("does not bridge a sub-auto-lock OFF that precedes the first ON (cur still null)", () => {
    // 1766/1767/1768: the bridge guard's `cur !== null && seg.state === "OFF"` left
    // arm. A short OFF *before* any ON leaves cur null; each surviving mutant makes
    // that left arm truthy so `dur < autoLockNs` alone decides, and the bridge runs
    // `cur = [cur[0], seg.b]` on a null cur → throws. The original guard is false
    // (cur === null), so the OFF is simply dropped and only the ON run is credited.
    const sub = makeSub(
      [
        { t: 0n, state: "OFF" }, // OFF from the window start, cur still null
        { t: 1n * MIN, state: "ON" }, // 60s OFF (< 120s auto-lock), then ON
        { t: 20n * MIN, state: "OFF" },
      ],
      [0n, 20n * MIN],
    );
    expect(only(sub, sess(0n, 20n * MIN)).intervals).toEqual([[1n * MIN, 20n * MIN]]);
  });

  it("passes a session through whole when capable but pts is empty (guard's pts arms)", () => {
    // 1843 (`!pts || pts.length === 0` → false) / 1846 (`pts.length === 0` → false):
    // an (adversarial) substrate whose pts is empty yet marked capable must still take
    // the screen-incapable pass-through (whole session). Dropping the pts checks falls
    // through to the credit path, which returns the empty fallback instead of [[s, e]].
    const sub = makeSub([], [0n, 10n * MIN], [], /* capable */ true);
    expect(only(sub, sess(0n, 10n * MIN)).intervals).toEqual([[0n, 10n * MIN]]);
  });

  it("fuses two ON runs across a zero-width OFF instead of pushing a bogus segment", () => {
    // 1654 (`segEnd > cur` → true) and 1656 (`segEnd > cur` → `>=`) push a zero-width
    // OFF segment; with auto-lock 0 that would split the credit into two rows.
    const sub = makeSub(
      [
        { t: 0n, state: "ON" },
        { t: 10n * MIN, state: "OFF" },
        { t: 10n * MIN, state: "ON" }, // same instant as the OFF
        { t: 20n * MIN, state: "OFF" },
      ],
      [0n, 20n * MIN],
    );
    const outcome = only(sub, sess(0n, 20n * MIN), noDayApps, { ...DEFAULT_OPTS, autoLockBridgeSeconds: 0 });
    expect(outcome.intervals).toEqual([[0n, 20n * MIN]]);
  });

  it("treats a participant with change points but not marked capable as incapable", () => {
    // 1842 (|| → &&), 1843 / 1846 (predicate → false) would credit through instead of
    // returning the whole session verbatim.
    const sub = makeSub([{ t: 0n, state: "OFF" }], [0n, 10n * MIN], [], /* capable */ false);
    expect(only(sub, sess(0n, 10n * MIN)).intervals).toEqual([[0n, 10n * MIN]]);
  });

  it("uses the forward-filled state at s (index 0) rather than nulling it", () => {
    // 1632: stateAt `index >= 0` → `index > 0` nulls the state when the only prior cp is
    // at index 0, wrongly diverting to the (empty) no-witness fallback.
    const sub = makeSub([{ t: 9n * MIN, state: "ON" }], [10n * MIN, 20n * MIN]);
    expect(only(sub, sess(10n * MIN, 20n * MIN)).intervals).toEqual([[10n * MIN, 20n * MIN]]);
  });

  it("takes the no-witness fallback when day-app count exactly meets the minimum", () => {
    // 1859 (hasCp → true) and 1874 (`>=` → `>`).
    const sub = makeSub(
      [{ t: 20n * MIN, state: "ON" }, { t: 25n * MIN, state: "OFF" }],
      [0n, 10n * MIN],
    );
    const outcome = only(sub, sess(0n, 10n * MIN), twoDayApps);
    expect(outcome.intervals).toEqual([[0n, 10n * MIN]]);
    expect(outcome.usedNoWitnessFallback).toBe(true);
  });

  it("does NOT take the fallback when a change point actually lies inside the window", () => {
    // 1854 (some → every), 1855 (arrow → undefined), 1857 (predicate → false),
    // 1861 (`cp.t >= s` → `cp.t < s`) all suppress hasCp and force the empty fallback.
    const sub = makeSub(
      [{ t: 5n * MIN, state: "ON" }, { t: 25n * MIN, state: "OFF" }],
      [0n, 10n * MIN],
    );
    expect(only(sub, sess(0n, 10n * MIN)).intervals).toEqual([[5n * MIN, 10n * MIN]]);
  });

  it("counts a change point sitting exactly on the window end as in-window", () => {
    // 1863: `cp.t <= e` → `cp.t < e` drops the boundary cp, forcing the fallback which
    // (with 2 day-apps) would credit the whole window instead of nothing.
    const sub = makeSub([{ t: 10n * MIN, state: "ON" }], [0n, 10n * MIN]);
    expect(only(sub, sess(0n, 10n * MIN), twoDayApps).intervals).toEqual([]);
  });

  it("returns no credit (not a bogus interval) when there are zero alive events", () => {
    // 1673: `if (win.length === 0) return []` → `return ["Stryker was here"]` injects a
    // string interval that survives into the credit set.
    const sub = makeSub([{ t: 0n, state: "ON" }], []);
    expect(only(sub, sess(0n, 10n * MIN)).intervals).toEqual([]);
  });
});
