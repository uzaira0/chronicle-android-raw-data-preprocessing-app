import { describe, expect, it } from "vitest";
import type { CanonicalRow } from "@/lib/browserPipeline";
import {
  deviceNumber,
  numericalId,
  parseDeviceSharing,
  parseEnrolledDevices,
  parseStudyDates,
  parseSurveyAttribution,
} from "@/lib/stages/studySupportFiles";
import {
  applyObservationWindow,
  resolveParticipantWindows,
  windowDates,
  windowFor,
} from "@/lib/stages/observationWindow";
import {
  attributePerson,
  classifyAttribution,
  lookupDeviceSharing,
  NON_TARGET,
  resolveSharingStatuses,
} from "@/lib/stages/attributePerson";
import { scoreCompliance } from "@/lib/stages/scoreCompliance";
import {
  buildDayCoverage,
  buildRawEventDateIndex,
  CoverageInvariantError,
} from "@/lib/stages/dayCoverage";

function row(extra: Partial<CanonicalRow>): CanonicalRow {
  return {
    participant_id: "P100",
    interaction_type: "App Usage",
    app_package_name: "com.example.app",
    application_label: "app",
    username: "Target Child",
    timezone: "America/Chicago",
    date: "2026-03-07",
    duration_seconds: 600,
    duration_minutes: 10,
    event_timestamp_ns: 1_000_000_000n,
    start_timestamp_ns: 1_000_000_000n,
    stop_timestamp_ns: 601_000_000_000n,
    ...extra,
  } as unknown as CanonicalRow;
}

describe("study support-file parsers", () => {
  it("parses study dates and validates ordering", () => {
    const windows = parseStudyDates([
      { participant_id: "P100", start_date: "2026-03-01", end_date: "2026-03-10" },
      { participant_id: "P200", start_date: "3/5/2026", end_date: "3/14/2026" },
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[1]).toEqual({ participantId: "P200", startDate: "2026-03-05", endDate: "2026-03-14" });
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "2026-03-10", end_date: "2026-03-01" }]),
    ).toThrow(/ends .* before it starts/);
  });

  it("rejects an unparseable study date", () => {
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "March 1 2026", end_date: "2026-03-10" }]),
    ).toThrow(/unparseable date/);
  });

  it("fails loud on missing required columns", () => {
    expect(() => parseStudyDates([{ pid: "P100" }])).toThrow(/missing required column/);
    expect(() => parseDeviceSharing([{ participant_id: "P1", status: "Shared" }])).toThrow(
      /missing required column/,
    );
  });

  it("parses sharing status strictly", () => {
    expect(
      parseDeviceSharing([{ participant_id: "P1", sharing_status: "Shared" }])[0].status,
    ).toBe("Shared");
    expect(() =>
      parseDeviceSharing([{ participant_id: "P1", sharing_status: "maybe" }]),
    ).toThrow(/unknown sharing_status/);
  });

  it("parses survey timestamps in ISO, space-separated and epoch forms", () => {
    const answers = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "2026-03-07T10:00:00Z", users: '{"Sibling"}' },
      { participant_id: "P1", event_timestamp: "2026-03-07 10:00:00", users: "Parent" },
      { participant_id: "P1", event_timestamp: "1772964000000", users: "Target Child" },
    ]);
    expect(answers[0].eventTimestampNs).toBe(answers[1].eventTimestampNs);
    expect(answers[0].user).toBe("Sibling");
    expect(answers[2].eventTimestampNs).toBe(1772964000000n * 1_000_000n);
  });

  it("scales a 10-digit epoch-seconds survey timestamp to nanoseconds", () => {
    const answers = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "1772964000", users: "Sibling" },
    ]);
    expect(answers[0].eventTimestampNs).toBe(1772964000n * 1_000_000_000n);
  });

  it("rejects an unparseable survey timestamp", () => {
    expect(() =>
      parseSurveyAttribution([{ participant_id: "P1", event_timestamp: "not-a-date", users: "Sibling" }]),
    ).toThrow(/unparseable event_timestamp/);
  });

  it("parses enrolled devices and rejects junk counts", () => {
    expect(parseEnrolledDevices([{ participant_id: "P1", device_count: "2" }])[0].deviceCount).toBe(2);
    expect(() => parseEnrolledDevices([{ participant_id: "P1", device_count: "two" }])).toThrow(
      /invalid device_count/,
    );
  });

  it("reports (no rows) when a required column is checked on an empty file", () => {
    // Empty rows: headerLookup/requireColumns take their rows.length === 0 arms,
    // yielding the "(no rows)" available-columns message rather than crashing.
    expect(() => parseStudyDates([])).toThrow(/missing required column.*\(no rows\)/);
  });

  it("skips rows with a blank participant_id instead of emitting empty windows", () => {
    // First row seeds the header map; the second omits participant_id → its pid
    // resolves via the `?? ""` arm to "" and the `if (!pid) continue` skips it.
    const windows = parseStudyDates([
      { participant_id: "P1", start_date: "2026-03-01", end_date: "2026-03-10" },
      { start_date: "2026-03-02", end_date: "2026-03-11" },
    ]);
    expect(windows).toEqual([{ participantId: "P1", startDate: "2026-03-01", endDate: "2026-03-10" }]);
  });

  it("treats a missing start_date / end_date cell as unparseable (never silently blank)", () => {
    // A missing cell resolves through the `?? ""` fallback (lines 81, 82) to an
    // EMPTY string, so the quoted value in the error is exactly `""`. If that
    // fallback were a non-empty placeholder the quoted value would change.
    const complete = { participant_id: "P1", start_date: "2026-03-01", end_date: "2026-03-10" };
    expect(() =>
      parseStudyDates([complete, { participant_id: "P2", end_date: "2026-03-11" }]),
    ).toThrow(/unparseable date ""/);
    expect(() =>
      parseStudyDates([complete, { participant_id: "P2", start_date: "2026-03-02" }]),
    ).toThrow(/unparseable date ""/);
  });

  it("skips a blank participant_id in the sharing file; a missing status is unknown", () => {
    const complete = { participant_id: "P1", sharing_status: "Shared" };
    expect(
      parseDeviceSharing([complete, { sharing_status: "Non-Shared" }]),
    ).toEqual([{ participantId: "P1", status: "Shared" }]);
    expect(() =>
      parseDeviceSharing([complete, { participant_id: "P2" }]),
    ).toThrow(/unknown sharing_status/);
  });

  it("parses a 19-digit already-nanosecond survey timestamp verbatim", () => {
    const answers = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "1772964000000000000", users: "Sibling" },
    ]);
    expect(answers[0].eventTimestampNs).toBe(1772964000000000000n);
  });

  it("skips survey rows missing participant_id, timestamp, or user (each via its nullish arm)", () => {
    const complete = { participant_id: "P1", event_timestamp: "1772964000000000000", users: "Sib" };
    const answers = parseSurveyAttribution([
      complete,
      { event_timestamp: "1772964000000000000", users: "x" },
      { participant_id: "P2", users: "x" },
      { participant_id: "P3", event_timestamp: "1772964000000000000" },
    ]);
    expect(answers.map((a) => a.participantId)).toEqual(["P1"]);
  });

  it("skips a blank participant_id in the enrolled-devices file; a missing count reads as 0", () => {
    const complete = { participant_id: "P1", device_count: "3" };
    expect(
      parseEnrolledDevices([complete, { device_count: "4" }]),
    ).toEqual([{ participantId: "P1", deviceCount: 3 }]);
    // A missing device_count cell trims to "" → Number("") === 0 (a valid count).
    expect(
      parseEnrolledDevices([complete, { participant_id: "P2" }]),
    ).toEqual([
      { participantId: "P1", deviceCount: 3 },
      { participantId: "P2", deviceCount: 0 },
    ]);
  });

  it("numericalId returns the first 3+ digit run, or null when there are none", () => {
    expect(numericalId("P1-1464-D2")).toBe("1464");
    expect(numericalId("no-digits-here")).toBeNull();
  });
});

describe("observation window", () => {
  const windows = parseStudyDates([
    { participant_id: "P100", start_date: "2026-03-05", end_date: "2026-03-08" },
  ]);

  it("keeps in-window rows and drops out-of-window rows by LOCAL date", () => {
    const result = applyObservationWindow(
      [row({ date: "2026-03-04" }), row({ date: "2026-03-05" }), row({ date: "2026-03-08" }), row({ date: "2026-03-09" })],
      windows,
    );
    expect(result.rows.map((r) => r.date)).toEqual(["2026-03-05", "2026-03-08"]);
    expect(result.droppedRows).toBe(2);
    expect(result.participantsWithoutWindow).toEqual([]);
  });

  it("matches windows by numerical id across device suffixes", () => {
    expect(windowFor("P1-100-D2", parseStudyDates([
      { participant_id: "P1-100", start_date: "2026-03-01", end_date: "2026-03-10" },
    ]))).not.toBeNull();
  });

  it("keeps and reports participants without a window (never silently drops them)", () => {
    const result = applyObservationWindow([row({ participant_id: "P999x" })], windows);
    expect(result.rows).toHaveLength(1);
    expect(result.participantsWithoutWindow).toEqual(["P999x"]);
  });

  it("enumerates window dates inclusively", () => {
    expect(windowDates(windows[0])).toEqual([
      "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08",
    ]);
  });

  it("keeps every row and reports all participants when no windows are configured", () => {
    const result = applyObservationWindow(
      [row({ participant_id: "P100" }), row({ participant_id: "P200" }), row({ participant_id: "P100" })],
      [],
    );
    expect(result.rows).toHaveLength(3);
    expect(result.droppedRows).toBe(0);
    expect(result.participantsWithoutWindow).toEqual(["P100", "P200"]);
  });
});

describe("person attribution", () => {
  const sharing = parseDeviceSharing([
    { participant_id: "P100", sharing_status: "Shared" },
    { participant_id: "P200", sharing_status: "Non-Shared" },
  ]);

  it("exact match, then numerical+device-number; configured-but-missing is a hard error", () => {
    expect(lookupDeviceSharing("P100", sharing)).toBe("Shared");
    expect(lookupDeviceSharing("P1-200-D1", sharing)).toBe("Non-Shared");
    expect(() => lookupDeviceSharing("P1-300", sharing)).toThrow(/sharing table must cover/);
  });

  it("does NOT fall back to a numerical match with the wrong device number", () => {
    // P100 exists (device 1); a -D2 device must not inherit its status.
    expect(() => lookupDeviceSharing("P1-100-D2", sharing)).toThrow(/must cover/);
  });

  it("non-shared: unlabeled usage becomes Target Child", () => {
    const result = attributePerson([row({ participant_id: "P200", username: "" })], sharing, []);
    expect(result.rows[0].username).toBe("Target Child");
    expect(result.rows[0].interaction_type).toBe("App Usage");
  });

  it("shared: unlabeled kids-shell → Target Child; other unlabeled → None → Non-Target", () => {
    const result = attributePerson(
      [
        row({ username: "", app_package_name: "com.amazon.tahoe" }),
        row({ username: "", app_package_name: "com.example.game" }),
      ],
      sharing,
      [],
    );
    expect(result.rows[0].username).toBe("Target Child");
    expect(result.rows[0].interaction_type).toBe("App Usage");
    expect(result.rows[1].username).toBe("None");
    expect(result.rows[1].interaction_type).toBe(NON_TARGET);
    expect(result.report.kidsShellAttributions).toBe(1);
  });

  it("survey exact-timestamp relabel wins and marks non-target", () => {
    const result = attributePerson(
      [row({ username: "Target Child", event_timestamp_ns: 42n })],
      sharing,
      [{ participantId: "P100", eventTimestampNs: 42n, user: "Sibling" }],
    );
    expect(result.rows[0].username).toBe("Sibling (From Survey)");
    expect(result.rows[0].interaction_type).toBe(NON_TARGET);
    expect(result.report.surveyRelabels).toBe(1);
  });

  it("empty sharing table → everything Non-Shared (machinery not configured)", () => {
    const result = attributePerson([row({ username: "" })], [], []);
    expect(result.rows[0].username).toBe("Target Child");
  });

  it("the configured-but-missing error names the device, its numerical id, and the contract", () => {
    // Exercises the full throw template (attributePerson.ts:110-114): a pid WITH
    // a numerical id, and a pid WITHOUT one (the `?? \"none\"` arm).
    let withNumerical = "";
    try {
      lookupDeviceSharing("P1-300", sharing);
    } catch (error) {
      withNumerical = (error as Error).message;
    }
    expect(withNumerical).toContain('no device-sharing status for "P1-300"'); // line 111 literal
    expect(withNumerical).toContain("numerical=300"); // `numerical ?? "none"` keeps the real id
    expect(withNumerical).toContain("when it is configured"); // line 113 literal

    let noNumerical = "";
    try {
      lookupDeviceSharing("control", sharing); // no 3+ digit run → numericalId null
    } catch (error) {
      noNumerical = (error as Error).message;
    }
    expect(noNumerical).toContain("numerical=none"); // the "none" fallback literal (line 112)
  });

  it("does NOT run the numerical-match block when the id has no numerical part", () => {
    // pid "control" has no numerical id, so the numerical-match block (line 101 `if`)
    // must be skipped and the missing device is a HARD ERROR. If the guard were
    // forced true, "nomatch" (numericalId null, deviceNumber 1) would spuriously
    // match "control" (also null/1) and return a status instead of throwing.
    const bareShare = parseDeviceSharing([{ participant_id: "nomatch", sharing_status: "Shared" }]);
    expect(() => lookupDeviceSharing("control", bareShare)).toThrow(/sharing table must cover/);
  });

  it("resolveSharingStatuses splits and sorts shared vs non-shared pids", () => {
    // Insertion order is deliberately reverse-sorted and interleaved so any
    // dropped `.sort()`, inverted/forced filter, missing `.filter`/`.map`, or
    // `() => undefined` predicate/projection produces a distinguishable result.
    const mixed = parseDeviceSharing([
      { participant_id: "P100", sharing_status: "Shared" },
      { participant_id: "P200", sharing_status: "Shared" },
      { participant_id: "P300", sharing_status: "Non-Shared" },
      { participant_id: "P400", sharing_status: "Non-Shared" },
    ]);
    const rows = [
      row({ participant_id: "P400" }),
      row({ participant_id: "P200" }),
      row({ participant_id: "P300" }),
      row({ participant_id: "P100" }),
    ];
    const resolution = resolveSharingStatuses(rows, mixed);
    expect(resolution.sharedParticipants).toEqual(["P100", "P200"]);
    expect(resolution.nonSharedParticipants).toEqual(["P300", "P400"]);
  });

  it("non-shared: fills exactly one null username and never overwrites a present one", () => {
    const filled = attributePerson([row({ participant_id: "P200", username: "" })], sharing, []);
    expect(filled.rows[0].username).toBe("Target Child");
    expect(filled.report.nullUsernamesFilled).toBe(1); // += 1, not -= 1

    const kept = attributePerson([row({ participant_id: "P200", username: "Parent" })], sharing, []);
    expect(kept.rows[0].username).toBe("Parent"); // guard must not fire on a present name
    expect(kept.report.nullUsernamesFilled).toBe(0);
  });

  it("shared: null non-shell fill and non-target re-mark each increment their counter by one", () => {
    const result = attributePerson(
      [row({ participant_id: "P100", username: "", app_package_name: "com.example.game" })],
      sharing,
      [],
    );
    expect(result.rows[0].username).toBe("None");
    expect(result.rows[0].interaction_type).toBe(NON_TARGET);
    expect(result.report.nullUsernamesFilled).toBe(1); // += 1, not -= 1
    expect(result.report.nonTargetRows).toBe(1); // += 1, not -= 1
  });

  it("shared: a Target Child App Usage row stays App Usage (non-target guard must not fire)", () => {
    const result = attributePerson(
      [row({ participant_id: "P100", username: "Target Child", interaction_type: "App Usage" })],
      sharing,
      [],
    );
    expect(result.rows[0].interaction_type).toBe("App Usage");
    expect(result.report.nonTargetRows).toBe(0);
  });

  it("shared: a non-App-Usage row is never re-marked Non-Target (interaction-type guard)", () => {
    // Left operand of the non-target guard (attributePerson.ts:199): the re-mark is
    // gated on `interaction_type === APP_USAGE`. A Screen Usage row with a non-target
    // username must keep its interaction type — if that clause were forced true every
    // non-target interaction on a shared device would be relabeled Non-Target.
    const result = attributePerson(
      [row({ participant_id: "P100", username: "Other", interaction_type: "Screen Usage" })],
      sharing,
      [],
    );
    expect(result.rows[0].interaction_type).toBe("Screen Usage");
    expect(result.report.nonTargetRows).toBe(0);
  });

  it("returns the SAME row reference when attribution changes nothing", () => {
    // The unchanged-row fast path (line 205) returns the original object; if the
    // guard were skipped or emptied, an equal-but-fresh copy would be returned.
    const unchanged = row({ participant_id: "P200", username: "Target Child", interaction_type: "App Usage" });
    const result = attributePerson([unchanged], sharing, []);
    expect(result.rows[0]).toBe(unchanged);
  });
});

describe("compliance scoring", () => {
  it("known/(known+unknown) per day on shared devices; non-shared = 100", () => {
    const rows = [
      row({ username: "Target Child", duration_minutes: 60 }),
      row({ username: "None", duration_minutes: 40, interaction_type: NON_TARGET }),
      row({ participant_id: "P200", username: "Target Child", duration_minutes: 5 }),
    ];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    const p100 = result.days.find((day) => day.participantId === "P100")!;
    expect(p100.compliancePercent).toBe(60);
    expect(p100.isValid).toBe(false);
    const p200 = result.days.find((day) => day.participantId === "P200")!;
    expect(p200.compliancePercent).toBe(100);
    expect(p200.isValid).toBe(true);
  });

  it("a zero-usage day stays at 100 but is flagged, never silently perfect", () => {
    const rows = [row({ interaction_type: "Screen Usage", duration_minutes: null })];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    expect(result.days[0].compliancePercent).toBe(100);
    expect(result.days[0].zeroRealUsage).toBe(true);
    expect(result.zeroUsageDays).toBe(1);
  });

  it("closed attribution vocabulary {Target Child, Other, None}: Target Child + Other are KNOWN, None is unknown", () => {
    // The finalized-username vocabulary is CLOSED — exactly Target Child / Other
    // / None (survey answers name only Target Child or Other, arriving suffixed
    // "(From Survey)"). "Other" is an attributed person = known; only "None"/blank
    // is unresolved = unknown. A survey answer of "None" is impossible.
    const rows = [
      row({ username: "Target Child", duration_minutes: 20 }),
      row({ username: "Other", duration_minutes: 20, interaction_type: NON_TARGET }),
      row({ username: "Other (From Survey)", duration_minutes: 20, interaction_type: NON_TARGET }),
      row({ username: "None", duration_minutes: 20, interaction_type: NON_TARGET }),
    ];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    expect(result.days[0].knownMinutes).toBe(60);
    expect(result.days[0].unknownMinutes).toBe(20);
    expect(result.days[0].compliancePercent).toBe(75);
  });

  it("classifyAttribution maps the closed vocabulary exactly", () => {
    // The exhaustive finalized vocabulary — no other value is producible.
    expect(classifyAttribution("Target Child")).toBe("target");
    expect(classifyAttribution("Target Child (From Survey)")).toBe("target");
    expect(classifyAttribution("Other")).toBe("known_non_target");
    expect(classifyAttribution("Other (From Survey)")).toBe("known_non_target");
    expect(classifyAttribution("None")).toBe("unresolved");
    // blank/null: rows attribution never touched
    expect(classifyAttribution("")).toBe("unresolved");
    expect(classifyAttribution(null)).toBe("unresolved");
  });

  it("classifyAttribution treats the sentinel \"nan\" as unresolved, not a known person", () => {
    // isNullName recognises the string "nan"; if that literal were blanked the
    // token would fall through to known_non_target.
    expect(classifyAttribution("nan")).toBe("unresolved");
    // Both non-target arms must stay non-target (the target `if` must not be
    // forced true): "None" is unresolved and "Other" is known_non_target.
    expect(classifyAttribution("None")).toBe("unresolved");
    expect(classifyAttribution("Other")).toBe("known_non_target");
  });

  it("only App Usage / Non-Target rows feed the buckets — other interactions are skipped", () => {
    // A Screen Usage "None" row must NOT be counted as unknown minutes; if the
    // interaction-type guard were dropped it would drag compliance to 60.
    const rows = [
      row({ username: "Target Child", interaction_type: "App Usage", duration_minutes: 60 }),
      row({ username: "None", interaction_type: "Screen Usage", duration_minutes: 40 }),
    ];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    expect(result.days).toHaveLength(1);
    expect(result.days[0].knownMinutes).toBe(60);
    expect(result.days[0].unknownMinutes).toBe(0);
    expect(result.days[0].compliancePercent).toBe(100);
  });

  it("a day exactly at the threshold is valid (>=, not >)", () => {
    const rows = [
      row({ date: "2026-03-05", username: "Target Child", interaction_type: "App Usage", duration_minutes: 70 }),
      row({ date: "2026-03-05", username: "None", interaction_type: NON_TARGET, duration_minutes: 30 }),
    ];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    expect(result.days[0].compliancePercent).toBe(70);
    expect(result.days[0].isValid).toBe(true);
  });

  it("counts valid, invalid and zero-usage days distinctly (each filter isolated)", () => {
    // 3 days: valid(70) + invalid(50) + zero-usage(100, valid). Every count is
    // distinct from 0 and from the 3-day total, and validDays != invalidDays, so
    // dropping a `.filter`, zeroing a predicate, or flipping `!day.isValid` shows.
    const rows = [
      row({ date: "2026-03-05", username: "Target Child", interaction_type: "App Usage", duration_minutes: 70 }),
      row({ date: "2026-03-05", username: "None", interaction_type: NON_TARGET, duration_minutes: 30 }),
      row({ date: "2026-03-06", username: "Target Child", interaction_type: "App Usage", duration_minutes: 50 }),
      row({ date: "2026-03-06", username: "None", interaction_type: NON_TARGET, duration_minutes: 50 }),
      row({ date: "2026-03-07", interaction_type: "Screen Usage", duration_minutes: null }),
    ];
    const result = scoreCompliance(rows, new Set(["P100"]), 70);
    expect(result.days).toHaveLength(3);
    expect(result.validDays).toBe(2); // 70% day + 100% zero-usage day
    expect(result.invalidDays).toBe(1); // 50% day
    expect(result.zeroUsageDays).toBe(1); // the Screen-Usage-only day
  });

  it("sorts days by (participantId, date), not by date alone or insertion order", () => {
    // P200 is seen first and has the earlier date; a dropped/undefined/date-only
    // comparator would put P200 first. The (pid, date) order must lead with P100.
    const rows = [
      row({ participant_id: "P200", date: "2026-03-01", username: "Target Child", duration_minutes: 10 }),
      row({ participant_id: "P100", date: "2026-03-09", username: "Target Child", duration_minutes: 10 }),
    ];
    const result = scoreCompliance(rows, new Set(), 70);
    expect(result.days.map((day) => day.participantId)).toEqual(["P100", "P200"]);
  });
});

describe("day coverage", () => {
  const windows = parseStudyDates([
    { participant_id: "P100", start_date: "2026-03-05", end_date: "2026-03-07" },
  ]);

  it("classifies usage / no_activity / no_data across the window spine", () => {
    const raw = new Map([["P100", new Set(["2026-03-05", "2026-03-06"])]]);
    const usage = [row({ date: "2026-03-05" })];
    const result = buildDayCoverage(usage, raw, windows);
    expect(result.coverage).toEqual([
      { participantId: "P100", date: "2026-03-05", status: "usage" },
      { participantId: "P100", date: "2026-03-06", status: "no_activity" },
      { participantId: "P100", date: "2026-03-07", status: "no_data" },
    ]);
  });

  it("falls back to the observed data range when no windows are loaded", () => {
    const raw = new Map([["P100", new Set(["2026-03-05", "2026-03-07"])]]);
    const result = buildDayCoverage([], raw, []);
    expect(result.coverage.map((day) => day.date)).toEqual([
      "2026-03-05", "2026-03-06", "2026-03-07",
    ]);
    expect(result.coverage[1].status).toBe("no_data");
  });

  it("windowed-out data days do not trip the invariant", () => {
    const raw = new Map([["P100", new Set(["2026-03-01", "2026-03-05"])]]);
    expect(() => buildDayCoverage([], raw, windows)).not.toThrow(CoverageInvariantError);
  });

  it("throws the coverage invariant when the spine fails to cover a data day", () => {
    // A window whose endDate cannot be parsed yields an EMPTY spine, yet
    // string-comparison still admits the data day as in-window — exactly the
    // silently-dropped-day failure the invariant exists to catch.
    const badWindow = [{ participantId: "P100", startDate: "2026-03-05", endDate: "2026-99-99" }];
    const usage = [row({ date: "2026-03-06" })];
    expect(() => buildDayCoverage(usage, new Map(), badWindow)).toThrow(CoverageInvariantError);
    expect(() => buildDayCoverage(usage, new Map(), badWindow)).toThrow(/day spine does not cover it/);
  });

  it("the thrown invariant error carries the CoverageInvariantError name", () => {
    // instanceof passes on the prototype alone; the `.name` field is a
    // separate assignment the class sets and downstream error-routing reads.
    const badWindow = [{ participantId: "P100", startDate: "2026-03-05", endDate: "2026-99-99" }];
    let caught: unknown;
    try {
      buildDayCoverage([row({ date: "2026-03-06" })], new Map(), badWindow);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoverageInvariantError);
    expect((caught as Error).name).toBe("CoverageInvariantError");
  });

  it("counts each status exactly and never miscounts non-usage rows as usage", () => {
    // Window spine 03-05..03-07 with exactly one day of each status, so every
    // count is distinct from 0 and from the 3-day total. A non-App-Usage row
    // (Screen Usage) and a zero-duration App Usage row must NOT create usage
    // days — only positive-duration App Usage does.
    const raw = new Map([["P100", new Set(["2026-03-06"])]]);
    const usage = [
      row({ date: "2026-03-05", interaction_type: "App Usage", duration_minutes: 10 }),
      row({ date: "2026-03-06", interaction_type: "Screen Usage", duration_minutes: 30 }),
      row({ date: "2026-03-07", interaction_type: "App Usage", duration_minutes: 0 }),
    ];
    const result = buildDayCoverage(usage, raw, windows);
    expect(result.coverage.map((day) => day.status)).toEqual([
      "usage",
      "no_activity",
      "no_data",
    ]);
    expect(result.usageDays).toBe(1);
    expect(result.noActivityDays).toBe(1);
    expect(result.noDataDays).toBe(1);
  });

  it("windowed-out data AFTER the window end does not trip the invariant", () => {
    // 03-04 precedes the window start and 03-08 follows the window end; both
    // must be silently windowed out (never counted, never a thrown invariant).
    const raw = new Map([["P100", new Set(["2026-03-04", "2026-03-08"])]]);
    expect(() => buildDayCoverage([], raw, windows)).not.toThrow();
    const result = buildDayCoverage([], raw, windows);
    expect(result.coverage.every((day) => day.date >= "2026-03-05" && day.date <= "2026-03-07")).toBe(
      true,
    );
  });

  it("sorts the fallback spine by date even when raw dates arrive out of order", () => {
    // Set iteration is insertion order: seed 03-07 before 03-05 so an unsorted
    // range would start after it ends (empty spine → invariant throw). The
    // spine must still be the sorted, gap-filled 03-05..03-07.
    const raw = new Map([["P100", new Set(["2026-03-07", "2026-03-05"])]]);
    const result = buildDayCoverage([], raw, []);
    expect(result.coverage.map((day) => day.date)).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
    ]);
  });

  it("sorts participants deterministically regardless of first-seen order", () => {
    // usageDates seeds P200 before P100; the coverage output must still lead
    // with P100 (lexical sort), not first-appearance order.
    const twoDay = parseStudyDates([
      { participant_id: "P200", start_date: "2026-03-06", end_date: "2026-03-06" },
      { participant_id: "P100", start_date: "2026-03-05", end_date: "2026-03-05" },
    ]);
    const usage = [
      row({ participant_id: "P200", date: "2026-03-06", duration_minutes: 5 }),
      row({ participant_id: "P100", date: "2026-03-05", duration_minutes: 5 }),
    ];
    const result = buildDayCoverage(usage, new Map(), twoDay);
    expect(result.coverage.map((day) => day.participantId)).toEqual(["P100", "P200"]);
  });

  it("null / zero-duration App Usage rows never create usage days", () => {
    // Only App Usage with positive duration is a usage day (line 78 guard). A
    // null-duration and a zero-duration App Usage row must both stay no_activity.
    const raw = new Map([["P100", new Set(["2026-03-05", "2026-03-06"])]]);
    const usage = [
      row({ participant_id: "P100", date: "2026-03-05", interaction_type: "App Usage", duration_minutes: null }),
      row({ participant_id: "P100", date: "2026-03-06", interaction_type: "App Usage", duration_minutes: 0 }),
    ];
    const result = buildDayCoverage(usage, raw, []);
    expect(result.usageDays).toBe(0);
    expect(result.coverage.map((day) => day.status)).toEqual(["no_activity", "no_activity"]);
  });

  it("emits no coverage rows for a participant with neither usage nor raw dates", () => {
    // A participant present in the raw index but with an empty date set has an
    // empty fallback spine — the coverage must stay empty, never a placeholder.
    const result = buildDayCoverage([], new Map([["P100", new Set<string>()]]), []);
    expect(result.coverage).toEqual([]);
    expect(result.usageDays).toBe(0);
    expect(result.noDataDays).toBe(0);
  });
});

describe("buildRawEventDateIndex", () => {
  it("accumulates every distinct date per participant", () => {
    const index = buildRawEventDateIndex([
      row({ participant_id: "P1", date: "2026-03-05" }),
      row({ participant_id: "P1", date: "2026-03-06" }),
      row({ participant_id: "P1", date: "2026-03-05" }),
    ]);
    // Both dates must survive: a fresh Set per event would keep only the last.
    expect([...index.get("P1")!].sort()).toEqual(["2026-03-05", "2026-03-06"]);
  });

  it("files a blank participant_id under \"unknown\", not the empty string", () => {
    const index = buildRawEventDateIndex([row({ participant_id: "", date: "2026-03-09" })]);
    expect(index.has("unknown")).toBe(true);
    expect(index.has("")).toBe(false);
    expect([...index.get("unknown")!]).toEqual(["2026-03-09"]);
  });
});

describe("study support-file parsers — mutation coverage", () => {
  // requireColumns: the "Found:" list and the whole thrown message
  // (studySupportFiles.ts:52, 54).
  it("names the actual header columns found when a required column is missing", () => {
    // Non-empty rows → the "Found:" list must echo the real header (`pid`),
    // never the empty-file "(no rows)" sentinel; the message text must survive.
    // BOTH the missing-column list (line 54) and the Found list (line 52) are
    // joined with ", " — a dropped separator collapses e.g. "pid, foo" → "pidfoo"
    // and "participant_id, start_date, end_date" → one run-on token.
    expect(() => parseStudyDates([{ pid: "P100", foo: "bar" }])).toThrow(
      /Study dates file: missing required column\(s\) participant_id, start_date, end_date\. Found: pid, foo/,
    );
  });

  it('reports "(no rows)" as the found-columns list for an empty file', () => {
    expect(() => parseStudyDates([])).toThrow(/missing required column\(s\).*Found: \(no rows\)/);
  });

  // normalizeDate US-date fallback regex + its trim (studySupportFiles.ts:66).
  it("rejects junk before an otherwise-valid M/D/YYYY date (leading anchor)", () => {
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "x1/2/2026", end_date: "2026-03-10" }]),
    ).toThrow(/unparseable date/);
  });

  it("rejects trailing junk after an M/D/YYYY date (trailing anchor)", () => {
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "1/2/2026extra", end_date: "2026-03-10" }]),
    ).toThrow(/unparseable date/);
  });

  it("parses a two-digit month and day in M/D/YYYY form", () => {
    // A single-digit month group would fail on "12/..."; the {1,2} matters.
    const [w] = parseStudyDates([
      { participant_id: "P1", start_date: "12/25/2026", end_date: "2026-12-31" },
    ]);
    expect(w).toEqual({ participantId: "P1", startDate: "2026-12-25", endDate: "2026-12-31" });
  });

  it("trims a whitespace-padded date before matching the US-date fallback", () => {
    // The US-path exec must run on value.trim(), not the raw value.
    const [w] = parseStudyDates([
      { participant_id: "P1", start_date: " 3/5/2026 ", end_date: "2026-03-31" },
    ]);
    expect(w.startDate).toBe("2026-03-05");
  });

  // fileLabel identity in the two normalizeDate call sites (studySupportFiles.ts:81, 82).
  it("labels an unparseable START date with the study-dates file name", () => {
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "nope", end_date: "2026-03-10" }]),
    ).toThrow(/Study dates file: unparseable date/);
  });

  it("labels an unparseable END date with the study-dates file name", () => {
    expect(() =>
      parseStudyDates([{ participant_id: "P1", start_date: "2026-03-01", end_date: "nope" }]),
    ).toThrow(/Study dates file: unparseable date/);
  });

  // sharing-status Non-Shared branch + error text (studySupportFiles.ts:102, 106).
  it("accepts every Non-Shared spelling", () => {
    for (const spelling of ["Non-Shared", "nonshared", "not shared"]) {
      expect(
        parseDeviceSharing([{ participant_id: "P1", sharing_status: spelling }])[0].status,
      ).toBe("Non-Shared");
    }
  });

  it("names the expected sharing values in the unknown-status error", () => {
    expect(() => parseDeviceSharing([{ participant_id: "P1", sharing_status: "maybe" }])).toThrow(
      /expected "Shared" or "Non-Shared"/,
    );
  });

  // parseTimestampNs epoch-detection regex anchors (studySupportFiles.ts:116).
  it("does not treat digits with a leading non-digit as an epoch (leading anchor)", () => {
    expect(() =>
      parseSurveyAttribution([
        { participant_id: "P1", event_timestamp: "x1234567890123", users: "Sib" },
      ]),
    ).toThrow(/unparseable event_timestamp/);
  });

  it("does not treat digits with a trailing non-digit as an epoch (trailing anchor)", () => {
    expect(() =>
      parseSurveyAttribution([
        { participant_id: "P1", event_timestamp: "1234567890abc", users: "Sib" },
      ]),
    ).toThrow(/unparseable event_timestamp/);
  });

  // timezone-offset detection regex (studySupportFiles.ts:122). An offset that
  // is not detected gets a "Z" appended to an already-offset string → NaN →
  // throw, so the exact instant only survives if the offset is honored.
  it("honors an explicit colon offset instead of appending Z", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "2026-03-07T10:00:00-05:00", users: "Sib" },
    ]);
    expect(a.eventTimestampNs).toBe(BigInt(Date.UTC(2026, 2, 7, 15, 0, 0)) * 1_000_000n);
  });

  it("honors an explicit colon-less offset instead of appending Z", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "2026-03-07T10:00:00-0500", users: "Sib" },
    ]);
    expect(a.eventTimestampNs).toBe(BigInt(Date.UTC(2026, 2, 7, 15, 0, 0)) * 1_000_000n);
  });

  // ns scaling of a Date-parsed timestamp is multiplication (studySupportFiles.ts:127).
  it("scales a parsed ISO survey timestamp to nanoseconds by multiplication", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "2026-03-07T10:00:00Z", users: "Sib" },
    ]);
    expect(a.eventTimestampNs).toBe(BigInt(Date.UTC(2026, 2, 7, 10, 0, 0)) * 1_000_000n);
  });

  // survey fileLabel identity in requireColumns (studySupportFiles.ts:131).
  it("labels a missing survey-attribution column with the survey file name", () => {
    // requireColumns is passed the "Survey attribution file" label; a blanked
    // label strips the file name from the missing-column error message.
    expect(() => parseSurveyAttribution([{ pid: "x" }])).toThrow(
      /Survey attribution file: missing required column/,
    );
  });

  // survey fileLabel identity (studySupportFiles.ts:144).
  it("labels an unparseable survey timestamp with the survey file name", () => {
    expect(() =>
      parseSurveyAttribution([{ participant_id: "P1", event_timestamp: "not-a-date", users: "Sib" }]),
    ).toThrow(/Survey attribution file: unparseable event_timestamp/);
  });

  // survey field trimming + skip gate + brace/quote stripping
  // (studySupportFiles.ts:138, 139, 140).
  it("trims a whitespace-padded survey participant_id", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "  P1  ", event_timestamp: "1772964000000000000", users: "Sib" },
    ]);
    expect(a.participantId).toBe("P1");
  });

  it("trims a whitespace-only survey timestamp to blank and skips the row", () => {
    // rawTs must be trimmed BEFORE the truthiness gate: "   " → "" → row skipped.
    // Without the trim the blank survives the gate, reaches the parser, throws.
    expect(
      parseSurveyAttribution([{ participant_id: "P1", event_timestamp: "   ", users: "Sib" }]),
    ).toEqual([]);
  });

  it("strips only leading braces/quotes from a survey user, keeping interior ones", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "1772964000000000000", users: "a{b" },
    ]);
    expect(a.user).toBe("a{b");
  });

  it("strips only trailing braces/quotes from a survey user, keeping interior ones", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "1772964000000000000", users: "a}b" },
    ]);
    expect(a.user).toBe("a}b");
  });

  it("strips wrapping braces and quotes from a survey user", () => {
    const [a] = parseSurveyAttribution([
      { participant_id: "P1", event_timestamp: "1772964000000000000", users: '{"Sibling"}' },
    ]);
    expect(a.user).toBe("Sibling");
  });

  // enrolled devices: file label, pid trim, count validation
  // (studySupportFiles.ts:152, 155, 158).
  it("labels a missing enrolled-devices column with the enrolled-devices file name", () => {
    expect(() => parseEnrolledDevices([{ pid: "x" }])).toThrow(
      /Enrolled devices file: missing required column/,
    );
  });

  it("trims a whitespace-padded enrolled-devices participant_id", () => {
    const [d] = parseEnrolledDevices([{ participant_id: "  P1  ", device_count: "2" }]);
    expect(d.participantId).toBe("P1");
  });

  it("rejects a negative device_count", () => {
    // count < 0 is the sole failing clause; kills the || re-associations and
    // the always-false condition variants.
    expect(() => parseEnrolledDevices([{ participant_id: "P1", device_count: "-3" }])).toThrow(
      /invalid device_count/,
    );
  });

  it("rejects a non-integer device_count", () => {
    expect(() => parseEnrolledDevices([{ participant_id: "P1", device_count: "2.5" }])).toThrow(
      /invalid device_count/,
    );
  });

  it("rejects a non-numeric device_count", () => {
    expect(() => parseEnrolledDevices([{ participant_id: "P1", device_count: "abc" }])).toThrow(
      /invalid device_count/,
    );
  });

  // deviceNumber multi-digit -D suffix (studySupportFiles.ts:176).
  it("reads a multi-digit -D device suffix in full", () => {
    expect(deviceNumber("P1-100-D12")).toBe(12);
    expect(deviceNumber("P1-100")).toBe(1);
  });
});

describe("observation window — mutation coverage", () => {
  const oneWindow = parseStudyDates([
    { participant_id: "P1-100", start_date: "2026-03-01", end_date: "2026-03-10" },
  ]);

  it("returns the numerical-id match window object when there is no exact match", () => {
    // A bare `if (exact) return exact` mutated to `if (true) return exact` would
    // return undefined here instead of the numerical-id fallback window.
    expect(windowFor("P1-100-D2", oneWindow)).toEqual({
      participantId: "P1-100",
      startDate: "2026-03-01",
      endDate: "2026-03-10",
    });
  });

  it("returns null for a digit-less participant even when a digit-less window exists", () => {
    // numericalId("alpha") is null; without the `if (!numerical) return null`
    // guard, null === null would wrongly match the digit-less window below.
    const digitless = [{ participantId: "beta", startDate: "2026-03-01", endDate: "2026-03-10" }];
    expect(windowFor("alpha", digitless)).toBeNull();
  });

  it("resolves to an empty cache when no windows are configured", () => {
    // The early `windows.length === 0` return must skip the caching loop; without
    // it every participant is cached to null and the map is non-empty.
    const cache = resolveParticipantWindows(
      [row({ participant_id: "P1" }), row({ participant_id: "P2" })],
      [],
    );
    expect(cache.size).toBe(0);
  });

  it("reports empty-window participants in first-appearance order, not sorted", () => {
    // No windows → the whole-file passthrough branch preserves insertion order.
    // The main-loop path (reached only if that branch is skipped) sorts them.
    const result = applyObservationWindow(
      [row({ participant_id: "P200" }), row({ participant_id: "P100" })],
      [],
    );
    expect(result.participantsWithoutWindow).toEqual(["P200", "P100"]);
    expect(result.rows).toHaveLength(2);
    expect(result.droppedRows).toBe(0);
  });

  it("sorts the no-window participants collected on the windowed path", () => {
    // Windows configured (main loop runs); two participants with no window arrive
    // out of order (P900 before P800) and must come back sorted.
    const result = applyObservationWindow(
      [row({ participant_id: "P900" }), row({ participant_id: "P800" })],
      oneWindow,
    );
    expect(result.participantsWithoutWindow).toEqual(["P800", "P900"]);
  });
});
