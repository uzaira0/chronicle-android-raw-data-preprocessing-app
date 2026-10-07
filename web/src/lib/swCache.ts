/**
 * Every GitHub Pages site of one account shares one origin, and with it one
 * Cache Storage and one service-worker registration list (the preview build of
 * this app lives there too). Everything here touches only THIS app: the
 * registration whose scope is this app's base URL, and the shell caches
 * public/sw.js names after that scope (`chronicle-local-shell-…@<scope>`). An
 * unscoped shell cache from before scoping counts as ours only when every entry
 * in it sits under this scope.
 */
const SHELL_CACHE_PREFIX = "chronicle-local-shell-";

/** This app's own service-worker scope (the Vite base under this page's origin). */
function appServiceWorkerScope(): string | null {
  try {
    return new URL(import.meta.env.BASE_URL, globalThis.location.href).href;
  } catch {
    return null;
  }
}

async function isOwnShellCache(key: string, scope: string): Promise<boolean> {
  if (!key.startsWith(SHELL_CACHE_PREFIX)) return false;
  if (key.endsWith(`@${scope}`)) return true;
  if (key.includes("@")) return false;
  const requests = await (await caches.open(key)).keys();
  return (
    requests.length > 0 &&
    requests.every((request) => request.url.startsWith(scope))
  );
}

export async function ownShellCacheKeys(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  const scope = appServiceWorkerScope();
  if (scope === null) return [];
  const keys = await caches.keys();
  const own = await Promise.all(
    keys.map(async (key) => ((await isOwnShellCache(key, scope)) ? key : null)),
  );
  return own.filter((key): key is string => key !== null);
}

export async function unregisterOwnServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const scope = appServiceWorkerScope();
  if (scope === null) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => registration.scope === scope)
      .map((registration) => registration.unregister()),
  );
}

export async function clearSwCaches(): Promise<void> {
  const keys = await ownShellCacheKeys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  await unregisterOwnServiceWorker();
}

export async function clearSwCachesAndReload(): Promise<void> {
  await clearSwCaches();
  window.location.reload();
}
