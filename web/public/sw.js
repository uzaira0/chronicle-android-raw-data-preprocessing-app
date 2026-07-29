const CACHE_NAME = "chronicle-local-shell-v3";
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
  return caches.match(request, { ignoreVary: true });
}

function toAbsoluteScopeUrl(path) {
  return new URL(path, self.location.href).toString();
}

async function getManifestUrls() {
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const manifest = await response.json();
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
    return Array.from(collected);
  } catch {
    return [];
  }
}

async function getExtraPrecacheUrls() {
  // Worker + WASM chunks that Vite emits but omits from manifest.json. Without
  // these, a first processing run while offline can't load the matcher worker.
  try {
    const response = await fetch("./sw-precache-extra.json", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const list = await response.json();
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter((path) => typeof path === "string").map(toAbsoluteScopeUrl);
  } catch {
    return [];
  }
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const urls = new Set(SHELL_URLS.map(toAbsoluteScopeUrl));
  (await getManifestUrls()).forEach((url) => urls.add(url));
  (await getExtraPrecacheUrls()).forEach((url) => urls.add(url));
  // Tolerate individual misses (a stale list, a range-only asset) instead of
  // failing the whole precache the way cache.addAll would.
  await Promise.all(
    Array.from(urls).map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        /* skip this asset; the runtime fetch handler will cache it on demand */
      }
    }),
  );
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
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
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

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          const cache = await caches.open(CACHE_NAME);
          void cache.put(event.request, networkResponse.clone());
          return networkResponse;
        } catch {
          return (
            (await matchSameOriginCache(event.request)) ??
            (await matchSameOriginCache(APP_SHELL_FALLBACK)) ??
            (await matchSameOriginCache(OFFLINE_FALLBACK)) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await matchSameOriginCache(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      const networkResponse = await fetch(event.request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        void cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    })(),
  );
});
