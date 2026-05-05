/**
 * Input schema validation for Chronicle Android raw CSV files.
 */

// Columns that must be present in any raw Chronicle Android CSV before
// processing can proceed.  Derived/output columns (study_id,
// possible_device_model, start_timestamp, stop_timestamp) are NOT validated
// here.  timezone is also excluded: a missing timezone column is a documented
// fallback — rows default to "UTC".
export const REQUIRED_RAW_CSV_COLUMNS: readonly string[] = [
  "participant_id",
  "username",
  "application_label",
  "interaction_type",
  "app_package_name",
  "event_timestamp",
];

/**
 * Validates that a Chronicle Android raw CSV has all required column headers.
 * Throws an Error with an actionable message if validation fails.
 *
 * @param headers - The column header names parsed from the CSV (case-sensitive).
 * @throws {Error} If required columns are missing or if there are no data rows
 *   (the latter is checked by the caller after PapaParse, not here — this
 *   function only validates the header set).
 */
export function validateRawCsvColumns(headers: string[]): void {
  if (headers.length === 0) {
    throw new Error(
      `Missing required columns: [${REQUIRED_RAW_CSV_COLUMNS.join(", ")}]. Found: []`,
    );
  }

  const headerSet = new Set(headers);
  const missing = REQUIRED_RAW_CSV_COLUMNS.filter((col) => !headerSet.has(col));

  if (missing.length > 0) {
    throw new Error(
      `Missing required columns: [${missing.join(", ")}]. Found: [${headers.join(", ")}]`,
    );
  }
}

/**
 * Validates that a parsed Chronicle CSV result has both valid headers and at
 * least one data row.  Call this after PapaParse with `header: true`.
 *
 * @param headers - Column header names from `parsed.meta.fields`.
 * @param rowCount - Number of data rows (i.e. `parsed.data.length`).
 */
export function validateRawCsvResult(headers: string[], rowCount: number): void {
  validateRawCsvColumns(headers);
  if (rowCount === 0) {
    throw new Error("Input file has headers but no data rows");
  }
}
