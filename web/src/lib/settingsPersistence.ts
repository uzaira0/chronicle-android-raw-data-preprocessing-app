import { BROWSER_PROCESSING_OPTION_KEYS } from "@/lib/generatedContract";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";

const STORAGE_KEY = "chronicle.processingOptions.v1";
const PRESETS_STORAGE_KEY = "chronicle.processingPresets.v1";
const SETTINGS_SCHEMA_VERSION = 1;

type SettingsEnvelope = {
  schemaVersion: number;
  savedAt: string;
  options: BrowserProcessingOptions;
};

export type SettingsPreset = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  options: BrowserProcessingOptions;
};

type ConfigEnvelope = {
  schemaVersion: number;
  exportedAt: string;
  currentSettings: BrowserProcessingOptions;
  presets: SettingsPreset[];
};

export type ImportedConfig = {
  options: BrowserProcessingOptions;
  presets: SettingsPreset[];
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
      case "useAppsForcingScreenOpenFile":
      case "useAppCodebook":
      case "enablePlotting":
      case "includeFilteredAppUsageInPlots":
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

export function hasPersistedOptions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
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

export function readPersistedPresets(): SettingsPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const presets = isRecord(parsed) && Array.isArray(parsed.presets) ? parsed.presets : parsed;
    if (!Array.isArray(presets)) return [];
    return presets
      .filter(isRecord)
      .map((preset) => ({
        id: typeof preset.id === "string" ? preset.id : crypto.randomUUID(),
        name: typeof preset.name === "string" ? preset.name : "Imported preset",
        createdAt: typeof preset.createdAt === "string" ? preset.createdAt : new Date().toISOString(),
        updatedAt: typeof preset.updatedAt === "string" ? preset.updatedAt : new Date().toISOString(),
        options: sanitizeOptions(preset.options),
      }));
  } catch {
    return [];
  }
}

export function persistPresets(presets: SettingsPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PRESETS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        presets,
      }),
    );
  } catch {
    // Ignore storage failures; the app keeps working without persisted presets.
  }
}

function sanitizePresets(value: unknown): SettingsPreset[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  return value.filter(isRecord).map((preset) => ({
    id: typeof preset.id === "string" ? preset.id : crypto.randomUUID(),
    name: typeof preset.name === "string" ? preset.name : "Imported preset",
    createdAt: typeof preset.createdAt === "string" ? preset.createdAt : now,
    updatedAt: typeof preset.updatedAt === "string" ? preset.updatedAt : now,
    options: sanitizeOptions(preset.options),
  }));
}

export function buildConfigExportBlob(
  options: BrowserProcessingOptions,
  presets: SettingsPreset[],
): Blob {
  const envelope: ConfigEnvelope = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    currentSettings: sanitizeOptions(options),
    presets,
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
}

export async function readConfigFile(file: File): Promise<ImportedConfig> {
  const parsed = JSON.parse(await file.text());
  const source = isRecord(parsed) ? parsed : {};
  return {
    options: sanitizeOptions(source.currentSettings),
    presets: sanitizePresets(source.presets),
  };
}
