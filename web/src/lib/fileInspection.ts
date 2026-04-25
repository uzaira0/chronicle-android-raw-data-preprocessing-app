import Papa from "papaparse";

export type RawFileInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  columns: string[];
  timezones: string[];
  hasRequiredColumns: boolean;
  warnings: string[];
};

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

export async function inspectRawFile(file: File): Promise<RawFileInspection> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    preview: 250,
    skipEmptyLines: true,
  });
  const columns = parsed.meta.fields ?? [];
  const columnSet = humanColumnSet(columns);
  const missing = REQUIRED_RAW_COLUMNS.filter((column) => !columnSet.has(column));
  const timezones = Array.from(
    new Set(
      parsed.data
        .map((row) => (row.timezone ?? "").trim())
        .filter((timezone) => timezone.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const warnings: string[] = [];

  if (missing.length) {
    warnings.push(`Missing required columns: ${missing.join(", ")}`);
  }
  if (!timezones.length && !missing.includes("timezone")) {
    warnings.push("No timezone values found in the first 250 rows.");
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
    warnings,
  };
}

export async function inspectRawFiles(files: File[]): Promise<RawFileInspection[]> {
  return Promise.all(files.map((file) => inspectRawFile(file)));
}
