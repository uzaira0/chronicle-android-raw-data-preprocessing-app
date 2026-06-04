import { describe, expect, it } from "vitest";

import { computeHourDayMatrix } from "@/lib/plotGenerator";

// All timestamps in UTC so local-hour buckets are deterministic across machines.
const at = (year: number, month: number, day: number, hour: number, min = 0): number =>
  Date.UTC(year, month - 1, day, hour, min, 0);

function row(
  startMs: number,
  stopMs: number,
  date: string,
  interaction_type = "App Usage",
) {
  return {
    date,
    start_timestamp_ns: BigInt(startMs) * 1_000_000n,
    stop_timestamp_ns: BigInt(stopMs) * 1_000_000n,
    event_timestamp_ns: BigInt(startMs) * 1_000_000n,
    interaction_type,
    app_package_name: "com.example.app",
    broad_app_category: "Games",
  };
}

describe("computeHourDayMatrix (#19 heatmap)", () => {
  it("buckets a sub-hour session into a single (date, hour) cell", () => {
    const m = computeHourDayMatrix(
      [row(at(2026, 3, 7, 10, 0), at(2026, 3, 7, 10, 30), "2026-03-07")],
      "UTC",
    );
    expect(m.dates).toEqual(["2026-03-07"]);
    expect(m.cells[0]![10]).toBe(1800); // 30 min in hour 10
    expect(m.maxCell).toBe(1800);
    // Untouched hours stay zero.
    expect(m.cells[0]![9]).toBe(0);
    expect(m.cells[0]![11]).toBe(0);
  });

  it("distributes a multi-hour session across hour buckets", () => {
    const m = computeHourDayMatrix(
      [row(at(2026, 3, 7, 10, 0), at(2026, 3, 7, 12, 30), "2026-03-07")],
      "UTC",
    );
    expect(m.cells[0]![10]).toBe(3600);
    expect(m.cells[0]![11]).toBe(3600);
    expect(m.cells[0]![12]).toBe(1800);
    expect(m.maxCell).toBe(3600);
  });

  it("splits a midnight-crossing session across two day rows", () => {
    const m = computeHourDayMatrix(
      [
        row(at(2026, 3, 7, 23, 0), at(2026, 3, 8, 1, 0), "2026-03-07"),
        // a same-second marker so 2026-03-08 exists as a row in the date set
        row(at(2026, 3, 8, 8, 0), at(2026, 3, 8, 8, 0), "2026-03-08"),
      ],
      "UTC",
    );
    expect(m.dates).toEqual(["2026-03-07", "2026-03-08"]);
    expect(m.cells[0]![23]).toBe(3600); // 23:00–24:00 on the 7th
    expect(m.cells[1]![0]).toBe(3600); // 00:00–01:00 on the 8th
  });

  it("keeps a midnight-crossing session's post-midnight slice with no other rows", () => {
    // Regression: the stop date used to be dropped unless some other row already
    // carried it. The axis now seeds from each session's spanned dates, so a
    // lone crossing session always has a row for both days.
    const m = computeHourDayMatrix(
      [row(at(2026, 3, 7, 23, 30), at(2026, 3, 8, 0, 30), "2026-03-07")],
      "UTC",
    );
    expect(m.dates).toEqual(["2026-03-07", "2026-03-08"]);
    expect(m.cells[0]![23]).toBe(1800); // 23:30–24:00 on the 7th
    expect(m.cells[1]![0]).toBe(1800); // 00:00–00:30 on the 8th
  });

  it("excludes filtered app usage unless the option enables it", () => {
    const rows = [row(at(2026, 3, 7, 9, 0), at(2026, 3, 7, 9, 30), "2026-03-07", "Filtered App Usage")];
    expect(computeHourDayMatrix(rows, "UTC").maxCell).toBe(0);
    expect(
      computeHourDayMatrix(rows, "UTC", { includeFilteredAppUsageInPlots: true }).cells[0]![9],
    ).toBe(1800);
  });

  it("ignores non-usage rows and null timestamps", () => {
    const m = computeHourDayMatrix(
      [
        { ...row(0, 0, "2026-03-07", "Device Shutdown"), start_timestamp_ns: null, stop_timestamp_ns: null },
        row(at(2026, 3, 7, 14, 0), at(2026, 3, 7, 14, 15), "2026-03-07"),
      ],
      "UTC",
    );
    expect(m.cells[0]![14]).toBe(900);
    expect(m.maxCell).toBe(900);
  });
});
