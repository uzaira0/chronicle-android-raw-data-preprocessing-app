import {
  BOOLEAN_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  NUMBER_BROWSER_OPTION_KEYS,
  NUMBER_ARRAY_BROWSER_OPTION_KEYS,
  RESEARCH_AXIS_BROWSER_OPTION_KEYS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
  STRING_BROWSER_OPTION_KEYS,
  STRING_ARRAY_BROWSER_OPTION_KEYS,
  TIMEZONE_HANDLING_VALUES,
  AGGREGATE_SHAPE_VALUES,
} from "@/lib/generatedContract";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { BrowserProcessingOptions, MethodProfileReceipt, MethodProfileReceipts, MethodReceiptInputUses } from "@/lib/types";
import { safeUuid } from "@/lib/uuid";
import {
  MAXIMUM_DURATION_VECTOR_KEYS,
  isCanonicalMaximumDurationThresholdNs,
  isValidMaximumDurationSelectionShape,
} from "@/lib/maximumDurationVector";

export const SETTINGS_STORAGE_KEY = "chronicle.processingOptions.v1";
const STORAGE_KEY = SETTINGS_STORAGE_KEY;
export const PRESETS_STORAGE_KEY = "chronicle.processingPresets.v1";
export const SETTINGS_SCHEMA_VERSION = 16;

/**
 * Values that WERE the shipped defaults before commit 93cc84c (2026-07-15,
 * "preprocessing-only defaults") and are no longer. Envelopes up to schema v11
 * stored the complete option set, so a browser that saved settings before that
 * date froze these values in as if the user had chosen them. A stored value
 * identical to the old default is one the user never chose, so migrating to
 * v12 drops it and the option adopts the current shipped default. A value that
 * differs was a deliberate choice and is kept verbatim.
 *
 * Settings persisted from v12 onward only carry the diff from the defaults, so
 * the drop applies only to an envelope older than v12
 * (`FIRST_DIFF_ENCODED_SCHEMA_VERSION`): a key a v12+ save holds is one the
 * researcher chose, even when its value equals an entry below, and it is kept
 * verbatim across every later schema bump. A default change after v12 still
 * needs an entry only for the pre-v12 full-option-set saves. v13 changed
 * `timezoneHandling` from `selected-filter` to `selected-convert`; a pre-v12
 * save froze `selected-filter` in as the default of the day, so it is listed
 * here and that save adopts the current default like the other three.
 */
const MINIMUM_USAGE_ZERO_DEPLOYED_AT = "2026-10-10T00:00:00.000Z";

const SUPERSEDED_DEFAULTS: readonly SupersededDefault[] = [
  // 93cc84cc, 2026-07-15T00:33:44-05:00. Settings schema v1 spans that date;
  // v2 (2026-08-05) is the first version entirely after it.
  { key: "useFilterFile", value: true, supersededAt: "2026-07-15T05:33:44.000Z", firstVersionAfter: 2 },
  { key: "minimumUsageDuration", value: 0, supersededAt: "2026-07-15T05:33:44.000Z", firstVersionAfter: 2 },
  { key: "proximityIntervalSeconds", value: 0, supersededAt: "2026-07-15T05:33:44.000Z", firstVersionAfter: 2 },
  // f7553c5c, 2026-08-28T08:43:43-05:00, which also introduced settings v13.
  { key: "timezoneHandling", value: "selected-filter", supersededAt: "2026-08-28T13:43:43.000Z", firstVersionAfter: 13 },
  // Contract v6: minimum usage is a cleaning step, so the default went 60 → 0.
  // The user ruled that saved presets, projects and configs holding 60 move to
  // 0 too. Every v15 record was written by a build whose default was 60;
  // `supersededAt` is the production deploy of the change.
  { key: "minimumUsageDuration", value: 60, supersededAt: MINIMUM_USAGE_ZERO_DEPLOYED_AT, firstVersionAfter: 16 },
];

type SupersededDefault = {
  key: string;
  /** The value that was the shipped default until `supersededAt`. */
  value: unknown;
  /** When the commit that changed the default landed (UTC). */
  supersededAt: string;
  /** The first settings schema version written only after that change. */
  firstVersionAfter: number;
};

/** The first schema whose envelope stores only the diff from the defaults. */
const FIRST_DIFF_ENCODED_SCHEMA_VERSION = 12;

type SettingsEnvelope = {
  schemaVersion: number;
  savedAt: string;
  /** Diff from the shipped defaults (schema v12+); full options in v1–v11. */
  options: Partial<BrowserProcessingOptions>;
  methodProfileReceipt?: MethodProfileReceipt;
  methodProfileReceipts?: MethodProfileReceipts;
};

export type SettingsPreset = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The settings schema its options were written under. Reading migrates
   * older options through {@link migrateSavedOptionSet} by this version or
   * else `updatedAt`, and stamps the current version.
   */
  schemaVersion: number;
  options: BrowserProcessingOptions;
  methodProfileReceipt?: MethodProfileReceipt;
};

type ConfigEnvelope = {
  schemaVersion: number;
  exportedAt: string;
  currentSettings: BrowserProcessingOptions;
  currentMethodProfileReceipt?: MethodProfileReceipt;
  presets: SettingsPreset[];
};

export type ImportedConfig = {
  options: BrowserProcessingOptions;
  methodProfileReceipt?: MethodProfileReceipt;
  presets: SettingsPreset[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type MethodReceiptValidation = typeof import("@/lib/methodReceiptValidation");

let receiptValidation: MethodReceiptValidation | null = null;
let receiptValidationLoad: Promise<MethodReceiptValidation> | null = null;

/**
 * Receipt validation reads the method-profile registries, which are large
 * packed assets kept off the first-paint path. A receipt can only reach a
 * synchronous caller after this has resolved: main.tsx awaits it before the
 * first render when stored settings or presets hold a receipt, and every
 * asynchronous path that may bring one in (project load, config import,
 * another tab's write) awaits it first.
 */
export function loadMethodReceiptValidation(): Promise<MethodReceiptValidation> {
  receiptValidationLoad ??= import("@/lib/methodReceiptValidation").then(
    (module) => (receiptValidation = module),
    (error: unknown) => {
      // A failed chunk fetch (offline before the service worker cached it) is
      // retried by the next caller instead of being remembered.
      receiptValidationLoad = null;
      throw error;
    },
  );
  return receiptValidationLoad;
}

/** Thrown when a receipt reaches validation before its registries loaded. */
export class MethodReceiptValidationNotLoadedError extends Error {
  constructor() {
    super("Method-profile receipt validation was used before loadMethodReceiptValidation() resolved");
    this.name = "MethodReceiptValidationNotLoadedError";
  }
}

function loadedMethodReceiptValidation(): MethodReceiptValidation {
  if (!receiptValidation) throw new MethodReceiptValidationNotLoadedError();
  return receiptValidation;
}

/**
 * A storage catch block that turns unreadable data into "none" must not turn
 * a missing validator into "no receipt": that would drop the receipt and the
 * next write would erase it.
 */
function rethrowIfValidationNotLoaded(error: unknown): void {
  if (error instanceof MethodReceiptValidationNotLoadedError) throw error;
}

const NO_METHOD_RECEIPT_INPUT_USES: MethodReceiptInputUses = {
  inputCapabilityEvidence: false,
  analysisFeatureMatrix: false,
  callSmsEligibility: false,
  phoneStudyPsCommunication: false,
  phoneStudyEs: false,
  anchorEvents: false,
};

/** Which optional support inputs the active receipt's settings require. */
export function methodReceiptInputUses(settingIds: readonly string[]): MethodReceiptInputUses {
  return settingIds.length
    ? loadedMethodReceiptValidation().methodReceiptInputUses(settingIds)
    : NO_METHOD_RECEIPT_INPUT_USES;
}

/** Whether a stored or imported JSON text carries a method-profile receipt. */
export function textHoldsMethodReceipt(raw: string | null): boolean {
  return raw !== null && raw.includes('"methodProfileReceipt');
}

/**
 * Resolves once the stored preset library can be read: at once when it holds
 * no receipt, else after receipt validation has loaded. Another tab can store
 * a preset with a receipt at any time, so a read-modify-write of the library
 * waits on this instead of assuming the boot-time check still holds.
 */
export function presetLibraryReadable(): Promise<unknown> {
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(PRESETS_STORAGE_KEY);
  } catch {
    // Blocked storage: the library reads as unavailable, nothing to validate.
  }
  return textHoldsMethodReceipt(raw) ? loadMethodReceiptValidation() : Promise.resolve();
}

/** Whether the stored settings or preset library hold a receipt to validate. */
export function storedDataHoldsMethodReceipt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return textHoldsMethodReceipt(window.localStorage.getItem(STORAGE_KEY))
      || textHoldsMethodReceipt(window.localStorage.getItem(PRESETS_STORAGE_KEY));
  } catch {
    // Blocked storage: the readers see nothing either, so nothing to validate.
    return false;
  }
}

export function sanitizeMethodProfileReceipt(value: unknown): MethodProfileReceipt | undefined {
  if (!isRecord(value)) return undefined;
  return loadedMethodReceiptValidation().validateMethodProfileReceiptRecord(value);
}

export function methodProfileReceiptMatchesOptions(receipt: MethodProfileReceipt, options: BrowserProcessingOptions): boolean {
  const optionKeys = new Set<string>(BROWSER_PROCESSING_OPTION_KEYS);
  return receipt.bindings.every(({ slot, value }) => {
    const optionKey = slot.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
    return optionKeys.has(optionKey) && JSON.stringify(options[optionKey as keyof BrowserProcessingOptions]) === JSON.stringify(value);
  });
}

function sanitizeMethodProfileReceipts(
  value: unknown,
  options: BrowserProcessingOptions,
): MethodProfileReceipts | undefined {
  const source = isRecord(value) && "methodProfileId" in value
    ? (value.diaryReplicationBinding === undefined ? { android: value } : { sleepDiary: value })
    : value;
  if (!isRecord(source) || Object.keys(source).some((key) => key !== "android" && key !== "sleepDiary")) return undefined;
  const android = source.android === undefined ? undefined : sanitizeMethodProfileReceipt(source.android);
  const sleepDiary = source.sleepDiary === undefined ? undefined : sanitizeMethodProfileReceipt(source.sleepDiary);
  if ((source.android !== undefined && (!android || android.diaryReplicationBinding))
    || (source.sleepDiary !== undefined && (!sleepDiary || !sleepDiary.diaryReplicationBinding))) return undefined;
  return {
    ...(android && methodProfileReceiptMatchesOptions(android, options) ? { android } : {}),
    ...(sleepDiary ? { sleepDiary } : {}),
  };
}

/** A stored record's own version, else the version of what it came in. */
function recordSchemaVersion(record: Record<string, unknown>, fallback: number): number {
  return typeof record.schemaVersion === "number" && Number.isFinite(record.schemaVersion)
    ? record.schemaVersion
    : fallback;
}

function sanitizePreset(
  preset: Record<string, unknown>,
  now: string,
): SettingsPreset {
  // A preset is a full option set saved at its `updatedAt`; the library's own
  // version is re-stamped by every preset action, so it says nothing about
  // when this preset's options were written.
  const options = migrateSavedOptionSet(preset.options, {
    ...(typeof preset.schemaVersion === "number" ? { schemaVersion: preset.schemaVersion } : {}),
    savedAt: preset.updatedAt ?? preset.createdAt,
  });
  const receipt = sanitizeMethodProfileReceipt(preset.methodProfileReceipt);
  return {
    id: typeof preset.id === "string" ? preset.id : safeUuid(),
    name: typeof preset.name === "string" ? preset.name : "Imported preset",
    createdAt: typeof preset.createdAt === "string" ? preset.createdAt : now,
    updatedAt: typeof preset.updatedAt === "string" ? preset.updatedAt : now,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options,
    ...(receipt && methodProfileReceiptMatchesOptions(receipt, options) ? { methodProfileReceipt: receipt } : {}),
  };
}

/**
 * Threshold lists are positive hours; the kernel takes fractional hours
 * (f64), so 1.5 is valid. Only real numbers count: null is not 0.
 */
function numberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const next = value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry > 0,
  );
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

  // Backward compat: convert legacy usageSessionMode enum to independent booleans.
  if ("usageSessionMode" in source && !("processAppUsage" in source) && !("processScreenUsage" in source)) {
    const mode = source.usageSessionMode;
    next.processAppUsage = mode !== "screen_usage";
    next.processScreenUsage = mode === "screen_usage" || mode === "app_and_screen_usage";
  }

  const src = source;
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
  if (
    typeof src.timezoneHandling === "string" &&
    !TIMEZONE_HANDLING_VALUES.includes(
      src.timezoneHandling as (typeof TIMEZONE_HANDLING_VALUES)[number],
    )
  ) {
    next.timezoneHandling = DEFAULT_BROWSER_OPTIONS.timezoneHandling;
  }
  if (!(AGGREGATE_SHAPE_VALUES as readonly unknown[]).includes(next.aggregateShape)) {
    next.aggregateShape = DEFAULT_BROWSER_OPTIONS.aggregateShape;
  }
  // Every published-method/research axis is a closed ontology vocabulary.
  // Keep this generated and exhaustive so an old, malformed, or hand-edited
  // settings/project/last-run/share envelope can never retain an unknown arm.
  for (const key of RESEARCH_AXIS_BROWSER_OPTION_KEYS) {
    const candidate = src[key];
    const allowed = RESEARCH_AXIS_VALUES_BY_OPTION[key] as readonly string[];
    if (typeof candidate !== "string" || !allowed.includes(candidate)) {
      (next as Record<string, unknown>)[key] = DEFAULT_BROWSER_OPTIONS[key];
    }
  }
  for (const key of STRING_ARRAY_BROWSER_OPTION_KEYS) {
    (next as Record<string, unknown>)[key] = stringArray(src[key], DEFAULT_BROWSER_OPTIONS[key]);
  }
  // parallelMaxWorkers has unique semantics (optional, positive-only) so stays explicit.
  next.parallelMaxWorkers = optionalPositiveInteger(src.parallelMaxWorkers);
  // B06: the four selection keys are optional and travel as a set. A saved
  // vector that is present but not one of the five legal shapes is returned
  // to omission together with the legacy-origin marker, never repaired into
  // an explicit `strategy_native` (`invalid_present_b06_vector_sanitized_to_omission`).
  if (!isCanonicalMaximumDurationThresholdNs(next.maximumDurationThresholdNs)) {
    delete next.maximumDurationThresholdNs;
  }
  if (!isValidMaximumDurationSelectionShape(next)) {
    for (const key of MAXIMUM_DURATION_VECTOR_KEYS) delete next[key];
    delete next.longDurationThresholdHoursExplicit;
  }
  if (next.longDurationThresholdHoursExplicit !== true) {
    delete next.longDurationThresholdHoursExplicit;
  }
  for (const key of MAXIMUM_DURATION_VECTOR_KEYS) {
    if (next[key] === undefined) delete next[key];
  }
  // The contract declares this an integer in [0, 3600], and a stored envelope
  // has to satisfy it. Repair it toward the value that was actually saved
  // rather than discarding it: a 5000 that came back as the 60 s default sent
  // the settings panel, the presets, the last-run options and the saved
  // project off in a direction the researcher never chose, and made the
  // "options used for the last run" panel disagree with the Rust receipt.
  // Out-of-contract values are refused at input instead (`integerRangeError`).
  // Each of these three starts at its contract default and is only ever
  // overwritten by the NUMBER_BROWSER_OPTION_KEYS loop above, which already
  // refuses anything that is not a finite number — so a saved NaN, Infinity or
  // string keeps the default without any further check here, and what remains
  // is the range repair.
  if (!Number.isSafeInteger(next.minimumUsageDuration) ||
    next.minimumUsageDuration < 0 ||
    next.minimumUsageDuration > 3600
  ) {
    next.minimumUsageDuration = Math.min(3600, Math.max(0, Math.round(next.minimumUsageDuration)));
  }

  // B09's two cadence numbers are contract floats with a declared range. Clamp
  // rather than discard, for the same reason `minimumUsageDuration` clamps: a
  // saved 7200 that came back as the 10 s default would silently re-derive the
  // emulated channel at a cadence the researcher never chose, and the "options
  // used for the last run" panel would disagree with the Rust receipt.
  next.polledEmulationIntervalSeconds = Math.min(
    3600,
    Math.max(1, next.polledEmulationIntervalSeconds),
  );
  next.polledEmulationGapSeconds = Math.min(3600, Math.max(0, next.polledEmulationGapSeconds));

  return next;
}

function unwrapOptions(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("options" in value) return value.options;
  return value;
}

/** Strip the stored values `wasDefault` says the app, not the user, put there. */
function dropSupersededDefaults(
  stored: unknown,
  wasDefault: (entry: SupersededDefault) => boolean,
): unknown {
  if (!isRecord(stored)) return stored;
  const next = { ...stored };
  for (const entry of SUPERSEDED_DEFAULTS) {
    if (entry.key in next && next[entry.key] === entry.value && wasDefault(entry)) delete next[entry.key];
  }
  return next;
}

/**
 * Migration of the active-settings envelope, given the schema version it was
 * written under. Below v12 the envelope held the full option set, and every
 * load rewrote it with the then-current version and a fresh `savedAt`, so
 * neither says when a value was first written: a value equal to a superseded
 * default is taken as one the app put there and adopts the current default.
 * From v12 on the envelope holds only chosen values, which are kept.
 * sanitizeOptions then drops unknown keys and repairs or defaults every value
 * against the current contract.
 */
export function migrateStoredOptions(
  stored: unknown,
  schemaVersion: number,
): BrowserProcessingOptions {
  return sanitizeOptions(
    schemaVersion < FIRST_DIFF_ENCODED_SCHEMA_VERSION ? dropSupersededDefaults(stored, () => true) : stored,
  );
}

/**
 * Migration of a full option set saved once and never rewritten in place — a
 * preset, a project, an exported config. A value equal to a superseded
 * default was the app's default (not the user's choice) only if it was saved
 * before that default changed. The record's own schema version decides when
 * it is one written after the change; otherwise its save time does. With
 * neither, nothing is dropped: the record is kept as saved.
 */
export function migrateSavedOptionSet(
  stored: unknown,
  saved: { schemaVersion?: number; savedAt?: unknown },
): BrowserProcessingOptions {
  const savedAt = typeof saved.savedAt === "string" && !Number.isNaN(Date.parse(saved.savedAt))
    ? new Date(saved.savedAt).toISOString()
    : undefined;
  return sanitizeOptions(dropSupersededDefaults(stored, (entry) => {
    if (saved.schemaVersion !== undefined && saved.schemaVersion >= entry.firstVersionAfter) return false;
    if (savedAt !== undefined) return savedAt < entry.supersededAt;
    return saved.schemaVersion !== undefined;
  }));
}

export function readPersistedOptions(): BrowserProcessingOptions {
  if (typeof window === "undefined") {
    return { ...DEFAULT_BROWSER_OPTIONS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BROWSER_OPTIONS };
    const parsed = JSON.parse(raw) as unknown;
    const schemaVersion =
      isRecord(parsed) && typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0;
    const stale = schemaVersion < SETTINGS_SCHEMA_VERSION;
    const stored = unwrapOptions(parsed);
    // Contract v2 changed workflow identity, v3 turned
    // `includeAppUsageEndReason` on by default, v4 added closed B03/B04/B05
    // research axes, and v5 added the optional B06 maximum-duration keys
    // (an old envelope stays omitted; it is never upgraded to an explicit
    // selection). v10 added B09's polled-method emulation, whose method is a
    // closed axis and whose two cadence numbers clamp into the contract
    // range. v12 switched storage to the diff from the shipped defaults.
    //
    // Two things make a stale save adopt a current default. An option key that
    // is absent takes the default straight from sanitizeOptions — that is how
    // a pre-v3 save picks up `includeAppUsageEndReason`. A key that is present
    // but holds a value the app itself put there, back when that value was the
    // default, is dropped here so it behaves the same way. Only a pre-v12 save
    // stored the full option set; a v12+ save holds a key only because the
    // researcher chose it, so its values are never dropped.
    const options = migrateStoredOptions(stored, schemaVersion);
    if (stale) {
      // Rewriting through the live sanitizer completes the migration and drops
      // stale or unknown option keys. Best-effort: a readable store can still
      // be quota-limited or read-only, and the settings stay valid either way.
      const receipts = sanitizeMethodProfileReceipts(
        isRecord(parsed) ? parsed.methodProfileReceipts ?? parsed.methodProfileReceipt : undefined,
        options,
      );
      persistOptions(options, receipts);
    }
    return options;
  } catch (error) {
    rethrowIfValidationNotLoaded(error);
    // Blocked storage or a garbled envelope reads as the defaults.
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

export function readPersistedMethodProfileReceipt(): MethodProfileReceipt | null {
  const receipts = readPersistedMethodProfileReceipts();
  return receipts.android ?? receipts.sleepDiary ?? null;
}

export function readPersistedMethodProfileReceipts(): MethodProfileReceipts {
  if (typeof window === "undefined") return {};
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage holds no usable receipt.
    return {};
  }
  return storedSettingsReceipts(raw);
}

/**
 * The receipts one stored settings value holds, each checked against that
 * value's own options. Another tab's write is read from its event value, not
 * from storage, which this tab may have overwritten since.
 */
export function storedSettingsReceipts(raw: string | null): MethodProfileReceipts {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeMethodProfileReceipts(
      isRecord(parsed) ? parsed.methodProfileReceipts ?? parsed.methodProfileReceipt : undefined,
      storedEnvelopeOptions(raw) ?? { ...DEFAULT_BROWSER_OPTIONS },
    ) ?? {};
  } catch (error) {
    rethrowIfValidationNotLoaded(error);
    // A garbled envelope holds no usable receipt.
    return {};
  }
}

/**
 * The result of a settings write. Callers report success only on `ok`; the
 * reason is the browser's own message (quota exhausted, storage disabled).
 */
export type PersistOutcome = { ok: true } | { ok: false; reason: string };

const NO_BROWSER_STORAGE: PersistOutcome = {
  ok: false,
  reason: "browser storage is unavailable",
};

function persistFailure(error: unknown): PersistOutcome {
  return {
    ok: false,
    reason: error instanceof Error ? error.message : String(error),
  };
}

export function persistOptions(
  options: BrowserProcessingOptions,
  methodProfileReceipts?: MethodProfileReceipt | MethodProfileReceipts | null,
): PersistOutcome {
  if (typeof window === "undefined") return NO_BROWSER_STORAGE;
  try {
    const receipts = sanitizeMethodProfileReceipts(methodProfileReceipts, options);
    // Store only what the user changed. Options left alone are absent, so they
    // keep tracking the shipped defaults instead of pinning the values that
    // happened to be default on the day the settings were first saved.
    const envelope: SettingsEnvelope = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      options: diffOptionsFromDefaults(options),
      ...(receipts && (receipts.android || receipts.sleepDiary)
        ? { methodProfileReceipts: receipts }
        : {}),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch (error) {
    rethrowIfValidationNotLoaded(error);
    // Storage can be unavailable in private contexts or full. The settings
    // still apply in memory; the caller tells the user they were not saved.
    return persistFailure(error);
  }
}

export function readPersistedPresets(): SettingsPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const presets = isRecord(parsed) && Array.isArray(parsed.presets) ? (parsed.presets as unknown) : parsed;
    // Each preset migrates by its own version or save time (sanitizePreset);
    // one written before presets carried a version is stale.
    const sanitized = sanitizePresets(presets);
    const stale = Array.isArray(presets) && presets.some((preset) =>
      !isRecord(preset) || recordSchemaVersion(preset, 0) < SETTINGS_SCHEMA_VERSION);
    // Rewrite a migrated library like stale settings are rewritten; best
    // effort, the migrated presets apply either way.
    if (stale) persistPresets(sanitized);
    return sanitized;
  } catch (error) {
    rethrowIfValidationNotLoaded(error);
    // Unreadable stored presets read as none. The library is rewritten only
    // by an explicit preset action, which then replaces the garbled value.
    return [];
  }
}

/**
 * The preset library as stored right now, for a read-modify-write; null when
 * storage cannot be read or holds something that is not a preset library (the
 * caller then falls back to its own copy, which its write replaces it with).
 */
export function readStoredPresetLibrary(): SettingsPreset[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) && !(isRecord(parsed) && Array.isArray(parsed.presets))) return null;
    return readPersistedPresets();
  } catch (error) {
    rethrowIfValidationNotLoaded(error);
    // Blocked storage or a garbled value: the caller's own copy is the base.
    return null;
  }
}

/** The options a stored settings envelope holds, migrated; null if unreadable. */
function storedEnvelopeOptions(raw: string | null): BrowserProcessingOptions | null {
  if (raw === null) return { ...DEFAULT_BROWSER_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const version = isRecord(parsed) ? recordSchemaVersion(parsed, 0) : 0;
    return migrateStoredOptions(unwrapOptions(parsed), version);
  } catch {
    // A value this version cannot parse is not a change it can merge.
    return null;
  }
}

function storedEnvelopeReceipts(raw: string | null): string {
  try {
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    return JSON.stringify(isRecord(parsed) ? parsed.methodProfileReceipts ?? parsed.methodProfileReceipt ?? null : null);
  } catch {
    // Unparseable: compares unequal to any readable value.
    return "unreadable";
  }
}

/** Keys that are only valid together (B06), so they merge as one. */
const GROUPED_OPTION_KEYS: readonly (readonly string[])[] = [
  [...MAXIMUM_DURATION_VECTOR_KEYS, "longDurationThresholdHoursExplicit"],
];

/**
 * Another tab wrote the settings (a `storage` event: `oldValue` → `newValue`).
 * Apply exactly what that write changed to this tab's options and keep every
 * other option as this tab has it, so neither tab silently undoes the other.
 * Returns `local` itself when nothing changes for this tab, and null when the
 * write is unreadable or a removal (another tab deleted all local data; this
 * tab keeps its settings until it reloads).
 */
export function mergeStoredSettingsChange(
  local: BrowserProcessingOptions,
  oldValue: string | null,
  newValue: string | null,
): BrowserProcessingOptions | null {
  if (newValue === null) return null;
  const before = storedEnvelopeOptions(oldValue) ?? { ...DEFAULT_BROWSER_OPTIONS };
  const after = storedEnvelopeOptions(newValue);
  if (!after) return null;
  const changed = (key: string): boolean =>
    JSON.stringify((before as Record<string, unknown>)[key]) !==
    JSON.stringify((after as Record<string, unknown>)[key]);
  const next: Record<string, unknown> = { ...local };
  const grouped = new Set(GROUPED_OPTION_KEYS.flat());
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
    if (!grouped.has(key) && changed(key)) next[key] = (after as Record<string, unknown>)[key];
  }
  for (const group of GROUPED_OPTION_KEYS) {
    if (!group.some(changed)) continue;
    for (const key of group) {
      if ((after as Record<string, unknown>)[key] === undefined) delete next[key];
      else next[key] = (after as Record<string, unknown>)[key];
    }
  }
  const merged = sanitizeOptions(next);
  return JSON.stringify(merged) === JSON.stringify(local) ? local : merged;
}

/** Whether another tab's settings write changed the stored method receipts. */
export function storedReceiptsChanged(oldValue: string | null, newValue: string): boolean {
  return storedEnvelopeReceipts(oldValue) !== storedEnvelopeReceipts(newValue);
}

export function persistPresets(presets: SettingsPreset[]): PersistOutcome {
  if (typeof window === "undefined") return NO_BROWSER_STORAGE;
  try {
    window.localStorage.setItem(
      PRESETS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        presets,
      }),
    );
    return { ok: true };
  } catch (error) {
    return persistFailure(error);
  }
}

/**
 * Preset names are unique case-insensitively (savePreset asks before
 * overwriting a same-named preset), and ids key deletion. An imported or
 * stored list that breaks either keeps every preset: a repeated name gets a
 * " (2)", " (3)"… suffix and a repeated id a fresh one, so nothing is lost
 * and no two presets can be confused.
 */
function sanitizePresets(value: unknown): SettingsPreset[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  const names = new Set<string>();
  const ids = new Set<string>();
  return value.filter(isRecord).map((entry) => {
    const preset = sanitizePreset(entry, now);
    let name = preset.name;
    for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) {
      name = `${preset.name} (${suffix})`;
    }
    names.add(name.toLowerCase());
    let id = preset.id;
    while (ids.has(id)) id = safeUuid();
    ids.add(id);
    return { ...preset, id, name };
  });
}

export function buildConfigExportBlob(
  options: BrowserProcessingOptions,
  presets: SettingsPreset[],
  methodProfileReceipt?: MethodProfileReceipt | null,
): Blob {
  const envelope: ConfigEnvelope = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    currentSettings: sanitizeOptions(options),
    ...(methodProfileReceipt && methodProfileReceiptMatchesOptions(methodProfileReceipt, options)
      ? { currentMethodProfileReceipt: methodProfileReceipt }
      : {}),
    presets,
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
}

export async function readConfigFile(file: File): Promise<ImportedConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error(
      "The selected file is not valid JSON. Make sure you're importing a Chronicle config file.",
    );
  }
  // Import replaces the active settings AND the whole preset library, so
  // anything that is not this app's own export envelope is refused rather
  // than read as "no settings, no presets", which reset every setting to its
  // default and erased every preset.
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.currentSettings) ||
    !Array.isArray(parsed.presets)
  ) {
    throw new Error(
      "This file is not a Chronicle config export (it has no \"currentSettings\" object and \"presets\" list). Nothing was changed. Use a file made with Export config.",
    );
  }
  const source = parsed;
  // An export carries the full option set under its own schema version, and
  // migrates exactly like stored settings and presets of that version.
  const exportedVersion = recordSchemaVersion(source, 0);
  if (source.currentMethodProfileReceipt !== undefined
    || (source.presets as unknown[]).some((preset) => isRecord(preset) && preset.methodProfileReceipt !== undefined)) {
    await loadMethodReceiptValidation();
  }
  // An export holds the full option set as of `exportedAt`, under its own
  // schema version, and is migrated like any other saved option set.
  const options = migrateSavedOptionSet(source.currentSettings, {
    schemaVersion: exportedVersion,
    savedAt: source.exportedAt,
  });
  const receipt = sanitizeMethodProfileReceipt(source.currentMethodProfileReceipt);
  return {
    options,
    ...(receipt && methodProfileReceiptMatchesOptions(receipt, options) ? { methodProfileReceipt: receipt } : {}),
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
  return diff;
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
