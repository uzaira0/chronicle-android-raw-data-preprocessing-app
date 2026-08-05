import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
} from "@/lib/types";

export const LAST_RUN_DB_NAME = "chronicle-workflow-last-run-v1";
export const LAST_RUN_DB_VERSION = 1;
export const LAST_RUN_STORE_NAME = "lastRun";
export const LAST_RUN_RECORD_ID = "last";
export const LAST_RUN_SCHEMA_VERSION = 1;
const LEGACY_LAST_RUN_DB_NAME = "chronicle-last-run";
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
      }),
  );
}

export async function saveLastRun(input: {
  options: BrowserProcessingOptions;
  results: ProcessedFileResult[];
  discoveredTimezones: string[];
  savedAt?: string;
}): Promise<void> {
  const record: LastRunRecord = {
    id: LAST_RUN_ID,
    schemaVersion: SCHEMA_VERSION,
    savedAt: input.savedAt ?? new Date().toISOString(),
    options: input.options,
    // Persist only the lightweight shape — never the multi-hundred-MB artifacts.
    results: toLightweightResults(input.results),
    discoveredTimezones: input.discoveredTimezones,
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

export async function loadLastRun(): Promise<LastRunRecord | undefined> {
  if (hasDeletedFence()) {
    await runStore("readwrite", (store) => store.delete(LAST_RUN_ID)).catch(
      () => {},
    );
    return undefined;
  }
  let record: LastRunRecord | undefined;
  try {
    record = await runStore<LastRunRecord | undefined>(
      "readonly",
      (store) =>
        store.get(LAST_RUN_ID) as IDBRequest<LastRunRecord | undefined>,
    );
  } catch {
    // A corrupt/unreadable record would otherwise throw on every boot. Self-heal:
    // clear it and start fresh rather than wedging the app.
    await clearLastRun().catch(() => {});
    return undefined;
  }
  if (!record) {
    return undefined;
  }
  if (record.schemaVersion !== SCHEMA_VERSION || !record.results.length) {
    // Stale (old schema) or empty record: clear it so it doesn't sit in IndexedDB
    // forever being re-read and counting against quota on every boot.
    await clearLastRun().catch(() => {});
    return undefined;
  }
  return record;
}

export async function clearLastRun(): Promise<void> {
  // The synchronous fence closes the click-then-immediate-reload race while
  // the IndexedDB deletion is still committing.
  setDeletedFence(true);
  await runStore("readwrite", (store) => store.delete(LAST_RUN_ID));
}
