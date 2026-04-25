import { BROWSER_PROCESSING_OPTION_KEYS } from "@/lib/generatedContract";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";

const STORAGE_KEY = "chronicle.processingOptions.v1";
const SETTINGS_SCHEMA_VERSION = 1;

type SettingsEnvelope = {
  schemaVersion: number;
  savedAt: string;
  options: BrowserProcessingOptions;
};

const optionKeys = new Set<string>(BROWSER_PROCESSING_OPTION_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const next = value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  return next.length ? next : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

export function sanitizeOptions(value: unknown): BrowserProcessingOptions {
  const source = isRecord(value) ? value : {};
  const next: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS };

  for (const key of optionKeys) {
    if (!(key in source)) continue;
    const incoming = source[key];
    switch (key) {
      case "studyName":
      case "selectedTimezone":
      case "usageSessionMode":
      case "timezoneHandling":
        if (typeof incoming === "string") {
          (next as Record<string, unknown>)[key] = incoming;
        }
        break;
      case "allowStopEventReuse":
      case "useActivityStoppedAsFallback":
      case "applyThresholdToFallback":
      case "correctDuplicateEventTimestamps":
      case "useFilterFile":
      case "useKeepAwakeAppsFile":
      case "useAppCodebook":
      case "includeFilteredAppUsageInPlots":
      case "plotOnlyTargetChildData":
      case "parallelProcessing":
        if (typeof incoming === "boolean") {
          (next as Record<string, unknown>)[key] = incoming;
        }
        break;
      case "longDurationThresholdHours":
      case "minimumUsageDuration":
      case "customAppEngagementDuration":
      case "screenUsageAutoLockTimeoutSeconds":
      case "screenUsageAutoLockToleranceSeconds":
      case "screenUsageManualLockMaxTailGapSeconds":
      case "screenUsageKeyguardNearStopSeconds":
        if (typeof incoming === "number" && Number.isFinite(incoming)) {
          (next as Record<string, unknown>)[key] = incoming;
        }
        break;
      case "parallelMaxWorkers":
        next.parallelMaxWorkers = optionalPositiveInteger(incoming);
        break;
      case "longUsageDurationThresholds":
      case "longDataTimeGapThresholds":
        (next as Record<string, unknown>)[key] = numberArray(
          incoming,
          DEFAULT_BROWSER_OPTIONS[key],
        );
        break;
      case "sameAppInteractionTypesToStopUsageAt":
      case "otherInteractionTypesToStopUsageAt":
      case "interactionTypesToRemove":
        (next as Record<string, unknown>)[key] = stringArray(
          incoming,
          DEFAULT_BROWSER_OPTIONS[key],
        );
        break;
    }
  }

  return next;
}

function unwrapOptions(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("options" in value) return value.options;
  return value;
}

export function readPersistedOptions(): BrowserProcessingOptions {
  if (typeof window === "undefined") {
    return { ...DEFAULT_BROWSER_OPTIONS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BROWSER_OPTIONS };
    return sanitizeOptions(unwrapOptions(JSON.parse(raw)));
  } catch {
    return { ...DEFAULT_BROWSER_OPTIONS };
  }
}

export function persistOptions(options: BrowserProcessingOptions): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: SettingsEnvelope = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      options: sanitizeOptions(options),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage can be unavailable in private contexts; the app still works.
  }
}

export async function readOptionsFile(file: File): Promise<BrowserProcessingOptions> {
  return sanitizeOptions(unwrapOptions(JSON.parse(await file.text())));
}

export function buildOptionsExportBlob(options: BrowserProcessingOptions): Blob {
  const envelope: SettingsEnvelope = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    options: sanitizeOptions(options),
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
}
