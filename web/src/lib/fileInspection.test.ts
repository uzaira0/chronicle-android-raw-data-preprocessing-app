import { describe, expect, it } from "vitest";

import { inspectRawFile } from "@/lib/fileInspection";

function fileFromText(name: string, text: string): File {
  return new File([text], name, { type: "text/csv" });
}

describe("fileInspection", () => {
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
    expect(inspection.warnings.join(" ")).toContain("Invalid timezone values");
    expect(inspection.warnings.join(" ")).toContain("rows have invalid event_timestamp values");
  });

  it("reports missing required columns and empty files", async () => {
    const inspection = await inspectRawFile(fileFromText("empty.csv", ""));

    expect(inspection.hasRequiredColumns).toBe(false);
    expect(inspection.warnings.join(" ")).toContain("File is empty");
    expect(inspection.warnings.join(" ")).toContain("Missing required columns");
  });
});
