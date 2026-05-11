import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import { effectiveWarnings, inspectRawFile, inspectRawFiles, isValidChronicleTimestamp } from "@/lib/fileInspection";

function fileFromText(name: string, text: string): File {
  return new File([text], name, { type: "text/csv" });
}

describe("fileInspection", () => {
  it("validates Chronicle timestamp formats without accepting blanks", () => {
    expect(isValidChronicleTimestamp("")).toBe(false);
    expect(isValidChronicleTimestamp("   ")).toBe(false);
    expect(isValidChronicleTimestamp("2026-03-07 10:00:00.123456")).toBe(true);
    expect(isValidChronicleTimestamp("March 7 2026 10:00:00")).toBe(true);
    expect(isValidChronicleTimestamp("not-a-date")).toBe(false);
  });

  it("reports ready metadata for a valid Chronicle CSV", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
        ].join("\n"),
      ),
    );

    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.rowCount).toBe(2);
    expect(inspection.timezones).toEqual(["America/Chicago"]);
    expect(inspection.warnings).toEqual([]);
  });

  it("surfaces full-file validation warnings for malformed raw CSVs", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.txt",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone,timezone",
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,not-a-date,Not/AZone,Not/AZone",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,,America/Chicago,America/Chicago",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,,",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,America/Chicago,America/Chicago",
        ].join("\n"),
      ),
    );

    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.invalidTimestampCount).toBe(1);
    expect(inspection.missingTimestampCount).toBe(1);
    expect(inspection.missingTimezoneCount).toBe(1);
    expect(inspection.duplicateTimestampCount).toBe(1);
    expect(inspection.warnings.join(" ")).toContain("File extension is not .csv");
    expect(inspection.warnings.join(" ")).toContain("Duplicate column headers found");
    expect(inspection.warnings.join(" ")).toContain("unrecognised timezone value");
    expect(inspection.warnings.join(" ")).toContain("rows have invalid event_timestamp values");
  });

  it("reports missing required columns and empty files", async () => {
    const inspection = await inspectRawFile(fileFromText("empty.csv", ""));

    expect(inspection.hasRequiredColumns).toBe(false);
    expect(inspection.rowCount).toBe(0);
    expect(inspection.warnings.join(" ")).toContain("File is empty");
    expect(inspection.warnings.join(" ")).toContain("Missing required columns");
  });

  it("reports CSV parse warnings and multiple timezone values", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07T10:05:00Z,UTC",
          '"unterminated',
        ].join("\n"),
      ),
    );

    expect(inspection.timezones).toEqual(["America/Chicago", "UTC"]);
    expect(inspection.warnings.join(" ")).toContain("2 timezone values found");
    expect(inspection.warnings.join(" ")).toContain("CSV parse warning");
  });

  it("adds effective duplicate warnings only when correction is disabled", () => {
    const inspection = {
      fileName: "Raw P01.csv",
      sizeBytes: 1,
      rowCount: 2,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 2,
      warnings: ["base"],
    };

    expect(
      effectiveWarnings(inspection, {
        ...DEFAULT_BROWSER_OPTIONS,
        correctDuplicateEventTimestamps: false,
      }),
    ).toEqual(["base", "2 event timestamps appear more than once."]);
    expect(effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS)).toEqual(["base"]);
  });

  it("inspects multiple files and reports absent timezone values", async () => {
    const inspections = await inspectRawFiles([
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07T10:00:00Z,",
        ].join("\n"),
      ),
      fileFromText(
        "Raw P02.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,March 7 2026 10:00:00,America/Chicago",
        ].join("\n"),
      ),
    ]);

    expect(inspections).toHaveLength(2);
    expect(inspections[0]?.warnings).toContain("No timezone values found.");
    expect(inspections[0]?.warnings).toContain("1 rows are missing timezone values.");
    expect(inspections[1]?.invalidTimestampCount).toBe(0);
  });

  // ── Additional cases ──────────────────────────────────────────────────────

  it("isValidChronicleTimestamp accepts UTC Z, fractional seconds, and offset formats", () => {
    expect(isValidChronicleTimestamp("2026-03-07T10:00:00Z")).toBe(true);
    expect(isValidChronicleTimestamp("2026-03-07 10:00:00.123456")).toBe(true);
    expect(isValidChronicleTimestamp("2026-03-07T10:00:00+05:30")).toBe(true);
    expect(isValidChronicleTimestamp("2026-03-07T10:00:00-06:00")).toBe(true);
  });

  it("isValidChronicleTimestamp rejects null-ish strings, time-only and bad separators", () => {
    expect(isValidChronicleTimestamp("null")).toBe(false);
    expect(isValidChronicleTimestamp("None")).toBe(false);
    // "10:00:00" is not a parseable date
    expect(isValidChronicleTimestamp("10:00:00")).toBe(false);
    // dot instead of dash in date portion — Date.parse also can't parse it
    expect(isValidChronicleTimestamp("2026.03.07T10:00:00")).toBe(false);
    // date-only IS accepted: Date.parse("2026-03-07") returns midnight UTC (valid)
    expect(isValidChronicleTimestamp("2026-03-07")).toBe(true);
  });

  it("isValidChronicleTimestamp rejects strings with internal spaces not parseable as dates", () => {
    expect(isValidChronicleTimestamp("2026-03 07 10:00:00")).toBe(false);
  });

  it("inspectRawFile: all valid timestamps → invalidTimestampCount=0", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Child,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,Child,App,Type,com.pkg,2026-03-08T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.invalidTimestampCount).toBe(0);
  });

  it("inspectRawFile: mixed valid/invalid timestamps → correct invalidTimestampCount", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Child,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,Child,App,Type,com.pkg,not-a-date,America/Chicago",
          "Study,P01,Child,App,Type,com.pkg,also-bad,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.invalidTimestampCount).toBe(2);
  });

  it("inspectRawFile: all rows have timezone → missingTimezoneCount=0", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Child,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,Child,App,Type,com.pkg,2026-03-08T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.missingTimezoneCount).toBe(0);
  });

  it("inspectRawFile: some rows missing timezone → correct missingTimezoneCount", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Child,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,Child,App,Type,com.pkg,2026-03-08T10:00:00Z,",
          "Study,P01,Child,App,Type,com.pkg,2026-03-09T10:00:00Z,",
        ].join("\n"),
      ),
    );
    expect(inspection.missingTimezoneCount).toBe(2);
  });

  it("inspectRawFile: large file handles gracefully", async () => {
    const HEADER = "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
    const rows = Array.from({ length: 500 }, (_, i) =>
      `Study,P01,Child,App,Type,com.pkg,2026-03-07T${String(Math.floor(i / 3600)).padStart(2, "0")}:${String(Math.floor((i % 3600) / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z,America/Chicago`
    );
    const inspection = await inspectRawFile(fileFromText("Raw P01.csv", [HEADER, ...rows].join("\n")));
    expect(inspection.rowCount).toBe(500);
    expect(inspection.hasRequiredColumns).toBe(true);
  });

  it("inspectRawFile: file with all required columns → hasRequiredColumns=true", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "P01,user1,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.hasRequiredColumns).toBe(true);
  });

  it("inspectRawFile: missing timezone column is accepted as UTC fallback input", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "participant_id,username,application_label,interaction_type,app_package_name,event_timestamp",
          "P01,user1,App,Type,com.pkg,2026-03-07T10:00:00Z",
        ].join("\n"),
      ),
    );

    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.missingTimezoneCount).toBe(1);
    expect(inspection.warnings).toContain("No timezone values found.");
    expect(inspection.warnings).toContain("1 rows are missing timezone values.");
    expect(inspection.warnings.join(" ")).not.toContain("Missing required columns");
  });

  it("inspectRawFile: file with extra unknown columns → still hasRequiredColumns=true", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone,extra_column,another_extra",
          "P01,user1,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago,foo,bar",
        ].join("\n"),
      ),
    );
    expect(inspection.hasRequiredColumns).toBe(true);
  });

  it("inspectRawFile: filename that doesn't match 'Raw' pattern is still processed", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "data_export.csv",
        [
          "participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "P01,user1,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.fileName).toBe("data_export.csv");
    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.rowCount).toBe(1);
  });

  it("inspectRawFile: duplicate timestamps → duplicateTimestampCount > 0", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,App,Type2,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
          "Study,P01,App,Type3,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(inspection.duplicateTimestampCount).toBe(1);
  });

  it("inspectRawFiles: parallel inspection returns correct file count", async () => {
    const files = [
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
        ].join("\n"),
      ),
      fileFromText(
        "Raw P02.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P02,App,Type,com.pkg,2026-03-08T10:00:00Z,UTC",
        ].join("\n"),
      ),
      fileFromText(
        "Raw P03.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P03,App,Type,com.pkg,2026-03-09T10:00:00Z,UTC",
        ].join("\n"),
      ),
    ];
    const inspections = await inspectRawFiles(files);
    expect(inspections).toHaveLength(3);
    expect(inspections[0]?.fileName).toBe("Raw P01.csv");
    expect(inspections[1]?.fileName).toBe("Raw P02.csv");
    expect(inspections[2]?.fileName).toBe("Raw P03.csv");
  });

  it("inspectRawFiles: empty array returns empty array", async () => {
    const inspections = await inspectRawFiles([]);
    expect(inspections).toEqual([]);
  });

  it("effectiveWarnings: correctDuplicateEventTimestamps=true suppresses duplicate warning", () => {
    const inspection = {
      fileName: "Raw P01.csv",
      sizeBytes: 10,
      rowCount: 3,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 5,
      warnings: [],
    };
    const warnings = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      correctDuplicateEventTimestamps: true,
    });
    expect(warnings.some((w) => w.includes("timestamps appear more than once"))).toBe(false);
  });

  it("effectiveWarnings: correctDuplicateEventTimestamps=false AND duplicates → warning added", () => {
    const inspection = {
      fileName: "Raw P01.csv",
      sizeBytes: 10,
      rowCount: 3,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 3,
      warnings: [],
    };
    const warnings = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      correctDuplicateEventTimestamps: false,
    });
    expect(warnings.some((w) => w.includes("3"))).toBe(true);
    expect(warnings.some((w) => w.includes("timestamps appear more than once"))).toBe(true);
  });

  it("effectiveWarnings: duplicateTimestampCount=0 → no duplicate warning regardless of flag", () => {
    const inspection = {
      fileName: "Raw P01.csv",
      sizeBytes: 10,
      rowCount: 1,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      warnings: [],
    };
    expect(effectiveWarnings(inspection, { ...DEFAULT_BROWSER_OPTIONS, correctDuplicateEventTimestamps: false })).toEqual([]);
    expect(effectiveWarnings(inspection, { ...DEFAULT_BROWSER_OPTIONS, correctDuplicateEventTimestamps: true })).toEqual([]);
  });

  it("effectiveWarnings: base warnings are always included", () => {
    const inspection = {
      fileName: "Raw P01.csv",
      sizeBytes: 10,
      rowCount: 1,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      warnings: ["base warning one", "base warning two"],
    };
    const warnings = effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS);
    expect(warnings).toContain("base warning one");
    expect(warnings).toContain("base warning two");
  });

  it("inspectRawFile: 'None' as timezone value is treated as missing timezone", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,App,Type,com.pkg,2026-03-07T10:00:00Z,None",
          "Study,P01,App,Type,com.pkg,2026-03-08T10:00:00Z,None",
        ].join("\n"),
      ),
    );
    // "None" is not a valid IANA timezone, so it should appear in invalidTimezones warning
    // and missingTimezoneCount stays 0 (the value is present, just invalid)
    expect(inspection.missingTimezoneCount).toBe(0);
    expect(inspection.warnings.some((w) => w.includes("unrecognised timezone value"))).toBe(true);
  });

  it("inspectRawFile: blank timezone column entries count as missing timezone", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,App,Type,com.pkg,2026-03-07T10:00:00Z,",
          "Study,P01,App,Type,com.pkg,2026-03-08T10:00:00Z,",
        ].join("\n"),
      ),
    );
    expect(inspection.missingTimezoneCount).toBe(2);
  });

  it("inspectRawFile: sizeBytes matches the file content size", async () => {
    const content = [
      "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,App,Type,com.pkg,2026-03-07T10:00:00Z,America/Chicago",
    ].join("\n");
    const file = fileFromText("Raw P01.csv", content);
    const inspection = await inspectRawFile(file);
    expect(inspection.sizeBytes).toBe(file.size);
  });
});
