import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";

const DB_NAME = "chronicle-last-run";
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
    request.onerror = () => reject(request.error);
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
          reject(transaction.error);
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
    results: input.results,
    discoveredTimezones: input.discoveredTimezones,
  };
  await runStore("readwrite", (store) => store.put(record));
}

export async function loadLastRun(): Promise<LastRunRecord | undefined> {
  const record = await runStore<LastRunRecord | undefined>("readonly", (store) =>
    store.get(LAST_RUN_ID),
  );
  if (!record || record.schemaVersion !== SCHEMA_VERSION || !record.results.length) {
    return undefined;
  }
  return record;
}

export async function clearLastRun(): Promise<void> {
  await runStore("readwrite", (store) => store.delete(LAST_RUN_ID));
}
