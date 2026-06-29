import Papa from "papaparse";

import { ALL_INTERACTION_TYPES_MAP, parseInteractionRemap } from "@/lib/interactionTypes";
import type { BrowserProcessingOptions } from "@/lib/types";
import { REQUIRED_RAW_CSV_COLUMNS } from "@/lib/validation";

export type RawFileInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  /** Distinct participant_id values. >1 means multiple participants are
   * concatenated in one file, which the per-file pipeline doesn't group by. */
  participantCount: number;
  columns: string[];
  timezones: string[];
  hasRequiredColumns: boolean;
  invalidTimestampCount: number;
  missingTimestampCount: number;
  missingTimezoneCount: number;
  duplicateTimestampCount: number;
  /** Rows whose event_timestamp is earlier than a preceding row for the same participant. */
  outOfOrderTimestampCount: number;
  /** 1-based data-row ordinal of the first out-of-order timestamp, if any. */
  firstOutOfOrderRow: number | null;
  /** Distinct interaction_type values not recognized by the pipeline's map. */
  unrecognizedInteractionTypes: string[];
  warnings: string[];
};

/**
 * Raw interaction-type strings the pipeline understands: both the raw input
 * keys (e.g. "Unknown importance: 23") and their canonical names (e.g.
 * "Activity Stopped"). Anything outside this set is vendor-specific / unknown.
 */
const RECOGNIZED_INTERACTION_TYPES = new Set<string>([
  ...Object.keys(ALL_INTERACTION_TYPES_MAP),
  ...Object.values(ALL_INTERACTION_TYPES_MAP),
]);

export function effectiveWarnings(
  inspection: RawFileInspection,
  options: BrowserProcessingOptions,
): string[] {
  const warnings = [...inspection.warnings];
  if (
    inspection.duplicateTimestampCount > 0 &&
    !options.correctDuplicateEventTimestamps
  ) {
    warnings.push(
      `${inspection.duplicateTimestampCount.toLocaleString()} event timestamps appear more than once.`,
    );
  }
  // Interaction types the built-in map doesn't recognize, minus any the user
  // has remapped to a canonical name (#4). Computed here (not in inspectRawFile)
  // because whether a type is "unrecognized" depends on the remap option.
  const remapped = parseInteractionRemap(options.interactionTypeRemap);
  const stillUnrecognized = inspection.unrecognizedInteractionTypes.filter(
    (type) => !remapped.has(type),
  );
  if (stillUnrecognized.length) {
    const sample = stillUnrecognized.slice(0, 5).join(", ");
    const more = stillUnrecognized.length > 5 ? ", …" : "";
    warnings.push(
      `${stillUnrecognized.length.toLocaleString()} unrecognized interaction type` +
        `${stillUnrecognized.length === 1 ? "" : "s"}: ${sample}${more}. ` +
        "They're kept in the output but won't start or end app-usage sessions. " +
        "Map a vendor-specific type to a canonical one under custom interaction-type mappings; " +
        "to make one end sessions add it under the interaction types that end a session; " +
        "to drop it add it under interaction types to remove (all in Interaction semantics).",
    );
  }
  return warnings;
}

function humanColumnSet(columns: string[]): Set<string> {
  return new Set(columns.map((column) => column.trim()));
}

function countDataRows(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(0, trimmed.split(/\r\n|\n|\r/).length - 1);
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidChronicleTimestamp(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) {
    return true;
  }
  return !Number.isNaN(Date.parse(text.replace(" ", "T")));
}

export async function inspectRawFile(file: File): Promise<RawFileInspection> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const columns = parsed.meta.fields ?? [];
  const renamedHeaders = (
    parsed.meta as typeof parsed.meta & { renamedHeaders?: Record<string, string> }
  ).renamedHeaders;
  const columnSet = humanColumnSet(columns);
  const missing = REQUIRED_RAW_CSV_COLUMNS.filter((column) => !columnSet.has(column));
  const timezoneValues = parsed.data.map((row) => (row.timezone ?? "").trim());
  const timezones = Array.from(new Set(timezoneValues.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
  const invalidTimezones = timezones.filter((timezone) => !isValidTimezone(timezone));
  const timestampValues = parsed.data.map((row) => (row.event_timestamp ?? "").trim());
  const missingTimestampCount = timestampValues.filter((value) => !value).length;
  const invalidTimestampCount = timestampValues.filter((value) => value && !isValidChronicleTimestamp(value)).length;
  const missingTimezoneCount = timezoneValues.filter((value) => !value).length;
  const timestampCounts = new Map<string, number>();
  timestampValues.filter(Boolean).forEach((value) => {
    timestampCounts.set(value, (timestampCounts.get(value) ?? 0) + 1);
  });
  const duplicateTimestampCount = Array.from(timestampCounts.values()).filter((count) => count > 1).length;

  // Out-of-order detection, scoped per participant_id, kept as an INFORMATIONAL
  // metric only — the pipeline re-sorts every row by event_timestamp before
  // processing, so input order never affects output and this is not raised as a
  // warning (see below). A single raw export can hold several participants
  // concatenated, so each participant gets its own running max (a global one would
  // false-flag every participant boundary). Timestamps are compared as UTC
  // wall-clock (the pipeline's offsetless-as-UTC sort basis), so the count is
  // independent of the host browser's timezone.
  let outOfOrderTimestampCount = 0;
  let firstOutOfOrderRow: number | null = null;
  const maxSeenMsByParticipant = new Map<string, number>();
  for (let index = 0; index < timestampValues.length; index += 1) {
    const value = timestampValues[index];
    if (!value || !isValidChronicleTimestamp(value)) continue;
    // Append "Z" so a bare wall-clock parses as UTC (deterministic across hosts),
    // matching the pipeline's sort basis instead of the browser's local timezone.
    const ms = Date.parse(`${value.replace(" ", "T")}Z`);
    if (Number.isNaN(ms)) continue;
    const participant = (parsed.data[index]?.participant_id ?? "").trim();
    const maxSeenMs = maxSeenMsByParticipant.get(participant) ?? Number.NEGATIVE_INFINITY;
    if (ms < maxSeenMs) {
      outOfOrderTimestampCount += 1;
      if (firstOutOfOrderRow === null) firstOutOfOrderRow = index + 1;
    } else {
      maxSeenMsByParticipant.set(participant, ms);
    }
  }

  // Interaction types the pipeline doesn't recognize (vendor-specific exports,
  // newer Android event codes). They're passed through unchanged and won't
  // start or end app-usage sessions — point the user at the interaction-
  // semantics options that actually exist (stop-type lists / remove list).
  const unrecognizedInteractionTypes = columnSet.has("interaction_type")
    ? Array.from(
        new Set(
          parsed.data
            .map((row) => (row.interaction_type ?? "").trim())
            .filter((value) => value && !RECOGNIZED_INTERACTION_TYPES.has(value)),
        ),
      ).sort((left, right) => left.localeCompare(right))
    : [];

  const participantCount = new Set(
    parsed.data.map((row) => (row.participant_id ?? "").trim()).filter(Boolean),
  ).size;

  const warnings: string[] = [];

  if (!file.name.toLowerCase().endsWith(".csv")) {
    warnings.push("File extension is not .csv.");
  }
  if (participantCount > 1) {
    warnings.push(
      `This file contains ${participantCount.toLocaleString()} participants. The preprocessor treats each file as a single participant and does not group app-usage session matching by participant_id, so a multi-participant file can mis-match or mis-label sessions (especially with concurrent-usage or background-apps modeling). Split the export into one file per participant.`,
    );
  }
  if (file.size === 0 || !text.trim()) {
    warnings.push("File is empty.");
  }
  if (missing.length) {
    warnings.push(`Missing required columns: ${missing.join(", ")}`);
  }
  if (columns.length !== new Set(columns).size || (renamedHeaders && Object.keys(renamedHeaders).length > 0)) {
    warnings.push("Duplicate column headers found.");
  }
  if (!timezones.length && !missing.includes("timezone")) {
    warnings.push("No timezone values found.");
  }
  if (missingTimezoneCount > 0 && !missing.includes("timezone")) {
    warnings.push(`${missingTimezoneCount.toLocaleString()} rows are missing timezone values.`);
  }
  if (invalidTimezones.length) {
    warnings.push(`${invalidTimezones.length} unrecognised timezone value${invalidTimezones.length === 1 ? "" : "s"} found.`);
  }
  if (missingTimestampCount > 0 && !missing.includes("event_timestamp")) {
    warnings.push(`${missingTimestampCount.toLocaleString()} rows are missing event_timestamp values.`);
  }
  if (invalidTimestampCount > 0) {
    warnings.push(`${invalidTimestampCount.toLocaleString()} rows have invalid event_timestamp values.`);
  }
  // Out-of-order event_timestamp is intentionally NOT warned: the pipeline
  // re-sorts every row by event_timestamp before processing, so unsorted input
  // produces identical output. Flagging it would inflate the advisory warning
  // count and flip a Ready file to "Review" with no action the user can take.
  // outOfOrderTimestampCount / firstOutOfOrderRow remain as informational metrics.
  // The unrecognized-interaction-type warning is produced in effectiveWarnings,
  // which knows the user's custom remap (#4) and can exclude mapped types.
  // Multiple timezones are normal (a participant who travels) and are resolved
  // downstream by the timezone-handling step (convert/filter). Spanning >1 zone
  // is not a data-quality problem, so it must not raise a warning or feed the
  // readiness count. Only missing/invalid zones (handled above) are flagged.
  if (parsed.errors.length) {
    const e = parsed.errors[0];
    warnings.push(`CSV parse warning (${e?.type ?? "unknown"}/${e?.code ?? "unknown"}).`);
  }

  return {
    fileName: file.name,
    sizeBytes: file.size,
    rowCount: countDataRows(text),
    participantCount,
    columns,
    timezones,
    hasRequiredColumns: missing.length === 0,
    invalidTimestampCount,
    missingTimestampCount,
    missingTimezoneCount,
    duplicateTimestampCount,
    outOfOrderTimestampCount,
    firstOutOfOrderRow,
    unrecognizedInteractionTypes,
    warnings,
  };
}

export async function inspectRawFiles(files: File[]): Promise<RawFileInspection[]> {
  return Promise.all(files.map((file) => inspectRawFile(file)));
}
