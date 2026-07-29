import { describe, expect, it } from "vitest";

import {
  rangeError,
  REQUIRED_RAW_CSV_COLUMNS,
  validateRawCsvColumns,
  validateRawCsvResult,
} from "@/lib/validation";

const ALL_REQUIRED = [...REQUIRED_RAW_CSV_COLUMNS];

describe("validateRawCsvColumns", () => {
  it("does not throw when all required columns are present", () => {
    expect(() => validateRawCsvColumns(ALL_REQUIRED)).not.toThrow();
  });

  it("does not throw when extra columns are present alongside required ones", () => {
    expect(() =>
      validateRawCsvColumns([...ALL_REQUIRED, "extra_column", "another_column"]),
    ).not.toThrow();
  });

  it("does not require timezone because missing row timezones fall back to UTC", () => {
    expect(ALL_REQUIRED).not.toContain("timezone");
    expect(() => validateRawCsvColumns(ALL_REQUIRED)).not.toThrow();
  });

  it("throws with the missing column name when one required column is absent", () => {
    const headers = ALL_REQUIRED.filter((col) => col !== "event_timestamp");
    expect(() => validateRawCsvColumns(headers)).toThrowError(/event_timestamp/);
  });

  it("lists all missing columns when multiple are absent", () => {
    const headers = ALL_REQUIRED.filter(
      (col) => col !== "event_timestamp" && col !== "app_package_name",
    );
    const fn = () => validateRawCsvColumns(headers);
    expect(fn).toThrowError(/event_timestamp/);
    expect(fn).toThrowError(/app_package_name/);
  });

  it("throws listing only the missing required columns (not the found headers)", () => {
    const headers = ["EventTimestamp", "App", "SomeOtherCol"];
    const fn = () => validateRawCsvColumns(headers);
    expect(fn).toThrowError(/Missing required columns/);
    expect(fn).not.toThrowError(/EventTimestamp/);
    expect(fn).not.toThrowError(/SomeOtherCol/);
  });

  it("throws when headers array is empty", () => {
    expect(() => validateRawCsvColumns([])).toThrowError(/Missing required columns/);
  });

  it("is case-sensitive: column names with wrong casing are treated as missing", () => {
    const wrongCase = ALL_REQUIRED.map((col) =>
      col === "event_timestamp" ? "Event_Timestamp" : col,
    );
    expect(() => validateRawCsvColumns(wrongCase)).toThrowError(/event_timestamp/);
  });
});

describe("validateRawCsvResult", () => {
  it("does not throw when headers are valid and row count is positive", () => {
    expect(() => validateRawCsvResult(ALL_REQUIRED, 5)).not.toThrow();
  });

  it("throws for missing columns even if row count is positive", () => {
    const headers = ALL_REQUIRED.filter((col) => col !== "event_timestamp");
    expect(() => validateRawCsvResult(headers, 10)).toThrowError(/event_timestamp/);
  });

  it("throws with empty-data message when all required columns are present but row count is zero", () => {
    expect(() => validateRawCsvResult(ALL_REQUIRED, 0)).toThrowError(
      "Input file has headers but no data rows",
    );
  });

  it("throws column error (not empty-data) when both columns are missing and row count is zero", () => {
    // Column validation runs first, so the missing-columns error takes precedence.
    const fn = () => validateRawCsvResult([], 0);
    expect(fn).toThrowError(/Missing required columns/);
    expect(fn).not.toThrowError(/no data rows/);
  });
});

describe("rangeError", () => {
  it("rejects NaN with the enter-a-number message", () => {
    expect(rangeError(Number.NaN)).toBe("Enter a number");
    expect(rangeError(Number.NaN, 0, 10)).toBe("Enter a number");
  });

  it("names the full range when both bounds exist", () => {
    expect(rangeError(-1, 0, 10)).toBe("Enter a value between 0 and 10");
    expect(rangeError(11, 0, 10)).toBe("Enter a value between 0 and 10");
  });

  it("names the single violated bound when only one exists", () => {
    expect(rangeError(-1, 0)).toBe("Must be at least 0");
    expect(rangeError(11, undefined, 10)).toBe("Must be at most 10");
  });

  it("returns null inside the range, inclusive of the bounds", () => {
    expect(rangeError(0, 0, 10)).toBeNull();
    expect(rangeError(10, 0, 10)).toBeNull();
    expect(rangeError(5)).toBeNull();
  });
});
