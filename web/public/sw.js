const CACHE_NAME = "chronicle-local-shell-v3";
// Every GitHub Pages site of one account shares one origin, and with it one
// Cache Storage. The preview build stamps the same CACHE_NAME literal, so the
// cache is named after this worker's scope as well: this app never reads,
// overwrites or deletes another app's cache.
const SCOPE = self.registration.scope;
const SCOPED_CACHE_NAME = `${CACHE_NAME}@${SCOPE}`;
const MANIFEST_URL = "./.vite/manifest.json";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./sw.js",
];
const APP_SHELL_FALLBACK = new URL("./index.html", self.location.href).toString();
const OFFLINE_FALLBACK = new URL("./offline.html", self.location.href).toString();

async function matchSameOriginCache(request) {
  // Static preview hosts commonly add `Vary: Origin`. Precache requests made
  // from install have no Origin header, whereas module and stylesheet requests
  // do, so the Cache API's default Vary comparison rejects an otherwise exact
  // same-origin URL match while offline. Origin was already checked by the
  // fetch handler and hashed assets are URL-addressed, so this dimension is not
  // semantically relevant to the local shell cache.
  // cacheName: look only in this app's cache, never a co-origin app's.
  return caches.match(request, { ignoreVary: true, cacheName: SCOPED_CACHE_NAME });
}

// A shell cache from an older version of THIS app: either one named for this
// scope, or an unscoped name from before scoping whose entries all sit under
// this scope. Another app's cache on the same origin is never ours.
async function isStaleOwnCache(key) {
  if (key === SCOPED_CACHE_NAME || !key.startsWith("chronicle-local-shell-")) return false;
  if (key.endsWith(`@${SCOPE}`)) return true;
  if (key.includes("@")) return false;
  const requests = await (await caches.open(key)).keys();
  return requests.length > 0 && requests.every((request) => request.url.startsWith(SCOPE));
}

function toAbsoluteScopeUrl(path) {
  return new URL(path, self.location.href).toString();
}

async function getManifestUrls() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Required Vite precache manifest is unavailable");
  }
  const manifest = await response.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Required Vite precache manifest is invalid");
  }
  const collected = new Set();
  const visited = new Set();

  function collectPath(path) {
    if (typeof path !== "string" || path.length === 0) {
      return;
    }
    if (/^https?:/i.test(path)) {
      return;
    }
    collected.add(toAbsoluteScopeUrl(path));
  }

  function walkEntry(entryKey) {
    if (visited.has(entryKey)) {
      return;
    }
    visited.add(entryKey);
    const entry = manifest[entryKey];
    if (!entry || typeof entry !== "object") {
      return;
    }
    collectPath(entry.file);
    (entry.css ?? []).forEach(collectPath);
    (entry.assets ?? []).forEach(collectPath);
    (entry.imports ?? []).forEach(walkEntry);
    (entry.dynamicImports ?? []).forEach(walkEntry);
  }

  Object.keys(manifest).forEach(walkEntry);
  if (collected.size === 0) {
    throw new Error("Required Vite precache manifest has no assets");
  }
  return Array.from(collected);
}

async function getExtraPrecacheUrls() {
  // Worker + WASM chunks that Vite emits but omits from manifest.json. Without
  // these, a first processing run while offline can't load the matcher worker.
  const response = await fetch("./sw-precache-extra.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Required supplementary precache manifest is unavailable");
  }
  const list = await response.json();
  if (!Array.isArray(list) || list.length === 0 ||
      list.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new Error("Required supplementary precache manifest is invalid");
  }
  const urls = list.map(toAbsoluteScopeUrl);
  if (urls.some((url) => new URL(url).origin !== self.location.origin)) {
    throw new Error("Supplementary precache assets must be same-origin");
  }
  return urls;
}

async function verifyCachedResponse(cache, request) {
  const response = await cache.match(request, { ignoreVary: true });
  if (!response?.ok || (await response.clone().arrayBuffer()).byteLength === 0) {
    throw new Error(`Required cache write has no readable bytes: ${request.url ?? request}`);
  }
}

async function precacheShell() {
  const cache = await caches.open(SCOPED_CACHE_NAME);
  const urls = new Set(SHELL_URLS.map(toAbsoluteScopeUrl));
  (await getManifestUrls()).forEach((url) => urls.add(url));
  (await getExtraPrecacheUrls()).forEach((url) => urls.add(url));
  const requiredUrls = Array.from(urls);
  const previous = (await Promise.all(requiredUrls.map(async (url) =>
    [url, await cache.match(url, { ignoreVary: true })]))).filter(([, response]) => response);
  // addAll commits one atomic batch: a failed required fetch does not replace
  // prior responses. Successful writes can still contain empty bodies, so keep
  // every previously cached required response for a post-commit refusal.
  await cache.addAll(requiredUrls);
  try {
    await Promise.all(requiredUrls.map((url) => verifyCachedResponse(cache, url)));
  } catch (validationError) {
    // Attempt every restoration and await all of them before install rejects.
    // A failing backend must not silently turn this into a successful install.
    const restored = await Promise.allSettled(previous.map(async ([url, response]) =>
      cache.put(url, response)));
    const failures = restored.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError([validationError, ...failures.map((result) => result.reason)],
        "Required precache validation failed and prior responses could not all be restored");
    }
    throw validationError;
  }
}

function respondWithTrackedCache(event, result) {
  // Cache availability must not prevent an online response. Its completion is
  // nevertheless part of the event lifetime, and unreadable writes fail rather
  // than being mistaken for offline readiness.
  const prepared = result.then(({ response, cacheNetworkResponse }) => {
    if (!cacheNetworkResponse || !response.ok) return { response };
    // Capture the independent body before exposing the original to the client.
    // An awaited cache open must not let the client drain or lock it first.
    try {
      return { response, cacheResponse: response.clone() };
    } catch (cacheError) {
      return { response, cacheError };
    }
  });
  event.respondWith(prepared.then(({ response }) => response));
  event.waitUntil(prepared.then(async ({ cacheResponse, cacheError }) => {
    if (cacheError) throw cacheError;
    if (!cacheResponse) return;
    const cache = await caches.open(SCOPED_CACHE_NAME);
    await cache.put(event.request, cacheResponse);
    await verifyCachedResponse(cache, event.request);
  }));
}

self.addEventListener("install", (event) => {
  // Only skip waiting AFTER the shell is precached. activate() deletes the old
  // cache and claims clients, so jumping ahead of precache leaves a window where
  // the old cache is gone and the new one is incomplete — fatal if the user is
  // offline during that window.
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = await Promise.all(keys.map(async (key) => ((await isStaleOwnCache(key)) ? key : null)));
      await Promise.all(stale.filter((key) => key !== null).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // In particular, readiness requests the current build metadata with no-store;
  // serving a previous list from our own cache would defeat that freshness check.
  if (event.request.cache === "no-store") {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    respondWithTrackedCache(event,
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          return { response: networkResponse, cacheNetworkResponse: true };
        } catch {
          const response = (
            (await matchSameOriginCache(event.request)) ??
            (await matchSameOriginCache(APP_SHELL_FALLBACK)) ??
            (await matchSameOriginCache(OFFLINE_FALLBACK)) ??
            Response.error()
          );
          return { response, cacheNetworkResponse: false };
        }
      })(),
    );
    return;
  }

  respondWithTrackedCache(event,
    (async () => {
      // A broken Cache API is not a reason to make a working network unusable.
      const cachedResponse = await matchSameOriginCache(event.request).catch(() => undefined);
      if (cachedResponse) {
        return { response: cachedResponse, cacheNetworkResponse: false };
      }
      const networkResponse = await fetch(event.request);
      return { response: networkResponse, cacheNetworkResponse: true };
    })(),
  );
});
