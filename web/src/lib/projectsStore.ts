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

import type { BrowserProcessingOptions } from "@/lib/types";

const DB_NAME = "chronicle-projects";
const STORE = "projects";
const DB_VERSION = 1;

export type StoredFile = { name: string; blob: Blob };

export type SupportFileSlot =
  | "filterFile"
  | "appsForcingScreenOpenFile"
  | "backgroundAppsFile"
  | "appCodebookFile";

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  options: BrowserProcessingOptions;
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

export async function saveProject(record: ProjectRecord): Promise<void> {
  await runStore("readwrite", (store) => store.put(record));
}

export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  return runStore<ProjectRecord | undefined>("readonly", (store) => store.get(id));
}

export async function deleteProject(id: string): Promise<void> {
  await runStore("readwrite", (store) => store.delete(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await runStore<ProjectRecord[]>("readonly", (store) => store.getAll());
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
  rawFiles: readonly File[];
  supportFiles: Partial<Record<SupportFileSlot, File | null>>;
  includeFiles: boolean;
}): ProjectRecord {
  const { id, name, now, options, rawFiles, supportFiles, includeFiles } = input;
  const support: Partial<Record<SupportFileSlot, StoredFile>> = {};
  if (includeFiles) {
    for (const [slot, file] of Object.entries(supportFiles) as [SupportFileSlot, File | null][]) {
      if (file) support[slot] = { name: file.name, blob: file };
    }
  }
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    options,
    includesFiles: includeFiles,
    rawFileNames: rawFiles.map((file) => file.name),
    rawFiles: includeFiles ? rawFiles.map((file) => ({ name: file.name, blob: file })) : [],
    supportFiles: support,
  };
}

/** Rehydrate a stored blob into a `File` (preserving the name). */
export function storedFileToFile(stored: StoredFile): File {
  return new File([stored.blob], stored.name);
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
