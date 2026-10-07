import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  BROWSER_ENGINE_ROW_CEILING,
  effectiveWarnings,
  assertUniqueRawFileNames,
  commitRawFileSelectionAtomically,
  fragmentedParticipantTokensByInputDigest,
  inspectRawFile,
  inspectRawFiles,
  setRawFileInspectorForTesting,
  setRawStudySplitterForTesting,
  splitMixedStudyFiles,
} from "@/lib/fileInspection";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  inspectRustRawFile,
  setRustRuntimeForTesting,
  splitRustRawFileByStudy,
} from "@/lib/rustPipelineRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const wasmInspector = (
  fileName: string,
  sizeBytes: number,
  csvBytes: ArrayBuffer,
) => inspectRustRawFile(new Uint8Array(csvBytes), fileName, sizeBytes);

describe("raw filename identity", () => {
  it.each([
    [new File(["A"], "Raw.csv"), new File(["B"], "Raw.csv")],
    [new File(["A"], "Raw.csv"), new File(["B"], "raw.CSV")],
    [new File(["A"], "Caf\u00e9.csv"), new File(["B"], "Cafe\u0301.csv")],
  ])("rejects filename-key collisions before inspection", (first, second) => {
    expect(() => assertUniqueRawFileNames([first, second])).toThrow(
      "Raw filenames must be unique; rename duplicates before inspection.",
    );
  });

  it("accepts distinct renamed files even when bytes are identical", () => {
    expect(() =>
      assertUniqueRawFileNames([
        new File(["same"], "Raw A.csv"),
        new File(["same"], "Raw B.csv"),
      ]),
    ).not.toThrow();
  });

  it("preserves the prior selection and invokes no downstream inspection for a collision", () => {
    const priorSelection = [new File(["prior"], "Prior.csv")];
    let currentSelection = priorSelection;
    const inspect = vi.fn();
    const preflight = vi.fn();
    const execute = vi.fn();
    expect(() =>
      commitRawFileSelectionAtomically(
        [new File(["A"], "Raw.csv"), new File(["B"], "raw.CSV")],
        () => {
          currentSelection = [];
          inspect();
          preflight();
          execute();
        },
      ),
    ).toThrow(/Raw filenames must be unique/);
    expect(currentSelection).toBe(priorSelection);
    expect(inspect).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

beforeAll(async () => {
  const runtimeBytes = await readFile(
    new URL(
      "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
      import.meta.url,
    ),
  );
  runtimeWasm.initSync({ module: runtimeBytes });
  setRustRuntimeForTesting(runtimeWasm);
  setRawFileInspectorForTesting(wasmInspector);
  setRawStudySplitterForTesting(async (csvBytes) =>
    (await splitRustRawFileByStudy(new Uint8Array(csvBytes))).map(
      ({ studyId, bytes }) => ({ studyId, bytes: bytes.slice().buffer }),
    ),
  );
});

describe("fragmentedParticipantTokensByInputDigest", () => {
  const batchId = `sha256:${"1".repeat(64)}`;
  const tokenA = `sha256:${"a".repeat(64)}`;
  const tokenB = `sha256:${"b".repeat(64)}`;
  const digestA = "1".repeat(64);
  const digestB = "2".repeat(64);
  const inspection = (
    inputSha256: string,
    participantTokens: string[],
    participantPartitionBatchId: string | null = batchId,
  ) =>
    ({
      fileName: `${inputSha256.slice(0, 4)}.csv`,
      sizeBytes: 1,
      inputSha256,
      rowCount: 1,
      participantCount: participantTokens.length,
      participantPartitionBatchId,
      participantTokens,
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      outOfOrderTimestampCount: 0,
      firstOutOfOrderRow: null,
      unrecognizedInteractionTypes: [],
      screenStartEventCount: 0,
      warnings: [],
    }) satisfies import("@/lib/fileInspection").RawFileInspection;

  it("selects overlap across distinct artifact digests only", () => {
    const fragmented = fragmentedParticipantTokensByInputDigest(
      [
        inspection(digestA, [tokenA, tokenB]),
        inspection(digestB, [tokenA]),
        inspection(digestA, [tokenA, tokenB]),
      ],
      batchId,
    );
    expect(fragmented).toEqual(
      new Map([
        [digestA, [tokenA]],
        [digestB, [tokenA]],
      ]),
    );
  });

  it.each([
    [
      "mixed batches",
      [
        inspection(digestA, [tokenA]),
        inspection(digestB, [tokenA], `sha256:${"2".repeat(64)}`),
      ],
    ],
    ["missing batch", [inspection(digestA, [tokenA], null)]],
    ["uppercase token", [inspection(digestA, [`sha256:${"A".repeat(64)}`])]],
    ["duplicate token", [inspection(digestA, [tokenA, tokenA])]],
    ["unsorted token", [inspection(digestA, [tokenB, tokenA])]],
    [
      "participant count without tokens",
      [{ ...inspection(digestA, []), participantCount: 1 }],
    ],
    [
      "inconsistent duplicate artifact",
      [inspection(digestA, [tokenA]), inspection(digestA, [tokenB])],
    ],
  ])("fails closed for %s", (_label, inspections) => {
    expect(() =>
      fragmentedParticipantTokensByInputDigest(inspections, batchId),
    ).toThrow(/re-inspect/i);
  });

  it.each([
    ["a batch id that is not a sha256", "batch-1"],
    ["a batch id with no sha256 prefix", "1".repeat(64)],
  ])("fails closed for %s", (_label, malformed) => {
    expect(() =>
      fragmentedParticipantTokensByInputDigest(
        [inspection(digestA, [tokenA])],
        malformed,
      ),
    ).toThrow(
      "Active raw-file inspection batch identity is malformed; re-inspect the files.",
    );
  });

  it("fails closed for an inspection with no verified input digest", () => {
    expect(() =>
      fragmentedParticipantTokensByInputDigest(
        [{ ...inspection(digestA, [tokenA]), inputSha256: "" }],
        batchId,
      ),
    ).toThrow(
      "Raw-file inspection is missing its verified input digest; re-inspect the files.",
    );
  });

  it("returns no fragmentation when every participant appears in one artifact", () => {
    expect(
      fragmentedParticipantTokensByInputDigest(
        [inspection(digestA, [tokenA]), inspection(digestB, [tokenB])],
        batchId,
      ),
    ).toEqual(new Map());
  });
});

afterEach(() => setRawFileInspectorForTesting(wasmInspector));

function fileFromText(name: string, text: string): File {
  return new File([text], name, { type: "text/csv" });
}

describe("fileInspection", () => {
  it("uses singular and sampled plural wording for unrecognized interaction types", () => {
    const inspection = {
      fileName: "Raw.csv",
      sizeBytes: 1,
      rowCount: 1,
      participantCount: 1,
      participantPartitionBatchId: null,
      participantTokens: [],
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      outOfOrderTimestampCount: 0,
      firstOutOfOrderRow: null,
      warnings: [],
      unrecognizedInteractionTypes: ["Vendor Event"],
      screenStartEventCount: 0,
    };
    expect(effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS)[0]).toMatch(
      /^1 unrecognized interaction type:/,
    );
    expect(
      effectiveWarnings(
        {
          ...inspection,
          unrecognizedInteractionTypes: ["A", "B", "C", "D", "E", "F"],
        },
        DEFAULT_BROWSER_OPTIONS,
      )[0],
    ).toContain("A, B, C, D, E, …");

    setRawFileInspectorForTesting(null);
    setRawFileInspectorForTesting(wasmInspector);
  });

  it("warns when a file's row count exceeds the browser engine ceiling", () => {
    const base = {
      fileName: "Raw.csv",
      sizeBytes: 1,
      rowCount: BROWSER_ENGINE_ROW_CEILING,
      participantCount: 1,
      participantPartitionBatchId: null,
      participantTokens: [],
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      outOfOrderTimestampCount: 0,
      firstOutOfOrderRow: null,
      unrecognizedInteractionTypes: [],
      screenStartEventCount: 1,
      warnings: [],
    };
    expect(effectiveWarnings(base, DEFAULT_BROWSER_OPTIONS)).toEqual([]);
    const oversized = effectiveWarnings(
      { ...base, rowCount: BROWSER_ENGINE_ROW_CEILING + 1 },
      DEFAULT_BROWSER_OPTIONS,
    );
    expect(oversized).toHaveLength(1);
    expect(oversized[0]).toMatch(/^This file has 950,001 rows\./);
    expect(oversized[0]).toMatch(/Split the export/);
  });

  it("warns about a file with no screen events only when screen usage is on", async () => {
    // The report that motivated this: "Zero screen usage rows … contains zero
    // data rows" on a raw file that had plenty of app rows. The upload
    // inspection now says why before the run.
    const noScreen = await inspectRawFile(
      fileFromText(
        "Raw P03.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P03,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago",
          "Study,P03,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(noScreen.screenStartEventCount).toBe(0);
    expect(noScreen.warnings).toEqual([]);
    const screenOn = { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true };
    expect(effectiveWarnings(noScreen, screenOn)).toEqual([
      expect.stringMatching(/^No screen events\./),
    ]);
    expect(
      effectiveWarnings(noScreen, { ...screenOn, processScreenUsage: false }),
    ).toEqual([]);
    // An empty file already has its own warning; no double report.
    expect(
      effectiveWarnings({ ...noScreen, rowCount: 0 }, screenOn).join(" "),
    ).not.toMatch(/No screen events/);
    // A custom mapping can make another raw type a screen start at run time;
    // inspection cannot see it, so it must not claim the output will be empty.
    expect(
      effectiveWarnings(noScreen, {
        ...screenOn,
        interactionTypeRemap: ["Vendor Screen On => Screen Interactive"],
      }),
    ).toEqual([]);

    const withScreen = await inspectRawFile(
      fileFromText(
        "Raw P04.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P04,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,America/Chicago",
          "Study,P04,Target Child,System,Unknown importance: 16,android,2026-03-07 10:05:00,America/Chicago",
        ].join("\n"),
      ),
    );
    expect(withScreen.screenStartEventCount).toBe(1);
    expect(effectiveWarnings(withScreen, screenOn)).toEqual([]);
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
    expect(inspection.timezones).toEqual([
      "America/Chicago",
      "America/New_York",
    ]);
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
    expect(inspection.warnings.join(" ")).toContain(
      "File extension is not .csv",
    );
    expect(inspection.warnings.join(" ")).toContain(
      "Duplicate column headers found",
    );
    expect(inspection.warnings.join(" ")).toContain("Invalid timezone values");
    // PHI safety: the warning reports a count only — the raw cell value must
    // never appear in UI-surfaced text.
    expect(inspection.warnings.join(" ")).not.toContain("Not/AZone");
    expect(inspection.warnings.join(" ")).toContain(
      "rows have invalid event_timestamp values",
    );
  });

  it("reports missing required columns and empty files", async () => {
    const inspection = await inspectRawFile(fileFromText("empty.csv", ""));

    expect(inspection.hasRequiredColumns).toBe(false);
    expect(inspection.rowCount).toBe(0);
    expect(inspection.warnings.join(" ")).toContain("File is empty");
    expect(inspection.warnings.join(" ")).toContain("Missing required columns");
  });

  const HEADER =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
  const row = (interaction: string, ts: string): string =>
    `Study,P09,Target Child,Chat,${interaction},com.example.chat,${ts},America/Chicago`;

  it("treats a missing timezone column as UTC fallback input", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp",
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00",
        ].join("\n"),
      ),
    );

    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.timezones).toEqual(["UTC"]);
    expect(inspection.warnings).not.toContain("No timezone values found.");
    expect(inspection.warnings.join(" ")).not.toContain(
      "missing timezone values",
    );
    expect(inspection.warnings.join(" ")).not.toContain(
      "Missing required columns",
    );
  });

  it("uses UTC fallback metadata for blank and None timezone values", async () => {
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P01.csv",
        [
          HEADER,
          "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,",
          "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:05:00,None",
        ].join("\n"),
      ),
    );

    expect(inspection.timezones).toEqual(["UTC"]);
    expect(inspection.missingTimezoneCount).toBe(2);
    expect(inspection.warnings).not.toContain("No timezone values found.");
    expect(inspection.warnings.join(" ")).not.toContain(
      "missing timezone values",
    );
    expect(
      inspection.warnings.some((warning) =>
        warning.includes("unrecognised timezone value"),
      ),
    ).toBe(false);
  });

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
    expect(
      effectiveWarnings(inspection, DEFAULT_BROWSER_OPTIONS).join(" "),
    ).not.toMatch(/chronological order/i);
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
        [
          HEADER,
          tzRow("2026-03-07 10:00:00", "America/Chicago"),
          tzRow("2026-03-07 11:00:00", "Asia/Tokyo"),
        ].join("\n"),
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
    // FU7: a multi-participant file is surfaced (not silently mislabeled).
    // Matching is participant-scoped, so the risk the warning names is a single
    // participant's stream being SPLIT across uploads, not two participants
    // sharing one file. The wording is owned by Rust
    // (`chronicle_preprocessing_runtime_wasm/src/lib.rs`), which asserts the
    // same prefix; keep these two in step.
    expect(inspection.participantCount).toBe(2);
    expect(inspection.warnings.join(" ")).toMatch(/contains 2 participants/i);
    expect(inspection.warnings.join(" ")).toMatch(
      /participant stream is not split across multiple uploaded files/i,
    );
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
    // The warning is produced in effectiveWarnings from the Rust inspection result.
    const warnings = effectiveWarnings(
      inspection,
      DEFAULT_BROWSER_OPTIONS,
    ).join(" ");
    expect(warnings).toContain("unrecognized interaction type");
    // Must point only at options that actually exist; uses the UI label "mappings".
    expect(warnings).toContain("interaction types to remove");
    expect(warnings).toContain("end a session");
    expect(warnings).toContain("custom interaction-type mappings");
    expect(warnings).not.toMatch(/remapping/i);
  });

  it("does not reinterpret Rust interaction warnings in TypeScript", async () => {
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

    // A remap may change execution in Rust, but the browser must not suppress
    // Rust's preflight result using a second TypeScript parser.
    const oneMapped = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      interactionTypeRemap: ["Custom Vendor Event => Activity Resumed"],
    }).join(" ");
    expect(oneMapped).toContain("unrecognized interaction type");
    expect(oneMapped).toContain("Unknown importance: 99");
    expect(oneMapped).toContain("Custom Vendor Event");

    const allMapped = effectiveWarnings(inspection, {
      ...DEFAULT_BROWSER_OPTIONS,
      interactionTypeRemap: [
        "Custom Vendor Event => Activity Resumed",
        "Unknown importance: 99 => Activity Stopped",
      ],
    }).join(" ");
    expect(allMapped).toContain("unrecognized interaction type");
    expect(allMapped).toContain("Custom Vendor Event");
    expect(allMapped).toContain("Unknown importance: 99");
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

  it("reports UTC fallback when the timezone column is present but has no values", async () => {
    const tzBlank = (ts: string): string =>
      `Study,P09,Target Child,Chat,Unknown importance: 1,com.example.chat,${ts},`;
    const inspection = await inspectRawFile(
      fileFromText(
        "Raw P09 no-tz.csv",
        [
          HEADER,
          tzBlank("2026-03-07 10:00:00"),
          tzBlank("2026-03-07 10:05:00"),
        ].join("\n"),
      ),
    );
    expect(inspection.timezones).toEqual(["UTC"]);
    expect(inspection.missingTimezoneCount).toBe(2);
    expect(inspection.hasRequiredColumns).toBe(true);
    expect(inspection.warnings.join(" ")).not.toContain("timezone");
  });

  it("inspects multiple files in one call", async () => {
    const inspections = await inspectRawFiles([
      fileFromText(
        "Raw A.csv",
        [
          HEADER,
          `Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`,
        ].join("\n"),
      ),
      fileFromText(
        "Raw B.csv",
        [
          HEADER,
          `Study,P02,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`,
        ].join("\n"),
      ),
    ]);
    expect(inspections).toHaveLength(2);
    expect(inspections.map((i) => i.fileName)).toEqual([
      "Raw A.csv",
      "Raw B.csv",
    ]);
  });

  it("parses exact duplicate content once while preserving both file labels", async () => {
    const inspector = vi.fn(wasmInspector);
    setRawFileInspectorForTesting(inspector);
    const text = [
      HEADER,
      `Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,America/Chicago`,
    ].join("\n");
    const inspections = await inspectRawFiles([
      fileFromText("Raw A.csv", text),
      fileFromText("Raw B.csv", text),
    ]);
    expect(inspector).toHaveBeenCalledTimes(1);
    expect(inspections.map(({ fileName }) => fileName)).toEqual([
      "Raw A.csv",
      "Raw B.csv",
    ]);
    expect(inspections[0]?.inputSha256).toBe(inspections[1]?.inputSha256);
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
    const warnings = effectiveWarnings(
      inspection,
      DEFAULT_BROWSER_OPTIONS,
    ).join(" ");
    // Sample is capped at five names and ends with the ellipsis continuation.
    expect(warnings).toContain(
      "Vendor A, Vendor B, Vendor C, Vendor D, Vendor E, …",
    );
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

/**
 * `createRawFileInspectionBatch` and `disposeRawFileInspectionBatch` own the
 * 32-byte ephemeral batch secret: it reaches
 * `beginRawInspectionBatch` in `src/lib/rustWorkerClient.ts` once and is zeroed
 * on every exit, successful or not.
 */
describe("raw file inspection batch secret", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/rustWorkerClient");
    vi.resetModules();
  });

  async function loadWith(client: Record<string, unknown>) {
    vi.doMock("@/lib/rustWorkerClient", () => ({
      inspectRawCsvBytes: vi.fn(),
      splitRawCsvByStudy: vi.fn(),
      ...client,
    }));
    vi.resetModules();
    return import("@/lib/fileInspection");
  }

  it("mints one 32-byte secret and returns the kernel's batch id", async () => {
    let handed: Uint8Array | undefined;
    const module = await loadWith({
      beginRawInspectionBatch: (buffer: ArrayBuffer) => {
        handed = new Uint8Array(buffer).slice();
        return Promise.resolve(`sha256:${"1".repeat(64)}`);
      },
      disposeRawInspectionBatch: vi.fn(),
    });
    const batch = await module.createRawFileInspectionBatch();
    expect(batch.participantPartitionBatchId).toBe(`sha256:${"1".repeat(64)}`);
    expect(batch.secret).toHaveLength(32);
    expect(handed).toEqual(batch.secret);
  });

  it("zeroes the secret when the kernel refuses to open a batch", async () => {
    const module = await loadWith({
      beginRawInspectionBatch: () => Promise.reject(new Error("no batch boundary")),
      disposeRawInspectionBatch: vi.fn(),
    });
    await expect(module.createRawFileInspectionBatch()).rejects.toThrow(
      "no batch boundary",
    );
  });

  it("zeroes the secret after disposing the batch", async () => {
    const dispose = vi.fn().mockResolvedValue(true);
    const module = await loadWith({
      beginRawInspectionBatch: () => Promise.resolve(`sha256:${"1".repeat(64)}`),
      disposeRawInspectionBatch: dispose,
    });
    const batch = await module.createRawFileInspectionBatch();
    batch.secret.fill(7);
    await module.disposeRawFileInspectionBatch(batch);
    expect(dispose).toHaveBeenCalledWith(`sha256:${"1".repeat(64)}`);
    expect([...batch.secret].every((byte) => byte === 0)).toBe(true);
  });

  it("zeroes the secret even when disposal fails", async () => {
    const module = await loadWith({
      beginRawInspectionBatch: () => Promise.resolve(`sha256:${"1".repeat(64)}`),
      disposeRawInspectionBatch: () => Promise.reject(new Error("batch is gone")),
    });
    const batch = await module.createRawFileInspectionBatch();
    batch.secret.fill(7);
    await expect(module.disposeRawFileInspectionBatch(batch)).rejects.toThrow(
      "batch is gone",
    );
    expect([...batch.secret].every((byte) => byte === 0)).toBe(true);
  });
});

describe("releaseRawFileInspectionBatch", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/rustWorkerClient");
    vi.resetModules();
  });

  it("keeps a failed release in the diagnostic log instead of dropping it", async () => {
    vi.doMock("@/lib/rustWorkerClient", () => ({
      inspectRawCsvBytes: vi.fn(),
      splitRawCsvByStudy: vi.fn(),
      beginRawInspectionBatch: () => Promise.resolve(`sha256:${"1".repeat(64)}`),
      disposeRawInspectionBatch: () => Promise.reject(new Error("batch partitions are locked")),
    }));
    vi.resetModules();
    const module = await import("@/lib/fileInspection");
    const diagnostics = await import("@/lib/diagnostics");
    diagnostics.resetRecordedErrors();
    const batch = await module.createRawFileInspectionBatch();

    await expect(module.releaseRawFileInspectionBatch(batch)).resolves.toBeUndefined();

    const recorded = diagnostics.recentErrors();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      source: "background",
      context: "raw file inspection batch cleanup",
    });
    expect(recorded[0]!.message).toContain("batch partitions are locked");
    expect([...batch.secret].every((byte) => byte === 0)).toBe(true);
  });
});

describe("splitMixedStudyFiles", () => {
  const header =
    "study_id,participant_id,interaction_type,app_package_name,event_timestamp,timezone\n";

  it("replaces a mixed-study file with one file per study, all rows kept", async () => {
    const mixed = new File(
      [
        header,
        "TECH,P01,Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n",
        "GNSM,P01,Activity Paused,pkg,2026-03-07 10:05:00,UTC\n",
        "TECH,P02,Activity Paused,pkg,2026-03-07 10:06:00,UTC\n",
      ],
      "export.csv",
      { type: "text/csv" },
    );
    const single = new File(
      [header, "TECH,P09,Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n"],
      "single.csv",
    );
    const split = await splitMixedStudyFiles([mixed, single]);
    expect(split.map((file) => file.name)).toEqual([
      "export [study GNSM].csv",
      "export [study TECH].csv",
      "single.csv",
    ]);
    expect(split[2]).toBe(single);
    expect(await split[0]!.text()).toBe(
      header + "GNSM,P01,Activity Paused,pkg,2026-03-07 10:05:00,UTC\n",
    );
    expect(await split[1]!.text()).toBe(
      header +
        "TECH,P01,Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n" +
        "TECH,P02,Activity Paused,pkg,2026-03-07 10:06:00,UTC\n",
    );
    const alreadySplit = await splitMixedStudyFiles(split, new Set(split));
    expect(alreadySplit).toEqual(split);
  });

  it("numbers study files whose sanitized names would collide", async () => {
    const mixed = new File(
      [
        header,
        "A/B,P01,Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n",
        "A:B,P02,Activity Resumed,pkg,2026-03-07 10:01:00,UTC\n",
      ],
      "export.csv",
    );
    // Already listed under the name the first study would take.
    const listed = new File([header], "Export [study A_B].csv");
    const split = await splitMixedStudyFiles([listed, mixed], new Set([listed]));
    expect(split.map((file) => file.name)).toEqual([
      "Export [study A_B].csv",
      "export [study A_B 2].csv",
      "export [study A_B 3].csv",
    ]);
    expect(split[0]).toBe(listed);
    const texts = await Promise.all(split.slice(1).map((file) => file.text()));
    expect(texts.sort()).toEqual([
      header + "A/B,P01,Activity Resumed,pkg,2026-03-07 10:00:00,UTC\n",
      header + "A:B,P02,Activity Resumed,pkg,2026-03-07 10:01:00,UTC\n",
    ]);
  });

  it("keeps a file whole when the study split refuses it", async () => {
    const refused = new File([header, "not,a,valid\n"], "broken.csv");
    setRawStudySplitterForTesting(() =>
      Promise.reject(new Error("raw file is not a Chronicle export")),
    );
    try {
      const split = await splitMixedStudyFiles([refused]);
      expect(split).toHaveLength(1);
      expect(split[0]).toBe(refused);
    } finally {
      setRawStudySplitterForTesting(async (csvBytes) =>
        (await splitRustRawFileByStudy(new Uint8Array(csvBytes))).map(
          ({ studyId, bytes }) => ({ studyId, bytes: bytes.slice().buffer }),
        ),
      );
    }
  });
});
