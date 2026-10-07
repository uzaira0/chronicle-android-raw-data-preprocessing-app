import { sanitizeOptions } from "@/lib/settingsPersistence";
import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
} from "@/lib/types";

export const LAST_RUN_DB_NAME = "chronicle-workflow-last-run-v1";
export const LAST_RUN_DB_VERSION = 1;
export const LAST_RUN_STORE_NAME = "lastRun";
export const LAST_RUN_RECORD_ID = "last";
export const LAST_RUN_SCHEMA_VERSION = 1;
export const LEGACY_LAST_RUN_DB_NAME = "chronicle-last-run";
const DB_NAME = LAST_RUN_DB_NAME;
const STORE = LAST_RUN_STORE_NAME;
const DB_VERSION = LAST_RUN_DB_VERSION;
const LAST_RUN_ID = LAST_RUN_RECORD_ID;
const SCHEMA_VERSION = LAST_RUN_SCHEMA_VERSION;
const LAST_RUN_DELETED_FENCE = "chronicle-workflow-last-run-deleted-v1";

function setDeletedFence(deleted: boolean): void {
  try {
    if (deleted) localStorage.setItem(LAST_RUN_DELETED_FENCE, "1");
    else localStorage.removeItem(LAST_RUN_DELETED_FENCE);
  } catch {
    // IndexedDB remains authoritative when storage is unavailable or full.
  }
}

function hasDeletedFence(): boolean {
  try {
    return localStorage.getItem(LAST_RUN_DELETED_FENCE) === "1";
  } catch {
    return false;
  }
}

export type LastRunRecord = {
  id: typeof LAST_RUN_ID;
  schemaVersion: number;
  savedAt: string;
  options: BrowserProcessingOptions;
  results: ProcessedFileResult[];
  discoveredTimezones: string[];
  /**
   * How many files the batch set out to process, and how many did not produce a
   * result. A cancelled or partly failed batch is restored as an incomplete run,
   * not as a clean one: without these the restored rows are indistinguishable
   * from a complete batch of `results.length` files. Optional so records written
   * before these fields existed still load instead of being discarded; absent
   * means "no shortfall information", which restores exactly as it used to.
   */
  attemptedFileCount?: number;
  unfinishedFileNames?: string[];
};

export type LegacyLastRunState = {
  detected: boolean;
  detectionSupported: boolean;
};

/**
 * Detect the retired pre-workflow last-run database without opening, reading,
 * upgrading, or deleting it. Browsers without IDBFactory.databases() provide
 * no safe existence probe, so they deliberately report detection as
 * unsupported instead of falling back to indexedDB.open().
 */
export async function detectLegacyLastRunState(
  suppliedFactory?: IDBFactory,
): Promise<LegacyLastRunState> {
  const factory =
    suppliedFactory ??
    (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory || typeof factory.databases !== "function") {
    return { detected: false, detectionSupported: false };
  }
  try {
    const databases = await factory.databases();
    return {
      detected: databases.some(
        ({ name }) => name === LEGACY_LAST_RUN_DB_NAME,
      ),
      detectionSupported: true,
    };
  } catch {
    // Enumeration can be denied in private/restricted contexts. Do not probe
    // by opening the legacy name because that would create or mutate it.
    return { detected: false, detectionSupported: false };
  }
}

/**
 * Strip a run's heavy artifacts before persisting it. The output-file bytes
 * (`outputs[].blob`, Parquet/SPSS/CSV) and the per-session timeline geometry
 * (`timelineView`) are the bulk of a result and are exactly what makes a big
 * batch blow past memory/quota — both when writing the cache and, worse, when
 * the whole record is rehydrated into memory on the next boot. We keep only the
 * scalars, receipt-pinned OPFS output references, and runtime receipt. The View
 * tab reloads its selected review summary from that exact OPFS root — but only
 * when OPFS persistence actually succeeded (`persistedGeneration` set). When it
 * did not (Safari without locks, quota denial), the compact `reviewSummary` is
 * the researcher's only copy, so it is retained; stripping it would delete
 * their data on the next save. The raw JSON bytes are always dropped. Browser
 * Static plot blobs and timeline geometry are omitted. Small root-pinned
 * requests are retained so both can be rebuilt from the verified Rust artifact.
 */
export function toLightweightResults(
  results: ProcessedFileResult[],
): ProcessedFileResult[] {
  return results.map((result) => ({
    ...result,
    outputs: result.outputs.filter((output) => output.persistedArtifact),
    timelineView: undefined,
    reviewSummary:
      result.rustRuntimeReceipt?.persistedGeneration !== undefined
        ? undefined
        : result.reviewSummary,
    reviewSummaryJsonBytes: undefined,
    restoredWithoutArtifacts: true,
  }));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error(String(request.error)),
      );
  });
}

function runStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(
            transaction.error instanceof Error
              ? transaction.error
              : new Error(String(transaction.error)),
          );
        };
        // A commit the browser aborts (quota exhausted while committing)
        // fires no request error. Without this the promise never settled,
        // and a caller awaiting a save stayed "running" forever.
        transaction.onabort = () => {
          db.close();
          reject(
            transaction.error instanceof Error
              ? transaction.error
              : new Error("The browser aborted the saved-run write."),
          );
        };
      }),
  );
}

// A locator only: source tables and verified receipts remain in the existing OPFS workspace.
export async function saveLastComponentManifest(manifestJson: string): Promise<void> {
  await runStore("readwrite", (store) => store.put({ id: "component", manifestJson }));
}

export async function loadLastComponentManifest(): Promise<string | undefined> {
  const record = await runStore<{ manifestJson?: unknown } | undefined>("readonly", (store) =>
    store.get("component") as IDBRequest<{ manifestJson?: unknown } | undefined>);
  if (record === undefined) return undefined;
  if (typeof record.manifestJson !== "string") throw new Error("Saved component locator is invalid");
  return record.manifestJson;
}

export async function clearLastComponentManifest(): Promise<void> {
  await runStore("readwrite", (store) => store.delete("component"));
}

export async function saveResearchMethodSelection(selectionJson: string): Promise<void> {
  await runStore("readwrite", (store) => store.put({ id: "research-selection", selectionJson }));
}

export async function loadResearchMethodSelection(): Promise<string | undefined> {
  const record = await runStore<{ selectionJson?: unknown } | undefined>("readonly", (store) =>
    store.get("research-selection") as IDBRequest<{ selectionJson?: unknown } | undefined>);
  if (!record) return undefined;
  if (typeof record.selectionJson !== "string") throw new Error("Saved research selection is invalid");
  return record.selectionJson;
}

export async function saveLastRun(input: {
  options: BrowserProcessingOptions;
  results: ProcessedFileResult[];
  discoveredTimezones: string[];
  attemptedFileCount?: number;
  unfinishedFileNames?: string[];
  savedAt?: string;
}): Promise<void> {
  const record: LastRunRecord = {
    id: LAST_RUN_ID,
    schemaVersion: SCHEMA_VERSION,
    savedAt: input.savedAt ?? new Date().toISOString(),
    options: sanitizeOptions(input.options),
    // Persist only the lightweight shape — never the multi-hundred-MB artifacts.
    results: toLightweightResults(input.results),
    discoveredTimezones: input.discoveredTimezones,
    attemptedFileCount: input.attemptedFileCount ?? input.results.length,
    unfinishedFileNames: input.unfinishedFileNames ?? [],
  };
  try {
    await runStore("readwrite", (store) => store.put(record));
    setDeletedFence(false);
  } catch (error) {
    // A failed put (quota exhaustion is the common case) must not leave a
    // half/over-sized record behind that wedges the next boot — drop it so the
    // app starts clean next time. Re-throw so the caller can surface pressure.
    await clearLastRun().catch(() => {});
    throw error;
  }
}

/**
 * Where a saved run that this version cannot reopen is kept: the same store,
 * one slot, overwritten by the next such run. "Clear cached run" and "Delete
 * all local data" delete the whole database, archive included.
 */
export const LAST_RUN_ARCHIVE_ID = "archived-last";

export type ArchivedLastRun = {
  id: typeof LAST_RUN_ARCHIVE_ID;
  archivedAt: string;
  reason: string;
  record: unknown;
};

/**
 * What the boot found in the last-run slot. A saved run is never deleted
 * because it could not be reopened: one this version cannot read is moved to
 * the archive slot (`archived`), and one that cannot even be read or moved is
 * left where it is (`kept`). Both are reported so the user can decide.
 */
export type LastRunLoadOutcome =
  | { status: "none" }
  | { status: "restored"; record: LastRunRecord }
  | { status: "archived"; reason: string }
  | { status: "kept"; reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unusableReason(record: { schemaVersion?: unknown; results?: unknown }): string | null {
  if (record.schemaVersion !== SCHEMA_VERSION) {
    return `it was saved in format ${String(record.schemaVersion)} and this version reads format ${SCHEMA_VERSION}`;
  }
  if (!Array.isArray(record.results)) return "it has no list of results";
  return null;
}

export async function loadLastRunOutcome(): Promise<LastRunLoadOutcome> {
  if (hasDeletedFence()) {
    // The user deleted this run (the fence closes the click-then-reload race);
    // finishing that deletion is the point, and a failure here is retried on
    // the next boot because the fence stays set until a new save.
    await runStore("readwrite", (store) => store.delete(LAST_RUN_ID)).catch(
      () => undefined,
    );
    return { status: "none" };
  }
  let record: LastRunRecord | undefined;
  try {
    record = await runStore<LastRunRecord | undefined>(
      "readonly",
      (store) =>
        store.get(LAST_RUN_ID) as IDBRequest<LastRunRecord | undefined>,
    );
  } catch (error) {
    // Unreadable now is not unreadable forever (another tab mid-upgrade, a
    // transient quota or I/O error). The record stays; the app keeps booting
    // and says so.
    return { status: "kept", reason: `it could not be read (${errorMessage(error)})` };
  }
  if (!record) {
    return { status: "none" };
  }
  const reason = unusableReason(record);
  if (reason !== null) {
    const archive: ArchivedLastRun = {
      id: LAST_RUN_ARCHIVE_ID,
      archivedAt: new Date().toISOString(),
      reason,
      record,
    };
    try {
      // One transaction: the copy is written and the slot emptied together,
      // so a failure leaves the original exactly where it was.
      await runStore("readwrite", (store) => {
        store.put(archive);
        return store.delete(LAST_RUN_ID);
      });
    } catch (error) {
      return { status: "kept", reason: `${reason}, and it could not be moved aside (${errorMessage(error)})` };
    }
    return { status: "archived", reason };
  }
  if (!record.results.length) {
    // An empty run holds nothing to lose: clear it so it is not re-read on
    // every boot. A failed clear just leaves it to the next boot.
    await clearLastRun().catch(() => undefined);
    return { status: "none" };
  }
  return { status: "restored", record: { ...record, options: sanitizeOptions(record.options) } };
}

/** The restorable last run, or undefined (see {@link loadLastRunOutcome}). */
export async function loadLastRun(): Promise<LastRunRecord | undefined> {
  const outcome = await loadLastRunOutcome();
  return outcome.status === "restored" ? outcome.record : undefined;
}

/** The archived run, if a boot moved one aside (inspection and tests). */
export async function loadArchivedLastRun(): Promise<ArchivedLastRun | undefined> {
  return runStore<ArchivedLastRun | undefined>(
    "readonly",
    (store) => store.get(LAST_RUN_ARCHIVE_ID) as IDBRequest<ArchivedLastRun | undefined>,
  );
}

export async function clearLastRun(): Promise<void> {
  // The synchronous fence closes the click-then-immediate-reload race while
  // the IndexedDB deletion is still committing.
  setDeletedFence(true);
  await runStore("readwrite", (store) => store.delete(LAST_RUN_ID));
}
