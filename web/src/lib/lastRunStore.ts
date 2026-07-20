import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";

export const LAST_RUN_DB_NAME = "chronicle-last-run";
const DB_NAME = LAST_RUN_DB_NAME;
const STORE = "lastRun";
const DB_VERSION = 1;
const LAST_RUN_ID = "last";
const SCHEMA_VERSION = 1;

export type LastRunRecord = {
  id: typeof LAST_RUN_ID;
  schemaVersion: number;
  savedAt: string;
  options: BrowserProcessingOptions;
  results: ProcessedFileResult[];
  discoveredTimezones: string[];
};

/**
 * Strip a run's heavy artifacts before persisting it. The output-file bytes
 * (`outputs[].blob`, Parquet/SPSS/CSV) and the per-session timeline geometry
 * (`timelineView`) are the bulk of a result and are exactly what makes a big
 * batch blow past memory/quota — both when writing the cache and, worse, when
 * the whole record is rehydrated into memory on the next boot. We keep only the
 * scalars and the compact `reviewSummary`, and flag the result so the UI can
 * explain that downloads/timeline need a re-run.
 */
export function toLightweightResults(
  results: ProcessedFileResult[],
): ProcessedFileResult[] {
  return results.map((result) => ({
    ...result,
    outputs: [],
    timelineView: undefined,
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
    request.onerror = () => reject(request.error instanceof Error ? request.error : new Error(String(request.error)));
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
          reject(transaction.error instanceof Error ? transaction.error : new Error(String(transaction.error)));
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
  } catch (error) {
    // A failed put (quota exhaustion is the common case) must not leave a
    // half/over-sized record behind that wedges the next boot — drop it so the
    // app starts clean next time. Re-throw so the caller can surface pressure.
    await clearLastRun().catch(() => {});
    throw error;
  }
}

export async function loadLastRun(): Promise<LastRunRecord | undefined> {
  let record: LastRunRecord | undefined;
  try {
    record = await runStore<LastRunRecord | undefined>("readonly", (store) =>
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
  await runStore("readwrite", (store) => store.delete(LAST_RUN_ID));
}
