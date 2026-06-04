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

  it("does not warn when a participant spans multiple valid timezones (travel)", async () => {
    // A participant who travels legitimately produces >1 timezone; this is
    // resolved downstream by the timezone-handling step and must NOT raise a
    // warning or feed the readiness count. Regression guard for that requirement.
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P02 travel.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
          "Study,P02,Target Child,Maps,Unknown importance: 1,com.example.maps,2026-03-07 14:00:00,America/New_York",
        ].join("\n"),
      ),
    );

    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.timezones).toEqual(["America/Chicago", "America/New_York"]);
    // The only thing different about this file is the second timezone; an
    // otherwise-valid multi-timezone file must produce zero warnings.
    expect(inspection.warnings).toEqual([]);
    expect(inspection.warnings.join(" ")).not.toMatch(/timezone values found/i);
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

  const HEADER =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
  const row = (interaction: string, ts: string): string =>
    `Study,P09,Target Child,Chat,${interaction},com.example.chat,${ts},America/Chicago`;

  it("flags out-of-order event timestamps with the first offending data row", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 ooo.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 10:00:00"),
          row("Unknown importance: 2", "2026-03-07 09:00:00"), // earlier than row 1
          row("Unknown importance: 1", "2026-03-07 11:00:00"),
        ].join("\n"),
      ),
    );

    expect(inspection.outOfOrderTimestampCount).toBe(1);
    expect(inspection.firstOutOfOrderRow).toBe(2);
    expect(inspection.warnings.join(" ")).toContain("out of chronological order");
    expect(inspection.warnings.join(" ")).toContain("data row 2");
  });

  it("does not flag a participant boundary in a multi-participant file", async () => {
    // P01 runs ascending, then P02 begins earlier than P01's last timestamp.
    // Out-of-order is scoped per participant, so the boundary must NOT flag.
    const multi = (pid: string, ts: string): string =>
      `Study,${pid},Target Child,Chat,Unknown importance: 1,com.example.chat,${ts},America/Chicago`;
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw multi.csv",
        [
          HEADER,
          multi("P01", "2026-03-07 10:00:00"),
          multi("P01", "2026-03-07 11:00:00"),
          multi("P02", "2026-03-07 08:00:00"), // earlier, but a new participant
          multi("P02", "2026-03-07 09:00:00"),
        ].join("\n"),
      ),
    );

    expect(inspection.outOfOrderTimestampCount).toBe(0);
    expect(inspection.firstOutOfOrderRow).toBeNull();
  });

  it("does not flag chronologically ordered timestamps", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 ok.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 10:00:00"),
          row("Unknown importance: 2", "2026-03-07 10:00:00"), // equal is in order
          row("Unknown importance: 1", "2026-03-07 10:05:00"),
        ].join("\n"),
      ),
    );

    expect(inspection.outOfOrderTimestampCount).toBe(0);
    expect(inspection.firstOutOfOrderRow).toBeNull();
  });

  it("flags unrecognized interaction types and points at options that exist", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 unknown.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 10:00:00"),
          row("Custom Vendor Event", "2026-03-07 10:05:00"),
          row("Unknown importance: 99", "2026-03-07 10:06:00"), // newer Android code
        ].join("\n"),
      ),
    );

    expect(inspection.unrecognizedInteractionTypes).toEqual([
      "Custom Vendor Event",
      "Unknown importance: 99",
    ]);
    expect(inspection.warnings.join(" ")).toContain("unrecognized interaction type");
    // Must point only at options that actually exist (no phantom "remapping").
    expect(inspection.warnings.join(" ")).toContain("interaction types to remove");
    expect(inspection.warnings.join(" ")).toContain("end a session");
    expect(inspection.warnings.join(" ")).not.toMatch(/remapping/i);
  });

  it("does not flag canonical interaction-type names as unrecognized", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 canonical.csv",
        [
          HEADER,
          row("Activity Resumed", "2026-03-07 10:00:00"), // a map VALUE
          row("Move to Foreground", "2026-03-07 10:05:00"), // a map KEY
        ].join("\n"),
      ),
    );

    expect(inspection.unrecognizedInteractionTypes).toEqual([]);
  });
});
