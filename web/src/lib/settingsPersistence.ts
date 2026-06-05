import {
  BOOLEAN_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  NUMBER_BROWSER_OPTION_KEYS,
  NUMBER_ARRAY_BROWSER_OPTION_KEYS,
  STRING_BROWSER_OPTION_KEYS,
  STRING_ARRAY_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";
import { CANONICAL_INTERACTION_TYPES, parseInteractionRemap } from "@/lib/interactionTypes";
import { safeUuid } from "@/lib/uuid";

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

const CANONICAL_INTERACTION_TYPE_SET = new Set<string>(CANONICAL_INTERACTION_TYPES);

/**
 * Drop a restored `interactionTypeRemap` entry only when it forms an *active*
 * mapping (one `parseInteractionRemap` inserts) whose target is NOT a canonical
 * interaction type — exactly the set the editor's <select> offers. This blocks a
 * share-link / preset / project entry like "VENDOR => BogusType" the editor could
 * never produce, which otherwise maps events to an inert type AND suppresses the
 * pre-flight "unrecognized interaction type" warning (false reassurance). Inert
 * in-progress rows (no delimiter, or an empty side) are kept so the editor's
 * mid-edit round-trip stays intact. Reusing the real parser keeps this in lockstep
 * with how the pipeline interprets the same entries.
 */
function isValidRemapEntry(entry: string): boolean {
  for (const target of parseInteractionRemap([entry]).values()) {
    if (!CANONICAL_INTERACTION_TYPE_SET.has(target)) return false;
  }
  return true;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

export function sanitizeOptions(value: unknown): BrowserProcessingOptions {
  const source = isRecord(value) ? value : {};
  const next: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS };

  // Backward compat: convert legacy usageSessionMode enum to independent booleans.
  if ("usageSessionMode" in source && !("processAppUsage" in source) && !("processScreenUsage" in source)) {
    const mode = source.usageSessionMode;
    next.processAppUsage = mode !== "screen_usage";
    next.processScreenUsage = mode === "screen_usage" || mode === "app_and_screen_usage";
  }

  const src = source as Record<string, unknown>;
  for (const key of BOOLEAN_BROWSER_OPTION_KEYS) {
    if (typeof src[key] === "boolean") (next as Record<string, unknown>)[key] = src[key];
  }
  for (const key of NUMBER_BROWSER_OPTION_KEYS) {
    if (typeof src[key] === "number" && Number.isFinite(src[key])) (next as Record<string, unknown>)[key] = src[key];
  }
  for (const key of NUMBER_ARRAY_BROWSER_OPTION_KEYS) {
    (next as Record<string, unknown>)[key] = numberArray(src[key], DEFAULT_BROWSER_OPTIONS[key]);
  }
  for (const key of STRING_BROWSER_OPTION_KEYS) {
    if (typeof src[key] === "string") (next as Record<string, unknown>)[key] = src[key];
  }
  for (const key of STRING_ARRAY_BROWSER_OPTION_KEYS) {
    (next as Record<string, unknown>)[key] = stringArray(src[key], DEFAULT_BROWSER_OPTIONS[key]);
  }
  // parallelMaxWorkers has unique semantics (optional, positive-only) so stays explicit.
  next.parallelMaxWorkers = optionalPositiveInteger(src.parallelMaxWorkers);

  // Reject restored remap entries whose target isn't a canonical interaction type
  // (the editor's <select> can't produce these; a hand-crafted config could).
  next.interactionTypeRemap = next.interactionTypeRemap.filter(isValidRemapEntry);

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
        id: typeof preset.id === "string" ? preset.id : safeUuid(),
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
    id: typeof preset.id === "string" ? preset.id : safeUuid(),
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

// ---------------------------------------------------------------------------
// Shareable config via URL (#23)
// ---------------------------------------------------------------------------

/** URL query parameter that carries a shared settings payload. */
export const SHARED_CONFIG_PARAM = "config";

/**
 * The subset of options that differ from the defaults. Keeping only the diff
 * makes share links short and forward-compatible: keys added to the schema
 * later simply fall back to their defaults when an older link is opened.
 */
export function diffOptionsFromDefaults(
  options: BrowserProcessingOptions,
): Partial<BrowserProcessingOptions> {
  const sanitized = sanitizeOptions(options) as Record<string, unknown>;
  const defaults = DEFAULT_BROWSER_OPTIONS as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
    if (JSON.stringify(sanitized[key]) !== JSON.stringify(defaults[key])) {
      diff[key] = sanitized[key];
    }
  }
  return diff as Partial<BrowserProcessingOptions>;
}

/** Encode options (diff from defaults) into a URL-param string value. */
export function encodeOptionsToParam(options: BrowserProcessingOptions): string {
  return JSON.stringify(diffOptionsFromDefaults(options));
}

/** Decode a URL-param string back to full options, or null if invalid. */
export function decodeOptionsFromParam(param: string | null): BrowserProcessingOptions | null {
  if (!param) return null;
  try {
    return sanitizeOptions(JSON.parse(param));
  } catch {
    return null;
  }
}

/**
 * Build a shareable URL from `baseUrl`, replacing any existing config param so
 * re-sharing stays clean.
 */
export function buildShareableConfigUrl(
  options: BrowserProcessingOptions,
  baseUrl: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set(SHARED_CONFIG_PARAM, encodeOptionsToParam(options));
  return url.toString();
}

/** Read a shared config from a `location.search` string, or null if absent/invalid. */
export function readSharedConfig(search: string): BrowserProcessingOptions | null {
  try {
    return decodeOptionsFromParam(new URLSearchParams(search).get(SHARED_CONFIG_PARAM));
  } catch {
    return null;
  }
}
