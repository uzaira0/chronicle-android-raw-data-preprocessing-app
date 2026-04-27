import Papa from "papaparse";

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
  warnings: string[];
};

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
  if (timezones.length > 1) {
    warnings.push(`${timezones.length} timezone values found.`);
  }
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
    warnings,
  };
}

export async function inspectRawFiles(files: File[]): Promise<RawFileInspection[]> {
  return Promise.all(files.map((file) => inspectRawFile(file)));
}
