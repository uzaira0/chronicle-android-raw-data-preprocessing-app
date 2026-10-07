import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSwCaches,
  clearSwCachesAndReload,
  ownShellCacheKeys,
  unregisterOwnServiceWorker,
} from "./swCache";

// Two apps on one origin, as every GitHub Pages site of an account is: this
// app at /app/ and its preview build at /preview/. Both stamp the same shell
// cache name; public/sw.js suffixes it with the worker's scope.
const ENTRIES: Record<string, string[]> = {
  "chronicle-local-shell-v3-aaa@http://127.0.0.1/app/": [],
  "chronicle-local-shell-v3-bbb@http://127.0.0.1/preview/": [],
  // Unscoped names from before scoping: owned by whoever's files are inside.
  "chronicle-local-shell-v3": ["http://127.0.0.1/app/index.html"],
  "chronicle-local-shell-v2": ["http://127.0.0.1/preview/index.html"],
  "unrelated-cache": ["http://127.0.0.1/app/x.js"],
};

function stubCaches(order: string[] = []): { deleted: string[] } {
  const deleted: string[] = [];
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve(Object.keys(ENTRIES)),
    open: (key: string) =>
      Promise.resolve({
        keys: () => Promise.resolve((ENTRIES[key] ?? []).map((url) => ({ url }))),
      }),
    delete: (key: string) => {
      deleted.push(key);
      order.push("cache-delete");
      return Promise.resolve(true);
    },
  });
  return { deleted };
}

function stubRegistrations(order: string[] = []): string[] {
  const unregistered: string[] = [];
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: () =>
        Promise.resolve(
          ["http://127.0.0.1/app/", "http://127.0.0.1/preview/"].map((scope) => ({
            scope,
            unregister: () => {
              unregistered.push(scope);
              order.push("unregister");
              return Promise.resolve(true);
            },
          })),
        ),
    },
  });
  return unregistered;
}

beforeEach(() => {
  // The production build's base (vite.config.ts `base: "./"`), so the scope
  // is the directory the page is served from.
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("location", { href: "http://127.0.0.1/app/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("clearSwCaches", () => {
  it("deletes only this app's caches and service worker on a shared origin", async () => {
    const { deleted } = stubCaches();
    const unregistered = stubRegistrations();

    await clearSwCaches();

    expect(deleted).toEqual([
      "chronicle-local-shell-v3-aaa@http://127.0.0.1/app/",
      "chronicle-local-shell-v3",
    ]);
    expect(unregistered).toEqual(["http://127.0.0.1/app/"]);
  });

  it("still clears caches when serviceWorker is unavailable", async () => {
    const { deleted } = stubCaches();
    vi.stubGlobal("navigator", {});

    await clearSwCaches();

    expect(deleted).toHaveLength(2);
  });
});

describe("clearSwCachesAndReload", () => {
  it("reloads only after caches and registrations are gone", async () => {
    const order: string[] = [];
    stubCaches(order);
    stubRegistrations(order);
    const reload = vi.fn(() => order.push("reload"));
    vi.stubGlobal("window", { location: { reload } });

    await clearSwCachesAndReload();

    expect(order).toEqual(["cache-delete", "cache-delete", "unregister", "reload"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("without a page location or Cache Storage", () => {
  it("finds no caches of its own when Cache Storage is unavailable", async () => {
    vi.stubGlobal("caches", undefined);

    await expect(ownShellCacheKeys()).resolves.toEqual([]);
  });

  it("touches no cache or registration when its scope cannot be resolved", async () => {
    const { deleted } = stubCaches();
    const unregistered = stubRegistrations();
    vi.stubGlobal("location", undefined);

    await expect(ownShellCacheKeys()).resolves.toEqual([]);
    await unregisterOwnServiceWorker();

    expect(deleted).toEqual([]);
    expect(unregistered).toEqual([]);
  });
});
