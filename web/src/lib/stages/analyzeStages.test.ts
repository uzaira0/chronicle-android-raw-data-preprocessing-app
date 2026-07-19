import { describe, expect, it } from "vitest";
import type { CanonicalRow } from "@/lib/browserPipeline";
import {
  parseDeviceSharing,
  parseEnrolledDevices,
  parseStudyDates,
  parseSurveyAttribution,
} from "@/lib/stages/studySupportFiles";
import { applyObservationWindow, windowDates, windowFor } from "@/lib/stages/observationWindow";
import {
  attributePerson,
  classifyAttribution,
  lookupDeviceSharing,
  NON_TARGET,
} from "@/lib/stages/attributePerson";
import { scoreCompliance } from "@/lib/stages/scoreCompliance";
import { buildDayCoverage, CoverageInvariantError } from "@/lib/stages/dayCoverage";

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

  it("fails loud on missing required columns", () => {
    expect(() => parseStudyDates([{ pid: "P100" }])).toThrow(/missing required column/);
    expect(() => parseDeviceSharing([{ participant_id: "P1", status: "Shared" }])).toThrow(
      /missing required column/,
    );
  });

  it("parses sharing status strictly", () => {
    expect(
      parseDeviceSharing([{ participant_id: "P1", sharing_status: "Shared" }])[0]!.status,
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
    expect(answers[0]!.eventTimestampNs).toBe(answers[1]!.eventTimestampNs);
    expect(answers[0]!.user).toBe("Sibling");
    expect(answers[2]!.eventTimestampNs).toBe(1772964000000n * 1_000_000n);
  });

  it("parses enrolled devices and rejects junk counts", () => {
    expect(parseEnrolledDevices([{ participant_id: "P1", device_count: "2" }])[0]!.deviceCount).toBe(2);
    expect(() => parseEnrolledDevices([{ participant_id: "P1", device_count: "two" }])).toThrow(
      /invalid device_count/,
    );
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
    expect(windowDates(windows[0]!)).toEqual([
      "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08",
    ]);
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
    expect(result.rows[0]!.username).toBe("Target Child");
    expect(result.rows[0]!.interaction_type).toBe("App Usage");
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
    expect(result.rows[0]!.username).toBe("Target Child");
    expect(result.rows[0]!.interaction_type).toBe("App Usage");
    expect(result.rows[1]!.username).toBe("None");
    expect(result.rows[1]!.interaction_type).toBe(NON_TARGET);
    expect(result.report.kidsShellAttributions).toBe(1);
  });

  it("survey exact-timestamp relabel wins and marks non-target", () => {
    const result = attributePerson(
      [row({ username: "Target Child", event_timestamp_ns: 42n })],
      sharing,
      [{ participantId: "P100", eventTimestampNs: 42n, user: "Sibling" }],
    );
    expect(result.rows[0]!.username).toBe("Sibling (From Survey)");
    expect(result.rows[0]!.interaction_type).toBe(NON_TARGET);
    expect(result.report.surveyRelabels).toBe(1);
  });

  it("empty sharing table → everything Non-Shared (machinery not configured)", () => {
    const result = attributePerson([row({ username: "" })], [], []);
    expect(result.rows[0]!.username).toBe("Target Child");
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
    expect(result.days[0]!.compliancePercent).toBe(100);
    expect(result.days[0]!.zeroRealUsage).toBe(true);
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
    expect(result.days[0]!.knownMinutes).toBe(60);
    expect(result.days[0]!.unknownMinutes).toBe(20);
    expect(result.days[0]!.compliancePercent).toBe(75);
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
    expect(result.coverage[1]!.status).toBe("no_data");
  });

  it("windowed-out data days do not trip the invariant", () => {
    const raw = new Map([["P100", new Set(["2026-03-01", "2026-03-05"])]]);
    expect(() => buildDayCoverage([], raw, windows)).not.toThrow(CoverageInvariantError);
  });
});
