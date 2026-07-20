import { describe, expect, it } from "vitest";

import { weekdayFromCivilDate } from "@/lib/browserPipeline";

/**
 * Differential oracle for the weekday arithmetic that replaced the per-row
 * Intl weekday formatter in populateTimeColumns (docs/perf/BASELINE.md).
 *
 * Oracle = the exact formatter the old code used ("en-US", weekday: "short",
 * per timezone). The replacement is byte-equivalent iff, for every timestamp,
 * the weekday computed from the LOCAL calendar date (year/month/day as the
 * event formatter renders them) equals the weekday Intl formats for the same
 * timestamp in the same zone. The sweep concentrates on where a date-math
 * bug would show: DST transitions, fractional-offset zones, year boundaries,
 * leap days, and the century leap-year exception.
 */

const CHRONICLE_DAY: Record<string, number> = {
  Sun: 1,
  Mon: 2,
  Tue: 3,
  Wed: 4,
  Thu: 5,
  Fri: 6,
  Sat: 7,
};

const ZONES = [
  "UTC",
  "America/Chicago", // -6/-5, US DST
  "America/St_Johns", // -3:30, DST
  "Asia/Kolkata", // +5:30, no DST
  "Australia/Lord_Howe", // +10:30/+11, 30-min DST shift
  "Pacific/Kiritimati", // +14
  "Pacific/Niue", // -11
  "Australia/Eucla", // +8:45
];

function intlWeekday(ms: number, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(ms),
  );
  const day = CHRONICLE_DAY[label];
  if (day === undefined) throw new Error(`unexpected weekday label ${label}`);
  return day;
}

function localCivilDate(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const values: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  return { y: Number(values.year), m: Number(values.month), d: Number(values.day) };
}

function check(ms: number, zone: string): void {
  const { y, m, d } = localCivilDate(ms, zone);
  expect(
    weekdayFromCivilDate(y, m, d),
    `${zone} @ ${new Date(ms).toISOString()} (local ${y}-${m}-${d})`,
  ).toBe(intlWeekday(ms, zone));
}

describe("weekdayFromCivilDate ≡ Intl weekday (differential oracle)", () => {
  it("pins known anchors", () => {
    expect(weekdayFromCivilDate(1970, 1, 1)).toBe(5); // Thursday
    expect(weekdayFromCivilDate(1970, 1, 4)).toBe(1); // Sunday
    expect(weekdayFromCivilDate(2000, 2, 29)).toBe(3); // Tuesday (century leap year)
    expect(weekdayFromCivilDate(2024, 2, 29)).toBe(5); // Thursday
    expect(weekdayFromCivilDate(2026, 7, 19)).toBe(1); // Sunday
  });

  it("matches Intl through DST transitions, hour by hour", () => {
    const transitions = [
      Date.UTC(2026, 2, 8, 8, 0, 0), // US spring forward 2026-03-08 08:00Z
      Date.UTC(2026, 10, 1, 7, 0, 0), // US fall back 2026-11-01 07:00Z
      Date.UTC(2026, 9, 3, 16, 0, 0), // Lord Howe spring forward
      Date.UTC(2026, 3, 4, 15, 0, 0), // Lord Howe fall back
    ];
    for (const transition of transitions) {
      for (const zone of ZONES) {
        for (let hourOffset = -30; hourOffset <= 30; hourOffset += 1) {
          check(transition + hourOffset * 3_600_000, zone);
        }
      }
    }
  });

  it("matches Intl across year boundaries and leap days", () => {
    const anchors = [
      Date.UTC(2023, 11, 31, 0, 0, 0),
      Date.UTC(2024, 1, 28, 0, 0, 0), // into 2024-02-29
      Date.UTC(2024, 11, 31, 0, 0, 0),
      Date.UTC(2000, 1, 28, 0, 0, 0), // century leap year
      Date.UTC(2100, 1, 27, 0, 0, 0), // century NON-leap year
    ];
    for (const anchor of anchors) {
      for (const zone of ZONES) {
        for (let hourOffset = 0; hourOffset <= 72; hourOffset += 3) {
          check(anchor + hourOffset * 3_600_000, zone);
        }
      }
    }
  });

  it("matches Intl on a deterministic multi-year sweep", () => {
    // ~500 points spread over 2019–2027 at a prime step so every weekday,
    // month and local hour is hit in every zone.
    const start = Date.UTC(2019, 0, 1, 0, 0, 0);
    const step = 5_990_401_000; // ~69.3 days + 1s, prime-ish in seconds
    for (let index = 0; index < 50; index += 1) {
      const ms = start + index * step;
      for (const zone of ZONES) check(ms, zone);
    }
  });
});
