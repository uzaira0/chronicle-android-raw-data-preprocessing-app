/**
 * Named "projects" (#22): persist a full processing config — optionally with the
 * uploaded file set — to IndexedDB so a researcher can close the tab and resume.
 *
 * IndexedDB (not localStorage) because it stores Blobs natively and has far more
 * room. File blobs are **opt-in** per the quota/eviction risk on large cohorts:
 * by default a project stores only the config + file *names* (metadata); the user
 * can opt into bundling the actual file bytes. On restore, blobs are rehydrated
 * into `File` objects so the rest of the app (which reads `.name`) keeps working.
 */

import {
  loadMethodReceiptValidation,
  methodProfileReceiptMatchesOptions,
  migrateSavedOptionSet,
  sanitizeMethodProfileReceipt,
  sanitizeOptions,
  SETTINGS_SCHEMA_VERSION,
} from "@/lib/settingsPersistence";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  MethodProfileReceipt,
} from "@/lib/types";

export const PROJECTS_DB_NAME = "chronicle-projects";
const DB_NAME = PROJECTS_DB_NAME;
const STORE = "projects";
const DB_VERSION = 1;

export type StoredFile = { name: string; type?: string; lastModified?: number; blob: Blob };

export type SupportFileSlot = keyof BrowserSupportFiles;

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The settings schema version `options` were saved under. A record saved
   * before projects carried one is migrated by its `updatedAt` instead
   * (`migrateSavedOptionSet`).
   */
  schemaVersion: number;
  options: BrowserProcessingOptions;
  methodProfileReceipt?: MethodProfileReceipt;
  /** True when the actual file bytes are bundled (not just names). */
  includesFiles: boolean;
  /** Raw input file names — always stored as metadata. */
  rawFileNames: string[];
  /** Raw input file blobs — present only when `includesFiles`. */
  rawFiles: StoredFile[];
  /** Support file blobs by slot — present only when `includesFiles`. */
  supportFiles: Partial<Record<SupportFileSlot, StoredFile>>;
};

export type ProjectSummary = Pick<
  ProjectRecord,
  "id" | "name" | "createdAt" | "updatedAt" | "includesFiles" | "rawFileNames"
>;

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
        // A commit-phase quota failure aborts the transaction without a
        // request error: without this the save neither resolved nor rejected.
        transaction.onabort = () => {
          db.close();
          reject(transaction.error instanceof Error ? transaction.error : new Error("project transaction aborted"));
        };
      }),
  );
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  if (record.methodProfileReceipt !== undefined) await loadMethodReceiptValidation();
  const options = sanitizeOptions(record.options);
  const receipt = sanitizeMethodProfileReceipt(record.methodProfileReceipt);
  await runStore("readwrite", (store) => store.put({
    ...record,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options,
    ...(receipt && methodProfileReceiptMatchesOptions(receipt, options) ? { methodProfileReceipt: receipt } : { methodProfileReceipt: undefined }),
  }));
}

export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  const record = await runStore<ProjectRecord | undefined>(
    "readonly",
    (store) => store.get(id) as IDBRequest<ProjectRecord | undefined>,
  );
  if (!record) return undefined;
  if (record.methodProfileReceipt !== undefined) await loadMethodReceiptValidation();
  const options = migrateSavedOptionSet(record.options, {
    ...(typeof record.schemaVersion === "number" ? { schemaVersion: record.schemaVersion } : {}),
    savedAt: record.updatedAt,
  });
  const receipt = sanitizeMethodProfileReceipt(record.methodProfileReceipt);
  return {
    ...record,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options,
    ...(receipt && methodProfileReceiptMatchesOptions(receipt, options) ? { methodProfileReceipt: receipt } : { methodProfileReceipt: undefined }),
  };
}

export async function deleteProject(id: string): Promise<void> {
  await runStore("readwrite", (store) => store.delete(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await runStore<ProjectRecord[]>("readonly", (store) => store.getAll() as IDBRequest<ProjectRecord[]>);
  return records
    .map(({ id, name, createdAt, updatedAt, includesFiles, rawFileNames }) => ({
      id,
      name,
      createdAt,
      updatedAt,
      includesFiles,
      rawFileNames,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Pure builder for a project record from the current app state (testable). */
export function buildProjectRecord(input: {
  id: string;
  name: string;
  now: string;
  options: BrowserProcessingOptions;
  methodProfileReceipt?: MethodProfileReceipt | null;
  rawFiles: readonly File[];
  supportFiles: Partial<Record<SupportFileSlot, File | null>>;
  includeFiles: boolean;
}): ProjectRecord {
  const { id, name, now, options, methodProfileReceipt, rawFiles, supportFiles, includeFiles } = input;
  const sanitizedOptions = sanitizeOptions(options);
  const receipt = sanitizeMethodProfileReceipt(methodProfileReceipt);
  const support: Partial<Record<SupportFileSlot, StoredFile>> = {};
  if (includeFiles) {
    for (const [slot, file] of Object.entries(supportFiles) as [SupportFileSlot, File | null][]) {
      if (file)
        support[slot] = { name: file.name, type: file.type, lastModified: file.lastModified, blob: file };
    }
  }
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options: sanitizedOptions,
    ...(receipt && methodProfileReceiptMatchesOptions(receipt, sanitizedOptions) ? { methodProfileReceipt: receipt } : {}),
    includesFiles: includeFiles,
    rawFileNames: rawFiles.map((file) => file.name),
    rawFiles: includeFiles
      ? rawFiles.map((file) => ({
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
          blob: file,
        }))
      : [],
    supportFiles: support,
  };
}

/** Rehydrate a stored blob into a `File` (preserving name, MIME type, and mtime). */
export function storedFileToFile(stored: StoredFile): File {
  // Preserve the original MIME type and modified time so a rehydrated file is
  // indistinguishable from the uploaded one (e.g. type-based parser selection).
  return new File([stored.blob], stored.name, {
    type: stored.type ?? stored.blob.type,
    ...(stored.lastModified !== undefined ? { lastModified: stored.lastModified } : {}),
  });
}

/** Total bytes a save would persist (0 when files aren't bundled). */
export function projectByteSize(input: {
  rawFiles: readonly File[];
  supportFiles: Partial<Record<SupportFileSlot, File | null>>;
  includeFiles: boolean;
}): number {
  if (!input.includeFiles) return 0;
  let total = 0;
  for (const file of input.rawFiles) total += file.size;
  for (const file of Object.values(input.supportFiles)) if (file) total += file.size;
  return total;
}
