import * as Comlink from "comlink";
import Papa from "papaparse";
import type {
  BrowserProcessingOptions,
  MatcherInput,
  MatcherOutput,
  ProcessedFileResult,
  RawChronicleRow,
} from "@/lib/types";

type CanonicalRow = {
  studyId: string;
  participantId: string;
  possibleDeviceModel: string;
  username: string;
  applicationLabel: string;
  interactionType: string;
  appPackageName: string;
  eventTimestampNs: bigint;
  timezone: string;
  dataTimeGapHours: number;
};

const DEFAULT_OPTIONS: BrowserProcessingOptions = {
  allowStopEventReuse: false,
  useActivityStoppedAsFallback: true,
  applyThresholdToFallback: true,
  longDurationThresholdHours: 12,
  correctDuplicateEventTimestamps: true,
  selectedTimezone: "",
  timezoneHandling: "primary-filter",
};

const INTERACTION_TYPES_MAP: Record<string, string> = {
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

const SAME_STOP_TYPES = new Set(["Activity Paused", "Activity Resumed"]);
const OTHER_STOP_TYPES = new Set([
  "Activity Resumed",
  "Filtered App Resumed",
  "Filtered App Usage",
  "Device Shutdown",
]);

let initPromise: Promise<void> | null = null;

function requireString(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

function normalizeInteractionType(value: string): string {
  return INTERACTION_TYPES_MAP[value] ?? value;
}

function parseChronicleTimestampNs(value: string): bigint {
  const text = value.trim();
  if (!text) {
    throw new Error("Missing event_timestamp");
  }
  const explicitTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(text);
  const isoText = explicitTimezone
    ? text.replace(" ", "T")
    : `${text.replace(" ", "T")}Z`;
  const milliseconds = Date.parse(isoText);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`Invalid event_timestamp: ${value}`);
  }
  return BigInt(milliseconds) * 1_000_000n;
}

function dominantTimezone(rows: CanonicalRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.timezone) continue;
    counts.set(row.timezone, (counts.get(row.timezone) ?? 0) + 1);
  }
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
  if (options.timezoneHandling === "selected-filter" && selected) {
    return {
      rows: rows.filter((row) => row.timezone === selected),
      timezone: selected,
    };
  }
  if (options.timezoneHandling === "selected-convert" && selected) {
    return {
      rows: rows.map((row) => ({ ...row, timezone: selected })),
      timezone: selected,
    };
  }
  return {
    rows: rows.filter((row) => row.timezone === primary),
    timezone: primary,
  };
}

function dedupeExactRows(rows: CanonicalRow[]): CanonicalRow[] {
  const seen = new Set<string>();
  const deduped: CanonicalRow[] = [];
  for (const row of rows) {
    const key = `${row.eventTimestampNs}|${row.interactionType}|${row.appPackageName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function duplicatePriority(interactionType: string): number {
  const normalized = interactionType === "Screen Non-interactive" ? "Screen Non-Interactive" : interactionType;
  if (normalized === "Activity Resumed") {
    return 0;
  }
  if (SAME_STOP_TYPES.has(normalized) || OTHER_STOP_TYPES.has(normalized)) {
    return normalized === "Activity Resumed" ? 0 : 2;
  }
  return 1;
}

function unalignDuplicateTimestamps(rows: CanonicalRow[]): CanonicalRow[] {
  if (rows.length <= 1) return rows;
  const adjusted = [...rows];
  let hasDuplicates = false;
  for (let index = 1; index < adjusted.length; index += 1) {
    if (adjusted[index].eventTimestampNs <= adjusted[index - 1].eventTimestampNs) {
      hasDuplicates = true;
      break;
    }
  }
  if (!hasDuplicates) return adjusted;

  let start = 0;
  while (start < adjusted.length) {
    let end = start + 1;
    while (
      end < adjusted.length &&
      adjusted[end].eventTimestampNs === adjusted[start].eventTimestampNs
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
          priority: duplicatePriority(row.interactionType),
        }))
        .sort((left, right) =>
          left.priority === right.priority ? left.localIndex - right.localIndex : left.priority - right.priority,
        );

      ordered.forEach((entry, orderedIndex) => {
        const delta = BigInt(count - orderedIndex) * 1_000n;
        entry.row.eventTimestampNs -= delta;
      });
    }
    start = end;
  }

  return adjusted.sort((left, right) =>
    left.eventTimestampNs < right.eventTimestampNs ? -1 : left.eventTimestampNs > right.eventTimestampNs ? 1 : 0,
  );
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

function buildMatcherInput(rows: CanonicalRow[], options: BrowserProcessingOptions): MatcherInput {
  const appPackages = rows.map((row) => row.appPackageName);
  const interactionTypes = rows.map((row) => row.interactionType);
  return {
    appCodes: stableFactorize(appPackages),
    timestampNs: BigInt64Array.from(rows.map((row) => row.eventTimestampNs)),
    resumed: Uint8Array.from(interactionTypes.map((value) => (value === "Activity Resumed" ? 1 : 0))),
    sameStop: Uint8Array.from(interactionTypes.map((value) => (SAME_STOP_TYPES.has(value) ? 1 : 0))),
    otherStop: Uint8Array.from(interactionTypes.map((value) => (OTHER_STOP_TYPES.has(value) ? 1 : 0))),
    stopped: Uint8Array.from(interactionTypes.map((value) => (value === "Activity Stopped" ? 1 : 0))),
    options: {
      allowStopEventReuse: options.allowStopEventReuse,
      useActivityStoppedAsFallback: options.useActivityStoppedAsFallback,
      applyThresholdToFallback: options.applyThresholdToFallback,
      longDurationThresholdNs: BigInt(Math.round(options.longDurationThresholdHours * 3_600_000_000_000)),
    },
  };
}

function decimalHours(diffNs: bigint): number {
  return Number(diffNs) / 3_600_000_000_000;
}

function decimalSeconds(diffNs: bigint): number {
  return Number(diffNs) / 1_000_000_000;
}

function formatDateTimeParts(timestampNs: bigint, timeZone: string): Record<string, string> {
  const date = new Date(Number(timestampNs / 1_000_000n));
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
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return map;
}

function formatEventTimestamp(timestampNs: bigint, timeZone: string): string {
  const parts = formatDateTimeParts(timestampNs, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatSessionTimestamp(timestampNs: bigint, timeZone: string): string {
  const parts = formatDateTimeParts(timestampNs, timeZone);
  return `${parts.month}-${parts.day}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function buildFlags(dataTimeGapHours: number, durationHours: number): string {
  const flags: string[] = [];
  for (let threshold = 12; threshold >= 1; threshold -= 1) {
    if (dataTimeGapHours >= threshold) {
      flags.push(`>${threshold}-HR TIME GAP`);
      break;
    }
  }
  for (let threshold = 12; threshold >= 1; threshold -= 1) {
    if (durationHours >= threshold) {
      flags.push(`>${threshold}-HR APP USAGE`);
      break;
    }
  }
  return flags.length ? JSON.stringify(flags) : "[]";
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) {
    return "";
  }
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function ensureInit(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    await module.default();
  })();
  return initPromise;
}

async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureInit();
  const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
  return module.matchAppUsageUpdateIndices(
    input.appCodes,
    input.timestampNs,
    input.resumed,
    input.sameStop,
    input.otherStop,
    input.stopped,
    input.options.allowStopEventReuse,
    input.options.useActivityStoppedAsFallback,
    input.options.applyThresholdToFallback,
    input.options.longDurationThresholdNs,
  ) as MatcherOutput;
}

function parseRawRows(csvText: string): CanonicalRow[] {
  const parsed = Papa.parse<RawChronicleRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Failed to parse CSV");
  }
  return parsed.data
    .filter((row: RawChronicleRow) => requireString(row.event_timestamp).length > 0)
    .map((row: RawChronicleRow) => ({
      studyId: requireString(row.study_id),
      participantId: requireString(row.participant_id),
      possibleDeviceModel: requireString(row.possible_device_model),
      username: requireString(row.username),
      applicationLabel: requireString(row.application_label),
      interactionType: normalizeInteractionType(requireString(row.interaction_type)),
      appPackageName: requireString(row.app_package_name),
      eventTimestampNs: parseChronicleTimestampNs(requireString(row.event_timestamp)),
      timezone: requireString(row.timezone, "UTC") || "UTC",
      dataTimeGapHours: 0,
    }))
    .sort((left: CanonicalRow, right: CanonicalRow) =>
      left.eventTimestampNs < right.eventTimestampNs ? -1 : left.eventTimestampNs > right.eventTimestampNs ? 1 : 0,
    );
}

function markDataTimeGaps(rows: CanonicalRow[]): CanonicalRow[] {
  if (!rows.length) return rows;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    return {
      ...row,
      dataTimeGapHours: previous ? Number(decimalHours(row.eventTimestampNs - previous.eventTimestampNs).toFixed(2)) : 0,
    };
  });
}

function preprocessCanonicalRows(
  rows: CanonicalRow[],
  options: BrowserProcessingOptions,
): { rows: CanonicalRow[]; timezone: string } {
  const timezoneHandled = applyTimezoneHandling(rows, options);
  const deduped = dedupeExactRows(timezoneHandled.rows);
  const duplicateCorrected = options.correctDuplicateEventTimestamps
    ? unalignDuplicateTimestamps(deduped)
    : deduped;
  return {
    rows: markDataTimeGaps(duplicateCorrected),
    timezone: timezoneHandled.timezone,
  };
}

function buildProcessedRows(
  rows: CanonicalRow[],
  matcherOutput: MatcherOutput,
  timezone: string,
): Array<Record<string, string | number>> {
  const startByRow = new Map<number, bigint>();
  const stopByStartRow = new Map<number, bigint>();
  const missingRows = new Set<number>(matcherOutput.missingIndices);

  matcherOutput.startIndices.forEach((startIndex) => {
    startByRow.set(startIndex, rows[startIndex]!.eventTimestampNs);
  });
  matcherOutput.stopStartIndices.forEach((startIndex, position) => {
    const stopEventIndex = matcherOutput.stopEventIndices[position]!;
    stopByStartRow.set(startIndex, rows[stopEventIndex]!.eventTimestampNs);
  });

  const outputRows: Array<Record<string, string | number>> = [];
  rows.forEach((row, index) => {
    if (row.interactionType === "Activity Paused") {
      return;
    }

    if (row.interactionType !== "Activity Resumed") {
      return;
    }

    const startNs = startByRow.get(index);
    const stopNs = stopByStartRow.get(index);
    if (startNs === undefined || stopNs === undefined) {
      return;
    }

    const durationSeconds = Number(decimalSeconds(stopNs - startNs).toFixed(2));
    const durationMinutes = Number((durationSeconds / 60).toFixed(2));
    const durationHours = durationSeconds / 3600;
    const eventTimestamp = formatEventTimestamp(row.eventTimestampNs, timezone);
    const eventParts = formatDateTimeParts(row.eventTimestampNs, timezone);
    const weekday = new Date(Number(row.eventTimestampNs / 1_000_000n)).getUTCDay();
    const dayOfWeek = weekday === 0 ? 7 : weekday;
    outputRows.push({
      study_id: row.studyId,
      participant_id: row.participantId,
      possible_device_model: row.possibleDeviceModel,
      username: row.username,
      event_timestamp: eventTimestamp,
      date: `${eventParts.year}-${eventParts.month}-${eventParts.day}`,
      timezone,
      app_package_name: row.appPackageName,
      application_label: row.applicationLabel,
      interaction_type: missingRows.has(index) ? "End of Usage Missing" : "App Usage",
      start_timestamp: formatSessionTimestamp(startNs, timezone),
      stop_timestamp: formatSessionTimestamp(stopNs, timezone),
      duration_seconds: durationSeconds,
      duration_minutes: durationMinutes,
      any_app_usage_flags: buildFlags(row.dataTimeGapHours, durationHours),
      data_time_gap_hours: row.dataTimeGapHours,
      day: dayOfWeek,
      weekdayMF: dayOfWeek < 6 ? 1 : 0,
      weekdayMTh: dayOfWeek < 5 ? 1 : 0,
      weekdaySuTh: dayOfWeek < 5 || dayOfWeek === 7 ? 1 : 0,
      hour: Number(eventParts.hour),
      quarter: Math.floor(Number(eventParts.hour) / 6) + 1,
      preprocessor_version: "web-prototype",
      datetime_of_preprocessing: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  });

  return outputRows;
}

function deriveOutputFileName(inputFileName: string): string {
  return inputFileName.replace(/\.csv$/i, "") + " Automatically Preprocessed.csv";
}

const api = {
  async matcherVersion(): Promise<string> {
    await ensureInit();
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    return module.matcherVersion();
  },
  async processRawCsv(
    inputFileName: string,
    csvText: string,
    incomingOptions?: Partial<BrowserProcessingOptions>,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = { ...DEFAULT_OPTIONS, ...incomingOptions };
    const canonicalRows = parseRawRows(csvText);
    const originalRowCount = canonicalRows.length;
    const processed = preprocessCanonicalRows(canonicalRows, options);
    const matcherInput = buildMatcherInput(processed.rows, options);
    const matcherOutput = await runMatcher(matcherInput);
    const outputRows = buildProcessedRows(processed.rows, matcherOutput, processed.timezone);
    return {
      inputFileName,
      outputFileName: deriveOutputFileName(inputFileName),
      csv: toCsv(outputRows),
      sessionCount: outputRows.length,
      originalRowCount,
      processedRowCount: processed.rows.length,
      timezone: processed.timezone,
    };
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
