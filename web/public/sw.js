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

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const urls = new Set(SHELL_URLS.map(toAbsoluteScopeUrl));
  (await getManifestUrls()).forEach((url) => urls.add(url));
  await cache.addAll(Array.from(urls));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
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
            (await caches.match(event.request)) ??
            (await caches.match(APP_SHELL_FALLBACK)) ??
            (await caches.match(OFFLINE_FALLBACK)) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
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
