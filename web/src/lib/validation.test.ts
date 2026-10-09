import { describe, expect, it } from "vitest";

import {
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  EXECUTION_BROWSER_OPTION_KEYS,
  NUMBER_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";
import {
  collectOptionRangeViolations,
  collectRawColumnViolations,
  maskRawColumnViolations,
  OPTION_NUMERIC_RANGES,
  optionRangeError,
  rangeError,
  rawColumnViolationMessage,
  SUPPORT_FILE_ACCEPT,
  supportFileFormatError,
} from "@/lib/validation";

/**
 * Rust's inspection shape, reduced to what the gate reads. The warning text is
 * verbatim from `inspect_raw_file` ("Missing required columns: {joined}").
 */
function inspected(
  fileName: string,
  hasRequiredColumns: boolean,
  warnings: string[] = [],
) {
  return { fileName, hasRequiredColumns, warnings };
}

describe("raw required-column gate", () => {
  it("passes an inspection Rust accepted", () => {
    expect(
      collectRawColumnViolations([
        inspected("Raw P01.csv", true, ["File extension is not .csv."]),
      ]),
    ).toEqual([]);
  });

  it("names the columns Rust reported missing", () => {
    const violations = collectRawColumnViolations([
      inspected("Raw P01.csv", false, [
        "Missing required columns: app_package_name, event_timestamp",
      ]),
    ]);
    expect(violations).toEqual([
      {
        fileName: "Raw P01.csv",
        missingColumns: ["app_package_name", "event_timestamp"],
      },
    ]);
    const message = rawColumnViolationMessage(violations);
    expect(message).toContain("Raw P01.csv");
    expect(message).toContain("app_package_name, event_timestamp");
    expect(message).toContain("missing required columns");
  });

  it("still refuses when the inspection carried no column names", () => {
    const violations = collectRawColumnViolations([
      inspected("Raw P02.csv", false, []),
    ]);
    expect(violations).toEqual([
      { fileName: "Raw P02.csv", missingColumns: [] },
    ]);
    expect(rawColumnViolationMessage(violations)).toContain(
      "Raw P02.csv is missing required columns",
    );
  });

  it("uses the singular form for exactly one missing column", () => {
    expect(
      rawColumnViolationMessage(
        collectRawColumnViolations([
          inspected("Raw P03.csv", false, [
            "Missing required columns: study_id",
          ]),
        ]),
      ),
    ).toContain("is missing required column study_id");
  });

  it("reports every offending file in one refusal", () => {
    const message = rawColumnViolationMessage(
      collectRawColumnViolations([
        inspected("ok.csv", true, []),
        inspected("a.csv", false, ["Missing required columns: participant_id"]),
        inspected("b.csv", false, ["Missing required columns: interaction_type"]),
      ]),
    );
    expect(message).toContain("a.csv");
    expect(message).toContain("b.csv");
    expect(message).not.toContain("ok.csv");
  });

  it("masks the filenames in the block when demo mode is on", () => {
    // Both surfaces that show this block (the Process panel and the
    // pre-dispatch refusal in processUploadedFiles) mask through here. A
    // blocking message must not be the one place a real participant filename
    // leaks onto a shared screen.
    const violations = collectRawColumnViolations([
      inspected("P01-cohort-b.csv", false, [
        "Missing required columns: app_package_name",
      ]),
    ]);
    const masked = maskRawColumnViolations(
      violations,
      (fileName) => `File 1${fileName.slice(fileName.lastIndexOf("."))}`,
    );
    expect(masked).toEqual([
      { fileName: "File 1.csv", missingColumns: ["app_package_name"] },
    ]);
    // The unmasked list is not mutated, and the column names still come through.
    expect(violations[0]?.fileName).toBe("P01-cohort-b.csv");
    const message = rawColumnViolationMessage(masked);
    expect(message).not.toContain("cohort-b");
    expect(message).toContain("File 1.csv");
    expect(message).toContain("app_package_name");
  });

  it("ignores warnings that are not the missing-columns warning", () => {
    expect(
      collectRawColumnViolations([
        inspected("Raw P04.csv", false, [
          "3 rows have invalid event_timestamp values.",
          "Missing required columns: app_package_name",
        ]),
      ])[0]?.missingColumns,
    ).toEqual(["app_package_name"]);
  });
});

describe("support-file format gate", () => {
  it("advertises only the formats the runtime resolves", () => {
    // RuntimeSupportFiles::resolve accepts .csv and .xlsx and has a dedicated
    // fail-closed arm for .xls, so .xls must not be offered.
    expect(SUPPORT_FILE_ACCEPT).toBe(".csv,.xlsx");
    expect(SUPPORT_FILE_ACCEPT).not.toContain(".xls,");
    expect(SUPPORT_FILE_ACCEPT.endsWith(".xls")).toBe(false);
  });

  it("accepts the supported formats regardless of case", () => {
    expect(supportFileFormatError("filter.csv", SUPPORT_FILE_ACCEPT)).toBeNull();
    expect(supportFileFormatError("Filter.XLSX", SUPPORT_FILE_ACCEPT)).toBeNull();
  });

  it("refuses a legacy .xls workbook with conversion guidance", () => {
    const message = supportFileFormatError("filter.xls", SUPPORT_FILE_ACCEPT);
    expect(message).toContain("filter.xls");
    expect(message).toContain("legacy .xls");
    expect(message).toContain(".csv or .xlsx");
  });

  it("refuses any other format and names what is supported", () => {
    expect(supportFileFormatError("filter.sav", SUPPORT_FILE_ACCEPT)).toBe(
      "filter.sav is not a supported format. Upload .csv or .xlsx.",
    );
  });

  it("falls back to the runtime's formats when accept names no extension", () => {
    // The check used to build its allowed set by filtering `accept` for tokens
    // starting with "." and then returning null when that set was empty — a
    // silent all-pass branch. A MIME-only accept string (RawFilesCard already
    // uses the mixed ".csv,text/csv" shape) would have disabled the gate.
    expect(supportFileFormatError("filter.xls", "text/csv")).toContain(
      "legacy .xls",
    );
    expect(supportFileFormatError("filter.sav", "text/csv")).toBe(
      "filter.sav is not a supported format. Upload .csv or .xlsx.",
    );
    expect(supportFileFormatError("filter.csv", "")).toBeNull();
    expect(supportFileFormatError("filter.xlsx", "text/csv")).toBeNull();
  });

  it("reads the allowed set out of the picker's own accept string", () => {
    // The capability-evidence slot is CSV-only; the check must follow it.
    expect(supportFileFormatError("evidence.xlsx", ".csv")).toContain(
      "Upload .csv.",
    );
    expect(supportFileFormatError("evidence.csv", ".csv")).toBeNull();
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

describe("numeric option bounds", () => {
  const defaults = DEFAULT_BROWSER_OPTIONS as unknown as Record<
    string,
    unknown
  >;

  it("accepts every shipped default", () => {
    // A bound that excludes its own default would disable the Process button
    // on a fresh install, for a configuration the user never touched.
    expect(collectOptionRangeViolations(defaults)).toEqual([]);
  });

  it("covers a bound for every option it names, and names only real options", () => {
    const declared = new Set<string>(BROWSER_PROCESSING_OPTION_KEYS);
    for (const key of Object.keys(OPTION_NUMERIC_RANGES)) {
      expect(declared.has(key), `${key} is a real contract option`).toBe(true);
      // `parallelMaxWorkers` is optional and ships with no default (the pool
      // sizes itself), so `undefined` is its honest shipped value; every other
      // bounded option must have a real numeric default.
      expect(
        typeof defaults[key],
        `${key} default is numeric or absent`,
      ).toBe(key === "parallelMaxWorkers" ? "undefined" : "number");
    }
  });

  it("bounds every numeric option the contract declares, in both directions", () => {
    // The old version of the test above only checked that each *table* key was
    // a real option: a numeric option the contract declares and the table omits
    // passed it silently. That is exactly how `parallelMaxWorkers` went
    // unbounded — checked only by literal `rangeError(..., 0, 32)` calls in two
    // cards, which show a field error but cannot refuse a run.
    const tableKeys = new Set<string>(Object.keys(OPTION_NUMERIC_RANGES));
    const missing = NUMBER_BROWSER_OPTION_KEYS.filter(
      (key) => !tableKeys.has(key),
    );
    expect(missing, "contract numeric options with no bound").toEqual([]);

    // The only key the table carries beyond NUMBER_BROWSER_OPTION_KEYS.
    // `parallelMaxWorkers` is a real, bounded, user-editable numeric option,
    // but the contract classifies it as an execution knob, so the generated
    // numeric list does not contain it. Any *other* extra is drift.
    const contractNumeric = new Set<string>(NUMBER_BROWSER_OPTION_KEYS);
    const extra = [...tableKeys].filter((key) => !contractNumeric.has(key));
    expect(extra.sort(), "bounds for options outside the numeric list").toEqual([
      "parallelMaxWorkers",
    ]);
    expect(EXECUTION_BROWSER_OPTION_KEYS).toContain("parallelMaxWorkers");
    expect(BROWSER_PROCESSING_OPTION_KEYS).toContain("parallelMaxWorkers");
  });

  it("refuses an out-of-range worker count instead of only styling the field", () => {
    expect(optionRangeError("parallelMaxWorkers", 33)).toBe(
      "Enter a value between 0 and 32",
    );
    expect(optionRangeError("parallelMaxWorkers", 4.5)).toBe(
      "Enter a whole number of seconds",
    );
    expect(optionRangeError("parallelMaxWorkers", 0)).toBeNull();
    expect(optionRangeError("parallelMaxWorkers", 32)).toBeNull();
    expect(
      collectOptionRangeViolations({ ...defaults, parallelMaxWorkers: 500 }),
    ).toEqual([
      {
        key: "parallelMaxWorkers",
        message: "Enter a value between 0 and 32",
      },
    ]);
  });

  it("catches an emptied numeric field rather than passing 0 to the kernel", () => {
    // `Number("")` is 0. A 0-hour maximum-session threshold makes every session
    // End-of-Usage-Missing while the run still reports success, so the run has
    // to be refused before it starts.
    expect(
      collectOptionRangeViolations({
        ...defaults,
        longDurationThresholdHours: 0,
      }),
    ).toEqual([
      {
        key: "longDurationThresholdHours",
        message: "Enter a value between 1 and 1000000",
      },
    ]);
  });

  it("reports every offending option, not just the first", () => {
    const violations = collectOptionRangeViolations({
      ...defaults,
      longDurationThresholdHours: 0,
      complianceThresholdPercent: 140,
    });
    expect(violations.map((violation) => violation.key).sort()).toEqual([
      "complianceThresholdPercent",
      "longDurationThresholdHours",
    ]);
  });

  it("rejects a fraction for an integer-typed option", () => {
    expect(optionRangeError("minimumUsageDuration", 60.5)).toBe(
      "Enter a whole number of seconds",
    );
    expect(optionRangeError("minimumUsageDuration", 60)).toBeNull();
  });

  it("ignores a non-numeric value instead of inventing a violation", () => {
    expect(
      collectOptionRangeViolations({
        ...defaults,
        longDurationThresholdHours: undefined,
      }),
    ).toEqual([]);
  });
});
