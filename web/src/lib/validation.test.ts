import { describe, expect, it } from "vitest";
import { validateRawCsvColumns, validateRawCsvResult, REQUIRED_RAW_CSV_COLUMNS } from "@/lib/validation";

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

  it("throws showing found headers in the error message", () => {
    const headers = ["EventTimestamp", "App", "SomeOtherCol"];
    const fn = () => validateRawCsvColumns(headers);
    expect(fn).toThrowError(/Found: \[EventTimestamp, App, SomeOtherCol\]/);
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
