import Papa from "papaparse";

import { ALL_INTERACTION_TYPES_MAP, parseInteractionRemap } from "@/lib/interactionTypes";
import type { BrowserProcessingOptions } from "@/lib/types";

export type RawFileInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
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

const REQUIRED_RAW_COLUMNS = [
  "study_id",
  "participant_id",
  "application_label",
  "interaction_type",
  "app_package_name",
  "event_timestamp",
  "timezone",
];

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

function isValidChronicleTimestamp(value: string): boolean {
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
  const missing = REQUIRED_RAW_COLUMNS.filter((column) => !columnSet.has(column));
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

  // Out-of-order detection, scoped per participant_id. A single raw export can
  // hold several participants concatenated (the pipeline groups by participant
  // downstream), so a single global running max would false-flag every
  // participant boundary. Each participant gets its own running max; within a
  // participant, a timestamp earlier than one already seen signals a
  // sorting/export problem worth surfacing. Note: bare local wall-clock times
  // that legitimately move backward across a travel/DST boundary can still
  // register here — this is a heads-up, not a hard error.
  let outOfOrderTimestampCount = 0;
  let firstOutOfOrderRow: number | null = null;
  const maxSeenMsByParticipant = new Map<string, number>();
  // A plain loop (not forEach) so TS tracks the firstOutOfOrderRow assignment
  // for narrowing at the warning site below.
  for (let index = 0; index < timestampValues.length; index += 1) {
    const value = timestampValues[index];
    if (!value || !isValidChronicleTimestamp(value)) continue;
    const ms = Date.parse(value.replace(" ", "T"));
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

  const warnings: string[] = [];

  if (!file.name.toLowerCase().endsWith(".csv")) {
    warnings.push("File extension is not .csv.");
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
    warnings.push(`Invalid timezone values: ${invalidTimezones.slice(0, 5).join(", ")}`);
  }
  if (missingTimestampCount > 0 && !missing.includes("event_timestamp")) {
    warnings.push(`${missingTimestampCount.toLocaleString()} rows are missing event_timestamp values.`);
  }
  if (invalidTimestampCount > 0) {
    warnings.push(`${invalidTimestampCount.toLocaleString()} rows have invalid event_timestamp values.`);
  }
  if (outOfOrderTimestampCount > 0) {
    warnings.push(
      `${outOfOrderTimestampCount.toLocaleString()} event_timestamp values are out of chronological order` +
        (firstOutOfOrderRow !== null ? ` (first at data row ${firstOutOfOrderRow.toLocaleString()})` : "") +
        ".",
    );
  }
  // The unrecognized-interaction-type warning is produced in effectiveWarnings,
  // which knows the user's custom remap (#4) and can exclude mapped types.
  // Multiple timezones are normal (a participant who travels) and are resolved
  // downstream by the timezone-handling step (convert/filter). Spanning >1 zone
  // is not a data-quality problem, so it must not raise a warning or feed the
  // readiness count. Only missing/invalid zones (handled above) are flagged.
  if (parsed.errors.length) {
    warnings.push(parsed.errors[0]?.message ?? "CSV parse warning.");
  }

  return {
    fileName: file.name,
    sizeBytes: file.size,
    rowCount: countDataRows(text),
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
