/**
 * Wipe everything the current workflow version persisted, for recovery when a
 * wedged cache / over-full storage / corrupt record stops the app from loading.
 *
 * Deliberately self-contained (no app-state imports beyond the two DB-name
 * constants) so the boot-error "lifeboat" can call it even when the rest of the
 * app failed to initialise. Each step is independently guarded — a failure in
 * one (e.g. Cache Storage unavailable) must not stop the others.
 */

import { LAST_RUN_DB_NAME } from "@/lib/lastRunStore";
import { PROJECTS_DB_NAME } from "@/lib/projectsStore";
import { OPFS_WORKSPACES_DIRECTORY } from "@/lib/opfsArtifactStore";

/** Every current-version IndexedDB database this app owns. */
const CHRONICLE_IDB_NAMES = [LAST_RUN_DB_NAME, PROJECTS_DB_NAME] as const;

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      // A live connection elsewhere blocks the delete; don't hang the reset.
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.allSettled(keys.map((key) => caches.delete(key)));
  } catch {
    /* ignore */
  }
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  } catch {
    /* ignore */
  }
}

async function clearOpfsWorkspaces(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_WORKSPACES_DIRECTORY, { recursive: true });
  } catch {
    // Missing/unavailable OPFS is already an empty state. Reset remains
    // best-effort so one browser subsystem cannot block the recovery control.
  }
}

/**
 * Clear current-version local app data: localStorage/sessionStorage, current
 * IndexedDB databases, current OPFS workspaces, service-worker caches, and the
 * service-worker registration. Retired database namespaces are intentionally
 * never opened or deleted; users can remove them with browser site-data tools.
 * Resolves once best-effort cleanup is done; callers typically reload next.
 */
export async function resetLocalData(): Promise<void> {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  await Promise.allSettled(CHRONICLE_IDB_NAMES.map((name) => deleteDatabase(name)));
  await clearOpfsWorkspaces();
  await clearCacheStorage();
  await unregisterServiceWorkers();
}

/**
 * Lighter cleanup for the storage-pressure banner: drop only the transient
 * last-run cache (the big, regenerable hog), leaving saved projects, settings,
 * and presets intact.
 */
export async function clearCachedRun(): Promise<void> {
  await deleteDatabase(LAST_RUN_DB_NAME);
}
