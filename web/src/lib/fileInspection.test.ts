import { describe, expect, it } from "vitest";

import { effectiveWarnings, inspectRawFile, inspectRawFiles } from "@/lib/fileInspection";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";

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

  it("computes out-of-order metrics without raising a warning (pipeline re-sorts)", async () => {
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

    // Metric still computed (informational)…
    expect(inspection.outOfOrderTimestampCount).toBe(1);
    expect(inspection.firstOutOfOrderRow).toBe(2);
    // …but it does NOT surface as a warning (the pipeline re-sorts, so it's not actionable).
    expect(inspection.warnings.join(" ")).not.toMatch(/chronological order/i);
    expect(effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS).join(" ")).not.toMatch(
      /chronological order/i,
    );
  });

  it("out-of-order metric compares wall-clock as UTC, ignoring the timezone column (W2)", async () => {
    // Ascending wall-clock with a different tz on the later row (a traveler). The
    // metric parses bare timestamps as UTC and ignores the tz column, so this is
    // in order — and the result is independent of the host browser's timezone.
    const tzRow = (ts: string, tz: string): string =>
      `Study,P09,Target Child,Chat,Unknown importance: 1,com.example.chat,${ts},${tz}`;
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 tz.csv",
        [HEADER, tzRow("2026-03-07 10:00:00", "America/Chicago"), tzRow("2026-03-07 11:00:00", "Asia/Tokyo")].join(
          "\n",
        ),
      ),
    );
    expect(inspection.outOfOrderTimestampCount).toBe(0);
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
    // FU7: a multi-participant file is surfaced (not silently mislabeled) — the
    // pipeline matches sessions without grouping by participant.
    expect(inspection.participantCount).toBe(2);
    expect(inspection.warnings.join(" ")).toMatch(/contains 2 participants/i);
    expect(inspection.warnings.join(" ")).toMatch(/one file per participant/i);
  });

  it("does not warn about participants for a single-participant file", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          HEADER,
          `Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`,
          `Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago`,
        ].join("\n"),
      ),
    );
    expect(inspection.participantCount).toBe(1);
    expect(inspection.warnings.join(" ")).not.toMatch(/participants/i);
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
    // The warning is now produced in effectiveWarnings (it depends on the remap option).
    const warnings = effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS).join(" ");
    expect(warnings).toContain("unrecognized interaction type");
    // Must point only at options that actually exist; uses the UI label "mappings".
    expect(warnings).toContain("interaction types to remove");
    expect(warnings).toContain("end a session");
    expect(warnings).toContain("custom interaction-type mappings");
    expect(warnings).not.toMatch(/remapping/i);
  });

  it("excludes remapped interaction types from the unrecognized warning (#4)", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 remap.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 10:00:00"),
          row("Custom Vendor Event", "2026-03-07 10:05:00"),
          row("Unknown importance: 99", "2026-03-07 10:06:00"),
        ].join("\n"),
      ),
    );

    // Map only one of the two unrecognized types: the other still warns.
    const oneMapped = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      interactionTypeRemap: ["Custom Vendor Event => Activity Resumed"],
    }).join(" ");
    expect(oneMapped).toContain("unrecognized interaction type");
    expect(oneMapped).toContain("Unknown importance: 99");
    expect(oneMapped).not.toContain("Custom Vendor Event");

    // Map both: the unrecognized warning disappears entirely.
    const allMapped = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      interactionTypeRemap: [
        "Custom Vendor Event => Activity Resumed",
        "Unknown importance: 99 => Activity Stopped",
      ],
    }).join(" ");
    expect(allMapped).not.toContain("unrecognized interaction type");
  });

  it("warns about duplicate timestamps only when the correction option is off", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 dup.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 10:00:00"),
          row("Unknown importance: 2", "2026-03-07 10:00:00"), // duplicate timestamp
        ].join("\n"),
      ),
    );
    expect(inspection.duplicateTimestampCount).toBe(1);

    const withoutFix = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      correctDuplicateEventTimestamps: false,
    }).join(" ");
    expect(withoutFix).toContain("appear more than once");

    const withFix = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      correctDuplicateEventTimestamps: true,
    }).join(" ");
    expect(withFix).not.toContain("appear more than once");
  });

  it("warns when the timezone column is present but has no values", async () => {
    const tzBlank = (ts: string): string =>
      `Study,P09,Target Child,Chat,Unknown importance: 1,com.example.chat,${ts},`;
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 no-tz.csv",
        [HEADER, tzBlank("2026-03-07 10:00:00"), tzBlank("2026-03-07 10:05:00")].join("\n"),
      ),
    );
    expect(inspection.timezones).toEqual([]);
    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.warnings.join(" ")).toContain("No timezone values found");
  });

  it("inspects multiple files in one call", async () => {
    const inspections = await inspectRawFiles([
      fileFromText(
        "Raw A.csv",
        [HEADER, `Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`].join("\n"),
      ),
      fileFromText(
        "Raw B.csv",
        [HEADER, `Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`].join("\n"),
      ),
    ]);
    expect(inspections).toHaveLength(2);
    expect(inspections.map((i) => i.fileName)).toEqual(["Raw A.csv", "Raw B.csv"]);
  });

  it("truncates the unrecognized-type sample to five with an ellipsis when more exist", async () => {
    // Six distinct unrecognized types → the sample shows five plus ", …".
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 many-unknown.csv",
        [
          HEADER,
          row("Vendor A", "2026-03-07 10:00:00"),
          row("Vendor B", "2026-03-07 10:01:00"),
          row("Vendor C", "2026-03-07 10:02:00"),
          row("Vendor D", "2026-03-07 10:03:00"),
          row("Vendor E", "2026-03-07 10:04:00"),
          row("Vendor F", "2026-03-07 10:05:00"),
        ].join("\n"),
      ),
    );
    expect(inspection.unrecognizedInteractionTypes).toHaveLength(6);
    const warnings = effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS).join(" ");
    // Sample is capped at five names and ends with the ellipsis continuation.
    expect(warnings).toContain("Vendor A, Vendor B, Vendor C, Vendor D, Vendor E, …");
    expect(warnings).not.toContain("Vendor F,");
  });

  it("ignores an offset-bearing timestamp in the out-of-order metric (append-Z makes it unparseable)", async () => {
    // A timestamp that already carries a UTC offset passes the format check but,
    // once "Z" is appended for the deterministic UTC parse, becomes NaN and is
    // skipped by the out-of-order scan — so it never counts as out of order.
    const offsetRow = (ts: string): string =>
      `Study,P09,Target Child,Chat,Unknown importance: 1,com.example.chat,${ts},America/Chicago`;
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 offset.csv",
        [
          HEADER,
          offsetRow("2026-03-07 12:00:00"),
          offsetRow("2026-03-07T10:00:00+05:00"), // earlier wall-clock, but offset → skipped
        ].join("\n"),
      ),
    );
    // The offset row is valid per the format regex, so it is NOT counted invalid…
    expect(inspection.invalidTimestampCount).toBe(0);
    // …but it is skipped by the out-of-order scan, so no out-of-order is recorded.
    expect(inspection.outOfOrderTimestampCount).toBe(0);
    expect(inspection.firstOutOfOrderRow).toBeNull();
  });

  it("records the FIRST out-of-order row only, even with several out-of-order rows", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 multi-ooo.csv",
        [
          HEADER,
          row("Unknown importance: 1", "2026-03-07 12:00:00"),
          row("Unknown importance: 2", "2026-03-07 09:00:00"), // out of order (row 2)
          row("Unknown importance: 1", "2026-03-07 08:00:00"), // out of order again (row 3)
        ].join("\n"),
      ),
    );
    expect(inspection.outOfOrderTimestampCount).toBe(2);
    // firstOutOfOrderRow is pinned at the first occurrence and not overwritten.
    expect(inspection.firstOutOfOrderRow).toBe(2);
  });

  it("tolerates rows with fewer columns than the header (absent trailing fields)", async () => {
    // Data rows shorter than the header leave later fields absent on the parsed
    // row object; the inspector coalesces every missing field (participant_id,
    // interaction_type, event_timestamp, timezone) to "" rather than throwing.
    // event_timestamp is placed early so the second row can carry a VALID
    // timestamp while still omitting participant_id — exercising the
    // participant lookup inside the out-of-order scan on an absent id.
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw short.csv",
        [
          "study_id,event_timestamp,interaction_type,participant_id,timezone",
          "Study", // everything after study_id absent (no timestamp, tz, id, type)
          "Study,2026-03-07 10:00:00", // valid timestamp; id/type/tz absent
        ].join("\n"),
      ),
    );
    // Absent participant_id on every row → zero distinct participants.
    expect(inspection.participantCount).toBe(0);
    // Row 1 has an absent event_timestamp → counted as missing (row 2 has one).
    expect(inspection.missingTimestampCount).toBe(1);
    // Both rows have an absent timezone → both counted as missing.
    expect(inspection.missingTimezoneCount).toBe(2);
    // Absent interaction_type contributes nothing to the unrecognized set.
    expect(inspection.unrecognizedInteractionTypes).toEqual([]);
    // Row 2's valid timestamp reaches the out-of-order scan with an absent id;
    // with only one datable row nothing is out of order.
    expect(inspection.outOfOrderTimestampCount).toBe(0);
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
