import Papa from "papaparse";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultKeepAwakeAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_keep_awake_apps.csv?url";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
  ProcessedFileResult,
  ProcessedOutputFileResult,
  ProgressEvent,
  ProgressStepKind,
  RawChronicleRow,
} from "@/lib/types";

export const PREPROCESSOR_VERSION = "0.2.0";

export const DEFAULT_BROWSER_OPTIONS: BrowserProcessingOptions = {
  studyName: "",
  usageSessionMode: "app_usage",
  allowStopEventReuse: false,
  useActivityStoppedAsFallback: true,
  applyThresholdToFallback: true,
  longDurationThresholdHours: 12,
  correctDuplicateEventTimestamps: true,
  selectedTimezone: "",
  timezoneHandling: "selected-filter",
  useFilterFile: true,
  useKeepAwakeAppsFile: false,
  useAppCodebook: true,
  customAppEngagementDuration: 300,
  longUsageDurationThresholds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  longDataTimeGapThresholds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  screenUsageAutoLockTimeoutSeconds: 120,
  screenUsageAutoLockToleranceSeconds: 30,
  screenUsageManualLockMaxTailGapSeconds: 30,
  screenUsageKeyguardNearStopSeconds: 2,
  parallelProcessing: false,
  parallelMaxWorkers: undefined,
  sameAppInteractionTypesToStopUsageAt: ["Activity Paused", "Activity Resumed"],
  otherInteractionTypesToStopUsageAt: [
    "Activity Resumed",
    "Filtered App Resumed",
    "Filtered App Usage",
    "Device Shutdown",
  ],
  interactionTypesToRemove: [],
};

export const USAGE_SESSION_MODE_OPTIONS = [
  { value: "app_usage", label: "Generate app usage file" },
  { value: "screen_usage", label: "Generate screen usage file" },
  { value: "app_and_screen_usage", label: "Generate both app and screen files" },
] as const;

export const TIMEZONE_HANDLING_OPTIONS = [
  {
    value: "selected-filter",
    label: "Remove data with timezones other than the selected timezone",
  },
  {
    value: "selected-convert",
    label: "Convert data to the selected timezone",
  },
  {
    value: "primary-filter",
    label: "Remove data with timezones other than the primary timezone per file",
  },
  {
    value: "primary-convert",
    label: "Convert data to the primary timezone per file",
  },
] as const;

export const BOOLEAN_OPTION_CONTROLS = [
  { key: "useFilterFile", label: "Use filter file" },
  { key: "useKeepAwakeAppsFile", label: "Use keep-awake apps file" },
  { key: "useAppCodebook", label: "Use app codebook" },
  { key: "correctDuplicateEventTimestamps", label: "Correct duplicate event timestamps" },
  { key: "allowStopEventReuse", label: "Allow stop-event reuse" },
  { key: "useActivityStoppedAsFallback", label: "Use Activity Stopped fallback" },
  {
    key: "applyThresholdToFallback",
    label: "Apply threshold to Activity Stopped fallback",
  },
  { key: "parallelProcessing", label: "Enable parallel file processing" },
] as const;

export const SAME_APP_INTERACTION_TYPE_OPTIONS = [
  { label: "Activity Paused for the Same App", value: "Activity Paused" },
  { label: "Activity Resumed for the Same App", value: "Activity Resumed" },
  { label: "Activity Stopped for the Same App", value: "Activity Stopped" },
  { label: "Activity Destroyed for the Same App", value: "Activity Destroyed" },
];

export const OTHER_INTERACTION_TYPE_OPTIONS = [
  { label: "Activity Resumed for a Different App", value: "Activity Resumed" },
  { label: "Screen Non-Interactive", value: "Screen Non-Interactive" },
  { label: "Keyguard Shown", value: "Keyguard Shown" },
  { label: "Activity Destroyed", value: "Activity Destroyed" },
  { label: "Device Shutdown", value: "Device Shutdown" },
  { label: "User Stopped", value: "User Stopped" },
  { label: "Activity Resumed for a Filtered App", value: "Filtered App Resumed" },
  { label: "Instance of Usage for a Filtered App", value: "Filtered App Usage" },
];

export const INTERACTION_TYPES_TO_REMOVE_OPTIONS = [
  "Filtered App Usage",
  "End of Usage Missing",
  "End of Day",
  "Continue Previous Day",
  "Configuration Change",
  "System Interaction",
  "User Interaction",
  "Shortcut Invocation",
  "Chooser Action",
  "Notification Seen",
  "Standby Bucket Changed",
  "Notification Interruption",
  "Slice Pinned Priv",
  "Slice Pinned App",
  "Screen Interactive",
  "Screen Non-Interactive",
  "Keyguard Shown",
  "Keyguard Hidden",
  "Foreground Service Start",
  "Foreground Service Stop",
  "Continuing Foreground Service",
  "Rollover Foreground Service",
  "Activity Stopped",
  "Activity Destroyed",
  "Flush to Disk",
  "Device Shutdown",
  "Device Startup",
  "User Unlocked",
  "User Stopped",
  "Locus ID Set",
  "App Component Used",
];

const ALL_INTERACTION_TYPES_MAP: Record<string, string> = {
  "Instance of Usage for an App": "App Usage",
  "Screen Usage": "Screen Usage",
  "Activity Resumed for a Filtered App": "Filtered App Resumed",
  "Activity Paused for a Filtered App": "Filtered App Paused",
  "Instance of Usage for a Filtered App": "Filtered App Usage",
  "Missing End of Usage after an App Starts Being Used": "End of Usage Missing",
  "Unknown importance: 1": "Activity Resumed",
  "Unknown importance: 2": "Activity Paused",
  "Unknown importance: 3": "End of Day",
  "Unknown importance: 4": "Continue Previous Day",
  "Unknown importance: 5": "Configuration Change",
  "Unknown importance: 6": "System Interaction",
  "Unknown importance: 7": "User Interaction",
  "Unknown importance: 8": "Shortcut Invocation",
  "Unknown importance: 9": "Chooser Action",
  "Unknown importance: 10": "Notification Seen",
  "Unknown importance: 11": "Standby Bucket Changed",
  "Unknown importance: 12": "Notification Interruption",
  "Unknown importance: 13": "Slice Pinned Priv",
  "Unknown importance: 14": "Slice Pinned App",
  "Unknown importance: 15": "Screen Interactive",
  "Unknown importance: 16": "Screen Non-Interactive",
  "Unknown importance: 17": "Keyguard Shown",
  "Unknown importance: 18": "Keyguard Hidden",
  "Unknown importance: 19": "Foreground Service Start",
  "Unknown importance: 20": "Foreground Service Stop",
  "Unknown importance: 21": "Continuing Foreground Service",
  "Unknown importance: 22": "Rollover Foreground Service",
  "Unknown importance: 23": "Activity Stopped",
  "Unknown importance: 24": "Activity Destroyed",
  "Unknown importance: 25": "Flush to Disk",
  "Unknown importance: 26": "Device Shutdown",
  "Unknown importance: 27": "Device Startup",
  "Unknown importance: 28": "User Unlocked",
  "Unknown importance: 29": "User Stopped",
  "Unknown importance: 30": "Locus ID Set",
  "Unknown importance: 31": "App Component Used",
  "Move to Foreground": "Activity Resumed",
  "Move to Background": "Activity Paused",
};

const CODEBOOK_COLUMN_RENAME_MAP: Record<string, string> = {
  application_label: "codebook_application_label",
  play_store_genreId: "play_store_genreId",
  play_store_genre: "play_store_genre",
  play_store_broad_app_category: "play_store_broad_app_category",
  play_store_developer: "play_store_developer",
  play_store_free: "play_store_free",
  play_store_rating: "play_store_rating",
  play_store_downloads: "play_store_downloads",
  usc_broad_app_category: "usc_broad_app_category",
  usc_genreId: "usc_genreId",
  umich_child_app_category_code: "umich_child_app_category_code",
  umich_child_app_category: "umich_child_app_category",
  umich_adult_app_category_code: "umich_adult_app_category_code",
  umich_adult_app_category: "umich_adult_app_category",
  umich_free: "umich_free",
  umich_gambling_app: "umich_gambling_app",
  umich_inappropriate_app: "umich_inappropriate_app",
  babyemu_genreId_scraped: "babyemu_genreId_scraped",
  babyemu_genreId_manual: "babyemu_genreId_manual",
  babyemu_broad_app_category: "babyemu_broad_app_category",
  babyemu_medium_app_category: "babyemu_medium_app_category",
  babyemu_fine_app_category: "babyemu_fine_app_category",
  babyemu_alternate_fine_app_category: "babyemu_alternate_fine_app_category",
  babyemu_kids: "babyemu_kids",
  bcm_cnrc_heuristic_category: "bcm_cnrc_heuristic_category",
  bcm_cnrc_categorization_source: "bcm_cnrc_categorization_source",
  dataset: "codebook_dataset",
};

const CODEBOOK_OUTPUT_COLUMNS = Object.values(CODEBOOK_COLUMN_RENAME_MAP);
const AMAZON_APPS = [
  "com.amazon.redstone",
  "com.amazon.firelauncher",
  "com.amazon.imp",
  "com.amazon.alta.h2clientservice",
  "com.amazon.media.session.monitor",
];

const SCREEN_START_EVENTS = new Set(["Screen Interactive", "Screen Interactive/Keyguard Shown"]);
const SCREEN_STOP_EVENTS = new Set([
  "Screen Non-Interactive",
  "Device Screen Off",
  "Screen Non-Interactive/Keyguard Hidden",
]);
const LOCK_SCREEN_EVENTS = new Set(["Keyguard Shown", "Screen Interactive/Keyguard Shown"]);
const UNLOCK_EVENTS = new Set([
  "Keyguard Hidden",
  "User Unlocked",
  "Screen Non-Interactive/Keyguard Hidden",
]);
const FOREGROUND_EVENTS = new Set(["Activity Resumed", "Filtered App Resumed"]);
const MEANINGFUL_ACTIVITY_EVENTS = new Set([
  "Activity Resumed",
  "Filtered App Resumed",
  "User Interaction",
  "Shortcut Invocation",
  "Chooser Action",
  "App Component Used",
  "User Unlocked",
  "Keyguard Hidden",
]);

const eventFormatterCache = new Map<string, Intl.DateTimeFormat>();
const eventWithOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>();
const defaultSupportCache = new Map<string, Promise<SupportRows>>();
const uploadedSupportCache = new Map<string, Promise<SupportRows>>();
const MISSING_INT64 = -(1n << 63n);

type CanonicalRow = {
  study_id: string;
  participant_id: string;
  possible_device_model: string;
  username: string;
  application_label: string;
  interaction_type: string;
  app_package_name: string;
  event_timestamp_ns: bigint;
  timezone: string;
  data_time_gap_hours: number;
  preprocessor_version: string;
  datetime_of_preprocessing: string;
  date: string;
  day: number;
  weekdayMF: number;
  weekdayMTh: number;
  weekdaySuTh: number;
  hour: number;
  quarter: number;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  duration_seconds: number | null;
  duration_minutes: number | null;
  screen_usage_end_reason: string | null;
  screen_usage_end_reason_confidence: number | null;
  screen_usage_stop_event_type: string | null;
  screen_usage_last_activity_timestamp_ns: bigint | null;
  screen_usage_tail_gap_seconds: number | null;
  screen_usage_foreground_app_package: string | null;
  screen_usage_keep_awake_app_label: string | null;
  screen_usage_lock_screen_only: number | null;
  any_app_usage_flags: string;
  valid_app_new_engage_30s: number;
  valid_app_new_engage_custom: number;
  valid_app_switched_app: number;
  valid_app_usage_time_gap_hours: number;
  any_app_new_engage_30s: number;
  any_app_new_engage_custom: number;
  any_app_switched_app: number;
  any_app_usage_time_gap_hours: number;
  genreId_scraped: string | null;
  broad_app_category?: string | null;
  codebook_application_label?: string | null;
  play_store_genreId?: string | null;
  play_store_genre?: string | null;
  play_store_broad_app_category?: string | null;
  play_store_developer?: string | null;
  play_store_free?: string | null;
  play_store_rating?: string | null;
  play_store_downloads?: string | null;
  usc_broad_app_category?: string | null;
  usc_genreId?: string | null;
  umich_child_app_category_code?: string | null;
  umich_child_app_category?: string | null;
  umich_adult_app_category_code?: string | null;
  umich_adult_app_category?: string | null;
  umich_free?: string | null;
  umich_gambling_app?: string | null;
  umich_inappropriate_app?: string | null;
  babyemu_genreId_scraped?: string | null;
  babyemu_genreId_manual?: string | null;
  babyemu_broad_app_category?: string | null;
  babyemu_medium_app_category?: string | null;
  babyemu_fine_app_category?: string | null;
  babyemu_alternate_fine_app_category?: string | null;
  babyemu_kids?: string | null;
  bcm_cnrc_heuristic_category?: string | null;
  bcm_cnrc_categorization_source?: string | null;
  codebook_dataset?: string | null;
  __index: number;
};

type CodebookRecord = Record<string, string | null>;
type MatcherRunner = (input: MatcherInput) => Promise<MatcherOutput>;
type ScreenState = {
  startIndex: number;
  startTimestampNs: bigint;
  startTimezone: string;
  lockScreenSeen: boolean;
  unlockedSeen: boolean;
  foregroundAppPackage: string | null;
  lastMeaningfulActivityTimestampNs: bigint | null;
  lastMeaningfulActivityPackage: string | null;
};

type SupportRows = Array<Record<string, string>>;
type ReadXlsxRows = (input: ArrayBuffer) => Promise<unknown[][]>;

function requireString(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

function normalizeInteractionType(value: string): string {
  return ALL_INTERACTION_TYPES_MAP[value] ?? value;
}

function parseChronicleTimestampNs(value: string): bigint {
  const text = value.trim();
  if (!text) {
    throw new Error("Missing event_timestamp");
  }
  const explicitTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(text);
  const normalized = text.replace(" ", "T");
  const isoText = explicitTimezone ? normalized : `${normalized}Z`;
  const milliseconds = Date.parse(isoText);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`Invalid event_timestamp: ${value}`);
  }
  return BigInt(milliseconds) * 1_000_000n;
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function parseCsvRows(text: string): SupportRows {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Failed to parse CSV");
  }
  return parsed.data.map((row) => {
    const normalized: Record<string, string> = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[String(key).trim()] = requireString(value);
    });
    return normalized;
  });
}

async function parseWorkbookRows(bytes: ArrayBuffer): Promise<SupportRows> {
  const workbookRows = await readWorkbookRows(bytes);
  if (workbookRows.length === 0) {
    return [];
  }
  const headerRow = workbookRows[0]?.map((value) => requireString(String(value ?? ""))) ?? [];
  const rows: SupportRows = [];
  for (const rowValues of workbookRows.slice(1)) {
    const row: Record<string, string> = {};
    headerRow.forEach((header, index) => {
      if (header) {
        row[header] = requireString(rowValues?.[index] == null ? "" : String(rowValues[index]));
      }
    });
    if (Object.values(row).some((value) => value !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

async function readWorkbookRows(bytes: ArrayBuffer): Promise<unknown[][]> {
  const readXlsxFile = await loadWorkbookReader();
  return (await readXlsxFile(bytes)) as unknown[][];
}

async function loadWorkbookReader(): Promise<ReadXlsxRows> {
  if (typeof DOMParser !== "undefined") {
    const module = (await import("read-excel-file")) as { default: ReadXlsxRows };
    return module.default;
  }
  if (typeof self === "undefined") {
    throw new Error("Spreadsheet uploads require a browser execution context. Use CSV support files for Node-only runs.");
  }
  const module = (await import("read-excel-file/web-worker")) as { default: ReadXlsxRows };
  return module.default;
}

async function computeSupportFileCacheKey(file: BrowserSupportFile): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", file.bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${file.name}:${hex}`;
}

async function parseSupportRowsFromFile(file: BrowserSupportFile): Promise<SupportRows> {
  const cacheKey = await computeSupportFileCacheKey(file);
  const cached = uploadedSupportCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    if (/\.csv$/i.test(file.name)) {
      return parseCsvRows(new TextDecoder("utf-8").decode(file.bytes));
    }
    if (/\.xlsx$/i.test(file.name)) {
      return parseWorkbookRows(file.bytes);
    }
    if (/\.xls$/i.test(file.name)) {
      throw new Error(
        `Unsupported support file format: ${file.name}. Convert legacy .xls workbooks to .xlsx or CSV for the local web app.`,
      );
    }
    throw new Error(`Unsupported support file format: ${file.name}`);
  })();
  uploadedSupportCache.set(cacheKey, pending);
  return pending;
}

async function fetchDefaultRows(url: string): Promise<SupportRows> {
  const cached = defaultSupportCache.get(url);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load bundled asset: ${url}`);
    }
    return parseCsvRows(await response.text());
  })();
  defaultSupportCache.set(url, pending);
  return pending;
}

async function loadSupportRows(
  file: BrowserSupportFile | null | undefined,
  defaultUrl: string,
): Promise<SupportRows> {
  if (file) {
    return parseSupportRowsFromFile(file);
  }
  return fetchDefaultRows(defaultUrl);
}

function buildFilterMap(rows: SupportRows): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const packageName = requireString(row.app_package_name ?? row.package_name);
    const labels = requireString(
      row.known_application_labels ?? row.application_label ?? row.label_or_note,
    );
    if (!packageName) {
      continue;
    }
    const labelSet = map.get(packageName) ?? new Set<string>();
    if (labels) {
      labels
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((label) => labelSet.add(label));
    }
    map.set(packageName, labelSet);
  }
  return map;
}

function buildKeepAwakeMap(rows: SupportRows): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const packageName = requireString(row.package_name ?? row.app_package_name);
    const label = requireString(row.label_or_note ?? row.application_label);
    if (!packageName || packageName.startsWith("#")) {
      continue;
    }
    map.set(packageName, label);
  }
  return map;
}

function buildCodebookMap(rows: SupportRows): Map<string, CodebookRecord> {
  const map = new Map<string, CodebookRecord>();
  for (const row of rows) {
    const packageName = requireString(row.app_package_name);
    if (!packageName || map.has(packageName)) {
      continue;
    }
    const normalized: CodebookRecord = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[key] = requireString(value) || null;
    });
    map.set(packageName, normalized);
  }
  return map;
}

function eventFormatter(timeZone: string): Intl.DateTimeFormat {
  const cacheKey = `event:${timeZone}`;
  const cached = eventFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  eventFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function eventOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cacheKey = `event-offset:${timeZone}`;
  const cached = eventWithOffsetFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  eventWithOffsetFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function weekdayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = weekdayFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  weekdayFormatterCache.set(timeZone, formatter);
  return formatter;
}

function formatParts(timestampNs: bigint, timeZone: string): Record<string, string> {
  const date = new Date(Number(timestampNs / 1_000_000n));
  const parts = eventFormatter(timeZone).formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  return values;
}

function formatEventTimestamp(timestampNs: bigint, timeZone: string): string {
  const date = new Date(Number(timestampNs / 1_000_000n));
  const parts = eventOffsetFormatter(timeZone).formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  let offset = values.timeZoneName ?? "+00:00";
  offset = offset.replace("GMT", "");
  if (offset === "") {
    offset = "+00:00";
  }
  if (/^[+-]\d{1,2}$/.test(offset)) {
    offset = `${offset.padStart(3, "0")}:00`;
  }
  if (/^[+-]\d{2}\d{2}$/.test(offset)) {
    offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  }
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}${offset}`;
}

function formatSessionTimestamp(timestampNs: bigint | null, timeZone: string): string {
  if (timestampNs == null) {
    return "";
  }
  const parts = formatParts(timestampNs, timeZone);
  return `${parts.month}-${parts.day}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatScreenTimestamp(timestampNs: bigint | null, timeZone: string): string {
  if (timestampNs == null) {
    return "";
  }
  const base = formatEventTimestamp(timestampNs, timeZone);
  return base.replace(/([+-]\d{2}:\d{2})$/, ".000000$1");
}

function formatScreenLastActivityTimestamp(timestampNs: bigint | null, timeZone: string): string {
  if (timestampNs == null) {
    return "";
  }
  const base = formatEventTimestamp(timestampNs, timeZone);
  return base.replace(" ", "T").replace(/([+-]\d{2}):(\d{2})$/, ".000000$1$2");
}

function normalizeFloatString(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const absValue = Math.abs(value);
  if (absValue !== 0 && absValue < 1e-4) {
    return Number.parseFloat(value.toPrecision(15))
      .toExponential()
      .replace(/\.0+e/, "e")
      .replace(/e([+-])0+/, "e$1");
  }
  const normalized =
    Number.parseFloat(value.toPrecision(17)).toString();
  return /[.eE]/.test(normalized) ? normalized : `${normalized}.0`;
}

function formatCsvNumber(
  value: number | null,
  options?: { floatStyle?: boolean },
): string {
  if (value == null) {
    return "";
  }
  return options?.floatStyle ? normalizeFloatString(value) : String(value);
}

function formatCsvScalar(value: string | number | boolean | null | undefined): string | number {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    if (value === "True") {
      return "true";
    }
    if (value === "False") {
      return "false";
    }
  }
  return value ?? "";
}

function wrapInt64(value: bigint): bigint {
  return BigInt.asIntN(64, value);
}

function localWeekdayNumber(timestampNs: bigint, timeZone: string): number {
  const weekday = weekdayFormatter(timeZone).format(new Date(Number(timestampNs / 1_000_000n)));
  const map: Record<string, number> = {
    Sun: 1,
    Mon: 2,
    Tue: 3,
    Wed: 4,
    Thu: 5,
    Fri: 6,
    Sat: 7,
  };
  return map[weekday] ?? 1;
}

function populateTimeColumns(row: CanonicalRow, timestampNs: bigint, timeZone: string): void {
  const parts = formatParts(timestampNs, timeZone);
  const day = localWeekdayNumber(timestampNs, timeZone);
  row.date = `${parts.year}-${parts.month}-${parts.day}`;
  row.day = day;
  row.weekdayMF = day >= 2 && day <= 6 ? 1 : 0;
  row.weekdayMTh = day >= 2 && day <= 5 ? 1 : 0;
  row.weekdaySuTh = day === 1 || (day >= 2 && day <= 5) ? 1 : 0;
  row.hour = Number(parts.hour);
  row.quarter = Math.floor((Number(parts.month) - 1) / 3) + 1;
}

function createBaseRow(
  row: RawChronicleRow,
  index: number,
  nowText: string,
  possibleDeviceModel: string,
): CanonicalRow {
  const timezone = requireString(row.timezone, "UTC") || "UTC";
  const base: CanonicalRow = {
    study_id: requireString(row.study_id),
    participant_id: requireString(row.participant_id),
    possible_device_model: possibleDeviceModel,
    username: requireString(row.username).replace("Target child", "Target Child"),
    application_label: requireString(row.application_label),
    interaction_type: normalizeInteractionType(requireString(row.interaction_type)),
    app_package_name: requireString(row.app_package_name),
    event_timestamp_ns: parseChronicleTimestampNs(requireString(row.event_timestamp)),
    timezone,
    data_time_gap_hours: 0,
    preprocessor_version: PREPROCESSOR_VERSION,
    datetime_of_preprocessing: nowText,
    date: "",
    day: 0,
    weekdayMF: 0,
    weekdayMTh: 0,
    weekdaySuTh: 0,
    hour: 0,
    quarter: 0,
    start_timestamp_ns: null,
    stop_timestamp_ns: null,
    duration_seconds: null,
    duration_minutes: null,
    screen_usage_end_reason: null,
    screen_usage_end_reason_confidence: null,
    screen_usage_stop_event_type: null,
    screen_usage_last_activity_timestamp_ns: null,
    screen_usage_tail_gap_seconds: null,
    screen_usage_foreground_app_package: null,
    screen_usage_keep_awake_app_label: null,
    screen_usage_lock_screen_only: null,
    any_app_usage_flags: "[]",
    valid_app_new_engage_30s: 0,
    valid_app_new_engage_custom: 0,
    valid_app_switched_app: 0,
    valid_app_usage_time_gap_hours: 0,
    any_app_new_engage_30s: 0,
    any_app_new_engage_custom: 0,
    any_app_switched_app: 0,
    any_app_usage_time_gap_hours: 0,
    genreId_scraped: null,
    __index: index,
  };
  populateTimeColumns(base, base.event_timestamp_ns, timezone);
  return base;
}

function getPossibleDeviceModel(rows: RawChronicleRow[]): string {
  return rows.some((row) =>
    AMAZON_APPS.some((packagePrefix) => requireString(row.app_package_name).includes(packagePrefix)),
  )
    ? "Amazon Fire"
    : "Android";
}

function resolveDatetimeOfPreprocessing(
  runtime: BrowserProcessingRuntime | undefined,
): string {
  return runtime?.datetimeOfPreprocessing ?? new Date().toISOString().slice(0, 19).replace("T", " ");
}

function parseRawRows(
  csvText: string,
  runtime?: BrowserProcessingRuntime,
): CanonicalRow[] {
  const parsed = Papa.parse<RawChronicleRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Failed to parse CSV");
  }
  const filtered = parsed.data.filter((row) => requireString(row.event_timestamp).length > 0);
  const possibleDeviceModel = getPossibleDeviceModel(filtered);
  const nowText = resolveDatetimeOfPreprocessing(runtime);
  return filtered
    .map((row, index) => createBaseRow(row, index, nowText, possibleDeviceModel))
    .sort((left, right) =>
      left.event_timestamp_ns < right.event_timestamp_ns
        ? -1
        : left.event_timestamp_ns > right.event_timestamp_ns
          ? 1
          : left.__index - right.__index,
    );
}

export function discoverTimezonesFromRawCsv(
  csvText: string,
  runtime?: BrowserProcessingRuntime,
): string[] {
  const rows = parseRawRows(csvText, runtime);
  return Array.from(
    new Set(rows.map((row) => row.timezone).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function dominantTimezone(rows: CanonicalRow[]): string {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    if (!row.timezone) {
      return;
    }
    counts.set(row.timezone, (counts.get(row.timezone) ?? 0) + 1);
  });
  let best = "UTC";
  let bestCount = -1;
  for (const [timezone, count] of counts.entries()) {
    if (count > bestCount) {
      best = timezone;
      bestCount = count;
    }
  }
  return best;
}

function applyTimezoneHandling(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
): { rows: CanonicalRow[]; timezone: string } {
  const selected = options.selectedTimezone?.trim();
  const primary = dominantTimezone(rows);
  let nextRows = rows;
  let targetTimezone = primary;
  if (options.timezoneHandling === "selected-filter" && selected) {
    nextRows = rows.filter((row) => row.timezone === selected);
    targetTimezone = selected;
  } else if (options.timezoneHandling === "selected-convert" && selected) {
    targetTimezone = selected;
  } else if (options.timezoneHandling === "primary-filter") {
    nextRows = rows.filter((row) => row.timezone === primary);
    targetTimezone = primary;
  } else if (options.timezoneHandling === "primary-convert") {
    targetTimezone = primary;
  }
  const adjustedRows = nextRows.map((row) => {
    const updated = { ...row, timezone: targetTimezone };
    populateTimeColumns(updated, updated.event_timestamp_ns, targetTimezone);
    return updated;
  });
  return { rows: adjustedRows, timezone: targetTimezone };
}

function dedupeExactRows(rows: CanonicalRow[]): CanonicalRow[] {
  const seen = new Set<string>();
  const deduped: CanonicalRow[] = [];
  for (const row of rows) {
    const key = `${row.event_timestamp_ns}|${row.interaction_type}|${row.app_package_name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ ...row });
  }
  return deduped;
}

function duplicatePriority(interactionType: string, stopUsageTypes: Set<string>): number {
  const normalized =
    interactionType === "Screen Non-interactive" ? "Screen Non-Interactive" : interactionType;
  if (normalized === "Activity Resumed") {
    return 0;
  }
  if (stopUsageTypes.has(normalized)) {
    return 2;
  }
  return 1;
}

function unalignDuplicateTimestamps(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
): CanonicalRow[] {
  if (rows.length <= 1) {
    return rows;
  }
  const stopUsageTypes = new Set([
    ...options.sameAppInteractionTypesToStopUsageAt,
    ...options.otherInteractionTypesToStopUsageAt,
  ]);
  const adjusted = [...rows];
  let hasDuplicates = false;
  for (let index = 1; index < adjusted.length; index += 1) {
    if (adjusted[index]!.event_timestamp_ns <= adjusted[index - 1]!.event_timestamp_ns) {
      hasDuplicates = true;
      break;
    }
  }
  if (!hasDuplicates) {
    return adjusted;
  }

  let start = 0;
  while (start < adjusted.length) {
    let end = start + 1;
    while (
      end < adjusted.length &&
      adjusted[end]!.event_timestamp_ns === adjusted[start]!.event_timestamp_ns
    ) {
      end += 1;
    }
    const count = end - start;
    if (count > 1) {
      const ordered = adjusted
        .slice(start, end)
        .map((row, localIndex) => ({
          row,
          localIndex,
          priority: duplicatePriority(row.interaction_type, stopUsageTypes),
        }))
        .sort((left, right) =>
          left.priority === right.priority
            ? left.localIndex - right.localIndex
            : left.priority - right.priority,
        );
      ordered.forEach((entry, orderedIndex) => {
        entry.row.event_timestamp_ns -= BigInt(count - orderedIndex) * 1_000n;
      });
    }
    start = end;
  }

  return adjusted.sort((left, right) =>
    left.event_timestamp_ns < right.event_timestamp_ns
      ? -1
      : left.event_timestamp_ns > right.event_timestamp_ns
        ? 1
        : left.__index - right.__index,
  );
}

function markDataTimeGaps(rows: CanonicalRow[]): CanonicalRow[] {
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    return {
      ...row,
      data_time_gap_hours: previous
        ? Number(
            ((Number(row.event_timestamp_ns - previous.event_timestamp_ns) / 3_600_000_000_000) || 0).toFixed(2),
          )
        : 0,
    };
  });
}

function labelFilteredApps(rows: CanonicalRow[], filterMap: Map<string, Set<string>>): CanonicalRow[] {
  if (!filterMap.size) {
    return rows;
  }
  const mapping: Record<string, string> = {
    "Activity Resumed": "Filtered App Resumed",
    "Activity Paused": "Filtered App Paused",
    "Activity Stopped": "Filtered App Stopped",
    "Activity Destroyed": "Filtered App Destroyed",
  };
  return rows.map((row) => {
    const labels = filterMap.get(row.app_package_name);
    if (!labels || (labels.size > 0 && !labels.has(row.application_label))) {
      return row;
    }
    return {
      ...row,
      interaction_type: mapping[row.interaction_type] ?? row.interaction_type,
    };
  });
}

function stableFactorize(values: string[]): Int32Array {
  const lookup = new Map<string, number>();
  const codes = new Int32Array(values.length);
  let nextCode = 0;
  values.forEach((value, index) => {
    if (!lookup.has(value)) {
      lookup.set(value, nextCode);
      nextCode += 1;
    }
    codes[index] = lookup.get(value) ?? 0;
  });
  return codes;
}

function buildMatcherInput(
  rows: CanonicalRow[],
  resumedType: string,
  stoppedType: string,
  sameStopTypes: Set<string>,
  otherStopTypes: Set<string>,
  options: BrowserProcessingOptions,
): MatcherInput {
  const appPackages = rows.map((row) => row.app_package_name);
  const interactionTypes = rows.map((row) => row.interaction_type);
  return {
    appCodes: stableFactorize(appPackages),
    timestampNs: BigInt64Array.from(rows.map((row) => row.event_timestamp_ns)),
    resumed: Uint8Array.from(interactionTypes.map((value) => (value === resumedType ? 1 : 0))),
    sameStop: Uint8Array.from(interactionTypes.map((value) => (sameStopTypes.has(value) ? 1 : 0))),
    otherStop: Uint8Array.from(interactionTypes.map((value) => (otherStopTypes.has(value) ? 1 : 0))),
    stopped: Uint8Array.from(interactionTypes.map((value) => (value === stoppedType ? 1 : 0))),
    options: {
      allowStopEventReuse: options.allowStopEventReuse,
      useActivityStoppedAsFallback: options.useActivityStoppedAsFallback,
      applyThresholdToFallback: options.applyThresholdToFallback,
      longDurationThresholdNs: BigInt(Math.round(options.longDurationThresholdHours * 3_600_000_000_000)),
    },
  };
}

async function processUsageRows(
  rows: CanonicalRow[],
  resumedType: string,
  pausedType: string,
  usageType: string,
  stoppedType: string,
  sameStopTypes: Set<string>,
  otherStopTypes: Set<string>,
  options: BrowserProcessingOptions,
  runMatcher: MatcherRunner,
): Promise<CanonicalRow[]> {
  const matcherOutput = await runMatcher(
    buildMatcherInput(rows, resumedType, stoppedType, sameStopTypes, otherStopTypes, options),
  );

  const nextRows = rows.map((row) => ({ ...row }));
  matcherOutput.startIndices.forEach((startIndex) => {
    nextRows[startIndex]!.start_timestamp_ns = nextRows[startIndex]!.event_timestamp_ns;
  });
  matcherOutput.stopStartIndices.forEach((startIndex, position) => {
    const stopEventIndex = matcherOutput.stopEventIndices[position]!;
    nextRows[startIndex]!.stop_timestamp_ns = nextRows[stopEventIndex]!.event_timestamp_ns;
  });
  matcherOutput.missingIndices.forEach((index) => {
    nextRows[index]!.interaction_type = "End of Usage Missing";
    nextRows[index]!.stop_timestamp_ns = null;
    nextRows[index]!.duration_seconds = null;
    nextRows[index]!.duration_minutes = null;
    if (
      usageType === "Filtered App Usage" ||
      (options.useFilterFile && nextRows[index]!.app_package_name === "android")
    ) {
      nextRows[index]!.start_timestamp_ns = null;
    }
  });

  const filtered = nextRows
    .filter((row) => row.interaction_type !== pausedType)
    .filter(
      (row) =>
        row.interaction_type !== resumedType ||
        (row.start_timestamp_ns !== null && row.stop_timestamp_ns !== null),
    )
    .map((row) => {
      if (row.interaction_type === resumedType) {
        const updated = { ...row, interaction_type: usageType };
        if (usageType === "Filtered App Usage") {
          updated.start_timestamp_ns = null;
          updated.stop_timestamp_ns = null;
          updated.duration_seconds = null;
          updated.duration_minutes = null;
        } else {
          const durationSeconds =
            Number(updated.stop_timestamp_ns! - updated.start_timestamp_ns!) / 1_000_000_000;
          updated.duration_seconds = durationSeconds;
          updated.duration_minutes = durationSeconds / 60;
        }
        return updated;
      }
      return row;
    });

  return filtered.sort((left, right) =>
    left.event_timestamp_ns < right.event_timestamp_ns
      ? -1
      : left.event_timestamp_ns > right.event_timestamp_ns
        ? 1
        : left.__index - right.__index,
  );
}

async function runAppUsageAlgorithm(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
  runMatcher: MatcherRunner,
): Promise<CanonicalRow[]> {
  let nextRows = rows;
  if (options.useFilterFile) {
    nextRows = await processUsageRows(
      nextRows,
      "Filtered App Resumed",
      "Filtered App Paused",
      "Filtered App Usage",
      "Filtered App Stopped",
      new Set(
        options.sameAppInteractionTypesToStopUsageAt.map((value) =>
          ({
            "Activity Paused": "Filtered App Paused",
            "Activity Resumed": "Filtered App Resumed",
            "Activity Stopped": "Filtered App Stopped",
            "Activity Destroyed": "Filtered App Destroyed",
          })[value] ?? value,
        ),
      ),
      new Set(options.otherInteractionTypesToStopUsageAt),
      options,
      runMatcher,
    );
  }

  if (!nextRows.some((row) => row.interaction_type === "Activity Resumed" || row.interaction_type === "Activity Paused")) {
    throw new Error("No valid app usage data during the study period");
  }

  return processUsageRows(
    nextRows,
    "Activity Resumed",
    "Activity Paused",
    "App Usage",
    "Activity Stopped",
    new Set(options.sameAppInteractionTypesToStopUsageAt),
    new Set(options.otherInteractionTypesToStopUsageAt),
    options,
    runMatcher,
  );
}

function secondsBetween(left: bigint, right: bigint): number {
  return Number(right - left) / 1_000_000_000;
}

function deriveScreenUsageSessions(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
  keepAwakeApps: Map<string, string>,
): CanonicalRow[] {
  if (!rows.some((row) => SCREEN_START_EVENTS.has(row.interaction_type))) {
    return [];
  }
  const keyguardShownTimestamps = rows
    .filter((row) => LOCK_SCREEN_EVENTS.has(row.interaction_type))
    .map((row) => row.event_timestamp_ns)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const sessions: CanonicalRow[] = [];
  let state: ScreenState | null = null;

  const buildSession = (currentState: ScreenState, stopTimestampNs: bigint | null, stopEventType: string | null) => {
    const startRow = rows[currentState.startIndex]!;
    const screenRow: CanonicalRow = {
      ...startRow,
      interaction_type: "Screen Usage",
      start_timestamp_ns: currentState.startTimestampNs,
      stop_timestamp_ns: stopTimestampNs,
      duration_seconds: stopTimestampNs ? secondsBetween(currentState.startTimestampNs, stopTimestampNs) : null,
      duration_minutes: stopTimestampNs
        ? secondsBetween(currentState.startTimestampNs, stopTimestampNs) / 60
        : null,
      application_label: "",
      app_package_name: currentState.foregroundAppPackage ?? "",
      screen_usage_foreground_app_package: currentState.foregroundAppPackage,
      screen_usage_end_reason: null,
      screen_usage_end_reason_confidence: null,
      screen_usage_stop_event_type: stopEventType,
      screen_usage_last_activity_timestamp_ns: currentState.lastMeaningfulActivityTimestampNs,
      screen_usage_tail_gap_seconds: null,
      screen_usage_keep_awake_app_label: null,
      screen_usage_lock_screen_only: 0,
      data_time_gap_hours: 0,
      event_timestamp_ns: currentState.startTimestampNs,
      timezone: currentState.startTimezone,
      __index: startRow.__index + 1_000_000,
    };
    populateTimeColumns(screenRow, screenRow.event_timestamp_ns, screenRow.timezone);

    if (stopTimestampNs == null) {
      screenRow.screen_usage_end_reason = "missing_stop";
      screenRow.screen_usage_end_reason_confidence = 1.0;
      sessions.push(screenRow);
      return;
    }

    const lastPackage =
      currentState.lastMeaningfulActivityPackage ?? currentState.foregroundAppPackage ?? "";
    const keepAwakeLabel = keepAwakeApps.get(lastPackage) ?? "";
    const tailGapSeconds =
      currentState.lastMeaningfulActivityTimestampNs == null
        ? null
        : secondsBetween(currentState.lastMeaningfulActivityTimestampNs, stopTimestampNs);

    screenRow.screen_usage_tail_gap_seconds = tailGapSeconds;
    screenRow.screen_usage_keep_awake_app_label = keepAwakeLabel || null;

    if (
      currentState.lockScreenSeen &&
      !currentState.unlockedSeen &&
      currentState.foregroundAppPackage == null
    ) {
      screenRow.screen_usage_end_reason = "lock_screen_only";
      screenRow.screen_usage_end_reason_confidence = 0.95;
      screenRow.screen_usage_lock_screen_only = 1;
      sessions.push(screenRow);
      return;
    }

    if (tailGapSeconds != null) {
      if (keepAwakeLabel && tailGapSeconds > options.screenUsageAutoLockTimeoutSeconds) {
        screenRow.screen_usage_end_reason = "app_kept_awake_or_extended";
        screenRow.screen_usage_end_reason_confidence = 0.9;
        sessions.push(screenRow);
        return;
      }
      if (tailGapSeconds <= options.screenUsageManualLockMaxTailGapSeconds) {
        screenRow.screen_usage_end_reason = "probable_manual_lock";
        screenRow.screen_usage_end_reason_confidence = 0.85;
        sessions.push(screenRow);
        return;
      }
      if (
        Math.abs(tailGapSeconds - options.screenUsageAutoLockTimeoutSeconds) <=
        options.screenUsageAutoLockToleranceSeconds
      ) {
        screenRow.screen_usage_end_reason = "probable_auto_lock";
        screenRow.screen_usage_end_reason_confidence = 0.9;
        sessions.push(screenRow);
        return;
      }
    }

    if (currentState.lockScreenSeen) {
      const nearStop = keyguardShownTimestamps.some(
        (candidate) =>
          Math.abs(secondsBetween(candidate, stopTimestampNs)) <=
          options.screenUsageKeyguardNearStopSeconds,
      );
      if (nearStop) {
        screenRow.screen_usage_end_reason = "probable_manual_lock";
        screenRow.screen_usage_end_reason_confidence = 0.7;
        sessions.push(screenRow);
        return;
      }
    }

    if (tailGapSeconds != null) {
      screenRow.screen_usage_end_reason = "extended_idle_or_unknown";
      screenRow.screen_usage_end_reason_confidence = 0.5;
      sessions.push(screenRow);
      return;
    }

    screenRow.screen_usage_end_reason = "unknown";
    screenRow.screen_usage_end_reason_confidence = 0.25;
    sessions.push(screenRow);
  };

  rows.forEach((row, index) => {
    const interactionType = row.interaction_type;
    const packageName = row.app_package_name || null;
    if (SCREEN_START_EVENTS.has(interactionType)) {
      if (state == null) {
        state = {
          startIndex: index,
          startTimestampNs: row.event_timestamp_ns,
          startTimezone: row.timezone,
          lockScreenSeen: LOCK_SCREEN_EVENTS.has(interactionType),
          unlockedSeen: false,
          foregroundAppPackage: null,
          lastMeaningfulActivityTimestampNs: null,
          lastMeaningfulActivityPackage: null,
        };
      }
      return;
    }
    if (state == null) {
      return;
    }
    if (LOCK_SCREEN_EVENTS.has(interactionType)) {
      state.lockScreenSeen = true;
    }
    if (UNLOCK_EVENTS.has(interactionType)) {
      state.unlockedSeen = true;
    }
    if (FOREGROUND_EVENTS.has(interactionType)) {
      state.foregroundAppPackage = packageName;
    }
    if (MEANINGFUL_ACTIVITY_EVENTS.has(interactionType)) {
      state.lastMeaningfulActivityTimestampNs = row.event_timestamp_ns;
      state.lastMeaningfulActivityPackage = packageName ?? state.foregroundAppPackage;
    }
    if (SCREEN_STOP_EVENTS.has(interactionType)) {
      buildSession(state, row.event_timestamp_ns, interactionType);
      state = null;
    }
  });

  if (state != null) {
    buildSession(state, null, null);
  }

  return sessions;
}

function enrichWithCodebookData(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
  codebookMap: Map<string, CodebookRecord>,
): CanonicalRow[] {
  if (!options.useAppCodebook) {
    return rows;
  }
  if (!codebookMap.size) {
    return rows.map((row) => ({
      ...row,
      genreId_scraped: "Unknown",
      broad_app_category: "Unknown",
      ...Object.fromEntries(CODEBOOK_OUTPUT_COLUMNS.map((column) => [column, null])),
    }));
  }

  return rows.map((row) => {
    const codebook = codebookMap.get(row.app_package_name);
    const updated: CanonicalRow = { ...row };
    CODEBOOK_OUTPUT_COLUMNS.forEach((column) => {
      (updated as unknown as Record<string, string | number | null>)[column] = null;
    });
    if (!codebook) {
      updated.genreId_scraped = "Unknown";
      updated.broad_app_category = "Unknown";
      return updated;
    }
    Object.entries(CODEBOOK_COLUMN_RENAME_MAP).forEach(([sourceColumn, targetColumn]) => {
      (updated as unknown as Record<string, string | number | null>)[targetColumn] =
        codebook[sourceColumn] ?? null;
    });
    const broadCategoryCandidates = [
      updated.play_store_broad_app_category,
      updated.usc_broad_app_category,
      updated.babyemu_broad_app_category,
      updated.bcm_cnrc_heuristic_category,
      updated.broad_app_category ?? null,
    ].filter((value): value is string => Boolean(value && value.trim()));
    updated.broad_app_category = broadCategoryCandidates[0] ?? "Unknown";

    const genreValues = [
      updated.babyemu_genreId_scraped,
      updated.babyemu_genreId_manual,
      updated.play_store_genreId,
      updated.usc_genreId,
    ].filter((value): value is string => Boolean(value && value.trim()));
    if (!genreValues.length) {
      updated.genreId_scraped = "Unknown";
    } else if (new Set(genreValues).size === 1) {
      updated.genreId_scraped = genreValues[0]!;
      updated.play_store_genreId = null;
      updated.usc_genreId = null;
      updated.babyemu_genreId_scraped = null;
      updated.babyemu_genreId_manual = null;
    } else {
      updated.genreId_scraped = null;
    }
    return updated;
  });
}

function addAppUsageDetailColumns(rows: CanonicalRow[], options: BrowserProcessingOptions): CanonicalRow[] {
  const nextRows = rows.map((row) => ({ ...row }));
  const anyUsageIndices = nextRows
    .map((row, index) =>
      row.interaction_type === "App Usage" || row.interaction_type === "Filtered App Usage"
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const validUsageIndices = nextRows
    .map((row, index) => (row.interaction_type === "App Usage" ? index : -1))
    .filter((index) => index >= 0);

  const applyMetrics = (
    indices: number[],
    update: (row: CanonicalRow, values: {
      engage30: number;
      engageCustom: number;
      switched: number;
      gapHours: number;
    }) => void,
  ) => {
    if (!indices.length) {
      return;
    }
    update(nextRows[indices[0]]!, {
      engage30: 1,
      engageCustom: 1,
      switched: 0,
      gapHours: 0,
    });
    for (let i = 1; i < indices.length; i += 1) {
      const current = nextRows[indices[i]]!;
      const previous = nextRows[indices[i - 1]]!;
      const currentStartNs = current.start_timestamp_ns ?? MISSING_INT64;
      const previousStopNs = previous.stop_timestamp_ns ?? MISSING_INT64;
      const gapDeltaNs = wrapInt64(currentStartNs - previousStopNs);
      const gapSeconds = Number(gapDeltaNs) / 1_000_000_000;
      update(current, {
        engage30: gapSeconds > 30 ? 1 : 0,
        engageCustom: gapSeconds > options.customAppEngagementDuration ? 1 : 0,
        switched: current.app_package_name !== previous.app_package_name ? 1 : 0,
        gapHours: gapSeconds / 3600,
      });
    }
  };

  applyMetrics(anyUsageIndices, (row, values) => {
    row.any_app_new_engage_30s = values.engage30;
    row.any_app_new_engage_custom = values.engageCustom;
    row.any_app_switched_app = values.switched;
    row.any_app_usage_time_gap_hours = values.gapHours;
  });
  applyMetrics(validUsageIndices, (row, values) => {
    row.valid_app_new_engage_30s = values.engage30;
    row.valid_app_new_engage_custom = values.engageCustom;
    row.valid_app_switched_app = values.switched;
    row.valid_app_usage_time_gap_hours = values.gapHours;
  });

  return nextRows;
}

function markAppUsageFlags(rows: CanonicalRow[], options: BrowserProcessingOptions): CanonicalRow[] {
  const gapThresholds = [...options.longDataTimeGapThresholds].sort((a, b) => b - a);
  const durationThresholds = [...options.longUsageDurationThresholds].sort((a, b) => b - a);
  return rows.map((row) => {
    const flags: string[] = [];
    const gapLabel = gapThresholds.find((threshold) => row.data_time_gap_hours >= threshold);
    if (gapLabel != null) {
      flags.push(`>${gapLabel}-HR TIME GAP`);
    }
    const durationHours = row.duration_minutes == null ? 0 : row.duration_minutes / 60;
    const durationLabel = durationThresholds.find((threshold) => durationHours >= threshold);
    if (durationLabel != null) {
      flags.push(`>${durationLabel}-HR APP USAGE`);
    }
    return {
      ...row,
      any_app_usage_flags: flags.length ? `['${flags.join("', '")}']` : "[]",
    };
  });
}

function clearFilteredUsageTiming(rows: CanonicalRow[]): CanonicalRow[] {
  return rows.map((row) =>
    row.interaction_type === "Filtered App Usage"
      ? {
          ...row,
          start_timestamp_ns: null,
          stop_timestamp_ns: null,
          duration_seconds: null,
          duration_minutes: null,
        }
      : row,
  );
}

function removeSelectedInteractionTypes(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
): CanonicalRow[] {
  if (!options.interactionTypesToRemove.length) {
    return rows;
  }
  const threshold = Math.min(...options.longDataTimeGapThresholds);
  const removeSet = new Set(options.interactionTypesToRemove);
  return rows.filter(
    (row) =>
      !removeSet.has(row.interaction_type) || row.data_time_gap_hours >= threshold,
  );
}

function buildAppOutputColumns(
  options: BrowserProcessingOptions,
  includeCodebookAliases: boolean,
): string[] {
  const includeCodebookColumns = options.useAppCodebook;
  return [
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "event_timestamp",
    "date",
    "timezone",
    "app_package_name",
    "application_label",
    ...(includeCodebookColumns ? ["genreId_scraped"] : []),
    ...(includeCodebookColumns && includeCodebookAliases ? ["broad_app_category"] : []),
    ...(includeCodebookColumns ? CODEBOOK_OUTPUT_COLUMNS : []),
    "interaction_type",
    "start_timestamp",
    "stop_timestamp",
    "duration_seconds",
    "duration_minutes",
    "any_app_usage_flags",
    "data_time_gap_hours",
    "day",
    "weekdayMF",
    "weekdayMTh",
    "weekdaySuTh",
    "hour",
    "quarter",
    "valid_app_new_engage_30s",
    `valid_app_new_engage_custom_${options.customAppEngagementDuration}s`,
    "valid_app_switched_app",
    "valid_app_usage_time_gap_hours",
    "any_app_new_engage_30s",
    `any_app_new_engage_custom_${options.customAppEngagementDuration}s`,
    "any_app_switched_app",
    "any_app_usage_time_gap_hours",
    "preprocessor_version",
    "datetime_of_preprocessing",
  ];
}

function buildScreenOutputColumns(): string[] {
  return [
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "event_timestamp",
    "date",
    "timezone",
    "app_package_name",
    "application_label",
    "interaction_type",
    "start_timestamp",
    "stop_timestamp",
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason",
    "screen_usage_end_reason_confidence",
    "screen_usage_stop_event_type",
    "screen_usage_last_activity_timestamp",
    "screen_usage_tail_gap_seconds",
    "screen_usage_foreground_app_package",
    "screen_usage_keep_awake_app_label",
    "screen_usage_lock_screen_only",
    "data_time_gap_hours",
    "day",
    "weekdayMF",
    "weekdayMTh",
    "weekdaySuTh",
    "hour",
    "quarter",
    "preprocessor_version",
    "datetime_of_preprocessing",
  ];
}

function rowToAppCsvRecord(
  row: CanonicalRow,
  options: BrowserProcessingOptions,
  includeCodebookAliases: boolean,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    study_id: row.study_id,
    participant_id: row.participant_id,
    possible_device_model: row.possible_device_model,
    username: row.username,
    event_timestamp: formatEventTimestamp(row.event_timestamp_ns, row.timezone),
    date: row.date,
    timezone: row.timezone,
    app_package_name: row.app_package_name,
    application_label: row.application_label,
    genreId_scraped: row.genreId_scraped ?? "",
    interaction_type: row.interaction_type,
    start_timestamp: formatSessionTimestamp(row.start_timestamp_ns, row.timezone),
    stop_timestamp: formatSessionTimestamp(row.stop_timestamp_ns, row.timezone),
    duration_seconds: formatCsvNumber(row.duration_seconds, { floatStyle: true }),
    duration_minutes: formatCsvNumber(row.duration_minutes, { floatStyle: true }),
    any_app_usage_flags: row.any_app_usage_flags,
    data_time_gap_hours: formatCsvNumber(row.data_time_gap_hours, { floatStyle: true }),
    day: row.day,
    weekdayMF: row.weekdayMF,
    weekdayMTh: row.weekdayMTh,
    weekdaySuTh: row.weekdaySuTh,
    hour: row.hour,
    quarter: row.quarter,
    valid_app_new_engage_30s: row.valid_app_new_engage_30s,
    [`valid_app_new_engage_custom_${options.customAppEngagementDuration}s`]:
      row.valid_app_new_engage_custom,
    valid_app_switched_app: row.valid_app_switched_app,
    valid_app_usage_time_gap_hours: formatCsvNumber(row.valid_app_usage_time_gap_hours, {
      floatStyle: true,
    }),
    any_app_new_engage_30s: row.any_app_new_engage_30s,
    [`any_app_new_engage_custom_${options.customAppEngagementDuration}s`]:
      row.any_app_new_engage_custom,
    any_app_switched_app: row.any_app_switched_app,
    any_app_usage_time_gap_hours: formatCsvNumber(row.any_app_usage_time_gap_hours, {
      floatStyle: true,
    }),
    preprocessor_version: row.preprocessor_version,
    datetime_of_preprocessing: row.datetime_of_preprocessing,
  };
  if (includeCodebookAliases) {
    record.broad_app_category = row.broad_app_category ?? "";
  }
  CODEBOOK_OUTPUT_COLUMNS.forEach((column) => {
    record[column] = formatCsvScalar(
      (row as unknown as Record<string, string | number | boolean | null | undefined>)[column],
    );
  });
  return record;
}

function rowToScreenCsvRecord(row: CanonicalRow): Record<string, string | number | boolean> {
  return {
    study_id: row.study_id,
    participant_id: row.participant_id,
    possible_device_model: row.possible_device_model,
    username: row.username,
    event_timestamp: formatEventTimestamp(row.event_timestamp_ns, row.timezone),
    date: row.date,
    timezone: row.timezone,
    app_package_name: row.app_package_name,
    application_label: "",
    interaction_type: row.interaction_type,
    start_timestamp: formatScreenTimestamp(row.start_timestamp_ns, row.timezone),
    stop_timestamp: formatScreenTimestamp(row.stop_timestamp_ns, row.timezone),
    duration_seconds: formatCsvNumber(row.duration_seconds, { floatStyle: true }),
    duration_minutes: formatCsvNumber(row.duration_minutes, { floatStyle: true }),
    screen_usage_end_reason: row.screen_usage_end_reason ?? "",
    screen_usage_end_reason_confidence: formatCsvNumber(
      row.screen_usage_end_reason_confidence,
      { floatStyle: true },
    ),
    screen_usage_stop_event_type: row.screen_usage_stop_event_type ?? "",
    screen_usage_last_activity_timestamp: formatScreenLastActivityTimestamp(
      row.screen_usage_last_activity_timestamp_ns,
      row.timezone,
    ),
    screen_usage_tail_gap_seconds: formatCsvNumber(row.screen_usage_tail_gap_seconds, {
      floatStyle: true,
    }),
    screen_usage_foreground_app_package: row.screen_usage_foreground_app_package ?? "",
    screen_usage_keep_awake_app_label: row.screen_usage_keep_awake_app_label ?? "",
    screen_usage_lock_screen_only:
      row.screen_usage_lock_screen_only == null
        ? ""
        : Boolean(row.screen_usage_lock_screen_only),
    data_time_gap_hours: "",
    day: row.day,
    weekdayMF: row.weekdayMF,
    weekdayMTh: row.weekdayMTh,
    weekdaySuTh: row.weekdaySuTh,
    hour: row.hour,
    quarter: row.quarter,
    preprocessor_version: row.preprocessor_version,
    datetime_of_preprocessing: row.datetime_of_preprocessing,
  };
}

function toAppCsv(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
  includeCodebookAliases: boolean,
): string {
  if (!rows.length) {
    return "";
  }
  const columns = buildAppOutputColumns(options, includeCodebookAliases);
  const lines = [columns.join(",")];
  rows.forEach((row) => {
    const record = rowToAppCsvRecord(row, options, includeCodebookAliases);
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function toScreenCsv(rows: CanonicalRow[]): string {
  if (!rows.length) {
    return "";
  }
  const columns = buildScreenOutputColumns();
  const lines = [columns.join(",")];
  rows.forEach((row) => {
    const record = rowToScreenCsvRecord(row);
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function deriveOutputFileName(inputFileName: string, suffix: string): string {
  return inputFileName.replace(/\.csv$/i, "") + suffix;
}

export async function processRawCsvContent(
  inputFileName: string,
  csvText: string,
  incomingOptions: Partial<BrowserProcessingOptions> | undefined,
  supportFiles: BrowserSupportFiles | undefined,
  runMatcher: MatcherRunner,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  const emit = (stepKind: ProgressStepKind, percent: number) => {
    onProgress?.({ type: "step", fileName: inputFileName, stepKind, percent });
  };
  const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...incomingOptions };

  emit("parse", 0);
  const originalRows = parseRawRows(csvText, runtime);
  const originalRowCount = originalRows.length;
  const availableTimezones = Array.from(
    new Set(originalRows.map((row) => row.timezone).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
  emit("parse", 1);

  emit("timezone", 0);
  const { rows: timezoneHandledRows, timezone } = applyTimezoneHandling(originalRows, options);
  const deduped = dedupeExactRows(timezoneHandledRows);
  const duplicateCorrected = options.correctDuplicateEventTimestamps
    ? unalignDuplicateTimestamps(deduped, options)
    : deduped;
  let rows = markDataTimeGaps(duplicateCorrected);
  emit("timezone", 1);

  emit("filter", 0);
  let filterMap = new Map<string, Set<string>>();
  if (options.useFilterFile) {
    filterMap = buildFilterMap(
      await loadSupportRows(supportFiles?.filterFile, defaultAppsToFilterUrl),
    );
    rows = labelFilteredApps(rows, filterMap);
  }

  let keepAwakeMap = new Map<string, string>();
  if (options.useKeepAwakeAppsFile) {
    keepAwakeMap = buildKeepAwakeMap(
      await loadSupportRows(supportFiles?.keepAwakeAppsFile, defaultKeepAwakeAppsUrl),
    );
  }
  emit("filter", 1);

  const outputs: ProcessedOutputFileResult[] = [];
  let screenRows: CanonicalRow[] = [];
  if (options.usageSessionMode === "screen_usage" || options.usageSessionMode === "app_and_screen_usage") {
    emit("screen", 0);
    screenRows = deriveScreenUsageSessions(rows, options, keepAwakeMap);
    emit("screen", 1);
  }

  if (options.usageSessionMode === "screen_usage") {
    emit("output", 0);
    outputs.push({
      kind: "screen",
      outputFileName: deriveOutputFileName(inputFileName, " Screen Usage Automatically Preprocessed.csv"),
      csv: toScreenCsv(screenRows),
      rowCount: screenRows.length,
    });
    emit("output", 1);
    return {
      inputFileName,
      outputs,
      originalRowCount,
      processedRowCount: rows.length,
      availableTimezones,
      timezone,
      appRowCount: 0,
      screenRowCount: screenRows.length,
    };
  }

  emit("matcher", 0);
  rows = await runAppUsageAlgorithm(rows, options, runMatcher);
  emit("matcher", 1);

  emit("codebook", 0);
  let codebookMap = new Map<string, CodebookRecord>();
  if (options.useAppCodebook) {
    codebookMap = buildCodebookMap(
      await loadSupportRows(supportFiles?.appCodebookFile, defaultAppCodebookUrl),
    );
  }
  emit("codebook", 1);

  emit("enrich", 0);
  rows = enrichWithCodebookData(rows, options, codebookMap);
  rows = addAppUsageDetailColumns(rows, options);
  rows = markAppUsageFlags(rows, options);
  rows = clearFilteredUsageTiming(rows);
  rows = removeSelectedInteractionTypes(rows, options);
  emit("enrich", 1);

  emit("output", 0);
  const includeCodebookAliases = !(options.useAppCodebook && codebookMap.size > 0);
  outputs.push({
    kind: "app",
    outputFileName: deriveOutputFileName(inputFileName, " Automatically Preprocessed.csv"),
    csv: toAppCsv(rows, options, includeCodebookAliases),
    rowCount: rows.length,
  });
  if (options.usageSessionMode === "app_and_screen_usage") {
    outputs.push({
      kind: "screen",
      outputFileName: deriveOutputFileName(inputFileName, " Screen Usage Automatically Preprocessed.csv"),
      csv: toScreenCsv(screenRows),
      rowCount: screenRows.length,
    });
  }
  emit("output", 1);

  return {
    inputFileName,
    outputs,
    originalRowCount,
    processedRowCount: rows.length,
    availableTimezones,
    timezone,
    appRowCount: rows.length,
    screenRowCount: screenRows.length,
  };
}
