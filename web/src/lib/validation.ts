/**
 * Input schema validation for Chronicle Android raw CSV files.
 */

/**
 * Rust owns the required-raw-column list (`ADVISORY_RAW_COLUMNS` in
 * `chronicle_preprocessing_runtime_wasm`), decides `has_required_columns`
 * during file inspection, and names the absent columns in an inspection
 * warning. TypeScript must not keep a second list: the one that used to live
 * here disagreed with Rust in both directions (it required `username`, which
 * Rust does not; it omitted `study_id`, which Rust does), and it was never
 * called, so nothing surfaced the disagreement.
 *
 * A raw file whose header is missing one of those columns is not a cosmetic
 * problem. The kernel's row reader resolves each column by name and substitutes
 * an empty string for one it cannot find (`pipeline_v2_incremental.rs`), so the
 * run completes and reports success over rows whose package, label, interaction
 * type, or timestamp is blank. Nothing downstream refuses it. The run therefore
 * has to be blocked before it starts.
 *
 * This prefix is the projection seam, not a second authority: it only recovers
 * the column names Rust already put in the warning so the block can name them.
 */
const MISSING_RAW_COLUMNS_WARNING_PREFIX = "Missing required columns: ";

export type RawColumnViolation = {
  fileName: string;
  /** Empty when the inspection warning did not carry the column names. */
  missingColumns: string[];
};

type InspectedRawFile = {
  fileName: string;
  hasRequiredColumns: boolean;
  warnings: string[];
};

/**
 * Every inspected raw file Rust reported as missing a required column, with the
 * column names recovered from Rust's own warning text.
 */
export function collectRawColumnViolations(
  inspections: readonly InspectedRawFile[],
): RawColumnViolation[] {
  const violations: RawColumnViolation[] = [];
  for (const inspection of inspections) {
    if (inspection.hasRequiredColumns) continue;
    const warning = inspection.warnings.find((text) =>
      text.startsWith(MISSING_RAW_COLUMNS_WARNING_PREFIX),
    );
    const missingColumns = warning
      ? warning
          .slice(MISSING_RAW_COLUMNS_WARNING_PREFIX.length)
          .split(",")
          .map((column) => column.trim())
          .filter((column) => column.length > 0)
      : [];
    violations.push({ fileName: inspection.fileName, missingColumns });
  }
  return violations;
}

/**
 * The same violations with their filenames put through demo masking.
 *
 * Both surfaces that show this block (the Process panel and the pre-dispatch
 * refusal in `processUploadedFiles`) must mask: demo mode masks filenames
 * everywhere else they appear, and a blocking message must not be the one
 * place a real participant filename leaks onto a shared screen.
 */
export function maskRawColumnViolations(
  violations: readonly RawColumnViolation[],
  maskFileName: (fileName: string) => string,
): RawColumnViolation[] {
  return violations.map((violation) => ({
    ...violation,
    fileName: maskFileName(violation.fileName),
  }));
}

/** The single sentence shown on the Process gate and thrown before dispatch. */
export function rawColumnViolationMessage(
  violations: readonly RawColumnViolation[],
): string {
  return `Cannot process: ${violations
    .map(({ fileName, missingColumns }) =>
      missingColumns.length
        ? `${fileName} is missing required column${
            missingColumns.length === 1 ? "" : "s"
          } ${missingColumns.join(", ")}`
        : `${fileName} is missing required columns`,
    )
    .join("; ")}. Rows in these files would be processed with those fields blank.`;
}

/**
 * Range check for numeric settings inputs. Returns a short message when the
 * value is outside [min, max] (or not a number), otherwise null. Used to surface
 * a visible error state instead of silently keeping an out-of-range value.
 */
function integerRangeError(value: number, min: number, max: number): string | null {
  const range = rangeError(value, min, max);
  if (range) return range;
  // A fraction here is not a harmless nicety: the option is declared an
  // integer in the contract, so the sanitizer rounds it on the next reload and
  // the settings panel would then disagree with the receipt of the run that
  // used it. Say so while the value is still the user's to change.
  if (!Number.isInteger(value)) return "Enter a whole number of seconds";
  return null;
}

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

/**
 * The numeric bounds every settings input is checked against, in one place.
 *
 * These used to live only as literal arguments to `rangeError` inside each
 * settings card, where they could report a violation but could not stop a run:
 * the Process button had no validation term, so an emptied box (`Number("")` is
 * `0`) reached the kernel verbatim. A zero-hour maximum-session threshold, for
 * instance, makes every session End-of-Usage-Missing while the batch reports
 * success. The cards and the run gate now read the same table, so a bound
 * cannot be enforced in one place and not the other.
 *
 * `integer: true` mirrors the contract's integer-typed options, which the
 * sanitizer would otherwise silently round on the next reload.
 *
 * Every surface that can start work reads this table: the settings cards, the
 * Process button, the pre-dispatch check in `processUploadedFiles`, and the
 * Arm-B comparison drawer with its own `runComparison` gate. A bound cannot be
 * enforced on one of them and not the others.
 */
export const OPTION_NUMERIC_RANGES = {
  // 1,000,000 h is how a study switches the cap off (TECH/GNSM: the §14 credit truncates instead).
  longDurationThresholdHours: { min: 1, max: 1_000_000 },
  customAppEngagementDuration: { min: 1, max: 3600 },
  proximityIntervalSeconds: { min: 0, max: 3600 },
  minimumUsageDuration: { min: 0, max: 3600, integer: true },
  screenUsageAutoLockTimeoutSeconds: { min: 1, max: 3600 },
  screenUsageAutoLockToleranceSeconds: { min: 0, max: 600 },
  screenUsageManualLockMaxTailGapSeconds: { min: 0, max: 600 },
  screenUsageKeyguardNearStopSeconds: { min: 0, max: 60 },
  screenSessionMaximumDurationMinutes: { min: 0, max: 1440 },
  creditedSessionCapMinutes: { min: 1, max: 1440 },
  deviceLivenessGapToleranceMinutes: { min: 1, max: 1440 },
  autoLockBridgeSeconds: { min: 0, max: 3600 },
  noWitnessMinDayApps: { min: 1, max: 100, integer: true },
  polledEmulationIntervalSeconds: { min: 1, max: 3600 },
  polledEmulationGapSeconds: { min: 0, max: 3600 },
  complianceThresholdPercent: { min: 0, max: 100 },
  aggregateTopAppsLimit: { min: 0, max: 1000, integer: true },
  // An execution knob rather than a semantic one, which is why the contract
  // lists it under EXECUTION_BROWSER_OPTION_KEYS and not
  // NUMBER_BROWSER_OPTION_KEYS. It still needs a bound here: it was checked
  // only by literal `rangeError(..., 0, 32)` calls inside two cards, which can
  // report a violation but cannot stop a run, so an imported preset or a
  // restored project carrying `parallelMaxWorkers: 500` showed a field error
  // and processed anyway.
  parallelMaxWorkers: { min: 0, max: 32, integer: true },
} as const satisfies Record<
  string,
  { min: number; max: number; integer?: true }
>;

export type BoundedOptionKey = keyof typeof OPTION_NUMERIC_RANGES;

/** The bounds message for one option, or null when it is in range. */
export function optionRangeError(
  key: BoundedOptionKey,
  value: number,
): string | null {
  const range = OPTION_NUMERIC_RANGES[key];
  return "integer" in range && range.integer
    ? integerRangeError(value, range.min, range.max)
    : rangeError(value, range.min, range.max);
}

/**
 * Every out-of-range numeric setting, so a run can be refused before it starts
 * rather than producing a scientifically wrong result that reports success.
 */
export function collectOptionRangeViolations(
  options: Record<string, unknown>,
): { key: BoundedOptionKey; message: string }[] {
  const violations: { key: BoundedOptionKey; message: string }[] = [];
  for (const key of Object.keys(OPTION_NUMERIC_RANGES) as BoundedOptionKey[]) {
    const value = options[key];
    if (typeof value !== "number") continue;
    const message = optionRangeError(key, value);
    if (message) violations.push({ key, message });
  }
  return violations;
}

/**
 * The support-file formats the Rust runtime actually resolves.
 *
 * `RuntimeSupportFiles::resolve` dispatches on the filename extension and
 * accepts exactly `.csv` and `.xlsx`; `.xls` has its own fail-closed arm
 * ("Convert legacy .xls workbooks to .xlsx or CSV") because only calamine's
 * `Xlsx` reader is linked. The pickers used to advertise `.xls`, so a user
 * could select one, see a green "Enabled with uploaded file" state, and lose
 * the whole batch at run time.
 */
export const SUPPORT_FILE_ACCEPT = ".csv,.xlsx";

/**
 * Why a picked support file cannot be used, or null when it can.
 *
 * The allowed set is read out of the same `accept` string the input advertises,
 * so the filter and the check cannot disagree — `accept` is only a dialog hint
 * and is bypassed by drag-and-drop and by "All files".
 */
export function supportFileFormatError(
  fileName: string,
  accept: string,
): string | null {
  const allowed = accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.startsWith("."));
  // A fail-closed check must not have a silent all-pass branch. An accept
  // string with no dot-extension token (a future MIME-only form — RawFilesCard
  // already uses the mixed `".csv,text/csv"` shape) used to return null and
  // disable the gate entirely. Fall back to the formats the runtime actually
  // resolves rather than to "anything goes".
  const extensions = allowed.length
    ? allowed
    : SUPPORT_FILE_ACCEPT.split(",").map((token) => token.trim());
  const lower = fileName.toLowerCase();
  if (extensions.some((extension) => lower.endsWith(extension))) {
    return null;
  }
  const formats = extensions.join(" or ");
  return lower.endsWith(".xls")
    ? `${fileName} is a legacy .xls workbook, which preprocessing refuses. Convert it to ${formats} and upload it again.`
    : `${fileName} is not a supported format. Upload ${formats}.`;
}
