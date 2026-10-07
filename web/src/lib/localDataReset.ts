/**
 * Wipe everything this app persisted in the browser: the boot-error recovery
 * and the footer's "Delete all local data" control both use it.
 *
 * Deliberately self-contained (no app-state imports beyond the storage-name
 * constants) so the boot-error "lifeboat" can call it even when the rest of
 * the app failed to initialise. Each step is independently guarded — a
 * failure in one (e.g. Cache Storage unavailable) must not stop the others —
 * and every failure is reported back, so a caller never claims a deletion
 * that did not happen.
 *
 * Scope: GitHub Pages serves several sites from one origin, and localStorage,
 * Cache Storage and service-worker registrations are shared across that
 * origin. Only this app's keys (all prefixed `chronicle`), its caches and its
 * own service-worker scope are touched, never another site's.
 */

import { LAST_RUN_DB_NAME, LEGACY_LAST_RUN_DB_NAME } from "@/lib/lastRunStore";
import { PROJECTS_DB_NAME } from "@/lib/projectsStore";
import {
  LEGACY_OPFS_DIRECTORIES,
  OPFS_CAPABILITY_PROBE_DIRECTORY,
  OPFS_PAYLOAD_SPILL_DIRECTORY,
  OPFS_WORKSPACES_DIRECTORY,
} from "@/lib/opfsArtifactStore";
import { ownShellCacheKeys, unregisterOwnServiceWorker } from "@/lib/swCache";

/**
 * Every IndexedDB database this app owns, including the retired last-run
 * database. Normal operation never opens or deletes retired namespaces (the
 * app only reports them); an explicit wipe of all this app's data removes
 * them too, without opening them.
 */
const CHRONICLE_IDB_NAMES = [
  LAST_RUN_DB_NAME,
  PROJECTS_DB_NAME,
  LEGACY_LAST_RUN_DB_NAME,
] as const;

/** Prefix shared by every localStorage/sessionStorage key this app writes. */
const APP_STORAGE_KEY_PREFIX = "chronicle";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { name } = error as { name?: unknown };
  return typeof name === "string" ? name : "";
}

/** Best-effort: a blocked or failed delete resolves; used by the full reset. */
function deleteDatabase(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(null);
      request.onerror = () =>
        resolve(`IndexedDB ${name}: ${errorText(request.error)}`);
      // A live connection elsewhere (another tab) blocks the delete. The
      // request stays queued and completes when that tab closes, so the reset
      // must not hang on it — but it is not done yet, and says so.
      request.onblocked = () =>
        resolve(
          `IndexedDB ${name}: another open tab of this app is still using it; close other tabs to finish deleting it`,
        );
    } catch (error) {
      resolve(`IndexedDB ${name}: ${errorText(error)}`);
    }
  });
}

function removeAppKeys(storage: Storage | undefined, label: string): string | null {
  if (!storage) return null;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(APP_STORAGE_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return null;
  } catch (error) {
    return `${label}: ${errorText(error)}`;
  }
}

async function clearAppCaches(): Promise<string | null> {
  try {
    const keys = await ownShellCacheKeys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    return null;
  } catch (error) {
    return `Cache Storage: ${errorText(error)}`;
  }
}

async function unregisterAppServiceWorker(): Promise<string | null> {
  try {
    await unregisterOwnServiceWorker();
    return null;
  } catch (error) {
    return `Service worker: ${errorText(error)}`;
  }
}

async function removeOpfsDirectory(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    await root.removeEntry(name, { recursive: true });
    return null;
  } catch (error) {
    return errorName(error) === "NotFoundError" ? null : `OPFS ${name}: ${errorText(error)}`;
  }
}

/**
 * Spill files of live workers are held open by a sync access handle and cannot
 * be removed until the worker ends. They hold payloads only while a request
 * runs (the file is truncated to zero when its last payload is dropped) and
 * the next worker's boot sweep removes them, so a locked file is skipped
 * rather than reported. A worker that was just terminated releases its lock
 * asynchronously, so locked files are retried until `settleMs` has passed.
 */
async function removeSpillFiles(
  root: FileSystemDirectoryHandle,
  settleMs = 0,
): Promise<string | null> {
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await root.getDirectoryHandle(OPFS_PAYLOAD_SPILL_DIRECTORY);
  } catch (error) {
    return errorName(error) === "NotFoundError"
      ? null
      : `OPFS ${OPFS_PAYLOAD_SPILL_DIRECTORY}: ${errorText(error)}`;
  }
  const deadline = Date.now() + settleMs;
  for (;;) {
    const names: string[] = [];
    try {
      for await (const name of (
        directory as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
      ).keys()) {
        names.push(name);
      }
    } catch (error) {
      return `OPFS ${OPFS_PAYLOAD_SPILL_DIRECTORY}: ${errorText(error)}`;
    }
    let locked = 0;
    for (const name of names) {
      try {
        await directory.removeEntry(name);
      } catch (error) {
        const kind = errorName(error);
        if (kind === "NoModificationAllowedError" || kind === "InvalidModificationError") {
          locked += 1;
        } else if (kind !== "NotFoundError") {
          return `OPFS ${OPFS_PAYLOAD_SPILL_DIRECTORY}: ${errorText(error)}`;
        }
      }
    }
    if (locked === 0 || Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Remove the payload spill files of ended workers. Deleting results calls
 * this after ending the workers that processed them: a worker ended with
 * payloads still spilled leaves participant rows in its file, which the boot
 * sweep would only reclaim once the file has aged past its window.
 */
export async function removePayloadSpillFiles(settleMs = 500): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    return null;
  }
  return removeSpillFiles(root, settleMs);
}

async function clearOpfs(): Promise<string[]> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return [];
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    // A context that cannot open OPFS (private browsing) never stored
    // anything there: there is nothing to delete.
    return [];
  }
  const results = await Promise.all([
    removeOpfsDirectory(root, OPFS_WORKSPACES_DIRECTORY),
    removeOpfsDirectory(root, OPFS_CAPABILITY_PROBE_DIRECTORY),
    ...LEGACY_OPFS_DIRECTORIES.map((name) => removeOpfsDirectory(root, name)),
    removeSpillFiles(root),
  ]);
  return results.filter((result): result is string => result !== null);
}

/**
 * Delete this app's local data: its localStorage/sessionStorage keys
 * (settings, presets, UI state), its IndexedDB databases (cached last run,
 * saved projects), its OPFS directories (processed results and their
 * history, payload spill, storage probe), its offline cache, and its
 * service-worker registration, plus the cached run and workspaces an earlier
 * version of the app left behind (removed without being opened). Resolves
 * with one message per step that did not complete (empty when everything was
 * deleted); callers typically reload next.
 */
export async function resetLocalData(): Promise<string[]> {
  const failures: Array<string | null> = [
    removeAppKeys(globalThis.localStorage, "localStorage"),
    removeAppKeys(globalThis.sessionStorage, "sessionStorage"),
  ];
  failures.push(...(await Promise.all(CHRONICLE_IDB_NAMES.map((name) => deleteDatabase(name)))));
  failures.push(...(await clearOpfs()));
  failures.push(await clearAppCaches());
  failures.push(await unregisterAppServiceWorker());
  return failures.filter((failure): failure is string => failure !== null);
}

/** Survives the reload that follows a completed wipe, so the fresh page can say so. */
const LOCAL_DATA_DELETED_FLAG = `${APP_STORAGE_KEY_PREFIX}.localDataDeleted`;

export function markLocalDataDeleted(): void {
  try {
    globalThis.sessionStorage?.setItem(LOCAL_DATA_DELETED_FLAG, "1");
  } catch {
    // Without sessionStorage the reloaded page simply shows no confirmation.
  }
}

/** True once after a completed wipe; clears the mark. */
export function consumeLocalDataDeletedMark(): boolean {
  try {
    const marked = globalThis.sessionStorage?.getItem(LOCAL_DATA_DELETED_FLAG) === "1";
    globalThis.sessionStorage?.removeItem(LOCAL_DATA_DELETED_FLAG);
    return marked;
  } catch {
    return false;
  }
}

/**
 * Lighter cleanup for the storage-pressure banner: drop only the transient
 * last-run cache (the big, regenerable hog), leaving saved projects, settings,
 * and presets intact. Rejects when the database was not deleted, so the
 * banner never reports a clear that did not happen.
 */
export async function clearCachedRun(): Promise<void> {
  const failure = await deleteDatabase(LAST_RUN_DB_NAME);
  if (failure !== null) throw new Error(failure);
}
