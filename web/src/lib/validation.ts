/**
 * Input schema validation for Chronicle Android raw CSV files.
 */

// Columns that must be present in any raw Chronicle Android CSV before
// processing can proceed. Derived/output columns (study_id,
// possible_device_model, start_timestamp, stop_timestamp) are not validated
// here. timezone is also excluded: a missing timezone column is a documented
// fallback and rows default to "UTC".
export const REQUIRED_RAW_CSV_COLUMNS: readonly string[] = [
  "participant_id",
  "username",
  "application_label",
  "interaction_type",
  "app_package_name",
  "event_timestamp",
];

export function validateRawCsvColumns(headers: string[]): void {
  if (headers.length === 0) {
    throw new Error(`Missing required columns: [${REQUIRED_RAW_CSV_COLUMNS.join(", ")}]`);
  }

  const headerSet = new Set(headers);
  const missing = REQUIRED_RAW_CSV_COLUMNS.filter((column) => !headerSet.has(column));

  if (missing.length > 0) {
    throw new Error(`Missing required columns: [${missing.join(", ")}]`);
  }
}

export function validateRawCsvResult(headers: string[], rowCount: number): void {
  validateRawCsvColumns(headers);
  if (rowCount === 0) {
    throw new Error("Input file has headers but no data rows");
  }
}

/**
 * Range check for numeric settings inputs. Returns a short message when the
 * value is outside [min, max] (or not a number), otherwise null. Used to surface
 * a visible error state instead of silently keeping an out-of-range value.
 */
export function rangeError(value: number, min?: number, max?: number): string | null {
  if (Number.isNaN(value)) return "Enter a number";
  if (min !== undefined && value < min) {
    return max !== undefined ? `Enter a value between ${min} and ${max}` : `Must be at least ${min}`;
  }
  if (max !== undefined && value > max) {
    return min !== undefined ? `Enter a value between ${min} and ${max}` : `Must be at most ${max}`;
  }
  return null;
}
